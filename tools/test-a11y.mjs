// Zugänglichkeit prüfen (Kartridges mit „-- a11y: voll“), nach WCAG 2.2 AA und den Game Accessibility Guidelines:
//   node tools/test-a11y.mjs [datei.lua …] [--nur-bot] [--nur-browser] [--bilder N]
//
// 1. Blinder Bot (Node, ohne Browser): spielt NUR über _describe und choose/_choice – keine Spieltasten, kein Bild.
//    Prüft: Es gibt immer eine Auswahl, wenn das Spiel auf eine Entscheidung wartet (sonst „hängt“ der Bot),
//    _describe liefert jederzeit Text, das Spiel erreicht sein Ende (_describe enthält dann „Spielende“).
// 2. Browser (Playwright gegen http://localhost:8080): Vorlesen an, axe-core WCAG 2.2 A/AA ohne Verstoß in der
//    Zugänglichkeits-Ebene, Bedienung nur mit Tastatur (L, Pfeile, Enter), Zoom 200 % ohne waagerechtes Scrollen.
import fs from 'node:fs';
import path from 'node:path';
import fengari from 'fengari';

const root = path.resolve(import.meta.dirname, '..');
const args = process.argv.slice(2);
const files = args.filter((a) => a.endsWith('.lua'));
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? +args[i + 1] : d; };
const MAXF = opt('--bilder', 120000);
// ohne Angabe: alle barrierefreien Kartridges aus Grundregal und Store (die Lernspiele liegen im Store)
const ziele = files.length ? files : [...JSON.parse(fs.readFileSync(path.join(root, 'carts/index.json'), 'utf8').replace(/^\uFEFF/, '')),
  ...JSON.parse(fs.readFileSync(path.join(root, 'carts/store.json'), 'utf8')).map((e) => e.file)]
  .filter((f) => /^--\s*a11y:\s*voll/m.test(fs.readFileSync(path.join(root, 'carts', f), 'utf8')));
let fehler = 0;
const ok = (c, label, extra = '') => { if (!c) fehler++; console.log(`${c ? 'OK  ' : 'FEHL'} ${label}${extra ? '  ' + extra : ''}`); };

// ---------------------------------------------------------------- 1. Blinder Bot
if (!args.includes('--nur-browser')) {
  const R = path.join(root, 'js');
  const imp = (f) => import('file:///' + path.join(R, f).replace(/\\/g, '/'));
  const { createGfx } = await imp('gfx.js');
  const { createInput } = await imp('input.js');
  const { createVM } = await imp('vm.js');
  const { parseMML, SFX } = await imp('audio.js');
  const { machineFor } = await imp('machines.js');
  const { parseCart } = await imp('carts.js');
  const audio = { play(m) { parseMML(m, true); }, stop() {}, sfx(n) { parseMML(SFX[n] ?? n); }, beep() {}, playing() { return false; }, playpos() { return 0; }, tone() {} };
  for (const file of ziele) {
    for (const leicht of [false, true]) {
      const code = fs.readFileSync(path.join(root, 'carts', file), 'utf8');
      const cart = parseCart(code, { id: file });
      const machine = machineFor(cart.system);
      const gfx = createGfx(machine), input = createInput(), st = new Map();
      let wahl = null, ansagen = 0, ende = false, logs = [];
      const access = {
        say: () => { ansagen++; }, cue() {}, caption: () => { ansagen++; },
        choose: (id, opts, titel, nr) => { wahl = opts && opts.length ? { id, opts, titel, nr } : null; },
        settings: () => ({ reader: true, voice: false, contrast: false, motion: true, captions: true, leicht, speed: 1 }),
      };
      const vm = createVM({ fengari, gfx, audio, input, storage: { get: (k) => st.get(k) ?? null, set: (k, v) => st.set(k, v) }, onLog: (m) => logs.push(m), machine, access });
      let f = 0, gewaehlt = 0, ohne = 0, maxOhne = 0, leer = 0, fail = '', zufall = 20261025;
      const verlauf = [];
      try {
        vm.run(code, 'cart');
        for (f = 0; f < MAXF; f++) {
          input.tick();
          vm.update(); vm.draw();
          if (f % 30 === 0 && !vm.describe()) leer++;
          if (wahl) {
            ohne = 0;
            // gleichmäßig verteilt wählen, damit viele Wege vorkommen
            // Fest gesäter Pseudozufall statt (gewaehlt*7 + f): Die alte Formel hängt nur von Zählern ab und rastet
            // ein, sobald die Wahlen in einem festen Takt kommen (z. B. jedes Bild: Schritt 8 ≡ 0 bei 2, 4, 8
            // Möglichkeiten, oder ein Kreis Welt → Menü → Titel → Fortsetzen). Dann wählt der Bot immer dasselbe.
            zufall = (Math.imul(zufall, 1103515245) + 12345) >>> 0;
            const nr = 1 + ((zufall >>> 16) % wahl.opts.length);
            if (verlauf.length < 400) verlauf.push(`${wahl.titel || wahl.id}: ${wahl.opts[nr - 1]}`);
            const id = wahl.id;
            wahl = null;
            vm.choice(id, nr);
            gewaehlt++;
          } else { ohne++; maxOhne = Math.max(maxOhne, ohne); }
          if (f % 60 === 0) {
            // _describe nennt am Ende „Spielende“
            if (/Spielende|Ende des Spiels|Auswertung abgeschlossen/i.test(vm.describe())) { ende = true; break; }
          }
        }
      } catch (e) { fail = e.message; }
      vm.close();
      const name = `${file}${leicht ? ' (Leichte Sprache)' : ''}`;
      ok(!fail, `${name}: läuft ohne Fehler`, fail);
      ok(gewaehlt > 20, `${name}: Bot spielt nur über die Auswahl`, `${gewaehlt} Entscheidungen, ${ansagen} Ansagen`);
      ok(maxOhne < 60 * 30, `${name}: nie länger als 30 s ohne Auswahl`, `längste Pause ${(maxOhne / 60).toFixed(1)} s`);
      ok(leer === 0, `${name}: _describe liefert immer Text`);
      ok(ende, `${name}: Spiel bis zum Ende spielbar`, `${(f / 60 / 60).toFixed(1)} min Spielzeit`);
      if (args.includes('--verlauf')) console.log(verlauf.slice(0, 60).join('\n'));
    }
  }
}

// ---------------------------------------------------------------- 2. Browser: axe, Tastatur, Zoom
if (!args.includes('--nur-bot')) {
  const { chromium } = await import('playwright');
  let axePfad = path.join(root, 'node_modules/axe-core/axe.min.js');
  const url = process.env.URL || 'http://localhost:8080/';
  const b = await chromium.launch();
  for (const file of ziele) {
    for (const [name, vp] of [['Desktop', { width: 1366, height: 860 }], ['Handy', { width: 390, height: 844 }]]) {
      const ctx = await b.newContext({ viewport: vp, isMobile: name === 'Handy', hasTouch: name === 'Handy' });
      const p = await ctx.newPage();
      const errs = []; p.on('pageerror', (e) => errs.push(e.message));
      await p.addInitScript(() => localStorage.setItem('8boy:a11y', JSON.stringify({ reader: true, captions: true, speed: 1 })));
      await p.goto(url);
      await p.waitForFunction(() => window.eightboy?.carts.length);
      await p.evaluate((f) => { localStorage.setItem('8boy:unpacked', JSON.stringify(window.eightboy.carts.map((c) => c.id))); window.eightboy.insertCart(f); }, file);
      await p.waitForFunction(() => window.eightboy.system.state === 'running', null, { timeout: 20000 }).catch(() => {});
      await p.waitForTimeout(1500);
      ok(await p.locator('.a11y.sichtbar').isVisible(), `${file} ${name}: Vorlesen-Ebene sichtbar`);
      await p.addScriptTag({ path: axePfad });
      let verstoesse = [], zustaende = 0;
      for (let i = 0; i < 12; i++) {
        const v = await p.evaluate(async () => (await window.axe.run('.a11y', { runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] })).violations.map((x) => x.id));
        verstoesse.push(...v); zustaende++;
        // nur Tastatur: L springt in die Auswahl, Enter wählt
        await p.keyboard.press('KeyL'); await p.waitForTimeout(80);
        const hat = await p.evaluate(() => document.activeElement?.classList.contains('a11y-opt'));
        if (hat) { await p.keyboard.press('Enter'); await p.waitForTimeout(600); }
        else { await p.keyboard.down('KeyX'); await p.waitForTimeout(80); await p.keyboard.up('KeyX'); await p.waitForTimeout(600); }
      }
      ok(!verstoesse.length, `${file} ${name}: axe WCAG 2.2 A/AA ohne Verstoß`, `${zustaende} Zustände${verstoesse.length ? ' · ' + [...new Set(verstoesse)].join(', ') : ''}`);
      await p.keyboard.press('KeyH'); await p.waitForTimeout(200);
      ok((await p.locator('#a11yStatus').textContent()).length > 10, `${file} ${name}: Taste H liest den Zustand`);
      // Zoom 200 %: Text der Ebene bleibt lesbar, kein waagerechtes Scrollen der Seite
      await p.evaluate(() => { document.body.style.zoom = '2'; });
      await p.waitForTimeout(300);
      ok(!(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth * 1.01 + 2)), `${file} ${name}: Zoom 200 % ohne waagerechtes Scrollen`);
      ok(!errs.length, `${file} ${name}: keine JS-Fehler`, errs.join(' | '));
      await ctx.close();
    }
  }
  await b.close();
}
console.log(fehler ? `${fehler} Prüfung(en) fehlgeschlagen` : 'alle Zugänglichkeits-Prüfungen bestanden');
process.exit(fehler ? 1 : 0);
