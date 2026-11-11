const { WebSocketServer } = require('ws');

// O Render fornece a porta dinamicamente através da variável process.env.PORT
const PORT = process.env.PORT || 8080;

// Inicializa o servidor WebSocket
const wss = new WebSocketServer({ port: PORT }, () => {
    console.log(`[SERVIDOR] Servidor WebSocket rodando na porta ${PORT}`);
});

// Armazena todos os clientes conectados
const clients = new Set();

wss.on('connection', (ws, req) => {
    const clientIp = req.socket.remoteAddress;
    console.log(`[CONEXÃO] Novo cliente conectado de: ${clientIp}`);
    
    clients.add(ws);

    // Envia uma mensagem inicial de boas-vindas se necessário (formato texto ou buffer)
    // ws.send('Conectado com sucesso ao servidor WSS!');

    // Trata o recebimento de dados (pacotes do Eaglercraft)
    ws.on('message', (message, isBinary) => {
        // Retransmite a mensagem para todos os outros clientes conectados (Broadcast)
        for (const client of clients) {
            if (client !== ws && client.readyState === 1) { // 1 = OPEN
                client.send(message, { binary: isBinary });
            }
        }
    });

    // Trata desconexões
    ws.on('close', () => {
        console.log(`[DESCONEXÃO] Cliente desconectado: ${clientIp}`);
        clients.delete(ws);
    });

    // Trata erros de soquete
    ws.on('error', (error) => {
        console.error(`[ERRO] Ocorreu um erro na conexão: ${error.message}`);
        clients.delete(ws);
    });
});

// Mantém o servidor ativo contra timeouts curtos enviando pings periódicos
const pingInterval = setInterval(() => {
    wss.clients.forEach((ws) => {
        if (ws.readyState === 1) {
            ws.ping();
        }
    });
}, 30000);

wss.on('close', () => {
    clearInterval(pingInterval);
});
