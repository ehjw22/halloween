import { markUrl } from "./marks.js?v=21e51c2e51";

export function setupCatchArcade({ formatTime, recordScore, REDUCE_MOTION, setCatchApi }) {
  const canvas = document.getElementById("catchCanvas");
  const status = document.getElementById("catchStatus");
  const startBtn = document.getElementById("catchStart");
  const pauseBtn = document.getElementById("catchPause");
  const scoreEl = document.getElementById("catchScore");
  const comboEl = document.getElementById("catchCombo");
  const multEl = document.getElementById("catchMult");
  const levelEl = document.getElementById("catchLevel");
  const timeEl = document.getElementById("catchTime");
  if (!canvas || !status || !startBtn) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const markArt = {
    treat: Object.assign(new Image(), { src: markUrl("candy") }),
    rare: Object.assign(new Image(), { src: markUrl("pumpkin") }),
    bonus: Object.assign(new Image(), { src: markUrl("spark") }),
    hazard: Object.assign(new Image(), { src: markUrl("hazard") }),
    basket: Object.assign(new Image(), { src: markUrl("pumpkin") }),
  };

  let W = 360;
  let H = 480;
  let mode = "idle";
  let paddleX = W / 2;
  let paddleV = 0;
  let items = [];
  let fx = [];
  let pops = [];
  let score = 0;
  let combo = 0;
  let left = 45;
  let last = 0;
  let spawnT = 0;
  let acc = 0;
  let bonusUntil = 0;
  let hitFlash = 0;
  let shake = 0;
  let raf = 0;
  const keys = new Set();
  const stars = Array.from({ length: 28 }, () => ({
    x: Math.random(),
    y: Math.random(),
    s: 0.4 + Math.random() * 1.4,
  }));

  function fit() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const cssW = Math.max(280, canvas.clientWidth || 360);
    const cssH = Math.round(cssW * (480 / 360));
    W = cssW;
    H = cssH;
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    paddleX = Math.max(40, Math.min(W - 40, paddleX || W / 2));
  }

  function roundMult() {
    const comboX = 1 + Math.min(1.5, Math.max(0, combo - 1) * 0.12);
    const bonus = performance.now() < bonusUntil ? 2 : 1;
    return { comboX, bonus, total: comboX * bonus };
  }

  function wave() {
    return 1 + Math.floor((45 - left) / 8);
  }

  function paintHud() {
    const m = roundMult();
    if (scoreEl) scoreEl.textContent = String(score);
    if (comboEl) comboEl.textContent = combo ? `x${combo}` : "x1";
    if (multEl) multEl.textContent = `x${m.total.toFixed(1)}`;
    if (levelEl) levelEl.textContent = String(wave());
    if (timeEl) timeEl.textContent = formatTime(left);
  }

  function pop(x, y, text, good) {
    pops.push({ x, y, text, good, life: 1 });
    if (pops.length > 12) pops.shift();
  }

  function spark(x, y, good) {
    if (REDUCE_MOTION) return;
    const n = good ? 10 : 6;
    for (let i = 0; i < n && fx.length < 40; i += 1) {
      const a = Math.random() * Math.PI * 2;
      const sp = 40 + Math.random() * 80;
      fx.push({
        x,
        y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        life: 1,
        good,
      });
    }
  }

  function pickType(elapsed) {
    const r = Math.random();
    const hazard = elapsed < 6 ? 0.12 : elapsed < 16 ? 0.2 : 0.26;
    const bonus = elapsed < 12 ? 0 : 0.08;
    const rare = elapsed < 5 ? 0.08 : 0.18;
    if (r < hazard) return "hazard";
    if (r < hazard + bonus) return "bonus";
    if (r < hazard + bonus + rare) return "rare";
    return "treat";
  }

  function spawnItem() {
    const elapsed = 45 - left;
    const type = pickType(elapsed);
    const speed = (150 + elapsed * 6 + Math.random() * 70) * (1 + wave() * 0.04);
    items.push({
      x: 28 + Math.random() * (W - 56),
      y: -18,
      vy: speed,
      type,
      spin: (Math.random() - 0.5) * 3,
      rot: 0,
    });
  }

  function drawCatcher(x, y) {
    const w = 78;
    const lean = Math.max(-0.18, Math.min(0.18, paddleV / 420));
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(lean);
    ctx.shadowColor = hitFlash > 0 ? "#fff4d6" : "#ff7a18";
    ctx.shadowBlur = 18;
    const g = ctx.createLinearGradient(-w / 2, 0, w / 2, 0);
    g.addColorStop(0, "#7c2d12");
    g.addColorStop(0.5, "#fb923c");
    g.addColorStop(1, "#7c2d12");
    ctx.fillStyle = g;
    ctx.beginPath();
    if (typeof ctx.roundRect === "function") ctx.roundRect(-w / 2, -10, w, 18, 9);
    else ctx.rect(-w / 2, -10, w, 18);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = "rgba(255,244,214,0.55)";
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.fillStyle = "#fff4d6";
    ctx.beginPath();
    ctx.ellipse(0, -2, 22, 5, 0, 0, Math.PI * 2);
    ctx.fill();
    const basket = markArt.basket;
    if (basket.complete && basket.naturalWidth) {
      ctx.drawImage(basket, -16, -18, 32, 32);
    }
    ctx.restore();
  }

  function drawItem(item) {
    ctx.save();
    ctx.translate(item.x, item.y);
    ctx.rotate(item.rot);
    const look = {
      hazard: { glow: "#ff9a9a", disc: "rgba(248,113,113,0.7)", mark: "x" },
      bonus: { glow: "#f0d9ff", disc: "rgba(216,180,254,0.75)", mark: "+" },
      rare: { glow: "#ffd38a", disc: "rgba(255,179,71,0.75)", mark: "r" },
      treat: { glow: "#bbf7d0", disc: "rgba(74,222,128,0.7)", mark: "t" },
    }[item.type] || { glow: "#fff4d6", disc: "rgba(255,244,214,0.55)", mark: "t" };
    ctx.shadowColor = look.glow;
    ctx.shadowBlur = 28;
    ctx.fillStyle = look.disc;
    ctx.beginPath();
    ctx.arc(0, 0, 18, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = "#fff8ea";
    ctx.beginPath();
    ctx.arc(0, 0, 12, 0, Math.PI * 2);
    ctx.fill();
    const art = markArt[item.type] || markArt.treat;
    if (art.complete && art.naturalWidth) {
      ctx.drawImage(art, -11, -11, 22, 22);
    }
    ctx.restore();
  }

  function drawBg() {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, "#2c1540");
    g.addColorStop(0.55, "#1c1028");
    g.addColorStop(1, "#2a1418");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = "rgba(255,244,214,0.7)";
    stars.forEach((st, i) => {
      const tw = 0.45 + Math.sin((performance.now() / 700) + i) * 0.25;
      ctx.globalAlpha = REDUCE_MOTION ? 0.45 : tw;
      ctx.fillRect(st.x * W, st.y * H, st.s, st.s);
    });
    ctx.globalAlpha = 1;
    ctx.strokeStyle = "rgba(255,122,24,0.08)";
    ctx.lineWidth = 1;
    for (let x = 40; x < W; x += 40) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, H);
      ctx.stroke();
    }
    ctx.fillStyle = "rgba(255,122,24,0.12)";
    ctx.fillRect(0, H - 36, W, 36);
    ctx.strokeStyle = "rgba(255,179,71,0.35)";
    ctx.strokeRect(1.5, 1.5, W - 3, H - 3);
  }

  function draw() {
    ctx.save();
    if (shake > 0) ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);
    drawBg();
    items.forEach(drawItem);
    fx.forEach((p) => {
      ctx.globalAlpha = Math.max(0, p.life);
      ctx.fillStyle = p.good ? "#ffb347" : "#f87171";
      ctx.beginPath();
      ctx.arc(p.x, p.y, 2.4, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.globalAlpha = 1;
    pops.forEach((p) => {
      ctx.globalAlpha = Math.max(0, p.life);
      ctx.fillStyle = p.good ? "#fff4d6" : "#fca5a5";
      ctx.font = "700 14px IBM Plex Sans, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(p.text, p.x, p.y);
    });
    ctx.globalAlpha = 1;
    drawCatcher(paddleX, H - 28);
    if (mode === "paused") {
      ctx.fillStyle = "rgba(7,4,10,0.45)";
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = "#fff4d6";
      ctx.font = "700 22px IBM Plex Sans, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("PAUSED", W / 2, H / 2);
    }
    if (mode === "idle") {
      ctx.fillStyle = "rgba(7,4,10,0.28)";
      ctx.fillRect(0, 0, W, H);
    }
    ctx.restore();
  }

  function stopLoop() {
    cancelAnimationFrame(raf);
    raf = 0;
  }

  function finish() {
    mode = "ended";
    stopLoop();
    status.textContent = `Time up · ${score} pts. Start to play again.`;
    if (pauseBtn) pauseBtn.hidden = true;
    startBtn.textContent = "Restart";
    recordScore("catch", score);
    paintHud();
    draw();
  }

  function applyCatch(item) {
    const m = roundMult();
    if (item.type === "hazard") {
      combo = 0;
      score = Math.max(0, score - 18);
      hitFlash = 0.2;
      shake = 6;
      spark(item.x, H - 34, false);
      pop(item.x, H - 56, "-18", false);
      return;
    }
    combo += 1;
    const pts = Math.round((item.type === "rare" ? 22 : item.type === "bonus" ? 14 : 10) * m.total);
    score += pts;
    hitFlash = 0.15;
    spark(item.x, H - 34, true);
    pop(item.x, H - 58, `+${pts}`, true);
    if (item.type === "bonus") {
      bonusUntil = performance.now() + 5000;
      status.textContent = "Bonus window · scores doubled for 5s.";
    }
  }

  function step(ts) {
    if (mode !== "running") return;
    if (!last) last = ts;
    const dt = Math.min(0.05, (ts - last) / 1000);
    last = ts;
    const elapsed = 45 - left;
    spawnT += dt;
    const gap = Math.max(0.22, 0.62 - elapsed * 0.008);
    if (spawnT >= gap) {
      spawnT = 0;
      spawnItem();
      if (wave() >= 4 && Math.random() < 0.28) spawnItem();
    }

    let targetV = 0;
    if (keys.has("ArrowLeft") || keys.has("a") || keys.has("A")) targetV -= 380;
    if (keys.has("ArrowRight") || keys.has("d") || keys.has("D")) targetV += 380;
    paddleV += (targetV - paddleV) * Math.min(1, dt * 12);
    paddleX = Math.max(40, Math.min(W - 40, paddleX + paddleV * dt));

    items.forEach((item) => {
      item.y += item.vy * dt;
      item.rot += item.spin * dt;
    });
    items = items.filter((item) => {
      const hit = item.y > H - 62 && item.y < H - 4 && Math.abs(item.x - paddleX) < 54;
      if (hit) {
        applyCatch(item);
        return false;
      }
      if (item.y >= H + 16) {
        if (item.type !== "hazard") {
          combo = 0;
          pop(item.x, H - 24, "miss", false);
        }
        return false;
      }
      return true;
    });

    for (let i = fx.length - 1; i >= 0; i -= 1) {
      const p = fx[i];
      p.life -= dt * 2.2;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.life <= 0) fx.splice(i, 1);
    }
    for (let i = pops.length - 1; i >= 0; i -= 1) {
      pops[i].life -= dt * 1.4;
      pops[i].y -= 28 * dt;
      if (pops[i].life <= 0) pops.splice(i, 1);
    }
    hitFlash = Math.max(0, hitFlash - dt);
    shake = Math.max(0, shake - dt * 18);

    acc += dt;
    if (acc >= 0.05) {
      left = Math.max(0, left - acc);
      acc = 0;
      paintHud();
      if (left <= 0) {
        finish();
        return;
      }
    }
    if (performance.now() > bonusUntil && status.textContent.startsWith("Bonus")) {
      status.textContent = "Catch treats. Chain combos. Avoid hazards.";
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
    status.textContent = "Catch treats. Chain combos. Avoid hazards.";
    if (pauseBtn) {
      pauseBtn.hidden = false;
      pauseBtn.textContent = "Pause";
    }
    startBtn.textContent = "Restart";
    raf = requestAnimationFrame(step);
  }

  function hardReset() {
    stopLoop();
    mode = "idle";
    items = [];
    fx = [];
    pops = [];
    score = 0;
    combo = 0;
    left = 45;
    last = 0;
    spawnT = 0;
    acc = 0;
    bonusUntil = 0;
    hitFlash = 0;
    shake = 0;
    paddleX = W / 2;
    paddleV = 0;
    keys.clear();
    status.textContent = "Catch treats. Chain combos. Avoid hazards.";
    startBtn.textContent = "Start round";
    if (pauseBtn) {
      pauseBtn.hidden = true;
      pauseBtn.textContent = "Pause";
    }
    paintHud();
    draw();
  }

  function start() {
    stopLoop();
    fit();
    mode = "running";
    items = [];
    fx = [];
    pops = [];
    score = 0;
    combo = 0;
    left = 45;
    last = 0;
    spawnT = 0;
    acc = 0;
    bonusUntil = 0;
    hitFlash = 0;
    shake = 0;
    paddleX = W / 2;
    paddleV = 0;
    status.textContent = "Catch treats. Chain combos. Avoid hazards.";
    startBtn.textContent = "Restart";
    if (pauseBtn) {
      pauseBtn.hidden = false;
      pauseBtn.textContent = "Pause";
    }
    paintHud();
    raf = requestAnimationFrame(step);
  }

  function move(clientX) {
    if (mode !== "running") return;
    const rect = canvas.getBoundingClientRect();
    const next = ((clientX - rect.left) / rect.width) * W;
    paddleV = (next - paddleX) / 0.05;
    paddleX = Math.max(40, Math.min(W - 40, next));
  }

  function catchOpen() {
    return document.querySelector("[data-game-panel='catch']:not([hidden])");
  }

  canvas.addEventListener("pointerdown", (event) => {
    canvas.setPointerCapture(event.pointerId);
    move(event.clientX);
  });
  canvas.addEventListener("pointermove", (event) => {
    if (event.buttons || event.pointerType === "touch") move(event.clientX);
  });
  window.addEventListener("keydown", (event) => {
    if (!catchOpen() || mode !== "running") return;
    if (["ArrowLeft", "ArrowRight", "a", "A", "d", "D"].includes(event.key)) {
      keys.add(event.key);
      event.preventDefault();
    }
    if (event.key === " " || event.key === "p" || event.key === "P") {
      event.preventDefault();
      pause("paused");
    }
  });
  window.addEventListener("keyup", (event) => keys.delete(event.key));
  window.addEventListener("resize", () => {
    if (mode === "idle" || mode === "paused" || mode === "ended") {
      fit();
      draw();
    }
  });

  startBtn.addEventListener("click", start);
  pauseBtn?.addEventListener("click", () => {
    if (mode === "running") pause("paused");
    else if (mode === "paused") resume();
  });

  setCatchApi({
    pause: () => pause("leave"),
    onLeave: () => pause("leave"),
    reset: hardReset,
    onReturn: () => {
      fit();
      draw();
      if (mode === "paused") {
        status.textContent = "Paused. Resume to continue, or restart.";
        if (pauseBtn) {
          pauseBtn.hidden = false;
          pauseBtn.textContent = "Resume";
        }
      }
    },
  });
  fit();
  paintHud();
  draw();
}
