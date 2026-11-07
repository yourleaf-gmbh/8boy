// Baukasten-Katalog: alle Objektarten, Auslöser („Wenn …“), Bedingungen („und …“) und Aktionen („dann …“).
// Jeder Eintrag beschreibt sich selbst dreifach: als Satz mit Lücken für die Oberfläche ({name} = Eingabefeld),
// als Klartext für Kommentare und als Lua-Code für die Kartridge.

// ------------------------------------------------------------------ Lua-Hilfen
export const luaStr = (s) => '"' + String(s ?? '').replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\r?\n/g, '\\n') + '"';
const LUA_WORDS = new Set('and break do else elseif end false for function goto if in local nil not or repeat return then true until while'.split(' '));
export function ident(s, fallback = 'wert') {
  const id = String(s || '').toLowerCase()
    .replace(/[äöüß]/g, (c) => ({ ä: 'ae', ö: 'oe', ü: 'ue', ß: 'ss' }[c]))
    .replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '');
  if (!id) return fallback;
  if (LUA_WORDS.has(id)) return id + '_';
  return /^[0-9]/.test(id) ? fallback + '_' + id : id;
}
// Zeilen umbrechen (für Dialogfenster): höchstens cols Zeichen je Zeile
export function wrapText(text, cols) {
  const out = [];
  for (const para of String(text || '').split(/\r?\n/)) {
    let line = '';
    for (const word of para.split(/\s+/).filter(Boolean)) {
      if (!line) line = word;
      else if ((line + ' ' + word).length <= cols) line += ' ' + word;
      else { out.push(line); line = word; }
      while (line.length > cols) { out.push(line.slice(0, cols)); line = line.slice(cols); }
    }
    out.push(line);
  }
  return out;
}
const num = (v, d = 0) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
const luaNum = (v, d = 0) => String(Math.round(num(v, d) * 1000) / 1000);

// ------------------------------------------------------------------ Objektarten
export const OBJECT_TYPES = {
  spieler: { label: 'Spieler', sprite: 'Held', help: 'Die Figur, die man steuert. In der Startszene beginnt hier das Spiel, in anderen Szenen ist es der Ankunftsort.', props: { steuerbar: true, tempo: 1, schwerkraft: true } },
  gegner: { label: 'Gegner', sprite: 'Schleim', help: 'Bewegt sich von selbst. Was beim Berühren passiert, legst du mit einer Regel fest.', props: { hinundher: 'waagerecht', tempo: 0.5, schwerkraft: true } },
  sammel: { label: 'Sammelgegenstand', sprite: 'Münze', help: 'Münze, Schlüssel, Herz … Eine Regel sagt, was beim Einsammeln passiert.', props: {} },
  tuer: { label: 'Tür / Ausgang', sprite: 'Tür', help: 'Führt in eine andere Szene. Verschlossen ist sie fest, bis eine Regel sie öffnet.', props: { ziel: '', ankunft: '', verschlossen: false } },
  figur: { label: 'Figur zum Sprechen', sprite: 'Oma', help: 'Vor der Figur Taste drücken: Ihr Dialog startet.', props: { fest: true, dialog: '' } },
  schild: { label: 'Schild', sprite: 'Schild', help: 'Vor dem Schild Taste drücken: Der Text erscheint.', props: { fest: true, text: 'Hier könnte ein Hinweis stehen.' } },
  schalter: { label: 'Schalter', sprite: 'Schalter', help: 'Vor dem Schalter Taste drücken legt ihn um (an/aus).', props: { an: false, bild_an: 0 } },
  deko: { label: 'Hindernis / Deko', sprite: 'Kiste', help: 'Ein Ding in der Welt: Kiste, Stein, Fass … fest oder zum Durchlaufen.', props: { fest: true } },
};
export const TYPE_ORDER = ['spieler', 'gegner', 'sammel', 'tuer', 'figur', 'schild', 'schalter', 'deko'];

// Eigenschaften zum Ankreuzen (für alle Objektarten)
export const PROPS = [
  { key: 'fest', label: 'fest', help: 'Niemand kann hindurchgehen.' },
  { key: 'steuerbar', label: 'steuerbar', help: 'Bewegt sich mit dem Steuerkreuz.' },
  { key: 'verfolgt', label: 'verfolgt den Spieler', help: 'Läuft auf den Spieler zu, wenn er näher als 10 Kacheln ist.' },
  { key: 'schwerkraft', label: 'fällt nach unten', help: 'Nur im Jump\'n\'Run: Schwerkraft zieht nach unten.', side: true },
  { key: 'versteckt', label: 'am Anfang unsichtbar', help: 'Erscheint erst, wenn eine Regel es zeigt.' },
];
export const PATROL = [['', 'steht still'], ['waagerecht', 'hin und her (waagerecht)'], ['senkrecht', 'hoch und runter (senkrecht)']];

// ------------------------------------------------------------------ Auswahllisten
export const KEYS = [['A', 'A'], ['B', 'B'], ['UP', '↑ oben'], ['DOWN', '↓ unten'], ['LEFT', '← links'], ['RIGHT', '→ rechts'], ['START', 'MENÜ'], ['SELECT', 'OPTION']];   // Werte bleiben START/SELECT (gespeicherte Projekte), Lua kennt beide Namen
export const OPS = [['>=', 'mindestens'], ['<=', 'höchstens'], ['==', 'genau'], ['>', 'mehr als'], ['<', 'weniger als'], ['~=', 'nicht']];
const opText = (op) => (OPS.find((o) => o[0] === op) || OPS[0])[1];

// ------------------------------------------------------------------ Auslöser
// hook: in welche Lua-Funktion die Regel kommt. test: Bedingung des Auslösers (n = Regelnummer).
// obj: Der Auslöser kennt ein Objekt (das berührte / angesprochene) – Aktionen dürfen „das Objekt“ benutzen.
export const TRIGGERS = [
  { id: 'start', group: 'Spiel', label: 'Das Spiel startet', s: 'das Spiel startet', params: [], hook: 'start' },
  { id: 'scene_enter', group: 'Spiel', label: 'Szene betreten', s: 'der Spieler die Szene {scene} betritt', params: [{ k: 'scene', t: 'scene' }], hook: 'scene',
    test: (p, c) => `szene_name == ${luaStr(c.sceneName(p.scene))}` },
  { id: 'key', group: 'Spieler', label: 'Taste gedrückt', s: 'die Taste {key} gedrückt wird', params: [{ k: 'key', t: 'key', d: 'B' }], hook: 'frame',
    test: (p) => `btnp(${p.key || 'B'})` },
  { id: 'touch', group: 'Spieler', label: 'Spieler berührt …', s: 'der Spieler {what} berührt', params: [{ k: 'what', t: 'target' }], hook: 'touch', obj: true,
    test: (p, c) => c.targetTest(p.what) },
  { id: 'talk', group: 'Spieler', label: 'Spieler spricht mit …', s: 'der Spieler mit {what} spricht', params: [{ k: 'what', t: 'target' }], hook: 'talk', obj: true,
    test: (p, c) => c.targetTest(p.what) },
  { id: 'switch', group: 'Spieler', label: 'Schalter umgelegt', s: 'der Schalter {what} auf {state} gestellt wird', params: [{ k: 'what', t: 'target', d: 'art:schalter' }, { k: 'state', t: 'onoff', d: 'an' }], hook: 'switch', obj: true,
    test: (p, c) => `${c.targetTest(p.what)} and ${p.state === 'aus' ? 'not ' : ''}obj.an` },
  { id: 'tile', group: 'Spieler', label: 'Spieler steht auf Kachel', s: 'der Spieler auf die Kachel {tile} tritt', params: [{ k: 'tile', t: 'tile' }], hook: 'frame', edge: true,
    test: (p) => `steht_auf(${num(p.tile)})` },
  { id: 'counter', group: 'Zähler & Zeit', label: 'Zähler erreicht Wert', s: '{counter} {op} {value} ist', params: [{ k: 'counter', t: 'counter' }, { k: 'op', t: 'op', d: '>=' }, { k: 'value', t: 'number', d: 5 }], hook: 'frame', edge: true,
    test: (p, c) => `zaehler.${c.counterKey(p.counter)} ${p.op || '>='} ${luaNum(p.value)}` },
  { id: 'timer_once', group: 'Zähler & Zeit', label: 'Zeit vergangen', s: '{sec} Sekunden in der Szene vergangen sind', params: [{ k: 'sec', t: 'number', d: 10 }], hook: 'frame', edge: true,
    test: (p) => `szenen_zeit >= ${luaNum(p.sec, 10)}` },
  { id: 'timer_every', group: 'Zähler & Zeit', label: 'Immer wieder nach … Sekunden', s: 'wieder {sec} Sekunden um sind', params: [{ k: 'sec', t: 'number', d: 5 }], hook: 'frame',
    test: (p) => `alle(${luaNum(Math.max(0.1, num(p.sec, 5)))})` },
  { id: 'all_gone', group: 'Zähler & Zeit', label: 'Alle … sind weg', s: 'in {scene} {what} weg sind', params: [{ k: 'scene', t: 'scene' }, { k: 'what', t: 'target', d: 'art:sammel', noThis: true, plural: true }], hook: 'frame', edge: true,
    test: (p, c) => `szene_name == ${luaStr(c.sceneName(p.scene))} and anzahl(${c.targetArgs(p.what)}) == 0` },
  { id: 'dialog_end', group: 'Dialoge', label: 'Dialog beendet', s: 'der Dialog {dialog} zu Ende ist', params: [{ k: 'dialog', t: 'dialog' }], hook: 'dialog',
    test: (p, c) => `name == ${luaStr(c.dialogName(p.dialog))}` },
  { id: 'choice', group: 'Dialoge', label: 'Antwort gewählt', s: 'im Dialog {dialog} die Antwort {choice} gewählt wird', params: [{ k: 'dialog', t: 'dialog' }, { k: 'choice', t: 'choice' }], hook: 'choice',
    test: (p, c) => { const ch = c.choiceRef(p.dialog, p.choice); return `name == ${luaStr(c.dialogName(p.dialog))} and karte == ${ch.card} and antwort == ${ch.nr}`; } },
  { id: 'always', group: 'Zähler & Zeit', label: 'Immer (jedes Bild)', s: 'gerade ein Bild gemalt wird (60× pro Sekunde)', params: [], hook: 'frame' },
];

// ------------------------------------------------------------------ Bedingungen („und …“)
export const CONDITIONS = [
  { id: 'counter', label: 'Zähler vergleichen', s: '{counter} {op} {value} ist', params: [{ k: 'counter', t: 'counter' }, { k: 'op', t: 'op', d: '>' }, { k: 'value', t: 'number', d: 0 }],
    lua: (p, c) => `zaehler.${c.counterKey(p.counter)} ${p.op || '>'} ${luaNum(p.value)}` },
  { id: 'switch', label: 'Schalter ist an/aus', s: 'der Schalter {what} {state} ist', params: [{ k: 'what', t: 'name', d: '' }, { k: 'state', t: 'onoff', d: 'an' }],
    lua: (p) => `${p.state === 'aus' ? 'not ' : ''}ist_an(${luaStr(p.what)})` },
  { id: 'scene', label: 'in Szene', s: 'der Spieler in {scene} ist', params: [{ k: 'scene', t: 'scene' }],
    lua: (p, c) => `szene_name == ${luaStr(c.sceneName(p.scene))}` },
  { id: 'exists', label: 'Objekt ist noch da', s: '{what} noch da ist', params: [{ k: 'what', t: 'name' }],
    lua: (p) => `noch_da(${luaStr(p.what)})` },
  { id: 'unprotected', label: 'Spieler nicht geschützt', s: 'der Spieler gerade nicht geschützt ist', params: [],
    lua: () => 'not geschuetzt()' },
  { id: 'stomp', label: 'Spieler kommt von oben', s: 'der Spieler von oben auf das Objekt springt', params: [], needsObj: true,
    lua: () => 'von_oben(obj)' },
  { id: 'chance', label: 'Zufall', s: 'der Zufall es will ({pct} %)', params: [{ k: 'pct', t: 'number', d: 50 }],
    lua: (p) => `rnd(100) < ${luaNum(p.pct, 50)}` },
];

// ------------------------------------------------------------------ Aktionen („dann …“)
// lua(p, c) liefert eine oder mehrere Codezeilen.
const objArg = (p, c) => c.objArg(p.what);
export const ACTIONS = [
  { id: 'hide', group: 'Objekte', label: 'Objekt verschwinden lassen', s: '{what} verschwindet', params: [{ k: 'what', t: 'objsel', d: 'this' }],
    lua: (p, c) => `verschwinden(${objArg(p, c)})` },
  { id: 'show', group: 'Objekte', label: 'Objekt erscheinen lassen', s: '{what} erscheint', params: [{ k: 'what', t: 'name' }],
    lua: (p) => `erscheinen(${luaStr(p.what)})` },
  { id: 'open_door', group: 'Objekte', label: 'Tür öffnen', s: '{what} geht auf', params: [{ k: 'what', t: 'objsel', d: 'this', thisText: 'die Tür' }],
    lua: (p, c) => `tuer_oeffnen(${objArg(p, c)})` },
  { id: 'toggle_switch', group: 'Objekte', label: 'Schalter umlegen', s: '{what} wird umgelegt', params: [{ k: 'what', t: 'objsel', d: 'this', thisText: 'der Schalter' }],
    lua: (p, c) => `schalter_umlegen(${objArg(p, c)})` },
  { id: 'set_sprite', group: 'Objekte', label: 'Bild eines Objekts ändern', s: '{what} bekommt das Bild {sprite}', params: [{ k: 'what', t: 'objsel', d: 'this' }, { k: 'sprite', t: 'sprite' }],
    lua: (p, c) => `bild_setzen(${objArg(p, c)}, ${num(p.sprite)})${c.spriteComment(p.sprite)}` },
  { id: 'set_tile', group: 'Objekte', label: 'Kachel setzen', s: 'an Stelle {x} | {y} wird die Kachel {tile} gelegt', params: [{ k: 'x', t: 'number', d: 0 }, { k: 'y', t: 'number', d: 0 }, { k: 'tile', t: 'tile' }],
    lua: (p, c) => `kachel_setzen(${luaNum(p.x)}, ${luaNum(p.y)}, ${num(p.tile)})${c.spriteComment(p.tile)}` },

  { id: 'counter_add', group: 'Zähler', label: 'Zähler ändern (+/−)', s: '{counter} {sign} {value}', params: [{ k: 'counter', t: 'counter' }, { k: 'sign', t: 'sign', d: '+' }, { k: 'value', t: 'number', d: 1 }],
    lua: (p, c) => { const k = c.counterKey(p.counter); return `zaehler.${k} = zaehler.${k} ${p.sign === '-' ? '-' : '+'} ${luaNum(p.value, 1)}`; } },
  { id: 'counter_set', group: 'Zähler', label: 'Zähler setzen', s: '{counter} wird auf {value} gesetzt', params: [{ k: 'counter', t: 'counter' }, { k: 'value', t: 'number', d: 0 }],
    lua: (p, c) => `zaehler.${c.counterKey(p.counter)} = ${luaNum(p.value)}` },

  { id: 'sfx', group: 'Klang', label: 'Klang spielen', s: 'der Klang {sound} spielt', params: [{ k: 'sound', t: 'sound', d: 'coin' }],
    lua: (p, c) => `sfx(${c.soundArg(p.sound)})` },
  { id: 'music', group: 'Klang', label: 'Musik wechseln', s: 'die Musik {music} läuft', params: [{ k: 'music', t: 'music' }],
    lua: (p, c) => `musik(${luaStr(c.musicKey(p.music))})` },
  { id: 'music_stop', group: 'Klang', label: 'Musik anhalten', s: 'die Musik hört auf', params: [],
    lua: () => 'musik(nil)' },

  { id: 'goto_scene', group: 'Szenen', label: 'Szene wechseln', s: 'es geht in die Szene {scene} ({arrive})', params: [{ k: 'scene', t: 'scene' }, { k: 'arrive', t: 'arrive', d: '' }],
    lua: (p, c) => `szene_wechseln(${luaStr(c.sceneName(p.scene))}${p.arrive ? ', ' + luaStr(p.arrive) : ''})` },
  { id: 'respawn', group: 'Szenen', label: 'Spieler zurück zum Start', s: 'der Spieler geht zurück an den Start der Szene', params: [],
    lua: () => 'zurueck_zum_start()' },
  { id: 'teleport', group: 'Szenen', label: 'Spieler teleportieren', s: 'der Spieler springt nach {x} | {y}', params: [{ k: 'x', t: 'number', d: 1 }, { k: 'y', t: 'number', d: 1 }],
    lua: (p) => `teleport(${luaNum(p.x)}, ${luaNum(p.y)})` },

  { id: 'dialog', group: 'Text & Dialog', label: 'Dialog starten', s: 'der Dialog {dialog} beginnt', params: [{ k: 'dialog', t: 'dialog' }],
    lua: (p, c) => `dialog_starten(${luaStr(c.dialogName(p.dialog))})` },
  { id: 'text', group: 'Text & Dialog', label: 'Text anzeigen', s: 'oben steht {text} für {sec} Sekunden', params: [{ k: 'text', t: 'text', d: 'Gut gemacht!' }, { k: 'sec', t: 'number', d: 2 }],
    lua: (p) => `meldung(${luaStr(p.text)}, ${luaNum(p.sec, 2)})` },
  { id: 'textbox', group: 'Text & Dialog', label: 'Textfenster zeigen', s: 'ein Textfenster zeigt {text}', params: [{ k: 'text', t: 'text', d: 'Hallo!' }],
    lua: (p) => `text_zeigen(${luaStr(wrapText(p.text, 37).join('\n'))})` },

  { id: 'pushback', group: 'Spieler', label: 'Spieler zurückstoßen', s: 'der Spieler wird von {what} weggestoßen', params: [{ k: 'what', t: 'objsel', d: 'this', thisText: 'dem Objekt' }],
    lua: (p, c) => `zurueckstossen(${objArg(p, c)})` },
  { id: 'bounce', group: 'Spieler', label: 'Spieler hüpft hoch', s: 'der Spieler federt nach oben', params: [],
    lua: () => 'abprallen()' },
  { id: 'protect', group: 'Spieler', label: 'Spieler kurz geschützt', s: 'der Spieler blinkt {sec} Sekunden und ist geschützt', params: [{ k: 'sec', t: 'number', d: 1.5 }],
    lua: (p) => `schuetzen(${luaNum(p.sec, 1.5)})` },
  { id: 'speed', group: 'Spieler', label: 'Spieler-Tempo setzen', s: 'der Spieler läuft mit Tempo {value}', params: [{ k: 'value', t: 'number', d: 2 }],
    lua: (p) => `spieler.tempo = ${luaNum(p.value, 1)}` },

  { id: 'shake', group: 'Effekte', label: 'Bildschirm wackeln', s: 'der Bildschirm wackelt {sec} Sekunden', params: [{ k: 'sec', t: 'number', d: 0.4 }],
    lua: (p) => `wackeln(${luaNum(p.sec, 0.4)})` },
  { id: 'flash', group: 'Effekte', label: 'Bildschirm blitzt', s: 'der Bildschirm blitzt in {color} auf', params: [{ k: 'color', t: 'color', d: 7 }],
    lua: (p) => `blitz(${num(p.color, 7) & 31})` },

  { id: 'win', group: 'Spielende', label: 'Spiel gewonnen', s: 'das Spiel ist gewonnen: {text}', params: [{ k: 'text', t: 'text', d: 'Geschafft!' }],
    lua: (p) => `gewinnen(${luaStr(p.text)})` },
  { id: 'lose', group: 'Spielende', label: 'Spiel verloren', s: 'das Spiel ist verloren: {text}', params: [{ k: 'text', t: 'text', d: 'Schade!' }],
    lua: (p) => `verlieren(${luaStr(p.text)})` },
];

export const byId = (list, id) => list.find((e) => e.id === id);
export const ACTION_GROUPS = [...new Set(ACTIONS.map((a) => a.group))];
export const TRIGGER_GROUPS = [...new Set(TRIGGERS.map((a) => a.group))];
export { opText };

// Standardwerte für ein neues Regel-Teil
export function defaultParams(def, project, { obj = true } = {}) {
  const p = {};
  for (const prm of def.params) {
    let v = prm.d;
    if (v === undefined) {
      if (prm.t === 'scene') v = project.scenes[0]?.id || '';
      else if (prm.t === 'counter') v = project.counters[0]?.id || '';
      else if (prm.t === 'dialog') v = project.dialogs[0]?.id || '';
      else if (prm.t === 'music') v = project.music[0]?.id || '';
      else if (prm.t === 'tile' || prm.t === 'sprite') v = (project.sprites.find((s) => (prm.t === 'tile') === (s.kind === 'tile')) || project.sprites[0])?.n || 0;
      else if (prm.t === 'target') v = 'art:sammel';
      else if (prm.t === 'choice') { const c = project.dialogs.find((d) => d.id === p.dialog)?.cards.find((k) => k.choices.length); v = c ? c.id + ':0' : ''; }
      else if (prm.t === 'name') v = firstName(project);
      else v = '';
    }
    if (prm.t === 'objsel' && v === 'this' && !obj) v = firstName(project) ? 'name:' + firstName(project) : 'this';
    p[prm.k] = v;
  }
  return p;
}
const firstName = (project) => project.scenes.flatMap((s) => s.objects).find((o) => o.type !== 'spieler')?.name || '';
