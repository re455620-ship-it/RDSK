const { WebSocketServer } = require('ws');

// Porta dinâmica fornecida pelo Render ou padrão 8080 para testes locais
const PORT = process.env.PORT || 8080;

// Inicializa o servidor WebSocket
const wss = new WebSocketServer({ port: PORT }, () => {
    console.log(`Servidor WSS rodando com sucesso na porta ${PORT}`);
});

// Lista para controlar os clientes conectados
const clients = new Set();

wss.on('connection', (ws, req) => {
    const ip = req.socket.remoteAddress;
    console.log(`[+] Novo jogador conectado: ${ip}`);
    
    clients.add(ws);

    // Quando o servidor recebe dados de um cliente (pacotes do jogo/movimentos/chat)
    ws.on('message', (message, isBinary) => {
        // Envia os dados para todos os outros jogadores conectados (sistema de broadcast)
        for (const client of clients) {
            if (client !== ws && client.readyState === 1) { // 1 significa conexão aberta (OPEN)
                client.send(message, { binary: isBinary });
            }
        }
    });

    // Quando o jogador sai ou perde a conexão
    ws.on('close', () => {
        console.log(`[-] Jogador desconectado: ${ip}`);
        clients.delete(ws);
    });

    // Tratamento de erros para o servidor não cair
    ws.on('error', (error) => {
        console.log(`[!] Erro na conexão do cliente: ${error.message}`);
        clients.delete(ws);
    });
});

// Intervalo de ping para evitar que conexões ociosas caiam antes do tempo no Render
const heartbeat = setInterval(() => {
    wss.clients.forEach((ws) => {
        if (ws.readyState === 1) {
            ws.ping();
        }
    });
}, 30000);

wss.on('close', () => {
    clearInterval(heartbeat);
});
