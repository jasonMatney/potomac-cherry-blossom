// Freeze a detailed group (including posed skinned characters) into a handful of static meshes,
// one per material, so background boats cost a few draw calls each.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const _p = new THREE.Vector3(), _q = new THREE.Vector3(), _n = new THREE.Vector3();

// skinned mesh -> plain geometry in the mesh's local space, at the current pose
function bakeSkin(mesh) {
  const src = mesh.geometry, pos = src.attributes.position, nor = src.attributes.normal;
  mesh.skeleton.update();
  const g = new THREE.BufferGeometry();
  const P = new Float32Array(pos.count * 3), N = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    _p.fromBufferAttribute(pos, i); mesh.applyBoneTransform(i, _p);
    P[i * 3] = _p.x; P[i * 3 + 1] = _p.y; P[i * 3 + 2] = _p.z;
    if (nor) {
      _q.fromBufferAttribute(pos, i); _n.fromBufferAttribute(nor, i); _q.addScaledVector(_n, 0.01); mesh.applyBoneTransform(i, _q);
      _q.sub(_p).normalize(); N[i * 3] = _q.x; N[i * 3 + 1] = _q.y; N[i * 3 + 2] = _q.z;
    }
  }
  g.setAttribute('position', new THREE.BufferAttribute(P, 3));
  if (nor) g.setAttribute('normal', new THREE.BufferAttribute(N, 3));
  for (const k in src.attributes) if (!['position', 'normal', 'skinIndex', 'skinWeight'].includes(k)) g.setAttribute(k, src.attributes[k]);
  if (src.index) g.setIndex(src.index);
  if (src.groups.length) for (const gr of src.groups) g.addGroup(gr.start, gr.count, gr.materialIndex);
  if (!nor) g.computeVertexNormals();
  return g;
}

function toFloat(a) {
  const n = a.count, s = a.itemSize, arr = new Float32Array(n * s);
  for (let i = 0; i < n; i++) for (let c = 0; c < s; c++) arr[i * s + c] = a.getComponent(i, c);
  return new THREE.BufferAttribute(arr, s);
}

// keep: meshes that must stay separate (e.g. navigation lenses whose colour animates)
export function flatten(root, keep = new Set()) {
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const buckets = new Map(), kept = [];
  root.traverse((o) => {
    if (!o.isMesh || !o.visible) return;
    let vis = true; for (let p = o; p && p !== root; p = p.parent) if (!p.visible) vis = false; if (!vis) return;
    if (keep.has(o)) { kept.push(o); return; }
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    let g = o.isSkinnedMesh ? bakeSkin(o) : o.geometry.clone();
    const m = new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld);
    g.applyMatrix4(m);
    const parts = [];
    if (Array.isArray(o.material) && g.groups.length) {
      const gi = g.index ? g.toNonIndexed() : g;
      for (const gr of g.groups) { const sub = new THREE.BufferGeometry(); for (const k in gi.attributes) { const a = gi.attributes[k]; sub.setAttribute(k, new THREE.BufferAttribute(a.array.slice(gr.start * a.itemSize, (gr.start + gr.count) * a.itemSize), a.itemSize)); } parts.push([sub, mats[gr.materialIndex]]); }
    } else parts.push([g, mats[0]]);
    for (const [pg, mat] of parts) {
      pg.clearGroups();
      if (!buckets.has(mat)) buckets.set(mat, { list: [], cast: false });
      const b = buckets.get(mat); b.list.push(pg); b.cast = b.cast || o.castShadow;
    }
  });
  const out = new THREE.Group();
  for (const [mat, b] of buckets) {
    // unify attribute sets within the bucket
    const names = new Set(); for (const g of b.list) for (const k in g.attributes) names.add(k);
    names.delete('skinIndex'); names.delete('skinWeight');
    const gs = b.list.map((g0) => {
      const g = g0.index ? g0.toNonIndexed() : g0; g.morphAttributes = {};
      const n = g.attributes.position.count;
      for (const k of names) if (!g.attributes[k]) {
        const ref = b.list.find((x) => x.attributes[k]).attributes[k];
        const arr = new Float32Array(n * ref.itemSize); if (k === 'color') arr.fill(1);
        g.setAttribute(k, new THREE.BufferAttribute(arr, ref.itemSize));
      }
      for (const k in g.attributes) { if (!names.has(k)) g.deleteAttribute(k); else if (!(g.attributes[k].array instanceof Float32Array) || g.attributes[k].isInterleavedBufferAttribute) g.setAttribute(k, toFloat(g.attributes[k])); }
      return g;
    });
    if (mat.vertexColors && !names.has('color')) for (const g of gs) g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 3).fill(1), 3));
    const merged = mergeGeometries(gs, false);
    if (!merged) continue;
    merged.computeBoundingSphere();
    const mesh = new THREE.Mesh(merged, mat); mesh.castShadow = b.cast; mesh.receiveShadow = true;
    out.add(mesh);
  }
  out.userData.kept = new Map();
  for (const o of kept) { const m = new THREE.Mesh(o.geometry.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld)), o.material); out.add(m); out.userData.kept.set(o, m); }
  return out;
}
