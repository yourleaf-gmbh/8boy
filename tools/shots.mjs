// Screenshots + Konsolenfehler: node tools/shots.mjs [url]
import { chromium } from 'playwright';
const url = process.argv[2] || 'http://localhost:8080/';
const out = process.argv[3] || 'shots';
const browser = await chromium.launch();
const errors = [];
for (const [name, vp, mobile] of [['quer', { width: 1440, height: 860 }, false], ['hoch', { width: 412, height: 870 }, true], ['handy-quer', { width: 870, height: 412 }, true]]) {
  const page = await browser.newPage({ viewport: vp, deviceScaleFactor: mobile ? 2.6 : 1, hasTouch: mobile, isMobile: mobile });
  page.on('console', (m) => { if (m.type() === 'error') errors.push(name + ': ' + m.text()); });
  page.on('pageerror', (e) => errors.push(name + ': ' + e.message));
  await page.goto(url);
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${out}/${name}-0-aus.png` });
  await page.evaluate(() => window.eightboy.powerOn());
  await page.waitForTimeout(3200);
  await page.screenshot({ path: `${out}/${name}-1-home.png` });
  await page.evaluate((t) => window.eightboy.insertCart(t), process.env.CART || 'Lektion 1');
  await page.waitForTimeout(2600);
  await page.screenshot({ path: `${out}/${name}-2-cart.png` });
  await page.close();
}
await browser.close();
console.log(errors.length ? 'FEHLER:\n' + errors.join('\n') : 'keine Konsolenfehler');
