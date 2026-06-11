// server/index.js — DISC MAYHEM! server: static files + WebSocket rooms.
// One Node process: HTTP static server and `ws` WebSocketServer on the same port.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { MSG } from '../shared/protocol.js';
import { DEFAULT_PORT, STATE_SEND_HZ } from '../shared/constants.js';
import { createRoom, getRoom, removeRoom } from './rooms.js';

const PORT = Number(process.env.PORT) || DEFAULT_PORT;

// Project root = one directory above server/ (derived from this file, not cwd).
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// ---- HTTP static file server ----

const ALLOWED_PREFIXES = ['/client/', '/shared/', '/node_modules/three/'];

const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

function notFound(res) {
  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not found');
}

function serveStatic(pathname, res) {
  // Reject traversal attempts outright, then resolve against ROOT and verify
  // the normalized path is still inside the project root.
  if (pathname.includes('..') || pathname.includes('\0')) return notFound(res);
  if (!ALLOWED_PREFIXES.some((prefix) => pathname.startsWith(prefix))) return notFound(res);

  const mime = MIME[path.extname(pathname).toLowerCase()];
  if (!mime) return notFound(res);

  const filePath = path.normalize(path.join(ROOT, pathname));
  if (!filePath.startsWith(ROOT + path.sep)) return notFound(res);

  fs.readFile(filePath, (err, data) => {
    if (err) return notFound(res);
    res.writeHead(200, { 'Content-Type': mime, 'Cache-Control': 'no-cache' });
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  if (req.method !== 'GET') {
    res.writeHead(405, { 'Content-Type': 'text/plain' });
    res.end('Method not allowed');
    return;
  }
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch {
    res.writeHead(400, { 'Content-Type': 'text/plain' });
    res.end('Bad request');
    return;
  }
  if (pathname === '/') {
    res.writeHead(302, { Location: '/client/index.html' });
    res.end();
    return;
  }
  serveStatic(pathname, res);
});

// ---- WebSocket server ----

const wss = new WebSocketServer({ server });

function makeId() {
  return crypto.randomBytes(4).toString('hex');
}

function send(ws, msg) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
}

function sendError(ws, message) {
  send(ws, { type: MSG.S_ERROR, message });
}

function broadcast(room, msg) {
  const data = JSON.stringify(msg);
  for (const player of room.players.values()) {
    if (player.ws.readyState === player.ws.OPEN) player.ws.send(data);
  }
}

function broadcastOthers(room, exceptId, msg) {
  const data = JSON.stringify(msg);
  for (const player of room.players.values()) {
    if (player.id === exceptId) continue;
    if (player.ws.readyState === player.ws.OPEN) player.ws.send(data);
  }
}

function broadcastRoom(room) {
  broadcast(room, { type: MSG.S_ROOM, ...room.roomPayload() });
}

function currentRoom(ws) {
  return ws.roomCode ? getRoom(ws.roomCode) : undefined;
}

// Batched state relay: ~10x/sec send each player everyone's latest state
// EXCEPT their own.
function startStateBroadcast(room) {
  room.stateInterval = setInterval(() => {
    if (room.latestStates.size === 0) return;
    for (const player of room.players.values()) {
      const players = [];
      for (const [id, state] of room.latestStates) {
        if (id !== player.id) players.push({ id, state });
      }
      if (players.length > 0) send(player.ws, { type: MSG.S_STATE, players });
    }
  }, Math.round(1000 / STATE_SEND_HZ));
}

function leaveRoom(ws, disconnected) {
  if (!ws.roomCode) return;
  const room = getRoom(ws.roomCode);
  ws.roomCode = null;
  if (!room || !room.players.has(ws.playerId)) return;
  room.removePlayer(ws.playerId);
  console.log(`[room ${room.code}] ${ws.playerId} left${disconnected ? ' (disconnected)' : ''}`);
  if (room.isEmpty) {
    removeRoom(room.code); // clears the room's state interval
    console.log(`[room ${room.code}] deleted (empty)`);
    return;
  }
  broadcast(room, { type: MSG.S_PLAYER_LEFT, id: ws.playerId });
  broadcastRoom(room); // updated roster (and possibly reassigned host)
}

function handleMessage(ws, msg) {
  switch (msg.type) {
    case MSG.C_CREATE_ROOM: {
      leaveRoom(ws, false);
      const room = createRoom();
      room.addPlayer(ws.playerId, ws, msg.profile);
      ws.roomCode = room.code;
      startStateBroadcast(room);
      console.log(`[room ${room.code}] created by ${ws.playerId}`);
      broadcastRoom(room);
      break;
    }

    case MSG.C_JOIN_ROOM: {
      const code = String(msg.code || '').trim().toUpperCase();
      const room = getRoom(code);
      if (!room) return sendError(ws, `Room ${code || '????'} not found`);
      if (room.started) return sendError(ws, 'Game already started');
      if (room.isFull) return sendError(ws, 'Room is full');
      leaveRoom(ws, false);
      room.addPlayer(ws.playerId, ws, msg.profile);
      ws.roomCode = room.code;
      console.log(`[room ${room.code}] ${ws.playerId} joined (${room.size} players)`);
      broadcastRoom(room);
      break;
    }

    case MSG.C_LEAVE: {
      leaveRoom(ws, false);
      break;
    }

    case MSG.C_START: {
      const room = currentRoom(ws);
      if (!room) return sendError(ws, 'Not in a room');
      if (room.hostId !== ws.playerId) return sendError(ws, 'Only the host can start');
      room.started = true;
      room.seed = crypto.randomBytes(4).readUInt32LE(0);
      broadcast(room, { type: MSG.S_START, seed: room.seed, startTime: Date.now() });
      console.log(`[room ${room.code}] started (seed=${room.seed}, ${room.size} players)`);
      break;
    }

    case MSG.C_STATE: {
      const room = currentRoom(ws);
      if (!room || msg.state == null) return;
      room.setState(ws.playerId, msg.state);
      break;
    }

    case MSG.C_THROW: {
      const room = currentRoom(ws);
      if (!room) return;
      broadcastOthers(room, ws.playerId, {
        type: MSG.S_THROW,
        id: ws.playerId,
        discType: msg.discType,
        origin: msg.origin,
        throwParams: msg.throwParams,
      });
      break;
    }

    case MSG.C_EVENT: {
      const room = currentRoom(ws);
      if (!room) return;
      broadcastOthers(room, ws.playerId, {
        type: MSG.S_EVENT,
        id: ws.playerId,
        kind: msg.kind,
        data: msg.data,
      });
      break;
    }

    case MSG.C_HOLE_DONE: {
      const room = currentRoom(ws);
      if (!room) return;
      if (room.recordHole(ws.playerId, msg.holeIndex, msg.strokes, msg.timeMs)) {
        broadcast(room, { type: MSG.S_SCORE, ...room.scorePayload() });
      }
      break;
    }

    default:
      break; // unknown types ignored
  }
}

wss.on('connection', (ws) => {
  ws.playerId = makeId();
  ws.roomCode = null;
  ws.isAlive = true;
  ws.on('pong', () => {
    ws.isAlive = true;
  });

  send(ws, { type: MSG.S_WELCOME, id: ws.playerId });

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return; // ignore malformed JSON
    }
    if (!msg || typeof msg.type !== 'string') return;
    try {
      handleMessage(ws, msg);
    } catch (err) {
      console.error(`[ws ${ws.playerId}] handler error for ${msg.type}:`, err);
    }
  });

  ws.on('close', () => leaveRoom(ws, true));
  ws.on('error', () => {}); // 'close' follows; nothing else to do
});

// Heartbeat: ping every 20s, terminate sockets that missed the previous ping.
const HEARTBEAT_MS = 20000;
const heartbeat = setInterval(() => {
  for (const ws of wss.clients) {
    if (ws.isAlive === false) {
      ws.terminate();
      continue;
    }
    ws.isAlive = false;
    ws.ping();
  }
}, HEARTBEAT_MS);
wss.on('close', () => clearInterval(heartbeat));

server.listen(PORT, () => {
  console.log('');
  console.log('  ==========================================');
  console.log('     DISC MAYHEM!  --  server is running');
  console.log(`     Play at:  http://localhost:${PORT}`);
  console.log('  ==========================================');
  console.log('');
});
