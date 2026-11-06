#!/usr/bin/env python3
"""Battle Royale 2D/3D - servidor 100% Python (aiohttp + WebSocket).
Serve o index.html e o jogo na mesma porta (o Render converte para wss://)."""
import asyncio, colorsys, json, math, os, random, time, traceback
from pathlib import Path
from aiohttp import web, WSMsgType

# ================= CONFIG =================
PORT = int(os.environ.get("PORT", 10000))
TICK = 20                      # atualizações por segundo
DT = 1.0 / TICK
NUM_ROOMS = 3                  # quantidade de servidores (salas)
MAX_HUMANS = 10                # máximo de jogadores reais por servidor
MIN_HUMANS = 1                 # mínimo para iniciar a contagem (bots completam)
FILL_TO = 12                   # total de lutadores na partida (jogadores + bots)
COUNTDOWN = float(os.environ.get("COUNTDOWN", 15))
CELL, COLS, ROWS = 400, 8, 8
WW, WH = CELL * COLS, CELL * ROWS
PR = 14                        # raio do jogador
PSPEED, BSPEED = 190.0, 150.0

WEAPONS = [
    dict(name="Pistola",  cd=0.40, dmg=22, pellets=1, spread=0.03,  range=500,  ammo=-1),
    dict(name="Escopeta", cd=0.85, dmg=14, pellets=7, spread=0.30,  range=300,  ammo=12),
    dict(name="SMG",      cd=0.09, dmg=10, pellets=1, spread=0.10,  range=450,  ammo=60),
    dict(name="Rifle",    cd=0.13, dmg=17, pellets=1, spread=0.05,  range=750,  ammo=45),
    dict(name="Sniper",   cd=1.10, dmg=80, pellets=1, spread=0.005, range=1400, ammo=8),
]
# tipos de loot: 1-4 armas, 5 kit médico, 6 colete
LOOT_TABLE = [(1, 14), (2, 18), (3, 14), (4, 6), (5, 28), (6, 20)]
# (espera antes, tempo de fechamento, raio final)
ZONE_PH = [(30, 25, 1100), (25, 20, 700), (20, 15, 400), (15, 12, 200), (12, 10, 60), (10, 8, 0)]
BOT_NAMES = ["Zé", "Bia", "Rafa", "Luna", "Tico", "Nina", "Beto", "Duda", "Caio", "Lara", "Theo", "Mel", "Gui", "Isa"]

# ================= MAPA (casas quadradas) =================
HOUSES, GRID = [], {}
_rg = random.Random(1337)
for i in range(COLS):
    for j in range(ROWS):
        for sx in (0, 1):
            for sy in (0, 1):
                if _rg.random() < 0.25:
                    continue
                s = round(70 + _rg.random() * 30)
                cx, cy = i * CELL + 70 + sx * 130 + 65, j * CELL + 70 + sy * 130 + 65
                h = (round(cx - s / 2), round(cy - s / 2), s, s)
                HOUSES.append(h)
                GRID.setdefault((i, j), []).append(h)


def hits_wall(x, y, r=PR):
    if x < r or y < r or x > WW - r or y > WH - r:
        return True
    for hx, hy, hw, hh in GRID.get((int(x // CELL), int(y // CELL)), ()):
        cx = hx if x < hx else (hx + hw if x > hx + hw else x)
        cy = hy if y < hy else (hy + hh if y > hy + hh else y)
        if (x - cx) ** 2 + (y - cy) ** 2 < r * r:
            return True
    return False


def try_move(e, mx, my):
    if not hits_wall(e.x + mx, e.y + my):
        e.x += mx; e.y += my; return True
    if mx and not hits_wall(e.x + mx, e.y):
        e.x += mx; return True
    if my and not hits_wall(e.x, e.y + my):
        e.y += my; return True
    return False


def ray_box(ox, oy, dx, dy, h):
    hx, hy, hw, hh = h
    tmin, tmax = 0.0, 1e9
    for o, d, lo, hi in ((ox, dx, hx, hx + hw), (oy, dy, hy, hy + hh)):
        if abs(d) < 1e-9:
            if o < lo or o > hi:
                return 1e9
        else:
            t1, t2 = (lo - o) / d, (hi - o) / d
            if t1 > t2:
                t1, t2 = t2, t1
            tmin, tmax = max(tmin, t1), min(tmax, t2)
            if tmin > tmax:
                return 1e9
    return tmin


def ray_circle(ox, oy, dx, dy, cx, cy, r):
    fx, fy = cx - ox, cy - oy
    t = fx * dx + fy * dy
    if t < 0:
        return 1e9
    px, py = fx - t * dx, fy - t * dy
    d2 = px * px + py * py
    if d2 > r * r:
        return 1e9
    return max(0.0, t - math.sqrt(r * r - d2))


def wall_dist(x, y, dx, dy, maxd):
    ex, ey = x + dx * maxd, y + dy * maxd
    lox, hix, loy, hiy = min(x, ex), max(x, ex), min(y, ey), max(y, ey)
    best = maxd
    for h in HOUSES:
        hx, hy, hw, hh = h
        if hx > hix or hx + hw < lox or hy > hiy or hy + hh < loy:
            continue
        t = ray_box(x, y, dx, dy, h)
        if t < best:
            best = t
    return best


def los(x1, y1, x2, y2):
    dx, dy = x2 - x1, y2 - y1
    d = math.hypot(dx, dy)
    return d < 1 or wall_dist(x1, y1, dx / d, dy / d, d) >= d - 1


def open_spot(others=(), mind=0):
    for _ in range(60):
        x, y = random.uniform(60, WW - 60), random.uniform(60, WH - 60)
        if hits_wall(x, y, PR + 4):
            continue
        if any(math.hypot(o.x - x, o.y - y) < mind for o in others):
            continue
        return x, y
    return WW / 2, WH / 2


def color_for(i):
    r, g, b = colorsys.hsv_to_rgb((i * 0.618033) % 1, 0.7, 0.95)
    return "#%02x%02x%02x" % (int(r * 255), int(g * 255), int(b * 255))


# ================= ENTIDADES =================
_next_id = 0
def new_id():
    global _next_id
    _next_id += 1
    return _next_id


class Actor:
    def __init__(self, name, color, bot=False, ws=None):
        self.id, self.name, self.color, self.bot, self.ws = new_id(), name, color, bot, ws
        self.x = self.y = self.a = 0.0
        self.f = False
        self.last_shot, self.last_move = 0.0, time.monotonic()
        self.goal, self.enemy, self.next_think, self.react = None, None, 0.0, 0.0
        self.side, self.err, self.stuck, self.zone_run = random.choice((-1, 1)), 0.0, 0, False
        self.reset_stats()

    def reset_stats(self):
        self.hp, self.sh, self.alive = 100.0, 0.0, True
        self.weapon, self.ammo, self.kills, self.place = 0, -1, 0, 0


class Zone:
    def __init__(self, now):
        self.cx, self.cy, self.r = WW / 2, WH / 2, 2300.0
        self.i, self.state, self.until = 0, "wait", now + ZONE_PH[0][0]
        self.plan()

    def plan(self):
        tr = ZONE_PH[self.i][2]
        off = max(0.0, self.r - tr) * 0.8 * random.random()
        ang = random.uniform(0, 6.283)
        self.tcx, self.tcy, self.tr = self.cx + math.cos(ang) * off, self.cy + math.sin(ang) * off, tr

    def dps(self):
        return 1.5 + self.i * 1.0

    def update(self, now):
        if self.state == "wait" and now >= self.until:
            self.state, self.sr, self.scx, self.scy = "shrink", self.r, self.cx, self.cy
            self.dur = ZONE_PH[self.i][1]
            self.until = now + self.dur
        elif self.state == "shrink":
            f = min(1.0, 1 - (self.until - now) / self.dur)
            self.cx = self.scx + (self.tcx - self.scx) * f
            self.cy = self.scy + (self.tcy - self.scy) * f
            self.r = self.sr + (self.tr - self.sr) * f
            if now >= self.until:
                self.i += 1
                if self.i < len(ZONE_PH):
                    self.state, self.until = "wait", now + ZONE_PH[self.i][0]
                    self.plan()
                else:
                    self.state, self.until = "done", now


class Room:
    def __init__(self, rid):
        self.id, self.actors, self.ci = rid, {}, 0
        self.reset()

    def reset(self):
        self.phase, self.t0, self.t_end = "lobby", None, 0.0
        self.loot, self.next_loot, self.dirty = [], 1, True
        self.shots, self.feed, self.out, self.zone, self.n, self.winner = [], [], [], None, 0, ""

    def humans(self):
        return [a for a in self.actors.values() if not a.bot]


class Conn:
    def __init__(self, ws):
        self.ws, self.room, self.pid = ws, None, None


ROOMS = [Room(i + 1) for i in range(NUM_ROOMS)]
CONNS = set()


async def send(ws, obj):
    try:
        await ws.send_str(obj if isinstance(obj, str) else json.dumps(obj, separators=(",", ":")))
    except Exception:
        pass


async def broadcast_rooms():
    msg = json.dumps({"t": "rooms", "rooms": [
        {"id": r.id, "count": len(r.humans()), "max": MAX_HUMANS, "phase": r.phase} for r in ROOMS]})
    await asyncio.gather(*(send(c.ws, msg) for c in list(CONNS) if not c.room))


def push_roster(r):
    msg = {"t": "roster", "players": [{"id": a.id, "name": a.name, "color": a.color, "bot": a.bot} for a in r.actors.values()]}
    for h in r.humans():
        r.out.append((h.ws, msg))


def leave_room(conn):
    r = conn.room
    if not r:
        return
    r.actors.pop(conn.pid, None)
    conn.room = conn.pid = None
    if not r.humans():
        r.actors = {}
        r.reset()
    else:
        push_roster(r)


# ================= LÓGICA DO JOGO =================
def make_loot(r):
    r.loot = []
    for h in random.sample(HOUSES, int(len(HOUSES) * 0.4)):
        x = h[0] + h[2] / 2 + random.uniform(-h[2] / 3, h[2] / 3)
        y = h[1] + h[3] + 18                      # loot na porta da casa
        if hits_wall(x, y, 10):
            continue
        t = random.choices([a for a, _ in LOOT_TABLE], [b for _, b in LOOT_TABLE])[0]
        r.loot.append([r.next_loot, round(x), round(y), t])
        r.next_loot += 1
    r.dirty = True


def start_match(r, now):
    hs = r.humans()
    r.actors = {a.id: a for a in hs}
    r.shots, r.feed = [], []
    for a in hs:
        a.reset_stats()
    for name in random.sample(BOT_NAMES, max(0, min(FILL_TO - len(hs), len(BOT_NAMES)))):
        b = Actor(name + " (bot)", color_for(r.ci), bot=True)
        r.ci += 1
        r.actors[b.id] = b
    placed = []
    for a in r.actors.values():
        a.x, a.y = open_spot(placed, 350)
        placed.append(a)
        if a.ws:
            r.out.append((a.ws, {"t": "fix", "x": a.x, "y": a.y}))
    make_loot(r)
    r.zone, r.phase = Zone(now), "playing"
    push_roster(r)


def back_to_lobby(r):
    hs = r.humans()
    r.actors = {a.id: a for a in hs}
    placed = []
    for a in hs:
        a.reset_stats()
        a.x, a.y = open_spot(placed, 200)
        placed.append(a)
        r.out.append((a.ws, {"t": "fix", "x": a.x, "y": a.y}))
    r.loot, r.zone, r.phase, r.t0, r.dirty = [], None, "lobby", None, True
    push_roster(r)


def kill(r, tgt, src, wname):
    n = sum(1 for x in r.actors.values() if x.alive)
    tgt.alive, tgt.hp, tgt.f, tgt.place = False, 0, False, n
    if src and src is not tgt:
        src.kills += 1
    by = src.name if src else "Zona"
    r.feed.append([by, tgt.name, wname])
    if tgt.ws:
        r.out.append((tgt.ws, {"t": "dead", "place": n, "kills": tgt.kills, "by": by}))


def fire(r, a, now):
    w = WEAPONS[a.weapon]
    if now - a.last_shot < w["cd"]:
        return
    a.last_shot = now
    others = [o for o in r.actors.values() if o.alive and o is not a]
    for _ in range(w["pellets"]):
        ang = a.a + (random.random() - 0.5) * 2 * w["spread"]
        dx, dy = math.cos(ang), math.sin(ang)
        best, tgt = wall_dist(a.x, a.y, dx, dy, w["range"]), None
        for o in others:
            t = ray_circle(a.x, a.y, dx, dy, o.x, o.y, PR)
            if t < best:
                best, tgt = t, o
        if tgt and tgt.alive:
            d = float(w["dmg"])
            if tgt.sh > 0:                       # colete absorve primeiro
                ab = min(tgt.sh, d); tgt.sh -= ab; d -= ab
            tgt.hp -= d
            if tgt.hp <= 0:
                kill(r, tgt, a, w["name"])
        r.shots.append([round(a.x + dx * 20), round(a.y + dy * 20), round(a.x + dx * best), round(a.y + dy * best)])
    if w["ammo"] > 0:
        a.ammo -= 1
        if a.ammo <= 0:
            a.weapon, a.ammo = 0, -1


def bot_ai(r, b, now, alive):
    z = r.zone
    if now >= b.next_think:
        b.next_think = now + 0.35 + random.random() * 0.3
        b.err = random.uniform(-0.1, 0.1)
        prev, b.enemy, best = b.enemy, None, 520 * 520
        for o in alive:
            if o is b or not o.alive:
                continue
            d = (o.x - b.x) ** 2 + (o.y - b.y) ** 2
            if d < best and los(b.x, b.y, o.x, o.y):
                best, b.enemy = d, o
        if b.enemy and b.enemy is not prev:
            b.react = now + 0.5
        dz = math.hypot(b.x - z.cx, b.y - z.cy)
        if dz > z.r - 120 or (z.state != "wait" and math.hypot(b.x - z.tcx, b.y - z.tcy) > z.tr - 150):
            ang = random.uniform(0, 6.283)
            b.goal = (z.tcx + math.cos(ang) * z.tr * 0.5, z.tcy + math.sin(ang) * z.tr * 0.5)
            b.zone_run = True
        else:
            b.zone_run = False
            if b.goal is None or random.random() < 0.12:
                b.goal = pick_goal(r, b)
    e, mx, my = b.enemy, 0.0, 0.0
    if e and e.alive:
        dx, dy = e.x - b.x, e.y - b.y
        d = math.hypot(dx, dy) or 1.0
        b.a = math.atan2(dy, dx) + b.err
        b.f = now >= b.react and d < WEAPONS[b.weapon]["range"] * 0.9
        if b.zone_run and b.goal:
            gx, gy = b.goal[0] - b.x, b.goal[1] - b.y
            g = math.hypot(gx, gy) or 1.0
            mx, my = gx / g, gy / g
        elif d > 280:
            mx, my = dx / d, dy / d
        elif d < 130:
            mx, my = -dx / d, -dy / d
        else:
            mx, my = -dy / d * b.side, dx / d * b.side
    else:
        b.f = False
        if b.goal:
            gx, gy = b.goal[0] - b.x, b.goal[1] - b.y
            g = math.hypot(gx, gy)
            if g < 25:
                b.goal = None
            else:
                mx, my = gx / g, gy / g
                b.a = math.atan2(my, mx)
    if mx or my:
        st = BSPEED * DT
        if try_move(b, mx * st, my * st):
            b.stuck = 0
        else:
            try_move(b, -my * b.side * st, mx * b.side * st)
            b.stuck += 1
            if b.stuck > 10:
                b.goal, b.side, b.stuck = None, -b.side, 0


def pick_goal(r, b):
    best, bd = None, 800 * 800
    for l in r.loot:
        t = l[3]
        useful = (t <= 4 and (b.weapon == 0 or random.random() < 0.3)) or (t == 5 and b.hp < 80) or (t == 6 and b.sh < 50)
        d = (l[1] - b.x) ** 2 + (l[2] - b.y) ** 2
        if useful and d < bd:
            best, bd = l, d
    if best:
        return (best[1], best[2])
    for _ in range(10):
        x, y = b.x + random.uniform(-450, 450), b.y + random.uniform(-450, 450)
        if not hits_wall(x, y):
            return (x, y)
    return None


def simulate(r, now):
    z = r.zone
    z.update(now)
    alive = [a for a in r.actors.values() if a.alive]
    for a in alive:
        if not a.alive:
            continue
        if a.bot:
            bot_ai(r, a, now, alive)
        if a.f:
            fire(r, a, now)
    alive = [a for a in alive if a.alive]
    for a in alive:                                  # dano fora da zona
        if math.hypot(a.x - z.cx, a.y - z.cy) > z.r:
            a.hp -= z.dps() * DT
            if a.hp <= 0:
                kill(r, a, None, "Zona")
    alive = [a for a in alive if a.alive]
    for a in alive:                                  # pegar loot
        for l in list(r.loot):
            if (l[1] - a.x) ** 2 + (l[2] - a.y) ** 2 > 26 * 26:
                continue
            t = l[3]
            if t <= 4:
                if a.weapon == t:
                    a.ammo += WEAPONS[t]["ammo"]
                else:
                    a.weapon, a.ammo = t, WEAPONS[t]["ammo"]
            elif t == 5:
                if a.hp >= 100:
                    continue
                a.hp = min(100.0, a.hp + 50)
            else:
                if a.sh >= 100:
                    continue
                a.sh = min(100.0, a.sh + 50)
            r.loot.remove(l)
            r.dirty = True
    if len(alive) <= 1 or not any(not a.bot for a in alive):
        r.phase, r.t_end = "over", now + 8
        r.winner = alive[0].name if len(alive) == 1 else ""
        if len(alive) == 1:
            alive[0].place = 1
        for h in r.humans():
            r.out.append((h.ws, {"t": "result", "place": h.place or 1, "kills": h.kills, "winner": r.winner}))


def state_json(r, now):
    acts = list(r.actors.values())
    m = {"t": "s", "ph": r.phase, "al": sum(1 for a in acts if a.alive),
         "tm": int(math.ceil(r.t0 - now)) if r.phase == "lobby" and r.t0 else 0,
         "p": [[a.id, round(a.x), round(a.y), round(a.a, 2), max(0, round(a.hp)), round(a.sh),
                1 if a.alive else 0, a.weapon, a.ammo, a.kills] for a in acts],
         "e": r.shots}
    if r.zone:
        z = r.zone
        m["z"] = [round(z.cx), round(z.cy), round(z.r), round(z.tcx), round(z.tcy), round(z.tr),
                  1 if z.state == "shrink" else 0, int(math.ceil(max(0, z.until - now)))]
    if r.feed:
        m["k"] = r.feed
    if r.dirty or r.n % 40 == 0:
        m["w"], r.dirty = r.loot, False
    if r.phase == "over":
        m["wn"] = r.winner
    r.shots, r.feed = [], []
    return json.dumps(m, separators=(",", ":"))


async def tick_room(r, now):
    hs = r.humans()
    if not hs:
        return
    r.n += 1
    if r.phase == "lobby":
        if len(hs) >= MIN_HUMANS:
            if r.t0 is None:
                r.t0 = now + COUNTDOWN
            if now >= r.t0:
                start_match(r, now)
        else:
            r.t0 = None
    elif r.phase == "playing":
        simulate(r, now)
    elif r.phase == "over" and now >= r.t_end:
        back_to_lobby(r)
    msg = state_json(r, now)
    out, r.out = r.out, []
    await asyncio.gather(*(send(a.ws, m) for a in hs for m in [msg]), *(send(ws, m) for ws, m in out))


async def game_loop():
    nxt = time.monotonic()
    while True:
        nxt += DT
        now = time.monotonic()
        for r in ROOMS:
            try:
                await tick_room(r, now)
            except Exception:
                traceback.print_exc()
        await asyncio.sleep(max(0.0, nxt - time.monotonic()))


async def rooms_loop():
    while True:
        await asyncio.sleep(2)
        await broadcast_rooms()


# ================= REDE =================
async def join(conn, rid, name):
    if not 1 <= rid <= NUM_ROOMS:
        return
    leave_room(conn)
    r = ROOMS[rid - 1]
    if r.phase != "lobby":
        return await send(conn.ws, {"t": "busy", "room": rid})
    if len(r.humans()) >= MAX_HUMANS:
        await send(conn.ws, {"t": "full", "room": rid})
        return await broadcast_rooms()
    a = Actor(str(name or "Jogador")[:12], color_for(r.ci), ws=conn.ws)
    r.ci += 1
    a.x, a.y = open_spot(r.actors.values(), 200)
    r.actors[a.id] = a
    conn.room, conn.pid = r, a.id
    await send(conn.ws, {"t": "joined", "id": a.id, "room": rid, "ww": WW, "wh": WH, "houses": [list(h) for h in HOUSES]})
    push_roster(r)
    await broadcast_rooms()


async def handle(conn, m):
    t = m.get("t")
    if t == "ping":
        await send(conn.ws, {"t": "pong", "ts": m.get("ts")})
    elif t == "join":
        try:
            rid = int(m.get("room", 0))
        except (TypeError, ValueError):
            return
        await join(conn, rid, m.get("name"))
    elif t == "leave":
        leave_room(conn)
        await send(conn.ws, {"t": "left"})
        await broadcast_rooms()
    elif t == "m" and conn.room:
        a = conn.room.actors.get(conn.pid)
        if not a:
            return
        now = time.monotonic()
        dt = min(now - a.last_move, 0.5)
        a.last_move = now
        try:
            nx, ny, a.a = float(m.get("x")), float(m.get("y")), float(m.get("a", 0))
        except (TypeError, ValueError):
            return
        if not (math.isfinite(nx) and math.isfinite(ny) and math.isfinite(a.a)):
            a.a = 0.0
            return
        a.f = bool(m.get("f")) and a.alive and conn.room.phase == "playing"
        if not a.alive:
            return
        # O movimento é calculado no cliente (sem lag); o servidor só valida
        maxd = PSPEED * dt * 1.5 + 12
        dx, dy = nx - a.x, ny - a.y
        d = math.hypot(dx, dy)
        fix = False
        if d > maxd:
            nx, ny, fix = a.x + dx / d * maxd, a.y + dy / d * maxd, d > 80
        if hits_wall(nx, ny, PR - 2):
            fix = True
        else:
            a.x, a.y = nx, ny
        if fix:
            await send(conn.ws, {"t": "fix", "x": a.x, "y": a.y})


async def index_or_ws(request):
    if request.headers.get("Upgrade", "").lower() == "websocket":
        ws = web.WebSocketResponse(heartbeat=25, max_msg_size=4096)
        await ws.prepare(request)
        conn = Conn(ws)
        CONNS.add(conn)
        await broadcast_rooms()
        try:
            async for msg in ws:
                if msg.type != WSMsgType.TEXT:
                    continue
                try:
                    m = json.loads(msg.data)
                except ValueError:
                    continue
                if isinstance(m, dict):
                    await handle(conn, m)
        finally:
            CONNS.discard(conn)
            leave_room(conn)
            await broadcast_rooms()
        return ws
    f = Path(__file__).parent / "index.html"
    if f.exists():
        return web.FileResponse(f, headers={"Cache-Control": "no-cache"})
    return web.Response(text="Servidor Python rodando")


async def health(request):
    return web.Response(text="ok")


async def on_start(app):
    app["tasks"] = [asyncio.create_task(game_loop()), asyncio.create_task(rooms_loop())]


async def on_stop(app):
    for t in app["tasks"]:
        t.cancel()


def make_app():
    app = web.Application()
    app.router.add_get("/health", health)
    app.router.add_get("/", index_or_ws)
    app.on_startup.append(on_start)
    app.on_cleanup.append(on_stop)
    return app


if __name__ == "__main__":
    web.run_app(make_app(), host="0.0.0.0", port=PORT)
