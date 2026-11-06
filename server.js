const http = require("http");
const fs = require("fs");
const path = require("path");
const { WebSocketServer, WebSocket } = require("ws");

// ======= CONFIG =======
const PORT = process.env.PORT || 10000;
const TICK = 20, DT = 1 / TICK;          // 20 atualizações por segundo
const MAX_PLAYERS = 5;                   // máximo por servidor
const MIN_PLAYERS = 2;                   // mínimo para começar a partida
const NUM_ROOMS = 3;                     // quantidade de servidores (salas)
const CELL = 400, COLS = 5, ROWS = 4, WW = COLS * CELL, WH = ROWS * CELL;
const PR = 14, ZR = 14, PSPEED = 190;
const COLORS = ["#e74c3c", "#3498db", "#f39c12", "#9b59b6", "#1abc9c"];
const WEAPONS = [
  { name: "Pistola",  cd: 350, dmg: 34, pellets: 1, spread: 0.02, range: 550, ammo: -1 },
  { name: "Escopeta", cd: 800, dmg: 20, pellets: 6, spread: 0.28, range: 320, ammo: 16 },
  { name: "SMG",      cd: 90,  dmg: 12, pellets: 1, spread: 0.09, range: 480, ammo: 90 },
];

// ======= MAPA (cidade com casas quadradas, igual para todos) =======
function mulberry(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry(1337);
const houses = [];
for (let i = 0; i < COLS; i++)
  for (let j = 0; j < ROWS; j++)
    for (let sx = 0; sx < 2; sx++)
      for (let sy = 0; sy < 2; sy++) {
        if (rnd() < 0.2) continue;
        const s = Math.round(70 + rnd() * 30);
        const cx = i * CELL + 70 + sx * 130 + 65, cy = j * CELL + 70 + sy * 130 + 65;
        houses.push({ x: Math.round(cx - s / 2), y: Math.round(cy - s / 2), w: s, h: s });
      }

function hitsWall(x, y, r) {
  if (x < r || y < r || x > WW - r || y > WH - r) return true;
  for (const h of houses) {
    const cx = Math.max(h.x, Math.min(x, h.x + h.w)), cy = Math.max(h.y, Math.min(y, h.y + h.h));
    const dx = x - cx, dy = y - cy;
    if (dx * dx + dy * dy < r * r) return true;
  }
  return false;
}
function tryMove(e, mx, my, r) {
  if (!hitsWall(e.x + mx, e.y + my, r)) { e.x += mx; e.y += my; return true; }
  if (mx !== 0 && !hitsWall(e.x + mx, e.y, r)) { e.x += mx; return true; }
  if (my !== 0 && !hitsWall(e.x, e.y + my, r)) { e.y += my; return true; }
  return false;
}
function rayBox(ox, oy, dx, dy, h) {
  let tmin = 0, tmax = Infinity;
  const axes = [[ox, dx, h.x, h.x + h.w], [oy, dy, h.y, h.y + h.h]];
  for (const [o, d, lo, hi] of axes) {
    if (Math.abs(d) < 1e-9) { if (o < lo || o > hi) return Infinity; }
    else {
      let t1 = (lo - o) / d, t2 = (hi - o) / d;
      if (t1 > t2) [t1, t2] = [t2, t1];
      tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
      if (tmin > tmax) return Infinity;
    }
  }
  return tmin;
}
function rayCircle(ox, oy, dx, dy, cx, cy, r) {
  const fx = cx - ox, fy = cy - oy, t = fx * dx + fy * dy;
  if (t < 0) return Infinity;
  const px = fx - t * dx, py = fy - t * dy, d2 = px * px + py * py;
  if (d2 > r * r) return Infinity;
  return Math.max(0, t - Math.sqrt(r * r - d2));
}
function openSpot(avoid) {
  for (let i = 0; i < 40; i++) {
    const x = 40 + Math.random() * (WW - 80), y = 40 + Math.random() * (WH - 80);
    if (hitsWall(x, y, ZR + 4)) continue;
    if (avoid && avoid.some((p) => Math.hypot(p.x - x, p.y - y) < 600)) continue;
    return { x, y };
  }
  return { x: 30, y: 30 };
}

// ======= HTTP (serve o index.html) =======
const server = http.createServer((req, res) => {
  if (req.url === "/health") { res.writeHead(200); return res.end("ok"); }
  fs.readFile(path.join(__dirname, "index.html"), (err, data) => {
    if (err) { res.writeHead(200); return res.end("Servidor WebSocket rodando"); }
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(data);
  });
});
const wss = new WebSocketServer({ server });

// ======= SALAS =======
const rooms = Array.from({ length: NUM_ROOMS }, (_, i) => ({
  id: i + 1, players: new Map(), zombies: [], pickups: [], shots: [],
  phase: "waiting", wave: 0, queue: 0, spawnT: 0, timer: 0, pickT: 0, nz: 1, np: 1,
}));
let nextPid = 1;

const send = (ws, obj) => { if (ws.readyState === WebSocket.OPEN) ws.send(typeof obj === "string" ? obj : JSON.stringify(obj)); };
const toRoom = (room, obj) => { const s = JSON.stringify(obj); for (const p of room.players.values()) send(p.ws, s); };

function broadcastRooms() {
  const msg = JSON.stringify({
    t: "rooms",
    rooms: rooms.map((r) => ({ id: r.id, count: r.players.size, max: MAX_PLAYERS, phase: r.phase, wave: r.wave })),
  });
  wss.clients.forEach((c) => { if (!c.room) send(c, msg); });
}
function sendRoster(room) {
  toRoom(room, { t: "roster", players: [...room.players.values()].map((p) => ({ id: p.id, name: p.name, color: p.color })) });
}

function leaveRoom(ws) {
  const room = ws.room;
  if (!room) return;
  room.players.delete(ws.pid);
  ws.room = null; ws.pid = null;
  if (room.players.size === 0) Object.assign(room, { zombies: [], pickups: [], shots: [], phase: "waiting", wave: 0, queue: 0 });
  else sendRoster(room);
}

function joinRoom(ws, roomId, name) {
  const room = rooms[roomId - 1];
  if (!room) return;
  leaveRoom(ws);
  if (room.players.size >= MAX_PLAYERS) { send(ws, { t: "full", room: roomId }); return broadcastRooms(); }
  const used = [...room.players.values()].map((p) => p.color);
  const spot = openSpot(null);
  const p = {
    id: nextPid++, ws, name: String(name || "Jogador").slice(0, 12),
    color: COLORS.find((c) => !used.includes(c)) || COLORS[0],
    x: spot.x, y: spot.y, a: 0, f: false, hp: 100, alive: true,
    weapon: 0, ammo: -1, score: 0, lastShot: 0, lastMove: Date.now(),
  };
  room.players.set(p.id, p);
  ws.room = room; ws.pid = p.id;
  send(ws, {
    t: "joined", id: p.id, room: roomId, min: MIN_PLAYERS, ww: WW, wh: WH,
    houses: houses.map((h) => [h.x, h.y, h.w, h.h]),
  });
  sendRoster(room);
  broadcastRooms();
}

// ======= LÓGICA DO JOGO =======
function spawnPickup(room) {
  for (let i = 0; i < 20; i++) {
    const h = houses[Math.floor(Math.random() * houses.length)];
    const x = Math.round(h.x + h.w / 2), y = Math.round(h.y + h.h + 20);   // na porta da casa
    if (hitsWall(x, y, 10)) continue;
    room.pickups.push({ id: room.np++, x, y, type: Math.random() < 0.65 ? 1 : 2 });
    return;
  }
}
function spawnZombie(room, alive) {
  const s = openSpot(alive.length ? alive : null);
  room.zombies.push({
    id: room.nz++, x: s.x, y: s.y, hp: 50 + room.wave * 5, atk: 0, by: 0,
    sp: (55 + Math.min(room.wave * 5, 45)) * (0.85 + Math.random() * 0.3),
    side: Math.random() < 0.5 ? 1 : -1,
  });
}
function startWave(room) {
  room.wave++; room.phase = "playing";
  room.queue = Math.min(4 + room.wave * 3, 45); room.spawnT = 1;
  for (const p of room.players.values()) { p.hp = p.alive ? Math.min(100, p.hp + 30) : 100; p.alive = true; }
}
function startGame(room) {
  room.wave = 0; room.zombies = []; room.pickups = []; room.pickT = 0;
  for (const p of room.players.values()) {
    const s = openSpot(null);
    Object.assign(p, { x: s.x, y: s.y, hp: 100, alive: true, score: 0, weapon: 0, ammo: -1 });
    send(p.ws, { t: "fix", x: s.x, y: s.y });
  }
  for (let i = 0; i < 6; i++) spawnPickup(room);
  startWave(room);
}

function fire(room, p, now) {
  const w = WEAPONS[p.weapon];
  if (now - p.lastShot < w.cd) return;
  p.lastShot = now;
  for (let k = 0; k < w.pellets; k++) {
    const a = p.a + (Math.random() - 0.5) * 2 * w.spread;
    const dx = Math.cos(a), dy = Math.sin(a);
    let best = w.range, target = null;
    for (const h of houses) { const t = rayBox(p.x, p.y, dx, dy, h); if (t < best) best = t; }
    for (const z of room.zombies) { const t = rayCircle(p.x, p.y, dx, dy, z.x, z.y, ZR); if (t < best) { best = t; target = z; } }
    if (target) { target.hp -= w.dmg; target.by = p.id; }
    room.shots.push([Math.round(p.x + dx * 20), Math.round(p.y + dy * 20), Math.round(p.x + dx * best), Math.round(p.y + dy * best)]);
  }
  if (w.ammo > 0 && --p.ammo <= 0) { p.weapon = 0; p.ammo = -1; }
}

function tickRoom(room, now) {
  if (room.players.size === 0) return;
  const players = [...room.players.values()];
  const alive = players.filter((p) => p.alive);

  // fases
  if (room.phase === "waiting") { if (players.length >= MIN_PLAYERS) startGame(room); }
  else if (room.phase === "playing") {
    if (room.queue > 0) {
      room.spawnT -= DT;
      if (room.spawnT <= 0 && room.zombies.length < 50) {
        spawnZombie(room, alive); room.queue--; room.spawnT = Math.max(0.25, 0.9 - room.wave * 0.05);
      }
    } else if (room.zombies.length === 0) { room.phase = "between"; room.timer = 6; }
  } else if (room.phase === "between") {
    room.timer -= DT;
    if (room.timer <= 0) startWave(room);
  } else if (room.phase === "over") {
    room.timer -= DT;
    if (room.timer <= 0) room.phase = "waiting";
  }
  if ((room.phase === "playing" || room.phase === "between") && alive.length === 0) { room.phase = "over"; room.timer = 8; }

  if (room.phase === "playing" || room.phase === "between") {
    // tiros
    for (const p of alive) if (p.f) fire(room, p, now);
    room.zombies = room.zombies.filter((z) => {
      if (z.hp > 0) return true;
      const k = room.players.get(z.by); if (k) k.score += 10;
      return false;
    });

    // zumbis
    for (const z of room.zombies) {
      let tgt = null, bd = 1e12;
      for (const p of alive) { const d = (p.x - z.x) ** 2 + (p.y - z.y) ** 2; if (d < bd) { bd = d; tgt = p; } }
      if (!tgt || !tgt.alive) continue;
      const d = Math.sqrt(bd);
      if (d < ZR + PR + 4) {
        if (now - z.atk > 800) { z.atk = now; tgt.hp -= 10; if (tgt.hp <= 0) { tgt.hp = 0; tgt.alive = false; tgt.f = false; } }
        continue;
      }
      const dx = (tgt.x - z.x) / d, dy = (tgt.y - z.y) / d, st = z.sp * DT;
      if (!tryMove(z, dx * st, dy * st, ZR)) tryMove(z, -dy * z.side * st, dx * z.side * st, ZR);
    }
    const zs = room.zombies;
    for (let i = 0; i < zs.length; i++)
      for (let j = i + 1; j < zs.length; j++) {
        const dx = zs[j].x - zs[i].x, dy = zs[j].y - zs[i].y, d2 = dx * dx + dy * dy;
        if (d2 < 400 && d2 > 0.01) {
          const d = Math.sqrt(d2), o = (20 - d) / 2, ux = dx / d, uy = dy / d;
          tryMove(zs[i], -ux * o, -uy * o, ZR); tryMove(zs[j], ux * o, uy * o, ZR);
        }
      }

    // armas no chão
    for (const p of alive)
      room.pickups = room.pickups.filter((w) => {
        if (Math.hypot(w.x - p.x, w.y - p.y) > PR + 12) return true;
        p.weapon = w.type; p.ammo = WEAPONS[w.type].ammo;
        return false;
      });
    room.pickT -= DT;
    if (room.pickups.length < 6 && room.pickT <= 0) { spawnPickup(room); room.pickT = 10; }
  }

  // envia o estado (formato compacto)
  toRoom(room, {
    t: "s", ph: room.phase, wv: room.wave, tm: Math.ceil(room.timer),
    p: players.map((p) => [p.id, Math.round(p.x), Math.round(p.y), +p.a.toFixed(2), Math.max(0, Math.round(p.hp)), p.alive ? 1 : 0, p.weapon, p.ammo, p.score]),
    z: room.zombies.map((z) => [z.id, Math.round(z.x), Math.round(z.y), Math.round(z.hp)]),
    w: room.pickups.map((w) => [w.id, w.x, w.y, w.type]),
    e: room.shots,
  });
  room.shots = [];
}

setInterval(() => { const now = Date.now(); for (const r of rooms) tickRoom(r, now); }, 1000 / TICK);
setInterval(broadcastRooms, 2000);

// ======= CONEXÕES =======
wss.on("connection", (ws) => {
  ws.isAlive = true; ws.room = null;
  ws.on("pong", () => (ws.isAlive = true));
  broadcastRooms();

  ws.on("message", (data) => {
    let m; try { m = JSON.parse(data.toString()); } catch { return; }
    if (m.t === "ping") return send(ws, { t: "pong", ts: m.ts });
    if (m.t === "join") return joinRoom(ws, Number(m.room), m.name);
    if (m.t === "leave") { leaveRoom(ws); send(ws, { t: "left" }); return broadcastRooms(); }
    if (m.t === "m" && ws.room) {
      const p = ws.room.players.get(ws.pid);
      if (!p) return;
      const now = Date.now(), dt = Math.min((now - p.lastMove) / 1000, 0.5);
      p.lastMove = now;
      p.a = Number(m.a) || 0;
      p.f = !!m.f && p.alive;
      let nx = Number(m.x), ny = Number(m.y);
      if (!isFinite(nx) || !isFinite(ny) || !p.alive) return;
      // Movimento é calculado no cliente (sem lag); o servidor só valida
      const maxd = PSPEED * dt * 1.5 + 12, dx = nx - p.x, dy = ny - p.y, d = Math.hypot(dx, dy);
      let fix = false;
      if (d > maxd) { nx = p.x + (dx / d) * maxd; ny = p.y + (dy / d) * maxd; fix = d > 80; }
      if (hitsWall(nx, ny, PR - 2)) fix = true; else { p.x = nx; p.y = ny; }
      if (fix) send(ws, { t: "fix", x: p.x, y: p.y });
    }
  });
  ws.on("close", () => { leaveRoom(ws); broadcastRooms(); });
  ws.on("error", (e) => console.error("Erro no socket:", e.message));
});

setInterval(() => {
  wss.clients.forEach((ws) => { if (ws.isAlive === false) return ws.terminate(); ws.isAlive = false; ws.ping(); });
}, 30000);

server.listen(PORT, () => console.log(`Servidor ouvindo na porta ${PORT}`));
