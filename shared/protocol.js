// WebSocket message types. Wire format: JSON { type, ...payload }.
// Zero imports (loads in browser + Node).

export const MSG = {
  // ---- client -> server ----
  C_CREATE_ROOM: 'c_create_room', // { profile }                       profile = customization object
  C_JOIN_ROOM: 'c_join_room',     // { code, profile }
  C_LEAVE: 'c_leave',             // {}
  C_START: 'c_start',             // {}                                host only
  C_STATE: 'c_state',             // { state }                        state = GameController.getPublicState()
  C_THROW: 'c_throw',             // { discType, origin, throwParams }
  C_EVENT: 'c_event',             // { kind, data }                   kind: 'kill' {victimId} | 'bomb' {pos, radius} | 'holed' {holeIndex}
  C_HOLE_DONE: 'c_hole_done',     // { holeIndex, strokes, timeMs }

  // ---- server -> client ----
  S_WELCOME: 's_welcome',         // { id }                            your connection id
  S_ROOM: 's_room',               // { code, players: [{id, profile, isHost}], hostId }
  S_ERROR: 's_error',             // { message }
  S_START: 's_start',             // { seed, startTime }
  S_STATE: 's_state',             // { players: [{id, state}] }        others' states, batched
  S_THROW: 's_throw',             // { id, discType, origin, throwParams }
  S_EVENT: 's_event',             // { id, kind, data }
  S_SCORE: 's_score',             // { scores: { [id]: { name, holes: [{strokes, timeMs}|null x18], totalStrokes, totalTimeMs } } }
  S_PLAYER_LEFT: 's_player_left', // { id }
};
