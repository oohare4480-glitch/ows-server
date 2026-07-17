// Open World Shogi — authoritative WebSocket server, multi-room edition.
// Each "room" is its own independent persistent world (its own Map of cells,
// its own armies, its own march clock), simulated and broadcast completely
// independently of every other room. No AI — every army is human-controlled.
//
// Room lifecycle:
//   - A client can join a SPECIFIC room by code (private games with friends),
//     or ask for "quick match" (code omitted), in which case the server picks
//     an existing room with free space, or spins up a brand new one.
//   - Empty rooms are garbage-collected after ROOM_IDLE_MS of having 0 players,
//     so memory doesn't grow without bound over the server's lifetime.
//
// Scaling notes (read this before turning up ROOM_CAP or expecting many
// simultaneous full rooms on a free-tier instance):
//   - Each broadcast tick serializes that room's ENTIRE state (all cells +
//     all armies) and sends it to every connected client of that room. Cost
//     per room scales roughly with (armies * broadcast rate * clients in that
//     room). More rooms running concurrently multiply total CPU + bandwidth
//     roughly linearly — a free-tier single-core instance can realistically
//     run a handful of lightly-populated rooms, but will choke on several
//     simultaneous full ROOM_CAP=200 rooms. Bump ROOM_CAP and the number of
//     concurrent rooms together with your hosting tier, not independently.
//   - ROOM_CAP and MAX_ROOMS are both overridable via environment variables
//     so this can be tuned after upgrading hosting, without a code change.

const http = require("http");
const WebSocket = require("ws");
const {
  MAP_W, MAP_H, NAME_MAX_LEN, now,
  spawnNewArmy, applyGuestAction, updateWorld, handleDefeat, aliveCount,
  filterProfanity, pushChat, randLine,
} = require("./game.js");

const TICK_MS = 60;              // server simulation tick, per room
const BROADCAST_MS = 80;         // fallback full-state broadcast interval, per room
const BROADCAST_MIN_GAP_MS = 30; // throttle for the immediate post-action broadcast
const PLAYER_STALE_MS = 20000;   // no ping this long -> treat as gone
const ROOM_IDLE_MS = 1000 * 60 * 5; // delete a room 5 minutes after it goes empty
const ROOM_CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I

// Tunable via environment variables (set these in Render's dashboard once
// you've upgraded off the free tier) without touching code.
const ROOM_CAP = parseInt(process.env.ROOM_CAP || "60", 10);
const MAX_ROOMS = parseInt(process.env.MAX_ROOMS || "20", 10);

// code -> { world, clients: Map(ws -> info), lastBroadcastAt, emptySince }
const rooms = new Map();

function makeRoomCode() {
  let code;
  do {
    code = "";
    for (let i = 0; i < 5; i++) code += ROOM_CODE_CHARS[Math.floor(Math.random() * ROOM_CODE_CHARS.length)];
  } while (rooms.has(code));
  return code;
}

function createRoom(preferredCode) {
  let code = null;
  const isPrivate = !!preferredCode;
  if (preferredCode) {
    const c = String(preferredCode).trim().toUpperCase();
    if (!/^[A-Z2-9]{3,10}$/.test(c)) return { error: "invalid_code" };
    if (rooms.has(c)) return { error: "code_taken" };
    code = c;
  } else {
    code = makeRoomCode();
  }
  const room = {
    code,
    private: isPrivate, // 自分で合言葉を決めて作った部屋は一覧に出さない
    world: { mode: "openworld", cells: new Map(), armies: [], marchAnchor: now(), lastMarchTick: 0, chat: [] },
    clients: new Map(),
    lastBroadcastAt: 0,
    emptySince: now(),
  };
  rooms.set(code, room);
  return { room };
}

// find a room with free space for quick-match, or create a new one if every
// existing room is full (or none exist yet). Caps total concurrent rooms at
// MAX_ROOMS so a burst of traffic can't spin up unbounded rooms/memory.
function findRoomForQuickMatch() {
  for (const room of rooms.values()) {
    if (!room.private && aliveCount(room.world) < ROOM_CAP) return room;
  }
  if (rooms.size >= MAX_ROOMS) return null; // server is at capacity across all rooms
  return createRoom().room || null;
}

function roomSummary(room) {
  return { code: room.code, count: aliveCount(room.world), cap: ROOM_CAP, connected: room.clients.size };
}

function leaveArmy(room, armyId) {
  const W = room.world;
  const army = W.armies.find(a => a.id === armyId);
  if (!army || !army.alive) return;
  // remove only the king; every other piece stays on the board as remains.
  for (const [k, cell] of W.cells) {
    if (cell.owner === armyId && cell.t === "K") { W.cells.delete(k); break; }
  }
  handleDefeat(W, army);
}

function serialize(room) {
  const W = room.world;
  return JSON.stringify({
    type: "state",
    cells: [...W.cells].map(([k, p]) => [k, p.t, p.promoted ? 1 : 0, p.owner]),
    armies: W.armies.map(a => ({
      id: a.id, facing: a.facing, alive: a.alive, hand: a.hand, center: a.center,
      kills: a.kills, target: a.target, flankBias: a.flankBias, name: a.name,
      cd: Math.max(0, 5000 - (now() - a.lastAction)),
    })),
    chat: W.chat.slice(-40),
    marchAnchor: W.marchAnchor, lastMarchTick: W.lastMarchTick,
    cap: ROOM_CAP, count: aliveCount(W), code: room.code,
    ts: now(),
  });
}

function broadcast(room) {
  if (!room.clients.size) return;
  const payload = serialize(room);
  for (const ws of room.clients.keys()) {
    if (ws.readyState === WebSocket.OPEN) ws.send(payload);
  }
  room.lastBroadcastAt = now();
}

// call this right after any action that changes a room's world, so the
// change reaches everyone in that room almost immediately instead of
// waiting for the next scheduled tick (still throttled a little so a burst
// of actions can't flood the network).
function broadcastSoon(room) {
  const t = now();
  if (t - room.lastBroadcastAt >= BROADCAST_MIN_GAP_MS) broadcast(room);
}

const server = http.createServer((req, res) => {
  if (req.method === "GET" && req.url === "/api/rooms") {
    res.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
    res.end(JSON.stringify({ rooms: [...rooms.values()].filter((r) => r.clients.size > 0 && !r.private).map(roomSummary), roomCap: ROOM_CAP, maxRooms: MAX_ROOMS }));
    return;
  }
  res.writeHead(200, { "Content-Type": "text/plain" });
  const totalPlayers = [...rooms.values()].reduce((s, r) => s + aliveCount(r.world), 0);
  res.end(`Open World Shogi server OK — ${rooms.size} room(s), ${totalPlayers} player(s) total\n`);
});
const wss = new WebSocket.Server({ server });

wss.on("connection", (ws) => {
  // info.room is set once the client successfully joins a room.
  const info = { room: null, armyId: null, name: "名無し", lastSeen: Date.now() };

  ws.on("message", (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    info.lastSeen = Date.now();

    if (msg.type === "ping") return;

    if (msg.type === "rooms") {
      ws.send(JSON.stringify({ type: "rooms", rooms: [...rooms.values()].filter((r) => r.clients.size > 0 && !r.private).map(roomSummary) }));
      return;
    }

    if (msg.type === "join" || msg.type === "create") {
      if (info.room) return; // already in a room on this connection
      let room;
      if (msg.type === "create") {
        // 「新しい部屋を作る」— 既存の部屋の空きは見ず、必ず新規の部屋を作る。
        // 合言葉(code)の指定は必須(友達と集まる専用の部屋なので、空欄では作らせない)。
        if (rooms.size >= MAX_ROOMS) { ws.send(JSON.stringify({ type: "error", reason: "server_full" })); return; }
        if (!String(msg.code || "").trim()) { ws.send(JSON.stringify({ type: "error", reason: "code_required" })); return; }
        const result = createRoom(msg.code);
        if (result.error) { ws.send(JSON.stringify({ type: "error", reason: result.error })); return; }
        room = result.room;
      } else {
        const requestedCode = String(msg.code || "").trim().toUpperCase();
        if (requestedCode) {
          room = rooms.get(requestedCode);
          if (!room) { ws.send(JSON.stringify({ type: "error", reason: "not_found" })); return; }
          if (aliveCount(room.world) >= ROOM_CAP) { ws.send(JSON.stringify({ type: "full" })); return; }
        } else {
          room = findRoomForQuickMatch();
          if (!room) { ws.send(JSON.stringify({ type: "error", reason: "server_full" })); return; }
        }
      }
      const nm = filterProfanity(String(msg.name || "").trim()).slice(0, NAME_MAX_LEN) || "名無し";
      const a = spawnNewArmy(room.world);
      if (!a) { ws.send(JSON.stringify({ type: "full" })); return; }
      a.name = nm;
      info.room = room;
      info.armyId = a.id;
      info.name = nm;
      room.clients.set(ws, info);
      room.emptySince = null;
      ws.send(JSON.stringify({ type: "joined", armyId: a.id, code: room.code }));
      broadcastSoon(room);
      return;
    }

    const room = info.room;
    if (!room || info.armyId == null) return;
    const army = room.world.armies.find(x => x.id === info.armyId);
    if (!army) return;

    if (msg.type === "respawn") {
      if (army.alive) return;
      if (aliveCount(room.world) >= ROOM_CAP) { ws.send(JSON.stringify({ type: "full" })); return; }
      const a = spawnNewArmy(room.world);
      if (!a) return;
      a.name = info.name;
      info.armyId = a.id;
      ws.send(JSON.stringify({ type: "joined", armyId: a.id, code: room.code }));
      broadcastSoon(room);
      return;
    }

    if (["move", "drop", "rotate", "target", "targetRel", "stopTarget", "chat"].includes(msg.type)) {
      applyGuestAction(room.world, army, msg);
      broadcastSoon(room);
    }
  });

  ws.on("close", () => {
    const room = info.room;
    if (!room) return;
    if (info.armyId != null) leaveArmy(room, info.armyId);
    room.clients.delete(ws);
    if (room.clients.size === 0) room.emptySince = now();
    broadcastSoon(room);
  });
});

// simulation loop: ticks every room that currently has at least one
// connected client. Empty rooms are skipped (no wasted CPU) and eventually
// garbage-collected below.
setInterval(() => {
  const t = Date.now();
  for (const room of rooms.values()) {
    if (!room.clients.size) continue;
    try {
      const before = room.world.lastMarchTick;
      updateWorld(room.world);
      if (room.world.lastMarchTick !== before) broadcastSoon(room);
    } catch (e) { console.error(`updateWorld error in room ${room.code}`, e); }

    for (const [ws, c] of room.clients) {
      if (c.armyId != null && t - c.lastSeen > PLAYER_STALE_MS) {
        leaveArmy(room, c.armyId);
        c.armyId = null;
        try { ws.terminate(); } catch {}
        room.clients.delete(ws);
        if (room.clients.size === 0) room.emptySince = now();
      }
    }
  }
}, TICK_MS);

// fallback broadcast loop (covers any state change broadcastSoon() might have
// throttled away, and keeps clients in sync even with zero player activity)
setInterval(() => {
  for (const room of rooms.values()) broadcast(room);
}, BROADCAST_MS);

// empty-room cleanup, so memory doesn't grow forever across server uptime.
setInterval(() => {
  const t = now();
  for (const [code, room] of rooms) {
    if (room.clients.size === 0 && room.emptySince && t - room.emptySince > ROOM_IDLE_MS) {
      rooms.delete(code);
    }
  }
}, 60000);

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => console.log(`Open World Shogi server listening on :${PORT} (ROOM_CAP=${ROOM_CAP}, MAX_ROOMS=${MAX_ROOMS})`));
