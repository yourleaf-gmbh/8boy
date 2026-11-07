// 8BOY 64 testen: Grafikchip auf der Grafikkarte (WebGL2).  node tools/test-gpu.mjs [--nobrowser]
//   1. Logik (Node): Konsole 64 im Datenblatt, Schacht-Regeln, Kopfzeile, Lua-Befehle nur auf dem 8BOY 64,
//      Ersatz-Chip ohne Grafikkarte (Tests, Studio-Vorschau), Lektionen und Spiel laufen ohne Fehler
//   2. Browser (Playwright, headless Chromium mit SwiftShader; braucht tools/serve.mjs auf :8080):
//      WebGL2 da, Start ohne Fehler, Bildvergleich GPU gegen Software-Chip (mit Toleranz), Grenze 64.000 Dreiecke,
//      Fehlersuch-Ansichten, PS1-Look, Mipmaps, Meldung ohne WebGL2, MEGA-Kartridge im Rahmen, Lektionen/Spiel,
//      Zeit je Bild und Bilder in TV (1920×1080), Desktop und Handy quer
import fs from 'node:fs';
import path from 'node:path';
import fengari from 'fengari';
import { createGfx } from '../js/gfx.js';
import { createInput } from '../js/input.js';
import { createVM } from '../js/vm.js';
import { machineFor, fits, MACHINES } from '../js/machines.js';
import { parseCart } from '../js/carts.js';
import { parseMML, SFX } from '../js/audio.js';

const root = path.resolve(import.meta.dirname, '..');
// Lektionen liegen im Repo 8boy-lernspiele (Nachbarordner oder LERNSPIELE=<ordner mit den .lua>)
const LERN = process.env.LERNSPIELE ? path.resolve(process.env.LERNSPIELE) : path.join(root, '../8boy-lernspiele/carts');
const BASE = process.env.BASE || 'http://localhost:8080/';
const OUT = process.env.SHOTS || path.join(root, 'shots', 'gpu');
fs.mkdirSync(OUT, { recursive: true });
let fails = 0;
const ok = (c, name, info = '') => { if (!c) fails++; console.log(`${c ? 'OK  ' : 'FEHL'} ${name}${info ? ' · ' + info : ''}`); };
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)] ?? 0; };
const p95 = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length * 0.95)] ?? 0; };
const audio = { play(m) { parseMML(m, true); }, stop() {}, sfx(n) { parseMML(SFX[n] ?? n); }, beep() {}, playing: () => false, playpos: () => 0 };

// Vergleichs-Szene: flache Flächen ohne Textur und Nebel – hier müssen GPU und Software-Chip (fast) gleich aussehen
const SZENE = `-- title: GPU-Vergleich
-- system: 64
model(0, "wuerfel", 12)
model(1, "pyramide", 10)
model(2, "ebene", 3)
model(3, "wuerfel", 8)
function _draw()
  cls(0)
  cls3d(0x223366, 0x8899bb)
  cam3d(0, 2.2, -6, 0.15, -0.25, 60)
  light3d(-0.4, -0.8, 0.5, 0.3)
  draw3d(2, 0, -1, 4, 0, 0, 0, 14)
  draw3d(0, -2, 0, 3, 0.6, 0.3, 0, 1.4)
  draw3d(1, 1.5, 0, 4, 0.4, 0, 0, 2)
  draw3d(3, 3.5, 0.5, 7, 0.9, 0, 0.2, { 1, 3, 1 })
  view3d()
  rectfill(8, 8, 120, 20, 1)
  print("ULTRA", 14, 12, 7, 2)
end
`;

// ------------------------------------------------------------------ 1. Logik
{
  const m = machineFor(64);
  ok(m.name === '8BOY 64' && m.w === 640 && m.h === 360 && m.gpu && m.maxTris === 64000 && m.lamps === 8, 'Datenblatt 8BOY 64', `${m.w}×${m.h}, ${m.maxTris} Dreiecke, ${m.lamps} Lampen`);
  ok(fits(32, 64) && fits(8, 64) && !fits(64, 32), 'Schacht: ältere Kartridges passen, ULTRA-Kartridges nicht in ältere Konsolen');
  ok(parseCart('-- system: 64\n').system === 64 && parseCart('-- system: 99\n').system === 64 && parseCart('-- system: 32\n').system === 32, 'Kopfzeile -- system: 64');
  ok(Object.keys(MACHINES).join() === '8,16,32,64,128', 'fünf Konsolen (8BOY 128 in Arbeit)');
}
function runVM(code, frames, machineId) {
  const machine = machineFor(machineId), gfx = createGfx(machine), input = createInput(), st = new Map(), logs = [];
  const vm = createVM({ fengari, gfx, audio, input, storage: { get: (k) => st.get(k) ?? null, set: (k, v) => st.set(k, v) }, onLog: (s) => logs.push(s), machine });
  vm.run(code, 'cart');
  for (let f = 0; f < frames; f++) { input.tick(); vm.update(); vm.draw(); }
  return { vm, gfx, logs };
}
{
  const { logs } = runVM('-- system: 64\nlog(type(lamp3d), type(filter3d), type(debug3d), type(retro3d), type(stats3d), gpu())\nlamp3d(0, 1, 2, 3, 0xff0000, 5) filter3d("mip") retro3d(true) debug3d("draht")\nlocal a, d, g = stats3d() log(a, d, g)', 1, 64);
  ok(/^function\s+function\s+function\s+function\s+function\s+false$/.test(logs[0] || ''), 'Lua-Befehle auf dem 8BOY 64 (Ersatz-Chip ohne GPU)', logs[0]);
  ok(/^0\s+0\s+false$/.test(logs[1] || ''), 'stats3d() ohne Grafikkarte', logs[1]);
  const { logs: l2 } = runVM('-- system: 32\nlog(type(lamp3d), type(stats3d))', 1, 32);
  ok(/^nil\s+nil$/.test(l2[0] || ''), '8BOY 32 kennt die GPU-Befehle nicht', l2[0]);
  // Ersatz-Chip: zählt Aufrufe und Dreiecke wie die GPU
  const { gfx } = runVM(SZENE.replace('view3d()', 'log(stats3d())'), 2, 64);
  const st = gfx.g3.stats3d();
  // der Software-Chip zählt nur Dreiecke, die er wirklich malt (Rückseiten fallen weg), die GPU alle übergebenen
  ok(st.calls === 4 && st.tris > 0, 'Ersatz-Chip zählt Aufrufe und Dreiecke', `${st.calls} Aufrufe, ${st.tris} sichtbare Dreiecke`);
}
// Geteilter Bildschirm: sky3d malt Himmel nur im Ausschnitt von view3d und beginnt kein neues Bild
const SPLIT = `-- system: 64
model(0, "wuerfel", 12)
function _draw()
  cls(0)
  cls3d(0x000000)
  view3d(0, 0, 640, 179) sky3d(0xff0000, 0xff0000) cam3d(0, 1, -5, 0, 0, 40) draw3d(0, 0, 1, 0)
  view3d(0, 181, 640, 179) sky3d(0x0000ff, 0x0000ff) cam3d(0, 1, -5, 0, 0, 40) draw3d(0, 0, 1, 0)
  view3d()
end
`;
{
  const { logs } = runVM('-- system: 32\nlog(type(sky3d))', 1, 32);
  ok(logs[0] === 'function', 'sky3d auf dem 8BOY 32 (Software-Chip)', logs[0]);
  const { gfx } = runVM(SPLIT, 2, 64);
  const out = new Uint32Array(640 * 360);
  gfx.present(out);
  const rgb = (x, y) => out[y * 640 + x] & 0xffffff;   // ABGR: Rot liegt unten
  ok(rgb(5, 5) === 0x0000ff && rgb(5, 300) === 0xff0000 && rgb(5, 180) === 0, 'sky3d: Himmel je Ausschnitt (Ersatz-Chip)', [rgb(5, 5), rgb(5, 300), rgb(5, 180)].map((c) => c.toString(16)).join(' '));
  ok(gfx.g3.stats3d().calls === 2, 'sky3d beginnt kein neues Bild: Zähler über beide Ansichten', `${gfx.g3.stats3d().calls} Aufrufe`);
}
// Stufe 2 (Effekte): Befehle nur auf dem 8BOY 64, ohne Grafikkarte verstanden; Instanzlisten zeichnet der Ersatz-Chip einzeln
const FX_NAMES = 'post3d memit mshine madd mshadow mwater caustic3d shadow3d sun3d hfog3d part3d emit3d parts3d inst3d drawi3d fx3d'.split(' ');
{
  const { logs } = runVM(`-- system: 64
local n = 0 for _, f in ipairs({${FX_NAMES.map((n) => `"${n}"`).join(',')}}) do if type(_G[f]) == "function" then n = n + 1 end end log(n)
model(0, "wuerfel", 8) memit(0, 2) mshine(0, 1, 30) madd(0, false) mshadow(0, false) mwater(0, false) caustic3d(0, 1) caustic3d()
shadow3d(true, 20) sun3d(0xffffff) hfog3d(1, 0.1) post3d("gluehen", 1) post3d("toenung", 0x2060ff, 0.5) post3d("aus")
part3d(0, { farbe = 8, form = "funke", leben = 2 }) emit3d(0, 0, 0, 0, 50) parts3d()
log(inst3d(0, { 0, 0, 0, 0, 1, 2, 0, 0, 0, 1, 4, 0, 0, 0, 1 }), fx3d())
function _draw() cls3d(0) cam3d(0, 1, -6) drawi3d(0, 0) local a, d, g, p = stats3d() log(a, p) end`, 2, 64);
  ok(logs[0] === String(FX_NAMES.length), `Effekt-Befehle auf dem 8BOY 64 (${FX_NAMES.length})`, logs[0]);
  ok(/^3\s+0$/.test(logs[1] || ''), 'Ersatz-Chip: inst3d zählt Plätze, fx3d() = 0', logs[1]);
  ok(/^3\s+0$/.test(logs[3] || logs[2] || ''), 'Ersatz-Chip: drawi3d zeichnet jede Instanz einzeln', logs[3] || logs[2]);
  const { logs: l2 } = runVM('-- system: 32\nlog(type(post3d), type(part3d), type(inst3d))', 1, 32);
  ok(/^nil\s+nil\s+nil$/.test(l2[0] || ''), '8BOY 32 kennt die Effekt-Befehle nicht', l2[0]);
  const { logs: l3 } = runVM('-- system: 64\nlog(pcall(post3d, "blubb"))', 1, 64);
  ok(/false.*unbekannter Effekt/.test(l3[0] || ''), 'post3d: unbekannter Effekt gibt eine verständliche Meldung', l3[0]);
}
for (const f of ['u1-gpu-modelle.lua', 'u2-tiefe-filter.lua', 'u3-effekte.lua']) {
  const code = fs.readFileSync(path.join(LERN, f), 'utf8');
  let err = '';
  try {
    const machine = machineFor(64), gfx = createGfx(machine), input = createInput(), st = new Map();
    const vm = createVM({ fengari, gfx, audio, input, storage: { get: (k) => st.get(k) ?? null, set: (k, v) => st.set(k, v) }, onLog: () => {}, machine });
    vm.run(code, 'cart');
    // alle Seiten bzw. Spielzustände durchgehen: Tasten in Folge
    for (let fr = 0; fr < 2400; fr++) {
      const k = fr % 40 < 2 ? 6 : [0, 1, 2, 3, 4, 5, 8, 9][(fr >> 4) % 8];
      for (let i = 0; i < 12; i++) input.set('key', i, i === k && fr % 16 < 6);
      input.tick(); vm.update(); vm.draw();
    }
  } catch (e) { err = e.message; }
  ok(!err, `${f} läuft 2.400 Bilder (Node, Ersatz-Chip)`, err);
}
if (process.argv.includes('--nobrowser')) { console.log(fails ? `${fails} Prüfungen fehlgeschlagen` : 'alle GPU-Prüfungen (Node) bestanden'); process.exit(fails ? 1 : 0); }

// Software-Bild derselben Szene (8BOY 64 ohne GPU) als Vergleich, RGBA
const softRGBA = (() => {
  const { gfx } = runVM(SZENE, 2, 64);
  const out = new Uint32Array(640 * 360);
  gfx.present(out);
  return Buffer.from(out.buffer).toString('base64');
})();

// ------------------------------------------------------------------ 2. Browser
const { chromium } = await import('playwright');
const browser = await chromium.launch();
async function page(viewport, query = '?alle', opts = {}) {
  const ctx = await browser.newContext({ viewport, ...opts });
  const p = await ctx.newPage();
  p.errs = [];
  p.on('pageerror', (e) => p.errs.push(e.message));
  p.on('console', (m) => { if (/GL_INVALID|WebGL: INVALID/.test(m.text())) p.errs.push(m.text()); });
  await p.goto(BASE + query);
  await p.waitForFunction(() => !!window.eightboy, null, { timeout: 15000 });
  return p;
}
async function insert(p, code, machine = 64) {
  await p.evaluate(async ([code, machine]) => {
    const { parseCart } = await import('./js/carts.js');
    const e = window.eightboy;
    e.powerOn(); e.switchMachine(machine);
    await new Promise((r) => setTimeout(r, 200));
    e.system.insert(parseCart(code, { id: 't' + Math.random(), builtin: false, title: 'Test' }));
  }, [code, machine]);
  await p.waitForFunction(() => window.eightboy.system.state === 'running', null, { timeout: 20000 });
}
const press = async (p, k, ms = 120) => { await p.evaluate((i) => window.eightboy.input.set('touch', i, true), k); await p.waitForTimeout(ms); await p.evaluate((i) => window.eightboy.input.set('touch', i, false), k); await p.waitForTimeout(60); };
// Bildschirm als RGBA holen und vergleichen (im Browser)
const pixels = (p) => p.evaluate(() => { const c = document.getElementById('screen'); return Array.from(c.getContext('2d').getImageData(0, 0, c.width, c.height).data); });
function diff(a, b, x0 = 0, y0 = 0, x1 = 640, y1 = 360) {
  let n = 0, big = 0, sum = 0;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const i = (y * 640 + x) * 4;
    const d = Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]);
    sum += d; n++; if (d > 60) big++;
  }
  return { mean: sum / n / 3, bigShare: big / n };
}
// Streuung der Helligkeit (Flimmern/Moiré) in einem Bereich
function variance(a, x0, y0, x1, y1) {
  const v = [];
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const i = (y * 640 + x) * 4; v.push((a[i] + a[i + 1] + a[i + 2]) / 3); }
  const m = v.reduce((s, x) => s + x, 0) / v.length;
  return v.reduce((s, x) => s + (x - m) * (x - m), 0) / v.length;
}

{
  const p = await page({ width: 1600, height: 1000 });
  const g = await p.evaluate(() => window.eightboy.gpu);
  ok(g.ok, 'WebGL2 vorhanden', g.renderer);
  await p.evaluate(() => { window.eightboy.powerOn(); window.eightboy.switchMachine(64); });
  await p.waitForFunction(() => window.eightboy.system.state === 'home', null, { timeout: 15000 });
  ok(await p.evaluate(() => window.eightboy.gfx.gpuMode), 'Startbildschirm auf der GPU', 'gpuMode');
  await p.waitForTimeout(500);
  await p.locator('#screen').screenshot({ path: path.join(OUT, 'start.png') });

  // Bildvergleich GPU gegen Software-Chip
  await insert(p, SZENE);
  await p.waitForTimeout(600);
  const gpuPx = await pixels(p);
  const soft = Buffer.from(softRGBA, 'base64');
  // Software-Bild ist ABGR je Pixel (little endian = R, G, B, A in Bytes)
  const d = diff(gpuPx, soft);
  ok(d.bigShare < 0.04 && d.mean < 6, 'Bildvergleich GPU ↔ Software-Chip (flache Flächen)', `mittlere Abweichung ${d.mean.toFixed(2)}, deutlich anders ${(d.bigShare * 100).toFixed(2)} % der Pixel`);
  await p.locator('#screen').screenshot({ path: path.join(OUT, 'vergleich-gpu.png') });

  // Geteilter Bildschirm: zwei Ausschnitte mit eigenem Himmel, Zähler über beide
  await insert(p, SPLIT);
  await p.waitForTimeout(500);
  {
    const px = await pixels(p);
    const at = (x, y) => { const i = (y * 640 + x) * 4; return [px[i], px[i + 1], px[i + 2]]; };
    const top = at(5, 5), bot = at(5, 300), gap = at(5, 180);
    const sp = await p.evaluate(() => window.eightboy.gfx.g3.stats3d());
    ok(top[0] > 200 && top[2] < 40 && bot[2] > 200 && bot[0] < 40 && gap[0] < 40 && gap[2] < 40 && sp.calls === 2, 'sky3d + view3d: geteilter Bildschirm auf der GPU', `oben ${top} · unten ${bot} · Fuge ${gap} · ${sp.calls} Aufrufe`);
    await p.locator('#screen').screenshot({ path: path.join(OUT, 'geteilt.png') });
  }
  await insert(p, SZENE);
  await p.waitForTimeout(400);

  // Fehlersuch-Ansichten verändern das Bild, Zähler stimmen
  const st = await p.evaluate(() => window.eightboy.gfx.g3.stats3d());
  ok(st.calls === 4 && st.tris >= 26, 'stats3d auf der GPU', `${st.calls} Aufrufe, ${st.tris} Dreiecke`);
  for (const mode of ['draht', 'tiefe']) {
    await p.evaluate((m) => window.eightboy.gfx.g3.debug3d(m), mode);
    await p.waitForTimeout(300);
    const px = await pixels(p);
    ok(diff(px, gpuPx).mean > 8, `debug3d("${mode}") zeigt eine andere Ansicht`);
    await p.locator('#screen').screenshot({ path: path.join(OUT, `debug-${mode}.png`) });
  }
  await p.evaluate(() => window.eightboy.gfx.g3.debug3d(null));

  // Grenze: 400 Ringe = 67.200 Dreiecke > 64.000
  await insert(p, '-- system: 64\nmodel(0, "ring", 10)\nfunction _draw() cls(0) cls3d(0x101020) cam3d(0, 8, -14, 0, -0.4, 60)\nfor i = 0, 19 do for j = 0, 19 do draw3d(0, i - 10, 0, j, 0, 0, 0, 0.8) end end\nlocal a, d, g = stats3d() print(d .. (g and " GRENZE" or ""), 8, 8, 7, 2) end');
  await p.waitForTimeout(600);
  const lim = await p.evaluate(() => ({ st: window.eightboy.gfx.g3.stats3d(), over: window.eightboy.gfx.g3.overLimit, state: window.eightboy.system.state }));
  ok(lim.st.limit && lim.over && lim.st.tris <= 64000 && lim.state === 'running', 'Grenze 64.000 Dreiecke: freundliche Meldung statt Absturz', `${lim.st.tris} Dreiecke gezeichnet`);
  await p.locator('#screen').screenshot({ path: path.join(OUT, 'grenze.png') });

  // PS1-Look und Mipmaps
  const BODEN = `-- system: 64
sprite(1, "7171717171717171\\n1717171717171717\\n7171717171717171\\n1717171717171717\\n7171717171717171\\n1717171717171717\\n7171717171717171\\n1717171717171717")
model(0, "ebene", 7) mtex(0, 1, 0, 60)
function _draw() cls(0) cls3d(0x4060a0) cam3d(0, 1.2, -6, 0, -0.1, 60) draw3d(0, 0, 0, 30, 0, 0, 0, 80) end`;
  const filterBild = async (cmd) => { await insert(p, BODEN.replace('function _draw()', 'function _draw() ' + cmd)); await p.waitForTimeout(500); return pixels(p); };
  const pix = await filterBild('filter3d("pixel")');
  const mip = await filterBild('filter3d("mip")');
  const vPix = variance(pix, 0, 185, 640, 215), vMip = variance(mip, 0, 185, 640, 215);
  ok(vMip < vPix * 0.5, 'Mipmaps: kein Flimmern in der Ferne', `Streuung pixel ${vPix.toFixed(0)} → mip ${vMip.toFixed(0)}`);
  const retro = await filterBild('retro3d(true)');
  ok(diff(retro, pix, 0, 200, 640, 360).mean > 3, 'retro3d(true): PS1-Look sieht anders aus');

  // Stufe 2: Effekte – jeder verändert das Bild, Zähler stimmen, geteilter Bildschirm je Ausschnitt
  const FXB = `-- system: 64
model(0, "gitter", 11) model(1, "wuerfel", 8) model(2, "kugel", 12) model(3, "pyramide", 10) model(5, "kegel", 3)
function welt()
  cls3d(0x2a4a8a, 0xe8b080) cam3d(0, 3, -9, 0, -0.2, 60) light3d(0.8, -0.45, -0.2, 0.35)
  draw3d(0, 0, 0, 4, 0, 0, 0, 24) draw3d(1, -2.5, 1, 3, 0.5, 0, 0, 2) draw3d(2, 0.5, 1, 2, 0, 0, 0, 1.6) draw3d(3, 3, 0.8, 4, 0, 0, 0, 1.6)
end
`;
  const fxBild = async (vor, im = '') => { await insert(p, FXB + vor + `\nfunction _draw() cls(0) ${im} welt() end`); await p.waitForTimeout(500); return pixels(p); };
  const fxOhne = await fxBild('');
  const fxGlow = await fxBild('memit(3, 3)', 'post3d("gluehen", 1.2, 0.8)');
  const stG = await p.evaluate(() => window.eightboy.gfx.g3.stats3d());
  ok(stG.post && diff(fxGlow, fxOhne).mean > 1, 'post3d("gluehen") + memit: Bild über eine Textur, helle Stellen strahlen', `Abweichung ${diff(fxGlow, fxOhne).mean.toFixed(2)} · Stufe ${stG.quality}`);
  await p.locator('#screen').screenshot({ path: path.join(OUT, 'fx-gluehen.png') });
  for (const [name, cmd] of [['farbe', 'post3d("farbe", 1.2, 0.2, 1.2)'], ['roehre', 'post3d("roehre", 1)'], ['tropfen', 'post3d("tropfen", 1.5)'], ['unschaerfe', 'fx3d(2) post3d("unschaerfe", 3, 2)']]) {
    const px = await fxBild('', cmd);
    ok(diff(px, fxOhne).mean > (name === 'unschaerfe' ? 0.5 : 1.5), `post3d("${name}") verändert das Bild`, `Abweichung ${diff(px, fxOhne).mean.toFixed(2)}`);
  }
  // Schatten: Bildpunkte am Boden, die deutlich dunkler werden (Sonne von der Seite → Schatten zur Kamera hin)
  const fxSchatten = await fxBild('', 'shadow3d(true, 20, 0.8)');
  let dunkler = 0;
  for (let y = 150; y < 300; y++) for (let x = 0; x < 640; x++) {
    const i = (y * 640 + x) * 4;
    if (fxOhne[i] + fxOhne[i + 1] + fxOhne[i + 2] - (fxSchatten[i] + fxSchatten[i + 1] + fxSchatten[i + 2]) > 40) dunkler++;
  }
  ok(dunkler > 1500, 'shadow3d: Schatten machen den Boden dunkler', `${dunkler} Bildpunkte im Schatten`);
  await p.locator('#screen').screenshot({ path: path.join(OUT, 'fx-schatten.png') });
  await insert(p, FXB + `part3d(0, { farbe = 10, leben = 3, streuung = 2, form = "funke", glanz = 2 })
local l = {} for i = 0, 499 do l[#l + 1] = (i % 25 - 12) l[#l + 1] = 0 l[#l + 1] = 6 + i // 25 l[#l + 1] = i l[#l + 1] = 0.6 end inst3d(0, l)
function _draw() cls(0) welt() drawi3d(5, 0, 0, 0.5, 0) emit3d(0, 0, 1, 3, 40, 0, 2, 0) parts3d() end`);
  await p.waitForTimeout(800);
  const stP = await p.evaluate(() => window.eightboy.gfx.g3.stats3d());
  ok(stP.parts > 500 && stP.calls <= 8, 'Partikel auf der GPU: hunderte Teilchen in 1–2 Aufrufen', `${stP.parts} Teilchen · ${stP.calls} Aufrufe`);
  ok(stP.tris === 630 + 500 * 20, 'drawi3d: 500 Bäume in einem Aufruf, Dreiecke voll gezählt', `${stP.tris} Dreiecke`);
  await p.locator('#screen').screenshot({ path: path.join(OUT, 'fx-partikel-instanzen.png') });
  // geteilter Bildschirm: links blau getönt, rechts nicht
  await insert(p, FXB + `function _draw() cls(0) cls3d(0)
  view3d(0, 0, 319, 360) post3d("toenung", 0x0030ff, 1) sky3d(0x2a4a8a, 0xe8b080) cam3d(0, 3, -9, 0, -0.2, 60) draw3d(0, 0, 0, 4, 0, 0, 0, 24)
  view3d(321, 0, 319, 360) sky3d(0x2a4a8a, 0xe8b080) cam3d(0, 3, -9, 0, -0.2, 60) draw3d(0, 0, 0, 4, 0, 0, 0, 24)
  view3d() end`);
  await p.waitForTimeout(500);
  {
    const px = await pixels(p);
    const blau = (x0, x1) => { let b = 0, r = 0; for (let y = 200; y < 340; y++) for (let x = x0; x < x1; x++) { const i = (y * 640 + x) * 4; r += px[i]; b += px[i + 2]; } return b / Math.max(1, r); };
    ok(blau(20, 300) > blau(340, 620) * 1.5, 'post3d je Ausschnitt: nur die linke Ansicht ist getönt', `Blau/Rot links ${blau(20, 300).toFixed(2)} · rechts ${blau(340, 620).toFixed(2)}`);
    await p.locator('#screen').screenshot({ path: path.join(OUT, 'fx-geteilt.png') });
  }
  await insert(p, FXB + 'function _draw() cls(0) fx3d(0) post3d("gluehen", 1) welt() end');
  await p.waitForTimeout(400);
  ok(!(await p.evaluate(() => window.eightboy.gfx.g3.stats3d().post)), 'fx3d(0): Nachbearbeitung aus, Spiel läuft weiter');
  ok(!p.errs.length, 'Effekte ohne WebGL-Fehler', p.errs.join(' | '));

  // MEGA-Kartridge im 8BOY 64: gerahmt, läuft auf dem Software-Chip
  await insert(p, fs.readFileSync(path.join(LERN, 'm1-3d-grundlagen.lua'), 'utf8'));
  await p.waitForTimeout(800);
  const mega = await p.evaluate(() => ({ w: window.eightboy.gfx.w, gpu: window.eightboy.gfx.gpuMode, state: window.eightboy.system.state }));
  ok(mega.w === 320 && !mega.gpu && mega.state === 'running', 'MEGA-Kartridge im 8BOY 64 (Rahmen, Software-Chip)');
  await p.locator('#screen').screenshot({ path: path.join(OUT, 'mega-im-rahmen.png') });
  ok(!p.errs.length, 'keine Seitenfehler', p.errs.join(' | '));
  await p.context().close();
}

// Ohne WebGL2: klare Meldung, 8BOY 32 auf Knopfdruck
{
  const p = await page({ width: 1400, height: 900 }, '?alle&nogpu');
  await p.evaluate(() => { window.eightboy.powerOn(); window.eightboy.switchMachine(64); });
  await p.waitForTimeout(600);
  ok(await p.evaluate(() => window.eightboy.system.state) === 'nogpu', 'ohne WebGL2: Meldung „Diese Konsole braucht WebGL2“');
  await p.locator('#screen').screenshot({ path: path.join(OUT, 'ohne-webgl2.png') });
  await press(p, 4);
  await p.waitForTimeout(800);
  ok(await p.evaluate(() => window.eightboy.settings.model) === 32, 'ohne WebGL2: A wechselt zum 8BOY 32');
  ok(!p.errs.length, 'keine Seitenfehler ohne WebGL2', p.errs.join(' | '));
  await p.context().close();
}

// Lektionen im Browser: Seiten durchblättern, spielen, Zeit je Bild
for (const [f, keys] of [['u1-gpu-modelle.lua', 'seiten'], ['u2-tiefe-filter.lua', 'seiten'], ['u3-effekte.lua', 'seiten']]) {
  const p = await page({ width: 1920, height: 1080 }, '?alle&tv');
  await insert(p, fs.readFileSync(path.join(LERN, f), 'utf8'));
  await p.evaluate(() => {
    const e = window.eightboy; window.__ms = [];
    const tick = e.system.tick;
    e.system.tick = (...a) => { const t0 = performance.now(); const r = tick.apply(e.system, a); if (e.system.state === 'running') window.__ms.push(performance.now() - t0); return r; };
  });
  if (keys === 'seiten') {
    for (let s = 0; s < (f.startsWith('u3') ? 7 : 6); s++) {
      for (const k of [4, 5, 8, 2, 3, 0, 1]) await press(p, k, 150);
      await p.waitForTimeout(300);
      await p.locator('#screen').screenshot({ path: path.join(OUT, `${f.replace('.lua', '')}-${s + 1}.png`) });
      await press(p, 6);
    }
  } else if (keys === 'sofa') {
    // vier Spieler als Handys, Titel → jeder gegen jeden → los; dann gehen und spritzen
    await p.evaluate(() => { for (let i = 1; i <= 4; i++) window.eightboy.input.phoneAdd('t' + i); });
    await p.waitForTimeout(1500);
    for (const k of [4, 3, 4, 4]) { await press(p, k); await p.waitForTimeout(400); }
    for (let i = 0; i < 30; i++) {
      await p.evaluate((i) => { for (let s = 1; s <= 4; s++) window.eightboy.input.phoneSet('t' + s, (1 << 4) | (1 << [2, 2, 0, 1][(i + s) % 4])); }, i);
      await p.waitForTimeout(180);
    }
    await p.locator('#screen').screenshot({ path: path.join(OUT, 'wasserschlacht-ultra-4-spieler.png') });
  } else {
    await press(p, 4);
    for (let i = 0; i < 40; i++) await press(p, [0, 1, 2, 3, 4][i % 5], 180);
    await p.locator('#screen').screenshot({ path: path.join(OUT, 'neonflug-tv.png') });
  }
  const r = await p.evaluate(() => ({ ms: window.__ms.slice(20), state: window.eightboy.system.state, err: window.eightboy.system.error?.message }));
  ok(r.state === 'running' && !p.errs.length, `${f} im Browser`, `${r.err || ''} ${p.errs.join(' | ')} Logik+Zeichnen: Median ${median(r.ms).toFixed(2)} ms, 95 % ${p95(r.ms).toFixed(2)} ms`);
  if (f === 'neonflug.lua') {
    // Bilder pro Sekunde im Browser (headless: Grafikkarte wird von SwiftShader auf der CPU nachgebildet)
    const fps = await p.evaluate(() => new Promise((res) => { let n = 0; const t0 = performance.now(); const f = () => { n++; if (performance.now() - t0 < 2000) requestAnimationFrame(f); else res(n / 2); }; requestAnimationFrame(f); }));
    console.log(`     Neonflug: ${fps.toFixed(0)} Bilder/s im headless Chromium (SwiftShader) · ${JSON.stringify(await p.evaluate(() => window.eightboy.gfx.g3.stats3d()))}`);
  }
  await p.context().close();
}

// Bilder: Desktop und Handy quer
{
  const p = await page({ width: 1366, height: 768 });
  await insert(p, fs.readFileSync(path.join(LERN, 'u3-effekte.lua'), 'utf8'));
  await press(p, 4); await p.waitForTimeout(1500);
  await p.screenshot({ path: path.join(OUT, 'desktop-1366.png') });
  await p.context().close();
  const h = await page({ width: 844, height: 390 }, '?alle', { isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await insert(h, fs.readFileSync(path.join(LERN, 'u3-effekte.lua'), 'utf8'));
  await press(h, 4); await h.waitForTimeout(1500);
  await h.screenshot({ path: path.join(OUT, 'handy-quer.png') });
  ok(!h.errs.length, 'Handy quer ohne Seitenfehler', h.errs.join(' | '));
  await h.context().close();
}

await browser.close();
console.log(`Bilder in ${path.relative(root, OUT)}`);
console.log(fails ? `${fails} Prüfungen fehlgeschlagen` : 'alle GPU-Prüfungen bestanden');
process.exit(fails ? 1 : 0);
