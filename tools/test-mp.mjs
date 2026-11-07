// Mehrspieler-Lobby testen: node tools/test-mp.mjs
// Startet den Server auf einem freien Port und spielt mit simulierten Konsolen (eingebautes WebSocket von Node).
process.env.POW_BITS = '12';
const { startServer, cleanName } = await import('../server/lobby.mjs');
const { createNet, sha256 } = await import('../js/net.js');
import crypto from 'node:crypto';

let fails = 0;
const ok = (c, name, info = '') => { if (!c) fails++; console.log(`${c ? 'OK  ' : 'FEHL'} ${name} ${info}`); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 4000) { const t = Date.now(); while (Date.now() - t < ms) { if (fn()) return true; await wait(20); } return false; }

// SHA-256 gegen Node prüfen
const probe = new TextEncoder().encode('8boy:abc');
ok(Buffer.from(sha256(probe)).equals(crypto.createHash('sha256').update('8boy:abc').digest()), 'SHA-256 stimmt');
ok(cleanName('  Kai!!  ', 1) === 'Kai' && cleanName('F1ck3r', 2) === 'Spieler 2' && cleanName('', 3) === 'Spieler 3', 'Namensfilter');

const server = startServer(0);
await new Promise((r) => server.on('listening', r));
const url = `ws://localhost:${server.address().port}/mp`;
class WSO extends WebSocket { constructor(u) { super(u, { headers: { origin: 'http://localhost:8080' } }); } }

// ohne Handshake: Server trennt
const raw = new WSO(url);
let closed = false;
raw.onopen = () => raw.send(JSON.stringify({ t: 'hello', game: 'test', name: 'Bot' }));
raw.onclose = () => { closed = true; };
ok(await until(() => closed), 'ohne Handshake getrennt');

// falsche Herkunft: abgelehnt
const evil = new WebSocket(url, { headers: { origin: 'https://boese.example' } });
let evilErr = false; evil.onerror = () => { evilErr = true; }; evil.onclose = () => { evilErr = true; };
ok(await until(() => evilErr), 'fremde Herkunft abgelehnt');

const modes = [{ id: 'ffa', name: 'Jeder gegen Jeden' }, { id: 'duo', name: 'Duo', min: 4 }, { id: 'ctf', name: 'Capture the Flag', min: 2 }];
const A = createNet({ url, WS: WSO }), B = createNet({ url, WS: WSO });
A.join('wasserschlacht', 'Anna', 2, modes, 30);
ok(await until(() => A.status === 'lobby'), 'Anna in der Lobby', A.error);
B.join('wasserschlacht', 'Ben', 5, modes, 30);
ok(await until(() => B.status === 'lobby' && A.lobby?.players.length === 2), 'Ben in der Lobby, beide sehen 2 Spieler');
ok(await until(() => A.lobby?.phase === 'abstimmung', 3000), 'Abstimmung startet ab 2 Spielern');
ok(A.lobby.modes.map((m) => m.id).join() === 'ffa,ctf', 'Duo erst ab 4 Spielern wählbar', A.lobby.modes.map((m) => m.id).join());
A.vote('ctf'); B.vote('ctf');
ok(await until(() => B.lobby?.votes?.ctf === 2), 'Stimmen kommen an');

// Abstimmung abkürzen: Server-Zeit vorspulen geht nicht – wir warten die 15 s ab
ok(await until(() => A.lobby?.phase === 'runde', 17000), 'Runde startet mit gewähltem Modus', A.lobby?.mode);
ok(A.lobby.mode === 'ctf', 'Modus ist Capture the Flag');
const pa = A.lobby.players.find((p) => p.id === A.me), pb = A.lobby.players.find((p) => p.id === B.me);
ok(pa.team && pb.team && pa.team !== pb.team, 'zwei Teams verteilt');

// Zustand
A.send({ x: 3, y: 4 });
ok(await until(() => B.state(A.me)?.x === 3), 'Position kommt beim anderen an');
// Treffer: Ben meldet, dass Anna ihn getroffen hat
B.hit(A.me);
ok(await until(() => A.lobby.players.find((p) => p.id === A.me).score === 1), 'Treffer zählt für Anna');
A.hit(A.me);
await wait(200);
ok(A.lobby.players.find((p) => p.id === A.me).score === 1, 'sich selbst treffen zählt nicht');
// gemeinsame Welt: Truhe
A.claim('truhe1', 'offen');
ok(await until(() => B.get('truhe1')?.v === 'offen' && B.get('truhe1').by === A.me), 'Bens Welt: Truhe von Anna geöffnet');
await wait(80);
B.claim('truhe1', 'offen');
ok(await until(() => B.events().some((e) => e.t === 'denied')), 'zweites Öffnen abgelehnt (nur der Erste)');
// später Kommende sehen den Weltzustand
const C = createNet({ url, WS: WSO });
C.join('wasserschlacht', 'Cleo', 1, modes, 30);
ok(await until(() => C.status === 'lobby'), 'Cleo kommt dazu');
ok(C.get('truhe1')?.v === 'offen', 'Cleo sieht die offene Truhe');
ok(C.lobby?.players.find((p) => p.id === C.me)?.team > 0, 'Cleo bekommt ein Team');
// Ping
C.ping(); await until(() => C.ping() >= 0);
ok(C.ping() >= 0, 'Ping', C.ping() + ' ms');
// Verlassen
C.leave();
ok(await until(() => A.lobby.players.length === 2), 'Cleo verlässt, Liste aktualisiert');
// zweite Lobby für anderes Spiel ist getrennt
const D = createNet({ url, WS: WSO });
D.join('anderes-spiel', 'Dora', 0);
ok(await until(() => D.status === 'lobby' && D.lobby?.players.length === 1), 'eigene Lobby je Spiel');
// Bots: Dora ist allein und füllt auf 4 auf
D.fill(4);
ok(await until(() => D.lobby?.players.filter((p) => p.bot).length === 3), 'Gastgeberin füllt mit 3 Bots auf');
ok(D.host, 'Dora ist Gastgeberin');
ok(await until(() => D.lobby?.phase === 'abstimmung'), 'Abstimmung auch mit nur einem Menschen');
ok(D.lobby.modes.some((m) => m.id === 'ffa'), 'Modi zählen Bots mit');
const E = createNet({ url, WS: WSO });
E.join('anderes-spiel', 'Emil', 3);
ok(await until(() => E.status === 'lobby' && E.lobby?.players.filter((p) => p.bot).length === 2), 'neuer Mensch verdrängt einen Bot');
ok(!E.host, 'Emil ist nicht Gastgeber');
E.fill(16);
await wait(300);
ok(D.lobby.fill === 4, 'nur der Gastgeber darf auffüllen');
A.leave(); B.leave(); D.leave(); E.leave();
await wait(200);
// Ereignis an einen einzelnen Spieler, mehrere Werte auf einmal, Löschen
{
  const X = createNet({ url, WS: WSO }), Y = createNet({ url, WS: WSO }), Z = createNet({ url, WS: WSO });
  for (const [n, nm] of [[X, 'Xa'], [Y, 'Yo'], [Z, 'Zu']]) { n.join('extra', nm, 0); await until(() => n.status === 'lobby'); }
  await until(() => X.lobby?.players.length === 3);
  X.event({ geheim: 1 }, Y.me);
  await wait(300);
  const ye = Y.events(), ze = Z.events();
  ok(ye.some((e) => e.d?.geheim === 1) && !ze.some((e) => e.d?.geheim === 1), 'Ereignis nur an einen Spieler');
  X.setMany({ a: 1, b: 'zwei', c: true });
  ok(await until(() => Z.get('a')?.v === 1 && Z.get('b')?.v === 'zwei' && Z.get('c')?.v === true), 'mehrere Werte auf einmal');
  X.set('b', null);
  ok(await until(() => Z.get('b') === undefined), 'Wert löschen');
  X.leave(); Y.leave(); Z.leave();
  await wait(200);
}
// Brettspiel: 2 Spieler, ohne Zeitlimit, nur ein Modus
const chess = [{ id: 'partie', name: 'Partie' }];
const S1 = createNet({ url, WS: WSO }), S2 = createNet({ url, WS: WSO }), S3 = createNet({ url, WS: WSO });
S1.join('schach', 'Weiß', 0, chess, 0, 2);
await until(() => S1.status === 'lobby');
S2.join('schach', 'Schwarz', 1, chess, 0, 2);
ok(await until(() => S2.status === 'lobby'), 'Schach: zweiter Spieler');
S3.join('schach', 'Dritter', 2, chess, 0, 2);
ok(await until(() => S3.status === 'fehler' || S3.status === 'getrennt') && /voll/.test(S3.error), 'Schach: Dritter abgewiesen', S3.error);
ok(await until(() => S1.lobby?.phase === 'runde', 6000), 'nur ein Modus: Runde startet nach kurzer Pause');
await wait(1200);
ok(S1.lobby.phase === 'runde' && S1.lobby.left === 0, 'Runde ohne Zeitlimit läuft weiter');
S2.finish(); await wait(300);
ok(S1.lobby.phase === 'runde', 'nur der Gastgeber beendet');
S1.finish();
ok(await until(() => S2.lobby?.phase === 'ergebnis'), 'Gastgeber beendet die Partie');
S1.leave(); S2.leave();
server.close();
console.log(fails ? `${fails} Prüfungen fehlgeschlagen` : 'alle Mehrspieler-Prüfungen bestanden');
process.exit(fails ? 1 : 0);
