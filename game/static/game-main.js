(() => {
  const $ = (sel, root = document) => root.querySelector(sel);
  /** 后端 API 根地址（Render 部署的 Flask 服务） */
    const BACKEND_BASE = "https://forest-backend-ccl7.onrender.com";

  const app = $("#app");
  const tplAuthLanding = $("#tpl-auth-landing");
  const tplLogin = $("#tpl-login");
  const tplRegister = $("#tpl-register");
  const tplHome = $("#tpl-home");
  const tplDemo = $("#tpl-demo");
  const tplGame = $("#tpl-game");
  const tplEnd = $("#tpl-end");
  const tplVersusMenu = $("#tpl-versus-menu");
  const tplVersusCreate = $("#tpl-versus-create");
  const tplVersusJoin = $("#tpl-versus-join");
  const tplVersusResult = $("#tpl-versus-result");
  const tplMood = $("#tpl-mood");
  const tplCollection = $("#tpl-collection");
  const tplWinCelebration = $("#tpl-win-celebration");
  const tplSeqLevels = $("#tpl-seq-levels");

  /** 全局动物头像：禁止纯色圆/数字/几何，统一用动物 Emoji */
  const SEQ_ANIMALS = ["🐱", "🐶", "🐰", "🦊", "🐻", "🐼", "🦁", "🐯"];
  const SEQ_ANIMAL_LABELS = ["小猫", "小狗", "兔子", "狐狸", "小熊", "熊猫", "狮子", "老虎"];
  /** 顺序记忆联机用 Emoji：与后端 sequence 索引对应 */
  const SEQUENCE_EMOJIS = ["🐱", "🐶", "🐰"];

  const COLORS = {
    primary: "#7FAF9A",
    secondary: "#A9C5B4",
    neutral: "#C8D6CF",
    completed: "#9BC6B0",
    disabled: "#E3E6E2",
  };

  const state = {
    mode: "home",
    game: null,
    user: null,
    userId: null,
    versus: { socket: null, room_code: null, room_id: null },
    /** REST 联机：房间码、己方角色、序列、轮询定时器 */
    matchApi: { room_id: null, my_role: null, emoji_sequence: null, pollTimerId: null },
    gameStartTime: null,
    /** 顺序记忆动态难度：当前序列长度 2–4，连续失败次数 */
    seqLevel: 3,
    seqFailCount: 0,
    voiceGreeted: false,
    isRaining: false,
    rainTapCount: 0,
    rainTapLastTime: 0,
    idleTimerId: null,
    /** 小皮心情：'happy' | 'confused' | 'encouraging'，用于挠头/鼓励等 */
    currentMood: "happy",
    /** 当前关卡连续点错次数，满 3 次触发困惑 */
    levelWrongCount: 0,
    /** 当前关卡是否已答对过（用于 30 秒无进展判定） */
    levelCorrectInRound: false,
    /** 关卡开始时间，用于 30 秒停滞触发困惑 */
    levelStartTime: null,
    /** 30 秒无进展定时器 ID */
    levelStuckTimerId: null,
    /** 上次失败时间，长时间未通关后重新开始时显示鼓励 */
    lastLevelFailTime: null,
  };
  /** 最高连击：从 localStorage 读取 forest_max_combo，首次为 0 */
  state.maxCombo = Math.max(0, parseInt(localStorage.getItem("forest_max_combo"), 10) || 0);
  /** 全球最高排名百分比：从 localStorage 读取 forest_best_rank，用于鼓励未达纪录时 */
  state.bestGlobalRank = Math.min(100, Math.max(0, parseInt(localStorage.getItem("forest_best_rank"), 10) || 0));
  /** 累计答对总数：用于勋章「森林战神」等，持久化到 forest_total_correct */
  state.totalCorrect = Math.max(0, parseInt(localStorage.getItem("forest_total_correct"), 10) || 0);
  /** 最近几次答对的时间戳（用于「闪电快手」3 秒内 3 次） */
  state.lastCorrectTimes = [];
  /** 全森林灯笼颜色（冠军选定）：key、冠军昵称、颜色中文名，由 /api/me 与 set_lantern_color 更新 */
  state.lanternColor = "warm_yellow";
  state.lanternChampionUsername = null;
  state.lanternColorName = "暖阳黄";

  /** 灯笼颜色选项（与后端 LANTERN_COLORS 一致） */
  var LANTERN_COLOR_OPTIONS = [
    { key: "warm_yellow", name: "暖阳黄", emoji: "🌕", rgba: "rgba(255, 180, 50, 0.88)", glow: "rgba(255, 170, 0, 0.5)" },
    { key: "sakura_pink", name: "樱花粉", emoji: "🌸", rgba: "rgba(255, 182, 193, 0.9)", glow: "rgba(255, 105, 180, 0.5)" },
    { key: "aurora_green", name: "极光绿", emoji: "🌌", rgba: "rgba(144, 238, 144, 0.9)", glow: "rgba(50, 205, 50, 0.5)" },
    { key: "dream_blue", name: "梦幻蓝", emoji: "🌊", rgba: "rgba(135, 206, 250, 0.9)", glow: "rgba(30, 144, 255, 0.5)" },
    { key: "lavender_purple", name: "薰衣草紫", emoji: "🍇", rgba: "rgba(218, 112, 214, 0.85)", glow: "rgba(186, 85, 211, 0.5)" },
  ];

  /** 应用全森林灯笼颜色（CSS 变量），并更新 state 中的冠军信息 */
  function applyLanternColor(key, championUsername, colorName) {
    var opt = LANTERN_COLOR_OPTIONS.find(function (o) { return o.key === key; });
    if (!opt) opt = LANTERN_COLOR_OPTIONS[0];
    state.lanternColor = opt.key;
    if (championUsername != null) state.lanternChampionUsername = championUsername;
    state.lanternColorName = colorName != null ? colorName : opt.name;
    document.documentElement.style.setProperty("--lantern-color", opt.rgba);
    document.documentElement.style.setProperty("--lantern-glow", opt.glow);
  }

  /** 冠军选灯笼颜色：华丽短音 */
  function playChampionColorSound() {
    try {
      var C = getAudioContext();
      if (!C) return;
      var g = C.createGain();
      g.connect(C.destination);
      g.gain.setValueAtTime(0.2, C.currentTime);
      g.gain.exponentialRampToValueAtTime(0.01, C.currentTime + 0.6);
      [523.25, 659.25, 783.99, 1046.5].forEach(function (freq, i) {
        var o = C.createOscillator();
        o.connect(g);
        o.frequency.value = freq;
        o.type = "sine";
        var t = C.currentTime + i * 0.08;
        o.start(t);
        o.stop(t + 0.35);
      });
    } catch (_) {}
  }

  var BGM_VOLUME = 0.2;

  /** 在用户交互时解锁音频（避免控制台 Autoplay 报错）：创建并 resume AudioContext，仅从 click/touch 中调用 */
  function unlockAudio() {
    if (state._audioUnlocked) return;
    try {
      if (typeof (window.AudioContext || window.webkitAudioContext) !== "undefined") {
        state.audioContext = state.audioContext || new (window.AudioContext || window.webkitAudioContext)();
        if (state.audioContext.state === "suspended") state.audioContext.resume().then(function () { state._audioUnlocked = true; }).catch(function () {});
        else state._audioUnlocked = true;
      }
    } catch (_) {}
  }

  /** 背景音乐：volume=0.2，仅在用户点击/触摸后播放；夜晚自动降 30%；进度存 localStorage；狂热模式用独立 EDM 轨 */
  function initBGM() {
    var bgm = document.getElementById("bgm");
    if (!bgm) return;
    bgm.volume = (typeof getTimeState !== "undefined" && getTimeState() === "night") ? BGM_VOLUME * 0.7 : BGM_VOLUME;
    var bgmFever = document.getElementById("bgm-fever");
    if (bgmFever) { bgmFever.volume = BGM_VOLUME; bgmFever.preload = "auto"; }
    var stored = localStorage.getItem("bgm_muted");
    var muted = stored === "0" ? false : true;
    bgm.muted = muted;
    var savedTime = parseFloat(localStorage.getItem("bgm_time"));
    if (!isNaN(savedTime) && savedTime > 0) bgm.currentTime = savedTime;
    bgm.addEventListener("timeupdate", function () {
      if (!bgm.paused && !bgm.muted) try { localStorage.setItem("bgm_time", String(bgm.currentTime)); } catch (_) {}
    });
    function tryResumeOnClick() {
      if (!state._bgmPausedByBrowser || bgm.muted) return;
      state._bgmPausedByBrowser = false;
      unlockAudio();
      var t = parseFloat(localStorage.getItem("bgm_time"));
      if (!isNaN(t)) bgm.currentTime = t;
      bgm.play().catch(function () {});
      document.removeEventListener("click", tryResumeOnClick);
      document.removeEventListener("touchstart", tryResumeOnClick);
    }
    bgm.addEventListener("pause", function () {
      if (!bgm.muted) {
        state._bgmPausedByBrowser = true;
        try { localStorage.setItem("bgm_time", String(bgm.currentTime)); } catch (_) {}
        document.addEventListener("click", tryResumeOnClick);
        document.addEventListener("touchstart", tryResumeOnClick);
      }
    });
    function firstClickActivate() {
      document.removeEventListener("click", firstClickActivate);
      document.removeEventListener("touchstart", firstClickActivate);
      unlockAudio();
      bgm.muted = false;
      try { localStorage.setItem("bgm_muted", "0"); } catch (_) {}
      var t = parseFloat(localStorage.getItem("bgm_time"));
      if (!isNaN(t) && t > 0) bgm.currentTime = t;
      bgm.play().catch(function () {});
      var btn = document.getElementById("btnBgm");
      if (btn) { btn.classList.remove("btn-bgm--muted"); btn.classList.add("btn-bgm--on"); btn.setAttribute("aria-label", "关闭背景音乐"); }
      updateBgmStartOverlay();
    }
    document.addEventListener("click", firstClickActivate);
    document.addEventListener("touchstart", firstClickActivate);
  }

  function bindBgmButton() {
    var bgm = document.getElementById("bgm");
    var btn = document.getElementById("btnBgm");
    if (!bgm || !btn) return;
    btn.classList.toggle("btn-bgm--muted", bgm.muted);
    btn.classList.toggle("btn-bgm--on", !bgm.muted);
    btn.setAttribute("aria-label", bgm.muted ? "开启背景音乐" : "关闭背景音乐");
    btn.removeEventListener("click", state._bgmClick);
    state._bgmClick = function () {
      bgm.muted = !bgm.muted;
      try { localStorage.setItem("bgm_muted", bgm.muted ? "1" : "0"); } catch (_) {}
      btn.classList.toggle("btn-bgm--muted", bgm.muted);
      btn.classList.toggle("btn-bgm--on", !bgm.muted);
      btn.setAttribute("aria-label", bgm.muted ? "开启背景音乐" : "关闭背景音乐");
      if (!bgm.muted) {
        unlockAudio();
        var t = parseFloat(localStorage.getItem("bgm_time"));
        if (!isNaN(t)) bgm.currentTime = t;
        bgm.play().catch(function () {});
      }
      updateBgmStartOverlay();
    };
    btn.addEventListener("click", state._bgmClick);
  }

  /** 首页「点击开始探索」遮罩：仅 BGM 静音时显示，点击后激活 BGM 并隐藏 */
  function updateBgmStartOverlay() {
    var overlay = document.getElementById("bgmStartOverlay");
    var bgm = document.getElementById("bgm");
    if (!overlay || !bgm) return;
    if (bgm.muted) {
      overlay.classList.remove("bgm-start-overlay--hidden");
      overlay.setAttribute("aria-hidden", "false");
    } else {
      overlay.classList.add("bgm-start-overlay--hidden");
      overlay.setAttribute("aria-hidden", "true");
    }
  }

  function bindBgmStartOverlay() {
    var overlay = document.getElementById("bgmStartOverlay");
    var bgm = document.getElementById("bgm");
    if (!overlay || !bgm) return;
    updateBgmStartOverlay();
    overlay.removeEventListener("click", state._bgmOverlayClick);
    state._bgmOverlayClick = function () {
      unlockAudio();
      bgm.muted = false;
      try { localStorage.setItem("bgm_muted", "0"); } catch (_) {}
      var t = parseFloat(localStorage.getItem("bgm_time"));
      if (!isNaN(t) && t > 0) bgm.currentTime = t;
      bgm.play().catch(function () {});
      overlay.classList.add("bgm-start-overlay--hidden");
      overlay.setAttribute("aria-hidden", "true");
      var btn = document.getElementById("btnBgm");
      if (btn) { btn.classList.remove("btn-bgm--muted"); btn.classList.add("btn-bgm--on"); btn.setAttribute("aria-label", "关闭背景音乐"); }
    };
    overlay.addEventListener("click", state._bgmOverlayClick);
  }

  /** 音效直连：答对 4381 木琴/水滴感，通关 4382 庆典风铃；统一柔和音量 0.5，防刺耳 */
  var sfx = {
    correct: new Audio("https://www.fesliyanstudios.com/play-mp3/4381"),
    wrong: new Audio("https://www.fesliyanstudios.com/play-mp3/2908"),
    win: new Audio("https://www.fesliyanstudios.com/play-mp3/4382"),
    start: new Audio("https://assets.mixkit.co/active_storage/sfx/2013/2013-preview.mp3"),
    click: new Audio("https://www.fesliyanstudios.com/play-mp3/4377"),
    tick: new Audio("https://s3.amazonaws.com/freecodecamp/simonSound1.mp3"),
    purr: new Audio("https://www.fesliyanstudios.com/play-mp3/6510"),
    greet: new Audio("https://www.fesliyanstudios.com/play-mp3/6511")
  };
  Object.keys(sfx).forEach(function (k) { sfx[k].preload = "auto"; });

  /** 统一安全播放：音量上限 0.5、先 currentTime=0 防重叠，可选淡入 */
  function playSafeAudio(audio, opts) {
    opts = opts || {};
    if (!audio) return;
    audio.currentTime = 0;
    var targetVol = opts.volume != null ? Math.min(opts.volume, 0.5) : 0.5;
    if (opts.fadeInMs) {
      audio.volume = 0;
      audio.play().catch(function (e) { console.error("[播放失败]", e); });
      var start = Date.now();
      var tick = function () {
        var elapsed = Date.now() - start;
        var p = Math.min(elapsed / opts.fadeInMs, 1);
        audio.volume = targetVol * p;
        if (p < 1) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    } else {
      audio.volume = targetVol;
      audio.play().catch(function (e) { console.error("[播放失败]", e); });
    }
  }

  /** 首次点击/触摸时：全局静音预加载——激活所有音效与 BGM 轨道，确保后续 100% 可播 */
  function unlockAllAudio() {
    if (window._sfxUnlocked) return;
    window._sfxUnlocked = true;
    document.removeEventListener("click", unlockAllAudio);
    document.removeEventListener("touchstart", unlockAllAudio);
    unlockAudio();
    Object.values(sfx).forEach(function (audio) {
      audio.play().then(function () {
        audio.pause();
        audio.currentTime = 0;
      }).catch(function (e) { console.error("[音频激活失败] sfx", e); });
    });
  }
  document.addEventListener("click", unlockAllAudio);
  document.addEventListener("touchstart", unlockAllAudio);

  /** 小皮向导：音效类型对应的气泡文案（语气柔和、带波浪号） */
  var GUIDE_BUBBLE_TEXT = {
    correct: "点对啦！",
    wrong: "再试一次",
    win: "小皮相信你！",
    start: "一起来玩吧！",
    happy: "真棒呀~",
    shy: "哎呀，差点点…"
  };
  /** 夜晚时段小皮晚安/困意台词 */
  var NIGHT_BUBBLE_TEXTS = ["呼...好困呀，我们要快点玩哦", "晚安呀～", "星星都出来了呢"];
  /** 困惑模式时随机气泡文案（挠头联动） */
  var CONFUSED_BUBBLE_TEXTS = [
    "咦？这只小动物藏得有点深呀...",
    "要不要小皮给你一点点提示呢？",
    "没关系，小皮也有点看花眼了，我们再仔细找找！"
  ];
  /** 森林广播站：温馨提示文案，每 3–5 分钟随机一条 */
  var broadcastTips = [
    "小松鼠提醒你：该喝口水休息一下啦！",
    "小鹿说：眨眨眼睛，保护好视力哦。",
    "森林气象站：今晚的灯笼格外明亮呢。",
    "小皮说：玩一会儿记得看看窗外，放松眼睛～",
    "森林广播：记得坐直一点，身体会更舒服哦。"
  ];
  var _guideStopTimer = null;
  var _xiaopiEmotionTimer = null;

  /** 清除 30 秒停滞定时器 */
  function clearMoodStuckTimer() {
    if (state.levelStuckTimerId) {
      clearTimeout(state.levelStuckTimerId);
      state.levelStuckTimerId = null;
    }
  }

  /** 困惑时播放轻微「唔？」音效（4377 click 降调） */
  function playConfusedSound() {
    var a = sfx.click;
    if (a) { a.currentTime = 0; a.volume = 0.2; a.playbackRate = 0.85; a.play().catch(function () {}); }
  }

  /** 小皮心情切换：'happy' | 'confused' | 'encouraging'，与挠头/问号/鼓励气泡同步 */
  function setXiaopiMood(mood) {
    state.currentMood = mood;
    var el = document.getElementById("guide-character");
    var bubble = document.getElementById("guide-bubble");
    var mark = document.getElementById("guide-confused-mark");
    if (!el || !bubble) return;
    el.classList.remove("mood-confused", "mood-encouraging");
    if (mark) {
      mark.setAttribute("aria-hidden", "true");
      mark.classList.remove("is-visible");
    }
    if (mood === "confused") {
      el.classList.add("mood-confused");
      bubble.textContent = CONFUSED_BUBBLE_TEXTS[Math.floor(Math.random() * CONFUSED_BUBBLE_TEXTS.length)];
      bubble.classList.add("is-visible");
      if (mark) { mark.setAttribute("aria-hidden", "false"); mark.classList.add("is-visible"); }
      playConfusedSound();
    } else if (mood === "encouraging") {
      el.classList.add("mood-encouraging");
      el.classList.add("xiaopi-greet");
      bubble.textContent = "没关系，我们再试一次吧！";
      bubble.classList.add("is-visible");
      setTimeout(function () { if (el) el.classList.remove("xiaopi-greet"); }, 1600);
      setTimeout(function () {
        if (bubble && el && !el.classList.contains("mood-confused")) bubble.classList.remove("is-visible");
      }, 3500);
    } else {
      if (bubble && !el.classList.contains("xiaopi-happy") && !el.classList.contains("xiaopi-shy")) bubble.classList.remove("is-visible");
    }
  }

  /** 小皮情绪切换：'happy' | 'shy' | 'idle'，与气泡、动画同步 */
  function setXiaopiEmotion(emotion) {
    var el = document.getElementById("guide-character");
    var bubble = document.getElementById("guide-bubble");
    if (!el || !bubble) return;
    if (_xiaopiEmotionTimer) clearTimeout(_xiaopiEmotionTimer);
    _xiaopiEmotionTimer = null;
    el.classList.remove("xiaopi-happy", "xiaopi-shy", "xiaopi-idle", "is-talking");
    if (emotion === "happy") {
      setXiaopiMood("happy");
      el.classList.add("xiaopi-happy");
      bubble.textContent = GUIDE_BUBBLE_TEXT.happy || "真棒呀~";
      bubble.classList.add("is-visible");
      _xiaopiEmotionTimer = setTimeout(function () { setXiaopiEmotion("idle"); }, 3000);
    } else if (emotion === "shy") {
      el.classList.add("xiaopi-shy");
      bubble.textContent = GUIDE_BUBBLE_TEXT.shy || "哎呀，差点点…";
      bubble.classList.add("is-visible");
      _xiaopiEmotionTimer = setTimeout(function () { setXiaopiEmotion("idle"); }, 3000);
    } else {
      el.classList.add("xiaopi-idle");
      setTimeout(function () { if (bubble && !el.classList.contains("xiaopi-happy") && !el.classList.contains("xiaopi-shy")) bubble.classList.remove("is-visible"); }, 200);
    }
  }

  function guideSay(type) {
    var el = document.getElementById("guide-character");
    var bubble = document.getElementById("guide-bubble");
    if (!el || !bubble) return;
    if (_guideStopTimer) clearTimeout(_guideStopTimer);
    var text;
    if (typeof getTimeState !== "undefined" && getTimeState() === "night" && (type === "start" || type === "win"))
      text = NIGHT_BUBBLE_TEXTS[Math.floor(Math.random() * NIGHT_BUBBLE_TEXTS.length)];
    else
      text = GUIDE_BUBBLE_TEXT[type] || "小皮在这里～";
    bubble.textContent = text;
    bubble.classList.add("is-visible");
    el.classList.remove("xiaopi-idle");
    el.classList.add("is-talking");
    function stopTalking() {
      el.classList.remove("is-talking");
      if (!el.classList.contains("xiaopi-happy") && !el.classList.contains("xiaopi-shy")) {
        el.classList.add("xiaopi-idle");
      }
      setTimeout(function () { if (bubble && !el.classList.contains("xiaopi-happy") && !el.classList.contains("xiaopi-shy")) bubble.classList.remove("is-visible"); }, 300);
      _guideStopTimer = null;
    }
    var a = sfx[type];
    if (a) a.addEventListener("ended", stopTalking, { once: true });
    _guideStopTimer = setTimeout(stopTalking, 2000);
  }

  function playSfx(type, opts) {
    opts = opts || {};
    var a = sfx[type];
    if (!a) return;
    console.log("正在播放音效:", type);
    a.currentTime = 0;
    a.playbackRate = opts.playbackRate != null ? opts.playbackRate : 1;
    if (!opts.noGuide) guideSay(type);
    if (type === "win" && opts.fadeIn !== false) {
      playSafeAudio(a, { volume: 0.5, fadeInMs: 500 });
    } else {
      playSafeAudio(a, { volume: opts.volume != null ? opts.volume : 0.5 });
    }
  }

  /** 普通点击（未触发判定时）：清脆「噗」声 */
  function playClickSound() {
    var a = sfx.click;
    if (a) { a.currentTime = 0; a.volume = 0.25; a.playbackRate = 1.2; a.play().catch(function () {}); }
  }

  /** 倒计时剩余 5 秒：微弱滴答 */
  function playTickSound() {
    var a = sfx.tick;
    if (a) { a.currentTime = 0; a.volume = 0.2; a.playbackRate = 2; a.play().catch(function () {}); }
  }

  /** 抚摸小皮：温润呼噜声（音量上限 0.5） */
  function playPurrSound() {
    var a = sfx.purr;
    if (a) { a.currentTime = 0; a.volume = 0.5; a.play().catch(function () {}); }
  }

  /** 从小皮头顶生成飘出的爱心粒子，约 1.5 秒后移除 */
  function spawnHeartParticle() {
    var avatar = document.getElementById("guide-avatar");
    if (!avatar) return;
    var rect = avatar.getBoundingClientRect();
    var x = rect.left + rect.width / 2;
    var y = rect.top;
    var el = document.createElement("div");
    var zigzag = ["", " heart-zigzag-b", " heart-zigzag-c"][Math.floor(Math.random() * 3)];
    el.className = "heart-particle" + zigzag;
    el.textContent = "❤️";
    el.style.left = x + "px";
    el.style.top = y + "px";
    el.style.transform = "translate(-50%, -50%)";
    document.body.appendChild(el);
    setTimeout(function () { if (el.parentNode) el.remove(); }, 1500);
  }
  function playEffect(type) {
    if (type === "congrats") type = "win";
    playSfx(type);
  }
  function playVictorySound() { playSfx("win"); }
  function playFailureSound() { playSfx("wrong"); }

  /** 答对时屏幕中央闪现大 Emoji +「真棒呀~」彩色文字，持续 1 秒；10 连击以上星星翻倍 + 热力全开 */
  function showCorrectFeedback() {
    var combo = state.consecutiveCorrect || 0;
    var wrap = document.createElement("div");
    wrap.className = "correct-feedback-overlay";
    wrap.setAttribute("aria-live", "polite");
    if (combo >= 10) {
      wrap.innerHTML = '<span class="correct-feedback-emoji">🌟🌟</span><span class="correct-feedback-text">热力全开！</span>';
    } else {
      wrap.innerHTML = '<span class="correct-feedback-emoji">🌟</span><span class="correct-feedback-text">真棒呀~</span>';
    }
    document.body.appendChild(wrap);
    setTimeout(function () {
      if (wrap.parentNode) wrap.remove();
    }, 1000);
  }

  /** 连击显示：3 连击以上显示「N 连击!」，颜色/抖动/闪烁随连击数变化 */
  function updateComboDisplay(n) {
    var container = document.getElementById("combo-display");
    if (!container) return;
    if (n < 3) {
      container.setAttribute("aria-hidden", "true");
      container.innerHTML = "";
      return;
    }
    container.setAttribute("aria-hidden", "false");
    var tier = n < 5 ? 1 : n < 8 ? 2 : n < 10 ? 3 : 4;
    var shake = n < 5 ? "" : n < 8 ? " combo-shake-1" : n < 10 ? " combo-shake-2" : " combo-shake-3";
    var flash = n >= 5 ? " combo-flash" : "";
    var textEl = document.createElement("span");
    textEl.className = "combo-text combo-tier-" + tier + shake + flash + " combo-hit";
    textEl.textContent = n + " 连击!";
    container.innerHTML = "";
    container.appendChild(textEl);
  }

  /** 连击中断：文字迅速缩小消失 */
  function hideComboDisplay() {
    var container = document.getElementById("combo-display");
    if (!container) return;
    var textEl = container.querySelector(".combo-text");
    if (textEl) {
      textEl.classList.add("combo-out");
      textEl.classList.remove("combo-hit");
      setTimeout(function () {
        container.innerHTML = "";
        container.setAttribute("aria-hidden", "true");
      }, 280);
    } else {
      container.innerHTML = "";
      container.setAttribute("aria-hidden", "true");
    }
  }

  /** 触觉反馈：仅支持 navigator.vibrate 的移动端；桌面端静默跳过，避免报错 */
  function triggerHaptic(type) {
    try {
      if (typeof navigator.vibrate !== "function") return;
      if (type === "success") navigator.vibrate(50);
      else if (type === "victory") navigator.vibrate([100, 50, 100]);
    } catch (_) {}
  }

  /** 点对了：欢快音效（连击音调爬升，上限 1.5）+ 小皮开心/欢呼 + 中央反馈 + 连击 UI + 热度分级 + 破纪录；恢复开心心情、清除困惑；更新累计答对与勋章条件 */
  function playCorrectSound() {
    state.levelCorrectInRound = true;
    state.levelWrongCount = 0;
    clearMoodStuckTimer();
    setXiaopiMood("happy");
    state.consecutiveCorrect = (state.consecutiveCorrect || 0) + 1;
    var combo = state.consecutiveCorrect;
    var isNewRecord = combo > (state.maxCombo || 0);
    if (isNewRecord) {
      state.maxCombo = combo;
      try { localStorage.setItem("forest_max_combo", String(combo)); } catch (_) {}
      showNewRecordFeedback();
    }
    state.totalCorrect = (state.totalCorrect || 0) + 1;
    try { localStorage.setItem(TOTAL_CORRECT_KEY, String(state.totalCorrect)); } catch (_) {}
    state.lastCorrectTimes = state.lastCorrectTimes || [];
    state.lastCorrectTimes.push(Date.now());
    if (state.lastCorrectTimes.length > 3) state.lastCorrectTimes.shift();
    checkMedalConditions();
    var rate = 1 + Math.min((combo - 1) * 0.05, 0.5);
    playSfx("correct", { noGuide: true, playbackRate: rate });
    if (combo >= 10) playPerfectSound();
    setXiaopiEmotion("happy");
    showCorrectFeedback();
    updateComboDisplay(combo);
    applyFeverLevel(combo);
    triggerHaptic("success");
  }

  /** 点错了：柔和「咚」+ 小皮害羞 + 连击归零；记录失败时间；同一关卡连续错 3 次进入困惑模式 */
  function playWrongSound() {
    state.lastLevelFailTime = Date.now();
    state.levelWrongCount = (state.levelWrongCount || 0) + 1;
    if (state.levelWrongCount >= 3) setXiaopiMood("confused");
    var lastCombo = state.consecutiveCorrect || 0;
    var hadCombo = lastCombo >= 3;
    state.consecutiveCorrect = 0;
    if (hadCombo) {
      hideComboDisplay();
      playComboBreakSound();
      clearFever();
      setTimeout(function () { showGlobalRankSpeech(lastCombo, "break"); }, 600);
    }
    playSfx("wrong", { noGuide: true });
    setXiaopiEmotion("shy");
  }

  /** 10 连击达成：华丽 Perfect 短音 */
  function playPerfectSound() {
    try {
      var C = getAudioContext();
      if (!C) return;
      var g = C.createGain();
      g.connect(C.destination);
      g.gain.setValueAtTime(0.2, C.currentTime);
      g.gain.exponentialRampToValueAtTime(0.01, C.currentTime + 0.4);
      [523.25, 659.25, 783.99].forEach(function (freq, i) {
        var o = C.createOscillator();
        o.connect(g);
        o.frequency.value = freq;
        o.type = "sine";
        var t = C.currentTime + i * 0.06;
        o.start(t);
        o.stop(t + 0.25);
      });
    } catch (_) {}
  }

  /** 连击中断：轻微「遗憾」短音 */
  function playComboBreakSound() {
    try {
      var C = getAudioContext();
      if (!C) return;
      var g = C.createGain();
      g.connect(C.destination);
      g.gain.setValueAtTime(0.08, C.currentTime);
      g.gain.exponentialRampToValueAtTime(0.01, C.currentTime + 0.12);
      var o = C.createOscillator();
      o.connect(g);
      o.frequency.setValueAtTime(320, C.currentTime);
      o.frequency.linearRampToValueAtTime(220, C.currentTime + 0.1);
      o.type = "sine";
      o.start(C.currentTime);
      o.stop(C.currentTime + 0.12);
    } catch (_) {}
  }

  /** 狂热模式结束：「切断」短音 */
  function playCutSound() {
    try {
      var C = getAudioContext();
      if (!C) return;
      var g = C.createGain();
      g.connect(C.destination);
      g.gain.setValueAtTime(0.12, C.currentTime);
      g.gain.exponentialRampToValueAtTime(0.01, C.currentTime + 0.15);
      var o = C.createOscillator();
      o.connect(g);
      o.frequency.setValueAtTime(400, C.currentTime);
      o.frequency.linearRampToValueAtTime(80, C.currentTime + 0.12);
      o.type = "sawtooth";
      o.start(C.currentTime);
      o.stop(C.currentTime + 0.15);
    } catch (_) {}
  }

  /** 连击热度分级：0-4 普通，5-9 热力初现（背景呼吸光 + 小皮欢呼），10+ 巅峰狂热（墨镜 + 霓虹边框 + 狂热 BGM） */
  function applyFeverLevel(combo) {
    var body = document.body;
    var guide = document.getElementById("guide-character");
    var bubble = document.getElementById("guide-bubble");
    var bgm = document.getElementById("bgm");
    var bgmFever = document.getElementById("bgm-fever");
    if (combo >= 10) {
      state.feverLevel = 2;
      body.classList.add("fever-lvl-1", "fever-lvl-2");
      if (guide) guide.classList.add("xiaopi-cool");
      if (bubble) {
        bubble.textContent = "我是森林最靓的崽！😎";
        bubble.classList.add("is-visible");
      }
      if (bgm && bgmFever) {
        bgm.pause();
        if (!bgm.muted) {
          bgmFever.volume = typeof BGM_VOLUME !== "undefined" ? BGM_VOLUME : 0.2;
          bgmFever.currentTime = 0;
          bgmFever.play().catch(function () {});
        }
      }
    } else if (combo >= 5) {
      state.feverLevel = 1;
      body.classList.add("fever-lvl-1");
      body.classList.remove("fever-lvl-2");
      if (guide) guide.classList.remove("xiaopi-cool");
      if (bubble) {
        bubble.textContent = "好烫！手感热起来了！";
        bubble.classList.add("is-visible");
      }
      if (bgm && bgmFever) {
        bgmFever.pause();
        if (!bgm.muted) bgm.play().catch(function () {});
      }
    } else {
      clearFever();
    }
  }

  /** 破纪录：小皮气泡「新纪录！你太厉害了！」+ 加强版星星烟花 + 背景彩虹闪烁 */
  function showNewRecordFeedback() {
    var bubble = document.getElementById("guide-bubble");
    var guide = document.getElementById("guide-character");
    if (bubble) {
      bubble.textContent = "新纪录！你太厉害了！";
      bubble.classList.add("is-visible");
    }
    var wrap = document.createElement("div");
    wrap.className = "correct-feedback-overlay new-record-overlay";
    wrap.setAttribute("aria-live", "polite");
    wrap.innerHTML = '<span class="correct-feedback-emoji new-record-emoji">🌟🌟🌟</span><span class="correct-feedback-text new-record-text">新纪录！</span>';
    document.body.appendChild(wrap);
    document.body.classList.add("rainbow-flash");
    setTimeout(function () {
      if (wrap.parentNode) wrap.remove();
      document.body.classList.remove("rainbow-flash");
    }, 1200);
    setTimeout(function () {
      if (bubble && guide && !guide.classList.contains("xiaopi-shy")) bubble.classList.remove("is-visible");
    }, 2500);
  }

  /** 全球热度排名百分比：根据连击数模拟真实分布（分段 + 可选时间微调） */
  function getGlobalPercentage(combo) {
    var c = Math.max(0, combo);
    var pct;
    if (c < 3) {
      pct = c === 0 ? 0 : c === 1 ? 2 : 6;
    } else if (c <= 4) {
      pct = 12 + (c - 3) * 22;
    } else if (c <= 10) {
      pct = 55 + (c - 5) * 5;
    } else if (c <= 15) {
      pct = 82 + (c - 10) * 2.6;
    } else {
      pct = 96 + Math.min(3, c - 15) * 1;
    }
    pct = Math.min(99, Math.max(0, Math.round(pct)));
    var hourSeed = new Date().getHours() % 7;
    var jitter = (hourSeed - 3) * 0.5;
    return Math.min(99, Math.max(0, Math.round(pct + jitter)));
  }

  /** 小皮全球战报：Combo 结束或通关时播报「打败全球 XX%」，高排名时金色光圈 + 纸屑 + 颁奖音效 */
  function showGlobalRankSpeech(combo, context) {
    var guide = document.getElementById("guide-character");
    var bubble = document.getElementById("guide-bubble");
    if (!guide || !bubble) return;
    var pct = getGlobalPercentage(combo);
    var best = state.bestGlobalRank != null ? state.bestGlobalRank : 0;
    if (pct > best) {
      state.bestGlobalRank = pct;
      try { localStorage.setItem("forest_best_rank", String(pct)); } catch (_) {}
    }
    var text;
    if (best >= 99 && pct < best) {
      text = "加油，离你打败 99% 的纪录就差一点啦！";
    } else if (pct >= 95) {
      text = "太强了！你已经进入了全球森林英雄榜的前 " + (100 - pct) + "%！";
    } else {
      text = "天呐！你现在的热度打败了全球 " + pct + "% 的森林小伙伴！";
    }
    bubble.textContent = text;
    bubble.classList.add("is-visible");
    if (pct >= 90) {
      guide.classList.add("xiaopi-golden-halo");
      playAwardSound();
      setTimeout(function () { if (guide) guide.classList.remove("xiaopi-golden-halo"); }, 4000);
    }
    if (pct >= 99) launchGlobalConfetti();
    setTimeout(function () {
      if (bubble) bubble.classList.remove("is-visible");
    }, context === "end" ? 4500 : 3500);
  }

  /** 颁奖典礼短音效：高排名时播放 */
  function playAwardSound() {
    try {
      var C = getAudioContext();
      if (!C) return;
      var g = C.createGain();
      g.connect(C.destination);
      g.gain.setValueAtTime(0.18, C.currentTime);
      g.gain.exponentialRampToValueAtTime(0.01, C.currentTime + 0.6);
      [523.25, 659.25, 783.99, 1046.5].forEach(function (freq, i) {
        var o = C.createOscillator();
        o.connect(g);
        o.frequency.value = freq;
        o.type = "sine";
        var t = C.currentTime + i * 0.1;
        o.start(t);
        o.stop(t + 0.35);
      });
    } catch (_) {}
  }

  /** 全屏金色/彩色纸屑：打败 99% 时触发 */
  function launchGlobalConfetti() {
    var wrap = document.createElement("div");
    wrap.className = "global-confetti-overlay";
    wrap.setAttribute("aria-hidden", "true");
    var inner = document.createElement("div");
    inner.className = "confetti-wrap global-confetti-wrap";
    wrap.appendChild(inner);
    document.body.appendChild(wrap);
    var colors = ["#FFD700", "#FFA500", "#FF6B6B", "#7FAF9A", "#A9C5B4", "#E3E6E2"];
    for (var i = 0; i < 60; i++) {
      var p = document.createElement("div");
      p.className = "confetti-piece";
      p.style.left = Math.random() * 100 + "%";
      p.style.animationDelay = Math.random() * 0.6 + "s";
      p.style.background = colors[Math.floor(Math.random() * colors.length)];
      p.style.transform = "rotate(" + Math.random() * 360 + "deg)";
      inner.appendChild(p);
    }
    setTimeout(function () {
      if (wrap.parentNode) wrap.remove();
    }, 3200);
  }

  /** 小皮崇拜播报：根据时机显示含最高连击的台词，并切换星星眼 */
  function showMaxComboSpeech(context) {
    var guide = document.getElementById("guide-character");
    var bubble = document.getElementById("guide-bubble");
    if (!guide || !bubble) return;
    var maxCombo = state.maxCombo != null ? state.maxCombo : 0;
    var text;
    if (maxCombo === 0) {
      text = "快开始你的第一次连击挑战吧！";
    } else if (context === "idle") {
      text = "别发呆啦，你最高连对过 " + maxCombo + " 次呢，快来超越它！";
    } else {
      text = "哇！你最高连对过 " + maxCombo + " 次呢！真不愧是森林之王！";
    }
    bubble.textContent = text;
    bubble.classList.add("is-visible");
    guide.classList.add("xiaopi-stareyes");
    var dur = context === "end" ? 4500 : 4000;
    setTimeout(function () {
      guide.classList.remove("xiaopi-stareyes");
      if (bubble) bubble.classList.remove("is-visible");
    }, dur);
  }

  /** 连击归零：移除所有热度特效、墨镜、切回森林 BGM、播放切断音 */
  function clearFever() {
    var hadFever = (state.feverLevel || 0) > 0;
    state.feverLevel = 0;
    document.body.classList.remove("fever-lvl-1", "fever-lvl-2");
    var guide = document.getElementById("guide-character");
    if (guide) guide.classList.remove("xiaopi-cool");
    var bgm = document.getElementById("bgm");
    var bgmFever = document.getElementById("bgm-fever");
    if (bgm && bgmFever) {
      bgmFever.pause();
      if (!bgm.muted) bgm.play().catch(function () {});
    }
    if (hadFever) playCutSound();
  }

  /** 获取可用的 AudioContext（优先用首次点击已解锁的），避免 Autoplay 报错 */
  function getAudioContext() {
    try {
      var C = state.audioContext || (typeof (window.AudioContext || window.webkitAudioContext) !== "undefined" ? new (window.AudioContext || window.webkitAudioContext)() : null);
      if (C && C.state === "suspended") C.resume().catch(function () {});
      return C;
    } catch (_) { return null; }
  }

  /** 点对时动物叫声：0 喵 1 汪 2 兔子（拟声） */
  function playAnimalSound(animalIndex) {
    try {
      const C = getAudioContext();
      if (!C) return;
      const g = C.createGain();
      g.connect(C.destination);
      g.gain.setValueAtTime(0.18, C.currentTime);
      g.gain.exponentialRampToValueAtTime(0.01, C.currentTime + 0.3);
      if (animalIndex === 0) {
        const o = C.createOscillator();
        o.connect(g);
        o.frequency.setValueAtTime(600, C.currentTime);
        o.frequency.linearRampToValueAtTime(900, C.currentTime + 0.12);
        o.type = "sine";
        o.start(C.currentTime);
        o.stop(C.currentTime + 0.2);
      } else if (animalIndex === 1) {
        const o = C.createOscillator();
        o.connect(g);
        o.frequency.value = 180;
        o.type = "sine";
        o.start(C.currentTime);
        o.stop(C.currentTime + 0.18);
      } else {
        const o = C.createOscillator();
        o.connect(g);
        o.frequency.value = 400;
        o.type = "sine";
        o.start(C.currentTime);
        o.stop(C.currentTime + 0.1);
      }
    } catch (_) {}
  }

  /** 贴纸放下时的“砰”声（弹性生长反馈） */
  function playPopSound() {
    try {
      const C = getAudioContext();
      if (C) {
        const o = C.createOscillator();
        const g = C.createGain();
        o.connect(g);
        g.connect(C.destination);
        o.frequency.value = 520;
        o.type = "sine";
        g.gain.setValueAtTime(0.12, C.currentTime);
        g.gain.exponentialRampToValueAtTime(0.01, C.currentTime + 0.08);
        o.start(C.currentTime);
        o.stop(C.currentTime + 0.08);
      }
    } catch (_) {}
  }

  /** 王者降临：森林之王进入等待房间时短音效 */
  function playKingSound() {
    try {
      const C = getAudioContext();
      if (C) {
        const g = C.createGain();
        g.connect(C.destination);
        g.gain.setValueAtTime(0.12, C.currentTime);
        g.gain.exponentialRampToValueAtTime(0.01, C.currentTime + 0.5);
        [523.25, 659.25, 783.99].forEach((freq, i) => {
          const o = C.createOscillator();
          o.connect(g);
          o.frequency.value = freq;
          o.type = "sine";
          const t = C.currentTime + i * 0.12;
          o.start(t);
          o.stop(t + 0.2);
        });
      }
    } catch (_) {}
  }

  /** 微交互：重要按钮点击时极轻微的“滴”声 */
  function playTapSound() {
    try {
      const C = getAudioContext();
      if (C) {
        const g = C.createGain();
        g.connect(C.destination);
        g.gain.setValueAtTime(0.06, C.currentTime);
        g.gain.exponentialRampToValueAtTime(0.001, C.currentTime + 0.04);
        const o = C.createOscillator();
        o.connect(g);
        o.frequency.value = 880;
        o.type = "sine";
        o.start(C.currentTime);
        o.stop(C.currentTime + 0.04);
      }
    } catch (_) {}
  }

  /** 森林广播出现时：极轻微的「叮铃」风铃音效 */
  function playBroadcastChime() {
    try {
      var C = getAudioContext();
      if (!C) return;
      var g = C.createGain();
      g.connect(C.destination);
      g.gain.setValueAtTime(0.04, C.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, C.currentTime + 0.35);
      [880, 1108.73].forEach(function (freq, i) {
        var o = C.createOscillator();
        o.connect(g);
        o.frequency.value = freq;
        o.type = "sine";
        var t = C.currentTime + i * 0.08;
        o.start(t);
        o.stop(t + 0.25);
      });
    } catch (_) {}
  }

  /** 重要操作点击时播放清脆「噗」声（事件委托）；点击小皮不触发；任意点击重置挂机计时 */
  function resetIdleTimer() {
    if (state.idleTimerId) clearTimeout(state.idleTimerId);
    state.idleTimerId = setTimeout(xiaoPiGreet, 60000);
  }
  function clearIdleTimer() {
    if (state.idleTimerId) clearTimeout(state.idleTimerId);
    state.idleTimerId = null;
  }
  function xiaoPiGreet() {
    state.idleTimerId = null;
    var guide = document.getElementById("guide-character");
    var bubble = document.getElementById("guide-bubble");
    if (!guide || !bubble) return;
    var lines = ["嘿！是在想哪只小动物躲起来了吗？", "加油呀，小皮一直在陪你哦！"];
    if (state.maxCombo > 0) {
      lines.push("别发呆啦，你最高连对过 " + state.maxCombo + " 次呢，快来超越它！");
    } else {
      lines.push("快开始你的第一次连击挑战吧！");
    }
    var idx = Math.floor(Math.random() * lines.length);
    var isMaxComboLine = lines[idx].indexOf("最高连对过") !== -1 || lines[idx].indexOf("第一次连击") !== -1;
    bubble.textContent = lines[idx];
    bubble.classList.add("is-visible");
    if (isMaxComboLine) guide.classList.add("xiaopi-stareyes");
    guide.classList.remove("xiaopi-greet");
    guide.offsetHeight;
    guide.classList.add("xiaopi-greet");
    triggerJelly(guide); /* 小皮打招呼时也触发果冻回弹 */
    setTimeout(function () {
      guide.classList.remove("xiaopi-greet");
      if (isMaxComboLine) guide.classList.remove("xiaopi-stareyes");
      if (bubble) bubble.classList.remove("is-visible");
    }, 3500);
    var a = sfx.greet;
    if (a) { a.currentTime = 0; a.volume = 0.5; a.play().catch(function () {}); }
  }
  document.body.addEventListener("click", function(ev) {
    resetIdleTimer();
    /* 果冻效果：动物图标、开始/重新开始按钮、小皮等可点击元素 */
    var jellyEl = ev.target.closest(".choice, .choice-avatar, .seq-dot, .seq-emoji, button[data-action='start'], #versusStartBtn, .guide-avatar, .big-btn, .btn-versus, .jelly-button, .jelly-card");
    if (jellyEl) triggerJelly(jellyEl);
    var t = ev.target.closest("button, a[href]");
    if (!t || t.id === "guide-avatar") return;
    if (t.classList.contains("jelly-button") || t.classList.contains("jelly-card") || t.classList.contains("auth-card") || t.classList.contains("room-modal-btn") || t.classList.contains("ach-modal-btn") || t.classList.contains("menu-item") || t.classList.contains("legendary-unlock-btn") || t.classList.contains("parent-back") || t.classList.contains("font-size-btn") || t.classList.contains("logout-confirm-btn") || t.classList.contains("btn-worship") || t.getAttribute("data-action")) playClickSound();
  }, true);
  document.body.addEventListener("touchstart", function() { resetIdleTimer(); }, { passive: true });
  if (typeof document.hidden !== "undefined") {
    document.addEventListener("visibilitychange", function() {
      if (document.hidden) clearIdleTimer();
    });
  }

  /** 错误时屏幕轻微摇晃 */
  function shakeScreen(container) {
    const el = container && container.classList ? container : document.body;
    el.classList.add("shake");
    setTimeout(() => el.classList.remove("shake"), 520);
  }

  /** 果冻回弹效果：点击时添加 .jelly-active，约 0.4s 后移除；连点时重置动画重新播放 */
  function triggerJelly(el) {
    if (!el || !el.classList) return;
    el.classList.remove("jelly-active");
    void el.offsetHeight; /* 强制重排，使下次添加类时动画重新开始 */
    el.classList.add("jelly-active");
    setTimeout(function () {
      if (el && el.classList) el.classList.remove("jelly-active");
    }, 420);
  }

  /** 森林 24 小时：6–10 早晨 / 10–17 白天 / 17–19 黄昏 / 19–6 夜晚 */
  var TIME_STATE = { morning: "state-morning", day: "state-day", sunset: "state-sunset", night: "state-night" };
  /** 临时测试用：设为数字（如 20）则强制该小时，设为 null 恢复真实时间 */
  var DEBUG_HOUR = 20;
  function getTimeState() {
    var h = DEBUG_HOUR != null ? DEBUG_HOUR : new Date().getHours();
    if (h >= 6 && h < 10) return "morning";
    if (h >= 10 && h < 17) return "day";
    if (h >= 17 && h < 19) return "sunset";
    return "night";
  }
  /** 夜晚灯笼：在背景中生成 5-6 个暖色灯笼，随机位置与动画延迟；退出夜晚时淡出移除 */
  function spawnLanterns() {
    var container = document.getElementById("lanterns-container");
    if (!container) return;
    container.innerHTML = "";
    container.setAttribute("aria-hidden", "false");
    var count = 5 + Math.floor(Math.random() * 2);
    for (var i = 0; i < count; i++) {
      var wrap = document.createElement("div");
      wrap.className = "lantern-wrap";
      wrap.setAttribute("aria-hidden", "true");
      wrap.style.left = (12 + Math.random() * 76) + "%";
      wrap.style.top = (8 + Math.random() * 32) + "%";
      wrap.style.animationDelay = (Math.random() * 2.5) + "s";
      var string = document.createElement("div");
      string.className = "lantern-string";
      var lantern = document.createElement("div");
      lantern.className = "lantern";
      lantern.style.animationDelay = (Math.random() * 2.5) + "s";
      wrap.appendChild(string);
      wrap.appendChild(lantern);
      var fireflyWrap = document.createElement("div");
      fireflyWrap.className = "lantern-fireflies-inner";
      var nFireflies = 3 + Math.floor(Math.random() * 3);
      for (var f = 0; f < nFireflies; f++) {
        var fly = document.createElement("div");
        fly.className = "firefly";
        fly.style.left = (15 + Math.random() * 70) + "%";
        fly.style.top = (10 + Math.random() * 80) + "%";
        var size = 2 + Math.random() * 2;
        fly.style.width = size + "px";
        fly.style.height = size + "px";
        fly.style.animationDelay = (Math.random() * 3) + "s";
        fly.style.animationDuration = (3 + Math.random() * 2) + "s";
        fireflyWrap.appendChild(fly);
      }
      wrap.appendChild(fireflyWrap);
      wrap.addEventListener("click", function () {
        var w = this;
        w.classList.add("lantern-blink");
        playLanternDing();
        setTimeout(function () { w.classList.remove("lantern-blink"); }, 520);
        if (state.lanternChampionUsername) {
          var bubble = document.getElementById("guide-bubble");
          var guide = document.getElementById("guide-character");
          if (bubble && guide) {
            bubble.textContent = "这是冠军选的颜色，好看吗？";
            bubble.classList.add("is-visible");
            guide.classList.remove("xiaopi-idle");
            guide.classList.add("is-talking");
            setTimeout(function () {
              if (bubble) bubble.classList.remove("is-visible");
              if (guide) { guide.classList.remove("is-talking"); guide.classList.add("xiaopi-idle"); }
            }, 2500);
          }
        }
      });
      container.appendChild(wrap);
    }
    var lfContainer = document.getElementById("lantern-fireflies");
    if (lfContainer) {
      lfContainer.innerHTML = "";
      lfContainer.setAttribute("aria-hidden", "false");
      var lfCount = 6 + Math.floor(Math.random() * 4);
      for (var j = 0; j < lfCount; j++) {
        var lf = document.createElement("div");
        lf.className = "lantern-firefly";
        lf.style.left = (10 + Math.random() * 80) + "%";
        lf.style.top = (6 + Math.random() * 38) + "%";
        lf.style.animationDelay = (Math.random() * 3) + "s";
        lf.style.animationDuration = (2.5 + Math.random() * 2) + "s";
        lfContainer.appendChild(lf);
      }
    }
  }
  function removeLanterns() {
    var container = document.getElementById("lanterns-container");
    if (!container) return;
    var wraps = container.querySelectorAll(".lantern-wrap");
    wraps.forEach(function (w) {
      w.classList.add("lantern-fade-out");
    });
    setTimeout(function () {
      container.innerHTML = "";
      container.setAttribute("aria-hidden", "true");
      var lfContainer = document.getElementById("lantern-fireflies");
      if (lfContainer) {
        lfContainer.innerHTML = "";
        lfContainer.setAttribute("aria-hidden", "true");
      }
    }, 650);
  }
  function playLanternDing() {
    try {
      var C = getAudioContext();
      if (!C) return;
      var g = C.createGain();
      g.connect(C.destination);
      g.gain.setValueAtTime(0.06, C.currentTime);
      g.gain.exponentialRampToValueAtTime(0.01, C.currentTime + 0.15);
      var o = C.createOscillator();
      o.connect(g);
      o.frequency.value = 880;
      o.type = "sine";
      o.start(C.currentTime);
      o.stop(C.currentTime + 0.12);
    } catch (_) {}
  }

  function initWeather() {
    var stateKey = getTimeState();
    var body = document.body;
    body.classList.remove(TIME_STATE.morning, TIME_STATE.day, TIME_STATE.sunset, TIME_STATE.night);
    body.classList.add(TIME_STATE[stateKey]);
    var guide = document.getElementById("guide-character");
    if (guide) {
      guide.classList.remove("state-morning", "state-day", "state-sunset", "state-night");
      guide.classList.add("state-" + stateKey);
      var avatar = guide.querySelector(".guide-avatar");
      var guideLantern = guide.querySelector(".guide-lantern");
      if (stateKey === "night") {
        if (avatar && !guideLantern) {
          var span = document.createElement("span");
          span.className = "guide-lantern";
          span.setAttribute("aria-hidden", "true");
          avatar.appendChild(span);
        }
      } else {
        if (guideLantern) guideLantern.remove();
      }
    }
    var container = document.getElementById("fireflies");
    if (container) {
      container.innerHTML = "";
      if (stateKey === "night") {
        for (var i = 0; i < 10; i++) {
          var f = document.createElement("div");
          f.className = "firefly";
          f.style.left = Math.random() * 100 + "%";
          f.style.top = Math.random() * 100 + "%";
          f.style.animationDelay = Math.random() * 2 + "s";
          f.style.animationDuration = (1.5 + Math.random() * 1.5) + "s";
          container.appendChild(f);
        }
      }
    }
    if (stateKey === "night") spawnLanterns();
    else removeLanterns();
    updateBGMByTime(stateKey);
  }
  /** 随时段切换 BGM：夜晚音量降 30%，可选夜间轨道 */
  var BGM_NIGHT_URL = "https://www.chosic.com/wp-content/uploads/2021/04/Funny-Puppy.mp3";
  function updateBGMByTime(stateKey) {
    var bgm = document.getElementById("bgm");
    if (!bgm || bgm.muted) return;
    if (stateKey === "night") {
      bgm.volume = BGM_VOLUME * 0.7;
    } else {
      bgm.volume = BGM_VOLUME;
    }
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initWeather);
  else initWeather();
  setInterval(initWeather, 60000);

  /** 松鼠闪现：每 10 秒在画面边缘触发一次，动画约 2.2s 后移除 class */
  (function initSquirrelFlash() {
    var el = document.getElementById("squirrelFlash");
    if (!el) return;
    var DURATION_MS = 2200;
    var INTERVAL_MS = 10000;
    function trigger() {
      el.classList.add("is-visible");
      setTimeout(function () {
        el.classList.remove("is-visible");
      }, DURATION_MS);
    }
    setInterval(trigger, INTERVAL_MS);
    setTimeout(trigger, 1500);
  })();

  /** 天气检查占位：返回 Promise<{ isRaining: boolean }>，稍后接入 API Key 或真实接口 */
  function checkWeather() {
    return new Promise(function (resolve) {
      // 模拟：默认不下雨；改为 resolve({ isRaining: true }) 可测试雨天撑伞
      resolve({ isRaining: false });
      // 接入示例（拿到 Key 后替换上面两行）：
      // fetch("https://get.geojs.io/v1/ip/geo.json").then(r => r.json()).then(geo => {
      //   var lat = geo.latitude, lon = geo.longitude;
      //   return fetch("https://api.open-meteo.com/v1/forecast?latitude="+lat+"&longitude="+lon+"&current_weather=true").then(r => r.json());
      // }).then(data => {
      //   var code = data && data.current_weather && data.current_weather.weathercode;
      //   var isRaining = (code >= 61 && code <= 67) || (code >= 71 && code <= 77) || (code >= 80 && code <= 82);
      //   resolve({ isRaining: !!isRaining });
      // }).catch(() => resolve({ isRaining: false }));
    });
  }

  /** 根据 checkWeather() 结果决定是否进入雨天撑伞；失败则静默 */
  function fetchRealWeather() {
    checkWeather()
      .then(function (result) {
        if (result && result.isRaining) {
          state.isRaining = true;
          applyRainMode();
        }
      })
      .catch(function () {});
  }
  function applyRainMode() {
    state.isRaining = true;
    document.body.classList.add("is-raining");
    var guide = document.getElementById("guide-character");
    if (guide && !guide.querySelector(".guide-umbrella")) {
      var umb = document.createElement("span");
      umb.className = "guide-umbrella";
      umb.setAttribute("aria-hidden", "true");
      umb.textContent = "☂️";
      guide.insertBefore(umb, guide.querySelector(".guide-bubble"));
    }
    var env = document.getElementById("envLayer");
    if (env && !document.getElementById("rainLayer")) {
      var layer = document.createElement("div");
      layer.id = "rainLayer";
      layer.className = "rain-layer";
      layer.setAttribute("aria-hidden", "true");
      for (var i = 0; i < 50; i++) {
        var line = document.createElement("div");
        line.className = "rain-line";
        line.style.left = Math.random() * 100 + "%";
        line.style.animationDelay = Math.random() * 2 + "s";
        line.style.animationDuration = (0.6 + Math.random() * 0.4) + "s";
        layer.appendChild(line);
      }
      env.appendChild(layer);
    }
    var bubble = document.getElementById("guide-bubble");
    if (bubble) {
      bubble.textContent = "外面下雨啦，幸好我有小花伞！你也别淋湿哦~";
      bubble.classList.add("is-visible");
      setTimeout(function () { if (bubble) bubble.classList.remove("is-visible"); }, 4000);
    }
  }
  function removeRainMode() {
    state.isRaining = false;
    document.body.classList.remove("is-raining");
    var guide = document.getElementById("guide-character");
    if (guide) {
      var umb = guide.querySelector(".guide-umbrella");
      if (umb) umb.remove();
    }
    var layer = document.getElementById("rainLayer");
    if (layer) layer.remove();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", function () { fetchRealWeather(); });
  else fetchRealWeather();

  /** Fetch API：异步请求，不刷新页面。credentials 携带 session。 */
  function api(path, options = {}) {
    const opts = {
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", ...options.headers },
      ...options,
    };
    if (options.body && typeof options.body === "object" && !(options.body instanceof FormData)) {
      opts.body = JSON.stringify(options.body);
    }
    return fetch(path, opts).then((r) => {
      if (r.ok) return r.json().catch(() => ({}));
      return r.json().then((d) => Promise.reject(d)).catch((e) => Promise.reject({ error: r.status === 401 ? "未登录" : (e && e.error) || "请求失败" }));
    });
  }

  /** 自定义房间号弹窗：显示房间号，点击「我知道了」后关闭并执行 onConfirm（替代 alert） */
  function showRoomCreatedModal(roomId, onConfirm) {
    const modal = document.getElementById("roomCreatedModal");
    const titleEl = document.getElementById("roomModalTitle");
    const codeEl = document.getElementById("roomModalCode");
    const hintEl = modal && modal.querySelector(".room-modal-hint");
    const box = modal && modal.querySelector(".room-modal-box");
    const btn = document.getElementById("roomModalConfirm");
    if (!modal || !codeEl || !btn) return;
    if (titleEl) titleEl.textContent = "房间已创建！";
    codeEl.textContent = roomId || "------";
    if (hintEl) hintEl.textContent = "请把房间号告诉对方";
    if (box) box.removeAttribute("data-mode");
    btn.textContent = "我知道了";
    modal.setAttribute("aria-hidden", "false");
    modal.classList.add("is-open");
    modal.classList.remove("is-closing");
    function close() {
      modal.classList.add("is-closing");
      modal.classList.remove("is-open");
      setTimeout(() => {
        modal.classList.remove("is-closing");
        modal.setAttribute("aria-hidden", "true");
        btn.removeEventListener("click", onBtnClick);
        if (typeof onConfirm === "function") onConfirm();
      }, 250);
    }
    function onBtnClick() { close(); }
    btn.addEventListener("click", onBtnClick);
  }

  /** 错误提示弹窗（同一样式，小字显示文案，替代 alert） */
  function showErrorModal(message, onConfirm) {
    const modal = document.getElementById("roomCreatedModal");
    const titleEl = document.getElementById("roomModalTitle");
    const codeEl = document.getElementById("roomModalCode");
    const hintEl = modal && modal.querySelector(".room-modal-hint");
    const box = modal && modal.querySelector(".room-modal-box");
    const btn = document.getElementById("roomModalConfirm");
    if (!modal || !codeEl || !btn) return;
    if (titleEl) titleEl.textContent = "提示";
    codeEl.textContent = message || "操作失败";
    if (hintEl) hintEl.textContent = "";
    if (box) box.setAttribute("data-mode", "error");
    btn.textContent = "我知道了";
    modal.setAttribute("aria-hidden", "false");
    modal.classList.add("is-open");
    modal.classList.remove("is-closing");
    function close() {
      modal.classList.add("is-closing");
      modal.classList.remove("is-open");
      setTimeout(() => {
        modal.classList.remove("is-closing");
        modal.setAttribute("aria-hidden", "true");
        btn.removeEventListener("click", onBtnClick);
        if (typeof onConfirm === "function") onConfirm();
      }, 250);
    }
    function onBtnClick() { close(); }
    btn.addEventListener("click", onBtnClick);
  }

  /** 绑定登录/注册入口按钮（安全：元素不存在则不绑定） */
  function bindAuthLandingButtons() {
    if (!app) return;
    var reg = app.querySelector('[data-action="show-register"]');
    var login = app.querySelector('[data-action="show-login"]');
    if (reg && !reg._authBound) {
      reg._authBound = true;
      reg.addEventListener("click", function () { showRegister(); });
    }
    if (login && !login._authBound) {
      login._authBound = true;
      login.addEventListener("click", function () { showLogin(); });
    }
  }

  /** 事件委托：在 #app 上统一处理「新朋友/老朋友」点击，确保点按钮内文字也能进入 */
  function initAuthClickDelegation() {
    if (!app) return;
    app.addEventListener("click", function (e) {
      var reg = e.target.closest && e.target.closest("[data-action=\"show-register\"]");
      var login = e.target.closest && e.target.closest("[data-action=\"show-login\"]");
      if (reg) {
        e.preventDefault();
        showRegister();
        return;
      }
      if (login) {
        e.preventDefault();
        showLogin();
        return;
      }
    }, true);
  }

  /** 首页双卡片：「我是新朋友」「老朋友请进」 */
  function showAuthLanding() {
    clearIdleTimer();
    state.mode = "auth";
    if (tplAuthLanding && tplAuthLanding.content) {
      mount(tplAuthLanding);
    }
    bindAuthLandingButtons();
  }

  /** 登录：输入框下方红色卡通提示，Fetch 异步提交，成功后 localStorage + 跳转关卡选择 */
  function showLogin() {
    state.mode = "auth";
    mount(tplLogin);
    const form = $("#loginForm");
    const usernameErr = $("#loginUsernameErr");
    const passwordErr = $("#loginPasswordErr");
    const msg = $("#loginMsg");

    function clearValidation() {
      if (usernameErr) usernameErr.textContent = "";
      if (passwordErr) passwordErr.textContent = "";
      if (msg) { msg.textContent = ""; msg.className = "auth-msg"; }
      form.querySelectorAll(".auth-input").forEach((el) => el.classList.remove("has-error"));
    }

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      clearValidation();
      const username = (form.username.value || "").trim();
      const password = form.password.value || "";
      let valid = true;
      if (!username) {
        if (usernameErr) { usernameErr.textContent = "请输入用户名"; form.username.classList.add("has-error"); }
        valid = false;
      }
      if (!password) {
        if (passwordErr) { passwordErr.textContent = "请输入密码"; form.password.classList.add("has-error"); }
        valid = false;
      }
      if (password.length > 0 && password.length < 4) {
        if (passwordErr) { passwordErr.textContent = "密码至少 4 个字符"; form.password.classList.add("has-error"); }
        valid = false;
      }
      if (!valid) return;
      const submitBtn = form.querySelector('button[type="submit"]');
      const btnText = submitBtn ? submitBtn.textContent : "";
      try {
        if (submitBtn) { submitBtn.textContent = "登录中…"; submitBtn.disabled = true; }
        const data = await api(BACKEND_BASE + "/api/login", { method: "POST", body: { username, password } });
        state.user = data.username;
        state.userId = data.user_id;
        try { localStorage.setItem("user", JSON.stringify({ username: data.username, user_id: data.user_id })); } catch (_) {}
        goHome();
      } catch (err) {
        if (msg) {
          var text = (err && (err.error || err.message)) || "登录失败，请检查网络或稍后再试";
          if (typeof text === "string" && (text.indexOf("NetworkError") !== -1 || text.indexOf("Failed to fetch") !== -1)) {
            text = "森林服务器正在醒来，请稍等 30 秒再点一次「登录」～";
          }
          msg.textContent = text;
          msg.className = "auth-msg err";
        }
      } finally {
        if (submitBtn) { submitBtn.textContent = btnText || "登录"; submitBtn.disabled = false; }
      }
    });
    app.querySelector('[data-action="show-landing"]').addEventListener("click", (e) => { e.preventDefault(); showAuthLanding(); });
  }

  /** 注册：输入框下方红色卡通提示，密码至少 4 字符，Fetch 异步，成功后 localStorage + 跳转关卡选择 */
  function showRegister() {
    state.mode = "auth";
    mount(tplRegister);
    const form = $("#registerForm");
    const usernameErr = $("#regUsernameErr");
    const passwordErr = $("#regPasswordErr");
    const password2Err = $("#regPassword2Err");
    const msg = $("#registerMsg");

    function clearValidation() {
      [usernameErr, passwordErr, password2Err].forEach((el) => { if (el) el.textContent = ""; });
      if (msg) { msg.textContent = ""; msg.className = "auth-msg"; }
      form.querySelectorAll(".auth-input").forEach((el) => el.classList.remove("has-error")); }

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      clearValidation();
      const username = (form.username.value || "").trim();
      const password = form.password.value || "";
      const password2 = form.password2.value || "";
      let valid = true;
      if (!username) {
        if (usernameErr) { usernameErr.textContent = "请输入用户名"; form.username.classList.add("has-error"); }
        valid = false;
      } else if (username.length < 2) {
        if (usernameErr) { usernameErr.textContent = "用户名至少 2 个字符"; form.username.classList.add("has-error"); }
        valid = false;
      }
      if (!password) {
        if (passwordErr) { passwordErr.textContent = "请输入密码"; form.password.classList.add("has-error"); }
        valid = false;
      } else if (password.length < 4) {
        if (passwordErr) { passwordErr.textContent = "密码至少 4 个字符"; form.password.classList.add("has-error"); }
        valid = false;
      }
      if (password !== password2) {
        if (password2Err) { password2Err.textContent = "两次输入的密码不一致"; form.password2.classList.add("has-error"); }
        valid = false;
      }
      if (!valid) return;
      const submitBtn = form.querySelector('button[type="submit"]');
      const btnText = submitBtn ? submitBtn.textContent : "";
      try {
        if (submitBtn) { submitBtn.textContent = "注册中…"; submitBtn.disabled = true; }
        const data = await api(BACKEND_BASE + "/api/register", { method: "POST", body: { username, password } });
        state.user = data.username;
        state.userId = data.user_id;
        try { localStorage.setItem("user", JSON.stringify({ username: data.username, user_id: data.user_id })); } catch (_) {}
        goHome();
      } catch (err) {
        if (msg) {
          var text = (err && (err.error || err.message)) || "注册失败，请检查网络或稍后再试";
          if (typeof text === "string" && (text.indexOf("NetworkError") !== -1 || text.indexOf("Failed to fetch") !== -1)) {
            text = "森林服务器正在醒来，请稍等 30 秒再点一次「注册」～";
          }
          msg.textContent = text;
          msg.className = "auth-msg err";
        }
      } finally {
        if (submitBtn) { submitBtn.textContent = btnText || "注册"; submitBtn.disabled = false; }
      }
    });
    app.querySelector('[data-action="show-landing"]').addEventListener("click", (e) => { e.preventDefault(); showAuthLanding(); });
  }

  function mount(tpl) {
    app.innerHTML = "";
    app.appendChild(tpl.content.cloneNode(true));
    document.body.classList.remove("page-home");
    if (app.querySelector(".game-screen")) {
      document.body.classList.add("game-page");
    } else {
      document.body.classList.remove("game-page");
    }
  }

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function ease(t) {
    return 1 - Math.pow(1 - t, 3);
  }

  async function animateMove(el, from, to, duration = 900) {
    const start = performance.now();
    function frame(now) {
      const t = Math.min(1, (now - start) / duration);
      const k = ease(t);
      const x = lerp(from.x, to.x, k);
      const y = lerp(from.y, to.y, k);
      el.style.transform = `translate(${x}px, ${y}px)`;
      if (t < 1) requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
    await sleep(duration + 20);
  }

  function showLogoutConfirm() {
    const modal = document.getElementById("logoutConfirmModal");
    if (modal) {
      modal.classList.add("is-open");
      modal.setAttribute("aria-hidden", "false");
    }
  }

  function bindLogoutConfirmModal() {
    if (state._logoutConfirmBound) return;
    state._logoutConfirmBound = true;
    const modal = document.getElementById("logoutConfirmModal");
    const overlay = modal && modal.querySelector(".room-modal-overlay");
    const cancelBtn = document.getElementById("logoutConfirmCancel");
    const okBtn = document.getElementById("logoutConfirmOk");
    function close() {
      if (modal) {
        modal.classList.remove("is-open");
        modal.setAttribute("aria-hidden", "true");
      }
    }
    function doLogout() {
      close();
      api(BACKEND_BASE + "/api/logout", { method: "POST" }).catch(() => ({}));
      state.user = null;
      state.userId = null;
      try { localStorage.removeItem("user"); } catch (_) {}
      showAuthLanding();
    }
    if (overlay) overlay.addEventListener("click", close);
    if (cancelBtn) cancelBtn.addEventListener("click", close);
    if (okBtn) okBtn.addEventListener("click", doLogout);
  }

  function bindHomeFontSizeToggle() {
    const wrap = app.querySelector(".home-font-toggle");
    if (!wrap) return;
    const saved = (typeof localStorage !== "undefined" && localStorage.getItem("homeFontSize")) || "medium";
    document.documentElement.classList.remove("font-size-small", "font-size-medium", "font-size-large");
    document.documentElement.classList.add("font-size-" + saved);
    wrap.querySelectorAll(".font-size-btn").forEach((btn) => {
      btn.classList.toggle("font-size-btn--active", btn.dataset.size === saved);
      btn.removeEventListener("click", btn._fontSizeClick);
      btn._fontSizeClick = function() {
        const size = btn.dataset.size;
        document.documentElement.classList.remove("font-size-small", "font-size-medium", "font-size-large");
        document.documentElement.classList.add("font-size-" + size);
        wrap.querySelectorAll(".font-size-btn").forEach((b) => b.classList.toggle("font-size-btn--active", b.dataset.size === size));
        try { localStorage.setItem("homeFontSize", size); } catch (_) {}
      };
      btn.addEventListener("click", btn._fontSizeClick);
    });
  }

  /** 首页背景交互：大树落叶、草坪花晃动、天空云朵亮晶晶 */
  function bindEnvInteractions() {
    if (state._envInteractionsBound) return;
    state._envInteractionsBound = true;
    var treeZone = document.getElementById("envTreeZone");
    var lawnZone = document.getElementById("envLawnZone");
    var skyZone = document.getElementById("envSkyZone");
    var envLayer = document.getElementById("envLayer");
    if (treeZone) {
      treeZone.addEventListener("click", function () {
        if (!document.body.classList.contains("page-home")) return;
        spawnFallingLeaves(5);
        playClickSound();
      });
    }
    if (lawnZone) {
      lawnZone.addEventListener("click", function () {
        if (!document.body.classList.contains("page-home")) return;
        var flowers = envLayer && envLayer.querySelectorAll(".env-flower");
        if (flowers && flowers.length) {
          flowers.forEach(function (el) {
            el.classList.add("sway");
            setTimeout(function () { el.classList.remove("sway"); }, 800);
          });
        }
      });
    }
    if (skyZone) {
      skyZone.addEventListener("click", function () {
        if (!document.body.classList.contains("page-home")) return;
        var clouds = envLayer && envLayer.querySelectorAll(".env-click-cloud");
        if (clouds && clouds.length) {
          var cloud = clouds[Math.floor(Math.random() * clouds.length)];
          cloud.classList.add("cloud-sparkle");
          setTimeout(function () { cloud.classList.remove("cloud-sparkle"); }, 600);
        }
        spawnSparkleDrops(8);
        playSparkleSound();
      });
    }
  }
  function spawnFallingLeaves(n) {
    var leaves = ["🍃", "🍂", "🌿"];
    for (var i = 0; i < n; i++) {
      var el = document.createElement("div");
      el.className = "leaf-fall";
      el.textContent = leaves[i % leaves.length];
      el.style.left = (5 + Math.random() * 18) + "%";
      el.style.top = "10%";
      el.style.animationDelay = (i * 0.15) + "s";
      el.style.animationDuration = (2.2 + Math.random() * 0.8) + "s";
      document.body.appendChild(el);
      setTimeout(function (e) {
        if (e.parentNode) e.remove();
      }, 2800, el);
    }
  }
  function spawnSparkleDrops(n) {
    for (var i = 0; i < n; i++) {
      var el = document.createElement("div");
      el.className = "sparkle-drop";
      el.style.left = (10 + Math.random() * 80) + "%";
      el.style.top = "15%";
      el.style.animationDelay = (i * 0.08) + "s";
      document.body.appendChild(el);
      setTimeout(function (e) {
        if (e.parentNode) e.remove();
      }, 1300, el);
    }
  }
  function playSparkleSound() {
    try {
      var C = getAudioContext();
      if (!C) return;
      var g = C.createGain();
      g.connect(C.destination);
      g.gain.setValueAtTime(0.08, C.currentTime);
      g.gain.exponentialRampToValueAtTime(0.01, C.currentTime + 0.25);
      var o = C.createOscillator();
      o.connect(g);
      o.frequency.value = 1200;
      o.type = "sine";
      o.start(C.currentTime);
      o.stop(C.currentTime + 0.2);
    } catch (_) {}
  }

  function goHome() {
    state.mode = "home";
    state.game = null;
    mount(tplHome);
    document.body.classList.add("page-home");
    bindEnvInteractions();
    const nameEl = $("#homeUserName");
    if (nameEl) nameEl.textContent = state.user || "用户";
    var parentLink = document.querySelector(".parent-link");
    if (parentLink && state.userId) parentLink.setAttribute("href", "/parent?user_id=" + state.userId);
    const logoutBtn = $("button[data-action='logout']");
    if (logoutBtn) logoutBtn.addEventListener("click", () => showLogoutConfirm());
    bindLogoutConfirmModal();
    bindBgmButton();
    bindBgmStartOverlay();
    bindHomeFontSizeToggle();
    $(".home").addEventListener("click", (ev) => {
      const btn = ev.target.closest("button[data-nav]");
      if (btn) {
        const nav = btn.dataset.nav;
        if (nav === "shape") startDemo("shape");
        if (nav === "color") startDemo("color");
        if (nav === "seq") showSeqLevelPicker();
        if (nav === "shadow") startDemo("shadow");
        if (nav === "versus") enterVersusMenu();
        if (nav === "collection") showCollection();
        return;
      }
      if (ev.target.closest("button[data-action='show-achievements']")) showAchievementsModal();
      if (ev.target.closest("button[data-action='show-honor-board']")) showHonorBoardModal();
      if (ev.target.closest("button[data-action='show-hero-leaderboard']")) showHeroLeaderboardModal();
      if (ev.target.closest("button[data-action='show-weekly-journal']")) showWeeklyJournalModal();
    });
    if (state.userId && !state._locationIntervalStarted) {
      state._locationIntervalStarted = true;
      sendLocation();
      setInterval(sendLocation, 60000);
    }
    if (!state.voiceGreeted) {
      state.voiceGreeted = true;
      setTimeout(function () { playSfx("start"); }, 600);
    }
    setTimeout(checkMondayWeeklyPrompt, 800);
    applyAvatarGlowIfEligible();
  }

  /** 家长端护航：静默上报位置，每分钟由 setInterval 调用 */
  function sendLocation() {
    if (!navigator.geolocation || !state.userId) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        api(BACKEND_BASE + "/api/location", { method: "POST", body: { lat: pos.coords.latitude, lng: pos.coords.longitude } }).catch(() => {});
      },
      () => {},
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 60000 }
    );
  }

  function getSocket() {
    if (state.versus.socket && state.versus.socket.connected) return state.versus.socket;
    const origin = location.origin;
    const s = io(origin, { path: "/socket.io", transports: ["websocket", "polling"] });
    state.versus.socket = s;
    s.on("room_created", (data) => {
      state.versus.room_code = data.room_code;
      state.versus.room_id = data.room_id || data.room_code;
      showVersusCreate();
    });
    s.on("join_ok", () => showVersusWaitAsJoiner());
    s.on("join_failed", (data) => {
      const msg = $("#versusJoinMsg");
      if (msg) { msg.textContent = data.message || "加入失败"; msg.className = "versus-msg err"; }
    });
    s.on("opponent_joined", () => {
      const wait = $("#versusWaitText");
      const startBtn = $("#versusStartBtn");
      if (wait) wait.textContent = "对手已加入！";
      if (startBtn) { startBtn.classList.add("show"); startBtn.style.display = "block"; }
    });
    s.on("opponent_left", () => {
      state.mode = "versus";
      const msg = $("#versusWaitText") || $("#versusJoinMsg");
      if (msg) msg.textContent = "对方已离开";
      setTimeout(() => enterVersusMenu(), 1500);
    });
    s.on("game_start", (data) => {
      if (data && data.sequence != null) {
        state.versus.sequence = data.sequence;
        startVersusGame(data.sequence);
      } else if (typeof window.__onGameStart === "function") {
        window.__onGameStart();
      }
    });
    s.on("game_result", (data) => showVersusResult(data.your_result, data.time_ms));
    s.on("opponent_progress", (data) => {
      if (typeof window.__onOpponentProgress === "function") window.__onOpponentProgress(data.step);
    });
    s.on("join_game_room_ok", () => { if (typeof window.__onGameRoomOk === "function") window.__onGameRoomOk(); });
    s.on("join_game_room_failed", (data) => {
      showErrorModal((data && data.message) || "加入游戏房间失败，请重试。");
    });
    s.on("opponent_move", (data) => {
      if (typeof window.__onOpponentMove === "function") window.__onOpponentMove(data.tileIndex);
    });
    s.on("game_over", (data) => {
      const myId = s.id;
      const isLoser = data.loser_sid === myId;
      if (typeof window.__onGameOver === "function") window.__onGameOver(isLoser ? "lose" : "win");
    });
    s.on("disconnect", (reason) => {
      if (state.mode === "versus" && (state.matchApi.room_id || state.versus.room_id)) {
        showErrorModal("连接断开，请检查网络后重试。");
      }
    });
    s.on("magic_effect", (data) => {
      if (typeof window.__onMagicEffect === "function") window.__onMagicEffect(data.type || "smoke", data.duration || 3);
    });
    s.on("show_worship_animation", (data) => {
      runWorshipHearts();
      if (state.matchApi && state.matchApi.is_king) {
        showToast((data && data.coins_given) ? "获得来自小伙伴的能量，金币 +2！" : "收到膜拜啦！");
        triggerCrownJump();
      } else if (data && data.from_name) {
        showToast(data.from_name + " 正在膜拜大神！");
      }
    });
    s.on("trigger_king_arrival", () => {
      playKingArrivalSound();
      showKingArrivalSpotlight();
    });
    return s;
  }

  /** 森林之王进场：低沉震撼的登场音效 */
  function playKingArrivalSound() {
    try {
      const C = getAudioContext();
      if (C) {
        const g = C.createGain();
        g.connect(C.destination);
        g.gain.setValueAtTime(0.2, C.currentTime);
        g.gain.exponentialRampToValueAtTime(0.01, C.currentTime + 1.2);
        [110, 146.83, 98].forEach((freq, i) => {
          const o = C.createOscillator();
          o.connect(g);
          o.frequency.value = freq;
          o.type = "sine";
          const t = C.currentTime + i * 0.25;
          o.start(t);
          o.stop(t + 0.5);
        });
      }
    } catch (_) {}
  }

  /** 森林之王进场：聚光灯中心与王者头像/名字对齐，2.5 秒后平滑消失 */
  function showKingArrivalSpotlight() {
    let wrap = document.getElementById("kingSpotlightWrap");
    if (!wrap) {
      wrap = document.createElement("div");
      wrap.id = "kingSpotlightWrap";
      wrap.className = "king-spotlight-wrap";
      wrap.setAttribute("aria-hidden", "true");
      wrap.innerHTML =
        '<div class="king-spotlight-dim"></div>' +
        '<div class="king-spotlight-beam spotlight"></div>' +
        '<div class="king-spotlight-halo"></div>' +
        '<div class="king-spotlight-particles" id="kingSpotlightParticles"></div>';
      document.body.appendChild(wrap);
    }
    var anchor = document.getElementById("versusJoinerLine");
    if (anchor) {
      var rect = anchor.getBoundingClientRect();
      var centerX = rect.left + rect.width / 2;
      var centerY = rect.top + rect.height / 2;
      wrap.style.setProperty("--spotlight-x", centerX + "px");
      wrap.style.setProperty("--spotlight-y", centerY + "px");
    } else {
      wrap.style.setProperty("--spotlight-x", (window.innerWidth / 2) + "px");
      wrap.style.setProperty("--spotlight-y", (window.innerHeight * 0.42) + "px");
    }
    const particlesEl = document.getElementById("kingSpotlightParticles");
    if (particlesEl) {
      particlesEl.innerHTML = "";
      for (let i = 0; i < 24; i++) {
        const p = document.createElement("div");
        p.className = "king-spotlight-particle";
        p.style.left = 30 + Math.random() * 40 + "%";
        p.style.animationDelay = Math.random() * 1.5 + "s";
        p.style.animationDuration = 2 + Math.random() * 1.5 + "s";
        particlesEl.appendChild(p);
      }
    }
    wrap.classList.remove("king-spotlight-out");
    wrap.classList.add("king-spotlight-visible");
    setTimeout(() => {
      wrap.classList.add("king-spotlight-out");
      setTimeout(() => {
        wrap.classList.remove("king-spotlight-visible", "king-spotlight-out");
      }, 800);
    }, 2500);
  }

  /** 森林之王通关：全屏彩虹升起 + 小皮狂喜气泡 */
  function showRainbowCelebration() {
    var overlay = document.getElementById("rainbow-overlay");
    if (overlay) overlay.classList.add("rainbow-active");
    var guide = document.getElementById("guide-character");
    var bubble = document.getElementById("guide-bubble");
    if (bubble) {
      bubble.textContent = "哇！你创造了森林奇迹！看，是彩虹！";
      bubble.classList.add("is-visible");
    }
    setXiaopiEmotion("happy");
    setTimeout(function () {
      if (overlay) overlay.classList.remove("rainbow-active");
      if (bubble) bubble.classList.remove("is-visible");
    }, 5000);
  }

  /** 森林之王胜利：全屏金币皇冠雨 — 50–80 个掉落物、金色光芒、中心 3D 标题，4.5 秒后清理 */
  function launchVictoryRain() {
    var wrap = document.getElementById("victoryRainWrap");
    if (wrap) wrap.remove();
    wrap = document.createElement("div");
    wrap.id = "victoryRainWrap";
    wrap.className = "victory-rain-wrap";
    wrap.setAttribute("aria-hidden", "true");
    var glow = document.createElement("div");
    glow.className = "victory-rain-glow";
    var title = document.createElement("div");
    title.className = "victory-rain-title";
    title.textContent = "无敌森林王 绝赞胜利！";
    wrap.appendChild(glow);
    wrap.appendChild(title);
    var symbols = ["\uD83D\uDCB0", "\uD83E\uDEE9", "\uD83D\uDC51"];
    var count = 150 + Math.floor(Math.random() * 91);
    for (var i = 0; i < count; i++) {
      var el = document.createElement("div");
      el.className = "victory-rain-item";
      el.textContent = symbols[Math.floor(Math.random() * symbols.length)];
      el.style.left = Math.random() * 100 + "%";
      el.style.animationDuration = (3.5 + Math.random() * 1.5) + "s";
      el.style.animationDelay = Math.random() * 0.6 + "s";
      el.style.setProperty("--sway", (4 + Math.random() * 12).toFixed(0) + "px");
      wrap.appendChild(el);
    }
    document.body.appendChild(wrap);
    setTimeout(showRainbowCelebration, 200);
    setTimeout(function () {
      if (wrap.parentNode) wrap.parentNode.removeChild(wrap);
    }, 4500);
  }

  /** 森林之王勋章解锁：全屏深蓝夜空 + 粒子烟花（向上喷射、炸开、飘落）+ 嘭嘭闷响 + 小皮皇冠跳跃 */
  function playUltimateVictoryEffect() {
    var overlay = document.getElementById("kingFireworkOverlay");
    if (overlay) overlay.remove();
    overlay = document.createElement("div");
    overlay.id = "kingFireworkOverlay";
    overlay.className = "king-firework-overlay";
    overlay.setAttribute("aria-hidden", "true");
    var canvas = document.createElement("canvas");
    canvas.className = "king-firework-canvas";
    overlay.appendChild(canvas);
    var center = document.createElement("div");
    center.className = "king-firework-center";
    center.innerHTML = "<div class=\"king-firework-xiaopi-wrap\"><span class=\"king-firework-crown\" aria-hidden=\"true\">👑</span><span class=\"king-firework-avatar\" aria-hidden=\"true\">🦊</span></div><p class=\"king-firework-bubble\">神迹！你是唯一的森林之王！</p>";
    overlay.appendChild(center);
    document.body.appendChild(overlay);
    var w = window.innerWidth;
    var h = window.innerHeight;
    canvas.width = w;
    canvas.height = h;
    var ctx = canvas.getContext("2d");
    var particles = [];
    var colors = ["#ffd700", "#ff6b35", "#7FAF9A", "#ffeb3b", "#e91e63", "#00bcd4", "#fff"];
    function rand(a, b) { return a + Math.random() * (b - a); }
    function makeBurst(cx, cy) {
      var n = 35 + Math.floor(Math.random() * 25);
      for (var i = 0; i < n; i++) {
        var angle = Math.random() * Math.PI * 2;
        var speed = rand(80, 180);
        particles.push({
          x: cx, y: cy,
          vx: Math.cos(angle) * speed * 0.3,
          vy: Math.sin(angle) * speed * 0.3 - rand(100, 200),
          color: colors[Math.floor(Math.random() * colors.length)],
          life: 1,
          decay: rand(0.008, 0.02),
          size: rand(1.5, 3)
        });
      }
    }
    var gravity = 0.6;
    var burstQueue = [];
    var t0 = Date.now();
    for (var b = 0; b < 5; b++) {
      burstQueue.push({ t: 800 + b * 600, x: rand(w * 0.2, w * 0.8), y: h * 0.5 + rand(-80, 80) });
    }
    function playBoomSound() {
      try {
        var C = getAudioContext();
        if (!C) return;
        var g = C.createGain();
        g.connect(C.destination);
        g.gain.setValueAtTime(0.25, C.currentTime);
        g.gain.exponentialRampToValueAtTime(0.01, C.currentTime + 0.4);
        var o = C.createOscillator();
        o.connect(g);
        o.frequency.setValueAtTime(80, C.currentTime);
        o.frequency.exponentialRampToValueAtTime(40, C.currentTime + 0.3);
        o.type = "sine";
        o.start(C.currentTime);
        o.stop(C.currentTime + 0.35);
      } catch (_) {}
    }
    var boomPlayed = {};
    function loop() {
      if (!overlay.parentNode) return;
      var dt = 0.016;
      var elapsed = Date.now() - t0;
      burstQueue.forEach(function (b) {
        if (elapsed >= b.t && !boomPlayed[b.t]) {
          boomPlayed[b.t] = true;
          makeBurst(b.x, b.y);
          playBoomSound();
        }
      });
      ctx.fillStyle = "rgba(10, 20, 45, 0.25)";
      ctx.fillRect(0, 0, w, h);
      for (var i = particles.length - 1; i >= 0; i--) {
        var p = particles[i];
        p.vy += gravity * 60 * dt;
        p.vx *= 0.98;
        p.vy *= 0.98;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.life -= p.decay;
        if (p.life <= 0) { particles.splice(i, 1); continue; }
        ctx.globalAlpha = p.life;
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      if (elapsed < 5200) requestAnimationFrame(loop);
    }
    requestAnimationFrame(loop);
    setTimeout(function () {
      if (overlay.parentNode) overlay.remove();
    }, 5200);
  }

  /** 森林之王胜利：柔和庆典音（已由 playSfx('win') 替代原刺耳音） */
  function playVictoryRainSound() {
    try {
      var C = getAudioContext();
      if (C) {
        var g = C.createGain();
        g.connect(C.destination);
        g.gain.setValueAtTime(0.35, C.currentTime);
        g.gain.exponentialRampToValueAtTime(0.02, C.currentTime + 2);
        var freqs = [523.25, 659.25, 783.99, 1046.5];
        freqs.forEach(function (freq, i) {
          var o = C.createOscillator();
          o.connect(g);
          o.frequency.value = freq;
          o.type = "sine";
          var t = C.currentTime + i * 0.15;
          o.start(t);
          o.stop(t + 0.4);
        });
      }
    } catch (_) {}
  }

  /** 执行膜拜：仅非国王且未膜拜过时可调用；成功后播动画并广播 */
  function doWorship() {
    if (state.matchApi.worshipped || !state.matchApi.room_id) return;
    const btns = document.querySelectorAll(".btn-worship");
    btns.forEach((b) => { b.disabled = true; });
    api(BACKEND_BASE + "/api/worship", { method: "POST", body: { room_id: state.matchApi.room_id } })
      .then((r) => {
        if (!r || !r.ok) {
          btns.forEach((b) => { b.disabled = false; });
          return;
        }
        state.matchApi.worshipped = true;
        showWorshipBubbleGlobal();
        runWorshipHearts();
        getSocket().emit("worship_broadcast", {
          room_id: state.matchApi.room_id,
          from_name: r.from_name,
          to_name: r.to_name,
          coins_given: r.coins_given || 0,
        });
      })
      .catch(() => {
        btns.forEach((b) => { b.disabled = false; });
      });
  }

  function showWorshipBubbleGlobal() {
    const bubble = document.createElement("div");
    bubble.className = "worship-bubble worship-bubble-global";
    bubble.textContent = "膜拜大神！";
    document.body.appendChild(bubble);
    setTimeout(() => bubble.remove(), 1500);
  }

  function showToast(text) {
    const el = document.createElement("div");
    el.className = "versus-toast-king";
    el.setAttribute("aria-live", "polite");
    el.textContent = text;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 3000);
  }

  function runWorshipHearts() {
    const wrap = document.createElement("div");
    wrap.className = "worship-hearts-wrap";
    wrap.setAttribute("aria-hidden", "true");
    const symbols = ["❤️", "💛", "✨", "🌟"];
    for (let i = 0; i < 28; i++) {
      const p = document.createElement("div");
      p.className = "worship-heart";
      p.textContent = symbols[i % symbols.length];
      p.style.left = Math.random() * 100 + "%";
      p.style.animationDelay = Math.random() * 1.2 + "s";
      p.style.fontSize = (14 + Math.random() * 14) + "px";
      wrap.appendChild(p);
    }
    document.body.appendChild(wrap);
    setTimeout(() => wrap.remove(), 4000);
  }

  function triggerCrownJump() {
    const crowns = document.querySelectorAll(".king-crown");
    crowns.forEach((el) => {
      el.classList.add("king-crown-worship");
      setTimeout(() => el.classList.remove("king-crown-worship"), 1200);
    });
  }

  function enterVersusMenu() {
    state.mode = "versus";
    mount(tplVersusMenu);
    var findBtn = app.querySelector("[data-action='find-partner']");
    if (findBtn) {
      findBtn.addEventListener("click", function () {
        if (!state.userId || !state.user) {
          if (typeof showAuthLanding === "function") showAuthLanding();
          return;
        }
        findBtn.disabled = true;
        findBtn.textContent = "正在寻找伙伴…";
        var s = getSocket();
        if (!s || !s.connected) {
          findBtn.disabled = false;
          findBtn.innerHTML = "<span class=\"btn-ico\">🔍</span> 寻找伙伴";
          return;
        }
        var waitTimer = null;
        function clearWaitTimer() { if (waitTimer) { clearTimeout(waitTimer); waitTimer = null; } }
        function onMatched(data) {
          clearWaitTimer();
          s.off("matched", onMatched);
          s.off("find_partner_failed", onFail);
          s.off("find_partner_waiting", onWait);
          state.matchApi = {
            room_id: data.room_id,
            my_role: data.role,
            emoji_sequence: data.emoji_sequence,
            my_name: data.my_name || state.user,
            opponent_name: data.opponent_name || "小伙伴",
            is_king: !!data.is_king,
            opponent_is_king: !!data.opponent_is_king,
            useGameRooms: true,
          };
          startVersusGameRest(data.emoji_sequence, data.room_id, data.role);
        }
        function onFail(data) {
          clearWaitTimer();
          s.off("matched", onMatched);
          s.off("find_partner_failed", onFail);
          s.off("find_partner_waiting", onWait);
          findBtn.disabled = false;
          findBtn.innerHTML = "<span class=\"btn-ico\">🔍</span> 寻找伙伴";
          if (data && data.message) alert(data.message);
        }
        function onWait() {
          findBtn.textContent = "正在寻找伙伴…";
        }
        waitTimer = setTimeout(function () {
          clearWaitTimer();
          s.off("matched", onMatched);
          s.off("find_partner_failed", onFail);
          s.off("find_partner_waiting", onWait);
          findBtn.disabled = false;
          findBtn.innerHTML = "<span class=\"btn-ico\">🔍</span> 寻找伙伴";
          if (confirm("没有小伙伴在线，要和小皮一起练习吗？")) {
            api(BACKEND_BASE + "/api/room/create_virtual", { method: "POST" })
              .then(function (r) {
                state.matchApi = {
                  room_id: r.room_id,
                  my_role: "host",
                  emoji_sequence: r.emoji_sequence,
                  my_name: r.my_name || state.user,
                  opponent_name: "小皮",
                  is_king: !!r.is_king,
                  opponent_is_king: false,
                  useGameRooms: true,
                  virtualPartner: true,
                };
                startVersusGameRest(r.emoji_sequence, r.room_id, "host");
              })
              .catch(function () { alert("创建练习房间失败，请重试"); });
          }
        }, 15000);
        s.once("matched", onMatched);
        s.once("find_partner_failed", onFail);
        s.on("find_partner_waiting", onWait);
        s.emit("find_partner", { user_id: state.userId, username: state.user, my_name: state.user });
      });
    }
    $("button[data-action='create-room']").addEventListener("click", () => createRoomRest());
    $("button[data-action='join-room']").addEventListener("click", () => showVersusJoin());
    $("button[data-action='show-leaderboard']").addEventListener("click", () => showLeaderboardModal());
    $("button[data-action='vs-back']").addEventListener("click", goHome);
  }

  /** 勋章馆：森林守护者等级 + 已解锁勋章 */
  const MEDAL_NAMES = { brave_lion: "🦁 勇敢小狮子" };
  const LEGENDARY_KEYS = ["forest_warlord", "lightning_reflex", "king_of_jungle"];
  const LEGENDARY_VOICE = {
    forest_warlord: "哇！你解锁了传说中的森林战神勋章！",
    lightning_reflex: "哇！你解锁了传说中的闪电快手勋章！",
    king_of_jungle: "哇！你解锁了传说中的森林之王勋章！",
  };
  const LEGENDARY_EMOJI = { forest_warlord: "🔥", lightning_reflex: "⚡", king_of_jungle: "👑" };
  const LEGENDARY_NAMES = { forest_warlord: "森林战神", lightning_reflex: "闪电快手", king_of_jungle: "森林之王" };

  /** 本地勋章定义：id、名称、emoji、获取说明（点击提示） */
  const MEDAL_DEFINITIONS = [
    { id: "first_clear", name: "初出茅庐", emoji: "🏅", hint: "完成第一关即可获得" },
    { id: "combo5", name: "记忆小能手", emoji: "🌟", hint: "获得一次 5 连击即可获得" },
    { id: "lightning3", name: "闪电快手", emoji: "⚡", hint: "3 秒内连续点对 3 个目标即可获得" },
    { id: "total100", name: "森林战神", emoji: "🔥", hint: "累计答对总数达到 100 个即可获得" },
    { id: "king", name: "森林之王", emoji: "👑", hint: "成功通关「森林之王」难度模式即可获得" },
  ];
  const MEDAL_STORAGE_KEY = "forest_medals";
  const TOTAL_CORRECT_KEY = "forest_total_correct";
  const FIRST_CLEAR_KEY = "forest_first_clear";

  /** 从 localStorage 读取已解锁勋章 ID 列表 */
  function getUnlockedMedals() {
    try {
      var raw = localStorage.getItem(MEDAL_STORAGE_KEY);
      if (!raw) return [];
      var arr = JSON.parse(raw);
      return Array.isArray(arr) ? arr : [];
    } catch (_) { return []; }
  }

  /** 保存已解锁勋章列表到 localStorage */
  function setUnlockedMedals(ids) {
    try {
      localStorage.setItem(MEDAL_STORAGE_KEY, JSON.stringify(ids));
    } catch (_) {}
  }

  /** 刚解锁的勋章 ID（用于勋章墙打开时对该项做弹出动画），展示一次后清除 */
  var _lastUnlockedMedalId = null;

  /** 解锁勋章：若为新解锁则写入存储并播报小皮气泡；森林之王时触发全屏烟花 */
  function unlockMedal(id) {
    var list = getUnlockedMedals();
    if (list.indexOf(id) !== -1) return;
    list.push(id);
    setUnlockedMedals(list);
    _lastUnlockedMedalId = id;
    var def = MEDAL_DEFINITIONS.find(function (d) { return d.id === id; });
    var name = def ? def.name : id;
    var bubble = document.getElementById("guide-bubble");
    var guide = document.getElementById("guide-character");
    if (id === "king") {
      if (bubble) bubble.textContent = "神迹！你是唯一的森林之王！";
      if (bubble) bubble.classList.add("is-visible");
      if (guide) {
        guide.classList.remove("xiaopi-idle");
        guide.classList.add("is-talking", "xiaopi-king-crown");
      }
      playUltimateVictoryEffect();
      setTimeout(function () {
        if (bubble) bubble.classList.remove("is-visible");
        if (guide) {
          guide.classList.remove("is-talking", "xiaopi-king-crown");
          guide.classList.add("xiaopi-idle");
        }
      }, 5200);
      return;
    }
    if (bubble && guide) {
      bubble.textContent = "哇！你刚刚解锁了【" + name + "】勋章！快去勋章墙看看！";
      bubble.classList.add("is-visible");
      guide.classList.remove("xiaopi-idle");
      guide.classList.add("is-talking");
      setTimeout(function () {
        if (bubble) bubble.classList.remove("is-visible");
        if (guide) {
          guide.classList.remove("is-talking");
          guide.classList.add("xiaopi-idle");
        }
      }, 3500);
    }
  }

  /** 检查并触发勋章条件（在答对、通关等处调用） */
  function checkMedalConditions() {
    var list = getUnlockedMedals();
    if (list.indexOf("combo5") === -1 && (state.maxCombo || 0) >= 5) unlockMedal("combo5");
    if (list.indexOf("total100") === -1 && (state.totalCorrect || 0) >= 100) unlockMedal("total100");
    var times = state.lastCorrectTimes || [];
    if (times.length >= 3 && list.indexOf("lightning3") === -1) {
      var t1 = times[times.length - 3];
      var t2 = times[times.length - 1];
      if (t2 - t1 <= 3000) unlockMedal("lightning3");
    }
  }

  /** 全屏传说勋章解锁庆祝：彩带 + 大勋章 + 语音，点击后关闭并执行 onClose */
  function showLegendaryUnlock(medalKey, onClose) {
    const overlay = document.createElement("div");
    overlay.className = "legendary-unlock-overlay";
    overlay.innerHTML =
      '<div class="legendary-unlock-confetti" id="legendaryConfetti"></div>' +
      '<div class="legendary-unlock-content">' +
        '<p class="legendary-unlock-emoji">' + (LEGENDARY_EMOJI[medalKey] || "🏅") + '</p>' +
        '<p class="legendary-unlock-text">你解锁了传说中的' + (LEGENDARY_NAMES[medalKey] || medalKey) + '勋章！</p>' +
        '<button type="button" class="legendary-unlock-btn">知道了</button>' +
      '</div>';
    document.body.appendChild(overlay);
    const confettiEl = overlay.querySelector("#legendaryConfetti");
    if (confettiEl) runConfetti(confettiEl);
    overlay.querySelector(".legendary-unlock-btn").addEventListener("click", function() {
      overlay.remove();
      if (typeof onClose === "function") onClose();
    });
  }
  /** 根据 localStorage 渲染勋章墙：已解锁点亮（.medal-unlocked），未解锁灰色（.medal-locked）；点击显示获取方法提示 */
  function renderMedals(container) {
    if (!container) return;
    var unlocked = getUnlockedMedals();
    container.innerHTML = "";
    var grid = document.createElement("div");
    grid.className = "medals-grid";
    MEDAL_DEFINITIONS.forEach(function (def) {
      var unlockedNow = unlocked.indexOf(def.id) !== -1;
      var item = document.createElement("div");
      item.className = "medal-item " + (unlockedNow ? "medal-unlocked" : "medal-locked");
      item.dataset.medalId = def.id;
      item.dataset.hint = def.hint;
      item.setAttribute("role", "button");
      item.setAttribute("tabindex", "0");
      item.setAttribute("aria-label", def.name + "，" + (unlockedNow ? "已解锁" : "未解锁") + "，" + def.hint);
      var emoji = document.createElement("span");
      emoji.className = "medal-emoji";
      emoji.textContent = def.emoji;
      var name = document.createElement("span");
      name.className = "medal-name";
      name.textContent = def.name;
      item.appendChild(emoji);
      item.appendChild(name);
      if (unlockedNow && _lastUnlockedMedalId === def.id) {
        item.classList.add("medal-pop");
        setTimeout(function () {
          item.classList.remove("medal-pop");
          _lastUnlockedMedalId = null;
        }, 600);
      }
      item.addEventListener("click", function () {
        var tip = document.getElementById("medal-tooltip");
        if (tip) tip.remove();
        tip = document.createElement("div");
        tip.id = "medal-tooltip";
        tip.className = "medal-tooltip";
        tip.textContent = def.hint;
        document.body.appendChild(tip);
        var rect = item.getBoundingClientRect();
        tip.style.left = (rect.left + rect.width / 2) + "px";
        tip.style.top = (rect.top - 8) + "px";
        tip.style.transform = "translate(-50%, -100%)";
        setTimeout(function () { if (tip.parentNode) tip.remove(); }, 2500);
      });
      grid.appendChild(item);
    });
    container.appendChild(grid);
  }

  function showAchievementsModal() {
    const modal = document.getElementById("achievementsModal");
    const levelEl = document.getElementById("achievementsLevel");
    const winsEl = document.getElementById("achievementsWins");
    const medalsEl = document.getElementById("achievementsMedals");
    const btn = document.getElementById("achievementsClose");
    if (!modal || !levelEl || !medalsEl || !btn) return;
    levelEl.textContent = "森林见习生";
    winsEl.textContent = "胜场：0";
    medalsEl.innerHTML = "";
    modal.setAttribute("aria-hidden", "false");
    modal.classList.add("is-open");
    modal.classList.remove("is-closing");
    renderMedals(medalsEl);
    api(BACKEND_BASE + "/api/achievements").then((r) => {
      levelEl.textContent = r.level_name || "森林见习生";
      winsEl.textContent = "胜场：" + (r.wins || 0);
    }).catch(function () {});
    function close() {
      modal.classList.add("is-closing");
      modal.classList.remove("is-open");
      setTimeout(() => { modal.classList.remove("is-closing"); modal.setAttribute("aria-hidden", "true"); }, 250);
    }
    btn.addEventListener("click", close, { once: true });
  }

  /** 本周周一日期键（用于森林周刊「本周已读」标记） */
  function getWeekKey() {
    var d = new Date();
    d.setHours(0, 0, 0, 0);
    var day = d.getDay() || 7;
    d.setDate(d.getDate() - day + 1);
    var y = d.getFullYear();
    var m = String(d.getMonth() + 1).padStart(2, "0");
    var dayNum = String(d.getDate()).padStart(2, "0");
    return y + "-" + m + "-" + dayNum;
  }

  /** 撕开信封音效（周刊打开时） */
  function playEnvelopeTearSound() {
    try {
      var C = getAudioContext();
      if (!C) return;
      var g = C.createGain();
      g.connect(C.destination);
      g.gain.setValueAtTime(0.12, C.currentTime);
      g.gain.exponentialRampToValueAtTime(0.01, C.currentTime + 0.15);
      var o = C.createOscillator();
      o.connect(g);
      o.type = "sawtooth";
      o.frequency.setValueAtTime(120, C.currentTime);
      o.frequency.exponentialRampToValueAtTime(40, C.currentTime + 0.12);
      o.start(C.currentTime);
      o.stop(C.currentTime + 0.12);
    } catch (_) {}
  }

  /** 模拟小动物昵称（周榜人数不足时填充，让榜单更热闹） */
  var WEEKLY_FAKE_NAMES = [
    { name: "爱吃草的小兔", emoji: "🐰" },
    { name: "爱睡觉的树懒", emoji: "🦥" },
    { name: "爱跑步的小鹿", emoji: "🦌" },
    { name: "爱唱歌的小鸟", emoji: "🐦" },
    { name: "爱挖洞的獾", emoji: "🦡" },
    { name: "爱爬树的小猴", emoji: "🐵" },
    { name: "爱游泳的河狸", emoji: "🦫" },
    { name: "爱采蜜的小熊", emoji: "🐻" },
  ];

  /** 森林周刊弹窗：报纸质感 + 战报 / 荣誉墙 / 能力雷达 / 勤劳周榜；打开时撕信封音效、名次上升播报、前三名 7 日头像框 */
  function showWeeklyJournalModal() {
    var modal = document.getElementById("weeklyJournalModal");
    var content = document.getElementById("weeklyJournalContent");
    var subtitle = document.getElementById("weeklyJournalSubtitle");
    var loading = document.getElementById("weeklyJournalLoading");
    var btn = document.getElementById("weeklyJournalClose");
    if (!modal || !content || !btn) return;
    modal.setAttribute("aria-hidden", "false");
    modal.classList.add("is-open");
    modal.classList.remove("is-closing");
    if (loading) loading.style.display = "block";
    content.innerHTML = "";
    content.appendChild(loading);
    playEnvelopeTearSound();
    try { localStorage.setItem("forest_weekly_read_" + getWeekKey(), "1"); } catch (_) {}
    var weekKey = getWeekKey();
    Promise.all([api(BACKEND_BASE + "/api/weekly_summary"), api(BACKEND_BASE + "/api/weekly_leaderboard")])
      .then(function (results) {
        var r = results[0];
        var lb = results[1];
        if (loading) loading.remove();
        var totalMin = r.total_minutes != null ? r.total_minutes : 0;
        var gamesCount = r.games_count != null ? r.games_count : 0;
        var newMedals = r.new_medals || [];
        var radar = r.radar || { reaction: 50, memory: 50, patience: 50, activity: 50 };
        var weekStart = r.week_start || "";
        var weekEnd = r.week_end || "";
        if (subtitle) subtitle.textContent = (weekStart && weekEnd) ? weekStart + " ～ " + weekEnd + " · 荣誉回顾" : "上周 · 荣誉回顾";
        var html = "";
        html += "<section class=\"weekly-journal-section\"><h3 class=\"weekly-journal-h3\">本周战报</h3><p class=\"weekly-journal-p\">本周你一共守护了森林 <strong>" + totalMin + "</strong> 分钟，击败了 <strong>" + gamesCount + "</strong> 个迷雾挑战。</p></section>";
        html += "<section class=\"weekly-journal-section\"><h3 class=\"weekly-journal-h3\">荣誉墙</h3>";
        if (newMedals.length === 0) {
          html += "<p class=\"weekly-journal-p weekly-journal-muted\">上周暂无新勋章，继续加油哦！</p>";
        } else {
          html += "<ul class=\"weekly-journal-medals\">";
          newMedals.forEach(function (m) {
            html += "<li><span class=\"weekly-journal-medal-name\">" + (m.name || m.key) + "</span></li>";
          });
          html += "</ul>";
        }
        html += "</section>";
        html += "<section class=\"weekly-journal-section\"><h3 class=\"weekly-journal-h3\">能力分布</h3><div class=\"weekly-journal-radar-wrap\"><svg class=\"weekly-journal-radar\" viewBox=\"0 0 200 200\" aria-hidden=\"true\">";
        var cx = 100, cy = 100, R = 70;
        var labels = [{ key: "reaction", name: "反应力" }, { key: "memory", name: "记忆力" }, { key: "patience", name: "耐心" }, { key: "activity", name: "活跃度" }];
        for (var i = 0; i < 4; i++) {
          var angle = (i * 90 - 90) * Math.PI / 180;
          var x = cx + R * Math.cos(angle);
          var y = cy + R * Math.sin(angle);
          html += "<line x1=\"" + cx + "\" y1=\"" + cy + "\" x2=\"" + x + "\" y2=\"" + y + "\" class=\"weekly-radar-line\"/>";
        }
        var points = [];
        labels.forEach(function (l, i) {
          var v = Math.max(0, Math.min(100, radar[l.key] != null ? radar[l.key] : 50));
          var angle = (i * 90 - 90) * Math.PI / 180;
          var rVal = (v / 100) * R;
          points.push((cx + rVal * Math.cos(angle)).toFixed(1) + "," + (cy + rVal * Math.sin(angle)).toFixed(1));
        });
        html += "<polygon points=\"" + points.join(" ") + "\" class=\"weekly-radar-fill\"/>";
        labels.forEach(function (l, i) {
          var angle = (i * 90 - 90) * Math.PI / 180;
          var x = cx + (R + 18) * Math.cos(angle);
          var y = cy + (R + 18) * Math.sin(angle);
          html += "<text x=\"" + x + "\" y=\"" + y + "\" class=\"weekly-radar-label\" text-anchor=\"middle\">" + l.name + "</text>";
        });
        html += "</svg></div></section>";

        var list = (lb.leaderboard || []).slice();
        var totalCount = Math.max(lb.total_count || 0, list.length);
        while (list.length < 5 && list.length < 8) {
          var fake = WEEKLY_FAKE_NAMES[list.length % WEEKLY_FAKE_NAMES.length];
          var lastAcorns = list.length ? list[list.length - 1].acorns : 50;
          list.push({
            rank: list.length + 1,
            username: fake.name,
            acorns: Math.max(0, lastAcorns - 5 - list.length * 3),
            title: "森林居民",
            emoji: fake.emoji,
            isFake: true,
          });
        }
        var rankIcons = { 1: "👑", 2: "🥈", 3: "🥉" };
        html += "<section class=\"weekly-journal-section weekly-leaderboard-section\"><h3 class=\"weekly-journal-h3\">本周最勤劳的小松鼠</h3><div class=\"weekly-leaderboard-board\"><ul class=\"weekly-leaderboard-list\">";
        list.slice(0, 5).forEach(function (row, idx) {
          var rankNum = row.rank != null ? row.rank : idx + 1;
          var icon = rankNum <= 3 ? rankIcons[rankNum] : rankNum;
          var avatar = row.emoji || "🦊";
          html += "<li class=\"weekly-leaderboard-item\"><span class=\"weekly-lb-rank\">" + icon + "</span><span class=\"weekly-lb-avatar\" aria-hidden=\"true\">" + avatar + "</span><span class=\"weekly-lb-name\">" + (row.username || "小勇士") + "</span><span class=\"weekly-lb-acorns\">" + (row.acorns || 0) + " 松果</span><span class=\"weekly-lb-title\">" + (row.title || "森林居民") + "</span></li>";
        });
        html += "</ul>";
        var myRank = lb.my_rank;
        var myAcorns = lb.my_acorns != null ? lb.my_acorns : 0;
        var gapToAbove = lb.gap_to_above != null ? lb.gap_to_above : 0;
        var rankAboveNickname = lb.rank_above_nickname || "上一名";
        var myTitle = myRank === 1 ? "森林守护者" : myRank === 2 ? "勤劳小松鼠" : myRank === 3 ? "丛林巡逻员" : "森林居民";
        html += "<div class=\"weekly-leaderboard-you\"><span class=\"weekly-lb-rank\">" + (myRank != null ? myRank : "—") + "</span><span class=\"weekly-lb-avatar\" aria-hidden=\"true\">🦊</span><span class=\"weekly-lb-name\">你</span><span class=\"weekly-lb-acorns\">" + myAcorns + " 松果</span><span class=\"weekly-lb-title\">" + myTitle + "</span></div>";
        if (myRank != null && myRank > 1 && rankAboveNickname) {
          html += "<p class=\"weekly-journal-p weekly-leaderboard-hint\">再接再厉，下周你就能超过 <strong>" + rankAboveNickname + "</strong> 啦！" + (gapToAbove > 0 ? "（还差 " + gapToAbove + " 勤劳值）" : "") + "</p>";
        }
        html += "</div></section>";
        content.innerHTML = html;

        var dataWeekStart = weekStart || "";
        var lastRankKey = dataWeekStart ? "forest_weekly_rank_" + dataWeekStart : "";
        var prevRank = null;
        if (dataWeekStart) {
          try {
            var prevWeek = new Date(dataWeekStart);
            prevWeek.setDate(prevWeek.getDate() - 7);
            var prevWeekStart = prevWeek.toISOString ? prevWeek.toISOString().slice(0, 10) : "";
            if (prevWeekStart) prevRank = parseInt(localStorage.getItem("forest_weekly_rank_" + prevWeekStart), 10);
          } catch (_) {}
        }
        if (myRank != null && lastRankKey) try { localStorage.setItem(lastRankKey, String(myRank)); } catch (_) {}
        if (myRank != null && prevRank != null && myRank < prevRank && totalCount > 0) {
          var pct = Math.round((1 - (myRank - 1) / totalCount) * 100);
          if (pct > 0) {
            var bubble = document.getElementById("guide-bubble");
            var guide = document.getElementById("guide-character");
            if (bubble && guide) {
              bubble.textContent = "太牛了！你本周的勤劳度超过了 " + pct + "% 的小松鼠！";
              bubble.classList.add("is-visible");
              guide.classList.remove("xiaopi-idle");
              guide.classList.add("is-talking");
              setTimeout(function () {
                if (bubble) bubble.classList.remove("is-visible");
                if (guide) { guide.classList.remove("is-talking"); guide.classList.add("xiaopi-idle"); }
              }, 4000);
            }
          }
        }
        if (myRank != null && myRank >= 1 && myRank <= 3) {
          var until = Date.now() + 7 * 24 * 60 * 60 * 1000;
          try { localStorage.setItem("forest_avatar_glow_until", String(until)); } catch (_) {}
          applyAvatarGlowIfEligible();
        }
        if (lb.champion_can_choose_color) {
          setTimeout(showChampionLanternModal, 400);
        }
      })
      .catch(function () {
        if (loading) loading.remove();
        content.innerHTML = "<p class=\"weekly-journal-p weekly-journal-muted\">加载失败，请稍后再试。</p>";
      });
    function close() {
      modal.classList.add("is-closing");
      modal.classList.remove("is-open");
      setTimeout(function () { modal.classList.remove("is-closing"); modal.setAttribute("aria-hidden", "true"); }, 250);
    }
    btn.addEventListener("click", close, { once: true });
  }

  /** 若 localStorage 中 forest_avatar_glow_until 未过期，给小皮头像添加发光头像框样式 */
  function applyAvatarGlowIfEligible() {
    var until = 0;
    try { until = parseInt(localStorage.getItem("forest_avatar_glow_until"), 10) || 0; } catch (_) {}
    if (Date.now() > until) {
      try { localStorage.removeItem("forest_avatar_glow_until"); } catch (_) {}
      var guide = document.getElementById("guide-character");
      if (guide) guide.classList.remove("xiaopi-avatar-glow");
      return;
    }
    var guide = document.getElementById("guide-character");
    if (guide) guide.classList.add("xiaopi-avatar-glow");
  }

  /** 冠军特权弹窗：上周勤劳榜第一可选全森林灯笼颜色；选择后 POST 并应用 CSS 变量，播放华丽音效 */
  function showChampionLanternModal() {
    var modal = document.getElementById("championLanternModal");
    var optionsEl = document.getElementById("championLanternOptions");
    if (!modal || !optionsEl) return;
    optionsEl.innerHTML = "";
    LANTERN_COLOR_OPTIONS.forEach(function (opt) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "champion-lantern-btn";
      btn.dataset.key = opt.key;
      btn.dataset.rgba = opt.rgba;
      btn.innerHTML = "<span class=\"champion-lantern-emoji\">" + opt.emoji + "</span><span class=\"champion-lantern-name\">" + opt.name + "</span>";
      btn.style.setProperty("--preview-color", opt.rgba);
      btn.addEventListener("click", function () {
        var key = this.dataset.key;
        api(BACKEND_BASE + "/api/set_lantern_color", { method: "POST", body: { color: key } })
          .then(function (res) {
            applyLanternColor(res.lantern_color, res.lantern_champion_username, res.lantern_color_name);
            playChampionColorSound();
            modal.classList.add("is-closing");
            modal.classList.remove("is-open");
            modal.setAttribute("aria-hidden", "true");
            setTimeout(function () { modal.classList.remove("is-closing"); }, 250);
            var bubble = document.getElementById("guide-bubble");
            var guide = document.getElementById("guide-character");
            if (bubble && guide) {
              bubble.textContent = "全森林的灯笼都会变成你选的 " + (res.lantern_color_name || opt.name) + " 啦！";
              bubble.classList.add("is-visible");
              guide.classList.remove("xiaopi-idle");
              guide.classList.add("is-talking");
              setTimeout(function () {
                if (bubble) bubble.classList.remove("is-visible");
                if (guide) { guide.classList.remove("is-talking"); guide.classList.add("xiaopi-idle"); }
              }, 3500);
            }
          })
          .catch(function () {});
      });
      optionsEl.appendChild(btn);
    });
    modal.setAttribute("aria-hidden", "false");
    modal.classList.add("is-open");
    modal.classList.remove("is-closing");
  }

  /** 周一且本周未读周刊时：小皮拿信封跳动 + 气泡提示 */
  function checkMondayWeeklyPrompt() {
    var d = new Date();
    if (d.getDay() !== 1) return;
    var key = "forest_weekly_read_" + getWeekKey();
    try { if (localStorage.getItem(key)) return; } catch (_) { return; }
    var guide = document.getElementById("guide-character");
    var bubble = document.getElementById("guide-bubble");
    if (!guide || !bubble) return;
    guide.classList.add("xiaopi-weekly-envelope");
    bubble.textContent = "嘿！你的【森林周刊】寄到啦，快打开看看上周的英勇表现！";
    bubble.classList.add("is-visible");
    guide.classList.remove("xiaopi-idle");
    guide.classList.add("is-talking");
    setTimeout(function () {
      guide.classList.remove("xiaopi-weekly-envelope");
      bubble.classList.remove("is-visible");
      guide.classList.remove("is-talking");
      guide.classList.add("xiaopi-idle");
    }, 5000);
  }

  /** 宠物商店：金币买领结、果树，数据同步数据库 */
  const SHOP_ITEMS = [
    { key: "bow_red", name: "红色领结", price: 20, icon: "🎀" },
    { key: "bow_blue", name: "蓝色领结", price: 20, icon: "🎀" },
    { key: "bow_green", name: "绿色领结", price: 20, icon: "🎀" },
    { key: "tree_apple", name: "苹果树", price: 30, icon: "🌳" },
  ];
  function openShopModal() {
    const modal = document.getElementById("shopModal");
    const coinsEl = document.getElementById("shopCoins");
    const listEl = document.getElementById("shopList");
    const btn = document.getElementById("shopClose");
    if (!modal || !listEl || !btn) return;
    modal.setAttribute("aria-hidden", "false");
    modal.classList.add("is-open");
    modal.classList.remove("is-closing");
    function refresh() {
      Promise.all([api(BACKEND_BASE + "/api/wallet"), api(BACKEND_BASE + "/api/inventory")]).then(([wallet, inv]) => {
        const coins = wallet.coins != null ? wallet.coins : 0;
        const owned = (inv.items || []);
        if (coinsEl) coinsEl.textContent = coins;
        const homeCoins = $("#homeCoins");
        if (homeCoins) homeCoins.textContent = coins;
        listEl.innerHTML = SHOP_ITEMS.map((item) => {
          const has = owned.includes(item.key);
          return "<div class=\"shop-item\"><span class=\"shop-item-icon\">" + item.icon + "</span><span class=\"shop-item-name\">" + item.name + "</span><span class=\"shop-item-price\">" + item.price + " 金币</span>" + (has ? "<span class=\"shop-owned\">已拥有</span>" : "<button type=\"button\" class=\"shop-buy\" data-key=\"" + item.key + "\" data-cost=\"" + item.price + "\">购买</button>") + "</div>";
        }).join("");
        listEl.querySelectorAll(".shop-buy").forEach((b) => {
          b.addEventListener("click", () => {
            if (coins < (parseInt(b.dataset.cost, 10) || 0)) return;
            api(BACKEND_BASE + "/api/shop/buy", { method: "POST", body: { item_key: b.dataset.key } }).then(() => refresh()).catch((e) => showErrorModal((e && e.error) || "购买失败"));
          });
        });
      }).catch(() => { if (coinsEl) coinsEl.textContent = "?"; });
    }
    refresh();
    function close() {
      modal.classList.add("is-closing");
      modal.classList.remove("is-open");
      setTimeout(() => { modal.classList.remove("is-closing"); modal.setAttribute("aria-hidden", "true"); }, 250);
    }
    btn.addEventListener("click", close, { once: true });
  }

  /** 森林荣誉榜：首页入口，第一名👑+彩色名字，数据来自 game_rooms 胜场 */
  function showHonorBoardModal() {
    const modal = document.getElementById("honorBoardModal");
    const listEl = document.getElementById("honorBoardList");
    const btn = document.getElementById("honorBoardClose");
    if (!modal || !listEl || !btn) return;
    listEl.innerHTML = "<p class=\"leaderboard-loading\">加载中…</p>";
    modal.setAttribute("aria-hidden", "false");
    modal.classList.add("is-open");
    modal.classList.remove("is-closing");
    api(BACKEND_BASE + "/api/leaderboard").then((r) => {
      const list = (r && r.list) || [];
      if (list.length === 0) {
        listEl.innerHTML = "<p class=\"leaderboard-empty\">暂无战绩</p>";
      } else {
        listEl.innerHTML = list.map((item, i) => {
          const isFirst = i === 0;
          const rank = isFirst ? "👑 " + (i + 1) : (i + 1);
          const nameClass = isFirst ? "honor-first-name" : "";
          return "<div class=\"leaderboard-item " + (isFirst ? "honor-first" : "") + "\"><span class=\"rank\">" + rank + "</span><span class=\"name " + nameClass + "\">" + (item.username || "?") + "</span><span class=\"wins\">" + (item.wins || 0) + " 胜</span></div>";
        }).join("");
      }
    }).catch(() => { listEl.innerHTML = "<p class=\"leaderboard-empty\">加载失败</p>"; });
    function close() {
      modal.classList.add("is-closing");
      modal.classList.remove("is-open");
      setTimeout(() => { modal.classList.remove("is-closing"); modal.setAttribute("aria-hidden", "true"); }, 250);
    }
    btn.addEventListener("click", close, { once: true });
  }

  /** 森林英雄榜：前 5 名模拟头像+连击分，「你（YOU）」最高纪录高亮 */
  var HERO_LEADERBOARD_FAKE = [
    { avatar: "🦊", name: "小狐狸", combo: 22 },
    { avatar: "🐰", name: "小兔子", combo: 18 },
    { avatar: "🐼", name: "小熊猫", combo: 15 },
    { avatar: "🐱", name: "小猫咪", combo: 12 },
    { avatar: "🐶", name: "小狗狗", combo: 10 },
  ];
  function showHeroLeaderboardModal() {
    var modal = document.getElementById("heroLeaderboardModal");
    var listEl = document.getElementById("heroLeaderboardList");
    var btn = document.getElementById("heroLeaderboardClose");
    if (!modal || !listEl || !btn) return;
    var myCombo = state.maxCombo != null ? state.maxCombo : 0;
    var html = HERO_LEADERBOARD_FAKE.map(function (item, i) {
      var rank = i + 1;
      return "<div class=\"hero-leaderboard-item\"><span class=\"hero-rank\">" + rank + "</span><span class=\"hero-avatar\" aria-hidden=\"true\">" + item.avatar + "</span><span class=\"hero-name\">" + item.name + "</span><span class=\"hero-combo\">" + item.combo + " 连击</span></div>";
    }).join("");
    html += "<div class=\"hero-leaderboard-item hero-you\"><span class=\"hero-rank\">★</span><span class=\"hero-avatar\" aria-hidden=\"true\">🦊</span><span class=\"hero-name\">你（YOU）</span><span class=\"hero-combo\">" + myCombo + " 连击</span></div>";
    listEl.innerHTML = html;
    modal.setAttribute("aria-hidden", "false");
    modal.classList.add("is-open");
    modal.classList.remove("is-closing");
    var overlay = modal.querySelector(".room-modal-overlay");
    function close() {
      modal.classList.add("is-closing");
      modal.classList.remove("is-open");
      setTimeout(function () { modal.classList.remove("is-closing"); modal.setAttribute("aria-hidden", "true"); }, 250);
    }
    btn.addEventListener("click", close, { once: true });
    if (overlay) overlay.addEventListener("click", close, { once: true });
  }

  /** 排行榜：请求 /api/leaderboard 并显示弹窗 */
  function showLeaderboardModal() {
    const modal = document.getElementById("leaderboardModal");
    const listEl = document.getElementById("leaderboardList");
    const btn = document.getElementById("leaderboardClose");
    if (!modal || !listEl || !btn) return;
    listEl.innerHTML = "<p class=\"leaderboard-loading\">加载中…</p>";
    modal.setAttribute("aria-hidden", "false");
    modal.classList.add("is-open");
    modal.classList.remove("is-closing");
    api(BACKEND_BASE + "/api/leaderboard").then((r) => {
      const list = (r && r.list) || [];
      if (list.length === 0) {
        listEl.innerHTML = "<p class=\"leaderboard-empty\">暂无战绩</p>";
      } else {
        listEl.innerHTML = list.map((item, i) =>
          "<div class=\"leaderboard-item\"><span class=\"rank\">" + (i + 1) + "</span><span class=\"name\">" + (item.username || "?") + "</span><span class=\"wins\">" + (item.wins || 0) + " 胜</span></div>"
        ).join("");
      }
    }).catch(() => {
      listEl.innerHTML = "<p class=\"leaderboard-empty\">加载失败</p>";
    });
    function close() {
      modal.classList.add("is-closing");
      modal.classList.remove("is-open");
      setTimeout(() => {
        modal.classList.remove("is-closing");
        modal.setAttribute("aria-hidden", "true");
      }, 250);
    }
    btn.addEventListener("click", close, { once: true });
  }

  /** 创建房间：调用 /api/create_room，写入 MySQL game_rooms，自定义弹窗显示房间号并进入等待页 */
  function createRoomRest() {
    console.log("[创建房间] 发送请求 POST /api/create_room");
    api(BACKEND_BASE + "/api/create_room", { method: "POST", body: {} })
      .then((r) => {
        console.log("[创建房间] 成功", r);
        if (!r || !r.room_id) {
          console.warn("[创建房间] 跳转失败: 返回数据缺少 room_id", r);
          showErrorModal("创建成功但数据异常，请重试。");
          return;
        }
        state.matchApi = {
          room_id: r.room_id,
          my_role: "host",
          emoji_sequence: r.emoji_sequence,
          useGameRooms: true,
          is_king: !!r.is_king,
          my_name: r.my_name || state.user || "",
          opponent_is_king: false,
          opponent_name: "",
        };
        showRoomCreatedModal(r.room_id, () => showVersusCreateRest());
      })
      .catch((err) => {
        const msg = err && err.error ? err.error : "创建失败";
        console.warn("[创建房间] 失败:", err, "提示:", msg);
        showErrorModal(msg);
      });
  }

  /** 房主等待对手：显示房间号、房主/对手名（森林之王金色+皇冠），playing 时进入游戏；若自己是森林之王则播放王者音效 */
  function showVersusCreateRest() {
    mount(tplVersusCreate);
    if (state.matchApi.is_king) playKingSound();
    const codeEl = $("#versusRoomCode");
    if (codeEl) codeEl.textContent = state.matchApi.room_id || "------";
    const hostNameEl = $("#versusHostName");
    const joinerNameEl = $("#versusJoinerName");
    if (hostNameEl) {
      hostNameEl.textContent = state.matchApi.my_name || state.user || "房主";
      hostNameEl.classList.toggle("king-name", !!state.matchApi.is_king);
      if (state.matchApi.is_king && !hostNameEl.previousElementSibling) {
        const crown = document.createElement("span");
        crown.className = "king-crown";
        crown.setAttribute("aria-hidden", "true");
        crown.textContent = "👑";
        hostNameEl.parentElement.insertBefore(crown, hostNameEl);
      }
    }
    if (joinerNameEl) {
      joinerNameEl.textContent = "等待中";
      joinerNameEl.classList.remove("king-name");
      const prev = joinerNameEl.previousElementSibling;
      if (prev && prev.classList.contains("king-crown")) prev.remove();
    }
    const wait = $("#versusWaitText");
    if (wait) wait.textContent = "等待对手加入…";
    $("#versusStartBtn").style.display = "none";
    $("button[data-action='vs-leave']").addEventListener("click", () => {
      if (state.matchApi.pollTimerId) clearInterval(state.matchApi.pollTimerId);
      state.matchApi = { room_id: null, my_role: null, emoji_sequence: null, pollTimerId: null, useGameRooms: false };
      enterVersusMenu();
    });
    const statusUrl = state.matchApi.useGameRooms
      ? BACKEND_BASE + "/api/room/status?room_id=" + encodeURIComponent(state.matchApi.room_id)
      : BACKEND_BASE + "/api/match/status?room_id=" + encodeURIComponent(state.matchApi.room_id);
    function updatePlayers(r) {
      if (!r) return;
      if (hostNameEl) {
        hostNameEl.textContent = r.creator_name || state.matchApi.my_name || state.user || "房主";
        hostNameEl.classList.toggle("king-name", !!r.creator_is_king);
        let crown = hostNameEl.parentElement.querySelector(".king-crown");
        if (r.creator_is_king && !crown) {
          crown = document.createElement("span");
          crown.className = "king-crown";
          crown.setAttribute("aria-hidden", "true");
          crown.textContent = "👑";
          hostNameEl.parentElement.insertBefore(crown, hostNameEl);
        } else if (!r.creator_is_king && crown) crown.remove();
      }
      if (joinerNameEl) {
        joinerNameEl.textContent = r.joiner_name || "等待中";
        joinerNameEl.classList.toggle("king-name", !!r.joiner_is_king);
        let crown = joinerNameEl.parentElement.querySelector(".king-crown");
        if (r.joiner_is_king && !crown) {
          crown = document.createElement("span");
          crown.className = "king-crown";
          crown.setAttribute("aria-hidden", "true");
          crown.textContent = "👑";
          joinerNameEl.parentElement.insertBefore(crown, joinerNameEl);
        } else if (!r.joiner_is_king && crown) crown.remove();
      }
    }
    function ensureStartAndWorship(r) {
      if (!r || (r.status || "").toLowerCase() !== "playing") return;
      state.matchApi.opponent_is_king = !!r.joiner_is_king;
      state.matchApi.opponent_name = r.joiner_name || "";
      const startBtn = $("#versusStartBtn");
      if (startBtn) {
        startBtn.style.display = "block";
        startBtn.classList.add("show");
        if (!startBtn._startBound) {
          startBtn._startBound = true;
          startBtn.addEventListener("click", () => {
            if (state.matchApi.pollTimerId) clearInterval(state.matchApi.pollTimerId);
            state.matchApi.pollTimerId = null;
            startVersusGameRest(state.matchApi.emoji_sequence, state.matchApi.room_id, "host");
          });
        }
      }
      if (state.matchApi.opponent_is_king && !state.matchApi.is_king && !state.matchApi.worshipped) {
        addWorshipButtonIfMissing();
      }
      getSocket().emit("join_game_room", { room_id: state.matchApi.room_id, is_king: !!state.matchApi.is_king });
    }
    function addWorshipButtonIfMissing() {
      const line = document.getElementById("versusJoinerLine");
      if (!line || line.querySelector(".btn-worship")) return;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "btn-worship";
      btn.innerHTML = "🙏 膜拜";
      btn.setAttribute("aria-label", "膜拜大神");
      line.appendChild(btn);
      btn.addEventListener("click", () => doWorship());
    }
    function showWorshipBubbleInLine() {
      const line = document.getElementById("versusJoinerLine");
      if (!line) return;
      const bubble = document.createElement("div");
      bubble.className = "worship-bubble";
      bubble.textContent = "膜拜大神！";
      line.appendChild(bubble);
      setTimeout(() => bubble.remove(), 1500);
    }
    function check() {
      api(statusUrl)
        .then((r) => {
          updatePlayers(r);
          const st = (r.status || "").toLowerCase();
          if (st === "playing") {
            ensureStartAndWorship(r);
            return;
          }
        })
        .catch(() => {});
    }
    state.matchApi.pollTimerId = setInterval(check, 2000);
    check();
  }

  /** REST：轮询当前房间状态（用于更新双进度条与判定结束） */
  function checkMatchStatusRest(room_id, onStatus) {
    const url = state.matchApi && state.matchApi.useGameRooms
      ? BACKEND_BASE + "/api/room/status?room_id=" + encodeURIComponent(room_id)
      : BACKEND_BASE + "/api/match/status?room_id=" + encodeURIComponent(room_id);
    api(url)
      .then((r) => {
        if (r && r.status) r.status = String(r.status).toUpperCase();
        onStatus(r || {});
      })
      .catch(() => {});
  }

  function showVersusCreate() {
    mount(tplVersusCreate);
    const codeEl = $("#versusRoomCode");
    if (codeEl) codeEl.textContent = state.versus.room_code || "------";
    $("#versusStartBtn").addEventListener("click", () => {
      state.versus.socket.emit("start_game", { room_id: state.versus.room_id, room_code: state.versus.room_code });
    });
    $("button[data-action='vs-leave']").addEventListener("click", () => {
      state.versus.socket.emit("leave_room", { room_id: state.versus.room_id });
      enterVersusMenu();
    });
  }

  /** 加入房间：弹出输入框输入 6 位房间号，调用 /api/join_room，验证通过后进入游戏 */
  function showVersusJoin() {
    mount(tplVersusJoin);
    const input = $("#versusJoinCode");
    const msg = $("#versusJoinMsg");
    if (input) input.placeholder = "输入6位房间号";
    $("button[data-action='vs-do-join']").addEventListener("click", () => {
      const code = (input && input.value ? input.value : "").trim();
      if (!code) {
        if (msg) { msg.textContent = "请输入房间号"; msg.className = "versus-msg err"; }
        return;
      }
      console.log("[加入房间] 发送请求 room_id=" + code);
      api(BACKEND_BASE + "/api/join_room", { method: "POST", body: { room_id: code } })
        .then((r) => {
          console.log("[加入房间] 成功", r);
          if (!r || !r.room_id) {
            console.warn("[加入房间] 跳转失败: 返回数据缺少 room_id", r);
            if (msg) { msg.textContent = "加入成功但数据异常，请重试。"; msg.className = "versus-msg err"; }
            return;
          }
          state.matchApi = {
            room_id: r.room_id,
            my_role: "guest",
            emoji_sequence: r.emoji_sequence,
            useGameRooms: true,
            is_king: !!r.is_king,
            my_name: state.user || "",
            opponent_is_king: !!r.creator_is_king,
            opponent_name: r.creator_name || "",
          };
          if (r.creator_is_king) {
            const toast = document.createElement("div");
            toast.className = "versus-toast-king";
            toast.setAttribute("aria-live", "polite");
            toast.textContent = "哇！你遇到了传说中的森林之王！";
            document.body.appendChild(toast);
            setTimeout(() => toast.remove(), 3000);
          }
          startVersusGameRest(r.emoji_sequence, r.room_id, "guest");
        })
        .catch((err) => {
          const text = (err && err.error) ? err.error : "加入失败";
          console.warn("[加入房间] 失败:", err, "提示:", text);
          if (msg) { msg.textContent = text; msg.className = "versus-msg err"; }
        });
    });
    $("button[data-action='vs-back']").addEventListener("click", enterVersusMenu);
  }

  function showVersusWaitAsJoiner() {
    mount(tplVersusCreate);
    const codeEl = $("#versusRoomCode");
    if (codeEl) codeEl.textContent = state.versus.room_code || "------";
    const wait = $("#versusWaitText");
    if (wait) wait.textContent = "已加入，等待房主开始…";
    $("#versusStartBtn").style.display = "none";
    $("button[data-action='vs-leave']").addEventListener("click", () => {
      state.versus.socket.emit("leave_room", { room_id: state.versus.room_id });
      enterVersusMenu();
    });
  }

  function startVersusGame(sequence) {
    state.mode = "game";
    mount(tplGame);
    const stage = $("#gameStage");
    gameSeqVersus(stage, sequence);
  }

  /** REST 联机：双进度条 + 同步序列；并加入 Socket 房间实现实时点击同步与即时胜负 */
  function startVersusGameRest(sequence, room_id, my_role) {
    state.mode = "game";
    mount(tplGame);
    const stage = $("#gameStage");
    const s = getSocket();
    if (s && s.connected) {
      s.emit("join_game_room", { room_id: room_id, is_king: !!(state.matchApi && state.matchApi.is_king) });
    }
    gameSeqVersusRest(stage, sequence, room_id, my_role);
  }

  function showVersusResult(yourResult, timeMs) {
    state.mode = "versus";
    mount(tplVersusResult);
    if (yourResult === "win") {
      playEffect(state.matchApi && state.matchApi.is_king ? "congrats" : "win");
    } else {
      playEffect("lose");
      var loseOverlay = document.getElementById("versusResultLoseOverlay");
      if (loseOverlay) { loseOverlay.setAttribute("aria-hidden", "false"); }
    }
    const iconEl = $("#versusResultIcon");
    const title = $("#versusResultText");
    const timeEl = $("#versusResultTime");
    if (iconEl) iconEl.textContent = yourResult === "win" ? "👑" : "🥈";
    if (title) {
      title.textContent = yourResult === "win" ? "你赢了！" : "再接再厉";
      title.className = "versus-result-title " + (yourResult === "win" ? "win" : "lose");
    }
    if (timeEl) timeEl.textContent = timeMs != null ? "用时 " + (timeMs / 1000).toFixed(2) + " 秒" : "";
    $("button[data-action='vs-result-home']").addEventListener("click", () => showMoodThenGoHome());
    if (yourResult === "win" && state.matchApi && state.matchApi.is_king) {
      setTimeout(launchVictoryRain, 150);
    }
  }

  /** 顺序记忆选关卡：动物头像 1🐱 2🐶 3🐰 4🦊，选后进入 demo */
  function showSeqLevelPicker() {
    state.mode = "home";
    mount(tplSeqLevels);
    $("button[data-action='seq-levels-back']").addEventListener("click", goHome);
    const grid = $("#seqLevelsGrid");
    if (!grid) return;
    const unlocked = Math.min(4, Math.max(1, (state.seqLevelUnlocked != null ? state.seqLevelUnlocked : 4)));
    grid.querySelectorAll(".level-item").forEach((btn) => {
      const level = parseInt(btn.dataset.level, 10);
      if (level > unlocked) {
        btn.classList.add("locked");
        btn.classList.remove("level-unlocked");
      } else {
        btn.classList.remove("locked");
        btn.classList.add("level-unlocked");
      }
      btn.addEventListener("click", () => {
        if (btn.classList.contains("locked")) return;
        state.seqLevel = level === 1 ? 2 : level === 2 ? 3 : level === 3 ? 4 : 5;
        startDemo("seq");
      });
    });
  }

  function startDemo(game) {
    state.mode = "demo";
    state.game = game;
    mount(tplDemo);
    const stage = $("#demoStage");
    const startBtn = $("button[data-action='start']");

    if (game === "shape") demoShape(stage);
    if (game === "color") demoColor(stage);
    if (game === "seq") demoSeq(stage);
    if (game === "shadow") demoShadow(stage);

    startBtn.addEventListener("click", () => startGame(game));
  }

  function startGame(game) {
    state.mode = "game";
    state.game = game;
    state.gameStartTime = Date.now();
    state.levelStartTime = Date.now();
    state.levelWrongCount = 0;
    state.levelCorrectInRound = false;
    clearMoodStuckTimer();
    if (state.lastLevelFailTime && (Date.now() - state.lastLevelFailTime > 15000)) {
      setXiaopiMood("encouraging");
      state.lastLevelFailTime = null;
    }
    state.levelStuckTimerId = setTimeout(function () {
      state.levelStuckTimerId = null;
      if (state.currentMood !== "confused" && !state.levelCorrectInRound) setXiaopiMood("confused");
    }, 30000);
    mount(tplGame);
    const stage = $("#gameStage");
    if (game === "shape") gameShape(stage);
    if (game === "color") gameColor(stage);
    if (game === "seq") gameSeq(stage);
    if (game === "shadow") gameShadow(stage);
  }

  function endGame() {
    state.lastLevelFailTime = null;
    clearMoodStuckTimer();
    const gameType = state.game || "shape";
    const durationSeconds = state.gameStartTime ? (Date.now() - state.gameStartTime) / 1000 : 0;
    const sequenceLength = (state.game === "seq" && state.seqLevel) ? state.seqLevel : 0;
    api(BACKEND_BASE + "/api/game/complete", {
      method: "POST",
      body: { game_type: gameType, duration_seconds: durationSeconds, sequence_length: sequenceLength },
    })
      .then((res) => {
        var firstClear = localStorage.getItem(FIRST_CLEAR_KEY);
        if (!firstClear) {
          try { localStorage.setItem(FIRST_CLEAR_KEY, "1"); } catch (_) {}
          unlockMedal("first_clear");
        }
        const newlyUnlocked = res.newly_unlocked || [];
        const legendary = newlyUnlocked.find((k) => LEGENDARY_KEYS.includes(k));
        if (legendary) {
          if (legendary === "king_of_jungle") unlockMedal("king");
          showLegendaryUnlock(legendary, () => showConfettiAndWin(res.new_sticker, res.sticker_key));
        } else {
          showConfettiAndWin(res.new_sticker, res.sticker_key);
        }
      })
      .catch(() => {
        showConfettiAndWin(null);
      });
  }

  /** 获胜礼花 + 你真棒 / 获得新贴纸，约 2.5 秒后进入结束页 */
  function showConfettiAndWin(newSticker, stickerKey) {
    playVictorySound();
    triggerHaptic("victory");
    const wrap = document.createElement("div");
    wrap.className = "win-celebration-wrap";
    if (tplWinCelebration && tplWinCelebration.content) {
      wrap.appendChild(tplWinCelebration.content.cloneNode(true));
    }
    const emojiEl = wrap.querySelector("#winEmoji");
    const textEl = wrap.querySelector("#winText");
    const subEl = wrap.querySelector("#winSub");
    const confettiWrap = wrap.querySelector("#confettiWrap");
    if (emojiEl) emojiEl.textContent = newSticker ? newSticker : "👏";
    if (textEl) textEl.textContent = newSticker ? "获得新贴纸" : "你真棒";
    if (subEl) subEl.textContent = newSticker ? "去「我的家园」摆放吧" : "";
    if (confettiWrap) runConfetti(confettiWrap);
    app.appendChild(wrap);
    setTimeout(() => {
      if (wrap.parentNode) wrap.remove();
      state.mode = "end";
      mount(tplEnd);
      $("button[data-action='home']").addEventListener("click", () => showMoodThenGoHome());
      setTimeout(function () { showMaxComboSpeech("end"); }, 400);
      setTimeout(function () { showGlobalRankSpeech(state.maxCombo || 0, "end"); }, 1800);
    }, 2800);
  }

  /** 纯 CSS 礼花：在容器内生成多片纸屑下落动画 */
  function runConfetti(container) {
    const colors = ["#7FAF9A", "#A9C5B4", "#9BC6B0", "#C8D6CF", "#E3E6E2"];
    for (let i = 0; i < 50; i++) {
      const p = document.createElement("div");
      p.className = "confetti-piece";
      p.style.left = Math.random() * 100 + "%";
      p.style.animationDelay = Math.random() * 0.5 + "s";
      p.style.background = colors[Math.floor(Math.random() * colors.length)];
      p.style.transform = `rotate(${Math.random() * 360}deg)`;
      container.appendChild(p);
    }
  }

  /** 磁吸点：底图中彩虹旁、小房子顶等（百分比坐标 + 吸附半径） */
  function getHomeSnapZones() {
    return [
      { x: 78, y: 15, r: 12 },
      { x: 80, y: 45, r: 10 },
    ];
  }
  function applyMagneticSnap(percentX, percentY) {
    const zones = getHomeSnapZones();
    for (const z of zones) {
      const d = Math.sqrt((percentX - z.x) ** 2 + (percentY - z.y) ** 2);
      if (d < z.r) return [z.x, z.y];
    }
    return [percentX, percentY];
  }

  /** 我的家园：森林底图全屏 + 贴纸百分比坐标 + 磁吸 + 弹性 Pop */
  function showCollection() {
    state.mode = "collection";
    mount(tplCollection);
    const canvas = $("#homeCanvas");
    const warehouse = $("#homeWarehouse");
    const warehouseWrap = $("#homeWarehouseWrap");
    if (!canvas || !warehouse) return;
    canvas.innerHTML = "";
    warehouse.innerHTML = "";
    $("button[data-action='collection-back']").addEventListener("click", goHome);
    app.querySelector("button[data-action='open-shop']")?.addEventListener("click", () => openShopModal());


    api(BACKEND_BASE + "/api/wallet").then((r) => { const el = $("#homeCoins"); if (el) el.textContent = r.coins != null ? r.coins : 0; }).catch(() => {});

    api(BACKEND_BASE + "/api/get_home")
      .then((res) => {
        const placed = res.placed || [];
        const warehouseList = res.warehouse || ["🦁", "🌈", "🏠", "🌳"];
        placed.forEach((p) => addStickerToCanvas(canvas, warehouseWrap, p.sticker_type, p.x_pos, p.y_pos, p.id, false, p.scale_factor));
        warehouseList.forEach((emoji) => {
          const el = document.createElement("div");
          el.className = "home-warehouse-item";
          el.textContent = emoji;
          el.dataset.stickerType = emoji;
          el.setAttribute("aria-label", "贴纸");
          makeWarehouseItemDraggable(el, canvas, warehouseWrap);
          warehouse.appendChild(el);
        });
      })
      .catch(() => {
        ["🦁", "🌈", "🏠", "🌳"].forEach((emoji) => {
          const el = document.createElement("div");
          el.className = "home-warehouse-item";
          el.textContent = emoji;
          el.dataset.stickerType = emoji;
          makeWarehouseItemDraggable(el, canvas, warehouseWrap);
          warehouse.appendChild(el);
        });
      });
  }

  const HOME_STICKER_SCALE_MIN = 0.5;
  const HOME_STICKER_SCALE_MAX = 3.0;

  function applyStickerScale(el, scaleFactor) {
    const s = Math.max(HOME_STICKER_SCALE_MIN, Math.min(HOME_STICKER_SCALE_MAX, Number(scaleFactor) || 1));
    el.dataset.scaleFactor = s;
    el.style.transform = "translate(-50%, -50%) scale(" + s + ")";
  }

  function addStickerToCanvas(canvas, warehouseWrap, stickerType, percentX, percentY, id, playPop, scaleFactor) {
    const px = Math.max(0, Math.min(100, Number(percentX) || 0));
    const py = Math.max(0, Math.min(100, Number(percentY) || 0));
    const scale = Math.max(HOME_STICKER_SCALE_MIN, Math.min(HOME_STICKER_SCALE_MAX, Number(scaleFactor) || 1));
    const el = document.createElement("div");
    el.className = "home-sticker";
    el.dataset.stickerType = stickerType;
    el.dataset.percentX = px;
    el.dataset.percentY = py;
    el.dataset.scaleFactor = scale;
    if (id != null) el.dataset.id = id;
    el.textContent = stickerType;
    el.style.left = px + "%";
    el.style.top = py + "%";
    applyStickerScale(el, scale);
    if (playPop) {
      el.classList.add("home-sticker-pop");
      playPopSound();
      setTimeout(() => el.classList.remove("home-sticker-pop"), 400);
    }
    makeCanvasStickerDraggable(el, canvas, warehouseWrap);
    canvas.appendChild(el);
  }

  function makeWarehouseItemDraggable(el, canvas, warehouseWrap) {
    let ghost = null;
    let pointerId = null;
    el.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      pointerId = e.pointerId;
      const stickerType = el.dataset.stickerType;
      ghost = document.createElement("div");
      ghost.className = "home-sticker home-sticker-ghost";
      ghost.textContent = stickerType;
      ghost.style.left = e.clientX + "px";
      ghost.style.top = e.clientY + "px";
      document.body.appendChild(ghost);
      el.setPointerCapture(pointerId);

      function onMove(ev) {
        if (ghost && ev.pointerId === pointerId) {
          ghost.style.left = ev.clientX + "px";
          ghost.style.top = ev.clientY + "px";
        }
      }
      function onUp(ev) {
        if (ev.pointerId !== pointerId) return;
        try { el.releasePointerCapture(pointerId); } catch (_) {}
        pointerId = null;
        const rect = canvas.getBoundingClientRect();
        let percentX = ((ev.clientX - rect.left) / rect.width) * 100;
        let percentY = ((ev.clientY - rect.top) / rect.height) * 100;
        const inCanvas = percentX >= -5 && percentX <= 105 && percentY >= -5 && percentY <= 105;
        const wr = warehouseWrap.getBoundingClientRect();
        const inWarehouse = ev.clientY >= wr.top - 30;
        if (ghost) {
          ghost.remove();
          ghost = null;
        }
        if (inCanvas && !inWarehouse) {
          const [snapX, snapY] = applyMagneticSnap(percentX, percentY);
          addStickerToCanvas(canvas, warehouseWrap, stickerType, snapX, snapY, null, true);
          saveHomeStickers(canvas);
        }
        document.removeEventListener("pointermove", onMove);
        document.removeEventListener("pointerup", onUp);
      }
      document.addEventListener("pointermove", onMove);
      document.addEventListener("pointerup", onUp);
    });
  }

  let homeScaleSliderWrap = null;
  let homeScaleSliderSticker = null;

  function hideHomeScaleSlider(canvas) {
    if (homeScaleSliderWrap && homeScaleSliderWrap.parentNode) {
      homeScaleSliderWrap.remove();
      homeScaleSliderWrap = null;
    }
    if (homeScaleSliderSticker) {
      homeScaleSliderSticker.classList.remove("home-sticker--selected");
      homeScaleSliderSticker = null;
    }
  }

  function showHomeScaleSlider(canvas, el, warehouseWrap) {
    hideHomeScaleSlider(canvas);
    homeScaleSliderSticker = el;
    el.classList.add("home-sticker--selected");
    const wrap = document.createElement("div");
    wrap.className = "home-sticker-scale-wrap";
    const label = document.createElement("span");
    label.className = "home-sticker-scale-label";
    label.textContent = "大小";
    const input = document.createElement("input");
    input.type = "range";
    input.className = "home-sticker-scale-slider";
    input.min = HOME_STICKER_SCALE_MIN;
    input.max = HOME_STICKER_SCALE_MAX;
    input.step = 0.1;
    input.value = el.dataset.scaleFactor || 1;
    input.addEventListener("input", () => {
      const v = parseFloat(input.value);
      applyStickerScale(el, v);
    });
    input.addEventListener("change", () => {
      saveHomeStickers(canvas);
    });
    wrap.appendChild(label);
    wrap.appendChild(input);
    canvas.appendChild(wrap);
    homeScaleSliderWrap = wrap;
    wrap.style.left = (parseFloat(el.style.left) || 0) + "%";
    wrap.style.top = (parseFloat(el.style.top) || 0) + "%";
  }

  function makeCanvasStickerDraggable(el, canvas, warehouseWrap) {
    let pointerId = null;
    let startX = 0, startY = 0;
    el.addEventListener("pointerdown", (e) => {
      pointerId = e.pointerId;
      startX = e.clientX;
      startY = e.clientY;
      if (homeScaleSliderSticker && homeScaleSliderSticker !== el) hideHomeScaleSlider(canvas);
      el.setPointerCapture(pointerId);
      el.classList.add("home-sticker-pick");
    });
    el.addEventListener("pointermove", (e) => {
      if (pointerId !== e.pointerId) return;
      const rect = canvas.getBoundingClientRect();
      let percentX = ((e.clientX - rect.left) / rect.width) * 100;
      let percentY = ((e.clientY - rect.top) / rect.height) * 100;
      percentX = Math.max(0, Math.min(100, percentX));
      percentY = Math.max(0, Math.min(100, percentY));
      el.style.left = percentX + "%";
      el.style.top = percentY + "%";
      el.dataset.percentX = percentX;
      el.dataset.percentY = percentY;
    });
    el.addEventListener("pointerup", (e) => {
      if (pointerId !== e.pointerId) return;
      const moved = Math.abs(e.clientX - startX) + Math.abs(e.clientY - startY);
      pointerId = null;
      el.classList.remove("home-sticker-pick");
      const wr = warehouseWrap.getBoundingClientRect();
      const elRect = el.getBoundingClientRect();
      const centerY = elRect.top + elRect.height / 2;
      if (centerY >= wr.top - 20) {
        hideHomeScaleSlider(canvas);
        el.remove();
        saveHomeStickers(canvas);
        return;
      }
      const rect = canvas.getBoundingClientRect();
      let percentX = ((e.clientX - rect.left) / rect.width) * 100;
      let percentY = ((e.clientY - rect.top) / rect.height) * 100;
      percentX = Math.max(0, Math.min(100, percentX));
      percentY = Math.max(0, Math.min(100, percentY));
      const [snapX, snapY] = applyMagneticSnap(percentX, percentY);
      el.style.left = snapX + "%";
      el.style.top = snapY + "%";
      el.dataset.percentX = snapX;
      el.dataset.percentY = snapY;
      if (moved < 12) {
        if (homeScaleSliderSticker === el) hideHomeScaleSlider(canvas);
        else showHomeScaleSlider(canvas, el, warehouseWrap);
      } else {
        el.classList.add("home-sticker-drop");
        setTimeout(() => {
          el.classList.remove("home-sticker-drop");
          applyStickerScale(el, el.dataset.scaleFactor);
        }, 300);
        saveHomeStickers(canvas);
      }
    });
  }

  document.addEventListener("DOMContentLoaded", () => {
    document.body.addEventListener("pointerdown", (e) => {
      const canvas = $("#homeCanvas");
      if (!canvas || !canvas.contains(e.target)) return;
      if (e.target.closest(".home-sticker") || e.target.closest(".home-sticker-scale-wrap")) return;
      hideHomeScaleSlider(canvas);
    });
  });

  function saveHomeStickers(canvas) {
    const stickers = [];
    canvas.querySelectorAll(".home-sticker").forEach((el) => {
      const px = parseFloat(el.dataset.percentX);
      const py = parseFloat(el.dataset.percentY);
      if (isNaN(px) || isNaN(py)) return;
      const scale = parseFloat(el.dataset.scaleFactor);
      const scaleFactor = isNaN(scale) ? 1 : Math.max(HOME_STICKER_SCALE_MIN, Math.min(HOME_STICKER_SCALE_MAX, scale));
      stickers.push({
        sticker_type: el.dataset.stickerType,
        x_pos: Math.round(px * 10) / 10,
        y_pos: Math.round(py * 10) / 10,
        scale_factor: Math.round(scaleFactor * 100) / 100,
      });
    });
    api(BACKEND_BASE + "/api/save_home", { method: "POST", body: { stickers } }).catch(() => {});
  }

  /** 心情打卡：弹出超大开心/不开心，点击后 POST /api/mood 再执行 callback（如 goHome） */
  function showMoodThenGoHome() {
    const wrap = document.createElement("div");
    wrap.className = "mood-wrap";
    if (!tplMood || !tplMood.content) return goHome();
    wrap.appendChild(tplMood.content.cloneNode(true));
    app.appendChild(wrap);
    const happyBtn = wrap.querySelector('.mood-btn[data-mood="happy"]');
    const sadBtn = wrap.querySelector('.mood-btn[data-mood="sad"]');
    function submitAndGo(mood) {
      api(BACKEND_BASE + "/api/mood", { method: "POST", body: { mood } }).catch(() => {}).finally(() => {
        if (wrap.parentNode) wrap.remove();
        goHome();
      });
    }
    if (happyBtn) happyBtn.addEventListener("click", () => submitAndGo("happy"));
    if (sadBtn) sadBtn.addEventListener("click", () => submitAndGo("sad"));
  }

  // ---------- Demo: Shape（动物头像配对：拖动物到对应槽位） ----------
  async function demoShape(stage) {
    stage.innerHTML = "";
    const tile1 = mkTile(320, 110, 0);
    const tile2 = mkTile(320, 220, 1);
    const d1 = mkDrag(90, 110, 0, "circle");
    const d2 = mkDrag(90, 220, 1, "tri");
    stage.append(tile1, tile2, d1.el, d2.el);

    await sleep(250);
    await animateMove(d1.el, { x: 0, y: 0 }, { x: 230, y: 0 }, 1100);
    d1.el.style.transform = "";
    d1.el.style.left = "320px";
    d1.el.style.top = "110px";
    tile1.classList.add("done");
    await sleep(250);
    await animateMove(d2.el, { x: 0, y: 0 }, { x: 230, y: 0 }, 1100);
    d2.el.style.transform = "";
    d2.el.style.left = "320px";
    d2.el.style.top = "220px";
    tile2.classList.add("done");
  }

  // ---------- Game: Shape（动物头像配对） ----------
  function gameShape(stage) {
    stage.innerHTML = "";
    const tile1 = mkTile(340, 150, 0);
    const tile2 = mkTile(340, 300, 1);
    stage.append(tile1, tile2);

    const d1 = mkDrag(90, 150, 0, "circle");
    const d2 = mkDrag(90, 300, 1, "tri");
    stage.append(d1.el, d2.el);

    const targets = [
      { id: "circle", tile: tile1, x: 340, y: 150 },
      { id: "tri", tile: tile2, x: 340, y: 300 },
    ];

    let done = 0;
    function onCorrect(target, drag) {
      drag.lock();
      drag.snapTo(target.x, target.y);
      target.tile.classList.add("done");
      drag.el.classList.add("snap");
      done += 1;
      if (done >= 2) setTimeout(endGame, 500);
    }

    function onWrong(drag) {
      drag.bounceBack();
      // 重放示范：轻微提示（不加新元素，只做一次缓慢“靠近又回去”）
      drag.hint();
    }

    targets.forEach((t) => (t.tile.dataset.target = t.id));

    d1.onDrop = (pos) => {
      const hit = hitTest(d1.el, tile1) ? "circle" : hitTest(d1.el, tile2) ? "tri" : null;
      if (hit === "circle") onCorrect(targets[0], d1);
      else onWrong(d1);
    };
    d2.onDrop = (pos) => {
      const hit = hitTest(d2.el, tile1) ? "circle" : hitTest(d2.el, tile2) ? "tri" : null;
      if (hit === "tri") onCorrect(targets[1], d2);
      else onWrong(d2);
    };
  }

  // ---------- Demo: 影子对对碰（动物头像拖到对应槽位） ----------
  async function demoShadow(stage) {
    stage.innerHTML = "";
    const hint = document.createElement("p");
    hint.className = "shadow-demo-hint";
    hint.textContent = "把小动物拖到对应的家里";
    stage.appendChild(hint);
    const tile1 = mkTile(320, 120, 0);
    tile1.classList.add("shadow-tile");
    const tile2 = mkTile(320, 230, 1);
    tile2.classList.add("shadow-tile");
    const d1 = mkDrag(90, 120, 0, "circle");
    const d2 = mkDrag(90, 230, 1, "tri");
    stage.append(tile1, tile2, d1.el, d2.el);

    await sleep(400);
    await animateMove(d1.el, { x: 0, y: 0 }, { x: 230, y: 0 }, 1200);
    d1.el.style.transform = "";
    d1.el.style.left = "320px";
    d1.el.style.top = "120px";
    tile1.classList.add("done");
    d1.el.classList.add("snap");
    await sleep(300);
    await animateMove(d2.el, { x: 0, y: 0 }, { x: 230, y: 0 }, 1200);
    d2.el.style.transform = "";
    d2.el.style.left = "320px";
    d2.el.style.top = "230px";
    tile2.classList.add("done");
    d2.el.classList.add("snap");
  }

  // ---------- Game: 影子对对碰（动物头像拖到对应槽位） ----------
  function gameShadow(stage) {
    stage.innerHTML = "";
    const tile1 = mkTile(340, 150, 0);
    const tile2 = mkTile(340, 300, 1);
    tile1.classList.add("shadow-tile");
    tile2.classList.add("shadow-tile");
    stage.append(tile1, tile2);

    const d1 = mkDrag(90, 150, 0, "circle");
    const d2 = mkDrag(90, 300, 1, "tri");
    stage.append(d1.el, d2.el);

    const targets = [
      { id: "circle", tile: tile1, x: 340, y: 150 },
      { id: "tri", tile: tile2, x: 340, y: 300 },
    ];

    let done = 0;
    function onCorrect(target, drag) {
      playCorrectSound();
      drag.lock();
      drag.snapTo(target.x, target.y);
      target.tile.classList.add("done");
      drag.el.classList.add("snap");
      done += 1;
      if (done >= 2) setTimeout(endGame, 500);
    }

    function onWrong(drag) {
      playWrongSound();
      playFailureSound();
      shakeScreen(stage.closest(".screen") || document.body);
      drag.bounceBack();
      drag.hint();
    }

    targets.forEach((t) => (t.tile.dataset.target = t.id));

    d1.onDrop = (pos) => {
      const hit = hitTest(d1.el, tile1) ? "circle" : hitTest(d1.el, tile2) ? "tri" : null;
      if (hit === "circle") onCorrect(targets[0], d1);
      else onWrong(d1);
    };
    d2.onDrop = (pos) => {
      const hit = hitTest(d2.el, tile1) ? "circle" : hitTest(d2.el, tile2) ? "tri" : null;
      if (hit === "tri") onCorrect(targets[1], d2);
      else onWrong(d2);
    };
  }

  // ---------- Demo: Color（动物头像 + 颜色） ----------
  async function demoColor(stage) {
    stage.innerHTML = "";
    const target = document.createElement("div");
    target.className = "target-color target-avatar";
    target.style.background = COLORS.primary;
    target.textContent = SEQ_ANIMALS[0];
    stage.appendChild(target);

    const row = document.createElement("div");
    row.className = "choices";
    stage.appendChild(row);

    const c1 = mkChoice(COLORS.primary, 0);
    const c2 = mkChoice(COLORS.secondary, 1);
    const c3 = mkChoice(COLORS.neutral, 2);
    row.append(c1, c2, c3);

    await sleep(400);
    c1.animate([{ transform: "scale(1)" }, { transform: "scale(1.06)" }, { transform: "scale(1)" }], {
      duration: 900,
      easing: "ease",
    });
  }

  // ---------- Game: Color（动物头像 + 找相同颜色） ----------
  function gameColor(stage) {
    stage.innerHTML = "";
    const animalIdx = Math.floor(Math.random() * 3);
    const target = document.createElement("div");
    target.className = "target-color target-avatar";
    target.style.background = COLORS.primary;
    target.textContent = SEQ_ANIMALS[animalIdx];
    target.dataset.animal = String(animalIdx);
    stage.appendChild(target);

    const row = document.createElement("div");
    row.className = "choices";
    stage.appendChild(row);

    const options = shuffle([
      { color: COLORS.primary, ok: true, animal: animalIdx },
      { color: COLORS.secondary, ok: false, animal: (animalIdx + 1) % 3 },
      { color: COLORS.neutral, ok: false, animal: (animalIdx + 2) % 3 },
    ]);

    options.forEach((opt) => {
      const btn = mkChoice(opt.color, opt.animal);
      btn.addEventListener("click", async () => {
        if (opt.ok) {
          btn.style.borderColor = "rgba(155,198,176,0.85)";
          btn.style.background = "rgba(155,198,176,0.22)";
          await sleep(420);
          endGame();
          return;
        }
        // 错误：轻微“回弹”而非惩罚
        btn.animate(
          [{ transform: "translateX(0)" }, { transform: "translateX(-3px)" }, { transform: "translateX(3px)" }, { transform: "translateX(0)" }],
          { duration: 260, easing: "ease-out" }
        );
      });
      row.appendChild(btn);
    });
  }

  // ---------- Demo: Sequence ----------
  async function demoSeq(stage) {
    stage.innerHTML = "";
    const row = document.createElement("div");
    row.className = "seq-row";
    stage.appendChild(row);
    const dots = [mkDot(0), mkDot(1), mkDot(2)];
    dots.forEach((d) => row.appendChild(d));

    const seq = [0, 1, 2];
    await sleep(300);
    for (const idx of seq) {
      dots[idx].classList.add("flash");
      await sleep(520);
      dots[idx].classList.remove("flash");
      await sleep(160);
    }
  }

  // ---------- Game: Sequence（智能动态难度：2–4 个图标，10 秒内完成则下一关+1，连续失败 2 次则-1 并降速） ----------
  async function gameSeq(stage) {
    stage.innerHTML = "";
    const level = Math.min(5, Math.max(2, state.seqLevel));
    const sequence = Array.from({ length: level }, (_, i) => i);
    let flashDuration = 520;

    const row = document.createElement("div");
    row.className = "seq-row";
    stage.appendChild(row);
    const dots = sequence.map((_, i) => mkDot(i));
    dots.forEach((d) => row.appendChild(d));

    let input = [];
    let locked = true;

    async function playSequence() {
      locked = true;
      input = [];
      dots.forEach((d) => { d.classList.remove("done"); d.classList.add("seq-dot-idle"); });
      await sleep(240);
      for (const idx of sequence) {
        dots[idx].classList.remove("seq-dot-idle");
        dots[idx].classList.add("flash");
        await sleep(flashDuration);
        dots[idx].classList.remove("flash");
        dots[idx].classList.add("seq-dot-idle");
        await sleep(flashDuration > 600 ? 220 : 160);
      }
      locked = false;
    }

    function resetAndReplay() {
      locked = true;
      state.seqFailCount += 1;
      if (state.seqFailCount >= 2) {
        state.seqLevel = Math.max(2, state.seqLevel - 1);
        state.seqFailCount = 0;
        flashDuration = 700;
      }
      dots.forEach((d) => d.classList.remove("done"));
      playSequence();
    }

    dots.forEach((dot, idx) => {
      dot.addEventListener("click", async () => {
        if (locked) return;
        dot.classList.add("seq-dot-press");
        setTimeout(() => dot.classList.remove("seq-dot-press"), 180);
        input.push(idx);
        const pos = input.length - 1;
        if (sequence[pos] !== idx) {
          showDotSad(dot);
          playWrongSound();
          playFailureSound();
          shakeScreen(stage.closest(".screen") || document.body);
          await sleep(220);
          resetAndReplay();
          return;
        }
        dot.classList.remove("seq-dot-idle");
        playCorrectSound();
        showDotHappy(dot, idx % 3);
        state.seqFailCount = 0;
        dot.classList.add("done");
        if (input.length === sequence.length) {
          const elapsed = state.gameStartTime ? Date.now() - state.gameStartTime : 0;
          if (elapsed < 10000) state.seqLevel = Math.min(5, state.seqLevel + 1);
          await sleep(420);
          endGame();
        }
      });
    });

    await playSequence();
  }

  // ---------- 拟人化动物：待机呼吸/眨眼，点对灿烂笑+叫声，点错委屈+晃头 ----------
  function mkEmojiDot(emoji, animalIndex) {
    const el = document.createElement("button");
    el.className = "seq-dot seq-emoji seq-dot-idle";
    el.type = "button";
    el.textContent = emoji;
    el.setAttribute("aria-label", "顺序");
    el.dataset.animalIndex = String(animalIndex == null ? 0 : animalIndex);
    return el;
  }

  function showDotHappy(dot, animalIndex) {
    if (!dot) return;
    dot.classList.remove("emoji-sad", "seq-dot-idle");
    dot.classList.add("emoji-happy");
    playAnimalSound(animalIndex == null ? 0 : animalIndex);
    setTimeout(() => {
      dot.classList.remove("emoji-happy");
      if (!dot.classList.contains("done")) dot.classList.add("seq-dot-idle");
    }, 700);
  }

  function showDotSad(dot) {
    if (!dot) return;
    dot.classList.remove("emoji-happy", "seq-dot-idle");
    dot.classList.add("emoji-sad");
    setTimeout(() => {
      dot.classList.remove("emoji-sad");
      if (!dot.classList.contains("done")) dot.classList.add("seq-dot-idle");
    }, 800);
  }

  // ---------- Versus: Sequence（Emoji 序列，同步出题，对手进度条，game_done 带 user_id） ----------

  async function gameSeqVersus(stage, sequence) {
    if (!Array.isArray(sequence) || sequence.length !== 3) sequence = [0, 1, 2];
    stage.innerHTML = "";
    const totalSteps = 3;
    const opponentBar = document.createElement("div");
    opponentBar.className = "opponent-progress";
    opponentBar.innerHTML = '<span class="opponent-label">对手</span> <span class="opponent-step">0/' + totalSteps + "</span>";
    stage.appendChild(opponentBar);
    window.__onOpponentProgress = (step) => {
      const stepEl = opponentBar.querySelector(".opponent-step");
      if (stepEl) stepEl.textContent = (step || 0) + "/" + totalSteps;
    };

    const row = document.createElement("div");
    row.className = "seq-row";
    stage.appendChild(row);
    const dots = sequence.map((idx) => mkEmojiDot(SEQUENCE_EMOJIS[idx], idx));
    dots.forEach((d) => row.appendChild(d));

    let input = [];
    let locked = true;
    let versusStartTime = 0;
    const gameContainer = stage.closest(".screen") || document.body;

    async function playSequence() {
      locked = true;
      input = [];
      dots.forEach((d) => { d.classList.remove("done"); d.classList.add("seq-dot-idle"); });
      await sleep(240);
      for (const idx of sequence) {
        dots[idx].classList.remove("seq-dot-idle");
        dots[idx].classList.add("flash");
        await sleep(520);
        dots[idx].classList.remove("flash");
        dots[idx].classList.add("seq-dot-idle");
        await sleep(160);
      }
      locked = false;
      versusStartTime = Date.now();
    }

    function resetAndReplay() {
      locked = true;
      playWrongSound();
      playFailureSound();
      shakeScreen(gameContainer);
      dots.forEach((d) => d.classList.remove("done"));
      playSequence();
    }

    dots.forEach((dot, idx) => {
      dot.addEventListener("click", async () => {
        if (locked) return;
        dot.classList.add("seq-dot-press");
        setTimeout(() => dot.classList.remove("seq-dot-press"), 180);
        input.push(idx);
        const pos = input.length - 1;
        if (sequence[pos] !== idx) {
          showDotSad(dot);
          resetAndReplay();
          return;
        }
        dot.classList.remove("seq-dot-idle");
        playCorrectSound();
        showDotHappy(dot, idx);
        dot.classList.add("done");
        const s = state.versus.socket;
        if (s && pos < totalSteps) s.emit("progress_update", { room_id: state.versus.room_id, room_code: state.versus.room_code, step: input.length });
        if (input.length === sequence.length) {
          const timeMs = Date.now() - versusStartTime;
          await sleep(220);
          if (s) s.emit("game_done", { room_id: state.versus.room_id, room_code: state.versus.room_code, time_ms: timeMs, user_id: state.userId });
        }
      });
    });

    await playSequence();
  }

  /** REST 联机顺序记忆：双进度条、WebSocket 实时同步点击与即时胜负、update_score、轮询备份 */
  async function gameSeqVersusRest(stage, sequence, room_id, my_role) {
    if (!Array.isArray(sequence) || sequence.length !== 3) sequence = [0, 1, 2];
    stage.innerHTML = "";
    const totalSteps = 3;

    const statusBar = document.createElement("div");
    statusBar.className = "versus-status-bar";
    statusBar.textContent = "对战进行中";
    stage.appendChild(statusBar);

    const barsWrap = document.createElement("div");
    barsWrap.className = "match-bars";
    barsWrap.innerHTML =
      '<div class="match-bar-row"><span class="match-bar-avatar host" id="matchAvatar1">🦊</span><span class="match-bar-label host" id="matchLabel1">我</span><div class="match-bar-track"><div class="match-bar-fill host" id="matchHostBar" style="width:0%"></div></div></div>' +
      '<div class="match-bar-row"><span class="match-bar-avatar guest" id="matchAvatar2">🦊</span><span class="match-bar-label guest" id="matchLabel2">小伙伴</span><div class="match-bar-track"><div class="match-bar-fill guest" id="matchGuestBar" style="width:0%"></div></div><span class="vs-stars" id="vsOpponentStars" aria-hidden="true"></span></div>';
    if (my_role === "guest") {
      const l1 = $("#matchLabel1", barsWrap);
      const l2 = $("#matchLabel2", barsWrap);
      const a1 = $("#matchAvatar1", barsWrap);
      const a2 = $("#matchAvatar2", barsWrap);
      if (l1) l1.textContent = "小伙伴";
      if (l2) l2.textContent = "我";
      if (a1) a1.setAttribute("data-role", "opponent");
      if (a2) a2.setAttribute("data-role", "me");
    } else {
      $("#matchAvatar1", barsWrap).setAttribute("data-role", "me");
      $("#matchAvatar2", barsWrap).setAttribute("data-role", "opponent");
    }
    const opponentLabel = my_role === "guest" ? $("#matchLabel1", barsWrap) : $("#matchLabel2", barsWrap);
    const opponentAvatar = my_role === "guest" ? $("#matchAvatar1", barsWrap) : $("#matchAvatar2", barsWrap);
    const opponentStarsEl = $("#vsOpponentStars", barsWrap);
    const opponentRow = opponentLabel && opponentLabel.closest(".match-bar-row");
    if (opponentLabel && state.matchApi && state.matchApi.opponent_is_king) {
      opponentLabel.innerHTML = '<span class="king-crown">👑</span><span class="king-name">' + (opponentLabel.textContent || "小伙伴") + "</span>";
      if (!state.matchApi.is_king && opponentRow) {
        const worshipBtn = document.createElement("button");
        worshipBtn.type = "button";
        worshipBtn.className = "btn-worship btn-worship-inline";
        worshipBtn.innerHTML = "🙏 膜拜";
        worshipBtn.setAttribute("aria-label", "膜拜大神");
        if (state.matchApi.worshipped) worshipBtn.disabled = true;
        worshipBtn.addEventListener("click", () => doWorship());
        opponentRow.appendChild(worshipBtn);
      }
    }
    stage.appendChild(barsWrap);

    const hostBar = $("#matchHostBar");
    const guestBar = $("#matchGuestBar");
    function updateBars(host_score, guest_score) {
      if (hostBar) hostBar.style.width = (host_score / totalSteps) * 100 + "%";
      if (guestBar) guestBar.style.width = (guest_score / totalSteps) * 100 + "%";
    }

    let pollTimerId = null;
    let gameOver = false;
    function stopPolling() {
      if (pollTimerId) clearInterval(pollTimerId);
      pollTimerId = null;
      gameOver = true;
    }
    function poll() {
      if (gameOver) return;
      checkMatchStatusRest(room_id, (r) => {
        updateBars(r.host_score, r.guest_score);
        const st = (r.status || "").toUpperCase();
        if (st === "FINISHED" && r.winner_id != null) {
          stopPolling();
          const isWinner = r.winner_id === state.userId;
          if (isWinner) {
            api(BACKEND_BASE + "/api/mood", { method: "POST", body: { mood: "proud" } }).catch(() => {});
            showVersusResultRest("win");
          } else {
            showVersusResultRest("lose");
          }
        }
      });
    }
    pollTimerId = setInterval(poll, 2000);

    if (state.matchApi && state.matchApi.virtualPartner && my_role === "host" && guestBar && !gameOver) {
      var aiPercent = 0;
      var stepPct = 100 / totalSteps;
      var aiTimer = setInterval(function () {
        if (gameOver) { clearInterval(aiTimer); return; }
        aiPercent = Math.min(aiPercent + stepPct, 100);
        guestBar.style.width = aiPercent + "%";
        if (aiPercent >= 100) clearInterval(aiTimer);
      }, 2500);
    }

    const row = document.createElement("div");
    row.className = "seq-row";
    stage.appendChild(row);
    const dots = sequence.map((idx) => mkEmojiDot(SEQUENCE_EMOJIS[idx], idx));
    dots.forEach((d) => row.appendChild(d));

    const s = state.versus.socket;
    window.__onGameStart = () => { statusBar.textContent = "对战进行中"; };
    window.__onOpponentMove = (tileIndex) => {
      const i = parseInt(tileIndex, 10);
      if (dots[i]) {
        dots[i].classList.add("opponent-highlight");
        showDotHappy(dots[i], i);
        setTimeout(() => dots[i].classList.remove("opponent-highlight"), 600);
      }
    };
    if (s) {
      s.on("sync_game_state", function (data) {
        var score = data.score || 0;
        var combo = data.combo || 0;
        if (my_role === "host" && guestBar) guestBar.style.width = (score / totalSteps) * 100 + "%";
        else if (my_role === "guest" && hostBar) hostBar.style.width = (score / totalSteps) * 100 + "%";
        if (opponentAvatar) {
          opponentAvatar.classList.add("vs-avatar-bounce");
          setTimeout(function () { opponentAvatar.classList.remove("vs-avatar-bounce"); }, 400);
        }
        if (combo >= 2 && opponentStarsEl) {
          opponentStarsEl.textContent = "✨".repeat(Math.min(combo, 5));
          opponentStarsEl.removeAttribute("aria-hidden");
          setTimeout(function () { opponentStarsEl.setAttribute("aria-hidden", "true"); opponentStarsEl.textContent = ""; }, 800);
        }
      });
      s.on("opponent_left", function () {
        state.opponentDisconnected = true;
        var bubble = document.getElementById("guide-bubble");
        var guide = document.getElementById("guide-character");
        if (bubble) { bubble.textContent = "小伙伴去休息啦，我们继续加油！"; bubble.classList.add("is-visible"); }
        if (guide) { guide.classList.remove("xiaopi-idle"); guide.classList.add("is-talking"); }
        setTimeout(function () {
          if (bubble) bubble.classList.remove("is-visible");
          if (guide) { guide.classList.remove("is-talking"); guide.classList.add("xiaopi-idle"); }
        }, 3000);
        var aiBar = my_role === "host" ? guestBar : hostBar;
        if (aiBar && !gameOver) {
          var aiPercent = parseFloat(String(aiBar.style.width || "0").replace("%", "")) || 0;
          var stepPct = 100 / totalSteps;
          var aiTimer = setInterval(function () {
            if (gameOver) { clearInterval(aiTimer); return; }
            aiPercent = Math.min(aiPercent + stepPct, 100);
            aiBar.style.width = aiPercent + "%";
            if (aiPercent >= 100) clearInterval(aiTimer);
          }, 2500);
        }
      });
    }
    window.__onGameOver = (result) => {
      stopPolling();
      if (result === "win") api(BACKEND_BASE + "/api/mood", { method: "POST", body: { mood: "proud" } }).catch(() => {});
      showVersusResultRest(result);
    };
    const gameContainer = stage.closest(".screen") || document.body;
    function shuffleDots() {
      const order = [0, 1, 2];
      for (let i = order.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [order[i], order[j]] = [order[j], order[i]];
      }
      order.forEach((i) => row.appendChild(dots[i]));
    }
    window.__onMagicEffect = (type, duration) => {
      const el = gameContainer;
      el.classList.add("magic-" + type);
      if (type === "freeze") { locked = true; setTimeout(() => { locked = false; }, (duration || 1) * 1000); }
      if (type === "reverse") shuffleDots();
      setTimeout(() => el.classList.remove("magic-" + type), (duration || 3) * 1000);
    };

    const powerupDrop = document.createElement("button");
    powerupDrop.type = "button";
    powerupDrop.className = "vs-powerup-drop";
    powerupDrop.setAttribute("aria-label", "道具");
    powerupDrop.style.display = "none";
    stage.appendChild(powerupDrop);
    const powerupIcons = { smoke: "💨", reverse: "🔄", earthquake: "📳" };
    let powerupSpawned = false;
    setTimeout(() => {
      if (!s || !s.connected || powerupSpawned) return;
      powerupSpawned = true;
      s.emit("request_spawn", { room_id: room_id });
    }, 8000);
    if (s) {
      s.on("item_spawned", (data) => {
        powerupDrop.textContent = powerupIcons[data.type] || "?";
        powerupDrop.dataset.itemId = data.item_id || "";
        powerupDrop.classList.add("is-visible");
      });
      s.on("item_grabbed", () => {
        powerupDrop.classList.remove("is-visible");
      });
    }
    powerupDrop.addEventListener("click", () => {
      const id = powerupDrop.dataset.itemId;
      if (id && s && s.connected) {
        s.emit("grab_item", { room_id: room_id, item_id: id });
        powerupDrop.classList.remove("is-visible");
      }
    });

    let input = [];
    let locked = true;

    async function playSequence() {
      locked = true;
      input = [];
      dots.forEach((d) => { d.classList.remove("done"); d.classList.add("seq-dot-idle"); });
      await sleep(240);
      for (const idx of sequence) {
        dots[idx].classList.remove("seq-dot-idle");
        dots[idx].classList.add("flash");
        await sleep(520);
        dots[idx].classList.remove("flash");
        dots[idx].classList.add("seq-dot-idle");
        await sleep(160);
      }
      locked = false;
    }

    function resetAndReplay() {
      locked = true;
      playWrongSound();
      playFailureSound();
      shakeScreen(gameContainer);
      dots.forEach((d) => d.classList.remove("done"));
      playSequence();
    }

    dots.forEach((dot, idx) => {
      dot.addEventListener("click", async () => {
        if (locked) return;
        dot.classList.add("seq-dot-press");
        setTimeout(() => dot.classList.remove("seq-dot-press"), 180);
        input.push(idx);
        const pos = input.length - 1;
        if (sequence[pos] !== idx) {
          showDotSad(dot);
          if (s && s.connected) s.emit("wrong_tap", { room_id: room_id });
          resetAndReplay();
          return;
        }
        dot.classList.remove("seq-dot-idle");
        playCorrectSound();
        showDotHappy(dot, idx);
        dot.classList.add("done");
        if (s && s.connected) s.emit("player_move", { room_id: room_id, tileIndex: idx });
        const score = input.length;
        if (s && s.connected && state.matchApi && state.matchApi.useGameRooms) {
          s.emit("sync_game_state", {
            room_id: room_id,
            score: score,
            combo: score,
            player_name: state.matchApi.my_name || state.user || ""
          });
        }
        const scoreUrl = state.matchApi && state.matchApi.useGameRooms ? BACKEND_BASE + "/api/room/update_score" : BACKEND_BASE + "/api/match/update_score";
        api(scoreUrl, { method: "POST", body: { room_id, score } }).then(() => {
          checkMatchStatusRest(room_id, (r) => {
            updateBars(r.host_score, r.guest_score);
            const st = (r.status || "").toUpperCase();
            if (st === "FINISHED" && r.winner_id != null) {
              stopPolling();
              const isWinner = r.winner_id === state.userId;
              if (isWinner) {
                api(BACKEND_BASE + "/api/mood", { method: "POST", body: { mood: "proud" } }).catch(() => {});
                showVersusResultRest("win");
              } else {
                showVersusResultRest("lose");
              }
            }
          });
        }).catch(() => {});
        if (input.length === sequence.length && s && s.connected) {
          s.emit("finish_first", { room_id: room_id });
        }
      });
    });

    await playSequence();
  }

  /** 显示 REST 对战结果：合作向文案 + 击掌，不显示「你输了」；[先完成者] 闪电手，[对方] 记忆王 */
  function showVersusResultRest(yourResult) {
    state.mode = "versus";
    mount(tplVersusResult);
    if (yourResult === "win") {
      playEffect(state.matchApi && state.matchApi.is_king ? "congrats" : "win");
      triggerHaptic("victory");
    } else {
      playEffect("win");
      triggerHaptic("light");
    }
    var loseOverlay = document.getElementById("versusResultLoseOverlay");
    if (loseOverlay) loseOverlay.setAttribute("aria-hidden", "true");
    var myName = (state.matchApi && state.matchApi.my_name) ? state.matchApi.my_name : "我";
    var oppName = (state.matchApi && state.matchApi.opponent_name) ? state.matchApi.opponent_name : "小伙伴";
    var lightningName = yourResult === "win" ? myName : oppName;
    var memoryName = yourResult === "win" ? oppName : myName;
    var coopMsg = "哇！你们共同守护了森林！" + lightningName + " 是今日闪电手，" + memoryName + " 是今日记忆王！";
    var title = $("#versusResultText");
    var timeEl = $("#versusResultTime");
    var iconEl = $("#versusResultIcon");
    var highfiveEl = document.getElementById("versusResultHighfive");
    var coopMsgEl = document.getElementById("versusResultCoopMsg");
    if (title) { title.textContent = "共同守护森林！"; title.className = "versus-result-title win"; }
    if (timeEl) timeEl.textContent = "你们都是最棒的！";
    if (iconEl) iconEl.textContent = "🌲";
    if (coopMsgEl) coopMsgEl.textContent = coopMsg;
    if (highfiveEl) { highfiveEl.setAttribute("aria-hidden", "false"); highfiveEl.classList.add("versus-highfive-show"); }
    if (yourResult === "win") {
      if (state.matchApi && state.matchApi.is_king) setTimeout(launchVictoryRain, 150);
      api(BACKEND_BASE + "/api/achievements/check", { method: "POST" })
        .then((res) => {
          const unlocked = res.unlocked || [];
          const legendary = unlocked.find((k) => LEGENDARY_KEYS.includes(k));
          if (legendary) {
            if (legendary === "king_of_jungle") unlockMedal("king");
            showLegendaryUnlock(legendary, () => {});
          }
        })
        .catch(() => {});
    }
    $("button[data-action='vs-result-home']").addEventListener("click", () => showMoodThenGoHome());
  }

  // ---------- helpers：统一动物头像，禁止几何/数字 ----------
  function mkTile(x, y, animalIndex) {
    const i = animalIndex == null ? 0 : animalIndex % SEQ_ANIMALS.length;
    const el = document.createElement("div");
    el.className = "tile tile-avatar";
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    el.textContent = SEQ_ANIMALS[i];
    el.dataset.animal = String(i);
    return el;
  }

  function mkDrag(x, y, animalIndex, id) {
    const i = animalIndex == null ? 0 : animalIndex % SEQ_ANIMALS.length;
    const el = document.createElement("div");
    el.className = "draggable draggable-avatar";
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    el.dataset.id = id;
    el.dataset.animal = String(i);
    el.textContent = SEQ_ANIMALS[i];

    const origin = { x, y };
    let pointerId = null;
    let start = null;
    let locked = false;
    let hinting = false;

    function setPos(px, py) {
      el.style.left = `${px}px`;
      el.style.top = `${py}px`;
    }

    function lock() { locked = true; }

    function snapTo(tx, ty) { setPos(tx, ty); }

    function bounceBack() {
      el.animate([{ transform: "translate(0,0)" }, { transform: "translate(0,0)" }], { duration: 1 });
      // 轻微缓动回原位
      const from = { x: parseFloat(el.style.left), y: parseFloat(el.style.top) };
      const to = { x: origin.x, y: origin.y };
      const startT = performance.now();
      const dur = 260;
      function frame(now) {
        const t = Math.min(1, (now - startT) / dur);
        const k = ease(t);
        setPos(lerp(from.x, to.x, k), lerp(from.y, to.y, k));
        if (t < 1) requestAnimationFrame(frame);
      }
      requestAnimationFrame(frame);
    }

    async function hint() {
      if (hinting || locked) return;
      hinting = true;
      await sleep(180);
      el.animate([{ transform: "translateX(0)" }, { transform: "translateX(2px)" }, { transform: "translateX(0)" }], {
        duration: 220,
        easing: "ease-out",
      });
      hinting = false;
    }

    el.addEventListener("pointerdown", (ev) => {
      if (locked) return;
      pointerId = ev.pointerId;
      el.setPointerCapture(pointerId);
      start = { x: ev.clientX, y: ev.clientY, left: parseFloat(el.style.left), top: parseFloat(el.style.top) };
    });
    el.addEventListener("pointermove", (ev) => {
      if (locked) return;
      if (pointerId !== ev.pointerId || !start) return;
      const dx = ev.clientX - start.x;
      const dy = ev.clientY - start.y;
      setPos(start.left + dx, start.top + dy);
    });
    el.addEventListener("pointerup", (ev) => {
      if (locked) return;
      if (pointerId !== ev.pointerId) return;
      pointerId = null;
      start = null;
      if (typeof api.onDrop === "function") api.onDrop({ x: ev.clientX, y: ev.clientY });
    });

    const api = { el, onDrop: null, lock, snapTo, bounceBack, hint };
    return api;
  }

  function hitTest(a, b) {
    const ra = a.getBoundingClientRect();
    const rb = b.getBoundingClientRect();
    const ax = ra.left + ra.width / 2;
    const ay = ra.top + ra.height / 2;
    return ax >= rb.left && ax <= rb.right && ay >= rb.top && ay <= rb.bottom;
  }

  function mkChoice(color, animalIndex) {
    const i = animalIndex == null ? 0 : animalIndex % SEQ_ANIMALS.length;
    const el = document.createElement("button");
    el.className = "choice choice-avatar";
    el.type = "button";
    el.style.background = color;
    el.style.borderColor = "rgba(200,214,207,0.85)";
    el.textContent = SEQ_ANIMALS[i];
    el.dataset.animal = String(i);
    el.setAttribute("aria-label", SEQ_ANIMAL_LABELS[i] || "选择");
    return el;
  }

  function mkDot(animalIndex) {
    const i = animalIndex == null ? 0 : Math.min(animalIndex, SEQ_ANIMALS.length - 1);
    const el = document.createElement("button");
    el.className = "seq-dot seq-emoji seq-dot-idle";
    el.type = "button";
    el.textContent = SEQ_ANIMALS[i];
    el.setAttribute("aria-label", SEQ_ANIMAL_LABELS[i] || "顺序");
    el.dataset.animalIndex = String(i);
    return el;
  }

  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function svgCircle(fillClass) {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 100 100");
    svg.classList.add("shape");
    const c = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    c.setAttribute("cx", "50");
    c.setAttribute("cy", "50");
    c.setAttribute("r", "26");
    c.setAttribute("class", fillClass);
    svg.appendChild(c);
    return svg;
  }

  function svgTriangle(fillClass) {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 100 100");
    svg.classList.add("shape");
    const p = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
    p.setAttribute("points", "50,22 80,78 20,78");
    p.setAttribute("class", fillClass);
    svg.appendChild(p);
    return svg;
  }

  /** 影子对对碰：用于右侧“影子”的深色圆形/三角形 SVG */
  function svgCircleShadow() {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 100 100");
    svg.classList.add("shape", "shape-shadow");
    const c = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    c.setAttribute("cx", "50");
    c.setAttribute("cy", "50");
    c.setAttribute("r", "26");
    svg.appendChild(c);
    return svg;
  }

  function svgTriangleShadow() {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 100 100");
    svg.classList.add("shape", "shape-shadow");
    const p = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
    p.setAttribute("points", "50,22 80,78 20,78");
    svg.appendChild(p);
    return svg;
  }

  /** 抚摸小皮时的气泡文案（随机） */
  var PET_BUBBLE_TEXTS = ["好舒服呀~", "嘿嘿，最喜欢你了！"];
  /** 雨天彩蛋：小皮撑伞时的随机台词 */
  var RAIN_BUBBLE_TEXTS = [
    "外面下雨啦，幸好我有小花伞！你也别淋湿哦~",
    "滴滴答答，和小皮一起听雨吧～",
    "下雨天也要开开心心哦！",
    "记得带伞呀，别感冒啦~",
    "雨过天晴就会看到彩虹啦！"
  ];

  /** 小皮点击：5 次连点切换雨天模式；否则抚摸互动（呼噜 + 爱心 + 气泡），防抖 800ms */
  /** 小皮跳到横条上跑一圈再回去（仅首页） */
  function triggerXiaopiRunOnBar() {
    var container = document.getElementById("guide-character");
    if (!container) return;
    container.classList.remove("xiaopi-run-bar-mid", "xiaopi-run-bar-back");
    container.classList.add("xiaopi-run-bar");
    setTimeout(function () {
      container.classList.add("xiaopi-run-bar-mid");
    }, 700);
    setTimeout(function () {
      container.classList.remove("xiaopi-run-bar-mid");
      container.classList.add("xiaopi-run-bar-back");
    }, 1400);
    setTimeout(function () {
      container.classList.remove("xiaopi-run-bar", "xiaopi-run-bar-mid", "xiaopi-run-bar-back");
    }, 2200);
  }

  function initGuideCharacter() {
    var avatar = document.getElementById("guide-avatar");
    var container = document.getElementById("guide-character");
    var bubble = document.getElementById("guide-bubble");
    if (!avatar || !container) return;
    var petDebounce = 0;
    avatar.addEventListener("click", function () {
      if (document.body.classList.contains("page-home")) {
        state._xiaopiRunCount = (state._xiaopiRunCount || 0) + 1;
        if (state._xiaopiRunCount % 2 === 0) {
          triggerXiaopiRunOnBar();
          return;
        }
      }
      var now = Date.now();
      if (now - state.rainTapLastTime > 2000) state.rainTapCount = 0;
      state.rainTapCount++;
      state.rainTapLastTime = now;
      if (state.rainTapCount >= 5) {
        state.rainTapCount = 0;
        state.isRaining = !state.isRaining;
        if (state.isRaining) applyRainMode(); else removeRainMode();
        return;
      }
      if (now - petDebounce < 800) return;
      petDebounce = now;
      playPurrSound();
      spawnHeartParticle();
      if (bubble) {
        var petText;
        if (state.isRaining)
          petText = RAIN_BUBBLE_TEXTS[Math.floor(Math.random() * RAIN_BUBBLE_TEXTS.length)];
        else if (typeof getTimeState !== "undefined" && getTimeState() === "night")
          petText = NIGHT_BUBBLE_TEXTS[Math.floor(Math.random() * NIGHT_BUBBLE_TEXTS.length)];
        else
          petText = PET_BUBBLE_TEXTS[Math.floor(Math.random() * PET_BUBBLE_TEXTS.length)];
        bubble.textContent = petText;
        bubble.classList.add("is-visible");
        setTimeout(function () {
          if (bubble && !container.classList.contains("xiaopi-happy") && !container.classList.contains("xiaopi-shy")) bubble.classList.remove("is-visible");
        }, 2000);
      }
      container.classList.remove("xiaopi-pet");
      avatar.offsetHeight;
      container.classList.add("xiaopi-pet");
      setTimeout(function () { container.classList.remove("xiaopi-pet"); }, 500);
    });
  }

  /** 森林广播站：每 3–5 分钟随机一条温馨提示，滑入展示 8 秒后渐隐，出现时播放轻微叮铃 */
  function initForestBroadcast() {
    var el = document.getElementById("forest-broadcast");
    var textEl = document.getElementById("forestBroadcastText");
    if (!el || !textEl) return;
    var hideTimer = null;
    function showOne() {
      el.classList.remove("is-visible", "is-fadeout");
      el.setAttribute("aria-hidden", "false");
      var tips = broadcastTips && broadcastTips.length ? broadcastTips.slice() : ["小皮提醒：玩得开心，也要记得休息哦～"];
      if (state.lanternChampionUsername && state.lanternColorName) {
        tips.unshift("本周森林色彩由冠军 " + state.lanternChampionUsername + " 选定为 " + state.lanternColorName + "！大家一起享受美景吧！");
      }
      textEl.textContent = tips[Math.floor(Math.random() * tips.length)];
      el.offsetHeight;
      el.classList.add("is-visible");
      playBroadcastChime();
      if (hideTimer) clearTimeout(hideTimer);
      hideTimer = setTimeout(function () {
        hideTimer = null;
        el.classList.add("is-fadeout");
        el.classList.remove("is-visible");
        setTimeout(function () {
          el.setAttribute("aria-hidden", "true");
        }, 520);
      }, 8000);
    }
    function scheduleNext() {
      var minMs = 3 * 60 * 1000;
      var maxMs = 5 * 60 * 1000;
      var delay = minMs + Math.random() * (maxMs - minMs);
      setTimeout(function () {
        showOne();
        scheduleNext();
      }, delay);
    }
    scheduleNext();
  }

  initBGM();
  initGuideCharacter();
  initForestBroadcast();
  resetIdleTimer();
  initAuthClickDelegation();

  // boot: 先显示登录/注册入口，避免白屏；再检查登录状态，已登录则切到游戏首页
  try {
    showAuthLanding();
  } catch (e) {
    bindAuthLandingButtons();
  }
  bindAuthLandingButtons();
  api(BACKEND_BASE + "/api/me")
    .then((data) => {
      state.user = data.username;
      state.userId = data.user_id;
      applyLanternColor(
        data.lantern_color || "warm_yellow",
        data.lantern_champion_username || null,
        null
      );
      goHome();
    })
    .catch(() => {});
})();


