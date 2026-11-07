// Geschenk-Link anlegen: eine PNG-Kartridge per Link verschicken, der nur wenige Male funktioniert.
//   node tools/geschenk.mjs <kartridge.8boy.png> [--max 4] [--basis https://spiel.example.org/] [--ziel geschenke]
//
// Legt <ziel>/<schlüssel>/<name>.8boy.png an (Schlüssel: 128 Bit Zufall) und gibt den Link aus:
//   <basis>#paket=g/<schlüssel>/<name>.8boy.png
// Ausgeliefert wird die Datei von server/lobby.mjs unter /g/ (GESCHENKE_DIR = <ziel>); der Server zählt die Abrufe
// und löscht die Datei nach dem letzten. Lokal liefert tools/serve.mjs den Ordner geschenke/ ohne Zähler aus.
// PNG-Kartridges entstehen im Regal („⇩ Packung“) oder mit: node tools/pack.mjs packages <datei.lua>
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const args = process.argv.slice(2);
const opt = (name, fallback) => { const i = args.indexOf(name); return i >= 0 ? args.splice(i, 2)[1] : fallback; };
const max = parseInt(opt('--max', ''), 10);
const basis = opt('--basis', 'http://localhost:8080/');
const ziel = path.resolve(opt('--ziel', path.join(import.meta.dirname, '..', 'geschenke')));
const quelle = args[0];
if (!quelle || !/\.8boy\.png$/.test(quelle) || !fs.existsSync(quelle)) {
  console.error('Aufruf: node tools/geschenk.mjs <kartridge.8boy.png> [--max N] [--basis URL] [--ziel ORDNER]');
  process.exit(1);
}
const name = path.basename(quelle).toLowerCase().replace(/[^a-z0-9.-]/g, '-');
if (!/^[a-z0-9-]+\.8boy\.png$/.test(name)) { console.error('Dateiname nur aus a–z, 0–9 und „-“: ' + name); process.exit(1); }
const key = crypto.randomBytes(16).toString('hex');
fs.mkdirSync(path.join(ziel, key), { recursive: true });
fs.copyFileSync(quelle, path.join(ziel, key, name));
if (max > 0) fs.writeFileSync(path.join(ziel, key, '.max'), String(max));
console.log(`${basis.replace(/\/?$/, '/')}#paket=g/${key}/${name}`);
