# DISC MAYHEM! — Build Plan

A cartoonish 3D disc golf game with an 18-hole procedurally generated course,
online multiplayer, character customization, and power-up discs (Blade & Bomb).
Throws are performed with a real mouse *flick* — flick speed = throw power,
flick curve = hyzer/anhyzer curve.

## Tech stack (Steam-ready path)

- **Client:** Three.js (ES modules, no build step), toon-shaded procedural assets
- **Server:** Node.js + `ws` WebSocket server (also serves the client statically)
- **Desktop/Steam:** Electron wrapper + `steamworks.js` added at packaging time
  (the game is plain web tech, so wrapping is a thin final step)
- One command to run: `npm start` → http://localhost:3000

## Game design

- **Format: simultaneous race golf.** Everyone in a room plays the same 18 holes
  at the same time. Ranking = fewest strokes, ties broken by total time.
  This is why *both time and speed matter*: your flick speed powers the throw,
  and the clock runs while you play — and it lets opponents blade/bomb each other.
- **Flick throw:** hold left mouse, flick, release. Flick speed → power.
  Curvature of your flick → hyzer/anhyzer (disc curves left/right).
  Aim relative to camera; right-drag orbits, wheel zooms.
- **Discs:** Driver / Midrange / Putter, plus power discs:
  - **Blade** (2 charges/round): hit an opponent → cartoon poof "kill", they
    respawn at their lie with +1 penalty stroke.
  - **Bomb** (2 charges/round): explodes on landing, knocks nearby opponents'
    discs flying and flattens trees in the blast radius for a while.
- **Course:** 18 holes generated from a seed (par 3/4/5 mix, doglegs, trees,
  water hazards). The room's seed is shared so all players see the same course.
- **Movement:** after a throw your character auto-runs to the disc (~6 m/s),
  so the clock pressure is real.
- **Customization:** body color, hat, eyes, disc trail color, name. Saved
  locally, synced to other players in multiplayer.

## Architecture & module ownership

| Module | Owner (sub-agent) | Files |
|---|---|---|
| Contracts & shared code | lead (me) | `DESIGN.md`, `shared/*`, `client/index.html`, `package.json` |
| Game engine | ENGINE agent | `client/src/engine/` — physics, flick input, camera, game controller |
| Modeling / graphics | MODELS agent | `client/src/models/` — characters, discs, effects, toon materials |
| Map design | COURSE agent | `client/src/course/` — 18-hole generator + renderer |
| Networking | NET agent | `server/` + `client/src/net/` — rooms, relay, scoring |
| UI / HUD | UI agent | `client/src/ui/` + `client/style.css` — menus, lobby, HUD, scorecard |
| Integration | lead (me) | `client/main.js` — wires everything, solo + multiplayer glue |

All inter-module interfaces are pinned in `DESIGN.md` before agents start, so
the five agents can work in parallel without colliding.

## Milestones

1. ✅ Contracts + scaffolding (`DESIGN.md`, `shared/`, `index.html`)
2. ✅ Sub-agents built models/net/ui/course-generator in parallel (engine +
   course renderer finished by the lead after the agents hit a session limit)
3. ✅ Integration: `main.js` — solo rounds + full multiplayer glue
4. ✅ Test pass: physics unit-tested in Node (driver ≈121m, basket catch,
   tree BONK, blade kills); headless-browser smoke test of solo round and a
   2-player online match (room code, lobby, shared seed, live standings)
5. ✅ Electron wrapper (`electron/main.cjs`) — `npm run app`
6. (Later, for Steam) `electron-builder` installer, steamworks.js achievements,
   $100 Steamworks fee, store page

## Steam notes (future)

- Electron is a proven Steam path (Vampire Survivors, CrossCode shipped web-tech).
- `steamworks.js` gives achievements/lobbies/rich presence from Node.
- Multiplayer beyond LAN/localhost needs a hosted relay server (any cheap VPS
  runs `server/index.js`) — or Steam P2P later.
