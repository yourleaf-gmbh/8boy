// Lua-Brücke: startet für jede Kartridge eine frische, abgeschottete Lua-5.3-Maschine (fengari)
// und stellt ihr die 8BOY-API als globale Funktionen bereit.
import { MAX_SPRITES } from './gfx.js';
import { MACHINES } from './machines.js';
import { createDebugEngine } from './vm-debug.js';
import { FX_POST, FX_FORMS } from './gpufx.js';
import { stripModelBlocks, modelBlocks, decodeModelBlock, meshToChip, unpackModel } from './model-pack.js';
import { istFigur, unpackSkin, skinToChip, pose, knochenPos, mat4mul } from './skin.js';
import { createWelt, createAuto, MAX_AUTOS } from './physik.js';
import { builtinModel, customModel } from './gfx3d.js';
import { rumblePattern, padinfoClean } from './input.js';
import { uiTextW, uiWrap } from './ui-ebene.js';

const BUTTONS = ['left', 'right', 'up', 'down', 'a', 'b', 'start', 'select', 'x', 'y', 'l', 'r'];
const TIME_LIMIT_MS = 2500; // so lange darf ein einzelner Aufruf rechnen, dann gilt er als Endlosschleife

const prelude = (m) => `
LEFT, RIGHT, UP, DOWN, A, B, START, SELECT = 0, 1, 2, 3, 4, 5, 6, 7
MENU, OPTION = 6, 7
SCREEN_W, SCREEN_H = ${m.w}, ${m.h}${m.id >= 16 ? `
X, Y, L, R = 8, 9, 10, 11
SYSTEM = ${m.id}` : ''}
flr, ceil, abs, sqrt = math.floor, math.ceil, math.abs, math.sqrt
min, max, pi = math.min, math.max, math.pi
sin, cos = math.sin, math.cos
function atan2(y, x) return math.atan(y, x) end
function sgn(x) if x > 0 then return 1 elseif x < 0 then return -1 end return 0 end
function mid(a, b, c) if a > b then a, b = b, a end if c < a then return a elseif c > b then return b end return c end
function clamp(v, lo, hi) return math.max(lo, math.min(hi, v)) end
function rnd(a, b)
  if type(a) == "table" then return a[math.random(#a)] end
  if b then
    if math.type(a) == "integer" and math.type(b) == "integer" then return math.random(a, b) end
    return a + math.random() * (b - a)
  end
  return math.random() * (a or 1)
end
function printc(text, y, c, s) return print(text, (SCREEN_W - textw(text, s)) // 2, y, c, s) end
time = t
`;

export class CartError extends Error {
  constructor(raw) {
    const text = String(raw);
    const m = /^cart:(\d+):\s*([^\n]*)/.exec(text);
    super(m ? m[2] : text.split('\n')[0].replace(/^prelude:\d+:\s*/, ''));
    // Fehler in Systemfunktionen: die erste Kartridge-Zeile aus dem Stack nehmen
    const where = m || /cart:(\d+):/.exec(text);
    this.line = where ? parseInt(where[1], 10) : null;
    this.trace = text;
  }
}

// machine: die Konsole, für die die Kartridge gebaut ist (8BOY-Kartridges sehen auch auf dem 8BOY 16 nur 8BOY)
// access: Zugänglichkeit (nur für Kartridges mit „-- a11y: voll“), sonst sind say/choose/cue/caption wirkungslos
export function createVM({ fengari, gfx, audio, input, storage, onLog = () => {}, machine = MACHINES[8], net = null, access = null, assets = null }) {
  const SUPER = machine.id >= 16;
  const PRELUDE = prelude(machine);
  const { lua, lauxlib, lualib, to_luastring } = fengari;
  const L = lauxlib.luaL_newstate();
  let callStart = 0;
  let frameCount = 0;
  let startTime = performance.now();
  let cartCode = '';
  let modelCache = null;
  const figuren = [];
  // 8BOY 128, große Welten: Form jedes Modells (für die Kollisionswelt), die Welt selbst und bis zu 8 Fahrzeuge
  const formen = [], welt = createWelt(), autos = [];
    // 8BOY 128: Figuren je Modell-Nummer { fig, buf }   // Modell-Blöcke der Kartridge (erst beim ersten modelload gelesen)
  const cursor = { x: 1, y: 1 };

  // Nur sichere Bibliotheken: kein io, os, package, debug, js
  for (const [name, open] of [['_G', lualib.luaopen_base], ['table', lualib.luaopen_table],
    ['string', lualib.luaopen_string], ['math', lualib.luaopen_math], ['utf8', lualib.luaopen_utf8],
    ['coroutine', lualib.luaopen_coroutine]]) {
    lauxlib.luaL_requiref(L, to_luastring(name), open, 1);
    lua.lua_pop(L, 1);
  }
  for (const name of ['dofile', 'loadfile', 'require']) { lua.lua_pushnil(L); lua.lua_setglobal(L, to_luastring(name)); }

  const timeHook = (L) => {
    if (performance.now() - callStart > TIME_LIMIT_MS) {
      lauxlib.luaL_error(L, to_luastring('Rechenzeit überschritten – Endlosschleife?'));
    }
  };
  lua.lua_sethook(L, timeHook, lua.LUA_MASKCOUNT, 10000);

  let S = L; // aktueller Lua-Thread (wichtig für Coroutinen)
  const warned = {};   // Hinweise nur einmal ins Protokoll
  const isNil = (i) => lua.lua_isnoneornil(S, i);
  const num = (i, d = 0) => (isNil(i) ? d : lauxlib.luaL_checknumber(S, i));
  const bool = (i) => lua.lua_toboolean(S, i);
  const str = (i) => {
    lauxlib.luaL_tolstring(S, i);
    const s = lua.lua_tojsstring(S, -1);
    lua.lua_pop(S, 1);
    return s;
  };
  const player = (i) => (isNil(i) ? undefined : num(i) | 0);
  const button = (i) => {
    if (lua.lua_type(S, i) === lua.LUA_TSTRING) {
      const k = BUTTONS.indexOf(lua.lua_tojsstring(S, i).toLowerCase());
      if (k < 0 || k >= machine.buttons) lauxlib.luaL_argerror(S, i, to_luastring('unbekannte Taste'));
      return k;
    }
    const k = num(i, 0) | 0;
    return SUPER ? (k >= 0 && k < machine.buttons ? k : -1) : k & 7;
  };
  const BLEND = { aus: 0, halb: 1, hell: 2, dunkel: 3 };
  const spriteNo = (i) => {
    const n = lauxlib.luaL_checknumber(S, i) | 0;
    if (n < 0 || n >= MAX_SPRITES) lauxlib.luaL_argerror(S, i, to_luastring(`Sprite-Nummer 0-${MAX_SPRITES - 1}`));
    return n;
  };

  const api = {
    cls() { gfx.cls(num(1, 0)); cursor.x = 1; cursor.y = 1; return 0; },
    pset() { gfx.pset(num(1), num(2), num(3, 7)); return 0; },
    pget() { lua.lua_pushinteger(S, gfx.pget(num(1), num(2))); return 1; },
    line() { gfx.line(num(1), num(2), num(3), num(4), num(5, 7)); return 0; },
    rect() { gfx.rect(num(1), num(2), num(3), num(4), num(5, 7)); return 0; },
    rectfill() { gfx.rectfill(num(1), num(2), num(3), num(4), num(5, 7)); return 0; },
    circ() { gfx.circ(num(1), num(2), num(3, 4), num(4, 7)); return 0; },
    circfill() { gfx.circfill(num(1), num(2), num(3, 4), num(4, 7)); return 0; },
    print() {
      const text = isNil(1) ? '' : str(1);
      let w;
      if (isNil(2)) {
        // ohne Position: wie ein Terminal Zeile für Zeile
        const st = gfx.state, cx = st.camX, cy = st.camY;
        gfx.camera(0, 0);
        w = gfx.text(text, cursor.x, cursor.y, num(3, 7));
        gfx.camera(cx, cy);
        cursor.y += 9 * (text.split('\n').length);
      } else {
        w = gfx.text(text, num(2), num(3), num(4, 7), num(5, 1));
      }
      lua.lua_pushinteger(S, w);
      return 1;
    },
    textw() { lua.lua_pushinteger(S, gfx.textWidth(isNil(1) ? '' : str(1), num(2, 1))); return 1; },
    sprite() {
      const n = spriteNo(1);
      if (lua.lua_type(S, 2) === lua.LUA_TTABLE) {
        const rows = [];
        const len = lua.lua_rawlen(S, 2);
        for (let k = 1; k <= len; k++) { lua.lua_rawgeti(S, 2, k); rows.push(lua.lua_tojsstring(S, -1) ?? ''); lua.lua_pop(S, 1); }
        gfx.defineSprite(n, rows.join('\n'));
      } else {
        gfx.defineSprite(n, lauxlib.luaL_checkstring(S, 2) && lua.lua_tojsstring(S, 2));
      }
      return 0;
    },
    spr() { gfx.spr(spriteNo(1), num(2), num(3), bool(4), bool(5), num(6, 1), SUPER ? num(7, 0) : 0); return 0; },
    sprsize() { const [w, h] = gfx.spriteSize(spriteNo(1)); lua.lua_pushinteger(S, w); lua.lua_pushinteger(S, h); return 2; },
    map() { gfx.drawMap(num(1, 0), num(2, 0), num(3, 0), num(4, 0), num(5, 256), num(6, 128)); return 0; },
    mget() { lua.lua_pushinteger(S, gfx.mget(num(1), num(2))); return 1; },
    mset() { gfx.mset(num(1), num(2), num(3, 0)); return 0; },
    fset() {
      const n = spriteNo(1);
      if (isNil(3)) gfx.flags[n] = num(2) & 255;
      else { const bit = 1 << (num(2) & 7); gfx.flags[n] = bool(3) ? gfx.flags[n] | bit : gfx.flags[n] & ~bit; }
      return 0;
    },
    fget() {
      const n = spriteNo(1);
      if (isNil(2)) lua.lua_pushinteger(S, gfx.flags[n]);
      else lua.lua_pushboolean(S, (gfx.flags[n] >> (num(2) & 7)) & 1);
      return 1;
    },
    camera() { gfx.camera(num(1, 0), num(2, 0)); return 0; },
    clip() { if (isNil(1)) gfx.clip(); else gfx.clip(num(1), num(2), num(3), num(4)); return 0; },
    pal() { if (isNil(1)) gfx.pal(); else gfx.pal(num(1), num(2)); return 0; },
    palette() { gfx.setPalette(num(1), num(2), num(3), num(4)); return 0; },
    // btn(taste) = alle Eingaben zusammen, btn(taste, spieler) = nur Spieler 1–4 (Dock/TV, mehrere Gamepads)
    btn() { const k = button(1), p = player(2); lua.lua_pushboolean(S, k >= 0 && input.btn(k, p)); return 1; },
    btnp() { const k = button(1), p = player(2); lua.lua_pushboolean(S, k >= 0 && input.btnp(k, p)); return 1; },
    players() { lua.lua_pushinteger(S, input.players ? input.players() : 1); return 1; },
    pad() { const k = input.pad ? input.pad(num(1, 1) | 0) : null; if (k) lua.lua_pushstring(S, to_luastring(k)); else lua.lua_pushnil(S); return 1; },
    // Rütteln: rumble(spieler, muster) – Handy oder Gamepad des Spielers; ohne Spieler (rumble("sieg")) oder mit nil/0 alle.
    // muster: "tipp", "treffer", "lang", "sieg", "aua", Millisekunden oder Liste {an, aus, an …}. Ohne Gerät: nichts, nie ein Fehler.
    rumble() {
      const t1 = lua.lua_type(S, 1), first = t1 === lua.LUA_TSTRING || t1 === lua.LUA_TTABLE;
      const p = first ? 0 : lua.lua_tonumber(S, 1) | 0, i = first ? 1 : 2;
      const m = isNil(i) ? 'tipp' : readValue(i);
      const pat = rumblePattern(m);
      if (!pat && !warned.rumble) { warned.rumble = true; onLog(`rumble: unbekanntes Muster ${JSON.stringify(m)} – tipp, treffer, lang, sieg, aua, Millisekunden oder Liste`); }
      if (pat && p >= 0 && p <= 4) { try { input.rumble?.(p, pat); } catch { /* egal */ } }
      return 0;
    },
    // Anzeige auf dem Handy von Spieler p: padinfo(p, text, farbe, symbol); padinfo(p) löscht, p = nil/0: alle
    padinfo() {
      const p = isNil(1) ? 0 : lua.lua_tonumber(S, 1) | 0;
      const text = isNil(2) ? '' : str(2), farbe = lua.lua_type(S, 3) === lua.LUA_TNUMBER ? lua.lua_tonumber(S, 3) : null;
      const sym = lua.lua_type(S, 4) === lua.LUA_TSTRING ? lua.lua_tojsstring(S, 4) : null;
      if (p >= 0 && p <= 4) { try { input.padinfo?.(p, padinfoClean(text, farbe, sym)); } catch { /* egal */ } }
      return 0;
    },
    // Maus: x, y (nil außerhalb des Bildes), Tasten (1 links, 2 rechts, 4 Mitte), Bewegung dx, dy, Rad
    mouse() {
      const m = input.mouse;
      if (!m) { lua.lua_pushnil(S); lua.lua_pushnil(S); lua.lua_pushinteger(S, 0); lua.lua_pushinteger(S, 0); lua.lua_pushinteger(S, 0); lua.lua_pushinteger(S, 0); return 6; }
      m.used = true;
      if (m.inside && !m.locked) { lua.lua_pushinteger(S, m.x); lua.lua_pushinteger(S, m.y); } else { lua.lua_pushnil(S); lua.lua_pushnil(S); }
      lua.lua_pushinteger(S, m.b); lua.lua_pushnumber(S, m.dx); lua.lua_pushnumber(S, m.dy); lua.lua_pushnumber(S, m.wheel);
      return 6;
    },
    mbtn() { const m = input.mouse; lua.lua_pushboolean(S, !!m && !!(m.b & (1 << (num(1, 0) | 0)))); if (m) m.used = true; return 1; },
    mbtnp() { const m = input.mouse, bit = 1 << (num(1, 0) | 0); lua.lua_pushboolean(S, !!m && !!(m.b & bit) && !(m.pb & bit)); if (m) m.used = true; return 1; },
    // Maus fangen (für Ich-Perspektive): der nächste Klick ins Bild fängt sie, Esc lässt sie los
    // Systemzeiger über dem Bild aus- oder einblenden (Spiele mit eigenem Zeiger)
    mousecursor() { const m = input.mouse; if (m) { m.used = true; m.hideCursor = isNil(1) ? false : !lua.lua_toboolean(S, 1); } return 0; },
    mouselocked() { lua.lua_pushboolean(S, !!input.mouse?.locked); return 1; },
    mouselock() { const m = input.mouse; if (m) { m.used = true; m.wantLock = isNil(1) ? true : !!lua.lua_toboolean(S, 1); } return 0; },
    play() { audio.play(lauxlib.luaL_checkstring(S, 1) && lua.lua_tojsstring(S, 1), num(2, 0) | 0, bool(3), bool(4)); return 0; },
    playpos() { lua.lua_pushnumber(S, audio.playpos ? audio.playpos(num(1, 0) | 0) : -1); return 1; },
    now() { lua.lua_pushnumber(S, Math.floor(Date.now() / 1000)); return 1; },
    date() {
      const d = new Date();
      for (const v of [d.getFullYear(), d.getMonth() + 1, d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds()]) lua.lua_pushinteger(S, v);
      return 6;
    },
    stop() { audio.stop(isNil(1) ? undefined : num(1) | 0); return 0; },
    sfx() { audio.sfx(str(1), num(2, 3) | 0); return 0; },
    beep() { audio.beep(num(1, 440), num(2, 0.1), num(3, 0) | 0, num(4, 0.6), num(5, 3) | 0); return 0; },
    playing() { lua.lua_pushboolean(S, audio.playing(num(1, 0) | 0)); return 1; },
    t() { lua.lua_pushnumber(S, (performance.now() - startTime) / 1000); return 1; },
    frame() { lua.lua_pushinteger(S, frameCount); return 1; },
    store() {
      const key = str(1);
      const t = lua.lua_type(S, 2);
      const v = t === lua.LUA_TNUMBER ? lua.lua_tonumber(S, 2) : t === lua.LUA_TBOOLEAN ? lua.lua_toboolean(S, 2)
        : t === lua.LUA_TSTRING ? lua.lua_tojsstring(S, 2) : null;
      storage.set(key, v);
      return 0;
    },
    fetch() {
      const v = storage.get(str(1));
      if (typeof v === 'number') lua.lua_pushnumber(S, v);
      else if (typeof v === 'boolean') lua.lua_pushboolean(S, v);
      else if (typeof v === 'string') lua.lua_pushstring(S, to_luastring(v));
      else lua.lua_pushnil(S);
      return 1;
    },
    log() {
      const parts = [];
      for (let k = 1; k <= lua.lua_gettop(S); k++) parts.push(str(k));
      onLog(parts.join('  '));
      return 0;
    },
    // ---- Zugänglichkeit: Ansagen, Auswahl, Hinweistöne, Untertitel (wirken nur bei „-- a11y: voll“)
    say() { access?.say(str(1), isNil(2) ? 'polite' : str(2)); return 0; },
    choose() {
      const id = str(1);
      if (lua.lua_type(S, 2) !== lua.LUA_TTABLE) { access?.choose(id, null); return 0; }
      const opts = [];
      const n = lua.lua_rawlen(S, 2);
      for (let i = 1; i <= n; i++) { lua.lua_rawgeti(S, 2, i); opts.push(lua.lua_tojsstring(S, -1) ?? ''); lua.lua_pop(S, 1); }
      access?.choose(id, opts, isNil(3) ? '' : str(3), isNil(4) ? 1 : num(4) | 0);
      return 0;
    },
    cue() { access?.cue(str(1)); return 0; },
    caption() { access?.caption(str(1)); return 0; },
    a11y() {
      const s = access?.settings() || {};
      lua.lua_newtable(S);
      for (const k of ['reader', 'voice', 'contrast', 'motion', 'captions', 'leicht']) {
        lua.lua_pushboolean(S, !!s[k]);
        lua.lua_setfield(S, -2, to_luastring(k));
      }
      lua.lua_pushnumber(S, s.speed ?? 1);
      lua.lua_setfield(S, -2, to_luastring('speed'));
      lua.lua_pushboolean(S, !!access);
      lua.lua_setfield(S, -2, to_luastring('on'));
      return 1;
    },
  };

  // Nur auf dem 8BOY 16 (Kartridge mit -- system: 16)
  const superApi = {
    rspr() { gfx.rspr(spriteNo(1), num(2), num(3), num(4, 0), num(5, 1), num(6, 0), bool(7)); return 0; },
    layer() { gfx.layer(num(1, 0)); return 0; },
    tone() { audio.tone?.(num(1, 0) | 0, num(2, 0), num(3, 0.5), num(4, 4) | 0); return 0; },
    perspektive() { gfx.mode7(num(1), num(2), num(3, 0), num(4, 1), num(5, (gfx.h / 3) | 0), isNil(6) ? null : num(6), num(7, 8)); return 0; },
    // alter Name, bleibt für bestehende Kartridges
    mode7() { return superApi.perspektive(); },
    m7pos() {
      const p = gfx.m7pos(num(1), num(2));
      if (!p) { lua.lua_pushnil(S); return 1; }
      p.forEach((v) => lua.lua_pushnumber(S, v));
      return 3;
    },
    blend() {
      let m = 0;
      if (lua.lua_type(S, 1) === lua.LUA_TSTRING) {
        const k = lua.lua_tojsstring(S, 1).toLowerCase();
        if (!(k in BLEND)) lauxlib.luaL_argerror(S, 1, to_luastring('"halb", "hell", "dunkel" oder "aus"'));
        m = BLEND[k];
      } else m = num(1, 0);
      gfx.blend(m);
      return 0;
    },
    wave() { gfx.wave(num(1, 0), num(2, gfx.h), num(3, 2), num(4, 16), num(5, 0)); return 0; },
    mosaic() { gfx.mosaic(num(1, 4), num(2, 0), num(3, 0), num(4, gfx.w), num(5, gfx.h)); return 0; },
    fade() { gfx.fade(num(1, 15)); return 0; },
    backdrop() {
      if (isNil(1)) gfx.backdrop(); else gfx.backdrop(num(1), num(2), num(3) | 0, isNil(4) ? num(3) | 0 : num(4) | 0);
      return 0;
    },
  };
  if (SUPER) Object.assign(api, superApi);

  // Nur auf dem 8BOY 32 (Kartridge mit -- system: 32): der 3D-Chip
  const numbers = (i) => {
    lauxlib.luaL_checktype(S, i, lua.LUA_TTABLE);
    const out = [], n = lua.lua_rawlen(S, i);
    for (let k = 1; k <= n; k++) { lua.lua_rawgeti(S, i, k); out.push(lua.lua_tonumber(S, -1)); lua.lua_pop(S, 1); }
    return out;
  };
  const g3 = gfx.g3;
  const rgbCache = new Map();
  let rgbNext = 0;
  const megaApi = {
    model() {
      const n = num(1) | 0;
      if (lua.lua_type(S, 2) === lua.LUA_TSTRING) { const f = lua.lua_tojsstring(S, 2); g3.model(n, f, num(3, 7)); formen[n] = builtinModel(f, 7); }
      else {
        const pts = numbers(2), faces = numbers(3);
        g3.modelData(n, pts, faces, bool(4), bool(5), isNil(6) ? null : numbers(6));
        try { formen[n] = customModel(pts, faces); } catch { formen[n] = null; }
      }
      return 0;
    },
    // Modell aus einem Block der Kartridge (--[==[8boy-modell name … ]==], gebaut im Studio): gibt die Dreiecke zurück
    modelload() {
      const n = num(1) | 0, name = str(2);
      if (!modelCache) modelCache = { blocks: modelBlocks(cartCode), meshes: new Map() };
      let chip = modelCache.meshes.get(name);
      // Modell aus einem Asset-Paket (Kopfzeile -- assets: …): modelload(n, "asset:jetski")
      if (!chip && name.startsWith('asset:')) {
        const an = name.slice(6), b = assets?.bytes(an);
        if (!b) lauxlib.luaL_argerror(S, 2, to_luastring(assets?.info(an) ? `Asset "${an}" ist noch nicht geladen (asset("${an}") == "bereit"?)` : `kein Asset "${an}" in den Paketen der Kartridge`));
        // Figur mit Skelett (8BOY 128): eigene Daten je Modell-Nummer, Pose über manim
        if (istFigur(b)) {
          let fig;
          try { fig = unpackSkin(b); } catch (e) { lauxlib.luaL_error(S, to_luastring(`Asset "${an}" ist keine gültige Figur: ${e.message}`)); }
          const n = num(1) | 0, fchip = skinToChip(fig), ruhe = pose(fig, -1);
          figuren[n] = { fig, buf: new Float32Array(ruhe.length) };
          formen[n] = null;
          if (g3.modelSkin) lua.lua_pushinteger(S, g3.modelSkin(n, fchip, ruhe));
          else {
            // ohne Grafikkarte: Ruhelage als festes Modell (Höhe 1, gespiegelt wie auf der GPU)
            const N = fig.skel.N, v = new Float32Array(fchip.v.length);
            for (let k = 0; k < v.length; k += 3) { const x = fchip.v[k], y = fchip.v[k + 1], z = fchip.v[k + 2]; v[k] = N[0] * x + N[12]; v[k + 1] = N[5] * y + N[13]; v[k + 2] = N[10] * z + N[14]; }
            lua.lua_pushinteger(S, g3.modelMesh(n, { ...fchip, v, vn: null, smooth: true }));
          }
          return 1;
        }
        try { chip = meshToChip(unpackModel(b)); } catch (e) { lauxlib.luaL_error(S, to_luastring(`Asset "${an}" ist kein Modell: ${e.message}`)); }
        modelCache.meshes.set(name, chip);
        // Detailstufen aus dem Paket (assetpack "lod"): name.lod1, name.lod2 …
        const lods = [];
        for (let i = 1; i <= 3; i++) { const lb = assets?.bytes(`${an}.lod${i}`); if (!lb) break; try { lods.push(meshToChip(unpackModel(lb))); } catch { break; } }
        if (lods.length) modelCache.lods = (modelCache.lods || new Map()).set(name, lods);
      }
      if (!chip) {
        const b = modelCache.blocks.get(name);
        if (b === undefined) lauxlib.luaL_argerror(S, 2, to_luastring(`kein Modell "${name}" in der Kartridge${modelCache.blocks.size ? ` (da sind: ${[...modelCache.blocks.keys()].join(', ')})` : ''}`));
        try { chip = meshToChip(decodeModelBlock(b)); } catch (e) { lauxlib.luaL_error(S, to_luastring(`Modell "${name}" ist beschädigt: ${e.message}`)); }
        modelCache.meshes.set(name, chip);
      }
      // jedes Laden bekommt eine eigene Kopie der Flächen (mcolor & Co. verändern sie)
      lua.lua_pushinteger(S, g3.modelMesh(n, { ...chip, f: chip.f.map((f) => ({ ...f })) }));
      formen[n] = chip;
      const lods = modelCache.lods?.get(name);
      if (lods && g3.modelLods) g3.modelLods(n, lods.map((c) => ({ ...c, f: c.f.map((f) => ({ ...f })) })));
      return 1;
    },
    mtex() { g3.mtex(num(1) | 0, isNil(2) ? null : spriteNo(2), num(3, 0), num(4, 1)); return 0; },
    malpha() { g3.malpha(num(1) | 0, num(2, 1)); return 0; },
    mglow() { g3.mglow(num(1) | 0, isNil(2) ? true : bool(2)); return 0; },
    mcol() { g3.mcolor(num(1) | 0, num(2, 7)); return 0; },
    mwave() { g3.mwave(num(1) | 0, num(2, 0), num(3, 1), num(4, 0)); return 0; },
    view3d() { if (isNil(1)) g3.view3d(); else g3.view3d(num(1), num(2), num(3), num(4)); return 0; },
    cam3d() { g3.camera3d(num(1), num(2), num(3), num(4, 0), num(5, 0), num(6, 60)); return 0; },
    light3d() { g3.light3d(num(1), num(2), num(3), num(4, 0.35)); return 0; },
    fog3d() { if (isNil(1)) g3.fog3d(); else g3.fog3d(num(1), num(2), num(3, 0)); return 0; },
    cls3d() { g3.cls3d(num(1, 0), isNil(2) ? num(1, 0) : num(2)); return 0; },
    sky3d() { g3.sky3d(num(1, 0), isNil(2) ? num(1, 0) : num(2)); return 0; },
    draw3d() {
      let scale;
      if (lua.lua_type(S, 8) === lua.LUA_TTABLE) { const t = numbers(8); scale = [t[0] ?? 1, t[1] ?? 1, t[2] ?? 1]; } else scale = num(8, 1);
      g3.draw3d(num(1) | 0, num(2, 0), num(3, 0), num(4, 0), num(5, 0), num(6, 0), num(7, 0), scale);
      return 0;
    },
    pos3d() {
      const p = g3.pos3d(num(1), num(2), num(3));
      if (!p) { lua.lua_pushnil(S); return 1; }
      p.forEach((v) => lua.lua_pushnumber(S, v));
      return 3;
    },
    bill3d() { g3.bill3d(spriteNo(1), num(2), num(3), num(4), num(5, 1), num(6, 0), bool(7)); return 0; },
    line3d() { g3.line3d(num(1), num(2), num(3), num(4), num(5), num(6), num(7, 7)); return 0; },
    tris3d() { lua.lua_pushinteger(S, g3.tris3d()); return 1; },
    stick() { const [x, y] = input.stick ? input.stick(isNil(1) ? 0 : num(1) | 0, player(2)) : [0, 0]; lua.lua_pushnumber(S, x); lua.lua_pushnumber(S, y); return 2; },
    // jede Farbe direkt: rgb(r, g, b) gibt eine Farbnummer zurück (belegt dafür die Farben 160–191)
    rgb() {
      const key = ((num(1) & 255) << 16) | ((num(2) & 255) << 8) | (num(3) & 255);
      let i = rgbCache.get(key);
      if (i === undefined) {
        i = 160 + (rgbNext++ % 32);
        for (const [k, v] of rgbCache) if (v === i) rgbCache.delete(k);
        rgbCache.set(key, i);
        gfx.setPalette(i, key >> 16 & 255, key >> 8 & 255, key & 255);
      }
      lua.lua_pushinteger(S, i);
      return 1;
    },
  };
  if (machine.id >= 32) Object.assign(api, megaApi);

  // Nur auf dem 8BOY 64 (-- system: 64): was der Grafikchip auf der Grafikkarte zusätzlich kann
  const ultraApi = {
    lamp3d() {
      if (isNil(2)) g3.lamp3d(num(1) | 0);
      else g3.lamp3d(num(1) | 0, num(2), num(3), num(4), isNil(5) ? 0xffffff : num(5) | 0, num(6, 5));
      return 0;
    },
    filter3d() { g3.filter3d(isNil(1) ? 'pixel' : str(1)); return 0; },
    debug3d() { g3.debug3d(isNil(1) ? null : str(1)); return 0; },
    retro3d() { g3.retro3d(isNil(1) ? true : bool(1)); return 0; },
    stats3d() {
      const st = g3.stats3d();
      lua.lua_pushinteger(S, st.calls); lua.lua_pushinteger(S, st.tris); lua.lua_pushboolean(S, !!st.limit); lua.lua_pushinteger(S, st.parts || 0);
      lua.lua_pushinteger(S, st.weg || 0); lua.lua_pushinteger(S, st.fern || 0);
      return 6;
    },
    gpu() { lua.lua_pushboolean(S, !!g3.gpu); return 1; },
    // Stufe 2: Effekte (js/gpufx.js). Ohne Grafikkarte verstanden, aber ohne Wirkung (Instanzlisten zeichnet der Ersatz-Chip einzeln).
    memit() { g3.memit(num(1) | 0, num(2, 1)); return 0; },
    mshine() { g3.mshine(num(1) | 0, num(2, 1), num(3, 32)); return 0; },
    madd() { g3.madd(num(1) | 0, isNil(2) ? true : bool(2)); return 0; },
    mshadow() { g3.mshadow(num(1) | 0, isNil(2) ? true : bool(2)); return 0; },
    mwater() { g3.mwater(num(1) | 0, isNil(2) ? true : bool(2), num(3, 1), num(4, 0.7), num(5, 1)); return 0; },
    post3d() {
      const opt = (i) => (isNil(i) ? undefined : num(i));
      if (isNil(1)) { g3.post3d(); return 0; }
      const art = str(1);
      if (art !== 'aus' && !FX_POST.includes(art)) lauxlib.luaL_argerror(S, 1, to_luastring(`unbekannter Effekt "${art}" – ${FX_POST.join(', ')} oder "aus"`));
      g3.post3d(art, opt(2), opt(3), opt(4));
      return 0;
    },
    part3d() {
      const o = isNil(2) ? null : readValue(2);
      if (o && typeof o.form === 'string' && !FX_FORMS.includes(o.form)) lauxlib.luaL_argerror(S, 2, to_luastring(`form = ${FX_FORMS.map((f) => '"' + f + '"').join(', ')}`));
      g3.part3d(num(1) | 0, o && typeof o === 'object' && !Array.isArray(o) ? o : o === null ? null : {});
      return 0;
    },
    emit3d() { g3.emit3d(num(1) | 0, num(2), num(3), num(4), num(5, 1), num(6, 0), num(7, 0), num(8, 0)); return 0; },
    parts3d() { g3.parts3d(); return 0; },
    inst3d() { lua.lua_pushinteger(S, g3.inst3d(num(1) | 0, isNil(2) ? null : numbers(2))); return 1; },
    drawi3d() { g3.drawi3d(num(1) | 0, num(2) | 0, num(3, 0), num(4, 0), num(5, 0)); return 0; },
    shadow3d() { g3.shadow3d(isNil(1) ? true : bool(1), num(2, 30), num(3, 0.65)); return 0; },
    sun3d() { if (isNil(1)) g3.sun3d(); else g3.sun3d(num(1) | 0, num(2, 1), num(3, 1)); return 0; },
    hfog3d() { if (isNil(1)) g3.hfog3d(); else g3.hfog3d(num(1), num(2, 0.05), isNil(3) ? 0xc0c8d0 : num(3) | 0, num(4, 0.6)); return 0; },
    caustic3d() { if (isNil(1)) g3.caustic3d(); else g3.caustic3d(num(1), num(2, 1)); return 0; },
    fx3d() { lua.lua_pushinteger(S, g3.fx3d(isNil(1) ? undefined : num(1) | 0)); return 1; },
  };
  if (machine.id >= 64 || machine.gpu) Object.assign(api, ultraApi);   // auch 8BOY-32-Kartridges im 64er-Modus
  // UI-Ebene (ab 8BOY 64): scharfe, stufenlose Schrift und Kästen über dem Bild, in Bildschirm-Koordinaten (js/ui-ebene.js)
  const uiFlags = (i) => (isNil(i) ? '' : str(i));
  const uiNum = (i) => (isNil(i) ? undefined : num(i));
  if (machine.id >= 64) Object.assign(api, {
    ui_text() {
      const s = isNil(1) ? '' : str(1), gr = num(5, 9), fl = uiFlags(6);
      gfx.ui.add(['t', s, num(2), num(3), num(4, 7) | 0, gr, fl, isNil(7) ? null : num(7) | 0]);
      lua.lua_pushnumber(S, uiTextW(s, gr, fl));
      return 1;
    },
    ui_textw() { lua.lua_pushnumber(S, uiTextW(isNil(1) ? '' : str(1), num(2, 9), uiFlags(3))); return 1; },
    ui_wrap() {
      const z = uiWrap(isNil(1) ? '' : str(1), num(2, 100), num(3, 9), uiFlags(4));
      lua.lua_createtable(S, z.length, 0);
      z.forEach((t, i) => { lua.lua_pushstring(S, to_luastring(t)); lua.lua_rawseti(S, -2, i + 1); });
      return 1;
    },
    ui_rect() { gfx.ui.add(['r', num(1), num(2), num(3), num(4), num(5, 7) | 0, num(6, 0), uiNum(7)]); return 0; },
    ui_rahmen() { gfx.ui.add(['o', num(1), num(2), num(3), num(4), num(5, 7) | 0, num(6, 0), num(7, 1)]); return 0; },
    ui_linie() { gfx.ui.add(['l', num(1), num(2), num(3), num(4), num(5, 7) | 0, num(6, 1)]); return 0; },
    ui_kreis() { gfx.ui.add(['k', num(1), num(2), num(3), num(4, 7) | 0, num(5, 0)]); return 0; },
    ui_spr() { gfx.ui.add(['s', spriteNo(1), num(2), num(3), num(4, 1), bool(5), num(6, 0) | 0]); return 0; },
    ui_clip() { gfx.ui.add(isNil(1) ? ['c'] : ['c', num(1), num(2), num(3), num(4)]); return 0; },
    ui_alpha() { gfx.ui.add(['a', num(1, 1)]); return 0; },
  });
  // 8BOY 128: Figuren abspielen – manim(n, clip, zeit [, clip2, zeit2, mischung]); clip = Name oder Nummer (ab 1)
  const clipNr = (F, i) => {
    if (lua.lua_type(S, i) === lua.LUA_TNUMBER) return (num(i) | 0) - 1;
    if (isNil(i)) return -1;
    const s = str(i), k = F.fig.clips.findIndex((c) => c.name.toLowerCase() === s.toLowerCase());
    if (k < 0) lauxlib.luaL_argerror(S, i, to_luastring(`keine Animation "${s}" (da sind: ${F.fig.clips.map((c) => c.name).join(', ')})`));
    return k;
  };
  const figur = (i) => {
    const F = figuren[num(i) | 0];
    if (!F) lauxlib.luaL_argerror(S, i, to_luastring('dieses Modell ist keine Figur (modelload mit einem Figuren-Asset)'));
    return F;
  };
  if (machine.id >= 128) Object.assign(api, {
    manim() {
      const F = figur(1), a = clipNr(F, 2), ta = num(3, 0);
      const b = isNil(4) ? -1 : clipNr(F, 4), tb = num(5, 0), mix = Math.max(0, Math.min(1, num(6, 0)));
      pose(F.fig, a, ta, b, tb, mix, F.buf);
      if (g3.mpose) g3.mpose(num(1) | 0, F.buf);
      return 0;
    },
    animlen() { const F = figur(1), c = F.fig.clips[clipNr(F, 2)]; lua.lua_pushnumber(S, c ? c.dauer : 0); return 1; },
    anims() {
      const F = figur(1);
      lua.lua_createtable(S, F.fig.clips.length, 0);
      F.fig.clips.forEach((c, i) => { lua.lua_pushstring(S, to_luastring(c.name)); lua.lua_rawseti(S, -2, i + 1); });
      return 1;
    },
    mbone() {
      const F = figur(1), name = str(2), j = F.fig.skel.namen.indexOf(name);
      if (j < 0) lauxlib.luaL_argerror(S, 2, to_luastring(`kein Knochen "${name}" (da sind: ${F.fig.skel.namen.join(', ')})`));
      const p = knochenPos(F.fig, F.buf.some((v) => v !== 0) ? F.buf : pose(F.fig, -1), j);
      lua.lua_pushnumber(S, p[0]); lua.lua_pushnumber(S, p[1]); lua.lua_pushnumber(S, p[2]);
      return 3;
    },
  });
  // 8BOY 128: echte Texturen aus Asset-Paketen und Materialien (ohne Grafikkarte verstanden, aber ohne Wirkung)
  if (machine.id >= 128) Object.assign(api, {
    texload() {
      const k = num(1) | 0, name = str(2);
      if (k < 0 || k > 63) lauxlib.luaL_argerror(S, 1, to_luastring('Textur-Platz 0–63'));
      const an = name.startsWith('asset:') ? name.slice(6) : name, b = assets?.bytes(an);
      if (!b) lauxlib.luaL_argerror(S, 2, to_luastring(assets?.info(an) ? `Asset "${an}" ist noch nicht geladen` : `kein Asset "${an}" in den Paketen der Kartridge`));
      if (g3.texload) g3.texload(k, b).catch((e) => onLog(`Textur ${k}: ${e.message}`));
      return 0;
    },
    texstate() { lua.lua_pushstring(S, to_luastring(g3.texstate ? g3.texstate(num(1) | 0) : 'leer')); return 1; },
    // Große Welten: Detailstufen, Kollisionswelt aus Dreiecken, Fahrzeuge (js/physik.js – rechnet auch ohne Grafikkarte)
    mlod() { if (g3.mlod) { const d = []; for (let i = 2; i <= 4 && !isNil(i); i++) d.push(num(i)); g3.mlod(num(1) | 0, ...d); } return 0; },
    coll3d() {
      if (isNil(1)) { welt.clear(); lua.lua_pushinteger(S, 0); return 1; }
      const n = num(1) | 0, f = formen[n];
      if (!f) lauxlib.luaL_argerror(S, 1, to_luastring(`Modell ${n} hat keine Form für die Kollision (model, modelload)`));
      const sk = lua.lua_type(S, 8) === lua.LUA_TTABLE ? numbers(8) : num(8, 1);   // Größe oder {x, y, z}
      welt.add(f, num(2, 0), num(3, 0), num(4, 0), num(5, 0), num(6, 0), num(7, 0), Array.isArray(sk) ? [sk[0] ?? 1, sk[1] ?? 1, sk[2] ?? 1] : sk);
      lua.lua_pushinteger(S, welt.dreiecke);
      return 1;
    },
    ray3d() {
      const h = welt.ray(num(1), num(2), num(3), num(4), num(5), num(6), num(7, 100));
      if (!h) { lua.lua_pushnil(S); return 1; }
      lua.lua_pushnumber(S, h.t); lua.lua_pushnumber(S, h.nx); lua.lua_pushnumber(S, h.ny); lua.lua_pushnumber(S, h.nz);
      return 4;
    },
    ground3d() {
      const h = welt.ground(num(1), num(2), num(3, 1000));
      if (!h) { lua.lua_pushnil(S); return 1; }
      lua.lua_pushnumber(S, h.y); lua.lua_pushnumber(S, h.nx); lua.lua_pushnumber(S, h.ny); lua.lua_pushnumber(S, h.nz);
      return 4;
    },
    push3d() {
      const r = welt.push(num(1), num(2), num(3), num(4, 0.5));
      lua.lua_pushnumber(S, r.x); lua.lua_pushnumber(S, r.y); lua.lua_pushnumber(S, r.z); lua.lua_pushboolean(S, r.boden);
      return 4;
    },
    auto3d() {
      const k = num(1) | 0;
      if (k < 0 || k >= MAX_AUTOS) lauxlib.luaL_argerror(S, 1, to_luastring(`Fahrzeug 0–${MAX_AUTOS - 1}`));
      const o = isNil(6) ? {} : readValue(6);
      autos[k] = createAuto(welt, num(2, 0), num(3, 0), num(4, 0), num(5, 0), o && typeof o === 'object' && !Array.isArray(o) ? o : {});
      return 0;
    },
    fahr3d() {
      const a = autos[num(1) | 0];
      if (!a) lauxlib.luaL_argerror(S, 1, to_luastring('kein Fahrzeug (erst auto3d)'));
      a.schritt(num(2, 0), num(3, 0), num(4, 0));
      for (const v of [a.x, a.y, a.z, a.yaw, a.pitch, a.roll, a.tempo]) lua.lua_pushnumber(S, v);
      lua.lua_pushinteger(S, a.boden);
      return 8;
    },
    rad3d() {
      const a = autos[num(1) | 0], r = a?.raeder[(num(2, 1) | 0) - 1];
      if (!r) { lua.lua_pushnil(S); return 1; }
      for (const v of [r.x, r.y, r.z, r.dreh, r.einschlag, r.druck]) lua.lua_pushnumber(S, v);
      return 6;
    },
    // Licht und Tiefe: Umgebungsverdeckung (an), Panorama für Spiegelungen und Himmel
    ao3d() { if (g3.ao3d) g3.ao3d(num(1, 0.8), num(2, 0.7)); return 0; },
    env3d() { if (g3.env3d) { if (isNil(1)) g3.env3d(); else g3.env3d(num(1) | 0, num(2, 1), !isNil(3) && bool(3)); } return 0; },
    mmat() {
      const o = isNil(2) ? {} : readValue(2);
      if (g3.mmat) g3.mmat(num(1) | 0, o && typeof o === 'object' && !Array.isArray(o) ? o : {});
      return 0;
    },
  });
  // Asset-Pakete (ab 8BOY 64; Hauptkonsole dafür ist der 8BOY 128): Zustand, Nachladen, Fortschritt
  if (machine.id >= 64) Object.assign(api, {
    asset() { lua.lua_pushstring(S, to_luastring(assets ? assets.status(str(1)) : 'fehlt')); return 1; },
    assetload() {
      const n = str(1);
      if (!assets?.info(n)) { lua.lua_pushboolean(S, false); return 1; }
      assets.laden(n).catch((e) => onLog(`Asset "${n}": ${e.message}`));
      lua.lua_pushboolean(S, true);
      return 1;
    },
    assetinfo() {
      const f = assets ? assets.fortschritt() : { geladen: 0, gesamt: 0 };
      lua.lua_pushinteger(S, f.geladen); lua.lua_pushinteger(S, f.gesamt);
      return 2;
    },
  });
  for (const [name, fn] of Object.entries(api)) {
    lua.lua_pushjsfunction(L, (Lx) => { S = Lx; return fn(); });
    lua.lua_setglobal(L, to_luastring(name));
  }

  // ---------------------------------------------------------------- Mehrspieler: net.*
  // Lua-Tabellen <-> JSON (nur Zahlen, Text, Wahrheitswerte, verschachtelt bis Tiefe 4)
  function pushValue(v, depth = 0) {
    if (v === null || v === undefined || depth > 4) lua.lua_pushnil(S);
    else if (typeof v === 'number') lua.lua_pushnumber(S, v);
    else if (typeof v === 'boolean') lua.lua_pushboolean(S, v);
    else if (typeof v === 'string') lua.lua_pushstring(S, to_luastring(v));
    else if (Array.isArray(v)) { lua.lua_createtable(S, v.length, 0); v.forEach((x, i) => { pushValue(x, depth + 1); lua.lua_rawseti(S, -2, i + 1); }); }
    else if (typeof v === 'object') { lua.lua_newtable(S); for (const [k, x] of Object.entries(v)) { pushValue(x, depth + 1); lua.lua_setfield(S, -2, to_luastring(k)); } }
    else lua.lua_pushnil(S);
  }
  function readValue(i, depth = 0) {
    const t = lua.lua_type(S, i);
    if (t === lua.LUA_TNUMBER) return lua.lua_tonumber(S, i);
    if (t === lua.LUA_TBOOLEAN) return lua.lua_toboolean(S, i);
    if (t === lua.LUA_TSTRING) return lua.lua_tojsstring(S, i);
    if (t !== lua.LUA_TTABLE || depth > 4) return null;
    i = lua.lua_absindex(S, i);
    const n = lua.lua_rawlen(S, i);
    if (n > 0) { const a = []; for (let k = 1; k <= Math.min(n, 64); k++) { lua.lua_rawgeti(S, i, k); a.push(readValue(-1, depth + 1)); lua.lua_pop(S, 1); } return a; }
    const o = {};
    lua.lua_pushnil(S);
    let count = 0;
    while (lua.lua_next(S, i) !== 0) {
      if (lua.lua_type(S, -2) === lua.LUA_TSTRING && count++ < 32) o[lua.lua_tojsstring(S, -2)] = readValue(-1, depth + 1);
      lua.lua_pop(S, 1);
    }
    return o;
  }
  const off = { status: 'aus', error: '', me: 0, lobby: null };
  const N = net || off;
  const netApi = {
    join() {
      if (!net) return 0;
      const modes = isNil(4) ? [{ id: 'ffa', name: 'Jeder gegen Jeden', min: 2 }] : readValue(4);
      net.join(str(1), isNil(2) ? 'Spieler' : str(2), num(3, 0) | 0, Array.isArray(modes) ? modes : [], num(5, 180), num(6, 16) | 0);
      return 0;
    },
    leave() { if (net) net.leave(); return 0; },
    status() { lua.lua_pushstring(S, to_luastring(N.status)); return 1; },
    error() { lua.lua_pushstring(S, to_luastring(N.error || '')); return 1; },
    me() { lua.lua_pushinteger(S, N.me || 0); return 1; },
    lobby() { pushValue(N.lobby); return 1; },
    players() {
      const list = (N.lobby?.players || []).map((p) => ({ ...p, me: p.id === N.me }));
      pushValue(list); return 1;
    },
    send() { if (net) net.send(readValue(1)); return 0; },
    event() { if (net) net.event(readValue(1), isNil(2) ? undefined : num(2) | 0); return 0; },
    state() { pushValue(net ? net.state(num(1) | 0) : null); return 1; },
    events() { pushValue(net ? net.events() : []); return 1; },
    vote() { if (net) net.vote(str(1)); return 0; },
    hit() { if (net) net.hit(num(1) | 0, isNil(2) ? undefined : num(2) | 0); return 0; },
    cap() { if (net) net.cap(isNil(1) ? undefined : num(1) | 0); return 0; },
    host() { lua.lua_pushboolean(S, !!net?.host); return 1; },
    fill() { if (net) net.fill(num(1, 0) | 0); return 0; },
    finish() { if (net) net.finish(); return 0; },
    sendbots() { if (net) { const v = readValue(1); net.sendBots(Array.isArray(v) ? v : []); } return 0; },
    set() { if (net) net.set(str(1), readValue(2)); return 0; },
    setmany() { if (net) { const v = readValue(1); if (v && typeof v === 'object' && !Array.isArray(v)) net.setMany(v); } return 0; },
    claim() { if (net) net.claim(str(1), isNil(2) ? true : readValue(2)); return 0; },
    get() {
      const w = net ? net.get(str(1)) : null;
      if (!w) { lua.lua_pushnil(S); return 1; }
      pushValue(w.v); lua.lua_pushinteger(S, w.by); return 2;
    },
    ping() { lua.lua_pushinteger(S, net ? net.ping() : -1); return 1; },
  };
  lua.lua_newtable(L);
  for (const [name, fn] of Object.entries(netApi)) {
    lua.lua_pushjsfunction(L, (Lx) => { S = Lx; return fn(); });
    lua.lua_setfield(L, -2, to_luastring(name));
  }
  lua.lua_setglobal(L, to_luastring('net'));

  const traceback = (Lx) => {
    S = Lx;
    const msg = str(1);
    lauxlib.luaL_traceback(Lx, Lx, to_luastring(msg), 1);
    return 1;
  };

  // Ruft die Funktion oben auf dem Stapel geschützt auf
  function protectedCall(nargs) {
    const base = lua.lua_gettop(L) - nargs;
    lua.lua_pushjsfunction(L, traceback);
    lua.lua_insert(L, base);
    callStart = performance.now();
    const status = lua.lua_pcall(L, nargs, 0, base);
    lua.lua_remove(L, base);
    if (status !== lua.LUA_OK) {
      const msg = lua.lua_tojsstring(L, -1) ?? 'Unbekannter Fehler';
      lua.lua_pop(L, 1);
      throw new CartError(msg);
    }
  }

  function run(code, name = 'cart') {
    cartCode = code;
    modelCache = null;
    code = stripModelBlocks(code);   // Lua sieht die großen Modell-Blöcke nicht (gleiche Zeilenzahl)
    if (lauxlib.luaL_loadbuffer(L, to_luastring(PRELUDE), null, to_luastring('=prelude')) !== lua.LUA_OK) {
      throw new CartError(lua.lua_tojsstring(L, -1));
    }
    protectedCall(0);
    lua.lua_getglobal(L, to_luastring('math'));
    lua.lua_getfield(L, -1, to_luastring('randomseed'));
    lua.lua_pushinteger(L, Math.floor(Math.random() * 2 ** 31));
    protectedCall(1);
    lua.lua_pop(L, 1);
    if (lauxlib.luaL_loadbuffer(L, to_luastring(code), null, to_luastring('=' + name)) !== lua.LUA_OK) {
      const msg = lua.lua_tojsstring(L, -1);
      lua.lua_pop(L, 1);
      throw new CartError(msg);
    }
    protectedCall(0);
    callGlobal('_init');
  }

  function callGlobal(name) {
    lua.lua_getglobal(L, to_luastring(name));
    if (lua.lua_type(L, -1) !== lua.LUA_TFUNCTION) { lua.lua_pop(L, 1); return false; }
    protectedCall(0);
    return true;
  }

  // _describe() → Text; _choice(id, nr) bei einer Auswahl über die HTML-Ebene
  function describe() {
    lua.lua_getglobal(L, to_luastring('_describe'));
    if (lua.lua_type(L, -1) !== lua.LUA_TFUNCTION) { lua.lua_pop(L, 1); return ''; }
    const base = lua.lua_gettop(L) - 1;
    lua.lua_pushjsfunction(L, traceback);
    lua.lua_insert(L, base + 1);
    callStart = performance.now();
    const status = lua.lua_pcall(L, 0, 1, base + 1);
    const out = status === lua.LUA_OK ? (lua.lua_tojsstring(L, -1) ?? '') : '';
    lua.lua_settop(L, base);
    if (status !== lua.LUA_OK) onLog('_describe: Fehler');
    return out;
  }
  function choice(id, nr) {
    lua.lua_getglobal(L, to_luastring('_choice'));
    if (lua.lua_type(L, -1) !== lua.LUA_TFUNCTION) { lua.lua_pop(L, 1); return false; }
    lua.lua_pushstring(L, to_luastring(String(id)));
    lua.lua_pushinteger(L, nr | 0);
    protectedCall(2);
    return true;
  }
  const update = () => { frameCount++; return callGlobal('_update'); };
  const draw = () => { gfx.ui.beginFrame(); const r = callGlobal('_draw'); gfx.ui.endFrame(); return r; };

  // Fehlersuche fürs Studio: wird erst beim ersten Gebrauch angelegt
  let debugEngine = null;
  function debug() {
    if (!debugEngine) {
      debugEngine = createDebugEngine({
        fengari, L, CartError, timeHook, protectedCall, update, draw,
        apiNames: Object.keys(api), netNames: Object.keys(netApi),
        getCode: () => cartCode,
        beginFrame: () => { frameCount++; },
        frameNo: () => frameCount,
        resetClock: () => { callStart = performance.now(); },
        shiftTime: (ms) => { startTime += ms; },
      });
    }
    return debugEngine;
  }

  return {
    run,
    update,
    draw,
    describe,
    choice,
    debug,
    get debugger() { return debugEngine; },
    close() { lua.lua_close(L); },
  };
}
