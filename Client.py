from ursina import *
from ursina.prefabs.first_person_controller import FirstPersonController
import websocket
import _thread
import json

app = Ursina()

window.fps_counter.enabled = True
window.exit_button.visible = False

ground = Entity(model='plane', scale=(800, 1, 800), color=color.dark_gray, collider='box')

def build_city():
    for x in range(-300, 350, 80):
        for z in range(-300, 350, 80):
            if abs(x) < 30 and abs(z) < 30:
                continue 
            
            h_size = 16
            h_height = 8
            Entity(model='cube', position=(x, h_height/2, z + h_size/2), scale=(h_size, h_height, 0.5), color=color.brown, collider='box')
            Entity(model='cube', position=(x, h_height/2, z - h_size/2), scale=(h_size, h_height, 0.5), color=color.brown, collider='box')
            Entity(model='cube', position=(x - h_size/2, h_height/2, z), scale=(0.5, h_height, h_size), color=color.brown, collider='box')
            
            Entity(model='cube', position=(x + h_size/2, h_height/2, z + 4), scale=(0.5, h_height, 8), color=color.brown, collider='box')
            Entity(model='cube', position=(x + h_size/2, h_height/2, z - 6), scale=(0.5, h_height, 4), color=color.brown, collider='box')
            Entity(model='cube', position=(x, h_height, z), scale=(h_size, 0.5, h_size), color=color.gray, collider='box')

build_city()

player = FirstPersonController(position=(0, 2, 0), speed=12)
player.cursor.color = color.red
current_hp = 100
equipped_weapon = "Unarmed"

hp_text = Text(text=f'HP: {current_hp}', position=(-0.85, 0.45), scale=2, color=color.green)
weapon_text = Text(text=f'Arma: {equipped_weapon}', position=(-0.85, 0.38), scale=1.5, color=color.yellow)

remote_players = {}
remote_bots = {}
ground_items = {}
ground_vehicles = {}
ws_connection = None

def on_message(ws, message):
    data = json.loads(message)
    if data.get("type") == "state_update":
        p_data = data.get("players", {})
        for p_id, p_info in p_data.items():
            if f"player_{id(ws_connection)}" in p_id:
                continue
            if p_id not in remote_players:
                remote_players[p_id] = Entity(model='cube', color=color.blue, scale=(1.5, 3, 1.5), position=(p_info['x'], p_info['y'], p_info['z']))
            else:
                remote_players[p_id].position = (p_info['x'], p_info['y'], p_info['z'])
        
        for p_id in list(remote_players.keys()):
            if p_id not in p_data:
                destroy(remote_players[p_id])
                del remote_players[p_id]

        b_data = data.get("bots", {})
        for b_id, b_info in b_data.items():
            if b_id not in remote_bots:
                remote_bots[b_id] = Entity(model='cube', color=color.orange, scale=(1.5, 3, 1.5), position=(b_info['x'], b_info['y'], b_info['z']))
            else:
                remote_bots[b_id].position = (b_info['x'], b_info['y'], b_info['z'])
                
        for b_id in list(remote_bots.keys()):
            if b_id not in b_data:
                destroy(remote_bots[b_id])
                del remote_bots[b_id]

        it_data = data.get("items", [])
        current_item_ids = [it['id'] for it in it_data]
        for it in it_data:
            i_id = it['id']
            if i_id not in ground_items:
                col = color.cyan if it['type'] == 'weapon' else color.green
                ground_items[i_id] = Entity(
                    model='sphere' if it['type'] == 'medkit' else 'cube',
                    color=col,
                    scale=(1, 1, 1) if it['type'] == 'medkit' else (1.5, 0.4, 0.4),
                    position=(it['x'], 0.5, it['z']),
                    item_type=it['type'],
                    item_name=it['name']
                )

        for i_id in list(ground_items.keys()):
            if i_id not in current_item_ids:
                destroy(ground_items[i_id])
                del ground_items[i_id]

        v_data = data.get("vehicles", [])
        for v in v_data:
            v_id = v['id']
            if v_id not in ground_vehicles:
                ground_vehicles[v_id] = Entity(model='cube', color=color.red, scale=(3, 2, 5), position=(v['x'], 1, v['z']), collider='box')

def start_websocket():
    global ws_connection
    server_url = "wss://rdsk-1.onrender.com/"
    ws_connection = websocket.WebSocketApp(
        server_url,
        on_message=on_message
    )
    ws_connection.run_forever()

_thread.start_new_thread(start_websocket, ())

def update():
    global equipped_weapon, current_hp
    if ws_connection and ws_connection.sock and ws_connection.sock.connected:
        pos_data = {
            "type": "move",
            "x": player.x,
            "y": player.y,
            "z": player.z
        }
        try:
            ws_connection.send(json.dumps(pos_data))
        except:
            pass

    for i_id, item_entity in list(ground_items.items()):
        if distance(player.position, item_entity.position) < 2.5:
            if item_entity.item_type == "weapon":
                equipped_weapon = item_entity.item_name
                weapon_text.text = f'Arma: {equipped_weapon}'
            elif item_entity.item_type == "medkit":
                current_hp = min(100, current_hp + 50)
                hp_text.text = f'HP: {current_hp}'
                if ws_connection:
                    ws_connection.send(json.dumps({"type": "heal"}))

            if ws_connection:
                ws_connection.send(json.dumps({"type": "pickup_item", "item_id": i_id}))
            destroy(item_entity)
            del ground_items[i_id]
            break

def input(key):
    if key == 'left mouse down':
        hit_info = raycast(player.camera_pivot.world_position, player.camera_pivot.forward, distance=100)
        if hit_info.hit:
            if hit_info.entity in remote_bots.values() or hit_info.entity in remote_players.values():
                hit_info.entity.color = color.red

app.run()
