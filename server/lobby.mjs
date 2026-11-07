// 8BOY Mehrspieler-Lobby: ein kleiner WebSocket-Dienst ohne fremde Bibliotheken.
//   node server/lobby.mjs [port]        (Standard 8787; im LAN reicht das für Spiele zu Hause)
// Betrieb im Internet: hinter einem Reverse Proxy mit TLS, der /mp (WebSocket) und /g/ hierher weiterleitet.
// Einstellungen über Umgebungsvariablen – siehe docs/SELBST-BETREIBEN.md:
//   PORT, ALLOWED_ORIGINS, TRUST_PROXY, POW_BITS, GESCHENKE_DIR, GESCHENK_MAX
//
// Grundsätze:
// - speichert nichts: keine Konten, keine Logs mit IP-Adressen, Namen nur solange man verbunden ist
// - pro Spiel genau EINE offene Lobby, höchstens 16 Spieler
// - Grenzen gegen Missbrauch: Nachrichtengröße, Nachrichtenrate, Verbindungen je Adresse, Namensfilter, Herkunftsprüfung
// - Handshake mit Rechenaufgabe (Proof of Work): Der Server schickt eine Zufallsaufgabe, die Konsole muss eine Zahl
//   finden, sodass SHA-256(aufgabe + ":" + zahl) mit POW_BITS Null-Bits beginnt. Für Spieler unmerklich (~0,1 s),
//   für Skripte, die den Dienst massenhaft nutzen wollen, teuer. Ein Geheimnis im Browser-Code gäbe es nicht –
//   das könnte jeder auslesen.
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const PORT = +process.argv[2] || +process.env.PORT || 8787;
const MAX_PLAYERS = 16;
const MAX_LOBBIES = 50;
const MAX_FRAME = 2048;           // Bytes je Nachricht
const MAX_PER_IP = 6;             // gleichzeitige Verbindungen je Adresse (nur im Speicher)
const RATE = { s: 30, e: 12, k: 60, other: 8 };   // Nachrichten je Sekunde: Zustand, Ereignis, Handy-Tasten, sonstiges
const IDLE_MS = 45000;
const POW_BITS = +process.env.POW_BITS || 16;
const HELLO_MS = 8000;
const PHASE_MS = { abstimmung: 15000, ergebnis: 10000 };
// Herkunftsprüfung: Seiten, von denen aus sich eine Konsole verbinden darf. Immer erlaubt: localhost und Adressen im
// Heimnetz (http). Eigene Domains kommagetrennt in ALLOWED_ORIGINS, z. B. "https://spiel.example.org".
const ORIGINS = [/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/,
  /^http:\/\/(10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)(:\d+)?$/,
  ...(process.env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim().replace(/\/+$/, '')).filter(Boolean)
    .map((o) => new RegExp('^' + o.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$'))];
// Nur hinter einem eigenen Reverse Proxy X-Forwarded-For glauben (sonst ließe sich die Grenze je Adresse umgehen)
const TRUST_PROXY = /^(1|true|ja)$/i.test(process.env.TRUST_PROXY || '');

// ------------------------------------------------------------------ Namen
const BAD = ['arsch', 'fick', 'fotze', 'hure', 'nazi', 'hitler', 'nigg', 'neger', 'schwuchtel', 'spast', 'wichs', 'fuck', 'shit', 'bitch', 'cunt', 'whore', 'penis', 'vagina', 'porn', 'sieg heil', 'heil'];
// Prüft die Lösung der Rechenaufgabe
export function powOk(challenge, nonce, bits = POW_BITS) {
  if (typeof nonce !== 'string' || nonce.length > 24) return false;
  const h = crypto.createHash('sha256').update(challenge + ':' + nonce).digest();
  let need = bits;
  for (let i = 0; need > 0; i++, need -= 8) {
    const mask = need >= 8 ? 0xff : (0xff << (8 - need)) & 0xff;
    if (h[i] & mask) return false;
  }
  return true;
}

export function cleanName(raw, id) {
  let n = String(raw ?? '').replace(/[^A-Za-z0-9äöüÄÖÜß .\-_]/g, '').replace(/\s+/g, ' ').trim().slice(0, 12);
  const flat = n.toLowerCase().replace(/0/g, 'o').replace(/[1!]/g, 'i').replace(/3/g, 'e').replace(/4/g, 'a').replace(/5/g, 's').replace(/[^a-zäöüß]/g, '');
  if (!n || BAD.some((w) => flat.includes(w.replace(/ /g, '')))) n = 'Spieler ' + id;
  return n;
}

// ------------------------------------------------------------------ WebSocket (RFC 6455, nur Text, ohne Fragmente)
function accept(req, socket) {
  const key = req.headers['sec-websocket-key'];
  if (!key) return false;
  const hash = crypto.createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n' + `Sec-WebSocket-Accept: ${hash}\r\n\r\n`);
  return true;
}
function frame(text, op = 1) {
  const data = Buffer.from(text);
  const len = data.length;
  const head = len < 126 ? Buffer.from([0x80 | op, len]) : Buffer.from([0x80 | op, 126, len >> 8, len & 255]);
  return Buffer.concat([head, data]);
}
function makeConn(socket, onText, onClose) {
  let buf = Buffer.alloc(0), closed = false;
  const close = (code = 1000) => {
    if (closed) return; closed = true;
    try { socket.end(Buffer.from([0x88, 2, code >> 8, code & 255])); } catch { /* weg */ }
    onClose();
  };
  socket.on('data', (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    if (buf.length > MAX_FRAME * 4) return close(1009);
    while (buf.length >= 2) {
      const fin = buf[0] & 0x80, op = buf[0] & 0x0f, masked = buf[1] & 0x80;
      let len = buf[1] & 0x7f, off = 2;
      if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4; }
      else if (len === 127) return close(1009);
      if (!masked || !fin) return close(1002);            // Browser maskieren immer; Fragmente gibt es bei uns nicht
      if (len > MAX_FRAME) return close(1009);
      if (buf.length < off + 4 + len) return;
      const mask = buf.subarray(off, off + 4), data = Buffer.from(buf.subarray(off + 4, off + 4 + len));
      for (let i = 0; i < data.length; i++) data[i] ^= mask[i & 3];
      buf = buf.subarray(off + 4 + len);
      if (op === 8) return close();
      if (op === 9) { socket.write(frame(data.toString(), 10)); continue; }
      if (op === 10) continue;
      if (op !== 1) return close(1003);
      onText(data.toString('utf8'));
    }
  });
  socket.on('close', () => { if (!closed) { closed = true; onClose(); } });
  socket.on('error', () => { if (!closed) { closed = true; onClose(); } });
  return { send: (obj) => { if (!closed) socket.write(frame(JSON.stringify(obj))); }, close };
}

// ------------------------------------------------------------------ Lobbys
const lobbies = new Map();
let nextId = 1;
const perIp = new Map();

function lobbyFor(game) {
  let l = lobbies.get(game);
  if (!l) {
    if (lobbies.size >= MAX_LOBBIES) return null;
    l = { game, players: new Map(), bots: new Map(), fill: 0, max: MAX_PLAYERS, phase: 'warten', mode: null, modes: [], roundMs: 180000, until: 0, round: 0, teamScore: {}, world: new Map() };
    lobbies.set(game, l);
  }
  return l;
}
const publicPlayer = (p) => ({ id: p.id, name: p.name, fig: p.fig, team: p.team, score: p.score, vote: p.vote ? 1 : 0, bot: p.bot ? 1 : 0 });

// Bots: Der Gastgeber (wer am längsten da ist) kann die Lobby bis N Spieler auffüllen. Die Bots rechnet SEINE Konsole
// (die Kartridge kennt das Spiel, der Server nicht); der Server führt sie nur in der Liste, mit negativen Nummern.
// Kommen echte Spieler dazu, gehen Bots – aber nie mitten in einer Runde.
const BOT_NAMES = ['Lina', 'Otto', 'Mia', 'Paul', 'Ida', 'Emil', 'Ella', 'Theo', 'Nele', 'Finn', 'Lotte', 'Juri', 'Wanda', 'Kalle', 'Rosa'];
const hostOf = (l) => Math.min(...l.players.keys());
const total = (l) => l.players.size + l.bots.size;
const everyone = (l) => [...l.players.values(), ...l.bots.values()];
function syncBots(l) {
  const want = Math.max(0, Math.min(l.max, l.fill) - l.players.size);
  while (l.bots.size > want) l.bots.delete(Math.min(...l.bots.keys()));
  for (let k = 1; l.bots.size < want; k++) {
    if (!l.bots.has(-k)) l.bots.set(-k, { id: -k, name: 'Bot ' + BOT_NAMES[(k - 1) % BOT_NAMES.length], fig: (k * 7) % 32, team: 0, score: 0, bot: true });
  }
}
function snapshot(l) {
  const votes = {};
  for (const p of l.players.values()) if (p.vote) votes[p.vote] = (votes[p.vote] || 0) + 1;
  return { t: 'lobby', phase: l.phase, mode: l.mode, round: l.round, left: Math.max(0, Math.ceil((l.until - Date.now()) / 1000)),
    host: l.players.size ? hostOf(l) : 0, fill: l.fill, max: l.max,
    modes: availableModes(l).map((m) => ({ id: m.id, name: m.name })), votes, teams: l.teamScore, players: everyone(l).map(publicPlayer) };
}
function broadcast(l, msg, except = null) { for (const p of l.players.values()) if (p !== except) p.conn.send(msg); }
const availableModes = (l) => l.modes.filter((m) => total(l) >= (m.min || 2));

function assignTeams(l) {
  const list = everyone(l);
  l.teamScore = {};
  list.forEach((p, i) => {
    p.score = 0;
    p.team = l.mode === 'ctf' ? 1 + (i % 2) : l.mode === 'duo' ? 1 + Math.floor(i / 2) : 0;
    if (p.team) l.teamScore[p.team] = 0;
  });
}
function setPhase(l, phase) {
  l.phase = phase;
  // nur ein Modus zur Wahl: nicht 15 s abstimmen, sondern gleich los
  if (phase === 'abstimmung') { l.until = Date.now() + (availableModes(l).length > 1 ? PHASE_MS.abstimmung : 3000); for (const p of l.players.values()) p.vote = null; }
  // roundMs 0 = Runde ohne Zeitlimit (Schach, Brettspiele): der Gastgeber beendet sie mit net.finish()
  if (phase === 'runde') { l.until = l.roundMs ? Date.now() + l.roundMs : 0; l.round++; assignTeams(l); l.world.clear(); broadcast(l, { t: 'wclear' }); }
  if (phase === 'ergebnis') l.until = Date.now() + PHASE_MS.ergebnis;
  if (phase === 'warten') { l.until = 0; l.mode = null; }
  broadcast(l, snapshot(l));
}
function pickMode(l) {
  const avail = availableModes(l);
  if (!avail.length) return null;
  const count = {};
  for (const p of l.players.values()) if (p.vote && avail.some((m) => m.id === p.vote)) count[p.vote] = (count[p.vote] || 0) + 1;
  const best = Math.max(0, ...Object.values(count));
  const top = best ? avail.filter((m) => count[m.id] === best) : avail;
  return top[Math.floor(Math.random() * top.length)].id;
}
// Takt: Phasen weiterschalten, einmal pro Sekunde die Lobby schicken
function tick() {
  const now = Date.now();
  for (const l of lobbies.values()) {
    if (!l.players.size) { lobbies.delete(l.game); continue; }
    if (l.phase !== 'runde') syncBots(l);
    if (total(l) < 2 && l.phase !== 'warten' && l.phase !== 'ergebnis') { setPhase(l, 'warten'); continue; }
    if (l.phase === 'warten' && total(l) >= 2) setPhase(l, 'abstimmung');
    else if (l.until && now >= l.until) {
      if (l.phase === 'abstimmung') { l.mode = pickMode(l); setPhase(l, l.mode ? 'runde' : 'warten'); }
      else if (l.phase === 'runde') setPhase(l, 'ergebnis');
      else if (l.phase === 'ergebnis') setPhase(l, total(l) >= 2 ? 'abstimmung' : 'warten');
    } else broadcast(l, snapshot(l));
    for (const p of l.players.values()) if (now - p.seen > IDLE_MS) p.conn.close(1001);
  }
  for (const room of rooms.values()) {
    for (const q of room.pads.values()) if (now - q.seen > IDLE_MS) q.conn.close(1001);
    if (now - room.tv.seen > IDLE_MS) room.tv.conn.close(1001);
  }
}

// ------------------------------------------------------------------ Nachrichten
function handle(p, raw) {
  let m;
  try { m = JSON.parse(raw); } catch { return; }
  if (!m || typeof m !== 'object') return;
  p.seen = Date.now();
  // Rate begrenzen (pro Sekunde, je Art)
  const kind = m.t === 's' || m.t === 'bs' ? 's' : m.t === 'e' ? 'e' : m.t === 'k' ? 'k' : 'other';
  const sec = Math.floor(p.seen / 1000);
  if (p.rateSec !== sec) { p.rateSec = sec; p.rate = { s: 0, e: 0, k: 0, other: 0 }; }
  if (++p.rate[kind] > RATE[kind]) return;

  if (handlePad(p, m)) return;
  if (m.t === 'hello' && !p.lobby && !p.room) {
    if (!powOk(p.challenge, m.pow, POW_BITS)) { p.conn.send({ t: 'fehler', text: 'Handshake fehlgeschlagen.' }); return p.conn.close(1008); }
    const game = String(m.game || '').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 32);
    if (!game) return p.conn.close(1008);
    const l = lobbyFor(game);
    if (!l) { p.conn.send({ t: 'fehler', text: 'Server ist gerade voll.' }); return p.conn.close(1013); }
    if (l.players.size >= l.max) { p.conn.send({ t: 'fehler', text: `Die Lobby ist voll (${l.max} Spieler).` }); return p.conn.close(1013); }
    p.name = cleanName(m.name, p.id);
    p.fig = Math.max(0, Math.min(31, m.fig | 0));
    p.team = 0; p.score = 0; p.vote = null;
    p.lobby = l;
    if (!l.modes.length && Array.isArray(m.modes)) {
      l.modes = m.modes.slice(0, 12).map((x) => ({ id: String(x.id || '').replace(/[^a-z0-9-]/g, '').slice(0, 16), name: String(x.name || '').slice(0, 24), min: Math.max(2, Math.min(16, x.min | 0 || 2)) })).filter((x) => x.id);
      l.roundMs = m.roundSec === 0 ? 0 : Math.max(30, Math.min(900, m.roundSec | 0 || 180)) * 1000;
      l.max = Math.max(2, Math.min(MAX_PLAYERS, m.max | 0 || MAX_PLAYERS));
    }
    if (!l.modes.length) l.modes = [{ id: 'ffa', name: 'Jeder gegen Jeden', min: 2 }];
    l.players.set(p.id, p);
    if (l.phase === 'runde' && total(l) > l.max) l.bots.delete(Math.min(...l.bots.keys()));
    // wer mitten in einer Runde kommt, spielt gleich mit (beim Team mit weniger Spielern)
    if (l.phase === 'runde' && (l.mode === 'ctf' || l.mode === 'duo')) {
      const size = {};
      for (const o of everyone(l)) if (o !== p && o.team) size[o.team] = (size[o.team] || 0) + 1;
      const teams = Object.keys(l.teamScore).map(Number);
      p.team = teams.sort((a, b) => (size[a] || 0) - (size[b] || 0))[0] || 1;
    }
    p.conn.send({ t: 'welcome', id: p.id, name: p.name, world: Object.fromEntries([...l.world].map(([k, x]) => [k, x])) });
    broadcast(l, snapshot(l));
    return;
  }
  const l = p.lobby;
  if (!l) return;
  switch (m.t) {
    case 's': // eigener Zustand (Position, Blickrichtung …) an alle anderen
      if (l.phase !== 'runde') return;
      if (JSON.stringify(m.d ?? null).length > 400) return;
      broadcast(l, { t: 's', id: p.id, d: m.d }, p);
      break;
    case 'e': // Ereignis (Schuss, Platscher, Fahne aufgenommen) an alle anderen – oder mit „to“ nur an einen
      if (JSON.stringify(m.d ?? null).length > 400) return;
      if (m.to !== undefined) { const q = l.players.get(m.to | 0); if (q && q !== p) q.conn.send({ t: 'e', id: p.id, d: m.d, to: q.id }); }
      else broadcast(l, { t: 'e', id: p.id, d: m.d }, p);
      break;
    case 'vote':
      if (l.phase !== 'abstimmung') return;
      if (availableModes(l).some((x) => x.id === m.mode)) { p.vote = m.mode; broadcast(l, snapshot(l)); }
      break;
    case 'hit': { // das Opfer meldet, wer es getroffen hat – so kann niemand sich selbst Punkte geben
      if (l.phase !== 'runde') return;
      // getroffene Bots meldet der Gastgeber, der sie steuert
      const victim = m.victim !== undefined && p.id === hostOf(l) ? l.bots.get(m.victim | 0) : p;
      const by = l.players.get(m.by | 0) || l.bots.get(m.by | 0);
      if (!victim || !by || by === victim || (by.team && by.team === victim.team)) return;
      by.score++;
      if (by.team && l.mode === 'duo') l.teamScore[by.team] = (l.teamScore[by.team] || 0) + 1;
      broadcast(l, { t: 'hit', id: victim.id, by: by.id });
      broadcast(l, snapshot(l));
      break;
    }
    case 'cap': { // Fahne erobert (Capture the Flag); für Bots meldet es der Gastgeber
      const who = m.bot !== undefined && p.id === hostOf(l) ? l.bots.get(m.bot | 0) : p;
      if (!who || l.phase !== 'runde' || l.mode !== 'ctf' || !who.team) return;
      if (who.lastCap && Date.now() - who.lastCap < 3000) return;
      who.lastCap = Date.now();
      who.score += 3;
      l.teamScore[who.team] = (l.teamScore[who.team] || 0) + 1;
      broadcast(l, { t: 'cap', id: who.id, team: who.team });
      broadcast(l, snapshot(l));
      break;
    }
    case 'end': // Gastgeber beendet die Runde (Spiel ohne Zeitlimit ist vorbei)
      if (p.id === hostOf(l) && l.phase === 'runde') setPhase(l, 'ergebnis');
      break;
    case 'fill': // Gastgeber: Lobby mit Bots bis n Spieler auffüllen (0 = keine Bots)
      if (p.id !== hostOf(l)) return;
      l.fill = Math.max(0, Math.min(l.max, m.n | 0));
      if (l.phase !== 'runde') syncBots(l);
      broadcast(l, snapshot(l));
      break;
    case 'bs': // Gastgeber: Zustände aller Bots in einer Nachricht
      if (p.id !== hostOf(l) || l.phase !== 'runde' || !Array.isArray(m.d)) return;
      if (JSON.stringify(m.d).length > 1600) return;
      broadcast(l, { t: 'bs', d: m.d.filter((b) => b && l.bots.has(b.id)) }, p);
      break;
    case 'set': { // gemeinsamer Weltzustand: Truhe offen, Tür auf, Fahne getragen … – der Server entscheidet
      const k = String(m.k ?? '').slice(0, 32);
      if (!k || JSON.stringify(m.v ?? null).length > 200) return;
      if (m.v === null || m.v === undefined) { if (!m.claim && l.world.delete(k)) broadcast(l, { t: 'w', k, v: null, by: p.id }); return; } // nil löscht
      if (!l.world.has(k) && l.world.size >= 256) return;
      if (m.claim && l.world.has(k)) { p.conn.send({ t: 'denied', k, by: l.world.get(k).by }); return; } // „nur der Erste“
      l.world.set(k, { v: m.v, by: p.id });
      broadcast(l, { t: 'w', k, v: m.v, by: p.id });
      break;
    }
    case 'sets': { // mehrere Werte in einer Nachricht (Brettspiele): zählt wie eine Nachricht, höchstens 16 Schlüssel
      if (!m.kv || typeof m.kv !== 'object' || JSON.stringify(m.kv).length > 1800) return;
      for (const [k0, v] of Object.entries(m.kv).slice(0, 16)) {
        const k = String(k0).slice(0, 32);
        if (!k || JSON.stringify(v ?? null).length > 200) continue;
        if (v === null) { if (l.world.delete(k)) broadcast(l, { t: 'w', k, v: null, by: p.id }); continue; }
        if (!l.world.has(k) && l.world.size >= 256) continue;
        l.world.set(k, { v, by: p.id });
        broadcast(l, { t: 'w', k, v, by: p.id });
      }
      break;
    }
    case 'ping': p.conn.send({ t: 'pong', at: m.at }); break;
    default: break;
  }
}

// ------------------------------------------------------------------ Handy als Controller (Dock / TV-Modus)
// Der Fernseher öffnet einen Raum und bekommt einen kurzen Code (QR-Code auf dem Bildschirm). Handys treten mit dem
// Code bei und schicken nur ihre Tasten als Bitmaske; der Server reicht sie an den Fernseher weiter.
// Keine Namen, nichts gespeichert, der Raum endet mit dem Fernseher. Je Verbindung genau EIN Versuch mit einem Code
// (falscher Code = getrennt), jeder Versuch kostet die Rechenaufgabe, dazu Verbindungen je Adresse: Raten lohnt nicht.
const PAD_ALPHA = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';   // ohne 0/O, 1/I/L – gut abzutippen
const PAD_LEN = 6;                                       // 31^6 ≈ 890 Mio. Codes
const MAX_ROOMS = 200, MAX_PADS = 4;
const rooms = new Map();                                 // Code → { code, tv, pads: Map(id → p) }
function newCode() {
  for (;;) {
    let c = '';
    for (let i = 0; i < PAD_LEN; i++) c += PAD_ALPHA[crypto.randomInt(PAD_ALPHA.length)];
    if (!rooms.has(c)) return c;
  }
}
function closeRoom(room) {
  rooms.delete(room.code);
  for (const q of room.pads.values()) { q.conn.send({ t: 'tvweg' }); q.room = null; q.conn.close(1000); }
  room.pads.clear();
}
function leaveRoom(p) {
  const room = p.room;
  if (!room) return;
  p.room = null;
  if (p.role === 'tv') closeRoom(room);
  else if (room.pads.delete(p.id)) room.tv.conn.send({ t: 'padweg', id: p.id });
}
export const padRooms = () => rooms.size;
function handlePad(p, m) {
  if ((m.t === 'tv' || m.t === 'pad') && !p.lobby && !p.room) {
    if (!powOk(p.challenge, m.pow, POW_BITS)) { p.conn.send({ t: 'fehler', text: 'Handshake fehlgeschlagen.' }); p.conn.close(1008); return true; }
    if (m.t === 'tv') {
      if (rooms.size >= MAX_ROOMS) { p.conn.send({ t: 'fehler', text: 'Server ist gerade voll.' }); p.conn.close(1013); return true; }
      const room = { code: newCode(), tv: p, pads: new Map() };
      rooms.set(room.code, room);
      p.room = room; p.role = 'tv';
      p.conn.send({ t: 'tvroom', code: room.code });
      return true;
    }
    const code = String(m.code ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
    const room = rooms.get(code);
    if (!room) { p.conn.send({ t: 'fehler', text: 'Diesen Code gibt es nicht (mehr). Steht er noch auf dem Fernseher?' }); p.conn.close(1008); return true; }
    if (room.pads.size >= MAX_PADS) { p.conn.send({ t: 'fehler', text: `Es sind schon ${MAX_PADS} Handys verbunden.` }); p.conn.close(1013); return true; }
    room.pads.set(p.id, p);
    p.room = room; p.role = 'pad';
    p.conn.send({ t: 'padok' });
    room.tv.conn.send({ t: 'padjoin', id: p.id });
    return true;
  }
  if (!p.room) return false;
  const room = p.room;
  if (p.role === 'pad' && m.t === 'k') room.tv.conn.send({ t: 'k', id: p.id, b: (m.b | 0) & 0xfff });
  else if (p.role === 'tv' && m.t === 'pi') {  // Fernseher → Handy: Spielernummer, Konsole (welche Tasten), kurzer Text
    const q = room.pads.get(m.id | 0);
    if (q && JSON.stringify(m.d ?? null).length <= 200) q.conn.send({ t: 'pi', d: m.d });
  } else if (p.role === 'tv' && m.t === 'kick') room.pads.get(m.id | 0)?.conn.close(1000);
  else if (m.t === 'ping') p.conn.send({ t: 'pong', at: m.at });
  return true;
}

// ------------------------------------------------------------------ Geschenk-Kartridges: /g/<schlüssel>/<name>.8boy.png
// Jeder Link funktioniert höchstens GESCHENK_MAX-mal (Standard 4): genug zum Weitergeben, fürs Handy und einen
// zweiten Rechner. Beim letzten Abruf wird die Datei gelöscht; danach (und für unbekannte Schlüssel) 410.
// Der Zähler liegt in zaehler.json neben den Dateien und übersteht Neustarts. Keine IP-Adressen, kein Protokoll.
const GESCHENKE = process.env.GESCHENKE_DIR || '';
const MAX_ABRUFE = +process.env.GESCHENK_MAX || 4;
const zaehlerDatei = () => path.join(GESCHENKE, 'zaehler.json');
function zaehlerLesen() { try { return JSON.parse(fs.readFileSync(zaehlerDatei(), 'utf8')); } catch { return {}; } }
function zaehlerSchreiben(z) { fs.writeFileSync(zaehlerDatei() + '.neu', JSON.stringify(z)); fs.renameSync(zaehlerDatei() + '.neu', zaehlerDatei()); }
export function geschenk(req, res) {
  const head = { 'cache-control': 'no-store', 'x-robots-tag': 'noindex, nofollow', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer' };
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, head).end(); return; }
  const m = /^\/g\/([0-9a-f]{32})\/([a-z0-9-]+\.8boy\.png)$/.exec(req.url.split('?')[0]);
  if (!m || !GESCHENKE) { res.writeHead(404, head).end(); return; }
  const [, key, name] = m;
  const datei = path.join(GESCHENKE, key, name);
  // eigene Obergrenze je Link (Datei .max neben der Kartridge, z. B. 25 für ein Gremium), sonst GESCHENK_MAX
  let max = MAX_ABRUFE;
  try { max = Math.min(1000, Math.max(1, parseInt(fs.readFileSync(path.join(GESCHENKE, key, '.max'), 'utf8'), 10) || MAX_ABRUFE)); } catch { /* Standard */ }
  const z = zaehlerLesen();
  const n = z[key] || 0;
  if (n >= max || !fs.existsSync(datei)) {
    res.writeHead(410, { ...head, 'content-type': 'text/plain; charset=utf-8' }).end('Dieser Link ist abgelaufen.');
    return;
  }
  const data = fs.readFileSync(datei);
  let rest = max - n;
  if (req.method === 'GET') {          // nur echte Abrufe zählen, HEAD (Prüfen) nicht
    z[key] = n + 1;
    zaehlerSchreiben(z);
    rest = max - z[key];
    if (rest <= 0) fs.rmSync(path.join(GESCHENKE, key), { recursive: true, force: true });  // Quelldatei löschen
  }
  res.writeHead(200, { ...head, 'content-type': 'image/png', 'content-length': data.length, 'x-abrufe-uebrig': String(rest) });
  res.end(req.method === 'HEAD' ? undefined : data);
}

// ------------------------------------------------------------------ Server
export function startServer(port = PORT) {
  const server = http.createServer((req, res) => {
    if (req.url.startsWith('/g/')) return geschenk(req, res);
    if (req.url === '/mp/status') {
      const players = [...lobbies.values()].reduce((a, l) => a + l.players.size, 0);
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      return res.end(JSON.stringify({ lobbies: lobbies.size, players, tvs: rooms.size }));
    }
    res.writeHead(404).end();
  });
  server.on('upgrade', (req, socket) => {
    const origin = req.headers.origin || '';
    const ip = ((TRUST_PROXY && req.headers['x-forwarded-for']) || req.socket.remoteAddress || '').split(',')[0].trim();
    if (!req.url.startsWith('/mp') || !ORIGINS.some((r) => r.test(origin))) { socket.end('HTTP/1.1 403 Forbidden\r\n\r\n'); return; }
    if ((perIp.get(ip) || 0) >= MAX_PER_IP) { socket.end('HTTP/1.1 429 Too Many Requests\r\n\r\n'); return; }
    if (!accept(req, socket)) { socket.destroy(); return; }
    perIp.set(ip, (perIp.get(ip) || 0) + 1);
    const p = { id: nextId++, seen: Date.now(), lobby: null, rate: { s: 0, e: 0, other: 0 }, rateSec: 0, challenge: crypto.randomBytes(12).toString('hex') };
    p.conn = makeConn(socket, (txt) => handle(p, txt), () => {
      const n = (perIp.get(ip) || 1) - 1;
      if (n > 0) perIp.set(ip, n); else perIp.delete(ip);
      const l = p.lobby;
      if (l && l.players.delete(p.id)) broadcast(l, snapshot(l));
      leaveRoom(p);
    });
    p.conn.send({ t: 'challenge', c: p.challenge, bits: POW_BITS });
    // ohne gültigen Handshake wird die Verbindung nach kurzer Zeit getrennt
    setTimeout(() => { if (!p.lobby && !p.room) p.conn.close(1008); }, HELLO_MS);
  });
  const timer = setInterval(tick, 1000);
  server.on('close', () => clearInterval(timer));
  server.listen(port, () => console.log(`8BOY-Lobby lauscht auf Port ${server.address().port}`));
  return server;
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop())) startServer();
