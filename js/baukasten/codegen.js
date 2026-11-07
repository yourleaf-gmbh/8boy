// Baukasten → Lua: macht aus einem Projekt eine ganz normale, gut lesbare 8BOY-Kartridge.
// Zu jeder Regel merkt sich der Generator, in welchen Zeilen ihr Code steht (für „Code ansehen“).
import { TRIGGERS, CONDITIONS, ACTIONS, OBJECT_TYPES, KEYS, OPS, byId, luaStr, ident, wrapText } from './catalog.js';
export { wrapText };
import { BUILTIN_SFX } from './templates.js';

// ------------------------------------------------------------------ Nachschlagen und Beschreiben
const ARTICLE = { spieler: 'den Spieler', gegner: 'einen Gegner', sammel: 'einen Sammelgegenstand', tuer: 'eine Tür', figur: 'eine Figur', schild: 'ein Schild', schalter: 'einen Schalter', deko: 'ein Hindernis' };
export const PLURAL = { spieler: 'alle Spieler', gegner: 'alle Gegner', sammel: 'alle Sammelgegenstände', tuer: 'alle Türen', figur: 'alle Figuren', schild: 'alle Schilder', schalter: 'alle Schalter', deko: 'alle Hindernisse' };
const q = (s) => `„${s}“`;

export const DIALOG_COLS = { portrait: 33, plain: 37 };
export const DIALOG_LINES = 4;

export function makeContext(project) {
  const scene = (id) => project.scenes.find((s) => s.id === id);
  const counterOf = (id) => project.counters.find((c) => c.id === id);
  const dialogOf = (id) => project.dialogs.find((d) => d.id === id);
  const spriteOf = (n) => project.sprites.find((s) => s.n === +n);
  const keys = new Map();
  for (const c of project.counters) {
    let k = ident(c.name, 'zaehler'), i = 2;
    while ([...keys.values()].includes(k)) k = ident(c.name, 'zaehler') + '_' + i++;
    keys.set(c.id, k);
  }
  const musicKeys = new Map();
  for (const m of project.music) {
    let k = ident(m.name, 'musik'), i = 2;
    while ([...musicKeys.values()].includes(k)) k = ident(m.name, 'musik') + '_' + i++;
    musicKeys.set(m.id, k);
  }
  const soundKeys = new Map();
  for (const s of project.sounds) {
    let k = ident(s.name, 'klang'), i = 2;
    while ([...soundKeys.values()].includes(k)) k = ident(s.name, 'klang') + '_' + i++;
    soundKeys.set(s.id, k);
  }
  const ctx = {
    project,
    sceneName: (id) => scene(id)?.name || '?',
    counterKey: (id) => keys.get(id) || 'unbekannt',
    counterName: (id) => counterOf(id)?.name || '?',
    dialogName: (id) => dialogOf(id)?.name || '?',
    musicKey: (id) => musicKeys.get(id) || '',
    soundKey: (id) => soundKeys.get(id),
    soundArg(v) {
      if (String(v).startsWith('u:')) { const k = soundKeys.get(String(v).slice(2)); return k ? 'KLANG.' + k : '"blip"'; }
      return luaStr(v || 'blip');
    },
    targetTest(v) {
      const [kind, ...rest] = String(v || '').split(':');
      const val = rest.join(':');
      if (kind === 'art') return `obj.art == ${luaStr(val)}`;
      if (kind === 'name') return `obj.name == ${luaStr(val)}`;
      return 'true';
    },
    targetArgs(v) {
      const [kind, ...rest] = String(v || '').split(':');
      return kind === 'art' ? `"art", ${luaStr(rest.join(':'))}` : `"name", ${luaStr(rest.join(':'))}`;
    },
    objArg(v) {
      if (!v || v === 'this') return 'obj';
      return luaStr(String(v).replace(/^name:/, ''));
    },
    spriteComment: (n) => { const s = spriteOf(n); return s ? `   -- ${String(s.name).replace(/\s+/g, ' ')}` : ''; },
    choiceRef(dialogId, v) {
      const d = dialogOf(dialogId);
      const [cardId, idx] = String(v || '').split(':');
      const ci = d ? d.cards.findIndex((c) => c.id === cardId) : -1;
      return { card: ci + 1, nr: (+idx || 0) + 1, text: d?.cards[ci]?.choices[+idx || 0]?.text };
    },
    // Anzeige eines Werts im Satz („Wenn der Spieler eine Münze berührt …“)
    show(type, v, prm = {}) {
      switch (type) {
        case 'scene': return q(ctx.sceneName(v));
        case 'counter': return ctx.counterName(v);
        case 'dialog': return q(ctx.dialogName(v));
        case 'music': return q(project.music.find((m) => m.id === v)?.name || '?');
        case 'sound': {
          if (String(v).startsWith('u:')) return q(project.sounds.find((s) => s.id === String(v).slice(2))?.name || '?');
          return q(BUILTIN_SFX.find((s) => s[0] === v)?.[1] || v);
        }
        case 'target': {
          const [kind, ...rest] = String(v || '').split(':');
          const val = rest.join(':');
          if (kind === 'art') return prm.plural ? PLURAL[val] || val : ARTICLE[val] || val;
          if (kind === 'name') return prm.plural ? 'alle ' + q(val) : q(val);
          return 'irgendetwas';
        }
        case 'objsel': return !v || v === 'this' ? (prm.thisText || 'das Objekt') : q(String(v).replace(/^name:/, ''));
        case 'name': return q(v || '?');
        case 'key': return KEYS.find((k) => k[0] === v)?.[1] || v;
        case 'op': return OPS.find((o) => o[0] === v)?.[1] || v;
        case 'sign': return v === '-' ? '−' : '+';
        case 'onoff': return v === 'aus' ? 'aus' : 'an';
        case 'tile': case 'sprite': return q(spriteOf(v)?.name || '?');
        case 'color': return 'Farbe ' + v;
        case 'text': return q(v);
        case 'arrive': return v ? 'Ankunft bei ' + q(v) : 'am Startpunkt';
        case 'choice': return q(ctx.choiceRef(prm.dialog, v).text || '?');
        default: return String(v ?? '');
      }
    },
  };
  return ctx;
}

// Satz mit eingesetzten Werten
export function sentence(def, p, ctx) {
  return def.s.replace(/\{(\w+)\}/g, (_, k) => {
    const prm = def.params.find((x) => x.k === k) || {};
    return ctx.show(prm.t, p?.[k], { ...prm, dialog: p?.dialog });
  });
}
export function describeRule(rule, ctx) {
  const t = byId(TRIGGERS, rule.trigger.type);
  let s = 'Wenn ' + (t ? sentence(t, rule.trigger.p, ctx) : '?');
  for (const c of rule.conds || []) {
    const d = byId(CONDITIONS, c.type);
    if (d) s += (c.not ? ' und nicht: ' : ' und ') + sentence(d, c.p, ctx);
  }
  const acts = (rule.actions || []).map((a) => { const d = byId(ACTIONS, a.type); return d ? sentence(d, a.p, ctx) : '?'; });
  return s + (acts.length ? ', dann: ' + acts.join(', ') : ', dann: (noch nichts)');
}

// ------------------------------------------------------------------ Prüfen: Was fehlt noch?
export function checkProject(project) {
  const ctx = makeContext(project);
  const out = [];
  const warn = (text, where = {}) => out.push({ level: 'warn', text, ...where });
  const err = (text, where = {}) => out.push({ level: 'error', text, ...where });
  const start = project.scenes.find((s) => s.id === project.startScene) || project.scenes[0];
  if (!project.scenes.length) err('Das Spiel hat noch keine Szene.', { area: 'scenes' });
  else if (!start.objects.some((o) => o.type === 'spieler')) err(`In der Startszene „${start.name}“ fehlt der Spieler.`, { area: 'scenes', scene: start.id });
  const names = new Set(project.scenes.flatMap((s) => s.objects.map((o) => o.name)));
  for (const s of project.scenes) {
    if (s.objects.filter((o) => o.type === 'spieler').length > 1) warn(`In „${s.name}“ stehen mehrere Spieler – nur der erste zählt.`, { area: 'scenes', scene: s.id });
    for (const o of s.objects) {
      if (o.type === 'tuer' && !o.ziel) warn(`Die Tür „${o.name}“ in „${s.name}“ führt noch nirgendwohin.`, { area: 'scenes', scene: s.id, obj: o.id });
      if (o.type === 'tuer' && o.ziel && !project.scenes.some((z) => z.id === o.ziel)) err(`Die Tür „${o.name}“ führt in eine Szene, die es nicht mehr gibt.`, { area: 'scenes', scene: s.id, obj: o.id });
      if (o.type === 'tuer' && o.ankunft) {
        const z = project.scenes.find((x) => x.id === o.ziel);
        if (z && !z.objects.some((x) => x.name === o.ankunft)) warn(`Die Tür „${o.name}“: In „${z.name}“ gibt es kein „${o.ankunft}“ zum Ankommen.`, { area: 'scenes', scene: s.id, obj: o.id });
      }
      if (o.type === 'figur' && !o.dialog) warn(`„${o.name}“ in „${s.name}“ hat noch keinen Dialog.`, { area: 'scenes', scene: s.id, obj: o.id });
    }
  }
  for (const d of project.dialogs) {
    if (!d.cards.length) warn(`Der Dialog „${d.name}“ hat noch keine Karte.`, { area: 'dialogs', dialog: d.id });
    for (const [i, c] of d.cards.entries()) {
      const cols = c.portrait ? DIALOG_COLS.portrait : DIALOG_COLS.plain;
      if (wrapText(c.text, cols).length > DIALOG_LINES) warn(`Dialog „${d.name}“, Karte ${i + 1}: Der Text ist länger als ${DIALOG_LINES} Zeilen und passt nicht ins Fenster.`, { area: 'dialogs', dialog: d.id, card: c.id });
    }
  }
  project.rules.forEach((r, i) => {
    if (!r.on) return;
    const no = i + 1;
    const t = byId(TRIGGERS, r.trigger.type);
    const refs = [[t, r.trigger.p], ...r.conds.map((c) => [byId(CONDITIONS, c.type), c.p]), ...r.actions.map((a) => [byId(ACTIONS, a.type), a.p])];
    if (!r.actions.length) warn(`Regel ${no} macht noch nichts – füge eine Aktion hinzu.`, { area: 'rules', rule: r.id });
    for (const [def, p] of refs) {
      if (!def) continue;
      for (const prm of def.params) {
        const v = p?.[prm.k];
        if (prm.t === 'counter' && !project.counters.some((c) => c.id === v)) err(`Regel ${no}: Zähler fehlt.`, { area: 'rules', rule: r.id });
        if (prm.t === 'scene' && !project.scenes.some((c) => c.id === v)) err(`Regel ${no}: Szene fehlt.`, { area: 'rules', rule: r.id });
        if (prm.t === 'dialog' && !project.dialogs.some((c) => c.id === v)) err(`Regel ${no}: Dialog fehlt.`, { area: 'rules', rule: r.id });
        if ((prm.t === 'name' || (prm.t === 'objsel' && v !== 'this') || (prm.t === 'target' && String(v).startsWith('name:'))) && !names.has(String(v || '').replace(/^name:/, ''))) {
          warn(`Regel ${no}: Kein Objekt heißt „${String(v || '').replace(/^name:/, '')}“.`, { area: 'rules', rule: r.id });
        }
        if (prm.t === 'objsel' && v === 'this' && !t?.obj) err(`Regel ${no}: „das Objekt“ gibt es nur bei Berühren, Sprechen oder Schaltern.`, { area: 'rules', rule: r.id });
      }
    }
    for (const c of r.conds) if (byId(CONDITIONS, c.type)?.needsObj && !t?.obj) err(`Regel ${no}: „von oben“ geht nur beim Berühren.`, { area: 'rules', rule: r.id });
  });
  void ctx;
  return out;
}

// ------------------------------------------------------------------ Kartenzeichen
const POOL = '#%&*+=~^@$!?:;<>abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789()[]{}|/_-,\'`';
function legendFor(project) {
  const used = new Set(project.scenes.flatMap((s) => s.tiles.filter(Boolean)));
  const list = project.sprites.filter((s) => s.kind === 'tile' || used.has(s.n));
  const map = new Map(), taken = new Set(['.', ' ', '"', '\\']);
  for (const s of list) {
    // ein gut merkbares Zeichen: erster Buchstabe, groß geschrieben, andere Buchstaben des Namens, sonst Sonderzeichen
    const name = String(s.name || '').replace(/[äÄöÖüÜß]/g, (c) => ({ ä: 'a', Ä: 'A', ö: 'o', Ö: 'O', ü: 'u', Ü: 'U', ß: 's' }[c]));
    const letters = name.replace(/[^A-Za-z]/g, '');
    const cands = [letters[0]?.toLowerCase(), letters[0]?.toUpperCase(), ...letters.slice(1).toLowerCase(), ...POOL].filter(Boolean);
    const ch = cands.find((c) => !taken.has(c));
    if (!ch) continue;
    taken.add(ch);
    map.set(s.n, ch);
  }
  return map;
}

// ------------------------------------------------------------------ Der Generator
export function generateLua(project) {
  const ctx = makeContext(project);
  const L = [];
  const ranges = [];             // { kind: 'rule'|'section'|..., id, from, to, label }
  const emit = (...lines) => { for (const l of lines) L.push(...String(l).split('\n')); };
  const begin = () => L.length + 1;
  const mark = (kind, id, from, label) => ranges.push({ kind, id, from, to: L.length, label });
  const section = (title) => { emit('', '-'.repeat(60) + ' ' + title); };
  const side = project.mode === 'seitlich';
  const oneLine = (s) => String(s || '').replace(/\s*\r?\n\s*/g, ' ').trim();

  // ---------- Kopf
  const player = (project.scenes.find((s) => s.id === project.startScene) || project.scenes[0])?.objects.find((o) => o.type === 'spieler');
  const icon = project.sprites.find((s) => s.n === player?.sprite)?.rows;
  let from = begin();
  emit(`-- title: ${oneLine(project.title) || 'Mein Spiel'}`);
  emit(`-- author: ${oneLine(project.author) || 'Baukasten'}`);
  emit(`-- desc: ${oneLine(project.desc) || 'Gebaut mit dem 8BOY Baukasten.'}`);
  emit(`-- color: ${(project.color | 0) & 31}`, '-- kind: game');
  const iconRows = icon ? icon.split('\n').map((r) => r.trim()).filter(Boolean) : [];
  if (iconRows.length >= 4 && iconRows.length <= 16 && iconRows.every((r) => r.length >= 4 && r.length <= 16)) {
    emit('-- icon:', ...iconRows.map((r) => '-- ' + r));
  }
  emit('-- cover: 3');
  emit('', '--[[anleitung', '# Worum geht es?', oneLine(project.desc) || 'Ein Spiel aus dem 8BOY Baukasten.', '', '# Steuerung');
  if (side) emit('[←] [→] laufen', '[A] springen – lange halten springt höher', '[↑] sprechen, lesen, Schalter umlegen');
  else emit('[←] [→] [↑] [↓] laufen', '[A] sprechen, lesen, Schalter umlegen');
  emit('[MENU] lange halten öffnet das Menü der Konsole', '', '# Gebaut mit dem 8BOY Baukasten', 'Den ganzen Code kannst du im Studio lesen und verändern.', ']]');
  mark('section', 'kopf', from, 'Kopf');

  emit('', '-- Dieses Spiel wurde mit dem 8BOY Baukasten gebaut. Der Code hat sieben Teile:',
    '--   1 Bilder   2 Klänge und Musik   3 Zähler   4 Szenen   5 Dialoge',
    '--   6 Deine Regeln („Wenn … dann …“)   7 Der Spiel-Motor, der alles zum Laufen bringt');

  // ---------- 1 Bilder
  from = begin();
  section('Teil 1: Bilder');
  emit('-- Jedes Bild hat eine Nummer. "." ist durchsichtig, 0-9 und a-v sind die 32 Farben.');
  for (const s of [...project.sprites].sort((a, b) => a.n - b.n)) {
    emit('', `-- ${s.n}: ${oneLine(s.name)}${s.kind === 'tile' ? ' (Kachel)' : ''}`, `sprite(${s.n}, [[`, ...s.rows.split('\n').map((r) => r.trim()).filter(Boolean), ']])');
    if (s.solid) emit(`fset(${s.n}, 0, true)   -- ${oneLine(s.name)} ist fest: Eigenschaft 0 = man kommt nicht hindurch`);
  }
  mark('section', 'bilder', from, 'Bilder');

  // ---------- 2 Klänge und Musik
  from = begin();
  section('Teil 2: Klänge und Musik');
  emit('-- Klänge und Musik sind in MML geschrieben: t = Tempo, o = Oktave, l = Länge, v = Lautstärke, w = Welle.');
  emit('KLANG = {');
  for (const s of project.sounds) emit(`  ${ctx.soundKey(s.id)} = ${luaStr(s.mml)},   -- ${oneLine(s.name)}`);
  emit('}', '', '-- Jedes Musikstück hat mehrere Stimmen, die gleichzeitig auf eigenen Kanälen spielen.', 'MUSIK = {');
  for (const m of project.music) {
    emit(`  ${ctx.musicKey(m.id)} = {   -- ${oneLine(m.name)}`);
    for (const v of m.voices.slice(0, 3)) emit(`    ${luaStr(v)},`);
    emit('  },');
  }
  emit('}');
  mark('section', 'klang', from, 'Klänge und Musik');

  // ---------- 3 Zähler
  from = begin();
  section('Teil 3: Zähler');
  emit('-- Startwerte. Während des Spiels stehen die Werte in zaehler.punkte, zaehler.leben usw.');
  emit('ZAEHLER_START = {');
  for (const c of project.counters) emit(`  ${ctx.counterKey(c.id)} = ${Number(c.start) || 0},   -- ${oneLine(c.name)}`);
  emit('}', '', '-- Diese Zähler stehen oben im Bild (bild = kleines Symbol davor)', 'ANZEIGE = {');
  for (const c of project.counters.filter((x) => x.show)) {
    emit(`  { name = ${luaStr(ctx.counterKey(c.id))}, text = ${luaStr(oneLine(c.name))}${c.icon ? `, bild = ${c.icon}` : ''} },`);
  }
  emit('}');
  mark('section', 'zaehler', from, 'Zähler');

  // ---------- 4 Szenen
  from = begin();
  section('Teil 4: Szenen');
  const legend = legendFor(project);
  emit('-- In den Karten steht jedes Zeichen für eine Kachel. "." ist leer.', 'KACHEL = {', '  ["."] = 0,');
  for (const [n, ch] of legend) emit(`  [${luaStr(ch)}] = ${n},   -- ${oneLine(project.sprites.find((s) => s.n === n)?.name)}`);
  emit('}', '', 'SZENEN = {}');
  const startScene = project.scenes.find((s) => s.id === project.startScene) || project.scenes[0];
  for (const sc of project.scenes) {
    const f = begin();
    const mk = ctx.musicKey(sc.music);
    emit('', `SZENEN[${luaStr(sc.name)}] = {`, `  breite = ${sc.w}, hoehe = ${sc.h}, farbe = ${(sc.color | 0) & 31},${mk ? ` musik = ${luaStr(mk)},` : ''}`, '  karte = {');
    for (let y = 0; y < sc.h; y++) {
      let row = '';
      for (let x = 0; x < sc.w; x++) row += legend.get(sc.tiles[y * sc.w + x]) || '.';
      emit(`    ${luaStr(row)},`);
    }
    emit('  },', '  objekte = {');
    for (const o of sc.objects) emit('    ' + objectLua(o, ctx, project) + ',');
    emit('  },', '}');
    mark('scene', sc.id, f, sc.name);
  }
  emit('', `START_SZENE = ${luaStr(startScene?.name || '')}`);
  mark('section', 'szenen', from, 'Szenen');

  // ---------- 5 Dialoge
  from = begin();
  section('Teil 5: Dialoge');
  emit('-- Jede Karte: wer spricht (wer, bild = Porträt), was gesagt wird (text) und welche Karte danach kommt (weiter).',
    '-- Mit antworten kann man wählen; jede Antwort führt zu einer anderen Karte. Ohne weiter endet der Dialog.', 'DIALOGE = {}');
  for (const d of project.dialogs) {
    const f = begin();
    const idx = (id) => d.cards.findIndex((c) => c.id === id) + 1;
    emit('', `DIALOGE[${luaStr(d.name)}] = {`, `  start = ${Math.max(1, idx(d.start))},`, '  karten = {');
    d.cards.forEach((c, i) => {
      const cols = c.portrait ? 33 : 37;
      const text = wrapText(c.text, cols).join('\n');
      const head = `    [${i + 1}] = { ${c.who ? `wer = ${luaStr(c.who)}, ` : ''}${c.portrait ? `bild = ${c.portrait}, ` : ''}text = ${luaStr(text)}`;
      const choices = (c.choices || []).filter((a) => a.text);
      if (choices.length) {
        emit(head + ',', '      antworten = {');
        for (const a of choices) emit(`        { text = ${luaStr(a.text)}${idx(a.next) ? `, weiter = ${idx(a.next)}` : ''} },`);
        emit('      },', '    },');
      } else emit(head + (idx(c.next) ? `, weiter = ${idx(c.next)}` : '') + ' },');
    });
    emit('  },', '}');
    mark('dialog', d.id, f, d.name);
  }
  mark('section', 'dialoge', from, 'Dialoge');

  // ---------- 6 Regeln
  from = begin();
  section('Teil 6: Deine Regeln');
  emit('-- Hier steht jede Regel aus dem Baukasten als Lua-Code. Der Spiel-Motor (Teil 7) ruft diese',
    '-- Funktionen auf, wenn etwas passiert. "obj" ist dabei das Objekt, um das es gerade geht.');
  const HOOKS = [
    ['start', 'bei_start()', 'Einmal, wenn das Spiel startet.'],
    ['scene', 'bei_szene_betreten()', 'Wenn der Spieler eine Szene betritt (szene_name sagt, welche).'],
    ['touch', 'bei_beruehrung(obj)', 'Wenn der Spieler ein Objekt berührt.'],
    ['talk', 'bei_ansprechen(obj)', 'Wenn der Spieler eine Figur, ein Schild oder einen Schalter anspricht.'],
    ['switch', 'bei_schalter(obj)', 'Wenn ein Schalter umgelegt wurde (obj.an ist dann wahr oder falsch).'],
    ['dialog', 'bei_dialog_ende(name)', 'Wenn ein Dialog zu Ende ist.'],
    ['choice', 'bei_antwort(name, karte, antwort)', 'Wenn im Dialog eine Antwort gewählt wurde (Kartennummer, Antwortnummer).'],
    ['frame', 'regeln_jedes_bild()', 'Jedes Bild (60 mal pro Sekunde): Tasten, Zähler, Zeit.'],
  ];
  for (const [hook, sig, help] of HOOKS) {
    emit('', `-- ${help}`, `function ${sig}`);
    let any = false;
    project.rules.forEach((r, i) => {
      const t = byId(TRIGGERS, r.trigger.type);
      if (!t || t.hook !== hook) return;
      any = true;
      const f = begin();
      const no = i + 1;
      emit(`  -- Regel ${no}: ${oneLine(describeRule(r, ctx))}`);
      if (!r.on) { emit('  -- (ausgeschaltet)'); mark('rule', r.id, f, 'Regel ' + no); return; }
      const parts = [];
      const test = t.test ? t.test(r.trigger.p || {}, ctx, no) : null;
      if (test) parts.push(t.edge ? `wird_wahr(${no}, ${test})` : test);
      for (const c of r.conds) {
        const d = byId(CONDITIONS, c.type);
        if (d) parts.push((c.not ? 'not ' : '') + (c.not && /\s/.test(d.lua(c.p || {}, ctx)) ? `(${d.lua(c.p || {}, ctx)})` : d.lua(c.p || {}, ctx)));
      }
      const acts = r.actions.flatMap((a) => { const d = byId(ACTIONS, a.type); return d ? [].concat(d.lua(a.p || {}, ctx)) : []; });
      if (parts.length) {
        emit(`  if ${parts.join(' and ')} then`);
        for (const a of acts) emit('    ' + a);
        if (!acts.length) emit('    -- (noch keine Aktion)');
        emit('  end');
      } else {
        for (const a of acts) emit('  ' + a);
        if (!acts.length) emit('  -- (noch keine Aktion)');
      }
      mark('rule', r.id, f, 'Regel ' + no);
    });
    if (!any) emit('  -- (noch keine Regel)');
    emit('end');
  }
  mark('section', 'regeln', from, 'Deine Regeln');

  // ---------- 7 Motor
  from = begin();
  emit(engine(side));
  mark('section', 'motor', from, 'Spiel-Motor');
  return { code: L.join('\n') + '\n', ranges, lines: L.length };
}

// Ein Objekt als eine Zeile Lua (nur Werte, die etwas bedeuten)
function objectLua(o, ctx, project) {
  const f = [`art = ${luaStr(o.type)}`, `name = ${luaStr(o.name || OBJECT_TYPES[o.type]?.label || o.type)}`, `x = ${o.x}`, `y = ${o.y}`, `bild = ${o.sprite || 0}`];
  const flag = (k) => { if (o[k]) f.push(`${k} = true`); };
  flag('fest'); flag('steuerbar'); flag('verfolgt'); flag('versteckt');
  if (project.mode === 'seitlich') flag('schwerkraft');
  if (o.hinundher) f.push(`hinundher = ${luaStr(o.hinundher)}`);
  if (o.steuerbar || o.hinundher || o.verfolgt) f.push(`tempo = ${Number(o.tempo) || 1}`);
  if (o.type === 'tuer') {
    if (o.ziel) f.push(`ziel = ${luaStr(ctx.sceneName(o.ziel))}`);
    if (o.ankunft) f.push(`ankunft = ${luaStr(o.ankunft)}`);
    if (o.verschlossen) f.push('verschlossen = true');
    if (o.bild_offen) f.push(`bild_offen = ${o.bild_offen}`);
  }
  if (o.type === 'figur' && o.dialog) f.push(`dialog = ${luaStr(ctx.dialogName(o.dialog))}`);
  if (o.type === 'schild') f.push(`text = ${luaStr(wrapText(o.text, 37).join('\n'))}`);
  if (o.type === 'schalter') { if (o.an) f.push('an = true'); if (o.bild_an) f.push(`bild_an = ${o.bild_an}`); }
  return `{ ${f.join(', ')} }`;
}

// ------------------------------------------------------------------ Teil 7: der Spiel-Motor (für alle Spiele gleich)
function engine(side) {
  return `
------------------------------------------------------------ Teil 7: Der Spiel-Motor
-- Hier steht, wie die Welt funktioniert: laufen, anstoßen, berühren, sprechen, anzeigen.
-- Deine Regeln aus Teil 6 werden von hier aus aufgerufen.

SPIELART = ${side ? '"seitlich"   ' : '"draufsicht" '}   -- "draufsicht" = von oben gesehen, "seitlich" = Jump'n'Run mit Schwerkraft
TASTE_SPRECHEN = ${side ? 'UP' : 'A '}           -- damit spricht man mit Figuren, liest Schilder, legt Schalter um
TASTE_ZEICHEN = ${side ? '"↑"' : '"A"'}
SCHWERKRAFT = 0.25           -- so stark zieht es nach unten (nur seitlich)
SPRUNGKRAFT = 4.4            -- so kräftig springt der Spieler (nur seitlich)

function _init()
  stop()
  zaehler = {}
  for name, wert in pairs(ZAEHLER_START) do zaehler[name] = wert end
  war_wahr = {}                     -- merkt sich Regeln, die nur einmal auslösen (wird_wahr)
  dialog, ende, wechsel = nil, nil, nil
  meldung_text, meldung_zeit = "", 0
  wackel_zeit, blitz_zeit, blitz_farbe = 0, 0, 7
  musik_jetzt = nil
  -- alle Szenen frisch aufbauen: eingesammelte Münzen sind bei einem neuen Spiel wieder da
  for _, sz in pairs(SZENEN) do
    sz.start = nil                  -- Startpunkt neu suchen, sonst steht der Spieler nach „nochmal spielen“ am alten Ort
    sz.welt = objekte_bauen(sz)
    sz.kacheln = {}
    for i, zeile in ipairs(sz.karte) do sz.kacheln[i] = zeile end
  end
  local start = SZENEN[START_SZENE]
  spieler = start.start or neues_objekt({ art = "spieler", name = "Spieler", x = 1, y = 1, bild = 1, steuerbar = true })
  spieler.schutz = 0
  szene_laden(START_SZENE)
  bei_start()
  bei_szene_betreten()
end

-- Baut aus der Liste einer Szene die Objekte, die sich im Spiel bewegen.
-- Der Spieler kommt nicht in die Liste: Er merkt sich nur, wo in dieser Szene sein Start ist.
function objekte_bauen(sz)
  local liste = {}
  for _, vorlage in ipairs(sz.objekte) do
    local o = neues_objekt(vorlage)
    if o.art == "spieler" then
      if not sz.start then sz.start = o end
    else
      liste[#liste + 1] = o
    end
  end
  return liste
end

function neues_objekt(vorlage)
  local o = {}
  for k, v in pairs(vorlage) do o[k] = v end   -- alle Angaben abschreiben
  o.x, o.y = vorlage.x * 8, vorlage.y * 8       -- Kacheln in Pixel umrechnen
  o.start_x, o.start_y = o.x, o.y
  o.w, o.h = sprsize(o.bild)
  if o.w == 0 then o.w, o.h = 8, 8 end
  o.tempo = o.tempo or 1
  o.sichtbar = not o.versteckt
  o.richtung = 1                                -- 1 = nach rechts/unten, -1 = nach links/oben
  o.vy, o.am_boden, o.links = 0, false, false
  o.bild_aus = o.bild
  if o.an and o.bild_an then o.bild = o.bild_an end
  if o.verschlossen then o.fest = true end     -- verschlossene Türen sind fest
  return o
end

-- Eine Szene auf die Konsole legen und den Spieler hineinstellen
function szene_laden(name, ankunft)
  szene_name = name
  szene = SZENEN[name]
  objekte = szene.welt
  -- jedes Zeichen der Karte wird über KACHEL zu einer Bildnummer
  for y = 0, szene.hoehe - 1 do
    local zeile = szene.kacheln[y + 1]
    for x = 0, szene.breite - 1 do
      mset(x, y, KACHEL[zeile:sub(x + 1, x + 1)] or 0)
    end
  end
  -- Wo kommt der Spieler an? Beim Objekt namens "ankunft", sonst am Startpunkt der Szene
  -- (start_x/start_y: der Startpunkt selbst kann der Spieler sein und ist dann schon gelaufen)
  local zx, zy = nil, nil
  if szene.start then zx, zy = szene.start.start_x, szene.start.start_y end
  if ankunft then
    for _, o in ipairs(objekte) do if o.name == ankunft then zx, zy = o.x, o.y end end
  end
  if zx then spieler.x, spieler.y = zx, zy end
  spieler.vy = 0
  -- was der Spieler beim Ankommen schon berührt, löst erst nach dem Weggehen wieder aus
  for _, o in ipairs(objekte) do o.beruehrt = o.sichtbar and beruehrt(spieler, o, 1) end
  szenen_zeit, szenen_bilder = 0, 0
  if szene.musik then musik(szene.musik) end
  kamera_folgen()
end

-- Szene wechseln: passiert erst am Ende des Bildes, damit nichts durcheinanderkommt
function szene_wechseln(name, ankunft)
  if SZENEN[name] then wechsel = { name = name, ankunft = ankunft } end
end

------------------------------------------------------------ Bewegung und Kollision
-- Ist an Pixel (x, y) eine Wand? Der Rand der Szene zählt auch als Wand.
function wand(x, y)
  if x < 0 or y < 0 or x >= szene.breite * 8 or y >= szene.hoehe * 8 then return true end
  return fget(mget(x // 8, y // 8), 0)
end

-- Berühren sich a und b? (rand = so viele Pixel Abstand zählen noch als Berührung)
function beruehrt(a, b, rand)
  rand = rand or 0
  return a.x - rand < b.x + b.w and b.x - rand < a.x + a.w and a.y - rand < b.y + b.h and b.y - rand < a.y + a.h
end

-- Darf o an der Stelle (x, y) stehen? Wände und feste Objekte sind im Weg.
function frei(o, x, y)
  if wand(x, y) or wand(x + o.w - 1, y) or wand(x, y + o.h - 1) or wand(x + o.w - 1, y + o.h - 1) then return false end
  local alle = { spieler }
  for _, b in ipairs(objekte) do alle[#alle + 1] = b end
  for _, b in ipairs(alle) do
    if b ~= o and b.fest and b.sichtbar and not beruehrt(o, b) then
      if x < b.x + b.w and b.x < x + o.w and y < b.y + b.h and b.y < y + o.h then return false end
    end
  end
  return true
end

-- Schiebt o Pixel für Pixel in eine Richtung, bis etwas im Weg ist
function schieben(o, weite, rx, ry)
  while weite > 0 do
    local s = min(weite, 1)
    if not frei(o, o.x + rx * s, o.y + ry * s) then return false end
    o.x, o.y = o.x + rx * s, o.y + ry * s
    weite = weite - s
  end
  return true
end

-- Erst waagerecht, dann senkrecht bewegen. Gibt zurück, ob es in beide Richtungen weiterging.
function bewegen(o, dx, dy)
  local frei_x = schieben(o, abs(dx), sgn(dx), 0)
  local frei_y = schieben(o, abs(dy), 0, sgn(dy))
  return frei_x, frei_y
end

function abstand(a, b)
  return sqrt((a.x - b.x) ^ 2 + (a.y - b.y) ^ 2)
end

function objekt_bewegen(o)
  local dx, dy = 0, 0
  -- steuerbar: mit dem Steuerkreuz
  if o.steuerbar then
    if btn(LEFT) then dx = -o.tempo; o.links = true end
    if btn(RIGHT) then dx = o.tempo; o.links = false end
    if SPIELART == "draufsicht" then
      if btn(UP) then dy = -o.tempo end
      if btn(DOWN) then dy = o.tempo end
    end
  end
  -- hin und her laufen
  if o.hinundher == "waagerecht" then dx = o.richtung * o.tempo; o.links = o.richtung < 0 end
  if o.hinundher == "senkrecht" and SPIELART == "draufsicht" then dy = o.richtung * o.tempo end
  -- den Spieler verfolgen, wenn er näher als 10 Kacheln ist
  if o.verfolgt and o ~= spieler and abstand(o, spieler) < 80 then
    if abs(spieler.x - o.x) > 1 then dx = sgn(spieler.x - o.x) * o.tempo; o.links = dx < 0 end
    if SPIELART == "draufsicht" and abs(spieler.y - o.y) > 1 then dy = sgn(spieler.y - o.y) * o.tempo end
  end
  local frei_x, frei_y = bewegen(o, dx, dy)
  if o.hinundher then
    -- an einer Wand (oder seitlich an einer Kante) umdrehen
    local kante = false
    if SPIELART == "seitlich" and o.schwerkraft and o.am_boden then
      local vorne = o.x + o.w
      if o.richtung < 0 then vorne = o.x - 1 end
      kante = not wand(vorne, o.y + o.h)
    end
    if not frei_x or not frei_y or kante then o.richtung = -o.richtung end
  end
  -- Schwerkraft und Springen (nur seitlich)
  if SPIELART == "seitlich" and o.schwerkraft then
    if o.steuerbar and o.am_boden and btnp(A) then o.vy = -SPRUNGKRAFT; sfx("jump") end
    if o.steuerbar and o.vy < -1.5 and not btn(A) then o.vy = -1.5 end   -- kurz tippen = kleiner Sprung
    o.vy = min(o.vy + SCHWERKRAFT, 5)
    local _, weiter = bewegen(o, 0, o.vy)
    o.am_boden = false
    if not weiter then
      if o.vy > 0 then o.am_boden = true end
      o.vy = 0
    end
  end
end

------------------------------------------------------------ Berühren und Ansprechen
function beruehrungen_pruefen()
  for _, o in ipairs(objekte) do
    local jetzt = o.sichtbar and beruehrt(spieler, o, 1)
    if jetzt and not o.beruehrt then
      o.beruehrt = true
      bei_beruehrung(o)                                    -- deine Regeln (Teil 6)
      if o.art == "tuer" and not o.verschlossen and o.ziel then szene_wechseln(o.ziel, o.ankunft) end
    end
    o.beruehrt = jetzt
  end
end

-- Figuren, Schilder und Schalter direkt neben dem Spieler kann man ansprechen
function ansprechen_pruefen()
  gegenueber = nil
  for _, o in ipairs(objekte) do
    if o.sichtbar and (o.art == "figur" or o.art == "schild" or o.art == "schalter") and beruehrt(spieler, o, 4) then gegenueber = o end
  end
  if gegenueber and btnp(TASTE_SPRECHEN) then
    local o = gegenueber
    if o.art == "figur" and o.dialog then dialog_starten(o.dialog) end
    if o.art == "schild" then text_zeigen(o.text) end
    if o.art == "schalter" then schalter_umlegen(o) end
    bei_ansprechen(o)                                      -- deine Regeln (Teil 6)
  end
end

------------------------------------------------------------ Bausteine für die Regeln
-- Alle Objekte mit diesem Namen (in allen Szenen) – oder genau das eine Objekt
function finde(wer)
  if type(wer) == "table" then return { wer } end
  local liste = {}
  for _, sz in pairs(SZENEN) do
    for _, o in ipairs(sz.welt) do
      if o.name == wer then liste[#liste + 1] = o end
    end
  end
  return liste
end

function verschwinden(wer) for _, o in ipairs(finde(wer)) do o.sichtbar = false end end
function erscheinen(wer) for _, o in ipairs(finde(wer)) do o.sichtbar = true end end

function noch_da(wer)
  for _, o in ipairs(finde(wer)) do if o.sichtbar then return true end end
  return false
end

-- Wie viele sichtbare Objekte in dieser Szene haben z.B. art == "sammel"?
function anzahl(feld, wert)
  local n = 0
  for _, o in ipairs(objekte) do if o.sichtbar and o[feld] == wert then n = n + 1 end end
  return n
end

function tuer_oeffnen(wer)
  for _, o in ipairs(finde(wer)) do
    o.verschlossen, o.fest = false, false
    if o.bild_offen then o.bild = o.bild_offen end
  end
end

function schalter_umlegen(wer)
  for _, o in ipairs(finde(wer)) do
    o.an = not o.an
    if o.bild_an then
      if o.an then o.bild = o.bild_an else o.bild = o.bild_aus end
    end
    sfx("select")
    bei_schalter(o)                                        -- deine Regeln (Teil 6)
  end
end

function ist_an(wer)
  local o = finde(wer)[1]
  return o ~= nil and o.an == true
end

function bild_setzen(wer, nr)
  for _, o in ipairs(finde(wer)) do o.bild = nr; o.w, o.h = sprsize(nr) end
end

-- Kachel an Stelle (x, y) der aktuellen Szene setzen – die Szene merkt sich das
function kachel_setzen(x, y, nr)
  mset(x, y, nr)
  local zeichen = "."
  for z, n in pairs(KACHEL) do if n == nr then zeichen = z end end
  local zeile = szene.kacheln[y + 1]
  if zeile then szene.kacheln[y + 1] = zeile:sub(1, x) .. zeichen .. zeile:sub(x + 2) end
end

-- Steht der Spieler auf einer bestimmten Kachel?
function steht_auf(nr)
  local mx, my = spieler.x + spieler.w / 2, spieler.y + spieler.h / 2
  if mget(mx // 8, my // 8) == nr then return true end
  return SPIELART == "seitlich" and spieler.am_boden and mget(mx // 8, (spieler.y + spieler.h) // 8) == nr
end

-- Kommt der Spieler von oben auf das Objekt (fällt er gerade drauf)?
function von_oben(o)
  return spieler.vy > 0 and spieler.y + spieler.h - spieler.vy <= o.y + 3
end

-- Wahr nur in dem Moment, in dem die Bedingung wahr WIRD (nicht jedes Bild wieder)
function wird_wahr(nr, bedingung)
  local vorher = war_wahr[nr]
  war_wahr[nr] = bedingung
  return bedingung and not vorher
end

-- Wahr alle "sek" Sekunden
function alle(sek)
  return szenen_bilder > 0 and szenen_bilder % max(1, flr(sek * 60)) == 0
end

function geschuetzt() return spieler.schutz > 0 end
function schuetzen(sek) spieler.schutz = flr(sek * 60) end

function zurueckstossen(wer)
  local o = finde(wer)[1]
  if not o then return end
  local dx, dy = sgn(spieler.x - o.x), sgn(spieler.y - o.y)
  if dx == 0 and dy == 0 then dx = -1 end
  if SPIELART == "seitlich" then dy = 0; spieler.vy = -2.5 end
  bewegen(spieler, dx * 12, dy * 12)
end

function abprallen() spieler.vy = -3.5 end

function zurueck_zum_start()
  if szene.start then spieler.x, spieler.y = szene.start.start_x, szene.start.start_y end
  spieler.vy = 0
end

function teleport(x, y)
  spieler.x, spieler.y = x * 8, y * 8
end

function meldung(text, sek)
  meldung_text, meldung_zeit = text, flr(sek * 60)
end

function wackeln(sek) wackel_zeit = flr(sek * 60) end
function blitz(farbe) blitz_farbe, blitz_zeit = farbe, 4 end

function musik(name)
  if name == musik_jetzt then return end    -- läuft schon
  musik_jetzt = name
  stop(0) stop(1) stop(2)
  local stueck = name and MUSIK[name]
  if stueck then
    for kanal, stimme in ipairs(stueck) do play(stimme, kanal - 1, true) end
  end
end

function gewinnen(text)
  if ende then return end
  musik(nil)
  sfx("win")
  ende = { text = text, gewonnen = true, zeit = 0 }
end

function verlieren(text)
  if ende then return end
  musik(nil)
  sfx("lose")
  ende = { text = text, gewonnen = false, zeit = 0 }
end

------------------------------------------------------------ Dialoge
function dialog_starten(name)
  local d = DIALOGE[name]
  if d then dialog = { name = name, karten = d.karten, nr = d.start, zeichen = 0, wahl = 1 } end
end

-- Ein einfaches Textfenster (für Schilder): ein Dialog mit nur einer Karte
function text_zeigen(text)
  dialog = { karten = { { text = text } }, nr = 1, zeichen = 0, wahl = 1 }
end

-- die ersten n Zeichen eines Textes (Umlaute zählen als ein Zeichen)
function anfang(text, n)
  local bis = utf8.offset(text, n + 1)
  if not bis then return text end
  return text:sub(1, bis - 1)
end

function dialog_weiter()
  local k = dialog.karten[dialog.nr]
  local laenge = utf8.len(k.text) or #k.text
  if dialog.zeichen < laenge then                   -- der Text erscheint Buchstabe für Buchstabe
    dialog.zeichen = dialog.zeichen + 1
    if btnp(A) or btnp(B) then dialog.zeichen = laenge end
    return
  end
  if k.antworten then
    if btnp(UP) then dialog.wahl = (dialog.wahl - 2) % #k.antworten + 1; sfx("blip") end
    if btnp(DOWN) then dialog.wahl = dialog.wahl % #k.antworten + 1; sfx("blip") end
    if btnp(A) then
      local d, a = dialog, k.antworten[dialog.wahl]
      sfx("select")
      bei_antwort(d.name, d.nr, d.wahl)              -- deine Regeln (Teil 6)
      if dialog == d then naechste_karte(a.weiter) end
    end
  elseif btnp(A) or btnp(B) then
    naechste_karte(k.weiter)
  end
end

function naechste_karte(nr)
  if nr then
    dialog.nr, dialog.zeichen, dialog.wahl = nr, 0, 1
    return
  end
  local name = dialog.name
  dialog = nil
  if name then bei_dialog_ende(name) end             -- deine Regeln (Teil 6)
end

------------------------------------------------------------ Jedes Bild: _update rechnet, _draw malt
function _update()
  if meldung_zeit > 0 then meldung_zeit = meldung_zeit - 1 end
  if wackel_zeit > 0 then wackel_zeit = wackel_zeit - 1 end
  if blitz_zeit > 0 then blitz_zeit = blitz_zeit - 1 end
  if ende then                                       -- Spiel vorbei: A oder MENÜ fängt neu an
    ende.zeit = ende.zeit + 1
    if ende.zeit > 60 and (btnp(A) or btnp(MENU)) then _init() end
    return
  end
  if dialog then dialog_weiter() return end          -- während eines Gesprächs steht die Welt still
  szenen_bilder = szenen_bilder + 1
  szenen_zeit = szenen_bilder / 60
  if spieler.schutz > 0 then spieler.schutz = spieler.schutz - 1 end
  -- 1. alles bewegen, den Spieler zuerst
  objekt_bewegen(spieler)
  for _, o in ipairs(objekte) do
    if o.sichtbar then objekt_bewegen(o) end
  end
  -- 2. Berührungen, 3. Ansprechen, 4. deine Regeln für jedes Bild
  beruehrungen_pruefen()
  ansprechen_pruefen()
  regeln_jedes_bild()
  -- 5. Szene wechseln, wenn eine Tür oder Regel das will
  if wechsel then
    local w = wechsel
    wechsel = nil
    szene_laden(w.name, w.ankunft)
    bei_szene_betreten()
  end
  kamera_folgen()
end

-- Die Kamera folgt dem Spieler, aber nie über den Rand der Szene hinaus
function kamera_folgen()
  local bw, bh = szene.breite * 8, szene.hoehe * 8
  if bw <= SCREEN_W then kam_x = -(SCREEN_W - bw) // 2
  else kam_x = clamp(flr(spieler.x + spieler.w / 2 - SCREEN_W / 2), 0, bw - SCREEN_W) end
  if bh <= SCREEN_H then kam_y = -(SCREEN_H - bh) // 2
  else kam_y = clamp(flr(spieler.y + spieler.h / 2 - SCREEN_H / 2), 0, bh - SCREEN_H) end
end

function _draw()
  cls(szene.farbe)
  local wx, wy = 0, 0
  if wackel_zeit > 0 then wx, wy = rnd(-2, 2), rnd(-2, 2) end
  camera(kam_x + wx, kam_y + wy)
  map(0, 0, 0, 0, szene.breite, szene.hoehe)
  for _, o in ipairs(objekte) do
    if o.sichtbar then spr(o.bild, o.x, o.y, o.links) end
  end
  if spieler.schutz % 8 < 5 then spr(spieler.bild, spieler.x, spieler.y, spieler.links) end   -- blinkt, wenn geschützt
  if gegenueber and not dialog then                 -- Hinweis: hier kann man etwas tun
    local x, y = gegenueber.x + gegenueber.w / 2 - 4, gegenueber.y - 11
    rectfill(x, y, 9, 9, 0)
    print(TASTE_ZEICHEN, x + 2, y + 1, 10)
  end
  camera()
  anzeige_malen()
  if meldung_zeit > 0 then
    local w = textw(meldung_text) + 10
    rectfill((SCREEN_W - w) // 2, 15, w, 13, 0)
    printc(meldung_text, 18, 10)
  end
  if dialog then dialog_malen() end
  if blitz_zeit > 0 then rectfill(0, 0, SCREEN_W, SCREEN_H, blitz_farbe) end
  if ende then ende_malen() end
end

-- oben im Bild: die Zähler aus ANZEIGE
function anzeige_malen()
  if #ANZEIGE == 0 then return end
  rectfill(0, 0, SCREEN_W, 11, 0)
  local x = 4
  for _, a in ipairs(ANZEIGE) do
    local text = a.text .. ": " .. tostring(zaehler[a.name])
    if a.bild then
      spr(a.bild, x, 2)
      x = x + 10
      text = tostring(zaehler[a.name])
    end
    x = x + print(text, x, 2, 7) + 12
  end
end

function dialog_malen()
  local k = dialog.karten[dialog.nr]
  local y = SCREEN_H - 52
  rectfill(2, y, SCREEN_W - 4, 50, 16)
  rect(2, y, SCREEN_W - 4, 50, 7)
  local tx = 8
  if k.bild then                                     -- Porträt links
    local w = sprsize(k.bild)
    local gross = 2
    if w > 8 then gross = 1 end
    rectfill(7, y + 6, 20, 20, 1)
    spr(k.bild, 9, y + 8, false, false, gross)
    tx = 32
  end
  if k.wer then                                      -- Namensschild
    local w = textw(k.wer) + 8
    rectfill(6, y - 9, w, 11, 16)
    rect(6, y - 9, w, 11, 7)
    print(k.wer, 10, y - 7, 10)
  end
  print(anfang(k.text, dialog.zeichen), tx, y + 6, 7)
  local fertig = dialog.zeichen >= (utf8.len(k.text) or 0)
  if fertig and k.antworten then                    -- Antworten im Kasten darüber
    local w = 0
    for _, a in ipairs(k.antworten) do w = max(w, textw(a.text)) end
    w = w + 22
    local h = #k.antworten * 10 + 6
    local x, ay = SCREEN_W - 4 - w, y - h - 2
    rectfill(x, ay, w, h, 16)
    rect(x, ay, w, h, 7)
    for i, a in ipairs(k.antworten) do
      local farbe = 7
      if i == dialog.wahl then
        farbe = 10
        print("▶", x + 5, ay + 4 + (i - 1) * 10, 10)
      end
      print(a.text, x + 14, ay + 4 + (i - 1) * 10, farbe)
    end
  elseif fertig and frame() % 40 < 26 then
    print("↓", SCREEN_W - 12, y + 40, 10)
  end
end

function ende_malen()
  local farbe = 8
  local titel = "VERLOREN"
  if ende.gewonnen then farbe, titel = 10, "GEWONNEN!" end
  rectfill(20, 46, SCREEN_W - 40, 66, 0)
  rect(20, 46, SCREEN_W - 40, 66, farbe)
  printc(titel, 56, farbe, 2)
  printc(ende.text, 80, 7)
  if ende.zeit > 60 and frame() % 40 < 26 then printc("A: nochmal spielen", 96, 6) end
end
`;
}
