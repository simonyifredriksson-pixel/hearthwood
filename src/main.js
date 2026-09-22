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

import * as THREE from '../lib/three.module.js?v=1790102737';
import { input } from './core/Input.js?v=1790102737';
import { CameraRig } from './core/CameraRig.js?v=1790102737';
import { audio } from './core/Audio.js?v=1790102737';
import { bus, EV } from './core/Bus.js?v=1790102737';
import { BUILD, RENDER, WORLD, GAME, PLAYER } from './core/Config.js?v=1790102737';
import { clamp, clamp01, lerp, now, Rolling } from './core/Util.js?v=1790102737';

import { MATS } from './art/Materials.js?v=1790102737';
import { World } from './world/World.js?v=1790102737';
import { Player } from './game/Player.js?v=1790102737';
import { NPCs } from './game/NPCs.js?v=1790102737';
import { GameState } from './game/State.js?v=1790102737';
import { SPECIES } from './game/Anim.js?v=1790102737';
import { weaponMeshes } from './art/WeaponArt.js?v=1790102737';
import { rodMeshes } from './art/RodArt.js?v=1790102737';
import { fishMeshes } from './art/FishArt.js?v=1790102737';
import { fishTitle, waterAt } from './data/FishData.js?v=1790102737';
import { dangerBand, BAND_NAMES, payRate } from './data/VillageData.js?v=1790102737';

/**
 * A line under each region name. The name says where; this says what it
 * is like there, which is the whole reason the player cares which band
 * they are standing in.
 */
const BAND_SUB = [
  '', 'Quiet water and easy fish', 'The wood thickens',
  'Something is watching', 'Few come back this far', 'Where the old fish live',
];
import { WEAPON_CLASSES } from './data/WeaponData.js?v=1790102737';
import { RARITY } from './art/Palette.js?v=1790102737';
import { STICKWRIGHT, FISHERMAN } from './data/VillagerData.js?v=1790102737';
import { RARE } from './data/StickData.js?v=1790102737';
import { STARTER_ROD, rodsAt } from './data/RodData.js?v=1790102737';

import { UI } from './ui/UI.js?v=1790102737';
import { Talk } from './ui/Talk.js?v=1790102737';
import { RodShop } from './ui/RodShop.js?v=1790102737';
import { Minimap } from './ui/Minimap.js?v=1790102737';
import { Combatant } from './ui/Combatant.js?v=1790102737';
import { BootScene } from './ui/BootScene.js?v=1790102737';
import { Hotbar } from './ui/Hotbar.js?v=1790102737';
import { MapScreen } from './ui/MapScreen.js?v=1790102737';
import { Fog } from './game/MapData.js?v=1790102737';
import { Effects } from './game/Effects.js?v=1790102737';
import { SatchelScreen, Turntable } from './ui/Satchel.js?v=1790102737';
import { WorkshopScreen, RevealScreen } from './ui/Workshop.js?v=1790102737';
import { ForgeScene } from './game/Forge.js?v=1790102737';
import { Workers } from './game/Workers.js?v=1790102737';
import { Wildlife } from './game/Wildlife.js?v=1790102737';
import { Fishing, FISH_STATE } from './game/Fishing.js?v=1790102737';
import { FishingRig } from './game/FishingRig.js?v=1790102737';
import { FishingUI } from './ui/FishingUI.js?v=1790102737';
import { Quest, FESTIVAL_SPEECH } from './game/Quest.js?v=1790102737';
import { CHARGE } from './game/Combat.js?v=1790102737';
import { ic } from './ui/Icons.js?v=1790102737';

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
  workers: null, wildlife: null, fishing: null, fishRig: null, fishUI: null,
  quest: null, forge: null, minimap: null, cfx: null,
  talk: null, rodShop: null, hotbar: null, fog: null,
  fx: null, turntable: null,
  /* the cutscene director needs these two by name */
  scene, rig,
  mode: 'boot',            // boot | play
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

/**
 * THE 3D LOADING SCENE.
 *
 * On its own rAF loop rather than the game's, because the game's loop
 * does not exist yet and will not until the world has finished
 * generating — which is precisely the interval this is here to cover.
 *
 * It only reveals itself after a frame has genuinely been drawn. A
 * canvas that fades in and then fails to render is worse than no canvas
 * at all, because the painted fallback underneath is already good.
 */
function startBootScene() {
  const el = document.getElementById('boot-3d');
  if (!el) return;
  let scene3d = null;
  try { scene3d = new BootScene(el); } catch (e) { console.warn('[boot] scene failed', e); }
  if (!scene3d || !scene3d.ok) return;

  G.bootScene = scene3d;
  let last = performance.now();
  let shown = false;
  const tick = now => {
    if (!G.bootScene) return;
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    try { scene3d.update(dt); } catch (e) {
      console.warn('[boot] scene threw; falling back to the painted one', e);
      stopBootScene();
      return;
    }
    if (!shown) {
      shown = true;
      el.classList.add('on');
      bootEl?.classList.add('has3d');
    }
    G._bootRaf = requestAnimationFrame(tick);
  };
  G._bootRaf = requestAnimationFrame(tick);
}

function stopBootScene() {
  if (G._bootRaf) cancelAnimationFrame(G._bootRaf);
  G._bootRaf = null;
  G.bootScene?.dispose();
  G.bootScene = null;
  document.getElementById('boot-3d')?.classList.remove('on');
}

async function boot() {
  setBoot(0.02, 'waking the wood');

  /* THE LOADING SCENE, up before anything else is built.
     It has to exist before `world.build()` starts, because that is the
     several seconds it is covering — and it runs on its own animation
     loop so it keeps moving while the main thread is busy generating
     terrain. If WebGL is unavailable it quietly does nothing and the
     painted fallback underneath shows through. */
  startBootScene();

  G.ui = new UI({ audio });
  G.turntable = new Turntable();

  G.world = new World(scene, { onProgress: (p, l) => setBoot(0.05 + p * 0.85, l) });
  await G.world.build();
  G.world.audio = audio;

  G.npcs = new NPCs(G.world, scene);
  G.npcs.spawn();

  /* the survey crews out in the wood, and the two systems the tutorial
     hands the player on its way through */
  G.workers = new Workers(G.world, scene);
  G.workers.plan(7);
  G.wildlife = new Wildlife(G.world, scene);
  /**
   * THE ONE PLACE A CAUGHT FISH BECOMES A REAL FISH.
   *
   * Handed to the minigame rather than hooked onto an event, and it
   * READS THE FISH BACK OUT OF THE CREEL before saying yes. That
   * read-back is the whole point: `addFish` returning a record only
   * proves a function ran, and the bug this replaces was a catch being
   * announced for a fish that never made it into the inventory. If it
   * is not in there under its own uid, this returns null and the
   * minigame reports a lost fish instead of a false success.
   */
  const awardFish = caught => {
    const rec = G.state.addFish(caught);
    if (!rec || !G.state.fishById(rec.uid)) {
      console.error('[fishing] the creel did not accept the catch', caught);
      return null;
    }
    /* saving must never be able to un-catch a fish, so it is attempted
       after the record is confirmed and its failure is not fatal — the
       fish is in the creel in memory either way */
    try { G.state.save(); } catch (e) { console.warn('[fishing] could not save', e); }
    return rec;
  };

  G.fishing = new Fishing({ audio, award: awardFish });
  /* the float, the line and the water effects. The minigame is the rules;
     this is the part of fishing that happens where the player is looking. */
  G.fishRig = new FishingRig(scene, G.world);
  G.fishUI = new FishingUI(document.getElementById('ui'));
  G.audio = audio;
  G.forge = new ForgeScene(G);
  G.fx = new Effects(scene);
  G.talk = new Talk(document.getElementById('ui'), { audio });
  /* the dial in the corner, and the two bits of combat feedback */
  G.minimap = new Minimap(document.getElementById('ui'), G);
  G.cfx = new Combatant(document.getElementById('ui'), camera);

  setBoot(0.96, 'lighting the lanterns');
  await new Promise(r => setTimeout(r, 60));

  /* --- warm the pipeline so the first frame is not a two-second hitch --- */
  renderer.compile(scene, camera);

  const saved = GameState.load();
  G.state = saved || new GameState();
  /* the shop needs the purse, so it is built after the save has loaded */
  G.rodShop = new RodShop(document.getElementById('ui'), G.state, {
    audio,
    onBuy: rod => G.ui.toast({
      text: rod.name, sub: 'A better rod. The water will feel different.',
      icon: 'spark', tone: 'rare', ms: 5200,
    }),
  });
  G.fog = new Fog(G.state.explored);
  G.hotbar = new Hotbar(document.getElementById('ui'), G.state, {
    audio,
    onSelect: () => { if (G.player) equipFromState(); },
  });
  if (saved) {
    G.world.takenSticks = new Set(saved.taken);
    G.world.sky.setPhase(saved.dayPhase ?? 0.70);
  }

  setBoot(1, 'ready');
  bootEl.classList.add('gone');
  /* the scene keeps running through the fade, then goes — stopping it on
     the same frame the overlay starts fading would freeze the picture
     the player is still looking at */
  setTimeout(() => { stopBootScene(); bootEl.remove(); }, 900);

  /* THERE IS NO CHARACTER SELECT ANY MORE.
     FISH N STICKS has one protagonist — the fox — so the game starts in the
     wood rather than on a menu. A returning save resumes where it stopped;
     a new one begins at the festival. */
  startGame('fox', saved);

  requestAnimationFrame(frame);
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

  /* THE FIRST FORGE FESTIVAL. A returning player resumes wherever they got
     to; a new one starts at the speech. */
  G.quest = new Quest(G);
  G.quest.start(saved ? (saved.questStep || 'done') : null);
  if (G.quest.inSpeech) setTimeout(() => runFestival(), 900);

  G.player.onStep = (surface, rel) => audio.step(surface, SPECIES[species].carryScale, rel);

  /* GOING IN AND COMING OUT. The player reports the crossing; the
     splash belongs here because this owns the effects pool and the
     audio. A harder entry for a fox that ran in than one that waded. */
  G.player.onWater = (kind, at) => {
    const power = kind === 'enter' ? clamp(0.6 + at.speed * 0.20, 0.6, 1.8) : 0.75;
    G.fx?.splash(at.x, at.y, at.z, power);
    audio.splash?.(power);
  };

  if (G.state.equipped) equipFromState();

  G.mode = 'play';
  input.releaseAll();      // whatever the title screen was holding, let go

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

  /* SOMEBODY TO TALK TO BEATS EVERYTHING.
     The fisherman stands behind a booth with crates and barrels round it,
     and a stick on the ground next to the counter used to win the reach
     test — so walking up to sell a creel picked up a twig instead. */
  const npc = G.npcs.nearest(P.x, P.z, PLAYER.npcTalkRange);
  if (npc) return { kind: 'npc', npc, dist: Math.hypot(npc.x - P.x, npc.z - P.z) };

  /* WATER, if the rod is out.
     This is the whole of "go fishing": hold the rod, walk to any water in
     the world, press E. There is no fishing spot, no marked jetty and no
     permission — a lake is a lake. */
  if (G.state.holdingRod && !G.fishing.active) {
    const w = nearWater(P.x, P.z);
    if (w) return { kind: 'water', spot: w, dist: Math.hypot(w.x - P.x, w.z - P.z) };
  }

  const s = G.world.nearestStick(P.x, P.z, P.reach);
  if (s) return { kind: 'stick', stick: s, dist: Math.hypot(s.x - P.x, s.z - P.z) };

  return null;
}

function updatePrompt() {
  const t = G.target;
  if (!t) { G.ui.setPrompt(null); return; }
  if (t.kind === 'stick') {
    const tier = clamp(t.stick.spec.tier ?? 0, 0, RARITY.length - 1);
    G.ui.setPrompt(t.stick.spec.name, {
      key: 'E', icon: 'stick', tone: tier >= 2 ? 'rare' : '',
    });
  } else if (t.kind === 'npc') {
    const n = t.npc;
    G.ui.setPrompt(n.isStickwright ? `Talk to ${n.name}, ${n.title}` : `Talk to ${n.name}`, {
      key: 'E', icon: n.isStickwright ? 'hammer' : 'home',
    });
  } else if (t.kind === 'water') {
    G.ui.setPrompt('Cast a line', { key: 'E', icon: 'drop' });
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
      const tier = clamp(spec.tier ?? 0, 0, RARITY.length - 1);
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
  } else if (t.kind === 'water') {
    startFishing(t.spot);
  }
}

/**
 * Talk to somebody, and ALWAYS come back from it.
 *
 * The conversation holds its own claim on the input for its whole
 * duration, in a try/finally, and that is deliberately belt and braces
 * over the per-panel claims underneath it:
 *
 *   - Without it there are gaps. Selling a fish closes the panel, waits
 *     700 ms for the "Here's your money" line and then opens the panel
 *     again; in between, nothing held a claim, so the fox could take a
 *     step and the mouse could get captured before the menu snapped back.
 *   - With it, a throw anywhere inside — a bad fish record, a missing
 *     village, anything — still gives the player their legs back. The
 *     reported bug was that you had to reload the page after talking to
 *     anyone, and no amount of careful release-on-every-path is worth as
 *     much as one `finally`.
 *
 * It is also not re-entrant: walking into a second NPC mid-sentence used
 * to start a second conversation over the top of the first.
 */
let _talking = false;

async function talkTo(npc) {
  if (_talking) return;
  _talking = true;
  input.hold('convo');
  try {
    await _converse(npc);
  } catch (e) {
    console.error('[talk] conversation threw', e);
  } finally {
    _talking = false;
    input.release('convo');
    G.talk?.close(null);
    G.rodShop?.close();
    if (G.player) G.player.lookAt = null;
  }
}

async function _converse(npc) {
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

  /* --- the Fisherman: buys fish, sells rods ----------------------------
     The busiest conversation in the game, so it does NOT open a screen.
     Four choices, exactly as specified, in a small panel beside him with
     the river still visible behind it. */
  if (npc.isFisherman) {
    const first = !G.state.hasRod;
    G.state.metNPCs.add('fisherman');
    if (!first) { await fishermanShop(npc); G.player.lookAt = null; return; }
    if (first) {
      /* His four opening lines, one box at a time. It is the only place in
         the game that plays a fixed script at the player, and it is four
         lines long for exactly that reason. */
      for (const line of FISHERMAN.first) {
        await G.ui.say(`${npc.name}, ${npc.title}`, line);
      }
      /* THE ROD IS AN ITEM, not a permission flag. It goes into the pack,
         it goes into the paw, and from then on fishing is "hold the rod,
         walk to water" rather than a key you are told about once. */
      G.state.giveRod(STARTER_ROD);
      G.state.holding = 'rod';
      G.quest?.noteRod();
      G.state.save();
      G.ui.toast({
        text: G.state.currentRod.name,
        sub: 'It is in your paws. Find water and press E.',
        icon: 'drop', tone: 'rare', ms: 7000,
      });
      audio.craft?.();
    }
    G.player.lookAt = null;
    return;
  }

  G.state.metNPCs.add(npc.name);
  await G.ui.say(npc.name, G.npcs.line(npc));
  G.player.lookAt = null;
}


/* ========================================================================= */
/* THE FISHERMAN                                                             */
/* ========================================================================= */

const money = n => '$' + Math.round(n).toLocaleString('en-US');

/**
 * Sell fish, buy rods, go away again.
 *
 * A LOOP, not a script. Selling one fish should not throw you out of the
 * conversation to walk back up to him, so the panel comes straight back
 * with the creel one lighter — which is how you clear forty perch without
 * forty separate conversations.
 *
 * The four options and the four replies are exactly as briefed.
 */
async function fishermanShop(npc) {
  const S = G.state;
  const who = npc.name, title = npc.title || 'Fisherman';
  const village = npc.village || 'home';

  /* WHAT THIS MARKET PAYS. A fisherman a long way out pays better, and
     the panel says so — an invisible multiplier is a worse reward than
     no multiplier, because the player never learns to travel to sell. */
  const rate = payRate(village);

  for (;;) {
    const n = S.sellableCount;
    const worth = S.sellableValueAt(village);
    const best = S.bestInCreel;
    const line = S.fish.length === 0
      ? pick(FISHERMAN.greetEmpty || FISHERMAN.greet)
      : (S.stats.fish > 0 ? pick(FISHERMAN.proud) : pick(FISHERMAN.greet));

    const choice = await G.talk.ask(who, title, line, [
      {
        id: 'one', label: 'I want to sell this', icon: 'drop',
        note: best && !best.fav
          ? `${best.name} · ${money(S.valueOf(best) * rate)}` : null,
        disabled: !n,
      },
      {
        id: 'all', label: 'I want to sell all my fish', icon: 'satchel',
        note: n ? `${n} fish · ${money(worth)}` : 'nothing to sell',
        disabled: !n,
      },
      {
        id: 'rods', label: 'Can I see your fishing rods?', icon: 'spark',
        note: `${rodsAt(village).length} on the rack`,
      },
      { id: 'bye', label: 'Nevermind', icon: 'chevron' },
    ]);

    if (choice === null || choice === 'bye') {
      G.talk.say(who, title, 'See you later!');
      return;
    }

    if (choice === 'one') {
      /* "this" is whatever is worth most and is not starred — which is what
         a player means when they hold one thing up to a buyer. */
      const pickFish = S.fish.filter(f => !f.fav)
        .sort((a, b) => S.valueOf(b) - S.valueOf(a))[0];
      if (!pickFish) continue;
      const r = S.sellFish(pickFish.uid, village);
      if (r.ok) {
        audio.pickup?.(2);
        G.ui.toast({
          text: `Sold: ${pickFish.name}`, sub: `+${money(r.coin)}`,
          icon: 'drop', tone: 'rare', ms: 3200,
        });
        G.talk.say(who, title, "Here's your money.");
        S.save();
      }
      await wait(700);
      continue;
    }

    if (choice === 'all') {
      const r = S.sellAllFish(village);
      if (r.ok) {
        audio.pickup?.(3);
        G.ui.toast({
          text: `Sold ${r.count} fish`, sub: `+${money(r.coin)}` +
            (r.kept ? ` · ${r.kept} kept back` : ''),
          icon: 'satchel', tone: 'rare', ms: 4200,
        });
        G.talk.say(who, title, "Here's your money.");
        S.save();
      }
      await wait(900);
      continue;
    }

    if (choice === 'rods') {
      G.talk.close(null);
      G.talk.say(who, title, 'Take a look at what I have.', { ms: 2600 });
      await G.rodShop.show(village, who);
      S.save();
      continue;
    }
  }
}

const wait = ms => new Promise(r => setTimeout(r, ms));

/* ========================================================================= */
/* THE FIRST FORGE FESTIVAL                                                  */
/* ========================================================================= */

/**
 * The opening.
 *
 * The Elder's speech is the only time the game takes the controls, so it is
 * kept to what it needs: the camera settles on the stage, the lines play one
 * at a time, and any key skips to the end. Thirteen short lines is about
 * forty seconds at a reading pace, and it can be skipped in one press.
 */
async function runFestival() {
  const P = G.player;
  const plaza = G.world.plan.plaza;

  G.ui.banner({
    kicker: 'The First Forge Festival',
    title: 'Every nine years, the wood asks something of you.',
    long: true, ms: 4200,
  });

  // face the stage and hold still
  P.yaw = Math.atan2(plaza.x - P.x, plaza.z - P.z);
  rig.applyPreset('close');

  for (let i = 0; i < FESTIVAL_SPEECH.length; i++) {
    if (!G.quest || G.quest.speechDone) break;
    const line = FESTIVAL_SPEECH[i];
    /* The first box offers a way out. A thirteen-line speech is the right
       length the first time and far too long the second, and a returning
       player who has wiped their save should not have to sit through it. */
    const opts = i === 0
      ? [{ id: 'on', label: 'Listen', icon: 'leaf' },
         { id: 'skip', label: 'Skip the speech', icon: 'chevron' }]
      : null;
    const c = await G.ui.say(line.who, line.text, opts);
    if (c === 'skip') break;
  }

  G.quest?.finishSpeech();
  rig.applyPreset('roam');
  G.ui.banner({
    title: 'Find a stick worthy of you.',
    sub: 'The wood is past the fences. Look down.',
  });
}

/* --- what the systems report back ------------------------------------- */

/* BY THE TIME THIS FIRES THE FISH IS ALREADY IN THE CREEL — `awardFish`
   put it there and read it back before the minigame would announce a
   catch at all. So this is presentation only: nothing here can lose a
   fish, and nothing here needs to add one. */
bus.on(EV.FISH_CAUGHT, ({ fish }) => {
  G.quest?.noteFish();
  G.fishUI.reveal(fish).then(() => {
    G.fishing.reset();
    G.fishing.state = 'idle';
    G.fishRig?.end();
  });
});

/* THE NUMBER, on the frame the blow lands. */
bus.on(EV.BEAST_HURT, ({ at, damage, crit }) => {
  G.cfx?.damage(at, damage, { crit });
});

/* THE THREE WAYS A BITE CAN GO, told in one line each and never with a
   banner across the middle of the screen — the water is doing most of
   the talking, and these are just the words for it. */
bus.on(EV.FISH_OFF, () => {
  G.ui.toast({ text: 'It took the bait and went.', icon: 'drop', ms: 2600 });
});
bus.on(EV.FISH_EARLY, () => {
  G.ui.toast({ text: 'Nothing on the line yet.', icon: 'drop', ms: 1800 });
});

bus.on(EV.FISH_LOST, () => {
  setTimeout(() => {
    if (G.fishing) { G.fishing.reset(); G.fishing.state = 'idle'; }
    G.fishRig?.end();
  }, 1400);
});

/* A VILLAGE IS PEOPLED THE MOMENT IT IS RAISED.
   The world builds the geometry when the player comes within four hundred
   metres; this puts a fisherman behind its booth and a few residents in
   its doorways at the same instant, so nobody ever walks into an empty
   set of houses. */
bus.on(EV.VILLAGE_FOUND, ({ village, outpost }) => {
  G.npcs?.populate(outpost);
  if (!G.state.seenVillages.has(village.id)) {
    G.state.seenVillages.add(village.id);
    G.state.save();
    G.ui.banner({
      kicker: 'a village',
      title: village.name,
      sub: village.blurb,
      ms: 6200,
    });
    audio.craft?.();
  }
});

bus.on(EV.CAMP_CLEARED, ({ total }) => {
  G.state.stats.scared++;
  G.ui.toast({
    text: 'They have packed up and gone',
    sub: total === 1 ? 'One clearing saved. There are others.' : `${total} clearings saved.`,
    icon: 'leaf', tone: 'rare', ms: 6000,
  });
  G.state.save();
});
/* ========================================================================= */
/* FISHING                                                                   */
/* ========================================================================= */

function startFishing(spot = null) {
  if (!G.state.hasRod || G.fishing.active) return;
  const P = G.player;
  const s = spot || nearWater(P.x, P.z);
  if (!s) {
    G.ui.toast({ text: 'No water within reach.', icon: 'drop', tone: 'warn' });
    return;
  }
  if (!G.state.holdingRod) G.state.holding = 'rod';
  P.yaw = Math.atan2(s.x - P.x, s.z - P.z);
  /* THE ROD IS PART OF THE CAST, not decoration. Its reach caps how deep
     the water counts as, its lure sets how long the wait is, and its luck
     and fortune bias what is down there — so a better rod genuinely changes
     what comes out of the same pond. */
  const rod = G.state.currentRod;

  /* WHICH WATER THIS IS. A lake is keyed by its own centre so every
     swim on it is the same water; the river is keyed by a 60 m cell, so
     it changes character as you walk its length instead of being one
     enormous identical channel. */
  const lake = G.world.terrain.lakeAt?.(s.x, s.z) || null;
  const water = lake
    ? waterAt(lake.x, lake.z)
    : waterAt(Math.round(s.x / 60) * 60, Math.round(s.z / 60) * 60);

  const where = {
    ...s,
    depth: clamp01(Math.min(s.depth ?? 0.45, rod.reach) + (water.depth || 0)),
    remoteness: clamp01(Math.hypot(P.x - WORLD.village.cx, P.z - WORLD.village.cz) / 700),
    night: G.world.sky.night,
    water,
    rod,
  };

  /* NAME THE SWIM, once per water, so arriving somewhere new is an event
     and coming back to it is recognisable. */
  if (G._lastWater !== water.key) {
    G._lastWater = water.key;
    G.ui.toast({
      text: `${water.name} water`, sub: water.blurb,
      icon: 'drop', ms: 4200,
    });
  }
  G.fishing.cast(where);
  /* The float flies from the rod tip, which is on the end of a moving
     arm — so the rig is handed a function rather than a position. */
  G.fishRig?.begin(where, () => P.rodTip() || new THREE.Vector3(P.x, P.y + 1.0, P.z));
}

/**
 * Is there fishable water near enough to cast into?
 * Samples a ring around the player rather than testing the river's formula,
 * so a pond or a widened bend works too.
 */
function nearWater(x, z) {
  const W = G.world;
  for (let ring = 2.5; ring <= 9; ring += 1.6) {
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const px = x + Math.cos(a) * ring, pz = z + Math.sin(a) * ring;
      if (W.terrain.waterAt && W.terrain.waterAt(px, pz)) {
        return { x: px, z: pz, depth: 0.45, seed: Math.floor(px * 13 + pz * 7) };
      }
    }
  }
  return null;
}

const pick = arr => arr[Math.floor(Math.random() * arr.length)];

/* ========================================================================= */
/* SCREENS                                                                   */
/* ========================================================================= */

/* THE MAP.
   Opened with M. The fog is revealed by walking, never by opening it, so
   this only ever draws what has already been earned. */
function openMap() {
  if (G.ui.busy || G.forge?.busy) return;
  G.ui.push(new MapScreen(G));
}

function openSatchel() {
  if (G.ui.busy) return;
  const s = new SatchelScreen(G.state, G.ui, G.turntable);
  G.ui.push(s);
  requestAnimationFrame(() => G.turntable.attach(s.el.querySelector('#tt-slot')));
  const reattach = () => G.turntable.attach(s.el.querySelector('#tt-slot'));
  s.el.addEventListener('click', () => requestAnimationFrame(reattach));
}

function openWorkshop() {
  if (G.ui.busy || G.forge?.busy) return;
  const s = new WorkshopScreen(G.state, G.ui, G.turntable, {
    audio,
    onForge: stick => runForge(stick),
  });
  G.ui.push(s);
  requestAnimationFrame(() => G.turntable.attach(s.el.querySelector('#tt-slot')));
  s.el.addEventListener('click', () => requestAnimationFrame(() => G.turntable.attach(s.el.querySelector('#tt-slot'))));
}

/**
 * THE FORGE, END TO END.
 *
 * The shop screen has already closed itself; this runs the cutscene in the
 * world, then puts the card up. `G.state.craft` is handed to the director as
 * a closure rather than being called here, because the director decides WHEN
 * the wood stops being wood.
 */
async function runForge(stick) {
  if (!G.forge || G.forge.busy) return;
  const weapon = await G.forge.play(stick, () => G.state.craft(stick));
  if (!weapon) {
    G.ui.toast({ text: 'She turns it over and hands it back.', icon: 'stick', tone: 'warn' });
    return;
  }

  G.ui.setSatchel(G.state.sticks.length, G.state.capacity);
  if (!G.state.equipped) { G.state.equip(weapon.uid); equipFromState(); }
  G.state.save();
  audio.craft?.();

  const card = new RevealScreen(weapon, G.ui, G.turntable, {
    onDone: () => {
      G.ui.toast({
        text: weapon.name,
        sub: `${weapon.label} · ${RARITY[clamp(weapon.tier, 0, RARITY.length - 1)].name}`,
        icon: 'hammer', tone: 'rare', ms: 5600,
      });
      // still carrying wood? she is right there and the bench is still warm
      if (G.state.sticks.length) setTimeout(openWorkshop, 320);
    },
  });
  G.ui.push(card);
  requestAnimationFrame(() => G.turntable.attach(card.el.querySelector('#tt-slot')));
}

/**
 * Put the right thing in the paw.
 *
 * The rod and the weapon share one hand and one mount point, so this is the
 * single place that decides which of them is in it. Both are built with the
 * grip at the origin and the business end up +Y, so the carry code does not
 * have to care which it is holding.
 */
function equipFromState() {
  const S = G.state;
  if (!G.player) return;

  /* A FISH IN THE PAW, AT ITS REAL SIZE.
     The whole reason to carry one around is to show somebody, so nothing
     here normalises the scale: a 9 cm minnow is a scrap between the
     fox's fingers and a 1.4 m river father is an armful. `Player.equip`
     scales a weapon to fit the wielder, which is right for a three-metre
     branch and exactly wrong here, so the fish reports a length of 1 and
     carries its true size in the mesh. */
  if (S.holdingFish) {
    const f = S.heldFishRecord;
    if (G.player.heldFishUid !== f.uid) {
      const built = fishMeshes(f, MATS, { lod: 0 });
      G.player.equip({
        meshes: built.meshes, info: { length: 1 },
        weapon: null, cls: 'fish', fish: f,
      });
      G.player.heldFishUid = f.uid;
      G.player.heldRodId = null;
    }
    G.ui.setWeapon({ name: fishTitle(f) });
    return;
  }
  G.player.heldFishUid = null;

  if (S.holdingRod) {
    const rod = S.currentRod;
    if (G.player.heldRodId !== rod.id) {
      const built = rodMeshes(rod, MATS, { lod: 0 });
      G.player.equip({ ...built, weapon: null, cls: 'rod', rod });
      G.player.heldRodId = rod.id;
    }
    G.ui.setWeapon({ name: rod.name });
    return;
  }

  G.player.heldRodId = null;
  const w = S.equippedWeapon;
  if (!w) { G.player.unequip(); G.ui.setWeapon(null); return; }
  if (!w.design || !w.stick) return;
  const built = weaponMeshes(w, MATS, { lod: 0 });
  G.player.equip({ ...built, weapon: w, cls: w.cls });
  G.ui.setWeapon(w);
}

bus.on(EV.WEAPON_EQUIPPED, () => { if (G.player) equipFromState(); });
bus.on(EV.ROD_CHANGED, () => { if (G.player) equipFromState(); });

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

  if (G.mode !== 'play') { input.endFrame(); return; }

  /* --- 1. input ------------------------------------------------------- */
  /* A CUTSCENE OWNS THE FRAME. It takes the camera, the controls and the
     Stickwright, and the only key it answers to is the one that ends it.
     Everything below the input block still runs — the world keeps streaming
     and the village keeps working, because a village that freezes behind a
     cutscene is a diorama. */
  const cine = !!G.forge?.busy;
  /* one word for 'the player is busy with an interface' — screens, the
     compact talk panel and the rod shop all freeze the fox */
  const uiUp = G.ui.busy || !!G.talk?.busy || !!G.rodShop?.busy;
  /* the compact panels get first refusal on the keyboard, because while one
     is up the number keys mean "pick this option" and nothing else */
  const talking = G.rodShop?.handleKeys() || G.talk?.handleKeys() || false;
  if (!talking && !cine && !G.ui.busy) G.hotbar?.handleKeys(input);
  const uiAte = talking || G.ui.handleKeys();

  if (cine) {
    if (input.rawPressed('Escape', 'Space', 'KeyE')) G.forge.skip();
  } else if (!uiAte) {
    if (input.rawPressed('KeyQ', 'Tab')) openSatchel();
    if (input.rawPressed('KeyM')) openMap();
    if (input.rawPressed('Escape')) { /* nothing open: ignore */ }
    if (input.rawPressed('KeyE')) doInteract();
    /* ATTACK.
       ------------------------------------------------------------------
       TAP for the three-hit string — left, right, then a straight one down
       the middle that hits hardest. HOLD to wind up a heavy attack: every
       two seconds it reaches the next of three stages and gives one short
       bright pulse, and the longer it is held the harder it lands.

       The two share one button, so the rule has to be unambiguous: holding
       past the charge threshold means you meant to charge, and releasing
       before it means you meant to tap. `releaseAttack` does exactly that
       and hands a stage of 0 back to `attack`, which is an ordinary hit. */
    const canFight = G.player?.weapon && !G.fishing.active && !uiUp && G.state.holding !== 'rod';
    if (canFight) {
      if (input.mouseDown || input.down('KeyF')) {
        const stage = G.player.holdAttack(dt);
        if (stage) {
          audio.ui?.('tick');
          G.fx?.chargePulse(G.player.chargeAnchor(), stage, CHARGE[stage - 1].col);
        }
      } else if (G.player.charging) {
        const sw = G.player.releaseAttack();
        if (sw) audio.swing((G.player.weapon.info?.length || 1) * (1 + sw.charge * 0.4));
      } else if (input.rawPressed('KeyF')) {
        const sw = G.player.attack();
        if (sw) audio.swing(G.player.weapon.info?.length || 1);
      }
    } else if (G.player?.charging) {
      G.player.releaseAttack();
    }

    /* FISHING takes the mouse button while it is up. One control does the
       whole minigame: hold to rise, release to sink, and the same press
       strikes the bite. */
    if (G.fishing.active) {
      if (input.mouseDown) G.fishing.press(); else G.fishing.release();
      if (input.rawPressed('Escape', 'KeyQ')) { G.fishing.cancel(); G.fishRig?.end(); }
    } else if (input.rawPressed('KeyR') && G.state.hasRod) {
      startFishing();
    }
    if (input.rawPressed('KeyV')) {
      rig.applyPreset(rig.presetName === 'vista' ? 'roam' : 'vista');
    }
    if (input.rawPressed('KeyN')) audio.setEnabled(!audio.enabled);
  }

  /* --- 2. camera ------------------------------------------------------- */
  const look = input.lookDelta();
  if (!cine) rig.look(look.x, look.y);
  if (input.mouse.wheel && !cine) rig.zoom(input.mouse.wheel);
  if (uiUp || cine) rig.settleTargets();

  const P = G.player;
  const ax = cine ? { x: 0, y: 0 } : input.moveAxis();
  const mv = rig.moveVector(ax.x, ax.y);
  const idle = !uiUp && !cine && ax.x === 0 && ax.y === 0 && !input.lookActive;

  /* --- 3. player -------------------------------------------------------- */
  P.update(dt, mv, {
    run: input.down('ShiftLeft', 'ShiftRight'),
    /* HELD, NOT TAPPED, WHILE SWIMMING. On land a jump is an event and
       one press is one jump; in water the same key is "kick for the
       surface" and has to be holdable, or surfacing means mashing. */
    jump: !cine && !uiUp && (P.swimming
      ? input.down('Space')
      : input.rawPressed('Space')),
    dive: !cine && !uiUp && input.down('ControlLeft', 'ControlRight', 'KeyC'),
    frozen: uiUp || cine,
  });

  /* the wake behind a swimming fox */
  if (P.swimming) G.fx?.wake(P.x, P.waterY ?? P.y, P.z, P.speed, dt);
  G.state.stats.walked += Math.hypot(P.vx, P.vz) * dt;

  rig.setFocus(P.x, P.y, P.z);
  rig.setBlockers(G.world.cameraBlockers(P.x, P.z));
  rig.update(dt, { idle });
  /* the director writes the shot AFTER the rig has smoothed, so a cut lands
     on the frame it was asked for rather than a few frames of damping later */
  G.forge?.update(dt);

  /* --- 4. world --------------------------------------------------------- */
  const { sky, env } = G.world.update(dt, P, camera);

  /* --- 5. npcs, crews and the line in the water ------------------------- */
  G.npcs.update(dt, P);
  G.workers.update(dt, P, sky.night);
  G.wildlife.update(dt, P);

  /* a swing that has reached its hit frame startles whatever is in the arc */
  if (P.swingConnects) {
    const sw = P.swing;
    const n = G.workers.strike({ x: P.x, z: P.z, yaw: P.yaw }, sw)
      + G.wildlife.strike({ x: P.x, z: P.z, yaw: P.yaw }, sw);
    if (n) {
      audio.thump?.(0.6 + (sw.charge || 0) * 0.12);
      const f = P.forward;
      G.fx?.hitSpark([P.x + f.x * sw.reach * 0.6, P.y + 0.9, P.z + f.z * sw.reach * 0.6],
        0.7 + (sw.charge || 0) * 0.5 + (sw.combo === 2 ? 0.4 : 0));
    }
  }

  /* the air moving round a sprinting fox */
  G.fx?.sprint(P, dt, P.quad);
  G.fx?.update(dt);

  /* --- HIT FEEDBACK ----------------------------------------------------
     Every creature that has been hit in the last second keeps its bar up;
     the rest have none. Driven from the creature's own `barT` rather than
     from a list the UI maintains, so a creature that despawns mid-fight
     cannot leave a bar floating over empty ground. */
  for (const b of G.wildlife?.list || []) {
    if ((b.barT || 0) <= 0) continue;
    G.cfx?.track(b, [b.x, b.y + (b.spec.size || 0.7) * 1.7, b.z],
      b.hp, b.maxHp ?? b.spec.hp, b.spec.name, b.barT);
  }
  G.cfx?.update(dt);
  G.minimap?.update(dt);
  G.minimap?.show(!uiUp && !cine);

  /* --- WHERE YOU ARE, announced once when you get there ----------------
     Hysteresis, not a bare comparison: the bands are concentric rings and
     walking along one would otherwise fire the title over and over. The
     band has to be held for a couple of seconds before it counts as
     having been entered. */
  {
    const band = dangerBand(P.x, P.z);
    if (band !== G._bandSeen) {
      if (band === G._bandPending) {
        G._bandHold = (G._bandHold || 0) + dt;
        if (G._bandHold > 2.0) {
          G._bandSeen = band;
          G._bandHold = 0;
          if (!cine && !uiUp && G._bandReady) {
            G.ui.region(BAND_NAMES[band], BAND_SUB[band] || '');
          }
          G._bandReady = true;      // the first one is just where you woke up
        }
      } else { G._bandPending = band; G._bandHold = 0; }
    } else { G._bandPending = band; G._bandHold = 0; }
  }

  /* --- THE MAP FILLS IN BY WALKING ------------------------------------
     Revealed here, in the world, rather than when the map is opened: the
     point of the fog is that it is a record of where the player has
     actually been. You can see further from a hilltop in the open than
     from inside a thicket, so the radius follows the canopy. */
  {
    const see = lerp(78, 34, clamp01(env.forest));
    if (G.fog.reveal(P.x, P.z, see) > 0) G.state.explored = G.fog.toJSON();
  }

  G.fishing.update(dt);
  G.fishRig?.update(dt, G.fishing);
  G.fishUI.update(G.fishing);

  /* THE FOX KNOWS IT IS FISHING.
     The animator is told which part of the cast we are in; everything
     else about the pose — the gait, the tail, the breathing — carries on
     underneath it. When there is no line out this is null and the
     animator does not touch the arms at all. */
  P.castPose = G.fishing.active
    ? { t: G.fishing.castT, state: G.fishing.state, pull: G.fishing.holding ? 1 : 0 }
    : null;

  /* --- 6. interaction --------------------------------------------------- */
  G.target = (uiUp || cine) ? null : pickTarget();
  updatePrompt();
  highlightTarget(dt);

  /* --- 7. the tutorial -------------------------------------------------- */
  if (G.quest) {
    G.quest.update(dt);
    G.ui.setObjective(cine ? null : G.quest.objective);
    /* THE OBJECTIVE IS A LIGHT STANDING IN THE WORLD.
       Not an arrow pinned to the edge of the screen that swings round as
       you turn — that follows the player and makes the tutorial feel like
       an instruction. A warm column of light at the place itself is
       somewhere to walk to: you see it, you lose it behind a rise, you
       find it again, and that is navigating rather than obeying.

       The on-screen chevron is kept ONLY for when the objective is a long
       way off and out of sight, where a light on the horizon genuinely
       cannot be seen — and even then it is faint. */
    const mk = G.quest.marker;
    if (mk && !uiUp && !cine) {
      const dx = mk.x - P.x, dz = mk.z - P.z;
      const d = Math.hypot(dx, dz);
      G.fx?.beacon(mk.x, G.world.groundAt(mk.x, mk.z), mk.z, d > 2.5);
      let a = Math.atan2(dx, dz) - rig.yaw;
      while (a > Math.PI) a -= Math.PI * 2;
      while (a < -Math.PI) a += Math.PI * 2;
      G.ui.setGuide(d > 90 ? a : null, d, mk.label || '');
    } else {
      G.fx?.hideBeacon();
      G.ui.setGuide(null);
    }
  }

  /* --- 8. ui, audio, save ----------------------------------------------- */
  G.ui.update(dt);
  G.hotbar?.update(dt);
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
    G.state.questStep = G.quest?.id || null;
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
  /* `input.blocked`, not `G.ui.busy`: ui.busy only knows about the screen
     stack and the dialogue box, so a click anywhere near the compact talk
     panel or the rod shop used to re-capture the mouse underneath them and
     the options stopped being clickable. The claim set knows about all of
     them. */
  if (G.mode === 'play' && !input.blocked && !input.pointerLocked) input.requestLock();
});
addEventListener('keydown', () => audio.unlock(), { once: true });

addEventListener('beforeunload', () => {
  if (G.state && G.player) {
    G.state.pos = [G.player.x, G.player.y, G.player.z, G.player.yaw];
    G.state.dayPhase = G.world.sky.phase;
    G.state.taken = G.world.takenSticks;
    G.state.questStep = G.quest?.id || null;
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
