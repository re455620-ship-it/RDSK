const http = require("http");
const fs = require("fs");
const path = require("path");
const { WebSocketServer, WebSocket } = require("ws");

const PORT = process.env.PORT || 10000;
const W = 800, H = 500, R = 14, SPEED = 200, FPS = 30;
const MAX_PLAYERS = 3, NUM_ROOMS = 3;
const COLORS = ["#e74c3c", "#3498db", "#2ecc71"];

// Serve o jogo (index.html) na mesma URL do servidor
const server = http.createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "Content-Type": "text/plain" });
    return res.end("ok");
  }
  fs.readFile(path.join(__dirname, "index.html"), (err, data) => {
    if (err) {
      res.writeHead(200, { "Content-Type": "text/plain" });
      return res.end("Servidor WebSocket rodando");
    }
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(data);
  });
});

const wss = new WebSocketServer({ server });

// 3 "servidores" (salas), cada um com no máximo 3 jogadores
const rooms = Array.from({ length: NUM_ROOMS }, (_, i) => ({
  id: i + 1,
  players: new Map(),
  coins: [],
}));
let nextId = 1;

const send = (ws, obj) => {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
};

function broadcastRooms() {
  const msg = {
    type: "rooms",
    rooms: rooms.map((r) => ({ id: r.id, count: r.players.size, max: MAX_PLAYERS })),
  };
  wss.clients.forEach((c) => {
    if (!c.room) send(c, msg);
  });
}

function leaveRoom(ws) {
  if (!ws.room) return;
  ws.room.players.delete(ws.pid);
  if (ws.room.players.size === 0) ws.room.coins = [];
  ws.room = null;
  ws.pid = null;
}

function joinRoom(ws, roomId, name) {
  const room = rooms[roomId - 1];
  if (!room) return;
  leaveRoom(ws);
  if (room.players.size >= MAX_PLAYERS) {
    send(ws, { type: "full", room: roomId });
    return broadcastRooms();
  }
  const used = [...room.players.values()].map((p) => p.color);
  const color = COLORS.find((c) => !used.includes(c)) || COLORS[0];
  const pid = nextId++;
  room.players.set(pid, {
    id: pid,
    name: String(name || "Jogador").slice(0, 12),
    x: 100 + Math.random() * (W - 200),
    y: 100 + Math.random() * (H - 200),
    score: 0,
    color,
    dx: 0,
    dy: 0,
  });
  ws.room = room;
  ws.pid = pid;
  send(ws, { type: "joined", id: pid, room: roomId, width: W, height: H });
  broadcastRooms();
}

// Loop do jogo
setInterval(() => {
  for (const room of rooms) {
    if (room.players.size === 0) continue;

    while (room.coins.length < 3) {
      room.coins.push({ x: 30 + Math.random() * (W - 60), y: 30 + Math.random() * (H - 60) });
    }

    for (const p of room.players.values()) {
      p.x = Math.min(W - R, Math.max(R, p.x + (p.dx * SPEED) / FPS));
      p.y = Math.min(H - R, Math.max(R, p.y + (p.dy * SPEED) / FPS));
      room.coins = room.coins.filter((c) => {
        const hit = Math.hypot(c.x - p.x, c.y - p.y) < R + 8;
        if (hit) p.score++;
        return !hit;
      });
    }

    const state = {
      type: "state",
      coins: room.coins,
      players: [...room.players.values()].map(({ id, name, x, y, score, color }) => ({
        id, name, x: Math.round(x), y: Math.round(y), score, color,
      })),
    };
    wss.clients.forEach((c) => {
      if (c.room === room) send(c, state);
    });
  }
}, 1000 / FPS);

wss.on("connection", (ws) => {
  ws.isAlive = true;
  ws.room = null;
  ws.on("pong", () => (ws.isAlive = true));
  broadcastRooms();

  ws.on("message", (data) => {
    let m;
    try { m = JSON.parse(data.toString()); } catch { return; }

    if (m.type === "join") joinRoom(ws, Number(m.room), m.name);
    else if (m.type === "leave") {
      leaveRoom(ws);
      send(ws, { type: "left" });
      broadcastRooms();
    } else if (m.type === "input" && ws.room) {
      const p = ws.room.players.get(ws.pid);
      if (!p) return;
      const dx = Math.sign(Number(m.dx) || 0), dy = Math.sign(Number(m.dy) || 0);
      const len = Math.hypot(dx, dy) || 1;
      p.dx = dx / len;
      p.dy = dy / len;
    }
  });

  ws.on("close", () => {
    leaveRoom(ws);
    broadcastRooms();
  });
  ws.on("error", (err) => console.error("Erro no socket:", err.message));
});

// Heartbeat para o Render não derrubar conexões ociosas
setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.isAlive === false) return ws.terminate();
    ws.isAlive = false;
    ws.ping();
  });
}, 30000);

server.listen(PORT, () => console.log(`Servidor ouvindo na porta ${PORT}`));
