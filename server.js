
const WebSocket = require("ws");
const { randomUUID } = require("crypto");

const PORT = process.env.PORT || 10000;
const MAX_PLAYERS = 10;
const TICK_RATE = 30;

const wss = new WebSocket.Server({
  port: PORT,
  perMessageDeflate: false
});

const players = new Map();

function send(ws, data) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

function broadcast(data, except = null) {
  const message = JSON.stringify(data);

  for (const client of wss.clients) {
    if (client !== except && client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  }
}

wss.on("connection", (ws) => {
  if (players.size >= MAX_PLAYERS) {
    send(ws, { type: "full", message: "Servidor lotado!" });
    ws.close();
    return;
  }

  const id = randomUUID();

  const player = {
    id,
    name: "Jogador",
    x: 0,
    y: 0,
    z: 0,
    rotation: 0,
    hp: 100,
    alive: true
  };

  players.set(id, player);

  send(ws, {
    type: "welcome",
    id,
    players: Array.from(players.values())
  });

  broadcast({
    type: "playerJoined",
    player
  }, ws);

  ws.on("message", (raw) => {
    try {
      if (raw.length > 4096) return;

      const data = JSON.parse(raw.toString());
      const current = players.get(id);

      if (!current) return;

      switch (data.type) {
        case "move": {
          const { x, y, z, rotation } = data;

          if (![x, y, z, rotation].every(Number.isFinite)) return;

          if (
            Math.abs(x) > 100000 ||
            Math.abs(y) > 100000 ||
            Math.abs(z) > 100000
          ) return;

          current.x = x;
          current.y = y;
          current.z = z;
          current.rotation = rotation;

          break;
        }

        case "chat": {
          if (typeof data.message !== "string") return;

          const message = data.message.trim().slice(0, 200);

          if (!message) return;

          broadcast({
            type: "chat",
            playerId: id,
            name: current.name,
            message,
            timestamp: Date.now()
          });

          break;
        }

        case "setName": {
          if (typeof data.name !== "string") return;

          const name = data.name.trim().slice(0, 20);

          if (name.length < 2) return;

          current.name = name;

          broadcast({
            type: "playerUpdated",
            player: current
          });

          break;
        }

        case "damage": {
          // Base inicial: não aceita dano arbitrário de clientes.
          // O combate será validado pelo servidor posteriormente.
          break;
        }
      }
    } catch {
      // Ignora mensagens inválidas.
    }
  });

  ws.on("close", () => {
    players.delete(id);

    broadcast({
      type: "playerLeft",
      id
    });
  });
});

setInterval(() => {
  if (players.size === 0) return;

  broadcast({
    type: "worldUpdate",
    players: Array.from(players.values())
  });
}, 1000 / TICK_RATE);

wss.on("listening", () => {
  console.log(`Servidor GTA RPG rodando na porta ${PORT}`);
  console.log(`Limite: ${MAX_PLAYERS} jogadores`);
});

console.log("Iniciando servidor multiplayer...");
