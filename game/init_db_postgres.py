# -*- coding: utf-8 -*-
"""
初始化 PostgreSQL 数据库（Render 等）。需设置环境变量 DATABASE_URL。
在 game 目录下执行：python init_db_postgres.py
"""
import os
import psycopg2

DATABASE_URL = os.environ.get("DATABASE_URL")
if not DATABASE_URL:
    print("请设置环境变量 DATABASE_URL（Render 绑定 PostgreSQL 后会自动注入）")
    exit(1)
if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = "postgresql://" + DATABASE_URL[9:]

conn = psycopg2.connect(DATABASE_URL)
conn.autocommit = False

def run(cur, sql, name=""):
    try:
        cur.execute(sql)
        if name:
            print("OK:", name)
    except Exception as e:
        if "already exists" in str(e) or "duplicate" in str(e).lower():
            print("跳过(已存在):", name or sql[:50])
        else:
            print("ERR:", name or sql[:50], e)
            raise

try:
    with conn.cursor() as cur:
        run(cur, """
        CREATE TABLE IF NOT EXISTS users (
            id SERIAL PRIMARY KEY,
            username VARCHAR(64) NOT NULL UNIQUE,
            password_hash VARCHAR(256) NOT NULL,
            email VARCHAR(128) NULL,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            last_login TIMESTAMP NULL,
            likes_received INTEGER NOT NULL DEFAULT 0
        )
        """, "users")
        run(cur, """
        CREATE TABLE IF NOT EXISTS user_sessions (
            id BIGSERIAL PRIMARY KEY,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            login_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
        """, "user_sessions")
        run(cur, "CREATE INDEX IF NOT EXISTS idx_user_sessions_user_id ON user_sessions(user_id)", "idx_user_sessions")
        run(cur, """
        CREATE TABLE IF NOT EXISTS game_progress (
            id SERIAL PRIMARY KEY,
            user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
            points INTEGER NOT NULL DEFAULT 0,
            games_completed INTEGER NOT NULL DEFAULT 0,
            updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
        """, "game_progress")
        run(cur, """
        CREATE TABLE IF NOT EXISTS mood_logs (
            id BIGSERIAL PRIMARY KEY,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            mood VARCHAR(20) NOT NULL,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
        """, "mood_logs")
        run(cur, """
        CREATE TABLE IF NOT EXISTS location_logs (
            id BIGSERIAL PRIMARY KEY,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            lat DECIMAL(10,7) NOT NULL,
            lng DECIMAL(10,7) NOT NULL,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
        """, "location_logs")
        run(cur, """
        CREATE TABLE IF NOT EXISTS matches (
            id SERIAL PRIMARY KEY,
            room_id VARCHAR(8) NOT NULL UNIQUE,
            host_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            guest_id INTEGER NULL REFERENCES users(id) ON DELETE SET NULL,
            emoji_sequence VARCHAR(32) NOT NULL,
            status VARCHAR(20) NOT NULL DEFAULT 'WAITING',
            host_score INTEGER NOT NULL DEFAULT 0,
            guest_score INTEGER NOT NULL DEFAULT 0,
            winner_id INTEGER NULL REFERENCES users(id) ON DELETE SET NULL,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
        """, "matches")
        run(cur, """
        CREATE TABLE IF NOT EXISTS game_rooms (
            id SERIAL PRIMARY KEY,
            room_id VARCHAR(6) NOT NULL UNIQUE,
            creator_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            joiner_id INTEGER NULL REFERENCES users(id) ON DELETE SET NULL,
            status VARCHAR(20) NOT NULL DEFAULT 'waiting',
            emoji_sequence VARCHAR(32) NULL,
            host_score INTEGER NOT NULL DEFAULT 0,
            guest_score INTEGER NOT NULL DEFAULT 0,
            winner_id INTEGER NULL REFERENCES users(id) ON DELETE SET NULL,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
        """, "game_rooms")
        run(cur, """
        CREATE TABLE IF NOT EXISTS play_logs (
            id BIGSERIAL PRIMARY KEY,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            game_type VARCHAR(32) NOT NULL,
            duration_seconds DECIMAL(8,2) NOT NULL DEFAULT 0,
            sequence_length INTEGER NULL,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
        """, "play_logs")
        run(cur, """
        CREATE TABLE IF NOT EXISTS my_collection (
            id SERIAL PRIMARY KEY,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            sticker_key VARCHAR(32) NOT NULL,
            earned_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            pos_x INTEGER NULL,
            pos_y INTEGER NULL
        )
        """, "my_collection")
        run(cur, """
        CREATE TABLE IF NOT EXISTS user_stickers (
            id SERIAL PRIMARY KEY,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            sticker_type VARCHAR(64) NOT NULL,
            x_pos INTEGER NOT NULL DEFAULT 0,
            y_pos INTEGER NOT NULL DEFAULT 0,
            scale_factor FLOAT NOT NULL DEFAULT 1.0
        )
        """, "user_stickers")
        run(cur, """
        CREATE TABLE IF NOT EXISTS app_settings (
            k VARCHAR(64) NOT NULL PRIMARY KEY,
            v TEXT NULL,
            updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
        """, "app_settings")
        run(cur, """
        CREATE TABLE IF NOT EXISTS achievement_unlocks (
            id SERIAL PRIMARY KEY,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            medal_key VARCHAR(64) NOT NULL,
            unlocked_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(user_id, medal_key)
        )
        """, "achievement_unlocks")
        run(cur, """
        CREATE TABLE IF NOT EXISTS worship_log (
            room_id VARCHAR(6) NOT NULL,
            worshipper_id INTEGER NOT NULL,
            king_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (room_id, worshipper_id)
        )
        """, "worship_log")
        run(cur, """
        CREATE TABLE IF NOT EXISTS user_wallet (
            user_id INTEGER NOT NULL PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
            coins INTEGER NOT NULL DEFAULT 0
        )
        """, "user_wallet")
        run(cur, """
        CREATE TABLE IF NOT EXISTS user_inventory (
            id SERIAL PRIMARY KEY,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            item_key VARCHAR(64) NOT NULL,
            acquired_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(user_id, item_key)
        )
        """, "user_inventory")
        conn.commit()
    print("PostgreSQL 表初始化完成。")
finally:
    conn.close()
