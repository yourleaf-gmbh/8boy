// Vorlagen für neue Spiele: fertige Bilder, Klänge, Musikstücke und zwei Startprojekte
// („Top-Down-Abenteuer“ und „Jump'n'Run“). Alles ist normales Projekt-Material und kann verändert werden.

export const uid = (p = 'x') => p + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-3);

// ------------------------------------------------------------------ Bilder (8×8, '.' = durchsichtig, 0-9 a-v = Farbe)
// kind: tile = Kachel für die Karte, figur = Bild für Objekte
export const SPRITE_LIBRARY = [
  { name: 'Gras', kind: 'tile', folder: 'Draußen', tags: ['boden'], rows: 'bbbbbbbb\nbbnbbbbb\nbbbbbnbb\nbbbbbbbb\nbnbbbbbb\nbbbbbbnb\nbbbnbbbb\nbbbbbbbb' },
  { name: 'Weg', kind: 'tile', folder: 'Draußen', tags: ['boden'], rows: 'vvvvvvvv\nvvvovvvv\nvvvvvvov\nvovvvvvv\nvvvvvvvv\nvvvvovvv\nvvovvvvv\nvvvvvvvo' },
  { name: 'Blumen', kind: 'tile', folder: 'Draußen', tags: ['boden', 'deko'], rows: 'bbbbbbbb\nbb8bbbbb\nb8a8bbeb\nbb8bbeae\nbbbbbbeb\nbeb8bbbb\neaebbbbb\nbebbbbbb' },
  { name: 'Wasser', kind: 'tile', folder: 'Draußen', tags: ['fest'], solid: true, rows: 'cccccccc\ncc7ccccc\nc7j7cccc\ncccccccc\nccccc7cc\ncccc7j7c\ncccccccc\ncccccccc' },
  { name: 'Baum', kind: 'tile', folder: 'Draußen', tags: ['fest'], solid: true, rows: 'bb3333bb\nb3nnnn3b\n3nnbnnn3\n3nnnnbn3\nb3nnnn3b\nbb3443bb\nbbb44bbb\nbbbbbbbb' },
  { name: 'Mauer', kind: 'tile', folder: 'Gebäude', tags: ['fest'], solid: true, rows: '6665666h\n5555555h\nhhhhhhhh\n66h66656\n55h55555\nhhhhhhhh\n6665666h\n5555555h' },
  { name: 'Holzboden', kind: 'tile', folder: 'Gebäude', tags: ['boden'], rows: 'oooooooo\n44444444\noooo4ooo\noooo4ooo\n44444444\no4oooooo\no4oooooo\n44444444' },
  { name: 'Höhlenboden', kind: 'tile', folder: 'Höhle', tags: ['boden'], rows: 'gggggggg\nghgggggg\nggggghgg\ngggggggg\ngghggggg\nggggggug\ngggggggg\nggghgggg' },
  { name: 'Fels', kind: 'tile', folder: 'Höhle', tags: ['fest'], solid: true, rows: '5555555h\n5666665h\n566u665h\n5666665h\nhhhhhhhh\n55h55555\n66h66665\nhhhhhhhh' },
  { name: 'Held', kind: 'figur', folder: 'Figuren', tags: ['spieler'], rows: '...44...\n..4444..\n..f0f0..\n..ffff..\n.c8888c.\n.f8888f.\n..2..2..\n..4..4..' },
  { name: 'Oma', kind: 'figur', folder: 'Figuren', tags: ['figur'], rows: '..6666..\n.666666.\n..f0f0..\n..ffff..\n.dddddd.\nfdd88ddf\n.dddddd.\n..4..4..' },
  { name: 'Schleim', kind: 'figur', folder: 'Gegner', tags: ['gegner'], rows: '........\n...bb...\n..bbbb..\n.b7bb7b.\n.b0bb0b.\nbbbbbbbb\nbnbbbbnb\n.nnnnnn.' },
  { name: 'Fledermaus', kind: 'figur', folder: 'Gegner', tags: ['gegner'], rows: '........\n2......2\n22.22.22\n22222222\n.2a22a2.\n..2222..\n...22...\n........' },
  { name: 'Münze', kind: 'figur', folder: 'Gegenstände', tags: ['sammeln'], rows: '........\n..aaaa..\n.aassaa.\n.asaa7a.\n.asaasa.\n.aassaa.\n..aaaa..\n........' },
  { name: 'Schlüssel', kind: 'figur', folder: 'Gegenstände', tags: ['sammeln'], rows: '........\n.aaa....\na...a...\na...aaaa\na...a.a.\n.aaa..aa\n........\n........' },
  { name: 'Herz', kind: 'figur', folder: 'Gegenstände', tags: ['sammeln'], rows: '........\n.88.88..\n8e88888.\n8888888.\n.88888..\n..888...\n...8....\n........' },
  { name: 'Truhe', kind: 'figur', folder: 'Gegenstände', tags: ['sammeln'], rows: '........\n.pppppp.\npoooooop\npppaappp\npoooooop\npoooooop\npppppppp\n........' },
  { name: 'Tür', kind: 'figur', folder: 'Gebäude', tags: ['tuer'], rows: '.pppppp.\np444444p\np4o44o4p\np4o44o4p\np444a44p\np4o44o4p\np4o44o4p\np444444p' },
  { name: 'Tür offen', kind: 'figur', folder: 'Gebäude', tags: ['tuer'], rows: '.pppppp.\np000000p\np000000p\np000000p\np000000p\np000000p\np000000p\np000000p' },
  { name: 'Schild', kind: 'figur', folder: 'Gegenstände', tags: ['schild'], rows: '........\n.oooooo.\n.o4444o.\n.o4444o.\n.oooooo.\n...44...\n...44...\n...44...' },
  { name: 'Schalter', kind: 'figur', folder: 'Gegenstände', tags: ['schalter'], rows: '........\n........\n......4.\n.....4..\n....4...\n.555555.\n.588885.\n.555555.' },
  { name: 'Schalter an', kind: 'figur', folder: 'Gegenstände', tags: ['schalter'], rows: '........\n........\n.4......\n..4.....\n...4....\n.555555.\n.5bbbb5.\n.555555.' },
  { name: 'Kiste', kind: 'figur', folder: 'Gegenstände', tags: ['hindernis'], rows: 'pppppppp\npoooooop\npopoopop\npooppoop\npooppoop\npopoopop\npoooooop\npppppppp' },
];

// Zusätzliche Bilder für das Jump'n'Run
export const SPRITE_LIBRARY_JUMP = [
  { name: 'Boden', kind: 'tile', folder: 'Jump\'n\'Run', tags: ['fest'], solid: true, rows: 'bbbbbbbb\nbnbbbnbb\nn4nnn4nn\n44444444\n4o44444o\n44444444\n444o4444\n44444444' },
  { name: 'Erde', kind: 'tile', folder: 'Jump\'n\'Run', tags: ['fest'], solid: true, rows: '44444444\n4o44444o\n44444444\n444o4444\n44444444\n44o4444o\n44444444\n4444o444' },
  { name: 'Block', kind: 'tile', folder: 'Jump\'n\'Run', tags: ['fest'], solid: true, rows: 'ssssssss\nsaaaaaa9\nsa9aa9a9\nsaaaaaa9\nsaaaaaa9\nsa9aa9a9\nsaaaaaa9\n99999999' },
  { name: 'Stacheln', kind: 'tile', folder: 'Jump\'n\'Run', tags: ['gefahr'], rows: '........\n........\n...7...7\n..76..76\n..66..66\n.666.666\n.6666666\n55555555' },
  { name: 'Wolke', kind: 'tile', folder: 'Jump\'n\'Run', tags: ['deko'], rows: '........\n...77...\n..7777..\n.777777.\n77777777\n7t7777t7\n.tttttt.\n........' },
  { name: 'Knödel', kind: 'figur', folder: 'Gegner', tags: ['gegner'], rows: '........\n..oooo..\n.oooooo.\no7ooo7oo\no0ooo0oo\noooooooo\n.oooooo.\n.44..44.' },
  { name: 'Fahne', kind: 'figur', folder: 'Gegenstände', tags: ['ziel'], rows: '.6bbbb..\n.6bbbbb.\n.6bbbb..\n.6......\n.6......\n.6......\n.6......\n555.....' },
];

// ------------------------------------------------------------------ Klänge
// Eingebaute Effekte der Konsole (sfx("name")) mit deutscher Beschreibung
export const BUILTIN_SFX = [
  ['coin', 'Münze'], ['jump', 'Sprung'], ['hit', 'Treffer'], ['powerup', 'Verstärkung'], ['blip', 'Piep'], ['select', 'Auswahl'],
  ['back', 'Zurück'], ['explode', 'Explosion'], ['win', 'Gewonnen'], ['lose', 'Verloren'], ['step', 'Schritt'],
];
export const SOUND_LIBRARY = [
  { name: 'Tür knarrt', mml: 't200 w4 v8 l32 o3 c d e f g a' },
  { name: 'Zauber', mml: 't240 w1 v8 l32 o5 c g >c <g >c e g >c' },
  { name: 'Plopp', mml: 't240 w0 v9 l64 o6 c <c <c' },
  { name: 'Alarm', mml: 't180 w2 v8 l16 o5 a f a f a f' },
  { name: 'Glocke', mml: 't120 w3 v10 l8 o6 e <b4' },
];

// ------------------------------------------------------------------ Musik (je Stimme eine MML-Zeile, alle Stimmen gleich lang)
export const MUSIC_LIBRARY = [
  { name: 'Abenteuer', mood: 'heiter, für draußen', voices: [
    't140 w1 v7 l8 o5 c e g e f a g e d f a f e g f d c e g e f a >c< a g f e d c4 r4',
    't140 w3 v10 l4 o3 c g a f d a g g c g f a g g c r',
  ] },
  { name: 'Höhle', mood: 'dunkel und langsam', voices: [
    't90 w2 v6 l4 o4 a o5 c o4 b g+ a e f e d f e c o3 b o4 c o3 a2',
    't90 w3 v9 l2 o2 a e a e d a e a',
  ] },
  { name: 'Dorf', mood: 'gemütlich', voices: [
    't110 w0 v6 l8 o5 g4 e g a4 g4 f4 d f e2 e4 c e f4 a4 g4 f d c2',
    't110 w3 v9 l4 o3 c g e g <b >g d g c g f a g b c2',
  ] },
  { name: 'Spannung', mood: 'schnell, für Gefahr', voices: [
    't160 w1 v6 l16 o4 [e g a g]4 [d f g f]4 [c e f e]4 [d f g f]2 [d f+ g+ f+]2',
    't160 w3 v10 l8 o2 [a a >a< a]2 [g g >g< g]2 [f f >f< f]2 g g >g< g b b >b< b',
  ] },
  { name: 'Hüpfmusik', mood: 'fröhlich, zum Springen', voices: [
    't150 w1 v7 l8 o5 c d e g r e g r a g e c d4 r4 c d e g r e >c< r b a g f e4 r4',
    't150 w3 v10 l8 o3 [c r g r]2 [f r >c< r]2 [c r g r]2 g r b r >c< r r4',
  ] },
  { name: 'Ruhe', mood: 'leise, zum Nachdenken', voices: [
    't80 w3 v7 l2 o5 e d c <b >c <a b1',
    't80 w3 v6 l1 o3 c <a >f g',
  ] },
];

// ------------------------------------------------------------------ Bausteine für Projekte
function spritesFrom(lib, start = 1) {
  return lib.map((s, i) => ({ id: uid('s'), n: start + i, name: s.name, kind: s.kind, solid: !!s.solid, rows: s.rows, folder: s.folder, tags: [...(s.tags || [])] }));
}
const byName = (sprites, name) => sprites.find((s) => s.name === name)?.n || 0;

export function newObject(project, type, x, y, extra = {}) {
  const defs = {
    spieler: { sprite: 'Held', steuerbar: true, tempo: 1, schwerkraft: true },
    gegner: { sprite: 'Schleim', hinundher: 'waagerecht', tempo: 0.5, schwerkraft: true },
    sammel: { sprite: 'Münze' },
    tuer: { sprite: 'Tür offen', ziel: '', ankunft: '', verschlossen: false, bild_offen: 0 },
    figur: { sprite: 'Oma', fest: true, dialog: '' },
    schild: { sprite: 'Schild', fest: true, text: 'Hier könnte ein Hinweis stehen.' },
    schalter: { sprite: 'Schalter', an: false, bild_an: byName(project.sprites, 'Schalter an') },
    deko: { sprite: 'Kiste', fest: true },
  }[type] || {};
  const { sprite, ...props } = defs;
  const names = { spieler: 'Held', gegner: 'Gegner', sammel: 'Münze', tuer: 'Tür', figur: 'Figur', schild: 'Schild', schalter: 'Schalter', deko: 'Kiste' };
  return {
    id: uid('o'), type, name: names[type] || type, x, y,
    sprite: byName(project.sprites, sprite) || project.sprites.find((s) => s.kind === 'figur')?.n || 1,
    fest: false, steuerbar: false, hinundher: '', verfolgt: false, schwerkraft: false, versteckt: false, tempo: 1,
    ...props, ...extra,
  };
}

export function newScene(project, name, w = 30, h = 20, fill = 0) {
  return { id: uid('z'), name, w, h, color: 1, music: '', tiles: new Array(w * h).fill(fill), objects: [] };
}

function baseProject(title, mode) {
  return {
    format: '8boy-baukasten', version: 1, id: uid('p'), cartId: null,
    title, author: '', desc: '', color: 10, mode,
    created: Date.now(), updated: Date.now(),
    sprites: [], sounds: [], music: [], counters: [], scenes: [], startScene: '', rules: [], dialogs: [], blueprints: [],
  };
}
const counter = (name, start, icon) => ({ id: uid('c'), name, start, show: true, icon });
const rule = (trigger, conds, actions) => ({ id: uid('r'), on: true, trigger, conds, actions });
const T = (type, p = {}) => ({ type, p });
const C = (type, p = {}, not = false) => ({ type, p, not });

// Kartenhilfe: Rechtecke füllen
function painter(scene) {
  const set = (x, y, n) => { if (x >= 0 && y >= 0 && x < scene.w && y < scene.h) scene.tiles[y * scene.w + x] = n; };
  return {
    set,
    rect(x0, y0, x1, y1, n) { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) set(x, y, n); },
    border(n) { for (let x = 0; x < scene.w; x++) { set(x, 0, n); set(x, scene.h - 1, n); } for (let y = 0; y < scene.h; y++) { set(0, y, n); set(scene.w - 1, y, n); } },
  };
}

// ------------------------------------------------------------------ Vorlage 1: Top-Down-Abenteuer
export function topDownProject() {
  const p = baseProject('Das Schatz-Abenteuer', 'draufsicht');
  p.desc = 'Hilf dem Helden, den Schatz in der Höhle zu finden.';
  p.sprites = spritesFrom(SPRITE_LIBRARY);
  const S = (n) => byName(p.sprites, n);
  p.sounds = SOUND_LIBRARY.slice(0, 2).map((s) => ({ id: uid('k'), ...s }));
  p.music = [MUSIC_LIBRARY[0], MUSIC_LIBRARY[1]].map((m) => ({ id: uid('m'), name: m.name, voices: [...m.voices] }));
  p.counters = [counter('Punkte', 0, S('Münze')), counter('Leben', 3, S('Herz')), counter('Schlüssel', 0, S('Schlüssel'))];
  const [punkte, leben, schluessel] = p.counters.map((c) => c.id);

  // Szene 1: Wiese
  const wiese = newScene(p, 'Wiese', 30, 20, S('Gras'));
  wiese.music = p.music[0].id;
  let m = painter(wiese);
  m.border(S('Baum'));
  m.rect(21, 1, 28, 6, S('Fels'));          // Felsen mit der Höhle
  m.rect(3, 10, 25, 10, S('Weg'));          // Weg quer über die Wiese
  m.rect(25, 6, 25, 10, S('Weg'));
  m.rect(12, 13, 16, 16, S('Wasser'));      // Teich
  m.rect(13, 12, 15, 12, S('Wasser'));
  m.rect(13, 17, 15, 17, S('Wasser'));
  for (const [x, y] of [[3, 3], [4, 3], [3, 4], [7, 15], [8, 16], [20, 4], [9, 2], [18, 15], [2, 16], [26, 15]]) m.set(x, y, S('Baum'));
  for (const [x, y] of [[5, 5], [6, 13], [10, 7], [17, 6], [19, 13], [23, 15], [4, 17], [27, 12], [11, 17]]) m.set(x, y, S('Blumen'));
  wiese.objects = [
    newObject(p, 'spieler', 4, 10),
    newObject(p, 'figur', 8, 6, { name: 'Oma' }),
    newObject(p, 'schild', 6, 9, { name: 'Wegweiser', text: 'Willkommen in Moosbach!\nSammle Münzen und sprich mit Oma.' }),
    ...[[10, 4], [14, 6], [18, 12], [20, 16], [5, 15], [27, 14]].map(([x, y]) => newObject(p, 'sammel', x, y, { name: 'Münze' })),
    newObject(p, 'gegner', 15, 8, { name: 'Schleim', sprite: S('Schleim'), hinundher: 'waagerecht', tempo: 0.5 }),
    newObject(p, 'gegner', 21, 13, { name: 'Schleim', sprite: S('Schleim'), hinundher: 'senkrecht', tempo: 0.4 }),
    newObject(p, 'sammel', 11, 14, { name: 'Schlüssel', sprite: S('Schlüssel'), versteckt: true }),
    newObject(p, 'tuer', 25, 6, { name: 'Höhlentür', sprite: S('Tür'), bild_offen: S('Tür offen'), verschlossen: true, fest: true }),
  ];
  // Szene 2: Höhle
  const hoehle = newScene(p, 'Höhle', 30, 20, S('Höhlenboden'));
  hoehle.color = 0;
  hoehle.music = p.music[1].id;
  m = painter(hoehle);
  m.border(S('Fels'));
  m.rect(1, 1, 28, 2, S('Fels'));
  m.rect(6, 6, 8, 8, S('Fels')); m.rect(21, 6, 23, 8, S('Fels'));
  m.rect(6, 13, 8, 15, S('Fels')); m.rect(21, 13, 23, 15, S('Fels'));
  m.rect(11, 10, 18, 10, S('Fels'));
  m.rect(13, 3, 16, 5, S('Holzboden'));
  hoehle.objects = [
    newObject(p, 'tuer', 14, 18, { name: 'Ausgang', sprite: S('Tür offen') }),
    ...[[4, 4], [25, 4], [4, 17], [25, 17], [14, 12]].map(([x, y]) => newObject(p, 'sammel', x, y, { name: 'Münze' })),
    newObject(p, 'gegner', 10, 4, { name: 'Fledermaus', sprite: S('Fledermaus'), hinundher: '', verfolgt: true, tempo: 0.4, schwerkraft: false }),
    newObject(p, 'gegner', 19, 12, { name: 'Schleim', sprite: S('Schleim'), hinundher: 'senkrecht', tempo: 0.5 }),
    newObject(p, 'sammel', 14, 4, { name: 'Schatz', sprite: S('Truhe') }),
  ];
  wiese.objects.find((o) => o.name === 'Höhlentür').ziel = hoehle.id;
  wiese.objects.find((o) => o.name === 'Höhlentür').ankunft = 'Ausgang';
  hoehle.objects[0].ziel = wiese.id;
  hoehle.objects[0].ankunft = 'Höhlentür';
  p.scenes = [wiese, hoehle];
  p.startScene = wiese.id;

  // Dialog mit Oma
  const ids = [uid('k'), uid('k'), uid('k'), uid('k'), uid('k')];
  const oma = S('Oma');
  p.dialogs = [{
    id: uid('d'), name: 'Oma', start: ids[0], cards: [
      { id: ids[0], who: 'Oma', portrait: oma, text: 'Hallo, kleiner Held! Willkommen in Moosbach.', next: ids[1], choices: [], x: 20, y: 40 },
      { id: ids[1], who: 'Oma', portrait: oma, text: 'In der Höhle im Osten liegt ein alter Schatz. Aber die Tür ist verschlossen.', next: ids[2], choices: [], x: 250, y: 40 },
      { id: ids[2], who: 'Oma', portrait: oma, text: 'Soll ich dir meinen Schlüssel geben?', next: '', choices: [{ text: 'Ja, gern!', next: ids[3] }, { text: 'Nein, danke.', next: ids[4] }], x: 480, y: 40 },
      { id: ids[3], who: 'Oma', portrait: oma, text: 'Hier! Ich lege ihn dir an den Teich. Pass auf die Schleime auf!', next: '', choices: [], x: 710, y: 10 },
      { id: ids[4], who: 'Oma', portrait: oma, text: 'Na gut. Komm wieder, wenn du es dir anders überlegst.', next: '', choices: [], x: 710, y: 210 },
    ],
  }];
  wiese.objects.find((o) => o.name === 'Oma').dialog = p.dialogs[0].id;

  p.rules = [
    rule(T('start'), [], [T('text', { text: 'Finde den Schatz in der Höhle!', sec: 3 })]),
    rule(T('touch', { what: 'name:Münze' }), [], [T('hide', { what: 'this' }), T('counter_add', { counter: punkte, sign: '+', value: 1 }), T('sfx', { sound: 'coin' })]),
    rule(T('choice', { dialog: p.dialogs[0].id, choice: ids[2] + ':0' }), [], [T('show', { what: 'Schlüssel' }), T('sfx', { sound: 'powerup' })]),
    rule(T('touch', { what: 'name:Schlüssel' }), [], [T('hide', { what: 'this' }), T('counter_add', { counter: schluessel, sign: '+', value: 1 }), T('sfx', { sound: 'powerup' }), T('text', { text: 'Du hast einen Schlüssel!', sec: 2 })]),
    rule(T('touch', { what: 'name:Höhlentür' }), [C('counter', { counter: schluessel, op: '>=', value: 1 })], [T('open_door', { what: 'this' }), T('counter_add', { counter: schluessel, sign: '-', value: 1 }), T('sfx', { sound: 'u:' + p.sounds[0].id })]),
    rule(T('touch', { what: 'art:gegner' }), [C('unprotected')], [T('counter_add', { counter: leben, sign: '-', value: 1 }), T('sfx', { sound: 'hit' }), T('pushback', { what: 'this' }), T('protect', { sec: 1.5 }), T('shake', { sec: 0.3 })]),
    rule(T('counter', { counter: leben, op: '<=', value: 0 }), [], [T('lose', { text: 'Keine Herzen mehr!' })]),
    rule(T('touch', { what: 'name:Schatz' }), [], [T('hide', { what: 'this' }), T('win', { text: 'Du hast den Schatz gefunden!' })]),
  ];
  return p;
}

// ------------------------------------------------------------------ Vorlage 2: Jump'n'Run
export function jumpProject() {
  const p = baseProject('Hüpf-Abenteuer', 'seitlich');
  p.desc = 'Lauf, spring und erreiche die Fahne.';
  p.color = 8;
  const base = SPRITE_LIBRARY.filter((s) => ['Held', 'Münze', 'Herz', 'Schild', 'Schleim', 'Tür offen', 'Schalter', 'Schalter an', 'Kiste'].includes(s.name));
  p.sprites = spritesFrom([...SPRITE_LIBRARY_JUMP, ...base]);
  const S = (n) => byName(p.sprites, n);
  p.music = [MUSIC_LIBRARY[4]].map((m) => ({ id: uid('m'), name: m.name, voices: [...m.voices] }));
  p.counters = [counter('Punkte', 0, S('Münze')), counter('Leben', 3, S('Herz'))];
  const [punkte, leben] = p.counters.map((c) => c.id);
  const lvl = newScene(p, 'Level 1', 60, 20, 0);
  lvl.color = 12;
  lvl.music = p.music[0].id;
  const m = painter(lvl);
  m.rect(0, 17, 59, 17, S('Boden')); m.rect(0, 18, 59, 19, S('Erde'));
  m.rect(14, 17, 16, 19, 0);                         // Grube
  m.rect(14, 19, 16, 19, S('Stacheln'));
  m.rect(30, 16, 32, 16, S('Stacheln'));
  m.rect(8, 13, 11, 13, S('Block')); m.rect(19, 11, 22, 11, S('Block')); m.rect(26, 13, 28, 13, S('Block'));
  m.rect(36, 14, 38, 16, S('Boden')); m.rect(36, 15, 38, 16, S('Erde'));
  m.rect(42, 11, 45, 11, S('Block')); m.rect(50, 14, 51, 16, S('Boden')); m.rect(50, 15, 51, 16, S('Erde'));
  for (const [x, y] of [[4, 3], [17, 5], [33, 3], [47, 6], [56, 2]]) { m.set(x, y, S('Wolke')); m.set(x + 1, y, S('Wolke')); }
  lvl.objects = [
    newObject(p, 'spieler', 2, 15),
    newObject(p, 'schild', 5, 16, { name: 'Tipp', text: 'A springt. Lange halten = höher!\nSpring den Knödeln auf den Kopf.' }),
    ...[[9, 12], [10, 12], [20, 10], [21, 10], [27, 12], [37, 13], [43, 10], [44, 10], [50, 13]].map(([x, y]) => newObject(p, 'sammel', x, y, { name: 'Münze' })),
    newObject(p, 'gegner', 23, 16, { name: 'Knödel', sprite: S('Knödel'), tempo: 0.5 }),
    newObject(p, 'gegner', 41, 16, { name: 'Knödel', sprite: S('Knödel'), tempo: 0.6 }),
    newObject(p, 'deko', 57, 16, { name: 'Fahne', sprite: S('Fahne'), fest: false }),
  ];
  p.scenes = [lvl];
  p.startScene = lvl.id;
  p.rules = [
    rule(T('start'), [], [T('text', { text: 'Lauf nach rechts zur Fahne!', sec: 3 })]),
    rule(T('touch', { what: 'name:Münze' }), [], [T('hide', { what: 'this' }), T('counter_add', { counter: punkte, sign: '+', value: 1 }), T('sfx', { sound: 'coin' })]),
    rule(T('touch', { what: 'art:gegner' }), [C('stomp')], [T('hide', { what: 'this' }), T('bounce'), T('counter_add', { counter: punkte, sign: '+', value: 5 }), T('sfx', { sound: 'hit' })]),
    rule(T('touch', { what: 'art:gegner' }), [C('stomp', {}, true), C('unprotected')], [T('counter_add', { counter: leben, sign: '-', value: 1 }), T('sfx', { sound: 'hit' }), T('pushback', { what: 'this' }), T('protect', { sec: 1.5 })]),
    rule(T('tile', { tile: S('Stacheln') }), [], [T('counter_add', { counter: leben, sign: '-', value: 1 }), T('sfx', { sound: 'hit' }), T('respawn'), T('protect', { sec: 1 })]),
    rule(T('counter', { counter: leben, op: '<=', value: 0 }), [], [T('lose', { text: 'Keine Leben mehr!' })]),
    rule(T('touch', { what: 'name:Fahne' }), [], [T('win', { text: 'Ziel erreicht!' })]),
  ];
  return p;
}

// Leeres Projekt (nur Bilder und Musik, eine Szene mit Spieler)
export function emptyProject(mode = 'draufsicht') {
  const p = baseProject('Mein Spiel', mode);
  p.sprites = spritesFrom(mode === 'seitlich' ? [...SPRITE_LIBRARY_JUMP, ...SPRITE_LIBRARY] : SPRITE_LIBRARY);
  p.music = [MUSIC_LIBRARY[0]].map((m) => ({ id: uid('m'), name: m.name, voices: [...m.voices] }));
  p.counters = [counter('Punkte', 0, byName(p.sprites, 'Münze'))];
  const sc = newScene(p, 'Szene 1', 30, 20, byName(p.sprites, mode === 'seitlich' ? 0 : 'Gras'));
  if (mode === 'seitlich') { sc.color = 12; painter(sc).rect(0, 18, 29, 19, byName(p.sprites, 'Boden')); }
  sc.objects = [newObject(p, 'spieler', 3, mode === 'seitlich' ? 16 : 9)];
  p.scenes = [sc];
  p.startScene = sc.id;
  return p;
}

export const TEMPLATES = [
  { id: 'topdown', name: 'Top-Down-Abenteuer', desc: 'Von oben gesehen: Wiese, Höhle, Oma mit Dialog, Schlüssel und Schatz.', make: topDownProject },
  { id: 'jump', name: 'Jump\'n\'Run', desc: 'Von der Seite: laufen, springen, Münzen, Knödel und eine Zielfahne.', make: jumpProject },
  { id: 'leer-oben', name: 'Leer – von oben', desc: 'Nur ein Spieler auf der Wiese. Alles andere baust du selbst.', make: () => emptyProject('draufsicht') },
  { id: 'leer-seite', name: 'Leer – von der Seite', desc: 'Ein Boden, ein Spieler, Schwerkraft. Der Rest ist deins.', make: () => emptyProject('seitlich') },
];
