/* Effects.js — the small bright things.
   ===========================================================================
   Two effects live here, and they have the same shape, so they share a pool:

     SPRINT WIND. Thin streaks of moving air that peel off the fox's legs and
     trail behind her while she is running on all fours. The brief asked for
     "tasteful and lightweight" and that is a real constraint, not a note:
     the temptation with speed lines is to emit a hundred a second and turn
     the screen into a car advert. This emits at most a couple of dozen, only
     while the sprint blend is actually up, only near the ground and the
     flanks, and every one of them fades inside half a second.

     THE CHARGE GLIMPSE. One short pulse each time the heavy attack reaches
     a new stage. It is a ring that opens and disappears — again the brief
     was specific: it should read as "that clicked into place", not as an
     explosion.

   Everything is ONE pooled geometry and one pooled set of meshes. Particles
   that allocate are particles that stutter.
*/

import * as THREE from '../../lib/three.module.js?v=20260921163240';
import { MeshBuilder, quad } from '../art/Geo.js?v=20260921163240';
import { MATS } from '../art/Materials.js?v=20260921163240';
import { makeRng, clamp01, lerp, TAU } from '../core/Util.js?v=20260921163240';

/* A streak is a long thin quad, built once, drawn many times. */
function streakGeo(hex, len = 1, wide = 0.055) {
  const b = new MeshBuilder();
  b.color(hex, 0);
  quad(b, [-len * 0.5, 0, 0], [len * 0.5, 0, 0], [len * 0.42, wide, 0], [-len * 0.46, wide, 0],
    null, [0, 0, 1]);
  quad(b, [len * 0.5, 0, 0], [-len * 0.5, 0, 0], [-len * 0.46, wide, 0], [len * 0.42, wide, 0],
    null, [0, 0, -1]);
  return b.build({ flat: true });
}

/** A flat ring, for the charge pulse. */
function ringGeo(hex, seg = 26) {
  const b = new MeshBuilder();
  b.color(hex, 0);
  const inner = 0.80, outer = 1.0;
  const a0 = [], a1 = [];
  for (let i = 0; i < seg; i++) {
    const a = (i / seg) * TAU;
    a0.push(b.vert(Math.cos(a) * inner, 0, Math.sin(a) * inner));
    a1.push(b.vert(Math.cos(a) * outer, 0, Math.sin(a) * outer));
  }
  for (let i = 0; i < seg; i++) {
    const j = (i + 1) % seg;
    b.quad(a0[i], a1[i], a1[j], a0[j]);
    b.quad(a0[j], a1[j], a1[i], a0[i]);     // both sides: it is seen from below too
  }
  return b.build({ flat: true });
}

export class Effects {
  constructor(scene, { max = 34 } = {}) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.group.frustumCulled = false;
    scene.add(this.group);

    this.gWind = streakGeo(0xf2f8ff, 1, 0.05);
    this.gRing = ringGeo(0xffe6a8);

    this.items = [];
    for (let i = 0; i < max; i++) {
      const m = new THREE.Mesh(this.gWind, MATS.glowSoft);
      m.visible = false;
      m.frustumCulled = false;
      this.group.add(m);
      this.items.push({ m, life: 0, max: 1, kind: 'wind', vx: 0, vy: 0, vz: 0, spin: 0, grow: 0, base: 1 });
    }
    this.rnd = makeRng(0x5eed1);
    this._emit = 0;
  }

  _free() {
    for (const it of this.items) if (!it.m.visible) return it;
    /* recycle the oldest rather than dropping the request: a pool that
       silently refuses looks like the effect flickering off under load */
    let worst = this.items[0];
    for (const it of this.items) if (it.life / it.max > worst.life / worst.max) worst = it;
    return worst;
  }

  /* ====================================================================== */
  /* SPRINT WIND                                                            */
  /* ====================================================================== */

  /**
   * @param p     the player
   * @param dt    seconds
   * @param amt   0..1, how far into the sprint blend we are
   */
  sprint(p, dt, amt) {
    if (amt < 0.25 || !p.moving) { this._emit = 0; return; }
    const r = this.rnd;
    /* rate scales with BOTH the blend and the actual speed, so the air only
       really starts moving when the fox is genuinely flying */
    const rate = 16 * amt * clamp01(p.speed / (p.S.run * 0.8));
    this._emit += dt * rate;
    while (this._emit >= 1) {
      this._emit -= 1;
      const it = this._free();
      const f = p.forward;
      const rx = -f.z, rz = f.x;                      // screen-right on the ground
      /* near the legs and just behind the body — the two places air actually
         moves around a running animal */
      const side = r.chance(0.5) ? 1 : -1;
      const back = r.range(-0.15, 0.55);
      const lowLeg = r.chance(0.62);
      it.m.geometry = this.gWind;
      it.m.material = MATS.glowSoft;
      it.m.position.set(
        p.x - f.x * back + rx * side * r.range(0.10, 0.30),
        p.y + (lowLeg ? r.range(0.06, 0.26) : r.range(0.32, 0.58)),
        p.z - f.z * back + rz * side * r.range(0.10, 0.30));
      it.m.rotation.set(0, Math.atan2(f.x, f.z) + r.range(-0.12, 0.12), r.range(-0.1, 0.1));
      it.base = r.range(0.26, 0.55);
      it.m.scale.set(it.base, 1, 1);
      it.m.visible = true;
      it.kind = 'wind';
      /* they drift BACKWARDS relative to the fox and outwards a little,
         which is what makes them read as air being pushed aside rather than
         as sparks coming off her */
      const sp = p.speed * r.range(0.35, 0.62);
      it.vx = -f.x * sp + rx * side * r.range(0.2, 0.9);
      it.vz = -f.z * sp + rz * side * r.range(0.2, 0.9);
      it.vy = r.range(-0.1, 0.35);
      it.spin = 0;
      it.grow = r.range(0.7, 1.5);
      it.life = 0;
      it.max = r.range(0.20, 0.42);
    }
  }

  /* ====================================================================== */
  /* THE CHARGE GLIMPSE                                                     */
  /* ====================================================================== */

  /** One short bright pulse. `stage` picks the colour and the size. */
  chargePulse(at, stage = 1, colour = 0xffe6a8) {
    const it = this._free();
    it.m.geometry = this.gRing;
    it.m.material = MATS.glowSoft;
    it.m.position.set(at[0], at[1], at[2]);
    it.m.rotation.set(Math.PI * 0.5, 0, 0);          // facing the player, not the sky
    it.m.visible = true;
    it.kind = 'ring';
    it.base = 0.16 + stage * 0.05;
    it.m.scale.setScalar(it.base * 0.35);
    it.vx = it.vy = it.vz = 0;
    it.grow = 1 + stage * 0.55;
    it.life = 0;
    /* SHORT. A quarter of a second is a glimpse; a second is a firework. */
    it.max = 0.26 + stage * 0.04;
    return it;
  }

  /** A small burst where a blow lands. */
  hitSpark(at, power = 1) {
    for (let i = 0; i < Math.min(6, 2 + Math.round(power * 2)); i++) {
      const it = this._free();
      const r = this.rnd;
      it.m.geometry = this.gWind;
      it.m.material = MATS.glowSoft;
      it.m.position.set(at[0], at[1], at[2]);
      it.m.rotation.set(r.range(0, TAU), r.range(0, TAU), r.range(0, TAU));
      it.base = r.range(0.10, 0.22) * power;
      it.m.scale.set(it.base, 1, 1);
      it.m.visible = true;
      it.kind = 'wind';
      const a = r.range(0, TAU), up = r.range(0.4, 2.2);
      it.vx = Math.cos(a) * r.range(1, 3) * power;
      it.vz = Math.sin(a) * r.range(1, 3) * power;
      it.vy = up;
      it.grow = 0.4;
      it.life = 0;
      it.max = r.range(0.14, 0.30);
    }
  }

  /* ====================================================================== */

  update(dt) {
    for (const it of this.items) {
      if (!it.m.visible) continue;
      it.life += dt;
      const k = it.life / it.max;
      if (k >= 1) { it.m.visible = false; continue; }
      it.m.position.x += it.vx * dt;
      it.m.position.y += it.vy * dt;
      it.m.position.z += it.vz * dt;
      if (it.kind === 'ring') {
        /* opens fast and stops, rather than expanding all the way out —
           the pulse should land, not travel */
        const s = it.base * (0.35 + Math.pow(k, 0.42) * it.grow);
        it.m.scale.setScalar(s);
        it.m.material = MATS.glowSoft;
        it.m.scale.y = 1;
      } else {
        it.vy -= 2.2 * dt;
        /* a streak stretches as it is left behind and thins to nothing */
        it.m.scale.set(it.base * (1 + k * it.grow), 1 - k * 0.8, 1);
      }
    }
  }

  dispose() {
    this.group.parent?.remove(this.group);
    this.gWind.dispose();
    this.gRing.dispose();
  }
}
