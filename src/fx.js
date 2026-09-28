// Particles & wildlife: falling / drifting petals, settled petals, dust motes in sunbeams, river mist,
// gulls, great blue herons, insects around lamps, rain streaks and splash crowns
import * as THREE from 'three';
import { clamp, lerp, smooth, mulberry32, fbm2 } from './util.js';
import { toSD, fromSD, frame, hw, hwR, heightSD, currentAt, S0, S1, bankTypeAt, LOOP_START, LOOP_END } from './world.js';
import { terrainH, groundAt } from './terrain.js';
import { U, windAt, std } from './matpatch.js';
import { CHERRY_SPAWN, VEG } from './veg.js';
import { LIGHTS } from './registry.js';
import { S } from './daycycle.js';
import { LAYER } from './post.js';
import { W, DMAX } from './water.js';
import { waveH } from './boat.js';
import TEX from './tex.js';
import { tube } from './geo.js';

const V3 = THREE.Vector3;
const r = mulberry32(9090);
const rr = (a, b) => a + (b - a) * r();
const _c1 = new THREE.Color();
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _s = new V3(), _p = new V3(), _w = new V3();

function petalGeo(N = 3) {
  // slightly cupped petal (N segments along its length, 4 triangles each)
  const pos = [], idx = [];
  for (let i = 0; i <= N; i++) for (let j = 0; j <= 2; j++) {
    const t = i / N, u = j / 2 - 0.5;
    const w = Math.sin(t * Math.PI) * 0.5 * (t > 0.85 ? 0.8 : 1);
    const x = u * w * 0.022, z = (t - 0.5) * 0.03, y = -Math.abs(u) * 0.004 + Math.sin(t * Math.PI) * 0.002;
    pos.push(x, y, z);
  }
  for (let i = 0; i < N; i++) for (let j = 0; j < 2; j++) { const a = i * 3 + j, b = a + 1, c = a + 3, d = c + 1; idx.push(a, c, b, b, c, d); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
  return g;
}

export class FX {
  constructor(scene, lm, gk) {
    this.scene = scene; this.lm = lm; this.gk = gk;
    this.petalMat = std({ color: 0xf8d4de, roughness: 0.6, side: THREE.DoubleSide }, { transl: 1.2, wet: 0.5, onShader: (sh) => { sh.fragmentShader = sh.fragmentShader.replace('float faceDirection = gl_FrontFacing ? 1.0 : - 1.0;', 'float faceDirection = 1.0;'); } });
    this.buildPetals(); this.buildSettled(); this.buildMotes(); this.buildMist(); this.buildGulls(); this.buildHerons(); this.buildInsects(); this.buildRain(); this.buildSpray();
  }
  // ---------------------------------------------------------------- petals (CPU sim)
  buildPetals() {
    const N = 3200;
    this.pN = N;
    this.pp = new Float32Array(N * 3); this.pv = new Float32Array(N * 3); this.pr = new Float32Array(N * 3); this.ps = new Float32Array(N * 3);
    this.pMode = new Uint8Array(N); this.pLife = new Float32Array(N);
    const g = petalGeo();
    this.petals = new THREE.InstancedMesh(g, this.petalMat, N);
    this.petals.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    const col = new THREE.Color();
    for (let i = 0; i < N; i++) { col.setRGB(1, rr(0.82, 0.95), rr(0.86, 0.96)); this.petals.setColorAt(i, col); this.pMode[i] = 3; this.pp[i * 3 + 1] = -1000; }
    this.petals.frustumCulled = false; this.petals.castShadow = false; this.petals.receiveShadow = true;
    this.petals.layers.set(LAYER.NOREFL);
    this.scene.add(this.petals);
    this.spawnAcc = 0; this.waterAcc = 0;
  }
  spawnPetal(i, focus, onWater) {
    const p = this.pp, v = this.pv;
    if (onWater) {
      // on the water surface around the focus (already drifting)
      const a = rr(0, 6.28), d = Math.sqrt(r()) * 60;
      const x = focus.x + Math.cos(a) * d, z = focus.z + Math.sin(a) * d;
      const { s, d: dd } = toSD(x, z);
      if (heightSD(s, dd) > -0.3) { this.pMode[i] = 3; return; }
      p[i * 3] = x; p[i * 3 + 1] = 0; p[i * 3 + 2] = z; this.pMode[i] = 1; this.pLife[i] = rr(20, 60);
    } else {
      // from a cherry canopy near the focus
      let src = null;
      for (let k = 0; k < 6; k++) { const c = CHERRY_SPAWN[Math.floor(r() * CHERRY_SPAWN.length)]; if (c && Math.abs(c.x - focus.x) < 170 && Math.abs(c.z - focus.z) < 170) { src = c; break; } }
      if (!src) { this.pMode[i] = 3; return; }
      p[i * 3] = src.x + rr(-1, 1); p[i * 3 + 1] = src.y + rr(-0.5, 0.5); p[i * 3 + 2] = src.z + rr(-1, 1);
      v[i * 3] = 0; v[i * 3 + 1] = 0; v[i * 3 + 2] = 0; this.pMode[i] = 0; this.pLife[i] = rr(25, 60);
    }
    this.pr[i * 3] = rr(0, 6.28); this.pr[i * 3 + 1] = rr(0, 6.28); this.pr[i * 3 + 2] = rr(0, 6.28);
    this.ps[i * 3] = rr(-3, 3); this.ps[i * 3 + 1] = rr(-3, 3); this.ps[i * 3 + 2] = rr(0.7, 1.3);
  }
  updatePetals(dt, t, focus, hero, tide) {
    const N = this.pN, p = this.pp, v = this.pv, R = this.pr, SP = this.ps;
    const rate = 70 * (0.6 + U.uWindV.value.w * 2) * (1 + S.rain * 1.2) * (S.night > 0.8 ? 0.6 : 1);
    this.spawnAcc += rate * dt; this.waterAcc += 25 * dt;
    let budget = Math.floor(this.spawnAcc), wbudget = Math.floor(this.waterAcc);
    this.spawnAcc -= budget; this.waterAcc -= wbudget;
    const fx = hero ? hero.fwd() : [0, -1];
    for (let i = 0; i < N; i++) {
      const m = this.pMode[i];
      if (m === 3) {
        if (budget > 0) { budget--; this.spawnPetal(i, focus, false); }
        else if (wbudget > 0) { wbudget--; this.spawnPetal(i, focus, true); }
        if (this.pMode[i] === 3) { _m.makeScale(0, 0, 0); this.petals.setMatrixAt(i, _m); continue; }
      }
      let x = p[i * 3], y = p[i * 3 + 1], z = p[i * 3 + 2];
      this.pLife[i] -= dt;
      const mode = this.pMode[i];
      if (mode === 0) { // airborne tumble
        windAt(x, z, t, _w);
        const w = 2.2 * (1 + S.storm * 1.5);
        v[i * 3] += ((_w.x * w + Math.sin(t * 2.3 + i) * 0.4) - v[i * 3]) * dt * 1.6;
        v[i * 3 + 2] += ((_w.z * w + Math.cos(t * 1.9 + i * 1.3) * 0.4) - v[i * 3 + 2]) * dt * 1.6;
        v[i * 3 + 1] += ((-0.55 - S.rain * 1.5 + Math.sin(t * 3.1 + i * 0.7) * 0.35) - v[i * 3 + 1]) * dt * 2.5;
        x += v[i * 3] * dt; y += v[i * 3 + 1] * dt; z += v[i * 3 + 2] * dt;
        R[i * 3] += SP[i * 3] * dt; R[i * 3 + 1] += SP[i * 3 + 1] * dt;
        const { s, d } = toSD(x, z); const gh = terrainH(s, d);
        const surf = gh < tide ? waveH(x, z, t, tide) : gh;
        if (y <= surf + 0.01) { y = surf + 0.005; this.pMode[i] = gh < tide - 0.05 ? 1 : 2; R[i * 3] = 0; R[i * 3 + 1] = rr(0, 6.28); this.pLife[i] = this.pMode[i] === 2 ? rr(15, 40) : rr(30, 70); }
      } else if (mode === 1) { // riding the current
        const { s, d } = toSD(x, z); const F = frame(s);
        const c = currentAt(s, d);
        windAt(x, z, t, _w);
        let vx = -F.fx * c + _w.x * 0.25, vz = -F.fz * c + _w.z * 0.25;
        // pushed aside by the hero boat's hull & wake
        if (hero) {
          const dx = x - hero.x, dz = z - hero.z; const dd = dx * dx + dz * dz;
          if (dd < 36) { const k = (6 - Math.sqrt(dd)) * 0.8; const lat = dx * -fx[1] + dz * fx[0]; vx += -fx[1] * Math.sign(lat) * k; vz += fx[0] * Math.sign(lat) * k; }
        }
        x += vx * dt; z += vz * dt;
        y = waveH(x, z, t, tide) + 0.004;
        R[i * 3 + 1] += SP[i * 3 + 1] * 0.05 * dt;
        if (heightSD(s, d) > tide + 0.05) { this.pMode[i] = 2; y = terrainH(s, d) + 0.004; }
      }
      if (this.pLife[i] <= 0 || Math.abs(x - focus.x) > 190 || Math.abs(z - focus.z) > 190) { this.pMode[i] = 3; _m.makeScale(0, 0, 0); this.petals.setMatrixAt(i, _m); continue; }
      p[i * 3] = x; p[i * 3 + 1] = y; p[i * 3 + 2] = z;
      _e.set(R[i * 3], R[i * 3 + 1], R[i * 3 + 2]); _q.setFromEuler(_e);
      const sc = SP[i * 3 + 2] * (this.pLife[i] < 2 && this.pMode[i] !== 0 ? this.pLife[i] / 2 : 1);
      _m.compose(_p.set(x, y, z), _q, _s.set(sc, sc, sc));
      this.petals.setMatrixAt(i, _m);
    }
    this.petals.instanceMatrix.needsUpdate = true;
  }
  // ---------------------------------------------------------------- petals settled on banks, steps, paths
  buildSettled() {
    const list = [];
    const addAt = (x, z, y, n, rad) => { for (let k = 0; k < n; k++) { const a = rr(0, 6.28), d = Math.sqrt(r()) * rad; const px = x + Math.cos(a) * d, pz = z + Math.sin(a) * d; const py = y !== null ? y : groundAt(px, pz); if (py < 0.1) continue; _q.setFromEuler(_e.set(rr(-0.2, 0.2), rr(0, 6.28), rr(-0.2, 0.2))); const sc = rr(0.8, 1.3); list.push(new THREE.Matrix4().compose(new V3(px, py + 0.012, pz), _q, new V3(sc, sc, sc))); } };
    for (const h of VEG.hero) if (h.sp === 'cherry' || h.sp === 'weeping') addAt(h.crown.x, h.crown.z, null, 170, h.r * 1.3 + 1);
    // river steps & promenade drifts (groundskeeper area has a swept pile)
    const st = this.lm.steps;
    for (let s = st.sA + 1; s < st.sB; s += 0.6) for (let k = 0; k < st.nSt; k++) {
      const y = 2.1 - (k + 1) * 0.29; if (y < 0.25) continue;
      const e = -(k + 0.5) * 0.72; const [x, z] = fromSD(s, hwR(s) + e + rr(-0.3, 0.3));
      if (s > 852 && s < 866 && k < 3) continue; // swept
      if (r() < 0.55) addAt(x, z, y, 3, 0.35);
    }
    // swept pile
    { const [x, z] = fromSD(866.5, hwR(866.5) - 1.1); addAt(x, z, 1.52, 140, 0.35); addAt(x, z, 1.54, 50, 0.18); }
    // petals on the ground are tiny: a 4-triangle shape, in 50 m tiles that are only drawn close to the camera
    const g = petalGeo(1); const cells = new Map(); const _t = new V3();
    for (const m of list) { _t.setFromMatrixPosition(m); const k = Math.floor(_t.x / 50) + ',' + Math.floor(_t.z / 50); if (!cells.has(k)) cells.set(k, []); cells.get(k).push(m); }
    const col = new THREE.Color();
    for (const [, ms] of cells) {
      const im = new THREE.InstancedMesh(g, this.petalMat, ms.length);
      ms.forEach((m, i) => { im.setMatrixAt(i, m); col.setRGB(1, rr(0.8, 0.95), rr(0.85, 0.95)).multiplyScalar(rr(0.75, 1)); im.setColorAt(i, col); });
      im.computeBoundingSphere(); im.receiveShadow = true; im.layers.set(LAYER.NOREFL);
      im.userData.maxDist = 75; VEG.far.push(im);
      this.scene.add(im);
    }
  }
  // ---------------------------------------------------------------- dust motes (glow only inside sunbeams)
  buildMotes() {
    const N = 900; const pos = new Float32Array(N * 3), seed = new Float32Array(N);
    for (let i = 0; i < N; i++) { pos[i * 3] = rr(-1, 1); pos[i * 3 + 1] = rr(-1, 1); pos[i * 3 + 2] = rr(-1, 1); seed[i] = r(); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('seed', new THREE.BufferAttribute(seed, 1));
    this.moteU = { uCam: { value: new V3() }, uTime: U.uTime, uSun: { value: new V3() }, uSunCol: { value: new THREE.Color() }, uK: { value: 0 }, uPx: { value: 1 } };
    const m = new THREE.ShaderMaterial({
      uniforms: this.moteU, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexShader: /* glsl */`
        attribute float seed; uniform vec3 uCam, uSun; uniform float uTime, uK, uPx; varying float vB;
        float h(vec3 p){ return fract(sin(dot(p, vec3(12.9898,78.233,37.719)))*43758.5453); }
        void main(){
          vec3 box = vec3(26.0, 9.0, 26.0);
          vec3 p = position * box + vec3(sin(uTime*0.3+seed*40.0), sin(uTime*0.23+seed*17.0)*0.6, cos(uTime*0.27+seed*23.0)) * 1.5;
          p += vec3(uTime*0.25, 0.0, uTime*0.12);
          p = mod(p - uCam + box, 2.0*box) - box + uCam;
          // sunbeam volumes: stripes perpendicular to the sun direction (shafts between canopies)
          vec3 sd = normalize(uSun); vec3 t1 = normalize(cross(sd, vec3(0.0,1.0,0.0))); vec3 t2 = cross(sd, t1);
          vec2 q = vec2(dot(p, t1), dot(p, t2));
          float beam = smoothstep(0.55, 0.9, 0.5 + 0.5*sin(q.x*0.45 + sin(q.y*0.21)*2.0)) * smoothstep(0.3, 0.8, 0.5+0.5*sin(q.x*0.13 - q.y*0.09));
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          vec3 vd = normalize(p - uCam);
          float fwd = 0.3 + 1.7*pow(max(dot(vd, sd), 0.0), 3.0);
          vB = beam * fwd * uK * (0.5 + 0.5*sin(uTime*2.0 + seed*50.0));
          gl_PointSize = uPx * (0.9 + seed) * 60.0 / -mv.z;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */`
        uniform vec3 uSunCol; varying float vB;
        void main(){ vec2 c = gl_PointCoord - 0.5; float a = smoothstep(0.5, 0.0, length(c)); gl_FragColor = vec4(uSunCol * vB * a * 1.4, 1.0); }`,
    });
    this.motes = new THREE.Points(g, m); this.motes.frustumCulled = false; this.motes.layers.set(LAYER.TRANS);
    this.scene.add(this.motes);
  }
  // ---------------------------------------------------------------- river mist: layered sheets over the water + drifting banks
  buildMist() {
    const layers = [0.35, 1.1, 2.2, 3.6];
    this.mistU = { uTime: U.uTime, tMist: { value: TEX.mist.map }, tDepth: { value: W.tDepth }, uCol: { value: new THREE.Color() }, uK: { value: 0.5 }, uCam: { value: new V3() }, uS0: { value: S0 }, uSL: { value: S1 - S0 }, uDM: { value: DMAX }, uFade: { value: 0 }, uLOn: U.uLOn, uLPos: U.uLPos, uLCol: U.uLCol };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.mistU, transparent: true, depthWrite: false, side: THREE.DoubleSide,
      vertexShader: /* glsl */`
        attribute vec2 aSD; attribute float aH; varying vec2 vSD; varying vec3 vW; varying float vH;
        void main(){ vSD = aSD; vH = aH; vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
      fragmentShader: /* glsl */`
        uniform float uTime, uK, uS0, uSL, uDM, uFade, uLOn; uniform sampler2D tMist, tDepth; uniform vec3 uCol, uCam;
        uniform vec4 uLPos[16]; uniform vec3 uLCol[16];
        varying vec2 vSD; varying vec3 vW; varying float vH;
        void main(){
          vec2 dUv = vec2((vSD.y + uDM)/(2.0*uDM), (vSD.x - uS0)/uSL);
          float depth = texture2D(tDepth, dUv).r * 12.0;
          float over = smoothstep(0.15, 2.5, depth);
          vec2 uv = vW.xz * 0.012 + vec2(uTime*0.004, -uTime*0.006) + vH*0.37;
          float n = texture2D(tMist, uv).a * texture2D(tMist, uv*2.3 + vec2(-uTime*0.01, uTime*0.004)).a;
          float banks = smoothstep(0.25, 0.75, texture2D(tMist, vW.xz*0.0025 + vec2(uTime*0.002, 0.0) + vH).a);
          vec3 V = normalize(uCam - vW);
          float graze = 1.0 - abs(V.y);
          float dist = length(uCam - vW);
          float a = n * banks * over * uK * (0.35 + 0.65*graze*graze) * smoothstep(3.0, 18.0, dist) * (1.0 - smoothstep(600.0, 1200.0, dist));
          a = max(a, uFade * n * 0.8 * over);
          vec3 c = uCol;
          for (int i = 0; i < 16; i++) { vec4 lp = uLPos[i]; if (lp.w <= 0.0) continue; float d = length(lp.xyz - vW); c += uLCol[i] * pow(clamp(1.0 - d/(lp.w*1.4), 0.0, 1.0), 2.0) * 0.25 * uLOn; }
          gl_FragColor = vec4(c, clamp(a, 0.0, 0.65));
        }`,
    });
    this.mistMeshes = [];
    for (const h of layers) {
      const pos = [], sd = [], hh = [], idx = [];
      const rows = Math.floor((S1 - S0) / 12), NC = 16;
      for (let i = 0; i <= rows; i++) { const s = S0 + i * 12; const F = frame(s); const wl = hw(s, -1), wr = hw(s, 1); for (let k = 0; k <= NC; k++) { const u = k / NC; const d = -wl + (wl + wr) * u; pos.push(F.x + F.rx * d, h, F.z + F.rz * d); sd.push(s, d); hh.push(h); } }
      for (let i = 0; i < rows; i++) for (let k = 0; k < NC; k++) { const a = i * (NC + 1) + k, b = a + 1, c = a + NC + 1, d = c + 1; idx.push(a, b, c, b, d, c); }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('aSD', new THREE.Float32BufferAttribute(sd, 2)); g.setAttribute('aH', new THREE.Float32BufferAttribute(hh, 1)); g.setIndex(idx);
      const mesh = new THREE.Mesh(g, mat); mesh.frustumCulled = false; mesh.layers.set(LAYER.TRANS); mesh.renderOrder = 5;
      this.scene.add(mesh); this.mistMeshes.push(mesh);
    }
  }
  // ---------------------------------------------------------------- gulls
  buildGulls() {
    const body = []; const pos = [], idx = [], wing = [];
    // body: tapered spindle
    const addQuad = (a, b, c, d, w) => { const k = pos.length / 3; pos.push(...a, ...b, ...c, ...d); wing.push(...w); idx.push(k, k + 1, k + 2, k, k + 2, k + 3); };
    const g0 = new THREE.SphereGeometry(0.12, 8, 6); g0.scale(1, 0.9, 3.2);
    const gp = g0.attributes.position; for (let i = 0; i < gp.count; i++) { pos.push(gp.getX(i), gp.getY(i), gp.getZ(i)); wing.push(0); }
    const gi = g0.index.array; for (let i = 0; i < gi.length; i++) idx.push(gi[i]);
    // wings: inner & outer panels each side (wing weight 1 inner, 2 outer)
    for (const sx of [-1, 1]) {
      addQuad([sx * 0.08, 0, -0.12], [sx * 0.55, 0.02, -0.08], [sx * 0.55, 0.02, 0.12], [sx * 0.08, 0, 0.16], [0, sx * 1, sx * 1, 0]);
      addQuad([sx * 0.55, 0.02, -0.08], [sx * 0.95, 0.0, 0.05], [sx * 0.9, 0.0, 0.16], [sx * 0.55, 0.02, 0.12], [sx * 1, sx * 2, sx * 2, sx * 1]);
    }
    // tail
    addQuad([-0.08, 0, 0.3], [0.08, 0, 0.3], [0.12, 0, 0.5], [-0.12, 0, 0.5], [0, 0, 0, 0]);
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('aWing', new THREE.Float32BufferAttribute(wing, 1)); g.setIndex(idx); g.computeVertexNormals();
    const mat = std({ color: 0xeef0f2, roughness: 0.6, side: THREE.DoubleSide }, {
      wet: 0,
      vertHead: 'attribute float aWing; varying float vWing;',
      vertexExtra: `\n { float ph = uTime*7.0 + float(gl_InstanceID)*1.7; float flap = sin(ph) * (0.6 + 0.4*sin(uTime*0.3 + float(gl_InstanceID))); float glide = step(0.3, fract(uTime*0.05 + float(gl_InstanceID)*0.13)); flap *= mix(1.0, 0.15, glide);
        float aw = abs(aWing); transformed.y += aw * flap * 0.28 * (aw > 1.5 ? 1.6 : 1.0); vWing = aw; }\n`,
      fragHead: 'varying float vWing;',
      colorExtra: `\n diffuseColor.rgb *= mix(vec3(1.0), vec3(0.62,0.66,0.7), step(0.5, vWing)*0.8); diffuseColor.rgb *= mix(vec3(1.0), vec3(0.08), step(1.8, vWing)*0.9);\n`,
    });
    this.gullN = 18;
    this.gulls = new THREE.InstancedMesh(g, mat, this.gullN); this.gulls.frustumCulled = false; this.gulls.castShadow = true;
    this.scene.add(this.gulls);
    this.gullState = Array.from({ length: this.gullN }, (_, i) => ({ flock: i % 2, a: rr(0, 6.28), rad: rr(14, 40), h: rr(12, 30), sp: rr(0.2, 0.4) * (r() < 0.5 ? 1 : -1), bob: rr(0, 6) }));
  }
  // ---------------------------------------------------------------- herons
  buildHerons() {
    const mk = () => {
      const grp = new THREE.Group();
      const blue = std({ color: 0x7a8a9e, roughness: 0.75 }, { wet: 0 });
      const pale = std({ color: 0xc8ccd0, roughness: 0.7 }, { wet: 0 });
      const dark = std({ color: 0x2a2e36, roughness: 0.7 }, { wet: 0 });
      const bill = std({ color: 0xd8a830, roughness: 0.5 }, { wet: 0 });
      const b = new THREE.SphereGeometry(0.18, 10, 8); b.scale(1, 0.95, 2.6);
      grp.add(new THREE.Mesh(b, blue));
      // S-curved retracted neck + head + dagger bill
      const neck = [new V3(0, 0.05, -0.38), new V3(0, 0.2, -0.5), new V3(0, 0.12, -0.62), new V3(0, 0.18, -0.74)];
      grp.add(new THREE.Mesh(tube(neck, [0.08, 0.06, 0.055, 0.05], 8), pale));
      const hd = new THREE.SphereGeometry(0.07, 8, 6); hd.scale(0.8, 0.9, 1.4); hd.translate(0, 0.19, -0.8); grp.add(new THREE.Mesh(hd, pale));
      const bl = new THREE.ConeGeometry(0.025, 0.28, 6); bl.rotateX(-Math.PI / 2); bl.translate(0, 0.18, -1.0); grp.add(new THREE.Mesh(bl, bill));
      const crest = new THREE.ConeGeometry(0.015, 0.2, 4); crest.rotateX(Math.PI / 2 + 0.3); crest.translate(0, 0.24, -0.72); grp.add(new THREE.Mesh(crest, dark));
      // trailing legs
      for (const sx of [-0.05, 0.05]) { const lg = new THREE.CylinderGeometry(0.012, 0.012, 0.9, 5); lg.rotateX(Math.PI / 2); lg.translate(sx, -0.05, 0.85); grp.add(new THREE.Mesh(lg, dark)); }
      // broad wings (hinged groups)
      const wings = [];
      for (const sx of [-1, 1]) {
        const wg = new THREE.Group(); wg.position.set(sx * 0.12, 0.08, -0.08);
        const s1 = new THREE.Shape(); s1.moveTo(0, -0.3); s1.lineTo(0.9, -0.28); s1.lineTo(0.9, 0.3); s1.lineTo(0, 0.35);
        const w1 = new THREE.ShapeGeometry(s1); w1.rotateX(-Math.PI / 2); if (sx < 0) w1.scale(-1, 1, 1);
        const m1 = new THREE.Mesh(w1, blue); m1.material.side = THREE.DoubleSide; wg.add(m1);
        const og = new THREE.Group(); og.position.set(sx * 0.9, 0, 0);
        const s2 = new THREE.Shape(); s2.moveTo(0, -0.28); s2.lineTo(0.75, -0.1); s2.lineTo(0.8, 0.18); s2.lineTo(0, 0.3);
        const w2 = new THREE.ShapeGeometry(s2); w2.rotateX(-Math.PI / 2); if (sx < 0) w2.scale(-1, 1, 1);
        og.add(new THREE.Mesh(w2, dark)); wg.add(og);
        grp.add(wg); wings.push([wg, og, sx]);
      }
      grp.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.material.side = THREE.DoubleSide; } });
      grp.userData.wings = wings; grp.visible = false;
      this.scene.add(grp); return grp;
    };
    this.herons = [mk(), mk()];
    this.heronT = 25; this.heronFlight = null;
  }
  // ---------------------------------------------------------------- insects near lamps at dusk
  buildInsects() {
    const N = 480; const pos = new Float32Array(N * 3), seed = new Float32Array(N);
    for (let i = 0; i < N; i++) seed[i] = r();
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('seed', new THREE.BufferAttribute(seed, 1));
    this.insU = { uTime: U.uTime, uK: { value: 0 }, uPx: { value: 1 } };
    const m = new THREE.ShaderMaterial({
      uniforms: this.insU, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexShader: /* glsl */`attribute float seed; uniform float uTime, uK, uPx; varying float vA;
        void main(){ float t = uTime*(1.5 + seed*2.0) + seed*60.0; vec3 o = vec3(sin(t*1.3)*0.9 + sin(t*3.1)*0.3, sin(t*1.7)*0.6 + cos(t*2.3)*0.2, cos(t*1.1)*0.9 + sin(t*2.9)*0.3);
          vec4 mv = modelViewMatrix * vec4(position + o, 1.0); vA = uK * (0.6 + 0.4*sin(t*5.0)); gl_PointSize = uPx * 22.0 / -mv.z; gl_Position = projectionMatrix * mv; }`,
      fragmentShader: /* glsl */`varying float vA; void main(){ float a = smoothstep(0.5, 0.0, length(gl_PointCoord-0.5)); gl_FragColor = vec4(vec3(1.0, 0.85, 0.55) * a * vA * 3.0, 1.0); }`,
    });
    this.insects = new THREE.Points(g, m); this.insects.frustumCulled = false; this.insects.layers.set(LAYER.TRANS);
    this.scene.add(this.insects);
    this.lampList = LIGHTS.filter((l) => l.insects);
  }
  // ---------------------------------------------------------------- rain + splash crowns
  buildRain() {
    const N = 12000; const pos = new Float32Array(N * 3 * 4), idx = [], seed = new Float32Array(N * 4), corner = new Float32Array(N * 4 * 2);
    for (let i = 0; i < N; i++) {
      const x = r(), y = r(), z = r(), s = r();
      for (let k = 0; k < 4; k++) { pos.set([x, y, z], (i * 4 + k) * 3); seed[i * 4 + k] = s; corner.set([k % 2, Math.floor(k / 2)], (i * 4 + k) * 2); }
      idx.push(i * 4, i * 4 + 1, i * 4 + 2, i * 4 + 1, i * 4 + 3, i * 4 + 2);
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('seed', new THREE.BufferAttribute(seed, 1)); g.setAttribute('corner', new THREE.BufferAttribute(corner, 2)); g.setIndex(idx);
    this.rainU = { uTime: U.uTime, uCam: { value: new V3() }, uK: { value: 0 }, uWind: { value: new V3() }, uCol: { value: new THREE.Color() }, uFlash: U.uFlash };
    const m = new THREE.ShaderMaterial({
      uniforms: this.rainU, transparent: true, depthWrite: false,
      vertexShader: /* glsl */`
        attribute float seed; attribute vec2 corner; uniform float uTime, uK; uniform vec3 uCam, uWind; varying float vA; varying vec2 vC;
        void main(){
          vec3 box = vec3(36.0, 24.0, 36.0);
          vec3 vel = vec3(uWind.x*2.5, -9.5 - seed*2.0, uWind.z*2.5);
          vec3 p = position * 2.0 * box - box;
          p += vel * uTime;
          p = mod(p - uCam + box, 2.0*box) - box + uCam;
          vec3 dir = normalize(vel);
          vec3 toCam = normalize(uCam - p);
          vec3 side = normalize(cross(dir, toCam));
          float len = 0.35 + seed*0.25, w = 0.008;
          p += side * (corner.x - 0.5) * w + dir * corner.y * len;
          vA = uK * step(seed, uK) * smoothstep(40.0, 6.0, length(p - uCam)) * smoothstep(0.0, 2.0, length(p - uCam));
          vC = corner;
          gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
        }`,
      fragmentShader: /* glsl */`uniform vec3 uCol; uniform float uFlash; varying float vA; varying vec2 vC;
        void main(){ float a = vA * (1.0 - abs(vC.x - 0.5)*2.0) * sin(vC.y*3.1416); gl_FragColor = vec4(uCol * (1.0 + uFlash*3.0), a * 0.22); }`,
    });
    this.rain = new THREE.Mesh(g, m); this.rain.frustumCulled = false; this.rain.layers.set(LAYER.TRANS); this.rain.renderOrder = 10;
    this.scene.add(this.rain);
    // splash crowns
    const cg = [];
    const crown = new THREE.BufferGeometry();
    { const pos = [], id = [];
      const n = 10;
      for (let i = 0; i < n; i++) { const a = i / n * Math.PI * 2, a2 = (i + 0.5) / n * Math.PI * 2; const k = pos.length / 3;
        pos.push(Math.cos(a) * 0.05, 0, Math.sin(a) * 0.05, Math.cos(a2) * 0.05, 0, Math.sin(a2) * 0.05, Math.cos((a + a2) / 2) * 0.09, 0.07, Math.sin((a + a2) / 2) * 0.09);
        id.push(k, k + 1, k + 2); }
      pos.push(0, 0.1, 0, -0.01, 0.07, 0, 0.01, 0.07, 0); id.push(pos.length / 3 - 3, pos.length / 3 - 2, pos.length / 3 - 1);
      crown.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); crown.setIndex(id); crown.computeVertexNormals(); }
    this.splN = 500;
    const sm = std({ color: 0xdfe6ea, roughness: 0.1, transparent: true, opacity: 0.55, side: THREE.DoubleSide }, { wet: 0 });
    this.splash = new THREE.InstancedMesh(crown, sm, this.splN); this.splash.frustumCulled = false; this.splash.layers.set(LAYER.TRANS);
    this.splash.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.splPh = new Float32Array(this.splN).map(() => r()); this.splPos = new Float32Array(this.splN * 3); this.splOk = new Uint8Array(this.splN);
    this.scene.add(this.splash);
  }
  // ---------------------------------------------------------------- bow spray
  buildSpray() {
    const N = this.sprN = 420;
    this.spP = new Float32Array(N * 3); this.spV = new Float32Array(N * 3); this.spL = new Float32Array(N); this.spL0 = new Float32Array(N).fill(1);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.spP, 3).setUsage(THREE.DynamicDrawUsage));
    this.spA = new Float32Array(N); g.setAttribute('aLife', new THREE.BufferAttribute(this.spA, 1).setUsage(THREE.DynamicDrawUsage));
    this.spS = new Float32Array(N).map(() => rr(0.6, 1.4)); g.setAttribute('aSize', new THREE.BufferAttribute(this.spS, 1));
    this.sprayU = { uCol: { value: new THREE.Color() }, uPx: { value: 1 } };
    const m = new THREE.ShaderMaterial({
      uniforms: this.sprayU, transparent: true, depthWrite: false,
      vertexShader: /* glsl */`attribute float aLife; attribute float aSize; uniform float uPx; varying float vA;
        void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); vA = aLife; gl_PointSize = uPx * aSize * (0.35 + 0.65*aLife) * 70.0 / -mv.z; gl_Position = projectionMatrix * mv; }`,
      fragmentShader: /* glsl */`uniform vec3 uCol; varying float vA;
        void main(){ vec2 c = gl_PointCoord - 0.5; float d = length(c); float a = smoothstep(0.5, 0.15, d) * vA; if (a < 0.01) discard; gl_FragColor = vec4(uCol, a * 0.75); }`,
    });
    this.spray = new THREE.Points(g, m); this.spray.frustumCulled = false; this.spray.layers.set(LAYER.TRANS); this.spray.renderOrder = 8;
    this.scene.add(this.spray); this.spAcc = 0; this.spI = 0;
  }
  updateSpray(dt, t, hero, tide) {
    if (!hero) return;
    const [fx, fz] = hero.fwd(); const rx = -fz, rz = fx;
    const spd = Math.max(0, hero.u);
    const rate = Math.max(0, spd - 2.0) * 38; // particles per second
    this.spAcc += rate * dt;
    const N = this.sprN;
    while (this.spAcc >= 1) {
      this.spAcc -= 1;
      const i = this.spI = (this.spI + 1) % N; const side = (i & 1) ? 1 : -1;
      const along = rr(1.6, 2.5), lat = side * rr(0.55, 0.9);
      const x = hero.x + fx * along + rx * lat, z = hero.z + fz * along + rz * lat;
      this.spP[i * 3] = x; this.spP[i * 3 + 1] = waveH(x, z, t, tide) + rr(0.02, 0.15); this.spP[i * 3 + 2] = z;
      const out = rr(0.8, 2.2) * (spd / 6), up = rr(0.8, 2.3) * (spd / 6);
      this.spV[i * 3] = fx * spd * rr(0.35, 0.7) + rx * side * out; this.spV[i * 3 + 1] = up; this.spV[i * 3 + 2] = fz * spd * rr(0.35, 0.7) + rz * side * out;
      this.spL0[i] = rr(0.45, 0.95); this.spL[i] = this.spL0[i];
    }
    for (let i = 0; i < N; i++) {
      if (this.spL[i] <= 0) { this.spA[i] = 0; this.spP[i * 3 + 1] = -100; continue; }
      this.spL[i] -= dt;
      this.spV[i * 3 + 1] -= 9.81 * dt;
      const drag = Math.exp(-dt * 1.5); this.spV[i * 3] *= drag; this.spV[i * 3 + 2] *= drag;
      this.spP[i * 3] += this.spV[i * 3] * dt; this.spP[i * 3 + 1] += this.spV[i * 3 + 1] * dt; this.spP[i * 3 + 2] += this.spV[i * 3 + 2] * dt;
      if (this.spP[i * 3 + 1] < tide - 0.05) this.spL[i] = 0;
      this.spA[i] = Math.max(0, this.spL[i] / this.spL0[i]);
    }
    this.spray.geometry.attributes.position.needsUpdate = true; this.spray.geometry.attributes.aLife.needsUpdate = true;
    this.sprayU.uCol.value.copy(S.amb).multiplyScalar(S.ambI * 1.05).add(_c1.copy(S.keyCol).multiplyScalar(S.keyI * Math.max(S.keyDir.y, 0) * 0.35)).addScalar(S.flash * 0.6);
    this.sprayU.uPx.value = this.moteU.uPx.value;
  }
  // ---------------------------------------------------------------- per frame
  update(dt, t, camera, hero, tide) {
    const cam = camera.position; const focus = hero ? hero.root.position : cam;
    this.updatePetals(dt, t, focus, hero, tide);
    this.updateSpray(dt, t, hero, tide);
    // motes
    const sunUp = smooth(0.02, 0.15, S.sunDir.y) * (1 - S.storm) * (1 - smooth(0.9, 1.1, S.sunDir.y * 1.6));
    const golden = 1 - smooth(0.25, 0.7, S.sunDir.y);
    this.moteU.uCam.value.copy(cam); this.moteU.uSun.value.copy(S.sunDir); this.moteU.uSunCol.value.copy(S.sunCol).multiplyScalar(S.sunI * 0.25);
    this.moteU.uK.value = sunUp * (0.3 + 0.7 * golden);
    // mist
    const mk = S.mist * (1 - S.rain * 0.3);
    this.mistU.uK.value = lerp(this.mistU.uK.value, mk, 1 - Math.exp(-dt * 0.5));
    this.mistU.uCol.value.copy(S.fog).lerp(S.amb, 0.25).multiplyScalar(0.9 + S.sunI * 0.08);
    this.mistU.uCam.value.copy(cam);
    // gulls wheel over the river ahead
    const hs = hero ? hero.s : 0;
    for (let i = 0; i < this.gullN; i++) {
      const gs = this.gullState[i];
      gs.a += gs.sp * dt;
      const cs = hs + 60 + gs.flock * 70 + Math.sin(t * 0.02 + gs.flock) * 30; const cd = (gs.flock ? -25 : 20) + Math.sin(t * 0.05) * 10;
      const [cx, cz] = fromSD(cs, cd);
      const x = cx + Math.cos(gs.a) * gs.rad, z = cz + Math.sin(gs.a) * gs.rad, y = gs.h + Math.sin(t * 0.5 + gs.bob) * 2 + 3;
      const sg = gs.sp > 0 ? 1 : -1; const vx = -Math.sin(gs.a) * sg, vz = Math.cos(gs.a) * sg;
      _q.setFromEuler(_e.set(0, Math.atan2(-vx, -vz), sg * 0.35, 'YXZ'));
      _m.compose(_p.set(x, y, z), _q, _s.setScalar(1));
      this.gulls.setMatrixAt(i, _m);
    }
    this.gulls.instanceMatrix.needsUpdate = true;
    this.gulls.visible = S.night < 0.7 && S.storm < 0.8;
    // herons: occasionally a pair crosses ahead of the boat
    this.updateHerons(dt, t, hero);
    // insects near lamps at dusk / night
    const ik = S.lightsOn * (1 - S.rain) * (1 - smooth(0.5, 1, S.night) * 0.4);
    this.insU.uK.value = ik;
    if (ik > 0.01) {
      const near = this.lampList.map((l) => [l.p.distanceToSquared(cam), l]).sort((a, b) => a[0] - b[0]).slice(0, 40);
      const pa = this.insects.geometry.attributes.position;
      for (let i = 0; i < pa.count; i++) { const L = near[i % Math.max(1, near.length)]; if (!L) break; const l = L[1]; pa.setXYZ(i, l.p.x, l.p.y + 0.2, l.p.z); }
      pa.needsUpdate = true;
    }
    this.insects.visible = ik > 0.01;
    // rain
    const rk = S.rain;
    this.rain.visible = rk > 0.01;
    this.rainU.uK.value = rk; this.rainU.uCam.value.copy(cam);
    windAt(cam.x, cam.z, t, this.rainU.uWind.value);
    this.rainU.uCol.value.copy(S.amb).multiplyScalar(S.ambI * 0.9 + 0.2);
    this.splash.visible = rk > 0.05;
    if (this.splash.visible) {
      for (let i = 0; i < this.splN; i++) {
        let ph = this.splPh[i] + dt * 3.2;
        if (ph >= 1 || !this.splOk[i]) {
          ph = ph % 1;
          const a = rr(0, 6.28), d = Math.sqrt(r()) * 28 + 1.5;
          const x = cam.x + Math.cos(a) * d, z = cam.z + Math.sin(a) * d; const { s, d: dd } = toSD(x, z);
          this.splOk[i] = heightSD(s, dd) < -0.2 && r() < rk ? 1 : 0;
          this.splPos[i * 3] = x; this.splPos[i * 3 + 2] = z;
        }
        this.splPh[i] = ph;
        const sc = this.splOk[i] ? Math.sin(ph * Math.PI) * (0.6 + ph) : 0;
        const x = this.splPos[i * 3], z = this.splPos[i * 3 + 2];
        _m.compose(_p.set(x, waveH(x, z, t, tide), z), _q.identity(), _s.set(sc, sc * (1 - ph * 0.5), sc));
        this.splash.setMatrixAt(i, _m);
      }
      this.splash.instanceMatrix.needsUpdate = true;
    }
  }
  updateHerons(dt, t, hero) {
    if (!hero) return;
    this.heronT -= dt;
    if (!this.heronFlight && this.heronT <= 0 && S.night < 0.6 && S.storm < 0.5) {
      const side = r() < 0.5 ? 1 : -1;
      const s = hero.s + rr(70, 110);
      const d0 = side * (hw(s, side) + 12), d1 = -side * (hw(s, -side) + 18);
      this.heronFlight = { s, d0, d1, t: 0, dur: Math.abs(d1 - d0) / 8.5, h: rr(9, 15) };
      this.herons.forEach((h) => (h.visible = true));
    }
    if (this.heronFlight) {
      const f = this.heronFlight; f.t += dt; const u = f.t / f.dur;
      if (u >= 1) { this.heronFlight = null; this.heronT = rr(55, 95); this.herons.forEach((h) => (h.visible = false)); return; }
      this.herons.forEach((h, k) => {
        const uu = clamp(u - k * 0.06, 0, 1);
        const s = f.s + k * 6 + Math.sin(uu * 3) * 4; const d = lerp(f.d0, f.d1, uu) + k * 3;
        const [x, z] = fromSD(s, d);
        const [x2, z2] = fromSD(s, d + Math.sign(f.d1 - f.d0));
        h.position.set(x, f.h + Math.sin(uu * Math.PI) * 4 + k * 1.5 + Math.sin(t * 1.4 + k) * 0.3, z);
        h.rotation.set(0, Math.atan2(x - x2, z - z2), 0);
        const flap = Math.sin(t * 4.6 + k * 1.3);
        for (const [wg, og, sx] of h.userData.wings) { wg.rotation.z = sx * flap * 0.55; og.rotation.z = sx * flap * 0.35 + sx * 0.08; }
      });
    }
  }
}
