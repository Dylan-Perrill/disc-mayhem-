// server/rooms.js — Room bookkeeping: codes, membership, scorecards.
// Used by server/index.js. Plain Node ESM, no dependencies.

import { HOLE_COUNT, MAX_ROOM_PLAYERS } from '../shared/constants.js';

// Unambiguous uppercase letters only (no O or I; digits 0/1 excluded by design).
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const CODE_LENGTH = 4;

export function makeCode() {
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  }
  return code;
}

export class Room {
  constructor(code) {
    this.code = code;
    this.players = new Map(); // id -> { id, ws, profile }
    this.hostId = null;
    this.started = false;
    this.seed = null;
    this.scorecards = new Map(); // id -> { name, holes: (null | {strokes, timeMs})[HOLE_COUNT] }
    this.latestStates = new Map(); // id -> latest C_STATE payload
    this.stateInterval = null; // set by index.js, cleared on room removal
  }

  get size() {
    return this.players.size;
  }

  get isFull() {
    return this.players.size >= MAX_ROOM_PLAYERS;
  }

  get isEmpty() {
    return this.players.size === 0;
  }

  addPlayer(id, ws, profile) {
    const player = { id, ws, profile: profile || {} };
    this.players.set(id, player);
    if (!this.hostId) this.hostId = id;
    if (!this.scorecards.has(id)) {
      this.scorecards.set(id, {
        name: (profile && typeof profile.name === 'string' && profile.name) || 'Player',
        holes: new Array(HOLE_COUNT).fill(null),
      });
    }
    return player;
  }

  // Removes a player. Reassigns host to the longest-standing remaining player
  // if the host left. Pre-start, the player's scorecard is dropped too;
  // post-start it is kept so results stay coherent.
  removePlayer(id) {
    this.players.delete(id);
    this.latestStates.delete(id);
    if (!this.started) this.scorecards.delete(id);
    if (this.hostId === id) {
      const next = this.players.keys().next();
      this.hostId = next.done ? null : next.value;
    }
  }

  setState(id, state) {
    if (this.players.has(id)) this.latestStates.set(id, state);
  }

  recordHole(id, holeIndex, strokes, timeMs) {
    const card = this.scorecards.get(id);
    if (!card) return false;
    if (!Number.isInteger(holeIndex) || holeIndex < 0 || holeIndex >= HOLE_COUNT) return false;
    card.holes[holeIndex] = {
      strokes: Number(strokes) || 0,
      timeMs: Number(timeMs) || 0,
    };
    return true;
  }

  // S_ROOM payload: { code, players: [{id, profile, isHost}], hostId }
  roomPayload() {
    return {
      code: this.code,
      players: [...this.players.values()].map((p) => ({
        id: p.id,
        profile: p.profile,
        isHost: p.id === this.hostId,
      })),
      hostId: this.hostId,
    };
  }

  // S_SCORE payload: { scores: { [id]: { name, holes, totalStrokes, totalTimeMs } } }
  scorePayload() {
    const scores = {};
    for (const [id, card] of this.scorecards) {
      let totalStrokes = 0;
      let totalTimeMs = 0;
      for (const hole of card.holes) {
        if (hole) {
          totalStrokes += hole.strokes;
          totalTimeMs += hole.timeMs;
        }
      }
      scores[id] = { name: card.name, holes: card.holes, totalStrokes, totalTimeMs };
    }
    return { scores };
  }
}

// ---- Registry ----

const rooms = new Map(); // code -> Room

export function createRoom() {
  let code;
  do {
    code = makeCode();
  } while (rooms.has(code));
  const room = new Room(code);
  rooms.set(code, room);
  return room;
}

export function getRoom(code) {
  return rooms.get(code);
}

export function removeRoom(code) {
  const room = rooms.get(code);
  if (!room) return;
  if (room.stateInterval) {
    clearInterval(room.stateInterval);
    room.stateInterval = null;
  }
  rooms.delete(code);
}

export function roomCount() {
  return rooms.size;
}
