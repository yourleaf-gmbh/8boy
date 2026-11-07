// Modell-Paket prüfen (ohne Browser): glTF/GLB- und OBJ-Import, Vereinfachung, Binärformat, Entpacker, modelload.
// Alle Testmodelle entstehen hier im Code (keine fremden Dateien im Projekt).   node tools/test-modelle.mjs
import zlib from 'node:zlib';
import fengari from 'fengari';
import { importGLTF } from '../js/gltf-import.js';
import { simplifyMesh } from '../js/mesh-simplify.js';
import {
  packModel, unpackModel, inflate, deflate, toBase64, fromBase64, modelBlockText, modelBlocks, stripModelBlocks, decodeModelBlock,
  meshToChip, quantize, computeNormals,
} from '../js/model-pack.js';
import { parseOBJ, parseMTL, objToMesh, autoDecimals, modelToLua, cleanModel } from '../js/obj-import.js';
import { createGfx } from '../js/gfx.js';
import { createInput } from '../js/input.js';
import { createVM } from '../js/vm.js';
import { MACHINES } from '../js/machines.js';

let fehler = 0;
const ok = (c, label, extra = '') => { if (!c) fehler++; console.log(`${c ? 'OK  ' : 'FEHL'} ${label}${extra ? '  ' + extra : ''}`); };

// ---------------------------------------------------------------- Testmodell: Kugel mit Naht, zwei Materialien, als glTF
function sphere(seg = 32, rings = 16) {
  const pos = [], nrm = [], uv = [], idx = [];
  for (let r = 0; r <= rings; r++) for (let s = 0; s <= seg; s++) {
    const th = Math.PI * r / rings, ph = 2 * Math.PI * s / seg;
    const x = Math.sin(th) * Math.cos(ph), y = Math.cos(th), z = Math.sin(th) * Math.sin(ph);
    pos.push(x, y, z); nrm.push(x, y, z); uv.push(s / seg, r / rings);
  }
  for (let r = 0; r < rings; r++) for (let s = 0; s < seg; s++) {
    const a = r * (seg + 1) + s, b = a + seg + 1;
    // glTF: gegen den Uhrzeigersinn von außen
    if (r > 0) idx.push(a, a + 1, b);
    if (r < rings - 1) idx.push(a + 1, b + 1, b);
  }
  return { pos, nrm, uv, idx };
}
function makeGLTF({ glb = false } = {}) {
  const s = sphere(), cube = { pos: [-1, -1, -1, 1, -1, -1, 1, 1, -1, -1, 1, -1, -1, -1, 1, 1, -1, 1, 1, 1, 1, -1, 1, 1], idx: [0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 2, 3, 7, 2, 7, 6, 1, 2, 6, 1, 6, 5, 0, 4, 7, 0, 7, 3] };
  const chunks = [];
  const add = (arr, T) => { const b = Buffer.from(new T(arr).buffer); const off = chunks.reduce((n, c) => n + c.length, 0); chunks.push(b, Buffer.alloc((4 - b.length % 4) % 4)); return { off, len: b.length }; };
  const v = [add(s.pos, Float32Array), add(s.nrm, Float32Array), add(s.uv, Float32Array), add(s.idx, Uint16Array), add(cube.pos, Float32Array), add(cube.idx, Uint16Array)];
  const bin = Buffer.concat(chunks);
  const json = {
    asset: { version: '2.0', copyright: 'Testmodell 8BOY' },
    scene: 0, scenes: [{ nodes: [0, 1] }],
    nodes: [{ mesh: 0, translation: [0, 2, 0] }, { mesh: 1, scale: [0.5, 0.5, 0.5], translation: [3, 0, 0] }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0, NORMAL: 1, TEXCOORD_0: 2 }, indices: 3, material: 0 }] },
      { primitives: [{ attributes: { POSITION: 4 }, indices: 5, material: 1 }] }],
    materials: [{ pbrMetallicRoughness: { baseColorTexture: { index: 0 } } }, { pbrMetallicRoughness: { baseColorFactor: [1, 0, 0, 1] } }],
    textures: [{ source: 0 }], images: [{ uri: 'bild.png' }],
    accessors: [
      { bufferView: 0, componentType: 5126, count: s.pos.length / 3, type: 'VEC3', min: [-1, -1, -1], max: [1, 1, 1] },
      { bufferView: 1, componentType: 5126, count: s.nrm.length / 3, type: 'VEC3' },
      { bufferView: 2, componentType: 5126, count: s.uv.length / 2, type: 'VEC2' },
      { bufferView: 3, componentType: 5123, count: s.idx.length, type: 'SCALAR' },
      { bufferView: 4, componentType: 5126, count: 8, type: 'VEC3' },
      { bufferView: 5, componentType: 5123, count: cube.idx.length, type: 'SCALAR' },
    ],
    bufferViews: v.map((x) => ({ buffer: 0, byteOffset: x.off, byteLength: x.len })),
    buffers: [{ byteLength: bin.length, ...(glb ? {} : { uri: 'daten.bin' }) }],
  };
  const files = new Map();
  if (glb) {
    const j = Buffer.from(JSON.stringify(json)), jp = Buffer.concat([j, Buffer.alloc((4 - j.length % 4) % 4, 0x20)]);
    const head = Buffer.alloc(12); head.writeUInt32LE(0x46546c67, 0); head.writeUInt32LE(2, 4); head.writeUInt32LE(12 + 8 + jp.length + 8 + bin.length, 8);
    const ch = (type, data) => { const h = Buffer.alloc(8); h.writeUInt32LE(data.length, 0); h.writeUInt32LE(type, 4); return Buffer.concat([h, data]); };
    files.set('test.glb', new Uint8Array(Buffer.concat([head, ch(0x4e4f534a, jp), ch(0x004e4942, bin)])));
  } else {
    files.set('test.gltf', new Uint8Array(Buffer.from(JSON.stringify(json))));
    files.set('daten.bin', new Uint8Array(bin));
  }
  files.set('bild.png', new Uint8Array([1, 2, 3]));
  return { files, sTris: s.idx.length / 3 };
}
// Bild-Leser für den Test: ein 64×32-Schachbrett, egal was in der Datei steht
const decodeImage = async () => {
  const w = 64, h = 32, rgba = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const p = (y * w + x) * 4, on = ((x >> 3) + (y >> 3)) & 1; rgba[p] = on ? 240 : 20; rgba[p + 1] = on ? 200 : 60; rgba[p + 2] = on ? 40 : 160; rgba[p + 3] = 255; }
  return { w, h, rgba };
};

// ---------------------------------------------------------------- 1. glTF / GLB
for (const glb of [false, true]) {
  const { files, sTris } = makeGLTF({ glb });
  const r = await importGLTF(files, { decodeImage, texSize: 256 });
  const m = r.mesh, nt = m.idx.length / 3;
  ok(nt === sTris + 12, `${glb ? 'GLB' : 'glTF + .bin'}: alle Dreiecke da`, `${nt}`);
  ok(m.tex && m.tex.w === 256 && m.tex.h === 256, 'zwei Teile → Atlas mit Weiß für das Teil ohne Bild', m.tex ? `${m.tex.w}×${m.tex.h}` : 'keine Textur');
  ok(m.col && [...m.col].some((c) => c === 0xff0000), 'baseColorFactor wird echte Farbe (Rot)');
  // Größe 1, Mitte 0
  const lo = [9, 9, 9], hi = [-9, -9, -9];
  for (let k = 0; k < m.pos.length; k++) { lo[k % 3] = Math.min(lo[k % 3], m.pos[k]); hi[k % 3] = Math.max(hi[k % 3], m.pos[k]); }
  ok(Math.abs(Math.max(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) - 1) < 1e-4, 'auf Größe 1 gebracht');
  // Normalen zeigen nach außen und passen zum Umlaufsinn (wie gfx3d.prepare: u × w)
  let bad = 0;
  for (let t = 0; t < nt; t++) {
    const [a, b, c] = [m.idx[t * 3], m.idx[t * 3 + 1], m.idx[t * 3 + 2]].map((i) => i * 3), P = m.pos;
    const u = [P[b] - P[a], P[b + 1] - P[a + 1], P[b + 2] - P[a + 2]], w = [P[c] - P[a], P[c + 1] - P[a + 1], P[c + 2] - P[a + 2]];
    const n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
    const vn = [m.nrm[a], m.nrm[a + 1], m.nrm[a + 2]];
    if (n[0] * vn[0] + n[1] * vn[1] + n[2] * vn[2] < 0) bad++;
  }
  ok(bad === 0, 'Umlaufsinn und Normalen passen nach dem Spiegeln', `${bad} falsch`);
  ok(r.mesh.info.quelle === 'Testmodell 8BOY', 'Urheberangabe aus asset.copyright übernommen');
}

// ---------------------------------------------------------------- 2. Vereinfachen
{
  const s = sphere(64, 32);
  const toChip = { pos: new Float32Array(s.pos.length), nrm: Float32Array.from(s.nrm), uv: Float32Array.from(s.uv), col: null, tex: null, idx: new Uint32Array(s.idx.length) };
  for (let k = 0; k < s.pos.length; k += 3) { toChip.pos[k] = s.pos[k]; toChip.pos[k + 1] = s.pos[k + 1]; toChip.pos[k + 2] = -s.pos[k + 2]; }
  for (let k = 0; k < s.idx.length; k += 3) { toChip.idx[k] = s.idx[k]; toChip.idx[k + 1] = s.idx[k + 2]; toChip.idx[k + 2] = s.idx[k + 1]; }
  const n0 = toChip.idx.length / 3;
  const t0 = performance.now(), r = simplifyMesh(toChip, 600), ms = performance.now() - t0;
  const nt = r.idx.length / 3;
  ok(nt <= 600 && nt > 400, `Kugel ${n0} → ${nt} Dreiecke`, `${ms.toFixed(0)} ms`);
  // geschlossen geblieben (über die UV-Naht hinweg): jede Kante gehört zu genau zwei Flächen
  const key = (i) => `${Math.round(r.pos[i * 3] * 1e5)},${Math.round(r.pos[i * 3 + 1] * 1e5)},${Math.round(r.pos[i * 3 + 2] * 1e5)}`;
  const ec = new Map();
  for (let t = 0; t < nt; t++) for (let j = 0; j < 3; j++) {
    const a = key(r.idx[t * 3 + j]), b = key(r.idx[t * 3 + (j + 1) % 3]), k = a < b ? a + '|' + b : b + '|' + a;
    ec.set(k, (ec.get(k) || 0) + 1);
  }
  const open = [...ec.values()].filter((c) => c !== 2).length;
  ok(open === 0, 'keine Löcher, keine Risse an der Naht', `${open} offene Kanten`);
  let maxd = 0;
  for (let i = 0; i < r.pos.length / 3; i++) maxd = Math.max(maxd, Math.abs(Math.hypot(r.pos[i * 3], r.pos[i * 3 + 1], r.pos[i * 3 + 2]) - 1));
  ok(maxd < 1e-5, 'Punkte bleiben auf der Oberfläche (Halbkanten-Kollaps)');
  // Volumen bleibt (Form erhalten)
  let vol = 0;
  for (let t = 0; t < nt; t++) {
    const [a, b, c] = [0, 1, 2].map((j) => r.idx[t * 3 + j] * 3), P = r.pos;
    vol += (P[a] * (P[b + 1] * P[c + 2] - P[b + 2] * P[c + 1]) - P[a + 1] * (P[b] * P[c + 2] - P[b + 2] * P[c]) + P[a + 2] * (P[b] * P[c + 1] - P[b + 1] * P[c])) / 6;
  }
  ok(Math.abs(Math.abs(vol) / (4 / 3 * Math.PI) - 1) < 0.08, 'Volumen fast gleich', `${(Math.abs(vol) / (4 / 3 * Math.PI) * 100).toFixed(1)} %`);
  // offener Rand bleibt: Halbkugel
  const half = { ...toChip, idx: toChip.idx.filter((_, k) => true) };
  const keep = [];
  for (let t = 0; t < n0; t++) if (toChip.pos[toChip.idx[t * 3] * 3 + 1] >= -1e-6 && toChip.pos[toChip.idx[t * 3 + 1] * 3 + 1] >= -1e-6 && toChip.pos[toChip.idx[t * 3 + 2] * 3 + 1] >= -1e-6) keep.push(toChip.idx[t * 3], toChip.idx[t * 3 + 1], toChip.idx[t * 3 + 2]);
  half.idx = Uint32Array.from(keep);
  const h = simplifyMesh(half, 200);
  let rim = 0;
  for (let i = 0; i < h.pos.length / 3; i++) if (Math.abs(h.pos[i * 3 + 1]) < 1e-6) rim++;
  ok(h.idx.length / 3 <= 200 && rim >= 8, 'Halbkugel: Rand bleibt rund (Randpunkte bleiben auf dem Rand)', `${h.idx.length / 3} Dreiecke, ${rim} Randpunkte`);
}

// ---------------------------------------------------------------- 3. Binärformat, Entpacker
{
  const rnd = new Uint8Array(50000);
  for (let i = 0; i < rnd.length; i++) rnd[i] = (i * 7 + (i >> 5) * 13) & 255 ^ (Math.random() < 0.1 ? 255 : 0);
  ok(Buffer.compare(Buffer.from(inflate(zlib.deflateSync(rnd, { level: 9 }))), Buffer.from(rnd)) === 0, 'Entpacker = zlib (dynamische Huffman-Tabellen)');
  ok(Buffer.compare(Buffer.from(inflate(zlib.deflateSync(rnd, { level: 0 }))), Buffer.from(rnd)) === 0, 'Entpacker: ungepackte Blöcke');
  const small = new TextEncoder().encode('hallo hallo hallo 8BOY');
  ok(new TextDecoder().decode(inflate(zlib.deflateSync(small, { strategy: zlib.constants.Z_FIXED }))) === 'hallo hallo hallo 8BOY', 'Entpacker: feste Huffman-Tabellen');
  const b = new Uint8Array([0, 1, 2, 250, 251, 252, 253, 254, 255, 7]);
  ok(Buffer.compare(Buffer.from(fromBase64(toBase64(b))), Buffer.from(b)) === 0 && toBase64(b) === Buffer.from(b).toString('base64'), 'Base64 hin und zurück');

  const { files } = makeGLTF({ glb: true });
  const m = (await importGLTF(files, { decodeImage, texSize: 128 })).mesh;
  const raw = packModel(m), back = unpackModel(raw);
  let pe = 0, ue = 0;
  for (let k = 0; k < m.pos.length; k++) pe = Math.max(pe, Math.abs(m.pos[k] - back.pos[k]));
  for (let k = 0; k < m.uv.length; k++) ue = Math.max(ue, Math.abs(m.uv[k] - back.uv[k]));
  ok(pe < 2e-5, 'Punkte: 16 Bit im Begrenzungsquader', `max. Abweichung ${pe.toExponential(1)}`);
  ok(ue < 2e-5, 'UVs: 16 Bit', `max. Abweichung ${ue.toExponential(1)}`);
  ok([...back.idx].every((v, i) => v === m.idx[i]) && (!m.col || [...back.col].every((v, i) => v === m.col[i])), 'Flächen und Farben exakt');
  let ne = 0;
  for (let k = 0; k < m.nrm.length; k += 3) ne = Math.max(ne, 1 - (m.nrm[k] * back.nrm[k] + m.nrm[k + 1] * back.nrm[k + 1] + m.nrm[k + 2] * back.nrm[k + 2]));
  ok(ne < 2e-3, 'Normalen oktaedrisch in 2 Bytes', `Winkelfehler ${(Math.acos(1 - ne) * 180 / Math.PI).toFixed(2)}°`);
  ok(back.tex && back.tex.w === m.tex.w, 'Textur mit Farbtabelle zurück', `${back.tex.w}×${back.tex.h}`);
  // 8BOY 128: zweite UV-Ebene (Lightmap) hinten angehängt – alte Modelle bleiben gleich
  const uv2 = Float32Array.from(m.uv, (v, i) => (i % 2 ? 1 - v : v * 0.5));
  const back2 = unpackModel(packModel({ ...m, uv2 }));
  let u2e = 0;
  for (let k = 0; k < uv2.length; k++) u2e = Math.max(u2e, Math.abs(uv2[k] - back2.uv2[k]));
  ok(u2e < 2e-5 && back.uv2 === null && [...back2.idx].every((v, i) => v === m.idx[i]), 'Lightmap-UVs (zweite Ebene) hin und zurück', `max. Abweichung ${u2e.toExponential(1)}`);
  const q = quantize(m.tex.rgba, m.tex.w, m.tex.h);
  ok(q.count <= 256, 'Farbtabelle höchstens 256 Farben', `${q.count}`);
  const z = await deflate(raw), block = modelBlockText('kugel', z);
  const code = `-- title: Test\nlocal x = 1\n${block}print(x)\n`;
  const stripped = stripModelBlocks(code);
  ok(stripped.split('\n').length === code.split('\n').length && !stripped.includes('8boy-modell') && stripped.includes('print(x)'), 'Lua sieht den Block nicht, Zeilennummern bleiben');
  const d = decodeModelBlock(modelBlocks(code).get('kugel'));
  ok(d.idx.length === m.idx.length, 'Block entpacken', `${(block.length / 1024).toFixed(1)} KB Text für ${m.idx.length / 3} Dreiecke`);
  const chip = meshToChip(d);
  ok(chip.f.length === m.idx.length / 3 && chip.f.every((f) => f.c >= 0 && f.c < 32) && chip.img, 'Chip-Modell: Ersatzfarben aus der Palette, Textur dabei');
}

// ---------------------------------------------------------------- 4. OBJ mit echten Farben, UVs, Normalen; Runden
{
  const obj = parseOBJ(`mtllib a.mtl
v 0 0 0
v 1 0 0
v 1 1 0
v 0 1 0
vt 0 0
vt 1 0
vt 1 1
vt 0 1
vn 0 0 1
usemtl rot
f 1/1/1 2/2/1 3/3/1
usemtl bild
f 1/1/1 3/3/1 4/4/1
`);
  const mtl = parseMTL('newmtl rot\nKd 1 0 0\nnewmtl bild\nKd 1 1 1\nmap_Kd holz.png\n');
  ok(mtl.maps?.get('bild') === 'holz.png', 'MTL: map_Kd gelesen');
  const img = await decodeImage();
  const m = objToMesh(obj, { colors: mtl, image: img });
  ok(m.idx.length === 6 && m.uv && m.tex === img && [...m.col].includes(0xff0000) && [...m.col].includes(0xffffff), 'OBJ: echte Farbe Rot, Textur-Fläche weiß, UVs');
  ok(m.nrm && Math.abs(m.nrm[2] + 1) < 1e-6, 'OBJ: Normalen aus der Datei (z gespiegelt)');
  const flat = computeNormals({ ...m, nrm: null }, 40);
  ok(flat.nrm.length === flat.pos.length, 'Normalen mit Knickwinkel berechnet');
  // Runden: 2 Nachkommastellen nur, wenn nichts zusammenfällt
  const pts = [], fs = [];
  for (let i = 0; i < 30; i++) for (let j = 0; j < 30; j++) pts.push(i / 29 * 0.2, j / 29 * 0.2, 0);   // sehr dichtes Gitter (Abstand < 0,01)
  for (let i = 0; i < 29; i++) for (let j = 0; j < 29; j++) { const a = i * 30 + j; fs.push({ i: [a, a + 1, a + 30], c: 7 }, { i: [a + 1, a + 31, a + 30], c: 7 }); }
  const dense = { v: pts, f: fs };
  ok(autoDecimals(dense) === 3, 'dichtes Modell: 3 Nachkommastellen (sonst fallen Punkte zusammen)');
  const lua = modelToLua(0, dense);
  ok(lua.tris === cleanModel(dense, 4).f.length, 'kein Dreieck geht beim Runden verloren', `${lua.tris}`);
}

// ---------------------------------------------------------------- 5. modelload und Punktfarben in der Konsole (Software-Chip)
{
  const { files } = makeGLTF({ glb: true });
  const m = (await importGLTF(files, { decodeImage, texSize: 128 })).mesh;
  const block = modelBlockText('kugel', await deflate(packModel(simplifyMesh(m, 300))));
  for (const id of [32, 64]) {
    const machine = MACHINES[id];
    const gfx = createGfx(machine);
    const logs = [];
    const vm = createVM({ fengari, gfx, audio: { play() {}, stop() {}, sfx() {}, beep() {}, playing: () => false, playpos: () => 0 }, input: createInput(), storage: { get: () => null, set() {} }, onLog: (x) => logs.push(x), machine });
    let err = null;
    try {
      vm.run(`-- system: ${id}\nn = modelload(1, "kugel")\nmodel(2, {0,0,0, 1,0,0, 0,1,0}, {1,2,3,8}, false, false, {0xff0000, 0x00ff00, 0x0000ff})\nfunction _draw() cls3d(1) cam3d(0,0,-3) draw3d(1, 0,0,0, t()) draw3d(2) end\n${block}`, 'cart');
      for (let i = 0; i < 5; i++) { vm.update(); vm.draw(); }
    } catch (e) { err = e; }
    ok(!err, `${machine.name}: modelload und model(…, farben) laufen`, err ? err.message : '');
    let miss = null;
    try { vm.run('modelload(0, "gibtsnicht")', 'cart'); } catch (e) { miss = e; }
    ok(miss && /kein Modell "gibtsnicht"/.test(miss.message), `${machine.name}: verständlicher Fehler bei fehlendem Modell`, miss?.message || '');
    vm.close();
  }
}

console.log(fehler ? `${fehler} Prüfungen fehlgeschlagen` : 'alle Modell-Prüfungen bestanden');
process.exit(fehler ? 1 : 0);
