// Servidor do Labirinto Zumbi — 3 servidores (salas), até 4 jogadores cada.
// O servidor roda toda a simulação (zumbis, tiros, colisões); os clientes só enviam
// os controles e desenham o que recebem.

const http = require('http');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 8080;
const NUM_ROOMS = 3;
const MAX_PLAYERS = 4;
const NUM_ZOMBIES = 5;
const RESTART_DELAY_MS = 6000;

// ---------- Mapa (igual ao do cliente) ----------
const CELL = 40;
const maze = [
  "1111111111111111",
  "1000000100000001",
  "1011101101110101",
  "1010001000010101",
  "1010111111110101",
  "1000100000010001",
  "1110101111101111",
  "1000101000001001",
  "1011101011101101",
  "1010000010000101",
  "1010111110111101",
  "1111111111111111",
].map(r => r.split('').map(Number));
const ROWS = maze.length, COLS = maze[0].length;
const W = COLS * CELL, H = ROWS * CELL;

function isWall(cx, cy) {
  if (cx < 0 || cy < 0 || cx >= COLS || cy >= ROWS) return true;
  return maze[cy][cx] === 1;
}

function circleHitsWall(x, y, r) {
  const minCx = Math.floor((x - r) / CELL), maxCx = Math.floor((x + r) / CELL);
  const minCy = Math.floor((y - r) / CELL), maxCy = Math.floor((y + r) / CELL);
  for (let cy = minCy; cy <= maxCy; cy++) {
    for (let cx = minCx; cx <= maxCx; cx++) {
      if (!isWall(cx, cy)) continue;
      const wx = cx * CELL, wy = cy * CELL;
      const px = Math.max(wx, Math.min(x, wx + CELL));
      const py = Math.max(wy, Math.min(y, wy + CELL));
      const dx = x - px, dy = y - py;
      if (dx * dx + dy * dy < r * r) return true;
    }
  }
  return false;
}

function freeCells() {
  const cells = [];
  for (let cy = 0; cy < ROWS; cy++)
    for (let cx = 0; cx < COLS; cx++)
      if (maze[cy][cx] === 0) cells.push({ cx, cy });
  return cells;
}

// ---------- Salas ----------
const rooms = Array.from({ length: NUM_ROOMS }, (_, id) => ({
  id, players: new Map(), zombies: [], bullets: [], status: 'playing', restartAt: 0,
}));

function spawnPlayer(p) {
  p.x = CELL * 1.5; p.y = CELL * 1.5;
  p.health = 100; p.alive = true; p.cooldown = 0;
}

function resetRoom(room) {
  room.status = 'playing';
  room.restartAt = 0;
  room.bullets = [];
  room.zombies = [];
  const free = freeCells().filter(c => Math.hypot(c.cx - 1, c.cy - 1) >= 4);
  while (room.zombies.length < NUM_ZOMBIES) {
    const c = free.splice(Math.floor(Math.random() * free.length), 1)[0];
    room.zombies.push({
      x: c.cx * CELL + CELL / 2, y: c.cy * CELL + CELL / 2,
      r: 13, speed: 0.7 + Math.random() * 0.5, health: 30, alive: true,
    });
  }
  for (const p of room.players.values()) spawnPlayer(p);
}

function endRound(room, status) {
  room.status = status;
  room.restartAt = Date.now() + RESTART_DELAY_MS;
}

function tickRoom(room) {
  if (room.status !== 'playing') {
    if (Date.now() >= room.restartAt) resetRoom(room);
    return;
  }

  // Jogadores
  for (const p of room.players.values()) {
    if (!p.alive) continue;
    if (p.cooldown > 0) p.cooldown--;
    const i = p.input;
    let dx = (i.right ? 1 : 0) - (i.left ? 1 : 0);
    let dy = (i.down ? 1 : 0) - (i.up ? 1 : 0);
    if (dx && dy) { dx *= 0.7071; dy *= 0.7071; }
    const nx = p.x + dx * 2.6, ny = p.y + dy * 2.6;
    if (!circleHitsWall(nx, p.y, p.r)) p.x = nx;
    if (!circleHitsWall(p.x, ny, p.r)) p.y = ny;
  }

  // Balas
  for (const b of room.bullets) { b.x += b.dx; b.y += b.dy; b.life--; }
  room.bullets = room.bullets.filter(b =>
    b.life > 0 && !circleHitsWall(b.x, b.y, 2) && b.x > 0 && b.x < W && b.y > 0 && b.y < H);

  // Zumbis
  for (const z of room.zombies) {
    if (!z.alive) continue;
    let target = null, best = Infinity;
    for (const p of room.players.values()) {
      if (!p.alive) continue;
      const d = Math.hypot(p.x - z.x, p.y - z.y);
      if (d < best) { best = d; target = p; }
    }
    if (!target) continue;
    const ang = Math.atan2(target.y - z.y, target.x - z.x);
    const zx = z.x + Math.cos(ang) * z.speed, zy = z.y + Math.sin(ang) * z.speed;
    if (!circleHitsWall(zx, z.y, z.r)) z.x = zx;
    if (!circleHitsWall(z.x, zy, z.r)) z.y = zy;

    for (const p of room.players.values()) {
      if (!p.alive) continue;
      if (Math.hypot(p.x - z.x, p.y - z.y) < z.r + p.r - 4) {
        p.health -= 0.5;
        if (p.health <= 0) { p.health = 0; p.alive = false; }
      }
    }
  }

  // Balas x zumbis
  for (const b of room.bullets) {
    for (const z of room.zombies) {
      if (!z.alive) continue;
      if (Math.hypot(b.x - z.x, b.y - z.y) < z.r) {
        z.health -= 10;
        if (z.health <= 0) z.alive = false;
        b.life = 0;
        break;
      }
    }
  }
  room.bullets = room.bullets.filter(b => b.life > 0);

  // Fim de rodada
  if (room.zombies.every(z => !z.alive)) endRound(room, 'won');
  else if ([...room.players.values()].every(p => !p.alive)) endRound(room, 'lost');
}

const r1 = n => Math.round(n * 10) / 10;

function snapshot(room) {
  return JSON.stringify({
    t: 'state',
    status: room.status,
    restartIn: room.status === 'playing' ? 0 : Math.max(0, Math.ceil((room.restartAt - Date.now()) / 1000)),
    players: [...room.players.values()].map(p => ({
      id: p.id, slot: p.slot, name: p.name, x: r1(p.x), y: r1(p.y),
      angle: Math.round(p.angle * 100) / 100, health: Math.ceil(p.health), alive: p.alive,
    })),
    zombies: room.zombies.map(z => ({ x: r1(z.x), y: r1(z.y), health: z.health, alive: z.alive })),
    bullets: room.bullets.map(b => ({ x: r1(b.x), y: r1(b.y) })),
  });
}

// ---------- Conexões ----------
function send(ws, obj) {
  if (ws.readyState === 1) ws.send(JSON.stringify(obj));
}

function roomList() {
  return rooms.map(r => ({ id: r.id, players: r.players.size, max: MAX_PLAYERS }));
}

function broadcastRooms() {
  const msg = JSON.stringify({ t: 'rooms', rooms: roomList() });
  for (const ws of wss.clients) if (ws.room === null && ws.readyState === 1) ws.send(msg);
}

function leaveRoom(ws) {
  if (ws.room === null) return;
  rooms[ws.room].players.delete(ws.id);
  ws.room = null;
  broadcastRooms();
}

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Servidor do Labirinto Zumbi no ar.');
});
const wss = new WebSocketServer({ server });
let nextId = 1;

wss.on('connection', ws => {
  ws.id = nextId++;
  ws.room = null;
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  send(ws, { t: 'rooms', rooms: roomList() });

  ws.on('message', raw => {
    let m;
    try { m = JSON.parse(raw); } catch { return; }
    if (!m || typeof m.t !== 'string') return;

    if (m.t === 'list') {
      send(ws, { t: 'rooms', rooms: roomList() });

    } else if (m.t === 'join') {
      const idx = Number(m.room);
      if (!Number.isInteger(idx) || idx < 0 || idx >= NUM_ROOMS) return;
      if (ws.room !== null) leaveRoom(ws);
      const room = rooms[idx];
      if (room.players.size >= MAX_PLAYERS) {
        send(ws, { t: 'error', msg: 'Servidor cheio (4/4). Escolha outro.' });
        send(ws, { t: 'rooms', rooms: roomList() });
        return;
      }
      const used = new Set([...room.players.values()].map(p => p.slot));
      let slot = 0; while (used.has(slot)) slot++;
      const name = String(m.name || '').replace(/[<>]/g, '').trim().slice(0, 12) || `Jogador ${slot + 1}`;
      const wasEmpty = room.players.size === 0;
      const p = { ws, id: ws.id, slot, name, r: 12, angle: 0, input: {}, x: 0, y: 0, health: 100, alive: true, cooldown: 0 };
      room.players.set(ws.id, p);
      ws.room = idx;
      if (wasEmpty) resetRoom(room); else spawnPlayer(p);
      send(ws, { t: 'joined', id: ws.id, room: idx, slot });
      broadcastRooms();

    } else if (m.t === 'leave') {
      leaveRoom(ws);
      send(ws, { t: 'left' });
      send(ws, { t: 'rooms', rooms: roomList() });

    } else if (ws.room !== null) {
      const room = rooms[ws.room];
      const p = room.players.get(ws.id);
      if (!p) return;
      if (m.t === 'input') {
        p.input = { up: !!m.up, down: !!m.down, left: !!m.left, right: !!m.right };
        if (Number.isFinite(m.angle)) p.angle = m.angle;
      } else if (m.t === 'shoot') {
        if (room.status !== 'playing' || !p.alive || p.cooldown > 0) return;
        if (Number.isFinite(m.angle)) p.angle = m.angle;
        p.cooldown = 13; // ~0,22 s entre tiros
        room.bullets.push({
          x: p.x + Math.cos(p.angle) * (p.r + 4), y: p.y + Math.sin(p.angle) * (p.r + 4),
          dx: Math.cos(p.angle) * 9, dy: Math.sin(p.angle) * 9, life: 60,
        });
      }
    }
  });

  ws.on('close', () => leaveRoom(ws));
  ws.on('error', () => {});
});

// Simulação a 60 Hz, envio de estado a 30 Hz
let tick = 0;
setInterval(() => {
  tick++;
  for (const room of rooms) {
    if (room.players.size === 0) continue;
    tickRoom(room);
    if (tick % 2 === 0) {
      const msg = snapshot(room);
      for (const p of room.players.values()) {
        if (p.ws.readyState === 1) p.ws.send(msg);
      }
    }
  }
}, 1000 / 60);

// Mantém conexões vivas (o Render derruba conexões ociosas)
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false;
    ws.ping();
  }
}, 30000);

server.listen(PORT, () => console.log(`Servidor ouvindo na porta ${PORT}`));
