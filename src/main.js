/* main.js — Hearthwood.
   ===========================================================================
   Boot, the character choice, and the one loop that drives everything.

   ORDER OF A FRAME, and it matters:
     1. input           — read, once, into one place
     2. camera          — the basis everything else steers by
     3. player          — moves using that basis, so they can never disagree
     4. world           — streams tiles and lights around where the player IS
     5. npcs            — react to where the player ended up
     6. interaction     — decided after everyone has moved, so the prompt is
                          about this frame and not the last one
     7. ui, then render
*/

import * as THREE from '../lib/three.module.js';
import { input } from './core/Input.js';
import { CameraRig } from './core/CameraRig.js';
import { audio } from './core/Audio.js';
import { bus, EV } from './core/Bus.js';
import { BUILD, RENDER, WORLD, GAME, PLAYER } from './core/Config.js';
import { clamp, clamp01, lerp, now, Rolling } from './core/Util.js';

import { MATS } from './art/Materials.js';
import { World } from './world/World.js';
import { Player } from './game/Player.js';
import { NPCs } from './game/NPCs.js';
import { GameState } from './game/State.js';
import { SPECIES } from './game/Anim.js';
import { weaponMeshes } from './art/WeaponArt.js';
import { RECIPE_BY_ID } from './data/WeaponData.js';
import { RARITY } from './art/Palette.js';
import { STICKWRIGHT } from './data/VillagerData.js';
import { RARE } from './data/StickData.js';

import { UI } from './ui/UI.js';
import { CharSelect } from './ui/CharSelect.js';
import { SatchelScreen, Turntable } from './ui/Satchel.js';
import { WorkshopScreen } from './ui/Workshop.js';
import { ic } from './ui/Icons.js';

/* ========================================================================= */

const canvas = document.getElementById('view');
const bootEl = document.getElementById('boot');
const bootBar = document.getElementById('boot-bar');
const bootText = document.getElementById('boot-text');

const renderer = new THREE.WebGLRenderer({
  canvas, antialias: true, powerPreference: 'high-performance', stencil: false,
});
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
renderer.setSize(innerWidth, innerHeight, false);
renderer.outputColorSpace = THREE.SRGBColorSpace;
/* ACES + the sRGB encode are done by three.js itself. There is deliberately
   no custom post pass: a hand-written composite shader has to remember to do
   the sRGB encode at the end of its fragment shader, and forgetting it makes
   the whole game a gamma too dark in a way that is invisible until somebody
   says "I can't see anything". Letting three.js own the transform removes
   the entire class of bug. */
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(RENDER.fov, innerWidth / innerHeight, RENDER.near, RENDER.far);
const rig = new CameraRig(camera);

input.attach(canvas);

const G = {
  state: null, world: null, player: null, npcs: null, ui: null,
  charSel: null, turntable: null,
  mode: 'boot',            // boot | select | play
  t: 0, frames: 0,
  target: null,            // what E would act on
  autosave: 0,
  fps: new Rolling(40),
  hintShown: {},
};
globalThis.HEARTHWOOD = G;

/* ========================================================================= */
/* BOOT                                                                      */
/* ========================================================================= */

function setBoot(p, label) {
  if (bootBar) bootBar.style.width = Math.round(clamp01(p) * 100) + '%';
  if (bootText && label) bootText.textContent = label.toUpperCase();
}

async function boot() {
  setBoot(0.02, 'waking the wood');

  G.ui = new UI({ audio });
  G.turntable = new Turntable();

  G.world = new World(scene, { onProgress: (p, l) => setBoot(0.05 + p * 0.85, l) });
  await G.world.build();
  G.world.audio = audio;

  G.npcs = new NPCs(G.world, scene);
  G.npcs.spawn();

  setBoot(0.96, 'lighting the lanterns');
  await new Promise(r => setTimeout(r, 60));

  /* --- warm the pipeline so the first frame is not a two-second hitch --- */
  renderer.compile(scene, camera);

  const saved = GameState.load();
  G.state = saved || new GameState();
  if (saved) {
    G.world.takenSticks = new Set(saved.taken);
    G.world.sky.setPhase(saved.dayPhase ?? 0.70);
  }

  setBoot(1, 'ready');
  bootEl.classList.add('gone');
  setTimeout(() => bootEl.remove(), 900);

  if (saved && saved.species) startGame(saved.species, saved);
  else showSelect();

  requestAnimationFrame(frame);
}

/* ========================================================================= */
/* CHARACTER SELECT                                                          */
/* ========================================================================= */

function showSelect() {
  G.mode = 'select';
  input.blocked = true;
  G.charSel = new CharSelect(renderer, key => {
    G.charSel.el.classList.add('out');
    setTimeout(() => {
      G.charSel.el.remove();
      G.charSel.dispose();
      G.charSel = null;
      startGame(key, null);
    }, 520);
  });
  document.getElementById('ui').appendChild(G.charSel.el);
  requestAnimationFrame(() => G.charSel.el.classList.add('in'));
}

/* ========================================================================= */
/* START                                                                     */
/* ========================================================================= */

function startGame(species, saved) {
  G.state.species = species;
  G.player = new Player(G.world, species);
  G.player.addTo(scene);

  if (saved?.pos) {
    G.player.x = saved.pos[0];
    G.player.z = saved.pos[2];
    G.player.yaw = saved.pos[3] ?? Math.PI;
  } else {
    /* start on the green, facing the workshop, so the first thing you see is
       a village with somebody in it */
    const a = G.world.village.anchors;
    const p = G.world.plan.plaza;
    G.player.x = p.x + 6;
    G.player.z = p.z + 12;
    if (a?.stickwright) G.player.yaw = Math.atan2(a.stickwright.x - G.player.x, a.stickwright.z - G.player.z);
  }
  G.player.y = G.world.groundAt(G.player.x, G.player.z);

  /* Build the ground you are about to stand on BEFORE handing over control.
     Otherwise the first three seconds are spent watching the wood assemble
     itself around you, which is the worst possible first impression for a
     game whose whole pitch is that the wood is already there. */
  setBoot(0.98, 'growing the near wood');
  G.world.prebuild(G.player.x, G.player.z);

  rig.reset({ x: G.player.x, y: G.player.y, z: G.player.z, yaw: G.player.yaw + Math.PI, preset: 'roam' });
  rig.setProbe((x, z) => G.world.groundAt(x, z));

  G.player.onStep = (surface, rel) => audio.step(surface, SPECIES[species].carryScale, rel);

  if (G.state.equipped) equipFromState();

  G.mode = 'play';
  input.blocked = false;

  G.ui.setSatchel(G.state.sticks.length, G.state.capacity);
  G.ui.setWeapon(G.state.equippedWeapon);

  bus.emit(EV.GAME_START, { species });

  if (!saved) {
    setTimeout(() => G.ui.toast({
      text: `You are ${SPECIES[species].name} the ${SPECIES[species].label.toLowerCase()}.`,
      sub: 'The wood begins past the fences. Look down while you walk.',
      icon: 'paw', ms: 6500,
    }), 900);
    setTimeout(() => G.ui.toast({
      text: 'Old Nissel keeps the workshop on the green.',
      sub: 'Bring her anything interesting you find.',
      icon: 'home', ms: 6500,
    }), 7200);
  }
}

/* ========================================================================= */
/* INTERACTION                                                               */
/* ========================================================================= */

function pickTarget() {
  const P = G.player;
  if (!P || P.busy) return null;

  /* the nearest stick in reach wins over anything else, because reaching for
     wood is what the player is doing 95% of the time */
  const s = G.world.nearestStick(P.x, P.z, P.reach);
  if (s) return { kind: 'stick', stick: s, dist: Math.hypot(s.x - P.x, s.z - P.z) };

  const npc = G.npcs.nearest(P.x, P.z, PLAYER.npcTalkRange);
  if (npc) return { kind: 'npc', npc, dist: Math.hypot(npc.x - P.x, npc.z - P.z) };

  return null;
}

function updatePrompt() {
  const t = G.target;
  if (!t) { G.ui.setPrompt(null); return; }
  if (t.kind === 'stick') {
    const tier = clamp(t.stick.spec.tier ?? 0, 0, 4);
    G.ui.setPrompt(t.stick.spec.name, {
      key: 'E', icon: 'stick', tone: tier >= 2 ? 'rare' : '',
    });
  } else if (t.kind === 'npc') {
    const n = t.npc;
    G.ui.setPrompt(n.isStickwright ? `Talk to ${n.name}, ${n.title}` : `Talk to ${n.name}`, {
      key: 'E', icon: n.isStickwright ? 'hammer' : 'home',
    });
  }
}

function doInteract() {
  const t = G.target;
  if (!t || !G.player || G.player.busy) return;

  if (t.kind === 'stick') {
    if (G.state.full) {
      audio.denied();
      G.ui.toast({ text: 'The satchel will not take another stick.', icon: 'satchel', tone: 'warn' });
      return;
    }
    const s = t.stick;
    G.player.lookAt = [s.x, s.y + 0.2, s.z];
    G.player.startAction('pick', 0.62, () => {
      const spec = G.world.takeStick(s.key);
      if (!spec) return;
      const res = G.state.addStick(spec, s.key);
      if (!res.ok) return;
      const tier = clamp(spec.tier ?? 0, 0, 4);
      audio.pickup(tier);
      G.ui.setSatchel(G.state.sticks.length, G.state.capacity);
      if (res.discovery) {
        G.ui.discovery({
          title: spec.name,
          sub: RARE[spec.rare]?.desc?.split('.')[0] + '.',
          tier,
        });
      } else if (tier >= 2) {
        G.ui.toast({ text: spec.name, sub: RARITY[tier].name, icon: 'spark', tone: 'rare' });
      }
      G.player.lookAt = null;
      maybeHint();
    });
  } else if (t.kind === 'npc') {
    talkTo(t.npc);
  }
}

async function talkTo(npc) {
  G.player.lookAt = [npc.x, npc.y + npc.rig.metrics.eyeHeight, npc.z];
  npc.talkT = Math.max(npc.talkT, 4);
  npc.targetYaw = Math.atan2(G.player.x - npc.x, G.player.z - npc.z);
  audio.voice(npc.voice);

  if (npc.isStickwright) {
    const first = !G.state.metNPCs.has('stickwright');
    G.state.metNPCs.add('stickwright');
    const has = G.state.sticks.length > 0;
    const line = first
      ? 'So. You are the one who has been looking at the ground. Good. ' +
      'Everyone here walks over a hundred stories a day and never once looks down.'
      : (has ? pick(STICKWRIGHT.greet) : pick(STICKWRIGHT.greetEmpty));

    const choice = await G.ui.say(`${npc.name}, ${npc.title}`, line, [
      { id: 'craft', label: has ? 'Show her the wood' : 'Ask what she needs', icon: 'hammer' },
      { id: 'talk', label: 'Ask her about the wood', icon: 'leaf' },
      { id: 'bye', label: 'Leave her to it', icon: 'chevron' },
    ]);

    if (choice === 'craft') {
      if (!has) {
        await G.ui.say(npc.name, 'Wood, child. Any wood. A branch, a twig, a limb — ' +
          'bring it here and I will tell you what is inside it. The far side of the fences ' +
          'is thick with it and none of it is doing anybody any good lying there.');
      } else {
        openWorkshop();
      }
    } else if (choice === 'talk') {
      await G.ui.say(npc.name, pick(STICKWRIGHT.idle));
      audio.voice(npc.voice);
    }
    G.player.lookAt = null;
    return;
  }

  G.state.metNPCs.add(npc.name);
  await G.ui.say(npc.name, G.npcs.line(npc));
  G.player.lookAt = null;
}

const pick = arr => arr[Math.floor(Math.random() * arr.length)];

/* ========================================================================= */
/* SCREENS                                                                   */
/* ========================================================================= */

function openSatchel() {
  if (G.ui.busy) return;
  const s = new SatchelScreen(G.state, G.ui, G.turntable);
  G.ui.push(s);
  requestAnimationFrame(() => G.turntable.attach(s.el.querySelector('#tt-slot')));
  const reattach = () => G.turntable.attach(s.el.querySelector('#tt-slot'));
  s.el.addEventListener('click', () => requestAnimationFrame(reattach));
}

function openWorkshop() {
  if (G.ui.busy) return;
  const s = new WorkshopScreen(G.state, G.ui, G.turntable, {
    audio,
    onCraft: (weapon, recipe) => {
      G.ui.setSatchel(G.state.sticks.length, G.state.capacity);
      G.ui.toast({ text: weapon.name, sub: 'made at the bench', icon: 'hammer', tone: 'rare', ms: 5200 });
      if (!G.state.equipped) { G.state.equip(weapon.uid); equipFromState(); }
      G.state.save();
    },
  });
  G.ui.push(s);
  requestAnimationFrame(() => G.turntable.attach(s.el.querySelector('#tt-slot')));
  s.el.addEventListener('click', () => requestAnimationFrame(() => G.turntable.attach(s.el.querySelector('#tt-slot'))));
}

function equipFromState() {
  const w = G.state.equippedWeapon;
  if (!w) { G.player?.unequip(); G.ui.setWeapon(null); return; }
  const rec = RECIPE_BY_ID[w.recipeId];
  if (!rec) return;
  const built = weaponMeshes(rec, w.sticks, MATS, { lod: 0 });
  G.player.equip({ ...built, recipe: rec, weapon: w });
  G.ui.setWeapon(w);
}

bus.on(EV.WEAPON_EQUIPPED, () => { if (G.player) equipFromState(); });

/* ========================================================================= */
/* HINTS                                                                     */
/* ========================================================================= */

function maybeHint() {
  const S = G.state;
  if (S.sticks.length === 1 && !G.hintShown.satchel) {
    G.hintShown.satchel = true;
    setTimeout(() => G.ui.toast({
      text: 'Press Q to look through your satchel.', icon: 'satchel', ms: 5200,
    }), 1400);
  }
  if (S.sticks.length === 4 && !G.hintShown.shop) {
    G.hintShown.shop = true;
    setTimeout(() => G.ui.toast({
      text: 'Old Nissel can make something of these.',
      sub: 'Her workshop is on the green.', icon: 'hammer', ms: 5800,
    }), 1400);
  }
}

/* ========================================================================= */
/* THE LOOP                                                                  */
/* ========================================================================= */

let last = now();

function frame() {
  requestAnimationFrame(frame);
  const t = now();
  let dt = (t - last) / 1000;
  last = t;
  // a tab that has been in the background hands back an enormous dt; letting
  // that through teleports the player and detonates every spring in the game
  dt = clamp(dt, 0, 0.1);
  G.t += dt;
  G.frames++;
  G.fps.push(dt);

  if (G.mode === 'select') {
    G.charSel.onKeys(input);
    G.charSel.render(dt, innerWidth / innerHeight);
    renderer.render(G.charSel.scene, G.charSel.camera);
    input.endFrame();
    return;
  }

  if (G.mode !== 'play') { input.endFrame(); return; }

  /* --- 1. input ------------------------------------------------------- */
  const uiAte = G.ui.handleKeys();

  if (!uiAte) {
    if (input.rawPressed('KeyQ', 'Tab')) openSatchel();
    if (input.rawPressed('Escape')) { /* nothing open: ignore */ }
    if (input.rawPressed('KeyE')) doInteract();
    if (input.rawPressed('KeyF') && G.player?.weapon && !G.player.busy) {
      audio.swing(G.player.weapon.recipe ? (G.player.weapon.info?.length || 1) : 1);
      G.player.startAction('swing', G.player.weapon.recipe
        ? (G.state.equippedWeapon?.stats.swingTime || 0.7) : 0.7);
    }
    if (input.rawPressed('KeyV')) {
      rig.applyPreset(rig.presetName === 'vista' ? 'roam' : 'vista');
    }
    if (input.rawPressed('KeyM')) audio.setEnabled(!audio.enabled);
  }

  /* --- 2. camera ------------------------------------------------------- */
  const look = input.lookDelta();
  rig.look(look.x, look.y);
  if (input.mouse.wheel) rig.zoom(input.mouse.wheel);
  if (G.ui.busy) rig.settleTargets();

  const P = G.player;
  const ax = input.moveAxis();
  const mv = rig.moveVector(ax.x, ax.y);
  const idle = !G.ui.busy && ax.x === 0 && ax.y === 0 && !input.lookActive;

  /* --- 3. player -------------------------------------------------------- */
  P.update(dt, mv, {
    run: input.down('ShiftLeft', 'ShiftRight'),
    jump: input.rawPressed('Space') && !G.ui.busy,
    frozen: G.ui.busy,
  });
  G.state.stats.walked += Math.hypot(P.vx, P.vz) * dt;

  rig.setFocus(P.x, P.y, P.z);
  rig.setBlockers(G.world.cameraBlockers(P.x, P.z));
  rig.update(dt, { idle });

  /* --- 4. world --------------------------------------------------------- */
  const { sky, env } = G.world.update(dt, P, camera);

  /* --- 5. npcs ---------------------------------------------------------- */
  G.npcs.update(dt, P);

  /* --- 6. interaction --------------------------------------------------- */
  G.target = G.ui.busy ? null : pickTarget();
  updatePrompt();
  highlightTarget(dt);

  /* --- 7. ui, audio, save ----------------------------------------------- */
  G.ui.update(dt);
  G.ui.setTime(sky.name, sky.night);
  G.ui.setHomeDistance(Math.hypot(P.x - WORLD.village.cx, P.z - WORLD.village.cz));
  audio.update(dt, {
    forest: env.forest, village: env.village, water: env.water,
    wind: env.wind, open: env.open, night: sky.night,
  });
  renderer.toneMappingExposure = sky.exposure;

  G.autosave += dt;
  if (G.autosave > GAME.autosaveSeconds) {
    G.autosave = 0;
    G.state.pos = [P.x, P.y, P.z, P.yaw];
    G.state.dayPhase = G.world.sky.phase;
    G.state.taken = G.world.takenSticks;
    G.state.save();
  }

  if (G.turntable) G.turntable.render(dt);

  renderer.render(scene, camera);
  input.endFrame();
}

/* --- the little lift-and-glow on whatever you are about to pick up ------- */
let hlMesh = null, hlT = 0;
function highlightTarget(dt) {
  const want = G.target?.kind === 'stick' ? G.target.stick.mesh : null;
  if (want !== hlMesh) {
    if (hlMesh) { hlMesh.position.y -= hlT * 0.05; hlMesh.rotation.z -= hlT * 0.0; }
    hlMesh = want;
    hlT = 0;
  }
  if (!hlMesh) return;
  const prev = hlT;
  hlT = Math.min(1, hlT + dt * 6);
  // a couple of centimetres of lift and a slow turn: enough to say "this one"
  // without making the forest floor twitch every time you walk past
  hlMesh.position.y += (hlT - prev) * 0.05;
  hlMesh.rotation.y += dt * 0.5 * hlT;
}

/* ========================================================================= */
/* WINDOW                                                                    */
/* ========================================================================= */

addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight, false);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
});

/* Pointer lock: click the world to take the mouse, Escape to give it back. */
canvas.addEventListener('mousedown', e => {
  if (e.button !== 0) return;
  audio.unlock();
  if (G.mode === 'play' && !G.ui.busy && !input.pointerLocked) input.requestLock();
});
addEventListener('keydown', () => audio.unlock(), { once: true });

addEventListener('beforeunload', () => {
  if (G.state && G.player) {
    G.state.pos = [G.player.x, G.player.y, G.player.z, G.player.yaw];
    G.state.dayPhase = G.world.sky.phase;
    G.state.taken = G.world.takenSticks;
    G.state.save();
  }
});

/* ========================================================================= */

boot().catch(err => {
  console.error(err);
  if (bootText) bootText.textContent = 'something went wrong — see the console';
  const p = document.createElement('pre');
  p.style.cssText = 'position:fixed;left:2rem;right:2rem;bottom:2rem;color:#e8c;font:12px monospace;white-space:pre-wrap;z-index:99';
  p.textContent = String(err && err.stack || err);
  document.body.appendChild(p);
});
