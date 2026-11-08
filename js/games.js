import { fetchClickerSave, fetchLeaderboard, getAdminSession, getStudentSession, saveClickerRemote, submitScore } from "./session.js?v=f2d682c05b";
import { setupCatchArcade } from "./catch-arcade.js?v=f2d682c05b";
import { markImg } from "./marks.js?v=f2d682c05b";

const GAMES = ["clicker", "memory", "catch"];
const ICONS = ["pumpkin", "bat", "ghost", "web", "candy", "crypt", "moon", "flask", "owl", "fang", "key", "lantern"];

try {
  localStorage.removeItem("scream-clicker-v2");
  GAMES.forEach((id) => localStorage.removeItem(`scream-best-${id}`));
} catch {
  /* ignore */
}

const DIFFS = {
  easy: { pairs: 6, cols: 4, label: "Easy" },
  medium: { pairs: 8, cols: 4, label: "Medium" },
  hard: { pairs: 12, cols: 6, label: "Difficult" },
};

const REDUCE_MOTION = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const UPGRADES = [
  { id: "bite", name: "Bigger bites", icon: "bite", blurb: "Raises candy per tap.", base: 20, grow: 1.18, unlock: 0 },
  { id: "spirits", name: "Spirit helpers", icon: "ghost", blurb: "Passive candy while you wait.", base: 50, grow: 1.22, unlock: 0 },
  { id: "relay", name: "Night relay", icon: "relay", blurb: "Extra idle nodes on the grid.", base: 90, grow: 1.2, unlock: 120 },
  { id: "crit", name: "Jackpot slice", icon: "spark", blurb: "Chance of a 7× tap.", base: 120, grow: 1.25, unlock: 40 },
  { id: "fortune", name: "Candy moon", icon: "moon", blurb: "Multiplies all candy earned.", base: 400, grow: 1.28, unlock: 250 },
];

const ACHIEVES = [
  { id: "first", name: "First nibble", desc: "Tap the pumpkin once.", test: (s) => s.candy >= 1 || s.lifetime >= 1, goal: (s) => Math.min(1, (s.lifetime || s.candy) / 1) },
  { id: "hundred", name: "Pocket full", desc: "Earn 100 candy in total.", test: (s) => s.lifetime >= 100, goal: (s) => Math.min(1, s.lifetime / 100) },
  { id: "helpers", name: "Haunted crew", desc: "Buy Spirit helpers 5 times.", test: (s) => s.upgrades.spirits >= 5, goal: (s) => Math.min(1, s.upgrades.spirits / 5) },
  { id: "bites", name: "Iron jaw", desc: "Raise Bigger bites to level 10.", test: (s) => s.upgrades.bite >= 10, goal: (s) => Math.min(1, s.upgrades.bite / 10) },
  { id: "prestige", name: "Cursed again", desc: "Prestige at least once.", test: (s) => s.prestige >= 1, goal: (s) => Math.min(1, s.prestige / 1) },
  { id: "rich", name: "Treat hoard", desc: "Earn 10,000 candy in total.", test: (s) => s.lifetime >= 10000, goal: (s) => Math.min(1, s.lifetime / 10000) },
];

function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function accountKey() {
  const student = getStudentSession();
  if (student?.payload?.studentNumber) return `student:${student.payload.studentNumber}`;
  const admin = getAdminSession();
  if (admin?.payload?.staffId) return `staff:${admin.payload.staffId}`;
  return null;
}

let guestBests = { clicker: 0, memory: 0, catch: 0 };
let guestClicker = null;

function localBest(id) {
  const key = accountKey();
  if (!key) return Number(guestBests[id]) || 0;
  return Number(localStorage.getItem(`scream-best:${key}:${id}`)) || 0;
}

function setLocalBest(id, score) {
  const next = Math.max(localBest(id), Number(score) || 0);
  const key = accountKey();
  if (!key) {
    guestBests[id] = next;
    return next;
  }
  localStorage.setItem(`scream-best:${key}:${id}`, String(next));
  return next;
}

function renderBoard(listEl, top, mine, signedIn) {
  if (!listEl || listEl.hidden) return;
  const rows = (top || []).map((row, i) => `<li><span>${i + 1}. ${esc(row.name)}</span><strong>${Number(row.score) || 0}</strong></li>`).join("");
  const hint = signedIn
    ? `Your saved best: ${mine ?? 0}`
    : "Sign in to save a campus best.";
  listEl.innerHTML = rows || "<li class='empty-state'><p class='empty-state__title'>No scores yet</p><p class='empty-state__hint'>The board is empty. Haunt it first.</p></li>";
  let hintEl = listEl.nextElementSibling;
  if (!hintEl || !hintEl.classList.contains("scoreboard-hint")) {
    hintEl = document.createElement("p");
    hintEl.className = "muted scoreboard-hint";
    listEl.after(hintEl);
  }
  hintEl.textContent = hint;
}

async function refreshScores(gameId) {
  const board = document.querySelector(`[data-scoreboard="${gameId}"]`);
  const bestEl = document.querySelector(`[data-best="${gameId}"]`);
  try {
    const data = await fetchLeaderboard(gameId);
    if (getStudentSession() && data.mine != null) setLocalBest(gameId, data.mine);
    const best = localBest(gameId);
    if (bestEl) bestEl.textContent = String(best);
    renderBoard(board, data.top, getStudentSession() ? (data.mine ?? best) : null, Boolean(getStudentSession()));
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
    upgrades: { bite: 0, spirits: 0, relay: 0, crit: 0, fortune: 0 },
    achievements: [],
  };
}

function hydrateClicker(raw) {
  if (!raw) return defaultClicker();
  return { ...defaultClicker(), ...raw, upgrades: { ...defaultClicker().upgrades, ...(raw.upgrades || {}) } };
}

function loadClicker() {
  const key = accountKey();
  if (!key) return hydrateClicker(guestClicker);
  try {
    return hydrateClicker(JSON.parse(localStorage.getItem(`scream-clicker:${key}`) || "null"));
  } catch {
    return defaultClicker();
  }
}

function saveClicker(state) {
  const key = accountKey();
  if (!key) {
    guestClicker = { ...state, upgrades: { ...state.upgrades } };
    return;
  }
  localStorage.setItem(`scream-clicker:${key}`, JSON.stringify(state));
  if (key.startsWith("student:")) {
    clearTimeout(saveClicker.timer);
    saveClicker.timer = setTimeout(() => {
      saveClickerRemote(state).catch(() => {});
    }, 1400);
  }
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
  const nodes = state.upgrades.spirits + state.upgrades.relay * 0.6;
  return nodes * curseMult(state.prestige) * fortuneMult(state.upgrades.fortune);
}

function comboMult(combo) {
  return 1 + Math.min(1, combo * 0.05);
}

function clickerTier(lifetime) {
  if (lifetime >= 10000) return 5;
  if (lifetime >= 1000) return 4;
  if (lifetime >= 250) return 3;
  if (lifetime >= 40) return 2;
  return 1;
}

function upgradeNow(def, state) {
  const level = state.upgrades[def.id] || 0;
  if (def.id === "bite") return `${clickPower(state).toFixed(1)} candy/tap`;
  if (def.id === "spirits" || def.id === "relay") return `${autoRate(state).toFixed(1)} candy/s`;
  if (def.id === "crit") return `${Math.round(critChance(state) * 100)}% jackpot`;
  if (def.id === "fortune") return `${fortuneMult(level).toFixed(2)}× all candy`;
  return "";
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
  const comboEl = document.getElementById("clickerCombo");
  const toastEl = document.getElementById("clickerToast");
  const fx = document.getElementById("clickerFx");
  const floats = document.getElementById("clickerFloats");
  const frenzyBox = document.getElementById("clickerFrenzy");
  const frenzyFill = document.getElementById("clickerFrenzyFill");
  const progressFill = document.getElementById("clickerProgressFill");
  const progressLabel = document.getElementById("clickerProgressLabel");
  const tierEl = document.getElementById("clickerTier");
  if (!pumpkin || !shop) return;

  let state = loadClicker();
  let saveTimer = 0;
  let idleAcc = 0;
  let combo = 0;
  let lastTap = 0;
  let frenzyUntil = 0;
  let frenzyReady = 0;
  let toastTimer = 0;
  let shopSig = "";
  let achieveSig = "";
  let seenUnlock = new Set(UPGRADES.filter((u) => state.lifetime >= u.unlock).map((u) => u.id));
  const fxCtx = fx?.getContext?.("2d") || null;
  const sparks = [];
  let fxRaf = 0;

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

  function toast(message) {
    if (!toastEl) return;
    toastEl.hidden = false;
    toastEl.textContent = message;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toastEl.hidden = true;
    }, 2200);
  }

  function unlockAchieves() {
    ACHIEVES.forEach((a) => {
      if (!state.achievements.includes(a.id) && a.test(state)) {
        state.achievements.push(a.id);
        toast(`Milestone · ${a.name}`);
      }
    });
    UPGRADES.forEach((def) => {
      if (!def.unlock || state.lifetime < def.unlock || seenUnlock.has(def.id)) return;
      seenUnlock.add(def.id);
      toast(`System online · ${def.name}`);
    });
  }

  function sizeFx() {
    if (!fx || !fxCtx) return;
    const box = pumpkin.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(1, Math.round(box.width));
    const h = Math.max(1, Math.round(box.height));
    if (fx.width !== Math.round(w * dpr) || fx.height !== Math.round(h * dpr)) {
      fx.width = Math.round(w * dpr);
      fx.height = Math.round(h * dpr);
      fx.style.width = `${w}px`;
      fx.style.height = `${h}px`;
      fxCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
  }

  function burst(crit) {
    if (REDUCE_MOTION || !fxCtx) return;
    sizeFx();
    const w = fx.getBoundingClientRect().width;
    const h = fx.getBoundingClientRect().height;
    const n = crit ? 14 : 8;
    for (let i = 0; i < n && sparks.length < 28; i += 1) {
      const a = Math.random() * Math.PI * 2;
      const s = 40 + Math.random() * 90;
      sparks.push({
        x: w / 2,
        y: h / 2,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s,
        life: 1,
        crit,
      });
    }
    if (!fxRaf) fxRaf = requestAnimationFrame(tickFx);
  }

  function tickFx(ts) {
    fxRaf = 0;
    if (!fxCtx || !fx) return;
    const w = fx.getBoundingClientRect().width;
    const h = fx.getBoundingClientRect().height;
    fxCtx.clearRect(0, 0, w, h);
    const dt = 0.016;
    for (let i = sparks.length - 1; i >= 0; i -= 1) {
      const p = sparks[i];
      p.life -= dt * 1.8;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 40 * dt;
      if (p.life <= 0) {
        sparks.splice(i, 1);
        continue;
      }
      fxCtx.globalAlpha = Math.max(0, p.life);
      fxCtx.fillStyle = p.crit ? "#fff4d6" : "#ff8a1a";
      fxCtx.beginPath();
      fxCtx.arc(p.x, p.y, p.crit ? 3.2 : 2.2, 0, Math.PI * 2);
      fxCtx.fill();
    }
    fxCtx.globalAlpha = 1;
    if (sparks.length) fxRaf = requestAnimationFrame(tickFx);
  }

  function floatPlus(amount, crit, event) {
    if (!floats) return;
    const node = document.createElement("span");
    node.className = `clicker-float${crit ? " is-crit" : ""}`;
    const shown = Number.isInteger(amount) || amount >= 10 ? Math.round(amount) : Math.round(amount * 10) / 10;
    node.textContent = `+${shown}`;
    const dx = Math.round((Math.random() - 0.5) * 56);
    node.style.setProperty("--dx", `${dx}px`);
    const stage = pumpkin.parentElement;
    const rect = stage.getBoundingClientRect();
    const x = event ? event.clientX - rect.left : rect.width / 2;
    const y = event ? event.clientY - rect.top : rect.height * 0.42;
    node.style.left = `${x}px`;
    node.style.top = `${y}px`;
    floats.appendChild(node);
    node.addEventListener("animationend", () => node.remove(), { once: true });
    setTimeout(() => node.remove(), 900);
  }

  function shopMarkup() {
    return UPGRADES.map((def) => {
      const gated = state.lifetime < def.unlock;
      const level = state.upgrades[def.id] || 0;
      const cost = upgradeCost(def, level);
      const can = !gated && state.candy >= cost;
      const cls = [
        "upgrade-card",
        gated ? "is-gated" : "",
        can ? "is-buy" : "is-locked",
        level > 0 ? "is-bought" : "",
      ].filter(Boolean).join(" ");
      return `<button class="${cls}" type="button" data-upgrade="${def.id}" ${gated ? "disabled" : ""}>
        <span class="upgrade-card__icon">${markImg(def.icon)}</span>
        <span class="upgrade-card__body">
          <span class="upgrade-card__top"><strong>${def.name}</strong><span class="upgrade-card__lv">Lv ${level}</span></span>
          <small class="upgrade-card__desc">${gated ? `Unlocks at ${def.unlock} lifetime candy` : def.blurb}</small>
          <span class="upgrade-card__effect">${gated ? "Offline" : upgradeNow(def, state)}</span>
          <span class="upgrade-card__foot">
            <span class="upgrade-card__cost">${gated ? "-" : `${cost} candy`}</span>
            <span class="upgrade-card__buy">${gated ? "Locked" : can ? "Install" : "Need more"}</span>
          </span>
        </span>
      </button>`;
    }).join("");
  }

  function paintShop() {
    const next = shopMarkup();
    if (next !== shopSig) {
      shopSig = next;
      shop.innerHTML = next;
    }
  }

  function paintAchieves() {
    if (!achieveEl) return;
    const next = state.achievements.join(",");
    if (next === achieveSig && achieveEl.childElementCount) return;
    achieveSig = next;
    achieveEl.innerHTML = ACHIEVES.map((a) => {
      const on = state.achievements.includes(a.id);
      return `<li class="${on ? "is-done" : ""}"><strong>${a.name}</strong><span>${a.desc}</span></li>`;
    }).join("");
  }

  function paintHud() {
    const now = Date.now();
    const frenzyOn = now < frenzyUntil;
    const comboX = comboMult(combo) * (frenzyOn ? 2 : 1);
    if (countEl) countEl.textContent = String(Math.floor(state.candy));
    if (prestigeEl) prestigeEl.textContent = String(state.prestige);
    if (rateEl) rateEl.textContent = `${autoRate(state).toFixed(1)}/s`;
    if (comboEl) comboEl.textContent = `x${comboX.toFixed(2)}`;
    if (tierEl) tierEl.textContent = `Tier ${clickerTier(state.lifetime)}`;
    if (flavor) {
      flavor.textContent = frenzyOn
        ? "Frenzy live. Taps are doubled."
        : state.prestige
          ? `Curses multiply everything by ${curseMult(state.prestige).toFixed(2)}×.`
          : "Keep tapping to build combo. Install systems for idle candy.";
    }
    const next = ACHIEVES.find((a) => !state.achievements.includes(a.id));
    if (progressLabel && progressFill) {
      if (!next) {
        progressLabel.textContent = "All milestones cleared";
        progressFill.style.width = "100%";
      } else {
        const pct = Math.round((next.goal(state) || 0) * 100);
        progressLabel.textContent = next.name;
        progressFill.style.width = `${pct}%`;
      }
    }
    if (frenzyBox && frenzyFill) {
      if (frenzyOn) {
        frenzyBox.hidden = false;
        frenzyFill.style.width = `${Math.max(0, ((frenzyUntil - now) / 6000) * 100)}%`;
      } else {
        frenzyBox.hidden = true;
      }
    }
    pumpkin.classList.toggle("is-frenzy", frenzyOn);
    if (prestigeBtn) {
      const need = prestigeNeed(state);
      prestigeBtn.textContent = `Prestige (${need} candy)`;
      prestigeBtn.disabled = state.candy < need;
    }
  }

  function paintAll() {
    paintHud();
    paintShop();
    paintAchieves();
  }

  function applyLoaded(next) {
    state = hydrateClicker(next);
    combo = 0;
    lastTap = 0;
    frenzyUntil = 0;
    frenzyReady = 0;
    idleAcc = 0;
    shopSig = "";
    achieveSig = "";
    seenUnlock = new Set(UPGRADES.filter((u) => state.lifetime >= u.unlock).map((u) => u.id));
    paintAll();
  }

  pumpkin.addEventListener("pointerdown", () => {
    pumpkin.classList.add("is-press");
  });
  pumpkin.addEventListener("pointerup", () => pumpkin.classList.remove("is-press"));
  pumpkin.addEventListener("pointerleave", () => pumpkin.classList.remove("is-press"));

  pumpkin.addEventListener("click", (event) => {
    const now = Date.now();
    combo = now - lastTap < 900 ? combo + 1 : 1;
    lastTap = now;
    if (combo >= 8 && now > frenzyReady) {
      frenzyUntil = now + 6000;
      frenzyReady = now + 18000;
      toast("Frenzy · 6s double taps");
    }
    const crit = Math.random() < critChance(state);
    let n = clickPower(state) * comboMult(combo);
    if (now < frenzyUntil) n *= 2;
    if (crit) {
      n *= 7;
      pumpkin.classList.add("is-crit");
      setTimeout(() => pumpkin.classList.remove("is-crit"), 180);
    }
    grant(n);
    burst(crit);
    floatPlus(n, crit, event);
    unlockAchieves();
    paintAll();
    persist();
  });

  shop.addEventListener("click", (event) => {
    const btn = event.target.closest("[data-upgrade]");
    if (!btn || btn.disabled) return;
    const def = UPGRADES.find((u) => u.id === btn.dataset.upgrade);
    if (!def || state.lifetime < def.unlock) return;
    const cost = upgradeCost(def, state.upgrades[def.id] || 0);
    if (state.candy < cost) return;
    state.candy -= cost;
    state.upgrades[def.id] += 1;
    btn.classList.add("is-flash");
    unlockAchieves();
    shopSig = "";
    paintAll();
    persist();
  });

  prestigeBtn?.addEventListener("click", () => {
    const need = prestigeNeed(state);
    if (state.candy < need) return;
    state.prestige += 1;
    state.candy = 0;
    state.upgrades = defaultClicker().upgrades;
    combo = 0;
    shopSig = "";
    achieveSig = "";
    unlockAchieves();
    toast("Curse deepened. Systems reset.");
    paintAll();
    persist();
  });

  let lastIdle = performance.now();
  setInterval(() => {
    if (document.hidden) {
      lastIdle = performance.now();
      return;
    }
    const now = performance.now();
    const dt = Math.min(2, (now - lastIdle) / 1000);
    lastIdle = now;
    const rate = autoRate(state);
    idleAcc += rate * dt;
    if (idleAcc >= 0.2) {
      grant(idleAcc);
      idleAcc = 0;
      unlockAchieves();
      persist();
    }
    if (Date.now() - lastTap > 900) combo = 0;
    paintHud();
    if (Math.floor(state.candy / 8) !== Math.floor((state.candy - rate * dt) / 8)) paintShop();
  }, 200);

  paintAll();
  clickerApi = {
    flush: () => saveClicker(state),
    reload: () => applyLoaded(loadClicker()),
  };
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

  function currentSpec() {
    return DIFFS[diffEl?.value] || DIFFS.medium;
  }

  function paintStatus() {
    if (!started) {
      const spec = currentSpec();
      status.textContent = `${spec.label} · ${spec.pairs * 2} cards. Start when ready.`;
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
    btn.querySelector("span").innerHTML = markImg(btn.dataset.icon, "mark mark--memory");
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

  diffEl?.addEventListener("change", () => resetMemoryRound());

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

  function resetMemoryRound() {
    clearInterval(tick);
    tick = null;
    started = 0;
    done = false;
    misses = 0;
    flipped = [];
    lock = false;
    matches = 0;
    deal();
    paintStatus();
    paintTimer();
  }

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) resetMemoryRound();
  });

  memoryApi.reset = resetMemoryRound;
}

let catchApi = { pause: () => {}, onLeave: () => {}, onReturn: () => {}, reset: () => {} };
let memoryApi = { reset: () => {} };
let clickerApi = { flush: () => {}, reload: () => {} };

function setupCatch() {
  setupCatchArcade({
    formatTime,
    recordScore,
    REDUCE_MOTION,
    setCatchApi: (api) => {
      catchApi = api;
    },
  });
  return;
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
      icon: good ? (Math.random() > 0.5 ? "T" : "R") : Math.random() > 0.5 ? "H" : "X",
    });
  }

  function drawBasket(x, y) {
    ctx.strokeStyle = "#6b2200";
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(x, y - 22, 20, Math.PI * 1.05, Math.PI * -0.05, false);
    ctx.stroke();
    ctx.fillStyle = "#d94b00";
    ctx.beginPath();
    ctx.ellipse(x, y - 2, 34, 18, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#ff8c2a";
    ctx.beginPath();
    ctx.ellipse(x, y - 8, 30, 12, 0, Math.PI, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#9a3412";
    ctx.lineWidth = 2;
    for (const dx of [-16, -6, 6, 16]) {
      ctx.beginPath();
      ctx.ellipse(x + dx, y - 2, 4, 16, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.fillStyle = "#2d6a4f";
    ctx.fillRect(x - 3, y - 28, 6, 8);
  }

  function draw() {
    ctx.fillStyle = "#0c070c";
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = "#fff4d6";
    ctx.font = "14px IBM Plex Sans, sans-serif";
    items.forEach((item) => ctx.fillText(item.icon, item.x - 8, item.y));
    drawBasket(pumpkinX, H - 16);
    ctx.fillStyle = "#fff4d6";
    ctx.font = "14px IBM Plex Sans, sans-serif";
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
      const hit = item.y > H - 52 && Math.abs(item.x - pumpkinX) < 42;
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
    status.textContent = "Catch candy and pumpkins in the basket. Avoid bats and skulls.";
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
    status.textContent = "Catch candy and pumpkins in the basket. Avoid bats and skulls.";
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
  const leaving = document.querySelector("[data-game].is-active")?.dataset.game;
  if (leaving === "memory" && id !== "memory") memoryApi.reset();
  if (leaving === "catch" && id !== "catch") catchApi.onLeave();
  document.querySelectorAll("[data-game-panel]").forEach((panel) => {
    panel.hidden = panel.dataset.gamePanel !== id;
  });
  document.querySelectorAll("[data-game]").forEach((btn) => {
    btn.classList.toggle("is-active", btn.dataset.game === id);
  });
  const bar = document.getElementById("gameSubnav");
  if (bar) bar.hidden = false;
  refreshScores(id);
  if (id === "catch") catchApi.onReturn();
}

export function flushGameProgress() {
  clickerApi.flush();
}

export function applyGameAccount() {
  if (!accountKey()) {
    guestClicker = null;
    guestBests = { clicker: 0, memory: 0, catch: 0 };
  }
  clickerApi.reload();
  fetchClickerSave().then((remote) => {
    if (!remote || !accountKey()) return;
    saveClicker(hydrateClicker(remote));
    clickerApi.reload();
  }).catch(() => {});
  memoryApi.reset();
  catchApi.reset?.();
  GAMES.forEach((id) => {
    const bestEl = document.querySelector(`[data-best="${id}"]`);
    if (bestEl) bestEl.textContent = String(localBest(id));
    refreshScores(id);
  });
}

export function initGames() {
  document.querySelectorAll("[data-game]").forEach((btn) => {
    btn.addEventListener("click", () => showGame(btn.dataset.game));
  });
  setupClicker();
  fetchClickerSave().then((remote) => {
    if (!remote || !accountKey()) return;
    saveClicker(hydrateClicker(remote));
    clickerApi.reload();
  }).catch(() => {});
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
    memoryApi.reset();
  }
}
