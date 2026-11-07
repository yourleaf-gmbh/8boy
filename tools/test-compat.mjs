// Kompatibilität Bild für Bild: jede eingebaute Kartridge läuft mit festem Zufall, fester Uhr und
// fest vorgegebenen Tasten; alle 30 Bilder wird ein Fingerabdruck des Bildspeichers genommen.
//   node tools/test-compat.mjs --golden    Referenz neu aufnehmen (nur mit dem alten, geprüften Stand!)
//   node tools/test-compat.mjs             gegen die Referenz prüfen: 8BOY und 8BOY 16 (8-Bit-Kartridge im Rahmen)
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import fengari from 'fengari';
import { createGfx } from '../js/gfx.js';
import { createInput } from '../js/input.js';
import { createVM } from '../js/vm.js';
import { parseCart } from '../js/carts.js';

const root = path.resolve(import.meta.dirname, '..');
// CARTS=<ordner> GOLDEN=<datei>: Kartridges und Referenz eines anderen Repos (z. B. 8boy-lernspiele)
const CARTS = process.env.CARTS ? path.resolve(process.env.CARTS) : path.join(root, 'carts');
const GOLDEN = process.env.GOLDEN ? path.resolve(process.env.GOLDEN) : path.join(root, 'tools/compat-golden.json');
const FRAMES = 900, EVERY = 30;
const golden = process.argv.includes('--golden');
const only = process.argv.slice(2).filter((a) => !a.startsWith('--'));

// feste Uhr und fester Zufall, damit zwei Läufe dasselbe Bild liefern
let clock = 0;
performance.now = () => clock;
Date.now = () => 1767225600000 + clock;
// Auch new Date() einfrieren: Kartridges wie Dinogotchi zeigen per date() Tag oder Nacht. Sonst hinge das Ergebnis
// von der Uhrzeit des Testlaufs ab. COMPAT_STUNDE verschiebt den Tag zum Nachprüfen alter Referenzen.
{
  const RealDate = Date;
  const off = process.env.COMPAT_STUNDE ? (+process.env.COMPAT_STUNDE - new RealDate(1767225600000).getHours()) * 3600000 : 0;
  globalThis.Date = class extends RealDate {
    constructor(...a) { super(...(a.length ? a : [RealDate.now() + off])); }
    static now() { return RealDate.now(); }
  };
  globalThis.Date.now = RealDate.now;
}
let seed = 1;
Math.random = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };

const audio = { play() {}, stop() {}, sfx() {}, beep() {}, playing: () => false, playpos: () => (clock / 1000) % 2, setMachine() {} };
const machines = await import('../js/machines.js').then((m) => m.MACHINES).catch(() => null);

function runCart(code, id, makeGfx) {
  clock = 0; seed = 1;
  const gfx = makeGfx();
  const input = createInput();
  const store = new Map();
  const vm = createVM({ fengari, gfx, audio, input, storage: { get: (k) => store.get(k) ?? null, set: (k, v) => store.set(k, v) }, machine: machines?.[8] });
  const hashes = [];
  vm.run(code, 'cart');
  let rng = 7;
  let held = [];
  for (let f = 0; f < FRAMES; f++) {
    clock = f * 1000 / 60;
    if (f % 8 === 0) { held = []; for (let i = 0; i < 7; i++) { rng = (rng * 69069 + 1) >>> 0; if ((rng >>> 16) % 4 === 0) held.push(i); } }
    if (f % 300 < 20) held = [4, 6];
    for (let i = 0; i < 8; i++) input.set('key', i, held.includes(i));
    input.tick();
    vm.update(); vm.draw();
    if (f % EVERY === EVERY - 1) hashes.push(crypto.createHash('sha1').update(gfx.fb).update(Uint8Array.from(gfx.palette.flatMap((c) => [c >> 16 & 255, c >> 8 & 255, c & 255]))).digest('hex').slice(0, 12));
  }
  vm.close();
  return hashes;
}

// Grundregal und Store
const files = only.length ? only : process.env.CARTS ? fs.readdirSync(CARTS).filter((f) => f.endsWith('.lua')) : [
  ...JSON.parse(fs.readFileSync(path.join(root, 'carts/index.json'), 'utf8').replace(/^﻿/, '')),
  ...JSON.parse(fs.readFileSync(path.join(root, 'carts/store.json'), 'utf8')).map((e) => e.file),
];
// --golden mit Dateinamen ersetzt nur deren Referenz, der Rest bleibt
const ref = golden && !only.length ? {} : JSON.parse(fs.readFileSync(GOLDEN, 'utf8'));
const variants = golden ? [['8BOY', () => createGfx()]] : [
  ['8BOY', () => createGfx(machines?.[8])],
  // 8BOY 16: die Konsole läuft mit 256x224, die alte Kartridge bekommt ihren 240x160-Bildschirm
  ['8BOY 16', () => { const g = createGfx(machines?.[16]); g.setMode?.(machines?.[8]); return g; }],
];
let fails = 0;
for (const file of files) {
  const code = fs.readFileSync(path.join(CARTS, path.basename(file)), 'utf8');
  if (parseCart(code).system > 8) continue; // neue Kartridges haben keine 8-Bit-Referenz
  for (const [name, make] of variants) {
    let hashes;
    try { hashes = runCart(code, file, make); } catch (e) { fails++; console.log(`FEHL ${name.padEnd(11)} ${file}: ${e.message}`); continue; }
    if (golden) { ref[file] = hashes; console.log(`REF  ${file.padEnd(24)} ${hashes.length} Fingerabdrücke`); continue; }
    const want = ref[file];
    if (!want) { console.log(`---  ${name.padEnd(11)} ${file}: keine Referenz`); continue; }
    const bad = hashes.findIndex((h, i) => h !== want[i]);
    if (bad >= 0) fails++;
    console.log(`${bad < 0 ? 'OK  ' : 'FEHL'} ${name.padEnd(11)} ${file.padEnd(24)} ${bad < 0 ? FRAMES + ' Bilder identisch' : 'weicht ab Bild ' + (bad + 1) * EVERY + ' ab'}`);
  }
}
if (golden) { fs.writeFileSync(GOLDEN, JSON.stringify(ref, null, 0)); console.log('Referenz gespeichert:', path.relative(root, GOLDEN)); }
else console.log(fails ? `${fails} Abweichungen` : 'alle alten Kartridges Bild für Bild identisch');
process.exit(fails ? 1 : 0);
