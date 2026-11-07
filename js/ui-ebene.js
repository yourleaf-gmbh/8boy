// UI-Ebene (ab 8BOY 64): scharfe Schrift und Kästen in voller Bildschirmschärfe über dem Spielbild.
// Die Kartridge zeichnet in ihren Koordinaten (8BOY 64: 640×360, Kommazahlen erlaubt), die Konsole rechnet Text und Kästen
// aber nicht in die Pixel des Bildes, sondern legt sie in Gerätepixeln darüber: Schrift stufenlos (ui_text(s,x,y,c,9)),
// Kästen mit runden Ecken. Reihenfolge = Aufrufreihenfolge, alles liegt über dem Spielbild; camera() gilt hier nicht.
// Zeichen, die die Schrift nicht hat (Pfeile, ★, ♥, ✓ …), kommen aus der Pixelschrift der Konsole.
// Die Breiten stehen in js/ui-schrift.js fest, damit ui_textw/ui_wrap überall gleich rechnen (auch ohne Browser).
import { UI_UPEM, UI_NORMAL, UI_FETT } from './ui-schrift.js';
import { GLYPHS, FALLBACK } from './font.js';

export const UI_SCHRIFT = 'UiSchrift8boy';
export const UI_GRUND = 0.8;       // Grundlinie: y + 0,8 × Größe (Großbuchstaben beginnen etwa bei y + 0,12 × Größe)
export const UI_ZEILE = 1.25;      // Zeilenabstand bei \n (× Größe)
const PIX_W = 0.62;                // Vorschub eines Zeichens aus der Pixelschrift (× Größe)
const PIX_U = 0.095;               // Kantenlänge eines Pixelschrift-Pixels (× Größe): 7 Zeilen ≈ Versalhöhe
const MAX_BEFEHLE = 6000;

function tabelle(s) {
  const m = new Map();
  for (const p of s.split(',')) { const i = p.indexOf(':'); m.set(parseInt(p.slice(0, i), 36), +p.slice(i + 1) / UI_UPEM); }
  return m;
}
const BREITE = [tabelle(UI_NORMAL), tabelle(UI_FETT)];
const fettAus = (flags) => !!flags && flags.includes('f');

// Breite eines Textes in Kartridge-Pixeln (bei \n die breiteste Zeile)
export function uiTextW(s, gr, flags = '') {
  const t = BREITE[fettAus(flags) ? 1 : 0];
  let w = 0, best = 0;
  for (const ch of String(s)) {
    if (ch === '\n') { if (w > best) best = w; w = 0; continue; }
    const a = t.get(ch.codePointAt(0));
    w += a !== undefined ? a : PIX_W;
  }
  return Math.max(best, w) * gr;
}

// Zeilenumbruch an Leerzeichen und \n; ein Wort, das allein zu breit ist, wird hart getrennt
export function uiWrap(s, breite, gr, flags = '') {
  const zeilen = [];
  for (const absatz of String(s).split('\n')) {
    let z = '';
    for (const wort of absatz.split(/ +/)) {
      if (!wort) continue;
      const probe = z ? z + ' ' + wort : wort;
      if (uiTextW(probe, gr, flags) <= breite || !z) {
        if (!z && uiTextW(wort, gr, flags) > breite) {
          // zu langes Einzelwort: Zeichen für Zeichen auffüllen
          let teil = '';
          for (const ch of wort) {
            if (teil && uiTextW(teil + ch, gr, flags) > breite) { zeilen.push(teil); teil = ''; }
            teil += ch;
          }
          z = teil;
        } else z = probe;
      } else { zeilen.push(z); z = wort; }
    }
    zeilen.push(z);
  }
  return zeilen;
}

// Befehlsliste eines Bildes: die Kartridge füllt sie in _draw, gezeigt wird die des letzten fertigen Bildes
export function createUiEbene() {
  let liste = [], gezeigt = [], benutzt = false;
  return {
    beginFrame() { liste = []; },
    endFrame() { gezeigt = liste; if (liste.length) benutzt = true; },
    add(cmd) { if (liste.length < MAX_BEFEHLE) liste.push(cmd); },
    get liste() { return gezeigt; },
    get benutzt() { return benutzt; },
    reset() { liste = []; gezeigt = []; benutzt = false; },
  };
}

// ------------------------------------------------------------------ Zeichnen (Browser, Canvas 2D)
// o: { k: Gerätepixel je Kartridge-Pixel, ox, oy: Lage des Kartridge-Bildes in Gerätepixeln, farbe(c) → CSS-Farbe,
//      sprite(n) → { w, h, data } | null, pixelFarbe(c) → CSS-Farbe für Sprite-Pixel, palSig: ändert sich mit der Palette,
//      hell: 0–1 (Abblenden wie beim Spielbild) }
const spriteCache = new WeakMap();
function spriteBild(sp, o, off) {
  let m = spriteCache.get(sp);
  if (!m) spriteCache.set(sp, (m = new Map()));
  const e = m.get(off);
  if (e && e.sig === o.palSig) return e.c;
  const c = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(sp.w, sp.h) : Object.assign(document.createElement('canvas'), { width: sp.w, height: sp.h });
  const g = c.getContext('2d');
  for (let y = 0; y < sp.h; y++) for (let x = 0; x < sp.w; x++) {
    const v = sp.data[y * sp.w + x];
    if (v === 255) continue;   // durchsichtig
    g.fillStyle = o.pixelFarbe(v + off); g.fillRect(x, y, 1, 1);
  }
  m.set(off, { sig: o.palSig, c });
  return c;
}

function pixelZeichen(ctx, ch, x, grund, u) {
  const g = GLYPHS.get(ch) || FALLBACK;
  const top = grund - 7 * u;
  for (let r = 0; r < 8; r++) {
    const bits = g[r];
    if (!bits) continue;
    for (let b = 0; b < 5; b++) if (bits & (16 >> b)) ctx.fillRect(x + b * u, top + r * u, u + 0.02, u + 0.02);
  }
}

// eine Textzeile in Läufen: Zeichen der Schrift am Stück, fehlende aus der Pixelschrift
function zeile(ctx, s, x, grund, gr, fett, k, modus) {
  const t = BREITE[fett ? 1 : 0];
  let lauf = '', lx = x, cx = x;
  const raus = () => {
    if (!lauf) return;
    if (modus === 'kontur') ctx.strokeText(lauf, lx, grund); else ctx.fillText(lauf, lx, grund);
    lauf = '';
  };
  for (const ch of s) {
    const a = t.get(ch.codePointAt(0));
    if (a !== undefined) { if (!lauf) lx = cx; lauf += ch; cx += a * gr * k; continue; }
    raus();
    const u = PIX_U * gr * k;
    if (modus === 'kontur') {
      const d = Math.max(1, gr * k * 0.08);
      for (const [dx, dy] of [[-d, 0], [d, 0], [0, -d], [0, d]]) pixelZeichen(ctx, ch, cx + dx, grund + dy, u);
    } else pixelZeichen(ctx, ch, cx, grund, u);
    cx += PIX_W * gr * k;
  }
  raus();
}

function text(ctx, o, c) {
  const [, s, x, y, farbe, gr, flags, kontur] = c;
  const k = o.k, fett = fettAus(flags);
  ctx.font = `${fett ? 700 : 400} ${gr * k}px ${UI_SCHRIFT}, system-ui, sans-serif`;
  const zeilen = String(s).split('\n');
  zeilen.forEach((z, i) => {
    let X = x;
    if (flags) {
      if (flags.includes('m')) X -= uiTextW(z, gr, flags) / 2;
      else if (flags.includes('r')) X -= uiTextW(z, gr, flags);
    }
    const px = o.ox + X * k, grund = o.oy + (y + i * UI_ZEILE * gr + UI_GRUND * gr) * k;
    if (flags && flags.includes('s')) {
      ctx.fillStyle = 'rgba(0,0,0,.35)';
      zeile(ctx, z, px + gr * k * 0.07, grund + gr * k * 0.07, gr, fett, k, 'fuellen');
    }
    if (kontur !== undefined && kontur !== null) {
      ctx.strokeStyle = ctx.fillStyle = o.farbe(kontur);
      ctx.lineWidth = Math.max(1.5, gr * k * 0.2);
      zeile(ctx, z, px, grund, gr, fett, k, 'kontur');
    }
    ctx.fillStyle = o.farbe(farbe);
    zeile(ctx, z, px, grund, gr, fett, k, 'fuellen');
  });
}

function rundRect(ctx, x, y, w, h, r) {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(x, y, w, h, r);
  else {
    ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }
}

export function uiZeichnen(ctx, cmds, o) {
  const k = o.k, X = (v) => o.ox + v * k, Y = (v) => o.oy + v * k;
  let clips = 0, alpha = 1;
  ctx.save();
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  if ('fontKerning' in ctx) ctx.fontKerning = 'none';
  ctx.lineJoin = 'round';
  for (const c of cmds) {
    switch (c[0]) {
      case 't': text(ctx, o, c); break;
      case 'r': {   // gefüllter Kasten: x, y, w, h, farbe, radius, deckkraft
        const a = Math.max(0, Math.min(1, c[7] ?? 1));
        if (!a) break;
        ctx.globalAlpha = alpha * a;
        ctx.fillStyle = o.farbe(c[5]);
        rundRect(ctx, X(c[1]), Y(c[2]), c[3] * k, c[4] * k, (c[6] || 0) * k); ctx.fill();
        ctx.globalAlpha = alpha;
        break;
      }
      case 'o': {   // Rahmen: x, y, w, h, farbe, radius, dicke (die Linie liegt innen)
        const d = (c[7] || 1) * k;
        ctx.strokeStyle = o.farbe(c[5]); ctx.lineWidth = d;
        rundRect(ctx, X(c[1]) + d / 2, Y(c[2]) + d / 2, c[3] * k - d, c[4] * k - d, Math.max(0, (c[6] || 0) * k - d / 2)); ctx.stroke();
        break;
      }
      case 'l':     // Linie: x1, y1, x2, y2, farbe, dicke
        ctx.strokeStyle = o.farbe(c[5]); ctx.lineWidth = (c[6] || 1) * k; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(X(c[1]), Y(c[2])); ctx.lineTo(X(c[3]), Y(c[4])); ctx.stroke();
        break;
      case 'k':     // Kreis: x, y, r, farbe, dicke (ohne Dicke gefüllt)
        ctx.beginPath(); ctx.arc(X(c[1]), Y(c[2]), Math.max(0, c[3] * k), 0, Math.PI * 2);
        if (c[5]) { ctx.strokeStyle = o.farbe(c[4]); ctx.lineWidth = c[5] * k; ctx.stroke(); } else { ctx.fillStyle = o.farbe(c[4]); ctx.fill(); }
        break;
      case 's': {   // Sprite: nummer, x, y, groesse, spiegelX, farbbank (scharfe Pixel)
        const sp = o.sprite(c[1]);
        if (!sp) break;
        const bild = spriteBild(sp, o, ((c[6] | 0) & 7) * 32), sk = (c[4] || 1) * k;
        ctx.imageSmoothingEnabled = false;
        if (c[5]) { ctx.save(); ctx.translate(X(c[2]) + sp.w * sk, Y(c[3])); ctx.scale(-1, 1); ctx.drawImage(bild, 0, 0, sp.w * sk, sp.h * sk); ctx.restore(); }
        else ctx.drawImage(bild, X(c[2]), Y(c[3]), sp.w * sk, sp.h * sk);
        break;
      }
      case 'c':     // Zuschnitt: x, y, w, h – ohne Werte aufheben
        if (clips) { ctx.restore(); clips--; }
        if (c.length > 1) { ctx.save(); clips++; ctx.beginPath(); ctx.rect(X(c[1]), Y(c[2]), c[3] * k, c[4] * k); ctx.clip(); }
        ctx.globalAlpha = alpha;
        break;
      case 'a': ctx.globalAlpha = alpha = Math.max(0, Math.min(1, c[1])); break;
    }
  }
  while (clips--) ctx.restore();
  ctx.restore();
  // Abblenden (fade) wie beim Spielbild
  if (o.hell < 1) {
    ctx.save();
    ctx.globalCompositeOperation = 'source-atop';
    ctx.fillStyle = `rgba(0,0,0,${1 - o.hell})`;
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    ctx.restore();
  }
}
