// Handy als Controller: Verbindung über die 8BOY-Lobby (server/lobby.mjs, Adresse wie in js/net.js).
//   Fernseher: host = createPadHost(); host.open() → Code für den QR-Code; Tasten der Handys kommen über onKeys an.
//   Handy:     pad = createPadClient(code); pad.send(maske) bei jeder Änderung.
// Übertragen werden nur Tasten als Bitmaske (12 Bit) und vom Fernseher die Spielernummer – keine Namen.
import { solvePow, lobbyUrl } from './net.js';

const KEEPALIVE_MS = 10000;   // Server trennt nach 45 s Stille

function connect(url, WS, onMsg, onClose) {
  const ws = new WS(url);
  ws.onmessage = (ev) => { let m; try { m = JSON.parse(ev.data); } catch { return; } onMsg(m); };
  ws.onclose = () => onClose();
  ws.onerror = () => {};
  return ws;
}

export function createPadHost({ url = null, WS = globalThis.WebSocket, onJoin = () => {}, onLeave = () => {}, onKeys = () => {}, onStatus = () => {} } = {}) {
  let ws = null, code = '', status = 'aus', error = '', timer = null, ping = -1;
  const pads = new Set();
  const setStatus = (s) => { status = s; onStatus(s); };

  function open() {
    if (ws) return;
    if (!WS) { error = 'Dieser Browser kann kein WebSocket.'; setStatus('fehler'); return; }
    error = ''; setStatus('verbinde');
    try {
      const sock = connect(url || lobbyUrl(), WS, (m) => {
        if (ws !== sock) return;
        if (m.t === 'challenge') sock.send(JSON.stringify({ t: 'tv', pow: solvePow(m.c, m.bits) }));
        else if (m.t === 'tvroom') { code = m.code; setStatus('bereit'); }
        else if (m.t === 'padjoin') { pads.add(m.id); onJoin(m.id); }
        else if (m.t === 'padweg') { pads.delete(m.id); onLeave(m.id); }
        else if (m.t === 'k') onKeys(m.id, m.b);
        else if (m.t === 'pong') ping = Date.now() - m.at;
        else if (m.t === 'fehler') error = m.text;
      }, () => {
        if (ws !== sock) return;
        for (const id of pads) onLeave(id);
        pads.clear(); ws = null; code = '';
        clearInterval(timer);
        setStatus(error ? 'fehler' : 'getrennt');
      });
      ws = sock;
      timer = setInterval(() => raw({ t: 'ping', at: Date.now() }), KEEPALIVE_MS);
    } catch { error = 'Keine Verbindung möglich.'; setStatus('fehler'); }
  }
  function close() {
    const sock = ws;
    ws = null; code = '';
    clearInterval(timer);
    for (const id of pads) onLeave(id);
    pads.clear();
    if (sock) { try { sock.close(); } catch { /* egal */ } }
    setStatus('aus');
  }
  function raw(obj) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj)); }

  return {
    open, close,
    info: (id, d) => raw({ t: 'pi', id, d }),          // dem Handy sagen: Spieler n, Konsole …
    kick: (id) => raw({ t: 'kick', id }),
    get code() { return code; }, get status() { return status; }, get error() { return error; },
    get pads() { return [...pads]; }, get ping() { return ping; },
  };
}

export function createPadClient(code, { url = null, WS = globalThis.WebSocket, onInfo = () => {}, onStatus = () => {} } = {}) {
  let ws = null, status = 'verbinde', error = '', last = -1, timer = null, ping = -1;
  const setStatus = (s) => { status = s; onStatus(s, error); };
  try {
    const sock = connect(url || lobbyUrl(), WS, (m) => {
      if (m.t === 'challenge') sock.send(JSON.stringify({ t: 'pad', code, pow: solvePow(m.c, m.bits) }));
      else if (m.t === 'padok') { setStatus('verbunden'); if (last >= 0) sock.send(JSON.stringify({ t: 'k', b: last })); }
      else if (m.t === 'pi') onInfo(m.d || {});
      else if (m.t === 'pong') ping = Date.now() - m.at;
      else if (m.t === 'tvweg') { error = 'Der Fernseher hat den Raum geschlossen.'; }
      else if (m.t === 'fehler') error = m.text;
    }, () => { clearInterval(timer); ws = null; setStatus(error ? 'fehler' : 'getrennt'); });
    ws = sock;
    // Lebenszeichen, damit der Server die Verbindung nicht als verwaist trennt
    timer = setInterval(() => { if (ws?.readyState === 1) ws.send(JSON.stringify({ t: 'ping', at: Date.now() })); }, KEEPALIVE_MS);
  } catch { error = 'Keine Verbindung möglich.'; setStatus('fehler'); }

  return {
    // nur bei Änderung senden
    send(mask) {
      mask &= 0xfff;
      if (mask === last) return;
      last = mask;
      if (ws?.readyState === 1 && status === 'verbunden') ws.send(JSON.stringify({ t: 'k', b: mask }));
    },
    close() { clearInterval(timer); if (ws) { try { ws.close(); } catch { /* egal */ } } ws = null; },
    get status() { return status; }, get error() { return error; }, get ping() { return ping; },
  };
}
