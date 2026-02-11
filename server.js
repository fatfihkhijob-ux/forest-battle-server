const path = require("path");
const http = require("http");
const crypto = require("crypto");
const express = require("express");
const { Server } = require("socket.io");

// 生产环境会通过环境变量注入端口（如 Render/Railway）
const PORT = process.env.PORT || 3000;

const app = express();
const server = http.createServer(app);

// Socket.IO 服务器，开启 CORS，方便小程序 / Web 不同域名访问
// 注意：
// - 开发环境：保持允许所有来源，方便本地调试（origin: "*"）
// - 生产环境：建议通过环境变量 SOCKET_ALLOW_ORIGIN 限定为你的 HTTPS 域名
// - 小程序 / 原生环境：有时 Origin 为空（null），这里也放行
const ALLOWED_ORIGIN = process.env.SOCKET_ALLOW_ORIGIN || null;
const io = new Server(server, {
  cors: {
    origin: (origin, callback) => {
      // 1. 本地 / 未配置限制：全部放行
      if (!ALLOWED_ORIGIN) {
        return callback(null, true);
      }

      // 2. 小程序 / 原生环境：Origin 可能是 undefined / null，允许
      if (!origin) {
        return callback(null, true);
      }

      // 3. 与配置的 HTTPS 域名完全匹配才允许
      if (origin === ALLOWED_ORIGIN) {
        return callback(null, true);
      }

      return callback(new Error("Not allowed by CORS"), false);
    },
    methods: ["GET", "POST"],
  },
});

// 托管 game/ 作为静态资源根目录（路径使用 path.join，跨平台安全）
const GAME_DIR = path.join(__dirname, "game");

// 先注册路由，否则 express.static 会把 / 当成目录并默认返回 index.html（联网对战测试页）
// 首页：完整游戏，从登录/注册开始
app.get("/", (_req, res) => {
  res.sendFile(path.join(GAME_DIR, "forest.html"));
});

// 联机测试页：保留原来的轻松对战页面，方便调试
app.get("/battle", (_req, res) => {
  res.sendFile(path.join(GAME_DIR, "index.html"));
});

app.use(express.static(GAME_DIR));

// ========== 匹配与房间管理 ==========
/** @type {string[]} */
const waitingPlayers = [];

/**
 * roomId -> { players: [socketIdA, socketIdB], ready: Set<string> }
 * @type {Map<string, {players: [string,string], ready: Set<string>}>}
 */
const rooms = new Map();

function removeFromWaiting(socketId) {
  const idx = waitingPlayers.indexOf(socketId);
  if (idx !== -1) waitingPlayers.splice(idx, 1);
}

function getRoomOfSocket(socket) {
  return socket?.data?.roomId || null;
}

function cleanupRoom(roomId, reason = "room_closed") {
  const room = rooms.get(roomId);
  if (!room) return;

  const [a, b] = room.players;
  const sa = io.sockets.sockets.get(a);
  const sb = io.sockets.sockets.get(b);

  // 让双方都离开房间并清掉 roomId
  for (const s of [sa, sb]) {
    if (!s) continue;
    try {
      s.leave(roomId);
    } catch {}
    if (s.data) s.data.roomId = null;
  }

  rooms.delete(roomId);

  // 可选：向房间广播关闭原因（通常在对手断线时由上层更明确地通知）
  io.to(roomId).emit(reason);
}

function tryMatchmake() {
  while (waitingPlayers.length >= 2) {
    const aId = waitingPlayers.shift();
    const bId = waitingPlayers.shift();

    const a = io.sockets.sockets.get(aId);
    const b = io.sockets.sockets.get(bId);

    // 若有人已断线，跳过并把另一位放回队列
    if (!a && b) {
      waitingPlayers.unshift(bId);
      continue;
    }
    if (!b && a) {
      waitingPlayers.unshift(aId);
      continue;
    }
    if (!a || !b) continue;

    // 若有人已经在房间里（异常情况），跳过
    if (getRoomOfSocket(a) || getRoomOfSocket(b)) continue;

    const roomId = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
    rooms.set(roomId, { players: [aId, bId], ready: new Set() });

    a.data.roomId = roomId;
    b.data.roomId = roomId;

    a.join(roomId);
    b.join(roomId);

    a.emit("matched", { roomId, side: "A" });
    b.emit("matched", { roomId, side: "B" });

    // 温和提示：不强调输赢
    io.to(roomId).emit("server_tip", {
      text: "两位小朋友都准备好后，会一起倒计时开始哦～",
    });
  }
}

io.on("connection", (socket) => {
  socket.data.roomId = null;

  socket.emit("connected", { id: socket.id });

  socket.on("join_matchmaking", () => {
    // 已在房间/队列则忽略
    if (getRoomOfSocket(socket)) return;
    if (waitingPlayers.includes(socket.id)) return;

    waitingPlayers.push(socket.id);
    socket.emit("matchmaking", { status: "queued", position: waitingPlayers.length });
    tryMatchmake();
  });

  socket.on("leave_matchmaking", () => {
    removeFromWaiting(socket.id);
    socket.emit("matchmaking", { status: "left" });
  });

  socket.on("player_ready", () => {
    const roomId = getRoomOfSocket(socket);
    if (!roomId) return;
    const room = rooms.get(roomId);
    if (!room) return;

    room.ready.add(socket.id);
    socket.emit("ready_state", { you: true, readyCount: room.ready.size, total: 2 });
    socket.to(roomId).emit("ready_state", { opponentReady: true, readyCount: room.ready.size, total: 2 });

    if (room.ready.size >= 2) {
      // 统一同步开始：给一个未来时间戳，客户端按 startAt 精准对齐
      const startAt = Date.now() + 3500;
      io.to(roomId).emit("game_start", { countdownSeconds: 3, startAt });
    }
  });

  socket.on("player_action", (data) => {
    const roomId = getRoomOfSocket(socket);
    if (!roomId) return;
    const room = rooms.get(roomId);
    if (!room) return;

    // 转发给同房间的对手（不回传给自己）
    socket.to(roomId).emit("opponent_action", {
      from: socket.id,
      data,
      serverTime: Date.now(),
    });
  });

  socket.on("disconnect", (reason) => {
    // 从匹配池移除
    removeFromWaiting(socket.id);

    const roomId = getRoomOfSocket(socket);
    if (!roomId) return;

    const room = rooms.get(roomId);
    if (!room) return;

    // 通知另一名玩家
    socket.to(roomId).emit("opponent_left", {
      reason,
      text: "你的伙伴暂时离开了～我们可以再匹配一个新伙伴继续玩！",
    });

    cleanupRoom(roomId, "room_closed");
  });
});

server.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Server running on port ${PORT}`);
});

