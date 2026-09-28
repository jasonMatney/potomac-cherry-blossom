// Global uniforms + material patching (wind, wetness, custom point lights, translucency, floodlighting)
import * as THREE from 'three';

export const MAXL = 16;
export const U = {
  uTime: { value: 0 },
  uWindV: { value: new THREE.Vector4(0.7, -0.7, 0.5, 0.3) }, // dir.xz, base strength, gust amp
  uWet: { value: 0 },
  uLPos: { value: Array.from({ length: MAXL }, () => new THREE.Vector4(0, -1000, 0, 0)) },
  uLCol: { value: Array.from({ length: MAXL }, () => new THREE.Vector3()) },
  uLOn: { value: 0 },
  uSunDir: { value: new THREE.Vector3(0, 1, 0) },
  uSunCol: { value: new THREE.Color(1, 1, 1) },
  uFlood: { value: 0 },
  uFlash: { value: 0 },
  uTide: { value: 0 },
};

// GLSL shared wind function (mirrored in JS windAt)
export const WIND_GLSL = /* glsl */`
vec3 windField(vec3 p){
  vec2 wd = uWindV.xy;
  float g = 0.5 + 0.5*sin(dot(p.xz, wd)*0.045 - uTime*1.9);
  g *= 0.65 + 0.35*sin(p.x*0.017 + p.z*0.011 + uTime*0.63);
  float s = uWindV.z + uWindV.w * g * g;
  return vec3(wd.x, 0.0, wd.y) * s;
}
`;
export function windAt(x, z, t, out) {
  const w = U.uWindV.value;
  let g = 0.5 + 0.5 * Math.sin((x * w.x + z * w.y) * 0.045 - t * 1.9);
  g *= 0.65 + 0.35 * Math.sin(x * 0.017 + z * 0.011 + t * 0.63);
  const s = w.z + w.w * g * g;
  out.x = w.x * s; out.y = 0; out.z = w.y * s;
  return out;
}

const VERT_HEAD = /* glsl */`
uniform float uTime; uniform vec4 uWindV;
varying vec3 vWPos; varying vec3 vWNrm;
#ifdef WIND
attribute vec4 aWind;
#endif
${WIND_GLSL}
`;
const VERT_WIND = /* glsl */`
#include <begin_vertex>
#ifdef WIND
{
  vec4 lp = vec4(transformed, 1.0);
  #ifdef USE_INSTANCING
  lp = instanceMatrix * lp;
  #endif
  vec3 wpos = (modelMatrix * lp).xyz;
  vec3 wf = windField(wpos);
  float ph = aWind.y;
  float sway = 0.75 + 0.25*sin(uTime*1.1 + ph) + 0.18*sin(uTime*2.7 + ph*1.7);
  vec3 wd = wf * aWind.x * sway * WIND_SCALE;
  wd.y -= length(wf.xz) * aWind.x * 0.25 * WIND_SCALE;
  float fl = aWind.z * (0.35 + length(wf));
  wd += vec3(sin(uTime*6.3 + ph*9.1 + wpos.x), sin(uTime*7.7 + ph*5.3 + wpos.z)*0.6, cos(uTime*5.9 + ph*7.3 + wpos.y)) * fl * 0.035;
  #ifdef USE_INSTANCING
  mat3 im = mat3(instanceMatrix); float sc2 = dot(im[0], im[0]);
  wd = transpose(im) * wd / sc2;
  #endif
  transformed += wd;
}
#endif
`;
const VERT_TAIL = /* glsl */`
#include <project_vertex>
{
  vec4 wpp = vec4(transformed, 1.0);
  #ifdef USE_INSTANCING
  wpp = instanceMatrix * wpp;
  #endif
  vWPos = (modelMatrix * wpp).xyz;
  vWNrm = normalize(inverseTransformDirection(transformedNormal, viewMatrix));
}
`;

const FRAG_HEAD = /* glsl */`
uniform float uWet; uniform float uLOn; uniform vec4 uLPos[${MAXL}]; uniform vec3 uLCol[${MAXL}];
uniform vec3 uSunDir; uniform vec3 uSunCol; uniform float uFlood; uniform float uFlash;
varying vec3 vWPos; varying vec3 vWNrm;
float wetK;
`;
const FRAG_COLOR = /* glsl */`
#include <color_fragment>
wetK = uWet * WET_MUL * (0.45 + 0.55*smoothstep(0.1, 0.8, vWNrm.y));
diffuseColor.rgb *= 1.0 - 0.38*wetK;
`;
const FRAG_ROUGH = /* glsl */`
#include <roughnessmap_fragment>
roughnessFactor = mix(roughnessFactor, mix(0.35, 0.07, smoothstep(0.3, 0.9, vWNrm.y)), wetK);
`;
const FRAG_OUT = /* glsl */`
{
  vec3 Nw = normalize(vWNrm);
  vec3 Vw = normalize(cameraPosition - vWPos);
  if (uLOn > 0.001) {
    vec3 acc = vec3(0.0); vec3 sp = vec3(0.0);
    float shin = mix(6.0, 180.0, 1.0 - roughnessFactor);
    for (int i = 0; i < ${MAXL}; i++) {
      vec4 lp = uLPos[i];
      if (lp.w <= 0.0) continue;
      vec3 L = lp.xyz - vWPos; float d = length(L);
      if (d > lp.w) continue;
      L /= d;
      float att = pow(1.0 - d/lp.w, 2.0) / (1.0 + d*d*0.035);
      float nl = max(dot(Nw, L), 0.0) * 0.85 + 0.15;
      acc += uLCol[i] * att * nl;
      vec3 Hh = normalize(L + Vw);
      sp += uLCol[i] * att * pow(max(dot(Nw, Hh), 0.0), shin) * (1.0 - roughnessFactor) * 2.0;
    }
    outgoingLight += (diffuseColor.rgb * acc + sp) * uLOn;
  }
  #ifdef TRANSL
  {
    float bl = pow(max(dot(-Vw, uSunDir), 0.0), 3.0);
    float wrap = 0.35 + 0.65 * max(dot(-Nw, uSunDir), 0.0);
    outgoingLight += diffuseColor.rgb * uSunCol * (bl * 1.6 + 0.12) * wrap * TRANSL;
  }
  #endif
  #ifdef FLOOD
  {
    float hh = clamp((vWPos.y - FLOOD_BASE) / (FLOOD_TOP - FLOOD_BASE), 0.0, 1.0);
    float k = mix(1.0, 0.35, hh) * (0.6 + 0.4*max(dot(Nw, normalize(vec3(FLOOD_DIR))), 0.0));
    outgoingLight += diffuseColor.rgb * vec3(1.0, 0.86, 0.66) * k * uFlood * FLOOD_POW;
  }
  #endif
  outgoingLight += diffuseColor.rgb * vec3(0.75, 0.8, 1.0) * uFlash * 0.45 * (0.4 + 0.6*max(Nw.y, 0.0));
}
#include <opaque_fragment>
`;

const allPatched = [];
export function patch(mat, o = {}) {
  const defines = mat.defines || (mat.defines = {});
  if (o.wind) { defines.WIND = ''; defines.WIND_SCALE = (o.wind === true ? 1 : o.wind).toFixed(3); }
  defines.WET_MUL = (o.wet === undefined ? 1 : o.wet).toFixed(3);
  if (o.transl) defines.TRANSL = o.transl.toFixed(3);
  if (o.flood) {
    defines.FLOOD = ''; defines.FLOOD_BASE = o.flood.base.toFixed(2); defines.FLOOD_TOP = o.flood.top.toFixed(2);
    defines.FLOOD_POW = (o.flood.pow || 1).toFixed(3);
    const d = o.flood.dir || [0, 0.3, 1]; defines.FLOOD_DIR = d.map((x) => x.toFixed(3)).join(',');
  }
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (sh, r) => {
    if (prev) prev(sh, r);
    for (const k in U) sh.uniforms[k] = U[k];
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\n' + VERT_HEAD)
      .replace('#include <begin_vertex>', VERT_WIND + (o.vertexExtra || ''))
      .replace('#include <project_vertex>', VERT_TAIL);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\n' + FRAG_HEAD)
      .replace('#include <color_fragment>', FRAG_COLOR + (o.colorExtra || ''))
      .replace('#include <roughnessmap_fragment>', FRAG_ROUGH)
      .replace('#include <opaque_fragment>', FRAG_OUT);
    if (o.fragHead) sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\n' + o.fragHead);
    if (o.vertHead) sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\n' + o.vertHead);
    if (o.mapReplace) sh.fragmentShader = sh.fragmentShader.replace('#include <map_fragment>', o.mapReplace);
    if (o.onShader) o.onShader(sh);
  };
  const key = JSON.stringify(o, (k, v) => (typeof v === 'function' ? v.toString().length : v));
  mat.customProgramCacheKey = () => 'p' + key;
  allPatched.push(mat);
  return mat;
}

// Depth material for shadow casting that respects alpha-tested cards and wind
export function depthFor(mat, o = {}) {
  const dm = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: mat.map || null, alphaTest: mat.alphaTest || 0, side: mat.side });
  if (o.wind) {
    dm.defines = { WIND: '', WIND_SCALE: (o.wind === true ? 1 : o.wind).toFixed(3) };
    dm.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = U.uTime; sh.uniforms.uWindV = U.uWindV;
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uTime; uniform vec4 uWindV;\nattribute vec4 aWind;\n' + WIND_GLSL)
        .replace('#include <begin_vertex>', VERT_WIND);
    };
    dm.customProgramCacheKey = () => 'dw' + dm.defines.WIND_SCALE;
  }
  return dm;
}

export function std(params, o = {}) {
  return patch(new THREE.MeshStandardMaterial(params), o);
}
