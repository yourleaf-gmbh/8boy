// 8BOY Klang-Chip: 4 Kanäle, Wellenformen Puls 50/25/12,5 %, Dreieck, Sägezahn, Rauschen.
// 8BOY 16: 8 Kanäle und 16 Instrumente aus Klangproben (32 kHz wie beim SNES), Stereo und Hall.
// 8BOY 32: dasselbe auf 16 Kanälen.
// Melodien werden als MML-Text geschrieben (Music Macro Language, wie auf den Heimcomputern der 80er).
//
//   t120   Tempo (Viertel pro Minute)        o4   Oktave 0-8      < >  Oktave runter / rauf
//   l8     Standardlänge (1,2,4,8,16,32)     v10  Lautstärke 0-15 w0   Welle 0-5
//   q7     Notenlänge in Achteln (1-8)       c d e f g a b  Noten, + oder # erhöht, - erniedrigt
//   r      Pause                             c4. Länge + Punkt     [ ... ]3  Wiederholung
// Nur 8BOY 16:
//   @3     Instrument 0-15 (w schaltet zurück auf die Wellen), 8BOY 32: 0-31
//   p8     Stereo 0 (links) bis 16 (rechts)  h6   Hall 0-15

export const WAVES = ['puls50', 'puls25', 'puls12', 'dreieck', 'saege', 'rauschen'];
export const INSTRUMENTS = ['Klavier', 'E-Piano', 'Streicher', 'Bläser', 'Flöte', 'Orgel', 'Bass', 'Marimba',
  'Chor', 'Glocke', 'Gitarre', 'Synth', 'Schlagzeug', 'Pizzicato', 'Fläche', 'FM-Bass',
  // nur 8BOY 32 (44,1 kHz):
  'Rockgitarre', 'Slap-Bass', 'Saxophon', 'Trompete', 'Acid-Bass', 'Trance-Lead', 'Warme Fläche', 'Vibraphon',
  'Harfe', 'Steel-Drum', 'Panflöte', 'Stimme Uuh', 'Pauke', 'Orchesterschlag', '808-Schlagzeug', 'Techno-Schlagzeug'];
const SEMI = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };

export const SFX = {
  jump: 't240 w1 v10 l32 o4 c e g >c e',
  coin: 't200 w1 v9 l16 o6 b >e4',
  hit: 't240 w5 v12 l32 o3 c <a f d',
  blip: 't240 w0 v8 l32 o5 c',
  select: 't240 w1 v8 l32 o5 e g >c',
  back: 't240 w1 v8 l32 o5 g e c',
  powerup: 't240 w1 v9 l32 o4 c e g >c <d f a >d <e g b >e',
  explode: 't120 w5 v14 l16 o2 c <g e c',
  lose: 't140 w0 v9 l8 o4 g f+ f e2',
  win: 't180 w1 v9 l16 o5 c e g >c8 <g >c2',
  step: 't240 w5 v4 l64 o6 c',
};

// MML -> Ereignisliste [{ f: Hz|null, d: Sekunden, v: 0..1, w, q }]; ext = 8BOY-16-Befehle @ p h
// (ext = 2: 8BOY 32 mit Instrumenten bis @31)
export function parseMML(src, ext = false) {
  const maxIns = ext === 2 ? INSTRUMENTS.length - 1 : 15;
  const s = String(src).toLowerCase();
  let i = 0;
  const st = { t: 120, o: 4, l: 8, v: 10, w: 0, q: 7, i: -1, p: 8, h: 0 };
  const num = () => {
    const m = /^\d+/.exec(s.slice(i));
    if (!m) return null;
    i += m[0].length;
    return parseInt(m[0], 10);
  };
  const length = () => {
    let n = num();
    let beats = 4 / (n || st.l);
    let dot = beats / 2;
    while (s[i] === '.') { beats += dot; dot /= 2; i++; }
    return beats * 60 / st.t;
  };
  function block(depth) {
    const out = [];
    while (i < s.length) {
      const ch = s[i++];
      if (ch === ']') {
        if (depth === 0) continue;
        const n = num() ?? 2;
        const copy = [];
        for (let k = 0; k < n; k++) copy.push(...out);
        return copy;
      }
      if (ch === '[') { out.push(...block(depth + 1)); continue; }
      // 8BOY 16 / 8BOY 32: Akkord in einem Kanal, z.B. (c e g)4 – Oktavwechsel gelten nur innerhalb der Klammer
      if (ch === '(' && ext) {
        const fs = [], ns = [];
        let o = st.o;
        while (i < s.length && s[i] !== ')') {
          const c = s[i++];
          if (c === '>') o = Math.min(8, o + 1);
          else if (c === '<') o = Math.max(0, o - 1);
          else if (SEMI[c] !== undefined) {
            let semi = SEMI[c];
            while (s[i] === '+' || s[i] === '#' || s[i] === '-') semi += s[i++] === '-' ? -1 : 1;
            const midi = 12 * (o + 1) + semi;
            fs.push(440 * 2 ** ((midi - 69) / 12)); ns.push(((midi % 12) + 12) % 12);
          }
        }
        i++;
        const d = length();
        if (!fs.length) { out.push({ f: null, d }); continue; }
        out.push({ f: fs[0], fs, ns, d, v: st.v / 15, w: st.w, q: st.q / 8, i: st.i, p: st.p, h: st.h, n: ns[0] });
        continue;
      }
      if (SEMI[ch] !== undefined) {
        let semi = SEMI[ch];
        while (s[i] === '+' || s[i] === '#' || s[i] === '-') semi += s[i++] === '-' ? -1 : 1;
        const midi = 12 * (st.o + 1) + semi;
        const d = length();
        const e = { f: 440 * 2 ** ((midi - 69) / 12), d, v: st.v / 15, w: st.w, q: st.q / 8 };
        if (ext) { e.i = st.i; e.p = st.p; e.h = st.h; e.n = ((midi % 12) + 12) % 12; }
        out.push(e);
        continue;
      }
      switch (ch) {
        case 'r': out.push({ f: null, d: length() }); break;
        case 't': st.t = Math.max(20, Math.min(600, num() ?? 120)); break;
        case 'o': st.o = Math.max(0, Math.min(8, num() ?? 4)); break;
        case 'l': st.l = Math.max(1, Math.min(64, num() ?? 8)); break;
        case 'v': st.v = Math.max(0, Math.min(15, num() ?? 10)); break;
        case 'w': st.w = Math.max(0, Math.min(5, num() ?? 0)); st.i = -1; break;
        case 'q': st.q = Math.max(1, Math.min(8, num() ?? 7)); break;
        case '>': st.o = Math.min(8, st.o + 1); break;
        case '<': st.o = Math.max(0, st.o - 1); break;
        case '@': if (ext) st.i = Math.max(0, Math.min(maxIns, num() ?? 0)); break;
        case 'p': if (ext) st.p = Math.max(0, Math.min(16, num() ?? 8)); break;
        case 'h': if (ext) st.h = Math.max(0, Math.min(15, num() ?? 0)); break;
        default: break; // Leerzeichen, Taktstriche | usw. ignorieren
      }
    }
    return out;
  }
  return block(0);
}

// ------------------------------------------------------------------ Klangproben (8BOY 16)
// Alle Proben werden einmal beim ersten Gebrauch berechnet: 32 kHz, Grundton 250 Hz. Ganzzahlige Frequenzen
// passen in eine Sekunde genau hinein, so laufen Schleifen ohne Knacksen.
const SR = 32000, F0 = 250;
const TABLE = 2048;
function harmonicTable(amp) {
  const t = new Float32Array(TABLE);
  amp.forEach((a, k) => { if (a) for (let j = 0; j < TABLE; j++) t[j] += a * Math.sin(2 * Math.PI * (k + 1) * j / TABLE); });
  return t;
}
function tableVoices(table, freqs, seconds = 1, gains = null) {
  const n = Math.round(SR * seconds), out = new Float32Array(n);
  freqs.forEach((f, v) => {
    const g = gains ? gains[v] : 1 / freqs.length;
    let ph = v * 0.37 * TABLE;
    const step = f * TABLE / SR;
    for (let j = 0; j < n; j++) { const k = ph | 0, fr = ph - k; out[j] += g * (table[k % TABLE] * (1 - fr) + table[(k + 1) % TABLE] * fr); ph += step; if (ph >= TABLE) ph -= TABLE; }
  });
  return out;
}
const sawAmps = (n, roll = 0) => Array.from({ length: n }, (_, k) => 1 / (k + 1) * Math.exp(-roll * k));
function decaying(partials, seconds) {
  const n = Math.round(SR * seconds), out = new Float32Array(n);
  for (const [ratio, amp, decay] of partials) {
    const w = 2 * Math.PI * F0 * ratio / SR;
    if (F0 * ratio > SR / 2) continue;
    for (let j = 0; j < n; j++) out[j] += amp * Math.exp(-decay * j / SR) * Math.sin(w * j);
  }
  return out;
}
function fm(ratio, index, idxDecay, ampDecay, seconds, feedback = 0) {
  const n = Math.round(SR * seconds), out = new Float32Array(n);
  let prev = 0;
  for (let j = 0; j < n; j++) {
    const t = j / SR;
    const mod = index * Math.exp(-idxDecay * t) * Math.sin(2 * Math.PI * F0 * ratio * t + feedback * prev);
    prev = Math.sin(2 * Math.PI * F0 * t + mod);
    out[j] = prev * Math.exp(-ampDecay * t);
  }
  return out;
}
function noise(n, seed = 1) { const out = new Float32Array(n); let r = seed * 9301 + 49297; for (let j = 0; j < n; j++) { r = (r * 1103515245 + 12345) & 0x7fffffff; out[j] = r / 0x3fffffff - 1; } return out; }
function drum(kind) {
  const n = Math.round(SR * ({ kick: 0.5, snare: 0.35, rim: 0.08, clap: 0.3, tom: 0.5, hatc: 0.07, hato: 0.45, crash: 1.6 })[kind]);
  const out = new Float32Array(n), nz = noise(n, kind.length);
  let lp = 0, hp = 0, hpPrev = 0;
  for (let j = 0; j < n; j++) {
    const t = j / SR;
    let v = 0;
    if (kind === 'kick') v = Math.sin(2 * Math.PI * (45 * t + 110 * (1 - Math.exp(-t * 28)) / 28)) * Math.exp(-t * 7) + nz[j] * 0.15 * Math.exp(-t * 200);
    else if (kind === 'snare') v = Math.sin(2 * Math.PI * 185 * t) * 0.5 * Math.exp(-t * 20) + nz[j] * 0.8 * Math.exp(-t * 14);
    else if (kind === 'rim') v = (Math.sin(2 * Math.PI * 1700 * t) * 0.6 + nz[j] * 0.4) * Math.exp(-t * 70);
    else if (kind === 'clap') { const burst = t < 0.03 ? (Math.floor(t * 300) % 2 ? 1 : 0.3) : 1; v = nz[j] * burst * Math.exp(-(t < 0.03 ? 0 : t - 0.03) * 18); }
    else if (kind === 'tom') v = Math.sin(2 * Math.PI * (120 * t + 60 * (1 - Math.exp(-t * 12)) / 12)) * Math.exp(-t * 8);
    else { hp = 0.92 * (hp + nz[j] - hpPrev); hpPrev = nz[j]; v = hp * Math.exp(-t * (kind === 'hatc' ? 60 : kind === 'hato' ? 7 : 2.4)); }
    if (kind === 'snare' || kind === 'clap') { lp += (v - lp) * 0.5; v = lp; }
    out[j] = v;
  }
  return out;
}
function karplus(seconds) {
  const n = Math.round(SR * seconds), out = new Float32Array(n), P = SR / F0 | 0;
  const buf = noise(P, 7);
  for (let j = 0, k = 0; j < n; j++, k = (k + 1) % P) { const nx = (k + 1) % P; out[j] = buf[k]; buf[k] = 0.996 * 0.5 * (buf[k] + buf[nx]); }
  return out;
}
const formant = (k, f0, peaks) => peaks.reduce((a, [f, bw, g]) => a + g * Math.exp(-((((k + 1) * f0 - f) / bw) ** 2)), 0);

// [Proben, Schleife?, Anschlag, Abklingen auf, Ausklang, Lautstärke, Vibrato]
function buildBank() {
  const strings = harmonicTable(sawAmps(48, 0.05));
  const brass = harmonicTable(sawAmps(30, 0.12));
  const flute = harmonicTable([1, 0.22, 0.08, 0.03]);
  const organ = harmonicTable([1, 0.8, 0.5, 0.6, 0, 0.35, 0, 0.3]);
  const choir = harmonicTable(Array.from({ length: 40 }, (_, k) => formant(k, F0, [[700, 150, 1], [1150, 180, 0.6], [2600, 300, 0.25]]) + (k === 0 ? 0.3 : 0)));
  const pad = harmonicTable([1, 0.3, 0.12, 0.05]);
  const lead = (() => { const n = SR, out = new Float32Array(n); for (let j = 0; j < n; j++) { const duty = 0.3 + 0.18 * Math.sin(2 * Math.PI * j / SR); const ph = (j * F0 / SR) % 1; out[j] = (ph < duty ? 1 : -1) * 0.5; } return out; })();
  const piano = decaying(Array.from({ length: 18 }, (_, k) => [(k + 1) * (1 + 0.0004 * k * k), 1 / (k + 1) ** 1.3, 1.2 + k * 0.9]), 2.6);
  const bass = decaying(Array.from({ length: 10 }, (_, k) => [k + 1, 1 / (k + 1), 2 + k * 1.6]), 1.6);
  const marimba = decaying([[1, 1, 5], [3.93, 0.35, 16], [9.2, 0.1, 30]], 1.2);
  const pizz = decaying(Array.from({ length: 14 }, (_, k) => [k + 1, 1 / (k + 1), 9 + k * 2.5]), 0.8);
  return [
    [piano, false, 0.002, 1, 0.12, 1.3],
    [fm(1, 2.2, 3, 1.4, 2.2), false, 0.002, 1, 0.15, 1.1],
    [tableVoices(strings, [F0 - 1, F0, F0 + 1]), true, 0.14, 0.9, 0.3, 1.0, 9],
    [tableVoices(brass, [F0, F0 + 1]), true, 0.05, 0.8, 0.12, 1.0, 5],
    [tableVoices(flute, [F0]), true, 0.07, 0.9, 0.1, 1.2, 12],
    [tableVoices(organ, [F0]), true, 0.004, 1, 0.05, 0.8],
    [bass, false, 0.003, 1, 0.06, 1.5],
    [marimba, false, 0.001, 1, 0.2, 1.4],
    [tableVoices(choir, [F0 - 1, F0, F0 + 1]), true, 0.18, 0.9, 0.35, 1.3, 6],
    [fm(3.5, 3.5, 1.5, 0.9, 3.2), false, 0.001, 1, 0.8, 0.9],
    [karplus(1.8), false, 0.001, 1, 0.1, 1.2],
    [lead, true, 0.01, 0.85, 0.08, 0.8, 7],
    [null, false, 0.001, 1, 0.05, 1.3], // Schlagzeug: Ton wählt die Trommel
    [pizz, false, 0.002, 1, 0.08, 1.4],
    [tableVoices(pad, [F0 - 2, F0, F0 + 2]), true, 0.35, 0.9, 0.6, 1.1, 4],
    [fm(1, 4, 9, 2.5, 1.2, 0.6), false, 0.001, 1, 0.06, 1.2],
  ];
}

// ------------------------------------------------------------------ 8BOY 32: 16 weitere Instrumente in CD-Qualität
// 44,1 kHz, Grundton 244 Hz (auch die Quinte 366 Hz ist ganzzahlig – Powerchords laufen sauber in der Schleife).
const SRM = 44100, F0M = 244;
function tvM(table, freqs, seconds = 1, gains = null) {
  const n = Math.round(SRM * seconds), out = new Float32Array(n);
  freqs.forEach((f, v) => {
    const g = gains ? gains[v] : 1 / freqs.length;
    let ph = v * 0.37 * TABLE;
    const step = f * TABLE / SRM;
    for (let j = 0; j < n; j++) { const k = ph | 0, fr = ph - k; out[j] += g * (table[k % TABLE] * (1 - fr) + table[(k + 1) % TABLE] * fr); ph += step; if (ph >= TABLE) ph -= TABLE; }
  });
  return out;
}
function decM(partials, seconds, f0 = F0M) {
  const n = Math.round(SRM * seconds), out = new Float32Array(n);
  for (const [ratio, amp, decay] of partials) {
    if (f0 * ratio > SRM / 2) continue;
    const w = 2 * Math.PI * f0 * ratio / SRM;
    for (let j = 0; j < n; j++) out[j] += amp * Math.exp(-decay * j / SRM) * Math.sin(w * j);
  }
  return out;
}
const shape = (data, k) => { for (let j = 0; j < data.length; j++) data[j] = Math.tanh(data[j] * k); return data; };
// Tiefpass mit Resonanz (Zustandsvariablen-Filter); cutoff(t) in Hz
function svf(data, cutoff, reso = 0.5) {
  let low = 0, band = 0;
  const q = 1 - reso;
  for (let j = 0; j < data.length; j++) {
    const f = 2 * Math.sin(Math.PI * Math.min(0.45 * SRM, cutoff(j / SRM)) / SRM);
    low += f * band; const high = data[j] - low - q * band; band += f * high;
    data[j] = low;
  }
  return data;
}
function noiseM(n, seed) { return noise(n, seed); }
function kitM(style, kind) {
  const len = { kick: style === '808' ? 1.1 : 0.45, snare: 0.3, rim: 0.08, clap: 0.35, tom: 0.5, hatc: 0.06, hato: 0.5, crash: 1.8, extra: 0.5 }[kind];
  const n = Math.round(SRM * len), out = new Float32Array(n), nz = noiseM(n, kind.length + (style === '808' ? 11 : 23));
  let hp = 0, prev = 0;
  for (let j = 0; j < n; j++) {
    const t = j / SRM;
    let v = 0;
    if (kind === 'kick') {
      v = style === '808'
        ? Math.sin(2 * Math.PI * (48 * t + 90 * (1 - Math.exp(-t * 30)) / 30)) * Math.exp(-t * 2.6)
        : Math.tanh(2.2 * Math.sin(2 * Math.PI * (52 * t + 160 * (1 - Math.exp(-t * 40)) / 40)) * Math.exp(-t * 9)) + nz[j] * 0.25 * Math.exp(-t * 300);
    } else if (kind === 'snare') v = (style === '808' ? 0.6 : 0.4) * Math.sin(2 * Math.PI * 190 * t) * Math.exp(-t * 25) + nz[j] * 0.7 * Math.exp(-t * (style === '808' ? 18 : 24));
    else if (kind === 'clap') { const p = t < 0.035 ? (Math.floor(t * 280) % 2 ? 1 : 0.2) : 1; v = nz[j] * p * Math.exp(-Math.max(0, t - 0.035) * 14); }
    else if (kind === 'rim') v = Math.sin(2 * Math.PI * 1800 * t) * Math.exp(-t * 80);
    else if (kind === 'tom') v = Math.sin(2 * Math.PI * (100 * t + 70 * (1 - Math.exp(-t * 10)) / 10)) * Math.exp(-t * 6);
    else if (kind === 'extra') {
      // 808: Kuhglocke, Techno: Ride-Becken
      v = style === '808'
        ? (Math.sign(Math.sin(2 * Math.PI * 540 * t)) + Math.sign(Math.sin(2 * Math.PI * 800 * t))) * 0.3 * Math.exp(-t * 12)
        : 0;
      if (style !== '808') { hp = 0.95 * (hp + nz[j] - prev); prev = nz[j]; v = (hp * 0.6 + Math.sign(Math.sin(2 * Math.PI * 3200 * t)) * 0.15) * Math.exp(-t * 4); }
    } else {
      // Hi-Hats und Becken: metallisch aus Rechtecken plus Rauschen
      let metal = 0;
      for (const f of [205, 304, 369, 522, 540, 800]) metal += Math.sign(Math.sin(2 * Math.PI * f * 8 * t));
      hp = 0.9 * (hp + nz[j] * 0.6 + metal * 0.08 - prev); prev = nz[j] * 0.6 + metal * 0.08;
      v = hp * Math.exp(-t * (kind === 'hatc' ? 70 : kind === 'hato' ? 6 : 1.8));
    }
    out[j] = v;
  }
  return out;
}
function buildMegaBank() {
  const saw = harmonicTable(sawAmps(60, 0.02));
  const sax = harmonicTable(Array.from({ length: 24 }, (_, k) => (k % 2 === 0 ? 1 : 0.55) / (k + 1) ** 0.9 * formant(k, F0M, [[1000, 500, 1], [2600, 700, 0.4]]) + (k === 0 ? 0.4 : 0)));
  const tpt = harmonicTable(Array.from({ length: 30 }, (_, k) => 1 / (k + 1) ** 0.7 * formant(k, F0M, [[1300, 700, 1], [2900, 900, 0.5]])));
  const oo = harmonicTable(Array.from({ length: 30 }, (_, k) => formant(k, F0M, [[320, 90, 1], [800, 160, 0.35], [2400, 300, 0.1]]) + (k === 0 ? 0.5 : 0)));
  const panT = harmonicTable([1, 0.12, 0.04]);
  // 16 Rockgitarre: Powerchord (Grundton + Quinte), verzerrt
  const rock = shape(tvM(saw, [F0M, F0M * 1.5, F0M - 1, F0M * 2], 1, [0.5, 0.35, 0.3, 0.2]), 4);
  svf(rock, () => 3200, 0.2);
  // 17 Slap-Bass
  const slap = decM(Array.from({ length: 16 }, (_, k) => [k + 1, 1 / (k + 1) ** 0.8, 3 + k * 3]), 1.4);
  for (let j = 0; j < 900; j++) slap[j] += Math.sin(j * 0.9) * Math.exp(-j / 120) * 0.8;
  shape(slap, 1.6);
  // 20 Acid-Bass: Sägezahn durch den zwitschernden Resonanzfilter
  const acid = tvM(saw, [F0M], 0.6);
  svf(acid, (t) => 250 + 3200 * Math.exp(-t * 9), 0.88);
  shape(acid, 2.5);
  // 21 Trance-Lead: sieben verstimmte Sägezähne
  const supersaw = tvM(saw, [F0M - 3, F0M - 2, F0M - 1, F0M, F0M + 1, F0M + 2, F0M + 3]);
  // 22 warme Fläche
  const warm = tvM(saw, [F0M - 2, F0M, F0M + 2], 1);
  svf(warm, () => 900, 0.3);
  // 23 Vibraphon (Tremolo)
  const vib = decM([[1, 1, 1.4], [4, 0.25, 6], [10, 0.05, 14]], 2.5);
  for (let j = 0; j < vib.length; j++) vib[j] *= 0.75 + 0.25 * Math.sin(2 * Math.PI * 5.5 * j / SRM);
  // 24 Harfe (gezupfte Saite, hell)
  const harp = (() => { const n = Math.round(SRM * 2.2), out = new Float32Array(n), P = Math.round(SRM / F0M), b = noise(P, 31); for (let j = 0, k = 0; j < n; j++, k = (k + 1) % P) { out[j] = b[k]; b[k] = 0.998 * (0.6 * b[k] + 0.4 * b[(k + 1) % P]); } return out; })();
  // 25 Steel-Drum
  const steel = decM([[1, 1, 3], [2, 0.5, 4], [3.01, 0.25, 6], [4.2, 0.2, 8]], 1.6);
  // 26 Panflöte mit Atem
  const pan = tvM(panT, [F0M]);
  const breath = noise(pan.length, 41);
  for (let j = 0; j < pan.length; j++) pan[j] += breath[j] * 0.06;
  // 28 Pauke
  const timp = decM([[1, 1, 2.2], [1.5, 0.5, 3], [1.98, 0.3, 4], [2.44, 0.2, 6]], 2.2, F0M / 2);
  for (let j = 0; j < 2000; j++) timp[j] += noise(1, j)[0] * 0.3 * Math.exp(-j / 300);
  // 29 Orchesterschlag: Akkord aus Streichern und Bläsern, kurz und hart
  const hit = decM([[1, 1, 7], [1.26, 0.7, 7], [1.5, 0.8, 7], [2, 0.6, 8], [3, 0.3, 10], [4, 0.2, 12]], 0.9);
  shape(hit, 1.8);
  // [Proben, Schleife?, Anschlag, Abklingen auf, Ausklang, Lautstärke, Vibrato, Grundton, Schlagzeug-Stil]
  return [
    [rock, true, 0.004, 0.9, 0.1, 0.9, 0, F0M],
    [slap, false, 0.001, 1, 0.06, 1.3, 0, F0M],
    [tvM(sax, [F0M]), true, 0.05, 0.9, 0.12, 1.1, 10, F0M],
    [tvM(tpt, [F0M, F0M + 1]), true, 0.03, 0.85, 0.1, 1.9, 6, F0M],
    [acid, false, 0.001, 1, 0.04, 1.1, 0, F0M],
    [supersaw, true, 0.01, 0.9, 0.15, 2.2, 3, F0M],
    [warm, true, 0.4, 0.95, 0.8, 1.2, 0, F0M],
    [vib, false, 0.002, 1, 0.3, 1.2, 0, F0M],
    [harp, false, 0.001, 1, 0.4, 1.2, 0, F0M],
    [steel, false, 0.001, 1, 0.2, 1.2, 0, F0M],
    [pan, true, 0.08, 0.9, 0.12, 1.2, 8, F0M],
    [tvM(oo, [F0M - 1, F0M, F0M + 1]), true, 0.2, 0.9, 0.4, 2.0, 5, F0M],
    [timp, false, 0.001, 1, 0.3, 1.4, 0, F0M / 2],
    [hit, false, 0.001, 1, 0.1, 1.1, 0, F0M],
    [null, false, 0.001, 1, 0.05, 1.3, 0, F0M, '808'],
    [null, false, 0.001, 1, 0.05, 1.3, 0, F0M, 'techno'],
  ];
}
// Ton im Oktavraum -> Klang der Zusatz-Schlagzeuge (c+ ist dort Kuhglocke bzw. Ride)
const KIT_M = ['kick', 'extra', 'snare', 'rim', 'clap', 'tom', 'hatc', 'tom', 'hatc', 'tom', 'hato', 'crash'];

// Ton im Oktavraum -> Trommel (angelehnt an die General-MIDI-Belegung)
const KIT = ['kick', 'kick', 'snare', 'rim', 'clap', 'tom', 'hatc', 'tom', 'hatc', 'tom', 'hato', 'crash'];
const TOM_RATE = { 5: 0.8, 7: 1, 9: 1.25 };

export function createAudio() {
  let ctx = null, master = null, waves = null, noiseBuf = null;
  let volume = 0.6;
  const channels = Array.from({ length: 16 }, () => ({ events: [], idx: 0, next: 0, loop: false, bus: null }));
  let nch = 4, ext = false;
  let bank = null, kit = null, hall = null, megaKits = null;
  let timer = null;

  function ensure() {
    if (ctx) return ctx;
    const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = volume * 0.35;
    master.connect(ctx.destination);
    const pulse = (duty) => {
      const n = 64, re = new Float32Array(n), im = new Float32Array(n);
      // Fourier-Reihe eines Rechteckpulses mit Tastgrad "duty"
      for (let k = 1; k < n; k++) {
        re[k] = Math.sin(2 * Math.PI * k * duty) / (Math.PI * k);
        im[k] = (1 - Math.cos(2 * Math.PI * k * duty)) / (Math.PI * k);
      }
      return ctx.createPeriodicWave(re, im);
    };
    waves = [pulse(0.5), pulse(0.25), pulse(0.125)];
    // Rauschen über ein Schieberegister (LFSR), wie in alten Soundchips
    noiseBuf = ctx.createBuffer(1, 32768, 44100);
    const d = noiseBuf.getChannelData(0);
    let r = 0x7fff;
    for (let k = 0; k < d.length; k++) {
      const bit = (r ^ (r >> 1)) & 1;
      r = (r >> 1) | (bit << 14);
      d[k] = r & 1 ? 0.8 : -0.8;
    }
    channels.forEach((c) => { c.bus = ctx.createGain(); c.bus.connect(master); });
    timer = setInterval(pump, 25);
    return ctx;
  }

  // held: Konsole steht am Haltepunkt (Studio) – Ton anhalten, danach genau dort weiter
  let held = false;
  function resume() { const c = ensure(); if (c && c.state === 'suspended' && !held) c.resume(); }
  function hold(on) {
    held = !!on;
    if (!ctx) return;
    if (held && ctx.state === 'running') ctx.suspend();
    else if (!held && ctx.state === 'suspended') ctx.resume();
  }

  // 8BOY 16: Klangproben und Hall beim ersten Gebrauch anlegen
  function ensureBank() {
    if (bank) return;
    const toBuf = (data) => {
      let peak = 0; for (let j = 0; j < data.length; j++) peak = Math.max(peak, Math.abs(data[j]));
      const b = ctx.createBuffer(1, data.length, SR), ch = b.getChannelData(0), k = peak ? 0.9 / peak : 1;
      for (let j = 0; j < data.length; j++) ch[j] = data[j] * k;
      return b;
    };
    bank = buildBank().map(([data, loop, a, s, r, gain, vib]) => ({ buf: data && toBuf(data), loop, a, s, r, gain, vib: vib || 0, f0: F0 }));
    bankToBuf = toBuf;
    kit = Object.fromEntries(['kick', 'snare', 'rim', 'clap', 'tom', 'hatc', 'hato', 'crash'].map((k) => [k, toBuf(drum(k))]));
    // Hall: Faltung mit einem errechneten Raum (Rauschen, das in 1,8 s abklingt)
    const len = Math.round(ctx.sampleRate * 1.8), ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) { const d = ir.getChannelData(c), nz = noise(len, c + 3); for (let j = 0; j < len; j++) d[j] = nz[j] * Math.exp(-j / ctx.sampleRate * 3.2) * 0.5; }
    hall = ctx.createConvolver(); hall.buffer = ir;
    const ret = ctx.createGain(); ret.gain.value = 0.55;
    hall.connect(ret); ret.connect(master);
  }

  // 8BOY 32: Zusatzinstrumente @16–31 beim ersten Gebrauch anhängen
  let bankToBuf = null;
  function ensureMegaBank() {
    ensureBank();
    if (bank.length > 16) return;
    const toBufM = (data) => {
      let peak = 0; for (let j = 0; j < data.length; j++) peak = Math.max(peak, Math.abs(data[j]));
      const b = ctx.createBuffer(1, data.length, SRM), ch = b.getChannelData(0), k = peak ? 0.9 / peak : 1;
      for (let j = 0; j < data.length; j++) ch[j] = data[j] * k;
      return b;
    };
    for (const [data, loop, a, s, r, gain, vib, f0, kitStyle] of buildMegaBank()) {
      bank.push({ buf: data && toBufM(data), loop, a, s, r, gain, vib: vib || 0, f0, kitStyle });
    }
    megaKits = {};
    for (const style of ['808', 'techno']) {
      megaKits[style] = Object.fromEntries(['kick', 'snare', 'rim', 'clap', 'tom', 'hatc', 'hato', 'crash', 'extra'].map((k) => [k, toBufM(kitM(style, k))]));
    }
  }

  function voice(ch, f, t, dur, vol, wave, e) {
    if (e && e.i >= 0) return sampleVoice(ch, f, t, dur, vol, e);
    if (wave === 3) vol *= 1.6;      // Dreieck klingt leiser
    else if (wave === 4) vol *= 0.7; // Sägezahn klingt lauter
    const g = ctx.createGain();
    const release = Math.min(0.03, dur * 0.3);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.004);
    g.gain.setValueAtTime(vol, t + Math.max(0.005, dur - release));
    g.gain.linearRampToValueAtTime(0, t + dur);
    if (e) route(g, ch, t, e); else g.connect(channels[ch].bus);
    let src;
    if (wave === 5) {
      src = ctx.createBufferSource();
      src.buffer = noiseBuf; src.loop = true;
      src.playbackRate.value = Math.max(0.05, Math.min(16, f / 440));
    } else {
      src = ctx.createOscillator();
      if (wave <= 2) src.setPeriodicWave(waves[wave]);
      else src.type = wave === 3 ? 'triangle' : 'sawtooth';
      src.frequency.setValueAtTime(f, t);
    }
    src.connect(g);
    src.start(t);
    src.stop(t + dur + 0.01);
  }

  // 8BOY 16: Stereo-Position und Hall-Anteil je Note
  function route(g, ch, t, e) {
    let out = g;
    if (ctx.createStereoPanner && e.p !== 8) { const pn = ctx.createStereoPanner(); pn.pan.setValueAtTime((e.p - 8) / 8, t); g.connect(pn); out = pn; }
    out.connect(channels[ch].bus);
    if (e.h > 0) { ensureBank(); const sg = ctx.createGain(); sg.gain.value = e.h / 15; out.connect(sg); sg.connect(hall); }
  }

  function sampleVoice(ch, f, t, dur, vol, e) {
    if (e.i >= 16) ensureMegaBank(); else ensureBank();
    const ins = bank[e.i];
    if (!ins) return;
    const src = ctx.createBufferSource();
    let rel = ins.r;
    if (ins.buf) {
      src.buffer = ins.buf;
      src.playbackRate.setValueAtTime(Math.max(0.01, f / (ins.f0 || F0)), t);
      if (ins.loop) { src.loop = true; src.loopStart = 0; src.loopEnd = ins.buf.duration; }
    } else if (ins.kitStyle) {
      const name = KIT_M[e.n];
      src.buffer = megaKits[ins.kitStyle][name];
      src.playbackRate.setValueAtTime(name === 'tom' ? TOM_RATE[e.n] : 1, t);
      dur = Math.max(dur, src.buffer.duration); rel = 0.02;
    } else {
      const name = KIT[e.n];
      src.buffer = kit[name];
      src.playbackRate.setValueAtTime(name === 'tom' ? TOM_RATE[e.n] : 1, t);
      dur = Math.max(dur, src.buffer.duration); rel = 0.02;
    }
    if (ins.vib && src.detune) {
      const lfo = ctx.createOscillator(), depth = ctx.createGain();
      lfo.frequency.value = 5.5; depth.gain.setValueAtTime(0, t); depth.gain.linearRampToValueAtTime(ins.vib, t + 0.35);
      lfo.connect(depth); depth.connect(src.detune); lfo.start(t); lfo.stop(t + dur + rel + 0.05);
    }
    const g = ctx.createGain(), peak = vol * ins.gain;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + ins.a);
    if (ins.s < 1) g.gain.linearRampToValueAtTime(peak * ins.s, t + ins.a + 0.15);
    g.gain.setValueAtTime(peak * ins.s, t + Math.max(ins.a + 0.01, dur));
    g.gain.linearRampToValueAtTime(0, t + Math.max(ins.a + 0.01, dur) + rel);
    src.connect(g);
    route(g, ch, t, e);
    src.start(t);
    src.stop(t + Math.max(ins.a + 0.01, dur) + rel + 0.02);
  }

  function pump() {
    if (!ctx) return;
    const horizon = ctx.currentTime + 0.12;
    channels.forEach((c, ch) => {
      while (c.events.length && c.next < horizon) {
        if (c.idx >= c.events.length) {
          if (!c.loop) { c.events = []; break; }
          // vorgemerktes Muster nahtlos am Schleifenende übernehmen
          if (c.pending) { c.events = c.pending; c.pending = null; }
          c.idx = 0;
        }
        const e = c.events[c.idx++];
        if (e.fs && e.v > 0) {
          // Akkord: alle Töne gleichzeitig, etwas leiser, damit es nicht übersteuert
          const k = 1 / Math.sqrt(e.fs.length);
          e.fs.forEach((f, j) => voice(ch, f, c.next, e.d * e.q, e.v * k, e.w, { ...e, n: e.ns[j] }));
        } else if (e.f && e.v > 0) voice(ch, e.f, c.next, e.d * e.q, e.v, e.w, e.i === undefined ? null : e);
        c.next += e.d;
      }
    });
  }

  // Dauerton (Motor, Wind, Sirene): läuft, bis er mit Lautstärke 0 oder stop() endet
  const tones = new Map();
  let groupStart = null;
  function tone(ch, freq, vol = 0.5, wave = 4) {
    if (!ensure()) return;
    ch &= nch - 1;
    let tn = tones.get(ch);
    if (!(freq > 0) || !(vol > 0)) { if (tn) { tn.g.gain.setTargetAtTime(0, ctx.currentTime, 0.02); tn.src.stop(ctx.currentTime + 0.1); tones.delete(ch); } return; }
    wave = Math.max(0, Math.min(5, wave | 0));
    if (tn && tn.wave !== wave) { tn.src.stop(); tones.delete(ch); tn = null; }
    const now = ctx.currentTime;
    if (!tn) {
      const g = ctx.createGain(); g.gain.value = 0;
      let src;
      if (wave === 5) { src = ctx.createBufferSource(); src.buffer = noiseBuf; src.loop = true; }
      else { src = ctx.createOscillator(); if (wave <= 2) src.setPeriodicWave(waves[wave]); else src.type = wave === 3 ? 'triangle' : 'sawtooth'; src.frequency.value = freq; }
      src.connect(g); g.connect(channels[ch].bus); src.start(now);
      tn = { src, g, wave };
      tones.set(ch, tn);
    }
    if (wave === 5) tn.src.playbackRate.setTargetAtTime(Math.max(0.05, Math.min(16, freq / 440)), now, 0.03);
    else tn.src.frequency.setTargetAtTime(freq, now, 0.03);
    tn.g.gain.setTargetAtTime(Math.max(0, Math.min(1, vol)) * (wave === 4 ? 0.7 : wave === 3 ? 1.6 : 1), now, 0.03);
  }

  function stop(ch) {
    if (!ctx) return;
    const list = ch === undefined || ch === null ? channels.map((_, k) => k) : [ch & (nch - 1)];
    list.forEach((k) => {
      const tn = tones.get(k);
      if (tn) { try { tn.src.stop(); } catch { /* schon aus */ } tones.delete(k); }
      const c = channels[k];
      c.events = []; c.idx = 0; c.pending = null; c.loop = false;
      // weich ausblenden statt hart abschneiden (kein Knacksen)
      const old = c.bus;
      old.gain.setTargetAtTime(0, ctx.currentTime, 0.008);
      setTimeout(() => old.disconnect(), 60);
      c.bus = ctx.createGain(); c.bus.connect(master);
    });
  }

  // queue = true: läuft auf dem Kanal schon eine Schleife gleicher Länge, wird das neue Muster
  // erst am Schleifenende übernommen (für Sequenzer ohne Stolpern)
  function play(mml, ch = 0, loop = false, queue = false) {
    if (!ensure()) return;
    ch &= nch - 1;
    const events = parseMML(mml, ext);
    const len = events.reduce((a, e) => a + e.d, 0);
    const c = channels[ch];
    if (queue && loop && c.loop && c.events.length && Math.abs(len - c.len) < 1e-6) { c.pending = events; return; }
    stop(ch);
    c.events = events; c.idx = 0; c.loop = loop && events.length > 0; c.pending = null;
    // Alles, was im selben Bild gestartet wird, beginnt gemeinsam (auch wenn dazwischen Klangproben berechnet wurden)
    if (groupStart === null) { groupStart = ctx.currentTime + 0.03; setTimeout(() => { groupStart = null; }, 0); }
    c.next = groupStart;
    c.t0 = c.next; c.len = len;
    if (c.loop && len < 0.05) c.loop = false; // Schutz vor Endlos-Mini-Schleifen
    pump();
  }

  // Sekunden seit Beginn des aktuellen Durchlaufs (-1 = Kanal still)
  function playpos(ch = 0) {
    const c = channels[ch & (nch - 1)];
    if (!ctx || !c.events.length || !c.len) return -1;
    const p = ctx.currentTime - c.t0;
    if (p < 0) return 0;
    return c.loop ? p % c.len : Math.min(p, c.len);
  }

  function sfx(name, ch = 3) {
    const mml = SFX[name] ?? name;
    play(mml, ch, false);
  }

  function beep(freq = 440, dur = 0.1, wave = 0, vol = 0.6, ch = 3) {
    if (!ensure()) return;
    stop(ch & (nch - 1));
    voice(ch & (nch - 1), freq, ctx.currentTime + 0.01, Math.max(0.01, dur), Math.max(0, Math.min(1, vol)), wave | 0);
  }

  const playing = (ch) => channels[ch & (nch - 1)].events.length > 0;

  function setVolume(v) { volume = v; if (master) master.gain.value = v * 0.35; }

  // Kanäle und Befehle der Konsole, für die die laufende Kartridge gebaut ist
  function setMachine(m) {
    stop(); nch = m.channels || 4; ext = m.id >= 32 ? 2 : m.id >= 16 ? 1 : false;
    if (ext && ctx) setTimeout(ext === 2 ? ensureMegaBank : ensureBank, 0); // Proben schon beim Laden rechnen, nicht bei der ersten Note
  }

  function shutdown() { stop(); }

  // Mitschnitt für Videos: der Mix aller Kanäle als MediaStream
  function tap() { const c = ensure(); if (!c) return null; const d = c.createMediaStreamDestination(); master.connect(d); return d.stream; }

  return { resume, hold, play, stop, sfx, beep, tone, playing, playpos, setVolume, setMachine, tap, get volume() { return volume; }, shutdown };
}
