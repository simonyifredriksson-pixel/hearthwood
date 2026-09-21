/* Wildlife.js — what is out there, and what it does about you.
   ===========================================================================
   THE DISTANCE IS THE DIFFICULTY. Which creature turns up is decided by how
   far from home the player is, and the five bands in VillageData are the
   whole progression: the inner forest has hares and a bad-tempered boar,
   and the far wood has things that circle you and strike on the frame your
   swing ends.

   AND IT IS BEHAVIOUR, NOT HEALTH. The brief was explicit about that, so
   nothing here scales a number. A Timber Wolf has three hit points and a
   Direwolf has six, which is nothing; what actually makes the Direwolf
   dangerous is:

     it notices you from forty metres and follows for eighty;
     it CIRCLES rather than approaching, so it is rarely in front of you;
     its wind-up is a quarter of a second rather than half;
     it chains three strikes instead of one;
     it DODGES two swings in five;
     and hitting it brings the rest of the pack.

   Every one of those is a different fight, and none of them is a bigger
   number.

   NOBODY DIES. `rout` is the point at which a creature gives up and runs,
   and every creature has one. You are driving them off.

   STREAMED, like everything else: creatures exist within a radius of the
   player and are recycled rather than allocated, so wandering across the
   map does not leak wolves.
*/

import * as THREE from '../../lib/three.module.js?v=1790014463';
import { buildBeast } from '../art/BeastArt.js?v=1790014463';
import { BEASTS, BEAST_LIST, beastsForBand, beastBudget } from '../data/BeastData.js?v=1790014463';
import { dangerBand, zoneAt, VILLAGES } from '../data/VillageData.js?v=1790014463';
import { targetsInArc } from './Combat.js?v=1790014463';
import { bus, EV } from '../core/Bus.js?v=1790014463';
import { makeRng, clamp, clamp01, lerp, damp, dampAngle, TAU, smoothstep } from '../core/Util.js?v=1790014463';

const SPAWN_MIN = 34;      // never appear closer than this
const SPAWN_MAX = 78;      // or further than this
const DESPAWN = 135;       // forget about them past here

export class Wildlife {
  constructor(world, scene) {
    this.world = world;
    this.scene = scene;
    this.group = new THREE.Group();
    this.group.name = 'wildlife';
    scene.add(this.group);
    this.list = [];
    this.pool = new Map();        // species -> [rigs not in use]
    this.rnd = makeRng(0xb3a57);
    this.t = 0;
    this._check = 0;
    this.routed = 0;
  }

  /* ====================================================================== */
  /* POPULATION                                                             */
  /* ====================================================================== */

  _rigFor(spec) {
    const free = this.pool.get(spec.id);
    if (free && free.length) {
      const rig = free.pop();
      rig.root.visible = true;
      return rig;
    }
    const rig = buildBeast(spec, { seed: (spec.id.length * 7919 + this.list.length) >>> 0 });
    this.group.add(rig.root);
    return rig;
  }

  _release(b) {
    b.rig.root.visible = false;
    if (!this.pool.has(b.spec.id)) this.pool.set(b.spec.id, []);
    this.pool.get(b.spec.id).push(b.rig);
  }

  /** Put one creature into the world near, but not on top of, the player. */
  _spawn(px, pz) {
    const W = this.world;
    const band = dangerBand(px, pz);
    if (band < 1) return null;
    const options = beastsForBand(band);
    if (!options.length) return null;

    const r = this.rnd;
    /* find somewhere out of sight, on walkable ground, out of a village */
    for (let tries = 0; tries < 12; tries++) {
      const a = r.range(0, TAU);
      const d = r.range(SPAWN_MIN, SPAWN_MAX);
      const x = px + Math.cos(a) * d, z = pz + Math.sin(a) * d;
      if (W.terrain.isVillage(x, z)) continue;
      if (W.terrain.waterAt(x, z) !== null) continue;
      if (W.terrain.slope(x, z, 2) > 0.55) continue;

      const pick = r.weighted(options, o => o.w).beast;
      const y = W.groundAt(x, z);
      const rig = this._rigFor(pick);
      rig.root.position.set(x, y, z);

      const b = {
        spec: pick, rig, x, z, y,
        yaw: r.range(0, TAU), targetYaw: r.range(0, TAU),
        hp: pick.hp, state: 'wander', stateT: 0,
        tx: x, tz: z, speed: 0, phase: r.range(0, TAU),
        wind: 0, chain: 0, cool: 0, notice: 0,
        radius: pick.size * 0.45,
        down: false, fleeing: false,
        flash: 0,
      };
      this.list.push(b);

      /* a pack turns up together */
      if (pick.pack > 1) {
        for (let k = 1; k < pick.pack; k++) {
          const ox = x + r.range(-6, 6), oz = z + r.range(-6, 6);
          if (W.terrain.waterAt(ox, oz) !== null) continue;
          const rig2 = this._rigFor(pick);
          rig2.root.position.set(ox, W.groundAt(ox, oz), oz);
          this.list.push({
            ...b, rig: rig2, x: ox, z: oz, y: W.groundAt(ox, oz),
            tx: ox, tz: oz, phase: r.range(0, TAU), hp: pick.hp,
          });
        }
      }
      return b;
    }
    return null;
  }

  /* ====================================================================== */
  /* UPDATE                                                                 */
  /* ====================================================================== */

  update(dt, player) {
    this.t += dt;
    const px = player.x, pz = player.z;

    /* --- keep the population right ------------------------------------- */
    this._check -= dt;
    if (this._check <= 0) {
      this._check = 1.2;
      /* drop anything that has wandered out of range */
      for (let i = this.list.length - 1; i >= 0; i--) {
        const b = this.list[i];
        if (Math.hypot(b.x - px, b.z - pz) > DESPAWN) {
          this._release(b);
          this.list.splice(i, 1);
        }
      }
      const want = beastBudget(dangerBand(px, pz));
      let guard = 0;
      while (this.list.length < want && guard++ < 4) this._spawn(px, pz);
    }

    for (const b of this.list) this._think(b, dt, player);
  }

  _think(b, dt, player) {
    const S = b.spec;
    const W = this.world;
    const dx = player.x - b.x, dz = player.z - b.z;
    const dist = Math.hypot(dx, dz);
    const toPlayer = Math.atan2(dx, dz);
    b.stateT += dt;
    b.cool = Math.max(0, b.cool - dt);
    b.flash = Math.max(0, b.flash - dt * 3);

    /* ------------------------------------------------ FLEEING ---------- */
    if (b.fleeing) {
      b.targetYaw = toPlayer + Math.PI;
      b.speed = damp(b.speed, S.speed * 1.15, 6, dt);
      if (dist > S.lose * 1.4) { b.fleeing = false; b.state = 'wander'; b.hp = S.hp; }
      this._move(b, dt);
      this._pose(b, dt, 'run');
      return;
    }

    /* ------------------------------------------------ HARMLESS --------- */
    if (S.harmless) {
      if (dist < S.notice) {
        b.targetYaw = toPlayer + Math.PI;
        b.speed = damp(b.speed, S.speed, 8, dt);
        b.state = 'bolt';
      } else {
        if (b.stateT > 3) { this._wander(b); b.stateT = 0; }
        b.speed = damp(b.speed, b.state === 'wander' ? 0.9 : 0, 4, dt);
      }
      this._steerToTarget(b, dt);
      this._move(b, dt);
      this._pose(b, dt, b.speed > 2.5 ? 'run' : 'walk');
      return;
    }

    /* ------------------------------------------------ AWARENESS -------- */
    const aware = b.state !== 'wander';
    if (!aware && dist < S.notice) {
      b.state = 'stalk'; b.stateT = 0;
      b.notice = 1;
      bus.emit(EV.BEAST_NOTICED, { beast: b });
    } else if (aware && dist > S.lose) {
      b.state = 'wander'; b.stateT = 0;
    }

    switch (b.state) {
      /* --- minding its own business ----------------------------------- */
      case 'wander': {
        if (b.stateT > 4.5) { this._wander(b); b.stateT = 0; }
        b.speed = damp(b.speed, 0.85, 3, dt);
        this._steerToTarget(b, dt);
        break;
      }

      /* --- CIRCLING. The core of what makes the far wood hard. --------- */
      case 'stalk': {
        b.targetYaw = toPlayer;
        /* a circler keeps its distance and orbits; a charger closes. The
           orbit direction is fixed per creature so it does not shimmy. */
        const ring = S.size * 2.6 + 1.6;
        const want = S.circle > 0.3 ? ring : 1.2;
        const side = (b.phase > Math.PI ? 1 : -1);
        const inward = clamp((dist - want) * 0.6, -1, 1);
        const tangent = S.circle * side;
        const ax = Math.sin(toPlayer) * inward - Math.cos(toPlayer) * tangent;
        const az = Math.cos(toPlayer) * inward + Math.sin(toPlayer) * tangent;
        const l = Math.hypot(ax, az) || 1;
        b.tx = b.x + (ax / l) * 6;
        b.tz = b.z + (az / l) * 6;
        b.speed = damp(b.speed, S.speed * (0.55 + S.circle * 0.4), 5, dt);
        /* strike when close enough and off cooldown */
        if (dist < want + 1.4 && b.cool <= 0) {
          b.state = 'wind'; b.stateT = 0; b.chain = 0;
        }
        break;
      }

      /* --- the tell ---------------------------------------------------- */
      case 'wind': {
        b.targetYaw = toPlayer;
        b.speed = damp(b.speed, 0.4, 9, dt);
        if (b.stateT >= S.wind) { b.state = 'strike'; b.stateT = 0; b.struck = false; }
        break;
      }

      /* --- the strike --------------------------------------------------- */
      case 'strike': {
        b.targetYaw = toPlayer;
        b.speed = damp(b.speed, S.speed * 1.45, 16, dt);
        if (!b.struck && b.stateT > 0.14) {
          b.struck = true;
          if (dist < S.size * 1.5 + 1.5) {
            bus.emit(EV.PLAYER_HURT, { beast: b, from: [b.x, b.z] });
          }
        }
        if (b.stateT > 0.34) {
          b.chain++;
          if (b.chain < S.chain && dist < S.size * 3) {
            b.state = 'wind'; b.stateT = 0;
          } else {
            b.state = 'recover'; b.stateT = 0;
          }
        }
        break;
      }

      /* --- the opening you get for having survived it ------------------ */
      case 'recover': {
        b.speed = damp(b.speed, 0.6, 7, dt);
        b.targetYaw = toPlayer;
        if (b.stateT >= S.recover) {
          b.state = 'stalk'; b.stateT = 0;
          b.cool = 0.25 + (1 - S.circle) * 0.5;
        }
        break;
      }
    }

    this._steerToTarget(b, dt);
    this._move(b, dt);
    const gait = b.state === 'strike' ? 'lunge'
      : b.state === 'wind' ? 'crouch'
        : b.speed > S.speed * 0.5 ? 'run' : b.speed > 0.4 ? 'walk' : 'idle';
    this._pose(b, dt, gait);
  }

  _wander(b) {
    const r = this.rnd;
    const a = r.range(0, TAU), d = r.range(4, 16);
    b.tx = b.x + Math.cos(a) * d;
    b.tz = b.z + Math.sin(a) * d;
  }

  _steerToTarget(b, dt) {
    const dx = b.tx - b.x, dz = b.tz - b.z;
    if (Math.hypot(dx, dz) > 0.4) b.targetYaw = Math.atan2(dx, dz);
  }

  _move(b, dt) {
    b.yaw = dampAngle(b.yaw, b.targetYaw, 7, dt);
    const nx = b.x + Math.sin(b.yaw) * b.speed * dt;
    const nz = b.z + Math.cos(b.yaw) * b.speed * dt;
    /* creatures keep out of water and off cliffs, and otherwise walk
       through the world the way the villagers do — they are not worth a
       pathfinder */
    if (this.world.terrain.waterAt(nx, nz) === null
      && this.world.terrain.slope(nx, nz, 1.5) < 0.72) {
      b.x = nx; b.z = nz;
    } else {
      b.targetYaw += 1.6;
    }
    b.y = damp(b.y, this.world.groundAt(b.x, b.z), 12, dt);
    b.rig.root.position.set(b.x, b.y, b.z);
    b.rig.root.rotation.y = b.yaw;
  }

  /* ---------------------------------------------------------------- pose */

  _pose(b, dt, gait) {
    const p = b.rig.parts;
    const S = b.spec;
    const speed = clamp01(b.speed / S.speed);
    b.phase = (b.phase + dt * lerp(2.4, 6.0, speed) * (gait === 'idle' ? 0.12 : 1)) % TAU;
    const ph = b.phase;

    /* a bound at speed, a walk below it — the same two-gait blend the fox
       uses, because it is what makes a quadruped read as an animal */
    const bound = smoothstep(clamp01((speed - 0.45) / 0.55));
    const amp = lerp(0.35, 0.95, speed);

    p.legs.forEach((leg, i) => {
      /* diagonal pairs at a walk; front pair / back pair at a bound */
      const walkOff = (i === 0 || i === 3) ? 0 : Math.PI;
      const boundOff = leg.front ? 0 : Math.PI * 0.62;
      const off = lerp(walkOff, boundOff, bound);
      const s = Math.sin(ph + off), c = Math.cos(ph + off);
      leg.hip.rotation.x = s * amp * (leg.front ? 1 : 0.9);
      leg.knee.rotation.x = clamp(0.28 + Math.max(0, -c) * amp * 1.5, 0.02, 1.7);
      leg.hock.rotation.x = clamp(-0.22 + c * 0.4 * amp, -1.2, 0.5);
    });

    const bob = Math.sin(ph * 2) * 0.035 * speed * (1 + bound);
    p.hip.position.y = b.rig.metrics.hipHeight + bob;
    p.hip.rotation.x = bound * 0.14;
    p.torso.rotation.x = -bound * 0.10 + Math.sin(ph * 2) * 0.04 * bound;

    /* --- what the gait does on top ------------------------------------ */
    if (gait === 'crouch') {
      /* THE TELL. Everything about a wind-up has to be readable from
         behind a tree: the head drops, the haunches gather, the whole
         animal gets shorter. This is the player's only warning. */
      const k = clamp01(b.stateT / Math.max(0.05, S.wind));
      p.hip.position.y = b.rig.metrics.hipHeight * (1 - 0.18 * k);
      p.neck.rotation.x = 0.34 * k;
      p.head.rotation.x = -0.18 * k;
      for (const leg of p.legs) leg.knee.rotation.x += 0.4 * k;
    } else if (gait === 'lunge') {
      const k = Math.sin(clamp01(b.stateT / 0.34) * Math.PI);
      p.hip.rotation.x = -0.22 * k;
      p.neck.rotation.x = -0.30 * k;
      p.head.rotation.x = 0.26 * k;
      for (const leg of p.legs) leg.hip.rotation.x += (leg.front ? -0.8 : 0.5) * k;
    } else {
      p.neck.rotation.x = lerp(0.10, -0.06, speed) + Math.sin(ph) * 0.03;
      p.head.rotation.x = Math.sin(ph * 2 + 1) * 0.04;
      /* they look at you when they are aware of you, which is the cheapest
         and most effective menace there is */
      if (b.state !== 'wander') p.head.rotation.y = 0;
    }

    if (p.tail[0]) {
      p.tail[0].rotation.x = lerp(-0.2, 0.35, speed) + (b.state === 'wind' ? -0.4 : 0);
      p.tail[0].rotation.y = Math.sin(ph * 0.8) * 0.18;
    }

    /* the flinch after a hit */
    if (b.flash > 0) {
      p.torso.rotation.z = Math.sin(b.flash * 30) * 0.12 * b.flash;
      p.head.rotation.z = Math.sin(b.flash * 26) * 0.2 * b.flash;
    }
  }

  /* ====================================================================== */
  /* BEING HIT                                                              */
  /* ====================================================================== */

  /**
   * The player swung. Anything in the arc takes it.
   *
   * DODGING IS RESOLVED HERE, not in the animator, so a dodge genuinely
   * means the blow did not land — a creature that plays a sidestep and
   * takes the damage anyway is a lie the player can feel.
   *
   * @returns how many were struck
   */
  strike(from, swing) {
    if (!swing) return 0;
    const hits = targetsInArc(from, this.list, swing);
    let n = 0;
    for (const h of hits) {
      const b = h.target;
      const S = b.spec;
      /* a charged blow is much harder to slip */
      const dodgeOdds = S.dodge * (swing.charge > 0 ? 0.35 : 1);
      if (b.state !== 'wind' && b.state !== 'strike' && this.rnd() < dodgeOdds) {
        /* it reads the swing and steps out of it */
        b.tx = b.x - Math.sin(from.yaw) * 5 + Math.cos(from.yaw) * (this.rnd.chance(0.5) ? 5 : -5);
        b.tz = b.z - Math.cos(from.yaw) * 5 - Math.sin(from.yaw) * (this.rnd.chance(0.5) ? 5 : -5);
        b.state = 'stalk'; b.stateT = 0; b.cool = 0.4;
        bus.emit(EV.BEAST_DODGED, { beast: b });
        continue;
      }
      n++;
      b.flash = 1;
      b.hp -= Math.max(1, Math.round((swing.damage ?? 6) / 6));
      /* knocked back, and out of whatever it was doing */
      const push = (swing.push ?? 1) * 1.4;
      b.x -= Math.sin(from.yaw) * -push * 0.35;
      b.z -= Math.cos(from.yaw) * -push * 0.35;
      b.state = 'recover'; b.stateT = 0; b.cool = 0.5;

      if (b.hp <= 0) {
        b.fleeing = true;
        this.routed++;
        bus.emit(EV.BEAST_ROUTED, { beast: b });
      } else if (S.calls) {
        /* IT SHOUTS FOR THE OTHERS. This is what makes a wolf pack a pack
           rather than three wolves that happen to be nearby. */
        for (const o of this.list) {
          if (o === b || o.spec.id !== S.id || o.fleeing) continue;
          if (Math.hypot(o.x - b.x, o.z - b.z) > 40) continue;
          if (o.state === 'wander') { o.state = 'stalk'; o.stateT = 0; }
        }
      }
    }
    return n;
  }

  /** The nearest creature that is actively hunting the player. */
  nearestThreat(x, z) {
    let best = null, bd = Infinity;
    for (const b of this.list) {
      if (b.fleeing || b.spec.harmless || b.state === 'wander') continue;
      const d = Math.hypot(b.x - x, b.z - z);
      if (d < bd) { bd = d; best = b; }
    }
    return best ? { beast: best, dist: bd } : null;
  }

  dispose() {
    this.group.parent?.remove(this.group);
    this.list.length = 0;
  }
}
