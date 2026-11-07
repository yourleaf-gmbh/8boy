// Pixel-Malprogramm für Sprites und Etiketten. Arbeitet direkt auf dem Pixeltext
// ('.' = durchsichtig, 0-9 a-v = Farbe 0-31), damit Code und Bild immer übereinstimmen.
import { DEFAULT_PALETTE } from './gfx.js';

const CHARS = '0123456789abcdefghijklmnopqrstuv';
const hex = (i) => '#' + DEFAULT_PALETTE[i].toString(16).padStart(6, '0');

export function rowsToGrid(text) {
  const rows = String(text).split(/\r?\n/).map((r) => r.trim()).filter(Boolean);
  const h = Math.max(1, rows.length), w = Math.max(1, ...rows.map((r) => r.length));
  const grid = [];
  for (let y = 0; y < h; y++) {
    grid.push([]);
    for (let x = 0; x < w; x++) {
      const ch = (rows[y] || '')[x] || '.';
      const c = CHARS.indexOf(ch.toLowerCase());
      grid[y].push(c < 0 ? -1 : c);
    }
  }
  return grid;
}
export const gridToRows = (grid) => grid.map((r) => r.map((c) => (c < 0 ? '.' : CHARS[c])).join('')).join('\n');

export function drawGridThumb(canvas, grid, scale = 3) {
  const h = grid.length, w = grid[0]?.length || 1;
  canvas.width = w * scale; canvas.height = h * scale;
  const g = canvas.getContext('2d');
  g.clearRect(0, 0, canvas.width, canvas.height);
  grid.forEach((row, y) => row.forEach((c, x) => { if (c >= 0) { g.fillStyle = hex(c); g.fillRect(x * scale, y * scale, scale, scale); } }));
}

export function createPixelEditor(root, { onChange = () => {}, sizes = [8, 16, 24, 32] } = {}) {
  root.classList.add('px');
  root.innerHTML = `
    <div class="px-tools">
      <button data-tool="pen" class="on" title="Stift">✎</button>
      <button data-tool="fill" title="Füllen">◩</button>
      <button data-tool="pick" title="Farbe aufnehmen">⌖</button>
      <button data-tool="erase" title="Radierer">⌫</button>
      <span class="px-sep"></span>
      <button data-act="flip" title="Waagerecht spiegeln">⇆</button>
      <button data-act="shiftl" title="Nach links schieben">←</button>
      <button data-act="shiftr" title="Nach rechts schieben">→</button>
      <button data-act="shiftu" title="Nach oben schieben">↑</button>
      <button data-act="shiftd" title="Nach unten schieben">↓</button>
      <button data-act="clear" title="Alles löschen">✕</button>
      <select class="px-size" title="Größe">${sizes.map((s) => `<option value="${s}">${s}×${s}</option>`).join('')}</select>
    </div>
    <canvas class="px-canvas"></canvas>
    <div class="px-pal"></div>
    <div class="px-info"></div>`;
  const canvas = root.querySelector('.px-canvas');
  const pal = root.querySelector('.px-pal');
  const info = root.querySelector('.px-info');
  const sizeSel = root.querySelector('.px-size');
  let grid = rowsToGrid('........\n'.repeat(8));
  let color = 11, tool = 'pen';

  const sw = document.createElement('button');
  sw.className = 'px-sw px-clear'; sw.title = 'durchsichtig (.)'; sw.dataset.c = -1;
  pal.appendChild(sw);
  for (let i = 0; i < 32; i++) {
    const b = document.createElement('button');
    b.className = 'px-sw'; b.style.background = hex(i); b.dataset.c = i; b.title = `Farbe ${i} = '${CHARS[i]}'`;
    pal.appendChild(b);
  }
  function markColor() {
    pal.querySelectorAll('.px-sw').forEach((b) => b.classList.toggle('on', +b.dataset.c === color));
    info.textContent = color < 0 ? 'durchsichtig  ·  Zeichen "."' : `Farbe ${color}  ·  Zeichen "${CHARS[color]}"`;
  }
  pal.addEventListener('click', (e) => { const b = e.target.closest('.px-sw'); if (b) { color = +b.dataset.c; if (tool === 'erase' || tool === 'pick') setTool('pen'); markColor(); } });

  function setTool(t) { tool = t; root.querySelectorAll('[data-tool]').forEach((b) => b.classList.toggle('on', b.dataset.tool === t)); }
  root.querySelectorAll('[data-tool]').forEach((b) => b.addEventListener('click', () => setTool(b.dataset.tool)));

  function render() {
    const h = grid.length, w = grid[0].length;
    const cell = Math.max(6, Math.floor(Math.min(root.clientWidth - 4 || 280, 320) / Math.max(w, h)));
    canvas.width = w * cell; canvas.height = h * cell;
    canvas.style.width = w * cell + 'px';
    const g = canvas.getContext('2d');
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const c = grid[y][x];
      if (c < 0) { // Schachbrett = durchsichtig
        g.fillStyle = (x + y) % 2 ? '#2a2d38' : '#22242e';
      } else g.fillStyle = hex(c);
      g.fillRect(x * cell, y * cell, cell, cell);
    }
    g.strokeStyle = 'rgba(255,255,255,.07)';
    for (let i = 0; i <= w; i++) { g.beginPath(); g.moveTo(i * cell + 0.5, 0); g.lineTo(i * cell + 0.5, h * cell); g.stroke(); }
    for (let i = 0; i <= h; i++) { g.beginPath(); g.moveTo(0, i * cell + 0.5); g.lineTo(w * cell, i * cell + 0.5); g.stroke(); }
    if (w % 8 === 0 && w > 8) {
      g.strokeStyle = 'rgba(254,231,97,.25)';
      for (let i = 8; i < w; i += 8) { g.beginPath(); g.moveTo(i * cell + 0.5, 0); g.lineTo(i * cell + 0.5, h * cell); g.stroke(); }
      for (let i = 8; i < h; i += 8) { g.beginPath(); g.moveTo(0, i * cell + 0.5); g.lineTo(w * cell, i * cell + 0.5); g.stroke(); }
    }
    canvas.dataset.cell = cell;
  }

  function changed() { render(); onChange(gridToRows(grid)); }

  function fill(x, y, from, to) {
    if (from === to) return;
    const stack = [[x, y]];
    while (stack.length) {
      const [cx, cy] = stack.pop();
      if (cy < 0 || cy >= grid.length || cx < 0 || cx >= grid[0].length || grid[cy][cx] !== from) continue;
      grid[cy][cx] = to;
      stack.push([cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]);
    }
  }

  let painting = false;
  function at(e) {
    const r = canvas.getBoundingClientRect();
    const cell = r.width / grid[0].length;
    return [Math.floor((e.clientX - r.left) / cell), Math.floor((e.clientY - r.top) / cell)];
  }
  function apply(e, first) {
    const [x, y] = at(e);
    if (y < 0 || y >= grid.length || x < 0 || x >= grid[0].length) return;
    if (tool === 'pick') { color = grid[y][x]; markColor(); setTool('pen'); return; }
    if (tool === 'fill') { if (first) { fill(x, y, grid[y][x], color); changed(); } return; }
    const c = tool === 'erase' ? -1 : color;
    if (grid[y][x] !== c) { grid[y][x] = c; changed(); }
  }
  canvas.addEventListener('pointerdown', (e) => { painting = true; canvas.setPointerCapture(e.pointerId); apply(e, true); });
  canvas.addEventListener('pointermove', (e) => { if (painting) apply(e, false); });
  canvas.addEventListener('pointerup', () => { painting = false; });
  canvas.addEventListener('pointercancel', () => { painting = false; });
  canvas.style.touchAction = 'none';

  root.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', () => {
    const a = b.dataset.act;
    if (a === 'flip') grid = grid.map((r) => r.slice().reverse());
    if (a === 'shiftl') grid = grid.map((r) => [...r.slice(1), r[0]]);
    if (a === 'shiftr') grid = grid.map((r) => [r[r.length - 1], ...r.slice(0, -1)]);
    if (a === 'shiftu') grid = [...grid.slice(1), grid[0]];
    if (a === 'shiftd') grid = [grid[grid.length - 1], ...grid.slice(0, -1)];
    if (a === 'clear') grid = grid.map((r) => r.map(() => -1));
    changed();
  }));
  sizeSel.addEventListener('change', () => {
    const n = +sizeSel.value;
    grid = Array.from({ length: n }, (_, y) => Array.from({ length: n }, (_, x) => grid[y]?.[x] ?? -1));
    changed();
  });

  markColor();
  return {
    load(text) {
      grid = rowsToGrid(text);
      const n = Math.max(grid.length, grid[0].length);
      if (![...sizeSel.options].some((o) => +o.value === n)) sizeSel.insertAdjacentHTML('beforeend', `<option value="${n}">${grid[0].length}×${grid.length}</option>`);
      sizeSel.value = String(n);
      render();
    },
    get rows() { return gridToRows(grid); },
    render,
  };
}
