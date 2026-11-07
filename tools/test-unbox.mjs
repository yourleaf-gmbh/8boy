// Auspacken durchspielen und fotografieren: node tools/test-unbox.mjs <ordner> ['{"width":1280,"height":800}'] [kartridge.lua]
import { chromium } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
// ohne Ordner: Bilder ins Temp-Verzeichnis, nie in den Projektordner
const out = process.argv[2] || path.join(os.tmpdir(), '8boy-unbox'), vp = JSON.parse(process.argv[3] || '{"width":1280,"height":800}'), cart = process.argv[4] || '01-hallo.lua';
fs.mkdirSync(out, { recursive: true });
const b = await chromium.launch();
const p = await b.newPage({ viewport: vp, deviceScaleFactor: 1, hasTouch: vp.width < 600 });
const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
await p.goto('http://localhost:8080/');
await p.evaluate(() => localStorage.clear()); await p.reload();
await p.waitForFunction(() => window.eightboy?.carts.length);
await p.evaluate((c) => window.eightboy.unpack(c), cart);
await p.waitForTimeout(700); await p.screenshot({ path: out + '/1-sealed.png' });
await p.click('.ub-hint'); await p.waitForTimeout(250); await p.screenshot({ path: out + '/2-tearing.png' });
await p.waitForTimeout(500);
await p.click('.ub-hint'); await p.waitForTimeout(900); await p.screenshot({ path: out + '/3-open.png' });
await p.waitForTimeout(1400); await p.screenshot({ path: out + '/4-out.png' });
await p.click('.ub-manual'); await p.waitForTimeout(400); await p.screenshot({ path: out + '/5-book.png' });
await p.click('.bk-next'); await p.waitForTimeout(250); await p.screenshot({ path: out + '/6-flip.png' });
await p.waitForTimeout(500); await p.screenshot({ path: out + '/7-page.png' });
for (let i = 0; i < 6; i++) { if (await p.isVisible('.bk-next')) { await p.click('.bk-next'); await p.waitForTimeout(650); } }
await p.screenshot({ path: out + '/8-last.png' });
await p.click('.bk-insert'); await p.waitForTimeout(250); await p.screenshot({ path: out + '/9-fly.png' });
await p.waitForTimeout(3000); await p.screenshot({ path: out + '/10-running.png' });
console.log('state', await p.evaluate(() => window.eightboy.system.state), errs.join('\n') || 'keine Fehler');
await b.close();
