// Zugänglichkeit – nur für Kartridges, die dafür gebaut sind (Kopfzeile „-- a11y: voll“).
// Das klassische Spiel bleibt unverändert: Ohne Kartridge mit a11y gibt es diese Ebene nicht, und auch mit ihr ändert
// sich am Bild nichts, solange niemand etwas einschaltet. Die Kartridge steuert alles selbst:
//   say(text [, "assertive"])  Ansage (Screenreader, auf Wunsch eigene Stimme, sichtbares Protokoll)
//   choose(id, {…}, titel, nr) aktuelle Auswahl als echte Schaltflächen;  _choice(id, nr) bekommt die Wahl
//   _describe()                Zustand als Text (Taste H)
//   cue(name)                  feste Hinweistöne: ok fehler ereignis runde warnung fokus
//   caption(text)              Untertitel für Töne
//   a11y()                     Einstellungen: reader voice contrast motion captions leicht speed
// Maßstab: WCAG 2.2 AA und Game Accessibility Guidelines (siehe docs/BARRIEREFREIHEIT.md).

const KEY = '8boy:a11y';
const DEFAULTS = { reader: false, voice: false, contrast: false, motion: false, captions: false, leicht: false, speed: 1 };
const CUES = {
  ok: 't240 w1 v8 l32 o5 c e g', fehler: 't200 w2 v8 l16 o3 c <b', ereignis: 't180 w0 v9 l16 o5 e r32 e', runde: 't220 w3 v7 l32 o4 c g >c',
  warnung: 't240 w2 v9 l32 o5 c r32 c r32 c', fokus: 't300 w0 v5 l64 o6 c',
};

export function createAccess({ audio, onChoice, onDescribe, hw }) {
  let s = { ...DEFAULTS };
  try { s = { ...DEFAULTS, ...(JSON.parse(localStorage.getItem(KEY)) || {}) }; } catch { /* privat */ }
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* privat */ } };

  let aktiv = false, cart = null, letzte = '', zuletzt = 0, wahl = null;
  const log = [];

  // ---------------------------------------------------------------- Ebene neben dem Bild
  const el = document.createElement('section');
  el.className = 'a11y';
  el.hidden = true;
  el.setAttribute('aria-label', 'Zugänglichkeit: Ansagen und Auswahl');
  el.innerHTML = `
    <div class="a11y-head"><h2 id="a11yTitle">Vorlesen</h2>
      <button class="a11y-btn" data-act="describe" title="Taste H">Zustand vorlesen <kbd>H</kbd></button>
      <button class="a11y-btn" data-act="repeat" title="Taste R">Wiederholen <kbd>R</kbd></button>
      <button class="a11y-btn" data-act="settings">Einstellungen</button></div>
    <p class="a11y-status" id="a11yStatus"></p>
    <div class="a11y-choice" id="a11yChoice" role="group" aria-labelledby="a11yChoiceTitle" hidden>
      <h3 id="a11yChoiceTitle"></h3><div class="a11y-opts" id="a11yOpts"></div></div>
    <ol class="a11y-log" id="a11yLog" aria-label="Letzte Ansagen"></ol>
    <div class="a11y-live" aria-live="polite" id="a11yPolite"></div>
    <div class="a11y-live" aria-live="assertive" id="a11yAssert"></div>`;
  const cap = document.createElement('div');
  cap.className = 'a11y-caption';
  cap.hidden = true;
  cap.setAttribute('aria-hidden', 'true');   // Untertitel stehen zusätzlich als Ansage in der Live-Region
  const set = document.createElement('div');
  set.className = 'a11y-set';
  set.hidden = true;
  set.innerHTML = `<div class="a11y-set-card" role="dialog" aria-modal="true" aria-labelledby="a11ySetTitle">
    <h2 id="a11ySetTitle">Zugänglichkeit</h2>
    <p class="a11y-hint">Diese Kartridge ist dafür gebaut. Alles ist freiwillig – ausgeschaltet bleibt das Spiel, wie es ist.</p>
    <form id="a11yForm">
      <label><input type="checkbox" name="reader"> <b>Vorlesen</b> – Ansagen, Zustand und Auswahl als Text neben dem Bild (für Screenreader und zum Mitlesen)</label>
      <label><input type="checkbox" name="voice"> <b>Eigene Stimme</b> – Ansagen laut vorlesen, auch ohne Screenreader</label>
      <label><input type="checkbox" name="leicht"> <b>Leichte Sprache</b></label>
      <label><input type="checkbox" name="contrast"> <b>Hoher Kontrast</b> – Texte und Rahmen deutlicher</label>
      <label><input type="checkbox" name="motion"> <b>Weniger Bewegung</b> – kein Wackeln, kein Blitzen</label>
      <label><input type="checkbox" name="captions"> <b>Untertitel für Töne</b></label>
      <label class="a11y-range"><b>Tempo</b> <input type="range" name="speed" min="0.5" max="1" step="0.25"> <output id="a11ySpeed"></output></label>
    </form>
    <p class="a11y-hint">Tasten: <kbd>H</kbd> Zustand · <kbd>R</kbd> wiederholen · <kbd>L</kbd> zur Auswahl · <kbd>Tab</kbd> durch die Schaltflächen</p>
    <button class="a11y-btn a11y-close" id="a11yClose">Fertig</button></div>`;
  document.body.append(set);
  const $ = (id) => document.getElementById(id);

  function mount() {
    if (!el.isConnected) document.body.append(el);
    const glass = document.querySelector('.glass');
    if (glass && !cap.isConnected) glass.appendChild(cap);
  }
  function anzeigen() {
    mount();
    el.hidden = !aktiv;
    el.classList.toggle('sichtbar', aktiv && s.reader);   // ohne „Vorlesen“ nur für Screenreader vorhanden
    document.body.classList.toggle('a11y-reader', aktiv && s.reader);
    document.body.classList.toggle('a11y-motion', aktiv && s.motion);
    document.body.classList.toggle('a11y-contrast', aktiv && s.contrast);
    const b = document.getElementById('btnA11y');
    if (b) b.hidden = !aktiv;
    if (!aktiv) cap.hidden = true;
  }

  // ---------------------------------------------------------------- Ausgabe
  const stimme = (text) => {
    if (!s.voice || !('speechSynthesis' in window)) return;
    try {
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'de-DE';
      u.rate = s.leicht ? 0.9 : 1;
      speechSynthesis.cancel();
      speechSynthesis.speak(u);
    } catch { /* ohne Sprachausgabe */ }
  };
  function say(text, prio = 'polite') {
    if (!aktiv || !text) return;
    const now = performance.now();
    if (text === letzte && now - zuletzt < 1000) return;   // gleiche Ansage nicht doppelt
    letzte = text; zuletzt = now;
    const live = $(prio === 'assertive' ? 'a11yAssert' : 'a11yPolite');
    live.textContent = '';
    setTimeout(() => { live.textContent = text; }, 30);    // neu setzen, damit Screenreader es sicher ansagen
    log.unshift(text);
    if (log.length > 6) log.pop();
    const ol = $('a11yLog');
    ol.innerHTML = log.map((t) => `<li>${esc(t)}</li>`).join('');
    stimme(text);
  }
  function wiederholen() {
    const t = log[0];
    if (!t) return;
    const live = $('a11yAssert');
    live.textContent = '';
    setTimeout(() => { live.textContent = t; }, 30);
    stimme(t);
  }
  const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

  function choose(id, opts, titel = '', nr = 1) {
    if (!aktiv) return;
    const box = $('a11yChoice');
    if (!opts || !opts.length) { wahl = null; box.hidden = true; $('a11yOpts').innerHTML = ''; return; }
    const gleich = wahl && wahl.id === id && wahl.opts.join('\u0001') === opts.join('\u0001');
    const vorher = wahl?.nr;
    const wahlId = wahl?.id;
    wahl = { id, opts, titel, nr };
    box.hidden = false;
    $('a11yChoiceTitle').textContent = titel || 'Auswahl';
    const knoepfe = [...$('a11yOpts').querySelectorAll('.a11y-opt')];
    if (!gleich && vorher !== undefined && wahlId === id && knoepfe.length === opts.length) {
      // nur die Beschriftungen haben sich geändert (z. B. „markiert“): an Ort und Stelle, damit der Fokus bleibt
      knoepfe.forEach((b, i) => { b.textContent = opts[i]; b.toggleAttribute('aria-current', i + 1 === nr); });
    } else if (!gleich) {
      const warImFokus = el.contains(document.activeElement);
      $('a11yOpts').innerHTML = opts.map((o, i) => `<button class="a11y-opt" data-nr="${i + 1}"${i + 1 === nr ? ' aria-current="true"' : ''}>${esc(o)}</button>`).join('');
      // wer gerade in der Liste gewählt hat, landet in der neuen Liste auf der markierten Möglichkeit
      if (warImFokus) ($('a11yOpts').querySelector('.a11y-opt[aria-current]') || $('a11yOpts').querySelector('.a11y-opt'))?.focus();
      if (s.reader && !el.contains(document.activeElement)) say((titel ? titel + ': ' : '') + opts.length + (opts.length === 1 ? ' Möglichkeit. ' : ' Möglichkeiten. ') + (opts[nr - 1] || ''));
    } else if (vorher !== nr) {
      $('a11yOpts').querySelectorAll('.a11y-opt').forEach((b) => b.toggleAttribute('aria-current', +b.dataset.nr === nr));
      // mit den Spieltasten geblättert: die markierte Möglichkeit ansagen
      if (!el.contains(document.activeElement)) say(opts[nr - 1] || '');
    }
  }
  function cue(name) {
    if (!aktiv) return;
    const m = CUES[name];
    if (m) audio.sfx(m, Math.max(0, (hw().channels || 4) - 1));
  }
  let capTimer = 0;
  function caption(text) {
    if (!aktiv || !text) return;
    if (s.captions) {
      cap.textContent = text;
      cap.hidden = false;
      clearTimeout(capTimer);
      capTimer = setTimeout(() => { cap.hidden = true; }, Math.min(6000, 1800 + text.length * 60));
    }
    say(text);
  }

  // ---------------------------------------------------------------- Bedienung
  function describe() {
    const t = onDescribe() || '';
    $('a11yStatus').textContent = t;
    say(t || 'Gerade gibt es nichts zu beschreiben.', 'assertive');
  }
  el.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.act === 'describe') describe();
    else if (b.dataset.act === 'repeat') wiederholen();
    else if (b.dataset.act === 'settings') openSettings();
    else if (b.dataset.nr && wahl) {
      const nr = +b.dataset.nr;
      audio.sfx('select');
      onChoice(wahl.id, nr);
    }
  });
  // Wer mit der Tastatur hineinspringt, sieht die Ebene auch ohne „Vorlesen“ (sichtbarer Fokus)
  el.addEventListener('focusin', () => el.classList.add('fokus'));
  el.addEventListener('focusout', (e) => { if (!el.contains(e.relatedTarget)) el.classList.remove('fokus'); });
  // Pfeiltasten wandern durch die Auswahl, Esc zurück zur Konsole
  el.addEventListener('keydown', (e) => {
    const opts = [...el.querySelectorAll('.a11y-opt')];
    const i = opts.indexOf(document.activeElement);
    if (i >= 0 && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      e.preventDefault();
      opts[(i + (e.key === 'ArrowDown' ? 1 : opts.length - 1)) % opts.length].focus();
    }
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); document.getElementById('screen')?.focus(); }
  });
  window.addEventListener('keydown', (e) => {
    if (!aktiv || e.target.closest?.('textarea, input, [contenteditable], .a11y-set')) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.code === 'KeyH') { e.preventDefault(); describe(); }
    else if (e.code === 'KeyR') { e.preventDefault(); wiederholen(); }
    else if (e.code === 'KeyL') {
      e.preventDefault();
      const b = el.querySelector('.a11y-opt[aria-current]') || el.querySelector('.a11y-opt') || el.querySelector('.a11y-btn');
      b?.focus();
    }
  });

  // ---------------------------------------------------------------- Einstellungen
  const form = () => $('a11yForm');
  function openSettings() {
    const f = form();
    for (const k of ['reader', 'voice', 'contrast', 'motion', 'captions', 'leicht']) f.elements[k].checked = !!s[k];
    f.elements.speed.value = s.speed;
    $('a11ySpeed').textContent = Math.round(s.speed * 100) + ' %';
    set.hidden = false;
    f.elements.reader.focus();
  }
  function closeSettings() { set.hidden = true; document.getElementById('btnA11y')?.focus(); }
  set.addEventListener('change', () => {
    const f = form();
    for (const k of ['reader', 'voice', 'contrast', 'motion', 'captions', 'leicht']) s[k] = f.elements[k].checked;
    s.speed = +f.elements.speed.value;
    $('a11ySpeed').textContent = Math.round(s.speed * 100) + ' %';
    save();
    anzeigen();
    if (!s.voice && 'speechSynthesis' in window) speechSynthesis.cancel();
  });
  set.addEventListener('input', (e) => { if (e.target.name === 'speed') $('a11ySpeed').textContent = Math.round(+e.target.value * 100) + ' %'; });
  $('a11yClose').addEventListener('click', closeSettings);
  set.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeSettings(); }
    if (e.key === 'Tab') {   // Fokus bleibt im Dialog
      const f = [...set.querySelectorAll('input, button')];
      const i = f.indexOf(document.activeElement);
      if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus(); }
      else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus(); }
    }
  });
  set.addEventListener('click', (e) => { if (e.target === set) closeSettings(); });

  return {
    // Kartridge startet/endet (system.js)
    start(c) {
      cart = c; aktiv = c?.a11y === 'voll'; wahl = null; log.length = 0;
      $('a11yLog').innerHTML = ''; $('a11yStatus').textContent = ''; $('a11yOpts').innerHTML = ''; $('a11yChoice').hidden = true;
      anzeigen();
      if (aktiv) say(`${c.title}. Diese Kartridge kann vorlesen. Einstellungen über die Schaltfläche Zugänglichkeit, Zustand mit H.`);
    },
    stop() { aktiv = false; wahl = null; anzeigen(); if ('speechSynthesis' in window) speechSynthesis.cancel(); },
    get aktiv() { return aktiv; },
    // für die VM (nur bei aktiver Kartridge wirksam)
    api: { say, choose, cue, caption, settings: () => (aktiv ? { ...s } : { ...DEFAULTS }) },
    speed: () => (aktiv ? s.speed : 1),
    openSettings,
    describe,
    get settings() { return { ...s }; },
  };
}
