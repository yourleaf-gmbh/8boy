// Blaupausen für Welten: kleine Knoten-Graphen, die eine Kachelkarte erzeugen.
// Ein Knoten hat Eingänge und Ausgänge; Kabel verbinden einen Ausgang mit einem Eingang gleicher Sorte.
// Sorten: samen (Zahl), feld (Höhenwerte 0..1 je Zelle), karte (Kacheln + Objekte).
import { uid } from './templates.js';

const S = { samen: 'samen', feld: 'feld', karte: 'karte' };

// ------------------------------------------------------------------ Knotenarten
export const NODE_TYPES = {
  samen: {
    label: 'Zufallssamen', color: '#f7922b', help: 'Eine Zahl, aus der aller Zufall entsteht. Gleiche Zahl = gleiche Welt.',
    inputs: [], outputs: [['samen', S.samen]],
    params: [{ k: 'wert', t: 'number', label: 'Samen', d: 42 }],
    run: (inp, p) => ({ samen: Math.floor(+p.wert || 0) }),
  },
  rauschen: {
    label: 'Rauschen', color: '#3c9cf0', help: 'Weiche Hügel und Täler: für jede Zelle eine Höhe zwischen 0 und 1.',
    inputs: [['samen', S.samen]], outputs: [['feld', S.feld]],
    params: [{ k: 'groesse', t: 'number', label: 'Größe der Hügel', d: 8 }, { k: 'stufen', t: 'number', label: 'Feinheit (1–5)', d: 3 }],
    run: (inp, p, size) => ({ feld: noiseField(size.w, size.h, inp.samen ?? 1, Math.max(1, +p.groesse || 8), Math.max(1, Math.min(5, +p.stufen || 3))) }),
  },
  insel: {
    label: 'Rand absenken', color: '#3c9cf0', help: 'Macht die Ränder niedrig – so entsteht eine Insel im Wasser.',
    inputs: [['feld', S.feld]], outputs: [['feld', S.feld]],
    params: [{ k: 'staerke', t: 'number', label: 'Stärke (0–1)', d: 0.6 }],
    run: (inp, p, size) => {
      const f = inp.feld; if (!f) return { feld: null };
      const out = new Float32Array(f.length), k = Math.max(0, Math.min(1, +p.staerke));
      for (let y = 0; y < size.h; y++) for (let x = 0; x < size.w; x++) {
        const dx = (x + 0.5) / size.w * 2 - 1, dy = (y + 0.5) / size.h * 2 - 1;
        const d = Math.min(1, Math.sqrt(dx * dx + dy * dy));
        out[y * size.w + x] = f[y * size.w + x] * (1 - k * d * d) + (1 - k) * 0;
      }
      return { feld: out };
    },
  },
  hoehe: {
    label: 'Höhe → Kachel', color: '#63c74d', help: 'Wandelt Höhen in Kacheln: unter der ersten Schwelle die erste Kachel, darüber die nächste …',
    inputs: [['feld', S.feld]], outputs: [['karte', S.karte]],
    params: [{ k: 'stufen', t: 'steps', label: 'Schwellen', d: null }],
    run: (inp, p, size) => {
      const f = inp.feld; if (!f) return { karte: null };
      const steps = (p.stufen || []).slice().sort((a, b) => a.bis - b.bis);
      const tiles = new Array(size.w * size.h).fill(0);
      for (let i = 0; i < f.length; i++) {
        const st = steps.find((s) => f[i] <= s.bis) || steps[steps.length - 1];
        tiles[i] = st ? st.kachel : 0;
      }
      return { karte: { tiles, objects: [] } };
    },
  },
  dungeon: {
    label: 'Räume + Gänge', color: '#63c74d', help: 'Ein Verlies: Räume, die durch Gänge verbunden sind. Der Rest ist Wand.',
    inputs: [['samen', S.samen]], outputs: [['karte', S.karte]],
    params: [{ k: 'raeume', t: 'number', label: 'Räume', d: 6 }, { k: 'boden', t: 'tile', label: 'Boden', d: 0 }, { k: 'wand', t: 'tile', label: 'Wand', d: 0 }],
    run: (inp, p, size) => ({ karte: dungeon(size.w, size.h, inp.samen ?? 1, Math.max(1, Math.min(20, +p.raeume || 6)), +p.boden, +p.wand) }),
  },
  verstreuen: {
    label: 'Verstreuen', color: '#e43b44', help: 'Verteilt Bäume, Blumen oder Objekte zufällig – aber nur auf einer bestimmten Kachel.',
    inputs: [['karte', S.karte], ['samen', S.samen]], outputs: [['karte', S.karte]],
    params: [{ k: 'auf', t: 'tile', label: 'nur auf', d: 0 }, { k: 'dichte', t: 'number', label: 'Dichte in %', d: 8 },
      { k: 'was', t: 'scatter', label: 'was', d: 'kachel:0' }, { k: 'abstand', t: 'number', label: 'Abstand zum Rand', d: 1 }],
    run: (inp, p, size) => {
      const k = inp.karte; if (!k) return { karte: null };
      const rng = mulberry32(((inp.samen ?? 7) * 7919 + 13) >>> 0);
      const tiles = k.tiles.slice(), objects = k.objects.slice();
      const [kind, val, spr] = String(p.was || '').split(':');
      const dens = Math.max(0, Math.min(100, +p.dichte || 0)) / 100, m = Math.max(0, +p.abstand || 0);
      const taken = new Set(objects.map((o) => o.y * size.w + o.x));
      for (let y = m; y < size.h - m; y++) for (let x = m; x < size.w - m; x++) {
        const i = y * size.w + x;
        if (tiles[i] !== +p.auf || rng() >= dens) continue;
        if (kind === 'kachel') tiles[i] = +val;
        else if (kind === 'objekt' && !taken.has(i)) { objects.push({ type: val, sprite: +spr || 0, x, y }); taken.add(i); }
      }
      return { karte: { tiles, objects } };
    },
  },
  ummauern: {
    label: 'Rand ummauern', color: '#8b7bb8', help: 'Legt eine Mauer (oder Bäume) rund um die ganze Karte.',
    inputs: [['karte', S.karte]], outputs: [['karte', S.karte]],
    params: [{ k: 'kachel', t: 'tile', label: 'Kachel', d: 0 }, { k: 'dicke', t: 'number', label: 'Dicke', d: 1 }],
    run: (inp, p, size) => {
      const k = inp.karte; if (!k) return { karte: null };
      const tiles = k.tiles.slice(), d = Math.max(1, Math.min(5, +p.dicke || 1));
      for (let y = 0; y < size.h; y++) for (let x = 0; x < size.w; x++) {
        if (x < d || y < d || x >= size.w - d || y >= size.h - d) tiles[y * size.w + x] = +p.kachel;
      }
      return { karte: { tiles, objects: k.objects.filter((o) => o.x >= d && o.y >= d && o.x < size.w - d && o.y < size.h - d) } };
    },
  },
  ausgabe: {
    label: 'Ergebnis', color: '#fee761', help: 'Was hier ankommt, kannst du in die Szene übernehmen.',
    inputs: [['karte', S.karte]], outputs: [],
    params: [],
    run: (inp) => ({ karte: inp.karte }),
  },
};
export const NODE_ORDER = ['samen', 'rauschen', 'insel', 'hoehe', 'dungeon', 'verstreuen', 'ummauern', 'ausgabe'];

// ------------------------------------------------------------------ Zufall und Rauschen
export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function noiseField(w, h, seed, scale, octaves) {
  const out = new Float32Array(w * h);
  let amp = 1, total = 0;
  for (let o = 0; o < octaves; o++) {
    const s = Math.max(1, scale / 2 ** o);
    const gw = Math.ceil(w / s) + 2, gh = Math.ceil(h / s) + 2;
    const rng = mulberry32((seed * 1013 + o * 7777 + 1) >>> 0);
    const grid = Float32Array.from({ length: gw * gh }, () => rng());
    const sm = (t) => t * t * (3 - 2 * t);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const fx = x / s, fy = y / s, ix = Math.floor(fx), iy = Math.floor(fy);
      const tx = sm(fx - ix), ty = sm(fy - iy);
      const a = grid[iy * gw + ix], b = grid[iy * gw + ix + 1], c = grid[(iy + 1) * gw + ix], d = grid[(iy + 1) * gw + ix + 1];
      out[y * w + x] += amp * ((a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty);
    }
    total += amp; amp /= 2;
  }
  for (let i = 0; i < out.length; i++) out[i] /= total;
  return out;
}
function dungeon(w, h, seed, count, floor, wall) {
  const rng = mulberry32((seed * 31337 + 5) >>> 0);
  const ri = (a, b) => a + Math.floor(rng() * (b - a + 1));
  const tiles = new Array(w * h).fill(wall);
  const rooms = [];
  for (let tries = 0; tries < count * 30 && rooms.length < count; tries++) {
    const rw = ri(4, Math.max(4, Math.min(9, w / 3 | 0))), rh = ri(3, Math.max(3, Math.min(7, h / 3 | 0)));
    const x = ri(1, Math.max(1, w - rw - 2)), y = ri(1, Math.max(1, h - rh - 2));
    if (rooms.some((r) => x < r.x + r.w + 1 && r.x < x + rw + 1 && y < r.y + r.h + 1 && r.y < y + rh + 1)) continue;
    rooms.push({ x, y, w: rw, h: rh });
  }
  const dig = (x, y) => { if (x > 0 && y > 0 && x < w - 1 && y < h - 1) tiles[y * w + x] = floor; };
  for (const r of rooms) for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) dig(x, y);
  // jeder Raum mit dem nächsten verbunden: erst waagerecht, dann senkrecht
  rooms.sort((a, b) => a.x - b.x);
  for (let i = 1; i < rooms.length; i++) {
    const a = rooms[i - 1], b = rooms[i];
    const ax = a.x + (a.w >> 1), ay = a.y + (a.h >> 1), bx = b.x + (b.w >> 1), by = b.y + (b.h >> 1);
    for (let x = Math.min(ax, bx); x <= Math.max(ax, bx); x++) dig(x, ay);
    for (let y = Math.min(ay, by); y <= Math.max(ay, by); y++) dig(bx, y);
  }
  return { tiles, objects: [], rooms };
}

// ------------------------------------------------------------------ Auswerten
// Liefert { tiles, objects } am Ergebnis-Knoten, dazu je Knoten die Zwischenergebnisse (für Vorschauen).
export function generateWorld(graph, project, size) {
  const memo = new Map(), busy = new Set();
  const nodeOf = (id) => graph.nodes.find((n) => n.id === id);
  function evalNode(n) {
    if (memo.has(n.id)) return memo.get(n.id);
    if (busy.has(n.id)) throw new Error('Kreis im Graphen: ein Knoten hängt von sich selbst ab.');
    busy.add(n.id);
    const def = NODE_TYPES[n.type];
    const inp = {};
    for (const [name] of def.inputs) {
      const link = graph.links.find((l) => l.to === n.id && l.in === name);
      if (link) { const src = nodeOf(link.from); if (src) inp[name] = evalNode(src)[link.out]; }
    }
    const out = def.run(inp, n.p || {}, size, project);
    busy.delete(n.id);
    memo.set(n.id, out);
    return out;
  }
  try {
    const end = graph.nodes.find((n) => n.type === 'ausgabe');
    if (!end) return { error: 'Es fehlt der Knoten „Ergebnis“.', memo };
    const res = evalNode(end).karte;
    for (const n of graph.nodes) evalNode(n);
    if (!res) return { error: 'Am „Ergebnis“ kommt noch keine Karte an. Verbinde einen Karten-Ausgang damit.', memo };
    return { tiles: res.tiles, objects: res.objects, memo };
  } catch (e) {
    return { error: e.message, memo };
  }
}

// ------------------------------------------------------------------ Fertige Blaupausen
export function defaultGraph(project, kind = 'insel') {
  // Kachel nach Namen – fehlt sie, eine passende Ersatzkachel (fest/nicht fest), damit jede Vorlage etwas Sinnvolles erzeugt
  const tiles = project.sprites.filter((s) => s.kind === 'tile');
  const solid = tiles.filter((s) => s.solid), open = tiles.filter((s) => !s.solid);
  const FALLBACK = { Wasser: solid[0], Baum: solid[1] || solid[0], Fels: solid[0], Mauer: solid[0], Weg: open[1] || open[0], Gras: open[0], Blumen: open[2] || open[0], Höhlenboden: open[0] };
  const T = (name) => project.sprites.find((s) => s.name === name)?.n || FALLBACK[name]?.n || tiles[0]?.n || 0;
  const F = (name) => project.sprites.find((s) => s.name === name)?.n || 0;
  const node = (type, x, y, p = {}) => {
    const def = NODE_TYPES[type];
    const params = {};
    for (const prm of def.params) params[prm.k] = prm.d;
    return { id: uid('n'), type, x, y, p: { ...params, ...p } };
  };
  const link = (a, out, b, inp) => ({ from: a.id, out, to: b.id, in: inp });
  if (kind === 'dungeon') {
    const s = node('samen', 20, 30, { wert: 7 });
    const d = node('dungeon', 240, 30, { raeume: 7, boden: T('Höhlenboden'), wand: T('Fels') });
    const v = node('verstreuen', 460, 30, { auf: T('Höhlenboden'), dichte: 3, was: `objekt:sammel:${F('Münze')}`, abstand: 1 });
    const v2 = node('verstreuen', 460, 330, { auf: T('Höhlenboden'), dichte: 1, was: `objekt:gegner:${F('Fledermaus') || F('Schleim')}`, abstand: 1 });
    const u = node('ummauern', 680, 30, { kachel: T('Fels'), dicke: 1 });
    const out = node('ausgabe', 680, 330);
    return { id: uid('b'), name: 'Verlies', kind, nodes: [s, d, v, v2, u, out], links: [link(s, 'samen', d, 'samen'), link(d, 'karte', v, 'karte'), link(s, 'samen', v, 'samen'), link(v, 'karte', v2, 'karte'), link(v2, 'karte', u, 'karte'), link(u, 'karte', out, 'karte')] };
  }
  const s = node('samen', 20, 30, { wert: 42 });
  const r = node('rauschen', 240, 30, { groesse: 8, stufen: 3 });
  const i = node('insel', 460, 30, { staerke: 0.55 });
  const h = node('hoehe', 680, 30, { stufen: [{ bis: 0.3, kachel: T('Wasser') }, { bis: 0.35, kachel: T('Weg') }, { bis: 0.6, kachel: T('Gras') }, { bis: 1, kachel: T('Baum') }] });
  const v = node('verstreuen', 240, 330, { auf: T('Gras'), dichte: 6, was: `kachel:${T('Blumen')}`, abstand: 0 });
  const v2 = node('verstreuen', 460, 330, { auf: T('Gras'), dichte: 2, was: `objekt:sammel:${F('Münze')}`, abstand: 1 });
  const out = node('ausgabe', 680, 330);
  return { id: uid('b'), name: 'Insel', kind, nodes: [s, r, i, h, v, v2, out], links: [link(s, 'samen', r, 'samen'), link(r, 'feld', i, 'feld'), link(i, 'feld', h, 'feld'), link(h, 'karte', v, 'karte'), link(s, 'samen', v, 'samen'), link(v, 'karte', v2, 'karte'), link(s, 'samen', v2, 'samen'), link(v2, 'karte', out, 'karte')] };
}
