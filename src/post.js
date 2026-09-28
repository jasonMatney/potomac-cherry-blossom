// Render pipeline: planar reflection, refraction copy, HDR scene, bloom, god rays, filmic grade
import * as THREE from 'three';
import { S } from './daycycle.js';

export const LAYER = { MAIN: 0, NOREFL: 1, WATER: 2, TRANS: 3 };

const quadGeo = new THREE.BufferGeometry();
quadGeo.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
const quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
function fsMat(frag, uniforms) {
  return new THREE.ShaderMaterial({
    uniforms, depthTest: false, depthWrite: false,
    vertexShader: 'varying vec2 vUv; void main(){ vUv = position.xy*0.5+0.5; gl_Position = vec4(position.xy,0.0,1.0); }',
    fragmentShader: frag,
  });
}

export class Pipeline {
  constructor(renderer, scene, camera) {
    this.r = renderer; this.scene = scene; this.camera = camera;
    this.quad = new THREE.Mesh(quadGeo, null); this.quad.frustumCulled = false;
    this.qScene = new THREE.Scene(); this.qScene.add(this.quad);
    const hf = { type: THREE.HalfFloatType, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter };
    this.rtMain = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, samples: 4, depthBuffer: true });
    this.rtRefl = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, depthBuffer: true });
    this.rtRefr = new THREE.WebGLRenderTarget(4, 4, hf);
    this.rtBright = new THREE.WebGLRenderTarget(4, 4, hf);
    this.mips = []; for (let i = 0; i < 6; i++) this.mips.push(new THREE.WebGLRenderTarget(4, 4, hf));
    this.ups = []; for (let i = 0; i < 5; i++) this.ups.push(new THREE.WebGLRenderTarget(4, 4, hf));
    this.rtRays = new THREE.WebGLRenderTarget(4, 4, hf);
    this.rtRays2 = new THREE.WebGLRenderTarget(4, 4, hf);
    this.reflCam = new THREE.PerspectiveCamera();
    this.reflCam.layers.set(LAYER.MAIN);
    this.waterLevel = 0;
    this.copyMat = fsMat('uniform sampler2D tSrc; varying vec2 vUv; void main(){ gl_FragColor = texture2D(tSrc, vUv); }', { tSrc: { value: null } });
    this.brightMat = fsMat(/* glsl */`
      uniform sampler2D tSrc; uniform float uThr; uniform vec2 uTexel; varying vec2 vUv;
      void main(){
        vec3 c = texture2D(tSrc, vUv + uTexel*vec2(-0.5,-0.5)).rgb + texture2D(tSrc, vUv + uTexel*vec2(0.5,-0.5)).rgb
               + texture2D(tSrc, vUv + uTexel*vec2(-0.5,0.5)).rgb + texture2D(tSrc, vUv + uTexel*vec2(0.5,0.5)).rgb;
        c *= 0.25;
        c = min(c, vec3(24.0));
        float l = dot(c, vec3(0.2126,0.7152,0.0722));
        float k = max(l - uThr, 0.0); k = k*k/(l + 1e-4) + max(l - uThr*1.5, 0.0)*0.2;
        gl_FragColor = vec4(c * (k / max(l, 1e-4)), l);
      }`, { tSrc: { value: null }, uThr: { value: 1.0 }, uTexel: { value: new THREE.Vector2() } });
    this.downMat = fsMat(/* glsl */`
      uniform sampler2D tSrc; uniform vec2 uTexel; varying vec2 vUv;
      void main(){
        vec2 t = uTexel;
        vec3 a = texture2D(tSrc, vUv + t*vec2(-1,-1)).rgb, b = texture2D(tSrc, vUv + t*vec2(1,-1)).rgb;
        vec3 c = texture2D(tSrc, vUv + t*vec2(-1,1)).rgb, d = texture2D(tSrc, vUv + t*vec2(1,1)).rgb;
        vec3 e = texture2D(tSrc, vUv).rgb;
        gl_FragColor = vec4((a+b+c+d)*0.125 + e*0.5, 1.0);
      }`, { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() } });
    this.upMat = fsMat(/* glsl */`
      uniform sampler2D tSrc; uniform sampler2D tBase; uniform vec2 uTexel; uniform float uW; varying vec2 vUv;
      void main(){
        vec2 t = uTexel;
        vec3 s = texture2D(tSrc, vUv + t*vec2(-1,-1)).rgb + texture2D(tSrc, vUv + t*vec2(1,-1)).rgb + texture2D(tSrc, vUv + t*vec2(-1,1)).rgb + texture2D(tSrc, vUv + t*vec2(1,1)).rgb;
        s += 2.0*(texture2D(tSrc, vUv + t*vec2(0,-1)).rgb + texture2D(tSrc, vUv + t*vec2(0,1)).rgb + texture2D(tSrc, vUv + t*vec2(-1,0)).rgb + texture2D(tSrc, vUv + t*vec2(1,0)).rgb);
        s += 4.0*texture2D(tSrc, vUv).rgb;
        gl_FragColor = vec4(texture2D(tBase, vUv).rgb + s/16.0 * uW, 1.0);
      }`, { tSrc: { value: null }, tBase: { value: null }, uTexel: { value: new THREE.Vector2() }, uW: { value: 1 } });
    this.rayMat = fsMat(/* glsl */`
      uniform sampler2D tSrc; uniform vec2 uLight; uniform float uLen; varying vec2 vUv;
      void main(){
        vec2 d = (uLight - vUv) * uLen / 28.0;
        vec2 p = vUv; float w = 1.0; vec3 acc = vec3(0.0); float tw = 0.0;
        float j = fract(sin(dot(vUv, vec2(12.9898,78.233)))*43758.5453);
        p += d * j;
        for (int i = 0; i < 28; i++) { vec4 s = texture2D(tSrc, p); acc += s.rgb * w; tw += w; w *= 0.96; p += d; }
        gl_FragColor = vec4(acc / tw, 1.0);
      }`, { tSrc: { value: null }, uLight: { value: new THREE.Vector2() }, uLen: { value: 0.6 } });
    this.rayMaskMat = fsMat(/* glsl */`
      uniform sampler2D tSrc; uniform vec2 uLight; uniform float uAsp; uniform vec3 uCol; varying vec2 vUv;
      void main(){
        vec4 c = texture2D(tSrc, vUv);
        float l = dot(c.rgb, vec3(0.2126,0.7152,0.0722));
        vec2 dd = (vUv - uLight) * vec2(uAsp, 1.0);
        float fall = exp(-dot(dd,dd)*3.5);
        float m = smoothstep(1.2, 5.0, l) * fall;
        gl_FragColor = vec4(uCol * m, 1.0);
      }`, { tSrc: { value: null }, uLight: { value: new THREE.Vector2() }, uAsp: { value: 1 }, uCol: { value: new THREE.Color() } });
    this.compMat = fsMat(/* glsl */`
      uniform sampler2D tMain, tBloom, tRays; uniform float uExp, uBloom, uRays, uTime, uFade, uSat, uVig;
      uniform vec3 uLift, uGain, uFadeCol; uniform vec2 uRes;
      varying vec2 vUv;
      vec3 aces(vec3 x){ const float a=2.51,b=0.03,c=2.43,d=0.59,e=0.14; return clamp((x*(a*x+b))/(x*(c*x+d)+e),0.0,1.0); }
      vec3 toSRGB(vec3 c){ return mix(c*12.92, 1.055*pow(c, vec3(1.0/2.4)) - 0.055, step(0.0031308, c)); }
      void main(){
        vec3 c = texture2D(tMain, vUv).rgb;
        vec3 b = texture2D(tBloom, vUv).rgb;
        vec3 r = texture2D(tRays, vUv).rgb;
        c = c + b * uBloom + r * uRays;
        c *= uExp;
        c = aces(c);
        // grade
        c = c * uGain + uLift * (1.0 - c);
        float l = dot(c, vec3(0.2126,0.7152,0.0722));
        c = mix(vec3(l), c, uSat);
        // painterly soft contrast curve
        c = mix(c, c*c*(3.0-2.0*c), 0.18);
        vec2 q = vUv - 0.5; float v = 1.0 - dot(q,q) * uVig;
        c *= v;
        c = mix(c, uFadeCol, uFade);
        c = toSRGB(clamp(c, 0.0, 1.0));
        float g = fract(sin(dot(vUv*uRes + uTime*61.0, vec2(12.9898,78.233)))*43758.5453) - 0.5;
        c += g * 0.012;
        gl_FragColor = vec4(c, 1.0);
      }`, {
      tMain: { value: null }, tBloom: { value: null }, tRays: { value: null }, uExp: { value: 1 }, uBloom: { value: 0.6 }, uRays: { value: 0.5 }, uTime: { value: 0 },
      uFade: { value: 0 }, uSat: { value: 1.05 }, uVig: { value: 0.9 }, uLift: { value: new THREE.Vector3() }, uGain: { value: new THREE.Vector3(1, 1, 1) },
      uFadeCol: { value: new THREE.Color(1, 1, 1) }, uRes: { value: new THREE.Vector2(1, 1) },
    });
    this.fade = 0; this.fadeCol = new THREE.Color(0.8, 0.82, 0.85);
    this.lightScreen = new THREE.Vector2(); this.raysOn = 0;
    this.w = 0; this.h = 0;
  }
  setQuality(q) {
    this.q = q;
    if (this.rtMain.samples !== q.msaa) { this.rtMain.dispose(); this.rtMain = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, samples: q.msaa, depthBuffer: true }); }
    this.rayTaps = q.rays;
  }
  setSize(w, h) {
    this.w = w; this.h = h;
    this.rtMain.setSize(w, h);
    const hw = Math.max(2, Math.floor(w / 2)), hh = Math.max(2, Math.floor(h / 2));
    const rs = (this.q && this.q.refl) || 0.5;
    this.rtRefl.setSize(Math.max(2, Math.floor(w * rs)), Math.max(2, Math.floor(h * rs))); this.rtRefr.setSize(hw, hh); this.rtBright.setSize(hw, hh);
    let mw = hw, mh = hh;
    for (let i = 0; i < this.mips.length; i++) { mw = Math.max(2, Math.floor(mw / 2)); mh = Math.max(2, Math.floor(mh / 2)); this.mips[i].setSize(mw, mh); }
    for (let i = 0; i < this.ups.length; i++) this.ups[i].setSize(this.mips[i].width, this.mips[i].height);
    this.rtRays.setSize(Math.floor(w / 4), Math.floor(h / 4)); this.rtRays2.setSize(Math.floor(w / 4), Math.floor(h / 4));
    this.compMat.uniforms.uRes.value.set(w, h);
  }
  pass(mat, target) { this.quad.material = mat; this.r.setRenderTarget(target); this.r.render(this.qScene, quadCam); }

  updateReflCam() {
    const cam = this.camera, rc = this.reflCam, L = this.waterLevel;
    rc.copy(cam, false);
    rc.layers.set(LAYER.MAIN);
    const p = cam.position; rc.position.set(p.x, 2 * L - p.y, p.z);
    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
    dir.y = -dir.y;
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(cam.quaternion); up.y = -up.y;
    rc.up.copy(up);
    rc.lookAt(rc.position.clone().add(dir));
    rc.updateMatrixWorld();
    rc.projectionMatrix.copy(cam.projectionMatrix);
    // oblique near plane clipping at water plane
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -L + 0.05);
    plane.applyMatrix4(rc.matrixWorldInverse);
    const cp = new THREE.Vector4(plane.normal.x, plane.normal.y, plane.normal.z, plane.constant);
    const pm = rc.projectionMatrix; const q = new THREE.Vector4();
    q.x = (Math.sign(cp.x) + pm.elements[8]) / pm.elements[0];
    q.y = (Math.sign(cp.y) + pm.elements[9]) / pm.elements[5];
    q.z = -1.0; q.w = (1.0 + pm.elements[10]) / pm.elements[14];
    cp.multiplyScalar(2.0 / cp.dot(q));
    pm.elements[2] = cp.x; pm.elements[6] = cp.y; pm.elements[10] = cp.z + 1.0; pm.elements[14] = cp.w;
    rc.projectionMatrixInverse.copy(pm).invert();
  }

  render(dt, time, hooks = {}) {
    const r = this.r, cam = this.camera, scene = this.scene;
    r.autoClear = false;
    // 1. reflection
    this.updateReflCam();
    hooks.beforeReflection && hooks.beforeReflection(this.reflCam);
    r.shadowMap.autoUpdate = false;
    r.setRenderTarget(this.rtRefl); r.clear(true, true, false);
    if (!this.skipRefl) r.render(scene, this.reflCam);
    r.shadowMap.autoUpdate = true;
    hooks.afterReflection && hooks.afterReflection();
    // 2. opaque scene
    cam.layers.set(LAYER.MAIN); cam.layers.enable(LAYER.NOREFL);
    r.setRenderTarget(this.rtMain); r.clear(true, true, false);
    if (this.skipShadow) r.shadowMap.autoUpdate = false;
    r.render(scene, cam);
    // 3. refraction copy
    this.copyMat.uniforms.tSrc.value = this.rtMain.texture;
    this.pass(this.copyMat, this.rtRefr);
    // 4. water + transparent overlays
    r.shadowMap.autoUpdate = false;
    cam.layers.set(LAYER.WATER); cam.layers.enable(LAYER.TRANS);
    r.setRenderTarget(this.rtMain);
    r.render(scene, cam);
    r.shadowMap.autoUpdate = true;
    cam.layers.set(LAYER.MAIN); cam.layers.enable(LAYER.NOREFL); cam.layers.enable(LAYER.WATER); cam.layers.enable(LAYER.TRANS);
    // 5. bloom
    this.brightMat.uniforms.tSrc.value = this.rtMain.texture;
    this.brightMat.uniforms.uThr.value = 1.25;
    this.brightMat.uniforms.uTexel.value.set(1 / this.w, 1 / this.h);
    this.pass(this.brightMat, this.rtBright);
    let src = this.rtBright;
    for (let i = 0; i < this.mips.length; i++) {
      this.downMat.uniforms.tSrc.value = src.texture; this.downMat.uniforms.uTexel.value.set(1 / src.width, 1 / src.height);
      this.pass(this.downMat, this.mips[i]); src = this.mips[i];
    }
    let up = this.mips[this.mips.length - 1];
    for (let i = this.mips.length - 2; i >= 0; i--) {
      const tgt = this.ups[i];
      this.upMat.uniforms.tSrc.value = up.texture; this.upMat.uniforms.tBase.value = this.mips[i].texture;
      this.upMat.uniforms.uTexel.value.set(1 / up.width, 1 / up.height); this.upMat.uniforms.uW.value = 1.0;
      this.pass(this.upMat, tgt); up = tgt;
    }
    // 6. god rays
    const ray = hooks.rays || { on: 0 };
    if (ray.on > 0.01) {
      this.rayMaskMat.uniforms.tSrc.value = this.rtRefr.texture;
      this.rayMaskMat.uniforms.uLight.value.copy(ray.pos);
      this.rayMaskMat.uniforms.uAsp.value = this.w / this.h;
      this.rayMaskMat.uniforms.uCol.value.copy(ray.col);
      this.pass(this.rayMaskMat, this.rtRays2);
      this.rayMat.uniforms.tSrc.value = this.rtRays2.texture; this.rayMat.uniforms.uLight.value.copy(ray.pos); this.rayMat.uniforms.uLen.value = 0.75;
      this.pass(this.rayMat, this.rtRays);
      this.rayMat.uniforms.tSrc.value = this.rtRays.texture; this.rayMat.uniforms.uLen.value = 0.3;
      this.pass(this.rayMat, this.rtRays2);
    } else {
      r.setRenderTarget(this.rtRays2); r.setClearColor(0x000000, 1); r.clear(true, false, false);
    }
    // 7. composite
    const u = this.compMat.uniforms;
    u.tMain.value = this.rtMain.texture; u.tBloom.value = up.texture; u.tRays.value = this.rtRays2.texture;
    u.uExp.value = S.exp; u.uBloom.value = hooks.bloom ?? 0.55; u.uRays.value = ray.on * 0.55; u.uTime.value = time;
    u.uLift.value.set(...S.lift); u.uGain.value.set(...S.gain);
    u.uFade.value = this.fade; u.uFadeCol.value.copy(this.fadeCol);
    u.uSat.value = 1.06 - 0.25 * S.storm - 0.12 * S.night;
    this.pass(this.compMat, null);
    r.autoClear = true;
  }
}
