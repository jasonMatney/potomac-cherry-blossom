// Other river traffic: small pleasure boats with correctly placed navigation lights, plus moored boats
import * as THREE from 'three';
import { clamp, lerp, mulberry32, smooth } from './util.js';
import { frame, fromSD, toSD, hwR, hwL, currentAt, S0, S1 } from './world.js';
import { std } from './matpatch.js';
import { rbox, box, cyl, sph, tube, merge, tf, boxUV } from './geo.js';
import { addLight, LIGHTS, addObstacle } from './registry.js';
import { waveH, laneAt } from './boat.js';
import TEX from './tex.js';
import { SIM } from './water.js';
import { buildBoatModel } from './boat.js';
import { Skipper } from './actors.js';
import { flatten } from './bake.js';

const V3 = THREE.Vector3;
let MATS = null;
function mats() {
  if (MATS) return MATS;
  MATS = {
    hull: std({ map: TEX.fiber.map, color: 0xf2f0ea, roughness: 0.25 }, { wet: 0.6 }),
    hullB: std({ map: TEX.fiber.map, color: 0x24364e, roughness: 0.3 }, { wet: 0.6 }),
    hullG: std({ map: TEX.fiber.map, color: 0x2d4a3a, roughness: 0.3 }, { wet: 0.6 }),
    deck: std({ map: TEX.deck.map, roughness: 0.7 }, { wet: 1 }),
    cabin: std({ color: 0xe8e4dc, roughness: 0.4 }, { wet: 0.6 }),
    glass: std({ color: 0x1a2530, roughness: 0.05, metalness: 0.3, emissive: 0xffc27a, emissiveIntensity: 0 }),
    steel: std({ color: 0xdfe4e8, roughness: 0.15, metalness: 1 }),
    canvas: std({ map: TEX.canvas.map, color: 0x7a2a26, roughness: 0.9, side: THREE.DoubleSide }, { wet: 1 }),
    black: std({ color: 0x1c1d1f, roughness: 0.5 }),
    red: new THREE.MeshBasicMaterial({ color: 0xff2a1a }), green: new THREE.MeshBasicMaterial({ color: 0x22ff66 }), white: new THREE.MeshBasicMaterial({ color: 0xfff2dc }),
  };
  return MATS;
}

// simple lofted planing hull: bow at -Z
function hull(L, B, D) {
  const NT = 20, NU = 8; const pos = [], idx = [];
  const hb = (t) => (t < 0.45 ? B / 2 * lerp(0.9, 1, t / 0.45) : B / 2 * Math.pow(Math.max(0, Math.cos(Math.min(1, (t - 0.45) / 0.55) * Math.PI / 2)), 0.8));
  const kl = (t) => -D * 0.4 + D * 0.7 * Math.pow(Math.max(0, t - 0.7) / 0.3, 2);
  const sh = (t) => D * 0.6 + D * 0.25 * t * t;
  for (let i = 0; i <= NT; i++) { const t = i / NT; for (let j = -NU; j <= NU; j++) { const u = Math.abs(j) / NU; const x = Math.sign(j) * hb(t) * Math.pow(Math.sin(u * Math.PI / 2), 0.55); const y = kl(t) + (sh(t) - kl(t)) * Math.pow(u, 1.5); pos.push(x, y, (0.5 - t) * L); } }
  const cols = NU * 2 + 1;
  for (let i = 0; i < NT; i++) for (let j = 0; j < cols - 1; j++) { const a = i * cols + j, b = a + 1, c = a + cols, d = c + 1; idx.push(a, c, b, b, c, d); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
  boxUV(g, 0.6);
  // deck cap
  const deck = [];
  for (let i = 0; i <= NT; i++) { const t = i / NT; deck.push([hb(t) * 0.98, sh(t) - 0.01, (0.5 - t) * L]); }
  const dp = [], di = [];
  deck.forEach(([x, y, z]) => dp.push(-x, y, z, x, y, z));
  for (let i = 0; i < NT; i++) { const k = i * 2; di.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
  const dg = new THREE.BufferGeometry(); dg.setAttribute('position', new THREE.Float32BufferAttribute(dp, 3)); dg.setIndex(di); dg.computeVertexNormals(); boxUV(dg, 0.5);
  return { hull: g, deck: dg, sheer: sh, hb };
}

export function makePleasureBoat(kind, seed) {
  const M = mats(); const r = mulberry32(seed);
  const g = new THREE.Group();
  const L = kind === 'cruiser' ? 9.5 : kind === 'launch' ? 5.2 : 6.8;
  const B = kind === 'cruiser' ? 3.1 : kind === 'launch' ? 2.0 : 2.4;
  const D = kind === 'cruiser' ? 1.4 : 1.0;
  const h = hull(L, B, D);
  const hm = [M.hull, M.hullB, M.hullG][Math.floor(r() * 3)];
  const add = (geo, m) => { const o = new THREE.Mesh(geo, m); o.castShadow = true; o.receiveShadow = true; g.add(o); return o; };
  add(h.hull, hm); add(h.deck, M.deck);
  const shY = h.sheer(0.5);
  const lights = {};
  if (kind === 'cruiser') {
    add(rbox(B * 0.8, 1.4, L * 0.45, 0.2, { y: shY + 0.7, z: 0.3 }), M.cabin);
    add(rbox(B * 0.82, 0.55, L * 0.43, 0.1, { y: shY + 0.95, z: 0.3 }), M.glass).userData.cabin = true;
    add(rbox(B * 0.7, 0.9, 1.4, 0.15, { y: shY + 1.85, z: -0.4 }), M.cabin);
    add(rbox(B * 0.72, 0.4, 1.2, 0.05, { y: shY + 1.9, z: -0.4 }), M.glass);
  } else if (kind === 'runabout') {
    add(rbox(B * 0.9, 0.32, 0.12, 0.03, { y: shY + 0.3, z: -0.4, rx: 0.5 }), M.glass);
    add(rbox(B * 0.7, 0.5, 1.2, 0.05, { y: shY + 0.1, z: 0.9 }), M.cabin);
    // canvas bimini
    const c = new THREE.CylinderGeometry(1.5, 1.5, B * 0.9, 12, 1, true, -0.5, 1.0); c.rotateZ(Math.PI / 2); c.translate(0, shY + 0.1, 1.2);
    add(c, M.canvas);
  } else {
    add(rbox(0.6, 0.8, 0.5, 0.06, { y: shY + 0.3, z: -0.2 }), M.cabin);
    add(rbox(B * 0.7, 0.35, 1.0, 0.05, { y: shY + 0.1, z: 1.3 }), M.cabin);
  }
  // rub rail, bow rail
  const bowZ = -L / 2 + 0.25;
  // nav lights: red to port (-X), green to starboard (+X) near the bow; white stern light facing aft; white masthead forward
  const sideZ = -L * 0.28;
  for (const [sx, mat, key] of [[-1, M.red, 'port'], [1, M.green, 'star']]) {
    const x = sx * (h.hb(0.78) + 0.02); const y = h.sheer(0.78) + 0.05;
    add(box(0.05, 0.06, 0.12, { x, y, z: sideZ }), M.black);
    const lens = add(box(0.02, 0.05, 0.1, { x: x + sx * 0.03, y, z: sideZ }), mat);
    lights[key] = { local: new V3(x + sx * 0.12, y, sideZ - 0.05), col: sx < 0 ? 0xff2a1a : 0x22ff66, mesh: lens };
  }
  const mastH = kind === 'cruiser' ? shY + 3.1 : shY + 1.5;
  add(cyl(0.02, 0.025, mastH - shY, 6, { y: (mastH + shY) / 2, z: kind === 'cruiser' ? -0.4 : 1.4 }), M.steel);
  const mh = add(sph(0.06, 8, 6, { y: mastH + 0.05, z: kind === 'cruiser' ? -0.4 : 1.4 }), M.white);
  lights.mast = { local: new V3(0, mastH + 0.05, kind === 'cruiser' ? -0.5 : 1.3), col: 0xfff2dc, mesh: mh };
  const st = add(sph(0.05, 8, 6, { y: h.sheer(0) + 0.2, z: L / 2 - 0.1 }), M.white);
  lights.stern = { local: new V3(0, h.sheer(0) + 0.2, L / 2 + 0.1), col: 0xfff2dc, mesh: st };
  lights.cabin = { local: new V3(0, shY + 1.0, 0.3), col: 0xffb86a };
  g.userData = { L, B, lights, kind };
  return g;
}

// A launch like ours, in its own livery, with a helmsman posed at the wheel, frozen into a few static meshes
const LIVERY = [
  { hull: 0x1f2d48, stripe: 0xe8e2d2, canvas: 0xe6ddc8, uphol: 0xe9e1cf, crew: { jacket: 0xb8342a, pants: 0x3a3a3c, hair: 0x2a2018 } },
  { hull: 0xf1eee6, stripe: 0x7a1e26, canvas: 0x33483a, uphol: 0xd9ccb0, crew: { jacket: 0x2f5d8a, pants: 0xb8a988, hair: 0xb89a6a } },
  { hull: 0x2d4a3c, stripe: 0xd8c7a0, canvas: 0xd9cfb6, uphol: 0xefe7d4, crew: { jacket: 0xe9e5dc, pants: 0x2b3444, dark: true, hair: 0x1a1612 } },
  { hull: 0xe7dcc6, stripe: 0x24686e, canvas: 0x24686e, uphol: 0xf2ece0, crew: { jacket: 0x3c434c, pants: 0x1f2328, hair: 0x7a6a58 } },
];
const _fake = {
  pitch: 0, roll: 0, bump: 0, u: 5, r: 0, acc: 0, rudder: 0, x: 0, z: 0, speedGround: 5,
  fwd() { return [0, -1]; },
};
export function makeLaunch(li, crew = true) {
  const liv = LIVERY[li % LIVERY.length];
  const model = buildBoatModel(liv);
  const holder = new THREE.Group(); holder.add(model);
  if (crew) {
    const sk = new Skipper(model, liv.crew);
    _fake.root = holder;
    sk.c.mixer.update(0.8 + li * 0.37);
    sk.update(1 / 60, 3 + li, _fake);
    sk.c.setFlutter(new V3());
  }
  const ud = model.userData;
  const keep = new Set([ud.navPort, ud.navStar, ud.navWhite]);
  const flat = flatten(holder, keep);
  const k = flat.userData.kept;
  const lensAt = (m) => { m.geometry.computeBoundingSphere(); return m.geometry.boundingSphere.center.clone(); };
  const port = k.get(ud.navPort), star = k.get(ud.navStar), wh = k.get(ud.navWhite);
  flat.userData = {
    L: 6.4, B: 2.3, kind: 'launch',
    lights: {
      port: { local: lensAt(port).add(new V3(-0.1, 0, 0)), col: 0xff2a1a, mesh: port },
      star: { local: lensAt(star).add(new V3(0.1, 0, 0)), col: 0x22ff66, mesh: star },
      mast: { local: lensAt(wh), col: 0xfff2dc, mesh: wh },
    },
  };
  // the lenses keep their own (per-boat) materials so their glow can follow the dusk
  port.material = port.material.clone(); star.material = star.material.clone(); wh.material = wh.material.clone();
  return flat;
}

export class Traffic {
  constructor(scene, lm, hero) {
    this.scene = scene; this.hero = hero; this.boats = []; this.others = [];
    this.bridges = [{ s: 200, dL: lm.memorial.dL, bay: lm.memorial.bay, spans: lm.memorial.spans }, { s: lm.key.s, dL: lm.key.dL, bay: lm.key.bay, spans: 5 }];
    const specs = [
      { kind: 'cruiser', dir: -1, s: 700, lane: -40, speed: 4.2 },
      { kind: 'launch', li: 0, dir: 1, s: 380, lane: -15, speed: 5.0 },
      { kind: 'launch', li: 1, dir: -1, s: 1300, lane: -10, speed: 3.4 },
      { kind: 'launch', li: 2, dir: -1, s: 180, lane: -60, speed: 4.6 },
    ];
    specs.forEach((sp, i) => {
      const m = sp.kind === 'launch' ? makeLaunch(sp.li) : makePleasureBoat(sp.kind, 101 + i * 7);
      scene.add(m);
      const L = {};
      for (const k in m.userData.lights) {
        const li = m.userData.lights[k];
        L[k] = addLight(new V3(), li.col, k === 'cabin' ? 9 : k === 'mast' || k === 'stern' ? 10 : 6, k === 'cabin' ? 1.4 : 0.8, { kind: 'boat', dyn: true });
      }
      this.boats.push({ m, ...sp, laneOff: sp.lane, d: sp.lane, psi: 0, x: 0, z: 0, lights: L, halfLen: m.userData.L / 2, halfBeam: m.userData.B / 2, spd: sp.speed, relHeading: 0 });
    });
    // moored boats at the Thompson docks and Georgetown
    this.moored = [];
    const moor = (s, d, kind, yawOff) => { const m = kind === 'launch' ? makeLaunch(3 + this.moored.length, false) : makePleasureBoat(kind, 900 + this.moored.length * 3); const [x, z] = fromSD(s, d); m.position.set(x, 0, z); m.rotation.y = -frame(s).th + yawOff; scene.add(m); this.moored.push({ m, x, z, ph: this.moored.length }); addObstacle({ s, d, rs: m.userData.L / 2 + 0.3, rd: m.userData.B / 2 + 0.3, kind: 'moored', foam: 0.1 }); };
    for (const [s, d, yo] of lm.dockMoor) moor(s, d, 'launch', yo);
    moor(958, hwR(958) - 3.2, 'cruiser', 0);
  }
  update(dt, t, tide, lightsOn) {
    const hero = this.hero;
    for (const b of this.boats) {
      // lane following with avoidance of the hero boat
      const heroDs = (hero.s - b.s) * b.dir; // >0: hero ahead in travel direction
      const heroDd = hero.d - b.d;
      // dodge decisions are made once per encounter and then held, so the boat never flips sides frame to frame
      let wantOff = b.lane;
      if (Math.abs(hero.s - b.s) < 70 && Math.abs(heroDd) < 28) { if (b.avSide === undefined) b.avSide = heroDd > 0 ? -1 : 1; wantOff = b.lane + b.avSide * Math.max(0, 28 - Math.abs(heroDd)) * 1.2; }
      else if (Math.abs(hero.s - b.s) > 80 || Math.abs(heroDd) > 32) b.avSide = undefined;
      b.oSide = b.oSide || new Map();
      for (const o of this.others) { const od = o.d - b.d, os = Math.abs(o.s - b.s); if (os < o.halfLen + 50 && Math.abs(od) < o.halfBeam + 16) { if (!b.oSide.has(o)) b.oSide.set(o, od > 0 ? -1 : 1); wantOff += b.oSide.get(o) * Math.max(0, o.halfBeam + 16 - Math.abs(od)) * 1.3; } else if (os > o.halfLen + 60 || Math.abs(od) > o.halfBeam + 20) b.oSide.delete(o); }
      const lim = hwR(b.s) - 14, liml = -hwL(b.s) + 14;
      // keep off the hero lane at bridges (use the lane, offset)
      const heroLane = laneAt(b.s);
      let target = heroLane + wantOff;
      target = clamp(target, liml, lim);
      // thread bridge arches: pick an arch on the approach and keep it until clear of the bridge
      b.arch = b.arch || {};
      this.bridges.forEach((br, bi) => {
        const w = 1 - smooth(22, 45, Math.abs(b.s - br.s));
        if (w <= 0) { delete b.arch[bi]; return; }
        if (b.arch[bi] === undefined) { let best = 0, bd = 1e9; for (let k = 0; k < br.spans; k++) { const c = br.dL + br.bay * (k + 0.5); const dist = Math.abs(c - target) + (Math.abs(c - heroLane) < 6 ? 25 : 0); if (dist < bd) { bd = dist; best = k; } } b.arch[bi] = best; }
        target = lerp(target, br.dL + br.bay * (b.arch[bi] + 0.5), w);
      });
      // smooth sideways motion: low-passed target, critically damped spring, capped sideways speed
      if (b.tgt === undefined) { b.tgt = target; b.vd = 0; }
      b.tgt = lerp(b.tgt, target, 1 - Math.exp(-dt * 1.2));
      const wn = 0.9; b.vd += (wn * wn * (b.tgt - b.d) - 2 * wn * b.vd) * dt; b.vd = clamp(b.vd, -3.5, 3.5);
      b.d += b.vd * dt;
      let spd = b.speed;
      if (heroDs > 0 && heroDs < 30 && Math.abs(heroDd) < 10) spd *= 0.4;
      for (const o of this.others) { const ods = (o.s - b.s) * b.dir; if (ods > 0 && ods < o.halfLen + 20 && Math.abs(o.d - b.d) < o.halfBeam + 5) spd *= 0.3; }
      b.spd = lerp(b.spd, spd, 1 - Math.exp(-dt));
      b.s += b.dir * b.spd * dt;
      if (b.dir > 0 && b.s > 1700) b.s = -200; if (b.dir < 0 && b.s < -250) b.s = 1650;
      const F = frame(b.s); const [x, z] = fromSD(b.s, b.d);
      // heading along travel direction with lateral drift
      const psi = F.th + (b.dir > 0 ? 0 : Math.PI) + clamp(Math.atan2(b.vd, Math.max(1, b.spd)), -0.3, 0.3) * b.dir;
      b.psi = lerp(b.psi, psi, 1 - Math.exp(-dt * 2)); if (Math.abs(psi - b.psi) > 3) b.psi = psi;
      const bi = this.boats.indexOf(b); b.wk = (b.wk || 0) + ((SIM.probeVals[4 + bi] || 0) - (b.wk || 0)) * (1 - Math.exp(-dt * 8));
      const wkPrev = b.wkP ?? b.wk; b.wkP = b.wk;
      const y = waveH(x, z, t, tide) + b.wk;
      b.m.position.set(x, y + 0.02, z); b.x = x; b.z = z;
      // far boats vanish into the haze; only nearby ones cast shadows
      const hd = hero ? Math.hypot(x - hero.x, z - hero.z) : 0;
      b.m.visible = hd < 520;
      const sh = hd < 110; if (sh !== b.sh) { b.sh = sh; b.m.traverse((o) => { if (o.isMesh) o.castShadow = sh; }); }
      b.wkR = lerp(b.wkR || 0, clamp((b.wk - wkPrev) / Math.max(dt, 1e-3) * 0.12, -0.1, 0.1), 1 - Math.exp(-dt * 5));
      b.m.rotation.set(0.02 + Math.sin(t * 1.3 + b.s) * 0.012 + b.wkR, -b.psi, Math.sin(t * 1.1 + b.s * 0.5) * 0.015 + b.wkR * 0.6, 'YXZ');
      b.relHeading = b.psi - F.th; b.speed_ = b.spd;
      b.m.updateMatrixWorld();
      for (const k in b.lights) {
        const li = b.m.userData.lights[k];
        b.lights[k].p.copy(li.local).applyMatrix4(b.m.matrixWorld);
        b.lights[k].I = (k === 'cabin' ? 1.4 : 0.9) * lightsOn;
      }
      for (const k of ['port', 'star', 'mast', 'stern']) { const li = b.m.userData.lights[k]; if (!li) continue; li.mesh.visible = true; li.mesh.material.color.setHex(li.col).multiplyScalar(0.3 + lightsOn * 7); }
    }
    for (const mb of this.moored) { if (hero) { const hd = Math.hypot(mb.x - hero.x, mb.z - hero.z); mb.m.visible = hd < 520; const sh = hd < 110; if (sh !== mb.sh) { mb.sh = sh; mb.m.traverse((o) => { if (o.isMesh) o.castShadow = sh; }); } } mb.m.position.y = waveH(mb.x, mb.z, t, tide) + 0.02; mb.m.rotation.x = Math.sin(t * 0.9 + mb.ph) * 0.01; mb.m.rotation.z = Math.sin(t * 0.7 + mb.ph) * 0.015; }
    mats().glass.emissiveIntensity = lightsOn * 2.2;
  }
  simBoats() { return this.boats.map((b) => ({ s: b.s, d: b.d, relHeading: b.relHeading + (b.dir < 0 ? 0 : 0), speed: b.spd, halfLen: b.halfLen, halfBeam: b.halfBeam, strength: 0.8, prop: 0.6 })); }
}
