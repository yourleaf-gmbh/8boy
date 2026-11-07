// Handy als Controller: index.html#pad=<code> zeigt statt der Konsole ein Gamepad im Vollbild.
// Die Tasten gehen als Bitmaske über die Lobby an den Fernseher (js/padnet.js). Mehrere Finger gleichzeitig,
// dezentes Vibrieren beim Drücken. Welche Tasten es gibt (X/Y/L/R), sagt der Fernseher je nach Konsole.
// Hochkant sieht das Handy aus wie eine 8BOY 64 (Bildschirm oben, Steuerkreuz und Tasten darunter),
// quer wie ein Gamepad mit kleinem Bildschirm in der Mitte. Der Bildschirm zeigt Spielernummer und Status –
// oder, was die Kartridge mit padinfo() schickt (Text, Farbe, Symbol). rumble() kommt als Rüttel-Muster (vib).
import { createPadClient } from './padnet.js';
import { PAD_SYMBOLE } from './input.js';

const COLORS = ['#888', '#e84a5f', '#3c9cf0', '#4cc479', '#f2c230'];
const TIPP_MS = 8;   // Tastendruck: nur ein Hauch

// Schriftfarbe passend zum Hintergrund (hell auf dunkel, dunkel auf hell)
const hex = (n) => '#' + (n & 0xffffff).toString(16).padStart(6, '0');
const hell = (n) => (((n >> 16) & 255) * 299 + ((n >> 8) & 255) * 587 + (n & 255) * 114) / 1000 > 150;

export function startPad(code, { WS } = {}) {
  document.body.classList.add('pad-mode');
  const root = document.createElement('div');
  root.className = 'pad';
  root.innerHTML = `
    <div class="pad-sh l" data-b="10"><span>L</span></div>
    <div class="pad-sh r" data-b="11"><span>R</span></div>
    <div class="pad-screen">
      <div class="pad-bezel">
        <div class="pad-bezel-top"><i class="pad-led"></i><span class="pad-label">CONTROLLER</span></div>
        <div class="pad-glass">
          <div class="pad-idle"><b class="pad-num">?</b><div><b class="pad-p">8BOY</b><span class="pad-msg">Verbinde …</span></div></div>
          <div class="pad-info" hidden><span class="pad-sym"></span><span class="pad-txt"></span></div>
        </div>
      </div>
      <div class="pad-brand"><svg viewBox="0 0 60 18" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="5" r="3.3"/><circle cx="6" cy="12.2" r="4"/><path d="M15.5 1.7V16.2M15.5 1.7h3.6a3.3 3.3 0 0 1 0 6.6H15.5M15.5 8.3h4.2a3.95 3.95 0 0 1 0 7.9H15.5"/><ellipse cx="35.5" cy="9" rx="6.4" ry="7.3"/><path d="M47.6 1.7L52.8 9L58 1.7M52.8 9V16.2"/></g></svg><b class="pad-gen"></b> <i>controller</i></div>
    </div>
    <div class="pad-dpad" data-dpad><i class="dh"></i><i class="dv"></i><b class="u">▲</b><b class="d">▼</b><b class="l">◀</b><b class="r">▶</b></div>
    <div class="pad-mid">
      <div class="pad-sys" data-b="7"><i><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2.5 5h11M2.5 11h11" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><circle cx="5.5" cy="5" r="2.3" fill="currentColor"/><circle cx="10.5" cy="11" r="2.3" fill="currentColor"/></svg></i><span>OPTION</span></div>
      <div class="pad-sys" data-b="6"><i><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 4.5h10M3 8h10M3 11.5h10" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg></i><span>MENÜ</span></div>
    </div>
    <div class="pad-face">
      <div class="pad-btn x" data-b="8"><span>X</span></div>
      <div class="pad-btn y" data-b="9"><span>Y</span></div>
      <div class="pad-btn a" data-b="4"><span>A</span></div>
      <div class="pad-btn b" data-b="5"><span>B</span></div>
    </div>
    <div class="pad-again" hidden><p></p><button class="tb tb-run">Neu verbinden</button></div>`;
  document.body.appendChild(root);
  const q = (s) => root.querySelector(s);

  let client = null, sys = 8, player = -1, status = 'Verbinde …', rumbleUntil = 0, shown = '';
  const setLayout = () => root.classList.toggle('full', sys >= 16);
  setLayout();
  function label() {
    q('.pad-label').textContent = (player > 0 ? 'SPIELER ' + player + ' · ' : '') + status.toUpperCase();
    q('.pad-msg').textContent = status;
  }
  // padinfo der Kartridge: groß auf den Bildschirm (ohne Text und Symbol: wieder Spielernummer)
  function show(d) {
    const sym = PAD_SYMBOLE[d.sym] || '', txt = typeof d.txt === 'string' ? d.txt : '';
    const bg = typeof d.bg === 'number' ? d.bg : null;
    const key = JSON.stringify([txt, sym, bg]);
    if (key === shown) return;
    shown = key;
    const box = q('.pad-info');
    box.hidden = !txt && !sym;
    q('.pad-idle').hidden = !box.hidden;
    if (box.hidden) return;
    q('.pad-sym').textContent = sym;
    q('.pad-sym').hidden = !sym;
    q('.pad-txt').textContent = txt;
    q('.pad-txt').hidden = !txt;
    box.classList.toggle('lang', [...txt].length > 18);
    box.style.background = bg === null ? '' : hex(bg);
    box.style.color = bg === null ? '' : hell(bg) ? '#14152a' : '#fff';
    box.classList.remove('neu'); void box.offsetWidth; box.classList.add('neu');   // kurz aufploppen
  }
  // Rüttler vom Fernseher: deutlich spürbar; solange er läuft, stören die Tasten-Tipper nicht
  function rumble(v) {
    if (!Array.isArray(v) || !v.length) return;
    const pat = v.slice(0, 12).map((x) => Math.max(0, Math.min(1500, +x || 0)));
    rumbleUntil = performance.now() + pat.reduce((a, b) => a + b, 0);
    try { navigator.vibrate?.(pat); } catch { /* kein Vibrieren (iPhone) */ }
  }

  function connect() {
    q('.pad-again').hidden = true;
    status = 'Verbinde …'; label();
    root.classList.remove('live');
    client = createPadClient(code, {
      WS,
      onStatus: (s, err) => {
        if (s === 'verbunden') { status = 'Verbunden'; root.classList.add('live'); label(); }
        if (s === 'fehler' || s === 'getrennt') {
          status = 'Getrennt'; root.classList.remove('live'); label();
          q('.pad-again p').textContent = err || 'Die Verbindung ist weg.';
          q('.pad-again').hidden = false;
        }
      },
      onInfo: (d) => {
        const p = d.p | 0, s = +d.sys || 8, neu = p !== player || s !== sys;
        sys = s;
        setLayout();
        if (p !== player) {
          player = p;
          q('.pad-p').textContent = p ? 'Spieler ' + p : '8BOY';
          q('.pad-num').textContent = p || '?';
          root.style.setProperty('--pc', COLORS[p] || COLORS[0]);
        }
        if (typeof d.name === 'string') status = d.name;
        // Wortmarke bleibt, die Generation (16, 32 …) steht als Schild dahinter
        q('.pad-gen').textContent = sys > 8 ? sys : '';
        label();
        show(d);
        if (d.vib) rumble(d.vib);
        else if (neu) { try { navigator.vibrate?.([20, 40, 20]); } catch { /* egal */ } }
      },
    });
  }
  connect();
  q('.pad-again button').addEventListener('click', connect);

  // ---------------------------------------------------------------- Berührungen → Tasten
  const pointers = new Map();
  let mask = 0;
  function update() {
    let m = 0;
    for (const { x, y } of pointers.values()) {
      for (const el of root.querySelectorAll('[data-b], [data-dpad]')) {
        if (!el.getClientRects().length) continue;   // ausgeblendete Tasten (8BOY: kein X/Y/L/R)
        const r = el.getBoundingClientRect(), pad = el.dataset.dpad !== undefined ? r.width * 0.2 : 10;
        if (x < r.left - pad || x > r.right + pad || y < r.top - pad || y > r.bottom + pad) continue;
        if (el.dataset.dpad !== undefined) {
          const dx = x - (r.left + r.width / 2), dy = y - (r.top + r.height / 2), dz = r.width * 0.12;
          if (dx < -dz && Math.abs(dx) > Math.abs(dy) * 0.45) m |= 1 << 0;
          if (dx > dz && Math.abs(dx) > Math.abs(dy) * 0.45) m |= 1 << 1;
          if (dy < -dz && Math.abs(dy) > Math.abs(dx) * 0.45) m |= 1 << 2;
          if (dy > dz && Math.abs(dy) > Math.abs(dx) * 0.45) m |= 1 << 3;
        } else m |= 1 << +el.dataset.b;
      }
    }
    // neue Taste: ein Hauch Vibration – nicht, solange ein Rüttler der Kartridge läuft (vibrate() würde ihn abbrechen)
    if (m & ~mask && performance.now() > rumbleUntil) { try { navigator.vibrate?.(TIPP_MS); } catch { /* egal */ } }
    mask = m;
    client?.send(m);
    for (const el of root.querySelectorAll('[data-b]')) el.classList.toggle('on', !!(m & (1 << +el.dataset.b)));
    const dp = q('[data-dpad]');
    ['l', 'r', 'u', 'd'].forEach((c, i) => dp.classList.toggle('p-' + c, !!(m & (1 << i))));
  }
  let first = true;
  root.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button')) return;
    e.preventDefault();
    if (first) {   // beim ersten Antippen: Vollbild, Bildschirm bleibt an (hochkant und quer erlaubt)
      first = false;
      document.documentElement.requestFullscreen?.().catch(() => {});
      navigator.wakeLock?.request?.('screen').catch(() => {});
    }
    root.setPointerCapture?.(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    update();
  });
  root.addEventListener('pointermove', (e) => { if (pointers.has(e.pointerId)) { pointers.set(e.pointerId, { x: e.clientX, y: e.clientY }); update(); } });
  const up = (e) => { if (pointers.delete(e.pointerId)) update(); };
  root.addEventListener('pointerup', up);
  root.addEventListener('pointercancel', up);
  root.addEventListener('contextmenu', (e) => e.preventDefault());
  document.addEventListener('visibilitychange', () => { if (document.hidden) { pointers.clear(); update(); } });
  // Drehen: Finger loslassen, sonst hängen Tasten an alten Stellen
  addEventListener('orientationchange', () => { pointers.clear(); update(); });

  return { get client() { return client; }, get mask() { return mask; }, get shown() { return shown; }, get rumbleUntil() { return rumbleUntil; } };
}
