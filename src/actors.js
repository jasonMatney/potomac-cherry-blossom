// Character animation: skipper at the helm (IK on wheel & throttle, knees absorbing chop, counterbalance),
// woman with red umbrella at the rail, groundskeeper sweeping petals on the river steps.
import * as THREE from 'three';
import { clamp, lerp, smooth } from './util.js';
import { makeUmbrella, makeBroom } from './people.js';
import { makeSkipperChar, makeWomanChar, makeKeeperChar } from './outfits.js';
import { frame, fromSD, hwR } from './world.js';
import { terrainH } from './terrain.js';
import { U, windAt } from './matpatch.js';

const V3 = THREE.Vector3;
const _v = new V3(), _w = new V3(), _q = new THREE.Quaternion();

export class Skipper {
  constructor(boatModel, charOpts) {
    const c = this.c = makeSkipperChar(charOpts); this.rig = c.rig; this.boatModel = boatModel;
    const ud = boatModel.userData;
    this.zStand = ud.zCon + 0.5;
    c.root.position.set(0, 0.12, this.zStand);
    boatModel.add(c.root);
    this.aIdle = c.play('Idle_Loop', 1, 0.7);
    this.onFoot = false;
    this.kneeV = 0; this.knee = 0; this.prevHeaveV = 0; this.prevY = 0; this.lean = 0; this.leanV = 0;
    this.look = 0; this.t = 0;
  }
  update(dt, t, boat) {
    if (this.onFoot) return; // the stops controller animates him ashore
    const c = this.c, rig = this.rig, k = c.root.scale.x;
    c.mixer.update(dt);
    boat.root.updateMatrixWorld(true);
    // vertical acceleration of the deck -> knees absorb it
    const y = boat.root.position.y + boat.pitch * 0.4;
    const vy = (y - this.prevY) / Math.max(dt, 1e-3); this.prevY = y;
    const ay = (vy - this.prevHeaveV) / Math.max(dt, 1e-3); this.prevHeaveV = vy;
    const kneeT = 0.03 + clamp(ay * 0.012, -0.025, 0.04) + boat.bump * 0.05 + Math.abs(boat.roll) * 0.08;
    this.kneeV += ((kneeT - this.knee) * 90 - this.kneeV * 14) * dt; this.knee += this.kneeV * dt;
    // counterbalance: the spine leans against roll and into turns
    const latAcc = boat.u * boat.r;
    const leanT = clamp(-boat.roll * 0.85 - latAcc * 0.018, -0.25, 0.25);
    this.leanV += ((leanT - this.lean) * 40 - this.leanV * 9) * dt; this.lean += this.leanV * dt;
    const X = new V3(1, 0, 0), Yax = new V3(0, 1, 0), Z = new V3(0, 0, 1);
    rig.moveG('pelvis', new V3(-this.lean * 0.08, -this.knee, 0.03));
    rig.rotG('pelvis', Z, boat.roll * 0.35 + this.lean * 0.15);
    rig.rotG('spine_01', X, -0.12 + boat.pitch * 0.3 + clamp(boat.acc, -1, 1) * 0.035);
    rig.rotG('spine_02', Z, boat.roll * 0.3 + this.lean * 0.35 + latAcc * 0.01);
    rig.rotG('spine_03', Z, boat.roll * 0.25);
    this.look = lerp(this.look, clamp(-boat.rudder * 0.35 + Math.sin(t * 0.17) * 0.18 + Math.sin(t * 0.43) * 0.06, -0.6, 0.6), 1 - Math.exp(-dt * 2));
    rig.rotG('neck_01', X, 0.14); rig.rotG('neck_01', Yax, this.look * 0.4); rig.rotG('Head', Yax, this.look * 0.6);
    rig.rotG('Head', Z, boat.roll * 0.6); rig.rotG('Head', X, -0.04 + Math.sin(t * 0.3) * 0.03);
    // world frame of the character
    const gq = c.root.getWorldQuaternion(new THREE.Quaternion());
    const right = new V3(1, 0, 0).applyQuaternion(gq), fwd = new V3(0, 0, -1).applyQuaternion(gq), up = new V3(0, 1, 0).applyQuaternion(gq);
    // legs: feet planted on the deck, knees forward
    for (const [s, sx] of [['l', -1], ['r', 1]]) {
      const rp = rig.restPG['foot_' + s];
      const ank = c.root.localToWorld(new V3(sx * 0.15, rp.y, rp.z + (s === 'l' ? -0.06 : 0.07)));
      const knee = rig.worldPos('thigh_' + s).addScaledVector(fwd, 0.6).addScaledVector(right, sx * 0.1);
      rig.twoBone('thigh_' + s, 'calf_' + s, ank, knee, new V3(0, 0, -1));
      rig.aim('foot_' + s, rig.restDir['foot_' + s].clone().applyQuaternion(gq).addScaledVector(right, sx * 0.12), new V3(1, 0, 0), right);
    }
    // arms: left hand on the wheel rim (rotates with the wheel), right hand on the throttle knob
    const ud = this.boatModel.userData;
    ud.wheel.updateMatrixWorld(true); ud.throttle.updateMatrixWorld(true);
    const a0 = 3.0;
    const W = ud.wheel.matrixWorld;
    const rimL = new V3(Math.cos(a0) * 0.19, Math.sin(a0) * 0.19, 0).applyMatrix4(W);
    const outL = new V3(Math.cos(a0), Math.sin(a0), 0).transformDirection(W);
    const wheelN = new V3(0, 0, 1).transformDirection(W);
    const knob = new V3(0.02, 0.2, 0).applyMatrix4(ud.throttle.matrixWorld);
    const knobUp = new V3(0, 1, 0).transformDirection(ud.throttle.matrixWorld);
    // left: fingers run outward across the rim and wrap forward around it; palm faces the wheel
    {
      const fdir = outL.clone().multiplyScalar(0.75).addScaledVector(wheelN, 0.35).normalize();
      const palm = wheelN.clone().negate().addScaledVector(outL, -0.2).normalize();
      const wrist = rimL.clone().addScaledVector(fdir, -0.085 * k * 1.05).addScaledVector(palm, -0.034 * k);
      const sh = rig.worldPos('upperarm_l');
      rig.twoBone('upperarm_l', 'lowerarm_l', wrist, sh.clone().addScaledVector(right, -0.4).addScaledVector(up, -0.5).addScaledVector(fwd, -0.35), new V3(0, -0.4, 1));
      rig.hand('l', fdir, palm); rig.curl('l', 1.0, 0.8);
    }
    // right: palm on top of the knob, fingers curled over its front
    {
      const fdir = fwd.clone().multiplyScalar(0.8).addScaledVector(knobUp, -0.45).addScaledVector(right, -0.12).normalize();
      const palm = knobUp.clone().negate().addScaledVector(fwd, 0.3).normalize();
      const wrist = knob.clone().addScaledVector(fdir, -0.07 * k).addScaledVector(palm, -0.03 * k);
      const sh = rig.worldPos('upperarm_r');
      rig.twoBone('upperarm_r', 'lowerarm_r', wrist, sh.clone().addScaledVector(right, 0.45).addScaledVector(up, -0.5).addScaledVector(fwd, -0.3), new V3(0, -0.4, 1));
      rig.hand('r', fdir, palm); rig.curl('r', 1.05, 0.6);
    }
    // jacket flutter from the apparent wind (true wind minus the boat's own speed)
    const wv = windAt(boat.x, boat.z, t, _w);
    const [bfx, bfz] = boat.fwd();
    _v.set(wv.x * 3 - bfx * boat.speedGround, 0, wv.z * 3 - bfz * boat.speedGround);
    const sp = _v.length();
    _v.multiplyScalar(0.0035 * (1 + 0.25 * Math.sin(t * 13))); _v.y = 0.003 * Math.min(sp, 8) * Math.sin(t * 17);
    c.setFlutter(_v);
  }
}

// wrap a hand around a rod-like object: the rod runs through the palm, knuckles along it
export function grip(rig, side, center, fingerDir, palm, curl = 1, thumb = 0.8, reach = 0.066, depth = 0.034, pole = null, poleRest = new V3(0, -0.4, 1)) {
  const wrist = center.clone().addScaledVector(fingerDir, -reach).addScaledVector(palm, -depth);
  const sh = rig.worldPos('upperarm_' + side);
  rig.twoBone('upperarm_' + side, 'lowerarm_' + side, wrist, pole || sh.clone().add(new V3(0, -0.5, 0)), poleRest);
  rig.hand(side, fingerDir, palm); rig.curl(side, curl, thumb);
}

export class Woman {
  constructor(scene) {
    const c = this.c = makeWomanChar(); this.rig = c.rig;
    const s = 906, e = 0.86; const d = hwR(s) + e; const [x, z] = fromSD(s, d); const F = frame(s);
    this.y = terrainH(s, d) + 0.02;
    c.root.position.set(x, this.y, z);
    this.baseYaw = Math.PI / 2 - F.th; c.root.rotation.y = this.baseYaw;
    scene.add(c.root);
    c.play('Idle_Loop', 1, 0.6);
    this.umb = makeUmbrella(); scene.add(this.umb);
    // the top rail in front of her (top rail at 2.26 + 1.08)
    const dr = hwR(s) + 0.42; const [rx, rz] = fromSD(s - 0.2, dr);
    this.rail = new V3(rx, 2.26 + 1.08, rz);
    const [r2x, r2z] = fromSD(s + 0.3, dr); this.railDir = new V3(r2x - rx, 0, r2z - rz).normalize();
    this.s = s; this.look = 0; this.F = F;
  }
  update(dt, t, focus) {
    const c = this.c, rig = this.rig, g = c.root;
    c.mixer.update(dt);
    g.updateMatrixWorld(true);
    const X = new V3(1, 0, 0), Yax = new V3(0, 1, 0), Z = new V3(0, 0, 1);
    const shift = Math.sin(t * 0.21) * 0.5 + Math.sin(t * 0.13) * 0.3;
    rig.moveG('pelvis', new V3(shift * 0.02, -0.012, 0));
    rig.rotG('pelvis', Z, -shift * 0.04);
    // watch the boats: turn the head and chest toward the hero boat within comfortable limits
    const hp = rig.worldPos('Head');
    const loc = focus.clone().sub(hp).applyQuaternion(g.getWorldQuaternion(new THREE.Quaternion()).invert());
    const yawT = clamp(Math.atan2(-loc.x, -loc.z), -1.1, 1.1);
    this.look = lerp(this.look, yawT, 1 - Math.exp(-dt * 1.2));
    rig.rotG('spine_03', Yax, this.look * 0.2); rig.rotG('neck_01', Yax, this.look * 0.35); rig.rotG('Head', Yax, this.look * 0.4);
    rig.rotG('Head', X, 0.05 + Math.sin(t * 0.37) * 0.02);
    const gq = g.getWorldQuaternion(new THREE.Quaternion());
    const right = new V3(1, 0, 0).applyQuaternion(gq), fwd = new V3(0, 0, -1).applyQuaternion(gq), up = new V3(0, 1, 0);
    for (const [s, sx] of [['l', -1], ['r', 1]]) {
      const rp = rig.restPG['foot_' + s];
      const ank = g.localToWorld(new V3(sx * 0.12, rp.y, rp.z + (s === 'l' ? -0.03 : 0.05)));
      const knee = rig.worldPos('thigh_' + s).addScaledVector(fwd, 0.6).addScaledVector(right, sx * 0.08);
      rig.twoBone('thigh_' + s, 'calf_' + s, ank, knee, new V3(0, 0, -1));
      rig.aim('foot_' + s, rig.restDir['foot_' + s].clone().applyQuaternion(gq).addScaledVector(right, sx * 0.15), new V3(1, 0, 0), right);
    }
    // left hand rests on the top rail, fingers curled over it
    const railC = this.rail.clone().addScaledVector(right, -0.02);
    grip(rig, 'l', railC, fwd.clone().multiplyScalar(0.85).addScaledVector(up, -0.15).addScaledVector(right, 0.25).normalize(), up.clone().negate().addScaledVector(fwd, 0.1).normalize(), 0.55, 0.3, 0.075, 0.028,
      rig.worldPos('upperarm_l').addScaledVector(right, -0.4).addScaledVector(up, -0.5).addScaledVector(fwd, 0.2));
    // right hand holds the umbrella shaft in front of her shoulder
    const chest = rig.worldPos('spine_03');
    const wv = windAt(g.position.x, g.position.z, t, _w);
    const sway = new V3(Math.sin(t * 0.7) * 0.015, 0, Math.cos(t * 0.53) * 0.015);
    const shaftDir = new V3(0, 1, 0).addScaledVector(right, -0.14).addScaledVector(fwd, -0.12).add(new V3(wv.x, 0, wv.z).multiplyScalar(0.06)).normalize();
    const hold = chest.clone().addScaledVector(right, 0.14).addScaledVector(fwd, 0.26).addScaledVector(up, -0.02).add(sway);
    const across = new V3().crossVectors(shaftDir, fwd).normalize(); // points to her left
    grip(rig, 'r', hold, across.clone().addScaledVector(fwd, 0.25).normalize(), fwd.clone().negate().addScaledVector(right, 0.2).normalize(), 1.05, 0.9, 0.06, 0.03,
      rig.worldPos('upperarm_r').addScaledVector(right, 0.5).addScaledVector(up, -0.6).addScaledVector(fwd, 0.1));
    // the umbrella follows the hand: shaft through the fist, handle crook below it
    this.umb.position.copy(hold).addScaledVector(shaftDir, -0.1);
    this.umb.quaternion.setFromUnitVectors(new V3(0, 1, 0), shaftDir);
    this.umb.rotateY(t * 0.05);
    c.setFlutter(new V3(wv.x, 0, wv.z).multiplyScalar(0.012));
  }
}

export class Groundskeeper {
  constructor(scene, steps) {
    const c = this.c = makeKeeperChar(); this.rig = c.rig;
    // stands on the second tread of the river steps, sweeping along the step
    const s = 858; const k = 1; const e = -(k + 0.5) * 0.72;
    const d = hwR(s) + e; const [x, z] = fromSD(s, d); const F = frame(s);
    this.y = 2.1 - (k + 1) * 0.29;
    c.root.position.set(x, this.y, z);
    c.root.rotation.y = -F.th; // face upstream along the tread
    scene.add(c.root);
    c.play('Idle_Loop', 1, 0.5);
    this.broom = makeBroom(); scene.add(this.broom);
    this.F = F;
  }
  update(dt, t) {
    const c = this.c, rig = this.rig, g = c.root;
    c.mixer.update(dt);
    g.updateMatrixWorld(true);
    const X = new V3(1, 0, 0), Yax = new V3(0, 1, 0), Z = new V3(0, 0, 1);
    // sweep cycle: push forward, lift, return
    const T = 2.4; const ph = (t % T) / T;
    const push = ph < 0.55 ? smooth(0, 0.55, ph) : 1 - smooth(0.55, 1, ph);
    const lift = ph > 0.55 ? Math.sin((ph - 0.55) / 0.45 * Math.PI) : 0;
    const breathe = Math.sin(t * 1.0) * 0.5 + 0.5;
    rig.moveG('pelvis', new V3(0.02, -0.06 - push * 0.02, -push * 0.05));
    rig.rotG('pelvis', Yax, 0.1);
    rig.rotG('spine_01', X, -0.18 - push * 0.1 - breathe * 0.01);
    rig.rotG('spine_03', X, -0.08); rig.rotG('spine_03', Yax, 0.12);
    rig.rotG('neck_01', X, 0.2); rig.rotG('Head', X, -0.1 + Math.sin(t * 0.4) * 0.05); rig.rotG('Head', Yax, Math.sin(t * 0.23) * 0.2);
    const gq = g.getWorldQuaternion(new THREE.Quaternion());
    const right = new V3(1, 0, 0).applyQuaternion(gq), fwd = new V3(0, 0, -1).applyQuaternion(gq), up = new V3(0, 1, 0);
    for (const [s, sx, fz] of [['l', -1, -0.12], ['r', 1, 0.16]]) {
      const rp = rig.restPG['foot_' + s];
      const ank = g.localToWorld(new V3(sx * 0.14, rp.y, rp.z + fz));
      const knee = rig.worldPos('thigh_' + s).addScaledVector(fwd, 0.6).addScaledVector(right, sx * 0.1);
      rig.twoBone('thigh_' + s, 'calf_' + s, ank, knee, new V3(0, 0, -1));
      rig.aim('foot_' + s, rig.restDir['foot_' + s].clone().applyQuaternion(gq).addScaledVector(right, sx * 0.25), new V3(1, 0, 0), right);
    }
    // broom: head slides along the tread in front, handle up towards the body
    const base = g.position.clone().addScaledVector(fwd, 0.85 + push * 0.4).addScaledVector(right, 0.1).addScaledVector(up, 0.025 + lift * 0.06);
    const topP = g.position.clone().addScaledVector(fwd, 0.08 + push * 0.3).addScaledVector(right, 0.2).addScaledVector(up, 1.05);
    const hd = topP.clone().sub(base).normalize();
    this.broom.position.copy(base);
    const m = new THREE.Matrix4(); const xAx = right.clone().sub(hd.clone().multiplyScalar(right.dot(hd))).normalize(); const zAx = new V3().crossVectors(xAx, hd);
    m.makeBasis(xAx, hd, zAx); this.broom.quaternion.setFromRotationMatrix(m);
    // both hands wrap the handle: left higher (thumb up the handle), right lower
    const side = new V3().crossVectors(hd, up).normalize(); // horizontal, across the handle
    for (const [s, along, sgn] of [['l', 1.12, -1], ['r', 0.72, 1]]) {
      const center = base.clone().addScaledVector(hd, along);
      const toBody = g.position.clone().setY(center.y).sub(center).normalize();
      const palm = toBody.clone().negate().addScaledVector(right, -sgn * 0.3).normalize();
      const fdir = new V3().crossVectors(palm, hd).multiplyScalar(sgn).normalize();
      grip(rig, s, center, fdir, palm, 1.1, 0.8, 0.062, 0.033,
        rig.worldPos('upperarm_' + s).addScaledVector(right, sgn * 0.5).addScaledVector(up, -0.4));
    }
    this.sweepPoint = base; this.push = push; this.ph = ph;
  }
}
