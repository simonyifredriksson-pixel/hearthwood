/* Fishing.js — the minigame.
   ===========================================================================
   One control: HOLD to rise, RELEASE to fall.

   The player's zone is a weightless thing in a gravity well. Holding the
   button applies lift; letting go drops it. Keeping the zone over a fish
   that is darting about the bar is therefore not a matter of pointing at it
   but of ANTICIPATING it — you are always either arriving or overshooting,
   and the skill is in how early you let go. That is the whole reason this
   control scheme is worth using instead of "move a slider": a slider can be
   held exactly still, and a fish that can be exactly tracked is not a
   contest.

   The numbers that make it feel right, learned by playing it:

     LIFT must beat GRAVITY by roughly half again, or the zone can never get
     to the top of the bar and the top third of the water is dead space.
     DRAG has to be high enough that the zone settles rather than oscillating
     forever, but low enough that it still overshoots — the overshoot is the
     game.
     The catch meter must fall SLOWER than it fills, or a single mistake is
     fatal and the whole thing reads as unfair rather than as tense.

   The bar is 0..1 with 0 at the bottom. Nothing here touches the DOM; the
   UI layer reads this state and draws it.
*/

import { rollFish, fishTier } from '../data/FishData.js?v=20260921164117';
import { bus, EV } from '../core/Bus.js?v=20260921164117';
import { clamp, clamp01, lerp, makeRng } from '../core/Util.js?v=20260921164117';

/*
 * THE ZONE MUST BE ABLE TO OUTRUN THE FISH.
 *
 * These are accelerations against a linear drag, so the zone has a terminal
 * speed and it is easy to set them such that the zone simply cannot keep up:
 *
 *     rise = (LIFT - GRAVITY) / DRAG      fall = GRAVITY / DRAG
 *
 * The first version was 2.15 / 1.42 / 3.1, giving a terminal rise of 0.24
 * bar-widths per second against a Glimmerfin that travels at 0.85 — so the
 * fastest fish in the game were not hard, they were arithmetically
 * impossible, and no amount of skill would have caught one. These give
 * rise 1.00 and fall 1.09, comfortably clear of the fastest fish, with the
 * fall still a little quicker than the rise so that gravity is something
 * you spend the whole minigame arguing with.
 */
const LIFT = 4.60;        // bar-heights per second squared while holding
const GRAVITY = 2.40;     // and while not
const DRAG = 2.20;        // velocity damping, per second
const ZONE = 0.22;        // how much of the bar the player's zone covers (the rod widens it)
const FILL_RATE = 0.52;   // catch meter per second while on the fish
const DRAIN_RATE = 0.30;  // and off it — deliberately slower than the fill

export const FISH_STATE = {
  IDLE: 'idle',           // rod not out
  CAST: 'cast',           // line in the water, waiting for a bite
  BITE: 'bite',           // something has taken it; strike now
  FIGHT: 'fight',         // the minigame proper
  CAUGHT: 'caught',
  LOST: 'lost',
};

export class Fishing {
  constructor({ audio = null } = {}) {
    this.audio = audio;
    this.state = FISH_STATE.IDLE;
    this.t = 0;
    this.reset();
  }

  reset() {
    this.fish = null;
    this._rnd = null;
    this.zone = 0.35;        // centre of the player's zone, 0..1
    this.vel = 0;
    this.fishPos = 0.5;
    this.fishVel = 0;
    this.fishTarget = 0.5;
    this.nextThink = 0;
    this.catch = 0.30;       // the progress meter, 0..1
    this.holding = false;
    this.stateT = 0;
    this.biteAt = 0;
    this.result = null;
    this.onFish = 0;
  }

  /* ====================================================================== */

  /** Throw the line in. `spot` describes the water under the float. */
  cast(spot = {}) {
    this.reset();
    this.spot = spot;
    this.state = FISH_STATE.CAST;
    this.stateT = 0;
    const r = makeRng((spot.seed ?? 12345) ^ (Date.now() & 0xffff));
    /* THE ROD IS IN EVERY LINE OF THIS.
       It sets how the band handles (lift, fall, control, width), how heavy a
       fish it can hold at all (line), how long the wait is (lure) and what
       is down there in the first place (luck, rare). A rod the player cannot
       feel the moment they cast is not an upgrade. */
    const rod = spot.rod || null;
    this.rod = rod;
    this.lift = LIFT * (rod ? rod.lift / 4.2 : 1);
    this.fallA = GRAVITY * (rod ? rod.fall / 2.3 : 1);
    this.drag = DRAG * (rod ? 0.72 + rod.control * 0.28 : 1);
    this.band = rod ? rod.band : ZONE;
    this.line = rod ? rod.line : 1.3;
    // the wait is the anticipation; too short and there is no anticipation
    this.biteAt = r.range(1.4, 4.6) / (rod ? rod.lure : 1);
    this._pending = rollFish(
      (r.seed ? r.seed() : (Math.random() * 0xffffffff)) >>> 0,
      {
        depth: spot.depth ?? 0.4, remoteness: spot.remoteness ?? 0.3,
        zone: spot.zone ?? 0, night: !!spot.night,
        luck: rod ? rod.luck : 1, rareChance: rod ? rod.rare : 1,
      });
    this.audio?.cast?.();
    return true;
  }

  /** The player pressed the button. */
  press() {
    this.holding = true;
    if (this.state === FISH_STATE.BITE) this._strike();
  }

  release() { this.holding = false; }

  /** Reel in early, or walk away. */
  cancel() {
    if (this.state === FISH_STATE.FIGHT) this._lose();
    else { this.state = FISH_STATE.IDLE; this.reset(); }
  }

  _strike() {
    this.fish = this._pending;
    this._rnd = null;                  // a new fish gets its own stream
    this.state = FISH_STATE.FIGHT;
    this.stateT = 0;
    this.fishPos = 0.5;
    this.zone = 0.35;
    this.vel = 0;
    this.catch = 0.30;
    bus.emit(EV.FISH_HOOKED, { fish: this.fish });
    this.audio?.hook?.();
  }

  _win() {
    this.state = FISH_STATE.CAUGHT;
    this.stateT = 0;
    this.result = { ...this.fish, tier: fishTier(this.fish) };
    bus.emit(EV.FISH_CAUGHT, { fish: this.result });
    this.audio?.catchFish?.(this.result.tier);
  }

  _lose() {
    this.state = FISH_STATE.LOST;
    this.stateT = 0;
    bus.emit(EV.FISH_LOST, { fish: this.fish });
    this.audio?.lose?.();
  }

  /* ====================================================================== */

  update(dt) {
    this.t += dt;
    this.stateT += dt;

    if (this.state === FISH_STATE.CAST) {
      if (this.stateT >= this.biteAt) {
        this.state = FISH_STATE.BITE;
        this.stateT = 0;
        this.audio?.bite?.();
      }
      return;
    }

    if (this.state === FISH_STATE.BITE) {
      // a generous window — missing the strike should be rare and obvious
      if (this.stateT > 1.5) { this.state = FISH_STATE.CAST; this.stateT = 0; this.biteAt = 2.2; }
      return;
    }

    if (this.state !== FISH_STATE.FIGHT) return;

    /* --- the player's zone: lift while held, gravity when not ----------- */
    const a = (this.holding ? (this.lift ?? LIFT) : 0) - (this.fallA ?? GRAVITY);
    this.vel += a * dt;
    this.vel -= this.vel * Math.min(1, (this.drag ?? DRAG) * dt);
    this.zone += this.vel * dt;
    // the ends of the bar absorb rather than bounce: a bounce at the bottom
    // flings the zone back up and the player did not ask for that
    if (this.zone < 0) { this.zone = 0; this.vel = Math.max(0, this.vel); }
    if (this.zone > 1) { this.zone = 1; this.vel = Math.min(0, this.vel); }

    /* --- the fish ------------------------------------------------------- */
    this._moveFish(dt);

    /* --- are we on it? --------------------------------------------------- */
    const half = (this.band ?? ZONE) * 0.5;
    const on = Math.abs(this.fishPos - this.zone) <= half;
    this.onFish = on ? Math.min(1, this.onFish + dt * 6) : Math.max(0, this.onFish - dt * 6);

    const M = this.fish.move;
    if (on) this.catch = clamp01(this.catch + FILL_RATE * dt);
    else this.catch = clamp01(this.catch - DRAIN_RATE * M.fight * dt);
    /* OVER THE LINE RATING. A fish heavier than the rod can hold bleeds the
       meter even when you are tracking it perfectly, so a starter rod can
       hook a River Father and will never land one. That is the upgrade
       loop stated as a rule rather than as a locked door. */
    const over = M.fight - (this.line ?? 1.3);
    if (over > 0) this.catch = clamp01(this.catch - over * 0.30 * dt);

    if (this.catch >= 1) this._win();
    else if (this.catch <= 0) this._lose();
  }

  /**
   * The fish picks a spot and swims at it, changing its mind on its own
   * schedule. Driving it with noise instead gives a smooth wander that is
   * easy to track; the abrupt re-decisions are what make it a fish.
   */
  _moveFish(dt) {
    const M = this.fish.move;
    this.nextThink -= dt;
    if (this.nextThink <= 0) {
      /* SEEDED, not Math.random.
         The fish has to be unpredictable to the PLAYER; it does not have to
         be unpredictable to the machine, and while it was, the balance test
         measured a different fight every time it ran and drifted between
         "always catchable" and "never" with nothing having changed. Every
         other generator in this game runs off a seed. So does this one. */
      const rnd = this._rnd || (this._rnd = makeRng((this.fish.seed ?? 1) ^ 0xf15b));
      const r = rnd();
      this.nextThink = lerp(0.9, 0.16, clamp01(M.restless / 2.6)) * (0.6 + rnd() * 0.9);
      if (r < M.pause) {
        this.fishTarget = this.fishPos;             // hold station
      } else if (r < M.pause + M.dart * 0.5) {
        // a dart: a big jump to somewhere else entirely
        this.fishTarget = clamp01(this.fishPos + (rnd() < 0.5 ? -1 : 1) * (0.25 + rnd() * 0.5));
      } else {
        this.fishTarget = clamp01(0.1 + rnd() * 0.8);
      }
    }
    // drift about the target even while "still"
    const wobble = Math.sin(this.t * 3.1 + this.fish.seed * 0.001) * M.drift * 0.06;
    const want = clamp01(this.fishTarget + wobble);
    const d = want - this.fishPos;
    const step = M.speed * dt * (1 + Math.abs(d) * 1.4);
    this.fishPos += clamp(d, -step, step);
    this.fishPos = clamp01(this.fishPos);
  }

  /* ====================================================================== */

  get active() {
    return this.state !== FISH_STATE.IDLE;
  }
  get zoneTop() { return clamp01(this.zone + (this.band ?? ZONE) * 0.5); }
  get zoneBottom() { return clamp01(this.zone - (this.band ?? ZONE) * 0.5); }
  get zoneSize() { return this.band ?? ZONE; }
  /** True when the thing on the line is heavier than the rod is rated for. */
  get overLine() { return !!(this.fish && this.fish.move.fight > (this.line ?? 1.3)); }
}
