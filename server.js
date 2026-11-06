// ==============================================================================
// SERVIDOR WEBSOCKET - ZOMBIE CO-OP 3D FPS (server.js)
// Compatível com Render.com, Heroku, Railway e VPS Node.js
// ==============================================================================

const WebSocket = require('ws');
const http = require('http');

const PORT = process.env.PORT || 8080;
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Servidor WebSocket de Zombie Co-op Online rodando perfeitamente!');
});

const wss = new WebSocket.Server({ server });

const BAD_WORDS = [
  'palavrao', 'hack', 'cheater', 'admin', 'moderator', 'fdp', 'porra', 'caralho', 
  'puta', 'viado', 'cu', 'bosta', 'merda', 'cacete', 'nigger', 'fuck', 'shit', 
  'asshole', 'bitch', 'cunt', 'bastard', 'pussy', 'dick', 'nazista', 'hitler'
];

function sanitizeText(text) {
  if (!text) return '';
  let clean = text;
  BAD_WORDS.forEach(word => {
    const regex = new RegExp(word, 'gi');
    clean = clean.replace(regex, '***');
  });
  return clean;
}

const clients = new Map();
let gameState = {
  currentWave: 1,
  zombiesAlive: 0,
  gameStarted: false
};

console.log(`[LOG] Iniciando Servidor WebSocket na porta ${PORT}...`);

function broadcast(data, exceptSocket = null) {
  const payload = JSON.stringify(data);
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN && client !== exceptSocket) {
      client.send(payload);
    }
  });
}

wss.on('connection', (ws, req) => {
  const playerId = 'p_' + Math.random().toString(36).substr(2, 7);
  console.log(`[CONEXÃO] Novo jogador conectado: ID ${playerId}`);

  const playerState = {
    id: playerId,
    name: 'Sobrevivente',
    position: { x: 0, y: 1.7, z: 0 },
    rotation: { yaw: 0, pitch: 0 },
    hp: 100,
    weapon: 'glock',
    isSpectator: false,
    kills: 0
  };

  clients.set(ws, playerState);

  ws.send(JSON.stringify({
    type: 'init',
    id: playerId,
    currentWave: gameState.currentWave,
    players: Array.from(clients.values())
  }));

  broadcast({
    type: 'player_joined',
    player: playerState
  }, ws);

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      const player = clients.get(ws);
      if (!player) return;

      switch (data.type) {
        case 'move':
          if (data.position) player.position = data.position;
          if (data.rotation) player.rotation = data.rotation;
          broadcast({
            type: 'player_moved',
            id: player.id,
            position: player.position,
            rotation: player.rotation
          }, ws);
          break;

        case 'shoot':
          broadcast({
            type: 'player_shot',
            id: player.id,
            origin: data.origin,
            direction: data.direction,
            weaponKey: data.weaponKey
          }, ws);
          break;

        case 'status_update':
          if (data.hp !== undefined) player.hp = data.hp;
          if (data.isSpectator !== undefined) player.isSpectator = data.isSpectator;
          if (data.weaponKey) player.weapon = data.weaponKey;
          if (data.kills !== undefined) player.kills = data.kills;
          broadcast({
            type: 'player_status_changed',
            id: player.id,
            hp: player.hp,
            isSpectator: player.isSpectator,
            weapon: player.weapon,
            kills: player.kills
          }, ws);
          break;

        case 'chat':
          const cleanMsg = sanitizeText(data.message);
          if (cleanMsg.length > 0) {
            broadcast({
              type: 'chat_message',
              id: player.id,
              name: player.name,
              message: cleanMsg
            });
          }
          break;

        case 'set_name':
          const cleanName = sanitizeText(data.name).substr(0, 15);
          player.name = cleanName || 'Sobrevivente';
          broadcast({
            type: 'player_renamed',
            id: player.id,
            name: player.name
          });
          break;

        case 'wave_clear':
          gameState.currentWave++;
          clients.forEach(p => {
            p.isSpectator = false;
            p.hp = 100;
          });
          broadcast({
            type: 'next_wave',
            currentWave: gameState.currentWave
          });
          break;
      }
    } catch (err) {
      console.error('[ERRO] Falha ao processar mensagem JSON:', err);
    }
  });

  ws.on('close', () => {
    const player = clients.get(ws);
    if (player) {
      clients.delete(ws);
      broadcast({
        type: 'player_left',
        id: player.id
      });
    }
  });
});

server.listen(PORT, () => {
  console.log(`[SERVIDOR OK] Rodando na porta ${PORT}`);
});
