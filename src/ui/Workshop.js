/* Workshop.js — the Stickwright.
   ===========================================================================
   There is no recipe list here, and that is the entire design.

   The old screen asked the player to pick a WEAPON and then go and find wood
   that qualified. This one asks them to pick a STICK — any stick, every stick
   works — and then find out what it turned into. Everything on screen serves
   that: the left column is the wood you are carrying, the right column is the
   piece of wood itself, turning, with everything the Stickwright can tell you
   about it. What it will BECOME is the one thing nobody says, because the
   moment the player knows that, the whole system collapses back into a menu.

   THE FORGE ITSELF IS NOT ON THIS SCREEN ANY MORE. Putting the stick on the
   bench closes the shop and hands over to the cutscene in Forge.js, which is
   played in the world with the real Nissel at her real bench. What comes back
   here is the card at the end: name, type, rarity. A stylised 2D sequence
   lived here for a while and it was fine, and "fine" is exactly the problem —
   it was a loading bar that had been drawn nicely.
*/

import { forgeHint } from '../data/WeaponData.js?v=20260921163240';
import { stickBlurb, SPECIES, BARKS } from '../data/StickData.js?v=20260921163240';
import { RARITY } from '../art/Palette.js?v=20260921163240';
import { ic } from './Icons.js?v=20260921163240';
import { makeScreen } from './UI.js?v=20260921163240';
import { esc, clamp } from '../core/Util.js?v=20260921163240';

export class WorkshopScreen {
  constructor(state, ui, turntable, { onForge = null, audio = null } = {}) {
    this.state = state;
    this.ui = ui;
    this.tt = turntable;
    this.onForge = onForge;
    this.audio = audio;
    this.sel = null;            // uid of the stick being inspected
    this.closeKey = 'KeyQ';

    this.el = makeScreen('STICKWRIGHT', '<div class="shop"></div>', {
      wide: true, kicker: 'Bring me something interesting…',
    });
    this.el.querySelector('.x').onclick = () => ui.pop();
    this.el.addEventListener('click', e => { if (e.target === this.el) ui.pop(); });
    this.body = this.el.querySelector('.shop');
    this.render();
  }

  onOpen() {
    this.tt.clear();
    const first = this.state.sticks[0];
    if (first) this.select(first.uid); else this.render();
  }
  onClose() { this.tt.clear(); }

  get busy() { return false; }

  /* ====================================================================== */
  /* BROWSING                                                               */
  /* ====================================================================== */

  select(uid) {
    this.sel = uid;
    const s = this.state.stickById(uid);
    this.tt.showStick(s);
    this.render();
  }

  render() {
    const S = this.state;
    const sel = S.stickById(this.sel);

    this.body.innerHTML = `
      <div class="shop-cols">
        <div class="shop-list">
          <h4>${ic('stick')} What you are carrying <b>${S.sticks.length}</b></h4>
          <div class="rows">
            ${S.sticks.length
        ? S.sticks.map(s => this._stickRow(s)).join('')
        : `<p class="empty">Nothing in the satchel. Every branch on the forest
             floor is worth something here &mdash; go and look down.</p>`}
          </div>
        </div>
        <div class="shop-view">
          <div class="tt-slot" id="tt-slot"></div>
          ${sel ? this._inspect(sel) : '<div class="detail empty">Pick up a piece of wood.</div>'}
          <div class="shop-go">
            ${sel ? `<button class="btn big" id="act-forge">${ic('hammer')} Put it on the bench</button>`
        : ''}
          </div>
        </div>
      </div>`;

    this.body.querySelectorAll('.row').forEach(b => {
      b.onclick = () => { this.audio?.ui('tick'); this.select(Number(b.dataset.uid)); };
    });
    const go = this.body.querySelector('#act-forge');
    if (go) go.onclick = () => this.beginForge();
    this.tt.attach(this.body.querySelector('#tt-slot'));
  }

  _stickRow(s) {
    const t = clamp(s.tier ?? 0, 0, RARITY.length - 1);
    const R = RARITY[t];
    const n = (s.parts || []).length;
    return `<button class="row stick-row${s.uid === this.sel ? ' sel' : ''}" data-uid="${s.uid}">
      <span class="swatch" style="--c:${R.css}">${ic('stick')}</span>
      <span class="row-main">
        <b style="color:${t >= 2 ? R.css : 'inherit'}">${esc(s.name)}</b>
        <i>${s.length.toFixed(2)} m &middot; ${(s.thick * 200).toFixed(0)} mm
           &middot; <span style="color:${R.css}">${esc(R.name)}</span></i>
      </span>
      <span class="row-tags">${n ? `<em class="lit">${n}</em>` : ''}</span>
    </button>`;
  }

  /**
   * Everything the Stickwright can say about a stick, and nothing she cannot.
   *
   * Note what is absent: the weapon. `forgeHint` describes the WOOD — how
   * long, how heavy, how bent — and the player has to make of that what they
   * will. Printing "this will become a sabre" would turn the best moment in
   * the game into a transaction.
   */
  _inspect(s) {
    const t = clamp(s.tier ?? 0, 0, RARITY.length - 1);
    const R = RARITY[t];
    const sp = SPECIES[s.species] || SPECIES.oak;
    const bend = s.curve + s.wobble * 0.5 + s.kinks * 0.35;
    const shape = bend < 0.22 ? 'dead straight' : bend < 0.6 ? 'a gentle lean'
      : bend < 1.1 ? 'a real curve' : bend < 1.6 ? 'a strong bend' : 'a hook';
    const parts = s.parts || [];

    return `<div class="detail inspect">
      <h3 style="color:${R.css}">${esc(s.name)}</h3>
      <p class="kind"><span style="color:${R.css}">${esc(R.name)}</span>
        &middot; ${esc(sp.label)} &middot; ${parts.length || 'no'}
        notable ${parts.length === 1 ? 'feature' : 'features'}</p>
      <p class="blurb">${esc(stickBlurb(s))}</p>

      <div class="measures">
        <span><b>${s.length.toFixed(2)} m</b><i>length</i></span>
        <span><b>${(s.thick * 200).toFixed(0)} mm</b><i>across</i></span>
        <span><b>${esc(shape)}</b><i>shape</i></span>
        <span><b>${esc(BARKS[s.bark]?.label.replace(/ bark$/, '') || 'bark')}</b><i>surface</i></span>
      </div>

      ${parts.length ? `<ul class="parts">
        ${parts.map(c => `<li class="p-${esc(c.slot)}">
          <b>${esc(c.label)}</b>${c.note ? `<i>${c.note}</i>` : ''}
        </li>`).join('')}
      </ul>` : `<p class="plain">Nothing unusual about it. Most wood is like
        this, and most wood still becomes something.</p>`}

      <p class="hint">${ic('spark')} She weighs it and says: &ldquo;${esc(forgeHint(s))}.&rdquo;</p>
    </div>`;
  }

  /* ====================================================================== */
  /* THE FORGE                                                              */
  /* ====================================================================== */

  /**
   * Put it on the bench — and get out of the way.
   *
   * The screen closes first and the cutscene runs in the world. Nothing about
   * the forging happens here any more; this method's whole job is to name the
   * stick and stand down.
   */
  beginForge() {
    const s = this.state.stickById(this.sel);
    if (!s) return;
    this.audio?.ui('tick');
    this.ui.pop();
    this.onForge?.(s);
  }
}

/* ========================================================================= */
/* THE CARD AT THE END                                                       */
/* ========================================================================= */

/**
 * What it turned out to be.
 *
 * This is the only part of the forge that is still a screen, and it should
 * be: the player has just watched twenty seconds of somebody working, and
 * what they want now is the name, in large letters, with the rarity under it.
 */
export class RevealScreen {
  constructor(weapon, ui, turntable, { onDone = null } = {}) {
    this.result = weapon;
    this.ui = ui;
    this.tt = turntable;
    this.onDone = onDone;
    this.closeKey = 'KeyQ';
    this.el = makeScreen('STICKWRIGHT', '<div class="shop"></div>', {
      wide: true, kicker: 'She holds it out to you',
    });
    this.el.querySelector('.x').onclick = () => this._take();
    this.body = this.el.querySelector('.shop');
    this._render();
  }

  onOpen() { this.tt.showWeapon(this.result); this._render(); }
  onClose() { this.tt.clear(); }
  get busy() { return false; }

  _take() {
    this.ui.pop();
    this.onDone?.();
  }

  _render() {
    const w = this.result;
    if (!w) return;
    const t = clamp(w.tier, 0, RARITY.length - 1);
    const R = RARITY[t];
    const st = w.stats;
    this.body.innerHTML = `
      <div class="reveal tier-${t}" style="--rare:${R.css}">
        <div class="tt-slot big" id="tt-slot"></div>
        <div class="reveal-card">
          <h3>${esc(w.name)}</h3>
          <p class="reveal-kind">${esc((w.label || w.cls).toUpperCase())}</p>
          <p class="reveal-rare">${esc(R.name)}</p>
          ${w.traits?.length ? `<ul class="reveal-traits">
            ${w.traits.map(tr => `<li>&bull; ${esc(tr.label)}</li>`).join('')}
          </ul>` : ''}
          <div class="reveal-stats">
            <span><b>${st.bite}</b><i>damage</i></span>
            <span><b>${st.speed.toFixed(2)}</b><i>speed</i></span>
            <span><b>${st.reach.toFixed(2)}</b><i>reach</i></span>
            <span><b>${st.heft.toFixed(2)}</b><i>heft</i></span>
          </div>
          ${w.blurb ? `<p class="reveal-say">&ldquo;${esc(w.blurb)}&rdquo;</p>` : ''}
          <button class="btn big" id="act-done">${ic('check')} Take it</button>
        </div>
      </div>`;
    this.tt.attach(this.body.querySelector('#tt-slot'));
    const done = this.body.querySelector('#act-done');
    if (done) done.onclick = () => this._take();
  }
}
