// Hero boat: compact electric river launch (geometry), physics, autopilot
import * as THREE from 'three';
import { clamp, lerp, smooth, mulberry32 } from './util.js';
import { std } from './matpatch.js';
import { box, rbox, cyl, sph, tor, tf, merge, tube, boxUV, shade, ensureColor, extrude } from './geo.js';
import TEX from './tex.js';
import { frame, toSD, fromSD, hw, hwR, hwL, bedHeight, heightSD, currentAt, islandMask, LOOP_START, LOOP_END } from './world.js';
import { obstacles, SIM } from './water.js';
import { U } from './matpatch.js';

const V3 = THREE.Vector3;
export const BOAT = { LOA: 6.4, BEAM: 2.3 };

// ---------------------------------------------------------------- hull lofting
const NT = 36, NU = 14;
function halfBeam(t) { // t: 0 stern -> 1 bow
  if (t < 0.42) return 1.13 * lerp(0.93, 1, Math.pow(t / 0.42, 0.6));
  const k = Math.min(1, (t - 0.42) / 0.58);
  return 1.13 * Math.pow(Math.max(0, Math.cos(k * Math.PI / 2)), 0.85);
}
function sheer(t) { return 0.56 + 0.2 * t * t; }
function keel(t) { return -0.36 + 0.02 * t + 0.85 * Math.pow(Math.max(0, t - 0.72) / 0.28, 2.2); }
function sectionPt(t, u, inset = 0) {
  // u: 0 keel -> 1 gunwale ; modified-V with flared topsides
  const b = Math.max(0.001, halfBeam(t) - inset);
  const k = keel(t) + inset * 1.2, top = sheer(t);
  const x = b * Math.pow(Math.sin(u * Math.PI / 2), 0.62) * (1 - 0.06 * (1 - u));
  const y = k + (top - k) * Math.pow(u, 1.45);
  return [x, y];
}
const zOf = (t) => (0.5 - t) * BOAT.LOA; // local z: bow at -3.2, stern at +3.2

function hullGeo(inset, flip) {
  const pos = [], uv = [], idx = [];
  const cols = NU * 2 + 1;
  for (let i = 0; i <= NT; i++) {
    const t = i / NT;
    for (let j = -NU; j <= NU; j++) {
      const u = Math.abs(j) / NU;
      const [x, y] = sectionPt(t, u, inset);
      pos.push(Math.sign(j) * x, y, zOf(t));
      uv.push(t * BOAT.LOA * 0.5, (j / NU) * 0.8);
    }
  }
  for (let i = 0; i < NT; i++) for (let j = 0; j < cols - 1; j++) {
    const a = i * cols + j, b = a + 1, c = a + cols, d = c + 1;
    if (flip) idx.push(a, b, c, b, d, c); else idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals();
  return g;
}
// inner half-width at a given height (for deck / seats)
function innerHalfAt(t, y) {
  for (let j = 0; j <= 40; j++) { const u = j / 40; const [x, yy] = sectionPt(t, u, 0.045); if (yy >= y) return x; }
  return sectionPt(t, 1, 0.045)[0];
}

export function buildBoatModel(o = {}) {
  const g = new THREE.Group();
  const mats = {
    hull: std({ map: TEX.fiber.map, color: o.hull ?? 0xf6f4ee, roughness: 0.22, metalness: 0, vertexColors: true }, { wet: 0.6 }),
    stripe: std({ color: o.stripe ?? 0x1d3050, roughness: 0.25, vertexColors: true }, { wet: 0.5 }),
    inner: std({ map: TEX.fiber.map, color: 0xe9e6de, roughness: 0.4, vertexColors: true }, { wet: 0.7 }),
    deck: std({ map: TEX.deck.map, normalMap: TEX.deck.normalMap, roughness: 0.75, vertexColors: true }, { wet: 1 }),
    uphol: std({ map: TEX.uphol.map, normalMap: TEX.uphol.normalMap, color: o.uphol ?? 0xf0ebe0, roughness: 0.6, vertexColors: true }, { wet: 0.8 }),
    upholTrim: std({ color: o.stripe ?? 0x1d3050, roughness: 0.5, vertexColors: true }, { wet: 0.6 }),
    steel: std({ color: 0xe6eaee, roughness: 0.12, metalness: 1, vertexColors: true }, { wet: 0.3 }),
    alu: std({ color: 0xcfd3d6, roughness: 0.28, metalness: 1, vertexColors: true }, { wet: 0.3 }),
    canvas: std({ map: TEX.canvas.map, normalMap: TEX.canvas.normalMap, color: o.canvas ?? 0x2a3a4e, roughness: 0.9, side: THREE.DoubleSide, vertexColors: true }, { wet: 1 }),
    black: std({ color: 0x1b1c1e, roughness: 0.45, vertexColors: true }, { wet: 0.5 }),
    rubber: std({ color: 0x2a2a2c, roughness: 0.85, vertexColors: true }, { wet: 0.5 }),
    rope: std({ map: TEX.rope.map, normalMap: TEX.rope.normalMap, color: 0xf2efe6, roughness: 0.9, vertexColors: true }, { wet: 1 }),
    orange: std({ color: 0xe8631c, roughness: 0.7, vertexColors: true }, { wet: 0.8 }),
    yellow: std({ color: 0xe8c41a, roughness: 0.55, vertexColors: true }, { wet: 0.8 }),
    red: std({ color: 0xb8262a, roughness: 0.55, vertexColors: true }, { wet: 0.8 }),
    coolerWhite: std({ color: 0xeef0ee, roughness: 0.5, vertexColors: true }, { wet: 0.6 }),
    coolerBlue: std({ color: 0x2f6f9a, roughness: 0.45, vertexColors: true }, { wet: 0.6 }),
    glass: new THREE.MeshPhysicalMaterial({ color: 0xd8e6ee, roughness: 0.05, metalness: 0, transmission: 0, transparent: true, opacity: 0.28, depthWrite: false }),
    screen: std({ color: 0x0a0e12, roughness: 0.08, metalness: 0.2, emissive: 0x1a3a50, emissiveIntensity: 0.25 }),
    navRed: new THREE.MeshBasicMaterial({ color: 0xff2a1a }),
    navGreen: new THREE.MeshBasicMaterial({ color: 0x20ff60 }),
    navWhite: new THREE.MeshBasicMaterial({ color: 0xfff4e0 }),
    motor: std({ color: 0x2c3035, roughness: 0.3, metalness: 0.2, vertexColors: true }, { wet: 0.4 }),
    motorGray: std({ color: 0x8f969c, roughness: 0.35, metalness: 0.6, vertexColors: true }, { wet: 0.4 }),
    prop: std({ color: 0xb9bec2, roughness: 0.2, metalness: 1, vertexColors: true }),
  };
  const add = (geo, mat, cast = true) => { const m = new THREE.Mesh(geo, mat); m.castShadow = cast; m.receiveShadow = true; g.add(m); return m; };

  // --- hull shells (outer, inner) with real thickness and gunwale cap
  const outer = hullGeo(0, false); boxUV(outer, 0.6);
  ensureColor(outer); shade(outer, (x, y) => 0.85 + 0.15 * clamp((y + 0.3) / 0.8, 0, 1));
  add(outer, mats.hull);
  const inner = hullGeo(0.045, true); boxUV(inner, 0.6); ensureColor(inner);
  shade(inner, (x, y) => 0.7 + 0.3 * clamp((y - 0.1) / 0.5, 0, 1));
  add(inner, mats.inner);
  // boot stripe band (slightly proud of the hull)
  { const a = [], b = [];
    for (let side of [-1, 1]) {
      const pa = [], pb = [];
      for (let i = 0; i <= NT; i++) { const t = i / NT; const uA = 0.6, uB = 0.68;
        const [xa, ya] = sectionPt(t, uA, -0.006), [xb, yb] = sectionPt(t, uB, -0.006);
        pa.push(new V3(side * xa, ya, zOf(t))); pb.push(new V3(side * xb, yb, zOf(t))); }
      const gs = side > 0 ? stripG(pa, pb) : stripG(pb, pa);
      add(gs, mats.stripe);
    }
  }
  // gunwale cap: joins outer & inner edges (thickness visible), plus rubrail tube
  { const capO = [], capI = [], rub = [];
    for (let side of [-1, 1]) {
      const po = [], pi = [];
      for (let i = 0; i <= NT; i++) { const t = i / NT; const [xo, yo] = sectionPt(t, 1, 0), [xi, yi] = sectionPt(t, 1, 0.045);
        po.push(new V3(side * xo, yo + 0.012, zOf(t))); pi.push(new V3(side * xi, yi + 0.012, zOf(t))); }
      add(side > 0 ? stripG(pi, po) : stripG(po, pi), mats.hull);
      const rp = po.map((p) => new V3(p.x + Math.sign(p.x) * 0.012, p.y - 0.035, p.z));
      add(tube(rp.filter((p, k) => k < NT), rp.filter((p, k) => k < NT).map(() => 0.028), 6), mats.black);
      // fasteners along the rubrail
      const fs = [];
      for (let k = 1; k < NT - 1; k += 1) { const p = rp[k]; fs.push(sph(0.012, 5, 4, { x: p.x + Math.sign(p.x) * 0.025, y: p.y, z: p.z })); }
      add(merge(fs), mats.steel, false);
    }
  }
  // transom with thickness + swim platforms
  { const pts = []; for (let j = -NU; j <= NU; j++) { const [x, y] = sectionPt(0, Math.abs(j) / NU, 0); pts.push(new THREE.Vector2(Math.sign(j) * x, y)); }
    const sh = new THREE.Shape(pts); const tg = extrude(sh, 0.05, { z: zOf(0) - 0.025 }); boxUV(tg, 0.6); add(tg, mats.hull);
    for (const sx of [-1, 1]) { const pl = rbox(0.62, 0.07, 0.42, 0.03, { x: sx * 0.62, y: 0.12, z: zOf(0) + 0.22 }); boxUV(pl, 1); add(pl, mats.deck); }
  }
  // cockpit sole (non-slip deck)
  { const a = [], b = [], ys = 0.12;
    for (let i = 2; i <= NT * 0.84; i++) { const t = i / NT; const w = innerHalfAt(t, ys) - 0.01; a.push(new V3(-w, ys, zOf(t))); b.push(new V3(w, ys, zOf(t))); }
    const dg = stripG(a, b); boxUV(dg, 0.5); ensureColor(dg); add(dg, mats.deck);
    // foredeck at sheer level
    const fa = [], fb = [];
    for (let i = Math.round(NT * 0.84); i <= NT; i++) { const t = i / NT; const w = sectionPt(t, 1, 0.04)[0]; fa.push(new V3(-w, sheer(t) - 0.005, zOf(t))); fb.push(new V3(w, sheer(t) - 0.005, zOf(t))); }
    const fg = stripG(fa, fb); boxUV(fg, 0.5); add(fg, mats.hull);
    // foredeck bulkhead
    const t0 = 0.84; const w0 = innerHalfAt(t0, 0.12); const bh = rbox(w0 * 2, sheer(t0) - 0.12, 0.04, 0.01, { y: (sheer(t0) + 0.12) / 2, z: zOf(t0) }); add(bh, mats.inner);
    // anchor locker hatch
    add(rbox(0.5, 0.02, 0.4, 0.01, { y: sheer(0.92) + 0.01, z: zOf(0.92) }), mats.inner);
  }
  // structural ribs (frames) on the inner hull above the sole
  { const ribs = [];
    for (let i = 3; i < NT * 0.84; i += 2) { const t = i / NT; for (const side of [-1, 1]) {
      const pts = [], rad = [];
      for (let k = 0; k <= 8; k++) { const u = lerp(0.35, 0.98, k / 8); const [x, y] = sectionPt(t, u, 0.06); if (y < 0.13) continue; pts.push(new V3(side * x, y, zOf(t))); rad.push(0.022); }
      if (pts.length > 1) ribs.push(tube(pts, rad, 4));
    } }
    add(merge(ribs), mats.inner);
  }
  // --- seating: stern U-lounge + bow seats (upholstered, stitched) on fiberglass bases
  const seatBase = [], cush = [], trim = [];
  const cushion = (w, h, d, o, rot = 0) => { const c = rbox(w, h, d, 0.05, { ...o, ry: rot }, 3); boxUV(c, 1.4); cush.push(c); trim.push(tf(new THREE.BoxGeometry(w - 0.02, 0.012, d - 0.02), { x: o.x, y: o.y - h / 2 + 0.01, z: o.z, ry: rot })); };
  { // aft bench across transom
    const zA = zOf(0.06);
    seatBase.push(rbox(1.75, 0.42, 0.52, 0.03, { y: 0.33, z: zA - 0.02 }));
    cushion(1.72, 0.12, 0.5, { y: 0.6, z: zA - 0.02 });
    cushion(1.72, 0.42, 0.1, { y: 0.8, z: zA + 0.24 });
    // side benches
    for (const sx of [-1, 1]) {
      const t0 = 0.12, t1 = 0.42; const zc = (zOf(t0) + zOf(t1)) / 2, len = zOf(t0) - zOf(t1);
      const xin = innerHalfAt(0.27, 0.5) - 0.27;
      seatBase.push(rbox(0.46, 0.42, len, 0.03, { x: sx * xin, y: 0.33, z: zc }));
      cushion(0.46, 0.12, len - 0.04, { x: sx * xin, y: 0.6, z: zc });
      cushion(0.1, 0.36, len - 0.1, { x: sx * (xin + 0.25), y: 0.83, z: zc }, 0);
    }
    // bow seats
    for (const sx of [-1, 1]) {
      const t0 = 0.64, t1 = 0.8; const zc = (zOf(t0) + zOf(t1)) / 2, len = zOf(t0) - zOf(t1);
      const xin = innerHalfAt(0.72, 0.5) - 0.24;
      seatBase.push(rbox(0.4, 0.38, len, 0.03, { x: sx * xin, y: 0.31, z: zc, ry: sx * 0.12 }));
      cushion(0.4, 0.11, len - 0.04, { x: sx * xin, y: 0.56, z: zc }, sx * 0.12);
    }
  }
  const sb = merge(seatBase); boxUV(sb, 0.6); add(sb, mats.inner);
  add(merge(cush), mats.uphol); add(merge(trim), mats.upholTrim, false);

  // --- center console with helm
  const helm = new THREE.Group();
  const zCon = zOf(0.55);
  { const cons = [];
    cons.push(rbox(0.72, 0.86, 0.62, 0.06, { y: 0.12 + 0.43, z: zCon }));
    // angled dash
    cons.push(rbox(0.72, 0.1, 0.46, 0.03, { y: 1.02, z: zCon + 0.08, rx: -0.55 }));
    const cg = merge(cons); boxUV(cg, 0.8); add(cg, mats.hull);
    // windscreen with frame
    const ws = rbox(0.78, 0.36, 0.012, 0.01, { y: 1.28, z: zCon - 0.2, rx: 0.3 }); add(ws, mats.glass, false);
    add(tube([new V3(-0.4, 1.1, zCon - 0.14), new V3(-0.4, 1.45, zCon - 0.25), new V3(0.4, 1.45, zCon - 0.25), new V3(0.4, 1.1, zCon - 0.14)], [0.012, 0.012, 0.012, 0.012], 6), mats.steel);
    // display (no text, dark glass with soft glow)
    add(box(0.26, 0.16, 0.012, { y: 1.07, z: zCon + 0.02, rx: -0.55 }), mats.screen, false);
    // compass dome
    add(sph(0.05, 12, 8, { x: -0.2, y: 1.08, z: zCon + 0.05 }), mats.black, false);
    // grab rail around console
    add(tube([new V3(-0.38, 0.95, zCon + 0.3), new V3(-0.4, 1.02, zCon + 0.05), new V3(-0.4, 1.02, zCon - 0.2), new V3(-0.38, 0.95, zCon - 0.3)], [0.016, 0.016, 0.016, 0.016], 6), mats.steel);
  }
  // steering wheel (rim + spokes + hub) on the dash, tilted
  const wheel = new THREE.Group();
  { const wg = [tor(0.19, 0.018, 8, 36), cyl(0.04, 0.04, 0.05, 12, { rx: Math.PI / 2 })];
    for (let k = 0; k < 3; k++) { const a = k / 3 * Math.PI * 2 + Math.PI / 2; wg.push(box(0.17, 0.014, 0.014, { x: Math.cos(a) * 0.1, y: Math.sin(a) * 0.1, rz: a })); }
    const wm = new THREE.Mesh(merge(wg), mats.steel); wm.castShadow = true; wheel.add(wm);
    const grip = new THREE.Mesh(tor(0.19, 0.022, 8, 36, {}, Math.PI * 0.5), mats.rubber); grip.rotation.z = Math.PI * 0.25; wheel.add(grip);
    const grip2 = grip.clone(); grip2.rotation.z = Math.PI * 1.25; wheel.add(grip2);
  }
  const wheelMount = new THREE.Group();
  wheelMount.position.set(0.02, 1.02, zCon + 0.25); wheelMount.rotation.x = -0.95; // tilted towards skipper
  wheelMount.add(wheel);
  add(cyl(0.03, 0.03, 0.12, 8, { x: 0.02, y: 1.0, z: zCon + 0.2, rx: Math.PI / 2 - 0.95 }), mats.black);
  g.add(wheelMount);
  // throttle binnacle on starboard side of console
  const throttle = new THREE.Group();
  { add(rbox(0.12, 0.1, 0.18, 0.02, { x: 0.33, y: 0.98, z: zCon + 0.12 }), mats.black);
    const lever = new THREE.Mesh(merge([box(0.025, 0.2, 0.025, { y: 0.1 }), cyl(0.028, 0.028, 0.12, 10, { y: 0.2, rz: Math.PI / 2, x: 0.02 })]), mats.steel);
    lever.castShadow = true;
    throttle.add(lever); throttle.position.set(0.33, 1.02, zCon + 0.12); g.add(throttle);
  }
  // --- bimini canopy on aluminium bows
  { const zF = zOf(0.62), zA = zOf(0.22), top = 2.16;
    const bows = [];
    const bowTube = (z, tilt) => {
      const pts = [];
      const w = innerHalfAt(0.4, 0.5) + 0.04;
      const base = sheer(0.4) + 0.02;
      for (let k = 0; k <= 16; k++) { const a = k / 16; const x = lerp(-w, w, a); const y = base + (top - base) * Math.pow(Math.sin(a * Math.PI), 0.18) * (1 - 0.06 * Math.pow(2 * a - 1, 2)); pts.push(new V3(x * (0.96 + 0.04 * Math.sin(a * Math.PI)), y, z + tilt * (y - base))); }
      bows.push(tube(pts, pts.map(() => 0.018), 6));
      return pts;
    };
    const b1 = bowTube(zF + 0.3, -0.45), b2 = bowTube(zA - 0.35, 0.4);
    add(merge(bows), mats.alu);
    // deck hinges
    const hin = [];
    for (const p of [b1[0], b1[16], b2[0], b2[16]]) hin.push(rbox(0.06, 0.04, 0.08, 0.01, { x: p.x, y: p.y, z: p.z }));
    add(merge(hin), mats.steel);
    // canvas top with sag, spanning between the two bows' upper sections
    const pos = [], uv = [], idx = [];
    const N = 12;
    for (let i = 0; i <= N; i++) for (let j = 0; j <= 10; j++) {
      const a = i / N, b = j / 10;
      const k = Math.round(lerp(3, 13, a));
      const p1 = b1[k], p2 = b2[k];
      const p = new V3().lerpVectors(p1, p2, b);
      p.y += 0.03 - 0.06 * Math.sin(b * Math.PI) * 0.4;
      // extend slightly past the bows
      p.z += (b - 0.5) * 0.25;
      pos.push(p.x, p.y + 0.02, p.z); uv.push(a * 2, b * 2);
    }
    for (let i = 0; i < N; i++) for (let j = 0; j < 10; j++) { const a = i * 11 + j, b = a + 1, c = a + 11, d = c + 1; idx.push(a, c, b, b, c, d); }
    const cg = new THREE.BufferGeometry(); cg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); cg.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); cg.setIndex(idx); cg.computeVertexNormals();
    const canvasMesh = add(cg, mats.canvas);
    canvasMesh.userData.base = pos.slice();
    g.userData.canvas = canvasMesh;
    // support straps (webbing) to the hull
    const straps = [];
    for (const sx of [-1, 1]) {
      straps.push(tube([b1[sx < 0 ? 5 : 11], new V3(sx * (sectionPt(0.9, 1, 0)[0] - 0.05), sheer(0.9), zOf(0.9))], [0.008, 0.008], 4));
      straps.push(tube([b2[sx < 0 ? 5 : 11], new V3(sx * (sectionPt(0.05, 1, 0)[0] - 0.05), sheer(0.05), zOf(0.05))], [0.008, 0.008], 4));
    }
    add(merge(straps), mats.black, false);
    // all-round white light on the aft bow top
    add(cyl(0.012, 0.012, 0.25, 6, { y: top + 0.14, z: b2[8].z }), mats.alu);
    const wl = new THREE.Mesh(sph(0.04, 10, 8, { y: top + 0.29, z: b2[8].z }), mats.navWhite); g.add(wl); g.userData.navWhite = wl;
  }
  // --- bow rail (pulpit) & cleats
  { const rails = [], posts = [];
    for (const side of [-1, 1]) {
      const pts = [];
      for (let i = Math.round(NT * 0.72); i <= NT - 1; i++) { const t = i / NT; const [x] = sectionPt(t, 1, 0.07); pts.push(new V3(side * x, sheer(t) + 0.42, zOf(t))); }
      pts.push(new V3(0, sheer(1) + 0.42, zOf(0.985)));
      rails.push(tube(pts, pts.map(() => 0.016), 6));
      for (let k = 0; k < pts.length - 1; k += 3) posts.push(cyl(0.012, 0.014, 0.42, 6, { x: pts[k].x, y: pts[k].y - 0.21, z: pts[k].z }));
    }
    add(merge([...rails, ...posts]), mats.steel);
    const cleat = (x, y, z, ry) => { const c = [rbox(0.2, 0.03, 0.05, 0.012, { y: 0.05 }), cyl(0.014, 0.018, 0.05, 6, { x: -0.05, y: 0.025 }), cyl(0.014, 0.018, 0.05, 6, { x: 0.05, y: 0.025 }), sph(0.008, 4, 3, { x: -0.07, y: 0.0 }), sph(0.008, 4, 3, { x: 0.07, y: 0.0 })]; return tf(merge(c), { x, y, z, ry }); };
    const cl = [cleat(0, sheer(0.95), zOf(0.95), Math.PI / 2)];
    for (const sx of [-1, 1]) { cl.push(cleat(sx * (sectionPt(0.04, 1, 0.05)[0] - 0.06), sheer(0.04), zOf(0.04), 0)); cl.push(cleat(sx * (sectionPt(0.5, 1, 0.05)[0] - 0.05), sheer(0.5), zOf(0.5), Math.PI / 2)); }
    add(merge(cl), mats.steel);
  }
  // --- navigation sidelights (red port, green starboard)
  { for (const side of [-1, 1]) {
      const t = 0.9; const [x] = sectionPt(t, 1, 0);
      add(rbox(0.07, 0.05, 0.1, 0.012, { x: side * (x + 0.005), y: sheer(t) + 0.03, z: zOf(t) }), mats.black, false);
      const lens = new THREE.Mesh(box(0.02, 0.035, 0.07, { x: side * (x + 0.04), y: sheer(t) + 0.03, z: zOf(t) }), side < 0 ? mats.navRed : mats.navGreen);
      g.add(lens); g.userData[side < 0 ? 'navPort' : 'navStar'] = lens;
    } }
  // --- cooler, dry bags, life jackets, coiled lines
  { const cz = zOf(0.2);
    const cool = [rbox(0.6, 0.36, 0.4, 0.05, { y: 0.12 + 0.18, z: cz })];
    add(merge(cool), mats.coolerWhite);
    add(rbox(0.62, 0.07, 0.42, 0.03, { y: 0.12 + 0.39, z: cz }), mats.coolerBlue);
    add(merge([tor(0.06, 0.012, 6, 12, { x: -0.31, y: 0.4, z: cz, ry: Math.PI / 2 }, Math.PI), tor(0.06, 0.012, 6, 12, { x: 0.31, y: 0.4, z: cz, ry: Math.PI / 2 }, Math.PI), box(0.05, 0.05, 0.02, { x: -0.15, y: 0.46, z: cz - 0.21 }), box(0.05, 0.05, 0.02, { x: 0.15, y: 0.46, z: cz - 0.21 })]), mats.black);
    // dry bags (roll-top)
    const dryBag = (x, z, mat, r = 0.16, h = 0.5, ry = 0) => {
      const bodyPts = [];
      for (let k = 0; k <= 10; k++) { const t = k / 10; bodyPts.push(new THREE.Vector2(r * (0.8 + 0.2 * Math.sin(t * Math.PI)) * (t > 0.85 ? 0.7 : 1), t * h)); }
      const body = new THREE.LatheGeometry(bodyPts, 16); tf(body, { x, y: 0.12, z, rz: 1.35, ry });
      add(body, mat);
      add(tf(rbox(0.38, 0.05, 0.1, 0.02, {}), { x, y: 0.12, z, rz: 1.35, ry }).translate(0, 0, 0), mats.black);
    };
    dryBag(-0.2, zOf(0.66), mats.yellow, 0.15, 0.5, 0.2);
    dryBag(0.25, zOf(0.7), mats.red, 0.13, 0.42, -0.3);
    // life jackets stowed on the port side bench
    for (let k = 0; k < 2; k++) {
      const xin = innerHalfAt(0.27, 0.5) - 0.27;
      const lj = [rbox(0.4, 0.07, 0.5, 0.04, {}), rbox(0.18, 0.07, 0.28, 0.03, { y: 0.06, z: 0.12 }), box(0.42, 0.02, 0.03, { y: 0.04, z: -0.1 }), box(0.42, 0.02, 0.03, { y: 0.04, z: 0.05 })];
      const lg = merge(lj); tf(lg, { x: -xin, y: 0.7 + k * 0.08, z: zOf(0.2 + k * 0.1), ry: 0.2 * k });
      add(lg, mats.orange);
    }
    // coiled mooring lines (flat spirals) on foredeck and aft platform
    const coil = (x, y, z, r0, turns) => {
      const pts = []; const n = turns * 24;
      for (let k = 0; k <= n; k++) { const a = k / 24 * Math.PI * 2; const r = r0 - k / n * r0 * 0.45; pts.push(new V3(x + Math.cos(a) * r, y + 0.012 + (k % 24 < 12 ? 0.004 : 0), z + Math.sin(a) * r)); }
      pts.push(new V3(x + r0 * 1.8, y + 0.012, z + 0.1));
      return tube(pts, pts.map(() => 0.012), 5, { uvScale: 6, twist: 0.4 });
    };
    add(merge([coil(0.12, sheer(0.9), zOf(0.9), 0.17, 5), coil(-0.62, 0.155, zOf(0) + 0.2, 0.15, 4)]), mats.rope);
    // line from bow cleat to coil
    add(tube([new V3(0, sheer(0.95) + 0.05, zOf(0.95)), new V3(0.05, sheer(0.92) + 0.02, zOf(0.92)), new V3(0.12 + 0.17, sheer(0.9) + 0.012, zOf(0.9))], [0.012, 0.012, 0.012], 5, { uvScale: 6 }), mats.rope);
  }
  // --- electric outboard with tilt/swivel bracket, shaft, pod, propeller, cowling
  const motor = new THREE.Group();
  const prop = new THREE.Group();
  { const zT = zOf(0) + 0.03;
    // clamp bracket on transom
    const br = [rbox(0.2, 0.3, 0.12, 0.02, { y: sheer(0) - 0.12, z: zT + 0.08 }), cyl(0.02, 0.02, 0.24, 8, { y: sheer(0) - 0.02, z: zT + 0.16, rz: Math.PI / 2 })];
    for (const sx of [-1, 1]) br.push(cyl(0.012, 0.012, 0.16, 6, { x: sx * 0.07, y: sheer(0) - 0.05, z: zT - 0.02, rx: Math.PI / 2 }), cyl(0.028, 0.028, 0.02, 10, { x: sx * 0.07, y: sheer(0) - 0.05, z: zT - 0.1, rx: Math.PI / 2 }));
    add(merge(br), mats.motorGray);
    // swivel group
    motor.position.set(0, 0, zT + 0.2);
    const cow = [rbox(0.34, 0.3, 0.46, 0.1, { y: sheer(0) + 0.28, z: 0.02 }, 4)];
    const cowM = new THREE.Mesh(merge(cow), mats.motor); cowM.castShadow = true; motor.add(cowM);
    const cap = new THREE.Mesh(rbox(0.3, 0.08, 0.4, 0.04, { y: sheer(0) + 0.45, z: 0.02 }, 3), mats.motorGray); motor.add(cap);
    // streamlined shaft
    const sh = new THREE.Mesh(merge([rbox(0.07, sheer(0) + 0.35 + 0.1, 0.14, 0.03, { y: (sheer(0) + 0.14 - 0.34) / 2, z: 0.0 })]), mats.motor); sh.castShadow = true; motor.add(sh);
    // cavitation plate
    motor.add(new THREE.Mesh(rbox(0.26, 0.012, 0.3, 0.02, { y: -0.18, z: -0.04 }), mats.motorGray));
    // pod (torpedo) + skeg
    const pod = new THREE.LatheGeometry([new THREE.Vector2(0.001, -0.22), new THREE.Vector2(0.045, -0.18), new THREE.Vector2(0.06, -0.08), new THREE.Vector2(0.06, 0.1), new THREE.Vector2(0.04, 0.16), new THREE.Vector2(0.001, 0.19)], 16);
    pod.rotateX(Math.PI / 2); pod.translate(0, -0.42, 0.0);
    motor.add(new THREE.Mesh(pod, mats.motor));
    motor.add(new THREE.Mesh(rbox(0.012, 0.14, 0.12, 0.004, { y: -0.52, z: 0.02 }), mats.motor));
    // propeller: 3 blades
    const blades = [];
    for (let k = 0; k < 3; k++) {
      const bl = new THREE.SphereGeometry(0.1, 10, 6, 0, Math.PI, 0, Math.PI / 2); bl.scale(0.55, 1.1, 0.12); bl.rotateY(0.5); bl.translate(0, 0.08, 0);
      blades.push(tf(bl, { rz: k * Math.PI * 2 / 3 }));
    }
    blades.push(cyl(0.03, 0.02, 0.07, 10, { rx: Math.PI / 2 }));
    const pm = new THREE.Mesh(merge(blades), mats.prop); prop.add(pm);
    prop.position.set(0, -0.42, 0.2);
    motor.add(prop);
    g.add(motor);
  }
  // --- folding boarding ladder (folded up on the starboard platform)
  { const lad = [];
    const x0 = 0.62, z0 = zOf(0) + 0.3;
    for (const sx of [-0.13, 0.13]) lad.push(tube([new V3(x0 + sx, 0.16, z0 - 0.02), new V3(x0 + sx, 0.62, z0 + 0.02), new V3(x0 + sx, 0.66, z0 + 0.09)], [0.013, 0.013, 0.013], 6));
    for (let k = 0; k < 3; k++) lad.push(rbox(0.3, 0.018, 0.06, 0.008, { x: x0, y: 0.26 + k * 0.13, z: z0 + 0.0 + k * 0.006, rx: -0.1 }));
    lad.push(cyl(0.02, 0.02, 0.34, 8, { x: x0, y: 0.16, z: z0 - 0.02, rz: Math.PI / 2 }));
    add(merge(lad), mats.steel);
  }
  g.userData = { ...g.userData, wheel, wheelMount, throttle, motor, prop, mats, zCon };
  return g;
}

function stripG(a, b) {
  const pos = [], idx = [], uv = [];
  for (let i = 0; i < a.length; i++) { pos.push(a[i].x, a[i].y, a[i].z, b[i].x, b[i].y, b[i].z); uv.push(i * 0.2, 0, i * 0.2, 1); }
  for (let i = 0; i < a.length - 1; i++) { const k = i * 2; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
  return g;
}

// ---------------------------------------------------------------- water surface sampling (matches water vertex shader)
export function waveH(x, z, t, tide) {
  return tide + 0.035 * Math.sin(x * 0.21 + t * 1.3) + 0.03 * Math.sin(z * 0.17 - t * 1.1) + 0.02 * Math.sin((x + z) * 0.37 + t * 2.1);
}

// ---------------------------------------------------------------- autopilot lane
export const LANE = { s0: -100, ds: 2, d: null };
export function buildLane(lm) {
  const n = Math.ceil((LOOP_END + 200 - LANE.s0) / LANE.ds) + 1;
  const d = new Float32Array(n), lock = new Float32Array(n), lockV = new Float32Array(n);
  const pref = (s) => {
    let p = 32;
    p = lerp(p, 42, smooth(260, 400, s));
    p = lerp(p, 48, smooth(560, 700, s));
    p = lerp(p, 62, smooth(820, 880, s));
    p = lerp(p, 44, smooth(950, 985, s));
    p = lerp(p, 12, smooth(1000, 1120, s));
    p = lerp(p, 8, smooth(1400, 1500, s));
    return p;
  };
  for (let i = 0; i < n; i++) d[i] = pref(LANE.s0 + i * LANE.ds);
  // bridge arch locks
  const lockArch = (sB, dL, bay, spans, want) => {
    let best = 0, bd = 1e9;
    for (let k = 0; k < spans; k++) { const c = dL + bay * (k + 0.5); if (Math.abs(c - want) < bd) { bd = Math.abs(c - want); best = c; } }
    for (let i = 0; i < n; i++) { const s = LANE.s0 + i * LANE.ds; const w = 1 - smooth(18, 34, Math.abs(s - sB)); if (w > lock[i]) { lock[i] = w; lockV[i] = best; } }
  };
  const mb = lm.memorial; lockArch(200, mb.dL, mb.bay, mb.spans, 25);
  const kb = lm.key; lockArch(kb.s, kb.dL, kb.bay, 5, 44);
  // obstacle clearance
  for (let it = 0; it < 6; it++) {
    for (const o of obstacles) {
      const margin = o.kind === 'pier' ? 4 : 7;
      const i0 = Math.max(0, Math.floor((o.s - o.rs - 22 - LANE.s0) / LANE.ds)), i1 = Math.min(n - 1, Math.ceil((o.s + o.rs + 22 - LANE.s0) / LANE.ds));
      for (let i = i0; i <= i1; i++) {
        const gap = d[i] - o.d; const need = o.rd + margin + 2.5;
        if (Math.abs(gap) < need) d[i] = o.d + Math.sign(gap || 1) * need;
      }
    }
    // island & banks
    for (let i = 0; i < n; i++) {
      const s = LANE.s0 + i * LANE.ds;
      const lim = hwR(s) - 16; if (d[i] > lim) d[i] = lim;
      const liml = -hwL(s) + 16; if (d[i] < liml) d[i] = liml;
      while (islandMask(s, d[i]) > -0.35 && d[i] < lim) d[i] += 1;
    }
    for (let i = 0; i < n; i++) if (lock[i] > 0) d[i] = lerp(d[i], lockV[i], lock[i]);
    // smooth
    const tmp = Float32Array.from(d);
    const K = 10;
    for (let i = 0; i < n; i++) { let a = 0, w = 0; for (let k = -K; k <= K; k++) { const j = clamp(i + k, 0, n - 1); const ww = Math.exp(-(k * k) / (K * K * 0.35)); a += tmp[j] * ww; w += ww; } d[i] = a / w; }
    for (let i = 0; i < n; i++) if (lock[i] > 0) d[i] = lerp(d[i], lockV[i], lock[i]);
  }
  LANE.d = d; LANE.n = n;
}
export function laneAt(s) { const f = clamp((s - LANE.s0) / LANE.ds, 0, LANE.n - 1.001); const i = Math.floor(f); return lerp(LANE.d[i], LANE.d[i + 1], f - i); }

// ---------------------------------------------------------------- physics
export class Boat {
  constructor(model) {
    this.model = model;
    this.root = new THREE.Group(); this.root.add(model);
    this.x = 0; this.z = 0; this.psi = 0; this.u = 5; this.v = 0; this.r = 0;
    this.throttle = 0.7; this.rudder = 0; this.roll = 0; this.pitch = 0; this.heave = 0; this.rollV = 0; this.pitchV = 0;
    this.auto = true; this.idle = 0; this.s = 0; this.d = 0; this.propA = 0;
    this.acc = 0; this.lastU = 0; this.bump = 0;
    this.keys = {};
  }
  reset(s) {
    const d = laneAt(s); const [x, z] = fromSD(s, d); const F = frame(s);
    this.x = x; this.z = z; this.psi = F.th; this.u = 5.5; this.v = 0; this.r = 0; this.s = s; this.d = d;
  }
  fwd() { return [Math.sin(this.psi), -Math.cos(this.psi)]; }
  // physics runs in short substeps so the speed holds up even when frames are slow
  update(dt, t, tide) {
    const n = Math.max(1, Math.ceil(dt / 0.025));
    for (let i = 0; i < n; i++) this.step(dt / n, t - dt + dt * (i + 1) / n, tide);
  }
  step(dt, t, tide) {
    if (this.script) return this.scripted(dt, t, tide);
    const K = this.keys;
    this.boostK = lerp(this.boostK || 1, K.boost ? 2.6 : 1, 1 - Math.exp(-dt * 1.5));
    const manual = K.up || K.down || K.left || K.right;
    if (manual) { this.auto = false; this.idle = 0; }
    else { this.idle += dt; if (!this.auto && this.idle > 4) this.auto = true; }
    const { s, d } = toSD(this.x, this.z); this.s = s; this.d = d;
    const F = frame(s);
    let rud = 0, thr = 0;
    if (this.auto) {
      // pure pursuit on the lane
      const look = 22 + this.u * 2.2;
      const sT = s + look; const dT = laneAt(sT);
      const [tx, tz] = fromSD(sT, dT);
      const want = Math.atan2(tx - this.x, -(tz - this.z));
      let err = want - this.psi; while (err > Math.PI) err -= 2 * Math.PI; while (err < -Math.PI) err += 2 * Math.PI;
      rud = clamp(err * 2.6 - this.r * 1.4, -1, 1);
      const cruise = K.boost ? 10.5 : 6.3;
      thr = clamp(0.62 + (cruise - this.u) * 0.35, 0, 1);
      if (this.avoid) { rud = clamp(rud + this.avoid.rud, -1, 1); thr *= this.avoid.thr; }
    } else {
      thr = K.up ? 1 : K.down ? -0.5 : 0.25;
      rud = (K.right ? 1 : 0) - (K.left ? 1 : 0);
    }
    // actuator lag (helm & throttle inertia)
    this.rudder += clamp(rud - this.rudder, -dt * 2.2, dt * 2.2);
    this.throttle += clamp(thr - this.throttle, -dt * 0.9, dt * 0.7);
    // dynamics (water-relative)
    const thrust = this.throttle * (this.throttle >= 0 ? 2.4 * this.boostK : 1.3);
    const du = thrust - 0.043 * this.u * Math.abs(this.u) - 0.03 * this.u + this.v * this.r * 0.4;
    const dv = -2.6 * this.v - this.u * this.r * 0.22;
    const dr = this.rudder * this.u * 0.12 * (this.u >= 0 ? 1 : -0.6) - 1.5 * this.r - 0.4 * this.r * Math.abs(this.r);
    this.u += du * dt; this.v += dv * dt; this.r += dr * dt;
    this.acc = lerp(this.acc, du, 1 - Math.exp(-dt * 4));
    const [fx, fz] = this.fwd(); const rx = -fz, rz = fx;
    const cur = currentAt(s, d);
    let vx = fx * this.u + rx * this.v - F.fx * cur, vz = fz * this.u + rz * this.v - F.fz * cur;
    this.x += vx * dt; this.z += vz * dt; this.psi += this.r * dt;
    this.collide(dt);
    this.speedGround = Math.hypot(vx, vz);
    this.attitude(dt, t, tide);
  }
  // docking / undocking / tied up: the pose comes from a script; everything else (attitude, wake) still runs
  // how far the hull overlaps static obstacles at a pose (ignoring the berth we're docking at)
  obstaclePush(x, z, psi, ignore) {
    const fx = Math.sin(psi), fz = -Math.cos(psi); let ox = 0, oz = 0;
    for (const off of [2.6, 1.2, -0.2, -1.6, -2.8]) {
      const px = x + fx * off, pz = z + fz * off; const { s, d } = toSD(px, pz);
      const rad = off > 2 ? 0.7 : 1.15; let pushD = 0, pushS = 0;
      for (const o of obstacles) {
        if (ignore && o.stop === ignore) continue;
        if (Math.abs(o.s - s) > o.rs + 4 || Math.abs(o.d - d) > o.rd + 4) continue;
        const ds = s - o.s, dd = d - o.d;
        if (o.round) { const R = (o.rs + o.rd) / 2 + rad; const dist = Math.hypot(ds, dd); if (dist < R) { pushS += ds / (dist || 1) * (R - dist); pushD += dd / (dist || 1) * (R - dist); } }
        else { const qx = Math.abs(ds) - (o.rs + rad), qy = Math.abs(dd) - (o.rd + rad); if (qx < 0 && qy < 0) { if (qx > qy) pushS += Math.sign(ds) * -qx; else pushD += Math.sign(dd) * -qy; } }
      }
      if (pushD || pushS) { const F = frame(s); ox += F.rx * pushD + F.fx * pushS; oz += F.rz * pushD + F.fz * pushS; }
    }
    return [ox, oz];
  }
  scripted(dt, t, tide) {
    const px = this.x, pz = this.z, ppsi = this.psi;
    const st = this.script(dt);
    if (!st) { this.script = null; this.sOff = null; return; }
    // follow the planned path, but never through a dock, pier or moored boat: an offset absorbs any overlap
    // and bleeds away once the hull is clear again
    const off = this.sOff || (this.sOff = [0, 0]);
    const [qx, qz] = this.obstaclePush(st.x + off[0], st.z + off[1], st.psi, this.scriptIgnore);
    if (qx || qz) { off[0] += qx * 0.6; off[1] += qz * 0.6; } else { const k = Math.exp(-dt * 0.8); off[0] *= k; off[1] *= k; }
    if (st.pin) { const k = Math.exp(-dt * 3); off[0] *= k; off[1] *= k; }
    this.x = st.x + off[0]; this.z = st.z + off[1]; this.psi = st.psi;
    const { s, d } = toSD(this.x, this.z); this.s = s; this.d = d;
    const [fx, fz] = this.fwd();
    const vf = ((this.x - px) * fx + (this.z - pz) * fz) / Math.max(dt, 1e-4);
    let dpsi = this.psi - ppsi; while (dpsi > Math.PI) dpsi -= 2 * Math.PI; while (dpsi < -Math.PI) dpsi += 2 * Math.PI;
    this.r = lerp(this.r, dpsi / Math.max(dt, 1e-4), 1 - Math.exp(-dt * 8));
    const du = (vf - this.u) / Math.max(dt, 1e-4);
    this.u = vf; this.v = 0; this.speedGround = Math.abs(vf);
    this.acc = lerp(this.acc, clamp(du, -2, 2), 1 - Math.exp(-dt * 4));
    this.rudder = lerp(this.rudder, clamp(this.r * 1.5, -1, 1), 1 - Math.exp(-dt * 3));
    this.throttle = lerp(this.throttle, st.thr ?? clamp(vf / 6 + du * 0.1, -0.6, 1), 1 - Math.exp(-dt * 3));
    this.attitude(dt, t, tide);
  }
  attitude(dt, t, tide) {
    const [fx, fz] = this.fwd(); const rx = -fz, rz = fx;
    // attitude: heel into turns, trim with speed/acceleration, chop
    const heelT = clamp(0.075 * this.u * this.r, -0.2, 0.2);
    const [bx, bz] = [this.x + fx * 2.6, this.z + fz * 2.6], [sx, sz] = [this.x - fx * 2.6, this.z - fz * 2.6];
    // riding the simulated waves (own wake and everyone else's), smoothed over the probe latency
    const pv = SIM.probeVals, ws = this.wakeS || (this.wakeS = [0, 0, 0, 0]);
    for (let i = 0; i < 4; i++) ws[i] += (clamp(pv[i] * 0.3, -0.2, 0.2) - ws[i]) * (1 - Math.exp(-dt * 12));
    const hB = waveH(bx, bz, t, tide) + ws[0], hS = waveH(sx, sz, t, tide) + ws[1], hP = waveH(this.x - rx, this.z - rz, t, tide) + ws[2], hSt = waveH(this.x + rx, this.z + rz, t, tide) + ws[3];
    const wavePitch = Math.atan2(hB - hS, 5.2), waveRoll = Math.atan2(hP - hSt, 2);
    const pitchT = 0.004 * this.u + 0.03 * clamp(this.acc, -1, 2) + wavePitch * 0.8 - this.bump * 0.02;
    const rollT = heelT + waveRoll * 0.7 + Math.sin(t * 1.7) * 0.006;
    // spring-damper for natural motion
    this.rollV += ((rollT - this.roll) * 30 - this.rollV * 6) * dt; this.roll += this.rollV * dt;
    this.pitchV += ((pitchT - this.pitch) * 26 - this.pitchV * 6) * dt; this.pitch += this.pitchV * dt;
    const heaveT = (hB + hS + hP + hSt) / 4 + 0.03 * Math.min(this.u, 7) / 7;
    this.heave = lerp(this.heave, heaveT, 1 - Math.exp(-dt * 6));
    this.bump *= Math.exp(-dt * 3);
    // apply transform
    this.root.position.set(this.x, this.heave, this.z);
    this.root.rotation.set(0, 0, 0);
    this.root.rotation.order = 'YXZ';
    this.root.rotation.y = -this.psi; this.root.rotation.x = this.pitch; this.root.rotation.z = -this.roll;
    // controls & prop
    const ud = this.model.userData;
    ud.wheel.rotation.z = -this.rudder * 1.9;
    ud.throttle.rotation.x = -this.throttle * 0.7;
    ud.motor.rotation.y = -this.rudder * 0.45;
    this.propA += this.throttle * dt * 60; ud.prop.rotation.z = this.propA;
  }
  // hull circles against banks, island and obstacles in (s,d) space
  collide(dt) {
    const [fx, fz] = this.fwd();
    for (const off of [2.5, 0.8, -0.9, -2.5]) {
      const px = this.x + fx * off, pz = this.z + fz * off;
      const { s, d } = toSD(px, pz);
      const rad = off > 2 ? 0.65 : 1.12;
      let pushD = 0, pushS = 0;
      // banks (depth limit ~0.5 m)
      const wr = hwR(s) - 2.5, wl = -hwL(s) + 2.5;
      if (d + rad > wr) pushD = wr - (d + rad);
      if (d - rad < wl) pushD = wl - (d - rad);
      // island (ellipse mask gradient)
      const im = islandMask(s, d);
      if (im > -0.1) { const g = islandMask(s, d + 1) - islandMask(s, d - 1); pushD += -Math.sign(g || 1) * (im + 0.1) * 12; }
      for (const o of obstacles) {
        if (Math.abs(o.s - s) > o.rs + 4 || Math.abs(o.d - d) > o.rd + 4) continue;
        const ds = s - o.s, dd = d - o.d;
        if (o.round) {
          const R = (o.rs + o.rd) / 2 + rad; const dist = Math.hypot(ds, dd);
          if (dist < R) { pushS += ds / (dist || 1) * (R - dist); pushD += dd / (dist || 1) * (R - dist); }
        } else {
          const qx = Math.abs(ds) - (o.rs + rad), qy = Math.abs(dd) - (o.rd + rad);
          if (qx < 0 && qy < 0) { if (qx > qy) pushS += Math.sign(ds) * -qx; else pushD += Math.sign(dd) * -qy; }
        }
      }
      if (pushD || pushS) {
        const F = frame(s);
        const nx = F.rx * pushD + F.fx * pushS, nz = F.rz * pushD + F.fz * pushS;
        const len = Math.hypot(nx, nz) || 1;
        this.x += nx; this.z += nz;
        // remove velocity into the obstacle, small bounce + yaw kick
        const ux = nx / len, uz = nz / len;
        const [bx, bz] = this.fwd(); const rx = -bz, rz = bx;
        const vwx = bx * this.u + rx * this.v, vwz = bz * this.u + rz * this.v;
        const vn = vwx * ux + vwz * uz;
        if (vn < 0) {
          const nvx = vwx - (1.25) * vn * ux, nvz = vwz - (1.25) * vn * uz;
          this.u = nvx * bx + nvz * bz; this.v = nvx * rx + nvz * rz;
          this.r += -off * vn * 0.08 * Math.sign(ux * rx + uz * rz);
          this.bump = Math.min(1, this.bump + Math.abs(vn) * 0.4);
        }
      }
    }
    this.collideDyn();
  }
  // moving boats (traffic, the cruise ship): each is a capsule along its keel; they are far heavier than us
  collideDyn() {
    if (!this.others) return;
    for (const ob of this.others) {
      const dx0 = this.x - ob.x, dz0 = this.z - ob.z;
      if (dx0 * dx0 + dz0 * dz0 > (ob.halfLen + 6) ** 2) continue;
      const ofx = Math.sin(ob.psi), ofz = -Math.cos(ob.psi);
      const seg = Math.max(0, ob.halfLen - ob.halfBeam * 0.9);
      for (const off of [2.5, 0.8, -0.9, -2.5]) {
        const [fx, fz] = this.fwd();
        const px = this.x + fx * off, pz = this.z + fz * off, rad = off > 2 ? 0.65 : 1.12;
        const dx = px - ob.x, dz = pz - ob.z;
        const t = clamp(dx * ofx + dz * ofz, -seg, seg);
        // beam tapers toward the bow
        const hb = ob.halfBeam * (t > 0 ? 1 - 0.55 * Math.pow(t / (seg || 1), 2) : 1);
        const cx = dx - ofx * t, cz = dz - ofz * t; const dist = Math.hypot(cx, cz);
        const R = hb + rad; if (dist >= R) continue;
        const ux = dist > 1e-4 ? cx / dist : -ofz, uz = dist > 1e-4 ? cz / dist : ofx;
        this.x += ux * (R - dist); this.z += uz * (R - dist);
        const [bx, bz] = this.fwd(); const rx = -bz, rz = bx;
        const vwx = bx * this.u + rx * this.v, vwz = bz * this.u + rz * this.v;
        const ovx = ofx * (ob.spd || 0), ovz = ofz * (ob.spd || 0);
        const vn = (vwx - ovx) * ux + (vwz - ovz) * uz;
        if (vn < 0) {
          const nvx = vwx - 1.3 * vn * ux, nvz = vwz - 1.3 * vn * uz;
          this.u = nvx * bx + nvz * bz; this.v = nvx * rx + nvz * rz;
          this.r += -off * vn * 0.08 * Math.sign(ux * rx + uz * rz);
          this.bump = Math.min(1, this.bump + Math.abs(vn) * 0.5);
          this.hit = Math.max(this.hit || 0, Math.min(1, Math.abs(vn) / 3));
        }
      }
    }
  }
}
