// Ende-zu-Ende-Test wie ein Mensch: Regal → Packung ziehen → auspacken → Heft → einlegen → spielen → Menü →
// auswerfen → Packung als PNG herunterladen → in frischem Browser wieder einlesen → Studio → Großbild.
//   node tools/test-e2e.mjs [url] [--public]     --public: zusätzlich prüfen, dass nichts Internes ausgeliefert wird
import { chromium } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// online liegen die Spiele im Store: mit ?alle liegt wie lokal alles im Regal
const url0 = process.argv.find((a) => /^https?:/.test(a)) || 'http://localhost:8080/';
const url = /localhost|127\.0/.test(url0) ? url0 : url0.replace(/\/?$/, '/') + '?alle';
const isPublic = process.argv.includes('--public');
const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
let fails = 0;
const ok = (cond, label, extra = '') => { if (!cond) fails++; console.log(`${cond ? 'OK  ' : 'FEHL'} ${label}${extra ? '  ' + extra : ''}`); };

async function fresh(vp = { width: 1280, height: 800 }, opts = {}) {
  const ctx = await b.newContext({ viewport: vp, acceptDownloads: true, ...opts });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  p.on('console', (m) => { if (m.type() === 'error' && !/404|Failed to load resource/.test(m.text())) errs.push(m.text()); });
  await p.goto(url);
  await p.waitForFunction(() => window.eightboy?.carts.length, null, { timeout: 20000 });
  return { ctx, p, errs };
}
const state = (p) => p.evaluate(() => window.eightboy.system.state);
const center = async (p, sel) => {
  await p.locator(sel).first().scrollIntoViewIfNeeded();
  const r = await p.locator(sel).first().boundingBox();
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
};

// ------------------------------------------------------------------ 1. Laden, Regal
let { ctx, p, errs } = await fresh();
const n = await p.evaluate(() => window.eightboy.carts.length);
ok(n >= 1, 'Regal geladen', `${n} Kartridges`);
const sealedBoxes = await p.locator('.shelf .pkg').count();
ok(sealedBoxes === n, 'alle Packungen eingeschweißt (NEU)', `${sealedBoxes}`);
const groups = await p.locator('.shelf-group h3').allTextContents();
ok(groups.length > 0, 'Regal zeigt Gruppen', groups.join(' · '));
if (isPublic) {
  ok(!groups.some((g) => /Intern/i.test(g)), 'keine interne Gruppe im Regal');
  // intern = hervorgehoben, aber ohne freie Lizenz
  const intern = await p.evaluate(() => window.eightboy.carts.filter((c) => c.highlight && !c.license).length);
  ok(intern === 0, 'keine interne Kartridge ausgeliefert', String(intern));
}

// ------------------------------------------------------------------ 2. Packung mit der Maus auf die Konsole ziehen
await p.evaluate(() => window.eightboy.powerOn());
await p.waitForFunction(() => window.eightboy.system.state === 'home', null, { timeout: 15000 });
const boxSel = '.shelf .pkg[title^="Lektion 1: Hallo 8BOY"]';
const from = await center(p, boxSel), to = await center(p, '.c-screen');
await p.mouse.move(from.x, from.y); await p.mouse.down();
for (let i = 1; i <= 12; i++) await p.mouse.move(from.x + (to.x - from.x) * i / 12, from.y + (to.y - from.y) * i / 12);
await p.mouse.up();
await p.waitForTimeout(600);
ok(await p.locator('.ub').isVisible(), 'Ziehen der Packung startet das Auspacken');
ok(await p.evaluate(() => window.eightboy.unboxer.state) === 'sealed', 'Packung ist eingeschweißt');

// ------------------------------------------------------------------ 3. Auspacken per Tastatur und Klick
await p.keyboard.press('Space'); await p.waitForTimeout(700);
ok(await p.evaluate(() => window.eightboy.unboxer.state) === 'torn', 'Leertaste reißt die Folie auf');
{ const r = await p.locator('.ub-front').boundingBox(); await p.mouse.click(r.x + r.width / 2, r.y + r.height / 2); } await p.waitForTimeout(1900);
ok(await p.evaluate(() => window.eightboy.unboxer.state) === 'out', 'Deckel auf, Kartridge und Heft liegen bereit');
await p.click('.ub-manual'); await p.waitForTimeout(400);
ok(await p.locator('.ub-book').isVisible(), 'Heft öffnet sich');
let pages = 0;
while (await p.locator('.bk-next').isVisible() && pages < 30) { await p.keyboard.press('ArrowRight'); await p.waitForTimeout(600); pages++; }
const num = await p.locator('.bk-num').textContent();
ok(pages >= 2 && await p.locator('.bk-insert').isVisible(), 'bis zur letzten Seite geblättert', `${pages}× · ${num}`);
await p.keyboard.press('ArrowLeft'); await p.waitForTimeout(600);
ok(await p.locator('.bk-next').isVisible(), 'zurückblättern geht');
await p.keyboard.press('ArrowRight'); await p.waitForTimeout(600);
await p.click('.bk-insert');
await p.waitForFunction(() => window.eightboy.system.state === 'running', null, { timeout: 15000 }).catch(() => {});
ok(await state(p) === 'running', 'Kartridge fliegt in den Schacht und läuft');
ok(await p.locator('.shelf .cart .cart-title', { hasText: 'Hallo 8BOY' }).count() === 1, 'im Regal liegt jetzt die ausgepackte Kartridge');

// ------------------------------------------------------------------ 4. Spielen, Menü, Auswerfen
for (let i = 0; i < 20; i++) { await p.keyboard.down('ArrowRight'); await p.waitForTimeout(40); }
await p.keyboard.up('ArrowRight');
await p.keyboard.press('Escape'); await p.waitForTimeout(300);
ok(await state(p) === 'paused', 'Esc öffnet das Systemmenü', await state(p));
await p.keyboard.press('Escape'); await p.waitForTimeout(300);
ok(await state(p) === 'running', 'Esc schließt es wieder');
await p.click('#slot'); await p.waitForTimeout(600);
ok(await state(p) === 'home', 'Klick auf den Schacht wirft aus');

// ------------------------------------------------------------------ 5. Zweites Mal: kein Auspacken mehr, Dialog mit Anleitung
await p.click('.shelf .cart:has-text("Hallo 8BOY")'); await p.waitForTimeout(300);
ok(await p.locator('#cartDialog').isVisible(), 'zweites Antippen öffnet den Kartridge-Dialog');
await p.click('#cdManual'); await p.waitForTimeout(400);
ok(await p.locator('.ub-book').isVisible(), '„Anleitung“ zeigt das Heft wieder');
await p.keyboard.press('Escape'); await p.waitForTimeout(300);
ok(!(await p.locator('.ub').isVisible()), 'Esc schließt das Heft');

// ------------------------------------------------------------------ 6. Packung als PNG herunterladen
await p.click('.shelf .cart:has-text("Hallo 8BOY")'); await p.waitForTimeout(300);
const dl = p.waitForEvent('download');
await p.click('#cdPackage');
const file = path.join(os.tmpdir(), 'e2e-lektion1.8boy.png');
await (await dl).saveAs(file);
const png = fs.readFileSync(file);
ok(png.length > 10000 && png.includes('8boy-cart'), '„⇩ Packung“ liefert eine PNG-Kartridge', `${(png.length / 1024).toFixed(0)} KB`);
ok(errs.length === 0, 'keine JS-Fehler im ersten Durchlauf', errs.join(' | '));
await ctx.close();

// ------------------------------------------------------------------ 7. Frischer Browser (Handy): PNG geht als Paket ein
({ ctx, p, errs } = await fresh({ width: 412, height: 860 }, { hasTouch: true, isMobile: true, deviceScaleFactor: 2.6 }));
// eingebaute Kartridge kommt doppelt nicht ins Regal → eigene Kartridge mit geändertem Titel verschicken
const code = await p.evaluate(async (bytes) => {
  const { extractCart, embedCart } = await import('./js/pngcart.js');
  const c = (await extractCart(new Uint8Array(bytes))).replace('-- title: Lektion 1: Hallo 8BOY', '-- title: Lektion 1: Hallo 8BOY von Oma');
  window.__png = await embedCart(new Uint8Array(bytes), c);
  return c;
}, [...png]);
ok(code.includes('Lektion 1: Hallo 8BOY von Oma'), 'PNG-Kartridge lässt sich lesen und umpacken');
await p.setInputFiles('#fileInput', { name: 'geschenk.8boy.png', mimeType: 'image/png', buffer: Buffer.from(await p.evaluate(() => [...window.__png])) });
await p.waitForTimeout(1200);
ok(await p.locator('.ub').isVisible() && await p.evaluate(() => window.eightboy.unboxer.state) === 'sealed', 'Paket kommt eingeschweißt an');
ok(await p.locator('.shelf .pkg[title^="Lektion 1: Hallo 8BOY von Oma"]').count() === 1, 'liegt als neue Packung im Regal');
await p.tap('.ub-hint'); await p.waitForTimeout(700);
await p.tap('.ub-hint'); await p.waitForTimeout(1900);
await p.tap('.ub-cart'); await p.waitForTimeout(400);
await p.waitForFunction(() => window.eightboy.system.state === 'running', null, { timeout: 15000 }).catch(() => {});
ok(await state(p) === 'running', 'am Handy ausgepackt und per Antippen eingelegt');
const cover = await p.evaluate(() => !!window.eightboy.carts.find((c) => c.title === 'Lektion 1: Hallo 8BOY von Oma')?.cover);
ok(cover, 'Titelbild aus dem PNG übernommen');
ok(errs.length === 0, 'keine JS-Fehler am Handy', errs.join(' | '));
await ctx.close();

// ------------------------------------------------------------------ 8. Studio und Großbild
({ ctx, p, errs } = await fresh({ width: 1440, height: 900 }));
await p.evaluate(() => window.eightboy.powerOn());
await p.waitForTimeout(3300);
await p.click('#btnStudio'); await p.waitForTimeout(400);
ok(await p.locator('#editor').isVisible(), 'Studio öffnet sich');
const tpl = await p.inputValue('#edText');
ok(/--\[\[anleitung/.test(tpl), 'Vorlage enthält ein Anleitungsheft');
await p.click('#edRun');
await p.waitForFunction(() => window.eightboy.system.state === 'running', null, { timeout: 15000 }).catch(() => {});
ok(await state(p) === 'running', 'Vorlage startet auf der Konsole');
await p.click('#edSave'); await p.waitForTimeout(400);
ok(await p.locator('.shelf .cart:has-text("Meine Kartridge")').count() >= 1, 'gespeichert und ausgepackt im Regal (kein Auspacken für eigene)');
await p.click('#edClose'); await p.waitForTimeout(300);
await p.click('#btnBig'); await p.waitForTimeout(400);
const big = await p.evaluate(() => ({ on: document.getElementById('console').classList.contains('big'), w: parseFloat(getComputedStyle(document.getElementById('console')).getPropertyValue('--screen-w')) }));
ok(big.on && big.w > 700, 'Großbild vergrößert den Bildschirm', `${big.w}px`);
ok(errs.length === 0, 'keine JS-Fehler im Studio', errs.join(' | '));
await ctx.close();

await b.close();
console.log(fails ? `${fails} Prüfungen fehlgeschlagen` : `alle E2E-Prüfungen bestanden (${url})`);
process.exit(fails ? 1 : 0);
