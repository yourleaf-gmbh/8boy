// 8BOY: verbindet Engine, Gehäuse, Regal und Editor im Browser.
import { createGfx } from './gfx.js';
import { createGpu, GPU_MAX_TRIS } from './gpu.js';
import { MACHINES, machineFor, fits } from './machines.js';
import { createAudio } from './audio.js';
import { createInput } from './input.js';
import { createSystem } from './system.js';
import { createAssets, PAK_ENDUNG } from './assets.js';
import { createNet } from './net.js';
import { createEditor, TEMPLATE } from './editor.js';
import {
  parseCart, loadBuiltinCarts, loadUserCarts, saveUserCart, deleteUserCart, newCartId, fileNameFor, iconDataURL, colorHex,
  loadCover, isUnpacked, markUnpacked, loadStoreCatalog, coverUrl, cartUrl, storeChoice, setStoreChoice, SPEICHER_VOLL,
  saveIds, cartSaves, saveInfo, hasSaves, putSaves, deleteSaves, makeBackup, isBackup, restoreBackup,
} from './carts.js';
import { renderBoxFront, parseManual } from './pixelart.js';
import { uiZeichnen, UI_SCHRIFT } from './ui-ebene.js';
import { createUnboxer } from './unbox.js';
import { isPNG, extractCart, extractCover, extractSaves, buildPNGCart } from './pngcart.js';
import { createInnen } from './innen.js';
import { createAccess } from './a11y.js';
import { createDock, tvScreenSize, TV_BAR_H } from './dock.js';
// Store: Im Grundregal liegen die Lektionen; neue Besucher bekommen dazu ein Starter-Regal mit Spielen (STARTER),
// soweit die Spiele im Store-Katalog liegen. Alles Weitere holt man sich aus dem Store. Mit ?alle liegt alles im
// Regal, ebenso für die automatischen Tests und Werkzeuge auf localhost (navigator.webdriver).
const LOKAL = /^(localhost|127\.)/.test(location.hostname);
const ALLE = /[?&]alle\b/.test(location.search) || (LOKAL && navigator.webdriver && !/[?&]store\b/.test(location.search));
// Starter-Regal für neue Besucher: ein Spiel, ein Lernspiel, ein Party-Spiel – nur, was im Store-Katalog liegt
// (eigener Katalog carts/store.json oder ein externer aus config.js)
const STARTER = ['snake.lua', 'stadtpark.lua', 'partywelt.lua'];

const $ = (id) => document.getElementById(id);
const app = $('app'), consoleEl = $('console'), canvas = $('screen');
// Handy als Controller: index.html#pad=<code> zeigt nur das Gamepad (js/pad.js)
const PAD = /^#pad=([A-Za-z0-9]{4,8})$/.exec(location.hash);
if (PAD) import('./pad.js').then((m) => { window.eightpad = m.startPad(PAD[1].toUpperCase()); });

// ------------------------------------------------------------------ Einstellungen
const SETTINGS_KEY = '8boy:settings';
// Startkonsole für neue Besucher: 8BOY 32 (Entscheidung Kai 29.10.2026); wer schon gespielt hat, behält seine Wahl
const settings = Object.assign({ classic: false, volume: 0.6, theme: 'classic', lcd: false, big: false, btnScale: 1, model: 32, tv: false, bild: 'rahmen' },
  (() => { try { return JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {}; } catch { return {}; } })());
// ?tv in der Adresse: gleich im TV-Modus starten (Dock); ?tv=0 schaltet ihn ab
{ const tv = /[?&]tv(?:=([01]))?(?:&|$)/.exec(location.search); if (tv && !PAD) settings.tv = tv[1] !== '0'; }
const hw = () => machineFor(settings.model);
// 8BOY 128 ist in Arbeit: sichtbar nur lokal oder mit ?giga in der Adresse
const GIGA_SICHTBAR = /^(localhost|127\.0\.0\.1)$/.test(location.hostname) || /[?&]giga\b/.test(location.search);
if (settings.model === 128 && !GIGA_SICHTBAR) settings.model = 64;
function applySettings() {
  gfx.state.classic = settings.classic;
  applyMachine();
  audio.setVolume(settings.volume);
  document.body.className = document.body.className.replace(/\btheme-\S+/g, '').trim();
  if (settings.theme !== 'classic') document.body.classList.add('theme-' + settings.theme);
  document.querySelectorAll('.swatch').forEach((s) => s.setAttribute('aria-pressed', s.dataset.theme === settings.theme));
  $('lcdGrid').classList.toggle('on', settings.lcd);
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch { /* privat */ }
  dock.setTV(settings.tv && !PAD);
  layout();
}

// ------------------------------------------------------------------ Engine
const gfx = createGfx(hw());
// 8BOY 64: Grafikchip auf der Grafikkarte (WebGL2). Fehlt sie (oder ?nogpu zum Testen), gibt es eine klare Meldung.
const glCanvas = document.createElement('canvas');
const gpu = /[?&]nogpu\b/.test(location.search) ? { ok: false } : createGpu(glCanvas);
if (gpu.ok) { gfx.attachGpu(gpu.attach); if (hw().gpu) gfx.setMode(hw()); } else gfx.gpuMissing = true;
const audio = createAudio();
const input = createInput();
input.bindKeyboard(window);

let carts = [];
let editingCart = null;

const net = createNet();
// Zugänglichkeit: nur für Kartridges mit „-- a11y: voll“ (z. B. die Lernspiele aus 8boy-lernspiele), sonst unsichtbar
const access = createAccess({
  audio, hw,
  onChoice: (id, nr) => system.choice(id, nr),
  onDescribe: () => system.describe(),
});
// Asset-Pakete (8BOY 128): vom Server (assets/<paket>/) oder als .8bpak im Browser
const assets = createAssets();
const system = createSystem({
  fengari: window.fengari, gfx, audio, input, settings, console: hw, net, access, assets,
  // Haltepunkte und Beobachten gelten nur für die Kartridge aus dem Studio
  debugFor: (cart) => (isStudioCart(cart) ? { breakpoints: editor.breakpoints, watches: editor.watches } : null),
  onLog: (msg) => editor.print(msg, msg.startsWith('FEHLER') ? 'err' : ''),
  onEvent: (type, data) => {
    if (type === 'shelf') toggleShelf(true);
    if (type === 'editor') openStudio();
    if (type === 'phones') dock.pair();
    if (type === 'code') openEditor(data);
    if (type === 'settings') applySettings();
    if (type === 'ejected') ejectVisual();
    if (type === 'machine') switchMachine(data);
    if (type === 'mode') frameDirty = true;
    if (type === 'error' && editingCart && system.cart?.id === editingCart.id) editor.showError(data);
    if (type === 'state') { $('led').classList.toggle('on', data !== 'off'); editor.setRunning((data === 'running' || data === 'paused') && isStudioCart(system.cart)); }
    if (type === 'debug') onDebugEvent(data);
  },
});
// Dock: TV-Modus, mehrere Gamepads, Handy als Controller
const dock = createDock({
  app, input, system, hw, toast: (m) => toast(m),
  onBack: {
    dialog: () => closeDialog(), store: () => storeZurueck(), shelf: () => toggleShelf(false),
    tvOff: () => { settings.tv = false; applySettings(); },
  },
});

// Bildschirm der Konsole. Läuft eine ältere Kartridge, liegt ihr Bild mittig in einem Rahmen.
const ctx2d = canvas.getContext('2d');
let image = null, out32 = null, frameDirty = true, border = null;
function makeBorder(fw, fh, iw, ih) {
  const g = createGfx({ w: fw, h: fh, colors: 256, layers: 1 });
  g.cls(0);
  g.backdrop(0, fh, 0x2a2440, 0x4a2a5a);
  for (let y = 0; y < fh; y += 8) for (let x = (y / 8) % 2 * 8; x < fw; x += 16) g.rectfill(x, y, 8, 8, 16);
  const ox = (fw - iw) >> 1, oy = (fh - ih) >> 1;
  g.rectfill(ox - 3, oy - 3, iw + 6, ih + 6, 5);
  g.rectfill(ox - 2, oy - 2, iw + 4, ih + 4, 0);
  if (oy >= 20) {
    const alt = Object.values(MACHINES).find((m) => m.w === iw) || machineFor(8);
    const t = alt.name.toUpperCase() + '-KARTRIDGE';
    g.text(t, (fw - g.textWidth(t)) >> 1, oy + ih + 12, 29);
    const word = hw().name.toUpperCase();
    g.text(word, (fw - g.textWidth(word)) >> 1, oy - 16, hw().id >= 32 ? 7 : 10);
  }
  const buf = new Uint32Array(fw * fh);
  g.present(buf);
  return buf;
}
// Ältere Kartridge auf größerer Konsole: wohin mit ihrem Bild? „rahmen“ (mittig, Original-Pixel), „fuellen“ (so groß wie
// möglich, seitenrichtig) oder „strecken“ (ganzer Bildschirm). Gibt { x, y, w, h } in Pixeln der Konsole zurück.
const BILDMODI = ['rahmen', 'fuellen', 'strecken'];
const BILDNAME = { rahmen: 'im Rahmen (Original)', fuellen: 'füllen (seitenrichtig)', strecken: 'gestreckt (ganzer Bildschirm)' };
function cartRect(m) {
  const w = gfx.w, h = gfx.h;
  if (w === m.w && h === m.h) return { x: 0, y: 0, w, h, voll: true };
  if (settings.bild === 'strecken') return { x: 0, y: 0, w: m.w, h: m.h };
  if (settings.bild === 'fuellen') {
    const k = Math.min(m.w / w, m.h / h), dw = Math.round(w * k), dh = Math.round(h * k);
    return { x: (m.w - dw) >> 1, y: (m.h - dh) >> 1, w: dw, h: dh };
  }
  return { x: (m.w - w) >> 1, y: (m.h - h) >> 1, w, h, rahmen: true };
}
// Bild in Kartridge-Größe (für füllen/strecken), danach skaliert auf den Bildschirm gezeichnet
const cartCanvas = document.createElement('canvas'), cartCtx = cartCanvas.getContext('2d');
let cartImage = null, cartOut = null;
function cartBild() {
  if (!cartImage || cartImage.width !== gfx.w || cartImage.height !== gfx.h) {
    cartCanvas.width = gfx.w; cartCanvas.height = gfx.h;
    cartImage = cartCtx.createImageData(gfx.w, gfx.h);
    cartOut = new Uint32Array(cartImage.data.buffer);
  }
  gfx.present(cartOut);
  cartCtx.putImageData(cartImage, 0, 0);
  return cartCanvas;
}
let bildKnopfDa = null;
function bildKnopf(zeigen) {
  if (zeigen === bildKnopfDa) return;
  bildKnopfDa = zeigen;
  $('btnBild').hidden = !zeigen;
  $('btnBild').dataset.modus = settings.bild;
}
// 8BOY 64: das 3D-Bild der Grafikkarte zuerst, darüber die 2D-Ebene (Farbe 0 durchsichtig)
const layer = document.createElement('canvas'), layerCtx = layer.getContext('2d');
function presentGpu(m) {
  // 8BOY-32-Kartridge im 64er-Modus: kleineres Bild mittig im Rahmen, die 3D-Welt der Grafikkarte genau dort
  const w = gfx.w, h = gfx.h, ox = (m.w - w) >> 1, oy = (m.h - h) >> 1;
  const R = cartRect(m);
  if (!R.voll && !R.rahmen) {
    // gefüllt oder gestreckt: schwarzer Grund, 3D-Bild und 2D-Ebene gemeinsam skaliert (scharfe Pixel)
    const c2 = cartBild();
    ctx2d.imageSmoothingEnabled = false;
    ctx2d.fillStyle = '#000'; ctx2d.fillRect(0, 0, m.w, m.h);
    ctx2d.globalAlpha = 1;
    ctx2d.drawImage(glCanvas, R.x, R.y, R.w, R.h);
    if (gfx.state.bright < 15) { ctx2d.fillStyle = `rgba(0,0,0,${1 - gfx.state.bright / 15})`; ctx2d.fillRect(R.x, R.y, R.w, R.h); }
    ctx2d.drawImage(c2, R.x, R.y, R.w, R.h);
    return;
  }
  if (ox || oy) {
    if (frameDirty || !border) { border = makeBorder(m.w, m.h, w, h); frameDirty = false; }
    out32.set(border);
    gfx.present(out32, m.w, ox, oy);
  } else gfx.present(out32);
  const g3 = gfx.g3;
  if (layer.width !== m.w || layer.height !== m.h) { layer.width = m.w; layer.height = m.h; }
  layerCtx.putImageData(image, 0, 0);
  ctx2d.globalAlpha = 1;
  ctx2d.drawImage(glCanvas, ox, oy, w, h);
  // Helligkeit (fade) gilt auch für die 3D-Welt
  if (gfx.state.bright < 15) { ctx2d.fillStyle = `rgba(0,0,0,${1 - gfx.state.bright / 15})`; ctx2d.fillRect(ox, oy, w, h); }
  ctx2d.drawImage(layer, 0, 0);
  // Datenblatt: mehr Dreiecke, als der Chip schafft → freundlicher Hinweis statt Absturz
  if (g3.overLimit) {
    ctx2d.fillStyle = 'rgba(160,20,40,.85)'; ctx2d.fillRect(0, m.h - 18, m.w, 18);
    ctx2d.fillStyle = '#fff'; ctx2d.font = 'bold 11px system-ui, sans-serif';
    ctx2d.fillText(`Grafikchip: mehr als ${GPU_MAX_TRIS.toLocaleString('de-DE')} Dreiecke in einem Bild – der Rest wurde weggelassen.`, 8, m.h - 5);
  }
  // debug3d("zahlen"): Zeichenaufrufe und Dreiecke des letzten Bildes
  if (g3.showStats) {
    const st = g3.stats3d();
    const txt = `GPU  ${st.calls} Aufrufe · ${st.tris.toLocaleString('de-DE')} Dreiecke`;
    ctx2d.font = 'bold 12px ui-monospace, monospace';
    ctx2d.fillStyle = 'rgba(0,0,0,.65)'; ctx2d.fillRect(4, 4, ctx2d.measureText(txt).width + 12, 18);
    ctx2d.fillStyle = '#7dffa8'; ctx2d.fillText(txt, 10, 17);
  }
}
// UI-Ebene (js/ui-ebene.js): eigene Leinwand in Gerätepixeln über dem Bild, scharfe Schrift und Kästen
const uiCanvas = document.createElement('canvas');
uiCanvas.className = 'ui-ebene';
uiCanvas.setAttribute('aria-hidden', 'true');
canvas.after(uiCanvas);
const uiCtx = uiCanvas.getContext('2d');
let uiLeer = true, uiSchrift = false;
function uiSchriftLaden() {
  uiSchrift = true;
  if (typeof FontFace === 'undefined') return;
  for (const [datei, gewicht] of [['Regular', '400'], ['Bold', '700']]) {
    const f = new FontFace(UI_SCHRIFT, `url(vendor/AtkinsonHyperlegible-${datei}.ttf)`, { weight: gewicht });
    f.load().then((x) => document.fonts.add(x)).catch(() => {});
  }
}
const hex6 = (v) => '#' + (v & 0xffffff).toString(16).padStart(6, '0');
function presentUi(m) {
  const ui = gfx.ui;
  if (!ui.benutzt) { if (!uiLeer) { uiCtx.clearRect(0, 0, uiCanvas.width, uiCanvas.height); uiLeer = true; } return; }
  if (!uiSchrift) uiSchriftLaden();
  const dpr = window.devicePixelRatio || 1;
  const bw = Math.max(1, Math.round(canvas.clientWidth * dpr)), bh = Math.max(1, Math.round(canvas.clientHeight * dpr));
  if (uiCanvas.width !== bw || uiCanvas.height !== bh) { uiCanvas.width = bw; uiCanvas.height = bh; }
  else uiCtx.clearRect(0, 0, bw, bh);
  const R = cartRect(m), kx = bw / m.w, pal = gfx.palette;
  uiZeichnen(uiCtx, ui.liste, {
    k: kx * R.w / gfx.w, ox: R.x * kx, oy: R.y * (bh / m.h),
    farbe: (c) => hex6(pal[c] ?? 0xffffff),
    pixelFarbe: (c) => hex6(pal[gfx.remap[c] ?? c] ?? 0),
    sprite: (n) => gfx.sprites[n] || null,
    palSig: pal.join(',') + '|' + gfx.remap.join(','),
    hell: gfx.state.bright / 15,
  });
  uiLeer = false;
}
function present() {
  presentBild();
  presentUi(hw());
}
function presentBild() {
  const m = hw();
  if (!image || image.width !== m.w || image.height !== m.h) {
    canvas.width = m.w; canvas.height = m.h;
    image = ctx2d.createImageData(m.w, m.h);
    out32 = new Uint32Array(image.data.buffer);
    frameDirty = true;
  }
  bildKnopf(gfx.w !== m.w || gfx.h !== m.h);
  if (gfx.gpuMode && gfx.state.use3d) { presentGpu(m); return; }
  if (gfx.w === m.w && gfx.h === m.h) gfx.present(out32);
  else if (settings.bild === 'fuellen' || settings.bild === 'strecken') {
    const R = cartRect(m), c2 = cartBild();
    ctx2d.imageSmoothingEnabled = false;
    ctx2d.fillStyle = '#000'; ctx2d.fillRect(0, 0, m.w, m.h);
    ctx2d.drawImage(c2, R.x, R.y, R.w, R.h);
    return;
  } else {
    if (frameDirty || !border) { border = makeBorder(m.w, m.h, gfx.w, gfx.h); out32.set(border); frameDirty = false; }
    gfx.present(out32, m.w, (m.w - gfx.w) >> 1, (m.h - gfx.h) >> 1);
  }
  ctx2d.putImageData(image, 0, 0);
}

// ------------------------------------------------------------------ Maus am Bildschirm
// Position in Pixeln der Kartridge (ältere Kartridges laufen gerahmt: Rand abziehen)
function mouseToCart(e) {
  const r = canvas.getBoundingClientRect(), m = hw();
  const R = cartRect(m);
  const px = Math.floor(((e.clientX - r.left) / r.width * m.w - R.x) * gfx.w / R.w);
  const py = Math.floor(((e.clientY - r.top) / r.height * m.h - R.y) * gfx.h / R.h);
  input.mouseAt(px, py, px >= 0 && py >= 0 && px < gfx.w && py < gfx.h);
}
const mouseScale = () => gfx.w / canvas.getBoundingClientRect().width;   // Bewegung in Kartridge-Pixeln
const mouseBtn = (e) => (e.button === 2 ? 1 : e.button === 1 ? 2 : 0);
canvas.addEventListener('mousemove', (e) => {
  if (document.pointerLockElement !== canvas) mouseToCart(e);
  input.mouseMove(e.movementX * mouseScale(), e.movementY * mouseScale());
});
// mouseleave kommt auch, wenn ein anderes Element den Zeiger übernimmt (Pointer-Capture) – darum echt nachrechnen
canvas.addEventListener('mouseleave', (e) => { if (document.pointerLockElement !== canvas) mouseToCart(e); });
canvas.addEventListener('mousedown', (e) => {
  if (system.state !== 'running') return;
  mouseToCart(e);
  if (input.mouse.wantLock && document.pointerLockElement !== canvas) { canvas.requestPointerLock?.(); e.preventDefault(); return; }
  input.mouseButton(mouseBtn(e), true);
  if (input.mouse.used) e.preventDefault();
});
window.addEventListener('mouseup', (e) => input.mouseButton(mouseBtn(e), false));
canvas.addEventListener('contextmenu', (e) => { if (input.mouse.used) e.preventDefault(); });
canvas.addEventListener('wheel', (e) => { if (system.state === 'running' && input.mouse.used) { input.mouseWheel(Math.sign(e.deltaY)); e.preventDefault(); } }, { passive: false });
document.addEventListener('pointerlockchange', () => {
  const on = document.pointerLockElement === canvas;
  input.mouseLocked(on);
  if (on) toast('Maus gefangen – Esc lässt sie los');
});
let lockHint = false;
function mouseLockTick() {
  // Kartridge möchte die Maus fangen: einmal kurz erklären; beim Auswerfen oder Pausieren wieder freigeben
  const want = system.state === 'running' && input.mouse.wantLock;
  const cur = system.state === 'running' && input.mouse.hideCursor ? 'none' : '';
  if (canvas.style.cursor !== cur) canvas.style.cursor = cur;
  if (want && !lockHint && !input.mouse.locked && matchMedia('(pointer: fine)').matches) {
    lockHint = true;
    // im TV-Modus mit Gamepads oder Handys stört der Hinweis nur
    const pads = settings.tv && input.seats().some((s) => s.kind && s.kind !== 'tastatur');
    if (!pads) toast('Klick ins Bild: Maus fangen (zum Umschauen)');
  }
  if (!want) { lockHint = false; if (document.pointerLockElement === canvas) document.exitPointerLock(); }
}

let last = performance.now(), acc = 0;
function loop(now) {
  acc += Math.min(100, now - last);
  last = now;
  let steps = 0;
  while (acc >= 1000 / 60 && steps < 4) {
    // TV-Modus: liegt Regal, Store oder ein Fenster oben, steuern die Tasten das – das Spiel darunter wartet
    if (dock.navActive()) { input.tick(); dock.navTick(); } else system.tick();
    acc -= 1000 / 60; steps++;
  }
  if (steps) { present(); mouseLockTick(); dock.tick(); }
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

// ------------------------------------------------------------------ Konsole: 8BOY, 8BOY 16 … 8BOY 128
function applyMachine() {
  const m = hw();
  consoleEl.classList.toggle('model-16', m.id >= 16);
  consoleEl.classList.toggle('model-32', m.id >= 32);
  consoleEl.classList.toggle('model-64', m.id >= 64);
  $('bezelLabel').textContent = m.label;
  // Wortmarke bleibt, nur die Generation (16, 32 …) wechselt
  $('brandGen').textContent = m.id > 8 ? m.id : '';
  $('brand').setAttribute('aria-label', m.name);
  consoleEl.style.setProperty('--px-w', m.w); consoleEl.style.setProperty('--px-h', m.h);
  document.querySelectorAll('[data-model]').forEach((b) => b.setAttribute('aria-pressed', +b.dataset.model === m.id));
  document.title = m.name;
}
function switchMachine(id, hinweis = '') {
  if (+id === settings.model) return;
  settings.model = [8, 16, 32, 64, 128].includes(+id) ? +id : 8;
  applySettings();
  toast(hinweis || `Konsole gewechselt: ${hw().name}`);
  if (system.state !== 'off') system.reboot();
  measureButtons();
  dock.machineChanged();
  renderShelf();   // Passendes steht im Regal oben
}

function powerOn() {
  audio.resume();
  if (system.state !== 'off') return;
  $('screenOff').hidden = true;
  system.powerOn();
}

// ------------------------------------------------------------------ Ebenen: Esc und Zurück schließen die oberste
// Packung/Heft und „Handy als Controller“ bringen ihr eigenes Esc mit; Zurück (Browser, Android-Taste, Wischgeste)
// läuft für alle Ebenen hier durch.
function obersteEbene() {
  if (unboxer.isOpen) return { back: () => unboxer.back() };
  if (dock.pairOpen) return { back: () => dock.closePair() };
  if (!$('cartDialog').hidden) return { back: closeDialog };
  if (!$('store').hidden) return { back: storeZurueck };
  if (innen.offen) return { back: () => innen.close() };
  if (!$('editor').hidden && !app.classList.contains('dock-editor')) return { back: closeEditor };
  if (app.classList.contains('shelf-open') && !app.classList.contains('dock-shelf')) return { back: () => toggleShelf(false) };
  return null;
}
window.addEventListener('keydown', (e) => {
  if (e.target.closest('textarea')) return;
  if (e.code === 'Escape') {
    const o = obersteEbene();
    if (o) { e.preventDefault(); o.back(); return; }
  }
  if (e.target.closest('input')) return;
  powerOn();
  if ((e.code === 'Escape' || e.code === 'KeyM' || e.code === 'KeyP') && !obersteEbene()) {
    e.preventDefault();
    if (system.state === 'running' || system.state === 'paused') system.toggleMenu();
  }
});
document.addEventListener('visibilitychange', () => { if (document.hidden) input.clear(); });

// Zurück: Solange eine Ebene offen ist oder ein Spiel läuft, liegt ein eigener Verlaufseintrag oben. Zurück verbraucht
// ihn und schließt die oberste Ebene; im laufenden Spiel öffnet es das Menü der Konsole. Ein zweites Zurück im Menü
// verlässt die Seite wie gewohnt. Schließt man eine Ebene selbst, wird der Eintrag wieder entfernt.
let zurueckBereit = false, zurueckWeg = 0;
function zurueckEbene() {
  return obersteEbene() || (system.state === 'running' && !dock.on ? { back: () => system.toggleMenu() } : null);
}
function zurueckPruefen() {
  if (PAD || zurueckWeg) return;
  const offen = !!zurueckEbene();
  if (offen && !zurueckBereit) { history.pushState({ eightboy: 'ebene' }, ''); zurueckBereit = true; }
  else if (!offen && zurueckBereit) { zurueckBereit = false; zurueckWeg++; history.back(); }
}
window.addEventListener('popstate', () => {
  if (zurueckWeg) { zurueckWeg--; return; }
  if (!zurueckBereit) return;
  zurueckBereit = false;
  zurueckEbene()?.back();
});
setInterval(zurueckPruefen, 150);

// ------------------------------------------------------------------ Layout: quer / hoch
function layout() {
  const dockShelf = !settings.tv && window.innerWidth >= 1180 && !app.classList.contains('dock-editor');
  app.classList.toggle('dock-shelf', dockShelf);
  // TV-Modus: nur das Bild, so groß wie der Fernseher (ganzzahlig, wenn das gut passt)
  if (settings.tv && !PAD) {
    // unten bleibt ein eigener Streifen für die Statusleiste (Spieler, Handy-Code) – sie liegt nie über dem Spiel
    const m = hw(), s = tvScreenSize(m.w, m.h, window.innerWidth, window.innerHeight - TV_BAR_H, window.devicePixelRatio || 1);
    consoleEl.style.setProperty('--screen-w', s.w + 'px');
    consoleEl.style.setProperty('--screen-h', s.h + 'px');
    consoleEl.style.width = '';
    dock.placePanel(s.w);
    return;
  }
  const stage = $('stage').getBoundingClientRect();
  const w = stage.width - 20, h = stage.height - 20;
  const landscape = w > h * 1.05;
  consoleEl.classList.toggle('landscape', landscape);
  consoleEl.classList.toggle('portrait', !landscape);
  consoleEl.classList.toggle('compact', Math.min(w, landscape ? 1180 : 560) < 520);
  // Großbild: Bildschirm so groß wie möglich, im Querformat liegen die Tasten darüber
  const big = !!settings.big;
  consoleEl.classList.toggle('big', big);
  const cw = big ? w : Math.min(w, landscape ? 1180 : 560), ch = big ? h : Math.min(h, landscape ? 660 : 1000);
  const vmin = Math.min(cw, ch);
  const dpr = window.devicePixelRatio || 1;
  const bs = settings.btnScale || 1;
  let availW, availH, side = 0;
  if (big && landscape) {
    availW = cw - 12;
    availH = ch - 12;
  } else if (big) {
    availW = cw - 8;
    availH = ch * 0.62;
  } else if (landscape) {
    side = Math.max(130, Math.min(230, cw * 0.19));
    availW = cw - 2 * side - 36 - 24 - 52;
    availH = ch - 56 - 18 - 44 - 30;
  } else {
    availW = cw - 36 - 28;
    availH = ch * 0.58 - 56 - 40 - 30;
  }
  // Ganzzahlige Vergrößerung in Gerätepixeln = scharfe Pixel
  const { w: W, h: H } = hw(), aspect = W / H;
  let s = Math.floor(Math.min(availW * dpr / W, availH * dpr / H));
  let cssW = s * W / dpr;
  // Auf hochauflösenden Displays (oder wenn Ganzzahl zu viel Platz verschenkt) lieber füllen – Pixel bleiben trotzdem scharf genug
  if (s < 1 || dpr >= 2 || cssW < Math.min(availW, availH * aspect) * 0.8) cssW = Math.min(availW, availH * aspect);
  consoleEl.style.setProperty('--screen-w', Math.max(120, Math.floor(cssW)) + 'px');
  consoleEl.style.setProperty('--screen-h', Math.max(80, Math.floor(cssW * H / W)) + 'px');
  consoleEl.style.setProperty('--side', side + 'px');
  let dpad = landscape ? Math.min(side * 0.82, ch * 0.34) : Math.min(cw * 0.36, ch * 0.2);
  if (big && landscape) dpad = Math.min(ch * 0.36, cw * 0.2);
  dpad = Math.max(80, dpad * bs);
  consoleEl.style.setProperty('--dpad-size', dpad + 'px');
  consoleEl.style.setProperty('--ab-size', Math.max(40, Math.min(dpad * 0.44, vmin * 0.13 * bs)) + 'px');
  consoleEl.style.width = landscape || big ? '' : Math.min(w, 560) + 'px';
  measureButtons();
}
new ResizeObserver(layout).observe($('stage'));
window.addEventListener('resize', layout);
// Bildschirmtastatur: das Studio nur so hoch wie die sichtbare Fläche, sonst liegt die Zeichenleiste unter der Tastatur
if (window.visualViewport) {
  const vv = window.visualViewport;
  const fitEditor = () => {
    $('editor').style.setProperty('--vv-h', vv.height + 'px');
    $('editor').style.setProperty('--vv-top', vv.offsetTop + 'px');
  };
  vv.addEventListener('resize', fitEditor);
  vv.addEventListener('scroll', fitEditor);
  fitEditor();
}

// ------------------------------------------------------------------ Touch / Maus auf den Tasten
const pointers = new Map();
let btnRects = [];
function measureButtons() {
  requestAnimationFrame(() => {
    placeSideButtons();
    btnRects = [...consoleEl.querySelectorAll('[data-btn]')].map((el) => ({ el, id: el.dataset.btn, r: el.getBoundingClientRect() })).filter((b) => b.r.width > 0);
  });
}
// Am Handy: L über dem Steuerkreuz, R über den Aktionstasten (Daumen statt Zeigefinger; oben am Rand lagen sie
// zudem über „Regal“/„Studio“). Im Querformat OPTION/MENÜ klein in die Seitenleisten statt übers Bild.
const TOUCH = matchMedia('(hover: none) and (pointer: coarse)');
function placeSideButtons() {
  const side = TOUCH.matches, quer = side && consoleEl.classList.contains('landscape');
  consoleEl.classList.toggle('side-lr', side);
  consoleEl.classList.toggle('side-sys', quer);
  const els = [...consoleEl.querySelectorAll('.shoulder, .sys-btn')];
  els.forEach((el) => { el.style.left = el.style.top = ''; });
  if (!side) return;
  const c = consoleEl.getBoundingClientRect();
  const rel = (el) => { const r = el.getBoundingClientRect(); return { x: r.left - c.left + r.width / 2, top: r.top - c.top, bottom: r.bottom - c.top }; };
  const d = rel($('dpad')), ab = rel(consoleEl.querySelector('.ab'));
  const bar = consoleEl.querySelector('.c-top').getBoundingClientRect().bottom - c.top + 6;
  const put = (el, x, y) => { el.style.left = Math.round(x) + 'px'; el.style.top = Math.round(y) + 'px'; };
  const sel = consoleEl.querySelector('.sys-btn[data-btn="7"]'), sta = consoleEl.querySelector('.sys-btn[data-btn="6"]');
  const sh = sel.offsetHeight, gap = 14;
  let oben = bar;
  if (!quer) oben = consoleEl.querySelector('.c-sys').getBoundingClientRect().bottom - c.top + 4;
  else if (c.height - Math.max(d.bottom, ab.bottom) >= sh + gap + 6) {  // Platz unter den Tasten
    put(sel, d.x, d.bottom + gap); put(sta, ab.x, ab.bottom + gap);
  } else {                                                          // sonst oben, unter der Leiste
    put(sel, d.x, bar); put(sta, ab.x, bar); oben = bar + sh + 8;
  }
  const L = consoleEl.querySelector('.shoulder.l'), R = consoleEl.querySelector('.shoulder.r'), lh = L.offsetHeight || 34;
  put(L, d.x, Math.max(oben, d.top - gap - lh));
  put(R, ab.x, Math.max(oben, ab.top - gap - lh));
}
const pressedNow = new Set();
function updateTouch() {
  const next = new Set();
  const randTaste = (el) => el.classList.contains('shoulder') || el.classList.contains('sys-btn');
  const abstand = (p, r) => Math.hypot(Math.max(r.left - p.x, 0, p.x - r.right), Math.max(r.top - p.y, 0, p.y - r.bottom));
  for (const p of pointers.values()) {
    let hits = btnRects.filter(({ id, r }) => {
      const pad = id === 'dpad' ? r.width * 0.25 : r.width * 0.22;
      return !(p.x < r.left - pad || p.x > r.right + pad || p.y < r.top - pad || p.y > r.bottom + pad);
    });
    const genau = hits.filter((b) => abstand(p, b.r) === 0);
    if (genau.length) hits = genau;
    else if (hits.length > 1 && hits.some((b) => randTaste(b.el))) hits = [hits.reduce((a, b) => (abstand(p, b.r) < abstand(p, a.r) ? b : a))];
    for (const { id, r } of hits) {
      if (id === 'dpad') {
        const dx = p.x - (r.left + r.width / 2), dy = p.y - (r.top + r.height / 2), dz = r.width * 0.12;
        if (dx < -dz && Math.abs(dx) > Math.abs(dy) * 0.45) next.add(0);
        if (dx > dz && Math.abs(dx) > Math.abs(dy) * 0.45) next.add(1);
        if (dy < -dz && Math.abs(dy) > Math.abs(dx) * 0.45) next.add(2);
        if (dy > dz && Math.abs(dy) > Math.abs(dx) * 0.45) next.add(3);
      } else next.add(+id);
    }
  }
  let newPress = false;
  for (let i = 0; i < 12; i++) {
    const on = next.has(i);
    if (on && !pressedNow.has(i)) newPress = true;
    input.set('touch', i, on);
  }
  pressedNow.clear(); next.forEach((i) => pressedNow.add(i));
  if (newPress && navigator.vibrate) navigator.vibrate(8);
  showPressed();
}
function showPressed() {
  const d = input.down;
  const dp = $('dpad');
  ['left', 'right', 'up', 'down'].forEach((n, i) => dp.classList.toggle('p-' + n, !!(d[i] || pressedNow.has(i))));
  consoleEl.querySelectorAll('.round-btn, .sys-btn, .shoulder').forEach((el) => {
    const i = +el.dataset.btn;
    el.classList.toggle('pressed', !!(d[i] || pressedNow.has(i)));
  });
}
setInterval(showPressed, 50);

consoleEl.addEventListener('pointerdown', (e) => {
  powerOn();
  if (e.target.closest('button, .slot')) return;
  // gefangene Maus oder Mausklick ins Bild bei einer Maus-Kartridge: das ist keine Touch-Taste
  if (document.pointerLockElement || (e.pointerType === 'mouse' && e.target === canvas && input.mouse.used)) return;
  if (!btnRects.length) measureButtons();
  consoleEl.setPointerCapture?.(e.pointerId);
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  updateTouch();
});
consoleEl.addEventListener('pointermove', (e) => {
  if (!pointers.has(e.pointerId)) return;
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  updateTouch();
});
const release = (e) => { if (pointers.delete(e.pointerId)) updateTouch(); };
consoleEl.addEventListener('pointerup', release);
consoleEl.addEventListener('pointercancel', release);
consoleEl.addEventListener('contextmenu', (e) => e.preventDefault());
document.addEventListener('dblclick', (e) => { if (consoleEl.contains(e.target)) e.preventDefault(); });

$('btnMenu').addEventListener('click', () => {
  powerOn();
  if (system.state === 'running' || system.state === 'paused') system.toggleMenu();
  else if (system.cart) system.eject();
  else toggleShelf(true);
});
$('btnShelf').addEventListener('click', () => toggleShelf());
$('btnA11y').addEventListener('click', () => access.openSettings());
// Innenleben: Konsole umdrehen und die Chips ansehen
const innen = createInnen({ system, gfx, audio, input, hw });
$('btnInnen').addEventListener('click', () => { powerOn(); innen.open(); });
$('btnBig').addEventListener('click', () => { powerOn(); settings.big = !settings.big; applySettings(); });
// Bild älterer Kartridges: Rahmen → füllen → strecken
$('btnBild').addEventListener('click', (e) => {
  e.stopPropagation();
  settings.bild = BILDMODI[(BILDMODI.indexOf(settings.bild) + 1) % BILDMODI.length];
  $('btnBild').dataset.modus = settings.bild;
  frameDirty = true;
  applySettings();
  toast('Bild: ' + BILDNAME[settings.bild]);
});
$('screenOff').addEventListener('click', powerOn);

// ------------------------------------------------------------------ Kartridges darstellen
function cartElement(cart) {
  const el = document.createElement('div');
  el.className = 'cart' + (cart.highlight ? ' cart-hl' : '') + (cart.system >= 64 ? ' cart-64' : cart.system >= 32 ? ' cart-32' : cart.system >= 16 ? ' cart-16' : '');
  el.style.setProperty('--lbl', colorHex(cart.color));
  const icon = iconDataURL(cart.icon);
  el.innerHTML = `<div class="cart-grip"></div><div class="cart-label">${icon ? `<img class="cart-icon" alt="" src="${icon}">` : ''}<div class="cart-title"></div></div><div class="cart-kind"></div>`;
  el.querySelector('.cart-title').textContent = cart.title.replace(/^Lektion (\d+):\s*/, 'L$1 · ');
  el.querySelector('.cart-kind').textContent = (cart.system >= 16 ? (cart.system >= 64 ? 64 : cart.system >= 32 ? 32 : 16) + ' · ' : '') +
    (cart.highlight && cart.license ? '★ LERNSPIEL' : cart.kind === 'tutorial' ? 'LEKTION' : cart.builtin || cart.highlight ? 'SPIEL' : 'EIGENE');
  return el;
}

// Noch eingeschweißte Packung (erste Nutzung)
const sealed = (cart) => !isUnpacked(cart);
const boxArt = new Map();
function boxElement(cart) {
  const el = document.createElement('div');
  el.className = 'pkg' + (cart.system >= 64 ? ' pkg-64' : cart.system >= 32 ? ' pkg-32' : cart.system >= 16 ? ' pkg-16' : '');
  el.title = cart.title + ' – noch eingeschweißt';
  el.innerHTML = '<img alt=""><span class="pkg-new">NEU</span><span class="pkg-title"></span>';
  el.querySelector('.pkg-title').textContent = cart.title.replace(/^Lektion (\d+):\s*/, 'L$1 · ');
  const img = el.querySelector('img');
  img.alt = cart.title;
  const key = cart.id + ':' + cart.code.length;
  if (boxArt.has(key)) img.src = boxArt.get(key);
  else loadCover(cart).then((cover) => { const url = renderBoxFront(cart, cover).toDataURL(); boxArt.set(key, url); img.src = url; });
  return el;
}
const shelfElement = (cart) => (sealed(cart) ? boxElement(cart) : cartElement(cart));

function renderShelf() {
  const list = $('shelfList');
  list.textContent = '';
  // Reihenfolge: Spiele → Lernspiele → Programmieren lernen (alle Lektionen in einer Gruppe). In jeder Gruppe steht
  // oben, was in die gewählte Konsole passt; die Lektionen danach von der kleinsten Konsole aufwärts.
  const passt = (c) => fits(c.system, hw().id);
  const sortiert = (l, lektionen = false) => l.map((c, i) => [c, i]).sort(([a, i], [b, j]) => (passt(b) - passt(a)) ||
    (lektionen ? a.system - b.system || String(a.file).localeCompare(String(b.file)) : 0) || i - j).map(([c]) => c);
  const groups = [
    ['Spiele', sortiert(carts.filter((c) => c.builtin && !(c.highlight && c.license) && c.kind !== 'tutorial')), 'spiele'],
    ['★ Lernspiele', sortiert(carts.filter((c) => c.builtin && c.highlight && c.license)), 'highlight', 'Lernspiele'],
    ['Programmieren lernen', sortiert(carts.filter((c) => c.builtin && c.kind === 'tutorial'), true), 'lektionen', 'Lektionen'],
    ['Eigene Kartridges', carts.filter((c) => !c.builtin)],
  ];
  const imRegal = new Set(carts.filter((c) => c.builtin).map((c) => c.file));
  const storeTile = (titel, text, opts, cls = '') => {
    const b = document.createElement('button');
    b.className = 'store-tile' + (cls ? ' ' + cls : '');
    b.innerHTML = `<b>${titel}</b><span>${text}</span>`;
    b.addEventListener('click', () => openStore(opts));
    return b;
  };
  for (const [name, items, cls, kat] of groups) {
    const g = document.createElement('div');
    g.className = 'shelf-group' + (cls ? ' ' + cls : '');
    g.innerHTML = `<h3>${name}</h3>`;
    const row = document.createElement('div');
    row.className = 'shelf-row';
    // erste Kachel im Regal: Spiele aus dem Store holen
    if (cls === 'spiele') row.appendChild(storeTile('Spiele holen', 'Store: Spiele, Lernspiele und Lektionen', { kat: '' }, 'store-tile-start'));
    for (const c of items) {
      const el = shelfElement(c);
      el.dataset.id = c.id;
      el._act = () => (sealed(c) ? unpack(c) : openDialog(c));   // TV-Modus: mit A auswählen
      // Tastatur: Kartridges sind Knöpfe (Tab, Enter/Leertaste)
      el.tabIndex = 0;
      el.setAttribute('role', 'button');
      el.setAttribute('aria-label', c.title + (sealed(c) ? ' – noch eingeschweißt, auspacken' : ' – Kartridge'));
      el.addEventListener('keydown', (e) => {
        if (e.code !== 'Enter' && e.code !== 'NumpadEnter' && e.code !== 'Space') return;
        e.preventDefault(); e.stopPropagation();
        el._act();
      });
      if (system.cart?.id === c.id) el.classList.add('dragging-src');
      makeDraggable(el, c);
      row.appendChild(el);
    }
    // Weitere Lektionen und Lernspiele liegen im Store
    const mehr = kat ? storeCatalog.filter((e) => e.kat === kat && !imRegal.has(e.file)).length : 0;
    if (mehr) row.appendChild(storeTile('Mehr im Store', kat === 'Lektionen' ? `${mehr} weitere Lektion${mehr > 1 ? 'en' : ''}` : `${mehr} weitere${mehr > 1 ? ' Lernspiele' : 's Lernspiel'}`, { kat }));
    if (!row.children.length) {
      if (cls) continue;
      row.innerHTML = '<div class="shelf-empty">Noch leer – im Studio eine Kartridge bauen oder eine .lua-Datei hierher ziehen.</div>';
    }
    g.appendChild(row);
    list.appendChild(g);
  }
}
// Nach dem Holen aus dem Store: Regal öffnen, zur Kartridge scrollen und sie kurz hervorheben
function zeigeImRegal(cart) {
  toggleShelf(true);
  if (!cart) return;
  setTimeout(() => {
    const el = $('shelfList').querySelector(`[data-id="${CSS.escape(cart.id)}"]`);
    if (!el) return;
    el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    el.classList.remove('regal-neu'); void el.offsetWidth; el.classList.add('regal-neu');
    setTimeout(() => el.classList.remove('regal-neu'), 2600);
  }, 320);
}

function toggleShelf(force) {
  const open = force ?? !app.classList.contains('shelf-open');
  app.classList.toggle('shelf-open', open);
}
$('shelfClose').addEventListener('click', () => toggleShelf(false));
document.addEventListener('pointerdown', (e) => {
  if (app.classList.contains('shelf-open') && !app.classList.contains('dock-shelf') &&
      !e.target.closest('.shelf, #btnShelf, .cart-dialog, .cart-ghost') && !document.body.classList.contains('dragging-cart')) toggleShelf(false);
});

// ------------------------------------------------------------------ Drag & Drop (Maus und Finger)
function overConsole(x, y) {
  const r = consoleEl.getBoundingClientRect();
  return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
}
let touchBlock = null;
// Nach dem Loslassen schickt der Browser noch einen Klick – der landete sonst im gerade geöffneten Fenster
function swallowClick() {
  const stop = (e) => { e.stopPropagation(); e.preventDefault(); };
  document.addEventListener('click', stop, { capture: true, once: true });
  setTimeout(() => document.removeEventListener('click', stop, true), 400);
}
function makeDraggable(el, cart) {
  el.addEventListener('contextmenu', (e) => e.preventDefault());
  // Maus und Finger: kein Tastaturfokus auf der Kartridge (sonst bekäme das Spiel danach Leertaste/Pfeile nicht)
  el.addEventListener('mousedown', (e) => e.preventDefault());
  el.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    const touch = e.pointerType !== 'mouse';
    const start = { x: e.clientX, y: e.clientY };
    let pos = { ...start }, ghost = null, cancelled = false, offset = null, far = false;
    const timer = touch ? setTimeout(() => begin(), 200) : null;

    function begin() {
      if (ghost || cancelled) return;
      const r = el.getBoundingClientRect();
      offset = { x: start.x - r.left, y: start.y - r.top };
      ghost = shelfElement(cart);
      ghost.classList.add('cart-ghost');
      document.body.appendChild(ghost);
      el.classList.add('dragging-src');
      document.body.classList.add('dragging-cart');
      touchBlock = (ev) => ev.preventDefault();
      document.addEventListener('touchmove', touchBlock, { passive: false });
      navigator.vibrate?.(12);
      place();
    }
    function place() {
      ghost.style.left = pos.x - offset.x + 'px';
      ghost.style.top = pos.y - offset.y + 'px';
      const over = overConsole(pos.x, pos.y);
      ghost.classList.toggle('over', over);
      consoleEl.classList.toggle('drop-ready', over);
    }
    function move(ev) {
      pos = { x: ev.clientX, y: ev.clientY };
      const dist = Math.hypot(pos.x - start.x, pos.y - start.y);
      far = far || dist > 10;
      if (!ghost) {
        if (!touch && dist > 5) begin();
        else if (touch && dist > 10) { cancelled = true; clearTimeout(timer); }
        return;
      }
      ev.preventDefault();
      place();
    }
    function up(ev) {
      clearTimeout(timer);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      if (touchBlock) { document.removeEventListener('touchmove', touchBlock); touchBlock = null; }
      document.body.classList.remove('dragging-cart');
      consoleEl.classList.remove('drop-ready');
      if (ev.type === 'pointerup' && !cancelled) swallowClick();
      if (ghost) {
        ghost.remove();
        el.classList.remove('dragging-src');
        if (ev.type === 'pointerup' && overConsole(ev.clientX, ev.clientY)) (sealed(cart) ? unpack(cart) : insertPassend(cart));
        // langsam angetippt (Finger lag nur still): wie ein normales Antippen
        else if (ev.type === 'pointerup' && !far) (sealed(cart) ? unpack(cart) : openDialog(cart));
      } else if (!cancelled && ev.type === 'pointerup') (sealed(cart) ? unpack(cart) : openDialog(cart));
    }
    window.addEventListener('pointermove', move, { passive: false });
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  });
}

// Dateien vom Desktop
window.addEventListener('dragover', (e) => { e.preventDefault(); consoleEl.classList.add('drop-ready'); });
window.addEventListener('dragleave', (e) => { if (!e.relatedTarget) consoleEl.classList.remove('drop-ready'); });
window.addEventListener('drop', async (e) => {
  e.preventDefault();
  consoleEl.classList.remove('drop-ready');
  const file = [...(e.dataTransfer?.files || [])][0];
  if (file) importFile(file, true);
});
$('fileInput').addEventListener('change', (e) => { const f = e.target.files[0]; if (f) importFile(f, false); e.target.value = ''; });

async function importFile(file, insert) {
  // Asset-Paket (.8bpak): Inhalte für Kartridges mit „-- assets: …“ – bleibt im Browser, läuft dann offline
  if (file.name.toLowerCase().endsWith(PAK_ENDUNG)) {
    if (file.size > 1024 * 1024 * 1024) return toast('Das Asset-Paket ist zu groß (max. 1 GB).');
    try {
      const m = await assets.paketImportieren(new Uint8Array(await file.arrayBuffer()));
      return toast(`Asset-Paket „${m.paket}“ (v${m.version}, ${Object.keys(m.assets).length} Inhalte) liegt jetzt im Browser.`);
    } catch (e) { return toast('Asset-Paket nicht lesbar: ' + e.message); }
  }
  if (file.size > 3 * 1024 * 1024) return toast('Die Datei ist zu groß für eine Kartridge.');
  const bytes = new Uint8Array(await file.arrayBuffer());
  let code, cover = null, saves = null;
  if (isPNG(bytes)) {
    code = await extractCart(bytes).catch(() => null);
    if (!code) return toast('In diesem Bild steckt keine 8BOY-Kartridge.');
    cover = await extractCover(bytes);
    saves = await extractSaves(bytes);
  } else if (/\.json$/i.test(file.name) || bytes[0] === 0x7b) {
    // Sicherung (Spielstände, eigene Kartridges, Store-Auswahl) zurückspielen
    let o = null;
    try { o = JSON.parse(new TextDecoder().decode(bytes)); } catch { /* keine Sicherung */ }
    if (!isBackup(o)) return toast('Diese Datei ist keine 8BOY-Sicherung.');
    return askRestore(o);
  } else {
    if (file.size > 512 * 1024) return toast('Die Datei ist zu groß für eine Kartridge (max. 512 KB).');
    code = new TextDecoder().decode(bytes);
  }
  const name = file.name.replace(/\.(8boy\.png|png|8b\.lua|lua|txt|8b)$/i, '');
  // dieselbe Kartridge nicht doppelt ins Regal legen
  const same = carts.find((c) => c.code === code);
  if (same) {
    if (saves && putSaves(same.id, saves.daten, saves.zeit)) { toast(`Spielstand von „${same.title}“ wiederhergestellt.`); return openDialog(same); }
    toast(`„${same.title}“ liegt schon im Regal.`);
    fitConsole(same);
    return sealed(same) ? unpack(same) : insert ? insertCart(same) : openDialog(same);
  }
  const cart = parseCart(code, { id: newCartId(), file: file.name, builtin: false, title: name, cover });
  cart.kind = 'user';
  if (!saveUserCart(cart)) return toast(SPEICHER_VOLL);
  if (saves) putSaves(cart.id, saves.daten, saves.zeit);
  await refreshCarts();
  toast(saves ? `„${cart.title}“ ist wieder da – mit Spielstand.` : `Ein Paket ist angekommen: „${cart.title}“`);
  fitConsole(cart);
  unpack(carts.find((c) => c.id === cart.id) || cart);
}

// Eine Kartridge braucht eine größere Konsole: gleich umschalten, statt erst den „passt nicht“-Bildschirm zu zeigen.
// Gilt für Regal, Store, Pakete und Studio. Den Bildschirm „passt nicht“ zeigt nur noch das direkte Einlegen
// (window.eightboy.insertCart, Lektionen über die Konsolen).
function fitConsole(cart, hinweis = false) {
  if (fits(cart.system, hw().id)) return;
  switchMachine(cart.system, hinweis ? `Konsole auf ${machineFor(cart.system).name} umgestellt – passend zur Kartridge` : '');
}
function insertPassend(cart) {
  fitConsole(cart, true);
  insertCart(cart);
}

// ------------------------------------------------------------------ Einlegen / Auswerfen
function insertCart(cart) {
  powerOn();
  closeDialog();
  if (document.activeElement?.closest?.('.shelf, .store, .cart-dialog')) document.activeElement.blur();
  if (!app.classList.contains('dock-shelf')) toggleShelf(false);
  const slot = $('slotCart');
  slot.hidden = false;
  slot.className = 'slot-cart';
  slot.textContent = '';
  slot.appendChild(cartElement(cart));
  void slot.offsetWidth;
  slot.classList.add('inserting');
  $('slot').classList.add('has-cart');
  audio.sfx('t240 w5 v10 l64 o3 c r16 o2 g', 2);
  setTimeout(() => { system.insert(cart); renderShelf(); }, 380);
}
// Kartridge fliegt aus der Auspack-Szene in den Schacht
function flyToSlot(cart, from) {
  fitConsole(cart, true);
  const to = $('slot').getBoundingClientRect();
  if (!from || matchMedia('(prefers-reduced-motion: reduce)').matches) return insertCart(cart);
  const ghost = cartElement(cart);
  ghost.classList.add('cart-ghost', 'flying');
  Object.assign(ghost.style, { left: from.left + 'px', top: from.top + 'px', transform: `scale(${from.width / 116})`, transformOrigin: '0 0', transition: 'left .5s cubic-bezier(.5,0,.3,1), top .5s cubic-bezier(.5,0,.3,1), transform .5s' });
  document.body.appendChild(ghost);
  requestAnimationFrame(() => requestAnimationFrame(() => {
    Object.assign(ghost.style, { left: to.left + to.width / 2 - 58 * (to.width / 116 * 0.9) + 'px', top: to.top - 30 + 'px', transform: `scale(${to.width / 116 * 0.9})` });
  }));
  setTimeout(() => { ghost.remove(); insertCart(cart); }, 520);
}
function unpack(cart) {
  powerOn();
  closeDialog();
  if (!app.classList.contains('dock-shelf')) toggleShelf(false);
  unboxer.open(cart);
}

function ejectVisual() {
  const slot = $('slotCart');
  slot.classList.remove('inserting');
  slot.classList.add('ejecting');
  $('slot').classList.remove('has-cart');
  setTimeout(() => { slot.hidden = true; slot.className = 'slot-cart'; renderShelf(); }, 340);
}
$('slot').addEventListener('click', () => { if (system.cart) { system.eject(); } else toggleShelf(true); });

// ------------------------------------------------------------------ Kartridge-Dialog
let dialogCart = null;
function openDialog(cart) {
  dialogCart = cart;
  $('cdCart').textContent = '';
  $('cdCart').appendChild(cartElement(cart));
  $('cdTitle').textContent = cart.title;
  $('cdMeta').textContent = [cart.kind === 'tutorial' ? 'Lektion' : cart.builtin ? 'Spiel' : 'Eigene Kartridge', cart.author && 'von ' + cart.author,
    cart.code.split('\n').length + ' Zeilen Lua', hasSaves(cart.id) && '💾 Spielstand gespeichert'].filter(Boolean).join(' · ');
  $('cdDesc').textContent = cart.desc || '';
  $('cdLicense').hidden = !cart.license;
  $('cdLicense').innerHTML = cart.license ? 'Lizenz: ' + cart.license.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace('CC BY-SA 4.0', '<a href="https://creativecommons.org/licenses/by-sa/4.0/deed.de" target="_blank" rel="noopener">CC BY-SA 4.0</a>') + ' – <a href="LIZENZEN.txt" target="_blank" rel="noopener">Lizenzen</a>' : '';
  // Store-Spiele kann man weglegen und wieder holen; eigene Kartridges und Geschenke gibt es nur hier
  $('cdDelete').hidden = cart.builtin && (!cart.store || ALLE);
  $('cdDelete').textContent = cart.store ? 'Aus dem Regal nehmen' : 'Löschen …';
  showConfirm(false);
  $('cartDialog').hidden = false;
}
function showConfirm(on) {
  $('cdConfirm').hidden = !on;
  $('cdActions').hidden = on;
  if (on) {
    $('cdConfirmText').innerHTML = '<b>Diese Kartridge gibt es nicht im Store.</b> Gelöscht ist sie endgültig weg – auch der Spielstand. ' +
      'Willst du sie behalten, sichere sie vorher als Packung (PNG-Kartridge' + (hasSaves(dialogCart.id) ? ' mit Spielstand' : '') + '), die kannst du später wieder ins Regal ziehen.';
    $('cdConfirmNo').focus();
  }
}
async function removeFromShelf(cart) {
  setStoreChoice((storeChoice() || []).filter((f) => f !== cart.file));
  toast(`„${cart.title}“ liegt wieder im Store – du kannst es jederzeit wieder holen. Spielstände bleiben erhalten.`);
  await refreshCarts();
}
function closeDialog() { $('cartDialog').hidden = true; dialogCart = null; }
$('cdClose').addEventListener('click', closeDialog);
$('cartDialog').addEventListener('click', (e) => { if (e.target === $('cartDialog')) closeDialog(); });
$('cdInsert').addEventListener('click', () => insertPassend(dialogCart));
$('cdCode').addEventListener('click', () => { const c = dialogCart; closeDialog(); openEditor(c); });
$('cdDownload').addEventListener('click', () => download(dialogCart));
$('cdManual').addEventListener('click', () => { const c = dialogCart; closeDialog(); unboxer.openManual(c); });
$('cdPackage').addEventListener('click', () => downloadPackage(dialogCart));
$('cdDelete').addEventListener('click', async () => {
  if (dialogCart.store) { const c = dialogCart; closeDialog(); await removeFromShelf(c); return; }
  showConfirm(true);
});
$('cdConfirmNo').addEventListener('click', () => showConfirm(false));
$('cdConfirmSave').addEventListener('click', () => downloadPackage(dialogCart, true));
$('cdConfirmYes').addEventListener('click', async () => {
  const c = dialogCart;
  deleteUserCart(c.id);
  deleteSaves(c.id);
  closeDialog();
  toast(`„${c.title}“ gelöscht`);
  await refreshCarts();
});

function download(cart) {
  const blob = new Blob([cart.code], { type: 'text/x-lua' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = fileNameFor(cart);
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

// Packung als PNG-Kartridge; mitSpielstand nur zum Sichern (beim Verschicken bleibt der Spielstand privat)
async function downloadPackage(cart, mitSpielstand = false) {
  const saves = mitSpielstand && hasSaves(cart.id) ? { zeit: saveInfo(cart.id).zeit, daten: cartSaves(cart.id) } : null;
  const blob = await buildPNGCart(cart, await loadCover(cart), saves);
  saveBlob(blob, fileNameFor(cart).replace(/.8b.lua$/, saves ? '.mit-spielstand.8boy.png' : '.8boy.png'));
}
function saveBlob(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

const unboxer = createUnboxer({
  audio, cartElement, loadCover,
  onOpened: (cart) => { if (!isUnpacked(cart)) { markUnpacked(cart); renderShelf(); } },
  onInsert: (cart, rect) => flyToSlot(cart, rect),
});

// ------------------------------------------------------------------ Editor
const editor = createEditor({
  onRun: runFromEditor,
  onSave: saveFromEditor,
  onNew: (code) => {
    if (dirty && !confirm('Neue Kartridge beginnen? Nicht gespeicherte Änderungen gehen verloren.')) return;
    openEditor({ id: newCartId(), builtin: false, code, title: parseCart(code).title, isNew: true });
  },
  cartPreview: cartElement,
  onLive: liveFromEditor,
  onDebug: debugCommand,
  onBreakpoints: (lines) => { if (studioRunning()) system.debug()?.setBreakpoints(lines); },
  onWatches: (list) => { if (studioRunning()) system.debug()?.setWatches(list); },
});

// Entwurf merken, damit beim Schließen des Studios nichts verloren geht
const DRAFT_KEY = '8boy:studio-draft';
let dirty = false, draftTimer = null;
$('edText').addEventListener('input', () => {
  dirty = true;
  clearTimeout(draftTimer);
  draftTimer = setTimeout(() => { try { localStorage.setItem(DRAFT_KEY, JSON.stringify({ cart: { ...editingCart, code: editor.code } })); } catch { /* voll */ } }, 600);
});

function openStudio() {
  if (editingCart) return openEditor(editingCart, true);
  try {
    const d = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null');
    if (d?.cart?.code) return openEditor(d.cart);
  } catch { /* kaputter Entwurf */ }
  openEditor(null);
}

// keep = Studio nur wieder einblenden, der Editor hat den Code noch
function openEditor(cart, keep = false) {
  if (!keep) {
    if (dirty && cart !== editingCart && !$('editor').hidden && !confirm('Ungespeicherte Änderungen verwerfen?')) return;
    editingCart = cart || { id: newCartId(), builtin: false, code: TEMPLATE, title: 'Meine Kartridge', isNew: true };
    editor.open(editingCart.code, editingCart.title + (editingCart.builtin ? '  (Kopie beim Speichern)' : ''));
    dirty = false;
  }
  $('editor').hidden = false;
  app.classList.toggle('dock-editor', window.innerWidth >= 1000);
  toggleShelf(false);
  layout();
}
function closeEditor() {
  $('editor').hidden = true;
  app.classList.remove('dock-editor');
  layout();
}
// ------------------------------------------------------------------ Fehlersuche und Live-Neuladen
let studioRunId = null;
const isStudioCart = (cart) => !!cart && (cart.id === studioRunId || cart.id === editingCart?.id);
const studioRunning = () => (system.state === 'running' || system.state === 'paused') && isStudioCart(system.cart);
function onDebugEvent({ type, data }) {
  if (type === 'halt') {
    consoleEl.classList.add('dbg-halt');
    editor.showHalt(data);
    // am Handy liegt das Studio über der Konsole: am Haltepunkt den Code zeigen
    if ($('editor').hidden) openEditor(editingCart, true);
  } else if (type === 'resume') {
    consoleEl.classList.remove('dbg-halt');
    editor.clearHalt();
  } else if (type === 'watch') editor.showWatches(data);
}
function liveFromEditor(code, { auto = false } = {}) {
  if (!studioRunning()) { if (!auto) runFromEditor(code); return; }
  const r = system.liveReload(code);
  if (!r) return;
  editingCart = { ...editingCart, code };
  editor.liveResult(r, auto);
  if (r.ok) system.debug()?.setBreakpoints(editor.breakpoints);
}
function debugCommand(cmd) {
  const d = studioRunning() ? system.debug() : null;
  if (!d) { if (cmd !== 'pause') editor.print('Starte zuerst das Spiel mit ▶ Starten.'); return; }
  if (cmd === 'resume') d.resume();
  else if (cmd === 'frame') d.nextFrame();
  else if (cmd === 'step') d.step();
  else if (cmd === 'pause') d.pause();
  // am Handy: zum Weiterspielen das Studio schließen und die Konsole zeigen
  if (cmd === 'resume' && !app.classList.contains('dock-editor')) closeEditor();
}

function runFromEditor(code) {
  const base = editingCart.builtin ? { id: 'tmp:' + editingCart.id, builtin: false } : { id: editingCart.id, builtin: false };
  const cart = parseCart(code, { ...base, kind: 'user' });
  editingCart = { ...editingCart, code, runId: cart.id };
  editingCart.id = cart.id;
  studioRunId = cart.id;
  editor.print(`▶ „${cart.title}“ gestartet`, 'ok');
  if (!app.classList.contains('dock-editor')) closeEditor();
  // im Studio gebaut für eine größere Konsole (z. B. 8BOY-32-Vorlage): gleich umschalten statt „passt nicht“
  fitConsole(cart);
  insertCart(cart);
}
async function saveFromEditor(code) {
  if (editingCart.builtin || String(editingCart.id).startsWith('tmp:') || editingCart.id.startsWith('b:')) editingCart = { id: newCartId(), builtin: false };
  const cart = parseCart(code, { id: editingCart.id, builtin: false });
  cart.kind = 'user';
  if (!saveUserCart(cart)) { editor.print('✗ ' + SPEICHER_VOLL, 'err'); toast(SPEICHER_VOLL); return; }
  markUnpacked(cart);
  editingCart = cart;
  dirty = false;
  editor.setTitle(cart.title);
  editor.print(`✓ „${cart.title}“ im Regal gespeichert`, 'ok');
  // läuft das Spiel aus dem Studio, gleich live nachladen
  if (studioRunning()) liveFromEditor(code);
  await refreshCarts();
}
$('edRun').addEventListener('click', () => runFromEditor(editor.code));
$('edSave').addEventListener('click', () => saveFromEditor(editor.code));
$('edDownload').addEventListener('click', () => download(parseCart(editor.code, {})));
$('edClose').addEventListener('click', closeEditor);
$('btnNew').addEventListener('click', () => { openStudio(); setTimeout(() => { $('edNewMenu').hidden = false; }, 0); });
$('btnStudio').addEventListener('click', () => { if ($('editor').hidden) openStudio(); else closeEditor(); });

// ------------------------------------------------------------------ Gehäusefarbe, Installieren, Toast
document.querySelectorAll('.swatch').forEach((s) => s.addEventListener('click', () => { settings.theme = s.dataset.theme; applySettings(); }));
document.querySelectorAll('[data-model]').forEach((b) => b.addEventListener('click', () => { powerOn(); switchMachine(+b.dataset.model); }));
if (GIGA_SICHTBAR) document.querySelector('[data-model="128"]')?.removeAttribute('hidden');

let installEvent = null;
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installEvent = e; $('btnInstall').hidden = false; });
$('btnInstall').addEventListener('click', async () => { if (!installEvent) return; installEvent.prompt(); await installEvent.userChoice; installEvent = null; $('btnInstall').hidden = true; });

let toastTimer = null;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 2600);
}

// ------------------------------------------------------------------ Start
let storeCatalog = [];
async function storeFiles() {
  if (!storeCatalog.length) storeCatalog = await loadStoreCatalog();
  if (ALLE) return storeCatalog.map((e) => e.file);
  let choice = storeChoice();
  // Wer schon gespielt hat, behält, was er ausgepackt oder gespeichert hat – auch die Lektionen und Lernspiele,
  // die bis Oktober 2026 fest im Regal lagen (einmalig). Neue Besucher bekommen das Starter-Regal dazu.
  const keys = Object.keys(localStorage);
  const benutzt = (f) => isUnpacked({ id: 'b:' + f }) || keys.some((k) => k.startsWith('8boy:save:b:' + f + ':'));
  const start = STARTER.filter((f) => storeCatalog.some((e) => e.file === f));
  if (!choice) choice = [...new Set([...start, ...(LOKAL ? [] : storeCatalog.map((e) => e.file).filter(benutzt))])];
  else if (!LOKAL && !localStorage.getItem('8boy:store-v2')) choice = [...new Set([...choice, ...storeCatalog.filter((e) => e.frueher).map((e) => e.file).filter(benutzt)])];
  setStoreChoice(choice);
  try { localStorage.setItem('8boy:store-v2', '1'); } catch { /* privat */ }
  return choice;
}
async function refreshCarts() {
  let builtin = [];
  // 8BOY 128 (noch nicht öffentlich): Lektionen und Spiele aus carts/giga.json – nur lokal oder mit ?giga, nicht im Build
  let giga = [];
  if (GIGA_SICHTBAR) try { const r = await fetch('carts/giga.json'); if (r.ok) giga = await r.json(); } catch { /* fehlt im öffentlichen Stand */ }
  try { builtin = await loadBuiltinCarts('carts/', [...await storeFiles(), ...giga]); } catch (e) { console.warn('Eingebaute Kartridges nicht geladen', e); }
  carts = [...builtin, ...loadUserCarts()];
  renderShelf();
}

// ------------------------------------------------------------------ Store
// Kategorien in fester Reihenfolge (Katalog aus tools/store.mjs), dazu Suche und Filter nach Konsole/Mehrspieler
const KATS = ['Party & Quiz', 'Action', 'Rennen', 'Abenteuer & Rollenspiel', 'Strategie & Aufbau', 'Klassiker & Brettspiele', 'Kreativ & Musik', 'Lernspiele', 'Lektionen'];
const SYSTEME = [[0, 'Alle Konsolen'], [64, '8BOY 64'], [32, '8BOY 32'], [16, '8BOY 16'], [8, '8BOY']];
const st = { kat: '', sys: 0, multi: false, neu: false, q: '' };
const sysName = (s) => (s >= 64 ? ['8BOY 64', 'ultra'] : s >= 32 ? ['8BOY 32', 'mega'] : s >= 16 ? ['8BOY 16', 'super'] : ['8BOY', '']);
const fold = (s) => s.toLowerCase().replace(/[äöüß]/g, (c) => ({ ä: 'ae', ö: 'oe', ü: 'ue', ß: 'ss' }[c])).replace(/-/g, ' ');
async function openStore(opts = {}) {
  if (!storeCatalog.length) storeCatalog = await loadStoreCatalog();
  if (opts.kat !== undefined || opts.sys !== undefined) Object.assign(st, { kat: '', sys: 0, multi: false, neu: false, q: '' }, opts);
  $('stSearch').value = st.q;
  storeDetailZu();
  $('store').hidden = false;
  storeTab(opts.tab || 'store');
}
function closeStore() { storeDetailZu(); $('store').hidden = true; }
// Zurück/Esc/B im Store: erst die Detailansicht, dann den Store schließen
function storeZurueck() { if (!$('stDetail').hidden) storeDetailZu(true); else closeStore(); }
// Liegt die Kartridge schon im Regal (Grundregal, Starter oder geholt)?
const imRegalDatei = (file) => carts.some((c) => c.builtin && c.file === file);
async function storeHolen(e) {
  if (!imRegalDatei(e.file)) {
    setStoreChoice([...new Set([...(storeChoice() || []), e.file])]);
    await refreshCarts();
  }
  return carts.find((c) => c.builtin && c.file === e.file) || null;
}
// „▶ Spielen“: holen, Store zu, auspacken bzw. einlegen (die passende Konsole wird gewählt)
async function storeSpielen(e) {
  const c = await storeHolen(e);
  closeStore();
  if (!c) return toast('Diese Kartridge lässt sich gerade nicht laden.');
  sealed(c) ? unpack(c) : insertPassend(c);
}
// „Ins Regal“: holen, Store zu, im Regal zur Kartridge springen
async function storeInsRegal(e) {
  const neu = !imRegalDatei(e.file);
  const c = await storeHolen(e);
  closeStore();
  if (neu && c) toast(`Ein Paket ist angekommen: „${e.title}“`);
  zeigeImRegal(c);
}
// Reiter: Store oder „Meine Spielstände“
let stTab = 'store';
function storeTab(t) {
  stTab = t;
  $('stTabStore').setAttribute('aria-selected', t === 'store');
  $('stTabSaves').setAttribute('aria-selected', t === 'saves');
  for (const id of ['stGrid', 'stChips', 'stFilter']) $(id).hidden = t !== 'store';
  $('stSearch').parentElement.hidden = t !== 'store';
  $('stSaves').hidden = t !== 'saves';
  if (t === 'store') renderStore(); else renderSaves();
}
$('stTabStore').addEventListener('click', () => storeTab('store'));
$('stTabSaves').addEventListener('click', () => storeTab('saves'));
$('btnSaves').addEventListener('click', () => openStore({ tab: 'saves' }));

// ------------------------------------------------------------------ Spielstände verwalten (alles im Browser, offline)
const kb = (n) => (n < 1024 ? n + ' B' : (n / 1024).toFixed(n < 10240 ? 1 : 0).replace('.', ',') + ' KB');
function wann(t) {
  if (!t) return 'älter';
  const d = (Date.now() - t) / 864e5;
  if (d < 1 / 24) return 'gerade eben';
  if (d < 1) return 'heute';
  if (d < 2) return 'gestern';
  if (d < 14) return `vor ${Math.floor(d)} Tagen`;
  return 'am ' + new Date(t).toLocaleDateString('de-DE');
}
// Wem gehört ein Spielstand? Regal, Store-Katalog oder eine gelöschte eigene Kartridge
function saveOwner(id) {
  const c = carts.find((x) => x.id === id);
  if (c) return { title: c.title, system: c.system, cart: c, imRegal: true, store: c.store ? storeCatalog.find((e) => 'b:' + e.file === id) : null };
  const e = id.startsWith('b:') && storeCatalog.find((x) => 'b:' + x.file === id);
  if (e) return { title: e.title, system: e.system, store: e, imRegal: false };
  return { title: id.startsWith('u:') ? 'Gelöschte eigene Kartridge' : id.replace(/^b:/, '').replace(/\.lua$/, ''), system: 8, verwaist: true };
}
function backupName(teil) {
  const d = new Date();
  return `8boy-${teil}-${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}.json`;
}
function downloadBackup(only = null) {
  const b = makeBackup();
  if (only) {
    b.spielstaende = Object.fromEntries(Object.entries(b.spielstaende).filter(([id]) => only.includes(id)));
    b.kartridges = b.kartridges.filter((c) => only.includes(c.id));
    b.store = null; b.ausgepackt = only;
  }
  const name = only ? saveOwner(only[0]).title.toLowerCase().replace(/[äöüß]/g, (c) => ({ ä: 'ae', ö: 'oe', ü: 'ue', ß: 'ss' }[c])).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'spielstand' : 'sicherung';
  saveBlob(new Blob([JSON.stringify(b, null, 1)], { type: 'application/json' }), backupName(only ? 'spielstand-' + name : name));
}
let restoreOffer = null;   // geladene Sicherung, die auf Bestätigung wartet
function askRestore(o) {
  restoreOffer = o;
  openStore({ tab: 'saves' });
}
function renderSaves() {
  const box = $('stSaves');
  box.textContent = '';
  const ids = saveIds().map((id) => ({ id, ...saveInfo(id), ...saveOwner(id) })).sort((a, b) => (b.zeit || 0) - (a.zeit || 0));
  let used = 0;
  try { for (const k of Object.keys(localStorage)) used += k.length + (localStorage.getItem(k) || '').length; } catch { /* privat */ }
  const head = document.createElement('div');
  head.className = 'sv-head';
  head.innerHTML = `<p>Spielstände liegen nur in diesem Browser – ohne Konto, ohne Server, auch offline. Wer den Browser-Speicher löscht oder das Gerät wechselt, nimmt sie mit einer <b>Sicherungsdatei</b> mit.</p>
    <div class="sv-bar" title="Browser-Speicher dieser Seite (meist etwa 5 MB)"><i style="width:${Math.min(100, used / 50000).toFixed(1)}%"></i></div>
    <span class="sv-used">${ids.length} ${ids.length === 1 ? 'Spielstand' : 'Spielstände'} · belegt ${kb(used)} von etwa 5 MB</span>
    <div class="cd-actions"><button class="tb tb-run" id="svAll">⇩ Alles sichern</button><label class="tb">⇧ Sicherung laden<input type="file" id="svLoad" accept=".json,.png" hidden></label></div>`;
  box.appendChild(head);
  head.querySelector('#svAll').addEventListener('click', () => { downloadBackup(); toast('Sicherung gespeichert: Spielstände, eigene Kartridges und dein Regal.'); });
  head.querySelector('#svLoad').addEventListener('change', (e) => { const f = e.target.files[0]; if (f) importFile(f, false); e.target.value = ''; });

  if (restoreOffer) {
    const o = restoreOffer;
    const n = Object.keys(o.spielstaende || {}).length, k = (o.kartridges || []).length;
    const ueber = Object.keys(o.spielstaende || {}).filter((id) => hasSaves(id)).length;
    const p = document.createElement('div');
    p.className = 'cd-confirm sv-restore';
    p.innerHTML = `<p><b>Sicherung vom ${new Date(o.datum).toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' })}</b>: ${n} ${n === 1 ? 'Spielstand' : 'Spielstände'}${k ? `, ${k} eigene Kartridge${k === 1 ? '' : 's'}` : ''}${o.store ? ', Store-Auswahl' : ''}.
      ${ueber ? `<br>${ueber} ${ueber === 1 ? 'Spielstand hier wird' : 'Spielstände hier werden'} durch den Stand aus der Sicherung ersetzt.` : ''} Sonst wird nichts gelöscht.</p>
      <div class="cd-actions"><button class="tb tb-run" id="svYes">Zurückspielen</button><button class="tb" id="svNo">Abbrechen</button></div>`;
    box.appendChild(p);
    p.querySelector('#svYes').addEventListener('click', async () => {
      const r = restoreBackup(o);
      restoreOffer = null;
      await refreshCarts();
      toast(r.voll ? 'Der Browser-Speicher ist voll – nicht alles passte hinein.' : `Zurückgespielt: ${r.spielstaende} Spielstände${r.kartridges ? `, ${r.kartridges} Kartridges` : ''}${r.store ? `, ${r.store} Spiele aus dem Store` : ''}.`);
      renderSaves();
    });
    p.querySelector('#svNo').addEventListener('click', () => { restoreOffer = null; renderSaves(); });
    p.querySelector('#svYes').focus();
  }

  if (!ids.length) {
    const e = document.createElement('p');
    e.className = 'st-none';
    e.textContent = 'Noch keine Spielstände. Spiele, die speichern, legen sie hier automatisch an.';
    box.appendChild(e);
    return;
  }
  const list = document.createElement('div');
  list.className = 'sv-list';
  for (const s of ids) {
    const row = document.createElement('div');
    row.className = 'sv-row' + (s.verwaist ? ' verwaist' : '');
    const sys = sysName(s.system);
    const cover = s.store ? coverUrl(s.store.file) : '';
    row.innerHTML = `<div class="sv-pic">${cover ? `<img src="${cover}" alt="" loading="lazy">` : '💾'}</div>
      <div class="sv-info"><b></b><span class="st-sys ${sys[1]}">${s.verwaist ? 'nicht mehr im Regal' : sys[0] + (s.imRegal ? ' · im Regal' : ' · im Store')}</span>
      <span class="sv-meta">${wann(s.zeit)} · ${kb(s.bytes)}</span></div>
      <div class="sv-btns"></div>`;
    row.querySelector('b').textContent = s.title;
    const btns = row.querySelector('.sv-btns');
    const btn = (t, cls, fn, title = '') => { const b = document.createElement('button'); b.className = 'tb ' + cls; b.textContent = t; if (title) b.title = title; b.addEventListener('click', fn); btns.appendChild(b); return b; };
    if (s.cart) btn('▶ Spielen', 'tb-run', () => { closeStore(); sealed(s.cart) ? unpack(s.cart) : insertPassend(s.cart); });
    else if (s.store) btn('Ins Regal holen', 'tb-run', async () => { setStoreChoice([...(storeChoice() || []), s.store.file]); await refreshCarts(); toast(`„${s.title}“ ist wieder im Regal – mit Spielstand.`); renderSaves(); });
    btn('⇩ Sichern', '', () => downloadBackup([s.id]), 'Diesen Spielstand als Datei sichern');
    const del = btn('Löschen', 'tb-danger', () => {
      if (del.dataset.sicher) { deleteSaves(s.id); toast(`Spielstand von „${s.title}“ gelöscht.`); renderSaves(); return; }
      del.dataset.sicher = '1';
      del.textContent = 'Wirklich löschen?';
      setTimeout(() => { if (del.isConnected) { delete del.dataset.sicher; del.textContent = 'Löschen'; } }, 4000);
    }, 'Spielstand löschen – zweimal drücken');
    list.appendChild(row);
  }
  box.appendChild(list);
}
function storeChip(row, text, on, click, title = '') {
  const b = document.createElement('button');
  b.textContent = text;
  b.className = on ? 'on' : '';
  b.setAttribute('aria-pressed', on);
  if (title) b.title = title;
  b.addEventListener('click', click);
  row.appendChild(b);
}
function renderStore() {
  const drin = new Set(storeChoice() || []);
  const kats = KATS.filter((k) => storeCatalog.some((e) => e.kat === k));
  const chips = $('stChips');
  chips.textContent = '';
  storeChip(chips, 'Alle', !st.kat, () => { st.kat = ''; renderStore(); });
  for (const k of kats) storeChip(chips, k, st.kat === k, () => { st.kat = st.kat === k ? '' : k; renderStore(); });
  const sub = $('stFilter');
  sub.textContent = '';
  for (const [s, name] of SYSTEME) storeChip(sub, name, st.sys === s, () => { st.sys = s; renderStore(); });
  storeChip(sub, '👥 Mehrspieler', st.multi, () => { st.multi = !st.multi; renderStore(); }, 'Mehrere Spieler an einem Gerät oder online');
  storeChip(sub, 'Noch nicht im Regal', st.neu, () => { st.neu = !st.neu; renderStore(); });

  const words = fold(st.q.trim()).split(/\s+/).filter(Boolean);
  const hits = storeCatalog.filter((e) => (!st.kat || e.kat === st.kat) && (!st.sys || e.system === st.sys) &&
    (!st.multi || e.players > 1 || e.online) && (!st.neu || !drin.has(e.file)) &&
    words.every((w) => fold(`${e.title} ${e.desc} ${e.kat} ${sysName(e.system)[0]} ${e.players > 1 || e.online ? 'mehrspieler' : ''} ${e.online ? 'online' : ''}`).includes(w)));
  $('stCount').textContent = hits.length === storeCatalog.length ? `${hits.length} Titel` : `${hits.length} von ${storeCatalog.length}`;

  const grid = $('stGrid');
  grid.textContent = '';
  if (!hits.length) {
    grid.innerHTML = '<p class="st-none">Nichts gefunden. Andere Suche oder weniger Filter probieren.</p>';
    return;
  }
  // Ohne Kategorie und Suche: nach Kategorien gegliedert
  const gruppen = st.kat || words.length ? [['', hits]] : kats.map((k) => [k, hits.filter((e) => e.kat === k)]).filter(([, l]) => l.length);
  for (const [k, list] of gruppen) {
    if (k) {
      const h = document.createElement('h4');
      h.className = 'st-kat';
      h.textContent = `${k} · ${list.length}`;
      grid.appendChild(h);
    }
    for (const e of list) grid.appendChild(storeItem(e, drin));
  }
}
function storeItem(e, drin) {
  const el = document.createElement('div');
  const im = imRegalDatei(e.file);
  el.className = 'st-item' + (im ? ' drin' : '');
  el.innerHTML = `<img src="${coverUrl(e.file).replace(/"/g, '%22')}" alt="" loading="lazy">
    <div class="st-body"><span class="st-sys ${sysName(e.system)[1]}">${storeZeile(e, im)}</span>
    <button class="st-name" title="Mehr über dieses Spiel"></button><span class="st-desc"></span>
    <div class="st-btns"><button class="tb tb-run st-play">▶ Spielen</button><button class="tb st-regal">${im ? '✓ Im Regal' : 'Ins Regal'}</button>${drin.has(e.file) && !ALLE ? '<button class="tb st-weg" title="Aus dem Regal nehmen – du kannst es jederzeit wieder holen">Entfernen</button>' : ''}</div></div>`;
  el.querySelector('.st-name').textContent = e.title;
  el.querySelector('.st-name').setAttribute('aria-label', e.title + ': Details');
  el.querySelector('.st-desc').textContent = e.desc;
  // Karte oder Bild antippen: Detailansicht
  el.addEventListener('click', (ev) => { if (!ev.target.closest('.st-btns')) storeDetail(e); });
  el.querySelector('.st-play').addEventListener('click', () => storeSpielen(e));
  el.querySelector('.st-regal').addEventListener('click', () => storeInsRegal(e));
  el.querySelector('.st-weg')?.addEventListener('click', async () => { await removeFromShelf(e); renderStore(); });
  return el;
}
const storeZeile = (e, im) => `${sysName(e.system)[0]}${e.kat === 'Lernspiele' ? ' · Lernspiel' : e.kat === 'Lektionen' ? ' · Lektion' : ''}${e.players > 1 ? ' · bis ' + e.players + ' Spieler' : ''}${e.online ? ' · online' : ''}${!im && hasSaves('b:' + e.file) ? ' · 💾 Spielstand' : ''}`;

// Detailansicht im Store: Bild, volle Beschreibung, Konsole, Spielerzahl, Steuerung (aus dem Heft der Kartridge)
let stDetailVon = null, stDetailNr = 0;
function storeDetail(e) {
  const d = $('stDetail'), im = imRegalDatei(e.file), sys = sysName(e.system), nr = ++stDetailNr;
  if (d.hidden) stDetailVon = document.activeElement;
  d.innerHTML = `<button class="tb st-back">← Zurück</button>
    <div class="std-main"><img src="${coverUrl(e.file).replace(/"/g, '%22')}" alt="">
    <div class="std-info"><span class="st-sys ${sys[1]}">${e.kat}</span><h4 id="stdTitle" tabindex="-1"></h4><p class="std-desc"></p>
    <div class="st-btns"><button class="tb tb-run st-play">▶ Spielen</button><button class="tb st-regal${im ? ' drin' : ''}">${im ? '✓ Im Regal' : 'Ins Regal'}</button></div>
    <dl class="std-facts"><dt>Konsole</dt><dd>${sys[0]}</dd><dt>Spieler</dt><dd>${e.players > 1 ? '1 bis ' + e.players : '1'}${e.online ? ' · auch online' : ''}</dd>${e.kb ? `<dt>Größe</dt><dd>${e.kb} KB</dd>` : ''}${e.author ? '<dt>Von</dt><dd class="std-autor"></dd>' : ''}</dl>
    <div class="std-ctrl" hidden><h5>Steuerung</h5><ul></ul></div></div></div>`;
  d.querySelector('h4').textContent = e.title;
  d.querySelector('.std-desc').textContent = e.desc;
  if (e.author) d.querySelector('.std-autor').textContent = e.author;
  d.querySelector('.st-back').addEventListener('click', () => storeDetailZu(true));
  d.querySelector('.st-play').addEventListener('click', () => storeSpielen(e));
  d.querySelector('.st-regal').addEventListener('click', () => storeInsRegal(e));
  d.hidden = false;
  $('store').classList.add('detail');
  d.scrollTop = 0;
  $('store').querySelector('.st-card').scrollTop = 0;
  d.querySelector('h4').focus({ preventScroll: true });
  // Steuerung aus dem Abschnitt „# Steuerung“ (oder „Tasten“) des Anleitungshefts
  const code = carts.find((c) => c.builtin && c.file === e.file)?.code;
  (code ? Promise.resolve(code) : fetch(cartUrl(e.file)).then((r) => (r.ok ? r.text() : ''))).then((txt) => {
    if (nr !== stDetailNr || d.hidden) return;
    const teil = (parseManual(txt) || []).find((x) => /steuerung|tasten|bedienung/i.test(x.title));
    const zeilen = (teil?.lines || []).map((l) => l.replace(/^\s*-\s+/, '').trim()).filter(Boolean).slice(0, 8);
    if (!zeilen.length) return;
    const ul = d.querySelector('.std-ctrl ul');
    for (const z of zeilen) { const li = document.createElement('li'); li.textContent = z; ul.appendChild(li); }
    d.querySelector('.std-ctrl').hidden = false;
  }).catch(() => {});
}
function storeDetailZu(fokus = false) {
  const d = $('stDetail');
  if (!d || d.hidden) return;
  stDetailNr++;
  d.hidden = true;
  d.textContent = '';
  $('store').classList.remove('detail');
  if (fokus && stDetailVon?.isConnected) stDetailVon.focus({ preventScroll: true });
  stDetailVon = null;
}
$('stSearch').addEventListener('input', (e) => { st.q = e.target.value; renderStore(); });
$('btnStore').addEventListener('click', () => openStore());
$('stClose').addEventListener('click', closeStore);
$('store').addEventListener('click', (e) => { if (e.target === $('store')) closeStore(); });

// index.html#cart=<id> (z. B. „Spielen“ im Baukasten): diese Kartridge gleich einlegen
async function openFromHash() {
  // index.html#paket=g/<schlüssel>/<name>.8boy.png: Geschenk-Kartridge aus dem geschützten Bereich laden und auspacken.
  // Nur dieser Pfad auf der eigenen Seite – keine fremden Adressen.
  const g = /^#paket=(g\/[0-9a-f]{32}\/[a-z0-9-]+\.8boy\.png)$/.exec(location.hash);
  if (g) {
    history.replaceState(null, '', location.pathname + location.search);
    try {
      const res = await fetch(g[1], { cache: 'no-store' });
      if (res.status === 410) { toast('Dieser Link wurde schon zu oft benutzt und ist abgelaufen.'); return; }
      if (!res.ok) throw new Error(res.status);
      powerOn();
      await importFile(new File([await res.arrayBuffer()], g[1].split('/').pop()), true);
    } catch { toast('Dieser Link ist nicht (mehr) gültig.'); }
    return;
  }
  const m = /^#cart=(.+)$/.exec(location.hash);
  if (!m) return;
  history.replaceState(null, '', location.pathname + location.search);
  // auch kurz: #cart=05-springen – Store-Kartridges kommen dabei von selbst ins Regal
  const id = decodeURIComponent(m[1]), file = id.replace(/^b:/, '').replace(/(\.lua)?$/, '.lua');
  const finde = () => carts.find((x) => x.id === id || x.id === 'b:' + file);
  if (!finde() && storeCatalog.some((e) => e.file === file)) {
    setStoreChoice([...new Set([...(storeChoice() || []), file])]);
    await refreshCarts();
  }
  const c = finde();
  if (!c) return toast('Diese Kartridge liegt nicht im Regal.');
  fitConsole(c);
  insertCart(c);
}
window.addEventListener('hashchange', () => refreshCarts().then(openFromHash));

// Impressum und Datenschutz des Betreibers (config.js); ohne Angabe bleiben die Links verborgen
for (const [id, key] of [['lnkImpressum', 'impressumUrl'], ['lnkDatenschutz', 'datenschutzUrl']]) {
  const url = globalThis.EIGHTBOY_CONFIG?.[key];
  if (url && $(id)) { $(id).href = url; $(id).hidden = false; }
}

applySettings();
layout();
refreshCarts().then(openFromHash);
if ('serviceWorker' in navigator && location.protocol !== 'file:' && !/^(localhost|127\.)/.test(location.hostname)) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
// Für Tests und neugierige Entwickler
const findCart = (t) => carts.find((c) => c.file === t || c.title.startsWith(t)) || carts.find((c) => c.title.includes(t));
window.eightboy = {
  openStore, innen, access,
  system, gfx, audio, input, settings, powerOn, unboxer, switchMachine, gpu: { ok: gpu.ok, renderer: gpu.renderer || '' },
  insertCart: (title) => insertCart(findCart(title)),
  unpack: (title) => unpack(findCart(title)),
  openDialog: (title) => openDialog(findCart(title)),
  get carts() { return carts; },
  packagePNG: async (title) => { const c = findCart(title); const b = await buildPNGCart(c, await loadCover(c)); return new Uint8Array(await b.arrayBuffer()); },
  importBytes: (bytes, name) => importFile(new File([bytes], name), true),
  assets,
  dock, applySettings,
};
