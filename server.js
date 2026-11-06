// Servidor do Zombie Labirinto
// - 3 servidores (salas) independentes, até 5 jogadores em cada
// - Repassa (relay) as mensagens de um jogador para os outros do mesmo servidor
// - Também serve o jogo em "/" (public/index.html)
const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 3000;
const SERVERS = 3;
const MAX_PLAYERS = 5;
const MAX_MSGS_PER_SEC = 150;

const rooms = [null];
for (let i = 1; i <= SERVERS; i++) rooms.push(new Set());

const server = http.createServer((req, res) => {
  if (req.url === '/' || req.url === '/index.html') {
    fs.readFile(path.join(__dirname, 'public', 'index.html'), (err, data) => {
      if (err) { res.writeHead(500); res.end('index.html não encontrado'); return; }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(data);
    });
  } else if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, players: rooms.slice(1).map(r => r.size) }));
  } else {
    res.writeHead(404); res.end('Não encontrado');
  }
});

const wss = new WebSocketServer({ server, maxPayload: 16 * 1024 });

const counts = () => rooms.slice(1).map(r => r.size);
const infoMsg = () => JSON.stringify({ t: 'info', c: counts(), max: MAX_PLAYERS });

function broadcastInfo() {
  const msg = infoMsg();
  for (const c of wss.clients) if (c.readyState === 1) c.send(msg);
}

wss.on('connection', (ws) => {
  ws.alive = true;
  ws.slot = 0;
  ws.count = 0;
  ws.winStart = Date.now();
  ws.on('pong', () => { ws.alive = true; });
  ws.send(infoMsg());

  ws.on('message', (data, isBinary) => {
    if (isBinary) return;
    const text = data.toString();

    // Ainda não entrou em nenhum servidor: só aceita "join"
    if (!ws.slot) {
      let m;
      try { m = JSON.parse(text); } catch { return; }
      if (!m || m.t !== 'join') return;
      const n = m.s | 0;
      if (n < 1 || n > SERVERS) return;
      if (rooms[n].size >= MAX_PLAYERS) {
        ws.send(JSON.stringify({ t: 'full', s: n }));
        return;
      }
      rooms[n].add(ws);
      ws.slot = n;
      ws.send(JSON.stringify({ t: 'joined', s: n }));
      broadcastInfo();
      return;
    }

    // Limite simples de mensagens por segundo
    const now = Date.now();
    if (now - ws.winStart > 1000) { ws.winStart = now; ws.count = 0; }
    if (++ws.count > MAX_MSGS_PER_SEC) return;

    // Repassa para os outros jogadores do mesmo servidor
    for (const c of rooms[ws.slot]) {
      if (c !== ws && c.readyState === 1) c.send(text);
    }
  });

  ws.on('close', () => {
    if (ws.slot) { rooms[ws.slot].delete(ws); broadcastInfo(); }
  });
  ws.on('error', () => {});
});

// Derruba conexões mortas
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.alive) { ws.terminate(); continue; }
    ws.alive = false;
    ws.ping();
  }
}, 30000);

server.listen(PORT, () => console.log('Zombie Labirinto rodando na porta ' + PORT));
    
