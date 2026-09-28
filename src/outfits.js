// Outfits for the three characters
import * as THREE from 'three';
import { buildCharacter, humanTex } from './humans.js';
import { std, U } from './matpatch.js';
import TEX from './tex.js';

function fab(color, rough, uFlut, o = {}) {
  return std({ map: o.plain ? null : TEX.cloth.map, normalMap: o.plain ? null : TEX.cloth.normalMap, normalScale: new THREE.Vector2(0.5, 0.5), color, roughness: rough, metalness: 0, side: THREE.DoubleSide }, {
    wet: o.wet ?? 0.8, transl: o.transl,
    vertHead: 'attribute float aFlutter; uniform vec3 uFlut; uniform float uFlTime;',
    vertexExtra: `\n transformed += uFlut * aFlutter * (0.6 + 0.4*sin(uFlTime*8.5 + position.y*40.0 + position.x*23.0)) * (0.8 + 0.2*sin(uFlTime*13.0 + position.z*30.0));\n`,
    onShader: (sh) => { sh.uniforms.uFlut = uFlut; sh.uniforms.uFlTime = U.uTime; },
  });
}

export function makeSkipperChar(o = {}) {
  const uFlut = { value: new THREE.Vector3() };
  const jk = o.jacket ?? 0xe4ae20;
  const c = buildCharacter('male', {
    uFlut, height: o.height ?? 1.78, hairColor: o.hair ?? 0x6a5240, skinTint: o.dark ? 0xffffff : (o.skin ?? 0xecb899), skinTone: !o.dark, skinMap: o.dark ? humanTex().maleDark : undefined,
    outfit: {
      top: { mat: fab(jk, 0.5, uFlut, { wet: 1, plain: true }), hem: 0.03, loose: 0.036, sleeveLoose: 0.028, smooth: 18 },
      collar: { mat: fab(new THREE.Color(jk).multiplyScalar(0.9).getHex(), 0.42, uFlut, { plain: true }) },
      pants: { mat: fab(o.pants ?? 0x2b3444, 0.8, uFlut, { plain: true }) },
      shoes: { mat: std({ color: 0x5a3c26, roughness: 0.5 }, { wet: 0.6 }), sole: std({ color: 0xe8e2d6, roughness: 0.8 }, { wet: 0.4 }) },
    },
  });
  return c;
}

export function makeWomanChar() {
  const uFlut = { value: new THREE.Vector3() };
  return buildCharacter('female', {
    uFlut, height: 1.66, skinTint: 0xffffff, browColor: 0x2a1c14,
    outfit: {
      top: { mat: fab(0xb89c72, 0.72, uFlut, { plain: true }), hem: 0.02, loose: 0.034, sleeveLoose: 0.026, smooth: 16 },
      skirt: { mat: fab(0xb89c72, 0.72, uFlut, { plain: true }), below: 0.06 },
      collar: { mat: fab(0x2f6a6c, 0.85, uFlut) }, // scarf
      pants: { mat: fab(0x1e2433, 0.75, uFlut, { plain: true }), top: 0.14 },
      shoes: { mat: std({ color: 0x1a1614, roughness: 0.35 }, { wet: 0.8 }), sole: std({ color: 0x2a2624, roughness: 0.7 }, { wet: 0.4 }) },
      hairCap: { mat: std({ color: 0x1c1410, roughness: 0.6, side: THREE.DoubleSide }, { wet: 0.6 }) },
      bun: true,
    },
  });
}
export function makeKeeperChar() {
  const uFlut = { value: new THREE.Vector3() };
  return buildCharacter('male', {
    uFlut, height: 1.74, skinMap: humanTex().maleDark, hairColor: 0xd8d4cc, bald: true,
    outfit: {
      top: { mat: fab(0x4a5a36, 0.85, uFlut), hem: 0.06, loose: 0.04, sleeveLoose: 0.03, smooth: 16 },
      collar: { mat: fab(0x3e4c2e, 0.85, uFlut) },
      pants: { mat: fab(0x9a8a66, 0.85, uFlut) },
      shoes: { mat: std({ color: 0x3e2c1e, roughness: 0.7 }, { wet: 0.7 }), sole: std({ color: 0x1c1a18, roughness: 0.8 }, { wet: 0.4 }) },
      cap: { mat: std({ color: 0x24362a, roughness: 0.85, side: THREE.DoubleSide }, { wet: 0.8 }) },
    },
  });
}

// runners on the river paths: light tops, dark tights, bright shoes
export function makeJoggerChar(o = {}) {
  const uFlut = { value: new THREE.Vector3() };
  const female = o.female;
  return buildCharacter(female ? 'female' : 'male', {
    uFlut, height: o.height ?? (female ? 1.67 : 1.8), hairColor: o.hair ?? 0x3a2a20, skinTint: o.dark || female ? 0xffffff : (o.skin ?? 0xecb899), skinTone: !o.dark && !female,
    skinMap: o.dark && !female ? humanTex().maleDark : undefined, browColor: 0x2a1c14,
    outfit: {
      top: { mat: fab(o.top ?? 0xe8664a, 0.7, uFlut, { plain: true }), hem: 0.04, loose: 0.02, sleeveLoose: 0.018, smooth: 14 },
      pants: { mat: fab(o.pants ?? 0x1c1f26, 0.6, uFlut, { plain: true }) },
      shoes: { mat: std({ color: o.shoe ?? 0xf2f2f2, roughness: 0.5 }, { wet: 0.6 }), sole: std({ color: o.sole ?? 0x3aa0d8, roughness: 0.7 }, { wet: 0.4 }) },
      ...(female ? { hairCap: { mat: std({ color: o.hair ?? 0x5a3a22, roughness: 0.6, side: THREE.DoubleSide }, { wet: 0.6 }) }, bun: true } : {}),
    },
  });
}
