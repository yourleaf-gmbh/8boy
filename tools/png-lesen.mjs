// PNG lesen und verkleinern in Node (für Tests und Werkzeuge; im Browser macht das ein Canvas).
//   decodePNG(bytes) → { w, h, rgba }      8 Bit, Grau/RGB/Palette/mit Alpha, nicht interlaced
//   decodeImage(bytes, mime, maxKante)      wie im Studio: auf höchstens maxKante verkleinern (Mittelwert-Filter)
import zlib from 'node:zlib';

export function decodePNG(data) {
  const b = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  if (b.readUInt32BE(0) !== 0x89504e47) throw new Error('kein PNG');
  let o = 8, w = 0, h = 0, bd = 0, ct = 0, plte = null, trns = null;
  const idat = [];
  while (o < b.length) {
    const len = b.readUInt32BE(o), type = b.toString('latin1', o + 4, o + 8), d = b.subarray(o + 8, o + 8 + len);
    if (type === 'IHDR') { w = d.readUInt32BE(0); h = d.readUInt32BE(4); bd = d[8]; ct = d[9]; if (d[12]) throw new Error('PNG mit Zeilensprung'); }
    else if (type === 'PLTE') plte = d;
    else if (type === 'tRNS') trns = d;
    else if (type === 'IDAT') idat.push(d);
    else if (type === 'IEND') break;
    o += 12 + len;
  }
  if (bd !== 8) throw new Error(`PNG mit ${bd} Bit`);
  const ch = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[ct];
  const raw = zlib.inflateSync(Buffer.concat(idat)), stride = w * ch, px = new Uint8Array(h * stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const a = x >= ch ? px[y * stride + x - ch] : 0, up = y ? px[(y - 1) * stride + x] : 0, c = x >= ch && y ? px[(y - 1) * stride + x - ch] : 0;
      let v = line[x];
      if (f === 1) v += a; else if (f === 2) v += up; else if (f === 3) v += (a + up) >> 1;
      else if (f === 4) { const p = a + up - c, pa = Math.abs(p - a), pb = Math.abs(p - up), pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? up : c; }
      px[y * stride + x] = v & 255;
    }
  }
  const rgba = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const s = i * ch;
    let r, g, bl, al = 255;
    if (ct === 3) { const k = px[s]; r = plte[k * 3]; g = plte[k * 3 + 1]; bl = plte[k * 3 + 2]; if (trns && k < trns.length) al = trns[k]; }
    else if (ch <= 2) { r = g = bl = px[s]; if (ch === 2) al = px[s + 1]; }
    else { r = px[s]; g = px[s + 1]; bl = px[s + 2]; if (ch === 4) al = px[s + 3]; }
    rgba[i * 4] = r; rgba[i * 4 + 1] = g; rgba[i * 4 + 2] = bl; rgba[i * 4 + 3] = al;
  }
  return { w, h, rgba };
}

export function shrink(img, max) {
  const k = Math.max(1, Math.max(img.w, img.h) / max);
  if (k <= 1) return img;
  const w = Math.max(1, Math.round(img.w / k)), h = Math.max(1, Math.round(img.h / k)), out = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const x0 = Math.floor(x * img.w / w), x1 = Math.max(x0 + 1, Math.floor((x + 1) * img.w / w));
    const y0 = Math.floor(y * img.h / h), y1 = Math.max(y0 + 1, Math.floor((y + 1) * img.h / h));
    const s = [0, 0, 0, 0];
    for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) { const p = (yy * img.w + xx) * 4; for (let c = 0; c < 4; c++) s[c] += img.rgba[p + c]; }
    const n = (x1 - x0) * (y1 - y0), d = (y * w + x) * 4;
    for (let c = 0; c < 4; c++) out[d + c] = Math.round(s[c] / n);
  }
  return { w, h, rgba: out };
}

export async function decodeImage(bytes, mime, max = 512) {
  if (/jpe?g/i.test(mime || '')) throw new Error('JPEG nur im Browser');
  return shrink(decodePNG(bytes), max);
}
