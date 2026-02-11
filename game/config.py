# 数据库配置
# - 若设置了 DATABASE_URL（Render 绑定 PostgreSQL 后自动注入），则用 PostgreSQL
# - 否则用 MYSQL_* 环境变量或本地 MySQL 默认值
import os

DATABASE_URL = os.environ.get("DATABASE_URL")  # Render PostgreSQL 连接串

MYSQL_CONFIG = {
    "host": os.environ.get("MYSQL_HOST", "127.0.0.1"),
    "port": int(os.environ.get("MYSQL_PORT", "3306")),
    "user": os.environ.get("MYSQL_USER", "root"),
    "password": os.environ.get("MYSQL_PASSWORD", ""),
    "charset": "utf8mb4",
}

DB_NAME = os.environ.get("MYSQL_DATABASE", "kids_game")
