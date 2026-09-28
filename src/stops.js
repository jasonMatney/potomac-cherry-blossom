// Stops along the river: ease into a berth, step ashore, walk around, and unlock a small moment at each:
// an ice cream at Georgetown Waterfront, a beer at Thompson Boat Center, a stretch at Fletcher's Cove.
import * as THREE from 'three';
import { clamp, lerp, smooth } from './util.js';
import { frame, fromSD, toSD, hwR } from './world.js';
import { groundAt } from './terrain.js';
import { inSolid, addLight, addWalkBlock, walkBlocked } from './registry.js';
import { std } from './matpatch.js';
import { box, rbox, cyl, sph, merge, tf, boxUV, ensureColor } from './geo.js';
import { M } from './mats.js';
import { makeSkipperChar } from './outfits.js';
import { grip } from './actors.js';
import { laneAt } from './boat.js';

const V3 = THREE.Vector3, Q = THREE.Quaternion;
const X = new V3(1, 0, 0), Y = new V3(0, 1, 0), Z = new V3(0, 0, 1);
const wrap = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
const ease = (x) => x * x * (3 - 2 * x);
// (s, e) with e measured from the right bank at s (or at a fixed reference station)
const sdE = (s, e, ref) => fromSD(s, hwR(ref ?? s) + e);
const P3 = (s, e, y, ref) => { const [x, z] = sdE(s, e, ref); return new V3(x, y ?? groundAt(x, z), z); };

// ------------------------------------------------------------------ icons (drawn, never lettered)
export function drawIcon(kind, size = 128) {
  const c = document.createElement('canvas'); c.width = c.height = size; const g = c.getContext('2d');
  const S = size / 128; g.scale(S, S); g.lineCap = 'round'; g.lineJoin = 'round';
  g.shadowColor = 'rgba(0,0,0,0.35)'; g.shadowBlur = 6;
  if (kind === 'icecream') {
    g.fillStyle = '#d9a25e'; g.beginPath(); g.moveTo(40, 62); g.lineTo(88, 62); g.lineTo(64, 118); g.closePath(); g.fill();
    g.strokeStyle = 'rgba(120,70,30,0.6)'; g.lineWidth = 2; g.shadowBlur = 0;
    for (let i = -2; i <= 2; i++) { g.beginPath(); g.moveTo(52 + i * 9, 62); g.lineTo(72 + i * 9, 100); g.stroke(); g.beginPath(); g.moveTo(76 - i * 9, 62); g.lineTo(56 - i * 9, 100); g.stroke(); }
    g.shadowBlur = 6; g.fillStyle = '#f5a9bf'; g.beginPath(); g.arc(64, 48, 24, 0, 7); g.fill();
    g.fillStyle = 'rgba(255,255,255,0.55)'; g.beginPath(); g.arc(56, 40, 7, 0, 7); g.fill();
  } else if (kind === 'beer') {
    g.fillStyle = '#e8a93a'; g.beginPath(); g.roundRect(34, 40, 48, 70, 8); g.fill();
    g.strokeStyle = '#f4f1ea'; g.lineWidth = 9; g.beginPath(); g.arc(84, 72, 14, -1.3, 1.3); g.stroke();
    g.fillStyle = '#fbf7ee'; g.beginPath(); g.arc(44, 40, 11, 0, 7); g.arc(60, 34, 13, 0, 7); g.arc(76, 40, 11, 0, 7); g.fill();
    g.fillStyle = 'rgba(255,255,255,0.4)'; g.fillRect(42, 52, 6, 48);
  } else if (kind === 'stretch') {
    g.strokeStyle = '#f4f1ea'; g.lineWidth = 9;
    g.beginPath(); g.arc(64, 30, 10, 0, 7); g.fillStyle = '#f4f1ea'; g.fill();
    g.beginPath(); g.moveTo(64, 44); g.lineTo(64, 82); g.moveTo(64, 82); g.lineTo(48, 116); g.moveTo(64, 82); g.lineTo(80, 116);
    g.moveTo(64, 50); g.lineTo(40, 14); g.moveTo(64, 50); g.lineTo(88, 14); g.stroke();
  } else if (kind === 'anchor') {
    g.strokeStyle = '#f4f1ea'; g.lineWidth = 9;
    g.beginPath(); g.arc(64, 22, 9, 0, 7); g.moveTo(64, 31); g.lineTo(64, 108); g.moveTo(44, 46); g.lineTo(84, 46);
    g.moveTo(28, 82); g.quadraticCurveTo(34, 110, 64, 108); g.quadraticCurveTo(94, 110, 100, 82); g.stroke();
  } else if (kind === 'house') {
    g.fillStyle = '#f4f1ea'; g.beginPath(); g.moveTo(64, 14); g.lineTo(112, 58); g.lineTo(98, 58); g.lineTo(98, 112); g.lineTo(30, 112); g.lineTo(30, 58); g.lineTo(16, 58); g.closePath(); g.fill();
    g.fillStyle = '#b8742e'; g.fillRect(80, 22, 12, 26); g.fillStyle = '#5a4030'; g.fillRect(56, 80, 18, 32); g.fillStyle = '#f0c25a'; g.fillRect(38, 66, 14, 14); g.fillRect(78, 66, 14, 14);
  } else if (kind === 'tv') {
    g.fillStyle = '#f4f1ea'; g.beginPath(); g.roundRect(14, 26, 100, 66, 8); g.fill(); g.fillStyle = '#5a8ad8'; g.fillRect(22, 34, 84, 50); g.fillStyle = '#f0a050'; g.beginPath(); g.arc(80, 50, 9, 0, 7); g.fill(); g.fillStyle = '#2a6a4a'; g.fillRect(22, 66, 84, 18);
    g.fillStyle = '#f4f1ea'; g.fillRect(58, 92, 12, 10); g.fillRect(42, 102, 44, 6);
  } else if (kind === 'fire') {
    g.fillStyle = '#f07a28'; g.beginPath(); g.moveTo(64, 12); g.bezierCurveTo(98, 50, 104, 74, 90, 96); g.bezierCurveTo(80, 114, 48, 114, 38, 96); g.bezierCurveTo(26, 74, 40, 52, 52, 40); g.bezierCurveTo(52, 60, 60, 66, 64, 12); g.fill();
    g.fillStyle = '#f8d25a'; g.beginPath(); g.moveTo(64, 56); g.bezierCurveTo(82, 76, 82, 100, 64, 104); g.bezierCurveTo(46, 100, 48, 80, 64, 56); g.fill();
    g.fillStyle = '#7a4a28'; g.fillRect(28, 108, 72, 10);
  } else if (kind === 'pot') {
    g.fillStyle = '#f4f1ea'; g.beginPath(); g.roundRect(26, 56, 76, 50, 10); g.fill(); g.fillRect(18, 60, 12, 8); g.fillRect(98, 60, 12, 8); g.fillRect(22, 50, 84, 8);
    g.strokeStyle = '#f4f1ea'; g.lineWidth = 5; for (const x of [46, 64, 82]) { g.beginPath(); g.moveTo(x, 44); g.bezierCurveTo(x - 8, 34, x + 8, 26, x, 14); g.stroke(); }
  } else if (kind === 'drop') {
    g.fillStyle = '#7ac8f0'; g.beginPath(); g.moveTo(64, 12); g.bezierCurveTo(90, 50, 100, 70, 100, 84); g.arc(64, 84, 36, 0, Math.PI); g.bezierCurveTo(28, 70, 38, 50, 64, 12); g.fill(); g.fillStyle = 'rgba(255,255,255,0.6)'; g.beginPath(); g.arc(50, 84, 9, 0, 7); g.fill();
  } else if (kind === 'moon') {
    g.fillStyle = '#f4e6b0'; g.beginPath(); g.arc(64, 64, 42, 0, 7); g.fill(); g.globalCompositeOperation = 'destination-out'; g.beginPath(); g.arc(84, 48, 38, 0, 7); g.fill(); g.globalCompositeOperation = 'source-over';
    g.fillStyle = '#f4f1ea'; for (const [x, y] of [[96, 90], [104, 30], [84, 108]]) { g.beginPath(); g.arc(x, y, 4, 0, 7); g.fill(); }
  } else if (kind === 'scope') {
    g.fillStyle = '#f4f1ea'; g.save(); g.translate(64, 52); g.rotate(-0.5); g.fillRect(-44, -10, 80, 20); g.fillRect(36, -14, 10, 28); g.restore();
    g.strokeStyle = '#f4f1ea'; g.lineWidth = 6; g.beginPath(); g.moveTo(64, 60); g.lineTo(40, 116); g.moveTo(64, 60); g.lineTo(88, 116); g.moveTo(64, 60); g.lineTo(64, 116); g.stroke();
    g.fillStyle = '#f4e6b0'; for (const [x, y] of [[104, 20], [112, 44], [18, 18]]) { g.beginPath(); g.arc(x, y, 4, 0, 7); g.fill(); }
  } else if (kind === 'cat') {
    g.fillStyle = '#e8944a'; g.beginPath(); g.ellipse(64, 86, 34, 28, 0, 0, 7); g.fill(); g.beginPath(); g.arc(64, 48, 26, 0, 7); g.fill();
    g.beginPath(); g.moveTo(42, 36); g.lineTo(44, 10); g.lineTo(60, 28); g.fill(); g.beginPath(); g.moveTo(86, 36); g.lineTo(84, 10); g.lineTo(68, 28); g.fill();
    g.fillStyle = '#2a2a2a'; g.beginPath(); g.arc(55, 46, 4, 0, 7); g.arc(73, 46, 4, 0, 7); g.fill();
    g.strokeStyle = '#e8944a'; g.lineWidth = 9; g.beginPath(); g.moveTo(96, 100); g.quadraticCurveTo(122, 90, 110, 62); g.stroke();
  } else if (kind === 'boat') {
    g.fillStyle = '#f4f1ea';
    g.beginPath(); g.moveTo(18, 74); g.lineTo(110, 74); g.lineTo(96, 96); g.lineTo(30, 96); g.closePath(); g.fill();
    g.strokeStyle = '#f4f1ea'; g.lineWidth = 6; g.beginPath(); g.moveTo(44, 72); g.lineTo(44, 44); g.lineTo(88, 44); g.lineTo(88, 72); g.stroke();
    g.fillRect(40, 38, 52, 8);
  }
  return c;
}

// ------------------------------------------------------------------ props
function iceCart() {
  const g = new THREE.Group();
  const body = std({ color: 0xf6e8ee, roughness: 0.45 }, { wet: 0.6 }), trim = std({ color: 0xd8738f, roughness: 0.4 }, { wet: 0.6 });
  const metal = std({ color: 0xcfd3d6, roughness: 0.3, metalness: 1 }, { wet: 0.3 }), dark = std({ color: 0x222428, roughness: 0.6 }, { wet: 0.4 });
  const add = (geo, m) => { const o = new THREE.Mesh(geo, m); o.castShadow = true; o.receiveShadow = true; g.add(o); return o; };
  add(rbox(1.5, 0.78, 0.8, 0.06, { y: 0.62 }), body);
  add(rbox(1.52, 0.1, 0.82, 0.03, { y: 1.04 }), trim);
  add(rbox(1.52, 0.1, 0.82, 0.03, { y: 0.26 }), trim);
  // glass-lidded freezer with tubs of colour
  add(box(1.3, 0.02, 0.6, { y: 1.1 }), std({ color: 0xdfeaf0, roughness: 0.05, metalness: 0.2, transparent: true, opacity: 0.35 }));
  const tubs = [0xf5a9bf, 0xf3e3b0, 0x9fdcc0, 0x7a4a30, 0xf7f3ea, 0xe9788a];
  tubs.forEach((c, i) => add(cyl(0.09, 0.09, 0.04, 12, { x: -0.5 + (i % 3) * 0.25, y: 1.09, z: i < 3 ? -0.13 : 0.13 }), std({ color: c, roughness: 0.8 })));
  for (const sx of [-0.6, 0.6]) add(cyl(0.2, 0.2, 0.06, 16, { x: sx, y: 0.2, z: 0.42, rx: Math.PI / 2 }), dark);
  add(cyl(0.02, 0.02, 0.9, 6, { x: -0.8, y: 0.95, z: 0, rz: 1.2 }), metal);
  // striped umbrella
  add(cyl(0.025, 0.025, 1.6, 6, { y: 1.85 }), metal);
  const uc = document.createElement('canvas'); uc.width = 256; uc.height = 8; const ux = uc.getContext('2d');
  for (let i = 0; i < 12; i++) { ux.fillStyle = i % 2 ? '#f7f3ea' : '#e0738f'; ux.fillRect(i * 256 / 12, 0, 256 / 12 + 1, 8); }
  const ut = new THREE.CanvasTexture(uc); ut.colorSpace = THREE.SRGBColorSpace;
  const umb = new THREE.ConeGeometry(1.25, 0.45, 24, 1, true); umb.translate(0, 2.65, 0);
  const um = add(umb, std({ map: ut, roughness: 0.8, side: THREE.DoubleSide }, { wet: 1, transl: 0.4 }));
  um.castShadow = true;
  return g;
}
function picnicTable(seatH) {
  const g = new THREE.Group();
  const parts = [];
  const topH = seatH + 0.3;
  parts.push(box(1.9, 0.05, 0.8, { y: topH }));
  for (const sz of [-0.66, 0.66]) parts.push(box(1.9, 0.045, 0.3, { y: seatH, z: sz }));
  for (const sx of [-0.7, 0.7]) {
    for (const sg of [-1, 1]) { const l = box(0.08, Math.hypot(topH, 0.75) + 0.05, 0.08, { rx: sg * Math.atan2(0.75, topH) }); l.translate(sx, topH / 2, 0); parts.push(l); }
    parts.push(box(0.08, 0.06, 1.62, { x: sx, y: seatH - 0.05 }));
  }
  const geo = merge(parts); boxUV(geo, 0.6);
  const m = new THREE.Mesh(geo, M.wood); m.castShadow = true; m.receiveShadow = true; g.add(m);
  // market umbrella
  const pole = new THREE.Mesh(merge([cyl(0.025, 0.025, 2.4, 6, { y: 1.2 })]), M.alu); g.add(pole);
  const cv = std({ color: 0x2f5d58, roughness: 0.85, side: THREE.DoubleSide }, { wet: 1, transl: 0.3 });
  const ug = new THREE.ConeGeometry(1.4, 0.4, 8, 1, true); ug.translate(0, 2.35, 0);
  const um = new THREE.Mesh(ug, cv); um.castShadow = true; g.add(um);
  return { g, topH };
}
function coneProp() {
  const g = new THREE.Group();
  const wafer = std({ color: 0xc88c4a, roughness: 0.8 }, { wet: 0.2 }), cream = std({ color: 0xf6b3c4, roughness: 0.55 }, { wet: 0 });
  const cone = new THREE.ConeGeometry(0.03, 0.13, 10, 1, true); cone.rotateX(Math.PI); cone.translate(0, -0.03, 0);
  g.add(new THREE.Mesh(cone, wafer));
  const scoop = new THREE.Mesh(new THREE.SphereGeometry(0.037, 12, 10), cream); scoop.position.y = 0.055; g.add(scoop);
  g.userData.scoop = scoop;
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return g;
}
function pintProp() {
  const g = new THREE.Group();
  const glass = std({ color: 0xe6eef0, roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.35, depthWrite: false }, { wet: 0 });
  const beer = std({ color: 0xe0901c, roughness: 0.25, emissive: 0x7a3c00, emissiveIntensity: 0.5 }, { wet: 0 });
  const foam = std({ color: 0xfbf6ea, roughness: 0.9 }, { wet: 0 });
  const liq = new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.031, 1, 14), beer); g.add(liq);
  const fm = new THREE.Mesh(new THREE.CylinderGeometry(0.037, 0.037, 0.02, 14), foam); g.add(fm);
  g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.034, 0.15, 14, 1, true), glass));
  g.userData.setLevel = (k) => { const h = 0.13 * k + 0.005; liq.scale.y = h; liq.position.y = -0.07 + h / 2; fm.position.y = -0.07 + h + 0.008; fm.visible = k > 0.05; };
  g.userData.setLevel(1);
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return g;
}
function ringMarker(color, r = 0.7) {
  const g = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  const ring = new THREE.Mesh(new THREE.RingGeometry(r * 0.78, r, 48), mat); ring.rotation.x = -Math.PI / 2; g.add(ring);
  const inner = new THREE.Mesh(new THREE.CircleGeometry(r * 0.78, 48), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.12, blending: THREE.AdditiveBlending, depthWrite: false })); inner.rotation.x = -Math.PI / 2; g.add(inner);
  g.userData.mats = [mat, inner.material];
  return g;
}
function iconSprite(kind, scale = 0.6) {
  const t = new THREE.CanvasTexture(drawIcon(kind)); t.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthWrite: false }));
  s.scale.set(scale, scale, 1); return s;
}

// ------------------------------------------------------------------ the three stops
function stopDefs() {
  return [
    {
      id: 'gt', kind: 'icecream', color: 0xf5a9bf, sRef: null,
      berth: { s: 863, e: -7.05, yawOff: 0 }, side: 1,
      land: [863.2, -4.95], path: [[863.2, -4.95], [863.2, -2.0], [863.2, 0.8], [866.5, 4.2], [870.2, 8.6]],
      spot: [870.6, 9.4], faceTo: [872.6, 11.0],
      surf: [{ s0: 846.6, s1: 879.4, e0: -5.04, e1: 0.9, y: (s, e) => (e >= 0 ? 2.1 : 2.1 - (Math.floor(-e / 0.72) + 1) * 0.29) }],
    },
    {
      id: 'tbc', kind: 'beer', color: 0xf0b449,
      berth: { s: 735.6, e: -32.75, yawOff: 0 }, side: 1,
      land: [735.6, -30.8], path: [[735.6, -30.8], [735.1, -29.3], [735.1, -2.4], [735.1, 6.6], [742, 10.2], [749.6, 13.2]],
      spot: [750.8, 13.6], faceTo: [752.4, 15.0],
      surf: [
        { s0: 718, s1: 760, e0: -31.3, e1: -28.7, y: () => 0.37 },
        { s0: 733.8, s1: 736.4, e0: -30, e1: -2, y: () => 0.36, ref: 735 },
        { s0: 734.4, s1: 735.8, e0: -2.05, e1: 7.2, y: (s, e) => lerp(0.46, 0.93, (e + 2) / 9), ref: 735 },
      ],
    },
    {
      id: 'fc', kind: 'stretch', color: 0x8fe0c4,
      berth: { s: 1560.35, e: -9.0, yawOff: Math.PI / 2, ref: 1558 }, side: 1,
      land: [1558.45, -9.2, 1558], path: [[1558.45, -9.2, 1558], [1558.1, -1.0, 1558], [1559.5, 1.8], [1565, 3.2], [1570.6, 4.0]],
      spot: [1571.4, 4.1], faceTo: [1571.4, -3],
      surf: [{ s0: 1557.05, s1: 1558.95, e0: -16, e1: 2.4, y: (s, e) => (e < -1.4 ? 0.83 : lerp(0.83, 0.05, clamp((e + 1.4) / 3.6, 0, 1))), ref: 1558 }],
    },
  ];
}

// cubic bezier helpers with arc-length reparametrisation
function bez(p0, p1, p2, p3) {
  const at = (t) => { const u = 1 - t; return new THREE.Vector2(u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x, u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y); };
  const N = 120, len = [0]; let prev = at(0);
  for (let i = 1; i <= N; i++) { const p = at(i / N); len.push(len[i - 1] + p.distanceTo(prev)); prev = p; }
  const L = len[N];
  const tAt = (f) => { const target = f * L; let lo = 0, hi = N; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (len[m] < target) lo = m; else hi = m; } const seg = len[hi] - len[lo] || 1; return (lo + (target - len[lo]) / seg) / N; };
  return { at, L, tAt };
}

export class Stops {
  constructor(o) {
    Object.assign(this, o); // scene, boat, skipper, audio, camera
    this.defs = stopDefs();
    if (o.home) this.defs.push(this.homeDef(o.home));
    this.visitDone = {};
    this.state = 'cruise'; this.cur = null; this.t = 0; this.keysIdle = 0; this.done = {};
    this.focus = null; this.offer = null;
    this.char = this.skipper.c; this.rig = this.skipper.rig;
    const c = this.char;
    this.act = { idle: this.skipper.aIdle, walk: c.play('Walk_Loop', 0, 1), jog: c.play('Jog_Fwd_Loop', 0, 1), run: c.play('Sprint_Loop', 0, 1), sit: c.play('Sitting_Idle_Loop', 0, 1) };
    this.dyn = []; this.peopleFn = null;
    this.pos = new V3(); this.yaw = 0; this.v = 0; this.walkPh = 0;
    this.measureSit();
    this.build();
    this.hud();
  }
  // where the sitting pose puts the pelvis (root space, metres), to size and place the bench
  measureSit() {
    const c = this.char, a = this.act;
    a.idle.setEffectiveWeight(0); a.sit.setEffectiveWeight(1); c.mixer.update(0.01);
    c.root.updateMatrixWorld(true);
    const p = c.root.worldToLocal(this.rig.worldPos('pelvis')); const k = c.root.scale.x;
    this.sitPelvis = p.multiplyScalar(k);
    a.sit.setEffectiveWeight(0); a.idle.setEffectiveWeight(1); c.mixer.update(0.01);
    this.seatH = clamp(this.sitPelvis.y - 0.1, 0.38, 0.52);
  }
  build() {
    const sc = this.scene;
    this.markers = {};
    for (const S of this.defs) {
      if (S.custom) { this.buildCustom(S); continue; }
      const ref = S.berth.ref;
      const [bx, bz] = sdE(S.berth.s, S.berth.e, ref); S.berthP = new V3(bx, 0, bz); S.berthPsi = frame(S.berth.s).th + (S.berth.yawOff || 0);
      S.landP = P3(S.land[0], S.land[1], null, S.land[2]); S.landP.y = this.surfY(S, S.landP.x, S.landP.z) ?? S.landP.y;
      S.pathP = S.path.map(([s, e, r]) => { const p = P3(s, e, null, r); p.y = this.surfY(S, p.x, p.z) ?? p.y; return p; });
      S.spotP = P3(S.spot[0], S.spot[1]); S.faceP = P3(S.faceTo[0], S.faceTo[1]);
      // markers: water ring at the berth, ground ring at the activity, return ring by the boat
      const wm = ringMarker(S.color, 3.2); wm.position.copy(S.berthP).setY(0.06); wm.visible = false; sc.add(wm);
      const wi = iconSprite('anchor', 1.6); wi.position.set(0, 2.6, 0); wm.add(wi);
      const am = ringMarker(S.color, 0.75); am.position.copy(S.spotP).setY(S.spotP.y + 0.04); am.visible = false; sc.add(am);
      const ai = iconSprite(S.kind, 0.55); ai.position.set(0, 2.25, 0); am.add(ai);
      const rm = ringMarker(0xffffff, 0.6); rm.position.copy(S.landP).setY(S.landP.y + 0.04); rm.visible = false; sc.add(rm);
      const ri = iconSprite('boat', 0.5); ri.position.set(0, 1.9, 0); rm.add(ri);
      S.mk = { water: wm, act: am, ret: rm };
    }
    // Georgetown: ice cream cart with a vendor
    { const S = this.defs[0];
      const cart = iceCart(); const [cx, cz] = sdE(872.4, 10.9); cart.position.set(cx, groundAt(cx, cz), cz);
      const toSpot = S.spotP.clone().sub(cart.position); cart.rotation.y = Math.atan2(toSpot.x, toSpot.z); sc.add(cart);
      addWalkBlock({ x: cart.position.x, z: cart.position.z, hx: 0.85, hz: 0.5, yaw: cart.rotation.y });
      this.cart = cart;
      const v = this.vendor = makeSkipperChar({ jacket: 0xf4f1ea, pants: 0x30343c, hair: 0x2a2018, height: 1.72 });
      const back = cart.position.clone().addScaledVector(toSpot.clone().setY(0).normalize(), -0.85);
      v.root.position.set(back.x, groundAt(back.x, back.z), back.z);
      v.root.rotation.y = Math.atan2(-toSpot.x, -toSpot.z); sc.add(v.root);
      v.play('Idle_Talking_Loop', 1, 0.6);
      addLight(cart.position.clone().setY(cart.position.y + 2.2), 0xffd9b0, 8, 0.9, { kind: 'dock' });
    }
    // Thompson: picnic table with a pint waiting
    { const S = this.defs[1];
      const { g, topH } = picnicTable(this.seatH); this.tableTopH = topH;
      const [tx, tz] = sdE(752.4, 15.0); const ty = groundAt(tx, tz);
      g.position.set(tx, ty, tz);
      // benches run along the river; the skipper sits on the landward bench looking out over the water
      const F = frame(752.4); g.rotation.y = -F.th + Math.PI / 2; sc.add(g);
      addWalkBlock({ x: g.position.x, z: g.position.z, hx: 1.0, hz: 0.85, yaw: g.rotation.y });
      this.table = g;
      // seat: landward bench centre, facing the river (-e)
      const seat = new V3(0, this.seatH, 0.66).applyAxisAngle(Y, g.rotation.y).add(g.position);
      const faceDir = new V3(-F.rx, 0, -F.rz); // toward the river
      this.seat = { p: seat, yaw: Math.atan2(-faceDir.x, -faceDir.z), dir: faceDir };
      const pint = this.tablePint = pintProp();
      pint.position.copy(seat).setY(ty + topH + 0.075).addScaledVector(faceDir, 0.42).add(new V3(F.fx, 0, F.fz).multiplyScalar(0.2));
      sc.add(pint); this.pintHome = pint.position.clone();
      // override the stop's spot to stand at the end of the bench
      S.spotP = seat.clone().addScaledVector(faceDir, 0.05).addScaledVector(new V3(F.fx, 0, F.fz), 1.5); S.spotP.y = groundAt(S.spotP.x, S.spotP.z);
      S.mk.act.position.copy(S.spotP).setY(S.spotP.y + 0.04);
      S.pathP[S.pathP.length - 1] = S.spotP.clone();
    }
    this.cone = coneProp(); this.cone.visible = false; sc.add(this.cone);
    this.pint = this.tablePint;
  }
  hud() {
    const mk = (id, kind) => { const b = document.getElementById(id); if (b) b.innerHTML = `<img alt="" src="${drawIcon(kind, 96).toDataURL()}">`; return b; };
    this.btn = mk('act', 'anchor');
    if (this.btn) { this.btn.addEventListener('pointerdown', (e) => e.stopPropagation()); this.btn.addEventListener('click', (e) => { e.stopPropagation(); this.action(); this.btn.blur(); }); }
    this.col = document.getElementById('col');
    if (this.col) this.col.innerHTML = this.defs.map((S) => `<span data-k="${S.id}"><img alt="" src="${drawIcon(S.kind, 96).toDataURL()}"></span>`).join('');
  }
  setBtn(kind) {
    if (!this.btn) return;
    if (!kind) { this.btn.classList.remove('on'); return; }
    if (this.btn.dataset.k !== kind) { this.btn.dataset.k = kind; this.btn.innerHTML = `<img alt="" src="${drawIcon(kind, 96).toDataURL()}">`; }
    this.btn.classList.add('on');
  }
  unlock(S) {
    this.done[S.id] = true;
    const el = this.col && this.col.querySelector(`[data-k="${S.id}"]`); if (el) { el.classList.add('got', 'pop'); setTimeout(() => el.classList.remove('pop'), 900); }
    if (this.col && this.defs.every((d) => this.done[d.id])) this.col.classList.add('all');
    this.audio.chime && this.audio.chime();
  }
  // walkable height at a world point for the current stop (null = water / not walkable)
  surfY(S, x, z) {
    if (S.surfYFn) return S.surfYFn(x, z, this.pos.y);
    const { s, d } = toSD(x, z);
    let best = null;
    for (const f of S.surf) {
      const e = d - hwR(f.ref ?? s);
      if (s >= f.s0 && s <= f.s1 && e >= f.e0 && e <= f.e1) { const y = f.y(s, e); if (best === null || y > best) best = y; }
    }
    const g = groundAt(x, z);
    if (g > 0.03 && !inSolid(x, g + 1.0, z, 0.3)) best = best === null ? g : Math.max(best, g);
    return best;
  }
  // the E key / action button
  action() {
    if (this.state === 'cruise' && this.offer) this.startDock(this.offer, false);
    else if (this.state === 'walk') { this.returning = true; this.autoWalk = true; }
  }
  // ---------------------------------------------------------------- boat scripts
  startDock(S, auto) {
    const b = this.boat; this.cur = S; this.state = 'docking'; this.autoTour = auto; this.returning = false;
    const f0 = new THREE.Vector2(Math.sin(b.psi), -Math.cos(b.psi)), f1 = new THREE.Vector2(Math.sin(S.berthPsi), -Math.cos(S.berthPsi));
    const r1 = new THREE.Vector2(-f1.y, f1.x);
    const p0 = new THREE.Vector2(b.x, b.z), p3 = new THREE.Vector2(S.berthP.x, S.berthP.z);
    const L = p0.distanceTo(p3);
    const p1 = p0.clone().addScaledVector(f0, L * 0.4);
    const p2 = p3.clone().addScaledVector(f1, -Math.max(8, L * 0.28)).addScaledVector(r1, -S.side * Math.min(4, L * 0.08));
    const B = bez(p0, p1, p2, p3);
    b.scriptIgnore = S.id === 'gt' ? 'gt' : null; // the river-steps footprint is conservative underwater; docks elsewhere are exact
    const u0 = Math.max(2.5, b.u), T = clamp(1.7 * B.L / u0, 7, 24);
    let tt = 0;
    b.script = (dt) => {
      tt = Math.min(T, tt + dt); const x = tt / T; const f = 1 - (1 - x) * (1 - x);
      const t = B.tAt(f), p = B.at(t), q = B.at(Math.min(1, t + 0.004)), pq = B.at(Math.max(0, t - 0.004));
      const psi = Math.atan2(q.x - pq.x, -(q.y - pq.y));
      if (tt >= T) { this.state = 'docked'; this.t = 0; b.script = this.holdScript(S); return { x: p3.x, z: p3.y, psi: S.berthPsi, thr: 0 }; }
      return { x: p.x, z: p.y, psi: x > 0.97 ? lerp(psi, S.berthPsi, (x - 0.97) / 0.03) : psi, thr: x > 0.8 ? -0.3 : undefined };
    };
  }
  holdScript(S) {
    let t = 0;
    return (dt) => { t += dt; return { x: S.berthP.x + Math.sin(t * 0.4) * 0.03, z: S.berthP.z + Math.cos(t * 0.33) * 0.03, psi: S.berthPsi + Math.sin(t * 0.27) * 0.008, thr: 0, pin: true }; };
  }
  startUndock(S) {
    const b = this.boat; this.state = 'undocking';
    const F = frame(S.berth.s + 60); const sL = S.berth.s + 60; const [lx, lz] = fromSD(sL, laneAt(sL));
    const fL = new THREE.Vector2(F.fx, F.fz);
    const segs = [];
    const f1 = new THREE.Vector2(Math.sin(S.berthPsi), -Math.cos(S.berthPsi)), r1 = new THREE.Vector2(-f1.y, f1.x);
    let p = new THREE.Vector2(S.berthP.x, S.berthP.z);
    if (S.berth.yawOff) {
      // back straight out of the slip until the bow clears the pier head, then motor round and upstream
      const pA = p.clone().addScaledVector(f1, -11.5);
      segs.push({ B: bez(p, p.clone().addScaledVector(f1, -4), pA.clone().addScaledVector(f1, 4), pA), rev: true, T: 8 });
      segs.push({ B: bez(pA, pA.clone().addScaledVector(f1, 7), new THREE.Vector2(lx, lz).addScaledVector(fL, -26), new THREE.Vector2(lx, lz)), T: 0 });
    } else {
      // push off: the boat drifts sideways off the dock first, so the stern can't swing into it
      const p0 = p.clone(); p = p.clone().addScaledVector(r1, -S.side * 2.0);
      segs.push({ B: bez(p0, p0.clone().lerp(p, 0.33), p0.clone().lerp(p, 0.66), p), psi: S.berthPsi, T: 3.2, clear: true });
      // pull away at a steep angle, clear of anything moored ahead, then out to the lane
      const pA = p.clone().addScaledVector(f1, 5).addScaledVector(r1, -S.side * 6.5);
      segs.push({ B: bez(p, p.clone().addScaledVector(f1, 2.2).addScaledVector(r1, -S.side * 1.2), pA.clone().addScaledVector(f1, -2.5).addScaledVector(r1, S.side * 2.5), pA), T: 7 });
      segs.push({ B: bez(pA, pA.clone().addScaledVector(f1, 5).addScaledVector(r1, -S.side * 2), new THREE.Vector2(lx, lz).addScaledVector(fL, -24), new THREE.Vector2(lx, lz)), T: 0 });
    }
    for (const sg of segs) if (!sg.T) sg.T = 2 * sg.B.L / 5.5;
    let k = 0, tt = 0;
    b.script = (dt) => {
      const sg = segs[k]; tt += dt; const x = Math.min(1, tt / sg.T);
      const f = sg.rev || k === 0 ? ease(x) : x * x; const t = sg.B.tAt(f);
      const p2 = sg.B.at(t), q = sg.B.at(Math.min(1, t + 0.004)), pq = sg.B.at(Math.max(0, t - 0.004));
      let psi = Math.atan2(q.x - pq.x, -(q.y - pq.y)); if (sg.rev) psi = wrap(psi + Math.PI);
      if (sg.psi !== undefined) psi = sg.psi;
      if (x >= 1) {
        if (sg.clear) b.scriptIgnore = null;
        k++; tt = 0;
        if (k >= segs.length) {
          b.script = null; b.scriptIgnore = null; b.auto = true; b.idle = 5; b.u = 5.2; b.v = 0; b.r = 0; b.throttle = 0.8;
          this.state = 'cruise'; S.cool = 40; this.cur = null; return { x: p2.x, z: p2.y, psi };
        }
      }
      return { x: p2.x, z: p2.y, psi, thr: sg.rev ? -0.5 : sg.psi !== undefined ? 0.05 : undefined };
    };
  }
  // ---------------------------------------------------------------- skipper on foot
  gunwale(S) {
    // inside the boat, by the side facing the dock
    const b = this.boat; b.root.updateMatrixWorld(true);
    return new V3(S.side * 0.62, 0.14, this.skipper.zStand + 0.25).applyMatrix4(b.root.matrixWorld);
  }
  goAshore(S) {
    const c = this.char, sk = this.skipper;
    this.scene.attach(c.root);
    this.pos.copy(c.root.position); this.yaw = -this.boat.psi;
    c.root.rotation.set(0, this.yaw, 0);
    sk.onFoot = true; this.state = 'disembark'; this.t = 0;
    this.hop = { from: this.pos.clone(), mid: this.gunwale(S), to: S.landP.clone() };
  }
  goAboard(S) {
    this.state = 'embark'; this.t = 0; this.cone.visible = false;
    if (this.home) { this.home.tvOn = false; this.home.petting = false; }
    this.hop = { from: this.pos.clone(), mid: this.gunwale(S), to: null };
  }
  seatAtHelm() {
    const c = this.char, sk = this.skipper;
    sk.boatModel.attach(c.root);
    c.root.position.set(0, 0.12, sk.zStand); c.root.rotation.set(0, 0, 0);
    for (const k of ['walk', 'jog', 'run', 'sit']) this.act[k].setEffectiveWeight(0);
    this.act.idle.setEffectiveWeight(1); this.act.idle.timeScale = 0.7;
    sk.onFoot = false;
  }
  // ---------------------------------------------------------------- per-frame
  preBoat(dt) {
    const b = this.boat;
    for (const S of this.defs) if (S.cool) S.cool = Math.max(0, S.cool - dt);
    this.offer = null;
    if (this.state === 'cruise' && !b.script) {
      for (const S of this.defs) {
        if (S.cool) continue;
        const ds = S.berth.s - b.s, dd = Math.abs(b.d - (S.berth.d ?? (hwR(S.berth.s) + S.berth.e)));
        if (ds > -12 && ds < 125 && dd < 150) { this.offer = S; break; }
      }
      // the autopilot pays a visit to each stop once, as a little tour
      const S = this.offer;
      if (S && b.auto && !this.done[S.id] && !S.visited && S.berth.s - b.s < 75 && S.berth.s - b.s > 35 && this.autoVisits !== false) { S.visited = true; this.startDock(S, true); }
    }
  }
  update(dt, t, camera) {
    const b = this.boat, S = this.cur, c = this.char, rig = this.rig;
    // markers
    for (const D of this.defs) {
      const on = (this.offer === D && this.state === 'cruise') || (this.cur === D && this.state === 'docking');
      D.mk.water.visible = on;
      if (D.mk.act) D.mk.act.visible = this.cur === D && ['walk', 'disembark'].includes(this.state) && !this.done[D.id];
      D.mk.ret.visible = this.cur === D && this.state === 'walk';
      const pulse = 0.5 + 0.5 * Math.sin(t * 3);
      if (D.spotMks) for (const sm of D.spotMks) {
        const sp = sm.userData.spot; let p = sp.p; if (sp.kind === 'cat') { p = this.home.catWorld(); sm.position.set(p.x, p.y + 0.03, p.z); }
        sm.visible = this.cur === D && this.state === 'walk' && !this.visitDone[sp.kind] && Math.abs(p.y - this.pos.y) < 1.6 && (sp.kind !== 'cat' || p.distanceTo(this.pos) < 5);
        if (sm.visible) { sm.userData.mats[0].opacity = 0.45 + 0.4 * pulse; sm.children[2].position.y = 1.9 + Math.sin(t * 2) * 0.06; }
      }
      for (const m of [D.mk.water, D.mk.act, D.mk.ret]) if (m && m.visible) { m.userData.mats[0].opacity = 0.45 + 0.4 * pulse; m.children[2].position.y = (m === D.mk.water ? 2.6 : m === D.mk.act ? 2.25 : 1.9) + Math.sin(t * 2) * 0.08; }
      if (D.mk.water.visible) D.mk.water.position.y = 0.05 + Math.sin(t * 1.3) * 0.03;
    }
    this.setBtn(this.state === 'cruise' && this.offer ? 'anchor' : this.state === 'walk' && !this.returning ? 'boat' : null);
    this.vendorUpdate(dt, t);
    if (this.peopleFn) { this.dyn = this.peopleFn(); }
    this.focus = null;
    if (!S) return;
    this.t += dt;
    if (this.state === 'docked') {
      if (this.t > 0.9) this.goAshore(S);
      return;
    }
    if (!this.skipper.onFoot) return;
    c.mixer.update(dt);
    let move = null, speed = 0;
    if (this.state === 'disembark' || this.state === 'embark') {
      // two beats: step across the boat to the side, then a hop between boat and dock
      const h = this.hop; const T1 = 0.7, T2 = 1.0; const tt = this.t;
      if (this.state === 'embark' && !h.to) { h.to = this.boat.root.localToWorld(new V3(0, 0.12, this.skipper.zStand)); }
      const mid = this.gunwale(S);
      let p, look;
      if (this.state === 'disembark') {
        if (tt < T1) { p = h.from.clone().lerp(mid, ease(tt / T1)); look = S.landP; }
        else { const u = Math.min(1, (tt - T1) / T2); p = mid.clone().lerp(h.to, ease(u)); p.y += Math.sin(u * Math.PI) * 0.35; look = S.pathP ? S.pathP[1] : S.lookP; }
        if (tt >= T1 + T2) { this.state = 'walk'; this.pos.copy(h.to); this.keysIdle = 0; this.autoWalk = this.autoTour; this.visitDone = {}; this.visitAny = false; }
      } else {
        const to = this.boat.root.localToWorld(new V3(0, 0.12, this.skipper.zStand));
        if (tt < T2) { const u = tt / T2; p = h.from.clone().lerp(mid, ease(u)); p.y += Math.sin(u * Math.PI) * 0.35; look = mid; }
        else { const u = Math.min(1, (tt - T2) / T1); p = mid.clone().lerp(to, ease(u)); look = this.boat.root.localToWorld(new V3(0, 1, this.skipper.zStand - 3)); }
        if (tt >= T1 + T2) { this.seatAtHelm(); this.startUndock(S); this.focus = null; return; }
      }
      const dv = p.clone().sub(this.pos); speed = dv.length() / Math.max(dt, 1e-3);
      this.pos.copy(p);
      const dir = look.clone().sub(p); this.yaw = lerpAng(this.yaw, Math.atan2(-dir.x, -dir.z), 1 - Math.exp(-dt * 8));
      this.animLoco(dt, Math.min(speed, 1.3));
      this.place();
      this.focus = { pos: this.pos, psi: -this.yaw, dist: 4.6, h: 1.25, lead: 0.3 };
      return;
    }
    if (this.state === 'walk') {
      const K = b.keys;
      const any = K.up || K.down || K.left || K.right;
      if (any) { this.keysIdle = 0; this.autoWalk = false; if (this.returning && !this.autoWalkReturn) this.returning = false; } else this.keysIdle += dt;
      if (this.keysIdle > 6) this.autoWalk = true;
      const jog = K.boost;
      if (!this.autoWalk && any) {
        const cf = new V3(); camera.getWorldDirection(cf); cf.y = 0; cf.normalize(); const cr = new V3(-cf.z, 0, cf.x);
        move = cf.multiplyScalar((K.up ? 1 : 0) - (K.down ? 1 : 0)).addScaledVector(cr, (K.right ? 1 : 0) - (K.left ? 1 : 0));
        if (move.lengthSq() > 0) move.normalize(); speed = jog ? 5.2 : 1.35;
      } else if (this.autoWalk) {
        const goal = S.multi ? this.homeGoal(S) : this.returning || this.done[S.id] ? 'boat' : 'spot';
        const tgt = S.multi ? this.homeNav(S, goal) : this.nextWaypoint(S, goal);
        if (tgt) { move = tgt.clone().sub(this.pos).setY(0); const L = move.length(); if (L > 0.05) move.divideScalar(L); speed = Math.min(1.3, L * 2.2 + 0.3); }
      }
      // arrivals
      if (S.multi) {
        if (!this.done[S.id] && this.home.isInside(this.pos)) this.unlock(S);
        for (const sp of S.spots) {
          if (this.visitDone[sp.kind]) continue;
          const p = sp.kind === 'cat' ? this.home.catWorld() : sp.p; const dd = Math.hypot(p.x - this.pos.x, p.z - this.pos.z);
          const want = !this.autoWalk || this.homeGoal(S) === sp.kind;
          if (dd < (sp.kind === 'cat' ? 0.95 : 0.5) && Math.abs(p.y - this.pos.y) < 0.7 && want && (sp.kind !== 'cat' || this.autoWalk || this.v < 0.4)) { this.state = 'act'; this.t = 0; this.actSpot = sp; this.actStart = this.pos.clone(); this.actYaw = this.yaw; return; }
        }
        const toB = S.landP.clone().sub(this.pos).setY(0).length();
        if (toB < 0.6 && Math.abs(S.landP.y - this.pos.y) < 0.8 && (this.returning || (this.autoWalk && this.homeGoal(S) === 'boat') || (this.visitAny && this.t > 3))) { this.goAboard(S); return; }
      }
      const toSpot = S.spotP.clone().sub(this.pos).setY(0).length();
      if (!S.multi && !this.done[S.id] && toSpot < 0.55) { this.state = 'act'; this.t = 0; this.actStart = this.pos.clone(); this.actYaw = this.yaw; return; }
      const toBoat = S.landP.clone().sub(this.pos).setY(0).length();
      if (!S.multi && toBoat < 0.6 && (this.returning || (this.done[S.id] && this.autoWalk) || (this.done[S.id] && this.t > 2 && this.leftSpot))) { this.goAboard(S); return; }
      if (this.done[S.id] && toSpot > 2.5) this.leftSpot = true;
      // integrate with walkability
      this.v = lerp(this.v, move && move.lengthSq() ? speed : 0, 1 - Math.exp(-dt * 6));
      if (move && move.lengthSq()) {
        this.yaw = lerpAng(this.yaw, Math.atan2(-move.x, -move.z), 1 - Math.exp(-dt * 7));
        const step = move.clone().multiplyScalar(this.v * dt);
        const y0 = this.pos.y;
        const stuckNow = walkBlocked(this.pos.x, this.pos.z, 0.26, this.dyn);
        const tryP = (dx, dz) => { const x = this.pos.x + dx, z = this.pos.z + dz; const y = this.surfY(S, x, z); if (y === null || Math.abs(y - y0) > 0.6) return false; if (S.spotP.distanceTo(new V3(x, y, z)) > 70) return false; if (!stuckNow && walkBlocked(x, z, 0.26, this.dyn)) return false; if (S.blockFn && S.blockFn(x, z, y)) return false; this.pos.set(x, y0, z); this.groundY = y; return true; };
        if (!tryP(step.x, step.z)) { if (!tryP(step.x, 0) && !tryP(0, step.z)) {
          // walk around whatever is in the way: try sidestepping left or right of the intended direction
          const sx = -step.z, sz = step.x;
          if (!tryP(step.x * 0.5 + sx * 0.8, step.z * 0.5 + sz * 0.8)) tryP(step.x * 0.5 - sx * 0.8, step.z * 0.5 - sz * 0.8);
        } }
      }
      // fail-safe for the automatic walk: if something keeps him from making progress, ease him past it
      if (this.autoWalk && move && move.lengthSq()) {
        const moved = this.lastPos ? this.lastPos.distanceTo(this.pos) : 1; this.lastPos = (this.lastPos || new V3()).copy(this.pos);
        this.stuckT = moved < 0.2 * dt ? (this.stuckT || 0) + dt : 0;
        if (this.stuckT > 2.5) { const tgt = S.multi ? this.homeNav(S, this.homeGoal(S)) : this.nextWaypoint(S, this.returning || this.done[S.id] ? 'boat' : 'spot'); if (tgt) this.pos.lerp(tgt, Math.min(1, dt * 1.5)); }
      } else this.stuckT = 0;
      const gy = this.surfY(S, this.pos.x, this.pos.z); if (gy !== null) this.pos.y = lerp(this.pos.y, gy, 1 - Math.exp(-dt * 14));
      this.animLoco(dt, this.v);
      this.place();
      this.carry(dt, t);
      this.focus = { pos: this.pos, psi: -this.yaw, dist: 4.8, h: 1.25, lead: 0.4, home: S.multi && this.home.isInside(this.pos) };
      return;
    }
    if (this.state === 'act') {
      if (S.multi) {
        const fin = this.homeAct(S, this.actSpot.kind, dt, t, this.t);
        this.focus = { pos: this.pos, psi: -this.yaw, dist: 4.2, h: 1.1, lead: 0.2, home: this.home.isInside(this.pos) };
        if (fin) { this.visitDone[this.actSpot.kind] = true; this.visitAny = true; this.audio.chime && this.audio.chime(); this.state = 'walk'; this.t = 0; this.keysIdle = this.autoWalk ? 99 : 0; }
        return;
      }
      const fin = this.interact(S, dt, t, this.t);
      this.focus = { pos: this.pos, psi: -this.yaw, dist: 4.2, h: 1.1, lead: 0.2 };
      if (fin) { this.unlock(S); this.state = 'walk'; this.t = 0; this.leftSpot = false; this.keysIdle = this.autoWalk ? 99 : 0; }
    }
  }
  nextWaypoint(S, goal) {
    const pts = S.pathP; let bi = 0, bd = 1e9;
    pts.forEach((p, i) => { const d = p.distanceTo(this.pos); if (d < bd) { bd = d; bi = i; } });
    const dirI = goal === 'spot' ? 1 : -1;
    const end = goal === 'spot' ? S.spotP : S.landP;
    // head to the next vertex along the path unless we're already past it
    let ni = bi + (bd < 0.6 ? dirI : 0);
    if (ni < 0 || ni >= pts.length) return end;
    // skip back if the next vertex lies behind us relative to the end
    const p = pts[ni];
    if (p.distanceTo(end) > this.pos.distanceTo(end) + 0.2 && bd >= 0.6) { ni += dirI; if (ni < 0 || ni >= pts.length) return end; }
    return pts[ni];
  }
  place() {
    const c = this.char; c.root.position.copy(this.pos); c.root.rotation.set(0, this.yaw, 0); c.root.updateMatrixWorld(true);
  }
  animLoco(dt, v) {
    const a = this.act;
    const wR = smooth(3.4, 4.6, v), wW = smooth(0.05, 0.7, v) * (1 - smooth(1.7, 2.5, v)), wJ = smooth(1.7, 2.5, v) * (1 - wR), wI = 1 - smooth(0.05, 0.7, v);
    a.idle.setEffectiveWeight(wI); a.walk.setEffectiveWeight(wW); a.jog.setEffectiveWeight(wJ); a.run.setEffectiveWeight(wR); a.sit.setEffectiveWeight(0);
    a.walk.timeScale = clamp(v / 1.15, 0.6, 1.5); a.jog.timeScale = clamp(v / 2.7, 0.7, 1.4); a.run.timeScale = clamp(v / 5.4, 0.7, 1.2); a.idle.timeScale = 0.8;
    // footsteps
    if (v > 0.3) {
      const period = wR > 0.5 ? 0.35 / a.run.timeScale : wJ > 0.5 ? 0.45 / a.jog.timeScale : 0.65 / a.walk.timeScale;
      this.walkPh += dt / period; if (this.walkPh >= 1) { this.walkPh -= 1; this.audio.step && this.audio.step(wJ > 0.5 ? 0.9 : 0.6, this.onWood()); }
    }
  }
  onWood() { const S = this.cur; if (!S) return false; const g = groundAt(this.pos.x, this.pos.z); return this.pos.y - g > 0.15; }
  // hold whatever he's carrying while walking
  carry(dt, t) {
    if (!this.cone.visible) return;
    const rig = this.rig, g = this.char.root; g.updateMatrixWorld(true);
    const gq = g.getWorldQuaternion(new Q());
    const right = X.clone().applyQuaternion(gq), fwd = new V3(0, 0, -1).applyQuaternion(gq), up = Y;
    const chest = rig.worldPos('spine_03');
    const hold = chest.clone().addScaledVector(right, 0.15).addScaledVector(fwd, 0.3).addScaledVector(up, -0.05 + Math.sin(t * 7) * 0.006);
    this.holdVertical('r', hold, fwd, right);
    this.cone.position.copy(hold).y += 0.075; this.cone.quaternion.identity();
  }
  holdVertical(side, center, fwd, right) {
    const sg = side === 'r' ? 1 : -1;
    const across = new V3().crossVectors(Y, fwd).normalize().multiplyScalar(sg); // toward the body's midline
    grip(this.rig, side, center, across.clone().addScaledVector(fwd, 0.25).normalize(), fwd.clone().negate().addScaledVector(right, 0.2 * sg).normalize(), 1.0, 0.85, 0.058, 0.036,
      this.rig.worldPos('upperarm_' + side).addScaledVector(right, 0.5 * sg).addScaledVector(Y, -0.6).addScaledVector(fwd, 0.1));
  }
  mouth() {
    const g = this.char.root, gq = g.getWorldQuaternion(new Q()), k = g.scale.x;
    const fwd = new V3(0, 0, -1).applyQuaternion(gq);
    return this.rig.worldPos('Head').addScaledVector(fwd, 0.1 * k).addScaledVector(Y, 0.035 * k);
  }
  legsPlanted(fwdOff = 0) {
    const rig = this.rig, g = this.char.root; const gq = g.getWorldQuaternion(new Q());
    const right = X.clone().applyQuaternion(gq), fwd = new V3(0, 0, -1).applyQuaternion(gq);
    for (const [s, sx] of [['l', -1], ['r', 1]]) {
      const rp = rig.restPG['foot_' + s];
      const ank = g.localToWorld(new V3(sx * 0.13, rp.y, rp.z + fwdOff));
      const knee = rig.worldPos('thigh_' + s).addScaledVector(fwd, 0.6).addScaledVector(right, sx * 0.1);
      rig.twoBone('thigh_' + s, 'calf_' + s, ank, knee, new V3(0, 0, -1));
      rig.aim('foot_' + s, rig.restDir['foot_' + s].clone().applyQuaternion(gq).addScaledVector(right, sx * 0.12), X, right);
    }
  }
  // ---------------------------------------------------------------- the three moments
  interact(S, dt, t, tt) {
    const a = this.act, rig = this.rig, g = this.char.root;
    if (S.kind === 'beer') return this.beer(dt, t, tt);
    // stand still, facing the cart / the view
    this.v = 0; this.animLoco(dt, 0);
    const face = S.faceP.clone().sub(this.pos);
    let yawT = Math.atan2(-face.x, -face.z);
    if (S.kind === 'icecream' && tt > 2.4) { const r = this.pos.clone().sub(S.faceP); yawT = Math.atan2(-r.x, -r.z) + 0.5; } // turn to the river to eat
    this.yaw = lerpAng(this.yaw, yawT, 1 - Math.exp(-dt * 3));
    this.place();
    g.updateMatrixWorld(true);
    const gq = g.getWorldQuaternion(new Q());
    const right = X.clone().applyQuaternion(gq), fwd = new V3(0, 0, -1).applyQuaternion(gq);
    if (S.kind === 'icecream') {
      const T = 13.5;
      if (tt < 1.4) {
        // reach across the cart for the cone the vendor holds out
        const reach = this.cart.position.clone().setY(this.pos.y + 1.12).lerp(this.pos.clone().setY(this.pos.y + 1.1), 0.35);
        const k = smooth(0.2, 1.0, tt);
        const hold = rig.worldPos('spine_03').addScaledVector(right, 0.2).addScaledVector(fwd, 0.25).lerp(reach, k);
        this.vendorReach = k;
        if (tt > 1.0) { this.cone.visible = true; this.cone.userData.scoop.scale.setScalar(1); }
        this.holdVertical('r', hold, fwd, right);
        if (this.cone.visible) { this.cone.position.copy(hold).y += 0.075; this.cone.quaternion.identity(); }
      } else {
        this.vendorReach = Math.max(0, 1 - (tt - 1.4));
        // eat: bring it up, a lick with a little nod, back down
        const P = 2.7, ph = ((tt - 1.4) % P) / P;
        const up = smooth(0.05, 0.25, ph) * (1 - smooth(0.7, 0.9, ph));
        const bites = Math.floor((tt - 1.4) / P);
        const chest = rig.worldPos('spine_03').addScaledVector(right, 0.15).addScaledVector(fwd, 0.3).addScaledVector(Y, -0.05);
        const m = this.mouth().addScaledVector(fwd, 0.06).addScaledVector(Y, -0.15);
        const hold = chest.lerp(m, up);
        rig.rotG('neck_01', X, 0.12 * up); rig.rotG('Head', X, 0.1 * up * (0.7 + 0.3 * Math.sin(ph * 40)));
        this.holdVertical('r', hold, fwd, right);
        this.cone.position.copy(hold).y += 0.075; this.cone.quaternion.identity();
        this.cone.userData.scoop.scale.setScalar(Math.max(0.35, 1 - bites * 0.17 - (ph > 0.5 ? 0.08 : 0)));
      }
      this.legsPlanted();
      return tt > T;
    }
    if (S.kind === 'stretch') {
      const T = 16;
      const k = (a0, a1, b0, b1) => smooth(a0, a1, tt) * (1 - smooth(b0, b1, tt));
      const overhead = k(0.3, 1.6, 6.8, 7.6);
      const side = (tt > 3.5 && tt < 7.2) ? Math.sin((tt - 3.5) / 3.7 * Math.PI * 2) * smooth(3.5, 4.0, tt) * (1 - smooth(6.7, 7.2, tt)) : 0;
      const fold = k(7.4, 8.8, 10.6, 11.6);
      const cross = k(11.6, 12.4, 15.0, 15.8);
      const breathe = Math.sin(tt * 1.4) * 0.5 + 0.5;
      // spine
      rig.rotG('spine_01', X, 0.08 * overhead - 0.45 * fold);
      rig.rotG('spine_02', X, 0.05 * overhead - 0.35 * fold);
      rig.rotG('spine_03', X, 0.04 * overhead * breathe - 0.25 * fold);
      rig.rotG('pelvis', X, -0.45 * fold);
      rig.moveG('pelvis', new V3(0, 0, 0.07 * fold));
      for (const n of ['spine_01', 'spine_02', 'spine_03']) rig.rotG(n, Z, side * 0.16);
      rig.rotG('neck_01', X, 0.25 * fold - 0.1 * overhead); rig.rotG('Head', X, -0.12 * overhead);
      rig.rotG('spine_03', Y, -0.25 * cross);
      g.updateMatrixWorld(true);
      const head = rig.worldPos('Head');
      const upB = head.clone().sub(rig.worldPos('spine_01')).normalize();
      for (const [s, sg] of [['l', -1], ['r', 1]]) {
        const sh = rig.worldPos('upperarm_' + s);
        // hands meeting overhead, palms facing
        const top = head.clone().addScaledVector(upB, 0.42).addScaledVector(right, sg * 0.05).addScaledVector(fwd, 0.02);
        // folded forward: hands toward the shins
        const shin = this.pos.clone().addScaledVector(right, sg * 0.14).addScaledVector(fwd, 0.14).setY(this.pos.y + 0.42);
        // across-the-chest shoulder stretch: right arm across, left hand at its elbow
        const acrossR = rig.worldPos('upperarm_l').addScaledVector(fwd, 0.3).addScaledVector(right, -0.06).addScaledVector(Y, -0.02);
        let tgt = rig.worldPos('upperarm_' + s).addScaledVector(Y, -0.55).addScaledVector(right, sg * 0.08);
        tgt.lerp(top, overhead).lerp(shin, fold);
        if (s === 'r') tgt.lerp(acrossR, cross);
        else if (cross > 0) { const el = rig.worldPos('lowerarm_r'); tgt.lerp(el.clone().addScaledVector(fwd, 0.06), cross); }
        const pole = sh.clone().addScaledVector(right, sg * 0.5).addScaledVector(Y, -0.3 + 0.8 * overhead).addScaledVector(fwd, -0.2 + 0.6 * fold);
        rig.twoBone('upperarm_' + s, 'lowerarm_' + s, tgt, pole, new V3(0, -0.4, 1));
        const fdir = Y.clone().lerp(upB, 0.5).multiplyScalar(overhead).addScaledVector(Y, -fold).addScaledVector(fwd, 0.3 * cross).addScaledVector(right, -sg * cross);
        if (fdir.lengthSq() > 1e-4) rig.hand(s, fdir.normalize(), right.clone().multiplyScalar(-sg).addScaledVector(fwd, fold * 0.5).normalize());
        rig.curl(s, 0.25 + 0.4 * cross * (s === 'l' ? 1 : 0), 0.3);
      }
      this.legsPlanted(0.02);
      return tt > T;
    }
    return true;
  }
  beer(dt, t, tt) {
    const a = this.act, rig = this.rig, g = this.char.root, seat = this.seat;
    const T = 16;
    // sit down, drink a few sips, stand up
    const sitK = smooth(0.6, 1.8, tt) * (1 - smooth(T - 1.6, T - 0.4, tt));
    a.idle.setEffectiveWeight(1 - sitK); a.sit.setEffectiveWeight(sitK); a.walk.setEffectiveWeight(0); a.jog.setEffectiveWeight(0); a.run.setEffectiveWeight(0);
    this.yaw = lerpAng(this.yaw, seat.yaw, 1 - Math.exp(-dt * 4));
    // put the root so the pelvis lands over the bench
    const sp = this.sitPelvis.clone().setY(0).applyAxisAngle(Y, seat.yaw);
    const sitRoot = seat.p.clone().sub(sp); sitRoot.y = groundAt(seat.p.x, seat.p.z) + (this.seatH + 0.1 - this.sitPelvis.y);
    const stand = this.actStart;
    this.pos.copy(stand).lerp(sitRoot, sitK);
    this.place(); g.updateMatrixWorld(true);
    const gq = g.getWorldQuaternion(new Q());
    const right = X.clone().applyQuaternion(gq), fwd = new V3(0, 0, -1).applyQuaternion(gq);
    const pint = this.pint;
    if (tt > 2.0 && tt < T - 2.0) {
      const P = 3.8, ph = ((tt - 2.0) % P) / P; const sip = Math.floor((tt - 2.0) / P);
      const lift = smooth(0.08, 0.3, ph) * (1 - smooth(0.72, 0.92, ph));
      const tilt = smooth(0.3, 0.45, ph) * (1 - smooth(0.6, 0.72, ph));
      const home = this.pintHome;
      const m = this.mouth().addScaledVector(fwd, 0.08).addScaledVector(Y, -0.1);
      const c = home.clone().addScaledVector(Y, -0.035).lerp(m, lift);
      // tip the glass toward the lips and the head back as he drinks
      const tq = new Q().setFromAxisAngle(right, 0.9 * tilt + 0.15 * lift);
      rig.rotG('neck_01', X, -0.18 * tilt); rig.rotG('Head', X, -0.2 * tilt);
      g.updateMatrixWorld(true);
      const across = new V3().crossVectors(Y, fwd).normalize();
      const fd = across.clone().addScaledVector(fwd, 0.25).normalize().applyQuaternion(tq), palm = fwd.clone().negate().addScaledVector(right, 0.2).normalize().applyQuaternion(tq);
      grip(rig, 'r', c, fd, palm, 1.0, 0.85, 0.07, 0.045, rig.worldPos('upperarm_r').addScaledVector(right, 0.5).addScaledVector(Y, -0.6).addScaledVector(fwd, 0.1));
      pint.position.copy(c).addScaledVector(Y.clone().applyQuaternion(tq), 0.035); pint.quaternion.copy(tq);
      pint.userData.setLevel(Math.max(0.15, 1 - sip * 0.22 - tilt * 0.08));
      // left forearm rests on the table edge
      const rest = seat.p.clone().setY(this.table.position.y + this.tableTopH + 0.05).addScaledVector(seat.dir, 0.3).addScaledVector(right, -0.22);
      rig.twoBone('upperarm_l', 'lowerarm_l', rest, rig.worldPos('upperarm_l').addScaledVector(right, -0.6).addScaledVector(Y, -0.4), new V3(0, -0.4, 1));
      rig.hand('l', fwd.clone().addScaledVector(right, 0.4).normalize(), Y.clone().negate()); rig.curl('l', 0.3, 0.2);
    } else { pint.position.copy(this.pintHome); pint.quaternion.identity(); }
    return tt > T;
  }
  vendorUpdate(dt, t) {
    const v = this.vendor; if (!v) return;
    const cam = this.camera; if (cam.position.distanceToSquared(v.root.position) > 250 * 250) return;
    v.mixer.update(dt); v.root.updateMatrixWorld(true);
    const k = this.vendorReach || 0;
    if (k > 0.01) {
      const rig = v.rig, gq = v.root.getWorldQuaternion(new Q());
      const right = X.clone().applyQuaternion(gq), fwd = new V3(0, 0, -1).applyQuaternion(gq);
      const hold = rig.worldPos('spine_03').addScaledVector(right, 0.2).addScaledVector(fwd, 0.25).lerp(this.cart.position.clone().setY(this.cart.position.y + 1.25).addScaledVector(fwd, 0.25), k);
      grip(rig, 'r', hold, new V3().crossVectors(Y, fwd).normalize(), fwd.clone().negate(), 0.9, 0.8, 0.058, 0.036, rig.worldPos('upperarm_r').addScaledVector(right, 0.5).addScaledVector(Y, -0.6));
      if (!this.cone.visible) { this.vCone = this.vCone || coneProp(); if (!this.vCone.parent) this.scene.add(this.vCone); this.vCone.visible = true; this.vCone.position.copy(hold); }
      else if (this.vCone) this.vCone.visible = false;
    } else if (this.vCone) this.vCone.visible = false;
  }
  // ---------------------------------------------------------------- home
  homeDef(H) {
    const q = toSD(H.berth.p.x, H.berth.p.z);
    const dirW = (lx, lz) => new V3(lx, 0, lz).applyQuaternion(H.g.quaternion);
    const N = H.N;
    return {
      id: 'home', kind: 'house', color: 0xf3d27a, custom: true, multi: true, side: -1,
      berth: { s: q.s, d: q.d, yawOff: 0 }, berthP: H.berth.p, berthPsi: H.berth.psi, landP: H.landP, lookP: N.pierRoot,
      spotP: H.toWorld(0, 0, 0), surfYFn: (x, z, y) => H.surfY(x, z, y), blockFn: (x, z, y) => H.blocked(x, z, y),
      spots: [
        { kind: 'fire', p: N.hearth, node: 'hearth', face: dirW(1, 0) },
        { kind: 'tv', p: N.sofaSpot, node: 'sofaSpot', face: dirW(1, 0), seat: H.toWorld(2.62, 0, -0.45) },
        { kind: 'cat', node: 'living' },
        { kind: 'cook', p: N.stove, node: 'stove', face: dirW(0, 1) },
        { kind: 'wash', p: N.sink, node: 'sink', face: dirW(-1, 0) },
        { kind: 'sleep', p: N.bedSide, node: 'bedSide', face: dirW(-1, 0) },
        { kind: 'scope', p: N.balcony, node: 'balcony', face: dirW(0.35, -1).normalize() },
      ],
      tour: ['fire', 'tv', 'cat'],
    };
  }
  buildCustom(S) {
    const sc = this.scene;
    const wm = ringMarker(S.color, 3.2); wm.position.copy(S.berthP).setY(0.06); wm.visible = false; sc.add(wm);
    const wi = iconSprite('anchor', 1.6); wi.position.set(0, 2.6, 0); wm.add(wi);
    const rm = ringMarker(0xffffff, 0.6); rm.position.copy(S.landP).setY(S.landP.y + 0.04); rm.visible = false; sc.add(rm);
    const ri = iconSprite('boat', 0.5); ri.position.set(0, 1.9, 0); rm.add(ri);
    S.mk = { water: wm, act: null, ret: rm };
    S.spotMks = S.spots.map((sp) => { const m = ringMarker(S.color, sp.kind === 'cat' ? 0.5 : 0.55); if (sp.p) m.position.copy(sp.p).setY(sp.p.y + 0.03); m.visible = false; m.userData.spot = sp; const ic = iconSprite(sp.kind, 0.42); ic.position.set(0, 1.9, 0); m.add(ic); sc.add(m); return m; });
  }
  homeGoal(S) {
    if (this.returning) return 'boat';
    for (const k of S.tour) if (!this.visitDone[k]) return k;
    return 'boat';
  }
  homeNav(S, goal) {
    const H = this.home;
    const route = (node) => {
      // follow a whole route through the house instead of re-deciding at every step
      if (!this.hp || this.hpGoal !== node || this.hp[this.hpI].distanceTo(this.pos) > 9) {
        this.hp = H.navPath(this.pos, node); this.hpGoal = node; this.hpI = 0;
        if (this.hp.length > 1) { const a = this.hp[0], b = this.hp[1]; if (Math.hypot(b.x - this.pos.x, b.z - this.pos.z) < Math.hypot(b.x - a.x, b.z - a.z)) this.hpI = 1; }
      }
      while (this.hpI < this.hp.length - 1) { const p = this.hp[this.hpI]; if (Math.hypot(p.x - this.pos.x, p.z - this.pos.z) < 0.45 && Math.abs(p.y - this.pos.y) < 0.9) this.hpI++; else break; }
      return this.hp[this.hpI];
    };
    if (goal === 'boat') return route('thead');
    const sp = S.spots.find((q) => q.kind === goal);
    if (goal === 'cat') { const cw = H.catWorld(); if (H.isInside(this.pos) && Math.abs(cw.y - this.pos.y) < 0.8 && cw.distanceTo(this.pos) < 6) return cw; return route('living'); }
    const tgt = sp.p; if (tgt.distanceTo(this.pos) < 0.7 && Math.abs(tgt.y - this.pos.y) < 0.5) return tgt;
    return route(sp.node);
  }
  homeAct(S, kind, dt, t, tt) {
    const H = this.home, rig = this.rig, g = this.char.root, a = this.act, sp = this.actSpot;
    const faceYaw = (dir) => Math.atan2(-dir.x, -dir.z);
    if (kind === 'tv') {
      // settle into the sofa and watch
      const T = 15; H.tvOn = true;
      const sitK = smooth(0.4, 1.6, tt) * (1 - smooth(T - 1.4, T - 0.2, tt));
      a.idle.setEffectiveWeight(1 - sitK); a.sit.setEffectiveWeight(sitK); a.walk.setEffectiveWeight(0); a.jog.setEffectiveWeight(0); a.run.setEffectiveWeight(0);
      const yawT = faceYaw(sp.face); this.yaw = lerpAng(this.yaw, yawT, 1 - Math.exp(-dt * 4));
      const sp2 = this.sitPelvis.clone().setY(0).applyAxisAngle(Y, yawT);
      const sitRoot = sp.seat.clone().sub(sp2); sitRoot.y = sp.seat.y + 0.47 + 0.1 - this.sitPelvis.y;
      this.pos.copy(this.actStart).lerp(sitRoot, sitK); this.place();
      g.updateMatrixWorld(true); rig.rotG('Head', X, -0.05);
      return tt > T;
    }
    // everything else happens standing: face the thing, keep the feet planted
    this.animLoco(dt, 0);
    if (sp.face) this.yaw = lerpAng(this.yaw, faceYaw(sp.face), 1 - Math.exp(-dt * 4));
    if (kind === 'cat') { const cw = H.catWorld(); const d = cw.clone().sub(this.pos); this.yaw = lerpAng(this.yaw, faceYaw(d), 1 - Math.exp(-dt * 4)); }
    this.place(); g.updateMatrixWorld(true);
    const gq = g.getWorldQuaternion(new Q());
    const right = X.clone().applyQuaternion(gq), fwd = new V3(0, 0, -1).applyQuaternion(gq);
    const chest = rig.worldPos('spine_03');
    const arm = (side, target, fdir, palm, curl = 0.35) => { const sg = side === 'r' ? 1 : -1; rig.twoBone('upperarm_' + side, 'lowerarm_' + side, target, rig.worldPos('upperarm_' + side).addScaledVector(right, 0.5 * sg).addScaledVector(Y, -0.6).addScaledVector(fwd, -0.1), new V3(0, -0.4, 1)); rig.hand(side, fdir.normalize(), palm.normalize()); rig.curl(side, curl, 0.3); };
    if (kind === 'fire') {
      // warm the hands: palms to the fire, a slow rub now and then
      const k = smooth(0.5, 1.5, tt) * (1 - smooth(8.6, 9.6, tt)); const rub = Math.sin(tt * 5) * 0.03 * smooth(4, 5, tt) * (1 - smooth(6, 7, tt));
      rig.moveG('pelvis', new V3(0, -0.06 * k, 0.03 * k)); rig.rotG('spine_01', X, -0.18 * k);
      g.updateMatrixWorld(true);
      for (const [side, sg] of [['l', -1], ['r', 1]]) {
        const rest = rig.worldPos('upperarm_' + side).addScaledVector(Y, -0.55).addScaledVector(right, sg * 0.1);
        const tgt = rig.worldPos('spine_03').addScaledVector(fwd, 0.42).addScaledVector(right, sg * (0.16 + rub)).addScaledVector(Y, -0.12);
        arm(side, rest.lerp(tgt, k), Y.clone().addScaledVector(fwd, 0.3), fwd.clone().addScaledVector(right, -sg * 0.2), 0.15);
      }
      this.legsPlanted(); return tt > 10;
    }
    if (kind === 'cook') {
      // stir the pot on the stove
      const pot = H.toWorld(H.potPos.x, H.potPos.y, H.potPos.z); const k = smooth(0.4, 1.2, tt) * (1 - smooth(10, 11, tt));
      const c = pot.clone().addScaledVector(Y, 0.16).add(new V3(Math.cos(tt * 3.2) * 0.06, 0, Math.sin(tt * 3.2) * 0.06));
      const rest = rig.worldPos('upperarm_r').addScaledVector(Y, -0.55).addScaledVector(right, 0.1);
      arm('r', rest.lerp(c, k), Y.clone().negate().addScaledVector(fwd, 0.4), right.clone().negate(), 0.9);
      if (!this.spoon) { this.spoon = new THREE.Mesh(cyl(0.012, 0.018, 0.34, 6), std({ color: 0xc89a60, roughness: 0.6 })); this.scene.add(this.spoon); }
      this.spoon.visible = k > 0.3; this.spoon.position.copy(c).addScaledVector(Y, -0.08); this.spoon.rotation.set(0.25, 0, 0.2);
      if (k > 0.5 && Math.random() < dt * 8 && this.audio.amb) { const { node } = this.audio.amb.place(pot.x, pot.z, 4); this.audio.amb.burst(node, this.audio.ctx.currentTime, 0.05, 5000, 0.8, 0.05, 'highpass'); }
      rig.rotG('neck_01', X, 0.25 * k); this.legsPlanted();
      if (tt > 11) { this.spoon.visible = false; return true; } return false;
    }
    if (kind === 'wash') {
      const sink = H.toWorld(H.sinkPos.x, H.sinkPos.y, H.sinkPos.z); const k = smooth(0.3, 1.0, tt) * (1 - smooth(6, 6.8, tt));
      rig.rotG('spine_01', X, -0.2 * k); g.updateMatrixWorld(true);
      for (const [side, sg] of [['l', -1], ['r', 1]]) {
        const rest = rig.worldPos('upperarm_' + side).addScaledVector(Y, -0.55).addScaledVector(right, sg * 0.1);
        const tgt = sink.clone().addScaledVector(right, sg * (0.05 + Math.sin(tt * 9 + sg) * 0.025)).addScaledVector(Y, -0.02);
        arm(side, rest.lerp(tgt, k), fwd.clone().addScaledVector(Y, -0.3), right.clone().multiplyScalar(-sg), 0.3);
      }
      if (k > 0.4 && Math.random() < dt * 14 && this.audio.amb) { const { node } = this.audio.amb.place(sink.x, sink.z, 4); this.audio.amb.burst(node, this.audio.ctx.currentTime, 0.08, 3500, 0.7, 0.06, 'highpass'); }
      this.legsPlanted(); return tt > 7;
    }
    if (kind === 'scope') {
      const k = smooth(0.4, 1.4, tt) * (1 - smooth(7.4, 8.4, tt));
      rig.rotG('spine_01', X, -0.25 * k); rig.rotG('neck_01', X, 0.15 * k); g.updateMatrixWorld(true);
      const eye = H.toWorld(H.scopePos.x, H.scopePos.y + 1.45, H.scopePos.z + 0.28);
      for (const [side, sg] of [['l', -1], ['r', 1]]) {
        const rest = rig.worldPos('upperarm_' + side).addScaledVector(Y, -0.55).addScaledVector(right, sg * 0.1);
        arm(side, rest.lerp(eye.clone().addScaledVector(right, sg * 0.1).addScaledVector(fwd, 0.12 + (sg > 0 ? 0.15 : 0)).addScaledVector(Y, -0.08), k), fwd.clone(), right.clone().multiplyScalar(-sg), 0.7);
      }
      this.legsPlanted(); return tt > 8.5;
    }
    if (kind === 'cat') {
      // crouch down and stroke the cat along its back
      const k = smooth(0.2, 1.0, tt) * (1 - smooth(7.2, 8.0, tt)); H.petting = k > 0.3;
      rig.moveG('pelvis', new V3(0, -0.42 * k, 0.12 * k)); rig.rotG('spine_01', X, -0.35 * k); rig.rotG('neck_01', X, 0.3 * k); g.updateMatrixWorld(true);
      const cw = H.catWorld(); const back = cw.clone().addScaledVector(Y, 0.3).addScaledVector(fwd, Math.sin(tt * 1.6) * 0.1);
      const rest = rig.worldPos('upperarm_r').addScaledVector(Y, -0.55).addScaledVector(right, 0.1);
      arm('r', rest.lerp(back, k), fwd.clone().addScaledVector(Y, -0.4), Y.clone().negate(), 0.2);
      this.legsPlanted(); if (tt > 8) { H.petting = false; return true; } return false;
    }
    if (kind === 'sleep') {
      // lie down on the bed, the night passes, get up in the morning
      const T = 11; const bedC = H.toWorld(3.3, 3.1 + 0.62, 0.1); const hq = H.g.quaternion;
      const lie = new Q().setFromAxisAngle(X, Math.PI / 2).premultiply(hq);
      const stand = new Q().setFromEuler(new THREE.Euler(0, this.yaw, 0));
      const k = smooth(0.4, 1.8, tt) * (1 - smooth(T - 2, T - 0.6, tt));
      this.pos.copy(this.actStart).lerp(bedC, k);
      g.position.copy(this.pos); g.quaternion.copy(stand).slerp(lie, k); g.updateMatrixWorld(true);
      if (this.fadeFn) this.fadeFn(smooth(2.2, 3.4, tt) * (1 - smooth(5.2, 6.6, tt)));
      if (tt > 4.2 && !this.slept) { this.slept = true; this.onSleep && this.onSleep(); }
      if (tt > T) { this.slept = false; this.fadeFn && this.fadeFn(0); this.pos.copy(this.actStart); this.place(); return true; }
      return false;
    }
    return true;
  }
  get busy() { return this.state !== 'cruise'; }
}
function lerpAng(a, b, k) { return a + wrap(b - a) * k; }
