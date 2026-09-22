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

import { rollFish, fishTier, rarityOf } from '../data/FishData.js?v=1790103247';
import { bus, EV } from '../core/Bus.js?v=1790103247';
import { clamp, clamp01, lerp, makeRng } from '../core/Util.js?v=1790103247';

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
/* HOW A FISH IS PLAYED OUT — and it takes PRESSURE, not patience.
   ===========================================================================
   This took three wrong shapes before the right one, and each wrong shape
   is worth stating because each is a tempting thing to do again.

   THE PROBLEM. Fill is 0.52 a second on the fish and drain is 0.30 times
   the fish's `fight` off it, so a fish around 1.7 drains at almost exactly
   the rate a player who is on it half the time fills. The meter then sits
   where it is. It was not hypothetical: a test that played a fight out
   fairly ran its hundred-second guard out about one run in eight.

     1. CUT THE DRAIN AS IT TIRES (45%). Moved the equilibrium. Still hung.
     2. CUT IT HARDER (90%). Worse — a fish that barely drains the meter is
        a fish you can no longer LOSE, so the fight hung just above zero
        instead of just below one. Removing a term cannot make a quantity
        move.
     3. GIVE LINE UNCONDITIONALLY AS IT TIRES. That terminates, and it
        hands the fish to a player who does nothing at all, which broke
        the one test that most deserved to stay unbroken.

   WHAT IS ACTUALLY TRUE about playing a fish out is that it tires because
   you are leaning on it. So the clock only runs WHILE THE ZONE IS ON THE
   FISH, and what it buys is a bigger fill — never a smaller drain and
   never free progress. Idling accrues nothing and still loses. A player
   who is on the fish at all, however clumsily, keeps banking pressure
   until the fill outruns the drain, which is what breaks the stalemate.

   And a fight still cannot run forever: past FIGHT_MAX the line parts.
   That is the guarantee, rather than an argument about rates — and losing
   a fish you have been holding for a minute and a quarter is a better
   story than a bar that never moved. */
const TIRE_FULL = 30;     // seconds ON THE FISH before it is fully played out
const TIRE_GAIN = 1.20;   // and how much more line it then yields per second
const FIGHT_MAX = 75;     // after which the line parts, whatever the meter says

/*
 * THE SHAPE OF A CAST, and why there are two states in front of the old
 * ones.
 *
 * It used to go straight from "press E" to "a bar is on your screen". The
 * line was never thrown, nothing ever landed in the water, and the first
 * the player knew of a bite was the minigame appearing. Both halves of
 * that are now events in the world:
 *
 *   CASTING  the rod comes back, swings, and the bobber flies. ~1.1 s,
 *            which is roughly how long a real cast takes and long enough
 *            to read as a throw rather than a teleport.
 *   CAST     the float sits there. This is the wait, and it is the part
 *            that makes a bite worth anything.
 *   BITE     SOMETHING IS DOWN THERE. The water bubbles, rings spread, the
 *            float ducks and bobs. The minigame does NOT start here — the
 *            player has to see the water move and decide to strike, which
 *            is the moment the whole activity is built around.
 *   FIGHT    and only now the reeling interface.
 */
export const FISH_STATE = {
  IDLE: 'idle',           // rod not out
  CASTING: 'casting',     // the throw itself: rod swinging, bobber in the air
  CAST: 'cast',           // line in the water, waiting for a bite
  BITE: 'bite',           // something has taken it; the water is boiling
  FIGHT: 'fight',         // the minigame proper
  CAUGHT: 'caught',
  LOST: 'lost',
};

/** How long the bobber is in the air. */
const CAST_FLIGHT = 1.10;

/**
 * How long the water boils before the fish is gone again.
 *
 * Longer than the old strike window, because there is now something to
 * look at during it and because the player is being asked to react to the
 * WATER rather than to a caption. Missing a strike should feel like your
 * own fault and never like a reflex test.
 */
const BITE_WINDOW = 2.4;

export class Fishing {
  /**
   * @param award  (fish) => storedRecord|null. Called the moment the
   *               meter fills, BEFORE the catch is announced. Whatever
   *               it hands back is what the player caught; null means
   *               the fish was not secured and is therefore lost. See
   *               `_win` for why this is a function and not an event.
   */
  constructor({ audio = null, award = null } = {}) {
    this.audio = audio;
    this.award = award;
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
    this.fought = 0;         // seconds of PRESSURE — time with the zone on it
    this.held = 0;           // seconds the fight has been running at all
    this.tired = 0;          // 0 fresh, 1 played out
    this.holding = false;
    this.stateT = 0;
    this.biteAt = 0;
    this.result = null;
    this.onFish = 0;
    this._awarded = false;
    this.strikeAt = 0;        // when in the bite the player clicked, 0..1
  }

  /* ====================================================================== */

  /** Throw the line in. `spot` describes the water under the float. */
  cast(spot = {}) {
    this.reset();
    this.spot = spot;
    this.state = FISH_STATE.CASTING;
    this.stateT = 0;
    this.flight = CAST_FLIGHT;
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
    /* kept so a fish that gets away can be replaced with a fresh one
       drawn from the same water — see the escape branch in `update` */
    this._rollOpts = {
      depth: spot.depth ?? 0.4, remoteness: spot.remoteness ?? 0.3,
      zone: spot.zone ?? 0, night: !!spot.night,
      luck: rod ? rod.luck : 1, rareChance: rod ? rod.rare : 1,
      /* the character of this particular pool — see waterAt */
      water: spot.water || null,
    };
    this._rollSeed = r;
    this._pending = this._reroll();
    this.audio?.cast?.();
    return true;
  }

  /** Another fish, from the same water. */
  _reroll() {
    const r = this._rollSeed;
    const seed = (r && r.seed ? r.seed() : (Math.random() * 0xffffffff)) >>> 0;
    return rollFish(seed, this._rollOpts || {});
  }

  /**
   * The player pressed the button.
   *
   * THE CLICK IS THE WHOLE BITE NOW. The reeling screen used to arrive
   * on a timer once the water started boiling, which meant the bubbles
   * were decoration on an event that was going to happen anyway. They
   * are the event: something is on the hook, and if you do not strike
   * it leaves with your bait.
   *
   * Three outcomes, and all three are worth telling the player about:
   *
   *   TOO EARLY  nothing is on the hook yet. Striking at open water is
   *              not punished — there is nothing to punish — but it
   *              does say so, or a player who clicks the instant they
   *              cast learns nothing from the silence.
   *   IN TIME    the fight starts.
   *   TOO LATE   handled in `update`: the window closes on its own and
   *              the fish goes.
   */
  press() {
    this.holding = true;
    if (this.state === FISH_STATE.BITE) {
      this._strike();
      return true;
    }
    if (this.state === FISH_STATE.CAST || this.state === FISH_STATE.CASTING) {
      /* rate-limited so holding the button down is one nudge, not sixty */
      if (this.t - (this._earlyT || -9) > 0.6) {
        this._earlyT = this.t;
        bus.emit(EV.FISH_EARLY, { spot: this.spot });
        this.audio?.ui?.('tick');
      }
      return false;
    }
    return false;
  }

  /** 0..1 through the throw, for the rig and the arm animation. */
  get castT() {
    return this.state === FISH_STATE.CASTING
      ? clamp01(this.stateT / Math.max(0.01, this.flight || CAST_FLIGHT)) : 1;
  }

  /**
   * HOW HARD THE WATER IS BOILING, 0..1.
   *
   * Ramps up over the first third of the bite so the disturbance arrives
   * rather than switching on, holds, then falls away as the fish loses
   * interest — which gives the player a readable sense of the window
   * closing without a countdown bar anywhere on screen.
   */
  get boil() {
    if (this.state !== FISH_STATE.BITE) return 0;
    const u = clamp01(this.stateT / BITE_WINDOW);
    return u < 0.22 ? u / 0.22 : clamp01(1 - (u - 0.22) / 0.78 * 0.65);
  }

  release() { this.holding = false; }

  /** Reel in early, or walk away. */
  cancel() {
    if (this.state === FISH_STATE.FIGHT) this._lose();
    else { this.state = FISH_STATE.IDLE; this.reset(); }
  }

  _strike() {
    /* how late in the window they were, for the feedback and for the
       small reward below */
    this.strikeAt = clamp01(this.stateT / BITE_WINDOW);
    this.fish = this._pending;
    this._rnd = null;                  // a new fish gets its own stream
    this._tier = null;                 // ...and its own rarity behaviour
    this._feint = 0; this._beat = false;
    this.state = FISH_STATE.FIGHT;
    this.stateT = 0;
    this.fishPos = 0.5;
    this.zone = 0.35;
    this.vel = 0;
    this.catch = 0.30;
    /* a fresh fish every time the hook sets — a reroll after a missed
       strike must not inherit the last one's exhaustion */
    this.fought = 0;
    this.held = 0;
    this.tired = 0;
    bus.emit(EV.FISH_HOOKED, { fish: this.fish });
    this.audio?.hook?.();
  }

  /**
   * THE CATCH IS NOT ANNOUNCED UNTIL IT IS SECURED.
   *
   * This used to set the state to CAUGHT, emit, and trust that somebody
   * downstream put the fish in the creel. The award happened in a bus
   * listener — and the bus deliberately swallows listener errors so one
   * bad handler cannot take the game down — so if anything in that
   * listener threw, the meter sat at 100%, the card never came, and the
   * fish did not exist. The player was told they had caught something
   * they had not.
   *
   * So the award is now a FUNCTION THE CALLER SUPPLIES, called before
   * the state changes, and it has to hand back the stored record. No
   * record, no catch: the fish slips the line, which is a true thing to
   * say and leaves the player fishing rather than stuck on a screen that
   * is lying to them.
   *
   * `_awarded` makes it idempotent. `_win` is only reachable from one
   * branch of one update, but "exactly one fish per catch" is the sort
   * of guarantee that should not rest on control flow being right.
   */
  _win() {
    if (this._awarded) return;

    const caught = { ...this.fish, tier: fishTier(this.fish) };
    let stored = null;
    try {
      stored = this.award ? this.award(caught) : caught;
    } catch (e) {
      console.error('[fishing] the award threw; treating it as a lost fish', e);
      stored = null;
    }

    if (!stored) {
      /* it was never secured, so it was never caught */
      this._lose('unsecured');
      return;
    }

    this._awarded = true;
    this.state = FISH_STATE.CAUGHT;
    this.stateT = 0;
    this.result = stored;
    bus.emit(EV.FISH_CAUGHT, { fish: stored });
    this.audio?.catchFish?.(fishTier(stored) ?? 0);
  }

  _lose(why = 'slipped') {
    this.state = FISH_STATE.LOST;
    this.stateT = 0;
    bus.emit(EV.FISH_LOST, { fish: this.fish, why });
    this.audio?.lose?.();
  }

  /* ====================================================================== */

  update(dt) {
    this.t += dt;
    this.stateT += dt;

    /* THE THROW. Nothing is fishable until the bobber is down — a bite
       while the line is still in the air would be nonsense, and the wait
       does not start counting until the float is sitting still. */
    if (this.state === FISH_STATE.CASTING) {
      if (this.stateT >= (this.flight || CAST_FLIGHT)) {
        this.state = FISH_STATE.CAST;
        this.stateT = 0;
        bus.emit(EV.FISH_SPLASH, { spot: this.spot });
        this.audio?.splash?.();
      }
      return;
    }

    if (this.state === FISH_STATE.CAST) {
      if (this.stateT >= this.biteAt) {
        this.state = FISH_STATE.BITE;
        this.stateT = 0;
        /* THE WATER IS THE ANNOUNCEMENT, not the interface. Everything
           that reacts to this — bubbles, rings, the float ducking — lives
           in the world; the reeling panel does not appear until the
           player strikes and the state becomes FIGHT. */
        bus.emit(EV.FISH_BITING, { fish: this._pending, spot: this.spot });
        this.audio?.bite?.();
      }
      return;
    }

    if (this.state === FISH_STATE.BITE) {
      if (this.stateT > BITE_WINDOW) {
        /* TOO LATE. It got away with the bait — and the line stays in
           the water, because the punishment for a slow reaction should
           be the fish you did not get, not being made to walk back and
           cast again. Not for long, either: a thirty-second penalty
           wait is how a fishing game stops being relaxing. */
        this.state = FISH_STATE.CAST;
        this.stateT = 0;
        this.biteAt = 2.2;
        /* A NEW FISH COMES ALONG. The one that took the bait and left
           is gone; keeping it on the hook would mean a player who
           missed a Divine could simply wait and be handed it again.
           (Nulling it instead would be worse: the next strike would
           hook nothing and throw.) */
        this._pending = this._reroll();
        bus.emit(EV.FISH_OFF, { spot: this.spot });
        this.audio?.lose?.();
      }
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

    /* --- THE FISH TIRES -------------------------------------------------
       Without this a fight has no end in it. Fill is 0.52 a second and
       drain is 0.30 times the fish's fight, so a fish around 1.7 drains
       at almost exactly the rate a player on it half the time fills —
       and the meter sits where it is, forever. It is not a theoretical
       worry: a test that plays a fight out fairly hit the stalemate
       roughly one run in eight and simply never finished.

       It is also the right mechanic on its own terms. Playing a fish out
       is what fishing IS, and a fight that is winnable by holding on is
       a fight with a shape: hard at first, then yours. Three quarters of
       a minute takes the resistance down to a bit over half.

       WHAT IT DOES NOT TOUCH is the over-the-line bleed below. Tiring
       must never let a starter rod land a River Father — that bleed is
       the upgrade loop, and if patience could beat it there would be no
       reason to ever buy a rod. */
    /* pressure, not patience: the clock only runs while you are on it */
    if (on) this.fought += dt;
    this.tired = clamp01(this.fought / TIRE_FULL);
    this.held += dt;

    const M = this.fish.move;
    if (on) this.catch = clamp01(this.catch + FILL_RATE * (1 + this.tired * TIRE_GAIN) * dt);
    else this.catch = clamp01(this.catch - DRAIN_RATE * M.fight * dt);
    /* OVER THE LINE RATING. A fish heavier than the rod can hold bleeds the
       meter even when you are tracking it perfectly, so a starter rod can
       hook a River Father and will never land one. That is the upgrade
       loop stated as a rule rather than as a locked door. */
    const over = M.fight - (this.line ?? 1.3);
    if (over > 0) this.catch = clamp01(this.catch - over * 0.30 * dt);

    if (this.catch >= 1) this._win();
    else if (this.catch <= 0) this._lose();
    /* THE LINE PARTS. The backstop that makes termination a fact rather
       than an argument about rates: no arrangement of fill, drain and
       player skill can hold a fight open past this. */
    else if (this.held >= FIGHT_MAX) this._lose('parted');
  }

  /**
   * The fish picks a spot and swims at it, changing its mind on its own
   * schedule. Driving it with noise instead gives a smooth wander that is
   * easy to track; the abrupt re-decisions are what make it a fish.
   */
  _moveFish(dt) {
    const M = this.fish.move;
    const tier = this._tier ?? (this._tier = rarityOf(this.fish.rarity).index);

    /*
     * WHAT THE RARE ONES DO DIFFERENTLY.
     *
     * The species table already gives every fish its own speed, restless-
     * ness and taste for darting — but that is a per-SPECIES difference,
     * and a Divine perch fought exactly like a common one. The brief is
     * specific that rarity must change the fight and equally specific
     * about how NOT to do it: "do NOT make difficulty unfair by simply
     * making the fish move ridiculously fast."
     *
     * So none of this touches top speed. What it changes is TIMING, which
     * is the thing the control scheme is actually about — you are always
     * either arriving or overshooting, so a fish that changes its mind on
     * an unexpected beat is hard in a way you can learn, and a fish that
     * is simply quicker than the zone is just arithmetic you lose.
     *
     *   FEINT   (rare and up) it commits to a direction and reverses
     *           before it gets there. Punishes leading it.
     *   RUN     (legendary and up) a long committed move to one end,
     *           where it sits. Punishes staying in the middle.
     *   BEAT    (mythic and up) it alternates long stillness with sudden
     *           moves, so any rhythm you settle into is the wrong one.
     */
    this._feint = Math.max(0, (this._feint || 0) - dt);
    if (this._feint > 0) {
      /* mid-feint: it is heading the WRONG way on purpose */
      this.fishTarget = clamp01(this._feintTo);
    }

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

      /* BEAT: from Mythic up, every third or so decision is a long hold
         followed by a sharp move. The hold is the trap — it is long
         enough that you relax the button. */
      /* THE TOP TIERS ARE ARRHYTHMIC, which is not the same as busy.
         The first version of this alternated a long hold with a short
         strike — and a long hold followed by a short strike, forever,
         is a metronome. Measured against a common fish, whose thinking
         interval is randomised every time, the "hard" fish came out
         MORE regular and therefore easier to settle into, which is the
         exact opposite of the intent.
         So it is a weighted choice with no memory: sometimes it sits
         for two seconds, sometimes it snaps twice in a row, sometimes
         it does the ordinary thing. Nothing predicts the next one. */
      if (tier >= 6 && rnd() < 0.55) {
        const roll = rnd();
        if (roll < 0.34) {
          /* a long, unnerving hold */
          this.fishTarget = this.fishPos;
          this.nextThink = 1.3 + rnd() * 1.1;
        } else if (roll < 0.72) {
          /* a snap to somewhere else, over before you react */
          this.fishTarget = clamp01(this.fishPos + (rnd() < 0.5 ? -1 : 1) * (0.34 + rnd() * 0.46));
          this.nextThink = 0.11 + rnd() * 0.12;
        } else {
          /* and sometimes it just keeps going, so the snap above is not
             reliably followed by anything at all */
          this.fishTarget = clamp01(0.08 + rnd() * 0.84);
          this.nextThink = 0.45 + rnd() * 0.9;
        }
        return;
      }

      /* RUN: from Legendary up, it occasionally bolts for one end and
         holds there, so a player parked in the middle has to commit. */
      if (tier >= 5 && rnd() < 0.22) {
        this.fishTarget = rnd() < 0.5 ? 0.06 : 0.94;
        this.nextThink = 1.1 + rnd() * 0.7;
        return;
      }

      /* FEINT: from Rare up, it sets off one way and turns back. The
         target it shows you first is real for a moment, which is what
         makes it a feint rather than a jitter. */
      /* THE ODDS AND THE SIZE BOTH CLIMB WITH RARITY. A flat 20% chance
         of a full-width feint from Rare upwards knocked the Glimmerfin —
         which is supposed to be a fish you lose sometimes, not usually —
         down to three catches in sixteen. A Rare now gets an occasional
         small one and only the top tiers get the full dummy. */
      const feintOdds = tier >= 5 ? 0.20 : tier >= 4 ? 0.15 : 0.10;
      const feintSize = tier >= 5 ? 1.0 : 0.62;
      if (tier >= 2 && rnd() < feintOdds) {
        const away = rnd() < 0.5 ? -1 : 1;
        this._feintTo = clamp01(this.fishPos + away * (0.14 + rnd() * 0.22) * feintSize);
        this._feint = (0.22 + rnd() * 0.14) * feintSize;
        this.fishTarget = clamp01(this.fishPos - away * (0.18 + rnd() * 0.26) * feintSize);
        this.nextThink = this._feint + 0.35;
        return;
      }

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
    /* A TIRED FISH SWIMS SLOWER, but only a little — a sixth off at the
       end of a long fight. The meter is where tiring does its work; this
       is here so the player can SEE it happening rather than only read
       it off a bar, and it is kept small because a fish that visibly
       gives up stops being worth landing. */
    const step = M.speed * (1 - this.tired * 0.17) * dt * (1 + Math.abs(d) * 1.4);
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
