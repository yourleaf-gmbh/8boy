// Store-Katalog erzeugen: carts/store.json (Titel, Beschreibung, Konsole, Kategorie je Spiel) aus den Kartridge-Köpfen
//   node tools/store.mjs
// Welche Spiele im Store liegen, steht in STORE unten; alles in carts/index.json bildet das Grundregal.
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
// Grundregal: je Konsole die erste Lektion (und lokal die internen Kartridges). Alles andere kommt aus dem Store.
// Kategorie je Spiel; Lektionen und Lernspiele erkennt der Kopf (kind: tutorial, highlight + license).
// Kartridges dieses Repos, die im Store statt im Grundregal liegen (Dateiname → Kategorie). Lektionen und Lernspiele
// liegen im Repo 8boy-lernspiele und kommen über einen externen Katalog (config.js, katalogUrl).
export const STORE = {};
// Lagen bis Oktober 2026 fest im Regal: Wer sie schon ausgepackt hat, behält sie (js/main.js, storeFiles)
const FRUEHER_IM_REGAL = /^$/;

const kopf = (code, k) => (code.match(new RegExp('^-- ' + k + ':[ \t]*(.*)$', 'm')) || [])[1]?.trim() || '';
const liste = Object.entries(STORE).filter(([file]) => {
  if (fs.existsSync(path.join(root, 'carts', file))) return true;
  console.warn(`fehlt noch: carts/${file} – nicht im Store`);
  return false;
}).map(([file, kat]) => {
  const code = fs.readFileSync(path.join(root, 'carts', file), 'utf8');
  const kind = kopf(code, 'kind') || 'game';
  const lern = /^(true|ja|1)$/i.test(kopf(code, 'highlight')) && !!kopf(code, 'license');
  return {
    file, title: kopf(code, 'title'), desc: kopf(code, 'desc'), author: kopf(code, 'author'),
    system: +kopf(code, 'system') || 8, kind, color: +kopf(code, 'color') || 0,
    players: +kopf(code, 'players') || 1, kb: Math.round(code.length / 1024),
    kat: lern ? 'Lernspiele' : kind === 'tutorial' ? 'Lektionen' : kat || 'Spiele',
    ...(lern ? { lern: true } : {}),
    ...(/\bnet\.join\(/.test(code) ? { online: true } : {}),   // Online-Mehrspieler über die Lobby
    ...(FRUEHER_IM_REGAL.test(file) ? { frueher: true } : {}),
  };
});
fs.writeFileSync(path.join(root, 'carts/store.json'), JSON.stringify(liste, null, 1) + '\n');
// Grundregal: alles aus index.json, was nicht im Store liegt
const idx = path.join(root, 'carts/index.json');
const regal = JSON.parse(fs.readFileSync(idx, 'utf8').replace(/^﻿/, '')).filter((f) => !(f in STORE));
fs.writeFileSync(idx, JSON.stringify(regal) + '\n');
console.log(`Store: ${liste.length} Spiele · Grundregal: ${regal.length} Kartridges (${regal.join(', ')})`);
