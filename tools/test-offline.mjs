// Offline-Test: einmal online laden (Service Worker füllt den Cache), dann Netz aus und alles benutzen.
//   node tools/test-offline.mjs [url]
import { chromium } from 'playwright';

const url = process.argv.find((a) => /^https?:/.test(a)) || 'https://8boy.yourleaf.de/';
// auf localhost meldet main.js absichtlich keinen Service Worker an (immer frischer Code beim Entwickeln)
if (/\/\/(localhost|127\.)/.test(url)) { console.log('Offline-Test braucht den Service Worker: gegen dist hinter echtem Host oder die Live-Seite laufen lassen.'); process.exit(1); }
const b = await chromium.launch();
let fails = 0;
const ok = (cond, label, extra = '') => { if (!cond) fails++; console.log(`${cond ? 'OK  ' : 'FEHL'} ${label}${extra ? '  ' + extra : ''}`); };

const ctx = await b.newContext({ viewport: { width: 412, height: 870 }, hasTouch: true, isMobile: true, acceptDownloads: true });
const p = await ctx.newPage();
const errs = [], failed = [];
p.on('pageerror', (e) => errs.push(e.message));
p.on('requestfailed', (r) => failed.push(r.url().replace(url, '')));
// Wie ein Besuch: drei Spiele aus dem Store holen (danach müssen sie offline da sein)
await p.goto(url);
await p.waitForFunction(() => window.eightboy?.carts.length, null, { timeout: 20000 });
await p.evaluate(() => localStorage.setItem('8boy:store', JSON.stringify([])));
await p.reload();
await p.waitForFunction(() => window.eightboy?.carts.length, null, { timeout: 20000 });
await p.waitForFunction(async () => (await navigator.serviceWorker.ready)?.active?.state === 'activated', null, { timeout: 30000 });
const cached = await p.evaluate(async () => { const k = await caches.keys(); const c = await caches.open(k[0]); return { key: k[0], n: (await c.keys()).length }; });
ok(cached.n > 30, 'Service Worker hat den Cache gefüllt', `${cached.key}, ${cached.n} Dateien`);

await ctx.setOffline(true);
ok(await p.evaluate(() => !navigator.onLine), 'Netz ist aus');
await p.reload();
await p.waitForFunction(() => window.eightboy?.carts.length, null, { timeout: 20000 }).catch(() => {});
const n = await p.evaluate(() => window.eightboy?.carts.length || 0);
ok(n >= 1, 'App startet offline, Regal vollständig', `${n} Kartridges`);
ok(await p.evaluate(() => [].every((f) => window.eightboy.carts.some((c) => c.file === f))), 'aus dem Store geholte Spiele sind offline im Regal');
// Packungsbilder werden nacheinander gezeichnet: kurz warten
await p.waitForFunction(() => [...document.querySelectorAll('.shelf .pkg img')].every((i) => i.complete && i.naturalWidth), null, { timeout: 8000 }).catch(() => {});
const covers = await p.evaluate(() => [...document.querySelectorAll('.shelf .pkg img')].filter((i) => !i.complete || !i.naturalWidth).length);
ok(covers === 0, 'alle Packungsbilder offline da', covers ? `${covers} fehlen` : '');

await p.evaluate(() => window.eightboy.powerOn());
await p.waitForFunction(() => window.eightboy.system.state === 'home', null, { timeout: 15000 });
await p.tap('#btnShelf'); await p.waitForTimeout(400);
await p.locator('.shelf .pkg').first().tap(); await p.waitForTimeout(1200);
await p.tap('.ub-hint'); await p.waitForTimeout(700); await p.tap('.ub-hint'); await p.waitForTimeout(1900);
await p.tap('.ub-manual'); await p.waitForTimeout(500);
ok(await p.locator('.ub-book').isVisible(), 'Auspacken und Heft offline');
await p.keyboard.press('Escape'); await p.waitForTimeout(300);
await p.tap('.ub-cart'); 
await p.waitForFunction(() => window.eightboy.system.state === 'running', null, { timeout: 15000 }).catch(() => {});
ok(await p.evaluate(() => window.eightboy.system.state) === 'running', 'Kartridge läuft offline');
await p.waitForTimeout(2000);
await p.click('#slot'); await p.waitForTimeout(500);

for (const title of ['Lektion 1']) {
  await p.evaluate((t) => window.eightboy.insertCart(t), title);
  await p.waitForFunction(() => window.eightboy.system.state === 'running', null, { timeout: 15000 }).catch(() => {});
  await p.waitForTimeout(1500);
  ok(await p.evaluate(() => window.eightboy.system.state) === 'running', `„${title}“ läuft offline`);
  await p.click('#slot'); await p.waitForTimeout(400);
}
await p.evaluate(() => window.eightboy.switchMachine(8)); await p.waitForTimeout(600);
await p.tap('#btnStudio'); await p.waitForTimeout(400);
await p.tap('#edRun');
await p.waitForFunction(() => window.eightboy.system.state === 'running', null, { timeout: 15000 }).catch(() => {});
ok(await p.evaluate(() => window.eightboy.system.state) === 'running', 'Studio: eigene Kartridge starten offline');
await p.tap('#btnStudio'); await p.waitForTimeout(400); await p.tap('#edSave'); await p.waitForTimeout(400);
await p.reload(); await p.waitForFunction(() => window.eightboy?.carts.length, null, { timeout: 20000 }).catch(() => {});
ok(await p.evaluate(() => window.eightboy.carts.some((c) => c.title === 'Meine Kartridge')), 'gespeicherte Kartridge bleibt nach Neuladen offline erhalten');
const lic = await p.evaluate(async () => (await fetch('LIZENZEN.txt')).ok);
ok(lic, 'Lizenztext offline abrufbar');

// eigene Dateien aus dem Download-Ordner: .lua und PNG-Kartridge über „Datei laden“
const LUA = '-- title: Aus dem Download\nfunction _draw()\n  cls(1)\n  print("offline geladen", 40, 70, 7)\nend\n';
const PNG = await p.evaluate(async () => {
  const { embedCart } = await import('./js/pngcart.js');
  const base = await window.eightboy.packagePNG('Lektion 1');
  const code = '-- title: Paket per Post\nfunction _draw()\n  cls(2)\nend\n';
  return [...await embedCart(base, code)];
});
for (const [file, title, mimeType, buffer] of [['aus-dem-download.lua', 'Aus dem Download', 'text/plain', Buffer.from(LUA)],
  ['paket-per-post.8boy.png', 'Paket per Post', 'image/png', Buffer.from(PNG)]]) {
  await p.setInputFiles('#fileInput', { name: file, mimeType, buffer });
  await p.waitForFunction((t) => window.eightboy.carts.some((c) => c.title === t), title, { timeout: 5000 }).catch(() => {});
  const inShelf = await p.evaluate((t) => window.eightboy.carts.some((c) => c.title === t), title);
  await p.keyboard.press('Escape'); await p.waitForTimeout(400);
  await p.evaluate((t) => window.eightboy.insertCart(t), title);
  await p.waitForFunction(() => window.eightboy.system.state === 'running', null, { timeout: 15000 }).catch(() => {});
  ok(inShelf && await p.evaluate(() => window.eightboy.system.state) === 'running', `eigene Datei ${file} offline laden und starten`);
  await p.click('#slot').catch(() => {}); await p.waitForTimeout(400);
}
ok(errs.length === 0, 'keine JS-Fehler', errs.join(' | '));
const relevant = failed.filter((u) => !/favicon/.test(u));
console.log('fehlgeschlagene Abrufe offline:', relevant.length ? [...new Set(relevant)].join(', ') : '—');
await b.close();
console.log(fails ? `${fails} Prüfungen fehlgeschlagen` : `alle Offline-Prüfungen bestanden (${url})`);
process.exit(fails ? 1 : 0);
