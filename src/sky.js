// Sky dome: painterly atmosphere, volumetric-looking clouds with silver/gold linings, sun, cratered moon, stars, skyglow, lightning
import * as THREE from 'three';
import { S } from './daycycle.js';
import { R, rng } from './util.js';
import TEX from './tex.js';

export function createSky(scene) {
  const uni = {
    uSun: { value: new THREE.Vector3() }, uMoon: { value: new THREE.Vector3() },
    uZen: { value: new THREE.Color() }, uHor: { value: new THREE.Color() }, uFog: { value: new THREE.Color() },
    uSunCol: { value: new THREE.Color() }, uSunI: { value: 1 }, uCov: { value: 0.4 }, uStorm: { value: 0 },
    uTime: { value: 0 }, uNight: { value: 0 }, uFlash: { value: 0 }, uFlashDir: { value: new THREE.Vector3(0, 0.3, -1) },
    uGlow: { value: new THREE.Color() }, uMoonTex: { value: TEX.moon.map }, uAmb: { value: new THREE.Color() }, uReflect: { value: 0 },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms: uni, side: THREE.BackSide, depthWrite: false, depthTest: true, fog: false,
    vertexShader: /* glsl */`
      varying vec3 vDir;
      void main(){ vDir = normalize((modelMatrix * vec4(position,0.0)).xyz);
        vec4 p = projectionMatrix * viewMatrix * vec4((modelMatrix*vec4(position,1.0)).xyz, 1.0);
        gl_Position = p.xyww; }
    `,
    fragmentShader: /* glsl */`
      uniform vec3 uSun, uMoon, uZen, uHor, uFog, uSunCol, uGlow, uAmb, uFlashDir;
      uniform float uSunI, uCov, uStorm, uTime, uNight, uFlash;
      uniform sampler2D uMoonTex;
      varying vec3 vDir;
      float hash(vec2 p){ p = fract(p*vec2(123.34, 456.21)); p += dot(p, p+45.32); return fract(p.x*p.y); }
      float hash3(vec3 p){ p = fract(p*0.3183099+.1); p *= 17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
      float noise(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
        return mix(mix(hash(i),hash(i+vec2(1,0)),f.x), mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x), f.y); }
      float fbm(vec2 p){ float s=0.0, a=0.5; mat2 m = mat2(1.6,1.2,-1.2,1.6); for(int i=0;i<6;i++){ s+=a*noise(p); p=m*p; a*=0.5; } return s; }
      float cloudD(vec2 p){
        vec2 w = vec2(uTime*0.004, uTime*0.0015);
        float base = fbm(p*0.9 + w);
        float det = fbm(p*3.1 - w*2.0 + base);
        float d = base*0.75 + det*0.35;
        float cov = mix(0.72, 0.18, uCov);
        return smoothstep(cov, cov+0.28 - uStorm*0.1, d);
      }
      void main(){
        vec3 d = normalize(vDir);
        float y = d.y;
        float yy = max(y, 0.0);
        // base gradient
        vec3 col = mix(uHor, uZen, pow(smoothstep(-0.02, 0.9, yy), 0.55));
        // sun glow (mie) and horizon warm band
        float sd = max(dot(d, uSun), 0.0);
        float sunUp = smoothstep(-0.25, 0.05, uSun.y);
        col += uSunCol * (pow(sd, 6.0)*0.35 + pow(sd, 48.0)*0.6) * sunUp * (1.0 - 0.8*uStorm);
        col += uSunCol * pow(sd, 2.0) * 0.18 * sunUp * (1.0 - smoothstep(0.0, 0.35, yy));
        // urban skyglow at night near horizon
        col += uGlow * pow(1.0 - smoothstep(0.0, 0.35, yy), 2.0) * uNight * 1.3;
        // stars
        if (uNight > 0.01 && y > 0.0) {
          vec3 sp = d * 220.0; vec3 cell = floor(sp); vec3 f = fract(sp) - 0.5;
          float h = hash3(cell);
          if (h > 0.972) {
            vec3 o = vec3(hash3(cell+1.3), hash3(cell+2.7), hash3(cell+5.1)) - 0.5;
            float dd = length(f - o*0.6);
            float mag = pow((h - 0.972)/0.028, 3.0);
            float tw = 0.7 + 0.3*sin(uTime*(3.0 + h*20.0) + h*100.0);
            float st = smoothstep(0.12, 0.0, dd) * (0.4 + 3.5*mag) * tw;
            vec3 sc = mix(vec3(1.0,0.85,0.7), vec3(0.75,0.85,1.0), hash3(cell+9.0));
            col += sc * st * uNight * smoothstep(0.02, 0.25, y) * (1.0 - uCov*0.9);
          }
        }
        // moon
        float md = dot(d, uMoon);
        float mr = 0.022;
        if (md > cos(mr*1.2) && uMoon.y > -0.05) {
          vec3 up = abs(uMoon.y) < 0.99 ? vec3(0,1,0) : vec3(1,0,0);
          vec3 mx = normalize(cross(up, uMoon)); vec3 my = cross(uMoon, mx);
          vec2 uv = vec2(dot(d, mx), dot(d, my)) / mr * 0.5 + 0.5;
          vec4 mt = texture2D(uMoonTex, uv);
          // gibbous terminator
          vec2 c = (uv - 0.5)*2.0; float z = sqrt(max(1.0 - dot(c,c), 0.0));
          vec3 n = normalize(vec3(c, z)); float lit = smoothstep(-0.15, 0.2, dot(n, normalize(vec3(-0.55, 0.15, 0.82))));
          col = mix(col, mt.rgb * (0.08 + 2.6*lit) * vec3(1.0, 0.98, 0.93), mt.a * smoothstep(-0.05, 0.05, uMoon.y) * (0.35 + 0.65*uNight));
        }
        col += vec3(0.6,0.7,0.9) * pow(max(md, 0.0), 400.0) * 0.5 * uNight;
        col += vec3(0.5,0.6,0.8) * pow(max(md, 0.0), 30.0) * 0.08 * uNight;
        // sun disc
        float disc = smoothstep(0.99965, 0.99985, sd);
        vec3 sunDisc = uSunCol * disc * 28.0 * sunUp;
        // clouds
        if (y > -0.02) {
          vec2 p = d.xz / (yy + 0.09) * 1.25;
          float c = cloudD(p);
          if (c > 0.001) {
            vec2 toSun = normalize(uSun.xz + 1e-4) * 0.16;
            float c2 = cloudD(p + toSun);
            float c3 = cloudD(p + toSun * 2.4);
            float lightT = exp(-(c2*1.3 + c3*0.9) * 1.8);
            vec3 lit = uSunCol * uSunI * 0.3 * lightT + uAmb * 0.55;
            vec3 dark = mix(uHor, uZen, 0.4) * 0.55 + uAmb*0.1;
            vec3 cc = mix(dark, lit + dark*0.25, 0.35 + 0.65*lightT);
            // silver / gold linings: thin edges near sun
            float edge = (1.0 - c) * smoothstep(0.02, 0.4, c);
            float lining = pow(sd, 5.0) * edge * 5.0 + pow(sd, 22.0) * edge * 10.0;
            cc += uSunCol * lining * sunUp * (1.0 - uStorm*0.7);
            // night: moonlit clouds and skyglow underlit
            cc = mix(cc, uZen*1.3 + uGlow*0.6 + vec3(0.03,0.035,0.05)*pow(max(md,0.0),4.0), uNight*0.85);
            // storm darkness + lightning
            cc = mix(cc, cc * vec3(0.45,0.48,0.52), uStorm*smoothstep(0.3,0.9,c));
            float fl = uFlash * (0.4 + 0.6*pow(max(dot(d, uFlashDir), 0.0), 3.0));
            cc += vec3(0.8, 0.85, 1.0) * fl * c * 2.5;
            float alpha = c * smoothstep(-0.02, 0.12, y);
            col = mix(col + sunDisc*(1.0 - c), cc, alpha);
            sunDisc *= 0.0;
          }
        }
        col += sunDisc;
        // horizon haze blend to fog colour
        float haze = 1.0 - smoothstep(-0.03, 0.16, y);
        col = mix(col, uFog, haze * 0.92);
        if (y < -0.03) col = uFog;
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(4000, 48, 24), mat);
  dome.frustumCulled = false; dome.renderOrder = -1000;
  scene.add(dome);

  // ---------- lightning ----------
  const boltMat = new THREE.ShaderMaterial({
    uniforms: { uI: { value: 0 } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
    vertexShader: 'attribute float aW; varying float vW; void main(){ vW=aW; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);} ',
    fragmentShader: 'uniform float uI; varying float vW; void main(){ gl_FragColor=vec4(vec3(0.85,0.9,1.0)*uI*vW*18.0, 1.0);} ',
  });
  const bolt = new THREE.Mesh(new THREE.BufferGeometry(), boltMat);
  bolt.frustumCulled = false; bolt.visible = false; scene.add(bolt);

  function makeBolt(origin, camPos) {
    const segs = [];
    function branch(p, dir, len, width, depth) {
      let cur = p.clone();
      const n = Math.floor(len / 22);
      for (let i = 0; i < n; i++) {
        const nx = cur.clone().add(dir.clone().multiplyScalar(22)).add(new THREE.Vector3(R(-14, 14), R(-4, 4), R(-14, 14)));
        segs.push([cur.clone(), nx.clone(), width * (1 - i / n * 0.6)]);
        if (depth < 3 && rng() < 0.12) branch(nx, new THREE.Vector3(dir.x + R(-0.8, 0.8), dir.y * 0.8, dir.z + R(-0.8, 0.8)).normalize(), len * R(0.2, 0.45), width * 0.45, depth + 1);
        cur = nx;
        if (cur.y < 12) break;
      }
    }
    branch(origin, new THREE.Vector3(0, -1, 0), origin.y + 40, 5, 0);
    const pos = [], w = [], idx = [];
    for (const [a, b, wd] of segs) {
      const mid = a.clone().add(b).multiplyScalar(0.5);
      const view = mid.clone().sub(camPos).normalize();
      const dir = b.clone().sub(a).normalize();
      const side = new THREE.Vector3().crossVectors(dir, view).normalize().multiplyScalar(wd * 0.5);
      const base = pos.length / 3;
      for (const [pp, s] of [[a, 1], [a, -1], [b, 1], [b, -1]]) { pos.push(pp.x + side.x * s, pp.y + side.y * s, pp.z + side.z * s); w.push(Math.min(1, wd / 3)); }
      idx.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('aW', new THREE.Float32BufferAttribute(w, 1));
    g.setIndex(idx);
    bolt.geometry.dispose(); bolt.geometry = g;
  }

  const L = { next: 3, flashT: 99, boltDir: new THREE.Vector3(), strikes: [] };
  function update(dt, time, camPos, onStrike) {
    uni.uSun.value.copy(S.sunDir); uni.uMoon.value.copy(S.moonDir);
    uni.uZen.value.copy(S.zen); uni.uHor.value.copy(S.hor); uni.uFog.value.copy(S.fog);
    uni.uSunCol.value.copy(S.sunCol); uni.uSunI.value = Math.max(S.sunI, 0.2);
    uni.uCov.value = S.cloudCov; uni.uStorm.value = S.storm; uni.uTime.value = time;
    uni.uNight.value = S.night; uni.uGlow.value.copy(S.glow); uni.uAmb.value.copy(S.amb).multiplyScalar(S.ambI);
    dome.position.copy(camPos);
    // lightning scheduling
    const stormPeak = S.storm > 0.7 && S.rain > 0.5;
    L.next -= dt * S.speed;
    if (stormPeak && L.next <= 0) {
      L.next = R(3.5, 8.5);
      const ang = R(-1.3, 1.3); const dist = R(700, 1700);
      const fwd = new THREE.Vector3(Math.sin(ang), 0, -Math.cos(ang));
      const o = camPos.clone().add(fwd.multiplyScalar(dist)); o.y = R(520, 800);
      makeBolt(o, camPos);
      L.flashT = 0; L.boltDir.copy(o).sub(camPos).normalize();
      uni.uFlashDir.value.copy(L.boltDir);
      onStrike && onStrike(dist);
    }
    // flash envelope with flicker
    L.flashT += dt;
    let fl = 0;
    const t = L.flashT;
    if (t >= 0 && t < 0.9) fl = Math.max(0, Math.exp(-t * 7) * (0.7 + 0.3 * Math.sin(t * 90)) + (t > 0.18 && t < 0.3 ? 0.6 : 0) + (t > 0.42 && t < 0.5 ? 0.35 : 0));
    S.flash = fl;
    uni.uFlash.value = fl;
    bolt.visible = t < 0.55;
    boltMat.uniforms.uI.value = fl > 0.05 ? 1.2 : 0.2;
  }
  return { dome, uni, update, bolt };
}
