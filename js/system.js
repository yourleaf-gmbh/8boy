// 8BOY-Betriebssystem: Einschalten, Startbildschirm, Laden, Pause-Menü und Fehlerbildschirm.
// Läuft mit 60 Bildern pro Sekunde; tick() erledigt genau ein Bild.
// console() ist die eingeschaltete Konsole (8BOY oder 8BOY 16); eine Kartridge läuft immer mit dem
// Bildschirm, Klang und den Tasten der Konsole, für die sie gebaut ist.
import { createVM, CartError } from './vm.js';
import { cartStorage } from './carts.js';
import { machineFor, fits } from './machines.js';

// START = Taste MENÜ, SELECT = Taste OPTION (alte Namen, gleiche Nummern)
const B = { LEFT: 0, RIGHT: 1, UP: 2, DOWN: 3, A: 4, B: 5, START: 6, SELECT: 7 };
// 8BOY 128 ist noch nicht im Konsolen-Wechsel – nur über ?giga bzw. lokal (js/main.js)
const NEXT = { 8: 16, 16: 32, 32: 64, 64: 8, 128: 8 }, PREV = { 8: 64, 16: 8, 32: 16, 64: 32, 128: 64 };

function wrap(text, cols) {
  const out = [];
  for (const para of String(text).split('\n')) {
    let line = '';
    for (const word of para.split(' ')) {
      if ((line + ' ' + word).trim().length > cols) { if (line) out.push(line); line = word; while (line.length > cols) { out.push(line.slice(0, cols)); line = line.slice(cols); } }
      else line = (line + ' ' + word).trim();
    }
    out.push(line);
  }
  return out;
}

// debugFor(cart): Haltepunkte/Beobachten aus dem Studio für diese Kartridge (oder null)
export function createSystem({ fengari, gfx, audio, input, settings, console: hw = () => machineFor(8), onEvent = () => {}, onLog = () => {}, net = null, debugFor = () => null, access = null, assets = null }) {
  let laden = null;   // Asset-Pakete der Kartridge: { fertig, fehler, geladen, gesamt }
  let state = 'off';
  let t = 0;
  let cart = null, vm = null, error = null;
  let menuIndex = 0;
  let homeIndex = 0;
  let frozen = null, frozenDraw = null, frozenRemap = null;

  const emit = (type, data) => onEvent(type, data);
  const setState = (s) => { state = s; t = 0; emit('state', s); };

  // Bildschirm, Klang und Tasten auf eine Konsole umstellen
  function useMachine(m) {
    if (gfx.w !== m.w || gfx.h !== m.h || gfx.colors !== m.colors || gfx.gpuMode !== !!(m.gpu && gfx.gpuChip)) { gfx.setMode(m); emit('mode', m); }
    audio.setMachine?.(m);
    input.setSuper?.(m.id >= 16);
  }
  const W = () => gfx.w, H = () => gfx.h;

  // 8BOY 64 ohne WebGL2 (gfx.gpuMissing, gesetzt in main.js): klare Meldung statt eines leeren Bildes
  const noGpu = () => hw().gpu && gfx.gpuMissing;
  function powerOn() { useMachine(hw()); setState(noGpu() ? 'nogpu' : 'boot'); }

  function stopVM() {
    if (vm?.debugger?.halted) emit('debug', { type: 'resume' });
    audio.hold?.(false);
    if (vm) { try { vm.close(); } catch { /* egal */ } }
    vm = null;
    net?.leave();   // Mehrspieler-Verbindung endet mit der Kartridge
    access?.stop();
    audio.stop();
    input.padReset?.();   // Anzeigen auf den Handys (padinfo) enden mit der Kartridge
  }

  function insert(c) {
    stopVM();
    cart = c;
    error = null;
    emit('inserted', c);
    if (state === 'boot' || state === 'off') return; // startet nach dem Boot-Logo
    useMachine(hw());
    setState(fits(c.system, hw().id) ? 'loading' : 'wrong');
  }

  function eject() {
    stopVM();
    const old = cart;
    cart = null;
    useMachine(hw());
    gfx.resetAll();
    setState('home');
    if (old) emit('ejected', old);
  }

  // 8BOY-32-Kartridge mit „-- ultra: ja“ auf dem 8BOY 64: gleiche Maschine (320×240, im Rahmen), aber der 3D-Chip ist
  // die Grafikkarte – die Kartridge fragt gpu() und schaltet ihre Effekte zu. Ohne Kopfzeile bleibt alles beim Alten.
  function machineForCart(c) {
    const m = machineFor(c.system);
    if (c.ultra && m.three && !m.gpu && hw().gpu && gfx.gpuChip && !gfx.gpuMissing) return { ...m, gpu: true, ultraMode: true };
    return m;
  }

  function startCart() {
    stopVM();
    const m = machineForCart(cart);
    useMachine(m);
    gfx.resetAll();
    input.clear();
    error = null;
    try {
      // Zugänglichkeit nur für Kartridges, die dafür gebaut sind
      const a11y = access && cart.a11y === 'voll' ? access : null;
      vm = createVM({ fengari, gfx, audio, input, storage: cartStorage(cart.id), onLog, machine: m, net, access: a11y?.api, assets });
      a11y?.start(cart);
      const dbg = debugFor(cart);
      // ohne Haltepunkte und Beobachten bleibt alles beim gewohnten Bildlauf
      if (dbg && (dbg.breakpoints?.length || dbg.watches?.length)) attachDebug().configure(dbg);
      setState('running');
      vm.run(cart.code, 'cart');
      vm.debugger?.afterRun();
    } catch (e) { fail(e); }
  }

  // Fehlersuche: Ereignisse der VM ans Studio weiterreichen, Ton anhalten solange die Konsole steht
  function attachDebug() {
    const d = vm.debug();
    d.onEvent((type, data) => {
      if (type === 'halt') audio.hold?.(true);
      if (type === 'resume') audio.hold?.(false);
      emit('debug', { type, data });
    });
    return d;
  }

  function fail(e) {
    error = e instanceof CartError ? e : new CartError(e?.stack || String(e));
    onLog('FEHLER: ' + error.trace);
    audio.stop();
    audio.sfx('lose', 0);
    setState('error');
    emit('error', error);
  }

  function openMenu() {
    if (state !== 'running') return;
    frozen = gfx.fb.slice();
    frozenDraw = { ...gfx.state };
    frozenRemap = gfx.remap.slice();
    audio.stop();
    menuIndex = 0;
    setState('paused');
  }

  function closeMenu() {
    Object.assign(gfx.state, frozenDraw);
    gfx.remap.set(frozenRemap);
    gfx.fb.set(frozen);
    setState('running');
  }

  const PAUSE_ITEMS = ['Weiter', 'Neu starten', 'Code ansehen', 'Auswerfen', 'Handy als Controller'];
  const HOLD_FRAMES = 42;
  let startHeld = 0;

  // Kleine Füllanzeige oben rechts, ohne den Zeichenzustand der Kartridge zu verändern
  function drawHoldHint(p) {
    const saved = { ...gfx.state }, savedRemap = gfx.remap.slice();
    gfx.resetDrawState();
    const w = 52, x = W() - w - 4, y = 4;
    gfx.rectfill(x - 1, y - 1, w + 2, 11, 0);
    gfx.rectfill(x, y, Math.round(w * Math.min(1, p)), 9, 17);
    gfx.text('MENÜ…', x + 6, y + 1, 7);
    Object.assign(gfx.state, saved);
    gfx.remap.set(savedRemap);
  }

  const VIEWS = ['Normal', 'Großbild', 'TV'];
  const viewIndex = () => (settings.tv ? 2 : settings.big ? 1 : 0);
  function setView(i) {
    const v = (i + VIEWS.length) % VIEWS.length;
    settings.tv = v === 2; settings.big = v === 1;
    emit('settings');
  }
  function homeItems() {
    const sup = hw().id >= 16;
    return [
      { label: 'Kartridge-Regal', act: () => emit('shelf') },
      { label: 'Studio: Kartridge bauen', act: () => emit('editor') },
      { label: 'Konsole: ' + hw().name, act: () => emit('machine', NEXT[hw().id]), lr: (d) => emit('machine', d < 0 ? PREV[hw().id] : NEXT[hw().id]) },
      { label: 'Farbe: ' + (settings.classic ? 'Retro-LCD' : 'Bunt'), act: () => { settings.classic = !settings.classic; emit('settings'); } },
      { label: 'Ton: ' + (settings.volume > 0 ? '■'.repeat(Math.round(settings.volume * 5)) + '·'.repeat(5 - Math.round(settings.volume * 5)) : 'aus  (→ lauter)'), act: () => {
        settings.volume = settings.volume >= 1 ? 0 : Math.round((settings.volume + 0.2) * 10) / 10; emit('settings'); audio.sfx('blip');
      }, lr: (d) => { settings.volume = Math.max(0, Math.min(1, Math.round((settings.volume + d * 0.2) * 10) / 10)); emit('settings'); audio.sfx('blip'); } },
      // Ansicht: Handheld, Großbild oder TV (Dock: Bild füllt den Fernseher, bis zu 4 Gamepads/Handys)
      { label: 'Ansicht: ' + VIEWS[viewIndex()], act: () => setView(viewIndex() + 1), lr: (d) => { setView(viewIndex() + d); audio.sfx('blip'); } },
      { label: 'Tastengröße: ' + Math.round((settings.btnScale || 1) * 100) + ' %', act: () => { settings.btnScale = (settings.btnScale || 1) >= 1.4 ? 0.8 : Math.round(((settings.btnScale || 1) + 0.1) * 10) / 10; emit('settings'); },
        lr: (d) => { settings.btnScale = Math.max(0.8, Math.min(1.4, Math.round(((settings.btnScale || 1) + d * 0.1) * 10) / 10)); emit('settings'); audio.sfx('blip'); } },
      // Handy als Controller – auch ohne TV-Modus (QR-Code-Fenster)
      { label: 'Handy als Controller', act: () => emit('phones') },
    ];
  }

  // ---------- Zeichnen der Systembildschirme ----------

  // Wortmarke auf dem Bildschirm: 8BOY, ab der zweiten Generation die Zahl auf einem Schild dahinter.
  // Je Generation ein eigener Schliff: gelb (8), weiß (16), Metall (32), Farbverlauf in Streifen (64, 128).
  const GEN_FARBE = { 16: 10, 32: 29, 64: 20, 128: 14 };
  function logo(y, sc) {
    const id = hw().id, word = '8BOY', num = id > 8 ? String(id) : '';
    sc = sc || (id >= 64 ? Math.round(6 * W() / 640) : id >= 32 ? 4 : 3);
    const ns = Math.max(1, Math.round(sc / 2)), ww = gfx.textWidth(word, sc);
    const nw = num ? gfx.textWidth(num, ns) + 4 * ns : 0, gap = num ? 2 * sc : 0;
    const x = Math.round((W() - ww - gap - nw) / 2), hh = 7 * sc;
    gfx.text(word, x + Math.ceil(sc / 2), y + Math.ceil(sc / 2), id >= 32 ? 0 : 1, sc);
    if (id >= 64) {
      [20, 19, 12, 13, 14, 8].forEach((c, i) => { gfx.clip(0, y + i * Math.ceil(hh / 6), W(), Math.ceil(hh / 6)); gfx.text(word, x, y, c, sc); });
      gfx.clip();
    } else if (id >= 32) {
      gfx.text(word, x, y + 1, 5, sc);
      gfx.text(word, x, y, 29, sc);
      gfx.clip(0, y, W(), Math.round(hh * 0.45)); gfx.text(word, x, y, 7, sc); gfx.clip();
    } else gfx.text(word, x, y, id >= 16 ? 7 : 10, sc);
    if (!num) return;
    // Generationsschild mit abgerundeten Ecken, mittig zur Wortmarke
    const bx = x + ww + gap, bh = 9 * ns, by = y + Math.round((hh - bh) / 2), c = GEN_FARBE[id] ?? 10;
    gfx.rectfill(bx + ns, by, nw - 2 * ns, bh, c);
    gfx.rectfill(bx, by + ns, nw, bh - 2 * ns, c);
    gfx.text(num, bx + 2 * ns, by + ns, 0, ns);
  }
  // drehender Würfel aus dem 3D-Chip (hinter dem 2D-Bild, Farbe 0 lässt ihn durch)
  function megaCube(x, y, z, size, t, top = 0x0b0b18, bottom = 0x2a2440) {
    const g3 = gfx.g3;
    g3.model(63, 'wuerfel', 19);
    g3.cls3d(top, bottom);
    g3.camera3d(0, 0, -6, 0, 0, 60);
    g3.light3d(-0.5, -0.7, 0.6, 0.45);
    g3.draw3d(63, x, y, z, t / 50, t / 70, t / 90, size);
  }

  // 8BOY 64: ein Schwarm Würfel mit Lampen – gerechnet von der Grafikkarte
  function ultraScene(t, k = 1) {
    const g3 = gfx.g3;
    g3.model(62, 'wuerfel', 19); g3.model(61, 'kugel', 14); g3.model(60, 'gitter', 17);
    g3.cls3d(0x05060f, 0x1b1240);
    g3.fog3d(8, 30, 0x1b1240);
    g3.camera3d(Math.sin(t / 240) * 2, 1.2, -9 + (1 - k) * -6, Math.sin(t / 300) * 0.25, -0.08, 60);
    g3.light3d(-0.4, -0.8, 0.5, 0.25);
    g3.lamp3d(0, Math.sin(t / 40) * 5, 2, Math.cos(t / 40) * 5, 0x2ce8f5, 9);
    g3.lamp3d(1, Math.cos(t / 55) * 6, 1, Math.sin(t / 55) * 6 + 4, 0xf27ca8, 9);
    g3.draw3d(60, 0, -1.2, 6, 0, 0, 0, 30);
    for (let i = 0; i < 48; i++) {
      const a = i / 48 * Math.PI * 2 + t / 160, r = 4 + (i % 4) * 1.6;
      g3.draw3d(i % 5 ? 62 : 61, Math.cos(a) * r, Math.sin(t / 30 + i) * 0.6, 6 + Math.sin(a) * r, t / 50 + i, t / 70, 0, 0.6 + (i % 3) * 0.2);
    }
  }

  // Kartridge als Symbol: oben gerundet, mit Griffmulde
  function drawCartIcon(x, y, color) {
    gfx.rectfill(x + 1, y, 26, 32, 6);
    gfx.rectfill(x, y + 1, 28, 30, 6);
    gfx.rectfill(x + 9, y + 2, 10, 2, 5);
    gfx.rectfill(x + 3, y + 6, 22, 16, color);
    gfx.rect(x + 3, y + 6, 22, 16, 5);
    for (let i = 0; i < 4; i++) gfx.rectfill(x + 6 + i * 5, y + 26, 3, 4, 5);
  }

  function drawBoot() {
    gfx.resetDrawState();
    if (hw().id >= 64) return drawUltraBoot();
    if (hw().id >= 32) return drawMegaBoot();
    if (hw().id >= 16) return drawSuperBoot();
    drawBloom();
  }

  // Startbild des 8BOY: Auf dunklem Grund setzt sich die Wortmarke aus einzelnen Pixeln zusammen – sie wachsen von
  // der Mitte nach außen auf und färben sich von Blattgrün zu Gelb. Dazu drei aufsteigende Töne.
  let bloom = null;
  function bloomPixels() {
    const sc = 4, txt = '8BOY', key = W() + 'x' + H();
    if (bloom?.key === key) return bloom;
    const tw = gfx.textWidth(txt, sc), x0 = Math.round((W() - tw) / 2), y0 = Math.round(H() / 2) - 26;
    gfx.cls(0);
    gfx.text(txt, x0, y0, 10, sc);
    const cx = x0 + tw / 2, cy = y0 + 3.5 * sc, pts = [];
    for (let y = y0; y < y0 + 8 * sc; y += sc) for (let x = x0; x < x0 + tw + sc; x += sc) {
      if (gfx.fb[y * W() + x] !== 10) continue;
      const d = Math.hypot(x - cx, (y - cy) * 1.8), r = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
      pts.push({ x, y, d, j: (r - Math.floor(r)) * 6 });
    }
    const dmax = Math.max(...pts.map((p) => p.d));
    gfx.cls(0);
    return bloom = { key, pts, cx, cy, dmax, sc, y0 };
  }
  function drawBloom() {
    const b = bloomPixels();
    gfx.cls(0);
    const ease = (k) => 1 - (1 - k) ** 3;
    for (const p of b.pts) {
      const k = Math.max(0, Math.min(1, (t - 6 - (p.d / b.dmax) * 48 - p.j) / 26));
      if (k <= 0) continue;
      const e = ease(k), sz = Math.max(1, Math.round(b.sc * e));
      const x = b.cx + (p.x - b.cx) * e + (b.sc - sz) / 2, y = b.cy + (p.y - b.cy) * e + (b.sc - sz) / 2;
      gfx.rectfill(Math.round(x), Math.round(y), sz, sz, k < 0.4 ? 3 : k < 0.8 ? 11 : 10);
    }
    if (t > 92) {
      const s = hw().tagline;
      gfx.text(s, (W() - gfx.textWidth(s)) / 2, b.y0 + 8 * b.sc + 12, t > 102 ? 13 : 17);
    }
    if (t === 58) audio.play('t150 w1 v10 l16 o5 c r g r >e4', 0);
  }

  // 8BOY 16: Logo wächst aus der Mitte, Himmelsverlauf, Akkord mit Hall
  function drawSuperBoot() {
    gfx.cls(0);
    gfx.backdrop(0, H(), 0x0d1b4a, 0x6b3fa0);
    const k = Math.min(1, t / 60);
    gfx.fade(Math.min(15, t / 3));
    if (k < 1) {
      gfx.text('8BOY', (W() - gfx.textWidth('8BOY', 4)) / 2, 90, 7, 4);
      gfx.mosaic(Math.round((1 - k) * 12) + 1, 0, 70, W(), 70);
    } else logo(78, 4);
    if (t > 70) {
      const s = hw().tagline;
      gfx.text(s, (W() - gfx.textWidth(s)) / 2, 140, 29);
    }
    if (t === 60) {
      audio.play('t100 @8 h10 p4 v9 l1 o4 c', 0);
      audio.play('t100 @8 h10 p12 v8 l1 o4 g', 1);
      audio.play('t100 @2 h12 v8 l1 o5 e', 2);
      audio.play('t150 @9 h12 v10 l16 o6 c e g >c2', 3);
    }
  }

  // 8BOY 32: ein Würfel fliegt heran und dreht sich, dann erscheint der Schriftzug
  function drawMegaBoot() {
    gfx.cls(0);
    const k = Math.min(1, t / 70);
    megaCube(0, 0.3, 14 - k * 10, 1.4, t * 2.5, 0x000000, 0x16163a);
    if (t > 70) logo(150);
    if (t > 90) { const s = hw().tagline; gfx.text(s, (W() - gfx.textWidth(s)) / 2, 190, 13); }
    if (t === 70) {
      audio.play('t90 @8 h12 p4 v9 l1 o3 g', 0);
      audio.play('t90 @14 h12 p12 v8 l1 o4 d', 1);
      audio.play('t90 @2 h12 v8 l1 o4 b', 2);
      audio.play('t140 @11 h10 v10 l16 o5 g >d g b >d2', 3);
      audio.play('t90 @12 v12 o4 l1 b', 4);
    }
  }

  // 8BOY 64: Würfelschwarm fliegt heran, dann der Schriftzug
  function drawUltraBoot() {
    gfx.cls(0);
    ultraScene(t * 2, Math.min(1, t / 80));
    const k = W() / 640;   // 8BOY 128: alles doppelt so groß
    if (t > 60) logo(Math.round(120 * k));
    if (t > 85) { const s = hw().tagline; gfx.text(s, (W() - gfx.textWidth(s, 2 * k)) / 2, Math.round(190 * k), 7, 2 * k); }
    if (t === 60) {
      audio.play('t96 @24 h12 p4 v9 l1 o3 c', 0);
      audio.play('t96 @14 h12 p12 v8 l1 o4 g', 1);
      audio.play('t96 @2 h12 v8 l1 o5 e', 2);
      audio.play('t150 @11 h10 v10 l16 o5 c e g >c e g >c2', 3);
      audio.play('t96 @12 v12 o3 l1 c', 4);
    }
  }
  function drawUltraHome() {
    gfx.cls(0);
    ultraScene(t);
    logo(30);
    const sub = hw().tagline;
    gfx.text(sub, (W() - gfx.textWidth(sub, 2)) / 2, 84, 7, 2);
    gfx.rectfill(150, 112, 340, 38, 1);
    drawCartIcon(160, 116 + Math.round(Math.sin(t / 12) * 2), 8 + ((t / 60 | 0) % 6));
    gfx.text('Kartridge auf die Konsole ziehen', 198, 120, 7);
    gfx.text('oder im Regal tippen', 198, 134, 6);
    const items = homeItems();
    items.forEach((it, i) => {
      const y = 166 + i * 24, sel = i === homeIndex;
      gfx.rectfill(150, y - 4, 340, 20, sel ? 17 : 1);
      gfx.text((sel ? '▶ ' : '  ') + it.label, 160, y, sel ? 10 : 7, 2);
    });
  }
  // Ohne WebGL2 kein 8BOY 64: erklären und zum 8BOY 32 anbieten
  function drawNoGpu() {
    gfx.resetDrawState();
    gfx.cls(1);
    const lines = [['Diese Konsole braucht WebGL2', 10, 3], ['', 7, 2], ['Der 8BOY 64 rechnet 3D auf der Grafikkarte.', 7, 2],
      ['Dein Browser oder Gerät bietet sie gerade nicht an', 7, 2], ['(WebGL abgeschaltet oder zu alter Browser).', 6, 2], ['', 7, 2],
      ['Alle anderen Konsolen laufen weiter.', 7, 2]];
    let y = 60;
    for (const [l, c, sc] of lines) { gfx.text(l, (W() - gfx.textWidth(l, sc)) / 2, y, c, sc); y += sc * 13; }
    gfx.text('A: zum 8BOY 32 wechseln', (W() - gfx.textWidth('A: zum 8BOY 32 wechseln', 2)) / 2, H() - 70, 20, 2);
    if (t === 1) audio.sfx('back', 0);
  }

  function drawHome() {
    gfx.resetDrawState();
    if (hw().id >= 64) return drawUltraHome();
    const sup = hw().id >= 16;
    gfx.cls(hw().id >= 32 ? 0 : 1);
    if (hw().id >= 32) megaCube(3.1, -0.2, 2, 1.1, t);
    else if (sup) gfx.backdrop(0, H(), 0x1c2340, 0x4a2a5a);
    if (hw().id < 32) for (let i = -10; i < 30; i++) {
      const x = i * 16 + (t / 2 % 16);
      gfx.line(x, 0, x + 60, H(), 16);
    }
    const top = sup ? 18 : 10;
    logo(top);
    const sub = hw().tagline;
    gfx.text(sub, (W() - gfx.textWidth(sub)) / 2, top + (sup ? 42 : 30), 13);
    const y0 = sup ? 76 : 56;
    const bob = Math.round(Math.sin(t / 12) * 2);
    drawCartIcon(18, y0 + bob, 8 + ((t / 60 | 0) % 6));
    gfx.text('↑', 28, y0 - 10 - Math.abs(bob), 10);
    gfx.text('Kartridge auf die\nKonsole ziehen', 54, y0 + 2, 7);
    gfx.text('oder im Regal tippen', 54, y0 + 22, 6);
    const items = homeItems();
    const my = sup ? 124 : 90, step = sup ? 13 : 10;
    // Passen nicht alle Einträge auf den Bildschirm, scrollt die Liste mit der Auswahl
    const vis = Math.min(items.length, Math.floor((H() - my) / step));
    const off = Math.max(0, Math.min(homeIndex - vis + 1, items.length - vis));
    items.slice(off, off + vis).forEach((it, j) => {
      const i = off + j, y = my + j * step;
      const sel = i === homeIndex;
      if (sel) gfx.rectfill(14, y - 2, W() - 28, 10, 17);
      gfx.text((sel ? '▶ ' : '  ') + it.label, 20, y, sel ? 10 : 7);
    });
    if (off > 0) gfx.text('↑', W() - 16, my, 6);
    if (off + vis < items.length) gfx.text('↓', W() - 16, my + (vis - 1) * step, 6);
  }

  function drawLoading() {
    gfx.resetDrawState();
    gfx.cls(0);
    const c = cart.color ?? 12;
    const h = Math.min(H(), t * 6);
    gfx.rectfill(0, (H() - h) / 2, W(), h, c);
    if (t > 20) {
      const title = cart.title || 'Kartridge';
      const lines = wrap(title, 18);
      const ty = (H() - 56) / 2;
      lines.forEach((l, i) => gfx.text(l, (W() - gfx.textWidth(l, 2)) / 2 + 1, ty + i * 20 + 1, 0, 2));
      lines.forEach((l, i) => gfx.text(l, (W() - gfx.textWidth(l, 2)) / 2, ty + i * 20, 7, 2));
      if (cart.author) { const a = 'von ' + cart.author; gfx.text(a, (W() - gfx.textWidth(a)) / 2, ty + 48, 0); }
      if (hw().id > (cart.system || 8)) { const a = machineFor(cart.system).name + '-Kartridge'; gfx.text(a, (W() - gfx.textWidth(a)) / 2, H() - 20, 0); }
    }
    if (t === 20) audio.play('t180 w1 v8 l16 o5 c e g >c4', 0);
    // Ladebalken der Asset-Pakete
    if (laden && !laden.fertig && t > 20) {
      const bw = Math.round(W() * 0.6), bx = Math.round((W() - bw) / 2), by = H() - 40;
      const q = laden.gesamt ? laden.geladen / laden.gesamt : (t % 60) / 60;
      gfx.rectfill(bx - 1, by - 1, bw + 2, 8, 0);
      gfx.rectfill(bx, by, Math.round(bw * q), 6, 7);
      const s = laden.gesamt ? `Lade Inhalte … ${Math.round(laden.geladen / 1024)} / ${Math.round(laden.gesamt / 1024)} KB` : 'Lade Inhalte …';
      gfx.text(s, (W() - gfx.textWidth(s)) / 2, by + 10, 0);
    }
  }

  // Die Kartridge ist für eine neuere Konsole gebaut
  function drawWrong() {
    gfx.resetDrawState();
    gfx.cls(1);
    const need = machineFor(cart.system).name;
    drawCartIcon((W() - 28) / 2, 18 + Math.round(Math.sin(t / 6) * 2), cart.color ?? 12);
    const lines = ['Diese Kartridge passt', 'nicht in den Schacht!', '', `Sie ist für den ${need}.`];
    lines.forEach((l, i) => gfx.text(l, (W() - gfx.textWidth(l)) / 2, 62 + i * 11, i < 2 ? 10 : 7));
    gfx.text(`A: zum ${need} wechseln`, 20, H() - 34, 20);
    gfx.text('B: auswerfen', 20, H() - 22, 20);
    if (t === 1) audio.sfx('back', 0);
  }

  function drawPaused() {
    gfx.resetDrawState();
    gfx.fb.set(frozen);
    for (let y = 0; y < H(); y++) for (let x = (y & 1); x < W(); x += 2) gfx.fb[y * W() + x] = 0;
    const bw = 140, bh = 20 + PAUSE_ITEMS.length * 13, bx = (W() - bw) / 2, by = (H() - bh) / 2;
    gfx.rectfill(bx, by, bw, bh, 1);
    gfx.rect(bx, by, bw, bh, 7);
    gfx.text(cart.title.slice(0, 20), bx + 8, by + 6, 10);
    gfx.text('B / Esc: zurück zum Spiel', (W() - gfx.textWidth('B / Esc: zurück zum Spiel')) / 2, by + bh + 6, 7);
    PAUSE_ITEMS.forEach((it, i) => {
      const sel = i === menuIndex;
      gfx.text((sel ? '▶ ' : '  ') + it, bx + 8, by + 20 + i * 13, sel ? 7 : 6);
    });
  }

  function drawError() {
    gfx.resetDrawState();
    gfx.cls(18);
    gfx.rectfill(0, 0, W(), 14, 8);
    gfx.text('Uff! Die Kartridge hat einen Fehler', 4, 3, 7);
    const head = error.line ? `Zeile ${error.line}:` : 'Meldung:';
    gfx.text(head, 6, 22, 10);
    wrap(error.message, Math.floor(W() / 6) - 2).slice(0, Math.floor((H() - 60) / 9)).forEach((l, i) => gfx.text(l, 6, 34 + i * 9, 7));
    gfx.text('A: neu starten  B: Code öffnen', 6, H() - 28, 20);
    gfx.text('OPTION: auswerfen', 6, H() - 16, 20);
  }

  // ---------- ein Bild ----------

  // Tempo aus den Zugänglichkeits-Einstellungen (nur bei Kartridges mit a11y): Spiellogik seltener aufrufen
  let tempoAcc = 0;
  function tempoSkip() {
    const sp = access?.aktiv ? access.speed() : 1;
    if (sp >= 1) { tempoAcc = 0; return false; }
    tempoAcc += sp;
    if (tempoAcc >= 1) { tempoAcc -= 1; return false; }
    return true;
  }
  function tick() {
    t++;
    if (state === 'running') {
      const dbg = vm.debugger;
      if (dbg?.halted) return; // am Haltepunkt eingefroren
      // ein angehaltenes Bild läuft mit denselben Tasten zu Ende
      if (!dbg?.midFrame) {
        input.tick();
        if ((input.btn(B.START) && input.btnp(B.SELECT)) || (input.btn(B.SELECT) && input.btnp(B.START))) { openMenu(); drawPaused(); return; }
        // MENÜ (START) lange halten öffnet ebenfalls das Menü (für Maus und eine Hand)
        startHeld = input.btn(B.START) ? startHeld + 1 : 0;
        if (startHeld >= HOLD_FRAMES) { startHeld = 0; openMenu(); drawPaused(); return; }
      }
      try {
        if (dbg) dbg.frame();
        else if (tempoSkip()) vm.draw();   // Tempo unter 100 %: dieses Bild ohne Spiellogik
        else {
          vm.update();
          vm.draw();
        }
      } catch (e) { fail(e); return; }
      if (startHeld > 12) drawHoldHint(startHeld / HOLD_FRAMES);
      return;
    }
    input.tick();
    switch (state) {
      case 'off': gfx.cls(0); break;
      case 'boot':
        drawBoot();
        if (t > 150 || (t > 30 && (input.btnp(B.A) || input.btnp(B.START)))) {
          gfx.fade(15);
          if (!cart) setState('home');
          else setState(fits(cart.system, hw().id) ? 'loading' : 'wrong');
        }
        break;
      case 'home': {
        const items = homeItems();
        homeIndex = Math.min(homeIndex, items.length - 1);
        if (input.btnp(B.UP)) { homeIndex = (homeIndex + items.length - 1) % items.length; audio.sfx('blip'); }
        if (input.btnp(B.DOWN)) { homeIndex = (homeIndex + 1) % items.length; audio.sfx('blip'); }
        if (items[homeIndex].lr && input.btnp(B.LEFT)) items[homeIndex].lr(-1);
        if (items[homeIndex].lr && input.btnp(B.RIGHT)) items[homeIndex].lr(1);
        if (input.btnp(B.A) || input.btnp(B.START)) { audio.sfx('select'); items[homeIndex].act(); }
        if (state === 'home') drawHome();
        break;
      }
      case 'loading':
        // Asset-Pakete: einmal je Start anstoßen, die Kartridge startet erst, wenn alles „vorab“ geladen ist
        if (t === 1) {
          laden = null;
          if (cart.assets?.length) {
            if (!assets) laden = { fehler: 'Diese Konsole kann keine Asset-Pakete laden.' };
            else {
              const l = laden = { fertig: false, geladen: 0, gesamt: 0 };
              assets.leeren();
              assets.vorbereiten(cart.assets, (g, s) => { l.geladen = g; l.gesamt = s; })
                .then(() => { l.fertig = true; }, (e) => { l.fehler = e.message; });
            }
          }
        }
        drawLoading();
        if (laden?.fehler) { fail(new Error('Asset-Paket: ' + laden.fehler)); laden = null; break; }
        if (t > 75 && (!laden || laden.fertig)) startCart();
        break;
      case 'wrong':
        if (input.btnp(B.A)) { emit('machine', cart.system); break; }
        if (input.btnp(B.B) || input.btnp(B.SELECT)) { eject(); break; }
        drawWrong();
        break;
      case 'nogpu':
        if (input.btnp(B.A) || input.btnp(B.START)) { emit('machine', 32); break; }
        drawNoGpu();
        break;
      case 'paused':
        if (input.btnp(B.UP)) { menuIndex = (menuIndex + PAUSE_ITEMS.length - 1) % PAUSE_ITEMS.length; audio.sfx('blip'); }
        if (input.btnp(B.DOWN)) { menuIndex = (menuIndex + 1) % PAUSE_ITEMS.length; audio.sfx('blip'); }
        if (input.btnp(B.B)) { closeMenu(); break; }
        if (input.btnp(B.A) || input.btnp(B.START)) {
          const choice = PAUSE_ITEMS[menuIndex];
          if (choice === 'Weiter') { closeMenu(); break; }
          if (choice === 'Neu starten') { startCart(); break; }
          if (choice === 'Code ansehen') emit('code', cart);
          if (choice === 'Auswerfen') { eject(); break; }
          if (choice === 'Handy als Controller') emit('phones');
        }
        drawPaused();
        break;
      case 'error':
        if (input.btnp(B.A)) { startCart(); break; }
        if (input.btnp(B.B)) emit('code', cart);
        if (input.btnp(B.SELECT)) { eject(); break; }
        drawError();
        break;
      default: break;
    }
  }

  // Konsole gewechselt: neu booten, eine eingelegte Kartridge bleibt drin
  function reboot() { stopVM(); useMachine(hw()); gfx.resetAll(); setState(noGpu() ? 'nogpu' : 'boot'); }

  return {
    tick, powerOn, insert, eject, openMenu, startCart, reboot,
    describe: () => (vm && (state === 'running' || state === 'paused') ? (state === 'paused' ? 'Pause. ' : '') + vm.describe() : ''),
    choice: (id, nr) => { if (vm && state === 'running') { try { vm.choice(id, nr); } catch (e) { fail(e); } } },
    get state() { return state; }, get cart() { return cart; }, get error() { return error; },
    // Fehlersuche der laufenden Kartridge (legt sie bei Bedarf an); null, wenn keine läuft
    debug() { return vm && (state === 'running' || state === 'paused') ? (vm.debugger || attachDebug()) : null; },
    // Code ins laufende Spiel laden, ohne Neustart
    liveReload(code) {
      if (!vm || !(state === 'running' || state === 'paused')) return null;
      const r = (vm.debugger || attachDebug()).reload(code);
      if (r.ok) cart = { ...cart, code };
      return r;
    },
    toggleMenu() { if (state === 'running') openMenu(); else if (state === 'paused') closeMenu(); },
  };
}
