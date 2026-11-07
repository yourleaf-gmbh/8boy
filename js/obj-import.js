// 3D-Werkstatt: Wavefront-OBJ (und .mtl) lesen, auf den 8BOY 32 umrechnen, vereinfachen und als Lua ausgeben.
// Reine Rechenfunktionen ohne Bildschirm – lassen sich auch in Node prüfen.
//
// Umrechnung: OBJ ist rechtshändig (x rechts, y oben, z zum Betrachter, Dreiecke gegen den Uhrzeigersinn).
// Der 8BOY 32 ist linkshändig (z zeigt vom Betrachter weg, Dreiecke im Uhrzeigersinn von außen gesehen).
// Darum wird z gespiegelt und jedes Dreieck andersherum durchlaufen – das Modell sieht danach genauso aus
// wie im 3D-Programm, und seine Vorderseite (OBJ: +z) schaut zur Kamera des 8BOY 32 (die entlang +z blickt).
import { DEFAULT_PALETTE } from './gfx.js';
import { normalizeMesh, computeNormals } from './model-pack.js';

// ------------------------------------------------------------------ Farben
// nächste Farbe der 8BOY-Palette (0–31), Abstand nach "redmean" – passt besser zum Auge als reines RGB
export function nearestColor(r, g, b) {
  let best = 7, bd = Infinity;
  DEFAULT_PALETTE.forEach((c, i) => {
    const R = c >> 16 & 255, G = c >> 8 & 255, B = c & 255;
    const rm = (r + R) / 2, dr = r - R, dg = g - G, db = b - B;
    const d = (2 + rm / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rm) / 256) * db * db;
    if (d < bd) { bd = d; best = i; }
  });
  return best;
}

// .mtl: Materialname -> [r, g, b] (0–255) aus "Kd"
export function parseMTL(text) {
  const out = new Map();
  let cur = null;
  for (const raw of String(text).split(/\r?\n/)) {
    const l = raw.trim();
    if (!l || l[0] === '#') continue;
    const [k, ...a] = l.split(/\s+/);
    if (k === 'newmtl') { cur = a.join(' '); if (!out.has(cur)) out.set(cur, [200, 200, 200]); }
    else if (k === 'map_Kd' && cur !== null) { if (!out.maps) out.maps = new Map(); out.maps.set(cur, a[a.length - 1]); }
    else if (k === 'Kd' && cur !== null) {
      const v = a.slice(0, 3).map(Number);
      if (v.length === 3 && v.every(Number.isFinite)) out.set(cur, v.map((x) => Math.max(0, Math.min(255, Math.round(x * 255)))));
    }
  }
  return out;
}

// ------------------------------------------------------------------ OBJ lesen
// Ergebnis in OBJ-Koordinaten: pos [x,y,z,…], tris [a,b,c,…] (ab 0), mat je Dreieck (Index in mats), vcol je Punkt (oder null)
export function parseOBJ(text) {
  const pos = [], vcol = [], tris = [], mat = [], mats = [], libs = [], vt = [], vn = [], tvt = [], tvn = [];
  let curMat = -1, hasVcol = false, polys = 0, skipped = 0;
  const lines = String(text).replace(/\\\r?\n/g, ' ').split(/\r?\n/);
  for (const raw of lines) {
    const l = raw.trim();
    if (!l || l[0] === '#') continue;
    const parts = l.split(/\s+/);
    const k = parts[0];
    if (k === 'v') {
      const x = +parts[1], y = +parts[2], z = +parts[3];
      if (![x, y, z].every(Number.isFinite)) { pos.push(0, 0, 0); vcol.push(null); continue; }
      pos.push(x, y, z);
      // manche Programme hängen Punktfarben an: v x y z r g b
      if (parts.length >= 7) {
        const c = parts.slice(4, 7).map(Number);
        if (c.every(Number.isFinite)) { const s = c.some((q) => q > 1) ? 1 : 255; vcol.push(c.map((q) => Math.max(0, Math.min(255, q * s)))); hasVcol = true; continue; }
      }
      vcol.push(null);
    } else if (k === 'vt') vt.push(+parts[1] || 0, +parts[2] || 0);
    else if (k === 'vn') vn.push(+parts[1] || 0, +parts[2] || 0, +parts[3] || 0);
    else if (k === 'f' || k === 'fo') {
      const nv = pos.length / 3, nt = vt.length / 2, nn = vn.length / 3;
      const idx = [], ti = [], ni = [];
      const ref = (s, n) => { let i = parseInt(s, 10); if (!Number.isFinite(i) || i === 0) return -1; i = i < 0 ? n + i : i - 1; return i >= 0 && i < n ? i : -1; };
      for (const t of parts.slice(1)) {
        const s = t.split('/');
        const i = ref(s[0], nv);                    // negative Nummern zählen vom letzten Punkt rückwärts
        if (i < 0) continue;
        idx.push(i); ti.push(s[1] ? ref(s[1], nt) : -1); ni.push(s[2] ? ref(s[2], nn) : -1);
      }
      if (idx.length < 3) { skipped++; continue; }
      if (idx.length > 3) polys++;
      // Vielecke als Fächer in Dreiecke zerlegen
      for (let j = 1; j < idx.length - 1; j++) {
        tris.push(idx[0], idx[j], idx[j + 1]); mat.push(curMat);
        tvt.push(ti[0], ti[j], ti[j + 1]); tvn.push(ni[0], ni[j], ni[j + 1]);
      }
    } else if (k === 'usemtl') {
      const name = parts.slice(1).join(' ');
      curMat = mats.indexOf(name);
      if (curMat < 0) { mats.push(name); curMat = mats.length - 1; }
    } else if (k === 'mtllib') libs.push(parts.slice(1).join(' '));
  }
  return { pos, tris, mat, mats, libs, vcol: hasVcol ? vcol : null, polys, skipped, vt, vn, tvt, tvn };
}

// ------------------------------------------------------------------ in ein 8BOY-32-Modell umrechnen
// Modell: { v: [x,y,z,…], f: [{ i: [a,b,c], c: farbe }, …] } in 8BOY-32-Koordinaten
// opts: colors (Map aus parseMTL), useMtl, color (Ersatzfarbe), turns ([[achse, viertel], …]), ground
export function objToModel(obj, { colors = new Map(), useMtl = true, color = 7, turns = [], ground = false } = {}) {
  const v = [];
  for (let k = 0; k < obj.pos.length; k += 3) v.push(obj.pos[k], obj.pos[k + 1], -obj.pos[k + 2]);   // z spiegeln
  const matColor = obj.mats.map((name) => (colors.has(name) ? nearestColor(...colors.get(name)) : null));
  const f = [];
  for (let t = 0, n = 0; t < obj.tris.length; t += 3, n++) {
    const a = obj.tris[t], b = obj.tris[t + 1], c = obj.tris[t + 2];
    let col = color;
    if (useMtl) {
      const m = obj.mat[n];
      if (m >= 0 && matColor[m] !== null) col = matColor[m];
      else if (obj.vcol) {
        const cs = [a, b, c].map((p) => obj.vcol[p]).filter(Boolean);
        if (cs.length) col = nearestColor(...[0, 1, 2].map((j) => cs.reduce((s, q) => s + q[j], 0) / cs.length));
      }
    }
    f.push({ i: [a, c, b], c: col });                // Umlaufsinn umdrehen
  }
  let m = { v, f };
  for (const [axis, q] of turns) m = turnModel(m, axis, q);
  return cleanModel(normalizeModel(m, ground));
}

// Vierteldrehung um eine Achse (eine echte Drehung, der Umlaufsinn bleibt richtig)
export function turnModel(m, axis, quarters = 1) {
  const v = m.v.slice();
  for (let q = 0; q < ((quarters % 4) + 4) % 4; q++) {
    for (let k = 0; k < v.length; k += 3) {
      const x = v[k], y = v[k + 1], z = v[k + 2];
      if (axis === 'x') { v[k + 1] = -z; v[k + 2] = y; }
      else if (axis === 'y') { v[k] = z; v[k + 2] = -x; }
      else { v[k] = -y; v[k + 1] = x; }
    }
  }
  return { v, f: m.f };
}

export function bounds(v) {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let k = 0; k < v.length; k += 3) for (let a = 0; a < 3; a++) { lo[a] = Math.min(lo[a], v[k + a]); hi[a] = Math.max(hi[a], v[k + a]); }
  if (!v.length) return { lo: [0, 0, 0], hi: [0, 0, 0] };
  return { lo, hi };
}

// Mitte auf 0, größte Ausdehnung = 1 (wie die fertigen Formen). ground: Unterseite auf y = 0 stellen
export function normalizeModel(m, ground = false) {
  // nur benutzte Punkte zählen (manche Dateien enthalten lose Punkte)
  const used = new Uint8Array(m.v.length / 3);
  m.f.forEach(({ i }) => i.forEach((p) => { used[p] = 1; }));
  const uv = [];
  for (let p = 0; p < used.length; p++) if (used[p]) uv.push(m.v[p * 3], m.v[p * 3 + 1], m.v[p * 3 + 2]);
  const { lo, hi } = bounds(uv);
  const size = Math.max(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) || 1;
  const c = [(lo[0] + hi[0]) / 2, ground ? lo[1] : (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2];
  const v = m.v.map((x, k) => (x - c[k % 3]) / size);
  return { v, f: m.f };
}

// doppelte Punkte zusammenfassen, lose Punkte, entartete und doppelte Dreiecke entfernen
export function cleanModel(m, decimals = 5) {
  const k = 10 ** decimals;
  const q = m.v.map((x) => Math.round(x * k) / k);
  const v = [], idOf = new Map(), cache = new Int32Array(q.length / 3).fill(-1), seen = new Set(), f = [];
  // neue Nummern nur für Punkte, die eine Fläche braucht – lose Punkte fallen so weg
  const id = (p) => {
    if (cache[p] >= 0) return cache[p];
    const s = q[p * 3] + ',' + q[p * 3 + 1] + ',' + q[p * 3 + 2];
    let n = idOf.get(s);
    if (n === undefined) { n = v.length / 3; idOf.set(s, n); v.push(q[p * 3], q[p * 3 + 1], q[p * 3 + 2]); }
    return (cache[p] = n);
  };
  for (const face of m.f) {
    const [a, b, c] = face.i.map(id);
    if (a === b || b === c || a === c) continue;
    // Fläche null (alle Punkte auf einer Linie)?
    const ux = v[b * 3] - v[a * 3], uy = v[b * 3 + 1] - v[a * 3 + 1], uz = v[b * 3 + 2] - v[a * 3 + 2];
    const wx = v[c * 3] - v[a * 3], wy = v[c * 3 + 1] - v[a * 3 + 1], wz = v[c * 3 + 2] - v[a * 3 + 2];
    if (Math.hypot(uy * wz - uz * wy, uz * wx - ux * wz, ux * wy - uy * wx) < 1e-9) continue;
    // gleiche Fläche zweimal (gleicher Umlauf) nur einmal
    const r = a < b && a < c ? [a, b, c] : b < c ? [b, c, a] : [c, a, b];
    const s = r.join(',');
    if (seen.has(s)) continue;
    seen.add(s);
    f.push({ i: [a, b, c], c: face.c });
  }
  return { v, f };
}

// ------------------------------------------------------------------ vereinfachen
// Ecken auf ein Raster einrasten (alle Punkte einer Zelle werden zu ihrem Mittelpunkt), dann aufräumen.
// Die Rastergröße wird gesucht, bis höchstens "target" Dreiecke übrig sind.
export function clusterModel(m, cell) {
  const n = m.v.length / 3, cells = new Map(), rep = new Int32Array(n), sums = [];
  for (let p = 0; p < n; p++) {
    const s = Math.floor(m.v[p * 3] / cell) + ',' + Math.floor(m.v[p * 3 + 1] / cell) + ',' + Math.floor(m.v[p * 3 + 2] / cell);
    let c = cells.get(s);
    if (c === undefined) { c = sums.length; cells.set(s, c); sums.push([0, 0, 0, 0]); }
    const q = sums[c];
    q[0] += m.v[p * 3]; q[1] += m.v[p * 3 + 1]; q[2] += m.v[p * 3 + 2]; q[3]++;
    rep[p] = c;
  }
  const v = [];
  for (const q of sums) v.push(q[0] / q[3], q[1] / q[3], q[2] / q[3]);
  return cleanModel({ v, f: m.f.map((f) => ({ i: f.i.map((p) => rep[p]), c: f.c })) });
}
export function simplifyModel(m, target) {
  if (m.f.length <= target) return m;
  let lo = 1e-4, hi = 0.5, best = clusterModel(m, hi);
  for (let it = 0; it < 22; it++) {
    const mid = Math.sqrt(lo * hi);
    const r = clusterModel(m, mid);
    if (r.f.length <= target) { best = r; hi = mid; } else lo = mid;
    if (hi / lo < 1.02) break;
  }
  return best;
}

// ------------------------------------------------------------------ Lua schreiben
export const fmtNum = (x, d = 3) => {
  const s = (+x.toFixed(d)).toString();
  return s === '-0' ? '0' : s;
};

// model(n, {punkte}, {flaechen}[, glatt]) – kompakt, Zahlen auf 2–3 Nachkommastellen
// Nachkommastellen: 2 sind kürzer, aber nur, wenn dabei keine Punkte zusammenfallen (sonst Dellen und Löcher)
export function autoDecimals(m) {
  if (m.v.length / 3 <= 400) return 3;
  const ref = cleanModel(m, 4), r2 = cleanModel({ v: m.v.map((x) => +x.toFixed(2)), f: m.f }, 3);
  return r2.f.length < ref.f.length || r2.v.length < ref.v.length ? 3 : 2;
}
export function modelToLua(n, m, { smooth = false, both = false, decimals, note = '' } = {}) {
  const d = decimals ?? autoDecimals(m);
  // nach dem Runden noch einmal zusammenfassen (Punkte können zusammenfallen)
  const r = cleanModel({ v: m.v.map((x) => +x.toFixed(d)), f: m.f }, d + 1);
  const pts = [], fs = [];
  for (let k = 0; k < r.v.length; k += 3) pts.push(`${fmtNum(r.v[k], d)},${fmtNum(r.v[k + 1], d)},${fmtNum(r.v[k + 2], d)}`);
  for (const f of r.f) fs.push(`${f.i[0] + 1},${f.i[1] + 1},${f.i[2] + 1},${f.c}`);
  const rows = (items, per) => {
    const out = [];
    for (let k = 0; k < items.length; k += per) out.push('  ' + items.slice(k, k + per).join(', ') + ',');
    return out.join('\n');
  };
  const extra = both ? `, ${smooth ? 'true' : 'false'}, true` : smooth ? ', true' : '';
  const head = `-- Modell ${n}${note ? ': ' + note : ''} (${r.v.length / 3} Punkte, ${r.f.length} Dreiecke)\n` +
    '-- Punkte: je x, y, z · Flächen: je drei Punktnummern und eine Farbe\n';
  return { code: `${head}model(${n}, {\n${rows(pts, 4)}\n}, {\n${rows(fs, 6)}\n}${extra})\n`, points: r.v.length / 3, tris: r.f.length };
}

// ------------------------------------------------------------------ Netz für den 8BOY 64 (js/model-pack.js)
// Echte Farben (Kd bzw. Punktfarben), UVs und Normalen aus der Datei, Textur aus map_Kd (das erste Bild, das vorkommt).
// image: das gelesene Bild ({ w, h, rgba }) zu colors.maps oder null. Ohne Normalen: aus den Flächen mit Knickwinkel.
export function objToMesh(obj, { colors = new Map(), image = null, turns = [], ground = false, crease = 40 } = {}) {
  const nt = obj.tris.length / 3;
  const texMat = image && colors.maps ? obj.mats.findIndex((nm) => colors.maps.has(nm)) : -1;
  const useUV = texMat >= 0 && obj.tvt?.some((i) => i >= 0);
  const rgb = (c) => (Math.round(c[0]) << 16) | (Math.round(c[1]) << 8) | Math.round(c[2]);
  const matRGB = obj.mats.map((nm) => (colors.has(nm) ? rgb(colors.get(nm)) : null));
  const keyOf = new Map(), pos = [], nrm = [], uv = [], col = [], idx = new Uint32Array(nt * 3);
  const hasN = obj.tvn?.length && obj.tvn.every((i) => i >= 0);
  for (let t = 0; t < nt; t++) {
    const m = obj.mat[t], textured = useUV && colors.maps?.has(obj.mats[m]);
    // OBJ zeigt Kd bei Texturen als Tönung – bei texturierten Flächen bleibt die Eckfarbe weiß
    for (let j = 0; j < 3; j++) {
      const corner = t * 3 + [0, 2, 1][j];                     // Umlaufsinn umdrehen
      const p = obj.tris[corner], ti = useUV ? obj.tvt[corner] : -1, ni = hasN ? obj.tvn[corner] : -1;
      let c = 0xc8c8c8;
      if (textured) c = 0xffffff;
      else if (m >= 0 && matRGB[m] !== null) c = matRGB[m];
      else if (obj.vcol?.[p]) c = rgb(obj.vcol[p]);
      const key = `${p}|${ti}|${ni}|${c}`;
      let q = keyOf.get(key);
      if (q === undefined) {
        q = pos.length / 3; keyOf.set(key, q);
        pos.push(obj.pos[p * 3], obj.pos[p * 3 + 1], -obj.pos[p * 3 + 2]);        // z spiegeln
        if (hasN) nrm.push(obj.vn[ni * 3], obj.vn[ni * 3 + 1], -obj.vn[ni * 3 + 2]);
        // OBJ: v = 0 unten im Bild, die Konsole liest Bilder von oben
        if (useUV) uv.push(ti >= 0 ? obj.vt[ti * 2] : 0.5, ti >= 0 ? 1 - obj.vt[ti * 2 + 1] : 0.5);
        col.push(c);
      }
      idx[t * 3 + j] = q;
    }
  }
  let mesh = {
    pos: Float32Array.from(pos), nrm: hasN ? Float32Array.from(nrm) : null, uv: useUV ? Float32Array.from(uv) : null,
    col: Uint32Array.from(col), idx, tex: useUV ? image : null, both: false, info: {},
  };
  if (!mesh.nrm) mesh = computeNormals(mesh, crease);
  for (const [axis, q] of turns) mesh = turnMeshObj(mesh, axis, q);
  return normalizeMesh(mesh, ground);
}
function turnMeshObj(mesh, axis, quarters) {
  const turn = (src) => {
    const v = Float32Array.from(src);
    for (let q = 0; q < ((quarters % 4) + 4) % 4; q++) for (let k = 0; k < v.length; k += 3) {
      const x = v[k], y = v[k + 1], z = v[k + 2];
      if (axis === 'x') { v[k + 1] = -z; v[k + 2] = y; } else if (axis === 'y') { v[k] = z; v[k + 2] = -x; } else { v[k] = -y; v[k + 1] = x; }
    }
    return v;
  };
  return { ...mesh, pos: turn(mesh.pos), nrm: mesh.nrm && turn(mesh.nrm) };
}
