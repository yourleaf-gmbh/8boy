// Touch-Test auf emulierten Handys: Mehrfinger-Eingaben per Chrome DevTools Protocol.
//   node tools/test-touch.mjs [url] [screenshot-ordner]
import { chromium } from 'playwright';

const url = process.argv[2] || 'http://localhost:8080/';
const out = process.argv[3];
const NAMES = ['←', '→', '↑', '↓', 'A', 'B', 'START', 'SELECT'];
const b = await chromium.launch();
let fails = 0;

for (const [name, vp, big] of [['hoch', { width: 412, height: 870 }, false], ['quer', { width: 870, height: 412 }, false],
  ['hoch-gross', { width: 412, height: 870 }, true], ['quer-gross', { width: 870, height: 412 }, true]]) {
  const ctx = await b.newContext({ viewport: vp, deviceScaleFactor: 2.6, hasTouch: true, isMobile: true });
  const p = await ctx.newPage();
  await p.goto(url);
  await p.evaluate((big) => { localStorage.setItem('8boy:settings', JSON.stringify({ big })); }, big);
  await p.reload();
  await p.waitForTimeout(400);
  await p.evaluate(() => window.eightboy.powerOn());
  await p.waitForTimeout(300);
  // eine Lektion einlegen, damit die Touch-Tasten keine Systemeinstellungen verstellen
  await p.evaluate(() => window.eightboy.insertCart('Lektion 1'));
  // erst messen und drücken, wenn die Kartridge läuft (beim Start wird die Eingabe zurückgesetzt)
  await p.waitForFunction(() => window.eightboy.system.state === 'running', null, { timeout: 15000 });
  await p.waitForTimeout(300);
  const cdp = await ctx.newCDPSession(p);
  const rect = (sel) => p.evaluate((s) => { const r = document.querySelector(s).getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; }, sel);
  const dp = await rect('#dpad'), a = await rect('.round-btn.a'), bb = await rect('.round-btn.b'), st = await rect('.sys-btn[data-btn="6"]');
  const c = (r, fx = 0.5, fy = 0.5) => ({ x: r.x + r.w * fx, y: r.y + r.h * fy });
  const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((q, i) => ({ x: q.x, y: q.y, id: q.id ?? i + 1 })) });
  const pressed = async () => { await p.waitForTimeout(60); return p.evaluate(() => [...window.eightboy.input.down]); };
  const show = (d) => NAMES.filter((_, i) => d[i]).join('+') || '–';
  const check = (label, d, want) => {
    const ok = want.every((i) => d[i]) && d.reduce((n, v) => n + v, 0) === want.length;
    if (!ok) fails++;
    console.log(`${ok ? 'OK  ' : 'FEHL'} ${name.padEnd(11)} ${label.padEnd(30)} erkannt: ${show(d)}`);
  };
  const right = c(dp, 0.88, 0.5), up = c(dp, 0.5, 0.12), diag = c(dp, 0.9, 0.12);
  await touch('touchStart', [{ ...right, id: 1 }]); check('Steuerkreuz rechts', await pressed(), [1]);
  await touch('touchMove', [{ ...up, id: 1 }]); check('wischen nach oben', await pressed(), [2]);
  await touch('touchMove', [{ ...diag, id: 1 }]); check('schräg rechts-oben', await pressed(), [1, 2]);
  await touch('touchStart', [{ ...diag, id: 1 }, { ...c(a), id: 2 }]); check('+ zweiter Finger auf A', await pressed(), [1, 2, 4]);
  await touch('touchMove', [{ ...diag, id: 1 }, { ...c(bb), id: 2 }]); check('A → B rüberrutschen', await pressed(), [1, 2, 5]);
  await touch('touchEnd', []); check('alle Finger los', await pressed(), []);
  await touch('touchStart', [{ ...c(st), id: 3 }]); check('START', await pressed(), [6]);
  await touch('touchEnd', []);
  if (out) await p.screenshot({ path: `${out}/touch-${name}.png` });
  await ctx.close();
}

// Regal und Studio mit dem Finger: wischen, antippen, tippen
const okk = (cond, label, extra = '') => { if (!cond) fails++; console.log(`${cond ? 'OK  ' : 'FEHL'} ${label}${extra ? '  ' + extra : ''}`); };
for (const [name, vp] of [['360×640', { width: 360, height: 640 }], ['412×870', { width: 412, height: 870 }]]) {
  const ctx = await b.newContext({ viewport: vp, deviceScaleFactor: 2.6, hasTouch: true, isMobile: true });
  const p = await ctx.newPage();
  await p.goto(url);
  await p.waitForFunction(() => window.eightboy?.carts.length);
  await p.evaluate(() => window.eightboy.powerOn());
  await p.waitForTimeout(300);
  const cdp = await ctx.newCDPSession(p);
  const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((q) => ({ x: q.x, y: q.y, id: 1 })) });
  const outside = (sel) => p.evaluate((s) => [...document.querySelectorAll(s)].filter((e) => e.offsetParent && e.getBoundingClientRect().right > innerWidth + 1).length, sel);
  okk(await outside('.c-top button') === 0, `${name} Knöpfe oben im Gehäuse`);
  await p.tap('#btnShelf'); await p.waitForTimeout(400);
  // im öffentlichen Stand liegen nur wenige Packungen im Regal: die fünfte oder die letzte nehmen
  const nr = Math.min(4, await p.locator('.shelf .pkg').count() - 1);
  const box = await p.evaluate((i) => { const r = document.querySelectorAll('.shelf .pkg')[i].getBoundingClientRect(); return { x: r.x + r.width / 2, y: Math.min(r.y + r.height / 2, innerHeight - 60) }; }, nr);
  await touch('touchStart', [box]);
  for (let i = 1; i <= 8; i++) { await touch('touchMove', [{ x: box.x, y: box.y - i * 30 }]); await p.waitForTimeout(12); }
  await touch('touchEnd', []); await p.waitForTimeout(500);
  const sc = await p.evaluate(() => document.querySelector('.shelf').scrollTop);
  const scrollbar = await p.evaluate(() => { const s = document.querySelector('.shelf'); return s.scrollHeight - s.clientHeight > 50; });
  okk((sc > 50 || !scrollbar) && await p.locator('.ub').isHidden(), `${name} Regal per Finger auf einer Packung scrollen`, scrollbar ? `${sc}px` : 'Regal passt ganz ins Bild');
  await p.locator('.shelf .pkg').nth(nr).tap(); await p.waitForTimeout(800);
  okk(await p.evaluate(() => window.eightboy.unboxer.state) === 'sealed', `${name} Packung antippen öffnet sie`);
  await p.tap('.ub-close'); await p.waitForTimeout(500);
  await p.evaluate(() => window.eightboy.openStudio ? window.eightboy.openStudio() : document.getElementById('btnStudio').click()); await p.waitForTimeout(500);
  okk(await outside('.ed-bar .tb') === 0, `${name} Studio-Leiste ganz sichtbar`);
  await p.tap('#edText'); await p.evaluate(() => { const t = document.getElementById('edText'); t.setSelectionRange(0, 0); });
  await p.tap('#edKeys button >> text="("'); await p.tap('#edKeys button >> text=")"');
  const ed = await p.evaluate(() => ({ start: document.getElementById('edText').value.slice(0, 2), focus: document.activeElement.id }));
  okk(ed.start === '()' && ed.focus === 'edText', `${name} Zeichenleiste tippt, Tastatur bleibt offen`, JSON.stringify(ed));
  await p.tap('#edNew'); await p.waitForTimeout(200);
  okk(await outside('#edNewMenu') === 0, `${name} Vorlagen-Menü im Bild`);
  await ctx.close();
}
await b.close();
console.log(fails ? `${fails} Prüfungen fehlgeschlagen` : 'alle Touch-Prüfungen bestanden');
process.exit(fails ? 1 : 0);
