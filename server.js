import asyncio
import json
import random
import websockets

MAX_PLAYERS = 10
MAP_SIZE = 400

players = {}
bots = {}
items = []
vehicles = []

# Lista de Armas solicitadas
WEAPONS_LIST = ["SVD", "SMS", "AK447", "AWM"]

def spawn_initial_world():
    global items, vehicles
    items = []
    # Spawna armas pelo chão e casas
    for i in range(40):
        w_type = random.choice(WEAPONS_LIST)
        items.append({
            "id": f"item_{i}",
            "type": "weapon",
            "name": w_type,
            "x": random.randint(-MAP_SIZE + 20, MAP_SIZE - 20),
            "z": random.randint(-MAP_SIZE + 20, MAP_SIZE - 20)
        })
    # Spawna Kits Médicos
    for i in range(40, 60):
        items.append({
            "id": f"item_{i}",
            "type": "medkit",
            "name": "Medkit",
            "x": random.randint(-MAP_SIZE + 20, MAP_SIZE - 20),
            "z": random.randint(-MAP_SIZE + 20, MAP_SIZE - 20)
        })
        
    # Spawna carros pelo mapa
    vehicles = [
        {"id": f"car_{i}", "x": random.randint(-MAP_SIZE + 30, MAP_SIZE - 30), "z": random.randint(-MAP_SIZE + 30, MAP_SIZE - 30)}
        for i in range(8)
    ]

spawn_initial_world()

def update_bots():
    total_real = len(players)
    needed_bots = MAX_PLAYERS - total_real
    
    current_bot_ids = list(bots.keys())
    if len(current_bot_ids) < needed_bots:
        for i in range(needed_bots - len(current_bot_ids)):
            b_id = f"bot_{random.randint(1000, 9999)}"
            bots[b_id] = {
                "x": random.randint(-MAP_SIZE + 50, MAP_SIZE - 50),
                "y": 1,
                "z": random.randint(-MAP_SIZE + 50, MAP_SIZE - 50),
                "hp": 100,
                "is_bot": True
            }
    elif len(current_bot_ids) > needed_bots:
        for i in range(len(current_bot_ids) - needed_bots):
            del bots[current_bot_ids[i]]

    # Movimentação simples dos bots pelo mapa
    for b_id, bot in bots.items():
        bot["x"] += random.uniform(-0.5, 0.5)
        bot["z"] += random.uniform(-0.5, 0.5)
        bot["x"] = max(-MAP_SIZE, min(MAP_SIZE, bot["x"]))
        bot["z"] = max(-MAP_SIZE, min(MAP_SIZE, bot["z"]))

async def broadcast_game_state():
    while True:
        update_bots()
        state = {
            "type": "state_update",
            "players": players,
            "bots": bots,
            "items": items,
            "vehicles": vehicles
        }
        payload = json.dumps(state)
        
        for p_id, pdata in list(players.items()):
            try:
                await pdata["socket"].send(payload)
            except:
                pass
        await asyncio.sleep(0.05)

async def handler(websocket):
    player_id = f"player_{id(websocket)}"
    players[player_id] = {
        "socket": websocket,
        "x": random.randint(-50, 50),
        "y": 1,
        "z": random.randint(-50, 50),
        "hp": 100,
        "weapon": "Unarmed"
    }
    
    try:
        async for message in websocket:
            data = json.loads(message)
            msg_type = data.get("type")
            
            if msg_type == "move":
                players[player_id]["x"] = data["x"]
                players[player_id]["y"] = data["y"]
                players[player_id]["z"] = data["z"]
            elif msg_type == "pickup_item":
                item_id = data.get("item_id")
                global items
                items = [it for it in items if it["id"] != item_id]
            elif msg_type == "heal":
                players[player_id]["hp"] = min(100, players[player_id]["hp"] + 50)
    except Exception as e:
        print(f"Desconexão: {e}")
    finally:
        if player_id in players:
            del players[player_id]

async def main():
    import os
    port = int(os.environ.get("PORT", 8765))
    
    async with websockets.serve(handler, "0.0.0.0", port):
        print(f"Servidor WebSocket rodando na porta {port}")
        await broadcast_game_state()

if __name__ == "__main__":
    asyncio.run(main())
