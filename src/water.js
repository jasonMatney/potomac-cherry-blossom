// River water: surface mesh, baked depth/current/foam maps, GPU wake simulation, custom shading
import * as THREE from 'three';
import { S0, S1, frame, hw, bedHeight, heightSD, currentAt, islandMask, bankTypeAt } from './world.js';
import { U, MAXL } from './matpatch.js';
import { LAYER } from './post.js';
import { clamp, smooth, fbm2 } from './util.js';
import TEX from './tex.js';

export const DMAX = 200; // lateral half-range of baked maps
const DEP_W = 256, DEP_H = 2048;
const FOAM_W = 512, FOAM_H = 4096;
export const obstacles = []; // {s, d, rs (half-length along s), rd (half-width along d), kind, round}

export const W = {};

export function bakeMaps() {
  // depth / slack / current map in (d, s) space
  const dep = new Uint8Array(DEP_W * DEP_H * 4);
  for (let j = 0; j < DEP_H; j++) {
    const s = S0 + (j + 0.5) / DEP_H * (S1 - S0);
    const wr = hw(s, 1), wl = hw(s, -1);
    for (let i = 0; i < DEP_W; i++) {
      const d = -DMAX + (i + 0.5) / DEP_W * 2 * DMAX;
      const inRiver = d < wr + 2 && d > -wl - 2;
      let b = inRiver ? bedHeight(s, d) : 3;
      if (d > wr || d < -wl) b = Math.max(b, heightSD(s, d));
      const depth = clamp(-b, 0, 12) / 12;
      // slack water near banks (petal rafts): within ~14 m of shore, low current
      const side = d >= 0 ? 1 : -1;
      const distBank = (side > 0 ? wr : wl) - Math.abs(d);
      let slack = smooth(16, 3, distBank) * smooth(-1, 1.5, distBank);
      const bt = bankTypeAt(s, side);
      if (bt === 'riprap') slack *= 0.6;
      const im = islandMask(s, d);
      slack = Math.max(slack, smooth(-0.35, -0.08, im) * (1 - smooth(-0.05, 0.02, im)));
      slack *= 0.55 + 0.9 * fbm2(s * 0.02, d * 0.04);
      const cur = currentAt(s, d);
      const k = (j * DEP_W + i) * 4;
      dep[k] = depth * 255; dep[k + 1] = clamp(slack, 0, 1) * 255; dep[k + 2] = clamp(cur / 1.5, 0, 1) * 255; dep[k + 3] = 255;
    }
  }
  const tDepth = new THREE.DataTexture(dep, DEP_W, DEP_H, THREE.RGBAFormat);
  tDepth.minFilter = tDepth.magFilter = THREE.LinearFilter; tDepth.needsUpdate = true;

  // foam + speed-up map around obstacles
  const foam = new Uint8Array(FOAM_W * FOAM_H * 4);
  const sPer = (S1 - S0) / FOAM_H, dPer = 2 * DMAX / FOAM_W;
  const fA = new Float32Array(FOAM_W * FOAM_H), fB = new Float32Array(FOAM_W * FOAM_H);
  for (const o of obstacles) {
    const trail = (o.rd * 12 + 16);
    const sMin = o.s - o.rs - trail, sMax = o.s + o.rs + 6;
    const dMin = o.d - o.rd - 8 - o.rd * 1.5, dMax = o.d + o.rd + 8 + o.rd * 1.5;
    const j0 = Math.max(0, Math.floor((sMin - S0) / sPer)), j1 = Math.min(FOAM_H - 1, Math.ceil((sMax - S0) / sPer));
    const i0 = Math.max(0, Math.floor((dMin + DMAX) / dPer)), i1 = Math.min(FOAM_W - 1, Math.ceil((dMax + DMAX) / dPer));
    for (let j = j0; j <= j1; j++) {
      const s = S0 + (j + 0.5) * sPer;
      for (let i = i0; i <= i1; i++) {
        const d = -DMAX + (i + 0.5) * dPer;
        // distance to obstacle (rounded box / ellipse)
        const ds = s - o.s, dd = d - o.d;
        let dist;
        if (o.round) { dist = Math.hypot(ds / Math.max(o.rs, 0.1), dd / Math.max(o.rd, 0.1)) * Math.min(o.rs, o.rd) - Math.min(o.rs, o.rd); }
        else { const qx = Math.abs(ds) - o.rs, qy = Math.abs(dd) - o.rd; dist = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0); }
        if (dist < -0.2) continue;
        const collar = Math.exp(-Math.pow(Math.max(dist, 0) / (0.6 + o.rd * 0.08), 2)) * (ds > -o.rs ? 0.85 : 0.6) * (ds > o.rs * 0.3 ? 1.15 : 1);
        let tr = 0;
        const behind = -(ds + o.rs);
        if (behind > 0) {
          const width = o.rd * (1 + behind / trail * 1.2);
          const lat = Math.abs(dd) / width;
          const edge = Math.exp(-Math.pow((lat - 0.9) / 0.35, 2)) + 0.5 * Math.exp(-lat * lat * 1.5);
          tr = edge * Math.exp(-behind / (trail * 0.35)) * 0.55;
        }
        const k = j * FOAM_W + i;
        fA[k] = Math.max(fA[k], clamp(collar + tr, 0, 1) * (o.foam ?? 1));
        const speed = Math.exp(-Math.pow(Math.max(dist, 0) / (o.rd * 1.4 + 2), 2)) * (Math.abs(dd) > o.rd * 0.8 ? 1 : 0.5);
        fB[k] = Math.max(fB[k], speed);
      }
    }
  }
  for (let k = 0; k < FOAM_W * FOAM_H; k++) { foam[k * 4] = fA[k] * 255; foam[k * 4 + 1] = fB[k] * 255; foam[k * 4 + 3] = 255; }
  const tFoam = new THREE.DataTexture(foam, FOAM_W, FOAM_H, THREE.RGBAFormat);
  tFoam.minFilter = tFoam.magFilter = THREE.LinearFilter; tFoam.needsUpdate = true;
  W.tDepth = tDepth; W.tFoam = tFoam;
}

// ---------- wake simulation ----------
// Linear water waves with real dispersion (iWave-style): each cell's vertical acceleration comes from a
// convolution of the surface height with a kernel fitted so that wave speed depends on wavelength like
// a ~5 m deep river (w^2 = g k tanh(k h)). A moving hull is a pressure patch pushing the surface down;
// the waves it sheds form a true Kelvin wake: divergent and transverse waves inside a V that widens
// once the boat outruns the longest waves.
const SIM_W = 224, SIM_H = 320; // cells: d x s
const SIM_DS = 0.42; // metres per cell
export const SIM = { w: SIM_W, h: SIM_H, cell: SIM_DS, sMin: 0, dMin: 0, rtA: null, rtB: null, rtT: null, mat: null, matB: null, probe: null, probeVals: new Float32Array(16) };
// fitted kernel weights by |offset| (max, min)
const KW = { '0,0': 1.017687, '1,0': 0.018597, '1,1': -0.075128, '2,0': -0.064742, '2,1': -0.023682, '2,2': -0.007648, '3,0': 0.008696, '3,1': -0.003508, '3,2': -0.004766, '3,3': 0.000159, '4,0': -0.012232, '4,1': -0.003616, '4,2': 0.001084, '4,3': 0.002817, '4,4': -0.009066, '5,0': 0.009537, '5,1': 0.00365, '5,2': -0.000857, '5,3': -0.014256, '6,0': -0.007703, '6,1': -0.014192 };
// a smaller kernel (61 taps) for low quality tiers: same physics, a little less accurate for long waves
const KW_LO = { '0,0': 1.032282, '1,0': 0.025025, '1,1': -0.073304, '2,0': -0.06814, '2,1': -0.023299, '2,2': 0.001863, '3,0': 0.020343, '3,1': 0.005447, '3,2': -0.00248, '3,3': -0.039548, '4,0': -0.018886, '4,1': -0.032165 };
function kernelGLSL(KT = KW, P = 6) {
  let out = '';
  for (let i = -P; i <= P; i++) for (let j = -P; j <= P; j++) {
    const a = Math.max(Math.abs(i), Math.abs(j)), b = Math.min(Math.abs(i), Math.abs(j)); const w = KT[a + ',' + b];
    if (w === undefined) continue;
    out += `vd += ${w.toFixed(6)} * texture2D(tTmp, vUv + vec2(${i}.0, ${j}.0) * texel).r;\n`;
  }
  return out;
}
const MAXB = 8;
const PRESS_GLSL = /* glsl */`
  uniform vec4 uB[${MAXB}]; uniform vec4 uBS[${MAXB}]; uniform int uNB;
  // hull pressure head (m) at a point in (s, d)
  float pressureAt(vec2 sd) {
    float P = 0.0;
    for (int i = 0; i < ${MAXB}; i++) {
      if (i >= uNB) break;
      vec4 b = uB[i]; vec4 bs = uBS[i];
      vec2 rel = sd - b.xy; float ch = cos(b.z), sh = sin(b.z);
      float al = (rel.x*ch + rel.y*sh) / bs.x, la = (-rel.x*sh + rel.y*ch) / bs.y;
      float e = al*al + la*la;
      if (e < 6.0) P += 0.62 * bs.z * exp(-2.0*e);
    }
    return P;
  }`;
function initSim(renderer) {
  const opts = { type: THREE.HalfFloatType, format: THREE.RGBAFormat, depthBuffer: false, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, wrapS: THREE.ClampToEdgeWrapping, wrapT: THREE.ClampToEdgeWrapping };
  SIM.rtA = new THREE.WebGLRenderTarget(SIM_W, SIM_H, { ...opts, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
  SIM.rtB = new THREE.WebGLRenderTarget(SIM_W, SIM_H, { ...opts, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
  SIM.rtT = new THREE.WebGLRenderTarget(SIM_W, SIM_H, opts);
  const common = {
    uB: { value: Array.from({ length: MAXB }, () => new THREE.Vector4()) }, // s, d, heading(rel to s axis), speed
    uBS: { value: Array.from({ length: MAXB }, () => new THREE.Vector4()) }, // halfLen, halfBeam, strength, prop
    uNB: { value: 0 }, uOrigin: { value: new THREE.Vector2() }, uSize: { value: new THREE.Vector2(SIM_W * SIM_DS, SIM_H * SIM_DS) },
    uDt: { value: 0.016 }, uTime: { value: 0 },
  };
  SIM.common = common;
  const vs = 'varying vec2 vUv; void main(){ vUv = position.xy*0.5+0.5; gl_Position = vec4(position.xy,0.0,1.0); }';
  // pass A: scroll with the window, drift with the current, add hull pressure, update foam
  SIM.mat = new THREE.ShaderMaterial({
    uniforms: { ...common, tPrev: { value: null }, uShift: { value: new THREE.Vector2() }, uFlow: { value: 0 }, uRain: { value: 0 } },
    depthTest: false, depthWrite: false, vertexShader: vs,
    fragmentShader: /* glsl */`
      uniform sampler2D tPrev; uniform vec2 uShift, uOrigin, uSize; uniform float uDt, uFlow, uRain, uTime;
      ${PRESS_GLSL}
      varying vec2 vUv;
      float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
      void main(){
        vec2 uv = vUv + uShift + vec2(0.0, uFlow * uDt / uSize.y);
        vec4 c = texture2D(tPrev, uv);
        if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) c = vec4(0.0);
        float h = c.r, hp = c.g;
        float foam = c.b * (1.0 - 0.3*uDt);
        float calm = c.a * (1.0 - 0.07*uDt);
        vec2 sd = uOrigin + vec2(vUv.y*uSize.y, vUv.x*uSize.x);
        for (int i = 0; i < ${MAXB}; i++) {
          if (i >= uNB) break;
          vec4 b = uB[i]; vec4 bs = uBS[i];
          vec2 rel = sd - b.xy;
          float ch = cos(b.z), sh = sin(b.z);
          float along = rel.x*ch + rel.y*sh; float lat = -rel.x*sh + rel.y*ch;
          float el = (along/bs.x)*(along/bs.x) + (lat/bs.y)*(lat/bs.y);
          float speedK = clamp(b.w / 5.0, 0.0, 1.6);
          // disturbed band along the hull
          if (el < 1.35) {
            float x = along / bs.x;
            float band = smoothstep(1.35, 0.85, el) * smoothstep(0.5, 1.0, el);
            foam = max(foam, band * speedK * 0.45 * bs.z * smoothstep(-0.9, 0.2, x));
          }
          // prop wash behind the stern: churned foam and the calm "scar" lane it leaves
          vec2 st = rel + vec2(ch, sh) * bs.x * 1.02;
          float sa = st.x*ch + st.y*sh, sl = -st.x*sh + st.y*ch;
          if (sa < 0.5 && sa > -7.0) {
            float wdt = 0.25 + (-min(sa, 0.0))*0.09;
            float pw = exp(-sl*sl / wdt) * smoothstep(0.5, -0.5, sa) * exp(min(sa, 0.0)*0.22) * bs.w;
            float spd = clamp(abs(b.w)/3.0, 0.0, 1.0);
            float churn = 0.3 + 0.7*hash(floor(sd*2.3) + floor(uTime*9.0));
            foam = max(foam, pw * spd * 0.85 * churn * (1.0 - 0.25*smoothstep(7.0, 11.0, abs(b.w))));
            calm = max(calm, exp(-sl*sl / (wdt*2.2)) * smoothstep(0.5, -1.5, sa) * spd * bs.w);
            h += pw * spd * 0.004 * (hash(floor(sd*3.1) + floor(uTime*20.0)) - 0.5);
          }
          // bow wave foam at the bow shoulders
          vec2 bw = rel - vec2(ch, sh) * bs.x * 0.75;
          float ba = bw.x*ch + bw.y*sh, bl = -bw.x*sh + bw.y*ch;
          float bowF = exp(-pow(abs(bl) - bs.y*(0.95 + max(-ba, 0.0)*0.18), 2.0)*5.0) * smoothstep(-1.8, -0.2, ba) * smoothstep(0.9, -0.2, ba);
          foam = max(foam, bowF * speedK * 0.5 * bs.z * (0.6 + 0.4*hash(floor(sd*2.7) + floor(uTime*12.0))));
        }
        // raindrops: each one a tiny impulse that rings outward
        if (uRain > 0.01) {
          vec2 cell = floor(vUv * vec2(${SIM_W}.0, ${SIM_H}.0) / 3.0);
          float r = hash(cell + floor(uTime*8.0));
          if (r > 1.0 - 0.012*uRain) h -= 0.004;
        }
        gl_FragColor = vec4(h + pressureAt(sd), hp, clamp(foam, 0.0, 1.0), clamp(calm, 0.0, 1.0));
      }`,
  });
  // pass B: leapfrog step of the dispersive wave equation
  SIM.matB = new THREE.ShaderMaterial({
    uniforms: { ...common, tTmp: { value: SIM.rtT.texture }, tDepth: { value: null }, uS0: { value: S0 }, uSL: { value: S1 - S0 }, uDM: { value: DMAX } },
    depthTest: false, depthWrite: false, vertexShader: vs,
    fragmentShader: /* glsl */`
      uniform sampler2D tTmp, tDepth; uniform vec2 uOrigin, uSize; uniform float uDt, uS0, uSL, uDM;
      ${PRESS_GLSL}
      varying vec2 vUv;
      void main(){
        vec2 texel = 1.0 / vec2(${SIM_W}.0, ${SIM_H}.0);
        vec4 q = texture2D(tTmp, vUv);
        float vd = 0.0;
        ${kernelGLSL()}
        vd /= ${SIM_DS.toFixed(3)};
        vec2 sd = uOrigin + vec2(vUv.y*uSize.y, vUv.x*uSize.x);
        float h = q.r - pressureAt(sd);
        float a = 0.04;
        float hn = (h*(2.0 - a*uDt) - q.g - 9.8*uDt*uDt*vd) / (1.0 + a*uDt);
        // soak up waves at the banks (shallows) and at the window edges
        vec2 dUv = vec2((sd.y + uDM)/(2.0*uDM), (sd.x - uS0)/uSL);
        float depth = texture2D(tDepth, dUv).r * 12.0;
        float edge = smoothstep(0.0, 0.1, vUv.x) * smoothstep(1.0, 0.9, vUv.x) * smoothstep(0.0, 0.08, vUv.y) * smoothstep(1.0, 0.92, vUv.y);
        float keep = 1.0 - (1.0 - edge * smoothstep(0.05, 0.9, depth)) * 5.0 * uDt;
        gl_FragColor = vec4(clamp(hn*keep, -1.0, 1.0), clamp(h*keep, -1.0, 1.0), q.b, q.a);
      }`,
  });
  SIM.matBHi = SIM.matB;
  SIM.matBLo = new THREE.ShaderMaterial({ uniforms: SIM.matB.uniforms, depthTest: false, depthWrite: false, vertexShader: vs,
    fragmentShader: SIM.matB.fragmentShader.replace(/vd \+= [^\n]*\n/g, '').replace('float vd = 0.0;', 'float vd = 0.0;\n' + kernelGLSL(KW_LO, 4)) });
  SIM.setLow = (lo) => { SIM.matB = lo ? SIM.matBLo : SIM.matBHi; };
  // probe: surface height (minus hull pressure) at up to 16 points, packed into bytes for an async read
  SIM.probeRT = new THREE.WebGLRenderTarget(16, 1, { type: THREE.UnsignedByteType, format: THREE.RGBAFormat, depthBuffer: false, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
  SIM.probeMat = new THREE.ShaderMaterial({
    uniforms: { ...common, tSim: { value: null }, uPts: { value: Array.from({ length: 16 }, () => new THREE.Vector2(-1e5, 0)) } },
    depthTest: false, depthWrite: false, vertexShader: vs,
    fragmentShader: /* glsl */`
      uniform sampler2D tSim; uniform vec2 uOrigin, uSize; uniform vec2 uPts[16];
      ${PRESS_GLSL}
      varying vec2 vUv;
      void main(){
        int k = int(floor(vUv.x * 16.0));
        vec2 sd = uPts[0];
        for (int i = 0; i < 16; i++) if (i == k) sd = uPts[i];
        vec2 uv = vec2((sd.y - uOrigin.y)/uSize.x, (sd.x - uOrigin.x)/uSize.y);
        float h = 0.0;
        if (uv.x > 0.0 && uv.x < 1.0 && uv.y > 0.0 && uv.y < 1.0) h = texture2D(tSim, uv).r + pressureAt(sd);
        float v = clamp(h * 0.5 + 0.5, 0.0, 1.0) * 65535.0;
        float hi = floor(v / 256.0), lo = v - hi * 256.0;
        gl_FragColor = vec4(hi / 255.0, lo / 255.0, 0.0, 1.0);
      }`,
  });
  SIM.probeBuf = new Uint8Array(16 * 4); SIM.probeBusy = false; SIM.probePts = [];
  SIM.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), SIM.mat); SIM.quad.frustumCulled = false;
  SIM.scene = new THREE.Scene(); SIM.scene.add(SIM.quad);
  SIM.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  renderer.setRenderTarget(SIM.rtA); renderer.setClearColor(0x000000, 0); renderer.clear();
  renderer.setRenderTarget(SIM.rtB); renderer.clear();
  renderer.setRenderTarget(null);
  SIM.sMin = 0; SIM.dMin = -SIM_W * SIM_DS / 2;
}

// sample the wave height at world (s, d) points; results arrive a frame or two later in SIM.probeVals
export function simProbe(pts) { SIM.probePts = pts; }
// river frame samples along the wake window, for bending the fine wave mesh
export function updatePatchFrame() {
  if (!W.uni || !W.uni.uFrP) return;
  const a = W.uni.uFrP.value;
  for (let i = 0; i < 40; i++) { const F = frame(SIM.sMin + i * 4); a[i].set(F.x, F.z, F.th, 0); }
}

export function stepSim(renderer, dt, time, focusS, focusD, boats, rain, maxSub = 3) {
  // recentre window, snapping to cell size
  const wantS = Math.round((focusS - SIM_H * SIM_DS * 0.68) / SIM_DS) * SIM_DS;
  const wantD = Math.round((focusD - SIM_W * SIM_DS * 0.5) / SIM_DS) * SIM_DS;
  const m = SIM.mat.uniforms, c = SIM.common;
  const shS = (wantS - SIM.sMin) / (SIM_H * SIM_DS), shD = (wantD - SIM.dMin) / (SIM_W * SIM_DS);
  const jump = Math.abs(wantS - SIM.sMin) > 60 || Math.abs(wantD - SIM.dMin) > 60;
  SIM.sMin = wantS; SIM.dMin = wantD;
  c.uOrigin.value.set(SIM.sMin, SIM.dMin);
  c.uTime.value = time; m.uRain.value = rain;
  m.uFlow.value = currentAt(focusS, focusD);
  SIM.matB.uniforms.tDepth.value = W.tDepth;
  let n = 0;
  for (const b of boats) {
    if (n >= MAXB) break;
    if (Math.abs(b.s - focusS) > 90 + b.halfLen || Math.abs(b.d - focusD) > 60 + b.halfLen) continue;
    c.uB.value[n].set(b.s, b.d, b.relHeading, b.speed);
    c.uBS.value[n].set(b.halfLen, b.halfBeam, b.strength ?? 1, b.prop ?? 1);
    n++;
  }
  c.uNB.value = n;
  // fixed-size substeps keep the leapfrog integrator stable and frame-rate independent
  const sub = Math.min(maxSub, Math.max(1, Math.round(dt * 60)));
  c.uDt.value = Math.min(dt, 1 / 20) / sub;
  for (let k = 0; k < sub; k++) {
    m.uShift.value.set(k === 0 ? (jump ? 5 : shD) : 0, k === 0 ? (jump ? 5 : shS) : 0);
    m.tPrev.value = SIM.rtA.texture;
    SIM.quad.material = SIM.mat; renderer.setRenderTarget(SIM.rtT); renderer.render(SIM.scene, SIM.cam);
    SIM.quad.material = SIM.matB; renderer.setRenderTarget(SIM.rtB); renderer.render(SIM.scene, SIM.cam);
    const t = SIM.rtA; SIM.rtA = SIM.rtB; SIM.rtB = t;
  }
  // height probes for things floating on the waves
  if (!SIM.probeBusy && SIM.probePts.length) {
    const pu = SIM.probeMat.uniforms;
    for (let i = 0; i < 16; i++) { const p = SIM.probePts[i]; if (p) pu.uPts.value[i].set(p[0], p[1]); else pu.uPts.value[i].set(-1e5, 0); }
    pu.tSim.value = SIM.rtA.texture;
    SIM.quad.material = SIM.probeMat; renderer.setRenderTarget(SIM.probeRT); renderer.render(SIM.scene, SIM.cam);
    SIM.probeBusy = true;
    renderer.readRenderTargetPixelsAsync(SIM.probeRT, 0, 0, 16, 1, SIM.probeBuf).then((buf) => {
      for (let i = 0; i < 16; i++) SIM.probeVals[i] = ((buf[i * 4] * 256 + buf[i * 4 + 1]) / 65535 - 0.5) * 2;
      SIM.probeBusy = false;
    }).catch(() => { SIM.probeBusy = false; SIM.probePts = []; });
  }
  SIM.quad.material = SIM.mat;
  renderer.setRenderTarget(null);
}

// ---------- water surface ----------
export function buildWater(scene, renderer, pipeline) {
  initSim(renderer);
  const rows = Math.floor((S1 - S0) / 4) + 1, NC = 56;
  const pos = [], sd = [], fr = [], idx = [];
  for (let r = 0; r < rows; r++) {
    const s = S0 + r * 4; const F = frame(s);
    const wl = hw(s, -1) + 4, wr = hw(s, 1) + 4;
    for (let k = 0; k <= NC; k++) {
      const t = k / NC * 2 - 1; const u = Math.sign(t) * Math.sin(Math.abs(t) * Math.PI / 2);
      const d = u > 0 ? u * wr : u * wl;
      pos.push(F.x + F.rx * d, 0, F.z + F.rz * d); sd.push(s, d); fr.push(F.fx, F.fz);
    }
  }
  for (let r = 0; r < rows - 1; r++) for (let k = 0; k < NC; k++) {
    const a = r * (NC + 1) + k, b = a + 1, c = a + NC + 1, d = c + 1;
    idx.push(a, b, c, b, d, c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aSD', new THREE.Float32BufferAttribute(sd, 2));
  g.setAttribute('aFr', new THREE.Float32BufferAttribute(fr, 2));
  g.setIndex(idx);
  g.computeBoundingSphere();

  const uni = {
    uTime: U.uTime, uWindV: U.uWindV, uWet: U.uWet, uLPos: U.uLPos, uLCol: U.uLCol, uLOn: U.uLOn, uFlash: U.uFlash, uTide: U.uTide,
    tRefl: { value: pipeline.rtRefl.texture }, tRefr: { value: pipeline.rtRefr.texture }, uReflVP: { value: new THREE.Matrix4() },
    tDepth: { value: W.tDepth }, tFoam: { value: W.tFoam }, tNorm: { value: TEX.waterN.normalMap }, tPetal: { value: TEX.petalRaft.map },
    tSim: { value: SIM.rtA.texture }, uSimO: { value: new THREE.Vector2() }, uSimS: { value: new THREE.Vector2(SIM_W * SIM_DS, SIM_H * SIM_DS) },
    uS0: { value: S0 }, uSL: { value: S1 - S0 }, uDM: { value: DMAX }, uRes: { value: new THREE.Vector2(1, 1) },
    uSunDir: { value: new THREE.Vector3() }, uSunCol: { value: new THREE.Color() }, uSunI: { value: 1 }, uAmb: { value: new THREE.Color() },
    uSkyZen: { value: new THREE.Color() }, uFogCol: { value: new THREE.Color() }, uFogD: { value: 0.001 }, uRain: { value: 0 }, uNight: { value: 0 },
    uWaterCol: { value: new THREE.Color(0x2c3a1e) }, uStorm: { value: 0 }, uMist: { value: 0 },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms: uni, fog: false,
    vertexShader: /* glsl */`
      attribute vec2 aSD; attribute vec2 aFr;
      uniform float uTime, uTide;
      #ifdef PATCH
      uniform vec2 uSimO, uSimS; uniform vec4 uFrP[40]; uniform sampler2D tSim;
      #endif
      varying vec3 vWPos; varying vec2 vSD; varying vec2 vFr; varying vec4 vClip;
      void main(){
        vec3 p = position;
        #ifdef PATCH
        // a fine grid laid over the wake window, bent to follow the river and lifted by the waves
        vec2 ij = aSD;
        float sl = ij.y * uSimS.y, d = uSimO.y + ij.x * uSimS.x;
        float fi = sl / 4.0; int i0 = int(floor(fi)); float ft = fi - float(i0);
        vec4 A = uFrP[i0], B = uFrP[min(i0 + 1, 39)];
        vec3 F = mix(A.xyz, B.xyz, ft);
        vec2 fw = vec2(sin(F.z), -cos(F.z)); vec2 rt = vec2(-fw.y, fw.x);
        p = vec3(F.x + rt.x*d, 0.0, F.y + rt.y*d);
        float edge = smoothstep(0.0,0.1,ij.x)*smoothstep(1.0,0.9,ij.x)*smoothstep(0.0,0.08,ij.y)*smoothstep(1.0,0.92,ij.y);
        float wake = texture2D(tSim, ij).r * edge;
        vSD = vec2(uSimO.x + sl, d); vFr = fw;
        #else
        float wake = 0.0;
        vSD = aSD; vFr = aFr;
        #endif
        p.y = uTide + wake + 0.035*sin(p.x*0.21 + uTime*1.3) + 0.03*sin(p.z*0.17 - uTime*1.1) + 0.02*sin((p.x+p.z)*0.37 + uTime*2.1);
        vWPos = p;
        vClip = projectionMatrix * viewMatrix * vec4(p, 1.0);
        gl_Position = vClip;
      }`,
    fragmentShader: /* glsl */`
      uniform float uTime, uTide, uLOn, uFlash, uS0, uSL, uDM, uSunI, uFogD, uRain, uNight, uStorm, uMist, uWet;
      uniform vec4 uLPos[${MAXL}]; uniform vec3 uLCol[${MAXL}];
      uniform sampler2D tRefl, tRefr, tDepth, tFoam, tNorm, tPetal, tSim;
      uniform mat4 uReflVP; uniform vec2 uSimO, uSimS, uRes;
      uniform vec3 uSunDir, uSunCol, uAmb, uSkyZen, uFogCol, uWaterCol;
      varying vec3 vWPos; varying vec2 vSD; varying vec2 vFr; varying vec4 vClip;
      float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
      vec3 nrmAt(vec2 uv){ vec3 n = texture2D(tNorm, uv).xyz*2.0-1.0; return n; }
      vec2 rainRipple(vec2 p, float t){
        vec2 acc = vec2(0.0);
        for (int k = 0; k < 2; k++) {
          vec2 q = p * (k == 0 ? 1.3 : 0.9) + float(k)*17.3;
          vec2 cell = floor(q); vec2 f = fract(q);
          float h = hash(cell); vec2 c = vec2(hash(cell+3.1), hash(cell+7.7))*0.6+0.2;
          float ph = fract(t*1.2 + h);
          vec2 dv = f - c; float r = length(dv);
          float ring = sin((r - ph*0.55)*42.0) * exp(-abs(r - ph*0.55)*18.0) * (1.0 - ph);
          acc += dv/(r+1e-3) * ring;
        }
        return acc;
      }
      void main(){
        #ifndef PATCH
        { vec2 q = vec2((vSD.y - uSimO.y)/uSimS.x, (vSD.x - uSimO.x)/uSimS.y); if (q.x > 0.002 && q.x < 0.998 && q.y > 0.002 && q.y < 0.998) discard; }
        #endif
        vec2 dUv = vec2((vSD.y + uDM)/(2.0*uDM), (vSD.x - uS0)/uSL);
        vec4 dm = texture2D(tDepth, dUv);
        vec4 fm = texture2D(tFoam, dUv);
        float level = uTide;
        float bed = -dm.r*12.0;
        float depth = max(level - bed, 0.0);
        float cur = dm.b*1.5 * (1.0 + fm.g*1.4);
        vec2 fwd = normalize(vFr); vec2 right = vec2(-fwd.y, fwd.x);
        vec2 flowDir = -fwd; // downstream
        vec3 V = normalize(cameraPosition - vWPos);
        float dist = length(cameraPosition - vWPos);
        // --- normals: flow-mapped detail
        float T = uTime;
        float ph0 = fract(T*0.12), ph1 = fract(T*0.12 + 0.5);
        float wgt = abs(ph0 - 0.5)*2.0;
        vec2 wp = vWPos.xz;
        vec2 adv = flowDir * cur * 8.3;
        vec3 n0 = nrmAt(wp*0.055 - adv*ph0*0.055) + nrmAt(wp*0.17 - adv*ph0*0.17*0.9 + 0.37);
        vec3 n1 = nrmAt(wp*0.055 - adv*ph1*0.055 + 0.5) + nrmAt(wp*0.17 - adv*ph1*0.17*0.9 + 0.87);
        vec3 nd = mix(n0, n1, wgt);
        vec3 nw = nrmAt(wp*0.013 + vec2(T*0.004, -T*0.006)) * 0.8; // large-scale wind swell
        vec2 grad = (nd.xy*0.075 + nw.xy*0.06) * (1.0 + uStorm*0.8);
        float farK = smoothstep(260.0, 30.0, dist);
        grad *= mix(0.35, 1.0, farK);
        // wake sim
        vec2 sUv = vec2((vSD.y - uSimO.y)/uSimS.x, (vSD.x - uSimO.x)/uSimS.y);
        float simFoam = 0.0; float simCalm = 0.0; float wakeH = 0.0;
        if (sUv.x > 0.0 && sUv.x < 1.0 && sUv.y > 0.0 && sUv.y < 1.0) {
          vec2 tx = vec2(1.0/${SIM_W}.0, 1.0/${SIM_H}.0);
          vec4 sc = texture2D(tSim, sUv);
          float hx = texture2D(tSim, sUv + vec2(tx.x,0)).r - texture2D(tSim, sUv - vec2(tx.x,0)).r;
          float hy = texture2D(tSim, sUv + vec2(0,tx.y)).r - texture2D(tSim, sUv - vec2(0,tx.y)).r;
          float edge = smoothstep(0.0,0.1,sUv.x)*smoothstep(1.0,0.9,sUv.x)*smoothstep(0.0,0.08,sUv.y)*smoothstep(1.0,0.92,sUv.y);
          vec2 g2 = vec2(hx, hy) / (2.0*${SIM_DS.toFixed(3)}) * edge;
          // (d,s) gradient -> world xz
          vec2 gw = right * g2.x + fwd * g2.y;
          grad += gw * 1.6;
          wakeH = sc.r * edge;
          // whitecaps only where wake crests are steep and high, broken up by noise
          float steep = smoothstep(0.24, 0.5, length(g2)) * smoothstep(0.13, 0.28, sc.r);
          simFoam = max(sc.b, steep * 1.0) * edge;
          simCalm = sc.a * edge;
        }
        // glassy scar left in the wake: suppress small ripples there
        grad *= 1.0 - 0.55*simCalm;
        // rain ripples
        if (uRain > 0.01) grad += rainRipple(wp*1.6, T) * uRain * 0.35 * farK;
        vec3 N = normalize(vec3(-grad.x, 1.0, -grad.y));
        // --- reflection
        vec4 rc = uReflVP * vec4(vWPos.x, level, vWPos.z, 1.0);
        vec2 rUv = rc.xy / rc.w * 0.5 + 0.5;
        rUv += vec2(N.x * 0.012, N.z * 0.03) * (0.3 + 0.7*farK) + vec2(0.0, wakeH * 0.05);
        vec3 refl = min(texture2D(tRefl, clamp(rUv, 0.002, 0.998)).rgb, vec3(5.0));
        // --- refraction + absorption (green-brown)
        vec2 sUv2 = gl_FragCoord.xy / uRes;
        float refrK = clamp(depth*0.6, 0.0, 1.0);
        vec3 refr = texture2D(tRefr, sUv2 + N.xz*0.025*refrK).rgb;
        float cosV = max(V.y, 0.05);
        float path = depth / cosV;
        vec3 absorb = exp(-vec3(1.6, 1.15, 1.45) * path * 0.95);
        float lightAmt = uSunI*max(uSunDir.y, 0.0)*0.35;
        vec3 body = uWaterCol * (uAmb*0.9 + uSunCol*lightAmt) ;
        body += uLOn * 0.02 * uAmb;
        vec3 under = refr * absorb + body * (1.0 - absorb);
        under = mix(under, body, 0.25);
        // --- fresnel
        float F0 = 0.02;
        float fres = F0 + (1.0 - F0)*pow(1.0 - max(dot(N, V), 0.0), 5.0);
        fres = mix(fres, 1.0, smoothstep(250.0, 1200.0, dist)*0.5);
        vec3 col = mix(under, refl, fres);
        // --- sun / moon specular
        vec3 Rv = reflect(-V, N);
        float sp = pow(max(dot(Rv, uSunDir), 0.0), 1200.0) * 9.0 + pow(max(dot(Rv, uSunDir), 0.0), 120.0) * 0.35;
        col += uSunCol * uSunI * sp * (1.0 - uStorm*0.9) * step(0.0, uSunDir.y + 0.02);
        // --- night lights: glitter streaks + diffuse pools
        if (uLOn > 0.001) {
          for (int i = 0; i < 10; i++) {
            vec4 lp = uLPos[i]; if (lp.w <= 0.0) continue;
            vec3 L = lp.xyz - vWPos; float d = length(L); L /= d;
            float att = 1.0 / (1.0 + d*d*0.012);
            float rl = max(dot(Rv, L), 0.0); float near = smoothstep(2.0, 12.0, d); float s1 = (pow(rl, 700.0) * 9.0 + pow(rl, 90.0) * 0.25) * near;
            float pool = pow(clamp(1.0 - d/lp.w, 0.0, 1.0), 3.0) * 0.012;
            col += uLCol[i] * (s1 * att * 3.0 + pool) * uLOn;
          }
        }
        // --- foam: obstacles (animated, advected downstream) + wake + shoreline
        // streaky foam: coordinates stretched along the flow
        vec2 fl2 = vec2(dot(wp, right), dot(wp, fwd));
        vec2 fuvA = vec2(fl2.x*0.9, fl2.y*0.16 + T*cur*0.16);
        vec2 fuvB = vec2(fl2.x*1.7 + 0.3, fl2.y*0.45 + T*cur*0.45);
        float fnoise = nrmAt(fuvA).x*0.5+0.5;
        float fnoise2 = nrmAt(fuvB).y*0.5+0.5;
        float fbreak = fnoise*0.55 + fnoise2*0.45;
        float obsF = fm.r * smoothstep(0.62 - fm.r*0.35, 0.95 - fm.r*0.3, fbreak);
        // lacy foam: as it decays it breaks into streaks and patches instead of fading as a sheet
        float lace = (nrmAt(wp*0.62 + vec2(0.31, 0.77)).x*0.5+0.5)*0.55 + (nrmAt(wp*1.7 + vec2(0.13, 0.41)).y*0.5+0.5)*0.45;
        float wakeF = smoothstep(1.02 - simFoam, 1.2 - simFoam*0.75, lace + 0.18) * min(1.0, simFoam*1.8);
        float shore = smoothstep(0.14, 0.02, depth) * smoothstep(0.5, 0.75, fnoise2) * 0.35;
        float foam = clamp(obsF*0.8 + wakeF + shore, 0.0, 0.92);
        vec3 foamCol = (uAmb*0.95 + uSunCol*uSunI*max(uSunDir.y,0.0)*0.8 + uFlash*0.8) * vec3(0.93, 0.95, 0.94);
        col = mix(col, foamCol, foam*0.85);
        // --- petal rafts in slack water
        vec2 pUv = wp*0.19 + flowDir*T*cur*0.19*0.5 + N.xz*0.01;
        vec4 pt = texture2D(tPetal, pUv);
        float raft = dm.g * smoothstep(0.35, 0.7, texture2D(tNorm, wp*0.008 + flowDir*T*0.0008).a*0.0 + nrmAt(wp*0.011 + flowDir*T*0.0005*cur).x*0.5+0.5);
        float pa = pt.a * smoothstep(0.1, 0.5, raft) * smoothstep(0.03, 0.2, depth);
        vec3 petalLit = pt.rgb * (uAmb*0.85 + uSunCol*uSunI*max(uSunDir.y,0.0)*0.7 + uFlash);
        col = mix(col, petalLit, pa * 0.95);
        // lightning brightening
        col += refl * uFlash * 0.3;
        // --- fog
        float fogF = 1.0 - exp(-pow(uFogD * dist, 2.0));
        col = mix(col, uFogCol, fogF);
        // soft edge where water meets shore
        float alpha = smoothstep(0.0, 0.05, depth);
        #ifdef PATCH
        if (alpha < 0.004) discard;
        #endif
        gl_FragColor = vec4(col, alpha);
      }`,
    transparent: true, depthWrite: true,
  });
  const mesh = new THREE.Mesh(g, mat);
  mesh.layers.set(LAYER.WATER);
  mesh.frustumCulled = false;
  mesh.renderOrder = -10;
  scene.add(mesh);
  // the wake window gets its own fine mesh so the waves have real height
  uni.uFrP = { value: Array.from({ length: 40 }, () => new THREE.Vector4()) };
  const pg = new THREE.BufferGeometry();
  { const NX = SIM_W, NY = SIM_H, ij = new Float32Array((NX + 1) * (NY + 1) * 2), ps = new Float32Array((NX + 1) * (NY + 1) * 3), id = new Uint32Array(NX * NY * 6);
    let k = 0; for (let j = 0; j <= NY; j++) for (let i = 0; i <= NX; i++) { ij[k * 2] = i / NX; ij[k * 2 + 1] = j / NY; k++; }
    k = 0; for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) { const a = j * (NX + 1) + i, b = a + 1, c = a + NX + 1, d = c + 1; id.set([a, b, c, b, d, c], k); k += 6; }
    pg.setAttribute('position', new THREE.BufferAttribute(ps, 3)); pg.setAttribute('aSD', new THREE.BufferAttribute(ij, 2)); pg.setIndex(new THREE.BufferAttribute(id, 1)); }
  const pmat = new THREE.ShaderMaterial({ uniforms: uni, vertexShader: mat.vertexShader, fragmentShader: mat.fragmentShader, defines: { PATCH: 1 }, fog: false, transparent: true, depthWrite: true });
  const patch = new THREE.Mesh(pg, pmat);
  patch.layers.set(LAYER.WATER); patch.frustumCulled = false; patch.renderOrder = -10;
  scene.add(patch);
  W.mesh = mesh; W.patch = patch; W.uni = uni;
  return W;
}
