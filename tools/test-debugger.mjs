// Fehlersuche im Studio: Haltepunkt setzen → treffen → Variablen → Weiter → Nächstes Bild → Schritt →
// Live-Neuladen behält den Spielstand → Syntaxfehler beim Live-Laden → Haltepunkt-Markierung beim Scrollen →
// Handy-Bedienung → Vorschläge für net.*
//   node tools/test-debugger.mjs [url] [screenshot-ordner]
import { chromium } from 'playwright';
import fs from 'node:fs';

const url = process.argv.find((a) => /^https?:/.test(a)) || 'http://localhost:8080/';
const out = process.argv.slice(2).find((a) => !/^https?:/.test(a));
if (out) fs.mkdirSync(out, { recursive: true });
// echte Scrollbalken: die Markierungen müssen trotzdem genau auf der Zeile sitzen
const b = await chromium.launch({ ignoreDefaultArgs: ['--hide-scrollbars'] });
let fails = 0;
const ok = (cond, label, extra = '') => { if (!cond) fails++; console.log(`${cond ? 'OK  ' : 'FEHL'} ${label}${extra ? '  ' + extra : ''}`); };
const shot = async (p, name, opts = {}) => { if (out) await p.screenshot({ path: `${out}/${name}.png`, ...opts }); };

const CODE = `-- title: Debug-Test
-- author: Test
-- color: 12

x = 10
speed = 1

function _init()
  pl = { x = 5, hp = 3, name = "Pip" }
  n = 0
end

function _update()
  local dx = speed
  x = x + dx
  n = n + 1
end

function _draw()
  cls(1)
  print("x " .. x, 4, 4, 7)
end
`;
const L_X = 15, L_DX = 14;

async function fresh(vp, opts = {}) {
  const ctx = await b.newContext({ viewport: vp, ...opts });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  p.on('console', (m) => { if (m.type() === 'error' && !/404|Failed to load resource/.test(m.text())) errs.push(m.text()); });
  await p.goto(url);
  await p.evaluate(() => { localStorage.removeItem('8boy:studio-draft'); localStorage.removeItem('8boy:watches'); localStorage.removeItem('8boy:autolive'); });
  await p.reload();
  await p.waitForFunction(() => window.eightboy?.carts.length, null, { timeout: 20000 });
  await p.evaluate(() => window.eightboy.powerOn());
  await p.waitForFunction(() => window.eightboy.system.state === 'home', null, { timeout: 15000 });
  return { ctx, p, errs };
}
const setCode = (p, c) => p.evaluate((c) => { const t = document.getElementById('edText'); t.value = c; t.dispatchEvent(new Event('input')); }, c);
const halted = (p) => p.evaluate(() => document.getElementById('console').classList.contains('dbg-halt'));
const waitHalt = (p) => p.waitForFunction(() => document.getElementById('console').classList.contains('dbg-halt'), null, { timeout: 15000 }).then(() => true, () => false);
const stateText = (p) => p.textContent('#dbgState');
const frameNo = async (p) => +(/Bild (\d+)/.exec(await stateText(p)) || [])[1];
const varText = (p) => p.textContent('#dbgVars');
// Zeilen-Geometrie aus dem Textfeld
const geo = (p) => p.evaluate(() => {
  const t = document.getElementById('edText'), cs = getComputedStyle(t);
  return { top: t.getBoundingClientRect().top, pad: parseFloat(cs.paddingTop), lh: parseFloat(cs.lineHeight), st: t.scrollTop };
});
async function clickGutter(p, line, tap = false) {
  const g = await geo(p);
  const r = await p.locator('#edGutter').boundingBox();
  const y = g.top + g.pad + (line - 1) * g.lh + g.lh / 2 - g.st;
  if (tap) await p.touchscreen.tap(r.x + r.width / 2, y); else await p.mouse.click(r.x + r.width / 2, y);
  await p.waitForTimeout(60);
}
const watchVal = (p, expr) => p.evaluate((e) => [...document.querySelectorAll('.dbg-wrow')].find((r) => r.querySelector('code').textContent === e)?.querySelector('.dbg-wval').textContent, expr);

// ------------------------------------------------------------------ 1. Haltepunkt setzen und treffen (Maus)
let { ctx, p, errs } = await fresh({ width: 1440, height: 900 });
await p.click('#btnStudio'); await p.waitForTimeout(300);
await setCode(p, CODE);
await clickGutter(p, L_X);
ok(await p.locator('#edGutter .bp').count() === 1 && (await p.textContent('#edGutter .bp')) === String(L_X), 'Klick auf Zeilennummer setzt Haltepunkt', await p.textContent('#edGutter .bp'));
await clickGutter(p, L_X);
ok(await p.locator('#edGutter .bp').count() === 0, 'zweiter Klick entfernt ihn');
await clickGutter(p, L_X);
await p.click('#edRun');
ok(await waitHalt(p), 'Spiel hält am Haltepunkt an');
ok(await p.locator('#edDbg').isVisible(), 'Leiste mit Weiter/Bild/Schritt erscheint');
ok(/Zeile 15/.test(await stateText(p)) && /_update/.test(await stateText(p)), 'Haltestelle: Zeile und Funktion', (await stateText(p)).trim());
let vars = await varText(p);
ok(/dx\s*1/.test(vars) && /x\s*10/.test(vars) && /n\s*0/.test(vars), 'Variablen: lokal dx, global x und n', vars.replace(/\s+/g, ' ').slice(0, 120));
ok(/pl\{x=5, hp=3, name="Pip"\}|pl\s*\{/.test(vars), 'Tabellen gekürzt angezeigt');
ok(await p.locator('.hl-inline').count() === 1 && /x = 10/.test(await p.textContent('.hl-inline')), 'Werte stehen hinter der Zeile', await p.textContent('.hl-inline').catch(() => ''));
const f1 = await frameNo(p);
const st1 = await p.evaluate(() => window.eightboy.system.state);
await p.waitForTimeout(300);
ok(await frameNo(p) === f1 && await halted(p) && st1 === 'running', 'Konsole bleibt eingefroren');
// Markierung der aktuellen Zeile liegt genau auf Zeile 15
{
  const g = await geo(p), cur = await p.locator('.hl-curline').boundingBox(), bp = await p.locator('#edGutter .bp').boundingBox();
  const want = g.top + g.pad + (L_X - 1) * g.lh - g.st;
  ok(Math.abs(cur.y - want) < 1.5 && Math.abs(bp.y + bp.height / 2 - (want + g.lh / 2)) < 2, 'Zeilenmarkierung sitzt auf der Zeile', `${cur.y.toFixed(1)} / ${want.toFixed(1)}`);
}
await shot(p, 'haltepunkt-desktop');

// ------------------------------------------------------------------ 2. Weiter, Nächstes Bild, Schritt
await p.click('#edDbg [data-cmd="resume"]');
ok(await waitHalt(p) && await frameNo(p) === f1 + 1, 'Weiter: hält im nächsten Bild wieder an', `Bild ${f1} → ${await frameNo(p)}`);
ok(/x\s*11/.test(await varText(p)), 'x ist um 1 gewachsen');
await p.click('#edDbg [data-cmd="frame"]');
ok(await waitHalt(p) && await frameNo(p) === f1 + 2, 'Nächstes Bild: genau ein Bild weiter', String(await frameNo(p)));
await clickGutter(p, L_X); // Haltepunkt weg
await p.click('.dbg-ctl [data-cmd="frame"]');
await p.waitForTimeout(400);
ok(await halted(p) && /Bild fertig/.test(await stateText(p)) && await frameNo(p) === f1 + 3, 'Nächstes Bild ohne Haltepunkt hält am Bild-Ende', (await stateText(p)).trim());
await p.click('.dbg-ctl [data-cmd="step"]');
ok(await waitHalt(p) && /Schritt/.test(await stateText(p)) && /Zeile 14/.test(await stateText(p)), 'Schritt: erste Zeile von _update', (await stateText(p)).trim());
await p.keyboard.press('F10'); await p.waitForTimeout(200);
ok(/Zeile 15/.test(await stateText(p)), 'F10: nächste Zeile', (await stateText(p)).trim());
await p.click('#edDbg [data-cmd="resume"]'); await p.waitForTimeout(400);
ok(!(await halted(p)), 'Weiter ohne Haltepunkte: Spiel läuft');
ok(await p.evaluate(() => window.eightboy.system.debug().engaged === false), 'ohne Haltepunkte kein Zeilen-Hook / normaler Bildlauf');

// ------------------------------------------------------------------ 3. Beobachten und Live-Neuladen
await p.click('.ed-bar [data-side="debug"]').catch(() => {});
if (await p.locator('#edDebugPanel').isHidden()) await p.click('.ed-bar [data-side="debug"]');
for (const e of ['x', 'n', 'pl.hp * 10']) { await p.fill('#dbgExpr', e); await p.press('#dbgExpr', 'Enter'); }
await p.waitForTimeout(400);
const n1 = +(await watchVal(p, 'n'));
ok(n1 > 5 && (await watchVal(p, 'pl.hp * 10')) === '30', 'Beobachten zeigt Werte jedes Bild', `n=${n1}`);
ok(await p.locator('.dbg-spark').count() >= 1, 'Zahlen als Kurve');
const x0 = +(await watchVal(p, 'x'));
await setCode(p, CODE.replace('local dx = speed', 'local dx = speed * 5').replace('cls(1)', 'cls(2)'));
await p.click('#edLive'); await p.waitForTimeout(500);
const log1 = await p.textContent('#edLog');
ok(/Live geladen/.test(log1) && /_update/.test(log1), 'Live geladen: Funktionen ausgetauscht', log1.split('\n').pop());
const n2 = +(await watchVal(p, 'n')), x1 = +(await watchVal(p, 'x'));
await p.waitForTimeout(500);
const n3 = +(await watchVal(p, 'n')), x2 = +(await watchVal(p, 'x'));
ok(n2 >= n1 && n3 > n2, 'n läuft weiter – _init wurde nicht neu aufgerufen', `${n1} → ${n2} → ${n3}`);
ok(x1 >= x0 && Math.abs((x2 - x1) - 5 * (n3 - n2)) < 0.01, 'x behält den Stand und wächst jetzt um 5', `${x0} → ${x1} → ${x2}`);
ok(await p.evaluate(() => window.eightboy.system.state) === 'running', 'kein Neustart');
// geänderter Startwert kommt an, unveränderter nicht
await setCode(p, CODE.replace('local dx = speed', 'local dx = speed * 5').replace('speed = 1', 'speed = 2'));
await p.focus('#edText');
await p.keyboard.press('Control+s'); await p.waitForTimeout(500);
const x3 = +(await watchVal(p, 'x')); await p.waitForTimeout(300); const x4 = +(await watchVal(p, 'x')), n4 = +(await watchVal(p, 'n'));
ok(x3 > 20 && (x4 - x3) % 10 === 0 && x4 > x3, 'Strg+S: geänderter Wert (speed = 2) kommt an, x bleibt', `${x3} → ${x4}`);
ok(/gespeichert/.test(await p.textContent('#edLog')), 'Strg+S speichert dabei auch');
// Syntaxfehler: Spiel läuft weiter
await setCode(p, CODE.replace('function _draw()', 'function _draw( oops'));
await p.click('#edLive'); await p.waitForTimeout(400);
const log2 = (await p.textContent('#edLog')).split('\n').pop();
const n5 = +(await watchVal(p, 'n'));
ok(/Live/.test(await p.locator('#edLog .err').last().textContent()) && n5 > n4 && await p.evaluate(() => window.eightboy.system.state) === 'running', 'Syntaxfehler: Meldung, Spiel läuft weiter', await p.locator('#edLog .err').last().textContent());
ok(await p.locator('#edGutter .err').count() === 1, 'Fehlerzeile markiert');
// Auto-Live nach Tipp-Pause
await p.check('#dbgAuto');
await setCode(p, CODE.replace('local dx = speed', 'local dx = 0'));
await p.waitForTimeout(1400);
const x5 = +(await watchVal(p, 'x')); await p.waitForTimeout(300);
ok(+(await watchVal(p, 'x')) === x5, 'Auto-Live: nach Tipp-Pause geladen (x steht still)', String(x5));
await p.uncheck('#dbgAuto');
await shot(p, 'live-beobachten');

// Haltepunkt bleibt über Live-Neuladen erhalten und trifft die neue Funktion
await setCode(p, CODE.replace('local dx = speed', 'local dx = 7'));
await p.click('#edLive'); await p.waitForTimeout(200);
await clickGutter(p, L_X);
ok(await waitHalt(p) && /dx\s*7/.test(await varText(p)), 'Haltepunkt nach Live-Neuladen: neue Funktion, alter Stand', (await varText(p)).replace(/\s+/g, ' ').slice(0, 60));
const gx = await p.evaluate(() => [...document.querySelectorAll('#dbgVars .dbg-row.glob')].find((r) => r.querySelector('b').textContent === 'x')?.querySelector('span').textContent);
ok(+gx >= x5, 'globales x nicht zurückgesetzt', `x = ${gx}`);
// Haltepunkt wandert mit, wenn oben Zeilen dazukommen
await p.evaluate(() => { const t = document.getElementById('edText'); t.focus(); t.setSelectionRange(0, 0); document.execCommand('insertText', false, '-- neu\n-- neu\n'); });
await p.waitForTimeout(100);
ok((await p.textContent('#edGutter .bp')) === String(L_X + 2), 'Haltepunkt wandert mit seiner Zeile', await p.textContent('#edGutter .bp'));
await p.click('#edDbg [data-cmd="resume"]');
ok(errs.length === 0, 'keine JS-Fehler (Desktop)', errs.join(' | '));
await ctx.close();

// ------------------------------------------------------------------ 4. Scrollen mit echten Scrollbalken: Markierungen auf der Zeile
({ ctx, p, errs } = await fresh({ width: 1280, height: 720 }));
await p.click('#btnStudio'); await p.waitForTimeout(300);
const pad = Array.from({ length: 160 }, (_, i) => `-- Zeile ${i}`).join('\n');
const LONG = CODE.replace('x = 10', pad + '\nx = 10') + Array.from({ length: 40 }, (_, i) => `-- Ende ${i}`).join('\n');
await setCode(p, LONG);
const lx = LONG.split('\n').findIndex((l) => l.includes('x = x + dx')) + 1;
await p.evaluate((n) => { const t = document.getElementById('edText'); t.scrollTop = (n - 8) * parseFloat(getComputedStyle(t).lineHeight); t.dispatchEvent(new Event('scroll')); }, lx);
await p.waitForTimeout(100);
await clickGutter(p, lx);
await p.click('#edRun');
ok(await waitHalt(p), 'langer Code: Haltepunkt getroffen', `Zeile ${lx}`);
// ganz nach unten scrollen und zurück: Markierung bleibt auf der Zeile
await p.evaluate(() => { const t = document.getElementById('edText'); t.scrollTop = t.scrollHeight; t.dispatchEvent(new Event('scroll')); });
await p.waitForTimeout(50);
await p.evaluate((n) => { const t = document.getElementById('edText'); t.scrollTop = (n - 10) * parseFloat(getComputedStyle(t).lineHeight) + 7; t.dispatchEvent(new Event('scroll')); }, lx);
await p.waitForTimeout(50);
{
  const g = await geo(p), cur = await p.locator('.hl-curline').boundingBox(), bp = await p.locator('#edGutter .bp').boundingBox();
  const want = g.top + g.pad + (lx - 1) * g.lh - g.st;
  ok(Math.abs(cur.y - want) < 1.5, 'gescrollt: aktuelle Zeile exakt', `${cur.y.toFixed(1)} / ${want.toFixed(1)}`);
  ok(Math.abs(bp.y + bp.height / 2 - (want + g.lh / 2)) < 2, 'gescrollt: roter Punkt exakt', `${(bp.y + bp.height / 2).toFixed(1)} / ${(want + g.lh / 2).toFixed(1)}`);
}
// ganz unten: letzte Zeile und Zeilennummer bleiben deckungsgleich
await p.evaluate(() => { const t = document.getElementById('edText'); t.scrollTop = t.scrollHeight; t.dispatchEvent(new Event('scroll')); });
await p.waitForTimeout(50);
const sync = await p.evaluate(() => ({ t: document.getElementById('edText').scrollTop, g: document.getElementById('edGutter').scrollTop, h: document.getElementById('edHl').scrollTop }));
ok(sync.t === sync.g && sync.t === sync.h, 'ganz unten: Zahlen, Farben und Text gleich weit gescrollt', JSON.stringify(sync));
await shot(p, 'haltepunkt-gescrollt');
ok(errs.length === 0, 'keine JS-Fehler (Scrollen)', errs.join(' | '));
await ctx.close();

// ------------------------------------------------------------------ 5. Handy: antippen, anhalten, weiter
({ ctx, p, errs } = await fresh({ width: 390, height: 844 }, { hasTouch: true, isMobile: true, deviceScaleFactor: 2.6 }));
await p.tap('#btnStudio'); await p.waitForTimeout(400);
await setCode(p, CODE);
await clickGutter(p, L_X, true);
ok(await p.locator('#edGutter .bp').count() === 1, 'Handy: Zeilennummer antippen setzt Haltepunkt');
const outside = (sel) => p.evaluate((s) => [...document.querySelectorAll(s)].filter((e) => e.offsetParent && (e.getBoundingClientRect().right > innerWidth + 1 || e.getBoundingClientRect().bottom > innerHeight + 1)).length, sel);
ok(await outside('.ed-bar .tb') === 0, 'Handy: Studio-Leiste mit Live und Fehlersuche im Bild');
{
  const rows = await p.evaluate(() => new Set([...document.querySelectorAll('.ed-bar .tb')].filter((e) => e.offsetParent).map((e) => Math.round(e.getBoundingClientRect().top / 10))).size);
  ok(rows <= 2, 'Handy: Studio-Leiste bleibt zweizeilig', `${rows} Zeilen`);
}
await p.tap('#edRun');
ok(await waitHalt(p), 'Handy: Spiel hält an');
ok(await p.locator('#editor').isVisible() && await p.locator('#edDbg').isVisible(), 'Handy: Studio kommt mit Haltestellen-Leiste zurück');
ok(await outside('#edDbg .tb') === 0, 'Handy: Knöpfe der Leiste im Bild');
await shot(p, 'haltepunkt-handy');
await p.tap('#edDbg [data-cmd="vars"]'); await p.waitForTimeout(200);
ok(await p.locator('#edDebugPanel').isVisible() && /dx/.test(await varText(p)), 'Handy: „Variablen“ zeigt die Werte');
await shot(p, 'variablen-handy');
await p.tap('#edSideClose'); await p.waitForTimeout(150);
await p.tap('#edDbg [data-cmd="step"]'); await p.waitForTimeout(250);
ok(/Schritt/.test(await p.textContent('#edDbgWhere')), 'Handy: Schritt');
await clickGutter(p, L_X, true);
await p.tap('#edDbg [data-cmd="resume"]'); await p.waitForTimeout(400);
ok(!(await halted(p)) && await p.locator('#editor').isHidden(), 'Handy: Weiter zeigt wieder die Konsole');
ok(errs.length === 0, 'keine JS-Fehler (Handy)', errs.join(' | '));
await ctx.close();

// ------------------------------------------------------------------ 6. Vorschläge und Hilfe für net.*
({ ctx, p, errs } = await fresh({ width: 1280, height: 800 }));
await p.click('#btnStudio'); await p.waitForTimeout(300);
await setCode(p, 'function _update()\n  \nend\n');
await p.evaluate(() => { const t = document.getElementById('edText'); t.focus(); t.setSelectionRange(20, 20); });
await p.keyboard.type('ne');
const top1 = await p.locator('#edAc .ac-item .ac-l').allTextContents();
ok(top1.includes('net') && !top1.some((l) => l.startsWith('net.')), '„ne“ schlägt net vor (ohne net.xyz-Einträge)', top1.slice(0, 5).join(' '));
await p.keyboard.type('t.');
const items = await p.locator('#edAc .ac-item .ac-l').allTextContents();
ok(items.includes('join') && items.includes('send') && items.length >= 15, '„net.“ zeigt die Mehrspieler-Befehle', items.slice(0, 6).join(' '));
await p.keyboard.type('jo'); await p.keyboard.press('Enter');
ok(/net\.join\(\)/.test(await p.inputValue('#edText')), 'Übernehmen schreibt net.join()');
ok(await p.locator('#edSig').isVisible() && /net\.join\(/.test(await p.textContent('#edSig')), 'Parameterhilfe für net.join');
await p.click('.ed-bar [data-side="help"]'); await p.waitForTimeout(200);
ok(await p.locator('#edHelpPanel h4', { hasText: 'Mehrspieler' }).count() === 1 && await p.locator('#edHelpPanel h4', { hasText: 'Fehlersuche' }).count() === 1, 'Hilfe: Mehrspieler und Fehlersuche & Live');
ok(errs.length === 0, 'keine JS-Fehler (Vorschläge)', errs.join(' | '));
await ctx.close();

await b.close();
console.log(fails ? `${fails} Prüfungen fehlgeschlagen` : 'alle Debugger-Prüfungen bestanden');
process.exit(fails ? 1 : 0);
