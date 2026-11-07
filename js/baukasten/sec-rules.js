// Bereich „Regeln“: Ereigniskarten „Wenn … (und …) dann …“ wie in Scratch/Construct.
// Jede Karte ist ein Satz mit Lücken; die Lücken sind Auswahlfelder.
import { h, field, textInput, numberInput, select, check, button, spritePicker, popMenu, toast, confirmBox, hex } from './ui.js';
import { TRIGGERS, CONDITIONS, ACTIONS, OBJECT_TYPES, TYPE_ORDER, KEYS, OPS, byId, defaultParams, TRIGGER_GROUPS, ACTION_GROUPS } from './catalog.js';
import { BUILTIN_SFX, uid } from './templates.js';
import { generateLua, describeRule, makeContext, PLURAL } from './codegen.js';
import { highlightLines } from './luahl.js';

// ------------------------------------------------------------------ Lücken im Satz
function firstChoice(p, dialogId) {
  const c = p.dialogs.find((d) => d.id === dialogId)?.cards.find((k) => k.choices.length);
  return c ? c.id + ':0' : '';
}
function objectNames(p, { noPlayer = true } = {}) {
  return [...new Set(p.scenes.flatMap((s) => s.objects.filter((o) => !noPlayer || o.type !== 'spieler').map((o) => o.name)))].sort((a, b) => a.localeCompare(b, 'de'));
}
function paramControl(prm, value, set, { p, trig, params }) {
  const names = objectNames(p);
  const sel = (opts, attrs = {}) => {
    // Verweis auf etwas Gelöschtes (Zähler, Szene, Dialog, Musik): sichtbar als „fehlt“ stehen lassen statt still auf
    // das erste Element umzubiegen – sonst gibt z.B. eine Münze plötzlich Leben, und „Was fehlt noch?“ merkt nichts.
    const flat = opts.flatMap((o) => (o && o.group ? o.items : [o]));
    if (['counter', 'scene', 'dialog', 'music'].includes(prm.t) && value && !flat.some((o) => o[0] === value)) opts = [[value, '⚠ fehlt (gelöscht)'], ...opts];
    const s = select(opts, value, (v) => set(v, true), { class: 'blk-in', 'aria-label': prm.k, ...attrs });
    // Wert passt zu keiner Auswahl mehr (gelöscht, umbenannt, neu)? Dann still auf das, was das Feld zeigt.
    if (s.value !== String(value ?? '') && s.value !== '') { const v = s.value; queueMicrotask(() => set(/^\d+$/.test(v) && (prm.t === 'tile' || prm.t === 'sprite') ? +v : v, false)); }
    return s;
  };
  switch (prm.t) {
    case 'scene': return sel(p.scenes.map((s) => [s.id, s.name]));
    case 'counter': return sel(p.counters.length ? p.counters.map((c) => [c.id, c.name]) : [['', '(kein Zähler – rechts anlegen)']]);
    case 'dialog': return sel(p.dialogs.length ? p.dialogs.map((d) => [d.id, d.name]) : [['', '(noch kein Dialog)']]);
    case 'music': return sel(p.music.length ? p.music.map((m) => [m.id, m.name]) : [['', '(keine Musik)']]);
    case 'sound': return sel([{ group: 'Eingebaut', items: BUILTIN_SFX.map(([k, l]) => [k, l]) }, ...(p.sounds.length ? [{ group: 'Eigene Klänge', items: p.sounds.map((s) => ['u:' + s.id, s.name]) }] : [])]);
    case 'target': return sel([
      { group: 'Alle Objekte dieser Art', items: TYPE_ORDER.filter((t) => t !== 'spieler').map((t) => ['art:' + t, prm.plural ? PLURAL[t] : OBJECT_TYPES[t].label]) },
      ...(names.length ? [{ group: 'Objekte mit Namen', items: names.map((n) => ['name:' + n, prm.plural ? `alle „${n}“` : n]) }] : []),
    ]);
    case 'objsel': return sel([
      ...(trig?.obj ? [{ group: 'Aus dem Auslöser', items: [['this', prm.thisText || 'das Objekt']] }] : []),
      ...(names.length ? [{ group: 'Objekte mit Namen', items: names.map((n) => ['name:' + n, n]) }] : []),
    ]);
    case 'name': return sel(names.length ? names.map((n) => [n, n]) : [['', '(keine Objekte)']]);
    case 'key': return sel(KEYS);
    case 'op': return sel(OPS);
    case 'sign': return sel([['+', '+'], ['-', '−']], { class: 'blk-in narrow' });
    case 'onoff': return sel([['an', 'an'], ['aus', 'aus']]);
    case 'tile': return sel(p.sprites.filter((s) => s.kind === 'tile').map((s) => [String(s.n), s.name]));
    case 'sprite': return sel(p.sprites.map((s) => [String(s.n), `${s.n}: ${s.name}`]));
    case 'color': {
      const s = sel(Array.from({ length: 32 }, (_, i) => [String(i), 'Farbe ' + i]));
      s.style.boxShadow = `inset 4px 0 0 ${hex(+value || 0)}`;
      return s;
    }
    case 'arrive': {
      const sc = p.scenes.find((s) => s.id === params?.scene);
      return sel([['', 'am Startpunkt'], ...[...new Set((sc?.objects || []).filter((o) => o.type !== 'spieler').map((o) => o.name))].map((n) => [n, 'bei „' + n + '“'])]);
    }
    case 'choice': {
      const d = p.dialogs.find((x) => x.id === params?.dialog);
      const opts = [];
      d?.cards.forEach((c, i) => c.choices.forEach((a, k) => opts.push([`${c.id}:${k}`, `Karte ${i + 1}: ${a.text || '…'}`])));
      return sel(opts.length ? opts : [['', '(keine Antworten in diesem Dialog)']]);
    }
    case 'number': return numberInput(value, (v) => set(v, false), { class: 'blk-in num', step: 'any', 'aria-label': prm.k, onchange: () => set(undefined, true) });
    case 'text': return textInput(value, (v) => set(v, false), { class: 'blk-in txt', maxlength: 60, 'aria-label': 'Text', size: Math.max(8, Math.min(32, String(value || '').length + 2)), onchange: () => set(undefined, true) });
    default: return h('span', String(value));
  }
}

// Satz mit eingesetzten Auswahlfeldern
function sentenceEl(def, part, ctx, onChange) {
  const el = h('span.sent');
  const bits = def.s.split(/(\{\w+\})/);
  for (const b of bits) {
    const m = /^\{(\w+)\}$/.exec(b);
    if (!m) { if (b) el.append(h('span.st', b)); continue; }
    const prm = def.params.find((x) => x.k === m[1]);
    el.append(paramControl(prm, part.p[prm.k], (v, rerender) => onChange(prm.k, v, rerender), { ...ctx, params: part.p }));
  }
  return el;
}

// ------------------------------------------------------------------ Schnell-Regeln (Rezepte)
function recipes(p) {
  const c = (name) => p.counters.find((x) => x.name.toLowerCase() === name)?.id || p.counters[0]?.id || '';
  const T = (type, pp = {}) => ({ type, p: pp });
  // Schnell-Regeln möglichst auf das passende Objekt zielen statt auf die ganze Art: sonst zählt auch der Schlüssel
  // als Münze, und jede Tür (auch ein offener Ausgang) verbraucht den Schlüssel.
  const objs = p.scenes.flatMap((s) => s.objects);
  const coin = objs.some((o) => o.type === 'sammel' && o.name === 'Münze') ? 'name:Münze' : 'art:sammel';
  const locked = objs.find((o) => o.type === 'tuer' && o.verschlossen);
  const door = locked ? 'name:' + locked.name : 'art:tuer';
  return [
    { name: 'Münze einsammeln', desc: 'Münze verschwindet, Punkte +1', make: () => ({ trigger: T('touch', { what: coin }), conds: [], actions: [T('hide', { what: 'this' }), T('counter_add', { counter: c('punkte'), sign: '+', value: 1 }), T('sfx', { sound: 'coin' })] }) },
    { name: 'Gegner tut weh', desc: 'Leben −1, zurückstoßen, kurz geschützt', make: () => ({ trigger: T('touch', { what: 'art:gegner' }), conds: [{ type: 'unprotected', p: {}, not: false }], actions: [T('counter_add', { counter: c('leben'), sign: '-', value: 1 }), T('sfx', { sound: 'hit' }), T('pushback', { what: 'this' }), T('protect', { sec: 1.5 })] }) },
    { name: 'Keine Leben mehr', desc: 'Leben höchstens 0 → verloren', make: () => ({ trigger: T('counter', { counter: c('leben'), op: '<=', value: 0 }), conds: [], actions: [T('lose', { text: 'Keine Leben mehr!' })] }) },
    { name: 'Genug Punkte', desc: 'Punkte mindestens 10 → gewonnen', make: () => ({ trigger: T('counter', { counter: c('punkte'), op: '>=', value: 10 }), conds: [], actions: [T('win', { text: 'Alle Münzen gesammelt!' })] }) },
    { name: 'Tür mit Schlüssel', desc: 'Tür berühren, Schlüssel da → Tür geht auf', make: () => ({ trigger: T('touch', { what: door }), conds: [{ type: 'counter', p: { counter: c('schlüssel'), op: '>=', value: 1 }, not: false }], actions: [T('open_door', { what: 'this' }), T('counter_add', { counter: c('schlüssel'), sign: '-', value: 1 })] }) },
    { name: 'Begrüßung', desc: 'Beim Start steht oben ein Text', make: () => ({ trigger: T('start'), conds: [], actions: [T('text', { text: 'Los geht\'s!', sec: 3 })] }) },
  ];
}

// ------------------------------------------------------------------ Bereich
export function render({ main, side, store, app }) {
  const p = store.project;
  const ui = store.ui;
  const ctx = makeContext(p);
  const page = h('div.pg.rules-pg', { dataset: { scroll: 'regeln' } });
  main.append(page);

  page.append(h('div.h1row',
    h('div', h('h1', 'Regeln'), h('p.muted', 'Jede Regel ist ein Satz: Wenn etwas passiert (und etwas stimmt), dann geschieht etwas. Die Regeln werden von oben nach unten geprüft.')),
    button('+ Neue Regel', (e) => pickTrigger(e.currentTarget, (type) => addRule(type)), 'primary')));

  if (!p.rules.length) {
    page.append(h('div.empty-c',
      h('h2', 'Noch keine Regeln'),
      h('p', 'Regeln sagen, was im Spiel passiert. Zum Beispiel: Wenn der Spieler eine Münze berührt, dann verschwindet sie und es gibt einen Punkt.'),
      h('div.recipes', recipes(p).map((r) => h('button.recipe', { type: 'button', onclick: () => addRecipe(r) }, h('b', r.name), h('small', r.desc))))));
  }

  const q = (fn, render = true, merge) => store.edit(fn, { render, merge });

  function addRule(type) {
    const def = byId(TRIGGERS, type);
    const r = { id: uid('r'), on: true, trigger: { type, p: defaultParams(def, p) }, conds: [], actions: [] };
    q(() => p.rules.push(r));
    ui.ruleId = r.id;
    app.refresh();
    setTimeout(() => document.querySelector(`[data-rule="${r.id}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }), 30);
  }
  function addRecipe(rc) {
    const r = { id: uid('r'), on: true, ...rc.make() };
    q(() => p.rules.push(r));
    ui.ruleId = r.id;
    toast(`Regel „${rc.name}“ angelegt.`);
  }

  p.rules.forEach((r, i) => page.append(ruleCard(r, i)));
  if (p.rules.length) page.append(h('button.add-rule', { type: 'button', onclick: (e) => pickTrigger(e.currentTarget, (type) => addRule(type)) }, '+ Neue Regel'));

  function ruleCard(r, i) {
    const trig = byId(TRIGGERS, r.trigger.type);
    const card = h('article.rule', { dataset: { rule: r.id }, class: (r.on ? '' : 'off') + (ui.ruleId === r.id ? ' sel' : ''), onpointerdown: () => { if (ui.ruleId !== r.id) { ui.ruleId = r.id; card.parentElement.querySelectorAll('.rule.sel').forEach((x) => x.classList.remove('sel')); card.classList.add('sel'); renderSide(); } } });
    const set = (part) => (k, v, rerender) => {
      if (v !== undefined) q(() => { part.p[k] = v; if (k === 'dialog' && part.p.choice !== undefined) part.p.choice = firstChoice(p, v); if (k === 'scene' && part.p.arrive !== undefined) part.p.arrive = ''; }, false, 'rp' + r.id + k);
      if (rerender) app.refresh(); else renderSide();
    };
    const pctx = { p, trig };
    card.append(h('header.rule-h',
      h('span.rule-no', 'Regel ' + (i + 1)),
      h('div.rule-acts',
        h('label.sw-toggle', { title: r.on ? 'Regel ist an' : 'Regel ist aus' }, h('input', { type: 'checkbox', checked: r.on, 'aria-label': 'Regel an', onchange: (e) => q(() => { r.on = e.target.checked; }) }), h('span')),
        h('button.ib.sm', { type: 'button', title: 'Nach oben', 'aria-label': 'Nach oben', disabled: i === 0, onclick: () => q(() => { p.rules.splice(i, 1); p.rules.splice(i - 1, 0, r); }) }, '↑'),
        h('button.ib.sm', { type: 'button', title: 'Nach unten', 'aria-label': 'Nach unten', disabled: i === p.rules.length - 1, onclick: () => q(() => { p.rules.splice(i, 1); p.rules.splice(i + 1, 0, r); }) }, '↓'),
        h('button.ib.sm', { type: 'button', title: 'Duplizieren', 'aria-label': 'Duplizieren', onclick: () => { const c = { ...JSON.parse(JSON.stringify(r)), id: uid('r') }; q(() => p.rules.splice(i + 1, 0, c)); ui.ruleId = c.id; } }, '⧉'),
        h('button.ib.sm.danger', { type: 'button', title: 'Löschen', 'aria-label': 'Regel löschen', onclick: async () => { if (await confirmBox(`Regel ${i + 1} löschen?`, 'Löschen')) q(() => { p.rules = p.rules.filter((x) => x.id !== r.id); }); } }, '✕'))));

    // Wenn
    card.append(h('div.blk.when',
      h('button.kw', { type: 'button', title: 'Auslöser ändern', onclick: (e) => pickTrigger(e.currentTarget, (type) => q(() => { r.trigger = { type, p: defaultParams(byId(TRIGGERS, type), p) }; })) }, 'Wenn', h('i', '▾')),
      trig ? sentenceEl(trig, r.trigger, pctx, set(r.trigger)) : h('span', '?')));
    // und …
    r.conds.forEach((c, k) => {
      const def = byId(CONDITIONS, c.type);
      card.append(h('div.blk.and',
        h('button.kw', { type: 'button', title: 'Bedingung ändern', onclick: (e) => pickCond(e.currentTarget, (type) => q(() => { r.conds[k] = { type, p: defaultParams(byId(CONDITIONS, type), p), not: c.not }; })) }, 'und', h('i', '▾')),
        h('label.not', { title: 'Umkehren: nur wenn das NICHT stimmt' }, h('input', { type: 'checkbox', checked: !!c.not, onchange: (e) => q(() => { c.not = e.target.checked; }) }), 'nicht'),
        def ? sentenceEl(def, c, pctx, set(c)) : '?',
        h('button.x', { type: 'button', title: 'Bedingung entfernen', 'aria-label': 'Bedingung entfernen', onclick: () => q(() => r.conds.splice(k, 1)) }, '✕')));
    });
    card.append(h('button.add-and', { type: 'button', onclick: (e) => pickCond(e.currentTarget, (type) => q(() => r.conds.push({ type, p: defaultParams(byId(CONDITIONS, type), p), not: false }))) }, '+ und …'));
    // dann …
    const then = h('div.blk.then', h('span.kw.static', 'dann'));
    const acts = h('ol.acts');
    r.actions.forEach((a, k) => {
      const def = byId(ACTIONS, a.type);
      acts.append(h('li.act',
        h('button.act-pick', { type: 'button', title: 'Aktion ändern', onclick: (e) => pickAction(e.currentTarget, (type) => q(() => { r.actions[k] = { type, p: defaultParams(byId(ACTIONS, type), p, { obj: !!trig?.obj }) }; })) }, def?.label || '?', h('i', '▾')),
        def ? sentenceEl(def, a, pctx, set(a)) : null,
        h('span.act-tools',
          h('button.x', { type: 'button', title: 'Nach oben', 'aria-label': 'Aktion nach oben', disabled: k === 0, onclick: () => q(() => { r.actions.splice(k, 1); r.actions.splice(k - 1, 0, a); }) }, '↑'),
          h('button.x', { type: 'button', title: 'Aktion entfernen', 'aria-label': 'Aktion entfernen', onclick: () => q(() => r.actions.splice(k, 1)) }, '✕'))));
    });
    then.append(acts, h('button.add-act', { type: 'button', onclick: (e) => pickAction(e.currentTarget, (type) => q(() => r.actions.push({ type, p: defaultParams(byId(ACTIONS, type), p, { obj: !!trig?.obj }) }))) }, '+ Aktion'));
    card.append(then);
    return card;
  }

  function pickTrigger(anchor, onpick) {
    popMenu(anchor, TRIGGER_GROUPS.map((g) => ({ group: g, items: TRIGGERS.filter((t) => t.group === g).map((t) => ({ label: t.label, desc: 'Wenn ' + t.s.replace(/\{\w+\}/g, '…'), onpick: () => onpick(t.id) })) })), { width: 340 });
  }
  function pickCond(anchor, onpick) {
    popMenu(anchor, [{ group: 'Nur wenn auch …', items: CONDITIONS.map((c) => ({ label: c.label, desc: c.s.replace(/\{\w+\}/g, '…'), onpick: () => onpick(c.id) })) }], { width: 320 });
  }
  function pickAction(anchor, onpick) {
    popMenu(anchor, ACTION_GROUPS.map((g) => ({ group: g, items: ACTIONS.filter((a) => a.group === g).map((a) => ({ label: a.label, desc: a.s.replace(/\{\w+\}/g, '…'), onpick: () => onpick(a.id) })) })), { width: 320 });
  }

  // ---------- rechts: Code der gewählten Regel, Zähler, Schnell-Regeln
  function renderSide() {
    side.textContent = '';
    const r = p.rules.find((x) => x.id === ui.ruleId);
    if (r) {
      const { code, ranges } = generateLua(p);
      const rg = ranges.find((x) => x.kind === 'rule' && x.id === r.id);
      const lines = code.split('\n').slice(rg.from - 1, rg.to);
      const hl = highlightLines(lines);
      side.append(h('h3', 'Regel ' + (p.rules.indexOf(r) + 1) + ' als Satz'), h('p.rule-sentence', describeRule(r, ctx) + '.'),
        h('h3', 'So steht sie im Code'),
        h('pre.code-mini', { html: hl.map((l, k) => `<span class="ln">${rg.from + k}</span>${l}`).join('\n') }),
        h('button.link', { type: 'button', onclick: () => app.go('spielen', { playTab: 'code', codeFocus: r.id }) }, 'Im ganzen Code zeigen'));
    } else {
      side.append(h('h3', 'Code'), h('p.muted.small', 'Klicke eine Regel an: Hier siehst du, welcher Lua-Code daraus wird.'));
    }
    // Zähler
    side.append(h('h3', 'Zähler'), h('p.muted.small', 'Zahlen, die sich das Spiel merkt: Punkte, Leben, Schlüssel …'));
    const list = h('div.counters');
    p.counters.forEach((c, k) => {
      const qq = (fn, key) => store.edit(fn, { merge: 'c' + key + c.id, render: false });
      list.append(h('div.counter',
        h('div.counter-r',
          textInput(c.name, (v) => qq(() => { c.name = v; }, 'n'), { 'aria-label': 'Name des Zählers', maxlength: 20, dataset: { fid: 'c-n-' + c.id }, onchange: () => app.refresh() }),
          numberInput(c.start, (v) => qq(() => { c.start = Math.round(v); }, 's'), { 'aria-label': 'Startwert', title: 'Startwert', class: 'num', dataset: { fid: 'c-s-' + c.id } }),
          h('button.x', { type: 'button', title: 'Zähler löschen', 'aria-label': 'Zähler löschen', onclick: async () => {
            const used = JSON.stringify(p.rules).includes(`"${c.id}"`);
            if (used && !(await confirmBox(`„${c.name}“ wird in Regeln benutzt. Trotzdem löschen?`, 'Löschen'))) return;
            store.edit(() => p.counters.splice(k, 1));
          } }, '✕')),
        h('div.counter-r',
          check('oben anzeigen', c.show, (v) => store.edit(() => { c.show = v; })),
          c.show ? h('details.icon-pick', h('summary', 'Symbol'), spritePicker(p, c.icon, (n) => store.edit(() => { c.icon = n; }), { none: 'kein Symbol, nur Text', filter: (s) => s.kind === 'figur' })) : null)));
    });
    side.append(list, button('+ Zähler', () => {
      const names = p.counters.map((c) => c.name);
      let name = 'Zähler', i = 1; while (names.includes(name)) name = 'Zähler ' + ++i;
      store.edit(() => p.counters.push({ id: uid('c'), name, start: 0, show: true, icon: 0 }));
    }, 'small ghost wide'));
    if (p.rules.length) {
      side.append(h('h3', 'Schnell-Regeln'), h('div.recipes.side', recipes(p).map((rc) => h('button.recipe', { type: 'button', onclick: () => addRecipe(rc) }, h('b', rc.name), h('small', rc.desc)))));
    }
  }
  renderSide();
}
void field;
