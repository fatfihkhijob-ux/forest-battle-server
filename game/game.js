/* global io */

const el = (id) => document.getElementById(id);

const btnJoin = el("btnJoin");
const btnLeave = el("btnLeave");
const btnReady = el("btnReady");
const btnCorrect = el("btnCorrect");
const btnCombo = el("btnCombo");

const connPill = el("connPill");
const roomPill = el("roomPill");
const statePill = el("statePill");
const tipBox = el("tipBox");

const selfBar = el("selfBar");
const oppBar = el("oppBar");
const selfText = el("selfText");
const oppText = el("oppText");
const countdownEl = el("countdown");

const selfCard = el("selfCard");
const connDot = el("connDot");
const wakeOverlay = el("wakeOverlay");

let wakeTimer = null;

// ===== Socket 连接地址与配置 =====
// 浏览器里：根据当前访问的域名自动选择
// - 本地开发：localhost / 127.0.0.1 -> 连接 http://localhost:3000
// - 线上环境：直接用当前页面的 https 域名（wss 自动开启）
let SOCKET_URL = undefined;
try {
  const host = window.location.hostname;
  if (host === "localhost" || host === "127.0.0.1") {
    SOCKET_URL = "http://localhost:3000";
  } else {
    // 部署到 Render / Railway 后，这里就是你的公网域名
    // 例如：https://your-app.onrender.com
    SOCKET_URL = undefined; // undefined 表示使用当前页面同源
  }
} catch {
  // 万一在非浏览器环境（如小程序自定义适配）下执行，保持 undefined
  SOCKET_URL = undefined;
}

// 统一的 Socket.IO 客户端配置
const SOCKET_OPTIONS = {
  transports: ["websocket", "polling"],
  reconnection: true,
  reconnectionAttempts: 5,
  reconnectionDelay: 1000,
};

let socket = null;
let roomId = null;
let matched = false;
let ready = false;
let started = false;

// “轻松模式”进度：仅用于演示/同步，可替换为你真实游戏进度
let myProgress = 0;
let oppProgress = 0;

// 用于避免“压力感”：不展示差值，只在差值过大时给落后方加油特效
const CHEER_THRESHOLD_ABS = 5; // 差距 >= 5 触发加油光晕
const CHEER_THRESHOLD_RATIO = 0.25; // 或者差距占比 >= 25%

function setTip(text) {
  if (!text) {
    tipBox.style.display = "none";
    tipBox.textContent = "";
    return;
  }
  tipBox.style.display = "block";
  tipBox.textContent = text;
}

function setState(text) {
  statePill.textContent = `状态：${text}`;
}

function setRoom(text) {
  roomPill.textContent = `房间：${text}`;
}

function pctFromProgress(p) {
  // 演示：把 0~20 映射为 0~100%
  const max = 20;
  const v = Math.max(0, Math.min(max, p));
  return Math.round((v / max) * 100);
}

function renderBars() {
  const sp = pctFromProgress(myProgress);
  const op = pctFromProgress(oppProgress);
  selfBar.style.width = `${sp}%`;
  oppBar.style.width = `${op}%`;
  selfText.textContent = `${myProgress}`;
  oppText.textContent = `${oppProgress}`;
}

function updateCheerEffect() {
  // 只给“落后很多”的孩子加正向提示，不显示“你落后了”
  const diff = oppProgress - myProgress;
  const base = Math.max(1, Math.max(myProgress, oppProgress));
  const ratio = Math.abs(diff) / base;

  const shouldCheer = diff >= CHEER_THRESHOLD_ABS || (diff > 0 && ratio >= CHEER_THRESHOLD_RATIO);
  if (shouldCheer) selfCard.classList.add("cheer");
  else selfCard.classList.remove("cheer");
}

function setControls() {
  btnJoin.disabled = matched || !socket || socket.disconnected;
  btnLeave.disabled = !matched && !btnLeave.dataset.queued;
  btnReady.disabled = !matched || ready;

  // 游戏未开始前，禁止“答对/Combo”模拟按钮
  btnCorrect.disabled = !started;
  btnCombo.disabled = !started;
}

function setConnDot(state) {
  // state: "ok" | "warn" | "bad"
  if (!connDot) return;
  connDot.classList.remove("conn-ok", "conn-warn", "conn-bad");
  if (state === "ok") connDot.classList.add("conn-ok");
  else if (state === "warn") connDot.classList.add("conn-warn");
  else connDot.classList.add("conn-bad");
}

function showWakeOverlay(show) {
  if (!wakeOverlay) return;
  if (show) {
    wakeOverlay.classList.add("visible");
  } else {
    wakeOverlay.classList.remove("visible");
  }
}

function playConnectSound() {
  // 轻量级 Web Audio “叮”一声，不依赖音频文件
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "triangle";
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.0, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0.15, ctx.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.18);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.2);
  } catch {
    // 静默失败即可（部分小程序环境不支持）
  }
}

function emitAction(type, payload = {}) {
  if (!socket || !roomId) return;
  socket.emit("player_action", {
    type,
    payload,
    progress: myProgress,
  });
}

function startCountdownTo(startAt) {
  started = false;
  setControls();

  const tick = () => {
    const msLeft = startAt - Date.now();
    if (msLeft <= 0) {
      countdownEl.textContent = "开始！";
      started = true;
      setState("游戏进行中");
      setTip("太棒了！一起玩吧～");
      setControls();
      return;
    }

    const sec = Math.ceil(msLeft / 1000);
    countdownEl.textContent = `${sec}`;
    requestAnimationFrame(tick);
  };
  tick();
}

function connect() {
  try {
    // SOCKET_URL 为 undefined 时，使用当前网页同源（适合部署到 Render / Railway / 微信 H5）
    socket = typeof SOCKET_URL === "string" ? io(SOCKET_URL, SOCKET_OPTIONS) : io(SOCKET_OPTIONS);
  } catch (e) {
    // 非浏览器环境（如小程序原生）可能没有 window / document，这里防止游戏挂起
    setTip("当前环境暂不支持直接联网，将以单机模式运行。");
    setConnDot("bad");
    return;
  }

  connPill.textContent = "连接中…";
  setState("连接中");
  setConnDot("warn");
  setControls();

  // Render 免费版“唤醒”检测：5 秒内连不上就给个暖心提示
  if (wakeTimer) clearTimeout(wakeTimer);
  wakeTimer = setTimeout(() => {
    if (!socket || !socket.connected) {
      showWakeOverlay(true);
      setConnDot("warn");
    }
  }, 5000);

  socket.on("connect", () => {
    connPill.textContent = "已连接";
    setState("空闲");
    setTip("");
    setConnDot("ok");
    showWakeOverlay(false);
    playConnectSound();
    setControls();
  });

  socket.on("connect_error", () => {
    // 连接出错时，维持“正在寻找森林”的氛围
    setConnDot("warn");
  });

  socket.on("disconnect", () => {
    connPill.textContent = "已断开（正在尝试重连…）";
    setState("断开连接");
    // 小皮断线文案
    setTip("哎呀，信号飘走啦，正在努力找回来！");
    setConnDot("warn");
    matched = false;
    ready = false;
    started = false;
    roomId = null;
    btnLeave.dataset.queued = "";
    setRoom("未加入");
    countdownEl.textContent = "—";
    setControls();
  });

  socket.on("matchmaking", (msg) => {
    if (msg?.status === "queued") {
      btnLeave.dataset.queued = "1";
      setState("匹配中…");
      setTip("正在寻找一个一起玩的伙伴～");
      setControls();
    }
    if (msg?.status === "left") {
      btnLeave.dataset.queued = "";
      setState("空闲");
      setTip("");
      setControls();
    }
  });

  socket.on("matched", (msg) => {
    matched = true;
    ready = false;
    started = false;
    roomId = msg?.roomId || null;
    btnLeave.dataset.queued = "";
    setRoom(roomId ? roomId.slice(0, 8) : "未知");
    setState("已匹配，等待准备");
    setTip("找到伙伴啦！点“我准备好了”，两个人都准备好就一起开始～");
    countdownEl.textContent = "—";
    setControls();
  });

  socket.on("ready_state", (msg) => {
    if (msg?.you) {
      ready = true;
      setState("已准备，等待伙伴");
      setTip("你准备好啦！等伙伴也准备好就会倒计时开始～");
      setControls();
      return;
    }
    if (msg?.opponentReady) {
      setTip("伙伴也准备好了～马上开始倒计时！");
    }
  });

  socket.on("server_tip", (msg) => {
    if (msg?.text) setTip(msg.text);
  });

  socket.on("game_start", (msg) => {
    // 统一开始：按 startAt 精准对齐
    const startAt = msg?.startAt || Date.now() + 3500;
    setState("倒计时");
    setTip("3-2-1，一起开始！");
    startCountdownTo(startAt);
  });

  socket.on("opponent_action", (msg) => {
    const data = msg?.data || {};
    if (typeof data.progress === "number") oppProgress = data.progress;

    // 这里可以根据 data.type 做“对手头像效果/图标闪光”等
    // 我们只做温和的进度更新，不强调领先落后
    renderBars();
    updateCheerEffect();
  });

  socket.on("opponent_left", (msg) => {
    setState("伙伴离开");
    setTip(msg?.text || "伙伴暂时离开了～可以再匹配一个新伙伴继续玩！");
    matched = false;
    ready = false;
    started = false;
    roomId = null;
    setRoom("未加入");
    countdownEl.textContent = "—";
    setControls();
  });
}

btnJoin.addEventListener("click", () => {
  if (!socket) return;
  myProgress = 0;
  oppProgress = 0;
  renderBars();
  updateCheerEffect();
  socket.emit("join_matchmaking");
  setControls();
});

btnLeave.addEventListener("click", () => {
  if (!socket) return;
  socket.emit("leave_matchmaking");
  btnLeave.dataset.queued = "";
  setState("空闲");
  setTip("");
  setControls();
});

btnReady.addEventListener("click", () => {
  if (!socket || !roomId) return;
  socket.emit("player_ready");
});

btnCorrect.addEventListener("click", () => {
  myProgress += 1;
  renderBars();
  updateCheerEffect();
  emitAction("correct", { delta: 1 });
});

btnCombo.addEventListener("click", () => {
  myProgress += 1;
  renderBars();
  updateCheerEffect();
  emitAction("combo", { delta: 1 });
});

renderBars();
updateCheerEffect();
connect();

