// Terrain ribbon along the river (s,d parameterisation), far skirt, ground material with splatting
import * as THREE from 'three';
import { S0, S1, frame, hw, heightSD, bankTypeAt, islandMask, CANAL, toSD } from './world.js';
import { patch } from './matpatch.js';
import { clamp, smooth, fbm2 } from './util.js';
import TEX from './tex.js';

export const FH = 6.0;
const EK = [0, 0.35, 0.8, 1.5, 2.5, 3.6, 5, 6.5, 8, 9.5, 11, 12.5, 14, 15.5, 17, 19, 21.5, 24, 26.5, 28, 30, 33, 36, 38, 40, 43, 47, 52, 58, 66, 76, 88, 102, 120, 142, 170, 205, 250, 300, 360, 420];
const EMAX = 420;
const NB = 34; // bed samples per side
const DSROW = 3;

export function terrainH(s, d) {
  const side = d >= 0 ? 1 : -1;
  const e = Math.abs(d) - hw(s, side);
  let h = heightSD(s, d);
  if (e > 300) h = h + (FH - h) * smooth(300, EMAX - 8, e);
  return h;
}
export function groundAt(x, z) { const { s, d } = toSD(x, z); return terrainH(s, d); }

let TER = null;
export function buildTerrain(scene) {
  const rows = Math.floor((S1 - S0) / DSROW) + 1;
  // column descriptors: {side, kind:'bed'|'land', v}
  const cols = [];
  for (let i = EK.length - 1; i >= 0; i--) cols.push({ side: -1, land: true, e: EK[i] });
  for (let i = NB; i >= 1; i--) { const t = i / NB; cols.push({ side: -1, land: false, u: Math.sin(t * Math.PI / 2) * 0.999 }); }
  cols.push({ side: 1, land: false, u: 0 });
  for (let i = 1; i <= NB; i++) { const t = i / NB; cols.push({ side: 1, land: false, u: Math.sin(t * Math.PI / 2) * 0.999 }); }
  for (let i = 0; i < EK.length; i++) cols.push({ side: 1, land: true, e: EK[i] });
  const nc = cols.length;

  const CH = 16; // chunks along s
  const rowsPer = Math.ceil(rows / CH);
  const mat = groundMaterial();
  const meshes = [];
  const allPos = []; // for AO darkening lookups
  for (let c = 0; c < CH; c++) {
    const r0 = c * rowsPer, r1 = Math.min(rows - 1, (c + 1) * rowsPer);
    if (r1 <= r0) break;
    const nr = r1 - r0 + 1;
    const pos = new Float32Array(nr * nc * 3), uv = new Float32Array(nr * nc * 2), spl = new Float32Array(nr * nc * 4), col = new Float32Array(nr * nc * 3);
    const sd = new Float32Array(nr * nc * 2);
    for (let r = 0; r < nr; r++) {
      const s = S0 + (r0 + r) * DSROW;
      const F = frame(s);
      const wL = hw(s, -1), wR = hw(s, 1);
      for (let k = 0; k < nc; k++) {
        const cd = cols[k];
        const d = cd.land ? cd.side * ((cd.side > 0 ? wR : wL) + cd.e) : cd.side * cd.u * (cd.side > 0 ? wR : wL);
        const h = terrainH(s, d);
        const x = F.x + F.rx * d, z = F.z + F.rz * d;
        const i = r * nc + k;
        pos[i * 3] = x; pos[i * 3 + 1] = h; pos[i * 3 + 2] = z;
        uv[i * 2] = x * 0.25; uv[i * 2 + 1] = z * 0.25;
        sd[i * 2] = s; sd[i * 2 + 1] = d;
        const w = splatAt(s, d, h, cd);
        spl.set(w, i * 4);
        let ao = 1;
        if (cd.land && cd.e < 1.2 && bankTypeAt(s, cd.side) === 'seawall') ao = 0.55;
        col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = ao;
      }
    }
    const idx = [];
    for (let r = 0; r < nr - 1; r++) for (let k = 0; k < nc - 1; k++) {
      const a = r * nc + k, b = a + 1, c2 = a + nc, d2 = c2 + 1;
      idx.push(a, b, c2, b, d2, c2);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setAttribute('splat', new THREE.BufferAttribute(spl, 4));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    // steepness -> rock
    const nrm = g.attributes.normal.array;
    for (let i = 0; i < nr * nc; i++) {
      const ny = nrm[i * 3 + 1];
      const rockW = smooth(0.82, 0.62, ny);
      if (rockW > 0) for (let j = 0; j < 4; j++) spl[i * 4 + j] *= 1 - rockW;
    }
    const m = new THREE.Mesh(g, mat);
    m.receiveShadow = true; m.castShadow = false;
    m.userData.sd = sd; m.userData.nc = nc; m.userData.s0 = S0 + r0 * DSROW; m.userData.nr = nr;
    scene.add(m); meshes.push(m);
  }
  TER = { meshes, cols, nc };
  buildSkirt(scene);
  return TER;
}

function splatAt(s, d, h, cd) {
  // returns [grass, forest, sand, pebble]; rock = remainder
  const side = d >= 0 ? 1 : -1;
  const t = bankTypeAt(s, side);
  const n = fbm2(s * 0.05 + 3, d * 0.05);
  const n2 = fbm2(s * 0.13 + 11, d * 0.13);
  if (!cd.land) {
    const W = hw(s, side); const q = 1 - Math.abs(d) / W;
    if (islandMask(s, d) > 0.02) return h > 0.4 ? [0.1, 0.8, 0.1, 0] : [0, 0.2, 0.5, 0.3];
    if (t === 'riprap') return q < 0.08 ? [0, 0, 0.2, 0.2] : [0, 0, 0.6, 0.4];
    if (t === 'seawall') return [0, 0, 0.75, 0.25];
    const peb = smooth(0.25, 0.03, q) * (0.4 + 0.6 * n2);
    return [0, 0, 1 - peb, peb];
  }
  const e = cd.e;
  if (e > 300) return [0.55, 0.45, 0, 0];
  switch (t) {
    case 'seawall': return e < 0.6 ? [0, 0, 0, 0] : [0.92, 0.08 * n, 0, 0];
    case 'riprap': return e < 9 ? [0.1 * n, 0, 0.05, 0.1] : [0.8, 0.2 * n, 0, 0];
    case 'launch': return e < 12 ? [0, 0, 0.5, 0.5] : [0.85, 0.15, 0, 0];
    case 'beach': {
      if (e < 6) return [0, 0, 0.55 + 0.3 * n, 0.45 - 0.3 * n];
      if (e > CANAL.towE0 - 2 && e < CANAL.towE1 + 1) return [0.05, 0.1, 0.6, 0.25];
      return [0.35, 0.65, 0, 0];
    }
    case 'marsh': return e < 3 ? [0.2, 0.1, 0.6, 0.1] : [0.65, 0.35, 0, 0];
    case 'wood': {
      if (e < 2.5) return [0, 0.2, 0.4, 0.4];
      if (side > 0 && s > CANAL.s0 && e > CANAL.towE0 - 1 && e < CANAL.towE1 + 0.5) return [0.1, 0.1, 0.55, 0.25];
      const g = smooth(0.55, 0.75, n) * 0.6;
      return [g, 1 - g, 0, 0];
    }
  }
  return [1, 0, 0, 0];
}

function groundMaterial() {
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.95, metalness: 0, vertexColors: true, normalMap: TEX.rock.normalMap, normalScale: new THREE.Vector2(0.6, 0.6) });
  patch(mat, {
    vertHead: 'attribute vec4 splat; varying vec4 vSplat;',
    vertexExtra: '\nvSplat = splat;\n',
    fragHead: 'varying vec4 vSplat; uniform sampler2D tG, tF, tS, tP, tR;',
    mapReplace: /* glsl */`
      vec2 tuv = vWPos.xz;
      vec4 w = vSplat;
      float wr = max(0.0, 1.0 - (w.x + w.y + w.z + w.w));
      vec3 cG = mix(texture2D(tG, tuv*0.22).rgb, texture2D(tG, tuv*0.043).rgb, 0.45);
      vec3 cF = mix(texture2D(tF, tuv*0.2).rgb, texture2D(tF, tuv*0.05).rgb, 0.4);
      vec3 cS = mix(texture2D(tS, tuv*0.18).rgb, texture2D(tS, tuv*0.037).rgb, 0.5);
      vec3 cP = texture2D(tP, tuv*0.3).rgb;
      vec3 an = abs(normalize(vWNrm)); an /= (an.x + an.y + an.z);
      vec3 cR = texture2D(tR, vWPos.zy*0.12).rgb*an.x + texture2D(tR, tuv*0.12).rgb*an.y + texture2D(tR, vWPos.xy*0.12).rgb*an.z;
      // height-blend sharpening
      vec3 base = cG*w.x + cF*w.y + cS*w.z + cP*w.w + cR*wr;
      // large-scale painterly variation
      float lv = texture2D(tF, tuv*0.004).g;
      base *= 0.85 + 0.3*lv;
      // wet margin just above the waterline
      float wetBand = 1.0 - smoothstep(0.0, 0.55, vWPos.y);
      base *= 1.0 - 0.32*wetBand;
      diffuseColor.rgb *= base;
    `,
    onShader: (sh) => {
      sh.uniforms.tG = { value: TEX.grass.map }; sh.uniforms.tF = { value: TEX.forest.map }; sh.uniforms.tS = { value: TEX.sand.map };
      sh.uniforms.tP = { value: TEX.pebble.map }; sh.uniforms.tR = { value: TEX.rock.map };
    },
  });
  return mat;
}

function buildSkirt(scene) {
  // extension of the ribbon to the horizon on both sides plus end caps, all at FH
  const pos = [], idx = [];
  const EXT = [EMAX - 2, 700, 1300, 2400, 5000];
  const step = 24;
  const rows = [];
  for (let s = S0; s <= S1 + 0.1; s += step) rows.push(Math.min(s, S1));
  const nc = EXT.length;
  for (const side of [-1, 1]) {
    const base = pos.length / 3;
    for (const s of rows) {
      const F = frame(s);
      for (const e of EXT) { const d = side * (hw(s, side) + e); pos.push(F.x + F.rx * d, FH - 0.03, F.z + F.rz * d); }
    }
    for (let r = 0; r < rows.length - 1; r++) for (let k = 0; k < nc - 1; k++) {
      const a = base + r * nc + k, b = a + 1, c = a + nc, d = c + 1;
      if (side > 0) idx.push(a, b, c, b, d, c); else idx.push(a, c, b, b, c, d);
    }
  }
  // end caps
  for (const [s, dir] of [[S0, -1], [S1, 1]]) {
    const F = frame(s);
    const L = 6000, D = 5200;
    const base = pos.length / 3;
    const p0 = [F.x - F.rx * D, F.z - F.rz * D], p1 = [F.x + F.rx * D, F.z + F.rz * D];
    const q0 = [p0[0] + F.fx * L * dir, p0[1] + F.fz * L * dir], q1 = [p1[0] + F.fx * L * dir, p1[1] + F.fz * L * dir];
    pos.push(p0[0], FH - 0.03, p0[1], p1[0], FH - 0.03, p1[1], q0[0], FH - 0.03, q0[1], q1[0], FH - 0.03, q1[1]);
    if (dir < 0) idx.push(base, base + 1, base + 2, base + 1, base + 3, base + 2); else idx.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  const n = pos.length / 3;
  const uv = new Float32Array(n * 2), spl = new Float32Array(n * 4), col = new Float32Array(n * 3).fill(1), nr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { uv[i * 2] = pos[i * 3] * 0.25; uv[i * 2 + 1] = pos[i * 3 + 2] * 0.25; spl.set([0.55, 0.45, 0, 0], i * 4); nr[i * 3 + 1] = 1; }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); g.setAttribute('splat', new THREE.BufferAttribute(spl, 4)); g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nr, 3));
  const m = new THREE.Mesh(g, TER.meshes[0].material);
  m.receiveShadow = true;
  scene.add(m);
  TER.skirt = m;
}

// Darken terrain vertex colours around a point (baked ambient occlusion for trees, walls, rocks)
export function bakeAO(list) {
  // list of [x, z, radius, strength]
  if (!TER) return;
  const C = 8;
  if (!TER.grid) {
    const grid = new Map();
    TER.meshes.forEach((m, mi) => {
      const pos = m.geometry.attributes.position.array;
      for (let i = 0; i < pos.length / 3; i++) {
        const key = Math.floor(pos[i * 3] / C) * 100003 + Math.floor(pos[i * 3 + 2] / C);
        let a = grid.get(key); if (!a) grid.set(key, (a = [])); a.push(mi, i);
      }
    });
    TER.grid = grid;
  }
  const dirty = new Set();
  for (const [x, z, r, k] of list) {
    for (let gx = Math.floor((x - r) / C); gx <= Math.floor((x + r) / C); gx++) for (let gz = Math.floor((z - r) / C); gz <= Math.floor((z + r) / C); gz++) {
      const a = TER.grid.get(gx * 100003 + gz); if (!a) continue;
      for (let j = 0; j < a.length; j += 2) {
        const m = TER.meshes[a[j]], i = a[j + 1];
        const pos = m.geometry.attributes.position.array, col = m.geometry.attributes.color.array;
        const dx = pos[i * 3] - x, dz = pos[i * 3 + 2] - z; const dd = dx * dx + dz * dz;
        if (dd > r * r) continue;
        const f = 1 - Math.sqrt(dd) / r;
        const v = 1 - k * f * f;
        col[i * 3] *= v; col[i * 3 + 1] *= v; col[i * 3 + 2] *= v;
        dirty.add(m);
      }
    }
  }
  dirty.forEach((m) => (m.geometry.attributes.color.needsUpdate = true));
}
export function clampAO() {
  for (const m of TER.meshes) { const c = m.geometry.attributes.color.array; for (let i = 0; i < c.length; i++) c[i] = Math.max(c[i], 0.38); m.geometry.attributes.color.needsUpdate = true; }
}
