// Erzeugt js/ui-schrift.js: Vorschübe der UI-Schrift (Atkinson Hyperlegible, OFL) für ui_textw().
// Die Breiten stehen fest in der Konsole, damit Layouts überall gleich ausfallen (auch headless, ohne Browser-Messung).
// Aufruf: node tools/ui-schrift.mjs
import fs from 'node:fs';
import path from 'node:path';
import { lies } from './ttf-metrik.mjs';

const root = path.resolve(import.meta.dirname, '..');
function tabelle(datei) {
  const f = lies(path.join(root, 'vendor', datei));
  const paare = [];
  for (let cp = 0x20; cp < 0x3000; cp++) { const g = f.glyph(cp); if (g || cp === 0x20) paare.push(cp.toString(36) + ':' + f.adv(g)); }
  return { upem: f.upem, paare: paare.join(',') };
}
const r = tabelle('AtkinsonHyperlegible-Regular.ttf'), b = tabelle('AtkinsonHyperlegible-Bold.ttf');
fs.writeFileSync(path.join(root, 'js/ui-schrift.js'), `// Erzeugt von tools/ui-schrift.mjs – nicht von Hand ändern.
// Vorschübe der UI-Schrift (Atkinson Hyperlegible, SIL Open Font License, vendor/AtkinsonHyperlegible-OFL.txt)
// in Einheiten von 1/${r.upem} Schriftgröße, Zeichen als Codepunkt zur Basis 36.
export const UI_UPEM = ${r.upem};
export const UI_NORMAL = '${r.paare}';
export const UI_FETT = '${b.paare}';
`);
console.log('js/ui-schrift.js', fs.statSync(path.join(root, 'js/ui-schrift.js')).size, 'Bytes');
