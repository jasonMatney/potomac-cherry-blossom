// Third-person chase camera with drag-orbit, scroll-zoom, cinematic drift and collision constraints
import * as THREE from 'three';
import { clamp, lerp } from './util.js';
import { groundAt } from './terrain.js';
import { inSolid } from './registry.js';

const V3 = THREE.Vector3;
export class ChaseCam {
  constructor(camera, dom) {
    this.cam = camera; this.dom = dom;
    this.yaw = 0; this.pitch = 0.07; this.dist = 13.5;
    this.uYaw = 0; this.uPitch = 0; this.uDist = 0; this.userT = 99;
    this.pos = new V3(); this.look = new V3(); this.init = false; this.heading = 0;
    this.boatSolid = null;
    let drag = null;
    dom.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY }; dom.setPointerCapture(e.pointerId); this.userT = 0; });
    dom.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y; drag = { x: e.clientX, y: e.clientY };
      this.uYaw -= dx * 0.005; this.uPitch = clamp(this.uPitch + dy * 0.004, -0.35, 1.0); this.userT = 0;
    });
    const end = (e) => { drag = null; };
    dom.addEventListener('pointerup', end); dom.addEventListener('pointercancel', end);
    dom.addEventListener('wheel', (e) => { e.preventDefault(); this.uDist = clamp(this.uDist + e.deltaY * 0.012, -9, 45); this.userT = 0; }, { passive: false });
    this.dragging = () => !!drag;
  }
  snap() { this.init = false; }
  // focus (optional): follow something other than the boat, e.g. the skipper on foot
  // { pos: Vector3, psi, dist, h, lead }
  update(dt, t, boat, waterY, focus = null) {
    this.userT += dt;
    if (focus && focus.fixed) {
      // inside the house: a fixed three-quarter view from outside, walls toward the camera cut away
      const k = this.init ? 1 - Math.exp(-dt * 2.5) : 1;
      this.pos.lerp(focus.fixed.cam, k); this.look.lerp(focus.fixed.look, this.init ? 1 - Math.exp(-dt * 5) : 1); this.init = true;
      this.fk = 1; this.cam.position.copy(this.pos); this.cam.lookAt(this.look); return;
    }
    const bx = focus ? focus.pos.x : boat.root.position.x, bz = focus ? focus.pos.z : boat.root.position.z;
    const fpsi = focus ? focus.psi : boat.psi;
    // blend smoothly between the boat framing and the on-foot framing
    this.fk = lerp(this.fk ?? 0, focus ? 1 : 0, 1 - Math.exp(-dt * 1.5));
    // heading follows the boat with lag
    let dh = fpsi - this.heading; while (dh > Math.PI) dh -= 2 * Math.PI; while (dh < -Math.PI) dh += 2 * Math.PI;
    this.heading += dh * (1 - Math.exp(-dt * 1.6));
    if (!this.init) this.heading = fpsi;
    // cinematic drift (fades in when the viewer is idle)
    const idleK = clamp((this.userT - 5) / 6, 0, 1);
    const drift = {
      yaw: (0.42 * Math.sin(t * 0.045) + 0.16 * Math.sin(t * 0.11 + 1.3)) * idleK,
      pitch: (0.05 * Math.sin(t * 0.07 + 0.4)) * idleK,
      dist: (2.5 * Math.sin(t * 0.06 + 2.0)) * idleK,
    };
    const yaw = this.heading + Math.PI + this.uYaw + drift.yaw;
    const pitch = clamp(this.pitch + this.uPitch + drift.pitch, -0.12, 1.15);
    const fk = this.fk;
    const dist = lerp(clamp(this.dist + this.uDist + drift.dist, 6.5, 62), clamp((focus ? focus.dist : 5) + this.uDist * 0.4 + drift.dist * 0.3, 2.5, 30), fk);
    const target = new V3(bx, (focus ? focus.pos.y + focus.h : boat.root.position.y + 1.7), bz);
    const fx = Math.sin(fpsi), fz = -Math.cos(fpsi);
    const lead = lerp(2.2, focus ? focus.lead : 0.4, fk);
    target.x += fx * lead; target.z += fz * lead;
    const want = new V3(target.x + Math.sin(yaw) * Math.cos(pitch) * dist, target.y + Math.sin(pitch) * dist + 0.9, target.z - Math.cos(yaw) * Math.cos(pitch) * dist);
    // smooth
    const k = this.init ? 1 - Math.exp(-dt * 3.2) : 1;
    this.pos.lerp(want, k); this.look.lerp(target, this.init ? 1 - Math.exp(-dt * 6) : 1);
    this.init = true;
    // constraints: stay above water & banks, and out of solids
    this.constrain(waterY, boat);
    this.cam.position.copy(this.pos);
    this.cam.lookAt(this.look);
    // gentle roll with the boat for a subtle handheld/boat feel
    this.cam.rotateZ(-boat.roll * 0.08 * (1 - fk));
  }
  clear(p, waterY, boat, noBoat = false) {
    const g = groundAt(p.x, p.z);
    const floor = Math.max(g + (g > waterY + 0.05 ? 2.2 : 0), waterY + 1.1);
    if (p.y < floor) return false;
    if (inSolid(p.x, p.y, p.z, 1.0)) return false;
    if (noBoat) return true;
    // hero boat volume (hull + canopy)
    const dx = p.x - boat.root.position.x, dz = p.z - boat.root.position.z;
    const [fx, fz] = boat.fwd();
    const la = dx * fx + dz * fz, lt = dx * -fz + dz * fx;
    if (Math.abs(la) < 4.2 && Math.abs(lt) < 1.9 && p.y < boat.root.position.y + 2.9) return false;
    return true;
  }
  constrain(waterY, boat) {
    const p = this.pos;
    // lift above terrain/water floor first
    const g = groundAt(p.x, p.z);
    const floor = Math.max(g + (g > waterY + 0.05 ? 2.2 : 0), waterY + 1.1);
    if (p.y < floor) p.y = floor;
    if (this.clear(p, waterY, boat)) return;
    // march from the look target toward the desired position; stop before the first obstruction
    const dir = p.clone().sub(this.look); const L = dir.length(); dir.normalize();
    let best = null;
    for (let s = 1.2; s <= L; s += 0.35) {
      const q = this.look.clone().addScaledVector(dir, s);
      const gq = groundAt(q.x, q.z); const fl = Math.max(gq + (gq > waterY + 0.05 ? 2.2 : 0), waterY + 1.1);
      if (q.y < fl) q.y = fl;
      if (!this.clear(q, waterY, boat, s < 5.0)) break;
      best = q;
    }
    if (best) { p.copy(best); return; }
    // fall back: rise straight up until clear
    for (let h = 0; h < 40; h += 0.5) { const q = p.clone(); q.y += h; if (this.clear(q, waterY, boat)) { p.copy(q); return; } }
  }
}
