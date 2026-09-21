/* State.js — what you have, what you have seen, and what gets saved.
   ===========================================================================
   The satchel, the rack of finished weapons, the discovery log, and the list
   of sticks already taken out of the world.

   A SAVE IS THE SEEDS, NOT THE OBJECTS. A stick in the satchel is stored as
   the numbers it was rolled from, and a weapon as the stick it came from plus
   the genome the forge rolled — a couple of hundred bytes, from which the
   exact mesh is regenerated. The alternative, storing geometry, would be
   megabytes of localStorage for something the generator rebuilds in a
   millisecond.
*/

import { loadRaw, saveRaw, clearSave } from '../core/Save.js?v=1790014463';
import { bus, EV } from '../core/Bus.js?v=1790014463';
import { GAME } from '../core/Config.js?v=1790014463';
import { rollStick, stickValue, stickTags, stickTier, stickName, stickComponents, RARE } from '../data/StickData.js?v=1790014463';
import { forgeWeapon, WEAPON_CLASSES } from '../data/WeaponData.js?v=1790014463';
import { catchValue, fishTitle, FISH } from '../data/FishData.js?v=1790014463';
import { STARTER_ROD, rodOf, ROD_BY_ID } from '../data/RodData.js?v=1790014463';
import { SPECIES } from './Anim.js?v=1790014463';
import { clamp } from '../core/Util.js?v=1790014463';

let nextUid = 1;

export class GameState {
  constructor() {
    this.species = 'fox';        // FISH N STICKS has one protagonist
    this.sticks = [];            // stick specs, each with a .uid
    this.weapons = [];           // {uid, cls, design, stick, name, tier, traits, stats}
    this.equipped = null;        // uid of the equipped weapon
    this.taken = new Set();      // stick slot keys already collected
    this.seenForms = new Set();  // rare forms discovered
    this.seenSpecies = new Set();// woods discovered
    this.metRecipes = new Set(); // weapon classes the forge has produced
    this.seenWeapons = new Set();// same, for the discovery banner
    this.metNPCs = new Set();
    this.stats = { picked: 0, crafted: 0, walked: 0, days: 0, fish: 0, scared: 0, sold: 0, earned: 0 };

    /* --- THE ECONOMY ----------------------------------------------------
       Money is the spine of FISH N STICKS: fish in, rods out, and the rods
       are what let you reach the water the next fish lives in. */
    this.coin = 0;
    this.hasRod = false;          // the Fisherman has handed the first one over
    this.rods = [];               // rod ids owned
    this.rod = null;              // rod id equipped
    this.fish = [];               // the creel: catch records with uid + fav
    this.seenFish = new Set();    // species logged, for the almanac
    this.seenMutations = new Set();
    this.seenVillages = new Set(['home']);
    this.explored = [];           // packed map-fog cells — see MapData

    this.questStep = null;        // where the First Forge Festival got to
    this.pos = null;
    this.dayPhase = 0.70;
    this.tutorial = 0;
    this._dirty = false;
  }

  /* ====================================================================== */
  /* MONEY                                                                  */
  /* ====================================================================== */

  earn(n) {
    const v = Math.max(0, Math.round(n));
    this.coin += v;
    this.stats.earned += v;
    this._dirty = true;
    bus.emit(EV.COIN, { coin: this.coin, delta: v });
    return v;
  }

  /** @returns true if it went through. Never lets the purse go negative. */
  spend(n) {
    const v = Math.max(0, Math.round(n));
    if (v > this.coin) return false;
    this.coin -= v;
    this._dirty = true;
    bus.emit(EV.COIN, { coin: this.coin, delta: -v });
    return true;
  }

  /* ====================================================================== */
  /* RODS                                                                   */
  /* ====================================================================== */

  /**
   * WHAT IS IN THE PAW.
   *
   * 'weapon' or 'rod'. The rod is a carried item like anything else, not a
   * mode the game is in — you take it out, you walk to water, you cast. It
   * lives here rather than on the Player so the hotbar, the HUD and the save
   * all read the same value.
   */
  get holding() { return this._holding || 'weapon'; }
  set holding(v) { this._holding = v === 'rod' ? 'rod' : 'weapon'; this._dirty = true; bus.emit(EV.ROD_CHANGED, { rod: this.currentRod, holding: this.holding }); }
  get holdingRod() { return this.hasRod && this.holding === 'rod'; }

  /** Swap between the rod and the weapon. Only possible if you own a rod. */
  toggleHold() {
    if (!this.hasRod) { this.holding = 'weapon'; return 'weapon'; }
    this.holding = this.holding === 'rod' ? 'weapon' : 'rod';
    return this.holding;
  }

  get currentRod() { return rodOf(this.rod || STARTER_ROD); }
  ownsRod(id) { return this.rods.includes(id); }

  giveRod(id) {
    if (!ROD_BY_ID[id]) return false;
    if (!this.rods.includes(id)) this.rods.push(id);
    /* auto-equip anything strictly better, because nobody buys a rod in
       order to keep using the old one */
    const cur = this.currentRod;
    if (!this.rod || ROD_BY_ID[id].tier > cur.tier) this.rod = id;
    this.hasRod = true;
    this._dirty = true;
    bus.emit(EV.ROD_CHANGED, { rod: this.currentRod });
    return true;
  }

  buyRod(id) {
    const rod = ROD_BY_ID[id];
    if (!rod) return { ok: false, reason: 'unknown' };
    if (this.ownsRod(id)) return { ok: false, reason: 'owned' };
    if (!this.spend(rod.price)) return { ok: false, reason: 'poor' };
    this.giveRod(id);
    return { ok: true, rod };
  }

  equipRod(id) {
    if (!this.ownsRod(id)) return false;
    this.rod = id;
    this._dirty = true;
    bus.emit(EV.ROD_CHANGED, { rod: this.currentRod });
    return true;
  }

  /* ====================================================================== */
  /* SATCHEL                                                                */
  /* ====================================================================== */

  get capacity() {
    return clamp(GAME.satchelBase + (this.species ? SPECIES[this.species].satchel : 0), 1, GAME.satchelMax);
  }
  get full() { return this.sticks.length >= this.capacity; }

  /**
   * Put a stick in the satchel.
   * @returns {{ok:boolean, reason?:string, stick?:object, discovery?:string}}
   */
  addStick(spec, key = null) {
    if (this.full) {
      bus.emit(EV.SATCHEL_FULL);
      return { ok: false, reason: 'full' };
    }
    const s = { ...spec, uid: nextUid++ };
    this.sticks.push(s);
    if (key) this.taken.add(key);
    this.stats.picked++;
    this._dirty = true;

    /* --- discovery: the first of anything is worth saying out loud ------ */
    let discovery = null;
    if (s.rare && !this.seenForms.has(s.rare)) {
      this.seenForms.add(s.rare);
      discovery = RARE[s.rare]?.label || s.rare;
      bus.emit(EV.DISCOVERY, { kind: 'form', id: s.rare, label: discovery, stick: s });
    } else if (!this.seenSpecies.has(s.species)) {
      this.seenSpecies.add(s.species);
      bus.emit(EV.DISCOVERY, { kind: 'wood', id: s.species, stick: s });
    }

    bus.emit(EV.STICK_PICKED, { stick: s, discovery });
    return { ok: true, stick: s, discovery };
  }

  removeStick(uid) {
    const i = this.sticks.findIndex(s => s.uid === uid);
    if (i < 0) return null;
    const [s] = this.sticks.splice(i, 1);
    this._dirty = true;
    return s;
  }

  stickById(uid) { return this.sticks.find(s => s.uid === uid) || null; }

  dropStick(uid) {
    const s = this.removeStick(uid);
    if (s) bus.emit(EV.STICK_DROPPED, { stick: s });
    return s;
  }

  /** Total worth of the satchel, for the tooltip. */
  get satchelValue() { return this.sticks.reduce((a, s) => a + stickValue(s), 0); }

  /* ====================================================================== */
  /* CRAFTING                                                               */
  /* ====================================================================== */

  /**
   * Put a stick on the bench and take a weapon off it.
   *
   * ONE STICK IN, ONE WEAPON OUT, ALWAYS. There is no failure case and no
   * "this stick cannot be used" — the only way this returns a failure is if
   * the stick is not in the satchel, which is a bug rather than an outcome.
   *
   * @returns {{ok:boolean, weapon?:object, reason?:string}}
   */
  craft(stick) {
    if (!stick) return { ok: false, reason: 'incomplete' };
    if (!this.stickById(stick.uid)) return { ok: false, reason: 'missing' };

    const spec = { ...stick };
    this.removeStick(stick.uid);

    const forged = forgeWeapon(spec);
    const w = {
      uid: nextUid++,
      cls: forged.cls,
      label: forged.label,
      design: forged.design,
      stick: spec,
      name: forged.name,
      tier: forged.tier,
      traits: forged.traits,
      blurb: forged.blurb,
      stats: forged.stats,
      madeAt: Date.now(),
    };
    this.weapons.push(w);
    this.metRecipes.add(forged.cls);
    if (!this.seenWeapons.has(forged.cls)) this.seenWeapons.add(forged.cls);
    this.stats.crafted++;
    this._dirty = true;
    bus.emit(EV.WEAPON_CRAFTED, { weapon: w, stick: spec });
    return { ok: true, weapon: w };
  }

  /** What this stick WOULD become, without consuming it. Used by the bench
   *  animation, which has to know the answer before the reveal shows it. */
  preview(stick) { return stick ? forgeWeapon(stick) : null; }

  /* ====================================================================== */
  /* THE CREEL                                                              */
  /* ====================================================================== */

  /**
   * Put a fish in the creel.
   *
   * Stored as the INPUTS to the value formula (species, size, mutation) and
   * not as a price, so a later balance change reprices everybody's creel
   * instead of leaving one player with a Perch worth four thousand.
   */
  addFish(f) {
    const rec = {
      uid: nextUid++,
      id: f.id, name: f.name, rarity: f.rarity, mutation: f.mutation || null,
      len: f.len, size: f.size ?? 0.5, seed: f.seed,
      fav: false,
      at: Date.now(),
    };
    this.fish.push(rec);
    this.stats.fish++;
    this._dirty = true;

    let firstSpecies = false, firstMut = false;
    if (!this.seenFish.has(rec.id)) { this.seenFish.add(rec.id); firstSpecies = true; }
    if (rec.mutation && !this.seenMutations.has(rec.mutation)) {
      this.seenMutations.add(rec.mutation); firstMut = true;
    }
    bus.emit(EV.FISH_KEPT, { fish: rec, firstSpecies, firstMut });
    return rec;
  }

  fishById(uid) { return this.fish.find(f => f.uid === uid) || null; }

  /** What this one is worth right now. */
  valueOf(f) { return catchValue(f); }

  /** Everything in the creel, worth this much. */
  get creelValue() { return this.fish.reduce((a, f) => a + catchValue(f), 0); }
  /** ...and the part of it a fisherman is allowed to touch. */
  get sellableValue() { return this.fish.reduce((a, f) => a + (f.fav ? 0 : catchValue(f)), 0); }
  get sellableCount() { return this.fish.reduce((a, f) => a + (f.fav ? 0 : 1), 0); }

  /**
   * FAVOURITING, and the one rule that matters.
   *
   * A favourited fish cannot be sold. Not "is skipped by the sell-all
   * button" — CANNOT BE SOLD, because the check lives in `sellFish`, which
   * is the only function in the game that removes a fish for money, and
   * every seller in every village goes through it. A new shop, a new
   * fisherman or a future auction house gets the protection for free
   * whether or not whoever writes it remembers to.
   */
  toggleFavourite(uid) {
    const f = this.fishById(uid);
    if (!f) return null;
    f.fav = !f.fav;
    this._dirty = true;
    bus.emit(EV.FISH_FAV, { fish: f });
    return f.fav;
  }

  /**
   * Sell one fish.
   * @returns {{ok:boolean, reason?:string, coin?:number, fish?:object}}
   */
  sellFish(uid) {
    const i = this.fish.findIndex(f => f.uid === uid);
    if (i < 0) return { ok: false, reason: 'missing' };
    if (this.fish[i].fav) return { ok: false, reason: 'favourite' };   // THE gate
    const [f] = this.fish.splice(i, 1);
    const coin = this.earn(catchValue(f));
    this.stats.sold++;
    this._dirty = true;
    bus.emit(EV.FISH_SOLD, { fish: f, coin });
    return { ok: true, coin, fish: f };
  }

  /**
   * Sell everything that is not a favourite.
   * Routed through `sellFish` one at a time rather than reimplementing the
   * loop, so there is exactly one place that can ever be wrong about it.
   */
  sellAllFish() {
    const ids = this.fish.filter(f => !f.fav).map(f => f.uid);
    let coin = 0, n = 0;
    for (const uid of ids) {
      const r = this.sellFish(uid);
      if (r.ok) { coin += r.coin; n++; }
    }
    return { ok: n > 0, coin, count: n, kept: this.fish.length };
  }

  dropFish(uid) {
    const i = this.fish.findIndex(f => f.uid === uid);
    if (i < 0 || this.fish[i].fav) return null;
    const [f] = this.fish.splice(i, 1);
    this._dirty = true;
    return f;
  }

  /** The biggest of a species ever landed, for the Fisherman to be smug about. */
  bestFish(id = null) {
    let best = null;
    for (const f of this.fish) {
      if (id && f.id !== id) continue;
      if (!best || f.len > best.len) best = f;
    }
    return best;
  }

  /** The prize of the creel — what the hotbar shows off. */
  get bestInCreel() {
    let best = null, bv = -1;
    for (const f of this.fish) {
      const v = catchValue(f);
      if (v > bv) { bv = v; best = f; }
    }
    return best;
  }

  weaponById(uid) { return this.weapons.find(w => w.uid === uid) || null; }

  equip(uid) {
    this.equipped = uid;
    this._dirty = true;
    bus.emit(EV.WEAPON_EQUIPPED, { weapon: this.weaponById(uid) });
  }

  unequip() {
    this.equipped = null;
    this._dirty = true;
    bus.emit(EV.WEAPON_EQUIPPED, { weapon: null });
  }

  get equippedWeapon() { return this.equipped ? this.weaponById(this.equipped) : null; }

  /* ====================================================================== */
  /* SAVE / LOAD                                                            */
  /* ====================================================================== */

  toJSON() {
    /* Sticks are stored whole rather than as bare seeds, because the roll
       depends on the CONTEXT it was found in (how remote, how wet, how
       shaded) and that context is not recoverable from the seed alone. They
       are small: a couple of hundred bytes each. */
    const slim = s => ({
      v: 2, seed: s.seed, species: s.species, form: s.form, rare: s.rare,
      length: s.length, thick: s.thick, taper: s.taper, curve: s.curve,
      curvePlane: s.curvePlane, wobble: s.wobble, kinks: s.kinks,
      forks: s.forks, twigs: s.twigs, knots: s.knots, fungi: s.fungi,
      moss: s.moss, mossSide: s.mossSide, lichen: s.lichen, wet: s.wet,
      pale: s.pale, charred: s.charred, leaves: s.leaves,
      bark: s.bark, nature: s.nature, special: s.special, effect: s.effect,
      inclusions: s.inclusions,
      brokenEnd: s.brokenEnd, brokenButt: s.brokenButt, extra: s.extra,
      hue: s.hue, lum: s.lum, tags: s.tags, tier: s.tier, name: s.name,
      uid: s.uid,
    });
    return {
      v: 2,
      species: this.species,
      sticks: this.sticks.map(slim),
      /* A weapon is stored as its stick plus its genome. The genome is
         reproducible from the stick — forgeWeapon is a pure function of it —
         but storing it makes the save immune to a later balance change
         silently turning somebody's greatsword into a broom. */
      weapons: this.weapons.map(w => ({
        uid: w.uid, cls: w.cls, label: w.label, design: w.design,
        stick: slim(w.stick), name: w.name, tier: w.tier,
        traits: w.traits, blurb: w.blurb, stats: w.stats,
      })),
      equipped: this.equipped,
      taken: [...this.taken],
      seenForms: [...this.seenForms],
      seenSpecies: [...this.seenSpecies],
      metRecipes: [...this.metRecipes],
      seenWeapons: [...this.seenWeapons],
      metNPCs: [...this.metNPCs],
      stats: this.stats,
      pos: this.pos,
      dayPhase: this.dayPhase,
      tutorial: this.tutorial,

      /* --- the economy ---------------------------------------------------
         The creel is stored WHOLE, not trimmed. The old save kept the last
         sixty catches as a log, which was fine when a fish was a statistic;
         a fish is now an item with a price and a favourite flag, and
         quietly dropping the oldest sixty-first would throw away somebody's
         starred Divine. If a creel ever gets big enough to matter, cap what
         the player can CARRY rather than what the save will admit to. */
      coin: this.coin,
      hasRod: this.hasRod,
      rods: this.rods,
      rod: this.rod,
      fish: this.fish.map(f => ({
        uid: f.uid, id: f.id, name: f.name, rarity: f.rarity,
        mutation: f.mutation, len: f.len, size: f.size, seed: f.seed,
        fav: !!f.fav, at: f.at,
      })),
      seenFish: [...this.seenFish],
      seenMutations: [...this.seenMutations],
      seenVillages: [...this.seenVillages],
      explored: this.explored,

      questStep: this.questStep,
      nextUid,
    };
  }

  static fromJSON(o) {
    const st = new GameState();
    if (!o || typeof o !== 'object') return st;
    try {
      /* There is one protagonist now. An old save that says 'bear' gets a
         fox, which is the only answer that leaves the player with a game. */
      st.species = 'fox';
      const revive = s => ({
        ...s,
        tags: s.tags || stickTags(s),
        parts: s.parts || stickComponents(s),
        tier: s.tier ?? stickTier(s),
        name: s.name || stickName(s),
      });
      st.sticks = (o.sticks || []).map(revive);
      /* A save written before the forge existed has weapons with `sticks` and
         a `recipeId` and no genome. Rather than drop them — which would take
         somebody's collection away — re-forge each one from the stick it was
         made of. It may come out as a different weapon than it was, which is
         the honest outcome: the old recipe it was built from is gone. */
      st.weapons = (o.weapons || []).map(w => {
        if (w.design && w.stick) return { ...w, stick: revive(w.stick) };
        const src = revive((w.sticks && w.sticks[0]) || {});
        if (!src.seed) return null;
        const f = forgeWeapon(src);
        return { uid: w.uid, ...f, stick: src, madeAt: w.madeAt };
      }).filter(Boolean);
      st.equipped = o.equipped ?? null;
      st.taken = new Set(o.taken || []);
      st.seenForms = new Set(o.seenForms || []);
      st.seenSpecies = new Set(o.seenSpecies || []);
      st.metRecipes = new Set(o.metRecipes || []);
      st.seenWeapons = new Set(o.seenWeapons || o.metRecipes || []);
      st.metNPCs = new Set(o.metNPCs || []);
      st.stats = { picked: 0, crafted: 0, walked: 0, days: 0, fish: 0, scared: 0, sold: 0, earned: 0, ...(o.stats || {}) };
      st.pos = o.pos || null;
      st.dayPhase = o.dayPhase ?? 0.70;
      st.tutorial = o.tutorial || 0;

      st.coin = Math.max(0, Math.round(o.coin || 0));
      st.hasRod = !!o.hasRod;
      st.rods = Array.isArray(o.rods) ? o.rods.filter(id => ROD_BY_ID[id]) : [];
      st.rod = ROD_BY_ID[o.rod] ? o.rod : (st.rods[0] || null);
      if (st.hasRod && !st.rods.length) { st.rods = [STARTER_ROD]; st.rod = STARTER_ROD; }
      /* A save from before the economy existed has fish stored as a log of
         {id,name,len,tier}. Revive what can be revived and drop the rest
         rather than letting a fish with no species into a shop. */
      st.fish = (Array.isArray(o.fish) ? o.fish : []).map(f => {
        const spec = FISH[f.id];
        if (!spec) return null;
        return {
          uid: f.uid ?? nextUid++,
          id: f.id, name: f.name || spec.name,
          rarity: f.rarity || spec.rarity,
          mutation: f.mutation || null,
          len: f.len ?? spec.len[0], size: f.size ?? 0.5, seed: f.seed ?? 1,
          fav: !!f.fav, at: f.at || Date.now(),
        };
      }).filter(Boolean);
      st.seenFish = new Set(o.seenFish || st.fish.map(f => f.id));
      st.seenMutations = new Set(o.seenMutations || []);
      st.seenVillages = new Set(o.seenVillages || ['home']);
      st.explored = Array.isArray(o.explored) ? o.explored : [];

      st.questStep = o.questStep || null;
      nextUid = Math.max(nextUid, o.nextUid || 1);
    } catch (e) {
      console.warn('[state] save was unreadable, starting fresh', e);
      return new GameState();
    }
    return st;
  }

  save() {
    const ok = saveRaw(this.toJSON());
    this._dirty = false;
    if (ok) bus.emit(EV.SAVED);
    return ok;
  }

  static load() {
    const raw = loadRaw();
    return raw ? GameState.fromJSON(raw) : null;
  }

  static wipe() { clearSave(); }
}
