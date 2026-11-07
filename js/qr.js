// QR-Code ohne fremde Bibliothek: Byte-Modus, Fehlerkorrektur M, Version 1–10 (bis 213 Zeichen) –
// reicht für Links wie https://8boy.yourleaf.de/#pad=ABC123. Aufbau nach ISO/IEC 18004.
//   const q = qrEncode(text); q.size, q.get(x, y) → dunkel?;  qrSVG(text) → <svg>…</svg>

// je Version (1–10) bei Stufe M: [Fehlerkorrektur-Bytes je Block, [Anzahl, Datenbytes], …]
const BLOCKS = [null,
  [10, [1, 16]], [16, [1, 28]], [26, [1, 44]], [18, [2, 32]], [24, [2, 43]],
  [16, [4, 27]], [18, [4, 31]], [22, [2, 38], [2, 39]], [22, [3, 36], [2, 37]], [26, [4, 43], [1, 44]]];
const ALIGN = [null, [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]];
const REMAINDER = [0, 0, 7, 7, 7, 7, 7, 0, 0, 0, 0];

// ------------------------------------------------------------------ Reed-Solomon über GF(256), Polynom 0x11D
const EXP = new Uint8Array(512), LOG = new Uint8Array(256);
for (let i = 0, x = 1; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 256) x ^= 0x11d; }
for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
const mul = (a, b) => (a && b ? EXP[LOG[a] + LOG[b]] : 0);
function rsGenerator(deg) {
  let g = [1];
  for (let i = 0; i < deg; i++) {
    const n = new Array(g.length + 1).fill(0);
    for (let j = 0; j < g.length; j++) { n[j] ^= g[j]; n[j + 1] ^= mul(g[j], EXP[i]); }
    g = n;
  }
  return g;
}
function rsRemainder(data, deg) {
  const g = rsGenerator(deg), r = new Array(deg).fill(0);
  for (const b of data) {
    const f = b ^ r.shift();
    r.push(0);
    for (let j = 0; j < deg; j++) r[j] ^= mul(g[j + 1], f);
  }
  return r;
}

const dataBytes = (v) => BLOCKS[v].slice(1).reduce((a, [n, d]) => a + n * d, 0);
const countBits = (v) => (v < 10 ? 8 : 16);

export function qrEncode(text, { mask: forceMask = -1 } = {}) {
  const bytes = [...new TextEncoder().encode(text)];
  let ver = 1;
  while (ver <= 10 && 4 + countBits(ver) + bytes.length * 8 > dataBytes(ver) * 8) ver++;
  if (ver > 10) throw new Error('Text zu lang für den QR-Code');

  // Bitstrom: Modus 0100 (Bytes), Länge, Daten, Abschluss, auffüllen
  const bits = [];
  const put = (val, n) => { for (let i = n - 1; i >= 0; i--) bits.push((val >>> i) & 1); };
  put(4, 4); put(bytes.length, countBits(ver)); bytes.forEach((b) => put(b, 8));
  const cap = dataBytes(ver) * 8;
  put(0, Math.min(4, cap - bits.length));
  while (bits.length % 8) bits.push(0);
  const data = [];
  for (let i = 0; i < bits.length; i += 8) data.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0));
  for (let pad = 0xec; data.length < dataBytes(ver); pad ^= 0xec ^ 0x11) data.push(pad);

  // in Blöcke teilen, Korrekturbytes rechnen, verschränken
  const [ec, ...groups] = BLOCKS[ver];
  const blocks = [];
  let k = 0;
  for (const [n, d] of groups) for (let i = 0; i < n; i++) { const b = data.slice(k, k + d); k += d; blocks.push({ d: b, e: rsRemainder(b, ec) }); }
  const words = [];
  const maxD = Math.max(...blocks.map((b) => b.d.length));
  for (let i = 0; i < maxD; i++) for (const b of blocks) if (i < b.d.length) words.push(b.d[i]);
  for (let i = 0; i < ec; i++) for (const b of blocks) words.push(b.e[i]);

  // ---------------------------------------------------------------- Matrix
  const size = ver * 4 + 17;
  const mod = Array.from({ length: size }, () => new Uint8Array(size));
  const fn = Array.from({ length: size }, () => new Uint8Array(size));
  const setF = (x, y, dark) => { mod[y][x] = dark ? 1 : 0; fn[y][x] = 1; };
  for (let i = 0; i < size; i++) { setF(6, i, i % 2 === 0); setF(i, 6, i % 2 === 0); }
  const finder = (cx, cy) => {
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
      const x = cx + dx, y = cy + dy, dist = Math.max(Math.abs(dx), Math.abs(dy));
      if (x >= 0 && x < size && y >= 0 && y < size) setF(x, y, dist !== 2 && dist !== 4);
    }
  };
  finder(3, 3); finder(size - 4, 3); finder(3, size - 4);
  const al = ALIGN[ver], last = al.length - 1;
  for (let i = 0; i <= last; i++) for (let j = 0; j <= last; j++) {
    if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) continue;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) setF(al[i] + dx, al[j] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
  }
  const formatBits = (mask) => {
    const d = (0 << 3) | mask;   // Stufe M = 00
    let r = d;
    for (let i = 0; i < 10; i++) r = (r << 1) ^ ((r >>> 9) * 0x537);
    return ((d << 10) | r) ^ 0x5412;
  };
  const drawFormat = (mask) => {
    const b = formatBits(mask), bit = (i) => (b >>> i) & 1;
    for (let i = 0; i <= 5; i++) setF(8, i, bit(i));
    setF(8, 7, bit(6)); setF(8, 8, bit(7)); setF(7, 8, bit(8));
    for (let i = 9; i < 15; i++) setF(14 - i, 8, bit(i));
    for (let i = 0; i < 8; i++) setF(size - 1 - i, 8, bit(i));
    for (let i = 8; i < 15; i++) setF(8, size - 15 + i, bit(i));
    setF(8, size - 8, 1);
  };
  drawFormat(0);
  if (ver >= 7) {
    let r = ver;
    for (let i = 0; i < 12; i++) r = (r << 1) ^ ((r >>> 11) * 0x1f25);
    const b = (ver << 12) | r;
    for (let i = 0; i < 18; i++) { const bit = (b >>> i) & 1, a = size - 11 + (i % 3), c = Math.floor(i / 3); setF(a, c, bit); setF(c, a, bit); }
  }
  // Daten im Zickzack von unten rechts
  let i = 0;
  const total = words.length * 8;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let v = 0; v < size; v++) for (let j = 0; j < 2; j++) {
      const x = right - j, up = ((right + 1) & 2) === 0, y = up ? size - 1 - v : v;
      if (!fn[y][x] && i < total) { mod[y][x] = (words[i >>> 3] >>> (7 - (i & 7))) & 1; i++; }
    }
  }
  const MASKS = [
    (x, y) => (x + y) % 2, (x, y) => y % 2, (x) => x % 3, (x, y) => (x + y) % 3,
    (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2, (x, y) => (x * y) % 2 + (x * y) % 3,
    (x, y) => ((x * y) % 2 + (x * y) % 3) % 2, (x, y) => ((x + y) % 2 + (x * y) % 3) % 2];
  const applyMask = (m) => { for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (!fn[y][x] && MASKS[m](x, y) === 0) mod[y][x] ^= 1; };
  // Strafpunkte nach Norm (vereinfacht bei Regel 3) – die Maske mit den wenigsten gewinnt
  const penalty = () => {
    let p = 0, dark = 0;
    const line = (get) => {
      let run = 1;
      const seq = [];
      for (let a = 0; a < size; a++) {
        const c = get(a);
        seq.push(c);
        if (a > 0 && c === get(a - 1)) { run++; if (run === 5) p += 3; else if (run > 5) p++; } else run = 1;
      }
      const s = seq.join('');
      for (const pat of ['10111010000', '00001011101']) { let k2 = s.indexOf(pat); while (k2 >= 0) { p += 40; k2 = s.indexOf(pat, k2 + 1); } }
    };
    for (let y = 0; y < size; y++) line((x) => mod[y][x]);
    for (let x = 0; x < size; x++) line((y) => mod[y][x]);
    for (let y = 0; y < size - 1; y++) for (let x = 0; x < size - 1; x++) {
      const c = mod[y][x];
      if (c === mod[y][x + 1] && c === mod[y + 1][x] && c === mod[y + 1][x + 1]) p += 3;
    }
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) dark += mod[y][x];
    p += (Math.ceil(Math.abs(dark * 20 - size * size * 10) / (size * size)) - 1) * 10;
    return p;
  };
  let best = forceMask;
  if (best < 0) {
    let bestP = Infinity;
    for (let m = 0; m < 8; m++) {
      applyMask(m); drawFormat(m);
      const pen = penalty();
      if (pen < bestP) { bestP = pen; best = m; }
      applyMask(m);
    }
  }
  applyMask(best); drawFormat(best);
  return { size, version: ver, mask: best, get: (x, y) => !!mod[y][x] };
}

// Als SVG (mit 4 Modulen Ruhezone), dunkel auf hell
export function qrSVG(text, { dark = '#15161c', light = '#fff' } = {}) {
  const q = qrEncode(text), n = q.size + 8;
  let d = '';
  for (let y = 0; y < q.size; y++) for (let x = 0; x < q.size; x++) if (q.get(x, y)) d += `M${x + 4} ${y + 4}h1v1h-1z`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n} ${n}" shape-rendering="crispEdges" role="img" aria-label="QR-Code"><rect width="${n}" height="${n}" fill="${light}"/><path d="${d}" fill="${dark}"/></svg>`;
}
