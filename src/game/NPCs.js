/* NPCs.js — the village going about its day.
   ===========================================================================
   Twenty-odd villagers and a dozen animals, each with a job that puts them
   somewhere doing something. Nobody stands still waiting to be spoken to.

   THE BEHAVIOUR IS DELIBERATELY SHALLOW and the presentation deliberately is
   not. A villager picks a destination, walks there, does a small looping
   animation for a while, and picks another — that is the whole brain. What
   makes it read as a living village is everything around it:

     - THEY LOOK AT YOU when you pass, and go back to work when you have gone.
       One head turn is worth more than any amount of pathfinding.
     - THEY GATHER. Two villagers whose paths cross will stop and talk, and
       a pair standing together talking is the single strongest signal that
       a place is inhabited.
     - THEY CARRY THINGS. An empty-handed crowd looks like a crowd waiting;
       a villager with an armful of firewood looks like a villager.
     - THEY ARE WHERE THE WORK IS. Stall-holders stand behind their stalls,
       the sweeper is on the path, the children are on the green.

   Villagers do not collide with anything. They walk routes the layout
   already guarantees are clear, and a villager stuck on a barrel for an hour
   is far worse than one who walks through the corner of a flowerbed.
*/

import * as THREE from '../../lib/three.module.js?v=20260921163240';
import { buildVillager, buildCritter } from '../art/VillagerArt.js?v=20260921163240';
import { VILLAGERS, CRITTERS, STICKWRIGHT, FISHERMAN, SMALL_TALK } from '../data/VillagerData.js?v=20260921163240';
import { MeshBuilder, blob, tube } from '../art/Geo.js?v=20260921163240';
import { MATS } from '../art/Materials.js?v=20260921163240';
import { BARK, BUILD, mixHex } from '../art/Palette.js?v=20260921163240';
import { riverX, riverLevel } from '../world/Terrain.js?v=20260921163240';
import { WORLD } from '../core/Config.js?v=20260921163240';
import { makeRng, clamp, clamp01, lerp, damp, dampAngle, angleDelta, TAU, smoothstep } from '../core/Util.js?v=20260921163240';

const UP = new THREE.Vector3(0, 1, 0);

/* ========================================================================= */

export class NPCs {
  constructor(world, scene) {
    this.world = world;
    this.scene = scene;
    this.list = [];
    this.critters = [];
    this.t = 0;
    this.rnd = makeRng(0x4e9c5);
    this.group = new THREE.Group();
    scene.add(this.group);
  }

  /* ====================================================================== */
  /* SPAWN                                                                  */
  /* ====================================================================== */


  /**
   * A place to stand and fish: on the bank, facing the water.
   *
   * Walks outward from the river centreline until the ground rises clear of
   * the water line, then steps back half a metre so he is ON the bank rather
   * than in it. Searching for the bank beats hard-coding a coordinate,
   * because the river is carved procedurally and moves whenever the terrain
   * seed does.
   */
  _bankSpot() {
    const W = this.world;
    const V = WORLD.village;

    /* THE BOOTH DECIDES, NOT THIS FUNCTION.
       The village builder puts a fishing booth on the bank and records
       where its keeper stands. Working it out a second time here is how the
       fisherman ended up standing two metres to the left of his own shop.
       Everything below is the fallback for a world built without one. */
    const A = W.village?.anchors?.fishery || W.anchors?.fishery;
    if (A) {
      return {
        x: A.standAt[0], z: A.standAt[1], y: W.groundAt(A.standAt[0], A.standAt[1]),
        yaw: A.yaw, booth: A,
        depth: 0.55, remoteness: 0.25, seed: 0xf15a21,
      };
    }

    // a stretch of river near the village, but out of the busy middle
    const z = V.cz + 34;
    const cx = riverX(z);
    const lvl = riverLevel(z);
    /* Ask the world for its ground however it exposes it. The contact-sheet
       renderer hands NPCs a cut-down world object with no `.terrain` on it,
       and a fisherman is not worth crashing a render over. */
    const groundAt = (x, zz) => (W.terrain ? W.terrain.height(x, zz) : W.groundAt(x, zz));
    for (const side of [1, -1]) {
      for (let d = WORLD.river.width * 0.4; d < WORLD.river.bankWidth * 2.4; d += 0.4) {
        const x = cx + side * d;
        const h = groundAt(x, z);
        if (h > lvl + 0.35) {
          const bx = cx + side * (d + 0.55);
          return {
            x: bx, z,
            y: W.groundAt(bx, z),
            // facing the water
            yaw: Math.atan2(-side, 0),
            depth: 0.55, remoteness: 0.25,
            seed: 0xf15a21,
          };
        }
      }
    }
    return { x: cx + 6, z, y: W.groundAt(cx + 6, z), yaw: -Math.PI / 2, depth: 0.5, remoteness: 0.25, seed: 1 };
  }

  spawn() {
    const W = this.world;
    const spots = W.npcSpots || [];
    const byKind = k => spots.filter(s => s.kind === k);
    const r = this.rnd;

    const doors = r.shuffle(byKind('door'));
    const sits = r.shuffle(byKind('sit'));
    const stalls = r.shuffle(byKind('stall'));
    const wells = byKind('well');
    const fires = byKind('fire');

    let doorI = 0, sitI = 0, stallI = 0;

    /* --- the Stickwright, first and in her own shop --------------------- */
    {
      const spot = byKind('stickwright')[0]
        || { x: W.village.anchors?.stickwright?.x ?? 0, z: W.village.anchors?.stickwright?.z ?? 0, yaw: 0 };
      const npc = this._make(STICKWRIGHT, spot.x, spot.z, spot.yaw, 'stickwright');
      npc.isStickwright = true;
      npc.home = { x: spot.x, z: spot.z, yaw: spot.yaw };
      this.stickwright = npc;
    }

    /* --- the Fisherman, on the bank -------------------------------------
       Placed against the RIVER rather than in a village slot: he is the one
       villager whose whole character is where he is standing, and a fisherman
       assigned to a market stall would be nonsense. The bank is found by
       walking out from the bridge until the ground is just above the water. */
    {
      const spot = this._bankSpot();
      const npc = this._make(FISHERMAN, spot.x, spot.z, spot.yaw, 'shopkeep');
      npc.isFisherman = true;
      npc.home = { x: spot.x, z: spot.z, yaw: spot.yaw };
      npc.fishSpot = spot;
      npc.booth = spot.booth || null;
      this.fisherman = npc;
    }

    /* --- everybody else -------------------------------------------------- */
    for (const def of VILLAGERS) {
      let spot = null;
      switch (def.job) {
        case 'market': spot = stalls[stallI++ % Math.max(1, stalls.length)]; break;
        case 'sit': spot = sits[sitI++ % Math.max(1, sits.length)]; break;
        case 'well': spot = wells[0]; break;
        case 'play': spot = { x: W.plan.plaza.x + r.range(-9, 9), z: W.plan.plaza.z + r.range(-9, 9), yaw: r.range(0, TAU) }; break;
        default: spot = doors[doorI++ % Math.max(1, doors.length)];
      }
      if (!spot) spot = { x: W.plan.plaza.x + r.range(-12, 12), z: W.plan.plaza.z + r.range(-12, 12), yaw: 0 };
      const npc = this._make(def, spot.x, spot.z, spot.yaw ?? 0, def.job);
      npc.home = { x: spot.x, z: spot.z, yaw: spot.yaw ?? 0 };
      npc.anchorKind = spot.kind;
    }

    /* --- livestock -------------------------------------------------------- */
    for (const c of CRITTERS) {
      for (let i = 0; i < c.n; i++) {
        const a = r.range(0, TAU), d = r.range(6, 70);
        const x = W.plan.plaza.x + Math.cos(a) * d, z = W.plan.plaza.z + Math.sin(a) * d;
        const rig = buildCritter({ kind: c.kind, seed: r.seed() });
        rig.root.position.set(x, W.groundAt(x, z), z);
        this.group.add(rig.root);
        this.critters.push({
          rig, x, z, yaw: r.range(0, TAU), kind: c.kind,
          tx: x, tz: z, wait: r.range(0, 3), speed: c.kind === 'cat' ? 1.5 : 0.7,
          bob: r.range(0, TAU), home: { x, z },
        });
      }
    }

    return this;
  }

  _make(def, x, z, yaw, job) {
    const rig = buildVillager({
      kind: def.kind, outfit: def.outfit || 'smock',
      seed: def.seed ?? (def.name.length * 7919 + def.kind.length * 31),
      scale: def.scale ?? 1, cloth: def.cloth ?? null,
    });
    rig.root.position.set(x, this.world.groundAt(x, z), z);
    rig.root.rotation.y = yaw;
    this.group.add(rig.root);

    const npc = {
      def, rig, job, name: def.name, title: def.title || null,
      x, z, y: rig.root.position.y, yaw, targetYaw: yaw,
      tx: x, tz: z, speed: 0, wait: this.rnd.range(0, 6),
      state: 'idle', phase: this.rnd.range(0, TAU),
      carry: null, talkTo: null, talkT: 0,
      lineIdx: this.rnd.int(0, 99), said: 0,
      voice: def.voice ?? (0.8 + (def.kind.length % 5) * 0.12),
      anim: { speedS: 0, blink: 0, nextBlink: this.rnd.range(1, 4), breathe: this.rnd.range(0, TAU), work: 0 },
    };

    /* what they are holding — the fastest way to say what somebody does */
    if (job === 'carry') npc.carry = this._makeCarry('firewood');
    else if (job === 'sweeper') npc.carry = this._makeCarry('broom');
    else if (job === 'well') npc.carry = this._makeCarry('bucket');
    else if (job === 'forester') npc.carry = this._makeCarry('axe');
    else if (job === 'fisher') npc.carry = this._makeCarry('rod');
    else if (job === 'baker') npc.carry = this._makeCarry('basket');
    if (npc.carry) rig.parts.grip.add(npc.carry);

    this.list.push(npc);
    return npc;
  }

  _makeCarry(kind) {
    const b = new MeshBuilder();
    const r = this.rnd;
    if (kind === 'firewood') {
      for (let i = 0; i < 6; i++) {
        b.color(mixHex(BARK.oak, BARK.hazel, r()), 0.1, r);
        const y = 0.02 + (i % 3) * 0.055, x = ((i / 3) | 0) * 0.055;
        tube(b, {
          pts: [[x - 0.20, y, 0], [x + 0.20, y + r.range(-0.02, 0.02), 0]],
          radius: () => 0.026, radial: 5, capStart: true, capEnd: true, sway: () => 0,
        });
      }
    } else if (kind === 'broom') {
      b.color(BARK.hazel, 0.08, r);
      tube(b, { pts: [[0, -0.15, 0], [0, 1.0, 0]], radius: () => 0.018, radial: 5, capStart: true, capEnd: true, sway: () => 0 });
      for (let i = 0; i < 18; i++) {
        const a = r.range(0, TAU), sp = r.range(0.02, 0.09);
        b.color(mixHex(BUILD.thatch, BARK.deadWood, r()), 0.1, r);
        tube(b, {
          pts: [[0, -0.10, 0], [Math.cos(a) * sp, -0.34, Math.sin(a) * sp]],
          radius: t => 0.006 * (1 - t * 0.5), radial: 3, capStart: false, capEnd: false, sway: () => 0,
        });
      }
      b.color(BUILD.rope, 0.06, r);
      tube(b, { pts: [[0, -0.10, 0], [0, -0.06, 0]], radius: () => 0.026, radial: 6, capStart: true, capEnd: true, sway: () => 0 });
    } else if (kind === 'bucket') {
      b.color(BUILD.plank, 0.07, r);
      tube(b, { pts: [[0, -0.02, 0], [0, 0.20, 0]], radius: t => lerp(0.10, 0.12, t), radial: 9, capStart: true, capEnd: false, sway: () => 0 });
      b.color(0x2f4a4e, 0.04, r);
      blob(b, 0, 0.17, 0, 0.11, 2, 8, (x, y, z) => [1, 0.05, 1]);
    } else if (kind === 'axe') {
      b.color(BARK.oak, 0.07, r);
      tube(b, { pts: [[0, -0.1, 0], [0, 0.45, 0]], radius: () => 0.018, radial: 5, capStart: true, capEnd: true, sway: () => 0 });
      b.color(0x6a6e74, 0.05, r);
      blob(b, 0.05, 0.44, 0, 0.07, 3, 6, (x, y, z) => [1.5, 0.9, 0.35]);
    } else if (kind === 'rod') {
      b.color(BARK.hazel, 0.08, r);
      tube(b, { pts: [[0, -0.1, 0], [0.1, 0.7, 0], [0.26, 1.25, 0]], radius: t => 0.016 * (1 - t * 0.6), radial: 4, capStart: true, capEnd: true, sway: () => 0 });
    } else {
      b.color(BUILD.thatch, 0.08, r);
      tube(b, { pts: [[0, 0, 0], [0, 0.16, 0]], radius: t => lerp(0.13, 0.16, t), radial: 9, capStart: true, capEnd: false, sway: () => 0 });
      b.color(mixHex(0xbf8f4a, 0xd8b06a, 0.5), 0.08, r);
      blob(b, 0, 0.17, 0, 0.11, 3, 6, (x, y, z) => [1, 0.5, 1]);
    }
    const m = new THREE.Mesh(b.build({ flat: false }), MATS.item);
    m.castShadow = true;
    m.position.set(0, 0, 0);
    m.rotation.set(-0.3, 0, 0.15);
    return m;
  }

  /* ====================================================================== */
  /* UPDATE                                                                 */
  /* ====================================================================== */

  update(dt, player) {
    this.t += dt;
    const px = player.x, pz = player.z;

    for (const npc of this.list) {
      // far-away villagers tick slowly: they are a few pixels tall and their
      // legs are not the thing keeping the frame rate honest
      const d2 = (npc.x - px) * (npc.x - px) + (npc.z - pz) * (npc.z - pz);
      if (d2 > 160 * 160) { npc.rig.root.visible = false; continue; }
      npc.rig.root.visible = true;
      /* A cutscene director has taken this one over and is posing it itself.
         Running the village brain underneath would fight it for every joint
         and walk her back to her bench in the middle of a hammer stroke. */
      if (npc.cutscene) continue;
      const far = d2 > 55 * 55;
      this._think(npc, far ? dt * 0.5 : dt, px, pz);
      this._move(npc, dt);
      this._pose(npc, dt, px, pz, far);
    }

    for (const c of this.critters) this._critter(c, dt, px, pz);
  }

  /* --------------------------------------------------------------- brain */

  _think(npc, dt, px, pz) {
    npc.wait -= dt;
    if (npc.talkTo) {
      npc.talkT -= dt;
      if (npc.talkT <= 0) { npc.talkTo.talkTo = null; npc.talkTo = null; npc.wait = this.rnd.range(1, 4); }
      return;
    }
    if (npc.wait > 0) return;

    const r = this.rnd;
    const W = this.world;
    const home = npc.home;

    switch (npc.job) {
      case 'stickwright':
        // she never leaves the bench, she just works at it
        npc.tx = home.x; npc.tz = home.z;
        npc.state = 'work';
        npc.wait = r.range(3, 8);
        break;

      case 'market':
        // behind the stall, shifting a step now and then
        npc.tx = home.x + r.range(-0.45, 0.45);
        npc.tz = home.z + r.range(-0.35, 0.35);
        npc.state = 'work';
        npc.wait = r.range(4, 11);
        break;

      /* A SHOPKEEPER DOES NOT GO ANYWHERE.
         The fisherman is the busiest NPC in the game and the player arrives
         carrying things to sell him, so he is always behind his booth. He
         shifts about within half a metre of his mark and turns back to face
         the water when he settles — which reads as somebody minding a shop
         rather than as somebody standing to attention. */
      case 'shopkeep':
        npc.tx = home.x + r.range(-0.42, 0.42);
        npc.tz = home.z + r.range(-0.30, 0.30);
        npc.state = r.chance(0.35) ? 'work' : 'idle';
        npc.wait = r.range(3, 9);
        break;

      case 'sit':
        npc.tx = home.x; npc.tz = home.z;
        npc.state = 'sit';
        npc.wait = r.range(8, 20);
        break;

      case 'sweeper':
        // works his way along a path, then back
        npc.state = 'sweep';
        npc.tx = home.x + r.range(-11, 11);
        npc.tz = home.z + r.range(-11, 11);
        npc.wait = r.range(4, 9);
        break;

      case 'play': {
        // children run, stop, and run somewhere else. Short legs, short plans.
        const p = W.plan.plaza;
        npc.tx = p.x + r.range(-13, 13);
        npc.tz = p.z + r.range(-13, 13);
        npc.state = 'run';
        npc.wait = r.range(1.5, 4);
        break;
      }

      case 'carry':
      case 'wander':
      case 'forester':
      case 'chat': {
        // a proper errand: pick a landmark and walk to it
        const dests = this._destinations();
        const d = r.pick(dests);
        npc.tx = d.x + r.range(-2.5, 2.5);
        npc.tz = d.z + r.range(-2.5, 2.5);
        npc.state = 'walk';
        npc.wait = r.range(6, 16);
        // and sometimes stop to talk to whoever is nearest
        if (npc.job === 'chat' && r.chance(0.5)) this._tryTalk(npc);
        break;
      }

      default:
        npc.tx = home.x + r.range(-4, 4);
        npc.tz = home.z + r.range(-4, 4);
        npc.state = r.chance(0.5) ? 'walk' : 'work';
        npc.wait = r.range(5, 14);
    }
  }

  _destinations() {
    if (this._dests) return this._dests;
    const W = this.world;
    const out = [{ x: W.plan.plaza.x, z: W.plan.plaza.z }];
    for (const s of (W.npcSpots || [])) if (s.kind === 'door' || s.kind === 'well' || s.kind === 'fire') out.push(s);
    for (const lot of W.plan.lots) if (lot.door) out.push({ x: lot.door[0], z: lot.door[1] });
    this._dests = out;
    return out;
  }

  /** Two villagers who happen to be near each other stop and have a word. */
  _tryTalk(npc) {
    for (const o of this.list) {
      if (o === npc || o.talkTo || o.isStickwright) continue;
      const d = Math.hypot(o.x - npc.x, o.z - npc.z);
      if (d > 7 || d < 1.2) continue;
      npc.talkTo = o; o.talkTo = npc;
      npc.talkT = o.talkT = this.rnd.range(5, 12);
      npc.tx = lerp(npc.x, o.x, 0.32); npc.tz = lerp(npc.z, o.z, 0.32);
      o.tx = lerp(o.x, npc.x, 0.32); o.tz = lerp(o.z, npc.z, 0.32);
      npc.state = o.state = 'talk';
      return true;
    }
    return false;
  }

  /* --------------------------------------------------------------- motion */

  _move(npc, dt) {
    const dx = npc.tx - npc.x, dz = npc.tz - npc.z;
    const d = Math.hypot(dx, dz);
    const want = npc.state === 'run' ? 2.6
      : npc.state === 'sit' || npc.state === 'work' || npc.state === 'talk' || npc.state === 'idle' ? 0.55
        : 1.15;

    if (d > 0.22) {
      const sp = Math.min(want, d * 2.5);
      npc.speed = damp(npc.speed, sp, 6, dt);
      npc.x += (dx / d) * npc.speed * dt;
      npc.z += (dz / d) * npc.speed * dt;
      npc.targetYaw = Math.atan2(dx, dz);
    } else {
      npc.speed = damp(npc.speed, 0, 9, dt);
      if (npc.talkTo) npc.targetYaw = Math.atan2(npc.talkTo.x - npc.x, npc.talkTo.z - npc.z);
      else if (npc.home && (npc.job === 'market' || npc.job === 'stickwright' || npc.job === 'shopkeep')) {
        npc.targetYaw = npc.home.yaw;
      }
    }

    npc.yaw = dampAngle(npc.yaw, npc.targetYaw, 6, dt);
    npc.y = damp(npc.y, this.world.groundAt(npc.x, npc.z), 12, dt);
    npc.rig.root.position.set(npc.x, npc.y, npc.z);
    npc.rig.root.rotation.y = npc.yaw;
  }

  /* ---------------------------------------------------------------- pose */

  _pose(npc, dt, px, pz, far) {
    const p = npc.rig.parts;
    const A = npc.anim;
    const H = npc.rig.metrics.height;
    A.speedS = damp(A.speedS, npc.speed / 2.6, 8, dt);
    A.breathe += dt * 1.4;
    A.blink = Math.max(0, A.blink - dt * 7);
    A.nextBlink -= dt;
    if (A.nextBlink <= 0) { A.blink = 1; A.nextBlink = this.rnd.range(1.8, 6); }

    const ph = (npc.phase += dt * lerp(2.0, 5.0, A.speedS)) ;
    const amp = A.speedS * 0.6;

    /* legs and arms: a plain biped walk, which is all a villager needs */
    p.legs.forEach((leg, i) => {
      const s = Math.sin(ph + (i ? Math.PI : 0));
      leg.hip.rotation.x = s * amp;
      leg.knee.rotation.x = clamp(0.15 + Math.max(0, -Math.cos(ph + (i ? Math.PI : 0))) * amp * 1.5, 0.02, 1.2);
      leg.ankle.rotation.x = -s * amp * 0.3;
    });
    p.arms.forEach((arm, i) => {
      const s = Math.sin(ph + (i ? 0 : Math.PI));
      const holding = arm.side > 0 && npc.carry;
      arm.shoulder.rotation.x = holding ? -0.65 : s * amp * 0.75 - 0.05;
      arm.shoulder.rotation.z = arm.side * 0.14;
      arm.elbow.rotation.x = holding ? -1.05 : -0.25 - Math.max(0, s) * amp * 0.4;
    });
    p.hip.position.y = npc.rig.metrics.hipHeight - Math.abs(Math.cos(ph)) * 0.02 * A.speedS * H;
    p.torso.rotation.z = Math.sin(ph) * 0.03 * A.speedS;
    p.torso.rotation.x = A.speedS * 0.09;

    if (far) return;

    /* --- the job animation, which is what you actually notice ------------ */
    A.work += dt;
    switch (npc.state) {
      case 'work': {
        if (npc.isStickwright) {
          // long strokes of a drawknife, then a pause to look at the work
          const c = (A.work % 4.5) / 4.5;
          const stroke = c < 0.7 ? Math.sin(c / 0.7 * Math.PI * 3) : 0;
          for (const arm of p.arms) {
            arm.shoulder.rotation.x = -0.55 + stroke * 0.38;
            arm.elbow.rotation.x = -0.75 - stroke * 0.5;
            arm.shoulder.rotation.z = arm.side * 0.3;
          }
          p.torso.rotation.x = 0.30 + stroke * 0.10;
          p.head.rotation.x = 0.34;
        } else {
          const c = Math.sin(A.work * 1.6);
          p.arms[1].shoulder.rotation.x = -0.5 + c * 0.25;
          p.arms[1].elbow.rotation.x = -0.9 - c * 0.2;
          p.arms[0].shoulder.rotation.x = -0.3 - c * 0.2;
          p.torso.rotation.x = 0.16;
        }
        break;
      }
      case 'sweep': {
        const c = Math.sin(A.work * 2.6);
        for (const arm of p.arms) {
          arm.shoulder.rotation.x = -0.45 + c * 0.35;
          arm.elbow.rotation.x = -0.8;
          arm.shoulder.rotation.z = arm.side * 0.25 + c * 0.2;
        }
        p.torso.rotation.x = 0.30;
        p.torso.rotation.y = c * 0.22;
        p.head.rotation.x = 0.35;
        break;
      }
      case 'sit': {
        p.hip.position.y = npc.rig.metrics.hipHeight * 0.55;
        for (const leg of p.legs) { leg.hip.rotation.x = -1.35; leg.knee.rotation.x = 1.5; }
        for (const arm of p.arms) { arm.shoulder.rotation.x = -0.15; arm.elbow.rotation.x = -0.45; }
        p.torso.rotation.x = 0.05 + Math.sin(A.breathe * 0.6) * 0.02;
        break;
      }
      case 'talk': {
        // one of the pair gestures while the other listens, and they swap
        const lead = (Math.floor(this.t / 3.5) % 2 === 0) === (npc.x < (npc.talkTo?.x ?? 0));
        const c = Math.sin(this.t * 3.4 + npc.phase);
        if (lead) {
          p.arms[1].shoulder.rotation.x = -0.55 + c * 0.3;
          p.arms[1].shoulder.rotation.z = 0.35;
          p.arms[1].elbow.rotation.x = -1.0 - c * 0.25;
          p.head.rotation.y = c * 0.14;
        } else {
          p.head.rotation.x = 0.06 + Math.sin(this.t * 1.1) * 0.05;
          p.head.rotation.z = Math.sin(this.t * 0.7) * 0.05;
        }
        break;
      }
    }

    /* --- the head turn. One line of code, enormous payoff. --------------- */
    const dx = px - npc.x, dz = pz - npc.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 11 && dist > 0.4) {
      let d = Math.atan2(dx, dz) - npc.yaw;
      while (d > Math.PI) d -= TAU;
      while (d < -Math.PI) d += TAU;
      if (Math.abs(d) < 1.3) {
        const w = clamp01(1 - dist / 11);
        p.head.rotation.y = lerp(p.head.rotation.y, clamp(d, -0.8, 0.8), w * 0.5);
        if (p.neck) p.neck.rotation.y = lerp(p.neck.rotation.y || 0, clamp(d, -0.4, 0.4) * 0.4, w * 0.4);
      }
    }

    /* ears flick, because still ears are dead ears */
    if (p.ears?.length) {
      for (let i = 0; i < p.ears.length; i++) {
        const s = i === 0 ? -1 : 1;
        p.ears[i].rotation.z = s * (0.12 + Math.sin(this.t * (1.7 + i * 0.4) + npc.phase) * 0.10);
        p.ears[i].rotation.x = -0.05 - A.speedS * 0.12;
      }
    }
  }

  /* ------------------------------------------------------------- critters */

  _critter(c, dt, px, pz) {
    const d2 = (c.x - px) * (c.x - px) + (c.z - pz) * (c.z - pz);
    if (d2 > 90 * 90) { c.rig.root.visible = false; return; }
    c.rig.root.visible = true;

    c.wait -= dt;
    if (c.wait <= 0) {
      // chickens peck and dart; cats stroll and then sit for ages
      const rad = c.kind === 'cat' ? 9 : 4.5;
      c.tx = c.home.x + this.rnd.range(-rad, rad);
      c.tz = c.home.z + this.rnd.range(-rad, rad);
      c.wait = c.kind === 'cat' ? this.rnd.range(4, 14) : this.rnd.range(0.8, 3.5);
    }
    // they scatter if you walk into them, which is most of a chicken's charm
    const pd = Math.sqrt(d2);
    if (pd < 2.2) {
      c.tx = c.x + (c.x - px) / pd * 4;
      c.tz = c.z + (c.z - pz) / pd * 4;
      c.wait = Math.max(c.wait, 0.6);
    }

    const dx = c.tx - c.x, dz = c.tz - c.z;
    const d = Math.hypot(dx, dz);
    if (d > 0.15) {
      const sp = c.speed * (pd < 3 ? 2.2 : 1);
      c.x += (dx / d) * sp * dt;
      c.z += (dz / d) * sp * dt;
      c.yaw = dampAngle(c.yaw, Math.atan2(dx, dz), 7, dt);
      c.bob += dt * (c.kind === 'chicken' ? 14 : 8);
    }
    const g = this.world.groundAt(c.x, c.z);
    const hop = c.kind === 'chicken' ? Math.abs(Math.sin(c.bob)) * 0.025 : 0;
    c.rig.root.position.set(c.x, g + hop, c.z);
    c.rig.root.rotation.y = c.yaw;
    // the peck
    if (c.kind !== 'cat') {
      const peck = Math.max(0, Math.sin(this.t * 1.7 + c.bob * 0.1));
      c.rig.body.rotation.x = d < 0.2 ? peck * peck * 0.7 : 0.1;
    } else {
      c.rig.body.rotation.x = Math.sin(this.t * 1.1) * 0.03;
    }
  }

  /* ====================================================================== */
  /* INTERACTION                                                            */
  /* ====================================================================== */

  /** The nearest villager the player could speak to. */
  nearest(x, z, range) {
    let best = null, bestD = range * range;
    for (const npc of this.list) {
      const dx = npc.x - x, dz = npc.z - z;
      const d = dx * dx + dz * dz;
      if (d < bestD) { bestD = d; best = npc; }
    }
    return best;
  }

  /** The next thing this villager has to say. */
  line(npc) {
    const def = npc.def;
    const pool = def.lines || def.idle || SMALL_TALK;
    const l = pool[npc.lineIdx % pool.length];
    npc.lineIdx++;
    npc.said++;
    return l;
  }
}
