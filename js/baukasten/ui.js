// Kleine Helfer für die Oberfläche: Elemente bauen, Bildchen aus Pixeltext, Pixelschrift, Auswahlfelder, Hinweise.
import { DEFAULT_PALETTE, parsePixelRows, TRANSPARENT } from '../gfx.js';
import { GLYPHS, FALLBACK } from '../font.js';

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
export const hex = (i) => '#' + DEFAULT_PALETTE[i & 31].toString(16).padStart(6, '0');

// h('div.klasse#id', { onclick, title, ... }, kinder...)
export function h(spec, attrs, ...kids) {
  if (attrs && (typeof attrs !== 'object' || attrs instanceof Node || Array.isArray(attrs))) { kids.unshift(attrs); attrs = {}; }
  const m = /^([a-z0-9-]+)?((?:[.#][\w-]+)*)$/i.exec(spec) || [];
  const el = document.createElement(m[1] || 'div');
  for (const part of (m[2] || '').match(/[.#][\w-]+/g) || []) {
    if (part[0] === '.') el.classList.add(part.slice(1)); else el.id = part.slice(1);
  }
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k === 'class') el.className += ' ' + v;
    else if (k === 'html') el.innerHTML = v;
    else if (k in el && k !== 'list' && typeof v !== 'string') el[k] = v;
    else if (k === 'value') el.value = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid === null || kid === undefined || kid === false) continue;
    el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return el;
}

// ------------------------------------------------------------------ Bildchen aus Pixeltext
const thumbCache = new Map();
export function spriteCanvas(rows, scale = 3) {
  const { w, h: hh, data } = parsePixelRows(rows || '.');
  const c = document.createElement('canvas');
  c.width = Math.max(1, w * scale); c.height = Math.max(1, hh * scale);
  const g = c.getContext('2d');
  for (let y = 0; y < hh; y++) for (let x = 0; x < w; x++) {
    const v = data[y * w + x];
    if (v === TRANSPARENT) continue;
    g.fillStyle = hex(v);
    g.fillRect(x * scale, y * scale, scale, scale);
  }
  return c;
}
export function spriteURL(rows, scale = 4) {
  const key = scale + '|' + rows;
  if (!thumbCache.has(key)) {
    if (thumbCache.size > 600) thumbCache.clear();
    thumbCache.set(key, spriteCanvas(rows, scale).toDataURL());
  }
  return thumbCache.get(key);
}
export function spriteImg(sprite, size = 32, title) {
  const img = h('img.spr', { src: spriteURL(sprite?.rows || '.', 4), width: size, height: size, alt: '', draggable: false });
  if (title) img.title = title;
  return img;
}
// Bitmap je Sprite (für das schnelle Malen der Karte)
const bmpCache = new Map();
export function spriteBitmap(rows) {
  if (!bmpCache.has(rows)) { if (bmpCache.size > 600) bmpCache.clear(); bmpCache.set(rows, spriteCanvas(rows, 1)); }
  return bmpCache.get(rows);
}

// ------------------------------------------------------------------ Pixelschrift der Konsole
export function pixelText(canvas, text, { scale = 2, color = 10, shadow = 1, pad = 0 } = {}) {
  const chars = [...text];
  const w = chars.length * 6 - 1 + pad * 2 + (shadow ? 1 : 0), hh = 8 + pad * 2 + (shadow ? 1 : 0);
  canvas.width = w * scale; canvas.height = hh * scale;
  const g = canvas.getContext('2d');
  const draw = (ox, oy, c) => {
    g.fillStyle = typeof c === 'number' ? hex(c) : c;
    chars.forEach((ch, i) => {
      const gl = GLYPHS.get(ch) || FALLBACK;
      for (let r = 0; r < 8; r++) for (let b = 0; b < 5; b++) if (gl[r] & (16 >> b)) g.fillRect((pad + ox + i * 6 + b) * scale, (pad + oy + r) * scale, scale, scale);
    });
  };
  if (shadow) draw(1, 1, typeof shadow === 'number' ? shadow : 0);
  draw(0, 0, color);
  canvas.style.width = canvas.width + 'px'; canvas.style.height = canvas.height + 'px';
  return canvas;
}

// ------------------------------------------------------------------ Formularbausteine
export function field(label, control, help) {
  return h('label.fld', h('span.fld-l', label), control, help ? h('span.fld-h', help) : null);
}
export function select(options, value, onchange, attrs = {}) {
  const s = h('select', { ...attrs, onchange: (e) => onchange(e.target.value, e) });
  for (const o of options) {
    if (o && o.group) {
      const g = h('optgroup', { label: o.group });
      for (const [v, l] of o.items) g.append(h('option', { value: v }, l));
      s.append(g);
    } else s.append(h('option', { value: o[0] }, o[1]));
  }
  s.value = value ?? '';
  if (s.selectedIndex < 0 && s.options.length) { s.selectedIndex = 0; }
  return s;
}
export function textInput(value, oninput, attrs = {}) {
  return h('input', { type: 'text', value: value ?? '', spellcheck: false, ...attrs, oninput: (e) => oninput(e.target.value, e) });
}
export function numberInput(value, oninput, attrs = {}) {
  return h('input', { type: 'number', value: value ?? 0, ...attrs, oninput: (e) => { const v = parseFloat(e.target.value); if (Number.isFinite(v)) oninput(v, e); } });
}
export function check(label, value, onchange, help) {
  const box = h('input', { type: 'checkbox', checked: !!value, onchange: (e) => onchange(e.target.checked, e) });
  return h('label.chkf', box, h('span', label), help ? h('span.fld-h', help) : null);
}
export function button(label, onclick, cls = '', attrs = {}) {
  return h('button.btn' + (cls ? '.' + cls.split(' ').join('.') : ''), { type: 'button', ...attrs, onclick }, label);
}

// Farbwähler mit den 32 Konsolenfarben
export function colorPicker(value, onpick) {
  const wrap = h('div.swatches', { role: 'radiogroup' });
  for (let i = 0; i < 32; i++) {
    wrap.append(h('button.sw', { type: 'button', style: { background: hex(i) }, title: 'Farbe ' + i, 'aria-label': 'Farbe ' + i, 'aria-checked': String(i === value), role: 'radio', class: i === value ? 'on' : '', onclick: () => { onpick(i); wrap.querySelectorAll('.sw').forEach((b, k) => { b.classList.toggle('on', k === i); b.setAttribute('aria-checked', String(k === i)); }); } }));
  }
  return wrap;
}

// Bildwähler: kleines Gitter der Sprites (filter = welche)
export function spritePicker(project, value, onpick, { filter = () => true, none = null } = {}) {
  const wrap = h('div.sprpick');
  const mark = () => wrap.querySelectorAll('button').forEach((b) => b.classList.toggle('on', +b.dataset.n === +value));
  if (none) wrap.append(h('button.sp-none', { type: 'button', dataset: { n: 0 }, title: none, onclick: () => { value = 0; mark(); onpick(0); } }, '–'));
  for (const s of project.sprites.filter(filter)) {
    wrap.append(h('button', { type: 'button', dataset: { n: s.n }, title: `${s.n}: ${s.name}`, onclick: () => { value = s.n; mark(); onpick(s.n); } }, spriteImg(s, 24)));
  }
  mark();
  return wrap;
}

// ------------------------------------------------------------------ Hinweis unten
let toastTimer = null;
export function toast(msg, kind = '') {
  const t = $('#toast');
  t.textContent = msg; t.className = 'toast ' + kind; t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 2800);
}

// Aufklappmenü an einem Knopf: items = [{ group, items: [{ label, desc, onpick }] }]
export function popMenu(anchor, groups, { width = 300 } = {}) {
  closeMenus();
  const m = h('div.pop', { role: 'menu', style: { width: width + 'px' } });
  for (const g of groups) {
    if (g.group) m.append(h('div.pop-g', g.group));
    for (const it of g.items) {
      m.append(h('button.pop-i', { type: 'button', role: 'menuitem', onclick: () => { closeMenus(); it.onpick(); } }, it.icon || null, h('span', h('b', it.label), it.desc ? h('small', it.desc) : null)));
    }
  }
  document.body.append(m);
  const r = anchor.getBoundingClientRect();
  const mh = m.offsetHeight;
  let top = r.bottom + 4;
  if (top + mh > innerHeight - 8) top = Math.max(8, r.top - mh - 4);
  m.style.left = Math.min(innerWidth - width - 8, Math.max(8, r.left)) + 'px';
  m.style.top = top + 'px';
  m.querySelector('button')?.focus();
  setTimeout(() => document.addEventListener('pointerdown', outside, true), 0);
  function outside(e) { if (!m.contains(e.target)) closeMenus(); }
  m._off = () => document.removeEventListener('pointerdown', outside, true);
  m.addEventListener('keydown', (e) => {
    const items = [...m.querySelectorAll('.pop-i')], i = items.indexOf(document.activeElement);
    if (e.key === 'Escape') { closeMenus(); anchor.focus(); }
    if (e.key === 'ArrowDown') { e.preventDefault(); items[(i + 1) % items.length].focus(); }
    if (e.key === 'ArrowUp') { e.preventDefault(); items[(i - 1 + items.length) % items.length].focus(); }
  });
  return m;
}
export function closeMenus() { document.querySelectorAll('.pop').forEach((m) => { m._off?.(); m.remove(); }); }

// Einfache Rückfrage
export function confirmBox(text, yes = 'Ja', no = 'Abbrechen') {
  return new Promise((res) => {
    const close = (v) => { bg.remove(); res(v); };
    const bg = h('div.modal-bg', { onclick: (e) => { if (e.target === bg) close(false); } },
      h('div.modal', { role: 'dialog', 'aria-modal': 'true' },
        h('p', text),
        h('div.modal-a', button(no, () => close(false)), button(yes, () => close(true), 'primary'))));
    document.body.append(bg);
    bg.querySelector('.primary').focus();
    bg.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(false); });
  });
}

export function download(name, text, type = 'text/plain') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = h('a', { href: url, download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

// Pixel-Symbole für die Bereichsleiste (8×8, wie Sprites)
export const ICONS = {
  projekt: '..aaaa..\n.a6666a.\n.a6aa6a.\n.a6666a.\n.aaaaaa.\n.a.aa.a.\n.aaaaaa.\n........',
  assets: '...77...\n..7887..\n.7888b7.\n.78bbb7.\n.7ccbb7.\n.7cc997.\n..7997..\n...77...',
  szenen: 'bbbbcccc\nbbbbcccc\nbbn3ccc7\nbn33cccc\nvvvvvvbb\nvvvvvvbb\nbbbbvvbb\nbbbbvvbb',
  regeln: '....aa..\n...aa...\n..aa....\n.aaaaaa.\n....aa..\n...aa...\n..aa....\n........',
  dialoge: '.777777.\n77777777\n77000007\n77777777\n77000777\n.777777.\n..77....\n.7......',
  blaupausen: 'cc......\ncc.....9\n.7....99\n..7777..\n..7..7..\n99....cc\n9.....cc\n........',
  spielen: '........\n.bb.....\n.bbbb...\n.bbbbbb.\n.bbbbbb.\n.bbbb...\n.bb.....\n........',
};
