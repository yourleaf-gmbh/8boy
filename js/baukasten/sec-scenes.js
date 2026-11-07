// Bereich „Szenen“: Kachelkarte malen (Stift, Füllen, Rechteck, Radierer, Pipette), Objekte setzen und verschieben,
// Eigenschaften ankreuzen. Mehrere Szenen pro Spiel.
import { h, field, textInput, numberInput, select, check, button, colorPicker, spritePicker, spriteImg, toast, confirmBox, hex } from './ui.js';
import { OBJECT_TYPES, TYPE_ORDER, PROPS, PATROL } from './catalog.js';
import { newObject, newScene, uid } from './templates.js';
import { drawScene, spriteMap } from './mapdraw.js';

const TOOLS = [
  ['pen', 'Stift', 'M3 13l1-4 7-7 3 3-7 7z', 'S'],
  ['fill', 'Füllen', 'M3 8l5-5 5 5-5 5zM12 11c0 1 .8 2 1.5 2S15 12 15 11s-1.5-3-1.5-3S12 10 12 11z', 'F'],
  ['rect', 'Rechteck', 'M3 4h10v8H3z', 'R'],
  ['erase', 'Radierer', 'M2 11l6-7 6 5-4 5H6zM6 14h8', 'E'],
  ['pick', 'Pipette', 'M10 2l4 4-2 2-4-4zM9 5l-6 6v2h2l6-6', 'I'],
  ['select', 'Objekte wählen und verschieben', 'M3 2l9 6-4 1 2 5-2 1-2-5-3 3z', 'V'],
];

export function sceneOf(store) {
  const p = store.project;
  let sc = p.scenes.find((s) => s.id === store.ui.sceneId);
  if (!sc) { sc = p.scenes.find((s) => s.id === p.startScene) || p.scenes[0]; store.ui.sceneId = sc?.id; }
  return sc;
}

// Wenn ein Name nicht mehr vorkommt: Regeln und Türen auf den neuen Namen umstellen
export function renameRefs(p, oldName, newName) {
  if (!oldName || oldName === newName) return;
  if (p.scenes.some((s) => s.objects.some((o) => o.name === oldName))) return; // gibt es noch
  const fix = (obj) => {
    if (!obj?.p) return;
    for (const [k, v] of Object.entries(obj.p)) {
      if (v === 'name:' + oldName) obj.p[k] = 'name:' + newName;
      else if (v === oldName && ['what'].includes(k)) obj.p[k] = newName;
    }
  };
  for (const r of p.rules) { fix(r.trigger); r.conds.forEach(fix); r.actions.forEach(fix); }
  for (const s of p.scenes) for (const o of s.objects) if (o.ankunft === oldName) o.ankunft = newName;
}

export function render({ main, side, store, app }) {
  const p = store.project;
  const ui = store.ui;
  ui.tool ||= 'pen';
  if (ui.grid === undefined) ui.grid = true;
  const tiles = p.sprites.filter((s) => s.kind === 'tile');
  if (!ui.tileN || !p.sprites.some((s) => s.n === ui.tileN)) ui.tileN = tiles[0]?.n || p.sprites[0]?.n || 0;
  const sc = sceneOf(store);
  if (!sc) {
    main.append(h('div.empty-c', h('h2', 'Noch keine Szene'), h('p', 'Eine Szene ist ein Ort im Spiel: eine Wiese, eine Höhle, ein Haus.'), button('Erste Szene anlegen', () => addScene(store, app), 'primary')));
    return;
  }
  let obj = sc.objects.find((o) => o.id === ui.objId) || null;
  // Zoom so wählen, dass die Karte in die Fläche passt (einmal je Szene)
  if (!ui.zoom || ui.zoomFor !== sc.id + ':' + sc.w) {
    const room = Math.max(300, main.clientWidth - 172 - 30);
    ui.zoom = Math.max(sc.w > 40 ? 2 : 1, Math.min(4, Math.floor(room / (sc.w * 8))));
    ui.zoomFor = sc.id + ':' + sc.w;
  }

  // ---------- Szenen-Reiter
  const tabs = h('div.tabs', { role: 'tablist' },
    p.scenes.map((s) => h('button.tab', { type: 'button', role: 'tab', 'aria-selected': String(s.id === sc.id), class: s.id === sc.id ? 'on' : '', onclick: () => app.go('szenen', { sceneId: s.id, objId: null }) },
      s.id === p.startScene ? h('span.star', { title: 'Startszene' }, '★') : null, s.name)),
    h('button.tab.add', { type: 'button', title: 'Neue Szene', onclick: () => addScene(store, app) }, '+ Szene'));

  // ---------- Werkzeuge
  const toolBtns = TOOLS.map(([id, label, d, key]) => h('button.ib.tool', { type: 'button', title: `${label} (${key})`, 'aria-label': label, 'aria-pressed': String(ui.tool === id), class: ui.tool === id ? 'on' : '', dataset: { tool: id },
    onclick: () => { ui.tool = id; if (id !== 'place') ui.placeType = null; app.refresh(); } },
  h('span.ic', { html: `<svg viewBox="0 0 16 16"><path d="${d}" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>` })));
  const status = h('span.sc-status', 'Fahre mit der Maus über die Karte.');
  const toolbar = h('div.sc-tools',
    h('div.tgroup', toolBtns),
    h('div.tgroup',
      h('button.ib', { type: 'button', title: 'Verkleinern', 'aria-label': 'Verkleinern', onclick: () => { ui.zoom = Math.max(1, ui.zoom - 1); app.refresh(); } }, '−'),
      h('span.zoom', ui.zoom + '×'),
      h('button.ib', { type: 'button', title: 'Vergrößern', 'aria-label': 'Vergrößern', onclick: () => { ui.zoom = Math.min(6, ui.zoom + 1); app.refresh(); } }, '+'),
      check('Raster', ui.grid, (v) => { ui.grid = v; draw(); })),
    status);

  // ---------- Palette
  const pal = h('div.sc-pal', { dataset: { scroll: 'scpal' } },
    h('h4', 'Kacheln'),
    h('div.tile-grid', tiles.map((s) => h('button.tile-b', { type: 'button', title: `${s.name}${s.solid ? ' (fest)' : ''}`, class: ui.tileN === s.n && ui.tool !== 'select' && ui.tool !== 'place' ? 'on' : '', dataset: { tile: s.n },
      onclick: () => { ui.tileN = s.n; if (!['pen', 'fill', 'rect'].includes(ui.tool)) ui.tool = 'pen'; app.refresh(); } }, spriteImg(s, 32), s.solid ? h('i.solid-dot', { title: 'fest' }) : null))),
    h('button.link', { type: 'button', onclick: () => app.go('assets', { assetTab: 'bilder', spriteN: null, newKind: 'tile' }) }, '+ eigene Kachel malen'),
    h('h4', 'Objekte setzen'),
    h('div.obj-types', TYPE_ORDER.map((t) => {
      const def = OBJECT_TYPES[t];
      const spr = p.sprites.find((s) => s.name === def.sprite) || p.sprites.find((s) => s.kind === 'figur');
      return h('button.obj-t', { type: 'button', title: def.help, class: ui.tool === 'place' && ui.placeType === t ? 'on' : '', dataset: { type: t },
        onclick: () => { ui.tool = 'place'; ui.placeType = t; app.refresh(); } }, spr ? spriteImg(spr, 24) : null, h('span', def.label));
    })),
    ui.tool === 'place' ? h('p.hint', `Klicke in die Karte, um ${OBJECT_TYPES[ui.placeType]?.label || 'ein Objekt'} zu setzen. Mit dem Pfeil-Werkzeug verschiebst du Objekte.`) : null);

  // ---------- Karte
  const canvas = h('canvas.map-c', { tabindex: 0, 'aria-label': `Karte der Szene ${sc.name}` });
  const wrap = h('div.map-wrap', { dataset: { scroll: 'map-' + sc.id } }, canvas);
  main.append(h('div.sc', tabs, toolbar, h('div.sc-body', pal, wrap)));

  const sprites = spriteMap(p);
  const off = document.createElement('canvas');
  off.width = sc.w * 8; off.height = sc.h * 8;
  let hover = null, rectFrom = null, drag = null;
  const Z = ui.zoom;
  canvas.width = sc.w * 8 * Z; canvas.height = sc.h * 8 * Z;
  const g = canvas.getContext('2d');

  function draw() {
    drawScene(off.getContext('2d'), p, { tiles: sc.tiles, w: sc.w, h: sc.h, objects: sc.objects, color: sc.color }, sprites);
    g.imageSmoothingEnabled = false;
    g.drawImage(off, 0, 0, canvas.width, canvas.height);
    const C = 8 * Z;
    if (ui.grid) {
      g.strokeStyle = 'rgba(255,255,255,.09)'; g.lineWidth = 1;
      g.beginPath();
      for (let x = 1; x < sc.w; x++) { g.moveTo(x * C + 0.5, 0); g.lineTo(x * C + 0.5, canvas.height); }
      for (let y = 1; y < sc.h; y++) { g.moveTo(0, y * C + 0.5); g.lineTo(canvas.width, y * C + 0.5); }
      g.stroke();
      // Bildschirmgröße der Konsole (30×20 Kacheln) gestrichelt
      if (sc.w > 30 || sc.h > 20) { g.setLineDash([6, 4]); g.strokeStyle = 'rgba(254,231,97,.35)'; g.strokeRect(0.5, 0.5, Math.min(sc.w, 30) * C, Math.min(sc.h, 20) * C); g.setLineDash([]); }
    }
    // Beschriftungen: Türen, Figuren, Versteckte
    g.font = `600 ${Math.max(10, 3 * Z + 2)}px system-ui, sans-serif`;
    g.textBaseline = 'bottom';
    for (const o of sc.objects) {
      const s = sprites.get(o.sprite);
      const ow = (s ? s.rows.split('\n')[0].length : 8) * Z, oh = (s ? s.rows.split('\n').filter(Boolean).length : 8) * Z;
      let label = null;
      if (o.type === 'tuer') label = o.ziel ? '→ ' + (p.scenes.find((z) => z.id === o.ziel)?.name || '?') : '→ ?';
      if (o.type === 'figur' || o.type === 'schild' || o.type === 'schalter') label = o.name;
      if (o.type === 'spieler') label = 'Start';
      if (o.versteckt) { g.setLineDash([3, 3]); g.strokeStyle = '#fee761'; g.strokeRect(o.x * C + 0.5, o.y * C + 0.5, ow - 1, oh - 1); g.setLineDash([]); }
      if (label && Z >= 2) {
        const tw = g.measureText(label).width + 8;
        g.fillStyle = 'rgba(11,11,18,.78)';
        g.fillRect(o.x * C + ow / 2 - tw / 2, o.y * C - 15 - Z, tw, 14 + Z / 2);
        g.fillStyle = o.type === 'spieler' ? '#63c74d' : o.type === 'tuer' ? '#fee761' : '#e9e6df';
        g.textAlign = 'center';
        g.fillText(label, o.x * C + ow / 2, o.y * C - 2 - Z / 2);
        g.textAlign = 'left';
      }
      if (obj && o.id === obj.id) {
        g.strokeStyle = '#fee761'; g.lineWidth = 2;
        g.strokeRect(o.x * C - 1, o.y * C - 1, ow + 2, oh + 2);
        g.lineWidth = 1;
      }
    }
    // Rechteck in Arbeit
    if (rectFrom && hover) {
      const x0 = Math.min(rectFrom[0], hover[0]), y0 = Math.min(rectFrom[1], hover[1]);
      const x1 = Math.max(rectFrom[0], hover[0]), y1 = Math.max(rectFrom[1], hover[1]);
      g.fillStyle = 'rgba(254,231,97,.25)'; g.fillRect(x0 * C, y0 * C, (x1 - x0 + 1) * C, (y1 - y0 + 1) * C);
      g.strokeStyle = '#fee761'; g.strokeRect(x0 * C + 0.5, y0 * C + 0.5, (x1 - x0 + 1) * C - 1, (y1 - y0 + 1) * C - 1);
    } else if (hover) {
      g.strokeStyle = ui.tool === 'erase' ? '#e43b44' : '#fee761';
      g.strokeRect(hover[0] * C + 0.5, hover[1] * C + 0.5, C - 1, C - 1);
    }
  }

  const cellAt = (e) => {
    const r = canvas.getBoundingClientRect();
    const x = Math.floor((e.clientX - r.left) / r.width * sc.w), y = Math.floor((e.clientY - r.top) / r.height * sc.h);
    return x >= 0 && y >= 0 && x < sc.w && y < sc.h ? [x, y] : null;
  };
  const objAt = (x, y) => [...sc.objects].reverse().find((o) => {
    const s = sprites.get(o.sprite);
    const ow = s ? Math.ceil(s.rows.split('\n')[0].length / 8) : 1, oh = s ? Math.ceil(s.rows.split('\n').filter(Boolean).length / 8) : 1;
    return x >= o.x && x < o.x + ow && y >= o.y && y < o.y + oh;
  });
  const setTile = (x, y, n) => { const i = y * sc.w + x; if (sc.tiles[i] === n) return false; sc.tiles[i] = n; return true; };
  function flood(x, y, n) {
    const from = sc.tiles[y * sc.w + x];
    if (from === n) return;
    const st = [[x, y]];
    while (st.length) {
      const [cx, cy] = st.pop();
      if (cx < 0 || cy < 0 || cx >= sc.w || cy >= sc.h || sc.tiles[cy * sc.w + cx] !== from) continue;
      sc.tiles[cy * sc.w + cx] = n;
      st.push([cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]);
    }
  }
  const tileName = (n) => p.sprites.find((s) => s.n === n)?.name || 'leer';
  function setStatus(c) {
    if (!c) { status.textContent = `${sc.w} × ${sc.h} Kacheln`; return; }
    const o = objAt(c[0], c[1]);
    status.textContent = `x ${c[0]} · y ${c[1]} · ${tileName(sc.tiles[c[1] * sc.w + c[0]])}${o ? ' · ' + o.name : ''}`;
  }

  canvas.addEventListener('pointerdown', (e) => {
    const c = cellAt(e);
    if (!c) return;
    canvas.setPointerCapture(e.pointerId);
    canvas.focus({ preventScroll: true });
    const [x, y] = c;
    const t = e.button === 2 ? 'erase' : ui.tool;
    if (t === 'pen' || t === 'erase') {
      store.begin();
      setTile(x, y, t === 'erase' ? 0 : ui.tileN);
      drag = { paint: t === 'erase' ? 0 : ui.tileN };
      draw();
    } else if (t === 'fill') {
      store.edit(() => flood(x, y, ui.tileN));
    } else if (t === 'rect') {
      rectFrom = c; drag = { rect: true };
    } else if (t === 'pick') {
      const n = sc.tiles[y * sc.w + x];
      if (n) { ui.tileN = n; ui.tool = 'pen'; app.refresh(); }
    } else if (t === 'select') {
      const o = objAt(x, y);
      if (o) {
        ui.objId = o.id; obj = o;
        store.begin();
        drag = { obj: o, dx: x - o.x, dy: y - o.y, moved: false };
        draw(); renderSide();
      } else if (obj) { ui.objId = null; obj = null; draw(); renderSide(); }
    } else if (t === 'place') {
      const type = ui.placeType || 'sammel';
      const existing = type === 'spieler' && sc.objects.find((o) => o.type === 'spieler');
      if (existing) {
        store.edit(() => { existing.x = x; existing.y = y; });
        ui.objId = existing.id;
        toast('Pro Szene gibt es einen Spieler – er steht jetzt hier.');
      } else {
        const o = newObject(p, type, x, y);
        // gleiche Art wie das gerade gewählte Objekt? Dann dessen Einstellungen übernehmen (z.B. viele gleiche Gegner)
        if (obj && obj.type === type) {
          Object.assign(o, { ...JSON.parse(JSON.stringify(obj)), id: o.id, x, y });
          toast(`Wie „${obj.name}“ gesetzt – Name und Einstellungen übernommen. Esc hebt die Auswahl vorher auf.`);
        }
        store.edit(() => { sc.objects.push(o); });
        ui.objId = o.id;
      }
    }
  });
  canvas.addEventListener('pointermove', (e) => {
    const c = cellAt(e);
    const changed = String(c) !== String(hover);
    hover = c;
    setStatus(c);
    if (drag?.paint !== undefined && c) { if (setTile(c[0], c[1], drag.paint)) draw(); }
    else if (drag?.obj && c) {
      const nx = Math.max(0, Math.min(sc.w - 1, c[0] - drag.dx)), ny = Math.max(0, Math.min(sc.h - 1, c[1] - drag.dy));
      if (nx !== drag.obj.x || ny !== drag.obj.y) { drag.obj.x = nx; drag.obj.y = ny; drag.moved = true; draw(); }
    } else if (changed) draw();
  });
  const up = () => {
    if (drag?.paint !== undefined || drag?.obj) { drag = null; store.end(); return; }
    if (drag?.rect && rectFrom && hover) {
      const [ax, ay] = rectFrom, [bx, by] = hover;
      rectFrom = null; drag = null;
      store.edit(() => { for (let y = Math.min(ay, by); y <= Math.max(ay, by); y++) for (let x = Math.min(ax, bx); x <= Math.max(ax, bx); x++) setTile(x, y, ui.tileN); });
      return;
    }
    rectFrom = null; drag = null;
  };
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', up);
  canvas.addEventListener('pointerleave', () => { if (!drag) { hover = null; setStatus(null); draw(); } });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('keydown', (e) => {
    if (obj && (e.key === 'Delete' || e.key === 'Backspace')) { e.preventDefault(); removeObj(); return; }
    if (obj && e.key.startsWith('Arrow')) {
      e.preventDefault();
      const d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
      store.edit(() => { obj.x = Math.max(0, Math.min(sc.w - 1, obj.x + d[0])); obj.y = Math.max(0, Math.min(sc.h - 1, obj.y + d[1])); }, { merge: 'move-' + obj.id });
      return;
    }
    if (e.key === 'Escape') { ui.objId = null; app.refresh(); return; }
    const t = TOOLS.find((x) => x[3].toLowerCase() === e.key.toLowerCase());
    if (t && !e.ctrlKey && !e.metaKey) { ui.tool = t[0]; app.refresh(); }
  });
  draw();
  setStatus(null);

  function removeObj() {
    const id = obj.id;
    store.edit(() => { sc.objects = sc.objects.filter((o) => o.id !== id); });
    ui.objId = null;
  }

  // ---------- rechts
  function renderSide() {
    side.textContent = '';
    // null-Einträge (bedingte Felder) nicht anhängen – sonst steht „null“ als Text im Panel
    if (obj) side.append(...objectPanel(obj).filter(Boolean));
    else side.append(...scenePanel().filter(Boolean));
  }
  function objectPanel(o) {
    const def = OBJECT_TYPES[o.type];
    const q = (fn, key) => store.edit(fn, { merge: key + o.id, render: false });
    const out = [];
    out.push(h('div.side-head', spriteImg(p.sprites.find((s) => s.n === o.sprite), 40), h('div', h('h3', o.name || def.label), h('small', def.label))),
      h('p.muted.small', def.help));
    let oldName = o.name;
    out.push(field('Name', textInput(o.name, (v) => { q(() => { o.name = v; }, 'name'); draw(); }, {
      maxlength: 30, dataset: { fid: 'o-name' }, onfocus: () => { oldName = o.name; },
      onchange: () => { if (oldName !== o.name) store.edit(() => renameRefs(p, oldName, o.name)); },
    }), 'Regeln finden Objekte über ihren Namen. Gleicher Name = gleiche Gruppe (z.B. alle „Münze“).'));
    out.push(field('Bild', spritePicker(p, o.sprite, (n) => store.edit(() => { o.sprite = n; }))));
    out.push(h('div.row2', field('x', numberInput(o.x, (v) => q(() => { o.x = Math.max(0, Math.min(sc.w - 1, v | 0)); }, 'x'), { min: 0, max: sc.w - 1, onchange: () => app.refresh() })),
      field('y', numberInput(o.y, (v) => q(() => { o.y = Math.max(0, Math.min(sc.h - 1, v | 0)); }, 'y'), { min: 0, max: sc.h - 1, onchange: () => app.refresh() }))));

    // Typ-eigene Felder
    if (o.type === 'tuer') {
      const target = p.scenes.find((z) => z.id === o.ziel);
      out.push(h('h4', 'Wohin führt die Tür?'),
        field('Ziel-Szene', select([['', '– nirgendwohin –'], ...p.scenes.filter((z) => z.id !== sc.id).map((z) => [z.id, z.name])], o.ziel, (v) => store.edit(() => { o.ziel = v; o.ankunft = ''; }))),
        target ? field('Ankunft bei', select([['', 'Startpunkt der Szene'], ...[...new Set(target.objects.filter((x) => x.type !== 'spieler').map((x) => x.name))].map((n) => [n, n])], o.ankunft, (v) => store.edit(() => { o.ankunft = v; })), 'Meist die Tür auf der anderen Seite.') : null,
        check('verschlossen', o.verschlossen, (v) => store.edit(() => { o.verschlossen = v; if (v) o.fest = true; })), o.verschlossen ? h('p.hint', 'Eine Regel „Tür öffnen“ macht sie auf – z.B. wenn der Spieler einen Schlüssel hat.') : null,
        o.verschlossen ? field('Bild, wenn offen', spritePicker(p, o.bild_offen, (n) => store.edit(() => { o.bild_offen = n; }), { none: 'gleiches Bild', filter: (s) => s.kind === 'figur' })) : null);
    }
    if (o.type === 'figur') {
      out.push(h('h4', 'Was sagt die Figur?'),
        field('Dialog', select([['', '– kein Dialog –'], ...p.dialogs.map((d) => [d.id, d.name])], o.dialog, (v) => store.edit(() => { o.dialog = v; }))),
        h('div.row',
          o.dialog ? button('Dialog bearbeiten', () => app.go('dialoge', { dialogId: o.dialog, cardId: null }), 'small') : null,
          button('Neuer Dialog', () => {
            const card = { id: uid('k'), who: o.name, portrait: o.sprite, text: 'Hallo!', next: '', choices: [], x: 40, y: 40 };
            const d = { id: uid('d'), name: uniqueName(p.dialogs.map((x) => x.name), o.name || 'Dialog'), start: card.id, cards: [card] };
            store.edit(() => { p.dialogs.push(d); o.dialog = d.id; });
            app.go('dialoge', { dialogId: d.id, cardId: card.id });
          }, 'small')));
    }
    if (o.type === 'schild') {
      out.push(field('Text auf dem Schild', h('textarea', { rows: 4, maxlength: 140, dataset: { fid: 'o-text' }, oninput: (e) => q(() => { o.text = e.target.value; }, 'text') }, o.text || ''), 'Erscheint, wenn der Spieler davor die Taste drückt.'));
    }
    if (o.type === 'schalter') {
      out.push(check('am Anfang an', o.an, (v) => store.edit(() => { o.an = v; })),
        field('Bild, wenn an', spritePicker(p, o.bild_an, (n) => store.edit(() => { o.bild_an = n; }), { none: 'gleiches Bild', filter: (s) => s.kind === 'figur' })));
    }

    out.push(h('h4', 'Eigenschaften'));
    for (const pr of PROPS) {
      if (pr.side && p.mode !== 'seitlich') continue;
      if (pr.key === 'fest' && o.type === 'spieler') continue;
      out.push(check(pr.label, o[pr.key], (v) => store.edit(() => { o[pr.key] = v; }), pr.help));
    }
    if (o.type !== 'spieler') {
      out.push(field('Bewegung', select(p.mode === 'seitlich' ? PATROL.slice(0, 2) : PATROL, o.hinundher || '', (v) => store.edit(() => { o.hinundher = v; }))));
    }
    if (o.steuerbar || o.hinundher || o.verfolgt) {
      out.push(field('Tempo', numberInput(o.tempo, (v) => q(() => { o.tempo = Math.max(0.1, Math.min(4, v)); }, 'tempo'), { min: 0.1, max: 4, step: 0.1 }), 'Pixel pro Bild. 1 = normal, 0.5 = langsam.'));
    }

    // Regeln zu diesem Objekt
    const related = p.rules.map((r, i) => [r, i]).filter(([r]) => JSON.stringify(r).includes(`"name:${o.name}"`) || JSON.stringify(r).includes(`"art:${o.type}"`) || JSON.stringify(r).includes(`"what":"${o.name}"`));
    out.push(h('h4', 'Regeln dazu'));
    if (related.length) out.push(h('ul.rel', related.map(([r, i]) => h('li', h('button.link', { type: 'button', onclick: () => app.go('regeln', { ruleId: r.id }) }, `Regel ${i + 1}`)))));
    else out.push(h('p.muted.small', 'Noch keine Regel kümmert sich um dieses Objekt.'));
    if (o.type !== 'spieler') {
      out.push(button(`+ Regel: Wenn der Spieler „${o.name}“ berührt …`, () => {
        const r = { id: uid('r'), on: true, trigger: { type: o.type === 'figur' || o.type === 'schild' ? 'talk' : 'touch', p: { what: 'name:' + o.name } }, conds: [], actions: [] };
        store.edit(() => p.rules.push(r));
        app.go('regeln', { ruleId: r.id });
      }, 'small ghost wide'));
    }
    out.push(h('div.row.end',
      button('Duplizieren', () => {
        const c = { ...JSON.parse(JSON.stringify(o)), id: uid('o'), x: Math.min(sc.w - 1, o.x + 1) };
        store.edit(() => sc.objects.push(c)); ui.objId = c.id;
      }, 'small'),
      o.type === 'spieler' && sc.id === p.startScene ? null : button('Löschen', removeObj, 'small danger')));
    return out;
  }

  function scenePanel() {
    const q = (fn, key) => store.edit(fn, { merge: key + sc.id, render: false });
    const out = [h('h3', 'Szene „' + sc.name + '“')];
    out.push(field('Name', textInput(sc.name, (v) => q(() => { sc.name = v; }, 'name'), { maxlength: 30, dataset: { fid: 's-name' },
      onchange: (e) => { const v = uniqueName(p.scenes.filter((z) => z !== sc).map((z) => z.name), e.target.value.trim() || 'Szene'); store.edit(() => { sc.name = v; }); } })));
    const sizes = [[30, 20], [40, 30], [60, 20], [60, 40], [90, 20], [20, 15]];
    const key = sc.w + 'x' + sc.h;
    out.push(field('Größe in Kacheln', select([...sizes.map(([w, hh]) => [w + 'x' + hh, `${w} × ${hh}${w === 30 && hh === 20 ? ' (ein Bildschirm)' : w > 30 || hh > 20 ? ' (scrollt)' : ''}`]),
      ...(sizes.some(([w, hh]) => w + 'x' + hh === key) ? [] : [[key, `${sc.w} × ${sc.h}`]])], key, (v) => {
      const [w, hh] = v.split('x').map(Number);
      store.edit(() => resizeScene(sc, w, hh));
    }), 'Ein Bildschirm der Konsole sind 30 × 20 Kacheln. Größere Szenen scrollen mit dem Spieler.'));
    out.push(field('Hintergrund', colorPicker(sc.color, (c) => store.edit(() => { sc.color = c; }))));
    out.push(field('Musik', select([['', '– keine / weiterlaufen lassen –'], ...p.music.map((m) => [m.id, m.name])], sc.music, (v) => store.edit(() => { sc.music = v; }))));
    out.push(check('Das Spiel beginnt hier (Startszene)', sc.id === p.startScene, (v) => { if (v) store.edit(() => { p.startScene = sc.id; }); else app.refresh(); }));
    out.push(h('h4', `Objekte (${sc.objects.length})`));
    if (!sc.objects.length) out.push(h('p.muted.small', 'Wähle links ein Objekt und klicke in die Karte.'));
    out.push(h('ul.objlist', sc.objects.map((o) => h('li', h('button', { type: 'button', onclick: () => { ui.objId = o.id; ui.tool = 'select'; app.refresh(); } },
      spriteImg(p.sprites.find((s) => s.n === o.sprite), 20), h('span', o.name), h('small', `${OBJECT_TYPES[o.type]?.label} · ${o.x}|${o.y}`))))));
    out.push(h('h4', 'Szene'),
      h('div.col',
        button('Mit Blaupause erzeugen …', () => app.go('blaupausen', { bpScene: sc.id }), 'small ghost wide'),
        button('Szene duplizieren', () => {
          const c = JSON.parse(JSON.stringify(sc));
          c.id = uid('z'); c.name = uniqueName(p.scenes.map((z) => z.name), sc.name);
          c.objects.forEach((o) => { o.id = uid('o'); });
          store.edit(() => p.scenes.push(c));
          app.go('szenen', { sceneId: c.id, objId: null });
        }, 'small ghost wide'),
        p.scenes.length > 1 ? button('Szene löschen', async () => {
          if (!(await confirmBox(`Szene „${sc.name}“ mit allen Objekten löschen?`, 'Löschen'))) return;
          store.edit(() => {
            p.scenes = p.scenes.filter((z) => z.id !== sc.id);
            if (p.startScene === sc.id) p.startScene = p.scenes[0].id;
            for (const z of p.scenes) for (const o of z.objects) if (o.ziel === sc.id) o.ziel = '';
          });
          app.go('szenen', { sceneId: null, objId: null });
        }, 'small danger wide') : null));
    return out;
  }
  renderSide();
}

export function uniqueName(existing, base) {
  if (!existing.includes(base)) return base;
  const stem = base.replace(/\s+\d+$/, '');
  for (let i = 2; ; i++) if (!existing.includes(`${stem} ${i}`)) return `${stem} ${i}`;
}

export function resizeScene(sc, w, hh) {
  const t = new Array(w * hh).fill(0);
  const fill = sc.tiles[0] || 0;
  for (let y = 0; y < hh; y++) for (let x = 0; x < w; x++) t[y * w + x] = x < sc.w && y < sc.h ? sc.tiles[y * sc.w + x] : (sc.tiles[Math.min(y, sc.h - 1) * sc.w + Math.min(x, sc.w - 1)] ?? fill);
  sc.tiles = t; sc.w = w; sc.h = hh;
  sc.objects = sc.objects.filter((o) => o.x < w && o.y < hh);
}

function addScene(store, app) {
  const p = store.project;
  const base = p.sprites.find((s) => s.kind === 'tile' && !s.solid);
  const sc = newScene(p, uniqueName(p.scenes.map((s) => s.name), 'Szene ' + (p.scenes.length + 1)), 30, 20, p.mode === 'seitlich' ? 0 : base?.n || 0);
  if (p.mode === 'seitlich') sc.color = 12;
  store.edit(() => { p.scenes.push(sc); if (!p.startScene) p.startScene = sc.id; });
  app.go('szenen', { sceneId: sc.id, objId: null });
  toast(`Szene „${sc.name}“ angelegt. Setze eine Tür, damit der Spieler hinkommt.`);
}
void hex;
