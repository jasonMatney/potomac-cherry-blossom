// Shared materials
import * as THREE from 'three';
import TEX from './tex.js';
import { std } from './matpatch.js';

export const M = {};
export const NIGHT_EMISSIVE = []; // [material, maxIntensity]

function rep(t, r = 1) { const c = t.clone(); c.repeat.set(r, r); c.needsUpdate = true; return c; }

export function buildMaterials() {
  const nm = (t, s = 1) => ({ normalMap: t.normalMap, normalScale: new THREE.Vector2(s, s) });
  M.granite = std({ map: TEX.granite.map, ...nm(TEX.granite, 1.2), roughness: 0.82, vertexColors: true, color: 0xe4ddd0 });
  M.graniteFlood = std({ map: TEX.granite.map, ...nm(TEX.granite, 1.2), roughness: 0.82, vertexColors: true, color: 0xe4ddd0 }, { flood: { base: -1, top: 14, pow: 0.9 } });
  M.graniteDark = std({ map: TEX.graniteDark.map, ...nm(TEX.graniteDark, 1), roughness: 0.8, vertexColors: true });
  M.marble = std({ map: TEX.marble.map, ...nm(TEX.marble, 0.5), roughness: 0.55, vertexColors: true }, { flood: { base: 2, top: 32, pow: 1.1 } });
  M.marbleK = std({ map: TEX.marble.map, ...nm(TEX.marble, 0.5), roughness: 0.55, vertexColors: true }, { flood: { base: 2, top: 26, pow: 0.8, dir: [0, 0.2, 1] } });
  M.obelisk = std({ map: TEX.granite.map, ...nm(TEX.granite, 0.35), roughness: 0.6, color: 0xf2eee4, vertexColors: true }, { flood: { base: 0, top: 150, pow: 1.3, dir: [1, 0.2, 1] } });
  M.concrete = std({ map: TEX.concrete.map, ...nm(TEX.concrete, 0.8), roughness: 0.9, vertexColors: true }, { flood: { base: -1, top: 20, pow: 0.5 } });
  M.brick = std({ map: TEX.brick.map, ...nm(TEX.brick, 0.8), roughness: 0.88, vertexColors: true });
  M.paving = std({ map: TEX.paving.map, ...nm(TEX.paving, 0.7), roughness: 0.78, vertexColors: true });
  M.asphalt = std({ map: TEX.concrete.map, color: 0x55565a, roughness: 0.95, vertexColors: true });
  M.gravel = std({ map: TEX.sand.map, color: 0xd8ccb8, roughness: 1, vertexColors: true });
  M.wood = std({ map: TEX.wood.map, ...nm(TEX.wood, 0.8), roughness: 0.85, vertexColors: true });
  M.metalDark = std({ color: 0x2c2f33, roughness: 0.45, metalness: 0.75, vertexColors: true });
  M.metalBronze = std({ color: 0x8a6a3a, roughness: 0.35, metalness: 0.9, vertexColors: true });
  M.steel = std({ color: 0xd8dde2, roughness: 0.18, metalness: 1.0, vertexColors: true });
  M.alu = std({ color: 0xc4c8cc, roughness: 0.3, metalness: 1.0, vertexColors: true });
  M.roofDark = std({ color: 0x3a3c40, roughness: 0.8, vertexColors: true });
  M.whitePaint = std({ color: 0xe8e6e0, roughness: 0.6, vertexColors: true });
  M.asphaltRoad = M.asphalt;
  const lg = rep(TEX.litGrid.map, 0.25), lgl = rep(TEX.litGlass.map, 0.25);
  M.facade = std({ map: TEX.windows.map, ...nm(TEX.windows, 0.6), roughness: 0.7, vertexColors: true, emissive: 0xffffff, emissiveMap: lg, emissiveIntensity: 0 });
  M.brickWin = std({ map: TEX.brickWin.map, ...nm(TEX.brickWin, 0.7), roughness: 0.8, vertexColors: true, emissive: 0xffffff, emissiveMap: lg, emissiveIntensity: 0 });
  M.glass = std({ map: TEX.glass.map, roughness: 0.12, metalness: 0.55, vertexColors: true, color: 0xb8c8d4, emissive: 0xffffff, emissiveMap: lgl, emissiveIntensity: 0, envMapIntensity: 1.2 });
  M.glassDark = std({ color: 0x1a2228, roughness: 0.08, metalness: 0.4, envMapIntensity: 1.3 });
  M.glassWarm = std({ color: 0x20262a, roughness: 0.1, metalness: 0.4, emissive: 0xffc27a, emissiveIntensity: 0 });
  M.lampGlow = new THREE.MeshBasicMaterial({ color: 0xfff1d6 });
  M.lampGlowWarm = new THREE.MeshBasicMaterial({ color: 0xffd9a0 });
  M.redBeacon = new THREE.MeshBasicMaterial({ color: 0xff2010 });
  NIGHT_EMISSIVE.push([M.facade, 2.2], [M.brickWin, 2.0], [M.glass, 1.6], [M.glassWarm, 3.0]);
  for (const k in M) if (M[k].map) M[k].map.anisotropy = 8;
  return M;
}
