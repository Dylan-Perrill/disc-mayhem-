// client/main.js — DISC MAYHEM! integration layer (lead).
// Wires course + engine + models + ui + net into the actual game.

import * as THREE from 'three';
import { generateCourse } from './src/course/generator.js';
import { buildCourseScene } from './src/course/render.js';
import { FlickInput } from './src/engine/input.js';
import { FollowCamera } from './src/engine/camera.js';
import { GameController } from './src/engine/gameController.js';
import { createThrow, stepDisc } from './src/engine/physics.js';
import { createCharacter } from './src/models/character.js';
import { createDiscVisual } from './src/models/discs.js';
import { createEffects } from './src/models/effects.js';
import { createUI } from './src/ui/ui.js';
import { createAudio } from './src/audio/audio.js';
import { NetClient } from './src/net/client.js';
import {
  DEFAULT_CUSTOMIZATION,
  BOMB_TREE_FLATTEN_MS,
  HOLE_COUNT,
} from '../shared/constants.js';

const STORAGE_KEY = 'discMayhem.customization';
const MENU_SEED = 0xd15c601f;

// ---------------------------------------------------------------- boot

const canvas = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
renderer.outputColorSpace = THREE.SRGBColorSpace;

const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 1200);
function resize() {
  renderer.setSize(window.innerWidth, window.innerHeight);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

const ui = createUI(document.getElementById('ui'));
const audio = createAudio();
audio.mountToggle(document.body);
const followCam = new FollowCamera(camera, canvas);
const flickInput = new FlickInput(canvas);

// Browsers block audio until a user gesture; resume + start menu music on the
// first interaction, and turn any button press into a UI click sound.
let audioStarted = false;
function kickAudio() {
  audio.unlock();
  if (!audioStarted) {
    audioStarted = true;
    audio.playMusic(uiMode === 'game' ? 'game' : 'menu');
  }
}
window.addEventListener('pointerdown', kickAudio, { capture: true });
window.addEventListener('keydown', kickAudio, { capture: true });
document.addEventListener('click', (e) => {
  if (e.target.closest('button:not(.audio-toggle)')) audio.sfx.click();
}, { capture: true });

let customization = loadCustomization();
let uiMode = 'menu'; // menu | customize | lobby | game | results
let net = null;
let lastRoom = null; // {code, players, hostId}
let game = null;

function loadCustomization() {
  try {
    return { ...DEFAULT_CUSTOMIZATION, ...JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') };
  } catch {
    return { ...DEFAULT_CUSTOMIZATION };
  }
}

function saveCustomization() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(customization));
  } catch { /* private mode etc. — fine */ }
}

function makeEnvironment(scene) {
  scene.background = new THREE.Color(0x8fd3ff);
  scene.fog = new THREE.Fog(0x8fd3ff, 130, 460);
  scene.add(new THREE.HemisphereLight(0xcfeaff, 0x4f8a43, 1.15));
  const sun = new THREE.DirectionalLight(0xfff3d6, 1.6);
  sun.position.set(0.6, 1, 0.35).multiplyScalar(300);
  scene.add(sun);
}

// ------------------------------------------------------- menu backdrop

const menuWorld = (() => {
  const course = generateCourse(MENU_SEED);
  const scene = new THREE.Scene();
  makeEnvironment(scene);
  const courseScene = buildCourseScene(course);
  scene.add(courseScene.group);

  const rig = createCharacter(customization);
  rig.nameLabel.visible = false;
  const tee = course.holes[0].tee;
  rig.group.position.set(tee.x, course.heightAt(tee.x, tee.z), tee.z);
  scene.add(rig.group);

  return { course, scene, courseScene, rig, t: 0 };
})();

function updateMenuWorld(dt) {
  menuWorld.t += dt;
  menuWorld.courseScene.update(dt);
  menuWorld.rig.update(dt);
  const c = { x: menuWorld.course.worldSize.w / 2, z: menuWorld.course.worldSize.d / 2 };

  if (uiMode === 'customize') {
    // close-up: slowly spin the character
    menuWorld.rig.group.rotation.y += dt * 0.6;
    const p = menuWorld.rig.group.position;
    camera.position.set(p.x + Math.sin(0.4) * 3.4, p.y + 1.5, p.z + Math.cos(0.4) * 3.4);
    camera.lookAt(p.x, p.y + 1.0, p.z);
  } else {
    // slow aerial flyover of the demo course
    const a = menuWorld.t * 0.045;
    camera.position.set(c.x + Math.sin(a) * 260, 110, c.z + Math.cos(a) * 260);
    camera.lookAt(c.x, 0, c.z);
  }
}

// ------------------------------------------------------------ helpers

function scoreName(strokes, par) {
  if (strokes === 1) return 'ACE!!!';
  const d = strokes - par;
  if (d <= -3) return 'ALBATROSS!';
  if (d === -2) return 'EAGLE!';
  if (d === -1) return 'BIRDIE!';
  if (d === 0) return 'PAR';
  if (d === 1) return 'BOGEY';
  if (d === 2) return 'DOUBLE BOGEY';
  return '+' + d;
}

// ms -> "m:ss" (matches ui/util.js fmtTime; kept local so main.js stays out of UI internals)
function mmss(ms) {
  const total = Math.max(0, Math.floor((Number(ms) || 0) / 1000));
  return Math.floor(total / 60) + ':' + String(total % 60).padStart(2, '0');
}

function profileOf(id) {
  const p = lastRoom?.players?.find((pl) => pl.id === id);
  return { ...DEFAULT_CUSTOMIZATION, ...(p?.profile || {}) };
}

function randomSeed() {
  return (Math.random() * 0xffffffff) >>> 0;
}

// ------------------------------------------------------------- game

function destroyGame() {
  if (!game) return;
  audio.flightStop();
  flickInput.disable();
  if (game.stateInterval) clearInterval(game.stateInterval);
  for (const t of game.timers) clearTimeout(t);
  for (const [, r] of game.remotes) r.rig.group.removeFromParent();
  game = null;
  ui.hud.setStandings([]);
  ui.hud.setPower(null);
}

function startGame(seed, multi) {
  destroyGame();

  const course = generateCourse(seed >>> 0);
  const scene = new THREE.Scene();
  makeEnvironment(scene);
  const courseScene = buildCourseScene(course);
  scene.add(courseScene.group);
  const effects = createEffects(scene);

  const rig = createCharacter(customization);
  rig.nameLabel.visible = false; // don't hover your own name in your face
  scene.add(rig.group);

  followCam.setTerrain(course.heightAt);

  const gc = new GameController({
    scene,
    course,
    courseScene,
    playerRig: rig,
    discFactory: (type) => createDiscVisual(type, customization.trail),
    effects,
    camera: followCam,
    input: flickInput,
  });

  game = {
    course,
    scene,
    courseScene,
    effects,
    rig,
    gc,
    multi,
    remotes: new Map(), // id -> {rig, profile, target}
    remoteDiscs: [],    // {disc, visual, doneAt}
    timers: new Set(),
    scores: null,       // latest S_SCORE payload
    soloCard: { holes: course.holes.map((h) => ({ par: h.par, strokes: null })) },
    localDone: false,
    resultsShown: false,
    standingsAcc: 0,
    stateInterval: null,
    pendingOwnScorecardHole: null, // holeIndex we just holed; shows our scorecard on the next S_SCORE
  };

  wireGameEvents();
  ui.showHUD(gc.bag.map((s) => ({ ...s })));
  uiMode = 'game';
  audio.playMusic('game');
  gc.startRound(0);
  ui.hud.setBag(gc.bag);

  if (multi && net) {
    game.stateInterval = setInterval(() => {
      if (game && net) net.sendState(gc.getPublicState());
    }, 100);
  }
}

function later(fn, ms) {
  if (!game) return;
  const g = game;
  const t = setTimeout(() => {
    g.timers.delete(t);
    if (game === g) fn();
  }, ms);
  g.timers.add(t);
}

function wireGameEvents() {
  const { gc } = game;

  gc.on('hole-start', ({ holeIndex, par }) => {
    ui.hud.setHole(holeIndex, par);
    ui.hud.setStrokes(0, gc.totalStrokes);
    ui.hud.showMessage(`HOLE ${holeIndex + 1} — PAR ${par}`, 1600);
    audio.sfx.holeStart();
  });

  gc.on('stroke', ({ holeStrokes, totalStrokes }) => ui.hud.setStrokes(holeStrokes, totalStrokes));
  gc.on('aim', ({ power }) => ui.hud.setPower(power));
  gc.on('bag-change', () => ui.hud.setBag(gc.bag));

  gc.on('throw', (payload) => {
    audio.sfx.throw(payload.throwParams?.power);
    if (game.multi && net) net.sendThrow(payload);
  });

  gc.on('disc-event', ({ kind }) => {
    if (kind === 'treeHit') { ui.hud.showMessage('BONK!', 800); audio.sfx.bonk(); }
    if (kind === 'water') { ui.hud.showMessage('SPLASH! +1', 1300); audio.sfx.splash(); }
    if (kind === 'chains') audio.sfx.chains();
    if (kind === 'landed') audio.sfx.land();
  });

  gc.on('knocked-back', () => audio.sfx.knockback());

  gc.on('opponent-hit', ({ playerId, discType }) => {
    if (discType !== 'blade') return;
    const victim = game.remotes.get(playerId);
    const name = victim ? victim.profile.name : 'someone';
    ui.hud.showMessage(`KILLED ${name}!`, 1600);
    audio.sfx.bladeKill();
    if (victim) {
      game.effects.poof(victim.rig.group.position);
      victim.rig.poof();
      later(() => victim.rig.unpoof(), 1600);
    }
    if (game.multi && net) net.sendEvent('kill', { victimId: playerId });
  });

  gc.on('bomb-landed', ({ pos, radius }) => {
    audio.sfx.bomb();
    applyBombWorld(pos, radius);
    if (game.multi && net) net.sendEvent('bomb', { pos, radius });
  });

  gc.on('holed', ({ holeIndex, strokes, timeMs }) => {
    const par = game.course.holes[holeIndex].par;
    ui.hud.showMessage(scoreName(strokes, par), 2000);
    audio.sfx.holed(strokes, par);
    game.soloCard.holes[holeIndex].strokes = strokes;
    if (game.multi && net) {
      net.sendHoleDone(holeIndex, strokes, timeMs);
      // tell the others to banner this finish; remember to show OUR scorecard
      // once the score round-trip reflects this hole.
      net.sendEvent('holed', { holeIndex, strokes, timeMs });
      game.pendingOwnScorecardHole = holeIndex;
    } else {
      ui.showScorecard(game.soloCard);
      later(() => ui.hideScorecard(), 1500);
    }
  });

  gc.on('round-complete', ({ scorecard }) => {
    game.localDone = true;
    if (!game.multi) {
      const totalStrokes = scorecard.reduce((a, h) => a + (h?.strokes || 0), 0);
      const totalTimeMs = scorecard.reduce((a, h) => a + (h?.timeMs || 0), 0);
      uiMode = 'results';
      audio.playMusic('menu');
      ui.showResults([
        { rank: 1, name: customization.name, totalStrokes, totalTimeMs, you: true },
      ]);
    } else {
      ui.hud.showMessage('ROUND DONE! Waiting for others…', 2500);
      maybeShowMultiResults();
    }
  });
}

// bomb effects shared by local + remote bombs
function applyBombWorld(pos, radius, fromRemote = false) {
  if (!game) return;
  if (fromRemote) {
    game.effects.explosion(pos, radius);
    game.gc.applyKnockback(pos, radius);
  }
  for (const t of game.course.trees) {
    const d = Math.hypot(t.x - pos.x, t.z - pos.z);
    if (d > radius) continue;
    game.courseScene.setTreeFlattened(t.id, true);
    game.gc.flattenedTreeIds.add(t.id);
    later(() => {
      game.courseScene.setTreeFlattened(t.id, false);
      game.gc.flattenedTreeIds.delete(t.id);
    }, BOMB_TREE_FLATTEN_MS);
  }
}

// ------------------------------------------------------ remote players

function ensureRemote(id) {
  let r = game.remotes.get(id);
  if (!r) {
    const profile = profileOf(id);
    const rig = createCharacter(profile);
    game.scene.add(rig.group);
    r = { rig, profile, target: null };
    game.remotes.set(id, r);
  }
  return r;
}

function updateRemotes(dt) {
  const list = [];
  for (const [id, r] of game.remotes) {
    if (r.target) {
      const p = r.rig.group.position;
      const k = 1 - Math.exp(-9 * dt);
      p.x += (r.target.pos.x - p.x) * k;
      p.y += (r.target.pos.y - p.y) * k;
      p.z += (r.target.pos.z - p.z) * k;
      let dy = r.target.yaw - r.rig.group.rotation.y;
      while (dy > Math.PI) dy -= Math.PI * 2;
      while (dy < -Math.PI) dy += Math.PI * 2;
      r.rig.group.rotation.y += dy * Math.min(1, dt * 8);
      r.rig.setMoving(r.target.anim === 'run');
    }
    r.rig.update(dt);
    list.push({ id, pos: r.rig.group.position });
  }
  game.gc.setRemotePlayers(list);

  // remote disc sims (visual-only; no basket/no player hits)
  const world = {
    heightAt: game.course.heightAt,
    trees: game.course.trees,
    waters: game.course.waters,
    basket: null,
    players: [],
    flattenedTreeIds: game.gc.flattenedTreeIds,
  };
  for (let i = game.remoteDiscs.length - 1; i >= 0; i--) {
    const rd = game.remoteDiscs[i];
    stepDisc(rd.disc, dt, world);
    rd.visual.update(dt, rd.disc);
    if (rd.disc.state !== 'flying' && rd.disc.state !== 'sliding') {
      if (!rd.doneAt) rd.doneAt = performance.now();
      if (performance.now() - rd.doneAt > 2500) {
        rd.visual.dispose();
        game.remoteDiscs.splice(i, 1);
      }
    }
  }
}

function buildStandings() {
  const rows = [];
  rows.push({
    name: customization.name,
    thru: game.gc.scorecard.filter(Boolean).length,
    strokes: game.gc.totalStrokes,
    you: true,
  });
  for (const [id, r] of game.remotes) {
    rows.push({
      name: r.profile.name,
      thru: r.target ? r.target.thru || 0 : 0,
      strokes: r.target ? r.target.strokes || 0 : 0,
      you: false,
    });
  }
  rows.sort((a, b) => a.strokes - b.strokes || b.thru - a.thru);
  return rows;
}

function multiScorecardData() {
  if (!game?.scores) return null;
  return {
    pars: game.course.holes.map((h) => h.par),
    players: Object.entries(game.scores).map(([id, s]) => ({
      name: s.name,
      strokes: (s.holes || []).map((h) => (h ? h.strokes : null)),
      you: net && id === net.id,
    })),
  };
}

function maybeShowMultiResults() {
  if (!game || game.resultsShown || !game.localDone || !game.scores) return;
  const entries = Object.entries(game.scores);
  if (entries.length === 0) return;
  const allDone = entries.every(
    ([, s]) => (s.holes || []).filter(Boolean).length >= HOLE_COUNT
  );
  if (!allDone) return;
  game.resultsShown = true;
  const sorted = entries
    .map(([id, s]) => ({
      name: s.name,
      totalStrokes: s.totalStrokes,
      totalTimeMs: s.totalTimeMs,
      you: net && id === net.id,
    }))
    .sort((a, b) => a.totalStrokes - b.totalStrokes || a.totalTimeMs - b.totalTimeMs);
  sorted.forEach((r, i) => (r.rank = i + 1));
  uiMode = 'results';
  audio.playMusic('menu');
  ui.showResults(sorted);
}

// ----------------------------------------------------------- networking

async function ensureNet() {
  if (net) return net;
  const client = new NetClient();
  await client.connect();
  net = client;

  client.on('room', (room) => {
    lastRoom = room;
    if (uiMode === 'menu' || uiMode === 'lobby') {
      uiMode = 'lobby';
      ui.showLobby({ code: room.code, players: room.players, hostId: room.hostId, isHost: client.isHost });
    } else if (uiMode === 'game') {
      // roster change mid-game (someone left) — nothing visual needed here
    }
  });

  client.on('start', ({ seed }) => startGame(seed, true));

  client.on('state', ({ players }) => {
    if (!game) return;
    for (const { id, state } of players) {
      const r = ensureRemote(id);
      if (!r.target) {
        // first state: snap into place
        r.rig.group.position.set(state.pos.x, state.pos.y, state.pos.z);
      }
      r.target = state;
    }
  });

  client.on('throw', ({ id, discType, origin, throwParams }) => {
    if (!game) return;
    const r = ensureRemote(id);
    r.rig.setThrowing();
    const disc = createThrow(discType, origin, throwParams);
    const visual = createDiscVisual(discType, r.profile.trail);
    game.scene.add(visual.group);
    game.remoteDiscs.push({ disc, visual, doneAt: 0 });
  });

  client.on('event', ({ id, kind, data }) => {
    if (!game) return;
    const fromName = game.remotes.get(id)?.profile.name || 'Someone';
    if (kind === 'kill') {
      if (data?.victimId === client.id) {
        if (game.gc.killedByOpponent()) {
          ui.hud.showMessage(`KILLED by ${fromName}! +1`, 2000);
          audio.sfx.death();
        }
      } else {
        const victim = game.remotes.get(data?.victimId);
        if (victim) {
          game.effects.poof(victim.rig.group.position);
          victim.rig.poof();
          later(() => victim.rig.unpoof(), 1600);
        }
        audio.sfx.bladeKill();
        ui.toast(`${fromName} got a kill!`);
      }
    } else if (kind === 'bomb' && data?.pos) {
      audio.sfx.bomb();
      applyBombWorld(data.pos, data.radius || 12, true);
    } else if (kind === 'holed' && data) {
      // another player finished a hole — announce it (the scorecard is theirs alone).
      // Same seeded course, so we know the par locally.
      const par = game.course.holes[data.holeIndex]?.par;
      const label = par != null ? scoreName(data.strokes, par) : `${data.strokes} strokes`;
      ui.hud.showBanner(
        `${fromName} — ${label} on hole ${data.holeIndex + 1} (${data.strokes} strokes, ${mmss(data.timeMs)})`
      );
    }
  });

  client.on('score', ({ scores }) => {
    if (!game) return;
    game.scores = scores;
    // Only the player who just holed sees the scorecard; others got a banner.
    // Wait until the fresh scores actually reflect our hole so the card isn't stale.
    const myId = net && net.id;
    const pend = game.pendingOwnScorecardHole;
    if (pend != null && myId && scores[myId]?.holes?.[pend]) {
      game.pendingOwnScorecardHole = null;
      const card = multiScorecardData();
      if (card) {
        ui.showScorecard(card);
        later(() => ui.hideScorecard(), 1800);
      }
    }
    maybeShowMultiResults();
  });

  client.on('player-left', ({ id }) => {
    if (!game) return;
    const r = game.remotes.get(id);
    if (r) {
      ui.toast(`${r.profile.name} left`);
      r.rig.group.removeFromParent();
      game.remotes.delete(id);
    }
  });

  client.on('error', ({ message }) => ui.toast(message));

  client.on('disconnect', () => {
    ui.toast('Disconnected from server');
    net = null;
    if (game?.multi && game.stateInterval) clearInterval(game.stateInterval);
  });

  return client;
}

// ------------------------------------------------------------ UI events

ui.on('play-solo', () => startGame(randomSeed(), false));

ui.on('host-game', async () => {
  try {
    const c = await ensureNet();
    c.createRoom(customization);
  } catch {
    ui.toast('Could not reach the server');
  }
});

ui.on('join-game', async ({ code }) => {
  try {
    const c = await ensureNet();
    c.joinRoom(code, customization);
  } catch {
    ui.toast('Could not reach the server');
  }
});

ui.on('start-match', () => net?.start());

ui.on('customize-change', ({ customization: c }) => {
  customization = { ...customization, ...c };
  saveCustomization();
  menuWorld.rig.applyCustomization(customization);
});

ui.on('select-disc', ({ type }) => {
  if (!game) return;
  const slot = game.gc.bag.find((s) => s.type === type);
  const usable = slot && (slot.charges === null || slot.charges > 0);
  game.gc.selectDisc(type);
  ui.hud.setBag(game.gc.bag);
  if (usable && (type === 'blade' || type === 'bomb')) audio.sfx.power(type);
  else if (usable) audio.sfx.click();
});

ui.on('back-to-menu', () => {
  net?.leaveRoom();
  destroyGame();
  uiMode = 'menu';
  ui.showMenu();
  audio.playMusic('menu');
});

// ui.js's Customize button calls nav.toCustomize internally; track mode by
// watching which screen is active via these two events:
const origShowCustomize = ui.showCustomize.bind(ui);
ui.showCustomize = (cur) => {
  uiMode = 'customize';
  origShowCustomize(cur);
};

// Customize screen opens through the menu button (internal nav) — detect via a
// small poll of the DOM class instead of patching menus.js:
setInterval(() => {
  if (uiMode === 'game' || uiMode === 'results' || uiMode === 'lobby') return;
  const customizeActive = document.querySelector('.screen-customize.active, .screen.customize.active');
  uiMode = customizeActive ? 'customize' : 'menu';
}, 250);

// ------------------------------------------------------------ main loop

const clock = new THREE.Clock();

function frame() {
  requestAnimationFrame(frame);
  const dt = Math.min(clock.getDelta(), 0.1);

  if (game) {
    game.gc.update(dt);
    game.courseScene.update(dt);
    game.effects.update(dt);
    followCam.update(dt);

    // sustained "disc cutting through the air" ambience for your own throw
    const ad = game.gc.activeDisc;
    if (ad) {
      audio.flightStart(ad.type);
      audio.flightUpdate(ad.speed, ad.height);
    } else {
      audio.flightStop();
    }
    if (game.multi) {
      updateRemotes(dt);
      game.standingsAcc += dt;
      if (game.standingsAcc > 0.5) {
        game.standingsAcc = 0;
        ui.hud.setStandings(buildStandings());
      }
    }
    if (uiMode === 'game') ui.hud.setTimer(game.gc.holeElapsedMs);
    renderer.render(game.scene, camera);
  } else {
    updateMenuWorld(dt);
    renderer.render(menuWorld.scene, camera);
  }
}

frame();

// tiny debug handle (used by automated smoke tests)
window.__DM = {
  get mode() { return uiMode; },
  get remotes() { return game ? game.remotes.size : -1; },
  get hole() { return game ? game.gc.holeIndex : -1; },
  get netId() { return net ? net.id : null; },
  get audioState() { return audio.ctx ? audio.ctx.state : 'none'; },
  get muted() { return audio.muted; },
};

console.log('%cDISC MAYHEM! ready', 'font-size:16px;font-weight:bold;color:#4dabf7');
