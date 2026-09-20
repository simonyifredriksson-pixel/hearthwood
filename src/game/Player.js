/* Player.js — you, walking about in the wood.
   ===========================================================================
   Movement, collision, the animal rig, the thing in your hand, and the reach
   that decides what you are about to pick up.

   COLLISION is discs on the XZ plane and nothing else. There are no walls in
   Hearthwood that a disc cannot describe, and a disc-against-disc push-out
   never wedges you in a corner, never clips you through a tree, and costs a
   few dozen distance checks a frame. The two refinements that matter:

     - SLIDE, DO NOT STOP. Pushing out along the contact normal means walking
       into a wall at an angle slides you along it, which is what every
       player's hands expect.
     - LOW BLOCKERS ARE STEPS. A fallen log is a blocker until you are moving
       fast enough to climb it, and then it is a step up. Being stopped dead
       by a log you can see over is the single most annoying thing a forest
       can do to you.

   The rig is posed by Anim.js and never touched here except for its position
   and facing. Everything visual about how a species moves lives there.
*/

import * as THREE from '../../lib/three.module.js?v=20260920201841';
import { buildAnimal } from '../art/AnimalArt.js?v=20260920201841';
import { poseAnimal, SPECIES } from './Anim.js?v=20260920201841';
import { carryFor, swingOf } from './Combat.js?v=20260920201841';
import { MATS } from '../art/Materials.js?v=20260920201841';
import { PLAYER, WORLD } from '../core/Config.js?v=20260920201841';
import { clamp, clamp01, lerp, damp, dampAngle, angleDelta, TAU, smoothstep } from '../core/Util.js?v=20260920201841';

const UP = new THREE.Vector3(0, 1, 0);

export class Player {
  constructor(world, species = 'fox') {
    this.world = world;
    this.setSpecies(species);

    this.x = WORLD.village.cx;
    this.z = WORLD.village.cz + 22;
    this.y = world ? world.groundAt(this.x, this.z) : 0;
    this.vy = 0;
    this.yaw = Math.PI;
    this.grounded = true;

    this.vx = 0; this.vz = 0;
    this.speed = 0;
    this.running = false;
    this.moving = false;

    this.t = 0;
    this.stepPhase = 0;
    this.lastStepSurface = 'grass';

    this.action = null;
    this.actionT = 0;
    this.actionDur = 0;
    this.onActionDone = null;

    this.weapon = null;           // {meshes, weapon, cls, info}
    this.lookAt = null;
    this._blockers = [];
  }

  /* ====================================================================== */
  /* SPECIES                                                                */
  /* ====================================================================== */

  setSpecies(key) {
    const S = SPECIES[key] || SPECIES.fox;
    this.speciesKey = S.key;
    this.S = S;
    if (this.rig) {
      this.rig.root.parent?.remove(this.rig.root);
      disposeRig(this.rig);
    }
    this.rig = buildAnimal(S.key, { seed: 7 });
    this.radius = this.rig.metrics.radius * 0.72;
    this.eyeHeight = this.rig.metrics.eyeHeight;
    this.height = this.rig.metrics.height;
    if (this.weapon) this._mountWeapon();
  }

  addTo(scene) { scene.add(this.rig.root); return this; }

  /* ====================================================================== */
  /* THE THING IN YOUR HAND                                                 */
  /* ====================================================================== */

  equip(weapon) {
    this.unequip();
    if (!weapon) return;
    this.weapon = weapon;
    this._mountWeapon();
  }

  unequip() {
    if (this.weapon && this.weapon.meshes) {
      for (const m of this.weapon.meshes) m.parent?.remove(m);
    }
    this.weapon = null;
  }

  _mountWeapon() {
    if (!this.weapon || !this.rig?.parts?.grip) return;
    const grip = this.rig.parts.grip;
    const cls = this.weapon.cls || this.weapon.weapon?.cls;
    /* SCALED TO THE WIELDER, not by a flat factor.
       Sticks run from 30 cm to nearly 4 m, so a fixed multiplier gives a
       one-metre character a three-metre pole to carry — which is not "heroic
       weapon", it is a caber. The weapon is scaled so that its LENGTH lands
       in a sane band against the character's own height, and short weapons
       are left alone so a dagger does not get inflated to fill the quota. */
    const len = this.weapon.info?.length || 1.2;
    const hands = this.weapon.weapon?.stats?.hands || 1;
    const want = this.height * (hands === 2 ? 1.35 : 0.82);
    const s = Math.min(this.S.carryScale, want / Math.max(0.25, len));
    /* NOT A UNIFORM SHRINK. Scaling a three-metre polearm down to fit also
       scales its thickness down, and it arrives as a piece of thread. The
       length is what has to fit; the girth should stay in the range where
       the weapon still reads, so long weapons are fattened back up by
       roughly as much as they were shortened. */
    const fat = clamp(Math.pow(this.S.carryScale / s, 0.62), 1, 2.2);
    this.weaponScale = s;
    /* HOW IT SITS IN THE PAW IS PER WEAPON, not one angle for all of them.
       A maul rests on the shoulder, a spear slopes with the point up, a
       staff stands nearly upright, a dagger tucks in close. Using one
       rotation for every class is why everything used to look like it was
       being carried to a bin. */
    const C = carryFor(cls);
    for (const m of this.weapon.meshes) {
      m.scale.set(s * fat, s, s * fat);
      m.rotation.set(C.rot[0], C.rot[1], C.rot[2]);
      m.position.set(C.pos[0] * s, C.pos[1] * s, C.pos[2] * s);
      grip.add(m);
    }
  }

  /** The class of whatever is being carried, for the animator. */
  get weaponClass() {
    return this.weapon ? (this.weapon.cls || this.weapon.weapon?.cls || null) : null;
  }

  /** Begin an attack with the equipped weapon. Returns the swing, or null. */
  attack() {
    if (!this.weapon || this.busy) return null;
    const sw = swingOf(this.weapon.weapon || { cls: this.weaponClass });
    this._swing = sw;
    this._hitDone = false;
    this.startAction('swing', sw.duration, () => { this._swing = null; });
    return sw;
  }

  /** True on the single frame the blow lands. */
  get swingConnects() {
    if (!this._swing || this.action !== 'swing' || this._hitDone) return false;
    if (this.actionT / this.actionDur < this._swing.attack.hitAt) return false;
    this._hitDone = true;
    return true;
  }

  get swing() { return this._swing; }

  /* ====================================================================== */
  /* ACTIONS                                                                */
  /* ====================================================================== */

  startAction(name, duration, onDone = null) {
    this.action = name;
    this.actionT = 0;
    this.actionDur = duration;
    this.onActionDone = onDone;
  }

  get busy() { return !!this.action; }

  /* ====================================================================== */
  /* UPDATE                                                                 */
  /* ====================================================================== */

  /**
   * @param dt
   * @param move   {x, z} desired world-space direction, already normalised
   * @param opts   {run, jump, frozen}
   */
  update(dt, move, opts = {}) {
    this.t += dt;
    const S = this.S;
    const W = this.world;

    /* --- actions tick even while you cannot steer ------------------------ */
    if (this.action) {
      this.actionT += dt / Math.max(0.05, this.actionDur);
      if (this.actionT >= 1) {
        const cb = this.onActionDone;
        this.action = null; this.actionT = 0; this.onActionDone = null;
        cb?.();
      }
    }

    const frozen = !!opts.frozen;
    const wantMove = !frozen && !!(move && (move.x || move.z));
    this.running = !!opts.run && wantMove;
    const target = this.running ? S.run : S.walk;

    /* --- horizontal velocity -------------------------------------------- */
    const ax = wantMove ? move.x * target : 0;
    const az = wantMove ? move.z * target : 0;
    const rate = wantMove ? S.accel : S.accel * 1.6;
    this.vx = damp(this.vx, ax, rate / Math.max(0.5, target), dt);
    this.vz = damp(this.vz, az, rate / Math.max(0.5, target), dt);
    this.speed = Math.hypot(this.vx, this.vz);
    this.moving = this.speed > 0.15;

    /* --- facing ---------------------------------------------------------- */
    if (this.moving) {
      const want = Math.atan2(this.vx, this.vz);
      this.yaw = dampAngle(this.yaw, want, S.turn, dt);
    }

    /* --- move, then resolve ---------------------------------------------- */
    let nx = this.x + this.vx * dt;
    let nz = this.z + this.vz * dt;
    const res = this._resolve(nx, nz);
    nx = res.x; nz = res.z;

    /* --- the ground, and the step up ------------------------------------- */
    const g = W ? W.groundAt(nx, nz) : 0;
    const rise = g - this.y;

    if (this.grounded) {
      if (rise > S.stepUp) {
        // too tall to walk up: refuse the move rather than climbing a cliff
        const gHere = W ? W.groundAt(this.x, this.z) : 0;
        if (g - gHere > S.stepUp) { nx = this.x; nz = this.z; }
      }
    }

    this.x = nx; this.z = nz;
    const ground = W ? W.groundAt(this.x, this.z) : 0;

    /* --- vertical -------------------------------------------------------- */
    if (!frozen && opts.jump && this.grounded) {
      this.vy = S.jump;
      this.grounded = false;
    }
    if (this.grounded) {
      // stick to the ground, but ease up slopes so a step is not a jolt
      this.y = this.y + (ground - this.y) * (1 - Math.exp(-22 * dt));
      if (Math.abs(ground - this.y) < 0.004) this.y = ground;
      this.vy = 0;
    } else {
      this.vy += S.gravity * dt;
      this.y += this.vy * dt;
      if (this.y <= ground) { this.y = ground; this.vy = 0; this.grounded = true; this._land(); }
    }
    if (this.y < ground - 0.05) { this.y = ground; this.grounded = true; this.vy = 0; }

    /* --- keep inside the map --------------------------------------------- */
    const lim = WORLD.half - 8;
    this.x = clamp(this.x, -lim, lim);
    this.z = clamp(this.z, -lim, lim);

    /* --- pose ------------------------------------------------------------- */
    const rel = clamp01(this.speed / S.run);
    const out = poseAnimal(this.rig, {
      t: this.t, dt,
      speed: rel, moving: this.moving, grounded: this.grounded,
      yaw: this.yaw, carrying: !!this.weapon,
      // the animator needs to know WHAT is being carried, not just that
      // something is: the rest pose and the swing are both per class
      weaponCls: this.weaponClass,
      action: this.action, actionT: this.actionT, actionDur: this.actionDur,
      lookAt: this.lookAt,
    });

    this.rig.root.position.set(this.x, this.y + (out.bodyY || 0), this.z);
    this.rig.root.rotation.y = this.yaw;

    /* --- footsteps -------------------------------------------------------- */
    this._steps(dt, rel);

    return this;
  }

  /** Push out of every blocker we are inside, sliding rather than stopping. */
  _resolve(x, z) {
    const W = this.world;
    if (!W) return { x, z };
    const list = W.blockersNear(x, z, 4.5, this._blockers);
    const R = this.radius;
    for (let pass = 0; pass < 3; pass++) {
      let hit = false;
      for (const b of list) {
        // a low blocker (a log, a bench) stops you only if you are barely
        // moving; at a walk you go over it
        if (b.low && this.speed > 1.2) continue;
        const rr = (b.r + R) * (b.soft ? 0.72 : 1);
        const dx = x - b.x, dz = z - b.z;
        const d2 = dx * dx + dz * dz;
        if (d2 >= rr * rr || d2 < 1e-8) continue;
        const d = Math.sqrt(d2);
        const push = (rr - d) * (b.soft ? 0.5 : 1);
        x += (dx / d) * push;
        z += (dz / d) * push;
        hit = true;
      }
      if (!hit) break;
    }
    return { x, z };
  }

  _land() {
    if (this.world?.audio) this.world.audio.step(this.lastStepSurface, 1.4, 1);
  }

  _steps(dt, rel) {
    if (!this.moving || !this.grounded) return;
    const S = this.S;
    // a frog's footfall is its landing; the others have a proper cadence
    const rate = S.gait === 'hop' ? lerp(1.5, 3.2, rel)
      : S.gait === 'lumber' ? lerp(1.15, 2.1, rel) * 2
        : lerp(2.1, 4.4, rel) * 2;
    this.stepPhase += dt * rate;
    if (this.stepPhase >= 1) {
      this.stepPhase -= 1;
      const surf = this.world ? this.world.terrain.surfaceAt(this.x, this.z) : 'grass';
      this.lastStepSurface = surf;
      this.onStep?.(surf, rel);
    }
  }

  /* ====================================================================== */
  /* REACH                                                                  */
  /* ====================================================================== */

  /** How far this animal can see an interesting stick from. */
  get spotRange() { return 12 + this.S.spotBonus; }
  get reach() { return this.S.reach; }

  /** The point the camera should look at. */
  focusPoint(out = new THREE.Vector3()) {
    return out.set(this.x, this.y + this.eyeHeight * 0.75, this.z);
  }

  /** Forward on the XZ plane. */
  get forward() { return { x: Math.sin(this.yaw), z: Math.cos(this.yaw) }; }
}

function disposeRig(rig) {
  rig.root.traverse(o => { if (o.isMesh) o.geometry.dispose(); });
}
