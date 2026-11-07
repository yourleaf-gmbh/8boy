// 8BOY Baukasten: Spiele zusammenklicken, heraus kommt eine Lua-Kartridge.
// Aufbau: links die Bereiche, in der Mitte die Arbeitsfläche, rechts die Eigenschaften.
import { createStore } from './store.js';
import { h, $, pixelText, spriteCanvas, toast, ICONS, closeMenus, confirmBox } from './ui.js';
import { smokeTest } from './preview.js';
import { whereIs } from './sec-play.js';
import { generateLua, checkProject } from './codegen.js';
import { parseCart, saveUserCart, markUnpacked, newCartId, fileNameFor, SPEICHER_VOLL } from '../carts.js';
import { createAudio } from '../audio.js';
import * as secProject from './sec-project.js';
import * as secAssets from './sec-assets.js';
import * as secScenes from './sec-scenes.js';
import * as secRules from './sec-rules.js';
import * as secDialogs from './sec-dialogs.js';
import * as secBlueprints from './sec-blueprints.js';
import * as secPlay from './sec-play.js';

const SECTIONS = [
  { id: 'projekt', label: 'Projekt', mod: secProject, help: 'Titel, Etikett, Speichern' },
  { id: 'assets', label: 'Assets', mod: secAssets, help: 'Bilder, Klänge, Musik' },
  { id: 'szenen', label: 'Szenen', mod: secScenes, help: 'Karten malen, Objekte setzen' },
  { id: 'regeln', label: 'Regeln', mod: secRules, help: 'Wenn … dann …' },
  { id: 'dialoge', label: 'Dialoge', mod: secDialogs, help: 'Gespräche mit Antworten' },
  { id: 'blaupausen', label: 'Blaupausen', mod: secBlueprints, help: 'Welten erzeugen lassen' },
  { id: 'spielen', label: 'Spielen', mod: secPlay, help: 'Testen, Code ansehen' },
];

const store = createStore();
const audio = createAudio();
const main = $('#main'), side = $('#side'), nav = $('#nav');
let current = null;
let cleanup = null;

const app = {
  store, audio,
  get section() { return current; },
  go(id, patch = {}) {
    Object.assign(store.ui, patch);
    if (!store.project && id !== 'projekt') id = 'projekt';
    if (id !== current) { audio.stop(); try { history.replaceState(null, '', '#' + id); } catch { /* egal */ } }
    current = id;
    render(true);
  },
  refresh() { render(false); },
  // Kartridge bauen und ins Regal der Konsole legen
  buildCart() {
    const p = store.project;
    const result = generateLua(p);
    if (!p.cartId) store.edit((pp) => { pp.cartId = newCartId(); }, { render: false });
    const cart = parseCart(result.code, { id: p.cartId, file: fileNameFor({ title: p.title }), builtin: false });
    cart.kind = 'user';
    if (!saveUserCart(cart)) { toast(SPEICHER_VOLL, 'err'); throw new Error(SPEICHER_VOLL); }
    markUnpacked(cart);
    return { cart, ...result };
  },
  openConsole(cart, win = null) {
    // Die Konsole lädt eigene Kartridges beim Start. #cart=<id> legt sie (sobald der Hauptstrang das kann) direkt ein.
    const url = `index.html?aus=baukasten&t=${Date.now()}#cart=${encodeURIComponent(cart.id)}`;
    if (win) { win.location.href = url; win.focus?.(); return; }
    const w = window.open(url, '8boy-konsole');
    if (!w) toast('Der Browser hat das neue Fenster blockiert. Erlaube Pop-ups für diese Seite.', 'err');
  },
  async play() {
    if (!store.project) return;
    const errors = checkProject(store.project).filter((x) => x.level === 'error');
    if (errors.length && !(await confirmBox(`${errors[0].text}${errors.length > 1 ? ` (und ${errors.length - 1} weitere Probleme)` : ''} Trotzdem spielen?`, 'Trotzdem spielen', 'Erst ansehen'))) {
      app.go('spielen', { playTab: 'pruefen' });
      return;
    }
    // Popup sofort öffnen (sonst blockt der Browser es), dann bauen und kurz testen
    const win = window.open('', '8boy-konsole');
    const { cart, code, ranges } = app.buildCart();
    const err = smokeTest(code);
    if (err) {
      win?.close();
      const w = err.line ? whereIs(ranges, err.line, store.project) : null;
      toast(`Das Spiel stolpert${w ? ' in ' + w.text : ''}: ${err.message}`, 'err');
      app.go('spielen', { playTab: 'code', codeLine: err.line, codeFocus: w?.rule || null });
      return;
    }
    toast(`„${cart.title}“ liegt im Regal der Konsole.`);
    app.openConsole(cart, win);
  },
};
window.baukasten = app; // für Tests

// ------------------------------------------------------------------ Kopfzeile
pixelText($('#logo'), '8BOY Baukasten', { scale: 2, color: 10, shadow: 2 });
pixelText($('#logoSmall'), '8BOY Baukasten', { scale: 3, color: 10, shadow: 2 });
const titleIn = $('#projTitle');
titleIn.addEventListener('input', () => store.edit((p) => { p.title = titleIn.value; }, { merge: 'title', render: false }));
titleIn.addEventListener('change', () => app.refresh());
$('#undo').addEventListener('click', () => { if (!store.undo()) toast('Nichts zum Rückgängigmachen.'); });
$('#redo').addEventListener('click', () => { if (!store.redo()) toast('Nichts zum Wiederholen.'); });
$('#playBtn').addEventListener('click', () => app.play());
$('#checkBtn').addEventListener('click', () => app.go('spielen', { playTab: 'pruefen' }));

// ------------------------------------------------------------------ Bereichsleiste
function renderNav() {
  nav.textContent = '';
  for (const s of SECTIONS) {
    const icon = spriteCanvas(ICONS[s.id], 3);
    icon.className = 'nav-ic';
    nav.append(h('button.nav-b', {
      type: 'button', class: s.id === current ? 'on' : '', 'aria-current': s.id === current ? 'page' : null, dataset: { sec: s.id },
      disabled: !store.project && s.id !== 'projekt', onclick: () => app.go(s.id),
    }, icon, h('span.nav-t', h('b', s.label), h('small', s.help))));
  }
}

function updateTop() {
  const p = store.project;
  if (document.activeElement !== titleIn) titleIn.value = p?.title || '';
  titleIn.disabled = !p;
  titleIn.hidden = !p;
  $('#undo').disabled = !store.canUndo;
  $('#redo').disabled = !store.canRedo;
  $('#playBtn').disabled = !p;
  const n = p ? checkProject(p).length : 0;
  $('#checkCount').textContent = n;
  $('#checkCount').nextSibling.textContent = n === 1 ? ' Hinweis' : ' Hinweise';
  $('#checkBtn').classList.toggle('has', n > 0);
  $('#checkBtn').hidden = !p;
  document.title = p ? `${p.title || 'Unbenannt'} – 8BOY Baukasten` : '8BOY Baukasten';
}

// ------------------------------------------------------------------ Bereich zeichnen
function render(fresh) {
  pending = null;
  closeMenus();
  const sec = SECTIONS.find((s) => s.id === current) || SECTIONS[0];
  // Scrollstände und Fokus merken
  const scrolls = {};
  for (const el of document.querySelectorAll('[data-scroll]')) scrolls[el.dataset.scroll] = [el.scrollLeft, el.scrollTop];
  const fid = document.activeElement?.dataset?.fid;
  if (cleanup) { try { cleanup(); } catch { /* egal */ } cleanup = null; }
  main.textContent = ''; side.textContent = '';
  main.className = 'bk-main sec-' + sec.id;
  side.className = 'bk-side sec-' + sec.id;
  const res = sec.mod.render({ main, side, store, app, fresh });
  if (typeof res === 'function') cleanup = res;
  renderNav();
  updateTop();
  for (const el of document.querySelectorAll('[data-scroll]')) {
    const s = scrolls[el.dataset.scroll];
    if (s && !fresh) { el.scrollLeft = s[0]; el.scrollTop = s[1]; }
  }
  if (fid) document.querySelector(`[data-fid="${CSS.escape(fid)}"]`)?.focus();
}

// Neu zeichnen erst nach der laufenden Aktion: so zählt auch eine Auswahl, die direkt nach der Änderung gesetzt wird
let pending = null;
function schedule(fresh) {
  if (pending) { pending.fresh ||= fresh; return; }
  pending = { fresh };
  queueMicrotask(() => { const f = pending?.fresh; if (pending) { pending = null; render(f); } });
}
store.on((what) => {
  if (what === 'change' || what === 'open' || what === 'list') schedule(what !== 'change');
  else updateTop();
  const saved = $('#saved');
  if (what === 'dirty') { saved.textContent = 'speichert …'; saved.className = 'bk-saved busy'; }
  if (what === 'saved') { saved.textContent = 'gespeichert'; saved.className = 'bk-saved'; }
  if (what === 'savefail') { saved.textContent = 'Speicher voll!'; saved.className = 'bk-saved err'; }
});

// ------------------------------------------------------------------ Tastatur
window.addEventListener('keydown', (e) => {
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || e.target.isContentEditable;
  const mod = e.ctrlKey || e.metaKey;
  if (mod && !e.altKey && (e.key === 'z' || e.key === 'Z') && !e.shiftKey) {
    if (typing && e.target.tagName !== 'SELECT') return;   // im Textfeld: Rückgängig des Browsers
    e.preventDefault(); store.undo();
  } else if (mod && (e.key === 'y' || e.key === 'Y' || ((e.key === 'z' || e.key === 'Z') && e.shiftKey))) {
    if (typing && e.target.tagName !== 'SELECT') return;
    e.preventDefault(); store.redo();
  } else if (mod && (e.key === 's' || e.key === 'S')) {
    e.preventDefault(); store.saveNow(); toast('Gespeichert.');
  } else if (mod && e.key === 'Enter') {
    e.preventDefault(); app.play();
  }
});
window.addEventListener('beforeunload', () => store.saveNow());

// ------------------------------------------------------------------ Start
const start = (location.hash || '').slice(1);
app.go(SECTIONS.some((s) => s.id === start) ? start : store.project ? 'szenen' : 'projekt');
