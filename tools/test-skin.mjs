// Figuren mit Skelett ohne Browser prüfen: node tools/test-skin.mjs
//   GLB aus Blender lesen, Format B8S1 hin und zurück, Ruhelage, Animationen, Überblenden, Knochen-Positionen
import fs from 'node:fs';
import path from 'node:path';
import { importSkinGLB, packSkin, unpackSkin, pose, knochenPos } from '../js/skin.js';

const root = path.resolve(import.meta.dirname, '..');
let fehler = 0;
const ok = (c, text, extra = '') => { console.log(`${c ? 'OK  ' : 'FAIL'} ${text}${extra ? '  ' + extra : ''}`); if (!c) fehler++; };
const f = importSkinGLB(new Uint8Array(fs.readFileSync(path.join(root, 'tools/giga/figur-paket/pilot.glb'))));
ok(f.skel.namen.length === 19 && f.skel.parent.filter((p) => p < 0).length === 1, 'Skelett: 19 Knochen, eine Wurzel');
ok(['Stehen', 'Gehen', 'Rennen', 'Winken', 'Springen'].every((n) => f.clips.some((c) => c.name === n)), 'fünf Animationen', f.clips.map((c) => c.name).join(', '));
ok(f.weights.every((w, i) => i % 4 || Math.abs(f.weights[i] + f.weights[i + 1] + f.weights[i + 2] + f.weights[i + 3] - 1) < 1e-4), 'Gewichte je Ecke ergeben 1');
const g = unpackSkin(packSkin(f));
ok(g.idx.length === f.idx.length && g.clips[0].daten.length === f.clips[0].daten.length, 'B8S1: hin und zurück verlustfrei');
const nr = (n) => g.skel.namen.indexOf(n);
const P = (m, n) => knochenPos(g, m, nr(n));
const ruhe = pose(g, -1);
ok(Math.abs(P(ruhe, 'Kopf')[1] - 0.84) < 0.03 && P(ruhe, 'Fuss.L')[1] < 0.08, 'Ruhelage: Kopf oben, Füße unten (Höhe 1)', P(ruhe, 'Kopf').map((v) => v.toFixed(2)).join(','));
const clip = (n) => g.clips.findIndex((c) => c.name === n);
ok(P(pose(g, clip('Winken'), 0.4), 'Hand.R')[1] > 0.85, 'Winken: rechte Hand über dem Kopf');
ok(P(pose(g, clip('Springen'), 0.55), 'Kopf')[1] > 1.0, 'Springen: Kopf geht hoch');
const g1 = P(pose(g, clip('Gehen'), 0), 'Fuss.L'), g2 = P(pose(g, clip('Gehen'), 0.5), 'Fuss.L');
ok(Math.abs(g1[2] - g2[2]) > 0.1, 'Gehen: Fuß schwingt vor und zurück', `${g1[2].toFixed(2)} → ${g2[2].toFixed(2)}`);
const a = pose(g, clip('Gehen'), 0.25), b = pose(g, clip('Rennen'), 0.25), m = pose(g, clip('Gehen'), 0.25, clip('Rennen'), 0.25, 0.5);
const ha = P(a, 'Hand.L')[1], hb = P(b, 'Hand.L')[1], hm = P(m, 'Hand.L')[1];
ok(hm > Math.min(ha, hb) - 0.01 && hm < Math.max(ha, hb) + 0.01, 'Überblenden liegt zwischen beiden Posen');
const s0 = pose(g, clip('Gehen'), 0.1), s1 = pose(g, clip('Gehen'), 0.1 + g.clips[clip('Gehen')].dauer);
ok(s0.every((v, i) => Math.abs(v - s1[i]) < 1e-4), 'Animation läuft in Schleife');
console.log(fehler ? `${fehler} Prüfung(en) fehlgeschlagen` : 'alle Skelett-Prüfungen bestanden');
process.exit(fehler ? 1 : 0);
