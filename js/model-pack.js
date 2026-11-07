// Modelle als Binärdaten in der Kartridge – schlank, schnell zu laden, mit echten Farben und Texturen.
//
// Ein Modell steht als Block am Ende der Kartridge (Lua sieht ihn nicht, js/vm.js nimmt ihn vorher heraus):
//   --[==[8boy-modell helm
//   eJzt…   (Base64, zlib-gepackt, Zeilen zu 120 Zeichen)
//   ]==]
// und wird im Spiel mit modelload(n, "helm") geladen.
//
// Gemeinsame Zwischenform aller Importe (glTF, OBJ) – ein „Netz“ in 8BOY-32-/64-Koordinaten:
//   { pos: Float32Array(n*3), nrm: Float32Array(n*3)|null, uv: Float32Array(n*2)|null, col: Uint32Array(n)|null (0xRRGGBB),
//     idx: Uint32Array(t*3), tex: { w, h, rgba: Uint8Array }|null, both: bool, info: { name, quelle, lizenz, … } }
// Eckpunkte tragen ihre Eigenschaften selbst (an Naht- und Farbkanten doppelt), Flächen im Uhrzeigersinn von außen.
//
// Binärformat „B8M1“ (little endian): Kopf 64 Byte, Info-JSON, Punkte als u16 im Begrenzungsquader, Normalen
// oktaedrisch in 2×i8, UVs als u16 im UV-Bereich, Farben 3×u8, Flächen u16/u32, Textur mit eigener Farbtabelle
// (bis 256 Farben wie bei den Konsolen der 90er: CLUT) – 1 Byte je Bildpunkt.
import { DEFAULT_PALETTE } from './gfx.js';

export const MODEL_MAX_TEX = 1024;          // Kantenlänge einer Modell-Textur (Datenblatt)
const MAGIC = 0x314d3842;                   // 'B8M1'
const F_NRM = 1, F_UV = 2, F_COL = 4, F_TEX = 8, F_BOTH = 16, F_ALPHA = 32, F_UV2 = 64;   // UV2: Lightmap (8BOY 128), hinten angehängt

// ------------------------------------------------------------------ Base64 (schnell, ohne btoa für große Daten)
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const B64I = new Uint8Array(128).fill(255);
for (let i = 0; i < 64; i++) B64I[B64.charCodeAt(i)] = i;
export function toBase64(bytes, lineLen = 120) {
  const out = [];
  let line = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i], b = bytes[i + 1], c = bytes[i + 2];
    const n = (a << 16) | ((b ?? 0) << 8) | (c ?? 0);
    line += B64[n >> 18 & 63] + B64[n >> 12 & 63] + (b === undefined ? '=' : B64[n >> 6 & 63]) + (c === undefined ? '=' : B64[n & 63]);
    if (line.length >= lineLen) { out.push(line); line = ''; }
  }
  if (line) out.push(line);
  return out.join('\n');
}
export function fromBase64(text) {
  const s = text.replace(/[^A-Za-z0-9+/]/g, '');
  const out = new Uint8Array(Math.floor(s.length * 3 / 4));
  let o = 0, acc = 0, bits = 0;
  for (let i = 0; i < s.length; i++) {
    acc = (acc << 6) | B64I[s.charCodeAt(i)];
    bits += 6;
    if (bits >= 8) { bits -= 8; out[o++] = (acc >> bits) & 255; }
  }
  return out.subarray(0, o);
}

// ------------------------------------------------------------------ Entpacken (zlib/deflate, synchron – modelload läuft in _init)
const LBASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
const LEXT = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
const DBASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
const DEXT = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
const CLORD = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];
// Huffman-Tabelle als (Länge, Zählung, Symbole) wie in tinf
function huff(lens, n) {
  const count = new Uint16Array(16), sym = new Uint16Array(n), offs = new Uint16Array(16);
  for (let i = 0; i < n; i++) count[lens[i]]++;
  count[0] = 0;
  for (let i = 1; i < 16; i++) offs[i] = offs[i - 1] + count[i - 1];
  for (let i = 0; i < n; i++) if (lens[i]) sym[offs[lens[i]]++] = i;
  return { count, sym };
}
export function inflate(src) {
  // zlib-Kopf überspringen (2 Byte), Prüfsumme am Ende ignorieren
  let p = (src[0] & 15) === 8 && ((src[0] << 8) | src[1]) % 31 === 0 ? 2 : 0;
  let out = new Uint8Array(Math.max(1024, src.length * 4)), o = 0;
  let bitbuf = 0, bitcnt = 0;
  const need = (n) => { while (bitcnt < n) { bitbuf |= (src[p++] ?? 0) << bitcnt; bitcnt += 8; } };
  const bits = (n) => { if (!n) return 0; need(n); const v = bitbuf & ((1 << n) - 1); bitbuf >>>= n; bitcnt -= n; return v; };
  const grow = (n) => { if (o + n <= out.length) return; let L = out.length * 2; while (L < o + n) L *= 2; const t = new Uint8Array(L); t.set(out.subarray(0, o)); out = t; };
  const decode = (t) => {
    let code = 0, first = 0, index = 0;
    for (let len = 1; len < 16; len++) {
      code |= bits(1);
      const c = t.count[len];
      if (code - first < c) return t.sym[index + code - first];
      index += c; first = (first + c) << 1; code <<= 1;
    }
    throw new Error('Modelldaten beschädigt');
  };
  let fixedL = null, fixedD = null;
  for (;;) {
    const last = bits(1), type = bits(2);
    if (type === 0) {
      bitbuf = 0; bitcnt = 0;
      const len = src[p] | (src[p + 1] << 8);
      p += 4;
      grow(len); out.set(src.subarray(p, p + len), o); o += len; p += len;
    } else {
      let L, D;
      if (type === 1) {
        if (!fixedL) {
          const l = new Uint8Array(288);
          for (let i = 0; i < 144; i++) l[i] = 8; for (let i = 144; i < 256; i++) l[i] = 9; for (let i = 256; i < 280; i++) l[i] = 7; for (let i = 280; i < 288; i++) l[i] = 8;
          fixedL = huff(l, 288); fixedD = huff(new Uint8Array(30).fill(5), 30);
        }
        L = fixedL; D = fixedD;
      } else if (type === 2) {
        const hlit = bits(5) + 257, hdist = bits(5) + 1, hclen = bits(4) + 4;
        const cl = new Uint8Array(19);
        for (let i = 0; i < hclen; i++) cl[CLORD[i]] = bits(3);
        const ct = huff(cl, 19), lens = new Uint8Array(hlit + hdist);
        for (let i = 0; i < hlit + hdist;) {
          const s = decode(ct);
          if (s < 16) lens[i++] = s;
          else if (s === 16) { const prev = lens[i - 1]; for (let r = bits(2) + 3; r--;) lens[i++] = prev; }
          else if (s === 17) i += bits(3) + 3;
          else i += bits(7) + 11;
        }
        L = huff(lens.subarray(0, hlit), hlit); D = huff(lens.subarray(hlit), hdist);
      } else throw new Error('Modelldaten beschädigt');
      for (;;) {
        const s = decode(L);
        if (s < 256) { grow(1); out[o++] = s; continue; }
        if (s === 256) break;
        const len = LBASE[s - 257] + bits(LEXT[s - 257]);
        const ds = decode(D), dist = DBASE[ds] + bits(DEXT[ds]);
        grow(len);
        for (let k = 0; k < len; k++, o++) out[o] = out[o - dist];
      }
    }
    if (last) break;
  }
  return out.subarray(0, o);
}
// Packen geht asynchron über den Browser (CompressionStream) – nur beim Einfügen im Studio
export async function deflate(bytes) {
  const s = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate'));
  return new Uint8Array(await new Response(s).arrayBuffer());
}

// ------------------------------------------------------------------ Farbtabelle für Texturen (Median-Schnitt, bis 256 Farben)
export function quantize(rgba, w, h, max = 256) {
  const n = w * h;
  let alpha = false;
  for (let i = 0; i < n; i++) if (rgba[i * 4 + 3] < 128) { alpha = true; break; }
  const slots = alpha ? max - 1 : max;
  // Farben auf 5 Bit je Kanal bündeln (32 768 Fächer), dann die Fächer teilen
  const hist = new Uint32Array(32768);
  for (let i = 0; i < n; i++) {
    if (alpha && rgba[i * 4 + 3] < 128) continue;
    hist[((rgba[i * 4] >> 3) << 10) | ((rgba[i * 4 + 1] >> 3) << 5) | (rgba[i * 4 + 2] >> 3)]++;
  }
  const bins = [];
  for (let k = 0; k < 32768; k++) if (hist[k]) bins.push(k);
  const boxes = [bins];
  const range = (b) => {
    let lo = [31, 31, 31], hi = [0, 0, 0];
    for (const k of b) { const c = [k >> 10, k >> 5 & 31, k & 31]; for (let j = 0; j < 3; j++) { if (c[j] < lo[j]) lo[j] = c[j]; if (c[j] > hi[j]) hi[j] = c[j]; } }
    return [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]];
  };
  while (boxes.length < slots) {
    // die Kiste mit der größten Ausdehnung × Bildpunkte teilen
    let bi = -1, best = 0;
    boxes.forEach((b, i) => {
      if (b.length < 2) return;
      const r = range(b), cnt = b.reduce((s, k) => s + hist[k], 0), score = Math.max(...r) * Math.sqrt(cnt);
      if (score > best) { best = score; bi = i; }
    });
    if (bi < 0) break;
    const b = boxes[bi], r = range(b), ax = r[0] >= r[1] && r[0] >= r[2] ? 0 : r[1] >= r[2] ? 1 : 2;
    const key = (k) => (ax === 0 ? k >> 10 : ax === 1 ? k >> 5 & 31 : k & 31);
    b.sort((x, y) => key(x) - key(y));
    const total = b.reduce((s, k) => s + hist[k], 0);
    let acc = 0, cut = 1;
    for (let i = 0; i < b.length - 1; i++) { acc += hist[b[i]]; if (acc >= total / 2) { cut = i + 1; break; } }
    boxes.splice(bi, 1, b.slice(0, cut), b.slice(cut));
  }
  // Mittelwert je Kiste (aus den echten Farben), Fach → Farbnummer
  const sum = new Float64Array(boxes.length * 4), binIdx = new Int16Array(32768).fill(-1);
  boxes.forEach((b, i) => { for (const k of b) binIdx[k] = i + (alpha ? 1 : 0); });
  for (let i = 0; i < n; i++) {
    if (alpha && rgba[i * 4 + 3] < 128) continue;
    const c = binIdx[((rgba[i * 4] >> 3) << 10) | ((rgba[i * 4 + 1] >> 3) << 5) | (rgba[i * 4 + 2] >> 3)] - (alpha ? 1 : 0);
    sum[c * 4] += rgba[i * 4]; sum[c * 4 + 1] += rgba[i * 4 + 1]; sum[c * 4 + 2] += rgba[i * 4 + 2]; sum[c * 4 + 3]++;
  }
  const count = boxes.length + (alpha ? 1 : 0);
  const pal = new Uint8Array(count * 4);
  if (alpha) pal.set([0, 0, 0, 0], 0);
  for (let i = 0; i < boxes.length; i++) {
    const c = sum[i * 4 + 3] || 1, o = (i + (alpha ? 1 : 0)) * 4;
    pal[o] = Math.round(sum[i * 4] / c); pal[o + 1] = Math.round(sum[i * 4 + 1] / c); pal[o + 2] = Math.round(sum[i * 4 + 2] / c); pal[o + 3] = 255;
  }
  const ind = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    if (alpha && rgba[i * 4 + 3] < 128) { ind[i] = 0; continue; }
    ind[i] = binIdx[((rgba[i * 4] >> 3) << 10) | ((rgba[i * 4 + 1] >> 3) << 5) | (rgba[i * 4 + 2] >> 3)];
  }
  return { pal, ind, alpha, count };
}

// ------------------------------------------------------------------ Normalen: oktaedrisch in 2 Bytes
function octEnc(x, y, z) {
  const s = Math.abs(x) + Math.abs(y) + Math.abs(z) || 1;
  let u = x / s, v = y / s;
  if (z < 0) { const ou = u; u = (1 - Math.abs(v)) * (ou >= 0 ? 1 : -1); v = (1 - Math.abs(ou)) * (v >= 0 ? 1 : -1); }
  return [Math.round(Math.max(-1, Math.min(1, u)) * 127), Math.round(Math.max(-1, Math.min(1, v)) * 127)];
}
function octDec(a, b, out, o) {
  let x = a / 127, y = b / 127;
  const z = 1 - Math.abs(x) - Math.abs(y);
  if (z < 0) { const ox = x; x = (1 - Math.abs(y)) * (ox >= 0 ? 1 : -1); y = (1 - Math.abs(ox)) * (y >= 0 ? 1 : -1); }
  const l = Math.hypot(x, y, z) || 1;
  out[o] = x / l; out[o + 1] = y / l; out[o + 2] = z / l;
}

// ------------------------------------------------------------------ Netz → Bytes und zurück
export function packModel(mesh) {
  const nv = mesh.pos.length / 3, nt = mesh.idx.length / 3;
  const flags = (mesh.nrm ? F_NRM : 0) | (mesh.uv ? F_UV : 0) | (mesh.col ? F_COL : 0) | (mesh.tex ? F_TEX : 0) | (mesh.both ? F_BOTH : 0) | (mesh.uv2 ? F_UV2 : 0);
  const info = new TextEncoder().encode(JSON.stringify(mesh.info || {}));
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let k = 0; k < nv * 3; k++) { const a = k % 3; if (mesh.pos[k] < lo[a]) lo[a] = mesh.pos[k]; if (mesh.pos[k] > hi[a]) hi[a] = mesh.pos[k]; }
  if (!nv) { lo.fill(0); hi.fill(0); }
  const ulo = [Infinity, Infinity], uhi = [-Infinity, -Infinity];
  if (mesh.uv) for (let k = 0; k < nv * 2; k++) { const a = k % 2; if (mesh.uv[k] < ulo[a]) ulo[a] = mesh.uv[k]; if (mesh.uv[k] > uhi[a]) uhi[a] = mesh.uv[k]; }
  else { ulo.fill(0); uhi.fill(1); }
  let q = null;
  if (mesh.tex) q = quantize(mesh.tex.rgba, mesh.tex.w, mesh.tex.h);
  const big = nv > 65535;
  const infoPad = (info.length + 3) & ~3;
  const size = 64 + infoPad + nv * 6 + (mesh.nrm ? nv * 2 : 0) + (mesh.uv ? nv * 4 : 0) + (mesh.col ? nv * 3 : 0) + nt * 3 * (big ? 4 : 2) +
    (q ? q.count * 4 + mesh.tex.w * mesh.tex.h : 0) + (mesh.uv2 ? 16 + nv * 4 : 0);
  const buf = new Uint8Array(size), dv = new DataView(buf.buffer);
  dv.setUint32(0, MAGIC, true);
  buf[4] = 1; buf[5] = flags | (q?.alpha ? F_ALPHA : 0);
  dv.setUint32(8, nv, true); dv.setUint32(12, nt, true);
  for (let a = 0; a < 3; a++) { dv.setFloat32(16 + a * 4, lo[a], true); dv.setFloat32(28 + a * 4, hi[a], true); }
  dv.setFloat32(40, ulo[0], true); dv.setFloat32(44, ulo[1], true); dv.setFloat32(48, uhi[0], true); dv.setFloat32(52, uhi[1], true);
  dv.setUint16(56, q ? mesh.tex.w : 0, true); dv.setUint16(58, q ? mesh.tex.h : 0, true);
  dv.setUint16(60, q ? q.count : 0, true); dv.setUint16(62, info.length, true);
  buf.set(info, 64);
  let o = 64 + infoPad;
  for (let k = 0; k < nv * 3; k++) {
    const a = k % 3, span = hi[a] - lo[a];
    dv.setUint16(o, span > 0 ? Math.round((mesh.pos[k] - lo[a]) / span * 65535) : 0, true); o += 2;
  }
  if (mesh.nrm) for (let k = 0; k < nv; k++) { const [u, v] = octEnc(mesh.nrm[k * 3], mesh.nrm[k * 3 + 1], mesh.nrm[k * 3 + 2]); dv.setInt8(o++, u); dv.setInt8(o++, v); }
  if (mesh.uv) for (let k = 0; k < nv * 2; k++) {
    const a = k % 2, span = uhi[a] - ulo[a];
    dv.setUint16(o, span > 0 ? Math.round((mesh.uv[k] - ulo[a]) / span * 65535) : 0, true); o += 2;
  }
  if (mesh.col) for (let k = 0; k < nv; k++) { const c = mesh.col[k]; buf[o++] = c >> 16 & 255; buf[o++] = c >> 8 & 255; buf[o++] = c & 255; }
  for (let k = 0; k < nt * 3; k++) { if (big) { dv.setUint32(o, mesh.idx[k], true); o += 4; } else { dv.setUint16(o, mesh.idx[k], true); o += 2; } }
  if (q) { buf.set(q.pal, o); o += q.pal.length; buf.set(q.ind, o); o += q.ind.length; }
  if (mesh.uv2) {
    const lo2 = [Infinity, Infinity], hi2 = [-Infinity, -Infinity];
    for (let k = 0; k < nv * 2; k++) { const a = k % 2; if (mesh.uv2[k] < lo2[a]) lo2[a] = mesh.uv2[k]; if (mesh.uv2[k] > hi2[a]) hi2[a] = mesh.uv2[k]; }
    if (!nv) { lo2.fill(0); hi2.fill(1); }
    for (let a = 0; a < 2; a++) { dv.setFloat32(o, lo2[a], true); dv.setFloat32(o + 8, hi2[a], true); o += 4; }
    o += 8;
    for (let k = 0; k < nv * 2; k++) {
      const a = k % 2, span = hi2[a] - lo2[a];
      dv.setUint16(o, span > 0 ? Math.round((mesh.uv2[k] - lo2[a]) / span * 65535) : 0, true); o += 2;
    }
  }
  return buf;
}

export function unpackModel(buf) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  if (buf.length < 64 || dv.getUint32(0, true) !== MAGIC) throw new Error('kein 8BOY-Modell (B8M1)');
  const flags = buf[5], nv = dv.getUint32(8, true), nt = dv.getUint32(12, true);
  const lo = [0, 1, 2].map((a) => dv.getFloat32(16 + a * 4, true)), hi = [0, 1, 2].map((a) => dv.getFloat32(28 + a * 4, true));
  const ulo = [dv.getFloat32(40, true), dv.getFloat32(44, true)], uhi = [dv.getFloat32(48, true), dv.getFloat32(52, true)];
  const tw = dv.getUint16(56, true), th = dv.getUint16(58, true), palN = dv.getUint16(60, true), infoLen = dv.getUint16(62, true);
  let info = {};
  try { info = JSON.parse(new TextDecoder().decode(buf.subarray(64, 64 + infoLen))); } catch { /* ohne Info */ }
  let o = 64 + ((infoLen + 3) & ~3);
  const pos = new Float32Array(nv * 3);
  const sc = [0, 1, 2].map((a) => (hi[a] - lo[a]) / 65535);
  for (let k = 0; k < nv * 3; k++) { const a = k % 3; pos[k] = lo[a] + dv.getUint16(o, true) * sc[a]; o += 2; }
  let nrm = null, uv = null, col = null, tex = null;
  if (flags & F_NRM) { nrm = new Float32Array(nv * 3); for (let k = 0; k < nv; k++) { octDec(dv.getInt8(o), dv.getInt8(o + 1), nrm, k * 3); o += 2; } }
  if (flags & F_UV) {
    uv = new Float32Array(nv * 2);
    const us = [(uhi[0] - ulo[0]) / 65535, (uhi[1] - ulo[1]) / 65535];
    for (let k = 0; k < nv * 2; k++) { const a = k % 2; uv[k] = ulo[a] + dv.getUint16(o, true) * us[a]; o += 2; }
  }
  if (flags & F_COL) { col = new Uint32Array(nv); for (let k = 0; k < nv; k++) { col[k] = (buf[o] << 16) | (buf[o + 1] << 8) | buf[o + 2]; o += 3; } }
  const big = nv > 65535, idx = new Uint32Array(nt * 3);
  for (let k = 0; k < nt * 3; k++) { if (big) { idx[k] = dv.getUint32(o, true); o += 4; } else { idx[k] = dv.getUint16(o, true); o += 2; } }
  if ((flags & F_TEX) && tw && th) {
    const pal = buf.subarray(o, o + palN * 4); o += palN * 4;
    const ind = buf.subarray(o, o + tw * th), rgba = new Uint8Array(tw * th * 4);
    o += tw * th;
    for (let i = 0; i < tw * th; i++) { const c = ind[i] * 4; rgba[i * 4] = pal[c]; rgba[i * 4 + 1] = pal[c + 1]; rgba[i * 4 + 2] = pal[c + 2]; rgba[i * 4 + 3] = pal[c + 3]; }
    tex = { w: tw, h: th, rgba };
  }
  let uv2 = null;
  if (flags & F_UV2) {
    const lo2 = [dv.getFloat32(o, true), dv.getFloat32(o + 4, true)], hi2 = [dv.getFloat32(o + 8, true), dv.getFloat32(o + 12, true)];
    o += 16;
    uv2 = new Float32Array(nv * 2);
    const s2 = [(hi2[0] - lo2[0]) / 65535, (hi2[1] - lo2[1]) / 65535];
    for (let k = 0; k < nv * 2; k++) { const a = k % 2; uv2[k] = lo2[a] + dv.getUint16(o, true) * s2[a]; o += 2; }
  }
  return { pos, nrm, uv, col, idx, tex, both: !!(flags & F_BOTH), info, uv2 };
}

// ------------------------------------------------------------------ Blöcke in der Kartridge
const BLOCK = /--\[(=*)\[8boy-modell ([A-Za-z0-9_-]+)[^\n]*\n([\s\S]*?)\]\1\]/g;
export const hasModelBlocks = (code) => code.includes('[8boy-modell ');
// Lua bekommt die Kartridge ohne die (großen) Blöcke – gleiche Zeilenzahl, damit Fehlermeldungen stimmen
export function stripModelBlocks(code) {
  if (!hasModelBlocks(code)) return code;
  return code.replace(BLOCK, (m) => m.replace(/[^\n]/g, ''));
}
export function modelBlocks(code) {
  const out = new Map();
  if (!hasModelBlocks(code)) return out;
  for (const m of code.matchAll(BLOCK)) out.set(m[2], m[3]);
  return out;
}
// Block-Text zum Einfügen (Base64 der gepackten Bytes)
export function modelBlockText(name, packed) {
  return `--[==[8boy-modell ${name}\n${toBase64(packed)}\n]==]\n`;
}
export function decodeModelBlock(text) {
  return unpackModel(inflate(fromBase64(text)));
}

// ------------------------------------------------------------------ Netz → Modell für die Grafikchips
const PAL32 = DEFAULT_PALETTE.slice(0, 32);
export function nearestPal(rgb) {
  const r = rgb >> 16 & 255, g = rgb >> 8 & 255, b = rgb & 255;
  let best = 7, bd = Infinity;
  PAL32.forEach((c, i) => {
    const R = c >> 16 & 255, G = c >> 8 & 255, B = c & 255, rm = (r + R) / 2, dr = r - R, dg = g - G, db = b - B;
    const d = (2 + rm / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rm) / 256) * db * db;
    if (d < bd) { bd = d; best = i; }
  });
  return best;
}
// Ergebnis wie gfx3d.customModel: { v, f: [{ i, c, uv, cc }], smooth, vn, both, img }.
// f.c = nächste Palettenfarbe (Ersatz für den Software-Chip), f.cc = echte Farbe je Ecke (8BOY 64).
export function meshToChip(mesh) {
  const nt = mesh.idx.length / 3, tex = mesh.tex;
  const texAt = (u, v) => {
    if (!tex) return 0xffffff;
    const x = Math.min(tex.w - 1, Math.max(0, Math.floor((u - Math.floor(u)) * tex.w))), y = Math.min(tex.h - 1, Math.max(0, Math.floor((v - Math.floor(v)) * tex.h)));
    const p = (y * tex.w + x) * 4;
    return (tex.rgba[p] << 16) | (tex.rgba[p + 1] << 8) | tex.rgba[p + 2];
  };
  const mulc = (a, b) => (((a >> 16 & 255) * (b >> 16 & 255) / 255) << 16) | (((a >> 8 & 255) * (b >> 8 & 255) / 255) << 8) | ((a & 255) * (b & 255) / 255);
  const palCache = new Map();
  const pal = (rgb) => { let c = palCache.get(rgb); if (c === undefined) { c = nearestPal(rgb); palCache.set(rgb, c); } return c; };
  const f = new Array(nt);
  for (let t = 0; t < nt; t++) {
    const a = mesh.idx[t * 3], b = mesh.idx[t * 3 + 1], c = mesh.idx[t * 3 + 2];
    const uv = mesh.uv ? [mesh.uv[a * 2], mesh.uv[a * 2 + 1], mesh.uv[b * 2], mesh.uv[b * 2 + 1], mesh.uv[c * 2], mesh.uv[c * 2 + 1]] : [0, 0, 0, 0, 0, 0];
    const cc = mesh.col ? [mesh.col[a], mesh.col[b], mesh.col[c]] : [0xffffff, 0xffffff, 0xffffff];
    // Ersatzfarbe: Eckfarbe × Textur in der Flächenmitte, auf 5 Bit gerundet (wenige Paletten-Suchen)
    let avg = mesh.col ? cc[0] : 0xffffff;
    if (tex) avg = mulc(avg, texAt((uv[0] + uv[2] + uv[4]) / 3, (uv[1] + uv[3] + uv[5]) / 3));
    f[t] = { i: [a, b, c], c: pal(avg & 0xf8f8f8), uv, cc: mesh.col || tex ? cc : null };
    if (mesh.uv2) f[t].uv2 = [mesh.uv2[a * 2], mesh.uv2[a * 2 + 1], mesh.uv2[b * 2], mesh.uv2[b * 2 + 1], mesh.uv2[c * 2], mesh.uv2[c * 2 + 1]];
  }
  return { v: mesh.pos, f, smooth: !!mesh.nrm, vn: mesh.nrm || null, both: !!mesh.both, img: tex || null };
}

// ------------------------------------------------------------------ Hilfen für die Importe
// Mitte auf 0, größte Ausdehnung = 1. ground: Unterseite auf y = 0
export function normalizeMesh(mesh, ground = false) {
  const n = mesh.pos.length / 3, used = new Uint8Array(n);
  for (const i of mesh.idx) used[i] = 1;
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let p = 0; p < n; p++) if (used[p]) for (let a = 0; a < 3; a++) { const x = mesh.pos[p * 3 + a]; if (x < lo[a]) lo[a] = x; if (x > hi[a]) hi[a] = x; }
  if (lo[0] === Infinity) return mesh;
  const size = Math.max(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) || 1;
  const c = [(lo[0] + hi[0]) / 2, ground ? lo[1] : (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2];
  const pos = new Float32Array(mesh.pos.length);
  for (let k = 0; k < pos.length; k++) pos[k] = (mesh.pos[k] - c[k % 3]) / size;
  return { ...mesh, pos };
}
// Vierteldrehung um eine Achse (Punkte und Normalen)
export function turnMesh(mesh, axis, quarters = 1) {
  const pos = Float32Array.from(mesh.pos), nrm = mesh.nrm ? Float32Array.from(mesh.nrm) : null;
  const turn = (v) => {
    for (let k = 0; k < v.length; k += 3) {
      const x = v[k], y = v[k + 1], z = v[k + 2];
      if (axis === 'x') { v[k + 1] = -z; v[k + 2] = y; } else if (axis === 'y') { v[k] = z; v[k + 2] = -x; } else { v[k] = -y; v[k + 1] = x; }
    }
  };
  for (let q = 0; q < ((quarters % 4) + 4) % 4; q++) { turn(pos); if (nrm) turn(nrm); }
  return { ...mesh, pos, nrm };
}
// Normalen aus den Flächen, mit Knickwinkel: weicher Übergang unter „grad“, darüber eine Kante (Punkte werden geteilt)
export function computeNormals(mesh, grad = 40) {
  const nv = mesh.pos.length / 3, nt = mesh.idx.length / 3, P = mesh.pos, I = mesh.idx;
  const fn = new Float32Array(nt * 3);
  for (let t = 0; t < nt; t++) {
    const a = I[t * 3] * 3, b = I[t * 3 + 1] * 3, c = I[t * 3 + 2] * 3;
    const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2], wx = P[c] - P[a], wy = P[c + 1] - P[a + 1], wz = P[c + 2] - P[a + 2];
    // wie gfx3d.prepare: Normale = u × w (flächengewichtet)
    fn[t * 3] = uy * wz - uz * wy; fn[t * 3 + 1] = uz * wx - ux * wz; fn[t * 3 + 2] = ux * wy - uy * wx;
  }
  // gleiche Lage = ein Punkt (über Nähte hinweg glätten)
  const key = (p) => `${Math.round(P[p * 3] * 1e5)},${Math.round(P[p * 3 + 1] * 1e5)},${Math.round(P[p * 3 + 2] * 1e5)}`;
  const grp = new Int32Array(nv), gm = new Map();
  for (let p = 0; p < nv; p++) { const k = key(p); let g = gm.get(k); if (g === undefined) { g = gm.size; gm.set(k, g); } grp[p] = g; }
  const faces = Array.from({ length: gm.size }, () => []);
  for (let t = 0; t < nt; t++) for (let j = 0; j < 3; j++) faces[grp[I[t * 3 + j]]].push(t);
  const cosLim = Math.cos(grad * Math.PI / 180);
  const unit = (t) => { const l = Math.hypot(fn[t * 3], fn[t * 3 + 1], fn[t * 3 + 2]) || 1; return [fn[t * 3] / l, fn[t * 3 + 1] / l, fn[t * 3 + 2] / l]; };
  const pos = [], uv = mesh.uv ? [] : null, uv2 = mesh.uv2 ? [] : null, col = mesh.col ? [] : null, nrm = [], idx = new Uint32Array(nt * 3);
  const made = new Map();
  for (let t = 0; t < nt; t++) {
    const nt0 = unit(t);
    for (let j = 0; j < 3; j++) {
      const p = I[t * 3 + j];
      let x = 0, y = 0, z = 0;
      for (const s of faces[grp[p]]) { const n1 = unit(s); if (n1[0] * nt0[0] + n1[1] * nt0[1] + n1[2] * nt0[2] >= cosLim) { x += fn[s * 3]; y += fn[s * 3 + 1]; z += fn[s * 3 + 2]; } }
      const l = Math.hypot(x, y, z) || 1;
      x /= l; y /= l; z /= l;
      const k = `${p}|${Math.round(x * 100)},${Math.round(y * 100)},${Math.round(z * 100)}`;
      let q = made.get(k);
      if (q === undefined) {
        q = pos.length / 3; made.set(k, q);
        pos.push(P[p * 3], P[p * 3 + 1], P[p * 3 + 2]); nrm.push(x, y, z);
        if (uv) uv.push(mesh.uv[p * 2], mesh.uv[p * 2 + 1]);
        if (uv2) uv2.push(mesh.uv2[p * 2], mesh.uv2[p * 2 + 1]);
        if (col) col.push(mesh.col[p]);
      }
      idx[t * 3 + j] = q;
    }
  }
  return { ...mesh, pos: Float32Array.from(pos), nrm: Float32Array.from(nrm), uv: uv && Float32Array.from(uv), uv2: uv2 && Float32Array.from(uv2), col: col && Uint32Array.from(col), idx };
}
// Kosten eines Netzes (für die Anzeige im Studio)
export function meshStats(mesh) {
  return { punkte: mesh.pos.length / 3, dreiecke: mesh.idx.length / 3, textur: mesh.tex ? `${mesh.tex.w}×${mesh.tex.h}` : '' };
}
