// Dock testen: TV-Modus, mehrere Gamepads, Handy als Controller.  node tools/test-dock.mjs [--nobrowser]
//   1. Eingabe (Node): Plätze per START, btn(taste, spieler), players(), pad(), stick(n, p), Handys, Lua-API
//   2. Lobby (Node): Fernseher-Raum, Code, falscher Code, 4 Handys, Weiterleitung + Laufzeit, Ratenbremse, Ende
//   3. Browser (Playwright, braucht tools/serve.mjs auf :8080): TV-Bilder 1920×1080 und 1280×720, emulierte
//      Xbox-/PS-Gamepads, Bedienen von Regal/Fenster mit dem Steuerkreuz, Handy-Controller Ende zu Ende mit Latenz
process.env.POW_BITS = process.env.POW_BITS || '12';
import fs from 'node:fs';
import path from 'node:path';
import fengari from 'fengari';

const root = path.resolve(import.meta.dirname, '..');
const OUT = process.env.SHOTS || path.join(root, 'shots', 'dock');
fs.mkdirSync(OUT, { recursive: true });
let fails = 0;
const ok = (c, name, info = '') => { if (!c) fails++; console.log(`${c ? 'OK  ' : 'FEHL'} ${name}${info ? ' · ' + info : ''}`); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 4000) { const t = Date.now(); while (Date.now() - t < ms) { if (await fn()) return true; await wait(15); } return false; }
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };

// ------------------------------------------------------------------ 1. Eingabe
const pads = [];
const mkPad = (id) => { const p = { index: pads.length, id, connected: true, axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false })) }; pads.push(p); return p; };
Object.defineProperty(globalThis.navigator, 'getGamepads', { value: () => pads.slice(), configurable: true });
const { createInput, padLabels } = await import('../js/input.js');
const { createVM } = await import('../js/vm.js');
const { createGfx } = await import('../js/gfx.js');
const { machineFor } = await import('../js/machines.js');

{
  const input = createInput();
  input.setSuper(true);
  const joins = [];
  input.onJoin((e) => joins.push(e));
  input.set('key', 4, true); input.tick();
  ok(input.btn(4) && input.btn(4, 1) && !input.btn(4, 2), 'Tastatur: btn(A) und btn(A, 1), nicht Spieler 2');
  ok(input.players() === 1 && input.pad(1) === 'tastatur' && input.pad(2) === null, 'ohne Gamepads: 1 Spieler, pad(1) = tastatur');
  input.set('key', 4, false);
  const x = mkPad('Xbox 360 Controller (XInput STANDARD GAMEPAD)');
  input.tick();
  ok(input.pad(1) === 'tastatur' && !joins.length, 'angeschlossenes, unbenutztes Gamepad belegt keinen Platz');
  x.buttons[1].pressed = true; input.tick();   // rechte Taste = A
  ok(input.btn(4) && input.btn(4, 1) && input.pad(1) === 'xbox' && joins[0]?.slot === 1, 'erstes benutztes Gamepad wird Spieler 1 (losspielen ohne START)', JSON.stringify(joins[0]));
  x.buttons[1].pressed = false; input.tick();
  const ps = mkPad('DualSense Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 0ce6)');
  ps.buttons[1].pressed = true; input.tick();
  ok(input.btn(4) && !input.btn(4, 1) && !input.btn(4, 2), 'zweites Gamepad ohne Platz: nur in btn(A), nicht bei Spieler 1/2');
  ps.buttons[1].pressed = false; ps.buttons[9].pressed = true; input.tick(); ps.buttons[9].pressed = false; input.tick();
  ok(input.pad(2) === 'ps' && input.players() === 2, 'PlayStation: START → Spieler 2, players() = 2');
  ps.buttons[0].pressed = true; input.tick();
  ok(input.btn(5, 2) && !input.btn(5, 1) && input.btnp(5, 2), 'Spieler 2: B gedrückt, Spieler 1 nicht');
  input.tick();
  ok(input.btn(5, 2) && !input.btnp(5, 2), 'btnp(B, 2) nur im ersten Bild');
  ps.buttons[0].pressed = false;
  ps.axes[0] = 0.8; ps.axes[1] = -0.4; input.tick();
  const [sx, sy] = input.stick(0, 2), [s1x] = input.stick(0, 1);
  ok(Math.abs(sx - 0.8) < 1e-6 && Math.abs(sy + 0.4) < 1e-6 && s1x === 0, 'stick(0, 2) = Stick von Spieler 2', `${sx}, ${sy}`);
  ps.axes[0] = 0; ps.axes[1] = 0;
  const slot = input.phoneAdd(77);
  input.phoneSet(77, 1 << 4); input.tick();
  ok(slot === 3 && input.pad(3) === 'handy' && input.btn(4, 3) && input.btn(4) && !input.btn(4, 2), 'Handy: gleich Spieler 3, A kommt an');
  input.phoneRemove(77); input.tick();
  ok(input.pad(3) === null && !input.btn(4), 'Handy weg: Platz 3 frei');
  pads[1] = null; input.tick();
  ok(input.pad(2) === null && joins.some((e) => e.type === 'leave' && e.slot === 2), 'PS-Gamepad abgezogen: Platz 2 frei');
  input.clear(); input.tick();
  ok(input.pad(1) === 'xbox', 'clear() (Kartridge-Start) behält die Plätze');
  ok(padLabels('xbox').A === 'B' && padLabels('ps').B === '✕' && padLabels('switch').A === 'A', 'Beschriftung nach Controller (Xbox A = B rechts)');
  pads.length = 0; input.tick();

  // Lua-API
  const gfx = createGfx(machineFor(32)), logs = [];
  const vm = createVM({ fengari, gfx, audio: { play() {}, stop() {}, sfx() {}, beep() {}, playing() { return false; }, playpos() { return 0; } }, input, storage: { get: () => null, set() {} }, onLog: (m) => logs.push(m), machine: machineFor(32) });
  const g = mkPad('Pro Controller (STANDARD GAMEPAD Vendor: 057e)');
  g.buttons[9].pressed = true; input.tick(); g.buttons[9].pressed = false; input.tick();
  g.buttons[3].pressed = true; g.axes[0] = -1; input.tick();
  vm.run('function _update() local x, y = stick(0, 1) log(players(), pad(1), pad(2), btn(X, 1), btn(X, 2), btn(X), x) end', 'cart');
  vm.update();
  ok(logs[0] === '1 switch nil true false true -1.0' || logs[0] === '1  switch  nil  true  false  true  -1.0', 'Lua: players(), pad(), btn(X, p), stick(0, p)', logs[0]);
  vm.close();
  pads.length = 0;
}

// ------------------------------------------------------------------ 1b. rumble() und padinfo()
{
  const { rumblePattern, padinfoClean, RUMBLE } = await import('../js/input.js');
  ok(rumblePattern('sieg') === RUMBLE.sieg && rumblePattern(250).v[0] === 250 && rumblePattern(9999).v[0] === 1500 && rumblePattern([50, 30, 50]).v.length === 3 && rumblePattern('quak') === null,
    'Muster: Name, Millisekunden (gedeckelt), Liste, unbekannt = nichts');
  const c = padinfoClean('Du bist die Katze! ' + 'x'.repeat(60), 0xff8a3d, 'Katze');
  ok([...c.txt].length === 40 && c.bg === 0xff8a3d && c.sym === 'katze' && padinfoClean('', 1, 'gibtsnicht') === null && padinfoClean('\u0007hi\n', 'rot', 'x').bg === undefined,
    'padinfo: Text auf 40 Zeichen, Farbe, Symbol nur aus der Liste, leer = löschen', JSON.stringify(c));

  const input = createInput();
  input.setSuper(true);
  // Gamepad mit Rüttelmotor
  const effects = [];
  const g = mkPad('Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e)');
  g.vibrationActuator = { playEffect: (type, o) => { effects.push({ type, ...o }); return Promise.resolve('complete'); } };
  g.buttons[0].pressed = true; input.tick(); g.buttons[0].pressed = false; input.tick();   // losspielen → Spieler 1
  // Handy über den Dock-Rückweg
  const out = [];
  input.setPadOut({ rumble: (id, v) => out.push({ id, v }), show: (id) => out.push({ id, show: input.padshow(2) }) });
  input.phoneAdd(7);
  ok(input.pad(1) === 'xbox' && input.pad(2) === 'handy', 'Spieler 1 Gamepad, Spieler 2 Handy');
  input.rumble(1, rumblePattern('treffer'));
  input.rumble(1, rumblePattern('treffer'));   // gleich danach: gedrosselt
  await wait(30);
  ok(effects.length === 1 && effects[0].type === 'dual-rumble' && effects[0].duration === 110 && effects[0].strongMagnitude === 0.8, 'rumble(1): Gamepad rüttelt (dual-rumble), zweiter Aufruf sofort danach gedrosselt', JSON.stringify(effects));
  await wait(110);
  input.rumble(0, rumblePattern('sieg'));
  await wait(700);
  ok(out.some((o) => o.id === 7 && o.v === RUMBLE.sieg.v) && effects.length === 1 + 4, 'rumble() ohne Spieler: Handy bekommt das Muster, Gamepad spielt alle 4 „an“-Stücke', `${effects.length} Effekte`);
  out.length = 0;
  input.rumble(3, rumblePattern('tipp'));   // Platz 3 frei
  ok(!out.length, 'rumble(3) ohne Gerät: nichts');
  input.padinfo(2, padinfoClean('Du bist die Katze!', 0xff8a3d, 'katze'));
  input.padinfo(2, padinfoClean('Du bist die Katze!', 0xff8a3d, 'katze'));   // unverändert: keine zweite Nachricht
  ok(out.length === 1 && out[0].id === 7 && out[0].show.sym === 'katze', 'padinfo(2, …): Handy von Spieler 2 bekommt die Anzeige (einmal)');
  input.padinfo(1, padinfoClean('Krone', 0xffd84a, 'krone'));
  ok(out.length === 1 && input.padshow(1).txt === 'Krone', 'padinfo(1) mit Gamepad: gemerkt, aber nichts zu senden');
  input.padReset();
  ok(out.length === 2 && out[1].show === null && input.padshow(1) === null, 'Kartridge-Ende: Anzeigen weg, Handy erfährt es');

  // Lua: mit Gerät, ohne Dock (Testläufer), mit leerer Eingabe – nie ein Fehler
  const audio = { play() {}, stop() {}, sfx() {}, beep() {}, playing() { return false; }, playpos() { return 0; } };
  const code = `function _update()
    rumble(2, "aua") rumble("sieg") rumble() rumble(nil, 300) rumble(1, {40, 30, 80}) rumble(9, "tipp") rumble(2, "quak") rumble(true)
    padinfo(2, "Du bist die Katze!", 0xff8a3d, "katze") padinfo(3, "frei") padinfo(nil, 42) padinfo(2) padinfo() padinfo(2, nil, nil, "stern")
    log("ok")
  end`;
  for (const [name, inp] of [['mit Handy', input], ['ohne Dock', createInput()], ['leere Eingabe', {}]]) {
    const logs = [];
    out.length = 0;
    await wait(120);
    const vm = createVM({ fengari, gfx: createGfx(machineFor(64)), audio, input: inp, storage: { get: () => null, set() {} }, onLog: (m) => logs.push(m), machine: machineFor(64) });
    let err = null;
    try { vm.run(code, 'cart'); vm.update(); vm.update(); } catch (e) { err = e; }
    ok(!err && logs.includes('ok'), `Lua rumble()/padinfo() ${name}: kein Fehler`, err?.message || logs.filter((l) => l !== 'ok').join(' | '));
    if (inp === input) ok(out.some((o) => o.v === RUMBLE.aua.v) && input.padshow(2)?.sym === 'stern' && logs.some((l) => l.includes('unbekanntes Muster')), 'Lua: Muster kommt am Handy an, letzte Anzeige gilt, unbekanntes Muster nur ein Hinweis');
    vm.close();
  }
  pads.length = 0;
}

// ------------------------------------------------------------------ 2. Lobby
const { startServer } = await import('../server/lobby.mjs');
const { createPadHost, createPadClient } = await import('../js/padnet.js');
{
  const server = startServer(0);
  await new Promise((r) => server.on('listening', r));
  const url = `ws://localhost:${server.address().port}/mp`;
  class WSO extends WebSocket { constructor(u) { super(u, { headers: { origin: 'http://localhost:8080' } }); } }
  const got = [], joined = [], left = [];
  const host = createPadHost({ url, WS: WSO, onJoin: (id) => joined.push(id), onLeave: (id) => left.push(id), onKeys: (id, b) => got.push({ id, b, at: performance.now() }) });
  host.open();
  ok(await until(() => host.status === 'bereit'), 'Fernseher bekommt einen Raum', host.code);
  ok(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/.test(host.code), 'Code: 6 Zeichen ohne Verwechsler');
  const wrong = createPadClient('ZZZZZZ', { url, WS: WSO });
  ok(await until(() => wrong.status === 'fehler'), 'falscher Code: getrennt mit Meldung', wrong.error);
  let info = null;
  const pad = createPadClient(host.code.toLowerCase(), { url, WS: WSO, onInfo: (d) => { info = d; } });
  ok(await until(() => pad.status === 'verbunden' && joined.length === 1), 'Handy tritt mit Code bei (Groß/klein egal)');
  host.info(joined[0], { p: 2, sys: 16 });
  ok(await until(() => info?.p === 2 && info?.sys === 16), 'Fernseher → Handy: Spielernummer und Konsole');
  // Laufzeit: Taste am Handy → Fernseher (über den lokalen Server)
  const lat = [];
  for (let i = 0; i < 40; i++) {
    const n = got.length, t = performance.now();
    pad.send(i % 2 ? 0 : (1 << 4) | (1 << (i % 4)));
    await until(() => got.length > n, 1000);
    lat.push(got[got.length - 1].at - t);
    await wait(5);
  }
  ok(got.length >= 40 && got[0].b === ((1 << 4) | 1), 'Tasten kommen an (Bitmaske)', `${got.length} Nachrichten`);
  console.log(`     Laufzeit Handy → Fernseher (lokal): Median ${median(lat).toFixed(1)} ms, max ${Math.max(...lat).toFixed(1)} ms`);
  pad.send(0);
  // Ratenbremse: 300 Nachrichten in einer Sekunde – höchstens 60 kommen durch
  const raw = new WSO(url);
  const { solvePow } = await import('../js/net.js');
  let rawOk = false;
  raw.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.t === 'challenge') raw.send(JSON.stringify({ t: 'pad', code: host.code, pow: solvePow(m.c, m.bits) })); if (m.t === 'padok') rawOk = true; };
  await until(() => rawOk);
  await wait(1100 - (Date.now() % 1000));   // am Anfang einer Sekunde starten
  const before = got.length;
  for (let i = 0; i < 300; i++) raw.send(JSON.stringify({ t: 'k', b: i & 0xfff }));
  await wait(400);
  ok(got.length - before <= 60, 'Ratenbremse: höchstens 60 Tasten-Nachrichten je Sekunde', `${got.length - before} von 300`);
  // höchstens 4 Handys
  const more = [createPadClient(host.code, { url, WS: WSO }), createPadClient(host.code, { url, WS: WSO })];
  await until(() => more.every((c) => c.status === 'verbunden'));
  const fifth = createPadClient(host.code, { url, WS: WSO });
  ok(await until(() => fifth.status === 'fehler'), 'fünftes Handy abgewiesen', fifth.error);
  const status = await (await fetch(`http://localhost:${server.address().port}/mp/status`)).json();
  ok(status.tvs === 1, '/mp/status zählt Fernseher', JSON.stringify(status));
  host.close();
  ok(await until(() => pad.status !== 'verbunden' && more.every((c) => c.status !== 'verbunden')), 'Fernseher weg: Handys werden getrennt', pad.error);
  raw.close(); [wrong, pad, fifth, ...more].forEach((c) => c.close());
  server.close();
  await wait(100);
}

// ------------------------------------------------------------------ 3. Browser
if (!process.argv.includes('--nobrowser')) {
  const BASE = process.argv.find((a) => /^https?:/.test(a)) || 'http://localhost:8080/';
  let lobby = null;
  try { await fetch('http://localhost:8787/mp/status'); } catch { lobby = startServer(8787); await new Promise((r) => lobby.on('listening', r)); }
  const { chromium } = await import('playwright');
  const b = await chromium.launch();
  const gamepadScript = () => {
    const list = [];
    window.__pads = list;
    window.__addPad = (id) => { list.push({ index: list.length, id, connected: true, mapping: 'standard', axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })), timestamp: 0 }); return list.length - 1; };
    window.__btn = (i, n, on) => { list[i].buttons[n].pressed = on; list[i].buttons[n].value = on ? 1 : 0; };
    Object.defineProperty(Navigator.prototype, 'getGamepads', { value: () => list.slice(), configurable: true });
  };
  const errs = [];
  async function tvPage(w, h, model, extra = '') {
    const ctx = await b.newContext({ viewport: { width: w, height: h } });
    await ctx.addInitScript(gamepadScript);
    await ctx.addInitScript((m) => { localStorage.setItem('8boy:settings', JSON.stringify({ model: m, volume: 0 })); }, model);
    const p = await ctx.newPage();
    p.on('pageerror', (e) => errs.push(e.message));
    await p.goto(BASE + '?alle&tv' + extra);
    await p.waitForFunction(() => window.eightboy?.carts?.length > 0);
    await p.evaluate(() => window.eightboy.powerOn());
    return { ctx, p };
  }
  const press = async (p, pad, n, frames = 4) => { await p.evaluate(([i, k]) => window.__btn(i, k, true), [pad, n]); await p.waitForTimeout(frames * 17); await p.evaluate(([i, k]) => window.__btn(i, k, false), [pad, n]); await p.waitForTimeout(60); };

  // TV-Bilder aller drei Konsolen
  for (const [w, h, model] of [[1920, 1080, 8], [1920, 1080, 16], [1920, 1080, 32], [1280, 720, 32]]) {
    const { ctx, p } = await tvPage(w, h, model);
    await p.waitForTimeout(3200);
    const r = await p.evaluate(() => ({ tv: document.body.classList.contains('tv'), g: document.querySelector('.glass').getBoundingClientRect().toJSON(), host: window.eightboy.dock.host.status, panel: !document.getElementById('tvPanel').hidden }));
    const m = { 8: [240, 160], 16: [256, 224], 32: [320, 240] }[model];
    const k = r.g.width / m[0];
    ok(r.tv && r.g.height >= (h - 64) * 0.85 && r.g.bottom <= h - 50 && Math.abs(r.g.height / r.g.width - m[1] / m[0]) < 0.01, `TV ${w}×${h} Konsole ${model}: Bild füllt die Höhe über der Statusleiste`, `${Math.round(r.g.width)}×${Math.round(r.g.height)}${Number.isInteger(k) ? ` (×${k} ganzzahlig)` : ''} · Handy-Raum ${r.host}`);
    await p.screenshot({ path: path.join(OUT, `tv-${w}x${h}-${model}.png`) });
    await ctx.close();
  }

  // Gamepads, Plätze, Navigation, Handy
  const { ctx, p } = await tvPage(1920, 1080, 8);
  await p.evaluate(() => { window.__addPad('Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e Product: 0b13)'); window.__addPad('DualShock 4 (STANDARD GAMEPAD Vendor: 054c)'); });
  await p.waitForTimeout(2600);   // Boot-Logo vorbei
  await press(p, 0, 9);
  await press(p, 1, 9);
  const chips = await p.evaluate(() => [...document.querySelectorAll('.tv-chip')].map((c) => c.textContent));
  ok(chips[0].includes('Xbox') && chips[1].includes('PlayStation'), 'Statusleiste: Spieler 1 Xbox, Spieler 2 PlayStation', chips.join(' | '));
  const cardText = await p.evaluate(() => document.getElementById('tvCard').textContent);
  ok(/Spieler 2.*PlayStation/.test(cardText) && cardText.includes('○'), 'Hinweis mit Beschriftung des Controllers', cardText);
  await p.screenshot({ path: path.join(OUT, 'tv-gamepads.png') });

  // Startmenü: Regal mit A öffnen, mit dem Steuerkreuz bedienen
  await p.evaluate(() => localStorage.setItem('8boy:unpacked', JSON.stringify(window.eightboy.carts.map((c) => c.id))));
  await p.reload();
  await p.waitForFunction(() => window.eightboy?.carts?.length > 0);
  await p.evaluate(() => { window.__addPad('Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e)'); window.eightboy.powerOn(); });
  await p.waitForTimeout(2800);
  await press(p, 0, 1);   // A → Kartridge-Regal
  ok(await until(() => p.evaluate(() => document.getElementById('app').classList.contains('shelf-open') && window.eightboy.dock.navActive())), 'A im Startmenü öffnet das Regal, Steuerkreuz bedient es');
  await p.waitForTimeout(200);
  const f0 = await p.evaluate(() => document.querySelector('.tv-focus')?.textContent);
  await press(p, 0, 15); await press(p, 0, 15);  // zweimal rechts
  const f1 = await p.evaluate(() => document.querySelector('.tv-focus')?.textContent);
  ok(f0 && f1 && f0 !== f1, 'Fokus wandert mit dem Steuerkreuz', `${f0?.slice(0, 20)} → ${f1?.slice(0, 20)}`);
  await p.screenshot({ path: path.join(OUT, 'tv-regal.png') });
  // zur Lektion 1 wandern: Fokus direkt setzen geht nicht – also die Lektion-8-Kachel per Suche anwählen
  const target = await p.evaluate(() => {
    const els = [...document.querySelectorAll('#shelf .cart')];
    return els.findIndex((e) => e.textContent.includes('Hallo 8BOY'));
  });
  ok(target >= 0, 'Lektion 1: Hallo 8BOY liegt im Regal (localhost: alles)');
  for (let i = 0; i < 40; i++) {
    const t = await p.evaluate(() => document.querySelector('.tv-focus')?.textContent || '');
    if (t.includes('Hallo 8BOY')) break;
    const dir = await p.evaluate(() => {
      const f = document.querySelector('.tv-focus').getBoundingClientRect(), g = [...document.querySelectorAll('#shelf .cart')].find((e) => e.textContent.includes('Hallo 8BOY')).getBoundingClientRect();
      return Math.abs(g.top - f.top) > 20 ? (g.top > f.top ? 13 : 12) : (g.left > f.left ? 15 : 14);
    });
    await press(p, 0, dir, 2);
  }
  await press(p, 0, 1);   // A → Kartridge-Fenster
  ok(await until(() => p.evaluate(() => !document.getElementById('cartDialog').hidden && document.getElementById('cdTitle').textContent === 'Lektion 1: Hallo 8BOY')), 'A öffnet das Kartridge-Fenster der Lektion 1: Hallo 8BOY');
  await p.waitForTimeout(150);
  await p.screenshot({ path: path.join(OUT, 'tv-fenster.png') });
  await press(p, 0, 1);   // A → Einlegen (Fokus steht auf „Einlegen“)
  ok(await until(() => p.evaluate(() => window.eightboy.system.state === 'running' && window.eightboy.system.cart?.title === 'Lektion 1: Hallo 8BOY'), 6000), 'A legt ein: Lektion 1: Hallo 8BOY läuft');

  // Handy als Controller
  const code = await p.evaluate(() => window.eightboy.dock.host.code);
  const phoneCtx = await b.newContext({ viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  // Vollbild beim ersten Antippen würde das Testfenster festsetzen (Größe nicht mehr änderbar)
  const noFull = () => { Element.prototype.requestFullscreen = function () { window.__full = (window.__full || 0) + 1; return Promise.resolve(); }; };
  await phoneCtx.addInitScript(noFull);
  const phone = await phoneCtx.newPage();
  phone.on('pageerror', (e) => errs.push('Handy: ' + e.message));
  await phone.goto(BASE + '#pad=' + code);
  ok(await until(() => phone.evaluate(() => window.eightpad?.client?.status === 'verbunden'), 6000), 'Handy verbindet sich per Code', code);
  ok(await until(() => phone.evaluate(() => document.querySelector('.pad-p')?.textContent === 'Spieler 2')), 'Handy zeigt „Spieler 2“');
  const seat = await p.evaluate(() => window.eightboy.input.pad(2));
  ok(seat === 'handy', 'Fernseher: Spieler 2 = Handy');
  await p.waitForTimeout(400);
  await p.screenshot({ path: path.join(OUT, 'tv-lektion1.png') });
  await phone.screenshot({ path: path.join(OUT, 'handy-controller.png') });
  // Latenz: echte Berührung am Handy → Taste am Fernseher
  const cdp = await phoneCtx.newCDPSession(phone);
  const box = await phone.locator('.pad-btn.a').boundingBox();
  const lat = [];
  for (let i = 0; i < 25; i++) {
    const before = await p.evaluate(() => window.eightboy.dock.lastKeyAt);
    const t0 = Date.now();
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: box.x + box.width / 2, y: box.y + box.height / 2 }] });
    await until(() => p.evaluate((x) => window.eightboy.dock.lastKeyAt > x, before), 2000);
    const at = await p.evaluate(() => window.eightboy.dock.lastKeyAt);
    lat.push(at - t0);
    if (i === 0) ok(await until(() => p.evaluate(() => window.eightboy.input.btn(4, 2)), 500), 'Handy-A kommt als btn(A, 2) an');
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await p.waitForTimeout(40);
  }
  console.log(`     Latenz Handy-Berührung → Fernseher (lokal, Browser): Median ${median(lat).toFixed(0)} ms, max ${Math.max(...lat).toFixed(0)} ms`);
  ok(median(lat) < 100, 'Latenz Handy → Fernseher unter 100 ms (lokal)');

  // rumble() und padinfo() Ende zu Ende: Fernseher → Lobby → Handy
  await phone.evaluate(() => { window.__vib = []; Object.defineProperty(Navigator.prototype, 'vibrate', { value: (v) => { window.__vib.push(v); return true; }, configurable: true }); });
  await p.evaluate(() => window.eightboy.input.padinfo(2, { txt: 'Du bist die Katze!', bg: 0xff8a3d, sym: 'katze' }));
  ok(await until(() => phone.evaluate(() => !document.querySelector('.pad-info').hidden && document.querySelector('.pad-txt').textContent === 'Du bist die Katze!')), 'padinfo: das Handy von Spieler 2 zeigt die Anzeige');
  await p.evaluate(() => window.eightboy.input.rumble(2, { v: [180, 70, 300], s: 1 }));
  ok(await until(() => phone.evaluate(() => window.__vib.some((v) => Array.isArray(v) && v.join() === '180,70,300'))), 'rumble: das Handy vibriert mit dem Muster');
  // Flut: 60 Rüttler und 20 neue Anzeigen in einer Sekunde – gedrosselt, der letzte Stand kommt trotzdem an
  await phone.evaluate(() => { window.__vib.length = 0; });
  await p.evaluate(() => { const h = window.eightboy.dock.host, o = h.info; window.__pi = []; h.info = (id, d) => { window.__pi.push(performance.now()); o(id, d); }; });
  await p.evaluate(async () => {
    const inp = window.eightboy.input;
    for (let i = 0; i < 60; i++) { inp.rumble(2, { v: [30], s: 0.5 }); if (i % 3 === 0) inp.padinfo(2, { txt: 'Runde ' + i }); await new Promise((r) => setTimeout(r, 16)); }
    inp.padinfo(2, { txt: 'Ende', sym: 'pokal', bg: 0x3c9cf0 });
  });
  ok(await until(() => phone.evaluate(() => document.querySelector('.pad-txt').textContent === 'Ende' && window.eightpad.client.status === 'verbunden')), 'nach der Flut: letzter Stand am Handy, Verbindung steht');
  const pis = await p.evaluate(() => window.__pi);
  const perSec = Math.max(...pis.map((t) => pis.filter((u) => u >= t && u < t + 1000).length));
  const vibs = await phone.evaluate(() => window.__vib.filter(Array.isArray).length);
  ok(perSec <= 6 && vibs >= 3, 'Drossel: höchstens 6 Nachrichten je Sekunde an die Handys, Rüttler kommen trotzdem an', `${pis.length} Nachrichten, max. ${perSec}/s, ${vibs} Rüttler am Handy`);
  await phone.screenshot({ path: path.join(OUT, 'handy-quer-8boy-info.png') });
  await phone.setViewportSize({ width: 390, height: 844 });
  await phone.waitForTimeout(400);
  await phone.screenshot({ path: path.join(OUT, 'handy-hoch-8boy-info.png') });
  await p.evaluate(() => window.eightboy.system.eject());
  ok(await until(() => phone.evaluate(() => document.querySelector('.pad-info').hidden)), 'Kartridge aus: Anzeige auf dem Handy weg');
  // Ansicht über das Startmenü wieder auf Normal
  await p.evaluate(() => { window.eightboy.settings.tv = false; window.eightboy.applySettings(); });
  ok(await until(() => phone.evaluate(() => window.eightpad.client.status !== 'verbunden')), 'TV-Modus aus: Raum zu, Handy getrennt');
  await phoneCtx.close();
  await ctx.close();

  // Handy-Layout hochkant/quer mit nachgebautem WebSocket (ohne Fernseher): ULTRA-Tasten, Anzeige, Mehrfinger
  {
    const c = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    await c.addInitScript(noFull);
    await c.addInitScript(() => {
      class FakeWS {
        constructor() { window.__ws = this; this.readyState = 0; this.sent = []; setTimeout(() => { this.readyState = 1; this.emit({ t: 'padok' }); }, 30); }
        send(s) { this.sent.push(JSON.parse(s)); }
        close() { this.readyState = 3; this.onclose?.(); }
        emit(m) { this.onmessage?.({ data: JSON.stringify(m) }); }
      }
      window.WebSocket = FakeWS;
      window.__lock = 0;
      if (screen.orientation) Object.defineProperty(screen.orientation, 'lock', { value: () => { window.__lock++; return Promise.resolve(); }, configurable: true });
    });
    const h = await c.newPage();
    h.on('pageerror', (e) => errs.push('Handy-Layout: ' + e.message));
    await h.goto(BASE + '#pad=ABCDEF');
    ok(await until(() => h.evaluate(() => window.eightpad?.client?.status === 'verbunden')), 'Handy (nachgebaut): verbunden');
    const pi = (d) => h.evaluate((x) => window.__ws.emit({ t: 'pi', d: x }), d);
    await pi({ p: 3, sys: 64, name: '8BOY 64' });
    await h.waitForTimeout(300);
    const lay = await h.evaluate(() => ({ turn: !!document.querySelector('.pad-turn'), x: !!document.querySelector('.pad-btn.x').getClientRects().length, l: !!document.querySelector('.pad-sh.l').getClientRects().length,
      glass: document.querySelector('.pad-glass').getBoundingClientRect().toJSON(), dpad: document.querySelector('.pad-dpad').getBoundingClientRect().toJSON(), face: document.querySelector('.pad-face').getBoundingClientRect().toJSON(), label: document.querySelector('.pad-label').textContent }));
    ok(!lay.turn && lay.x && lay.l && lay.glass.bottom < lay.dpad.top && lay.dpad.right < lay.face.left && lay.dpad.width >= 140 && lay.face.width >= 140,
      'hochkant: Bildschirm oben, Steuerkreuz links, Tasten rechts, X/Y/L/R da, kein „quer halten“', `Steuerkreuz ${Math.round(lay.dpad.width)} px, Tasten ${Math.round(lay.face.width)} px · ${lay.label}`);
    await h.screenshot({ path: path.join(OUT, 'handy-hoch-ultra.png') });
    // jede sichtbare Taste trifft genau ihr Bit; zwei Finger gleichzeitig
    const cdp = await c.newCDPSession(h);
    const centers = await h.evaluate(() => [...document.querySelectorAll('.pad [data-b]')].filter((e) => e.getClientRects().length).map((e) => { const r = e.getBoundingClientRect(); return { b: +e.dataset.b, x: r.x + r.width / 2, y: r.y + r.height / 2 }; }));
    const lastMask = () => h.evaluate(() => window.__ws.sent.filter((m) => m.t === 'k').at(-1)?.b ?? -1);
    let wrong = [];
    for (const t of centers) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: t.x, y: t.y, id: 1 }] });
      await h.waitForTimeout(30);
      const m = await lastMask();
      if (m !== 1 << t.b) wrong.push(`${t.b}→${m}`);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await h.waitForTimeout(30);
    }
    ok(centers.length === 8 && !wrong.length, 'hochkant: alle 8 Tasten treffen genau ihr Bit', wrong.join(' ') || `${centers.length} Tasten`);
    const dp = await h.locator('.pad-dpad').boundingBox(), a = centers.find((t) => t.b === 4);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: dp.x + dp.width * 0.12, y: dp.y + dp.height / 2, id: 1 }, { x: a.x, y: a.y, id: 2 }] });
    await h.waitForTimeout(30);
    ok(await lastMask() === ((1 << 0) | (1 << 4)), 'hochkant: links + A mit zwei Fingern gleichzeitig');
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    ok(await h.evaluate(() => window.__lock === 0 && window.__full === 1), 'erstes Antippen: Vollbild, aber keine Querformat-Sperre');
    // padinfo groß, Rüttler
    await h.evaluate(() => { window.__vib = []; Object.defineProperty(Navigator.prototype, 'vibrate', { value: (v) => { window.__vib.push(v); return true; }, configurable: true }); });
    await pi({ p: 3, sys: 64, name: '8BOY 64', txt: 'Du bist die Katze!', bg: 0xff8a3d, sym: 'katze', vib: [180, 70, 300] });
    await h.waitForTimeout(500);
    const inf = await h.evaluate(() => ({ vis: !document.querySelector('.pad-info').hidden, sym: document.querySelector('.pad-sym').textContent, vib: window.__vib }));
    ok(inf.vis && inf.sym === '🐱' && inf.vib.some((v) => Array.isArray(v) && v.length === 3), 'Anzeige mit Symbol und Rüttler am Handy', JSON.stringify(inf));
    await h.screenshot({ path: path.join(OUT, 'handy-hoch-info.png') });
    await pi({ p: 3, sys: 64, name: '8BOY 64', txt: 'Merke dir die Farbe – gleich wird gefragt!', sym: 'auge', bg: 0xfff1a8 });
    await h.waitForTimeout(500);
    await h.screenshot({ path: path.join(OUT, 'handy-hoch-info-lang.png') });
    await h.setViewportSize({ width: 844, height: 390 });
    await h.waitForTimeout(400);
    const q = await h.evaluate(() => ({ glass: document.querySelector('.pad-glass').getBoundingClientRect().toJSON(), dpad: document.querySelector('.pad-dpad').getBoundingClientRect().toJSON(), face: document.querySelector('.pad-face').getBoundingClientRect().toJSON(), w: innerWidth, h: innerHeight }));
    ok(q.dpad.right < q.glass.left && q.glass.right < q.face.left && q.dpad.bottom <= q.h && q.face.bottom <= q.h, 'quer: Steuerkreuz | Bildschirm | Tasten, alles im Bild');
    await h.screenshot({ path: path.join(OUT, 'handy-quer-info.png') });
    await pi({ p: 3, sys: 64, name: '8BOY 64' });
    await h.waitForTimeout(300);
    await h.screenshot({ path: path.join(OUT, 'handy-quer-ultra.png') });
    await pi({ p: 1, sys: 8, name: '8BOY' });
    await h.setViewportSize({ width: 390, height: 844 });
    await h.waitForTimeout(400);
    await h.screenshot({ path: path.join(OUT, 'handy-hoch-8boy.png') });
    await h.setViewportSize({ width: 360, height: 640 });
    await h.waitForTimeout(300);
    const small = await h.evaluate(() => [...document.querySelectorAll('.pad-dpad, .pad-face, .pad-sys')].every((e) => e.getBoundingClientRect().bottom <= innerHeight));
    ok(small, 'kleines Handy (360×640) hochkant: alle Tasten im Bild');
    await h.screenshot({ path: path.join(OUT, 'handy-hoch-klein.png') });
    await c.close();
  }
  await b.close();
  if (lobby) lobby.close();
  ok(!errs.length, 'keine Skriptfehler im Browser', errs.join(' | '));
  console.log('     Bilder: ' + OUT);
}

console.log(fails ? `${fails} Prüfung(en) fehlgeschlagen` : 'alle Dock-Prüfungen bestanden');
process.exit(fails ? 1 : 0);
