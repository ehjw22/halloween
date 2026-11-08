// Countdown page switch. false = skip the countdown and land straight on the welcome page.
// Set to true (here AND in js/boot.js) to bring the countdown gate back.
export const COUNTDOWN_ENABLED = false;
// ?dev=scream preview switch. false = the param does nothing for anyone.
// Set to true (here AND in js/boot.js) to bring the dev preview back.
export const DEV_VIEW_ENABLED = false;
// After-event switch. true = everyone sees the "Thank you for coming" page (no tabs, no map).
// Staff pages (#admin, #board) still open at their direct links. Keep in sync with js/boot.js.
// Set to false (here AND in js/boot.js) to bring the normal site back.
export const EVENT_ENDED = true;
export const GATES_AT = Date.parse("2026-10-24T18:00:00+08:00");
// Placeholder until the next Scream Fest date is set. Keep in sync with js/boot.js.
export const NEXT_HALLOWEEN = Date.parse("2027-10-31T00:00:00+08:00");
const OPEN_KEY = "scream-gates-opened";
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
  if (!DEV_VIEW_ENABLED) return false;
  if (devLatched) return true;
  try {
    if (new URLSearchParams(location.search).get(DEV_PARAM) === DEV_VALUE) return true;
    if (sessionStorage.getItem(DEV_KEY) === "1") return true;
  } catch {
    /* private mode */
  }
  return false;
}

export function isDevPreview() {
  return hasDevView();
}

function gatesRemembered() {
  try {
    return localStorage.getItem(OPEN_KEY) === "1";
  } catch {
    return false;
  }
}

function rememberGatesOpened() {
  try {
    localStorage.setItem(OPEN_KEY, "1");
  } catch {
    /* private mode keeps the open night for this visit only */
  }
}

function routeName() {
  return String(location.hash || "").replace(/^#/, "").split("/")[0];
}

function isStaffRoute() {
  const view = routeName();
  return view === "admin" || view === "board";
}

function isLandingHash() {
  const view = routeName();
  return !view || view === "welcome";
}

export function isEventEnded() {
  return EVENT_ENDED && isLandingHash() && !isStaffRoute();
}

function showEndedPage() {
  document.documentElement.classList.remove("event-open", "event-welcome");
  document.documentElement.classList.add("event-ended");
  const when = document.getElementById("eventGateWhen");
  if (when) when.textContent = "Next Halloween · 31 October 2027";
  const gate = document.getElementById("eventGate");
  if (gate) {
    gate.hidden = false;
    gate.setAttribute("aria-hidden", "false");
  }
  const thanks = document.getElementById("eventThanks");
  if (thanks) thanks.hidden = false;
  document.querySelectorAll("[data-event-app]").forEach((node) => {
    node.setAttribute("inert", "");
    node.setAttribute("aria-hidden", "true");
  });
  if (!window.__screamCountdownTest) window.__screamGateUntil = NEXT_HALLOWEEN;
  startClock();
  window.addEventListener("hashchange", () => {
    if (isEventEnded()) return;
    document.documentElement.classList.remove("event-ended");
    openEventGate();
  });
}

export function isEventOpen() {
  if (isEventEnded()) return false;
  if (!COUNTDOWN_ENABLED) return true;
  if (countdownQueryActive()) return Date.now() >= gateUntil();
  if (Date.now() >= GATES_AT) return true;
  if (gatesRemembered()) return true;
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

function isLocalHost() {
  const host = String(location.hostname || "").toLowerCase();
  return host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]";
}

function countdownQueryActive() {
  if (!isLocalHost()) return false;
  if (window.__screamCountdownTest) return true;
  try {
    return /^(\d+)(s|m|h)$/i.test(new URLSearchParams(location.search).get("countdown") || "");
  } catch {
    return false;
  }
}

function gateUntil() {
  const shared = Number(window.__screamGateUntil);
  if (Number.isFinite(shared) && shared > 0) return shared;
  return GATES_AT;
}

function remainingParts() {
  let ms = gateUntil() - Date.now();
  if (ms < 0) ms = 0;
  const sec = Math.floor(ms / 1000);
  const days = Math.floor(sec / 86400);
  const hours = Math.floor((sec % 86400) / 3600);
  const minutes = Math.floor((sec % 3600) / 60);
  const seconds = sec % 60;
  return { ms, totalSec: sec, days, hours, minutes, seconds, done: ms <= 0 };
}

function spanFor(totalSec) {
  if (totalSec >= 86400) return "dhms";
  if (totalSec >= 3600) return "hms";
  if (totalSec >= 60) return "ms";
  return "s";
}

function phaseFor(parts) {
  if (parts.totalSec <= 10) return "finale";
  if (parts.totalSec < 60) return "finalmin";
  return "calm";
}

function pulse(el, className, holdMs = 900) {
  if (!el) return;
  el.classList.remove(className);
  void el.offsetWidth;
  el.classList.add(className);
  window.setTimeout(() => el.classList.remove(className), holdMs);
}

function applyGatePhase(parts) {
  const gate = document.getElementById("eventGate");
  if (!gate) return;
  const phase = phaseFor(parts);
  gate.dataset.gatePhase = phase;
  const clock = document.querySelector(".event-gate__clock");
  if (clock) clock.dataset.span = spanFor(parts.totalSec);
  if (phase === "finale") gate.dataset.gateSecond = String(parts.seconds);
  else gate.removeAttribute("data-gate-second");

  const overlay = document.getElementById("gateFinaleCount");
  if (overlay) overlay.textContent = "";

  const secondsEl = document.getElementById("cdSeconds")?.parentElement;
  if (
    !prefersReducedMotion() &&
    phase === "finale" &&
    lastSecondShown !== parts.seconds
  ) {
    pulse(secondsEl, "is-tick", 450);
  }
  lastSecondShown = parts.seconds;
  lastPhase = phase;
}

function paintLive(parts) {
  const live = document.getElementById("eventGateLive");
  if (!live) return;
  if (lastLiveSecond === parts.totalSec && !parts.done) return;
  lastLiveSecond = parts.totalSec;
  const phase = phaseFor(parts);
  if (parts.done || phase === "finale") {
    live.textContent = String(parts.seconds);
    return;
  }
  if (phase === "finalmin" || parts.seconds === 0) {
    if (parts.totalSec < 60) {
      live.textContent = `${parts.seconds} seconds`;
      return;
    }
    if (parts.totalSec < 3600) {
      live.textContent = `${parts.minutes} minutes, ${pad(parts.seconds)} seconds`;
      return;
    }
    if (parts.totalSec < 86400) {
      live.textContent = `${parts.hours} hours, ${pad(parts.minutes)} minutes, ${pad(parts.seconds)} seconds`;
      return;
    }
    live.textContent = `${parts.days} days, ${pad(parts.hours)} hours, ${pad(parts.minutes)} minutes, ${pad(parts.seconds)} seconds`;
  }
}

function paintClock() {
  const parts = remainingParts();
  const phase = phaseFor(parts);
  const set = (id, value) => {
    const node = document.getElementById(id);
    if (!node) return;
    const next = id === "cdDays" ? String(Math.max(0, parts.days)) : id === "cdSeconds" && phase === "finale" ? String(Math.max(0, value)) : pad(value);
    if (node.textContent !== next) node.textContent = next;
  };
  set("cdDays", parts.days);
  set("cdHours", parts.hours);
  set("cdMinutes", parts.minutes);
  set("cdSeconds", parts.seconds);
  applyGatePhase(parts);
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
  if (Date.now() >= GATES_AT) rememberGatesOpened();
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
    if (!isEventEnded()) beginSting();
    return;
  }
  tickId = window.setInterval(() => {
    if (paintClock() && !isEventEnded()) beginSting();
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
  if (!DEV_VIEW_ENABLED) return;
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
    document.getElementById("cdSeconds")?.parentElement?.classList.remove("is-tick");
    gate.classList.remove("is-tick");
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
  if (isEventEnded()) {
    showEndedPage();
    return;
  }
  rememberDevView();
  if (!countdownQueryActive() && Date.now() >= GATES_AT) rememberGatesOpened();
  if (COUNTDOWN_ENABLED && countdownQueryActive() && Date.now() < gateUntil()) {
    lockEventGate();
    return;
  }
  if (isEventOpen()) {
    openEventGate();
    return;
  }

  lockEventGate();
  window.addEventListener("pageshow", () => {
    if (countdownQueryActive() && Date.now() < gateUntil()) return;
    if (Date.now() < GATES_AT && !gatesRemembered()) return;
    if (Date.now() >= GATES_AT) rememberGatesOpened();
    if (!document.documentElement.classList.contains("event-open")) openEventGate();
  });
}
