// The view through the balcony telescope: a round eyepiece field that drifts across a deep night sky, the
// Milky Way, and pauses on the Moon, Saturn and Jupiter. Drawn on a 2D canvas over the scene; everything is
// procedural (seeded), and the heavy layers are painted once and then just panned.
import { mulberry32 } from './util.js';

const TAU = Math.PI * 2;
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

export class SkyView {
  constructor() {
    this.cv = document.createElement('canvas');
    Object.assign(this.cv.style, { position: 'fixed', inset: '0', width: '100%', height: '100%', zIndex: 30, pointerEvents: 'none', opacity: '0', display: 'none', background: '#000' });
    document.body.appendChild(this.cv);
    this.g = this.cv.getContext('2d');
    this.on = false; this.t = 0; this.pano = null;
  }
  // panorama: a long strip of sky, FIELD-sized stops for the Moon, Saturn and Jupiter along it
  build(R) {
    const W = Math.round(R * 2 * 6.2), H = Math.round(R * 2 * 1.5);
    const c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d');
    const r = mulberry32(4242);
    g.fillStyle = '#01030a'; g.fillRect(0, 0, W, H);
    // Milky Way: a diagonal band of soft clouds with dark dust lanes, then its dense faint stars
    const band = (x) => H * 0.5 + Math.sin(x / W * 5.2) * H * 0.22 + (x / W - 0.5) * H * 0.18;
    for (let i = 0; i < 1400; i++) {
      const x = r() * W, y = band(x) + (r() + r() + r() - 1.5) * H * 0.2, rad = R * (0.08 + r() * 0.28);
      const gr = g.createRadialGradient(x, y, 0, x, y, rad); const warm = r();
      gr.addColorStop(0, `rgba(${170 + warm * 60 | 0},${160 + warm * 30 | 0},${200 - warm * 40 | 0},${0.035 + r() * 0.03})`); gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gr; g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
    }
    g.globalCompositeOperation = 'multiply';
    for (let i = 0; i < 420; i++) {
      const x = r() * W, y = band(x) + (r() - 0.5) * H * 0.12, rad = R * (0.04 + r() * 0.12);
      const gr = g.createRadialGradient(x, y, 0, x, y, rad); gr.addColorStop(0, 'rgba(20,14,12,0.55)'); gr.addColorStop(1, 'rgba(255,255,255,1)');
      g.fillStyle = gr; g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
    }
    g.globalCompositeOperation = 'source-over';
    const star = (x, y, m) => {
      const t = r(); const col = t < 0.15 ? [255, 190, 150] : t < 0.3 ? [255, 230, 190] : t < 0.8 ? [235, 240, 255] : [180, 205, 255];
      const s = Math.max(0.35, (1.4 - m) * R * 0.004 + 0.4); const a = Math.min(1, 0.25 + (1.6 - m) * 0.5);
      if (s > 1.4) { const gr = g.createRadialGradient(x, y, 0, x, y, s * 4); gr.addColorStop(0, `rgba(${col},${a * 0.5})`); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(x - s * 4, y - s * 4, s * 8, s * 8); }
      g.fillStyle = `rgba(${col},${a})`; g.beginPath(); g.arc(x, y, s, 0, TAU); g.fill();
    };
    for (let i = 0; i < 9000; i++) { const x = r() * W; const inBand = r() < 0.6; const y = inBand ? band(x) + (r() + r() - 1) * H * 0.18 : r() * H; star(x, y, 0.6 + Math.pow(r(), 0.35) * 1.0); }
    this.bright = []; for (let i = 0; i < 70; i++) this.bright.push({ x: r() * W, y: r() * H, m: r(), c: r() < 0.3 ? '255,200,160' : r() < 0.5 ? '190,210,255' : '245,245,255', ph: r() * 10 });
    // stops along the strip (panorama x of each object's centre)
    this.stops = [R * 2 * 1.6, R * 2 * 3.2, R * 2 * 4.7];
    this.pano = { c, W, H, R };
    this.moonImg = this.paintMoon(R * 0.86, r);
    this.satImg = this.paintSaturn(R * 0.5);
    this.jupImg = this.paintJupiter(R * 0.36, r);
  }
  paintMoon(rad, r) {
    const S = Math.ceil(rad * 2.2), c = document.createElement('canvas'); c.width = c.height = S; const g = c.getContext('2d'); const o = S / 2;
    g.save(); g.beginPath(); g.arc(o, o, rad, 0, TAU); g.clip();
    const base = g.createRadialGradient(o - rad * 0.3, o - rad * 0.3, rad * 0.1, o, o, rad); base.addColorStop(0, '#e9e5da'); base.addColorStop(1, '#a9a498'); g.fillStyle = base; g.fillRect(0, 0, S, S);
    // maria
    for (const [mx, my, mr] of [[-0.25, -0.2, 0.32], [0.1, -0.35, 0.22], [0.25, 0.05, 0.28], [-0.05, 0.25, 0.2], [-0.4, 0.2, 0.18], [0.35, -0.3, 0.14]]) {
      const x = o + mx * rad, y = o + my * rad, rr = mr * rad; const gr = g.createRadialGradient(x, y, 0, x, y, rr); gr.addColorStop(0, 'rgba(70,72,78,0.55)'); gr.addColorStop(0.7, 'rgba(80,82,88,0.35)'); gr.addColorStop(1, 'rgba(80,82,88,0)'); g.fillStyle = gr; g.fillRect(x - rr, y - rr, rr * 2, rr * 2);
    }
    // craters: shadowed bowls with a lit rim toward the sun (from the right)
    for (let i = 0; i < 260; i++) {
      const a = r() * TAU, d = Math.sqrt(r()) * rad * 0.97, cr = rad * (0.008 + Math.pow(r(), 3) * 0.09);
      const x = o + Math.cos(a) * d, y = o + Math.sin(a) * d;
      g.fillStyle = 'rgba(60,58,55,0.35)'; g.beginPath(); g.arc(x - cr * 0.15, y, cr, 0, TAU); g.fill();
      g.strokeStyle = 'rgba(255,252,240,0.35)'; g.lineWidth = Math.max(0.6, cr * 0.18); g.beginPath(); g.arc(x, y, cr, -1.2, 1.2); g.stroke();
      if (cr > rad * 0.05 && r() < 0.5) { g.strokeStyle = 'rgba(240,238,230,0.12)'; g.lineWidth = 1; for (let k = 0; k < 12; k++) { const ra = r() * TAU; g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(ra) * cr * (3 + r() * 5), y + Math.sin(ra) * cr * (3 + r() * 5)); g.stroke(); } }
    }
    // terminator: a waxing gibbous, the left edge in shadow
    const tg = g.createLinearGradient(o - rad, 0, o - rad * 0.35, 0); tg.addColorStop(0, 'rgba(0,0,0,0.97)'); tg.addColorStop(0.7, 'rgba(0,0,0,0.6)'); tg.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = tg; g.beginPath(); g.ellipse(o - rad * 0.6, o, rad * 0.62, rad * 1.05, 0, 0, TAU); g.fill();
    g.restore();
    return c;
  }
  paintSaturn(rad) {
    const S = Math.ceil(rad * 5.2), c = document.createElement('canvas'); c.width = S; c.height = Math.ceil(rad * 3); const g = c.getContext('2d'); const ox = S / 2, oy = c.height / 2;
    const tilt = -0.42, ry = 0.36;
    const rings = (front) => {
      for (const [a, b, col] of [[1.25, 1.52, 'rgba(200,180,140,0.55)'], [1.55, 1.95, 'rgba(236,218,178,0.9)'], [2.0, 2.28, 'rgba(210,192,152,0.75)'], [2.3, 2.38, 'rgba(180,165,130,0.4)']]) {
        g.save(); g.translate(ox, oy); g.rotate(tilt); g.beginPath();
        g.ellipse(0, 0, rad * b, rad * b * ry, 0, front ? 0 : Math.PI, front ? Math.PI : TAU); g.ellipse(0, 0, rad * a, rad * a * ry, 0, front ? Math.PI : TAU, front ? 0 : Math.PI, true);
        g.fillStyle = col; g.fill(); g.restore();
      }
    };
    rings(false);
    g.save(); g.beginPath(); g.arc(ox, oy, rad, 0, TAU); g.clip();
    const body = g.createRadialGradient(ox - rad * 0.35, oy - rad * 0.35, rad * 0.1, ox, oy, rad * 1.05); body.addColorStop(0, '#f1dfb0'); body.addColorStop(1, '#8a6e44'); g.fillStyle = body; g.fillRect(0, 0, S, c.height);
    g.translate(ox, oy); g.rotate(tilt);
    for (const [y, h, a] of [[-0.55, 0.12, 0.25], [-0.2, 0.18, 0.18], [0.15, 0.1, 0.22], [0.45, 0.14, 0.2]]) { g.fillStyle = `rgba(120,90,50,${a})`; g.fillRect(-rad, y * rad, rad * 2, h * rad); }
    g.restore();
    // ring shadow on the globe and the globe's shadow on the rings
    g.save(); g.translate(ox, oy); g.rotate(tilt); g.fillStyle = 'rgba(0,0,0,0.35)'; g.beginPath(); g.ellipse(0, rad * 0.08, rad * 1.55, rad * 0.06, 0, 0, TAU); g.fill(); g.restore();
    rings(true);
    return c;
  }
  paintJupiter(rad, r) {
    const S = Math.ceil(rad * 12), c = document.createElement('canvas'); c.width = S; c.height = Math.ceil(rad * 2.6); const g = c.getContext('2d'); const ox = S / 2, oy = c.height / 2;
    g.save(); g.beginPath(); g.arc(ox, oy, rad, 0, TAU); g.clip();
    g.fillStyle = '#e8d8c0'; g.fillRect(0, 0, S, c.height);
    for (const [y, h, col] of [[-0.8, 0.25, '#b89878'], [-0.45, 0.2, '#a8805e'], [-0.12, 0.1, '#d8c2a2'], [0.1, 0.22, '#9e7452'], [0.45, 0.14, '#b89a7a'], [0.75, 0.3, '#c8b096']]) {
      g.fillStyle = col; g.beginPath(); g.moveTo(ox - rad, oy + y * rad);
      for (let x = -1; x <= 1.001; x += 0.05) g.lineTo(ox + x * rad, oy + (y + Math.sin(x * 9 + y * 7) * 0.02) * rad);
      for (let x = 1; x >= -1.001; x -= 0.05) g.lineTo(ox + x * rad, oy + (y + h + Math.sin(x * 7 + y * 5) * 0.02) * rad);
      g.fill();
    }
    g.fillStyle = 'rgba(178,86,60,0.85)'; g.beginPath(); g.ellipse(ox + rad * 0.3, oy + rad * 0.3, rad * 0.16, rad * 0.09, 0, 0, TAU); g.fill();
    const limb = g.createRadialGradient(ox, oy, rad * 0.55, ox, oy, rad); limb.addColorStop(0, 'rgba(0,0,0,0)'); limb.addColorStop(1, 'rgba(40,25,15,0.55)'); g.fillStyle = limb; g.fillRect(0, 0, S, c.height);
    g.restore();
    // the four Galilean moons strung out along the equator
    for (const d of [-4.6, -2.5, 1.9, 3.7]) { g.fillStyle = '#f4efe6'; g.beginPath(); g.arc(ox + d * rad, oy + d * rad * 0.02, Math.max(1.2, rad * 0.045), 0, TAU); g.fill(); }
    return c;
  }
  resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1); const w = Math.round(innerWidth * dpr), h = Math.round(innerHeight * dpr);
    if (this.cv.width !== w || this.cv.height !== h) { this.cv.width = w; this.cv.height = h; }
    this.R = Math.round(Math.min(w, h) * 0.44);
    const R0 = Math.min(this.R, 400); // the panorama is painted at a capped size (Safari limits canvas area) and scaled up
    if (!this.pano || this.pano.R !== R0) this.build(R0);
  }
  start() { this.on = true; this.t = 0; this.cv.style.display = 'block'; this.resize(); }
  stop() { this.on = false; this.cv.style.display = 'none'; this.cv.style.opacity = '0'; }
  // k: 0..1 visibility (drives the fade); dt advances the drift
  update(dt, k) {
    if (!this.on) return;
    this.t += dt; this.cv.style.opacity = String(k);
    const { g, cv } = this; const w = cv.width, h = cv.height; const P = this.pano; const R = P.R; const t = this.t; const RS = this.R, f = RS / R;
    // drift: ease toward each object, linger, move on
    const hold = [[0, 0], [2.0, this.stops[0]], [5.2, this.stops[0] + R * 0.08], [6.6, this.stops[1]], [9.6, this.stops[1] + R * 0.06], [11.0, this.stops[2]], [99, this.stops[2] + R * 1.6]];
    let px = 0; for (let i = 0; i < hold.length - 1; i++) { const [t0, x0] = hold[i], [t1, x1] = hold[i + 1]; if (t >= t0 && t <= t1) { px = x0 + (x1 - x0) * smooth(0, 1, (t - t0) / (t1 - t0)); break; } }
    const py = P.H / 2 + Math.sin(t * 0.13) * R * 0.05;
    g.setTransform(1, 0, 0, 1, 0, 0); g.fillStyle = '#000'; g.fillRect(0, 0, w, h);
    g.save(); g.beginPath(); g.arc(w / 2, h / 2, RS, 0, TAU); g.clip();
    g.translate(w / 2, h / 2); g.scale(f, f); const cx = 0, cy = 0;
    // focus pull as the eye settles, then a faint atmospheric shimmer
    const blur = Math.max(0, 6 * (1 - smooth(0.2, 1.6, t))); g.filter = blur > 0.2 ? `blur(${blur.toFixed(1)}px)` : 'none';
    const sx = cx - px, sy = cy - py;
    { const x0 = Math.max(0, -sx - R * 1.1), y0 = Math.max(0, -sy - R * 1.1), ww = Math.min(P.W - x0, R * 2.2), hh = Math.min(P.H - y0, R * 2.2); if (ww > 0 && hh > 0) g.drawImage(P.c, x0, y0, ww, hh, sx + x0, sy + y0, ww, hh); }
    const sh = Math.sin(t * 7.3) * 0.6;
    for (const b of this.bright) { const x = sx + b.x, y = sy + b.y; if (Math.abs(x) > R + 20 || Math.abs(y) > R + 20) continue; const tw = 0.7 + 0.3 * Math.sin(t * 9 + b.ph * 7); const s = (1.5 + b.m * 2.2) * tw; const gr = g.createRadialGradient(x, y, 0, x, y, s * 5); gr.addColorStop(0, `rgba(${b.c},${0.9 * tw})`); gr.addColorStop(0.2, `rgba(${b.c},${0.35 * tw})`); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(x - s * 5, y - s * 5, s * 10, s * 10); }
    const put = (img, x) => { const X = sx + x - img.width / 2 + sh, Y = sy + P.H / 2 - img.height / 2; if (X > R * 1.2 || X + img.width < -R * 1.2) return; g.drawImage(img, X, Y); };
    // earthshine glow round the Moon
    { const mx = sx + this.stops[0], my = sy + P.H / 2; const gr = g.createRadialGradient(mx, my, R * 0.8, mx, my, R * 1.5); gr.addColorStop(0, 'rgba(200,205,215,0.18)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(mx - R * 1.6, my - R * 1.6, R * 3.2, R * 3.2); }
    put(this.moonImg, this.stops[0]); put(this.satImg, this.stops[1]); put(this.jupImg, this.stops[2]);
    g.filter = 'none';
    // eyepiece: soft vignette, a faint coloured edge ring
    const vg = g.createRadialGradient(cx, cy, R * 0.72, cx, cy, R); vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(0.9, 'rgba(0,0,0,0.55)'); vg.addColorStop(1, 'rgba(0,0,0,1)'); g.fillStyle = vg; g.fillRect(cx - R, cy - R, R * 2, R * 2);
    g.restore();
    g.strokeStyle = 'rgba(120,140,190,0.12)'; g.lineWidth = Math.max(1, RS * 0.006); g.beginPath(); g.arc(w / 2, h / 2, RS * 0.995, 0, TAU); g.stroke();
  }
}
