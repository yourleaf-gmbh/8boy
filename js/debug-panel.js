// Studio-Seitenleiste „Fehlersuche“: Haltestelle, Variablen, Aufrufstapel, Beobachten, Haltepunkte, Live-Optionen.
// Kennt die Lua-Maschine nicht – bekommt fertige Daten (vom Debugger) und meldet Klicks zurück.
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const REASON = { Haltepunkt: 'Haltepunkt erreicht', Schritt: 'Schritt', Bild: 'Bild fertig gemalt' };

export function createDebugPanel(el, { onCmd, onWatches, onGoto, onRemoveBp, onClearBps, onAuto, auto }) {
  el.innerHTML = `
    <div class="dbg-state" id="dbgState"></div>
    <div class="dbg-ctl">
      <button class="tb" data-cmd="resume" title="Weiter bis zum nächsten Haltepunkt (F8)">▶ Weiter</button>
      <button class="tb" data-cmd="frame" title="Genau ein Bild weiter, dann wieder anhalten (F6)">⏭ Nächstes Bild</button>
      <button class="tb" data-cmd="step" title="Bis zur nächsten Zeile (F10)">↧ Schritt</button>
      <button class="tb" data-cmd="pause" title="Spiel sofort anhalten (F8)">⏸ Anhalten</button>
    </div>
    <h4>Variablen</h4>
    <div class="dbg-vars" id="dbgVars"></div>
    <h4>Aufrufstapel</h4>
    <div class="dbg-stack" id="dbgStack"></div>
    <h4>Beobachten</h4>
    <div class="dbg-watch" id="dbgWatch"></div>
    <form class="dbg-add" id="dbgAdd"><input id="dbgExpr" placeholder="z. B. pl.x oder score * 2" autocapitalize="off" autocomplete="off" spellcheck="false"><button class="tb" type="submit">+ dazu</button></form>
    <h4>Haltepunkte</h4>
    <div class="dbg-bps" id="dbgBps"></div>
    <h4>Live</h4>
    <label class="dbg-auto"><input type="checkbox" id="dbgAuto"${auto ? ' checked' : ''}> Auto-Live: nach einer kurzen Tipp-Pause den Code ins laufende Spiel laden</label>
    <p class="side-note"><b>Haltepunkt:</b> <span class="for-mouse">auf eine Zeilennummer klicken (oder <kbd>F9</kbd>)</span><span class="for-touch">eine Zeilennummer antippen</span> – ein roter Punkt erscheint. Kommt das Spiel an dieser Zeile vorbei, bleibt es stehen und du siehst hier alle Werte.
    <b>↻ Live</b> tauscht deine Funktionen im laufenden Spiel aus, ohne neu zu starten – der Spielstand bleibt.</p>`;
  const $ = (id) => el.querySelector('#' + id);
  let halt = null, sel = 0, watches = [], running = false, watchList = [];

  el.addEventListener('click', (e) => {
    const b = e.target.closest('[data-cmd]');
    if (b) { onCmd(b.dataset.cmd); return; }
    const fr = e.target.closest('[data-frame]');
    if (fr) { sel = +fr.dataset.frame; drawVars(); drawStack(); onGoto(halt.frames[sel].line); return; }
    const go = e.target.closest('[data-goto]');
    if (go) { onGoto(+go.dataset.goto); return; }
    const rm = e.target.closest('[data-rmbp]');
    if (rm) { onRemoveBp(+rm.dataset.rmbp); return; }
    if (e.target.closest('[data-clearbps]')) { onClearBps(); return; }
    const rw = e.target.closest('[data-rmw]');
    if (rw) { watchList.splice(+rw.dataset.rmw, 1); onWatches(watchList.slice()); drawWatch(); }
  });
  $('dbgAdd').addEventListener('submit', (e) => {
    e.preventDefault();
    const v = $('dbgExpr').value.trim();
    if (!v || watchList.includes(v)) return;
    watchList.push(v);
    $('dbgExpr').value = '';
    onWatches(watchList.slice());
    drawWatch();
  });
  $('dbgAuto').addEventListener('change', (e) => onAuto(e.target.checked));

  function row(name, v, cls = '') {
    if (v.kids && v.kids.length) {
      const more = v.count > v.kids.length ? `<div class="dbg-more">… und ${v.count - v.kids.length} weitere</div>` : '';
      return `<details class="dbg-row ${cls}"><summary><b>${esc(name)}</b><span>${esc(v.v)}</span></summary>${v.kids.map((k) => `<div class="dbg-kid"><b>${esc(k.k)}</b><span>${esc(k.v)}</span></div>`).join('')}${more}</details>`;
    }
    return `<div class="dbg-row ${cls}"><b>${esc(name)}</b><span>${esc(v.v ?? '')}</span></div>`;
  }
  function drawVars() {
    const box = $('dbgVars');
    if (!halt) { box.innerHTML = `<p class="side-note">${running ? 'Erst anhalten (Haltepunkt oder ⏸), dann stehen hier alle Werte.' : 'Starte das Spiel mit ▶ Starten.'}</p>`; return; }
    const fr = halt.frames[sel];
    let html = '';
    if (fr) {
      html += fr.locals.length ? `<div class="dbg-sec">lokal in ${esc(fr.name)}</div>` + fr.locals.map((l) => row(l.name, l, 'loc')).join('') : '';
      html += fr.ups.length ? '<div class="dbg-sec">von außen (Upvalues)</div>' + fr.ups.map((l) => row(l.name, l, 'up')).join('') : '';
    }
    html += '<div class="dbg-sec">global</div>' + (halt.globals.length ? halt.globals.map((g) => row(g.name, g, 'glob')).join('') : '<p class="side-note">keine</p>');
    box.innerHTML = html;
  }
  function drawStack() {
    const box = $('dbgStack');
    if (!halt || !halt.frames.length) { box.innerHTML = `<p class="side-note">${halt ? 'Das Bild ist fertig – gerade läuft keine Funktion.' : '–'}</p>`; return; }
    box.innerHTML = halt.frames.map((f, i) => `<button class="dbg-frame${i === sel ? ' on' : ''}" data-frame="${i}"><b>${esc(f.name)}</b><span>Zeile ${f.line}</span></button>`).join('');
  }
  function spark(hist) {
    const nums = hist.filter((v) => v !== null);
    if (nums.length < 2) return '';
    let lo = Math.min(...nums), hi = Math.max(...nums);
    if (hi === lo) { hi += 1; lo -= 1; }
    const w = 90, h = 22, n = hist.length;
    let d = '', pen = false;
    hist.forEach((v, i) => {
      if (v === null) { pen = false; return; }
      const px = (i / Math.max(1, n - 1)) * w, py = h - 2 - ((v - lo) / (hi - lo)) * (h - 4);
      d += (pen ? 'L' : 'M') + px.toFixed(1) + ' ' + py.toFixed(1);
      pen = true;
    });
    return `<svg class="dbg-spark" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" aria-hidden="true"><path d="${d}"/></svg>`;
  }
  function drawWatch() {
    const box = $('dbgWatch');
    const byExpr = new Map(watches.map((w) => [w.expr, w]));
    if (!watchList.length) { box.innerHTML = '<p class="side-note">Trag unten einen Namen oder eine Rechnung ein – der Wert wird jedes Bild neu ausgerechnet.</p>'; return; }
    box.innerHTML = watchList.map((expr, i) => {
      const w = byExpr.get(expr);
      const val = !w ? '…' : w.err ? '⚠ ' + w.err : w.v;
      return `<div class="dbg-wrow${w?.err ? ' bad' : ''}"><code>${esc(expr)}</code><span class="dbg-wval">${esc(val)}</span>${w && !halt ? spark(w.hist) : ''}<button class="dbg-x" data-rmw="${i}" aria-label="entfernen">✕</button></div>`;
    }).join('');
  }

  return {
    setHalt(info) {
      halt = info; sel = 0;
      const st = $('dbgState');
      if (info) {
        st.className = 'dbg-state halt';
        st.innerHTML = `⏸ <b>${esc(REASON[info.reason] || info.reason)}</b>` + (info.line ? ` · <a data-goto="${info.line}">Zeile ${info.line}</a> in <b>${esc(info.fn)}</b>` : '') + ` · Bild ${info.frame}`;
        watches = info.watches || watches;
      } else this.setRunning(running);
      el.querySelectorAll('.dbg-ctl [data-cmd]').forEach((b) => { b.disabled = b.dataset.cmd === 'pause' ? !!info || !running : !info; });
      drawVars(); drawStack(); drawWatch();
    },
    setRunning(on) {
      running = on;
      if (halt) return;
      const st = $('dbgState');
      st.className = 'dbg-state' + (on ? ' run' : '');
      st.textContent = on ? '▶ Das Spiel läuft.' : 'Das Spiel läuft gerade nicht.';
      el.querySelectorAll('.dbg-ctl [data-cmd]').forEach((b) => { b.disabled = b.dataset.cmd === 'pause' ? !on : true; });
      drawVars();
    },
    setWatches(values) { watches = values; drawWatch(); },
    setWatchList(list) { watchList = list.slice(); drawWatch(); },
    setBreakpoints(list) {
      $('dbgBps').innerHTML = list.length
        ? list.map((b) => `<div class="dbg-bp"><button class="dbg-bpl" data-goto="${b.line}"><span class="dbg-dot"></span>Zeile ${b.line}</button><code>${esc(b.text.trim().slice(0, 40))}</code><button class="dbg-x" data-rmbp="${b.line}" aria-label="Haltepunkt entfernen">✕</button></div>`).join('') + '<button class="tb" data-clearbps="1">Alle entfernen</button>'
        : '<p class="side-note">Noch keine. Zeilennummer anklicken setzt einen.</p>';
    },
  };
}
