// Asset-Pakete (8BOY 128): Inhalte liegen nicht in der Kartridge, sondern in Paketen.
//
// Ein Paket ist ein Ordner mit manifest.json und Dateien, die nach ihrem Inhalt heißen (<sha256, 16 Zeichen>.<endung>):
//   { "paket": "giga-demo", "version": 3, "assets": {
//       "jetski": { "datei": "3f9c…b8m", "typ": "modell", "groesse": 48211, "vorab": true, "lizenz": "CC0", "quelle": "…" } } }
// Gleicher Inhalt = gleicher Name: Browser und Server dürfen die Dateien für immer zwischenspeichern; ein Update lädt nur Neues.
//
// Zwei Wege, ein Ergebnis:
//   1. Server-Stream: <basis>/<paket>/manifest.json und die Dateien nach Bedarf (Zwischenspeicher: Cache Storage).
//   2. Großes Paket: <paket>.8bpak (ZIP mit manifest.json und den Dateien) auf die Konsole ziehen – liegt dann im Browser
//      (IndexedDB) und läuft ohne Netz. Ein lokales Paket hat Vorrang vor dem Server.
// Jede Datei wird beim Laden mit ihrem Namen (Hash) verglichen – beschädigte oder untergeschobene Daten fallen auf.
//
// Kartridge-Kopf: -- assets: giga-demo, giga-basis    Lua: asset(name), assetload(name), assetinfo(), modelload(n, "asset:name")

export const PAK_ENDUNG = '.8bpak';
const NAME_OK = /^[a-z0-9][a-z0-9-]{0,47}$/;

// ------------------------------------------------------------------ Hilfen
async function sha256hex(buf) {
  const d = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
const hashVon = (datei) => String(datei).split('.')[0];

export function pruefeManifest(m, erwartet) {
  if (!m || typeof m !== 'object' || typeof m.assets !== 'object') throw new Error('manifest.json ist kein Asset-Manifest');
  if (!NAME_OK.test(m.paket || '')) throw new Error(`ungültiger Paketname „${m.paket}“`);
  if (erwartet && m.paket !== erwartet) throw new Error(`Paket heißt „${m.paket}“, erwartet „${erwartet}“`);
  for (const [name, a] of Object.entries(m.assets)) {
    if (!/^[a-z0-9_.-]{1,64}$/i.test(name)) throw new Error(`ungültiger Asset-Name „${name}“`);
    if (!/^[0-9a-f]{16}\.[a-z0-9]{1,6}$/.test(a.datei || '')) throw new Error(`Asset „${name}“: ungültiger Dateiname`);
  }
  return m;
}

// ------------------------------------------------------------------ ZIP lesen (.8bpak) – nur „gespeichert“ und „deflate“
export async function leseZip(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  let e = -1;
  for (let i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--) if (dv.getUint32(i, true) === 0x06054b50) { e = i; break; }
  if (e < 0) throw new Error('kein ZIP (.8bpak) – Ende des Inhaltsverzeichnisses fehlt');
  const n = dv.getUint16(e + 10, true);
  let p = dv.getUint32(e + 16, true);
  const dec = new TextDecoder();
  const out = new Map();
  for (let k = 0; k < n; k++) {
    if (dv.getUint32(p, true) !== 0x02014b50) throw new Error('ZIP-Inhaltsverzeichnis beschädigt');
    const methode = dv.getUint16(p + 10, true), clen = dv.getUint32(p + 20, true), ulen = dv.getUint32(p + 24, true);
    const nlen = dv.getUint16(p + 28, true), xlen = dv.getUint16(p + 30, true), clen2 = dv.getUint16(p + 32, true);
    const lokal = dv.getUint32(p + 42, true);
    const name = dec.decode(u8.subarray(p + 46, p + 46 + nlen));
    p += 46 + nlen + xlen + clen2;
    if (name.endsWith('/')) continue;
    const ln = dv.getUint16(lokal + 26, true), lx = dv.getUint16(lokal + 28, true);
    const roh = u8.subarray(lokal + 30 + ln + lx, lokal + 30 + ln + lx + clen);
    let daten;
    if (methode === 0) daten = roh.slice();
    else if (methode === 8) daten = new Uint8Array(await new Response(new Blob([roh]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer());
    else throw new Error(`ZIP-Eintrag ${name}: Packverfahren ${methode} wird nicht unterstützt`);
    if (daten.length !== ulen) throw new Error(`ZIP-Eintrag ${name}: Größe stimmt nicht`);
    out.set(name.replace(/^.*\//, ''), daten);
  }
  return out;
}

// ------------------------------------------------------------------ Speicher im Browser
// lokal: IndexedDB „8boy-assets“ mit den Stores „pakete“ (Name → Manifest) und „dateien“ (paket/datei → Bytes)
function idbSpeicher() {
  if (typeof indexedDB === 'undefined') return null;
  let dbp = null;
  const db = () => dbp || (dbp = new Promise((res, rej) => {
    const r = indexedDB.open('8boy-assets', 1);
    r.onupgradeneeded = () => { r.result.createObjectStore('pakete'); r.result.createObjectStore('dateien'); };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  }));
  const tx = async (store, mode, fn) => {
    const d = await db();
    return new Promise((res, rej) => {
      const t = d.transaction(store, mode);
      const r = fn(t.objectStore(store));
      t.oncomplete = () => res(r && 'result' in r ? r.result : undefined);
      t.onerror = () => rej(t.error);
    });
  };
  return {
    manifest: (paket) => tx('pakete', 'readonly', (s) => s.get(paket)).catch(() => undefined),
    datei: (paket, datei) => tx('dateien', 'readonly', (s) => s.get(paket + '/' + datei)).catch(() => undefined),
    async speichern(m, dateien) {
      await tx('dateien', 'readwrite', (s) => { for (const [n, b] of dateien) s.put(b, m.paket + '/' + n); });
      await tx('pakete', 'readwrite', (s) => s.put(m, m.paket));
    },
    alle: () => tx('pakete', 'readonly', (s) => s.getAll()).catch(() => []),
    async loeschen(paket) {
      const m = await this.manifest(paket);
      if (!m) return;
      await tx('dateien', 'readwrite', (s) => { for (const a of Object.values(m.assets)) s.delete(paket + '/' + a.datei); });
      await tx('pakete', 'readwrite', (s) => s.delete(paket));
    },
  };
}
// Server-Dateien: Cache Storage (Dateien heißen nach ihrem Inhalt → einmal geladen, für immer gültig)
function cacheSpeicher() {
  if (typeof caches === 'undefined') return null;
  const c = () => caches.open('8boy-assets-v1');
  return {
    async holen(url) { try { const r = await (await c()).match(url); return r ? new Uint8Array(await r.arrayBuffer()) : null; } catch { return null; } },
    async ablegen(url, bytes) { try { await (await c()).put(url, new Response(bytes)); } catch { /* voll oder privat */ } },
  };
}

// ------------------------------------------------------------------ Asset-Verwaltung
//   basis: Adresse der Server-Pakete (Standard „assets/“), holen: fetch, lokal/cache: Speicher (null = ohne)
export function createAssets({ basis = 'assets/', holen = (u) => fetch(u), lokal = idbSpeicher(), cache = cacheSpeicher(), parallel = 4 } = {}) {
  const pakete = new Map();     // Name → { m: Manifest, quelle: 'server'|'lokal' }
  const assets = new Map();     // Asset-Name → { paket, a, status: 'fehlt'|'laedt'|'bereit'|'fehler', bytes, fehler }
  let geladen = 0, gesamt = 0;

  async function paketOeffnen(name) {
    if (pakete.has(name)) return pakete.get(name);
    if (!NAME_OK.test(name)) throw new Error(`ungültiger Paketname „${name}“`);
    let eintrag = null;
    const lm = lokal && await lokal.manifest(name);
    if (lm) eintrag = { m: pruefeManifest(lm, name), quelle: 'lokal' };
    else {
      const url = `${basis}${name}/manifest.json`;
      let text = null;
      try {
        const r = await holen(url, { cache: 'no-cache' });
        if (r.ok) { text = await r.text(); cache?.ablegen(url, new TextEncoder().encode(text)); }
      } catch { /* offline: aus dem Zwischenspeicher */ }
      if (text === null && cache) { const c = await cache.holen(url); if (c) text = new TextDecoder().decode(c); }
      if (text === null) throw new Error(`Asset-Paket „${name}“ nicht gefunden (weder im Browser noch auf dem Server)`);
      eintrag = { m: pruefeManifest(JSON.parse(text), name), quelle: 'server' };
    }
    pakete.set(name, eintrag);
    for (const [an, a] of Object.entries(eintrag.m.assets)) {
      if (assets.has(an)) continue;   // erstes Paket gewinnt
      assets.set(an, { paket: name, a, status: 'fehlt', bytes: null });
    }
    return eintrag;
  }

  async function dateiLaden(paket, a) {
    const p = pakete.get(paket);
    let bytes = null;
    if (p.quelle === 'lokal') bytes = await lokal.datei(paket, a.datei);
    else {
      const url = `${basis}${paket}/${a.datei}`;
      bytes = cache && await cache.holen(url);
      if (!bytes) {
        const r = await holen(url);
        if (!r.ok) throw new Error(`${a.datei}: HTTP ${r.status}`);
        bytes = new Uint8Array(await r.arrayBuffer());
        if ((await sha256hex(bytes)).slice(0, 16) !== hashVon(a.datei)) throw new Error(`${a.datei}: Prüfsumme stimmt nicht`);
        cache?.ablegen(url, bytes);
      }
    }
    if (!bytes) throw new Error(`${a.datei} fehlt im Paket „${paket}“`);
    return bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  }

  function laden(name) {
    const e = assets.get(name);
    if (!e) return Promise.reject(new Error(`unbekanntes Asset „${name}“`));
    if (e.status === 'bereit') return Promise.resolve(e.bytes);
    if (e.versprechen) return e.versprechen;
    e.status = 'laedt';
    gesamt += e.a.groesse || 0;
    e.versprechen = dateiLaden(e.paket, e.a).then((b) => {
      e.bytes = b; e.status = 'bereit'; geladen += e.a.groesse || b.length;
      return b;
    }, (err) => { e.status = 'fehler'; e.fehler = err.message; throw err; });
    return e.versprechen;
  }

  // Für den Kartridge-Start: Pakete öffnen, alle „vorab“-Assets laden; fortschritt(geladenBytes, gesamtBytes)
  async function vorbereiten(namen, fortschritt = () => {}) {
    for (const n of namen) await paketOeffnen(n);
    const liste = [...assets.entries()].filter(([, e]) => e.a.vorab).map(([n]) => n);
    const summe = liste.reduce((s, n) => s + (assets.get(n).a.groesse || 0), 0);
    let fertig = 0;
    fortschritt(0, summe);
    const warte = [...liste];
    const arbeiter = Array.from({ length: Math.min(parallel, warte.length) }, async () => {
      while (warte.length) {
        const n = warte.shift();
        await laden(n);
        fertig += assets.get(n).a.groesse || 0;
        fortschritt(fertig, summe);
      }
    });
    await Promise.all(arbeiter);
    return { pakete: namen.map((n) => ({ name: n, quelle: pakete.get(n).quelle, version: pakete.get(n).m.version })) };
  }

  // .8bpak (ZIP) übernehmen: prüfen und im Browser ablegen; gibt das Manifest zurück
  async function paketImportieren(bytes) {
    if (!lokal) throw new Error('Dieser Browser kann keine Pakete speichern');
    const dateien = await leseZip(bytes);
    const mb = dateien.get('manifest.json');
    if (!mb) throw new Error('im Paket fehlt manifest.json');
    const m = pruefeManifest(JSON.parse(new TextDecoder().decode(mb)));
    const ablage = new Map();
    for (const [name, a] of Object.entries(m.assets)) {
      const b = dateien.get(a.datei);
      if (!b) throw new Error(`Asset „${name}“: Datei ${a.datei} fehlt im Paket`);
      if ((await sha256hex(b)).slice(0, 16) !== hashVon(a.datei)) throw new Error(`Asset „${name}“: Prüfsumme stimmt nicht`);
      ablage.set(a.datei, b);
    }
    await lokal.speichern(m, ablage);
    pakete.delete(m.paket);
    return m;
  }

  return {
    vorbereiten,
    laden,
    paketImportieren,
    // sofort (ohne Warten): Bytes eines geladenen Assets oder null
    bytes: (name) => assets.get(name)?.bytes || null,
    status: (name) => assets.get(name)?.status || (assets.size ? 'unbekannt' : 'fehlt'),
    info: (name) => assets.get(name) || null,
    fortschritt: () => ({ geladen, gesamt }),
    lokalePakete: () => (lokal ? lokal.alle() : Promise.resolve([])),
    paketLoeschen: (n) => lokal?.loeschen(n),
    // zwischen zwei Kartridges: geladene Daten freigeben (Zwischenspeicher bleiben)
    leeren() { pakete.clear(); assets.clear(); geladen = 0; gesamt = 0; },
  };
}
