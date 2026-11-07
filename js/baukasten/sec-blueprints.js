// Bereich „Blaupausen“: Welten erzeugen lassen. Knoten (Rauschen, Höhe → Kachel, Verstreuen, Räume + Gänge,
// Rand ummauern, Zufallssamen) werden mit Kabeln verbunden; das Ergebnis wandert per Knopfdruck in eine Szene.
import { h, field, numberInput, select, button, popMenu, toast, confirmBox, spriteImg } from './ui.js';
import { NODE_TYPES, NODE_ORDER, generateWorld, defaultGraph } from './worldgen.js';
import { newObject, uid } from './templates.js';
import { drawScene, spriteMap } from './mapdraw.js';
import { uniqueName } from './sec-scenes.js';

const NODE_W = 200;
const TYPE_LABEL = { samen: 'Zahl', feld: 'Höhen', karte: 'Karte' };

function fieldCanvas(f, w, hh) {
  const c = document.createElement('canvas');
  c.width = w; c.height = hh;
  const g = c.getContext('2d'), img = g.createImageData(w, hh);
  for (let i = 0; i < f.length; i++) { const v = Math.round(f[i] * 255); img.data.set([v * 0.55 + 20, v * 0.8 + 20, v + 10, 255], i * 4); }
  g.putImageData(img, 0, 0);
  c.className = 'pix';
  return c;
}
function mapCanvas(p, k, w, hh, sprites) {
  const c = document.createElement('canvas');
  c.width = w * 8; c.height = hh * 8;
  drawScene(c.getContext('2d'), p, { tiles: k.tiles, w, h: hh, objects: k.objects, color: 0 }, sprites);
  c.className = 'pix';
  return c;
}

export function render({ main, side, store, app }) {
  const p = store.project;
  const ui = store.ui;
  p.blueprints ||= [];
  let bp = p.blueprints.find((b) => b.id === ui.bpId) || p.blueprints[0];
  ui.bpId = bp?.id;
  const target = p.scenes.find((s) => s.id === ui.bpScene) || p.scenes.find((s) => s.id === p.startScene) || p.scenes[0];
  ui.bpScene = target?.id;
  const size = { w: target?.w || 30, h: target?.h || 20 };
  const sprites = spriteMap(p);

  const addBp = (kind) => {
    const g = kind === 'leer' ? { id: uid('b'), name: 'Leer', kind, nodes: [{ id: uid('n'), type: 'ausgabe', x: 600, y: 120, p: {} }], links: [] } : defaultGraph(p, kind);
    g.name = uniqueName(p.blueprints.map((b) => b.name), g.name);
    store.edit(() => p.blueprints.push(g));
    app.go('blaupausen', { bpId: g.id, bpNode: null });
  };
  const bpMenu = (e) => popMenu(e.currentTarget, [{ group: 'Neue Blaupause', items: [
    { label: 'Insel', desc: 'Rauschen → Rand absenken → Höhe → Kachel, Blumen und Münzen verstreut', onpick: () => addBp('insel') },
    { label: 'Verlies', desc: 'Räume + Gänge, Münzen und Gegner verstreut, Rand ummauert', onpick: () => addBp('dungeon') },
    { label: 'Leer', desc: 'Nur der Ergebnis-Knoten – du baust selbst', onpick: () => addBp('leer') },
  ] }]);

  const tabs = h('div.tabs', { role: 'tablist' },
    p.blueprints.map((b) => h('button.tab', { type: 'button', role: 'tab', 'aria-selected': String(b.id === bp?.id), class: b.id === bp?.id ? 'on' : '', onclick: () => app.go('blaupausen', { bpId: b.id, bpNode: null }) }, b.name)),
    h('button.tab.add', { type: 'button', onclick: bpMenu }, '+ Blaupause'));

  if (!bp) {
    main.append(h('div.bp', tabs, h('div.empty-c',
      h('h2', 'Welten erzeugen lassen'),
      h('p', 'Eine Blaupause ist ein Rezept für eine Karte. Du verbindest Bausteine – zum Beispiel „Rauschen“ für Hügel und „Höhe → Kachel“ für Wasser, Sand und Wiese – und der Baukasten malt die Karte für dich.'),
      h('div.row', button('Insel erzeugen', () => addBp('insel'), 'primary'), button('Verlies erzeugen', () => addBp('dungeon'))))));
    side.append(h('div.side-empty', h('h3', 'Blaupausen'), h('p', 'Das Ergebnis kannst du in jede Szene übernehmen und danach von Hand weitermalen.')));
    return;
  }
  const result = generateWorld(bp, p, size);
  let node = bp.nodes.find((n) => n.id === ui.bpNode) || null;

  // ---------- Fläche
  const board = h('div.board.bp-board');
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.classList.add('links');
  board.append(svg);
  const maxX = Math.max(1300, ...bp.nodes.map((n) => n.x + NODE_W + 200)), maxY = Math.max(640, ...bp.nodes.map((n) => n.y + 320));
  board.style.width = maxX + 'px'; board.style.height = maxY + 'px';
  svg.setAttribute('width', maxX); svg.setAttribute('height', maxY);
  const bar = h('div.dlg-bar',
    button('+ Knoten', (e) => popMenu(e.currentTarget, [{ group: 'Bausteine', items: NODE_ORDER.filter((t) => t !== 'ausgabe' || !bp.nodes.some((n) => n.type === 'ausgabe')).map((t) => ({ label: NODE_TYPES[t].label, desc: NODE_TYPES[t].help, onpick: () => addNode(t) })) }]), 'small'),
    h('span.muted.small', 'Ziehe vom Punkt rechts (Ausgang) zum Punkt links (Eingang) eines anderen Knotens. Klick auf einen Eingang löst das Kabel.'),
    h('span.grow'),
    h('label.inline', 'Größe wie Szene ', select(p.scenes.map((s) => [s.id, `${s.name} (${s.w}×${s.h})`]), target?.id, (v) => app.go('blaupausen', { bpScene: v }))));
  main.append(h('div.bp', tabs, bar, h('div.board-wrap', { dataset: { scroll: 'bp-' + bp.id } }, board)));

  const els = new Map();
  for (const n of bp.nodes) {
    const def = NODE_TYPES[n.type];
    const out = result.memo?.get(n.id);
    let thumb = null;
    const val = out && def.outputs[0] ? out[def.outputs[0][0]] : n.type === 'ausgabe' ? out?.karte : null;
    if (val instanceof Float32Array) thumb = fieldCanvas(val, size.w, size.h);
    else if (val && val.tiles) thumb = mapCanvas(p, val, size.w, size.h, sprites);
    else if (typeof val === 'number') thumb = h('div.node-num', String(val));
    const el = h('div.node', { dataset: { node: n.id }, class: node?.id === n.id ? 'sel' : '', style: { left: n.x + 'px', top: n.y + 'px', width: NODE_W + 'px', '--nc': def.color } },
      h('div.node-h', def.label),
      h('div.node-io',
        h('div.node-in', def.inputs.map(([name, t]) => h('div.io', { dataset: { in: name, t } }, h('i.port', { title: 'Eingang: ' + TYPE_LABEL[t] }), TYPE_LABEL[t]))),
        h('div.node-out', def.outputs.map(([name, t]) => h('div.io', { dataset: { out: name, t } }, TYPE_LABEL[t], h('i.port', { title: 'Ausgang: ' + TYPE_LABEL[t] }))))),
      thumb ? h('div.node-thumb', thumb) : null);
    board.append(el);
    els.set(n.id, el);
  }

  function pos(el, sel) {
    const port = el.querySelector(sel);
    if (!port) return null;
    const br = board.getBoundingClientRect(), r = port.getBoundingClientRect();
    return [r.left + r.width / 2 - br.left, r.top + r.height / 2 - br.top];
  }
  const curve = ([x1, y1], [x2, y2]) => { const dx = Math.max(40, Math.abs(x2 - x1) / 2); return `M${x1},${y1} C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2},${y2}`; };
  function drawLinks(temp) {
    svg.innerHTML = '';
    for (const l of bp.links) {
      const a = els.get(l.from), b = els.get(l.to);
      if (!a || !b) continue;
      const pa = pos(a, `[data-out="${l.out}"] .port`), pb = pos(b, `[data-in="${l.in}"] .port`);
      if (!pa || !pb) continue;
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', curve(pa, pb));
      path.setAttribute('class', 'lk t-' + (a.querySelector(`[data-out="${l.out}"]`)?.dataset.t || ''));
      svg.append(path);
    }
    if (temp) { const path = document.createElementNS('http://www.w3.org/2000/svg', 'path'); path.setAttribute('d', curve(temp[0], temp[1])); path.setAttribute('class', 'lk temp'); svg.append(path); }
  }
  requestAnimationFrame(() => drawLinks());

  board.addEventListener('pointerdown', (e) => {
    const nel = e.target.closest('.node');
    if (!nel) { if (node) { ui.bpNode = null; app.refresh(); } return; }
    const n = bp.nodes.find((x) => x.id === nel.dataset.node);
    const port = e.target.closest('.port');
    if (port) {
      e.preventDefault();
      const io = port.closest('.io');
      if (io.dataset.in) {   // Eingang anklicken: Kabel lösen
        if (bp.links.some((l) => l.to === n.id && l.in === io.dataset.in)) store.edit(() => { bp.links = bp.links.filter((l) => !(l.to === n.id && l.in === io.dataset.in)); });
        return;
      }
      const out = io.dataset.out, t = io.dataset.t;
      const br = board.getBoundingClientRect();
      const from = pos(nel, `[data-out="${out}"] .port`);
      board.querySelectorAll(`.io[data-in][data-t="${t}"]`).forEach((x) => { if (x.closest('.node') !== nel) x.classList.add('can'); });
      const move = (ev) => drawLinks([from, [ev.clientX - br.left, ev.clientY - br.top]]);
      const upp = (ev) => {
        window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', upp);
        board.querySelectorAll('.io.can').forEach((x) => x.classList.remove('can'));
        const tio = document.elementFromPoint(ev.clientX, ev.clientY)?.closest('.io[data-in]');
        const tn = tio?.closest('.node');
        if (!tio || !tn || tn === nel) { drawLinks(); return; }
        if (tio.dataset.t !== t) { toast(`Passt nicht: ${TYPE_LABEL[t]} kann nicht in ${TYPE_LABEL[tio.dataset.t]}.`, 'err'); drawLinks(); return; }
        store.edit(() => {
          bp.links = bp.links.filter((l) => !(l.to === tn.dataset.node && l.in === tio.dataset.in));
          bp.links.push({ from: n.id, out, to: tn.dataset.node, in: tio.dataset.in });
        });
      };
      window.addEventListener('pointermove', move); window.addEventListener('pointerup', upp);
      return;
    }
    if (ui.bpNode !== n.id) { ui.bpNode = n.id; node = n; board.querySelectorAll('.node.sel').forEach((x) => x.classList.remove('sel')); nel.classList.add('sel'); renderSide(); }
    if (!e.target.closest('.node-h')) return;
    e.preventDefault();
    const sx = e.clientX, sy = e.clientY, ox = n.x, oy = n.y;
    let began = false;
    const move = (ev) => {
      const nx = Math.max(0, Math.round((ox + ev.clientX - sx) / 10) * 10), ny = Math.max(0, Math.round((oy + ev.clientY - sy) / 10) * 10);
      if (!began && (nx !== ox || ny !== oy)) { store.begin(); began = true; }
      if (!began) return;
      n.x = nx; n.y = ny; nel.style.left = nx + 'px'; nel.style.top = ny + 'px'; drawLinks();
    };
    const upp = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', upp); if (began) store.end(); };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', upp);
  });

  function addNode(type) {
    const def = NODE_TYPES[type];
    const pp = {};
    for (const prm of def.params) pp[prm.k] = prm.d;
    const firstTile = p.sprites.find((s) => s.kind === 'tile')?.n || 0;
    for (const prm of def.params) if (prm.t === 'tile') pp[prm.k] = firstTile;
    if (type === 'hoehe') pp.stufen = [{ bis: 0.4, kachel: firstTile }, { bis: 1, kachel: p.sprites.filter((s) => s.kind === 'tile')[1]?.n || firstTile }];
    if (type === 'verstreuen') pp.was = 'kachel:' + firstTile;
    // freien Platz im sichtbaren Bereich suchen (Raster 220 × 240)
    const wrapEl = board.parentElement;
    const sx = Math.floor((wrapEl?.scrollLeft || 0) / 220) * 220 + 20, sy = Math.floor((wrapEl?.scrollTop || 0) / 240) * 240 + 30;
    let spot = null;
    for (let row = 0; row < 12 && !spot; row++) for (let col = 0; col < 4 && !spot; col++) {
      const x = sx + col * 220, y = sy + row * 240;
      if (!bp.nodes.some((m) => Math.abs(m.x - x) < 210 && Math.abs(m.y - y) < 220)) spot = [x, y];
    }
    const [nx, ny] = spot || [20, Math.max(...bp.nodes.map((m) => m.y)) + 260];
    const n = { id: uid('n'), type, x: nx, y: ny, p: pp };
    store.edit(() => bp.nodes.push(n));
    ui.bpNode = n.id;
    app.refresh();
  }

  // ---------- rechts
  function renderSide() {
    side.textContent = '';
    const qq = (fn) => store.edit(fn);
    if (node) {
      const def = NODE_TYPES[node.type];
      side.append(h('h3', def.label), h('p.muted.small', def.help));
      for (const prm of def.params) side.append(paramEditor(prm));
      if (node.type !== 'ausgabe') side.append(h('div.col', button('Knoten löschen', () => { store.edit(() => { bp.nodes = bp.nodes.filter((x) => x !== node); bp.links = bp.links.filter((l) => l.from !== node.id && l.to !== node.id); }); ui.bpNode = null; }, 'small danger wide')));
    }
    side.append(h('h3', 'Ergebnis'));
    if (result.error) side.append(h('p.warn-box', result.error));
    else {
      const prev = mapCanvas(p, result, size.w, size.h, sprites);
      prev.classList.add('bp-prev');
      const nObj = result.objects.length;
      side.append(prev, h('p.muted.small', `${size.w} × ${size.h} Kacheln${nObj ? ` · ${nObj} ${nObj === 1 ? 'Objekt' : 'Objekte'}` : ''}`));
      ui.bpObjects ??= true;
      side.append(
        h('label.chkf', h('input', { type: 'checkbox', checked: ui.bpObjects, onchange: (e) => { ui.bpObjects = e.target.checked; } }), h('span', 'verstreute Objekte mit übernehmen')),
        button(`In „${target.name}“ übernehmen`, async () => {
          if (!(await confirmBox(`Die Karte von „${target.name}“ wird ersetzt. Deine Objekte bleiben. (Rückgängig mit Strg+Z)`, 'Übernehmen'))) return;
          store.edit(() => {
            target.tiles = result.tiles.slice();
            if (ui.bpObjects) {
              for (const o of result.objects) {
                const spr = p.sprites.find((s) => s.n === o.sprite);
                target.objects.push(newObject(p, o.type, o.x, o.y, { sprite: o.sprite || undefined, name: spr?.name || undefined, ...(o.type === 'gegner' ? { hinundher: 'waagerecht' } : {}) }));
              }
            }
            // der Spieler soll nicht in einer Wand stehen: auf das nächste freie Feld schieben
            const solid = new Set(p.sprites.filter((s) => s.solid).map((s) => s.n));
            for (const o of target.objects.filter((x) => x.type === 'spieler')) {
              if (!solid.has(target.tiles[o.y * target.w + o.x])) continue;
              let best = null;
              for (let r = 1; r < 40 && !best; r++) for (let dy = -r; dy <= r && !best; dy++) for (let dx = -r; dx <= r && !best; dx++) {
                const x = o.x + dx, y = o.y + dy;
                if (x > 0 && y > 0 && x < target.w - 1 && y < target.h - 1 && !solid.has(target.tiles[y * target.w + x])) best = [x, y];
              }
              if (best) [o.x, o.y] = best;
            }
          });
          toast(`Karte in „${target.name}“ übernommen.`);
          app.go('szenen', { sceneId: target.id, objId: null });
        }, 'primary wide'));
    }
    side.append(h('h4', 'Blaupause'),
      h('div.col', button('Blaupause löschen', async () => { if (await confirmBox(`Blaupause „${bp.name}“ löschen?`, 'Löschen')) { store.edit(() => { p.blueprints = p.blueprints.filter((b) => b !== bp); }); ui.bpId = null; } }, 'small ghost danger wide')));

    function paramEditor(prm) {
      const v = node.p[prm.k];
      const tiles = p.sprites.filter((s) => s.kind === 'tile');
      const tileSel = (val, on) => select(tiles.map((s) => [String(s.n), s.name]), String(val), (x) => on(+x));
      if (prm.t === 'number') {
        return field(prm.label, h('div.row',
          numberInput(v, (x) => store.edit(() => { node.p[prm.k] = x; }, { merge: 'bp' + node.id + prm.k, render: false }), { step: prm.k === 'staerke' ? 0.05 : 1, onchange: () => app.refresh(), dataset: { fid: 'bp-' + prm.k } }),
          prm.k === 'wert' ? button('Würfeln', () => qq(() => { node.p.wert = Math.floor(Math.random() * 99999); }), 'small ghost') : null));
      }
      if (prm.t === 'tile') return field(prm.label, h('div.row', tileSel(v, (x) => qq(() => { node.p[prm.k] = x; })), spriteImg(p.sprites.find((s) => s.n === +v), 24)));
      if (prm.t === 'steps') {
        const steps = node.p.stufen || [];
        return field(prm.label, h('div.steps',
          steps.map((st, i) => h('div.step', h('span.small', 'bis'), numberInput(st.bis, (x) => store.edit(() => { st.bis = Math.max(0, Math.min(1, x)); }, { merge: 'st' + i, render: false }), { step: 0.02, min: 0, max: 1, class: 'num', onchange: () => app.refresh() }),
            tileSel(st.kachel, (x) => qq(() => { st.kachel = x; })), spriteImg(p.sprites.find((s) => s.n === st.kachel), 20),
            h('button.x', { type: 'button', 'aria-label': 'Stufe entfernen', onclick: () => qq(() => steps.splice(i, 1)) }, '✕'))),
          button('+ Stufe', () => qq(() => steps.push({ bis: 1, kachel: tiles[0]?.n || 0 })), 'small ghost')), 'Höhen zwischen 0 (tief) und 1 (hoch). Jede Stufe gilt bis zu ihrer Zahl.');
      }
      if (prm.t === 'scatter') {
        const [kind, a, b] = String(v || 'kachel:0').split(':');
        const kinds = [['kachel', 'Kachel'], ['sammel', 'Sammelgegenstand'], ['gegner', 'Gegner'], ['deko', 'Hindernis']];
        const cur = kind === 'kachel' ? 'kachel' : a;
        const n = kind === 'kachel' ? +a : +b;
        const list = cur === 'kachel' ? tiles : p.sprites.filter((s) => s.kind === 'figur');
        return field(prm.label, h('div.row',
          select(kinds, cur, (x) => qq(() => { const first = (x === 'kachel' ? tiles : p.sprites.filter((s) => s.kind === 'figur'))[0]?.n || 0; node.p.was = x === 'kachel' ? 'kachel:' + first : `objekt:${x}:${first}`; })),
          select(list.map((s) => [String(s.n), s.name]), String(n), (x) => qq(() => { node.p.was = cur === 'kachel' ? 'kachel:' + x : `objekt:${cur}:${x}`; })),
          spriteImg(p.sprites.find((s) => s.n === n), 24)));
      }
      return h('span');
    }
  }
  renderSide();
}
