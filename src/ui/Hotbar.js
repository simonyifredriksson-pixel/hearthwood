/* Hotbar.js — what is in your paws, along the bottom of the screen.
   ===========================================================================
   FISH N STICKS has exactly two things you hold — the weapon and the rod —
   and a creel that fills up with fish. That is a small enough set that the
   hotbar can be honest about it rather than pretending to be a twelve-slot
   RPG belt with eight empty squares.

   So: five slots. Weapon, rod, and the three best fish in the creel. The
   fish slots are a SHOWCASE, not storage — they are the things you are
   about to sell, and seeing a Golden Moonfish sitting in slot four with a
   price on it is the single most direct way to say "go and find the man who
   buys these".

   RIGHT-CLICK A FISH TO STAR IT, here and in the satchel, exactly as
   briefed. The star is drawn on the slot, and a starred fish shows the same
   star everywhere else it appears, because a player needs to be able to
   glance at the bar and know their best catch is safe.

   The bar never takes the pointer away from the game except on the slots
   themselves, and it fades down when nothing has changed for a while.
*/

import { ic } from './Icons.js?v=1790014463';
import { rarityOf, MUTATION_BY_ID, catchValue, fishTitle } from '../data/FishData.js?v=1790014463';
import { RARITY } from '../art/Palette.js?v=1790014463';
import { esc, clamp, clamp01 } from '../core/Util.js?v=1790014463';

const money = n => '$' + Math.round(n).toLocaleString('en-US');

export class Hotbar {
  constructor(root, state, { audio = null, onSelect = null } = {}) {
    this.state = state;
    this.audio = audio;
    this.onSelect = onSelect;
    this.sel = 0;                    // 0 weapon, 1 rod
    this._sig = '';
    this._pulse = 0;

    this.el = document.createElement('div');
    this.el.className = 'hotbar';
    (root || document.body).appendChild(this.el);

    /* right-click anywhere on a fish slot stars it; the browser menu is
       suppressed only on the bar, not on the whole page */
    this.el.addEventListener('contextmenu', e => {
      const slot = e.target.closest('.hb-slot[data-fish]');
      if (!slot) return;
      e.preventDefault();
      const uid = Number(slot.dataset.fish);
      const now = this.state.toggleFavourite(uid);
      this.audio?.ui?.(now ? 'open' : 'tick');
      this._sig = '';               // force a redraw
      this.render();
    });
    this.el.addEventListener('click', e => {
      const slot = e.target.closest('.hb-slot');
      if (!slot || slot.dataset.i === undefined) return;
      this.select(Number(slot.dataset.i));
    });

    this.render();
  }

  /** Pick a slot. Only the first two are selectable — fish are not held. */
  select(i) {
    if (i > 1) return;
    if (i === 1 && !this.state.hasRod) { this.audio?.denied?.(); return; }
    this.sel = i;
    this.state.holding = i === 1 ? 'rod' : 'weapon';
    this.audio?.ui?.('tick');
    this._pulse = 1;
    this._sig = '';
    this.render();
    this.onSelect?.(this.state.holding);
  }

  /** 1..5, and Tab/X to flip between the weapon and the rod. */
  handleKeys(input) {
    for (let i = 0; i < 5; i++) {
      if (input.rawPressed(`Digit${i + 1}`)) { this.select(i); return true; }
    }
    if (input.rawPressed('KeyX')) { this.select(this.sel === 0 ? 1 : 0); return true; }
    return false;
  }

  update(dt) {
    if (this._pulse > 0) this._pulse = Math.max(0, this._pulse - dt * 2.2);
    this.render();
  }

  render() {
    const S = this.state;
    if (!S) return;
    this.sel = S.holding === 'rod' ? 1 : 0;

    const w = S.equippedWeapon;
    const rod = S.hasRod ? S.currentRod : null;
    /* the three best fish, which is what the player wants to look at */
    const fish = [...S.fish].sort((a, b) => catchValue(b) - catchValue(a)).slice(0, 3);

    /* redraw only when something actually changed — this runs every frame */
    const sig = [
      this.sel, w?.uid, w?.name, rod?.id, S.coin,
      fish.map(f => `${f.uid}:${f.fav ? 1 : 0}`).join(','), S.fish.length,
    ].join('|');
    if (sig === this._sig) return;
    this._sig = sig;

    const slots = [];

    /* --- the weapon ---------------------------------------------------- */
    slots.push(this._slot(0, {
      kind: 'weapon',
      icon: 'sword',
      name: w ? w.name : 'Bare paws',
      sub: w ? (w.label || w.cls) : 'nothing forged yet',
      rare: w ? RARITY[clamp(w.tier, 0, RARITY.length - 1)].css : null,
      empty: !w,
    }));

    /* --- the rod -------------------------------------------------------- */
    slots.push(this._slot(1, {
      kind: 'rod',
      icon: 'drop',
      name: rod ? rod.name : 'No rod',
      sub: rod ? `line ${rod.line.toFixed(1)} · depth ${Math.round(rod.reach * 100)}%` : 'ask a fisherman',
      rare: rod ? '#8fc46a' : null,
      empty: !rod,
    }));

    /* --- the creel ------------------------------------------------------ */
    for (let i = 0; i < 3; i++) {
      const f = fish[i];
      if (!f) {
        slots.push(this._slot(2 + i, { kind: 'fish', icon: 'drop', name: '', sub: '', empty: true }));
        continue;
      }
      const R = rarityOf(f.rarity);
      const mut = f.mutation ? MUTATION_BY_ID[f.mutation] : null;
      slots.push(this._slot(2 + i, {
        kind: 'fish', icon: 'drop',
        name: fishTitle(f),
        sub: money(catchValue(f)),
        rare: R.css, mut: mut?.css || null, fav: f.fav, uid: f.uid,
        tag: R.name,
      }));
    }

    this.el.innerHTML = `
      <div class="hb-purse">${ic('spark')}<b>${money(S.coin)}</b></div>
      <div class="hb-slots">${slots.join('')}</div>
      <div class="hb-creel">${ic('satchel')}<b>${S.fish.length}</b>
        <i>${S.sellableCount} to sell</i></div>`;
  }

  _slot(i, o) {
    const on = i === this.sel && i < 2;
    return `
      <div class="hb-slot${on ? ' on' : ''}${o.empty ? ' empty' : ''} hb-${o.kind}"
           data-i="${i}"${o.uid !== undefined ? ` data-fish="${o.uid}"` : ''}
           ${o.rare ? `style="--rare:${o.rare}${o.mut ? `;--mut:${o.mut}` : ''}"` : ''}
           title="${esc(o.name)}${o.sub ? ' — ' + esc(o.sub) : ''}">
        <span class="hb-key">${i + 1}</span>
        <span class="hb-icon">${ic(o.icon)}</span>
        ${o.fav ? '<span class="hb-fav" title="favourite — cannot be sold">&#9733;</span>' : ''}
        ${o.tag ? `<span class="hb-tag">${esc(o.tag)}</span>` : ''}
        <span class="hb-text">
          <b>${esc(o.name || '')}</b>
          <i>${esc(o.sub || '')}</i>
        </span>
      </div>`;
  }
}
