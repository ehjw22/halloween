import { fetchLeaderboard, getStudentSession, submitScore } from "./session.js";

const GAMES = ["clicker", "memory", "catch"];
const ICONS = ["🎃", "🦇", "👻", "🍬", "💀", "🕸️", "🐱", "🌙", "🧛", "🧪", "🕯️", "🦉"];
const CLICKER_KEY = "scream-clicker-v2";

const DIFFS = {
  easy: { pairs: 6, cols: 4, label: "Easy" },
  medium: { pairs: 8, cols: 4, label: "Medium" },
  hard: { pairs: 12, cols: 6, label: "Difficult" },
};

const UPGRADES = [
  { id: "bite", name: "Bigger bites", blurb: "More candy per tap.", base: 20, grow: 1.18 },
  { id: "spirits", name: "Spirit helpers", blurb: "Candy each second.", base: 50, grow: 1.22 },
  { id: "crit", name: "Jackpot slice", blurb: "Chance of a 7× tap.", base: 120, grow: 1.25 },
  { id: "fortune", name: "Candy moon", blurb: "Boosts all candy earned.", base: 400, grow: 1.28 },
];

const ACHIEVES = [
  { id: "first", name: "First nibble", test: (s) => s.candy >= 1 || s.lifetime >= 1 },
  { id: "hundred", name: "Pocket full", test: (s) => s.lifetime >= 100 },
  { id: "helpers", name: "Haunted crew", test: (s) => s.upgrades.spirits >= 5 },
  { id: "bites", name: "Iron jaw", test: (s) => s.upgrades.bite >= 10 },
  { id: "prestige", name: "Cursed again", test: (s) => s.prestige >= 1 },
  { id: "rich", name: "Treat hoard", test: (s) => s.lifetime >= 10000 },
];

function localBest(id) {
  return Number(localStorage.getItem(`scream-best-${id}`)) || 0;
}

function setLocalBest(id, score) {
  const next = Math.max(localBest(id), score);
  localStorage.setItem(`scream-best-${id}`, String(next));
  return next;
}

function renderBoard(listEl, top, mine, signedIn) {
  if (!listEl) return;
  const rows = (top || []).map((row, i) => `<li><span>${i + 1}. ${row.name}</span><strong>${row.score}</strong></li>`).join("");
  const hint = signedIn
    ? `Your saved best: ${mine ?? 0}`
    : "Sign in on Stamp Card to save a campus best.";
  listEl.innerHTML = `${rows || "<li class='muted'>No scores yet.</li>"}<p class="muted">${hint}</p>`;
}

async function refreshScores(gameId) {
  const board = document.querySelector(`[data-scoreboard="${gameId}"]`);
  const bestEl = document.querySelector(`[data-best="${gameId}"]`);
  try {
    const data = await fetchLeaderboard(gameId);
    const local = localBest(gameId);
    const best = Math.max(local, data.mine ?? 0);
    if (bestEl) bestEl.textContent = String(best);
    renderBoard(board, data.top, data.mine, Boolean(getStudentSession()));
  } catch {
    if (bestEl) bestEl.textContent = String(localBest(gameId));
    renderBoard(board, [], localBest(gameId), Boolean(getStudentSession()));
  }
}

async function recordScore(gameId, score) {
  const best = setLocalBest(gameId, score);
  const bestEl = document.querySelector(`[data-best="${gameId}"]`);
  if (bestEl) bestEl.textContent = String(best);
  try {
    await submitScore(gameId, score);
  } catch {
    /* still keep local best */
  }
  refreshScores(gameId);
}

function defaultClicker() {
  return {
    candy: 0,
    lifetime: 0,
    prestige: 0,
    upgrades: { bite: 0, spirits: 0, crit: 0, fortune: 0 },
    achievements: [],
  };
}

function loadClicker() {
  try {
    const raw = JSON.parse(localStorage.getItem(CLICKER_KEY) || "null");
    if (!raw) return defaultClicker();
    return { ...defaultClicker(), ...raw, upgrades: { ...defaultClicker().upgrades, ...(raw.upgrades || {}) } };
  } catch {
    return defaultClicker();
  }
}

function saveClicker(state) {
  localStorage.setItem(CLICKER_KEY, JSON.stringify(state));
}

function upgradeCost(def, level) {
  return Math.ceil(def.base * Math.pow(def.grow, level));
}

function curseMult(prestige) {
  return 1 + prestige * 0.15;
}

function fortuneMult(level) {
  return 1 + level * 0.08;
}

function clickPower(state) {
  return Math.max(1, (1 + state.upgrades.bite) * curseMult(state.prestige) * fortuneMult(state.upgrades.fortune));
}

function critChance(state) {
  return Math.min(0.45, 0.04 + state.upgrades.crit * 0.03);
}

function autoRate(state) {
  return state.upgrades.spirits * curseMult(state.prestige) * fortuneMult(state.upgrades.fortune);
}

function prestigeNeed(state) {
  return Math.floor(8000 * Math.pow(1.6, state.prestige));
}

function formatTime(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, "0")}`;
}

function setupClicker() {
  const pumpkin = document.getElementById("clickerPumpkin");
  const shop = document.getElementById("clickerShop");
  const countEl = document.getElementById("clickerCount");
  const rateEl = document.getElementById("clickerRate");
  const prestigeEl = document.getElementById("clickerPrestige");
  const prestigeBtn = document.getElementById("clickerPrestigeBtn");
  const flavor = document.getElementById("clickerFlavor");
  const achieveEl = document.getElementById("clickerAchievements");
  if (!pumpkin || !shop) return;
  let state = loadClicker();
  let saveTimer = 0;

  function persist() {
    saveClicker(state);
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => recordScore("clicker", Math.floor(state.lifetime + state.prestige * 500)), 1600);
  }

  function grant(amount) {
    const n = Math.max(0, amount);
    state.candy += n;
    state.lifetime += n;
  }

  function unlockAchieves() {
    ACHIEVES.forEach((a) => {
      if (!state.achievements.includes(a.id) && a.test(state)) state.achievements.push(a.id);
    });
  }

  function paint() {
    if (countEl) countEl.textContent = String(Math.floor(state.candy));
    if (prestigeEl) prestigeEl.textContent = String(state.prestige);
    if (rateEl) rateEl.textContent = `${autoRate(state).toFixed(1)} /s · ${clickPower(state).toFixed(1)} /tap`;
    if (flavor) {
      flavor.textContent = state.prestige
        ? `Curses multiply everything by ${curseMult(state.prestige).toFixed(2)}×.`
        : "Buy upgrades, then prestige for a permanent curse.";
    }
    shop.innerHTML = UPGRADES.map((def) => {
      const level = state.upgrades[def.id] || 0;
      const cost = upgradeCost(def, level);
      const can = state.candy >= cost;
      return `<button class="upgrade-card ${can ? "" : "is-locked"}" type="button" data-upgrade="${def.id}">
        <strong>${def.name}</strong>
        <small>Lv ${level} · ${def.blurb}</small>
        <span>${cost} candy</span>
      </button>`;
    }).join("");
    if (prestigeBtn) {
      const need = prestigeNeed(state);
      prestigeBtn.textContent = `Prestige (${need} candy)`;
      prestigeBtn.disabled = state.candy < need;
    }
    if (achieveEl) {
      achieveEl.innerHTML = ACHIEVES.map((a) => {
        const on = state.achievements.includes(a.id);
        return `<li class="${on ? "is-done" : ""}">${on ? "★" : "☆"} ${a.name}</li>`;
      }).join("");
    }
  }

  pumpkin.addEventListener("click", () => {
    let n = clickPower(state);
    if (Math.random() < critChance(state)) n *= 7;
    grant(n);
    unlockAchieves();
    paint();
    persist();
  });

  shop.addEventListener("click", (event) => {
    const btn = event.target.closest("[data-upgrade]");
    if (!btn) return;
    const def = UPGRADES.find((u) => u.id === btn.dataset.upgrade);
    if (!def) return;
    const cost = upgradeCost(def, state.upgrades[def.id] || 0);
    if (state.candy < cost) return;
    state.candy -= cost;
    state.upgrades[def.id] += 1;
    unlockAchieves();
    paint();
    persist();
  });

  prestigeBtn?.addEventListener("click", () => {
    const need = prestigeNeed(state);
    if (state.candy < need) return;
    state.prestige += 1;
    state.candy = 0;
    state.upgrades = defaultClicker().upgrades;
    unlockAchieves();
    paint();
    persist();
  });

  setInterval(() => {
    if (document.hidden) return;
    const rate = autoRate(state);
    if (rate < 0.01) return;
    grant(rate);
    unlockAchieves();
    paint();
    persist();
  }, 1000);

  paint();
}

function setupMemory() {
  const grid = document.getElementById("memoryGrid");
  const status = document.getElementById("memoryStatus");
  const startBtn = document.getElementById("memoryStart");
  const diffEl = document.getElementById("memoryDifficulty");
  const timerEl = document.getElementById("memoryTimer");
  if (!grid || !status || !startBtn) return;
  let started = 0;
  let misses = 0;
  let flipped = [];
  let lock = false;
  let matches = 0;
  let pairCount = DIFFS.medium.pairs;
  let tick = null;
  let done = false;

  function paintTimer() {
    if (!timerEl) return;
    if (!started) {
      timerEl.textContent = "0:00";
      return;
    }
    timerEl.textContent = formatTime((Date.now() - started) / 1000);
  }

  function scoreNow() {
    const seconds = Math.floor((Date.now() - started) / 1000);
    const bonus = pairCount * 80;
    return Math.max(0, bonus + 400 - seconds * 4 - misses * 18);
  }

  function paintStatus() {
    if (!started) {
      status.textContent = "Pick a difficulty, then start. Match every pair.";
      return;
    }
    if (done) return;
    status.textContent = `Time ${formatTime((Date.now() - started) / 1000)} · Misses ${misses}`;
  }

  function deal() {
    const key = diffEl?.value || "medium";
    const spec = DIFFS[key] || DIFFS.medium;
    pairCount = spec.pairs;
    grid.dataset.diff = key;
    const icons = ICONS.slice(0, pairCount);
    const cards = [...icons, ...icons].sort(() => Math.random() - 0.5);
    matches = 0;
    misses = 0;
    flipped = [];
    lock = false;
    done = false;
    grid.innerHTML = cards
      .map((icon, i) => `<button class="memory-card" type="button" data-i="${i}" data-icon="${icon}"><span>?</span></button>`)
      .join("");
  }

  grid.addEventListener("click", (event) => {
    const btn = event.target.closest(".memory-card");
    if (!started || done || lock || !btn || btn.classList.contains("is-match") || btn.classList.contains("is-up")) return;
    btn.classList.add("is-up");
    btn.querySelector("span").textContent = btn.dataset.icon;
    flipped.push(btn);
    if (flipped.length < 2) return;
    lock = true;
    const [a, b] = flipped;
    if (a.dataset.icon === b.dataset.icon) {
      a.classList.add("is-match");
      b.classList.add("is-match");
      flipped = [];
      lock = false;
      matches += 1;
      if (matches === pairCount) {
        done = true;
        clearInterval(tick);
        const seconds = (Date.now() - started) / 1000;
        const finalScore = scoreNow();
        paintTimer();
        status.textContent = `Cleared in ${formatTime(seconds)} · ${finalScore} pts`;
        recordScore("memory", finalScore);
      }
    } else {
      misses += 1;
      setTimeout(() => {
        a.classList.remove("is-up");
        b.classList.remove("is-up");
        a.querySelector("span").textContent = "?";
        b.querySelector("span").textContent = "?";
        flipped = [];
        lock = false;
      }, 650);
    }
  });

  startBtn.addEventListener("click", () => {
    deal();
    started = Date.now();
    done = false;
    clearInterval(tick);
    paintTimer();
    paintStatus();
    tick = setInterval(() => {
      if (document.hidden || done) return;
      paintTimer();
      paintStatus();
    }, 200);
  });
  deal();
  paintStatus();
  paintTimer();
}

let catchApi = { pause: () => {}, onLeave: () => {}, onReturn: () => {} };

function setupCatch() {
  const canvas = document.getElementById("catchCanvas");
  const status = document.getElementById("catchStatus");
  const startBtn = document.getElementById("catchStart");
  const pauseBtn = document.getElementById("catchPause");
  if (!canvas || !status || !startBtn) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const W = canvas.width;
  const H = canvas.height;
  let mode = "idle";
  let pumpkinX = W / 2;
  let items = [];
  let score = 0;
  let left = 45;
  let last = 0;
  let spawn = 0;
  let timer = null;
  let raf = 0;
  let acc = 0;

  function spawnItem() {
    const good = Math.random() > 0.28;
    items.push({
      x: 24 + Math.random() * (W - 48),
      y: -20,
      speed: 2.2 + Math.random() * 2.4,
      good,
      icon: good ? (Math.random() > 0.5 ? "🍬" : "🎃") : Math.random() > 0.5 ? "🦇" : "💀",
    });
  }

  function drawPumpkin(x, y) {
    ctx.font = "42px serif";
    ctx.fillText("🎃", x - 21, y);
  }

  function draw() {
    ctx.fillStyle = "#0c070c";
    ctx.fillRect(0, 0, W, H);
    ctx.font = "28px serif";
    items.forEach((item) => ctx.fillText(item.icon, item.x - 14, item.y));
    drawPumpkin(pumpkinX, H - 18);
    ctx.fillStyle = "#fff4d6";
    ctx.font = "14px Outfit, sans-serif";
    const tag = mode === "paused" ? "Paused" : `${left.toFixed(1)}s`;
    ctx.fillText(`Score ${score} · ${tag}`, 12, 22);
  }

  function stopLoop() {
    cancelAnimationFrame(raf);
    raf = 0;
    clearInterval(timer);
    timer = null;
  }

  function finish() {
    mode = "ended";
    stopLoop();
    status.textContent = `Time up · ${score} pts. Start to play again.`;
    if (pauseBtn) pauseBtn.hidden = true;
    startBtn.textContent = "Restart";
    recordScore("catch", score);
    draw();
  }

  function step(ts) {
    if (mode !== "running") return;
    if (!last) last = ts;
    const dt = Math.min(0.05, (ts - last) / 1000);
    last = ts;
    spawn += 1;
    if (spawn % 28 === 0) spawnItem();
    items.forEach((item) => {
      item.y += item.speed;
    });
    items = items.filter((item) => {
      const hit = item.y > H - 48 && Math.abs(item.x - pumpkinX) < 36;
      if (hit) {
        score += item.good ? 12 : -18;
        if (score < 0) score = 0;
        return false;
      }
      return item.y < H + 20;
    });
    acc += dt;
    if (acc >= 0.1) {
      left = Math.max(0, left - acc);
      acc = 0;
      if (left <= 0) {
        finish();
        return;
      }
    }
    draw();
    raf = requestAnimationFrame(step);
  }

  function pause(reason = "paused") {
    if (mode !== "running") return;
    mode = "paused";
    stopLoop();
    last = 0;
    status.textContent = reason === "leave"
      ? "Paused because you left Games. Resume or restart."
      : "Paused. Timer and falling items are frozen.";
    if (pauseBtn) {
      pauseBtn.hidden = false;
      pauseBtn.textContent = "Resume";
    }
    startBtn.textContent = "Restart";
    draw();
  }

  function resume() {
    if (mode !== "paused") return;
    mode = "running";
    last = 0;
    status.textContent = "Catch candy and pumpkins. Avoid bats and skulls.";
    if (pauseBtn) {
      pauseBtn.hidden = false;
      pauseBtn.textContent = "Pause";
    }
    startBtn.textContent = "Restart";
    raf = requestAnimationFrame(step);
  }

  function start() {
    stopLoop();
    mode = "running";
    items = [];
    score = 0;
    left = 45;
    last = 0;
    spawn = 0;
    acc = 0;
    pumpkinX = W / 2;
    status.textContent = "Catch candy and pumpkins. Avoid bats and skulls.";
    startBtn.textContent = "Restart";
    if (pauseBtn) {
      pauseBtn.hidden = false;
      pauseBtn.textContent = "Pause";
    }
    raf = requestAnimationFrame(step);
  }

  function move(clientX) {
    if (mode !== "running") return;
    const rect = canvas.getBoundingClientRect();
    pumpkinX = ((clientX - rect.left) / rect.width) * W;
    pumpkinX = Math.max(28, Math.min(W - 28, pumpkinX));
  }

  canvas.addEventListener("pointerdown", (event) => {
    canvas.setPointerCapture(event.pointerId);
    move(event.clientX);
  });
  canvas.addEventListener("pointermove", (event) => {
    if (event.buttons || event.pointerType === "touch") move(event.clientX);
  });

  startBtn.addEventListener("click", start);
  pauseBtn?.addEventListener("click", () => {
    if (mode === "running") pause("paused");
    else if (mode === "paused") resume();
  });

  catchApi = {
    pause: () => pause("leave"),
    onLeave: () => pause("leave"),
    onReturn: () => {
      if (mode === "paused") {
        status.textContent = "Paused. Resume to continue, or restart.";
        if (pauseBtn) {
          pauseBtn.hidden = false;
          pauseBtn.textContent = "Resume";
        }
      }
    },
  };
  draw();
}

function showGame(id) {
  document.querySelectorAll("[data-game-panel]").forEach((panel) => {
    panel.hidden = panel.dataset.gamePanel !== id;
  });
  document.querySelectorAll("[data-game]").forEach((btn) => {
    btn.classList.toggle("is-active", btn.dataset.game === id);
  });
  const bar = document.getElementById("gameSubnav");
  if (bar) bar.hidden = false;
  refreshScores(id);
}

export function initGames() {
  document.querySelectorAll("[data-game]").forEach((btn) => {
    btn.addEventListener("click", () => showGame(btn.dataset.game));
  });
  setupClicker();
  setupMemory();
  setupCatch();
  GAMES.forEach(refreshScores);
}

export function setGamesVisible(on) {
  const bar = document.getElementById("gameSubnav");
  if (bar) bar.hidden = !on;
  if (on) {
    const active = document.querySelector("[data-game].is-active")?.dataset.game || "clicker";
    showGame(active);
    catchApi.onReturn();
  } else {
    catchApi.onLeave();
  }
}
