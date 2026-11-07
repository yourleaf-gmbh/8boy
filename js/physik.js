// 8BOY 128 Engine-Physik (Meilenstein 5): eine feste Welt aus Dreiecken und Fahrzeuge darauf – ohne Grafikkarte,
// auf dem Prozessor, Bild für Bild gleich (Tests, Wiederholungen).
//   Welt: Modelle werden mit Lage, Drehung und Größe wie bei draw3d eingetragen. Die Dreiecke liegen in einem Gitter
//     aus 4-m-Zellen (x/z); Abfragen schauen nur in die Zellen, die sie berühren.
//   Strahl (ray3d, ground3d): nächster Treffer entlang einer Richtung (Zellen per DDA, Möller-Trumbore).
//   Kugel (push3d): aus allen Dreiecken herausschieben (nächster Punkt auf dem Dreieck) – für Figuren, die laufen.
//   Fahrzeug (auto3d, fahr3d): Raycast-Fahrwerk – je Rad ein Strahl nach unten, Feder und Dämpfer, Motor, Bremse,
//     Seitenhaftung (weniger Haftung = Driften), Lenkung über den Radstand, Karosserie stößt mit zwei Kugeln an Wände.
// Achsen wie im 3D-Chip: y oben, Gier dreht +z Richtung +x.
export const ZELLE = 4;
export const MAX_AUTOS = 8;

// Drehung wie draw3d (Spalten = gedrehte Achsen x, y, z): erst Rollen, dann Nicken, dann Gier
export function drehung(yaw = 0, pitch = 0, roll = 0) {
  const cyw = Math.cos(yaw), syw = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch), cr = Math.cos(roll), sr = Math.sin(roll);
  const rot = (px, py, pz) => {
    const x1 = px * cr - py * sr, y1 = px * sr + py * cr, z1 = pz;
    const y2 = y1 * cp - z1 * sp, z2 = y1 * sp + z1 * cp;
    return [x1 * cyw + z2 * syw, y2, -x1 * syw + z2 * cyw];
  };
  return [...rot(1, 0, 0), ...rot(0, 1, 0), ...rot(0, 0, 1)];
}

export function createWelt() {
  let T = new Float32Array(9 * 4096), N = new Float32Array(3 * 4096), n = 0;   // Ecken, Normalen
  const gitter = new Map();
  let stempel = new Uint32Array(4096), runde = 0;
  const key = (ix, iz) => (ix + 32768) * 65536 + (iz + 32768);
  function platz(k) {
    if (k <= T.length / 9) return;
    let c = T.length / 9;
    while (c < k) c *= 2;
    const t2 = new Float32Array(c * 9); t2.set(T); T = t2;
    const n2 = new Float32Array(c * 3); n2.set(N); N = n2;
    const s2 = new Uint32Array(c); s2.set(stempel); stempel = s2;
  }
  // Modell eintragen: geo = { v: [x, y, z, …], f: [{ i: [a, b, c] }, …] } (wie meshToChip / builtinModel)
  function add(geo, x = 0, y = 0, z = 0, yaw = 0, pitch = 0, roll = 0, scale = 1) {
    const R = drehung(yaw, pitch, roll), s = typeof scale === 'object' ? scale : [scale, scale, scale], v = geo.v;
    const nv = v.length / 3, w = new Float32Array(v.length);
    for (let p = 0; p < nv; p++) {
      const px = v[p * 3] * s[0], py = v[p * 3 + 1] * s[1], pz = v[p * 3 + 2] * s[2];
      w[p * 3] = R[0] * px + R[3] * py + R[6] * pz + x;
      w[p * 3 + 1] = R[1] * px + R[4] * py + R[7] * pz + y;
      w[p * 3 + 2] = R[2] * px + R[5] * py + R[8] * pz + z;
    }
    platz(n + geo.f.length);
    let neu = 0;
    for (const f of geo.f) {
      const o = n * 9;
      for (let j = 0; j < 3; j++) { const p = f.i[j] * 3; T[o + j * 3] = w[p]; T[o + j * 3 + 1] = w[p + 1]; T[o + j * 3 + 2] = w[p + 2]; }
      const ux = T[o + 3] - T[o], uy = T[o + 4] - T[o + 1], uz = T[o + 5] - T[o + 2], vx = T[o + 6] - T[o], vy = T[o + 7] - T[o + 1], vz = T[o + 8] - T[o + 2];
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const l = Math.hypot(nx, ny, nz);
      if (l < 1e-9) continue;   // entartet
      // Normale nach oben bevorzugen (Böden aus beiden Umlaufrichtungen); Wände behalten ihre Richtung
      if (ny < 0 && Math.abs(ny) > 0.3 * l) { nx = -nx; ny = -ny; nz = -nz; }
      N[n * 3] = nx / l; N[n * 3 + 1] = ny / l; N[n * 3 + 2] = nz / l;
      const x0 = Math.floor(Math.min(T[o], T[o + 3], T[o + 6]) / ZELLE), x1 = Math.floor(Math.max(T[o], T[o + 3], T[o + 6]) / ZELLE);
      const z0 = Math.floor(Math.min(T[o + 2], T[o + 5], T[o + 8]) / ZELLE), z1 = Math.floor(Math.max(T[o + 2], T[o + 5], T[o + 8]) / ZELLE);
      for (let ix = x0; ix <= x1; ix++) for (let iz = z0; iz <= z1; iz++) {
        const k = key(ix, iz);
        let c = gitter.get(k);
        if (!c) { c = []; gitter.set(k, c); }
        c.push(n);
      }
      n++; neu++;
    }
    return neu;
  }
  function clear() { n = 0; gitter.clear(); }

  // Strahl gegen ein Dreieck (beidseitig): Abstand oder -1
  function strahlDreieck(t, ox, oy, oz, dx, dy, dz) {
    const o = t * 9;
    const e1x = T[o + 3] - T[o], e1y = T[o + 4] - T[o + 1], e1z = T[o + 5] - T[o + 2];
    const e2x = T[o + 6] - T[o], e2y = T[o + 7] - T[o + 1], e2z = T[o + 8] - T[o + 2];
    const px = dy * e2z - dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y - dy * e2x;
    const det = e1x * px + e1y * py + e1z * pz;
    if (Math.abs(det) < 1e-12) return -1;
    const inv = 1 / det, sx = ox - T[o], sy = oy - T[o + 1], sz = oz - T[o + 2];
    const u = (sx * px + sy * py + sz * pz) * inv;
    if (u < -1e-7 || u > 1 + 1e-7) return -1;
    const qx = sy * e1z - sz * e1y, qy = sz * e1x - sx * e1z, qz = sx * e1y - sy * e1x;
    const v = (dx * qx + dy * qy + dz * qz) * inv;
    if (v < -1e-7 || u + v > 1 + 1e-7) return -1;
    const d = (e2x * qx + e2y * qy + e2z * qz) * inv;
    return d >= 0 ? d : -1;
  }
  // nächster Treffer bis maxd: { t, x, y, z, nx, ny, nz } oder null
  function ray(ox, oy, oz, dx, dy, dz, maxd = 100) {
    const L = Math.hypot(dx, dy, dz);
    if (!n || L < 1e-12) return null;
    dx /= L; dy /= L; dz /= L;
    let ix = Math.floor(ox / ZELLE), iz = Math.floor(oz / ZELLE);
    const sx = dx > 0 ? 1 : -1, sz = dz > 0 ? 1 : -1;
    const tdx = Math.abs(dx) > 1e-12 ? ZELLE / Math.abs(dx) : Infinity, tdz = Math.abs(dz) > 1e-12 ? ZELLE / Math.abs(dz) : Infinity;
    let tmx = Math.abs(dx) > 1e-12 ? (dx > 0 ? (ix + 1) * ZELLE - ox : ox - ix * ZELLE) / Math.abs(dx) : Infinity;
    let tmz = Math.abs(dz) > 1e-12 ? (dz > 0 ? (iz + 1) * ZELLE - oz : oz - iz * ZELLE) / Math.abs(dz) : Infinity;
    let best = maxd, hit = -1, t = 0;
    runde++;
    for (let schritte = 0; t <= best && schritte < 4096; schritte++) {
      const c = gitter.get(key(ix, iz));
      if (c) for (const k of c) {
        if (stempel[k] === runde) continue;
        stempel[k] = runde;
        const d = strahlDreieck(k, ox, oy, oz, dx, dy, dz);
        if (d >= 0 && d < best) { best = d; hit = k; }
      }
      if (tmx < tmz) { t = tmx; tmx += tdx; ix += sx; } else { t = tmz; tmz += tdz; iz += sz; }
      if (t === Infinity) break;
    }
    if (hit < 0) return null;
    let nx = N[hit * 3], ny = N[hit * 3 + 1], nz = N[hit * 3 + 2];
    if (nx * dx + ny * dy + nz * dz > 0) { nx = -nx; ny = -ny; nz = -nz; }   // zum Strahl hin
    return { t: best, x: ox + dx * best, y: oy + dy * best, z: oz + dz * best, nx, ny, nz };
  }
  // Boden unter (x, z): von oben (y) nach unten
  const ground = (x, z, y = 1000) => ray(x, y, z, 0, -1, 0, 4000);

  // nächster Punkt auf Dreieck k zu p (Ericson, Real-Time Collision Detection 5.1.5)
  function naechster(k, px, py, pz, out) {
    const o = k * 9;
    const ax = T[o], ay = T[o + 1], az = T[o + 2], bx = T[o + 3], by = T[o + 4], bz = T[o + 5], cx = T[o + 6], cy = T[o + 7], cz = T[o + 8];
    const abx = bx - ax, aby = by - ay, abz = bz - az, acx = cx - ax, acy = cy - ay, acz = cz - az;
    const apx = px - ax, apy = py - ay, apz = pz - az;
    const d1 = abx * apx + aby * apy + abz * apz, d2 = acx * apx + acy * apy + acz * apz;
    const set = (x, y, z) => { out[0] = x; out[1] = y; out[2] = z; };
    if (d1 <= 0 && d2 <= 0) return set(ax, ay, az);
    const bpx = px - bx, bpy = py - by, bpz = pz - bz;
    const d3 = abx * bpx + aby * bpy + abz * bpz, d4 = acx * bpx + acy * bpy + acz * bpz;
    if (d3 >= 0 && d4 <= d3) return set(bx, by, bz);
    const vc = d1 * d4 - d3 * d2;
    if (vc <= 0 && d1 >= 0 && d3 <= 0) { const v = d1 / (d1 - d3); return set(ax + abx * v, ay + aby * v, az + abz * v); }
    const cpx = px - cx, cpy = py - cy, cpz = pz - cz;
    const d5 = abx * cpx + aby * cpy + abz * cpz, d6 = acx * cpx + acy * cpy + acz * cpz;
    if (d6 >= 0 && d5 <= d6) return set(cx, cy, cz);
    const vb = d5 * d2 - d1 * d6;
    if (vb <= 0 && d2 >= 0 && d6 <= 0) { const w = d2 / (d2 - d6); return set(ax + acx * w, ay + acy * w, az + acz * w); }
    const va = d3 * d6 - d5 * d4;
    if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) { const w = (d4 - d3) / ((d4 - d3) + (d5 - d6)); return set(bx + (cx - bx) * w, by + (cy - by) * w, bz + (cz - bz) * w); }
    const den = 1 / (va + vb + vc), v = vb * den, w = vc * den;
    return set(ax + abx * v + acx * w, ay + aby * v + acy * w, az + abz * v + acz * w);
  }
  // Kugel aus der Welt schieben: { x, y, z, boden, nx, ny, nz, beruehrt }
  const q = [0, 0, 0];
  function push(x, y, z, r) {
    let boden = false, beruehrt = false, gnx = 0, gny = 1, gnz = 0;
    for (let iter = 0; iter < 4; iter++) {
      let tief = 0, mx = 0, my = 0, mz = 0;
      runde++;
      const x0 = Math.floor((x - r) / ZELLE), x1 = Math.floor((x + r) / ZELLE), z0 = Math.floor((z - r) / ZELLE), z1 = Math.floor((z + r) / ZELLE);
      for (let ix = x0; ix <= x1; ix++) for (let iz = z0; iz <= z1; iz++) {
        const c = gitter.get(key(ix, iz));
        if (c) for (const k of c) {
          if (stempel[k] === runde) continue;
          stempel[k] = runde;
          naechster(k, x, y, z, q);
          const dx = x - q[0], dy = y - q[1], dz = z - q[2], d = Math.hypot(dx, dy, dz);
          if (d >= r) continue;
          let nx, ny, nz;
          if (d > 1e-6) { nx = dx / d; ny = dy / d; nz = dz / d; } else { nx = N[k * 3]; ny = N[k * 3 + 1]; nz = N[k * 3 + 2]; }
          if (r - d > tief) { tief = r - d; mx = nx; my = ny; mz = nz; }
        }
      }
      if (tief <= 1e-6) break;
      beruehrt = true;
      x += mx * tief; y += my * tief; z += mz * tief;
      if (my > 0.65) { boden = true; gnx = mx; gny = my; gnz = mz; }
    }
    return { x, y, z, boden, beruehrt, nx: gnx, ny: gny, nz: gnz };
  }
  return { add, clear, ray, ground, push, get dreiecke() { return n; }, get zellen() { return gitter.size; } };
}

// ---------------------------------------------------------------- Fahrzeug
const AUTO_START = { spur: 1.5, radstand: 2.4, radius: 0.38, federweg: 0.32, motor: 14, tempo: 30, bremse: 22, grip: 9, lenkung: 0.55, masse: 1 };
export function createAuto(welt, x, y, z, yaw = 0, o = {}) {
  const p = { ...AUTO_START, ...o };
  const a = {
    x, y, z, yaw, pitch: 0, roll: 0, vx: 0, vy: 0, vz: 0, p,
    raeder: [0, 1, 2, 3].map((i) => ({ lx: (i % 2 ? 1 : -1) * p.spur / 2, lz: (i < 2 ? 1 : -1) * p.radstand / 2, druck: 0, boden: false, dreh: 0, einschlag: 0, x: 0, y: 0, z: 0, h: 0 })),
    tempo: 0, boden: 0,
  };
  const G = 9.81, K = G / 0.5, D = 5;   // Feder: in Ruhe halb eingefedert
  a.schritt = (gas = 0, lenk = 0, brems = 0, dt = 1 / 60) => {
    gas = Math.max(-1, Math.min(1, gas)); lenk = Math.max(-1, Math.min(1, lenk)); brems = Math.max(0, Math.min(1, brems));
    const R = drehung(a.yaw, a.pitch, a.roll);
    const fx = Math.sin(a.yaw), fz = Math.cos(a.yaw), rx = Math.cos(a.yaw), rz = -Math.sin(a.yaw);
    let vf = a.vx * fx + a.vz * fz, vr = a.vx * rx + a.vz * rz;
    // Räder: Strahl von der Aufhängung nach unten
    let feder = 0, n = 0;
    const lang = p.radius + p.federweg;
    for (const r of a.raeder) {
      const mx = a.x + R[0] * r.lx + R[6] * r.lz, my = a.y + R[1] * r.lx + R[7] * r.lz, mz = a.z + R[2] * r.lx + R[8] * r.lz;
      const h = welt.ray(mx, my + 0.6, mz, 0, -1, 0, lang + 0.6 + 1.5);
      const s = h ? h.t - 0.6 : Infinity;
      r.boden = s < lang;
      r.druck = r.boden ? Math.min(1.6, (lang - s) / p.federweg) : 0;
      r.h = h ? h.y : my - lang - 1;
      if (r.boden) { feder += K * r.druck - D * a.vy; n++; }
      const hang = Math.min(s, lang) - p.radius;
      r.x = mx; r.y = my - Math.max(0, hang); r.z = mz;
      r.dreh += vf * dt / p.radius;
      // durchgeschlagen: Karosserie hochsetzen statt durch den Boden
      if (r.druck > 1.2) a.y += (r.druck - 1.2) * p.federweg * 0.25;
    }
    a.boden = n;
    let ay = -G + feder / 4;
    // Lage aus den Bodenhöhen unter den Rädern
    if (n >= 3) {
      const [vl, vr2, hl, hr] = a.raeder.map((r) => r.h);
      const zielN = Math.atan2(((hl + hr) - (vl + vr2)) / 2, p.radstand), zielR = Math.atan2(((vr2 + hr) - (vl + hl)) / 2, p.spur);
      a.pitch += (zielN - a.pitch) * 0.3; a.roll += (zielR - a.roll) * 0.3;
    } else { a.pitch *= 0.99; a.roll *= 0.98; }
    // Antrieb, Bremse, Haftung – nur mit Bodenkontakt
    const halt = n / 4;
    const einschlag = lenk * p.lenkung / (1 + Math.abs(vf) / 22);
    a.raeder[0].einschlag = a.raeder[1].einschlag = einschlag;
    if (n) {
      let af = 0;
      if (gas > 0) af += p.motor * gas * Math.max(0, 1 - vf / p.tempo);
      else if (gas < 0) af += p.motor * 0.6 * gas * Math.max(0, 1 + vf / (p.tempo * 0.35));
      if (brems > 0) af -= Math.sign(vf) * Math.min(Math.abs(vf) / dt, p.bremse * brems);
      af -= vf * 0.12 + Math.sign(vf) * 0.3 * (Math.abs(vf) > 0.05 ? 1 : 0);   // Rollwiderstand
      af += G * Math.sin(a.pitch) * 0.9;   // bergab rollt es
      vf += af * dt * halt;
      vr *= Math.exp(-p.grip * dt * halt);
      a.yaw += vf * Math.tan(einschlag) / p.radstand * dt * halt;
    }
    const fx2 = Math.sin(a.yaw), fz2 = Math.cos(a.yaw), rx2 = Math.cos(a.yaw), rz2 = -Math.sin(a.yaw);
    a.vx = fx2 * vf + rx2 * vr; a.vz = fz2 * vf + rz2 * vr;
    a.vy += ay * dt;
    if (!n) { a.vx *= 0.999; a.vz *= 0.999; }
    a.x += a.vx * dt; a.y += a.vy * dt; a.z += a.vz * dt;
    // Karosserie: vorn und hinten je eine Kugel gegen Wände und Kanten
    const kr = p.spur * 0.42;
    for (const s of [1, -1]) {
      const R2 = drehung(a.yaw, a.pitch, a.roll);
      const lz = s * p.radstand * 0.38, ly = kr * 0.9;
      const cx = a.x + R2[3] * ly + R2[6] * lz, cy = a.y + R2[4] * ly + R2[7] * lz, cz = a.z + R2[5] * ly + R2[8] * lz;
      const r = welt.push(cx, cy, cz, kr);
      if (!r.beruehrt) continue;
      const dx = r.x - cx, dy = r.y - cy, dz = r.z - cz, d = Math.hypot(dx, dy, dz);
      if (d < 1e-6) continue;
      a.x += dx; a.y += dy; a.z += dz;
      const nx = dx / d, ny = dy / d, nz = dz / d, vn = a.vx * nx + a.vy * ny + a.vz * nz;
      if (vn < 0) { a.vx -= nx * vn * 1.25; a.vy -= ny * vn * 1.25; a.vz -= nz * vn * 1.25; }
    }
    // Notbremse gegen Durchfallen (sehr schnell oder Teleport): nie unter dem Boden
    const g = welt.ground(a.x, a.z, a.y + 2);
    if (g && a.y < g.y - 0.5) { a.y = g.y + lang * 0.5; a.vy = 0; }
    a.tempo = a.vx * fx2 + a.vz * fz2;
    return a;
  };
  return a;
}
