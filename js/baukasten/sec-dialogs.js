// Bereich „Dialoge“: Gesprächskarten (Sprecher, Porträt, Text, bis zu 3 Antworten), als verbundene Karten auf einer Fläche.
import { h, field, textInput, select, button, spritePicker, spriteImg, toast, confirmBox } from './ui.js';
import { uid } from './templates.js';
import { wrapText, DIALOG_COLS, DIALOG_LINES } from './codegen.js';
import { uniqueName } from './sec-scenes.js';
import { createGfx, MAP_W } from '../gfx.js';
import { MACHINES } from '../machines.js';

const CARD_W = 200;

// Vorschau wie auf der Konsole: Szene im Hintergrund, Dialogfenster unten
let pgfx = null;
export function drawDialogPreview(canvas, p, card, { sceneId = null, choiceSel = 0 } = {}) {
  pgfx ||= createGfx(MACHINES[8]);
  const g = pgfx;
  g.resetAll();
  for (const s of p.sprites) { try { g.defineSprite(s.n, s.rows); } catch { /* ungültig */ } }
  const sc = p.scenes.find((s) => s.id === sceneId) || p.scenes.find((s) => s.objects.some((o) => o.type === 'figur')) || p.scenes[0];
  g.cls(sc?.color ?? 1);
  if (sc) {
    for (let y = 0; y < Math.min(sc.h, 20); y++) for (let x = 0; x < Math.min(sc.w, 30); x++) g.mset(x, y, sc.tiles[y * sc.w + x] || 0);
    g.drawMap(0, 0, 0, 0, Math.min(sc.w, 30), Math.min(sc.h, 20));
    for (const o of sc.objects) if (!o.versteckt && o.x < 30 && o.y < 20) g.spr(o.sprite, o.x * 8, o.y * 8);
  }
  const W = 240, H = 160, y = H - 52;
  g.rectfill(2, y, W - 4, 50, 16); g.rect(2, y, W - 4, 50, 7);
  let tx = 8;
  if (card.portrait && g.sprites[card.portrait]) {
    const big = g.sprites[card.portrait].w <= 8 ? 2 : 1;
    g.rectfill(7, y + 6, 20, 20, 1); g.spr(card.portrait, 9, y + 8, false, false, big); tx = 32;
  }
  if (card.who) { const w = g.textWidth(card.who) + 8; g.rectfill(6, y - 9, w, 11, 16); g.rect(6, y - 9, w, 11, 7); g.text(card.who, 10, y - 7, 10); }
  const lines = wrapText(card.text, card.portrait ? DIALOG_COLS.portrait : DIALOG_COLS.plain);
  g.text(lines.slice(0, DIALOG_LINES).join('\n'), tx, y + 6, lines.length > DIALOG_LINES ? 8 : 7);
  const ch = (card.choices || []).filter((a) => a.text);
  if (ch.length) {
    let w = 0; for (const a of ch) w = Math.max(w, g.textWidth(a.text));
    w += 22;
    const hh = ch.length * 10 + 6, x = W - 4 - w, ay = y - hh - 2;
    g.rectfill(x, ay, w, hh, 16); g.rect(x, ay, w, hh, 7);
    ch.forEach((a, i) => { if (i === choiceSel) g.text('▶', x + 5, ay + 4 + i * 10, 10); g.text(a.text, x + 14, ay + 4 + i * 10, i === choiceSel ? 10 : 7); });
  } else g.text('↓', W - 12, y + 40, 10);
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(W, H);
  g.present(new Uint32Array(img.data.buffer));
  ctx.putImageData(img, 0, 0);
  void MAP_W;
}

export function render({ main, side, store, app }) {
  const p = store.project;
  const ui = store.ui;
  let d = p.dialogs.find((x) => x.id === ui.dialogId) || p.dialogs[0];
  ui.dialogId = d?.id;

  const addDialog = () => {
    const card = { id: uid('k'), who: 'Figur', portrait: p.sprites.find((s) => s.kind === 'figur')?.n || 0, text: 'Hallo! Schön, dich zu sehen.', next: '', choices: [], x: 40, y: 60 };
    const nd = { id: uid('d'), name: uniqueName(p.dialogs.map((x) => x.name), 'Dialog ' + (p.dialogs.length + 1)), start: card.id, cards: [card] };
    store.edit(() => p.dialogs.push(nd));
    app.go('dialoge', { dialogId: nd.id, cardId: card.id });
  };

  const tabs = h('div.tabs', { role: 'tablist' },
    p.dialogs.map((x) => h('button.tab', { type: 'button', role: 'tab', 'aria-selected': String(x.id === d?.id), class: x.id === d?.id ? 'on' : '', onclick: () => app.go('dialoge', { dialogId: x.id, cardId: null }) }, x.name)),
    h('button.tab.add', { type: 'button', onclick: addDialog }, '+ Dialog'));

  if (!d) {
    main.append(h('div.dlg', tabs, h('div.empty-c',
      h('h2', 'Noch keine Dialoge'),
      h('p', 'Ein Dialog ist ein Gespräch aus Karten: Wer spricht, was gesagt wird und welche Antworten man wählen kann. Jede Antwort kann zu einer anderen Karte führen.'),
      button('Ersten Dialog anlegen', addDialog, 'primary'))));
    side.append(h('div.side-empty', h('h3', 'Dialoge'), h('p', 'Eine Figur zum Sprechen bekommt ihren Dialog in der Szene, rechts bei den Eigenschaften.')));
    return;
  }
  let card = d.cards.find((c) => c.id === ui.cardId) || null;

  // ---------- Fläche mit Karten
  const board = h('div.board');
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.classList.add('links');
  board.append(svg);
  const wrap = h('div.board-wrap', { dataset: { scroll: 'board-' + d.id } }, board);
  const toolbar = h('div.dlg-bar',
    button('+ Karte', () => addCard(), 'small'),
    h('span.muted.small', 'Ziehe am Punkt einer Karte zu einer anderen Karte, um sie zu verbinden. Karten verschiebst du am Kopf.'));
  main.append(h('div.dlg', tabs, toolbar, wrap));

  const maxX = Math.max(1200, ...d.cards.map((c) => c.x + CARD_W + 300)), maxY = Math.max(700, ...d.cards.map((c) => c.y + 400));
  board.style.width = maxX + 'px'; board.style.height = maxY + 'px';
  svg.setAttribute('width', maxX); svg.setAttribute('height', maxY);

  const els = new Map();
  d.cards.forEach((c, i) => {
    const spr = p.sprites.find((s) => s.n === c.portrait);
    const lines = wrapText(c.text, c.portrait ? DIALOG_COLS.portrait : DIALOG_COLS.plain).length;
    const outs = c.choices.length
      ? c.choices.map((a, k) => h('div.dc-out', { dataset: { port: 'c' + k } }, h('span', '▶ ' + (a.text || '…')), h('i.port', { title: 'Ziehen zum Verbinden' })))
      : [h('div.dc-out.next', { dataset: { port: 'next' } }, h('span', c.next ? 'weiter' : 'Ende des Dialogs'), h('i.port', { title: 'Ziehen zum Verbinden' }))];
    const el = h('div.dcard', { dataset: { card: c.id }, class: (card?.id === c.id ? 'sel ' : '') + (d.start === c.id ? 'start' : ''), style: { left: c.x + 'px', top: c.y + 'px', width: CARD_W + 'px' } },
      h('i.port-in'),
      h('div.dc-h', h('b', 'Karte ' + (i + 1)), d.start === c.id ? h('span.badge', 'Start') : null, lines > DIALOG_LINES ? h('span.badge.warn', { title: 'Text zu lang' }, 'zu lang') : null),
      h('div.dc-who', spr ? spriteImg(spr, 24) : null, h('b', c.who || '(niemand)')),
      h('p.dc-text', c.text || '…'),
      ...outs);
    board.append(el);
    els.set(c.id, el);
  });

  function portPos(el, sel) {
    const port = el.querySelector(sel);
    const br = board.getBoundingClientRect(), r = port.getBoundingClientRect();
    return [r.left + r.width / 2 - br.left, r.top + r.height / 2 - br.top];
  }
  const curve = ([x1, y1], [x2, y2]) => {
    const dx = Math.max(40, Math.abs(x2 - x1) / 2);
    return `M${x1},${y1} C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2},${y2}`;
  };
  function drawLinks(temp) {
    svg.innerHTML = '';
    for (const c of d.cards) {
      const el = els.get(c.id);
      const pairs = c.choices.length ? c.choices.map((a, k) => ['[data-port="c' + k + '"] .port', a.next]) : [['[data-port="next"] .port', c.next]];
      for (const [sel, target] of pairs) {
        const tel = els.get(target);
        if (!tel) continue;
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', curve(portPos(el, sel), portPos(tel, '.port-in')));
        path.setAttribute('class', c.choices.length ? 'lk choice' : 'lk');
        svg.append(path);
      }
    }
    if (temp) {
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', curve(temp[0], temp[1]));
      path.setAttribute('class', 'lk temp');
      svg.append(path);
    }
  }
  requestAnimationFrame(() => drawLinks());

  // Ziehen: Karten verschieben, Verbindungen ziehen
  board.addEventListener('pointerdown', (e) => {
    const cardEl = e.target.closest('.dcard');
    if (!cardEl) { if (card) { ui.cardId = null; app.refresh(); } return; }
    const c = d.cards.find((x) => x.id === cardEl.dataset.card);
    const port = e.target.closest('.port');
    if (port) {
      e.preventDefault();
      const out = port.closest('[data-port]').dataset.port;
      const br = board.getBoundingClientRect();
      const from = portPos(cardEl, `[data-port="${out}"] .port`);
      const move = (ev) => drawLinks([from, [ev.clientX - br.left, ev.clientY - br.top]]);
      const upp = (ev) => {
        window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', upp);
        const target = document.elementFromPoint(ev.clientX, ev.clientY)?.closest('.dcard');
        const tid = target && target !== cardEl ? target.dataset.card : '';
        store.edit(() => { if (out === 'next') c.next = tid; else c.choices[+out.slice(1)].next = tid; });
        if (!tid) toast('Verbindung gelöst – hier endet der Dialog.');
      };
      window.addEventListener('pointermove', move); window.addEventListener('pointerup', upp);
      return;
    }
    if (ui.cardId !== c.id) { ui.cardId = c.id; card = c; board.querySelectorAll('.dcard.sel').forEach((x) => x.classList.remove('sel')); cardEl.classList.add('sel'); renderSide(); }
    if (!e.target.closest('.dc-h')) return;
    e.preventDefault();
    const sx = e.clientX, sy = e.clientY, ox = c.x, oy = c.y;
    let began = false;
    const move = (ev) => {
      const nx = Math.max(0, Math.round((ox + ev.clientX - sx) / 10) * 10), ny = Math.max(0, Math.round((oy + ev.clientY - sy) / 10) * 10);
      if (!began && (nx !== ox || ny !== oy)) { store.begin(); began = true; }
      if (!began) return;
      c.x = nx; c.y = ny;
      cardEl.style.left = nx + 'px'; cardEl.style.top = ny + 'px';
      drawLinks();
    };
    const upp = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', upp); if (began) store.end(); };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', upp);
  });

  function addCard(after = null) {
    const base = after || card || d.cards[d.cards.length - 1];
    // rechts neben die Karte – liegt dort schon eine (zweite Antwort), dann darunter statt genau darauf
    const nx = (base?.x ?? 0) + CARD_W + 40;
    let ny = base?.y ?? 40;
    while (d.cards.some((c) => Math.abs(c.x - nx) < CARD_W && Math.abs(c.y - ny) < 150)) ny += 170;
    const nc = { id: uid('k'), who: base?.who || '', portrait: base?.portrait || 0, text: '', next: '', choices: [], x: nx, y: ny };
    store.edit(() => { d.cards.push(nc); if (after && !after.choices.length && !after.next) after.next = nc.id; if (!d.start) d.start = nc.id; });
    ui.cardId = nc.id;
    app.refresh();
    setTimeout(() => document.querySelector('[data-fid="k-text"]')?.focus(), 30);
  }

  // ---------- rechts
  function renderSide() {
    side.textContent = '';
    const usedBy = p.scenes.flatMap((s) => s.objects.filter((o) => o.type === 'figur' && o.dialog === d.id).map((o) => `${o.name} (${s.name})`));
    if (!card) {
      side.append(h('h3', 'Dialog „' + d.name + '“'),
        field('Name', textInput(d.name, (v) => store.edit(() => { d.name = v; }, { merge: 'dn' + d.id, render: false }), { maxlength: 30, dataset: { fid: 'd-name' },
          onchange: (e) => { const v = uniqueName(p.dialogs.filter((x) => x !== d).map((x) => x.name), e.target.value.trim() || 'Dialog'); store.edit(() => { d.name = v; }); } })),
        field('Beginnt mit', select(d.cards.map((c, i) => [c.id, `Karte ${i + 1}: ${(c.text || '…').slice(0, 28)}`]), d.start, (v) => store.edit(() => { d.start = v; }))),
        h('h4', 'Wer spricht diesen Dialog?'),
        usedBy.length ? h('ul.rel', usedBy.map((u) => h('li', u))) : h('p.muted.small', 'Noch keine Figur. Setze in einer Szene eine „Figur zum Sprechen“ und wähle dort diesen Dialog – oder starte ihn mit einer Regel.'),
        h('p.muted.small', 'Klicke eine Karte an, um sie zu bearbeiten.'),
        h('div.col', button('Dialog löschen', async () => {
          if (!(await confirmBox(`Dialog „${d.name}“ löschen?`, 'Löschen'))) return;
          store.edit(() => { p.dialogs = p.dialogs.filter((x) => x.id !== d.id); for (const s of p.scenes) for (const o of s.objects) if (o.dialog === d.id) o.dialog = ''; });
          app.go('dialoge', { dialogId: null, cardId: null });
        }, 'small danger wide')));
      return;
    }
    const idx = d.cards.indexOf(card);
    const q = (fn, key) => store.edit(fn, { merge: key + card.id, render: false });
    const prev = h('canvas.dlg-prev', { 'aria-label': 'Vorschau auf der Konsole' });
    const lineInfo = h('span.fld-h');
    const refresh = () => {
      const n = wrapText(card.text, card.portrait ? DIALOG_COLS.portrait : DIALOG_COLS.plain).length;
      lineInfo.textContent = `${n} von ${DIALOG_LINES} Zeilen`;
      lineInfo.classList.toggle('bad', n > DIALOG_LINES);
      drawDialogPreview(prev, p, card);
      const el = els.get(card.id);
      if (el) { el.querySelector('.dc-text').textContent = card.text || '…'; el.querySelector('.dc-who b').textContent = card.who || '(niemand)'; }
    };
    side.append(h('h3', `Karte ${idx + 1}`), prev);
    side.append(field('Wer spricht?', textInput(card.who, (v) => { q(() => { card.who = v; }, 'who'); refresh(); }, { maxlength: 20, placeholder: 'leer = Erzähler', dataset: { fid: 'k-who' } })),
      field('Porträt', spritePicker(p, card.portrait, (n) => { store.edit(() => { card.portrait = n; }, { render: false }); refresh(); app.refresh(); }, { none: 'kein Porträt', filter: (s) => s.kind === 'figur' })),
      field('Text', h('textarea', { rows: 4, maxlength: 200, dataset: { fid: 'k-text' }, oninput: (e) => { q(() => { card.text = e.target.value; }, 'text'); refresh(); }, onchange: () => drawLinks() }, card.text || ''), lineInfo));
    // Antworten
    side.append(h('h4', 'Antworten'), h('p.muted.small', card.choices.length ? 'Jede Antwort führt zu einer Karte – oder beendet den Dialog.' : 'Ohne Antworten geht es mit A einfach weiter.'));
    const targets = [['', '→ Dialog endet'], ...d.cards.filter((c) => c !== card).map((c) => [c.id, `→ Karte ${d.cards.indexOf(c) + 1}`])];
    card.choices.forEach((a, k) => {
      side.append(h('div.choice-r',
        textInput(a.text, (v) => { q(() => { a.text = v; }, 'ch' + k); refresh(); }, { maxlength: 22, placeholder: 'Antwort', 'aria-label': 'Antwort ' + (k + 1), dataset: { fid: 'k-ch' + k }, onchange: () => app.refresh() }),
        select(targets, a.next, (v) => store.edit(() => { a.next = v; })),
        h('button.x', { type: 'button', title: 'Antwort entfernen', 'aria-label': 'Antwort entfernen', onclick: () => store.edit(() => card.choices.splice(k, 1)) }, '✕')));
    });
    if (card.choices.length < 3) side.append(button('+ Antwort', () => store.edit(() => { card.choices.push({ text: card.choices.length ? 'Nein' : 'Ja', next: card.next || '' }); card.next = ''; }), 'small ghost'));
    if (!card.choices.length) side.append(field('Danach', select(targets.map(([v, l]) => [v, v ? l.replace('→ ', 'weiter zu ') : 'Dialog endet']), card.next, (v) => store.edit(() => { card.next = v; }))));
    side.append(h('div.col',
      button('+ Neue Karte danach', () => addCard(card), 'small wide'),
      d.start !== card.id ? button('Als Startkarte', () => store.edit(() => { d.start = card.id; }), 'small ghost wide') : null,
      d.cards.length > 1 ? button('Karte löschen', () => {
        store.edit(() => {
          d.cards = d.cards.filter((c) => c !== card);
          for (const c of d.cards) { if (c.next === card.id) c.next = ''; for (const a of c.choices) if (a.next === card.id) a.next = ''; }
          if (d.start === card.id) d.start = d.cards[0].id;
        });
        ui.cardId = null;
      }, 'small danger wide') : null));
    refresh();
  }
  renderSide();
}
