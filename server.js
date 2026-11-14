const WebSocket = require('ws');
const PORT = process.env.PORT || 8080;
const wss = new WebSocket.Server({ port: PORT });

const DANO_CORPO = [9, 8, 17, 20, 10];
const DANO_HEADSHOT = 120;
const MAX_JOGADORES = 6; // 3v3

// Mapa 12x12 (1 = Parede, 0 = Chão livre)
const MAPA = [
    [1,1,1,1,1,1,1,1,1,1,1,1],
    [1,0,0,0,0,0,0,0,0,0,0,1],
    [1,0,1,1,0,0,0,0,1,1,0,1],
    [1,0,1,0,0,0,0,0,0,1,0,1],
    [1,0,0,0,0,1,1,0,0,0,0,1],
    [1,0,0,0,0,1,1,0,0,0,0,1],
    [1,0,0,0,0,0,0,0,0,0,0,1],
    [1,0,1,0,0,0,0,0,0,1,0,1],
    [1,0,1,1,0,0,0,0,1,1,0,1],
    [1,0,0,0,0,0,0,0,0,0,0,1],
    [1,0,0,0,0,0,0,0,0,0,0,1],
    [1,1,1,1,1,1,1,1,1,1,1,1]
];

let jogadores = {};

function escolherTime() {
    let azul = 0, vermelho = 0;
    for (let id in jogadores) {
        if (jogadores[id].time === 'azul') azul++;
        if (jogadores[id].time === 'vermelho') vermelho++;
    }
    return azul <= vermelho ? 'azul' : 'vermelho';
}

function broadcast(dados, ignorarId = null) {
    const msg = JSON.stringify(dados);
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN && client.id !== ignorarId) {
            client.send(msg);
        }
    });
}

wss.on('connection', (ws) => {
    if (Object.keys(jogadores).length >= MAX_JOGADORES) {
        ws.send(JSON.stringify({ tipo: 'erro', mensagem: 'Sala 3v3 cheia!' }));
        ws.close();
        return;
    }

    const id = 'p_' + Math.random().toString(36).substr(2, 5);
    ws.id = id;
    const time = escolherTime();

    jogadores[id] = {
        id: id,
        time: time,
        x: time === 'azul' ? 1.5 : 10.5,
        y: time === 'azul' ? 1.5 : 10.5,
        angulo: time === 'azul' ? 0 : Math.PI,
        hp: 100
    };

    ws.send(JSON.stringify({
        tipo: 'init',
        seuId: id,
        seuTime: time,
        mapa: MAPA,
        jogadores: jogadores
    }));

    broadcast({ tipo: 'novoJogador', jogador: jogadores[id] }, id);

    ws.on('message', (mensagem) => {
        let data;
        try { data = JSON.parse(mensagem); } catch (e) { return; }
        const p = jogadores[id];
        if (!p) return;

        if (data.tipo === 'mover') {
            p.x = data.x;
            p.y = data.y;
            p.angulo = data.angulo;
            broadcast({
                tipo: 'movimento',
                id: id,
                x: p.x,
                y: p.y,
                angulo: p.angulo,
                andando: data.andando
            }, id);
        }

        if (data.tipo === 'atirar') {
            broadcast({ tipo: 'tiroCriado', atiradorId: id }, id);
        }

        if (data.tipo === 'acerto') {
            const alvo = jogadores[data.alvoId];
            if (alvo && alvo.time !== p.time && alvo.hp > 0) {
                const dano = data.headshot ? DANO_HEADSHOT : DANO_CORPO[Math.floor(Math.random() * DANO_CORPO.length)];
                alvo.hp -= dano;

                broadcast({
                    tipo: 'danoAplicado',
                    alvoId: alvo.id,
                    atiradorId: id,
                    dano: dano,
                    headshot: data.headshot,
                    hpRestante: Math.max(0, alvo.hp)
                });

                if (alvo.hp <= 0) {
                    setTimeout(() => {
                        if (jogadores[alvo.id]) {
                            jogadores[alvo.id].hp = 100;
                            jogadores[alvo.id].x = alvo.time === 'azul' ? 1.5 : 10.5;
                            jogadores[alvo.id].y = alvo.time === 'azul' ? 1.5 : 10.5;
                            broadcast({ tipo: 'respawn', jogador: jogadores[alvo.id] });
                        }
                    }, 3000);
                }
            }
        }
    });

    ws.on('close', () => {
        delete jogadores[id];
        broadcast({ tipo: 'desconectou', id: id });
    });
});

console.log(`Servidor 2.5D FPS 3v3 rodando na porta ${PORT}`);
            
