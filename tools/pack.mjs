// Packungen bauen (braucht den laufenden Server: npm start)
//   node tools/pack.mjs covers   [datei.lua …]   Titelbilder fotografieren → covers/<name>.png
//   node tools/pack.mjs packages [datei.lua …]   PNG-Kartridges zum Verschicken → pakete/<name>.8boy.png
//   node tools/pack.mjs manual   <datei.lua> [ordner]   Anleitungsheft und Packung als Bilder ansehen
// Titelbild-Regie in der Kartridge:  -- cover: 4 A@2.5 START@3   (nach 4 s fotografieren, vorher Tasten drücken)
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const url = process.env.URL || 'http://localhost:8080/';
const [cmd = 'covers', ...rest] = process.argv.slice(2);
const index = JSON.parse(fs.readFileSync(path.join(root, 'carts/index.json'), 'utf8').replace(/^﻿/, ''));
const files = rest.filter((a) => a.endsWith('.lua')).map((a) => path.basename(a));
const list = files.length ? files : index;
const BTN = { U: 2, D: 3, A: 4, B: 5, START: 6, SELECT: 7, LEFT: 0, RIGHT: 1, UP: 2, DOWN: 3, X: 8, Y: 9, L: 10, R: 11 };

// GPU=1: echte Grafikkarte statt SwiftShader (8BOY-128-Kartridges: schneller, gleiche Shader wie beim Spielen)
const browser = await chromium.launch(process.env.GPU ? { args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] } : {});
async function openPage() {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on('pageerror', (e) => console.log('  Seitenfehler:', e.message));
  await page.goto(url);
  await page.waitForFunction(() => window.eightboy && window.eightboy.carts.length > 0);
  return page;
}

if (cmd === 'covers') {
  fs.mkdirSync(path.join(root, 'covers'), { recursive: true });
  for (const file of list) {
    const code = fs.readFileSync(path.join(root, 'carts', file), 'utf8');
    const m = /^--\s*cover\s*:\s*(.*)$/im.exec(code.split('\n').slice(0, 60).join('\n'));
    const parts = (m ? m[1] : '').trim().split(/\s+/).filter(Boolean);
    const wait = parseFloat(parts[0]) || 3;
    const keys = parts.slice(1).map((p) => { const [k, t] = p.split('@'); return { i: BTN[k.toUpperCase()], t: parseFloat(t) || 0 }; }).filter((k) => k.i !== undefined);
    const page = await openPage();
    // 8BOY-16-Kartridges auf dem 8BOY 16 fotografieren (256x224, ohne Rahmen)
    await page.evaluate((f) => window.eightboy.switchMachine(window.eightboy.carts.find((c) => c.file === f)?.system || 8), file);
    await page.evaluate(() => window.eightboy.powerOn());
    await page.waitForFunction(() => window.eightboy.system.state === 'home', null, { timeout: 45000 });
    await page.evaluate((f) => window.eightboy.insertCart(f), file);
    await page.waitForFunction(() => window.eightboy.system.state === 'running', null, { timeout: 60000 });   // GIGA: Asset-Pakete laden
    const t0 = Date.now();
    for (const k of keys.sort((a, b) => a.t - b.t)) {
      const dt = k.t * 1000 - (Date.now() - t0);
      if (dt > 0) await page.waitForTimeout(dt);
      await page.evaluate((i) => window.eightboy.input.set('touch', i, true), k.i);
      await page.waitForTimeout(90);
      await page.evaluate((i) => window.eightboy.input.set('touch', i, false), k.i);
    }
    const rest2 = wait * 1000 - (Date.now() - t0);
    if (rest2 > 0) await page.waitForTimeout(rest2);
    const data = await page.evaluate(() => document.getElementById('screen').toDataURL('image/png'));
    const out = path.join(root, 'covers', file.replace(/\.lua$/, '.png'));
    fs.writeFileSync(out, Buffer.from(data.split(',')[1], 'base64'));
    console.log('Titelbild', path.relative(root, out), m ? `(cover: ${m[1].trim()})` : '');
    await page.close();
  }
} else if (cmd === 'packages') {
  const dir = path.join(root, 'pakete');
  fs.mkdirSync(dir, { recursive: true });
  const page = await openPage();
  for (const file of list) {
    const bytes = await page.evaluate(async (f) => [...await window.eightboy.packagePNG(f)], file);
    const out = path.join(dir, file.replace(/\.lua$/, '.8boy.png'));
    fs.writeFileSync(out, Buffer.from(bytes));
    console.log('Packung', path.relative(root, out), (bytes.length / 1024).toFixed(0) + ' KB');
  }
} else if (cmd === 'manual') {
  const file = list[0];
  const outDir = path.resolve(rest.find((a) => !a.endsWith('.lua')) || path.join(root, 'shots', 'anleitung'));
  fs.mkdirSync(outDir, { recursive: true });
  const page = await openPage();
  const shots = await page.evaluate(async (f) => {
    const pa = await import('./js/pixelart.js');
    const { loadCover } = await import('./js/carts.js');
    const cart = window.eightboy.carts.find((c) => c.file === f);
    const cover = await loadCover(cart);
    const big = (c, s = 3) => { const o = document.createElement('canvas'); o.width = c.width * s; o.height = c.height * s; const g = o.getContext('2d'); g.imageSmoothingEnabled = false; g.drawImage(c, 0, 0, o.width, o.height); return o.toDataURL(); };
    const pages = pa.renderManualPages(cart, cover).map((c) => big(c));
    return { pages, box: big(pa.renderBoxFront(cart, cover), 2), warn: pa.parseManual(cart.code) ? '' : 'keine --[[anleitung … ]] gefunden – Standardheft' };
  }, file);
  const base = file.replace(/\.lua$/, '');
  shots.pages.forEach((d, i) => fs.writeFileSync(path.join(outDir, `${base}-seite-${String(i + 1).padStart(2, '0')}.png`), Buffer.from(d.split(',')[1], 'base64')));
  fs.writeFileSync(path.join(outDir, `${base}-packung.png`), Buffer.from(shots.box.split(',')[1], 'base64'));
  console.log(`${shots.pages.length} Seiten + Packung nach ${outDir}`, shots.warn);
}
await browser.close();
