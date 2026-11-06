const http = require("http");
const { WebSocketServer, WebSocket } = require("ws");

// O Render define a porta pela variável PORT
const PORT = process.env.PORT || 10000;

// Servidor HTTP (necessário para health check e para o upgrade para WebSocket)
const server = http.createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "Content-Type": "text/plain" });
    return res.end("ok");
  }
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("Servidor WebSocket rodando");
});

const wss = new WebSocketServer({ server });

// Heartbeat: evita que o Render derrube conexões ociosas
function heartbeat() {
  this.isAlive = true;
}

wss.on("connection", (ws, req) => {
  ws.isAlive = true;
  ws.on("pong", heartbeat);

  const ip = req.headers["x-forwarded-for"] || req.socket.remoteAddress;
  console.log(`Cliente conectado: ${ip} (total: ${wss.clients.size})`);

  ws.send(JSON.stringify({ type: "welcome", message: "Conectado ao servidor!" }));

  ws.on("message", (data) => {
    const text = data.toString();
    console.log("Recebido:", text);

    // Reenvia a mensagem para todos os outros clientes (broadcast)
    wss.clients.forEach((client) => {
      if (client !== ws && client.readyState === WebSocket.OPEN) {
        client.send(text);
      }
    });
  });

  ws.on("close", () => {
    console.log(`Cliente desconectado (total: ${wss.clients.size})`);
  });

  ws.on("error", (err) => console.error("Erro no socket:", err.message));
});

// Ping a cada 30s; remove quem não responde
const interval = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.isAlive === false) return ws.terminate();
    ws.isAlive = false;
    ws.ping();
  });
}, 30000);

wss.on("close", () => clearInterval(interval));

server.listen(PORT, () => {
  console.log(`Servidor ouvindo na porta ${PORT}`);
});
