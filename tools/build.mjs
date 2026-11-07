// Statischen Stand nach dist/ bauen – zum Hochladen auf einen beliebigen Webserver.   npm run build
// Die Konsole braucht keinen Build-Schritt; dist/ enthält nur, was ausgeliefert wird (keine Werkzeuge, keine Tests).
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const root = path.resolve(import.meta.dirname, '..');
const dist = path.join(root, 'dist');

// Vorab: jede JS-Datei muss sich parsen lassen, sonst lädt die Konsole nicht
for (const dir of ['js', 'js/baukasten']) {
  for (const f of fs.readdirSync(path.join(root, dir)).filter((n) => n.endsWith('.js'))) {
    try { execFileSync(process.execPath, ['--check', path.join(root, dir, f)], { stdio: 'pipe' }); } catch (e) {
      console.error(`ABBRUCH – Syntaxfehler in ${dir}/${f}:\n${e.stderr}`); process.exit(1);
    }
  }
}

fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(dist);
const copy = (rel) => fs.cpSync(path.join(root, rel), path.join(dist, rel), { recursive: true });
for (const rel of ['index.html', 'baukasten.html', 'config.js', 'manifest.webmanifest', 'sw.js', 'LICENSE', 'LICENSE-CONTENT', 'LIZENZEN.txt', 'css', 'js', 'icons', 'vendor']) copy(rel);

// Kartridges: Grundregal (index.json), Store (store.json) und 8BOY 128 (giga.json, nur mit ?giga sichtbar)
const json = (rel) => JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8').replace(/^﻿/, ''));
const files = new Set([...json('carts/index.json'), ...json('carts/store.json').map((e) => e.file), ...json('carts/giga.json')]);
fs.mkdirSync(path.join(dist, 'carts'));
fs.mkdirSync(path.join(dist, 'covers'));
for (const f of ['index.json', 'store.json', 'giga.json']) fs.copyFileSync(path.join(root, 'carts', f), path.join(dist, 'carts', f));
for (const f of files) {
  fs.copyFileSync(path.join(root, 'carts', f), path.join(dist, 'carts', f));
  const png = f.replace(/\.lua$/, '.png');
  if (fs.existsSync(path.join(root, 'covers', png))) fs.copyFileSync(path.join(root, 'covers', png), path.join(dist, 'covers', png));
}
// Asset-Pakete (das Testpaket giga-test bleibt draußen)
for (const p of fs.readdirSync(path.join(root, 'assets'))) {
  if (p !== 'giga-test' && fs.existsSync(path.join(root, 'assets', p, 'manifest.json'))) fs.cpSync(path.join(root, 'assets', p), path.join(dist, 'assets', p), { recursive: true });
}

let size = 0;
const count = (dir) => { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const p = path.join(dir, e.name); if (e.isDirectory()) count(p); else size += fs.statSync(p).size; } };
count(dist);
console.log(`dist/ fertig: ${files.size} Kartridges, ${(size / 1024 / 1024).toFixed(1)} MB.`);
