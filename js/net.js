// Mehrspieler: Verbindung zur 8BOY-Lobby (server/lobby.mjs) über WebSocket.
// Adresse: EIGHTBOY_CONFIG.lobbyUrl aus config.js, sonst dieselbe Seite (https → wss://<host>/mp)
// bzw. zu Hause/LAN ws://<rechner>:8787/mp (node server/lobby.mjs). Siehe docs/SELBST-BETREIBEN.md.
//
// Ablauf: verbinden → Server schickt eine Rechenaufgabe → Lösung suchen (SHA-256 mit führenden Null-Bits)
// → hello mit Name, Figur und Spielmodi → Lobby. Kartridges sehen das über die Lua-Befehle net.* (js/vm.js).

// ------------------------------------------------------------------ SHA-256 (klein, synchron – für die Rechenaufgabe)
const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2]);
const W = new Uint32Array(64);
export function sha256(bytes) {
  const l = bytes.length, n = ((l + 9 + 63) >> 6) << 6, m = new Uint8Array(n);
  m.set(bytes); m[l] = 0x80;
  const bits = l * 8; m[n - 4] = bits >>> 24; m[n - 3] = bits >>> 16; m[n - 2] = bits >>> 8; m[n - 1] = bits;
  let a0 = 0x6a09e667, b0 = 0xbb67ae85, c0 = 0x3c6ef372, d0 = 0xa54ff53a, e0 = 0x510e527f, f0 = 0x9b05688c, g0 = 0x1f83d9ab, h0 = 0x5be0cd19;
  for (let o = 0; o < n; o += 64) {
    for (let i = 0; i < 16; i++) W[i] = (m[o + i * 4] << 24) | (m[o + i * 4 + 1] << 16) | (m[o + i * 4 + 2] << 8) | m[o + i * 4 + 3];
    for (let i = 16; i < 64; i++) {
      const x = W[i - 15], y = W[i - 2];
      const s0 = ((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3);
      const s1 = ((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10);
      W[i] = (W[i - 16] + s0 + W[i - 7] + s1) | 0;
    }
    let a = a0, b = b0, c = c0, d = d0, e = e0, f = f0, g = g0, h = h0;
    for (let i = 0; i < 64; i++) {
      const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      const t1 = (h + S1 + ((e & f) ^ (~e & g)) + K[i] + W[i]) | 0;
      const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      const t2 = (S0 + ((a & b) ^ (a & c) ^ (b & c))) | 0;
      h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
    }
    a0 = (a0 + a) | 0; b0 = (b0 + b) | 0; c0 = (c0 + c) | 0; d0 = (d0 + d) | 0; e0 = (e0 + e) | 0; f0 = (f0 + f) | 0; g0 = (g0 + g) | 0; h0 = (h0 + h) | 0;
  }
  const out = new Uint8Array(32), v = [a0, b0, c0, d0, e0, f0, g0, h0];
  v.forEach((x, i) => { out[i * 4] = x >>> 24; out[i * 4 + 1] = x >>> 16; out[i * 4 + 2] = x >>> 8; out[i * 4 + 3] = x; });
  return out;
}
// Rechenaufgabe lösen: Zahl finden, deren Hash mit `bits` Null-Bits beginnt
export function solvePow(challenge, bits) {
  const enc = new TextEncoder();
  for (let n = 0; n < 1e8; n++) {
    const h = sha256(enc.encode(challenge + ':' + n.toString(36)));
    let need = bits, ok = true;
    for (let i = 0; need > 0; i++, need -= 8) {
      const mask = need >= 8 ? 0xff : (0xff << (8 - need)) & 0xff;
      if (h[i] & mask) { ok = false; break; }
    }
    if (ok) return n.toString(36);
  }
  return '';
}

// ------------------------------------------------------------------ Verbindung
export function lobbyUrl(loc = globalThis.location, cfg = globalThis.EIGHTBOY_CONFIG) {
  if (cfg?.lobbyUrl) return cfg.lobbyUrl;
  if (!loc) return 'ws://localhost:8787/mp';
  if (loc.protocol === 'https:') return `wss://${loc.host}/mp`;
  return `ws://${loc.hostname || 'localhost'}:8787/mp`;
}

export function createNet({ url = null, WS = globalThis.WebSocket } = {}) {
  let ws = null, status = 'aus', error = '', me = 0, myName = '';
  let lobby = null;
  const states = new Map();
  const world = new Map();   // gemeinsamer Weltzustand: Schlüssel → { v, by }
  let inbox = [];
  let hello = null, lastSend = 0, lastBots = 0, pingAt = 0, ping = -1;

  function close() { if (ws) { try { ws.close(); } catch { /* egal */ } } ws = null; }

  function join(game, name, fig = 0, modes = [], roundSec = 180, max = 16) {
    leave();
    if (!WS) { status = 'fehler'; error = 'Dieser Browser kann kein WebSocket.'; return; }
    status = 'verbinde'; error = '';
    hello = { t: 'hello', game, name, fig, modes, roundSec, max };
    try { ws = new WS(url || lobbyUrl()); } catch (e) { status = 'fehler'; error = 'Keine Verbindung möglich.'; return; }
    // Nachzügler einer alten Verbindung (schnell verlassen und neu beigetreten) dürfen die neue nicht stören
    const sock = ws;
    ws.onmessage = (ev) => {
      if (ws !== sock) return;
      let m;
      try { m = JSON.parse(ev.data); } catch { return; }
      switch (m.t) {
        case 'challenge':
          // Handshake: Aufgabe lösen und mit dem hello zurückschicken
          ws.send(JSON.stringify({ ...hello, pow: solvePow(m.c, m.bits) }));
          break;
        case 'welcome':
          me = m.id; myName = m.name; status = 'lobby';
          world.clear(); for (const [k, x] of Object.entries(m.world || {})) world.set(k, x);
          break;
        case 'w': if (m.v === null) world.delete(m.k); else world.set(m.k, { v: m.v, by: m.by }); inbox.push(m); break;
        case 'wclear': world.clear(); break;
        case 'denied': inbox.push(m); break;
        case 'lobby': {
          lobby = m;
          const ids = new Set(m.players.map((p) => p.id));
          for (const id of states.keys()) if (!ids.has(id)) states.delete(id);
          break;
        }
        case 's': states.set(m.id, m.d); break;
        case 'bs': for (const b of m.d) states.set(b.id, b); break;
        case 'e': case 'hit': case 'cap': inbox.push(m); if (inbox.length > 200) inbox.shift(); break;
        case 'pong': ping = Date.now() - m.at; break;
        case 'fehler': error = m.text; break;
        default: break;
      }
    };
    ws.onclose = () => { if (ws !== sock) return; if (status !== 'aus') { status = error ? 'fehler' : 'getrennt'; } ws = null; };
    ws.onerror = () => { if (ws !== sock) return; error = error || 'Lobby-Server nicht erreichbar.'; };
  }
  function leave() { status = 'aus'; close(); lobby = null; states.clear(); world.clear(); inbox = []; me = 0; }
  const ready = () => ws && ws.readyState === 1 && status === 'lobby';
  function raw(obj) { if (ready()) ws.send(JSON.stringify(obj)); }

  return {
    join, leave,
    get status() { return status; }, get error() { return error; }, get me() { return me; }, get name() { return myName; },
    get lobby() { return lobby; },
    // eigenen Zustand senden – höchstens 20-mal pro Sekunde, der Rest wird verworfen
    send(d) { const now = Date.now(); if (now - lastSend < 50) return; lastSend = now; raw({ t: 's', d }); },
    event(d, to) { raw(to === undefined ? { t: 'e', d } : { t: 'e', d, to }); },
    vote(mode) { raw({ t: 'vote', mode }); },
    hit(by, victim) { raw(victim === undefined ? { t: 'hit', by } : { t: 'hit', by, victim }); },
    cap(bot) { raw(bot === undefined ? { t: 'cap' } : { t: 'cap', bot }); },
    // Bots: nur der Gastgeber füllt auf und schickt ihre Zustände (Liste mit id)
    get host() { return !!lobby && lobby.host === me; },
    fill(n) { raw({ t: 'fill', n }); },
    finish() { raw({ t: 'end' }); },
    sendBots(list) { const now = Date.now(); if (now - lastBots < 50) return; lastBots = now; raw({ t: 'bs', d: list }); },
    state: (id) => states.get(id),
    set(k, v) { raw({ t: 'set', k, v: v ?? null }); },
    setMany(kv) { raw({ t: 'sets', kv }); },
    claim(k, v = true) { raw({ t: 'set', k, v, claim: true }); },
    get: (k) => world.get(k),
    events() { const e = inbox; inbox = []; return e; },
    ping() { const now = Date.now(); if (now - pingAt > 2000) { pingAt = now; raw({ t: 'ping', at: now }); } return ping; },
  };
}
