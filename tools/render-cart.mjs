// Kartridge ohne Browser laufen lassen und das letzte Bild als PNG speichern (Konsole aus dem Kartridge-Kopf).
//   node tools/render-cart.mjs <datei.lua> <bild.png> [bilder=60] [tasten]
//   tasten: z.B. "4@10-40,1@20-90" = Taste 4 (A) von Bild 10 bis 40, Taste 1 (rechts) von 20 bis 90
import fs from 'node:fs';
import { parseCart } from '../js/carts.js';
import { machineFor } from '../js/machines.js';
import zlib from 'node:zlib';
import fengari from 'fengari';
import { createGfx } from '../js/gfx.js';
import { createInput } from '../js/input.js';
import { createVM } from '../js/vm.js';
const [file, out, frames = 60, keys = ''] = process.argv.slice(2);
const press = keys.split(',').filter(Boolean).map((k) => { const [b, r] = k.split('@'); const [a, e] = r.split('-'); return { b: +b, a: +a, e: +e }; });
const crcT = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
const src = fs.readFileSync(file, 'utf8');
const machine = machineFor(parseCart(src).system);
const gfx = createGfx(machine); const input = createInput();
const audio = { play() {}, stop() {}, sfx() {}, beep() {}, playing: () => false, playpos: () => -1, setMachine() {} };
const vm = createVM({ fengari, gfx, audio, input, storage: { get: () => null, set() {} }, machine, onLog: (m) => console.log('log:', m) });
vm.run(src);
const t0 = performance.now();
for (let f = 0; f < +frames; f++) { for (let i = 0; i < 12; i++) input.set('key', i, press.some((p) => p.b === i && f >= p.a && f <= p.e)); input.tick(); vm.update(); vm.draw(); }
console.log('ms/Bild', ((performance.now() - t0) / frames).toFixed(2));
const W = gfx.w, H = gfx.h, S = 2, px = new Uint32Array(W * H); gfx.present(px);
const raw = Buffer.alloc((W * S * 3 + 1) * H * S);
for (let y = 0; y < H * S; y++) { raw[y * (W * S * 3 + 1)] = 0; for (let x = 0; x < W * S; x++) { const v = px[((y / S) | 0) * W + ((x / S) | 0)], o = y * (W * S * 3 + 1) + 1 + x * 3; raw[o] = v & 255; raw[o + 1] = v >> 8 & 255; raw[o + 2] = v >> 16 & 255; } }
const ih = Buffer.alloc(13); ih.writeUInt32BE(W * S, 0); ih.writeUInt32BE(H * S, 4); ih[8] = 8; ih[9] = 2;
fs.writeFileSync(out, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ih), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
