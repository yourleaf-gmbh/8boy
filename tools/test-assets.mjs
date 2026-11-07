// Asset-Pakete (8BOY 128, Meilenstein 1) prüfen: node tools/test-assets.mjs
//   1. ohne Browser: Paket bauen, ZIP lesen, Laden über „Server“, Prüfsumme, lokales Paket ohne Netz, Fehlerfälle
//   2. im Browser: Kartridge mit „-- assets: giga-test“ startet mit Ladebalken, modelload("asset:jetski"),
//      Nachladen per assetload; danach .8bpak importieren und OHNE Server (assets/ blockiert) spielen
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { chromium } from 'playwright';
import { createAssets, leseZip } from '../js/assets.js';
import { unpackModel } from '../js/model-pack.js';
import { parseCart } from '../js/carts.js';

const root = path.resolve(import.meta.dirname, '..');
let fehler = 0;
const ok = (c, text, extra = '') => { console.log(`${c ? 'OK  ' : 'FAIL'} ${text}${extra ? '  ' + extra : ''}`); if (!c) fehler++; };

// ---------------------------------------------------------------- 1. ohne Browser
execFileSync(process.execPath, [path.join(root, 'tools/assetpack.mjs'), path.join(root, 'tools/giga/test-paket')], { stdio: 'ignore' });
const pak = fs.readFileSync(path.join(root, 'pakete/giga-test.8bpak'));
const zip = await leseZip(pak);
ok(zip.has('manifest.json') && zip.size === 3, '.8bpak ist ein lesbares ZIP mit Manifest und zwei Dateien', [...zip.keys()].join(', '));

const vonPlatte = (u) => {
  const f = path.join(root, u);
  return Promise.resolve(fs.existsSync(f) ? new Response(fs.readFileSync(f)) : new Response('fehlt', { status: 404 }));
};
const a1 = createAssets({ basis: 'assets/', holen: vonPlatte, lokal: null, cache: null });
let schritte = 0;
const r1 = await a1.vorbereiten(['giga-test'], () => schritte++);
ok(r1.pakete[0].quelle === 'server', 'Paket kommt vom Server (Manifest + Dateien)');
ok(a1.status('jetski') === 'bereit' && a1.status('notiz') === 'fehlt', '„vorab“ geladen, der Rest erst bei Bedarf', `${a1.status('jetski')} / ${a1.status('notiz')}`);
ok(schritte >= 2 && a1.fortschritt().geladen > 14000, 'Fortschritt wird gemeldet', `${schritte} Meldungen`);
const m = unpackModel(a1.bytes('jetski'));
ok(m.idx.length / 3 === 544, 'Modell aus Blender kommt vollständig an', `${m.idx.length / 3} Dreiecke`);
await a1.laden('notiz');
ok(JSON.parse(new TextDecoder().decode(a1.bytes('notiz'))).text.startsWith('Nachgeladen'), 'Nachladen eines Assets');
// verfälschte Datei
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'assets/giga-test/manifest.json'), 'utf8'));
const boese = (u) => (u.endsWith('.b8m') ? Promise.resolve(new Response(new Uint8Array(100))) : vonPlatte(u));
const a2 = createAssets({ holen: boese, lokal: null, cache: null });
let msg = '';
try { await a2.vorbereiten(['giga-test']); } catch (e) { msg = e.message; }
ok(/Prüfsumme/.test(msg), 'untergeschobene Datei fällt auf', msg);
// fehlendes Paket, unerlaubter Name
msg = '';
try { await createAssets({ holen: vonPlatte, lokal: null, cache: null }).vorbereiten(['gibt-es-nicht']); } catch (e) { msg = e.message; }
ok(/nicht gefunden/.test(msg), 'fehlendes Paket: verständlicher Fehler', msg);
msg = '';
try { await createAssets({ holen: vonPlatte, lokal: null, cache: null }).vorbereiten(['../geheim']); } catch (e) { msg = e.message; }
ok(/ungültiger Paketname/.test(msg), 'Paketname mit Pfad wird abgelehnt', msg);
ok(parseCart('-- assets: giga-test, ../x, ok-2').assets.join() === 'giga-test,ok-2', 'Kopfzeile „-- assets:“ nimmt nur gültige Namen');
// lokales Paket (wie IndexedDB) ohne Netz
const mem = { m: new Map(), d: new Map(),
  manifest: async (p) => mem.m.get(p), datei: async (p, f) => mem.d.get(p + '/' + f),
  speichern: async (mm, dat) => { for (const [n, b] of dat) mem.d.set(mm.paket + '/' + n, b); mem.m.set(mm.paket, mm); },
  alle: async () => [...mem.m.values()], loeschen: async () => {} };
const offline = () => Promise.reject(new Error('offline'));
const a3 = createAssets({ holen: offline, lokal: mem, cache: null });
const mi = await a3.paketImportieren(pak);
ok(mi.paket === 'giga-test' && manifest.version === mi.version, '.8bpak importiert');
const r3 = await a3.vorbereiten(['giga-test']);
ok(r3.pakete[0].quelle === 'lokal' && a3.status('jetski') === 'bereit', 'lokales Paket läuft ohne Netz');

// ---------------------------------------------------------------- 2. im Browser
const PORT = 8097;
const server = spawn(process.execPath, [path.join(root, 'tools/serve.mjs'), String(PORT)], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 900));
const CART = `-- title: Asset-Probe
-- system: 64
-- assets: giga-test
function _init()
  n = modelload(0, "asset:jetski")
  store("dreiecke", n)
  store("notiz_vorher", asset("notiz"))
  assetload("notiz")
  f = 0
end
function _update()
  f = f + 1
  if f == 30 then store("notiz_nachher", asset("notiz")) local g, s = assetinfo() store("bytes", g) end
end
function _draw()
  cls(0) cls3d(0x203050, 0x101828) light3d(-0.4, -0.6, 0.6, 0.4)
  cam3d(0, 1.2, -4.5, 0, -0.1, 50)
  draw3d(0, 0, 0, 0, t(), 0, 0, 2.4)
end
`;
const b = await chromium.launch();
async function lauf(name, vorher) {
  const ctx = await b.newContext({ viewport: { width: 1200, height: 800 } });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(`http://localhost:${PORT}/`);
  await p.waitForFunction(() => window.eightboy?.carts?.length);
  if (vorher) await vorher(p, ctx);
  await p.evaluate(async (code) => {
    const { parseCart } = await import('/js/carts.js');
    window.eightboy.powerOn(); window.eightboy.switchMachine(64);
    await new Promise((r) => setTimeout(r, 3600));
    window.eightboy.system.insert(parseCart(code, { id: 'asset-probe', file: 'probe.lua', builtin: false }));
  }, CART);
  await p.waitForFunction(() => ['running', 'error'].includes(window.eightboy.system.state), null, { timeout: 30000 });
  await p.waitForTimeout(1500);
  const st = await p.evaluate(() => window.eightboy.system.state);
  const werte = await p.evaluate(() => Object.fromEntries(Object.keys(localStorage).filter((k) => k.includes('asset-probe')).map((k) => [k.split(':').pop(), JSON.parse(localStorage.getItem(k))])));
  fs.mkdirSync(path.join(root, 'shots/assets'), { recursive: true });
  await p.locator('#screen').screenshot({ path: path.join(root, `shots/assets/${name}.png`) });
  await ctx.close();
  return { st, werte, errs };
}
const s1 = await lauf('server');
ok(s1.st === 'running' && s1.werte.dreiecke === 544, 'Browser: Kartridge lädt das Paket vom Server und startet', `${s1.st}, ${s1.werte.dreiecke} Dreiecke`);
ok(s1.werte.notiz_vorher === 'fehlt' && s1.werte.notiz_nachher === 'bereit', 'Browser: assetload lädt unterwegs nach', `${s1.werte.notiz_vorher} → ${s1.werte.notiz_nachher}`);
ok(!s1.errs.length, 'Browser: keine Skriptfehler', s1.errs.join(' | '));
const s2 = await lauf('offline-8bpak', async (p, ctx) => {
  await p.evaluate((bytes) => window.eightboy.importBytes(new Uint8Array(bytes), 'giga-test.8bpak'), [...pak]);
  await p.waitForTimeout(800);
  await ctx.route('**/assets/**', (r) => r.abort());   // ab jetzt kein Server mehr
});
ok(s2.st === 'running' && s2.werte.dreiecke === 544, 'Browser: .8bpak importiert, läuft ohne Server', `${s2.st}`);
const s3 = await lauf('fehlt', async (p, ctx) => { await ctx.route('**/assets/**', (r) => r.abort()); });
ok(s3.st === 'error', 'Browser: ohne Paket und ohne Netz gibt es eine Fehlermeldung statt eines Absturzes', s3.st);
await b.close();
server.kill();
console.log(fehler ? `${fehler} Prüfung(en) fehlgeschlagen` : 'alle Asset-Prüfungen bestanden');
process.exit(fehler ? 1 : 0);
