/* Anim.js — how the three animals move.
   ===========================================================================
   The models are different; the MOVEMENT is what actually sells them as
   different creatures, and it is written separately for each one. There is no
   shared walk cycle with a speed multiplier — a frog does not walk at all.

     FROG   HOPS. There is no walk cycle: `phase` drives a crouch, a launch,
            an airborne tuck and a landing squash, and the body leaves the
            ground. Standing still it does nothing but breathe through an
            inflating throat and blink one eye at a time.
     FOX    TROTS. A fast light four-beat gait, diagonal pairs, almost no
            vertical travel, and a long heavy tail that lags behind every
            turn. Idle: ear flicks, a slow tail curl, head tilts.
     BEAR   LUMBERS. Slow, wide, and its whole mass rolls side to side onto
            whichever foot is down. The head bobs a beat AFTER the shoulder,
            because a heavy head is always late.

   Everything here writes rotations and a couple of positions onto the rig's
   joints. Nothing rebuilds geometry, ever.
*/

import { clamp, clamp01, lerp, damp, dampAngle, TAU, smoothstep, makeRng } from '../core/Util.js?v=1790014463';
import { applyCarry, applyAttack, applyCharge } from './Combat.js?v=1790014463';

/* ========================================================================= */
/* SPECIES DEFINITIONS                                                       */
/* ========================================================================= */

/* The numbers a player can actually feel. Speed, acceleration and the height
   of a step are the whole difference between "agile" and "powerful" — the
   models only illustrate it. */
export const SPECIES = {
  frog: {
    key: 'frog', label: 'Frog', article: 'the',
    name: 'Pip',
    blurb: 'Small, springy and endlessly curious. Sees the world from knee height, ' +
      'which turns out to be exactly the height fallen wood lives at.',
    trait: 'Sharp-eyed — spots interesting sticks from further off.',
    walk: 3.4, run: 6.4, accel: 26, turn: 12,
    jump: 6.6, gravity: -19,
    stepUp: 0.55, reach: 2.9,
    satchel: 4,                 // bonus satchel capacity
    spotBonus: 9,               // extra metres of stick highlight range
    carryScale: 0.72,           // weapons are scaled to the wielder
    gait: 'hop', hopLen: 1.55,
    eyeHeight: 0.62,
    fur: null,
  },
  fox: {
    key: 'fox', label: 'Fox', article: 'the',
    name: 'Rell',
    blurb: 'Quick, light and hard to keep up with. Covers more of the wood in an ' +
      'afternoon than anyone else manages in three.',
    trait: 'Fleet — the fastest of the three, and the quickest to turn.',
    walk: 4.1, run: 8.2, accel: 32, turn: 16,
    jump: 5.6, gravity: -21,
    stepUp: 0.6, reach: 2.7,
    satchel: 0,
    spotBonus: 3,
    carryScale: 0.88,
    gait: 'trot',
    eyeHeight: 0.92,
  },
  bear: {
    key: 'bear', label: 'Bear', article: 'the',
    name: 'Bramm',
    blurb: 'Enormous, gentle and in absolutely no hurry. Can carry an entire ' +
      'fallen limb home under one arm without noticing.',
    trait: 'Broad-backed — carries far more wood, and pushes through thickets.',
    walk: 2.9, run: 5.4, accel: 16, turn: 7,
    jump: 4.6, gravity: -24,
    stepUp: 0.85, reach: 3.3,
    satchel: 18,
    spotBonus: 0,
    carryScale: 1.18,
    gait: 'lumber',
    eyeHeight: 1.32,
  },
};

/**
 * THE PLAYABLE ROSTER: fox and frog, and nothing else.
 *
 * The bear's modelling, rig and gait all still exist and are still used — it
 * is one of the villager kinds, and Gorse Widdy is a bear — but it is no
 * longer offered at character select. Two characters, each built and animated
 * from scratch, is worth more than three that share a skeleton.
 */
export const SPECIES_LIST = [SPECIES.fox, SPECIES.frog];

/** Every species the animator knows, playable or not. */
export const ALL_SPECIES = [SPECIES.frog, SPECIES.fox, SPECIES.bear];

/* ========================================================================= */
/* STATE                                                                     */
/* ========================================================================= */

/** Per-rig animation memory. Created lazily on first pose. */
function animState(rig) {
  if (rig._anim) return rig._anim;
  const r = makeRng(0x5a11 ^ (rig.species.length * 7919));
  rig._anim = {
    t: 0,
    phase: 0,            // gait phase, 0..1
    hopPhase: 0,
    hopping: false,
    speedS: 0,           // smoothed speed
    lean: 0, leanS: 0,
    turnRate: 0, turnS: 0,
    blink: 0, nextBlink: r.range(1, 4),
    earTwitch: 0, nextEar: r.range(0.6, 2.5),
    breathe: r.range(0, TAU),
    tailLag: 0, tailLagV: 0,
    headYaw: 0, headPitch: 0,
    look: null,
    action: null, actionT: 0,
    lastYaw: 0,
    groundY: 0,
    bodyY: 0,
    rnd: r,
  };
  return rig._anim;
}

/* ========================================================================= */
/* ENTRY POINT                                                               */
/* ========================================================================= */

/**
 * Pose a rig for this frame.
 *
 * @param rig    from buildAnimal()
 * @param st
 *   t         seconds
 *   dt        seconds since last frame
 *   speed     0..1, fraction of run speed
 *   moving    boolean
 *   grounded  boolean
 *   yaw       facing, radians
 *   action    null | 'pick' | 'swing' | 'wave' | 'sit'
 *   actionT   0..1 progress through the action
 *   lookAt    optional [x,y,z] in world space for the head
 * @returns {{bodyY:number}} vertical offset the body wants (hops leave the ground)
 */
export function poseAnimal(rig, st) {
  const A = animState(rig);
  const dt = clamp(st.dt ?? 0.016, 0, 0.1);
  A.t = st.t ?? (A.t + dt);

  const speed = clamp01(st.speed ?? 0);
  A.speedS = damp(A.speedS, speed, 9, dt);
  const moving = !!st.moving && speed > 0.02;

  /* turn rate, used for lean and for the tail lag */
  if (st.yaw !== undefined) {
    let d = st.yaw - A.lastYaw;
    while (d > Math.PI) d -= TAU;
    while (d < -Math.PI) d += TAU;
    A.turnRate = dt > 1e-5 ? d / dt : 0;
    A.lastYaw = st.yaw;
  }
  A.turnS = damp(A.turnS, clamp(A.turnRate, -6, 6), 8, dt);

  /* blinking and ear flicks are shared timing, not shared motion */
  A.blink = Math.max(0, A.blink - dt * 7);
  A.nextBlink -= dt;
  if (A.nextBlink <= 0) { A.blink = 1; A.nextBlink = A.rnd.range(1.6, 5.5); }
  A.earTwitch = Math.max(0, A.earTwitch - dt * 5);
  A.nextEar -= dt;
  if (A.nextEar <= 0) { A.earTwitch = 1; A.nextEar = A.rnd.range(0.7, 3.4); }

  A.breathe += dt * (moving ? 3.4 : 1.35);

  /* action overlay */
  A.action = st.action || null;
  A.actionT = st.actionT ?? 0;
  A.swing = st.swing || null;
  A.charge = st.charge || null;
  A.quad = clamp01(st.quad ?? 0);

  switch (rig.species) {
    case 'frog': poseFrog(rig, A, st, dt, speed, moving); break;
    case 'bear': poseBear(rig, A, st, dt, speed, moving); break;
    case 'human': poseHuman(rig, A, st, dt, speed, moving); break;
    default: poseFox(rig, A, st, dt, speed, moving); break;
  }

  headLook(rig, A, st, dt);
  return { bodyY: A.bodyY };
}

/* ========================================================================= */
/* FROG — hop, squash, breathe                                               */
/* ========================================================================= */

function poseFrog(rig, A, st, dt, speed, moving) {
  const p = rig.parts;
  const S = SPECIES.frog;

  /* --- the hop cycle ---------------------------------------------------- */
  /* A frog does not walk. The phase runs 0..1 per hop and the four stages
     are crouch (0–0.22), launch (0.22–0.38), flight (0.38–0.80), land
     (0.80–1.0). The body genuinely leaves the ground, and the landing
     squash is the part that makes it read as weight rather than as a
     floating model bobbing up and down. */
  const hopsPerSec = moving ? lerp(1.5, 3.2, speed) : 0;
  A.phase = moving ? (A.phase + dt * hopsPerSec) % 1 : damp(A.phase, 0, 6, dt);
  const ph = A.phase;

  let crouch = 0, airT = 0, stretch = 0, squash = 0;
  if (moving) {
    if (ph < 0.22) { crouch = smoothstep(ph / 0.22); }
    else if (ph < 0.38) { const u = (ph - 0.22) / 0.16; crouch = 1 - u; stretch = Math.sin(u * Math.PI) * 0.9; airT = u * 0.35; }
    else if (ph < 0.80) { const u = (ph - 0.38) / 0.42; airT = Math.sin(u * Math.PI) * 1.0 + 0.35 * (1 - u); stretch = 0.55 * (1 - u); }
    else { const u = (ph - 0.80) / 0.20; squash = Math.sin(u * Math.PI) * 1.0; airT = (1 - u) * 0.18; }
  }

  const hopH = lerp(0.18, 0.42, speed);
  A.bodyY = airT * hopH;

  /* squash and stretch on the whole animal — the single most important
     cartoon principle, and the only place in this game that uses scale */
  const sx = 1 + squash * 0.20 - stretch * 0.10 + crouch * 0.08;
  const sy = 1 - squash * 0.22 + stretch * 0.16 - crouch * 0.12;
  p.torso.scale.set(sx, sy, sx);

  /* the body pitches forward as it launches and back as it lands */
  p.hip.rotation.x = -stretch * 0.55 + squash * 0.35 + crouch * 0.28 + A.speedS * 0.10;
  p.hip.rotation.z = -A.turnS * 0.05;

  /* --- legs: fold tight, then fire ------------------------------------- */
  for (const leg of p.legs) {
    const fold = lerp(1.0, 0.0, clamp01(stretch * 1.4 + airT * 0.2));
    const tuck = crouch * 0.5 + (airT > 0.2 ? 0.55 : 0);
    // resting pose already has the knee folded up hard, frog-style
    leg.hip.rotation.x = -1.15 + fold * 0.10 - tuck * 0.55 + stretch * 1.25 + squash * 0.3;
    leg.knee.rotation.x = 2.10 - stretch * 1.85 + tuck * 0.35 - squash * 0.4;
    leg.ankle.rotation.x = -0.95 + stretch * 0.85 - squash * 0.35;
    leg.hip.rotation.z = leg.side * (0.30 + crouch * 0.12);
  }

  /* --- arms: tucked when airborne, propped when landing ---------------- */
  for (const arm of p.arms) {
    const isWeapon = arm.side > 0 && st.carrying;
    arm.shoulder.rotation.x = -0.25 - airT * 0.55 + squash * 0.75 + crouch * 0.20
      + Math.sin(A.breathe) * 0.035;
    arm.shoulder.rotation.z = arm.side * (0.34 + crouch * 0.1);
    arm.elbow.rotation.x = -0.65 - airT * 0.5 + squash * 0.35;
    if (isWeapon) { arm.shoulder.rotation.x = -0.55; arm.elbow.rotation.x = -0.95; }
  }

  /* --- idle: the throat. It is the frog's entire personality. ----------- */
  const puff = moving
    ? 1 + Math.sin(A.breathe * 1.4) * 0.10
    : 1 + Math.pow(Math.max(0, Math.sin(A.breathe * 0.9)), 2.2) * 0.55;
  p.throat.scale.set(puff, 0.75 + (puff - 1) * 1.4, puff);

  /* the eyes retract into the skull when it blinks, which is what a frog
     actually does, rather than closing a lid */
  const bl = 1 - A.blink * 0.75;
  p.eyeL.scale.set(1, bl, 1);
  p.eyeL.position.y = 0.150 - A.blink * 0.045;
  p.eyeR.scale.set(1, bl * (A.blink > 0.5 ? 1 : 1), 1);
  p.eyeR.position.y = 0.150 - A.blink * 0.045;

  /* head: almost no neck, so it barely moves independently */
  p.head.rotation.x = A.headPitch * 0.4 + squash * 0.18 - stretch * 0.12;
  p.head.rotation.y = A.headYaw * 0.55;

  applyAction(rig, A, st, dt, 1.0);
}

/* ========================================================================= */
/* HUMAN — a two-beat walk, and the one gait that is not an animal's         */
/* ========================================================================= */

/**
 * The construction workers.
 *
 * Bipedal, upright, arms counter-swinging against the legs. It is
 * deliberately the plainest gait in the game: every animal here moves with
 * some character — a hop, a trot, a roll — and the humans walk like people
 * on a job, which is exactly how they should read against the villagers.
 *
 * Written separately rather than reusing the fox because a human has no
 * ears to flick, no tail to lag, and no hock: poseFox reached straight for
 * all three and threw.
 */
function poseHuman(rig, A, st, dt, speed, moving) {
  const p = rig.parts;

  const stepsPerSec = moving ? lerp(1.5, 2.9, speed) : 0;
  A.phase = moving ? (A.phase + dt * stepsPerSec) % 1 : damp(A.phase, 0, 6, dt);
  const ph = A.phase * TAU;

  // a small vertical bounce, twice per stride
  A.bodyY = moving ? Math.abs(Math.sin(ph)) * 0.035 * speed : Math.sin(A.breathe * 0.7) * 0.006;

  const lean = clamp(A.speedS * 0.20, 0, 0.26);
  p.hip.rotation.x = lean;
  p.hip.rotation.z = clamp(-A.turnS * 0.06, -0.18, 0.18);
  p.torso.rotation.y = -Math.sin(ph) * 0.13 * A.speedS;
  p.torso.rotation.x = -lean * 0.4;

  /* --- legs: straight alternation, knee bends on the swing ------------- */
  p.legs.forEach((leg, i) => {
    const off = i === 0 ? 0 : Math.PI;
    const s = Math.sin(ph + off);
    const c = Math.cos(ph + off);
    const amp = 0.62 * A.speedS;
    leg.hip.rotation.x = s * amp;
    leg.knee.rotation.x = Math.max(0, -c) * 0.95 * A.speedS;
    if (leg.ankle && leg.ankle !== leg.knee) {
      leg.ankle.rotation.x = -leg.knee.rotation.x * 0.35 + s * 0.12 * A.speedS;
    }
  });

  /* --- arms counter-swing, which is most of what makes a walk read ----- */
  p.arms.forEach((arm, i) => {
    const off = i === 0 ? Math.PI : 0;       // opposite the leg on that side
    const s = Math.sin(ph + off);
    arm.shoulder.rotation.x = s * 0.52 * A.speedS - 0.06;
    arm.shoulder.rotation.z = arm.side * (0.10 + 0.04 * A.speedS);
    arm.elbow.rotation.x = -0.22 - Math.max(0, s) * 0.45 * A.speedS;
  });

  /* breathing, and a head that stays level while the body bounces */
  p.torso.scale.set(1, 1 + Math.sin(A.breathe) * 0.010, 1);
  if (p.neck) p.neck.rotation.x = lean * 0.5;
  p.head.rotation.x = -lean * 0.5 - Math.abs(Math.sin(ph)) * 0.03 * A.speedS;

  applyAction(rig, A, st, dt, 1.0);
}

/* ========================================================================= */
/* FOX — a light four-beat trot with a tail that lags                        */
/* ========================================================================= */

function poseFox(rig, A, st, dt, speed, moving) {
  const p = rig.parts;

  /* ----------------------------------------------------------------------
     THE SPRINT BLEND.

     `q` is how far onto four legs the fox is. It is a continuous value the
     Player damps, never a flag, because the brief asked for the transition
     itself to be the good bit. Everything below reads it:

       - the GAIT changes from a four-beat trot to a two-beat bound, so the
         legs do not merely move faster, they move in a different pattern;
       - the SPINE folds forward and the hips rise, which is the whole
         posture change;
       - the FRONT PAWS become front legs — they reach for the ground in
         phase with the rear pair rather than counter-swinging;
       - the HEAD levels out and leads, because a running animal looks where
         it is going and a walking one looks around;
       - the TAIL streams out flat behind as a counterweight.

     Blending each of those separately, rather than cross-fading two canned
     poses, is why the halfway point looks like a fox breaking into a run
     instead of a fox in two poses at once.
     ------------------------------------------------------------------- */
  const q = A.quad;
  const bound = smoothstep(q);              // how "gallop" the gait is

  /* a bound is two beats per cycle and covers more ground per beat, so the
     cadence does NOT simply scale with speed */
  const trotRate = lerp(2.1, 4.4, speed);
  const boundRate = lerp(2.3, 3.3, speed);
  const stepsPerSec = moving ? lerp(trotRate, boundRate, bound) : 0;
  A.phase = moving ? (A.phase + dt * stepsPerSec) % 1 : damp(A.phase, 0, 5, dt);
  const ph = A.phase * TAU;

  /* a trotting fox's back is famously level; a bounding one rises and falls
     through the whole stride, and that vertical travel IS the gallop */
  const trotY = Math.sin(ph * 2) * 0.018 * speed;
  const boundY = (Math.pow(Math.max(0, Math.sin(ph)), 1.5) * 0.085
    - Math.pow(Math.max(0, -Math.sin(ph)), 2) * 0.02) * speed;
  A.bodyY = moving ? lerp(trotY, boundY, bound) : Math.sin(A.breathe * 0.8) * 0.006;

  const lean = clamp(A.speedS * 0.22, 0, 0.3);
  /* the fold: hips up, chest down, spine along the direction of travel */
  const fold = bound * 1.02;
  p.hip.rotation.x = lean * 0.8 + fold * 0.34 + Math.sin(ph * 2) * 0.02 * A.speedS
    + Math.sin(ph) * 0.06 * bound;
  p.hip.rotation.z = clamp(-A.turnS * 0.10, -0.28, 0.28) * (1 - bound * 0.5);
  p.hip.position.y = rig.metrics.hipHeight * lerp(1, 0.86, bound);
  p.torso.rotation.x = -fold * 0.20 + Math.sin(ph * 2) * 0.05 * bound;
  p.torso.rotation.y = Math.sin(ph) * 0.05 * A.speedS * (1 - bound * 0.7);
  p.torso.scale.set(1, 1 + Math.sin(A.breathe) * 0.012, 1);

  /* --- legs ------------------------------------------------------------- */
  /* trot: diagonal pairs, half a cycle apart.
     bound: BOTH hind legs together, gathering under the body and firing.  */
  p.legs.forEach((leg, i) => {
    const off = i === 0 ? 0 : Math.PI;
    const sT = Math.sin(ph + off), cT = Math.cos(ph + off);
    const ampT = 0.55 * A.speedS;

    // the bound: both hinds in phase, a big reach and a hard gather
    const sB = Math.sin(ph - 0.35), cB = Math.cos(ph - 0.35);
    const ampB = 0.95 * A.speedS;

    const hipX = lerp(sT * ampT + lean * 0.3, sB * ampB - 0.30, bound);
    const kneeX = lerp(
      clamp(0.55 + (-cT * 0.5 - 0.15) * ampT * 1.6, 0.12, 1.5),
      clamp(0.95 + (-cB * 0.9) * ampB * 1.5, 0.15, 2.1), bound);
    const hockX = lerp(
      clamp(-0.75 + cT * 0.45 * ampT * 1.4, -1.5, -0.1),
      clamp(-1.15 + cB * 0.85 * ampB * 1.3, -2.0, -0.1), bound);
    const ankX = lerp(
      clamp(0.40 - sT * 0.35 * ampT, -0.2, 1.0),
      clamp(0.55 - sB * 0.55 * ampB, -0.3, 1.3), bound);

    leg.hip.rotation.x = hipX;
    leg.knee.rotation.x = kneeX;
    leg.hock.rotation.x = hockX;
    leg.ankle.rotation.x = ankX;
  });

  /* --- arms, which become FRONT LEGS ------------------------------------ */
  p.arms.forEach((arm, i) => {
    const s = Math.sin(ph + (i === 0 ? Math.PI : 0));
    const amp = 0.45 * A.speedS;
    const carrying = arm.side > 0 && st.carrying;

    /* upright: a counter-swing against the legs.
       four-legged: reaching forward together, half a cycle off the hinds,
       with the elbow straightening hard at the reach — that straight front
       leg at full extension is the single frame that says "gallop". */
    const sF = Math.sin(ph + Math.PI - 0.15 + (i === 0 ? 0.26 : 0));
    const cF = Math.cos(ph + Math.PI - 0.15 + (i === 0 ? 0.26 : 0));
    const ampF = 1.05 * A.speedS;

    const up = carrying ? -0.75 : (s * amp - 0.12 + Math.sin(A.breathe) * 0.03);
    const down = -1.42 + sF * ampF;
    arm.shoulder.rotation.x = lerp(up, down, bound);
    arm.shoulder.rotation.z = arm.side * lerp(0.16, 0.07, bound);
    const elUp = carrying ? -1.0 : (-0.35 - Math.max(0, s) * 0.45 * A.speedS);
    const elDown = -0.20 - Math.max(0, -cF) * 0.95 * ampF;
    arm.elbow.rotation.x = lerp(elUp, elDown, bound);
    if (arm.hand) arm.hand.rotation.x = lerp(0, 0.35 + sF * 0.25, bound);
  });

  /* --- THE TAIL. A heavy rope that is always a beat behind. ------------- */
  /* Driving it directly from the turn rate makes it snap; driving a spring
     from the turn rate and reading the spring makes it swing. */
  const target = clamp(-A.turnS * 0.30, -0.9, 0.9);
  A.tailLagV += (target - A.tailLag) * 40 * dt;
  A.tailLagV *= Math.exp(-7 * dt);
  A.tailLag += A.tailLagV * dt;

  p.tail.forEach((seg, i) => {
    if (i === 0) {
      // the base lifts as she speeds up and drops when she stands still
      // Positive rotation.x LIFTS a tail that extends along -Z. At rest a
      // fox's brush hangs down and curls round her feet; it only comes up
      // and streams out behind her when she is moving.
      seg.rotation.x = lerp(-0.42, 0.30, A.speedS) + Math.sin(A.breathe * 0.7) * 0.04
        + bound * 0.42;
      seg.rotation.y = A.tailLag * 0.5;
      return;
    }
    const t = i / p.tail.length;
    const wave = Math.sin(ph * 1.0 - i * 0.7) * 0.10 * A.speedS
      + Math.sin(A.t * 1.3 - i * 0.55) * 0.045 * (1 - A.speedS);
    seg.rotation.y = A.tailLag * (0.35 + t * 0.5) + wave * (1 - bound * 0.4);
    /* flat out behind at a sprint: the brush stops being decoration and
       becomes the counterweight it actually is */
    seg.rotation.x = lerp(lerp(0.16, -0.02, A.speedS) + wave * 0.3, -0.10 + Math.sin(ph * 2 - i * 0.5) * 0.05, bound);
  });

  /* --- ears: constantly alive, and pinned back at speed ----------------- */
  const flick = A.earTwitch * A.earTwitch;
  p.earL.rotation.z = 0.22 - flick * 0.55 + Math.sin(A.t * 2.1) * 0.03;
  p.earR.rotation.z = -0.22 + flick * 0.25 + Math.sin(A.t * 2.6 + 1) * 0.03;
  p.earL.rotation.x = -0.10 - A.speedS * 0.18 - flick * 0.2 - bound * 0.55;
  p.earR.rotation.x = -0.10 - A.speedS * 0.18 - bound * 0.55;

  /* --- head: LEVEL and leading when running ----------------------------- */
  /* the neck folds forward with the chest but the head counter-rotates, so
     the muzzle stays horizontal and pointed down the direction of travel.
     A head that folds with the body reads as an animal about to fall over. */
  p.neck.rotation.x = -lean * 0.5 + 0.08 + bound * 0.46;
  p.head.rotation.x = A.headPitch + Math.sin(ph * 2) * 0.025 * A.speedS - lean * 0.2
    - bound * 0.56 + Math.sin(ph) * 0.05 * bound;
  p.head.rotation.y = A.headYaw * (1 - bound * 0.6);
  p.head.rotation.z = clamp(A.turnS * 0.05, -0.2, 0.2);

  applyAction(rig, A, st, dt, 1.0);
}

/* ========================================================================= */
/* BEAR — weight, roll and a late head                                       */
/* ========================================================================= */

function poseBear(rig, A, st, dt, speed, moving) {
  const p = rig.parts;

  const stepsPerSec = moving ? lerp(1.15, 2.1, speed) : 0;
  A.phase = moving ? (A.phase + dt * stepsPerSec) % 1 : damp(A.phase, 0, 4, dt);
  const ph = A.phase * TAU;

  /* --- the roll. This is the whole animation. --------------------------- */
  /* All of the bear's mass moves sideways onto whichever foot is planted,
     and the rest of the body follows a moment later. Without the roll it is
     a big person walking; with it, it is an animal that weighs a quarter of
     a tonne. */
  const roll = Math.sin(ph) * 0.13 * A.speedS;
  const bob = -Math.abs(Math.cos(ph)) * 0.055 * A.speedS;

  A.bodyY = bob + Math.sin(A.breathe * 0.7) * 0.010;
  p.hip.rotation.z = roll;
  p.hip.rotation.x = A.speedS * 0.10;
  p.hip.rotation.y = Math.sin(ph) * 0.055 * A.speedS;
  p.torso.rotation.z = -roll * 0.35;
  p.torso.scale.set(1, 1 + Math.sin(A.breathe) * 0.016, 1);

  /* --- legs: long, slow, wide steps ------------------------------------- */
  p.legs.forEach((leg, i) => {
    const off = i === 0 ? 0 : Math.PI;
    const s = Math.sin(ph + off);
    const c = Math.cos(ph + off);
    const amp = 0.40 * A.speedS;
    leg.hip.rotation.x = s * amp;
    leg.hip.rotation.z = leg.side * (0.09 + 0.05 * A.speedS);
    leg.knee.rotation.x = clamp(0.22 + Math.max(0, -c) * 0.85 * amp * 1.6, 0.05, 1.1);
    leg.ankle.rotation.x = clamp(-0.12 - s * 0.25 * amp, -0.6, 0.5);
  });

  /* --- arms: heavy, low, and they swing late ---------------------------- */
  p.arms.forEach((arm, i) => {
    const s = Math.sin(ph + (i === 0 ? Math.PI : 0) - 0.35);   // late
    const amp = 0.34 * A.speedS;
    const carrying = arm.side > 0 && st.carrying;
    arm.shoulder.rotation.x = carrying ? -0.6 : (s * amp - 0.05 + Math.sin(A.breathe) * 0.04);
    arm.shoulder.rotation.z = arm.side * (0.22 + roll * arm.side * 0.4);
    arm.elbow.rotation.x = carrying ? -0.9 : (-0.30 - Math.max(0, s) * 0.30 * A.speedS);
  });

  /* --- the head is always a beat behind the shoulders -------------------- */
  const lateRoll = Math.sin(ph - 0.75) * 0.11 * A.speedS;
  p.neck.rotation.x = 0.16 + A.speedS * 0.10;
  p.neck.rotation.z = -lateRoll * 0.5;
  p.head.rotation.x = A.headPitch - 0.06 + Math.sin(ph - 0.9) * 0.05 * A.speedS;
  p.head.rotation.y = A.headYaw;
  p.head.rotation.z = lateRoll;

  const flick = A.earTwitch * A.earTwitch;
  p.earL.rotation.z = 0.10 - flick * 0.25;
  p.earR.rotation.z = -0.10 + flick * 0.12;

  if (p.tail[0]) p.tail[0].rotation.x = Math.sin(A.t * 1.6) * 0.10 + 0.1;

  applyAction(rig, A, st, dt, 1.0);
}

/* ========================================================================= */
/* SHARED OVERLAYS                                                           */
/* ========================================================================= */

/** Turn the head toward something, with limits so it never snaps round. */
function headLook(rig, A, st, dt) {
  const p = rig.parts;
  let wantYaw = 0, wantPitch = 0;
  if (st.lookAt && rig.root) {
    rig.root.updateMatrixWorld();
    const rx = rig.root.position.x, ry = rig.root.position.y, rz = rig.root.position.z;
    const dx = st.lookAt[0] - rx, dy = st.lookAt[1] - (ry + rig.metrics.eyeHeight), dz = st.lookAt[2] - rz;
    const a = Math.atan2(dx, dz) - (st.yaw ?? 0);
    let d = a;
    while (d > Math.PI) d -= TAU;
    while (d < -Math.PI) d += TAU;
    // beyond the limit the animal simply does not look: it turns its body,
    // which the player controls. A head that swivels past the limit is the
    // single creepiest thing a friendly animal can do.
    if (Math.abs(d) < 1.15) {
      wantYaw = clamp(d, -0.85, 0.85);
      wantPitch = clamp(-Math.atan2(dy, Math.hypot(dx, dz)), -0.45, 0.45);
    }
  }
  A.headYaw = damp(A.headYaw, wantYaw, 7, dt);
  A.headPitch = damp(A.headPitch, wantPitch, 7, dt);
}

/**
 * The one-shot actions, blended on top of whatever the gait is doing.
 * `actionT` runs 0..1 and the caller owns the clock.
 */
function applyAction(rig, A, st, dt, weight) {
  const p = rig.parts;

  /* --- CARRYING ---------------------------------------------------------
     Applied before any action, so a swing overrides it and a pickup
     overrides it, but simply walking about with a weapon does not leave the
     arms swinging as if the paws were empty. */
  if (st.weaponCls && A.action !== 'swing') {
    const bob = Math.sin((A.phase || 0) * TAU) * (A.speedS || 0);
    A.carryW = damp(A.carryW ?? 0, 1, 7, dt);
    applyCarry(rig, st.weaponCls, A.carryW * weight * (A.action ? 0.35 : 1), bob);
  } else if (!st.weaponCls) {
    A.carryW = damp(A.carryW ?? 0, 0, 7, dt);
  }

  /* --- WINDING UP A HEAVY ATTACK ---------------------------------------- */
  if (A.action === 'charge' && st.weaponCls) {
    applyCharge(rig, st.weaponCls, A.charge?.held ?? 0, A.charge?.stage ?? 0, A.t);
    return;
  }

  if (!A.action) return;
  const t = clamp01(A.actionT);
  const arm = p.arms[1];        // the right arm does everything
  const armL = p.arms[0];

  /* --- SWINGING SOMETHING -----------------------------------------------
     A weapon in the paw gets the attack that belongs to its class — a maul
     comes down overhead, a spear goes forward, a greatsword sweeps flat.
     The swing record also carries which step of the three-hit string this
     is, so the backhand plays mirrored and the finisher comes down the
     centre line. The old generic swing is kept below for the empty-handed
     case, which is what the player does before their first weapon. */
  if (A.action === 'swing' && st.weaponCls) {
    applyAttack(rig, st.weaponCls, t, weight, A.swing);
    return;
  }

  if (A.action === 'pick') {
    /* reach down, close, bring it up to look at. The pause at the top is
       what makes a pickup feel like FINDING something rather than like a
       vacuum cleaner passing over it. */
    const reach = Math.sin(clamp01(t / 0.45) * Math.PI * 0.5);
    const lift = smoothstep((t - 0.45) / 0.35);
    const back = smoothstep((t - 0.8) / 0.2);
    const down = reach * (1 - lift);
    arm.shoulder.rotation.x = lerp(arm.shoulder.rotation.x, 1.15 * down - 0.85 * lift + 0.2 * back, weight);
    arm.elbow.rotation.x = lerp(arm.elbow.rotation.x, -0.25 * down - 1.35 * lift, weight);
    arm.shoulder.rotation.z = arm.side * lerp(0.3, 0.05, reach);
    p.hip.rotation.x += down * 0.42 * (rig.species === 'bear' ? 0.7 : 1);
    if (p.neck) p.neck.rotation.x += down * 0.3 - lift * 0.15;
    p.head.rotation.x += down * 0.45 - lift * 0.35;
  } else if (A.action === 'swing') {
    /* wind up slowly, strike fast, recover. The asymmetry is the impact. */
    const wind = smoothstep(t / 0.35);
    const strike = smoothstep((t - 0.35) / 0.18);
    const rec = smoothstep((t - 0.6) / 0.4);
    const s = wind - strike * 1.9 + rec * 0.55;
    arm.shoulder.rotation.x = lerp(arm.shoulder.rotation.x, -0.4 - s * 1.7, weight);
    arm.shoulder.rotation.z = arm.side * (0.2 + wind * 0.5 - strike * 0.55);
    arm.elbow.rotation.x = lerp(arm.elbow.rotation.x, -1.3 + strike * 1.1, weight);
    p.torso.rotation.y = -s * 0.55 * arm.side;
    p.hip.rotation.y = (p.hip.rotation.y || 0) - s * 0.25 * arm.side;
    p.head.rotation.y += s * 0.22 * arm.side;
  } else if (A.action === 'wave') {
    const w = Math.sin(t * Math.PI * 3.2) * Math.sin(t * Math.PI);
    armL.shoulder.rotation.x = lerp(armL.shoulder.rotation.x, -2.1, smoothstep(t * 3));
    armL.shoulder.rotation.z = armL.side * (0.3 + w * 0.5);
    armL.elbow.rotation.x = -0.5 + w * 0.3;
  } else if (A.action === 'sit') {
    const s = smoothstep(t * 2);
    p.hip.position.y = lerp(rig.metrics.hipHeight, rig.metrics.hipHeight * 0.45, s);
    for (const leg of p.legs) {
      leg.hip.rotation.x = lerp(leg.hip.rotation.x, -1.3, s);
      leg.knee.rotation.x = lerp(leg.knee.rotation.x, 1.7, s);
    }
  }
}

/** Put a rig back to a neutral pose — used by the character-select turntable. */
export function resetPose(rig) {
  rig.root.traverse(o => { if (o.isGroup || o.isObject3D) o.rotation.set(0, 0, 0); });
}
