// Retarget the animation library onto a MakeHuman character (different bone rest orientations, same names).
// For every frame: each bone's world rotation relative to the source rest pose is applied on top of the target's
// rest pose; the pelvis translation is scaled by the ratio of leg lengths.
// usage: node tools/retarget.mjs character.glb out.glb [clip names...]
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import * as THREE from 'three';

const [,, charPath, outPath, ...want] = process.argv;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const src = await io.read('assets/anims.glb');
const srcRest = await io.read('assets/male.glb');
const dst = await io.read(charPath);
const Q = THREE.Quaternion, V = THREE.Vector3;

// skeleton description from a document: name -> {node, parent name, rest local TRS}
function skeleton(doc) {
  const out = new Map();
  const walk = (n, parent) => {
    const t = n.getTranslation(), r = n.getRotation();
    out.set(n.getName(), { node: n, parent, t: new V(...t), r: new Q(...r) });
    for (const c of n.listChildren()) walk(c, n.getName());
  };
  for (const scene of doc.getRoot().listScenes()) for (const n of scene.listChildren()) walk(n, null);
  return out;
}
const S = skeleton(srcRest), D = skeleton(dst);
// world rest rotations/positions
function worldRest(sk) {
  const g = new Map();
  const get = (name) => {
    if (g.has(name)) return g.get(name);
    const b = sk.get(name); let q = b.r.clone(), p = b.t.clone();
    if (b.parent && sk.has(b.parent)) { const P = get(b.parent); p.applyQuaternion(P.q).add(P.p); q = P.q.clone().multiply(b.r); }
    const res = { q, p }; g.set(name, res); return res;
  };
  for (const k of sk.keys()) get(k);
  return g;
}
const SW = worldRest(S), DW = worldRest(D);
const bones = [...D.keys()].filter((n) => S.has(n));
console.log('bones mapped', bones.length, 'of', D.size, 'missing in source:', [...D.keys()].filter((n) => !S.has(n)).join(' '));
// both rigs should face the same way; measure with the hips->head and left->right hip directions
const dirs = (W) => ({ up: W.get('Head').p.clone().sub(W.get('pelvis').p).normalize(), side: W.get('thigh_l').p.clone().sub(W.get('thigh_r').p).normalize() });
const ds = dirs(SW), dd = dirs(DW);
console.log('src up', ds.up.toArray().map((x) => x.toFixed(2)), 'side', ds.side.toArray().map((x) => x.toFixed(2)));
console.log('dst up', dd.up.toArray().map((x) => x.toFixed(2)), 'side', dd.side.toArray().map((x) => x.toFixed(2)));
const basis = (d) => { const z = new V().crossVectors(d.side, d.up).normalize(); const x = new V().crossVectors(d.up, z).normalize(); return new THREE.Matrix4().makeBasis(x, d.up, z); };
const A = new Q().setFromRotationMatrix(basis(dd).multiply(basis(ds).clone().invert())); // source world -> target world
const Ai = A.clone().invert();
// Bring the target into the source's rest shape (e.g. A-pose -> T-pose): top-down, rotate each bone so the
// direction to its child joint matches the source's rest direction. Motion is then transferred from that pose.
const CHAIN = [['clavicle', 'upperarm'], ['upperarm', 'lowerarm'], ['lowerarm', 'hand'], ['hand', 'middle_01'],
  ['thumb_01', 'thumb_02'], ['thumb_02', 'thumb_03'], ['index_01', 'index_02'], ['index_02', 'index_03'], ['middle_01', 'middle_02'], ['middle_02', 'middle_03'],
  ['ring_01', 'ring_02'], ['ring_02', 'ring_03'], ['pinky_01', 'pinky_02'], ['pinky_02', 'pinky_03'], ['thigh', 'calf'], ['calf', 'foot'], ['foot', 'ball']];
const childOf = new Map(); for (const sd of ['l', 'r']) for (const [a, b] of CHAIN) childOf.set(a + '_' + sd, b + '_' + sd);
childOf.set('neck_01', 'Head'); childOf.set('spine_03', 'neck_01');
const TL = new Map([...D.entries()].map(([k, b]) => [k, b.r.clone()])); // target local rotations being adjusted
const worldOf = (sk, L) => { const g = new Map(); const get = (name) => { if (g.has(name)) return g.get(name); const b = sk.get(name); const l = L.get(name); let q = l.clone(), p = b.t.clone(); if (b.parent && sk.has(b.parent)) { const P = get(b.parent); p.applyQuaternion(P.q).add(P.p); q = P.q.clone().multiply(l); } const r = { q, p }; g.set(name, r); return r; }; for (const k of sk.keys()) get(k); return g; };
const order = []; { const visit = (name) => { order.push(name); for (const [k, b] of D) if (b.parent === name) visit(k); }; for (const [k, b] of D) if (!b.parent || !D.has(b.parent)) visit(k); }
for (const name of order) {
  const c = childOf.get(name); if (!c || !D.has(c) || !S.has(name) || !S.has(c)) continue;
  const W = worldOf(D, TL); const dt = W.get(c).p.clone().sub(W.get(name).p).normalize();
  const dsrc = SW.get(c).p.clone().sub(SW.get(name).p).normalize().applyQuaternion(A);
  const F = new Q().setFromUnitVectors(dt, dsrc);
  const b = D.get(name); const parentQ = b.parent && W.has(b.parent) ? W.get(b.parent).q : new Q();
  const newW = F.multiply(W.get(name).q); TL.set(name, parentQ.clone().invert().multiply(newW).normalize());
}
const DWT = worldOf(D, TL);
{ const W0 = DW; let mx = 0, who = ''; for (const n of bones) { const a = W0.get(n).q.angleTo(DWT.get(n).q); if (a > mx) { mx = a; who = n; } } console.log('rest-shape correction: largest', (mx * 57.3).toFixed(1) + 'deg at', who); }
const legLen = (W) => W.get('thigh_l').p.distanceTo(W.get('calf_l').p) + W.get('calf_l').p.distanceTo(W.get('foot_l').p);
const kLeg = legLen(DW) / legLen(SW);
console.log('leg ratio', kLeg.toFixed(3));

// sample a channel at time t
function sampler(ch) {
  const s = ch.getSampler(); const tin = s.getInput().getArray(), tout = s.getOutput().getArray(); const n = ch.getTargetPath() === 'rotation' ? 4 : 3;
  return (t) => {
    let i = 0; while (i < tin.length - 1 && tin[i + 1] < t) i++;
    const j = Math.min(i + 1, tin.length - 1); const u = j === i ? 0 : THREE.MathUtils.clamp((t - tin[i]) / (tin[j] - tin[i]), 0, 1);
    if (n === 4) { const a = new Q().fromArray(tout, i * 4), b = new Q().fromArray(tout, j * 4); return a.slerp(b, u); }
    const a = new V().fromArray(tout, i * 3), b = new V().fromArray(tout, j * 3); return a.lerp(b, u);
  };
}

const root = dst.getRoot(); const buf = root.listBuffers()[0] || dst.createBuffer();
for (const anim of src.getRoot().listAnimations()) {
  if (want.length && !want.includes(anim.getName())) continue;
  const rot = new Map(), pos = new Map(); let T = 0;
  for (const ch of anim.listChannels()) {
    const name = ch.getTargetNode().getName(); const path = ch.getTargetPath();
    const inp = ch.getSampler().getInput().getArray(); T = Math.max(T, inp[inp.length - 1]);
    if (path === 'rotation') rot.set(name, sampler(ch)); else if (path === 'translation') pos.set(name, sampler(ch));
  }
  const fps = 30, n = Math.max(2, Math.round(T * fps) + 1);
  const times = new Float32Array(n); for (let i = 0; i < n; i++) times[i] = Math.min(T, i / fps);
  const outRot = new Map(bones.map((b) => [b, new Float32Array(n * 4)])); const pelvisT = new Float32Array(n * 3);
  for (let f = 0; f < n; f++) {
    const t = times[f];
    // source world rotations at t
    const sg = new Map();
    const sG = (name) => { if (sg.has(name)) return sg.get(name); const b = S.get(name); const l = rot.has(name) ? rot.get(name)(t) : b.r; const q = b.parent && S.has(b.parent) ? sG(b.parent).clone().multiply(l) : l.clone(); sg.set(name, q); return q; };
    const tg = new Map();
    for (const name of bones) {
      // delta from the source rest pose, expressed in the target's frame
      const delta = sG(name).clone().multiply(SW.get(name).q.clone().invert());
      const deltaT = A.clone().multiply(delta).multiply(Ai);
      tg.set(name, deltaT.multiply(DWT.get(name).q.clone()));
    }
    for (const name of bones) {
      const b = D.get(name); const parentW = b.parent && tg.has(b.parent) ? tg.get(b.parent) : (b.parent ? DW.get(b.parent).q : new Q());
      const l = parentW.clone().invert().multiply(tg.get(name)); l.normalize(); l.toArray(outRot.get(name), f * 4);
    }
    // pelvis: source offset from its rest position (in the source's parent frame, world-ish), scaled, onto the target rest
    const sp = S.get('pelvis'); const p = pos.has('pelvis') ? pos.get('pelvis')(t) : sp.t;
    const off = p.clone().sub(sp.t).multiplyScalar(kLeg).applyQuaternion(A);
    D.get('pelvis').t.clone().add(off).toArray(pelvisT, f * 3);
  }
  const a = dst.createAnimation(anim.getName());
  const input = dst.createAccessor().setArray(times).setType('SCALAR').setBuffer(buf);
  for (const name of bones) {
    const s = dst.createAnimationSampler().setInput(input).setOutput(dst.createAccessor().setArray(outRot.get(name)).setType('VEC4').setBuffer(buf)).setInterpolation('LINEAR');
    a.addSampler(s).addChannel(dst.createAnimationChannel().setTargetNode(D.get(name).node).setTargetPath('rotation').setSampler(s));
  }
  const s = dst.createAnimationSampler().setInput(input).setOutput(dst.createAccessor().setArray(pelvisT).setType('VEC3').setBuffer(buf)).setInterpolation('LINEAR');
  a.addSampler(s).addChannel(dst.createAnimationChannel().setTargetNode(D.get('pelvis').node).setTargetPath('translation').setSampler(s));
  console.log('clip', anim.getName(), T.toFixed(2) + 's', n, 'frames');
}
await io.write(outPath, dst);
console.log('wrote', outPath);
