// Test der 3D-Werkstatt im Studio: OBJ laden (Datei und Drag & Drop), in den Code einfügen, auf dem 8BOY 32
// starten (Ausrichtung prüfen: nichts gespiegelt, Vorderseite sichtbar), Modell aus Grundformen bauen,
// Bauplan wieder öffnen, Textur-Vorschau im Sprite-Tab und Handy-Format.
//   node tools/test-werkstatt.mjs [url] [screenshot-ordner] [ordner-mit-haus.obj]
import { chromium } from 'playwright';
import { readFileSync, existsSync } from 'fs';

const url = process.argv[2] || 'http://localhost:8080/';
const out = process.argv[3];
const objDir = process.argv[4];
let fails = 0;
const ok = (c, label, extra = '') => { if (!c) fails++; console.log(`${c ? 'OK  ' : 'FEHL'} ${label}${extra ? '  ' + extra : ''}`); };
const shot = (p, name, opt = {}) => (out ? p.screenshot({ path: `${out}/${name}.png`, ...opt }) : null);

// flacher Pfeil, zeigt nach rechts (+x); Vorderseite (+z, zum Betrachter) rot, Rückseite blau, Rand gelb
const PFEIL = `mtllib pfeil.mtl
v -1 -0.2 0.1
v 0.3 -0.2 0.1
v 0.3 -0.5 0.1
v 1 0 0.1
v 0.3 0.5 0.1
v 0.3 0.2 0.1
v -1 0.2 0.1
v -1 -0.2 -0.1
v 0.3 -0.2 -0.1
v 0.3 -0.5 -0.1
v 1 0 -0.1
v 0.3 0.5 -0.1
v 0.3 0.2 -0.1
v -1 0.2 -0.1
usemtl vorn
f 1/1/1 2/2/1 6/3/1 7/4/1
f 3//1 4//1 5//1
usemtl hinten
f -7 -1 -2 -6
f -5 -3 -4
usemtl rand
f 1 8 9 2
f 2 9 10 3
f 3 10 11 4
f 4 11 12 5
f 5 12 13 6
f 6 13 14 7
f 7 14 8 1
`;
const PFEIL_MTL = 'newmtl vorn\nKd 0.9 0.15 0.2\nnewmtl hinten\nKd 0.2 0.4 0.95\nnewmtl rand\nKd 0.95 0.85 0.3\n';
const CODE = `-- title: Werkstatt-Test
-- author: Test
-- system: 32

function _init()
end

function _draw()
  cls(0)
  cls3d(0x101018, 0x101018)
  cam3d(0, 0, -2.2, 0, 0)
  draw3d(0, 0, 0, 0)
end
`;
const file = (name, text) => ({ name, mimeType: 'text/plain', buffer: Buffer.from(text) });
const code = (p) => p.inputValue('#edText');
const setCode = (p, c) => p.evaluate((c) => { const t = document.getElementById('edText'); t.value = c; t.dispatchEvent(new Event('input')); }, c);
// starten und warten, bis das Spiel (nach dem Titel) mehr als "min" Dreiecke zeichnet
const run = async (p, min = 0) => {
  await p.evaluate(() => window.eightboy.switchMachine(32));
  await p.click('#edRun');
  await p.waitForTimeout(500);
  await p.waitForFunction((m) => window.eightboy.system.state === 'running' && window.eightboy.gfx.g3.tris3d() > m, min, { timeout: 15000 }).catch(() => {});
  await p.waitForTimeout(300);
};
const outside = (p, sel) => p.evaluate((s) => [...document.querySelectorAll(s)].filter((e) => e.offsetParent && e.getBoundingClientRect().right > innerWidth + 1).map((e) => e.className || e.tagName).slice(0, 5), sel);

const b = await chromium.launch();
{
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text() + ' ' + (m.location()?.url || '')); });
  p.on('dialog', (d) => d.accept());
  await p.goto(url);
  await p.evaluate(() => localStorage.clear());
  await p.reload();
  await p.waitForFunction(() => window.eightboy?.carts.length);
  await p.evaluate(() => window.eightboy.powerOn());
  await p.click('#btnStudio'); await p.waitForTimeout(300);
  await setCode(p, CODE);

  // ---- 1. OBJ laden, einfügen, im Spiel ansehen
  await p.click('.ed-bar [data-side="model3d"]'); await p.waitForTimeout(200);
  ok(await p.locator('#edModelPanel .w3-canvas').isVisible(), '3D-Tab öffnet sich mit Vorschau');
  await p.click('.w3-mode [data-mode="obj"]');
  await p.setInputFiles('.w3-file', [file('pfeil.obj', PFEIL), file('pfeil.mtl', PFEIL_MTL)]);
  await p.waitForTimeout(300);
  const info = await p.textContent('.w3-info');
  ok(/pfeil\.obj/.test(info) && /3 Farben/.test(info), 'OBJ mit .mtl gelesen', info.trim());
  ok(await p.inputValue('.w3-n') === '0', 'freie Modellnummer 0 vorgeschlagen');
  await p.uncheck('.w3-draw');
  await p.click('.w3-insert'); await p.waitForTimeout(200);
  let c = await code(p);
  ok(/function _init\(\)\n  -- Modell 0: pfeil\.obj[^\n]*\n  -- Punkte[^\n]*\n  model\(0, \{\n/.test(c), 'model(0, …) in _init eingefügt');
  await run(p);
  const tri1 = await p.evaluate(() => window.eightboy.gfx.g3.tris3d());
  ok(tri1 > 0, 'Modell im Spiel sichtbar', `${tri1} Dreiecke`);
  // Ausrichtung: rote Vorderseite muss zu sehen sein, die breite Spitze rechts (nicht gespiegelt)
  const ori = await p.evaluate(() => {
    const cv = document.getElementById('screen'), d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
    const cols = new Array(cv.width).fill(0); let red = 0, blue = 0;
    for (let y = 0; y < cv.height; y++) for (let x = 0; x < cv.width; x++) {
      const i = (y * cv.width + x) * 4, r = d[i], g = d[i + 1], bl = d[i + 2];
      if (r > 90 && r > g * 2 && r > bl * 2) { red++; cols[x]++; }
      if (bl > 90 && bl > r * 1.5) blue++;
    }
    const xs = cols.map((n, x) => (n ? x : -1)).filter((x) => x >= 0);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), third = (x1 - x0) / 3;
    const peak = cols.indexOf(Math.max(...cols));
    return { red, blue, x0, x1, peak, mid: (x0 + x1) / 2, third };
  });
  ok(ori.red > 500 && ori.blue === 0, 'Vorderseite zur Kamera, Rückseite verdeckt', JSON.stringify(ori));
  ok(ori.peak > ori.mid + ori.third / 2, 'Pfeil zeigt nach rechts (nicht gespiegelt)', `breiteste Stelle x=${ori.peak}, Mitte ${ori.mid}`);
  await shot(p, 'w3-pfeil-im-spiel');

  // ---- 2. Drag & Drop einer OBJ-Datei aufs Studio (statt ins Regal)
  const shelfBefore = await p.evaluate(() => window.eightboy.carts.length);
  const hausObj = objDir && existsSync(`${objDir}/haus.obj`) ? readFileSync(`${objDir}/haus.obj`, 'utf8') : PFEIL;
  const hausMtl = objDir && existsSync(`${objDir}/haus.mtl`) ? readFileSync(`${objDir}/haus.mtl`, 'utf8') : PFEIL_MTL;
  await p.evaluate(([o, m]) => {
    const dt = new DataTransfer();
    dt.items.add(new File([o], 'haus.obj')); dt.items.add(new File([m], 'haus.mtl'));
    document.getElementById('edText').dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
  }, [hausObj, hausMtl]);
  await p.waitForTimeout(500);
  ok(/haus\.obj/.test(await p.textContent('.w3-info')) && await p.evaluate(() => window.eightboy.carts.length) === shelfBefore, 'OBJ per Drag & Drop in die Werkstatt (nicht ins Regal)');
  ok(await p.inputValue('.w3-n') === '1', 'nächste freie Nummer 1');
  await p.check('.w3-draw');
  await p.click('.w3-insert'); await p.waitForTimeout(200);
  c = await code(p);
  ok(/draw3d\(1, 0, 0, 0, t\(\)/.test(c), 'draw3d(1, …) in _draw ergänzt');
  await setCode(p, c.replace('cam3d(0, 0, -2.2, 0, 0)', 'cam3d(0, 0.5, -2.6, 0, -0.15)').replace('draw3d(0, 0, 0, 0)', 'draw3d(0, -1.2, 0.6, 1, 0.4, 0, 0, 0.6)').replace('draw3d(1, 0, 0, 0,', 'draw3d(1, 0.3, 0, 0.3,'));
  await run(p, tri1);
  const tri2 = await p.evaluate(() => window.eightboy.gfx.g3.tris3d());
  ok(tri2 > tri1, 'zweites Modell (Haus) im Spiel', `${tri2} Dreiecke`);
  await shot(p, 'w3-haus-im-spiel', { clip: await p.locator('.glass').boundingBox() });
  await shot(p, 'w3-obj-tab');

  // ---- 3. Vereinfachen
  const big = [];
  for (let i = 0; i <= 40; i++) for (let j = 0; j < 60; j++) { const t = i / 40 * Math.PI, f = j / 60 * 2 * Math.PI; big.push(`v ${Math.sin(t) * Math.cos(f)} ${Math.cos(t)} ${Math.sin(t) * Math.sin(f)}`); }
  for (let i = 0; i < 40; i++) for (let j = 0; j < 60; j++) { const a = i * 60 + j + 1; big.push(`f ${a} ${i * 60 + (j + 1) % 60 + 1} ${(i + 1) * 60 + (j + 1) % 60 + 1} ${(i + 1) * 60 + j + 1}`); }
  await p.setInputFiles('.w3-file', [file('kugel.obj', big.join('\n'))]);
  await p.waitForTimeout(300);
  ok(await p.locator('.w3-warn.bad').isVisible(), 'Warnung bei sehr vielen Dreiecken');
  await p.fill('.w3-target', '400'); await p.click('#edModelPanel [data-act="simplify"]'); await p.waitForTimeout(300);
  const tris = parseInt(await p.textContent('.w3-tris'), 10);
  ok(tris > 200 && tris <= 400, 'Vereinfachen auf höchstens 400 Dreiecke', `${tris}`);

  // ---- 4. Modell-Editor
  await p.click('.w3-mode [data-mode="build"]');
  for (const f of ['wuerfel', 'kugel', 'kegel']) await p.click(`.w3-forms [data-form="${f}"]`);
  ok(await p.locator('.w3-parts [data-i]').count() === 3, 'drei Teile gebaut');
  await p.click('.w3-pal[data-pal="part"] [data-c="8"]');          // Kegel rot
  await p.click('.w3-parts [data-i="0"]');
  await p.click('.w3-seg [data-k="s"]');
  await p.evaluate(() => { const r = document.querySelector('.w3-axis[data-a="0"] input[type=range]'); r.value = 2; r.dispatchEvent(new Event('input', { bubbles: true })); r.dispatchEvent(new Event('change', { bubbles: true })); });
  await p.click('.w3-seg [data-k="r"]');
  await p.click('.w3-axis[data-a="0"] [data-d="1"]');
  await p.focus('.w3-canvas'); await p.keyboard.press('ArrowRight'); await p.keyboard.press('Shift+ArrowUp');
  const val = await p.evaluate(() => document.querySelector('.w3-parts [data-i="0"]').className);
  ok(val === 'on', 'Teil ausgewählt und bearbeitet');
  ok(parseInt(await p.textContent('.w3-tris'), 10) > 50, 'Dreieckszähler', await p.textContent('.w3-tris'));
  await shot(p, 'w3-bauen');
  await p.click('.w3-insert'); await p.waitForTimeout(200);
  c = await code(p);
  ok(/--\[\[modell 2 [^\n]*\n[^\n]*\nwuerfel 0\.1 0\.6 0 2 1 1 15 0 0 12\nkugel /.test(c.replace(/\n  /g, '\n')), 'Bauplan als Kommentar im Code', (/--\[\[modell 2[\s\S]{0,200}/.exec(c) || [''])[0].split('\n').slice(2, 3).join());
  ok(/model\(2, \{/.test(c), 'model(2, …) eingefügt');
  await p.click('#edModelPanel [data-act="clear"]');
  ok(await p.locator('.w3-parts [data-i]').count() === 0, 'neu angefangen');
  await p.click('#edModelPanel [data-act="open"][data-n="2"]');
  ok(await p.locator('.w3-parts [data-i]').count() === 3, 'Bauplan wieder geöffnet');
  await p.click('.w3-forms [data-form="ring"]');
  await p.click('.w3-insert'); await p.waitForTimeout(200);
  c = await code(p);
  ok(c.split('--[[modell 2').length === 2 && c.split('model(2, {').length === 2 && /\nring /.test(c.replace(/\n  /g, '\n')), 'erneut einfügen ersetzt das alte Modell');
  await setCode(p, c.replace('draw3d(1, 0.3, 0, 0.3,', 'draw3d(1, 0.8, -0.3, 0.6,') + '');
  c = await code(p);
  ok(c.includes('draw3d(2, 0, 0, 0, t(), 0, 0, 1)'), 'draw3d(2, …) ergänzt');
  await setCode(p, c.replace('draw3d(2, 0, 0, 0, t(), 0, 0, 1)', 'draw3d(2, -0.9, -0.6, 0.8, t(), 0, 0, 0.4)'));
  await run(p, tri1);
  ok(await p.evaluate(() => window.eightboy.gfx.g3.tris3d()) > tri1, 'gebautes Modell im Spiel sichtbar');
  await shot(p, 'w3-gebaut-im-spiel', { clip: await p.locator('.glass').boundingBox() });

  // ---- 5. Textur-Vorschau im Sprite-Tab
  await p.click('.ed-bar [data-side="sprites"]');
  await p.click('#spNew'); await p.waitForTimeout(200);
  const cv = await p.locator('#spPixels .px-canvas').boundingBox();
  await p.click('#spPixels .px-sw[data-c="8"]');
  for (let i = 0; i < 8; i++) await p.mouse.click(cv.x + cv.width * (i + 0.5) / 8, cv.y + cv.height * (i + 0.5) / 8);
  await p.click('#spPixels .px-sw[data-c="10"]');
  await p.locator('#spPixels .px-canvas').scrollIntoViewIfNeeded();
  const cv2 = await p.locator('#spPixels .px-canvas').boundingBox();
  for (let i = 0; i < 8; i++) await p.mouse.click(cv2.x + cv2.width * (i + 0.5) / 8, cv2.y + cv2.height * 0.06);
  await p.waitForTimeout(300);
  const colorsIn = () => p.evaluate(() => { const c2 = document.querySelector('.tx3d-canvas'); const d = c2.getContext('2d').getImageData(0, 0, c2.width, c2.height).data; let r = 0, y = 0; for (let i = 0; i < d.length; i += 4) { if (d[i] > 150 && d[i + 1] < 90) r++; if (d[i] > 150 && d[i + 1] > 150 && d[i + 2] < 120) y++; } return { r, y }; });
  const tc = await colorsIn();
  ok(tc.r > 20 && tc.y > 20, '3D-Probe zeigt das Sprite als Textur', JSON.stringify(tc));
  await p.check('.tx3d-tile'); await p.click('.tx3d [data-f="ebene"]'); await p.waitForTimeout(400);
  await shot(p, 'w3-textur', { clip: await p.locator('#edSide').boundingBox() });
  ok(errs.length === 0, 'keine JS-Fehler', errs.join(' | '));
  await ctx.close();
}

// ---- 6. Handy
for (const [name, vp] of [['412×870', { width: 412, height: 870 }], ['360×640', { width: 360, height: 640 }]]) {
  const ctx = await b.newContext({ viewport: vp, deviceScaleFactor: 2.6, hasTouch: true, isMobile: true });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(url);
  await p.waitForFunction(() => window.eightboy?.carts.length);
  await p.tap('#btnStudio'); await p.waitForTimeout(400);
  ok((await outside(p, '.ed-bar .tb')).length === 0, `${name} Studio-Leiste mit 3D-Knopf im Bild`);
  await p.tap('.ed-bar [data-side="model3d"]'); await p.waitForTimeout(300);
  await p.tap('.w3-forms [data-form="kugel"]'); await p.tap('.w3-forms [data-form="wuerfel"]');
  let o = await outside(p, '#edModelPanel *');
  ok(o.length === 0, `${name} 3D-Tab Bauen passt ins Bild`, o.join(','));
  // Wischen in der Vorschau dreht die Ansicht und scrollt nicht die Seitenleiste
  const box = await p.locator('.w3-canvas').boundingBox();
  const cdp = await ctx.newCDPSession(p);
  const t = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((q) => ({ x: q.x, y: q.y, id: 1 })) });
  const before = await p.evaluate(() => document.querySelector('.w3-canvas').toDataURL());
  const sc0 = await p.evaluate(() => document.getElementById('edModelPanel').scrollTop);
  await t('touchStart', [{ x: box.x + 40, y: box.y + box.height / 2 }]);
  for (let i = 1; i <= 6; i++) { await t('touchMove', [{ x: box.x + 40 + i * 20, y: box.y + box.height / 2 + i * 4 }]); await p.waitForTimeout(16); }
  await t('touchEnd', []); await p.waitForTimeout(200);
  const after = await p.evaluate(() => document.querySelector('.w3-canvas').toDataURL());
  ok(before !== after && sc0 === await p.evaluate(() => document.getElementById('edModelPanel').scrollTop), `${name} Wischen dreht die Vorschau`);
  await shot(p, `w3-handy-bauen-${vp.width}`);
  await p.tap('.w3-mode [data-mode="obj"]'); await p.tap('#edModelPanel [data-act="sample"]'); await p.waitForTimeout(300);
  o = await outside(p, '#edModelPanel *');
  ok(o.length === 0 && /rakete/.test(await p.textContent('.w3-info')), `${name} OBJ-Beispiel geladen, passt ins Bild`, o.join(','));
  await shot(p, `w3-handy-obj-${vp.width}`);
  await p.tap('.w3-insert'); await p.waitForTimeout(300);
  ok(await p.locator('#edSide').isHidden() && /model\(0, \{/.test(await code(p)), `${name} Einfügen schließt die Seitenleiste und zeigt den Code`);
  await p.tap('.ed-bar [data-side="sprites"]'); await p.waitForTimeout(200);
  await p.tap('#spNew'); await p.waitForTimeout(300);
  o = await outside(p, '#edSpritePanel *');
  ok(o.length === 0, `${name} Sprite-Tab mit 3D-Probe passt ins Bild`, o.join(','));
  await shot(p, `w3-handy-sprite-${vp.width}`);
  ok(errs.length === 0, `${name} keine JS-Fehler`, errs.join(' | '));
  await ctx.close();
}
await b.close();
console.log(fails ? `${fails} Prüfungen fehlgeschlagen` : 'alle Werkstatt-Prüfungen bestanden');
process.exit(fails ? 1 : 0);
