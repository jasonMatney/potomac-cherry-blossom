// The living soundscape around the river, all synthesised: songbirds by time of day, mallards and geese,
// gulls, spring peepers after dark, wind in the trees, oars and oarlocks, a murmur of people on the
// Georgetown waterfront, water lapping at the docks, church bells on the hour, and the sounds of home.
const rr = (a, b) => a + Math.random() * (b - a);
const pick = (a) => a[Math.floor(Math.random() * a.length)];

export class Ambience {
  constructor(ctx, dest, noise) {
    this.ctx = ctx; this.noise = noise;
    this.bus = ctx.createGain(); this.bus.gain.value = 0.9; this.bus.connect(dest);
    this.cam = { x: 0, z: 0, yaw: 0 };
    this.lastHour = -1; this.acc = { bird: 0, gull: 0, peep: 0, lap: 0 };
    // continuous beds
    const bed = (type, f, q, g0) => { const s = ctx.createBufferSource(); s.buffer = noise; s.loop = true; const b = ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; const g = ctx.createGain(); g.gain.value = g0; s.connect(b); b.connect(g); g.connect(this.bus); s.start(0, Math.random() * noise.duration); return { g, b }; };
    this.wind = bed('bandpass', 900, 0.7, 0); this.leaves = bed('bandpass', 3600, 1.2, 0);
    // babble: speech-band noise with a syllable-rate flutter
    this.crowd = bed('bandpass', 700, 0.8, 0);
    const lfo = ctx.createOscillator(); lfo.frequency.value = 4.6; const lg = ctx.createGain(); lg.gain.value = 0; lfo.connect(lg); lg.connect(this.crowd.g.gain); lfo.start(); this.crowdL = lg;
    const lfo2 = ctx.createOscillator(); lfo2.frequency.value = 0.37; const lg2 = ctx.createGain(); lg2.gain.value = 300; lfo2.connect(lg2); lg2.connect(this.crowd.b.frequency); lfo2.start();
    // home: fire crackle bed and TV
    this.fire = bed('lowpass', 520, 0.5, 0);
    this.tv = { g: ctx.createGain() }; this.tv.g.gain.value = 0; this.tv.g.connect(this.bus); this.tvOn = false; this.tvT = 0;
    this.purr = null;
  }
  // stereo placement + distance falloff for a sound at world (x, z)
  place(x, z, ref = 25) {
    const ctx = this.ctx; const dx = x - this.cam.x, dz = z - this.cam.z; const d = Math.hypot(dx, dz);
    const ang = Math.atan2(dx, -dz) - this.cam.yaw; const p = ctx.createStereoPanner(); p.pan.value = Math.max(-0.95, Math.min(0.95, Math.sin(ang)));
    const g = ctx.createGain(); g.gain.value = 1 / (1 + (d / ref) * (d / ref)); g.connect(p); p.connect(this.bus);
    return { node: g, d };
  }
  tone(out, t, dur, fA, fB, amp, type = 'sine', curve = 'exp') {
    const ctx = this.ctx, o = ctx.createOscillator(), g = ctx.createGain(); o.type = type;
    o.frequency.setValueAtTime(fA, t);
    if (curve === 'exp') o.frequency.exponentialRampToValueAtTime(Math.max(20, fB), t + dur); else o.frequency.linearRampToValueAtTime(fB, t + dur);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(amp, t + Math.min(0.02, dur * 0.2)); g.gain.setTargetAtTime(0, t + dur * 0.7, dur * 0.15);
    o.connect(g); g.connect(out); o.start(t); o.stop(t + dur + 0.3); return { o, g };
  }
  burst(out, t, dur, f, q, amp, type = 'bandpass') {
    const ctx = this.ctx, s = ctx.createBufferSource(); s.buffer = this.noise; const b = ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q;
    const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(amp, t + 0.006); g.gain.setTargetAtTime(0, t + 0.01, dur / 3);
    s.connect(b); b.connect(g); g.connect(out); s.start(t, Math.random() * 3); s.stop(t + dur + 0.2);
  }
  // ---------------------------------------------------------------- birds
  songbird(x, z, hour) {
    const { node: out, d } = this.place(x, z, 30); if (d > 160) return;
    const t = this.ctx.currentTime + rr(0.02, 0.3);
    const morning = hour < 9.5;
    const sp = pick(morning ? ['robin', 'robin', 'cardinal', 'chickadee', 'sparrow', 'dove', 'blackbird', 'wren'] : ['robin', 'cardinal', 'chickadee', 'sparrow', 'blackbird', 'wren', 'drum']);
    const A = 0.05;
    if (sp === 'robin') { let tt = t; const n = 3 + Math.floor(Math.random() * 3); for (let i = 0; i < n; i++) { const f = rr(2100, 3100); this.tone(out, tt, rr(0.12, 0.2), f, f * rr(0.8, 1.2), A); tt += rr(0.22, 0.32); } }
    else if (sp === 'cardinal') { let tt = t; const n = 4 + Math.floor(Math.random() * 3); const up = Math.random() < 0.4; for (let i = 0; i < n; i++) { this.tone(out, tt, 0.16, up ? 1900 : 3700, up ? 3600 : 1800, A * 0.9); tt += 0.24; } }
    else if (sp === 'chickadee') { this.tone(out, t, 0.32, 3950, 3900, A * 0.7, 'sine', 'lin'); this.tone(out, t + 0.4, 0.38, 3350, 3300, A * 0.7, 'sine', 'lin'); }
    else if (sp === 'sparrow') { let tt = t; for (let i = 0; i < 3; i++) { this.tone(out, tt, 0.08, 4200, 4000, A * 0.7); tt += 0.14; } for (let i = 0; i < 12; i++) { this.tone(out, tt, 0.035, rr(3000, 5200), rr(2800, 4800), A * 0.5); tt += 0.045; } }
    else if (sp === 'dove') { const o = this.tone(out, t, 0.5, 480, 560, A * 1.2, 'sine', 'lin'); this.tone(out, t + 0.55, 0.6, 560, 470, A * 1.3, 'sine', 'lin'); this.tone(out, t + 1.3, 0.5, 480, 460, A, 'sine', 'lin'); this.tone(out, t + 1.95, 0.5, 480, 460, A * 0.9, 'sine', 'lin'); }
    else if (sp === 'blackbird') { this.tone(out, t, 0.1, 2000, 2600, A * 0.8); let tt = t + 0.14; for (let i = 0; i < 10; i++) { this.tone(out, tt, 0.05, 3800 + (i % 2) * 900, 3600, A * 0.55, 'triangle'); tt += 0.05; } }
    else if (sp === 'wren') { let tt = t; const base = rr(3200, 4200); for (let i = 0; i < 16; i++) { this.tone(out, tt, 0.04, base + Math.sin(i * 1.7) * 700, base * 0.9, A * 0.5); tt += 0.055; } }
    else if (sp === 'drum') { let tt = t; for (let i = 0; i < 18; i++) { this.burst(out, tt, 0.03, 1400, 2.5, 0.12); tt += 0.055 + i * 0.001; } }
  }
  quack(x, z, goose, alarm) {
    const { node: out, d } = this.place(x, z, 18); if (d > 140) return;
    const ctx = this.ctx; let t = ctx.currentTime + rr(0, 0.2);
    const n = goose ? 1 + Math.floor(Math.random() * 3 + alarm * 3) : 2 + Math.floor(Math.random() * 3 + alarm * 2);
    for (let i = 0; i < n; i++) {
      const o = ctx.createOscillator(); o.type = 'sawtooth';
      const f0 = goose ? rr(330, 380) : rr(360, 430) * (1 - i * 0.04);
      const dur = goose ? 0.24 : 0.15;
      o.frequency.setValueAtTime(f0 * (goose ? 0.85 : 1.05), t); o.frequency.linearRampToValueAtTime(f0 * (goose ? 1.25 : 0.9), t + dur * 0.5); o.frequency.linearRampToValueAtTime(f0 * (goose ? 0.9 : 0.8), t + dur);
      const b1 = ctx.createBiquadFilter(); b1.type = 'bandpass'; b1.frequency.value = goose ? 900 : 1150; b1.Q.value = 3;
      const b2 = ctx.createBiquadFilter(); b2.type = 'bandpass'; b2.frequency.value = goose ? 2200 : 2500; b2.Q.value = 4;
      const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(goose ? 0.22 : 0.16, t + 0.015); g.gain.setTargetAtTime(0, t + dur * 0.6, dur * 0.2);
      o.connect(b1); o.connect(b2); b1.connect(g); b2.connect(g); g.connect(out); o.start(t); o.stop(t + dur + 0.2);
      t += goose ? rr(0.35, 0.6) : rr(0.18, 0.26);
    }
  }
  gull(x, z) {
    const { node: out, d } = this.place(x, z, 40); if (d > 250) return;
    let t = this.ctx.currentTime; const n = 1 + Math.floor(Math.random() * 3);
    for (let i = 0; i < n; i++) { const { o } = this.tone(out, t, 0.38, rr(1800, 2100), rr(1050, 1250), 0.045, 'triangle'); const v = this.ctx.createOscillator(); v.frequency.value = 13; const vg = this.ctx.createGain(); vg.gain.value = 40; v.connect(vg); vg.connect(o.frequency); v.start(t); v.stop(t + 0.5); t += rr(0.45, 0.6); }
  }
  peeper(x, z) {
    const { node: out, d } = this.place(x, z, 20); if (d > 120) return;
    const t = this.ctx.currentTime + rr(0, 0.25); const f = rr(2650, 2950);
    this.tone(out, t, 0.09, f, f * 1.12, 0.03, 'sine', 'lin');
  }
  lap(x, z) { const { node: out } = this.place(x, z, 8); this.burst(out, this.ctx.currentTime, rr(0.12, 0.25), rr(250, 650), 1.2, rr(0.05, 0.12), 'lowpass'); }
  oar(x, z) { const { node: out, d } = this.place(x, z, 20); if (d > 110) return; const t = this.ctx.currentTime; this.burst(out, t, 0.18, 1300, 1.2, 0.15); this.burst(out, t + 0.02, 0.05, 320, 6, 0.1); }
  bell(n) {
    const out = this.bus; let t = this.ctx.currentTime + 0.1;
    for (let i = 0; i < n; i++) {
      for (const [r, a] of [[1, 0.035], [2.0, 0.012], [2.76, 0.01], [5.4, 0.005]]) { const o = this.ctx.createOscillator(); o.frequency.value = 196 * r; const g = this.ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(a, t + 0.01); g.gain.setTargetAtTime(0, t + 0.02, 1.4 / r); const lp = this.ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1400; o.connect(g); g.connect(lp); lp.connect(out); o.start(t); o.stop(t + 6); }
      t += 2.2;
    }
  }
  meow(x, z) {
    const { node: out } = this.place(x, z, 6); const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.setValueAtTime(520, t); o.frequency.linearRampToValueAtTime(780, t + 0.25); o.frequency.linearRampToValueAtTime(560, t + 0.6);
    const b = ctx.createBiquadFilter(); b.type = 'bandpass'; b.Q.value = 5; b.frequency.setValueAtTime(700, t); b.frequency.linearRampToValueAtTime(1600, t + 0.25); b.frequency.linearRampToValueAtTime(900, t + 0.6);
    const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.12, t + 0.05); g.gain.setTargetAtTime(0, t + 0.45, 0.08);
    o.connect(b); b.connect(g); g.connect(out); o.start(t); o.stop(t + 1);
  }
  setPurr(on, x, z) {
    const ctx = this.ctx;
    if (on && !this.purr) {
      const s = ctx.createBufferSource(); s.buffer = this.noise; s.loop = true; const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 160;
      const am = ctx.createGain(); am.gain.value = 0; const lfo = ctx.createOscillator(); lfo.frequency.value = 24; const lg = ctx.createGain(); lg.gain.value = 0.5; lfo.connect(lg); lg.connect(am.gain);
      const g = ctx.createGain(); g.gain.value = 0; s.connect(lp); lp.connect(am); am.connect(g); g.connect(this.bus); s.start(); lfo.start();
      g.gain.setTargetAtTime(0.5, ctx.currentTime, 0.4); this.purr = { s, lfo, g };
    } else if (!on && this.purr) { const p = this.purr; p.g.gain.setTargetAtTime(0, ctx.currentTime, 0.3); setTimeout(() => { p.s.stop(); p.lfo.stop(); }, 1500); this.purr = null; }
  }
  // a muffled TV: a soft broadcast melody with voice-like noise underneath
  tvTick(dt) {
    if (!this.tvOn) return; this.tvT -= dt;
    if (this.tvT <= 0) {
      this.tvT = rr(0.18, 0.35); const t = this.ctx.currentTime;
      const out = this.tv.g;
      if (Math.random() < 0.6) this.burst(out, t, rr(0.12, 0.3), rr(500, 1100), 2.5, 0.06);
      if (Math.random() < 0.35) this.tone(out, t, rr(0.2, 0.4), pick([392, 440, 494, 523, 587, 659]), 0, 0.02, 'triangle', 'lin');
    }
  }
  update(dt, o) {
    const ctx = this.ctx, t = ctx.currentTime;
    this.cam = o.cam;
    const day = o.day, night = o.night, rain = o.rain, storm = o.storm;
    // wind in the trees (stronger with gusts and the storm)
    const gust = 0.5 + 0.5 * Math.sin(t * 0.13) * Math.sin(t * 0.071 + 1);
    this.wind.g.gain.setTargetAtTime((0.02 + gust * 0.03 + storm * 0.12) * o.trees, t, 0.8);
    this.leaves.g.gain.setTargetAtTime((0.004 + gust * 0.008 + storm * 0.03) * o.trees * (1 - night * 0.5), t, 0.8);
    this.wind.b.frequency.setTargetAtTime(700 + gust * 500 + storm * 300, t, 1);
    // waterfront crowd
    const cr = o.crowd * day * (1 - rain * 0.8);
    this.crowd.g.gain.setTargetAtTime(cr * 0.012, t, 1); this.crowdL.gain.setTargetAtTime(cr * 0.008, t, 1);
    // birdsong: busiest in the morning, quiet in rain and at night
    const morning = Math.max(0, 1 - Math.abs(o.hour - 7.2) / 3);
    this.acc.bird += dt * day * (0.35 + morning * 1.1) * (1 - rain * 0.85) * o.trees;
    while (this.acc.bird > 1) { this.acc.bird -= rr(0.6, 1.4); const a = Math.random() * 6.28, r = rr(18, 70); const [bx, bz] = o.bankPoint(a, r); this.songbird(bx, bz, o.hour); }
    // waterfowl
    for (const f of o.flocks) { if (f.dist > 150) continue; if (Math.random() < dt * (0.05 + f.alarm * 0.9)) this.quack(f.x, f.z, f.goose && Math.random() < f.goose + 0.2, f.alarm); }
    // gulls wheeling over the river
    this.acc.gull += dt * o.gulls * 0.08; while (this.acc.gull > 1) { this.acc.gull -= rr(0.7, 1.5); this.gull(o.cam.x + rr(-60, 60), o.cam.z + rr(-60, 60)); }
    // spring peepers after dark near the banks
    this.acc.peep += dt * night * (1 - rain * 0.6) * 14 * o.trees;
    while (this.acc.peep > 1) { this.acc.peep -= 1; const a = Math.random() * 6.28; const [px, pz] = o.bankPoint(a, rr(15, 60)); this.peeper(px, pz); }
    // water lapping when stopped by a dock or walking along the water
    this.acc.lap += dt * o.lap * 1.4; while (this.acc.lap > 1) { this.acc.lap -= rr(0.5, 1.5); this.lap(o.lapAt.x + rr(-2, 2), o.lapAt.z + rr(-2, 2)); }
    // oars
    for (const sh of o.shells) if (sh.catch) this.oar(sh.x, sh.z);
    // church bells across Georgetown on the hour
    const h = Math.floor(o.hour);
    if (h !== this.lastHour) { if (this.lastHour >= 0 && h >= 7 && h <= 21 && o.hourSpeed < 5) this.bell(((h + 11) % 12) + 1); this.lastHour = h; }
    // home
    const fd = o.fire ? Math.hypot(o.fire.x - o.cam.x, o.fire.z - o.cam.z) : 1e9;
    this.fire.g.gain.setTargetAtTime(o.fire && o.fire.on ? 0.05 / (1 + (fd / 6) ** 2) : 0, t, 0.5);
    if (o.fire && o.fire.on && fd < 25 && Math.random() < dt * 4) { const { node } = this.place(o.fire.x, o.fire.z, 5); this.burst(node, t, 0.02, rr(1500, 4000), 2, rr(0.04, 0.12)); }
    this.tvOn = !!(o.tv && o.tv.on);
    const tvd = o.tv ? Math.hypot(o.tv.x - o.cam.x, o.tv.z - o.cam.z) : 1e9;
    this.tv.g.gain.setTargetAtTime(this.tvOn ? 0.9 / (1 + (tvd / 6) ** 2) : 0, t, 0.3);
    this.tvTick(dt);
  }
}
