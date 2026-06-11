# 🥏 DISC MAYHEM!

A cartoon 3D disc golf game with real mouse-flick throws, an 18-hole
procedurally generated course, online multiplayer, character customization,
and power-up discs (a killer **Blade** and an explosive **Bomb**).

![tech](https://img.shields.io/badge/tech-Three.js%20%2B%20Node%20%2B%20ws-blue)

## Play

```bash
npm install
npm start          # then open http://localhost:3000
```

Or as a desktop app (Electron):

```bash
npm run app
```

## How to play

| Control | Action |
|---|---|
| **Hold LEFT mouse + flick** | Throw — *flick speed = power, a curved flick bends the shot (hyzer/anhyzer)* |
| Right-drag | Look around |
| Mouse wheel | Zoom |
| 1–5 | Select disc |
| Tab (hold) | Scorecard |

- **Format:** simultaneous race golf. Lowest strokes wins; ties broken by
  total time — so both your flick speed **and** the clock matter.
- **Discs:** Driver (long, S-curves), Midrange, Putter, plus per-round
  power discs:
  - **Blade ×2** — flies flat and fast; hit an opponent and they poof,
    respawn at their lie with a +1 penalty stroke.
  - **Bomb ×2** — explodes on landing: knocks nearby opponents' lies flying
    and flattens trees for 12 seconds (new sightlines!).
- **Hazards:** water (+1, rethrow), trees (BONK).
- After each throw your golfer auto-runs to the disc — the hole timer keeps
  ticking the whole time.

## Multiplayer

One player clicks **Host Online Game** and shares the 4-letter room code;
up to 8 players join, the host starts. Everyone plays the same seeded course
at the same time. To play over the internet, run the server on any reachable
box (`PORT=3000 node server/index.js`) and open its URL.

## Project layout

```
shared/      constants, RNG, wire protocol (browser + Node)
client/
  main.js    integration: boots three.js, glues every module together
  src/
    course/  procedural 18-hole generator + cartoon renderer
    engine/  disc-flight physics, flick input, camera, round controller
    models/  characters, discs, particle effects (all procedural geometry)
    net/     WebSocket client
    ui/      menus, lobby, HUD, scorecard (vanilla DOM)
server/      static file server + WebSocket rooms/relay
electron/    desktop wrapper (Steam-ready path)
```

Design contracts for every module live in [DESIGN.md](DESIGN.md); the build
plan is in [PLAN.md](PLAN.md).

## Shipping to Steam (the path this is built for)

1. `npm i -D electron-builder` and add a build config (appId, icon, NSIS).
2. `npx electron-builder --win` → installable .exe of the game.
3. Buy the $100 Steamworks app credit, integrate
   [steamworks.js](https://github.com/ceifa/steamworks.js) for achievements /
   rich presence, upload the build with `steamcmd`.
4. Host `server/index.js` on a small VPS so public lobbies work anywhere.
