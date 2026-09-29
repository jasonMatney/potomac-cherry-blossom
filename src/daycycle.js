// Day / night cycle: time mapping, sun & moon positions, keyframed palette, storm state
import * as THREE from 'three';
import { clamp, lerp, smooth } from './util.js';
import { bearingDir } from './world.js';

export const CYCLE = 420; // seconds per full day

// cycle fraction -> clock hour (continuous 5.3..29.3)
const HMAP = [
  [0.0, 5.25], [0.075, 7.0], [0.2, 11.0], [0.29, 14.0], [0.43, 16.4], [0.47, 17.4], [0.585, 19.05],
  [0.64, 19.6], [0.70, 20.3], [0.85, 26.0], [0.935, 28.5], [1.0, 29.25],
];
export function hourAt(f) {
  f = ((f % 1) + 1) % 1;
  for (let i = 0; i < HMAP.length - 1; i++) {
    const [a, ha] = HMAP[i], [b, hb] = HMAP[i + 1];
    if (f >= a && f <= b) return (lerp(ha, hb, (f - a) / (b - a))) % 24;
  }
  return 5.25;
}
export function fracForHour(h) {
  // inverse (for tests)
  let hh = h; if (hh < 5.25) hh += 24;
  for (let i = 0; i < HMAP.length - 1; i++) {
    const [a, ha] = HMAP[i], [b, hb] = HMAP[i + 1];
    if (hh >= ha && hh <= hb) return lerp(a, b, (hh - ha) / (hb - ha));
  }
  return 0;
}

// storm profile over cycle fraction
export function stormAt(f) {
  return smooth(0.285, 0.325, f) * (1 - smooth(0.405, 0.445, f));
}

// astronomy-lite for Washington DC, early April
const LAT = 38.9 * Math.PI / 180, DEC = 6.5 * Math.PI / 180;
function celestial(hourAngleDeg, dec) {
  const H = hourAngleDeg * Math.PI / 180;
  const sinEl = Math.sin(LAT) * Math.sin(dec) + Math.cos(LAT) * Math.cos(dec) * Math.cos(H);
  const el = Math.asin(sinEl);
  const az = Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(LAT) - Math.tan(dec) * Math.cos(LAT)) + Math.PI; // from north, clockwise
  return { el, az };
}
function dirFromAzEl(az, el, out) {
  const [dx, dz] = bearingDir(az * 180 / Math.PI);
  out.set(dx * Math.cos(el), Math.sin(el), dz * Math.cos(el));
  return out;
}

const hx = (h) => new THREE.Color(h);
// palette keys by hour
const K = [
  { h: 0.0, zen: 0x02050f, hor: 0x121a30, sun: 0x000000, sunI: 0, amb: 0x2c3c60, ambI: 0.42, fog: 0x0e1626, fogD: 0.0015, exp: 1.15, lift: [0.004, 0.008, 0.022], gain: [0.92, 0.96, 1.08], mist: 0.8, glow: 0x3a2818 },
  { h: 4.6, zen: 0x060e24, hor: 0x222c4a, sun: 0x000000, sunI: 0, amb: 0x34456a, ambI: 0.5, fog: 0x1e2842, fogD: 0.0018, exp: 1.2, lift: [0.01, 0.016, 0.034], gain: [0.92, 0.97, 1.1], mist: 1.0, glow: 0x3e3230 },
  { h: 5.7, zen: 0x22386a, hor: 0xd3979a, sun: 0xff9a70, sunI: 0.0, amb: 0x6a7090, ambI: 0.7, fog: 0x9a90a4, fogD: 0.0019, exp: 1.05, lift: [0.03, 0.02, 0.05], gain: [1.02, 0.96, 1.02], mist: 1.0, glow: 0x302830 },
  { h: 6.9, zen: 0x4a70ae, hor: 0xffbd8c, sun: 0xffa060, sunI: 1.2, amb: 0x8a9ab8, ambI: 0.75, fog: 0xe0bca4, fogD: 0.0016, exp: 0.95, lift: [0.02, 0.01, 0.02], gain: [1.06, 0.98, 0.94], mist: 0.8, glow: 0 },
  { h: 8.5, zen: 0x4a86cf, hor: 0xcfe0ef, sun: 0xfff0d8, sunI: 2.6, amb: 0xa8c0dc, ambI: 0.8, fog: 0xc6d6e4, fogD: 0.00105, exp: 0.9, lift: [0.0, 0.005, 0.015], gain: [1.0, 1.0, 1.0], mist: 0.35, glow: 0 },
  { h: 12.5, zen: 0x3a7cd0, hor: 0xd6e5f1, sun: 0xfffaf0, sunI: 3.0, amb: 0xb0c8e2, ambI: 0.8, fog: 0xcfdce8, fogD: 0.0009, exp: 0.88, lift: [0.0, 0.0, 0.01], gain: [1.0, 1.0, 1.0], mist: 0.1, glow: 0 },
  { h: 16.5, zen: 0x4280cc, hor: 0xe2e2e0, sun: 0xfff0d6, sunI: 2.8, amb: 0xb4c4d8, ambI: 0.78, fog: 0xd8dade, fogD: 0.00095, exp: 0.9, lift: [0.005, 0.0, 0.0], gain: [1.02, 1.0, 0.98], mist: 0.12, glow: 0 },
  { h: 18.0, zen: 0x4a78bc, hor: 0xf4d6b0, sun: 0xffd29a, sunI: 2.6, amb: 0xb8b8c8, ambI: 0.72, fog: 0xe8cfb0, fogD: 0.00115, exp: 0.9, lift: [0.015, 0.005, 0.0], gain: [1.06, 1.0, 0.92], mist: 0.25, glow: 0 },
  { h: 18.9, zen: 0x5a74ac, hor: 0xffb878, sun: 0xffa650, sunI: 2.5, amb: 0xb8a8b0, ambI: 0.7, fog: 0xf0c08c, fogD: 0.0014, exp: 0.92, lift: [0.025, 0.01, 0.0], gain: [1.12, 1.0, 0.86], mist: 0.45, glow: 0 },
  { h: 19.45, zen: 0x3c5290, hor: 0xff8448, sun: 0xff6a2c, sunI: 1.4, amb: 0x9a8aa0, ambI: 0.66, fog: 0xd88c70, fogD: 0.00155, exp: 1.0, lift: [0.03, 0.01, 0.02], gain: [1.1, 0.96, 0.92], mist: 0.6, glow: 0x201814 },
  { h: 20.1, zen: 0x162a62, hor: 0x4a5a92, sun: 0x000000, sunI: 0, amb: 0x5a6a98, ambI: 0.65, fog: 0x3a4a76, fogD: 0.0016, exp: 1.15, lift: [0.01, 0.02, 0.06], gain: [0.92, 0.98, 1.14], mist: 0.75, glow: 0x5a4030 },
  { h: 21.5, zen: 0x030716, hor: 0x141c34, sun: 0x000000, sunI: 0, amb: 0x2c3c60, ambI: 0.42, fog: 0x0f1728, fogD: 0.0015, exp: 1.15, lift: [0.004, 0.008, 0.022], gain: [0.92, 0.96, 1.08], mist: 0.8, glow: 0x3a2818 },
];
K.forEach((k) => { for (const f of ['zen', 'hor', 'sun', 'amb', 'fog', 'glow']) k[f] = hx(k[f]); });

export const S = {
  t: 0, f: 0, day: 0, hour: 8, speed: 1, storm: 0, rain: 0, wet: 0, night: 0, twilight: 0,
  sunDir: new THREE.Vector3(), moonDir: new THREE.Vector3(), keyDir: new THREE.Vector3(),
  sunEl: 0, moonEl: 0, keyIsMoon: false,
  zen: new THREE.Color(), hor: new THREE.Color(), sunCol: new THREE.Color(), sunI: 0,
  amb: new THREE.Color(), ambI: 0, fog: new THREE.Color(), fogD: 0, exp: 1, lift: [0, 0, 0], gain: [1, 1, 1], mist: 0, glow: new THREE.Color(),
  keyCol: new THREE.Color(), keyI: 0, lightsOn: 0, flash: 0, cloudCov: 0.35, lightning: [],
};

function sampleK(h) {
  let a = K[K.length - 1], b = K[0], t = 0;
  for (let i = 0; i < K.length; i++) {
    const k0 = K[i], k1 = K[(i + 1) % K.length];
    const h1 = i + 1 < K.length ? k1.h : k1.h + 24;
    if (h >= k0.h && h < h1) { a = k0; b = k1; t = (h - k0.h) / (h1 - k0.h); break; }
  }
  t = t * t * (3 - 2 * t);
  S.zen.copy(a.zen).lerp(b.zen, t); S.hor.copy(a.hor).lerp(b.hor, t); S.sunCol.copy(a.sun).lerp(b.sun, t);
  S.amb.copy(a.amb).lerp(b.amb, t); S.fog.copy(a.fog).lerp(b.fog, t); S.glow.copy(a.glow).lerp(b.glow, t);
  S.sunI = lerp(a.sunI, b.sunI, t); S.ambI = lerp(a.ambI, b.ambI, t); S.fogD = lerp(a.fogD, b.fogD, t);
  S.exp = lerp(a.exp, b.exp, t); S.mist = lerp(a.mist, b.mist, t);
  for (let i = 0; i < 3; i++) { S.lift[i] = lerp(a.lift[i], b.lift[i], t); S.gain[i] = lerp(a.gain[i], b.gain[i], t); }
}

const gray = new THREE.Color(0x70767e), stormFog = new THREE.Color(0x5e646c), stormZen = new THREE.Color(0x3a4048), stormHor = new THREE.Color(0x6a7078);
let wet = 0;
export function updateCycle(dt) {
  S.t += dt * S.speed;
  const f0 = S.f;
  S.f = (S.t / CYCLE) % 1;
  if (S.f < f0 - 0.5) S.day++; // past midnight
  const f = S.f;
  S.hour = hourAt(f);
  const h = S.hour;
  sampleK(h);
  // sun
  const sc = celestial((h - 13.2) * 15, DEC);
  S.sunEl = sc.el; dirFromAzEl(sc.az, sc.el, S.sunDir);
  const mc = celestial((h - 1.2) * 15, -4 * Math.PI / 180);
  S.moonEl = mc.el; dirFromAzEl(mc.az, mc.el, S.moonDir);
  // storm
  S.storm = stormAt(f);
  S.rain = smooth(0.35, 0.8, S.storm);
  // wetness: rises fast with rain, dries slowly until blue hour
  wet = f <= 0.44 ? smooth(0.315, 0.36, f) : Math.max(0, 1 - (f - 0.44) / 0.27);
  S.wet = wet * wet * (3 - 2 * wet);
  // clouds
  const baseCov = 0.34 + 0.08 * Math.sin(f * 17.0) + 0.1 * smooth(0.22, 0.29, f) * (1 - smooth(0.44, 0.5, f));
  S.cloudCov = lerp(baseCov, 1.0, S.storm);
  // storm grade
  const st = S.storm;
  S.zen.lerp(stormZen, st * 0.85); S.hor.lerp(stormHor, st * 0.8); S.fog.lerp(stormFog, st * 0.85);
  S.sunI *= 1 - 0.88 * st; S.sunCol.lerp(gray, st * 0.5);
  S.fogD = lerp(S.fogD, 0.0027, st); S.ambI *= 1 - 0.1 * st; S.amb.lerp(gray, st * 0.6);
  S.exp = lerp(S.exp, 1.28, st); S.mist = Math.max(S.mist, st * 0.7);
  for (let i = 0; i < 3; i++) { S.gain[i] = lerp(S.gain[i], [0.96, 1.0, 1.04][i], st); S.lift[i] = lerp(S.lift[i], 0.015, st); }
  // night / key light
  const sunUp = smooth(-0.06, 0.05, S.sunEl);
  S.night = 1 - smooth(-0.2, -0.02, S.sunEl);
  S.twilight = smooth(-0.25, -0.03, S.sunEl) * (1 - smooth(-0.03, 0.12, S.sunEl));
  S.lightsOn = 1 - smooth(-0.08, 0.04, S.sunEl);
  if (S.sunEl > -0.04) {
    S.keyIsMoon = false; S.keyDir.copy(S.sunDir);
    if (S.keyDir.y < 0.04) S.keyDir.y = 0.04;
    S.keyDir.normalize();
    S.keyCol.copy(S.sunCol); S.keyI = S.sunI * sunUp;
  } else {
    S.keyIsMoon = true; S.keyDir.copy(S.moonDir);
    if (S.keyDir.y < 0.1) S.keyDir.y = 0.1;
    S.keyDir.normalize();
    S.keyCol.setRGB(0.62, 0.72, 0.95);
    S.keyI = 0.55 * smooth(0.02, 0.2, S.moonEl) * S.night * (1 - 0.8 * st);
  }
}
export function setHour(h) {
  const f = fracForHour(h);
  if (f < S.f) S.day++; // jumping to an earlier hour means the next day (e.g. waking up after sleeping)
  S.t = f * CYCLE; S.f = f;
}
