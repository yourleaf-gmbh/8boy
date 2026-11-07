// glTF 2.0 (.glb oder .gltf mit .bin und Bildern) lesen – ohne Fremdbibliothek.
// Ergebnis ist ein Netz für js/model-pack.js: echte Farben (baseColorFactor, Punktfarben), UVs, Normalen und
// EINE Textur je Modell. Mehrere Bilder (z. B. ein Material je Teil) werden zu einem Atlas zusammengelegt.
//
// Umrechnung wie beim OBJ-Import: glTF ist rechtshändig (y oben, +z zum Betrachter, Flächen gegen den Uhrzeigersinn),
// der 8BOY 32/64 linkshändig – z wird gespiegelt und jede Fläche andersherum durchlaufen.
//
//   const r = await importGLTF(files, { decodeImage, texSize: 512 })
//   files: Map(Dateiname → Uint8Array), darin eine .glb oder .gltf (Bilder/.bin über ihren Namen)
//   decodeImage(bytes, mime, maxKante) → Promise<{ w, h, rgba }> (Browser: Canvas, Node-Tests: eigener PNG-Leser)
import { normalizeMesh, computeNormals } from './model-pack.js';

const COMP = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
const SIZE = { 5126: 4, 5125: 4, 5123: 2, 5121: 1, 5122: 2, 5120: 1 };

// lineare Farbwerte (glTF) → sRGB (so rechnen Palette und Texturen der Konsole)
const toSRGB = (x) => Math.round(255 * (x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(Math.max(0, x), 1 / 2.4) - 0.055));

// echt: Maße aus der Datei behalten (Pegel/Welten, 8BOY 128) statt auf Größe 1 zu bringen
export async function importGLTF(files, { decodeImage, texSize = 512, ground = false, crease = 40, echt = false } = {}) {
  const names = [...files.keys()];
  const mainName = names.find((n) => /\.glb$/i.test(n)) || names.find((n) => /\.gltf$/i.test(n));
  if (!mainName) throw new Error('keine .glb- oder .gltf-Datei dabei');
  const main = files.get(mainName);
  const warn = [];
  let json, bin = null;
  const u32 = (o) => main[o] | (main[o + 1] << 8) | (main[o + 2] << 16) | (main[o + 3] << 24) >>> 0;
  if (u32(0) === 0x46546c67) {          // 'glTF'
    let o = 12;
    while (o + 8 <= main.length) {
      const len = u32(o), type = u32(o + 4) >>> 0, data = main.subarray(o + 8, o + 8 + len);
      if (type === 0x4e4f534a) json = JSON.parse(new TextDecoder().decode(data));
      else if (type === 0x004e4942) bin = data;
      o += 8 + len;
    }
  } else json = JSON.parse(new TextDecoder().decode(main));
  if (!json?.asset || String(json.asset.version || '').split('.')[0] !== '2') throw new Error('nur glTF 2.0 wird unterstützt');
  const byName = (uri) => {
    const n = decodeURIComponent(uri).split(/[\\/]/).pop();
    for (const [k, v] of files) if (k.split(/[\\/]/).pop().toLowerCase() === n.toLowerCase()) return v;
    return null;
  };
  const dataUri = (uri) => {
    const m = /^data:([^;,]*)(;base64)?,(.*)$/s.exec(uri);
    if (!m) return null;
    if (!m[2]) return new TextEncoder().encode(decodeURIComponent(m[3]));
    const s = atob(m[3]); const b = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i);
    return b;
  };
  const buffers = (json.buffers || []).map((b, i) => {
    if (b.uri === undefined) return bin;
    const d = b.uri.startsWith('data:') ? dataUri(b.uri) : byName(b.uri);
    if (!d) throw new Error(`Datei „${decodeURIComponent(b.uri)}“ fehlt – bitte mit auswählen`);
    return d;
  });

  function accessor(i) {
    const a = json.accessors[i];
    const comps = COMP[a.type], size = SIZE[a.componentType];
    const out = new Float32Array(a.count * comps);
    if (a.bufferView !== undefined) {
      const bv = json.bufferViews[a.bufferView], b = buffers[bv.buffer];
      const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
      const stride = bv.byteStride || comps * size, base = (bv.byteOffset || 0) + (a.byteOffset || 0);
      for (let k = 0; k < a.count; k++) for (let c = 0; c < comps; c++) {
        const p = base + k * stride + c * size;
        let v;
        switch (a.componentType) {
          case 5126: v = dv.getFloat32(p, true); break;
          case 5125: v = dv.getUint32(p, true); break;
          case 5123: v = dv.getUint16(p, true); if (a.normalized) v /= 65535; break;
          case 5121: v = dv.getUint8(p); if (a.normalized) v /= 255; break;
          case 5122: v = dv.getInt16(p, true); if (a.normalized) v = Math.max(v / 32767, -1); break;
          default: v = dv.getInt8(p); if (a.normalized) v = Math.max(v / 127, -1);
        }
        out[k * comps + c] = v;
      }
    }
    if (a.sparse) warn.push('Sparse-Zugriffe werden übersprungen');
    return out;
  }

  // -------------------------------------------------------------- Bilder: nur die Grundfarbe (baseColorTexture)
  const images = new Map();   // Bildnummer → { w, h, rgba } | null
  async function image(texIndex) {
    const src = json.textures?.[texIndex]?.source;
    if (src === undefined) return null;
    if (images.has(src)) return images.get(src);
    const im = json.images[src];
    let data = null, mime = im.mimeType || '';
    if (im.bufferView !== undefined) { const bv = json.bufferViews[im.bufferView], b = buffers[bv.buffer]; data = b.subarray(bv.byteOffset || 0, (bv.byteOffset || 0) + bv.byteLength); }
    else if (im.uri?.startsWith('data:')) { data = dataUri(im.uri); mime = /^data:([^;,]*)/.exec(im.uri)[1]; }
    else if (im.uri) { data = byName(im.uri); if (!mime) mime = /\.jpe?g$/i.test(im.uri) ? 'image/jpeg' : 'image/png'; }
    let r = null;
    if (!data) warn.push(`Bild „${im.uri || src}“ fehlt – ohne Textur`);
    else if (!decodeImage) warn.push('Bilder können hier nicht gelesen werden');
    else {
      try { r = await decodeImage(data, mime, texSize); } catch (e) { warn.push(`Bild ${im.uri || src} nicht lesbar (${e.message})`); }
    }
    images.set(src, r);
    return r;
  }

  // -------------------------------------------------------------- Knoten durchlaufen
  const mul = (a, b) => { const r = new Array(16).fill(0); for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) for (let k = 0; k < 4; k++) r[j * 4 + i] += a[k * 4 + i] * b[j * 4 + k]; return r; };
  const local = (n) => {
    if (n.matrix) return n.matrix;
    const [tx, ty, tz] = n.translation || [0, 0, 0], [x, y, z, w] = n.rotation || [0, 0, 0, 1], [sx, sy, sz] = n.scale || [1, 1, 1];
    return [(1 - 2 * (y * y + z * z)) * sx, 2 * (x * y + z * w) * sx, 2 * (x * z - y * w) * sx, 0,
      2 * (x * y - z * w) * sy, (1 - 2 * (x * x + z * z)) * sy, 2 * (y * z + x * w) * sy, 0,
      2 * (x * z + y * w) * sz, 2 * (y * z - x * w) * sz, (1 - 2 * (x * x + y * y)) * sz, 0, tx, ty, tz, 1];
  };
  // Normalen-Matrix: Inverse-Transponierte des 3×3-Teils (stimmt auch bei ungleicher Streckung)
  const normalMat = (M) => {
    const a = M[0], b = M[1], c = M[2], d = M[4], e = M[5], f = M[6], g = M[8], h = M[9], i = M[10];
    const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
    const D = -(b * i - c * h), E = a * i - c * g, F = -(a * h - b * g);
    const G = b * f - c * e, H = -(a * f - c * d), I = a * e - b * d;
    const det = a * A + b * B + c * C || 1;
    return { m: [A / det, B / det, C / det, D / det, E / det, F / det, G / det, H / det, I / det], flip: det < 0 };
  };

  const parts = [];   // je Primitiv: Punkte, Normalen, UVs, Farben, Flächen, Bild
  const scene = json.scenes?.[json.scene ?? 0];
  const roots = scene?.nodes ?? (json.nodes || []).map((_, i) => i).filter((i) => !(json.nodes || []).some((n) => (n.children || []).includes(i)));
  const I4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  async function walk(ni, parent, depth) {
    const n = json.nodes[ni];
    if (!n || depth > 64) return;
    const M = mul(parent, local(n));
    if (n.mesh !== undefined) await addMesh(json.meshes[n.mesh], M);
    for (const c of n.children || []) await walk(c, M, depth + 1);
  }
  async function addMesh(mesh, M) {
    const NM = normalMat(M);
    for (const prim of mesh.primitives || []) {
      const mode = prim.mode ?? 4;
      if (mode < 4) { warn.push('Punkte/Linien werden übersprungen'); continue; }
      if (prim.attributes.POSITION === undefined) continue;
      const P = accessor(prim.attributes.POSITION), nv = P.length / 3;
      let idx = prim.indices !== undefined ? accessor(prim.indices) : Float32Array.from({ length: nv }, (_, i) => i);
      if (mode === 5 || mode === 6) {   // Streifen / Fächer in einzelne Dreiecke
        const t = [];
        for (let k = 2; k < idx.length; k++) {
          if (mode === 6) t.push(idx[0], idx[k - 1], idx[k]);
          else if (k % 2) t.push(idx[k - 1], idx[k - 2], idx[k]); else t.push(idx[k - 2], idx[k - 1], idx[k]);
        }
        idx = Float32Array.from(t);
      }
      const mat = prim.material !== undefined ? json.materials?.[prim.material] : null;
      const pbr = mat?.pbrMetallicRoughness || {};
      const fac = pbr.baseColorFactor || [1, 1, 1, 1];
      const bt = pbr.baseColorTexture;
      const tc = bt ? (bt.extensions?.KHR_texture_transform?.texCoord ?? bt.texCoord ?? 0) : 0;
      const img = bt ? await image(bt.index) : null;
      const uvA = img && prim.attributes[`TEXCOORD_${tc}`] !== undefined ? accessor(prim.attributes[`TEXCOORD_${tc}`]) : null;
      const N = prim.attributes.NORMAL !== undefined ? accessor(prim.attributes.NORMAL) : null;
      const colA = prim.attributes.COLOR_0 !== undefined ? accessor(prim.attributes.COLOR_0) : null;
      // zweite UV-Ebene: Lightmap aus Blender (8BOY 128)
      const uv2A = prim.attributes.TEXCOORD_1 !== undefined ? accessor(prim.attributes.TEXCOORD_1) : null;
      const cComp = colA ? colA.length / nv : 0;
      // KHR_texture_transform: Versatz, Drehung, Streckung der UVs
      const tt = bt?.extensions?.KHR_texture_transform;
      const pos = new Float32Array(nv * 3), nrm = N ? new Float32Array(nv * 3) : null, uv = uvA ? new Float32Array(nv * 2) : null, col = new Uint32Array(nv);
      for (let k = 0; k < nv; k++) {
        const x = P[k * 3], y = P[k * 3 + 1], z = P[k * 3 + 2];
        pos[k * 3] = M[0] * x + M[4] * y + M[8] * z + M[12];
        pos[k * 3 + 1] = M[1] * x + M[5] * y + M[9] * z + M[13];
        pos[k * 3 + 2] = -(M[2] * x + M[6] * y + M[10] * z + M[14]);                 // z spiegeln
        if (N) {
          const a = N[k * 3], b = N[k * 3 + 1], c = N[k * 3 + 2], m = NM.m;
          let nx = m[0] * a + m[1] * b + m[2] * c, ny = m[3] * a + m[4] * b + m[5] * c, nz = m[6] * a + m[7] * b + m[8] * c;
          const l = Math.hypot(nx, ny, nz) || 1;
          nrm[k * 3] = nx / l; nrm[k * 3 + 1] = ny / l; nrm[k * 3 + 2] = -nz / l;
        }
        if (uv) {
          let u = uvA[k * 2], v = uvA[k * 2 + 1];
          if (tt) {
            const [sx, sy] = tt.scale || [1, 1], r = tt.rotation || 0, [ox, oy] = tt.offset || [0, 0];
            const cs = Math.cos(r), sn = Math.sin(r);
            const u2 = cs * sx * u + sn * sy * v + ox, v2 = -sn * sx * u + cs * sy * v + oy;
            u = u2; v = v2;
          }
          uv[k * 2] = u; uv[k * 2 + 1] = v;
        }
        let r = fac[0], g = fac[1], b = fac[2];
        if (colA) { r *= colA[k * cComp]; g *= colA[k * cComp + 1]; b *= colA[k * cComp + 2]; }
        col[k] = (toSRGB(r) << 16) | (toSRGB(g) << 8) | toSRGB(b);
      }
      // Umlaufsinn: Spiegelung an z dreht ihn um; eine gespiegelte Knoten-Matrix dreht ihn noch einmal
      const tri = new Uint32Array(idx.length);
      for (let k = 0; k + 2 < idx.length; k += 3) {
        if (NM.flip) { tri[k] = idx[k]; tri[k + 1] = idx[k + 1]; tri[k + 2] = idx[k + 2]; } else { tri[k] = idx[k]; tri[k + 1] = idx[k + 2]; tri[k + 2] = idx[k + 1]; }
      }
      parts.push({ pos, nrm, uv, col, idx: tri, img, both: !!mat?.doubleSided, mask: mat?.alphaMode === 'MASK', uv2: uv2A ? Float32Array.from(uv2A) : null });
    }
  }
  for (const r of roots) await walk(r, I4, 0);
  if (!parts.length) throw new Error('keine Dreiecke im Modell gefunden');

  // -------------------------------------------------------------- Atlas: alle Bilder (und Weiß für Teile ohne Bild) in eine Textur
  const imgs = [...new Set(parts.map((p) => (p.uv ? p.img : null)).filter(Boolean))];
  const needWhite = imgs.length && parts.some((p) => !p.uv);
  let tex = null;
  const place = new Map();   // Bild → { x, y, w, h } in Bildpunkten des Atlas
  if (imgs.length) {
    const cells = imgs.length + (needWhite ? 1 : 0);
    if (cells === 1) {
      const im = imgs[0];
      tex = { w: im.w, h: im.h, rgba: Uint8Array.from(im.rgba) };
      place.set(im, { x: 0, y: 0, w: im.w, h: im.h, whole: true });
    } else {
      const cols = Math.ceil(Math.sqrt(cells)), rows = Math.ceil(cells / cols);
      const W = Math.min(texSize, 1024), H = Math.min(texSize, 1024);
      const cw = Math.floor(W / cols), ch = Math.floor(H / rows), pad = 2;
      const rgba = new Uint8Array(W * H * 4).fill(255);
      const list = needWhite ? [...imgs, 'weiss'] : imgs;
      list.forEach((im, i) => {
        const x0 = (i % cols) * cw, y0 = Math.floor(i / cols) * ch, iw = cw - 2 * pad, ih = ch - 2 * pad;
        if (im !== 'weiss') {
          // Bild in die Zelle strecken (nächster Bildpunkt; Ränder werden in den Rand verlängert, gegen Farbsäume)
          for (let y = -pad; y < ih + pad; y++) for (let x = -pad; x < iw + pad; x++) {
            const sx = Math.min(im.w - 1, Math.max(0, Math.floor((Math.min(iw - 1, Math.max(0, x)) + 0.5) / iw * im.w)));
            const sy = Math.min(im.h - 1, Math.max(0, Math.floor((Math.min(ih - 1, Math.max(0, y)) + 0.5) / ih * im.h)));
            const s = (sy * im.w + sx) * 4, d = ((y0 + pad + y) * W + x0 + pad + x) * 4;
            rgba[d] = im.rgba[s]; rgba[d + 1] = im.rgba[s + 1]; rgba[d + 2] = im.rgba[s + 2]; rgba[d + 3] = im.rgba[s + 3];
          }
        }
        place.set(im, { x: x0 + pad, y: y0 + pad, w: iw, h: ih });
      });
      tex = { w: W, h: H, rgba };
    }
  }

  // -------------------------------------------------------------- zusammensetzen
  let nv = 0, nt = 0;
  for (const p of parts) { nv += p.pos.length / 3; nt += p.idx.length / 3; }
  const pos = new Float32Array(nv * 3), col = new Uint32Array(nv), uv = tex ? new Float32Array(nv * 2) : null;
  const anyN = parts.every((p) => p.nrm), nrm = anyN ? new Float32Array(nv * 3) : null;
  const uv2 = parts.some((p) => p.uv2) ? new Float32Array(nv * 2) : null;
  const idx = new Uint32Array(nt * 3);
  let both = false;
  let vo = 0, to = 0, wrapped = 0;
  const outUV = [];   // je Fläche: Ecken neu (Atlas-Kacheln wiederholen nicht – Flächen werden einzeln verschoben)
  for (const p of parts) {
    const n = p.pos.length / 3;
    pos.set(p.pos, vo * 3); col.set(p.col, vo);
    if (nrm) nrm.set(p.nrm, vo * 3);
    if (uv2 && p.uv2) uv2.set(p.uv2, vo * 2);
    both ||= p.both;
    const pl = p.uv && p.img ? place.get(p.img) : place.get('weiss');
    for (let k = 0; k < p.idx.length; k++) idx[to * 3 + k] = p.idx[k] + vo;
    if (uv) {
      if (pl?.whole) for (let k = 0; k < n; k++) { uv[(vo + k) * 2] = p.uv[k * 2]; uv[(vo + k) * 2 + 1] = p.uv[k * 2 + 1]; }
      else if (pl && p.uv) outUV.push({ p, pl, vo, to, n });
      else {
        // Teil ohne Bild: auf das weiße Feld
        const w = place.get('weiss');
        const cu = w ? (w.x + w.w / 2) / tex.w : 0.5, cv = w ? (w.y + w.h / 2) / tex.h : 0.5;
        for (let k = 0; k < n; k++) { uv[(vo + k) * 2] = cu; uv[(vo + k) * 2 + 1] = cv; }
      }
    }
    vo += n; to += p.idx.length / 3;
  }
  // Atlas-Teile: Ecken je Fläche in die Kachel legen (Flächen, deren UVs über den Rand gehen, ins Bild schieben)
  const extraPos = [], extraCol = [], extraNrm = [], extraUV = [], extraUV2 = [];
  for (const { p, pl, vo: base, to: t0 } of outUV) {
    const nf = p.idx.length / 3;
    const fresh = new Map();
    for (let f = 0; f < nf; f++) {
      const c = [p.idx[f * 3], p.idx[f * 3 + 1], p.idx[f * 3 + 2]];
      const us = c.map((k) => p.uv[k * 2]), vs = c.map((k) => p.uv[k * 2 + 1]);
      const fu = Math.floor(Math.min(...us) + 1e-6), fv = Math.floor(Math.min(...vs) + 1e-6);
      if (fu || fv) wrapped++;
      for (let j = 0; j < 3; j++) {
        const k = c[j], key = `${k}|${fu}|${fv}`;
        let q = fresh.get(key);
        if (q === undefined) {
          const u = Math.min(1, Math.max(0, p.uv[k * 2] - fu)), v = Math.min(1, Math.max(0, p.uv[k * 2 + 1] - fv));
          const U = (pl.x + u * pl.w) / tex.w, V = (pl.y + v * pl.h) / tex.h;
          if (fu === 0 && fv === 0) { q = base + k; uv[q * 2] = U; uv[q * 2 + 1] = V; }
          else {
            q = nv + extraPos.length / 3;
            extraPos.push(p.pos[k * 3], p.pos[k * 3 + 1], p.pos[k * 3 + 2]); extraCol.push(p.col[k]);
            if (nrm) extraNrm.push(p.nrm[k * 3], p.nrm[k * 3 + 1], p.nrm[k * 3 + 2]);
            extraUV.push(U, V);
            if (uv2) extraUV2.push(p.uv2 ? p.uv2[k * 2] : 0, p.uv2 ? p.uv2[k * 2 + 1] : 0);
          }
          fresh.set(key, q);
        }
        idx[(t0 + f) * 3 + j] = q;
      }
    }
  }
  let mesh = { pos, nrm, uv, col, idx, tex, both, info: {}, uv2 };
  if (extraPos.length) {
    const cat = (a, b, T) => { const r = new T(a.length + b.length); r.set(a); r.set(b, a.length); return r; };
    mesh = { ...mesh, pos: cat(pos, extraPos, Float32Array), col: cat(col, extraCol, Uint32Array), nrm: nrm && cat(nrm, extraNrm, Float32Array), uv: cat(uv, extraUV, Float32Array), uv2: uv2 && cat(uv2, extraUV2, Float32Array) };
  }
  if (wrapped) warn.push(`${wrapped} Flächen mit wiederholter Textur wurden in den Atlas geschoben`);
  // Farben: alles weiß ohne Bild → keine Farbspur nötig
  if (!mesh.col.some((c) => c !== 0xffffff) && tex) mesh.col = null;
  if (!mesh.nrm) mesh = computeNormals(mesh, crease);
  if (!echt) mesh = normalizeMesh(mesh, ground);
  const a = json.asset || {};
  mesh.info = { name: mainName.replace(/\.(glb|gltf)$/i, ''), quelle: a.copyright || '', werkzeug: a.generator || '' };
  return { mesh, warn, stats: { dreiecke: nt, punkte: nv, bilder: imgs.length, materialien: (json.materials || []).length } };
}
