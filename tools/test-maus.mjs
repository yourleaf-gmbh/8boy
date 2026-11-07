// Maus an der Konsole prüfen: node tools/test-maus.mjs  (Dev-Server auf :8080)
// Eine kleine Kartridge malt am Mauszeiger und zeigt Klicks links/rechts und das Rad als Pixelreihen;
// dazu die gefangene Maus als rechter Stick (stick(1)).
import { chromium } from 'playwright';

const URL = process.env.URL || 'http://localhost:8080/';
let fails = 0;
const ok = (c, name, info = '') => { if (!c) fails++; console.log(`${c ? 'OK  ' : 'FEHL'} ${name} ${info}`); };

const CART = `-- title: Maustest
-- system: 32
links, rechts, rad = 0, 0, 0
function _update()
  if mbtnp(0) then links = links + 1 end
  if mbtnp(1) then rechts = rechts + 1 end
  local x, y, b, dx, dy, w = mouse()
  rad = rad + w
  mx, my = x, y
end
function _draw()
  cls(0)
  for i = 1, links do pset(i, 0, 9) end
  for i = 1, rechts do pset(i, 1, 10) end
  for i = 1, rad do pset(i, 2, 11) end
  if mx then pset(mx, my, 8) end
end`;

const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
const errs = [];
p.on('pageerror', (e) => errs.push(e.message));
await p.goto(URL);
await p.waitForFunction(() => window.eightboy?.carts.length);
await p.evaluate(() => window.eightboy.switchMachine(32));
await p.click('#btnStudio');
await p.waitForTimeout(300);
await p.evaluate((code) => { const t = document.getElementById('edText'); t.value = code; t.dispatchEvent(new Event('input')); }, CART);
await p.click('#edRun');
await p.waitForFunction(() => window.eightboy.system.state === 'running' && window.eightboy.system.cart?.title === 'Maustest', null, { timeout: 15000 });
await p.waitForTimeout(300);
const { w, h } = await p.evaluate(() => ({ w: window.eightboy.gfx.w, h: window.eightboy.gfx.h }));
const box = await p.locator('#screen').boundingBox();
const px = (x, y) => [box.x + box.width * (x + 0.5) / w, box.y + box.height * (y + 0.5) / h];
const fb = (x, y) => p.evaluate(([x, y, w]) => window.eightboy.gfx.fb[y * w + x], [x, y, w]);
const row = (y, c) => p.evaluate(([y, c, w]) => { let n = 0; for (let x = 1; x < 40; x++) if (window.eightboy.gfx.fb[y * w + x] === c) n++; return n; }, [y, c, w]);

await p.mouse.move(...px(w / 2, h / 2));
await p.waitForTimeout(100);
ok(await fb(w / 2, h / 2) === 8, 'Mausposition kommt in Bildpixeln an');
await p.mouse.move(...px(37, 150));
await p.waitForTimeout(100);
ok(await fb(37, 150) === 8, 'auch am Rand genau', '(37, 150)');
await p.mouse.down(); await p.mouse.up();
for (let i = 0; i < 2; i++) { await p.mouse.down({ button: 'right' }); await p.mouse.up({ button: 'right' }); await p.waitForTimeout(50); }
await p.mouse.wheel(0, 100); await p.waitForTimeout(40); await p.mouse.wheel(0, 100);
await p.waitForTimeout(200);
ok(await row(0, 9) === 1, 'Linksklick (auch kürzer als ein Bild)', await row(0, 9));
ok(await row(1, 10) === 2, 'Rechtsklick zweimal', await row(1, 10));
ok(await row(2, 11) === 2, 'Mausrad', await row(2, 11));
const prevented = await p.evaluate(() => { const e = new MouseEvent('contextmenu', { bubbles: true, cancelable: true }); document.getElementById('screen').dispatchEvent(e); return e.defaultPrevented; });
ok(prevented, 'Rechtsklick öffnet im Bild kein Browser-Menü');
const st = await p.evaluate(() => { const i = window.eightboy.input; i.mouseLocked(true); i.mouseMove(6, -24); i.tick(); const r = i.stick(1); i.mouseLocked(false); return r; });
ok(Math.abs(st[0] - 0.5) < 0.01 && st[1] === -1, 'gefangene Maus = rechter Stick', JSON.stringify(st));
ok(errs.length === 0, 'keine JS-Fehler', errs.join(' | '));
await b.close();
console.log(fails ? `${fails} Prüfungen fehlgeschlagen` : 'alle Maus-Prüfungen bestanden');
process.exit(fails ? 1 : 0);
