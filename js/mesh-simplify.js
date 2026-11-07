// Modelle vereinfachen, ohne dass sie Löcher bekommen oder ihre Form verlieren.
//
// Verfahren: Fehler-Quadriken (Garland & Heckbert 1997) mit Halbkanten-Kollaps – ein Punkt wandert auf seinen Nachbarn,
// immer der, der die Form am wenigsten verändert. Weil Punkte nur auf vorhandene Punkte fallen, bleiben Farben,
// Texturkoordinaten und Normalen exakt erhalten. Zusätzlich:
//   - offene Ränder und Naht-Kanten (UV-/Farbgrenzen) bekommen Zusatz-Ebenen, damit Umriss und Nähte gerade bleiben
//   - an einer Naht wandern beide Seiten gemeinsam (sonst entstünden Risse)
//   - kein Kollaps, der Flächen umklappt oder das Netz verknotet (Link-Bedingung)
//
//   simplifyMesh(netz, ziel) → neues Netz mit höchstens „ziel“ Dreiecken (oder so wenigen, wie ohne Schaden geht)

class Heap {
  constructor() { this.c = []; this.k = []; }
  push(cost, item) {
    const c = this.c, k = this.k;
    let i = c.length;
    c.push(cost); k.push(item);
    while (i > 0) { const p = (i - 1) >> 1; if (c[p] <= cost) break; c[i] = c[p]; k[i] = k[p]; i = p; }
    c[i] = cost; k[i] = item;
  }
  pop() {
    const c = this.c, k = this.k, top = k[0], last = c.length - 1;
    const lc = c[last], lk = k[last];
    c.pop(); k.pop();
    if (last > 0) {
      let i = 0;
      for (;;) {
        let m = 2 * i + 1;
        if (m >= last) break;
        if (m + 1 < last && c[m + 1] < c[m]) m++;
        if (c[m] >= lc) break;
        c[i] = c[m]; k[i] = k[m]; i = m;
      }
      c[i] = lc; k[i] = lk;
    }
    return top;
  }
  get size() { return this.c.length; }
}

export function simplifyMesh(mesh, target, { borderWeight = 8, seamWeight = 2 } = {}) {
  const nt0 = mesh.idx.length / 3;
  if (nt0 <= target) return mesh;
  const P = mesh.pos, nw = P.length / 3;
  // gleiche Lage = ein Punkt („Gruppe“); Ecken behalten ihre Eigenschaften („Keil“ = ursprünglicher Punkt)
  const gOf = new Int32Array(nw), gm = new Map(), gpos = [];
  for (let w = 0; w < nw; w++) {
    const key = `${Math.round(P[w * 3] * 1e6)},${Math.round(P[w * 3 + 1] * 1e6)},${Math.round(P[w * 3 + 2] * 1e6)}`;
    let g = gm.get(key);
    if (g === undefined) { g = gpos.length / 3; gm.set(key, g); gpos.push(P[w * 3], P[w * 3 + 1], P[w * 3 + 2]); }
    gOf[w] = g;
  }
  const G = gpos.length / 3;
  const fw = Int32Array.from(mesh.idx), fv = new Int32Array(nt0 * 3), alive = new Uint8Array(nt0);
  const faces = Array.from({ length: G }, () => []);
  let live = 0;
  for (let t = 0; t < nt0; t++) {
    const a = gOf[fw[t * 3]], b = gOf[fw[t * 3 + 1]], c = gOf[fw[t * 3 + 2]];
    fv[t * 3] = a; fv[t * 3 + 1] = b; fv[t * 3 + 2] = c;
    if (a === b || b === c || a === c) continue;
    alive[t] = 1; live++;
    faces[a].push(t); faces[b].push(t); faces[c].push(t);
  }
  // ------------------------------------------------------------ Quadriken
  const Q = new Float64Array(G * 10);
  const addPlane = (g, nx, ny, nz, d, w) => {
    const o = g * 10;
    Q[o] += w * nx * nx; Q[o + 1] += w * nx * ny; Q[o + 2] += w * nx * nz; Q[o + 3] += w * nx * d;
    Q[o + 4] += w * ny * ny; Q[o + 5] += w * ny * nz; Q[o + 6] += w * ny * d;
    Q[o + 7] += w * nz * nz; Q[o + 8] += w * nz * d; Q[o + 9] += w * d * d;
  };
  const faceN = (a, b, c, pa = a, pb = b, pc = c) => {
    const ux = gpos[pb * 3] - gpos[pa * 3], uy = gpos[pb * 3 + 1] - gpos[pa * 3 + 1], uz = gpos[pb * 3 + 2] - gpos[pa * 3 + 2];
    const wx = gpos[pc * 3] - gpos[pa * 3], wy = gpos[pc * 3 + 1] - gpos[pa * 3 + 1], wz = gpos[pc * 3 + 2] - gpos[pa * 3 + 2];
    return [uy * wz - uz * wy, uz * wx - ux * wz, ux * wy - uy * wx];
  };
  for (let t = 0; t < nt0; t++) {
    if (!alive[t]) continue;
    const a = fv[t * 3], b = fv[t * 3 + 1], c = fv[t * 3 + 2];
    const [nx, ny, nz] = faceN(a, b, c), l = Math.hypot(nx, ny, nz);
    if (l < 1e-12) continue;
    const ux = nx / l, uy = ny / l, uz = nz / l, d = -(ux * gpos[a * 3] + uy * gpos[a * 3 + 1] + uz * gpos[a * 3 + 2]);
    for (const g of [a, b, c]) addPlane(g, ux, uy, uz, d, l * 0.5);
  }
  // Kanten zählen: Rand (eine Fläche) und Naht (gleiche Kante, andere Keile)
  const edgeKey = (a, b) => (a < b ? a * G + b : b * G + a);
  const edges = new Map();   // Schlüssel → [Fläche, …]
  for (let t = 0; t < nt0; t++) {
    if (!alive[t]) continue;
    for (let j = 0; j < 3; j++) {
      const a = fv[t * 3 + j], b = fv[t * 3 + (j + 1) % 3], k = edgeKey(a, b);
      let e = edges.get(k);
      if (!e) edges.set(k, (e = []));
      e.push(t);
    }
  }
  const wedgeAt = (t, g) => (fv[t * 3] === g ? fw[t * 3] : fv[t * 3 + 1] === g ? fw[t * 3 + 1] : fw[t * 3 + 2]);
  const border = new Uint8Array(G);
  for (const [k, ts] of edges) {
    const a = Math.floor(k / G), b = k % G;
    let seam = false;
    if (ts.length === 2) seam = wedgeAt(ts[0], a) !== wedgeAt(ts[1], a) || wedgeAt(ts[0], b) !== wedgeAt(ts[1], b);
    const open = ts.length === 1;
    if (!open && !seam) continue;
    if (open) { border[a] = 1; border[b] = 1; }
    // Ebene senkrecht zur Fläche durch die Kante
    const t = ts[0], [nx, ny, nz] = faceN(fv[t * 3], fv[t * 3 + 1], fv[t * 3 + 2]);
    const ex = gpos[b * 3] - gpos[a * 3], ey = gpos[b * 3 + 1] - gpos[a * 3 + 1], ez = gpos[b * 3 + 2] - gpos[a * 3 + 2];
    let px = ey * nz - ez * ny, py = ez * nx - ex * nz, pz = ex * ny - ey * nx;
    const l = Math.hypot(px, py, pz);
    if (l < 1e-12) continue;
    px /= l; py /= l; pz /= l;
    const d = -(px * gpos[a * 3] + py * gpos[a * 3 + 1] + pz * gpos[a * 3 + 2]), w = (open ? borderWeight : seamWeight) * (ex * ex + ey * ey + ez * ez);
    addPlane(a, px, py, pz, d, w); addPlane(b, px, py, pz, d, w);
  }
  const cost = (u, v) => {   // u wandert auf v: Fehler von (Qu + Qv) an der Stelle v
    const o = u * 10, p = v * 10, x = gpos[v * 3], y = gpos[v * 3 + 1], z = gpos[v * 3 + 2];
    const q = (i) => Q[o + i] + Q[p + i];
    return q(0) * x * x + 2 * q(1) * x * y + 2 * q(2) * x * z + 2 * q(3) * x + q(4) * y * y + 2 * q(5) * y * z + 2 * q(6) * y + q(7) * z * z + 2 * q(8) * z + q(9);
  };
  // ------------------------------------------------------------ Kollaps prüfen und ausführen
  const ver = new Int32Array(G);
  const aliveFaces = (g) => { const l = faces[g].filter((t) => alive[t]); faces[g] = l; return l; };
  const nbrs = (g) => { const s = new Set(); for (const t of aliveFaces(g)) for (let j = 0; j < 3; j++) if (fv[t * 3 + j] !== g) s.add(fv[t * 3 + j]); return s; };
  function plan(u, v) {   // gibt die Keil-Zuordnung zurück oder null, wenn der Kollaps schaden würde
    const fu = aliveFaces(u), shared = [], rest = [];
    for (const t of fu) (fv[t * 3] === v || fv[t * 3 + 1] === v || fv[t * 3 + 2] === v ? shared : rest).push(t);
    if (!shared.length || shared.length > 2) return null;
    if (border[u] && !border[v]) return null;               // Rand bleibt Rand
    if (border[u] && shared.length !== 1) return null;      // am Rand nur entlang der Randkante
    // Link-Bedingung: gemeinsame Nachbarn = genau die Gegenecken der gemeinsamen Flächen
    const nu = nbrs(u), nvv = nbrs(v);
    let common = 0;
    for (const x of nu) if (nvv.has(x)) common++;
    if (common !== shared.length) return null;
    // Keile von u → Keile von v (über die wegfallenden Flächen)
    const map = new Map();
    for (const t of shared) {
      const wu = wedgeAt(t, u), wv = wedgeAt(t, v);
      if (map.has(wu) && map.get(wu) !== wv) return null;
      map.set(wu, wv);
    }
    for (const t of rest) {
      if (!map.has(wedgeAt(t, u))) return null;             // Naht würde quer verschoben
      // umklappende Flächen?
      const a = fv[t * 3], b = fv[t * 3 + 1], c = fv[t * 3 + 2];
      const n0 = faceN(a, b, c), n1 = faceN(a, b, c, a === u ? v : a, b === u ? v : b, c === u ? v : c);
      const l0 = Math.hypot(...n0), l1 = Math.hypot(...n1);
      if (l1 < 1e-14 || (n0[0] * n1[0] + n0[1] * n1[1] + n0[2] * n1[2]) < 0.25 * l0 * l1) return null;
    }
    return { map, shared, rest };
  }
  const heap = new Heap();
  const pushEdge = (a, b) => {
    const ca = cost(a, b), cb = cost(b, a);
    heap.push(Math.min(ca, cb), [a, b, ver[a], ver[b]]);
  };
  for (const k of edges.keys()) pushEdge(Math.floor(k / G), k % G);
  while (live > target && heap.size) {
    const [a, b, va, vb] = heap.pop();
    if (ver[a] !== va || ver[b] !== vb || ver[a] < 0 || ver[b] < 0) continue;
    // billigere Richtung zuerst
    const dirs = cost(a, b) <= cost(b, a) ? [[a, b], [b, a]] : [[b, a], [a, b]];
    let done = false;
    for (const [u, v] of dirs) {
      const pl = plan(u, v);
      if (!pl) continue;
      for (const t of pl.shared) { alive[t] = 0; live--; }
      for (const t of pl.rest) {
        for (let j = 0; j < 3; j++) if (fv[t * 3 + j] === u) { fv[t * 3 + j] = v; fw[t * 3 + j] = pl.map.get(fw[t * 3 + j]); }
        faces[v].push(t);
      }
      faces[u] = [];
      for (let i = 0; i < 10; i++) Q[v * 10 + i] += Q[u * 10 + i];
      ver[u] = -1; ver[v]++;
      for (const n of nbrs(v)) pushEdge(v, n);
      done = true;
      break;
    }
    if (!done) continue;
  }
  // ------------------------------------------------------------ übrig gebliebene Keile neu durchnummerieren
  const remap = new Int32Array(nw).fill(-1);
  const keep = [];
  const idx = new Uint32Array(live * 3);
  let o = 0;
  for (let t = 0; t < nt0; t++) {
    if (!alive[t]) continue;
    for (let j = 0; j < 3; j++) {
      const w = fw[t * 3 + j];
      if (remap[w] < 0) { remap[w] = keep.length; keep.push(w); }
      idx[o++] = remap[w];
    }
  }
  const pick = (src, k, T) => { if (!src) return null; const out = new T(keep.length * k); keep.forEach((w, i) => { for (let j = 0; j < k; j++) out[i * k + j] = src[w * k + j]; }); return out; };
  return { ...mesh, pos: pick(mesh.pos, 3, Float32Array), nrm: pick(mesh.nrm, 3, Float32Array), uv: pick(mesh.uv, 2, Float32Array), col: pick(mesh.col, 1, Uint32Array), idx };
}
