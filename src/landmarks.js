// Washington landmarks, bridges, waterfront structures, street furniture, skyline
import * as THREE from 'three';
import { frame, fromSD, hw, hwR, hwL, heightSD, bankTypeAt, bearingDir, CANAL, ISLAND, islandMask, S0, S1, toSD } from './world.js';
import { terrainH, groundAt, bakeAO } from './terrain.js';
import { M } from './mats.js';
import TEX from './tex.js';
import { box, rbox, cyl, sph, tf, boxUV, merge, tube, extrude, strip, shade, tint, ensureColor } from './geo.js';
import { addLight, addSolid, addObstacle, SOLID_FNS, sdPos, addWalkBlock } from './registry.js';
import { R, rng, clamp, lerp, smooth, mulberry32 } from './util.js';
import { LAYER } from './post.js';

export class Batch {
  constructor() { this.m = new Map(); }
  add(mat, g) { if (!this.m.has(mat)) this.m.set(mat, []); this.m.get(mat).push(g); return g; }
  flush(scene, { cast = true, receive = true, layer = 0, name = '' } = {}) {
    const out = [];
    for (const [mat, list] of this.m) {
      // split into chunks to keep culling effective
      const chunks = new Map();
      for (const g of list) {
        g.computeBoundingSphere();
        const c = g.boundingSphere.center; const key = Math.floor(c.x / 250) + ',' + Math.floor(c.z / 250);
        if (!chunks.has(key)) chunks.set(key, []); chunks.get(key).push(g);
      }
      for (const [, gs] of chunks) {
        const mg = merge(gs);
        const mesh = new THREE.Mesh(mg, mat);
        mesh.castShadow = cast; mesh.receiveShadow = receive; mesh.layers.set(layer); mesh.name = name;
        scene.add(mesh); out.push(mesh);
      }
    }
    this.m.clear();
    return out;
  }
}

// place a local geometry at (x,y,z) with yaw
function place(g, x, y, z, yaw = 0) { return tf(g, { x, y, z, ry: yaw }); }
function uvw(g, s = 0.25) { return boxUV(g, s); }
// ambient occlusion by height above a base (darker near ground)
function aoBase(g, y0, k = 0.45, h = 1.5) { return shade(g, (x, y) => 1 - k * clamp(1 - (y - y0) / h, 0, 1)); }

const E = new THREE.Vector3();
function eastDir() { const [x, z] = bearingDir(90); return [x, z]; }

// ============================================================ Memorial Bridge
function arcPts(cx, cy, R, a0, a1, n) { const p = []; for (let i = 0; i <= n; i++) { const a = a0 + (a1 - a0) * i / n; p.push([cx + Math.cos(a) * R, cy + Math.sin(a) * R]); } return p; }

function archBridge(B, { s, width, top, spring, rise, spans, pierW, noseL, dL, dR, mat, ringMat, abut = 16, balustrade = true, lamps = true, openSpandrel = false, name }) {
  const F = frame(s); const yaw = -F.th;
  const toW = (g) => tf(g, { x: F.x, z: F.z, ry: yaw });
  const total = dR - dL;
  const bay = total / spans;
  const clear = bay - pierW;
  const Rr = (clear * clear / 4 + rise * rise) / (2 * rise);
  const cyOff = spring + rise - Rr;
  const half = Math.asin(clear / 2 / Rr);
  const bottom = -9;
  // elevation contour with arch cut-outs (x = d)
  const shape = new THREE.Shape();
  const x0 = dL - abut, x1 = dR + abut;
  shape.moveTo(x0, bottom); shape.lineTo(x0, top); shape.lineTo(x1, top); shape.lineTo(x1, bottom);
  const piers = [];
  for (let i = spans - 1; i >= 0; i--) {
    const cx = dL + bay * (i + 0.5);
    const xr = cx + clear / 2, xl = cx - clear / 2;
    shape.lineTo(xr, bottom); shape.lineTo(xr, spring);
    const pts = arcPts(cx, cyOff, Rr, Math.PI / 2 - half, Math.PI / 2 + half, 28);
    for (const [px, py] of pts) shape.lineTo(px, py);
    shape.lineTo(xl, bottom);
    if (i > 0) piers.push(dL + bay * i);
  }
  shape.lineTo(x0, bottom);
  let g = extrude(shape, width, {});
  // local: x=d, y=up, z=along bridge width -> rotate so z aligns with river (s). Our frame: +x = right(d), -z = upstream.
  uvw(g, 0.25); aoBase(g, -0.5, 0.35, 3);
  B.add(mat, toW(g));
  // voussoir ring (projecting 0.18 m) with radial joints
  for (let i = 0; i < spans; i++) {
    const cx = dL + bay * (i + 0.5);
    const ring = new THREE.Shape();
    const outer = arcPts(cx, cyOff, Rr + 1.25, Math.PI / 2 - half * 1.02, Math.PI / 2 + half * 1.02, 28);
    const inner = arcPts(cx, cyOff, Rr, Math.PI / 2 + half, Math.PI / 2 - half, 28);
    outer.forEach(([x, y], k) => (k ? ring.lineTo(x, y) : ring.moveTo(x, y)));
    inner.forEach(([x, y]) => ring.lineTo(x, y));
    const rg = extrude(ring, width + 0.36, {});
    // radial uv: u = arc length, v = radius
    const p = rg.attributes.position; const uv = rg.attributes.uv;
    for (let k = 0; k < p.count; k++) { const dx = p.getX(k) - cx, dy = p.getY(k) - cyOff; const a = Math.atan2(dy, dx); uv.setXY(k, a * (Rr + 0.6) * 0.8 * 0.25, (Math.hypot(dx, dy) - Rr) * 0.25 + p.getZ(k) * 0.02); }
    B.add(ringMat, toW(rg));
    // keystone
    const ks = box(1.4, 1.8, width + 0.5, { x: cx, y: cyOff + Rr + 0.7 });
    uvw(ks, 0.25); B.add(ringMat, toW(ks));
  }
  // piers: cutwater noses both sides + pilasters
  const pierTop = spring + 1.2;
  for (const px of piers) {
    for (const sgn of [-1, 1]) {
      const tri = new THREE.Shape();
      tri.moveTo(-pierW / 2, 0); tri.lineTo(pierW / 2, 0); tri.lineTo(0.0, noseL); tri.lineTo(-pierW / 2, 0);
      const ng = new THREE.ExtrudeGeometry(tri, { depth: pierTop - bottom, bevelEnabled: false });
      ng.rotateX(-Math.PI / 2); // shape y -> -z; extrude z -> y
      tf(ng, { x: px, y: bottom, z: sgn > 0 ? -width / 2 : width / 2, ry: sgn > 0 ? 0 : Math.PI });
      uvw(ng, 0.25); aoBase(ng, -0.5, 0.3, 3);
      B.add(mat, toW(ng));
      // coping slab over the cutwater
      const cs = new THREE.Shape(); cs.moveTo(-pierW / 2 - 0.2, -0.2); cs.lineTo(pierW / 2 + 0.2, -0.2); cs.lineTo(0, noseL + 0.3); cs.lineTo(-pierW / 2 - 0.2, -0.2);
      const cg2 = new THREE.ExtrudeGeometry(cs, { depth: 0.4, bevelEnabled: false }); cg2.rotateX(-Math.PI / 2);
      tf(cg2, { x: px, y: pierTop, z: sgn > 0 ? -width / 2 : width / 2, ry: sgn > 0 ? 0 : Math.PI });
      uvw(cg2, 0.25); B.add(ringMat, toW(cg2));
      // pilaster rising on the spandrel face
      const pil = box(pierW * 0.7, top - pierTop - 0.8, 0.5, { x: px, y: (top + pierTop) / 2 - 0.4, z: sgn * (width / 2 + 0.25) });
      uvw(pil, 0.25); B.add(ringMat, toW(pil));
      const roundel = cyl(1.0, 1.0, 0.25, 24, { x: px, y: top - 3.2, z: sgn * (width / 2 + 0.55), rx: Math.PI / 2 });
      uvw(roundel, 0.25); B.add(ringMat, toW(roundel));
    }
    addObstacle({ s, d: px, rs: width / 2 + noseL, rd: pierW / 2, kind: 'pier' });
  }
  // cornice & string course
  for (const sgn of [-1, 1]) {
    const c1 = box(x1 - x0, 0.45, 0.6, { x: (x0 + x1) / 2, y: top - 0.55, z: sgn * (width / 2 + 0.15) }); uvw(c1, 0.25); B.add(ringMat, toW(c1));
    const c2 = box(x1 - x0, 0.25, 0.35, { x: (x0 + x1) / 2, y: top - 1.05, z: sgn * (width / 2 + 0.05) }); uvw(c2, 0.25); B.add(ringMat, toW(c2));
  }
  // deck: road + sidewalks
  const road = box(x1 - x0, 0.1, width - 5, { x: (x0 + x1) / 2, y: top + 0.05 }); uvw(road, 0.1); B.add(M.asphalt, toW(road));
  for (const sgn of [-1, 1]) {
    const sw = box(x1 - x0, 0.25, 2.3, { x: (x0 + x1) / 2, y: top + 0.12, z: sgn * (width / 2 - 1.15) }); uvw(sw, 0.25); B.add(M.paving, toW(sw));
  }
  // balustrade
  if (balustrade) {
    const bal = [];
    for (const sgn of [-1, 1]) {
      const z = sgn * (width / 2 - 0.25);
      bal.push(box(x1 - x0, 0.28, 0.5, { x: (x0 + x1) / 2, y: top + 0.39, z }));
      bal.push(box(x1 - x0, 0.2, 0.55, { x: (x0 + x1) / 2, y: top + 1.25, z }));
      for (let x = x0 + 0.4; x < x1 - 0.3; x += 0.42) {
        if (((x - x0) % 7.5) < 0.6) { bal.push(box(0.7, 0.85, 0.6, { x, y: top + 0.95, z })); continue; }
        const lp = new THREE.LatheGeometry([new THREE.Vector2(0.09, 0), new THREE.Vector2(0.11, 0.08), new THREE.Vector2(0.07, 0.2), new THREE.Vector2(0.13, 0.42), new THREE.Vector2(0.07, 0.62), new THREE.Vector2(0.1, 0.72)], 6);
        bal.push(tf(lp, { x, y: top + 0.53, z }));
      }
    }
    const bg = merge(bal); uvw(bg, 0.25); B.add(ringMat, toW(bg));
  }
  if (lamps) {
    for (const sgn of [-1, 1]) for (let x = x0 + 18; x < x1 - 10; x += 30) {
      const lp = [];
      lp.push(cyl(0.3, 0.38, 0.9, 12, { x, y: top + 0.7, z: sgn * (width / 2 - 0.9) }));
      lp.push(cyl(0.09, 0.14, 4.4, 10, { x, y: top + 3.3, z: sgn * (width / 2 - 0.9) }));
      lp.push(cyl(0.22, 0.12, 0.35, 10, { x, y: top + 5.6, z: sgn * (width / 2 - 0.9) }));
      const lg = merge(lp); B.add(M.metalDark, toW(lg));
      const globe = sph(0.32, 12, 8, { x, y: top + 6.05, z: sgn * (width / 2 - 0.9) });
      B.add(M.lampGlowWarm, toW(globe));
      const wp = new THREE.Vector3(x, top + 6.05, sgn * (width / 2 - 0.9)).applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw).add(new THREE.Vector3(F.x, 0, F.z));
      addLight(wp, 0xffcf8a, 28, 3.0, { kind: 'lamp' });
    }
  }
  // camera solid function in bridge local coords
  const cosY = Math.cos(yaw), sinY = Math.sin(yaw);
  SOLID_FNS.push((X, Y, Z, pad) => {
    const dx = X - F.x, dz = Z - F.z;
    const lx = dx * cosY - dz * sinY, lz = dx * sinY + dz * cosY;
    if (Math.abs(lz) > width / 2 + noseL + pad + 1) return false;
    if (lx < x0 - pad || lx > x1 + pad) return false;
    if (Y > top + 2.5 + pad) return false;
    // in an arch opening?
    const bi = Math.floor((lx - dL) / bay);
    if (lx < dL || lx > dR) return Y < top + 2.5 + pad;
    const cx = dL + bay * (bi + 0.5);
    const ox = lx - cx;
    if (Math.abs(ox) > clear / 2 - pad) return Math.abs(lz) < width / 2 + noseL + pad;
    if (Math.abs(lz) > width / 2 + pad) return false;
    const yi = cyOff + Math.sqrt(Math.max(0, Rr * Rr - ox * ox));
    return Y > yi - pad;
  });
  return { F, yaw, x0, x1, dL, dR, bay, clear, spans, piers, top, intrados: (d) => { const bi = Math.floor((d - dL) / bay); const ox = d - (dL + bay * (bi + 0.5)); return cyOff + Math.sqrt(Math.max(0, Rr * Rr - ox * ox)); } };
}

// ============================================================ Key Bridge (open spandrel concrete arches)
function keyBridge(B) {
  const s = 990; const F = frame(s); const yaw = -F.th;
  const toW = (g) => tf(g, { x: F.x, z: F.z, ry: yaw });
  const dL = -hwL(s) - 2, dR = hwR(s) + 2;
  const spans = 5, pierW = 7, width = 22, spring = 2.2, rise = 10.5, deckB = 15.4, top = 16.4;
  const total = dR - dL, bay = total / spans, clear = bay - pierW;
  const Rr = (clear * clear / 4 + rise * rise) / (2 * rise), cyOff = spring + rise - Rr, half = Math.asin(clear / 2 / Rr);
  const ringT = 1.6;
  const x0 = dL - 112, x1 = dR + 94; // the deck runs on over the waterfront until it meets the bluffs
  const bottom = -8;
  // deck slab + fascia
  const deck = box(x1 - x0, top - deckB, width, { x: (x0 + x1) / 2, y: (top + deckB) / 2 }); uvw(deck, 0.2); B.add(M.concrete, toW(deck));
  for (const sgn of [-1, 1]) {
    const f = box(x1 - x0, 0.5, 0.4, { x: (x0 + x1) / 2, y: deckB + 0.1, z: sgn * (width / 2 + 0.2) }); uvw(f, 0.2); B.add(M.concrete, toW(f));
    // parapet with openings
    const par = box(x1 - x0, 1.05, 0.35, { x: (x0 + x1) / 2, y: top + 0.52, z: sgn * (width / 2 - 0.2) }); uvw(par, 0.2); B.add(M.concrete, toW(par));
    // railing on parapet
    const rail = cyl(0.05, 0.05, x1 - x0, 6, { x: (x0 + x1) / 2, y: top + 1.25, z: sgn * (width / 2 - 0.2), rz: Math.PI / 2 }); B.add(M.metalDark, toW(rail));
  }
  const road = box(x1 - x0, 0.06, width - 5, { x: (x0 + x1) / 2, y: top + 0.03 }); uvw(road, 0.1); B.add(M.asphalt, toW(road));
  const piers = [];
  for (let i = 0; i < spans; i++) {
    const cx = dL + bay * (i + 0.5);
    // arch ring (two ribs spanning the whole width)
    const ring = new THREE.Shape();
    const outer = arcPts(cx, cyOff, Rr + ringT, Math.PI / 2 - half * 1.04, Math.PI / 2 + half * 1.04, 32);
    const inner = arcPts(cx, cyOff, Rr, Math.PI / 2 + half, Math.PI / 2 - half, 32);
    outer.forEach(([x, y], k) => (k ? ring.lineTo(x, y) : ring.moveTo(x, y)));
    inner.forEach(([x, y]) => ring.lineTo(x, y));
    const rg = extrude(ring, width, {}); uvw(rg, 0.2); B.add(M.concrete, toW(rg));
    // open spandrel: small arches carried on spandrel walls at each face + interior walls
    const nSm = 4;
    for (const side of [-1, 1]) {
      for (let k = 0; k < nSm; k++) {
        const xa = cx + side * (clear / 2) * (0.18 + k * 0.2);
        const oy = cyOff + Math.sqrt(Math.max(0, (Rr + ringT) ** 2 - (xa - cx) ** 2));
        if (oy > deckB - 1.2) continue;
        const colH = deckB - oy;
        for (const zz of [-width / 2 + 0.6, -width / 6, width / 6, width / 2 - 0.6]) {
          const c = box(0.9, colH, 1.1, { x: xa, y: oy + colH / 2, z: zz }); uvw(c, 0.2); B.add(M.concrete, toW(c));
        }
      }
      // small arched spandrel face walls between columns
      const sh = new THREE.Shape();
      const xa0 = cx + side * clear * 0.06, xa1 = cx + side * clear * 0.5;
      const lo = Math.min(xa0, xa1), hi = Math.max(xa0, xa1);
      sh.moveTo(lo, deckB); sh.lineTo(hi, deckB); sh.lineTo(hi, deckB - 1.6); sh.lineTo(lo, deckB - 1.6);
      const sg = extrude(sh, width, {}); uvw(sg, 0.2); B.add(M.concrete, toW(sg));
    }
    if (i > 0) piers.push(dL + bay * i);
  }
  // crown connection: the arch crown meets the deck
  // piers with cutwaters, rising to deck as solid pylons
  for (const px of piers) {
    const p = box(pierW, deckB - bottom, width - 2, { x: px, y: (deckB + bottom) / 2 }); uvw(p, 0.2); aoBase(p, -0.3, 0.3, 3); B.add(M.concrete, toW(p));
    for (const sgn of [-1, 1]) {
      const tri = new THREE.Shape(); tri.moveTo(-pierW / 2, 0); tri.lineTo(pierW / 2, 0); tri.lineTo(0, 5.5); tri.lineTo(-pierW / 2, 0);
      const ng = new THREE.ExtrudeGeometry(tri, { depth: 5.5 - bottom, bevelEnabled: false });
      ng.rotateX(-Math.PI / 2);
      tf(ng, { x: px, y: bottom, z: sgn * ((width - 2) / 2), ry: sgn > 0 ? Math.PI : 0 });
      uvw(ng, 0.2); B.add(M.concrete, toW(ng));
      // pylon ornament: recessed panel
      const pn = box(pierW * 0.6, deckB - spring - 3, 0.3, { x: px, y: (deckB + spring) / 2 + 1, z: sgn * ((width - 2) / 2 + 0.15) }); uvw(pn, 0.2); B.add(M.concrete, toW(pn));
    }
    addObstacle({ s, d: px, rs: (width - 2) / 2 + 5.5, rd: pierW / 2, kind: 'pier' });
  }
  // approach spans on land: pairs of columns every ~22 m under the deck, a shore abutment at each bank,
  // and a solid abutment where the deck meets the bluff; the road then carries on at street level
  for (const [a, b, dir] of [[dL + 1, x0, -1], [dR - 1, x1, 1]]) {
    // shore abutment
    const sa = box(9, deckB - bottom, width - 3, { x: a + dir * 3.5, y: (deckB + bottom) / 2 }); uvw(sa, 0.2); aoBase(sa, 2.5, 0.3, 3); B.add(M.concrete, toW(sa));
    for (let x = a + dir * 24; dir * (b - x) > 14; x += dir * 22) {
      const gy = terrainH(s, x) - 1.0;
      const hgt = deckB - gy;
      const col = [];
      for (const zz of [-(width / 2 - 3.2), 0, width / 2 - 3.2]) col.push(rbox(1.5, hgt, 1.5, 0.15, { x, y: gy + hgt / 2, z: zz }));
      col.push(box(2.2, 1.4, width - 1.5, { x, y: deckB - 0.7 }));
      const cg = merge(col); uvw(cg, 0.2); aoBase(cg, gy + 1, 0.35, 2.5); B.add(M.concrete, toW(cg));
    }
    // landing abutment into the bluff
    const gl = terrainH(s, b) - 4;
    const la = box(12, deckB - gl, width - 1, { x: b - dir * 4, y: (deckB + gl) / 2 }); uvw(la, 0.2); B.add(M.concrete, toW(la));
    // street continuing inland on the ground
    const road = [], edgeL = [], edgeR = [];
    for (let k = 0; k <= 16; k++) {
      const x = b + dir * (k * 5 - 2); const y = Math.max(terrainH(s, x), terrainH(s + width / 2, x), terrainH(s - width / 2, x)) + 0.06;
      road.push(x, y);
    }
    const pts = [];
    for (let k = 0; k < road.length; k += 2) pts.push([road[k], road[k + 1]]);
    const ra = pts.map(([x, y]) => new THREE.Vector3(x, Math.max(y, k0(x)), -(width - 5) / 2)), rb = pts.map(([x, y]) => new THREE.Vector3(x, Math.max(y, k0(x)), (width - 5) / 2));
    function k0(x) { return Math.abs(x - b) < 3 ? top + 0.03 : -99; }
    const rs = dir > 0 ? strip(rb, ra) : strip(ra, rb); uvw(rs, 0.1); B.add(M.asphalt, toW(rs));
    for (const zz of [-(width / 2 - 1.2), width / 2 - 1.2]) {
      const sa2 = pts.map(([x, y]) => new THREE.Vector3(x, Math.max(y, k0(x)) + 0.12, zz - 1.1)), sb2 = pts.map(([x, y]) => new THREE.Vector3(x, Math.max(y, k0(x)) + 0.12, zz + 1.1));
      const sw = dir > 0 ? strip(sb2, sa2) : strip(sa2, sb2); uvw(sw, 0.25); B.add(M.paving, toW(sw));
    }
  }
  // lamps along the bridge
  for (const sgn of [-1, 1]) for (let x = x0 + 12; x < x1 - 8; x += 28) {
    const g = merge([cyl(0.08, 0.13, 7, 8, { x, y: top + 3.5, z: sgn * (width / 2 - 0.6) }), box(0.12, 0.12, 1.6, { x, y: top + 7, z: sgn * (width / 2 - 1.3) })]);
    B.add(M.metalDark, toW(g));
    B.add(M.lampGlow, toW(box(0.35, 0.08, 0.6, { x, y: top + 6.92, z: sgn * (width / 2 - 2.0) })));
    const wp = new THREE.Vector3(x, top + 6.9, sgn * (width / 2 - 2)).applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw).add(new THREE.Vector3(F.x, 0, F.z));
    addLight(wp, 0xfff0d8, 26, 2.5, { kind: 'lamp' });
  }
  const cosY = Math.cos(yaw), sinY = Math.sin(yaw);
  SOLID_FNS.push((X, Y, Z, pad) => {
    const dx = X - F.x, dz = Z - F.z;
    const lx = dx * cosY - dz * sinY, lz = dx * sinY + dz * cosY;
    if (Math.abs(lz) > width / 2 + 6 + pad) return false;
    if (lx < x0 - pad || lx > x1 + pad || Y > top + 2 + pad) return false;
    if (lx < dL || lx > dR) return true;
    const bi = Math.floor((lx - dL) / bay); const cx = dL + bay * (bi + 0.5); const ox = lx - cx;
    if (Math.abs(ox) > clear / 2 - pad) return true;
    if (Math.abs(lz) > width / 2 + pad) return false;
    return Y > cyOff + Math.sqrt(Math.max(0, Rr * Rr - ox * ox)) - pad;
  });
  return { s, piers, dL, dR, bay, clear };
}

// ============================================================ Lincoln Memorial
function flutedColumn(h, r0, r1, flutes = 20, seg = 60, rows = 10) {
  const pos = [], idx = [];
  for (let j = 0; j <= rows; j++) {
    const t = j / rows; const y = t * h;
    const ent = 1 + 0.018 * Math.sin(t * Math.PI * 0.8);
    const R = lerp(r0, r1, t) * ent;
    for (let i = 0; i <= seg; i++) {
      const a = i / seg * Math.PI * 2;
      const f = 1 - 0.035 * Math.pow(Math.abs(Math.sin(a * flutes / 2)), 0.7);
      pos.push(Math.cos(a) * R * f, y, Math.sin(a) * R * f);
    }
  }
  for (let j = 0; j < rows; j++) for (let i = 0; i < seg; i++) { const a = j * (seg + 1) + i, b = a + seg + 1; idx.push(a, b, a + 1, a + 1, b, b + 1); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
  return g;
}
function lincoln(B, scene) {
  const s = 250, e = 118;
  const d = hwR(s) + e; const [x, z] = fromSD(s, d);
  const [ex, ez] = eastDir();
  const yaw = Math.atan2(ex, ez); // local +Z -> east
  const g0 = Math.max(heightSD(s, d), 2.2);
  const parts = [], marble = [];
  const L = 57.8, Wd = 36.1;
  // terrace podium with retaining walls
  const podH = 3.2;
  parts.push(box(L + 30, podH, Wd + 26, { y: g0 + podH / 2 - 0.2 }));
  parts.push(box(L + 31, 0.35, Wd + 27, { y: g0 + podH + 0.02 }));
  // broad east steps from ground to podium and stylobate
  for (let i = 0; i < 12; i++) {
    const yy = g0 + i * (podH / 12);
    parts.push(box(46, podH / 12, 2.2, { y: yy + podH / 24, z: (Wd + 26) / 2 + 1.1 + (11 - i) * 1.1 }));
  }
  // cheek walls of the steps
  for (const sx of [-1, 1]) parts.push(box(3, podH + 0.4, 14.5, { x: sx * 24.5, y: g0 + podH / 2, z: (Wd + 26) / 2 + 7 }));
  const base = g0 + podH;
  // stylobate: three steps
  for (let i = 0; i < 3; i++) marble.push(box(L + 6 - i * 2, 0.5, Wd + 6 - i * 2, { y: base + 0.25 + i * 0.5 }));
  // front steps up the stylobate
  for (let i = 0; i < 8; i++) marble.push(box(24, 0.19, 0.5, { y: base + 0.1 + i * 0.19, z: (Wd + 6) / 2 + 3.6 - i * 0.45 }));
  const sty = base + 1.5;
  // cella
  marble.push(box(L - 12, 17.5, Wd - 12, { y: sty + 8.75 }));
  // columns
  const colH = 13.4, cr = 1.13;
  const colG = flutedColumn(colH - 1.1, cr, cr * 0.8);
  const capG = merge([new THREE.LatheGeometry([new THREE.Vector2(cr * 0.8, 0), new THREE.Vector2(cr * 0.82, 0.12), new THREE.Vector2(cr * 1.12, 0.52), new THREE.Vector2(cr * 1.14, 0.6), new THREE.Vector2(0, 0.6)], 32), box(cr * 2.5, 0.5, cr * 2.5, { y: 0.85 })]);
  const cols = [];
  const nx = 12, nz = 8;
  const sx = (L - 3.2) / (nx - 1), sz = (Wd - 3.2) / (nz - 1);
  for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
    if (i !== 0 && i !== nx - 1 && j !== 0 && j !== nz - 1) continue;
    const cx = -L / 2 + 1.6 + i * sx, cz = -Wd / 2 + 1.6 + j * sz;
    cols.push(tf(colG.clone(), { x: cx, y: sty, z: cz }));
    cols.push(tf(capG.clone(), { x: cx, y: sty + colH - 1.1, z: cz }));
  }
  // entablature
  const ent = sty + colH;
  marble.push(box(L + 0.6, 1.8, Wd + 0.6, { y: ent + 0.9 })); // architrave
  marble.push(box(L + 0.9, 0.35, Wd + 0.9, { y: ent + 1.95 }));
  marble.push(box(L + 0.6, 2.2, Wd + 0.6, { y: ent + 3.2 })); // frieze
  for (let i = 0; i < 36; i++) { // wreath roundels on frieze (no lettering)
    const t = i / 36; const per = 2 * (L + Wd); let q = t * per; let px, pz, ry;
    if (q < L) { px = -L / 2 + q; pz = Wd / 2 + 0.35; ry = 0; } else if ((q -= L) < Wd) { px = L / 2 + 0.35; pz = Wd / 2 - q; ry = Math.PI / 2; } else if ((q -= Wd) < L) { px = L / 2 - q; pz = -Wd / 2 - 0.35; ry = 0; } else { q -= L; px = -L / 2 - 0.35; pz = -Wd / 2 + q; ry = Math.PI / 2; }
    marble.push(tf(new THREE.TorusGeometry(0.55, 0.16, 6, 16), { x: px, y: ent + 3.2, z: pz, ry }));
  }
  marble.push(box(L + 2.2, 0.7, Wd + 2.2, { y: ent + 4.65 })); // cornice
  marble.push(box(L + 1.4, 0.3, Wd + 1.4, { y: ent + 4.15 }));
  // attic
  const at = ent + 5.0;
  marble.push(box(L - 5, 5.0, Wd - 5, { y: at + 2.5 }));
  marble.push(box(L - 4, 0.6, Wd - 4, { y: at + 5.2 }));
  marble.push(box(L - 5.6, 0.4, Wd - 5.6, { y: at + 0.2 }));
  // festoon garlands on attic (abstract relief)
  for (let i = 0; i < 28; i++) {
    const t = i / 28; const per = 2 * (L - 5 + Wd - 5); let q = t * per; let px, pz, ry;
    const LL = L - 5, WW = Wd - 5;
    if (q < LL) { px = -LL / 2 + q; pz = WW / 2 + 0.2; ry = 0; } else if ((q -= LL) < WW) { px = LL / 2 + 0.2; pz = WW / 2 - q; ry = Math.PI / 2; } else if ((q -= WW) < LL) { px = LL / 2 - q; pz = -WW / 2 - 0.2; ry = 0; } else { q -= LL; px = -LL / 2 - 0.2; pz = -WW / 2 + q; ry = Math.PI / 2; }
    marble.push(tf(new THREE.TorusGeometry(0.9, 0.18, 6, 12, Math.PI), { x: px, y: at + 3.4, z: pz, ry, rz: Math.PI }));
  }
  const toW = (g) => place(g, x, 0, z, yaw);
  const pg = merge(parts); uvw(pg, 0.25); aoBase(pg, g0, 0.3, 1.2); B.add(M.graniteFlood, toW(pg));
  const mg = merge([...marble, ...cols]); uvw(mg, 0.25);
  shade(mg, (X, Y) => 0.92 + 0.08 * clamp((Y - sty) / 20, 0, 1));
  B.add(M.marble, toW(mg));
  // interior warm glow (front opening)
  const glowP = box(20, 12, 0.2, { y: sty + 7, z: (Wd - 12) / 2 + 0.12 });
  B.add(M.glassWarm, toW(glowP));
  addSolid(x, g0 + 15, z, (L + 32) / 2, 16, (Wd + 40) / 2, yaw);
  // floodlights at base
  for (const [lx, lz] of [[-30, 26], [30, 26], [-30, -26], [30, -26]]) {
    const wp = new THREE.Vector3(lx, g0 + 4, lz).applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw).add(new THREE.Vector3(x, 0, z));
    addLight(wp, 0xffe2b8, 40, 2.0, { kind: 'flood' });
  }
  return { x, z, yaw, g0 };
}

// ============================================================ Washington Monument
function washMonument(B, lin) {
  const [ex, ez] = eastDir();
  const x = lin.x + ex * 950, z = lin.z + ez * 950;
  const base = 5.95;
  const H = 128, b0 = 12.8, b1 = 8.4, shaftH = H * 0.9;
  const g = [];
  // shaft with slight taper, built from courses for masonry look
  const sh = new THREE.CylinderGeometry(b1 / Math.SQRT2, b0 / Math.SQRT2, shaftH, 4, 24, true);
  sh.rotateY(Math.PI / 4); sh.translate(0, shaftH / 2, 0);
  g.push(sh);
  const py = new THREE.ConeGeometry(b1 / Math.SQRT2, H - shaftH, 4, 1); py.rotateY(Math.PI / 4); py.translate(0, shaftH + (H - shaftH) / 2, 0); g.push(py);
  const mg = merge(g); mg.computeVertexNormals();
  boxUV(mg, 0.12);
  // subtle colour change a third of the way up
  shade(mg, (X, Y) => (Y < 46 ? 0.97 : 1.0));
  tint(mg, 1, 1, 1);
  const cg = mg.attributes.color; const pp = mg.attributes.position;
  for (let i = 0; i < pp.count; i++) if (pp.getY(i) >= 46) cg.setXYZ(i, cg.getX(i) * 1.02, cg.getY(i) * 0.99, cg.getZ(i) * 0.95);
  B.add(M.obelisk, place(mg, x, base, z, 0));
  // grassy mound + plaza ring
  const mound = new THREE.CylinderGeometry(40, 90, 6, 48, 1); mound.translate(0, 3 - 0.3, 0);
  B.add(M.granite, place(boxUV(merge([cyl(15, 16, 0.6, 32, { y: 6.1 })]), 0.25), x, base - 0.3, z));
  boxUV(mound, 0.2);
  // flag poles ring (no flags)
  const poles = [];
  for (let i = 0; i < 50; i++) { const a = i / 50 * Math.PI * 2; poles.push(cyl(0.08, 0.1, 9, 6, { x: Math.cos(a) * 28, y: 4.5 + 6, z: Math.sin(a) * 28 })); }
  B.add(M.alu, place(merge(poles), x, base, z));
  const beacons = [];
  for (const [bx, bz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) beacons.push(sph(0.5, 8, 6, { x: bx * 3.6, y: shaftH - 1.5, z: bz * 3.6 }));
  const bm = new THREE.Mesh(place(merge(beacons), x, base, z), M.redBeacon);
  return { x, z, base, H, mound, beaconMesh: bm, shaftH };
}

// ============================================================ Kennedy Center
function kennedy(B) {
  const s = 470, e = 62;
  const d = hwR(s) + e; const [x, z] = fromSD(s, d); const F = frame(s);
  const yaw = -F.th - Math.PI / 2; // local +Z faces the river
  const g0 = Math.max(heightSD(s, d), 2.3);
  const L = 150, Wd = 68, H0 = g0 + 2.4, H1 = H0 + 19, over = 6.5;
  const mar = [], gold = [], dark = [], glass = [], warm = [], pav = [];
  pav.push(box(L + 24, 2.4, Wd + 30, { y: g0 + 1.2 - 0.3 }));
  // steps down to river terrace
  for (let i = 0; i < 8; i++) pav.push(box(60, 0.3, 0.9, { y: g0 + 0.15 + i * 0.3 - 0.3, z: (Wd + 30) / 2 + 0.45 + (7 - i) * 0.9 }));
  // main box with marble panels
  mar.push(box(L, H1 - H0, Wd, { y: (H0 + H1) / 2 }));
  // river façade: tall glazed foyer with marble piers
  const nb = 30;
  for (let i = 0; i < nb; i++) {
    const px = -L / 2 + (i + 0.5) * (L / nb);
    if (i > 2 && i < nb - 3) { glass.push(box(L / nb - 1.2, H1 - H0 - 2, 0.2, { x: px, y: (H0 + H1) / 2 - 0.5, z: Wd / 2 + 0.02 })); warm.push(box(L / nb - 1.4, H1 - H0 - 2.4, 0.1, { x: px, y: (H0 + H1) / 2 - 0.5, z: Wd / 2 - 0.3 })); }
    // mullion bands
    dark.push(box(0.12, H1 - H0 - 2, 0.3, { x: px - (L / nb) / 2 + 0.6, y: (H0 + H1) / 2 - 0.5, z: Wd / 2 + 0.1 }));
  }
  for (let k = 0; k < 4; k++) dark.push(box(L - 10, 0.12, 0.3, { y: H0 + 4 + k * 4.2, z: Wd / 2 + 0.12 }));
  // slender gilded columns around the perimeter
  const colSp = 5.0;
  for (let xx = -L / 2 - over + 1.2; xx <= L / 2 + over - 1.2; xx += colSp) for (const zz of [-Wd / 2 - over + 1.2, Wd / 2 + over - 1.2]) gold.push(box(0.9, H1 - H0, 1.3, { x: xx, y: (H0 + H1) / 2, z: zz }));
  for (let zz = -Wd / 2 - over + 1.2 + colSp; zz < Wd / 2 + over - 1.2; zz += colSp) for (const xx of [-L / 2 - over + 1.2, L / 2 + over - 1.2]) gold.push(box(1.3, H1 - H0, 0.9, { x: xx, y: (H0 + H1) / 2, z: zz }));
  // deep roof slab with fascia
  mar.push(box(L + over * 2 + 2, 1.6, Wd + over * 2 + 2, { y: H1 + 0.8 }));
  mar.push(box(L + over * 2 + 2.4, 0.3, Wd + over * 2 + 2.4, { y: H1 + 1.75 }));
  // rooftop terrace: pavilion + railing
  mar.push(box(L * 0.6, 4.5, Wd * 0.5, { y: H1 + 1.9 + 2.25 }));
  glass.push(box(L * 0.6 + 0.1, 2.6, Wd * 0.5 + 0.1, { y: H1 + 1.9 + 2.0 }));
  const rw = L + over * 2 - 1, rd = Wd + over * 2 - 1;
  for (let xx = -rw / 2; xx <= rw / 2; xx += 2.0) for (const zz of [-rd / 2, rd / 2]) dark.push(box(0.06, 1.05, 0.06, { x: xx, y: H1 + 2.4, z: zz }));
  for (let zz = -rd / 2; zz <= rd / 2; zz += 2.0) for (const xx of [-rw / 2, rw / 2]) dark.push(box(0.06, 1.05, 0.06, { x: xx, y: H1 + 2.4, z: zz }));
  for (const zz of [-rd / 2, rd / 2]) dark.push(box(rw, 0.08, 0.1, { y: H1 + 2.95, z: zz }));
  for (const xx of [-rw / 2, rw / 2]) dark.push(box(0.1, 0.08, rd, { x: xx, y: H1 + 2.95 }));
  const toW = (g) => place(g, x, 0, z, yaw);
  const mg = merge(mar); uvw(mg, 0.2); aoBase(mg, H0, 0.25, 2); B.add(M.marbleK, toW(mg));
  const gg = merge(gold); uvw(gg, 0.5); aoBase(gg, H0, 0.3, 2); B.add(M.metalBronze, toW(gg));
  B.add(M.metalDark, toW(merge(dark)));
  B.add(M.glassDark, toW(merge(glass)));
  B.add(M.glassWarm, toW(merge(warm)));
  const pg = merge(pav); uvw(pg, 0.25); B.add(M.paving, toW(pg));
  addSolid(x, (H1 + g0) / 2 + 2, z, (L + over * 2 + 4) / 2, (H1 - g0) / 2 + 6, (Wd + over * 2 + 4) / 2, yaw);
  for (const [lx, lz] of [[-50, 44], [0, 44], [50, 44]]) {
    const wp = new THREE.Vector3(lx, g0 + 3, lz).applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw).add(new THREE.Vector3(x, 0, z));
    addLight(wp, 0xffe6c0, 36, 1.6, { kind: 'flood' });
  }
}

// ============================================================ generic building
function building(B, x, z, yaw, w, d, h, g0, mat, opt = {}) {
  const parts = [];
  parts.push(box(w, h + 4, d, { y: g0 + h / 2 - 2.5 }));
  if (opt.setback) parts.push(box(w * 0.7, opt.setback, d * 0.7, { y: g0 + h + opt.setback / 2 - 0.5 }));
  const g = merge(parts);
  // world-metre UVs with non-uniform facade scale (4 bays per 12-14 m)
  const p = g.attributes.position, n = g.attributes.normal;
  const uv = new Float32Array(p.count * 2);
  const su = opt.su || 1 / 12, sv = opt.sv || 1 / 14;
  for (let i = 0; i < p.count; i++) {
    const ax = Math.abs(n.getX(i)), az = Math.abs(n.getZ(i)), ay = Math.abs(n.getY(i));
    const X = p.getX(i), Y = p.getY(i) - g0 + 0.5 + (opt.yOff || 0), Z = p.getZ(i);
    if (ay > 0.5) { uv[i * 2] = X * 0.02; uv[i * 2 + 1] = Z * 0.02; } else if (ax > az) { uv[i * 2] = (Z + (opt.off || 0)) * su; uv[i * 2 + 1] = Y * sv; } else { uv[i * 2] = (X + (opt.off || 0)) * su; uv[i * 2 + 1] = Y * sv; }
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  aoBase(g, g0, 0.3, 2.5);
  B.add(mat, place(g, x, 0, z, yaw));
  // roof cap
  const cap = box(w + 0.4, 0.5, d + 0.4, { y: g0 + h - 0.3 });
  B.add(M.roofDark, place(cap, x, 0, z, yaw));
  if (opt.solid !== false) addSolid(x, g0 + h / 2, z, w / 2 + 1.5, h / 2 + 3, d / 2 + 1.5, yaw);
}

function rosslyn(B) {
  const r = mulberry32(404);
  const spots = [[820, 70, 26, 22, 62], [848, 118, 30, 24, 96], [880, 64, 24, 26, 74], [905, 140, 34, 26, 112], [935, 80, 28, 24, 88], [962, 120, 24, 22, 70], [890, 205, 30, 30, 104], [950, 190, 26, 26, 82], [1035, 150, 28, 22, 58], [1030, 95, 22, 20, 50], [860, 250, 36, 30, 66], [920, 265, 30, 26, 92]];
  for (const [s, e, w, dd, h] of spots) {
    const d = -(hwL(s) + e); const [x, z] = fromSD(s, d);
    const g0 = terrainH(s, d);
    const yaw = -frame(s).th + (r() - 0.5) * 0.3;
    building(B, x, z, yaw, w, dd, h, g0, M.glass, { su: 1 / 12, sv: 1 / 14, setback: r() < 0.4 ? 8 : 0, off: r() * 30 });
  }
}

function georgetownBuildings(B) {
  const r = mulberry32(99);
  // Washington Harbour style: stepped curved block near the water
  for (let k = 0; k < 5; k++) {
    const s = 905 + k * 11; const d = hwR(s) + 34 + Math.sin(k * 0.9) * 6; const [x, z] = fromSD(s, d);
    const g0 = terrainH(s, d);
    building(B, x, z, -frame(s).th + 0.2 * (k - 2) * 0.3, 12, 20, 16 + (k % 2) * 4, g0, M.facade, { su: 1 / 10, sv: 1 / 13 });
  }
  // rowhouse / mid-rise blocks behind
  for (let i = 0; i < 26; i++) {
    const s = 880 + r() * 220; const e = 70 + r() * 160;
    if (Math.abs(s - 990) < 32) continue; // keep the Key Bridge street clear
    const d = hwR(s) + e; const [x, z] = fromSD(s, d); const g0 = terrainH(s, d);
    const h = 10 + r() * 16; const brick = r() < 0.7;
    building(B, x, z, -frame(s).th + (r() - 0.5) * 0.2, 14 + r() * 16, 12 + r() * 12, h, g0, brick ? M.brickWin : M.facade, { su: 1 / 11, sv: 1 / 12, off: r() * 20 });
  }
  // Watergate-like curved balconied buildings near the Kennedy Center
  for (let k = 0; k < 3; k++) {
    const s0 = 555 + k * 38, e0 = 95 + k * 22;
    const segs = [];
    for (let i = 0; i < 10; i++) {
      const a = i / 9 * 1.2 - 0.6;
      const s = s0 + Math.sin(a) * 26, e = e0 + (1 - Math.cos(a)) * 24;
      const d = hwR(s) + e; const [x, z] = fromSD(s, d); const g0 = terrainH(s, d);
      segs.push([x, z, -frame(s).th + a, g0]);
    }
    for (const [x, z, yaw, g0] of segs) {
      const parts = [];
      for (let f = 0; f < 11; f++) parts.push(box(8.5, 0.35, 14, { y: g0 + 1.5 + f * 3.1 }));
      B.add(M.whitePaint, place(merge(parts), x, 0, z, yaw));
      const core = box(8.4, 34, 12.5, { y: g0 + 17 - 0.5 });
      const p = core.attributes.position, n = core.attributes.normal; const uv = new Float32Array(p.count * 2);
      for (let i = 0; i < p.count; i++) { uv[i * 2] = (Math.abs(n.getX(i)) > 0.5 ? p.getZ(i) : p.getX(i)) / 12; uv[i * 2 + 1] = p.getY(i) / 12.4; }
      core.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
      B.add(M.facade, place(core, x, 0, z, yaw));
      addSolid(x, g0 + 17, z, 5, 18, 8, yaw);
    }
  }
}

// distant skyline (instanced, world-space facade shader)
function skyline(scene) {
  const r = mulberry32(5150);
  const geo = new THREE.BoxGeometry(1, 1, 1); geo.translate(0, 0.5, 0);
  const mat = M.skyMat = new THREE.MeshStandardMaterial({ color: 0xc8c0b0, roughness: 0.8, emissive: 0xffffff, emissiveIntensity: 0 });
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vW; varying vec3 vN;').replace('#include <project_vertex>', '#include <project_vertex>\n vW = (modelMatrix * instanceMatrix * vec4(transformed,1.0)).xyz; vN = normalize(mat3(modelMatrix*instanceMatrix)*objectNormal);');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vW; varying vec3 vN; float h1(vec2 p){return fract(sin(dot(p,vec2(12.9898,78.233)))*43758.5453);}')
      .replace('#include <emissivemap_fragment>', `
        vec2 fu = abs(vN.x) > abs(vN.z) ? vec2(vW.z, vW.y) : vec2(vW.x, vW.y);
        vec2 cell = floor(fu / vec2(3.2, 3.6)); vec2 f = fract(fu / vec2(3.2, 3.6));
        float win = step(0.2, f.x)*step(f.x, 0.8)*step(0.25, f.y)*step(f.y, 0.8) * step(0.3, abs(vN.y) < 0.5 ? 1.0 : 0.0);
        float lit = step(0.55, h1(cell + floor(vW.xz*0.01)));
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.12,0.14,0.16), win*0.85);
        totalEmissiveRadiance = vec3(1.0,0.78,0.5) * win * lit * emissive.r;
      `);
  };
  const N = 700; const im = new THREE.InstancedMesh(geo, mat, N);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), p = new THREE.Vector3();
  let n = 0;
  const col = new THREE.Color();
  while (n < N) {
    const east = r() < 0.72;
    const s = -700 + r() * 2300; const e = 430 + Math.pow(r(), 0.7) * 1400;
    if (!east && s > 780 && s < 1020 && e < 600) continue;
    const side = east ? 1 : -1;
    const F = frame(s); const d = side * (hw(s, side) + e);
    const x = F.x + F.rx * d, z = F.z + F.rz * d;
    let h = 8 + r() * 22; if (!east && r() < 0.15) h += 30;
    if (east && s > 600 && s < 1300) h *= 0.8;
    p.set(x, 5.9, z); sc.set(14 + r() * 40, h, 14 + r() * 40); q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), -F.th + (r() - 0.5) * 0.5);
    m4.compose(p, q, sc); im.setMatrixAt(n, m4);
    col.setHSL(0.08 + r() * 0.06, 0.12 + r() * 0.15, 0.55 + r() * 0.25); im.setColorAt(n, col);
    n++;
  }
  im.castShadow = false; im.receiveShadow = false;
  scene.add(im);
  return im;
}

// ============================================================ seawalls, promenades, railings, lamps, benches
function seawalls(B) {
  const segs = [];
  for (const side of [1, -1]) {
    let cur = null;
    for (let s = S0; s <= 1100; s += 2) {
      const on = bankTypeAt(s, side) === 'seawall';
      if (on) { if (!cur) { cur = []; segs.push([side, cur]); } cur.push(s); } else cur = null;
    }
  }
  for (const [side, ss] of segs) {
    if (ss.length < 3) continue;
    const face0 = [], face1 = [], capA = [], capB = [], capC = [], capD = [];
    for (const s of ss) {
      const F = frame(s); const w = hw(s, side);
      const at = (dd, y) => new THREE.Vector3(F.x + F.rx * side * dd, y, F.z + F.rz * side * dd);
      face0.push(at(w - 0.05, -2.6)); face1.push(at(w - 0.05, 2.12));
      capA.push(at(w - 0.25, 1.95)); capB.push(at(w - 0.25, 2.26)); capC.push(at(w + 0.65, 2.26)); capD.push(at(w + 0.65, 2.12));
    }
    let len = 0; const L = [0]; for (let i = 1; i < ss.length; i++) { len += ss[i] - ss[i - 1]; L.push(len); }
    const uvf = (i) => [L[i] * 0.25, -2.6 * 0.25, L[i] * 0.25, 2.12 * 0.25];
    const faceG = side > 0 ? strip(face1, face0, (i) => [L[i] * 0.25, 2.12 * 0.25, L[i] * 0.25, -2.6 * 0.25]) : strip(face0, face1, uvf);
    // darken & tint near waterline (algae stain)
    shade(faceG, (x, y) => (y < 0.4 ? 0.55 + 0.45 * clamp((y + 1.5) / 1.9, 0, 1) : 1));
    const c = faceG.attributes.color, p = faceG.attributes.position;
    for (let i = 0; i < p.count; i++) if (p.getY(i) < 0.6) c.setXYZ(i, c.getX(i) * 0.85, c.getY(i) * 0.92, c.getZ(i) * 0.75);
    B.add(M.graniteFlood, faceG);
    const top = side > 0 ? strip(capB, capC, (i) => [L[i] * 0.3, 0, L[i] * 0.3, 0.27]) : strip(capC, capB, (i) => [L[i] * 0.3, 0.27, L[i] * 0.3, 0]);
    const front = side > 0 ? strip(capA, capB, (i) => [L[i] * 0.3, 0, L[i] * 0.3, 0.09]) : strip(capB, capA, (i) => [L[i] * 0.3, 0.09, L[i] * 0.3, 0]);
    B.add(M.graniteDark, top); B.add(M.graniteDark, front);
  }
}

function pathStrip(B, mat, side, sA, sB, e0, e1, lift = 0.04, uvS = 0.25, step = 2) {
  const a = [], b = []; const L = []; let len = 0;
  for (let s = sA; s <= sB; s += step) {
    const F = frame(s); const w = hw(s, side);
    const d0 = side * (w + e0), d1 = side * (w + e1);
    a.push(new THREE.Vector3(F.x + F.rx * d0, terrainH(s, d0) + lift, F.z + F.rz * d0));
    b.push(new THREE.Vector3(F.x + F.rx * d1, terrainH(s, d1) + lift, F.z + F.rz * d1));
    if (L.length) len += step; L.push(len);
  }
  const g = side > 0 ? strip(a, b, (i) => [L[i] * uvS, e0 * uvS, L[i] * uvS, e1 * uvS]) : strip(b, a, (i) => [L[i] * uvS, e1 * uvS, L[i] * uvS, e0 * uvS]);
  // curb edges
  B.add(mat, g);
  return g;
}

function streetlamp(B, x, y, z, yaw, lights = true) {
  addWalkBlock({ x, z, r: 0.2 });
  const g = [];
  g.push(cyl(0.22, 0.25, 0.05, 12, { y: 0.025 }));
  for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2 + Math.PI / 4; g.push(cyl(0.025, 0.025, 0.05, 6, { x: Math.cos(a) * 0.17, y: 0.06, z: Math.sin(a) * 0.17 })); }
  g.push(cyl(0.065, 0.09, 5.2, 12, { y: 2.65 }));
  g.push(box(0.1, 0.07, 1.1, { y: 5.2, z: -0.5, rx: -0.12 }));
  g.push(rbox(0.36, 0.1, 0.62, 0.04, { y: 5.12, z: -1.05 }));
  const mg = merge(g); B.add(M.metalDark, place(mg, x, y, z, yaw));
  B.add(M.lampGlow, place(box(0.28, 0.02, 0.5, { y: 5.065, z: -1.05 }), x, y, z, yaw));
  const hp = new THREE.Vector3(0, 5.0, -1.05).applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw).add(new THREE.Vector3(x, y, z));
  if (lights) addLight(hp, 0xffe2b0, 22, 2.8, { kind: 'lamp', insects: true });
  return hp;
}
function bench(B, x, y, z, yaw) {
  addWalkBlock({ x, z, hx: 0.98, hz: 0.33, yaw });
  const g = [], w = [];
  for (const sx of [-0.8, 0.8]) { g.push(box(0.06, 0.45, 0.5, { x: sx, y: 0.225 })); g.push(box(0.06, 0.5, 0.06, { x: sx, y: 0.7, z: 0.24, rx: -0.2 })); g.push(box(0.06, 0.05, 0.55, { x: sx, y: 0.44 })); }
  for (let i = 0; i < 4; i++) w.push(rbox(1.9, 0.035, 0.1, 0.012, { y: 0.47, z: -0.2 + i * 0.12 }));
  for (let i = 0; i < 3; i++) w.push(rbox(1.9, 0.09, 0.03, 0.01, { y: 0.62 + i * 0.12, z: 0.26 + i * 0.025, rx: -0.2 }));
  B.add(M.metalDark, place(merge(g), x, y, z, yaw));
  B.add(M.wood, place(boxUV(merge(w), 1), x, y, z, yaw));
}
function railing(B, side, sA, sB, e, yBase, step = 1.8) {
  const g = []; const rails = [[], [], [], [], []];
  for (let s = sA; s <= sB; s += step) {
    const F = frame(s); const d = side * (hw(s, side) + e);
    const x = F.x + F.rx * d, z = F.z + F.rz * d; const y = yBase ?? terrainH(s, d);
    g.push(box(0.05, 1.07, 0.012 * 5, { x, y: y + 0.535, z, ry: -F.th }));
    rails[0].push(new THREE.Vector3(x, y + 1.08, z));
    for (let k = 1; k <= 4; k++) rails[k].push(new THREE.Vector3(x, y + 0.18 + k * 0.18, z));
  }
  B.add(M.metalDark, merge(g));
  B.add(M.steel, tube(rails[0], rails[0].map(() => 0.028), 8));
  for (let k = 1; k <= 4; k++) B.add(M.steel, tube(rails[k], rails[k].map(() => 0.004), 4));
}

// ============================================================ Georgetown Waterfront Park
function georgetownPark(B, out) {
  const side = 1;
  // promenade + terrace walls + planted bed curbs
  pathStrip(B, M.paving, side, 776, 970, 0.36, 7.5, 0.03, 0.25);
  pathStrip(B, M.paving, side, 776, 970, 28.5, 31.5, 0.03, 0.25);
  for (const [e, h] of [[14, 0.65], [26, 0.65]]) {
    const a = [], b = [], c = [];
    for (let s = 778; s <= 968; s += 2) {
      const F = frame(s); const w = hw(s, side); const d = w + e;
      const y = terrainH(s, d + 1.2);
      a.push(new THREE.Vector3(F.x + F.rx * d, y - h - 0.1, F.z + F.rz * d)); b.push(new THREE.Vector3(F.x + F.rx * d, y + 0.08, F.z + F.rz * d)); c.push(new THREE.Vector3(F.x + F.rx * (d + 0.55), y + 0.08, F.z + F.rz * (d + 0.55)));
    }
    const wall = strip(b, a, (i) => [i * 0.5, 0.4, i * 0.5, 0]); B.add(M.graniteDark, wall);
    B.add(M.graniteDark, strip(b, c, (i) => [i * 0.5, 0, i * 0.5, 0.14]));
  }
  // granite seating blocks
  const r = mulberry32(12);
  for (let i = 0; i < 16; i++) {
    const s = 785 + i * 11.5 + r() * 3; const e = 9 + r() * 3.5;
    const d = hwR(s) + e; const [x, z] = fromSD(s, d); const y = terrainH(s, d);
    const g = rbox(2.4 + r() * 1.2, 0.46, 0.7, 0.05, { y: 0.2 }); boxUV(g, 0.3); g.computeBoundingBox(); const hxG = (g.boundingBox.max.x - g.boundingBox.min.x) / 2;
    { const yaw = -frame(s).th + Math.PI / 2 + (r() - 0.5) * 0.3; B.add(M.graniteDark, place(g, x, y, z, yaw)); addWalkBlock({ x, z, hx: hxG, hz: 0.35, yaw }); }
  }
  // river steps (amphitheatre) descending into the water
  const sA = 846, sB = 880;
  const steps = [];
  const nSt = 9;
  for (let k = 0; k < nSt; k++) {
    const y = 2.1 - (k + 1) * 0.29; const e0 = -(k + 1) * 0.72;
    const a = [], b = [], a2 = [], b2 = [];
    for (let s = sA; s <= sB; s += 2) {
      const F = frame(s); const w = hwR(s);
      const at = (e, yy) => new THREE.Vector3(F.x + F.rx * (w + e), yy, F.z + F.rz * (w + e));
      a.push(at(e0, y)); b.push(at(e0 + 0.72, y));
      a2.push(at(e0, y - 0.29)); b2.push(at(e0, y));
    }
    const tread = strip(a, b, (i) => [i * 0.5, 0, i * 0.5, 0.18]); boxUV(tread, 0.3); steps.push(tread);
    const riser = strip(a, a2, (i) => [i * 0.5, 0.07, i * 0.5, 0]); boxUV(riser, 0.3); steps.push(riser);
  }
  // step block below water to the bed
  const fr = [], bk = [];
  for (let s = sA; s <= sB; s += 2) { const F = frame(s); const w = hwR(s); const e0 = -nSt * 0.72; fr.push(new THREE.Vector3(F.x + F.rx * (w + e0), 2.1 - nSt * 0.29, F.z + F.rz * (w + e0))); bk.push(new THREE.Vector3(F.x + F.rx * (w + e0), -2.6, F.z + F.rz * (w + e0))); }
  steps.push(boxUV(strip(fr, bk), 0.25));
  // side cheek walls
  for (const s of [sA, sB]) {
    const F = frame(s); const w = hwR(s); const e0 = -nSt * 0.72;
    const x = F.x + F.rx * (w + e0 / 2), z = F.z + F.rz * (w + e0 / 2);
    const cw = box(0.6, 4.75, -e0 + 0.2, { y: -0.225 }); boxUV(cw, 0.25);
    steps.push(place(cw, x, 0, z, -F.th));
  }
  const sg = merge(steps); ensureColor(sg); shade(sg, (x, y) => (y < 0.3 ? 0.7 : 1));
  B.add(M.graniteFlood, sg);
  addObstacle({ s: (sA + sB) / 2, d: hwR((sA + sB) / 2) - nSt * 0.36, rs: (sB - sA) / 2 + 0.5, rd: nSt * 0.36 + 0.3, kind: 'steps', foam: 0.3, stop: 'gt' });
  out.steps = { sA, sB, nSt };
  // lamps, benches, railing (railing interrupted by the steps)
  const lampPts = [];
  for (let s = 782; s <= 966; s += 23) {
    const d = hwR(s) + 6.8; const [x, z] = fromSD(s, d); lampPts.push(streetlamp(B, x, terrainH(s, d), z, -frame(s).th - Math.PI / 2));
  }
  for (let s = 793; s <= 960; s += 23) {
    if (s > sA - 3 && s < sB + 3) continue;
    const d = hwR(s) + 5.6; const [x, z] = fromSD(s, d); bench(B, x, terrainH(s, d), z, -frame(s).th - Math.PI / 2);
  }
  railing(B, 1, 776, sA - 1, 0.42, 2.26);
  railing(B, 1, sB + 1, 970, 0.42, 2.26);
  return lampPts;
}

// ============================================================ promenades elsewhere
function otherPromenades(B) {
  // Ohio Drive / West Potomac Park path along the seawall
  pathStrip(B, M.paving, 1, -300, 555, 1.6, 5.2, 0.03, 0.25, 3);
  for (let s = -280; s <= 540; s += 26) {
    if (s > 180 && s < 222) continue;
    const d = hwR(s) + 5.8; const [x, z] = fromSD(s, d); streetlamp(B, x, terrainH(s, d), z, -frame(s).th - Math.PI / 2, s > -120);
    if ((s / 26) % 2 === 0) { const d2 = hwR(s + 11) + 5.4; const [x2, z2] = fromSD(s + 11, d2); bench(B, x2, terrainH(s + 11, d2), z2, -frame(s + 11).th - Math.PI / 2); }
  }
  railing(B, 1, 380, 552, 0.45, 2.26);
  // Kennedy Center / Rock Creek trail
  // Mount Vernon trail on the Virginia side (asphalt)
  pathStrip(B, M.asphalt, -1, -400, 530, 13, 16, 0.04, 0.1, 4);
  pathStrip(B, M.asphalt, -1, 865, 1000, 13, 16, 0.04, 0.1, 4);
  // C&O towpath (gravel)
  pathStrip(B, M.gravel, 1, CANAL.s0 + 10, S1 - 20, CANAL.towE0 + 1, CANAL.towE1 - 1, 0.05, 0.3, 4);
}

// ============================================================ Thompson Boat Center
function shellGeo(len, beam, depth) {
  const pts = [], rad = [];
  for (let i = 0; i <= 20; i++) { const t = i / 20; const x = (t - 0.5) * len; const w = Math.pow(Math.sin(t * Math.PI), 0.55); pts.push(new THREE.Vector3(x, 0, 0)); rad.push(Math.max(0.01, w * beam / 2)); }
  const g = tube(pts, rad, 8);
  g.scale(1, depth / beam, 1);
  return g;
}
function thompson(B, out) {
  const side = 1;
  const s0 = 722;
  const F = frame(s0);
  // boathouse: concrete + brick, big bay doors
  { const s = 712, e = 30; const d = hwR(s) + e; const [x, z] = fromSD(s, d); const g0 = terrainH(s, d);
    const yaw = -frame(s).th;
    const bw = 18, bl = 50, bh = 8;
    building(B, x, z, yaw, bw, bl, bh, g0, M.brick, { su: 1 / 4, sv: 1 / 4 });
    const doors = [];
    for (let i = 0; i < 6; i++) doors.push(box(0.2, 4.2, 6, { x: -bw / 2 - 0.08, y: g0 + 2.1, z: -bl / 2 + 5 + i * 8 }));
    B.add(M.metalDark, place(merge(doors), x, 0, z, yaw));
    const band = box(bw + 0.6, 1.2, bl + 0.6, { y: g0 + bh - 0.9 }); boxUV(band, 0.25); B.add(M.concrete, place(band, x, 0, z, yaw));
    const winb = box(0.15, 1.6, bl - 6, { x: -bw / 2 - 0.05, y: g0 + 6 }); B.add(M.glassWarm, place(winb, x, 0, z, yaw));
  }
  // shell racks (A-frames) with rowing shells
  const shellMats = [M.whitePaint, M.shellYellow, M.whitePaint, M.shellBlue];
  for (let k = 0; k < 4; k++) {
    const s = 692 + k * 7; const e = 13;
    const d = hwR(s) + e; const [x, z] = fromSD(s, d); const g0 = terrainH(s, d);
    const yaw = -frame(s).th + Math.PI / 2; // rack runs across (towards river) -> local x along e
    const fr = [];
    for (const lx of [-7, -2.5, 2.5, 7]) {
      fr.push(box(0.1, 2.8, 0.1, { x: lx, y: 1.4 }));
      fr.push(box(0.08, 0.08, 2.2, { x: lx, y: 0.05 }));
      for (let t = 0; t < 4; t++) fr.push(box(0.06, 0.05, 1.8, { x: lx, y: 0.55 + t * 0.6 }));
    }
    B.add(M.alu, place(merge(fr), x, g0, z, yaw)); addWalkBlock({ x, z, hx: 7.1, hz: 1.15, yaw });
    for (let t = 0; t < 4; t++) for (const sz of [-0.55, 0.55]) {
      if ((t + k) % 5 === 4) continue;
      const sg = shellGeo(16.5, 0.55, 0.28); ensureColor(sg);
      const off = new THREE.Vector3(0, 0, sz).applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
      B.add(shellMats[(t + k) % 4], place(sg, x + off.x, g0 + 0.72 + t * 0.6, z + off.z, yaw));
    }
  }
  // launch ramp
  pathStrip(B, M.concrete, 1, 728, 748, -2, 11, 0.03, 0.2, 2);
  // floating docks (pontoons)
  const dock = [];
  const dockPts = [];
  const mk = (s, e0, e1, wdt) => {
    const dA = hwR(s) + e0, dB = hwR(s) + e1;
    const [xa, za] = fromSD(s, dA), [xb, zb] = fromSD(s, dB);
    const len = Math.hypot(xb - xa, zb - za); const yaw = Math.atan2(xb - xa, zb - za);
    const g = rbox(wdt, 0.5, len, 0.06, { y: 0.1 }); boxUV(g, 0.5);
    dock.push(place(g, (xa + xb) / 2, 0, (za + zb) / 2, yaw));
    dockPts.push({ s, d: (dA + dB) / 2, rs: wdt / 2 + 0.3, rd: Math.abs(dB - dA) / 2 + 0.3 });
  };
  mk(735, -30, -2, 2.6);
  // along-shore finger
  { const e = -30; const sA = 718, sB = 760; const a = [], b = [];
    for (let s = sA; s <= sB; s += 2) { const F2 = frame(s); const w = hwR(s); for (const [arr, ee] of [[a, e - 1.3], [b, e + 1.3]]) arr.push(new THREE.Vector3(F2.x + F2.rx * (w + ee), 0.36, F2.z + F2.rz * (w + ee))); }
    const deckS = strip(b, a, (i) => [i * 0.5, 0, i * 0.5, 1.3]); B.add(M.wood, deckS);
    const sideA = a.map((p) => p.clone().setY(-0.15)), sideB = b.map((p) => p.clone().setY(-0.15));
    B.add(M.whitePaint, strip(a, sideA)); B.add(M.whitePaint, strip(sideB, b));
    // the finger follows the curving bank, so describe it as short straight pieces
    for (let s0 = sA; s0 < sB; s0 += 6) { const sc = Math.min(sB, s0 + 6); dockPts.push({ s: (s0 + sc) / 2, d: hwR((s0 + sc) / 2) + e, rs: (sc - s0) / 2 + 0.3, rd: 1.45 }); }
    // cleats
    for (let s = sA + 3; s < sB; s += 6) { const F2 = frame(s); const w = hwR(s); const x = F2.x + F2.rx * (w + e - 1.15), z = F2.z + F2.rz * (w + e - 1.15); B.add(M.steel, place(merge([box(0.3, 0.06, 0.06, { y: 0.44 }), box(0.06, 0.08, 0.05, { y: 0.4 })]), x, 0, z, -F2.th)); }
  }
  mk(722, -30, -24, 2.2); mk(750, -30, -24, 2.2);
  const dg = merge(dock); B.add(M.wood, dg);
  for (const o of dockPts) addObstacle({ ...o, kind: 'dock', foam: 0.15, stop: 'tbc' });
  // gangway
  { const [xa, za] = fromSD(735, hwR(735) - 2), [xb, zb] = fromSD(735, hwR(735) + 7); const ya = 0.45, yb = terrainH(735, hwR(735) + 7) + 0.1;
    const len = Math.hypot(xb - xa, zb - za); const yaw = Math.atan2(xb - xa, zb - za);
    const gw = box(1.4, 0.12, Math.hypot(len, yb - ya), { rx: -Math.atan2(yb - ya, len) });
    B.add(M.alu, place(gw, (xa + xb) / 2, (ya + yb) / 2, (za + zb) / 2, yaw)); }
  // dock lights
  for (const s of [720, 740, 758]) { const d = hwR(s) - 30; const [x, z] = fromSD(s, d); addWalkBlock({ x, z, r: 0.12 }); const lp = merge([cyl(0.05, 0.05, 1.2, 6, { y: 0.95 })]); B.add(M.metalDark, place(lp, x, 0, z)); B.add(M.lampGlowWarm, place(sph(0.12, 8, 6, { y: 1.6 }), x, 0, z)); addLight(new THREE.Vector3(x, 1.6, z), 0xffc880, 14, 1.8, { kind: 'dock' }); }
  out.dockMoor = [[726, hwR(726) - 33.2, 0], [744, hwR(744) - 33.2, 0], [752, hwR(752) - 33.2, Math.PI]];
}

// ============================================================ Roosevelt Island boardwalk + footbridge
function roosevelt(B, out) {
  // boardwalk through the marsh on the island's channel side
  const pts = [];
  for (let s = 590; s <= 760; s += 3) {
    // find island edge on the main-channel side (d increasing)
    let dEdge = ISLAND.d + ISLAND.ad;
    for (let d = ISLAND.d; d < ISLAND.d + ISLAND.ad + 20; d += 0.5) { if (islandMask(s, d) < 0.05) { dEdge = d; break; } }
    const d = dEdge - 7 + Math.sin(s * 0.05) * 2.5;
    pts.push([s, d]);
  }
  const plank = [], posts = [], rail = [[], []];
  for (let i = 0; i < pts.length - 1; i++) {
    const [sa, da] = pts[i], [sb, db] = pts[i + 1];
    const [xa, za] = fromSD(sa, da), [xb, zb] = fromSD(sb, db);
    const len = Math.hypot(xb - xa, zb - za), yaw = Math.atan2(xb - xa, zb - za);
    const y = Math.max(terrainH(sa, da), 0) + 0.9;
    plank.push(place(box(2.0, 0.12, len + 0.02, { y: 0 }), (xa + xb) / 2, y, (za + zb) / 2, yaw));
    for (const sx of [-0.95, 0.95]) {
      const off = new THREE.Vector3(sx, 0, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
      const gy = terrainH(sa, da);
      posts.push(place(cyl(0.09, 0.1, y - gy + 0.9 + 0.5, 6, { y: (y + 0.9 + gy - 0.5) / 2 }), xa + off.x, 0, za + off.z, 0));
      rail[sx < 0 ? 0 : 1].push(new THREE.Vector3(xa + off.x, y + 0.95, za + off.z));
    }
  }
  const pg = merge(plank); boxUV(pg, 0.5); B.add(M.wood, pg);
  B.add(M.wood, merge(posts));
  for (const r of rail) B.add(M.wood, tube(r, r.map(() => 0.05), 5));
  // pedestrian bridge to Virginia across the Little River
  const s = 655;
  let dIsl = ISLAND.d - ISLAND.ad;
  for (let d = ISLAND.d; d > ISLAND.d - ISLAND.ad - 20; d -= 0.5) if (islandMask(s, d) < 0) { dIsl = d; break; }
  const dA = dIsl + 4, dB = -hwL(s) - 8;
  const [xa, za] = fromSD(s, dA), [xb, zb] = fromSD(s, dB);
  const len = Math.hypot(xb - xa, zb - za), yaw = Math.atan2(xb - xa, zb - za);
  const deckY = 4.6;
  const g = [], st = [];
  g.push(box(3.2, 0.5, len, { y: deckY }));
  for (const sx of [-1.7, 1.7]) {
    st.push(box(0.25, 1.4, len, { x: sx, y: deckY + 0.8 }));
    for (let k = 0; k < len; k += 2.4) st.push(box(0.12, 1.4, 0.12, { x: sx, y: deckY + 0.8, z: -len / 2 + k }));
  }
  for (const t of [0.33, 0.66]) { g.push(box(1.6, deckY + 7, 1.6, { y: deckY / 2 - 3.5, z: -len / 2 + t * len })); addObstacle({ s, d: lerp(dA, dB, t), rs: 1.2, rd: 1.2, kind: 'pier', foam: 0.6 }); }
  const bg = merge(g); boxUV(bg, 0.2); B.add(M.concrete, place(bg, (xa + xb) / 2, 0, (za + zb) / 2, yaw));
  B.add(M.metalDark, place(merge(st), (xa + xb) / 2, 0, (za + zb) / 2, yaw));
  addSolid((xa + xb) / 2, deckY, (za + zb) / 2, 2.5, 2.5, len / 2, yaw);
  out.boardwalk = pts;
}

// ============================================================ Fletcher's Cove boathouse + canal
function fletchers(B, scene, out) {
  const s = 1548, e = 11;
  const d = hwR(s) + e; const [x, z] = fromSD(s, d); const g0 = terrainH(s, d);
  const yaw = -frame(s).th + Math.PI / 2;
  const wood = [], roof = [], trim = [];
  // main boathouse on piers
  const bw = 9, bl = 22, bh = 4.2;
  wood.push(box(bl, bh, bw, { y: g0 + 0.9 + bh / 2 }));
  for (let i = -5; i <= 5; i++) for (const zz of [-bw / 2 + 0.3, bw / 2 - 0.3]) trim.push(box(0.25, 1.2, 0.25, { x: i * 2, y: g0 + 0.4, z: zz }));
  // gabled roof
  const rs = new THREE.Shape(); rs.moveTo(-bw / 2 - 0.8, 0); rs.lineTo(0, 2.6); rs.lineTo(bw / 2 + 0.8, 0); rs.lineTo(bw / 2 + 0.8, -0.18); rs.lineTo(0, 2.42); rs.lineTo(-bw / 2 - 0.8, -0.18);
  const rg = extrude(rs, bl + 1.4, { y: g0 + 0.9 + bh, ry: Math.PI / 2 }); roof.push(rg);
  const gs = new THREE.Shape(); gs.moveTo(-bw / 2, 0); gs.lineTo(0, 2.4); gs.lineTo(bw / 2, 0);
  for (const sx of [-1, 1]) wood.push(extrude(gs, 0.2, { x: sx * bl / 2, y: g0 + 0.9 + bh, ry: Math.PI / 2 }));
  // porch/deck facing the cove
  wood.push(box(bl, 0.2, 3.2, { y: g0 + 1.0, z: -bw / 2 - 1.6 }));
  for (let i = -5; i <= 5; i++) trim.push(box(0.12, 1.0, 0.12, { x: i * 2, y: g0 + 1.6, z: -bw / 2 - 3.1 }));
  trim.push(box(bl, 0.08, 0.1, { y: g0 + 2.1, z: -bw / 2 - 3.1 }));
  // windows & doors (dark), a couple warm at night
  const win = [];
  for (let i = -4; i <= 4; i += 2) win.push(box(1.2, 1.4, 0.08, { x: i * 2, y: g0 + 3.2, z: -bw / 2 - 0.05 }));
  const toW = (g) => place(g, x, 0, z, yaw);
  const wg = merge(wood); boxUV(wg, 0.4); aoBase(wg, g0 + 0.9, 0.3, 1.2); B.add(M.wood, toW(wg));
  const rgm = merge(roof); boxUV(rgm, 0.3); B.add(M.roofDark, toW(rgm));
  B.add(M.wood, toW(merge(trim)));
  B.add(M.glassWarm, toW(merge(win)));
  addSolid(x, g0 + 4, z, bl / 2 + 1, 5, bw / 2 + 4, yaw);
  { const wp = new THREE.Vector3(0, g0 + 3.5, -bw / 2 - 2.5).applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw).add(new THREE.Vector3(x, 0, z)); addLight(wp, 0xffc27a, 18, 2.2, { kind: 'dock', insects: true }); }
  // small dock into the cove
  const dk = [];
  const dA = hwR(s + 10) - 16, dB = hwR(s + 10) + 1;
  const [xa, za] = fromSD(s + 10, dA), [xb, zb] = fromSD(s + 10, dB);
  const len = Math.hypot(xb - xa, zb - za), dy = Math.atan2(xb - xa, zb - za);
  dk.push(box(2, 0.14, len, { y: 0.75 }));
  for (let k = 0; k < len; k += 3) for (const sx of [-0.9, 0.9]) dk.push(box(0.16, 3.2, 0.16, { x: sx, y: -0.8, z: -len / 2 + k }));
  const dkg = merge(dk); boxUV(dkg, 0.5); B.add(M.wood, place(dkg, (xa + xb) / 2, 0, (za + zb) / 2, dy));
  addObstacle({ s: s + 10, d: (dA + dB) / 2, rs: 1.25, rd: (dB - dA) / 2, kind: 'dock', foam: 0.1, stop: 'fc' });
  out.fletcherDock = { s: s + 10, d: dA + 2 };
  // canoes & rowboats (overturned on racks and beach)
  const boats = [];
  const cols = [M.canoeRed, M.canoeGreen, M.whitePaint];
  for (let i = 0; i < 14; i++) {
    const ss = s - 16 + (i % 7) * 4.2, ee = 3.5 + Math.floor(i / 7) * 3;
    const dd = hwR(ss) + ee; const [bx, bz] = fromSD(ss, dd); const by = terrainH(ss, dd);
    const cg = shellGeo(4.8, 0.9, 0.42); cg.rotateX(Math.PI); ensureColor(cg);
    B.add(cols[i % 3], place(cg, bx, by + 0.28, bz, -frame(ss).th + Math.PI / 2 + (i % 2) * 0.2)); addWalkBlock({ x: bx, z: bz, hx: 2.4, hz: 0.45, yaw: -frame(ss).th + Math.PI / 2 + (i % 2) * 0.2 });
  }
  // canal water surface
  const cw = []; const ca = [], cb = [];
  for (let s2 = CANAL.s0 + 5; s2 <= S1 - 5; s2 += 6) {
    const F = frame(s2); const w = hwR(s2);
    ca.push(new THREE.Vector3(F.x + F.rx * (w + CANAL.canalE0 - 0.5), CANAL.level, F.z + F.rz * (w + CANAL.canalE0 - 0.5)));
    cb.push(new THREE.Vector3(F.x + F.rx * (w + CANAL.canalE1 + 0.5), CANAL.level, F.z + F.rz * (w + CANAL.canalE1 + 0.5)));
  }
  const canalG = strip(ca, cb, (i) => [i * 1.5, 0, i * 1.5, 2.5]);
  const canalMat = M.canal;
  const cm = new THREE.Mesh(canalG, canalMat); cm.receiveShadow = true; scene.add(cm);
  // stone footbridge over the canal at the cove
  { const s2 = 1540; const F = frame(s2); const w = hwR(s2); const dm = w + (CANAL.canalE0 + CANAL.canalE1) / 2; const [bx, bz] = fromSD(s2, dm);
    const sh = new THREE.Shape(); const L2 = 16; sh.moveTo(-L2 / 2, 0); sh.lineTo(L2 / 2, 0); sh.lineTo(L2 / 2, 1.2); sh.lineTo(-L2 / 2, 1.2);
    const hole = new THREE.Path(); hole.moveTo(-4.5, -0.01); hole.absarc(0, -0.6, 4.55, Math.PI - 0.13, 0.13, true); hole.lineTo(4.5, -0.01); sh.holes.push(hole);
    // bridge spans across canal (along d) -> rotate so local x aligns with right vector
    const g2 = extrude(sh, 3, {}); g2.translate(0, CANAL.tow - 1.2 - 0.0, 0);
    const pl = place(g2, bx, 0, bz, -F.th + Math.PI / 2 - Math.PI / 2);
    boxUV(pl, 0.25); B.add(M.graniteDark, pl); }
}

// ============================================================ main entry
export function buildLandmarks(scene) {
  const B = new Batch();
  const out = {};
  // extra materials
  M.shellYellow = M.shellYellow || M.whitePaint.clone(); M.shellYellow.color = new THREE.Color(0xe8c24a);
  M.shellBlue = M.whitePaint.clone(); M.shellBlue.color = new THREE.Color(0x3a6aa0);
  M.canoeRed = M.whitePaint.clone(); M.canoeRed.color = new THREE.Color(0xb03a2a);
  M.canoeGreen = M.whitePaint.clone(); M.canoeGreen.color = new THREE.Color(0x3a6a44);
  M.moundMat = new THREE.MeshStandardMaterial({ map: TEX.grass.map, color: 0xb8c0a0, roughness: 1 });
  M.canal = new THREE.MeshStandardMaterial({ color: 0x2c3620, roughness: 0.06, metalness: 0.0, envMapIntensity: 1.0 });
  // bridges
  out.memorial = archBridge(B, { s: 200, width: 20, top: 10.6, spring: 2.0, rise: 6.2, spans: 9, pierW: 6, noseL: 4.5, dL: -hwL(200) - 1, dR: hwR(200) + 1, mat: M.graniteFlood, ringMat: M.granite, abut: 18 });
  out.key = keyBridge(B);
  out.lincoln = lincoln(B, scene);
  out.monument = washMonument(B, out.lincoln);
  kennedy(B);
  rosslyn(B);
  georgetownBuildings(B);
  seawalls(B);
  out.gtLamps = georgetownPark(B, out);
  otherPromenades(B);
  thompson(B, out);
  roosevelt(B, out);
  fletchers(B, scene, out);
  const meshes = B.flush(scene, { cast: true, receive: true });
  out.meshes = meshes;
  // monument mound & beacons
  { const mm = new THREE.Mesh(out.monument.mound, M.moundMat); mm.position.set(out.monument.x, out.monument.base - 0.5, out.monument.z); mm.receiveShadow = true; scene.add(mm); }
  scene.add(out.monument.beaconMesh);
  out.skyline = skyline(scene);
  return out;
}
