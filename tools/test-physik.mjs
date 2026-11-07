// Engine-Physik des 8BOY 128 ohne Browser prüfen: node tools/test-physik.mjs
//   Kollisionswelt (Gitter, Strahlen, Boden, Kugel), Fahrzeug (Federung, Rampe, Wand, Lenken), Welt-Paket der Insel
import fs from 'node:fs';
import path from 'node:path';
import { createWelt, createAuto, drehung } from '../js/physik.js';
import { builtinModel } from '../js/gfx3d.js';
import { unpackModel, meshToChip } from '../js/model-pack.js';

const root = path.resolve(import.meta.dirname, '..');
let fehler = 0;
const ok = (c, text, extra = '') => { console.log(`${c ? 'OK  ' : 'FAIL'} ${text}${extra ? '  ' + extra : ''}`); if (!c) fehler++; };
const nah = (a, b, e = 1e-3) => Math.abs(a - b) < e;

const w = createWelt();
w.add(builtinModel('ebene', 7), 0, 0, 0, 0, 0, 0, 200);
w.add(builtinModel('wuerfel', 7), 0, 2, 40, 0, 0, 0, [20, 4, 1]);
w.add(builtinModel('wuerfel', 7), 0, 0, 15, 0, -0.25, 0, [6, 1, 8]);
ok(w.dreiecke === 26 && w.zellen > 2000, 'Welt: Ebene, Wand und Rampe im Gitter', `${w.dreiecke} Dreiecke, ${w.zellen} Zellen`);
const R = drehung(0.7, 0.3, -0.2);
ok(nah(Math.hypot(R[0], R[1], R[2]), 1) && nah(R[0] * R[3] + R[1] * R[4] + R[2] * R[5], 0), 'Drehung wie draw3d ist orthonormal');
const b = w.ground(3, 3);
ok(b && nah(b.y, 0) && nah(b.ny, 1), 'Boden unter (3, 3) ist y = 0, flach');
const s = w.ray(8, 1, 0, 0, 0, 1, 100);   // neben der Rampe vorbei
ok(s && nah(s.t, 39.5, 0.01) && s.nz < -0.99, 'Strahl nach vorn trifft die Wand bei z = 39.5', s && s.t.toFixed(2));
ok(w.ray(0, 1, 0, 0, 0, -1, 50) === null, 'Strahl nach hinten trifft nichts');
const k = w.push(10, 0.3, 10, 0.5);
ok(nah(k.y, 0.5) && k.boden, 'Kugel wird aus dem Boden geschoben und steht');
const k2 = w.push(0, 1, 39.2, 0.5);
ok(k2.z < 39.01 && !k2.boden, 'Kugel wird aus der Wand geschoben', k2.z.toFixed(2));

const a = createAuto(w, 0, 3, 0, 0);
for (let i = 0; i < 120; i++) a.schritt(0, 0, 0);
ok(a.boden === 4 && a.raeder.every((r) => nah(r.druck, 0.5, 0.05)), 'Fahrzeug landet und federt halb ein', a.raeder.map((r) => r.druck.toFixed(2)).join(','));
let maxY = 0;
for (let i = 0; i < 240; i++) { a.schritt(1, 0, 0); maxY = Math.max(maxY, a.y); }
ok(maxY > 1.5, 'über die Rampe gesprungen', `höchster Punkt ${maxY.toFixed(2)} m`);
for (let i = 0; i < 300; i++) a.schritt(1, 0, 0);
ok(a.z < 39.5 && a.z > 35 && Math.abs(a.tempo) < 1, 'an der Wand gestoppt (nicht hindurch)', `z ${a.z.toFixed(2)}`);
const c = createAuto(w, -40, 1, -40, 0);
for (let i = 0; i < 180; i++) c.schritt(1, 1, 0);
ok(c.yaw > 2 && c.tempo > 5, 'Lenken dreht das Fahrzeug', `Gier ${c.yaw.toFixed(2)}`);
const d = createAuto(w, -40, 1, 60, 0);
for (let i = 0; i < 120; i++) d.schritt(1, 0, 0);
const v0 = d.tempo;
for (let i = 0; i < 90; i++) d.schritt(0, 0, 1);
ok(v0 > 10 && Math.abs(d.tempo) < 0.5, 'Bremse hält an', `${v0.toFixed(1)} m/s → ${d.tempo.toFixed(2)}`);
// Wiederholbar: gleiche Eingaben, gleiche Fahrt
const fahrt = () => { const e = createAuto(w, 5, 2, 5, 0.3); for (let i = 0; i < 200; i++) e.schritt(Math.sin(i / 20), Math.cos(i / 15), 0); return [e.x, e.y, e.z, e.yaw]; };
ok(fahrt().every((v, i, arr) => v === fahrt()[i]), 'gleiche Eingaben → gleiche Fahrt');

// Insel aus dem Welt-Paket: Kachel laden, Boden und Fahrt darauf
const man = JSON.parse(fs.readFileSync(path.join(root, 'assets/giga-welt/manifest.json'), 'utf8'));
const kachel = (n) => meshToChip(unpackModel(new Uint8Array(fs.readFileSync(path.join(root, 'assets/giga-welt', man.assets[n].datei)))));
ok(Object.keys(man.assets).filter((n) => n.startsWith('insel-')).length === 16 && man.assets['baum.lod1'] && man.assets['baum.lod2'], 'Welt-Paket: 16 Kacheln, Baum mit zwei Detailstufen');
ok(Object.entries(man.assets).filter(([n, e]) => n.startsWith('insel-') && !e.vorab).length >= 10, 'die meisten Kacheln kommen erst beim Fahren (Stream)');
const iw = createWelt();
for (const [n, e] of Object.entries(man.assets)) if (n.startsWith('insel-') && e.vorab) iw.add(kachel(n));
const g = iw.ground(0, -78.8);
ok(g && g.y > 1 && g.y < 6 && g.ny > 0.95, 'Start auf der Strecke: fester, flacher Boden', g && `y ${g.y.toFixed(2)}`);
const e = createAuto(iw, 0, g.y + 1.2, -78.8, 1.7);
let amBoden = 0;
for (let i = 0; i < 120; i++) { e.schritt(0.7, 0, 0); if (e.boden >= 3) amBoden++; }
ok(amBoden > 100 && Math.hypot(e.x, e.z + 78.8) > 8, 'Buggy fährt auf der Insel', `${Math.hypot(e.x, e.z + 78.8).toFixed(0)} m, ${amBoden}/120 Bilder mit Bodenkontakt`);
console.log(fehler ? `${fehler} Prüfung(en) fehlgeschlagen` : 'alle Physik-Prüfungen bestanden');
process.exit(fehler ? 1 : 0);
