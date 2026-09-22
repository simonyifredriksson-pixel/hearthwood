/* BeastArt.js — the things in the wood, built from one quadruped rig.
   ===========================================================================
   Five body plans — wolf, boar, cat, stag, hare — off one skeleton, so the
   animator only has to know about one set of joints and every creature can
   share a gait, a lunge and a flinch. What differs between them is the
   SHAPE hung on that skeleton: a boar is a wedge with its mass at the
   shoulder, a wolf is a level back and a deep chest, a cat is a long spine
   that flexes, a stag is legs and neck, a hare is haunches.

   The rig is deliberately the same shape as the villagers' and the player's
   (`parts.hip / torso / neck / head / legs[] / tail`) so Anim-style code can
   pose any of them without special cases.

   ORIENTATION: **+Z is forward**, matching every other character in the
   game, so `rig.root.rotation.y = yaw` points a beast the way it is going.
*/

import * as THREE from '../../lib/three.module.js?v=1790103247';
import { MeshBuilder, blob, tube, box } from './Geo.js?v=1790103247';
import { MATS } from './Materials.js?v=1790103247';
import { mixHex, shade, tweak } from './Palette.js?v=1790103247';
import { makeRng, clamp, lerp, TAU } from '../core/Util.js?v=1790103247';

/** Proportions per body plan, as fractions of the creature's length. */
const PLAN = {
  /*
   * THE BEAR, and why the wood needed one.
   *
   * There was no bear at all — the five plans were hare, boar, wolf, cat
   * and stag, and the biggest thing in the game was a direwolf standing
   * about as tall as the fox. Nothing in the wood was IMPOSING.
   *
   * A bear is not a big wolf, and building it as one is exactly the
   * "basic reskin" the brief objects to. The proportions that make it a
   * bear: a chest half again as deep as the hips so it is front-heavy, a
   * pronounced shoulder hump, SHORT legs for its bulk (this is what
   * makes a bear read as heavy rather than as tall), a short thick neck
   * carried low, a broad blunt head and essentially no tail. Round ears
   * set wide on the skull are most of what makes it read as cute rather
   * than as a monster, which is the line the art style has to walk.
   */
  bear: {
    /* The neck looks too long for a bear on paper and is not: at 0.12 the
       head was swallowed by the shoulder hump and the animal read as a
       slab with ears. It needs enough neck to carry the head CLEAR of the
       hump and forward of the chest — a bear's head is low and out in
       front, which is where the whole silhouette comes from. */
    len: 1.16, chest: 0.47, hip: 0.40, legs: 0.44, neck: 0.30, headL: 0.42,
    snout: 0.46, ears: 'round', tail: 'stub', back: -0.04, shoulder: 0.18,
    heavy: true, shag: 1.0,
  },
  wolf: {
    len: 1.00, chest: 0.30, hip: 0.26, legs: 0.52, neck: 0.22, headL: 0.30,
    snout: 0.55, ears: 'point', tail: 'brush', back: 0.02, shoulder: 0.03,
    shag: 0.9,
  },
  /* a boar's coat is BRISTLE, not fur: a hard crest down the spine and
     almost nothing on the flanks, which is a different silhouette
     entirely and the reason the ridge is dialled up and the rest down */
  boar: {
    len: 0.92, chest: 0.40, hip: 0.26, legs: 0.36, neck: 0.10, headL: 0.34,
    snout: 0.70, ears: 'flap', tail: 'tuft', back: -0.05, shoulder: 0.11, tusks: true,
    shag: 0.55, crest: 1.6,
  },
  cat: {
    len: 0.96, chest: 0.24, hip: 0.25, legs: 0.48, neck: 0.16, headL: 0.24,
    snout: 0.30, ears: 'tuft', tail: 'long', back: 0.04, shoulder: 0.01,
    shag: 0.35,
  },
  stag: {
    len: 1.05, chest: 0.30, hip: 0.28, legs: 0.74, neck: 0.42, headL: 0.26,
    snout: 0.62, ears: 'leaf', tail: 'tuft', back: 0.05, shoulder: 0.05, antlers: true,
    shag: 0.30,
  },
  hare: {
    len: 0.72, chest: 0.24, hip: 0.32, legs: 0.40, neck: 0.10, headL: 0.24,
    snout: 0.35, ears: 'long', tail: 'puff', back: 0.10, shoulder: -0.02,
    shag: 0.5,
  },
};

const joint = (parent, x, y, z, name) => {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  g.name = name;
  parent.add(g);
  return g;
};

const attach = (node, builder, mat = MATS.character) => {
  if (builder.isEmpty) return null;
  const m = new THREE.Mesh(builder.build({ flat: false }), mat);
  m.castShadow = true; m.receiveShadow = true;
  node.add(m);
  return m;
};

/**
 * Build a creature.
 * @param spec  an entry from BeastData
 * @returns a rig with the same shape every other character in the game has
 */
export function buildBeast(spec, { seed = 1 } = {}) {
  const r = makeRng(seed ^ 0xbea57);
  const P = PLAN[spec.build] || PLAN.wolf;
  const S = spec.size;                       // shoulder height, roughly
  const L = S * P.len * 1.55;                // nose to tail root
  const [coat, belly, dark] = spec.cols;

  const root = new THREE.Group();
  root.name = spec.id;

  const hipY = S * (1 + P.back * 0.5);
  const hip = joint(root, 0, hipY, -L * 0.20, 'hip');
  const torso = joint(hip, 0, 0, 0, 'torso');

  /* --- the body: a loft from haunch to chest ---------------------------- */
  {
    const b = new MeshBuilder();
    const N = 9;
    /* twelve round rather than eight: at eight the flank is one large
       quad and every animal had a visible flat side */
    const SEG = 12;
    const rings = [];
    for (let i = 0; i <= N; i++) {
      const t = i / N;                        // 0 tail end, 1 chest
      const z = lerp(-L * 0.10, L * 0.52, t);
      /* the silhouette: haunch, waist, shoulder. The dip between them is
         the single thing that stops a quadruped reading as a sausage. */
      const w = S * lerp(P.hip, P.chest, t)
        * (1 - Math.sin(t * Math.PI) * 0.22)
        + S * P.shoulder * Math.pow(t, 3);
      const y = S * (P.back * Math.sin(t * Math.PI) * 0.6);
      const ring = [];
      for (let k = 0; k < SEG; k++) {
        const a = (k / SEG) * TAU;
        const ca = Math.cos(a), sa = Math.sin(a);
        b.color(mixHex(belly, coat, clamp(ca * 0.5 + 0.5, 0, 1)), 0.06, r);
        /* NOT A CIRCLE. An animal is taller than it is wide through the
           chest and its belly is flatter than its back; a round section
           lofted along a near-constant width is a tube, which is what
           every one of these read as. Narrowing the sides and flattening
           the underside costs nothing and is most of the difference
           between a body and a pipe. */
        const flat = ca < 0 ? 0.80 : 1.0;       // belly flatter than back
        ring.push(b.vert(sa * w * 0.86, y + ca * w * 1.02 * flat, z));
      }
      rings.push(ring);
    }
    /* WOUND SO THE OUTSIDE FACES OUT.
       The obvious ordering — round the ring one way, then forward — put
       every triangle of the body inside out, and an inverted surface is
       not shaded wrong, it is CULLED: the wolf rendered as a hollow shell
       and you saw the inside of its far flank as a pale sheet over its
       back. This is the fourth time this exact fault has appeared in this
       project (the terrain, the river, the sword blades, and now this),
       so: build it, then render it with back faces in magenta, always.
       `a` runs clockwise seen from the front, so the ring order has to be
       reversed against the direction of travel. */
    for (let i = 0; i < N; i++) {
      for (let k = 0; k < SEG; k++) {
        const k2 = (k + 1) % SEG;
        b.quad(rings[i][k2], rings[i][k], rings[i + 1][k], rings[i + 1][k2]);
      }
    }
    /* CAP THE ENDS FLAT, not with a cone.
       The first version put the cap's centre vertex on the body axis at a
       fixed height and fanned to it, which builds a spike sticking out
       past the last ring — every creature in the sheet had a pale sail
       over its shoulders. A cap has to sit IN the plane of the ring it
       closes and at that ring's own centre, and then it is invisible,
       which is what a cap is for. */
    for (const [ring, i, dir] of [[rings[0], 0, -1], [rings[N], N, 1]]) {
      const t = i / N;
      const cz = lerp(-L * 0.10, L * 0.52, t);
      const cy = S * (P.back * Math.sin(t * Math.PI) * 0.6);
      b.color(shade(coat, -0.12), 0.05, r);
      const c = b.vert(0, cy, cz);
      for (let k = 0; k < SEG; k++) {
        const k2 = (k + 1) % SEG;
        if (dir > 0) b.tri(c, ring[k], ring[k2]); else b.tri(c, ring[k2], ring[k]);
      }
    }
    attach(torso, b);
  }

  /* --- FUR --------------------------------------------------------------
     The line-up before this was twelve smooth shapes, and smooth is the
     one thing a wild animal is not. None of it is a texture — there are
     no textures in this game — so the coat has to be in the SILHOUETTE,
     which means geometry: strands standing off the back, a ruff at the
     shoulder, and a fringe under the belly.

     It is deliberately sparse. A hundred strands would be a hairball and
     would cost more triangles than the animal; thirty or forty, placed
     where a coat actually breaks an outline, is enough for the eye to
     fill in the rest. What it buys is that a wolf seen against the
     treeline is a wolf and not a grey wedge.
  */
  {
    const b = new MeshBuilder();
    const shag = P.shag ?? 0.6;                 // how heavy this coat is
    const zAt = t => lerp(-L * 0.10, L * 0.52, t);
    const wAt = t => S * lerp(P.hip, P.chest, t) * (1 - Math.sin(t * Math.PI) * 0.22)
      + S * P.shoulder * Math.pow(t, 3);
    const yAt = t => S * (P.back * Math.sin(t * Math.PI) * 0.6);

    /**
     * One strand of coat at (t along the body, angle round the ring).
     *
     * IT LIES DOWN. The first version sent the tip as far out from the
     * body as it sent it back, and thirty of those is not a coat — it is
     * a hedgehog. Every animal in the line-up came back with broken
     * twigs glued to its spine. Fur lies along the body in the direction
     * the animal has been travelling: a lot of backward, a little of
     * outward, and SHORT. What reads as a coat is many small breaks in
     * the outline, not a few large ones.
     */
    const strand = (t, a, len, thick) => {
      const w = wAt(t), z = zAt(t), y = yAt(t);
      const ca = Math.cos(a), sa = Math.sin(a);
      /* THE SAME SECTION THE BODY USES. If these two ever disagree the
         strands either float off the flank or start inside it, and both
         look like a bug rather than like fur. */
      const flat = ca < 0 ? 0.80 : 1.0;
      const sx = sa * 0.86, sy = ca * 1.02 * flat;
      const x0 = sx * w, y0 = y + sy * w;
      const out = len * 0.30;
      /* CLOSE TO THE COAT. Mixed a third of the way to the dark the
         strands read as dashes of a different animal stuck on — at a
         fifth they read as the coat catching the light differently,
         which is what fur does. */
      b.color(mixHex(coat, r.chance(0.35) ? belly : dark, r.range(0.05, 0.22)), 0.09, r);
      tube(b, {
        pts: [[x0, y0, z], [sx * (w + out), y + sy * (w + out), z - len * 1.3]],
        radius: tt => thick * (1 - tt * 0.85), radial: 3,
        capStart: false, capEnd: true, sway: () => 0,
      });
    };

    /* THE RUFF at the shoulder, which is the heaviest fur on any of these
       animals and the one that changes the silhouette most */
    const ruffN = Math.round(16 * shag);
    for (let i = 0; i < ruffN; i++) {
      const a = r.range(0, TAU);
      /* SCALED BY THE CHEST, SO CAP IT. A bear's chest is 0.47 of its
         shoulder height and a Greatmaw's shoulder is two and a half
         metres, so "two fifths of the chest" came out as half-metre
         quills — the biggest animals got the silliest coats precisely
         because the rule was proportional. */
      strand(r.range(0.70, 0.95), a,
        Math.min(S * 0.085, S * P.chest * r.range(0.14, 0.26)) * shag, S * 0.026 * shag);
    }
    /* THE SPINE, from the shoulder back to the haunch. A boar's is a
       stiff crest and stands twice as proud as a wolf's back hair. */
    const crest = P.crest ?? 1;
    const spineN = Math.round(18 * shag);
    for (let i = 0; i < spineN; i++) {
      const t = r.range(0.08, 0.90);
      const a = r.range(-0.6, 0.6) / crest;     // near the top of the ring
      strand(t, a, S * r.range(0.030, 0.060) * shag * crest, S * 0.021 * shag);
    }
    /* THE HAUNCH AND FLANK, which is what stops the back half being a cone */
    const flankN = Math.round(14 * shag);
    for (let i = 0; i < flankN; i++) {
      const side = r.chance(0.5) ? 1 : -1;
      strand(r.range(0.02, 0.40), side * r.range(0.9, 2.1),
        S * r.range(0.030, 0.055) * shag, S * 0.021 * shag);
    }
    /* THE BELLY FRINGE — short, and only on the shaggy ones */
    if (shag > 0.7) {
      for (let i = 0; i < 8; i++) {
        strand(r.range(0.18, 0.72), Math.PI + r.range(-0.6, 0.6),
          S * r.range(0.025, 0.050) * shag, S * 0.020 * shag);
      }
    }
    attach(torso, b);
  }

  /* --- neck and head ----------------------------------------------------- */
  const neck = joint(torso, 0, S * (0.06 + P.back * 0.3), L * 0.50, 'neck');
  {
    /* THE NECK IS A LOFT, and it took three goes to get here.
       ------------------------------------------------------------------
       It was a `tube` first, and `tube` derives its frame from the path
       direction: a path running up AND forward flipped its winding, so
       the neck rendered inside out and read as a pale flag stuck to the
       shoulder. The fix was five overlapping blobs, on the grounds that a
       blob cannot be inverted — and it could not, but five spheres of
       nearly the same radius spaced a few centimetres apart do not read
       as a neck. They read as a stack of tyres, which is exactly what
       every wolf in the line-up had bolted to its chest.

       A ring loft is the answer and the winding is not a mystery: it is
       the same construction the body above uses, and the same quad order
       is correct here for a reason worth writing down. The body places
       ring points at X·sin(a) + Y·cos(a) and advances along +Z, and
       X × Y = Z. Here the ring lies in X and U where U = dir × X, so
       X × U = dir. Same handedness, so the same winding — rather than
       "try it and see which way it culls". */
    const b = new MeshBuilder();
    const N = 7;
    const ny = S * P.neck, nz = S * P.neck * 0.8;
    const dl = Math.hypot(ny, nz) || 1;
    const dy = ny / dl, dz = nz / dl;
    const ux = 0, uy = dz, uz = -dy;          // U = dir x X
    const rings = [];
    for (let i = 0; i <= N; i++) {
      /* IT STARTS INSIDE THE CHEST. Beginning the loft exactly at the
         neck joint left its first ring sitting on the body's front cap,
         and because the neck is paler underneath than the chest is, that
         showed as a light collar round every animal's throat. Running it
         back a quarter of its own length buries the join. */
      const t = lerp(-0.28, 1, i / N);
      /* thick at the shoulder, narrowing into the skull, with a slight
         swell a third of the way up — that swell is the crest, and it is
         most of what separates a neck from a cone */
      const w = S * lerp(P.chest * 0.66, P.chest * 0.34, clamp(t, 0, 1))
        * (1 + Math.sin(clamp(t, 0, 1) * Math.PI) * 0.10);
      const cy = ny * t, cz = nz * t;
      const ring = [];
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * TAU;
        const ca = Math.cos(a), sa = Math.sin(a);
        b.color(mixHex(belly, coat, clamp(ca * 0.5 + 0.5, 0, 1)), 0.06, r);
        ring.push(b.vert(
          sa * w + ux * ca * w * 0.92,
          cy + uy * ca * w * 0.92,
          cz + uz * ca * w * 0.92));
      }
      rings.push(ring);
    }
    for (let i = 0; i < N; i++) {
      for (let k = 0; k < 8; k++) {
        const k2 = (k + 1) % 8;
        b.quad(rings[i][k2], rings[i][k], rings[i + 1][k], rings[i + 1][k2]);
      }
    }
    /* only the far end needs closing — the shoulder end is buried in the
       chest, and a cap there is a disc inside the animal */
    b.color(shade(coat, -0.10), 0.05, r);
    const c = b.vert(0, ny, nz);
    for (let k = 0; k < 8; k++) b.tri(c, rings[N][k], rings[N][(k + 1) % 8]);
    attach(neck, b);
  }
  const head = joint(neck, 0, S * P.neck, S * P.neck * 0.8, 'head');
  {
    const b = new MeshBuilder();
    const hl = S * P.headL;
    /* skull */
    b.color(coat, 0.05, r);
    blob(b, 0, 0, hl * 0.18, hl * 0.42, 4, 8, (x, y, z) => [1, 0.92, 1.12]);
    /* muzzle */
    b.color(mixHex(coat, dark, 0.3), 0.05, r);
    tube(b, {
      pts: [[0, -hl * 0.08, hl * 0.32], [0, -hl * 0.16, hl * (0.32 + P.snout)]],
      radius: t => hl * lerp(0.30, 0.17, t), radial: 6, capStart: false, capEnd: true, sway: () => 0,
    });
    b.color(0x1a1410, 0.04, r);
    blob(b, 0, -hl * 0.14, hl * (0.34 + P.snout), hl * 0.09, 3, 6);
    /* eyes */
    for (const s of [1, -1]) {
      b.color(0xf4efe2, 0.03, r);
      blob(b, s * hl * 0.26, hl * 0.10, hl * 0.22, hl * 0.12, 3, 6);
      b.color(spec.glow ? spec.glow : 0x17120c, 0.03, r);
      blob(b, s * hl * 0.29, hl * 0.10, hl * 0.28, hl * 0.075, 3, 6);
    }
    /* ears */
    const ear = (s) => {
      b.color(mixHex(coat, dark, 0.35), 0.06, r);
      if (P.ears === 'point') {
        tube(b, {
          pts: [[s * hl * 0.26, hl * 0.30, -hl * 0.02], [s * hl * 0.34, hl * 0.72, -hl * 0.10]],
          radius: t => hl * 0.15 * (1 - t * 0.85), radial: 4, capStart: false, capEnd: true, sway: () => 0,
        });
      } else if (P.ears === 'long') {
        tube(b, {
          pts: [[s * hl * 0.18, hl * 0.32, -hl * 0.04],
          [s * hl * 0.26, hl * 0.95, -hl * 0.16], [s * hl * 0.30, hl * 1.45, -hl * 0.24]],
          radius: t => hl * 0.13 * (1 - t * 0.5), radial: 4, capStart: false, capEnd: true, sway: () => 0,
        });
      } else if (P.ears === 'leaf') {
        blob(b, s * hl * 0.32, hl * 0.42, -hl * 0.06, hl * 0.20, 3, 6, (x, y, z) => [0.5, 1.6, 0.35]);
      } else if (P.ears === 'tuft') {
        tube(b, {
          pts: [[s * hl * 0.24, hl * 0.30, 0], [s * hl * 0.30, hl * 0.62, -hl * 0.04]],
          radius: t => hl * 0.13 * (1 - t), radial: 4, capStart: false, capEnd: true, sway: () => 0,
        });
      } else if (P.ears === 'round') {
        /* BIG ROUND EARS, SET WIDE. This is the single detail that keeps
           a two-and-a-half-metre predator on the right side of the art
           style: the same animal with small flat ears is a monster, and
           with these it is something you would still rather not meet but
           would recognise from a picture book. */
        const ex = s * hl * 0.42, ey = hl * 0.34, ez = -hl * 0.06;
        blob(b, ex, ey, ez, hl * 0.23, 4, 8, () => [0.42, 1.0, 1.0]);
        b.color(mixHex(coat, 0xd8a89a, 0.45), 0.05, r);
        blob(b, ex + s * hl * 0.05, ey, ez + hl * 0.02, hl * 0.15, 3, 7, () => [0.30, 0.90, 0.90]);
        b.color(mixHex(coat, dark, 0.35), 0.06, r);
      } else {
        blob(b, s * hl * 0.30, hl * 0.20, -hl * 0.04, hl * 0.17, 3, 6, (x, y, z) => [0.45, 1.5, 0.6]);
      }
    };
    ear(1); ear(-1);

    if (P.tusks) {
      b.color(0xe8e0c8, 0.04, r);
      for (const s of [1, -1]) {
        tube(b, {
          pts: [[s * hl * 0.16, -hl * 0.16, hl * (0.28 + P.snout * 0.7)],
          [s * hl * 0.22, hl * 0.06, hl * (0.34 + P.snout)]],
          radius: t => hl * 0.07 * (1 - t * 0.8), radial: 4, capStart: false, capEnd: true, sway: () => 0,
        });
      }
    }
    if (P.antlers) {
      b.color(0xbfa878, 0.07, r);
      for (const s of [1, -1]) {
        const base = [s * hl * 0.22, hl * 0.34, -hl * 0.02];
        tube(b, {
          pts: [base, [s * hl * 0.45, hl * 0.95, -hl * 0.10], [s * hl * 0.60, hl * 1.45, hl * 0.10]],
          radius: t => hl * 0.09 * (1 - t * 0.6), radial: 4, capStart: false, capEnd: true, sway: () => 0,
        });
        for (let i = 0; i < 3; i++) {
          const t = 0.3 + i * 0.25;
          tube(b, {
            pts: [[s * hl * lerp(0.22, 0.6, t), hl * lerp(0.34, 1.45, t), hl * lerp(-0.02, 0.1, t)],
            [s * hl * (0.75 + i * 0.12), hl * (0.9 + i * 0.34), hl * (0.3 + i * 0.1)]],
            radius: tt => hl * 0.055 * (1 - tt * 0.8), radial: 4, capStart: false, capEnd: true, sway: () => 0,
          });
        }
      }
    }
    attach(head, b);
  }

  /* --- legs -------------------------------------------------------------- */
  const legs = [];
  const legLen = S * P.legs;
  for (let i = 0; i < 4; i++) {
    const front = i < 2;
    const side = i % 2 ? 1 : -1;
    const zOff = front ? L * 0.40 : -L * 0.04;
    const xOff = side * S * (front ? P.chest : P.hip) * 0.72;

    /* A REAL STANCE, and it has to live in the JOINT POSITIONS.
       ------------------------------------------------------------------
       All four legs were straight vertical posts, which is why every
       creature in the line-up stood like a coffee table. A quadruped's
       legs zig-zag: the foreleg's elbow sits behind the shoulder and the
       wrist comes forward under it, and the hind leg is far more
       dramatic — the stifle swings forward, the hock kicks back, and the
       cannon bone drops vertically. That Z is most of what makes a wolf
       look like it could move.

       It cannot be baked as rest ROTATIONS: Anim assigns
       `knee.rotation.x` and `hock.rotation.x` absolutely on every frame,
       so anything set here is gone by the first update. Put in the joint
       offsets it survives, because what Anim rotates is the pivot, and
       the pivot is where this puts it.

       THE FOUR FEET MUST LAND LEVEL. The vertical drops are chosen to
       sum to the same `legLen` front and back — the horizontal zig-zag
       is free, but a hind leg that is shorter overall tips the whole
       animal nose-down, and it is not obvious in a side view until
       something stands next to it. */
    const seg = front
      ? [[0, -0.46, -0.06], [0, -0.34, 0.05], [0, -0.20, 0.01]]
      : [[0, -0.44, 0.11], [0, -0.36, -0.13], [0, -0.20, 0.02]];
    const P1 = seg[0].map(v => v * legLen);
    const P2 = seg[1].map(v => v * legLen);
    const P3 = seg[2].map(v => v * legLen);

    const top = joint(front ? torso : hip, xOff, -S * 0.02, zOff, front ? 'foreleg' : 'hindleg');
    const knee = joint(top, P1[0], P1[1], P1[2], 'knee');
    const hock = joint(knee, P2[0], P2[1], P2[2], 'hock');

    const b1 = new MeshBuilder();
    b1.color(mixHex(coat, dark, 0.22), 0.06, r);
    tube(b1, {
      pts: [[0, 0, 0], P1],
      radius: t => S * 0.085 * (1 - t * 0.22), radial: 5, capStart: true, capEnd: false, sway: () => 0,
    });
    attach(top, b1);
    const b2 = new MeshBuilder();
    b2.color(mixHex(coat, dark, 0.35), 0.06, r);
    tube(b2, {
      pts: [[0, 0, 0], P2],
      radius: t => S * 0.065 * (1 - t * 0.2), radial: 5, capStart: false, capEnd: false, sway: () => 0,
    });
    attach(knee, b2);
    const b3 = new MeshBuilder();
    b3.color(dark, 0.05, r);
    tube(b3, {
      pts: [[0, 0, 0], P3],
      radius: () => S * 0.055, radial: 5, capStart: false, capEnd: false, sway: () => 0,
    });
    blob(b3, P3[0], P3[1] - S * 0.01, P3[2] + S * 0.03, S * 0.075, 3, 6, () => [1.1, 0.6, 1.3]);
    attach(hock, b3);

    legs.push({ hip: top, knee, hock, ankle: hock, side, front });
  }

  /* --- tail --------------------------------------------------------------- */
  const tail = [];
  {
    const t0 = joint(hip, 0, S * 0.10, -L * 0.14, 'tail');
    const b = new MeshBuilder();
    b.color(mixHex(coat, dark, 0.2), 0.07, r);
    if (P.tail === 'brush') {
      /* A BRUSH, NOT A STRING OF BEADS. Four blobs of near-identical
         radius laid along a line is a caterpillar; you could count them
         in the render. A brush tail is thin at the root, THICKEST about
         two thirds along, and comes to a point — so it is built as a
         loft with that profile, and then the hair is added on top of it
         as a dozen strands that break the outline. */
      const N = 7;
      const px = t => [0, -t * S * 0.16, -t * S * 0.70];
      const pw = t => S * (0.055 + Math.sin(clamp(t, 0, 1) * 2.2) * 0.085) * (1 - t * 0.35);
      const rings = [];
      for (let i = 0; i <= N; i++) {
        const t = i / N, p = px(t), w = Math.max(0.012 * S, pw(t));
        const ring = [];
        for (let k = 0; k < 6; k++) {
          const a = (k / 6) * TAU;
          b.color(mixHex(coat, dark, 0.18 + t * 0.30), 0.07, r);
          ring.push(b.vert(p[0] + Math.sin(a) * w, p[1] + Math.cos(a) * w, p[2]));
        }
        rings.push(ring);
      }
      for (let i = 0; i < N; i++) {
        for (let k = 0; k < 6; k++) {
          const k2 = (k + 1) % 6;
          /* the loft runs along -Z, so the ring order is the reverse of
             the body's, which advances along +Z */
          b.quad(rings[i][k], rings[i][k2], rings[i + 1][k2], rings[i + 1][k]);
        }
      }
      b.color(mixHex(coat, dark, 0.5), 0.06, r);
      const tipC = b.vert(...px(1));
      for (let k = 0; k < 6; k++) b.tri(tipC, rings[N][(k + 1) % 6], rings[N][k]);
      /* the hair — eight, not twelve, and standing barely half as proud.
         At two body-radii out it was a bottle brush. */
      for (let i = 0; i < 8; i++) {
        const t = 0.30 + (i / 8) * 0.60;
        const a = r.range(0, TAU);
        const p = px(t), w = pw(t);
        b.color(mixHex(coat, i % 3 ? dark : belly, 0.18), 0.09, r);
        tube(b, {
          pts: [[p[0] + Math.sin(a) * w * 0.7, p[1] + Math.cos(a) * w * 0.7, p[2]],
          [p[0] + Math.sin(a) * w * 1.35, p[1] + Math.cos(a) * w * 1.35, p[2] - S * r.range(0.05, 0.11)]],
          radius: tt => S * 0.019 * (1 - tt), radial: 3,
          capStart: false, capEnd: true, sway: () => 0,
        });
      }
    } else if (P.tail === 'long') {
      tube(b, {
        pts: [[0, 0, 0], [0, S * 0.10, -S * 0.34], [0, S * 0.02, -S * 0.70]],
        radius: t => S * 0.045 * (1 - t * 0.4), radial: 5, capStart: false, capEnd: true, sway: () => 0,
      });
    } else if (P.tail === 'puff') {
      blob(b, 0, 0, -S * 0.12, S * 0.12, 3, 7);
    } else if (P.tail === 'stub') {
      /* barely there, which is itself a recognisable silhouette cue */
      blob(b, 0, -S * 0.02, -S * 0.07, S * 0.075, 3, 6, () => [1, 0.85, 1]);
    } else {
      tube(b, {
        pts: [[0, 0, 0], [0, -S * 0.06, -S * 0.22]],
        radius: t => S * 0.035 * (1 - t * 0.5), radial: 4, capStart: false, capEnd: true, sway: () => 0,
      });
      blob(b, 0, -S * 0.07, -S * 0.24, S * 0.055, 3, 5);
    }
    attach(t0, b);
    tail.push(t0);
  }

  /* --- whatever glows ------------------------------------------------------ */
  if (spec.glow) {
    const g = new MeshBuilder();
    g.color(spec.glow, 0.08, r);
    const hl = S * P.headL;
    for (const s of [1, -1]) blob(g, s * hl * 0.29, hl * 0.10, hl * 0.30, hl * 0.10, 2, 5);
    const m = new THREE.Mesh(g.build({ flat: false }), MATS.glow);
    head.add(m);
  }

  return {
    root, species: spec.id, spec,
    parts: { hip, torso, neck, head, legs, tail, arms: [], ears: [] },
    metrics: { height: S, length: L, radius: S * 0.45, eyeHeight: S * 1.05, hipHeight: hipY },
  };
}
