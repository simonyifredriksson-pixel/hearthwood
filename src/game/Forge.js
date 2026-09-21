/* Forge.js — the forging cutscene, played in the world.
   ===========================================================================
   THE WHOLE POINT: the player does not watch a progress bar with a hammer
   icon on it. They stand at the counter and watch Nissel work. She picks the
   stick up, turns it over, sights along it, puts it down, draws something on
   a sheet of parchment nobody is allowed to see, shapes it, takes it to the
   anvil, beats sparks out of it, binds the grip, polishes it, holds it up to
   the light — and only then does the game tell you what it is.

   HOW IT IS BUILT, and why it is built this way:

     ONE CINEMATIC, TWELVE BEATS. Every weapon in the game plays the same
     sequence with one beat swapped for its family: a blade goes to the
     grindstone, a hammer gets a second heat, a polearm has its head fitted
     to the shaft. Twenty-two bespoke cutscenes would be twenty-two things
     to keep in sync with twenty-two weapon builders, and the player sees
     any one of them about four times.

     THE CAMERA IS STAGED IN THE SHOP'S OWN FRAME. Every mark is (left,
     up, forward) relative to the workshop's anchor and yaw, so the whole
     sequence still works after the workshop was moved to the middle of the
     green, and will still work when it moves again.

     THE DRAWING IS HIDDEN BY STAGING, NOT BY A TRICK. The camera for that
     beat sits behind and below her shoulder; the parchment is propped away
     from it at a steep angle; her back is between the two. There is nothing
     to read because there is nothing pointed at the lens — which is the
     only way to hide it that does not fall apart the moment somebody
     notices the page is blank.

     SHE IS THE VILLAGE NPC, not a copy of her. The director takes her rig
     over for the duration (`npc.cutscene`), poses it, and hands it back.
     A second Nissel standing in the same shop would be a ghost story.

   The weapon is forged in state BEFORE the first beat, because the middle of
   the sequence has to show the real thing being hammered and the real thing
   being polished. What is withheld is not the object — it is the NAME, the
   TYPE and the RARITY, and those land on the card at the end.
*/

import * as THREE from '../../lib/three.module.js?v=1790014288';
import { MeshBuilder, blob, box } from '../art/Geo.js?v=1790014288';
import { MATS } from '../art/Materials.js?v=1790014288';
import { buildStick } from '../art/StickGen.js?v=1790014288';
import { weaponMeshes } from '../art/WeaponArt.js?v=1790014288';
import { WEAPON_CLASSES } from '../data/WeaponData.js?v=1790014288';
import { MATERIALS, EFFECTS } from '../data/StickData.js?v=1790014288';
import { carryFor } from './Combat.js?v=1790014288';
import { clamp01, lerp, smoothstep, TAU, makeRng } from '../core/Util.js?v=1790014288';

/* ========================================================================= */
/* THE BEATS                                                                 */
/* ========================================================================= */

/**
 * Marks, in the workshop's own frame: [left, forward].
 *
 * `left` is +x in shop space and `forward` is +z, which is the way the
 * building faces — so forward is out towards the counter and the green, and
 * negative forward is back into the shop where the bench is.
 */
const MARK = {
  bench: { at: [0.30, -0.55], face: [0.30, -1.30] },   // in front of the bench, facing it
  anvil: { at: [-1.75, -0.34], face: [-2.55, -0.34] }, // beside the anvil, facing it
  grind: { at: [1.75, 1.05], face: [2.55, 1.09] },     // at the grindstone
  front: { at: [0.30, 1.20], face: [0.30, 4.20] },     // turned out to the counter
};

/**
 * The sequence. `ms` is how long the beat holds; `cam.from`/`cam.to` are eye
 * positions in shop space [left, up, forward] and `cam.at`/`cam.at2` are what
 * it looks at. Every beat dollies, because a cut to a still camera for two
 * seconds reads as a screenshot.
 *
 * THE DISTANCES ARE NOT TASTE, THEY ARE ARITHMETIC. She is 1.25 m tall with
 * her shoulder at 0.81 and her eyes at 1.00; the bench top is at 0.68 and the
 * tool board above it stands 1.64. The first pass put the lens 1.2 m away
 * and every frame came back as a slab of bench with two ears behind it. Two
 * to two and a half metres, aimed between her hands and her face, is what
 * fits a person that size in a shed this size. Run probe_forgeset.mjs before
 * touching any of these numbers.
 */
/*
 * THE LENS, and why every beat now names one.
 *
 * The first cut of this scene filmed all ten beats on the gameplay camera's
 * 55 degrees, and it played like one camera being carried round a shed. A
 * smith's hands want a long lens — WORK below — which compresses the depth
 * and puts the player's nose in the job; the room and the presentation want
 * a wide, which takes in the shed and the light coming through the opening.
 * These are the only three focal lengths in the scene, used on purpose.
 */
const LENS = { WIDE: 52, ROOM: 42, WORK: 32, TIGHT: 26 };

const BEATS = [
  {
    id: 'take', ms: 1900, mark: 'bench', hold: 'up', fov: LENS.ROOM,
    cam: { from: [2.10, 1.35, 1.55], to: [1.55, 1.25, 1.10], at: [0.30, 0.95, -0.55] },
  },
  {
    id: 'turn', ms: 1500, mark: 'bench', hold: 'sight', fov: LENS.WORK,
    cam: { from: [-1.95, 1.30, 1.35], to: [-1.50, 1.20, 0.95], at: [0.30, 0.98, -0.55] },
  },
  {
    id: 'place', ms: 1000, mark: 'bench', hold: 'down', fov: LENS.ROOM,
    cam: { from: [1.40, 1.95, 0.85], to: [1.10, 1.70, 0.45], at: [0.35, 0.72, -1.15] },
  },
  {
    /* THE BLUEPRINT. Behind her shoulder, below the page, page tilted away. */
    id: 'draw', ms: 2000, mark: 'bench', hold: 'none', sheet: true, fov: LENS.WORK,
    cam: { from: [-0.85, 1.58, 0.35], to: [-0.70, 1.48, 0.08], at: [0.34, 0.78, -1.05] },
  },
  {
    /* PREPARING. Everything the job needs, laid out in a row on the bench:
       cord, a strip of hide, a pot of wax — and, if the wood brought
       anything with it, that too, sitting there glowing. A long slow slide
       along the bench top on the tight lens, so the player reads the
       materials as objects rather than as a list. */
    id: 'gather', ms: 1500, mark: 'bench', hold: 'gather', kit: true, fov: LENS.TIGHT,
    /* HIGH AND OFF TO HER LEFT, looking down the bench. The first staging
       put the lens between her and the bench at nose height and dollied
       it straight through her skull — she stands BETWEEN the camera and
       the thing this beat is about, so the only place to film the bench
       from is above and to one side, with her paw coming into frame. */
    cam: { from: [1.60, 1.42, -0.32], to: [1.05, 1.32, -0.54], at: [0.36, 0.99, -1.08] },
  },
  {
    /* CUTTING IT TO LENGTH. The first irreversible thing that happens to
       the stick, and the beat the sequence was missing — she went straight
       from drawing it to shaping it, and a plan with no cut in between is
       a plan that never touched the wood. */
    id: 'cut', ms: 1500, mark: 'bench', hold: 'saw', chips: true, saw: true, fov: LENS.WORK,
    cam: { from: [2.05, 1.08, 0.15], to: [1.60, 1.00, -0.20], at: [0.40, 0.76, -1.05] },
  },
  {
    id: 'shape', ms: 1500, mark: 'bench', hold: 'work', chips: true, fov: LENS.WORK,
    cam: { from: [2.75, 1.25, 0.55], to: [2.35, 1.18, 0.15], at: [0.40, 0.78, -1.00] },
  },
  {
    /* THE HEAT. The only warm light in the shop, and the only beat where
       something happens TO her rather than under her hands — the coals
       come up under the bellows and put her face in orange. Filmed low and
       close across the fire so the flare is between the lens and her. */
    id: 'heat', ms: 2000, mark: 'forge', hold: 'bellows', fire: true, weapon: true, fov: LENS.WORK,
    /* THE HEARTH BEATS LIVE IN THE BACK CORNER, so their cameras can only
       ever be on the +forward side of it — the shop's rear wall is about
       half a metre behind the fire, and a mark further back than that
       films the inside of the building. The aim sits between the coals
       and where she stands rather than on the coals, or she ends up
       clipped to the edge of frame. */
    cam: {
      rel: 'forge', from: [1.55, 0.78, 1.40], to: [1.10, 0.68, 1.00],
      at: [0.30, 0.40, 0.10], at2: [0.20, 0.58, 0.00],
    },
  },
  {
    id: 'hammer', ms: 2100, mark: 'anvil', hold: 'anvil', sparks: true, weapon: true, fov: LENS.WORK,
    cam: { from: [-0.95, 1.05, 1.95], to: [-1.35, 0.95, 1.45], at: [-2.35, 0.62, -0.34] },
  },
  /* one family beat is spliced in here — see `variantBeat` */
  /* and, only when the wood brought something with it, `inlayBeat` */
  {
    /* QUENCH. Short, loud and the end of the hot half of the scene: in it
       goes, the shop fills with steam, and everything after this is quiet
       work with a cloth. */
    id: 'quench', ms: 1300, mark: 'forge', hold: 'quench', steam: true, weapon: true, fov: LENS.WORK,
    cam: {
      rel: 'forge', from: [1.50, 1.08, 1.10], to: [1.22, 0.98, 0.88],
      at: [0.45, 0.34, 0.10], at2: [0.55, 0.58, 0.10],
    },
  },
  {
    id: 'bind', ms: 1400, mark: 'bench', hold: 'bind', weapon: true, fov: LENS.TIGHT,
    cam: { from: [1.75, 1.20, 0.95], to: [1.45, 1.14, 0.60], at: [0.40, 0.88, -0.55] },
  },
  {
    id: 'polish', ms: 1300, mark: 'bench', hold: 'polish', weapon: true, fov: LENS.TIGHT,
    cam: { from: [-1.55, 1.25, 0.95], to: [-1.20, 1.18, 0.62], at: [0.30, 0.90, -0.55] },
  },
  {
    id: 'present', ms: 2100, mark: 'front', hold: 'present', weapon: true, fov: LENS.WIDE,
    cam: { from: [0.70, 1.55, 3.30], to: [0.34, 1.34, 2.55], at: [0.30, 0.88, 1.20], at2: [0.30, 1.02, 1.20] },
  },
];

/**
 * The one beat that is different per family.
 *
 * It sits after the hammering, which is deliberate: by then the weapon is
 * visibly a blade or a haft or a head on a stick anyway, so a beat that says
 * "she is grinding an edge" gives nothing away that the player cannot already
 * see — and it is the difference between every weapon being forged identically
 * and each family having a moment that belongs to it.
 */
function variantBeat(build) {
  switch (build) {
    case 'blade':
      return {
        id: 'grind', ms: 1900, mark: 'grind', hold: 'grind', sparks: true, weapon: true,
        cam: { from: [1.70, 1.35, 3.70], to: [1.90, 1.22, 3.15], at: [2.40, 0.78, 1.05] },
      };
    case 'hammer':
    case 'club':
      return {
        id: 'seat', ms: 1800, mark: 'anvil', hold: 'anvil', sparks: true, weapon: true,
        cam: { from: [-3.95, 1.25, 1.95], to: [-3.65, 1.12, 1.55], at: [-2.50, 0.66, -0.34] },
      };
    case 'axe':
      return {
        id: 'wedge', ms: 1800, mark: 'bench', hold: 'bind', weapon: true,
        cam: { from: [-1.55, 1.15, 0.85], to: [-1.25, 1.10, 0.50], at: [0.35, 0.78, -0.95] },
      };
    case 'polearm':
      return {
        id: 'fit', ms: 1800, mark: 'bench', hold: 'fit', weapon: true,
        cam: { from: [3.05, 1.20, 0.35], to: [2.65, 1.15, 0.00], at: [0.35, 0.85, -0.85] },
      };
    default:
      return {
        id: 'true', ms: 1700, mark: 'bench', hold: 'sight', weapon: true,
        cam: { from: [-2.05, 1.25, 0.95], to: [-1.70, 1.18, 0.60], at: [0.30, 0.92, -0.60] },
      };
  }
}

/**
 * THE BEAT THAT ONLY SOME STICKS EARN.
 *
 * A branch with amber in it, or one that came off a tree the lightning
 * found, is worth more and reads differently in the satchel — and until
 * now the cutscene said nothing about it at all. It ran the identical
 * sequence whether the wood was hazel from the fence line or something
 * that hums. This beat exists solely so the player who finds a rare
 * material SEES it being set into the weapon.
 *
 * Returned only when there is something to set. An empty beat that plays
 * for ordinary wood would be a hare staring at her own hands.
 */
function inlayBeat(stick) {
  if (!stick?.special && !stick?.effect) return null;
  return {
    id: 'inlay', ms: 1800, mark: 'bench', hold: 'inlay', weapon: true, kit: true,
    fov: LENS.WORK,
    /* over her left shoulder with a metre of clearance — closer than this
       and the back of her head is the whole frame, which is what the
       first attempt came back as */
    cam: { from: [1.55, 1.20, 0.10], to: [1.25, 1.14, -0.18], at: [0.42, 0.88, -0.85] },
  };
}

/* ========================================================================= */
/* WHAT SHE SAYS                                                             */
/* ========================================================================= */

/** The examining lines come off the stick, so she is always talking about it. */
function takeLine(s) {
  if (s.special && MATERIALS[s.special]) {
    return `She stops. "Well now. There is ${MATERIALS[s.special].label.toLowerCase()} in this."`;
  }
  if (s.effect && EFFECTS[s.effect]) return 'She holds it up to the light, and says nothing for a while.';
  const bend = s.curve + s.wobble * 0.5 + s.kinks * 0.35;
  if (bend > 1.2) return '"That is a proper bend. I am not taking that out."';
  if (bend < 0.2 && s.length > 1.4) return '"Straight. Properly straight. Do you know how rare that is?"';
  if (s.thick > 0.06) return '"Heavy. There is a lot of tree in here."';
  if (s.length < 0.5) return '"Small. Small is not the same as no use."';
  return '"Mm. Honest wood."';
}

function turnLine(s) {
  if (s.moss > 0.5) return '"The moss stays. Do not argue with me about the moss."';
  if ((s.fungi || []).length >= 2) return 'She looks at the little brackets, and decides to leave them.';
  if (s.charred > 0.3) return '"This one has been out in the weather. Good."';
  return 'She taps it once on the bench and listens to it.';
}

const LINES = {
  place: 'She sets it down, and reaches for a sheet of parchment.',
  draw: '"Not yet," she says, without looking up.',
  gather: 'Cord, hide, wax. She lays them out in the order she will want them.',
  cut: 'The saw goes on, twice, and two ends come off.',
  shape: 'The drawknife goes on, and the shavings begin to fall.',
  heat: 'The bellows go down, and the shed turns orange.',
  inlay: 'She sets the piece in, and closes the wood over it.',
  quench: 'Into the trough. The whole shop disappears for a moment.',
  hammer: 'Hammer. Hammer. A spray of sparks across the floor.',
  grind: 'The wheel turns, and takes an edge off it.',
  seat: 'She seats the head, and beats it home.',
  wedge: 'A wedge goes into the eye, and is driven flush.',
  fit: 'The head is offered up to the shaft, and does not come off again.',
  true: 'She sights along it, and takes off one more curl.',
  bind: 'The grip is bound, and unbound, and bound again.',
  polish: 'Then a long time with a cloth, and no talking at all.',
  present: 'She turns it once in the light, and holds it out to you.',
};

/* ========================================================================= */
/* SPARKS AND SHAVINGS                                                       */
/* ========================================================================= */

/**
 * Twenty-two little things that fly out of something being hit.
 *
 * Two geometries, one mesh pool: sparks arc up and burn out, shavings curl off
 * and fall. Both are the same six lines of ballistics and it would be silly to
 * write them twice.
 */
class Motes {
  constructor(scene, n = 22) {
    this.hot = moteGeo(0xffcc72);
    this.chip = moteGeo(0xd9bc86);
    this.vapour = moteGeo(0xe8eef2, 0.030);   // bigger and paler: steam
    this.items = [];
    this.group = new THREE.Group();
    scene.add(this.group);
    for (let i = 0; i < n; i++) {
      const m = new THREE.Mesh(this.hot, MATS.glow);
      m.visible = false;
      this.group.add(m);
      this.items.push({ m, vx: 0, vy: 0, vz: 0, life: 0, max: 1, g: -9 });
    }
    this.rnd = makeRng(0x5c1e);
  }

  /**
   * @param kind 'hot' (sparks), 'chip' (shavings) or 'steam'.
   *
   * Steam is the same ballistics with the sign of gravity flipped: it
   * drifts UP and slows instead of arcing and falling, which is the whole
   * difference between a cloud and a firework.
   */
  burst(x, y, z, kind = 'hot', power = 1) {
    const r = this.rnd;
    const geo = kind === 'hot' ? this.hot : kind === 'steam' ? this.vapour : this.chip;
    const n = kind === 'hot' ? this.items.length : Math.floor(this.items.length * 0.6);
    for (let i = 0; i < n; i++) {
      const it = this.items[i];
      const a = r.range(0, TAU);
      const up = kind === 'hot' ? r.range(1.4, 3.6)
        : kind === 'steam' ? r.range(0.7, 1.5) : r.range(0.2, 0.9);
      const out = kind === 'hot' ? r.range(0.8, 2.6)
        : kind === 'steam' ? r.range(0.25, 0.85) : r.range(0.5, 1.4);
      const spread = kind === 'steam' ? 0.10 : 0.03;
      it.m.geometry = geo;
      it.m.position.set(x + r.range(-spread, spread), y, z + r.range(-spread, spread));
      it.m.visible = true;
      it.vx = Math.cos(a) * out * power;
      it.vz = Math.sin(a) * out * power;
      it.vy = up * power;
      it.g = kind === 'hot' ? -9 : kind === 'steam' ? 0.35 : -3.2;
      it.drag = kind === 'steam' ? 1.7 : 0;
      it.grow = kind === 'steam';
      it.life = 0;
      it.max = kind === 'hot' ? r.range(0.30, 0.62)
        : kind === 'steam' ? r.range(0.8, 1.5) : r.range(0.6, 1.1);
    }
  }

  update(dt) {
    for (const it of this.items) {
      if (!it.m.visible) continue;
      it.life += dt;
      if (it.life >= it.max) { it.m.visible = false; continue; }
      it.vy += it.g * dt;
      if (it.drag) {
        const d = Math.exp(-it.drag * dt);
        it.vx *= d; it.vz *= d; it.vy *= d;
      }
      it.m.position.x += it.vx * dt;
      it.m.position.y += it.vy * dt;
      it.m.position.z += it.vz * dt;
      const k = 1 - it.life / it.max;
      /* a spark shrinks as it burns out; a cloud of steam expands as it
         thins, which is the other half of reading as vapour */
      it.m.scale.setScalar(it.grow ? 0.5 + (1 - k) * 2.2 : 0.35 + k * 0.9);
    }
  }

  clear() { for (const it of this.items) it.m.visible = false; }

  dispose() {
    this.group.parent?.remove(this.group);
    this.hot.dispose();
    this.chip.dispose();
    this.vapour.dispose();
  }
}

function moteGeo(hex, r = 0.014) {
  const b = new MeshBuilder();
  b.color(hex, 0);
  blob(b, 0, 0, 0, r, 2, 4);
  return b.build({ flat: true });
}

/* ========================================================================= */
/* THE DIRECTOR                                                              */
/* ========================================================================= */

export class ForgeScene {
  /**
   * @param G  the game object from main.js — needs world, npcs, player, ui,
   *           rig, scene and audio. It is passed whole rather than piece by
   *           piece because a cutscene genuinely does touch all of them.
   */
  constructor(G) {
    this.G = G;
    this.active = false;
    this.beats = null;
    this.i = 0;
    this.t = 0;
    this.motes = null;
    this.props = new THREE.Group();
    this.el = null;
    this._resolve = null;
    this._strikeAt = 0;
  }

  get busy() { return this.active; }

  /* ---------------------------------------------------------------- start */

  /**
   * Run the cutscene.
   *
   * @param stick  the piece of wood going onto the bench
   * @param craft  a function that actually forges it and returns the weapon.
   *               Passed in rather than called directly so this file never
   *               has to know about GameState.
   * @returns a promise for the weapon, or null if it could not be made.
   */
  play(stick, craft) {
    const G = this.G;
    const A = G.world?.village?.anchors?.stickwright;
    const npc = G.npcs?.stickwright;
    if (this.active || !A || !npc || !stick) return Promise.resolve(null);

    const res = craft();
    if (!res || !res.ok || !res.weapon) return Promise.resolve(null);
    const w = res.weapon;

    this.A = A;
    this.npc = npc;
    this.stick = stick;
    this.weapon = w;
    /* the floor of the shop, not the meadow under it: every mark in this
       file is measured up from whatever she is actually standing on */
    this.ground = A.floorY ?? G.world.groundAt(A.x, A.z);
    this.c = Math.cos(A.yaw);
    this.s = Math.sin(A.yaw);

    /* WHERE THE HEARTH IS, in the shop's own frame.
       The fire pit is placed by the village layout, so its position is
       whatever that decided; the two beats staged against it therefore
       measure themselves from the anchor rather than from a number typed
       into this file, which would drift the next time the shop is laid
       out. The fallback is where it has always been put. */
    this.forgeL = A.forgeAt ? this._local(A.forgeAt[0], A.forgeAt[1]) : [-2.50, -1.98];
    this.forgeY = A.forgeTop ?? (this.ground + 0.30);
    this.MARK = {
      ...MARK,
      forge: {
        at: [this.forgeL[0] + 0.90, this.forgeL[1] + 0.20],
        face: [this.forgeL[0], this.forgeL[1]],
      },
    };

    /* splice the family beat in after the hammering, and the inlay after
       that when the wood has something worth setting into it */
    const cls = WEAPON_CLASSES[w.cls] || WEAPON_CLASSES.club;
    const list = BEATS.slice();
    const at = list.findIndex(b => b.id === 'hammer') + 1;
    const extra = [variantBeat(cls.build), inlayBeat(stick)].filter(Boolean);
    list.splice(at, 0, ...extra);
    this.beats = list;
    this.heat = 0;            // how hot the coals are, 0..1 — drives the light
    this.kick = 0;            // camera recoil left over from the last blow
    this.i = 0;
    this.t = 0;
    this.active = true;
    this._strikeAt = 0;

    this._takeOver();
    this._buildProps();
    this._openOverlay();
    this._beginBeat();

    return new Promise(r => { this._resolve = r; });
  }

  /** Shop space [left, up, forward] -> world [x, y, z]. */
  _w(lx, ly, lz) {
    const A = this.A;
    return [A.x + lx * this.c + lz * this.s, this.ground + ly, A.z - lx * this.s + lz * this.c];
  }

  /** World [x, z] -> shop space [left, forward]. The inverse of `_w`. */
  _local(wx, wz) {
    const dx = wx - this.A.x, dz = wz - this.A.z;
    return [dx * this.c - dz * this.s, dx * this.s + dz * this.c];
  }

  /* ----------------------------------------------------------- the taking */

  _takeOver() {
    const G = this.G;
    const npc = this.npc;
    npc.cutscene = true;
    npc.talkTo = null;
    this._wasCarry = npc.carry;
    if (npc.carry) { npc.carry.visible = false; }

    G.scene?.add(this.props);
    this.motes = new Motes(G.scene, 22);

    /* The player is left exactly where they were standing when they handed
       the stick over — they walked to this counter on purpose and teleporting
       them two metres for a better composition is the kind of thing a player
       notices and nobody can explain. They are stopped, and they watch. */
    const P = G.player;
    if (P) {
      P.vx = P.vz = 0;
      P.yaw = Math.atan2(this.A.x - P.x, this.A.z - P.z);
      P.lookAt = [this.A.x, this.ground + 1.3, this.A.z];
    }
  }

  _giveBack() {
    const G = this.G;
    if (this.npc) {
      this.npc.cutscene = false;
      this.npc.wait = 0;
      if (this._wasCarry) this._wasCarry.visible = true;
    }
    if (G.player) G.player.lookAt = null;
    G.rig?.clearShot();
    this.motes?.dispose();
    this.motes = null;
    this._disposeProps();
    this._closeOverlay();
    this.active = false;
  }

  /* ---------------------------------------------------------------- props */

  _buildProps() {
    const grip = this.npc.rig.parts.grip;

    /* THE STICK. The real one, built from the same spec the satchel shows,
       because "the weapon remembers the stick" is worth nothing if the stick
       in the cutscene is a generic twig. */
    {
      const b = new MeshBuilder(), g = new MeshBuilder();
      buildStick(this.stick, b, { lod: 0, glow: g });
      const geo = b.build({ flat: false });
      geo.computeBoundingBox();
      const bb = geo.boundingBox;
      const len = Math.max(0.2, bb.max.y - bb.min.y);
      /* centre it on its own middle so it turns in her hand rather than
         swinging round one end */
      geo.translate(0, -(bb.min.y + bb.max.y) / 2, 0);
      this.stickMesh = new THREE.Group();
      this.stickMesh.add(new THREE.Mesh(geo, MATS.item));
      if (!g.isEmpty) {
        const gg = g.build({ flat: false });
        gg.translate(0, -(bb.min.y + bb.max.y) / 2, 0);
        this.stickMesh.add(new THREE.Mesh(gg, MATS.glow));
      }
      // a two-metre branch held at arm's length fills the frame and nothing else
      this.stickScale = Math.min(1, 0.80 / len);
      this.props.add(this.stickMesh);
    }

    /* THE WEAPON, hidden until she has something to show. */
    {
      const built = weaponMeshes(this.weapon, MATS, { lod: 0 });
      this.weaponMesh = new THREE.Group();
      for (const m of built.meshes) this.weaponMesh.add(m);
      this.weaponLen = built.info?.length || 1;
      this.weaponScale = Math.min(1, 0.82 / Math.max(0.3, this.weaponLen));
      this.weaponMesh.visible = false;
      this.props.add(this.weaponMesh);
    }

    /* THE MATERIALS. A coil of cord, a strip of hide and a pot of wax,
       laid out along the bench — and, when the wood brought something with
       it, the material itself sitting there in its own light. The player
       who walked eight hundred metres for a stick with amber in it gets to
       watch the amber go in. */
    {
      const b = new MeshBuilder(), g = new MeshBuilder();
      const r = makeRng((this.stick.seed ?? 1) ^ 0x4b17);

      /* SIZED TO BE READ, not to be accurate. The first pass built these
         at the size a hare's cord and wax pot would really be, and from
         the only camera that can see the bench they came out about twenty
         pixels across — a beat about materials in which no material was
         legible. They are roughly half again as big now and spread wider
         along the bench, which is the difference between a row of objects
         and a smudge. */
      // a coil of waxed cord
      b.color(0xb4a074, 0.06, r);
      for (let i = 0; i < 4; i++) {
        blob(b, -0.30, 0.014 + i * 0.013, 0, 0.072 - i * 0.008, 3, 9);
      }
      // a folded strip of hide
      b.color(0x7a5436, 0.07, r);
      box(b, -0.04, 0.014, 0.01, 0.21, 0.026, 0.115);
      box(b, 0.01, 0.038, -0.01, 0.16, 0.020, 0.090);
      // a pot of wax, lid off and leaning against it
      b.color(0x4e4236, 0.05, r);
      blob(b, 0.25, 0.044, 0, 0.060, 3, 9);
      b.color(0xd8b45c, 0.04, r);
      blob(b, 0.25, 0.074, 0, 0.048, 2, 9);
      b.color(0x4e4236, 0.05, r);
      box(b, 0.25, 0.010, 0.085, 0.115, 0.016, 0.028);

      /* WHAT THE WOOD BROUGHT. Coloured from the material's own entry so a
         vein of amber is amber and a piece of stormstruck heart is not. */
      const M = this.stick.special ? MATERIALS[this.stick.special] : null;
      const E = this.stick.effect ? EFFECTS[this.stick.effect] : null;
      const tint = M?.hex ?? E?.hex ?? 0xc8a24c;
      if (M || E) {
        b.color(tint, 0.03, r);
        blob(b, 0.46, 0.040, 0, 0.055, 3, 9);
        g.color(tint, 0.02, r);
        blob(g, 0.46, 0.040, 0, 0.072, 2, 9);
      }

      this.kit = new THREE.Group();
      this.kit.add(new THREE.Mesh(b.build({ flat: false }), MATS.item));
      if (!g.isEmpty) this.kit.add(new THREE.Mesh(g.build({ flat: false }), MATS.glow));
      this.kit.visible = false;
      this.props.add(this.kit);
    }

    /* THE SAW. Small, plain, and only ever seen for a second and a half —
       but a cutting beat with no saw in it is a hare miming. */
    {
      const b = new MeshBuilder();
      const r = makeRng(0x5a77);
      b.color(0xb8bcc0, 0.04, r);
      box(b, 0, 0, 0, 0.30, 0.055, 0.004);          // the plate
      b.color(0x9aa0a6, 0.05, r);
      for (let i = 0; i < 14; i++) {                 // the teeth
        box(b, -0.14 + i * 0.021, -0.034, 0, 0.012, 0.016, 0.004);
      }
      b.color(0x6b4e30, 0.07, r);
      box(b, 0.19, 0.005, 0, 0.085, 0.075, 0.032);   // the handle
      this.saw = new THREE.Group();
      this.saw.add(new THREE.Mesh(b.build({ flat: false }), MATS.item));
      this.saw.visible = false;
      this.props.add(this.saw);
    }

    /* THE FORGE LIGHT. One point light in the coals that the heat beat
       drives, and that every hammer blow flares. This is the single
       biggest thing separating "a hare moving her arms in a brown shed"
       from "a smith working": the light has to come from the work. */
    {
      const [fx, fz] = this.A.forgeAt || [this.A.x, this.A.z];
      this.forgeLight = new THREE.PointLight(0xff7a2c, 0, 7.5, 1.8);
      this.forgeLight.position.set(fx, this.forgeY + 0.10, fz);
      this.props.add(this.forgeLight);
    }

    /* THE PARCHMENT, propped on the bench facing AWAY. */
    {
      const b = new MeshBuilder();
      const r = makeRng(0x9a2e);
      b.color(0xe6d8b4, 0.05, r);
      box(b, 0, 0, 0, 0.34, 0.005, 0.25);
      /* A few marks on it, so that the ONE frame in which an edge of the
         page catches the light is not a blank sheet. They are deliberately
         not the shape of anything: see the note at the top of the file. */
      b.color(0x574734, 0.10, r);
      for (let i = 0; i < 5; i++) {
        box(b, r.range(-0.14, 0.14), 0.005, r.range(-0.10, 0.10),
          r.range(0.03, 0.13), 0.002, 0.006);
      }
      const sheet = new THREE.Mesh(b.build({ flat: false }), MATS.item);
      this.sheet = new THREE.Group();
      this.sheet.add(sheet);
      this.sheet.visible = false;
      this.props.add(this.sheet);
    }
  }

  /**
   * Take everything away again.
   *
   * Held props live under her GRIP, not under `this.props`, so dropping the
   * props group is not enough — miss this and the Stickwright spends the
   * rest of the game standing at her bench holding your sword.
   */
  _disposeProps() {
    for (const m of [this.stickMesh, this.weaponMesh, this.sheet, this.kit, this.saw]) {
      if (!m) continue;
      m.parent?.remove(m);
      m.traverse(o => { if (o.isMesh) o.geometry.dispose(); });
    }
    if (this.forgeLight) { this.forgeLight.parent?.remove(this.forgeLight); this.forgeLight = null; }
    this.props.parent?.remove(this.props);
    this.props.clear();
    this.stickMesh = this.weaponMesh = this.sheet = this.kit = this.saw = null;
  }

  /* --------------------------------------------------------------- overlay */

  /**
   * The overlay, and what is NOT on it.
   *
   * THE BOTTOM THIRD IS CLEAR. The first version ran a line of narration
   * under every beat — "she taps it on the bench and listens to it" — and
   * it read as a tutorial talking over the scene. The whole point of
   * building the cutscene in the world was that the player can WATCH
   * somebody make the thing; captioning it is admitting the pictures are
   * not doing the job.
   *
   * What is left is two soft letterbox bars, the Stickwright's name once
   * at the start so you know whose shop this is, and a small skip hint in
   * the corner. Nothing crosses the middle of the frame, ever.
   */
  _openOverlay() {
    const el = document.createElement('div');
    el.className = 'cine';
    el.innerHTML = `
      <div class="cine-bar top"></div>
      <div class="cine-bar bottom"></div>
      <div class="cine-title"><b>Nissel</b><i>Stickwright</i></div>
      <span class="cine-skip">press <kbd>Esc</kbd> to skip</span>`;
    document.getElementById('ui').appendChild(el);
    requestAnimationFrame(() => el.classList.add('in'));
    this.el = el;
    this.lineEl = null;   // there is no caption any more; see _openOverlay
  }

  _closeOverlay() {
    const el = this.el;
    this.el = null;
    if (!el) return;
    el.classList.remove('in');
    setTimeout(() => el.remove(), 520);
  }

  _say(text) {
    if (!this.lineEl) return;
    this.lineEl.textContent = text || '';
    this.lineEl.classList.remove('in');
    void this.lineEl.offsetWidth;
    if (text) this.lineEl.classList.add('in');
  }

  /* ----------------------------------------------------------------- beats */

  _beginBeat() {
    const B = this.beats[this.i];
    this.t = 0;
    this._strikeAt = 0;
    const s = this.stick;
    const line = B.id === 'take' ? takeLine(s) : B.id === 'turn' ? turnLine(s) : LINES[B.id];
    this._say(line);
    if (this.sheet) this.sheet.visible = !!B.sheet;
    if (this.weaponMesh) this.weaponMesh.visible = !!B.weapon;
    if (this.stickMesh) this.stickMesh.visible = !B.weapon;
    if (this.kit) this.kit.visible = !!B.kit;
    if (this.saw) this.saw.visible = !!B.saw;
    if (this.kit && B.kit) this._layKit();

    /* THE SOUND OF THE BEAT STARTING. The scene used to cue one `craft()`
       rasp at the anvil and nothing else — every other beat was silent,
       including the bellows and the quench, which are the two loudest
       things that happen in a forge. */
    const a = this.G.audio;
    if (a) {
      if (B.id === 'heat') a.bellows?.();
      else if (B.id === 'quench') a.quench?.();
      else if (B.id === 'gather') a.ui?.('tick');
      else if (B.id === 'inlay') a.craft?.();
    }
  }

  /** Driven from the main loop. */
  update(dt) {
    if (!this.active) return;
    const B = this.beats[this.i];
    const dur = B.ms / 1000;
    this.t += dt;
    const u = clamp01(this.t / dur);

    this._camera(B, u);
    this._pose(B, u, dt);
    this._effects(B, u, dt);
    this.motes?.update(dt);

    if (this.t >= dur) {
      this.i++;
      if (this.i >= this.beats.length) return this._finish();
      this._beginBeat();
    }
  }

  /** Skip to the card. */
  skip() {
    if (this.active) this._finish();
  }

  _finish() {
    const w = this.weapon;
    const done = this._resolve;
    this._resolve = null;
    this._giveBack();
    done?.(w);
  }

  /* ---------------------------------------------------------------- camera */

  _camera(B, u) {
    /* Ease the dolly, but do NOT ease the cut between beats: a cut is a cut.
       The easing here is the slow drift within one shot, which is what makes
       a static set feel like it is being filmed. */
    const e = smoothstep(u);
    const C = B.cam;
    /* A beat can be staged against the hearth instead of the shop origin,
       because the hearth is wherever the village layout put it. */
    const ox = C.rel === 'forge' ? this.forgeL[0] : 0;
    const oz = C.rel === 'forge' ? this.forgeL[1] : 0;
    const oy = C.rel === 'forge' ? (this.forgeY - this.ground) : 0;

    const f = C.from, t = C.to;
    let ex = ox + lerp(f[0], t[0], e);
    let ey = oy + lerp(f[1], t[1], e);
    let ez = oz + lerp(f[2], t[2], e);

    /* THE KICK. Not a shake — a shake on a handheld rig is a different
       film and it makes close work unreadable. This is the lens being
       nudged back a couple of centimetres by the blow and settling, which
       is what actually happens to a camera on a tripod in a small shed
       when somebody hits an anvil next to it. It decays in about a fifth
       of a second and never touches the aim, so the frame stays legible. */
    if (this.kick > 0.0001) {
      ex += this.kick * 0.030;
      ey += this.kick * 0.018;
    }

    const a1 = C.at, a2 = C.at2 || C.at;
    const eye = this._w(ex, ey, ez);
    const at = this._w(
      ox + lerp(a1[0], a2[0], e),
      oy + lerp(a1[1], a2[1], e),
      oz + lerp(a1[2], a2[2], e));
    this.G.rig?.setShot(eye, at, B.fov || 0);
  }

  /* ------------------------------------------------------------------ pose */

  _pose(B, u, dt) {
    const npc = this.npc;
    const rig = npc.rig;
    const p = rig.parts;
    /* this.MARK, not MARK: the hearth's mark is worked out per-shop from
       the anchor, so the table is per-run rather than module-level */
    const M = (this.MARK || MARK)[B.mark] || MARK.bench;

    /* --- where she is standing, and which way she is facing -------------- */
    const [mx, , mz] = this._w(M.at[0], 0, M.at[1]);
    const [fx, , fz] = this._w(M.face[0], 0, M.face[1]);
    /* She WALKS between marks rather than teleporting. Two thirds of a second
       at the head of the beat, which is enough to read as a step across the
       shop and short enough that nobody waits for it. */
    const step = 1 - Math.exp(-4.5 * dt);
    npc.x = lerp(npc.x, mx, step);
    npc.z = lerp(npc.z, mz, step);
    const wantYaw = Math.atan2(fx - npc.x, fz - npc.z);
    npc.yaw += wrapPi(wantYaw - npc.yaw) * (1 - Math.exp(-6 * dt));
    npc.y = this.ground;                   // she is on the boards the whole time
    rig.root.position.set(npc.x, npc.y, npc.z);
    rig.root.rotation.y = npc.yaw;

    /* --- a neutral standing pose, then the beat on top of it ------------- */
    restPose(rig);
    const L = p.arms[0], R = p.arms[1];
    const T = TAU;

    switch (B.hold) {
      case 'up': {
        /* both paws up, the stick across them at eye height, turning */
        const lift = smoothstep(clamp01(u / 0.35));
        for (const arm of [L, R]) {
          arm.shoulder.rotation.x = lerp(-0.1, -1.05, lift);
          arm.shoulder.rotation.z = arm.side * 0.30;
          arm.elbow.rotation.x = lerp(-0.2, -1.15, lift);
        }
        p.head.rotation.x = 0.16 * lift;
        p.torso.rotation.y = Math.sin(u * T) * 0.05;
        this._holdStick(-0.35 + Math.sin(u * T * 1.1) * 0.20, Math.sin(u * T * 0.9) * 0.8);
        break;
      }
      case 'sight': {
        /* one arm out straight, the other tucked, head down the length */
        R.shoulder.rotation.x = -1.35;
        R.shoulder.rotation.z = 0.10;
        R.elbow.rotation.x = -0.12;
        L.shoulder.rotation.x = -0.75;
        L.elbow.rotation.x = -1.45;
        p.head.rotation.x = -0.12;
        p.head.rotation.z = 0.10;
        p.torso.rotation.x = 0.06;
        this._holdStick(-1.42, 0.10);
        break;
      }
      case 'down': {
        /* lays it on the bench and lets go */
        const set = smoothstep(u);
        for (const arm of [L, R]) {
          arm.shoulder.rotation.x = lerp(-1.0, -0.30, set);
          arm.shoulder.rotation.z = arm.side * 0.24;
          arm.elbow.rotation.x = lerp(-1.1, -0.55, set);
        }
        p.torso.rotation.x = 0.26 * (1 - set * 0.4);
        p.head.rotation.x = 0.40;
        this._benchStick(set);
        break;
      }
      case 'none': {
        /* the drawing. She leans right over the page, one hand moving. */
        p.torso.rotation.x = 0.44;
        p.head.rotation.x = 0.52;
        L.shoulder.rotation.x = -0.52;
        L.shoulder.rotation.z = 0.46;
        L.elbow.rotation.x = -1.25;
        const w = Math.sin(u * T * 2.6);
        R.shoulder.rotation.x = -0.68 + w * 0.10;
        R.shoulder.rotation.z = 0.20 + Math.sin(u * T * 1.7) * 0.14;
        R.elbow.rotation.x = -1.42 + w * 0.16;
        this._benchStick(1);
        this._sheet();
        break;
      }
      case 'gather': {
        /* reaching along the bench and setting things down, one at a time.
           Three reaches in the beat, each a little further left, which is
           the movement that makes a row of props read as being LAID OUT
           rather than as having always been there. */
        const n = 3, ph = (u * n) % 1, which = Math.floor(u * n);
        const reach = Math.sin(ph * Math.PI);
        R.shoulder.rotation.x = -0.55 - reach * 0.55;
        R.shoulder.rotation.z = 0.18 + which * 0.16 + reach * 0.30;
        R.elbow.rotation.x = -1.25 + reach * 0.75;
        L.shoulder.rotation.x = -0.55;
        L.shoulder.rotation.z = 0.40;
        L.elbow.rotation.x = -1.05;
        p.torso.rotation.x = 0.22 + reach * 0.10;
        p.torso.rotation.y = -0.10 - which * 0.07;
        p.head.rotation.x = 0.42;
        p.head.rotation.y = -0.14 - which * 0.09;
        this._benchStick(1);
        break;
      }
      case 'saw': {
        /* THE CUT. Short fast strokes, not the long slow ones the
           drawknife gets — a saw is a different rhythm and using the same
           sine for both would make two beats look like one beat twice.
           The off hand holds the work down and does not move. */
        const c = Math.sin(u * T * 5.2);
        R.shoulder.rotation.x = -0.70 + c * 0.24;
        R.shoulder.rotation.z = 0.24;
        R.elbow.rotation.x = -1.00 - c * 0.52;
        L.shoulder.rotation.x = -0.85;
        L.shoulder.rotation.z = 0.46;
        L.elbow.rotation.x = -1.35;
        p.torso.rotation.x = 0.34 + c * 0.05;
        p.torso.rotation.y = c * 0.06;
        p.head.rotation.x = 0.46;
        this._benchStick(1);
        this._handSaw(c);
        break;
      }
      case 'bellows': {
        /* Both paws on the bellows handle, whole body behind it, pushing
           down from the shoulders rather than the elbows — she weighs
           about as much as the air she is moving and it should look like
           work. Two full strokes in the beat. */
        const ph = (u * 2) % 1;
        const push = ph < 0.42 ? smoothstep(ph / 0.42) : 1 - smoothstep((ph - 0.42) / 0.58);
        for (const arm of [L, R]) {
          arm.shoulder.rotation.x = -0.85 + push * 0.55;
          arm.shoulder.rotation.z = arm.side * 0.20;
          arm.elbow.rotation.x = -1.05 + push * 0.30;
        }
        p.torso.rotation.x = 0.16 + push * 0.26;
        p.hip.rotation.x = push * 0.10;
        p.head.rotation.x = 0.30 - push * 0.10;
        for (const leg of p.legs) leg.knee.rotation.x = 0.08 + push * 0.18;
        this._forgeWeapon();
        break;
      }
      case 'inlay': {
        /* Very small movements, very close in, and her head right down
           over it — this is the beat that says the material matters. */
        const t2 = u * T;
        R.shoulder.rotation.x = -1.12;
        R.shoulder.rotation.z = 0.22 + Math.sin(t2 * 1.6) * 0.05;
        R.elbow.rotation.x = -1.48 + Math.sin(t2 * 2.3) * 0.07;
        L.shoulder.rotation.x = -1.05;
        L.shoulder.rotation.z = 0.42;
        L.elbow.rotation.x = -1.42;
        p.torso.rotation.x = 0.40;
        p.head.rotation.x = 0.56;
        this._handWeapon(-0.30, 0.05);
        break;
      }
      case 'quench': {
        /* Down, fast, and then she just stands there while the steam
           goes up — the stillness after is the whole beat. */
        const dip = smoothstep(clamp01(u / 0.28));
        for (const arm of [L, R]) {
          arm.shoulder.rotation.x = lerp(-1.15, -0.30, dip);
          arm.shoulder.rotation.z = arm.side * 0.22;
          arm.elbow.rotation.x = lerp(-1.25, -0.70, dip);
        }
        p.torso.rotation.x = 0.14 + dip * 0.22;
        p.head.rotation.x = 0.20 + dip * 0.26;
        this._handWeapon(1.30, 0);
        break;
      }
      case 'work': {
        /* long two-handed drawknife strokes towards herself */
        const c = Math.sin(u * T * 2.2);
        for (const arm of [L, R]) {
          arm.shoulder.rotation.x = -0.62 + c * 0.30;
          arm.shoulder.rotation.z = arm.side * 0.34;
          arm.elbow.rotation.x = -0.88 - c * 0.42;
        }
        p.torso.rotation.x = 0.34 + c * 0.10;
        p.head.rotation.x = 0.38;
        this._benchStick(1);
        break;
      }
      case 'anvil': {
        /* the hammer. Wind up slow, come down fast — the asymmetry IS the
           blow, and a sine wave in both directions is a wave, not a strike. */
        const beats = 4;
        const ph = (u * beats) % 1;
        const swing = ph < 0.62 ? smoothstep(ph / 0.62) : 1 - smoothstep((ph - 0.62) / 0.38) * 1.0;
        R.shoulder.rotation.x = -0.55 - swing * 1.55;
        R.shoulder.rotation.z = 0.22;
        R.elbow.rotation.x = -0.55 - swing * 0.85;
        L.shoulder.rotation.x = -0.95;
        L.shoulder.rotation.z = 0.40;
        L.elbow.rotation.x = -1.30;
        p.torso.rotation.x = 0.28 - swing * 0.10;
        p.torso.rotation.y = -swing * 0.16;
        p.head.rotation.x = 0.42;
        this._anvilWeapon();
        break;
      }
      case 'grind': {
        /* both hands down on the wheel, shoulders locked, body leaning in */
        for (const arm of [L, R]) {
          arm.shoulder.rotation.x = -0.72;
          arm.shoulder.rotation.z = arm.side * 0.22;
          arm.elbow.rotation.x = -0.95 + Math.sin(u * T * 3.1) * 0.06;
        }
        p.torso.rotation.x = 0.40;
        p.head.rotation.x = 0.46;
        this._propWeapon(this.A.grindAt, (this.A.grindTop ?? this.ground + 0.74) + 0.06, 1.1, 0.12);
        break;
      }
      case 'bind': {
        /* winding cord round the grip: small, fast, close to the body */
        const w = u * T * 3.4;
        R.shoulder.rotation.x = -1.05;
        R.shoulder.rotation.z = 0.30 + Math.sin(w) * 0.22;
        R.elbow.rotation.x = -1.35 + Math.cos(w) * 0.20;
        L.shoulder.rotation.x = -1.00;
        L.shoulder.rotation.z = 0.44;
        L.elbow.rotation.x = -1.50;
        p.torso.rotation.x = 0.22;
        p.head.rotation.x = 0.44;
        this._handWeapon(-0.55, 0.10);
        break;
      }
      case 'fit': {
        /* offering the head up to the shaft and pushing it home */
        const push = smoothstep(clamp01((u - 0.3) / 0.5));
        L.shoulder.rotation.x = -0.95;
        L.shoulder.rotation.z = 0.42;
        L.elbow.rotation.x = -1.20;
        R.shoulder.rotation.x = -0.70 - push * 0.35;
        R.shoulder.rotation.z = 0.18;
        R.elbow.rotation.x = -1.05 + push * 0.30;
        p.torso.rotation.x = 0.30;
        p.head.rotation.x = 0.40;
        this._handWeapon(0.20, -0.55);
        break;
      }
      case 'polish': {
        /* slow, even, both hands, and her head barely moves */
        const c = Math.sin(u * T * 1.5);
        R.shoulder.rotation.x = -1.00 + c * 0.14;
        R.shoulder.rotation.z = 0.26;
        R.elbow.rotation.x = -1.30 - c * 0.18;
        L.shoulder.rotation.x = -0.98;
        L.shoulder.rotation.z = 0.40;
        L.elbow.rotation.x = -1.38;
        p.torso.rotation.x = 0.18;
        p.head.rotation.x = 0.36;
        this._handWeapon(-0.70 + c * 0.12, 0.05);
        break;
      }
      case 'present': {
        /* she straightens up, and holds it out flat on both paws */
        const up = smoothstep(clamp01(u / 0.45));
        const out = smoothstep(clamp01((u - 0.35) / 0.45));
        for (const arm of [L, R]) {
          arm.shoulder.rotation.x = lerp(-0.9, -1.30, out);
          arm.shoulder.rotation.z = arm.side * lerp(0.30, 0.16, out);
          arm.elbow.rotation.x = lerp(-1.3, -0.45, out);
        }
        p.torso.rotation.x = lerp(0.24, -0.02, up);
        p.head.rotation.x = lerp(0.36, 0.04, up);
        this._handWeapon(-0.20 - out * 1.30, out * 0.35);
        break;
      }
    }

    /* --- SHE IS NEVER PERFECTLY STILL ------------------------------------
       Two of the beats are holds: she sights along the stick, she leans on
       the grindstone. Played exactly as written they froze her solid for a
       second and a half, and a character who stops moving in a close-up
       stops being a character and becomes a prop that happens to have a
       face. This is a few hundredths of a radian on three joints, running
       underneath everything, and it is the difference. */
    const B1 = this.t * 1.7, B2 = this.t * 0.83;
    p.torso.scale.set(1, 1 + Math.sin(B1) * 0.011, 1);
    p.torso.rotation.x += Math.sin(B1) * 0.014;
    p.torso.rotation.z += Math.sin(B2 * 0.7) * 0.010;
    p.head.rotation.y += Math.sin(B2) * 0.045;
    p.head.rotation.z += Math.sin(B2 * 1.31 + 0.7) * 0.022;
    if (p.neck) p.neck.rotation.x += Math.sin(B1 + 1.2) * 0.012;
    for (const arm of p.arms) {
      arm.shoulder.rotation.x += Math.sin(B1 + arm.side * 0.9) * 0.013;
      arm.elbow.rotation.x += Math.sin(B2 * 1.6 + arm.side) * 0.016;
    }
    if (p.ears?.length) {
      for (let i = 0; i < p.ears.length; i++) {
        const s = i === 0 ? -1 : 1;
        p.ears[i].rotation.z = s * (0.12 + Math.sin(this.t * (1.9 + i * 0.5)) * 0.11);
      }
    }
    p.hip.position.y = rig.metrics.hipHeight;
  }

  /* ------------------------------------------------------- prop placement */

  /*
   * A HELD PROP IS PARENTED TO THE PAW, not positioned near it.
   *
   * The first version computed a point half a metre in front of her at a
   * fraction of her height and put the weapon there. It was never in her
   * hand: every beat had a sword hanging in the air beside a hare who was
   * miming. Parenting to `parts.grip` — the same joint the player's weapon
   * mounts to — makes the hold correct by construction, and every arm pose
   * in this file then carries the thing with it for free.
   */
  _hold(m, scale, rot = [0, 0, 0], pos = [0, 0, 0]) {
    if (!m) return;
    const grip = this.npc.rig.parts.grip;
    if (m.parent !== grip) grip.add(m);
    m.scale.setScalar(scale);
    m.rotation.set(rot[0], rot[1], rot[2]);
    m.position.set(pos[0] * scale, pos[1] * scale, pos[2] * scale);
  }

  /** Put a prop back in the world, lying on a surface. */
  _lay(m, wx, wy, wz, yaw, tilt, scale) {
    if (!m) return;
    if (m.parent !== this.props) this.props.add(m);
    m.scale.setScalar(scale);
    m.position.set(wx, wy, wz);
    m.rotation.set(tilt, yaw, 0, 'YXZ');
  }

  /**
   * In her paws.
   *
   * `carryFor` is the per-class table the player's own hands use, so a maul
   * sits in her fist the way a maul sits in anybody's fist and a dagger
   * tucks in close. `tilt` leans it for the beat — up to look at, flat to
   * work on, out to offer.
   */
  _handWeapon(tilt = 0, twist = 0) {
    const C = carryFor(this.weapon?.cls);
    this._hold(this.weaponMesh, this.weaponScale,
      [C.rot[0] + tilt, C.rot[1] + twist, C.rot[2]], C.pos);
  }

  /** The stick, held across both paws. */
  _holdStick(tilt = 0, twist = 0) {
    this._hold(this.stickMesh, this.stickScale, [tilt, twist, 0.15], [0, -0.06, 0.05]);
  }

  /** Lying on the bench — `k` fades it out of her paw and onto the boards. */
  _benchStick(k) {
    const m = this.stickMesh;
    if (!m || !this.A.benchAt) return;
    if (k < 0.5) { this._holdStick(1.2 * (1 - k * 2), 0); return; }
    const [bx, bz] = this.A.benchAt;
    const top = this.A.benchTop ?? this.ground + 0.68;
    this._lay(m, bx, top + 0.03, bz, this.A.yaw + 0.12, Math.PI / 2, this.stickScale);
  }

  _sheet() {
    const sh = this.sheet;
    if (!sh || !this.A.benchAt) return;
    const [bx, bz] = this.A.benchAt;
    const top = this.A.benchTop ?? this.ground + 0.94;
    /* PROPPED STEEPLY AWAY FROM THE CAMERA. The camera for this beat is
       behind her right shoulder, so a page raked back at 66 degrees presents
       the lens with its own thickness and nothing else. */
    sh.position.set(bx, top + 0.16, bz);
    sh.rotation.set(-1.16, this.A.yaw, 0, 'YXZ');
  }

  /** The materials, laid out along the bench where she can reach them. */
  _layKit() {
    const k = this.kit;
    if (!k || !this.A.benchAt) return;
    const [bx, bz] = this.A.benchAt;
    const top = this.A.benchTop ?? this.ground + 0.94;
    /* pushed to the far side of the bench so it does not sit on top of the
       stick, and turned with the shop so the row runs along the bench */
    k.position.set(bx - this.s * 0.16, top + 0.01, bz - this.c * 0.16);
    k.rotation.set(0, this.A.yaw, 0);
    k.scale.setScalar(1);
  }

  /** The saw, in her paw, biting deeper as the stroke goes on. */
  _handSaw(c) {
    this._hold(this.saw, 1, [Math.PI * 0.5, 0.18, 0.12], [0.05, -0.02 - c * 0.02, 0.10]);
  }

  /** Held in the coals, which is where the heat beat wants it. */
  _forgeWeapon() {
    const [fx, fz] = this.A.forgeAt || [this.A.x, this.A.z];
    this._lay(this.weaponMesh, fx, this.forgeY + 0.05, fz,
      this.A.yaw + 0.5, Math.PI / 2 - 0.12, this.weaponScale);
  }

  /** Lying on the anvil, being hit. */
  _anvilWeapon() {
    const [ax, az] = this.A.anvilAt || [this.A.x, this.A.z];
    const top = this.A.anvilTop ?? this.ground + 0.55;
    this._lay(this.weaponMesh, ax, top + 0.03, az, this.A.yaw + 0.25, Math.PI / 2, this.weaponScale);
  }

  /** Lying on some other surface (the grindstone). */
  _propWeapon(at, y, yawOff, tilt) {
    if (!at) return;
    this._lay(this.weaponMesh, at[0], y, at[1], this.A.yaw + yawOff, Math.PI / 2 - tilt, this.weaponScale);
  }

  /* --------------------------------------------------------------- effects */

  _effects(B, u, dt) {
    /* --- THE KICK decays on its own, wherever it came from ------------- */
    this.kick = Math.max(0, this.kick - dt * 6.5);

    if (B.sparks) {
      /* one burst per hammer blow, timed to the bottom of the swing */
      const grind = B.id === 'grind';
      const beats = grind ? 10 : 4;
      const idx = Math.floor(u * beats);
      if (idx !== this._strikeAt) {
        this._strikeAt = idx;
        const at = grind ? this.A.grindAt : this.A.anvilAt;
        const y = grind ? (this.A.grindTop ?? this.ground + 0.74) : (this.A.anvilTop ?? this.ground + 0.78);
        if (at) this.motes.burst(at[0], y + 0.06, at[1], 'hot', grind ? 0.55 : 1);
        if (grind) {
          this.G.audio?.rasp?.(0.55);
        } else {
          /* `thump` never existed. Every hammer blow in this scene has
             been silent since the day it was written, and optional
             chaining meant nothing ever said so. */
          this.G.audio?.forgeHit?.(1);
          this.kick = 1;
          this.heat = Math.min(1, this.heat + 0.10);   // the work flares
        }
      }
    }

    if (B.chips) {
      const n = B.id === 'cut' ? 7 : 5;
      const idx = Math.floor(u * n);
      if (idx !== this._strikeAt) {
        this._strikeAt = idx;
        const [bx, bz] = this.A.benchAt || [this.A.x, this.A.z];
        this.motes.burst(bx, (this.A.benchTop ?? this.ground + 0.94) + 0.05, bz, 'chip', 1);
        if (B.id === 'cut') this.G.audio?.rasp?.(0.42);
      }
    }

    /* --- THE HEARTH -----------------------------------------------------
       The heat beat drives it up; it holds through the hot beats and dies
       away over the cold ones. Flicker is two detuned sines rather than
       noise: a light that flickers randomly reads as a fault, and one
       that breathes reads as a fire. */
    if (B.fire) {
      const ph = (u * 2) % 1;                                // two bellows strokes
      const push = ph < 0.42 ? smoothstep(ph / 0.42) : 1 - smoothstep((ph - 0.42) / 0.58);
      this.heat = Math.max(this.heat, 0.35 + push * 0.65);
      if (Math.floor(u * 2) !== this._strikeAt) {
        this._strikeAt = Math.floor(u * 2);
        this.motes.burst(this.A.forgeAt?.[0] ?? this.A.x, this.forgeY + 0.08,
          this.A.forgeAt?.[1] ?? this.A.z, 'hot', 0.55);
        this.G.audio?.coals?.(4);
      }
    } else if (B.id === 'quench') {
      this.heat = Math.max(0, this.heat - dt * 2.2);          // it goes out fast
    } else {
      this.heat = Math.max(0.12, this.heat - dt * 0.45);      // embers
    }

    if (this.forgeLight) {
      const f = 1 + Math.sin(this.t * 7.3) * 0.07 + Math.sin(this.t * 11.9 + 1.3) * 0.045;
      this.forgeLight.intensity = this.heat * 5.2 * f;
      /* hotter coals are yellower, dying ones are red — the colour is
         doing as much work here as the brightness */
      this.forgeLight.color.setHex(this.heat > 0.6 ? 0xffa23c : this.heat > 0.3 ? 0xff7a2c : 0xd8481c);
    }

    /* --- STEAM. Slow, pale and rising, which is the only thing that
       makes it read as steam rather than as more sparks. */
    if (B.steam) {
      const idx = Math.floor(u * 4);
      if (idx !== this._strikeAt) {
        this._strikeAt = idx;
        this.motes.burst(this.A.forgeAt?.[0] ?? this.A.x, this.forgeY + 0.12,
          this.A.forgeAt?.[1] ?? this.A.z, 'steam', 1);
      }
    }
  }
}

/* ========================================================================= */
/* HELPERS                                                                   */
/* ========================================================================= */

/** Put every joint the beats touch back to a plain standing pose. */
function restPose(rig) {
  const p = rig.parts;
  p.hip.rotation.set(0, 0, 0);
  p.torso.rotation.set(0, 0, 0);
  p.torso.scale.set(1, 1, 1);
  if (p.neck) p.neck.rotation.set(0, 0, 0);
  p.head.rotation.set(0, 0, 0);
  for (const arm of p.arms) {
    arm.shoulder.rotation.set(-0.05, 0, arm.side * 0.14);
    arm.elbow.rotation.set(-0.25, 0, 0);
  }
  for (const leg of p.legs) {
    leg.hip.rotation.set(0, 0, 0);
    leg.knee.rotation.set(0.08, 0, 0);
    if (leg.ankle) leg.ankle.rotation.set(0, 0, 0);
  }
}

function wrapPi(a) {
  while (a > Math.PI) a -= TAU;
  while (a < -Math.PI) a += TAU;
  return a;
}
