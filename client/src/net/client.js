// client/src/net/client.js — NetClient: browser-side WebSocket wrapper.
// No three.js, no DOM beyond WebSocket/location.

import { MSG } from '/shared/protocol.js';

// S_* message type -> emitted event name (payload = message minus `type`).
const EVENT_FOR = {
  [MSG.S_ROOM]: 'room', // { code, players, hostId }
  [MSG.S_START]: 'start', // { seed, startTime }
  [MSG.S_STATE]: 'state', // { players }
  [MSG.S_THROW]: 'throw', // { id, discType, origin, throwParams }
  [MSG.S_EVENT]: 'event', // { id, kind, data }
  [MSG.S_SCORE]: 'score', // { scores }
  [MSG.S_PLAYER_LEFT]: 'player-left', // { id }
  [MSG.S_ERROR]: 'error', // { message }
};

export class NetClient {
  constructor() {
    this._ws = null;
    this._id = null;
    this._hostId = null;
    this._listeners = new Map(); // event -> Set<fn>
    this._queue = []; // messages sent while still CONNECTING
  }

  get id() {
    return this._id;
  }

  get isHost() {
    return this._id !== null && this._id === this._hostId;
  }

  // Resolves once the server's S_WELCOME arrives (our id is known).
  connect(url) {
    const target =
      url || (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host;
    return new Promise((resolve, reject) => {
      let settled = false;
      const ws = new WebSocket(target);
      this._ws = ws;

      ws.addEventListener('open', () => this._flushQueue());

      ws.addEventListener('message', (ev) => {
        let msg;
        try {
          msg = JSON.parse(ev.data);
        } catch {
          return;
        }
        if (!msg || typeof msg.type !== 'string') return;
        if (msg.type === MSG.S_WELCOME) {
          this._id = msg.id;
          if (!settled) {
            settled = true;
            resolve(this);
          }
          return;
        }
        this._handle(msg);
      });

      ws.addEventListener('error', () => {
        if (!settled) {
          settled = true;
          reject(new Error(`Could not connect to ${target}`));
        }
        this._emit('error', { message: 'Connection error' });
      });

      ws.addEventListener('close', () => {
        this._ws = null;
        this._queue.length = 0;
        if (!settled) {
          settled = true;
          reject(new Error('Connection closed before welcome'));
        }
        this._emit('disconnect', {});
        this._listeners.clear(); // auto-clean listeners on disconnect
      });
    });
  }

  // ---- tiny emitter ----

  on(event, fn) {
    let set = this._listeners.get(event);
    if (!set) {
      set = new Set();
      this._listeners.set(event, set);
    }
    set.add(fn);
    return this;
  }

  off(event, fn) {
    const set = this._listeners.get(event);
    if (set) set.delete(fn);
    return this;
  }

  _emit(event, payload) {
    const set = this._listeners.get(event);
    if (!set) return;
    for (const fn of [...set]) {
      try {
        fn(payload);
      } catch (err) {
        console.error(`[net] '${event}' listener failed:`, err);
      }
    }
  }

  _handle(msg) {
    if (msg.type === MSG.S_ROOM) this._hostId = msg.hostId;
    const event = EVENT_FOR[msg.type];
    if (!event) return; // unknown server message — ignore
    const { type, ...payload } = msg;
    this._emit(event, payload);
  }

  // ---- outbound ----

  _send(msg) {
    const ws = this._ws;
    if (!ws) return; // not connected — safe no-op
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    } else if (ws.readyState === WebSocket.CONNECTING) {
      this._queue.push(msg); // flushed on open
    }
    // CLOSING/CLOSED: drop silently
  }

  _flushQueue() {
    const ws = this._ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    while (this._queue.length > 0) {
      ws.send(JSON.stringify(this._queue.shift()));
    }
  }

  createRoom(profile) {
    this._send({ type: MSG.C_CREATE_ROOM, profile });
  }

  joinRoom(code, profile) {
    this._send({
      type: MSG.C_JOIN_ROOM,
      code: String(code || '').trim().toUpperCase(),
      profile,
    });
  }

  leaveRoom() {
    this._hostId = null;
    this._send({ type: MSG.C_LEAVE });
  }

  start() {
    this._send({ type: MSG.C_START }); // host only; server enforces
  }

  sendState(state) {
    this._send({ type: MSG.C_STATE, state });
  }

  sendThrow(data) {
    this._send({ type: MSG.C_THROW, ...data }); // { discType, origin, throwParams }
  }

  sendEvent(kind, data) {
    this._send({ type: MSG.C_EVENT, kind, data });
  }

  sendHoleDone(holeIndex, strokes, timeMs) {
    this._send({ type: MSG.C_HOLE_DONE, holeIndex, strokes, timeMs });
  }

  close() {
    if (this._ws) this._ws.close();
  }
}
