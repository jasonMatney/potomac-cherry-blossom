import * as THREE from 'three';
import { nextFrame, clamp, lerp, smooth } from './util.js';
import { generateAll } from './tex.js';
import { buildLookup, frame, toSD, fromSD, LOOP_START, LOOP_END, currentAt, hwL, hwR } from './world.js';
import { buildTerrain, groundAt } from './terrain.js';
import { U, MAXL } from './matpatch.js';
import { S, updateCycle, setHour, CYCLE } from './daycycle.js';
import { createSky } from './sky.js';
import { Pipeline, LAYER } from './post.js';
import { bakeMaps, buildWater, stepSim, W, SIM, simProbe, updatePatchFrame } from './water.js';
import { buildMaterials, M, NIGHT_EMISSIVE } from './mats.js';
import { buildLandmarks } from './landmarks.js';
import { buildVegetation, ROCKS, cullVeg, cullVegDyn, reflCull } from './veg.js';
import { LIGHTS, inSolid, addLight, walkBlocked } from './registry.js';
import { buildBoatModel, Boat, buildLane, laneAt } from './boat.js';
import { Skipper, Woman, Groundskeeper } from './actors.js';
import { ChaseCam } from './camera.js';
import { Traffic } from './traffic.js';
import { Odyssey } from './odyssey.js';
import { Stops } from './stops.js';
import { Home } from './home.js';
import { Wildlife } from './wildlife.js';
import { Rowing } from './rowing.js';
import { Joggers } from './joggers.js';
import { FX } from './fx.js';
import { loadHumans } from './humans.js';
import { Soundscape } from './audio.js';

const ring = document.getElementById('ldr');
function progress(p) { if (ring) ring.style.strokeDashoffset = String(289 * (1 - clamp(p, 0, 1))); }

const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', stencil: false });
renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
renderer.toneMapping = THREE.NoToneMapping;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
document.body.appendChild(renderer.domElement);
renderer.domElement.tabIndex = 0;

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0xcccccc, 0.001);
const camera = new THREE.PerspectiveCamera(50, 1, 0.3, 6000);
const pipeline = new Pipeline(renderer, scene, camera);

const sun = new THREE.DirectionalLight(0xffffff, 2);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
const SH = 60;
Object.assign(sun.shadow.camera, { left: -SH, right: SH, top: SH, bottom: -SH, near: 10, far: 900 });
sun.shadow.bias = -0.0003; sun.shadow.normalBias = 0.035; sun.shadow.radius = 2.5;
scene.add(sun, sun.target);
const hemi = new THREE.HemisphereLight(0xbcd0e8, 0x4a5234, 0.6);
scene.add(hemi);

// resolution management (Retina aware, adaptive)
const DPR = Math.min(window.devicePixelRatio || 1, 2);
// quality tiers, highest first: resolution scale, reflection resolution, MSAA samples, god rays
const TIERS = [
  { scale: 1.0, refl: 0.5, msaa: 4, rays: true, shadow: 2048, veg: 1.0, simLo: false, simEvery: 1 },
  { scale: 0.85, refl: 0.45, msaa: 4, rays: true, shadow: 2048, veg: 1.0, simLo: false, simEvery: 1 },
  { scale: 0.72, refl: 0.4, msaa: 2, rays: true, shadow: 2048, veg: 0.9, simLo: false, simEvery: 1 },
  { scale: 0.62, refl: 0.35, msaa: 2, rays: true, shadow: 1536, veg: 0.8, simLo: true, simEvery: 1 },
  { scale: 0.54, refl: 0.3, msaa: 0, rays: false, shadow: 1024, veg: 0.7, simLo: true, simEvery: 2 },
  { scale: 0.46, refl: 0.25, msaa: 0, rays: false, shadow: 1024, veg: 0.6, simLo: true, simEvery: 2 },
];
let tier = DPR > 1.5 ? 2 : 0; // high-density displays start at a lower internal resolution
let scale = TIERS[tier].scale;
function setTier(t) {
  tier = Math.max(0, Math.min(TIERS.length - 1, t)); const q = TIERS[tier]; scale = q.scale; pipeline.setQuality(q); resize(); APP.tier = tier;
  // shadows, vegetation reach and the wave simulation scale with the tier too
  if (sun.shadow.mapSize.x !== q.shadow) { sun.shadow.mapSize.set(q.shadow, q.shadow); if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; } }
  if (SIM.setLow) SIM.setLow(q.simLo);
}
function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setPixelRatio(DPR * scale);
  renderer.setSize(w, h, false);
  renderer.domElement.style.width = w + 'px'; renderer.domElement.style.height = h + 'px';
  camera.aspect = w / h; camera.updateProjectionMatrix();
  const pw = Math.floor(w * DPR * scale), ph = Math.floor(h * DPR * scale);
  pipeline.setSize(pw, ph);
  if (W.uni) W.uni.uRes.value.set(pw, ph);
  const px = ph / 900;
  if (APP.fx) { APP.fx.moteU.uPx.value = px; APP.fx.insU.uPx.value = px; }
}
window.addEventListener('resize', () => { gov.resize = true; });

const env = { pmrem: new THREE.PMREMGenerator(renderer), scene: new THREE.Scene(), rt: null, timer: 0 };
let sky;
const APP = { scene, camera, renderer, pipeline, sun, hemi, time: 0, fade: 0, loopState: 0 };
window.APP = APP; APP.THREE = THREE;
const audio = new Soundscape();

// ------------------------------------------------------------------ input
const KEYS = { KeyW: 'up', ArrowUp: 'up', KeyS: 'down', ArrowDown: 'down', KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right' };
let fastForward = false;
window.addEventListener('keydown', (e) => {
  audio.start();
  if (KEYS[e.code]) { APP.boat && (APP.boat.keys[KEYS[e.code]] = true); e.preventDefault(); }
  if (e.code === 'KeyT' || e.code === 'KeyF') fastForward = true;
  if ((e.code === 'ShiftLeft' || e.code === 'ShiftRight') && APP.boat) APP.boat.keys.boost = true;
  if (e.code === 'KeyM' && !e.repeat) audio.toggleMute();
  if (e.code === 'KeyP' && !e.repeat) perf.toggle();
  if ((e.code === 'KeyE' || e.code === 'Enter') && !e.repeat && APP.stops) APP.stops.action();
  const dg = /^(Digit|Numpad)([0-6])$/.exec(e.code); if (dg && !e.repeat) pickSong(+dg[2]);
});
window.addEventListener('keyup', (e) => {
  if (KEYS[e.code]) { APP.boat && (APP.boat.keys[KEYS[e.code]] = false); }
  if (e.code === 'KeyT' || e.code === 'KeyF') fastForward = false;
  if ((e.code === 'ShiftLeft' || e.code === 'ShiftRight') && APP.boat) APP.boat.keys.boost = false;
});
window.addEventListener('blur', () => { if (APP.boat) APP.boat.keys = {}; fastForward = false; });
window.addEventListener('pointerdown', () => audio.start());
// music picker: a row of icon buttons (0 = off)
const muBar = document.getElementById('mu');
function pickSong(i) {
  audio.start(); audio.music.select(i);
  if (muBar) for (const b of muBar.children) b.classList.toggle('sel', +b.dataset.s === i);
  if (muBar) { muBar.classList.add('wake'); clearTimeout(pickSong.t); pickSong.t = setTimeout(() => muBar.classList.remove('wake'), 1800); }
}
if (muBar) {
  for (const b of muBar.children) {
    b.addEventListener('pointerdown', (e) => e.stopPropagation());
    b.addEventListener('click', (e) => { e.stopPropagation(); pickSong(+b.dataset.s); b.blur(); });
  }
  muBar.children[1].classList.add('sel');
}
audio.music.sel = 1;

async function init() {
  progress(0.02); await nextFrame();
  await generateAll((p) => progress(0.02 + p * 0.28), nextFrame);
  await loadHumans();
  buildLookup(); progress(0.32); await nextFrame();
  buildTerrain(scene); progress(0.4); await nextFrame();
  buildMaterials();
  APP.lm = buildLandmarks(scene); progress(0.48); await nextFrame();
  buildVegetation(scene, APP.lm, (p) => progress(0.48 + p * 0.2));
  await nextFrame();
  sky = createSky(scene);
  env.dome = new THREE.Mesh(sky.dome.geometry, sky.dome.material); env.scene.add(env.dome);
  APP.traffic = new Traffic(scene, APP.lm, null);
  bakeMaps(); progress(0.74); await nextFrame();
  buildWater(scene, renderer, pipeline);
  buildLane(APP.lm); progress(0.78); await nextFrame();
  // hero boat + crew
  const model = buildBoatModel();
  const boat = APP.boat = new Boat(model);
  scene.add(boat.root);
  boat.reset(LOOP_START + 20);
  APP.skipper = new Skipper(model);
  APP.heroLights = [['navPort', 0xff2a1a, 7, 0.9], ['navStar', 0x22ff66, 7, 0.9], ['navWhite', 0xfff2dc, 10, 1.0]].map(([k, c, r, I]) => ({ k, L: addLight(new THREE.Vector3(), c, r, I, { kind: 'boat', dyn: true }), I }));
  APP.woman = new Woman(scene);
  APP.gk = new Groundskeeper(scene, APP.lm.steps);
  APP.traffic.hero = boat;
  APP.odyssey = new Odyssey(scene, APP.traffic.bridges);
  APP.odyssey.placeUp(250);
  APP.traffic.others = [APP.odyssey];
  boat.others = [...APP.traffic.boats, APP.odyssey];
  progress(0.84); await nextFrame();
  APP.fx = new FX(scene, APP.lm, APP.gk);
  APP.cam = new ChaseCam(camera, renderer.domElement);
  APP.home = new Home(scene); APP.home.audio = audio;
  APP.stops = new Stops({ scene, boat, skipper: APP.skipper, audio, camera, home: APP.home });
  { const fade = document.getElementById('fade'); APP.stops.fadeFn = (k) => { if (fade) fade.style.opacity = String(k); }; }
  APP.stops.onSleep = () => setHour(6.9);
  APP.wild = new Wildlife(scene);
  APP.rowing = new Rowing(scene);
  APP.joggers = new Joggers(scene, 4);
  { const ppl = []; APP.stops.peopleFn = () => {
      ppl.length = 0;
      const add = (o3, r = 0.3) => { if (o3 && o3.visible !== false) ppl.push({ x: o3.position.x, z: o3.position.z, r }); };
      add(APP.stops.vendor && APP.stops.vendor.root); add(APP.woman.c.root); add(APP.gk.c.root);
      for (const J of APP.joggers.list) if (J.c.root.visible) add(J.c.root, 0.32);
      if (APP.home) for (const o of APP.home.blockers()) ppl.push(o);
      return ppl;
    }; }
  APP.traffic.others = [APP.odyssey, ...APP.rowing.shells];
  boat.others = [...APP.traffic.boats, APP.odyssey, ...APP.rowing.shells];
  pipeline.setQuality(TIERS[tier]);
  resize();
  setHour(8.6);
  progress(0.9); await nextFrame();
  // warm-up: compile shaders and settle the simulation before revealing
  setTier(tier);
  step(1 / 60); renderer.compile(scene, camera);
  for (let i = 0; i < 3; i++) step(1 / 60);
  // quick benchmark behind the loading screen: time a few full frames (waiting for the GPU to finish)
  // and start at the richest tier that should hold 60 fps; the governor can still step down later
  { const gl = renderer.getContext(); const px = new Uint8Array(4); const sync = () => { renderer.setRenderTarget(null); gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); };
    step(1 / 60); sync(); const ts = [];
    for (let i = 0; i < 7; i++) { await nextFrame(); const t0 = performance.now(); step(1 / 60); sync(); ts.push(performance.now() - t0); if (ts[ts.length - 1] > 150) break; }
    ts.sort((a, b) => a - b); const med = ts[Math.floor(ts.length / 2)]; const base = TIERS[tier];
    const cost = (q) => med * (q.scale * q.scale) / (base.scale * base.scale) * (1 + 0.12 * (q.msaa - base.msaa) / 4) * (q.simEvery === 2 && base.simEvery === 1 ? 0.9 : 1);
    let pick = TIERS.length - 1; for (let i = 0; i < TIERS.length; i++) if (cost(TIERS[i]) < 12.5) { pick = i; break; }
    APP.bench = { med: +med.toFixed(1), pick };
    if (pick !== tier) setTier(pick);
    step(1 / 60); }
  progress(1); await nextFrame();
  document.getElementById('ld').classList.add('hide');
  setTimeout(() => { const l = document.getElementById('ld'); if (l) l.remove(); }, 2000);
  APP.ready = true;
  if (muBar) muBar.classList.add('on');
  { const col = document.getElementById('col'); if (col) col.classList.add('on'); }
  last = performance.now();
  requestAnimationFrame(loop);
}

// Frame pacing: a smoothed timestep (rAF timestamps jitter), and a quality governor that only ever steps
// down, once per measurement window, so the resolution never oscillates and causes repeated hitches.
// hidden performance readout (P): frame rate, slow-frame times, quality tier, render cost; off by default
const perf = {
  el: null, on: false, ms: [], acc: 0,
  toggle() {
    this.on = !this.on;
    if (!this.el) { this.el = document.createElement('div'); Object.assign(this.el.style, { position: 'fixed', left: '10px', top: '10px', zIndex: 50, font: '12px/1.45 ui-monospace,Menlo,Consolas,monospace', color: '#fff', background: 'rgba(0,0,0,0.62)', padding: '8px 10px', borderRadius: '8px', whiteSpace: 'pre', pointerEvents: 'none' }); document.body.appendChild(this.el); }
    this.el.style.display = this.on ? 'block' : 'none'; this.ms = []; this.acc = 0;
  },
  frame(raw) {
    if (!this.on || raw <= 0 || raw > 5) return;
    this.ms.push(raw * 1000); this.acc += raw; if (this.acc < 0.5) return;
    const a = this.ms.slice().sort((x, y) => x - y), n = a.length, avg = a.reduce((x, y) => x + y, 0) / n;
    const p95 = a[Math.min(n - 1, Math.floor(n * 0.95))], worst = a[n - 1];
    const ri = renderer.info.render, gl = renderer.getContext(); const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    const gpu = dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : '?';
    const where = APP.skipper && APP.skipper.onFoot ? (APP.home && APP.stops && APP.stops.cur && APP.stops.cur.id === 'home' ? (APP.home.camInside ? 'on foot, inside house' : 'on foot, at house') : 'on foot, ' + (APP.stops.cur ? APP.stops.cur.id : '')) : 'boat, s ' + (APP.boat ? APP.boat.s.toFixed(0) : '?');
    this.el.textContent = `fps      ${(1000 / avg).toFixed(0)}\nframe    ${avg.toFixed(1)} ms avg · ${p95.toFixed(1)} p95 · ${worst.toFixed(0)} worst\ntier     ${tier} of ${TIERS.length - 1} (0 = best) · scale ${TIERS[tier].scale} · drops ${gov.downs}\ncanvas   ${renderer.domElement.width}×${renderer.domElement.height} @ dpr ${devicePixelRatio}\ndraws    ${ri.calls} · tris ${(ri.triangles / 1000).toFixed(0)}k\nbench    ${APP.bench ? APP.bench.med + ' ms → tier ' + APP.bench.pick : '-'}\nwhere    ${where} · hour ${APP.S.hour.toFixed(1)}\ngpu      ${gpu}`;
    this.ms = []; this.acc = 0;
  },
};
let last = 0, dtS = 1 / 60;
const gov = { t: 0, samples: [], settle: 1.5, downs: 0, pending: null };
function loop(now) {
  requestAnimationFrame(loop);
  const raw = Math.max(0, (now - last) / 1000); last = now;
  if (APP.paused) return;
  // quality changes resize the canvas, which clears it; apply them right before this frame renders
  // (never after), so the browser never shows a cleared, black canvas
  if (gov.pending !== null) { setTier(gov.pending); gov.pending = null; gov.resize = false; }
  else if (gov.resize) { resize(); gov.resize = false; }
  const clamped = Math.min(raw, 0.1);
  dtS += (clamped - dtS) * (Math.abs(clamped - dtS) > 0.03 ? 1 : 0.25);
  if (perf.on) { renderer.info.autoReset = false; renderer.info.reset(); } else renderer.info.autoReset = true;
  step(Math.min(dtS, 0.1));
  perf.frame(raw);
  if (document.hidden || raw > 0.25) return; // ignore tab switches and one-off stalls
  gov.t += raw; if (gov.t < gov.settle) return;
  gov.samples.push(raw * 1000);
  if (gov.samples.length >= 150) {
    const s = gov.samples.sort((a, b) => a - b); const p75 = s[Math.floor(s.length * 0.75)];
    gov.samples = []; gov.settle = gov.t + 1.0;
    if (p75 > 19 && tier < TIERS.length - 1) { gov.pending = Math.min(TIERS.length - 1, tier + (p75 > 34 ? 2 : 1)); gov.downs++; }
  }
}
APP.setTier = setTier;

const _v = new THREE.Vector3(), _c = new THREE.Color();
const _heroB = { x: 0, z: 0, psi: 0, halfLen: 3.2, spd: 0 }, _boatList = [];
const _amb = { cam: { x: 0, z: 0, yaw: 0 }, flocks: [], shells: [] };
function step(dt, render = true) {
  APP.time += dt;
  const t = APP.time;
  S.speed = fastForward ? 24 : 1;
  updateCycle(dt);
  U.uTime.value = t; U.uWet.value = S.wet;
  // wind: gentle breeze with stronger gusts in the storm
  const wv = U.uWindV.value; const wa = 2.35 + Math.sin(t * 0.013) * 0.35;
  wv.set(Math.cos(wa), Math.sin(wa), 0.35 + S.storm * 0.9, 0.35 + S.storm * 0.9 + 0.15 * Math.sin(t * 0.07));
  U.uSunDir.value.copy(S.keyDir);
  U.uSunCol.value.copy(S.keyCol).multiplyScalar(S.keyI * 0.32 * (S.keyIsMoon ? 0.3 : 1));
  U.uLOn.value = S.lightsOn; U.uFlood.value = S.lightsOn; U.uFlash.value = S.flash;
  const tide = U.uTide.value = 0.1 * Math.sin(S.f * Math.PI * 4);
  pipeline.waterLevel = tide;
  const boat = APP.boat;
  // ---- boat & loop
  APP.stops.preBoat(dt);
  boat.avoid = boat.script ? null : autopilotAvoid(boat);
  boat.update(dt, t, tide);
  if (APP.loopState === 0 && boat.s > LOOP_END && !APP.stops.busy) APP.loopState = 1;
  if (APP.loopState === 1) { APP.fade = Math.min(1, APP.fade + dt / 2.2); if (APP.fade >= 1) { boat.reset(LOOP_START); APP.odyssey.placeUp(250); APP.cam.snap(); APP.loopState = 2; } }
  else if (APP.loopState === 2) { APP.fade = Math.max(0, APP.fade - dt / 2.8); if (APP.fade <= 0) APP.loopState = 0; }
  APP.skipper.update(Math.min(dt, 0.04), t, boat);
  APP.stops.update(Math.min(dt, 0.05), t, camera);
  { const onFoot = APP.skipper.onFoot; const pp = onFoot ? APP.stops.pos : null;
    APP.home.update(dt, t, S, pp, !!(onFoot && APP.home.isInside(pp)), camera);
    const f = APP.stops.focus; if (f && f.home) f.fixed = APP.home.camFocus(APP.stops.pos, APP.cam.uYaw); }
  APP.woman.update(dt, t, boat.root.position);
  APP.gk.update(dt, t);
  APP.traffic.update(dt, t, tide, S.lightsOn);
  APP.odyssey.update(dt, t, tide, S.lightsOn, boat);
  APP.rowing.update(dt, t, tide, S);
  { const hb = _heroB; hb.x = boat.x; hb.z = boat.z; hb.psi = boat.psi; hb.spd = Math.abs(boat.u);
    const list = _boatList; list.length = 0; list.push(hb, APP.odyssey); for (const b of APP.traffic.boats) list.push(b); for (const sh of APP.rowing.shells) list.push(sh);
    APP.wild.update(dt, t, tide, list, boat.root.position, S, 9); }
  APP.joggers.update(dt, t, boat.s, boat.root.position, camera, APP.skipper.onFoot ? APP.stops.pos : null);
  // ---- camera
  if (!APP.freeCam) APP.cam.update(dt, t, boat, tide, APP.stops.focus);
  camera.updateMatrixWorld();
  // ---- lights
  sun.color.copy(S.keyCol); sun.intensity = S.keyI + S.flash * 1.2;
  const focus = boat.root.position;
  // texel-snapped shadow frustum centred ahead of the boat
  const [fx, fz] = boat.fwd();
  const cx = focus.x + fx * 18, cz = focus.z + fz * 18;
  sun.position.set(cx, 0, cz).addScaledVector(S.keyDir, 400); sun.target.position.set(cx, 0, cz);
  { const texel = (SH * 2) / 2048; sun.updateMatrixWorld(); sun.target.updateMatrixWorld();
    const m = new THREE.Matrix4().lookAt(sun.position, sun.target.position, new THREE.Vector3(0, 1, 0)); const inv = m.clone().invert();
    const p = sun.target.position.clone().applyMatrix4(inv); p.x = Math.round(p.x / texel) * texel; p.y = Math.round(p.y / texel) * texel;
    const d = p.applyMatrix4(m).sub(sun.target.position); sun.target.position.add(d); sun.position.add(d); sun.target.updateMatrixWorld(); }
  hemi.color.copy(S.amb); hemi.groundColor.copy(S.amb).multiplyScalar(0.5).lerp(_c.setRGB(0.3, 0.3, 0.2), 0.3);
  hemi.intensity = S.ambI * 0.95 + S.flash * 0.7;
  scene.fog.color.copy(S.fog); scene.fog.density = S.fogD * (1 + APP.fade * 5);
  sky.update(dt, t, camera.position, (dist) => audio.thunder(dist / 340 * 0.55 + 0.2, dist));
  // ---- environment map (sky) refresh
  env.timer -= dt * S.speed;
  if (env.timer <= 0 && render) {
    env.timer = 1.5;
    const old = env.rt; env.dome.position.set(0, 0, 0);
    env.rt = env.pmrem.fromScene(env.scene, 0, 1, 5000);
    scene.environment = env.rt.texture; if (old) old.dispose();
  }
  boat.root.updateMatrixWorld(true);
  for (const h of APP.heroLights) { const m = boat.model.userData[h.k]; m.getWorldPosition(h.L.p); h.L.I = h.I * S.lightsOn; }
  updateLights(APP.skipper.onFoot ? APP.stops.pos : focus);
  cullVeg(camera.position, TIERS[tier].veg);
  cullVegDyn(camera, TIERS[tier].veg, t);
  // ---- fx
  APP.fx.update(dt, t, camera, boat, tide);
  APP.fx.mistU.uFade.value = APP.fade;
  // ---- water
  const wu = W.uni;
  wu.uSunDir.value.copy(S.keyDir); wu.uSunCol.value.copy(S.keyCol); wu.uSunI.value = S.keyI + S.flash * 0.5;
  wu.uAmb.value.copy(S.amb).multiplyScalar(S.ambI); wu.uFogCol.value.copy(S.fog); wu.uFogD.value = scene.fog.density;
  wu.uRain.value = S.rain; wu.uNight.value = S.night; wu.uStorm.value = S.storm;
  const [bfx, bfz] = boat.fwd();
  const heroSim = { s: boat.s, d: boat.d, relHeading: boat.psi - frame(boat.s).th, speed: boat.u, halfLen: 3.1, halfBeam: 1.1, strength: 1, prop: clamp(Math.abs(boat.throttle) * 1.3, 0, 1) };
  APP.simAcc = (APP.simAcc || 0) + dt; APP.simFrame = (APP.simFrame || 0) + 1;
  if (APP.simFrame % TIERS[tier].simEvery === 0) { stepSim(renderer, APP.simAcc, t, boat.s, boat.d, [heroSim, ...APP.traffic.simBoats(), APP.odyssey.simBoat(), ...APP.rowing.simBoats()], S.rain, TIERS[tier].simEvery === 2 ? 1 : 3); APP.simAcc = 0; }
  wu.tSim.value = SIM.rtA.texture; wu.uSimO.value.set(SIM.sMin, SIM.dMin);
  updatePatchFrame();
  // wave heights under the hero's hull corners and at each traffic boat, read back from the simulation
  { const pts = []; const [hx, hz] = boat.fwd(); const rx = -hz, rz = hx;
    for (const [a, b] of [[2.6, 0], [-2.6, 0], [0, -1], [0, 1]]) { const q = toSD(boat.x + hx * a + rx * b, boat.z + hz * a + rz * b); pts.push([q.s, q.d]); }
    for (const tb of APP.traffic.boats) pts.push([tb.s, tb.d]);
    const o = APP.odyssey; pts.push([o.s, o.d]);
    pts.push(...APP.wild.probePoints(boat.root.position, 7));
    simProbe(pts); }
  pipeline.updateReflCam();
  wu.uReflVP.value.multiplyMatrices(pipeline.reflCam.projectionMatrix, pipeline.reflCam.matrixWorldInverse);
  // ---- god rays (sun or moon on/near screen)
  const rays = { on: 0, pos: new THREE.Vector2(), col: new THREE.Color() };
  {
    const src = S.keyIsMoon ? S.moonDir : S.sunDir;
    _v.copy(camera.position).addScaledVector(src, 3000).project(camera);
    const vis = _v.z < 1 && Math.abs(_v.x) < 1.6 && Math.abs(_v.y) < 1.6;
    const low = 1 - smooth(0.15, 0.6, src.y);
    const k = (S.keyIsMoon ? 0.15 : 1) * low * (1 - S.storm * 0.85) * smooth(-0.04, 0.03, src.y) * (0.6 + 0.4 * S.mist);
    if (vis && k > 0.01 && TIERS[tier].rays) {
      rays.on = k * (1 - smooth(1.0, 1.6, Math.max(Math.abs(_v.x), Math.abs(_v.y))));
      rays.pos.set(_v.x * 0.5 + 0.5, _v.y * 0.5 + 0.5);
      rays.col.copy(S.keyCol).multiplyScalar(S.keyIsMoon ? 0.4 : 0.55);
    }
  }
  pipeline.fade = APP.fade; pipeline.fadeCol.copy(S.fog).lerp(_c.setRGB(0.85, 0.87, 0.9), 0.35).multiplyScalar(0.9 + S.sunI * 0.03);
  if (render) pipeline.render(dt, t, { bloom: 0.45 + S.night * 0.25 + S.twilight * 0.1, rays, beforeReflection: () => reflCull(camera.position, true), afterReflection: () => reflCull(camera.position, false) });
  // ---- audio
  const { s: cs } = toSD(camera.position.x, camera.position.z);
  if (audio.amb) {
    const A = _amb; camera.getWorldDirection(_v);
    A.cam.x = camera.position.x; A.cam.z = camera.position.z; A.cam.yaw = Math.atan2(_v.x, -_v.z);
    const cq = toSD(camera.position.x, camera.position.z);
    A.hour = S.hour; A.night = S.night; A.day = 1 - S.night; A.rain = S.rain; A.storm = S.storm; A.hourSpeed = S.speed;
    const bankD = Math.min(Math.abs(hwR(cq.s) - cq.d), Math.abs(hwL(cq.s) + cq.d));
    A.trees = clamp(1.15 - bankD / 110, 0.35, 1);
    A.bankPoint = (a, r) => { const s2 = cq.s + Math.cos(a) * r; const side = Math.random() < 0.7 ? (hwR(cq.s) - cq.d < hwL(cq.s) + cq.d ? 1 : -1) : (Math.random() < 0.5 ? 1 : -1); const d2 = side > 0 ? hwR(s2) + 4 + Math.random() * 25 : -(hwL(s2) + 4 + Math.random() * 25); return fromSD(s2, d2); };
    A.crowd = cq.d > 0 && cq.s > 770 && cq.s < 980 ? clamp(1.2 - Math.abs(hwR(cq.s) + 8 - cq.d) / 60, 0, 1) : 0;
    A.flocks.length = 0; for (const f of APP.wild.flocks) { const c = f.c || f.home; A.flocks.push({ x: c.x, z: c.z, alarm: f.alarm || 0, goose: f.gs, dist: Math.hypot(c.x - camera.position.x, c.z - camera.position.z) }); }
    A.gulls = APP.fx.gulls && APP.fx.gulls.visible ? 1 : 0;
    const onShore = APP.skipper.onFoot; A.lap = boat.script || onShore ? 1 : Math.abs(boat.u) < 0.6 ? 0.4 : 0; A.lapAt = boat.root.position;
    A.shells.length = 0; for (const sh of APP.rowing.shells) { const c = sh.lastPh !== undefined && sh.ph < sh.lastPh; sh.lastPh = sh.ph; A.shells.push({ x: sh.x, z: sh.z, catch: c && sh.m.visible }); }
    A.fire = APP.home ? APP.home.fireSound() : null; A.tv = APP.home ? APP.home.tvSound() : null;
    audio.ambient(dt, A);
  }
  audio.update({ throttle: boat.throttle, speed: Math.abs(boat.u), current: currentAt(boat.s, boat.d), city: clamp(1 - (cs - 200) / 1200, 0.15, 1), rain: S.rain, night: S.night });
}

// autopilot: give way to other boats ahead (steer to the side with more room, ease off when close)
function autopilotAvoid(boat) {
  if (!boat.auto || !boat.others) return null;
  const [fx, fz] = boat.fwd(); const rx = -fz, rz = fx;
  let rud = 0, thr = 1;
  for (const o of boat.others) {
    const dx = o.x - boat.x, dz = o.z - boat.z;
    const ahead = dx * fx + dz * fz, lat = dx * rx + dz * rz;
    const reach = o.halfLen + 45;
    if (ahead < -o.halfLen || ahead > reach) continue;
    const clear = o.halfBeam + 6 + (o.halfLen > 10 ? 6 : 0);
    if (Math.abs(lat) > clear + 4) continue;
    const k = (1 - Math.max(0, ahead) / reach) * (1 - Math.max(0, Math.abs(lat) - clear) / 4);
    rud += (lat > 0 ? -1 : 1) * k * 1.4;
    if (ahead > 0 && Math.abs(lat) < clear) thr = Math.min(thr, clamp((ahead - o.halfLen - 4) / 20, 0.25, 1));
  }
  return rud || thr < 1 ? { rud: clamp(rud, -1, 1), thr } : null;
}

const _lsort = [];
function updateLights(focus) {
  const on = S.lightsOn;
  _lsort.length = 0;
  for (const L of LIGHTS) { if (L.I <= 0.01) continue; const d2 = L.p.distanceToSquared(focus); if (d2 < 220 * 220) _lsort.push([d2, L]); }
  _lsort.sort((a, b) => a[0] - b[0]);
  const P = U.uLPos.value, C = U.uLCol.value;
  for (let i = 0; i < MAXL; i++) {
    const e = _lsort[i];
    if (e && on > 0.001) { const L = e[1]; P[i].set(L.p.x, L.p.y, L.p.z, L.range); C[i].set(L.col.r * L.I, L.col.g * L.I, L.col.b * L.I); }
    else { P[i].set(0, -1000, 0, 0); C[i].set(0, 0, 0); }
  }
  const glow = 0.6 + on * 10;
  M.lampGlow.color.setRGB(1, 0.95, 0.85).multiplyScalar(glow);
  M.lampGlowWarm.color.setRGB(1, 0.8, 0.55).multiplyScalar(glow);
  M.redBeacon.color.setRGB(1, 0.1, 0.05).multiplyScalar((0.4 + on * 14) * (Math.sin(APP.time * 2.2) > 0.2 ? 1 : 0.08));
  for (const [m, k] of NIGHT_EMISSIVE) m.emissiveIntensity = k * on;
  if (M.skyMat) M.skyMat.emissiveIntensity = 1.6 * on;
  // hero boat navigation lights
  const ud = APP.boat.model.userData.mats;
  const nav = 0.4 + on * 8;
  ud.navRed.color.setRGB(1, 0.12, 0.08).multiplyScalar(nav); ud.navGreen.color.setRGB(0.1, 1, 0.35).multiplyScalar(nav); ud.navWhite.color.setRGB(1, 0.95, 0.85).multiplyScalar(nav);
  ud.screen.emissiveIntensity = 0.25 + on * 0.6;
}

APP.step = step;
APP.viewSD = (s, d, y, s2, d2, y2) => { const [x, z] = fromSD(s, d); const [x2, z2] = fromSD(s2, d2); camera.position.set(x, y, z); camera.lookAt(x2, y2, z2); camera.updateMatrixWorld(); };
APP.setHour = setHour;
APP.S = S;
// test helper: jump the boat to river station s
APP.look = (px, py, pz, tx, ty, tz) => { APP.freeCam = true; camera.position.set(px, py, pz); camera.lookAt(tx, ty, tz); camera.updateMatrixWorld(); };
APP.boatLocal = (x, y, z) => { const v = new THREE.Vector3(x, y, z); APP.boat.root.updateMatrixWorld(); return v.applyMatrix4(APP.boat.root.matrixWorld).toArray(); };
APP.W = { hwL, hwR, laneAt, fromSD, toSD, frame, terrainH: (s, d) => groundAt(...fromSD(s, d)) }; APP.SIM = SIM; APP.inSolid = inSolid; APP.walkBlocked = walkBlocked; APP.V3 = THREE.Vector3;
APP.jump = (s) => { APP.boat.reset(s); APP.cam.snap(); };
init();
