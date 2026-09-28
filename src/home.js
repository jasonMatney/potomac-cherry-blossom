// The skipper's home: a three-storey shingled house on a terrace cut into the Virginia bluff, across the
// river from Fletcher's Cove. A private dock and a switchback stair climb to a porch; inside, an open
// ground floor (kitchen, dining, living room with a fireplace and TV, a glass sunroom looking over the
// water), a bedroom, office and bathroom upstairs, and a study under the roof with a balcony and a
// telescope. The chimney rises from the fireplace through the roof. A ginger cat lives here.
import * as THREE from 'three';
import { clamp, lerp, smooth, mulberry32 } from './util.js';
import { frame, fromSD, toSD, hwL, HOME } from './world.js';
import { groundAt } from './terrain.js';
import { std, U } from './matpatch.js';
import { box, rbox, cyl, sph, merge, tf, boxUV, tube, ensureColor } from './geo.js';
import { M, NIGHT_EMISSIVE } from './mats.js';
import { addLight, addObstacle, addWalkBlock, SOLID_FNS } from './registry.js';
import TEX from './tex.js';

const V3 = THREE.Vector3, Q = THREE.Quaternion;
const FY = [0, 3.1, 6.2]; // floor surfaces (house-local)
const EAVE = 9.3, RIDGE = 12.1;
const HX = 6, HZ = 4.5; // half extents of the house body

// ------------------------------------------------------------------ canvas textures
function canvasTex(w, h, draw, rep = 1) { const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4; return t; }
const rnd = mulberry32(777);
const TX = {};
function textures() {
  if (TX.done) return TX;
  TX.shingle = canvasTex(256, 256, (g, w, h) => { g.fillStyle = '#74838c'; g.fillRect(0, 0, w, h);
    for (let r = 0; r < 16; r++) { let x = (r % 2) * 9; while (x < w) { const sw = 12 + rnd() * 16; const v = 0.9 + rnd() * 0.18; g.fillStyle = `rgb(${116 * v | 0},${131 * v | 0},${140 * v | 0})`; g.fillRect(x + 1, r * 16, sw - 2, 15); x += sw; } g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(0, r * 16 + 14, w, 2); } });
  TX.roof = canvasTex(256, 256, (g, w, h) => { g.fillStyle = '#2d3136'; g.fillRect(0, 0, w, h);
    for (let r = 0; r < 12; r++) { let x = (r % 2) * 11; while (x < w) { const sw = 18 + rnd() * 10; const v = 0.8 + rnd() * 0.4; g.fillStyle = `rgb(${45 * v | 0},${49 * v | 0},${54 * v | 0})`; g.fillRect(x + 1, r * 21.3, sw - 2, 20); x += sw; } g.fillStyle = 'rgba(0,0,0,0.5)'; g.fillRect(0, r * 21.3 + 19, w, 2); } });
  TX.planks = canvasTex(256, 256, (g, w, h) => { for (let r = 0; r < 8; r++) { let x = -rnd() * 80; while (x < w) { const L = 60 + rnd() * 90; const v = 0.82 + rnd() * 0.3; g.fillStyle = `rgb(${176 * v | 0},${124 * v | 0},${78 * v | 0})`; g.fillRect(x, r * 32, L, 31); g.fillStyle = 'rgba(60,35,15,0.25)'; for (let k = 0; k < 6; k++) g.fillRect(x, r * 32 + 4 + rnd() * 24, L, 1); x += L; g.fillStyle = 'rgba(40,20,5,0.6)'; g.fillRect(x - 1, r * 32, 1, 31); } g.fillStyle = 'rgba(40,20,5,0.55)'; g.fillRect(0, r * 32 + 31, w, 1); } });
  TX.tile = canvasTex(128, 128, (g, w, h) => { g.fillStyle = '#eef0f0'; g.fillRect(0, 0, w, h); g.fillStyle = '#c9cfd2'; for (let i = 0; i <= 4; i++) { g.fillRect(i * 32 - 1, 0, 2, h); g.fillRect(0, i * 32 - 1, w, 2); } });
  TX.rug = canvasTex(256, 256, (g, w, h) => { g.fillStyle = '#8a3a2a'; g.fillRect(0, 0, w, h); g.strokeStyle = '#e8c890'; g.lineWidth = 6; g.strokeRect(14, 14, w - 28, h - 28); g.strokeStyle = '#2a3a5a'; g.lineWidth = 4; g.strokeRect(30, 30, w - 60, h - 60);
    for (let i = 0; i < 5; i++) for (let j = 0; j < 5; j++) { g.fillStyle = (i + j) % 2 ? '#c8783a' : '#2a3a5a'; g.save(); g.translate(58 + i * 35, 58 + j * 35); g.rotate(Math.PI / 4); g.fillRect(-9, -9, 18, 18); g.restore(); } });
  TX.books = canvasTex(256, 128, (g, w, h) => { g.fillStyle = '#3a2a1c'; g.fillRect(0, 0, w, h); for (let r = 0; r < 4; r++) { let x = 2; while (x < w - 4) { const bw = 5 + rnd() * 9, bh = 20 + rnd() * 9; const cols = ['#7a2a2a', '#2a4a6a', '#3a5a3a', '#c8a050', '#5a3a6a', '#d8d0c0', '#2a2a2a', '#8a5a2a']; g.fillStyle = cols[Math.floor(rnd() * cols.length)]; g.fillRect(x, r * 32 + 31 - bh, bw, bh); x += bw + 1; } g.fillStyle = '#5a4030'; g.fillRect(0, r * 32 + 29, w, 3); } });
  TX.done = true; return TX;
}

// ------------------------------------------------------------------ builder: merges geometry per material and part
class Builder {
  constructor() { this.parts = new Map(); }
  add(part, mat, geo, cast = true) { const k = part; if (!this.parts.has(k)) this.parts.set(k, new Map()); const m = this.parts.get(k); if (!m.has(mat)) m.set(mat, { list: [], cast }); m.get(mat).list.push(geo); }
  build(groups, far) {
    const farMats = new Map();
    for (const [part, mats] of this.parts) {
      const g = groups[part] || (groups[part] = new THREE.Group());
      const outer = /^(out|roof|chim|sun|sunroof|trimOut|w\d)/.test(part);
      for (const [mat, e] of mats) {
        const geo = merge(e.list); const mesh = new THREE.Mesh(geo, mat); mesh.castShadow = e.cast; mesh.receiveShadow = true; g.add(mesh);
        if (far && outer) { if (!farMats.has(mat)) farMats.set(mat, []); farMats.get(mat).push(geo); }
      }
    }
    // seen from a distance the house is just its outside: one mesh per material instead of hundreds of parts
    if (far) for (const [mat, list] of farMats) { const mesh = new THREE.Mesh(merge(list), mat); mesh.castShadow = true; mesh.receiveShadow = true; far.add(mesh); }
  }
}
const B3 = (x0, x1, y0, y1, z0, z1) => box(x1 - x0, y1 - y0, z1 - z0, { x: (x0 + x1) / 2, y: (y0 + y1) / 2, z: (z0 + z1) / 2 });

// a wall slab along x or z with rectangular openings [(u0, u1, v0, v1)] in wall coordinates
function wallGeo(axis, c, a0, a1, y0, y1, th, holes = []) {
  // split into columns between openings, and above/below each opening
  const out = []; const us = [a0, a1]; for (const h of holes) us.push(h[0], h[1]); us.sort((p, q) => p - q);
  for (let i = 0; i < us.length - 1; i++) {
    const u0 = us[i], u1 = us[i + 1]; if (u1 - u0 < 1e-3) continue; const um = (u0 + u1) / 2;
    const h = holes.find((q) => um > q[0] && um < q[1]);
    const segs = h ? [[y0, h[2]], [h[3], y1]] : [[y0, y1]];
    for (const [v0, v1] of segs) if (v1 - v0 > 1e-3) out.push(axis === 'x' ? B3(u0, u1, v0, v1, c - th / 2, c + th / 2) : B3(c - th / 2, c + th / 2, v0, v1, u0, u1));
  }
  return out;
}

export class Home {
  constructor(scene) {
    textures();
    this.scene = scene;
    const F = frame(HOME.s);
    const [cx, cz] = fromSD(HOME.s, -(hwL(HOME.s) + HOME.e));
    this.y0 = HOME.y + 0.35;
    const g = this.g = new THREE.Group(); g.position.set(cx, this.y0, cz);
    // local -Z faces the river (+r on the Virginia side), local +X runs downstream
    const Zw = new V3(-F.rx, 0, -F.rz); g.rotation.y = Math.atan2(Zw.x, Zw.z);
    scene.add(g); g.updateMatrixWorld(true);
    this.inv = new THREE.Matrix4().copy(g.matrixWorld).invert();
    this.mats();
    this.floors = [0, 1, 2].map(() => ({ ext: [], group: new THREE.Group() }));
    this.floors.forEach((f) => g.add(f.group));
    this.roof = new THREE.Group(); g.add(this.roof);
    this.outside = new THREE.Group(); g.add(this.outside);
    this.buildShell();
    this.buildInterior();
    this.buildOutside();
    this.buildLife();
    this.walk();
    this.nav();
    // the house as a solid for the camera and the boat
    SOLID_FNS.push((x, y, z, pad) => { const p = this.toLocal(x, y, z); return Math.abs(p.x) < HX + pad && Math.abs(p.z) < HZ + pad && p.y > -1 && p.y < RIDGE + 1.2 && !this.camInside; });
  }
  toLocal(x, y, z) { return new V3(x, y, z).applyMatrix4(this.inv); }
  toWorld(x, y, z) { return new V3(x, y, z).applyMatrix4(this.g.matrixWorld); }
  mats() {
    const T = TX;
    const wood = (c, r = 0.6) => std({ map: TEX.wood.map, color: c, roughness: r }, { wet: 0.8 });
    this.m = {
      siding: std({ map: T.shingle, color: 0xffffff, roughness: 0.8 }, { wet: 1 }),
      trim: std({ color: 0xf2efe8, roughness: 0.5 }, { wet: 0.8 }),
      roof: std({ map: T.roof, roughness: 0.75 }, { wet: 1 }),
      stone: M.granite, brick: M.brick,
      wallIn: std({ color: 0xece4d4, roughness: 0.9 }, { wet: 0 }),
      wallBath: std({ map: T.tile, color: 0xffffff, roughness: 0.35 }, { wet: 0 }),
      floor: std({ map: T.planks, roughness: 0.55 }, { wet: 0 }),
      ceiling: std({ color: 0xf4f0e8, roughness: 0.95 }, { wet: 0 }),
      tileFloor: std({ map: T.tile, color: 0xdfe6ea, roughness: 0.4 }, { wet: 0 }),
      glass: std({ color: 0x33434c, roughness: 0.04, metalness: 0.2, transparent: true, opacity: 0.42, depthWrite: false, emissive: 0xffc98a, emissiveIntensity: 0, envMapIntensity: 0.9 }, { wet: 0 }),
      cabinet: std({ color: 0x86a08a, roughness: 0.55 }, { wet: 0 }), counter: std({ color: 0xece9e2, roughness: 0.25 }, { wet: 0 }),
      steel: std({ color: 0xd6dadd, roughness: 0.25, metalness: 1 }, { wet: 0 }), black: std({ color: 0x1b1c1f, roughness: 0.4 }, { wet: 0 }),
      darkwood: wood(0x6a4a30), lightwood: wood(0xd0a878), deckwood: std({ map: TEX.deck.map, normalMap: TEX.deck.normalMap, roughness: 0.8 }, { wet: 1 }),
      sofa: std({ color: 0x3e5474, roughness: 0.9 }, { wet: 0 }), cushion: std({ color: 0xd8a24a, roughness: 0.9 }, { wet: 0 }),
      rug: std({ map: T.rug, roughness: 0.95 }, { wet: 0 }), books: std({ map: T.books, roughness: 0.8 }, { wet: 0 }),
      linen: std({ color: 0xf3efe6, roughness: 0.9 }, { wet: 0 }), duvet: std({ color: 0x4a6a8a, roughness: 0.9 }, { wet: 0 }),
      porcelain: std({ color: 0xfafafa, roughness: 0.15 }, { wet: 0 }), water: std({ color: 0x9fc8d8, roughness: 0.02, metalness: 0.2 }, { wet: 0 }),
      leaf: std({ color: 0x3c6a34, roughness: 0.7, side: THREE.DoubleSide }, { wet: 0.5 }), pot: std({ color: 0xb4623a, roughness: 0.8 }, { wet: 0.4 }),
      mirror: std({ color: 0xdfe8ee, roughness: 0.02, metalness: 1 }, { wet: 0 }),
      lampShade: std({ color: 0xf4e6c8, roughness: 0.8, emissive: 0xffd9a0, emissiveIntensity: 0 }, { wet: 0 }),
      rail: std({ color: 0xf2efe8, roughness: 0.5 }, { wet: 0.8 }),
    };
    NIGHT_EMISSIVE.push([this.m.glass, 0.35], [this.m.lampShade, 1.2]);
  }
  // ---------------------------------------------------------------- walls, floors, roof, chimney
  buildShell() {
    const b = this.B = new Builder(); const m = this.m;
    const T = 0.2; // exterior wall thickness
    // stone foundation (down the slope), with the porch and sunroom plinths
    b.add('out', m.stone, B3(-HX - 0.1, HX + 0.1, -4.2, -0.05, -HZ - 0.1, HZ + 0.1));
    b.add('out', m.stone, B3(-5.7, 0.5, -5.5, -0.05, -8.1, -HZ));
    // floor slabs
    for (let f = 0; f < 3; f++) {
      const y = FY[f]; const part = 'f' + f;
      const holes = f === 1 ? [[0.8, 5.0, 3.35, 4.4]] : f === 2 ? [[0.8, 5.0, 2.25, 3.25]] : [];
      // slab split around the stairwell
      const slab = (x0, x1, z0, z1) => { const g = B3(x0, x1, y - 0.22, y, z0, z1); boxUV(g, 0.45); b.add(part, m.floor, g); if (f > 0) { const c = B3(x0, x1, y - 0.24, y - 0.22, z0, z1); b.add('ceil' + (f - 1), m.ceiling, c, false); } };
      if (!holes.length) slab(-HX + 0.1, HX - 0.1, -HZ + 0.1, HZ - 0.1);
      else { const [x0, x1, z0, z1] = holes[0]; slab(-HX + 0.1, HX - 0.1, -HZ + 0.1, z0); slab(-HX + 0.1, HX - 0.1, z1, HZ - 0.1); slab(-HX + 0.1, x0, z0, z1); slab(x1, HX - 0.1, z0, z1); }
    }
    // tiled bathroom floor on F2
    b.add('f1', m.tileFloor, B3(-5.9, -2.0, FY[1] + 0.008, FY[1] + 0.02, 0.4, 4.4), false);
    // exterior walls per floor, each side its own part so it can be cut away
    const H = 3.1;
    const win = (u, w = 1.2, v0 = 0.95, v1 = 2.35) => [u - w / 2, u + w / 2, v0, v1];
    const spec = [
      // [floor, side, holes]
      [0, 'front', [[-4.2, -1.2, 0.02, 2.6], [2.4, 3.4, 0.02, 2.3], win(4.9, 1.4)]],
      [0, 'back', [win(0.2, 0.8, 1.0, 2.2)]],
      [0, 'left', [win(2.1, 1.4)]], [0, 'right', [win(-2.6, 1.2), win(2.6, 1.2)]],
      [1, 'front', [win(1.6, 1.2), win(4.4, 1.2), win(-3.0, 1.4)]], [1, 'back', [win(-4.9, 0.8, 1.5, 2.3), win(3.0, 1.0)]],
      [1, 'left', [win(-2.2, 1.2)]], [1, 'right', [win(-2.6, 1.0), win(2.6, 1.0)]],
      [2, 'front', [[-0.6, 0.9, 0.02, 2.3], win(-3.4, 1.4), win(3.6, 1.4)]], [2, 'back', [win(2.4, 1.1), win(4.3, 1.1)]],
      [2, 'left', [win(0, 1.2)]], [2, 'right', [win(-2.6, 1.0), win(2.6, 1.0)]],
    ];
    for (const [f, side, holes] of spec) {
      const y0 = FY[f] - (f === 0 ? 0.05 : 0.24), y1 = FY[f] + H - (f === 2 ? 0 : 0.0);
      const part = `w${f}${side}`;
      let outer, inner; const hl = holes.map(([u0, u1, v0, v1]) => [u0, u1, FY[f] + v0, FY[f] + v1]);
      if (side === 'front' || side === 'back') {
        const zc = side === 'front' ? -HZ : HZ; const sgn = side === 'front' ? -1 : 1;
        outer = wallGeo('x', zc + sgn * 0.06, -HX - 0.02, HX + 0.02, y0, y1, 0.12, hl); inner = wallGeo('x', zc - sgn * 0.06, -HX + 0.1, HX - 0.1, y0 + 0.05, y1 - 0.02, 0.08, hl);
      } else {
        const xc = side === 'left' ? -HX : HX; const sgn = side === 'left' ? -1 : 1;
        // side walls run along z; hole u measured along z
        outer = wallGeo('z', xc + sgn * 0.06, -HZ - 0.02, HZ + 0.02, y0, y1, 0.12, hl); inner = wallGeo('z', xc - sgn * 0.06, -HZ + 0.1, HZ - 0.1, y0 + 0.05, y1 - 0.02, 0.08, hl);
      }
      for (const o of outer) { boxUV(o, 0.55); b.add(part, m.siding, o); }
      for (const o of inner) { boxUV(o, 0.5); b.add(part, f === 1 && side === 'left' ? m.wallIn : m.wallIn, o); }
      // glazing + white frames in each opening (doors get a leaf instead)
      for (const [u0, u1, v0, v1] of hl) {
        const isDoor = v0 < FY[f] + 0.1; const along = side === 'front' || side === 'back';
        const c = along ? (side === 'front' ? -HZ : HZ) : (side === 'left' ? -HX : HX);
        const fr = [];
        const bar = (a0, a1, b0, b1, t = 0.24) => (along ? B3(a0, a1, b0, b1, c - t / 2, c + t / 2) : B3(c - t / 2, c + t / 2, b0, b1, a0, a1));
        fr.push(bar(u0 - 0.08, u0, v0 - (isDoor ? 0 : 0.08), v1 + 0.08), bar(u1, u1 + 0.08, v0 - (isDoor ? 0 : 0.08), v1 + 0.08), bar(u0 - 0.08, u1 + 0.08, v1, v1 + 0.08));
        if (!isDoor) { fr.push(bar(u0 - 0.1, u1 + 0.1, v0 - 0.1, v0, 0.3)); fr.push(bar((u0 + u1) / 2 - 0.025, (u0 + u1) / 2 + 0.025, v0, v1, 0.08)); fr.push(bar(u0, u1, (v0 + v1) / 2 - 0.02, (v0 + v1) / 2 + 0.02, 0.08)); b.add(part, m.glass, bar(u0, u1, v0, v1, 0.02), false); }
        for (const q of fr) b.add(part, m.trim, q);
      }
      this.floors[f].ext.push({ part, side });
    }
    // corner boards and floor bands
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) b.add('trimOut', m.trim, B3(sx * HX - 0.12, sx * HX + 0.12, -0.05, EAVE, sz * HZ - 0.12, sz * HZ + 0.12));
    for (const y of [FY[1] - 0.15, FY[2] - 0.15]) { b.add('trimOut', m.trim, B3(-HX - 0.1, HX + 0.1, y - 0.1, y + 0.1, -HZ - 0.1, -HZ + 0.05)); b.add('trimOut', m.trim, B3(-HX - 0.1, HX + 0.1, y - 0.1, y + 0.1, HZ - 0.05, HZ + 0.1)); }
    // gable roof, ridge along x
    { const ov = 0.55, run = HZ + ov, rise = RIDGE - EAVE, ang = Math.atan2(rise, HZ), len = run / Math.cos(ang);
      for (const sz of [-1, 1]) {
        const g = box(2 * HX + 2 * ov, 0.2, len, {}); g.rotateX(sz * ang); g.translate(0, RIDGE - (run / 2) * Math.tan(ang) + 0.1, sz * run / 2); boxUV(g, 0.35); b.add('roof', m.roof, g);
        const fascia = box(2 * HX + 2 * ov, 0.25, 0.08, { y: EAVE - ov * Math.tan(ang) - 0.1, z: sz * (HZ + ov) }); b.add('roof', m.trim, fascia);
      }
      // gable end walls (triangles) with a round attic vent
      for (const sx of [-1, 1]) {
        const sh = new THREE.Shape(); sh.moveTo(-HZ, 0); sh.lineTo(HZ, 0); sh.lineTo(0, RIDGE - EAVE); sh.lineTo(-HZ, 0);
        const g = new THREE.ShapeGeometry(sh); g.rotateY(sx * Math.PI / 2); g.translate(sx * (HX + 0.05), EAVE, 0); ensureColor(g); boxUV(g, 0.55); b.add('roof', m.siding, g);
        const gi = new THREE.ShapeGeometry(sh); gi.rotateY(-sx * Math.PI / 2); gi.translate(sx * (HX - 0.05), EAVE, 0); ensureColor(gi); b.add('roof', m.wallIn, gi);
        b.add('roof', m.trim, cyl(0.42, 0.42, 0.1, 20, { x: sx * (HX + 0.08), y: EAVE + 1.1, rz: Math.PI / 2 }));
        b.add('roof', m.glass, cyl(0.34, 0.34, 0.12, 20, { x: sx * (HX + 0.08), y: EAVE + 1.1, rz: Math.PI / 2 }), false);
      }
      // F3 ceiling under the roof (flat at the eaves) so the study has a lid when the roof is on
      b.add('roof', m.ceiling, B3(-HX + 0.1, HX - 0.1, EAVE - 0.02, EAVE, -HZ + 0.1, HZ - 0.1), false);
    }
    // chimney: brick stack outside the +X wall, from the foundation to above the ridge, with a clay pot
    { const g = B3(HX + 0.05, HX + 0.95, -4.2, RIDGE + 1.3, -0.75, 0.75); boxUV(g, 0.5); b.add('chim', m.brick, g);
      b.add('chim', m.stone, B3(HX - 0.02, HX + 1.05, RIDGE + 1.3, RIDGE + 1.45, -0.85, 0.85));
      b.add('chim', m.pot, cyl(0.16, 0.2, 0.5, 12, { x: HX + 0.5, y: RIDGE + 1.7 }));
      this.chimTop = new V3(HX + 0.5, RIDGE + 2.0, 0); }
    // porch deck, steps and railings; sunroom glasshouse
    { b.add('out', m.deckwood, B3(1.4, 6.0, -0.12, 0.0, -6.6, -HZ), true);
      for (const x of [1.5, 5.9]) b.add('out', m.trim, B3(x - 0.06, x + 0.06, -4.0, 0.0, -6.55, -6.43));
      const railLine = (a, bb, part = 'out') => { const n = Math.max(2, Math.ceil(a.distanceTo(bb) / 0.14)); for (let i = 0; i <= n; i++) { const p = a.clone().lerp(bb, i / n); b.add(part, m.rail, B3(p.x - 0.02, p.x + 0.02, p.y, p.y + 0.95, p.z - 0.02, p.z + 0.02)); } b.add(part, m.rail, tfLine(a.clone().setY(a.y + 0.95), bb.clone().setY(bb.y + 0.95), 0.05)); };
      this.railLine = railLine;
      railLine(new V3(1.45, 0, -4.55), new V3(1.45, 0, -6.55)); railLine(new V3(1.45, 0, -6.55), new V3(4.9, 0, -6.55)); railLine(new V3(5.95, 0, -4.55), new V3(5.95, 0, -6.1));
    }
    { // sunroom: white frame, glass walls and a sloped glass roof leaning on the house
      const x0 = -5.6, x1 = 0.4, z0 = -8.0, z1 = -HZ, h0 = 2.5, h1 = 3.0;
      b.add('sun', m.deckwood, B3(x0, x1, -0.1, 0.02, z0, z1));
      const fr = [];
      for (let x = x0; x <= x1 + 1e-3; x += 1.0) { fr.push(B3(x - 0.05, x + 0.05, 0, h0, z0 - 0.05, z0 + 0.05)); }
      for (let z = z0; z <= z1 + 1e-3; z += 0.875) { fr.push(B3(x0 - 0.05, x0 + 0.05, 0, h0, z - 0.05, z + 0.05)); fr.push(B3(x1 - 0.05, x1 + 0.05, 0, h0, z - 0.05, z + 0.05)); }
      fr.push(B3(x0 - 0.06, x1 + 0.06, h0 - 0.06, h0 + 0.06, z0 - 0.06, z0 + 0.06));
      fr.push(B3(x0 - 0.06, x1 + 0.06, 0.45, 0.55, z0 - 0.06, z0 + 0.06));
      for (const x of [x0, x1]) fr.push(B3(x - 0.06, x + 0.06, h0 - 0.06, h0 + 0.06, z0, z1), B3(x - 0.06, x + 0.06, 0.45, 0.55, z0, z1));
      const slope = Math.atan2(h1 - h0, z1 - z0), L = Math.hypot(z1 - z0, h1 - h0);
      for (let x = x0; x <= x1 + 1e-3; x += 1.0) b.add('sunroof', m.trim, tf(box(0.08, 0.1, L), { rx: -slope, x, y: (h0 + h1) / 2 + 0.05, z: (z0 + z1) / 2 }));
      for (const q of fr) b.add('sun', m.trim, q);
      b.add('sun', m.glass, B3(x0, x1, 0.55, h0, z0 - 0.01, z0 + 0.01), false);
      b.add('sun', m.glass, B3(x0 - 0.01, x0 + 0.01, 0.55, h0, z0, z1), false);
      b.add('sun', m.glass, B3(x1 - 0.01, x1 + 0.01, 0.55, h0, z0, z1), false);
      b.add('sunroof', m.glass, tf(box(x1 - x0, 0.02, L), { rx: -slope, x: (x0 + x1) / 2, y: (h0 + h1) / 2 + 0.1, z: (z0 + z1) / 2 }), false);
      b.add('sun', m.trim, B3(x0, x1, 0.02, 0.45, z0 - 0.04, z0 + 0.04)); // knee wall
    }
  }
  // ---------------------------------------------------------------- rooms
  buildInterior() {
    const b = this.B, m = this.m; const f0 = 'i0', f1 = 'i1', f2 = 'i2';
    const add = (p, mat, g, uv = 0.5) => { boxUV(g, uv); b.add(p, mat, g); };
    this.blocks = [[], [], []];
    const blk = (f, x0, x1, z0, z1) => this.blocks[f].push([x0, x1, z0, z1]);
    // ---------------- ground floor
    const y = FY[0];
    // fireplace: a stone chimney breast with the firebox, hearth and a wooden mantel; the TV hangs above
    add(f0, m.stone, B3(5.35, HX - 0.1, y, FY[1] - 0.22, -0.85, 0.85));
    add(f0, m.black, B3(5.33, 5.4, y + 0.12, y + 0.92, -0.55, 0.55));
    add(f0, m.stone, B3(4.8, 5.9, y, y + 0.1, -1.0, 1.0));
    add(f0, m.darkwood, B3(5.2, 5.45, y + 1.18, y + 1.3, -0.95, 0.95));
    add(f0, m.brick, B3(5.4, 5.8, y + 0.12, y + 0.95, -0.52, 0.52)); // firebox back
    blk(0, 5.25, 6, -0.9, 0.9);
    this.firePos = new V3(5.6, y + 0.3, 0);
    // logs
    for (const [dz, r] of [[-0.18, 0.2], [0.14, -0.15]]) b.add(f0, m.darkwood, cyl(0.07, 0.07, 0.62, 8, { x: 5.6, y: y + 0.2, z: dz, rx: Math.PI / 2, ry: r }));
    // TV on the chimney breast
    add(f0, m.black, B3(5.3, 5.35, y + 1.5, y + 2.25, -0.68, 0.68));
    const scr = new THREE.PlaneGeometry(1.26, 0.66); scr.rotateY(-Math.PI / 2); scr.translate(5.295, y + 1.875, 0);
    this.tvMat = new THREE.ShaderMaterial({
      uniforms: { uTime: U.uTime, uOn: { value: 0 } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: /* glsl */`
        uniform float uTime, uOn; varying vec2 vUv;
        float h(float x){ return fract(sin(x*127.1)*43758.5); }
        void main(){
          vec2 p = vUv; float t = uTime;
          // a gentle nature film: sunset sky, drifting hills, a sailboat crossing the water
          vec3 sky = mix(vec3(0.98,0.62,0.35), vec3(0.25,0.35,0.7), p.y);
          float sun = smoothstep(0.1, 0.09, length((p - vec2(0.7, 0.55)) * vec2(1.9,1.0)));
          vec3 c = sky + sun * vec3(1.0,0.85,0.5);
          float hill = 0.42 + 0.06*sin(p.x*9.0 + t*0.2) + 0.03*sin(p.x*23.0 - t*0.3);
          c = mix(c, vec3(0.2,0.3,0.25), step(p.y, hill));
          float water = step(p.y, 0.3);
          vec3 wc = mix(vec3(0.15,0.25,0.45), vec3(0.9,0.55,0.35), 0.4 + 0.3*sin(p.y*120.0 + t*3.0 + p.x*20.0));
          c = mix(c, wc, water);
          float bx = fract(t*0.03) * 1.4 - 0.2; vec2 q = p - vec2(bx, 0.33);
          float hull = step(abs(q.x), 0.05) * step(-0.015, q.y) * step(q.y, 0.0);
          float sail = step(0.0, q.y) * step(q.y, 0.1 - abs(q.x + 0.01)*1.6) * step(abs(q.x+0.01), 0.05);
          c = mix(c, vec3(0.1), hull); c = mix(c, vec3(0.97), sail);
          c *= 0.85 + 0.15*h(floor(t*24.0));
          vec3 off = vec3(0.02,0.022,0.025);
          gl_FragColor = vec4(mix(off, c * 1.6, uOn), 1.0);
        }`,
    });
    const tv = new THREE.Mesh(scr, this.tvMat); this.floors[0].group.add(tv); this.tvScreen = tv;
    this.tvPos = new V3(5.3, y + 1.9, 0);
    // sofa facing the fire, coffee table, rug, reading lamp, armchair
    b.add(f0, m.rug, B3(2.0, 5.0, y + 0.012, y + 0.028, -1.6, 1.6), false);
    add(f0, m.sofa, B3(2.15, 3.05, y + 0.1, y + 0.45, -1.1, 1.1)); add(f0, m.sofa, B3(2.1, 2.35, y + 0.1, y + 0.95, -1.15, 1.15));
    add(f0, m.sofa, B3(2.1, 3.05, y + 0.1, y + 0.65, -1.25, -1.05)); add(f0, m.sofa, B3(2.1, 3.05, y + 0.1, y + 0.65, 1.05, 1.25));
    for (const z of [-0.55, 0.55]) add(f0, m.sofa, rbox(0.8, 0.14, 1.0, 0.05, { x: 2.7, y: y + 0.52, z }));
    for (const z of [-0.8, 0.8]) add(f0, m.cushion, rbox(0.14, 0.4, 0.4, 0.06, { x: 2.45, y: y + 0.78, z, rz: -0.2 }));
    blk(0, 2.1, 3.05, -1.25, 1.25);
    add(f0, m.darkwood, B3(3.35, 4.0, y + 0.36, y + 0.42, -0.45, 0.45)); for (const [sx, sz] of [[3.4, -0.4], [3.95, -0.4], [3.4, 0.4], [3.95, 0.4]]) add(f0, m.darkwood, B3(sx - 0.03, sx + 0.03, y, y + 0.36, sz - 0.03, sz + 0.03));
    blk(0, 3.35, 4.0, -0.45, 0.45);
    add(f0, m.darkwood, B3(1.6, 1.9, y, y + 0.55, 1.5, 1.8)); b.add(f0, m.lampShade, cyl(0.16, 0.22, 0.28, 14, { x: 1.75, y: y + 1.2 })); b.add(f0, m.steel, cyl(0.012, 0.012, 0.6, 5, { x: 1.75, y: y + 0.85 }));
    // armchair by the front window
    add(f0, m.cushion, B3(4.2, 5.0, y + 0.1, y + 0.45, -3.7, -2.9)); add(f0, m.cushion, B3(4.2, 5.0, y + 0.1, y + 0.95, -3.95, -3.7));
    blk(0, 4.2, 5.0, -3.95, -2.9);
    // plant
    this.plant(f0, new V3(1.2, y, -3.9), 1.0);
    // dining table with four chairs in the front-left, opening to the sunroom
    add(f0, m.lightwood, B3(-3.9, -2.1, y + 0.72, y + 0.77, -2.45, -1.55));
    for (const [sx, sz] of [[-3.85, -2.4], [-2.15, -2.4], [-3.85, -1.6], [-2.15, -1.6]]) add(f0, m.lightwood, B3(sx - 0.03, sx + 0.03, y, y + 0.72, sz - 0.03, sz + 0.03));
    for (const [cxp, czp, fz] of [[-3.4, -2.75, -1], [-2.6, -2.75, -1], [-3.4, -1.25, 1], [-2.6, -1.25, 1]]) this.chair(f0, cxp, y, czp, fz);
    blk(0, -4.0, -2.0, -2.95, -1.05);
    // kitchen: counters along the back and left walls, stove, sink, fridge, island with stools, pendant lamps
    add(f0, m.cabinet, B3(-5.9, -1.55, y, y + 0.88, 3.85, 4.4)); add(f0, m.counter, B3(-5.92, -1.53, y + 0.88, y + 0.92, 3.8, 4.42));
    add(f0, m.cabinet, B3(-5.9, -5.35, y, y + 0.88, 0.8, 3.85)); add(f0, m.counter, B3(-5.92, -5.3, y + 0.88, y + 0.92, 0.78, 3.85));
    add(f0, m.cabinet, B3(-5.9, -1.55, y + 1.55, y + 2.3, 4.05, 4.4)); // wall cupboards
    for (let x = -5.6; x < -1.8; x += 0.62) add(f0, m.steel, B3(x, x + 0.14, y + 0.72, y + 0.74, 3.83, 3.85));
    blk(0, -5.95, -1.5, 3.8, 4.5); blk(0, -6, -5.3, 0.78, 3.85);
    // stove (between x -3.8..-3.0) with a pot, and the sink under the left window
    add(f0, m.black, B3(-3.85, -2.95, y + 0.92, y + 0.94, 3.85, 4.35));
    for (const [sx, sz] of [[-3.62, 3.98], [-3.18, 3.98], [-3.62, 4.22], [-3.18, 4.22]]) b.add(f0, m.steel, cyl(0.09, 0.09, 0.012, 16, { x: sx, y: y + 0.945, z: sz }));
    b.add(f0, m.steel, cyl(0.13, 0.12, 0.16, 16, { x: -3.62, y: y + 1.03, z: 3.98 })); this.potPos = new V3(-3.62, y + 1.12, 3.98);
    add(f0, m.steel, B3(-5.85, -5.4, y + 0.8, y + 0.9, 1.7, 2.5)); b.add(f0, m.steel, tube([new V3(-5.8, y + 0.92, 2.1), new V3(-5.8, y + 1.2, 2.1), new V3(-5.62, y + 1.24, 2.1)], [0.015, 0.015, 0.015], 6));
    add(f0, m.steel, B3(-1.5, -0.72, y, y + 1.95, 3.75, 4.4)); add(f0, m.black, B3(-1.45, -1.43, y + 0.9, y + 1.6, 3.73, 3.75));
    blk(0, -1.52, -0.7, 3.7, 4.45);
    add(f0, m.cabinet, B3(-3.6, -2.0, y, y + 0.9, 1.65, 2.45)); add(f0, m.counter, B3(-3.65, -1.95, y + 0.9, y + 0.94, 1.6, 2.5));
    blk(0, -3.65, -1.95, 1.6, 2.5);
    for (const x of [-3.2, -2.4]) { b.add(f0, m.darkwood, cyl(0.17, 0.17, 0.05, 12, { x, y: y + 0.66, z: 1.25 })); b.add(f0, m.steel, cyl(0.02, 0.02, 0.64, 5, { x, y: y + 0.32, z: 1.25 })); }
    for (const x of [-3.2, -2.4]) { b.add(f0, m.lampShade, cyl(0.1, 0.16, 0.18, 12, { x, y: y + 2.2, z: 2.05 })); b.add(f0, m.black, cyl(0.006, 0.006, 0.7, 4, { x, y: y + 2.62, z: 2.05 })); }
    // fruit bowl on the island
    b.add(f0, m.lightwood, cyl(0.16, 0.1, 0.07, 12, { x: -2.8, y: y + 0.975, z: 2.05 }));
    for (let i = 0; i < 5; i++) b.add(f0, i % 2 ? this.m.cushion : this.m.pot, sph(0.045, 8, 6, { x: -2.8 + Math.cos(i * 1.3) * 0.07, y: y + 1.03, z: 2.05 + Math.sin(i * 1.3) * 0.07 }));
    // stairs up the back wall: flight A (ground to first floor) rising along +x, flight B turning back
    this.stairs(f0, 'A', 0.8, 5.0, 3.35, 4.35, FY[0], FY[1]);
    this.stairs(f1, 'B', 5.0, 0.8, 2.25, 3.25, FY[1], FY[2]);
    // cupboard under flight A
    add(f0, m.wallIn, B3(1.6, 5.0, y, y + 1.9, 3.33, 3.37)); add(f0, m.darkwood, B3(3.0, 3.8, y + 0.02, y + 1.6, 3.31, 3.33));
    // (no blocker for the cupboard: the wall along z 3.33 and the floor hole under flight A keep him out, and a box here would stop him climbing)
    // sunroom furniture: two wicker chairs, a side table, potted plants
    for (const x of [-4.2, -1.8]) { add(f0, m.lightwood, B3(x - 0.4, x + 0.4, y + 0.02, y + 0.42, -7.3, -6.5)); add(f0, m.lightwood, B3(x - 0.4, x + 0.4, y + 0.02, y + 0.95, -7.5, -7.3)); add(f0, m.cushion, B3(x - 0.36, x + 0.36, y + 0.42, y + 0.5, -7.28, -6.55)); blk(0, x - 0.42, x + 0.42, -7.55, -6.45); }
    add(f0, m.lightwood, B3(-3.3, -2.7, y + 0.45, y + 0.5, -7.2, -6.6)); add(f0, m.lightwood, B3(-3.05, -2.95, y, y + 0.45, -6.95, -6.85));
    for (const [px, pz, s] of [[-5.2, -7.6, 1.3], [0.0, -7.6, 1.0], [-5.2, -5.0, 0.9]]) { this.plant(f0, new V3(px, y, pz), s); blk(0, px - 0.3, px + 0.3, pz - 0.3, pz + 0.3); }
    // ---------------- first floor: bedroom, office, bathroom
    const y1 = FY[1];
    // partitions
    // partitions go in their own part (origin at the floor) so they can be lowered in the cutaway view
    const pw = (list, mat) => { for (const g of list) { g.translate(0, -y1, 0); add('p1', mat, g); } };
    pw(wallGeo('x', 2.1, 0, 5.0, y1, FY[2] - 0.22, 0.12), m.wallIn);
    pw(wallGeo('z', 0, -HZ + 0.1, 2.1, y1, FY[2] - 0.22, 0.12, [[-1.5, -0.6, y1, y1 + 2.15]]), m.wallIn);
    pw(wallGeo('x', 0.4, -HX + 0.1, -2.0, y1, FY[2] - 0.22, 0.12, [[-3.0, -2.2, y1, y1 + 2.15]]), m.wallBath);
    pw(wallGeo('z', -2.0, 0.4, HZ - 0.1, y1, FY[2] - 0.22, 0.12), m.wallBath);
    // bathroom tiles on the outer walls
    add('w1left', m.wallBath, B3(-5.88, -5.86, y1, y1 + 2.9, 0.45, 4.4), 1); add('w1back', m.wallBath, B3(-5.9, -2.05, y1, y1 + 2.9, 4.37, 4.39), 1);
    // bed with headboard against the partition, facing the river windows
    add(f1, m.darkwood, B3(2.35, 4.25, y1, y1 + 0.35, -0.1, 2.0)); add(f1, m.darkwood, B3(2.3, 4.3, y1, y1 + 1.15, 1.93, 2.03));
    add(f1, m.linen, rbox(1.8, 0.2, 2.0, 0.08, { x: 3.3, y: y1 + 0.45, z: 0.95 }));
    add(f1, m.duvet, rbox(1.86, 0.1, 1.35, 0.05, { x: 3.3, y: y1 + 0.58, z: 0.55 }));
    for (const x of [2.85, 3.75]) add(f1, m.linen, rbox(0.6, 0.14, 0.38, 0.06, { x, y: y1 + 0.62, z: 1.7 }));
    blk(1, 2.3, 4.3, -0.15, 2.05);
    for (const x of [1.95, 4.65]) { add(f1, m.darkwood, B3(x - 0.25, x + 0.25, y1, y1 + 0.55, 1.55, 2.0)); b.add(f1, m.lampShade, cyl(0.09, 0.13, 0.2, 12, { x, y: y1 + 0.75, z: 1.78 })); b.add(f1, m.steel, cyl(0.01, 0.01, 0.15, 5, { x, y: y1 + 0.6, z: 1.78 })); blk(1, x - 0.26, x + 0.26, 1.5, 2.05); }
    add(f1, m.rug, B3(2.1, 4.5, y1 + 0.012, y1 + 0.028, -1.6, 0.0), 0.3);
    // wardrobe
    add(f1, m.darkwood, B3(0.1, 0.72, y1, y1 + 2.1, 0.3, 1.9)); add(f1, m.black, B3(0.72, 0.74, y1 + 0.1, y1 + 2.0, 1.09, 1.11)); blk(1, 0.05, 0.75, 0.25, 1.95);
    // armchair by the window
    add(f1, m.sofa, B3(4.8, 5.6, y1 + 0.1, y1 + 0.45, -3.9, -3.1)); add(f1, m.sofa, B3(4.8, 5.6, y1 + 0.1, y1 + 0.95, -4.1, -3.9)); blk(1, 4.75, 5.65, -4.15, -3.05);
    // office: desk by the window, bookshelf, chair
    add(f1, m.lightwood, B3(-4.1, -1.9, y1 + 0.72, y1 + 0.76, -4.35, -3.7)); for (const x of [-4.05, -1.95]) add(f1, m.lightwood, B3(x - 0.03, x + 0.03, y1, y1 + 0.72, -4.3, -3.75));
    this.chair(f1, -3.0, y1, -3.3, 1); blk(1, -4.15, -1.85, -4.4, -3.05);
    add(f1, m.darkwood, B3(-5.95, -5.6, y1, y1 + 2.0, -3.6, -0.6)); { const bk = new THREE.PlaneGeometry(2.9, 1.9); bk.rotateY(Math.PI / 2); bk.translate(-5.59, y1 + 1.0, -2.1); ensureColor(bk); b.add(f1, m.books, bk, false); }
    blk(1, -6, -5.55, -3.65, -0.55);
    add(f1, m.darkwood, B3(-1.95, 0.75, y1, y1 + 1.8, 4.05, 4.45)); { const bk = new THREE.PlaneGeometry(2.6, 1.7); bk.translate(-0.6, y1 + 0.95, 4.04); bk.rotateY(Math.PI); bk.translate(-1.2, 0, 8.08); ensureColor(bk); b.add(f1, m.books, bk, false); }
    blk(1, -2, 0.8, 4.0, 4.5);
    // bathroom: tub, toilet, vanity with mirror, towel
    add(f1, m.porcelain, B3(-5.9, -4.2, y1, y1 + 0.55, 3.72, 4.4)); add(f1, m.water, B3(-5.8, -4.3, y1 + 0.46, y1 + 0.47, 3.82, 4.3));
    b.add(f1, m.steel, tube([new V3(-5.85, y1 + 0.55, 4.05), new V3(-5.85, y1 + 0.8, 4.05), new V3(-5.7, y1 + 0.82, 4.05)], [0.015, 0.015, 0.015], 6));
    blk(1, -5.95, -4.15, 3.68, 4.5);
    b.add(f1, m.porcelain, cyl(0.19, 0.16, 0.42, 14, { x: -3.4, y: y1 + 0.21, z: 4.05 })); add(f1, m.porcelain, B3(-3.62, -3.18, y1 + 0.4, y1 + 0.78, 4.28, 4.42)); blk(1, -3.65, -3.15, 3.8, 4.45);
    add(f1, m.lightwood, B3(-5.9, -5.4, y1, y1 + 0.82, 1.0, 2.0)); add(f1, m.counter, B3(-5.92, -5.35, y1 + 0.82, y1 + 0.86, 0.98, 2.02));
    b.add(f1, m.porcelain, cyl(0.17, 0.12, 0.08, 16, { x: -5.62, y: y1 + 0.89, z: 1.5 })); b.add(f1, m.steel, tube([new V3(-5.88, y1 + 0.9, 1.5), new V3(-5.88, y1 + 1.12, 1.5), new V3(-5.72, y1 + 1.14, 1.5)], [0.012, 0.012, 0.012], 6));
    add('w1left', m.mirror, B3(-5.85, -5.83, y1 + 1.15, y1 + 2.05, 1.05, 1.95)); blk(1, -5.95, -5.35, 0.95, 2.05);
    this.sinkPos = new V3(-5.62, y1 + 1.05, 1.5);
    add(f1, m.duvet, B3(-2.12, -2.08, y1 + 0.9, y1 + 1.5, 2.2, 2.7));
    // railing around the stairwell on the first floor
    this.railLine(new V3(0.8, y1, 3.35), new V3(5.0, y1, 3.35), f1); this.railLine(new V3(0.8, y1, 3.35), new V3(0.8, y1, 4.35), f1);
    // ---------------- second floor: study under the roof with a balcony
    const y2 = FY[2];
    add(f2, m.darkwood, B3(-5.0, 0.5, y2, y2 + 2.2, 4.05, 4.45)); { const bk = new THREE.PlaneGeometry(5.3, 2.05); bk.rotateY(Math.PI); bk.translate(-2.25, y2 + 1.1, 4.04); ensureColor(bk); b.add(f2, m.books, bk, false); }
    blk(2, -5.05, 0.55, 4.0, 4.5);
    add(f2, m.rug, B3(-5.0, -1.0, y2 + 0.012, y2 + 0.028, -2.8, 0.6), 0.3);
    for (const [x, z, r] of [[-4.2, -1.6, 0.6], [-2.4, -0.4, -0.7]]) { const g = new THREE.Group(); this.armchair(f2, x, y2, z, r); blk(2, x - 0.5, x + 0.5, z - 0.5, z + 0.5); }
    add(f2, m.darkwood, B3(-3.6, -3.0, y2 + 0.45, y2 + 0.5, -1.2, -0.6)); add(f2, m.darkwood, B3(-3.33, -3.27, y2, y2 + 0.45, -0.93, -0.87));
    add(f2, m.lightwood, B3(2.2, 4.4, y2 + 0.72, y2 + 0.76, -4.35, -3.7)); for (const x of [2.25, 4.35]) add(f2, m.lightwood, B3(x - 0.03, x + 0.03, y2, y2 + 0.72, -4.3, -3.75)); this.chair(f2, 3.3, y2, -3.3, 1); blk(2, 2.15, 4.45, -4.4, -3.05);
    b.add(f2, m.lampShade, cyl(0.1, 0.15, 0.2, 12, { x: 4.0, y: y2 + 0.95, z: -4.0 }));
    this.plant(f2, new V3(-5.4, y2, -3.9), 1.1); blk(2, -5.7, -5.1, -4.2, -3.6);
    // cat bed by the bookshelves
    b.add(f2, m.cushion, cyl(0.32, 0.3, 0.12, 16, { x: 1.3, y: y2 + 0.06, z: 3.9 }));
    // railing around the stairwell opening
    this.railLine(new V3(0.8, y2, 2.25), new V3(5.0, y2, 2.25), f2); this.railLine(new V3(0.8, y2, 3.25), new V3(5.0, y2, 3.25), f2); this.railLine(new V3(5.0, y2, 2.25), new V3(5.0, y2, 3.25), f2);
    // balcony with a telescope
    { add(f2, m.deckwood, B3(-2.0, 2.5, y2 - 0.12, y2, -5.9, -HZ)); for (const x of [-1.95, 2.45]) add(f2, m.trim, B3(x - 0.06, x + 0.06, y2 - 0.9, y2, -5.87, -5.75));
      this.railLine(new V3(-1.95, y2, -4.55), new V3(-1.95, y2, -5.85), f2); this.railLine(new V3(-1.95, y2, -5.85), new V3(2.45, y2, -5.85), f2); this.railLine(new V3(2.45, y2, -5.85), new V3(2.45, y2, -4.55), f2);
      // telescope: tripod and tube pointing out over the river
      const tp = new V3(1.4, y2, -5.3); this.scopePos = tp.clone();
      for (let i = 0; i < 3; i++) { const a = i * 2.094; b.add(f2, m.black, tube([new V3(tp.x + Math.cos(a) * 0.35, y2, tp.z + Math.sin(a) * 0.35), new V3(tp.x, y2 + 1.1, tp.z)], [0.015, 0.015], 5)); }
      const tube1 = cyl(0.06, 0.07, 0.9, 12); tube1.rotateX(Math.PI / 2 - 0.35); tube1.translate(tp.x, y2 + 1.25, tp.z - 0.1); b.add(f2, m.steel, tube1);
      blk(2, tp.x - 0.3, tp.x + 0.3, tp.z - 0.35, tp.z + 0.35);
    }
  }
  stairs(part, name, xa, xb, z0, z1, ya, yb) {
    const b = this.B, m = this.m; const n = 15; const dir = Math.sign(xb - xa); const run = Math.abs(xb - xa) / n, rise = (yb - ya) / n;
    for (let i = 0; i < n; i++) {
      const x0 = xa + dir * i * run, x1 = x0 + dir * run; const yt = ya + (i + 1) * rise;
      b.add(part, m.darkwood, B3(Math.min(x0, x1), Math.max(x0, x1) + 0.02, yt - 0.05, yt, z0, z1));
      b.add(part, m.trim, B3(Math.min(x0, x1) - (dir > 0 ? 0 : 0) , Math.min(x0, x1) + 0.02, yt - rise, yt - 0.05, z0, z1));
    }
    // stringers and a handrail on the open side
    const L = Math.hypot(xb - xa, yb - ya), ang = Math.atan2(yb - ya, xb - xa);
    for (const z of [z0 + 0.03, z1 - 0.03]) { const g = box(L, 0.28, 0.05); g.rotateZ(ang); g.translate((xa + xb) / 2, (ya + yb) / 2 - 0.08, z); b.add(part, m.trim, g); }
    const hr = box(L, 0.05, 0.06); hr.rotateZ(ang); hr.translate((xa + xb) / 2, (ya + yb) / 2 + 0.9, z0 + 0.03); b.add(part, m.darkwood, hr);
    for (let i = 1; i < n; i += 2) { const x = xa + dir * i * run; const yy = ya + i * rise; b.add(part, m.trim, B3(x - 0.02, x + 0.02, yy, yy + 0.9, z0 + 0.01, z0 + 0.05)); }
  }
  chair(part, x, y, z, fz) {
    const b = this.B, m = this.m;
    b.add(part, m.lightwood, B3(x - 0.22, x + 0.22, y + 0.43, y + 0.47, z - 0.22, z + 0.22));
    for (const [sx, sz] of [[-0.19, -0.19], [0.19, -0.19], [-0.19, 0.19], [0.19, 0.19]]) b.add(part, m.lightwood, B3(x + sx - 0.02, x + sx + 0.02, y, y + 0.43, z + sz - 0.02, z + sz + 0.02));
    b.add(part, m.lightwood, B3(x - 0.22, x + 0.22, y + 0.47, y + 0.95, z + fz * 0.2 - 0.02, z + fz * 0.2 + 0.02));
  }
  armchair(part, x, y, z, r) {
    const b = this.B, m = this.m; const o = { x, y, z, ry: r };
    b.add(part, m.sofa, tf(B3(-0.42, 0.42, 0.1, 0.45, -0.4, 0.4), o)); b.add(part, m.sofa, tf(B3(-0.45, 0.45, 0.1, 0.95, 0.35, 0.5), o));
    for (const sx of [-1, 1]) b.add(part, m.sofa, tf(B3(sx * 0.42 - 0.07, sx * 0.42 + 0.07, 0.1, 0.62, -0.4, 0.45), o));
  }
  plant(part, p, s = 1) {
    const b = this.B, m = this.m;
    b.add(part, m.pot, cyl(0.16 * s, 0.12 * s, 0.3 * s, 12, { x: p.x, y: p.y + 0.15 * s, z: p.z }));
    for (let i = 0; i < 9; i++) { const a = i * 2.4, h = (0.35 + (i % 3) * 0.18) * s; const lf = new THREE.PlaneGeometry(0.12 * s, 0.55 * s); lf.translate(0, 0.27 * s, 0); lf.rotateX(-0.5 - (i % 3) * 0.15); lf.rotateY(a); lf.translate(p.x, p.y + 0.28 * s, p.z); ensureColor(lf); b.add(part, m.leaf, lf, false); }
  }
  // ---------------------------------------------------------------- stair down the bluff and the private dock
  buildOutside() {
    const b = this.B, m = this.m;
    // flights in house-local coordinates: porch -> landing -> shore, then the dock (all local)
    const F = frame(HOME.s);
    const dockW = (s, e, y) => this.toLocal(...(() => { const [x, z] = fromSD(s, -(hwL(s) + e)); return [x, y, z]; })());
    this.flights = [
      { a: new V3(5.4, 0, -6.9), b: new V3(13.2, -4.45, -10.7), w: 1.25 },
      { a: new V3(12.6, -4.45, -12.2), b: new V3(6.4, -8.85, -16.3), w: 1.25 },
    ];
    this.landing = { x0: 12.6, x1: 15.0, z0: -12.9, z1: -10.1, y: -4.45 };
    const stepsOf = (fl) => {
      const L = Math.hypot(fl.b.x - fl.a.x, fl.b.z - fl.a.z), rise = fl.a.y - fl.b.y, n = Math.round(rise / 0.18);
      const dir = new V3(fl.b.x - fl.a.x, 0, fl.b.z - fl.a.z).normalize(); const yaw = Math.atan2(dir.x, dir.z);
      for (let i = 0; i < n; i++) {
        const t = (i + 0.5) / n; const c = fl.a.clone().lerp(fl.b, t); const yy = fl.a.y - (i + 1) * rise / n + 0.0;
        const g = box(fl.w, 0.06, L / n + 0.03, {}); g.rotateY(yaw); g.translate(c.x, yy + rise / n, c.z); boxUV(g, 0.5); b.add('out', m.deckwood, g);
      }
      // stringers, posts to the ground and handrails on both sides
      const side = new V3(dir.z, 0, -dir.x);
      for (const sg of [-1, 1]) {
        const a = fl.a.clone().addScaledVector(side, sg * fl.w / 2), bb = fl.b.clone().addScaledVector(side, sg * fl.w / 2);
        b.add('out', m.darkwood, tfLine(a.clone().setY(a.y - 0.1), bb.clone().setY(bb.y - 0.1), 0.07));
        b.add('out', m.rail, tfLine(a.clone().setY(a.y + 0.95), bb.clone().setY(bb.y + 0.95), 0.05));
        for (let i = 0; i <= 5; i++) { const p = a.clone().lerp(bb, i / 5); const gW = this.toWorld(p.x, 0, p.z); const gy = groundAt(gW.x, gW.z) - this.y0; b.add('out', m.darkwood, B3(p.x - 0.05, p.x + 0.05, Math.min(gy, p.y) - 0.3, p.y + 0.95, p.z - 0.05, p.z + 0.05)); }
      }
    };
    this.flights.forEach(stepsOf);
    { const L = this.landing; b.add('out', m.deckwood, B3(L.x0, L.x1, L.y - 0.1, L.y, L.z0, L.z1));
      for (const [x, z] of [[L.x0 + 0.1, L.z0 + 0.1], [L.x1 - 0.1, L.z0 + 0.1], [L.x0 + 0.1, L.z1 - 0.1], [L.x1 - 0.1, L.z1 - 0.1]]) { const gW = this.toWorld(x, 0, z); const gy = groundAt(gW.x, gW.z) - this.y0; b.add('out', m.darkwood, B3(x - 0.06, x + 0.06, gy - 0.3, L.y + 0.95, z - 0.06, z + 0.06)); }
      b.add('out', m.rail, tfLine(new V3(L.x1, L.y + 0.95, L.z0), new V3(L.x1, L.y + 0.95, L.z1), 0.05)); b.add('out', m.rail, tfLine(new V3(L.x0, L.y + 0.95, L.z0), new V3(L.x1, L.y + 0.95, L.z0), 0.05)); }
    // the dock: a pier out from the shore and a T-head along the river, on pilings
    const dy = 0.75 - this.y0;
    this.pier = { x0: 5.8, x1: 7.0, z0: -26.0, z1: -15.8, y: dy };
    this.thead = { x0: 1.8, x1: 11.0, z0: -27.6, z1: -26.0, y: dy };
    for (const P of [this.pier, this.thead]) {
      const g = B3(P.x0, P.x1, P.y - 0.1, P.y, P.z0, P.z1); boxUV(g, 0.5); b.add('out', m.deckwood, g);
      for (let x = P.x0 + 0.1; x <= P.x1 - 0.05; x += Math.max(1.0, (P.x1 - P.x0 - 0.2) / Math.max(1, Math.round((P.x1 - P.x0) / 2)))) for (let z = P.z0 + 0.1; z <= P.z1 - 0.05; z += 2.0) b.add('out', m.darkwood, cyl(0.1, 0.1, 3.6, 8, { x, y: P.y - 1.8, z }));
    }
    // cleats and a lantern post at the end of the T-head
    for (const x of [3.0, 9.8]) b.add('out', m.steel, B3(x - 0.15, x + 0.15, dy, dy + 0.06, -27.45, -27.4));
    b.add('out', m.darkwood, B3(10.8, 10.95, dy, dy + 1.3, -26.2, -26.05)); b.add('out', m.lampShade, cyl(0.08, 0.1, 0.18, 10, { x: 10.87, y: dy + 1.42, z: -26.12 }));
    addLight(this.toWorld(10.87, dy + 1.45, -26.12), 0xffc27a, 9, 1.2, { kind: 'dock' });
    // for the boat: the dock as obstacles in river coordinates
    for (const P of [this.pier, this.thead]) {
      const c = this.toWorld((P.x0 + P.x1) / 2, 0, (P.z0 + P.z1) / 2); const q = toSD(c.x, c.z);
      // local x runs along -s, local z along -d on this bank
      addObstacle({ s: q.s, d: q.d, rs: (P.x1 - P.x0) / 2 + 0.1, rd: (P.z1 - P.z0) / 2 + 0.1, kind: 'dock', stop: 'home', foam: 0.1 });
    }
    // berth: along the outer face of the T-head, bow upstream, dock to port
    const bc = this.toWorld(6.4, 0, -27.6 - 0.3 - 1.15);
    this.berth = { p: new V3(bc.x, 0, bc.z), psi: F.th };
    this.landP = this.toWorld(6.4, dy, -26.55);
    // garden: a bench and flower beds on the terrace behind the house, a path of stepping stones to the porch
    b.add('out', m.darkwood, B3(-2.0, 2.0, -0.35 + 0.0, -0.3, 6.2, 6.7)); for (const x of [-1.8, 1.8]) b.add('out', m.darkwood, B3(x - 0.04, x + 0.04, -0.35 - 0.45, -0.35, 6.3, 6.6));
    for (let i = 0; i < 26; i++) { const x = -5 + (i % 13) * 0.8, z = i < 13 ? 5.6 : 7.4; const c = [0xd84a6a, 0xf0c040, 0xf4f1ea, 0x9a6ad8][i % 4]; this.flowerM = this.flowerM || {}; const fm = this.flowerM[c] || (this.flowerM[c] = std({ color: c, roughness: 0.8 }, { wet: 0.5 })); b.add('out', fm, sph(0.16, 8, 6, { x, y: -0.3, z }), false); }
    this.far = new THREE.Group(); this.far.visible = false; this.g.add(this.far);
    this.B.build(this.groupsFor(), this.far);
  }
  groupsFor() {
    const G = {};
    G.out = this.outside; G.roof = this.roof; G.chim = this.outside; G.sun = this.floors[0].group; G.sunroof = this.sunroof = new THREE.Group(); this.floors[0].group.add(this.sunroof); G.trimOut = this.trimOut = new THREE.Group(); this.g.add(this.trimOut);
    for (let f = 0; f < 3; f++) { G['f' + f] = new THREE.Group(); G['i' + f] = new THREE.Group(); this.floors[f].group.add(G['f' + f], G['i' + f]); this.floors[f].slab = G['f' + f]; this.floors[f].inner = G['i' + f]; }
    for (let f = 0; f < 2; f++) { G['ceil' + f] = new THREE.Group(); this.floors[f + 1].group.add(G['ceil' + f]); }
    for (const fl of this.floors) for (const e of fl.ext) { G[e.part] = e.g = new THREE.Group(); fl.group.add(e.g); }
    G.p1 = this.parts1 = new THREE.Group(); this.parts1.position.y = FY[1]; this.floors[1].group.add(this.parts1);
    return G;
  }
  // ---------------------------------------------------------------- fire, smoke, lights, the front door, the cat
  buildLife() {
    const g = this.floors[0].group;
    // flames: crossed quads with a flickering flame shader
    const flameMat = new THREE.ShaderMaterial({
      uniforms: { uTime: U.uTime, uOn: { value: 1 } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: /* glsl */`
        uniform float uTime, uOn; varying vec2 vUv;
        float n(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f); float a=fract(sin(dot(i,vec2(12.9,78.2)))*43758.5), b=fract(sin(dot(i+vec2(1,0),vec2(12.9,78.2)))*43758.5), c=fract(sin(dot(i+vec2(0,1),vec2(12.9,78.2)))*43758.5), d=fract(sin(dot(i+vec2(1,1),vec2(12.9,78.2)))*43758.5); return mix(mix(a,b,f.x),mix(c,d,f.x),f.y); }
        void main(){
          vec2 p = vUv; float t = uTime;
          float w = n(vec2(p.x*6.0, p.y*4.0 - t*3.2)) * 0.6 + n(vec2(p.x*13.0, p.y*9.0 - t*5.5)) * 0.4;
          float shape = smoothstep(0.5, 0.0, abs(p.x - 0.5) + p.y*0.45) * smoothstep(0.0, 0.08, p.y);
          float f = clamp(shape * (w*1.4 - p.y*0.9), 0.0, 1.0);
          vec3 c = mix(vec3(1.0,0.3,0.05), vec3(1.0,0.85,0.4), f);
          gl_FragColor = vec4(c * f * 2.2 * uOn, 1.0);
        }`,
    });
    this.flameMat = flameMat;
    for (let i = 0; i < 3; i++) { const q = new THREE.PlaneGeometry(0.75, 0.62); q.translate(0, 0.31, 0); q.rotateY(i * 1.05 + 0.3); q.translate(this.firePos.x, FY[0] + 0.14, this.firePos.z); g.add(new THREE.Mesh(q, flameMat)); }
    this.fireLight = addLight(this.toWorld(this.firePos.x - 0.6, FY[0] + 0.7, 0), 0xff9a48, 8, 0, { kind: 'home', dyn: true });
    // room lights (on in the evening)
    this.roomLights = [[2.5, FY[0] + 2.4, -1.5], [-2.8, FY[0] + 2.4, 2.2], [-3.0, FY[0] + 2.2, -2.0], [3.2, FY[1] + 2.4, -1.2], [-4.0, FY[1] + 2.4, 2.4], [-2.0, FY[2] + 2.4, -1.0], [-2.5, FY[0] + 2.2, -6.2]]
      .map(([x, y, z]) => addLight(this.toWorld(x, y, z), 0xffd2a0, 9, 0, { kind: 'home', dyn: true }));
    // smoke puffs from the chimney
    const st = document.createElement('canvas'); st.width = st.height = 64; const sx = st.getContext('2d'); const gr = sx.createRadialGradient(32, 32, 2, 32, 32, 30); gr.addColorStop(0, 'rgba(235,235,235,0.55)'); gr.addColorStop(1, 'rgba(235,235,235,0)'); sx.fillStyle = gr; sx.fillRect(0, 0, 64, 64);
    const smTex = new THREE.CanvasTexture(st);
    this.smoke = Array.from({ length: 14 }, (_, i) => { const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: smTex, transparent: true, depthWrite: false, opacity: 0 })); this.g.add(s); return { s, t: i / 14 * 7 }; });
    // front door leaf, hinged at x = 2.4
    const leaf = new THREE.Group(); leaf.position.set(2.42, FY[0], -HZ);
    const dg = box(0.96, 2.26, 0.06, { x: 0.48, y: 1.13 }); boxUV(dg, 0.5);
    const door = new THREE.Mesh(dg, std({ color: 0x2f4a3a, roughness: 0.5 }, { wet: 0.6 })); door.castShadow = true; leaf.add(door);
    const knob = new THREE.Mesh(sph(0.035, 8, 6, { x: 0.85, y: 1.0, z: -0.05 }), this.m.steel); leaf.add(knob);
    this.g.add(leaf); this.door = leaf; this.doorA = 0;
    // the cat
    this.cat = makeCat(); g.add(this.cat.g);
    this.catState = { p: new V3(3.6, FY[0], 1.4), yaw: 1.2, mode: 'sit', t: 0, target: null, meowT: 6, purr: false };
    this.catSpots = [[4.4, 0.9, 'loaf'], [2.6, 0.2, 'sofa'], [-3.0, -6.1, 'loaf'], [-2.6, 1.2, 'sit'], [0.3, -1.0, 'sit'], [-1.0, -5.5, 'loaf']];
  }
  // ---------------------------------------------------------------- walking: surfaces, walls, blockers
  walk() {
    const R = (x0, x1, z0, z1, y, holes = []) => ({ x0, x1, z0, z1, y: typeof y === 'function' ? y : () => y, holes });
    this.surf = [
      R(-HX + 0.2, HX - 0.2, -HZ + 0.2, HZ - 0.2, FY[0], [[0.8, 6, 3.38, 4.5]]),
      R(-5.4, 0.2, -7.85, -HZ + 0.25, FY[0]), R(1.5, 5.9, -6.55, -HZ + 0.25, FY[0]),
      R(-HX + 0.2, HX - 0.2, -HZ + 0.2, HZ - 0.2, FY[1], [[0.8, 5.0, 3.3, 4.4], [0.0, 5.0, 2.2, 3.3]]),
      R(-HX + 0.2, HX - 0.2, -HZ + 0.2, HZ - 0.2, FY[2], [[0.8, 5.0, 2.2, 3.3]]), R(-1.85, 2.35, -5.75, -HZ + 0.25, FY[2]),
      R(0.8, 5.0, 3.4, 4.3, (x) => FY[0] + clamp((x - 0.8) / 4.2, 0, 1) * (FY[1] - FY[0])),
      R(0.8, 5.0, 2.3, 3.2, (x) => FY[1] + clamp((5.0 - x) / 4.2, 0, 1) * (FY[2] - FY[1])),
      R(this.landing.x0, this.landing.x1, this.landing.z0, this.landing.z1, this.landing.y),
      R(this.pier.x0 + 0.1, this.pier.x1 - 0.1, this.pier.z0, this.pier.z1 + 0.6, this.pier.y), R(this.thead.x0, this.thead.x1, this.thead.z0 + 0.1, this.thead.z1, this.thead.y),
    ];
    // walls as segments per floor (local x, z)
    const W = (x0, z0, x1, z1) => [x0, z0, x1, z1];
    const ring = (gaps, f) => {
      const segs = [];
      const side = (a0, a1, fixed, axis, gs) => { let a = a0; const g2 = gs.slice().sort((p, q) => p[0] - q[0]); for (const [u0, u1] of g2) { if (u0 > a) segs.push(axis === 'x' ? W(a, fixed, u0, fixed) : W(fixed, a, fixed, u0)); a = u1; } if (a < a1) segs.push(axis === 'x' ? W(a, fixed, a1, fixed) : W(fixed, a, fixed, a1)); };
      side(-HX, HX, -HZ, 'x', gaps.front || []); side(-HX, HX, HZ, 'x', []); side(-HZ, HZ, -HX, 'z', []); side(-HZ, HZ, HX, 'z', []);
      return segs;
    };
    this.walls = [
      [...ring({ front: [[-4.2, -1.2], [2.4, 3.4]] }), W(-5.6, -HZ, -5.6, -8), W(-5.6, -8, 0.4, -8), W(0.4, -8, 0.4, -HZ), W(1.45, -HZ, 1.45, -6.55), W(1.45, -6.55, 4.9, -6.55), W(5.95, -HZ, 5.95, -6.1), W(1.6, 3.33, 5.0, 3.33)],
      [...ring({}), W(0, 2.1, 5.0, 2.1), W(0, -HZ, 0, -1.5), W(0, -0.6, 0, 2.1), W(-HX, 0.4, -3.0, 0.4), W(-2.2, 0.4, -2.0, 0.4), W(-2.0, 0.4, -2.0, HZ), W(0.8, 3.35, 5.0, 3.35), W(0.8, 3.35, 0.8, 4.4)],
      [...ring({ front: [[-0.6, 0.9]] }), W(0.8, 2.25, 5.0, 2.25), W(0.8, 3.25, 5.0, 3.25), W(5.0, 2.25, 5.0, 3.25), W(-1.95, -HZ, -1.95, -5.85), W(-1.95, -5.85, 2.45, -5.85), W(2.45, -5.85, 2.45, -HZ)],
    ];
  }
  floorOf(yLocal) { return yLocal < FY[1] - 1.2 ? 0 : yLocal < FY[2] - 1.2 ? 1 : 2; }
  // walkable height (world y) near a world point, preferring the level closest to where he is now
  surfY(x, z, yCur) {
    const p = this.toLocal(x, 0, z), yc = yCur - this.y0; let best = null, bd = 1e9;
    const consider = (y) => { const d = Math.abs(y - yc); if (d < bd) { bd = d; best = y; } };
    for (const r of this.surf) {
      if (p.x < r.x0 || p.x > r.x1 || p.z < r.z0 || p.z > r.z1) continue;
      if (r.holes.some(([a, b, c, d]) => p.x > a && p.x < b && p.z > c && p.z < d)) continue;
      consider(r.y(p.x, p.z));
    }
    for (const fl of this.flights) {
      const ab = new V3(fl.b.x - fl.a.x, 0, fl.b.z - fl.a.z); const L2 = ab.lengthSq(); const ap = new V3(p.x - fl.a.x, 0, p.z - fl.a.z);
      const t = ap.dot(ab) / L2; if (t < -0.08 || t > 1.08) continue;
      const perp = ap.clone().addScaledVector(ab, -t).length(); if (perp > fl.w / 2 - 0.05) continue;
      const fy = lerp(fl.a.y, fl.b.y, clamp(t, 0, 1));
      if (t > 0.06 && t < 0.94 && Math.abs(fy - yc) < 0.65) return fy + this.y0;
      consider(fy);
    }
    // open ground around the house (not inside it, not in the water)
    const gW = groundAt(x, z);
    // (not the steep bluff the dock stairs run down: there he stays on the treads, landing and railings)
    const onBluff = p.x > 1.4 && p.x < 17 && p.z > -16.2 && p.z < -6.6;
    if (gW > 0.05 && !onBluff && !(Math.abs(p.x) < HX + 0.1 && Math.abs(p.z) < HZ + 0.1)) consider(gW - this.y0);
    return best === null || bd > 0.65 ? null : best + this.y0;
  }
  blocked(x, z, yW, r = 0.25) {
    const p = this.toLocal(x, 0, z); const yl = yW - this.y0; const f = this.floorOf(yl);
    if (p.x < -HX - 12 || p.x > HX + 12 || p.z < -30 || p.z > HZ + 12) return false;
    for (const [x0, z0, x1, z1] of this.walls[f]) {
      const dx = x1 - x0, dz = z1 - z0, L2 = dx * dx + dz * dz || 1; const t = clamp(((p.x - x0) * dx + (p.z - z0) * dz) / L2, 0, 1);
      const qx = x0 + dx * t - p.x, qz = z0 + dz * t - p.z; if (qx * qx + qz * qz < r * r) return true;
    }
    for (const [x0, x1, z0, z1] of this.blocks[f]) if (p.x > x0 - r && p.x < x1 + r && p.z > z0 - r && p.z < z1 + r) return true;
    // the chimney outside, and the cat
    if (f === 0 && p.x > HX - 0.1 - r && p.x < HX + 1.0 + r && Math.abs(p.z) < 0.8 + r) return true;
    return false;
  }
  blockers() { const c = this.catState; if (!c) return []; const w = this.toWorld(c.p.x, c.p.y, c.p.z); return c.mode === 'follow' ? [] : [{ x: w.x, z: w.z, r: 0.22 }]; }
  // ---------------------------------------------------------------- navigation graph for the automatic walk
  nav() {
    const N = {
      thead: [6.4, this.thead.y, -26.55], pierRoot: [6.4, this.pier.y, -16.2], dBottom: [6.6, -8.85, -16.1], land1: [13.6, -4.45, -11.2], land2: [13.1, -4.45, -12.2],
      cTop: [5.6, 0, -6.75], porch: [3.9, 0, -5.4], doorOut: [2.9, 0, -5.0], doorIn: [2.9, 0, -3.8], living: [1.5, 0, -1.9], sofaSpot: [3.4, 0, -1.8], fireSide: [4.7, 0, -1.2], hearth: [4.55, 0, 0],
      dining: [-1.0, 0, -0.6], kitchen: [-1.45, 0, 3.12], stove: [-3.4, 0, 3.2], sunIn: [-2.7, 0, -4.0], sunroom: [-2.8, 0, -5.9],
      stairFoot: [0.2, 0, 2.7], aBottom: [0.35, 0, 3.85], aTop: [5.4, FY[1], 3.85], landingB: [5.45, FY[1], 2.75], bedDoor: [5.45, FY[1], 1.6], bedroom: [4.9, FY[1], 0.2], bedSide: [4.75, FY[1], 0.9], bedCorner: [4.95, FY[1], -0.95], bedFoot: [3.3, FY[1], -1.25],
      bedroomW: [1.1, FY[1], -1.05], officeDoor: [0.0, FY[1], -1.05], office: [-1.0, FY[1], -2.4], bathDoor: [-2.6, FY[1], -0.1], bathIn: [-2.6, FY[1], 1.0], sink: [-4.95, FY[1], 1.5],
      bTop: [0.3, FY[2], 2.75], study: [-1.5, FY[2], 0.5], balDoor: [0.15, FY[2], -3.8], balcony: [0.5, FY[2], -5.2],
    };
    const E = [['thead', 'pierRoot'], ['pierRoot', 'dBottom'], ['dBottom', 'land2'], ['land2', 'land1'], ['land1', 'cTop'], ['cTop', 'porch'], ['porch', 'doorOut'], ['doorOut', 'doorIn'], ['doorIn', 'living'], ['doorIn', 'sofaSpot'],
      ['living', 'sofaSpot'], ['sofaSpot', 'fireSide'], ['fireSide', 'hearth'], ['living', 'dining'], ['dining', 'kitchen'], ['kitchen', 'stove'], ['dining', 'sunIn'], ['sunIn', 'sunroom'], ['kitchen', 'stairFoot'], ['living', 'stairFoot'], ['stairFoot', 'aBottom'],
      ['aBottom', 'aTop'], ['aTop', 'landingB'], ['landingB', 'bedDoor'], ['bedDoor', 'bedroom'], ['bedroom', 'bedSide'], ['bedroom', 'bedCorner'], ['bedCorner', 'bedFoot'], ['bedFoot', 'bedroomW'], ['bedroomW', 'officeDoor'], ['officeDoor', 'office'], ['office', 'bathDoor'], ['bathDoor', 'bathIn'], ['bathIn', 'sink'],
      ['landingB', 'bTop'], ['bTop', 'study'], ['study', 'balDoor'], ['balDoor', 'balcony']];
    this.N = {}; for (const k in N) this.N[k] = this.toWorld(...N[k]);
    this.E = {}; for (const [a, b] of E) { (this.E[a] = this.E[a] || []).push(b); (this.E[b] = this.E[b] || []).push(a); }
  }
  // full route (world points) from near pos to a named node, breadth-first over the graph
  navPath(pos, goal) {
    let near = null, score = 1e9;
    for (const k in this.N) { const p = this.N[k]; const d = Math.hypot(p.x - pos.x, p.z - pos.z) + Math.max(0, Math.abs(p.y - pos.y) - 0.4) * 3; if (d < score) { score = d; near = k; } }
    const prev = { [near]: null }; const q = [near];
    while (q.length) { const k = q.shift(); if (k === goal) break; for (const n of this.E[k] || []) if (!(n in prev)) { prev[n] = k; q.push(n); } }
    if (!(goal in prev)) return [this.N[goal]];
    let k = goal; const path = [k]; while (prev[k]) { k = prev[k]; path.push(k); } path.reverse();
    return path.map((n) => this.N[n]);
  }
  // next point to walk toward from world pos to a named node (breadth-first over the graph)
  navNext(pos, goal) {
    let near = null, nd = 1e9, score = 1e9;
    for (const k in this.N) { const p = this.N[k]; const h = Math.hypot(p.x - pos.x, p.z - pos.z); const d = h + Math.max(0, Math.abs(p.y - pos.y) - 0.4) * 3; if (d < score) { score = d; nd = h; near = k; } }
    if (near === goal) return this.N[goal];
    const prev = { [near]: null }; const q = [near];
    while (q.length) { const k = q.shift(); if (k === goal) break; for (const n of this.E[k] || []) if (!(n in prev)) { prev[n] = k; q.push(n); } }
    if (!(goal in prev)) return this.N[goal];
    let k = goal; const path = [k]; while (prev[k] !== null && prev[k] !== undefined) { k = prev[k]; path.push(k); } path.reverse();
    // if we're already at the nearest node, head for the next one
    if (nd < 0.6 && path.length > 1) return this.N[path[1]];
    // otherwise go to the nearest node first unless the next one is closer
    if (path.length > 1) { const a = this.N[path[0]], b = this.N[path[1]]; const db = Math.hypot(b.x - pos.x, b.z - pos.z); const ab = Math.hypot(b.x - a.x, b.z - a.z); if (db < ab) return b; }
    return this.N[path[0]];
  }
  // ---------------------------------------------------------------- per frame
  update(dt, t, S, player, playerInside, camera) {
    // fire flicker, room lights at dusk, TV glow
    const night = S.night, dusk = Math.max(night, S.twilight * 0.7, S.storm * 0.6);
    this.fireLight.I = 1.6 + 0.5 * Math.sin(t * 13) * Math.sin(t * 7.3) + 0.25 * Math.sin(t * 23);
    for (const L of this.roomLights) L.I = 1.1 * dusk;
    if (this.tvOn) { this.tvGlow = this.tvGlow || addLight(this.toWorld(4.6, FY[0] + 1.8, 0), 0x9ab8ff, 5, 0, { kind: 'home', dyn: true }); this.tvGlow.I = 0.6 + 0.3 * Math.sin(t * 5); }
    else if (this.tvGlow) this.tvGlow.I = 0;
    this.tvMat.uniforms.uOn.value = lerp(this.tvMat.uniforms.uOn.value, this.tvOn ? 1 : 0, 1 - Math.exp(-dt * 6));
    // chimney smoke drifting downwind
    const wind = U.uWindV.value;
    for (const p of this.smoke) {
      p.t += dt; const life = 7; if (p.t > life) p.t -= life; const k = p.t / life;
      p.s.position.set(this.chimTop.x + wind.x * k * 5 + Math.sin(p.t * 1.3) * 0.2, this.chimTop.y + k * 5.5, this.chimTop.z + wind.y * k * 5);
      const sc = 0.6 + k * 2.4; p.s.scale.set(sc, sc, 1); p.s.material.opacity = (1 - k) * smooth(0, 0.1, k) * 0.35 * (1 - S.rain * 0.6);
    }
    // front door swings open when someone's close
    const dp = this.toWorld(2.9, FY[0], -HZ); const near = player && Math.hypot(player.x - dp.x, player.z - dp.z) < 1.8 && Math.abs(player.y - dp.y) < 1.5;
    this.doorA = lerp(this.doorA, near ? -1.45 : 0, 1 - Math.exp(-dt * 4)); this.door.rotation.y = this.doorA;
    // far away only the shell matters: skip the furnishings, the cat and the fire
    const cd = camera.position.distanceTo(this.g.position); const near2 = cd < 90 || !!player;
    if (near2 !== this.nearOn) { this.nearOn = near2; for (const f of this.floors) { if (f.inner) f.inner.visible = near2; } this.cat.g.visible = near2; }
    if (near2) this.updateCat(dt, t, player);
    this.cutaway(player, playerInside, camera);
    const far = cd > 70 && !playerInside;
    this.far.visible = far;
    if (far) { for (const f of this.floors) f.group.visible = false; this.roof.visible = false; this.outside.visible = false; this.trimOut.visible = false; }
    else this.outside.visible = true;
  }
  cutaway(player, inside, camera) {
    this.camInside = inside;
    const cl = this.toLocal(camera.position.x, camera.position.y, camera.position.z);
    const f = inside ? this.floorOf(this.toLocal(player.x, player.y, player.z).y) : 3;
    this.roof.visible = !inside; this.trimOut.visible = !inside; this.sunroof.visible = !inside;
    // walls-down: on the floor he's on, partitions drop to waist height so the rooms read from above
    this.parts1.scale.y = lerp(this.parts1.scale.y, inside && f === 1 ? 0.36 : 1, 0.2);
    for (let k = 0; k < 3; k++) {
      const fl = this.floors[k];
      fl.group.visible = !inside || k <= f;
      for (const e of fl.ext) {
        const n = { front: [0, -1], back: [0, 1], left: [-1, 0], right: [1, 0] }[e.side];
        const c = { front: [0, -HZ], back: [0, HZ], left: [-HX, 0], right: [HX, 0] }[e.side];
        const facing = (cl.x - c[0]) * n[0] + (cl.z - c[1]) * n[1] > 0;
        e.g.visible = !(inside && facing && k <= f);
      }
    }
  }
  // ---------------------------------------------------------------- the cat
  updateCat(dt, t, player) {
    const C = this.catState, cat = this.cat; C.t += dt;
    const pl = player ? this.toLocal(player.x, player.y, player.z) : null;
    const plNear = pl && Math.abs(pl.y - FY[0]) < 0.8 && Math.hypot(pl.x - C.p.x, pl.z - C.p.z) < 5.5 && Math.abs(pl.x) < HX + 3;
    if (this.petting) { C.mode = 'petted'; }
    else if (plNear && C.mode !== 'walk' && C.mode !== 'follow' && Math.random() < dt * 0.5) { C.mode = 'follow'; C.t = 0; }
    if (C.mode === 'follow') {
      const dx = pl ? pl.x - C.p.x : 0, dz = pl ? pl.z - C.p.z : 0, d = Math.hypot(dx, dz);
      if (!plNear || C.t > 20) { C.mode = 'sit'; C.t = 0; }
      else if (d > 0.9) { C.yaw = lerpA(C.yaw, Math.atan2(dx, dz), dt * 5); const sp = Math.min(1.2, d - 0.8); this.catStep(dx / d * sp * dt, dz / d * sp * dt); cat.walk(dt, sp); }
      else { cat.walk(dt, 0); cat.pose('sit', dt); C.yaw = lerpA(C.yaw, Math.atan2(dx, dz), dt * 3); }
    } else if (C.mode === 'walk') {
      const dx = C.target.x - C.p.x, dz = C.target.z - C.p.z, d = Math.hypot(dx, dz);
      if (d < 0.1) { C.mode = C.target.m; C.t = 0; }
      else { C.yaw = lerpA(C.yaw, Math.atan2(dx, dz), dt * 4); const sp = 0.55; this.catStep(dx / d * sp * dt, dz / d * sp * dt); cat.walk(dt, sp); if (C.t > 25) { C.mode = 'sit'; } }
    } else if (C.mode === 'petted') { cat.walk(dt, 0); cat.pose('sit', dt); }
    else {
      cat.walk(dt, 0); cat.pose(C.mode === 'loaf' ? 'loaf' : C.mode === 'sofa' ? 'loaf' : 'sit', dt);
      if (C.t > 14 + Math.random() * 20) { const s = this.catSpots[Math.floor(Math.random() * this.catSpots.length)]; C.target = { x: s[0], z: s[1], m: s[2] }; C.mode = 'walk'; C.t = 0; }
    }
    // the sofa spot is up on the cushions
    const onSofa = C.p.x > 2.1 && C.p.x < 3.05 && Math.abs(C.p.z) < 1.1;
    C.y = lerp(C.y || 0, onSofa ? 0.5 : 0, 1 - Math.exp(-dt * 10));
    cat.g.position.set(C.p.x, FY[0] + C.y, C.p.z); cat.g.rotation.y = C.yaw;
    cat.tail(t, C.mode);
    C.meowT -= dt; if (C.meowT <= 0) { C.meowT = 12 + Math.random() * 25; if (plNear && this.audio) { const w = this.toWorld(C.p.x, FY[0], C.p.z); this.audio.amb && this.audio.amb.meow(w.x, w.z); } }
    if (this.audio && this.audio.amb) { const want = !!this.petting; if (want !== C.purr) { C.purr = want; this.audio.amb.setPurr(want); } }
  }
  catStep(dx, dz) {
    const C = this.catState; const nx = C.p.x + dx, nz = C.p.z + dz;
    const inside = (x, z) => (x > -HX + 0.3 && x < HX - 0.3 && z > -HZ + 0.3 && z < HZ - 0.3 && !(x > 1.6 && z > 3.3)) || (x > -5.3 && x < 0.1 && z > -7.8 && z < -4.4 && (x < -1.2 || z < -4.6)) || (z > -4.7 && z < -4.3 && x > -4.1 && x < -1.3);
    const hitsFurn = (x, z) => this.blocks[0].some(([a, b, c, d]) => x > a - 0.12 && x < b + 0.12 && z > c - 0.12 && z < d + 0.12 && !(a === 2.1 && b === 3.05));
    if (inside(nx, nz) && !hitsFurn(nx, nz)) { C.p.x = nx; C.p.z = nz; } else if (inside(nx, C.p.z) && !hitsFurn(nx, C.p.z)) C.p.x = nx; else if (inside(C.p.x, nz) && !hitsFurn(C.p.x, nz)) C.p.z = nz;
  }
  catWorld() { const C = this.catState; return this.toWorld(C.p.x, FY[0] + (C.y || 0), C.p.z); }
  fireSound() { const w = this.toWorld(this.firePos.x, 0, this.firePos.z); return { x: w.x, z: w.z, on: true }; }
  tvSound() { const w = this.toWorld(this.tvPos.x, 0, this.tvPos.z); return { x: w.x, z: w.z, on: this.tvOn }; }
  isInside(p) { const l = this.toLocal(p.x, p.y, p.z); return (Math.abs(l.x) < HX && Math.abs(l.z) < HZ && l.y > -0.5) || (l.x > -5.6 && l.x < 0.4 && l.z > -8 && l.z < -HZ && l.y > -0.5 && l.y < 2) || (l.x > -2 && l.x < 2.5 && l.z > -6 && l.z < -HZ && l.y > 5.5); }
  // camera for inside the house: an elevated three-quarter view from the river side, walls toward it cut away
  camFocus(p, orbit = 0) {
    const l = this.toLocal(p.x, p.y, p.z);
    const az = -0.55 + orbit, el = 0.95, dist = 9.5;
    const dir = new V3(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el));
    const camL = l.clone().addScaledVector(dir, dist); camL.y = Math.max(camL.y, l.y + 4.5);
    return { cam: this.toWorld(camL.x, camL.y, camL.z), look: this.toWorld(l.x, l.y + 0.9, l.z) };
  }
}

function tfLine(a, b, r) {
  const L = a.distanceTo(b); const g = box(r, r, L); const mid = a.clone().add(b).multiplyScalar(0.5);
  const q = new Q().setFromUnitVectors(new V3(0, 0, 1), b.clone().sub(a).normalize()); g.applyQuaternion(q); g.translate(mid.x, mid.y, mid.z); return g;
}
function lerpA(a, b, k) { let d = b - a; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return a + d * Math.min(1, k); }

// ------------------------------------------------------------------ a ginger tabby, built from simple shapes
function makeCat() {
  const fur = std({ color: 0xd4884a, roughness: 0.9 }, { wet: 0.3 }), light = std({ color: 0xf0d6b0, roughness: 0.9 }, { wet: 0.3 }), dark = std({ color: 0x1a1612, roughness: 0.3 }), pink = std({ color: 0xe8a0a0, roughness: 0.7 });
  const eye = new THREE.MeshBasicMaterial({ color: 0x9ad04a });
  const g = new THREE.Group(); const add = (geo, m, p = g) => { const o = new THREE.Mesh(geo, m); o.castShadow = true; p.add(o); return o; };
  const body = new THREE.Group(); body.position.y = 0.2; g.add(body);
  const bg = new THREE.SphereGeometry(0.11, 12, 10); bg.scale(0.85, 0.85, 2.0); add(bg, fur, body);
  const belly = new THREE.SphereGeometry(0.09, 10, 8); belly.scale(0.8, 0.7, 1.6); belly.translate(0, -0.035, 0); add(belly, light, body);
  // stripes
  for (let i = 0; i < 5; i++) { const s = new THREE.TorusGeometry(0.093, 0.008, 4, 16, Math.PI); s.rotateZ(0); s.rotateY(Math.PI / 2); s.rotateX(0); s.translate(0, 0.01, -0.12 + i * 0.06); add(s, std({ color: 0xa85a28, roughness: 0.9 }), body); }
  const head = new THREE.Group(); head.position.set(0, 0.1, 0.22); body.add(head);
  const hg = new THREE.SphereGeometry(0.075, 12, 10); hg.scale(1.05, 0.95, 0.95); add(hg, fur, head);
  const muz = new THREE.SphereGeometry(0.035, 8, 6); muz.scale(1.2, 0.8, 0.9); muz.translate(0, -0.025, 0.06); add(muz, light, head);
  add(new THREE.SphereGeometry(0.009, 6, 4).translate(0, -0.012, 0.09), pink, head);
  for (const sx of [-1, 1]) { const ear = new THREE.ConeGeometry(0.03, 0.06, 4); ear.translate(sx * 0.042, 0.075, 0.0); ear.rotateZ(-sx * 0.2); add(ear, fur, head); add(new THREE.SphereGeometry(0.013, 8, 6).translate(sx * 0.028, 0.012, 0.064), eye, head); add(new THREE.SphereGeometry(0.006, 6, 4).translate(sx * 0.028, 0.012, 0.075), dark, head); }
  // legs: shoulder/hip pivots
  const legs = [];
  for (const [sx, sz] of [[-1, 1], [1, 1], [-1, -1], [1, -1]]) { const l = new THREE.Group(); l.position.set(sx * 0.055, -0.03, sz * 0.13); body.add(l); const lg = new THREE.CylinderGeometry(0.02, 0.018, 0.18, 6); lg.translate(0, -0.09, 0); add(lg, fur, l); add(new THREE.SphereGeometry(0.022, 6, 4).translate(0, -0.18, 0.01), light, l); legs.push({ l, sz, ph: (sx > 0 ? 0 : Math.PI) + (sz > 0 ? 0 : Math.PI * 0.5) }); }
  // tail: a chain of segments
  const tail = []; let parent = body; const t0 = new THREE.Group(); t0.position.set(0, 0.04, -0.2); body.add(t0); parent = t0;
  for (let i = 0; i < 7; i++) { const seg = new THREE.Group(); if (i) seg.position.z = -0.045; parent.add(seg); const sg = new THREE.CylinderGeometry(0.016, 0.018, 0.05, 6); sg.rotateX(Math.PI / 2); sg.translate(0, 0, -0.022); add(sg, i % 2 ? fur : std({ color: 0xa85a28, roughness: 0.9 }), seg); tail.push(seg); parent = seg; }
  let ph = 0, poseK = { sit: 0, loaf: 0 };
  return {
    g, body, head,
    walk(dt, sp) {
      ph += dt * sp * 11;
      for (const L of legs) L.l.rotation.x = sp > 0.02 ? Math.sin(ph + L.ph) * 0.55 : L.l.rotation.x * (1 - dt * 6);
      body.position.y = 0.2 + (sp > 0.02 ? Math.abs(Math.sin(ph)) * 0.01 : 0) - poseK.loaf * 0.12;
      if (sp > 0.02) { poseK.sit = Math.max(0, poseK.sit - dt * 4); poseK.loaf = Math.max(0, poseK.loaf - dt * 4); this.apply(); }
    },
    pose(kind, dt) {
      poseK.sit += ((kind === 'sit' ? 1 : 0) - poseK.sit) * Math.min(1, dt * 3); poseK.loaf += ((kind === 'loaf' ? 1 : 0) - poseK.loaf) * Math.min(1, dt * 3); this.apply();
    },
    apply() {
      // sitting: chest up, hind legs folded; loaf: everything tucked under
      body.rotation.x = -poseK.sit * 0.55;
      body.position.y = 0.2 + poseK.sit * 0.03 - poseK.loaf * 0.12;
      for (const L of legs) { if (L.sz < 0) L.l.rotation.x = poseK.sit * 1.3 + poseK.loaf * 1.4; else L.l.rotation.x = poseK.sit * 0.5 + poseK.loaf * -1.3; L.l.visible = poseK.loaf < 0.8; }
      head.rotation.x = poseK.sit * 0.45;
    },
    tail(t, mode) { tail.forEach((s, i) => { s.rotation.y = Math.sin(t * (mode === 'walk' || mode === 'follow' ? 3 : 1.2) - i * 0.5) * 0.18; s.rotation.x = i === 0 ? (mode === 'loaf' ? 0.2 : -0.6) : (mode === 'loaf' ? 0.05 : 0.18); }); },
  };
}
