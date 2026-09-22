/* FishingUI.js — the fishing overlay.
   ===========================================================================
   The reference for this was a flat grey slider with a flat grey bar in it.
   FISH N STICKS is carved wood, warm brass, parchment and lantern light, and
   the thing the player stares at for twenty seconds at a time has to belong
   to that world or the whole game feels like two games.

   So it is a float-gauge: a tall wooden rod-case sunk into water, with a
   BRASS SLEEVE that the player raises and lowers, the fish moving inside it,
   and the catch wound onto a REEL at the bottom like line coming in. Around
   it: the rod's name on a little brass plate, a depth scale cut into the
   timber, and reeds along the bottom edge.

   VERTICAL, and that is a real decision. The control is hold-to-rise,
   release-to-fall. Mapping a gravity control onto a horizontal axis asks the
   player to translate "up" into "right" on every single frame; down the
   screen it is immediate and nobody has to think about it.

   IT IS AN OVERLAY, not a screen. The world stays visible behind it and the
   fox stays on the bank, because half the pleasure of fishing in a game like
   this is the view while you do it.
*/

import { FISH_STATE } from '../game/Fishing.js?v=1790103247';
import { rarityOf, fishTitle, MUTATION_BY_ID, catchValue, FISH } from '../data/FishData.js?v=1790103247';
import { ic } from './Icons.js?v=1790103247';
import { esc, clamp, clamp01 } from '../core/Util.js?v=1790103247';

/** Carved into the timber down the side of the gauge, bottom to top.
    SHORT WORDS ONLY. "shallows" ran past the end of its column and out of
    the panel entirely — the gauge was a hundred and thirty pixels wide
    and the label was fifty-five of them. */
const DEPTHS = ['edge', '', 'weed', '', 'deep', '', 'dark'];

export class FishingUI {
  constructor(root) {
    this.el = document.createElement('div');
    this.el.className = 'fishing hidden';
    this.el.innerHTML = `
      <div class="fish-rig">
        <div class="fish-plate"><span class="fp-rod"></span></div>
        <!-- WHAT IS ON THE LINE, IN WORDS.
             The rarity wash on the case is a lovely piece of tension and
             it is also the only thing the panel said about the fish,
             which meant a player fighting a Moonscale Char and a player
             fighting a Silt Loach were reading the same interface in two
             slightly different colours. The name and the rarity go on a
             card of their own, and it only exists while something is
             actually hooked. -->
        <div class="fish-id">
          <span class="fi-name"></span>
          <span class="fi-rare"></span>
        </div>
        <div class="fish-case">
          <div class="fish-scale">${DEPTHS.map(d => `<i>${d}</i>`).join('')}</div>
          <div class="fish-track">
            <div class="fish-water"><span></span><span></span><span></span></div>
            <div class="fish-sleeve"><i class="fs-top"></i><i class="fs-bot"></i></div>
            <div class="fish-mark"><svg viewBox="0 0 34 16" aria-hidden="true">
              <path d="M2 8 C 8 1, 20 1, 26 8 C 20 15, 8 15, 2 8 Z"/>
              <path d="M26 8 L 33 3 L 31 8 L 33 13 Z"/>
              <circle cx="8" cy="7" r="1.3" class="fm-eye"/>
            </svg></div>
            <div class="fish-strain"></div>
          </div>
          <div class="fish-reeds"></div>
        </div>
        <!-- THE REEL, which is now a reel. It was a flat green bar with a
             number in it; the drum turns as the line comes in, so the
             player can see progress out of the corner of an eye that is
             busy watching the sleeve. -->
        <div class="fish-reel">
          <div class="fr-drum"><i></i><i></i><i></i></div>
          <div class="fr-gauge">
            <div class="fr-line"><b></b></div>
            <span class="fr-pct">0%</span>
          </div>
        </div>
        <div class="fish-warn">LINE STRAINING</div>
        <div class="fish-hint"><kbd>HOLD</kbd> rise <s>&middot;</s> <kbd>LET GO</kbd> sink</div>
      </div>
      <div class="fish-say"></div>`;
    (root || document.body).appendChild(this.el);

    this.track = this.el.querySelector('.fish-track');
    this.sleeve = this.el.querySelector('.fish-sleeve');
    this.mark = this.el.querySelector('.fish-mark');
    this.line = this.el.querySelector('.fr-line b');
    this.pct = this.el.querySelector('.fr-pct');
    this.reel = this.el.querySelector('.fish-reel');
    this.strain = this.el.querySelector('.fish-strain');
    this.rodPlate = this.el.querySelector('.fp-rod');
    this.say = this.el.querySelector('.fish-say');
    this.hint = this.el.querySelector('.fish-hint');
    this.drum = this.el.querySelector('.fr-drum');
    this.idName = this.el.querySelector('.fi-name');
    this.idRare = this.el.querySelector('.fi-rare');
    this._shown = false;
    this._lastState = null;
    this._lastRod = null;
    this._lastFish = null;
    this._spin = 0;
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

    /*
     * THE INTERFACE IS NOT HOW YOU FIND OUT A FISH IS ON.
     *
     * It used to appear the instant you pressed cast and sit there
     * through the whole wait, which meant the player watched a gauge
     * rather than the water, and the bite was something the panel told
     * them about. The brief is explicit about the order: the fish bites,
     * the water bubbles, the float reacts, and ONLY THEN does the reeling
     * interface come up.
     *
     * So during the throw and the wait there is no panel at all — there
     * is a fox holding a rod and a float sitting on a river, which is the
     * whole point of the activity. The boil gets four tenths of a second
     * on its own, which is long enough to be seen and short enough that
     * nobody misses a strike because of it.
     */
    const st = F.state;
    /* THE PANEL WAITS FOR THE CLICK.
       It used to slide in partway through the bite on a timer, which
       made the bubbles an announcement of something that was going to
       happen regardless. The player has to strike, so the interface
       appears when they do and not before — during the bite there is a
       fox, a rod and boiling water, and that is the entire prompt. */
    const reeling = st === FISH_STATE.FIGHT
      || st === FISH_STATE.CAUGHT
      || st === FISH_STATE.LOST;
    this.show(reeling);
    if (!reeling) { this._lastState = null; return; }

    if (F.rod && F.rod.id !== this._lastRod) {
      this._lastRod = F.rod.id;
      this.rodPlate.textContent = F.rod.name;
    }

    if (st !== this._lastState) {
      this._lastState = st;
      this.el.dataset.state = st;
      this.say.textContent = {
        [FISH_STATE.CAST]: 'The float sits still…',
        [FISH_STATE.BITE]: 'Strike!',
        [FISH_STATE.FIGHT]: '',
        [FISH_STATE.CAUGHT]: '',
        [FISH_STATE.LOST]: 'It slipped the line.',
      }[st] || '';
      this.hint.style.opacity = st === FISH_STATE.FIGHT ? '1' : '0.3';
      /* the strain warning belongs to the fight and to nothing else —
         leaving it up on the catch card would be the panel shouting
         about a line that is no longer under any load at all */
      if (st !== FISH_STATE.FIGHT) {
        delete this.el.dataset.strain;
        this.strain.classList.remove('on');
      }
    }

    /* the nameplate, written once per fish rather than once per frame */
    const fid = st === FISH_STATE.FIGHT && F.fish ? (F.fish.id + '|' + F.fish.rarity) : null;
    if (fid !== this._lastFish) {
      this._lastFish = fid;
      if (fid) {
        const R = rarityOf(F.fish.rarity);
        this.idName.textContent = FISH[F.fish.id]?.name || 'something';
        this.idRare.textContent = R.name;
        this.idRare.style.color = R.css;
        this.el.dataset.hooked = '1';
      } else {
        delete this.el.dataset.hooked;
      }
    }

    /* THE RARITY WASH. Set from the hooked fish, cleared the moment the
       line is empty — read by the CSS above, which tints the case and
       throbs the frame for the top tiers. No new elements, and the
       player knows something serious is on before they land it. */
    if (st === FISH_STATE.FIGHT && F.fish) {
      const R = rarityOf(F.fish.rarity);
      if (this._rare !== R.id) {
        this._rare = R.id;
        this.el.style.setProperty('--rare', R.css);
        this.el.dataset.rare = R.index >= 5 ? 'high' : R.index >= 2 ? 'yes' : '';
        if (R.index < 2) delete this.el.dataset.rare;
      }
    } else if (this._rare) {
      this._rare = null;
      delete this.el.dataset.rare;
      this.el.style.removeProperty('--rare');
    }

    if (st === FISH_STATE.FIGHT) {
      /* 0 is the BOTTOM of the gauge, so everything is measured from the
         bottom. This is the one place in the whole interface where that is
         true, and getting it backwards puts the fish where the player is
         looking and the sleeve where the fish is. */
      this.sleeve.style.bottom = `${F.zoneBottom * 100}%`;
      this.sleeve.style.height = `${F.zoneSize * 100}%`;
      this.sleeve.classList.toggle('on', F.onFish > 0.5);
      this.mark.style.bottom = `${F.fishPos * 100}%`;
      this.mark.classList.toggle('held', F.onFish > 0.5);
      this.line.style.height = `${F.catch * 100}%`;
      this.pct.textContent = `${Math.round(F.catch * 100)}%`;
      this.reel.classList.toggle('low', F.catch < 0.28);
      this.reel.classList.toggle('win', F.catch > 0.82);
      /* THE DRUM TURNS WITH THE LINE. It is driven by the catch value
         rather than by the clock, so it winds in while you are gaining
         and stops dead when you are not — which is a second channel for
         "is this going well" that costs one CSS transform. */
      this._spin = F.catch * 1080;
      this.drum.style.transform = `rotate(${this._spin}deg)`;
      /* the rod bending past what it is rated for: the one piece of
         feedback that tells a player they need a better rod rather than
         better reflexes */
      this.strain.classList.toggle('on', !!F.overLine);
      if (F.overLine) this.el.dataset.strain = '1'; else delete this.el.dataset.strain;
    } else if (st === FISH_STATE.BITE) {
      this.mark.style.bottom = `${(0.5 + Math.sin(F.stateT * 26) * 0.06) * 100}%`;
    }
  }

  /**
   * The catch card.
   *
   * Everything the brief asked to be visible is on it and in this order:
   * the full name with its mutation, the rarity, the mutation multiplier,
   * and the money — because the money is the reason the player is here.
   */
  reveal(fish) {
    return new Promise(resolve => {
      const R = rarityOf(fish.rarity);
      const mut = fish.mutation ? MUTATION_BY_ID[fish.mutation] : null;
      const spec = FISH[fish.id];
      const value = catchValue(fish);
      const big = fish.size > 0.88;

      const card = document.createElement('div');
      card.className = 'fish-caught' + (R.index >= 5 ? ' grand' : '') + (mut ? ' mutated' : '');
      card.style.setProperty('--rare', R.css);
      if (mut) card.style.setProperty('--mut', mut.css);
      card.innerHTML = `
        <div class="fc-rays"></div>
        <span class="fc-kicker">${mut ? 'a strange catch' : 'caught'}</span>
        <h3>${esc(fishTitle(fish))}</h3>
        <div class="fc-tags">
          <span class="fc-rare">${esc(R.name)}</span>
          ${mut ? `<span class="fc-mut">&times;${mut.mult} ${esc(mut.name)}</span>` : ''}
        </div>
        <p class="fc-size">${fish.len.toFixed(2)} m${big ? ' <em>&mdash; a specimen</em>' : ''}</p>
        <div class="fc-value"><span>value</span><b>$${value.toLocaleString('en-US')}</b></div>
        ${mut ? `<p class="fc-blurb">${esc(mut.desc)}</p>`
          : (spec?.blurb ? `<p class="fc-blurb">${esc(spec.blurb)}</p>` : '')}
        <button class="btn" id="fc-ok">${ic('check')} Into the creel</button>`;
      this.el.parentElement.appendChild(card);
      requestAnimationFrame(() => card.classList.add('in'));
      const done = () => {
        if (!card.isConnected) return;
        card.classList.remove('in');
        setTimeout(() => card.remove(), 300);
        resolve();
      };
      card.querySelector('#fc-ok').onclick = done;
      /* a Divine deserves longer on screen than a Silt Loach */
      setTimeout(done, R.index >= 5 ? 11000 : 6500);
    });
  }

  destroy() { this.el.remove(); }
}
