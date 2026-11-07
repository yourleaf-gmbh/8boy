// 8BOY 128 Welt-Paket (Meilenstein 5): eine Insel aus 4×4 Kacheln zum Streamen, mit Rundstrecke, dazu Baum, Fels und Buggy
//   node tools/giga/welt_paket.mjs  →  tools/giga/welt-paket/ (danach: node tools/assetpack.mjs tools/giga/welt-paket)
// Alles aus Formeln gebaut (CC0): Höhen aus Wertrauschen (fBm), Insel-Maske, Strecke als geschlossene Kurve mit Kuppe.
// Maße in Metern, y oben; Kacheln je 64 m mit 1-m-Raster, Normalen aus der ganzen Insel (keine Nähte).
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { packModel, computeNormals } from '../../js/model-pack.js';

// Die Bauteile (Rauschen, Baum, Fels, Quader …) nutzt auch tools/giga/stadt_paket.mjs; gebaut wird nur beim direkten Aufruf
const ziel = path.resolve(import.meta.dirname, 'welt-paket');
export const KACHEL = 64, N = 4, HALB = (KACHEL * N) / 2;

// ---------------------------------------------------------------- Rauschen
export const hash = (x, z) => { let h = (x * 374761393 + z * 668265263) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
const glatt = (t) => t * t * (3 - 2 * t);
export function wert(x, z) {
  const xi = Math.floor(x), zi = Math.floor(z), fx = glatt(x - xi), fz = glatt(z - zi);
  const a = hash(xi, zi), b = hash(xi + 1, zi), c = hash(xi, zi + 1), d = hash(xi + 1, zi + 1);
  return (a + (b - a) * fx + (c - a) * fz + (a - b - c + d) * fx * fz) * 2 - 1;
}
export const fbm = (x, z, o = 5) => { let s = 0, a = 0.5, f = 1; for (let i = 0; i < o; i++) { s += wert(x * f + i * 17.3, z * f - i * 9.1) * a; a *= 0.5; f *= 2.03; } return s; };
export const sst = (a, b, t) => { const k = Math.min(1, Math.max(0, (t - a) / (b - a))); return k * k * (3 - 2 * k); };

// ---------------------------------------------------------------- Strecke: geschlossene Kurve r(θ), Höhe h(θ), Kuppe bei θ = 1.2
export const streckeR = (t) => 72 + 10 * Math.sin(3 * t) + 6 * Math.cos(2 * t + 1);
const winkelAb = (t, z) => { const d = (((t - z) % (2 * Math.PI)) + 3 * Math.PI) % (2 * Math.PI) - Math.PI; return d; };
const streckeH = (t) => 3.2 + 2.2 * Math.sin(2 * t) + 1.2 * Math.sin(5 * t + 0.7) + 1.8 * Math.exp(-((winkelAb(t, 1.2) / 0.06) ** 2));
function hoehe(x, z) {
  const r = Math.hypot(x, z) / 118;
  const maske = sst(1.0, 0.6, r);
  let h = (fbm(x / 70, z / 70) * 15 + fbm(x / 22, z / 22, 3) * 2.5 + 6) * maske - (1 - maske) * 7;
  h += Math.max(0, 1 - Math.hypot(x - 30, z + 20) / 38) ** 2 * 26 * maske;   // ein Berg
  const t = Math.atan2(z, x), dr = Math.abs(Math.hypot(x, z) - streckeR(t));
  const w = sst(15, 5, dr);
  return { h: h * (1 - w) + streckeH(t) * w, strasse: sst(5, 3.2, dr), rand: sst(6.5, 4.5, dr) - sst(5, 3.2, dr) };
}
const H = (x, z) => hoehe(x, z).h;

export const mix = (a, b, t) => {
  const r = (a >> 16 & 255) + ((b >> 16 & 255) - (a >> 16 & 255)) * t, g = (a >> 8 & 255) + ((b >> 8 & 255) - (a >> 8 & 255)) * t, bl = (a & 255) + ((b & 255) - (a & 255)) * t;
  return (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(bl);
};
function farbe(x, z, h, ny, s) {
  const n = fbm(x / 9, z / 9, 3) * 0.5 + 0.5;
  let c = mix(0x3f6a22, 0x76902f, n);                       // Gras
  c = mix(c, 0xd0bd8f, sst(1.6, 0.6, h));                   // Sand am Wasser
  c = mix(c, 0x6e695f, sst(0.82, 0.68, ny));                // Fels an steilen Hängen
  c = mix(c, 0xe9edf0, sst(19, 22, h) * sst(0.7, 0.85, ny)); // Schnee oben
  c = mix(c, 0x6b5a45, s.rand * 0.6);                       // Bankett
  c = mix(c, mix(0x8a6c4a, 0x7a5d3e, n), s.strasse);         // Schotterstraße
  return c;
}

function kachel(cx, cz) {
  const x0 = -HALB + cx * KACHEL, z0 = -HALB + cz * KACHEL, R = KACHEL + 1;
  const pos = new Float32Array(R * R * 3), nrm = new Float32Array(R * R * 3), col = new Uint32Array(R * R);
  for (let j = 0; j < R; j++) for (let i = 0; i < R; i++) {
    const x = x0 + i, z = z0 + j, s = hoehe(x, z), k = j * R + i;
    pos[k * 3] = x; pos[k * 3 + 1] = s.h; pos[k * 3 + 2] = z;
    const e = 0.5, dx = (H(x + e, z) - H(x - e, z)) / (2 * e), dz = (H(x, z + e) - H(x, z - e)) / (2 * e), l = Math.hypot(dx, 1, dz);
    nrm[k * 3] = -dx / l; nrm[k * 3 + 1] = 1 / l; nrm[k * 3 + 2] = -dz / l;
    col[k] = farbe(x, z, s.h, 1 / l, s);
  }
  const idx = new Uint32Array(KACHEL * KACHEL * 6);
  let o = 0;
  for (let j = 0; j < KACHEL; j++) for (let i = 0; i < KACHEL; i++) {
    const a = j * R + i, b = a + 1, c = a + R, d = c + 1;
    idx[o++] = a; idx[o++] = c; idx[o++] = b;   // (b-a)×(c-a) zeigt nach oben = Vorderseite
    idx[o++] = b; idx[o++] = c; idx[o++] = d;
  }
  return { pos, nrm, uv: null, col, idx, tex: null, both: false, info: { name: `insel-${cx}-${cz}`, quelle: 'tools/giga/welt_paket.mjs' } };
}

// ---------------------------------------------------------------- kleine Bauteile (Umlaufsinn: Normale zeigt von der Teilmitte weg)
export function teile() {
  const pos = [], col = [], idx = [], gleich = new Map();
  // gleiche Ecke (Lage und Farbe) nur einmal – sonst kann die Vereinfachung (LOD) nichts zusammenlegen
  const ecke = (p, c) => {
    const k = `${Math.round(p[0] * 1e4)},${Math.round(p[1] * 1e4)},${Math.round(p[2] * 1e4)},${c}`;
    let i = gleich.get(k);
    if (i === undefined) { i = pos.length / 3; gleich.set(k, i); pos.push(p[0], p[1], p[2]); col.push(c); }
    return i;
  };
  const dreieck = (a, b, c, farbeJe, mitte) => {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], wx = c[0] - a[0], wy = c[1] - a[1], wz = c[2] - a[2];
    const nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
    const mx = (a[0] + b[0] + c[0]) / 3 - mitte[0], my = (a[1] + b[1] + c[1]) / 3 - mitte[1], mz = (a[2] + b[2] + c[2]) / 3 - mitte[2];
    const pts = nx * mx + ny * my + nz * mz >= 0 ? [a, b, c] : [a, c, b];
    for (const p of pts) idx.push(ecke(p, farbeJe(p)));
  };
  return { pos, col, idx, dreieck };
}
export const fertig = (t, name, grad = 35) => computeNormals({ pos: Float32Array.from(t.pos), nrm: null, uv: null, col: Uint32Array.from(t.col), idx: Uint32Array.from(t.idx), tex: null, both: false, info: { name, quelle: 'tools/giga/welt_paket.mjs' } }, grad);
// Ring-Körper um die y-Achse: Ringe [{ y, r }], seiten Teilung; Mitte je Höhe auf der Achse
export function drehkoerper(t, ringe, seiten, farbeJe, verzerr = () => 1, achse = 'y', versatz = [0, 0, 0]) {
  const P = (y, r, k) => {
    const a = (k / seiten) * Math.PI * 2, rr = r * verzerr(a, y);
    const p = [Math.cos(a) * rr, y, Math.sin(a) * rr];
    const q = achse === 'x' ? [p[1], p[0], p[2]] : achse === 'z' ? [p[0], p[2], p[1]] : p;
    return [q[0] + versatz[0], q[1] + versatz[1], q[2] + versatz[2]];
  };
  const mitteBei = (y) => { const q = achse === 'x' ? [y, 0, 0] : achse === 'z' ? [0, 0, y] : [0, y, 0]; return [q[0] + versatz[0], q[1] + versatz[1], q[2] + versatz[2]]; };
  for (let i = 0; i + 1 < ringe.length; i++) for (let k = 0; k < seiten; k++) {
    const A = ringe[i], B = ringe[i + 1];
    const m = mitteBei((A.y + B.y) / 2);
    const a = P(A.y, A.r, k), b = P(A.y, A.r, k + 1), c = P(B.y, B.r, k), d = P(B.y, B.r, k + 1);
    if (A.r > 1e-4) t.dreieck(a, b, c, (p) => farbeJe(p, i, k), m);
    if (B.r > 1e-4) t.dreieck(b, d, c, (p) => farbeJe(p, i, k), m);
  }
  // Deckel unten und oben
  for (const [R, inner] of [[ringe[0], 1], [ringe[ringe.length - 1], -1]]) {
    if (R.r < 1e-4) continue;
    const m = mitteBei(R.y), mm = mitteBei(R.y + inner * 0.5);
    for (let k = 0; k < seiten; k++) t.dreieck(m, P(R.y, R.r, k), P(R.y, R.r, k + 1), (p) => farbeJe(p, -1, k), mm);
  }
}
export function quader(t, c, s, farbeJe) {
  const ecke = (i) => [c[0] + (i & 1 ? 1 : -1) * s[0] / 2, c[1] + (i & 2 ? 1 : -1) * s[1] / 2, c[2] + (i & 4 ? 1 : -1) * s[2] / 2];
  for (const [a, b, d, e] of [[0, 1, 3, 2], [4, 5, 7, 6], [0, 1, 5, 4], [2, 3, 7, 6], [0, 2, 6, 4], [1, 3, 7, 5]]) {
    t.dreieck(ecke(a), ecke(b), ecke(d), farbeJe, c); t.dreieck(ecke(a), ecke(d), ecke(e), farbeJe, c);
  }
}

export function baum() {
  const t = teile();
  drehkoerper(t, [{ y: 0, r: 0.32 }, { y: 2.4, r: 0.22 }, { y: 9.5, r: 0.04 }], 12, () => 0x5a3c22);
  const stufen = [[1.6, 2.6, 2.4], [3.4, 2.1, 2.2], [5.0, 1.6, 2.0], [6.5, 1.05, 1.8], [7.8, 0.6, 1.5]];
  stufen.forEach(([y, r, h], s) => {
    const ringe = [{ y, r }, { y: y + h * 0.18, r: r * 0.92 }, { y: y + h * 0.5, r: r * 0.55 }, { y: y + h, r: 0 }];
    drehkoerper(t, ringe, 28, (p, i) => mix(0x1f4a24, 0x3f7a35, Math.min(1, Math.max(0, (p[1] - y) / h * 0.6 + hash(s, 3) * 0.3 + (i < 0 ? -0.3 : 0)))),
      (a, yy) => 1 + 0.18 * Math.sin(a * 7 + s * 2) + 0.08 * wert(a * 3 + s * 5, yy * 2));
  });
  return fertig(t, 'baum', 50);
}
export function fels(teilungen = 3) {
  // Ikosaeder, dreimal geteilt, mit Rauschen verbeult
  const g = (1 + Math.sqrt(5)) / 2;
  let v = [[-1, g, 0], [1, g, 0], [-1, -g, 0], [1, -g, 0], [0, -1, g], [0, 1, g], [0, -1, -g], [0, 1, -g], [g, 0, -1], [g, 0, 1], [-g, 0, -1], [-g, 0, 1]].map((p) => { const l = Math.hypot(...p); return p.map((x) => x / l); });
  let f = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8], [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
  for (let s = 0; s < teilungen; s++) {
    const mitte = new Map(), nf = [];
    const m = (a, b) => { const k = a < b ? `${a},${b}` : `${b},${a}`; if (!mitte.has(k)) { const p = v[a].map((x, i) => (x + v[b][i]) / 2), l = Math.hypot(...p); mitte.set(k, v.push(p.map((x) => x / l)) - 1); } return mitte.get(k); };
    for (const [a, b, c] of f) { const ab = m(a, b), bc = m(b, c), ca = m(c, a); nf.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]); }
    f = nf;
  }
  const t = teile();
  const P = v.map(([x, y, z]) => { const k = 1 + 0.28 * fbm(x * 1.7 + 3, z * 1.7 + y * 1.3, 4); return [x * k * 1.6, Math.max(-0.35, y * k * 1.0), z * k * 1.3]; });
  for (const [a, b, c] of f) t.dreieck(P[a], P[b], P[c], (p) => mix(0x5d5a54, 0x8f8a80, Math.min(1, Math.max(0, 0.5 + fbm(p[0] * 2, p[2] * 2 + p[1], 3)))), [0, 0.2, 0]);
  return fertig(t, 'fels', 30);
}
// ganz fern: ein Kegel als Krone, wenige Dreiecke
export function baumFern() {
  const t = teile();
  drehkoerper(t, [{ y: 0, r: 0.3 }, { y: 2, r: 0.2 }], 5, () => 0x5a3c22);
  drehkoerper(t, [{ y: 1.6, r: 2.5 }, { y: 9.3, r: 0 }], 8, (p) => mix(0x1f4a24, 0x3f7a35, p[1] / 12));
  return fertig(t, 'baum', 50);
}
// Buggy: Blick +z, Ursprung = Aufhängung (Radmitten etwa 0.16 m tiefer); Räder einzeln (Modell „rad“)
function buggy() {
  const t = teile(), lack = () => 0xff6a14, rahmen = () => 0x2a2d33, sitz = () => 0x1a1a1e, chrom = () => 0xc8ccd2;
  quader(t, [0, 0.02, 0], [1.25, 0.26, 2.9], rahmen);                 // Bodenwanne
  quader(t, [0, 0.24, 0.95], [1.2, 0.22, 0.9], lack);                 // Haube vorn
  quader(t, [0, 0.18, 1.5], [1.35, 0.14, 0.22], chrom);               // Stoßfänger
  quader(t, [0, 0.3, -1.05], [1.3, 0.3, 0.75], lack);                 // Motorhaube hinten
  quader(t, [0, 0.42, -0.15], [0.6, 0.12, 0.6], sitz);                // Sitz
  quader(t, [0, 0.78, -0.42], [0.6, 0.62, 0.12], sitz);               // Lehne
  for (const s of [-1, 1]) {
    quader(t, [s * 0.58, 1.02, -0.45], [0.08, 1.15, 0.08], rahmen);   // Überrollbügel
    quader(t, [s * 0.58, 1.55, 0.1], [0.08, 0.08, 1.1], rahmen);
    quader(t, [s * 0.55, 1.0, 0.6], [0.08, 1.1, 0.08], rahmen);
    quader(t, [s * 0.66, 0.28, 0.0], [0.1, 0.2, 1.2], lack);          // Seitenschweller
    quader(t, [s * 0.35, 0.36, -1.5], [0.12, 0.12, 0.18], chrom);     // Auspuff
  }
  quader(t, [0, 1.55, -0.45], [1.24, 0.08, 0.08], rahmen);
  quader(t, [0, 1.55, 0.6], [1.18, 0.08, 0.08], rahmen);
  return fertig(t, 'buggy', 30);
}
export function rad() {
  const t = teile(), r = 0.38, b = 0.3;
  // Reifen um die x-Achse: Profil hell/dunkel im Wechsel, damit man das Drehen sieht
  drehkoerper(t, [{ y: -b / 2, r: r * 0.62 }, { y: -b / 2, r: r * 0.92 }, { y: -b * 0.42, r }, { y: b * 0.42, r }, { y: b / 2, r: r * 0.92 }, { y: b / 2, r: r * 0.62 }], 20,
    (p, i, k) => (i === 2 ? (k % 2 ? 0x1c1c1c : 0x343434) : i === -1 ? 0xb8bcc4 : 0x222222), () => 1, 'x');
  drehkoerper(t, [{ y: -b * 0.3, r: r * 0.62 }, { y: -b * 0.3, r: 0.001 }], 10, () => 0xb8bcc4, () => 1, 'x');
  return fertig(t, 'rad', 35);
}

// ---------------------------------------------------------------- schreiben (nur beim direkten Aufruf)
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
fs.mkdirSync(ziel, { recursive: true });
const schreibe = (name, mesh) => { const b = packModel(mesh); fs.writeFileSync(path.join(ziel, `${name}.b8m`), b); return { name, dreiecke: mesh.idx.length / 3, kb: b.length / 1024 }; };
const start = { t: -Math.PI / 2 };
start.x = Math.cos(start.t) * streckeR(start.t); start.z = Math.sin(start.t) * streckeR(start.t);
const assets = {};
for (let cz = 0; cz < N; cz++) for (let cx = 0; cx < N; cx++) {
  const name = `insel-${cx}-${cz}`, mx = -HALB + (cx + 0.5) * KACHEL, mz = -HALB + (cz + 0.5) * KACHEL;
  const r = schreibe(name, kachel(cx, cz));
  // vorab nur, was um den Start liegt – der Rest kommt beim Fahren (Stream)
  assets[name] = { datei: `${name}.b8m`, vorab: Math.hypot(mx - start.x, mz - start.z) < 80 };
  console.log(`  ${name}  ${r.dreiecke} Dreiecke  ${r.kb.toFixed(0)} KB  ${assets[name].vorab ? 'vorab' : 'Stream'}`);
}
// Detailstufe 1 vereinfacht assetpack („lod“), Stufe 2 ist von Hand gebaut (Dateien name.lod2)
for (const [name, fn, lod] of [['baum', baum, [0.3]], ['fels', fels, [0.3]], ['buggy', buggy, null], ['rad', rad, null], ['baum.lod2', baumFern, null], ['fels.lod2', () => fels(1), null]]) {
  const r = schreibe(name, fn());
  assets[name] = { datei: `${name}.b8m`, ...(lod ? { lod } : {}) };
  console.log(`  ${name}  ${r.dreiecke} Dreiecke  ${r.kb.toFixed(1)} KB`);
}
fs.writeFileSync(path.join(ziel, 'paket.json'), JSON.stringify({
  paket: 'giga-welt', version: 1,
  standard: { vorab: true, lizenz: 'CC0', quelle: 'YOURLEAF, gebaut mit tools/giga/welt_paket.mjs' },
  assets,
}, null, 1) + '\n');
console.log(`Start: x ${start.x.toFixed(1)}, z ${start.z.toFixed(1)}, Höhe ${H(start.x, start.z).toFixed(1)}`);
}
