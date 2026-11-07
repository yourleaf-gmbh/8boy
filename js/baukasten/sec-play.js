// Bereich „Spielen“: eingebaute Vorschau, Prüfung („Was fehlt noch?“), Code ansehen mit Zuordnung Regel ↔ Zeilen,
// Kartridge ins Regal legen, in der Konsole öffnen, als .lua herunterladen.
import { h, button, toast, download } from './ui.js';
import { generateLua, checkProject } from './codegen.js';
import { highlightLines } from './luahl.js';
import { createPreview } from './preview.js';
import { cartPreview } from './sec-project.js';
import { fileNameFor } from '../carts.js';

const TABS = [['vorschau', 'Vorschau'], ['code', 'Code ansehen'], ['pruefen', 'Was fehlt noch?']];

export function render(ctx) {
  const { main, store, app } = ctx;
  const ui = store.ui;
  ui.playTab ||= 'vorschau';
  const issues = checkProject(store.project);
  main.append(h('div.tabs', { role: 'tablist' }, TABS.map(([id, label]) => h('button.tab', { type: 'button', role: 'tab', 'aria-selected': String(ui.playTab === id), class: ui.playTab === id ? 'on' : '', onclick: () => app.go('spielen', { playTab: id }) },
    label, id === 'pruefen' && issues.length ? h('span.count', issues.length) : null))));
  renderSide(ctx, issues);
  if (ui.playTab === 'code') return renderCode(ctx);
  if (ui.playTab === 'pruefen') return renderCheck(ctx, issues);
  return renderPreview(ctx);
}

// Welche Regel / welcher Teil steht in Zeile n?
export function whereIs(ranges, line, project) {
  const rule = ranges.find((r) => r.kind === 'rule' && line >= r.from && line <= r.to);
  if (rule) return { text: rule.label, rule: rule.id, idx: project.rules.findIndex((r) => r.id === rule.id) };
  const any = ranges.filter((r) => line >= r.from && line <= r.to).sort((a, b) => (a.to - a.from) - (b.to - b.from))[0];
  return { text: any ? any.label : 'Code' };
}

function renderSide({ side, store, app }, issues) {
  const p = store.project;
  side.append(h('h3', 'Kartridge'), cartPreview(p),
    h('div.col',
      button('In der Konsole spielen', () => app.play(), 'primary wide'),
      button('Als .lua herunterladen', () => { const { code } = generateLua(p); download(fileNameFor({ title: p.title }), code); toast('Die .lua-Datei kannst du im Studio öffnen oder auf die Konsole ziehen.'); }, 'wide'),
      button('Code ansehen', () => app.go('spielen', { playTab: 'code' }), 'ghost wide')),
    h('p.muted.small', '„Spielen“ legt die Kartridge ins Regal der Konsole und öffnet sie in einem neuen Tab. Du findest sie dort bei deinen eigenen Kartridges.'));
  if (issues.length) {
    side.append(h('h3', 'Hinweise'), h('ul.issues.compact', issues.slice(0, 6).map((it) => issueItem(it, app))));
    if (issues.length > 6) side.append(h('button.link', { type: 'button', onclick: () => app.go('spielen', { playTab: 'pruefen' }) }, `alle ${issues.length} Hinweise`));
  }
}

function issueItem(it, app) {
  const go = () => {
    if (it.area === 'scenes') app.go('szenen', { sceneId: it.scene, objId: it.obj || null, tool: it.obj ? 'select' : undefined });
    else if (it.area === 'rules') app.go('regeln', { ruleId: it.rule });
    else if (it.area === 'dialogs') app.go('dialoge', { dialogId: it.dialog, cardId: it.card || null });
  };
  return h('li', { class: it.level }, h('span.dot'), h('span', it.text), it.area ? h('button.link', { type: 'button', onclick: go }, 'hin') : null);
}

// ------------------------------------------------------------------ Vorschau
function renderPreview({ main, store, app }) {
  const p = store.project;
  const canvas = h('canvas.screen', { tabindex: 0, 'aria-label': 'Vorschau des Spiels. Klicken, dann mit Pfeiltasten und X spielen.' });
  const errBox = h('div.err-box', { hidden: true });
  const hint = h('div.screen-hint', h('b', 'Klick ins Bild'), ' – dann spielst du mit der Tastatur.');
  const ui = store.ui;
  const muteBtn = button(ui.mute ? 'Ton aus' : 'Ton an', () => { ui.mute = !ui.mute; restart(); muteBtn.textContent = ui.mute ? 'Ton aus' : 'Ton an'; }, 'small ghost');
  const pauseBtn = button('Pause', () => { pv.pause(); pauseBtn.textContent = pv.paused ? 'Weiter' : 'Pause'; }, 'small ghost');
  main.append(h('div.playarea',
    h('div.bezel', h('div.screen-wrap', canvas, hint, errBox), h('div.bezel-label', '8BOY · VORSCHAU')),
    h('div.play-bar',
      button('Neu starten', () => restart(), 'small'),
      pauseBtn, muteBtn,
      h('span.keys', h('kbd', '← ↑ → ↓'), ' laufen ', h('kbd', 'X'), ' A ', h('kbd', 'Z'), ' B ', h('kbd', 'Enter'), ' MENÜ')),
    h('p.muted.small', 'Die Vorschau benutzt denselben Grafikchip und dieselbe Lua-Maschine wie die Konsole. Was hier läuft, läuft auch dort.')));
  let ranges = [];
  const pv = createPreview(canvas, {
    audio: app.audio,
    onError: (err) => {
      const w = err.line ? whereIs(ranges, err.line, p) : null;
      errBox.hidden = false;
      errBox.textContent = '';
      errBox.append(h('b', 'Das Spiel ist stehen geblieben'),
        h('p', (err.line ? `Zeile ${err.line}` + (w ? ` (${w.text})` : '') + ': ' : '') + err.message),
        h('div.row', button('Code zeigen', () => app.go('spielen', { playTab: 'code', codeLine: err.line, codeFocus: w?.rule || null }), 'small'),
          w?.rule ? button('Zur Regel', () => app.go('regeln', { ruleId: w.rule }), 'small') : null,
          button('Nochmal', () => restart(), 'small ghost')));
    },
  });
  canvas.addEventListener('focus', () => { hint.hidden = true; });
  canvas.addEventListener('blur', () => { hint.hidden = false; });
  canvas.addEventListener('pointerdown', () => { canvas.focus(); app.audio.resume?.(); });
  function restart() {
    errBox.hidden = true;
    const res = generateLua(p);
    ranges = res.ranges;
    pv.setMute(!!ui.mute);
    pv.start(res.code);
    window.baukasten.preview = pv;
  }
  restart();
  return () => pv.stop();
}

// ------------------------------------------------------------------ Code ansehen
function renderCode({ main, store, app }) {
  const p = store.project;
  const ui = store.ui;
  const { code, ranges } = generateLua(p);
  const lines = code.split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  const hl = highlightLines(lines);
  const ruleAt = new Array(lines.length + 2).fill(null);
  for (const r of ranges) if (r.kind === 'rule') for (let i = r.from; i <= r.to; i++) ruleAt[i] = r.id;
  const ruleNo = new Map(p.rules.map((r, i) => [r.id, i + 1]));
  const html = hl.map((l, i) => {
    const rid = ruleAt[i + 1];
    return `<div class="cl${rid ? ' r' : ''}"${rid ? ` data-rule="${rid}"` : ''} data-l="${i + 1}"><span class="ln">${i + 1}</span><span class="cx">${l || ' '}</span>${rid && ranges.find((x) => x.id === rid).from === i + 1 ? `<span class="rtag">Regel ${ruleNo.get(rid)}</span>` : ''}</div>`;
  }).join('');
  const view = h('div.code-view', { html, dataset: { scroll: 'code' } });
  const parts = ranges.filter((r) => r.kind === 'section' && r.id !== 'kopf');
  const nav = h('nav.code-nav', { 'aria-label': 'Teile des Codes' },
    h('h4', 'Teile'),
    parts.map((r) => h('button', { type: 'button', onclick: () => jump(r.from) }, r.label, h('small', r.from))),
    h('h4', 'Deine Regeln'),
    p.rules.length ? p.rules.map((r, i) => {
      const rg = ranges.find((x) => x.kind === 'rule' && x.id === r.id);
      return h('button', { type: 'button', dataset: { rule: r.id }, class: ui.codeFocus === r.id ? 'on' : '', onmouseenter: () => mark(r.id), onmouseleave: () => mark(ui.codeFocus), onclick: () => { ui.codeFocus = r.id; mark(r.id); jump(rg.from); nav.querySelectorAll('button.on').forEach((b) => b.classList.remove('on')); nav.querySelector(`button[data-rule="${r.id}"]`).classList.add('on'); } },
        'Regel ' + (i + 1), h('small', rg.from + '–' + rg.to));
    }) : h('p.muted.small', 'Noch keine Regeln.'),
    h('h4', 'Szenen & Dialoge'),
    ranges.filter((r) => r.kind === 'scene' || r.kind === 'dialog').map((r) => h('button', { type: 'button', onclick: () => jump(r.from) }, (r.kind === 'scene' ? 'Szene ' : 'Dialog ') + r.label, h('small', r.from))));
  main.append(h('div.code',
    h('div.code-top', h('span', h('b', lines.length), ' Zeilen Lua'), h('span.muted.small', 'Fahre über eine Regel links: Ihre Zeilen leuchten auf. Zum Ändern den Code im Studio öffnen.'),
      button('Als .lua herunterladen', () => download(fileNameFor({ title: p.title }), code), 'small ghost')),
    h('div.code-body', nav, view)));

  function mark(rid) {
    view.querySelectorAll('.cl.hi').forEach((e) => e.classList.remove('hi'));
    if (rid) view.querySelectorAll(`.cl[data-rule="${rid}"]`).forEach((e) => e.classList.add('hi'));
  }
  function jump(line) {
    const el = view.querySelector(`.cl[data-l="${line}"]`);
    if (el) view.scrollTop = el.offsetTop - 40;
  }
  view.addEventListener('mouseover', (e) => { const l = e.target.closest('.cl'); if (l?.dataset.rule) mark(l.dataset.rule); });
  view.addEventListener('mouseleave', () => mark(ui.codeFocus));
  view.addEventListener('click', (e) => { const l = e.target.closest('.cl'); if (l?.dataset.rule) { ui.codeFocus = l.dataset.rule; mark(l.dataset.rule); } });
  requestAnimationFrame(() => {
    if (ui.codeLine) { jump(Math.max(1, ui.codeLine - 4)); view.querySelector(`.cl[data-l="${ui.codeLine}"]`)?.classList.add('errl'); ui.codeLine = null; }
    else if (ui.codeFocus) { const rg = ranges.find((x) => x.id === ui.codeFocus); if (rg) jump(rg.from); }
    mark(ui.codeFocus);
  });
}

// ------------------------------------------------------------------ Prüfen
function renderCheck({ main, app }, issues) {
  const page = h('div.pg', { dataset: { scroll: 'check' } });
  main.append(page);
  page.append(h('h1', 'Was fehlt noch?'));
  if (!issues.length) {
    page.append(h('div.ok-box', h('b', 'Alles sieht gut aus.'), h('p', 'Der Baukasten hat nichts gefunden, was fehlt. Zeit zum Spielen!'), button('In der Konsole spielen', () => app.play(), 'primary')));
    return;
  }
  const errs = issues.filter((x) => x.level === 'error'), warns = issues.filter((x) => x.level !== 'error');
  if (errs.length) page.append(h('h2', 'Muss noch gemacht werden'), h('ul.issues', errs.map((it) => issueItem(it, app))));
  if (warns.length) page.append(h('h2', 'Solltest du dir ansehen'), h('ul.issues', warns.map((it) => issueItem(it, app))));
}
