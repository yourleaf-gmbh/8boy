// PNG-Kartridge: einpacken, wieder einlesen, Code und Titelbild vergleichen.  node tools/test-pngcart.mjs [kartridge.lua]
import { chromium } from 'playwright';

const file = process.argv[2] || '01-hallo.lua';
const b = await chromium.launch();
const p = await b.newPage();
const errs = [];
p.on('pageerror', (e) => errs.push(e.message));
await p.goto('http://localhost:8080/');
await p.evaluate(() => localStorage.clear());
await p.reload();
await p.waitForFunction(() => window.eightboy?.carts.length);
const r = await p.evaluate(async (f) => {
  const e = window.eightboy;
  const orig = e.carts.find((c) => c.file === f);
  const bytes = await e.packagePNG(f);
  const { extractCart, extractCover } = await import('./js/pngcart.js');
  const code = await extractCart(bytes);
  const coverURL = await extractCover(bytes);
  // Titelbild Pixel für Pixel gegen covers/<name>.png
  const load = (src) => new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = src; });
  const px = (img) => { const c = document.createElement('canvas'); c.width = 240; c.height = 160; const g = c.getContext('2d'); g.drawImage(img, 0, 0); return g.getImageData(0, 0, 240, 160).data; };
  const want = await load('covers/' + f.replace(/\.lua$/, '.png'));
  let diff = -1;
  if (want) { const a = px(want), b2 = px(await load(coverURL)); diff = 0; for (let i = 0; i < a.length; i++) if (a[i] !== b2[i]) diff++; }
  // Import wie per Drag & Drop: eine bekannte Kartridge darf nicht doppelt ins Regal
  const n0 = e.carts.length;
  const changed = code.replace('-- title:', '-- title: Kopie von');
  const { embedCart } = await import('./js/pngcart.js');
  const strip = bytes; // gleiche Bilddaten, anderer Code
  void strip;
  await e.importBytes(await embedCart(bytes.slice(0, bytes.length), changed), 'kopie.8boy.png');
  await new Promise((res) => setTimeout(res, 400));
  return { size: bytes.length, same: code === orig.code, diff, imported: e.carts.length - n0, unbox: e.unboxer.isOpen, title: e.carts.at(-1).title, hasCover: !!e.carts.at(-1).cover };
}, file);
console.log(r);
const ok = r.same && r.diff <= 0 && r.imported === 1 && r.unbox && r.hasCover && !errs.length;
console.log(ok ? 'PNG-Kartridge OK' : 'FEHLER ' + errs.join('; '));
await b.close();
process.exit(ok ? 0 : 1);
