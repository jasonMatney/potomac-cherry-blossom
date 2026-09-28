// Runners on the riverside paths. A small pool is recycled around the viewer: each runs a stretch of path
// near the boat, then reappears further along, so the banks always feel lived-in without many characters.
import * as THREE from 'three';
import { clamp, lerp } from './util.js';
import { frame, fromSD, hwR, hwL, CANAL, S0, S1 } from './world.js';
import { groundAt } from './terrain.js';
import { makeJoggerChar } from './outfits.js';

const V3 = THREE.Vector3;
// paths: side, s range, offset from the bank (e)
const PATHS = [
  { side: 1, s0: -280, s1: 540, e: 3.4 }, // Ohio Drive / West Potomac Park seawall path
  { side: 1, s0: 780, s1: 966, e: 4.2 }, // Georgetown Waterfront promenade
  { side: -1, s0: -380, s1: 520, e: 14.5 }, // Mount Vernon Trail
  { side: -1, s0: 870, s1: 995, e: 14.5 },
  { side: 1, s0: CANAL.s0 + 20, s1: S1 - 40, e: (CANAL.towE0 + CANAL.towE1) / 2 }, // C&O towpath
];
const LOOKS = [
  { top: 0xe8664a, pants: 0x1c1f26, sole: 0x3aa0d8 },
  { female: true, top: 0x2aa7a0, pants: 0x2a2436, hair: 0x6a4a2a, sole: 0xe84a8a },
  { top: 0xf2f2f2, pants: 0x30343c, dark: true, sole: 0xf0c020 },
  { female: true, top: 0xf0b449, pants: 0x1c1f26, hair: 0x2a1a12, sole: 0x7a4ae0 },
];
export class Joggers {
  constructor(scene, n = 4) {
    this.list = [];
    for (let i = 0; i < n; i++) {
      const c = makeJoggerChar(LOOKS[i % LOOKS.length]);
      scene.add(c.root); c.root.visible = false;
      const run = c.play('Jog_Fwd_Loop', 1, 1);
      this.list.push({ c, run, path: null, s: 0, dir: 1, spd: 2.6 + i * 0.25, ph: Math.random(), cool: i * 3 });
    }
  }
  spawn(J, focusS) {
    // pick a path with a stretch near the viewer
    const opts = PATHS.filter((p) => focusS > p.s0 - 150 && focusS < p.s1 + 150);
    if (!opts.length) { J.path = null; return; }
    const p = opts[Math.floor(Math.random() * opts.length)];
    J.path = p; J.dir = Math.random() < 0.5 ? 1 : -1;
    J.s = clamp(focusS + (Math.random() * 220 - 60) * (Math.random() < 0.5 ? 1 : -1), p.s0, p.s1);
    J.eOff = (Math.random() - 0.5) * 1.2;
    J.run.timeScale = J.spd / 2.7;
  }
  update(dt, t, focusS, focus, cam, avoid) {
    for (const J of this.list) {
      if (J.cool > 0) { J.cool -= dt; J.c.root.visible = false; continue; }
      if (!J.path) { this.spawn(J, focusS); if (!J.path) { J.c.root.visible = false; continue; } }
      J.s += J.dir * J.spd * dt;
      const p = J.path;
      if (J.s < p.s0 || J.s > p.s1 || Math.abs(J.s - focusS) > 380) { J.path = null; J.cool = 2 + Math.random() * 6; J.c.root.visible = false; continue; }
      // step aside for someone on the path ahead
      J.side = J.side || 0;
      if (avoid) { const [ax, az] = fromSD(J.s, p.side > 0 ? hwR(J.s) + p.e + J.eOff : -(hwL(J.s) + p.e + J.eOff)); const F0 = frame(J.s);
        const rx = avoid.x - ax, rz = avoid.z - az; const along = (rx * F0.fx + rz * F0.fz) * J.dir, lat = rx * F0.rx + rz * F0.rz;
        const want = along > -1 && along < 7 && Math.abs(lat) < 1.6 ? -Math.sign(lat * p.side || 1) * (1.8 - Math.abs(lat)) : 0;
        J.side = lerp(J.side, want, 1 - Math.exp(-dt * 3)); } else J.side = lerp(J.side, 0, 1 - Math.exp(-dt));
      const d = p.side > 0 ? hwR(J.s) + p.e + J.eOff + J.side : -(hwL(J.s) + p.e + J.eOff + J.side);
      const [x, z] = fromSD(J.s, d); const y = groundAt(x, z);
      const F = frame(J.s);
      const r = J.c.root; r.visible = true;
      r.position.set(x, y, z);
      r.rotation.y = -F.th + (J.dir > 0 ? 0 : Math.PI);
      // only animate the skeletons that are close enough to be seen
      if (cam.position.distanceToSquared(r.position) < 180 * 180) J.c.mixer.update(dt);
    }
  }
}
