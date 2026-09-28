// Rowing crews out from Thompson Boat Center: an eight with a coxswain and a single sculler, working up and
// down the Georgetown reach with a proper stroke rhythm (catch, drive, finish, recovery) and run between strokes.
import * as THREE from 'three';
import { clamp, lerp, smooth } from './util.js';
import { frame, fromSD, toSD, hwR, hwL } from './world.js';
import { std } from './matpatch.js';
import { tube, merge, box, cyl, sph, tf, ensureColor } from './geo.js';
import { waveH } from './boat.js';

const V3 = THREE.Vector3;
function hullGeo(len, beam, depth) {
  const pts = [], rad = [];
  for (let i = 0; i <= 24; i++) { const t = i / 24; const z = (t - 0.5) * len; const w = Math.pow(Math.sin(t * Math.PI), 0.5); pts.push(new V3(0, 0, z)); rad.push(Math.max(0.008, w * beam / 2)); }
  const g = tube(pts, rad, 10); g.scale(1, depth / beam, 1); return g;
}
function rower(shirt) {
  // a compact low-poly athlete: seat-sliding hips, torso that swings, arms to the handle
  const skin = std({ color: 0xe4b294, roughness: 0.6 }, { wet: 0.4 }), top = std({ color: shirt, roughness: 0.7 }, { wet: 0.8 }), shorts = std({ color: 0x1c1f26, roughness: 0.8 }, { wet: 0.8 });
  const g = new THREE.Group();
  const hips = new THREE.Group(); g.add(hips);
  const add = (geo, m, p = hips) => { const o = new THREE.Mesh(geo, m); o.castShadow = true; p.add(o); return o; };
  // legs (bend with the slide)
  const legs = [];
  for (const sx of [-0.09, 0.09]) {
    const th = new THREE.Group(); th.position.set(sx, 0.02, 0); hips.add(th);
    add(new THREE.CylinderGeometry(0.06, 0.05, 0.42, 6).rotateX(Math.PI / 2).translate(0, 0, -0.21), shorts, th);
    const sh = new THREE.Group(); sh.position.set(0, 0, -0.42); th.add(sh);
    add(new THREE.CylinderGeometry(0.045, 0.04, 0.42, 6).rotateX(Math.PI / 2).translate(0, 0, -0.21), skin, sh);
    legs.push([th, sh]);
  }
  const torso = new THREE.Group(); torso.position.y = 0.05; hips.add(torso);
  add(new THREE.CylinderGeometry(0.13, 0.11, 0.5, 8).translate(0, 0.27, 0), top, torso);
  add(new THREE.SphereGeometry(0.1, 10, 8).translate(0, 0.64, 0), skin, torso);
  add(new THREE.SphereGeometry(0.103, 10, 6, 0, 6.3, 0, 1.3).translate(0, 0.655, 0), top, torso);
  const arms = [];
  for (const sx of [-0.17, 0.17]) { const a = new THREE.Group(); a.position.set(sx, 0.47, 0); torso.add(a); add(new THREE.CylinderGeometry(0.035, 0.03, 0.55, 6).rotateX(Math.PI / 2).translate(0, 0, -0.27), skin, a); arms.push(a); }
  g.userData = { hips, legs, torso, arms };
  return g;
}

class Shell {
  constructor(scene, o) {
    Object.assign(this, o);
    const g = this.m = new THREE.Group();
    const hullMat = std({ color: o.color, roughness: 0.25 }, { wet: 0.6 });
    const deckMat = std({ color: 0x2a2c30, roughness: 0.5 }, { wet: 0.6 });
    const metal = std({ color: 0xcfd3d6, roughness: 0.3, metalness: 1 }, { wet: 0.3 });
    const oarMat = std({ color: 0xf2efe8, roughness: 0.4 }, { wet: 0.6 }), blade = std({ color: o.blade, roughness: 0.5 }, { wet: 0.6 });
    const h = new THREE.Mesh(hullGeo(o.len, o.beam, 0.26), hullMat); h.castShadow = true; g.add(h);
    const dk = new THREE.Mesh(box(o.beam * 0.7, 0.02, o.len * 0.9, { y: 0.06 }), deckMat); g.add(dk);
    this.seats = []; this.oars = [];
    const n = o.n, pitch = 1.42;
    for (let i = 0; i < n; i++) {
      const z = (i - (n - 1) / 2) * pitch + (o.cox ? 0.7 : 0);
      const r = rower(o.shirts[i % o.shirts.length]); r.position.set(0, 0.12, z); r.rotation.y = Math.PI; // rowers face the stern (+z)
      g.add(r);
      const sides = o.sculls ? [-1, 1] : [(i % 2) ? 1 : -1];
      const ow = [];
      for (const sd of sides) {
        // rigger and pin
        const pin = new V3(sd * (o.sculls ? 0.8 : 0.85), 0.28, z - 0.05);
        const rig = new THREE.Mesh(merge([cyl(0.012, 0.012, Math.abs(pin.x), 5, { x: pin.x / 2, y: 0.2, rz: Math.PI / 2 })]), metal); g.add(rig);
        const oar = new THREE.Group(); oar.position.copy(pin); g.add(oar);
        const L = o.sculls ? 2.9 : 3.75, inb = o.sculls ? 0.88 : 1.15;
        const sh = new THREE.Mesh(cyl(0.016, 0.018, L, 6, { rz: Math.PI / 2, x: sd * (L / 2 - inb) }), oarMat); sh.castShadow = true; oar.add(sh);
        const bl = new THREE.Mesh(box(0.5, 0.2, 0.012, { x: sd * (L - inb - 0.22) }), blade); bl.castShadow = true; oar.add(bl);
        ow.push({ oar, sd, inb });
      }
      this.seats.push({ r, z }); this.oars.push(ow);
    }
    if (o.cox) { const c = rower(0x1c2a44); c.scale.setScalar(0.85); c.position.set(0, 0.1, o.len / 2 - 1.8); g.add(c); this.coxR = c; c.userData.torso.rotation.x = 0.15; }
    scene.add(g);
    this.u = 0; this.ph = Math.random(); this.s = o.s0; this.dir = 1; this.turn = null; this.psi = 0; this.x = 0; this.z = 0;
    this.halfLen = o.len / 2; this.halfBeam = o.beam / 2 + (o.sculls ? 1.2 : 1.6);
  }
  update(dt, t, tide, S) {
    // stroke cycle: drive 1/3, recovery 2/3
    this.ph = (this.ph + dt * this.rate / 60) % 1;
    const p = this.ph, drive = p < 0.34;
    const kd = drive ? p / 0.34 : 1 - (p - 0.34) / 0.66; // 0 at catch? here 0 = catch, 1 = finish
    const slide = drive ? smooth(0, 1, p / 0.34) : 1 - smooth(0, 1, (p - 0.34) / 0.66);
    // boat speed surges on the drive and runs out on the recovery
    const target = this.speed * (1 + 0.18 * (drive ? Math.sin(p / 0.34 * Math.PI) : -0.4 * Math.sin((p - 0.34) / 0.66 * Math.PI)));
    this.u = lerp(this.u, target, 1 - Math.exp(-dt * 3));
    // course: along a lane, U-turn at each end
    if (!this.turn) {
      this.s += this.dir * this.u * dt;
      if ((this.dir > 0 && this.s > this.s1) || (this.dir < 0 && this.s < this.s0)) this.turn = { t: 0, s: this.s, d0: this.lane[this.dir > 0 ? 0 : 1], d1: this.lane[this.dir > 0 ? 1 : 0] };
      this.d = this.lane[this.dir > 0 ? 0 : 1];
    } else {
      const T = this.turn; T.t += dt; const dur = 26; const k = Math.min(1, T.t / dur);
      const ang = k * Math.PI; const R = (T.d1 - T.d0) / 2;
      this.s = T.s + this.dir * Math.sin(ang) * Math.abs(R) * 0.8; this.d = T.d0 + R * (1 - Math.cos(ang));
      if (k >= 1) { this.dir *= -1; this.turn = null; }
    }
    const F = frame(this.s); const [x, z] = fromSD(this.s, this.d);
    let psi;
    if (this.turn) { const k = Math.min(1, this.turn.t / 26); psi = F.th + (this.dir > 0 ? 0 : Math.PI) + Math.sign(this.turn.d1 - this.turn.d0) * this.dir * k * Math.PI; }
    else psi = F.th + (this.dir > 0 ? 0 : Math.PI);
    this.psi = psi; this.x = x; this.z = z; this.spd = this.u;
    this.relHeading = psi - F.th;
    const y = waveH(x, z, t, tide);
    this.m.position.set(x, y - 0.05, z);
    this.m.rotation.set(Math.sin(p * 6.283) * 0.006, -psi, Math.sin(t * 0.9) * 0.01, 'YXZ');
    // crew motion: seat slide, layback, arms; oars sweep in the horizontal, blades square and dip on the drive
    const lay = drive ? lerp(-0.45, 0.35, smooth(0, 1, p / 0.34)) : lerp(0.35, -0.45, smooth(0, 0.7, (p - 0.34) / 0.66));
    const armK = drive ? smooth(0.55, 1, p / 0.34) : 1 - smooth(0, 0.35, (p - 0.34) / 0.66);
    for (const st of this.seats) {
      const u = st.r.userData;
      u.hips.position.z = lerp(-0.34, 0.1, slide); // rowers face +z (stern): -z is toward the bow... negative = compressed at catch
      const legK = 1 - slide; // knees up at the catch
      u.legs.forEach(([th, sh]) => { th.rotation.x = 0.9 * legK + 0.05; sh.rotation.x = -1.5 * legK - 0.05; });
      u.torso.rotation.x = lay;
      u.arms.forEach((a) => { a.rotation.x = -lerp(0.35, 1.1, armK) - lay; a.rotation.y = 0; });
    }
    for (const ow of this.oars) for (const o of ow) {
      // sweep angle about the pin: catch far toward the bow, finish near perpendicular
      const sweep = lerp(0.85, -0.55, slide * 0.5 + (drive ? p / 0.34 : 1 - (p - 0.34) / 0.66) * 0.5);
      const dip = drive ? 0.13 : -0.1 * smooth(0, 0.2, (p - 0.34) / 0.66);
      o.oar.rotation.set(0, o.sd * sweep, -o.sd * dip, 'YXZ');
      o.oar.children[1].rotation.x = drive ? 0 : Math.PI / 2 * smooth(0, 0.12, (p - 0.34) / 0.66) * (1 - smooth(0.85, 1, (p - 0.34) / 0.66)); // feathering
    }
    this.m.visible = S.night < 0.75;
  }
  simBoat() { return { s: this.s, d: this.d, relHeading: this.relHeading, speed: this.u, halfLen: this.len / 2, halfBeam: this.beam / 2 + 0.2, strength: 0.25, prop: 0.15 }; }
}

export class Rowing {
  constructor(scene) {
    this.shells = [
      new Shell(scene, { n: 8, cox: true, len: 17.5, beam: 0.6, color: 0xf2efe8, blade: 0x1f3c78, shirts: [0x1f3c78, 0x8a1c2c], rate: 32, speed: 4.6, s0: 560, s1: 1350, lane: [-40, -52] }),
      new Shell(scene, { n: 1, sculls: true, len: 8.2, beam: 0.34, color: 0xe8c43a, blade: 0x1a1a1a, shirts: [0x2e7a5a], rate: 27, speed: 3.6, s0: 700, s1: 1500, lane: [-22, -30] }),
    ];
    this.shells[0].s = 900; this.shells[1].s = 1150; this.shells[1].dir = -1;
  }
  update(dt, t, tide, S) { for (const sh of this.shells) sh.update(dt, t, tide, S); }
  simBoats() { return this.shells.filter((s) => s.m.visible).map((s) => s.simBoat()); }
}
