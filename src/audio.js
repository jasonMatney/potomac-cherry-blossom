// Synthesised soundscape: river flow, electric motor hum, distant traffic, rain, rolling thunder
import { Music } from './music.js';
import { Ambience } from './ambience.js';
export class Soundscape {
  constructor() { this.ctx = null; this.muted = false; this.started = false; this.pending = []; this.music = new Music(); }
  start() {
    if (this.started) return; this.started = true;
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    const ctx = this.ctx = new AC();
    const master = this.master = ctx.createGain(); master.gain.value = this.muted ? 0 : 0.9;
    const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -18; comp.ratio.value = 3;
    master.connect(comp); comp.connect(ctx.destination);
    const noiseBuf = (secs, type) => {
      const n = Math.floor(ctx.sampleRate * secs); const b = ctx.createBuffer(2, n, ctx.sampleRate);
      for (let c = 0; c < 2; c++) { const d = b.getChannelData(c); let last = 0, b0 = 0, b1 = 0, b2 = 0;
        for (let i = 0; i < n; i++) { const w = Math.random() * 2 - 1;
          if (type === 'brown') { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; }
          else if (type === 'pink') { b0 = 0.99765 * b0 + w * 0.099; b1 = 0.963 * b1 + w * 0.2965; b2 = 0.57 * b2 + w * 1.0527; d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.12; }
          else d[i] = w * 0.5; } }
      return b;
    };
    const loop = (buf) => { const s = ctx.createBufferSource(); s.buffer = buf; s.loop = true; s.start(ctx.currentTime + Math.random() * 0.1, Math.random() * buf.duration); return s; };
    const brown = noiseBuf(6, 'brown'), pink = noiseBuf(5, 'pink'), white = noiseBuf(3, 'white');
    // river: brown noise low + band of gurgle modulated
    { const g = ctx.createGain(); g.gain.value = 0.32; const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 520;
      loop(brown).connect(lp); lp.connect(g); g.connect(master);
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 900; bp.Q.value = 1.4; const g2 = ctx.createGain(); g2.gain.value = 0.05;
      loop(pink).connect(bp); bp.connect(g2); g2.connect(master);
      const lfo = ctx.createOscillator(); lfo.frequency.value = 0.23; const lg = ctx.createGain(); lg.gain.value = 380; lfo.connect(lg); lg.connect(bp.frequency); lfo.start();
      const lfo2 = ctx.createOscillator(); lfo2.frequency.value = 0.37; const lg2 = ctx.createGain(); lg2.gain.value = 0.03; lfo2.connect(lg2); lg2.connect(g2.gain); lfo2.start();
      this.river = g; this.gurgle = g2; }
    // hull slap / bow wash: filtered noise tied to speed
    { const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1400; bp.Q.value = 0.7; const g = ctx.createGain(); g.gain.value = 0;
      loop(white).connect(bp); bp.connect(g); g.connect(master); this.wash = g; }
    // electric motor: soft layered hum + faint whine
    { const g = ctx.createGain(); g.gain.value = 0; const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 700;
      const o1 = ctx.createOscillator(); o1.type = 'sine'; const o2 = ctx.createOscillator(); o2.type = 'triangle'; const o3 = ctx.createOscillator(); o3.type = 'sawtooth';
      const g3 = ctx.createGain(); g3.gain.value = 0.08;
      o1.connect(lp); o2.connect(lp); o3.connect(g3); g3.connect(lp); lp.connect(g); g.connect(master);
      const wh = ctx.createOscillator(); wh.type = 'sine'; const wg = ctx.createGain(); wg.gain.value = 0; wh.connect(wg); wg.connect(master);
      [o1, o2, o3, wh].forEach((o) => o.start());
      this.motor = { g, o1, o2, o3, wh, wg, lp }; }
    // distant city traffic
    { const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 260; const g = ctx.createGain(); g.gain.value = 0.1;
      loop(brown).connect(lp); lp.connect(g); g.connect(master);
      const hp = ctx.createBiquadFilter(); hp.type = 'bandpass'; hp.frequency.value = 650; hp.Q.value = 0.6; const g2 = ctx.createGain(); g2.gain.value = 0.012;
      loop(pink).connect(hp); hp.connect(g2); g2.connect(master);
      this.city = g; this.city2 = g2; }
    // rain
    { const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 900; const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 7000;
      const g = ctx.createGain(); g.gain.value = 0; loop(white).connect(hp); hp.connect(lp); lp.connect(g); g.connect(master);
      const lp2 = ctx.createBiquadFilter(); lp2.type = 'lowpass'; lp2.frequency.value = 400; const g2 = ctx.createGain(); g2.gain.value = 0; loop(pink).connect(lp2); lp2.connect(g2); g2.connect(master);
      this.rain = g; this.rainLow = g2; }
    this.brown = brown;
    this.music.attach(ctx, master);
    this.amb = new Ambience(ctx, master, pink);
    for (const p of this.pending) this.thunder(p.delay, p.dist);
    this.pending = [];
  }
  toggleMute() {
    this.muted = !this.muted;
    if (this.master) this.master.gain.setTargetAtTime(this.muted ? 0 : 0.9, this.ctx.currentTime, 0.15);
  }
  update(st) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime, k = 0.25;
    const thr = Math.abs(st.throttle);
    const f = 55 + thr * 70 + st.speed * 4;
    this.motor.o1.frequency.setTargetAtTime(f, t, k); this.motor.o2.frequency.setTargetAtTime(f * 2.005, t, k); this.motor.o3.frequency.setTargetAtTime(f * 3.01, t, k);
    this.motor.wh.frequency.setTargetAtTime(900 + thr * 1400, t, k);
    this.motor.g.gain.setTargetAtTime(0.045 + thr * 0.09, t, k); this.motor.wg.gain.setTargetAtTime(0.004 + thr * 0.008, t, k);
    this.wash.gain.setTargetAtTime(Math.min(0.12, st.speed * 0.016), t, k);
    this.river.gain.setTargetAtTime(0.26 + st.current * 0.12, t, 0.5);
    this.city.gain.setTargetAtTime(0.03 + 0.1 * st.city, t, 1); this.city2.gain.setTargetAtTime(0.004 + 0.014 * st.city * (1 - st.night * 0.5), t, 1);
    this.rain.gain.setTargetAtTime(st.rain * 0.22, t, 0.6); this.rainLow.gain.setTargetAtTime(st.rain * 0.1, t, 0.6);
  }
  ambient(dt, o) { if (this.amb && this.ctx.state === 'running') this.amb.update(dt, o); }
  // a soft two-note chime when a stop's moment is unlocked
  chime() {
    if (!this.ctx) return; const ctx = this.ctx, t0 = ctx.currentTime + 0.02;
    [[880, 0], [1318.5, 0.14], [1760, 0.28]].forEach(([f, dt]) => {
      const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f; const g = ctx.createGain();
      g.gain.setValueAtTime(0, t0 + dt); g.gain.linearRampToValueAtTime(0.09, t0 + dt + 0.01); g.gain.setTargetAtTime(0, t0 + dt + 0.02, 0.35);
      o.connect(g); g.connect(this.master); o.start(t0 + dt); o.stop(t0 + dt + 2);
    });
  }
  // a footstep: softer thud on grass/stone, hollow knock on wooden docks
  step(v = 0.6, wood = false) {
    if (!this.ctx) return; const ctx = this.ctx, t0 = ctx.currentTime;
    const src = ctx.createBufferSource(); src.buffer = this.brown; src.playbackRate.value = wood ? 1.6 : 2.4;
    const f = ctx.createBiquadFilter(); f.type = wood ? 'bandpass' : 'lowpass'; f.frequency.value = wood ? 380 + Math.random() * 60 : 900 + Math.random() * 300; f.Q.value = wood ? 4 : 0.7;
    const g = ctx.createGain(); g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(0.16 * v * (wood ? 1.4 : 1), t0 + 0.008); g.gain.setTargetAtTime(0, t0 + 0.02, wood ? 0.05 : 0.035);
    src.connect(f); f.connect(g); g.connect(this.master); src.start(t0, Math.random() * 4); src.stop(t0 + 0.3);
  }
  thunder(delay, dist) {
    if (!this.ctx) { if (this.started === false) this.pending.length < 2 && this.pending.push({ delay, dist }); return; }
    const ctx = this.ctx; const t0 = ctx.currentTime + delay;
    const src = ctx.createBufferSource(); src.buffer = this.brown; src.playbackRate.value = 0.6 + Math.random() * 0.2;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 220 + 900 / (1 + dist / 400);
    const g = ctx.createGain(); g.gain.value = 0;
    const loud = 0.9 / (1 + dist / 900);
    g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(loud * 0.6, t0 + 0.08);
    // rolling rumbles
    let tt = t0 + 0.1; for (let i = 0; i < 6; i++) { tt += 0.3 + Math.random() * 0.7; g.gain.linearRampToValueAtTime(loud * (0.3 + Math.random() * 0.7) * Math.exp(-i * 0.35), tt); }
    g.gain.exponentialRampToValueAtTime(0.0001, tt + 2.5);
    src.connect(lp); lp.connect(g); g.connect(this.master);
    src.start(t0, Math.random() * 3); src.stop(tt + 2.6);
  }
}
