// The long, low glass-roofed dinner cruiser that sails from the Wharf past the monuments.
// Built to pass under the Memorial Bridge arches: about 62 m long, 11 m beam, ~4.2 m above the water.
import * as THREE from 'three';
import { clamp, lerp, smooth } from './util.js';
import { std, U } from './matpatch.js';
import { box, rbox, cyl, sph, tube, merge, tf, boxUV, strip, extrude } from './geo.js';
import { NIGHT_EMISSIVE } from './mats.js';
import TEX from './tex.js';
import { frame, fromSD } from './world.js';
import { addLight } from './registry.js';
import { waveH, laneAt } from './boat.js';

const V3 = THREE.Vector3;
export const OD = { L: 62, B: 11 };

function flagTexture() {
  const c = document.createElement('canvas'); c.width = 190; c.height = 100; const x = c.getContext('2d');
  for (let i = 0; i < 13; i++) { x.fillStyle = i % 2 ? '#f4f2ee' : '#b3202c'; x.fillRect(0, i * 100 / 13, 190, 100 / 13 + 0.5); }
  x.fillStyle = '#233a6b'; x.fillRect(0, 0, 76, 54);
  x.fillStyle = '#f4f2ee';
  for (let r = 0; r < 9; r++) for (let k = 0; k < (r % 2 ? 5 : 6); k++) { x.beginPath(); x.arc(6.3 + k * 12.6 + (r % 2) * 6.3, 5 + r * 5.4, 1.6, 0, 7); x.fill(); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

// warm dining-room interior seen through the glass at night: ceiling lights, pendants, tables, diners
function interiorTexture() {
  const W = 256, H = 144; const c = document.createElement('canvas'); c.width = W; c.height = H; const x = c.getContext('2d');
  const gr = x.createLinearGradient(0, 0, 0, H); gr.addColorStop(0, '#ffd9a0'); gr.addColorStop(0.18, '#c07a3a'); gr.addColorStop(0.6, '#6a3a1c'); gr.addColorStop(1, '#2a160a');
  x.fillStyle = gr; x.fillRect(0, 0, W, H);
  x.fillStyle = '#fff1d0'; x.fillRect(0, 4, W, 5);
  for (const px of [64, 192]) { const g2 = x.createRadialGradient(px, 34, 1, px, 34, 22); g2.addColorStop(0, '#fff6dc'); g2.addColorStop(0.3, 'rgba(255,200,120,0.7)'); g2.addColorStop(1, 'rgba(255,160,80,0)'); x.fillStyle = g2; x.fillRect(px - 24, 10, 48, 48); x.fillStyle = '#3a2410'; x.fillRect(px - 1, 9, 2, 20); }
  const rnd = (() => { let a = 7; return () => ((a = (a * 16807) % 2147483647) / 2147483647); })();
  for (const tx of [40, 128, 216]) {
    x.fillStyle = '#f2e6d2'; x.fillRect(tx - 26, 98, 52, 7); // tablecloth
    x.fillStyle = '#1c0f06'; x.fillRect(tx - 24, 105, 48, 39);
    for (const sx of [-1, 1]) { const hx = tx + sx * (32 + rnd() * 4), hy = 74 + rnd() * 6; x.beginPath(); x.arc(hx, hy, 7, 0, 7); x.fill(); x.fillRect(hx - 9, hy + 6, 18, 60); }
    x.fillStyle = '#ffe0a0'; x.beginPath(); x.arc(tx, 95, 2.2, 0, 7); x.fill();
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; return t;
}

export function buildOdyssey() {
  const g = new THREE.Group();
  const L = OD.L, B = OD.B;
  const M = {
    hullDark: std({ map: TEX.fiber.map, color: 0x1a2130, roughness: 0.55 }, { wet: 0.6 }),
    white: std({ map: TEX.fiber.map, color: 0xe0dfda, roughness: 0.6 }, { wet: 0.6 }),
    deck: std({ map: TEX.deck.map, color: 0xb9b3a6, roughness: 0.7 }, { wet: 1 }),
    glass: std({ color: 0x173f48, roughness: 0.3, metalness: 0.0, envMapIntensity: 0.45, emissive: 0xffffff, emissiveMap: interiorTexture(), emissiveIntensity: 0 }, { wet: 0 }),
    roofGlass: std({ color: 0x24585f, roughness: 0.28, metalness: 0.0, envMapIntensity: 0.5, emissive: 0x3aa6c0, emissiveIntensity: 0 }, { wet: 0 }),
    frame: std({ color: 0xe9e8e4, roughness: 0.55, metalness: 0.0 }, { wet: 0.4 }),
    rail: std({ color: 0xdfe4e8, roughness: 0.2, metalness: 1 }),
    dark: std({ color: 0x22262a, roughness: 0.5 }),
    red: new THREE.MeshBasicMaterial({ color: 0xff2a1a }), green: new THREE.MeshBasicMaterial({ color: 0x22ff66 }), white2: new THREE.MeshBasicMaterial({ color: 0xfff2dc }),
  };
  NIGHT_EMISSIVE.push([M.glass, 1.1], [M.roofGlass, 0.3]);
  const add = (geo, m, cast = true) => { const o = new THREE.Mesh(geo, m); o.castShadow = cast; o.receiveShadow = true; g.add(o); return o; };
  // ---- hull: long parallel body, raked fine bow (at -Z), square transom
  const NT = 40, NU = 10;
  const hb = (t) => (t < 0.72 ? B / 2 : B / 2 * Math.pow(Math.max(0, Math.cos((t - 0.72) / 0.28 * Math.PI / 2)), 0.75)); // t: 0 stern .. 1 bow
  const keel = (t) => -1.1 + 1.2 * Math.pow(Math.max(0, t - 0.8) / 0.2, 2);
  const deckY = 1.4, sheer = (t) => deckY + 0.35 * Math.pow(Math.max(0, t - 0.8) / 0.2, 2);
  const zOf = (t) => (0.5 - t) * L;
  const pos = [], idx = [];
  for (let i = 0; i <= NT; i++) { const t = i / NT; for (let j = -NU; j <= NU; j++) { const u = Math.abs(j) / NU; const x = Math.sign(j) * hb(t) * Math.pow(Math.sin(u * Math.PI / 2), 0.4); const y = keel(t) + (sheer(t) - keel(t)) * Math.pow(u, 1.6); pos.push(x, y, zOf(t)); } }
  const cols = NU * 2 + 1;
  for (let i = 0; i < NT; i++) for (let j = 0; j < cols - 1; j++) { const a = i * cols + j, b = a + 1, c = a + cols, d = c + 1; idx.push(a, b, c, b, d, c); }
  const hg = new THREE.BufferGeometry(); hg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); hg.setIndex(idx); hg.computeVertexNormals(); boxUV(hg, 0.3);
  add(hg, M.hullDark);
  // white topside band and rubbing strake
  { const a = [], b = [], c = [], d = [];
    for (let i = 0; i <= NT; i++) { const t = i / NT; const w = hb(t) + 0.02; const z = zOf(t), sy = sheer(t);
      a.push(new V3(-w, sy - 0.32, z)); b.push(new V3(-w, sy + 0.05, z)); c.push(new V3(w, sy - 0.32, z)); d.push(new V3(w, sy + 0.05, z)); }
    add(strip(b, a), M.white); add(strip(c, d), M.white);
    const tr = []; for (let i = 0; i <= NT; i++) { const t = i / NT; tr.push(new V3(hb(t) + 0.06, sheer(t) - 0.32, zOf(t))); }
    add(tube(tr, tr.map(() => 0.07), 5), M.dark); add(tube(tr.map((p) => new V3(-p.x, p.y, p.z)), tr.map(() => 0.07), 5), M.dark);
  }
  // transom
  { const band = sheer(0) - 0.32;
    const sh = new THREE.Shape(); sh.moveTo(-B / 2, keel(0)); sh.lineTo(B / 2, keel(0)); sh.lineTo(B / 2, band); sh.lineTo(-B / 2, band);
    const tg = extrude(sh, 0.1, { z: zOf(0) }); boxUV(tg, 0.3); add(tg, M.hullDark);
    const sw = new THREE.Shape(); sw.moveTo(-B / 2 - 0.02, band); sw.lineTo(B / 2 + 0.02, band); sw.lineTo(B / 2 + 0.02, sheer(0) + 0.05); sw.lineTo(-B / 2 - 0.02, sheer(0) + 0.05);
    const tw = extrude(sw, 0.14, { z: zOf(0) }); boxUV(tw, 0.3); add(tw, M.white); }
  // main deck
  { const a = [], b = []; for (let i = 0; i <= NT; i++) { const t = i / NT; const w = hb(t) - 0.05; a.push(new V3(-w, sheer(t), zOf(t))); b.push(new V3(w, sheer(t), zOf(t))); }
    const dg = strip(a, b); boxUV(dg, 0.3); add(dg, M.deck); }
  // ---- superstructure: glass pavilions separated by white sections (stern open deck, bow open deck)
  const sections = [ // [zFrom (stern side), zTo, type]
    [L / 2 - 5.5, L / 2 - 20, 'glass'], [L / 2 - 20, L / 2 - 25, 'white'], [L / 2 - 25, L / 2 - 43, 'glass'], [L / 2 - 43, L / 2 - 47, 'white'], [L / 2 - 47, L / 2 - 57, 'glass'],
  ];
  const wallH = 1.0, glassH = 1.9, pw = B / 2 - 0.35;
  for (const [z0, z1, type] of sections) {
    const len = z0 - z1, zc = (z0 + z1) / 2;
    const t = 0.5 - zc / L; const w = Math.min(pw, hb(Math.min(1, t + len / L / 2)) - 0.4);
    if (type === 'white') {
      const wb = rbox(w * 2, wallH + glassH + 0.2, len, 0.15, { y: deckY + (wallH + glassH + 0.2) / 2, z: zc }); boxUV(wb, 0.3); add(wb, M.white);
      // small square windows
      for (const sx of [-1, 1]) add(box(0.05, 0.7, len * 0.6, { x: sx * (w + 0.01), y: deckY + 1.6, z: zc }), M.glass, false);
      continue;
    }
    // low white base wall
    const base = rbox(w * 2, wallH, len, 0.08, { y: deckY + wallH / 2, z: zc }); boxUV(base, 0.3); add(base, M.white);
    // raked glass sides (trapezoid prism) and a shallow glass roof
    const inset = 0.45;
    const sh = new THREE.Shape(); sh.moveTo(-w, 0); sh.lineTo(w, 0); sh.lineTo(w - inset, glassH); sh.lineTo(-(w - inset), glassH); sh.lineTo(-w, 0);
    const gg = extrude(sh, len - 0.2, { y: deckY + wallH, z: zc });
    { const p = gg.attributes.position, uv = gg.attributes.uv; for (let i = 0; i < p.count; i++) uv.setXY(i, (p.getZ(i) - z1) / 3.4, (p.getY(i) - deckY - wallH) / glassH); }
    add(gg, M.glass, false);
    const roof = new THREE.Shape(); roof.moveTo(-(w - inset) - 0.15, 0); roof.lineTo((w - inset) + 0.15, 0); roof.lineTo((w - inset) * 0.55, 0.32); roof.lineTo(-(w - inset) * 0.55, 0.32);
    add(extrude(roof, len, { y: deckY + wallH + glassH, z: zc }), M.roofGlass);
    // white mullions, roof ribs and a top rail frame
    const fr = [];
    const n = Math.round(len / 1.7);
    for (let k = 0; k <= n; k++) {
      const z = z1 + 0.1 + (len - 0.2) * k / n;
      for (const sx of [-1, 1]) fr.push(tube([new V3(sx * w, deckY + wallH, z), new V3(sx * (w - inset), deckY + wallH + glassH, z)], [0.05, 0.05], 4));
      fr.push(tube([new V3(-(w - inset) - 0.15, deckY + wallH + glassH + 0.02, z), new V3(-(w - inset) * 0.55, deckY + wallH + glassH + 0.34, z), new V3((w - inset) * 0.55, deckY + wallH + glassH + 0.34, z), new V3((w - inset) + 0.15, deckY + wallH + glassH + 0.02, z)], [0.05, 0.05, 0.05, 0.05], 4));
    }
    for (const sx of [-1, 1]) fr.push(box(0.1, 0.12, len, { x: sx * (w - inset), y: deckY + wallH + glassH, z: zc }), box(0.12, 0.1, len, { x: sx * w, y: deckY + wallH, z: zc }));
    add(merge(fr), M.frame);
  }
  // ---- open decks with railings (stern and bow) and side walkways
  const rails = [];
  const railPts = (tA, tB, sx) => { const pts = []; for (let k = 0; k <= 24; k++) { const t = tA + (tB - tA) * k / 24; pts.push(new V3(sx * (hb(t) - 0.2), sheer(t) + 1.05, zOf(t))); } return pts; };
  for (const sx of [-1, 1]) {
    for (const [tA, tB] of [[0.005, 0.99]]) {
      const top = railPts(tA, tB, sx); rails.push(tube(top, top.map(() => 0.035), 5));
      const mid = top.map((p) => p.clone().setY(p.y - 0.5)); rails.push(tube(mid, mid.map(() => 0.018), 4));
      for (let k = 0; k < top.length; k++) rails.push(cyl(0.025, 0.025, 1.05, 5, { x: top[k].x, y: top[k].y - 0.52, z: top[k].z }));
    }
  }
  { const st = []; for (let k = 0; k <= 10; k++) { const x = -B / 2 + 0.2 + (B - 0.4) * k / 10; st.push(new V3(x, sheer(0) + 1.05, zOf(0) - 0.15)); } rails.push(tube(st, st.map(() => 0.035), 5)); }
  add(merge(rails), M.rail);
  // bow: small wheelhouse-like pod and mast with lights; stern: flagstaff
  const mastZ = zOf(0.93);
  add(merge([cyl(0.06, 0.08, 2.2, 8, { y: sheer(0.93) + 1.1, z: mastZ })]), M.frame);
  const mh = add(sph(0.12, 10, 8, { y: sheer(0.93) + 2.25, z: mastZ }), M.white2, false);
  const nav = { mast: { local: new V3(0, sheer(0.93) + 2.25, mastZ), col: 0xfff2dc, mesh: mh } };
  for (const [sx, m, key, col] of [[-1, M.red, 'port', 0xff2a1a], [1, M.green, 'star', 0x22ff66]]) {
    const t = 0.86, x = sx * (hb(t) + 0.02);
    const lens = add(box(0.06, 0.12, 0.3, { x, y: sheer(t) + 0.15, z: zOf(t) }), m, false);
    nav[key] = { local: new V3(x + sx * 0.2, sheer(t) + 0.15, zOf(t)), col, mesh: lens };
  }
  const sm = add(sph(0.1, 8, 6, { y: sheer(0) + 1.3, z: zOf(0) - 0.2 }), M.white2, false);
  nav.stern = { local: new V3(0, sheer(0) + 1.3, zOf(0) + 0.2), col: 0xfff2dc, mesh: sm };
  // flag at the stern, waving in the wind
  add(cyl(0.03, 0.035, 2.6, 6, { x: -B / 2 + 0.6, y: sheer(0) + 1.3, z: zOf(0) - 0.3 }), M.rail);
  const fg = new THREE.PlaneGeometry(1.5, 0.8, 12, 4); fg.translate(0.75, 0, 0);
  const flagMat = std({ map: flagTexture(), side: THREE.DoubleSide, roughness: 0.8 }, {
    wet: 0.6, vertexExtra: `\n { float u = position.x / 1.5; transformed.z += sin(uTime*6.0 - u*7.0) * 0.12 * u; transformed.y += sin(uTime*4.3 - u*5.0) * 0.03 * u; }\n`,
  });
  const flag = add(fg, flagMat, false); flag.position.set(-B / 2 + 0.6, sheer(0) + 2.2, zOf(0) - 0.3); flag.rotation.y = Math.PI / 2;
  // warm interior lights for the night
  const cabin = sections.filter((q) => q[2] === 'glass').map(([z0, z1]) => new V3(0, deckY + 1.8, (z0 + z1) / 2));
  g.userData = { L, B, nav, cabin, M };
  return g;
}

// A slow loop between the Wharf (downstream, off in the haze) and the Kennedy Center reach.
export class Odyssey {
  constructor(scene, bridges) {
    this.m = buildOdyssey(); scene.add(this.m);
    this.frame = frame; this.fromSD = fromSD; this.bridges = bridges;
    this.halfLen = OD.L / 2; this.halfBeam = OD.B / 2;
    // route in (s, d): upstream leg, turn, downstream leg, turn
    this.up = 2; this.down = -50; this.sTop = 560; this.sBot = -380; this.R = (this.up - this.down) / 2;
    this.legLen = this.sTop - this.sBot; this.turnLen = Math.PI * this.R;
    this.total = 2 * this.legLen + 2 * this.turnLen;
    this.u = this.legLen * 0.62; // start partway up the upstream leg so it is seen early
    this.speed = 3.4; this.spd = this.speed;
    this.lights = {};
    const ud = this.m.userData;
    for (const k in ud.nav) this.lights[k] = addLight(new V3(), ud.nav[k].col, k === 'mast' || k === 'stern' ? 12 : 8, 0.9, { kind: 'boat', dyn: true });
    this.cabinL = ud.cabin.map(() => addLight(new V3(), 0xffc27a, 14, 0.8, { kind: 'boat', dyn: true }));
    this.s = 0; this.d = 0; this.psi = 0; this.relHeading = 0; this.x = 0; this.z = 0;
  }
  sdAt(u) {
    u = ((u % this.total) + this.total) % this.total;
    const { legLen: A, turnLen: T, R } = this;
    const cd = (this.up + this.down) / 2;
    if (u < A) return [this.sBot + u, this.snap(this.sBot + u, this.up), 1];
    u -= A;
    if (u < T) { const a = u / R; return [this.sTop + Math.sin(a) * R, cd + Math.cos(a) * R, 0]; }
    u -= T;
    if (u < A) return [this.sTop - u, this.snap(this.sTop - u, this.down), -1];
    u -= A; const a = u / R; return [this.sBot - Math.sin(a) * R, cd - Math.cos(a) * R, 0];
  }
  // line up with an arch when passing under a bridge
  snap(s, d) {
    for (const br of this.bridges) {
      const w = 1 - smooth(55, 120, Math.abs(s - br.s)); if (w <= 0) continue;
      let best = d, bd = 1e9; for (let k = 0; k < br.spans; k++) { const c = br.dL + br.bay * (k + 0.5); const cost = Math.abs(c - d) + (Math.abs(c - laneAt(br.s)) < 16 ? 60 : 0); if (cost < bd) { bd = cost; best = c; } }
      d = lerp(d, best, w);
    }
    return d;
  }
  // place on the downstream leg just below its upper turn (so it meets a boat heading upstream)
  placeUp(s) { this.u = s - this.sBot; this.spd = this.speed; }
  placeDown(s) { this.u = this.legLen + this.turnLen + (this.sTop - s); this.spd = this.speed; }
  update(dt, t, tide, lightsOn, hero) {
    // slow down if the hero boat sits across its bow
    const [s0, d0] = this.sdAt(this.u), [s1, d1] = this.sdAt(this.u + 4);
    const [x0, z0] = this.fromSD(s0, d0), [x1, z1] = this.fromSD(s1, d1);
    const fx = (x1 - x0) / Math.hypot(x1 - x0, z1 - z0), fz = (z1 - z0) / Math.hypot(x1 - x0, z1 - z0);
    let want = this.speed;
    if (hero) { const rx = hero.x - x0, rz = hero.z - z0; const ahead = rx * fx + rz * fz, lat = Math.abs(-rx * fz + rz * fx); if (ahead > 0 && ahead < this.halfLen + 30 && lat < this.halfBeam + 5) want *= clamp((ahead - this.halfLen - 6) / 24, 0, 1); }
    this.spd = lerp(this.spd, want, 1 - Math.exp(-dt * 0.5));
    this.u += this.spd * dt;
    this.s = s0; this.d = d0; this.x = x0; this.z = z0;
    const psi = Math.atan2(fx, -fz); this.psi = psi;
    this.relHeading = psi - this.frame(s0).th;
    const y = waveH(x0, z0, t, tide);
    this.m.position.set(x0, y + 0.02, z0);
    this.m.rotation.set(Math.sin(t * 0.6) * 0.004, -psi, Math.sin(t * 0.5 + 1) * 0.006, 'YXZ');
    this.m.updateMatrixWorld();
    const ud = this.m.userData;
    for (const k in ud.nav) { this.lights[k].p.copy(ud.nav[k].local).applyMatrix4(this.m.matrixWorld); this.lights[k].I = 0.9 * lightsOn; ud.nav[k].mesh.material.color.setHex(ud.nav[k].col).multiplyScalar(0.3 + lightsOn * 7); }
    ud.cabin.forEach((p, i) => { this.cabinL[i].p.copy(p).applyMatrix4(this.m.matrixWorld); this.cabinL[i].I = 0.8 * lightsOn; });
  }
  simBoat() { return { s: this.s, d: this.d, relHeading: this.relHeading, speed: this.spd, halfLen: this.halfLen * 0.95, halfBeam: this.halfBeam * 0.95, strength: 0.55, prop: 0.7 }; }
  fwd() { return [Math.sin(this.psi), -Math.cos(this.psi)]; }
}
