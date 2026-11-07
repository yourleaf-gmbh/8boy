// Dock: TV-Modus für alle drei Konsolen (Switch-Prinzip). Das Bild füllt den Fernseher, das Gehäuse verschwindet,
// bis zu vier Spieler spielen mit Gamepads (Xbox, PlayStation, Switch) oder dem Handy als Controller.
// Regal, Store, Kartridge-Fenster und Auspacken sind mit Steuerkreuz + A/B bedienbar (Sofa-Abstand).
import { KIND_NAME, padLabels } from './input.js';
import { createPadHost } from './padnet.js';
import { qrSVG } from './qr.js';

const B = { LEFT: 0, RIGHT: 1, UP: 2, DOWN: 3, A: 4, B: 5, START: 6, SELECT: 7 };
const RETRY_MS = 5000;
export const TV_BAR_H = 64;   // Streifen unter dem Bild für die Statusleiste (css/dock.css: --tv-bar-h)

// Bildgröße im TV-Modus: ganzzahlig vergrößern, wenn das den Fernseher gut füllt (scharfe Pixel), sonst einpassen
export function tvScreenSize(W, H, vw, vh, dpr = 1) {
  const fit = Math.min(vw / W, vh / H);
  const s = Math.floor(fit * dpr) / dpr;
  const k = s >= 1 && s >= fit * 0.88 ? s : fit;
  return { w: Math.floor(W * k), h: Math.floor(H * k) };
}

export function createDock({ app, input, system, hw, toast = () => {}, onBack = {}, padUrl = null, WS }) {
  let on = false, pairOn = false, retry = null, lastKeyAt = 0;
  // Läuft der Fernseher über localhost, kann das Handy diese Adresse nicht erreichen: der lokale Server
  // (tools/serve.mjs) nennt seine WLAN-Adresse, die kommt in den QR-Code. Online gibt es lan.json nicht.
  let lanOrigin = '';
  const isLocal = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
  // Eigene Adresse für den Handy-Link (z. B. hinter einem Proxy): EIGHTBOY_CONFIG.padUrl aus config.js
  const padBase = globalThis.EIGHTBOY_CONFIG?.padUrl || '';
  padUrl ||= (code) => `${padBase || `${lanOrigin || location.origin}${location.pathname}`}#pad=${code}`;
  if (isLocal) {
    fetch('lan.json', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).then((j) => {
      if (!j?.ips?.length) return;
      lanOrigin = `${location.protocol}//${j.ips[0]}:${location.port || j.port}`;
      lastQr = null; render();
    }).catch(() => {});
  }
  const $ = (h) => { const d = document.createElement('div'); d.innerHTML = h.trim(); return d.firstChild; };

  // ---------------------------------------------------------------- Statusleiste und Mitspiel-Tafel
  const bar = $('<div class="tv-bar" id="tvBar" hidden aria-live="polite"></div>');
  const panel = $(`<aside class="tv-panel" id="tvPanel" hidden aria-label="Mitspielen">
      <h3>Mitspielen</h3>
      <p class="tv-how">Gamepad: <b>Start-</b> bzw. <b>Menütaste</b> drücken.<br>Handy: QR-Code scannen.</p>
      <div class="tv-qr" id="tvQr"></div>
      <p class="tv-code" id="tvCode"></p>
      <div class="tv-labels" id="tvLabels"></div>
      <button class="tb tv-off" id="tvOff" title="TV-Modus beenden">TV-Modus aus</button>
    </aside>`);
  const card = $('<div class="tv-card" id="tvCard" hidden></div>');
  const ring = $('<div class="tv-ring" hidden aria-hidden="true"></div>');
  document.body.append(bar, panel, card, ring);
  let cardTimer = null, dimTimer = null;

  // Handy-Controller über die Lobby
  const host = createPadHost({
    WS,
    onJoin: (id) => { const slot = input.phoneAdd(id); sendInfo(id); if (!slot) { host.kick(id); toast('Schon 4 Spieler – kein Platz mehr.'); } },
    onLeave: (id) => { input.phoneRemove(id); outbox.delete(id); lastTo.delete(id); },
    onKeys: (id, b) => { input.phoneSet(id, b); lastKeyAt = performance.timeOrigin + performance.now(); },
    onStatus: (s) => {
      render();
      clearTimeout(retry);
      if ((on || pairOn) && (s === 'getrennt' || s === 'fehler')) retry = setTimeout(() => { if (on || pairOn) host.open(); }, RETRY_MS);
    },
  });
  // Fernseher → Handy: jede Nachricht trägt den ganzen Stand (Spieler, Konsole, padinfo-Anzeige), dazu ggf. ein
  // Rüttel-Muster (vib). Gedrosselt: je Handy höchstens alle 100 ms, insgesamt höchstens 6 je Sekunde – der Server
  // lässt dem Fernseher 8 „sonstige“ Nachrichten pro Sekunde (dazu kommt das Lebenszeichen). Wartendes wird je
  // Handy zusammengefasst; ein Rüttler, der zu spät käme (über 300 ms), entfällt.
  const PI_MAX = 6, PI_GAP = 100, VIB_ALT = 300, PI_LEN = 200;
  const outbox = new Map(), lastTo = new Map(), sentAt = [];
  let flushTimer = 0;
  function infoFor(id, vib) {
    const seat = input.seats().find((x) => x.key === 'ph' + id), p = seat?.slot || 0;
    const d = { p, sys: hw().id, name: hw().name };
    const show = input.padshow?.(p);
    if (show) Object.assign(d, show);
    if (vib) d.vib = vib;
    // Grenze des Servers (200 Zeichen JSON): notfalls den Text kürzen
    while (d.txt && JSON.stringify(d).length > PI_LEN) d.txt = [...d.txt].slice(0, -1).join('');
    return d;
  }
  function queue(id, vib = null) {
    const o = outbox.get(id) || { info: false, vib: null, at: 0 };
    if (vib) { o.vib = vib; o.at = performance.now(); } else o.info = true;
    outbox.set(id, o);
    flush();
  }
  function flush() {
    clearTimeout(flushTimer); flushTimer = 0;
    const t = performance.now();
    while (sentAt.length && t - sentAt[0] >= 1000) sentAt.shift();
    let wait = Infinity;
    for (const [id, o] of outbox) {
      if (!host.pads.includes(id)) { outbox.delete(id); continue; }
      if (o.vib && t - o.at > VIB_ALT) { o.vib = null; if (!o.info) { outbox.delete(id); continue; } }
      if (sentAt.length >= PI_MAX) { wait = Math.min(wait, sentAt[0] + 1000 - t); break; }
      const gap = (lastTo.get(id) ?? -1e9) + PI_GAP - t;
      if (gap > 0) { wait = Math.min(wait, gap); continue; }
      outbox.delete(id);
      sentAt.push(t); lastTo.set(id, t);
      host.info(id, infoFor(id, o.vib));
    }
    if (outbox.size) flushTimer = setTimeout(flush, Math.max(4, Math.min(wait, 1000) + 1));
  }
  const sendInfo = (id) => queue(id);
  const infoAll = () => host.pads.forEach(sendInfo);
  input.setPadOut?.({ rumble: (id, v) => queue(id, v), show: (id) => queue(id) });

  input.onJoin((e) => {
    render();
    if (!on) { if (e.type === 'join' && e.slot > 1) toast(`Spieler ${e.slot} ist dabei (${KIND_NAME[e.kind] || e.kind})`); return; }
    showCard(e);
  });

  function labelLine(kind) {
    if (kind === 'tastatur' || kind === 'handy') return '';
    const L = padLabels(kind), sup = hw().id >= 16;
    if (sup) return `A = ${L.A} · B = ${L.B} · X = ${L.X} · Y = ${L.Y} · L = ${L.L} · R = ${L.R} · MENÜ = ${L.START}`;
    return `A = ${L.A} oder ${L.X} · B = ${L.B} oder ${L.Y} · MENÜ = ${L.START}`;
  }
  function showCard(e) {
    const name = KIND_NAME[e.kind] || e.kind;
    card.className = 'tv-card p' + e.slot;
    card.innerHTML = e.type === 'join'
      ? `<b>Spieler ${e.slot}</b> ist dabei · ${name}<small>${labelLine(e.kind)}</small>`
      : `<b>Spieler ${e.slot}</b> ist weg (${name})`;
    card.hidden = false;
    clearTimeout(cardTimer);
    cardTimer = setTimeout(() => { card.hidden = true; }, 6000);
    wake();
  }

  function wake() {
    bar.classList.remove('dim');
    clearTimeout(dimTimer);
    dimTimer = setTimeout(() => bar.classList.add('dim'), 6000);
  }

  let lastQr = '';
  // QR-Code und Code für die Handys (TV-Tafel und Handy-Fenster)
  function qrHtml(code) { return code ? qrSVG(padUrl(code)) : `<div class="tv-qr-off">${host.status === 'verbinde' ? 'Verbinde …' : 'Handy-Verbindung nicht erreichbar'}</div>`; }
  function codeHtml(code) { return code ? `Code <b>${code}</b><small>${padUrl(code).replace(/^https?:\/\//, '')}</small>` : ''; }
  function render() {
    renderPair();
    if (!on) return;
    const seats = input.seats();
    const waiting = input.waiting().filter((k) => k !== 'handy').length;
    bar.innerHTML = '<span class="tv-logo">8BOY TV</span>' + seats.map((s) =>
      `<span class="tv-chip p${s.slot}${s.kind ? '' : ' frei'}"><b>${s.slot}</b>${s.kind ? KIND_NAME[s.kind] || s.kind : 'frei'}</span>`).join('') +
      (waiting ? `<span class="tv-wait">${waiting} Gamepad${waiting > 1 ? 's' : ''}: Start-/Menütaste zum Mitmachen</span>` : '') +
      `<span class="tv-net">${host.status === 'bereit' ? '📱 ' + host.code : host.status === 'verbinde' ? '📱 …' : '📱 offline'}</span>`;
    const code = host.status === 'bereit' ? host.code : '';
    if (code !== lastQr) {
      lastQr = code;
      panel.querySelector('#tvQr').innerHTML = qrHtml(code);
      panel.querySelector('#tvCode').innerHTML = codeHtml(code);
    }
    const lines = seats.filter((s) => s.kind && s.kind !== 'tastatur' && s.kind !== 'handy').map((s) => `<p class="p${s.slot}"><b>${s.slot} · ${KIND_NAME[s.kind]}</b><br>${labelLine(s.kind)}</p>`);
    panel.querySelector('#tvLabels').innerHTML = lines.length ? '<h4>Tasten</h4>' + lines.join('') : '';
  }

  // Tafel nur zeigen, wenn sie nicht stört: neben dem Bild (genug Rand) oder wenn kein Spiel läuft
  function placePanel(screenW) {
    if (!on) return;
    const side = (window.innerWidth - screenW) / 2;
    panel.classList.toggle('beside', side >= 210);
    panel.style.setProperty('--side', Math.max(0, side) + 'px');
  }
  function tick() {
    if (!on) return;
    if (!ring.hidden && !layer()) ring.hidden = true;
    // Neben dem Bild immer; ist dort kein Platz, nur im Startmenü – nie über einem laufenden Spiel oder seinen Meldungen
    const show = panel.classList.contains('beside') || system.state === 'home' || system.state === 'off';
    if (panel.hidden === show) panel.hidden = !show;
  }

  // ---------------------------------------------------------------- Ein-/Ausschalten
  function setTV(v) {
    v = !!v;
    if (v === on) { render(); return; }
    on = v;
    document.body.classList.toggle('tv', on);
    app.classList.toggle('tv', on);
    bar.hidden = !on;
    if (!on) card.hidden = true;
    panel.hidden = !on;
    if (on) { host.open(); render(); wake(); } else if (!pairOn) { clearTimeout(retry); host.close(); }
  }

  // ---------------------------------------------------------------- Handy als Controller ohne TV-Modus
  // Menü → „Handy als Controller“: Fenster mit QR-Code; die Verbindung bleibt, bis man sie trennt (oder die Seite schließt).
  const pairBox = $(`<div class="pad-pair" id="padPair" hidden>
      <div class="pp-card" role="dialog" aria-modal="true" aria-labelledby="ppTitle">
        <h3 id="ppTitle">📱 Handy als Controller</h3>
        <p>Mit der Handy-Kamera den Code scannen – das Handy wird zum Gamepad. Bis zu 4 Spieler, Handy und Konsole im selben WLAN.</p>
        <div class="tv-qr" id="ppQr"></div>
        <p class="tv-code" id="ppCode"></p>
        <div class="pp-list" id="ppList" aria-live="polite"></div>
        <div class="pp-actions"><button class="tb tb-run" id="ppDone">Fertig</button><button class="tb" id="ppOff">Handys trennen</button></div>
      </div>
    </div>`);
  document.body.append(pairBox);
  let lastPairQr = null;
  function renderPair() {
    if (pairBox.hidden) return;
    const code = host.status === 'bereit' ? host.code : '';
    const key = code + host.status;
    if (key !== lastPairQr) {
      lastPairQr = key;
      pairBox.querySelector('#ppQr').innerHTML = qrHtml(code);
      pairBox.querySelector('#ppCode').innerHTML = codeHtml(code);
    }
    const phones = input.seats().filter((s) => s.kind === 'handy');
    pairBox.querySelector('#ppList').innerHTML = phones.length
      ? phones.map((s) => `<span class="tv-chip p${s.slot}"><b>${s.slot}</b>Handy</span>`).join('')
      : '<span class="pp-none">Noch kein Handy verbunden</span>';
    pairBox.querySelector('#ppOff').hidden = !pairOn || on;
  }
  function pair() {
    pairOn = true;
    host.open();
    pairBox.hidden = false;
    lastPairQr = null;
    renderPair();
    pairBox.querySelector('#ppDone').focus();
  }
  const closePair = () => { pairBox.hidden = true; };
  pairBox.querySelector('#ppDone').addEventListener('click', closePair);
  pairBox.querySelector('#ppOff').addEventListener('click', () => {
    pairOn = false;
    if (!on) { clearTimeout(retry); host.close(); }
    closePair();
    toast('Handys getrennt.');
  });
  pairBox.addEventListener('click', (e) => { if (e.target === pairBox) closePair(); });
  document.addEventListener('keydown', (e) => { if (!pairBox.hidden && e.key === 'Escape') { e.stopPropagation(); closePair(); } }, true);
  input.onJoin(() => renderPair());
  panel.querySelector('#tvOff').addEventListener('click', () => onBack.tvOff?.());

  // ---------------------------------------------------------------- Navigation mit Steuerkreuz
  // Welche Ebene liegt oben? Die wird bedient, das Spiel darunter steht so lange.
  function layer() {
    const ub = document.querySelector('.ub:not([hidden])');
    if (ub) return { root: ub, back: () => (ub.querySelector('.ub-book:not([hidden]) .bk-close') || ub.querySelector('.ub-close'))?.click(), first: '.ub-book:not([hidden]) .bk-insert:not([hidden]), .ub-hint:not([hidden]), .ub-skip' };
    const cd = document.getElementById('cartDialog');
    if (cd && !cd.hidden) return { root: cd, back: onBack.dialog, first: '#cdInsert' };
    const st = document.getElementById('store');
    if (st && !st.hidden) return { root: st, back: onBack.store, first: '#stDetail:not([hidden]) .st-play, .st-item .st-play' };
    if (app.classList.contains('shelf-open')) return { root: document.getElementById('shelf'), back: onBack.shelf, first: '.shelf-list .cart, .shelf-list .pkg' };
    return null;
  }
  const navActive = () => on && !!layer();
  let cur = null;
  const visible = (el) => el.getClientRects().length && !el.closest('[hidden]') && getComputedStyle(el).visibility !== 'hidden';
  function items(root) {
    return [...root.querySelectorAll('button, .cart, .pkg, .store-tile')]
      .filter((el) => visible(el) && !el.disabled && !el.closest('.for-mouse, .cart-ghost, .slot-cart') && !(el.classList.contains('cart') && el.parentElement?.classList.contains('cd-cart')));
  }
  function setCur(el) {
    if (cur === el) return;
    cur?.classList.remove('tv-focus');
    cur = el;
    if (!el) return;
    el.classList.add('tv-focus');
    el.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }
  function move(dir) {
    const L = layer(), list = items(L.root);
    if (!list.length) return;
    if (!cur || !list.includes(cur)) { setCur(L.root.querySelector(L.first) && list.includes(L.root.querySelector(L.first)) ? L.root.querySelector(L.first) : list[0]); return; }
    const r0 = cur.getBoundingClientRect(), cx = r0.left + r0.width / 2, cy = r0.top + r0.height / 2;
    let best = null, bestS = Infinity;
    for (const el of list) {
      if (el === cur) continue;
      const r = el.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2;
      const dx = x - cx, dy = y - cy;
      const main = dir === B.LEFT ? -dx : dir === B.RIGHT ? dx : dir === B.UP ? -dy : dy;
      const side = dir === B.LEFT || dir === B.RIGHT ? Math.abs(dy) : Math.abs(dx);
      if (main <= 4) continue;
      const s = main + side * 2.2;
      if (s < bestS) { bestS = s; best = el; }
    }
    if (best) setCur(best);
  }
  function activate() {
    if (!cur) return;
    const el = cur;
    if (el._act) el._act(); else el.click();
  }
  let lastLayer = null;
  function showRing() {
    if (!cur) { ring.hidden = true; return; }
    const r = cur.getBoundingClientRect();
    Object.assign(ring.style, { left: r.left - 6 + 'px', top: r.top - 6 + 'px', width: r.width + 12 + 'px', height: r.height + 12 + 'px' });
    ring.hidden = false;
  }
  function navTick() {
    const L = layer();
    if (!L) { ring.hidden = true; return; }
    if (L.root !== lastLayer) { lastLayer = L.root; cur?.classList.remove('tv-focus'); cur = null; }
    if (!cur || !cur.isConnected || !visible(cur)) {
      cur = null;
      const list = items(L.root), f = L.root.querySelector(L.first);
      setCur(f && list.includes(f) ? f : list[0] || null);
    }
    for (const d of [B.UP, B.DOWN, B.LEFT, B.RIGHT]) if (input.btnp(d)) move(d);
    if (input.btnp(B.A) || input.btnp(B.START)) activate();
    else if (input.btnp(B.B)) L.back?.();
    showRing();
  }

  return {
    setTV, render, navActive, navTick, placePanel, tick, machineChanged: () => { infoAll(); render(); }, pair, closePair, get pairOpen() { return !pairBox.hidden; },
    get on() { return on; }, host, get lastKeyAt() { return lastKeyAt; },
  };
}
