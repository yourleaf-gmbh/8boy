// Lässt jede Kartridge ohne Browser laufen: Laden, _init, dann einige tausend Bilder mit
// zufälligen Tasten. Meldet Lua-Fehler mit Zeilennummer. Aufruf: npm test [datei.lua ...]
import fs from 'node:fs';
import path from 'node:path';
import fengari from 'fengari';
import { createGfx } from '../js/gfx.js';
import { createInput } from '../js/input.js';
import { createVM } from '../js/vm.js';
import { parseMML, SFX } from '../js/audio.js';
import { parseCart } from '../js/carts.js';
import { machineFor } from '../js/machines.js';
import { createAssets } from '../js/assets.js';

// CARTS=<ordner>: alle Kartridges eines anderen Ordners prüfen (z. B. ../8boy-lernspiele/carts)
const dir = process.env.CARTS ? path.resolve(process.env.CARTS) : path.resolve(import.meta.dirname, '../carts');
// Grundregal und Store
const files = process.argv.slice(2).length ? process.argv.slice(2) : process.env.CARTS ? fs.readdirSync(dir).filter((f) => f.endsWith('.lua')) : [
  ...JSON.parse(fs.readFileSync(path.join(dir, 'index.json'), 'utf8').replace(/^\uFEFF/, '')),
  ...JSON.parse(fs.readFileSync(path.join(dir, 'store.json'), 'utf8')).map((e) => e.file),
];
const FRAMES = 3600;

let mmlCount = 0;
const audio = {
  play(mml) { parseMML(mml, true); mmlCount++; }, stop() {}, sfx(n) { parseMML(SFX[n] ?? n); }, beep() {}, playing() { return false; }, playpos() { return (performance.now() / 1000) % 2; },
};

let failed = 0;
for (const file of files) {
  const code = fs.readFileSync(path.join(dir, path.basename(file)), 'utf8');
  const cart = parseCart(code, { id: file });
  const machine = machineFor(cart.system);
  const gfx = createGfx(machine);
  const input = createInput();
  const store = new Map();
  const logs = [];
  // Asset-Pakete (-- assets: …) direkt aus assets/ auf der Platte
  let assets = null;
  if (cart.assets?.length) {
    assets = createAssets({ basis: path.join(dir, '../assets') + '/', holen: (u) => Promise.resolve(fs.existsSync(u) ? new Response(fs.readFileSync(u)) : new Response('', { status: 404 })), lokal: null, cache: null });
    await assets.vorbereiten(cart.assets);
  }
  const vm = createVM({ fengari, gfx, audio, input, storage: { get: (k) => store.get(k) ?? null, set: (k, v) => store.set(k, v) }, onLog: (m) => logs.push(m), machine, assets });
  const t0 = performance.now();
  let frame = 0, worst = 0;
  try {
    vm.run(code, 'cart');
    // Zufällige, aber "menschliche" Eingaben: Tasten werden ein paar Bilder lang gehalten
    let held = [];
    for (frame = 0; frame < FRAMES; frame++) {
      if (frame % 8 === 0) held = [0, 1, 2, 3, 4, 5, 6, ...(machine.buttons > 8 ? [8, 9, 10, 11] : [])].filter(() => Math.random() < 0.25);
      if (frame % 300 < 20) held = [4, 6]; // regelmäßig A/START, damit Menüs verlassen werden
      for (let i = 0; i < machine.buttons; i++) input.set('key', i, held.includes(i));
      input.tick();
      const f0 = performance.now();
      vm.update(); vm.draw();
      worst = Math.max(worst, performance.now() - f0);
    }
    const ms = (performance.now() - t0) / FRAMES;
    console.log(`OK   ${file.padEnd(28)} "${cart.title}"  avg ${ms.toFixed(2)} ms/Bild, max ${worst.toFixed(1)} ms${logs.length ? '  log: ' + logs.slice(-2).join(' | ') : ''}`);
  } catch (e) {
    failed++;
    console.log(`FAIL ${file} (Bild ${frame}): ${e.line ? 'Zeile ' + e.line + ': ' : ''}${e.message}\n${e.trace || e.stack}`);
  }
  vm.close();
}
if (!files.length) console.log('keine Kartridges');
process.exit(failed ? 1 : 0);
