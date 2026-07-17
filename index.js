// Open World Shogi — authoritative WebSocket server.
// One shared persistent world, up to CAP players, no AI. The server is the
// single source of truth: it applies every player's actions, runs the march
// tick, and broadcasts the world state to everyone at a fixed interval.
// Free-tier friendly: plain Node.js + the `ws` package, no database needed.

const http = require("http");
const WebSocket = require("ws");
const {
  MAP_W, MAP_H, CAP, NAME_MAX_LEN, now,
  spawnNewArmy, applyGuestAction, updateWorld, handleDefeat, aliveCount,
  filterProfanity, pushChat, randLine,
} = require("./game.js");

const TICK_MS = 60;         // server simulation tick
const BROADCAST_MS = 80;    // how often full state is sent to every client
const PLAYER_STALE_MS = 20000; // no ping this long -> treat as gone

const W = {
  mode: "openworld", cells: new Map(), armies: [],
  marchAnchor: now(), lastMarchTick: 0, chat: [],
};

const clients = new Map(); // ws -> { armyId, name, lastSeen }

function leaveArmy(armyId) {
  const army = W.armies.find(a => a.id === armyId);
  if (!army || !army.alive) return;
  // remove only the king; every other piece stays on the board as remains.
  for (const [k, cell] of W.cells) {
    if (cell.owner === armyId && cell.t === "K") { W.cells.delete(k); break; }
  }
  handleDefeat(W, army);
}

function serialize() {
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
    cap: CAP, count: aliveCount(W),
    ts: now(),
  });
}

const server = http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end(`Open World Shogi server OK — ${aliveCount(W)}/${CAP} armies\n`);
});
const wss = new WebSocket.Server({ server });

wss.on("connection", (ws) => {
  const info = { armyId: null, name: "名無し", lastSeen: Date.now() };
  clients.set(ws, info);

  ws.on("message", (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    info.lastSeen = Date.now();

    if (msg.type === "ping") return;

    if (msg.type === "join") {
      if (info.armyId != null) return;
      if (aliveCount(W) >= CAP) { ws.send(JSON.stringify({ type: "full" })); return; }
      const nm = filterProfanity(String(msg.name || "").trim()).slice(0, NAME_MAX_LEN) || "名無し";
      const a = spawnNewArmy(W);
      if (!a) { ws.send(JSON.stringify({ type: "full" })); return; }
      a.name = nm;
      info.armyId = a.id;
      info.name = nm;
      pushChat(W, a.name, a.color.chip, randLine("join", a.name));
      ws.send(JSON.stringify({ type: "joined", armyId: a.id }));
      return;
    }

    if (info.armyId == null) return;
    const army = W.armies.find(x => x.id === info.armyId);
    if (!army) return;

    if (msg.type === "respawn") {
      if (army.alive) return;
      if (aliveCount(W) >= CAP) { ws.send(JSON.stringify({ type: "full" })); return; }
      const a = spawnNewArmy(W);
      if (!a) return;
      a.name = info.name;
      info.armyId = a.id;
      pushChat(W, a.name, a.color.chip, randLine("join", a.name));
      ws.send(JSON.stringify({ type: "joined", armyId: a.id }));
      return;
    }

    if (["move", "drop", "rotate", "target", "stopTarget", "chat"].includes(msg.type)) {
      applyGuestAction(W, army, msg);
    }
  });

  ws.on("close", () => {
    const c = clients.get(ws);
    if (c && c.armyId != null) leaveArmy(c.armyId);
    clients.delete(ws);
  });
});

// simulation loop
setInterval(() => {
  try { updateWorld(W); } catch (e) { console.error("updateWorld error", e); }
  // stale-connection cleanup (covers dropped connections that never fired 'close')
  const t = Date.now();
  for (const [ws, c] of clients) {
    if (c.armyId != null && t - c.lastSeen > PLAYER_STALE_MS) {
      leaveArmy(c.armyId);
      c.armyId = null;
      try { ws.terminate(); } catch {}
      clients.delete(ws);
    }
  }
}, TICK_MS);

// broadcast loop
setInterval(() => {
  if (!wss.clients.size) return;
  const payload = serialize();
  for (const ws of wss.clients) {
    if (ws.readyState === WebSocket.OPEN) ws.send(payload);
  }
}, BROADCAST_MS);

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => console.log(`Open World Shogi server listening on :${PORT}`));
