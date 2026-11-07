// Pixel-Grafik außerhalb des Bildschirms: Packung, Anleitungsheft, Versandbild.
// Alles wird in kleinen Canvas-Flächen mit der 8BOY-Schrift und -Palette gezeichnet und per CSS
// scharf vergrößert – so sieht die Verpackung aus wie aus derselben Konsole.
import { GLYPHS, FALLBACK, ADVANCE } from './font.js';
import { DEFAULT_PALETTE, parsePixelRows, TRANSPARENT } from './gfx.js';

export const PAL = DEFAULT_PALETTE.map((c) => '#' + c.toString(16).padStart(6, '0'));
export const BOX_W = 256, BOX_H = 320, BOX_D = 40;
export const PAGE_W = 144, PAGE_H = 192;
export const ART = { x: 8, y: 34, w: 240, h: 160 };

export function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  g.imageSmoothingEnabled = false;
  return { c, g };
}

const fill = (g, x, y, w, h, col) => { g.fillStyle = PAL[col & 31]; g.fillRect(x, y, w, h); };

// ------------------------------------------------------------------ Schrift
export function drawText(g, str, x, y, col, scale = 1) {
  g.fillStyle = PAL[col & 31];
  let cx = x;
  for (const ch of String(str)) {
    const rows = GLYPHS.get(ch) || FALLBACK;
    for (let r = 0; r < 8; r++) {
      const bits = rows[r];
      if (!bits) continue;
      for (let b = 0; b < 5; b++) if (bits & (16 >> b)) g.fillRect(cx + b * scale, y + r * scale, scale, scale);
    }
    cx += ADVANCE * scale;
  }
  return cx - x;
}
export const textW = (str, scale = 1) => Math.max(0, [...String(str)].length * ADVANCE - 1) * scale;
// Große Schrift nur, wenn kein Wort getrennt werden muss und es höchstens maxLines Zeilen werden
export function fitTitle(text, maxW, maxLines) {
  const big = wrap(text, maxW, 2);
  const ok = big.length <= maxLines && String(text).split(/\s+/).every((w) => textW(w, 2) <= maxW);
  return ok ? { lines: big, sc: 2 } : { lines: wrap(text, maxW), sc: 1 };
}
export function shadowText(g, str, x, y, col, shadow = 0, scale = 1) {
  drawText(g, str, x + scale, y + scale, shadow, scale);
  return drawText(g, str, x, y, col, scale);
}

// Zeilenumbruch nach Pixelbreite; Wörter, die allein zu lang sind, werden hart getrennt
export function wrap(text, maxW, scale = 1) {
  const out = [];
  for (const para of String(text).split('\n')) {
    let line = '';
    for (let word of para.split(/\s+/).filter(Boolean)) {
      while (textW(word, scale) > maxW) {
        const n = Math.max(1, Math.floor((maxW + scale) / (ADVANCE * scale)) - 1);
        if (line) { out.push(line); line = ''; }
        out.push(word.slice(0, n) + '-');
        word = word.slice(n);
      }
      const next = line ? line + ' ' + word : word;
      if (textW(next, scale) > maxW) { out.push(line); line = word; } else line = next;
    }
    out.push(line);
  }
  return out;
}

// ------------------------------------------------------------------ Tasten-Symbole fürs Heft
// [A] [B] [X] [Y] [L] [R] [MENU] [OPTION] [←] [→] [↑] [↓] [✚]
// [MENÜ] = [MENU]; die alten Namen [START] und [SELECT] gehen weiter und zeigen dasselbe Symbol.
const ICON_ALIAS = { START: 'MENU', 'MENÜ': 'MENU', SELECT: 'OPTION' };
const ICON_W = { A: 9, B: 9, X: 9, Y: 9, L: 11, R: 11, MENU: 34, OPTION: 46, '←': 9, '→': 9, '↑': 9, '↓': 9, '✚': 9 };
function drawIcon(g, name, x, y, ink) {
  name = ICON_ALIAS[name] || name;
  if (name === 'A' || name === 'B' || name === 'X' || name === 'Y') {
    // A und X gelb, B und Y dunkel – wie auf dem Gehäuse
    const hell = name === 'A' || name === 'X';
    const col = hell ? 10 : 5;
    fill(g, x + 2, y, 5, 9, col); fill(g, x, y + 2, 9, 5, col); fill(g, x + 1, y + 1, 7, 7, col);
    drawText(g, name, x + 2, y + 1, hell ? 0 : 10);
    return;
  }
  if (name === 'MENU' || name === 'OPTION' || name === 'L' || name === 'R') {
    const w = ICON_W[name];
    fill(g, x + 1, y, w - 2, 9, 5); fill(g, x, y + 1, w, 7, 5);
    if (name === 'MENU') {          // drei Striche
      for (const dy of [2, 4, 6]) fill(g, x + 2, y + dy, 5, 1, 10);
      drawText(g, 'MENÜ', x + 9, y + 1, 7);
    } else if (name === 'OPTION') { // zwei Schieberegler
      fill(g, x + 1, y + 3, 7, 1, 7); fill(g, x + 1, y + 6, 7, 1, 7);
      fill(g, x + 2, y + 2, 2, 3, 10); fill(g, x + 5, y + 5, 2, 3, 10);
      drawText(g, 'OPTION', x + 9, y + 1, 7);
    } else drawText(g, name, x + 3, y + 1, 7);
    return;
  }
  // Steuerkreuz, die gedrückte Richtung hell
  fill(g, x + 3, y, 3, 9, name === '✚' ? ink : 30); fill(g, x, y + 3, 9, 3, name === '✚' ? ink : 30);
  const hi = 8;
  if (name === '↑') fill(g, x + 3, y, 3, 3, hi);
  if (name === '↓') fill(g, x + 3, y + 6, 3, 3, hi);
  if (name === '←') fill(g, x, y + 3, 3, 3, hi);
  if (name === '→') fill(g, x + 6, y + 3, 3, 3, hi);
}

// Text mit eingebetteten Symbolen in Wörter zerlegen: { w, parts:[{t}|{icon}] }
function tokenize(line) {
  const words = [];
  for (const raw of line.split(/\s+/).filter(Boolean)) {
    const parts = [];
    let w = 0;
    for (const m of raw.matchAll(/\[(A|B|X|Y|L|R|MENU|MENÜ|OPTION|START|SELECT|←|→|↑|↓|✚)\]|[^[]+|\[/g)) {
      if (m[1]) { const ic = ICON_ALIAS[m[1]] || m[1]; parts.push({ icon: ic }); w += ICON_W[ic] + 1; } else { parts.push({ t: m[0] }); w += [...m[0]].length * ADVANCE; }
    }
    words.push({ w: w - 1, parts, raw });
  }
  return words;
}

// ------------------------------------------------------------------ Anleitung
// Format in der Kartridge:   --[[anleitung
//                            # Überschrift
//                            Text mit [A] und [←]-Symbolen. Leerzeile = neuer Absatz, "- " = Aufzählung
//                            ]]
export function parseManual(code) {
  const m = /--\[(=*)\[anleitung[^\n]*\n([\s\S]*?)\]\1\]/i.exec(String(code));
  if (!m) return null;
  const sections = [];
  let cur = null;
  for (const line of m[2].split(/\r?\n/)) {
    const h = /^\s*#\s*(.+)$/.exec(line);
    if (h) { cur = { title: h[1].trim(), lines: [] }; sections.push(cur); continue; }
    if (!cur) { cur = { title: '', lines: [] }; sections.push(cur); }
    cur.lines.push(line.replace(/\s+$/, ''));
  }
  for (const s of sections) {
    while (s.lines.length && !s.lines[0].trim()) s.lines.shift();
    while (s.lines.length && !s.lines.at(-1).trim()) s.lines.pop();
  }
  return sections.filter((s) => s.title || s.lines.length);
}

function defaultManual(cart) {
  return [
    { title: 'Worum geht es?', lines: [cart.desc || 'Lege die Kartridge ein und probiere es aus!'] },
    { title: 'Die Tasten', lines: ['[✚] Steuerkreuz', '[A] Aktion', '[B] zweite Aktion', '[MENU] Pause', '', 'MENÜ lange drücken öffnet das Menü der Konsole.'] },
  ];
}

const M = 8; // Seitenrand
// Layout: liefert Seiten als Liste von Zeichenbefehlen
function layoutManual(sections) {
  const pages = [];
  const maxW = PAGE_W - 2 * M, top = 12, bottom = PAGE_H - 16, LH = 10;
  for (const s of sections) {
    let page = { title: s.title, items: [] }, y = top;
    const newPage = () => { pages.push(page); page = { title: s.title, cont: true, items: [] }; y = top; };
    if (s.title) {
      const tl = wrap(s.title, maxW);
      for (const l of tl) { page.items.push({ kind: 'h', text: l, y }); y += 10; }
      page.items.push({ kind: 'rule', y: y }); y += 6;
    }
    for (const raw of s.lines) {
      if (!raw.trim()) { y += 5; continue; }
      const bullet = /^\s*[-•]\s+/.test(raw);
      const indent = bullet ? 8 : 0;
      const words = tokenize(raw.replace(/^\s*[-•]\s+/, ''));
      let line = [], lw = 0, first = true;
      // Zeilen, die mit einem Tasten-Symbol beginnen, rücken Folgezeilen hinter das Symbol ein
      const hang = words[0]?.parts.length === 1 && words[0].parts[0].icon ? words[0].w + 6 : 0;
      const flush = () => {
        if (y + LH > bottom) newPage();
        page.items.push({ kind: 'line', words: line, x: M + indent + (first ? 0 : hang), y, bullet: bullet && first });
        y += LH; line = []; lw = 0; first = false;
      };
      for (const w of words) {
        const add = (line.length ? 6 : 0) + w.w;
        if (line.length && lw + add > maxW - indent - (first ? 0 : hang)) flush();
        lw += (line.length ? 6 : 0) + w.w;
        line.push(w);
      }
      if (line.length) flush();
    }
    pages.push(page);
  }
  return pages;
}

function drawPaper(g, n, side) {
  fill(g, 0, 0, PAGE_W, PAGE_H, 31);
  // leichte Papierstruktur
  g.fillStyle = PAL[15];
  for (let i = 0; i < 90; i++) { const x = (i * 53 + n * 17) % PAGE_W, y = (i * 97 + n * 31) % PAGE_H; g.fillRect(x, y, 1, 1); }
  // Falz zur Heftmitte hin dunkler
  const fx = side === 'left' ? PAGE_W - 3 : 0;
  fill(g, fx, 0, 3, PAGE_H, 15);
  fill(g, side === 'left' ? PAGE_W - 1 : 0, 0, 1, PAGE_H, 24);
}

function drawLine(g, item, ink) {
  let x = item.x;
  if (item.bullet) fill(g, x - 6, item.y + 3, 3, 3, 8);
  for (const w of item.words) {
    for (const p of w.parts) {
      if (p.icon) { drawIcon(g, p.icon, x, item.y - 1, ink); x += ICON_W[p.icon] + 1; } else x += drawText(g, p.t, x, item.y, ink);
    }
    x += 6;
  }
}

// Alle Heftseiten als Canvas: Umschlag, Inhalt, Rückseite
export function renderManualPages(cart, cover) {
  const sections = parseManual(cart.code) || defaultManual(cart);
  const accent = cart.color === 7 || cart.color === 31 || cart.color === 10 ? 1 : cart.color;
  const pages = [];
  // Umschlag
  {
    const { c, g } = makeCanvas(PAGE_W, PAGE_H);
    fill(g, 0, 0, PAGE_W, PAGE_H, 16);
    fill(g, 0, 0, PAGE_W, 20, 0);
    if (cart.system >= 16) {
      genHead(g, 8, 3, cart.system);
      drawText(g, 'HEFT', PAGE_W - 8 - textW('HEFT'), 8, 10);
    } else {
      shadowText(g, '8BOY', 8, 3, 7, 8, 2);
      drawText(g, 'ANLEITUNG', PAGE_W - 8 - textW('ANLEITUNG'), 8, 10);
    }
    fill(g, 0, 20, PAGE_W, 4, accent);
    // Bildausschnitt in halber Größe
    fill(g, 11, 31, 122, 82, 0);
    if (cover) g.drawImage(cover, ...coverSrc(cover), 12, 32, 120, 80);
    else drawGeneratedArt(g, cart, 12, 32, 120, 80, 3);
    let y = 122;
    const { lines, sc } = fitTitle(cart.title, PAGE_W - 16, 3);
    for (const l of lines.slice(0, 4)) { shadowText(g, l, 8, y, 7, 0, sc); y += 9 * sc + 1; }
    if (cart.author) drawText(g, 'von ' + cart.author, 8, Math.min(y + 2, PAGE_H - 22), 29);
    fill(g, 0, PAGE_H - 12, PAGE_W, 12, 0);
    drawText(g, 'LUA-KARTRIDGE', 8, PAGE_H - 10, 30);
    pages.push(c);
  }
  layoutManual(sections).forEach((p, i) => {
    const { c, g } = makeCanvas(PAGE_W, PAGE_H);
    const n = pages.length;
    drawPaper(g, n, n % 2 ? 'left' : 'right');
    for (const it of p.items) {
      if (it.kind === 'h') shadowText(g, it.text, M, it.y, 1, 30);
      else if (it.kind === 'rule') { fill(g, M, it.y, PAGE_W - 2 * M, 2, accent); fill(g, M, it.y + 2, PAGE_W - 2 * M, 1, 24); }
      else drawLine(g, it, 1);
    }
    if (p.cont && p.title) drawText(g, '…', PAGE_W - M - 5, 2, 30);
    const num = String(n + 1);
    drawText(g, num, (PAGE_W - textW(num)) >> 1, PAGE_H - 11, 30);
    pages.push(c);
    void i;
  });
  // Rückseite
  {
    const { c, g } = makeCanvas(PAGE_W, PAGE_H);
    fill(g, 0, 0, PAGE_W, PAGE_H, 16);
    let y = 14;
    shadowText(g, 'Viel Spaß!', 8, y, 10, 0, 2); y += 26;
    const lic = cart.license ? 'Lizenz: ' + cart.license
      : cart.highlight ? 'Interne Kartridge – bitte nicht weitergeben.' : 'Code: MIT · Inhalte: CC BY-SA 4.0 (siehe LIZENZEN.txt)';
    const info = [cart.author && 'Spiel von ' + cart.author, lic].filter(Boolean);
    const bottom = PAGE_H - 34;
    for (const t of info) for (const l of wrap(t, PAGE_W - 16)) { if (y + 8 <= bottom) drawText(g, l, 8, y, 29); y += 10; }
    y += 6;
    const src = wrap('Diese Kartridge ist zugleich ihr eigener Quelltext: Im 8BOY Studio kannst du sie ansehen und verändern.', PAGE_W - 16);
    if (y + src.length * 10 - 2 <= bottom) for (const l of src) { drawText(g, l, 8, y, 30); y += 10; }
    fill(g, 0, PAGE_H - 30, PAGE_W, 30, 0);
    shadowText(g, '8BOY', 8, PAGE_H - 25, 7, 8, 2);
    drawText(g, '8boy.yourleaf.de', 8, PAGE_H - 9, 30);
    pages.push(c);
  }
  return pages;
}

// ------------------------------------------------------------------ Ersatzbild ohne Bildschirmfoto
export function drawGeneratedArt(g, cart, x, y, w, h, scale = 6) {
  const base = cart.color & 31;
  fill(g, x, y, w, h, 16);
  for (let i = 0; i < h; i += 2) fill(g, x, y + i, w, 1, i < h / 2 ? 17 : 1);
  // Sterne
  for (let i = 0; i < 26; i++) fill(g, x + ((i * 67) % w), y + ((i * 41) % (h - 4)), 1, 1, i % 3 ? 29 : 10);
  // Boden in Etikettfarbe
  fill(g, x, y + h - Math.floor(h / 5), w, Math.floor(h / 5), base);
  if (cart.icon) {
    const { w: iw, h: ih, data } = parsePixelRows(cart.icon);
    const s = Math.max(1, Math.min(scale, Math.floor((h * 0.6) / ih)));
    const ox = x + ((w - iw * s) >> 1), oy = y + ((h - ih * s) >> 1) - 4;
    for (let yy = 0; yy < ih; yy++) for (let xx = 0; xx < iw; xx++) {
      const v = data[yy * iw + xx];
      if (v !== TRANSPARENT) fill(g, ox + xx * s, oy + yy * s, s, s, v);
    }
  } else {
    const t = (cart.title || '?').slice(0, 1).toUpperCase();
    const s = Math.max(2, Math.floor(h / 14));
    shadowText(g, t, x + ((w - textW(t, s)) >> 1), y + ((h - 8 * s) >> 1) - 4, 7, base, s);
  }
}

// ------------------------------------------------------------------ Packung
// Titelbilder vom 8BOY 16 (256x224) werden mittig auf 240x160 zugeschnitten, pixelgenau
const coverXY = (cover) => [Math.max(0, (cover.width - 240) >> 1), Math.max(0, (cover.height - 160) >> 1)];
// Ausschnitt fürs Titelbild: kleine Bildschirme mittig 240×160, der 8BOY 64 (640×360) verkleinert als 3:2-Ausschnitt
const coverSrc = (cover) => {
  if (cover.width <= 320) return [...coverXY(cover), 240, 160];
  const sh = cover.height, sw = Math.min(cover.width, Math.round(sh * 1.5));
  return [(cover.width - sw) >> 1, 0, sw, sh];
};
// Kopf der Packung ab 8BOY 16: Wortmarke 8BOY, dahinter die Generation als Zahl auf einem Schild
const GEN_FARBE = { 16: 10, 32: 29, 64: 20, 128: 14 };
function genHead(g, x, y, sys) {
  shadowText(g, '8BOY', x, y, 7, 0, 2);
  const n = String(sys >= 128 ? 128 : sys >= 64 ? 64 : sys >= 32 ? 32 : 16);
  const bx = x + textW('8BOY', 2) + 5, bw = textW(n) + 6;
  fill(g, bx + 1, y + 2, bw - 2, 13, GEN_FARBE[n]); fill(g, bx, y + 3, bw, 11, GEN_FARBE[n]);
  drawText(g, n, bx + 3, y + 5, 0);
}

export const kindLabel = (cart) => cart.highlight && cart.license ? 'LERNSPIEL' : cart.kind === 'tutorial' ? 'LEKTION' : cart.builtin || cart.highlight ? 'SPIEL' : 'EIGENE';

export function renderBoxFront(cart, cover) {
  const { c, g } = makeCanvas(BOX_W, BOX_H);
  const accent = cart.color & 31;
  fill(g, 0, 0, BOX_W, BOX_H, 16);
  // feines Rautenmuster im Hintergrund
  g.fillStyle = PAL[17];
  for (let y = 24; y < BOX_H - 24; y += 4) for (let x = (y / 4) % 2 ? 2 : 0; x < BOX_W; x += 4) g.fillRect(x, y, 1, 1);
  // Kopfband
  fill(g, 0, 0, BOX_W, 24, 0);
  if (cart.system >= 16) {
    genHead(g, 8, 4, cart.system);
  } else {
    shadowText(g, '8BOY', 8, 4, 7, 8, 2);
    drawText(g, 'fantasy handheld', 60, 11, 30);
  }
  const tag = kindLabel(cart);
  const tw = textW(tag) + 8;
  fill(g, BOX_W - 8 - tw, 6, tw, 12, cart.highlight ? 28 : 10);
  drawText(g, tag, BOX_W - 4 - tw, 8, 0);
  fill(g, 0, 24, BOX_W, 4, accent);
  fill(g, 0, 28, BOX_W, 1, 7);
  // Bild
  fill(g, ART.x - 2, ART.y - 2, ART.w + 4, ART.h + 4, 0);
  fill(g, ART.x - 1, ART.y - 1, ART.w + 2, ART.h + 2, cart.highlight ? 28 : 30);
  if (cover) g.drawImage(cover, ...coverSrc(cover), ART.x, ART.y, ART.w, ART.h);
  else drawGeneratedArt(g, cart, ART.x, ART.y, ART.w, ART.h);
  // Titel
  let y = 202;
  const { lines, sc } = fitTitle(cart.title, BOX_W - 16, 2);
  for (const l of lines.slice(0, 3)) { shadowText(g, l, 8, y, 7, 0, sc); y += 9 * sc + 2; }
  if (cart.author) { drawText(g, 'von ' + cart.author, 8, y, accent === 16 || accent === 0 ? 29 : 30); y += 11; }
  y += 2;
  const descLines = wrap(cart.desc || '', BOX_W - 16), room = Math.max(0, Math.floor((292 - y) / 10));
  if (descLines.length > room && room > 0) {
    // gekürzt: letzte Zeile mit Auslassungspunkten statt mitten im Satz aufhören
    let last = descLines[room - 1];
    while (last && textW(last + ' …') > BOX_W - 16) last = last.replace(/\s*\S+$/, '');
    descLines[room - 1] = last + ' …';
  }
  for (const l of descLines.slice(0, room)) { drawText(g, l, 8, y, 29); y += 10; }
  // Fußband
  fill(g, 0, BOX_H - 24, BOX_W, 1, accent);
  fill(g, 0, BOX_H - 23, BOX_W, 23, 0);
  drawMiniCart(g, 8, BOX_H - 19, accent);
  drawText(g, 'LUA-KARTRIDGE', 22, BOX_H - 15, 29);
  if (cart.license) {
    const lw = textW('CC BY-SA') + 6;
    fill(g, BOX_W - 8 - lw, BOX_H - 18, lw, 12, 7);
    drawText(g, 'CC BY-SA', BOX_W - 5 - lw, BOX_H - 16, 0);
  } else drawText(g, '1 SPIELER', BOX_W - 8 - textW('1 SPIELER'), BOX_H - 15, 30);
  if (cart.highlight) { g.strokeStyle = PAL[28]; g.lineWidth = 2; g.strokeRect(1, 1, BOX_W - 2, BOX_H - 2); }
  return c;
}

function drawMiniCart(g, x, y, col) {
  fill(g, x, y, 10, 13, 5); fill(g, x + 1, y + 1, 8, 11, 6);
  fill(g, x + 2, y + 3, 6, 5, col); fill(g, x + 8, y, 2, 2, 16);
}

// Schmalseite (Buchrücken) mit senkrechtem Titel
export function renderBoxSide(cart) {
  const { c, g } = makeCanvas(BOX_D, BOX_H);
  const accent = cart.color & 31;
  fill(g, 0, 0, BOX_D, BOX_H, accent);
  fill(g, 0, 0, BOX_D, 24, 0);
  fill(g, 0, BOX_H - 24, BOX_D, 24, 0);
  shadowText(g, '8B', 8, 5, 7, 8, 2);
  g.save();
  g.translate(BOX_D / 2 + 8, 32);
  g.rotate(Math.PI / 2);
  const t = cart.title.length > 22 ? cart.title.slice(0, 21) + '…' : cart.title;
  const sc = textW(t, 2) <= BOX_H - 72 ? 2 : 1;
  const ink = [7, 10, 11, 14, 15, 19, 20, 28, 29, 31, 9, 6].includes(accent) ? 0 : 7;
  drawText(g, t, 0, 0, ink, sc);
  g.restore();
  drawMiniCart(g, 15, BOX_H - 19, accent === 6 ? 7 : 6);
  return c;
}

export function renderBoxTop(cart) {
  const { c, g } = makeCanvas(BOX_W, BOX_D);
  fill(g, 0, 0, BOX_W, BOX_D, 0);
  fill(g, 0, BOX_D - 4, BOX_W, 4, cart.color & 31);
  drawText(g, '8BOY', 8, 8, 7, 2);
  drawText(g, 'Hier öffnen', BOX_W - 8 - textW('Hier öffnen'), 14, 30);
  g.fillStyle = PAL[17];
  for (let x = 2; x < BOX_W; x += 6) g.fillRect(x, BOX_D - 7, 3, 1);
  return c;
}

export function renderBoxBack(cart, cover) {
  const { c, g } = makeCanvas(BOX_W, BOX_H);
  fill(g, 0, 0, BOX_W, BOX_H, 1);
  fill(g, 0, 0, BOX_W, 24, 0);
  shadowText(g, '8BOY', 8, 4, 7, 8, 2);
  let y = 34;
  for (const l of wrap(cart.desc || cart.title, BOX_W - 16).slice(0, 6)) { drawText(g, l, 8, y, 7); y += 10; }
  if (cover) {
    fill(g, 7, y + 5, 122, 82, 0);
    g.drawImage(cover, ...coverSrc(cover), 8, y + 6, 120, 80);
  }
  drawText(g, 'Inhalt:', 140, y + 8, 10);
  ['1 Kartridge', '1 Anleitung'].forEach((t, i) => drawText(g, '· ' + t, 140, y + 20 + i * 10, 29));
  fill(g, 0, BOX_H - 24, BOX_W, 24, 0);
  drawText(g, '8boy.yourleaf.de', 8, BOX_H - 15, 30);
  return c;
}

// ------------------------------------------------------------------ Versandbild = Packung + Hinweis
export const SHIP_SCALE = 2, SHIP_HINT = 76;
export function renderShippingImage(cart, cover) {
  const front = renderBoxFront(cart, cover);
  const S = SHIP_SCALE;
  const { c, g } = makeCanvas(BOX_W * S, BOX_H * S + SHIP_HINT * S);
  g.drawImage(front, 0, 0, BOX_W * S, BOX_H * S);
  const { c: h, g: hg } = makeCanvas(BOX_W, SHIP_HINT);
  fill(hg, 0, 0, BOX_W, SHIP_HINT, 31);
  fill(hg, 0, 0, BOX_W, 2, cart.color & 31);
  drawText(hg, 'So spielst du:', 8, 7, 1);
  drawText(hg, 'PNG-KARTRIDGE', BOX_W - 8 - textW('PNG-KARTRIDGE'), 7, 24);
  // Die Adresse groß und deutlich – ohne sie weiß der Empfänger nicht, wohin mit dem Bild
  const url = '8boy.yourleaf.de';
  const ux = (BOX_W - textW(url, 2)) >> 1;
  fill(hg, ux - 6, 18, textW(url, 2) + 12, 22, 0);
  drawText(hg, url, ux, 21, 7, 2);
  const konsole = { 16: '8BOY 16', 32: '8BOY 32', 64: '8BOY 64' }[cart.system];
  const steps = ['1. Seite im Browser öffnen',
    '2. Dieses Bild auf die Konsole ziehen',
    konsole ? `   (sie schaltet selbst auf ${konsole} um)` : ''];
  steps.forEach((t, i) => drawText(hg, t, 8, 44 + i * 10, i < 2 ? 1 : 24));
  g.drawImage(h, 0, BOX_H * S, BOX_W * S, SHIP_HINT * S);
  return c;
}
