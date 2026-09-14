export const GATES_AT = Date.parse("2026-09-14T13:45:00+08:00");
const PREVIEW_KEY = "scream-gate-open";
export const WELCOME_PENDING_KEY = "scream-welcome-pending";
const TRAILER_YOUTUBE_ID = "ek1ePFp-nBI";
const TRAILER_SRC = `https://www.youtube-nocookie.com/embed/${TRAILER_YOUTUBE_ID}?autoplay=1&rel=0`;
const STING_MS = 1500;

let tickId = 0;
let stingId = 0;
let lastMinuteShown = null;
let lastSecondShown = null;
let lastLiveSecond = null;
let lastPhase = null;
let stingStarted = false;

export function isEventOpen() {
  if (Date.now() >= GATES_AT) return true;
  if (new URLSearchParams(location.search).get("preview") === "1") return true;
  try {
    if (sessionStorage.getItem(PREVIEW_KEY) === "1") return true;
  } catch {
    /* private mode */
  }
  return false;
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

function paintAnalog(parts) {
  const gate = document.getElementById("eventGate");
  const analog = document.getElementById("gateAnalog");
  const show = !parts.done && parts.totalSec < 86400 && parts.totalSec >= 60;
  if (gate) gate.dataset.gateClock = show ? "on" : "off";
  if (!show || !analog) return;
  const elapsed = Math.max(0, 86400 - parts.totalSec);
  const sec = elapsed % 60;
  const min = Math.floor(elapsed / 60) % 60;
  const hour = Math.floor(elapsed / 3600) % 12;
  setHand("gateHandSecond", sec * 6);
  setHand("gateHandMinute", min * 6 + sec * 0.1);
  setHand("gateHandHour", hour * 30 + min * 0.5);
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

  if (lastPhase && lastPhase !== phase && !prefersReducedMotion() && phase === "finalmin") {
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
    else if (id === "cdSeconds" && phase === "finale") node.textContent = String(value);
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
    sessionStorage.setItem(PREVIEW_KEY, "1");
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

function stripPreviewQuery() {
  const url = new URL(location.href);
  if (!url.searchParams.has("preview")) return;
  url.searchParams.delete("preview");
  const search = url.searchParams.toString();
  history.replaceState(null, "", url.pathname + (search ? `?${search}` : ""));
}

function syncToggle() {
  const toggle = document.getElementById("eventViewToggle");
  const localBtn = document.getElementById("eventGateLocal");
  const beforeEvent = Date.now() < GATES_AT;
  const open = document.documentElement.classList.contains("event-open");
  if (toggle) {
    toggle.hidden = !beforeEvent;
    toggle.textContent = open ? "Countdown" : "View site";
    toggle.setAttribute("aria-pressed", open ? "true" : "false");
  }
  if (localBtn) localBtn.hidden = open;
}

function closeTrailer() {
  const modal = document.getElementById("trailerModal");
  const frame = document.getElementById("trailerFrame");
  if (modal) modal.hidden = true;
  if (frame) frame.removeAttribute("src");
}

function openTrailer() {
  const modal = document.getElementById("trailerModal");
  const frame = document.getElementById("trailerFrame");
  if (!modal || !frame) return;
  frame.src = TRAILER_SRC;
  modal.hidden = false;
}

export function openEventGate() {
  closeTrailer();
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
  syncToggle();
  window.dispatchEvent(
    new CustomEvent("scream-gates-opened", { detail: { welcome: true } }),
  );
}

export function lockEventGate() {
  closeTrailer();
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
  stripPreviewQuery();
  if (location.hash)
    history.replaceState(null, "", location.pathname + location.search);
  startClock();
  syncToggle();
}

function previewSite() {
  try {
    sessionStorage.setItem(PREVIEW_KEY, "1");
  } catch {
    /* private mode */
  }
  openEventGate();
}

function showCountdown() {
  if (Date.now() >= GATES_AT) return;
  sessionStorage.removeItem(PREVIEW_KEY);
  lockEventGate();
}

export function initEventGate() {
  const toggle = document.getElementById("eventViewToggle");
  if (toggle) {
    toggle.addEventListener("click", () => {
      if (document.documentElement.classList.contains("event-open"))
        showCountdown();
      else previewSite();
    });
  }
  document
    .getElementById("eventGateLocal")
    ?.addEventListener("click", previewSite);
  document
    .getElementById("watchTrailer")
    ?.addEventListener("click", openTrailer);
  document
    .getElementById("trailerModal")
    ?.addEventListener("click", (event) => {
      if (event.target.closest("[data-close-trailer]")) closeTrailer();
    });
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    const modal = document.getElementById("trailerModal");
    if (modal && !modal.hidden) {
      event.preventDefault();
      closeTrailer();
    }
  });

  if (isEventOpen()) {
    openEventGate();
    return;
  }

  lockEventGate();
}
