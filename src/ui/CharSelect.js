/* CharSelect.js — choosing who you are.
   ===========================================================================
   Three animals on a turntable in a real 3D scene, not three pictures. You
   see the actual model you are about to play, breathing, blinking and
   flicking its ears, at the size it will actually be — which is the only
   honest way to let somebody pick a character whose whole appeal is how it
   moves.

   The three are shown TOGETHER at true relative scale first, because the
   size difference between the frog and the bear is the most interesting
   thing about the choice and a page of separate portraits hides it.
*/

import * as THREE from '../../lib/three.module.js?v=20260921163240';
import { buildAnimal } from '../art/AnimalArt.js?v=20260921163240';
import { poseAnimal, SPECIES_LIST, SPECIES } from '../game/Anim.js?v=20260921163240';
import { MATS } from '../art/Materials.js?v=20260921163240';
import { SKY, LIGHT, cssHex } from '../art/Palette.js?v=20260921163240';
import { ic } from './Icons.js?v=20260921163240';
import { esc, clamp, clamp01, lerp, damp, TAU } from '../core/Util.js?v=20260921163240';

export class CharSelect {
  /**
   * @param renderer  the live THREE.WebGLRenderer
   * @param onPick    (speciesKey) => void
   */
  constructor(renderer, onPick) {
    this.renderer = renderer;
    this.onPick = onPick;
    this.t = 0;
    this.index = 1;               // the fox, in the middle
    this.focus = 1;
    this.done = false;

    /* --- a little scene of its own -------------------------------------- */
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(34, 1, 0.1, 100);

    const key = new THREE.DirectionalLight(0xfff0d0, 2.4);
    key.position.set(2.6, 4.2, 3.4);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.camera.left = -3; key.shadow.camera.right = 3;
    key.shadow.camera.top = 3; key.shadow.camera.bottom = -3;
    key.shadow.camera.near = 0.5; key.shadow.camera.far = 14;
    key.shadow.bias = -0.0012;
    const rim = new THREE.DirectionalLight(0xbcd8ff, 0.85);
    rim.position.set(-3.2, 2.0, -2.6);
    const amb = new THREE.HemisphereLight(0xa8c4e8, 0x5a5236, 1.15);
    this.scene.add(key, rim, amb);

    /* a warm wooden floor disc, so they are standing on something */
    {
      const g = new THREE.CircleGeometry(4.2, 40);
      g.rotateX(-Math.PI / 2);
      const m = new THREE.MeshLambertMaterial({ color: 0x4a3a2a });
      const disc = new THREE.Mesh(g, m);
      disc.receiveShadow = true;
      disc.position.y = -0.001;
      this.scene.add(disc);
    }

    /* --- the three of them ------------------------------------------------ */
    this.rigs = SPECIES_LIST.map((S, i) => {
      const rig = buildAnimal(S.key, { seed: 7 });
      rig.root.position.set((i - 1) * 1.5, 0, 0);
      this.scene.add(rig.root);
      return { rig, S, baseX: (i - 1) * 1.5 };
    });

    this.turn = new THREE.Group();

    /* --- the DOM ---------------------------------------------------------- */
    this.el = document.createElement('div');
    this.el.className = 'screen charsel';
    this.el.innerHTML = `
      <div class="cs-wrap">
        <div class="cs-title">
          <span class="kicker">Hearthwood</span>
          <h1>Who will you be?</h1>
        </div>
        <div class="cs-stage"></div>
        <div class="cs-cards">
          ${SPECIES_LIST.map((S, i) => `
            <button class="cs-card" data-i="${i}">
              <b>${esc(S.label)}</b>
              <span class="cs-name">${esc(S.name)}</span>
              <p>${esc(S.blurb)}</p>
              <div class="cs-trait">${ic('paw')}<span>${esc(S.trait)}</span></div>
              <dl>
                <dt>pace</dt><dd><span style="width:${Math.round(S.run / 8.2 * 100)}%"></span></dd>
                <dt>satchel</dt><dd><span style="width:${Math.round((24 + S.satchel) / 42 * 100)}%"></span></dd>
                <dt>eye</dt><dd><span style="width:${Math.round((12 + S.spotBonus) / 21 * 100)}%"></span></dd>
              </dl>
            </button>`).join('')}
        </div>
        <div class="cs-go">
          <button class="big" id="cs-start">Walk out into Hearthwood ${ic('chevron')}</button>
          <p class="cs-hint">WASD to walk · mouse to look · <kbd>E</kbd> to pick things up</p>
        </div>
      </div>`;

    this.stage = this.el.querySelector('.cs-stage');
    this.cards = [...this.el.querySelectorAll('.cs-card')];
    this.cards.forEach((c, i) => {
      c.onclick = () => this.select(i);
      c.onmouseenter = () => { this.hover = i; };
      c.onmouseleave = () => { this.hover = -1; };
    });
    this.el.querySelector('#cs-start').onclick = () => this.confirm();
    this.hover = -1;
    this.select(1);
  }

  select(i) {
    this.index = clamp(i, 0, this.rigs.length - 1);
    this.cards.forEach((c, k) => c.classList.toggle('on', k === this.index));
  }

  onKeys(input) {
    if (input.rawPressed('ArrowLeft', 'KeyA')) this.select(this.index - 1);
    if (input.rawPressed('ArrowRight', 'KeyD')) this.select(this.index + 1);
    if (input.rawPressed('Enter', 'Space')) this.confirm();
    if (input.rawPressed('Digit1')) this.select(0);
    if (input.rawPressed('Digit2')) this.select(1);
    if (input.rawPressed('Digit3')) this.select(2);
  }

  confirm() {
    if (this.done) return;
    this.done = true;
    this.onPick(SPECIES_LIST[this.index].key);
  }

  /**
   * Advance and draw. main.js renders `this.scene` with `this.camera` into
   * the ordinary game canvas — the select screen is a real 3D view with the
   * cards laid over it, not a picture in a box.
   */
  render(dt, aspect) {
    this.t += dt;
    this.focus = damp(this.focus, this.index, 7, dt);

    this.camera.aspect = aspect || 1.6;
    /* frame all three, sliding toward whichever is selected. The stage sits
       in the upper half of the page, so the aim point is pushed DOWN to keep
       the animals clear of the cards below. */
    const cx = lerp(-1.5, 1.5, this.focus / 2);
    this.camera.position.set(cx + Math.sin(this.t * 0.16) * 0.28, 1.35, 3.9);
    this.camera.lookAt(cx * 0.82, 0.82, 0);
    this.camera.updateProjectionMatrix();

    for (let i = 0; i < this.rigs.length; i++) {
      const R = this.rigs[i];
      const chosen = i === this.index;
      const hovered = i === this.hover;
      const lift = chosen ? 1 : hovered ? 0.45 : 0;
      R.rig.root.position.x = damp(R.rig.root.position.x, R.baseX + (chosen ? 0 : (i < this.index ? -0.18 : 0.18)), 5, dt);
      // the chosen one turns to face you; the others look away, which reads
      // as "not picked" without dimming anything
      const wantYaw = chosen ? Math.sin(this.t * 0.35) * 0.35 : (i - this.index) * 0.5 + Math.PI * 0.12;
      R.rig.root.rotation.y = damp(R.rig.root.rotation.y, wantYaw, 4, dt);
      poseAnimal(R.rig, {
        t: this.t + i * 3.1, dt,
        speed: 0, moving: false, grounded: true,
        yaw: R.rig.root.rotation.y,
        lookAt: chosen ? [this.camera.position.x, this.camera.position.y, this.camera.position.z] : null,
        action: chosen && (this.t % 9) < 0.9 ? 'wave' : null,
        actionT: chosen ? clamp01(((this.t % 9)) / 0.9) : 0,
      });
      R.rig.root.traverse(o => { if (o.isMesh) o.visible = true; });
    }
  }

  dispose() {
    for (const R of this.rigs) {
      R.rig.root.traverse(o => { if (o.isMesh) o.geometry.dispose(); });
    }
    this.scene.clear();
  }
}
