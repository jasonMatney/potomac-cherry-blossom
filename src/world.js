// River corridor definition: centerline, widths, bank zones, terrain heights, (s,d) mapping
import { clamp, lerp, smooth, fbm2, vnoise2 } from './util.js';

export const S0 = -900, S1 = 2350; // extent of built corridor along river (m)
export const LOOP_START = 30, LOOP_END = 1640;
export const DS = 1; // centerline sample spacing

// heading (rad) relative to initial upstream direction; + = turn right
function headingAt(s) {
  let th = 0;
  th += -0.33 * smooth(430, 720, s);
  th += -0.55 * smooth(700, 1160, s);
  th += 0.18 * smooth(1080, 1320, s);
  th += -0.30 * smooth(1380, 1700, s);
  th += 0.15 * smooth(1750, 2050, s);
  return th;
}

const N = Math.round((S1 - S0) / DS) + 1;
export const CL = { x: new Float32Array(N), z: new Float32Array(N), th: new Float32Array(N) };
{
  let x = 0, z = 0;
  // integrate from s=0 outwards both ways
  const i0 = Math.round((0 - S0) / DS);
  CL.x[i0] = 0; CL.z[i0] = 0; CL.th[i0] = headingAt(0);
  for (let i = i0 + 1; i < N; i++) {
    const s = S0 + i * DS; const th = headingAt(s - DS * 0.5);
    x += Math.sin(th) * DS; z += -Math.cos(th) * DS;
    CL.x[i] = x; CL.z[i] = z; CL.th[i] = headingAt(s);
  }
  x = 0; z = 0;
  for (let i = i0 - 1; i >= 0; i--) {
    const s = S0 + i * DS; const th = headingAt(s + DS * 0.5);
    x -= Math.sin(th) * DS; z -= -Math.cos(th) * DS;
    CL.x[i] = x; CL.z[i] = z; CL.th[i] = headingAt(s);
  }
}

// Frame at s: position, forward (upstream) and right (east bank) vectors
export function frame(s) {
  const f = clamp((s - S0) / DS, 0, N - 1.001);
  const i = Math.floor(f), t = f - i;
  const x = lerp(CL.x[i], CL.x[i + 1], t), z = lerp(CL.z[i], CL.z[i + 1], t);
  const th = lerp(CL.th[i], CL.th[i + 1], t);
  const fx = Math.sin(th), fz = -Math.cos(th);
  return { x, z, th, fx, fz, rx: -fz, rz: fx };
}
export function fromSD(s, d) {
  const F = frame(s);
  return [F.x + F.rx * d, F.z + F.rz * d];
}

// ---------- widths ----------
export function hwR(s) {
  let w = 130;
  w = lerp(w, 118, smooth(600, 900, s));
  w = lerp(w, 108, smooth(900, 1000, s));
  w = lerp(w, 62, smooth(1020, 1250, s));
  w = lerp(w, 58, smooth(1300, 1450, s));
  // Fletcher's cove indentation
  w += 26 * Math.exp(-Math.pow((s - 1545) / 42, 2));
  // Thompson launch small bay
  w += 6 * Math.exp(-Math.pow((s - 725) / 35, 2));
  return w;
}
export function hwL(s) {
  let w = 140;
  w = lerp(w, 172, smooth(470, 560, s));
  w = lerp(w, 104, smooth(820, 920, s));
  w = lerp(w, 64, smooth(1000, 1230, s));
  w = lerp(w, 60, smooth(1300, 1500, s));
  return w;
}
export const hw = (s, side) => (side > 0 ? hwR(s) : hwL(s));

// Roosevelt Island (ellipse in s,d)
export const ISLAND = { s: 690, d: -103, as: 158, ad: 40 };
export function islandMask(s, d) {
  const a = (s - ISLAND.s) / ISLAND.as, b = (d - ISLAND.d) / ISLAND.ad;
  // slightly irregular outline
  const wob = 0.08 * (vnoise2(s * 0.02, d * 0.02) - 0.5);
  return 1 - Math.sqrt(a * a + b * b) + wob; // >0 inside
}

// ---------- bank zones ----------
// types: seawall, riprap, park (gentle natural), launch, steps, wood (wooded slope), marsh, beach
const ZR = [
  [-9999, 120, 'seawall'], [120, 560, 'seawall'], [560, 680, 'riprap'], [680, 772, 'launch'],
  [772, 972, 'seawall'], [972, 1080, 'riprap'], [1080, 1485, 'wood'], [1485, 1600, 'beach'], [1600, 9999, 'wood'],
];
const ZL = [
  [-9999, 540, 'riprap'], [540, 860, 'marsh'], [860, 1010, 'riprap'], [1010, 9999, 'wood'],
];
function zoneWeights(s, side) {
  const Z = side > 0 ? ZR : ZL;
  const out = {};
  const tw = 14;
  for (const [a, b, t] of Z) {
    const w = smooth(a - tw, a + tw, s) * (1 - smooth(b - tw, b + tw, s));
    if (w > 0.0005) out[t] = (out[t] || 0) + w;
  }
  return out;
}
export function bankTypeAt(s, side) {
  const w = zoneWeights(s, side); let best = null, bw = -1;
  for (const k in w) if (w[k] > bw) { bw = w[k]; best = k; }
  return best;
}

// land base heights far from river (low bluffs)
function farHeight(s, side, e) {
  if (side > 0) {
    // DC side: flat monumental core rising gently into Georgetown heights
    let h = 2.3 + 0.004 * e;
    h += smooth(700, 1100, s) * 8 * smooth(40, 260, e);
    h += smooth(1080, 1300, s) * 10 * smooth(30, 200, e);
    // Georgetown bluff: the ground climbs to street level (M Street) where Key Bridge lands
    const win = smooth(850, 930, s) * (1 - smooth(1070, 1150, s));
    if (win > 0) h = Math.max(h, lerp(h, 16.0 + 0.012 * (e - 95), win * smooth(52, 92, e)));
    return h;
  } else {
    let h = 2.6 + 0.01 * e;
    h += smooth(300, 600, s) * 4 * smooth(30, 150, e);
    h += smooth(820, 1000, s) * 9 * smooth(10, 90, e);
    h += smooth(980, 1150, s) * 14 * smooth(15, 140, e);
    return h;
  }
}

// Canal (C&O) on east bank upstream: returns [towpathStartE, canalCenterE]
export const CANAL = { s0: 1090, towE0: 15, towE1: 26, canalE0: 28, canalE1: 38, level: 4.4, tow: 5.8 };

function profile(type, s, side, e) {
  const far = farHeight(s, side, e);
  const n = fbm2(s * 0.03 + side * 17, e * 0.05) - 0.5;
  switch (type) {
    case 'seawall': {
      if (e < 0.35) return lerp(-2.3, 2.1, e / 0.35);
      return Math.max(2.1 + 0.002 * e, lerp(2.1, far, smooth(40, 140, e)));
    }
    case 'riprap': {
      const t = smooth(0, 9, e);
      const top = 2.7;
      if (e < 9) return lerp(-0.9, top, Math.pow(t, 0.9)) + n * 0.4;
      return lerp(top, far, smooth(12, 90, e)) + n * 0.6;
    }
    case 'launch': {
      if (e < 14) return lerp(-0.25, 1.9, e / 14);
      return lerp(1.9, far, smooth(20, 80, e));
    }
    case 'beach': {
      let h = 0.08 + e * 0.07 + n * 0.25;
      if (e > 16) h = lerp(h, CANAL.tow, smooth(16, 26, e));
      if (e > 26) h = canalSide(e, far, n);
      return h;
    }
    case 'marsh': {
      if (e < 18) return 0.1 + e * 0.05 + n * 0.3;
      return lerp(1.0, far + 3, smooth(18, 70, e)) + n * 1.0;
    }
    case 'wood': {
      if (side > 0 && s > CANAL.s0 - 40) {
        const k = smooth(CANAL.s0 - 40, CANAL.s0 + 10, s);
        let h = 0.1 + e * 0.55 + n * 0.8;
        h = Math.min(h, CANAL.tow + 0.2);
        if (e > 12) h = lerp(h, CANAL.tow, smooth(12, CANAL.towE0, e));
        if (e > CANAL.towE1) h = canalSide(e, far, n);
        const generic = lerp(0.1 + e * 0.6, far + 4, smooth(6, 60, e)) + n * 2;
        return lerp(generic, h, k);
      }
      const steep = side < 0 ? 0.75 : 0.55;
      let h = 0.1 + e * steep + n * 1.2;
      h = Math.min(h, far + 6 + 3 * n);
      return lerp(h, far + 8 + n * 3, smooth(60, 220, e));
    }
  }
  return far;
}
function canalSide(e, far, n) {
  const C = CANAL;
  if (e < C.canalE0) return lerp(C.tow, C.level - 1.3, smooth(C.towE1, C.canalE0, e));
  if (e < C.canalE1) return C.level - 1.3 - 0.4 * Math.sin(Math.PI * (e - C.canalE0) / (C.canalE1 - C.canalE0));
  if (e < C.canalE1 + 3) return lerp(C.level - 1.3, C.level + 1.0, (e - C.canalE1) / 3);
  return lerp(C.level + 1.0, far + 10 + n * 3, smooth(C.canalE1 + 3, C.canalE1 + 70, e));
}

// the skipper's home: a level terrace cut into the Virginia bluff opposite Fletcher's Cove
export const HOME = { s: 1616, e: 15.5, s0: 1600, s1: 1632, e0: 10, e1: 27, y: 9.3 };
export function landHeight(s, side, e) {
  const w = zoneWeights(s, side);
  let h = 0, tw = 0;
  for (const k in w) { h += w[k] * profile(k, s, side, e); tw += w[k]; }
  h /= tw;
  if (side < 0) {
    const ws = smooth(HOME.s0 - 8, HOME.s0, s) * (1 - smooth(HOME.s1, HOME.s1 + 8, s));
    const we = smooth(HOME.e0 - 3, HOME.e0 + 0.5, e) * (1 - smooth(HOME.e1, HOME.e1 + 9, e));
    if (ws * we > 0) h = lerp(h, HOME.y, ws * we);
  }
  return h;
}

// river bed height at lateral d
export function bedHeight(s, d) {
  const side = d >= 0 ? 1 : -1;
  const W = hw(s, side);
  const q = clamp(1 - Math.abs(d) / W, 0, 1);
  const t = bankTypeAt(s, side);
  const n = fbm2(s * 0.02, d * 0.03) - 0.5;
  let deep = 6.5 + 1.5 * n;
  if (s > 1050) deep = 4.8 + 1.2 * n;
  let h;
  if (t === 'seawall') h = -(2.3 + (deep - 2.3) * smooth(0.02, 0.55, q));
  else if (t === 'riprap') h = -(0.9 + (deep - 0.9) * smooth(0.0, 0.5, q));
  else h = -(0.25 + 1.2 * smooth(0.0, 0.12, q) + (deep - 1.45) * smooth(0.08, 0.6, q)) + n * 0.25 * (1 - q);
  // island
  const im = islandMask(s, d);
  if (im > -0.45) {
    const ih = -0.3 + 7.5 * smooth(-0.3, 0.55, im) + 1.5 * (fbm2(s * 0.05, d * 0.05) - 0.5);
    h = Math.max(h, lerp(h, ih, smooth(-0.45, 0.0, im)));
    h = Math.max(h, im > 0 ? ih : h);
  }
  return h;
}

// full terrain height at (s,d)
export function heightSD(s, d) {
  const side = d >= 0 ? 1 : -1;
  const W = hw(s, side);
  const e = Math.abs(d) - W;
  if (e <= 0) return bedHeight(s, d);
  return landHeight(s, side, e);
}

// ---------- world -> (s,d) lookup ----------
const G = { cell: 16, x0: 0, z0: 0, nx: 0, nz: 0, idx: null };
export function buildLookup() {
  let minx = 1e9, maxx = -1e9, minz = 1e9, maxz = -1e9;
  for (let i = 0; i < N; i++) { minx = Math.min(minx, CL.x[i]); maxx = Math.max(maxx, CL.x[i]); minz = Math.min(minz, CL.z[i]); maxz = Math.max(maxz, CL.z[i]); }
  const pad = 900;
  G.x0 = minx - pad; G.z0 = minz - pad;
  G.nx = Math.ceil((maxx - minx + 2 * pad) / G.cell); G.nz = Math.ceil((maxz - minz + 2 * pad) / G.cell);
  G.idx = new Int32Array(G.nx * G.nz).fill(-1);
  const best = new Float32Array(G.nx * G.nz).fill(1e18);
  // coarse brute force over centerline subsample
  const step = 8;
  for (let gz = 0; gz < G.nz; gz++) for (let gx = 0; gx < G.nx; gx++) {
    const px = G.x0 + (gx + 0.5) * G.cell, pz = G.z0 + (gz + 0.5) * G.cell;
    let bi = 0, bd = 1e18;
    for (let i = 0; i < N; i += step) { const dx = CL.x[i] - px, dz = CL.z[i] - pz; const dd = dx * dx + dz * dz; if (dd < bd) { bd = dd; bi = i; } }
    G.idx[gz * G.nx + gx] = bi; best[gz * G.nx + gx] = bd;
  }
}
export function toSD(x, z) {
  const gx = clamp(Math.floor((x - G.x0) / G.cell), 0, G.nx - 1), gz = clamp(Math.floor((z - G.z0) / G.cell), 0, G.nz - 1);
  let i = G.idx[gz * G.nx + gx];
  // local refine
  let bd = 1e18, bi = i;
  for (let k = Math.max(0, i - 24); k <= Math.min(N - 1, i + 24); k++) { const dx = CL.x[k] - x, dz = CL.z[k] - z; const dd = dx * dx + dz * dz; if (dd < bd) { bd = dd; bi = k; } }
  // sub-sample projection
  const th = CL.th[bi]; const fx = Math.sin(th), fz = -Math.cos(th);
  const dx = x - CL.x[bi], dz = z - CL.z[bi];
  const along = dx * fx + dz * fz;
  const s = S0 + bi * DS + along;
  const d = dx * (-fz) + dz * fx;
  return { s, d };
}
export function heightAt(x, z) { const { s, d } = toSD(x, z); return heightSD(s, d); }
export function isWater(x, z) { const { s, d } = toSD(x, z); return heightSD(s, d) < -0.05; }

// water current speed (m/s, downstream) at (s,d)
export function currentAt(s, d) {
  const side = d >= 0 ? 1 : -1;
  const W = hw(s, side);
  const q = clamp(1 - Math.abs(d) / W, 0, 1);
  const width = hwR(s) + hwL(s);
  let v = 0.55 * (280 / width);
  v *= smooth(0, 0.5, q);
  if (islandMask(s, d) > -0.2) v *= 0.3;
  return Math.min(v, 1.4);
}

// compass: bearing (deg, 0=N, 90=E) -> world direction. Initial upstream heading is bearing 338
export const HEADING0 = 338;
export function bearingDir(b) {
  const a = (b - HEADING0) * Math.PI / 180;
  return [Math.sin(a), -Math.cos(a)];
}
