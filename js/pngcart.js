// PNG-Kartridge: Das Versandbild trägt das Spiel in sich (iTXt-Block „8boy-cart“, zlib-gepackt, UTF-8).
// Ein Bildbetrachter zeigt die Packung, 8BOY liest daraus den Lua-Code und schneidet das Titelbild aus.
import { renderShippingImage, ART, SHIP_SCALE, makeCanvas } from './pixelart.js';

const KEY = '8boy-cart';
const SIG = [137, 80, 78, 71, 13, 10, 26, 10];

const CRC = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(bytes) {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC[(c ^ b) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

async function zlib(bytes, mode) {
  const s = new Blob([bytes]).stream().pipeThrough(mode === 'pack' ? new CompressionStream('deflate') : new DecompressionStream('deflate'));
  return new Uint8Array(await new Response(s).arrayBuffer());
}

export function isPNG(bytes) { return SIG.every((v, i) => bytes[i] === v); }

function chunks(bytes) {
  const out = [];
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let p = 8; p + 8 <= bytes.length;) {
    const len = dv.getUint32(p);
    const type = String.fromCharCode(...bytes.subarray(p + 4, p + 8));
    out.push({ type, start: p, data: bytes.subarray(p + 8, p + 8 + len) });
    p += 12 + len;
    if (type === 'IEND') break;
  }
  return out;
}

function makeChunk(type, data) {
  const out = new Uint8Array(12 + data.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

// Lua-Code als iTXt vor IEND einfügen; auf Wunsch der Spielstand als zweiter Block „8boy-save“ (JSON).
// Beim Verschicken bleibt der Spielstand draußen – nur „Sichern“ packt ihn ein.
const SAVE_KEY = '8boy-save';
async function textChunk(key, text) {
  const enc = new TextEncoder();
  const packed = await zlib(enc.encode(text), 'pack');
  const head = enc.encode(key);
  const data = new Uint8Array(head.length + 5 + packed.length);
  data.set(head, 0);
  // \0, Kompression an, Methode 0, leere Sprache \0, leeres übersetztes Schlüsselwort \0
  data.set([0, 1, 0, 0, 0], head.length);
  data.set(packed, head.length + 5);
  return makeChunk('iTXt', data);
}
export async function embedCart(pngBytes, code, saves = null) {
  const add = [await textChunk(KEY, code)];
  if (saves && Object.keys(saves).length) add.push(await textChunk(SAVE_KEY, JSON.stringify(saves)));
  // alte Kartridge-/Spielstand-Blöcke weglassen, neue vor IEND einsetzen
  const parts = [pngBytes.subarray(0, 8)];
  for (const c of chunks(pngBytes)) {
    if (c.type === 'iTXt' && (chunkKey(c.data) === KEY || chunkKey(c.data) === SAVE_KEY)) continue;
    if (c.type === 'IEND') parts.push(...add);
    parts.push(pngBytes.subarray(c.start, c.start + 12 + c.data.length));
  }
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

const chunkKey = (d) => new TextDecoder().decode(d.subarray(0, d.indexOf(0)));

async function extractText(pngBytes, key) {
  for (const c of chunks(pngBytes)) {
    if (c.type !== 'iTXt') continue;
    const d = c.data;
    if (chunkKey(d) !== key) continue;
    const z = d.indexOf(0);
    const compressed = d[z + 1] === 1;
    let p = z + 3;
    p = d.indexOf(0, p) + 1; // Sprache
    p = d.indexOf(0, p) + 1; // übersetztes Schlüsselwort
    const body = d.subarray(p);
    return new TextDecoder().decode(compressed ? await zlib(body, 'unpack') : body);
  }
  return null;
}
export const extractCart = (pngBytes) => extractText(pngBytes, KEY);
// Spielstand aus einer gesicherten Packung: { zeit, daten: { schlüssel: JSON-Text } } oder null
export async function extractSaves(pngBytes) {
  try { const s = JSON.parse(await extractText(pngBytes, SAVE_KEY)); return s && typeof s.daten === 'object' ? s : null; } catch { return null; }
}

// Titelbild (240x160) aus dem Versandbild zurückgewinnen – als Daten-URL zum Speichern
export async function extractCover(pngBytes) {
  try {
    const bmp = await createImageBitmap(new Blob([pngBytes], { type: 'image/png' }));
    const { c, g } = makeCanvas(ART.w, ART.h);
    g.drawImage(bmp, ART.x * SHIP_SCALE, ART.y * SHIP_SCALE, ART.w * SHIP_SCALE, ART.h * SHIP_SCALE, 0, 0, ART.w, ART.h);
    return c.toDataURL('image/png');
  } catch { return null; }
}

export async function buildPNGCart(cart, cover, saves = null) {
  const canvas = renderShippingImage(cart, cover);
  const blob = await new Promise((res) => canvas.toBlob(res, 'image/png'));
  const bytes = new Uint8Array(await blob.arrayBuffer());
  return new Blob([await embedCart(bytes, cart.code, saves)], { type: 'image/png' });
}
