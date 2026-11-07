// Bereich „Projekt“: neues Spiel aus Vorlage, eigene Spiele öffnen, Titel/Autor/Etikett, Export und Import.
import { h, field, textInput, colorPicker, select, button, spriteCanvas, hex, toast, confirmBox, download } from './ui.js';
import { TEMPLATES } from './templates.js';
import { sceneCanvas } from './mapdraw.js';

// Die Kartridge, wie sie im Regal liegt
export function cartPreview(p, big = false) {
  const start = p.scenes.find((s) => s.id === p.startScene) || p.scenes[0];
  const pl = start?.objects.find((o) => o.type === 'spieler');
  const spr = p.sprites.find((s) => s.n === pl?.sprite);
  return h('div.cart' + (big ? '.big' : ''), { 'aria-label': 'Kartridge: ' + p.title },
    h('div.cart-top', h('span'), h('span'), h('span')),
    h('div.cart-label', { style: { background: hex(p.color) } },
      spr ? spriteCanvas(spr.rows, big ? 5 : 3) : null,
      h('div.cart-t', h('b', p.title || 'Unbenannt'), h('small', p.author || 'Baukasten'))),
    h('div.cart-foot', '8BOY'));
}

const ago = (t) => {
  const s = (Date.now() - t) / 1000;
  if (s < 60) return 'gerade eben';
  if (s < 3600) return `vor ${Math.round(s / 60)} Min.`;
  if (s < 86400) return `vor ${Math.round(s / 3600)} Std.`;
  return new Date(t).toLocaleDateString('de-DE');
};

export function render({ main, side, store, app }) {
  const p = store.project;
  const page = h('div.pg', { dataset: { scroll: 'projekt' } });
  main.append(page);

  if (p) {
    const nRules = p.rules.length, nScenes = p.scenes.length, nDlg = p.dialogs.length;
    page.append(h('section.proj-hero',
      cartPreview(p, true),
      h('div.proj-hero-t',
        h('h1', p.title || 'Unbenannt'),
        h('p.muted', p.desc || 'Noch keine Beschreibung – rechts kannst du eine schreiben.'),
        h('ul.stats', h('li', h('b', nScenes), nScenes === 1 ? ' Szene' : ' Szenen'), h('li', h('b', nRules), nRules === 1 ? ' Regel' : ' Regeln'), h('li', h('b', nDlg), nDlg === 1 ? ' Dialog' : ' Dialoge'), h('li', h('b', p.sprites.length), ' Bilder')),
        h('div.row',
          button('Szenen bearbeiten', () => app.go('szenen'), 'primary'),
          button('Spielen', () => app.play())))));
  } else {
    page.append(h('section.empty-hero',
      h('h1', 'Bau dein eigenes 8BOY-Spiel'),
      h('p', 'Such dir unten eine Vorlage aus. Du malst Karten, setzt Figuren hinein und legst mit Regeln fest, was passiert. Heraus kommt eine echte Kartridge für die Konsole – mit Lua-Code, den du lesen kannst.')));
  }

  // Vorlagen
  page.append(h('h2', 'Neues Spiel beginnen'));
  const grid = h('div.tpl-grid');
  for (const t of TEMPLATES) {
    const demo = t.make();
    const sc = demo.scenes[0];
    const thumb = sceneCanvas(demo, sc, 1);
    thumb.style.width = '100%'; thumb.style.height = '100%';
    grid.append(h('button.tpl', { type: 'button', dataset: { tpl: t.id }, onclick: async () => {
      if (p && !(await confirmBox(`Neues Spiel „${t.name}“ anlegen? Dein aktuelles Spiel bleibt gespeichert.`, 'Anlegen'))) return;
      store.create(t.id);
      toast(`„${t.name}“ angelegt.`);
      app.go('szenen', { sceneId: null, objId: null });
    } }, h('div.tpl-pic', thumb), h('b', t.name), h('small', t.desc)));
  }
  page.append(grid);

  // Eigene Spiele
  const list = store.list;
  page.append(h('div.h2row', h('h2', 'Meine Spiele'), h('label.btn.ghost', 'Datei laden (.json)', h('input', { type: 'file', accept: '.json,application/json', hidden: true, onchange: async (e) => {
    const f = e.target.files[0]; e.target.value = '';
    if (!f) return;
    try { const np = store.importJSON(await f.text()); toast(`„${np.title}“ geladen.`); app.go('szenen'); } catch (err) { toast(err.message || 'Die Datei ließ sich nicht lesen.', 'err'); }
  } }))));
  if (!list.length) page.append(h('p.empty', 'Noch keine eigenen Spiele. Fang oben mit einer Vorlage an.'));
  const plist = h('div.proj-list');
  for (const q of list) {
    const sc = q.scenes.find((s) => s.id === q.startScene) || q.scenes[0];
    const thumb = sc ? sceneCanvas(q, sc, 0.5) : h('div');
    plist.append(h('div.proj-card' + (q.id === p?.id ? '.on' : ''),
      h('button.proj-open', { type: 'button', title: 'Öffnen', onclick: () => { store.open(q.id); app.go('szenen'); } }, h('div.proj-thumb', thumb),
        h('span', h('b', q.title || 'Unbenannt'), h('small', `${q.scenes.length} Szenen · ${q.rules.length} Regeln · ${ago(q.updated)}`))),
      h('div.proj-acts',
        q.id === p?.id ? h('span.badge', 'offen') : null,
        button('Kopie', () => { store.duplicate(q.id); toast('Kopie angelegt.'); }, 'small ghost'),
        button('Löschen', async () => { if (await confirmBox(`„${q.title}“ wirklich löschen? Das lässt sich nicht rückgängig machen.`, 'Löschen')) { store.remove(q.id); toast('Gelöscht.'); } }, 'small ghost danger'))));
  }
  page.append(plist);

  // ---------- rechts: Eigenschaften des offenen Spiels
  if (!p) {
    side.append(h('div.side-empty', h('h3', 'Kein Spiel offen'), h('p', 'Wähle in der Mitte eine Vorlage. Danach stehen hier Titel, Autor und die Farbe des Etiketts.')));
    return;
  }
  const q = (fn, key) => store.edit(fn, { merge: key, render: false });
  side.append(h('h3', 'Dein Spiel'),
    field('Titel', textInput(p.title, (v) => { q((pp) => { pp.title = v; }, 'title'); document.getElementById('projTitle').value = v; }, { maxlength: 40, dataset: { fid: 'p-title' } })),
    field('Autor', textInput(p.author, (v) => q((pp) => { pp.author = v; }, 'author'), { maxlength: 40, placeholder: 'Dein Name', dataset: { fid: 'p-author' } })),
    field('Beschreibung', h('textarea', { rows: 3, maxlength: 140, dataset: { fid: 'p-desc' }, oninput: (e) => q((pp) => { pp.desc = e.target.value; }, 'desc') }, p.desc || ''), 'Steht im Regal unter dem Titel.'),
    field('Farbe des Etiketts', colorPicker(p.color, (c) => store.edit((pp) => { pp.color = c; }))),
    field('Spielart', select([['draufsicht', 'Von oben (Abenteuer)'], ['seitlich', 'Von der Seite (Jump\'n\'Run)']], p.mode, (v) => store.edit((pp) => { pp.mode = v; })),
      p.mode === 'seitlich' ? 'Schwerkraft zieht nach unten, A springt, ↑ spricht.' : 'Laufen in alle Richtungen, A spricht.'),
    field('Startszene', select(p.scenes.map((s) => [s.id, s.name]), p.startScene, (v) => store.edit((pp) => { pp.startScene = v; }))),
    h('h3', 'Sichern'),
    h('p.muted.small', 'Der Baukasten speichert alles automatisch in diesem Browser. Für einen anderen Computer: als Datei sichern.'),
    h('div.col',
      button('Als Datei sichern (.json)', () => download(fileName(p) + '.baukasten.json', store.exportJSON(), 'application/json')),
      button('Kartridge ins Regal legen', () => { const { cart } = app.buildCart(); toast(`„${cart.title}“ liegt im Regal.`); })));
}

const fileName = (p) => (p.title || 'spiel').toLowerCase().replace(/[äöüß]/g, (c) => ({ ä: 'ae', ö: 'oe', ü: 'ue', ß: 'ss' }[c])).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'spiel';
