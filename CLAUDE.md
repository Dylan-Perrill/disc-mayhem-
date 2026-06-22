# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

DISC MAYHEM! is a cartoon 3D disc golf game: Three.js client (no build step),
a Node `ws` multiplayer server, and an Electron desktop wrapper. The whole
thing is built for an eventual Steam release (see [README.md](README.md) and
[PLAN.md](PLAN.md) for that path).

## Commands

```bash
npm install            # only deps are `three` (client) and `ws` (server)
npm start              # node server/index.js → http://localhost:3000
npm run app            # electron . → boots the server in-process on port 37425 and opens a window
PORT=3000 node server/index.js   # explicit port (e.g. for a public/VPS deploy)
```

There is **no build, lint, or test tooling** and no test runner in `package.json`.
Verification is manual:

- **Syntax check any file:** `node --check <file>`. Bare (`three`) and absolute
  (`/shared/...`) imports won't resolve in Node — that's expected; `--check` only
  validates syntax.
- **Physics headlessly in Node:** [client/src/engine/physics.js](client/src/engine/physics.js)
  is pure math on plain `{x,y,z}` objects and deliberately uses *relative*
  shared imports, so you can `import` it directly in a Node script to test
  flight (e.g. a full-power driver should fly ~110–130m). Most other client
  files use absolute `/shared/...` / `/client/...` URLs and only run in a browser.
- **Browser smoke test:** drive Edge with puppeteer-core
  (`C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe`,
  add `--enable-unsafe-swiftshader` for WebGL). `window.__DM` (defined at the
  bottom of [client/main.js](client/main.js)) exposes `mode`, `remotes`,
  `hole`, `netId`, `audioState`, `muted` for assertions.

## Architecture

**[DESIGN.md](DESIGN.md) is the source of truth.** It pins the exact public
signature of every module (the "contracts"). The five feature modules were each
built by a separate sub-agent against those contracts, and `client/main.js` is
coded against them. **When you change a module's public API, update DESIGN.md
and every caller in the same pass** — keeping the contracts in sync is the whole
point of the layout.

### Layout & ownership

```
shared/      constants.js, rng.js, protocol.js — MUST have zero imports (load in browser AND Node)
client/
  main.js    integration layer: the ONLY file that imports across modules and wires them together
  src/
    course/  generator.js (deterministic 18-hole gen from a seed) + render.js (cartoon scene)
    engine/  physics.js, input.js (mouse-flick), camera.js, gameController.js, emitter.js
    models/  character.js, discs.js, effects.js, materials.js — all procedural geometry, no asset files
    net/     client.js — WebSocket client (no three.js imports)
    audio/   audio.js — Web Audio procedural music + SFX (not in DESIGN.md; no asset files)
    ui/      ui.js + hud/menus/scorecard/util — vanilla DOM, no three.js imports
server/      index.js (HTTP static + ws on one port) + rooms.js (room bookkeeping)
electron/    main.cjs — desktop wrapper (CommonJS)
```

`gameController.js` orchestrates one local player's round and **must not import
`models/` or `ui/`** — those arrive via constructor injection from `main.js`.

### Import conventions (no bundler — these are load-bearing)

- **No build step.** The browser runs ES modules directly; an import map in
  [client/index.html](client/index.html) resolves `three` → the file in
  `node_modules`. Adding a new npm dependency means it must also be served and
  mapped — prefer writing things procedurally instead.
- **Client → shared:** absolute URL, `import { MSG } from '/shared/protocol.js';`
- **Server → shared:** relative, `import { MSG } from '../shared/protocol.js';`
- **Exception:** `physics.js` uses relative shared imports (`../../../shared/...`)
  on purpose, so the same flight sim runs in Node and in the browser (remote-disc
  sims reuse it). Don't "fix" it to an absolute path.
- The server only serves `/client/`, `/shared/`, and `/node_modules/three/`
  (see `ALLOWED_PREFIXES` in [server/index.js](server/index.js)). Files outside
  those prefixes are 404, regardless of where they live on disk.

### Determinism

The course is generated from a uint32 seed via `generateCourse(seed)`. In
multiplayer the host's `S_START` seed is shared so every client builds the
identical course. **All randomness in course generation must come from
`shared/rng.js`** (`mulberry32`/`hashSeed`) — never `Math.random()` there.
`Math.random()` is fine for non-deterministic things like picking a solo seed.

### Multiplayer model

One Node process is both the static file server and the `ws` server. The server
is a **dumb relay with light bookkeeping** — it does not simulate the game:

- Rooms have 4-letter codes, max 8 players, host = creator. Host's `C_START`
  picks the seed and broadcasts `S_START`.
- `C_STATE` (~10Hz/client) is batched and rebroadcast as `S_STATE` (each client
  gets everyone's state but their own). `C_THROW`/`C_EVENT` relay as
  `S_THROW`/`S_EVENT` with the sender id attached. `C_HOLE_DONE` → server stores
  the scorecard and broadcasts `S_SCORE`.
- **Authority lives on the acting client.** A blade kill / bomb is decided by the
  thrower, sent as an event, and applied by the victim/others. If the local
  player is the victim of a kill event, `main.js` calls
  `gameController.killedByOpponent()`. Remote thrown discs are re-simulated
  *visually only* on each client (no basket, no hits) by feeding `S_THROW` back
  into `createThrow`/`stepDisc`.
- Wire format is JSON `{type, ...payload}`; `MSG` type constants and payload
  shapes are in [shared/protocol.js](shared/protocol.js). The server must stay
  robust to malformed JSON (it already ignores unparseable / typeless messages).

### Conventions

- Units are meters/seconds, +Y up; the course occupies roughly x,z ∈ [0, 900].
- Art is all-procedural cartoon: `THREE.MeshToonMaterial` / flat Lambert, chunky
  low-poly geometry, saturated palette — **no external asset files** (same for
  audio, which is synthesized in `audio.js`).
- Physics tuning lives in the exported `TUNING` object in `physics.js` (the
  `blade` disc is intentionally launched nearly flat so it can hit opponents at
  body height).
