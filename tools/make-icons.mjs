import { chromium } from 'playwright';
import fs from 'node:fs';
const svg = fs.readFileSync('icons/icon.svg', 'utf8');
const b = await chromium.launch();
for (const s of [192, 512]) {
  const p = await b.newPage({ viewport: { width: s, height: s } });
  await p.setContent(`<html><body style="margin:0">${svg.replace('<svg ', `<svg width="${s}" height="${s}" `)}</body></html>`);
  await p.screenshot({ path: `icons/icon-${s}.png`, omitBackground: true });
  await p.close();
}
await b.close();
