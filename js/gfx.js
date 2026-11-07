// 8BOY Grafik-Chip. Zwei Betriebsarten:
//   8BOY        240x160 Pixel, 32 Farben aus 15-Bit-RGB, eine Karte
//   8BOY 16  256x224 Pixel, 256 Farben in 8 Paletten zu je 32, vier Karten-Ebenen, Perspektivboden,
//               gedrehte Sprites, Transparenz, Wellen, Mosaik, Helligkeit und Himmelsverlauf je Bildzeile
//   8BOY 32    320x240, alles vom 8BOY 16 plus ein 3D-Chip (js/gfx3d.js) mit eigenem RGB-Bild hinter dem 2D-Bild
// Alles wird in einen Index-Framebuffer gezeichnet; present() wandelt ihn über die Palette in RGBA.
import { GLYPHS, FALLBACK, GLYPH_H, ADVANCE, LINE_H } from './font.js';
import { createUiEbene } from './ui-ebene.js';
import { attach3D } from './gfx3d.js';

// Maße der 8BOY-Grundausstattung (ältere Module rechnen damit; aktuelle Maße stehen in gfx.w / gfx.h)
export const W = 240;
export const H = 160;
export const MAP_W = 256;
export const MAP_H = 128;
export const MAX_SPRITES = 256;
export const TRANSPARENT = 255;

export const DEFAULT_PALETTE = [
  0x0b0b12, 0x1c2340, 0x4a2a5a, 0x1e6b4a, 0x8a4b2e, 0x4b4e5e, 0xa9adbd, 0xf5f2e8,
  0xe43b44, 0xf7922b, 0xfee761, 0x63c74d, 0x3c9cf0, 0x8b7bb8, 0xf27ca8, 0xf6c7a0,
  0x262b44, 0x3a4466, 0x124e89, 0x0099db, 0x2ce8f5, 0x193c3e, 0x265c42, 0x3e8948,
  0xb86f50, 0x733e39, 0x3e2731, 0xa22633, 0xfeae34, 0xc0cbdc, 0x8b9bb4, 0xead4aa,
];

// 8BOY 16: sieben weitere Paletten als Abwandlungen der Grundfarben (Palettentausch für Sprites)
// und eine Palette mit vier Verläufen zu je 8 Stufen
const rgbOf = (c) => [c >> 16 & 255, c >> 8 & 255, c & 255];
const pack = (r, g, b) => (Math.max(0, Math.min(255, Math.round(r))) << 16) | (Math.max(0, Math.min(255, Math.round(g))) << 8) | Math.max(0, Math.min(255, Math.round(b)));
const lum = (r, g, b) => 0.3 * r + 0.59 * g + 0.11 * b;
const BANKS = [
  (r, g, b) => [r, g, b],                                                         // 0 Standard
  (r, g, b) => [r * 0.45, g * 0.5, b * 0.75 + 20],                                // 1 Nacht
  (r, g, b) => [r * 1.05 + 30, g * 0.8 + 10, b * 0.55],                           // 2 Abendrot
  (r, g, b) => { const l = lum(r, g, b); return [l, l, l]; },                     // 3 Graustufen
  (r, g, b) => { const l = lum(r, g, b); return [l * 0.7 + 40, l * 0.85 + 40, l + 50]; }, // 4 Eis
  (r, g, b) => { const l = lum(r, g, b); return [l + 90, l * 0.75 + 20, l * 0.25]; },    // 5 Glut
  (r, g, b) => [r * 0.5 + 120, g * 0.5 + 125, b * 0.5 + 135],                     // 6 Geist
];
const RAMPS = [[0x0d1b4a, 0x9fe4ff], [0x0e2a12, 0xb6f26b], [0x3a0a0a, 0xfff0a0], [0x101018, 0xf0f0f8]];
export const SUPER_PALETTE = (() => {
  const out = [];
  BANKS.forEach((f) => DEFAULT_PALETTE.forEach((c) => out.push(pack(...f(...rgbOf(c))))));
  for (const [a, b] of RAMPS) for (let k = 0; k < 8; k++) {
    const A = rgbOf(a), B = rgbOf(b), t = k / 7;
    out.push(pack(A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t));
  }
  return out;
})();

// Retro-LCD: Helligkeit auf vier eigene Grüntöne abbilden (Einstellung „Farbe: Retro-LCD“)
const CLASSIC = [0x10291a, 0x2e5a3a, 0x6f9e4a, 0xbcd88c];

const q5 = (v) => Math.round((v & 255) / 255 * 31) * 255 / 31 | 0;
export const quantize = (rgb) => (q5(rgb >> 16) << 16) | (q5(rgb >> 8) << 8) | q5(rgb);

// Pixelzeichen in Sprite-Daten: '.' = durchsichtig, 0-9 und a-v = Farbe 0-31
export function charToColor(ch) {
  if (ch === '.' || ch === ' ') return TRANSPARENT;
  const n = parseInt(ch, 32);
  return Number.isNaN(n) ? TRANSPARENT : n;
}

export function parsePixelRows(text) {
  const rows = String(text).split(/\r?\n/).map((r) => r.trim()).filter((r) => r.length);
  const h = rows.length;
  const w = rows.reduce((m, r) => Math.max(m, r.length), 0);
  const data = new Uint8Array(w * h).fill(TRANSPARENT);
  rows.forEach((r, y) => { for (let x = 0; x < r.length; x++) data[y * w + x] = charToColor(r[x]); });
  return { w, h, data };
}

const BASE = { w: W, h: H, colors: 32, layers: 1 };

export function createGfx(machine = BASE) {
  let W = 0, H = 0, NC = 32, CM = 31;
  let fb, palette, remap, maps, map, under, bmode, lineBg, rgb3 = null, zb3 = null;
  const sprites = new Array(MAX_SPRITES).fill(null);
  const ui = createUiEbene();   // scharfe Schrift und Kästen über dem Bild (ab 8BOY 64, js/ui-ebene.js)
  const flags = new Uint8Array(MAX_SPRITES);
  const s = { camX: 0, camY: 0, clipX0: 0, clipY0: 0, clipX1: 0, clipY1: 0, classic: false, blend: 0, bright: 15, layer: 0, m7: null };

  function defaultPalette() { return (NC > 32 ? SUPER_PALETTE : DEFAULT_PALETTE).map(quantize); }

  // Betriebsart wechseln (8BOY 16 spielt 8BOY-Kartridges mit deren eigenem Bildschirm)
  function setMode(m = BASE) {
    W = m.w; H = m.h; NC = m.colors; CM = NC - 1;
    fb = new Uint8Array(W * H);
    palette = defaultPalette();
    remap = new Uint8Array(NC);
    maps = Array.from({ length: m.layers || 1 }, () => new Uint8Array(MAP_W * MAP_H));
    map = maps[0];
    under = NC > 32 ? new Uint8Array(W * H) : null;
    bmode = NC > 32 ? new Uint8Array(W * H) : null;
    lineBg = new Int32Array(H).fill(-1);
    // 8BOY 64 mit Grafikkarte: das 3D-Bild entsteht in der GPU, kein Software-Bildspeicher nötig
    gpuMode = !!(m.gpu && gpuChip);
    rgb3 = m.three && !gpuMode ? new Uint32Array(W * H) : null;
    zb3 = m.three && !gpuMode ? new Float32Array(W * H) : null;
    s.layer = 0; s.blend = 0; s.bright = 15; s.m7 = null; s.use3d = false;
    if (soft3) soft3.reset();
    if (gpuChip) gpuChip.reset();
    resetDrawState();
  }

  function resetDrawState() {
    for (let i = 0; i < NC; i++) remap[i] = i;
    s.camX = 0; s.camY = 0;
    s.clipX0 = 0; s.clipY0 = 0; s.clipX1 = W; s.clipY1 = H;
    s.blend = 0;
  }
  function resetAll() {
    resetDrawState();
    palette.splice(0, palette.length, ...defaultPalette());
    sprites.fill(null); flags.fill(0); maps.forEach((m) => m.fill(0)); fb.fill(0);
    map = maps[0]; s.layer = 0; s.bright = 15; s.m7 = null;
    lineBg.fill(-1);
    if (bmode) bmode.fill(0);
    if (soft3) soft3.reset();
    if (gpuChip && gpuMode) gpuChip.reset();
    if (rgb3) rgb3.fill(0);
    ui.reset();
  }
  // 3D-Chip (8BOY 32, ohne Grafikkarte auch 8BOY 64): bekommt Bildgröße, RGB- und Tiefenspeicher, Palette und Sprites
  let soft3 = null, gpuChip = null, gpuMode = false;
  const ctx3 = {
    get W() { return W; }, get H() { return H; }, get rgb() { return rgb3; }, get zb() { return zb3; },
    get palette() { return palette; }, get remap() { return remap; }, sprites, state: s,
  };
  soft3 = attach3D(ctx3);
  setMode(machine);
  // 8BOY 64: Grafikchip auf der Grafikkarte anmelden (main.js, nur im Browser mit WebGL2)
  function attachGpu(factory) {
    gpuChip = factory(ctx3);
    return gpuChip;
  }

  const col = (c) => remap[(c | 0) & CM];

  // Ein Pixel in den Bildspeicher; bei Transparenz merkt sich der Chip die Farbe darunter
  function put(i, c) {
    if (s.blend) { under[i] = bmode[i] ? under[i] : fb[i]; bmode[i] = s.blend; } else if (bmode) bmode[i] = 0;
    fb[i] = c;
  }

  // Bildschirmkoordinaten, schon um die Kamera verschoben
  function plot(x, y, c) {
    if (x < s.clipX0 || y < s.clipY0 || x >= s.clipX1 || y >= s.clipY1) return;
    if (bmode) put(y * W + x, c); else fb[y * W + x] = c;
  }
  function hspan(x0, x1, y, c) {
    if (y < s.clipY0 || y >= s.clipY1) return;
    if (x0 > x1) [x0, x1] = [x1, x0];
    x0 = Math.max(x0, s.clipX0); x1 = Math.min(x1, s.clipX1 - 1);
    if (x0 > x1) return;
    if (bmode) { for (let i = y * W + x0, e = y * W + x1; i <= e; i++) put(i, c); return; }
    fb.fill(c, y * W + x0, y * W + x1 + 1);
  }

  function cls(c = 0) { fb.fill(col(c)); if (bmode) bmode.fill(0); }
  function pset(x, y, c) { plot(Math.floor(x) - s.camX, Math.floor(y) - s.camY, col(c)); }
  function pget(x, y) {
    x = Math.floor(x) - s.camX; y = Math.floor(y) - s.camY;
    return x < 0 || y < 0 || x >= W || y >= H ? 0 : fb[y * W + x];
  }
  function line(x0, y0, x1, y1, c) {
    c = col(c);
    x0 = Math.floor(x0) - s.camX; y0 = Math.floor(y0) - s.camY;
    x1 = Math.floor(x1) - s.camX; y1 = Math.floor(y1) - s.camY;
    const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (let n = 0; n < 2000; n++) {
      plot(x0, y0, c);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
    }
  }
  function rect(x, y, w, h, c) {
    x = Math.floor(x); y = Math.floor(y); w = Math.floor(w); h = Math.floor(h);
    if (w <= 0 || h <= 0) return;
    const cc = col(c), X = x - s.camX, Y = y - s.camY;
    hspan(X, X + w - 1, Y, cc); hspan(X, X + w - 1, Y + h - 1, cc);
    for (let i = 1; i < h - 1; i++) { plot(X, Y + i, cc); plot(X + w - 1, Y + i, cc); }
  }
  function rectfill(x, y, w, h, c) {
    x = Math.floor(x); y = Math.floor(y); w = Math.floor(w); h = Math.floor(h);
    if (w <= 0 || h <= 0) return;
    const cc = col(c), X = x - s.camX, Y = y - s.camY;
    for (let i = 0; i < h; i++) hspan(X, X + w - 1, Y + i, cc);
  }
  function circ(cx, cy, r, c) {
    const cc = col(c); cx = Math.floor(cx) - s.camX; cy = Math.floor(cy) - s.camY; r = Math.floor(r);
    let x = r, y = 0, err = 1 - r;
    while (x >= y) {
      plot(cx + x, cy + y, cc); plot(cx + y, cy + x, cc); plot(cx - y, cy + x, cc); plot(cx - x, cy + y, cc);
      plot(cx - x, cy - y, cc); plot(cx - y, cy - x, cc); plot(cx + y, cy - x, cc); plot(cx + x, cy - y, cc);
      y++;
      if (err < 0) err += 2 * y + 1; else { x--; err += 2 * (y - x) + 1; }
    }
  }
  function circfill(cx, cy, r, c) {
    const cc = col(c); cx = Math.floor(cx) - s.camX; cy = Math.floor(cy) - s.camY; r = Math.floor(r);
    let x = r, y = 0, err = 1 - r;
    while (x >= y) {
      hspan(cx - x, cx + x, cy + y, cc); hspan(cx - x, cx + x, cy - y, cc);
      hspan(cx - y, cx + y, cy + x, cc); hspan(cx - y, cx + y, cy - x, cc);
      y++;
      if (err < 0) err += 2 * y + 1; else { x--; err += 2 * (y - x) + 1; }
    }
  }

  // Text: gibt die Breite in Pixeln zurück, \n bricht um
  function text(str, x, y, c = 7, scale = 1) {
    const cc = col(c);
    scale = Math.max(1, Math.floor(scale));
    let X = Math.floor(x) - s.camX, Y = Math.floor(y) - s.camY;
    const X0 = X;
    let widest = 0;
    for (const ch of String(str)) {
      if (ch === '\n') { widest = Math.max(widest, X - X0); X = X0; Y += LINE_H * scale; continue; }
      const g = GLYPHS.get(ch) || FALLBACK;
      for (let r = 0; r < GLYPH_H; r++) {
        const bits = g[r];
        if (!bits) continue;
        for (let b = 0; b < 5; b++) {
          if (!(bits & (16 >> b))) continue;
          if (scale === 1) plot(X + b, Y + r, cc);
          else for (let k = 0; k < scale; k++) hspan(X + b * scale, X + b * scale + scale - 1, Y + r * scale + k, cc);
        }
      }
      X += ADVANCE * scale;
    }
    return Math.max(widest, X - X0);
  }
  const textWidth = (str, scale = 1) => (Math.max(...String(str).split('\n').map((l) => [...l].length)) * ADVANCE - 1) * scale;

  function defineSprite(n, rowsText) {
    if (n < 0 || n >= MAX_SPRITES) throw new Error(`Sprite-Nummer ${n} ungültig (0-${MAX_SPRITES - 1})`);
    sprites[n] = parsePixelRows(rowsText);
  }
  // bank (nur 8BOY 16): Palette 0-7, die Sprite-Farben 0-31 werden zu bank*32 + Farbe
  function spr(n, x, y, flipX = false, flipY = false, scale = 1, bank = 0) {
    const sp = sprites[n | 0];
    if (!sp) return;
    scale = Math.max(1, Math.floor(scale));
    const off = NC > 32 ? ((bank | 0) & 7) * 32 : 0;
    const X = Math.floor(x) - s.camX, Y = Math.floor(y) - s.camY;
    const { w, h, data } = sp;
    if (X >= s.clipX1 || Y >= s.clipY1 || X + w * scale <= s.clipX0 || Y + h * scale <= s.clipY0) return;
    for (let py = 0; py < h * scale; py++) {
      const sy = flipY ? h - 1 - ((py / scale) | 0) : (py / scale) | 0;
      const yy = Y + py;
      if (yy < s.clipY0 || yy >= s.clipY1) continue;
      for (let px = 0; px < w * scale; px++) {
        const sx = flipX ? w - 1 - ((px / scale) | 0) : (px / scale) | 0;
        const c = data[sy * w + sx];
        if (c === TRANSPARENT) continue;
        const xx = X + px;
        if (xx < s.clipX0 || xx >= s.clipX1) continue;
        if (bmode) put(yy * W + xx, remap[c + off]); else fb[yy * W + xx] = remap[c];
      }
    }
  }
  const spriteSize = (n) => { const sp = sprites[n | 0]; return sp ? [sp.w, sp.h] : [0, 0]; };

  // 8BOY 16: Sprite um seinen Mittelpunkt drehen und stufenlos vergrößern (wie die Affin-Sprites der 16-Bit-Zeit)
  function rspr(n, cx, cy, angle = 0, scale = 1, bank = 0, flipX = false) {
    const sp = sprites[n | 0];
    if (!sp || !scale) return;
    const { w, h, data } = sp;
    const off = ((bank | 0) & 7) * 32;
    const ca = Math.cos(angle), sa = Math.sin(angle);
    const R = Math.ceil(Math.hypot(w, h) * Math.abs(scale) / 2) + 1;
    const X = cx - s.camX, Y = cy - s.camY;
    const y0 = Math.max(s.clipY0, Math.floor(Y - R)), y1 = Math.min(s.clipY1, Math.ceil(Y + R));
    const x0 = Math.max(s.clipX0, Math.floor(X - R)), x1 = Math.min(s.clipX1, Math.ceil(X + R));
    const inv = 1 / scale;
    for (let yy = y0; yy < y1; yy++) {
      const dy = yy + 0.5 - Y;
      for (let xx = x0; xx < x1; xx++) {
        const dx = xx + 0.5 - X;
        // Rückwärts drehen: welcher Sprite-Pixel landet hier?
        let u = (dx * ca + dy * sa) * inv + w / 2, v = (-dx * sa + dy * ca) * inv + h / 2;
        if (u < 0 || v < 0 || u >= w || v >= h) continue;
        if (flipX) u = w - 1 - u;
        const c = data[(v | 0) * w + (u | 0)];
        if (c === TRANSPARENT) continue;
        put(yy * W + xx, remap[c + off]);
      }
    }
  }

  function mget(x, y) {
    x = Math.floor(x); y = Math.floor(y);
    return x < 0 || y < 0 || x >= MAP_W || y >= MAP_H ? 0 : map[y * MAP_W + x];
  }
  function mset(x, y, n) {
    x = Math.floor(x); y = Math.floor(y);
    if (x >= 0 && y >= 0 && x < MAP_W && y < MAP_H) map[y * MAP_W + x] = n & 255;
  }
  // Zeichnet Kartenzellen als 8x8-Kacheln; nur sichtbare Zellen werden angefasst
  function drawMap(cx = 0, cy = 0, sx = 0, sy = 0, w = MAP_W, h = MAP_H) {
    const i0 = Math.max(0, Math.floor((s.camX - sx) / 8) - 1), i1 = Math.min(w, Math.ceil((s.camX + W - sx) / 8) + 1);
    const j0 = Math.max(0, Math.floor((s.camY - sy) / 8) - 1), j1 = Math.min(h, Math.ceil((s.camY + H - sy) / 8) + 1);
    for (let j = j0; j < j1; j++) for (let i = i0; i < i1; i++) {
      const n = mget(cx + i, cy + j);
      if (n) spr(n, sx + i * 8, sy + j * 8);
    }
  }
  // 8BOY 16: Karten-Ebene 0-3 für mget/mset/map/mode7 wählen
  function layer(n = 0) { s.layer = Math.max(0, Math.min(maps.length - 1, n | 0)); map = maps[s.layer]; }

  // 8BOY 16: Perspektivboden – die aktuelle Karten-Ebene als Boden in Perspektive, von oben schräg gesehen.
  // x, y: Standpunkt auf der Karte in Pixeln, angle: Blickrichtung (0 = nach rechts), height: Höhe der
  // Kamera (1 = normal), horizon: Bildzeile des Horizonts, outside: Farbe außerhalb der Karte (nil = frei)
  // tile = 16: Kacheln sind 16x16-Sprites in jeder zweiten Zelle (so wie map() sie bei 16er-Kacheln zeichnet)
  function mode7(x, y, angle = 0, height = 1, horizon = H / 3 | 0, outside = null, tile = 8) {
    const F = W / 2, cam = 32 * Math.max(0.05, height);
    const ts = tile >= 16 ? 16 : 8, st = ts / 8, tm = ts - 1;
    const ca = Math.cos(angle), sa = Math.sin(angle);
    s.m7 = { x, y, ca, sa, F, cam, horizon };
    const oc = outside === null || outside === undefined ? -1 : col(outside);
    for (let yy = Math.max(s.clipY0, Math.floor(horizon) + 1); yy < s.clipY1; yy++) {
      const dist = cam * F / (yy + 0.5 - horizon);
      const k = dist / F;
      // Weltpunkt am linken Rand und Schritt je Bildspalte
      const off0 = s.clipX0 + 0.5 - F;
      let wx = x + ca * dist - sa * k * off0, wy = y + sa * dist + ca * k * off0;
      const stx = -sa * k, sty = ca * k;
      for (let xx = s.clipX0; xx < s.clipX1; xx++, wx += stx, wy += sty) {
        const tx = Math.floor(wx / ts) * st, ty = Math.floor(wy / ts) * st;
        let c = -1;
        if (tx >= 0 && ty >= 0 && tx < MAP_W && ty < MAP_H) {
          const n = map[ty * MAP_W + tx];
          const sp = n ? sprites[n] : null;
          if (sp) {
            const px = Math.floor(wx) & tm, py = Math.floor(wy) & tm;
            const v = sp.data[(py % sp.h) * sp.w + (px % sp.w)];
            if (v !== TRANSPARENT) c = remap[v];
          } else c = oc;
        } else c = oc;
        if (c >= 0) put(yy * W + xx, c);
      }
    }
  }
  // Weltpunkt -> Bildschirm für den letzten mode7-Aufruf: x, y, Vergrößerung (nil hinter der Kamera)
  function m7pos(wx, wy) {
    const m = s.m7;
    if (!m) return null;
    const rx = wx - m.x, ry = wy - m.y;
    const fwd = rx * m.ca + ry * m.sa, side = -rx * m.sa + ry * m.ca;
    if (fwd < 1) return null;
    const k = m.F / fwd;
    return [m.F + side * k, m.horizon + m.cam * k, k];
  }

  // 8BOY 16: Transparenz für alles, was danach gemalt wird (0 aus, 1 halb, 2 aufhellen, 3 abdunkeln)
  function blend(mode = 0) { if (bmode) s.blend = Math.max(0, Math.min(3, mode | 0)); }
  // 8BOY 16: Bildzeilen y0..y1 waagerecht wellen (Hitze, Wasser, Traum)
  function wave(y0, y1, amp = 2, len = 16, phase = 0) {
    y0 = Math.max(0, Math.floor(y0)); y1 = Math.min(H, Math.floor(y1));
    const row = new Uint8Array(W), rowU = new Uint8Array(W), rowB = new Uint8Array(W);
    const d3 = s.use3d && rgb3, row3 = d3 ? new Uint32Array(W) : null;   // 8BOY 32: das 3D-Bild wellt mit
    for (let y = y0; y < y1; y++) {
      const d = Math.round(amp * Math.sin(y / Math.max(1, len) * Math.PI * 2 + phase));
      if (!d) continue;
      const o = y * W;
      row.set(fb.subarray(o, o + W)); if (bmode) { rowU.set(under.subarray(o, o + W)); rowB.set(bmode.subarray(o, o + W)); }
      if (d3) row3.set(rgb3.subarray(o, o + W));
      for (let x = 0; x < W; x++) {
        const sx = Math.max(0, Math.min(W - 1, x - d));
        fb[o + x] = row[sx];
        if (bmode) { under[o + x] = rowU[sx]; bmode[o + x] = rowB[sx]; }
        if (d3) rgb3[o + x] = row3[sx];
      }
    }
  }
  // 8BOY 16: Mosaik – Bereich in grobe Blöcke zerlegen (Überblenden, Treffer, Teleport)
  function mosaic(size = 4, x = 0, y = 0, w = W, h = H) {
    size = Math.max(1, Math.floor(size));
    if (size < 2) return;
    x = Math.max(0, Math.floor(x)); y = Math.max(0, Math.floor(y));
    const x1 = Math.min(W, x + Math.floor(w)), y1 = Math.min(H, y + Math.floor(h));
    for (let by = y; by < y1; by += size) for (let bx = x; bx < x1; bx += size) {
      const c = fb[by * W + bx];
      for (let yy = by; yy < Math.min(y1, by + size); yy++) fb.fill(c, yy * W + bx, yy * W + Math.min(x1, bx + size));
      if (bmode) for (let yy = by; yy < Math.min(y1, by + size); yy++) bmode.fill(0, yy * W + bx, yy * W + Math.min(x1, bx + size));
      if (s.use3d && rgb3) { const c3 = rgb3[by * W + bx]; for (let yy = by; yy < Math.min(y1, by + size); yy++) rgb3.fill(c3, yy * W + bx, yy * W + Math.min(x1, bx + size)); }
    }
  }
  // 8BOY 16: Helligkeit 0 (schwarz) bis 15 (voll) – zum Ein- und Ausblenden
  function fade(level = 15) { if (bmode) s.bright = Math.max(0, Math.min(15, +level)); }
  // 8BOY 16: Hintergrundfarbe 0 je Bildzeile als Verlauf von c0 nach c1 (0xRRGGBB), wie HDMA am SNES
  function backdrop(y0, y1, c0, c1 = c0) {
    if (!bmode) return;
    if (y0 === undefined) { lineBg.fill(-1); return; }
    y0 = Math.floor(y0); y1 = Math.floor(y1);
    const A = rgbOf(c0), B = rgbOf(c1);
    for (let y = Math.max(0, y0); y < Math.min(H, y1); y++) {
      const t = y1 - 1 > y0 ? (y - y0) / (y1 - 1 - y0) : 0;
      lineBg[y] = quantize(pack(A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t));
    }
  }

  function camera(x = 0, y = 0) { s.camX = Math.floor(x); s.camY = Math.floor(y); }
  function clip(x, y, w, h) {
    if (x === undefined) { s.clipX0 = 0; s.clipY0 = 0; s.clipX1 = W; s.clipY1 = H; return; }
    s.clipX0 = Math.max(0, Math.floor(x)); s.clipY0 = Math.max(0, Math.floor(y));
    s.clipX1 = Math.min(W, Math.floor(x + w)); s.clipY1 = Math.min(H, Math.floor(y + h));
  }
  function pal(a, b) {
    if (a === undefined) { for (let i = 0; i < NC; i++) remap[i] = i; return; }
    remap[a & CM] = b & CM;
  }
  function setPalette(i, r, g, b) { palette[i & CM] = quantize(((r & 255) << 16) | ((g & 255) << 8) | (b & 255)); }

  // Framebuffer -> RGBA (Uint32, little endian = ABGR). out32 kann größer sein als der Bildschirm
  // (8BOY 16 mit 8BOY-Kartridge): dann landet das Bild ab (ox, oy) in einer Zeile der Breite stride.
  const toABGR = (rgb) => 0xff000000 | ((rgb & 255) << 16) | (rgb & 0xff00) | (rgb >> 16 & 255);
  const shade = (rgb) => {
    if (s.classic) {
      const l = (0.3 * (rgb >> 16 & 255) + 0.59 * (rgb >> 8 & 255) + 0.11 * (rgb & 255)) / 256;
      rgb = CLASSIC[Math.min(3, Math.floor(l * 4))];
    }
    if (s.bright < 15) { const k = s.bright / 15; rgb = pack((rgb >> 16 & 255) * k, (rgb >> 8 & 255) * k, (rgb & 255) * k); }
    return rgb;
  };
  let lut = new Uint32Array(32);
  function present(out32, stride = W, ox = 0, oy = 0) {
    if (!bmode) {
      for (let i = 0; i < 32; i++) {
        let rgb = palette[i];
        if (s.classic) {
          const l = (0.3 * (rgb >> 16 & 255) + 0.59 * (rgb >> 8 & 255) + 0.11 * (rgb & 255)) / 256;
          rgb = CLASSIC[Math.min(3, Math.floor(l * 4))];
        }
        lut[i] = 0xff000000 | ((rgb & 255) << 16) | (rgb & 0xff00) | (rgb >> 16 & 255);
      }
      if (stride === W && !ox && !oy) { for (let i = 0; i < fb.length; i++) out32[i] = lut[fb[i] & 31]; return; }
      for (let y = 0; y < H; y++) for (let x = 0, o = (oy + y) * stride + ox, i = y * W; x < W; x++) out32[o + x] = lut[fb[i + x] & 31];
      return;
    }
    if (lut.length !== NC) lut = new Uint32Array(NC);
    for (let i = 0; i < NC; i++) lut[i] = toABGR(shade(palette[i]));
    // 8BOY 64 mit Grafikkarte: wo die 3D-Welt durchscheint, bleibt das 2D-Bild durchsichtig (main.js legt es über die GPU).
    // Vorher setzt der Grafikchip sein Bild fertig zusammen (Nachbearbeitung, post3d).
    if (gpuMode && s.use3d) { gpuChip.finish?.(); return presentOverGpu(out32, stride, ox, oy); }
    // 8BOY 32: wo das 2D-Bild Farbe 0 hat, scheint die 3D-Welt durch
    const d3 = s.use3d && rgb3;
    const plain = !s.classic && s.bright >= 15;
    const rgbAt = (idx, y, i) => (idx === 0 ? (d3 ? rgb3[i] : lineBg[y] >= 0 ? lineBg[y] : palette[0]) : palette[idx]);
    for (let y = 0; y < H; y++) {
      const bg = lineBg[y] >= 0 ? toABGR(shade(lineBg[y])) : lut[0];
      for (let x = 0, i = y * W, o = (oy + y) * stride + ox; x < W; x++, i++) {
        const c = fb[i];
        if (!bmode[i]) {
          if (c !== 0) out32[o + x] = lut[c];
          else if (d3) out32[o + x] = toABGR(plain ? rgb3[i] : shade(rgb3[i]));
          else out32[o + x] = bg;
          continue;
        }
        const a = rgbAt(c, y, i), b = rgbAt(under[i], y, i), m = bmode[i];
        let r, g, bl;
        if (m === 1) { r = ((a >> 16 & 255) + (b >> 16 & 255)) / 2; g = ((a >> 8 & 255) + (b >> 8 & 255)) / 2; bl = ((a & 255) + (b & 255)) / 2; }
        else if (m === 2) { r = (a >> 16 & 255) + (b >> 16 & 255); g = (a >> 8 & 255) + (b >> 8 & 255); bl = (a & 255) + (b & 255); }
        else { r = (b >> 16 & 255) - (a >> 16 & 255); g = (b >> 8 & 255) - (a >> 8 & 255); bl = (b & 255) - (a & 255); }
        out32[o + x] = toABGR(shade(pack(r, g, bl)));
      }
    }
  }

  // 2D-Ebene über dem GPU-Bild: Farbe 0 ganz durchsichtig, Transparenz-Modi als halbdurchsichtige Pixel
  function presentOverGpu(out32, stride, ox, oy) {
    const HALF = 0x80000000, CLEAR = 0;
    for (let y = 0; y < H; y++) {
      const bg = lineBg[y] >= 0 ? toABGR(shade(lineBg[y])) : CLEAR;
      for (let x = 0, i = y * W, o = (oy + y) * stride + ox; x < W; x++, i++) {
        const c = fb[i];
        if (!bmode[i]) { out32[o + x] = c !== 0 ? lut[c] : bg; continue; }
        const m = bmode[i], u = under[i];
        if (u !== 0) {
          // beide Farben liegen in der 2D-Ebene: wie gewohnt mischen
          const a = c === 0 ? 0 : palette[c], b = palette[u];
          let r, g, bl;
          if (m === 1) { r = ((a >> 16 & 255) + (b >> 16 & 255)) / 2; g = ((a >> 8 & 255) + (b >> 8 & 255)) / 2; bl = ((a & 255) + (b & 255)) / 2; }
          else if (m === 2) { r = (a >> 16 & 255) + (b >> 16 & 255); g = (a >> 8 & 255) + (b >> 8 & 255); bl = (a & 255) + (b & 255); }
          else { r = (b >> 16 & 255) - (a >> 16 & 255); g = (b >> 8 & 255) - (a >> 8 & 255); bl = (b & 255) - (a & 255); }
          out32[o + x] = toABGR(shade(pack(r, g, bl)));
        } else if (c === 0) out32[o + x] = CLEAR;
        // über der 3D-Welt: halb = Farbe zu 50 % darüber, abdunkeln = Schwarz zu 50 %, aufhellen = Farbe zu 50 %
        else out32[o + x] = ((m === 3 ? 0xff000000 : lut[c]) & 0x00ffffff) | HALF;
      }
    }
  }

  return {
    get fb() { return fb; }, get palette() { return palette; }, get map() { return map; }, get remap() { return remap; },
    get w() { return W; }, get h() { return H; }, get colors() { return NC; }, get layers() { return maps.length; },
    sprites, flags, state: s, ui,
    setMode, resetAll, resetDrawState, cls, pset, pget, line, rect, rectfill, circ, circfill, text, textWidth,
    defineSprite, spr, spriteSize, mget, mset, drawMap, camera, clip, pal, setPalette, present,
    rspr, layer, mode7, m7pos, blend, wave, mosaic, fade, backdrop,
    get three() { return !!rgb3 || gpuMode; },
    // aktiver 3D-Chip: GPU beim 8BOY 64 (wenn vorhanden), sonst der Software-Chip
    get g3() { return gpuMode ? gpuChip : soft3; },
    get gpuMode() { return gpuMode; }, get gpuChip() { return gpuChip; },
    attachGpu,
  };
}
