// Test für den 8BOY Baukasten.
//   node tools/test-baukasten.mjs            nur ohne Browser: alle Vorlagen erzeugen und laufen lassen
//   node tools/test-baukasten.mjs --browser  zusätzlich wie ein Mensch im Browser (Server auf :8080 muss laufen)
//   [--shots=ordner]                          Screenshots dort ablegen
import fengari from 'fengari';
import fs from 'node:fs';
import path from 'node:path';
import { createGfx } from '../js/gfx.js';
import { createInput } from '../js/input.js';
import { createVM } from '../js/vm.js';
import { parseMML, SFX } from '../js/audio.js';
import { parseCart } from '../js/carts.js';
import { machineFor } from '../js/machines.js';
import { TEMPLATES, MUSIC_LIBRARY } from '../js/baukasten/templates.js';
import { generateLua, checkProject } from '../js/baukasten/codegen.js';
import { generateWorld, defaultGraph } from '../js/baukasten/worldgen.js';

let fails = 0;
const ok = (cond, label, extra = '') => { if (!cond) fails++; console.log(`${cond ? 'OK  ' : 'FEHL'} ${label}${extra ? '  ' + extra : ''}`); };

const audio = { play(m) { parseMML(m); }, stop() {}, sfx(n) { parseMML(SFX[n] ?? n); }, beep() {}, playing: () => false, playpos: () => -1 };

// Kartridge ohne Browser laufen lassen. script(frame) liefert die gehaltenen Tasten (Nummern).
export function runHeadless(code, frames, script = null) {
  const cart = parseCart(code, { id: 'test' });
  const machine = machineFor(cart.system);
  const gfx = createGfx(machine);
  const input = createInput();
  const logs = [];
  const store = new Map();
  const vm = createVM({ fengari, gfx, audio, input, storage: { get: (k) => store.get(k) ?? null, set: (k, v) => store.set(k, v) }, onLog: (m) => logs.push(m), machine });
  let frame = 0;
  try {
    vm.run(code, 'cart');
    let held = [];
    for (frame = 0; frame < frames; frame++) {
      if (script) held = script(frame) || [];
      else {
        if (frame % 8 === 0) held = [0, 1, 2, 3, 4, 5].filter(() => Math.random() < 0.25);
        if (frame % 300 < 20) held = [4];
      }
      for (let i = 0; i < 8; i++) input.set('key', i, held.includes(i));
      input.tick();
      vm.update(); vm.draw();
    }
    return { ok: true, logs, gfx };
  } catch (e) {
    return { ok: false, error: `Bild ${frame}: ${e.line ? 'Zeile ' + e.line + ': ' : ''}${e.message}`, logs, line: e.line };
  } finally { vm.close(); }
}

// Spion: meldet Zählerstände und Szene über log()
const PROBE = `
local __alt_update = _update
function _update()
  __alt_update()
  local t = {}
  for k, v in pairs(zaehler) do t[#t + 1] = k .. "=" .. tostring(v) end
  table.sort(t)
  local s = "szene=" .. tostring(szene_name) .. " " .. table.concat(t, " ") .. " ende=" .. tostring(ende and ende.gewonnen)
  if s ~= __letzte then __letzte = s; log(s) end
end
`;

// ------------------------------------------------------------------ 1. Musik: alle Stimmen gleich lang
for (const m of MUSIC_LIBRARY) {
  const lens = m.voices.map((v) => parseMML(v).reduce((a, e) => a + e.d, 0).toFixed(3));
  ok(new Set(lens).size === 1, `Musik „${m.name}“: Stimmen gleich lang`, lens.join(' / ') + ' s');
}

// ------------------------------------------------------------------ 2. Jede Vorlage erzeugen und laufen lassen
for (const t of TEMPLATES) {
  const p = t.make();
  const problems = checkProject(p).filter((x) => x.level === 'error');
  ok(problems.length === 0, `Vorlage „${t.name}“: keine Fehler in der Prüfung`, problems.map((x) => x.text).join('; '));
  const { code, ranges } = generateLua(p);
  ok(ranges.filter((r) => r.kind === 'rule').length === p.rules.length, `Vorlage „${t.name}“: jede Regel hat Codezeilen`);
  const r = runHeadless(code, 3600);
  ok(r.ok, `Vorlage „${t.name}“: 3600 Bilder mit Zufallstasten`, r.error || `${code.split('\n').length} Zeilen`);
  if (!r.ok) { const lines = code.split('\n'); console.log(lines.slice(Math.max(0, r.line - 4), r.line + 2).join('\n')); }
}

// ------------------------------------------------------------------ 3. Regel greift: Münze einsammeln
{
  const p = TEMPLATES[0].make();
  const wiese = p.scenes[0];
  const held = wiese.objects.find((o) => o.type === 'spieler');
  // eine Münze direkt rechts neben den Helden legen
  wiese.objects.push({ ...wiese.objects.find((o) => o.name === 'Münze'), id: 'testmuenze', x: held.x + 2, y: held.y });
  const { code } = generateLua(p);
  const r = runHeadless(code + PROBE, 90, (f) => (f > 5 && f < 40 ? [1] : []));
  ok(r.ok && r.logs.some((l) => /punkte=1\b/.test(l)), 'Top-Down: Münze einsammeln erhöht Punkte', r.error || r.logs.slice(-1)[0]);
  // Schatz berühren gewinnt
  wiese.objects.push({ ...p.scenes[1].objects.find((o) => o.name === 'Schatz'), id: 'testschatz', x: held.x, y: held.y + 2 });
  const r2 = runHeadless(generateLua(p).code + PROBE, 90, (f) => (f > 5 && f < 40 ? [3] : []));
  ok(r2.ok && r2.logs.some((l) => /ende=true/.test(l)), 'Top-Down: Schatz berühren gewinnt das Spiel', r2.error || r2.logs.slice(-1)[0]);
  // Durch die verschlossene Tür: ohne Schlüssel bleibt sie zu, mit Schlüssel geht es in die Höhle
  const p3 = TEMPLATES[0].make();
  const w3 = p3.scenes[0];
  const h3 = w3.objects.find((o) => o.type === 'spieler');
  h3.x = 25; h3.y = 8;
  const schl = p3.counters.find((c) => c.name === 'Schlüssel');
  schl.start = 1;
  const r3 = runHeadless(generateLua(p3).code + PROBE, 120, (f) => (f > 5 && f < 100 ? [2] : []));
  ok(r3.ok && r3.logs.some((l) => /szene=Höhle/.test(l)), 'Top-Down: mit Schlüssel durch die Höhlentür', r3.error || r3.logs.slice(-1)[0]);
}
{
  // Jump'n'Run: springen geht, Fahne gewinnt
  const p = TEMPLATES[1].make();
  const lvl = p.scenes[0];
  const fahne = lvl.objects.find((o) => o.name === 'Fahne');
  fahne.x = 5; fahne.y = 16;
  lvl.objects = lvl.objects.filter((o) => o.name !== 'Tipp');
  const r = runHeadless(generateLua(p).code + PROBE, 240, (f) => (f > 10 ? [1] : []));
  ok(r.ok && r.logs.some((l) => /ende=true/.test(l)), 'Jump\'n\'Run: zur Fahne laufen gewinnt', r.error || r.logs.slice(-1)[0]);
}

// ------------------------------------------------------------------ 3b. Jeder Baustein des Katalogs erzeugt lauffähigen Code
{
  const { TRIGGERS, CONDITIONS, ACTIONS, defaultParams } = await import('../js/baukasten/catalog.js');
  for (const mode of ['draufsicht', 'seitlich']) {
    const p = TEMPLATES[0].make();
    p.mode = mode;
    p.rules = TRIGGERS.map((t, i) => ({
      id: 'r' + i, on: true, trigger: { type: t.id, p: defaultParams(t, p) },
      conds: [CONDITIONS[i % CONDITIONS.length]].map((c) => ({ type: c.id, p: defaultParams(c, p), not: i % 2 === 1 })),
      actions: ACTIONS.filter((a, k) => k % TRIGGERS.length === i || (i === 0 && !['win', 'lose', 'goto_scene', 'teleport'].includes(a.id))).map((a) => ({ type: a.id, p: defaultParams(a, p, { obj: !!t.obj }) })),
    }));
    const { code } = generateLua(p);
    const r = runHeadless(code, 2400);
    ok(r.ok, `Katalog (${mode}): alle ${TRIGGERS.length} Auslöser, ${CONDITIONS.length} Bedingungen, ${ACTIONS.length} Aktionen laufen`, r.error || '');
    if (!r.ok) console.log(code.split('\n').slice(Math.max(0, r.line - 4), r.line + 2).join('\n'));
  }
  // Namen, die in Lua Schlüsselwörter sind
  const p = TEMPLATES[0].make();
  p.counters[0].name = 'end'; p.music[0].name = 'for'; p.sounds[0].name = 'if';
  const r = runHeadless(generateLua(p).code, 300);
  ok(r.ok, 'Zähler/Musik/Klang mit Namen wie Lua-Schlüsselwörter', r.error || '');
}

// ------------------------------------------------------------------ 4. Blaupause erzeugt eine Karte
{
  const p = TEMPLATES[0].make();
  const g = defaultGraph(p, 'dungeon');
  const w = generateWorld(g, p, { w: 30, h: 20 });
  ok(w && w.tiles.length === 600 && w.tiles.some((t) => t) && !w.error, 'Blaupause „Dungeon“ erzeugt eine Karte', w?.error || '');
  const g2 = defaultGraph(p, 'insel');
  const w2 = generateWorld(g2, p, { w: 40, h: 30 });
  ok(w2 && w2.tiles.length === 1200 && new Set(w2.tiles).size >= 3, 'Blaupause „Insel“ erzeugt eine Karte mit mehreren Kacheln', w2?.error || String(new Set(w2?.tiles).size));
  const again = generateWorld(g2, p, { w: 40, h: 30 });
  ok(JSON.stringify(again.tiles) === JSON.stringify(w2.tiles), 'Blaupause: gleicher Samen = gleiche Karte');
}

// ------------------------------------------------------------------ 5. Im Browser, wie ein Mensch
if (process.argv.includes('--browser')) {
  const shotsArg = process.argv.find((a) => a.startsWith('--shots='));
  await browserTest(shotsArg ? shotsArg.slice(8) : null);
}

async function browserTest(shots) {
  const { chromium } = await import('playwright');
  const url = (process.argv.find((a) => /^https?:/.test(a)) || 'http://localhost:8080/').replace(/\/?$/, '/');
  const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  p.on('console', (m) => { if (m.type() === 'error' && !/404|Failed to load resource/.test(m.text())) errs.push(m.text()); });
  const shot = async (name, page = p) => { if (shots) { fs.mkdirSync(shots, { recursive: true }); await page.screenshot({ path: path.join(shots, name + '.png') }); } };
  const proj = () => p.evaluate(() => window.baukasten.store.project);
  const menu = async (label) => { await p.locator('.pop .pop-i', { hasText: label }).first().click(); };

  await p.goto(url + 'baukasten.html');
  await p.waitForSelector('.tpl');
  ok(await p.locator('.tpl').count() >= 2, 'Baukasten: Vorlagen werden angeboten');
  await shot('01-start');

  // 1. Neues Spiel aus der leeren Vorlage
  await p.click('.tpl[data-tpl="leer-oben"]');
  await p.waitForSelector('.map-c');
  let pr = await proj();
  ok(pr && pr.scenes.length === 1, 'Neues Spiel angelegt', pr?.title);
  await p.fill('#projTitle', 'Testabenteuer');
  await p.locator('#projTitle').press('Tab');

  // 2. Karte malen: Wasser-Kacheln mit dem Stift, Rechteck aus Mauer
  const tileN = (name) => pr.sprites.find((s) => s.name === name).n;
  const box = await p.locator('.map-c').boundingBox();
  const cell = box.width / pr.scenes[0].w;
  const at = (x, y) => ({ x: box.x + (x + 0.5) * cell, y: box.y + (y + 0.5) * cell });
  await p.click(`.tile-b[data-tile="${tileN('Wasser')}"]`);
  let c = at(10, 4); await p.mouse.move(c.x, c.y); await p.mouse.down();
  for (let x = 11; x <= 16; x++) { c = at(x, 4); await p.mouse.move(c.x, c.y); }
  await p.mouse.up();
  await p.click(`.tile-b[data-tile="${tileN('Mauer')}"]`);
  await p.click('[data-tool="rect"]');
  c = at(20, 12); await p.mouse.move(c.x, c.y); await p.mouse.down(); c = at(24, 15); await p.mouse.move(c.x, c.y); await p.mouse.up();
  pr = await proj();
  const t = pr.scenes[0].tiles, W = pr.scenes[0].w;
  ok(t[4 * W + 10] === tileN('Wasser') && t[4 * W + 16] === tileN('Wasser'), 'Karte malen: Stiftstrich liegt in der Karte');
  ok(t[12 * W + 20] === tileN('Mauer') && t[15 * W + 24] === tileN('Mauer'), 'Karte malen: Rechteck aus Mauer');
  await p.keyboard.press('Control+z');
  ok((await proj()).scenes[0].tiles[12 * W + 20] !== tileN('Mauer'), 'Strg+Z nimmt das Rechteck zurück');
  await p.keyboard.press('Control+y');
  ok((await proj()).scenes[0].tiles[12 * W + 20] === tileN('Mauer'), 'Strg+Y stellt es wieder her');

  // 3. Objekte setzen: Münze direkt rechts neben dem Spieler, ein Gegner, eine Figur
  const held = pr.scenes[0].objects.find((o) => o.type === 'spieler');
  await p.click('.obj-t[data-type="sammel"]');
  c = at(held.x + 2, held.y); await p.mouse.click(c.x, c.y);
  await p.click('.obj-t[data-type="gegner"]');
  c = at(20, 6); await p.mouse.click(c.x, c.y);
  await p.click('.obj-t[data-type="figur"]');
  c = at(held.x, held.y - 4); await p.mouse.click(c.x, c.y);
  await p.locator('.bk-side input[data-fid="o-name"]').fill('Eule');
  await p.locator('.bk-side input[data-fid="o-name"]').press('Tab');
  pr = await proj();
  const objs = pr.scenes[0].objects;
  ok(objs.some((o) => o.type === 'sammel' && o.x === held.x + 2 && o.y === held.y), 'Objekt setzen: Münze neben dem Spieler');
  ok(objs.some((o) => o.type === 'gegner') && objs.some((o) => o.type === 'figur' && o.name === 'Eule'), 'Objekt setzen: Gegner und Figur „Eule“');
  await shot('02-szene');

  // 4. Dialog mit Antwort
  await p.click('.nav-b[data-sec="dialoge"]');
  await p.click('.empty-c .btn.primary');
  await p.waitForSelector('.dcard');
  await p.locator('[data-fid="k-who"]').fill('Eule');
  await p.locator('[data-fid="k-text"]').fill('Huhu! Magst du Münzen?');
  await p.locator('.bk-side .btn', { hasText: '+ Antwort' }).click();
  await p.locator('.bk-side .btn', { hasText: '+ Neue Karte danach' }).click();
  await p.locator('[data-fid="k-text"]').fill('Dann lauf nach rechts!');
  await p.locator('.dcard').first().click({ position: { x: 60, y: 12 } });
  await p.locator('.bk-side .choice-r select').first().selectOption({ index: 1 });
  pr = await proj();
  const dlg = pr.dialogs[0];
  ok(dlg && dlg.cards.length === 2 && dlg.cards[0].choices.length === 1 && dlg.cards[0].choices[0].next === dlg.cards[1].id, 'Dialog: zwei Karten, Antwort führt zur zweiten');
  await shot('03-dialog');
  // Figur bekommt den Dialog
  await p.click('.nav-b[data-sec="szenen"]');
  if (await p.locator('.bk-side ul.objlist').count()) await p.click('.bk-side ul.objlist button:has-text("Eule")');
  ok(await p.locator('.bk-side .side-head h3').textContent() === 'Eule', 'Figur „Eule“ ist ausgewählt');
  await p.locator('.bk-side .fld', { hasText: 'Dialog' }).locator('select').selectOption(dlg.id);
  pr = await proj();
  ok(pr.scenes[0].objects.find((o) => o.name === 'Eule').dialog === dlg.id, 'Figur „Eule“ spricht den Dialog');

  // 5. Drei Regeln anlegen
  await p.click('.nav-b[data-sec="regeln"]');
  // Regel 1: Wenn der Spieler „Münze“ berührt → verschwindet, Punkte +1, Klang
  await p.click('.h1row .btn.primary'); await menu('Spieler berührt');
  let card = p.locator('.rule').last();
  await card.locator('.blk.when select').selectOption('name:Münze');
  await card.locator('.add-act').click(); await menu('Objekt verschwinden lassen');
  await card.locator('.add-act').click(); await menu('Zähler ändern');
  await card.locator('.add-act').click(); await menu('Klang spielen');
  // Regel 2: Wenn das Spiel startet → Text anzeigen
  await p.click('.h1row .btn.primary'); await menu('Das Spiel startet');
  card = p.locator('.rule').last();
  await card.locator('.add-act').click(); await menu('Text anzeigen');
  // Regel 3: Wenn der Spieler einen Gegner berührt und nicht geschützt → Punkte −1, zurückstoßen
  await p.click('.h1row .btn.primary'); await menu('Spieler berührt');
  card = p.locator('.rule').last();
  await card.locator('.blk.when select').selectOption('art:gegner');
  await card.locator('.add-and').click(); await menu('Spieler nicht geschützt');
  await card.locator('.add-act').click(); await menu('Zähler ändern');
  await card.locator('.act select').nth(1).selectOption('-');
  await card.locator('.add-act').click(); await menu('Spieler zurückstoßen');
  pr = await proj();
  ok(pr.rules.length === 3 && pr.rules[0].actions.length === 3 && pr.rules[2].conds.length === 1, 'Drei Regeln angelegt', pr.rules.map((r) => r.trigger.type + ':' + r.actions.map((a) => a.type).join('+')).join(' | '));
  ok(pr.rules[0].trigger.p.what === 'name:Münze' && pr.rules[0].actions[1].type === 'counter_add', 'Regel 1: Münze → Punkte');
  ok(await p.locator('.code-mini').count() === 1, 'Regel zeigt ihren Lua-Code rechts');
  await shot('04-regeln');

  // 6. Vorschau, Code ansehen
  await p.click('.nav-b[data-sec="spielen"]');
  await p.waitForTimeout(800);
  const pv = await p.evaluate(() => ({ running: window.baukasten.preview?.running, err: !document.querySelector('.err-box')?.hidden }));
  ok(pv.running && !pv.err, 'Eingebaute Vorschau läuft ohne Fehler');
  await shot('05-vorschau');
  await p.click('.tab:has-text("Code ansehen")');
  await p.locator('.code-nav button[data-rule]').first().hover();
  ok(await p.locator('.cl.hi').count() > 2, 'Code ansehen: Zeilen der Regel leuchten auf', `${await p.locator('.cl.hi').count()} Zeilen`);
  await shot('06-code');

  // 7. Ohne Browser: die Kartridge aus dem Baukasten läuft fehlerfrei, die Münzregel greift
  const code = await p.evaluate(() => window.baukasten.buildCart().code);
  const r1 = runHeadless(code, 3600);
  ok(r1.ok, 'Erzeugte Kartridge: 3600 Bilder mit Zufallstasten', r1.error || '');
  const r2 = runHeadless(code + PROBE, 90, (f) => (f > 5 && f < 50 ? [1] : []));
  ok(r2.ok && r2.logs.some((l) => /punkte=1\b/.test(l)), 'Erzeugte Kartridge: Münze einsammeln → Punkte 1', r2.error || r2.logs.slice(-1)[0]);

  // 8. Spielen → Konsole
  const [konsole] = await Promise.all([p.waitForEvent('popup'), p.click('#playBtn')]);
  const kerrs = [];
  konsole.on('pageerror', (e) => kerrs.push(e.message));
  await konsole.waitForFunction(() => window.eightboy?.carts.length, null, { timeout: 20000 });
  const found = await konsole.evaluate(() => window.eightboy.carts.filter((x) => x.title === 'Testabenteuer').map((x) => ({ id: x.id, kind: x.kind })));
  ok(found.length === 1, 'Konsole: Kartridge liegt im Regal', JSON.stringify(found));
  // #cart=<id> legt die Kartridge von selbst ein (die Konsole entfernt den Hash danach)
  await konsole.waitForFunction(() => window.eightboy.system.cart?.title === 'Testabenteuer', null, { timeout: 10000 }).catch(() => {});
  ok(await konsole.evaluate(() => window.eightboy.system.cart?.title) === 'Testabenteuer', 'Konsole legt die Kartridge über #cart=… selbst ein');
  await konsole.waitForFunction(() => window.eightboy.system.state === 'running', null, { timeout: 20000 }).catch(() => {});
  ok(await konsole.evaluate(() => window.eightboy.system.state) === 'running', 'Konsole: system.state === "running"');
  await konsole.waitForTimeout(400);
  const hud = () => konsole.evaluate(() => Array.from(window.eightboy.gfx.fb.slice(0, 240 * 11)).join(','));
  const before = await hud();
  await konsole.keyboard.down('ArrowRight'); await konsole.waitForTimeout(700); await konsole.keyboard.up('ArrowRight');
  await konsole.waitForTimeout(300);
  const after = await hud();
  ok(before !== after && await konsole.evaluate(() => window.eightboy.system.state) === 'running', 'Konsole: Münze eingesammelt – die Punkteanzeige ändert sich');
  await shot('07-konsole', konsole);
  ok(!kerrs.length, 'Konsole ohne Skriptfehler', kerrs.join(' | '));
  await konsole.close();

  // 9. Export / Import
  const json = await p.evaluate(() => window.baukasten.store.exportJSON());
  const n0 = await p.evaluate(() => window.baukasten.store.list.length);
  await p.evaluate((j) => window.baukasten.store.importJSON(j), json);
  ok(await p.evaluate(() => window.baukasten.store.list.length) === n0 + 1, 'Export als JSON und wieder einlesen');

  // 10. Jump'n'Run-Vorlage und Blaupause
  await p.click('.nav-b[data-sec="projekt"]');
  await p.click('.tpl[data-tpl="jump"]');
  await p.click('.modal .btn.primary');
  await p.waitForSelector('.map-c');
  await shot('08-jump');
  await p.click('.nav-b[data-sec="blaupausen"]');
  await p.click('.empty-c .btn.primary');
  await p.waitForSelector('.node');
  ok(await p.locator('.node').count() >= 5 && await p.locator('.links path').count() >= 5, 'Blaupause: Knoten und Kabel', `${await p.locator('.node').count()} Knoten`);
  await shot('09-blaupause');
  await p.locator('.bk-side .btn.primary').click();
  await p.click('.modal .btn.primary');
  await p.waitForSelector('.map-c');
  pr = await proj();
  ok(new Set(pr.scenes[0].tiles).size >= 3, 'Blaupause in Szene übernommen');
  const r3 = runHeadless(await p.evaluate(() => window.baukasten.buildCart().code), 1800);
  ok(r3.ok, 'Jump\'n\'Run mit erzeugter Welt läuft', r3.error || '');

  ok(!errs.length, 'Baukasten ohne Skriptfehler', errs.join(' | '));
  await b.close();
}

console.log(fails ? `\n${fails} Prüfung(en) fehlgeschlagen` : '\nAlles grün.');
process.exit(fails ? 1 : 0);
