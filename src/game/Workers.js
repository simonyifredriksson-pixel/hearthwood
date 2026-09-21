/* Workers.js — the survey crew, and scaring them off.
   ===========================================================================
   The premise: the animals' village has been hidden under this forest for
   generations, and lately people have started coming in with saws and orange
   tape and measuring things. Nobody has found the village yet. That is the
   only stake the game has, and these are the only characters that threaten
   it, so what they DO matters more than what they look like:

     - they are always busy. A worker standing idle is scenery; a worker
       swinging an axe at a tree is a clock running down.
     - they leave marks. Stakes, tape, cones and a felled trunk stay behind
       after they have gone, so the forest remembers.
     - they are never hurt. A swing startles them; they stumble, drop what
       they were holding, and leave. The player is protecting a secret, not
       winning a fight, and the animation budget goes entirely into the
       stumble because that is the beat the player came for.

   A CAMP is the unit, not a worker. Workers alone in a wood read as lost
   people; three of them around a half-felled tree with a toolbox and a
   couple of stakes reads as an operation, which is the thing worth chasing
   off.
*/

import * as THREE from '../../lib/three.module.js?v=20260921164117';
import { buildWorker, buildWorkerProp } from '../art/HumanArt.js?v=20260921164117';
import { MeshBuilder } from '../art/Geo.js?v=20260921164117';
import { MATS } from '../art/Materials.js?v=20260921164117';
import { poseAnimal } from './Anim.js?v=20260921164117';
import { targetsInArc } from './Combat.js?v=20260921164117';
import { bus, EV } from '../core/Bus.js?v=20260921164117';
import { WORLD } from '../core/Config.js?v=20260921164117';
import { makeRng, clamp, clamp01, lerp, damp, dampAngle, TAU, hash2 } from '../core/Util.js?v=20260921164117';

/* How far out the crews work. Never inside the village bowl — the whole
   point is that they have NOT found it — and never past the mountains. */
const MIN_FROM_VILLAGE = 230;
const MAX_FROM_VILLAGE = 760;

const JOBS = ['chop', 'measure', 'mark', 'haul', 'stand'];

export class Workers {
  constructor(world, scene) {
    this.world = world;
    this.scene = scene;
    this.camps = [];
    this.list = [];
    this.group = new THREE.Group();
    this.group.name = 'workers';
    scene.add(this.group);
    this.scaredTotal = 0;
    this._t = 0;
  }

  /* ====================================================================== */
  /* SPAWNING                                                               */
  /* ====================================================================== */

  /**
   * Lay out the crews once, deterministically, so a camp is in the same
   * clearing every time you come back to it until you have cleared it.
   */
  plan(count = 7) {
    const V = WORLD.village;
    const r = makeRng(0x0bad1dea);
    const T = this.world.terrain;
    for (let i = 0; i < count; i++) {
      let x = 0, z = 0, ok = false;
      for (let tries = 0; tries < 60 && !ok; tries++) {
        const a = r.range(0, TAU);
        const d = r.range(MIN_FROM_VILLAGE, MAX_FROM_VILLAGE);
        x = V.cx + Math.cos(a) * d;
        z = V.cz + Math.sin(a) * d;
        if (Math.abs(x) > WORLD.half - 60 || Math.abs(z) > WORLD.half - 60) continue;
        if (T.slope(x, z, 3) > 0.30) continue;           // they need flat ground
        if (T.waterAt && T.waterAt(x, z)) continue;
        ok = true;
      }
      if (!ok) continue;
      this.camps.push({
        id: i, x, z,
        y: this.world.groundAt(x, z),
        seed: (0x0bad0000 + i * 7919) >>> 0,
        cleared: false,
        built: false,
        crew: [],
        props: [],
        radius: r.range(9, 15),
      });
    }
    return this.camps.length;
  }

  /** The nearest camp that still has anyone in it. */
  nearestCamp(x, z) {
    let best = null, bd = Infinity;
    for (const c of this.camps) {
      if (c.cleared) continue;
      const d = Math.hypot(c.x - x, c.z - z);
      if (d < bd) { bd = d; best = c; }
    }
    return best ? { camp: best, dist: bd } : null;
  }

  /* ====================================================================== */
  /* STREAMING                                                              */
  /* ====================================================================== */

  /** Build a camp's people and litter the first time the player comes near. */
  _build(camp) {
    if (camp.built) return;
    camp.built = true;
    const r = makeRng(camp.seed);
    const n = r.int(2, 4);

    for (let i = 0; i < n; i++) {
      const a = r.range(0, TAU);
      const d = r.range(2.5, camp.radius * 0.7);
      const x = camp.x + Math.cos(a) * d;
      const z = camp.z + Math.sin(a) * d;
      const rig = buildWorker({ seed: (camp.seed ^ (i * 977)) >>> 0 });
      this.group.add(rig.root);

      const job = r.pick(JOBS);
      const w = {
        rig, camp, job,
        x, z, y: this.world.groundAt(x, z),
        yaw: r.range(0, TAU),
        homeX: x, homeZ: z,
        t: r.range(0, 10),
        phase: r.range(0, TAU),
        speed: 0, moving: false,
        state: 'work',            // work | startled | flee | gone
        stateT: 0,
        radius: 0.45,
        down: false, fleeing: false,
        prop: null,
        scared: 0,
      };

      /* something in the hands, matched to the job */
      const propKind = job === 'chop' ? 'axe' : job === 'measure' ? 'clipboard'
        : job === 'mark' ? 'stake' : job === 'haul' ? 'saw' : null;
      if (propKind) {
        const pb = buildWorkerProp(propKind, { seed: (camp.seed ^ i * 31) >>> 0 });
        if (!pb.isEmpty) {
          const m = new THREE.Mesh(pb.build({ flat: false }), MATS.solid);
          m.castShadow = true;
          rig.parts.grip.add(m);
          w.prop = m;
        }
      }
      camp.crew.push(w);
      this.list.push(w);
    }

    /* --- the litter, which stays after they have gone ------------------- */
    const lit = new MeshBuilder();
    for (let i = 0; i < r.int(3, 6); i++) {
      const a = r.range(0, TAU), d = r.range(1, camp.radius);
      const px = Math.cos(a) * d, pz = Math.sin(a) * d;
      const kind = r.pick(['stake', 'cone', 'toolbox', 'stake']);
      const sub = buildWorkerProp(kind, { seed: (camp.seed ^ i * 7717) >>> 0 });
      const gy = this.world.groundAt(camp.x + px, camp.z + pz) - camp.y;
      lit.append(sub, new THREE.Matrix4().compose(
        new THREE.Vector3(px, gy, pz),
        new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), r.range(0, TAU)),
        new THREE.Vector3(1, 1, 1)));
    }
    if (!lit.isEmpty) {
      const m = new THREE.Mesh(lit.build({ flat: false }), MATS.solid);
      m.position.set(camp.x, camp.y, camp.z);
      m.castShadow = true; m.receiveShadow = true;
      this.group.add(m);
      camp.props.push(m);
    }
  }

  _unbuild(camp) {
    if (!camp.built) return;
    for (const w of camp.crew) {
      w.rig.root.parent?.remove(w.rig.root);
      const i = this.list.indexOf(w);
      if (i >= 0) this.list.splice(i, 1);
    }
    camp.crew.length = 0;
    // the litter stays: the forest remembers that they were here
    camp.built = false;
  }

  /* ====================================================================== */
  /* UPDATE                                                                 */
  /* ====================================================================== */

  update(dt, player) {
    this._t += dt;
    const px = player.x, pz = player.z;

    for (const camp of this.camps) {
      const d = Math.hypot(camp.x - px, camp.z - pz);
      if (!camp.cleared && d < 120 && !camp.built) this._build(camp);
      else if (camp.built && d > 190) this._unbuild(camp);
    }

    for (const w of this.list) this._updateWorker(dt, w, player);
  }

  _updateWorker(dt, w, player) {
    w.t += dt;
    w.stateT += dt;
    const dxp = player.x - w.x, dzp = player.z - w.z;
    const distP = Math.hypot(dxp, dzp);

    /* --- STARTLED: they notice an animal running at them with a stick --- */
    if (w.state === 'work' && distP < 7 && player.weapon) {
      w.state = 'alert'; w.stateT = 0;
    } else if (w.state === 'alert' && distP > 13) {
      w.state = 'work'; w.stateT = 0;
    }

    if (w.state === 'startled' && w.stateT > 0.75) {
      w.state = 'flee'; w.stateT = 0;
      w.fleeing = true;
    }

    /* --- what they are doing -------------------------------------------- */
    let wantX = w.homeX, wantZ = w.homeZ, run = false;

    if (w.state === 'flee') {
      /* straight away from the player and out of the wood. They do not
         fight back, ever — the whole encounter is a fright, not a battle. */
      const a = Math.atan2(-dxp, -dzp);
      wantX = w.x + Math.sin(a) * 40;
      wantZ = w.z + Math.cos(a) * 40;
      run = true;
      if (w.stateT > 9) {
        w.state = 'gone';
        w.rig.root.visible = false;
      }
    } else if (w.state === 'alert') {
      // back off a couple of steps and watch
      const a = Math.atan2(-dxp, -dzp);
      wantX = w.homeX + Math.sin(a) * 3;
      wantZ = w.homeZ + Math.cos(a) * 3;
    } else if (w.job === 'haul' || w.job === 'mark') {
      // wander the camp on a slow loop
      const a = w.phase + w.t * 0.24;
      wantX = w.camp.x + Math.cos(a) * w.camp.radius * 0.55;
      wantZ = w.camp.z + Math.sin(a) * w.camp.radius * 0.55;
    }

    /* --- move ------------------------------------------------------------ */
    const dx = wantX - w.x, dz = wantZ - w.z;
    const dist = Math.hypot(dx, dz);
    const target = run ? 5.6 : 1.5;
    if (dist > 0.4) {
      const nx = dx / dist, nz = dz / dist;
      w.speed = damp(w.speed, target, 7, dt);
      w.x += nx * w.speed * dt;
      w.z += nz * w.speed * dt;
      w.yaw = dampAngle(w.yaw, Math.atan2(nx, nz), run ? 9 : 5, dt);
      w.moving = true;
    } else {
      w.speed = damp(w.speed, 0, 9, dt);
      w.moving = w.speed > 0.2;
      if (w.state === 'work' && w.job === 'stand') {
        // turn slowly on the spot, looking at the trees
        w.yaw += Math.sin(w.t * 0.35 + w.phase) * dt * 0.5;
      }
    }
    w.y = this.world.groundAt(w.x, w.z);

    /* --- pose ------------------------------------------------------------ */
    const rel = clamp01(w.speed / 5.6);
    let action = null, actionT = 0;
    if (w.state === 'startled') {
      action = 'startle';
      actionT = clamp01(w.stateT / 0.75);
    } else if (w.state === 'work' && !w.moving) {
      if (w.job === 'chop') { action = 'chop'; actionT = (w.t * 0.9 + w.phase) % 1; }
      else if (w.job === 'measure') { action = 'measure'; actionT = (w.t * 0.3) % 1; }
    }

    poseAnimal(w.rig, {
      t: w.t, dt, speed: rel, moving: w.moving, grounded: true,
      yaw: w.yaw, action, actionT,
      lookAt: (w.state === 'alert' || w.state === 'startled')
        ? [player.x, player.y + 0.4, player.z] : null,
    });
    applyWorkerAction(w, action, actionT);

    w.rig.root.position.set(w.x, w.y, w.z);
    w.rig.root.rotation.y = w.yaw;
  }

  /* ====================================================================== */
  /* BEING SCARED OFF                                                       */
  /* ====================================================================== */

  /**
   * The player has swung at something. Startle whatever was in the arc.
   *
   * @returns {number} how many were sent packing
   */
  strike(from, swing) {
    const hits = targetsInArc(from, this.list.filter(w => w.state === 'work' || w.state === 'alert'), swing);
    let n = 0;
    for (const h of hits) {
      const w = h.target;
      w.state = 'startled';
      w.stateT = 0;
      w.scared++;
      n++;
      /* they drop whatever they were holding — the tool stays in the wood,
         which is both a souvenir and proof the encounter happened */
      if (w.prop) {
        const m = w.prop;
        const wp = new THREE.Vector3();
        m.getWorldPosition(wp);
        m.parent.remove(m);
        m.position.copy(wp);
        m.rotation.set(Math.PI * 0.42, w.yaw + 0.6, 0.2);
        m.position.y = this.world.groundAt(wp.x, wp.z) + 0.04;
        this.group.add(m);
        w.camp.props.push(m);
        w.prop = null;
      }
      bus.emit(EV.WORKER_SCARED, { worker: w, camp: w.camp });
      if (n >= 3) break;
    }

    /* THE CAMP PANICS.
       Requiring the player to land a separate hit on every member of a crew
       turns the best moment in the game into admin — they scatter the
       instant they are startled, so chasing the last one across a clearing
       is four seconds of running at somebody's back. If one of them is sent
       running by something coming out of the undergrowth, the rest put their
       tools down too. That is also simply what people do. */
    if (n) {
      const seen = new Set(hits.map(h => h.target.camp));
      for (const camp of seen) {
        for (const other of camp.crew) {
          if (other.state === 'flee' || other.state === 'gone' || other.state === 'startled') continue;
          const d = Math.hypot(other.x - from.x, other.z - from.z);
          if (d > 16) continue;         // out of sight, still working
          other.state = 'startled';
          // staggered, so the camp empties raggedly rather than in lockstep
          other.stateT = -Math.random() * 0.5;
          other.scared++;
          bus.emit(EV.WORKER_SCARED, { worker: other, camp, secondhand: true });
          n++;
        }
      }
    }

    if (n) this.scaredTotal += n;
    this._checkCleared();
    return n;
  }

  _checkCleared() {
    for (const camp of this.camps) {
      if (camp.cleared || !camp.built || !camp.crew.length) continue;
      const left = camp.crew.filter(w => w.state !== 'flee' && w.state !== 'gone' && w.state !== 'startled');
      if (!left.length) {
        camp.cleared = true;
        bus.emit(EV.CAMP_CLEARED, { camp, total: this.camps.filter(c => c.cleared).length });
      }
    }
  }

  get clearedCount() { return this.camps.filter(c => c.cleared).length; }
}

/* ========================================================================= */
/* THE POSES THE ANIMAL ANIMATOR DOES NOT HAVE                               */
/* ========================================================================= */

/**
 * Chopping, measuring and — the one that matters — the stumble.
 *
 * Applied after poseAnimal, so the gait and the head-turn have already run
 * and this only has to write the arms and the lean.
 */
function applyWorkerAction(w, action, t) {
  const p = w.rig.parts;
  if (!p.arms?.length) return;
  const A = p.arms[1], B = p.arms[0];

  if (action === 'chop') {
    /* a two-handed swing into a trunk, with the recoil after it bites */
    const up = Math.pow(clamp01(t / 0.55), 0.7);
    const down = clamp01((t - 0.55) / 0.16);
    const rest = clamp01((t - 0.71) / 0.29);
    const s = up - down * 1.6 + rest * 0.6;
    A.shoulder.rotation.x = -0.5 - s * 1.5;
    B.shoulder.rotation.x = -0.4 - s * 1.35;
    A.shoulder.rotation.z = A.side * 0.16;
    B.shoulder.rotation.z = B.side * 0.30;
    A.elbow.rotation.x = -0.7 + s * 0.35;
    B.elbow.rotation.x = -0.9 + s * 0.4;
    p.torso.rotation.y = s * 0.22;
    p.hip.rotation.x = 0.12 + (1 - s) * 0.16;
  } else if (action === 'measure') {
    /* holding a clipboard up and writing on it */
    B.shoulder.rotation.x = -1.15;
    B.shoulder.rotation.z = B.side * 0.34;
    B.elbow.rotation.x = -1.5;
    A.shoulder.rotation.x = -0.95 + Math.sin(t * TAU * 3) * 0.12;
    A.shoulder.rotation.z = A.side * 0.22;
    A.elbow.rotation.x = -1.7;
    p.head.rotation.x = 0.35;
  } else if (action === 'startle') {
    /* THE WHOLE POINT. Arms up and out, body back on its heels, head
       snapped round. Big, readable, and over in three quarters of a
       second — long enough to see, short enough not to be a cutscene. */
    const jolt = Math.pow(1 - t, 0.4);
    const back = Math.sin(clamp01(t * 1.6) * Math.PI) * jolt;
    A.shoulder.rotation.x = -2.4 * jolt;
    B.shoulder.rotation.x = -2.35 * jolt;
    A.shoulder.rotation.z = A.side * (0.9 * jolt);
    B.shoulder.rotation.z = B.side * (0.95 * jolt);
    A.elbow.rotation.x = -0.35;
    B.elbow.rotation.x = -0.30;
    p.hip.rotation.x = -0.34 * back;
    p.torso.rotation.x = -0.22 * back;
    p.head.rotation.x = -0.30 * jolt;
    for (const leg of p.legs) leg.knee.rotation.x = 0.55 * back;
  }
}
