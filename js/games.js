import { fetchLeaderboard, getStudentSession, submitScore } from "./session.js";

const GAMES = ["clicker", "memory", "catch"];
const PAIRS = ["🎃", "🦇", "👻", "🍬", "💀", "🕸️", "🐱", "🌙"];

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

function setupClicker() {
  const pumpkin = document.getElementById("clickerPumpkin");
  const countEl = document.getElementById("clickerCount");
  const powerBtn = document.getElementById("clickerPower");
  const autoBtn = document.getElementById("clickerAuto");
  let cookies = 0;
  let power = 1;
  let autos = 0;
  let powerCost = 20;
  let autoCost = 50;
  let timer = null;

  let saveTimer = null;

  function paint() {
    countEl.textContent = String(cookies);
    powerBtn.textContent = `Bigger bites (${powerCost})`;
    autoBtn.textContent = `Spirit helpers (${autoCost})`;
  }

  function add(n) {
    cookies += n;
    const best = setLocalBest("clicker", cookies);
    const bestEl = document.querySelector('[data-best="clicker"]');
    if (bestEl) bestEl.textContent = String(best);
    paint();
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => recordScore("clicker", cookies), 1600);
  }

  pumpkin.addEventListener("click", () => add(power));
  powerBtn.addEventListener("click", () => {
    if (cookies < powerCost) return;
    cookies -= powerCost;
    power += 1;
    powerCost = Math.ceil(powerCost * 1.5);
    paint();
  });
  autoBtn.addEventListener("click", () => {
    if (cookies < autoCost) return;
    cookies -= autoCost;
    autos += 1;
    autoCost = Math.ceil(autoCost * 1.8);
    paint();
  });

  timer = setInterval(() => {
    if (document.hidden || autos < 1) return;
    add(autos);
  }, 1000);
  paint();
  return () => clearInterval(timer);
}

function setupMemory() {
  const grid = document.getElementById("memoryGrid");
  const status = document.getElementById("memoryStatus");
  const startBtn = document.getElementById("memoryStart");
  let started = 0;
  let misses = 0;
  let flipped = [];
  let lock = false;
  let matches = 0;
  let tick = null;

  function deck() {
    return [...PAIRS, ...PAIRS].sort(() => Math.random() - 0.5);
  }

  function scoreNow() {
    const seconds = Math.floor((Date.now() - started) / 1000);
    return Math.max(0, 1000 - seconds * 5 - misses * 20);
  }

  function paintStatus() {
    if (!started) {
      status.textContent = "Press start, then match the pairs.";
      return;
    }
    const seconds = Math.floor((Date.now() - started) / 1000);
    status.textContent = `Time ${seconds}s · Misses ${misses} · Score ${scoreNow()}`;
  }

  function deal() {
    const cards = deck();
    matches = 0;
    misses = 0;
    flipped = [];
    lock = false;
    grid.innerHTML = cards
      .map((icon, i) => `<button class="memory-card" type="button" data-i="${i}" data-icon="${icon}"><span>?</span></button>`)
      .join("");
  }

  grid.addEventListener("click", (event) => {
    const btn = event.target.closest(".memory-card");
    if (!started || lock || !btn || btn.classList.contains("is-match") || btn.classList.contains("is-up")) return;
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
      if (matches === PAIRS.length) {
        clearInterval(tick);
        const finalScore = scoreNow();
        status.textContent = `Cleared · ${finalScore} pts`;
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
    clearInterval(tick);
    tick = setInterval(() => {
      if (!document.hidden) paintStatus();
    }, 250);
    paintStatus();
  });
  deal();
  paintStatus();
}

function setupCatch() {
  const canvas = document.getElementById("catchCanvas");
  const status = document.getElementById("catchStatus");
  const startBtn = document.getElementById("catchStart");
  const ctx = canvas.getContext("2d");
  const W = canvas.width;
  const H = canvas.height;
  let running = false;
  let basket = W / 2;
  let items = [];
  let score = 0;
  let left = 45;
  let last = 0;
  let spawn = 0;
  let timer = null;
  let raf = 0;

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

  function draw() {
    ctx.fillStyle = "#0c070c";
    ctx.fillRect(0, 0, W, H);
    ctx.font = "28px serif";
    items.forEach((item) => ctx.fillText(item.icon, item.x - 14, item.y));
    ctx.fillStyle = "#ff7a18";
    ctx.fillRect(basket - 36, H - 28, 72, 16);
    ctx.fillStyle = "#fff4d6";
    ctx.font = "14px Outfit, sans-serif";
    ctx.fillText(`Score ${score} · ${left}s`, 12, 22);
  }

  function step(ts) {
    if (!running) return;
    if (document.hidden) {
      last = ts;
      raf = requestAnimationFrame(step);
      return;
    }
    if (!last) last = ts;
    last = ts;
    spawn += 1;
    if (spawn % 28 === 0) spawnItem();
    items.forEach((item) => {
      item.y += item.speed;
    });
    items = items.filter((item) => {
      const hit = item.y > H - 40 && Math.abs(item.x - basket) < 42;
      if (hit) {
        score += item.good ? 12 : -18;
        if (score < 0) score = 0;
        return false;
      }
      return item.y < H + 20;
    });
    draw();
    raf = requestAnimationFrame(step);
  }

  function move(clientX) {
    const rect = canvas.getBoundingClientRect();
    basket = ((clientX - rect.left) / rect.width) * W;
    basket = Math.max(36, Math.min(W - 36, basket));
  }

  canvas.addEventListener("pointerdown", (event) => {
    canvas.setPointerCapture(event.pointerId);
    move(event.clientX);
  });
  canvas.addEventListener("pointermove", (event) => {
    if (event.buttons || event.pointerType === "touch") move(event.clientX);
  });

  startBtn.addEventListener("click", () => {
    cancelAnimationFrame(raf);
    clearInterval(timer);
    running = true;
    items = [];
    score = 0;
    left = 45;
    last = 0;
    spawn = 0;
    status.textContent = "Catch candy and pumpkins. Avoid bats and skulls.";
    raf = requestAnimationFrame(step);
    timer = setInterval(() => {
      if (document.hidden) return;
      left -= 1;
      if (left <= 0) {
        running = false;
        clearInterval(timer);
        cancelAnimationFrame(raf);
        status.textContent = `Time up · ${score} pts`;
        recordScore("catch", score);
        draw();
      }
    }, 1000);
  });
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
  }
}
