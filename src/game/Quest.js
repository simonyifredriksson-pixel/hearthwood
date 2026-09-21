/* Quest.js — the First Forge Festival, and the hour after it.
   ===========================================================================
   The opening is a TUTORIAL DISGUISED AS A CEREMONY. Every young animal in
   the village turns nine on the same day and is sent out to find their first
   stick; the player is simply one of them. That framing does a lot of work
   for free — it explains why a child is being handed a weapon, why the whole
   village is watching, and why nobody has to say "press E to pick up".

   The design rules this file follows:

     TEACH BY WANTING, NOT BY TELLING. Each step sets an OBJECTIVE and points
     at it. The player is never told which key to press for something they
     have already done once.
     NEVER TAKE CONTROL TWICE. The speech is the only moment the player
     cannot walk away, and it is skippable. Everything after it is a marker
     on the ground and a line at the top of the screen.
     THE STEPS ARE A LIST, NOT A GRAPH. A branching tutorial in a game this
     size is a way to generate bugs nobody will ever see. One line, in order,
     and each step knows only how to say whether it is finished.

   The director owns no rendering. It sets `objective` and `marker`, and the
   HUD and the arrow read them.
*/

import { bus, EV } from '../core/Bus.js?v=1790020991';
import { WORLD } from '../core/Config.js?v=1790020991';
import { clamp, clamp01 } from '../core/Util.js?v=1790020991';

/* ========================================================================= */
/* THE SPEECH                                                                */
/* ========================================================================= */

/** The Elder's address. One line at a time, the player can skip. */
export const FESTIVAL_SPEECH = [
  { who: 'Elder Maugrim', text: 'Welcome, everyone, to the First Forge Festival!' },
  { who: 'Elder Maugrim', text: 'Today is a very special day.' },
  { who: 'Elder Maugrim', text: 'Nine years ago, each of you took your first steps into this world.' },
  { who: 'Elder Maugrim', text: 'And today, you take your first steps toward protecting it.' },
  { who: 'Elder Maugrim', text: 'For generations, our people have lived quietly beneath these trees.' },
  { who: 'Elder Maugrim', text: 'But the humans have begun wandering deeper into our forest.' },
  { who: 'Elder Maugrim', text: 'They must never discover our home.' },
  { who: 'Elder Maugrim', text: 'Today, each of you will find your first weapon.' },
  { who: 'Elder Maugrim', text: 'Not one made by some distant blacksmith…' },
  { who: 'Elder Maugrim', text: 'But one made from the forest itself.' },
  { who: 'Elder Maugrim', text: 'Find a stick worthy of you.' },
  { who: 'Elder Maugrim', text: 'Bring it to the Stickwright.' },
  { who: 'Elder Maugrim', text: 'And discover what it can become.' },
];

/* ========================================================================= */
/* THE STEPS                                                                 */
/* ========================================================================= */

/*
  Each step is:
    id        stable name, saved
    objective what the HUD shows
    note      an optional line of flavour when it begins
    marker    (G) => {x, z, label} | null — where the arrow points
    done      (G) => boolean
    onEnter / onDone  optional hooks
*/
export const STEPS = [
  {
    id: 'speech',
    objective: 'The First Forge Festival',
    marker: null,
    done: G => G.quest.speechDone,
  },
  {
    id: 'findStick',
    objective: 'Find your first stick',
    note: 'Every weapon begins with something ordinary.',
    marker: G => {
      const s = G.quest._nearestStick(G);
      return s ? { x: s.x, z: s.z, label: 'a fallen stick' } : null;
    },
    done: G => G.state.sticks.length > 0,
    onDone: G => {
      G.ui.banner?.({
        title: 'Every weapon begins with something ordinary.',
        sub: 'Let’s see what yours becomes.',
      });
    },
  },
  {
    id: 'toStickwright',
    objective: 'Take it to the Stickwright',
    marker: G => {
      const a = G.world.anchors?.stickwright;
      const t = a?.talkAt;
      return t ? { x: t[0], z: t[1], label: 'Old Nissel’s workshop' } : null;
    },
    done: G => G.state.weapons.length > 0,
  },
  {
    id: 'equip',
    objective: 'Carry your new weapon',
    done: G => !!G.state.equippedWeapon,
    onEnter: G => {
      // it is handed straight to them, so this is usually already true
      const w = G.state.weapons[G.state.weapons.length - 1];
      if (w && !G.state.equipped) G.state.equip(w.uid);
    },
  },
  {
    id: 'findWorkers',
    objective: 'Something is wrong in the wood',
    note: 'Somebody is cutting. Find them.',
    marker: G => {
      const n = G.workers?.nearestCamp(G.player.x, G.player.z);
      return n ? { x: n.camp.x, z: n.camp.z, label: 'the sound of sawing' } : null;
    },
    done: G => {
      const n = G.workers?.nearestCamp(G.player.x, G.player.z);
      return !!n && n.dist < 34;
    },
  },
  {
    id: 'scare',
    objective: 'Drive them off',
    note: 'Swing with the left mouse button. They will not stay.',
    marker: G => {
      const n = G.workers?.nearestCamp(G.player.x, G.player.z);
      return n ? { x: n.camp.x, z: n.camp.z, label: 'the crew' } : null;
    },
    done: G => (G.workers?.clearedCount || 0) >= 1,
    onDone: G => {
      G.ui.banner?.({
        title: 'They have gone.',
        sub: 'They will come back. Somebody will always come back.',
      });
    },
  },
  {
    id: 'meetFisherman',
    objective: 'Find the fishing booth by the river',
    marker: G => {
      /* the BOOTH, not the man. He steps about behind his counter, and a
         marker that follows him jitters; the shop does not move. */
      const A = G.world?.anchors?.fishery;
      if (A) return { x: A.talkAt[0], z: A.talkAt[1], label: 'the fishing booth' };
      const f = G.npcs?.fisherman;
      return f ? { x: f.x, z: f.z, label: 'somebody on the riverbank' } : null;
    },
    done: G => G.quest.rodGiven,
  },
  {
    id: 'fish',
    objective: 'Cast a line in the lake',
    note: 'Take out the rod, stand by the water and press E. Hold to raise the sleeve, let go to sink it.',
    marker: G => {
      /* POINT AT THE WATER. The player has the rod now, so the next thing
         they need is somewhere to put it — the marker sits on the river
         beside the booth, which is the lake the tutorial means. */
      const A = G.world?.anchors?.fishery;
      if (A) return { x: A.castAt[0], z: A.castAt[1], label: 'the water' };
      const f = G.npcs?.fisherman;
      return f ? { x: f.x, z: f.z, label: 'the water' } : null;
    },
    done: G => G.quest.fishCaught > 0,
  },
  {
    id: 'done',
    objective: null,
    done: () => false,
    onEnter: G => {
      G.ui.banner?.({
        kicker: 'Tutorial complete',
        title: 'You’ve made your first weapon.',
        sub: 'You’ve protected the forest. And you’ve learned how to fish.\n' +
          'But there’s much more waiting beyond the village…',
        long: true,
      });
      bus.emit(EV.QUEST_DONE, {});
    },
  },
];

/* ========================================================================= */

export class Quest {
  constructor(G) {
    this.G = G;
    this.i = -1;
    this.step = null;
    this.objective = null;
    this.marker = null;
    this.speechDone = false;
    this.speechLine = 0;
    this.rodGiven = false;
    this.fishCaught = 0;
    this.finished = false;
    this._t = 0;
  }

  /** Pick up where a save left off, or start at the beginning. */
  start(savedId = null) {
    if (savedId === 'done') { this.finished = true; this.i = STEPS.length - 1; this.step = null; return; }
    const at = savedId ? STEPS.findIndex(s => s.id === savedId) : 0;
    this._enter(at < 0 ? 0 : at);
  }

  _enter(i) {
    this.i = i;
    this.step = STEPS[i] || null;
    if (!this.step) { this.objective = null; this.marker = null; return; }
    this.objective = this.step.objective;
    this.marker = null;
    this._t = 0;
    this.step.onEnter?.(this.G);
    if (this.step.note) {
      this.G.ui?.toast?.({ text: this.step.objective, sub: this.step.note, icon: 'spark', ms: 6000 });
    }
    bus.emit(EV.QUEST_STEP, { id: this.step.id, objective: this.objective });
    if (this.step.id === 'done') this.finished = true;
  }

  advance() {
    const prev = this.step;
    prev?.onDone?.(this.G);
    if (this.i + 1 < STEPS.length) this._enter(this.i + 1);
  }

  update(dt) {
    if (!this.step || this.finished) return;
    this._t += dt;
    /* the marker is recomputed every frame: the nearest stick changes as you
       walk, and an arrow that points at a stick you already passed is worse
       than no arrow */
    this.marker = this.step.marker ? this.step.marker(this.G) : null;
    if (this.step.done(this.G)) this.advance();
  }

  /** The nearest stick the player could actually reach, for the first marker. */
  _nearestStick(G) {
    if (!G.world?.sticks) return null;
    let best = null, bd = Infinity;
    for (const s of G.world.sticks.values()) {
      const d = Math.hypot(s.x - G.player.x, s.z - G.player.z);
      if (d < bd) { bd = d; best = s; }
    }
    return best;
  }

  /* --- hooks the game calls -------------------------------------------- */
  noteRod() { this.rodGiven = true; }
  noteFish() { this.fishCaught++; }
  finishSpeech() { this.speechDone = true; }

  get id() { return this.step?.id || (this.finished ? 'done' : null); }

  /** True while the opening speech has the camera. */
  get inSpeech() { return this.step?.id === 'speech' && !this.speechDone; }
}
