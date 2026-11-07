// 8BOY 32 3D-Chip: Dreiecke mit Licht, Gouraud-Schattierung, Nebel und Texturen aus Sprites.
// Bewusst im Stil der ersten 3D-Konsolen: Eckpunkte rasten auf ganze Pixel ein (die Polygone "wackeln"),
// Texturen werden affin (ohne Perspektivkorrektur) aufgetragen und verziehen sich leicht.
//
// Koordinaten: x nach rechts, y nach oben, z nach vorn. Die Kamera schaut mit gier = 0 entlang +z.
// Das 3D-Bild liegt in einem eigenen RGB-Speicher HINTER dem 2D-Bild: Wo das 2D-Bild Farbe 0 hat,
// sieht man die 3D-Welt. So bleiben alle 2D-Befehle (Text, Sprites, HUD) wie gewohnt nutzbar.
import { TRANSPARENT } from './gfx.js';

const MAX_MODELS = 64;
const NEAR = 0.1;

// ------------------------------------------------------------------ fertige Formen
function box() {
  const v = [];
  for (const x of [-0.5, 0.5]) for (const y of [-0.5, 0.5]) for (const z of [-0.5, 0.5]) v.push(x, y, z);
  const i = (x, y, z) => (x * 4 + y * 2 + z);
  // Flächen gegen den Uhrzeigersinn von außen gesehen, je zwei Dreiecke mit UV
  const quads = [
    [i(0, 0, 1), i(1, 0, 1), i(1, 1, 1), i(0, 1, 1)], // vorn  (z+)
    [i(1, 0, 0), i(0, 0, 0), i(0, 1, 0), i(1, 1, 0)], // hinten (z-)
    [i(1, 0, 1), i(1, 0, 0), i(1, 1, 0), i(1, 1, 1)], // rechts (x+)
    [i(0, 0, 0), i(0, 0, 1), i(0, 1, 1), i(0, 1, 0)], // links (x-)
    [i(0, 1, 1), i(1, 1, 1), i(1, 1, 0), i(0, 1, 0)], // oben (y+)
    [i(0, 0, 0), i(1, 0, 0), i(1, 0, 1), i(0, 0, 1)], // unten (y-)
  ];
  return { v, quads };
}
function quadsToFaces(quads, color) {
  const f = [];
  for (const q of quads) {
    f.push({ i: [q[0], q[1], q[2]], c: color, uv: [0, 1, 1, 1, 1, 0] });
    f.push({ i: [q[0], q[2], q[3]], c: color, uv: [0, 1, 1, 0, 0, 0] });
  }
  return f;
}
function lathe(profile, seg, color, smooth = true) {
  // profile: [[r, y], …] von unten nach oben – dreht das Profil um die y-Achse
  const v = [], f = [];
  profile.forEach(([r, y]) => { for (let s = 0; s < seg; s++) { const a = s / seg * Math.PI * 2; v.push(Math.cos(a) * r, y, Math.sin(a) * r); } });
  for (let p = 0; p < profile.length - 1; p++) {
    for (let s = 0; s < seg; s++) {
      const a = p * seg + s, b = p * seg + (s + 1) % seg, c = (p + 1) * seg + (s + 1) % seg, d = (p + 1) * seg + s;
      const u0 = s / seg, u1 = (s + 1) / seg, v0 = 1 - p / (profile.length - 1), v1 = 1 - (p + 1) / (profile.length - 1);
      if (profile[p][0] > 0) f.push({ i: [a, c, b], c: color, uv: [u0, v0, u1, v1, u1, v0] });
      if (profile[p + 1][0] > 0) f.push({ i: [a, d, c], c: color, uv: [u0, v0, u0, v1, u1, v1] });
    }
  }
  return { v, f, smooth };
}
export function builtinModel(form, color) {
  switch (form) {
    case 'wuerfel': { const b = box(); return { v: b.v, f: quadsToFaces(b.quads, color), smooth: false }; }
    case 'ebene': return { v: [-0.5, 0, -0.5, 0.5, 0, -0.5, 0.5, 0, 0.5, -0.5, 0, 0.5], f: quadsToFaces([[3, 2, 1, 0]], color), smooth: false, both: true };
    case 'pyramide': {
      const v = [-0.5, -0.5, -0.5, 0.5, -0.5, -0.5, 0.5, -0.5, 0.5, -0.5, -0.5, 0.5, 0, 0.5, 0];
      const f = [[0, 4, 1], [1, 4, 2], [2, 4, 3], [3, 4, 0], [0, 1, 2], [0, 2, 3]].map((i) => ({ i, c: color, uv: [0, 1, 1, 1, 0.5, 0] }));
      return { v, f, smooth: false };
    }
    case 'kugel': {
      const prof = [];
      for (let k = 0; k <= 6; k++) { const a = -Math.PI / 2 + k / 6 * Math.PI; prof.push([Math.cos(a) * 0.5, Math.sin(a) * 0.5]); }
      prof[0][0] = 0; prof[6][0] = 0;
      return lathe(prof, 10, color);
    }
    case 'zylinder': {
      const m = lathe([[0, -0.5], [0.5, -0.5], [0.5, 0.5], [0, 0.5]], 10, color, false);
      return m;
    }
    case 'kegel': return lathe([[0, -0.5], [0.5, -0.5], [0, 0.5]], 10, color, false);
    case 'ring': {
      const v = [], f = [], R = 0.4, r = 0.1, a1 = 14, a2 = 6;
      for (let i = 0; i < a1; i++) for (let j = 0; j < a2; j++) {
        const u = i / a1 * Math.PI * 2, w = j / a2 * Math.PI * 2;
        v.push((R + r * Math.cos(w)) * Math.cos(u), r * Math.sin(w), (R + r * Math.cos(w)) * Math.sin(u));
      }
      for (let i = 0; i < a1; i++) for (let j = 0; j < a2; j++) {
        const a = i * a2 + j, b = ((i + 1) % a1) * a2 + j, c = ((i + 1) % a1) * a2 + (j + 1) % a2, d = i * a2 + (j + 1) % a2;
        f.push({ i: [a, c, b], c: color, uv: [0, 0, 1, 1, 1, 0] }, { i: [a, d, c], c: color, uv: [0, 0, 0, 1, 1, 1] });
      }
      return { v, f, smooth: true };
    }
    case 'gitter': {
      // 16×16 Felder, z.B. für Wasser mit mwave
      const v = [], f = [], N = 16;
      for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) v.push(i / N - 0.5, 0, j / N - 0.5);
      for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
        const a = j * (N + 1) + i, b = a + 1, c = a + N + 2, d = a + N + 1;
        f.push({ i: [d, c, b], c: color, uv: [0, 1, 1, 1, 1, 0] }, { i: [d, b, a], c: color, uv: [0, 1, 1, 0, 0, 0] });
      }
      return { v, f, smooth: false };
    }
    default: return null;
  }
}

// Normalen je Fläche und (für glatte Modelle) je Eckpunkt
export function prepare(m) {
  const v = m.v;
  m.fn = m.f.map(({ i }) => {
    const [a, b, c] = i;
    const ux = v[b * 3] - v[a * 3], uy = v[b * 3 + 1] - v[a * 3 + 1], uz = v[b * 3 + 2] - v[a * 3 + 2];
    const wx = v[c * 3] - v[a * 3], wy = v[c * 3 + 1] - v[a * 3 + 1], wz = v[c * 3 + 2] - v[a * 3 + 2];
    let nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
    const l = Math.hypot(nx, ny, nz) || 1;
    return [nx / l, ny / l, nz / l];
  });
  if (m.smooth && !m.vn) {   // Modelle aus dem Modell-Paket bringen ihre Normalen mit
    const vn = new Float32Array(v.length);
    m.f.forEach(({ i }, k) => { for (const p of i) { vn[p * 3] += m.fn[k][0]; vn[p * 3 + 1] += m.fn[k][1]; vn[p * 3 + 2] += m.fn[k][2]; } });
    for (let p = 0; p < vn.length; p += 3) { const l = Math.hypot(vn[p], vn[p + 1], vn[p + 2]) || 1; vn[p] /= l; vn[p + 1] /= l; vn[p + 2] /= l; }
    m.vn = vn;
  }
  // Ausdehnung (für Texturen eigener Modelle)
  return m;
}

// Eigenes Modell aus Punkt- und Flächenliste (Nummern ab 1) – gemeinsam für den 8BOY 32 und den 8BOY 64
// farben (optional): je Punkt eine echte Farbe 0xRRGGBB – der 8BOY 64 malt sie, der 8BOY 32 nimmt die Flächenfarbe
export function customModel(pts, faces, smooth = false, both = false, colors = null) {
  const v = pts.slice();
  const f = [];
  // Texturkoordinaten je Fläche aus der Hauptrichtung ihrer Normale (liegende Flächen: x/z, Seiten: z/y bzw. x/y)
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let k = 0; k < v.length; k += 3) for (let a = 0; a < 3; a++) { lo[a] = Math.min(lo[a], v[k + a]); hi[a] = Math.max(hi[a], v[k + a]); }
  const rel = (p, a) => (v[p * 3 + a] - lo[a]) / (hi[a] - lo[a] || 1);
  const uvFace = (a, b, c) => {
    const ux = v[b * 3] - v[a * 3], uy = v[b * 3 + 1] - v[a * 3 + 1], uz = v[b * 3 + 2] - v[a * 3 + 2];
    const wx = v[c * 3] - v[a * 3], wy = v[c * 3 + 1] - v[a * 3 + 1], wz = v[c * 3 + 2] - v[a * 3 + 2];
    const nx = Math.abs(uy * wz - uz * wy), ny = Math.abs(uz * wx - ux * wz), nz = Math.abs(ux * wy - uy * wx);
    const [s, t] = ny >= nx && ny >= nz ? [0, 2] : nx >= nz ? [2, 1] : [0, 1];
    return [a, b, c].flatMap((p) => [rel(p, s), 1 - rel(p, t)]);
  };
  for (let k = 0; k + 3 < faces.length + 1; k += 4) {
    const a = faces[k] - 1, b = faces[k + 1] - 1, c = faces[k + 2] - 1;
    if ([a, b, c].some((p) => !(p >= 0 && p * 3 < v.length))) throw new Error(`Fläche ${k / 4 + 1}: Punktnummer ungültig`);
    const cc = colors && colors.length >= v.length / 3 ? [a, b, c].map((p) => (colors[p] | 0) & 0xffffff) : null;
    f.push({ i: [a, b, c], c: faces[k + 3] ?? 7, uv: uvFace(a, b, c), cc });
  }
  return prepare({ v, f, smooth, both });
}

export function attach3D(ctx) {
  const models = new Array(MAX_MODELS).fill(null);
  const cam = { x: 0, y: 0, z: -5, yaw: 0, pitch: 0, fov: 60, f: 1 };
  const light = { x: -0.4, y: -0.8, z: 0.45, amb: 0.35 };
  let fog = null;          // { near, far, r, g, b }
  let tris = 0, trisLast = 0, calls = 0, callsLast = 0;
  const inst = [];         // Instanzlisten (8BOY 64 ohne Grafikkarte)
  ctx.state.use3d = false;

  function reset() {
    models.fill(null);
    inst.length = 0;
    Object.assign(cam, { x: 0, y: 0, z: -5, yaw: 0, pitch: 0, fov: 60 });
    Object.assign(light, { x: -0.4, y: -0.8, z: 0.45, amb: 0.35 });
    fog = null; view = null; ctx.state.use3d = false;
  }
  function normLight() { const l = Math.hypot(light.x, light.y, light.z) || 1; light.x /= l; light.y /= l; light.z /= l; }
  normLight();

  // -------------------------------------------------------------- Modelle
  function model(n, form, color = 7) {
    if (n < 0 || n >= MAX_MODELS) throw new Error(`Modell-Nummer 0-${MAX_MODELS - 1}`);
    const m = builtinModel(form, color);
    if (!m) throw new Error(`unbekannte Form "${form}" (wuerfel, ebene, gitter, pyramide, kugel, zylinder, kegel, ring)`);
    models[n] = prepare(m);
  }
  // eigene Modelle: punkte = {x,y,z, x,y,z, …}, flaechen = {a,b,c,farbe, …} (Nummern ab 1)
  function modelData(n, pts, faces, smooth = false, both = false, colors = null) {
    if (n < 0 || n >= MAX_MODELS) throw new Error(`Modell-Nummer 0-${MAX_MODELS - 1}`);
    models[n] = customModel(pts, faces, smooth, both, colors);
  }
  // Modell aus dem Modell-Paket (js/model-pack.js meshToChip): hier mit den nächsten Palettenfarben, ohne Textur
  function modelMesh(n, m) {
    if (n < 0 || n >= MAX_MODELS) throw new Error(`Modell-Nummer 0-${MAX_MODELS - 1}`);
    models[n] = prepare(m);
    return m.f.length;
  }
  // kachel: wie oft die Textur über die Fläche wiederholt wird (z.B. 8 für eine große Wiese)
  function mtex(n, sprite, bank = 0, tile = 1) {
    const m = models[n];
    if (!m) return;
    m.tex = sprite === undefined || sprite === null ? null : sprite | 0;
    m.bank = bank | 0;
    m.tile = tile > 0 ? tile : 1;
  }
  // Durchsichtigkeit eines Modells: 1 = deckend, 0.5 = halb (Wasser, Glas, weiche Schatten, Geister)
  function malpha(n, a = 1) { const m = models[n]; if (m) m.alpha = Math.max(0, Math.min(1, a)); }
  function mglow(n, on = true) { const m = models[n]; if (m) m.glow = !!on; }
  function mcolor(n, color) { const m = models[n]; if (m) m.f.forEach((f) => { f.c = color; }); }
  // Wellen: jeder Eckpunkt wird beim Zeichnen in y verschoben (Wasser, Fahnen, Wackelpudding)
  function mwave(n, amp = 0, len = 1, phase = 0) { const m = models[n]; if (m) m.wave = amp ? { amp, len: Math.max(0.01, len), phase } : null; }

  // -------------------------------------------------------------- Kamera, Licht, Nebel
  function camera3d(x, y, z, yaw = 0, pitch = 0, fov = 60) { Object.assign(cam, { x, y, z, yaw, pitch, fov: Math.max(10, Math.min(150, fov)) }); }
  function light3d(x, y, z, amb = 0.35) { Object.assign(light, { x, y, z, amb: Math.max(0, Math.min(1, amb)) }); normLight(); }
  function fog3d(near, far, rgb = 0) {
    if (near === undefined) { fog = null; return; }
    fog = { near, far: Math.max(near + 0.01, far), r: rgb >> 16 & 255, g: rgb >> 8 & 255, b: rgb & 255 };
  }
  // 3D-Bild löschen: Himmel als Verlauf von oben nach unten, Tiefenspeicher leeren
  function cls3d(top = 0, bottom = top) {
    const { W, H, rgb, zb } = ctx;
    ctx.state.use3d = true;
    trisLast = tris; tris = 0; callsLast = calls; calls = 0;
    for (let y = 0; y < H; y++) {
      const t = H > 1 ? y / (H - 1) : 0;
      const r = (top >> 16 & 255) + ((bottom >> 16 & 255) - (top >> 16 & 255)) * t;
      const g = (top >> 8 & 255) + ((bottom >> 8 & 255) - (top >> 8 & 255)) * t;
      const b = (top & 255) + ((bottom & 255) - (top & 255)) * t;
      const cl = (v) => Math.max(0, Math.min(255, Math.round(v)));
      rgb.fill((cl(r) << 16) | (cl(g) << 8) | cl(b), y * W, y * W + W);
    }
    zb.fill(0);
  }
  // Himmel nur im Bildausschnitt (view3d) – für den geteilten Bildschirm: jede Ansicht bekommt ihren ganzen Verlauf.
  // Beginnt kein neues Bild (Zähler laufen weiter), das macht cls3d einmal vorher.
  function sky3d(top = 0, bottom = top) {
    const { W, H, rgb, zb } = ctx, V = vp();
    ctx.state.use3d = true;
    const x0 = Math.max(0, V.x), x1 = Math.min(W, V.x + V.w), y0 = Math.max(0, V.y), y1 = Math.min(H, V.y + V.h);
    const cl = (v) => Math.max(0, Math.min(255, Math.round(v)));
    for (let y = y0; y < y1; y++) {
      const t = V.h > 1 ? (y - V.y) / (V.h - 1) : 0;
      const r = (top >> 16 & 255) + ((bottom >> 16 & 255) - (top >> 16 & 255)) * t;
      const g = (top >> 8 & 255) + ((bottom >> 8 & 255) - (top >> 8 & 255)) * t;
      const b = (top & 255) + ((bottom & 255) - (top & 255)) * t;
      rgb.fill((cl(r) << 16) | (cl(g) << 8) | cl(b), y * W + x0, y * W + x1);
      zb.fill(0, y * W + x0, y * W + x1);
    }
  }

  // Welt -> Kamera
  function toView(x, y, z, out, o) {
    let dx = x - cam.x, dy = y - cam.y, dz = z - cam.z;
    const cy = Math.cos(-cam.yaw), sy = Math.sin(-cam.yaw);
    let rx = dx * cy + dz * sy; const rz = -dx * sy + dz * cy;
    const cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch); // nick > 0: Blick nach oben
    const ry = dy * cp - rz * sp, rz2 = dy * sp + rz * cp;
    out[o] = rx; out[o + 1] = ry; out[o + 2] = rz2;
  }
  // Bildausschnitt für die 3D-Projektion (Standard: ganzer Bildschirm)
  let view = null;
  const vp = () => view || { x: 0, y: 0, w: ctx.W, h: ctx.H };
  function view3d(x, y, w, h) { view = x === undefined ? null : { x: Math.max(0, x | 0), y: Math.max(0, y | 0), w: Math.max(1, w | 0), h: Math.max(1, h | 0) }; }
  function focal() { return (vp().h / 2) / Math.tan(cam.fov * Math.PI / 360); }

  // -------------------------------------------------------------- Rasterizer
  let curAlpha = 1, curTile = 1;   // gesetzt von draw3d für das gerade gezeichnete Modell
  // Eckpunkt: [sx, sy, 1/z, r, g, b, u, v, z]
  const palRGB = (c) => ctx.palette[ctx.remap[c & 255]] ?? 0;
  function fogMix(r, g, b, z) {
    if (!fog) return [r, g, b];
    const k = Math.max(0, Math.min(1, (z - fog.near) / (fog.far - fog.near)));
    return [r + (fog.r - r) * k, g + (fog.g - g) * k, b + (fog.b - b) * k];
  }
  function tri(p0, p1, p2, tex, bank, both) {
    const { W, H, rgb, zb } = ctx;
    // Fläche im Bild (Vorzeichen = Umlaufsinn); Rückseiten weglassen
    const area = (p1[0] - p0[0]) * (p2[1] - p0[1]) - (p2[0] - p0[0]) * (p1[1] - p0[1]);
    if (area === 0) return;
    if (area < 0 && !both) return; // im Bild (y nach unten) zeigen Vorderseiten positive Fläche
    if (area > 0) { const t = p1; p1 = p2; p2 = t; }
    const A = -Math.abs(area);
    const V = vp();
    let x0 = Math.max(V.x, Math.min(p0[0], p1[0], p2[0])), x1 = Math.min(Math.min(W, V.x + V.w) - 1, Math.max(p0[0], p1[0], p2[0]));
    let y0 = Math.max(V.y, Math.min(p0[1], p1[1], p2[1])), y1 = Math.min(Math.min(H, V.y + V.h) - 1, Math.max(p0[1], p1[1], p2[1]));
    if (x0 > x1 || y0 > y1) return;
    tris++;
    const sp = tex !== null && tex !== undefined ? ctx.sprites[tex] : null;
    const sw = sp ? sp.w : 0, sh = sp ? sp.h : 0, sd = sp ? sp.data : null;
    const pal = ctx.palette, rm = ctx.remap;   // einmal je Dreieck holen statt je Pixel über Getter
    const off = (bank & 7) * 32;
    const alpha = curAlpha, tile = curTile;
    // Kantenfunktionen sind im Bild linear: pro Pixel nach rechts nur noch addieren
    const e0x = -(p2[1] - p1[1]), e1x = -(p0[1] - p2[1]), e2x = -(p1[1] - p0[1]);
    const fogOn = !!fog, fn = fog ? fog.near : 0, fr = fog ? 1 / (fog.far - fog.near) : 0;
    const FR = fog ? fog.r : 0, FG = fog ? fog.g : 0, FB = fog ? fog.b : 0;
    for (let y = y0; y <= y1; y++) {
      const py = y + 0.5, px0 = x0 + 0.5;
      let w0 = (p2[0] - p1[0]) * (py - p1[1]) - (p2[1] - p1[1]) * (px0 - p1[0]);
      let w1 = (p0[0] - p2[0]) * (py - p2[1]) - (p0[1] - p2[1]) * (px0 - p2[0]);
      let w2 = (p1[0] - p0[0]) * (py - p0[1]) - (p1[1] - p0[1]) * (px0 - p0[0]);
      let inside = false;
      for (let x = x0; x <= x1; x++, w0 += e0x, w1 += e1x, w2 += e2x) {
        if (w0 > 0 || w1 > 0 || w2 > 0) { if (inside) break; continue; }   // Dreieck ist konvex: einmal raus = Zeile fertig
        inside = true;
        const a = w0 / A, b = w1 / A, c = w2 / A;
        const iz = a * p0[2] + b * p1[2] + c * p2[2];
        const i = y * W + x;
        if (iz <= zb[i]) continue;
        let r = a * p0[3] + b * p1[3] + c * p2[3], g = a * p0[4] + b * p1[4] + c * p2[4], bl = a * p0[5] + b * p1[5] + c * p2[5];
        if (sp) {
          // affin: u, v linear im Bild – genau wie damals, daher das leichte Verziehen
          const u = (a * p0[6] + b * p1[6] + c * p2[6]) * tile, v = (a * p0[7] + b * p1[7] + c * p2[7]) * tile;
          let tx = Math.floor(u * sw) % sw, ty = Math.floor(v * sh) % sh;
          if (tx < 0) tx += sw;
          if (ty < 0) ty += sh;
          const t = sd[ty * sw + tx];
          if (t === TRANSPARENT) continue;
          const tc = pal[rm[(t + off) & 255]] ?? 0;
          r = (tc >> 16 & 255) * r / 255; g = (tc >> 8 & 255) * g / 255; bl = (tc & 255) * bl / 255;
        }
        if (fogOn) {
          let k = (1 / iz - fn) * fr;
          k = k < 0 ? 0 : k > 1 ? 1 : k;
          r += (FR - r) * k; g += (FG - g) * k; bl += (FB - bl) * k;
        }
        if (alpha < 1) {
          // durchsichtig: mit dem Bild dahinter mischen, Tiefe nicht eintragen
          const o = rgb[i];
          r = (o >> 16 & 255) + (r - (o >> 16 & 255)) * alpha; g = (o >> 8 & 255) + (g - (o >> 8 & 255)) * alpha; bl = (o & 255) + (bl - (o & 255)) * alpha;
        } else zb[i] = iz;
        rgb[i] = ((r > 255 ? 255 : r) << 16) | ((g > 255 ? 255 : g) << 8) | (bl > 255 ? 255 : bl);
      }
    }
  }
  // Polygon an der nahen Ebene abschneiden (Kamera-Raum), dann projizieren und zerlegen
  function clipAndDraw(vs, tex, bank, both) {
    if (vs.length === 3 && vs[0][2] >= NEAR && vs[1][2] >= NEAR && vs[2][2] >= NEAR) {
      const F = focal(), V = vp(), cx = V.x + V.w / 2, cy = V.y + V.h / 2;
      for (const p of vs) { const z = p[2]; p[0] = Math.round(cx + p[0] / z * F); p[1] = Math.round(cy - p[1] / z * F); p[2] = 1 / z; }
      tri(vs[0], vs[1], vs[2], tex, bank, both);
      return;
    }
    const out = [];
    for (let k = 0; k < vs.length; k++) {
      const a = vs[k], b = vs[(k + 1) % vs.length];
      const ain = a[2] >= NEAR, bin = b[2] >= NEAR;
      if (ain) out.push(a);
      if (ain !== bin) {
        const t = (NEAR - a[2]) / (b[2] - a[2]);
        out.push(a.map((v, j) => v + (b[j] - v) * t));
      }
    }
    if (out.length < 3) return;
    const F = focal(), V = vp(), cx = V.x + V.w / 2, cy = V.y + V.h / 2;
    const pr = out.map((p) => [Math.round(cx + p[0] / p[2] * F), Math.round(cy - p[1] / p[2] * F), 1 / p[2], p[3], p[4], p[5], p[6], p[7]]);
    for (let k = 1; k < pr.length - 1; k++) tri(pr[0], pr[k], pr[k + 1], tex, bank, both);
  }

  const tmp = new Float32Array(3);
  function draw3d(n, x = 0, y = 0, z = 0, yaw = 0, pitch = 0, roll = 0, scale = 1) {
    const m = models[n | 0];
    if (!m) return;
    ctx.state.use3d = true;
    calls++;
    const cyw = Math.cos(yaw), syw = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch), cr = Math.cos(roll), sr = Math.sin(roll);
    const sx = typeof scale === 'object' ? scale[0] : scale, sy = typeof scale === 'object' ? scale[1] : scale, sz = typeof scale === 'object' ? scale[2] : scale;
    // drehen: erst rollen (z), dann nicken (x), dann gieren (y)
    const rot = (px, py, pz) => {
      let x1 = px * cr - py * sr, y1 = px * sr + py * cr, z1 = pz;
      const y2 = y1 * cp - z1 * sp, z2 = y1 * sp + z1 * cp;
      return [x1 * cyw + z2 * syw, y2, -x1 * syw + z2 * cyw];
    };
    const nv = m.v.length / 3;
    const view = new Float32Array(nv * 3);
    const wv = m.wave;
    const world = wv ? new Float32Array(nv * 3) : null;
    for (let k = 0; k < nv; k++) {
      let [wx, wy, wz] = rot(m.v[k * 3] * sx, m.v[k * 3 + 1] * sy, m.v[k * 3 + 2] * sz);
      wx += x; wy += y; wz += z;
      // Wellen in Weltkoordinaten, damit nebeneinanderliegende Wasserstücke zusammenpassen
      if (wv) { const T = Math.PI * 2 / wv.len; wy += wv.amp * (Math.sin(wx * T + wv.phase) + Math.cos(wz * T * 0.8 + wv.phase * 0.7)) * 0.5; world[k * 3] = wx; world[k * 3 + 1] = wy; world[k * 3 + 2] = wz; }
      toView(wx, wy, wz, view, k * 3);
    }
    const glow = m.glow;   // selbstleuchtend: Licht spielt keine Rolle (Lampen, Fenster, Bildschirme)
    const shade = (nx, ny, nz) => glow ? 1 : light.amb + (1 - light.amb) * Math.max(0, -(nx * light.x + ny * light.y + nz * light.z));
    const vlit = m.smooth ? new Float32Array(nv) : null;
    if (vlit) for (let k = 0; k < nv; k++) { const [nx, ny, nz] = rot(m.vn[k * 3], m.vn[k * 3 + 1], m.vn[k * 3 + 2]); vlit[k] = shade(nx, ny, nz); }
    const tex = m.tex ?? null;
    curAlpha = m.alpha ?? 1; curTile = m.tile ?? 1;
    m.f.forEach((f, k) => {
      const [a, b, c] = f.i;
      if (view[a * 3 + 2] < NEAR && view[b * 3 + 2] < NEAR && view[c * 3 + 2] < NEAR) return;
      let flat = 1;
      if (wv) {
        // gewellte Flächen: Normale neu aus den verschobenen Punkten
        const ux = world[b * 3] - world[a * 3], uy = world[b * 3 + 1] - world[a * 3 + 1], uz = world[b * 3 + 2] - world[a * 3 + 2];
        const qx = world[c * 3] - world[a * 3], qy = world[c * 3 + 1] - world[a * 3 + 1], qz = world[c * 3 + 2] - world[a * 3 + 2];
        let nx = uy * qz - uz * qy, ny = uz * qx - ux * qz, nz = ux * qy - uy * qx;
        const l = Math.hypot(nx, ny, nz) || 1;
        if (ny < 0) { nx = -nx; ny = -ny; nz = -nz; } // Wellenflächen zeigen nach oben
        flat = shade(nx / l, ny / l, nz / l);
      } else if (!vlit) { const [nx, ny, nz] = rot(...m.fn[k]); flat = shade(nx, ny, nz); }
      const col = tex !== null ? 0xffffff : palRGB(f.c);
      const cr0 = col >> 16 & 255, cg0 = col >> 8 & 255, cb0 = col & 255;
      const vs = [a, b, c].map((p, j) => {
        const L = vlit ? vlit[p] : flat;
        return [view[p * 3], view[p * 3 + 1], view[p * 3 + 2], cr0 * L, cg0 * L, cb0 * L, f.uv[j * 2], f.uv[j * 2 + 1]];
      });
      clipAndDraw(vs, tex, m.bank || 0, m.both);
    });
  }

  // Punkt der Welt auf dem Bildschirm: x, y, Abstand (nil hinter der Kamera)
  function pos3d(x, y, z) {
    toView(x, y, z, tmp, 0);
    if (tmp[2] < NEAR) return null;
    const F = focal(), V = vp();
    return [V.x + V.w / 2 + tmp[0] / tmp[2] * F, V.y + V.h / 2 - tmp[1] / tmp[2] * F, tmp[2]];
  }

  // Sprite als Aufsteller in der 3D-Welt (immer zur Kamera gedreht), mit Tiefentest und Nebel
  function bill3d(n, x, y, z, size = 1, bank = 0, flip = false) {
    const sp = ctx.sprites[n | 0];
    if (!sp) return;
    const p = pos3d(x, y, z);
    if (!p) return;
    ctx.state.use3d = true;
    const { W, H, rgb, zb } = ctx;
    const k = focal() / p[2] * size / Math.max(sp.w, sp.h);
    const w = sp.w * k, h = sp.h * k, iz = 1 / p[2];
    const X0 = Math.round(p[0] - w / 2), Y0 = Math.round(p[1] - h);
    const off = (bank & 7) * 32;
    const V = vp();
    const pal = ctx.palette, rm = ctx.remap;
    // Nebel ist für den ganzen Aufsteller gleich (ein Abstand): Anteil einmal ausrechnen statt je Pixel
    const fk = fog ? Math.max(0, Math.min(1, (p[2] - fog.near) / (fog.far - fog.near))) : 0;
    const yEnd = Math.min(H, V.y + V.h, Y0 + h), xStart = Math.max(V.x, X0), xEnd = Math.min(W, V.x + V.w, X0 + w);
    for (let yy = Math.max(V.y, Y0); yy < yEnd; yy++) {
      const ty = Math.min(sp.h - 1, ((yy - Y0) / k) | 0);
      for (let xx = xStart; xx < xEnd; xx++) {
        const i = yy * W + xx;
        if (iz <= zb[i]) continue;
        const sx = Math.min(sp.w - 1, ((xx - X0) / k) | 0);
        const t = sp.data[ty * sp.w + (flip ? sp.w - 1 - sx : sx)];
        if (t === TRANSPARENT) continue;
        let c = pal[rm[(t + off) & 255]] ?? 0;
        if (fog) {
          const r = c >> 16 & 255, g = c >> 8 & 255, b = c & 255;
          c = ((r + (fog.r - r) * fk) << 16) | ((g + (fog.g - g) * fk) << 8) | (b + (fog.b - b) * fk);
        }
        rgb[i] = c; zb[i] = iz;
      }
    }
  }

  function line3d(x1, y1, z1, x2, y2, z2, color = 7) {
    const a = pos3d(x1, y1, z1), b = pos3d(x2, y2, z2);
    if (!a || !b) return;
    ctx.state.use3d = true;
    const { W, H, rgb, zb } = ctx;
    const c = palRGB(color);
    const n = Math.max(1, Math.ceil(Math.max(Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1]))));
    for (let s = 0; s <= n; s++) {
      const t = s / n;
      const x = Math.round(a[0] + (b[0] - a[0]) * t), y = Math.round(a[1] + (b[1] - a[1]) * t);
      const V = vp();
      if (x < V.x || y < V.y || x >= Math.min(W, V.x + V.w) || y >= Math.min(H, V.y + V.h)) continue;
      // etwas Vorsprung, damit Linien auf Flächen nicht gepunktet erscheinen
      const iz = 1 / (a[2] + (b[2] - a[2]) * t), i = y * W + x;
      if (iz * 1.004 < zb[i]) continue;
      rgb[i] = c; zb[i] = iz;
    }
  }

  return {
    reset, model, modelData, modelMesh, mtex, malpha, mglow, mcolor, mwave, view3d, camera3d, light3d, fog3d, cls3d, sky3d, draw3d, pos3d, bill3d, line3d,
    tris3d: () => trisLast,
    // 8BOY-64-Befehle ohne Grafikkarte (z. B. in den Node-Tests): verstanden, aber ohne Wirkung
    lamp3d() {}, filter3d() {}, debug3d() {}, retro3d() {},
    // Stufe 2 (Effekte): ohne Grafikkarte ohne Wirkung; Instanzlisten zeichnet der Ersatz-Chip Stück für Stück
    memit() {}, mshine() {}, madd() {}, mshadow() {}, mwater() {}, post3d() {}, part3d() {}, emit3d() {}, parts3d() {},
    shadow3d() {}, sun3d() {}, hfog3d() {}, caustic3d() {}, fx3d: () => 0, finish() {}, ao3d() {}, env3d() {}, mlod() {},
    inst3d(k, list) {
      if ((k | 0) < 0 || (k | 0) > 15) throw new Error('Instanzliste 0–15');
      const n = list ? Math.min(4096, Math.floor(list.length / 5)) : 0;
      inst[k | 0] = n ? list.slice(0, n * 5) : null;
      return n;
    },
    drawi3d(n, k, x = 0, y = 0, z = 0) {
      const l = inst[k | 0];
      if (l) for (let i = 0; i < l.length; i += 5) draw3d(n, x + l[i], y + l[i + 1], z + l[i + 2], l[i + 3], 0, 0, l[i + 4] || 1);
    },
    stats3d: () => ({ calls: callsLast, tris: trisLast, limit: false, parts: 0 }),
    gpu: false,
  };
}
