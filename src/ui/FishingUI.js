/* FishingUI.js — the fishing overlay.
   ===========================================================================
   Deliberately NOT a copy of the reference's flat grey slider. Hearthwood's
   interface is parchment, ink and gold, and the fishing widget has to belong
   to the same world — so it is a vertical wooden float-gauge with a brass
   band for the player's zone, a carved fish that swims inside it, and the
   catch meter wound round the outside like line on a reel.

   VERTICAL, not horizontal, and that is a real decision rather than a
   stylistic one: the control is hold-to-rise and release-to-fall, and mapping
   a gravity control onto a horizontal axis asks the player to translate "up"
   into "right" every single frame. Down the screen it is immediate.

   This is an overlay rather than a screen: the world stays visible and the
   character stays on the bank, because half the pleasure of fishing in a
   game like this is the view while you do it.
*/

import { FISH_STATE } from '../game/Fishing.js?v=20260920201841';
import { RARITY } from '../art/Palette.js?v=20260920201841';
import { ic } from './Icons.js?v=20260920201841';
import { esc, clamp, clamp01 } from '../core/Util.js?v=20260920201841';

export class FishingUI {
  constructor(root) {
    this.el = document.createElement('div');
    this.el.className = 'fishing hidden';
    this.el.innerHTML = `
      <div class="fish-gauge">
        <div class="fish-track">
          <div class="fish-water"></div>
          <div class="fish-zone"><i></i></div>
          <div class="fish-mark"></div>
          <div class="fish-depths"></div>
        </div>
        <div class="fish-meter"><b></b></div>
      </div>
      <div class="fish-say"></div>
      <div class="fish-hint"><kbd>HOLD</kbd> to raise &middot; release to sink</div>`;
    (root || document.body).appendChild(this.el);

    this.track = this.el.querySelector('.fish-track');
    this.zone = this.el.querySelector('.fish-zone');
    this.mark = this.el.querySelector('.fish-mark');
    this.meter = this.el.querySelector('.fish-meter b');
    this.say = this.el.querySelector('.fish-say');
    this.hint = this.el.querySelector('.fish-hint');
    this._shown = false;
    this._lastState = null;
  }

  show(on) {
    if (on === this._shown) return;
    this._shown = on;
    this.el.classList.toggle('hidden', !on);
    if (on) requestAnimationFrame(() => this.el.classList.add('in'));
    else this.el.classList.remove('in');
  }

  /** Called every frame with the Fishing model. */
  update(F) {
    if (!F || !F.active) { this.show(false); return; }
    this.show(true);

    const st = F.state;
    if (st !== this._lastState) {
      this._lastState = st;
      this.el.dataset.state = st;
      this.say.textContent = {
        [FISH_STATE.CAST]: 'The float sits still…',
        [FISH_STATE.BITE]: 'A bite! Click!',
        [FISH_STATE.FIGHT]: '',
        [FISH_STATE.CAUGHT]: '',
        [FISH_STATE.LOST]: 'It slipped the line.',
      }[st] || '';
      this.hint.style.opacity = st === FISH_STATE.FIGHT ? '1' : '0.35';
    }

    if (st === FISH_STATE.FIGHT) {
      /* 0 is the bottom of the bar, so everything is measured from the
         bottom — the one place in this interface where that is true, and
         getting it backwards puts the fish where the player is looking and
         the player where the fish is. */
      const zb = F.zoneBottom * 100;
      this.zone.style.bottom = `${zb}%`;
      this.zone.style.height = `${F.zoneSize * 100}%`;
      this.zone.classList.toggle('on', F.onFish > 0.5);
      this.mark.style.bottom = `${F.fishPos * 100}%`;
      this.meter.style.height = `${F.catch * 100}%`;
      this.meter.parentElement.classList.toggle('low', F.catch < 0.25);
    } else if (st === FISH_STATE.BITE) {
      this.mark.style.bottom = `${(0.5 + Math.sin(F.stateT * 26) * 0.05) * 100}%`;
    }
  }

  /** The reveal after a successful catch. Returns a promise that resolves
   *  when the player dismisses it. */
  reveal(fish) {
    return new Promise(resolve => {
      const t = clamp(fish.tier ?? 0, 0, RARITY.length - 1);
      const R = RARITY[t];
      const card = document.createElement('div');
      card.className = 'fish-caught';
      card.style.setProperty('--rare', R.css);
      card.innerHTML = `
        <span class="fc-kicker">Fish caught!</span>
        <h3>${esc(fish.name)}</h3>
        <p class="fc-size">${fish.len.toFixed(2)} m
          ${fish.size > 0.88 ? '<em>&mdash; a big one</em>' : ''}</p>
        ${fish.blurb ? `<p class="fc-blurb">${esc(fish.blurb)}</p>` : ''}
        <button class="btn" id="fc-ok">${ic('check')} Nice</button>`;
      this.el.parentElement.appendChild(card);
      requestAnimationFrame(() => card.classList.add('in'));
      const done = () => {
        card.classList.remove('in');
        setTimeout(() => card.remove(), 260);
        resolve();
      };
      card.querySelector('#fc-ok').onclick = done;
      setTimeout(() => { if (card.isConnected) done(); }, 7000);
    });
  }

  destroy() { this.el.remove(); }
}
