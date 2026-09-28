// Shared registries: point lights, camera-blocking solids, placement helpers
import * as THREE from 'three';
import { frame, fromSD, hw } from './world.js';
import { obstacles } from './water.js';

export const LIGHTS = []; // {p, col, range, I, on:(fn)?, dyn}
export const SOLIDS = []; // OBB {c, h, yaw, cos, sin} in world
export const SOLID_FNS = []; // (x,y,z) => bool
export const CANOPIES = []; // {x,y,z,r}
export const CAST = []; // extra objects for camera clearance checks

export function addLight(p, col, range, I, extra = {}) {
  const L = { p: p.clone(), col: new THREE.Color(col), range, I, ...extra };
  LIGHTS.push(L); return L;
}
export function addSolid(cx, cy, cz, hx, hy, hz, yaw = 0) {
  SOLIDS.push({ c: new THREE.Vector3(cx, cy, cz), h: new THREE.Vector3(hx, hy, hz), yaw, cos: Math.cos(yaw), sin: Math.sin(yaw) });
}
export function addObstacle(o) { obstacles.push(o); return o; }
// things a person on foot can't walk through: circles {x,z,r} and boxes {x,z,hx,hz,yaw}
export const WALK = [];
export function addWalkBlock(o) { if (o.hx !== undefined) { o.c = Math.cos(o.yaw || 0); o.s = Math.sin(o.yaw || 0); o.br = Math.hypot(o.hx, o.hz); } else o.br = o.r; WALK.push(o); return o; }
// is a body of radius r at (x,z) overlapping a blocker? (dynamic ones are passed in)
export function walkBlocked(x, z, r, extra) {
  const test = (o) => {
    const dx = x - o.x, dz = z - o.z; if (Math.abs(dx) > o.br + r || Math.abs(dz) > o.br + r) return false;
    if (o.hx === undefined) return dx * dx + dz * dz < (o.r + r) * (o.r + r);
    // box rotated by yaw about Y (three.js convention: local x -> (c, -s))
    const lx = dx * o.c - dz * o.s, lz = dx * o.s + dz * o.c;
    const qx = Math.max(Math.abs(lx) - o.hx, 0), qz = Math.max(Math.abs(lz) - o.hz, 0);
    return qx * qx + qz * qz < r * r;
  };
  for (const o of WALK) if (test(o)) return true;
  if (extra) for (const o of extra) { if (o.br === undefined) o.br = o.r; if (test(o)) return true; }
  return false;
}

// Frame helpers: world position & yaw from (s, d) with y
export function sdPos(s, d, y = 0) { const [x, z] = fromSD(s, d); return new THREE.Vector3(x, y, z); }
// yaw so that local -Z faces upstream (river forward) at s, plus offset
export function sdYaw(s, off = 0) { const F = frame(s); return -F.th + off; }
// For objects whose local +X should point to river right (east)
export function bankE(s, side, e) { return side * (hw(s, side) + e); }

export function inSolid(x, y, z, pad = 0) {
  for (const b of SOLIDS) {
    const dx = x - b.c.x, dz = z - b.c.z;
    const lx = dx * b.cos - dz * b.sin, lz = dx * b.sin + dz * b.cos;
    if (Math.abs(lx) < b.h.x + pad && Math.abs(y - b.c.y) < b.h.y + pad && Math.abs(lz) < b.h.z + pad) return true;
  }
  for (const f of SOLID_FNS) if (f(x, y, z, pad)) return true;
  for (const c of CANOPIES) {
    const dx = x - c.x, dy = (y - c.y) * 1.3, dz = z - c.z; const r = c.r + pad;
    if (dx * dx + dy * dy + dz * dz < r * r) return true;
  }
  return false;
}
