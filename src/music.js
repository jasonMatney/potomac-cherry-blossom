// Six original pieces, synthesised live with WebAudio. A tiny look-ahead scheduler queues notes
// ~0.3 s ahead on a timer, so the music costs nothing on the render loop.
const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

// ----------------------------------------------------------------- instruments
function env(ctx, g, t, a, peak, d, sustain = 0, dur = 0, r = 0.3) {
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(peak, t + a);
  if (dur > 0) { g.gain.setTargetAtTime(peak * sustain, t + a, d / 3); g.gain.setTargetAtTime(0, t + a + dur, r / 3); return t + a + dur + r * 2; }
  g.gain.setTargetAtTime(0, t + a, d / 4); return t + a + d * 1.6;
}
class Synth {
  constructor(ctx, out, verb) { this.ctx = ctx; this.out = out; this.verb = verb; this.noise = null; }
  node(dest, wet) {
    const g = this.ctx.createGain(); g.connect(dest || this.out);
    if (wet) { const s = this.ctx.createGain(); s.gain.value = wet; g.connect(s); s.connect(this.verb); }
    return g;
  }
  osc(type, f, t, end, dest, detune = 0) { const o = this.ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(f, t); o.detune.value = detune; o.connect(dest); o.start(t); o.stop(end); return o; }
  piano(t, m, v = 0.5, wet = 0.35, bright = 1) {
    const f = mtof(m), dec = Math.max(0.6, 3.2 - (m - 48) * 0.05);
    const lp = this.ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 0.3;
    lp.frequency.setValueAtTime(Math.min(9000, f * 9 * bright), t); lp.frequency.setTargetAtTime(f * 2.2, t + 0.02, dec * 0.3);
    const g = this.node(null, wet); lp.connect(g);
    const end = env(this.ctx, g, t, 0.004, v * 0.22, dec);
    this.osc('triangle', f, t, end, lp); this.osc('sine', f * 2, t, end, lp, 3);
    const g2 = this.ctx.createGain(); g2.gain.value = 0.25; g2.connect(lp); this.osc('sine', f * 3, t, end, g2, -2);
  }
  epiano(t, m, v = 0.5, wet = 0.3, dur = 1.5) {
    const f = mtof(m);
    const g = this.node(null, wet); const end = env(this.ctx, g, t, 0.006, v * 0.2, dur);
    const car = this.ctx.createOscillator(); car.type = 'sine'; car.frequency.value = f;
    const mod = this.ctx.createOscillator(); mod.type = 'sine'; mod.frequency.value = f;
    const idx = this.ctx.createGain(); idx.gain.setValueAtTime(f * 1.6 * v, t); idx.gain.setTargetAtTime(f * 0.15, t, 0.12);
    mod.connect(idx); idx.connect(car.frequency); car.connect(g);
    car.start(t); mod.start(t); car.stop(end); mod.stop(end);
    const tg = this.ctx.createGain(); tg.connect(g); env(this.ctx, tg, t, 0.002, 0.12 * v, 0.25); this.osc('sine', f * 4.02, t, t + 0.6, tg);
  }
  bell(t, m, v = 0.4, wet = 0.6, dec = 3.2, ratio = 3.5) {
    const f = mtof(m);
    const g = this.node(null, wet); const end = env(this.ctx, g, t, 0.003, v * 0.14, dec);
    const car = this.ctx.createOscillator(); car.type = 'sine'; car.frequency.value = f;
    const mod = this.ctx.createOscillator(); mod.type = 'sine'; mod.frequency.value = f * ratio;
    const idx = this.ctx.createGain(); idx.gain.setValueAtTime(f * 2.2, t); idx.gain.setTargetAtTime(f * 0.08, t, dec * 0.12);
    mod.connect(idx); idx.connect(car.frequency); car.connect(g); car.start(t); mod.start(t); car.stop(end); mod.stop(end);
  }
  pluck(t, m, v = 0.5, wet = 0.3) {
    const f = mtof(m);
    const lp = this.ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 2;
    lp.frequency.setValueAtTime(Math.min(8000, f * 12), t); lp.frequency.setTargetAtTime(f * 1.5, t, 0.08);
    const g = this.node(null, wet); lp.connect(g);
    const end = env(this.ctx, g, t, 0.003, v * 0.16, 0.9);
    this.osc('sawtooth', f, t, end, lp); this.osc('triangle', f * 2, t, end, lp, 5);
  }
  pad(t, notes, dur, v = 0.4, wet = 0.6, cutoff = 1100, att = 1.2) {
    const lp = this.ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = cutoff; lp.Q.value = 0.4;
    const g = this.node(null, wet); lp.connect(g);
    const per = v * 0.05 / Math.sqrt(notes.length);
    const end = env(this.ctx, g, t, att, 1, 1, 1, dur, 1.8);
    for (const m of notes) { const f = mtof(m); const og = this.ctx.createGain(); og.gain.value = per; og.connect(lp); this.osc('sawtooth', f, t, end, og, -7); this.osc('sawtooth', f, t, end, og, 7); this.osc('sine', f / 2, t, end, og); }
  }
  strings(t, m, dur, v = 0.4, wet = 0.5) {
    const f = mtof(m);
    const lp = this.ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 650;
    const g = this.node(null, wet); lp.connect(g);
    const end = env(this.ctx, g, t, 0.6, v * 0.07, 1, 1, dur, 1.2);
    const vib = this.ctx.createOscillator(); vib.frequency.value = 5.2; const vg = this.ctx.createGain(); vg.gain.value = 8; vib.connect(vg);
    for (const dt of [-9, 0, 8]) { const o = this.ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.detune.value = dt; vg.connect(o.detune); o.connect(lp); o.start(t); o.stop(end); }
    vib.start(t); vib.stop(end);
  }
  bass(t, m, v = 0.5, dur = 0.8, wet = 0.1) {
    const f = mtof(m);
    const lp = this.ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 420;
    const g = this.node(null, wet); lp.connect(g);
    const end = env(this.ctx, g, t, 0.01, v * 0.3, 0.4, 0.55, dur, 0.15);
    this.osc('sine', f, t, end, lp); this.osc('triangle', f * 2, t, end, lp);
  }
  noiseBuf() {
    if (this.noise) return this.noise;
    const n = this.ctx.sampleRate; const b = this.ctx.createBuffer(1, n, n); const d = b.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    return (this.noise = b);
  }
  brush(t, v = 0.3, len = 0.12, freq = 5500, wet = 0.15) {
    const s = this.ctx.createBufferSource(); s.buffer = this.noiseBuf();
    const bp = this.ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = freq; bp.Q.value = 0.8;
    const g = this.node(null, wet); s.connect(bp); bp.connect(g);
    const end = env(this.ctx, g, t, 0.004, v * 0.12, len);
    s.start(t, Math.random() * 0.8); s.stop(end);
  }
  thump(t, v = 0.5, f0 = 80) {
    const g = this.node(null, 0.2); const end = env(this.ctx, g, t, 0.004, v * 0.5, 0.45);
    const o = this.ctx.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f0 * 0.5, t + 0.25); o.connect(g); o.start(t); o.stop(end);
  }
}

// ----------------------------------------------------------------- composition helpers
// a singable line over a chord progression: chord tones on strong beats, stepwise between
function makeMelody(seed, chords, scale, lo, hi, slots, density) {
  const r = rng(seed); const out = [];
  const inScale = (m) => scale.includes(((m % 12) + 12) % 12);
  const pool = []; for (let m = lo; m <= hi; m++) if (inScale(m)) pool.push(m);
  let cur = pool[Math.floor(pool.length / 2)];
  for (let bar = 0; bar < chords.length; bar++) {
    const ch = chords[bar].map((m) => ((m % 12) + 12) % 12);
    const row = [];
    for (let k = 0; k < slots; k++) {
      const strong = k === 0 || k === slots / 2;
      const play = strong ? r() < density + 0.35 : r() < density;
      if (!play) { row.push(null); continue; }
      let cand = pool.filter((m) => Math.abs(m - cur) <= (strong ? 5 : 3));
      if (strong) { const ct = cand.filter((m) => ch.includes(m % 12)); if (ct.length) cand = ct; }
      if (!cand.length) cand = pool;
      cur = cand[Math.floor(r() * cand.length)];
      row.push(cur);
    }
    // end phrases on a chord tone and let them breathe
    if (bar % 4 === 3) { for (let k = Math.ceil(slots / 2); k < slots; k++) row[k] = null; }
    out.push(row);
  }
  return out;
}
const C = (root, ...iv) => iv.map((i) => root + i);

// ----------------------------------------------------------------- the six pieces
const SONGS = [
  // 1 · blossom: gentle piano in D major
  (() => {
    const ch = [C(62, 0, 4, 7), C(61, -4, 0, 4, 7), C(59, 0, 3, 7), C(55, 0, 4, 7), C(54, -4, 0, 3, 8), C(55, 0, 4, 7, 11), C(57, 0, 5, 7), C(57, 0, 4, 7)];
    const bass = [38, 37, 35, 31, 30, 31, 33, 33];
    const mel = makeMelody(11, ch.concat(ch), [2, 4, 6, 9, 11, 1, 7], 69, 83, 8, 0.32);
    return { bpm: 74, bpb: 4, sub: 2, bars: 16, play(S, bar, k, t, sp) {
      const c = ch[bar % 8], arp = [c[0] - 12, c[1], c[2], c[1] + 12, c[2] + 12, c[1] + 12, c[2], c[1]];
      S.piano(t, arp[k % 8], 0.34 + (k % 4 === 0 ? 0.1 : 0));
      if (k === 0) { S.bass(t, bass[bar % 8], 0.5, sp * 3.5); S.pad(t, c, sp * 4, 0.28, 0.7, 900); }
      if (k === 4) S.bass(t, bass[bar % 8] + 7, 0.3, sp * 1.5);
      const m = mel[bar % 16][k]; if (m) S.piano(t + 0.004, m, 0.5, 0.45, 1.2);
    } };
  })(),
  // 2 · sunrise: slow Lydian swells with chimes
  (() => {
    const ch = [C(53, 0, 4, 7, 11, 16), C(55, -2, 2, 5, 9, 14), C(57, 0, 3, 7, 10, 14), C(48, 0, 7, 11, 14, 16)];
    const r = rng(7);
    return { bpm: 58, bpb: 4, sub: 2, bars: 4, gain: 1.5, play(S, bar, k, t, sp) {
      const c = ch[bar % 4];
      if (k === 0) { S.pad(t, c, sp * 4.2, 0.55, 0.8, 1300, 2.2); S.bass(t, c[0] - 12, 0.35, sp * 4); }
      if (r() < 0.22) { const pent = [65, 67, 69, 72, 74, 76, 79, 81]; S.bell(t, pent[Math.floor(r() * pent.length)], 0.35, 0.75, 3.8); }
      if (k === 2 || k === 6) S.pluck(t, c[2] + 12, 0.18, 0.5);
    } };
  })(),
  // 3 · river: flowing 6/8 in A minor
  (() => {
    const ch = [C(57, 0, 3, 7), C(53, 0, 4, 7), C(48, 0, 4, 7), C(55, 0, 4, 7), C(57, 0, 3, 7), C(50, 0, 3, 7), C(53, 0, 4, 7), C(52, 0, 4, 7)];
    const mel = makeMelody(23, ch.concat(ch), [9, 11, 0, 2, 4, 5, 7], 64, 79, 6, 0.3);
    return { bpm: 108, bpb: 2, sub: 3, bars: 16, play(S, bar, k, t, sp) {
      const c = ch[bar % 8], arp = [c[0] - 12, c[2] - 12, c[1], c[2], c[1] + 12, c[2]];
      S.pluck(t, arp[k], 0.42 + (k === 0 ? 0.12 : 0), 0.35);
      if (k === 0 || k === 3) S.bass(t, c[0] - 24 + (k === 3 ? 7 : 0), 0.45, sp * 0.9);
      S.brush(t, k === 0 || k === 3 ? 0.35 : 0.2, 0.06, 7000, 0.1);
      const m = mel[bar % 16][k]; if (m) S.epiano(t, m, 0.55, 0.4, 1.2);
      if (k === 0 && bar % 2 === 0) S.pad(t, c, sp * 6, 0.22, 0.6, 800);
    } };
  })(),
  // 4 · lounge: swung ii–V–I in B-flat, Rhodes, walking bass, brushes
  (() => {
    const ch = [C(48, 0, 3, 7, 10, 14), C(53, 0, 4, 10, 14, 21), C(46, 0, 4, 7, 11, 14), C(55, 0, 4, 10, 13, 16), C(51, 0, 4, 7, 11, 14), C(56, 0, 4, 10, 14), C(50, 0, 3, 7, 10), C(55, 0, 4, 10, 13)];
    const roots = [36, 41, 34, 43, 39, 44, 38, 43];
    const mel = makeMelody(5, ch.concat(ch), [10, 0, 2, 3, 5, 7, 9], 70, 84, 8, 0.28);
    return { bpm: 96, bpb: 4, sub: 2, swing: 0.62, bars: 16, play(S, bar, k, t, sp) {
      const c = ch[bar % 8], root = roots[bar % 8], nextRoot = roots[(bar + 1) % 8];
      if (k % 2 === 0) { const b = k / 2; const walk = [root, root + (c[1] - c[0]), root + 7, nextRoot + (nextRoot > root ? -1 : 1)]; S.bass(t, walk[b], 0.55, sp * 0.9); }
      if (k === 3 || k === 6) for (const m of c.slice(1)) S.epiano(t + Math.random() * 0.012, m, 0.32, 0.3, 1.1);
      if (k % 2 === 0) S.brush(t, 0.3, 0.18, 4800, 0.1); else if (k === 3 || k === 7) S.brush(t, 0.18, 0.08, 6500, 0.1);
      const m = mel[bar % 16][k]; if (m) S.bell(t, m, 0.5, 0.35, 1.6, 4.0);
    } };
  })(),
  // 5 · storm: dark strings over a pulsing low ostinato in E minor
  (() => {
    const ch = [C(52, 0, 3, 7), C(48, 0, 4, 7, 11), C(45, 0, 3, 7), C(47, 0, 4, 7, 10)];
    return { bpm: 66, bpb: 4, sub: 2, bars: 8, gain: 1.15, play(S, bar, k, t, sp) {
      const c = ch[bar % 4];
      S.piano(t, (k % 2 ? c[0] - 5 : c[0]) - 12, 0.28 + (k === 0 ? 0.15 : 0), 0.4, 0.6);
      if (k === 0) { S.strings(t, c[0] - 12, sp * 4, 0.6); S.strings(t, c[1], sp * 4, 0.35); S.strings(t, c[2] + 12 * (bar % 2), sp * 4, 0.3); S.thump(t, 0.5, 70); }
      if (k === 4 && bar % 2 === 1) S.thump(t, 0.3, 60);
      if (k === 6 && bar % 4 === 3) S.bell(t, c[2] + 24, 0.25, 0.8, 4, 2.4);
    } };
  })(),
  // 6 · night: a music-box lullaby in G, 3/4
  (() => {
    const ch = [C(55, 0, 4, 7), C(52, 0, 3, 7), C(48, 0, 4, 7), C(50, 0, 4, 7), C(55, 0, 4, 7), C(47, 0, 3, 8), C(48, 0, 4, 7), C(50, 0, 4, 7, 10)];
    const mel = makeMelody(31, ch.concat(ch), [7, 9, 11, 2, 4], 74, 88, 6, 0.45);
    return { bpm: 80, bpb: 3, sub: 2, bars: 16, gain: 1.6, play(S, bar, k, t, sp) {
      const c = ch[bar % 8];
      if (k === 0) { S.piano(t, c[0] - 12, 0.4, 0.5, 0.7); S.pad(t, c, sp * 3, 0.2, 0.8, 700, 1.4); }
      if (k === 2 || k === 4) S.piano(t, c[1 + (k === 4 ? 1 : 0)], 0.22, 0.5, 0.7);
      const m = mel[bar % 16][k]; if (m) S.bell(t, m, 0.55, 0.65, 2.4, 5.0);
    } };
  })(),
];
export const SONG_COUNT = SONGS.length;

export class Music {
  constructor() { this.ctx = null; this.cur = null; this.sel = 0; this.timer = null; }
  attach(ctx, dest) {
    this.ctx = ctx;
    this.bus = ctx.createGain(); this.bus.gain.value = 0.55; this.bus.connect(dest);
    // generated hall reverb
    const len = Math.floor(ctx.sampleRate * 2.8), ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) { const d = ir.getChannelData(c); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6) * (i < 400 ? i / 400 : 1); }
    this.verb = ctx.createConvolver(); this.verb.buffer = ir; const vg = ctx.createGain(); vg.gain.value = 0.55; this.verb.connect(vg); vg.connect(this.bus);
    this.timer = setInterval(() => this.tick(), 40);
    this.play(this.sel);
  }
  // 0 = off, 1..6 = pieces
  select(i) { this.sel = i; if (this.ctx) this.play(i); }
  play(i) {
    const ctx = this.ctx, now = ctx.currentTime;
    if (this.cur) { const old = this.cur; old.out.gain.setTargetAtTime(0, now, 0.5); setTimeout(() => old.out.disconnect(), 4000); this.cur = null; }
    if (!i) return;
    const song = SONGS[i - 1];
    const out = ctx.createGain(); out.gain.setValueAtTime(0, now); out.gain.linearRampToValueAtTime(song.gain || 1, now + 1.5); out.connect(this.bus);
    const S = new Synth(ctx, out, this.verb);
    this.cur = { song, S, out, step: 0, next: now + 0.15 };
  }
  tick() {
    const c = this.cur; if (!c || this.ctx.state !== 'running') { if (c) c.next = Math.max(c.next, this.ctx.currentTime + 0.1); return; }
    this.scheduleUntil(this.ctx.currentTime + 0.3);
  }
  scheduleUntil(horizon) {
    const c = this.cur; if (!c) return;
    const sg = c.song, beat = 60 / sg.bpm, sp = beat, stepDur = beat / sg.sub, perBar = sg.bpb * sg.sub;
    while (c.next < horizon) {
      const bar = Math.floor(c.step / perBar) % sg.bars, k = c.step % perBar;
      let t = c.next;
      if (sg.swing && k % 2 === 1) t += stepDur * (sg.swing - 0.5) * 2 * 0.5;
      try { sg.play(c.S, bar, k, t + Math.random() * 0.006, sp); } catch (e) { /* keep time even if a voice fails */ }
      c.step++; c.next += stepDur;
    }
  }
}
