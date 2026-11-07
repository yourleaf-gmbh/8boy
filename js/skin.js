// Figuren mit Skelett (8BOY 128)
//
// Aus einer GLB-Datei mit Skin (Blender: Armature + Gewichte) wird eine „Figur“:
//   Netz in den Koordinaten der Datei (Punkte, Normalen, UVs, Farben, je Ecke 4 Knochen + 4 Gewichte),
//   Skelett (Knochen mit Eltern, Ruhelage als Verschiebung/Drehung/Größe, inverse Bindungsmatrizen),
//   Animationen – gleichmäßig eingebacken (30 Bilder/s), damit das Abspielen nur noch nachschlagen und mischen muss.
// Die Grafikkarte verformt das Netz selbst (GPU-Skinning): je Bild schickt die Konsole nur die Knochen-Matrizen.
// Wie bei allen Modellen wird die Figur auf Höhe 1 gebracht (Füße auf y = 0) und von glTF (rechtshändig)
// in die Konsolen-Koordinaten gespiegelt – das steckt in der Matrix N, die vor jede Knochen-Matrix kommt.
//
// Binärformat „B8S1“: Kopf (Magie, JSON-Länge), JSON mit Aufbau und Versätzen, danach Float32/Uint8-Blöcke.

const MAGIC = 0x31533842;   // 'B8S1'
export const SKIN_MAX_JOINTS = 64;
export const SKIN_FPS = 30;
const toSRGB = (x) => Math.round(255 * (x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(Math.max(0, x), 1 / 2.4) - 0.055));

// ------------------------------------------------------------------ Mathe (Spalten-Matrizen wie glTF)
export function mat4mul(a, b, out = new Float32Array(16)) {
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    out[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
  }
  return out;
}
export function compose(t, q, s, out = new Float32Array(16)) {
  const [x, y, z, w] = q;
  const x2 = x + x, y2 = y + y, z2 = z + z, xx = x * x2, xy = x * y2, xz = x * z2, yy = y * y2, yz = y * z2, zz = z * z2, wx = w * x2, wy = w * y2, wz = w * z2;
  out[0] = (1 - (yy + zz)) * s[0]; out[1] = (xy + wz) * s[0]; out[2] = (xz - wy) * s[0]; out[3] = 0;
  out[4] = (xy - wz) * s[1]; out[5] = (1 - (xx + zz)) * s[1]; out[6] = (yz + wx) * s[1]; out[7] = 0;
  out[8] = (xz + wy) * s[2]; out[9] = (yz - wx) * s[2]; out[10] = (1 - (xx + yy)) * s[2]; out[11] = 0;
  out[12] = t[0]; out[13] = t[1]; out[14] = t[2]; out[15] = 1;
  return out;
}
const IDENT = () => { const m = new Float32Array(16); m[0] = m[5] = m[10] = m[15] = 1; return m; };
function nlerpQ(a, b, t, out) {
  const d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3], s = d < 0 ? -1 : 1;
  for (let i = 0; i < 4; i++) out[i] = a[i] + (b[i] * s - a[i]) * t;
  const l = Math.hypot(out[0], out[1], out[2], out[3]) || 1;
  for (let i = 0; i < 4; i++) out[i] /= l;
  return out;
}
function slerpQ(a, b, t) {
  let d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
  const bb = d < 0 ? b.map((v) => -v) : b;
  d = Math.abs(d);
  if (d > 0.9995) return nlerpQ(a, bb, t, [0, 0, 0, 0]);
  const th = Math.acos(d), s = Math.sin(th), wa = Math.sin((1 - t) * th) / s, wb = Math.sin(t * th) / s;
  return [0, 1, 2, 3].map((i) => a[i] * wa + bb[i] * wb);
}
function nodeMatrix(n) {
  if (n.matrix) return Float32Array.from(n.matrix);
  return compose(n.translation || [0, 0, 0], n.rotation || [0, 0, 0, 1], n.scale || [1, 1, 1]);
}

// ------------------------------------------------------------------ GLB lesen
function leseGLB(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (dv.getUint32(0, true) !== 0x46546c67) throw new Error('keine GLB-Datei');
  let o = 12, json = null, bin = null;
  while (o < bytes.length) {
    const len = dv.getUint32(o, true), typ = dv.getUint32(o + 4, true);
    if (typ === 0x4e4f534a) json = JSON.parse(new TextDecoder().decode(bytes.subarray(o + 8, o + 8 + len)));
    else if (typ === 0x004e4942) bin = bytes.subarray(o + 8, o + 8 + len);
    o += 8 + len;
  }
  return { json, bin };
}
const COMP = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
function accessor(json, bin, i) {
  const a = json.accessors[i], bv = json.bufferViews[a.bufferView], n = COMP[a.type], cnt = a.count;
  const off = (bv.byteOffset || 0) + (a.byteOffset || 0);
  const size = { 5126: 4, 5125: 4, 5123: 2, 5121: 1, 5122: 2, 5120: 1 }[a.componentType];
  const stride = bv.byteStride || n * size;
  const dv = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
  const out = new Float32Array(cnt * n);
  for (let k = 0; k < cnt; k++) for (let c = 0; c < n; c++) {
    const p = off + k * stride + c * size;
    let v;
    switch (a.componentType) {
      case 5126: v = dv.getFloat32(p, true); break;
      case 5125: v = dv.getUint32(p, true); break;
      case 5123: v = dv.getUint16(p, true); if (a.normalized) v /= 65535; break;
      case 5121: v = dv.getUint8(p); if (a.normalized) v /= 255; break;
      case 5122: v = dv.getInt16(p, true); if (a.normalized) v = Math.max(v / 32767, -1); break;
      default: v = dv.getInt8(p); if (a.normalized) v = Math.max(v / 127, -1);
    }
    out[k * n + c] = v;
  }
  return out;
}

// GLB mit Skin → Figur (siehe oben). Mehrere Teile (Primitive) mit demselben Skin werden zusammengelegt.
export function importSkinGLB(bytes, { fps = SKIN_FPS } = {}) {
  const { json, bin } = leseGLB(bytes);
  if (!json?.skins?.length) throw new Error('die Datei hat kein Skelett (Skin)');
  const skin = json.skins[0];
  const joints = skin.joints;
  if (joints.length > SKIN_MAX_JOINTS) throw new Error(`zu viele Knochen: ${joints.length} (höchstens ${SKIN_MAX_JOINTS})`);
  const jointOf = new Map(joints.map((nd, i) => [nd, i]));
  // Eltern aller Knoten
  const parentNode = new Map();
  json.nodes.forEach((n, i) => (n.children || []).forEach((c) => parentNode.set(c, i)));
  const globalOf = (nd) => { let m = nodeMatrix(json.nodes[nd]); let p = parentNode.get(nd); while (p !== undefined) { m = mat4mul(nodeMatrix(json.nodes[p]), m); p = parentNode.get(p); } return m; };
  const parent = joints.map((nd) => { let p = parentNode.get(nd); while (p !== undefined && !jointOf.has(p)) p = parentNode.get(p); return p === undefined ? -1 : jointOf.get(p); });
  // feste Matrix über der Wurzel (z. B. das Armature-Objekt)
  const base = joints.map((nd, i) => (parent[i] >= 0 ? null : (parentNode.has(nd) ? globalOf(parentNode.get(nd)) : IDENT())));
  const rest = joints.map((nd) => { const n = json.nodes[nd]; return [...(n.translation || [0, 0, 0]), ...(n.rotation || [0, 0, 0, 1]), ...(n.scale || [1, 1, 1])]; });
  const ibm = skin.inverseBindMatrices !== undefined ? accessor(json, bin, skin.inverseBindMatrices) : new Float32Array(joints.length * 16).map((_, k) => (k % 16) % 5 === 0 ? 1 : 0);
  // Netz: alle Primitive der Knoten, die diesen Skin benutzen
  const P = [], Nn = [], UV = [], C = [], J = [], W = [], I = [];
  let nv = 0;
  json.nodes.forEach((node) => {
    if (node.skin !== 0 || node.mesh === undefined) return;
    for (const pr of json.meshes[node.mesh].primitives) {
      const at = pr.attributes;
      if (at.JOINTS_0 === undefined || at.WEIGHTS_0 === undefined) continue;
      const pos = accessor(json, bin, at.POSITION), cnt = pos.length / 3;
      const nrm = at.NORMAL !== undefined ? accessor(json, bin, at.NORMAL) : null;
      const uv = at.TEXCOORD_0 !== undefined ? accessor(json, bin, at.TEXCOORD_0) : null;
      const vc = at.COLOR_0 !== undefined ? accessor(json, bin, at.COLOR_0) : null, vcn = vc ? vc.length / cnt : 0;
      const jn = accessor(json, bin, at.JOINTS_0), wt = accessor(json, bin, at.WEIGHTS_0);
      const mat = pr.material !== undefined ? json.materials[pr.material] : null;
      const bf = mat?.pbrMetallicRoughness?.baseColorFactor || [1, 1, 1, 1];
      for (let k = 0; k < cnt; k++) {
        P.push(pos[k * 3], pos[k * 3 + 1], pos[k * 3 + 2]);
        Nn.push(nrm ? nrm[k * 3] : 0, nrm ? nrm[k * 3 + 1] : 1, nrm ? nrm[k * 3 + 2] : 0);
        UV.push(uv ? uv[k * 2] : 0, uv ? uv[k * 2 + 1] : 0);
        const r = bf[0] * (vc ? vc[k * vcn] : 1), g = bf[1] * (vc ? vc[k * vcn + 1] : 1), b = bf[2] * (vc ? vc[k * vcn + 2] : 1);
        C.push((toSRGB(r) << 16) | (toSRGB(g) << 8) | toSRGB(b));
        let s = wt[k * 4] + wt[k * 4 + 1] + wt[k * 4 + 2] + wt[k * 4 + 3];
        if (s <= 0) s = 1;
        for (let c = 0; c < 4; c++) { J.push(jn[k * 4 + c]); W.push(wt[k * 4 + c] / s); }
      }
      const idx = pr.indices !== undefined ? accessor(json, bin, pr.indices) : Float32Array.from({ length: cnt }, (_, k) => k);
      // gespiegelt (glTF → Konsole): jede Fläche andersherum durchlaufen
      for (let t = 0; t < idx.length; t += 3) I.push(nv + idx[t], nv + idx[t + 2], nv + idx[t + 1]);
      nv += cnt;
    }
  });
  if (!nv) throw new Error('kein Netz mit Knochen-Gewichten gefunden');
  // Größe 1 (Höhe), Füße auf 0, Mitte in x/z, z gespiegelt
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let k = 0; k < P.length; k++) { lo[k % 3] = Math.min(lo[k % 3], P[k]); hi[k % 3] = Math.max(hi[k % 3], P[k]); }
  const s = 1 / Math.max(1e-6, hi[1] - lo[1]);
  const cx = (lo[0] + hi[0]) / 2, cz = (lo[2] + hi[2]) / 2;
  const N = new Float32Array([s, 0, 0, 0, 0, s, 0, 0, 0, 0, -s, 0, -cx * s, -lo[1] * s, cz * s, 1]);
  // Animationen einbacken: je Bild für jeden Knochen T(3) R(4) S(3)
  const clips = [];
  for (const [ai, an] of (json.animations || []).entries()) {
    let dauer = 0;
    const kan = [];
    for (const ch of an.channels) {
      const ji = jointOf.get(ch.target.node);
      if (ji === undefined || !['translation', 'rotation', 'scale'].includes(ch.target.path)) continue;
      const smp = an.samplers[ch.sampler];
      const zeit = accessor(json, bin, smp.input);
      let werte = accessor(json, bin, smp.output);
      const n = ch.target.path === 'rotation' ? 4 : 3;
      if (smp.interpolation === 'CUBICSPLINE') werte = werte.filter((_, k) => Math.floor(k / n) % 3 === 1);
      dauer = Math.max(dauer, zeit[zeit.length - 1] - zeit[0]);
      kan.push({ ji, pfad: ch.target.path, zeit, werte, n, stufe: smp.interpolation === 'STEP' });
    }
    if (!kan.length) continue;
    const t0 = Math.min(...kan.map((k) => k.zeit[0]));
    const frames = Math.max(2, Math.round(dauer * fps) + 1);
    const daten = new Float32Array(frames * joints.length * 10);
    for (let f = 0; f < frames; f++) for (let j = 0; j < joints.length; j++) daten.set(rest[j], (f * joints.length + j) * 10);
    for (const k of kan) {
      const off = k.pfad === 'translation' ? 0 : k.pfad === 'rotation' ? 3 : 7;
      for (let f = 0; f < frames; f++) {
        const t = t0 + Math.min(dauer, f / fps);
        let i = 0;
        while (i < k.zeit.length - 2 && k.zeit[i + 1] < t) i++;
        const a = k.werte.slice(i * k.n, i * k.n + k.n), b = k.werte.slice((i + 1) * k.n, (i + 1) * k.n + k.n);
        const span = (k.zeit[i + 1] ?? k.zeit[i]) - k.zeit[i];
        const u = k.stufe || !b.length || span <= 0 ? 0 : Math.min(1, Math.max(0, (t - k.zeit[i]) / span));
        const v = !b.length ? a : k.n === 4 ? slerpQ(Array.from(a), Array.from(b), u) : Array.from(a).map((x, c) => x + (b[c] - x) * u);
        daten.set(v, (f * joints.length + k.ji) * 10 + off);
      }
    }
    clips.push({ name: an.name || `Animation ${ai + 1}`, dauer: (frames - 1) / fps, frames, fps, daten });
  }
  return {
    pos: Float32Array.from(P), nrm: Float32Array.from(Nn), uv: Float32Array.from(UV), col: Uint32Array.from(C),
    joints: Uint8Array.from(J), weights: Float32Array.from(W), idx: Uint32Array.from(I),
    skel: { namen: joints.map((nd) => json.nodes[nd].name || `Knochen ${nd}`), parent, rest, base, ibm, N },
    clips,
  };
}

// ------------------------------------------------------------------ Binärformat B8S1
export function packSkin(f) {
  const teile = [], kopf = { nv: f.pos.length / 3, nt: f.idx.length / 3, skel: { namen: f.skel.namen, parent: f.skel.parent, base: f.skel.base.map((m) => (m ? Array.from(m) : null)) }, clips: [], bloecke: {} };
  let ofs = 0;
  const block = (name, arr) => { const b = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength); kopf.bloecke[name] = [ofs, arr.constructor.name, arr.length]; teile.push(b); ofs += b.length; const pad = (4 - (ofs % 4)) % 4; if (pad) { teile.push(new Uint8Array(pad)); ofs += pad; } };
  block('pos', f.pos); block('nrm', f.nrm); block('uv', f.uv); block('col', f.col); block('joints', f.joints); block('weights', f.weights); block('idx', f.idx);
  block('rest', Float32Array.from(f.skel.rest.flat())); block('ibm', f.skel.ibm); block('N', f.skel.N);
  for (const [i, c] of f.clips.entries()) { kopf.clips.push({ name: c.name, dauer: c.dauer, frames: c.frames, fps: c.fps }); block('clip' + i, c.daten); }
  const js = new TextEncoder().encode(JSON.stringify(kopf));
  const head = new Uint8Array(8 + js.length + ((4 - (js.length % 4)) % 4));
  const dv = new DataView(head.buffer);
  dv.setUint32(0, MAGIC, true); dv.setUint32(4, js.length, true);
  head.set(js, 8);
  const out = new Uint8Array(head.length + ofs);
  out.set(head, 0);
  let p = head.length;
  for (const t of teile) { out.set(t, p); p += t.length; }
  return out;
}
export const istFigur = (bytes) => bytes && bytes.length > 8 && new DataView(bytes.buffer, bytes.byteOffset, 8).getUint32(0, true) === MAGIC;
export function unpackSkin(bytes) {
  if (!istFigur(bytes)) throw new Error('keine Figur (B8S1)');
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const jl = dv.getUint32(4, true);
  const kopf = JSON.parse(new TextDecoder().decode(bytes.subarray(8, 8 + jl)));
  const start = 8 + jl + ((4 - (jl % 4)) % 4);
  const T = { Float32Array, Uint32Array, Uint8Array };
  const raus = (name) => { const [o, typ, n] = kopf.bloecke[name]; const C = T[typ]; return new C(bytes.slice(start + o, start + o + n * C.BYTES_PER_ELEMENT).buffer); };
  const restF = raus('rest');
  const nj = kopf.skel.namen.length;
  return {
    pos: raus('pos'), nrm: raus('nrm'), uv: raus('uv'), col: raus('col'), joints: raus('joints'), weights: raus('weights'), idx: raus('idx'),
    skel: { namen: kopf.skel.namen, parent: kopf.skel.parent, base: kopf.skel.base.map((m) => (m ? Float32Array.from(m) : null)),
      rest: Array.from({ length: nj }, (_, j) => Array.from(restF.subarray(j * 10, j * 10 + 10))), ibm: raus('ibm'), N: raus('N') },
    clips: kopf.clips.map((c, i) => ({ ...c, daten: raus('clip' + i) })),
  };
}

// ------------------------------------------------------------------ Für den Grafikchip
// Netz im Chip-Format (wie meshToChip) – plus je Ecke Knochen und Gewichte
export function skinToChip(f) {
  const nt = f.idx.length / 3, fl = new Array(nt);
  for (let t = 0; t < nt; t++) {
    const a = f.idx[t * 3], b = f.idx[t * 3 + 1], c = f.idx[t * 3 + 2];
    fl[t] = { i: [a, b, c], c: 7, uv: [f.uv[a * 2], f.uv[a * 2 + 1], f.uv[b * 2], f.uv[b * 2 + 1], f.uv[c * 2], f.uv[c * 2 + 1]], cc: [f.col[a], f.col[b], f.col[c]] };
  }
  return { v: f.pos, f: fl, smooth: true, vn: f.nrm, both: false, img: null, skin: { joints: f.joints, weights: f.weights } };
}

// Knochen-Matrizen einer Pose: Animation a zur Zeit ta, optional mit Animation b (Zeit tb) gemischt (0 = nur a, 1 = nur b).
// Ergebnis: je Knochen N · global · inverse Bindung (Float32Array, 16 je Knochen) – das bekommt die Grafikkarte.
export function pose(f, a = -1, ta = 0, b = -1, tb = 0, mix = 0, out = null) {
  const sk = f.skel, nj = sk.namen.length;
  out = out || new Float32Array(nj * 16);
  const trs = new Float32Array(nj * 10);
  const sample = (ci, t, ziel) => {
    const c = f.clips[ci];
    if (!c) { for (let j = 0; j < nj; j++) ziel.set(sk.rest[j], j * 10); return; }
    const pos = ((t % c.dauer) + c.dauer) % c.dauer * c.fps;
    const f0 = Math.floor(pos), f1 = Math.min(c.frames - 1, f0 + 1), u = pos - f0;
    const A = c.daten.subarray(f0 * nj * 10), B = c.daten.subarray(f1 * nj * 10);
    const q = [0, 0, 0, 0];
    for (let j = 0; j < nj; j++) {
      const o = j * 10;
      for (const k of [0, 1, 2, 7, 8, 9]) ziel[o + k] = A[o + k] + (B[o + k] - A[o + k]) * u;
      nlerpQ(A.subarray(o + 3, o + 7), B.subarray(o + 3, o + 7), u, q);
      ziel[o + 3] = q[0]; ziel[o + 4] = q[1]; ziel[o + 5] = q[2]; ziel[o + 6] = q[3];
    }
  };
  sample(a, ta, trs);
  if (b >= 0 && mix > 0) {
    const t2 = new Float32Array(nj * 10);
    sample(b, tb, t2);
    const q = [0, 0, 0, 0];
    for (let j = 0; j < nj; j++) {
      const o = j * 10;
      for (const k of [0, 1, 2, 7, 8, 9]) trs[o + k] += (t2[o + k] - trs[o + k]) * mix;
      nlerpQ(trs.subarray(o + 3, o + 7), t2.subarray(o + 3, o + 7), mix, q);
      trs[o + 3] = q[0]; trs[o + 4] = q[1]; trs[o + 5] = q[2]; trs[o + 6] = q[3];
    }
  }
  // global = Eltern · lokal (Eltern stehen in glTF meist vor den Kindern – sonst rekursiv nachrechnen)
  const glob = new Array(nj);
  const lokal = (j) => compose(trs.subarray(j * 10, j * 10 + 3), trs.subarray(j * 10 + 3, j * 10 + 7), trs.subarray(j * 10 + 7, j * 10 + 10));
  const g = (j) => glob[j] || (glob[j] = sk.parent[j] >= 0 ? mat4mul(g(sk.parent[j]), lokal(j)) : mat4mul(sk.base[j], lokal(j)));
  const tmp = new Float32Array(16);
  for (let j = 0; j < nj; j++) {
    mat4mul(g(j), sk.ibm.subarray(j * 16, j * 16 + 16), tmp);
    mat4mul(sk.N, tmp, out.subarray(j * 16, j * 16 + 16));
  }
  return out;
}
// Wo steht Knochen j gerade? (für Gegenstände in der Hand) – Position in Figur-Koordinaten (Höhe 1)
export function knochenPos(f, matrizen, j) {
  const sk = f.skel, m = matrizen.subarray(j * 16, j * 16 + 16);
  // Bindungslage des Knochens = inverse der inversen Bindungsmatrix → Ursprung des Knochens
  const ib = sk.ibm.subarray(j * 16, j * 16 + 16);
  // Ursprung in Ruhelage: −R⁻¹·t der inversen Bindung
  const r = [[ib[0], ib[4], ib[8]], [ib[1], ib[5], ib[9]], [ib[2], ib[6], ib[10]]], t = [ib[12], ib[13], ib[14]];
  const o = [0, 1, 2].map((c) => -(r[0][c] * t[0] + r[1][c] * t[1] + r[2][c] * t[2]));
  return [m[0] * o[0] + m[4] * o[1] + m[8] * o[2] + m[12], m[1] * o[0] + m[5] * o[1] + m[9] * o[2] + m[13], m[2] * o[0] + m[6] * o[1] + m[10] * o[2] + m[14]];
}
