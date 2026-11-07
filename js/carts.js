// Kartridges: eine Kartridge ist eine Lua-Datei mit Kopfzeilen-Kommentaren.
//
//   -- title: Schlange
//   -- author: 8BOY
//   -- desc: Friss Äpfel, werde lang.
//   -- color: 11            (Farbe des Etiketts, 0-31)
//   -- kind: game           (game | tutorial)
//   -- system: 16           (für den 8BOY 16, 32 für den 8BOY 32, 64 für den 8BOY 64; ohne Angabe 8BOY)
//   -- icon:                (optional: 8x8 bis 16x16 Pixel fürs Etikett)
//   -- ..3333..
//   -- cover: 4 A@2.5       (Titelbild für die Packung: nach 4 s fotografieren, vorher A drücken)
//   -- a11y: voll           (Kartridge ist für Zugänglichkeit gebaut: say/choose/_describe, siehe js/a11y.js)
//   -- ultra: ja            (8BOY-32-Kartridge: auf dem 8BOY 64 rechnet die Grafikkarte; gpu() ist wahr, Effekt-Befehle gehen)
//
// Dazu optional ein Anleitungsheft als Lua-Kommentar:  --[[anleitung  # Überschrift … ]]
import { DEFAULT_PALETTE, parsePixelRows, TRANSPARENT } from './gfx.js';

const USER_KEY = '8boy:carts';

export function parseCart(code, fallback = {}) {
  const meta = { title: fallback.title || 'Unbenannt', author: '', desc: '', color: 12, kind: 'game', icon: null, highlight: false, license: '', system: 8 };
  const lines = String(code).split(/\r?\n/);
  for (let i = 0; i < Math.min(lines.length, 60); i++) {
    const m = /^--\s*(title|author|desc|color|kind|icon|highlight|license|cover|system|a11y|ultra|assets)\s*:\s*(.*)$/i.exec(lines[i].trim());
    if (!m) continue;
    const key = m[1].toLowerCase(), val = m[2].trim();
    if (key === 'icon') {
      const rows = [];
      for (let j = i + 1; j < lines.length; j++) {
        const r = /^--\s*([.0-9a-v]{4,16})\s*$/i.exec(lines[j].trim());
        if (!r) break;
        rows.push(r[1].toLowerCase());
      }
      if (rows.length) meta.icon = rows.join('\n');
    } else if (key === 'color') meta.color = (parseInt(val, 10) || 0) & 31;
    else if (key === 'highlight') meta.highlight = /^(true|ja|1)$/i.test(val);
    // 8BOY-32-Kartridge mit 64er-Fassung: auf dem 8BOY 64 rechnet die Grafikkarte, mit Effekten (js/system.js)
    else if (key === 'ultra') meta.ultra = /^(true|ja|1)$/i.test(val);
    else if (key === 'cover') meta.coverShot = val;
    // Asset-Pakete (8BOY 128): -- assets: giga-demo, giga-basis
    else if (key === 'assets') meta.assets = val.split(/[,\s]+/).map((s) => s.trim().toLowerCase()).filter((s) => /^[a-z0-9][a-z0-9-]{0,47}$/.test(s));
    else if (key === 'system') { const n = parseInt(val, 10); meta.system = n >= 128 ? 128 : n >= 64 ? 64 : n >= 32 ? 32 : n >= 16 ? 16 : 8; }
    else meta[key] = val;
  }
  return { ...fallback, ...meta, code: String(code) };
}

export function iconDataURL(iconRows, scale = 4) {
  if (!iconRows || typeof document === 'undefined') return null;
  const { w, h, data } = parsePixelRows(iconRows);
  const c = document.createElement('canvas');
  c.width = w * scale; c.height = h * scale;
  const g = c.getContext('2d');
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const v = data[y * w + x];
    if (v === TRANSPARENT) continue;
    g.fillStyle = '#' + DEFAULT_PALETTE[v].toString(16).padStart(6, '0');
    g.fillRect(x * scale, y * scale, scale, scale);
  }
  return c.toDataURL();
}

export const colorHex = (i) => '#' + DEFAULT_PALETTE[i & 31].toString(16).padStart(6, '0');

// Grundregal (index.json) plus die Spiele, die man sich aus dem Store geholt hat (gleiche IDs wie früher,
// damit Spielstände und „schon ausgepackt“ erhalten bleiben)
export async function loadBuiltinCarts(base = 'carts/', extra = []) {
  const list = await (await fetch(base + 'index.json')).json();
  const files = [...list, ...extra.filter((f) => !list.includes(f))];
  const all = await Promise.all(files.map(async (file) => {
    try {
      const res = await fetch(QUELLE.get(file) || base + file);
      if (!res.ok) return null;
      return parseCart(await res.text(), { id: 'b:' + file, file, builtin: true, store: !list.includes(file) });
    } catch { return null; }   // offline und noch nie geladen
  }));
  return all.filter(Boolean);
}

// Store: Katalog und die Auswahl im Regal
const STORE_KEY = '8boy:store';
// Kartridges aus externen Katalogen: Dateiname → Adresse der Kartridge bzw. ihres Titelbilds
const QUELLE = new Map(), QUELLE_COVER = new Map();
export const coverUrl = (file) => QUELLE_COVER.get(file) || 'covers/' + file.replace(/\.lua$/, '.png');
export const cartUrl = (file) => QUELLE.get(file) || 'carts/' + file;

// Eigener Katalog (carts/store.json) plus externe Kataloge aus config.js (EIGHTBOY_CONFIG.katalogUrl, eine Adresse
// oder eine Liste). Ein externer Katalog hat dasselbe Format wie store.json; "file" und "cover" sind relativ zur
// Adresse des Katalogs (oder absolut). Der Server des Katalogs muss CORS erlauben. Siehe docs/KARTRIDGES-EINBINDEN.md.
export async function loadStoreCatalog(base = 'carts/', cfg = globalThis.EIGHTBOY_CONFIG) {
  let own = [];
  try { own = await (await fetch(base + 'store.json')).json(); } catch { /* ohne eigenen Katalog */ }
  const urls = [cfg?.katalogUrl].flat().filter(Boolean);
  const fremd = await Promise.all(urls.map(async (u) => {
    try {
      const abs = new URL(u, location.href);
      const list = await (await fetch(abs)).json();
      return (Array.isArray(list) ? list : list.carts || []).filter((e) => e && /^[\w.\/-]+\.lua$/.test(String(e.file).split('?')[0].split('#')[0].split('/').pop())).map((e) => {
        const file = String(e.file).split('/').pop();
        QUELLE.set(file, new URL(e.file, abs).href);
        QUELLE_COVER.set(file, new URL(e.cover || 'covers/' + file.replace(/\.lua$/, '.png'), abs).href);
        return { ...e, file, extern: abs.origin };
      });
    } catch { return []; }   // Katalog nicht erreichbar: nur die mitgelieferten Kartridges
  }));
  const seen = new Set(own.map((e) => e.file));
  return [...own, ...fremd.flat().filter((e) => !seen.has(e.file) && seen.add(e.file))];
}
export function storeChoice() {
  try { const v = JSON.parse(localStorage.getItem(STORE_KEY)); return Array.isArray(v) ? v : null; } catch { return null; }
}
export function setStoreChoice(files) {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(files)); } catch { /* privat */ }
}

export function loadUserCarts() {
  try {
    const raw = JSON.parse(localStorage.getItem(USER_KEY) || '[]');
    return raw.map((c) => parseCart(c.code, { id: c.id, file: c.file, builtin: false, kind: 'user', cover: c.cover || null }));
  } catch { return []; }
}

// false = Browser-Speicher voll (oder gesperrt): nichts wurde verändert, der Aufrufer sagt es dem Spieler
export const SPEICHER_VOLL = 'Kein Platz mehr im Browser-Speicher. Nimm Spiele aus dem Regal oder lösche alte Spielstände (💾 Spielstände) – vorher gern sichern.';
export function saveUserCart(cart) {
  const all = loadUserCarts().filter((c) => c.id !== cart.id);
  all.push(cart);
  try {
    localStorage.setItem(USER_KEY, JSON.stringify(all.map(({ id, file, code, cover }) => ({ id, file, code, cover }))));
    return true;
  } catch { return false; }
}

export function deleteUserCart(id) {
  const all = loadUserCarts().filter((c) => c.id !== id);
  localStorage.setItem(USER_KEY, JSON.stringify(all.map(({ id: i, file, code, cover }) => ({ id: i, file, code, cover }))));
}

export const newCartId = () => 'u:' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

export function fileNameFor(cart) {
  const base = (cart.title || 'kartridge').toLowerCase().replace(/[äöüß]/g, (c) => ({ ä: 'ae', ö: 'oe', ü: 'ue', ß: 'ss' }[c]))
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'kartridge';
  return base + '.8b.lua';
}

// Spielstände je Kartridge (store/fetch in Lua)
export function cartStorage(cartId) {
  const prefix = '8boy:save:' + cartId + ':';
  return {
    get(k) { try { const v = localStorage.getItem(prefix + k); return v === null ? null : JSON.parse(v); } catch { return null; } },
    set(k, v) {
      try {
        if (v === null) localStorage.removeItem(prefix + k); else localStorage.setItem(prefix + k, JSON.stringify(v));
        localStorage.setItem(SAVE_TIME + cartId, String(Date.now()));
      } catch { /* voll */ }
    },
  };
}

// Spielstände verwalten – alles bleibt im Browser (localStorage), Sichern/Laden über eine Datei, also auch offline.
//   saveIds() → alle Kartridge-IDs mit Spielstand;  cartSaves(id) → { schlüssel: roher JSON-Text }
const SAVE_PREFIX = '8boy:save:', SAVE_TIME = '8boy:savezeit:';
const lsKeys = () => { try { return Object.keys(localStorage); } catch { return []; } };
export function saveIds() {
  const ids = new Set();
  for (const k of lsKeys()) if (k.startsWith(SAVE_PREFIX)) ids.add(k.slice(SAVE_PREFIX.length, k.lastIndexOf(':')));
  return [...ids];
}
export function cartSaves(cartId) {
  const p = SAVE_PREFIX + cartId + ':', out = {};
  for (const k of lsKeys()) if (k.startsWith(p)) out[k.slice(p.length)] = localStorage.getItem(k);
  return out;
}
export const hasSaves = (cartId) => lsKeys().some((k) => k.startsWith(SAVE_PREFIX + cartId + ':'));
export function saveInfo(cartId) {
  const s = cartSaves(cartId);
  const t = +localStorage.getItem(SAVE_TIME + cartId) || 0;
  return { n: Object.keys(s).length, bytes: Object.entries(s).reduce((n, [k, v]) => n + k.length + (v || '').length, 0), zeit: t };
}
export function putSaves(cartId, saves, zeit = Date.now()) {
  try {
    for (const [k, v] of Object.entries(saves || {})) if (typeof v === 'string') localStorage.setItem(SAVE_PREFIX + cartId + ':' + k, v);
    localStorage.setItem(SAVE_TIME + cartId, String(zeit || Date.now()));
    return true;
  } catch { return false; }   // Speicher voll
}
export function deleteSaves(cartId) {
  try {
    for (const k of lsKeys()) if (k.startsWith(SAVE_PREFIX + cartId + ':')) localStorage.removeItem(k);
    localStorage.removeItem(SAVE_TIME + cartId);
  } catch { /* privat */ }
}

// Sicherung als Datei: Store-Auswahl, Ausgepacktes, eigene Kartridges und Spielstände (ohne Einstellungen)
export function makeBackup() {
  const saves = {};
  for (const id of saveIds()) saves[id] = { zeit: +localStorage.getItem(SAVE_TIME + id) || 0, daten: cartSaves(id) };
  let store = null, user = [];
  try { store = JSON.parse(localStorage.getItem(STORE_KEY)); } catch { /* leer */ }
  try { user = JSON.parse(localStorage.getItem(USER_KEY) || '[]'); } catch { /* leer */ }
  return { app: '8boy', typ: 'sicherung', version: 1, datum: new Date().toISOString(), store, ausgepackt: [...unpacked], kartridges: user, spielstaende: saves };
}
export const isBackup = (o) => !!o && o.app === '8boy' && o.typ === 'sicherung';
// Zurückspielen ergänzt nur: nichts im Regal wird gelöscht; Spielstände aus der Sicherung ersetzen gleichnamige.
export function restoreBackup(o, only = null) {
  const r = { kartridges: 0, spielstaende: 0, store: 0, voll: false };
  const idMap = {};   // dieselbe eigene Kartridge liegt schon unter anderer ID im Regal → Spielstand dorthin
  for (const c of Array.isArray(o.kartridges) ? o.kartridges : []) {
    const h = c && loadUserCarts().find((x) => x.code === c.code && x.id !== c.id);
    if (h) idMap[c.id] = h.id;
  }
  if (!only) {
    if (Array.isArray(o.store)) {
      const cur = storeChoice() || [];
      const neu = o.store.filter((f) => typeof f === 'string' && !cur.includes(f));
      r.store = neu.length;
      setStoreChoice([...cur, ...neu]);
    }
    const have = loadUserCarts();
    const add = (Array.isArray(o.kartridges) ? o.kartridges : []).filter((c) => c && typeof c.code === 'string' && typeof c.id === 'string' &&
      !have.some((h) => h.id === c.id || h.code === c.code));
    if (add.length) {
      try {
        const raw = JSON.parse(localStorage.getItem(USER_KEY) || '[]');
        localStorage.setItem(USER_KEY, JSON.stringify([...raw, ...add.map(({ id, file, code, cover }) => ({ id, file, code, cover }))]));
        r.kartridges = add.length;
      } catch { r.voll = true; }
    }
    for (const id of Array.isArray(o.ausgepackt) ? o.ausgepackt : []) if (typeof id === 'string') markUnpacked({ id });
  }
  for (const [id, s] of Object.entries(o.spielstaende || {})) {
    if (only && !only.includes(id)) continue;
    if (!s || typeof s.daten !== 'object') continue;
    const ziel = idMap[id] || id;
    deleteSaves(ziel);
    if (putSaves(ziel, s.daten, s.zeit)) r.spielstaende++; else r.voll = true;
  }
  return r;
}

// Titelbild der Packung: eingebaute Kartridges unter covers/, eigene als Daten-URL (aus einer PNG-Kartridge)
const coverCache = new Map();
export function loadCover(cart) {
  const src = cart.cover || (cart.builtin && cart.file ? coverUrl(cart.file) : null);
  if (!src) return Promise.resolve(null);
  if (!coverCache.has(src)) {
    coverCache.set(src, new Promise((res) => {
      const img = new Image();
      // Titelbilder aus externen Katalogen: ohne CORS-Modus wäre die Leinwand danach gesperrt (toDataURL)
      if (/^https?:/.test(src) && !src.startsWith(location.origin)) img.crossOrigin = 'anonymous';
      img.onload = () => res(img);
      img.onerror = () => res(null);
      img.src = src;
    }));
  }
  return coverCache.get(src);
}

// Erstes Auspacken merken
const UNPACKED_KEY = '8boy:unpacked';
const unpacked = new Set((() => { try { return JSON.parse(localStorage.getItem(UNPACKED_KEY)) || []; } catch { return []; } })());
export const isUnpacked = (cart) => unpacked.has(cart.id);
export function markUnpacked(cart) {
  unpacked.add(cart.id);
  try { localStorage.setItem(UNPACKED_KEY, JSON.stringify([...unpacked])); } catch { /* privat */ }
}
