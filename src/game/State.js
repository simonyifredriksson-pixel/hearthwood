/* State.js — what you have, what you have seen, and what gets saved.
   ===========================================================================
   The satchel, the rack of finished weapons, the discovery log, and the list
   of sticks already taken out of the world.

   A SAVE IS THE SEEDS, NOT THE OBJECTS. A stick in the satchel is stored as
   the numbers it was rolled from, and a weapon as its recipe plus the specs
   that went into it — a couple of hundred bytes, from which the exact mesh is
   regenerated. The alternative, storing geometry, would be megabytes of
   localStorage for something the generator can rebuild in a millisecond.
*/

import { loadRaw, saveRaw, clearSave } from '../core/Save.js';
import { bus, EV } from '../core/Bus.js';
import { GAME } from '../core/Config.js';
import { rollStick, stickValue, stickTags, stickTier, stickName, RARE } from '../data/StickData.js';
import { RECIPE_BY_ID, weaponStats, weaponName } from '../data/WeaponData.js';
import { SPECIES } from './Anim.js';
import { clamp } from '../core/Util.js';

let nextUid = 1;

export class GameState {
  constructor() {
    this.species = null;
    this.sticks = [];            // stick specs, each with a .uid
    this.weapons = [];           // {uid, recipeId, sticks:[spec], name, stats}
    this.equipped = null;        // uid of the equipped weapon
    this.taken = new Set();      // stick slot keys already collected
    this.seenForms = new Set();  // rare forms discovered
    this.seenSpecies = new Set();// woods discovered
    this.metRecipes = new Set(); // recipes the Stickwright has shown you
    this.metNPCs = new Set();
    this.stats = { picked: 0, crafted: 0, walked: 0, days: 0 };
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
   * Consume the sticks and make the weapon.
   * @returns {{ok:boolean, weapon?:object, reason?:string}}
   */
  craft(recipe, sticks) {
    if (!recipe || !sticks || sticks.some(s => !s)) return { ok: false, reason: 'incomplete' };
    // every stick must still be in the satchel, and each may only be used once
    const uids = sticks.map(s => s.uid);
    if (new Set(uids).size !== uids.length) return { ok: false, reason: 'duplicate' };
    for (const u of uids) if (!this.stickById(u)) return { ok: false, reason: 'missing' };

    const specs = sticks.map(s => ({ ...s }));
    for (const u of uids) this.removeStick(u);

    const w = {
      uid: nextUid++,
      recipeId: recipe.id,
      sticks: specs,
      name: weaponName(recipe, specs),
      stats: weaponStats(recipe, specs),
      madeAt: Date.now(),
    };
    this.weapons.push(w);
    this.metRecipes.add(recipe.id);
    this.stats.crafted++;
    this._dirty = true;
    bus.emit(EV.WEAPON_CRAFTED, { weapon: w, recipe });
    return { ok: true, weapon: w };
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
      v: 1, seed: s.seed, species: s.species, form: s.form, rare: s.rare,
      length: s.length, thick: s.thick, taper: s.taper, curve: s.curve,
      curvePlane: s.curvePlane, wobble: s.wobble, kinks: s.kinks,
      forks: s.forks, twigs: s.twigs, knots: s.knots, fungi: s.fungi,
      moss: s.moss, mossSide: s.mossSide, lichen: s.lichen, wet: s.wet,
      pale: s.pale, charred: s.charred, leaves: s.leaves,
      brokenEnd: s.brokenEnd, brokenButt: s.brokenButt, extra: s.extra,
      hue: s.hue, lum: s.lum, tags: s.tags, tier: s.tier, name: s.name,
      uid: s.uid,
    });
    return {
      v: 1,
      species: this.species,
      sticks: this.sticks.map(slim),
      weapons: this.weapons.map(w => ({
        uid: w.uid, recipeId: w.recipeId, sticks: w.sticks.map(slim),
        name: w.name, stats: w.stats,
      })),
      equipped: this.equipped,
      taken: [...this.taken],
      seenForms: [...this.seenForms],
      seenSpecies: [...this.seenSpecies],
      metRecipes: [...this.metRecipes],
      metNPCs: [...this.metNPCs],
      stats: this.stats,
      pos: this.pos,
      dayPhase: this.dayPhase,
      tutorial: this.tutorial,
      nextUid,
    };
  }

  static fromJSON(o) {
    const st = new GameState();
    if (!o || typeof o !== 'object') return st;
    try {
      st.species = o.species || null;
      st.sticks = (o.sticks || []).map(s => ({ ...s, tags: s.tags || stickTags(s), tier: s.tier ?? stickTier(s), name: s.name || stickName(s) }));
      st.weapons = (o.weapons || []).map(w => ({
        ...w,
        sticks: (w.sticks || []).map(s => ({ ...s, tags: s.tags || stickTags(s) })),
      }));
      st.equipped = o.equipped ?? null;
      st.taken = new Set(o.taken || []);
      st.seenForms = new Set(o.seenForms || []);
      st.seenSpecies = new Set(o.seenSpecies || []);
      st.metRecipes = new Set(o.metRecipes || []);
      st.metNPCs = new Set(o.metNPCs || []);
      st.stats = { picked: 0, crafted: 0, walked: 0, days: 0, ...(o.stats || {}) };
      st.pos = o.pos || null;
      st.dayPhase = o.dayPhase ?? 0.70;
      st.tutorial = o.tutorial || 0;
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
