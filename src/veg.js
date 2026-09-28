// Vegetation: procedural trees (hero cherries, weeping cherry, maples, birches, sycamores, oaks, woodland),
// ground cover (grass, reeds, wildflowers, ferns, shrubs), rocks & riprap
import * as THREE from 'three';
import { mulberry32, clamp, lerp, smooth, fbm2, fbm3, vnoise3 } from './util.js';
import { frame, fromSD, hw, hwR, hwL, bankTypeAt, islandMask, ISLAND, CANAL, S0, S1, heightSD, toSD } from './world.js';
import { terrainH, groundAt, bakeAO, clampAO } from './terrain.js';
import { std, depthFor, U } from './matpatch.js';
import { tube, merge, ensureColor, shade, boxUV, tf } from './geo.js';
import { CANOPIES, addObstacle } from './registry.js';
import { LAYER } from './post.js';
import TEX from './tex.js';

const V3 = THREE.Vector3;
export const CHERRY_SPAWN = []; // blossom points for falling petals {p: V3, r}
export const VEG = { hero: [], mats: {}, far: [], dyn: [] };
export function reflCull(cam, on) { for (const e of VEG.dyn) { if (e.maxDist < 1000) continue; if (on) { e.full = e.im.count; e.im.count = Math.min(e.im.count, e.near); } else if (e.full !== undefined) { e.im.count = e.full; e.full = undefined; } } for (const m of VEG.far) { if (m.userData.maxDist < 1000 || !m.visible && on) continue; const bs = m.boundingSphere; if (on) { m.userData.rv = m.visible; m.visible = m.visible && bs.center.distanceTo(cam) - bs.radius < 480; } else if (m.userData.rv !== undefined) m.visible = m.userData.rv; } }
export function cullVeg(cam, k = 1) { for (const m of VEG.far) { const bs = m.boundingSphere; if (!bs) continue; m.visible = bs.center.distanceTo(cam) - bs.radius < m.userData.maxDist * k; } }


// Instanced trees are batched per variant over the whole river, and each batch only carries the trees that are
// in view (or whose mirror image is, for the water reflection) within reach, nearest-first so the reflection
// pass can draw just the near part. Rebuilt when the camera has moved or turned enough.
const _fr = new THREE.Frustum(), _pm = new THREE.Matrix4(), _sp = new THREE.Sphere(), _cf = new V3();
const _last = { p: new V3(1e9, 0, 0), f: new V3(), t: 0, k: -1 };
export function cullVegDyn(camera, k = 1, now = 0) {
  camera.getWorldDirection(_cf);
  const moved = _last.p.distanceTo(camera.position) > 1.5 || _last.f.dot(_cf) < 0.9994 || now - _last.t > 0.6 || k !== _last.k;
  if (!moved) return;
  _last.p.copy(camera.position); _last.f.copy(_cf); _last.t = now; _last.k = k;
  _fr.setFromProjectionMatrix(_pm.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
  const cx = camera.position.x, cz = camera.position.z;
  for (const e of VEG.dyn) {
    const { im, mats, cols, sph, n } = e; const md = e.maxDist * k; const arr = im.instanceMatrix.array, carr = im.instanceColor ? im.instanceColor.array : null;
    const near = [], far = [];
    for (let i = 0; i < n; i++) {
      const x = sph[i * 4], y = sph[i * 4 + 1], z = sph[i * 4 + 2], r = sph[i * 4 + 3];
      const d = Math.hypot(x - cx, z - cz) - r; if (d > md) continue;
      _sp.center.set(x, y, z); _sp.radius = r + 3;
      let vis = _fr.intersectsSphere(_sp);
      if (!vis) { _sp.center.y = -y; vis = _fr.intersectsSphere(_sp); }
      if (vis) (d < 480 ? near : far).push(i);
    }
    let w = 0;
    for (const list of [near, far]) for (const i of list) { arr.set(mats.subarray(i * 16, i * 16 + 16), w * 16); if (carr) carr.set(cols.subarray(i * 3, i * 3 + 3), w * 3); w++; }
    im.count = w; e.near = near.length;
    im.instanceMatrix.clearUpdateRanges(); im.instanceMatrix.addUpdateRange(0, w * 16); im.instanceMatrix.needsUpdate = true;
    if (carr) { im.instanceColor.clearUpdateRanges(); im.instanceColor.addUpdateRange(0, w * 3); im.instanceColor.needsUpdate = true; }
    im.visible = w > 0;
  }
}

// ---------------------------------------------------------------- species
const SP = {
  cherry: { trunkH: [1.5, 2.4], trunkR: [0.2, 0.3], lean: [0.12, 0.4], limbs: [3, 5], limbAng: [0.75, 1.15], limbLen: [3.6, 5.4], kids: [0, 4, 3], kidAng: [0.5, 0.9], kidLen: 0.55, gnarl: 0.32, up: 0.2, droop: 0.05, tiles: [0, 1, 0, 1, 0], card: [1.0, 1.5], cards: 13, bark: 'barkCherry', seg: [9, 7, 5, 4], maxOrder: 2 },
  weeping: { trunkH: [2.4, 3.0], trunkR: [0.2, 0.26], lean: [0.05, 0.15], limbs: [5, 6], limbAng: [0.35, 0.6], limbLen: [2.8, 3.6], kids: [0, 4, 0], kidAng: [0.3, 0.7], kidLen: 0.7, gnarl: 0.25, up: 0.45, droop: 0.9, tiles: [2], card: [1.8, 2.6], cards: 7, bark: 'barkCherry', seg: [9, 7, 5, 4], maxOrder: 2, weeping: true },
  maple: { trunkH: [2.8, 4.2], trunkR: [0.22, 0.32], lean: [0, 0.08], limbs: [6, 8], limbAng: [0.35, 0.7], limbLen: [4, 6], kids: [0, 3, 2], kidAng: [0.4, 0.8], kidLen: 0.55, gnarl: 0.14, up: 0.55, droop: 0, tiles: [3, 3, 4], card: [1.5, 2.1], cards: 10, bark: 'bark', seg: [8, 6, 4, 3], maxOrder: 2, leader: true },
  birch: { trunkH: [5, 7], trunkR: [0.12, 0.17], lean: [0.12, 0.3], limbs: [4, 6], limbAng: [0.5, 0.9], limbLen: [2.5, 4], kids: [0, 3, 0], kidAng: [0.4, 0.9], kidLen: 0.6, gnarl: 0.18, up: 0.25, droop: 0.2, tiles: [4, 4, 5], card: [1.2, 1.7], cards: 9, bark: 'barkBirch', seg: [6, 4, 3, 3], maxOrder: 2, multi: 3 },
  sycamore: { trunkH: [5, 7], trunkR: [0.35, 0.5], lean: [0.05, 0.2], limbs: [5, 6], limbAng: [0.55, 0.95], limbLen: [6, 8.5], kids: [0, 3, 2], kidAng: [0.4, 0.9], kidLen: 0.55, gnarl: 0.22, up: 0.35, droop: 0.05, tiles: [4, 5, 4], card: [2.4, 3.4], cards: 8, bark: 'barkSyc', seg: [7, 5, 3, 3], maxOrder: 2 },
  oak: { trunkH: [3.5, 5], trunkR: [0.35, 0.5], lean: [0, 0.1], limbs: [5, 7], limbAng: [0.6, 1.05], limbLen: [5.5, 7.5], kids: [0, 3, 2], kidAng: [0.5, 1.0], kidLen: 0.55, gnarl: 0.3, up: 0.25, droop: 0, tiles: [4, 6, 6], card: [2.4, 3.4], cards: 8, bark: 'bark', seg: [7, 5, 3, 3], maxOrder: 2 },
  wood: { trunkH: [5, 8], trunkR: [0.25, 0.4], lean: [0, 0.12], limbs: [4, 6], limbAng: [0.45, 0.85], limbLen: [4.5, 6.5], kids: [0, 3, 0], kidAng: [0.4, 0.8], kidLen: 0.6, gnarl: 0.2, up: 0.4, droop: 0, tiles: [5, 6, 4, 5], card: [3.0, 4.2], cards: 8, bark: 'bark', seg: [6, 5, 3, 3], maxOrder: 1 },
  bare: { trunkH: [5, 7], trunkR: [0.25, 0.35], lean: [0, 0.1], limbs: [5, 6], limbAng: [0.45, 0.85], limbLen: [4.5, 6.5], kids: [0, 3, 0], kidAng: [0.4, 0.8], kidLen: 0.6, gnarl: 0.24, up: 0.4, droop: 0, tiles: [4, 4, 3], card: [1.2, 1.8], cards: 4, bark: 'bark', seg: [6, 5, 3, 3], maxOrder: 1 },
  redbud: { trunkH: [1.2, 1.8], trunkR: [0.12, 0.16], lean: [0.1, 0.3], limbs: [3, 4], limbAng: [0.6, 1.0], limbLen: [2.5, 3.5], kids: [0, 3, 0], kidAng: [0.5, 0.9], kidLen: 0.6, gnarl: 0.25, up: 0.3, droop: 0, tiles: [7], card: [1.0, 1.4], cards: 7, bark: 'bark', seg: [6, 5, 4, 3], maxOrder: 1 },
};

function tileUV(t) { const col = t % 4, row = Math.floor(t / 4); return [col * 0.25, 1 - (row + 1) * 0.5]; }

export function genTree(spName, seed, opts = {}) {
  const sp = SP[spName];
  const r = mulberry32(seed);
  const rr = (a, b) => a + (b - a) * r();
  const barkG = [], cards = [];
  const leanDir = opts.leanDir || new V3(Math.cos(r() * 6.28), 0, Math.sin(r() * 6.28));
  const estH = ((sp.trunkH[0] + sp.trunkH[1]) / 2 + (sp.limbLen[0] + sp.limbLen[1]) / 2 * 0.8) * (opts.scale || 1);
  const lean = opts.lean ?? rr(sp.lean[0], sp.lean[1]);
  const scale = opts.scale || 1;
  let crownPts = [];

  function addCards(p, parentFlex, phase, dir) {
    const n = sp.cards;
    for (let i = 0; i < n; i++) {
      const size = rr(sp.card[0], sp.card[1]) * scale;
      const tile = sp.tiles[Math.floor(r() * sp.tiles.length)];
      let c;
      if (sp.weeping) {
        c = p.clone().add(new V3(rr(-0.4, 0.4), rr(-0.2, 0.1), rr(-0.4, 0.4)));
        cards.push({ c, size, tile, hang: true, rot: r() * Math.PI, flex: parentFlex + 0.25, phase });
      } else {
        const off = new V3(rr(-1, 1), rr(-0.6, 1), rr(-1, 1)).normalize().multiplyScalar(rr(0.1, 0.7) * size);
        c = p.clone().add(off).addScaledVector(dir, rr(-0.3, 0.4) * size);
        const ow = new V3(c.x, (c.y - estH * 0.55) * 0.7, c.z); if (ow.lengthSq() < 1e-3) ow.set(0, 1, 0);
        ow.normalize().add(new V3(rr(-0.7, 0.7), rr(-0.5, 0.7), rr(-0.7, 0.7))).normalize();
        cards.push({ c, size, tile, n: ow, spin: r() * Math.PI * 2, flex: parentFlex + 0.08, phase });
      }
      crownPts.push(c);
    }
  }

  function grow(start, dir, len, rad, order, phase, flex0) {
    const segLen = order === 0 ? 0.8 : order === 1 ? 1.1 : 0.9;
    const nseg = Math.max(3, Math.round(len / segLen));
    const pts = [start.clone()], radii = [rad], flex = [flex0];
    let d = dir.clone().normalize(); let p = start.clone();
    for (let i = 1; i <= nseg; i++) {
      const t = i / nseg;
      // gnarl, phototropism, droop
      d.x += (r() - 0.5) * sp.gnarl; d.z += (r() - 0.5) * sp.gnarl; d.y += (r() - 0.5) * sp.gnarl * 0.6;
      d.y += sp.up * 0.08 * (order > 0 ? 1 : 0.3);
      if (sp.droop && order > 0) d.y -= sp.droop * 0.12 * t * (sp.weeping ? 2.2 : 1);
      d.normalize();
      p = p.clone().addScaledVector(d, len / nseg);
      pts.push(p);
      radii.push(Math.max(0.012 * scale, rad * (1 - t * 0.72)));
      flex.push(flex0 + (order === 0 ? 0.04 : order === 1 ? 0.22 : 0.3) * t * (len / 5));
    }
    // bark tube
    if (opts.lod && order >= 2) { /* twigs omitted in the lightweight variant: foliage cards hide them */ }
    else {
    const g = tube(pts, radii, opts.lod ? Math.max(3, (sp.seg[order] || 3) - 2) : (sp.seg[order] || 3), { uvScale: 1.3, capEnd: order > 0, noise: order === 0 ? (i, j, a) => 1 + 0.1 * Math.sin(a * 5 + i) * (i < 3 ? 1 : 0.3) : null });
    const np = g.attributes.position.count; const w = new Float32Array(np * 4); const col = new Float32Array(np * 3);
    const ring = (opts.lod ? Math.max(3, (sp.seg[order] || 3) - 2) : (sp.seg[order] || 3)) + 1;
    for (let k = 0; k < np; k++) {
      const i = Math.min(pts.length - 1, Math.floor(k / ring));
      w[k * 4] = flex[i]; w[k * 4 + 1] = phase; w[k * 4 + 2] = 0; w[k * 4 + 3] = 0;
      const ao = order === 0 ? 0.55 + 0.45 * clamp(i / 3, 0, 1) : 0.8 + 0.2 * (i / pts.length);
      col[k * 3] = col[k * 3 + 1] = col[k * 3 + 2] = ao;
    }
    g.setAttribute('aWind', new THREE.BufferAttribute(w, 4)); g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    barkG.push(g);
    }
    // children
    const nk = order === 0 ? 0 : (sp.kids[order] || 0);
    if (order < sp.maxOrder && nk > 0) {
      for (let k = 0; k < nk; k++) {
        const t = rr(0.35, 0.95); const i = Math.max(1, Math.round(t * nseg));
        const base = pts[i];
        const axis = new V3().subVectors(pts[Math.min(nseg, i + 1)], pts[i - 1]).normalize();
        const side = new V3(r() - 0.5, 0, r() - 0.5).cross(axis).normalize();
        const cd = axis.clone().applyAxisAngle(side, rr(sp.kidAng[0], sp.kidAng[1])).normalize();
        grow(base, cd, len * sp.kidLen * rr(0.7, 1.1), radii[i] * 0.6, order + 1, phase + rr(-0.3, 0.3), flex[i]);
      }
    }
    if (order >= sp.maxOrder || (order === 1 && nk === 0) || (order >= 1 && sp.maxOrder === 1)) {
      // leaves along last part
      const nC = sp.weeping ? 3 : 2;
      for (let k = 0; k < nC; k++) {
        const i = Math.max(1, Math.round(nseg * rr(0.45, 1)));
        addCards(pts[i], flex[i], phase, d);
      }
    }
    return { pts, radii, flex };
  }

  const base = new V3(0, -0.4, 0);
  const stems = sp.multi || 1;
  let topH = 0;
  for (let st = 0; st < stems; st++) {
    const sl = stems > 1 ? new V3(Math.cos(st * 2.1 + r()), 0, Math.sin(st * 2.1 + r())).multiplyScalar(0.35) : leanDir.clone().multiplyScalar(lean);
    const tdir = new V3(sl.x, 1, sl.z).normalize();
    const th = rr(sp.trunkH[0], sp.trunkH[1]) * scale;
    const tr = rr(sp.trunkR[0], sp.trunkR[1]) * scale * (stems > 1 ? 0.8 : 1);
    const trunk = grow(base.clone().add(new V3(sl.x * 0.4, 0, sl.z * 0.4)), tdir, th + 0.4, tr, 0, r() * 6, 0);
    const top = trunk.pts[trunk.pts.length - 1];
    topH = Math.max(topH, top.y);
    // root flare
    for (let k = 0; k < (opts.lod ? 3 : 5); k++) {
      const a = k / (opts.lod ? 3 : 5) * 6.28 + r();
      const rp = [new V3(Math.cos(a) * tr * 0.3, 0.35, Math.sin(a) * tr * 0.3), new V3(Math.cos(a) * tr * 1.3, 0.02, Math.sin(a) * tr * 1.3), new V3(Math.cos(a) * tr * 2.4, -0.25, Math.sin(a) * tr * 2.4)];
      const g = tube(rp, [tr * 0.45, tr * 0.28, tr * 0.08], 5, { uvScale: 1.3 });
      const np = g.attributes.position.count;
      g.setAttribute('aWind', new THREE.BufferAttribute(new Float32Array(np * 4), 4));
      g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(np * 3).fill(0.55), 3));
      barkG.push(g);
    }
    const nl = Math.round(rr(sp.limbs[0], sp.limbs[1]));
    const phase0 = r() * 6;
    for (let k = 0; k < nl; k++) {
      const a = (k / nl) * Math.PI * 2 + rr(-0.3, 0.3);
      const ang = rr(sp.limbAng[0], sp.limbAng[1]);
      const hdir = new V3(Math.cos(a), 0, Math.sin(a));
      // limbs tend to follow the lean direction a bit
      hdir.addScaledVector(leanDir, lean * 0.8).normalize();
      const dir = new V3(hdir.x * Math.sin(ang), Math.cos(ang), hdir.z * Math.sin(ang));
      const i = sp.leader ? Math.max(1, Math.round(trunk.pts.length * rr(0.45, 0.95)) - 1) : trunk.pts.length - 1 - (k % 2);
      const bp = trunk.pts[Math.min(trunk.pts.length - 1, i)];
      grow(bp, dir, rr(sp.limbLen[0], sp.limbLen[1]) * scale, trunk.radii[Math.min(trunk.radii.length - 1, i)] * rr(0.55, 0.75), 1, phase0 + k * 0.7, trunk.flex[Math.min(trunk.flex.length - 1, i)]);
    }
    if (sp.leader) grow(top, new V3(0, 1, 0), th * 0.8, trunk.radii[trunk.radii.length - 1] * 0.9, 1, phase0, trunk.flex[trunk.flex.length - 1]);
  }
  // crown centre & radius
  const cc = new V3(); crownPts.forEach((p) => cc.add(p)); cc.divideScalar(Math.max(1, crownPts.length));
  let cr = 0; crownPts.forEach((p) => (cr = Math.max(cr, p.distanceTo(cc))));
  // card geometry
  const pos = [], nrm = [], uv = [], wind = [], colr = [], idx = [];
  const up = new V3(0, 1, 0);
  for (const c of cards) {
    const [u0, v0] = tileUV(c.tile);
    let ax, ay;
    if (c.hang) {
      ax = new V3(Math.cos(c.rot), 0, Math.sin(c.rot)).multiplyScalar(c.size * 0.35); ay = new V3(0, -c.size, 0);
    } else {
      const n = c.n;
      ax = new V3().crossVectors(n, up); if (ax.lengthSq() < 1e-4) ax.set(1, 0, 0); ax.normalize();
      ay = new V3().crossVectors(ax, n).normalize();
      const ca = Math.cos(c.spin), sa = Math.sin(c.spin);
      const ax2 = ax.clone().multiplyScalar(ca).addScaledVector(ay, sa), ay2 = ay.clone().multiplyScalar(ca).addScaledVector(ax, -sa);
      ax = ax2.multiplyScalar(c.size / 2); ay = ay2.multiplyScalar(c.size / 2);
    }
    const outward = new V3().subVectors(c.c, cc).add(new V3(0, cr * 0.35, 0)).normalize();
    const outerness = clamp(c.c.distanceTo(cc) / Math.max(cr, 0.1), 0, 1);
    const b = pos.length / 3;
    const corners = c.hang ? [[-1, 0, u0, v0 + 0.5], [1, 0, u0 + 0.25, v0 + 0.5], [1, 1, u0 + 0.25, v0], [-1, 1, u0, v0]] : [[-1, -1, u0, v0], [1, -1, u0 + 0.25, v0], [1, 1, u0 + 0.25, v0 + 0.5], [-1, 1, u0, v0 + 0.5]];
    for (const [sx, sy, uu, vv] of corners) {
      const p = c.c.clone().addScaledVector(ax, sx).addScaledVector(ay, sy);
      pos.push(p.x, p.y, p.z); nrm.push(outward.x, outward.y, outward.z); uv.push(uu, vv);
      const hangFlex = c.hang ? sy * 0.35 : 0;
      wind.push(c.flex + hangFlex, c.phase, 1, outerness);
      const shadeK = 0.55 + 0.45 * outerness * (0.6 + 0.4 * clamp((p.y - cc.y) / cr + 0.5, 0, 1));
      colr.push(shadeK, shadeK, shadeK);
    }
    idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  }
  const lg = new THREE.BufferGeometry();
  lg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  lg.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  lg.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  lg.setAttribute('aWind', new THREE.Float32BufferAttribute(wind, 4));
  lg.setAttribute('color', new THREE.Float32BufferAttribute(colr, 3));
  lg.setIndex(idx);
  const bg = merge(barkG, ['aWind']);
  return { bark: bg, leaves: lg, crown: cc, crownR: cr, height: topH, cards: cards.length, crownPts };
}

// ---------------------------------------------------------------- materials
function makeMats() {
  const nm = (t, s = 1) => ({ normalMap: t.normalMap, normalScale: new THREE.Vector2(s, s) });
  const M = VEG.mats;
  for (const b of ['bark', 'barkCherry', 'barkBirch', 'barkSyc']) {
    M[b] = std({ map: TEX[b].map, ...nm(TEX[b], 1.2), roughness: 0.95, vertexColors: true }, { wind: true, wet: 0.8 });
    M[b].customDepthMaterial = depthFor(M[b], { wind: true });
  }
  const leafOpts = { wind: true, transl: 0.9, wet: 0.5, onShader: (sh) => { sh.fragmentShader = sh.fragmentShader.replace('float faceDirection = gl_FrontFacing ? 1.0 : - 1.0;', 'float faceDirection = 1.0;'); } };
  M.leaf = std({ map: TEX.foliage.map, alphaTest: 0.42, side: THREE.DoubleSide, roughness: 0.8, vertexColors: true }, leafOpts);
  M.leaf.alphaToCoverage = true;
  M.leaf.customDepthMaterial = depthFor(M.leaf, { wind: true });
  M.blossom = std({ map: TEX.foliage.map, alphaTest: 0.42, side: THREE.DoubleSide, roughness: 0.7, vertexColors: true, color: 0xfff4f6 }, { ...leafOpts, transl: 1.5 });
  M.blossom.alphaToCoverage = true;
  M.blossom.customDepthMaterial = depthFor(M.blossom, { wind: true });
  const gcOpts = { wind: 0.6, transl: 0.6, wet: 0.4, onShader: leafOpts.onShader };
  M.ground = std({ map: TEX.ground.map, alphaTest: 0.4, side: THREE.DoubleSide, roughness: 0.85, vertexColors: true }, gcOpts);
  M.ground.alphaToCoverage = true;
  M.rock = std({ map: TEX.rock.map, ...nm(TEX.rock, 1.0), roughness: 0.9, vertexColors: true }, {
    wet: 1.0,
    mapReplace: /* glsl */`
      vec3 an = abs(normalize(vWNrm)); an = pow(an, vec3(3.0)); an /= (an.x + an.y + an.z);
      vec3 rc = texture2D(map, vWPos.zy*0.33).rgb*an.x + texture2D(map, vWPos.xz*0.33).rgb*an.y + texture2D(map, vWPos.xy*0.33).rgb*an.z;
      float mossN = texture2D(map, vWPos.xz*0.07).g;
      float moss = smoothstep(0.35, 0.8, normalize(vWNrm).y + (mossN-0.5)*0.9) * step(0.6, vWPos.y) * MOSS_K;
      rc = mix(rc, vec3(0.2, 0.3, 0.09) * (0.7 + mossN*0.6), moss);
      float wl = 1.0 - smoothstep(-0.2, 0.5, vWPos.y);
      rc = mix(rc, rc * vec3(0.55, 0.6, 0.45), wl);
      diffuseColor.rgb *= rc * 1.6;
    `,
  });
  M.rock.defines.MOSS_K = '0.85';
}

// ---------------------------------------------------------------- instancing helpers
const _m4 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new V3(), _p = new V3(), _c = new THREE.Color();
function instGroups(scene, variants, placements, { cast = true, layer = 0, leafMat, barkMatOf } = {}) {
  // placements: {v, x, y, z, rot, s}; one batch per variant and part, culled per instance each frame (cullVegDyn)
  const groups = new Map();
  for (const pl of placements) { if (!groups.has(pl.v)) groups.set(pl.v, []); groups.get(pl.v).push(pl); }
  const meshes = [];
  for (const [vi, list] of groups) {
    const v = variants[vi]; const n = list.length;
    const mats = new Float32Array(n * 16), sph = new Float32Array(n * 4), cols = new Float32Array(n * 3);
    list.forEach((pl, i) => {
      _q.setFromAxisAngle(new V3(0, 1, 0), pl.rot); _s.setScalar(pl.s); _p.set(pl.x, pl.y, pl.z);
      _m4.compose(_p, _q, _s); _m4.toArray(mats, i * 16);
      const h = (v.height || 8) * pl.s; sph[i * 4] = pl.x; sph[i * 4 + 1] = pl.y + h * 0.5; sph[i * 4 + 2] = pl.z; sph[i * 4 + 3] = Math.max(h * 0.6, (v.crownR || 3) * pl.s + 1);
      cols[i * 3] = pl.tint[0]; cols[i * 3 + 1] = pl.tint[1]; cols[i * 3 + 2] = pl.tint[2];
    });
    for (const part of ['bark', 'leaves']) {
      const geo = v[part];
      const mat = part === 'bark' ? barkMatOf(v) : (v.leafMat || leafMat);
      const im = new THREE.InstancedMesh(geo, mat, n);
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      if (part === 'leaves') { im.setColorAt(0, _c.setRGB(1, 1, 1)); im.instanceColor.setUsage(THREE.DynamicDrawUsage); }
      im.count = 0; im.frustumCulled = false;
      im.castShadow = cast; im.receiveShadow = true; im.layers.set(part === 'bark' ? LAYER.NOREFL : layer);
      im.customDepthMaterial = mat.customDepthMaterial;
      VEG.dyn.push({ im, mats, sph, cols: part === 'leaves' ? cols : null, n, maxDist: part === 'bark' ? 450 : 1150, near: 0 });
      scene.add(im); meshes.push(im);
    }
  }
  return meshes;
}

// ---------------------------------------------------------------- tree placement
function okLand(s, d, minE = 1) {
  const side = d >= 0 ? 1 : -1; const e = Math.abs(d) - hw(s, side);
  return e > minE;
}
function avoidCanal(s, d) { return !(d > 0 && s > CANAL.s0 - 10 && (Math.abs(d) - hwR(s)) > CANAL.towE0 - 2 && (Math.abs(d) - hwR(s)) < CANAL.canalE1 + 2); }

export function buildVegetation(scene, landmarks, progress) {
  makeMats();
  const M = VEG.mats;
  const r = mulberry32(777);
  const rr = (a, b) => a + (b - a) * r();
  const aoList = [];

  // ---------- hero trees (unique geometry, merged)
  const heroBark = new Map(), heroLeaves = [], heroBlossom = [];
  const addHero = (sp, s, d, opts = {}) => {
    const [x, z] = fromSD(s, d); const y = terrainH(s, d);
    const F = frame(s);
    const side = d >= 0 ? 1 : -1;
    const toRiver = new V3(-F.rx * side, 0, -F.rz * side);
    const leanDir = opts.leanRiver ? toRiver : new V3(Math.cos(r() * 6.28), 0, Math.sin(r() * 6.28));
    const t = genTree(sp, Math.floor(r() * 1e9), { leanDir, lean: opts.lean, scale: opts.scale || 1 });
    const T = new THREE.Matrix4().makeTranslation(x, y, z);
    t.bark.applyMatrix4(T); t.leaves.applyMatrix4(T);
    const bm = SP[sp].bark;
    if (!heroBark.has(bm)) heroBark.set(bm, []);
    heroBark.get(bm).push(t.bark);
    (sp === 'cherry' || sp === 'weeping' ? heroBlossom : heroLeaves).push(t.leaves);
    const cc = t.crown.clone().add(new V3(x, y, z));
    CANOPIES.push({ x: cc.x, y: cc.y, z: cc.z, r: t.crownR * 0.9 });
    if (sp === 'cherry' || sp === 'weeping') {
      for (let i = 0; i < t.crownPts.length; i += 3) CHERRY_SPAWN.push(t.crownPts[i].clone().add(new V3(x, y, z)));
    }
    aoList.push([x, z, Math.max(3, t.crownR * 1.1), 0.45]);
    VEG.hero.push({ sp, x, y, z, s, d, crown: cc, r: t.crownR });
    return t;
  };

  // West Potomac Park / Ohio Drive: cherry allee along the seawall
  for (let s = -260; s <= 360; s += rr(11, 16)) {
    if (s > 176 && s < 226) continue;
    const e = rr(7.2, 9.5); addHero('cherry', s, hwR(s) + e, { lean: rr(0.05, 0.3), leanRiver: r() < 0.5 });
    if (r() < 0.45) { const s2 = s + rr(3, 7); addHero('cherry', s2, hwR(s2) + rr(1.1, 1.6), { leanRiver: true, lean: rr(0.35, 0.55) }); }
    if (r() < 0.5) { const s3 = s + rr(-4, 4); addHero('cherry', s3, hwR(s3) + rr(13, 22), {}); }
  }
  progress(0.1);
  // Kennedy Center river terrace cherries
  for (let s = 380; s <= 545; s += rr(13, 18)) addHero('cherry', s, hwR(s) + rr(7, 9), { leanRiver: r() < 0.5 });
  // Georgetown Waterfront Park
  const gtCherries = [[788, 10.5], [800, 8.7, 1], [812, 12], [826, 9, 1], [838, 11], [892, 10.8], [904, 8.8, 1], [918, 12.2], [931, 9.1, 1], [944, 11.5], [958, 9.2], [800, 20], [830, 21], [906, 20.5], [938, 21.5], [955, 32]];
  for (const [s, e, over] of gtCherries) addHero('cherry', s, hwR(s) + e, { leanRiver: !!over, lean: over ? rr(0.35, 0.5) : undefined });
  addHero('weeping', 884, hwR(884) + 11.5, { scale: 1.05 });
  addHero('weeping', 968, hwR(968) + 19, { scale: 0.9 });
  addHero('redbud', 818, hwR(818) + 20); addHero('redbud', 925, hwR(925) + 20.5);
  // Thompson / Rock Creek: a few maples & cherries
  addHero('maple', 690, hwR(690) + 22); addHero('cherry', 760, hwR(760) + 14); addHero('maple', 770, hwR(770) + 24);
  // Virginia side Lady Bird Johnson Park
  for (let s = -300; s <= 150; s += rr(20, 34)) addHero('cherry', s, -(hwL(s) + rr(22, 30)), {});
  progress(0.25);

  // merge hero geometry
  for (const [list, mat] of [...[...heroBark].map(([bm, l]) => [l, M[bm]]), [heroLeaves, M.leaf], [heroBlossom, M.blossom]]) {
    // chunk for culling
    const ch = new Map();
    for (const g of list) { g.computeBoundingSphere(); const c = g.boundingSphere.center; const k = Math.floor(c.x / 150) + ',' + Math.floor(c.z / 150); if (!ch.has(k)) ch.set(k, []); ch.get(k).push(g); }
    for (const [, gs] of ch) {
      const g = merge(gs, ['aWind']);
      const m = new THREE.Mesh(g, mat); m.castShadow = true; m.receiveShadow = true; m.customDepthMaterial = mat.customDepthMaterial; scene.add(m);
    }
  }

  // ---------- instanced species variants
  const variants = [];
  const vIdx = {};
  const mk = (sp, n, scale = 1) => { vIdx[sp] = []; for (let i = 0; i < n; i++) { const t = genTree(sp, 1000 + variants.length * 37, { scale, lod: true }); t.sp = sp; if (sp === 'redbud') t.leafMat = M.blossom; vIdx[sp].push(variants.length); variants.push(t); } };
  mk('wood', 5); mk('oak', 3); mk('sycamore', 3); mk('birch', 3); mk('maple', 3); mk('redbud', 2); mk('cherry', 3); mk('bare', 2);
  const svc = []; for (let i = 0; i < 2; i++) { const t = genTree('cherry', 5000 + i * 11, { scale: 0.8, lod: true }); t.sp = 'cherry'; t.leafMat = M.blossom; t.white = true; svc.push(variants.length); variants.push(t); } vIdx.service = svc;
  progress(0.4);
  const places = [];
  const put = (sp, s, d, sc = 1, canopyReg = true) => {
    if (Math.abs(s - 990) < 20 && Math.abs(d) < 330) return; // under / beside the Key Bridge approaches
    if (d < 0 && s > 1590 && s < 1642 && -d - hwL(s) > -12 && -d - hwL(s) < 36) return; // the skipper's home, garden and stairs
    const [x, z] = fromSD(s, d); const y = terrainH(s, d);
    const vi = vIdx[sp][Math.floor(r() * vIdx[sp].length)];
    const v = variants[vi]; const rot = r() * 6.28; const S = sc * rr(0.72, 1.3);
    const k = rr(0.78, 1.08), hshift = rr(-1, 1);
    const tint = v.white ? [1.15, 1.2, 1.2] : [k * (1 + 0.1 * hshift), k * (1 + 0.02 * hshift), k * (1 - 0.14 * hshift)];
    places.push({ v: vi, x, y, z, rot, s: S, tint });
    if (canopyReg) {
      const c = v.crown.clone().multiplyScalar(S).applyAxisAngle(new V3(0, 1, 0), rot);
      CANOPIES.push({ x: x + c.x, y: y + c.y, z: z + c.z, r: v.crownR * S * 0.85 });
    }
    aoList.push([x, z, Math.max(3, v.crownR * S), 0.4]);
  };
  // upstream woodland, both banks
  const jitter = (s0, s1, e0, e1, spacing, fn) => {
    for (let s = s0; s < s1; s += spacing) for (let e = e0; e < e1; e += spacing * (e > 110 ? 2.3 : e > 50 ? 1.5 : 1)) {
      if (r() < 0.12) continue;
      fn(s + rr(-0.45, 0.45) * spacing, e + rr(-0.45, 0.45) * spacing);
    }
  };
  // right bank upstream (towpath side)
  jitter(1085, S1 - 40, 1.5, 13, 7.5, (s, e) => put(r() < 0.35 ? 'sycamore' : r() < 0.35 ? 'birch' : r() < 0.4 ? 'bare' : r() < 0.4 ? 'service' : 'maple', s, hwR(s) + e, 1, true));
  const woodPick = () => { const q = r(); return q < 0.34 ? 'wood' : q < 0.5 ? 'oak' : q < 0.62 ? 'bare' : q < 0.72 ? 'maple' : q < 0.8 ? 'sycamore' : q < 0.88 ? 'redbud' : q < 0.94 ? 'service' : 'birch'; };
  jitter(1085, S1 - 40, 42, 260, 8.5, (s, e) => { if (s > 1480 && s < 1610 && e < 60) return; put(woodPick(), s, hwR(s) + e); });
  // left bank upstream palisades
  jitter(1010, S1 - 40, 1.5, 260, 7.5, (s, e) => put(e < 10 ? (r() < 0.4 ? 'sycamore' : r() < 0.5 ? 'birch' : woodPick()) : woodPick(), s, -(hwL(s) + e)));
  progress(0.5);
  // Roosevelt Island forest
  for (let s = ISLAND.s - ISLAND.as; s < ISLAND.s + ISLAND.as; s += 7) for (let d = ISLAND.d - ISLAND.ad; d < ISLAND.d + ISLAND.ad; d += 7) {
    const ss = s + rr(-3, 3), dd = d + rr(-3, 3);
    const im = islandMask(ss, dd);
    if (im < 0.2 || r() < 0.1) continue;
    put(im < 0.35 ? (r() < 0.5 ? 'birch' : 'sycamore') : r() < 0.6 ? 'wood' : r() < 0.5 ? 'oak' : 'maple', ss, dd);
  }
  // Virginia shore behind the island & GW parkway parkland
  jitter(-500, 540, 20, 160, 16, (s, e) => put(r() < 0.3 ? 'oak' : r() < 0.5 ? 'wood' : 'maple', s, -(hwL(s) + e)));
  jitter(540, 860, 4, 200, 9, (s, e) => put(r() < 0.5 ? 'wood' : r() < 0.5 ? 'sycamore' : 'oak', s, -(hwL(s) + e)));
  // West Potomac Park lawns: scattered big trees behind the cherries
  jitter(-700, 170, 35, 250, 24, (s, e) => put(r() < 0.5 ? 'oak' : 'maple', s, hwR(s) + e));
  jitter(560, 680, 14, 60, 11, (s, e) => put(r() < 0.5 ? 'maple' : 'wood', s, hwR(s) + e));
  jitter(975, 1085, 25, 80, 12, (s, e) => put('wood', s, hwR(s) + e));
  // downstream reaches beyond start (visible behind camera)
  jitter(-880, -500, 18, 200, 14, (s, e) => put('wood', s, -(hwL(s) + e)));
  progress(0.6);
  const barkMatOf = (v) => M[SP[v.sp].bark];
  instGroups(scene, variants, places, { leafMat: M.leaf, barkMatOf, cast: false });
  VEG.variants = variants; VEG.places = places;

  // ---------- rocks
  buildRocks(scene, aoList);
  progress(0.75);
  // ---------- ground cover
  buildGroundCover(scene, landmarks);
  progress(0.9);
  bakeAO(aoList); clampAO();
}

// ---------------------------------------------------------------- rocks
export const ROCKS = [];
function rockGeo(seed, detail = 3) {
  const g = new THREE.IcosahedronGeometry(1, detail);
  const r = mulberry32(seed);
  const o = [r() * 10, r() * 10, r() * 10];
  const sq = [0.9 + r() * 0.5, 0.45 + r() * 0.3, 0.8 + r() * 0.5];
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const n = fbm3(x * 1.3 + o[0], y * 1.3 + o[1], z * 1.3 + o[2], 4);
    const n2 = vnoise3(x * 4 + o[1], y * 4, z * 4);
    let k = 0.75 + n * 0.55 + n2 * 0.08;
    // flatten facets (strata)
    x *= sq[0] * k; y *= sq[1] * k; z *= sq[2] * k;
    if (y < -0.15) y = -0.15 + (y + 0.15) * 0.3;
    p.setXYZ(i, x, y, z);
  }
  g.computeVertexNormals();
  const gg = g.index ? g.toNonIndexed() : g; gg.computeVertexNormals();
  // AO: crevice darkening by curvature proxy (low vertices darker)
  ensureColor(gg); shade(gg, (x, y) => 0.6 + 0.4 * clamp((y + 0.2) / 0.8, 0, 1));
  boxUV(gg, 0.5);
  return gg;
}
function buildRocks(scene, aoList) {
  const M = VEG.mats;
  const geos = [0, 1, 2, 3, 4, 5].map((i) => rockGeo(4200 + i * 13, 2)).concat([6, 7, 8].map((i) => rockGeo(4200 + i * 13, 1)));
  const r = mulberry32(31337);
  const rr = (a, b) => a + (b - a) * r();
  const pl = geos.map(() => []);
  const add = (x, y, z, sc, rot, gi = Math.floor(r() * geos.length), tiltX = 0) => {
    _q.setFromEuler(new THREE.Euler(tiltX, rot, rr(-0.15, 0.15)));
    _m4.compose(_p.set(x, y, z), _q, _s.set(sc * rr(0.8, 1.2), sc, sc * rr(0.8, 1.2)));
    pl[gi].push(_m4.clone());
  };
  // riprap banks
  for (const side of [1, -1]) {
    for (let s = S0 + 20; s < 1100; s += 2.3) {
      if (bankTypeAt(s, side) !== 'riprap') continue;
      for (let e = -2.5; e < 9; e += rr(1.4, 2.2)) {
        const ss = s + rr(-0.7, 0.7);
        const d = side * (hw(ss, side) + e);
        const y = terrainH(ss, d);
        const [x, z] = fromSD(ss, d);
        add(x, y - 0.15, z, rr(0.6, 1.1), r() * 6.28, 6 + Math.floor(r() * 3), rr(-0.3, 0.3));
      }
    }
  }
  // natural bank boulders upstream + Three Sisters
  const boulder = (s, d, sc, reg = true) => {
    const [x, z] = fromSD(s, d); const y = terrainH(s, d);
    add(x, y - sc * 0.25, z, sc, r() * 6.28);
    ROCKS.push({ s, d, x, z, r: sc * 1.1, top: y + sc * 0.5 });
    if (reg && y + sc * 0.5 > -1.2) addObstacle({ s, d, rs: sc * 1.05, rd: sc * 0.9, round: true, kind: 'rock', foam: y + sc * 0.5 > -0.3 ? 1 : 0.4 });
  };
  // Three Sisters
  for (const [s, d, sc] of [[1170, -24, 4.2], [1178, -31, 3.3], [1165, -34, 3.0], [1186, -22, 2.4], [1195, -36, 2.8], [1204, -28, 1.8], [1158, -20, 1.6]]) boulder(s, d, sc);
  // Three Sisters rise above water: ensure top above level
  // bank boulders
  for (let s = 1060; s < S1 - 60; s += rr(9, 22)) {
    for (const side of [1, -1]) {
      if (r() < 0.35) continue;
      const e = rr(-4, 3);
      boulder(s + rr(-3, 3), side * (hw(s, side) + e), rr(0.7, 2.0));
    }
  }
  // scattered mid-channel rocks (submerged/awash) upstream near banks
  for (let s = 1250; s < 1620; s += rr(30, 55)) { const side = r() < 0.5 ? 1 : -1; boulder(s, side * (hw(s, side) - rr(5, 14)), rr(1.0, 1.8)); }
  // Georgetown & Roosevelt edges: a few boulders in the marsh
  for (let i = 0; i < 18; i++) { const s = ISLAND.s + rr(-1, 1) * ISLAND.as * 0.9; const d = ISLAND.d + ISLAND.ad * (r() < 0.5 ? 1 : -1) * rr(0.95, 1.1); boulder(s, d, rr(0.5, 1.2), false); }
  // mossy boulders on the wooded slopes
  for (let i = 0; i < 160; i++) {
    const s = rr(1080, S1 - 80); const side = r() < 0.5 ? 1 : -1; const e = rr(4, 90);
    if (side > 0 && e > CANAL.towE0 - 2 && e < CANAL.canalE1 + 3) continue;
    const d = side * (hw(s, side) + e); const [x, z] = fromSD(s, d);
    add(x, terrainH(s, d) - 0.3, z, rr(0.6, 1.6), r() * 6.28);
    aoList.push([x, z, 2.5, 0.35]);
  }
  geos.forEach((g, i) => {
    if (!pl[i].length) return;
    // chunk by position
    const ch = new Map();
    for (const m of pl[i]) { const e = m.elements; const k = Math.floor(e[12] / 600) + ',' + Math.floor(e[14] / 600); if (!ch.has(k)) ch.set(k, []); ch.get(k).push(m); }
    for (const [, list] of ch) {
      const im = new THREE.InstancedMesh(g, M.rock, list.length);
      list.forEach((m, k) => im.setMatrixAt(k, m));
      im.computeBoundingSphere(); im.castShadow = i < 6; im.receiveShadow = true;
      if (i >= 6) { im.layers.set(LAYER.NOREFL); im.userData.maxDist = 420; VEG.far.push(im); }
      scene.add(im);
    }
  });
}

// ---------------------------------------------------------------- ground cover
function clumpGeo(tile, n, w, h, lean = 0.1) {
  const [u0, v0] = tileUV(tile);
  const pos = [], nrm = [], uv = [], wind = [], col = [], idx = [];
  for (let i = 0; i < n; i++) {
    const a = i / n * Math.PI + 0.3;
    const cx = Math.cos(a) * w / 2, cz = Math.sin(a) * w / 2;
    const b = pos.length / 3;
    const tl = Math.sin(a * 3) * lean;
    const pts = [[-cx, 0, -cz, u0, v0, 0], [cx, 0, cz, u0 + 0.25, v0, 0], [cx + tl, h, cz, u0 + 0.25, v0 + 0.5, 1], [-cx + tl, h, -cz, u0, v0 + 0.5, 1]];
    for (const [x, y, z, u, v, t] of pts) {
      pos.push(x, y, z); nrm.push(0, 1, 0); uv.push(u, v);
      wind.push(t * 0.6, i * 1.7, t * 0.3, 0.6);
      const k = 0.45 + 0.55 * t; col.push(k, k, k);
    }
    idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setAttribute('aWind', new THREE.Float32BufferAttribute(wind, 4)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  return g;
}
function shrubGeo(seed, tile, R0) {
  const r = mulberry32(seed);
  const pos = [], nrm = [], uv = [], wind = [], col = [], idx = [];
  const [u0, v0] = tileUV(tile);
  const n = 26;
  for (let i = 0; i < n; i++) {
    const dir = new V3(r() - 0.5, r() * 0.8, r() - 0.5).normalize();
    const c = dir.clone().multiplyScalar(R0 * (0.5 + 0.5 * r())).add(new V3(0, R0 * 0.7, 0));
    const size = R0 * (0.7 + 0.5 * r());
    const nn = new V3(r() - 0.5, r() - 0.5, r() - 0.5).normalize();
    const ax = new V3().crossVectors(nn, new V3(0, 1, 0)).normalize().multiplyScalar(size / 2);
    const ay = new V3().crossVectors(ax, nn).normalize().multiplyScalar(size / 2);
    const b = pos.length / 3;
    for (const [sx, sy, uu, vv] of [[-1, -1, u0, v0], [1, -1, u0 + 0.25, v0], [1, 1, u0 + 0.25, v0 + 0.5], [-1, 1, u0, v0 + 0.5]]) {
      const p = c.clone().addScaledVector(ax, sx).addScaledVector(ay, sy);
      pos.push(p.x, p.y, p.z); nrm.push(dir.x, dir.y + 0.3, dir.z); uv.push(uu, vv);
      wind.push(0.12 * (p.y / R0), i, 0.6, 0.8);
      const k = 0.55 + 0.45 * clamp(p.y / (R0 * 1.5), 0, 1); col.push(k, k, k);
    }
    idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setAttribute('aWind', new THREE.Float32BufferAttribute(wind, 4)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  return g;
}

function buildGroundCover(scene, landmarks) {
  const M = VEG.mats;
  const r = mulberry32(2468);
  const rr = (a, b) => a + (b - a) * r();
  const types = {
    grass: { g: clumpGeo(0, 3, 0.9, 0.55), mat: M.ground, list: [] },
    tallgrass: { g: clumpGeo(7, 3, 1.1, 0.95), mat: M.ground, list: [] },
    reeds: { g: clumpGeo(1, 4, 1.2, 1.9, 0.15), mat: M.ground, list: [] },
    cattail: { g: clumpGeo(6, 3, 1.0, 1.7), mat: M.ground, list: [] },
    fern: { g: clumpGeo(2, 3, 1.2, 0.8, 0.3), mat: M.ground, list: [] },
    bluebell: { g: clumpGeo(3, 3, 0.8, 0.5), mat: M.ground, list: [] },
    daffodil: { g: clumpGeo(4, 3, 0.8, 0.55), mat: M.ground, list: [] },
    whiteflower: { g: clumpGeo(5, 3, 0.8, 0.4), mat: M.ground, list: [] },
    azalea: { g: shrubGeo(11, 7, 0.75), mat: M.leaf, list: [] },
    shrub: { g: shrubGeo(12, 5, 0.9), mat: M.leaf, list: [] },
  };
  const put = (t, s, d, sc = 1, yOff = 0) => {
    const [x, z] = fromSD(s, d); const y = terrainH(s, d);
    _q.setFromAxisAngle(new V3(0, 1, 0), r() * 6.28); _m4.compose(_p.set(x, y + yOff - 0.03, z), _q, _s.setScalar(sc * rr(0.75, 1.3)));
    types[t].list.push(_m4.clone());
  };
  const isPath = (s, side, e) => {
    if (side > 0 && s > 772 && s < 972 && ((e < 7.8) || (e > 28 && e < 32) || Math.abs(e - 14) < 0.9 || Math.abs(e - 26) < 0.9)) return true;
    if (side > 0 && s < 560 && e > 1.3 && e < 5.5) return true;
    if (side > 0 && s > CANAL.s0 && e > CANAL.towE0 && e < CANAL.canalE1 + 1) return true;
    if (side < 0 && s < 1000 && e > 12.5 && e < 16.5) return true;
    if (side < 0 && s > 1596 && s < 1636 && e > -2 && e < 30) return true; // the skipper's home
    return false;
  };
  const vegStep = 1.25;
  for (const side of [1, -1]) {
    for (let s = -600; s < S1 - 100; s += vegStep) {
      const bt = bankTypeAt(s, side);
      const maxE = bt === 'wood' ? 26 : bt === 'seawall' ? 40 : 24;
      for (let e = -3; e < maxE; e += vegStep * (e > 15 ? 1.8 : 1)) {
        const ss = s + rr(-0.6, 0.6), ee = e + rr(-0.6, 0.6);
        const d = side * (hw(ss, side) + ee);
        if (isPath(ss, side, ee)) continue;
        if (side > 0 && ss > 690 && ss < 760 && ee < 50) continue; // Thompson lot
        if (side > 0 && ss > 380 && ss < 545 && ee > 8 && ee < 110) continue; // Kennedy podium
        if (side > 0 && ss > 175 && ss < 330 && ee > 70 && ee < 160) continue; // Lincoln
        if (side < 0 && ss > 780 && ss < 1010 && ee > 30) continue; // Rosslyn
        if (side > 0 && ss > 880 && ss < 1090 && ee > 36) continue; // Georgetown buildings
        const y = terrainH(ss, d);
        const n = fbm2(ss * 0.08, d * 0.08);
        const rnd = r();
        if (ee < 0.3) { // at / below waterline
          if (y > -0.35 && (bt === 'marsh' || bt === 'beach' || bt === 'wood' || bt === 'launch') && rnd < 0.5) put(rnd < 0.25 ? 'cattail' : 'reeds', ss, d, 1);
          continue;
        }
        if (bt === 'seawall') { if (ee < 1.0) continue; if (rnd < 0.28) put(n > 0.55 ? 'daffodil' : 'grass', ss, d); else if (rnd < 0.33) put('whiteflower', ss, d); continue; }
        if (bt === 'riprap') { if (ee < 8.5) { if (rnd < 0.08) put('tallgrass', ss, d); continue; } if (rnd < 0.35) put('grass', ss, d); continue; }
        if (bt === 'marsh') { if (ee < 5) { if (rnd < 0.7) put(rnd < 0.2 ? 'cattail' : 'reeds', ss, d); } else if (rnd < 0.35) put(rnd < 0.2 ? 'tallgrass' : 'fern', ss, d); continue; }
        if (bt === 'beach' || bt === 'launch') { if (ee > 4 && rnd < 0.25) put('tallgrass', ss, d); continue; }
        if (bt === 'wood') {
          if (ee < 2.5) { if (rnd < 0.35) put('reeds', ss, d, 0.8); continue; }
          if (rnd < 0.18) put(n > 0.5 ? 'bluebell' : 'fern', ss, d);
          else if (rnd < 0.26) put('tallgrass', ss, d);
          else if (rnd < 0.3) put('whiteflower', ss, d);
          continue;
        }
      }
    }
  }
  // Roosevelt island marsh ring
  for (let s = ISLAND.s - ISLAND.as - 5; s < ISLAND.s + ISLAND.as + 5; s += 1.2) for (let d = ISLAND.d - ISLAND.ad - 6; d < ISLAND.d + ISLAND.ad + 6; d += 1.2) {
    const ss = s + rr(-0.5, 0.5), dd = d + rr(-0.5, 0.5); const im = islandMask(ss, dd);
    if (im < -0.08 || im > 0.25) continue;
    const y = terrainH(ss, dd); if (y < -0.4) continue;
    if (r() < 0.55) put(r() < 0.3 ? 'cattail' : 'reeds', ss, dd, 1);
    else if (im > 0.12 && r() < 0.3) put('fern', ss, dd);
  }
  // planted beds in Georgetown & Kennedy: azaleas and shrubs along terrace walls
  for (let s = 780; s < 968; s += rr(2.2, 3.5)) {
    for (const e of [15.3, 16.6, 27.3]) { if (r() < 0.8) put(r() < 0.6 ? 'azalea' : 'shrub', s, hwR(s) + e + rr(-0.3, 0.3), rr(0.8, 1.15)); }
    if (r() < 0.6) put(r() < 0.5 ? 'daffodil' : 'whiteflower', s, hwR(s) + rr(17.5, 19));
  }
  for (let s = 385; s < 540; s += rr(3, 5)) put(r() < 0.5 ? 'azalea' : 'shrub', s, hwR(s) + rr(9.5, 10.5));
  // lawns: grass clumps in parks (sparser)
  for (let i = 0; i < 9000; i++) {
    const s = rr(-500, 1000); const side = r() < 0.65 ? 1 : -1; const e = Math.pow(r(), 1.6) * 70 + 6;
    const bt = bankTypeAt(s, side);
    if (bt === 'wood' || isPath(s, side, e)) continue;
    if (side > 0 && ((s > 380 && s < 545 && e > 8 && e < 110) || (s > 175 && s < 330 && e > 70 && e < 160) || (s > 690 && s < 760 && e < 50) || (s > 880 && e > 36))) continue;
    if (side < 0 && s > 780 && e > 30) continue;
    const d = side * (hw(s, side) + e);
    put(r() < 0.12 ? 'daffodil' : r() < 0.08 ? 'whiteflower' : 'grass', s, d);
  }
  for (const k in types) {
    const t = types[k]; if (!t.list.length) continue;
    const ch = new Map();
    for (const m of t.list) { const e = m.elements; const key = Math.floor(e[12] / 260) + ',' + Math.floor(e[14] / 260); if (!ch.has(key)) ch.set(key, []); ch.get(key).push(m); }
    for (const [, list] of ch) {
      const im = new THREE.InstancedMesh(t.g, t.mat, list.length);
      list.forEach((m, i) => im.setMatrixAt(i, m));
      im.computeBoundingSphere();
      im.castShadow = k === 'azalea' || k === 'shrub'; im.receiveShadow = true;
      im.layers.set(k === 'azalea' || k === 'shrub' || k === 'reeds' || k === 'cattail' ? 0 : LAYER.NOREFL);
      if (im.castShadow) im.customDepthMaterial = t.mat.customDepthMaterial;
      im.userData.maxDist = 300; VEG.far.push(im);
      scene.add(im);
    }
  }
}
