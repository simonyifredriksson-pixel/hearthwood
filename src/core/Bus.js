/* Bus.js — a tiny synchronous event bus.
   Systems announce what happened; nothing has to know who is listening. */

class EventBus {
  constructor() { this.map = new Map(); this.any = []; }

  on(type, fn) {
    if (!this.map.has(type)) this.map.set(type, []);
    this.map.get(type).push(fn);
    return () => this.off(type, fn);
  }

  once(type, fn) {
    const un = this.on(type, (...a) => { un(); fn(...a); });
    return un;
  }

  off(type, fn) {
    const list = this.map.get(type);
    if (!list) return;
    const i = list.indexOf(fn);
    if (i >= 0) list.splice(i, 1);
  }

  onAny(fn) { this.any.push(fn); return () => { const i = this.any.indexOf(fn); if (i >= 0) this.any.splice(i, 1); }; }

  emit(type, payload) {
    const list = this.map.get(type);
    if (list) {
      // copy: a handler is allowed to unsubscribe itself mid-emit
      for (const fn of list.slice()) {
        try { fn(payload); } catch (e) { console.error(`[bus] ${type}`, e); }
      }
    }
    for (const fn of this.any.slice()) {
      try { fn(type, payload); } catch (e) { console.error('[bus] any', e); }
    }
  }

  clear() { this.map.clear(); this.any.length = 0; }
}

export const bus = new EventBus();

/** Every event name the game uses, in one place so typos are findable. */
export const EV = {
  BOOT_PROGRESS: 'boot:progress',
  GAME_START: 'game:start',
  SPECIES_CHOSEN: 'species:chosen',

  STICK_PICKED: 'stick:picked',
  STICK_DROPPED: 'stick:dropped',
  SATCHEL_FULL: 'satchel:full',

  WEAPON_CRAFTED: 'weapon:crafted',
  WEAPON_EQUIPPED: 'weapon:equipped',

  DIALOGUE_OPEN: 'dialogue:open',
  DIALOGUE_CLOSE: 'dialogue:close',
  SCREEN_OPEN: 'screen:open',
  SCREEN_CLOSE: 'screen:close',

  DISCOVERY: 'discovery',      // first time a stick form or landmark is seen
  TOAST: 'toast',
  HINT: 'hint',
  SAVED: 'save:written',

  /* --- the forest, and who is in it ----------------------------------- */
  WORKER_SCARED: 'worker:scared',
  CAMP_CLEARED: 'camp:cleared',

  /* --- fishing and the economy ----------------------------------------- */
  ROD_GIVEN: 'rod:given',
  ROD_CHANGED: 'rod:changed',
  /* the cast landing and the bite are WORLD events before they are UI
     events: the rig listens for them to splash, ring and boil the water,
     and the reeling panel deliberately does not listen to either */
  FISH_SPLASH: 'fish:splash',    // the bobber has hit the water
  FISH_BITING: 'fish:biting',    // something is down there; the water boils
  FISH_OFF: 'fish:off',          // ...and it lost interest
  BEAST_HURT: 'beast:hurt',      // carries the damage, the hp and where to draw it
  BEAST_LOST: 'beast:lost',      // gave up the chase and is going home
  FISH_HOOKED: 'fish:hooked',
  FISH_CAUGHT: 'fish:caught',
  FISH_LOST: 'fish:lost',
  FISH_KEPT: 'fish:kept',        // it is in the creel now
  FISH_SOLD: 'fish:sold',
  FISH_FAV: 'fish:favourited',
  COIN: 'coin',

  /* --- the wood, and what lives in it ---------------------------------- */
  BEAST_NOTICED: 'beast:noticed',
  BEAST_DODGED: 'beast:dodged',
  BEAST_ROUTED: 'beast:routed',
  PLAYER_HURT: 'player:hurt',
  PLAYER_SHOVED: 'player:shoved',

  /* --- the world ------------------------------------------------------- */
  VILLAGE_FOUND: 'village:found',
  MAP_REVEALED: 'map:revealed',

  /* --- the tutorial ---------------------------------------------------- */
  QUEST_STEP: 'quest:step',
  QUEST_DONE: 'quest:done',
};
