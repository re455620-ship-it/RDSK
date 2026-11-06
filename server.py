const WebSocket = require('ws');

const PORT = process.env.PORT || 8765;
const wss = new WebSocket.Server({ port: PORT });

const MAX_PLAYERS = 10;
const MAP_SIZE = 400;

let players = {};
let bots = {};
let items = [];
let vehicles = [];

const WEAPONS_LIST = ["SVD", "SMS", "AK447", "AWM"];

function spawnInitialWorld() {
    items = [];
    // Spawna armas pelo chão e casas
    for (let i = 0; i < 40; i++) {
        const wType = WEAPONS_LIST[Math.floor(Math.random() * WEAPONS_LIST.length)];
        items.push({
            id: `item_${i}`,
            type: "weapon",
            name: wType,
            x: Math.floor(Math.random() * (MAP_SIZE * 2)) - MAP_SIZE,
            z: Math.floor(Math.random() * (MAP_SIZE * 2)) - MAP_SIZE
        });
    }
    // Spawna Kits Médicos
    for (let i = 40; i < 60; i++) {
        items.push({
            id: `item_${i}`,
            type: "medkit",
            name: "Medkit",
            x: Math.floor(Math.random() * (MAP_SIZE * 2)) - MAP_SIZE,
            z: Math.floor(Math.random() * (MAP_SIZE * 2)) - MAP_SIZE
        });
    }
    // Spawna veículos pela cidade
    vehicles = [];
    for (let i = 0; i < 8; i++) {
        vehicles.push({
            id: `car_${i}`,
            x: Math.floor(Math.random() * (MAP_SIZE * 2)) - MAP_SIZE,
            z: Math.floor(Math.random() * (MAP_SIZE * 2)) - MAP_SIZE
        });
    }
}

spawnInitialWorld();

// Gerenciamento de Bots (preenche as vagas vazias até totalizar 10)
function updateBots() {
    const totalReal = Object.keys(players).length;
    const neededBots = Math.max(0, MAX_PLAYERS - totalReal);

    const currentBotIds = Object.keys(bots);
    
    if (currentBotIds.length < neededBots) {
        for (let i = 0; i < neededBots - currentBotIds.length; i++) {
            const bId = `bot_${Math.floor(Math.random() * 9000) + 1000}`;
            bots[bId] = {
                x: Math.floor(Math.random() * (MAP_SIZE * 2)) - MAP_SIZE,
                y: 1,
                z: Math.floor(Math.random() * (MAP_SIZE * 2)) - MAP_SIZE,
                hp: 100,
                is_bot: true
            };
        }
    } else if (currentBotIds.length > neededBots) {
        for (let i = 0; i < currentBotIds.length - neededBots; i++) {
            delete bots[currentBotIds[i]];
        }
    }

    // Movimentação básica dos bots
    for (let bId in bots) {
        bots[bId].x += (Math.random() - 0.5) * 1.5;
        bots[bId].z += (Math.random() - 0.5) * 1.5;
        bots[bId].x = Math.max(-MAP_SIZE, Math.min(MAP_SIZE, bots[bId].x));
        bots[bId].z = Math.max(-MAP_SIZE, Math.min(MAP_SIZE, bots[bId].z));
    }
}

// Loop de envio de estado do jogo (Broadcast a cada 50ms)
setInterval(() => {
    updateBots();
    const state = JSON.stringify({
        type: "state_update",
        players,
        bots,
        items,
        vehicles
    });

    for (let pId in players) {
        const client = players[pId].socket;
        if (client.readyState === WebSocket.OPEN) {
            client.send(state);
        }
    }
}, 50);

wss.on('connection', (ws) => {
    const playerId = `player_${Math.random().toString(36).substr(2, 9)}`;
    players[playerId] = {
        socket: ws,
        x: Math.floor(Math.random() * 100) - 50,
        y: 1,
        z: Math.floor(Math.random() * 100) - 50,
        hp: 100,
        weapon: "Unarmed"
    };

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            if (data.type === 'move') {
                if (players[playerId]) {
                    players[playerId].x = data.x;
                    players[playerId].y = data.y;
                    players[playerId].z = data.z;
                }
            } else if (data.type === 'pickup_item') {
                items = items.filter(it => it.id !== data.item_id);
            } else if (data.type === 'heal') {
                if (players[playerId]) {
                    players[playerId].hp = Math.min(100, players[playerId].hp + 50);
                }
            }
        } catch (e) {
            console.error(e);
        }
    });

    ws.on('close', () => {
        delete players[playerId];
    });
});

console.log(`Servidor WebSocket Node.js rodando na porta ${PORT}`);
