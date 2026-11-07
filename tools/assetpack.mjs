// Asset-Paket bauen (8BOY 128):
//   node tools/assetpack.mjs <quellordner> [paketname] [--intern]
//
// Aus dem Quellordner wird
//   assets/<paket>/manifest.json + <sha256-16>.<endung>   (für den Server-Stream; mit --intern NICHT, nur die .8bpak)
//   pakete/<paket>.8bpak                                  (ZIP mit allem: offline, zum Verschicken)
//
// Steuerdatei <quellordner>/paket.json (optional):
//   { "paket": "giga-demo", "version": 1, "standard": { "vorab": true, "lizenz": "CC0", "quelle": "…" },
//     "assets": { "jetski": { "datei": "jetski.glb", "dreiecke": 6000, "textur": 512 }, "musik": { "datei": "titel.ogg", "vorab": false } } }
// Ohne Steuerdatei wird jede Datei ein Asset (Name = Dateiname ohne Endung).
// Umwandlung: .glb/.gltf → Konsolen-Modell (.b8m, wie im Studio), Bilder/Ton/Daten bleiben, wie sie sind.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { importGLTF } from '../js/gltf-import.js';
import { simplifyMesh } from '../js/mesh-simplify.js';
import { packModel, unpackModel } from '../js/model-pack.js';
import { decodeImage } from './png-lesen.mjs';
import { importSkinGLB, packSkin } from '../js/skin.js';

const root = path.resolve(import.meta.dirname, '..');
// 8BOY 128: Texturen eines GLB unverändert herauslösen (Farbe, Normal-Map, Rauheit/Metall des ersten Materials)
function glbBilder(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (dv.getUint32(0, true) !== 0x46546c67) return {};
  let o = 12, json = null, bin = null;
  while (o < bytes.length) {
    const len = dv.getUint32(o, true), typ = dv.getUint32(o + 4, true);
    if (typ === 0x4e4f534a) json = JSON.parse(new TextDecoder().decode(bytes.subarray(o + 8, o + 8 + len)));
    else if (typ === 0x004e4942) bin = bytes.subarray(o + 8, o + 8 + len);
    o += 8 + len;
  }
  const mat = json?.materials?.[0];
  if (!mat || !bin) return {};
  const holen = (texInfo) => {
    const t = texInfo && json.textures?.[texInfo.index], im = t && json.images?.[t.source];
    if (!im || im.bufferView === undefined) return null;
    const bv = json.bufferViews[im.bufferView];
    return { bytes: bin.slice(bv.byteOffset || 0, (bv.byteOffset || 0) + bv.byteLength), ext: im.mimeType === 'image/jpeg' ? 'jpg' : 'png' };
  };
  return { farbe: holen(mat.pbrMetallicRoughness?.baseColorTexture), normal: holen(mat.normalTexture), rm: holen(mat.pbrMetallicRoughness?.metallicRoughnessTexture) };
}

const args = process.argv.slice(2);
const intern = args.includes('--intern');
const [quelle, nameArg] = args.filter((a) => !a.startsWith('--'));
if (!quelle) { console.error('Aufruf: node tools/assetpack.mjs <quellordner> [paketname] [--intern]'); process.exit(1); }
const src = path.resolve(quelle);
const steuer = fs.existsSync(path.join(src, 'paket.json')) ? JSON.parse(fs.readFileSync(path.join(src, 'paket.json'), 'utf8')) : {};
const paket = nameArg || steuer.paket || path.basename(src).toLowerCase();
if (!/^[a-z0-9][a-z0-9-]{0,47}$/.test(paket)) throw new Error(`ungültiger Paketname „${paket}“ (a–z, 0–9, Bindestrich)`);

const TYPEN = { b8s: 'figur', b8m: 'modell', glb: 'modell', gltf: 'modell', png: 'bild', jpg: 'bild', jpeg: 'bild', webp: 'bild', ogg: 'ton', mp3: 'ton', wav: 'ton', opus: 'ton', json: 'daten', txt: 'daten', bin: 'daten' };
const GEPACKT = new Set(['png', 'jpg', 'jpeg', 'webp', 'ogg', 'mp3', 'opus']);   // ZIP: nicht nochmal packen

let liste = steuer.assets;
if (!liste) {
  liste = {};
  for (const f of fs.readdirSync(src).sort()) {
    const ext = path.extname(f).slice(1).toLowerCase();
    if (f === 'paket.json' || !TYPEN[ext] || ext === 'bin') continue;
    liste[path.basename(f, path.extname(f)).toLowerCase().replace(/[^a-z0-9_.-]/g, '-')] = { datei: f };
  }
}

const dateien = new Map();   // Hash-Name → Bytes
const manifest = { paket, version: steuer.version || 1, gebaut: new Date().toISOString().slice(0, 10), assets: {} };
let summe = 0;
for (const [name, def] of Object.entries(liste)) {
  const a = { ...(steuer.standard || {}), ...def };
  const datei = path.join(src, a.datei);
  if (!fs.existsSync(datei)) throw new Error(`Asset „${name}“: ${a.datei} fehlt`);
  let ext = path.extname(datei).slice(1).toLowerCase();
  let bytes = new Uint8Array(fs.readFileSync(datei));
  let info = '';
  if (ext === 'glb' && a.figur) {
    // Figur mit Skelett und Animationen (8BOY 128)
    const fig = importSkinGLB(bytes);
    bytes = packSkin(fig);
    ext = 'b8s';
    info = `${fig.idx.length / 3} Dreiecke, ${fig.skel.namen.length} Knochen, Animationen: ${fig.clips.map((c) => c.name).join(', ')}`;
  } else if (ext === 'glb' || ext === 'gltf') {
    // glTF mit .bin und Bildern aus demselben Ordner
    const files = new Map([[path.basename(datei), bytes]]);
    for (const f of fs.readdirSync(path.dirname(datei))) if (/\.(bin|png|jpe?g)$/i.test(f)) files.set(f, new Uint8Array(fs.readFileSync(path.join(path.dirname(datei), f))));
    const r = await importGLTF(files, { decodeImage, texSize: a.textur || 512, ground: !!a.boden, echt: !!a.echt });
    let mesh = r.mesh;
    const nt = mesh.idx.length / 3;
    if (a.dreiecke && nt > a.dreiecke) mesh = simplifyMesh(mesh, a.dreiecke);
    mesh.info = { ...(mesh.info || {}), name, quelle: a.quelle || a.datei, lizenz: a.lizenz || '' };
    // 8BOY 128: Texturen als eigene Bilder in echten Farben (statt 256-Farben-Textur im Modell); UVs bleiben
    if (a.giga && ext === 'glb') {
      const bilder = glbBilder(bytes);
      if (bilder.farbe || bilder.normal || bilder.rm) {
        mesh.tex = null;
        for (const [rolle, b] of Object.entries(bilder)) {
          if (!b) continue;
          const h = crypto.createHash('sha256').update(b.bytes).digest('hex').slice(0, 16);
          dateien.set(`${h}.${b.ext}`, b.bytes);
          manifest.assets[`${name}.${rolle}`] = { datei: `${h}.${b.ext}`, typ: 'bild', groesse: b.bytes.length, vorab: a.vorab, lizenz: a.lizenz, quelle: a.quelle || a.datei };
          summe += b.bytes.length;
          console.log(`  ${(name + '.' + rolle).padEnd(20)} bild    ${(b.bytes.length / 1024).toFixed(1).padStart(8)} KB  aus ${a.datei}`);
        }
      }
    }
    bytes = packModel(mesh);
    ext = 'b8m';
    info = `${mesh.idx.length / 3} Dreiecke${r.warn?.length ? ' · ' + r.warn.join('; ') : ''}`;
  }
  const hash = crypto.createHash('sha256').update(bytes).digest('hex').slice(0, 16);
  const hn = `${hash}.${ext}`;
  dateien.set(hn, bytes);
  const eintrag = { datei: hn, typ: TYPEN[ext] || 'daten', groesse: bytes.length };
  for (const k of ['vorab', 'lizenz', 'quelle', 'titel']) if (a[k] !== undefined) eintrag[k] = a[k];
  manifest.assets[name] = eintrag;
  summe += bytes.length;
  console.log(`  ${name.padEnd(20)} ${eintrag.typ.padEnd(7)} ${(bytes.length / 1024).toFixed(1).padStart(8)} KB  ${info}`);
  // 8BOY 128, große Welten: Detailstufen ("lod": [0.3, 0.08] = Anteil der Dreiecke, oder feste Zahlen) als name.lod1, name.lod2 …
  if (a.lod && ext === 'b8m') {
    const basis = unpackModel(bytes), nt = basis.idx.length / 3;
    a.lod.forEach((k, i) => {
      const lm = simplifyMesh(basis, Math.max(12, Math.round(k < 1 ? nt * k : k)));
      lm.info = basis.info;
      const lb = packModel(lm), lh = crypto.createHash('sha256').update(lb).digest('hex').slice(0, 16);
      dateien.set(`${lh}.b8m`, lb);
      const le = { datei: `${lh}.b8m`, typ: 'modell', groesse: lb.length };
      for (const kk of ['vorab', 'lizenz', 'quelle']) if (a[kk] !== undefined) le[kk] = a[kk];
      manifest.assets[`${name}.lod${i + 1}`] = le;
      summe += lb.length;
      console.log(`  ${(name + '.lod' + (i + 1)).padEnd(20)} modell  ${(lb.length / 1024).toFixed(1).padStart(8)} KB  ${lm.idx.length / 3} Dreiecke`);
    });
  }
}
const mtext = JSON.stringify(manifest, null, 1) + '\n';

// Server-Ordner (nicht bei internen Paketen)
if (!intern) {
  const ziel = path.join(root, 'assets', paket);
  fs.mkdirSync(ziel, { recursive: true });
  for (const f of fs.readdirSync(ziel)) if (!dateien.has(f) && f !== 'manifest.json') fs.rmSync(path.join(ziel, f));
  for (const [n, b] of dateien) if (!fs.existsSync(path.join(ziel, n))) fs.writeFileSync(path.join(ziel, n), b);
  fs.writeFileSync(path.join(ziel, 'manifest.json'), mtext);
}

// .8bpak = ZIP (Manifest zuerst, bereits gepackte Formate „gespeichert“, der Rest „deflate“)
const crcT = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = (b) => { let c = 0xffffffff; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const teile = [], zentral = [];
let ofs = 0;
for (const [name, roh] of [['manifest.json', new TextEncoder().encode(mtext)], ...dateien]) {
  const ext = name.split('.').pop();
  const pack = !GEPACKT.has(ext);
  const daten = pack ? zlib.deflateRawSync(roh, { level: 9 }) : roh;
  const nb = Buffer.from(name, 'utf8');
  const crc = crc32(roh);
  const lh = Buffer.alloc(30);
  lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x0800, 6); lh.writeUInt16LE(pack ? 8 : 0, 8);
  lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(daten.length, 18); lh.writeUInt32LE(roh.length, 22); lh.writeUInt16LE(nb.length, 26);
  const ch = Buffer.alloc(46);
  ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0x0800, 8); ch.writeUInt16LE(pack ? 8 : 0, 10);
  ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(daten.length, 20); ch.writeUInt32LE(roh.length, 24); ch.writeUInt16LE(nb.length, 28); ch.writeUInt32LE(ofs, 42);
  teile.push(lh, nb, Buffer.from(daten));
  zentral.push(ch, nb);
  ofs += 30 + nb.length + daten.length;
}
const cd = Buffer.concat(zentral);
const ende = Buffer.alloc(22);
ende.writeUInt32LE(0x06054b50, 0); ende.writeUInt16LE(dateien.size + 1, 8); ende.writeUInt16LE(dateien.size + 1, 10);
ende.writeUInt32LE(cd.length, 12); ende.writeUInt32LE(ofs, 16);
fs.mkdirSync(path.join(root, 'pakete'), { recursive: true });
const pak = path.join(root, 'pakete', paket + '.8bpak');
fs.writeFileSync(pak, Buffer.concat([...teile, cd, ende]));
console.log(`Paket „${paket}“ v${manifest.version}: ${Object.keys(manifest.assets).length} Assets, ${(summe / 1024).toFixed(0)} KB` +
  (intern ? ' · INTERN: nur ' : ` · assets/${paket}/ und `) + path.relative(root, pak) + ` (${(fs.statSync(pak).size / 1024).toFixed(0)} KB)`);
