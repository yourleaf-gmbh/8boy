// 8BOY 16 im Browser: Konsolenwechsel, alte Kartridge im Rahmen, falscher Schacht, Tasten X Y L R
// (auch per Finger), Klangproben, Super-Kartridges und Studio-Vorlage.
//   node tools/test-super.mjs [url] [screenshot-ordner]
import { chromium } from 'playwright';

const url = process.argv.find((a) => /^https?:/.test(a)) || 'http://localhost:8080/';
const out = process.argv.slice(2).find((a) => !/^https?:/.test(a));
const b = await chromium.launch();
let fails = 0;
const ok = (cond, label, extra = '') => { if (!cond) fails++; console.log(`${cond ? 'OK  ' : 'FEHL'} ${label}${extra ? '  ' + extra : ''}`); };
// Tasten so lange halten, dass mindestens ein Bild sie sieht
const press = async (p, key) => { await p.keyboard.down(key); await p.waitForTimeout(100); await p.keyboard.up(key); };
const running = (p) => p.waitForFunction(() => window.eightboy.system.state === 'running', null, { timeout: 20000 }).then(() => true).catch(() => false);

// ---------------------------------------------------------------- Desktop
{
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(url);
  await p.waitForFunction(() => window.eightboy?.carts.length);
  await p.evaluate(() => window.eightboy.powerOn());
  await p.click('[data-model="16"]');
  await p.waitForFunction(() => window.eightboy.system.state === 'home', null, { timeout: 15000 });
  const look = await p.evaluate(() => ({ cls: document.getElementById('console').classList.contains('model-16'), w: document.getElementById('screen').width, h: document.getElementById('screen').height, label: document.getElementById('bezelLabel').textContent, x: !!document.querySelector('.round-btn.x').offsetParent }));
  ok(look.cls && look.w === 256 && look.h === 224 && look.x, 'Konsolenwechsel: Gehäuse, 256×224, Tasten X/Y sichtbar', `${look.w}×${look.h} · ${look.label}`);
  ok(await p.evaluate(() => JSON.parse(localStorage.getItem('8boy:settings')).model) === 16, 'Wahl der Konsole wird gemerkt');

  await p.evaluate(() => window.eightboy.insertCart('Lektion 1'));
  ok(await running(p), '8BOY-Kartridge läuft auf dem 8BOY 16');
  await p.waitForTimeout(800);
  const frame = await p.evaluate(() => {
    const c = document.getElementById('screen'), g = c.getContext('2d');
    const px = (x, y) => [...g.getImageData(x, y, 1, 1).data.slice(0, 3)];
    return { gw: window.eightboy.gfx.w, corner: px(2, 2), inner: px(128, 112) };
  });
  ok(frame.gw === 240 && frame.corner.some((v) => v > 20), 'alte Kartridge mit eigenem 240×160-Bild im Rahmen', JSON.stringify(frame));

  // Super-Kartridge auf dem 8BOY: passt nicht, A wechselt die Konsole
  await p.click('[data-model="8"]');
  await p.waitForTimeout(300);
  await p.evaluate(() => (async () => { const { parseCart } = await import('/js/carts.js'); window.eightboy.system.insert(parseCart('-- title: Super-Test\n-- system: 16\nfunction _draw() cls(1) print("SUPER", 100, 100, 7) end\n', { id: 'super-test', file: 'super-test.lua', builtin: false })); })());
  await p.waitForFunction(() => ['wrong', 'boot'].includes(window.eightboy.system.state), null, { timeout: 15000 });
  await p.waitForFunction(() => window.eightboy.system.state === 'wrong', null, { timeout: 15000 }).catch(() => {});
  ok(await p.evaluate(() => window.eightboy.system.state) === 'wrong', 'Super-Kartridge passt nicht in den 8BOY');
  await press(p, 'KeyX');
  ok(await running(p) && await p.evaluate(() => window.eightboy.settings.model) === 16, 'A wechselt zum 8BOY 16 und startet sie');

  // Klangproben: einmal berechnen, darf die Konsole nicht lange anhalten
  const ms = await p.evaluate(async () => { const t0 = performance.now(); window.eightboy.audio.play('@0 c', 0); return performance.now() - t0; });
  ok(ms < 1500, 'Klangproben bereit', `${Math.round(ms)} ms`);

  // Studio: Vorlage und Konsolenwahl
  await p.click('#btnStudio');
  await p.click('#edNew');
  ok(await p.locator('#edNewMenu').getByText('8BOY 16: Perspektivboden').isVisible(), 'Studio bietet die Super-Vorlage an');
  await p.locator('#edNewMenu').getByText('8BOY 16: Perspektivboden').click();
  await p.click('[data-side="cart"]');
  ok(await p.inputValue('#cfSystem') === '16', 'Kartridge-Formular zeigt Konsole 8BOY 16');
  await p.click('#edRun');
  ok(await running(p), 'Super-Vorlage startet');
  // 8BOY 32: Wechsel, 320×240, Super-Kartridge im Rahmen, 3D-Vorlage
  await p.click('#edClose').catch(() => {});
  await p.click('[data-model="32"]');
  await p.waitForFunction(() => ['home', 'loading', 'running', 'boot'].includes(window.eightboy.system.state), null, { timeout: 15000 });
  await p.waitForTimeout(3500);
  const mega = await p.evaluate(() => ({ cls: document.getElementById('console').classList.contains('model-32'), w: document.getElementById('screen').width, h: document.getElementById('screen').height }));
  ok(mega.cls && mega.w === 320 && mega.h === 240, '8BOY 32: Gehäuse und 320×240', JSON.stringify(mega));
  await p.evaluate(() => (async () => { const { parseCart } = await import('/js/carts.js'); window.eightboy.system.insert(parseCart('-- title: Super-Test\n-- system: 16\nfunction _draw() cls(1) print("SUPER", 100, 100, 7) end\n', { id: 'super-test', file: 'super-test.lua', builtin: false })); })());
  ok(await running(p) && await p.evaluate(() => window.eightboy.gfx.w) === 256, 'Super-Kartridge läuft im Rahmen auf dem 8BOY 32');
  await p.click('#btnStudio');
  await p.click('#edNew');
  await p.locator('#edNewMenu').getByText('8BOY 32: 3D-Würfel').click();
  await p.click('#edRun');
  // erst warten, bis wirklich die neue Kartridge läuft (vorher lief noch die Super-Lektion)
  await p.waitForFunction(() => window.eightboy.system.cart?.title === 'Mein 3D-Spiel' && window.eightboy.system.state === 'running' && window.eightboy.gfx.state.use3d && window.eightboy.gfx.g3.tris3d() > 0, null, { timeout: 15000 }).catch(() => {});
  ok(await p.evaluate(() => window.eightboy.gfx.state.use3d && window.eightboy.gfx.g3.tris3d() > 0), 'MEGA-Vorlage zeichnet 3D', 'Dreiecke ' + await p.evaluate(() => window.eightboy.gfx.g3.tris3d()));
  if (out) await p.locator('#screen').screenshot({ path: `${out}/mega-vorlage.png` });
  ok(errs.length === 0, 'keine JS-Fehler am Desktop', errs.join(' | '));
  await ctx.close();
}

// ---------------------------------------------------------------- Handy: X Y L R mit dem Finger
{
  const ctx = await b.newContext({ viewport: { width: 412, height: 870 }, deviceScaleFactor: 2.6, hasTouch: true, isMobile: true });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(url);
  await p.waitForFunction(() => window.eightboy?.carts.length);
  await p.evaluate(() => { window.eightboy.powerOn(); window.eightboy.switchMachine(16); });
  await p.evaluate(() => (async () => { const { parseCart } = await import('/js/carts.js'); window.eightboy.system.insert(parseCart('-- title: Super-Test\n-- system: 16\nfunction _draw() cls(1) print("SUPER", 100, 100, 7) end\n', { id: 'super-test', file: 'super-test.lua', builtin: false })); })());
  await running(p);
  await p.waitForTimeout(400);
  const cdp = await ctx.newCDPSession(p);
  const center = (sel) => p.evaluate((s) => { const r = document.querySelector(s).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width }; }, sel);
  const outside = await p.evaluate(() => [...document.querySelectorAll('.round-btn, .shoulder')].filter((e) => { const r = e.getBoundingClientRect(); return r.left < 0 || r.right > innerWidth || r.top < 0; }).length);
  ok(outside === 0, 'Handy: alle Super-Tasten im Bild');
  for (const [sel, i, name] of [['.round-btn.x', 8, 'X'], ['.round-btn.y', 9, 'Y'], ['.shoulder.l', 10, 'L'], ['.shoulder.r', 11, 'R'], ['.round-btn.a', 4, 'A']]) {
    const c = await center(sel);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: c.x, y: c.y, id: 1 }] });
    await p.waitForTimeout(60);
    const down = await p.evaluate(() => [...window.eightboy.input.down]);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await p.waitForTimeout(60);
    ok(down[i] === 1 && down.reduce((a, v) => a + v, 0) === 1, `Handy: Taste ${name} per Finger`, `${Math.round(c.w)}px`);
  }
  if (out) await p.screenshot({ path: `${out}/super-handy.png` });
  ok(errs.length === 0, 'keine JS-Fehler am Handy', errs.join(' | '));
  await ctx.close();
}

await b.close();
console.log(fails ? `${fails} Prüfungen fehlgeschlagen` : 'alle 8BOY-16-Prüfungen bestanden');
process.exit(fails ? 1 : 0);
