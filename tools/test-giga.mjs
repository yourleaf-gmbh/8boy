// 8BOY 128 (Meilensteine 2–6) prüfen: node tools/test-giga.mjs
//   Lektion g1-hd-materialien im Browser: Konsole 1280×720, Asset-Paket giga-demo, Texturen bereit, HDR-Nachbearbeitung,
//   kein schwarzes Bild, Normal-Maps umschaltbar, keine Fehler. Ohne Grafikkarte: verständliche Meldung statt Absturz.
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { chromium } from 'playwright';
import { parseCart } from '../js/carts.js';
import { machineFor } from '../js/machines.js';

const root = path.resolve(import.meta.dirname, '..');
// Lektionen liegen im Repo 8boy-lernspiele (Nachbarordner oder LERNSPIELE=<ordner mit den .lua>)
const LERN = process.env.LERNSPIELE ? path.resolve(process.env.LERNSPIELE) : path.join(root, '../8boy-lernspiele/carts');
let fehler = 0;
const ok = (c, text, extra = '') => { console.log(`${c ? 'OK  ' : 'FAIL'} ${text}${extra ? '  ' + extra : ''}`); if (!c) fehler++; };

const code = fs.readFileSync(path.join(LERN, 'g1-hd-materialien.lua'), 'utf8');
const cart = parseCart(code);
ok(cart.system === 128 && cart.assets?.join() === 'giga-demo', 'Kopf: system 128, assets giga-demo');
const m = machineFor(128);
ok(m.w === 1280 && m.h === 720 && m.giga, 'Datenblatt 8BOY 128: 1280×720');
if (!fs.existsSync(path.join(root, 'assets/giga-demo/manifest.json'))) execFileSync(process.execPath, [path.join(root, 'tools/assetpack.mjs'), path.join(root, 'tools/giga/demo-paket')], { stdio: 'ignore' });

const PORT = 8098;
const server = spawn(process.execPath, [path.join(root, 'tools/serve.mjs'), String(PORT)], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 900));
const b = await chromium.launch();
const p = await (await b.newContext({ viewport: { width: 1500, height: 1000 } })).newPage();
const errs = [];
p.on('pageerror', (e) => errs.push(e.message));
p.on('console', (msg) => { if (msg.type() === 'error') errs.push(msg.text() + (msg.location()?.url ? ' ' + msg.location().url : '')); });
await p.goto(`http://localhost:${PORT}/`);
await p.waitForFunction(() => window.eightboy?.carts?.length);
ok(await p.evaluate(() => !document.querySelector('[data-model="128"]').hidden), 'lokal: GIGA-Knopf sichtbar');

await p.evaluate(async (c) => {
  const { parseCart } = await import('/js/carts.js');
  window.eightboy.powerOn(); window.eightboy.switchMachine(128);
  await new Promise((r) => setTimeout(r, 3600));
  window.eightboy.system.insert(parseCart(c, { id: 'giga-test', file: 'g1.lua', builtin: false }));
}, code);
await p.waitForFunction(() => ['running', 'error'].includes(window.eightboy.system.state), null, { timeout: 60000 });
await p.waitForTimeout(2500);
const st = await p.evaluate(() => window.eightboy.system.state);
ok(st === 'running', 'Lektion läuft', st);
const info = await p.evaluate(() => {
  const g = window.eightboy.gfx.g3, cv = document.getElementById('screen');
  return { w: window.eightboy.gfx.w, h: window.eightboy.gfx.h, stats: g.stats3d(), tex: [1, 2, 3, 4, 5, 6].map((k) => g.texstate(k)), hdr: g.hdr, cw: cv.width };
});
ok(info.w === 1280 && info.h === 720, 'Bild 1280×720', `${info.w}×${info.h}`);
ok(info.tex.every((t) => t === 'bereit'), 'alle sechs Texturen aus dem Paket bereit', info.tex.join(','));
ok(info.stats.tris > 30000 && info.stats.tris <= 500000, 'Dreiecke im GIGA-Rahmen', String(info.stats.tris));
ok(!info.hdr || info.stats.post, 'HDR-Nachbearbeitung läuft (Tone-Mapping, FXAA)', `hdr ${info.hdr}, post ${info.stats.post}`);
fs.mkdirSync(path.join(root, 'shots/giga'), { recursive: true });
const bild = await p.locator('#screen').screenshot({ timeout: 90000, path: path.join(root, 'shots/giga/g1.png') });
ok(bild.length > 60000, 'Bild ist nicht leer', `${(bild.length / 1024).toFixed(0)} KB`);
await p.keyboard.press('Space');
await p.waitForTimeout(300);
await p.locator('#screen').screenshot({ timeout: 90000, path: path.join(root, 'shots/giga/g1-ohne-normal.png') });
// Meilenstein 3: Figuren mit Skelett
const code2 = fs.readFileSync(path.join(LERN, 'g2-skelette.lua'), 'utf8');
if (!fs.existsSync(path.join(root, 'assets/giga-figuren/manifest.json'))) execFileSync(process.execPath, [path.join(root, 'tools/assetpack.mjs'), path.join(root, 'tools/giga/figur-paket')], { stdio: 'ignore' });
await p.evaluate(async (c) => {
  const { parseCart } = await import('/js/carts.js');
  window.eightboy.system.insert(parseCart(c, { id: 'giga-test-2', file: 'g2.lua', builtin: false }));
}, code2);
await p.waitForFunction(() => ['running', 'error'].includes(window.eightboy.system.state), null, { timeout: 60000 });
await p.waitForTimeout(2000);
ok(await p.evaluate(() => window.eightboy.system.state) === 'running', 'Lektion 2 (Figuren) läuft');
await p.keyboard.down('ArrowDown'); await p.waitForTimeout(1500);
const b1 = await p.locator('#screen').screenshot({ timeout: 90000, path: path.join(root, 'shots/giga/g2-rennen.png') });
await p.keyboard.up('ArrowDown');
await p.keyboard.down('z'); await p.waitForTimeout(120); await p.keyboard.up('z');
await p.waitForTimeout(600);
const b2 = await p.locator('#screen').screenshot({ timeout: 90000, path: path.join(root, 'shots/giga/g2-skelett.png') });
ok(b1.length > 60000 && !b1.equals(b2), 'Figuren werden gezeichnet und bewegen sich', `${(b1.length / 1024).toFixed(0)} KB`);
// Meilenstein 4: Licht und Tiefe (Lightmap, Panorama, Kaskaden, Verdeckung)
const code3 = fs.readFileSync(path.join(LERN, 'g3-licht.lua'), 'utf8');
if (!fs.existsSync(path.join(root, 'assets/giga-licht/manifest.json'))) execFileSync(process.execPath, [path.join(root, 'tools/assetpack.mjs'), path.join(root, 'tools/giga/licht-paket')], { stdio: 'ignore' });
await p.evaluate(async (c) => {
  const { parseCart } = await import('/js/carts.js');
  window.eightboy.system.insert(parseCart(c, { id: 'giga-test-3', file: 'g3.lua', builtin: false }));
}, code3);
await p.waitForFunction(() => ['running', 'error'].includes(window.eightboy.system.state), null, { timeout: 60000 });
await p.waitForTimeout(2500);
ok(await p.evaluate(() => window.eightboy.system.state) === 'running', 'Lektion 3 (Licht und Tiefe) läuft');
const st3 = await p.evaluate(() => { const g = window.eightboy.gfx.g3; return { s: g.stats3d(), tex: [1, 2, 3].map((k) => g.texstate(k)) }; });
ok(st3.tex.every((t) => t === 'bereit'), 'Lightmap und beide Panoramen bereit', st3.tex.join(','));
ok(st3.s.ao && st3.s.kaskaden === 3, 'Umgebungsverdeckung läuft, drei Schatten-Kaskaden', `ao ${st3.s.ao}, kaskaden ${st3.s.kaskaden}`);
const taste = async (k) => { await p.keyboard.down(k); await p.waitForTimeout(120); await p.keyboard.up(k); await p.waitForTimeout(500); };
const l1 = await p.locator('#screen').screenshot({ timeout: 90000, path: path.join(root, 'shots/giga/g3.png') });
await taste('Space');
const l2 = await p.locator('#screen').screenshot({ timeout: 90000, path: path.join(root, 'shots/giga/g3-ohne-lightmap.png') });
await taste('Space'); await taste('v');
const l3 = await p.locator('#screen').screenshot({ timeout: 90000, path: path.join(root, 'shots/giga/g3-kaskaden.png') });
await taste('v'); await taste('z');
ok(await p.evaluate(() => !window.eightboy.gfx.g3.stats3d().ao), 'Verdeckung lässt sich abschalten');
ok(l1.length > 60000 && !l1.equals(l2) && !l1.equals(l3), 'Lightmap und Kaskaden-Ansicht ändern das Bild', `${(l1.length / 1024).toFixed(0)} KB`);
// Meilenstein 5: große Welten (Streaming, Culling, LOD, Fahrzeug)
const code4 = fs.readFileSync(path.join(LERN, 'g4-welten.lua'), 'utf8');
if (!fs.existsSync(path.join(root, 'assets/giga-welt/manifest.json'))) execFileSync(process.execPath, [path.join(root, 'tools/assetpack.mjs'), path.join(root, 'tools/giga/welt-paket')], { stdio: 'ignore' });
await p.evaluate(async (c) => {
  const { parseCart } = await import('/js/carts.js');
  window.eightboy.system.insert(parseCart(c, { id: 'giga-test-4', file: 'g4.lua', builtin: false }));
}, code4);
await p.waitForFunction(() => ['running', 'error'].includes(window.eightboy.system.state), null, { timeout: 60000 });
await p.waitForTimeout(2000);
ok(await p.evaluate(() => window.eightboy.system.state) === 'running', 'Lektion 4 (große Welten) läuft');
const w1 = await p.evaluate(() => window.eightboy.gfx.g3.stats3d());
ok(w1.weg > 0, 'Culling: Modelle außerhalb des Bildes weggelassen', `weg ${w1.weg}, gezeichnet ${w1.calls}`);
await p.keyboard.down('Space'); await p.waitForTimeout(2000); await p.keyboard.up('Space');
await p.keyboard.down('c'); await p.waitForTimeout(120); await p.keyboard.up('c');
await p.waitForTimeout(2500);
const w2 = await p.evaluate(() => window.eightboy.gfx.g3.stats3d());
await p.locator('#screen').screenshot({ timeout: 90000, path: path.join(root, 'shots/giga/g4-oben.png') });
ok(w2.fern > 0, 'LOD: ferne Bäume und Felsen vereinfacht', `fern ${w2.fern}, Dreiecke ${w2.tris}`);
ok(st7.calls > 80 && !st7.limit, 'vier Ansichten unter der Dreiecks-Grenze (Kacheln mit Detailstufen)', `${st7.calls} Aufrufe, ${st7.tris} Dreiecke, vereinfacht ${st7.fern}`);
ok(!errs.length, 'keine Skript- oder Shader-Fehler', errs.slice(0, 3).join(' | '));
await b.close();
server.kill();
console.log(fehler ? `${fehler} Prüfung(en) fehlgeschlagen` : 'alle GIGA-Prüfungen bestanden');
process.exit(fehler ? 1 : 0);
