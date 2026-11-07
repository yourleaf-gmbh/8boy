// Liest aus einer TTF-Schrift cmap (Format 4), hmtx, head und hhea – genug für Zeichenbreiten (tools/ui-schrift.mjs).
import fs from 'node:fs';
export function lies(datei) {
  const b = fs.readFileSync(datei), dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const n = dv.getUint16(4), tab = {};
  for (let i = 0; i < n; i++) { const o = 12 + i * 16; tab[b.toString('latin1', o, o + 4)] = dv.getUint32(o + 8); }
  const upem = dv.getUint16(tab.head + 18);
  const asc = dv.getInt16(tab.hhea + 4), desc = dv.getInt16(tab.hhea + 6), gap = dv.getInt16(tab.hhea + 8);
  const nH = dv.getUint16(tab.hhea + 34);
  const adv = (g) => dv.getUint16(tab.hmtx + 4 * Math.min(g, nH - 1));
  // cmap Format 4 (Unicode BMP)
  const cm = tab.cmap, nt = dv.getUint16(cm + 2); let sub = 0;
  for (let i = 0; i < nt; i++) { const p = dv.getUint16(cm + 4 + i * 8), e = dv.getUint16(cm + 6 + i * 8), off = dv.getUint32(cm + 8 + i * 8); if (dv.getUint16(cm + off) === 4 && (p === 3 || p === 0)) { sub = cm + off; if (p === 3 && e === 1) break; } }
  const segX2 = dv.getUint16(sub + 6), seg = segX2 / 2, ends = sub + 14, starts = ends + segX2 + 2, deltas = starts + segX2, ros = deltas + segX2;
  function glyph(cp) {
    for (let i = 0; i < seg; i++) {
      const end = dv.getUint16(ends + i * 2); if (cp > end) continue;
      const st = dv.getUint16(starts + i * 2); if (cp < st) return 0;
      const d = dv.getInt16(deltas + i * 2), ro = dv.getUint16(ros + i * 2);
      if (!ro) return (cp + d) & 0xffff;
      const g = dv.getUint16(ros + i * 2 + ro + (cp - st) * 2); return g ? (g + d) & 0xffff : 0;
    }
    return 0;
  }
  return { upem, asc, desc, gap, adv, glyph };
}
