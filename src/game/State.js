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

import { loadRaw, saveRaw, clearSave } from '../core/Save.js?v=20260921145028';
import { bus, EV } from '../core/Bus.js?v=20260921145028';
import { GAME } from '../core/Config.js?v=20260921145028';
import { rollStick, stickValue, stickTags, stickTier, stickName, stickComponents, RARE } from '../data/StickData.js?v=20260921145028';
import { forgeWeapon, WEAPON_CLASSES } from '../data/WeaponData.js?v=20260921145028';
import { SPECIES } from './Anim.js?v=20260921145028';
import { clamp } from '../core/Util.js?v=20260921145028';

let nextUid = 1;

export class GameState {
  constructor() {
    this.species = null;
    this.sticks = [];            // stick specs, each with a .uid
    this.weapons = [];           // {uid, cls, design, stick, name, tier, traits, stats}
    this.equipped = null;        // uid of the equipped weapon
    this.taken = new Set();      // stick slot keys already collected
    this.seenForms = new Set();  // rare forms discovered
    this.seenSpecies = new Set();// woods discovered
    this.metRecipes = new Set(); // weapon classes the forge has produced
    this.seenWeapons = new Set();// same, for the discovery banner
    this.metNPCs = new Set();
    this.stats = { picked: 0, crafted: 0, walked: 0, days: 0, fish: 0, scared: 0 };
    this.hasRod = false;          // the Fisherman has handed it over
    this.fish = [];               // everything caught, newest last
    this.questStep = null;        // where the First Forge Festival got to
    this.pos = null;
    this.dayPhase = 0.70;
    this.tutorial = 0;
    this._dirty = false;
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

  /** Record a fish. Kept as data rather than an object so a save is small. */
  addFish(f) {
    this.fish.push({ id: f.id, name: f.name, len: f.len, tier: f.tier, at: Date.now() });
    this.stats.fish++;
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
      hasRod: this.hasRod,
      fish: this.fish.slice(-60),   // a long tail of catches is not worth the bytes
      questStep: this.questStep,
      nextUid,
    };
  }

  static fromJSON(o) {
    const st = new GameState();
    if (!o || typeof o !== 'object') return st;
    try {
      st.species = o.species || null;
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
      st.stats = { picked: 0, crafted: 0, walked: 0, days: 0, fish: 0, scared: 0, ...(o.stats || {}) };
      st.pos = o.pos || null;
      st.dayPhase = o.dayPhase ?? 0.70;
      st.tutorial = o.tutorial || 0;
      st.hasRod = !!o.hasRod;
      st.fish = Array.isArray(o.fish) ? o.fish : [];
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
