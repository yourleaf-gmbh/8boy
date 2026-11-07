// Eingabe: Tasten aus Tastatur, Touch, Gamepads und Handys werden pro Bild zusammengeführt.
// 8BOY hat 8 Tasten, der 8BOY 16 zusätzlich X, Y, L und R (12 Tasten).
//
// Mehrere Spieler (Dock/TV): Jedes Gamepad und jedes Handy ist ein Gerät. Ein Gamepad bekommt mit seinem ersten
// START einen Platz (Spieler 1–4), das erste benutzte Gamepad gleich Platz 1, ein Handy beim Verbinden den nächsten
// freien. Tastatur und Touch gehören immer zu Spieler 1.
// btn(i) ohne Spieler bleibt wie früher: alle Eingaben zusammen.
export const BTN = { LEFT: 0, RIGHT: 1, UP: 2, DOWN: 3, A: 4, B: 5, START: 6, SELECT: 7, MENU: 6, OPTION: 7, X: 8, Y: 9, L: 10, R: 11 };
const N = 12;
export const MAX_PLAYERS = 4;

const KEYS = {
  ArrowLeft: 0, KeyA: 0, ArrowRight: 1, KeyD: 1, ArrowUp: 2, KeyW: 2, ArrowDown: 3, KeyS: 3,
  KeyX: 4, KeyK: 4, Space: 4, KeyZ: 5, KeyY: 5, KeyJ: 5, Enter: 6, KeyE: 6, ShiftLeft: 7, ShiftRight: 7, Backspace: 7, KeyQ: 7,
  KeyC: 8, KeyI: 8, KeyV: 9, KeyU: 9, KeyF: 10, Digit1: 10, KeyG: 11, Digit2: 11,
};

// Welcher Controller ist das? (nur für die Beschriftung – belegt wird immer nach Lage der Tasten)
export function padKind(id = '') {
  if (/xbox|xinput|microsoft|045e/i.test(id)) return 'xbox';
  if (/playstation|dualshock|dualsense|wireless controller|054c|sony/i.test(id)) return 'ps';
  if (/nintendo|switch|pro controller|joy-con|057e/i.test(id)) return 'switch';
  return 'gamepad';
}
export const KIND_NAME = { tastatur: 'Tastatur', xbox: 'Xbox', ps: 'PlayStation', switch: 'Switch', gamepad: 'Gamepad', handy: 'Handy' };
// Beschriftung der 8BOY-Tasten auf dem jeweiligen Controller (Belegung nach Lage wie beim SNES:
// A rechts, B unten, X oben, Y links). Beim 8BOY (8 Tasten) sind A = rechts/oben, B = unten/links.
export function padLabels(kind) {
  if (kind === 'xbox') return { A: 'B', B: 'A', X: 'Y', Y: 'X', L: 'LB', R: 'RB', START: '☰', SELECT: '⧉' };
  if (kind === 'ps') return { A: '○', B: '✕', X: '△', Y: '□', L: 'L1', R: 'R1', START: 'OPTIONS', SELECT: 'SHARE' };
  if (kind === 'switch') return { A: 'A', B: 'B', X: 'X', Y: 'Y', L: 'L', R: 'R', START: '+', SELECT: '−' };
  return { A: 'rechts', B: 'unten', X: 'oben', Y: 'links', L: 'L', R: 'R', START: 'START', SELECT: 'SELECT' };
}

// Rütteln aus der Kartridge (rumble): an/aus/an … in Millisekunden wie navigator.vibrate, s = Stärke fürs Gamepad (0–1)
export const RUMBLE = {
  tipp: { v: [40], s: 0.35 },
  treffer: { v: [110], s: 0.8 },
  lang: { v: [450], s: 0.6 },
  sieg: { v: [60, 50, 60, 50, 60, 90, 260], s: 0.55 },   // ta-ta-ta – taaa
  aua: { v: [180, 70, 300], s: 1 },
};
const RUMBLE_MAX = 1500;   // längstes Stück (ms)
// Muster aus Name, Zahl (ms) oder Liste (an, aus, an …) → { v, s } oder null (unbekannt)
export function rumblePattern(m = 'tipp') {
  if (typeof m === 'string') return RUMBLE[m.toLowerCase()] || null;
  if (typeof m === 'number' && m > 0) return { v: [Math.min(RUMBLE_MAX, Math.round(m))], s: 0.7 };
  if (Array.isArray(m)) {
    const v = m.slice(0, 12).map((x) => Math.max(0, Math.min(RUMBLE_MAX, Math.round(+x || 0))));
    return v.some((x, i) => i % 2 === 0 && x > 0) ? { v, s: 0.7 } : null;
  }
  return null;
}
// Anzeige auf dem Handy (padinfo): feste Symbole, damit nur Namen übertragen werden
export const PAD_SYMBOLE = {
  krone: '👑', auge: '👁️', geist: '👻', bombe: '💣', herz: '❤️', stern: '⭐', fragezeichen: '❓', katze: '🐱', maus: '🐭',
  pinsel: '🖌️', ballon: '🎈', schneeflocke: '❄️', blitz: '⚡', pokal: '🏆', haken: '✅', kreuz: '❌',
};
export const PADINFO_MAX = 40;   // Zeichen
// Text kürzen, Steuerzeichen weg, Farbe 0xRRGGBB, Symbol nur aus der Liste → { txt, bg, sym } oder null (= löschen)
export function padinfoClean(text, farbe, symbol) {
  const txt = [...String(text ?? '').replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g, ' ').trim()].slice(0, PADINFO_MAX).join('');
  const sym = typeof symbol === 'string' && Object.hasOwn(PAD_SYMBOLE, symbol.toLowerCase()) ? symbol.toLowerCase() : null;
  if (!txt && !sym) return null;
  const out = { txt };
  if (typeof farbe === 'number' && Number.isFinite(farbe)) out.bg = Math.max(0, Math.min(0xffffff, Math.floor(farbe)));
  if (sym) out.sym = sym;
  return out;
}

export function createInput() {
  const sources = { key: new Uint8Array(N), touch: new Uint8Array(N), pad: new Uint8Array(N) };
  const down = new Uint8Array(N), held = new Uint16Array(N);
  // je Spieler 1–4 (Index 0 bleibt frei, damit p direkt passt)
  const pdown = Array.from({ length: MAX_PLAYERS + 1 }, () => new Uint8Array(N));
  const pheld = Array.from({ length: MAX_PLAYERS + 1 }, () => new Uint16Array(N));
  const listeners = new Set(), joinListeners = new Set();
  let superPad = false; // Gamepad-Belegung wie beim SNES: A rechts, B unten, X oben, Y links, L/R Schultertasten

  // Geräte: 'gp<index>' (Gamepad) oder 'ph<id>' (Handy) → { kind, b: Tasten, axes, slot, start }
  const devices = new Map();
  const slots = new Array(MAX_PLAYERS + 1).fill(null);   // Spieler → Geräteschlüssel

  function mapPad(p, out) {
    out.fill(0);
    const b = (i) => !!p.buttons[i]?.pressed;
    const ax = p.axes[0] || 0, ay = p.axes[1] || 0;
    if (b(14) || ax < -0.5) out[0] = 1;
    if (b(15) || ax > 0.5) out[1] = 1;
    if (b(12) || ay < -0.5) out[2] = 1;
    if (b(13) || ay > 0.5) out[3] = 1;
    if (superPad) {
      if (b(1)) out[4] = 1;
      if (b(0)) out[5] = 1;
      if (b(3)) out[8] = 1;
      if (b(2)) out[9] = 1;
      if (b(4) || b(6)) out[10] = 1;
      if (b(5) || b(7)) out[11] = 1;
    } else {
      if (b(1) || b(3)) out[4] = 1; // rechte Taste = A (Handheld-Belegung)
      if (b(0) || b(2)) out[5] = 1;
    }
    if (b(9)) out[6] = 1;
    if (b(8)) out[7] = 1;
  }

  function freeSlot() { for (let s = 1; s <= MAX_PLAYERS; s++) if (!slots[s]) return s; return 0; }
  function seat(key) {
    const d = devices.get(key);
    if (!d || d.slot) return;
    const s = freeSlot();
    if (!s) return;
    d.slot = s; slots[s] = key;
    joinListeners.forEach((fn) => fn({ type: 'join', slot: s, kind: d.kind, key }));
  }
  function unseat(key) {
    const d = devices.get(key);
    devices.delete(key);
    if (d?.slot) { slots[d.slot] = null; joinListeners.forEach((fn) => fn({ type: 'leave', slot: d.slot, kind: d.kind, key })); }
  }

  function pollGamepads() {
    sources.pad.fill(0);
    const seen = new Set();
    for (const p of globalThis.navigator?.getGamepads?.() || []) {
      if (!p || p.connected === false) continue;
      const key = 'gp' + p.index;
      seen.add(key);
      let d = devices.get(key);
      if (!d) { d = { kind: padKind(p.id), b: new Uint8Array(N), axes: [], slot: 0, start: 0 }; devices.set(key, d); }
      mapPad(p, d.b);
      d.axes = p.axes;
    }
    for (const [key, d] of devices) if (key.startsWith('gp') && !seen.has(key)) unseat(key);
    for (const [key, d] of devices) {
      for (let i = 0; i < N; i++) sources.pad[i] |= d.b[i];
      // „Drücke START zum Mitmachen“: ein Gamepad ohne Platz bekommt mit START den nächsten freien.
      // Ist Platz 1 noch frei, nimmt ihn das erste Gamepad mit irgendeiner Taste (wer einfach losspielt, ist Spieler 1)
      if (!d.slot && ((d.b[6] && !d.start) || (!slots[1] && d.b.some((v) => v)))) seat(key);
      d.start = d.b[6];
    }
  }

  // Einmal pro Bild vor _update aufrufen
  // Maus (am PC): Position auf dem Bildschirm der Kartridge, Tasten, Bewegung seit dem letzten Bild, Rad.
  // Gefangen (Pointer Lock) liefert sie nur Bewegung – dann dient sie auch als rechter Stick (stick(1)).
  const mouse = { x: -1, y: -1, inside: false, b: 0, pb: 0, dx: 0, dy: 0, wheel: 0, locked: false, wantLock: false, used: false, hideCursor: false };
  let accDx = 0, accDy = 0, accWheel = 0, liveB = 0, clickB = 0;
  const mouseAt = (x, y, inside) => { mouse.x = x; mouse.y = y; mouse.inside = inside; };
  const mouseMove = (dx, dy) => { accDx += dx; accDy += dy; };
  // clickB merkt auch Klicks, die kürzer als ein Bild sind
  const mouseButton = (n, on) => { if (on) { liveB |= 1 << n; clickB |= 1 << n; } else liveB &= ~(1 << n); };
  const mouseWheel = (d) => { accWheel += d; };
  const mouseLocked = (on) => { mouse.locked = on; };

  function tick() {
    pollGamepads();
    mouse.pb = mouse.b; mouse.b = liveB | clickB; clickB = 0;
    mouse.dx = accDx; mouse.dy = accDy; mouse.wheel = accWheel; accDx = accDy = accWheel = 0;
    for (let i = 0; i < N; i++) {
      down[i] = sources.key[i] | sources.touch[i] | sources.pad[i];
      held[i] = down[i] ? held[i] + 1 : 0;
    }
    // Spieler 1: Tastatur, Touch und sein Gerät – solange Platz 1 frei ist, auch jedes Gamepad ohne Platz
    for (let p = 1; p <= MAX_PLAYERS; p++) {
      const pd = pdown[p], d = slots[p] ? devices.get(slots[p]) : null;
      for (let i = 0; i < N; i++) pd[i] = d ? d.b[i] : 0;
      if (p === 1) {
        for (let i = 0; i < N; i++) pd[i] |= sources.key[i] | sources.touch[i];
        if (!d) for (const o of devices.values()) if (!o.slot) for (let i = 0; i < N; i++) pd[i] |= o.b[i];
      }
      for (let i = 0; i < N; i++) pheld[p][i] = pd[i] ? pheld[p][i] + 1 : 0;
    }
  }

  // gedrückt in diesem Bild, bei gehaltener Taste nach 15 Bildern alle 4 Bilder erneut
  // (START/SELECT wiederholen nicht: START halten öffnet das Menü)
  const repeat = (i, h) => h === 1 || (i !== 6 && i !== 7 && h > 15 && (h - 15) % 4 === 0);
  const okP = (p) => p >= 1 && p <= MAX_PLAYERS;
  const btn = (i, p) => (p === undefined ? !!down[i] : okP(p) && !!pdown[p][i]);
  const btnp = (i, p) => (p === undefined ? repeat(i, held[i]) : okP(p) && repeat(i, pheld[p][i]));

  function set(source, i, on) {
    const was = sources[source][i];
    sources[source][i] = on ? 1 : 0;
    if (on && !was) listeners.forEach((fn) => fn(i));
  }

  // Handy als Controller (über die Lobby): Tasten kommen als Bitmaske
  function phoneAdd(id) {
    const key = 'ph' + id;
    if (!devices.has(key)) devices.set(key, { kind: 'handy', b: new Uint8Array(N), axes: [], slot: 0, start: 0 });
    seat(key);
    return devices.get(key).slot;
  }
  function phoneSet(id, mask) {
    const d = devices.get('ph' + id);
    if (!d) return;
    for (let i = 0; i < N; i++) d.b[i] = (mask >> i) & 1;
  }
  const phoneRemove = (id) => unseat('ph' + id);

  // ---------------------------------------------------------------- Rückweg zu den Geräten
  // rumble(p, muster): Gamepads direkt (vibrationActuator), Handys über den Dock (padOut). p = 0: alle Spieler.
  // Ohne Gerät passiert nichts – nie ein Fehler. Je Gerät höchstens 10 Rüttler pro Sekunde.
  let padOut = null;   // vom Dock: { rumble(handyId, v), show(handyId) }
  const shows = new Array(MAX_PLAYERS + 1).fill(null);   // padinfo je Spieler
  const setPadOut = (o) => { padOut = o; };
  const now = () => globalThis.performance?.now?.() ?? Date.now();
  // Geräte von Spieler p; Spieler 1 ohne eigenes Gerät: die Gamepads ohne Platz (die spielen für ihn mit)
  function keysOf(p) {
    if (slots[p]) return [slots[p]];
    return p === 1 ? [...devices].filter(([, d]) => !d.slot).map(([k]) => k) : [];
  }
  function gamepadRumble(d, index, pat) {
    for (const t of d.rtimers || []) clearTimeout(t);
    d.rtimers = [];
    let at = 0;
    pat.v.forEach((ms, i) => {
      if (i % 2 === 0 && ms > 0) {
        d.rtimers.push(setTimeout(() => {
          try {
            const act = globalThis.navigator?.getGamepads?.()[index]?.vibrationActuator;
            act?.playEffect?.('dual-rumble', { startDelay: 0, duration: ms, strongMagnitude: pat.s, weakMagnitude: Math.min(1, pat.s + 0.2) })?.catch?.(() => {});
          } catch { /* kein Rütteln – egal */ }
        }, at));
      }
      at += ms;
    });
  }
  function rumble(p, pat) {
    if (!pat?.v?.length) return;
    for (let q = 1; q <= MAX_PLAYERS; q++) {
      if (p && q !== p) continue;
      for (const key of keysOf(q)) {
        const d = devices.get(key), t = now();
        if (!d || t - (d.rumbleAt ?? -1e9) < 100) continue;
        d.rumbleAt = t;
        if (key.startsWith('ph')) padOut?.rumble?.(+key.slice(2), pat.v);
        else gamepadRumble(d, +key.slice(2), pat);
      }
    }
  }
  // padinfo(p, anzeige): Anzeige auf dem Handy von Spieler p (null = weg), p = 0: alle
  function padinfo(p, info) {
    for (let q = 1; q <= MAX_PLAYERS; q++) {
      if (p && q !== p) continue;
      if (JSON.stringify(shows[q]) === JSON.stringify(info)) continue;
      shows[q] = info;
      if (slots[q]?.startsWith('ph')) padOut?.show?.(+slots[q].slice(2));
    }
  }
  const padshow = (p) => (okP(p) ? shows[p] : null);
  // Kartridge zu Ende: alle Anzeigen weg
  const padReset = () => padinfo(0, null);

  // Wer spielt mit? players() = belegte Plätze (Spieler 1 ist immer da), pad(p) = Art des Geräts oder null
  function players() { let n = 1; for (let s = 2; s <= MAX_PLAYERS; s++) if (slots[s]) n = s; return n; }
  function pad(p) {
    if (!okP(p)) return null;
    if (slots[p]) return devices.get(slots[p])?.kind || null;
    return p === 1 ? 'tastatur' : null;
  }
  function seats() {
    const out = [];
    for (let s = 1; s <= MAX_PLAYERS; s++) out.push({ slot: s, kind: pad(s), key: slots[s] });
    return out;
  }
  const waiting = () => [...devices.values()].filter((d) => !d.slot).map((d) => d.kind);

  function bindKeyboard(target = window) {
    target.addEventListener('keydown', (e) => {
      // Eingabefelder und die Zugänglichkeits-Ebene (Auswahllisten) behalten ihre Tasten
      if (e.target.closest?.('textarea, input, [contenteditable], .a11y, .a11y-set')) return;
      // Mit der Tastatur angesteuerter Knopf (Tab, sichtbarer Fokus): Enter/Leertaste drücken den Knopf, nicht A/MENÜ.
      // Nach einem Mausklick hat der Knopf keinen sichtbaren Fokus – dann bekommt das Spiel die Tasten wie bisher.
      if ((e.code === 'Enter' || e.code === 'NumpadEnter' || e.code === 'Space') && e.target !== document.body &&
          e.target.closest?.('button, a[href], label, [role="button"], [tabindex]') && e.target.matches?.(':focus-visible')) return;
      const i = KEYS[e.code];
      if (i === undefined) return;
      e.preventDefault();
      set('key', i, true);
    });
    target.addEventListener('keyup', (e) => {
      const i = KEYS[e.code];
      if (i !== undefined) set('key', i, false);
    });
    target.addEventListener('blur', () => sources.key.fill(0));
  }

  const onPress = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
  const onJoin = (fn) => { joinListeners.add(fn); return () => joinListeners.delete(fn); };
  // Plätze bleiben beim Leeren erhalten – nur die Tasten werden losgelassen
  const clear = () => {
    Object.values(sources).forEach((s) => s.fill(0)); down.fill(0); held.fill(0);
    pdown.forEach((a) => a.fill(0)); pheld.forEach((a) => a.fill(0));
    for (const [key, d] of devices) { if (key.startsWith('ph')) d.b.fill(0); d.start = 1; }
    liveB = clickB = 0; accDx = accDy = accWheel = 0; mouse.b = mouse.pb = 0; mouse.wantLock = false; mouse.used = false; mouse.hideCursor = false;
  };
  const setSuper = (on) => { superPad = !!on; };

  // 8BOY 32: Analogsticks (-1..1). stick(0) = linker Stick, ohne Gamepad das Steuerkreuz (-1, 0 oder 1).
  // stick(1) = rechter Stick (Umschauen), ohne Gamepad 0, 0 – Kartridges bieten dafür zusätzlich Tasten an.
  // stick(n, p): nur das Gerät von Spieler p (ohne Stick: sein Steuerkreuz).
  function stick(n = 0, p) {
    if (p !== undefined) {
      if (!okP(p)) return [0, 0];
      const d = slots[p] ? devices.get(slots[p]) : null;
      const list = d ? [d] : p === 1 ? [...devices.values()].filter((o) => !o.slot) : [];
      for (const o of list) {
        const x = o.axes[n * 2] || 0, y = o.axes[n * 2 + 1] || 0;
        if (Math.hypot(x, y) > 0.15) return [x, y];
      }
      if (n) return p === 1 && mouse.locked ? [Math.max(-1, Math.min(1, mouse.dx / 12)), Math.max(-1, Math.min(1, mouse.dy / 12))] : [0, 0];
      const pd = pdown[p];
      return [pd[1] - pd[0], pd[3] - pd[2]];
    }
    for (const p of globalThis.navigator?.getGamepads?.() || []) {
      if (!p) continue;
      const x = p.axes[n * 2] || 0, y = p.axes[n * 2 + 1] || 0;
      if (Math.hypot(x, y) > 0.15) return [x, y];
    }
    // ohne rechten Stick: gefangene Maus (etwa 12 Pixel Bewegung pro Bild = voller Ausschlag)
    if (n) return mouse.locked ? [Math.max(-1, Math.min(1, mouse.dx / 12)), Math.max(-1, Math.min(1, mouse.dy / 12))] : [0, 0];
    return [(down[1] ? 1 : 0) - (down[0] ? 1 : 0), (down[3] ? 1 : 0) - (down[2] ? 1 : 0)];
  }

  return {
    tick, btn, btnp, set, bindKeyboard, onPress, onJoin, clear, setSuper, stick, down, mouse, mouseAt, mouseMove, mouseButton, mouseWheel, mouseLocked,
    players, pad, seats, waiting, phoneAdd, phoneSet, phoneRemove, rumble, padinfo, padshow, padReset, setPadOut,
  };
}
