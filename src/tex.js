// Procedural texture generation (painterly, tileable)
import * as THREE from 'three';
import { tfbm, tnoise2, mulberry32, clamp, lerp } from './util.js';

const TEX = {};
export default TEX;

function canvas(w, h = w) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }

function toTexture(c, { srgb = true, repeat = true, aniso = 8, mips = true } = {}) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = aniso;
  t.generateMipmaps = mips;
  t.minFilter = mips ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
}

// Build albedo + normal from a per-pixel function returning [r,g,b,height]
function pixelTex(size, fn, normalStrength = 2, opts = {}) {
  const c = canvas(size); const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  const H = new Float32Array(size * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const o = fn(x / size, y / size, x, y);
    const i = (y * size + x);
    img.data[i * 4] = clamp(o[0], 0, 1) * 255; img.data[i * 4 + 1] = clamp(o[1], 0, 1) * 255; img.data[i * 4 + 2] = clamp(o[2], 0, 1) * 255;
    img.data[i * 4 + 3] = o.length > 4 ? clamp(o[4], 0, 1) * 255 : 255;
    H[i] = o[3];
  }
  ctx.putImageData(img, 0, 0);
  const map = toTexture(c, opts);
  let normalMap = null;
  if (normalStrength > 0) normalMap = heightToNormal(H, size, normalStrength);
  return { map, normalMap, H };
}

export function heightToNormal(H, size, strength) {
  const data = new Uint8Array(size * size * 4);
  const at = (x, y) => H[((y + size) % size) * size + ((x + size) % size)];
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
    const dy = (at(x, y + 1) - at(x, y - 1)) * strength;
    let nx = -dx, ny = dy, nz = 1; const l = Math.hypot(nx, ny, nz); nx /= l; ny /= l; nz /= l;
    const i = (y * size + x) * 4;
    data[i] = (nx * 0.5 + 0.5) * 255; data[i + 1] = (ny * 0.5 + 0.5) * 255; data[i + 2] = (nz * 0.5 + 0.5) * 255; data[i + 3] = 255;
  }
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter;
  t.anisotropy = 8; t.needsUpdate = true;
  return t;
}

const mix3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
const hex = (h) => [((h >> 16) & 255) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255];
function cellRand(i, j, k = 0) { const r = mulberry32((i * 7349 + j * 1931 + k * 8111) | 0); r(); return r(); }

// ---------- masonry (granite ashlar) ----------
function masonry(size, { rows = 6, base = 0xd9d2c3, var: vr = 0.07, joint = 0.012, rough = 1, seed = 1, speck = 0.08, warm = 0 } = {}) {
  const b = hex(base);
  return pixelTex(size, (u, v) => {
    const r = Math.floor(v * rows); const rv = v * rows - r;
    const shift = (r % 2) * 0.5 + cellRand(r, seed) * 0.2;
    const cols = 3 + ((r + seed) % 2);
    const uu = u * cols + shift; const cidx = Math.floor(uu); const cu = uu - cidx;
    const jx = Math.min(cu, 1 - cu) * (1 / cols) * rows, jy = Math.min(rv, 1 - rv);
    const jd = Math.min(jx, jy) / rows; // distance to joint in tile units
    const inJoint = 1 - clamp((jd - joint * 0.5) / (joint * 0.6), 0, 1);
    const tint = (cellRand(cidx + 17 * seed, r) - 0.5) * vr;
    const n = tfbm(u * 8, v * 8, 8, 5) - 0.5;
    const n2 = tnoise2(u * 128, v * 128, 128) - 0.5;
    let c = [b[0] + tint + n * 0.12 + n2 * speck, b[1] + tint * 0.95 + n * 0.11 + n2 * speck, b[2] + tint * 0.9 + n * 0.1 + n2 * speck];
    c[0] += warm * cellRand(cidx, r, 3) * 0.05;
    // weathering streaks downward
    const streak = Math.pow(tfbm(u * 24, v * 2, 24, 3), 3) * 0.25;
    c = c.map((x) => x - streak * 0.5);
    const jc = [b[0] * 0.55, b[1] * 0.53, b[2] * 0.5];
    c = mix3(c, jc, inJoint * 0.9);
    const bevel = clamp(jd / (joint * 3), 0, 1);
    const h = (1 - inJoint) * (0.6 + 0.4 * Math.sqrt(bevel)) + n * 0.15 * rough + n2 * 0.05;
    return [c[0], c[1], c[2], h];
  }, 3.5);
}

// ---------- generators ----------
export function buildTextures(progress) {
  const jobs = [
    ['granite', () => masonry(512, { rows: 6, base: 0xd8d0bf, seed: 3 })],
    ['graniteDark', () => masonry(512, { rows: 4, base: 0xa39c90, seed: 5, var: 0.1, speck: 0.14 })],
    ['marble', () => marble(512)],
    ['concrete', () => concrete(512)],
    ['brick', () => brick(512)],
    ['bark', () => bark(512, [0x4a3c30, 0x2e241c], 0.8)],
    ['barkCherry', () => barkCherry(512)],
    ['barkBirch', () => barkBirch(256)],
    ['barkSyc', () => barkSycamore(256)],
    ['rock', () => rock(512)],
    ['grass', () => ground(512, 'grass')],
    ['forest', () => ground(512, 'forest')],
    ['sand', () => ground(512, 'sand')],
    ['pebble', () => ground(512, 'pebble')],
    ['deck', () => deck(512)],
    ['uphol', () => upholstery(256)],
    ['canvas', () => canvasFabric(256)],
    ['rope', () => rope(128)],
    ['wood', () => weatheredWood(256)],
    ['paving', () => paving(512)],
    ['glass', () => glassWall(256)],
    ['windows', () => windowFacade(256)],
    ['brickWin', () => brickWindows(512)],
    ['litGrid', () => litGrid(256, 0.42, false)],
    ['litGlass', () => litGrid(256, 0.35, true)],
    ['foliage', () => foliageAtlas(1024)],
    ['ground', () => groundAtlas(1024)],
    ['moon', () => moon(256)],
    ['waterN', () => waterNormal(512)],
    ['petalRaft', () => petalRaft(512)],
    ['soft', () => softBlob(128)],
    ['mist', () => mistTex(256)],
    ['fiber', () => fiberglass(256)],
    ['cloth', () => cloth(256)],
  ];
  return jobs;
}

function marble(size) {
  return pixelTex(size, (u, v) => {
    const n = tfbm(u * 4, v * 4, 4, 6);
    const vein = Math.pow(1 - Math.abs(Math.sin((u * 6 + v * 3 + n * 4) * Math.PI)), 12) * 0.12;
    // panel joints
    const pu = (u * 2) % 1, pv = (v * 4) % 1;
    const j = Math.min(Math.min(pu, 1 - pu) * 2, Math.min(pv, 1 - pv) * 4 / 2);
    const inj = 1 - clamp((j - 0.004) / 0.004, 0, 1);
    const t = (cellRand(Math.floor(u * 2), Math.floor(v * 4)) - 0.5) * 0.03;
    let c = [0.93 + t - vein + (n - 0.5) * 0.05, 0.92 + t - vein + (n - 0.5) * 0.05, 0.89 + t - vein * 0.8 + (n - 0.5) * 0.05];
    c = mix3(c, [0.62, 0.6, 0.57], inj * 0.8);
    return [c[0], c[1], c[2], 1 - inj * 0.6 + (n - 0.5) * 0.05];
  }, 2);
}
function concrete(size) {
  return pixelTex(size, (u, v) => {
    const n = tfbm(u * 6, v * 6, 6, 6) - 0.5;
    const pits = Math.pow(tnoise2(u * 96, v * 96, 96), 8) * 0.6;
    const board = Math.abs(Math.sin(v * Math.PI * 16)) < 0.04 ? 0.05 : 0;
    const stain = Math.pow(tfbm(u * 10, v * 1.5, 10, 4), 2.5) * 0.35;
    const b = 0.72 + n * 0.15 - pits * 0.3 - board - stain * 0.4;
    return [b * 0.99, b * 0.97, b * 0.92, 0.5 + n * 0.3 - pits - board * 2];
  }, 2.5);
}
function brick(size) {
  const rows = 16;
  return pixelTex(size, (u, v) => {
    const r = Math.floor(v * rows); const rv = v * rows - r;
    const uu = u * 8 + (r % 2) * 0.5; const ci = Math.floor(uu); const cu = uu - ci;
    const jd = Math.min(Math.min(cu, 1 - cu) * 0.5, Math.min(rv, 1 - rv) * 0.25 * 2);
    const m = 1 - clamp((jd - 0.035) / 0.03, 0, 1);
    const t = cellRand(ci, r) ;
    const n = tfbm(u * 16, v * 16, 16, 4) - 0.5;
    let c = mix3(hex(0x8f4a36), hex(0xa4624a), t);
    c = mix3(c, hex(0x5e3326), cellRand(ci, r, 2) > 0.85 ? 0.5 : 0);
    c = c.map((x) => x + n * 0.1);
    c = mix3(c, [0.72, 0.69, 0.63], m);
    return [c[0], c[1], c[2], (1 - m) * 0.8 + n * 0.2];
  }, 3);
}
function bark(size, [a, b], furrow) {
  const A = hex(a), B = hex(b);
  return pixelTex(size, (u, v) => {
    const w = tfbm(u * 6, v * 1.5, 6, 5);
    const ridges = Math.pow(Math.abs(Math.sin((u * 14 + w * 3.2) * Math.PI)), 0.6);
    const cross = tfbm(u * 16, v * 24, 16, 3);
    const h = ridges * 0.7 + cross * 0.3;
    const moss = clamp((tfbm(u * 3 + 5, v * 3, 3, 4) - 0.55) * 3, 0, 1) * 0.4;
    let c = mix3(B, A, h);
    c = mix3(c, hex(0x5c6b3a), moss);
    const lich = Math.pow(tnoise2(u * 40, v * 40, 40), 6) * 0.5;
    c = mix3(c, [0.62, 0.66, 0.55], lich);
    return [c[0], c[1], c[2], h * furrow];
  }, 4);
}
function barkCherry(size) {
  return pixelTex(size, (u, v) => {
    const n = tfbm(u * 4, v * 8, 4, 5);
    const bands = Math.pow(Math.abs(Math.sin((v * 22 + n * 1.2) * Math.PI)), 20); // horizontal lenticels
    const lent = bands * (tnoise2(u * 48, v * 6, 48) > 0.55 ? 1 : 0.2);
    const ridge = tfbm(u * 10, v * 3, 10, 4);
    let c = mix3(hex(0x2c1c17), hex(0x5a3b30), ridge * 0.8 + n * 0.3);
    c = mix3(c, hex(0x8e7a6a), lent * 0.6);
    const moss = clamp((tfbm(u * 2 + 9, v * 2, 2, 4) - 0.58) * 3, 0, 1) * 0.35;
    c = mix3(c, hex(0x56663a), moss);
    return [c[0], c[1], c[2], ridge * 0.6 - lent * 0.3 + n * 0.2];
  }, 4);
}
function barkBirch(size) {
  return pixelTex(size, (u, v) => {
    const n = tfbm(u * 5, v * 3, 5, 5);
    const peel = tfbm(u * 3, v * 9, 3, 4);
    let c = mix3(hex(0x9a5a3c), hex(0xd8b89a), clamp((peel - 0.4) * 3, 0, 1));
    c = mix3(c, hex(0x5a3325), Math.pow(1 - n, 4) * 0.6);
    return [c[0], c[1], c[2], peel * 0.8 + n * 0.2];
  }, 3);
}
function barkSycamore(size) {
  return pixelTex(size, (u, v) => {
    const n = tfbm(u * 4, v * 4, 4, 5);
    const p = tfbm(u * 3 + 3, v * 3, 3, 3);
    const k = clamp((p - 0.45) * 5, 0, 1);
    let c = mix3(hex(0x7b7a5e), hex(0xe6e2d2), k);
    c = mix3(c, hex(0x8e8a6a), clamp((n - 0.5) * 2, 0, 1) * 0.5);
    return [c[0], c[1], c[2], k * 0.3 + n * 0.4];
  }, 3);
}
function rock(size) {
  return pixelTex(size, (u, v) => {
    const n = tfbm(u * 4, v * 4, 4, 7);
    const cr = Math.pow(1 - Math.abs(tfbm(u * 6 + 3, v * 6, 6, 4) * 2 - 1), 10); // cracks
    const grain = tnoise2(u * 200, v * 200, 200);
    let c = mix3(hex(0x5a5650), hex(0x9d978c), n);
    c = c.map((x, i) => x + (grain - 0.5) * 0.08 + [0.02, 0.0, -0.02][i] * n);
    const lichen = clamp((tfbm(u * 8 + 1, v * 8, 8, 4) - 0.6) * 4, 0, 1);
    c = mix3(c, hex(0xb7b89a), lichen * 0.45);
    c = mix3(c, hex(0x2c2a27), cr * 0.7);
    return [c[0], c[1], c[2], n - cr * 0.3 + grain * 0.04];
  }, 5);
}
function ground(size, kind) {
  return pixelTex(size, (u, v, x, y) => {
    const n = tfbm(u * 6, v * 6, 6, 6);
    const f = tnoise2(u * 160, v * 160, 160);
    const f2 = tnoise2(u * 64 + 7, v * 64, 64);
    let c, h;
    if (kind === 'grass') {
      c = mix3(hex(0x4f6632), hex(0x8a9d55), n * 0.8 + f * 0.3);
      c = mix3(c, hex(0xa9ad6c), Math.pow(f2, 4) * 0.6);
      const clover = Math.pow(tnoise2(u * 30, v * 30, 30), 6);
      c = mix3(c, hex(0x3c5a26), clover * 0.5);
      h = f * 0.6 + n * 0.4;
    } else if (kind === 'forest') {
      c = mix3(hex(0x3b2c1e), hex(0x7a5b3a), n);
      const leaf = Math.pow(f2, 2);
      c = mix3(c, hex(0x8f6c3e), leaf * 0.5);
      c = mix3(c, hex(0x4f6a2a), clamp((tfbm(u * 3 + 4, v * 3, 3, 4) - 0.55) * 3, 0, 1) * 0.6);
      h = f2 * 0.7 + n * 0.3;
    } else if (kind === 'sand') {
      c = mix3(hex(0x7a6a52), hex(0xb2a07c), n * 0.7 + f * 0.3);
      const ripple = Math.sin((u * 20 + n * 2) * Math.PI * 2) * 0.5 + 0.5;
      c = c.map((q) => q + (ripple - 0.5) * 0.03);
      h = ripple * 0.3 + f * 0.3;
    } else {
      // pebbles: voronoi-ish
      let md = 9, id = 0;
      const S = 22; const gx = u * S, gy = v * S; const ix = Math.floor(gx), iy = Math.floor(gy);
      let md2 = 9;
      for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
        const cx = ix + i, cy = iy + j; const wx = ((cx % S) + S) % S, wy = ((cy % S) + S) % S;
        const px = cx + cellRand(wx, wy, 1), py = cy + cellRand(wx, wy, 2);
        const d = Math.hypot(gx - px, gy - py);
        if (d < md) { md2 = md; md = d; id = wx * 131 + wy; } else if (d < md2) md2 = d;
      }
      const edge = clamp((md2 - md) * 3, 0, 1);
      const t = cellRand(id, 5);
      c = mix3(hex(0x6e675c), hex(0xb0a590), t);
      c = mix3(c, hex(0x8a7560), cellRand(id, 6) * 0.5);
      c = mix3(hex(0x3d372e), c, Math.pow(edge, 0.5));
      h = Math.sqrt(edge) * 0.8 + f * 0.1;
    }
    return [c[0], c[1], c[2], h];
  }, kind === 'pebble' ? 4 : 2.2);
}
function deck(size) {
  // faux-teak nonslip EVA with grooves and diamond micro texture
  return pixelTex(size, (u, v) => {
    const strips = 8; const s = u * strips; const si = Math.floor(s); const su = s - si;
    const groove = 1 - clamp((Math.min(su, 1 - su) - 0.035) / 0.02, 0, 1);
    const dia = (Math.abs(((u * 96 + v * 96) % 1) - 0.5) + Math.abs(((u * 96 - v * 96 + 100) % 1) - 0.5));
    const grain = tfbm(u * 4, v * 30, 4, 4);
    let c = mix3(hex(0x8a6a48), hex(0xb08a60), cellRand(si, 3) * 0.6 + grain * 0.4);
    c = c.map((x) => x - (dia < 0.45 ? 0.02 : 0));
    c = mix3(c, hex(0x1e1a16), groove * 0.9);
    return [c[0], c[1], c[2], (1 - groove) * 0.7 + (dia < 0.45 ? 0.08 : 0)];
  }, 4);
}
function upholstery(size) {
  return pixelTex(size, (u, v) => {
    const ch = 4; const cv = (v * ch) % 1;
    const seam = Math.min(cv, 1 - cv);
    const puff = Math.sin(cv * Math.PI);
    const st = (Math.abs(seam - 0.05) < 0.012 && ((u * 64) % 1) < 0.6) ? 1 : 0; // stitches
    const n = tnoise2(u * 90, v * 90, 90) - 0.5;
    let c = [0.9 + n * 0.03, 0.88 + n * 0.03, 0.83 + n * 0.03];
    c = c.map((x) => x * (0.82 + 0.18 * puff));
    c = mix3(c, [0.55, 0.52, 0.48], st * 0.8);
    return [c[0], c[1], c[2], puff * 0.8 - st * 0.15 + n * 0.05];
  }, 3);
}
function canvasFabric(size) {
  return pixelTex(size, (u, v) => {
    const w1 = Math.sin(u * size * Math.PI * 0.5) * 0.5 + 0.5, w2 = Math.sin(v * size * Math.PI * 0.5) * 0.5 + 0.5;
    const n = tfbm(u * 6, v * 6, 6, 4);
    const b = 0.8 + (w1 * w2 - 0.25) * 0.08 + (n - 0.5) * 0.08;
    return [b * 0.85, b * 0.83, b * 0.76, w1 * w2];
  }, 1.5);
}
function rope(size) {
  return pixelTex(size, (u, v) => {
    const s = ((u * 3 + v * 3) % 1);
    const strand = Math.sin(s * Math.PI);
    const fib = tnoise2(u * 64, v * 16, 64);
    const b = 0.55 + strand * 0.35 + (fib - 0.5) * 0.1;
    return [b * 0.95, b * 0.9, b * 0.78, strand];
  }, 3);
}
function weatheredWood(size) {
  return pixelTex(size, (u, v) => {
    const boards = 6; const b = u * boards; const bi = Math.floor(b); const bu = b - bi;
    const gap = 1 - clamp((Math.min(bu, 1 - bu) - 0.02) / 0.02, 0, 1);
    const grain = tfbm(u * 6 + bi, v * 40, 6, 4);
    let c = mix3(hex(0x5b5046), hex(0x8e8374), grain * 0.7 + cellRand(bi, 1) * 0.3);
    c = mix3(c, hex(0x2a241f), gap);
    return [c[0], c[1], c[2], grain * 0.5 + (1 - gap) * 0.5];
  }, 3);
}
function paving(size) {
  // granite pavers
  return pixelTex(size, (u, v) => {
    const r = Math.floor(v * 8); const rv = v * 8 - r;
    const uu = u * 4 + (r % 2) * 0.5; const ci = Math.floor(uu); const cu = uu - ci;
    const jd = Math.min(Math.min(cu, 1 - cu) * 0.5, Math.min(rv, 1 - rv) * 0.25 * 2);
    const m = 1 - clamp((jd - 0.01) / 0.012, 0, 1);
    const n = tnoise2(u * 128, v * 128, 128) - 0.5;
    const t = cellRand(ci, r) - 0.5;
    let c = [0.6 + t * 0.08 + n * 0.1, 0.58 + t * 0.08 + n * 0.1, 0.55 + t * 0.07 + n * 0.1];
    c = mix3(c, [0.3, 0.29, 0.27], m);
    return [c[0], c[1], c[2], 1 - m + n * 0.1];
  }, 2);
}
function glassWall(size) {
  // curtain wall: mullions + spandrel panels; alpha channel = glass mask
  return pixelTex(size, (u, v) => {
    const cu = (u * 4) % 1, cv = (v * 4) % 1;
    const mull = Math.min(cu, 1 - cu) < 0.07 || Math.min(cv, 1 - cv) < 0.05;
    const spandrel = cv > 0.76;
    const t = cellRand(Math.floor(u * 4), Math.floor(v * 4)) * 0.06;
    let c = mull ? [0.72, 0.74, 0.76] : spandrel ? [0.42, 0.46, 0.5] : [0.16 + t, 0.22 + t, 0.27 + t];
    return [c[0], c[1], c[2], mull ? 1 : 0];
  }, 0, { srgb: true });
}
function windowFacade(size) {
  // punched windows in a light facade; alpha = window mask
  return pixelTex(size, (u, v) => {
    const cu = (u * 4) % 1, cv = (v * 4) % 1;
    const win = cu > 0.2 && cu < 0.8 && cv > 0.25 && cv < 0.85;
    const frame = win && (Math.abs(cu - 0.5) < 0.02 || cu < 0.24 || cu > 0.76 || cv < 0.29 || cv > 0.81);
    const n = tnoise2(u * 64, v * 64, 64) - 0.5;
    let c = win ? (frame ? [0.85, 0.84, 0.8] : [0.14, 0.17, 0.2]) : [0.78 + n * 0.05, 0.74 + n * 0.05, 0.66 + n * 0.05];
    const sill = !win && cu > 0.18 && cu < 0.82 && cv > 0.2 && cv < 0.25;
    if (sill) c = [0.88, 0.86, 0.82];
    return [c[0], c[1], c[2], win ? 0.2 : 1];
  }, 2, { srgb: true });
}
function brickWindows(size) {
  // 4x4 window bays over brick; alpha = window glass mask
  const rows = 28;
  return pixelTex(size, (u, v) => {
    const cu = (u * 4) % 1, cv = (v * 4) % 1;
    const win = cu > 0.26 && cu < 0.74 && cv > 0.22 && cv < 0.8;
    const frame = win && (cu < 0.29 || cu > 0.71 || cv < 0.25 || cv > 0.77 || Math.abs(cu - 0.5) < 0.012 || Math.abs(cv - 0.52) < 0.012);
    const lintel = !win && cu > 0.23 && cu < 0.77 && ((cv > 0.8 && cv < 0.86) || (cv > 0.17 && cv < 0.22));
    const r = Math.floor(v * rows); const rv = v * rows - r;
    const uu = u * 14 + (r % 2) * 0.5; const ci = Math.floor(uu); const bu = uu - ci;
    const jd = Math.min(Math.min(bu, 1 - bu) * 0.5, Math.min(rv, 1 - rv) * 0.5);
    const m = 1 - clamp((jd - 0.04) / 0.04, 0, 1);
    const n = tfbm(u * 16, v * 16, 16, 3) - 0.5;
    let c = mix3(hex(0x8a4634), hex(0xa25c44), cellRand(ci, r));
    c = c.map((x) => x + n * 0.08);
    c = mix3(c, [0.7, 0.66, 0.6], m * 0.8);
    if (lintel) c = [0.8, 0.77, 0.7];
    if (win) c = frame ? [0.9, 0.9, 0.86] : [0.1, 0.13, 0.16];
    return [c[0], c[1], c[2], win ? (frame ? 0.9 : 0.3) : (1 - m) * 0.7 + 0.2];
  }, 3);
}
function litGrid(size, frac, glass) {
  const c = canvas(size); const ctx = c.getContext('2d');
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, size, size);
  const rnd = mulberry32(glass ? 77 : 55); const N = 16; const cs = size / N;
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      if (rnd() > frac) continue;
      const warm = rnd();
      const b = 0.55 + rnd() * 0.45;
      const col = warm < 0.7 ? [255 * b, 196 * b, 120 * b] : warm < 0.9 ? [240 * b, 230 * b, 210 * b] : [170 * b, 200 * b, 240 * b];
      const x0 = glass ? i * cs + cs * 0.06 : i * cs + cs * 0.28, x1 = glass ? (i + 1) * cs - cs * 0.06 : (i + 1) * cs - cs * 0.28;
      const y0 = glass ? j * cs + cs * 0.05 : j * cs + cs * 0.27, y1 = glass ? (j + 1) * cs - cs * 0.22 : (j + 1) * cs - cs * 0.2;
      const g = ctx.createLinearGradient(0, y0, 0, y1);
      g.addColorStop(0, `rgb(${col[0] * 0.7 | 0},${col[1] * 0.7 | 0},${col[2] * 0.7 | 0})`); g.addColorStop(1, `rgb(${col[0] | 0},${col[1] | 0},${col[2] | 0})`);
      ctx.fillStyle = g; ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
    }
  }
  // note: canvas y grows downward; texture v flips — windows mirror vertically, irrelevant for random lights
  return { map: toTexture(c) };
}
function fiberglass(size) {
  return pixelTex(size, (u, v) => {
    const n = tnoise2(u * 32, v * 32, 32) - 0.5;
    const b = 0.95 + n * 0.02;
    return [b, b, b * 0.985, 0.5 + n * 0.02];
  }, 0.5);
}
function cloth(size) {
  return pixelTex(size, (u, v) => {
    const w = (Math.sin(u * size * 1.5) * Math.sin(v * size * 1.5)) * 0.5 + 0.5;
    const n = tfbm(u * 8, v * 8, 8, 3) - 0.5;
    const b = 0.85 + w * 0.1 + n * 0.1;
    return [b, b, b, w * 0.5 + n];
  }, 1.2);
}
function moon(size) {
  const c = canvas(size); const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  const rnd = mulberry32(99);
  const craters = [];
  for (let i = 0; i < 70; i++) craters.push([rnd(), rnd(), 0.01 + Math.pow(rnd(), 3) * 0.12]);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = x / size, v = y / size;
    const dx = u - 0.5, dy = v - 0.5; const r = Math.hypot(dx, dy);
    const i = (y * size + x) * 4;
    if (r > 0.5) { img.data[i + 3] = 0; continue; }
    const mare = tfbm(u * 3, v * 3, 3, 5);
    let b = 0.78 - clamp((mare - 0.48) * 2.5, 0, 1) * 0.3;
    for (const [cx, cy, cr] of craters) {
      const d = Math.hypot(u - cx, v - cy) / cr;
      if (d < 1.25) { b -= d < 0.85 ? 0.07 * (1 - d) : 0; b += (d > 0.85 && d < 1.2) ? 0.06 : 0; }
    }
    b += (tnoise2(u * 90, v * 90, 90) - 0.5) * 0.05;
    const limb = Math.sqrt(1 - Math.pow(r / 0.5, 2)) * 0.35 + 0.65;
    b *= limb;
    img.data[i] = b * 255; img.data[i + 1] = b * 250; img.data[i + 2] = b * 238; img.data[i + 3] = 255 * clamp((0.5 - r) * 200, 0, 1);
  }
  ctx.putImageData(img, 0, 0);
  return { map: toTexture(c, { repeat: false }) };
}
function waterNormal(size) {
  // tileable wave height field from summed oriented sines + noise
  const H = new Float32Array(size * size);
  const waves = [];
  const rnd = mulberry32(7);
  for (let i = 0; i < 24; i++) {
    const k = 1 + Math.floor(rnd() * 9); const a = rnd() * Math.PI * 2;
    const kx = Math.round(Math.cos(a) * k), ky = Math.round(Math.sin(a) * k);
    if (kx === 0 && ky === 0) continue;
    waves.push([kx, ky, rnd() * 6.28, 1 / Math.pow(Math.hypot(kx, ky), 1.2)]);
  }
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = x / size, v = y / size; let h = 0;
    for (const [kx, ky, p, a] of waves) h += Math.sin((kx * u + ky * v) * 6.2832 + p) * a;
    h += (tfbm(u * 8, v * 8, 8, 4) - 0.5) * 0.9;
    H[y * size + x] = h;
  }
  return { normalMap: heightToNormal(H, size, 3.2) };
}
function petalRaft(size) {
  const c = canvas(size); const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, size, size);
  const rnd = mulberry32(31);
  // clusters of petals (tileable by wrapping draws)
  for (let k = 0; k < 2600; k++) {
    let x, y;
    if (rnd() < 0.8) { const cx = Math.floor(rnd() * 7) / 7 + 0.07, cy = Math.floor(rnd() * 7) / 7 + 0.05; x = (cx + (rnd() - 0.5) * 0.14 + (rnd() - 0.5) * 0.08) * size; y = (cy + (rnd() - 0.5) * 0.14) * size; }
    else { x = rnd() * size; y = rnd() * size; }
    const r = 2.2 + rnd() * 2.5; const a = rnd() * Math.PI;
    const tint = rnd();
    const col = `rgba(${250 - tint * 12},${218 - tint * 30},${226 - tint * 20},${0.75 + rnd() * 0.25})`;
    for (const ox of [-size, 0, size]) for (const oy of [-size, 0, size]) {
      const px = x + ox, py = y + oy; if (px < -10 || py < -10 || px > size + 10 || py > size + 10) continue;
      ctx.save(); ctx.translate(px, py); ctx.rotate(a);
      ctx.fillStyle = col; ctx.beginPath(); ctx.ellipse(0, 0, r, r * 0.62, 0, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
  }
  return { map: toTexture(c) };
}
function softBlob(size) {
  const c = canvas(size); const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.3, 'rgba(255,255,255,0.55)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, size, size);
  return { map: toTexture(c, { repeat: false }) };
}
function mistTex(size) {
  return pixelTex(size, (u, v) => {
    const n = tfbm(u * 4, v * 4, 4, 5);
    const b = clamp((n - 0.3) * 1.8, 0, 1);
    return [1, 1, 1, 0, b];
  }, 0, { srgb: false });
}

// ---------- foliage atlas (4 x 2 tiles of 256) ----------
// 0 cherry blossom cluster, 1 cherry dense, 2 weeping strand, 3 red maple flowers
// 4 young leaves (chartreuse), 5 mature green, 6 dark oak, 7 azalea shrub flowers
function foliageAtlas(size) {
  const c = canvas(size, size / 2); const ctx = c.getContext('2d');
  const T = size / 4; const rnd = mulberry32(11);
  const tile = (i, fn) => { ctx.save(); ctx.translate((i % 4) * T, Math.floor(i / 4) * T); ctx.beginPath(); ctx.rect(0, 0, T, T); ctx.clip(); fn(); ctx.restore(); };
  const blossom = (x, y, r, rot, tint) => {
    ctx.save(); ctx.translate(x, y); ctx.rotate(rot);
    for (let p = 0; p < 5; p++) {
      ctx.save(); ctx.rotate(p * Math.PI * 2 / 5);
      const g = ctx.createLinearGradient(0, 0, 0, -r);
      g.addColorStop(0, `rgb(${235 - tint * 20},${150 - tint * 30},${175 - tint * 20})`);
      g.addColorStop(0.5, `rgb(${250},${218 - tint * 25},${228 - tint * 18})`);
      g.addColorStop(1, `rgb(255,${238 - tint * 20},${242 - tint * 12})`);
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.moveTo(0, 0);
      ctx.bezierCurveTo(r * 0.55, -r * 0.3, r * 0.5, -r * 1.0, r * 0.12, -r * 1.0);
      ctx.lineTo(0, -r * 0.86); ctx.lineTo(-r * 0.12, -r * 1.0);
      ctx.bezierCurveTo(-r * 0.5, -r * 1.0, -r * 0.55, -r * 0.3, 0, 0);
      ctx.fill(); ctx.restore();
    }
    ctx.fillStyle = 'rgba(190,60,90,0.9)'; ctx.beginPath(); ctx.arc(0, 0, r * 0.2, 0, 7); ctx.fill();
    ctx.fillStyle = 'rgba(250,220,120,0.9)';
    for (let k = 0; k < 6; k++) { const a = rnd() * 7; ctx.beginPath(); ctx.arc(Math.cos(a) * r * 0.3, Math.sin(a) * r * 0.3, r * 0.05, 0, 7); ctx.fill(); }
    ctx.restore();
  };
  const twig = (x0, y0, x1, y1, w, col = '#3a2a22') => { ctx.strokeStyle = col; ctx.lineWidth = w; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(x0, y0); ctx.quadraticCurveTo((x0 + x1) / 2 + (rnd() - 0.5) * 20, (y0 + y1) / 2, x1, y1); ctx.stroke(); };
  const leaf = (x, y, len, rot, col, wid = 0.42) => {
    ctx.save(); ctx.translate(x, y); ctx.rotate(rot);
    ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(0, 0);
    ctx.quadraticCurveTo(len * wid, -len * 0.45, 0, -len); ctx.quadraticCurveTo(-len * wid, -len * 0.45, 0, 0); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.15)'; ctx.lineWidth = 0.8; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, -len * 0.9); ctx.stroke();
    ctx.restore();
  };
  // 0: cherry cluster (medium density, gaps)
  tile(0, () => {
    for (let k = 0; k < 7; k++) twig(T / 2, T, T * 0.1 + rnd() * T * 0.8, T * 0.1 + rnd() * T * 0.5, 2 + rnd() * 2);
    for (let k = 0; k < 150; k++) { const a = rnd() * 7, rr = Math.sqrt(rnd()) * T * 0.44; blossom(T / 2 + Math.cos(a) * rr, T * 0.46 + Math.sin(a) * rr * 0.9, 9 + rnd() * 6, rnd() * 7, rnd()); }
  });
  // 1: dense cherry clump
  tile(1, () => {
    for (let k = 0; k < 260; k++) { const a = rnd() * 7, rr = Math.pow(rnd(), 0.6) * T * 0.47; blossom(T / 2 + Math.cos(a) * rr, T / 2 + Math.sin(a) * rr, 8 + rnd() * 5, rnd() * 7, rnd()); }
  });
  // 2: weeping strand (vertical hanging)
  tile(2, () => {
    for (let s = 0; s < 5; s++) {
      const x = T * (0.15 + s * 0.17 + (rnd() - 0.5) * 0.05);
      twig(x, 0, x + (rnd() - 0.5) * 12, T * (0.85 + rnd() * 0.15), 1.5);
      for (let k = 0; k < 34; k++) { const y = rnd() * T * 0.95; blossom(x + (rnd() - 0.5) * 22 + y * 0.02, y, 7 + rnd() * 4, rnd() * 7, rnd() * 0.6 + 0.3); }
    }
  });
  // 3: red maple flowers / samaras (reddish clusters with twigs)
  tile(3, () => {
    for (let k = 0; k < 6; k++) twig(T / 2, T, rnd() * T, rnd() * T * 0.6, 2, '#4a2e28');
    for (let k = 0; k < 420; k++) {
      const a = rnd() * 7, rr = Math.sqrt(rnd()) * T * 0.46;
      const x = T / 2 + Math.cos(a) * rr, y = T * 0.48 + Math.sin(a) * rr;
      ctx.fillStyle = `rgb(${150 + rnd() * 70},${30 + rnd() * 40},${30 + rnd() * 25})`;
      ctx.beginPath(); ctx.ellipse(x, y, 3 + rnd() * 3, 2 + rnd() * 2, rnd() * 3, 0, 7); ctx.fill();
    }
  });
  const leafTile = (i, cols, n, len, wid) => tile(i, () => {
    for (let k = 0; k < 5; k++) twig(T / 2, T, rnd() * T, rnd() * T * 0.5, 2);
    for (let k = 0; k < n; k++) {
      const a = rnd() * 7, rr = Math.sqrt(rnd()) * T * 0.45;
      const x = T / 2 + Math.cos(a) * rr, y = T * 0.48 + Math.sin(a) * rr;
      const cc = cols[Math.floor(rnd() * cols.length)];
      leaf(x, y, len * (0.7 + rnd() * 0.6), rnd() * 7, cc, wid);
    }
  });
  leafTile(4, ['#9fbf45', '#b5cf5a', '#86a83a', '#c8d86a', '#7c9a34'], 170, 26, 0.45);
  leafTile(5, ['#5d8a2e', '#6f9a36', '#4c7a28', '#86ad44', '#3f6a24'], 200, 30, 0.5);
  leafTile(6, ['#4f6f2a', '#5f7f30', '#6c8a36', '#3d5a22', '#7a8f3a'], 190, 28, 0.6);
  tile(7, () => {
    for (let k = 0; k < 90; k++) { const a = rnd() * 7, rr = Math.sqrt(rnd()) * T * 0.45; leaf(T / 2 + Math.cos(a) * rr, T / 2 + Math.sin(a) * rr, 18, rnd() * 7, '#3f5f28', 0.35); }
    for (let k = 0; k < 70; k++) {
      const a = rnd() * 7, rr = Math.sqrt(rnd()) * T * 0.42; const x = T / 2 + Math.cos(a) * rr, y = T / 2 + Math.sin(a) * rr;
      const col = rnd() < 0.5 ? [220, 50, 110] : rnd() < 0.5 ? [245, 120, 170] : [250, 245, 245];
      ctx.save(); ctx.translate(x, y);
      for (let p = 0; p < 5; p++) { ctx.rotate(1.2566); ctx.fillStyle = `rgb(${col[0]},${col[1]},${col[2]})`; ctx.beginPath(); ctx.ellipse(0, -6, 4.5, 6.5, 0, 0, 7); ctx.fill(); }
      ctx.restore();
    }
  });
  const t = toTexture(c, { repeat: false });
  return { map: t };
}

// ---------- ground-cover atlas (4 x 2) ----------
// 0 grass clump, 1 reeds, 2 fern, 3 bluebells, 4 daffodils, 5 small white flowers + violets, 6 cattails, 7 tall wild grass
function groundAtlas(size) {
  const c = canvas(size, size / 2); const ctx = c.getContext('2d');
  const T = size / 4; const rnd = mulberry32(21);
  const tile = (i, fn) => { ctx.save(); ctx.translate((i % 4) * T, Math.floor(i / 4) * T); ctx.beginPath(); ctx.rect(0, 0, T, T); ctx.clip(); fn(); ctx.restore(); };
  const blade = (x, h, bend, w, col) => {
    ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(x - w, T);
    ctx.quadraticCurveTo(x - w * 0.5 + bend * 0.4, T - h * 0.6, x + bend, T - h);
    ctx.quadraticCurveTo(x + w * 0.5 + bend * 0.4, T - h * 0.6, x + w, T); ctx.fill();
  };
  const greens = ['#5f8a2e', '#78a03a', '#4a7424', '#8fb050', '#6a8e30', '#a2bb5c'];
  tile(0, () => { for (let k = 0; k < 110; k++) blade(T * (0.1 + rnd() * 0.8), T * (0.35 + rnd() * 0.6), (rnd() - 0.5) * 60, 2 + rnd() * 2.5, greens[Math.floor(rnd() * 6)]); });
  tile(1, () => { for (let k = 0; k < 60; k++) blade(T * (0.1 + rnd() * 0.8), T * (0.7 + rnd() * 0.3), (rnd() - 0.5) * 30, 2 + rnd() * 1.5, ['#6f8a3a', '#8a9a4a', '#a2a860', '#5a7a30'][Math.floor(rnd() * 4)]); });
  tile(2, () => {
    for (let f = 0; f < 6; f++) {
      const a = -Math.PI / 2 + (f - 2.5) * 0.35; const L = T * (0.6 + rnd() * 0.3);
      ctx.save(); ctx.translate(T / 2, T); ctx.rotate(a + Math.PI / 2);
      ctx.strokeStyle = '#3f6a22'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, -L); ctx.stroke();
      for (let k = 0; k < 18; k++) {
        const y = -L * (0.1 + k / 20); const ll = (1 - k / 20) * 22 + 4;
        ctx.fillStyle = k % 2 ? '#5a8a30' : '#6e9a3a';
        for (const s of [-1, 1]) { ctx.beginPath(); ctx.ellipse(s * ll * 0.5, y, ll * 0.5, 3.2, s * 0.35, 0, 7); ctx.fill(); }
      }
      ctx.restore();
    }
  });
  const flowerTile = (i, stemCol, fn, n) => tile(i, () => {
    for (let k = 0; k < 40; k++) blade(T * (0.1 + rnd() * 0.8), T * (0.2 + rnd() * 0.35), (rnd() - 0.5) * 30, 2, greens[Math.floor(rnd() * 6)]);
    for (let k = 0; k < n; k++) {
      const x = T * (0.12 + rnd() * 0.76), h = T * (0.3 + rnd() * 0.55);
      ctx.strokeStyle = stemCol; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.moveTo(x, T); ctx.quadraticCurveTo(x + (rnd() - 0.5) * 10, T - h / 2, x + (rnd() - 0.5) * 14, T - h); ctx.stroke();
      fn(x, T - h);
    }
  });
  flowerTile(3, '#4a7030', (x, y) => { // Virginia bluebells: nodding clusters
    for (let b = 0; b < 6; b++) { const bx = x + (rnd() - 0.5) * 16, by = y + rnd() * 16; ctx.fillStyle = rnd() < 0.3 ? '#d98ab8' : ['#5a7ad8', '#6b8ae0', '#7c9ae6'][Math.floor(rnd() * 3)]; ctx.beginPath(); ctx.ellipse(bx, by, 3.5, 6, 0.2, 0, 7); ctx.fill(); }
  }, 14);
  flowerTile(4, '#4f7a2a', (x, y) => { // daffodils
    ctx.fillStyle = '#f5e27a'; for (let p = 0; p < 6; p++) { ctx.beginPath(); ctx.ellipse(x + Math.cos(p) * 5, y + Math.sin(p) * 5, 5, 3, p, 0, 7); ctx.fill(); }
    ctx.fillStyle = '#f2a830'; ctx.beginPath(); ctx.arc(x, y, 3.5, 0, 7); ctx.fill();
  }, 12);
  flowerTile(5, '#4f7a2a', (x, y) => { // white spring beauties + violets
    const v = rnd() < 0.4; ctx.fillStyle = v ? '#7a4ab8' : '#f6f2f4';
    for (let p = 0; p < 5; p++) { ctx.beginPath(); ctx.ellipse(x + Math.cos(p * 1.256) * 3.5, y + Math.sin(p * 1.256) * 3.5, 3.5, 2.2, p * 1.256, 0, 7); ctx.fill(); }
    ctx.fillStyle = '#f0d060'; ctx.beginPath(); ctx.arc(x, y, 1.5, 0, 7); ctx.fill();
  }, 26);
  tile(6, () => {
    for (let k = 0; k < 40; k++) blade(T * (0.1 + rnd() * 0.8), T * (0.6 + rnd() * 0.4), (rnd() - 0.5) * 30, 2.4, ['#6a8a3a', '#7c9a44', '#587a2e'][Math.floor(rnd() * 3)]);
    for (let k = 0; k < 7; k++) { const x = T * (0.15 + rnd() * 0.7), y = T * (0.1 + rnd() * 0.25); ctx.strokeStyle = '#6a7a3a'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x, T); ctx.lineTo(x, y - 10); ctx.stroke(); ctx.fillStyle = '#5a3a24'; ctx.beginPath(); ctx.ellipse(x, y + 12, 5, 16, 0, 0, 7); ctx.fill(); }
  });
  tile(7, () => { for (let k = 0; k < 80; k++) blade(T * (0.1 + rnd() * 0.8), T * (0.5 + rnd() * 0.5), (rnd() - 0.5) * 70, 1.8 + rnd() * 1.5, ['#7a9a44', '#8aa850', '#9ab060', '#6a8a3a', '#b0b870'][Math.floor(rnd() * 5)]); });
  return { map: toTexture(c, { repeat: false }) };
}

export async function generateAll(onProgress, nextFrame) {
  const jobs = buildTextures();
  for (let i = 0; i < jobs.length; i++) {
    TEX[jobs[i][0]] = jobs[i][1]();
    onProgress((i + 1) / jobs.length);
    if (i % 2 === 1) await nextFrame();
  }
  return TEX;
}
