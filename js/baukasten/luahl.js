// Einfache Lua-Hervorhebung für die Code-Ansicht (zeilenweise; mehrzeilige [[ ]] werden mitgeführt).
import { API, KEYWORDS } from '../api-docs.js';

const esc = (s) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const KW = new Set(KEYWORDS);
const FN = new Set(API.map((a) => a.n));

export function highlightLines(lines) {
  let inLong = null; // 'str' | 'com'
  return lines.map((line) => {
    let out = '', i = 0;
    if (inLong) {
      const end = line.indexOf(']]');
      if (end < 0) return `<span class="${inLong === 'com' ? 'hc' : 'hs'}">${esc(line)}</span>`;
      out += `<span class="${inLong === 'com' ? 'hc' : 'hs'}">${esc(line.slice(0, end + 2))}</span>`;
      i = end + 2; inLong = null;
    }
    while (i < line.length) {
      const rest = line.slice(i);
      let m;
      if (rest.startsWith('--[[')) {
        const end = rest.indexOf(']]', 4);
        if (end < 0) { out += `<span class="hc">${esc(rest)}</span>`; inLong = 'com'; break; }
        out += `<span class="hc">${esc(rest.slice(0, end + 2))}</span>`; i += end + 2; continue;
      }
      if (rest.startsWith('--')) { out += `<span class="hc">${esc(rest)}</span>`; break; }
      if (rest.startsWith('[[')) {
        const end = rest.indexOf(']]', 2);
        if (end < 0) { out += `<span class="hs">${esc(rest)}</span>`; inLong = 'str'; break; }
        out += `<span class="hs">${esc(rest.slice(0, end + 2))}</span>`; i += end + 2; continue;
      }
      if ((m = /^"(?:[^"\\]|\\.)*"?/.exec(rest))) { out += `<span class="hs">${esc(m[0])}</span>`; i += m[0].length; continue; }
      if ((m = /^\d+(?:\.\d+)?/.exec(rest))) { out += `<span class="hn">${m[0]}</span>`; i += m[0].length; continue; }
      if ((m = /^[A-Za-z_][\w]*/.exec(rest))) {
        const w = m[0];
        const isCall = /^\s*\(/.test(rest.slice(w.length));
        if (KW.has(w)) out += `<span class="hk">${w}</span>`;
        else if (FN.has(w) && isCall) out += `<span class="hf">${w}</span>`;
        else if (isCall) out += `<span class="hu">${w}</span>`;
        else if (/^[A-Z][A-Z_0-9]+$/.test(w)) out += `<span class="hC">${w}</span>`;
        else out += esc(w);
        i += w.length; continue;
      }
      out += esc(rest[0]); i++;
    }
    return out;
  });
}
