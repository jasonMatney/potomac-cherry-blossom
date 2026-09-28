// Life on and by the water: rafts of mallards and Canada geese that paddle out of the way of boats and
// ride the wakes, and great blue herons wading in the shallows that lift off when a boat comes too close.
import * as THREE from 'three';
import { clamp, lerp, smooth, mulberry32 } from './util.js';
import { frame, fromSD, toSD, hwR, hwL, ISLAND, islandMask, currentAt } from './world.js';
import { groundAt } from './terrain.js';
import { std } from './matpatch.js';
import { merge, tube, ensureColor, tf } from './geo.js';
import { waveH } from './boat.js';
import { SIM } from './water.js';

const V3 = THREE.Vector3;
const rnd = mulberry32(4242);
const R = (a, b) => a + (b - a) * rnd();

function colored(g, hex) { const c = new THREE.Color(hex); ensureColor(g, c.r, c.g, c.b); return g; }
function ell(rx, ry, rz, o, hex, seg = 10) { const g = new THREE.SphereGeometry(1, seg, Math.max(6, seg - 3)); g.scale(rx, ry, rz); tf(g, o); return colored(g, hex); }
function birdGeo(kind) {
  const P = [];
  if (kind === 'drake' || kind === 'hen') {
    const drake = kind === 'drake';
    P.push(ell(0.11, 0.075, 0.2, { y: 0.03 }, drake ? 0x9a9488 : 0x8a6a48));
    P.push(ell(0.085, 0.07, 0.08, { y: 0.05, z: -0.12 }, drake ? 0x6a3a26 : 0x7a5a3a));
    P.push(ell(0.035, 0.05, 0.035, { y: 0.12, z: -0.16 }, drake ? 0x1f5e3c : 0x7a5a3a));
    P.push(ell(0.05, 0.045, 0.055, { y: 0.17, z: -0.18 }, drake ? 0x1c5a38 : 0x76583a));
    if (drake) P.push(ell(0.038, 0.012, 0.038, { y: 0.1, z: -0.155 }, 0xf4f1ea));
    P.push(ell(0.022, 0.01, 0.045, { y: 0.16, z: -0.245 }, drake ? 0xd8b830 : 0xd08a30));
    P.push(ell(0.06, 0.03, 0.06, { y: 0.07, z: 0.17, rx: -0.5 }, drake ? 0x2a2a2a : 0x6a4a2a));
    P.push(ell(0.07, 0.035, 0.14, { x: 0.075, y: 0.075, z: 0.02 }, drake ? 0x8a8478 : 0x6e5236));
    P.push(ell(0.07, 0.035, 0.14, { x: -0.075, y: 0.075, z: 0.02 }, drake ? 0x8a8478 : 0x6e5236));
  } else {
    // Canada goose
    P.push(ell(0.16, 0.11, 0.32, { y: 0.05 }, 0x7a6a58));
    P.push(ell(0.13, 0.1, 0.12, { y: 0.07, z: -0.2 }, 0xd8cfc0));
    const neck = tube([new V3(0, 0.1, -0.26), new V3(0, 0.3, -0.33), new V3(0, 0.45, -0.34)], [0.04, 0.032, 0.03], 7); P.push(colored(neck, 0x151515));
    P.push(ell(0.04, 0.042, 0.07, { y: 0.47, z: -0.37 }, 0x151515));
    P.push(ell(0.041, 0.022, 0.03, { y: 0.455, z: -0.355 }, 0xf2efe8));
    P.push(ell(0.02, 0.012, 0.04, { y: 0.46, z: -0.44 }, 0x1a1a1a));
    P.push(ell(0.08, 0.035, 0.07, { y: 0.1, z: 0.3, rx: -0.4 }, 0x1a1a1a));
    P.push(ell(0.085, 0.03, 0.02, { y: 0.09, z: 0.25 }, 0xf2efe8));
    P.push(ell(0.1, 0.05, 0.22, { x: 0.1, y: 0.12, z: 0.04 }, 0x5e5044));
    P.push(ell(0.1, 0.05, 0.22, { x: -0.1, y: 0.12, z: 0.04 }, 0x5e5044));
  }
  return merge(P);
}

// ------------------------------------------------------------------ heron (standing / flying)
function makeHeron() {
  const grp = new THREE.Group();
  const blue = std({ color: 0x7a8a9e, roughness: 0.75 }, { wet: 0.3 });
  const pale = std({ color: 0xd4d6d8, roughness: 0.7 }, { wet: 0.3 });
  const dark = std({ color: 0x2a2e36, roughness: 0.7 }, { wet: 0.3 });
  const bill = std({ color: 0xd8a830, roughness: 0.5 }, { wet: 0 });
  const legs = std({ color: 0x5a5040, roughness: 0.7 }, { wet: 0.6 });
  const add = (g, m, parent = grp) => { const o = new THREE.Mesh(g, m); o.castShadow = true; parent.add(o); return o; };
  const body = new THREE.Group(); body.position.y = 0.72; grp.add(body);
  const b = new THREE.SphereGeometry(0.15, 12, 8); b.scale(0.9, 1, 2.2); b.rotateX(0.35); add(b, blue, body);
  // neck + head on a pivot so it can coil and strike
  const neckG = new THREE.Group(); neckG.position.set(0, 0.12, -0.26); body.add(neckG);
  add(tube([new V3(0, 0, 0), new V3(0, 0.18, -0.02), new V3(0, 0.3, -0.09), new V3(0, 0.42, -0.07)], [0.055, 0.045, 0.04, 0.035], 8), pale, neckG);
  const head = new THREE.Group(); head.position.set(0, 0.45, -0.08); neckG.add(head);
  const hg = new THREE.SphereGeometry(0.05, 10, 8); hg.scale(0.8, 0.9, 1.4); add(hg, pale, head);
  add(new THREE.SphereGeometry(0.02, 6, 4).translate(0, 0.03, 0.02), dark, head);
  const bl = new THREE.ConeGeometry(0.018, 0.2, 6); bl.rotateX(-Math.PI / 2); bl.translate(0, 0, -0.16); add(bl, bill, head);
  const cr = new THREE.ConeGeometry(0.01, 0.16, 4); cr.rotateX(Math.PI / 2 + 0.4); cr.translate(0, 0.03, 0.1); add(cr, dark, head);
  // legs
  const legGs = [];
  for (const sx of [-0.05, 0.05]) { const lg = new THREE.Group(); lg.position.set(sx, 0.72, 0.02); grp.add(lg); add(new THREE.CylinderGeometry(0.011, 0.011, 0.72, 5).translate(0, -0.36, 0), legs, lg); legGs.push(lg); }
  // wings (folded along the body when standing)
  const wings = [];
  for (const sx of [-1, 1]) {
    const wg = new THREE.Group(); wg.position.set(sx * 0.1, 0.06, -0.05); body.add(wg);
    const s1 = new THREE.Shape(); s1.moveTo(0, -0.28); s1.lineTo(0.85, -0.26); s1.lineTo(0.85, 0.28); s1.lineTo(0, 0.33);
    const w1 = new THREE.ShapeGeometry(s1); w1.rotateX(-Math.PI / 2); if (sx < 0) w1.scale(-1, 1, 1);
    const m1 = add(w1, blue, wg); m1.material = blue.clone(); m1.material.side = THREE.DoubleSide;
    const og = new THREE.Group(); og.position.set(sx * 0.85, 0, 0); wg.add(og);
    const s2 = new THREE.Shape(); s2.moveTo(0, -0.26); s2.lineTo(0.7, -0.1); s2.lineTo(0.75, 0.16); s2.lineTo(0, 0.28);
    const w2 = new THREE.ShapeGeometry(s2); w2.rotateX(-Math.PI / 2); if (sx < 0) w2.scale(-1, 1, 1);
    const m2 = add(w2, dark, og); m2.material = dark.clone(); m2.material.side = THREE.DoubleSide;
    wings.push([wg, og, sx]);
  }
  for (const sx of [-1, 1]) { const fw = new THREE.SphereGeometry(0.1, 10, 6); fw.scale(0.45, 0.9, 2.4); fw.rotateX(0.3); fw.translate(sx * 0.1, 0.03, 0.08); add(fw, dark, body); }
  grp.userData = { body, neckG, head, legGs, wings };
  return grp;
}

export class Wildlife {
  constructor(scene) {
    this.scene = scene;
    // flocks: [s, e (from right bank, or absolute d when abs), count, goose share]
    const edgeIsl = (s) => { let dE = ISLAND.d + ISLAND.ad; for (let d = ISLAND.d; d < ISLAND.d + ISLAND.ad + 25; d += 0.5) if (islandMask(s, d) < 0.05) { dE = d; break; } return dE; };
    const spots = [
      [822, hwR(822) - 12, 9, 0.0], [470, hwR(470) - 11, 7, 0.4], [745, edgeIsl(745) + 9, 10, 0.6],
      [1102, 30, 8, 0.0], [1532, hwR(1532) - 14, 7, 0.3], [690, hwR(690) - 36, 6, 1.0], [300, -hwL(300) + 14, 8, 0.5],
    ];
    this.flocks = spots.map(([s, d, n, gs], fi) => ({ s, d, home: new V3(...(() => { const [x, z] = fromSD(s, d); return [x, 0, z]; })()), n, gs, probe: 0, alarm: 0 }));
    const counts = { drake: 0, hen: 0, goose: 0 };
    this.birds = [];
    this.flocks.forEach((f, fi) => {
      for (let i = 0; i < f.n; i++) {
        const kind = rnd() < f.gs ? 'goose' : (rnd() < 0.55 ? 'drake' : 'hen');
        const a = rnd() * 6.28, r = R(0.5, 4.5);
        this.birds.push({ f: fi, kind, idx: counts[kind]++, x: f.home.x + Math.cos(a) * r, z: f.home.z + Math.sin(a) * r, h: rnd() * 6.28, vx: 0, vz: 0, ph: rnd() * 10, dive: 0, want: new V3(), wt: 0 });
      }
    });
    const mat = std({ vertexColors: true, roughness: 0.75 }, { wet: 0.3 });
    this.meshes = {};
    for (const k of ['drake', 'hen', 'goose']) {
      const m = new THREE.InstancedMesh(birdGeo(k), mat, Math.max(1, counts[k]));
      m.castShadow = true; m.receiveShadow = true; m.frustumCulled = false; scene.add(m); this.meshes[k] = m;
    }
    // herons: Roosevelt Island shallows and the cove at Fletcher's
    this.herons = [[615, edgeIsl(615) + 2.2], [1528, hwR(1528) - 4.5]].map(([s, d]) => {
      const g = makeHeron(); const [x, z] = fromSD(s, d);
      g.position.set(x, 0, z); g.rotation.y = -frame(s).th + (rnd() - 0.5) * 2; scene.add(g);
      return { g, home: new V3(x, 0, z), yaw: g.rotation.y, st: 'stand', t: rnd() * 5, strike: 0, fly: null, away: 0 };
    });
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._e = new THREE.Euler(); this._s = new V3(1, 1, 1);
  }
  // wave-height probe points (a few nearest flocks) and where their results land
  probePoints(focus, slots) {
    const order = this.flocks.map((f, i) => [f.home.distanceToSquared(focus), i]).sort((a, b) => a[0] - b[0]).slice(0, slots);
    this.probeMap = order.map(([, i]) => i);
    return this.probeMap.map((i) => { const c = this.flocks[i].c || this.flocks[i].home; const q = toSD(c.x, c.z); return [q.s, q.d]; });
  }
  update(dt, t, tide, boats, focus, S, probeBase) {
    // wave heights from the simulation for the nearest flocks
    if (this.probeMap) this.probeMap.forEach((fi, k) => { const f = this.flocks[fi]; f.probe = lerp(f.probe, SIM.probeVals[probeBase + k] || 0, 1 - Math.exp(-dt * 6)); });
    for (const f of this.flocks) { f.c = f.c || f.home.clone(); f.cx = 0; f.cz = 0; f.cn = 0; }
    const near2 = 320 * 320;
    for (const b of this.birds) {
      const f = this.flocks[b.f];
      if ((b.x - focus.x) ** 2 + (b.z - focus.z) ** 2 > near2 * 1.5) { b.far = true; continue; }
      b.far = false;
      // wander around the flock's home, gently pulled back; drift with the current
      b.wt -= dt;
      if (b.wt <= 0) { b.wt = R(3, 9); const a = rnd() * 6.28, r = R(0, 5 + f.n * 0.3); b.want.set(f.home.x + Math.cos(a) * r, 0, f.home.z + Math.sin(a) * r); }
      let ax = (b.want.x - b.x) * 0.05, az = (b.want.z - b.z) * 0.05;
      // flee from boats: the faster and closer the boat, the harder they paddle
      let flee = 0;
      for (const o of boats) {
        const dx = b.x - o.x, dz = b.z - o.z; const d2 = dx * dx + dz * dz; const R0 = (o.halfLen || 3) + 26 + (o.spd || 0) * 2.5;
        if (d2 < R0 * R0) {
          const d = Math.sqrt(d2) || 1; const k = (1 - d / R0);
          // push sideways out of the boat's path as well as away from it
          const fx = Math.sin(o.psi || 0), fz = -Math.cos(o.psi || 0); const side = Math.sign(dx * -fz + dz * fx) || 1;
          ax += (dx / d * 0.6 + -fz * side * 0.8) * k * 2.2; az += (dz / d * 0.6 + fx * side * 0.8) * k * 2.2;
          flee = Math.max(flee, k);
          if (d < 7 && (o.spd || 0) > 2.5 && b.kind !== 'goose' && b.dive <= 0) b.dive = 2.2;
        }
      }
      f.alarm = Math.max(f.alarm * Math.exp(-dt * 0.5), flee);
      // keep apart from neighbours in the flock (cheap: only a couple of random checks)
      const o2 = this.birds[(this.birds.indexOf(b) + 1) % this.birds.length];
      if (o2.f === b.f) { const dx = b.x - o2.x, dz = b.z - o2.z, d2 = dx * dx + dz * dz; if (d2 < 0.8) { ax += dx * 0.8; az += dz * 0.8; } }
      const maxV = 0.35 + flee * 1.3;
      b.vx += ax * dt; b.vz += az * dt;
      const v = Math.hypot(b.vx, b.vz); if (v > maxV) { b.vx *= maxV / v; b.vz *= maxV / v; }
      b.vx *= 1 - dt * 0.4; b.vz *= 1 - dt * 0.4;
      // stay in the water
      const nx = b.x + b.vx * dt, nz = b.z + b.vz * dt;
      if (groundAt(nx, nz) < -0.25) { b.x = nx; b.z = nz; } else { b.vx *= -0.5; b.vz *= -0.5; }
      if (v > 0.05) { const hT = Math.atan2(b.vx, -b.vz); let dh = hT - b.h; while (dh > Math.PI) dh -= 6.283; while (dh < -Math.PI) dh += 6.283; b.h += dh * (1 - Math.exp(-dt * 3)); }
      if (b.dive > 0) b.dive -= dt;
      f.cx += b.x; f.cz += b.z; f.cn++;
    }
    for (const f of this.flocks) if (f.cn) f.c.set(f.cx / f.cn, 0, f.cz / f.cn);
    // write instances
    const m = this._m, q = this._q, e = this._e, sc = this._s;
    const ids = { drake: 0, hen: 0, goose: 0 };
    for (const b of this.birds) {
      const mesh = this.meshes[b.kind];
      if (b.far) { m.makeScale(0, 0, 0); mesh.setMatrixAt(b.idx, m); continue; }
      const f = this.flocks[b.f];
      const y = waveH(b.x, b.z, t, tide) + f.probe * 0.8 + Math.sin(t * 2.1 + b.ph) * 0.012;
      const dv = b.dive > 0 ? Math.sin(Math.min(1, (2.2 - b.dive) / 0.4) * Math.PI / 2) * (b.dive > 0.4 ? 1 : b.dive / 0.4) : 0;
      const bob = Math.sin(t * 1.7 + b.ph) * 0.04;
      e.set(bob + dv * 0.9 + f.probe * 0.4, -b.h, Math.sin(t * 1.3 + b.ph) * 0.05, 'YXZ'); q.setFromEuler(e);
      const s = b.kind === 'goose' ? 1.05 : 1.0; sc.set(s, s, s);
      m.compose(new V3(b.x, y - 0.04 - dv * 0.22, b.z), q, sc); mesh.setMatrixAt(b.idx, m);
    }
    for (const k in this.meshes) { this.meshes[k].instanceMatrix.needsUpdate = true; this.meshes[k].visible = S.night < 0.9; }
    // herons
    for (const H of this.herons) this.heron(H, dt, t, boats, S);
  }
  heron(H, dt, t, boats, S) {
    const g = H.g, u = g.userData; H.t += dt;
    let threat = 1e9; for (const o of boats) threat = Math.min(threat, Math.hypot(o.x - g.position.x, o.z - g.position.z) - (o.halfLen || 3) * 0.6);
    if (H.st === 'stand') {
      g.visible = true;
      g.position.y = 0.02;
      // patient hunting: neck coiled, a slow step now and then, a lightning strike
      if (H.strike <= 0 && rnd() < dt * 0.06) H.strike = 1.2;
      let neckA = -0.25 + Math.sin(t * 0.3) * 0.05, headA = 0.3;
      if (H.strike > 0) { H.strike -= dt; const k = Math.sin(clamp(1 - H.strike / 1.2, 0, 1) * Math.PI); neckA = -0.25 - k * 1.0; headA = 0.3 + k * 0.6; }
      u.neckG.rotation.x = neckA; u.head.rotation.x = headA;
      u.legGs.forEach((l, i) => { l.rotation.x = Math.max(0, Math.sin(H.t * 0.35 + i * Math.PI)) * 0.25; });
      g.rotation.y = H.yaw + Math.sin(H.t * 0.05) * 0.4;
      u.wings.forEach(([wg]) => { wg.visible = false; });
      u.body.rotation.x = 0;
      if (threat < 24 && S.night < 0.8) { H.st = 'fly'; H.fly = { t: 0, dir: Math.atan2(g.position.x - (boats[0] ? boats[0].x : 0), g.position.z - (boats[0] ? boats[0].z : 0)) }; }
    } else if (H.st === 'fly') {
      const F = H.fly; F.t += dt;
      const sp = 7.5 * smooth(0, 1.5, F.t);
      g.position.x += Math.sin(F.dir) * sp * dt; g.position.z += Math.cos(F.dir) * sp * dt;
      g.position.y = 0.02 + Math.min(14, F.t * F.t * 1.2 + F.t * 0.6);
      g.rotation.y = F.dir + Math.PI;
      u.body.rotation.x = -0.15;
      u.neckG.rotation.x = 0.9; u.head.rotation.x = -0.6; // neck folded back in flight
      u.legGs.forEach((l) => { l.rotation.x = -1.35; });
      const fl = Math.sin(F.t * (F.t < 2 ? 9 : 5.5));
      u.wings.forEach(([wg, og, sx]) => { wg.visible = true; wg.rotation.set(0, 0, sx * fl * 0.6); og.rotation.set(0, 0, sx * fl * 0.35); });
      if (F.t > 12) { g.visible = false; H.st = 'away'; H.away = 40; }
    } else {
      H.away -= dt;
      if (H.away <= 0 && threat > 60) { H.st = 'stand'; g.position.copy(H.home); }
    }
  }
}
