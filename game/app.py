import os
import random
import string
import pymysql
from datetime import datetime, timedelta
from flask import Flask, render_template, request, session, jsonify, send_from_directory, Response
from flask_socketio import SocketIO, emit, join_room, leave_room
from werkzeug.security import generate_password_hash, check_password_hash

from config import MYSQL_CONFIG, DB_NAME, DATABASE_URL

app = Flask(__name__, static_folder="static", template_folder="templates")
app.config["SECRET_KEY"] = "kids-vs-secret"
socketio = SocketIO(app, cors_allowed_origins="*", async_mode="threading")

# 跨域：前端在 forest-battle-server.onrender.com，API 在 forest-backend-xxx.onrender.com，浏览器会先发 OPTIONS，必须返回 CORS 头
@app.before_request
def handle_cors_preflight():
    if request.method == "OPTIONS":
        r = Response("", status=204)
        r.headers["Access-Control-Allow-Origin"] = "*"
        r.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
        r.headers["Access-Control-Allow-Headers"] = "Content-Type"
        return r


@app.after_request
def add_cors_headers(resp):
    resp.headers["Access-Control-Allow-Origin"] = "*"
    resp.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
    resp.headers["Access-Control-Allow-Headers"] = "Content-Type"
    return resp


def get_db():
    """获取数据库连接。有 DATABASE_URL 时用 PostgreSQL（Render），否则用 MySQL（本地）。"""
    if DATABASE_URL:
        import psycopg2
        from psycopg2.extras import RealDictCursor
        # Render 的 PostgreSQL 用 postgres:// 开头，部分驱动需要 postgresql://
        url = DATABASE_URL
        if url.startswith("postgres://"):
            url = "postgresql://" + url[9:]
        conn = psycopg2.connect(url)
        # 包装成 .cursor() 返回 dict 游标，与 pymysql DictCursor 行为一致
        class DictCursorConn:
            def __init__(self, c):
                self._conn = c
            def cursor(self):
                return self._conn.cursor(cursor_factory=RealDictCursor)
            def commit(self):
                return self._conn.commit()
            def close(self):
                return self._conn.close()
        return DictCursorConn(conn)
    return pymysql.connect(
        host=MYSQL_CONFIG["host"],
        port=MYSQL_CONFIG["port"],
        user=MYSQL_CONFIG["user"],
        password=MYSQL_CONFIG["password"],
        database=DB_NAME,
        charset=MYSQL_CONFIG["charset"],
        cursorclass=pymysql.cursors.DictCursor,
    )

# room_code -> { creator_sid, joiner_sid, game, sequence, started, done_sids }
rooms = {}

# 6 位房间号（REST 创建）的 Socket 房间：room_id -> set(sid)，用于实时同步点击与胜负
game_socket_rooms = {}

# 寻找伙伴匹配队列：[{ "sid", "user_id", "username" }, ...]，满 2 人即自动建房并通知双方
matchmaking_queue = []


def make_room_code():
    """4 位数字房间码，便于儿童输入。"""
    return "".join(random.choices(string.digits, k=4))


def make_room_code_6():
    """6 位数字房间号，用于 game_rooms 表。"""
    return "".join(random.choices(string.digits, k=6))


def ensure_game_rooms_table():
    """若 game_rooms 表不存在则创建，解决 1146 报错。PostgreSQL 表由 init_db_postgres.py 一次性创建。"""
    if DATABASE_URL:
        return
    sql = """
    CREATE TABLE IF NOT EXISTS game_rooms (
        id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
        room_id VARCHAR(6) NOT NULL UNIQUE COMMENT '6位随机房间号',
        creator_id INT UNSIGNED NOT NULL COMMENT '创建者用户ID',
        joiner_id INT UNSIGNED NULL DEFAULT NULL COMMENT '加入者用户ID',
        status VARCHAR(20) NOT NULL DEFAULT 'waiting' COMMENT 'waiting/playing/finished',
        emoji_sequence VARCHAR(32) NULL DEFAULT NULL COMMENT 'JSON数组',
        host_score INT UNSIGNED NOT NULL DEFAULT 0,
        guest_score INT UNSIGNED NOT NULL DEFAULT 0,
        winner_id INT UNSIGNED NULL DEFAULT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        KEY idx_room_id (room_id),
        KEY idx_status (status),
        CONSTRAINT fk_gr_creator FOREIGN KEY (creator_id) REFERENCES users (id) ON DELETE CASCADE,
        CONSTRAINT fk_gr_joiner FOREIGN KEY (joiner_id) REFERENCES users (id) ON DELETE SET NULL,
        CONSTRAINT fk_gr_winner FOREIGN KEY (winner_id) REFERENCES users (id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='双人对战房间(6位房间号)'
    """
    try:
        conn = get_db()
        try:
            with conn.cursor() as cur:
                cur.execute(sql)
            conn.commit()
        finally:
            conn.close()
    except Exception as e:
        app.logger.warning("ensure_game_rooms_table: %s", e)


def ensure_app_settings_table():
    """全局设置：灯笼颜色、冠军昵称等，供全森林同步。PostgreSQL 表由 init_db_postgres.py 创建。"""
    if DATABASE_URL:
        return
    sql = """
    CREATE TABLE IF NOT EXISTS app_settings (
        k VARCHAR(64) NOT NULL PRIMARY KEY,
        v TEXT NULL,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='全局设置(灯笼颜色等)'
    """
    try:
        conn = get_db()
        try:
            with conn.cursor() as cur:
                cur.execute(sql)
            conn.commit()
        finally:
            conn.close()
    except Exception as e:
        app.logger.warning("ensure_app_settings_table: %s", e)


def ensure_achievement_unlocks_table():
    """勋章馆：记录用户解锁的成就（如勇敢小狮子）。PostgreSQL 表由 init_db_postgres.py 创建。"""
    if DATABASE_URL:
        return
    sql = """
    CREATE TABLE IF NOT EXISTS achievement_unlocks (
        id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
        user_id INT UNSIGNED NOT NULL,
        medal_key VARCHAR(64) NOT NULL COMMENT '如 brave_lion',
        unlocked_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uq_user_medal (user_id, medal_key),
        CONSTRAINT fk_au_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='森林守护者成就解锁'
    """
    try:
        conn = get_db()
        try:
            with conn.cursor() as cur:
                cur.execute(sql)
            conn.commit()
        finally:
            conn.close()
    except Exception as e:
        app.logger.warning("ensure_achievement_unlocks_table: %s", e)


def ensure_worship_log_table():
    """膜拜记录：同一房间内每个玩家只能膜拜一次。PostgreSQL 表由 init_db_postgres.py 创建。"""
    if DATABASE_URL:
        return
    sql = """
    CREATE TABLE IF NOT EXISTS worship_log (
        room_id VARCHAR(6) NOT NULL,
        worshipper_id INT UNSIGNED NOT NULL,
        king_id INT UNSIGNED NOT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (room_id, worshipper_id),
        CONSTRAINT fk_wl_king FOREIGN KEY (king_id) REFERENCES users (id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='森林之王膜拜记录'
    """
    try:
        conn = get_db()
        try:
            with conn.cursor() as cur:
                cur.execute(sql)
            conn.commit()
        finally:
            conn.close()
    except Exception as e:
        app.logger.warning("ensure_worship_log_table: %s", e)


def ensure_users_likes_received():
    """users 表增加 likes_received 字段（被膜拜次数）。PostgreSQL 在 init_db_postgres 中已包含。"""
    if DATABASE_URL:
        return
    try:
        conn = get_db()
        try:
            with conn.cursor() as cur:
                cur.execute("ALTER TABLE users ADD COLUMN likes_received INT UNSIGNED NOT NULL DEFAULT 0")
            conn.commit()
        finally:
            conn.close()
    except Exception as e:
        if "Duplicate column" not in str(e):
            app.logger.warning("ensure_users_likes_received: %s", e)


def ensure_user_wallet_table():
    """用户金币：每赢一局 +10 金币。PostgreSQL 表由 init_db_postgres.py 创建。"""
    if DATABASE_URL:
        return
    sql = """
    CREATE TABLE IF NOT EXISTS user_wallet (
        user_id INT UNSIGNED NOT NULL PRIMARY KEY,
        coins INT UNSIGNED NOT NULL DEFAULT 0,
        CONSTRAINT fk_wallet_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='用户金币'
    """
    try:
        conn = get_db()
        try:
            with conn.cursor() as cur:
                cur.execute(sql)
            conn.commit()
        finally:
            conn.close()
    except Exception as e:
        app.logger.warning("ensure_user_wallet_table: %s", e)


def ensure_user_inventory_table():
    """宠物家园装饰：领结、果树等，用金币购买。PostgreSQL 表由 init_db_postgres.py 创建。"""
    if DATABASE_URL:
        return
    sql = """
    CREATE TABLE IF NOT EXISTS user_inventory (
        id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
        user_id INT UNSIGNED NOT NULL,
        item_key VARCHAR(64) NOT NULL,
        acquired_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uq_user_item (user_id, item_key),
        CONSTRAINT fk_inv_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='用户装饰品'
    """
    try:
        conn = get_db()
        try:
            with conn.cursor() as cur:
                cur.execute(sql)
            conn.commit()
        finally:
            conn.close()
    except Exception as e:
        app.logger.warning("ensure_user_inventory_table: %s", e)


SHOP_ITEMS = {"bow_red": 20, "bow_blue": 20, "bow_green": 20, "tree_apple": 30}


# 勋章馆：6 枚普通 + 3 枚限定传说
NORMAL_MEDAL_KEYS = ["first_single", "vs_3_wins", "play_50", "seq_master", "vs_master", "forest_regular"]
ACHIEVEMENT_MEDALS = [
    {"key": "first_single", "name": "初出茅庐", "emoji": "🏅", "rarity": "普通"},
    {"key": "vs_3_wins", "name": "对战先锋", "emoji": "🏆", "rarity": "普通"},
    {"key": "play_50", "name": "百折不挠", "emoji": "🎖️", "rarity": "普通"},
    {"key": "seq_master", "name": "记忆小能手", "emoji": "🌟", "rarity": "普通"},
    {"key": "vs_master", "name": "对战达人", "emoji": "💎", "rarity": "普通"},
    {"key": "forest_regular", "name": "森林常客", "emoji": "👑", "rarity": "普通"},
    {"key": "forest_warlord", "name": "森林战神", "emoji": "🔥", "rarity": "传说", "effect": "flame"},
    {"key": "lightning_reflex", "name": "闪电快手", "emoji": "⚡", "rarity": "传说", "effect": "lightning"},
    {"key": "king_of_jungle", "name": "森林之王", "emoji": "👑", "rarity": "传说", "effect": "sparkle"},
]
LEGENDARY_KEYS = ["forest_warlord", "lightning_reflex", "king_of_jungle"]
LEGENDARY_VOICE = {
    "forest_warlord": "哇！你解锁了传说中的森林战神勋章！",
    "lightning_reflex": "哇！你解锁了传说中的闪电快手勋章！",
    "king_of_jungle": "哇！你解锁了传说中的森林之王勋章！",
}


def unlock_medal(cur, user_id, medal_key):
    """解锁勋章，返回是否新解锁。"""
    cur.execute(
        "INSERT IGNORE INTO achievement_unlocks (user_id, medal_key) VALUES (%s, %s)",
        (user_id, medal_key),
    )
    return cur.rowcount > 0


def _has_king_medal(cur, user_id):
    """是否已解锁森林之王勋章（king_of_jungle）。"""
    if not user_id:
        return False
    cur.execute(
        "SELECT 1 FROM achievement_unlocks WHERE user_id = %s AND medal_key = 'king_of_jungle' LIMIT 1",
        (user_id,),
    )
    return cur.fetchone() is not None


def _username_by_id(cur, user_id):
    """根据 user_id 查 username，无则返回 None。"""
    if not user_id:
        return None
    cur.execute("SELECT username FROM users WHERE id = %s", (user_id,))
    row = cur.fetchone()
    return row["username"] if row else None


# 等级名称：按胜场数进阶
LEVEL_NAMES = ["森林见习生", "小树苗", "森林卫士", "森林英雄", "大森林之王"]
def level_from_wins(wins):
    if wins >= 10: return 4
    if wins >= 6: return 3
    if wins >= 3: return 2
    if wins >= 1: return 1
    return 0


@socketio.on("create_room")
def on_create_room():
    code = make_room_code()
    while code in rooms:
        code = make_room_code()
    rooms[code] = {
        "creator_sid": None,
        "joiner_sid": None,
        "game": "seq",
        "sequence": None,
        "started": False,
        "done_sids": [],
        "done_times": {},
    }
    join_room(code)
    rooms[code]["creator_sid"] = request.sid
    emit("room_created", {"room_code": code, "room_id": code})
    return {"room_code": code}


@socketio.on("join_room")
def on_join_room(data):
    code = data.get("room_code", "").strip()
    if not code or code not in rooms:
        emit("join_failed", {"message": "房间不存在或已关闭"})
        return
    r = rooms[code]
    if r["joiner_sid"] is not None:
        emit("join_failed", {"message": "房间已满"})
        return
    r["joiner_sid"] = request.sid
    join_room(code)
    emit("join_ok", {"room_code": code})
    socketio.emit("opponent_joined", {}, room=code)


@socketio.on("start_game")
def on_start_game(data):
    code = data.get("room_id") or data.get("room_code")
    if not code or code not in rooms:
        return
    r = rooms[code]
    if r["started"]:
        return
    r["started"] = True
    r["sequence"] = [random.randint(0, 2) for _ in range(3)]
    r["done_sids"] = []
    r["done_times"] = {}
    r["progress"] = {}
    socketio.emit(
        "game_start",
        {"game": r["game"], "sequence": r["sequence"]},
        room=code,
    )


@socketio.on("progress_update")
def on_progress_update(data):
    """对手进度：某方完成 1/3、2/3 时广播给房间，便于显示“对手已完成 2/3”。"""
    code = data.get("room_id") or data.get("room_code")
    step = data.get("step", 0)
    if not code or code not in rooms:
        return
    r = rooms[code]
    r["progress"] = r.get("progress") or {}
    r["progress"][request.sid] = step
    socketio.emit("opponent_progress", {"step": step}, room=code, include_self=False)


@socketio.on("game_done")
def on_game_done(data):
    code = data.get("room_id") or data.get("room_code")
    time_ms = data.get("time_ms", 0)
    user_id = data.get("user_id")
    if not code or code not in rooms:
        return
    r = rooms[code]
    if request.sid in r["done_sids"]:
        return
    r["done_sids"].append(request.sid)
    r["done_times"][request.sid] = time_ms
    if len(r["done_sids"]) == 1:
        winner_sid = request.sid
        other = r["creator_sid"] if request.sid == r["joiner_sid"] else r["joiner_sid"]
        if user_id is not None:
            try:
                conn = get_db()
                try:
                    with conn.cursor() as cur:
                        cur.execute(
                            "INSERT INTO game_progress (user_id, points) VALUES (%s, 10) ON DUPLICATE KEY UPDATE points = points + 10",
                            (user_id,),
                        )
                    conn.commit()
                finally:
                    conn.close()
            except Exception:
                pass
        socketio.emit(
            "game_result",
            {"winner_sid": winner_sid, "your_result": "win", "time_ms": time_ms},
            room=winner_sid,
        )
        socketio.emit(
            "game_result",
            {"winner_sid": winner_sid, "your_result": "lose", "time_ms": time_ms},
            room=other,
        )
    elif len(r["done_sids"]) == 2:
        socketio.emit(
            "game_result",
            {"winner_sid": r["done_sids"][0], "your_result": "lose", "time_ms": time_ms},
            room=request.sid,
        )


@socketio.on("leave_room")
def on_leave_room(data):
    code = data.get("room_id") or data.get("room_code")
    if code and code in rooms:
        leave_room(code)
        socketio.emit("opponent_left", {}, room=code)
        if request.sid in (rooms[code].get("creator_sid"), rooms[code].get("joiner_sid")):
            del rooms[code]


@socketio.on("disconnect")
def on_disconnect():
    for code, r in list(rooms.items()):
        if request.sid in (r.get("creator_sid"), r.get("joiner_sid")):
            leave_room(code)
            socketio.emit("opponent_left", {}, room=code)
            del rooms[code]
            break
    for room_id, sids in list(game_socket_rooms.items()):
        if request.sid in sids:
            sids.discard(request.sid)
            leave_room(room_id)
            if len(sids) > 0:
                socketio.emit("opponent_left", {}, room=room_id)
            if not sids:
                del game_socket_rooms[room_id]
            break


# ---------- 实时双人对战（6 位房间号，与 REST create_room/join_room 配合） ----------

@socketio.on("find_partner")
def on_find_partner(data):
    """寻找伙伴：加入匹配队列，满 2 人时自动创建房间并通知双方，无需输入房间号。"""
    import json as _json
    user_id = data.get("user_id")
    username = (data.get("username") or data.get("my_name") or "").strip() or "小伙伴"
    if not user_id:
        emit("find_partner_failed", {"message": "请先登录"})
        return
    matchmaking_queue.append({"sid": request.sid, "user_id": user_id, "username": username})
    if len(matchmaking_queue) < 2:
        emit("find_partner_waiting", {"message": "正在寻找伙伴…"})
        return
    first = matchmaking_queue.pop(0)
    second = matchmaking_queue.pop(0)
    ensure_game_rooms_table()
    ensure_achievement_unlocks_table()
    code = make_room_code_6()
    seq = [random.randint(0, 2) for _ in range(3)]
    seq_json = _json.dumps(seq)
    try:
        conn = get_db()
        try:
            with conn.cursor() as cur:
                cur.execute("SELECT id FROM game_rooms WHERE room_id = %s", (code,))
                while cur.fetchone():
                    code = make_room_code_6()
                    cur.execute("SELECT id FROM game_rooms WHERE room_id = %s", (code,))
                cur.execute(
                    "INSERT INTO game_rooms (room_id, creator_id, joiner_id, status, emoji_sequence) VALUES (%s, %s, %s, 'playing', %s)",
                    (code, first["user_id"], second["user_id"], seq_json),
                )
                is_king_1 = _has_king_medal(cur, first["user_id"])
                is_king_2 = _has_king_medal(cur, second["user_id"])
            conn.commit()
        finally:
            conn.close()
    except Exception as e:
        app.logger.exception("find_partner create room failed: %s", e)
        matchmaking_queue.insert(0, second)
        matchmaking_queue.insert(0, first)
        socketio.emit("find_partner_failed", {"message": "匹配失败，请重试"}, room=first["sid"])
        socketio.emit("find_partner_failed", {"message": "匹配失败，请重试"}, room=second["sid"])
        return
    payload_host = {
        "room_id": code,
        "role": "host",
        "emoji_sequence": seq,
        "my_name": first["username"],
        "opponent_name": second["username"],
        "is_king": is_king_1,
        "opponent_is_king": is_king_2,
    }
    payload_guest = {
        "room_id": code,
        "role": "guest",
        "emoji_sequence": seq,
        "my_name": second["username"],
        "opponent_name": first["username"],
        "is_king": is_king_2,
        "opponent_is_king": is_king_1,
    }
    emit("matched", payload_host, room=first["sid"])
    emit("matched", payload_guest, room=second["sid"])


@socketio.on("join_game_room")
def on_join_game_room(data):
    """进入游戏界面后加入 Socket 房间；若加入者为森林之王则向房间内所有人广播 trigger_king_arrival。"""
    room_id = (data.get("room_id") or data.get("room_code") or "").strip()
    if not room_id or len(room_id) != 6:
        emit("join_game_room_failed", {"message": "房间号无效"})
        return
    is_king = data.get("is_king") is True
    join_room(room_id)
    game_socket_rooms.setdefault(room_id, set()).add(request.sid)
    emit("join_game_room_ok", {"room_id": room_id})
    if is_king:
        socketio.emit("trigger_king_arrival", {}, room=room_id)
    if len(game_socket_rooms[room_id]) == 2:
        socketio.emit("game_start", {"room_id": room_id}, room=room_id)


@socketio.on("worship_broadcast")
def on_worship_broadcast(data):
    """膜拜成功后由前端发起，向房间内所有人广播 show_worship_animation，双方同时看到爱心与提示。"""
    room_id = (data.get("room_id") or data.get("room_code") or "").strip()
    if not room_id or room_id not in game_socket_rooms:
        return
    socketio.emit(
        "show_worship_animation",
        {
            "from_name": data.get("from_name") or "小伙伴",
            "to_name": data.get("to_name") or "森林之王",
            "coins_given": data.get("coins_given", 0),
        },
        room=room_id,
    )


@socketio.on("sync_game_state")
def on_sync_game_state(data):
    """同步游戏状态：分数、连击数，供对方显示进度条与头像跳动/小星星。"""
    room_id = (data.get("room_id") or data.get("room_code") or "").strip()
    if not room_id or room_id not in game_socket_rooms:
        return
    payload = {
        "score": data.get("score", 0),
        "combo": data.get("combo", 0),
        "player_name": data.get("player_name") or "小伙伴",
    }
    socketio.emit("sync_game_state", payload, room=room_id, include_self=False)


@socketio.on("player_move")
def on_player_move(data):
    """一方点击动物/格子时，广播给另一方显示高亮。"""
    room_id = (data.get("room_id") or data.get("room_code") or "").strip()
    tile_index = data.get("tileIndex", data.get("tile_index", -1))
    if not room_id or room_id not in game_socket_rooms:
        return
    socketio.emit("opponent_move", {"tileIndex": tile_index}, room=room_id, include_self=False)


@socketio.on("wrong_tap")
def on_wrong_tap(data):
    """一方点错，立即通知双方游戏结束，点错方为输家。"""
    room_id = (data.get("room_id") or data.get("room_code") or "").strip()
    if not room_id or room_id not in game_socket_rooms:
        return
    sids = game_socket_rooms.get(room_id) or set()
    loser_sid = request.sid
    winner_sid = (sids - {loser_sid}).pop() if len(sids) == 2 else None
    socketio.emit("game_over", {"loser_sid": loser_sid, "winner_sid": winner_sid}, room=room_id)


@socketio.on("finish_first")
def on_finish_first(data):
    """一方先完成正确序列，通知双方游戏结束，完成方为赢家。"""
    room_id = (data.get("room_id") or data.get("room_code") or "").strip()
    if not room_id or room_id not in game_socket_rooms:
        return
    sids = game_socket_rooms.get(room_id) or set()
    winner_sid = request.sid
    loser_sid = (sids - {winner_sid}).pop() if len(sids) == 2 else None
    socketio.emit("game_over", {"winner_sid": winner_sid, "loser_sid": loser_sid}, room=room_id)


@socketio.on("use_magic")
def on_use_magic(data):
    """魔法道具：向对手施加效果（烟雾弹=模糊、反转术=左右互换、地震=抖动、冰冻=冻结）。"""
    room_id = (data.get("room_id") or data.get("room_code") or "").strip()
    magic_type = (data.get("type") or "smoke").strip().lower()
    if room_id not in game_socket_rooms:
        return
    duration = {"smoke": 3, "reverse": 4, "freeze": 1, "earthquake": 2}.get(magic_type, 3)
    socketio.emit("magic_effect", {"type": magic_type, "duration": duration}, room=room_id, include_self=False)


# 房间内当前掉落的道具（先抢到者对对手释放）
game_room_items = {}
import uuid as _uuid


@socketio.on("request_spawn")
def on_request_spawn(data):
    """请求在房间中央掉落一个道具（房间满 2 人且当前无未拾取道具时生成）。"""
    room_id = (data.get("room_id") or data.get("room_code") or "").strip()
    if room_id not in game_socket_rooms or len(game_socket_rooms[room_id]) != 2:
        return
    cur = game_room_items.get(room_id)
    if cur and not cur.get("grabbed"):
        return
    item_type = random.choice(["smoke", "reverse", "earthquake"])
    item_id = str(_uuid.uuid4())
    game_room_items[room_id] = {"id": item_id, "type": item_type, "grabbed": False}
    socketio.emit("item_spawned", {"item_id": item_id, "type": item_type}, room=room_id)


@socketio.on("grab_item")
def on_grab_item(data):
    """先抢到者：对对手施加该道具效果。"""
    room_id = (data.get("room_id") or data.get("room_code") or "").strip()
    item_id = (data.get("item_id") or "").strip()
    if not room_id or room_id not in game_socket_rooms:
        return
    cur = game_room_items.get(room_id)
    if not cur or cur["id"] != item_id or cur.get("grabbed"):
        return
    cur["grabbed"] = True
    duration = {"smoke": 3, "reverse": 4, "earthquake": 2}.get(cur["type"], 3)
    socketio.emit("magic_effect", {"type": cur["type"], "duration": duration}, room=room_id, include_self=False)
    socketio.emit("item_grabbed", {"item_id": item_id}, room=room_id)


@app.route("/api/me")
def api_me():
    """返回当前登录用户信息（用于前端校验 session），以及全局灯笼颜色与冠军昵称（全森林同步）。"""
    user_id = session.get("user_id")
    username = session.get("username")
    if not username or not user_id:
        return jsonify({"error": "未登录"}), 401
    out = {"username": username, "user_id": user_id}
    try:
        ensure_app_settings_table()
        conn = get_db()
        try:
            with conn.cursor() as cur:
                cur.execute("SELECT k, v FROM app_settings WHERE k IN ('lantern_color', 'lantern_champion_username')")
                for row in cur.fetchall():
                    if row["k"] == "lantern_color":
                        out["lantern_color"] = row["v"] or "warm_yellow"
                    elif row["k"] == "lantern_champion_username":
                        out["lantern_champion_username"] = row["v"] or None
        finally:
            conn.close()
    except Exception:
        out["lantern_color"] = "warm_yellow"
        out["lantern_champion_username"] = None
    if "lantern_color" not in out:
        out["lantern_color"] = "warm_yellow"
    return jsonify(out)


@app.route("/api/register", methods=["POST"])
def api_register():
    """
    注册：接收用户名、密码（可选邮箱）。
    检查用户名是否已存在；若不存在则使用 Werkzeug 加密密码后存入 users 表，严禁明文存储。
    """
    data = request.get_json() or {}
    username = (data.get("username") or "").strip()
    password = data.get("password") or ""
    email = (data.get("email") or "").strip() or None
    if not username or not password:
        return jsonify({"error": "用户名和密码不能为空"}), 400
    if len(username) < 2:
        return jsonify({"error": "用户名至少 2 个字符"}), 400
    if len(password) < 4:
        return jsonify({"error": "密码至少 4 个字符"}), 400
    password_hash = generate_password_hash(password)
    try:
        conn = get_db()
        try:
            with conn.cursor() as cur:
                cur.execute("SELECT id FROM users WHERE username = %s", (username,))
                if cur.fetchone():
                    return jsonify({"error": "该用户名已被注册"}), 400
                if DATABASE_URL:
                    cur.execute(
                        "INSERT INTO users (username, password_hash, email) VALUES (%s, %s, %s) RETURNING id",
                        (username, password_hash, email),
                    )
                    user_id = cur.fetchone()["id"]
                else:
                    cur.execute(
                        "INSERT INTO users (username, password_hash, email) VALUES (%s, %s, %s)",
                        (username, password_hash, email),
                    )
                    user_id = cur.lastrowid
            conn.commit()
        finally:
            conn.close()
    except Exception as e:
        err_msg = str(e)
        if "Unknown database" in err_msg or "doesn't exist" in err_msg:
            return jsonify({"error": "数据库未初始化，请在 game 目录运行：python init_db.py"}), 500
        if "Connection" in err_msg or "connect" in err_msg.lower():
            db_type = "PostgreSQL" if DATABASE_URL else "MySQL"
            return jsonify({"error": f"无法连接 {db_type}，请检查数据库配置或服务状态"}), 500
        return jsonify({"error": "注册失败：" + err_msg}), 500
    session["user_id"] = user_id
    session["username"] = username
    return jsonify({"username": username, "user_id": user_id})


@app.route("/api/login", methods=["POST"])
def api_login():
    """
    登录：验证用户名和密码；成功后写入 user_sessions 表一条登录日志（用户 ID + 登录时间），
    并设置 session 返回登录成功信号。
    """
    data = request.get_json() or {}
    username = (data.get("username") or "").strip()
    password = data.get("password") or ""
    if not username or not password:
        return jsonify({"error": "用户名和密码不能为空"}), 400
    try:
        conn = get_db()
        try:
            with conn.cursor() as cur:
                cur.execute("SELECT id, password_hash FROM users WHERE username = %s", (username,))
                row = cur.fetchone()
                if not row or not check_password_hash(row["password_hash"], password):
                    return jsonify({"error": "用户名或密码错误"}), 401
                user_id = row["id"]
                cur.execute("INSERT INTO user_sessions (user_id, login_at) VALUES (%s, %s)", (user_id, datetime.now()))
                try:
                    cur.execute("UPDATE users SET last_login = %s WHERE id = %s", (datetime.now(), user_id))
                except pymysql.err.OperationalError as e:
                    if "Unknown column 'last_login'" not in str(e):
                        raise
                    # 旧库没有 last_login 列时跳过，登录仍成功；请运行 python init_db.py 添加该列
            conn.commit()
        finally:
            conn.close()
    except Exception as e:
        err_msg = str(e)
        if "Unknown database" in err_msg or "doesn't exist" in err_msg:
            return jsonify({"error": "数据库未初始化，请在 game 目录运行：python init_db.py"}), 500
        if "Connection" in err_msg or "connect" in err_msg.lower():
            db_type = "PostgreSQL" if DATABASE_URL else "MySQL"
            return jsonify({"error": f"无法连接 {db_type}，请检查数据库配置或服务状态"}), 500
        return jsonify({"error": "登录失败：" + err_msg}), 500
    session["user_id"] = user_id
    session["username"] = username
    return jsonify({"username": username, "user_id": user_id})


@app.route("/api/logout", methods=["POST"])
def api_logout():
    session.pop("user_id", None)
    session.pop("username", None)
    return jsonify({"ok": True})


@app.route("/api/mood", methods=["POST"])
def api_mood():
    """心情打卡：游戏结束后孩子点开心/不开心/自豪，写入 mood_logs 表。"""
    user_id = session.get("user_id")
    if not user_id:
        return jsonify({"error": "未登录"}), 401
    data = request.get_json() or {}
    mood = (data.get("mood") or "").strip().lower()
    if mood not in ("happy", "sad", "proud"):
        return jsonify({"error": "mood 为 happy / sad / proud"}), 400
    try:
        conn = get_db()
        try:
            with conn.cursor() as cur:
                cur.execute("INSERT INTO mood_logs (user_id, mood) VALUES (%s, %s)", (user_id, mood))
            conn.commit()
        finally:
            conn.close()
    except Exception as e:
        return jsonify({"error": str(e)}), 500
    return jsonify({"ok": True})


@app.route("/api/location", methods=["POST"])
def api_location():
    """位置记录：家长端护航，前端每分钟静默上报坐标，写入 location_logs。"""
    user_id = session.get("user_id")
    if not user_id:
        return jsonify({"error": "未登录"}), 401
    data = request.get_json() or {}
    try:
        lat = float(data.get("lat"))
        lng = float(data.get("lng"))
    except (TypeError, ValueError):
        return jsonify({"error": "需要 lat, lng 数字"}), 400
    try:
        conn = get_db()
        try:
            with conn.cursor() as cur:
                cur.execute("INSERT INTO location_logs (user_id, lat, lng) VALUES (%s, %s, %s)", (user_id, lat, lng))
            conn.commit()
        finally:
            conn.close()
    except Exception as e:
        return jsonify({"error": str(e)}), 500
    return jsonify({"ok": True})


# ---------- 双人对战房间 API（game_rooms 表，6 位房间号） ----------

@app.route("/api/create_room", methods=["POST"])
def api_create_room():
    """创建房间：生成 6 位房间号，写入 game_rooms，返回房间号、序列与是否森林之王。"""
    user_id = session.get("user_id")
    if not user_id:
        return jsonify({"error": "未登录，请先登录再创建房间"}), 401
    import json as _json
    ensure_game_rooms_table()
    ensure_achievement_unlocks_table()
    code = make_room_code_6()
    is_king = False
    my_name = session.get("username") or ""
    try:
        conn = get_db()
        try:
            with conn.cursor() as cur:
                cur.execute("SELECT id FROM game_rooms WHERE room_id = %s", (code,))
                while cur.fetchone():
                    code = make_room_code_6()
                    cur.execute("SELECT id FROM game_rooms WHERE room_id = %s", (code,))
                seq = [random.randint(0, 2) for _ in range(3)]
                seq_json = _json.dumps(seq)
                cur.execute(
                    "INSERT INTO game_rooms (room_id, creator_id, status, emoji_sequence) VALUES (%s, %s, 'waiting', %s)",
                    (code, user_id, seq_json),
                )
                is_king = _has_king_medal(cur, user_id)
                if not my_name:
                    my_name = _username_by_id(cur, user_id) or ""
            conn.commit()
        finally:
            conn.close()
    except Exception as e:
        app.logger.exception("create_room failed")
        return jsonify({"error": str(e)}), 500
    return jsonify({"room_id": code, "emoji_sequence": seq, "is_king": is_king, "my_name": my_name})


@app.route("/api/room/create_virtual", methods=["POST"])
def api_room_create_virtual():
    """创建虚拟伙伴房间：仅一人游玩，对手为「小皮」，用于单人练习。"""
    user_id = session.get("user_id")
    if not user_id:
        return jsonify({"error": "未登录"}), 401
    import json as _json
    ensure_game_rooms_table()
    ensure_achievement_unlocks_table()
    code = make_room_code_6()
    my_name = session.get("username") or ""
    is_king = False
    seq = [0, 1, 2]
    try:
        conn = get_db()
        try:
            with conn.cursor() as cur:
                cur.execute("SELECT id FROM game_rooms WHERE room_id = %s", (code,))
                while cur.fetchone():
                    code = make_room_code_6()
                    cur.execute("SELECT id FROM game_rooms WHERE room_id = %s", (code,))
                seq = [random.randint(0, 2) for _ in range(3)]
                seq_json = _json.dumps(seq)
                cur.execute(
                    "INSERT INTO game_rooms (room_id, creator_id, joiner_id, status, emoji_sequence) VALUES (%s, %s, NULL, 'playing', %s)",
                    (code, user_id, seq_json),
                )
                is_king = _has_king_medal(cur, user_id)
                if not my_name:
                    my_name = _username_by_id(cur, user_id) or ""
            conn.commit()
        finally:
            conn.close()
    except Exception as e:
        app.logger.exception("create_virtual_room failed: %s", e)
        return jsonify({"error": str(e)}), 500
    return jsonify({
        "room_id": code,
        "emoji_sequence": seq,
        "is_king": is_king,
        "my_name": my_name,
    })


@app.route("/api/join_room", methods=["POST"])
def api_join_room():
    """加入房间：校验房间号存在且 status=waiting，写入 joiner_id 并置为 playing；返回房主是否森林之王。"""
    user_id = session.get("user_id")
    if not user_id:
        return jsonify({"error": "未登录，请先登录再加入房间"}), 401
    data = request.get_json() or {}
    room_id = (data.get("room_id") or data.get("room_code") or "").strip()
    if not room_id:
        return jsonify({"error": "请输入房间号"}), 400
    import json as _json
    ensure_game_rooms_table()
    ensure_achievement_unlocks_table()
    is_king = False
    creator_name = ""
    creator_is_king = False
    try:
        conn = get_db()
        try:
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT id, creator_id, joiner_id, emoji_sequence, status FROM game_rooms WHERE room_id = %s",
                    (room_id,),
                )
                row = cur.fetchone()
                if not row:
                    return jsonify({"error": "哎呀，找不到这个房间哦！请检查房间号是否正确。"}), 404
                if row["status"] != "waiting":
                    return jsonify({"error": "房间已开始或已结束"}), 400
                if row["joiner_id"] is not None:
                    return jsonify({"error": "房间已满"}), 400
                if row["creator_id"] == user_id:
                    return jsonify({"error": "不能加入自己创建的房间"}), 400
                seq = _json.loads(row["emoji_sequence"]) if row["emoji_sequence"] else [0, 1, 2]
                cur.execute(
                    "UPDATE game_rooms SET joiner_id = %s, status = 'playing' WHERE room_id = %s",
                    (user_id, room_id),
                )
                is_king = _has_king_medal(cur, user_id)
                creator_name = _username_by_id(cur, row["creator_id"]) or ""
                creator_is_king = _has_king_medal(cur, row["creator_id"])
            conn.commit()
        finally:
            conn.close()
    except Exception as e:
        app.logger.exception("join_room failed")
        return jsonify({"error": str(e)}), 500
    return jsonify({
        "room_id": room_id,
        "emoji_sequence": seq,
        "is_king": is_king,
        "creator_name": creator_name,
        "creator_is_king": creator_is_king,
    })


@app.route("/api/room/status", methods=["GET"])
def api_room_status():
    """轮询房间状态：用于房主等待对手、游戏中进度与结束判定；含双方昵称与是否森林之王。"""
    user_id = session.get("user_id")
    if not user_id:
        return jsonify({"error": "未登录"}), 401
    room_id = request.args.get("room_id") or request.args.get("room_code") or ""
    if not room_id:
        return jsonify({"error": "缺少 room_id"}), 400
    ensure_game_rooms_table()
    ensure_achievement_unlocks_table()
    try:
        conn = get_db()
        try:
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT creator_id, joiner_id, status, host_score, guest_score, winner_id FROM game_rooms WHERE room_id = %s",
                    (room_id,),
                )
                row = cur.fetchone()
                if not row:
                    return jsonify({"error": "房间不存在"}), 404
                creator_name = _username_by_id(cur, row["creator_id"]) or ""
                joiner_id = row.get("joiner_id")
                joiner_name = "小皮" if joiner_id is None else (_username_by_id(cur, joiner_id) or "")
                creator_is_king = _has_king_medal(cur, row["creator_id"])
                joiner_is_king = _has_king_medal(cur, joiner_id) if joiner_id else False
                return jsonify({
                    "status": row["status"],
                    "host_score": row["host_score"] or 0,
                    "guest_score": row["guest_score"] or 0,
                    "winner_id": row["winner_id"],
                    "creator_id": row["creator_id"],
                    "joiner_id": row["joiner_id"],
                    "creator_name": creator_name,
                    "joiner_name": joiner_name,
                    "creator_is_king": creator_is_king,
                    "joiner_is_king": joiner_is_king,
                })
        finally:
            conn.close()
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/worship", methods=["POST"])
def api_worship():
    """膜拜森林之王：同一房间内每人只能膜拜一次；国王获得 likes_received+1 与金币+2（每日上限10）。"""
    user_id = session.get("user_id")
    if not user_id:
        return jsonify({"error": "未登录"}), 401
    data = request.get_json() or {}
    room_id = (data.get("room_id") or data.get("room_code") or "").strip()
    if not room_id or len(room_id) != 6:
        return jsonify({"error": "房间号无效"}), 400
    ensure_game_rooms_table()
    ensure_achievement_unlocks_table()
    ensure_worship_log_table()
    ensure_users_likes_received()
    ensure_user_wallet_table()
    try:
        conn = get_db()
        try:
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT creator_id, joiner_id FROM game_rooms WHERE room_id = %s",
                    (room_id,),
                )
                row = cur.fetchone()
                if not row:
                    return jsonify({"error": "房间不存在"}), 404
                creator_id = row["creator_id"]
                joiner_id = row.get("joiner_id")
                if user_id not in (creator_id, joiner_id):
                    return jsonify({"error": "你不是该房间成员"}), 403
                creator_is_king = _has_king_medal(cur, creator_id)
                joiner_is_king = _has_king_medal(cur, joiner_id) if joiner_id else False
                king_id = creator_id if creator_is_king else (joiner_id if joiner_is_king else None)
                if king_id is None:
                    return jsonify({"error": "对方还不是森林之王哦"}), 400
                if king_id == user_id:
                    return jsonify({"error": "不能膜拜自己"}), 400
                cur.execute(
                    "SELECT 1 FROM worship_log WHERE room_id = %s AND worshipper_id = %s",
                    (room_id, user_id),
                )
                if cur.fetchone():
                    return jsonify({"error": "本房间已膜拜过了"}), 400
                from_name = _username_by_id(cur, user_id) or "小伙伴"
                to_name = _username_by_id(cur, king_id) or "森林之王"
                cur.execute(
                    "SELECT COUNT(*) AS c FROM worship_log WHERE king_id = %s AND DATE(created_at) = CURDATE()",
                    (king_id,),
                )
                today_before = (cur.fetchone() or {}).get("c") or 0
                coins_to_add = min(2, 10 - today_before * 2) if today_before * 2 < 10 else 0
                cur.execute(
                    "INSERT INTO worship_log (room_id, worshipper_id, king_id) VALUES (%s, %s, %s)",
                    (room_id, user_id, king_id),
                )
                cur.execute(
                    "UPDATE users SET likes_received = likes_received + 1 WHERE id = %s",
                    (king_id,),
                )
                if coins_to_add > 0:
                    cur.execute(
                        "INSERT INTO user_wallet (user_id, coins) VALUES (%s, %s) ON DUPLICATE KEY UPDATE coins = coins + %s",
                        (king_id, coins_to_add, coins_to_add),
                    )
            conn.commit()
        finally:
            conn.close()
    except Exception as e:
        app.logger.exception("worship failed")
        return jsonify({"error": str(e)}), 500
    payload = {"ok": True, "from_name": from_name, "to_name": to_name, "coins_given": coins_to_add}
    return jsonify(payload)


@app.route("/api/room/update_score", methods=["POST"])
def api_room_update_score():
    """更新当前玩家得分；先达到 3 者获胜，写入 winner_id 并 status=finished。"""
    user_id = session.get("user_id")
    if not user_id:
        return jsonify({"error": "未登录"}), 401
    data = request.get_json() or {}
    room_id = (data.get("room_id") or data.get("room_code") or "").strip()
    score = data.get("score") if "score" in data else None
    if not room_id or score is None:
        return jsonify({"error": "缺少 room_id 或 score"}), 400
    try:
        conn = get_db()
        try:
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT id, creator_id, joiner_id, status, host_score, guest_score FROM game_rooms WHERE room_id = %s",
                    (room_id,),
                )
                row = cur.fetchone()
                if not row:
                    return jsonify({"error": "房间不存在"}), 404
                if row["status"] != "playing":
                    return jsonify({"error": "房间未在游戏中"}), 400
                is_host = row["creator_id"] == user_id
                if is_host:
                    cur.execute("UPDATE game_rooms SET host_score = %s WHERE room_id = %s", (score, room_id))
                else:
                    cur.execute("UPDATE game_rooms SET guest_score = %s WHERE room_id = %s", (score, room_id))
                if score >= 3:
                    cur.execute(
                        "UPDATE game_rooms SET winner_id = %s, status = 'finished' WHERE room_id = %s",
                        (user_id, room_id),
                    )
                    ensure_user_wallet_table()
                    cur.execute(
                        "INSERT INTO user_wallet (user_id, coins) VALUES (%s, 10) ON DUPLICATE KEY UPDATE coins = coins + 10",
                        (user_id,),
                    )
            conn.commit()
        finally:
            conn.close()
    except Exception as e:
        return jsonify({"error": str(e)}), 500
    return jsonify({"ok": True})


@app.route("/api/wallet", methods=["GET"])
def api_wallet():
    """当前用户金币数。"""
    user_id = session.get("user_id")
    if not user_id:
        return jsonify({"error": "未登录"}), 401
    ensure_user_wallet_table()
    try:
        conn = get_db()
        try:
            with conn.cursor() as cur:
                cur.execute("SELECT coins FROM user_wallet WHERE user_id = %s", (user_id,))
                row = cur.fetchone()
                coins = int(row["coins"]) if row else 0
            return jsonify({"coins": coins})
        finally:
            conn.close()
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/inventory", methods=["GET"])
def api_inventory():
    """当前用户已购装饰列表。"""
    user_id = session.get("user_id")
    if not user_id:
        return jsonify({"error": "未登录"}), 401
    ensure_user_inventory_table()
    try:
        conn = get_db()
        try:
            with conn.cursor() as cur:
                cur.execute("SELECT item_key FROM user_inventory WHERE user_id = %s", (user_id,))
                rows = cur.fetchall()
            return jsonify({"items": [r["item_key"] for r in rows]})
        finally:
            conn.close()
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/shop/buy", methods=["POST"])
def api_shop_buy():
    """消耗金币购买装饰（领结颜色、果树等）。"""
    user_id = session.get("user_id")
    if not user_id:
        return jsonify({"error": "未登录"}), 401
    data = request.get_json() or {}
    item_key = (data.get("item_key") or "").strip()
    if not item_key or item_key not in SHOP_ITEMS:
        return jsonify({"error": "无效商品"}), 400
    cost = SHOP_ITEMS[item_key]
    ensure_user_wallet_table()
    ensure_user_inventory_table()
    try:
        conn = get_db()
        try:
            with conn.cursor() as cur:
                cur.execute("SELECT coins FROM user_wallet WHERE user_id = %s", (user_id,))
                row = cur.fetchone()
                coins = int(row["coins"]) if row else 0
                cur.execute("SELECT 1 FROM user_inventory WHERE user_id = %s AND item_key = %s", (user_id, item_key))
                if cur.fetchone():
                    return jsonify({"error": "已拥有该装饰"}), 400
                if coins < cost:
                    return jsonify({"error": "金币不足"}), 400
                cur.execute(
                    "UPDATE user_wallet SET coins = coins - %s WHERE user_id = %s AND coins >= %s",
                    (cost, user_id, cost),
                )
                if cur.rowcount == 0:
                    return jsonify({"error": "金币不足"}), 400
                cur.execute("INSERT INTO user_inventory (user_id, item_key) VALUES (%s, %s)", (user_id, item_key))
            conn.commit()
            return jsonify({"ok": True, "item_key": item_key})
        finally:
            conn.close()
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/leaderboard", methods=["GET"])
def api_leaderboard():
    """排行榜：按 game_rooms 胜场数排序，返回用户名与胜场。"""
    limit = min(int(request.args.get("limit", 10)), 50)
    try:
        conn = get_db()
        try:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT u.username, COUNT(*) AS wins
                    FROM game_rooms g
                    JOIN users u ON g.winner_id = u.id
                    WHERE g.winner_id IS NOT NULL
                    GROUP BY g.winner_id
                    ORDER BY wins DESC
                    LIMIT %s
                    """,
                    (limit,),
                )
                rows = cur.fetchall()
            return jsonify({"list": [{"username": r["username"], "wins": int(r["wins"])} for r in rows]})
        finally:
            conn.close()
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/achievements", methods=["GET"])
def api_achievements():
    """森林守护者：当前等级 + 已解锁勋章列表。"""
    user_id = session.get("user_id")
    if not user_id:
        return jsonify({"error": "未登录"}), 401
    ensure_achievement_unlocks_table()
    try:
        conn = get_db()
        try:
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT COUNT(*) AS wins FROM game_rooms WHERE winner_id = %s",
                    (user_id,),
                )
                row = cur.fetchone()
                wins = int(row["wins"] or 0)
                level_index = level_from_wins(wins)
                cur.execute(
                    "SELECT medal_key, unlocked_at FROM achievement_unlocks WHERE user_id = %s ORDER BY unlocked_at ASC",
                    (user_id,),
                )
                medals = [{"key": r["medal_key"], "unlocked_at": r["unlocked_at"].isoformat() if getattr(r["unlocked_at"], "isoformat", None) else str(r["unlocked_at"])} for r in cur.fetchall()]
            return jsonify({
                "wins": wins,
                "level": level_index,
                "level_name": LEVEL_NAMES[level_index],
                "medals": medals,
                "medal_list": ACHIEVEMENT_MEDALS,
            })
        finally:
            conn.close()
    except Exception as e:
        return jsonify({"error": str(e)}), 500


def _vs_win_streak(cur, user_id):
    """当前用户在对战中的连胜次数（从最近一场往前数）。"""
    cur.execute(
        """
        SELECT winner_id FROM game_rooms
        WHERE (creator_id = %s OR joiner_id = %s) AND status = 'finished'
        ORDER BY created_at DESC LIMIT 10
        """,
        (user_id, user_id),
    )
    rows = cur.fetchall()
    streak = 0
    for r in rows:
        if r and r.get("winner_id") == user_id:
            streak += 1
        else:
            break
    return streak


@app.route("/api/achievements/check", methods=["POST"])
def api_achievements_check():
    """对战后调用：根据胜场数、连胜、总胜场与全收集解锁勋章（含限定传说）。"""
    user_id = session.get("user_id")
    if not user_id:
        return jsonify({"error": "未登录"}), 401
    ensure_achievement_unlocks_table()
    try:
        conn = get_db()
        try:
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT COUNT(*) AS wins FROM game_rooms WHERE winner_id = %s",
                    (user_id,),
                )
                wins = int(cur.fetchone()["wins"] or 0)
                unlocked = []
                if wins >= 3 and unlock_medal(cur, user_id, "vs_3_wins"):
                    unlocked.append("vs_3_wins")
                if wins >= 10 and unlock_medal(cur, user_id, "vs_master"):
                    unlocked.append("vs_master")
                if wins >= 3 and unlock_medal(cur, user_id, "brave_lion"):
                    unlocked.append("brave_lion")
                streak = _vs_win_streak(cur, user_id)
                if streak >= 5 and unlock_medal(cur, user_id, "forest_warlord"):
                    unlocked.append("forest_warlord")
                if wins >= 50 and unlock_medal(cur, user_id, "king_of_jungle"):
                    unlocked.append("king_of_jungle")
                else:
                    placeholders = ",".join(["%s"] * len(NORMAL_MEDAL_KEYS))
                    cur.execute(
                        "SELECT COUNT(DISTINCT medal_key) AS c FROM achievement_unlocks WHERE user_id = %s AND medal_key IN (" + placeholders + ")",
                        [user_id] + NORMAL_MEDAL_KEYS,
                    )
                    normal_count = (cur.fetchone() or {}).get("c") or 0
                    if normal_count >= 6 and unlock_medal(cur, user_id, "king_of_jungle"):
                        unlocked.append("king_of_jungle")
            conn.commit()
            return jsonify({"unlocked": unlocked})
        finally:
            conn.close()
    except Exception as e:
        return jsonify({"error": str(e)}), 500


# ---------- 联机对战 REST API（基于 matches 表，配合前端 2 秒轮询） ----------

@app.route("/api/match/create", methods=["POST"])
def api_match_create():
    """创建对战房间：生成 4 位房间码与随机 Emoji 序列，存入 matches 表。"""
    user_id = session.get("user_id")
    if not user_id:
        return jsonify({"error": "未登录"}), 401
    code = make_room_code()
    try:
        conn = get_db()
        try:
            with conn.cursor() as cur:
                cur.execute("SELECT id FROM matches WHERE room_id = %s", (code,))
                while cur.fetchone():
                    code = make_room_code()
                    cur.execute("SELECT id FROM matches WHERE room_id = %s", (code,))
                seq = [random.randint(0, 2) for _ in range(3)]
                import json
                seq_json = json.dumps(seq)
                cur.execute(
                    "INSERT INTO matches (room_id, host_id, emoji_sequence, status) VALUES (%s, %s, %s, 'WAITING')",
                    (code, user_id, seq_json),
                )
            conn.commit()
        finally:
            conn.close()
    except Exception as e:
        return jsonify({"error": str(e)}), 500
    return jsonify({"room_id": code, "emoji_sequence": seq})


@app.route("/api/match/join", methods=["POST"])
def api_match_join():
    """根据房间码加入房间，写入 guest_id，并将状态置为 PLAYING。"""
    user_id = session.get("user_id")
    if not user_id:
        return jsonify({"error": "未登录"}), 401
    data = request.get_json() or {}
    room_id = (data.get("room_id") or data.get("room_code") or "").strip()
    if not room_id:
        return jsonify({"error": "缺少 room_id"}), 400
    try:
        conn = get_db()
        try:
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT id, host_id, guest_id, emoji_sequence, status FROM matches WHERE room_id = %s",
                    (room_id,),
                )
                row = cur.fetchone()
                if not row:
                    return jsonify({"error": "房间不存在或已关闭"}), 404
                if row["guest_id"] is not None:
                    return jsonify({"error": "房间已满"}), 400
                if row["host_id"] == user_id:
                    return jsonify({"error": "不能加入自己创建的房间"}), 400
                import json
                seq = json.loads(row["emoji_sequence"])
                cur.execute(
                    "UPDATE matches SET guest_id = %s, status = 'PLAYING' WHERE room_id = %s",
                    (user_id, room_id),
                )
            conn.commit()
        finally:
            conn.close()
    except Exception as e:
        return jsonify({"error": str(e)}), 500
    return jsonify({"room_id": room_id, "emoji_sequence": seq})


@app.route("/api/match/status", methods=["GET"])
def api_match_status():
    """轮询：返回当前房间状态及双方得分，用于更新进度条与判定结束。"""
    user_id = session.get("user_id")
    if not user_id:
        return jsonify({"error": "未登录"}), 401
    room_id = request.args.get("room_id") or request.args.get("room_code") or ""
    if not room_id:
        return jsonify({"error": "缺少 room_id"}), 400
    try:
        conn = get_db()
        try:
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT host_id, guest_id, emoji_sequence, status, host_score, guest_score, winner_id FROM matches WHERE room_id = %s",
                    (room_id,),
                )
                row = cur.fetchone()
                if not row:
                    return jsonify({"error": "房间不存在"}), 404
                my_role = "host" if row["host_id"] == user_id else "guest" if row["guest_id"] == user_id else None
                if not my_role:
                    return jsonify({"error": "你不是该房间成员"}), 403
                import json
                seq = json.loads(row["emoji_sequence"]) if isinstance(row["emoji_sequence"], str) else row["emoji_sequence"]
                return jsonify({
                    "status": row["status"],
                    "emoji_sequence": seq,
                    "host_score": row["host_score"],
                    "guest_score": row["guest_score"],
                    "winner_id": row["winner_id"],
                    "my_role": my_role,
                })
        finally:
            conn.close()
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/match/update_score", methods=["POST"])
def api_match_update_score():
    """玩家每点对一个 Emoji 调用一次，更新 host_score 或 guest_score；先到 3 者设为 winner。"""
    user_id = session.get("user_id")
    if not user_id:
        return jsonify({"error": "未登录"}), 401
    data = request.get_json() or {}
    room_id = (data.get("room_id") or data.get("room_code") or "").strip()
    score = data.get("score")
    if not room_id or score is None:
        return jsonify({"error": "缺少 room_id 或 score"}), 400
    try:
        score = int(score)
        if not 0 <= score <= 3:
            raise ValueError("score 应为 0-3")
    except (TypeError, ValueError):
        return jsonify({"error": "score 为 0-3 的整数"}), 400
    try:
        conn = get_db()
        try:
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT id, host_id, guest_id, status, host_score, guest_score FROM matches WHERE room_id = %s",
                    (room_id,),
                )
                row = cur.fetchone()
                if not row:
                    return jsonify({"error": "房间不存在"}), 404
                if row["status"] != "PLAYING":
                    return jsonify({"error": "对局未进行中"}), 400
                if row["host_id"] == user_id:
                    cur.execute("UPDATE matches SET host_score = %s WHERE room_id = %s", (score, room_id))
                    if score >= 3:
                        cur.execute("UPDATE matches SET winner_id = %s, status = 'FINISHED' WHERE room_id = %s", (user_id, room_id))
                        cur.execute(
                            "INSERT INTO game_progress (user_id, points) VALUES (%s, 10) ON DUPLICATE KEY UPDATE points = points + 10",
                            (user_id,),
                        )
                elif row["guest_id"] == user_id:
                    cur.execute("UPDATE matches SET guest_score = %s WHERE room_id = %s", (score, room_id))
                    if score >= 3:
                        cur.execute("UPDATE matches SET winner_id = %s, status = 'FINISHED' WHERE room_id = %s", (user_id, room_id))
                        cur.execute(
                            "INSERT INTO game_progress (user_id, points) VALUES (%s, 10) ON DUPLICATE KEY UPDATE points = points + 10",
                            (user_id,),
                        )
                else:
                    return jsonify({"error": "你不是该房间成员"}), 403
            conn.commit()
        finally:
            conn.close()
    except Exception as e:
        return jsonify({"error": str(e)}), 500
    return jsonify({"ok": True})


# ---------- 我的家园贴纸 & 单局完成（每 3 关发贴纸、记录耗时） ----------

STICKER_POOL = [
    ("dino", "🦕"),
    ("astronaut", "👨‍🚀"),
    ("rainbow", "🌈"),
    ("star", "⭐"),
    ("heart", "❤️"),
    ("sun", "☀️"),
    ("moon", "🌙"),
    ("flower", "🌸"),
]


@app.route("/api/collection", methods=["GET"])
def api_collection_get():
    """获取当前用户的贴纸列表（含摆放位置），用于「我的家园」页。"""
    user_id = session.get("user_id")
    if not user_id:
        return jsonify({"error": "未登录"}), 401
    try:
        conn = get_db()
        try:
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT id, sticker_key, earned_at, pos_x, pos_y FROM my_collection WHERE user_id = %s ORDER BY earned_at ASC",
                    (user_id,),
                )
                rows = cur.fetchall()
                stickers = []
                key_to_emoji = dict(STICKER_POOL)
                for r in rows:
                    stickers.append({
                        "id": r["id"],
                        "sticker_key": r["sticker_key"],
                        "emoji": key_to_emoji.get(r["sticker_key"], "⭐"),
                        "pos_x": r["pos_x"],
                        "pos_y": r["pos_y"],
                    })
                return jsonify({"stickers": stickers})
        finally:
            conn.close()
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/collection/save", methods=["POST"])
def api_collection_save():
    """保存贴纸在「我的家园」页的摆放位置。"""
    user_id = session.get("user_id")
    if not user_id:
        return jsonify({"error": "未登录"}), 401
    data = request.get_json() or {}
    items = data.get("stickers") or data.get("items") or []
    if not isinstance(items, list):
        return jsonify({"error": "需要 stickers 数组"}), 400
    try:
        conn = get_db()
        try:
            with conn.cursor() as cur:
                for it in items:
                    pid = it.get("id")
                    px = it.get("pos_x")
                    py = it.get("pos_y")
                    if pid is None:
                        continue
                    cur.execute("UPDATE my_collection SET pos_x = %s, pos_y = %s WHERE id = %s AND user_id = %s", (px, py, pid, user_id))
            conn.commit()
        finally:
            conn.close()
    except Exception as e:
        return jsonify({"error": str(e)}), 500
    return jsonify({"ok": True})


# ---------- 我的家园贴纸乐园：user_stickers 表 + get_home / save_home ----------

@app.route("/api/get_home", methods=["GET"])
def api_get_home():
    """页面初始化：返回画布上已摆放的贴纸 + 仓库中已获得的 Emoji 列表。"""
    user_id = session.get("user_id")
    if not user_id:
        return jsonify({"error": "未登录"}), 401
    try:
        conn = get_db()
        try:
            with conn.cursor() as cur:
                try:
                    cur.execute(
                        "SELECT id, sticker_type, x_pos, y_pos, COALESCE(scale_factor, 1.0) AS scale_factor FROM user_stickers WHERE user_id = %s ORDER BY id ASC",
                        (user_id,),
                    )
                except Exception:
                    cur.execute(
                        "SELECT id, sticker_type, x_pos, y_pos FROM user_stickers WHERE user_id = %s ORDER BY id ASC",
                        (user_id,),
                    )
                rows = cur.fetchall()
                placed = [{"id": r["id"], "sticker_type": r["sticker_type"], "x_pos": r["x_pos"], "y_pos": r["y_pos"], "scale_factor": float(r.get("scale_factor") or 1.0)} for r in rows]

                cur.execute(
                    "SELECT DISTINCT sticker_key FROM my_collection WHERE user_id = %s ORDER BY sticker_key",
                    (user_id,),
                )
                key_to_emoji = dict(STICKER_POOL)
                warehouse = [key_to_emoji.get(r["sticker_key"], "⭐") for r in cur.fetchall() if r["sticker_key"]]
                if not warehouse:
                    warehouse = ["🦁", "🌈", "🏠", "🌳"]
                return jsonify({"placed": placed, "warehouse": warehouse})
        finally:
            conn.close()
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/save_home", methods=["POST"])
def api_save_home():
    """保存家园贴纸位置：接收贴纸列表，替换该用户所有摆放。"""
    user_id = session.get("user_id")
    if not user_id:
        return jsonify({"error": "未登录"}), 401
    data = request.get_json() or {}
    items = data.get("stickers") or data.get("placed") or []
    if not isinstance(items, list):
        return jsonify({"error": "需要 stickers 数组"}), 400
    try:
        conn = get_db()
        try:
            with conn.cursor() as cur:
                cur.execute("DELETE FROM user_stickers WHERE user_id = %s", (user_id,))
                for it in items:
                    st = (it.get("sticker_type") or "").strip()
                    if not st:
                        continue
                    x_val = float(it.get("x_pos", 0) or 0)
                    y_val = float(it.get("y_pos", 0) or 0)
                    x_pos = max(0, min(100, round(x_val)))
                    y_pos = max(0, min(100, round(y_val)))
                    scale_val = float(it.get("scale_factor", 1) or 1)
                    scale_factor = max(0.5, min(3.0, round(scale_val * 100) / 100))
                    cur.execute(
                        "INSERT INTO user_stickers (user_id, sticker_type, x_pos, y_pos, scale_factor) VALUES (%s, %s, %s, %s, %s)",
                        (user_id, st, x_pos, y_pos, scale_factor),
                    )
            conn.commit()
        finally:
            conn.close()
    except Exception as e:
        return jsonify({"error": str(e)}), 500
    return jsonify({"ok": True})


@app.route("/api/game/complete", methods=["POST"])
def api_game_complete():
    """单局结束：记录 play_logs、增加 games_completed、每 3 关发贴纸；并检查成就（初出茅庐/百折不挠/记忆小能手/森林常客）。"""
    user_id = session.get("user_id")
    if not user_id:
        return jsonify({"error": "未登录"}), 401
    data = request.get_json() or {}
    game_type = (data.get("game_type") or "shape").strip() or "shape"
    duration_seconds = float(data.get("duration_seconds") or 0)
    sequence_length = int(data.get("sequence_length") or 0)
    import json as _json
    newly_unlocked = []
    try:
        conn = get_db()
        try:
            with conn.cursor() as cur:
                try:
                    cur.execute(
                        "INSERT INTO play_logs (user_id, game_type, duration_seconds, sequence_length) VALUES (%s, %s, %s, %s)",
                        (user_id, game_type, duration_seconds, sequence_length if sequence_length else None),
                    )
                except pymysql.err.OperationalError:
                    cur.execute(
                        "INSERT INTO play_logs (user_id, game_type, duration_seconds) VALUES (%s, %s, %s)",
                        (user_id, game_type, duration_seconds),
                    )
                cur.execute(
                    "INSERT INTO game_progress (user_id, points, games_completed) VALUES (%s, 0, 1) ON DUPLICATE KEY UPDATE games_completed = games_completed + 1",
                    (user_id,),
                )
                cur.execute("SELECT games_completed FROM game_progress WHERE user_id = %s", (user_id,))
                row = cur.fetchone()
                games_completed = (row or {}).get("games_completed") or 0
                new_sticker = None
                sticker_key = None
                if games_completed > 0 and games_completed % 3 == 0:
                    key, emoji = random.choice(STICKER_POOL)
                    cur.execute("INSERT INTO my_collection (user_id, sticker_key) VALUES (%s, %s)", (user_id, key))
                    new_sticker = emoji
                    sticker_key = key
                ensure_achievement_unlocks_table()
                if games_completed >= 1 and unlock_medal(cur, user_id, "first_single"):
                    newly_unlocked.append("first_single")
                if games_completed >= 50 and unlock_medal(cur, user_id, "play_50"):
                    newly_unlocked.append("play_50")
                if games_completed >= 20 and unlock_medal(cur, user_id, "forest_regular"):
                    newly_unlocked.append("forest_regular")
                if game_type == "seq":
                    if unlock_medal(cur, user_id, "seq_master"):
                        newly_unlocked.append("seq_master")
                    if sequence_length >= 5 and duration_seconds > 0 and duration_seconds < 3 and unlock_medal(cur, user_id, "lightning_reflex"):
                        newly_unlocked.append("lightning_reflex")
            conn.commit()
        finally:
            conn.close()
    except Exception as e:
        return jsonify({"error": str(e)}), 500
    return jsonify({"ok": True, "new_sticker": new_sticker, "sticker_key": sticker_key, "newly_unlocked": newly_unlocked})


# ---------- 家长护航：成长简报（今日心情+游戏时长+鼓励文案）& 足迹 ----------

def _resolve_report_user_id():
    """成长简报用：优先 session，其次 query 的 user_id（家长从儿童端链接带入）。"""
    uid = session.get("user_id")
    if uid:
        return uid
    q = request.args.get("user_id")
    if q and str(q).isdigit():
        return int(q)
    return None


@app.route("/api/parent/report", methods=["GET"])
def api_parent_report():
    """成长简报：今日游戏时长、心情、足迹；累计专注时长、记忆力峰值、对战胜率、勋章数、近7日趋势；支持 ?user_id= 家长端识别。"""
    user_id = _resolve_report_user_id()
    if not user_id:
        return jsonify({"error": "未登录"}), 401
    date_str = request.args.get("date") or datetime.now().strftime("%Y-%m-%d")
    try:
        conn = get_db()
        try:
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT COALESCE(SUM(duration_seconds), 0) AS total_seconds FROM play_logs WHERE user_id = %s AND DATE(created_at) = %s",
                    (user_id, date_str),
                )
                play = cur.fetchone()
                total_seconds = int((play or {}).get("total_seconds") or 0)
                minutes = total_seconds // 60

                cur.execute(
                    "SELECT mood, COUNT(*) AS cnt FROM mood_logs WHERE user_id = %s AND DATE(created_at) = %s GROUP BY mood",
                    (user_id, date_str),
                )
                moods = {r["mood"]: r["cnt"] for r in cur.fetchall()}
                happy_count = moods.get("happy", 0) + moods.get("proud", 0)
                sad_count = moods.get("sad", 0)
                mood_text = "很开心" if happy_count > sad_count else "有点不开心" if sad_count > 0 else "平静"

                cur.execute(
                    "SELECT lat, lng, created_at FROM location_logs WHERE user_id = %s AND DATE(created_at) = %s ORDER BY created_at ASC",
                    (user_id, date_str),
                )
                locations = cur.fetchall()
                for loc in locations:
                    loc["lat"] = float(loc["lat"])
                    loc["lng"] = float(loc["lng"])

                # 累计专注时长（总分钟）
                cur.execute(
                    "SELECT COALESCE(SUM(duration_seconds), 0) AS total_seconds FROM play_logs WHERE user_id = %s",
                    (user_id,),
                )
                life_play = cur.fetchone()
                total_minutes_all = int((life_play or {}).get("total_seconds") or 0) // 60

                # 记忆力峰值：顺序记忆最长序列长度
                cur.execute(
                    "SELECT COALESCE(MAX(sequence_length), 0) AS peak FROM play_logs WHERE user_id = %s AND game_type = 'seq' AND sequence_length IS NOT NULL",
                    (user_id,),
                )
                mem_row = cur.fetchone()
                memory_peak = int((mem_row or {}).get("peak") or 0)

                # 对战胜率：game_rooms 中参与场次与获胜场次
                cur.execute(
                    "SELECT COUNT(*) AS total FROM game_rooms WHERE (creator_id = %s OR joiner_id = %s) AND status = 'finished'",
                    (user_id, user_id),
                )
                vs_total = (cur.fetchone() or {}).get("total") or 0
                cur.execute(
                    "SELECT COUNT(*) AS wins FROM game_rooms WHERE winner_id = %s AND status = 'finished'",
                    (user_id,),
                )
                vs_wins = (cur.fetchone() or {}).get("wins") or 0
                versus_win_rate = round(100 * vs_wins / vs_total, 1) if vs_total else 0.0

                # 勋章总数
                ensure_achievement_unlocks_table()
                cur.execute(
                    "SELECT COUNT(DISTINCT medal_key) AS c FROM achievement_unlocks WHERE user_id = %s",
                    (user_id,),
                )
                badges_count = (cur.fetchone() or {}).get("c") or 0

                # 近 7 日每日游戏分钟数（用于进步曲线）
                cur.execute(
                    """
                    SELECT DATE(created_at) AS d, COALESCE(SUM(duration_seconds), 0) AS sec
                    FROM play_logs WHERE user_id = %s AND created_at >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)
                    GROUP BY DATE(created_at) ORDER BY d ASC
                    """,
                    (user_id,),
                )
                daily_rows = cur.fetchall()
                last_7_days = []
                for r in daily_rows:
                    last_7_days.append({"date": str(r["d"]), "minutes": int(r["sec"]) // 60})

                summary = f"今天宝贝玩了 {minutes} 分钟，心情{mood_text}。"
                if total_seconds >= 60:
                    summary += "专注力很棒，继续加油哦！"
                else:
                    summary += "明天再来玩吧！"

                return jsonify({
                    "date": date_str,
                    "summary": summary,
                    "total_minutes": minutes,
                    "mood_text": mood_text,
                    "locations": locations,
                    "total_minutes_all": total_minutes_all,
                    "memory_peak": memory_peak,
                    "versus_win_rate": versus_win_rate,
                    "versus_total": vs_total,
                    "versus_wins": vs_wins,
                    "badges_count": badges_count,
                    "last_7_days": last_7_days,
                })
        finally:
            conn.close()
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/weekly_summary", methods=["GET"])
def api_weekly_summary():
    """森林周刊：上周（周一至周日）总游戏时长、挑战次数、最活跃日、本周新增勋章、能力雷达数据。"""
    user_id = session.get("user_id")
    if not user_id:
        return jsonify({"error": "未登录"}), 401
    today = datetime.now().date()
    # 上周一 00:00 至 上周日 23:59:59
    last_week_monday = today - timedelta(days=today.weekday() + 7)
    last_week_sunday = last_week_monday + timedelta(days=6)
    start_dt = datetime.combine(last_week_monday, datetime.min.time())
    end_dt = datetime.combine(last_week_sunday, datetime.max.time())
    try:
        conn = get_db()
        try:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT COALESCE(SUM(duration_seconds), 0) AS total_sec, COUNT(*) AS games_count
                    FROM play_logs WHERE user_id = %s AND created_at >= %s AND created_at <= %s
                    """,
                    (user_id, start_dt, end_dt),
                )
                row = cur.fetchone() or {}
                total_seconds = int(row.get("total_sec") or 0)
                games_count = int(row.get("games_count") or 0)
                total_minutes = total_seconds // 60

                cur.execute(
                    """
                    SELECT DATE(created_at) AS d, COALESCE(SUM(duration_seconds), 0) AS sec, COUNT(*) AS cnt
                    FROM play_logs WHERE user_id = %s AND created_at >= %s AND created_at <= %s
                    GROUP BY DATE(created_at) ORDER BY sec DESC LIMIT 1
                    """,
                    (user_id, start_dt, end_dt),
                )
                most_row = cur.fetchone()
                most_active_date = str(most_row["d"]) if most_row else None

                ensure_achievement_unlocks_table()
                cur.execute(
                    """
                    SELECT medal_key, unlocked_at FROM achievement_unlocks
                    WHERE user_id = %s AND unlocked_at >= %s AND unlocked_at <= %s
                    ORDER BY unlocked_at ASC
                    """,
                    (user_id, start_dt, end_dt),
                )
                new_medals = []
                for r in cur.fetchall():
                    key = r.get("medal_key") or ""
                    name_map = {
                        "first_single": "初出茅庐", "play_50": "森林常客", "forest_regular": "森林常客",
                        "seq_master": "记忆大师", "lightning_reflex": "闪电快手", "king_of_jungle": "森林之王",
                        "forest_warlord": "森林战神", "brave_lion": "勇敢小狮子",
                    }
                    new_medals.append({"key": key, "name": name_map.get(key, key)})

                cur.execute(
                    "SELECT COALESCE(MAX(sequence_length), 0) AS peak FROM play_logs WHERE user_id = %s AND game_type = 'seq' AND created_at >= %s AND created_at <= %s",
                    (user_id, start_dt, end_dt),
                )
                mem_row = cur.fetchone()
                memory_peak = int((mem_row or {}).get("peak") or 0)
                reaction = min(100, 20 + games_count * 3 + memory_peak * 5)
                patience = min(100, 15 + total_minutes * 2)
                activity = min(100, 10 + games_count * 4)
                memory = min(100, 10 + memory_peak * 12)
                radar = {"reaction": reaction, "memory": memory, "patience": patience, "activity": activity}

                return jsonify({
                    "total_minutes": total_minutes,
                    "games_count": games_count,
                    "most_active_date": most_active_date,
                    "new_medals": new_medals,
                    "radar": radar,
                    "week_start": last_week_monday.isoformat(),
                    "week_end": last_week_sunday.isoformat(),
                })
        finally:
            conn.close()
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/weekly_leaderboard", methods=["GET"])
def api_weekly_leaderboard():
    """本周最勤劳的小松鼠：按勤劳值（通关数*10 + 游玩分钟*5）排序，返回上周一至上周日数据，前10名 + 当前用户排名与差距；冠军可选灯笼颜色时返回 champion_can_choose_color。"""
    user_id = session.get("user_id")
    if not user_id:
        return jsonify({"error": "未登录"}), 401
    ensure_app_settings_table()
    today = datetime.now().date()
    last_week_monday = today - timedelta(days=today.weekday() + 7)
    last_week_sunday = last_week_monday + timedelta(days=6)
    start_dt = datetime.combine(last_week_monday, datetime.min.time())
    end_dt = datetime.combine(last_week_sunday, datetime.max.time())
    try:
        conn = get_db()
        try:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT p.user_id,
                           COALESCE(SUM(p.duration_seconds), 0) AS total_sec,
                           COUNT(*) AS games_count
                    FROM play_logs p
                    WHERE p.created_at >= %s AND p.created_at <= %s
                    GROUP BY p.user_id
                    """,
                    (start_dt, end_dt),
                )
                rows = cur.fetchall()
                acorn_list = []
                for r in rows:
                    uid = r["user_id"]
                    total_sec = int(r["total_sec"] or 0)
                    games_count = int(r["games_count"] or 0)
                    total_minutes = total_sec // 60
                    acorns = games_count * 10 + total_minutes * 5
                    acorn_list.append({
                        "user_id": uid,
                        "acorns": acorns,
                        "games_count": games_count,
                        "total_minutes": total_minutes,
                    })
                acorn_list.sort(key=lambda x: x["acorns"], reverse=True)
                total_count = len(acorn_list)
                title_map = {1: "森林守护者", 2: "勤劳小松鼠", 3: "丛林巡逻员"}
                leaderboard = []
                for i, row in enumerate(acorn_list[:10], start=1):
                    cur.execute("SELECT username FROM users WHERE id = %s", (row["user_id"],))
                    u = cur.fetchone()
                    username = (u["username"] if u else "") or "小勇士"
                    title = title_map.get(i, "森林居民")
                    leaderboard.append({
                        "rank": i,
                        "user_id": row["user_id"],
                        "username": username,
                        "acorns": row["acorns"],
                        "games_count": row["games_count"],
                        "total_minutes": row["total_minutes"],
                        "title": title,
                    })
                my_rank = None
                my_acorns = 0
                my_games_count = 0
                my_total_minutes = 0
                gap_to_above = 0
                rank_above_nickname = None
                for i, row in enumerate(acorn_list, start=1):
                    if row["user_id"] == user_id:
                        my_rank = i
                        my_acorns = row["acorns"]
                        my_games_count = row["games_count"]
                        my_total_minutes = row["total_minutes"]
                        if i > 1:
                            prev = acorn_list[i - 2]
                            gap_to_above = prev["acorns"] - row["acorns"]
                            cur.execute("SELECT username FROM users WHERE id = %s", (prev["user_id"],))
                            u = cur.fetchone()
                            rank_above_nickname = (u["username"] if u else "") or "小勇士"
                        break
                champion_can_choose_color = False
                if my_rank == 1:
                    cur.execute("SELECT v FROM app_settings WHERE k = 'lantern_week'")
                    rw = cur.fetchone()
                    this_monday = today - timedelta(days=today.weekday())
                    saved_week = (rw["v"] if rw and rw["v"] else None)
                    if saved_week != this_monday.isoformat():
                        champion_can_choose_color = True

                return jsonify({
                    "leaderboard": leaderboard,
                    "total_count": total_count,
                    "my_rank": my_rank,
                    "my_acorns": my_acorns,
                    "my_games_count": my_games_count,
                    "my_total_minutes": my_total_minutes,
                    "gap_to_above": gap_to_above,
                    "rank_above_nickname": rank_above_nickname,
                    "champion_can_choose_color": champion_can_choose_color,
                    "week_start": last_week_monday.isoformat(),
                    "week_end": last_week_sunday.isoformat(),
                })
        finally:
            conn.close()
    except Exception as e:
        return jsonify({"error": str(e)}), 500


LANTERN_COLORS = {
    "warm_yellow": {"name": "暖阳黄", "rgba": "rgba(255, 180, 50, 0.88)", "glow": "rgba(255, 170, 0, 0.5)"},
    "sakura_pink": {"name": "樱花粉", "rgba": "rgba(255, 182, 193, 0.9)", "glow": "rgba(255, 105, 180, 0.5)"},
    "aurora_green": {"name": "极光绿", "rgba": "rgba(144, 238, 144, 0.9)", "glow": "rgba(50, 205, 50, 0.5)"},
    "dream_blue": {"name": "梦幻蓝", "rgba": "rgba(135, 206, 250, 0.9)", "glow": "rgba(30, 144, 255, 0.5)"},
    "lavender_purple": {"name": "薰衣草紫", "rgba": "rgba(218, 112, 214, 0.85)", "glow": "rgba(186, 85, 211, 0.5)"},
}


@app.route("/api/set_lantern_color", methods=["POST"])
def api_set_lantern_color():
    """上周勤劳榜第一名可设置全森林灯笼颜色；每周仅可设置一次。"""
    user_id = session.get("user_id")
    username = session.get("username")
    if not user_id or not username:
        return jsonify({"error": "未登录"}), 401
    data = request.get_json() or {}
    color_key = (data.get("color") or "").strip() or "warm_yellow"
    if color_key not in LANTERN_COLORS:
        return jsonify({"error": "无效颜色"}), 400
    today = datetime.now().date()
    this_monday = today - timedelta(days=today.weekday())
    last_week_monday = today - timedelta(days=today.weekday() + 7)
    last_week_sunday = last_week_monday + timedelta(days=6)
    start_dt = datetime.combine(last_week_monday, datetime.min.time())
    end_dt = datetime.combine(last_week_sunday, datetime.max.time())
    try:
        conn = get_db()
        try:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT p.user_id, COALESCE(SUM(p.duration_seconds), 0) AS total_sec, COUNT(*) AS games_count
                    FROM play_logs p
                    WHERE p.created_at >= %s AND p.created_at <= %s
                    GROUP BY p.user_id
                    """,
                    (start_dt, end_dt),
                )
                rows = cur.fetchall()
                acorn_list = []
                for r in rows:
                    total_sec = int(r["total_sec"] or 0)
                    games_count = int(r["games_count"] or 0)
                    total_minutes = total_sec // 60
                    acorns = games_count * 10 + total_minutes * 5
                    acorn_list.append({"user_id": r["user_id"], "acorns": acorns})
                acorn_list.sort(key=lambda x: x["acorns"], reverse=True)
                if not acorn_list or acorn_list[0]["user_id"] != user_id:
                    return jsonify({"error": "仅上周勤劳榜冠军可设置"}), 403
                ensure_app_settings_table()
                for k, v in [
                    ("lantern_color", color_key),
                    ("lantern_champion_username", username),
                    ("lantern_week", this_monday.isoformat()),
                ]:
                    cur.execute(
                        "INSERT INTO app_settings (k, v) VALUES (%s, %s) ON DUPLICATE KEY UPDATE v = VALUES(v)",
                        (k, v),
                    )
            conn.commit()
        finally:
            conn.close()
    except Exception as e:
        return jsonify({"error": str(e)}), 500
    return jsonify({
        "ok": True,
        "lantern_color": color_key,
        "lantern_color_name": LANTERN_COLORS[color_key]["name"],
        "lantern_champion_username": username,
    })


# 家园底图等图片：始终从 app.py 所在目录的 images 文件夹提供（避免因启动目录导致 404）
_IMAGES_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "images")


@app.route("/images/<path:filename>")
def serve_images(filename):
    """家园等页面使用的图片资源（如森林底图）。"""
    return send_from_directory(_IMAGES_DIR, filename)


@app.route("/")
def kids_home():
    return render_template("kids.html")


@app.route("/achievements")
def page_achievements():
    """勋章馆独立页：网格展示 6 枚勋章，未解锁灰色、已解锁彩色+光效。"""
    return render_template("achievements.html")


@app.route("/parent")
def parent_page():
    """家长端：成长简报与足迹。"""
    return render_template("parent.html")


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5100))
    socketio.run(app, host="0.0.0.0", port=port, debug=False, allow_unsafe_werkzeug=True)
