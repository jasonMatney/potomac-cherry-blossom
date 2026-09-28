// Modelled characters: CC0 Quaternius "Universal Base Characters" bodies (embedded), dressed with
// clothing shells generated from the body surface, plus a generic IK rig for the shared 65-bone skeleton.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as skClone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { std, U } from './matpatch.js';
import TEX from './tex.js';
import MALE_GLB from '../assets/male.glb';
import FEMALE_GLB from '../assets/female.glb';
import ANIMS_GLB from '../assets/anims.glb';
import MALE_DARK_JPG from '../assets/male_dark.jpg';

const V3 = THREE.Vector3, Q = THREE.Quaternion;
const T = {}; // templates

async function parse(bytes) {
  const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  return new GLTFLoader().parseAsync(buf, '');
}
function imgTexture(bytes) {
  return new Promise((res) => {
    const blob = new Blob([bytes], { type: 'image/jpeg' });
    const url = URL.createObjectURL(blob); const img = new Image();
    img.onload = () => { const t = new THREE.Texture(img); t.colorSpace = THREE.SRGBColorSpace; t.flipY = false; t.anisotropy = 4; t.needsUpdate = true; res(t); };
    img.src = url;
  });
}

export function humanTex() { return T; }
export async function loadHumans() {
  const [m, f, a] = await Promise.all([parse(MALE_GLB), parse(FEMALE_GLB), parse(ANIMS_GLB)]);
  T.male = m; T.female = f;
  T.clips = {};
  for (const c of a.animations) {
    // keep the character in place: drop root translation, keep the pelvis bob
    c.tracks = c.tracks.filter((t) => !(t.name.startsWith('root.') && (t.name.endsWith('.position') || t.name.endsWith('.scale'))));
    T.clips[c.name] = c;
  }
  T.maleDark = await imgTexture(MALE_DARK_JPG);
}

// ------------------------------------------------------------------ body-region classification
function regionOf(name) {
  if (/hand_|thumb|index|middle|ring|pinky/.test(name)) return 'hand';
  if (/Head/.test(name)) return 'head';
  if (/neck/.test(name)) return 'neck';
  if (/upperarm/.test(name)) return 'uarm';
  if (/lowerarm/.test(name)) return 'larm';
  if (/clavicle|spine/.test(name)) return 'torso';
  if (/pelvis|root/.test(name)) return 'hip';
  if (/thigh/.test(name)) return 'thigh';
  if (/calf/.test(name)) return 'calf';
  if (/foot|ball/.test(name)) return 'foot';
  return 'other';
}

// Build a shell SkinnedMesh from selected triangles of a body mesh: welded across UV seams,
// pushed out along the normals, relaxed (so it drapes over muscles instead of hugging them),
// and with its open edges optionally snapped to clean cut lines (hems, cuffs).
function shellFrom(body, selectTri, offsetFn, mat, extra, opt = {}) {
  const g = body.geometry, idx = g.index.array;
  const P = g.attributes.position, N = g.attributes.normal, SI = g.attributes.skinIndex, SW = g.attributes.skinWeight, UV = g.attributes.uv;
  const q = opt.weldTol ?? 1e-3 * (opt.unit || 1);
  // ---- welded vertex records
  const recs = []; const map = new Map();
  const rec = (i) => {
    const k = `${Math.round(P.getX(i) / q)},${Math.round(P.getY(i) / q)},${Math.round(P.getZ(i) / q)}`;
    let v = map.get(k);
    if (v === undefined) {
      v = recs.length; map.set(k, v);
      recs.push({ p: new V3(P.getX(i), P.getY(i), P.getZ(i)), n: new V3(), i, si: [SI.getX(i), SI.getY(i), SI.getZ(i), SI.getW(i)], sw: [SW.getX(i), SW.getY(i), SW.getZ(i), SW.getW(i)], uv: [UV ? UV.getX(i) : 0, UV ? UV.getY(i) : 0] });
    }
    recs[v].n.x += N.getX(i); recs[v].n.y += N.getY(i); recs[v].n.z += N.getZ(i);
    return v;
  };
  let tris = [];
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t], b = idx[t + 1], c = idx[t + 2];
    if (!selectTri(a, b, c)) continue;
    const va = rec(a), vb = rec(b), vc = rec(c);
    if (va === vb || vb === vc || va === vc) continue;
    tris.push(va, vb, vc);
  }
  recs.forEach((r) => r.n.normalize());
  // ---- clip against cut planes (hems, cuffs): new vertices are shared along each cut edge
  for (const [pi, plane] of (opt.planes || []).entries()) {
    const dist = recs.map((r) => plane(r.p));
    const cutMap = new Map(); const out = [];
    const mid = (a, b) => {
      const key = a < b ? a + '_' + b : b + '_' + a; let v = cutMap.get(key); if (v !== undefined) return v;
      const t = dist[a] / (dist[a] - dist[b]); const A = recs[a], B = recs[b]; const near = t < 0.5 ? A : B;
      v = recs.length;
      recs.push({ p: A.p.clone().lerp(B.p, t), n: A.n.clone().lerp(B.n, t).normalize(), i: near.i, si: near.si, sw: near.sw, uv: near.uv, cut: true });
      dist.push(0); cutMap.set(key, v); return v;
    };
    for (let t = 0; t < tris.length; t += 3) {
      const poly = [tris[t], tris[t + 1], tris[t + 2]]; const res = [];
      for (let e = 0; e < 3; e++) {
        const a = poly[e], b = poly[(e + 1) % 3]; const ina = dist[a] <= 0, inb = dist[b] <= 0;
        if (ina) res.push(a);
        if (ina !== inb) res.push(mid(a, b));
      }
      for (let k = 1; k + 1 < res.length; k++) out.push(res[0], res[k], res[k + 1]);
    }
    tris = out;
  }
  // compact
  const used = new Map(); const R = []; const T2 = [];
  for (const v of tris) { if (!used.has(v)) { used.set(v, R.length); R.push(recs[v]); } T2.push(used.get(v)); }
  tris = T2; const n = R.length;
  const p0 = new Float32Array(n * 3), nn = new Float32Array(n * 3), p = new Float32Array(n * 3), gap = new Float32Array(n);
  for (let v = 0; v < n; v++) {
    const r = R[v];
    p0[v * 3] = r.p.x; p0[v * 3 + 1] = r.p.y; p0[v * 3 + 2] = r.p.z; nn[v * 3] = r.n.x; nn[v * 3 + 1] = r.n.y; nn[v * 3 + 2] = r.n.z;
    gap[v] = offsetFn(r.p, r.n, r.i);
    for (let c = 0; c < 3; c++) p[v * 3 + c] = p0[v * 3 + c] + nn[v * 3 + c] * gap[v];
  }
  // adjacency + boundary detection
  const nb = Array.from({ length: n }, () => new Set()); const edges = new Map();
  for (let t = 0; t < tris.length; t += 3) for (let e = 0; e < 3; e++) {
    const a = tris[t + e], b = tris[t + (e + 1) % 3]; nb[a].add(b); nb[b].add(a);
    const k = a < b ? a + '_' + b : b + '_' + a; edges.set(k, (edges.get(k) || 0) + 1);
  }
  const bnd = new Uint8Array(n);
  for (const [k, c] of edges) if (c === 1) { const [a, b] = k.split('_').map(Number); bnd[a] = 1; bnd[b] = 1; }
  // relax: Laplacian smoothing (open edges slide only along themselves), restoring the minimum gap
  const it = opt.smooth ?? 0, tmp = new Float32Array(n * 3);
  const relax = (w, keepGap) => {
    for (let v = 0; v < n; v++) {
      let x = 0, y = 0, z = 0, m = 0;
      for (const u of nb[v]) { if (bnd[v] && !bnd[u]) continue; x += p[u * 3]; y += p[u * 3 + 1]; z += p[u * 3 + 2]; m++; }
      if (!m) { tmp[v * 3] = p[v * 3]; tmp[v * 3 + 1] = p[v * 3 + 1]; tmp[v * 3 + 2] = p[v * 3 + 2]; continue; }
      const ww = bnd[v] ? w * 0.5 : w;
      tmp[v * 3] = p[v * 3] * (1 - ww) + x / m * ww; tmp[v * 3 + 1] = p[v * 3 + 1] * (1 - ww) + y / m * ww; tmp[v * 3 + 2] = p[v * 3 + 2] * (1 - ww) + z / m * ww;
    }
    p.set(tmp);
    if (keepGap) for (let v = 0; v < n; v++) {
      const d = (p[v * 3] - p0[v * 3]) * nn[v * 3] + (p[v * 3 + 1] - p0[v * 3 + 1]) * nn[v * 3 + 1] + (p[v * 3 + 2] - p0[v * 3 + 2]) * nn[v * 3 + 2];
      const need = gap[v] * (opt.minGapK ?? 0.7);
      if (d < need) for (let c = 0; c < 3; c++) p[v * 3 + c] += nn[v * 3 + c] * (need - d);
    }
  };
  for (let k = 0; k < it; k++) relax(0.6, true);
  for (let k = 0; k < (it ? 3 : 0); k++) relax(0.5, false);
  const si = [], sw = [], uv = [], fl = [];
  for (let v = 0; v < n; v++) {
    const r = R[v];
    si.push(...r.si); sw.push(...r.sw); uv.push(...r.uv);
    fl.push(extra ? extra(r.p, r.i) : 0);
  }
  const sg = new THREE.BufferGeometry();
  sg.setAttribute('position', new THREE.BufferAttribute(p, 3));
  sg.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
  sg.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
  sg.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  sg.setAttribute('aFlutter', new THREE.Float32BufferAttribute(fl, 1));
  sg.setIndex(tris);
  sg.computeVertexNormals();
  const sm = new THREE.SkinnedMesh(sg, mat);
  sm.userData.stats = { n, tris: tris.length / 3, bnd: bnd.reduce((a, b) => a + b, 0) };
  sm.bind(body.skeleton, body.bindMatrix);
  sm.castShadow = true; sm.receiveShadow = true; sm.frustumCulled = false;
  body.parent.add(sm);
  sm.position.copy(body.position); sm.quaternion.copy(body.quaternion); sm.scale.copy(body.scale);
  return sm;
}

// Rigid geometry (built in the body mesh's bind space) turned into a skinned mesh with a weight function
function skinnedFrom(body, geo, weightFn, mat) {
  const g = geo;
  const n = g.attributes.position.count; const si = new Uint16Array(n * 4), sw = new Float32Array(n * 4), fl = new Float32Array(n);
  const p = new V3();
  for (let i = 0; i < n; i++) {
    p.fromBufferAttribute(g.attributes.position, i);
    const w = weightFn(p, i); // [[boneIndex, weight], ...]
    let tot = 0; w.forEach(([, x]) => (tot += x));
    for (let k = 0; k < 4; k++) { si[i * 4 + k] = w[k] ? w[k][0] : 0; sw[i * 4 + k] = w[k] ? w[k][1] / tot : 0; }
    fl[i] = w.fl || 0;
  }
  g.setAttribute('skinIndex', new THREE.BufferAttribute(si, 4)); g.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
  g.setAttribute('aFlutter', new THREE.BufferAttribute(fl, 1));
  if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
  g.computeVertexNormals();
  const sm = new THREE.SkinnedMesh(g, mat);
  sm.bind(body.skeleton, body.bindMatrix);
  sm.castShadow = true; sm.receiveShadow = true; sm.frustumCulled = false;
  body.parent.add(sm);
  sm.position.copy(body.position); sm.quaternion.copy(body.quaternion); sm.scale.copy(body.scale);
  return sm;
}

// fabric material with wind flutter
function fabric(color, rough, uFlut, opts = {}) {
  const m = std({ map: TEX.cloth.map, normalMap: TEX.cloth.normalMap, normalScale: new THREE.Vector2(0.45, 0.45), color, roughness: rough, metalness: 0, side: opts.side ?? THREE.DoubleSide }, {
    wet: opts.wet ?? 0.8, transl: opts.transl,
    vertHead: 'attribute float aFlutter; uniform vec3 uFlut; uniform float uFlTime;',
    vertexExtra: `\n transformed += uFlut * aFlutter * (0.6 + 0.4*sin(uFlTime*8.5 + position.y*40.0 + position.x*23.0)) * (0.8 + 0.2*sin(uFlTime*13.0 + position.z*30.0));\n`,
    onShader: (sh) => { sh.uniforms.uFlut = uFlut; sh.uniforms.uFlTime = U.uTime; },
  });
  // cloth texture repeats in body UV space: tighten it
  return m;
}

// ------------------------------------------------------------------ character assembly
export function buildCharacter(kind, o) {
  const tpl = kind === 'female' ? T.female : T.male;
  const root = new THREE.Group();
  const model = skClone(tpl.scene);
  model.rotation.y = Math.PI; // glTF faces +Z; our actors face -Z
  const rawH = kind === 'female' ? 1.77 : 1.81;
  const k = o.height / rawH;
  model.scale.setScalar(k);
  root.add(model);
  root.updateMatrixWorld(true);
  const uFlut = o.uFlut || { value: new V3() };
  let body = null, skeleton = null; const bodies = [];
  model.traverse((m) => {
    if (!m.isSkinnedMesh) return;
    skeleton = m.skeleton;
    const nm = m.material.name;
    if (/Hair|Eyebrow/.test(nm) || /Eyebrows|Hair/.test(m.name)) {
      const brow = /Eyebrow/.test(m.name) || /Hair_2/.test(nm);
      const hm = std({ map: m.material.map, normalMap: m.material.normalMap, color: brow ? (o.browColor ?? o.hairColor ?? 0xffffff) : (o.hairColor ?? 0xffffff), roughness: 0.75, transparent: false, alphaTest: 0.4, side: THREE.DoubleSide }, { wet: 0.6 });
      m.material = hm;
      if (/Hair/.test(m.name) && o.bald) m.visible = false;
    } else if (/Eyes/.test(nm)) {
      m.material = std({ map: m.material.map, normalMap: m.material.normalMap, roughness: 0.15 }, { wet: 0 });
    } else {
      // body: every primitive uses the same skin (outfit colours come from our shells)
      const src = m.material;
      const skinMap = o.skinMap || (/Skin|Superhero/.test(nm) ? src.map : null);
      m.material = std({ map: skinMap || (bodies[0] && bodies[0].material.map) || null, normalMap: src.normalMap || null, roughnessMap: src.roughnessMap || null, roughness: 0.62, color: o.skinTint ?? 0xffffff }, { wet: 0.5 });
      bodies.push(m);
    }
    m.castShadow = true; m.receiveShadow = true; m.frustumCulled = false;
  });
  // skin map for primitives that carried plain outfit colours
  let skinTex = o.skinMap || bodies.map((b) => b.material.map).find(Boolean);
  if (o.skinTone && skinTex) skinTex = neutralSkin(skinTex);
  const skinN = bodies.map((b) => b.material.normalMap).find(Boolean), skinR = bodies.map((b) => b.material.roughnessMap).find(Boolean);
  bodies.forEach((b) => { b.material.map = skinTex; b.material.normalMap = skinN; b.material.roughnessMap = skinR; b.material.needsUpdate = true; });
  body = bodies[0];
  const bones = skeleton.bones; const boneIdx = {}; bones.forEach((b, i) => (boneIdx[b.name] = i));
  const reg = bones.map((b) => regionOf(b.name));
  // bind-space helpers: bone rest positions in the body mesh's local (bind) space
  const bindInv = new THREE.Matrix4().copy(body.bindMatrixInverse);
  const bindPos = {};
  skeleton.pose();
  model.updateMatrixWorld(true);
  const meshInv = new THREE.Matrix4().copy(body.matrixWorld).invert();
  for (const b of bones) bindPos[b.name] = new V3().setFromMatrixPosition(b.matrixWorld).applyMatrix4(meshInv);
  // which axis is "up" and which is "forward" inside the bind space
  const upB = bindPos.Head.clone().sub(bindPos.pelvis).normalize();
  const fwdB = bindPos.ball_l.clone().sub(bindPos.foot_l); fwdB.sub(upB.clone().multiplyScalar(fwdB.dot(upB))).normalize();
  const leftB = new V3().crossVectors(upB, fwdB).normalize(); // glTF: +X is the character's left
  const hgt = (p) => p.clone().sub(bindPos.pelvis).dot(upB); // height relative to the pelvis
  const fwd = (p) => p.clone().sub(bindPos.Head).dot(fwdB);
  const lat = (p) => p.clone().sub(bindPos.pelvis).dot(leftB);
  const scaleB = bindPos.Head.distanceTo(bindPos.pelvis) / 0.65; // bind units per ~metre of body

  const vReg = (i, g) => { const SI = g.attributes.skinIndex, SW = g.attributes.skinWeight; let best = 0, bw = -1; for (let c = 0; c < 4; c++) { const w = SW.getComponent(i, c); if (w > bw) { bw = w; best = SI.getComponent(i, c); } } return reg[best]; };
  const triReg = (g, a, b, c) => { const r = [vReg(a, g), vReg(b, g), vReg(c, g)]; return r[0] === r[1] || r[0] === r[2] ? r[0] : r[1] === r[2] ? r[1] : r[0]; };
  const P = (g, i) => new V3().fromBufferAttribute(g.attributes.position, i);

  const parts = { root, model, skeleton, bones, boneIdx, body: bodies, uFlut, k, shells: [] };
  const O = o.outfit;
  const hipH = hgt(bindPos.thigh_l), kneeH = hgt(bindPos.calf_l), ankleH = hgt(bindPos.foot_l);
  const unit = scaleB; // bind-space units per metre (approx)
  // the body may be split into several primitives that share one vertex buffer: stitch them into one
  // source surface so every garment is a single connected shell
  const srcBodies = [];
  { const groups = new Map();
    for (const bm of bodies) { const key = bm.geometry.attributes.position; if (!groups.has(key)) groups.set(key, []); groups.get(key).push(bm); }
    for (const [, list] of groups) {
      if (list.length === 1) { srcBodies.push(list[0]); continue; }
      const g0 = list[0].geometry; const ix = [];
      for (const bm of list) ix.push(...bm.geometry.index.array);
      const mg = new THREE.BufferGeometry(); for (const kk in g0.attributes) mg.setAttribute(kk, g0.attributes[kk]); mg.setIndex(ix);
      const proxy = new THREE.SkinnedMesh(mg, list[0].material); proxy.bind(list[0].skeleton, list[0].bindMatrix);
      proxy.position.copy(list[0].position); proxy.quaternion.copy(list[0].quaternion); proxy.scale.copy(list[0].scale);
      proxy.parent = list[0].parent; // for shellFrom(): it adds shells to this parent
      srcBodies.push(proxy);
    }
  }
  let crownH = -1e9;
  { const g = srcBodies[0].geometry, ix = g.index.array; for (let t = 0; t < ix.length; t++) { const v = ix[t]; if (vReg(v, g) === 'head') crownH = Math.max(crownH, hgt(P(g, v))); } }
  for (const bm of srcBodies) {
    const g = bm.geometry;
    // ---- jacket / coat top
    if (O.top) {
      const hemH = hipH - (O.top.hem ?? 0.14) * unit;
      const sel = (a, b, c) => {
        const r = triReg(g, a, b, c);
        if (r === 'torso' || r === 'uarm' || (r === 'larm' && !O.top.short) || r === 'hand') return true;
        if (r === 'hip' || r === 'thigh') return Math.max(hgt(P(g, a)), hgt(P(g, b)), hgt(P(g, c))) > hemH;
        if (r === 'neck') return O.top.collar && Math.max(hgt(P(g, a)), hgt(P(g, b)), hgt(P(g, c))) < hgt(bindPos.neck_01) + 0.02 * unit;
        return false;
      };
      const off = (p, n, i) => { const r = vReg(i, g); return (r === 'larm' || r === 'uarm' ? O.top.sleeveLoose ?? 0.022 : O.top.loose ?? 0.03) * unit * (r === 'hip' || r === 'thigh' ? 0.9 : 1); };
      const fl = (p, i) => { const h = hgt(p); return Math.max(0, Math.min(1, (hipH + 0.12 * unit - h) / (0.3 * unit))) + (vReg(i, g) === 'larm' ? 0.15 : 0); };
      const wrist = { l: [bindPos.hand_l, bindPos.hand_l.clone().sub(bindPos.lowerarm_l).normalize()], r: [bindPos.hand_r, bindPos.hand_r.clone().sub(bindPos.lowerarm_r).normalize()] };
      const planes = [
        (pp) => hemH - hgt(pp),
        (pp) => pp.clone().sub(wrist.l[0]).dot(wrist.l[1]) + 0.035 * unit,
        (pp) => pp.clone().sub(wrist.r[0]).dot(wrist.r[1]) + 0.035 * unit,
      ];
      parts.shells.push(shellFrom(bm, sel, off, O.top.mat, fl, { smooth: O.top.smooth ?? 10, planes, unit }));
    }
    // ---- trousers
    if (O.pants) {
      const cuffH = ankleH - 0.005 * unit;
      const sel = (a, b, c) => { const r = triReg(g, a, b, c); if (r === 'hip' || r === 'thigh') return !O.pants.top || Math.min(hgt(P(g, a)), hgt(P(g, b)), hgt(P(g, c))) < kneeH + O.pants.top * unit; if (r === 'calf' || r === 'foot') return Math.max(hgt(P(g, a)), hgt(P(g, b)), hgt(P(g, c))) > cuffH; return false; };
      const off = (p, n, i) => { const r = vReg(i, g); const kn = Math.exp(-Math.pow((hgt(p) - kneeH) / (0.09 * unit), 2)); return (0.013 + 0.012 * kn + (r === 'calf' ? 0.004 : 0)) * unit; };
      parts.shells.push(shellFrom(bm, sel, off, O.pants.mat, () => 0, { smooth: 6, unit, planes: O.pants.top ? [(pp) => cuffH - hgt(pp), (pp) => hgt(pp) - (kneeH + O.pants.top * unit)] : [(pp) => cuffH - hgt(pp)] }));
    }
    // ---- hair cap (for bodies without modelled hair) or a cap
    if (O.hairCap || O.cap) {
      const headH = hgt(bindPos.Head);
      const cap = O.cap;
      // measure the top of the skull and the brow from the mesh itself
      let topH = -1e9; const ix = g.index.array;
      for (let t = 0; t < ix.length; t++) { const v = ix[t]; if (vReg(v, g) === 'head') topH = Math.max(topH, hgt(P(g, v))); }
      const sel = (a, b, c) => {
        if (triReg(g, a, b, c) !== 'head') return false;
        const ps = [P(g, a), P(g, b), P(g, c)];
        return ps.every((p) => {
          const h = topH - hgt(p), f = fwd(p) / unit; // depth below the crown; forward of the head bone
          if (cap) return h < (f > 0.02 ? 0.07 : 0.1) * unit;
          // hairline: well above the brow in front, lower over the ears and at the nape
          return h < (f > 0.03 ? 0.055 : f > -0.02 ? 0.09 : 0.16) * unit;
        });
      };
      parts.shells.push(shellFrom(bm, sel, () => (cap ? 0.014 : 0.014) * unit, cap ? O.cap.mat : O.hairCap.mat, () => 0, { smooth: 2, unit }));
    }
  }
  // hide the body where clothes fully cover it (avoids skin poking through at bends)
  for (const bm of bodies) {
    const g = bm.geometry; const idx = g.index.array; const keep = [];
    for (let t = 0; t < idx.length; t += 3) {
      const r = triReg(g, idx[t], idx[t + 1], idx[t + 2]);
      if (O.top && (r === 'torso' || r === 'uarm')) continue;
      if (O.pants && (r === 'thigh' || r === 'calf')) continue;
      if (O.shoes && r === 'foot') continue;
      keep.push(idx[t], idx[t + 1], idx[t + 2]);
    }
    const ng = g.clone(); ng.setIndex(keep); bm.geometry = ng;
  }
  // ---- extra garment pieces built in bind space
  const bi = (n) => boneIdx[n];
  if (O.shoes) { // lasted shoes: lofted from heel to toe, skinned to the foot and toe bones
    for (const sd of ['l', 'r']) {
      const fp = bindPos['foot_' + sd], bp = bindPos['ball_' + sd];
      const ground = hgt(bindPos.foot_l) - 0.086 * unit * (unit > 10 ? 1 : 1);
      const base = fp.clone().addScaledVector(upB, -hgt(fp) + (hgt(bindPos.pelvis) - hgt(bindPos.pelvis)));
      const fdir = bp.clone().sub(fp); fdir.sub(upB.clone().multiplyScalar(fdir.dot(upB))); const flen = fdir.length(); fdir.normalize();
      const side = new V3().crossVectors(upB, fdir).normalize();
      const floorH = hgt(fp) - 0.082 * unit; // sole height in pelvis-relative units
      const heelS = -0.075 * unit, toeS = flen + 0.085 * unit;
      const NS = 14, NR = 16; const pos = [], idx = [];
      const prof = (t) => { // width, height of the upper at t (0 heel .. 1 toe)
        const w = (0.043 + 0.011 * Math.sin(Math.min(1, t * 1.3) * Math.PI) - 0.012 * Math.max(0, t - 0.8) / 0.2) * unit;
        const h = (t < 0.35 ? 0.118 : 0.118 - (t - 0.35) / 0.65 * 0.07) * unit - Math.max(0, t - 0.93) / 0.07 * 0.02 * unit;
        return [w, h];
      };
      const origin = fp.clone().addScaledVector(upB, floorH - hgt(fp));
      for (let i = 0; i <= NS; i++) {
        const t = i / NS; const sAlong = heelS + (toeS - heelS) * t; const [w, h] = prof(t);
        const tipK = Math.pow(Math.max(0, (t - 0.85) / 0.15), 2), heelK = Math.pow(Math.max(0, (0.12 - t) / 0.12), 2);
        const wScale = 1 - 0.55 * tipK - 0.35 * heelK;
        for (let j = 0; j <= NR; j++) {
          const a = j / NR * Math.PI * 2; const ca = Math.cos(a), sa = Math.sin(a);
          const y = sa > 0 ? sa * h : sa * 0.012 * unit; // flat-ish sole
          const pnt = origin.clone().addScaledVector(fdir, sAlong).addScaledVector(side, ca * w * wScale).addScaledVector(upB, y + 0.012 * unit);
          pos.push(pnt.x, pnt.y, pnt.z);
        }
      }
      for (let i = 0; i < NS; i++) for (let j = 0; j < NR; j++) { const a = i * (NR + 1) + j, b = a + NR + 1; idx.push(a, a + 1, b, a + 1, b + 1, b); }
      // caps
      const capA = pos.length / 3; const oA = origin.clone().addScaledVector(fdir, heelS).addScaledVector(upB, 0.05 * unit); pos.push(oA.x, oA.y, oA.z);
      for (let j = 0; j < NR; j++) idx.push(capA, j + 1, j);
      const capB = pos.length / 3; const oB = origin.clone().addScaledVector(fdir, toeS).addScaledVector(upB, 0.03 * unit); pos.push(oB.x, oB.y, oB.z);
      const lb = NS * (NR + 1); for (let j = 0; j < NR; j++) idx.push(capB, lb + j, lb + j + 1);
      const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); sg.setIndex(idx);
      parts.shells.push(skinnedFrom(body, sg, (pt) => {
        const along = pt.clone().sub(fp).dot(fdir) / flen;
        const tw = Math.max(0, Math.min(1, (along - 0.75) / 0.35));
        return [[bi('foot_' + sd), 1 - tw], [bi('ball_' + sd), tw + 1e-4]];
      }, O.shoes.mat));
      // sole
      if (O.shoes.sole) {
        const sole = new THREE.BufferGeometry(); const sp = [], si2 = [];
        for (let i = 0; i <= NS; i++) { const t = i / NS; const sAlong = heelS + (toeS - heelS) * t; const [w] = prof(t); const tipK = Math.pow(Math.max(0, (t - 0.85) / 0.15), 2), heelK = Math.pow(Math.max(0, (0.12 - t) / 0.12), 2); const ww = w * (1 - 0.55 * tipK - 0.35 * heelK) * 1.06;
          for (const [sx, yy] of [[-1, 0], [1, 0], [-1, 0.016], [1, 0.016]]) { const pnt = origin.clone().addScaledVector(fdir, sAlong).addScaledVector(side, sx * ww).addScaledVector(upB, yy * unit); sp.push(pnt.x, pnt.y, pnt.z); } }
        for (let i = 0; i < NS; i++) { const a = i * 4, b = a + 4; si2.push(a, b, a + 1, a + 1, b, b + 1, a + 2, a + 3, b + 2, a + 3, b + 3, b + 2, a, a + 2, b, a + 2, b + 2, b, a + 1, b + 1, a + 3, a + 3, b + 1, b + 3); }
        sole.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3)); sole.setIndex(si2);
        parts.shells.push(skinnedFrom(body, sole, (pt) => { const along = pt.clone().sub(fp).dot(fdir) / flen; const tw = Math.max(0, Math.min(1, (along - 0.75) / 0.35)); return [[bi('foot_' + sd), 1 - tw], [bi('ball_' + sd), tw + 1e-4]]; }, O.shoes.sole));
      }
    }
  }
  if (O.collar) {
    const nb = bindPos.neck_01, sp = bindPos.spine_03;
    const c = nb.clone().lerp(sp, 0.35).addScaledVector(fwdB, -0.012 * unit);
    const tg = new THREE.TorusGeometry(0.075 * unit, 0.024 * unit, 10, 26);
    // orient: torus axis along up
    const m4 = new THREE.Matrix4().makeBasis(leftB, fwdB, upB); tg.applyMatrix4(m4); tg.translate(c.x, c.y, c.z);
    // squash front-back a bit
    parts.shells.push(skinnedFrom(body, tg, (p) => [[bi('spine_03'), 0.6], [bi('neck_01'), 0.4]], O.collar.mat));
  }
  if (O.skirt) { // long coat skirt from the hips to the knees, weighted between pelvis and thighs
    const topH = hipH + 0.1 * unit, botH = kneeH - (O.skirt.below ?? 0.02) * unit;
    const rings = 9, seg = 28; const pos = [], idx = [];
    const cx = bindPos.pelvis.clone();
    for (let r = 0; r <= rings; r++) {
      const t = r / rings; const h = topH + (botH - topH) * t;
      for (let s = 0; s <= seg; s++) {
        const a = s / seg * Math.PI * 2;
        const tt = Math.pow(t, 0.8); const rx = (0.175 + 0.12 * tt) * unit, rz = (Math.sin(a) > 0 ? 0.14 + 0.13 * tt : 0.13 + 0.07 * tt) * unit;
        const pnt = cx.clone().addScaledVector(upB, h).addScaledVector(leftB, Math.cos(a) * rx).addScaledVector(fwdB, Math.sin(a) * rz + 0.015 * unit);
        pos.push(pnt.x, pnt.y, pnt.z);
      }
    }
    for (let r = 0; r < rings; r++) for (let s = 0; s < seg; s++) { const a = r * (seg + 1) + s, b = a + seg + 1; idx.push(a, b, a + 1, a + 1, b, b + 1); }
    // front opening: drop two columns of quads at the very front
    const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); sg.setIndex(idx);
    parts.shells.push(skinnedFrom(body, sg, (p) => {
      const h = hgt(p); const t = Math.max(0, Math.min(1, (topH - h) / (topH - botH)));
      const l = lat(p) / (0.2 * unit);
      const fr = Math.max(0, fwd(p) / unit + 0.05) * 3; const wl = Math.min(1, Math.max(0, l + 0.2 * fr)) * t * 0.95, wr = Math.min(1, Math.max(0, -l + 0.2 * fr)) * t * 0.95;
      const w = [[bi('pelvis'), 1 - Math.max(wl, wr) + 0.05], [bi('thigh_l'), wl + 0.001], [bi('thigh_r'), wr + 0.001]];
      w.fl = t * t; return w;
    }, O.skirt.mat));
  }
  if (O.bun) {
    const hc = bindPos.Head.clone().addScaledVector(upB, 0.09 * unit).addScaledVector(fwdB, -0.1 * unit);
    const sgm = new THREE.SphereGeometry(0.052 * unit, 16, 12); sgm.translate(hc.x, hc.y, hc.z);
    parts.shells.push(skinnedFrom(body, sgm, () => [[bi('Head'), 1]], O.hairCap.mat));
  }
  if (O.cap) {
    const hc = bindPos.Head.clone().addScaledVector(upB, crownH - hgt(bindPos.Head) - 0.068 * unit).addScaledVector(fwdB, 0.09 * unit);
    const brim = new THREE.CylinderGeometry(0.085 * unit, 0.09 * unit, 0.008 * unit, 24, 1, false, -Math.PI / 2 - 1.1, 2.2);
    const m4 = new THREE.Matrix4().makeBasis(leftB, upB, fwdB.clone().negate()); brim.applyMatrix4(m4);
    brim.rotateX(0); brim.translate(hc.x, hc.y, hc.z);
    parts.shells.push(skinnedFrom(body, brim, () => [[bi('Head'), 1]], O.cap.mat));
  }
  // flutter only affects shells that asked for it; shells share the per-character uniform
  parts.srcCount = srcBodies.length; parts.bodyAttrs = bodies.map((b) => b.geometry.attributes.position.uuid || b.geometry.attributes.position.count);
  parts.rig = new GRig(root, model, skeleton);
  parts.mixer = new THREE.AnimationMixer(model);
  parts.play = (name, w = 1, speed = 1) => { const c = T.clips[name]; if (!c) return null; const a = parts.mixer.clipAction(c); a.setEffectiveWeight(w); a.timeScale = speed; a.play(); return a; };
  // local-space helper for the flutter uniform: world displacement -> bind space
  parts.setFlutter = (worldVec) => {
    body.updateMatrixWorld();
    const inv = new THREE.Matrix4().copy(body.matrixWorld).invert();
    const v = worldVec.clone().transformDirection(inv).multiplyScalar(worldVec.length() / (body.matrixWorld.getMaxScaleOnAxis() || 1));
    uFlut.value.copy(v);
  };
  parts.bindUnit = unit;
  return parts;
}

// The source skin texture carries a tan tone. For characters given an explicit skin tone, rebuild it as a
// near-neutral detail map (pores, blush, shading kept; average hue removed) so the tint alone sets the tone.
const _neutral = new Map();
function neutralSkin(tex) {
  if (_neutral.has(tex)) return _neutral.get(tex);
  let out = tex;
  try {
    const img = tex.image, w = img.width, h = img.height;
    const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d', { willReadFrequently: true });
    x.drawImage(img, 0, 0);
    const d = x.getImageData(0, 0, w, h), a = d.data; const m = [0, 0, 0]; const n = a.length / 4;
    for (let i = 0; i < a.length; i += 4) { m[0] += a[i]; m[1] += a[i + 1]; m[2] += a[i + 2]; }
    for (let k = 0; k < 3; k++) m[k] /= n;
    const lum = 0.3 * m[0] + 0.59 * m[1] + 0.11 * m[2];
    // keep a little of the original colour variation (lips, blush) while normalising each channel to ~236
    for (let i = 0; i < a.length; i += 4) for (let k = 0; k < 3; k++) {
      const v = a[i + k] / m[k] * 0.8 + (a[i + k] / lum) * 0.2;
      a[i + k] = Math.min(255, v * 236);
    }
    x.putImageData(d, 0, 0);
    out = new THREE.CanvasTexture(c); out.flipY = tex.flipY; out.colorSpace = tex.colorSpace; out.wrapS = tex.wrapS; out.wrapT = tex.wrapT; out.anisotropy = 4;
  } catch (e) { out = tex; }
  _neutral.set(tex, out); return out;
}

// ------------------------------------------------------------------ generic IK rig
const CH = { upperarm_l: 'lowerarm_l', lowerarm_l: 'hand_l', hand_l: 'middle_01_l', upperarm_r: 'lowerarm_r', lowerarm_r: 'hand_r', hand_r: 'middle_01_r', thigh_l: 'calf_l', calf_l: 'foot_l', foot_l: 'ball_l', thigh_r: 'calf_r', calf_r: 'foot_r', foot_r: 'ball_r', spine_03: 'neck_01', neck_01: 'Head' };
const _q1 = new Q(), _q2 = new Q(), _m1 = new THREE.Matrix4(), _m2 = new THREE.Matrix4(), _v1 = new V3(), _v2 = new V3();
export class GRig {
  constructor(root, model, skeleton) {
    this.root = root; this.b = {}; for (const b of skeleton.bones) this.b[b.name] = b;
    skeleton.pose(); root.updateMatrixWorld(true);
    const rq = root.getWorldQuaternion(new Q()).invert();
    this.restQG = {}; this.restPG = {}; this.restLocal = {}; this.restDir = {}; this.len = {};
    for (const n in this.b) {
      const b = this.b[n];
      this.restQG[n] = rq.clone().multiply(b.getWorldQuaternion(new Q()));
      this.restPG[n] = root.worldToLocal(b.getWorldPosition(new V3()));
      this.restLocal[n] = b.quaternion.clone();
    }
    for (const n in CH) { const d = this.restPG[CH[n]].clone().sub(this.restPG[n]); this.len[n] = d.length(); this.restDir[n] = d.normalize(); }
    this.palmRest = { l: new V3(0, -1, 0), r: new V3(0, -1, 0) };
  }
  worldPos(n, out = new V3()) { return this.b[n].getWorldPosition(out); }
  gQ() { return this.root.getWorldQuaternion(new Q()); }
  // orient bone n so its rest direction points along dirW and its rest side vector maps to sideW
  aim(n, dirW, sideRestG, sideW) {
    const gq = this.gQ(), gi = gq.clone().invert();
    const d1 = dirW.clone().applyQuaternion(gi).normalize();
    let s1 = sideW.clone().applyQuaternion(gi); s1.sub(d1.clone().multiplyScalar(s1.dot(d1)));
    if (s1.lengthSq() < 1e-8) return; s1.normalize();
    const d0 = this.restDir[n]; const s0 = sideRestG.clone().sub(d0.clone().multiplyScalar(sideRestG.dot(d0))).normalize();
    _m1.makeBasis(d0, s0, _v1.crossVectors(d0, s0)); _m2.makeBasis(d1, s1, _v2.crossVectors(d1, s1));
    _m2.multiply(_m1.transpose());
    const target = gq.multiply(_q1.setFromRotationMatrix(_m2).multiply(this.restQG[n]));
    const b = this.b[n]; b.parent.getWorldQuaternion(_q2);
    b.quaternion.copy(_q2.invert().multiply(target));
    b.updateMatrixWorld(true);
  }
  twoBone(up, lo, targetW, poleW, poleRestG) {
    const A = this.worldPos(up);
    const s = this.root.getWorldScale(new V3()).x;
    const l1 = this.len[up] * s, l2 = this.len[lo] * s;
    const AT = targetW.clone().sub(A); let d = AT.length();
    d = Math.min(Math.max(d, Math.abs(l1 - l2) + 1e-3), l1 + l2 - 1e-3);
    const dir = AT.normalize();
    const a = (l1 * l1 - l2 * l2 + d * d) / (2 * d); const h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
    const pv = poleW.clone().sub(A); pv.sub(dir.clone().multiplyScalar(pv.dot(dir))).normalize();
    const B = A.clone().addScaledVector(dir, a).addScaledVector(pv, h), Tt = A.clone().addScaledVector(dir, d);
    const nW = new V3().crossVectors(dir, pv).normalize();
    const pr = poleRestG.clone().normalize();
    this.aim(up, B.clone().sub(A), new V3().crossVectors(this.restDir[up], pr), nW);
    this.aim(lo, Tt.clone().sub(B), new V3().crossVectors(this.restDir[lo], pr), nW);
    return { B, T: Tt };
  }
  // hand: fingers along dirW, palm facing palmW
  hand(side, dirW, palmW) { this.aim('hand_' + side, dirW, this.palmRest[side], palmW); }
  // curl fingers (0 = flat, 1 = fist) and thumb
  curl(side, amt, thumb = amt * 0.7, spread = 0) {
    const hd = this.restDir['hand_' + side], pr = this.palmRest[side];
    const axisG = new V3().crossVectors(hd, pr).normalize();
    const fingers = ['index', 'middle', 'ring', 'pinky'];
    fingers.forEach((f, fi) => {
      for (let j = 1; j <= 3; j++) {
        const n = `${f}_0${j}_${side}`; const b = this.b[n]; if (!b) continue;
        const ax = axisG.clone().applyQuaternion(this.restQG[n].clone().invert());
        const ang = amt * [1.15, 1.35, 0.95][j - 1] * (1 + fi * 0.04);
        b.quaternion.copy(this.restLocal[n]).multiply(_q1.setFromAxisAngle(ax, ang));
        if (j === 1 && spread) { const ax2 = pr.clone().applyQuaternion(this.restQG[n].clone().invert()); b.quaternion.multiply(_q1.setFromAxisAngle(ax2, (fi - 1.5) * spread)); }
      }
    });
    // thumb: swing it under toward the palm (opposition), then bend the joints
    const t1 = this.restPG[`thumb_01_${side}`], t2 = this.restPG[`thumb_02_${side}`];
    if (t1 && t2) {
      const td = t2.clone().sub(t1).normalize();
      const opp = new V3().crossVectors(td, pr).normalize();
      for (let j = 1; j <= 3; j++) {
        const n = `thumb_0${j}_${side}`; const b = this.b[n]; if (!b) continue;
        const inv = this.restQG[n].clone().invert();
        const ax1 = opp.clone().applyQuaternion(inv), ax2 = axisG.clone().applyQuaternion(inv);
        b.quaternion.copy(this.restLocal[n]).multiply(_q1.setFromAxisAngle(ax1, thumb * [0.75, 0.35, 0.3][j - 1])).multiply(_q2.setFromAxisAngle(ax2, thumb * [0.2, 0.45, 0.5][j - 1]));
      }
    }
    this.b['hand_' + side].updateMatrixWorld(true);
  }
  // rotate a bone about a group-space axis (additive)
  rotG(n, axisG, ang) {
    const gq = this.gQ(); const axW = axisG.clone().applyQuaternion(gq).normalize();
    const b = this.b[n]; const wq = b.getWorldQuaternion(new Q());
    const tw = _q1.setFromAxisAngle(axW, ang).multiply(wq);
    b.parent.getWorldQuaternion(_q2); b.quaternion.copy(_q2.invert().multiply(tw)); b.updateMatrixWorld(true);
  }
  moveG(n, vecG) {
    const b = this.b[n]; const wp = b.getWorldPosition(new V3());
    wp.add(vecG.clone().applyQuaternion(this.gQ()).multiplyScalar(this.root.getWorldScale(new V3()).x));
    b.position.copy(b.parent.worldToLocal(wp)); b.updateMatrixWorld(true);
  }
}
