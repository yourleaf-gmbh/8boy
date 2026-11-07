// Bereich „Assets“: Bilder (Kacheln und Figuren) mit dem Malprogramm des Studios, Klänge und Musik mit Vorhören.
import { h, field, textInput, select, check, button, spriteImg, spriteCanvas, spriteURL, toast, confirmBox } from './ui.js';
import { createPixelEditor } from '../pixel-editor.js';
import { BUILTIN_SFX, SOUND_LIBRARY, MUSIC_LIBRARY, uid } from './templates.js';
import { uniqueName } from './sec-scenes.js';

const TABS = [['bilder', 'Bilder'], ['klaenge', 'Klänge'], ['musik', 'Musik']];
const EMPTY8 = '........\n'.repeat(8).trim();

export function freeSpriteNo(p) {
  const used = new Set(p.sprites.map((s) => s.n));
  for (let n = 1; n < 256; n++) if (!used.has(n)) return n;
  return 0;
}

export function render(ctx) {
  const { main, store, app } = ctx;
  const ui = store.ui;
  ui.assetTab ||= 'bilder';
  main.append(h('div.tabs.as-tabs', { role: 'tablist' }, TABS.map(([id, label]) => h('button.tab', { type: 'button', role: 'tab', 'aria-selected': String(ui.assetTab === id), class: ui.assetTab === id ? 'on' : '', onclick: () => app.go('assets', { assetTab: id }) }, label))));
  if (ui.assetTab === 'klaenge') return renderSounds(ctx);
  if (ui.assetTab === 'musik') return renderMusic(ctx);
  return renderSprites(ctx);
}

// ------------------------------------------------------------------ Bilder
function renderSprites({ main, side, store, app }) {
  const p = store.project;
  const ui = store.ui;
  ui.spriteFilter ||= 'alle';
  if (ui.newKind) {
    const kind = ui.newKind; ui.newKind = null;
    const n = freeSpriteNo(p);
    if (n) {
      const s = { id: uid('s'), n, name: kind === 'tile' ? 'Neue Kachel' : 'Neues Bild', kind, solid: false, rows: kind === 'tile' ? 'bbbbbbbb\n'.repeat(8).trim() : EMPTY8, folder: kind === 'tile' ? 'Eigene Kacheln' : 'Eigene Bilder', tags: [] };
      store.edit(() => p.sprites.push(s), { render: false });
      ui.spriteN = n;
    }
  }
  let spr = p.sprites.find((s) => s.n === ui.spriteN) || p.sprites[0];
  ui.spriteN = spr?.n;

  const tags = [...new Set(p.sprites.flatMap((s) => s.tags || []))].sort();
  const filters = [['alle', 'Alle'], ['tile', 'Kacheln'], ['figur', 'Figuren'], ...tags.map((t) => ['#' + t, '#' + t])];
  const match = (s) => ui.spriteFilter === 'alle' || (ui.spriteFilter === 'tile' && s.kind === 'tile') || (ui.spriteFilter === 'figur' && s.kind === 'figur') || (ui.spriteFilter.startsWith('#') && (s.tags || []).includes(ui.spriteFilter.slice(1)));
  const folders = new Map();
  for (const s of p.sprites.filter(match)) {
    const f = s.folder || 'Ohne Ordner';
    if (!folders.has(f)) folders.set(f, []);
    folders.get(f).push(s);
  }
  const lib = h('div.as-lib', { dataset: { scroll: 'aslib' } },
    h('div.chips', filters.map(([id, label]) => h('button.chip', { type: 'button', class: ui.spriteFilter === id ? 'on' : '', onclick: () => { ui.spriteFilter = id; app.refresh(); } }, label))),
    h('div.row', button('+ Kachel', () => app.go('assets', { newKind: 'tile' }), 'small'), button('+ Figur / Gegenstand', () => app.go('assets', { newKind: 'figur' }), 'small')),
    [...folders].map(([f, list]) => h('section.folder', h('h4', f, h('small', list.length)),
      h('div.spr-grid', list.map((s) => h('button.spr-b', { type: 'button', title: `${s.n}: ${s.name}`, class: s.n === spr?.n ? 'on' : '', dataset: { n: s.n }, onclick: () => { ui.spriteN = s.n; app.refresh(); } },
        spriteImg(s, 40), h('span', s.name)))))));
  if (!folders.size) lib.append(h('p.empty', 'Kein Bild passt zu diesem Filter.'));

  const edRoot = h('div.as-paint');
  const previews = h('div.as-prev');
  main.append(h('div.as-body', lib, h('div.as-ed', h('div.as-ed-h', h('h2', spr ? spr.name : 'Kein Bild'), spr ? h('span.muted', `Bild Nr. ${spr.n} · im Code: sprite(${spr.n}, …)`) : null), edRoot, previews)));

  function drawPreviews() {
    previews.textContent = '';
    if (!spr) return;
    previews.append(h('figure', spriteCanvas(spr.rows, 1), h('figcaption', '1×')), h('figure', spriteCanvas(spr.rows, 3), h('figcaption', '3×')));
    if (spr.kind === 'tile') {
      const tiled = h('div.tiled', { style: { backgroundImage: `url(${spriteURL(spr.rows, 3)})` } });
      previews.append(h('figure', tiled, h('figcaption', 'als Fläche')));
    }
  }
  if (spr) {
    const ed = createPixelEditor(edRoot, {
      sizes: [8, 16],
      onChange: (rows) => {
        store.edit(() => { spr.rows = rows; }, { merge: 'px' + spr.id, render: false });
        const img = lib.querySelector(`.spr-b[data-n="${spr.n}"] img`);
        if (img) img.src = spriteURL(rows, 4);
        drawPreviews();
      },
    });
    ed.load(spr.rows);
    requestAnimationFrame(() => ed.render());
    drawPreviews();
  }

  // rechts
  if (!spr) { side.append(h('div.side-empty', h('h3', 'Bilder'), h('p', 'Lege links ein neues Bild an.'))); return; }
  const q = (fn, key) => store.edit(fn, { merge: key + spr.id, render: false });
  const usedTiles = p.scenes.filter((s) => s.tiles.includes(spr.n)).map((s) => s.name);
  const usedObjs = p.scenes.flatMap((s) => s.objects.filter((o) => o.sprite === spr.n).map((o) => o.name));
  side.append(h('h3', 'Bild ' + spr.n),
    field('Name', textInput(spr.name, (v) => q(() => { spr.name = v; }, 'n'), { maxlength: 24, dataset: { fid: 'sp-name' }, onchange: () => app.refresh() })),
    field('Art', select([['tile', 'Kachel (für die Karte)'], ['figur', 'Figur / Gegenstand (für Objekte)']], spr.kind, (v) => store.edit(() => { spr.kind = v; if (v !== 'tile') spr.solid = false; }))),
    spr.kind === 'tile' ? check('fest – man kommt nicht hindurch', spr.solid, (v) => store.edit(() => { spr.solid = v; }), 'Wände, Wasser, Bäume. Im Code: fset(' + spr.n + ', 0, true)') : '',   // '' statt null: append() schriebe sonst „null“
    field('Ordner', h('input', { type: 'text', value: spr.folder || '', list: 'folders', maxlength: 24, dataset: { fid: 'sp-folder' }, oninput: (e) => q(() => { spr.folder = e.target.value; }, 'f'), onchange: () => app.refresh() }),
      h('datalist#folders', [...new Set(p.sprites.map((s) => s.folder).filter(Boolean))].map((f) => h('option', { value: f })))),
    field('Schlagwörter', textInput((spr.tags || []).join(', '), (v) => q(() => { spr.tags = v.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean); }, 't'), { placeholder: 'z.B. wald, gefahr', dataset: { fid: 'sp-tags' }, onchange: () => app.refresh() }), 'Mit Komma trennen. Oben links kannst du danach filtern.'),
    h('h4', 'Benutzt in'),
    usedTiles.length || usedObjs.length ? h('ul.rel', usedTiles.map((n) => h('li', 'Karte: ' + n)), [...new Set(usedObjs)].map((n) => h('li', 'Objekt: ' + n))) : h('p.muted.small', 'Noch nirgends.'),
    h('div.col',
      button('Duplizieren', () => {
        const n = freeSpriteNo(p);
        if (!n) return toast('Alle 255 Bildnummern sind belegt.', 'err');
        store.edit(() => p.sprites.push({ ...JSON.parse(JSON.stringify(spr)), id: uid('s'), n, name: uniqueName(p.sprites.map((s) => s.name), spr.name) }));
        ui.spriteN = n;
      }, 'small wide'),
      button('Löschen', async () => {
        if ((usedTiles.length || usedObjs.length) && !(await confirmBox(`„${spr.name}“ wird benutzt. Trotzdem löschen? Karten-Kacheln werden leer.`, 'Löschen'))) return;
        store.edit(() => {
          p.sprites = p.sprites.filter((s) => s !== spr);
          for (const sc of p.scenes) { sc.tiles = sc.tiles.map((t) => (t === spr.n ? 0 : t)); for (const o of sc.objects) if (o.sprite === spr.n) o.sprite = p.sprites.find((s) => s.kind === 'figur')?.n || 0; }
          for (const c of p.counters) if (c.icon === spr.n) c.icon = 0;
        });
        ui.spriteN = null;
      }, 'small danger wide')));
}

// ------------------------------------------------------------------ Klänge
function renderSounds({ main, side, store, app }) {
  const p = store.project;
  const audio = app.audio;
  const play = (mml) => { audio.stop(); audio.play(mml, 3, false); };
  const page = h('div.pg', { dataset: { scroll: 'sounds' } });
  main.append(page);
  page.append(h('h2', 'Eingebaute Klänge'), h('p.muted', 'Hat jede Konsole schon dabei. Im Code: sfx("coin").'),
    h('div.sfx-grid', BUILTIN_SFX.map(([k, label]) => h('button.sfx-b', { type: 'button', onclick: () => { audio.stop(); audio.sfx(k); } }, h('i.play'), h('b', label), h('code', k)))));
  page.append(h('div.h2row', h('h2', 'Eigene Klänge'), button('+ Klang', () => store.edit(() => p.sounds.push({ id: uid('k'), name: uniqueName(p.sounds.map((s) => s.name), 'Mein Klang'), mml: 't200 w1 v9 l16 o5 c e g' })), 'small')));
  if (!p.sounds.length) page.append(h('p.empty', 'Noch keine eigenen Klänge. Nimm einen aus der Sammlung oder schreib selbst ein paar Noten.'));
  for (const s of p.sounds) {
    const q = (fn, key) => store.edit(fn, { merge: key + s.id, render: false });
    page.append(h('div.snd-row',
      h('button.ib.playb', { type: 'button', title: 'Anhören', 'aria-label': 'Anhören', onclick: () => play(s.mml) }, h('i.play')),
      textInput(s.name, (v) => q(() => { s.name = v; }, 'n'), { 'aria-label': 'Name', maxlength: 24, class: 'snd-name', dataset: { fid: 'sn-' + s.id } }),
      textInput(s.mml, (v) => q(() => { s.mml = v; }, 'm'), { 'aria-label': 'Noten (MML)', class: 'mml', dataset: { fid: 'sm-' + s.id }, onkeydown: (e) => { if (e.key === 'Enter') play(s.mml); } }),
      h('button.x', { type: 'button', title: 'Klang löschen', 'aria-label': 'Klang löschen', onclick: () => store.edit(() => { p.sounds = p.sounds.filter((x) => x !== s); }) }, '✕')));
  }
  page.append(h('h2', 'Aus der Sammlung'),
    h('div.mus-lib', SOUND_LIBRARY.map((s) => h('div.lib-snd',
      h('button.ib.playb', { type: 'button', title: 'Anhören', 'aria-label': 'Anhören: ' + s.name, onclick: () => play(s.mml) }, h('i.play')),
      h('b', s.name),
      button(p.sounds.some((x) => x.name === s.name) ? 'dabei' : '+ nehmen', () => store.edit(() => p.sounds.push({ id: uid('k'), ...s })), 'small ghost', { disabled: p.sounds.some((x) => x.name === s.name) })))));
  side.append(mmlHelp());
}

// ------------------------------------------------------------------ Musik
function renderMusic({ main, side, store, app }) {
  const p = store.project;
  const audio = app.audio;
  let playing = null;
  const playPiece = (m, btn) => {
    audio.stop();
    document.querySelectorAll('.playb.on').forEach((b) => b.classList.remove('on'));
    if (playing === m) { playing = null; return; }
    playing = m;
    m.voices.slice(0, 3).forEach((v, i) => audio.play(v, i, true));
    btn?.classList.add('on');
  };
  const page = h('div.pg', { dataset: { scroll: 'music' } });
  main.append(page);
  page.append(h('div.h2row', h('h2', 'Musik im Spiel'), button('+ Leeres Stück', () => store.edit(() => p.music.push({ id: uid('m'), name: uniqueName(p.music.map((m) => m.name), 'Mein Lied'), voices: ['t120 w1 v7 l4 o5 c e g e', 't120 w3 v9 l2 o3 c g'] })), 'small')));
  if (!p.music.length) page.append(h('p.empty', 'Noch keine Musik. Nimm unten ein Stück aus der Sammlung – danach kannst du es einer Szene geben.'));
  for (const m of p.music) {
    const used = p.scenes.filter((s) => s.music === m.id).map((s) => s.name);
    const q = (fn, key) => store.edit(fn, { merge: key + m.id, render: false });
    page.append(h('article.mus',
      h('div.mus-h',
        h('button.ib.playb', { type: 'button', title: 'Abspielen / Anhalten', 'aria-label': 'Abspielen: ' + m.name, onclick: (e) => playPiece(m, e.currentTarget) }, h('i.play')),
        textInput(m.name, (v) => q(() => { m.name = v; }, 'n'), { 'aria-label': 'Name', maxlength: 24, class: 'mus-name', dataset: { fid: 'mn-' + m.id }, onchange: () => app.refresh() }),
        h('span.muted.small', used.length ? 'läuft in: ' + used.join(', ') : 'noch in keiner Szene'),
        h('button.x', { type: 'button', title: 'Stück löschen', 'aria-label': 'Stück löschen', onclick: () => store.edit(() => { p.music = p.music.filter((x) => x !== m); for (const s of p.scenes) if (s.music === m.id) s.music = ''; }) }, '✕')),
      m.voices.map((v, i) => h('label.voice', h('span', 'Stimme ' + (i + 1)), h('textarea.mml', { rows: 2, spellcheck: false, dataset: { fid: `mv-${m.id}-${i}` }, oninput: (e) => q(() => { m.voices[i] = e.target.value; }, 'v' + i) }, v))),
      m.voices.length < 3 ? button('+ Stimme', () => store.edit(() => m.voices.push('t120 w0 v5 l4 o4 r1')), 'small ghost') : null));
  }
  page.append(h('h2', 'Aus der Sammlung'), h('p.muted', 'Fertige Stücke mit zwei Stimmen. Anhören, dann ins Spiel nehmen.'),
    h('div.mus-lib', MUSIC_LIBRARY.map((m) => h('div.lib-mus',
      h('button.ib.playb', { type: 'button', title: 'Anhören', 'aria-label': 'Anhören: ' + m.name, onclick: (e) => playPiece(m, e.currentTarget) }, h('i.play')),
      h('div', h('b', m.name), h('small', m.mood)),
      button(p.music.some((x) => x.name === m.name) ? 'dabei' : '+ nehmen', () => store.edit(() => p.music.push({ id: uid('m'), name: m.name, voices: [...m.voices] })), 'small ghost', { disabled: p.music.some((x) => x.name === m.name) })))));
  side.append(mmlHelp(true));
  return () => audio.stop();
}

function mmlHelp(music) {
  return h('div.help',
    h('h3', 'Noten schreiben (MML)'),
    h('p.small', 'Klänge und Musik sind kurze Notentexte. Probier einfach etwas aus und hör es dir an.'),
    h('dl.mml-help',
      ...[['c d e f g a b', 'Noten, + oder # macht sie höher (c+)'], ['r', 'Pause'], ['o4', 'Oktave 0–8, < und > eine tiefer/höher'], ['l8', 'Länge: 1 ganz, 4 Viertel, 8 Achtel, 16 …'], ['c4.', 'Note mit eigener Länge, Punkt = 1½'], ['t120', 'Tempo (Schläge pro Minute)'], ['v10', 'Lautstärke 0–15'], ['w1', 'Klangfarbe: 0 1 2 Puls, 3 Dreieck, 4 Säge, 5 Rauschen'], ['[c e g]3', 'Wiederholen']].flatMap(([k, v]) => [h('dt', h('code', k)), h('dd', v)])),
    music ? h('p.small.muted', 'Alle Stimmen eines Stücks sollten gleich lang sein, sonst laufen sie auseinander.') : null);
}
