// 3D-Werkstatt im 8BOY Studio: Modelle aus Grundformen bauen, OBJ-Dateien laden und Sprites als Textur
// in 3D ansehen. Die Vorschau rechnet mit einem eigenen, vom Spiel unabhängigen 8BOY-32-Grafikchip –
// sie zeigt also genau das, was später auch auf der Konsole zu sehen ist.
//
// Der Code bleibt die einzige Wahrheit: "In den Code einfügen" schreibt model(n, punkte, flaechen) und
// (beim Bauen) einen Bauplan als Kommentar  --[[modell n … ]]  in den Lua-Text. Den erkennt die Werkstatt
// beim nächsten Öffnen wieder.
import { createGfx, DEFAULT_PALETTE } from './gfx.js';
import { builtinModel } from './gfx3d.js';
import { parseOBJ, parseMTL, objToMesh, modelToLua, bounds, fmtNum, cleanModel } from './obj-import.js';
import { createGpu } from './gpu.js';
import { importGLTF } from './gltf-import.js';
import { simplifyMesh } from './mesh-simplify.js';
import { meshToChip, packModel, deflate, toBase64, modelBlockText, decodeModelBlock, turnMesh, normalizeMesh } from './model-pack.js';

const hex = (i) => '#' + DEFAULT_PALETTE[i & 31].toString(16).padStart(6, '0');
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const DEG = Math.PI / 180;
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

export const FORMS = [
  { id: 'wuerfel', name: 'Würfel', icon: '■' },
  { id: 'kugel', name: 'Kugel', icon: '●' },
  { id: 'zylinder', name: 'Zylinder', icon: '▮' },
  { id: 'kegel', name: 'Kegel', icon: '▲' },
  { id: 'pyramide', name: 'Pyramide', icon: '◭' },
  { id: 'ring', name: 'Ring', icon: '◯' },
  { id: 'ebene', name: 'Ebene', icon: '▬' },
];
const formName = (id) => FORMS.find((f) => f.id === id)?.name || id;

// ------------------------------------------------------------------ Modell -> Daten für den 3D-Chip
// { v, f: [{i, c}] } -> punkte {x,y,z,…} und flaechen {a,b,c,farbe,…} (Nummern ab 1) wie in Lua
export function toFlat(m) {
  const faces = [];
  for (const f of m.f) faces.push(f.i[0] + 1, f.i[1] + 1, f.i[2] + 1, f.c);
  return { pts: m.v, faces };
}

// ------------------------------------------------------------------ Vorschau
// Eigener kleiner 8BOY 32 in einem Canvas. Ziehen dreht, Mausrad / zwei Finger zoomen.
export function createViewer(canvas, { w = 320, h = 240, sky = [0x161a2c, 0x3b4262], spin = false, onTap = null, fps = 30 } = {}) {
  const gfx = createGfx({ w, h, colors: 256, layers: 1, three: true });
  const g3 = gfx.g3;
  // 8BOY-64-Vorschau (Modelle mit echten Farben und Texturen): eigener Grafikchip auf der Grafikkarte, erst bei Bedarf
  let gpuChip = null, glc = null, useGpu = false;
  function ensureGpu() {
    if (gpuChip !== null) return gpuChip;
    glc = document.createElement('canvas');
    const G = createGpu(glc);
    gpuChip = G.ok ? G.attach({ W: w, H: h, palette: DEFAULT_PALETTE, remap: Uint8Array.from({ length: 256 }, (_, i) => i), sprites: [], state: {} }) : false;
    return gpuChip;
  }
  const chip = () => (useGpu && gpuChip ? gpuChip : g3);
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(w, h);
  const out32 = new Uint32Array(img.data.buffer);
  const home = { yaw: -0.7, pitch: -0.42, dist: 3.4, target: [0, 0.5, 0] };
  const view = { ...home, target: home.target.slice(), fov: 50 };
  let scene = null, dirty = true, raf = 0, last = 0, held = false;

  function camPos() {
    const cp = Math.cos(view.pitch);
    const fw = [Math.sin(view.yaw) * cp, Math.sin(view.pitch), Math.cos(view.yaw) * cp];
    return view.target.map((t, k) => t - fw[k] * view.dist);
  }
  function draw() {
    dirty = false;
    const g = chip();
    g.cls3d(sky[0], sky[1]);
    const [x, y, z] = camPos();
    g.camera3d(x, y, z, view.yaw, view.pitch, view.fov);
    // Licht dreht mit der Ansicht: von schräg oben links hinter der Kamera – so sieht man jede Seite
    const lx = -0.4, ly = -0.8, lz = 0.45, c = Math.cos(view.yaw), s = Math.sin(view.yaw);
    g.light3d(lx * c + lz * s, ly, -lx * s + lz * c, 0.38);
    if (scene) scene(g, gfx);
    if (g !== g3) { g.finish?.(); ctx.drawImage(glc, 0, 0, w, h); return; }
    gfx.present(out32);
    ctx.putImageData(img, 0, 0);
  }
  const visible = () => canvas.isConnected && canvas.offsetParent !== null && document.visibilityState !== 'hidden';
  function frame(t) {
    raf = 0;
    if (!visible()) return;                 // unsichtbar: schlafen, wake() weckt wieder
    if (api.spin && !held) {
      if (t - last < 1000 / fps) { raf = requestAnimationFrame(frame); return; }
      view.yaw += Math.min(0.1, (t - (last || t)) / 1000) * 0.8;
      dirty = true;
    }
    last = t;
    if (dirty) draw();
    if (api.spin) raf = requestAnimationFrame(frame);
  }
  function wake() { if (!raf) raf = requestAnimationFrame(frame); }
  function redraw() { dirty = true; wake(); }

  // ---- Maus und Finger
  const ptrs = new Map();
  let start = null, pinch = 0;
  canvas.style.touchAction = 'none';
  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    held = true;
    if (ptrs.size === 1) start = { x: e.clientX, y: e.clientY, t: performance.now(), moved: 0 };
    if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; pinch = Math.hypot(a.x - b.x, a.y - b.y); start = null; }
  });
  canvas.addEventListener('pointermove', (e) => {
    const p = ptrs.get(e.pointerId);
    if (!p) return;
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    p.x = e.clientX; p.y = e.clientY;
    if (ptrs.size === 1) {
      view.yaw += dx * 0.012;
      view.pitch = clamp(view.pitch - dy * 0.01, -1.45, 1.2);
      if (start) start.moved += Math.abs(dx) + Math.abs(dy);
    } else if (ptrs.size === 2) {
      const [a, b] = [...ptrs.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinch > 0 && d > 0) view.dist = clamp(view.dist * pinch / d, 0.6, 30);
      pinch = d;
    }
    redraw();
  });
  const up = (e) => {
    if (!ptrs.has(e.pointerId)) return;
    ptrs.delete(e.pointerId);
    if (!ptrs.size) held = false;
    if (e.type === 'pointerup' && start && start.moved < 8 && performance.now() - start.t < 500 && onTap) {
      const r = canvas.getBoundingClientRect();
      onTap((e.clientX - r.left) * w / r.width, (e.clientY - r.top) * h / r.height);
    }
    if (!ptrs.size) start = null;
  };
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', up);
  canvas.addEventListener('wheel', (e) => { e.preventDefault(); view.dist = clamp(view.dist * Math.exp(e.deltaY * 0.0015), 0.6, 30); redraw(); }, { passive: false });

  const api = {
    gfx, view, spin,
    get g3() { return chip(); },
    // 8BOY-64-Vorschau an/aus (ohne WebGL2 bleibt es beim Software-Chip); gibt zurück, ob die Grafikkarte rechnet
    setGpu(on) { useGpu = !!on && !!ensureGpu(); redraw(); return useGpu; },
    get gpu() { return useGpu && !!gpuChip; },
    setScene(fn) { scene = fn; redraw(); },
    redraw, wake,
    // nur Ziel und Abstand ändern, Blickrichtung behalten
    frame(target, dist) { view.target = target.slice(); view.dist = dist; redraw(); },
    reset(target, dist) { Object.assign(view, { yaw: home.yaw, pitch: home.pitch, dist: dist ?? home.dist, target: (target || home.target).slice() }); redraw(); },
    focal: () => (h / 2) / Math.tan(view.fov * Math.PI / 360),
  };
  return api;
}

// Raster-Boden und kleine Achsen (x rot, y grün, z blau)
function floorGrid(g3, y = 0, size = 2, step = 0.5) {
  for (let k = -size; k <= size + 1e-6; k += step) {
    g3.line3d(k, y, -size, k, y, size, 17);
    g3.line3d(-size, y, k, size, y, k, 17);
  }
  g3.line3d(0, y, 0, 0.7, y, 0, 8);
  g3.line3d(0, y, 0, 0, y + 0.7, 0, 11);
  g3.line3d(0, y, 0, 0, y, 0.7, 12);
}

// ------------------------------------------------------------------ Teile -> ein Modell
const geomCache = new Map();
function geom(form) {
  if (!geomCache.has(form)) {
    const m = builtinModel(form, 7);
    const f = m.f.map((x) => x.i.slice());
    // Ebene: Rückseite dazulegen, weil das zusammengesetzte Modell nur Vorderseiten zeigt
    if (m.both) m.f.forEach((x) => f.push([x.i[0], x.i[2], x.i[1]]));
    geomCache.set(form, { v: m.v, f, smooth: m.smooth, box: bounds(m.v) });
  }
  return geomCache.get(form);
}
// genau dieselbe Drehung wie draw3d: erst rollen (z), dann nicken (x), dann gieren (y)
function partTransform(p) {
  const [gy, nk, rl] = p.r.map((d) => d * DEG);
  const cyw = Math.cos(gy), syw = Math.sin(gy), cp = Math.cos(nk), sp = Math.sin(nk), cr = Math.cos(rl), sr = Math.sin(rl);
  const [sx, sy, sz] = p.s, [tx, ty, tz] = p.p;
  return (x, y, z) => {
    x *= sx; y *= sy; z *= sz;
    const x1 = x * cr - y * sr, y1 = x * sr + y * cr, z1 = z;
    const y2 = y1 * cp - z1 * sp, z2 = y1 * sp + z1 * cp;
    return [x1 * cyw + z2 * syw + tx, y2 + ty, -x1 * syw + z2 * cyw + tz];
  };
}
export function mergeParts(parts) {
  const v = [], f = [];
  for (const p of parts) {
    const g = geom(p.form), T = partTransform(p), base = v.length / 3;
    for (let k = 0; k < g.v.length; k += 3) v.push(...T(g.v[k], g.v[k + 1], g.v[k + 2]));
    for (const i of g.f) f.push({ i: [i[0] + base, i[1] + base, i[2] + base], c: p.c });
  }
  return cleanModel({ v, f }, 4);
}
const allSmooth = (parts) => parts.length > 0 && parts.every((p) => geom(p.form).smooth);

// ------------------------------------------------------------------ Bauplan im Code
export function blueprintText(n, parts, smooth) {
  const rows = parts.map((p) => [p.form, ...p.p, ...p.s, ...p.r].map((x) => (typeof x === 'number' ? fmtNum(x, 3) : x)).join(' ') + ' ' + p.c);
  return `--[[modell ${n} · Bauplan der 3D-Werkstatt (Studio → 3D → öffnen)\n` +
    '-- form  x y z  breite höhe tiefe  gier nick roll (Grad)  farbe\n' +
    rows.join('\n') + (smooth ? '\nglatt' : '') + '\n]]\n';
}
export function findBlueprints(code) {
  const out = [];
  for (const m of String(code).matchAll(/--\[\[modell\s+(\d+)[^\n]*\n([\s\S]*?)\]\]/g)) {
    const parts = [];
    let smooth = false;
    for (const l of m[2].split('\n')) {
      const t = l.trim().split(/\s+/);
      if (t[0] === 'glatt') { smooth = true; continue; }
      if (!FORMS.some((f) => f.id === t[0])) continue;
      const nums = t.slice(1).map(Number);
      if (nums.length < 10 || nums.slice(0, 10).some((x) => !Number.isFinite(x))) continue;
      parts.push({ form: t[0], p: nums.slice(0, 3), s: nums.slice(3, 6), r: nums.slice(6, 9), c: nums[9] & 31 });
    }
    out.push({ n: +m[1], parts, smooth });
  }
  return out;
}
export function usedModelNumbers(code) {
  const used = new Set();
  for (const m of String(code).matchAll(/(?:^|[^\w.])model\(\s*(\d+)/g)) used.add(+m[1]);
  for (const b of findBlueprints(code)) used.add(b.n);
  return used;
}
export function freeModelNumber(code) {
  const used = usedModelNumbers(code);
  for (let n = 0; n < 64; n++) if (!used.has(n)) return n;
  return 63;
}
// Stelle eines vorhandenen model(n, …)-Aufrufs samt Bauplan und Kopfkommentar davor (zum Ersetzen)
export function findModelBlock(code, n) {
  const re = new RegExp(`(^|[^\\w.])model(?:load)?\\(\\s*${n}\\s*,`, 'g');
  let m;
  while ((m = re.exec(code))) {
    const at = m.index + m[1].length;
    const ls = code.lastIndexOf('\n', at - 1) + 1;
    if (code.slice(ls, at).includes('--')) continue;                       // auskommentiert
    const open = code.lastIndexOf('--[[', at), close = code.lastIndexOf(']]', at);
    if (open >= 0 && open > close) continue;                                // in einem Blockkommentar
    // passende Klammer suchen (Zeichenketten überspringen)
    let i = code.indexOf('(', at), depth = 0, end = -1;
    for (; i < code.length; i++) {
      const c = code[i];
      if (c === '"' || c === "'") { const q = c; for (i++; i < code.length && code[i] !== q && code[i] !== '\n'; i++) if (code[i] === '\\') i++; continue; }
      if (c === '(') depth++;
      else if (c === ')' && --depth === 0) { end = i + 1; break; }
    }
    if (end < 0) return null;
    const nl = code.indexOf('\n', end);
    end = nl < 0 ? code.length : nl + 1;
    let start = ls;
    // davor: "-- Modell n …"/"-- Punkte: …" und der Bauplan
    for (;;) {
      const before = code.slice(0, start);
      const c1 = new RegExp(`(^|\\n)([ \\t]*--[ \\t]*(?:Modell ${n}\\b|Punkte: je)[^\\n]*\\n)$`).exec(before);
      if (c1) { start -= c1[2].length; continue; }
      const c2 = new RegExp(`(^|\\n)([ \\t]*--\\[\\[modell\\s+${n}\\b[^\\n]*\\n(?:(?!\\]\\])[\\s\\S])*?\\]\\][ \\t]*\\n)$`).exec(before);
      if (c2) { start -= c2[2].length; continue; }
      break;
    }
    return { start, end, builtin: /model\(\s*\d+\s*,\s*["']/.test(code.slice(at, at + 40)) };
  }
  return null;
}

// ------------------------------------------------------------------ kleines Beispiel zum Ausprobieren
const SAMPLE_OBJ = `# Rakete – Beispiel für die 3D-Werkstatt
mtllib rakete.mtl
v 0 0 0.3
v 0.26 0 0.15
v 0.26 0 -0.15
v 0 0 -0.3
v -0.26 0 -0.15
v -0.26 0 0.15
v 0 1.4 0.3
v 0.26 1.4 0.15
v 0.26 1.4 -0.15
v 0 1.4 -0.3
v -0.26 1.4 -0.15
v -0.26 1.4 0.15
v 0 2 0
v 0 -0.15 0
usemtl rumpf
f 1 2 8 7
f 2 3 9 8
f 3 4 10 9
f 4 5 11 10
f 5 6 12 11
f 6 1 7 12
usemtl spitze
f 7 8 13
f 8 9 13
f 9 10 13
f 10 11 13
f 11 12 13
f 12 7 13
usemtl duese
f 14 2 1
f 14 3 2
f 14 4 3
f 14 5 4
f 14 6 5
f 14 1 6
v 0 0 0.3
v 0 0.6 0.3
v 0 -0.2 0.7
v 0 0.1 0.7
v 0.26 0 -0.15
v 0.26 0.6 -0.15
v 0.6 -0.2 -0.35
v 0.6 0.1 -0.35
v -0.26 0 -0.15
v -0.26 0.6 -0.15
v -0.6 -0.2 -0.35
v -0.6 0.1 -0.35
usemtl flosse
f -12 -10 -9 -11
f -11 -9 -10 -12
f -8 -6 -5 -7
f -7 -5 -6 -8
f -4 -2 -1 -3
f -3 -1 -2 -4
`;
const SAMPLE_MTL = 'newmtl rumpf\nKd 0.95 0.95 0.9\nnewmtl spitze\nKd 0.9 0.2 0.25\nnewmtl duese\nKd 0.3 0.3 0.35\nnewmtl flosse\nKd 0.2 0.6 0.95\n';

// ------------------------------------------------------------------ Werkstatt-Tab
// api: { getCode(), insert(n, code, { draw, where }) -> Text, isMega(), makeMega(), print(msg) }
export function createWorkshop(root, api) {
  root.innerHTML = `
    <div class="w3">
      <div class="w3-mode"><button data-mode="build" class="on">Bauen</button><button data-mode="obj">Modell laden</button></div>
      <div class="w3-mega" hidden>3D-Modelle laufen nur auf dem <b>8BOY 32</b>. <button class="tb" data-act="mega">Auf 8BOY 32 umstellen</button></div>
      <div class="w3-view">
        <canvas class="w3-canvas" tabindex="0" aria-label="3D-Vorschau: ziehen dreht, Mausrad oder zwei Finger zoomen"></canvas>
        <span class="w3-tris"></span>
        <button class="w3-reset" data-act="view" title="Ansicht zurücksetzen">⟲</button>
      </div>
      <div class="w3-build">
        <div class="w3-open"></div>
        <div class="w3-label">Grundform dazu</div>
        <div class="w3-forms">${FORMS.map((f) => `<button data-form="${f.id}" title="${f.name} dazu"><i>${f.icon}</i>${f.name}</button>`).join('')}</div>
        <div class="w3-parts"></div>
        <div class="w3-edit" hidden>
          <div class="w3-seg"><button data-k="p" class="on">Ort</button><button data-k="s">Größe</button><button data-k="r">Drehung</button></div>
          <div class="w3-rows"></div>
          <label class="w3-chk w3-lock" hidden><input type="checkbox"> alle Seiten gleich</label>
          <div class="w3-pal" data-pal="part"></div>
          <div class="w3-acts"><button class="tb" data-act="copy">Kopieren</button><button class="tb" data-act="del">Löschen</button><button class="tb" data-act="undo" title="Rückgängig (Strg+Z)">↶ Zurück</button><button class="tb" data-act="clear">Neu anfangen</button></div>
        </div>
        <p class="side-note">Tippe auf eine <b>Grundform</b> – sie landet oben auf deinem Modell. Ein Teil auswählen (in der Liste oder in der Vorschau antippen) und mit den Reglern <b>verschieben</b>, <b>größer machen</b> oder <b>drehen</b>.
        <span class="for-mouse">In der Vorschau: ziehen dreht die Ansicht, Mausrad zoomt. Nach einem Klick in die Vorschau schieben die <kbd>Pfeiltasten</kbd> das Teil (mit <kbd>Shift</kbd> hoch/runter).</span><span class="for-touch">In der Vorschau: wischen dreht die Ansicht, zwei Finger zoomen.</span>
        Der Boden ist <code>y = 0</code>. Beim Einfügen kommt ein <b>Bauplan</b> als Kommentar mit in den Code – so kannst du das Modell später hier wieder öffnen.</p>
      </div>
      <div class="w3-obj" hidden>
        <div class="w3-acts"><label class="tb tb-run">Modell wählen<input type="file" class="w3-file" accept=".obj,.mtl,.glb,.gltf,.bin,.png,.jpg,.jpeg" multiple hidden></label><button class="tb" data-act="sample">Beispiel: Rakete</button></div>
        <div class="w3-info side-note"></div>
        <div class="w3-objctl" hidden>
          <div class="w3-line"><span class="w3-label">Farbe</span><label class="w3-chk"><input type="radio" name="w3col" value="file" checked> aus der Datei</label><label class="w3-chk"><input type="radio" name="w3col" value="one"> eine für alles</label></div>
          <div class="w3-pal" data-pal="obj"></div>
          <div class="w3-line"><span class="w3-label">Drehen</span><button class="tb" data-turn="x" title="um die X-Achse kippen">↻ X</button><button class="tb" data-turn="y" title="um die Hochachse drehen">↻ Y</button><button class="tb" data-turn="z" title="zur Seite rollen">↻ Z</button><label class="w3-chk"><input type="checkbox" class="w3-ground"> auf den Boden</label></div>
          <div class="w3-line"><span class="w3-label">Vereinfachen</span><input type="number" class="w3-target" value="500" min="12" max="64000" step="50" inputmode="numeric"> Dreiecke <button class="tb" data-act="simplify">Los</button><button class="tb" data-act="orig">Original</button></div>
          <div class="w3-line w3-ultra-only"><span class="w3-label">Textur</span><select class="w3-texsize" title="Kantenlänge der Textur in der Kartridge"><option value="256">256 Bildpunkte</option><option value="512" selected>512 Bildpunkte</option><option value="1024">1024 Bildpunkte</option></select></div>
          <div class="w3-line w3-ultra-only"><span class="w3-label">Herkunft</span><input type="text" class="w3-lic" placeholder="Quelle und Lizenz, z. B. Kenney · CC0" spellcheck="false"></div>
          <div class="w3-cost side-note"></div>
          <div class="w3-warn"></div>
        </div>
        <p class="side-note">Fast jedes 3D-Programm speichert <b>glTF</b> (<code>.glb</code> oder <code>.gltf</code> mit <code>.bin</code> und Bildern) oder <b>OBJ</b> (<code>.obj</code> mit <code>.mtl</code>). Wähle alle Dateien des Modells zusammen aus.<span class="for-mouse"> Du kannst sie auch einfach ins Studio ziehen.</span> Das Modell wird in die Mitte gerückt und auf Größe 1 gebracht.
        Der <b>8BOY 64</b> zeigt echte Farben und Texturen und schafft <b>64.000 Dreiecke pro Bild</b> – das Modell kommt gepackt in die Kartridge und wird mit <code>modelload</code> geladen. Der <b>8BOY 32</b> nimmt die nächsten Palettenfarben und schafft etwa <b>2000 Dreiecke</b>. Fremde Modelle nur mit passender Lizenz verwenden (z. B. CC0) und die Herkunft eintragen.</p>
      </div>
      <div class="w3-out">
        <label class="w3-chk">Modell-Nr. <input type="number" class="w3-n" min="0" max="63" inputmode="numeric"></label>
        <label class="w3-chk" title="weiche Schattierung (für runde Dinge)"><input type="checkbox" class="w3-smooth"> glatt</label>
        <label class="w3-chk" title="draw3d(...) in _draw einfügen, damit man das Modell gleich sieht"><input type="checkbox" class="w3-draw" checked> gleich zeigen</label>
        <select class="w3-where" title="Wohin kommt der Code?"><option value="auto">in _init</option><option value="cursor">an die Schreibmarke</option></select>
        <button class="tb tb-run w3-insert">In den Code einfügen</button>
      </div>
    </div>`;
  const q = (s) => root.querySelector(s);
  const canvas = q('.w3-canvas');
  let mode = 'build';
  let parts = [], sel = -1, editK = 'p', merged = { v: [], f: [] };
  let hist = [], numTouched = false, smoothTouched = false;
  let buildNo = null, objNo = null;   // Nummer des Modells, an dem gerade gearbeitet wird (Einfügen ersetzt es dann)
  // OBJ
  let obj = null, objName = '', mtl = new Map(), turns = [], target = null, objModel = null;
  // Modell laden: Quelle (OBJ oder glTF), das fertige Netz für den 8BOY 64 und eine Textur aus map_Kd (OBJ)
  let src = null, objMesh = null, texImg = null, imgFiles = new Map();
  const simpCache = new Map();
  let lastUltra = null;

  const viewer = createViewer(canvas, { onTap: pick });

  // ---------------------------------------------------------------- Paletten
  function palette(el, onPick) {
    el.innerHTML = DEFAULT_PALETTE.map((c, i) => `<button data-c="${i}" style="background:${hex(i)}" title="Farbe ${i}"></button>`).join('');
    el.addEventListener('click', (e) => { const b = e.target.closest('[data-c]'); if (b) onPick(+b.dataset.c); });
    return (c) => el.querySelectorAll('[data-c]').forEach((b) => b.classList.toggle('on', +b.dataset.c === c));
  }
  const markPartColor = palette(q('[data-pal="part"]'), (c) => { if (parts[sel]) { parts[sel].c = c; changed(true); } });
  let objColor = 7;
  const markObjColor = palette(q('[data-pal="obj"]'), (c) => { objColor = c; root.querySelector('input[name="w3col"][value="one"]').checked = true; rebuildObj(); });
  markObjColor(objColor);

  // ---------------------------------------------------------------- Bauen
  const SPECS = {
    p: { min: -3, max: 3, step: 0.05, rows: ['links / rechts (x)', 'runter / hoch (y)', 'vorn / hinten (z)'] },
    s: { min: 0.05, max: 4, step: 0.05, rows: ['Breite (x)', 'Höhe (y)', 'Tiefe (z)'] },
    r: { min: -180, max: 180, step: 5, rows: ['drehen (gier)', 'kippen (nick)', 'rollen (roll)'] },
  };
  const state = () => JSON.stringify({ parts, sel });
  function record() { const s = state(); if (hist[hist.length - 1] !== s) hist.push(s); if (hist.length > 80) hist.shift(); }
  function undo() {
    if (hist.length < 2) return;
    hist.pop();
    const s = JSON.parse(hist[hist.length - 1]);
    parts = s.parts; sel = s.sel;
    changed(false);
  }

  function changed(rec = true) {
    merged = mergeParts(parts);
    if (!smoothTouched) q('.w3-smooth').checked = allSmooth(parts);
    if (rec) record();
    drawParts(); drawEdit(); showModel();
  }
  function drawParts() {
    const el = q('.w3-parts');
    el.innerHTML = parts.length ? parts.map((p, i) => `<button data-i="${i}" class="${i === sel ? 'on' : ''}"><i style="background:${hex(p.c)}"></i>${i + 1} ${esc(formName(p.form))}</button>`).join('')
      : '<p class="side-note">Noch leer – tippe oben auf eine Grundform.</p>';
  }
  q('.w3-parts').addEventListener('click', (e) => { const b = e.target.closest('[data-i]'); if (b) select(+b.dataset.i); });
  function select(i) { sel = i; drawParts(); drawEdit(); viewer.redraw(); }

  function drawEdit() {
    const p = parts[sel];
    q('.w3-edit').hidden = !p;
    if (!p) return;
    root.querySelectorAll('.w3-seg [data-k]').forEach((b) => b.classList.toggle('on', b.dataset.k === editK));
    q('.w3-lock').hidden = editK !== 's';
    const sp = SPECS[editK];
    const rows = q('.w3-rows');
    if (rows.dataset.k !== editK || rows.dataset.sel !== String(sel)) {
      rows.dataset.k = editK; rows.dataset.sel = String(sel);
      rows.innerHTML = sp.rows.map((label, a) => `
        <div class="w3-axis" data-a="${a}">
          <span>${label}</span>
          <button data-d="-1" aria-label="weniger">−</button>
          <input type="range" min="${sp.min}" max="${sp.max}" step="${sp.step}">
          <button data-d="1" aria-label="mehr">+</button>
          <input type="number" step="${sp.step}" inputmode="decimal">
        </div>`).join('');
    }
    rows.querySelectorAll('.w3-axis').forEach((r) => {
      const v = p[editK][+r.dataset.a];
      const range = r.querySelector('[type=range]'), num = r.querySelector('[type=number]');
      range.value = v;
      if (document.activeElement !== num) num.value = fmtNum(v, editK === 'r' ? 1 : 2);
    });
    markPartColor(p.c);
  }
  function setAxis(a, v, rec) {
    const p = parts[sel];
    if (!p || !Number.isFinite(v)) return;
    const sp = SPECS[editK];
    if (editK === 's') v = Math.max(sp.min, v);
    if (editK === 'r') v = ((v + 180) % 360 + 360) % 360 - 180;
    if (editK === 's' && q('.w3-lock input').checked && p.s[a] > 0) {
      const k = v / p.s[a];
      p.s = p.s.map((x, j) => (j === a ? v : Math.max(sp.min, +(x * k).toFixed(3))));
    } else p[editK][a] = +v.toFixed(3);
    changed(rec);
  }
  q('.w3-seg').addEventListener('click', (e) => { const b = e.target.closest('[data-k]'); if (b) { editK = b.dataset.k; drawEdit(); } });
  const rowsEl = q('.w3-rows');
  rowsEl.addEventListener('input', (e) => {
    const r = e.target.closest('.w3-axis');
    if (r) setAxis(+r.dataset.a, parseFloat(e.target.value), false);
  });
  rowsEl.addEventListener('change', () => record());
  rowsEl.addEventListener('click', (e) => {
    const b = e.target.closest('[data-d]');
    if (!b) return;
    const a = +b.closest('.w3-axis').dataset.a;
    setAxis(a, parts[sel][editK][a] + +b.dataset.d * SPECS[editK].step * (editK === 'r' ? 3 : 2), true);
  });

  const FUN = [12, 11, 9, 8, 10, 14, 19, 28, 13, 3];   // neue Teile bekommen verschiedene Farben
  function topOf(p) { const g = geom(p.form); return p.p[1] + Math.max(0, g.box.hi[1]) * p.s[1]; }
  function addPart(form) {
    const y = parts.length ? Math.max(...parts.map(topOf)) : 0;
    const g = geom(form);
    const p = { form, p: [0, +(y - g.box.lo[1]).toFixed(3), 0], s: [1, 1, 1], r: [0, 0, 0], c: FUN[parts.length % FUN.length] };
    if (form === 'ebene') p.p[1] = +(y + 0.001).toFixed(3);
    parts.push(p);
    sel = parts.length - 1;
    changed(true);
    fitView(true);
  }
  q('.w3-forms').addEventListener('click', (e) => { const b = e.target.closest('[data-form]'); if (b) addPart(b.dataset.form); });

  root.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    if (!b || !root.contains(b)) return;
    const a = b.dataset.act;
    if (a === 'copy' && parts[sel]) { const c = JSON.parse(JSON.stringify(parts[sel])); c.p[0] += 0.5; parts.push(c); sel = parts.length - 1; changed(true); fitView(true); }
    if (a === 'del' && parts[sel]) { parts.splice(sel, 1); sel = Math.min(sel, parts.length - 1); changed(true); }
    if (a === 'undo') undo();
    if (a === 'clear' && (!parts.length || confirm('Alle Teile wegwerfen und neu anfangen?'))) { parts = []; sel = -1; buildNo = null; numTouched = false; smoothTouched = false; changed(true); refresh(); }
    if (a === 'view') fitView();
    if (a === 'mega') { api.makeMega(); refresh(); }
    if (a === 'sample') { texImg = null; loadOBJText(SAMPLE_OBJ, 'rakete.obj', parseMTL(SAMPLE_MTL)); }
    if (a === 'simplify') { target = clamp(Math.round(+q('.w3-target').value || 500), 12, 64000); rebuildObj(); }
    if (a === 'orig') { target = null; rebuildObj(); }
    if (a === 'open') openBlueprint(+b.dataset.n);
  });

  // in der Vorschau antippen: nächstes Teil (Mitte auf dem Bildschirm) auswählen
  function pick(x, y) {
    if (mode !== 'build' || !parts.length) return;
    let best = -1, bs = Infinity;
    parts.forEach((p, i) => {
      const s = viewer.g3.pos3d(...p.p);
      if (!s) return;
      const r = Math.max(14, viewer.focal() * Math.max(...p.s) * 0.6 / s[2]);
      const d = Math.hypot(s[0] - x, s[1] - y) / r + s[2] * 0.01;
      if (d < 1.2 && d < bs) { bs = d; best = i; }
    });
    if (best >= 0) select(best);
  }
  // Pfeiltasten in der Vorschau schieben das gewählte Teil
  canvas.addEventListener('keydown', (e) => {
    if (mode !== 'build') return;
    if ((e.ctrlKey || e.metaKey) && e.key === 'z') { e.preventDefault(); undo(); return; }
    const p = parts[sel];
    if (!p) return;
    const st = e.altKey ? 0.01 : 0.1;
    const mv = { ArrowLeft: [0, -st], ArrowRight: [0, st], ArrowUp: [e.shiftKey ? 1 : 2, st], ArrowDown: [e.shiftKey ? 1 : 2, -st], PageUp: [1, st], PageDown: [1, -st] }[e.key];
    if (mv) { e.preventDefault(); p.p[mv[0]] = +(p.p[mv[0]] + mv[1]).toFixed(3); changed(true); return; }
    if (e.key === '+' || e.key === '-') { e.preventDefault(); const k = e.key === '+' ? 1.1 : 1 / 1.1; p.s = p.s.map((v) => Math.max(0.05, +(v * k).toFixed(3))); changed(true); }
    if (e.key === 'r' || e.key === 'R') { e.preventDefault(); p.r[0] = ((p.r[0] + (e.shiftKey ? -15 : 15) + 180) % 360 + 360) % 360 - 180; changed(true); }
    if (e.key === 'Delete') { e.preventDefault(); parts.splice(sel, 1); sel = Math.min(sel, parts.length - 1); changed(true); }
  });

  function openBlueprint(n) {
    const b = findBlueprints(api.getCode()).find((x) => x.n === n);
    if (!b) return;
    parts = JSON.parse(JSON.stringify(b.parts)); sel = parts.length ? 0 : -1;
    buildNo = n; numTouched = false;
    q('.w3-smooth').checked = b.smooth; smoothTouched = true;
    setMode('build');
    changed(true);
    refresh();
    fitView();
  }

  // ---------------------------------------------------------------- OBJ
  function startSource(name) {
    objName = name; turns = []; simpCache.clear();
    target = null;
    q('.w3-target').value = api.isUltra?.() ? 15000 : 500;
    objNo = null; numTouched = false;
  }
  function loadOBJText(text, name, colors) {
    try { obj = parseOBJ(text); } catch (err) { info(`Die Datei ließ sich nicht lesen: ${err.message}`); return; }
    startSource(name);
    src = { kind: 'obj' };
    if (colors) mtl = colors;
    setMode('obj');
    if (!obj.tris.length) { objModel = null; objMesh = null; info(`In „${esc(name)}“ wurden keine Flächen gefunden. Ist es wirklich eine OBJ-Datei?`); showModel(); return; }
    refresh();
    rebuildObj();
    fitView();
  }
  // Bild im Browser lesen und auf höchstens max Bildpunkte Kantenlänge bringen
  async function decodeImage(bytes, mime, max) {
    const bmp = await createImageBitmap(new Blob([bytes], { type: mime || 'image/png' }));
    const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const w = Math.max(1, Math.round(bmp.width * k)), h = Math.max(1, Math.round(bmp.height * k));
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.imageSmoothingQuality = 'high';
    g.drawImage(bmp, 0, 0, w, h);
    bmp.close?.();
    return { w, h, rgba: new Uint8Array(g.getImageData(0, 0, w, h).data.buffer) };
  }
  const texSize = () => +q('.w3-texsize').value || 512;
  async function importSource() {
    info(`<b>${esc(objName)}</b> wird gelesen …`);
    try {
      const r = await importGLTF(src.files, { decodeImage, texSize: texSize() });
      src.mesh = r.mesh; src.warn = r.warn; src.stats = r.stats;
      if (r.mesh.info.quelle && !q('.w3-lic').value) q('.w3-lic').value = r.mesh.info.quelle;
    } catch (err) { src.mesh = null; info(`Das Modell ließ sich nicht lesen: ${esc(err.message)}`); objMesh = null; objModel = null; showModel(); return false; }
    simpCache.clear();
    return true;
  }
  async function loadFiles(files) {
    files = [...files];
    const glt = files.find((f) => /\.(glb|gltf)$/i.test(f.name));
    for (const f of files) if (/\.(png|jpe?g)$/i.test(f.name)) imgFiles.set(f.name.toLowerCase(), f);
    if (glt) {
      const total = files.reduce((n, f) => n + f.size, 0);
      if (total > 96 * 1024 * 1024) { setMode('obj'); info('Diese Dateien sind zu groß (mehr als 96 MB). Bitte im 3D-Programm vorher verkleinern.'); return; }
      const map = new Map();
      for (const f of files) map.set(f.name, new Uint8Array(await f.arrayBuffer()));
      startSource(glt.name);
      q('.w3-lic').value = '';
      src = { kind: 'gltf', files: map };
      setMode('obj');
      if (!(await importSource())) return;
      refresh();
      rebuildObj();
      fitView();
      return;
    }
    const m = files.find((f) => /\.mtl$/i.test(f.name)), o = files.find((f) => /\.obj$/i.test(f.name));
    if (m) mtl = parseMTL(await m.text());
    // OBJ-Textur (map_Kd): das erste Bild, das die .mtl nennt und das mit ausgewählt wurde
    texImg = null;
    for (const nm of mtl.maps?.values() || []) {
      const f = imgFiles.get(nm.split(/[\\/]/).pop().toLowerCase());
      if (f) { try { texImg = await decodeImage(new Uint8Array(await f.arrayBuffer()), f.type, texSize()); } catch { texImg = null; } break; }
    }
    if (o) {
      if (o.size > 8 * 1024 * 1024) { setMode('obj'); info('Diese Datei ist zu groß (mehr als 8 MB). Bitte im 3D-Programm vorher verkleinern.'); return; }
      loadOBJText(await o.text(), o.name, null);
    } else if (m && obj) rebuildObj();
    else if (m) { setMode('obj'); info(`Farben aus „${esc(m.name)}“ geladen. Jetzt noch die .obj-Datei wählen.`); }
  }
  q('.w3-file').addEventListener('change', (e) => { loadFiles(e.target.files); e.target.value = ''; });
  root.querySelectorAll('input[name="w3col"]').forEach((r) => r.addEventListener('change', rebuildObj));
  q('.w3-ground').addEventListener('change', () => { rebuildObj(); fitView(); });
  root.querySelectorAll('[data-turn]').forEach((b) => b.addEventListener('click', () => { turns.push([b.dataset.turn, 1]); rebuildObj(); fitView(); }));
  q('.w3-texsize').addEventListener('change', async () => { if (src?.kind === 'gltf' && await importSource()) { rebuildObj(); } });
  function info(html) { q('.w3-info').innerHTML = html; }
  function rebuildObj() {
    if (!src) return;
    if (src.kind === 'obj' && (!obj || !obj.tris.length)) return;
    if (src.kind === 'gltf' && !src.mesh) return;
    const useFile = root.querySelector('input[name="w3col"]:checked').value === 'file';
    let base = src.kind === 'gltf' ? src.mesh : objToMesh(obj, { colors: mtl, image: texImg });
    if (!useFile) {
      const rgb = DEFAULT_PALETTE[objColor] & 0xffffff;
      base = { ...base, col: new Uint32Array(base.pos.length / 3).fill(rgb), tex: null, uv: null };
    }
    const orig = base.idx.length / 3;
    // Vereinfachen kostet bei großen Modellen etwas Zeit – Ergebnis merken (Drehen rechnet dann nicht neu)
    let m = base;
    if (target && orig > target) {
      const key = `${target}|${useFile ? 'f' : objColor}`;
      if (!simpCache.has(key)) simpCache.set(key, simplifyMesh(base, target));
      m = simpCache.get(key);
    }
    for (const [axis, qq] of turns) m = turnMesh(m, axis, qq);
    m = normalizeMesh(m, q('.w3-ground').checked);
    objMesh = m;
    objModel = meshToChip(m);
    const n = m.idx.length / 3, ultra = !!api.isUltra?.();
    const noColor = src.kind === 'obj' && useFile && !obj.mats.some((nm) => mtl.has(nm)) && !obj.vcol;
    const cols = m.col ? new Set(m.col).size : 0;
    const warns = (src.warn || []).slice(0, 3);
    info(`<b>${esc(objName)}</b>: ${m.pos.length / 3} Punkte · ${n} Dreiecke${target && orig > n ? ` (vorher ${orig})` : ''}` +
      (m.tex ? ` · Textur ${m.tex.w}×${m.tex.h}` : '') + (cols ? ` · ${cols} ${cols === 1 ? 'Farbe' : 'Farben'}` : '') +
      (src.kind === 'obj' && obj.polys ? ` · ${obj.polys} Vielecke in Dreiecke zerlegt` : '') +
      (noColor && obj.mats.length ? `<br>Die Datei nennt Farben (${esc(obj.mats.slice(0, 3).join(', '))}${obj.mats.length > 3 ? ', …' : ''}), aber die passende <code>${esc(obj.libs[0] || '.mtl')}</code> fehlt – wähle sie mit aus oder nimm „eine für alles“.` : '') +
      (src.kind === 'obj' && mtl.maps?.size && !texImg && useFile ? `<br>Die .mtl nennt ein Bild (<code>${esc([...mtl.maps.values()][0])}</code>) – wähle es mit aus, dann kommt die Textur mit.` : '') +
      (warns.length ? `<br>${warns.map(esc).join('<br>')}` : ''));
    q('.w3-objctl').hidden = false;
    const warn = q('.w3-warn');
    if (ultra) {
      warn.className = 'w3-warn' + (n > 64000 ? ' bad' : n > 30000 ? ' meh' : ' good');
      warn.textContent = n > 64000 ? 'Mehr als 64.000 Dreiecke – so zeichnet der 8BOY 64 das Modell gar nicht. Bitte vereinfachen.'
        : n > 30000 ? 'Sehr detailreich: Das Modell braucht fast die Hälfte des ganzen Bildes. Für Spiele lieber 2.000–15.000.'
          : 'Gute Größe für den 8BOY 64.';
    } else {
      warn.className = 'w3-warn' + (n > 1500 ? ' bad' : n > 600 ? ' meh' : ' good');
      warn.textContent = n > 1500 ? `Sehr viele Dreiecke! Der 8BOY 32 schafft etwa 2000 pro Bild – bitte vereinfachen.`
        : n > 600 ? 'Geht, aber ziemlich viele Dreiecke. Für mehrere Modelle im Bild lieber vereinfachen.'
          : 'Gute Größe für den 8BOY 32.';
    }
    showModel();
    showCost(orig);
  }
  // Kosten: Größe in der Kartridge und Ladezeit (8BOY 64: gepackter Block, 8BOY 32: Lua-Text)
  let costTok = 0;
  async function showCost(orig) {
    const tok = ++costTok, m = objMesh, el = q('.w3-cost');
    if (!m) { el.textContent = ''; return; }
    el.textContent = 'Kosten werden berechnet …';
    await new Promise((r) => setTimeout(r, 20));
    if (tok !== costTok) return;
    if (!api.isUltra?.()) {
      const lua = modelToLua(0, toChipModel(m)).code;
      el.innerHTML = `Kosten in der Kartridge: <b>${Math.round(lua.length / 1024)} KB</b> Lua-Text · ${m.idx.length / 3} Dreiecke`;
      return;
    }
    const z = await deflate(packModel(m));
    if (tok !== costTok) return;
    const b64 = toBase64(z), t0 = performance.now();
    decodeModelBlock(b64);
    const ms = performance.now() - t0;
    el.innerHTML = `Kosten in der Kartridge: <b>${Math.max(1, Math.round(b64.length / 1024))} KB</b> · Laden etwa <b>${Math.max(1, Math.round(ms))} ms</b> · ${m.idx.length / 3} Dreiecke` +
      (orig > m.idx.length / 3 ? ` (Original ${orig})` : '') + (m.tex ? ` · Textur ${m.tex.w}×${m.tex.h} mit bis zu 256 Farben` : '');
  }
  // Netz → Palettenmodell für den 8BOY 32 (Punkte gleicher Lage zusammengefasst)
  function toChipModel(m) {
    const c = meshToChip(m);
    return cleanModel({ v: Array.from(c.v), f: c.f.map((f) => ({ i: f.i, c: f.c })) });
  }

  // ---------------------------------------------------------------- Vorschau
  function current() { return mode === 'build' ? merged : objModel; }
  function showModel() {
    const m = current();
    const g3 = viewer.g3;
    const smooth = q('.w3-smooth').checked;
    if (m && m.f.length) {
      if (mode === 'obj' && objModel === m) g3.modelMesh(0, m);
      else { const { pts, faces } = toFlat(m); g3.modelData(0, pts, faces, smooth, false); }
    }
    q('.w3-tris').textContent = m && m.f.length ? `${m.f.length} Dreiecke` : '';
    const floorY = mode === 'obj' && m && m.v.length ? bounds(m.v).lo[1] : 0;
    viewer.setScene((g) => {
      floorGrid(g, floorY);
      if (m && m.f.length) g.draw3d(0, 0, 0, 0, 0, 0, 0, 1);
      // gewähltes Teil: gelber Rahmen
      const p = mode === 'build' && parts[sel];
      if (p) {
        const { lo, hi } = geom(p.form).box, T = partTransform(p);
        const c = [];
        for (const x of [lo[0], hi[0]]) for (const y of [lo[1], Math.max(hi[1], lo[1] + 0.001)]) for (const z of [lo[2], hi[2]]) c.push(T(x, y, z));
        for (const [a, b] of [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]]) g.line3d(...c[a], ...c[b], 10);
      }
    });
  }
  // Modell ganz ins Bild holen; keep = Blickrichtung behalten (beim Weiterbauen)
  function fitView(keep = false) {
    const m = current();
    if (!m || !m.v.length) { viewer.reset(); return; }
    const { lo, hi } = bounds(m.v);
    const size = Math.max(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2], 1);
    const t = [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2], d = size * 2.2 + 0.8;
    if (keep) viewer.frame(t, d); else viewer.reset(t, d);
  }
  q('.w3-smooth').addEventListener('change', () => { smoothTouched = true; showModel(); });

  function setMode(m) {
    const prev = mode;
    mode = m;
    root.querySelectorAll('.w3-mode [data-mode]').forEach((b) => b.classList.toggle('on', b.dataset.mode === m));
    q('.w3-build').hidden = m !== 'build';
    q('.w3-obj').hidden = m !== 'obj';
    if (m === 'obj' && !smoothTouched) q('.w3-smooth').checked = false;
    // geladene Modelle auf dem 8BOY 64: Vorschau mit echten Farben und Texturen auf der Grafikkarte
    viewer.setGpu(m === 'obj' && !!api.isUltra?.());
    root.querySelectorAll('.w3-ultra-only').forEach((el) => { el.hidden = !api.isUltra?.(); });
    if (m === 'build' && !smoothTouched) q('.w3-smooth').checked = allSmooth(parts);
    if (prev !== m) { numTouched = false; refresh(); }
    showModel();
  }
  q('.w3-mode').addEventListener('click', (e) => { const b = e.target.closest('[data-mode]'); if (b) { setMode(b.dataset.mode); fitView(); } });

  // ---------------------------------------------------------------- Einfügen
  q('.w3-n').addEventListener('input', () => { numTouched = true; });
  q('.w3-insert').addEventListener('click', async () => {
    const m = current();
    if (!m || !m.f.length) { api.print(mode === 'build' ? 'Erst ein paar Teile bauen – tippe auf eine Grundform.' : 'Erst ein Modell laden (glTF oder OBJ).'); return; }
    const n = clamp(Math.round(+q('.w3-n').value), 0, 63);
    if (!Number.isFinite(n)) return;
    const smooth = q('.w3-smooth').checked;
    const note = objName.replace(/[\r\n]/g, '');
    let code, data = null;
    if (mode === 'build') code = blueprintText(n, parts, smooth) + modelToLua(n, m, { smooth, note: `${parts.length} ${parts.length === 1 ? 'Teil' : 'Teile'} aus der 3D-Werkstatt` }).code;
    else if (api.isUltra?.()) {
      // 8BOY 64: Modell gepackt als Block ans Ende der Kartridge, im Code nur modelload
      const name = (objName.replace(/\.[^.]+$/, '').toLowerCase().replace(/[äöüß]/g, (c) => ({ ä: 'ae', ö: 'oe', ü: 'ue', ß: 'ss' }[c])).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'modell').slice(0, 32);
      const herkunft = q('.w3-lic').value.trim().replace(/[\r\n]/g, ' ');
      const packed = await deflate(packModel({ ...objMesh, info: { ...objMesh.info, name, herkunft } }));
      data = { name, text: modelBlockText(name, packed) };
      code = `-- Modell ${n}: ${note}${herkunft ? ' · ' + herkunft : ''} (${objMesh.idx.length / 3} Dreiecke${objMesh.tex ? ', Textur' : ''}; Daten im Block „8boy-modell ${name}“ am Ende)\n` +
        `modelload(${n}, "${name}")\n`;
    } else code = modelToLua(n, toChipModel(objMesh), { smooth, note }).code;
    const res = api.insert(n, code, { draw: q('.w3-draw').checked, where: q('.w3-where').value, data });
    if (res) { if (mode === 'build') buildNo = n; else objNo = n; numTouched = false; }
    refresh();
  });

  // vom Editor gerufen, wenn sich der Code geändert hat oder der Tab aufgeht
  function refresh() {
    const code = api.getCode();
    q('.w3-mega').hidden = api.isMega();
    const ultra = !!api.isUltra?.();
    root.querySelectorAll('.w3-ultra-only').forEach((el) => { el.hidden = !ultra; });
    // Konsole gewechselt: Vorschau und Hinweise passend zum 8BOY 64 bzw. 8BOY 32
    if (mode === 'obj' && lastUltra !== ultra) { viewer.setGpu(ultra); if (src) rebuildObj(); else showModel(); }
    lastUltra = ultra;
    const bps = findBlueprints(code);
    q('.w3-open').innerHTML = bps.length ? `<div class="w3-label">Im Code gefunden</div><div class="w3-acts">${bps.map((b) => `<button class="tb${b.n === buildNo ? ' on' : ''}" data-act="open" data-n="${b.n}">Modell ${b.n} öffnen</button>`).join('')}</div>` : '';
    if (!numTouched) q('.w3-n').value = (mode === 'build' ? buildNo : objNo) ?? freeModelNumber(code);
    viewer.wake();
  }

  drawParts();
  record();
  showModel();
  return {
    refresh,
    loadFiles,
    get mode() { return mode; },
    // für Tests
    get parts() { return parts; }, get model() { return current(); }, addPart, select, viewer,
  };
}

// ------------------------------------------------------------------ Textur-Vorschau für das Malprogramm
export function createTexturePreview(root) {
  root.classList.add('tx3d');
  root.innerHTML = `
    <canvas class="tx3d-canvas" aria-label="Sprite als Textur in 3D – ziehen dreht"></canvas>
    <div class="tx3d-ctl">
      <b>3D-Probe</b>
      <div class="w3-seg">${[['wuerfel', 'Würfel'], ['kugel', 'Kugel'], ['ebene', 'Ebene']].map(([f, n], i) => `<button data-f="${f}"${i ? '' : ' class="on"'}>${n}</button>`).join('')}</div>
      <label class="w3-chk" title="Textur 3×3-mal wiederholen – so sieht man, ob die Ränder zusammenpassen"><input type="checkbox" class="tx3d-tile"> 3×3 Kacheln</label>
      <label class="w3-chk"><input type="checkbox" class="tx3d-spin" checked> dreht sich</label>
    </div>`;
  const canvas = root.querySelector('canvas');
  const v = createViewer(canvas, { w: 160, h: 120, spin: true, sky: [0x23283e, 0x4b5372], fps: 30 });
  let form = 'wuerfel', rows = null;
  v.reset([0, 0, 0], 2.3);
  function build() {
    const g3 = v.g3;
    g3.model(0, form, 7);
    const tile = root.querySelector('.tx3d-tile').checked ? 3 : 1;
    if (rows) { try { v.gfx.defineSprite(1, rows); g3.mtex(0, 1, 0, tile); } catch { /* leeres Sprite */ } }
    v.setScene((g) => {
      // Ebene: groß und liegend, damit man die Kacheln gut sieht
      if (form === 'ebene') g.draw3d(0, 0, 0, 0, 0, -0.6, 0, 1.6);
      else g.draw3d(0, 0, 0, 0, 0, 0, 0, form === 'kugel' ? 1.25 : 1.05);
    });
  }
  root.querySelector('.w3-seg').addEventListener('click', (e) => {
    const b = e.target.closest('[data-f]');
    if (!b) return;
    form = b.dataset.f;
    root.querySelectorAll('[data-f]').forEach((x) => x.classList.toggle('on', x === b));
    build();
  });
  root.querySelector('.tx3d-tile').addEventListener('change', build);
  root.querySelector('.tx3d-spin').addEventListener('change', (e) => { v.spin = e.target.checked; v.wake(); });
  build();
  return {
    setSprite(r) { rows = r; build(); },
    wake: () => v.wake(),
    viewer: v,
  };
}
