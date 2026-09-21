/* BeastData.js — what lives in the wood, and how dangerous it is.
   ===========================================================================
   THE BRIEF'S RULE, and it is the one that shapes this whole file: the far
   forest must be harder WITHOUT the enemies simply having more health. So
   nothing on this list is a bigger number than the thing before it. What
   changes as you walk outwards is BEHAVIOUR:

     how far it notices you from, and whether it loses interest;
     whether it circles, stalks, or comes straight in;
     how long its wind-up is — a wolf tells you it is about to lunge, an
       alpha barely does;
     whether it attacks once and backs off, or chains;
     whether it dodges when you swing;
     whether it calls others.

   A Timber Wolf has 3 health and a Direwolf has 6, which is not much of a
   difference. The difference is that the Direwolf feints, circles out of
   reach while you are recovering, and comes back in on the frame your
   swing ends.

   NOT GRAPHIC. Nothing here dies. `rout` is the threshold at which a beast
   gives up and runs, and every one of them has one — you are driving them
   off, the same as the construction crews.
*/

/**
 *   band     which difficulty band it appears in (1 inner .. 5 far wood)
 *   hp       hits to rout it. Deliberately small numbers.
 *   notice   metres at which it becomes aware of you
 *   lose     metres at which it gives up
 *   speed    metres per second when committed
 *   circle   0 comes straight in, 1 circles constantly
 *   wind     seconds of tell before a strike
 *   recover  seconds it is open after one
 *   chain    how many strikes it may link
 *   dodge    chance it steps out of a swing
 *   pack     how many turn up together
 *   calls    whether hitting it brings its pack in
 */
export const BEASTS = {
  /* ------------------------------------------------ BAND 1: inner forest */
  hare: {
    id: 'hare', name: 'Wood Hare', band: 1, w: 30, harmless: true,
    hp: 1, notice: 16, lose: 26, speed: 6.2, circle: 0, wind: 0, recover: 0,
    chain: 0, dodge: 0.4, pack: 1, calls: false, rout: 1,
    size: 0.42, build: 'hare', cols: [0x9a8464, 0xe0d4b8, 0x6a5a42],
    blurb: 'Bolts before you have finished seeing it.',
  },
  boar: {
    id: 'boar', name: 'Bristle Boar', band: 1, w: 12,
    hp: 3, notice: 15, lose: 24, speed: 5.4, circle: 0.05, wind: 0.75, recover: 0.85,
    chain: 1, dodge: 0, pack: 1, calls: false, rout: 2,
    size: 0.72, build: 'boar', cols: [0x4a3a2a, 0x6a5540, 0x2a2018],
    blurb: 'Short-sighted, short-tempered, and it only knows one move.',
  },

  /* --------------------------------------------------- BAND 2: wilderness */
  wolf: {
    id: 'wolf', name: 'Timber Wolf', band: 2, w: 20,
    hp: 3, notice: 26, lose: 44, speed: 6.6, circle: 0.45, wind: 0.55, recover: 0.6,
    chain: 1, dodge: 0.12, pack: 2, calls: true, rout: 2,
    size: 0.78, build: 'wolf', cols: [0x6a6a66, 0xc4c0b4, 0x3a3a38],
    blurb: 'Never alone, and never quite where you last looked.',
  },
  lynx: {
    id: 'lynx', name: 'Moss Lynx', band: 2, w: 9,
    hp: 2, notice: 30, lose: 34, speed: 7.8, circle: 0.7, wind: 0.32, recover: 0.7,
    chain: 2, dodge: 0.35, pack: 1, calls: false, rout: 1,
    size: 0.62, build: 'cat', cols: [0x8a7a54, 0xd8cca0, 0x4a4030],
    blurb: 'Two quick swipes and it is gone again before you turn round.',
  },

  /* -------------------------------------------------- BAND 3: deep forest */
  alphawolf: {
    id: 'alphawolf', name: 'Alpha Wolf', band: 3, w: 12,
    hp: 5, notice: 34, lose: 60, speed: 7.4, circle: 0.62, wind: 0.42, recover: 0.45,
    chain: 2, dodge: 0.25, pack: 3, calls: true, rout: 3,
    size: 0.98, build: 'wolf', cols: [0x3e3e42, 0x8a8a84, 0x1c1c20],
    blurb: 'It does not rush. The others do that for it.',
  },
  tusker: {
    id: 'tusker', name: 'Old Tusker', band: 3, w: 8,
    hp: 6, notice: 22, lose: 40, speed: 6.8, circle: 0, wind: 0.95, recover: 1.1,
    chain: 1, dodge: 0, pack: 1, calls: false, rout: 4,
    size: 1.15, build: 'boar', cols: [0x2e2620, 0x4a4038, 0x18140f],
    blurb: 'A charge you can hear coming and still not get out of the way of.',
  },

  /*
   * THE BEARS.
   *
   * There were none, and the biggest thing in the wood was a direwolf
   * standing about as tall as the fox — nothing was imposing, which is
   * the complaint. A bear is the animal that does that job: it is not
   * fast and it does not circle, it simply arrives and is enormous.
   *
   * SIZE IS THE DESIGN. The fox's eyes are at 0.92 m. A Bramblecoat at
   * 1.95 is head and shoulders over it and a Greatmaw at 2.60 is nearly
   * three times its height — which is the whole point, and it is why
   * they are deliberately SLOW. Something that big and that quick would
   * be unfair; something that big and ponderous is a thing you decide
   * whether to fight, which is the encounter worth having.
   *
   * Their difficulty is still behaviour, not health: they barely dodge
   * and they telegraph hugely, but the wind-up is long, the swing
   * chains, and the recovery is short enough that there is only a small
   * window to be in front of them.
   */
  bramblecoat: {
    id: 'bramblecoat', name: 'Bramblecoat Bear', band: 3, w: 9,
    hp: 7, notice: 30, lose: 48, speed: 5.2, circle: 0.05, wind: 0.85, recover: 0.55,
    chain: 2, dodge: 0.05, pack: 1, calls: false, rout: 4,
    size: 1.95, build: 'bear', cols: [0x5a4230, 0x8a6a48, 0x2e2018],
    blurb: 'It stands up to see you better, and that is worse.',
  },

  /* ------------------------------------------ BAND 4: dangerous wilderness */
  direwolf: {
    id: 'direwolf', name: 'Direwolf', band: 4, w: 10,
    hp: 6, notice: 40, lose: 80, speed: 8.4, circle: 0.78, wind: 0.26, recover: 0.32,
    chain: 3, dodge: 0.42, pack: 2, calls: true, rout: 4,
    size: 1.22, build: 'wolf', cols: [0x2a2c34, 0x6a6e78, 0x12141a],
    blurb: 'It waits for the end of your swing. Every time.',
  },
  thornstag: {
    id: 'thornstag', name: 'Thorn Stag', band: 4, w: 7,
    hp: 5, notice: 44, lose: 52, speed: 7.9, circle: 0.2, wind: 0.68, recover: 0.5,
    chain: 2, dodge: 0.3, pack: 1, calls: false, rout: 3,
    size: 1.3, build: 'stag', cols: [0x5a4632, 0x8a7458, 0x2e2418],
    blurb: 'Antlers like a hedge. It lowers them and does not stop.',
  },

  /* --------------------------------------------------- BAND 5: the far wood */
  frostmaw: {
    id: 'frostmaw', name: 'Frostmaw', band: 5, w: 6,
    hp: 8, notice: 48, lose: 110, speed: 8.0, circle: 0.55, wind: 0.30, recover: 0.28,
    chain: 3, dodge: 0.35, pack: 2, calls: true, rout: 5,
    size: 1.45, build: 'wolf', cols: [0xcfe0ea, 0xf4fbff, 0x7fa8c4],
    glow: 0x9fd8ff,
    blurb: 'The cold arrives slightly before it does.',
  },
  greatmaw: {
    id: 'greatmaw', name: 'Greatmaw', band: 5, w: 4,
    hp: 8, notice: 34, lose: 60, speed: 5.8, circle: 0.08, wind: 0.72, recover: 0.34,
    chain: 3, dodge: 0.04, pack: 1, calls: false, rout: 6,
    size: 2.60, build: 'bear', cols: [0x2a2622, 0x4e463c, 0x14110e],
    glow: 0xff8a4a,
    blurb: 'The wood goes quiet a long way before you see it.',
  },
  mirestalker: {
    id: 'mirestalker', name: 'Mire Stalker', band: 5, w: 5,
    hp: 7, notice: 55, lose: 120, speed: 7.2, circle: 0.92, wind: 0.22, recover: 0.36,
    chain: 4, dodge: 0.55, pack: 1, calls: false, rout: 4,
    size: 1.1, build: 'cat', cols: [0x1e2430, 0x3a4450, 0x6a7ae0],
    glow: 0x7a6aff,
    blurb: 'It circles for a long time. You will get tired first.',
  },
};

export const BEAST_LIST = Object.values(BEASTS);

/** Everything that can turn up in a band, with its weight. */
export function beastsForBand(band) {
  /* a band always includes the one below it at reduced odds, so the wood
     changes gradually rather than switching over at a line on the map */
  return BEAST_LIST
    .filter(b => b.band <= band && b.band >= band - 1)
    .map(b => ({ beast: b, w: b.w * (b.band === band ? 1 : 0.35) }));
}

/** How many creatures should be loose near the player in this band. */
export function beastBudget(band) {
  return [0, 3, 5, 6, 7, 8][band] ?? 4;
}
