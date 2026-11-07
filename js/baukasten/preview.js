// Eingebaute Vorschau: lässt die erzeugte Kartridge direkt im Baukasten laufen (gleicher Grafikchip, gleiche Lua-Maschine
// wie die Konsole). Tastatur wie an der Konsole, sobald das Bild angeklickt ist.
import { createGfx } from '../gfx.js';
import { createVM, CartError } from '../vm.js';
import { createInput } from '../input.js';
import { machineFor } from '../machines.js';
import { parseCart } from '../carts.js';

export function createPreview(canvas, { audio, onError = () => {}, onLog = () => {}, onFrame = () => {} } = {}) {
  let gfx = null, vm = null, input = null, raf = 0, last = 0, acc = 0, paused = false, mute = false;
  const ctx = canvas.getContext('2d');
  let img = null, out32 = null;
  const store = new Map();
  const quietAudio = { play() {}, stop() {}, sfx() {}, beep() {}, tone() {}, playing: () => false, playpos: () => -1, setMachine() {} };
  input = createInput();
  input.bindKeyboard(canvas);

  function stop() {
    cancelAnimationFrame(raf); raf = 0;
    if (vm) { try { vm.close(); } catch { /* egal */ } }
    vm = null;
    audio?.stop();
  }
  function start(code) {
    stop();
    const cart = parseCart(code, { id: 'vorschau' });
    const m = machineFor(cart.system);
    gfx = createGfx(m);
    canvas.width = m.w; canvas.height = m.h;
    img = ctx.createImageData(m.w, m.h);
    out32 = new Uint32Array(img.data.buffer);
    audio?.setMachine?.(m);
    input.clear();
    store.clear();
    const a = mute || !audio ? quietAudio : audio;
    try {
      vm = createVM({ fengari: window.fengari, gfx, audio: a, input, storage: { get: (k) => store.get(k) ?? null, set: (k, v) => store.set(k, v) }, onLog, machine: m });
      vm.run(code, 'cart');
    } catch (e) { fail(e); return false; }
    paused = false;
    last = performance.now(); acc = 0;
    raf = requestAnimationFrame(loop);
    return true;
  }
  function fail(e) {
    const err = e instanceof CartError ? e : new CartError(e?.stack || String(e));
    stop();
    onError(err);
  }
  function step() {
    input.tick();
    vm.update();
    vm.draw();
  }
  function loop(now) {
    raf = requestAnimationFrame(loop);
    if (paused || !vm) { last = now; return; }
    acc += Math.min(100, now - last); last = now;
    let n = 0;
    try {
      while (acc >= 1000 / 60 && n < 4) { step(); acc -= 1000 / 60; n++; }
    } catch (e) { fail(e); return; }
    if (n) { gfx.present(out32); ctx.putImageData(img, 0, 0); onFrame(); }
  }
  return {
    start, stop,
    get running() { return !!vm; },
    get paused() { return paused; },
    pause(v = !paused) { paused = v; if (paused) audio?.stop(); },
    setMute(v) { mute = v; },
    input,
  };
}

// Schnelltest ohne Bild und Ton: läuft die Kartridge ein paar Sekunden ohne Fehler? (vor dem Öffnen der Konsole)
export function smokeTest(code, frames = 180) {
  const cart = parseCart(code, { id: 'test' });
  const m = machineFor(cart.system);
  const gfx = createGfx(m);
  const input = createInput();
  const quiet = { play() {}, stop() {}, sfx() {}, beep() {}, tone() {}, playing: () => false, playpos: () => -1, setMachine() {} };
  const mem = new Map();
  let vm = null;
  try {
    vm = createVM({ fengari: window.fengari, gfx, audio: quiet, input, storage: { get: (k) => mem.get(k) ?? null, set: (k, v) => mem.set(k, v) }, machine: m });
    vm.run(code, 'cart');
    for (let f = 0; f < frames; f++) {
      // ein bisschen herumlaufen und drücken, damit auch Berührungen und Dialoge drankommen
      const held = [[1], [3], [0], [2], [4], []][(f >> 4) % 6];
      for (let i = 0; i < 8; i++) input.set('key', i, held.includes(i));
      input.tick(); vm.update(); vm.draw();
    }
    return null;
  } catch (e) {
    return e instanceof CartError ? e : new CartError(e?.stack || String(e));
  } finally { try { vm?.close(); } catch { /* egal */ } }
}
