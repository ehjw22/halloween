export const GATES_AT = Date.parse("2026-10-24T18:00:00+08:00");
const DEV_KEY = "scream-dev-view";
const DEV_PARAM = "dev";
const DEV_VALUE = "scream";
export const WELCOME_PENDING_KEY = "scream-welcome-pending";
const STING_MS = 1500;

let tickId = 0;
let stingId = 0;
let lastMinuteShown = null;
let lastSecondShown = null;
let lastLiveSecond = null;
let lastPhase = null;
let stingStarted = false;
let devLatched = false;

function hasDevView() {
  if (devLatched) return true;
  try {
    if (new URLSearchParams(location.search).get(DEV_PARAM) === DEV_VALUE) return true;
    if (sessionStorage.getItem(DEV_KEY) === "1") return true;
  } catch {
    /* private mode */
  }
  return false;
}

export function isEventOpen() {
  if (Date.now() >= GATES_AT) return true;
  return hasDevView();
}

function prefersReducedMotion() {
  return Boolean(
    window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches,
  );
}

function pad(n) {
  return String(Math.max(0, n)).padStart(2, "0");
}

function remainingParts() {
  let ms = GATES_AT - Date.now();
  if (ms < 0) ms = 0;
  const sec = Math.floor(ms / 1000);
  const days = Math.floor(sec / 86400);
  const hours = Math.floor((sec % 86400) / 3600);
  const minutes = Math.floor((sec % 3600) / 60);
  const seconds = sec % 60;
  return { ms, totalSec: sec, days, hours, minutes, seconds, done: ms <= 0 };
}

function phaseFor(parts) {
  if (parts.done) return "sting";
  if (parts.totalSec <= 10) return "finale";
  if (parts.totalSec < 60) return "finalmin";
  if (parts.totalSec <= 600) return "tenmin";
  return "calm";
}

function pulse(el, className, holdMs = 900) {
  if (!el) return;
  el.classList.remove(className);
  void el.offsetWidth;
  el.classList.add(className);
  window.setTimeout(() => el.classList.remove(className), holdMs);
}

function setHand(id, deg) {
  const hand = document.getElementById(id);
  if (hand) hand.setAttribute("transform", `rotate(${deg} 60 74)`);
}

function singaporeClock() {
  const bits = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Singapore",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
    hourCycle: "h23",
  }).formatToParts(new Date());
  const n = (type) => Number(bits.find((p) => p.type === type)?.value || 0);
  return { hour: n("hour"), minute: n("minute"), second: n("second") };
}

function paintAnalog(parts) {
  const gate = document.getElementById("eventGate");
  const analog = document.getElementById("gateAnalog");
  const show = !parts.done && parts.totalSec < 86400 && parts.totalSec > 10;
  if (gate) gate.dataset.gateClock = show ? "on" : "off";
  if (!show || !analog) return;
  const { hour, minute, second } = singaporeClock();
  setHand("gateHandSecond", second * 6);
  setHand("gateHandMinute", minute * 6 + second * 0.1);
  setHand("gateHandHour", (hour % 12) * 30 + minute * 0.5);
}

function applyGatePhase(parts) {
  const gate = document.getElementById("eventGate");
  if (!gate) return;
  const phase = phaseFor(parts);
  gate.dataset.gatePhase = phase;
  if (phase === "finale") gate.dataset.gateSecond = String(parts.seconds);
  else gate.removeAttribute("data-gate-second");

  const overlay = document.getElementById("gateFinaleCount");
  if (overlay)
    overlay.textContent =
      phase === "finale" && parts.seconds > 0 ? String(parts.seconds) : "";

  const minutesEl = document.getElementById("cdMinutes")?.parentElement;
  const secondsEl = document.getElementById("cdSeconds")?.parentElement;
  if (
    !prefersReducedMotion() &&
    phase === "tenmin" &&
    lastMinuteShown != null &&
    parts.minutes !== lastMinuteShown
  ) {
    pulse(minutesEl, "is-minute-flip", 900);
    pulse(gate, "is-minute-flip", 900);
  }
  lastMinuteShown = parts.minutes;

  if (
    lastPhase &&
    lastPhase !== phase &&
    !prefersReducedMotion() &&
    phase === "finalmin"
  ) {
    pulse(secondsEl, "is-handoff", 800);
    pulse(gate, "is-minute-flip", 800);
  }
  lastPhase = phase;

  if (
    !prefersReducedMotion() &&
    phase === "finale" &&
    lastSecondShown !== parts.seconds
  ) {
    pulse(gate, "is-second-beat", 700);
  }
  lastSecondShown = parts.seconds;
}

function paintLive(parts) {
  const live = document.getElementById("eventGateLive");
  if (!live) return;
  if (parts.done) {
    live.textContent = "Gates are open.";
    lastLiveSecond = 0;
    return;
  }
  if (lastLiveSecond === parts.totalSec) return;
  lastLiveSecond = parts.totalSec;
  const phase = phaseFor(parts);
  if (phase === "finale") {
    live.textContent = `${parts.seconds}`;
    return;
  }
  if (phase === "finalmin" || parts.seconds === 0) {
    live.textContent = `${parts.days} days, ${pad(parts.hours)} hours, ${pad(parts.minutes)} minutes, ${pad(parts.seconds)} seconds`;
  }
}

function paintClock() {
  const parts = remainingParts();
  const phase = phaseFor(parts);
  const set = (id, value) => {
    const node = document.getElementById(id);
    if (!node) return;
    if (id === "cdDays") node.textContent = String(parts.days);
    else if (id === "cdSeconds" && phase === "finale")
      node.textContent = String(value);
    else node.textContent = pad(value);
  };
  set("cdDays", parts.days);
  set("cdHours", parts.hours);
  set("cdMinutes", parts.minutes);
  set("cdSeconds", parts.seconds);
  applyGatePhase(parts);
  paintAnalog(parts);
  paintLive(parts);
  return parts.done;
}

function stopClock() {
  if (tickId) {
    window.clearInterval(tickId);
    tickId = 0;
  }
}

function clearSting() {
  if (stingId) {
    window.clearTimeout(stingId);
    stingId = 0;
  }
  stingStarted = false;
}

function finishUnlock() {
  try {
    sessionStorage.setItem(WELCOME_PENDING_KEY, "1");
  } catch {
    /* private mode */
  }
  openEventGate();
}

function beginSting() {
  if (stingStarted) return;
  stingStarted = true;
  stopClock();
  paintClock();
  if (prefersReducedMotion()) {
    finishUnlock();
    return;
  }
  stingId = window.setTimeout(finishUnlock, STING_MS);
}

function startClock() {
  stopClock();
  stingStarted = false;
  lastMinuteShown = null;
  lastSecondShown = null;
  lastLiveSecond = null;
  lastPhase = null;
  if (paintClock()) {
    beginSting();
    return;
  }
  tickId = window.setInterval(() => {
    if (paintClock()) beginSting();
  }, 250);
}

function stripDevQuery() {
  const url = new URL(location.href);
  if (url.searchParams.get(DEV_PARAM) !== DEV_VALUE) return;
  url.searchParams.delete(DEV_PARAM);
  const search = url.searchParams.toString();
  history.replaceState(null, "", url.pathname + (search ? `?${search}` : "") + url.hash);
}

function rememberDevView() {
  let fromQuery = false;
  try {
    fromQuery = new URLSearchParams(location.search).get(DEV_PARAM) === DEV_VALUE;
    if (!fromQuery && sessionStorage.getItem(DEV_KEY) === "1") devLatched = true;
  } catch {
    fromQuery = new URLSearchParams(location.search).get(DEV_PARAM) === DEV_VALUE;
  }
  if (!fromQuery) return;
  devLatched = true;
  let stored = false;
  try {
    sessionStorage.setItem(DEV_KEY, "1");
    stored = sessionStorage.getItem(DEV_KEY) === "1";
  } catch {
    stored = false;
  }
  if (stored) stripDevQuery();
}

export function openEventGate() {
  clearSting();
  stopClock();
  document.documentElement.classList.add("event-open");
  const gate = document.getElementById("eventGate");
  if (gate) {
    gate.hidden = true;
    gate.setAttribute("aria-hidden", "true");
    gate.removeAttribute("data-gate-phase");
    gate.removeAttribute("data-gate-second");
    gate.removeAttribute("data-gate-clock");
    gate.classList.remove("is-second-beat");
  }
  document.querySelectorAll("[data-event-app]").forEach((node) => {
    node.removeAttribute("inert");
    node.removeAttribute("aria-hidden");
  });
  window.dispatchEvent(
    new CustomEvent("scream-gates-opened", { detail: { welcome: true } }),
  );
}

export function lockEventGate() {
  document.documentElement.classList.remove("event-open");
  const gate = document.getElementById("eventGate");
  if (gate) {
    gate.hidden = false;
    gate.setAttribute("aria-hidden", "false");
  }
  document.querySelectorAll("[data-event-app]").forEach((node) => {
    node.setAttribute("inert", "");
    node.setAttribute("aria-hidden", "true");
  });
  if (location.hash)
    history.replaceState(null, "", location.pathname + location.search);
  startClock();
}

export function initEventGate() {
  rememberDevView();
  if (isEventOpen()) {
    openEventGate();
    return;
  }

  lockEventGate();
}
