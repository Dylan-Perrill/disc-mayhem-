# DESIGN.md — Module Contracts (READ THIS FIRST)

Every module must follow these contracts exactly. Integration (`client/main.js`)
codes against these signatures.

## Global rules

- **Plain ES modules, no build step, no TypeScript.** Browser-native code.
- Import Three.js as bare specifier: `import * as THREE from 'three';`
  (an import map in `index.html` resolves it). Addons: `three/addons/...`.
- Client code imports shared code via **absolute URL paths**:
  `import { MSG } from '/shared/protocol.js';`
- Server (Node ESM) imports shared code via relative path:
  `import { MSG } from '../shared/protocol.js';`
- `shared/*` files must have **zero imports** so they load in both worlds.
- No dependencies beyond `three` (client) and `ws` (server). No npm installs.
- Units: meters, seconds. +Y is up. The course occupies roughly x,z ∈ [0, 900].
- Art style: bright cartoon. Use `THREE.MeshToonMaterial` (or flat-shaded
  Lambert), chunky low-poly procedural geometry, saturated palette. No external
  asset files — everything generated in code.
- Validate your files with `node --check <file>` (syntax only; bare/absolute
  imports won't resolve in Node — that's expected and fine).
- Own ONLY your assigned files. Never create or edit files outside your module.

## shared/rng.js (written by lead — exists already)

```js
export function hashSeed(str)        // string -> uint32
export function mulberry32(seed)     // uint32 -> () => float in [0,1)
export function randRange(rand, min, max)
export function pick(rand, arr)
```

## shared/constants.js (exists already)

Exports `DISC_TYPES` (driver/midrange/putter/blade/bomb with maxSpeed, glide,
turn, fade, color, power flag, charges, blastRadius), `HOLE_COUNT=18`,
`GRAVITY`, `BASKET_CATCH_RADIUS`, `BASKET_HEIGHT`, `KILL_PENALTY_STROKES`,
`RUN_SPEED`, `DEFAULT_PORT`, `CUSTOMIZATION_OPTIONS`, `DEFAULT_CUSTOMIZATION`.

## shared/protocol.js (exists already)

Exports `MSG` message-type constants. Wire format: JSON `{type, ...payload}`.
See the file for the full list and payload shapes (documented in comments).

---

## client/src/course/ — COURSE agent

### generator.js

```js
export function generateCourse(seed)  // uint32 seed -> CourseData (deterministic!)
```

`CourseData`:
```js
{
  seed,
  worldSize: { w, d },                 // ~900 x 900
  heightAt(x, z) -> y,                 // smooth terrain height, deterministic,
                                       // gentle hills (roughly -3..+8), must be
                                       // cheap to call (used by physics every frame)
  holes: [ HoleData x 18 ],
  trees:  [ { id, x, z, height, trunkRadius, canopyRadius, kind } ], // kind: 'pine'|'round'|'tall'
  waters: [ { x, z, radius } ],        // circular ponds; terrain should dip there
  decor:  [ { x, z, kind, scale } ],   // 'bush'|'rock'|'flower' purely visual
}
```

`HoleData`:
```js
{ index,                // 0-based
  par,                  // 3, 4, or 5 (mix across 18; length-appropriate)
  tee:    {x, y, z},    // y = heightAt(x,z)
  basket: {x, y, z},
  length,               // meters tee->basket along path
  waypoints: [{x, z}]   // dogleg path tee->basket incl. both endpoints
}
```

Layout rules: holes form a loop around the map (tee N+1 within ~40m of basket N);
par 3 ≈ 60–110m, par 4 ≈ 120–180m, par 5 ≈ 190–260m; keep a ~14m-wide corridor
along waypoints mostly clear of trees (fairway); scatter trees densely elsewhere
near fairways, water on 4–6 holes positioned as real hazards. Use ONLY
`shared/rng.js` for randomness.

### render.js

```js
export function buildCourseScene(course) -> {
  group,                       // THREE.Group: terrain, trees, water, baskets, tee pads, decor
  basketByHole,                // Map<holeIndex, THREE.Object3D> (basket root, positioned at hole.basket)
  treeMeshes,                  // Map<treeId, THREE.Object3D>
  setHoleHighlight(index),     // visually marks active hole (glow ring on basket, tee marker)
  setTreeFlattened(treeId, flattened),  // bomb effect: squash tree down / restore
  update(dt),                  // animate water, basket glow, etc.
}
```

Terrain: grid mesh sampled from `heightAt` (~128x128 segments), cartoon green
with color variation; water as translucent blue discs slightly below terrain dip;
baskets look like real disc golf baskets (pole, chains as cones/cylinders, cage).
Skybox/fog handled by integration — don't add lights or sky here.

---

## client/src/engine/ — ENGINE agent

### physics.js

```js
export function createThrow(discTypeKey, origin, throwParams) -> DiscState
// throwParams = { dirAngle (yaw rad, 0 = +Z... use atan2(x,z) convention),
//                 power (0..1), curve (-1..1; + curves right, - curves left),
//                 loft (0..1, optional, default 0.35) }

export function stepDisc(disc, dt, world) -> events[]
// mutates disc. world = { heightAt(x,z), trees, waters, basket: {x,y,z},
//                         players: [{id, pos:{x,y,z}, radius}],   // optional, for blade hits
//                         flattenedTreeIds: Set }
// events: { kind: 'landed' | 'water' | 'treeHit' | 'chains' | 'basket' | 'playerHit', playerId? }
```

`DiscState`: `{ type, pos:{x,y,z}, vel:{x,y,z}, age, state: 'flying'|'stopped'|'inBasket'|'water', spin }`
plus whatever internals you need. Flight model: gravity, air drag, lift (glide),
S-curve turn/fade per disc stats and `curve` input, tree trunk collision
(bounce/drop, skip trees in `flattenedTreeIds`), terrain landing with small
bounce/skid, basket detection (within `BASKET_CATCH_RADIUS` horizontally and
chain height vertically → 'chains' then 'basket' / state 'inBasket'), water →
state 'water'. Emit 'playerHit' when a flying disc passes within `radius` of a
player in `world.players` (don't self-hit: integration filters). Tune so a full
power (1.0) flat driver flies ~110–130m. Export your tuning constants.

### input.js

```js
export class FlickInput {
  constructor(domElement)
  enable() / disable()
  baseAngle = 0          // set by integration each frame to camera yaw
  onAim   = ({active, dirAngle, power, curve}) => {}   // live while dragging
  onThrow = ({dirAngle, power, curve}) => {}           // on release (only if real flick)
}
```

Pointer events on `domElement` (left button). Track the drag trail with
timestamps; on release compute: power from the speed of the last ~120ms of
movement (px/ms, clamped 0..1 — a lazy drag ≈ 0.3, a violent flick ≈ 1.0),
direction from the trail's end velocity direction **relative to screen-up,
rotated by `baseAngle`** (flicking straight up the screen throws toward camera
forward), curve from the signed lateral bow of the trail (a J-shaped flick
curves the disc). Tiny drags (< 30px) cancel. Must not interfere with
right-button camera drags.

### camera.js

```js
export class FollowCamera {
  constructor(camera, domElement)
  setAimView(playerPos, basketPos)   // behind player, looking toward basket (player can orbit)
  followDisc(getDiscPos)             // smooth-chase a flying disc
  followPoint(getPos)                // follow running player
  update(dt)
  get yaw()                          // current view yaw for FlickInput.baseAngle
}
```

Right-mouse-drag orbits (yaw + a little pitch), wheel zooms (4–30m). Smooth
lerped transitions between modes. Never goes below terrain (accept a
`heightAt` via `setTerrain(fn)` ).

### gameController.js

Orchestrates ONE local player's round. **Must not import models/ or ui/** —
those arrive via constructor injection.

```js
export class GameController {
  constructor({ scene, course, courseScene, playerRig, discFactory, effects, camera, input })
  // playerRig: CharacterRig (see models contract)
  // discFactory: (typeKey) => DiscVisual (see models contract)
  // effects: Effects (see models contract)
  on(event, fn) / off(event, fn)     // implement a tiny emitter
  startRound(startHole = 0)
  selectDisc(typeKey)                 // ignores power discs with 0 charges left
  setRemotePlayers(list)              // [{id, pos:{x,y,z}}] for blade hit detection
  applyKnockback(fromPos, radius)     // bomb landed near us: scatter our stopped disc / stagger player
  killedByOpponent()                  // blade hit us: poof, +KILL_PENALTY_STROKES, respawn at lie
  update(dt)
  getPublicState() -> { pos, yaw, anim:'idle'|'run', holeIndex, strokes, discPos|null, discType|null }
  bag -> [{ type, charges, selected }]
}
```

Events emitted: `hole-start {holeIndex, par}`, `aim {power, curve}` (live),
`throw {discType, throwParams}`, `stroke {holeStrokes, totalStrokes}`,
`disc-event {kind, pos}` (treeHit/chains/water...), `holed {holeIndex, strokes,
timeMs}`, `water-penalty`, `power-used {type, chargesLeft}`,
`opponent-hit {playerId, discType}` (local blade hit a remote player),
`bomb-landed {pos, radius}`, `round-complete {scorecard}`.

Flow per hole: place player at tee → aim mode (input enabled, camera aim view)
→ throw → camera follows disc, sim via `stepDisc` → landed → player auto-runs
to disc at `RUN_SPEED` (camera follows) → repeat. 'water' → +1 stroke, replay
from previous lie. 'basket' → confetti, `holed`, advance. Track per-hole strokes
and elapsed ms. Blade kill of the LOCAL player is applied by integration via
`gameController.killedByOpponent()` → poof, respawn at current lie,
+`KILL_PENALTY_STROKES`.

---

## client/src/models/ — MODELS agent

### materials.js
```js
export function toonMaterial(color, opts = {}) // shared 3-step gradient map
export const palette = { grassGreen, skyBlue, ... }  // bright cartoon hex palette
```

### character.js
```js
export function createCharacter(customization) -> CharacterRig
// customization = { name, bodyColor, hat, eyes, trail }  (see CUSTOMIZATION_OPTIONS)
CharacterRig = {
  group,                       // THREE.Group, feet at y=0, ~1.7m tall
  setMoving(bool),             // toggles run animation (procedural bob/lean/arm swing)
  setThrowing(),               // quick throw wind-up pose, auto-returns
  update(dt),
  poof(),                      // cartoon death: squash + puff, hides body; returns Promise
  unpoof(),                    // reappear (respawn)
  applyCustomization(c),
  nameLabel,                   // floating name sprite above head (toggleable .visible)
}
```
Style: chunky cartoon capsule body, big head, dot/oval eyes per `eyes` option,
hats: none/cap/tophat/beanie/crown. Procedural geometry only.

### discs.js
```js
export function createDiscVisual(typeKey, trailColor) -> DiscVisual
DiscVisual = {
  group,                          // disc mesh, origin at disc center
  update(dt, discState | null),   // position from discState.pos, spin fast while
                                  // 'flying', wobble slightly; ribbon/particle trail
                                  // in trailColor while flying
  dispose(),
}
```
Blade disc: menacing red with visible spinning blade edge. Bomb disc: round
black bomb with fuse spark particle. Standard discs: bright with a white rim.

### effects.js
```js
export function createEffects(scene) -> Effects
Effects = {
  explosion(pos, radius),   // cartoon boom: sphere flash, smoke puffs, screen-shakeable
  poof(pos),                // white cartoon smoke puff (kill)
  confetti(pos),            // holed-out celebration burst
  splash(pos),              // water rings + droplets
  chainsHit(pos),           // small sparkle at basket
  update(dt),
}
```
All particles procedural (instanced planes/spheres), self-cleaning.

---

## client/src/net/ + server/ — NET agent

### server/index.js
- `node server/index.js` starts ONE server on `DEFAULT_PORT` (env PORT override):
  - HTTP: serves `/client/*`, `/shared/*`, `/node_modules/three/*` statically
    (correct MIME for .js/.html/.css; `/` → `/client/index.html`; block `..`).
  - WebSocket (`ws` package) on the same HTTP server.
- Rooms: 4-letter codes, max 8 players, host = creator. Room has `seed`
  (random uint32). Host sends `C_START` → broadcast `S_START {seed, startTime}`.
- Relay: `C_STATE` (~10Hz per client) → rebroadcast batched as `S_STATE` to
  others in room; `C_THROW`/`C_EVENT` relayed as `S_THROW`/`S_EVENT` with
  sender id attached. `C_HOLE_DONE {holeIndex, strokes, timeMs}` → server
  stores scorecard, broadcasts `S_SCORE` with all players' cards. Disconnect →
  `S_PLAYER_LEFT`, empty rooms deleted. Heartbeat ping every 20s.

### server/rooms.js — room bookkeeping (codes, membership, scorecards).

### client/src/net/client.js
```js
export class NetClient {
  connect(url) -> Promise          // ws(s)://host — derive from location by default
  createRoom(profile) / joinRoom(code, profile)   // profile = customization
  leaveRoom()
  start()                           // host only
  sendState(state) / sendThrow(data) / sendEvent(kind, data)
  sendHoleDone(holeIndex, strokes, timeMs)
  on(event, fn): 'room' {code, players, hostId} | 'start' {seed, startTime} |
     'state' {players} | 'throw' {id, ...} | 'event' {id, kind, data} |
     'score' {scores} | 'player-left' {id} | 'error' {message} | 'disconnect'
  get id / get isHost
}
```
No three.js imports in net code. Server must be robust to malformed JSON.

---

## client/src/ui/ — UI agent (also owns client/style.css)

```js
// client/src/ui/ui.js
export function createUI(root) -> UI    // root = #ui div; UI builds all DOM inside
UI = {
  on(event, fn),
  // events emitted: 'play-solo', 'host-game', 'join-game' {code}, 'start-match',
  //   'customize-change' {customization}, 'select-disc' {type}, 'back-to-menu'
  showMenu(),                         // title screen: DISC MAYHEM! + buttons
  showCustomize(current),             // character options from CUSTOMIZATION_OPTIONS
  showLobby({code, players, isHost}), updateLobby(players),
  showHUD(bag),                       // in-game overlay
  hud: {
    setHole(holeIndex, par), setStrokes(hole, total), setTimer(ms),
    setBag(bag), setPower(p),         // live flick power bar (0..1), hide on null
    showMessage(text, ms),            // big center toast: "BIRDIE!", "KILLED Bob!"
    setStandings(rows),               // mini multiplayer leaderboard, [] hides
  },
  showScorecard(data),                // between holes / Tab key; data = {holes:[{par,strokes}], players?}
  hideScorecard(),
  showResults(standings),             // end of round: rank, name, strokes, time
  toast(text),
}
```
Also: number keys 1–5 → emit 'select-disc'; Tab holds scorecard. Style
(client/style.css): chunky cartoon UI — rounded corners, thick borders, bright
colors, big playful font (system fonts / CSS only, no asset downloads). HUD must
not block mouse events on the canvas except over actual widgets
(pointer-events: none on overlay, auto on widgets). No three.js imports.

---

## Integration event flow (lead writes main.js — for reference)

- Solo: menu → customize → GameController round, UI glued to events.
- Multiplayer: host/join lobby → S_START seeds `generateCourse` → everyone plays
  simultaneously. Local GameController events → NetClient sends; remote: S_STATE
  drives remote CharacterRigs, S_THROW spawns visual-only disc sims, S_EVENT
  kill → if victim is me: `gameController.killedByOpponent()`; bomb → all
  clients `applyKnockback` + flatten trees + explosion fx. Ranking: strokes,
  tie → time.
