// 8BOY Studio: Code-Editor mit Hervorhebung, Vervollständigung, Parameterhilfe,
// Kartridge-Eigenschaften und Sprite-Malprogramm. Der Lua-Code bleibt immer die einzige Wahrheit:
// Formular und Malprogramm schreiben direkt in den Text.
import { API, CONSTANTS, LUA, KEYWORDS, SNIPPETS, SFX_NAMES, sig } from './api-docs.js';
import { createPixelEditor, rowsToGrid, drawGridThumb } from './pixel-editor.js';
import { parseCart } from './carts.js';
import { DEFAULT_PALETTE } from './gfx.js';
import { createWorkshop, createTexturePreview, findModelBlock } from './model-editor.js';
import { createDebugPanel } from './debug-panel.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const KW = new Set(KEYWORDS);
const BUILTIN = new Set([...API.map((a) => a.n), ...CONSTANTS.map((c) => c[0]), 'math', 'string', 'table', 'ipairs', 'pairs', 'tostring', 'tonumber', 'type', 'coroutine', 'net']);
// Bibliotheken mit Punkt im Namen (net.join …) aus den Befehlsdaten
const API_LIBS = [...new Set(API.filter((a) => a.n.includes('.')).map((a) => a.n.split('.')[0]))];

// ------------------------------------------------------------------ Haltepunkt-Zeilen
// Welche Zeilen enthalten ausführbaren Code? Leere Zeilen, Kommentare, Sprite-Daten, „else“ und
// Funktionsköpfe werden nie „erreicht“ – ein Haltepunkt dort gilt für die nächste Code-Zeile.
function codeLineMask(code) {
  const clean = code.replace(/--\[(=*)\[[\s\S]*?\]\1\]|\[(=*)\[[\s\S]*?\]\2\]|--[^\n]*|"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'/g, (m) => {
    if (m.startsWith('--')) return m.replace(/[^\n]/g, ' ');
    if (m.startsWith('[')) return '""' + m.replace(/[^\n]/g, '');
    return '""';
  });
  return clean.split('\n').map((l) => {
    const t = l.trim();
    if (!/[\w"]/.test(t)) return false;
    if (/^(else|do|repeat)$/.test(t)) return false;
    if (/^(local\s+)?function\b[^=]*\)$/.test(t) || /^[\w.[\]"]+\s*=\s*function\s*\([^)]*\)$/.test(t)) return false;
    return true;
  });
}
function effectiveLine(mask, line) {
  for (let i = line - 1; i < mask.length; i++) if (mask[i]) return i + 1;
  return line;
}

// ------------------------------------------------------------------ Hervorhebung
const TOKEN = /(--\[(=*)\[[\s\S]*?\]\2\]|--[^\n]*)|("(?:\\.|[^"\\\n])*"?|'(?:\\.|[^'\\\n])*'?|\[(=*)\[[\s\S]*?\]\4\])|(\b0x[0-9a-fA-F]+\b|\b\d+\.?\d*(?:e[+-]?\d+)?\b)|([A-Za-z_]\w*)/g;
export function highlight(code) {
  let out = '', last = 0;
  code.replace(TOKEN, (m, com, _e1, str, _e2, num, word, idx) => {
    out += esc(code.slice(last, idx));
    last = idx + m.length;
    if (com) out += `<span class="hl-c">${esc(m)}</span>`;
    else if (str) out += `<span class="hl-s">${esc(m)}</span>`;
    else if (num) out += `<span class="hl-n">${m}</span>`;
    else if (KW.has(word)) out += `<span class="hl-k">${m}</span>`;
    else if (BUILTIN.has(word)) out += `<span class="hl-b">${m}</span>`;
    else if (code[idx + m.length] === '(') out += `<span class="hl-f">${m}</span>`;
    else out += m;
    return m;
  });
  return out + esc(code.slice(last)) + '\n';
}

// ------------------------------------------------------------------ Vorlagen
const HEAD = (title, color, icon) => `-- title: ${title}\n-- author: Ich\n-- desc: \n-- color: ${color}\n-- kind: game\n-- icon:\n${icon.split('\n').map((r) => '-- ' + r).join('\n')}\n` +
  '\n--[[anleitung\n# Worum geht es?\nErzähl hier, worum es in deinem\nSpiel geht. Das steht später im\nAnleitungsheft in der Packung.\n\n# Steuerung\n[✚] bewegen\n[A] Aktion\n]]\n';
const SMILEY = '..9999..\n.999999.\n99799799\n99999999\n99799799\n999aa999\n.999999.\n..9999..';
const HERO = '..888...\n.88888..\n..ff0...\n..ffff..\n.cc9cc..\n.ccccc..\n..c.c...\n.44.44..';

export const TEMPLATES = [
  { id: 'leer', name: 'Leere Kartridge', desc: 'Nur das Grundgerüst', code: HEAD('Neue Kartridge', 12, '..cccc..\n.c....c.\nc.c..c.c\nc......c\nc.c..c.c\nc..cc..c\n.c....c.\n..cccc..') +
`
function _init()

end

function _update()

end

function _draw()
  cls(1)
  printc("Hallo!", 76, 7)
end
` },
  { id: 'bewegen', name: 'Figur bewegen', desc: 'Sprite mit dem Steuerkreuz steuern', code: HEAD('Meine Kartridge', 9, SMILEY) +
`
sprite(1, [[
${SMILEY}
]])

x, y = 116, 76

function _update()
  if btn(LEFT) then x = x - 1 end
  if btn(RIGHT) then x = x + 1 end
  if btn(UP) then y = y - 1 end
  if btn(DOWN) then y = y + 1 end
  if btnp(A) then sfx("jump") end
end

function _draw()
  cls(1)
  printc("Hallo 8BOY!", 20, 10, 2)
  spr(1, x, y)
end
` },
  { id: 'jump', name: 'Jump\'n\'Run-Grundlage', desc: 'Schwerkraft, Sprung, Level aus Text', code: HEAD('Mein Jump\'n\'Run', 8, HERO) +
`
sprite(1, [[
${HERO}
]])
sprite(2, [[
bbbbbbbb
b3bbb3bb
44444444
4f44444f
44444444
44444f44
44444444
4f44444f
]])
fset(2, 0, true)   -- Kachel 2 ist fest

LEVEL = {
  "..............................",
  "..............................",
  "..............................",
  "..............................",
  "..............................",
  "..............................",
  "..............................",
  "..............................",
  "....................####......",
  "..............................",
  "............####..............",
  "..............................",
  "......####....................",
  "..............................",
  "..............................",
  "..............................",
  "..............................",
  "##########....################",
  "##########....################",
}
for y, row in ipairs(LEVEL) do
  for x = 1, #row do
    if row:sub(x, x) == "#" then mset(x - 1, y, 2) end
  end
end

function solid(x, y) return fget(mget(x // 8, y // 8), 0) end

function _init()
  pl = { x = 16, y = 100, vy = 0, ground = false, left = false }
end

function _update()
  local dx = 0
  if btn(LEFT) then dx = -1.5; pl.left = true end
  if btn(RIGHT) then dx = 1.5; pl.left = false end
  local nx = pl.x + dx
  if not solid(nx, pl.y) and not solid(nx + 7, pl.y) and not solid(nx, pl.y + 7) and not solid(nx + 7, pl.y + 7) then
    pl.x = clamp(nx, 0, SCREEN_W - 8)
  end
  if btnp(A) and pl.ground then pl.vy = -4.5; sfx("jump") end
  pl.vy = min(pl.vy + 0.25, 5)
  local ny = pl.y + pl.vy
  pl.ground = false
  if pl.vy > 0 and (solid(pl.x + 1, ny + 8) or solid(pl.x + 6, ny + 8)) then
    pl.y = (ny + 8) // 8 * 8 - 8; pl.vy = 0; pl.ground = true
  elseif pl.vy < 0 and (solid(pl.x + 1, ny) or solid(pl.x + 6, ny)) then
    pl.vy = 0
  else
    pl.y = ny
  end
  if pl.y > SCREEN_H then sfx("hit"); _init() end
end

function _draw()
  cls(12)
  map()
  spr(1, pl.x, pl.y, pl.left)
end
` },
  { id: 'lektion', name: 'Eigene Lektion', desc: 'Seiten mit Erklärtext, MENÜ/OPTION blättern', code: HEAD('Meine Lektion', 13, '.777777.\n7......7\n7.7777.7\n7......7\n7.777..7\n7......7\n.777777.\n........').replace('kind: game', 'kind: tutorial') +
`
pages = {}
page = 1

pages[1] = {
  title = "Erste Seite",
  text = "Hier steht die Erklärung.\\nBis zu 6 Zeilen mit 38 Zeichen.\\nMENÜ: weiter   OPTION: zurück",
  update = function() end,
  draw = function()
    cls(1)
    circfill(120, 50, 10 + sin(t() * 3) * 4, 10)
  end,
}

pages[2] = {
  title = "Zweite Seite",
  text = "Jede Seite hat update und draw.",
  draw = function() cls(3) end,
}

function _update()
  if btnp(MENU) and page < #pages then page = page + 1; sfx("select") end
  if btnp(OPTION) and page > 1 then page = page - 1; sfx("back") end
  if pages[page].update then pages[page].update() end
end

function _draw()
  pages[page].draw()
  rectfill(0, 0, SCREEN_W, 11, 1)
  print(pages[page].title, 4, 2, 10)
  print(page .. "/" .. #pages, SCREEN_W - 26, 2, 6)
  rectfill(0, 99, SCREEN_W, 61, 16)
  print(pages[page].text, 6, 103, 7)
end
` },
  { id: 'super', name: '8BOY 16: Perspektivboden', desc: 'Über einen drehbaren Boden fahren (system: 16)', code: HEAD('Mein Super-Spiel', 12, HERO).replace('-- kind: game', '-- kind: game\n-- system: 16') +
`
-- Kacheln für den Boden
sprite(1, [[
bbbbbbbb
bnbbbbbb
bbbbbnbb
bbbbbbbb
bbnbbbbb
bbbbbbnb
bbbbbbbb
bbbnbbbb
]])
sprite(2, [[
55555555
55555555
55777755
55777755
55777755
55777755
55555555
55555555
]])
sprite(3, [[
${HERO}
]])

function _init()
  for y = 0, 127 do
    for x = 0, 255 do
      mset(x, y, (x % 16 == 0 or y % 16 == 0) and 2 or 1)
    end
  end
  pl = { x = 1024, y = 512, a = 0, v = 0 }
end

function _update()
  if btn(LEFT) then pl.a = pl.a - 0.04 end
  if btn(RIGHT) then pl.a = pl.a + 0.04 end
  if btn(A) then pl.v = min(3, pl.v + 0.05) else pl.v = pl.v * 0.97 end
  pl.x = pl.x + cos(pl.a) * pl.v
  pl.y = pl.y + sin(pl.a) * pl.v
end

function _draw()
  cls(0)
  backdrop(0, 70, 0x2a6fdb, 0xcdeeff)   -- Himmel als Verlauf
  perspektive(pl.x - cos(pl.a) * 30, pl.y - sin(pl.a) * 30, pl.a, 1, 70)
  local sx, sy, k = m7pos(pl.x, pl.y)
  if sx then rspr(3, sx, sy - 8, 0, 2) end
  print("A Gas  ←→ lenken", 4, 4, 7)
end
` },
  { id: 'mega', name: '8BOY 32: 3D-Würfel', desc: 'Ein Würfel dreht sich in 3D (system: 32)', code: HEAD('Mein 3D-Spiel', 7, '..7777..\n.7....7.\n777777.7\n7....7.7\n7....7.7\n7....77.\n777777..\n........').replace('-- kind: game', '-- kind: game\n-- system: 32') +
`
-- Ein Würfel (Modell 0) und ein Boden (Modell 1)
model(0, "wuerfel", 12)
model(1, "ebene", 11)

function _init()
  gier, nick = 0, 0
end

function _update()
  if btn(LEFT) then gier = gier - 0.04 end
  if btn(RIGHT) then gier = gier + 0.04 end
  if btn(UP) then nick = nick - 0.04 end
  if btn(DOWN) then nick = nick + 0.04 end
end

function _draw()
  cls(0)                          -- Farbe 0: hier scheint die 3D-Welt durch
  cls3d(0x1c2a6a, 0x9fd8ff)       -- Himmel als Verlauf
  cam3d(0, 1.5, -5, 0, -0.2)      -- Kamera etwas oben, Blick leicht nach unten
  draw3d(1, 0, 0, 0, 0, 0, 0, 20) -- großer Boden
  draw3d(0, 0, 1, 0, gier, nick, 0, 1.5)
  print("←→↑↓ drehen  Dreiecke: " .. tris3d(), 4, 4, 7)
end
` },
  { id: 'ultra', name: '8BOY 64: Lampen auf der GPU', desc: 'Würfelfeld mit zwei bunten Lampen, gerechnet von der Grafikkarte (system: 64)', code: HEAD('Meine GPU-Welt', 19, '..cccc..\n.c....c.\nc.c..c.c\nc......c\nc.c..c.c\nc..cc..c\n.c....c.\n..cccc..').replace('-- kind: game', '-- kind: game\n-- system: 64') +
`
-- Ein Würfel (Modell 0) und ein Boden (Modell 1) – diesmal rechnet die Grafikkarte
model(0, "wuerfel", 7)
model(1, "ebene", 5)

function _init()
  gier = 0
end

function _update()
  if btn(LEFT) then gier = gier - 0.03 end
  if btn(RIGHT) then gier = gier + 0.03 end
end

function _draw()
  cls(0)
  cls3d(0x05060f, 0x1b1240)
  cam3d(sin(gier) * -12, 4, cos(gier) * -12, gier, -0.3)
  light3d(-0.3, -1, 0.2, 0.15)     -- wenig Grundlicht, damit die Lampen wirken
  lamp3d(0, sin(t()) * 5, 1, cos(t()) * 5, 0x2ce8f5, 7)   -- Lampe 0: türkis, Reichweite 7
  lamp3d(1, -sin(t()) * 5, 1, -cos(t()) * 5, 0xff5a8e, 7) -- Lampe 1: pink
  draw3d(1, 0, 0, 0, 0, 0, 0, 30)
  for x = -5, 5 do
    for z = -5, 5 do
      draw3d(0, x * 1.6, 0.5, z * 1.6, 0, 0, 0, 0.8)
    end
  end
  local aufrufe, dreiecke = stats3d()
  print("←→ drehen  " .. aufrufe .. " Aufrufe · " .. dreiecke .. " Dreiecke", 8, 8, 7, 2)
end
` },
];
export const TEMPLATE = TEMPLATES[1].code;

// ------------------------------------------------------------------ Kopfzeilen lesen/schreiben
const META_LINE = /^--\s*(title|author|desc|color|kind|system|icon)\s*:/i;
const ICON_ROW = /^--\s*[.0-9a-v]{4,32}\s*$/i;

// Der Kopfblock = Kommentarzeilen ganz oben bis zur ersten Leerzeile
function headerRange(code) {
  const lines = code.split('\n');
  let end = 0, n = 0;
  while (n < lines.length && /^\s*--/.test(lines[n])) { end += lines[n].length + 1; n++; }
  return { end: Math.min(end, code.length), lines: lines.slice(0, n) };
}
function buildHeader(meta, otherLines) {
  const out = [`-- title: ${meta.title}`, `-- author: ${meta.author}`, `-- desc: ${meta.desc}`, `-- color: ${meta.color}`, `-- kind: ${meta.kind}`];
  if (meta.system >= 16) out.push('-- system: ' + (meta.system >= 64 ? 64 : meta.system >= 32 ? 32 : 16));
  if (meta.icon) { out.push('-- icon:'); meta.icon.split('\n').forEach((r) => out.push('-- ' + r)); }
  return [...out, ...otherLines].join('\n') + '\n';
}

// ------------------------------------------------------------------ Editor
export function createEditor({ onRun, onSave, onNew, cartPreview, onLive = () => {}, onDebug = () => {}, onBreakpoints = () => {}, onWatches = () => {} }) {
  const text = $('edText'), hl = $('edHl'), gutter = $('edGutter'), log = $('edLog'), area = text.parentElement;
  const ac = $('edAc'), sigBox = $('edSig');
  let errorLine = null;
  let bps = new Set();     // Haltepunkte (Zeilennummern, wie angezeigt)
  let halt = null;         // Haltestelle vom Debugger oder null
  let prevValue = '';
  let charW = 8, lineH = 20;

  function measure() {
    const cs = getComputedStyle(text);
    const probe = document.createElement('span');
    probe.style.cssText = `position:absolute;visibility:hidden;white-space:pre;font:${cs.font}`;
    probe.textContent = 'M'.repeat(40);
    document.body.appendChild(probe);
    charW = probe.getBoundingClientRect().width / 40 || 8;
    probe.remove();
    lineH = parseFloat(cs.lineHeight) || 20;
  }

  function render() {
    let html = highlight(text.value);
    const n = text.value.split('\n').length;
    const cur = halt?.line && halt.line <= n ? halt.line : null;
    if (cur) {
      // aktuelle Zeile: Leiste hinter der Zeile, Werte der Variablen ans Zeilenende
      const inline = inlineValues(cur);
      if (inline) {
        let k = -1;
        for (let i = 1; i < cur; i++) k = html.indexOf('\n', k + 1);
        const end = html.indexOf('\n', k + 1);
        html = html.slice(0, end) + `<span class="hl-inline">  ${esc(inline)}</span>` + html.slice(end);
      }
      html += `<div class="hl-curline" style="top:${padTop() + (cur - 1) * lineH}px;height:${lineH}px"></div>`;
    }
    hl.innerHTML = html;
    let g = '';
    for (let i = 1; i <= n; i++) {
      const cls = [i === errorLine && 'err', bps.has(i) && 'bp', i === cur && 'cur'].filter(Boolean).join(' ');
      g += (cls ? `<span class="${cls}">${i}</span>` : i) + '\n';
    }
    gutter.innerHTML = g;
    sync();
  }
  const padTop = () => parseFloat(getComputedStyle(text).paddingTop) || 12;
  // „x = 120  dx = 1.5“ für die Namen in der angehaltenen Zeile
  function inlineValues(line) {
    const fr = halt.frames[0];
    if (!fr) return '';
    const src = (text.value.split('\n')[line - 1] || '').replace(/--.*$/, '').replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g, '""');
    const find = (name) => fr.locals.find((v) => v.name === name) || fr.ups.find((v) => v.name === name) || halt.globals.find((v) => v.name === name);
    const out = [], seen = new Set();
    for (const m of src.matchAll(/[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)?/g)) {
      const [base, field] = m[0].split('.');
      if (KW.has(base) || seen.has(m[0])) continue;
      const v = find(base);
      if (!v) continue;
      let val = v.v;
      if (field) { const kid = v.kids?.find((k) => k.k === field); if (!kid) continue; val = kid.v; }
      seen.add(m[0]);
      out.push(`${m[0]} = ${val.length > 28 ? val.slice(0, 27) + '…' : val}`);
      if (out.length >= 5) break;
    }
    return out.join('   ');
  }
  function sync() { hl.scrollTop = text.scrollTop; hl.scrollLeft = text.scrollLeft; gutter.scrollTop = text.scrollTop; }

  // ---------------------------------------------------------------- eigene Namen im Code
  let userNames = { vars: new Set(), fns: new Map(), fields: new Set() };
  function scanNames() {
    const code = text.value.replace(/--\[(=*)\[[\s\S]*?\]\1\]|--[^\n]*/g, '').replace(/\[(=*)\[[\s\S]*?\]\1\]|"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'/g, '""');
    const vars = new Set(), fns = new Map(), fields = new Set();
    for (const m of code.matchAll(/function\s+([A-Za-z_][\w.:]*)\s*\(([^)]*)\)/g)) fns.set(m[1].replace(':', '.'), m[2].split(',').map((s) => s.trim()).filter(Boolean));
    for (const m of code.matchAll(/(?:^|[^\w.])([A-Za-z_]\w*(?:\s*,\s*[A-Za-z_]\w*)*)\s*=(?!=)/gm)) m[1].split(',').forEach((v) => vars.add(v.trim()));
    for (const m of code.matchAll(/local\s+([A-Za-z_][\w\s,]*?)\s*(?:=|\n|$)/g)) m[1].split(',').forEach((v) => vars.add(v.trim()));
    for (const m of code.matchAll(/for\s+([\w\s,]+?)\s+(?:=|in)/g)) m[1].split(',').forEach((v) => vars.add(v.trim()));
    for (const m of code.matchAll(/function\s*[\w.:]*\s*\(([^)]*)\)/g)) m[1].split(',').forEach((v) => v.trim() && v.trim() !== '...' && vars.add(v.trim()));
    for (const m of code.matchAll(/\.([A-Za-z_]\w*)/g)) fields.add(m[1]);
    for (const m of code.matchAll(/[{,]\s*([A-Za-z_]\w*)\s*=(?!=)/g)) fields.add(m[1]);
    [...KW, ...BUILTIN].forEach((k) => vars.delete(k));
    fns.forEach((_, k) => vars.delete(k));
    vars.delete('');
    userNames = { vars, fns, fields };
  }

  // ---------------------------------------------------------------- Vorschläge
  const lineBefore = () => { const v = text.value, p = text.selectionStart; return v.slice(v.lastIndexOf('\n', p - 1) + 1, p); };

  function inCommentOrString(line) {
    let q = null;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (q) { if (c === '\\') i++; else if (c === q) q = null; continue; }
      if (c === '"' || c === "'") q = c;
      else if (c === '-' && line[i + 1] === '-') return 'comment';
    }
    return q ? 'string' : null;
  }

  function candidates(force) {
    const line = lineBefore();
    const ctx = inCommentOrString(line);
    if (ctx === 'comment') return null;
    if (ctx === 'string') {
      const m = /sfx\(\s*["']([a-z]*)$/.exec(line);
      if (!m) return null;
      return { prefix: m[1], items: SFX_NAMES.filter((s) => s.startsWith(m[1])).map((s) => ({ label: s, kind: 'sfx', detail: 'Soundeffekt', insert: s })) };
    }
    const m = /([A-Za-z_][\w]*)?(\.)?([A-Za-z_]\w*)?$/.exec(line);
    const whole = /([A-Za-z_]\w*\.)?([A-Za-z_]\w*)?$/.exec(line);
    const obj = whole[1] ? whole[1].slice(0, -1) : null;
    const prefix = whole[2] || '';
    if (!force && !prefix && !obj) return null;
    if (/\d$/.test(line) && !prefix) return null;
    let items = [];
    if (obj) {
      const lib = LUA.filter((l) => l.n.startsWith(obj + '.'));
      const apiLib = API.filter((a) => a.n.startsWith(obj + '.'));
      if (apiLib.length) items = apiLib.map((a) => ({ label: a.n.slice(obj.length + 1), kind: 'fn', detail: sig(a), doc: a.d, params: a.p }));
      else if (lib.length) items = lib.map((l) => ({ label: l.n.slice(obj.length + 1), kind: l.p ? 'fn' : 'const', detail: `${l.n}(${(l.p || []).join(', ')})`, params: l.p }));
      else items = [...userNames.fields].map((f) => ({ label: f, kind: 'var', detail: 'Feld' }));
    } else {
      items = [
        ...API.filter((a) => !a.n.includes('.')).map((a) => ({ label: a.n, kind: a.snippet && a.n.startsWith('_') ? 'snip' : 'fn', detail: sig(a), doc: a.d, params: a.p, snippet: a.n.startsWith('_') ? a.snippet : null })),
        ...API_LIBS.map((l) => ({ label: l, kind: 'mod', detail: l === 'net' ? 'Mehrspieler-Befehle' : 'Befehle', insert: l + '.' })),
        ...SNIPPETS.map((s) => ({ label: s.n, kind: 'snip', detail: s.d, snippet: s.s })),
        ...CONSTANTS.map(([c, d]) => ({ label: c, kind: 'const', detail: d })),
        ...KEYWORDS.map((k) => ({ label: k, kind: 'kw', detail: 'Lua' })),
        ...LUA.filter((l) => !l.n.includes('.')).map((l) => ({ label: l.n, kind: 'fn', detail: `${l.n}(${l.p.join(', ')})`, params: l.p })),
        ...['math', 'string', 'table', 'coroutine'].map((l) => ({ label: l, kind: 'mod', detail: 'Lua-Bibliothek', insert: l + '.' })),
        ...[...userNames.fns].map(([n, p]) => ({ label: n, kind: 'user', detail: `${n}(${p.join(', ')}) – deine Funktion`, params: p })),
        ...[...userNames.vars].map((v) => ({ label: v, kind: 'var', detail: 'deine Variable' })),
      ];
    }
    const lp = prefix.toLowerCase();
    const seen = new Set();
    const scored = [];
    for (const it of items) {
      if (seen.has(it.kind + it.label)) continue;
      seen.add(it.kind + it.label);
      const l = it.label.toLowerCase();
      let score;
      if (!lp) score = 1;
      else if (l.startsWith(lp)) score = 3 - (it.kind === 'kw' ? 0.5 : 0) + (it.kind === 'fn' || it.kind === 'user' ? 0.3 : 0);
      else if (l.includes(lp) && lp.length > 1) score = 1;
      else continue;
      if (it.label === prefix && it.kind !== 'snip' && !it.snippet) continue; // schon fertig getippt
      scored.push({ ...it, score });
    }
    scored.sort((a, b) => b.score - a.score || a.label.length - b.label.length || a.label.localeCompare(b.label));
    return { prefix, items: scored.slice(0, 40) };
  }

  let acState = null; // { prefix, items, sel }
  const ICON = { fn: 'ƒ', user: 'ƒ', snip: '⌘', const: 'C', kw: 'K', var: 'v', mod: 'M', sfx: '♪' };

  function caretXY() {
    const v = text.value, p = text.selectionStart;
    const before = v.slice(0, p);
    const line = before.split('\n').length - 1;
    const col = p - before.lastIndexOf('\n') - 1;
    const cs = getComputedStyle(text);
    return {
      x: parseFloat(cs.paddingLeft) + col * charW - text.scrollLeft,
      y: parseFloat(cs.paddingTop) + line * lineH - text.scrollTop,
    };
  }

  function showAc(res) {
    if (!res || !res.items.length) return hideAc();
    acState = { ...res, sel: 0 };
    drawAc();
  }
  function drawAc() {
    const { items, sel, prefix } = acState;
    ac.innerHTML = items.map((it, i) => {
      const l = it.label;
      const k = l.toLowerCase().indexOf(prefix.toLowerCase());
      const label = prefix && k >= 0 ? esc(l.slice(0, k)) + '<b>' + esc(l.slice(k, k + prefix.length)) + '</b>' + esc(l.slice(k + prefix.length)) : esc(l);
      return `<div class="ac-item${i === sel ? ' on' : ''}" data-i="${i}"><span class="ac-ic ac-${it.kind}">${ICON[it.kind] || '·'}</span><span class="ac-l">${label}</span><span class="ac-d">${esc(it.detail || '')}</span></div>`;
    }).join('') + (items[sel]?.doc ? `<div class="ac-doc">${esc(items[sel].doc)}</div>` : '');
    const { x, y } = caretXY();
    ac.hidden = false;
    const aw = area.clientWidth, ah = area.clientHeight;
    const w = Math.min(380, aw - 8);
    ac.style.width = w + 'px';
    ac.style.left = Math.max(4, Math.min(x - prefix.length * charW, aw - w - 4)) + 'px';
    const below = y + lineH + 2;
    const hgt = ac.offsetHeight;
    ac.style.top = (below + hgt > ah && y - hgt > 0 ? y - hgt - 2 : below) + 'px';
    ac.querySelector('.ac-item.on')?.scrollIntoView({ block: 'nearest' });
  }
  function hideAc() { acState = null; ac.hidden = true; }

  function insertAt(start, end, str) {
    text.focus();
    text.setSelectionRange(start, end);
    if (!document.execCommand('insertText', false, str)) text.setRangeText(str, start, end, 'end');
  }

  function accept(it) {
    const p = text.selectionStart;
    const start = p - acState.prefix.length;
    const v = text.value;
    const indent = /(^|\n)([ \t]*)[^\n]*$/.exec(v.slice(0, start))[2];
    let ins, caret;
    if (it.snippet) {
      ins = it.snippet.split('\n').map((l, i) => (i ? indent + l : l)).join('\n');
      caret = ins.indexOf('$');
      ins = ins.replace('$', '');
    } else if ((it.kind === 'fn' || it.kind === 'user') && v[p] !== '(') {
      ins = it.label + '()';
      caret = it.params && it.params.length ? ins.length - 1 : ins.length;
    } else {
      ins = it.insert ?? it.label;
      caret = ins.length;
    }
    hideAc();
    insertAt(start, p, ins);
    const c = start + (caret < 0 ? ins.length : caret);
    text.setSelectionRange(c, c);
    afterChange();
    updateSig();
    if (it.kind === 'mod') showAc(candidates(true));
  }

  ac.addEventListener('mousedown', (e) => {
    const el = e.target.closest('.ac-item');
    if (!el) return;
    e.preventDefault();
    accept(acState.items[+el.dataset.i]);
  });

  // ---------------------------------------------------------------- Parameterhilfe
  function findCall() {
    const v = text.value, p = text.selectionStart;
    let depth = 0, commas = 0;
    for (let i = p - 1, n = 0; i >= 0 && n < 400; i--, n++) {
      const c = v[i];
      if (c === '\n' && depth === 0 && n > 200) break;
      if (c === ')') depth++;
      else if (c === '(') {
        if (depth === 0) {
          const m = /([A-Za-z_][\w.]*)\s*$/.exec(v.slice(Math.max(0, i - 40), i));
          return m ? { name: m[1], arg: commas } : null;
        }
        depth--;
      } else if (c === ',' && depth === 0) commas++;
    }
    return null;
  }
  function lookup(name) {
    const a = API.find((x) => x.n === name);
    if (a) return { name, params: a.p, doc: a.d, r: a.r };
    const l = LUA.find((x) => x.n === name);
    if (l && l.p) return { name, params: l.p };
    if (userNames.fns.has(name)) return { name, params: userNames.fns.get(name), doc: 'deine Funktion' };
    return null;
  }
  function updateSig() {
    if (document.activeElement !== text) { sigBox.hidden = true; return; }
    const call = findCall();
    const info = call && lookup(call.name);
    if (!info || !info.params.length) { sigBox.hidden = true; return; }
    const ps = info.params.map((p, i) => (i === Math.min(call.arg, info.params.length - 1) ? `<b>${esc(p)}</b>` : esc(p))).join(', ');
    sigBox.innerHTML = `<code>${esc(info.name)}(${ps})${info.r ? ' → ' + esc(info.r) : ''}</code>${info.doc ? `<span>${esc(info.doc)}</span>` : ''}`;
    sigBox.hidden = false;
    const { x, y } = caretXY();
    const w = sigBox.offsetWidth;
    sigBox.style.left = Math.max(4, Math.min(x - 20, area.clientWidth - w - 4)) + 'px';
    sigBox.style.top = (y - sigBox.offsetHeight - 4 > 0 ? y - sigBox.offsetHeight - 4 : y + lineH + 4) + 'px';
    if (!ac.hidden && sigBox.offsetTop > ac.offsetTop) sigBox.hidden = true;
  }

  // ---------------------------------------------------------------- Eingabe
  let scanTimer = null;
  let panelTimer = null;
  let liveTimer = null;
  function afterChange() {
    errorLine = null;
    shiftBreakpoints(prevValue, text.value);
    prevValue = text.value;
    render();
    clearTimeout(liveTimer);
    if (autoLive) liveTimer = setTimeout(() => onLive(text.value, { auto: true }), 900);
    clearTimeout(scanTimer);
    scanTimer = setTimeout(scanNames, 300);
    clearTimeout(panelTimer);
    panelTimer = setTimeout(refreshPanels, 500);
  }

  text.addEventListener('input', (e) => {
    afterChange();
    const typed = e.inputType === 'insertText' && e.data && /[\w.]$/.test(e.data);
    const deleting = e.inputType === 'deleteContentBackward' && acState;
    if (typed || deleting) showAc(candidates(false)); else hideAc();
    updateSig();
  });
  text.addEventListener('scroll', () => { sync(); hideAc(); sigBox.hidden = true; });
  text.addEventListener('click', () => { hideAc(); updateSig(); });
  text.addEventListener('blur', () => setTimeout(() => { if (document.activeElement !== text) { hideAc(); sigBox.hidden = true; } }, 150));
  text.addEventListener('keyup', (e) => { if (e.key.startsWith('Arrow') && !acState) updateSig(); });
  text.addEventListener('keydown', (e) => {
    if (acState) {
      if (e.key === 'ArrowDown') { e.preventDefault(); acState.sel = (acState.sel + 1) % acState.items.length; drawAc(); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); acState.sel = (acState.sel + acState.items.length - 1) % acState.items.length; drawAc(); return; }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); accept(acState.items[acState.sel]); return; }
      if (e.key === 'Escape') { e.preventDefault(); hideAc(); return; }
    }
    if (e.key === ' ' && e.ctrlKey) { e.preventDefault(); scanNames(); showAc(candidates(true)); return; }
    if (e.key === 'Escape') { sigBox.hidden = true; return; }
    if (e.key === 'Tab') {
      e.preventDefault();
      document.execCommand('insertText', false, '  ');
    } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault(); onRun(text.value);
    } else if (e.key === 's' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault(); onSave(text.value);
    } else if (e.key === 'Enter') {
      // Einrückung übernehmen, nach "then/do/function(...)" eine Stufe tiefer
      const before = text.value.slice(0, text.selectionStart);
      const cur = before.slice(before.lastIndexOf('\n') + 1);
      let indent = /^[ \t]*/.exec(cur)[0];
      if (/(\bthen|\bdo|\bfunction\b.*\)|\belse|\brepeat|[{(])\s*$/.test(cur) && !/\bend\s*$/.test(cur)) indent += '  ';
      e.preventDefault();
      document.execCommand('insertText', false, '\n' + indent);
    }
  });
  window.addEventListener('resize', () => { measure(); hideAc(); render(); });

  // ---------------------------------------------------------------- Haltepunkte
  // Zeilen eingefügt oder gelöscht: Haltepunkte wandern mit ihrer Zeile
  function shiftBreakpoints(a, b) {
    if (!bps.size || a === b) return;
    const delta = b.split('\n').length - a.split('\n').length;
    if (!delta) return;
    let p = 0;
    const lim = Math.min(a.length, b.length);
    while (p < lim && a[p] === b[p]) p++;
    let s = 0;
    while (s < lim - p && a[a.length - 1 - s] === b[b.length - 1 - s]) s++;
    const oldEnd = a.length - s;
    const lines = a.split('\n');
    const n = b.split('\n').length;
    const next = new Set();
    let off = 0;
    for (let i = 1; i <= lines.length; i++) {
      if (bps.has(i)) {
        let nl = i;
        if (off >= oldEnd) nl = i + delta;
        else if (off + lines[i - 1].length >= p && delta < 0) nl = Math.min(i, lineOfIn(b, p));
        if (nl >= 1 && nl <= n) next.add(nl);
      }
      off += lines[i - 1].length + 1;
    }
    bps = next;
    bpsChanged();
  }
  const lineOfIn = (v, pos) => v.slice(0, pos).split('\n').length;
  function toggleBreakpoint(line) {
    const n = text.value.split('\n').length;
    if (line < 1 || line > n) return;
    if (bps.has(line)) bps.delete(line); else bps.add(line);
    bpsChanged();
    render();
  }
  // an den Debugger: Zeilen ohne Code zählen für die nächste Code-Zeile
  function effectiveBreakpoints() {
    if (!bps.size) return [];
    const mask = codeLineMask(text.value);
    return [...new Set([...bps].map((l) => effectiveLine(mask, l)))];
  }
  let bpTimer = null;
  function bpsChanged() {
    const lines = text.value.split('\n');
    panel.setBreakpoints([...bps].sort((x, y) => x - y).map((l) => ({ line: l, text: lines[l - 1] || '' })));
    clearTimeout(bpTimer);
    bpTimer = setTimeout(() => onBreakpoints(effectiveBreakpoints()), 0);
  }
  gutter.title = 'Klick auf eine Zeilennummer: Haltepunkt setzen oder entfernen';
  gutter.addEventListener('click', (e) => {
    const r = gutter.getBoundingClientRect();
    const y = e.clientY - r.top - padTop() + gutter.scrollTop;
    toggleBreakpoint(Math.floor(y / lineH) + 1);
  });
  // F9 Haltepunkt · F8 Weiter/Anhalten · F10 Schritt · F6 Nächstes Bild – überall im Studio
  $('editor').addEventListener('keydown', (e) => {
    if (e.key === 'F9') { e.preventDefault(); toggleBreakpoint(lineOf(text.selectionStart)); }
    else if (e.key === 'F8') { e.preventDefault(); onDebug(halt ? 'resume' : 'pause'); }
    else if (e.key === 'F10') { e.preventDefault(); onDebug('step'); }
    else if (e.key === 'F6') { e.preventDefault(); onDebug('frame'); }
    // Strg+S auch außerhalb des Textfelds (z.B. nach einem Klick in die Seitenleiste)
    else if (e.key === 's' && (e.ctrlKey || e.metaKey) && e.target !== text) { e.preventDefault(); onSave(text.value); }
  });

  // ---------------------------------------------------------------- Leiste am Haltepunkt
  const dbgBar = $('edDbg');
  dbgBar.addEventListener('click', (e) => {
    const b = e.target.closest('[data-cmd]');
    if (!b) return;
    if (b.dataset.cmd === 'vars') showTab('debug', true);
    else onDebug(b.dataset.cmd);
  });
  function drawBar() {
    dbgBar.hidden = !halt;
    if (!halt) return;
    const where = halt.line ? `Zeile ${halt.line} · ${halt.fn}` : 'Bild fertig';
    $('edDbgWhere').innerHTML = `<b>⏸ ${esc(halt.reason === 'Bild' ? 'Angehalten' : halt.reason)}</b> <span>${esc(where)}</span>`;
  }

  // Zeichenleiste für Bildschirmtastaturen: Klammern & Co. liegen dort tief in Untermenüs
  const KEYS = ['⇥', '◀', '▶', '(', ')', '"', '=', ',', '.', ':', '[', ']', '{', '}', '+', '-', '*', '/', '<', '>', '~', '#', '_', 'end', '↶'];
  const keys = $('edKeys');
  keys.innerHTML = KEYS.map((k, i) => `<button type="button" tabindex="-1" data-i="${i}"${/[◀▶↶⇥]/.test(k) ? ' class="k-nav"' : ''}>${esc(k)}</button>`).join('');
  // Fokus bleibt im Code, sonst klappt die Tastatur bei jedem Zeichen zu
  keys.addEventListener('pointerdown', (e) => e.preventDefault());
  keys.addEventListener('mousedown', (e) => e.preventDefault());
  keys.addEventListener('click', (e) => {
    const k = KEYS[e.target.closest('button')?.dataset.i];
    if (!k) return;
    const s = text.selectionStart, en = text.selectionEnd;
    if (k === '◀' || k === '▶') {
      const p = k === '◀' ? Math.max(0, s - 1) : Math.min(text.value.length, en + 1);
      text.focus(); text.setSelectionRange(p, p); hideAc(); updateSig();
    } else if (k === '↶') { text.focus(); document.execCommand('undo'); }
    else insertAt(s, en, k === '⇥' ? '  ' : k);
  });

  function gotoLine(n, focus = true) {
    const lines = text.value.split('\n');
    let pos = 0;
    for (let i = 0; i < n - 1 && i < lines.length; i++) pos += lines[i].length + 1;
    if (focus) text.focus();
    text.setSelectionRange(pos, pos + (lines[n - 1]?.length ?? 0));
    text.scrollTop = Math.max(0, (n - 5) * lineH);
    sync();
  }
  const lineOf = (pos) => text.value.slice(0, pos).split('\n').length;

  function print(msg, cls = '') {
    const div = document.createElement('div');
    if (cls) div.className = cls;
    div.textContent = msg;
    const m = /Zeile (\d+)/.exec(msg);
    if (m) div.addEventListener('click', () => gotoLine(+m[1]));
    log.appendChild(div);
    while (log.childNodes.length > 200) log.firstChild.remove();
    log.scrollTop = log.scrollHeight;
  }

  // Text ersetzen, ohne den Fokus zu holen (sonst springt auf dem Handy die Tastatur auf)
  function replaceRange(start, end, str) {
    const st = text.scrollTop, a = text.selectionStart, b = text.selectionEnd;
    text.value = text.value.slice(0, start) + str + text.value.slice(end);
    const d = str.length - (end - start);
    const fix = (p) => (p >= end ? p + d : p);
    text.setSelectionRange(fix(a), fix(b));
    text.scrollTop = st;
    afterChange();
  }

  // ---------------------------------------------------------------- Seitenleiste
  const side = $('edSide');
  const tabs = side.querySelectorAll('[data-tab]');
  function showTab(name, force = false) {
    const open = force || !(side.dataset.open === name && !side.hidden);
    side.hidden = !open;
    side.dataset.open = open ? name : '';
    tabs.forEach((t) => t.classList.toggle('on', t.dataset.tab === name));
    side.querySelectorAll('[data-pane]').forEach((p) => { p.hidden = p.dataset.pane !== name; });
    document.querySelectorAll('[data-side]').forEach((b) => b.classList.toggle('on', open && b.dataset.side === name));
    if (open) refreshPanels(true);
  }
  function closeSide() { side.hidden = true; side.dataset.open = ''; document.querySelectorAll('[data-side]').forEach((b) => b.classList.remove('on')); }
  // am Handy liegt die Seitenleiste über dem Code – nach dem Einfügen den Code zeigen
  const overlaySide = () => matchMedia('(max-width: 760px)').matches;
  tabs.forEach((t) => t.addEventListener('click', () => showTab(t.dataset.tab)));
  document.querySelectorAll('[data-side]').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.side)));
  $('edSideClose').addEventListener('click', closeSide);

  // Befehle: aus den API-Daten erzeugt, Klick fügt ein
  const groups = [...new Set(API.map((a) => a.g))];
  $('edHelpPanel').innerHTML = `
    <p class="side-note"><span class="for-mouse"><kbd>Strg</kbd>+<kbd>Leertaste</kbd> zeigt Vorschläge, <kbd>Tab</kbd>/<kbd>Enter</kbd> übernimmt, <kbd>Strg</kbd>+<kbd>Enter</kbd> startet, <kbd>Strg</kbd>+<kbd>S</kbd> speichert. Klick auf einen Befehl fügt ihn ein.</span><span class="for-touch">Antippen fügt einen Befehl an der Schreibmarke ein. Klammern, Anführungszeichen und Co. liegen in der Leiste über der Tastatur.</span></p>` +
    `<h4>Fehlersuche &amp; Live</h4><dl class="tips">
      <dt>● Haltepunkt</dt><dd><span class="for-mouse">Klick auf eine Zeilennummer oder <kbd>F9</kbd>.</span><span class="for-touch">Zeilennummer antippen.</span> Kommt das Spiel dort vorbei, bleibt es stehen. Unter „Fehlersuche“ siehst du dann alle Variablen.</dd>
      <dt>▶ Weiter · ⏭ Nächstes Bild · ↧ Schritt</dt><dd>Weiter bis zum nächsten Haltepunkt (<kbd>F8</kbd>), genau ein Bild weiter (<kbd>F6</kbd>) oder nur eine Zeile (<kbd>F10</kbd>).</dd>
      <dt>↻ Live</dt><dd>Lädt deinen Code ins laufende Spiel, ohne neu zu starten. Funktionen werden ausgetauscht, der Spielstand bleibt. Werte oben im Code (z.B. <code>speed = 2</code>) kommen nur an, wenn du sie geändert hast. <kbd>Strg</kbd>+<kbd>S</kbd> speichert und lädt live.</dd>
      <dt>Beobachten</dt><dd>Namen wie <code>pl.x</code> oder Rechnungen wie <code>score * 2</code> eintragen – sie werden jedes Bild neu berechnet, Zahlen auch als kleine Kurve.</dd>
      <dt>Tipp</dt><dd>Mit <code>log(x, y)</code> schreibst du Werte unten ins Protokoll.</dd>
    </dl>` +
    groups.map((g) => `<h4>${esc(g)}</h4>` + API.filter((a) => a.g === g).map((a) => `<button class="api" data-n="${a.n}"><code>${esc(sig(a))}</code><span>${esc(a.d)}</span></button>`).join('')).join('') +
    `<h4>Bausteine (Kürzel tippen)</h4>` + SNIPPETS.map((s) => `<button class="api" data-snip="${s.n}"><code>${s.n}</code><span>${esc(s.d)}</span></button>`).join('') +
    `<h4>Farben 0–31 und ihre Zeichen</h4><div class="pal-ref">${DEFAULT_PALETTE.map((c, i) => `<span style="background:#${c.toString(16).padStart(6, '0')}" title="Farbe ${i}">${i.toString(32)}</span>`).join('')}</div>`;
  $('edHelpPanel').addEventListener('click', (e) => {
    const b = e.target.closest('.api');
    if (!b) return;
    const p = text.selectionStart;
    acState = { prefix: '', items: [], sel: 0 };
    if (b.dataset.snip) accept(SNIPPETS.map((s) => ({ label: s.n, kind: 'snip', snippet: s.s })).find((s) => s.label === b.dataset.snip));
    else {
      const a = API.find((x) => x.n === b.dataset.n);
      accept({ label: a.n, kind: 'fn', params: a.p, snippet: a.n.startsWith('_') ? a.snippet : null });
    }
    void p;
    if (overlaySide()) closeSide();
  });

  // Kartridge-Eigenschaften
  const cartPane = $('edCartPanel');
  cartPane.innerHTML = `
    <div class="cf-preview" id="cfPreview"></div>
    <label class="cf">Titel<input id="cfTitle" maxlength="40"></label>
    <label class="cf">Autor<input id="cfAuthor" maxlength="40"></label>
    <label class="cf">Beschreibung<textarea id="cfDesc" rows="2" maxlength="200"></textarea></label>
    <label class="cf">Art<select id="cfKind"><option value="game">Spiel</option><option value="tutorial">Lektion</option></select></label>
    <label class="cf">Konsole<select id="cfSystem"><option value="8">8BOY (240×160, 32 Farben)</option><option value="16">8BOY 16 (256×224, 256 Farben, Perspektivboden)</option><option value="32">8BOY 32 (320×240, 3D)</option><option value="64">8BOY 64 (640×360, GPU)</option></select></label>
    <div class="cf">Etikettfarbe<div class="cf-colors" id="cfColors">${DEFAULT_PALETTE.map((c, i) => `<button data-c="${i}" style="background:#${c.toString(16).padStart(6, '0')}" title="${i}"></button>`).join('')}</div></div>
    <div class="cf">Etikett-Bild<div id="cfIcon"></div></div>
    <p class="side-note">Alles hier steht oben im Code als <code>-- title:</code>, <code>-- color:</code> … und wird beim Tippen sofort übernommen.</p>`;
  const iconEd = createPixelEditor($('cfIcon'), { sizes: [8, 16], onChange: (rows) => writeMeta({ icon: rows }) });
  let meta = null;
  function readMeta() {
    const c = parseCart(text.value);
    meta = { title: c.title, author: c.author, desc: c.desc, color: c.color, kind: c.kind === 'tutorial' ? 'tutorial' : 'game', system: c.system, icon: c.icon };
    return meta;
  }
  function writeMeta(patch) {
    readMeta();
    Object.assign(meta, patch);
    const { end, lines } = headerRange(text.value);
    const other = [];
    let inIcon = false;
    for (const l of lines) {
      if (META_LINE.test(l)) { inIcon = /icon\s*:/i.test(l); continue; }
      if (inIcon && ICON_ROW.test(l)) continue;
      inIcon = false;
      other.push(l);
    }
    replaceRange(0, end, buildHeader(meta, other));
    showPreview();
  }
  function showPreview() {
    const box = $('cfPreview');
    box.textContent = '';
    if (cartPreview) box.appendChild(cartPreview(parseCart(text.value)));
  }
  function fillCartForm() {
    readMeta();
    if (document.activeElement !== $('cfTitle')) $('cfTitle').value = meta.title;
    if (document.activeElement !== $('cfAuthor')) $('cfAuthor').value = meta.author;
    if (document.activeElement !== $('cfDesc')) $('cfDesc').value = meta.desc;
    $('cfKind').value = meta.kind;
    $('cfSystem').value = String(meta.system >= 64 ? 64 : meta.system >= 32 ? 32 : meta.system >= 16 ? 16 : 8);
    $('cfColors').querySelectorAll('button').forEach((b) => b.classList.toggle('on', +b.dataset.c === meta.color));
    iconEd.load(meta.icon || '........\n'.repeat(8));
    showPreview();
  }
  $('cfTitle').addEventListener('input', (e) => writeMeta({ title: e.target.value.replace(/\n/g, ' ') }));
  $('cfAuthor').addEventListener('input', (e) => writeMeta({ author: e.target.value.replace(/\n/g, ' ') }));
  $('cfDesc').addEventListener('input', (e) => writeMeta({ desc: e.target.value.replace(/\n/g, ' ') }));
  $('cfKind').addEventListener('change', (e) => writeMeta({ kind: e.target.value }));
  $('cfSystem').addEventListener('change', (e) => writeMeta({ system: +e.target.value }));
  $('cfColors').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) { writeMeta({ color: +b.dataset.c }); fillCartForm(); } });

  // Sprites
  const spritePane = $('edSpritePanel');
  spritePane.innerHTML = `
    <div class="sp-list" id="spList"></div>
    <button class="tb" id="spNew">+ Neues Sprite</button>
    <div class="sp-edit" id="spEdit" hidden>
      <div class="sp-head"><b id="spTitle"></b><button class="tb" id="spGoto">im Code zeigen</button></div>
      <div id="spPixels"></div>
      <div id="spTex3d"></div>
    </div>
    <p class="side-note">Sprites stehen im Code als <code>sprite(nummer, [[ … ]])</code>. Malen ändert den Text, Tippen im Text ändert das Bild.</p>`;
  let sprites = [], spSel = null;
  const SPRITE_RE = /(sprite\(\s*(\d+)\s*,\s*\[(=*)\[\r?\n?)([\s\S]*?)(\]\3\]\s*\))/g;
  function findSprites() {
    sprites = [...text.value.matchAll(SPRITE_RE)].map((m) => ({ n: +m[2], start: m.index + m[1].length, end: m.index + m[1].length + m[4].length, rows: m[4] }));
    return sprites;
  }
  const spEd = createPixelEditor($('spPixels'), {
    onChange: (rows) => {
      findSprites();
      const s = sprites.find((x) => x.n === spSel);
      if (s) replaceRange(s.start, s.end, rows + '\n');
      drawSpriteList();
      texPrev.setSprite(rows);
    },
  });
  // 3D-Probe: das Sprite als Textur auf Würfel, Kugel oder Ebene
  const texPrev = createTexturePreview($('spTex3d'));
  function drawSpriteList() {
    findSprites();
    const list = $('spList');
    list.textContent = '';
    if (!sprites.length) list.innerHTML = '<p class="side-note">Noch keine Sprites in dieser Kartridge.</p>';
    for (const s of sprites) {
      const b = document.createElement('button');
      b.className = 'sp-item' + (s.n === spSel ? ' on' : '');
      const c = document.createElement('canvas');
      drawGridThumb(c, rowsToGrid(s.rows), 3);
      b.appendChild(c);
      b.insertAdjacentHTML('beforeend', `<span>${s.n}</span>`);
      b.addEventListener('click', () => selectSprite(s.n));
      list.appendChild(b);
    }
  }
  function selectSprite(n, scroll = true) {
    spSel = n;
    findSprites();
    const s = sprites.find((x) => x.n === n);
    $('spEdit').hidden = !s;
    if (!s) return;
    $('spTitle').textContent = `Sprite ${n}`;
    spEd.load(s.rows);
    texPrev.setSprite(s.rows);
    drawSpriteList();
    if (scroll) gotoLine(lineOf(s.start), false);
  }
  $('spGoto').addEventListener('click', () => { const s = sprites.find((x) => x.n === spSel); if (s) { if (overlaySide()) closeSide(); gotoLine(lineOf(s.start)); } });
  $('spNew').addEventListener('click', () => {
    findSprites();
    const used = new Set(sprites.map((s) => s.n));
    let n = 1;
    while (used.has(n)) n++;
    const block = `sprite(${n}, [[\n${'........\n'.repeat(8)}]])\n`;
    let at;
    if (sprites.length) {
      const last = sprites[sprites.length - 1];
      at = text.value.indexOf('\n', last.end) + 1 || text.value.length;
      replaceRange(at, at, block);
    } else {
      at = headerRange(text.value).end;
      replaceRange(at, at, '\n' + block);
    }
    selectSprite(n);
  });

  function refreshPanels(force) {
    if (side.hidden) return;
    const tab = side.dataset.open;
    if (tab === 'cart' && (force || !cartPane.contains(document.activeElement))) fillCartForm();
    if (tab === 'sprites') {
      drawSpriteList();
      if (force && spSel !== null) selectSprite(spSel, false);
      else if (spSel !== null && !spritePane.matches(':hover')) { const s = sprites.find((x) => x.n === spSel); if (s && s.rows !== spEd.rows + '\n') { spEd.load(s.rows); texPrev.setSprite(s.rows); } }
    }
    if (tab === 'model3d') workshop.refresh();
  }

  // ---------------------------------------------------------------- 3D-Werkstatt
  const indentBlock = (block, ind) => (ind ? block.split('\n').map((l) => (l ? ind + l : l)).join('\n') : block);
  const told = () => text.dispatchEvent(new Event('input')); // Entwurf merken, „ungespeichert“ setzen
  // draw3d(n, …) in _draw hinter die letzte cls3d/cam3d-Zeile setzen
  function addDrawLine(n) {
    const code = text.value;
    if (new RegExp(`draw3d\\(\\s*${n}\\s*,`).test(code)) return 'da';
    const d = /^function\s+_draw\s*\(\s*\)[^\n]*\n/m.exec(code);
    if (!d) return null;
    const b0 = d.index + d[0].length;
    const e = /^end\b/m.exec(code.slice(b0));
    const body = code.slice(b0, e ? b0 + e.index : code.length);
    let pos = null, ind = '  ', m;
    const re = /^([ \t]*)[^\n]*\b(cls3d|cam3d)\s*\([^\n]*\n/gm;
    while ((m = re.exec(body))) { pos = b0 + m.index + m[0].length; ind = m[1]; }
    if (pos === null) return null;
    replaceRange(pos, pos, `${ind}draw3d(${n}, 0, 0, 0, t(), 0, 0, 1)  -- Modell ${n} zeigen und drehen\n`);
    return 'neu';
  }
  // Modell-Code einfügen: vorhandenes model(n, …) samt Bauplan ersetzen, sonst in _init (oder an die Schreibmarke)
  function insertModel(n, block, { draw = true, where = 'auto', data = null } = {}) {
    // Modell-Daten (8BOY 64): Block „8boy-modell name“ am Ende der Kartridge – gleichnamigen ersetzen
    if (data) {
      const all = text.value, re = new RegExp(`--\\[(=*)\\[8boy-modell ${data.name}\\b[^\\n]*\\n[\\s\\S]*?\\]\\1\\]\\n?`);
      const m = re.exec(all);
      if (m) replaceRange(m.index, m.index + m[0].length, data.text);
      else replaceRange(all.length, all.length, (all.endsWith('\n') ? '\n' : '\n\n') + data.text);
    }
    const code = text.value;
    const old = findModelBlock(code, n);
    let at, how;
    if (old) {
      if (old.builtin && !confirm(`Modell ${n} ist im Code schon eine fertige Form. Durch das neue Modell ersetzen?`)) return false;
      replaceRange(old.start, old.end, indentBlock(block, /^[ \t]*/.exec(code.slice(old.start))[0]));
      at = old.start; how = 'ersetzt';
    } else {
      let pos, ind = '', tail = '';
      if (where === 'cursor' && text.selectionStart >= headerRange(code).end) {
        pos = code.lastIndexOf('\n', text.selectionStart - 1) + 1;
        ind = /^[ \t]*/.exec(code.slice(pos))[0];
      } else {
        const init = /^function\s+_init\s*\(\s*\)[^\n]*\n/m.exec(code);
        if (init) { pos = init.index + init[0].length; ind = '  '; }
        else { const f = /^function\s/m.exec(code); pos = f ? f.index : code.length; tail = '\n'; }
      }
      const head = pos === code.length && !code.endsWith('\n') ? '\n' : '';
      replaceRange(pos, pos, head + indentBlock(block, ind) + tail);
      at = pos + head.length; how = 'eingefügt';
    }
    const drew = draw ? addDrawLine(n) : 'aus';
    told();
    gotoLine(lineOf(at), false);
    print(`✓ Modell ${n} ${how} (Zeile ${lineOf(at)})`, 'ok');
    if (drew === 'neu') print(`  draw3d(${n}, …) steht jetzt in _draw – mit ▶ Starten siehst du es.`);
    else if (drew === null) print(`  Zum Zeigen in _draw: cls(0)  cls3d(0x1c2a6a, 0x9fd8ff)  cam3d(0, 1.5, -5, 0, -0.2)  draw3d(${n}, 0, 0, 0)`);
    if (parseCart(text.value).system < 32) print('  Achtung: 3D gibt es nur auf dem 8BOY 32 und dem 8BOY 64 (Kartridge → Konsole).', 'err');
    if (overlaySide()) closeSide();
    return true;
  }
  const workshop = createWorkshop($('edModelPanel'), {
    getCode: () => text.value,
    insert: insertModel,
    isMega: () => parseCart(text.value).system >= 32,
    isUltra: () => parseCart(text.value).system >= 64,
    makeMega: () => { writeMeta({ system: 32 }); told(); print('✓ Konsole auf 8BOY 32 gestellt (-- system: 32)', 'ok'); },
    print,
  });
  // ---------------------------------------------------------------- Fehlersuche
  const AUTO_KEY = '8boy:autolive', WATCH_KEY = '8boy:watches';
  let autoLive = (() => { try { return localStorage.getItem(AUTO_KEY) === '1'; } catch { return false; } })();
  let watchList = (() => { try { return JSON.parse(localStorage.getItem(WATCH_KEY) || '[]').filter((w) => typeof w === 'string'); } catch { return []; } })();
  const panel = createDebugPanel($('edDebugPanel'), {
    auto: autoLive,
    onCmd: (cmd) => onDebug(cmd),
    onWatches: (list) => { watchList = list; try { localStorage.setItem(WATCH_KEY, JSON.stringify(list)); } catch { /* voll */ } onWatches(list); },
    onGoto: (line) => { if (overlaySide()) closeSide(); gotoLine(line, !overlaySide()); },
    onRemoveBp: (line) => toggleBreakpoint(line),
    onClearBps: () => { bps.clear(); bpsChanged(); render(); },
    onAuto: (on) => { autoLive = on; try { localStorage.setItem(AUTO_KEY, on ? '1' : '0'); } catch { /* privat */ } },
  });
  panel.setWatchList(watchList);
  panel.setBreakpoints([]);
  panel.setRunning(false);
  $('edLive').addEventListener('click', () => onLive(text.value, { auto: false }));

  // OBJ-Dateien, die aufs Studio fallen, landen in der Werkstatt statt im Regal
  $('editor').addEventListener('drop', (e) => {
    const files = [...(e.dataTransfer?.files || [])];
    if (!files.some((f) => /\.(obj|mtl|glb|gltf)$/i.test(f.name))) return;
    e.preventDefault(); e.stopPropagation();
    document.getElementById('console')?.classList.remove('drop-ready');
    showTab('model3d', true);
    workshop.loadFiles(files);
  });

  // Vorlagen-Menü für "Neu"
  const newMenu = $('edNewMenu');
  newMenu.innerHTML = TEMPLATES.map((t) => `<button data-t="${t.id}"><b>${esc(t.name)}</b><span>${esc(t.desc)}</span></button>`).join('');
  $('edNew').addEventListener('click', (e) => { e.stopPropagation(); newMenu.hidden = !newMenu.hidden; });
  newMenu.addEventListener('click', (e) => {
    const b = e.target.closest('[data-t]');
    if (!b) return;
    newMenu.hidden = true;
    onNew(TEMPLATES.find((t) => t.id === b.dataset.t).code);
  });
  document.addEventListener('click', (e) => { if (!newMenu.hidden && !e.target.closest('#edNewMenu')) newMenu.hidden = true; });

  measure();

  return {
    open(code, name) {
      text.value = code; prevValue = code; $('edTitle').textContent = name; errorLine = null; spSel = null;
      bps.clear(); bpsChanged(); halt = null; drawBar(); panel.setHalt(null);
      log.textContent = ''; measure(); render(); scanNames(); text.scrollTop = 0; sync(); hideAc();
      refreshPanels(true);
    },
    setTitle(name) { $('edTitle').textContent = name; },
    get code() { return text.value; },
    showError(err) {
      errorLine = err.line;
      render();
      print((err.line ? `Zeile ${err.line}: ` : '') + err.message, 'err');
      if (err.line) gotoLine(err.line);
    },
    // Ergebnis von ↻ Live; auto = nach Tipp-Pause (dann leise: kein Springen, keine Meldungsflut)
    liveResult(r, auto) {
      const last = log.lastElementChild;
      const quiet = auto && last?.dataset.live;
      if (!r.ok) {
        errorLine = r.error.line;
        render();
        const msg = `↻ Live: ${r.error.line ? `Zeile ${r.error.line}: ` : ''}${r.error.message} – das Spiel läuft mit dem alten Code weiter.`;
        if (quiet) last.remove();
        print(msg, 'err');
        log.lastElementChild.dataset.live = '1';
        if (!auto && r.error.line) gotoLine(r.error.line);
        return;
      }
      const what = [r.fns.length && `${r.fns.length} Funktion${r.fns.length > 1 ? 'en' : ''} (${r.fns.slice(0, 4).join(', ')}${r.fns.length > 4 ? ', …' : ''})`,
        r.vals.length && `Werte: ${r.vals.slice(0, 4).join(', ')}${r.vals.length > 4 ? ', …' : ''}`].filter(Boolean).join(' · ') || 'nichts geändert';
      if (quiet) last.remove();
      print(`↻ Live geladen: ${what}. Der Spielstand bleibt.`, 'ok');
      log.lastElementChild.dataset.live = '1';
      if (errorLine) { errorLine = null; render(); }
    },
    showHalt(info) {
      halt = info;
      render();
      drawBar();
      panel.setHalt(info);
      if (info.line) {
        const top = (info.line - 1) * lineH, vis = text.clientHeight;
        if (top < text.scrollTop + lineH || top > text.scrollTop + vis - 3 * lineH) { text.scrollTop = Math.max(0, top - vis / 3); sync(); }
      }
      if (!overlaySide() && side.dataset.open !== 'debug') showTab('debug', true);
    },
    clearHalt() { if (!halt) return; halt = null; render(); drawBar(); panel.setHalt(null); },
    showWatches(values) { panel.setWatches(values); },
    setRunning(on) { panel.setRunning(on); },
    get breakpoints() { return effectiveBreakpoints(); },
    get watches() { return watchList.slice(); },
    get halted() { return !!halt; },
    print,
    refresh: render,
    workshop,
    showTab,
  };
}
