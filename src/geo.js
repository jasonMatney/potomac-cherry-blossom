// Geometry helpers
import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

export { mergeVertices };
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _s = new THREE.Vector3(), _p = new THREE.Vector3();

export function tf(g, { x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1, s } = {}) {
  if (s !== undefined) sx = sy = sz = s;
  _e.set(rx, ry, rz, 'YXZ'); _q.setFromEuler(_e);
  _m.compose(_p.set(x, y, z), _q, _s.set(sx, sy, sz));
  g.applyMatrix4(_m);
  return g;
}
export function box(w, h, d, o) { return tf(new THREE.BoxGeometry(w, h, d), o); }
export function rbox(w, h, d, r, o, seg = 2) { return tf(new RoundedBoxGeometry(w, h, d, seg, Math.min(r, w / 2 - 1e-3, h / 2 - 1e-3, d / 2 - 1e-3)), o); }
export function cyl(rt, rb, h, seg, o, open = false) { return tf(new THREE.CylinderGeometry(rt, rb, h, seg, 1, open), o); }
export function sph(r, ws, hs, o) { return tf(new THREE.SphereGeometry(r, ws, hs), o); }
export function tor(r, t, rs, ts, o, arc = Math.PI * 2) { return tf(new THREE.TorusGeometry(r, t, rs, ts, arc), o); }

// planar box-projected UVs in world metres
export function boxUV(g, scale = 1, off = [0, 0, 0]) {
  if (!g.attributes.normal) g.computeVertexNormals();
  const p = g.attributes.position, n = g.attributes.normal;
  const uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i)), az = Math.abs(n.getZ(i));
    const x = p.getX(i) + off[0], y = p.getY(i) + off[1], z = p.getZ(i) + off[2];
    let u, v;
    if (ay >= ax && ay >= az) { u = x; v = z; }
    else if (ax >= az) { u = z; v = y; }
    else { u = x; v = y; }
    uv[i * 2] = u * scale; uv[i * 2 + 1] = v * scale;
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return g;
}

export function ensureColor(g, r = 1, gg = r, b = r) {
  if (g.attributes.color) return g;
  const n = g.attributes.position.count; const c = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { c[i * 3] = r; c[i * 3 + 1] = gg; c[i * 3 + 2] = b; }
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  return g;
}
// multiply vertex colour by f(x,y,z,nx,ny,nz)
export function shade(g, f) {
  ensureColor(g);
  const p = g.attributes.position, n = g.attributes.normal, c = g.attributes.color;
  for (let i = 0; i < p.count; i++) {
    const k = f(p.getX(i), p.getY(i), p.getZ(i), n ? n.getX(i) : 0, n ? n.getY(i) : 1, n ? n.getZ(i) : 0);
    c.setXYZ(i, c.getX(i) * k, c.getY(i) * k, c.getZ(i) * k);
  }
  return g;
}
export function tint(g, r, gg, b) {
  ensureColor(g); const c = g.attributes.color;
  for (let i = 0; i < c.count; i++) c.setXYZ(i, c.getX(i) * r, c.getY(i) * gg, c.getZ(i) * b);
  return g;
}

// merge heterogeneous geometries: keep position, normal, uv, color (+ optional extra attrs)
export function merge(list, extra = []) {
  const keep = ['position', 'normal', 'uv', 'color', ...extra];
  const gs = list.filter(Boolean).map((g0) => {
    let g = g0.index ? g0.toNonIndexed() : g0;
    if (!g.attributes.normal) g.computeVertexNormals();
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    ensureColor(g);
    for (const e of extra) if (!g.attributes[e]) {
      const sz = e === 'aWind' ? 4 : 1;
      g.setAttribute(e, new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * sz), sz));
    }
    for (const k of Object.keys(g.attributes)) if (!keep.includes(k)) g.deleteAttribute(k);
    g.morphAttributes = {};
    return g;
  });
  if (!gs.length) return new THREE.BufferGeometry();
  const m = mergeGeometries(gs, false);
  return m;
}

// Tube along a polyline with per-point radius. returns geometry with uv (u around, v along in metres)
export function tube(pts, radii, seg = 8, { capEnd = false, uvScale = 1, twist = 0, noise = null } = {}) {
  const n = pts.length;
  const pos = [], nor = [], uv = [], idx = [];
  const T = [], N = [], B = [];
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
    T.push(new THREE.Vector3().subVectors(b, a).normalize());
  }
  let nrm = new THREE.Vector3(0, 1, 0);
  if (Math.abs(T[0].y) > 0.9) nrm.set(1, 0, 0);
  nrm = new THREE.Vector3().crossVectors(T[0], nrm).normalize();
  for (let i = 0; i < n; i++) {
    if (i > 0) { // parallel transport
      const ax = new THREE.Vector3().crossVectors(T[i - 1], T[i]);
      const l = ax.length();
      if (l > 1e-6) { ax.divideScalar(l); const ang = Math.acos(Math.min(1, Math.max(-1, T[i - 1].dot(T[i])))); nrm.applyAxisAngle(ax, ang); }
    }
    N.push(nrm.clone()); B.push(new THREE.Vector3().crossVectors(T[i], nrm));
  }
  let vlen = 0;
  for (let i = 0; i < n; i++) {
    if (i > 0) vlen += pts[i].distanceTo(pts[i - 1]);
    const r = radii[i];
    for (let j = 0; j <= seg; j++) {
      const a = (j / seg) * Math.PI * 2 + twist * i;
      const ca = Math.cos(a), sa = Math.sin(a);
      let rr = r;
      if (noise) rr *= noise(i, j, a);
      const dx = N[i].x * ca + B[i].x * sa, dy = N[i].y * ca + B[i].y * sa, dz = N[i].z * ca + B[i].z * sa;
      pos.push(pts[i].x + dx * rr, pts[i].y + dy * rr, pts[i].z + dz * rr);
      nor.push(dx, dy, dz);
      uv.push(j / seg * Math.max(1, Math.round(r * 2 * Math.PI * uvScale)), vlen * uvScale);
    }
  }
  for (let i = 0; i < n - 1; i++) for (let j = 0; j < seg; j++) {
    const a = i * (seg + 1) + j, b = a + seg + 1;
    idx.push(a, b, a + 1, a + 1, b, b + 1);
  }
  if (capEnd) {
    const c = pos.length / 3; const p = pts[n - 1];
    pos.push(p.x + T[n - 1].x * radii[n - 1] * 0.5, p.y + T[n - 1].y * radii[n - 1] * 0.5, p.z + T[n - 1].z * radii[n - 1] * 0.5); nor.push(T[n - 1].x, T[n - 1].y, T[n - 1].z); uv.push(0.5, vlen * uvScale);
    const base = (n - 1) * (seg + 1);
    for (let j = 0; j < seg; j++) idx.push(base + j, c, base + j + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

// Extrude a 2D shape (x,y) along z by depth, centred on z
export function extrude(shape, depth, o, bevel = 0) {
  const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 1, curveSegments: 16 });
  g.translate(0, 0, -depth / 2);
  return tf(g, o);
}

// Quad strip between two polylines (arrays of Vector3)
export function strip(a, b, uvFn) {
  const pos = [], uv = [], idx = [];
  for (let i = 0; i < a.length; i++) {
    pos.push(a[i].x, a[i].y, a[i].z, b[i].x, b[i].y, b[i].z);
    const u = uvFn ? uvFn(i) : [i, 0, i, 1];
    uv.push(u[0], u[1], u[2], u[3]);
  }
  for (let i = 0; i < a.length - 1; i++) { const k = i * 2; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals();
  return g;
}
