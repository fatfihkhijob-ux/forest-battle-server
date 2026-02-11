# -*- coding: utf-8 -*-
"""
初始化儿童开智小程序使用的 MySQL 数据库与表结构。
包含：users（含加密密码字段）、user_sessions（登录日志）。
运行方式：在 game 目录下执行 python init_db.py
"""
import pymysql
from config import MYSQL_CONFIG, DB_NAME

# 建库
CREATE_DB = f"CREATE DATABASE IF NOT EXISTS {DB_NAME} DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"

# users 表：用户名、密码哈希（严禁明文）、可选邮箱、注册时间
CREATE_USERS = """
CREATE TABLE IF NOT EXISTS users (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(64) NOT NULL UNIQUE COMMENT '用户名',
    password_hash VARCHAR(256) NOT NULL COMMENT '加密后的密码，禁止明文',
    email VARCHAR(128) NULL DEFAULT NULL COMMENT '邮箱（可选）',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '注册时间',
    KEY idx_username (username)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='用户表';
"""

# 登录日志表：每次登录成功记录一条
CREATE_USER_SESSIONS = """
CREATE TABLE IF NOT EXISTS user_sessions (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    user_id INT UNSIGNED NOT NULL COMMENT '用户 ID',
    login_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '登录时间',
    KEY idx_user_id (user_id),
    KEY idx_login_at (login_at),
    CONSTRAINT fk_sessions_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='登录日志';
"""

# 用户表增加 last_login（登录成功后更新）
ALTER_USERS_LAST_LOGIN = """
ALTER TABLE users ADD COLUMN last_login DATETIME NULL DEFAULT NULL COMMENT '最后登录时间' AFTER created_at;
"""

# 对战积分表：率先完成的一方获胜后增加积分；games_completed 用于每 3 关发贴纸
CREATE_GAME_PROGRESS = """
CREATE TABLE IF NOT EXISTS game_progress (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    user_id INT UNSIGNED NOT NULL UNIQUE COMMENT '用户 ID',
    points INT UNSIGNED NOT NULL DEFAULT 0 COMMENT '对战积分',
    games_completed INT UNSIGNED NOT NULL DEFAULT 0 COMMENT '累计完成关数，每3关发贴纸',
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    KEY idx_user_id (user_id),
    CONSTRAINT fk_progress_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='用户对战积分';
"""

ALTER_GAME_PROGRESS_GAMES = """
ALTER TABLE game_progress ADD COLUMN games_completed INT UNSIGNED NOT NULL DEFAULT 0 COMMENT '累计完成关数' AFTER points;
"""

# 单局游戏记录：耗时等，用于专注力与成长简报
CREATE_PLAY_LOGS = """
CREATE TABLE IF NOT EXISTS play_logs (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    user_id INT UNSIGNED NOT NULL COMMENT '用户 ID',
    game_type VARCHAR(32) NOT NULL COMMENT 'shape/color/seq/shadow/versus',
    duration_seconds DECIMAL(8,2) NOT NULL DEFAULT 0 COMMENT '本局耗时秒',
    sequence_length INT UNSIGNED NULL DEFAULT NULL COMMENT '顺序记忆关卡长度，仅 seq 时有值',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    KEY idx_user_id (user_id),
    KEY idx_created_at (created_at),
    CONSTRAINT fk_play_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='单局游戏记录';
"""

ALTER_PLAY_LOGS_SEQUENCE = """
ALTER TABLE play_logs ADD COLUMN sequence_length INT UNSIGNED NULL DEFAULT NULL COMMENT '顺序记忆关卡长度' AFTER duration_seconds;
"""

# 我的家园贴纸：每过 3 关获得一个，可拖拽摆放
CREATE_MY_COLLECTION = """
CREATE TABLE IF NOT EXISTS my_collection (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    user_id INT UNSIGNED NOT NULL COMMENT '用户 ID',
    sticker_key VARCHAR(32) NOT NULL COMMENT '贴纸标识如 dino/astronaut/rainbow',
    earned_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '获得时间',
    pos_x INT NULL DEFAULT NULL COMMENT '家园页摆放 X',
    pos_y INT NULL DEFAULT NULL COMMENT '家园页摆放 Y',
    KEY idx_user_id (user_id),
    CONSTRAINT fk_collection_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='我的家园贴纸';
"""

# 心情打卡表：游戏结束后孩子点开心/不开心
CREATE_MOOD_LOGS = """
CREATE TABLE IF NOT EXISTS mood_logs (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    user_id INT UNSIGNED NOT NULL COMMENT '用户 ID',
    mood VARCHAR(20) NOT NULL COMMENT 'happy/sad',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    KEY idx_user_id (user_id),
    KEY idx_created_at (created_at),
    CONSTRAINT fk_mood_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='心情打卡';
"""

# 联机对战房间表：房间码、房主/对手、Emoji 序列、状态、双方得分、胜者
CREATE_MATCHES = """
CREATE TABLE IF NOT EXISTS matches (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    room_id VARCHAR(8) NOT NULL UNIQUE COMMENT '4位房间码',
    host_id INT UNSIGNED NOT NULL COMMENT '房主用户ID',
    guest_id INT UNSIGNED NULL DEFAULT NULL COMMENT '加入者用户ID',
    emoji_sequence VARCHAR(32) NOT NULL COMMENT 'JSON数组如[0,1,2]',
    status VARCHAR(20) NOT NULL DEFAULT 'WAITING' COMMENT 'WAITING/PLAYING/FINISHED',
    host_score INT UNSIGNED NOT NULL DEFAULT 0 COMMENT '房主当前得分0-3',
    guest_score INT UNSIGNED NOT NULL DEFAULT 0 COMMENT '对手当前得分0-3',
    winner_id INT UNSIGNED NULL DEFAULT NULL COMMENT '先完成3步者',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    KEY idx_room_id (room_id),
    KEY idx_status (status),
    CONSTRAINT fk_match_host FOREIGN KEY (host_id) REFERENCES users (id) ON DELETE CASCADE,
    CONSTRAINT fk_match_guest FOREIGN KEY (guest_id) REFERENCES users (id) ON DELETE SET NULL,
    CONSTRAINT fk_match_winner FOREIGN KEY (winner_id) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='联机对战房间';
"""

# 双人对战房间表（6 位房间号，用于创建/加入房间）
CREATE_GAME_ROOMS = """
CREATE TABLE IF NOT EXISTS game_rooms (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    room_id VARCHAR(6) NOT NULL UNIQUE COMMENT '6位随机房间号',
    creator_id INT UNSIGNED NOT NULL COMMENT '创建者用户ID',
    joiner_id INT UNSIGNED NULL DEFAULT NULL COMMENT '加入者用户ID',
    status VARCHAR(20) NOT NULL DEFAULT 'waiting' COMMENT 'waiting/playing/finished',
    emoji_sequence VARCHAR(32) NULL DEFAULT NULL COMMENT 'JSON数组如[0,1,2]',
    host_score INT UNSIGNED NOT NULL DEFAULT 0,
    guest_score INT UNSIGNED NOT NULL DEFAULT 0,
    winner_id INT UNSIGNED NULL DEFAULT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    KEY idx_room_id (room_id),
    KEY idx_status (status),
    CONSTRAINT fk_gr_creator FOREIGN KEY (creator_id) REFERENCES users (id) ON DELETE CASCADE,
    CONSTRAINT fk_gr_joiner FOREIGN KEY (joiner_id) REFERENCES users (id) ON DELETE SET NULL,
    CONSTRAINT fk_gr_winner FOREIGN KEY (winner_id) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='双人对战房间(6位房间号)';
"""

# 家园贴纸摆放表：每行一条“已摆上画布”的贴纸，x_pos/y_pos 为画布坐标，scale_factor 为缩放比例
CREATE_USER_STICKERS = """
CREATE TABLE IF NOT EXISTS user_stickers (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    user_id INT UNSIGNED NOT NULL COMMENT '用户 ID',
    sticker_type VARCHAR(64) NOT NULL COMMENT 'Emoji 或图片路径',
    x_pos INT NOT NULL DEFAULT 0 COMMENT '画布 X',
    y_pos INT NOT NULL DEFAULT 0 COMMENT '画布 Y',
    scale_factor FLOAT NOT NULL DEFAULT 1.0 COMMENT '缩放比例 0.5~3',
    KEY idx_user_id (user_id),
    CONSTRAINT fk_stickers_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='家园贴纸摆放';
"""

# 已有表补列：为旧库增加 scale_factor（若已存在则忽略）
ALTER_USER_STICKERS_ADD_SCALE = """
ALTER TABLE user_stickers ADD COLUMN scale_factor FLOAT NOT NULL DEFAULT 1.0 COMMENT '缩放比例 0.5~3';
"""

# 位置记录表：家长端护航，每分钟静默记录
CREATE_LOCATION_LOGS = """
CREATE TABLE IF NOT EXISTS location_logs (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    user_id INT UNSIGNED NOT NULL COMMENT '用户 ID',
    lat DECIMAL(10,7) NOT NULL COMMENT '纬度',
    lng DECIMAL(10,7) NOT NULL COMMENT '经度',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    KEY idx_user_id (user_id),
    KEY idx_created_at (created_at),
    CONSTRAINT fk_location_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='位置记录';
"""


def get_connection(use_db=True):
    """获取 MySQL 连接。use_db=False 时仅连服务器不选库（用于建库）。"""
    cfg = {**MYSQL_CONFIG}
    if use_db:
        cfg["database"] = DB_NAME
    return pymysql.connect(**cfg)


def init_db():
    """创建数据库及 users、user_sessions、game_progress、mood_logs、location_logs 表；为 users 增加 last_login。"""
    conn = get_connection(use_db=False)
    try:
        with conn.cursor() as cur:
            cur.execute(CREATE_DB)
            conn.commit()
        conn.select_db(DB_NAME)
        with conn.cursor() as cur:
            cur.execute(CREATE_USERS)
            cur.execute(CREATE_USER_SESSIONS)
            try:
                cur.execute(ALTER_USERS_LAST_LOGIN)
            except pymysql.err.OperationalError as e:
                if "Duplicate column" not in str(e):
                    raise
            cur.execute(CREATE_GAME_PROGRESS)
            try:
                cur.execute(ALTER_GAME_PROGRESS_GAMES)
            except pymysql.err.OperationalError as e:
                if "Duplicate column" not in str(e):
                    raise
            cur.execute(CREATE_MOOD_LOGS)
            cur.execute(CREATE_LOCATION_LOGS)
            cur.execute(CREATE_MATCHES)
            cur.execute(CREATE_GAME_ROOMS)
            cur.execute(CREATE_PLAY_LOGS)
            try:
                cur.execute(ALTER_PLAY_LOGS_SEQUENCE)
            except pymysql.err.OperationalError as e:
                if "Duplicate column" not in str(e):
                    raise
            cur.execute(CREATE_MY_COLLECTION)
            cur.execute(CREATE_USER_STICKERS)
            try:
                cur.execute(ALTER_USER_STICKERS_ADD_SCALE)
            except pymysql.err.OperationalError as e:
                if "Duplicate column" not in str(e):
                    raise
            conn.commit()
        print(f"Database '{DB_NAME}' and tables users, user_sessions, game_progress, mood_logs, location_logs, matches, game_rooms, play_logs, my_collection, user_stickers are ready.")
    finally:
        conn.close()


if __name__ == "__main__":
    init_db()
