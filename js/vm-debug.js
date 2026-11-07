// Fehlersuche für das Studio: Haltepunkte, Schritt für Schritt, Variablen, Beobachten und Live-Neuladen.
// Wird erst angelegt, wenn das Studio es braucht – ohne Haltepunkte läuft die Kartridge genau wie vorher
// (kein Zeilen-Hook, kein Umweg über Coroutinen).
//
// Anhalten: Solange Haltepunkte gesetzt sind, laufen _update und _draw in einer eigenen Lua-Coroutine.
// Erreicht die Ausführung eine Haltepunkt-Zeile, gibt der Zeilen-Hook mit lua_yield ab – die Kartridge steht
// also wirklich mitten in der Zeile, nichts wird abgebrochen oder doppelt gerechnet. „Weiter“ setzt genau dort fort.
// Geht das nicht (Haltepunkt in _init, in einer eigenen Coroutine der Kartridge oder in einer table.sort-Vergleichs-
// funktion), merken wir uns die Variablen, lassen das Bild zu Ende laufen und frieren danach ein.
//
// Live-Neuladen: Der neue Code läuft in einer Sandkiste (_ENV = eigene Tabelle, liest durch auf _G). Danach werden
// alle neuen Funktionen in _G übernommen. Andere Werte nur, wenn sie im Code geändert wurden (Vergleich mit dem
// „Fingerabdruck“ des alten Codes) – so bleibt der Spielstand erhalten, geänderte Startwerte kommen trotzdem an.

import { stripModelBlocks } from './model-pack.js';

const MAX_FRAMES = 16;

// Namen, die nicht zur Kartridge gehören (Lua selbst, Vorspann, Konsole)
const LUA_NAMES = '_G _VERSION assert collectgarbage error getmetatable ipairs load next pairs pcall print rawequal rawget rawlen rawset select setmetatable tonumber tostring type xpcall table string math utf8 coroutine net LEFT RIGHT UP DOWN A B START SELECT MENU OPTION X Y L R SYSTEM SCREEN_W SCREEN_H flr ceil abs sqrt min max pi sin cos atan2 sgn mid clamp rnd printc time'.split(' ');
// Diese Befehle dürfen beim Live-Laden auf oberster Ebene laufen (sie legen nur etwas fest)
const DEFINE = new Set('sprite fset palette model modelload mtex malpha mglow mcol mwave light3d fog3d log'.split(' '));
// Diese lesen nur – sie laufen immer
const READONLY = new Set('pget textw ui_textw ui_wrap sprsize mget fget btn btnp playpos now date playing t frame fetch m7pos pos3d tris3d stick rgb'.split(' '));

// kleiner, schneller Hash für Fingerabdrücke
function hash(str) {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h2 >>> 0).toString(36) + (h1 >>> 0).toString(36) + ':' + str.length;
}

const numText = (n) => (Number.isInteger(n) ? String(n) : Math.abs(n) >= 1e6 || Math.abs(n) < 1e-4 && n !== 0 ? n.toPrecision(4) : String(Math.round(n * 1000) / 1000));

export function createDebugEngine(x) {
  const { fengari, L, CartError, timeHook, apiNames, netNames } = x;
  const { lua, lauxlib, to_luastring: ls, to_jsstring: js } = fengari;
  const S_INFO = ls('S'), SNL_INFO = ls('Snl'), F_INFO = ls('f'), GS_INFO = ls('>S');
  const CART = '=cart';
  const builtin = new Set([...LUA_NAMES, ...apiNames]);

  let bps = new Set();      // Zeilen, an denen angehalten wird
  let step = false;         // an der nächsten Zeile anhalten
  let mute = 0;             // Zeilen-Ereignisse überhören (Live-Laden, Beobachten)
  let lineHook = false;
  let co = null, coRef = null;  // Coroutine für _update/_draw
  let phase = 0, fresh = true, midFrame = false;
  let yielded = false;
  let halted = null;        // Haltestelle (Infos für das Studio) oder null
  let haltedAt = 0;
  let pending = null;       // Haltepunkt ohne Anhalten erreicht → nach dem Bild einfrieren
  let skipBps = false;      // „Nächstes Bild“: Rest des angehaltenen Bildes ohne Haltepunkte
  let framesLeft = 0;       // nach so vielen fertigen Bildern anhalten
  let watches = [];         // { expr, ref, err, hist }
  let envRef = null;        // lokale Variablen an der Haltestelle (für Beobachten)
  let base = null;          // Fingerabdrücke des aktuell laufenden Codes
  let code = null;          // Code, der gerade läuft (null = der beim Start)
  let watchTick = 0;
  const threads = new Set();
  let listener = null;
  const notify = (type, data) => listener?.(type, data);

  // ---------------------------------------------------------------- Hook
  function hook(Lx, ar) {
    if (ar.event === lua.LUA_HOOKCOUNT) return timeHook(Lx, ar);
    if (Lx !== L && Lx !== co && threads.size < 400) threads.add(Lx);
    if (mute || (!step && !bps.has(ar.currentline))) return 0;
    lua.lua_getinfo(Lx, S_INFO, ar);
    if (!ar.source || js(ar.source) !== CART) return 0;
    if (skipBps && !step) return 0;
    const canPause = Lx === co && lua.lua_isyieldable(Lx);
    if (canPause) {
      const reason = bps.has(ar.currentline) && !step ? 'Haltepunkt' : 'Schritt';
      halted = snapshot(Lx, reason, true);
      yielded = true;
      lua.lua_yield(Lx, 0);
      return 0;
    }
    if (step) return 0; // Schritte gehen nur dort, wo wir wirklich anhalten können
    if (!pending) pending = snapshot(Lx, 'Haltepunkt', false);
    return 0;
  }
  function syncHook() {
    const want = bps.size > 0 || step;
    if (want === lineHook) return;
    lineHook = want;
    const set = (t) => (want ? lua.lua_sethook(t, hook, lua.LUA_MASKCOUNT | lua.LUA_MASKLINE, 10000) : lua.lua_sethook(t, timeHook, lua.LUA_MASKCOUNT, 10000));
    set(L);
    if (co) set(co);
    if (!want) { threads.forEach((t) => { try { set(t); } catch { /* weg */ } }); threads.clear(); }
  }

  // ---------------------------------------------------------------- Werte lesen (nur lesen: keine Metamethoden)
  function keyText(Lx, i) {
    const t = lua.lua_type(Lx, i);
    if (t === lua.LUA_TSTRING) return js(lua.lua_tolstring(Lx, i));
    if (t === lua.LUA_TNUMBER) return '[' + numText(lua.lua_tonumber(Lx, i)) + ']';
    if (t === lua.LUA_TBOOLEAN) return '[' + lua.lua_toboolean(Lx, i) + ']';
    return '[?]';
  }
  function short(Lx, i, depth = 0) {
    const t = lua.lua_type(Lx, i);
    switch (t) {
      case lua.LUA_TNIL: return 'nil';
      case lua.LUA_TBOOLEAN: return lua.lua_toboolean(Lx, i) ? 'true' : 'false';
      case lua.LUA_TNUMBER: return lua.lua_isinteger(Lx, i) ? String(lua.lua_tointeger(Lx, i)) : numText(lua.lua_tonumber(Lx, i));
      case lua.LUA_TSTRING: { const s = js(lua.lua_tolstring(Lx, i)); return JSON.stringify(s.length > 48 ? s.slice(0, 46) + '…' : s); }
      case lua.LUA_TFUNCTION: return lua.lua_iscfunction(Lx, i) ? 'ƒ eingebaut' : 'ƒ funktion';
      case lua.LUA_TTHREAD: return 'coroutine';
      case lua.LUA_TTABLE: {
        if (depth > 0) return '{…}';
        const abs = lua.lua_absindex(Lx, i);
        const parts = [];
        let n = 0, seq = 1;
        lua.lua_checkstack(Lx, 6);
        lua.lua_pushnil(Lx);
        while (lua.lua_next(Lx, abs) !== 0) {
          n++;
          if (parts.length < 6) {
            const isSeq = lua.lua_type(Lx, -2) === lua.LUA_TNUMBER && lua.lua_isinteger(Lx, -2) && lua.lua_tointeger(Lx, -2) === seq;
            if (isSeq) seq++;
            parts.push((isSeq ? '' : keyText(Lx, -2) + '=') + short(Lx, -1, depth + 1));
          }
          lua.lua_pop(Lx, 1);
        }
        return '{' + parts.join(', ') + (n > parts.length ? ', …' : '') + '}' + (n > 6 ? ` (${n})` : '');
      }
      default: return lua.lua_typename(Lx, t) ? js(lua.lua_typename(Lx, t)) : '?';
    }
  }
  // Wert für die Anzeige: Kurzform, bei Tabellen auch die Einträge (eine Ebene)
  function value(Lx, i) {
    const v = { v: short(Lx, i) };
    if (lua.lua_type(Lx, i) === lua.LUA_TTABLE) {
      const abs = lua.lua_absindex(Lx, i);
      const kids = [];
      let n = 0;
      lua.lua_checkstack(Lx, 6);
      lua.lua_pushnil(Lx);
      while (lua.lua_next(Lx, abs) !== 0) {
        if (n++ < 60) {
          const kt = lua.lua_type(Lx, -2);
          kids.push({ k: keyText(Lx, -2), n: kt === lua.LUA_TNUMBER ? lua.lua_tonumber(Lx, -2) : null, v: short(Lx, -1, 1) === '{…}' ? short(Lx, -1, 0) : short(Lx, -1, 1) });
        }
        lua.lua_pop(Lx, 1);
      }
      kids.sort((a, b) => (a.n !== null && b.n !== null ? a.n - b.n : a.n !== null ? -1 : b.n !== null ? 1 : a.k.localeCompare(b.k)));
      v.kids = kids.map(({ k, v: vv }) => ({ k, v: vv }));
      v.count = n;
    }
    return v;
  }

  // Globale Variablen der Kartridge (ohne Funktionen und ohne alles Eingebaute)
  function globals(Lx) {
    const out = [];
    lua.lua_checkstack(Lx, 8);
    lua.lua_pushglobaltable(Lx);
    const g = lua.lua_gettop(Lx);
    lua.lua_pushnil(Lx);
    while (lua.lua_next(Lx, g) !== 0) {
      if (lua.lua_type(Lx, -2) === lua.LUA_TSTRING && lua.lua_type(Lx, -1) !== lua.LUA_TFUNCTION) {
        const name = js(lua.lua_tolstring(Lx, -2));
        if (!builtin.has(name) && out.length < 120) out.push({ name, ...value(Lx, -1) });
      }
      lua.lua_pop(Lx, 1);
    }
    lua.lua_pop(Lx, 1);
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }

  // Name einer Funktion: aus dem Aufruf oder aus ihrer ersten Zeile im Code („function _update()“)
  let linesFor = null, lines = [];
  function frameName(ar) {
    if (ar.what && js(ar.what) === 'main') return 'Hauptteil';
    const src = code ?? x.getCode();
    if (linesFor !== src) { linesFor = src; lines = src.split('\n'); }
    const head = lines[ar.linedefined - 1] || '';
    const m = /function\s+([A-Za-z_][\w.:]*)\s*\(/.exec(head) || /([A-Za-z_][\w.]*)\s*=\s*function\b/.exec(head);
    if (m) return m[1];
    return ar.name ? js(ar.name) : 'Funktion';
  }

  // Aufrufstapel mit lokalen Variablen und Upvalues; makeEnv: Tabelle für „Beobachten“ anlegen
  function snapshot(Lx, reason, makeEnv) {
    const frames = [];
    const ar = new lua.lua_Debug();
    lua.lua_checkstack(Lx, 12);
    if (makeEnv) { lua.lua_newtable(Lx); }
    const envIdx = makeEnv ? lua.lua_gettop(Lx) : 0;
    for (let level = 0; level < 40 && frames.length < MAX_FRAMES; level++) {
      if (!lua.lua_getstack(Lx, level, ar)) break;
      lua.lua_getinfo(Lx, SNL_INFO, ar);
      if (!ar.source || js(ar.source) !== CART) continue;
      const fr = { name: frameName(ar), line: ar.currentline, locals: [], ups: [] };
      const seen = new Set();
      for (let n = 1; n < 250; n++) {
        const name = lua.lua_getlocal(Lx, ar, n);
        if (name === null) break;
        const nm = js(name);
        if (nm[0] !== '(') {
          // gleichnamige Variable weiter innen verdeckt die äußere: die letzte gewinnt
          const val = value(Lx, -1);
          const old = fr.locals.findIndex((l) => l.name === nm);
          if (old >= 0) fr.locals.splice(old, 1);
          fr.locals.push({ name: nm, ...val });
          if (makeEnv && frames.length === 0) { lua.lua_pushvalue(Lx, -1); lua.lua_setfield(Lx, envIdx, name); }
          seen.add(nm);
        }
        lua.lua_pop(Lx, 1);
      }
      lua.lua_getinfo(Lx, F_INFO, ar);
      for (let n = 1; n < 120; n++) {
        const name = lua.lua_getupvalue(Lx, -1, n);
        if (name === null) break;
        const nm = js(name);
        if (nm !== '_ENV' && nm[0] !== '(') {
          fr.ups.push({ name: nm, ...value(Lx, -1) });
          if (makeEnv && frames.length === 0 && !seen.has(nm)) { lua.lua_pushvalue(Lx, -1); lua.lua_setfield(Lx, envIdx, name); }
        }
        lua.lua_pop(Lx, 1);
      }
      lua.lua_pop(Lx, 1);
      frames.push(fr);
    }
    if (makeEnv) {
      lua.lua_newtable(Lx);
      lua.lua_pushglobaltable(Lx);
      lua.lua_setfield(Lx, -2, ls('__index'));
      lua.lua_setmetatable(Lx, envIdx);
      if (envRef !== null) lauxlib.luaL_unref(Lx, lua.LUA_REGISTRYINDEX, envRef);
      envRef = lauxlib.luaL_ref(Lx, lua.LUA_REGISTRYINDEX);
    }
    const top = frames[0];
    return { reason, line: top ? top.line : null, fn: top ? top.name : null, frames, globals: globals(Lx), frame: x.frameNo() };
  }

  // ---------------------------------------------------------------- Bild für Bild
  function newThread() {
    killThread();
    co = lua.lua_newthread(L);
    coRef = lauxlib.luaL_ref(L, lua.LUA_REGISTRYINDEX);
    lua.lua_sethook(co, lineHook ? hook : timeHook, lineHook ? lua.LUA_MASKCOUNT | lua.LUA_MASKLINE : lua.LUA_MASKCOUNT, 10000);
  }
  function killThread() {
    if (coRef !== null) lauxlib.luaL_unref(L, lua.LUA_REGISTRYINDEX, coRef);
    co = null; coRef = null;
  }
  function resumePhase() {
    x.resetClock();
    yielded = false;
    const st = lua.lua_resume(co, L, 0);
    if (st === lua.LUA_YIELD) {
      if (yielded) return false;
      killThread();
      throw new CartError('attempt to yield from outside a coroutine');
    }
    if (st !== lua.LUA_OK) {
      const msg = lua.lua_tojsstring(co, -1) ?? 'Unbekannter Fehler';
      lauxlib.luaL_traceback(L, co, ls(msg), 0);
      const trace = lua.lua_tojsstring(L, -1);
      lua.lua_pop(L, 1);
      killThread();
      throw new CartError(trace);
    }
    lua.lua_settop(co, 0);
    return true;
  }
  function startPhase(name) {
    if (!co || lua.lua_status(co) !== lua.LUA_OK) newThread();
    lua.lua_settop(co, 0);
    lua.lua_getglobal(co, ls(name));
    if (lua.lua_type(co, -1) !== lua.LUA_TFUNCTION) { lua.lua_settop(co, 0); return true; }
    return resumePhase();
  }

  const engaged = () => lineHook || framesLeft > 0 || midFrame || pending !== null;

  function frame() {
    if (halted) return;
    if (!engaged()) {
      x.update(); x.draw();
      frameDone();
      return;
    }
    if (!midFrame) { x.beginFrame(); phase = 0; fresh = true; midFrame = true; }
    while (phase < 2) {
      const done = fresh ? startPhase(phase === 0 ? '_update' : '_draw') : resumePhase();
      if (!done) { fresh = false; step = false; syncHook(); haltNow(); return; }
      phase++; fresh = true;
    }
    midFrame = false;
    frameDone();
  }
  function frameDone() {
    skipBps = false;
    if (pending) { halted = pending; pending = null; }
    else if (framesLeft > 0 && --framesLeft === 0) halted = { reason: 'Bild', line: null, fn: null, frames: [], globals: globals(L), frame: x.frameNo() };
    if (halted) {
      if (envRef !== null && halted.reason === 'Bild') dropEnv();
      haltNow();
      return;
    }
    if (watches.length) {
      evalWatches(false);
      if (++watchTick % 4 === 0) notify('watch', watchValues());
    }
  }
  function haltNow() {
    haltedAt = performance.now();
    if (watches.length) evalWatches(true);
    halted.watches = watchValues();
    halted.midFrame = midFrame;
    notify('halt', halted);
  }
  function release() {
    if (!halted) return false;
    x.shiftTime(performance.now() - haltedAt);
    halted = null;
    dropEnv();
    notify('resume', null);
    return true;
  }
  function dropEnv() { if (envRef !== null) { lauxlib.luaL_unref(L, lua.LUA_REGISTRYINDEX, envRef); envRef = null; } }

  // ---------------------------------------------------------------- Beobachten
  function compileWatch(w) {
    if (lauxlib.luaL_loadbuffer(L, ls('return ' + w.expr), null, ls('=watch')) !== lua.LUA_OK) {
      lua.lua_pop(L, 1);
      w.err = 'kein gültiger Ausdruck';
      return;
    }
    w.ref = lauxlib.luaL_ref(L, lua.LUA_REGISTRYINDEX);
  }
  function evalWatches(useEnv) {
    mute++;
    try {
      for (const w of watches) {
        if (w.ref === null) continue;
        lua.lua_rawgeti(L, lua.LUA_REGISTRYINDEX, w.ref);
        if (useEnv && envRef !== null) lua.lua_rawgeti(L, lua.LUA_REGISTRYINDEX, envRef); else lua.lua_pushglobaltable(L);
        lua.lua_setupvalue(L, -2, 1);
        x.resetClock();
        if (lua.lua_pcall(L, 0, 1, 0) !== lua.LUA_OK) {
          w.val = null;
          w.err = String(lua.lua_tojsstring(L, -1) ?? 'Fehler').replace(/^watch:\d+:\s*/, '');
        } else {
          w.err = null;
          w.val = value(L, -1);
          const num = lua.lua_type(L, -1) === lua.LUA_TNUMBER ? lua.lua_tonumber(L, -1) : lua.lua_type(L, -1) === lua.LUA_TBOOLEAN ? (lua.lua_toboolean(L, -1) ? 1 : 0) : null;
          if (!useEnv) { w.hist.push(num); if (w.hist.length > 120) w.hist.shift(); }
        }
        lua.lua_pop(L, 1);
      }
    } finally { mute--; }
  }
  const watchValues = () => watches.map((w) => ({ expr: w.expr, v: w.val?.v ?? null, kids: w.val?.kids, err: w.err, hist: w.hist.slice() }));

  // ---------------------------------------------------------------- Fingerabdrücke für das Live-Neuladen
  const ids = new WeakMap();
  let nextId = 1;
  const idOf = (o) => { if (!ids.has(o)) ids.set(o, nextId++); return ids.get(o); };
  function fingerprint(i, lines) {
    const abs = lua.lua_absindex(L, i);
    let budget = 4000;
    const seen = new Set();
    const ar = new lua.lua_Debug();
    const walk = (idx, depth) => {
      if (--budget < 0) throw 0;
      const t = lua.lua_type(L, idx);
      switch (t) {
        case lua.LUA_TNIL: return 'z';
        case lua.LUA_TBOOLEAN: return lua.lua_toboolean(L, idx) ? 'T' : 'F';
        case lua.LUA_TNUMBER: return (lua.lua_isinteger(L, idx) ? 'i' : 'n') + lua.lua_tonumber(L, idx);
        case lua.LUA_TSTRING: return 's' + js(lua.lua_tolstring(L, idx));
        case lua.LUA_TFUNCTION: {
          if (lua.lua_iscfunction(L, idx)) return 'c' + idOf(lua.lua_topointer(L, idx));
          lua.lua_pushvalue(L, idx);
          lua.lua_getinfo(L, GS_INFO, ar);
          if (js(ar.source) !== CART) return 'p' + ar.linedefined;
          return 'f' + lines.slice(Math.max(0, ar.linedefined - 1), ar.lastlinedefined).join('\n');
        }
        case lua.LUA_TTABLE: {
          const p = lua.lua_topointer(L, idx);
          if (seen.has(p) || depth > 8) return 'r';
          seen.add(p);
          const a = lua.lua_absindex(L, idx);
          const parts = [];
          lua.lua_checkstack(L, 4);
          lua.lua_pushnil(L);
          while (lua.lua_next(L, a) !== 0) {
            const kt = lua.lua_type(L, -2);
            const k = kt === lua.LUA_TSTRING ? 's' + js(lua.lua_tolstring(L, -2)) : kt === lua.LUA_TNUMBER ? 'n' + lua.lua_tonumber(L, -2) : kt === lua.LUA_TBOOLEAN ? 'b' + lua.lua_toboolean(L, -2) : '?';
            parts.push(k + '=' + walk(-1, depth + 1));
            lua.lua_pop(L, 1);
          }
          return '{' + parts.sort().join(',') + '}';
        }
        default: return 'u' + t;
      }
    };
    const top = lua.lua_gettop(L);
    try { return hash(walk(abs, 0)); } catch (e) { lua.lua_settop(L, top); if (e === 0) return null; throw e; }
  }

  // Code in der Sandkiste ausführen. live = false: nur zum Vergleichen (alles mit Wirkung abgeschaltet).
  // Ergebnis bleibt auf dem Stapel: [chunk, sandkiste]; zurück kommen Namen, Fingerabdrücke und die Stummel-Namen.
  function sandboxRun(src, live) {
    src = stripModelBlocks(src);   // Modell-Blöcke (Base64) muss Lua nicht lesen
    if (lauxlib.luaL_loadbuffer(L, ls(src), null, ls(CART)) !== lua.LUA_OK) {
      const msg = lua.lua_tojsstring(L, -1);
      lua.lua_pop(L, 1);
      throw new CartError(msg);
    }
    const chunk = lua.lua_gettop(L);
    lua.lua_newtable(L);
    const cap = lua.lua_gettop(L);
    const noop = () => 0;
    const stubs = new Set();
    for (const name of apiNames) {
      if (READONLY.has(name) || (live && DEFINE.has(name))) continue;
      lua.lua_pushjsfunction(L, noop); lua.lua_setfield(L, cap, ls(name)); stubs.add(name);
    }
    lua.lua_pushjsfunction(L, noop); lua.lua_setfield(L, cap, ls('printc')); stubs.add('printc');
    lua.lua_newtable(L);
    for (const name of netNames) { lua.lua_pushjsfunction(L, noop); lua.lua_setfield(L, -2, ls(name)); }
    lua.lua_setfield(L, cap, ls('net')); stubs.add('net');
    lua.lua_newtable(L);
    lua.lua_pushglobaltable(L);
    lua.lua_setfield(L, -2, ls('__index'));
    lua.lua_setmetatable(L, cap);
    lua.lua_pushvalue(L, cap);
    lua.lua_setupvalue(L, chunk, 1);
    // gleicher Zufall für alten und neuen Code, damit unveränderte Zufallswerte gleich aussehen
    reseed(12345);
    lua.lua_pushvalue(L, chunk);
    x.protectedCall(0);
    // ab jetzt sehen alle Funktionen aus diesem Code die echte globale Tabelle
    lua.lua_pushglobaltable(L);
    lua.lua_setupvalue(L, chunk, 1);
    const lines = src.split('\n');
    const entries = [];
    lua.lua_pushnil(L);
    while (lua.lua_next(L, cap) !== 0) {
      if (lua.lua_type(L, -2) === lua.LUA_TSTRING) {
        const name = js(lua.lua_tolstring(L, -2));
        const t = lua.lua_type(L, -1);
        if (!(stubs.has(name) && (t === lua.LUA_TTABLE || lua.lua_iscfunction(L, -1)))) {
          const e = { name, fn: t === lua.LUA_TFUNCTION && !lua.lua_iscfunction(L, -1), fp: fingerprint(-1, lines), ups: [] };
          if (e.fn) {
            for (let n = 1; ; n++) {
              const un = lua.lua_getupvalue(L, -1, n);
              if (un === null) break;
              const u = js(un);
              e.ups.push({ n, name: u, fp: u === '_ENV' ? null : fingerprint(-1, lines) });
              lua.lua_pop(L, 1);
            }
          }
          entries.push(e);
        }
      }
      lua.lua_pop(L, 1);
    }
    return { entries, lines };
  }
  function reseed(n) {
    lua.lua_getglobal(L, ls('math'));
    lua.lua_getfield(L, -1, ls('randomseed'));
    lua.lua_pushinteger(L, n);
    x.protectedCall(1);
    lua.lua_pop(L, 1);
  }
  const printsOf = (entries) => {
    const p = new Map();
    for (const e of entries) {
      p.set(e.name, e.fp);
      for (const u of e.ups) if (u.name !== '_ENV') p.set(e.name + '\u0001' + u.name, u.fp);
    }
    return p;
  };

  function reload(newCode) {
    const top = lua.lua_gettop(L);
    mute++;
    const result = { ok: false, fns: [], vals: [], kept: [] };
    try {
      // 1. Fingerabdruck des laufenden Codes (einmal pro Start, danach vom letzten Live-Laden)
      if (code === null) code = x.getCode();
      if (!base || base.code !== code) {
        try {
          base = { code, prints: printsOf(sandboxRun(code, false).entries) };
        } catch { base = { code, prints: new Map() }; }
        lua.lua_settop(L, top);
      }
      // 2. neuen Code in der Sandkiste laufen lassen
      const { entries } = sandboxRun(newCode, true);
      const cap = lua.lua_gettop(L);
      lua.lua_pushglobaltable(L);
      const g = lua.lua_gettop(L);
      const get = (tbl, name) => { lua.lua_pushstring(L, ls(name)); lua.lua_rawget(L, tbl); };
      // 3. Zustand der lokalen Variablen (Upvalues) übernehmen, wenn ihr Startwert im Code gleich blieb
      const joined = new Map(); // upvalue-id der neuen Funktion → [alte Funktion (Name), Index]
      const fnEntries = entries.filter((e) => e.fn);
      for (const e of fnEntries) {
        get(g, e.name);
        const oldF = lua.lua_gettop(L);
        if (lua.lua_type(L, oldF) === lua.LUA_TFUNCTION && !lua.lua_iscfunction(L, oldF)) {
          const oldUps = new Map();
          for (let n = 1; ; n++) { const un = lua.lua_getupvalue(L, oldF, n); if (un === null) break; oldUps.set(js(un), n); lua.lua_pop(L, 1); }
          get(cap, e.name);
          const newF = lua.lua_gettop(L);
          for (const u of e.ups) {
            if (u.name === '_ENV' || !oldUps.has(u.name)) continue;
            const was = base.prints.get(e.name + '\u0001' + u.name);
            if (was === undefined || was === null || was !== u.fp) continue;
            const id = lua.lua_upvalueid(L, newF, u.n);
            lua.lua_upvaluejoin(L, newF, u.n, oldF, oldUps.get(u.name));
            if (!joined.has(id)) joined.set(id, [e.name, oldUps.get(u.name)]);
          }
          lua.lua_pop(L, 1);
        }
        lua.lua_pop(L, 1);
      }
      // neue Funktionen, die sich eine solche Variable mit einer übernommenen teilen, hängen sich mit dran
      if (joined.size) {
        for (const e of fnEntries) {
          get(cap, e.name);
          const newF = lua.lua_gettop(L);
          for (const u of e.ups) {
            if (u.name === '_ENV') continue;
            const id = lua.lua_upvalueid(L, newF, u.n);
            const j = joined.get(id);
            if (!j) continue;
            get(g, j[0]);
            lua.lua_upvaluejoin(L, newF, u.n, lua.lua_gettop(L), j[1]);
            lua.lua_pop(L, 1);
          }
          lua.lua_pop(L, 1);
        }
      }
      // 4. übernehmen: Funktionen immer, Werte nur wenn neu oder im Code geändert
      for (const e of entries) {
        get(g, e.name);
        const isNew = lua.lua_type(L, -1) === lua.LUA_TNIL;
        lua.lua_pop(L, 1);
        const was = base.prints.get(e.name);
        const changed = was !== undefined && was !== null && e.fp !== null && was !== e.fp;
        if (e.fn || isNew || changed) {
          lua.lua_pushstring(L, ls(e.name));
          get(cap, e.name);
          lua.lua_rawset(L, g);
          if (e.fn) { if (was === undefined || was !== e.fp) result.fns.push(e.name); } else result.vals.push(e.name);
        } else result.kept.push(e.name);
      }
      base = { code: newCode, prints: printsOf(entries) };
      code = newCode;
      result.ok = true;
    } catch (err) {
      result.error = err instanceof CartError ? err : new CartError(String(err?.message || err));
    } finally {
      lua.lua_settop(L, top);
      reseed(Math.floor(Math.random() * 2 ** 31));
      mute--;
    }
    return result;
  }

  // ---------------------------------------------------------------- nach außen
  return {
    get halted() { return halted; },
    get midFrame() { return midFrame; },
    get breakpoints() { return [...bps]; },
    get engaged() { return engaged(); },
    onEvent(fn) { listener = fn; },
    frame,
    reload,
    setBreakpoints(lines) { bps = new Set(lines.map((n) => n | 0).filter((n) => n > 0)); syncHook(); },
    setWatches(list) {
      const keep = new Map(watches.map((w) => [w.expr, w]));
      for (const w of watches) if (!list.includes(w.expr) && w.ref !== null) lauxlib.luaL_unref(L, lua.LUA_REGISTRYINDEX, w.ref);
      watches = list.filter((e, i) => e.trim() && list.indexOf(e) === i).map((expr) => {
        if (keep.has(expr)) return keep.get(expr);
        const w = { expr, ref: null, err: null, val: null, hist: [] };
        compileWatch(w);
        return w;
      });
      if (halted) { evalWatches(true); halted.watches = watchValues(); notify('halt', halted); }
      else if (watches.length) { evalWatches(false); notify('watch', watchValues()); }
    },
    configure({ breakpoints = [], watches: w = [] } = {}) { this.setBreakpoints(breakpoints); if (w.length) this.setWatches(w); },
    // nach vm.run: Haltepunkt in _init oder auf oberster Ebene erreicht?
    afterRun() { if (pending) { halted = pending; pending = null; haltNow(); } },
    // Weiter bis zum nächsten Haltepunkt
    resume() { if (!release()) return; step = false; framesLeft = 0; syncHook(); },
    // genau ein Bild weiter (Haltepunkte im nächsten Bild zählen), dann wieder anhalten
    nextFrame() { const mid = midFrame; if (halted) release(); step = false; framesLeft = mid ? 2 : 1; skipBps = mid; syncHook(); },
    // bis zur nächsten Zeile der Kartridge
    step() { if (halted) release(); step = true; framesLeft = 0; syncHook(); },
    // „Anhalten“, während das Spiel läuft: an der nächsten Zeile
    pause() { if (!halted) { step = true; syncHook(); } },
  };
}
