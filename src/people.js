// Procedural skinned characters: skipper, woman with red umbrella, groundskeeper. Two-bone IK, breathing, cloth flutter.
import * as THREE from 'three';
import { clamp, lerp, smooth, mulberry32 } from './util.js';
import { std, U } from './matpatch.js';
import TEX from './tex.js';
import { merge, tube, cyl, sph, box, rbox, tf, tor } from './geo.js';

const V3 = THREE.Vector3, Q = THREE.Quaternion;

// ------------------------------------------------------------------ skeleton definition (rest pose, facing -Z, right = +X)
function skeletonDef(h, o) {
  const k = h / 1.75;
  const sw = o.shoulderW || 0.19, hw = o.hipW || 0.095;
  const P = (x, y, z = 0) => new V3(x * k, y * k, z * k);
  return {
    root: [null, P(0, 0)],
    hips: ['root', P(0, 0.98)],
    spine: ['hips', P(0, 1.12)],
    chest: ['spine', P(0, 1.3)],
    neck: ['chest', P(0, 1.5)],
    head: ['neck', P(0, 1.6)],
    headTop: ['head', P(0, 1.76)],
    claL: ['chest', P(-0.04, 1.45)], armL: ['claL', P(-sw, 1.44)], foreL: ['armL', P(-sw - 0.035, 1.15)], handL: ['foreL', P(-sw - 0.05, 0.89)], tipL: ['handL', P(-sw - 0.055, 0.72)],
    claR: ['chest', P(0.04, 1.45)], armR: ['claR', P(sw, 1.44)], foreR: ['armR', P(sw + 0.035, 1.15)], handR: ['foreR', P(sw + 0.05, 0.89)], tipR: ['handR', P(sw + 0.055, 0.72)],
    thighL: ['hips', P(-hw, 0.93)], shinL: ['thighL', P(-hw - 0.005, 0.5)], footL: ['shinL', P(-hw - 0.01, 0.085)], toeL: ['footL', P(-hw - 0.012, 0.02, -0.15)],
    thighR: ['hips', P(hw, 0.93)], shinR: ['thighR', P(hw + 0.005, 0.5)], footR: ['shinR', P(hw + 0.01, 0.085)], toeR: ['footR', P(hw + 0.012, 0.02, -0.15)],
  };
}

// ------------------------------------------------------------------ mesh builder with skin weights
class MB {
  constructor(boneIndex) { this.p = []; this.c = []; this.si = []; this.sw = []; this.fl = []; this.idx = []; this.bi = boneIndex; }
  vert(p, col, bones, fl = 0) {
    this.p.push(p.x, p.y, p.z); this.c.push(col[0], col[1], col[2]);
    const b = bones.slice(0, 4); while (b.length < 4) b.push([bones[0][0], 0]);
    let tw = 0; for (const [, w] of b) tw += w;
    for (const [n, w] of b) { this.si.push(this.bi[n]); this.sw.push(w / tw); }
    this.fl.push(fl);
    return this.p.length / 3 - 1;
  }
  // generic ring loft: rings = [{c: V3, ax: V3, az: V3, rx, rz, bones, col, fl}]
  loft(rings, seg, capStart = false, capEnd = false) {
    const base = this.p.length / 3;
    for (const r of rings) {
      for (let j = 0; j <= seg; j++) {
        const a = j / seg * Math.PI * 2;
        const p = r.c.clone().addScaledVector(r.ax, Math.cos(a) * r.rx).addScaledVector(r.az, Math.sin(a) * r.rz);
        const col = typeof r.col === 'function' ? r.col(a) : r.col;
        this.vert(p, col, r.bones, typeof r.fl === 'function' ? r.fl(a) : (r.fl || 0));
      }
    }
    // keep faces outward whichever way the rings run
    const along = rings[rings.length - 1].c.clone().sub(rings[0].c);
    const flip = along.dot(new V3().crossVectors(rings[0].ax, rings[0].az)) < 0;
    for (let i = 0; i < rings.length - 1; i++) for (let j = 0; j < seg; j++) {
      const a = base + i * (seg + 1) + j, b = a + seg + 1;
      if (flip) this.idx.push(a, b, a + 1, a + 1, b, b + 1); else this.idx.push(a, a + 1, b, a + 1, b + 1, b);
    }
    const flipAll = flip;
    const cap = (ri, flip) => {
      const r = rings[ri]; const c = this.vert(r.c, typeof r.col === 'function' ? r.col(0) : r.col, r.bones, 0);
      const b0 = base + ri * (seg + 1);
      for (let j = 0; j < seg; j++) (flip !== flipAll) ? this.idx.push(c, b0 + j + 1, b0 + j) : this.idx.push(c, b0 + j, b0 + j + 1);
    };
    if (capStart) cap(0, true);
    if (capEnd) cap(rings.length - 1, false);
  }
  // add a rigid geometry skinned to a single bone (or blended)
  addGeo(g, col, bones, fl = 0) {
    const gg = g.index ? g.toNonIndexed() : g;
    const p = gg.attributes.position; const base = this.p.length / 3;
    const cattr = gg.attributes.color;
    for (let i = 0; i < p.count; i++) this.vert(new V3(p.getX(i), p.getY(i), p.getZ(i)), cattr ? [cattr.getX(i) * col[0], cattr.getY(i) * col[1], cattr.getZ(i) * col[2]] : col, typeof bones === 'function' ? bones(p.getY(i), p.getX(i), p.getZ(i)) : bones, fl);
    for (let i = 0; i < p.count; i++) this.idx.push(base + i);
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(this.si, 4));
    g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(this.sw, 4));
    g.setAttribute('aFlutter', new THREE.Float32BufferAttribute(this.fl, 1));
    g.setIndex(this.idx);
    g.computeVertexNormals();
    // uv from position (cloth texture)
    const p = g.attributes.position; const uv = new Float32Array(p.count * 2);
    for (let i = 0; i < p.count; i++) { uv[i * 2] = (p.getX(i) + p.getZ(i)) * 3; uv[i * 2 + 1] = p.getY(i) * 3; }
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    return g;
  }
}

const X = new V3(1, 0, 0), Y = new V3(0, 1, 0), Z = new V3(0, 0, 1);

// ------------------------------------------------------------------ character
export function buildHuman(o) {
  const H = o.height || 1.75; const k = H / 1.75;
  const def = skeletonDef(H, o);
  const names = Object.keys(def);
  const boneIndex = {}; names.forEach((n, i) => (boneIndex[n] = i));
  const bones = {}; const restW = {};
  for (const n of names) { const b = new THREE.Bone(); b.name = n; bones[n] = b; restW[n] = def[n][1].clone(); }
  for (const n of names) { const [par, p] = def[n]; if (par) { bones[par].add(bones[n]); bones[n].position.copy(p).sub(def[par][1]); } else bones[n].position.copy(p); }
  const mb = new MB(boneIndex);
  const C = o.colors;
  const W = (n) => restW[n];
  const blend = (a, b, t) => [[a, 1 - t], [b, t]];
  // ---- legs (pants) with boots
  for (const s of ['L', 'R']) {
    const hip = W('thigh' + s), knee = W('shin' + s), ank = W('foot' + s);
    const rings = [];
    const n = 16;
    for (let i = 0; i <= n; i++) {
      const t = i / n; let c, bns, r;
      if (t < 0.5) { const u = t / 0.5; c = hip.clone().lerp(knee, u); r = lerp(0.1, 0.064, Math.pow(u, 0.8)) * k; bns = u < 0.12 ? blend('hips', 'thigh' + s, 0.5 + u * 4) : u > 0.82 ? blend('thigh' + s, 'shin' + s, (u - 0.82) / 0.36) : [['thigh' + s, 1]]; }
      else { const u = (t - 0.5) / 0.5; c = knee.clone().lerp(ank, u); r = (lerp(0.064, 0.046, u) + 0.01 * Math.sin(u * Math.PI) * (u < 0.6 ? 1 : 0)) * k; bns = u < 0.18 ? blend('thigh' + s, 'shin' + s, 0.5 + u / 0.36) : [['shin' + s, 1]]; }
      if (o.pantsFlare && t > 0.8) r *= 1 + (t - 0.8) * 0.8;
      const pantsTop = t < 0.06 ? C.top2 || C.bottom : C.bottom;
      rings.push({ c: c.clone().add(new V3(0, 0, t < 0.5 ? -0.008 : 0.004)), ax: X, az: Z, rx: r * (t < 0.5 ? 1.0 : 0.95), rz: r * 1.05, bones: bns, col: pantsTop });
    }
    mb.loft(rings, 12);
    // shoe
    const shoe = rbox(0.1 * k, 0.085 * k, 0.27 * k, 0.035 * k, {}, 3);
    const sp = shoe.attributes.position;
    for (let i = 0; i < sp.count; i++) { const z = sp.getZ(i); const y = sp.getY(i); if (z < -0.06 * k) sp.setY(i, y - (z + 0.06 * k) * 0.25 * (y > 0 ? 1 : 0)); }
    tf(shoe, { x: ank.x, y: 0.04 * k, z: -0.05 * k });
    mb.addGeo(shoe, C.shoes, [['foot' + s, 1]]);
    const sole = rbox(0.104 * k, 0.018 * k, 0.275 * k, 0.008, { x: ank.x, y: 0.006 * k, z: -0.05 * k });
    mb.addGeo(sole, [0.12, 0.1, 0.09], [['foot' + s, 1]]);
  }
  // ---- torso (jacket / coat) lofted along spine
  const tl = [
    { y: 0.86, rx: 0.155, rz: 0.1, z: 0.005, b: [['hips', 1]] },
    { y: 0.92, rx: 0.17 * (o.hipK || 1), rz: 0.11, z: 0.0, b: [['hips', 1]] },
    { y: 1.0, rx: 0.165 * (o.hipK || 1), rz: 0.11, z: 0.0, b: [['hips', 0.8], ['spine', 0.2]] },
    { y: 1.08, rx: 0.15 * (o.waistK || 1), rz: 0.1, z: 0.0, b: [['hips', 0.3], ['spine', 0.7]] },
    { y: 1.17, rx: 0.155, rz: 0.105, z: -0.005, b: [['spine', 0.7], ['chest', 0.3]] },
    { y: 1.27, rx: 0.165, rz: 0.115 * (o.chestK || 1), z: -0.012, b: [['spine', 0.2], ['chest', 0.8]] },
    { y: 1.36, rx: 0.175, rz: 0.118 * (o.chestK || 1), z: -0.01, b: [['chest', 1]] },
    { y: 1.43, rx: (o.shoulderW || 0.19) + 0.01, rz: 0.1, z: 0.0, b: [['chest', 1]] },
    { y: 1.48, rx: 0.13, rz: 0.085, z: 0.005, b: [['chest', 0.8], ['neck', 0.2]] },
    { y: 1.515, rx: 0.07, rz: 0.065, z: 0.005, b: [['chest', 0.4], ['neck', 0.6]] },
  ];
  // coat skirt extends below the hips
  const skirt = [];
  if (o.coatLen) {
    const bottom = o.coatLen;
    for (let i = 0; i <= 6; i++) {
      const t = i / 6; const y = lerp(bottom, 0.86, t);
      skirt.push({ y, rx: lerp(0.2, 0.16, t) * (o.hipK || 1), rz: lerp(0.15, 0.1, t), z: 0.01, b: [['hips', 1]], fl: (1 - t) });
    }
  } else {
    // short jacket hem, snug to the hips, rippling gently
    skirt.push({ y: 0.83, rx: 0.172, rz: 0.114, z: 0.004, b: [['hips', 1]], fl: 0.35 });
  }
  const torsoRings = [...skirt, ...tl].map((L) => ({
    c: new V3(0, L.y * k, L.z * k), ax: X, az: Z, rx: L.rx * k, rz: L.rz * k, bones: L.b,
    col: (a) => { const front = Math.sin(a) < -0.96; return front && L.y < 1.47 && L.y > 0.8 ? C.zip || C.top.map((x) => x * 0.7) : C.top; },
    fl: L.fl ? (a) => L.fl * (0.7 + 0.3 * Math.abs(Math.cos(a))) : 0,
  }));
  mb.loft(torsoRings, 20, false, false);
  if (o.coatLen) {
    // coat inner lining hides legs at hem
  }
  // collar / hood roll & pockets
  { const hood = tor(0.085 * k, 0.03 * k, 8, 18, { y: 1.5 * k, z: 0.03 * k, rx: Math.PI / 2 + 0.35 }, Math.PI * 1.5);
    hood.rotateY(Math.PI * 0.25 * 0); mb.addGeo(hood, C.collar || C.top.map((x) => x * 0.9), [['chest', 0.6], ['neck', 0.4]]);
    for (const sx of [-1, 1]) { const pk = box(0.1 * k, 0.012 * k, 0.012 * k, { x: sx * 0.08 * k, y: 1.02 * k, z: -0.108 * k }); mb.addGeo(pk, C.top.map((x) => x * 0.6), [['hips', 0.5], ['spine', 0.5]]); }
    if (o.scarf) { const sc = tor(0.075 * k, 0.03 * k, 8, 20, { y: 1.5 * k, rx: Math.PI / 2 + 0.2 }); mb.addGeo(sc, o.scarf, [['neck', 0.5], ['chest', 0.5]]); const tail = rbox(0.06 * k, 0.26 * k, 0.02 * k, 0.01, { x: 0.05 * k, y: 1.36 * k, z: -0.12 * k, rz: 0.1 }); mb.addGeo(tail, o.scarf, [['chest', 1]], 0.4); }
    if (o.belt) { const bt = cyl(0.152 * k, 0.152 * k, 0.03 * k, 20, { y: 1.06 * k }); tf(bt, { sz: 0.1 / 0.15 }); mb.addGeo(bt, o.belt, [['hips', 0.4], ['spine', 0.6]]); }
  }
  // ---- arms (sleeves) with cuffs
  for (const s of ['L', 'R']) {
    const sh = W('arm' + s), el = W('fore' + s), wr = W('hand' + s);
    const rings = []; const n = 14;
    const inset = sh.clone().lerp(W('cla' + s), 0.35);
    for (let i = 0; i <= n; i++) {
      const t = i / n; let c, r, bns;
      if (t < 0.52) { const u = t / 0.52; c = inset.clone().lerp(el, u); r = lerp(0.07, 0.054, u) * k; bns = u < 0.2 ? blend('chest', 'arm' + s, 0.4 + u * 3) : u > 0.85 ? blend('arm' + s, 'fore' + s, (u - 0.85) / 0.3) : [['arm' + s, 1]]; }
      else { const u = (t - 0.52) / 0.48; c = el.clone().lerp(wr, u); r = lerp(0.054, 0.041, u) * k; bns = u < 0.15 ? blend('arm' + s, 'fore' + s, 0.5 + u / 0.3) : u > 0.9 ? blend('fore' + s, 'hand' + s, (u - 0.9) * 3) : [['fore' + s, 1]]; }
      rings.push({ c, ax: X, az: Z, rx: r, rz: r, bones: bns, col: t > 0.93 ? C.top.map((x) => x * 0.8) : C.sleeve || C.top, fl: t > 0.4 ? 0.2 : 0 });
    }
    mb.loft(rings, 10, false, false);
    // wrist (skin)
    const wrist = [];
    for (let i = 0; i <= 2; i++) { const t = i / 2; wrist.push({ c: wr.clone().lerp(W('tip' + s), -0.1 + t * 0.15), ax: X, az: Z, rx: 0.028 * k, rz: 0.033 * k, bones: [['fore' + s, 1 - t], ['hand' + s, t]], col: C.skin }); }
    mb.loft(wrist, 8);
    // hand: palm + curled fingers (grip) + thumb, built in rest orientation (hanging down)
    const hand = [];
    const side = s === 'R' ? 1 : -1;
    const palm = rbox(0.028 * k, 0.09 * k, 0.085 * k, 0.012 * k, { y: -0.045 * k }); hand.push(palm);
    const grip = o.grip !== false;
    for (let f = 0; f < 4; f++) {
      const zc = (-0.03 + f * 0.02) * k; const len = [0.07, 0.078, 0.074, 0.06][f] * k;
      const pts = [];
      for (let q = 0; q <= 6; q++) {
        const a = q / 6 * (grip ? Math.PI * 1.25 : 0.4);
        const rr = 0.028 * k;
        pts.push(new V3(-side * (grip ? (Math.sin(a) * rr) : 0.002), -0.09 * k - (grip ? (1 - Math.cos(a)) * rr * 0.1 + Math.sin(Math.min(a, 1.4)) * 0.022 * k : q / 6 * len), zc));
        if (grip) pts[q].x = -side * (0.014 * k - Math.cos(a) * 0.0 - (1 - Math.cos(a)) * 0.022 * k) ;
        if (grip) pts[q].y = -0.09 * k - Math.sin(a) * 0.024 * k;
      }
      hand.push(tube(pts, pts.map((_, q) => 0.0095 * k * (1 - q / 14)), 6, { capEnd: true }));
    }
    const th = tube([new V3(-side * 0.012 * k, -0.02 * k, -0.04 * k), new V3(-side * 0.03 * k, -0.05 * k, -0.055 * k), new V3(-side * 0.035 * k, -0.075 * k, -0.045 * k)], [0.012 * k, 0.01 * k, 0.009 * k], 6, { capEnd: true });
    hand.push(th);
    const hg = merge(hand);
    hg.translate(wr.x, wr.y, wr.z);
    mb.addGeo(hg, C.skin, [['hand' + s, 1]]);
  }
  // ---- neck & head
  { const ns = []; for (let i = 0; i <= 3; i++) { const t = i / 3; ns.push({ c: new V3(0, lerp(1.47, 1.62, t) * k, 0.005 * k), ax: X, az: Z, rx: 0.048 * k, rz: 0.05 * k, bones: blend('neck', 'head', t * 0.8), col: C.skin }); } mb.loft(ns, 10);
    const head = new THREE.SphereGeometry(0.1 * k, 28, 22);
    const p = head.attributes.position;
    for (let i = 0; i < p.count; i++) {
      let x = p.getX(i) / k, y = p.getY(i) / k, z = p.getZ(i) / k;
      x *= 0.84; y *= 1.12; z *= 0.98;
      if (y < -0.03) { x *= 1 - (-0.03 - y) * 2.2; z *= 1 - (-0.03 - y) * 1.4; } // jaw
      if (z < 0) { // face front
        const nx = Math.exp(-((x * x) / 0.00018 + ((y + 0.005) ** 2) / 0.0012)); z -= nx * 0.022; // nose
        const brow = Math.exp(-((y - 0.03) ** 2) / 0.00012) * Math.exp(-(x * x) / 0.004); z -= brow * 0.006;
        const eye = Math.exp(-(((Math.abs(x) - 0.033) ** 2) / 0.0002 + ((y - 0.012) ** 2) / 0.0001)); z += eye * 0.006;
        const chin = Math.exp(-((x * x) / 0.0008 + ((y + 0.085) ** 2) / 0.0006)); z -= chin * 0.008;
      }
      if (z > 0.02) z *= 1.04; // occiput
      p.setXYZ(i, x * k, y * k, z * k);
    }
    head.computeVertexNormals();
    const hc = new Float32Array(p.count * 3);
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i) / k, y = p.getY(i) / k, z = p.getZ(i) / k;
      let c = C.skin.slice();
      const lip = z < -0.075 && Math.abs(x) < 0.017 && y < -0.047 && y > -0.058; if (lip) c = [c[0] * 0.88, c[1] * 0.74, c[2] * 0.74];
      const cheek = Math.exp(-(((Math.abs(x) - 0.045) ** 2) / 0.0006 + ((y + 0.02) ** 2) / 0.0006)); c = [c[0] * (1 + 0.06 * cheek), c[1] * (1 - 0.02 * cheek), c[2]];
      // hair / beard coverage
      const hairLine = o.hair === 'bald' ? 9 : 0.035 - (z > 0 ? 0.09 : 0) + (Math.abs(x) > 0.07 ? -0.02 : 0);
      if (y > hairLine && o.hair !== 'bald') c = C.hair;
      if (o.beard && y < -0.02 && z < 0.02 && !(Math.abs(x) < 0.022 && y > -0.07 && z < -0.07)) c = C.beard || C.hair;
      hc[i * 3] = c[0]; hc[i * 3 + 1] = c[1]; hc[i * 3 + 2] = c[2];
    }
    head.setAttribute('color', new THREE.BufferAttribute(hc, 3));
    head.translate(0, 1.675 * k, -0.005 * k);
    mb.addGeo(head, [1, 1, 1], [['head', 1]]);
    // eyes & brows & ears
    const ey = [];
    for (const sx of [-1, 1]) ey.push(sph(0.0095 * k, 8, 6, { x: sx * 0.031 * k, y: 1.689 * k, z: -0.083 * k }));
    mb.addGeo(merge(ey), [0.07, 0.05, 0.04], [['head', 1]]);
    const br = [];
    for (const sx of [-1, 1]) br.push(rbox(0.03 * k, 0.0065 * k, 0.008 * k, 0.003 * k, { x: sx * 0.032 * k, y: 1.708 * k, z: -0.086 * k, rz: -sx * 0.12 }));
    mb.addGeo(merge(br), C.brow || C.hair.map((x) => x * 0.8), [['head', 1]]);
    const ear = [];
    for (const sx of [-1, 1]) { const e = sph(0.022 * k, 8, 6, { x: sx * 0.086 * k, y: 1.68 * k, z: 0.005 * k }); tf(e, { sx: 0.35, sy: 1, sz: 0.7 }); e.translate(sx * 0.086 * k * 0.65, 1.68 * k * 0.0, 0); ear.push(e); }
    mb.addGeo(merge(ear), C.skin.map((x) => x * 0.95), [['head', 1]]);
    // hair volume
    if (o.hair === 'bun' || o.hair === 'short' || o.hair === 'cap') {
      const hv = new THREE.SphereGeometry(0.106 * k, 20, 14, 0, Math.PI * 2, 0, Math.PI * 0.55);
      const hp = hv.attributes.position;
      for (let i = 0; i < hp.count; i++) { const x = hp.getX(i), y = hp.getY(i), z = hp.getZ(i); hp.setXYZ(i, x * 0.9, y * 1.08, z * (z < 0 ? 0.92 : 1.06)); }
      hv.computeVertexNormals();
      tf(hv, { y: 1.7 * k, z: 0.012 * k, rx: 0.32 });
      mb.addGeo(hv, C.hair, [['head', 1]]);
      if (o.hair === 'bun') mb.addGeo(sph(0.045 * k, 12, 10, { y: 1.74 * k, z: 0.085 * k }), C.hair, [['head', 1]]);
    }
    if (o.hair === 'cap') {
      const cap = new THREE.SphereGeometry(0.112 * k, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.46);
      tf(cap, { y: 1.705 * k, z: 0.008 * k, rx: 0.12, sx: 0.93 });
      mb.addGeo(cap, C.cap, [['head', 1]]);
      const bill = rbox(0.15 * k, 0.012 * k, 0.08 * k, 0.005 * k, { y: 1.735 * k, z: -0.12 * k, rx: 0.18 });
      mb.addGeo(bill, C.cap.map((x) => x * 0.85), [['head', 1]]);
    }
  }
  const geo = mb.build();
  const mat = std({ map: TEX.cloth.map, vertexColors: true, roughness: o.rough || 0.7 }, {
    wet: 0.7,
    vertHead: 'attribute float aFlutter; uniform vec3 uFlut; uniform float uFlTime;',
    vertexExtra: `\n transformed += uFlut * aFlutter * (0.55 + 0.45*sin(uFlTime*9.0 + position.y*14.0 + position.x*9.0)) + vec3(0.0, 0.0, 0.0);\n`,
    onShader: (sh) => { sh.uniforms.uFlut = mat.userData.uFlut; sh.uniforms.uFlTime = U.uTime; },
  });
  mat.userData.uFlut = { value: new V3() };
  const mesh = new THREE.SkinnedMesh(geo, mat);
  mesh.castShadow = true; mesh.receiveShadow = true; mesh.frustumCulled = false;
  const skeleton = new THREE.Skeleton(names.map((n) => bones[n]));
  const group = new THREE.Group();
  group.add(bones.root); group.add(mesh);
  group.updateMatrixWorld(true);
  mesh.bind(skeleton);
  const rig = new Rig(bones, restW, group);
  return { group, mesh, bones, rig, mat, k };
}

// ------------------------------------------------------------------ IK rig
const _q1 = new Q(), _q2 = new Q(), _m1 = new THREE.Matrix4(), _m2 = new THREE.Matrix4(), _v1 = new V3(), _v2 = new V3(), _v3 = new V3();
class Rig {
  constructor(bones, restW, group) {
    this.b = bones; this.group = group;
    group.updateMatrixWorld(true);
    this.restQ = {}; this.restDir = {}; this.len = {};
    const child = { hips: 'spine', spine: 'chest', chest: 'neck', neck: 'head', head: 'headTop', claL: 'armL', armL: 'foreL', foreL: 'handL', handL: 'tipL', claR: 'armR', armR: 'foreR', foreR: 'handR', handR: 'tipR', thighL: 'shinL', shinL: 'footL', footL: 'toeL', thighR: 'shinR', shinR: 'footR', footR: 'toeR' };
    this.child = child;
    for (const n in bones) {
      this.restQ[n] = bones[n].quaternion.clone(); // local rest (identity)
      (this.restP || (this.restP = {}))[n] = bones[n].position.clone();
      if (child[n]) { const d = restW[child[n]].clone().sub(restW[n]); this.len[n] = d.length(); this.restDir[n] = d.normalize(); }
    }
    this.restW = restW;
  }
  reset() { for (const n in this.b) { this.b[n].quaternion.copy(this.restQ[n]); this.b[n].position.copy(this.restP[n]); } }
  worldPos(n, out = new V3()) { this.b[n].updateWorldMatrix(true, false); return out.setFromMatrixPosition(this.b[n].matrixWorld); }
  // orient bone n so its rest direction points along dirW (world) and its rest side axis maps to sideW
  aim(n, dirW, sideRest, sideW) {
    const bone = this.b[n];
    const d0 = this.restDir[n].clone(), s0 = sideRest.clone().sub(d0.clone().multiplyScalar(sideRest.dot(d0))).normalize();
    const d1 = dirW.clone().normalize(); const s1 = sideW.clone().sub(d1.clone().multiplyScalar(sideW.dot(d1))).normalize();
    if (!isFinite(s1.x) || s1.lengthSq() < 1e-6) return;
    _m1.makeBasis(d0, s0, _v1.crossVectors(d0, s0));
    _m2.makeBasis(d1, s1, _v2.crossVectors(d1, s1));
    _m1.transpose(); _m2.multiply(_m1);
    const target = new Q().setFromRotationMatrix(_m2); // bone-local (= rig rest frame) -> world
    bone.parent.getWorldQuaternion(_q1);
    bone.quaternion.copy(_q1.invert().multiply(target));
    bone.updateMatrixWorld(true);
  }
  // rest-space vectors -> world (through group)
  gv(v) { return v.clone().applyQuaternion(this.group.getWorldQuaternion(new Q())); }
  twoBone(up, lo, end, target, pole, sideRest) {
    const A = this.worldPos(up);
    const l1 = this.len[up], l2 = this.len[lo];
    const AT = target.clone().sub(A); let d = AT.length();
    d = clamp(d, Math.abs(l1 - l2) + 1e-3, l1 + l2 - 1e-3);
    const dir = AT.normalize();
    const a = (l1 * l1 - l2 * l2 + d * d) / (2 * d); const h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
    const pv = pole.clone().sub(A); pv.sub(dir.clone().multiplyScalar(pv.dot(dir))).normalize();
    const B = A.clone().addScaledVector(dir, a).addScaledVector(pv, h);
    const T = A.clone().addScaledVector(dir, d);
    const u1 = B.clone().sub(A), u2 = T.clone().sub(B);
    let side = new V3().crossVectors(u1, u2);
    if (side.lengthSq() < 1e-8) side = new V3().crossVectors(u1, pv).negate();
    side.normalize();
    this.aim(up, u1, sideRest, side);
    this.aim(lo, u2, sideRest, side);
    return { B, T };
  }
}

// ------------------------------------------------------------------ characters
export function makeSkipper() {
  const h = buildHuman({
    height: 1.78, shoulderW: 0.195, hipW: 0.095, chestK: 1.05,
    colors: { skin: [0.8, 0.6, 0.48], hair: [0.22, 0.15, 0.1], top: [0.86, 0.62, 0.12], sleeve: [0.86, 0.62, 0.12], zip: [0.25, 0.22, 0.2], collar: [0.8, 0.56, 0.1], bottom: [0.2, 0.22, 0.25], shoes: [0.42, 0.28, 0.16] },
    hair: 'short', rough: 0.55,
  });
  return h;
}
export function makeWoman() {
  return buildHuman({
    height: 1.66, shoulderW: 0.175, hipW: 0.1, hipK: 1.08, waistK: 0.92, coatLen: 0.5,
    colors: { skin: [0.62, 0.42, 0.32], hair: [0.08, 0.06, 0.05], top: [0.74, 0.64, 0.46], collar: [0.7, 0.6, 0.42], zip: [0.55, 0.47, 0.33], bottom: [0.15, 0.18, 0.27], shoes: [0.08, 0.07, 0.07] },
    hair: 'bun', scarf: [0.2, 0.42, 0.44], belt: [0.62, 0.52, 0.36],
  });
}
export function makeGroundskeeper() {
  return buildHuman({
    height: 1.74, shoulderW: 0.195, hipW: 0.1, chestK: 1.08, waistK: 1.08,
    colors: { skin: [0.45, 0.3, 0.22], hair: [0.62, 0.6, 0.58], beard: [0.7, 0.68, 0.66], top: [0.33, 0.37, 0.22], sleeve: [0.33, 0.37, 0.22], zip: [0.22, 0.24, 0.15], collar: [0.3, 0.26, 0.18], bottom: [0.58, 0.52, 0.38], shoes: [0.3, 0.2, 0.12], cap: [0.18, 0.28, 0.2] },
    hair: 'cap', beard: true,
  });
}

// umbrella model (canopy 8 panels, ribs, shaft, J handle), built along +Y from handle at origin
export function makeUmbrella() {
  const g = new THREE.Group();
  const red = std({ color: 0xc0141c, roughness: 0.55, side: THREE.DoubleSide, vertexColors: true }, { wet: 1, transl: 0.6 });
  const metal = std({ color: 0x2a2a2c, roughness: 0.3, metalness: 0.8 });
  const R0 = 0.52, top = 0.86;
  const pos = [], idx = [], col = [];
  const NP = 8, NS = 6;
  for (let p = 0; p < NP; p++) for (let s = 0; s <= NS; s++) for (let q = 0; q <= 4; q++) {
    const a = (p + q / 4) / NP * Math.PI * 2; const t = s / NS;
    const scallop = 1 - 0.1 * Math.sin((q / 4) * Math.PI) * t;
    const r = R0 * Math.sin(t * Math.PI / 2) * scallop; const y = top - 0.24 * (1 - Math.cos(t * Math.PI / 2)) - 0.03 * Math.sin((q / 4) * Math.PI) * t;
    pos.push(Math.cos(a) * r, y, Math.sin(a) * r);
    const kk = 0.85 + 0.15 * Math.sin((q / 4) * Math.PI); col.push(kk, kk, kk);
  }
  for (let p = 0; p < NP; p++) for (let s = 0; s < NS; s++) for (let q = 0; q < 4; q++) {
    const base = p * (NS + 1) * 5; const a = base + s * 5 + q, b = a + 1, c = a + 5, d = c + 1; idx.push(a, c, b, b, c, d);
  }
  const cg = new THREE.BufferGeometry(); cg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); cg.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); cg.setIndex(idx); cg.computeVertexNormals();
  const canopy = new THREE.Mesh(cg, red); canopy.castShadow = true; g.add(canopy);
  const parts = [cyl(0.008, 0.008, 0.9, 6, { y: 0.45 }), sph(0.014, 6, 5, { y: top + 0.02 }), tube([new V3(0, 0.02, 0), new V3(0, -0.05, 0), new V3(0.03, -0.1, 0), new V3(0.06, -0.07, 0)], [0.012, 0.012, 0.012, 0.012], 6)];
  for (let p = 0; p < NP; p++) { const a = p / NP * Math.PI * 2; const pts = []; for (let s = 0; s <= 6; s++) { const t = s / 6; pts.push(new V3(Math.cos(a) * R0 * Math.sin(t * Math.PI / 2) * 0.99, top - 0.24 * (1 - Math.cos(t * Math.PI / 2)) - 0.006, Math.sin(a) * R0 * Math.sin(t * Math.PI / 2) * 0.99)); } parts.push(tube(pts, pts.map(() => 0.004), 3)); parts.push(tube([new V3(0, 0.55, 0), pts[3]], [0.003, 0.003], 3)); }
  const m = new THREE.Mesh(merge(parts), metal); m.castShadow = true; g.add(m);
  return g;
}
export function makeBroom() {
  const g = new THREE.Group();
  const wood = std({ color: 0xa27a4a, roughness: 0.6 });
  const dark = std({ color: 0x2a2622, roughness: 0.8 });
  const bris = std({ color: 0x3a3226, roughness: 0.95 });
  const handle = new THREE.Mesh(cyl(0.014, 0.014, 1.4, 8, { y: 0.7 }), wood); handle.castShadow = true; g.add(handle);
  const head = new THREE.Mesh(rbox(0.46, 0.05, 0.07, 0.01, { y: 0.04 }), dark); head.castShadow = true; g.add(head);
  const b = []; for (let i = 0; i < 24; i++) b.push(box(0.012, 0.06, 0.05, { x: -0.22 + i * 0.019, y: -0.01 }));
  g.add(new THREE.Mesh(merge(b), bris));
  // local: handle along +Y from bristles at origin; head along X
  return g;
}
