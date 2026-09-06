export const GATES_AT = Date.parse("2026-10-24T18:00:00+08:00");
const PREVIEW_KEY = "scream-gate-open";
const TRAILER_YOUTUBE_ID = "ek1ePFp-nBI";
const TRAILER_SRC = `https://www.youtube-nocookie.com/embed/${TRAILER_YOUTUBE_ID}?autoplay=1&rel=0`;

let tickId = 0;

export function isLocalHost() {
  const host = location.hostname;
  return host === "127.0.0.1" || host === "localhost";
}

export function isEventOpen() {
  if (Date.now() >= GATES_AT) return true;
  if (new URLSearchParams(location.search).get("preview") === "1" && isLocalHost()) return true;
  if (isLocalHost() && sessionStorage.getItem(PREVIEW_KEY) === "1") return true;
  return false;
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
  return { days, hours, minutes, seconds, done: ms <= 0 };
}

function paintClock() {
  const parts = remainingParts();
  const set = (id, value) => {
    const node = document.getElementById(id);
    if (node) node.textContent = id === "cdDays" ? String(parts.days) : pad(value);
  };
  set("cdDays", parts.days);
  set("cdHours", parts.hours);
  set("cdMinutes", parts.minutes);
  set("cdSeconds", parts.seconds);
  const live = document.getElementById("eventGateLive");
  if (live) {
    live.textContent = parts.done
      ? "Gates are open."
      : `${parts.days} days, ${pad(parts.hours)} hours, ${pad(parts.minutes)} minutes, ${pad(parts.seconds)} seconds`;
  }
  return parts.done;
}

function stopClock() {
  if (tickId) {
    window.clearInterval(tickId);
    tickId = 0;
  }
}

function startClock() {
  stopClock();
  paintClock();
  tickId = window.setInterval(() => {
    if (paintClock()) {
      stopClock();
      sessionStorage.setItem(PREVIEW_KEY, "1");
      openEventGate();
    }
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
  const show = isLocalHost() && beforeEvent;
  if (toggle) {
    toggle.hidden = !show;
    const open = document.documentElement.classList.contains("event-open");
    toggle.textContent = open ? "Countdown" : "View site";
    toggle.setAttribute("aria-pressed", open ? "true" : "false");
  }
  if (localBtn) localBtn.hidden = !show || document.documentElement.classList.contains("event-open");
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
  document.documentElement.classList.add("event-open");
  const gate = document.getElementById("eventGate");
  if (gate) {
    gate.hidden = true;
    gate.setAttribute("aria-hidden", "true");
  }
  document.querySelectorAll("[data-event-app]").forEach((node) => {
    node.removeAttribute("inert");
    node.removeAttribute("aria-hidden");
  });
  stopClock();
  syncToggle();
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
  if (location.hash) history.replaceState(null, "", location.pathname + location.search);
  startClock();
  syncToggle();
}

function previewSite() {
  sessionStorage.setItem(PREVIEW_KEY, "1");
  openEventGate();
}

function showCountdown() {
  sessionStorage.removeItem(PREVIEW_KEY);
  lockEventGate();
}

export function initEventGate() {
  const toggle = document.getElementById("eventViewToggle");
  if (toggle) {
    toggle.addEventListener("click", () => {
      if (document.documentElement.classList.contains("event-open")) showCountdown();
      else previewSite();
    });
  }
  document.getElementById("eventGateLocal")?.addEventListener("click", previewSite);
  document.getElementById("watchTrailer")?.addEventListener("click", openTrailer);
  document.getElementById("trailerModal")?.addEventListener("click", (event) => {
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
