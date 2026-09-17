import { initEventGate, isEventOpen, WELCOME_PENDING_KEY } from "./gate.js";
import { CLUBS } from "./clubs.js";
import { HOUSES, STATUSES } from "./houses.js";
import { BOOTHS, boothById } from "./booths.js";
import { EVENT_DATE_LABEL, SCHEDULE, scheduleStatus } from "./schedule.js";
import { SAFETY } from "./safety.js";
import { applyGhostPass } from "./ghost-pass.js";
import { createStore } from "./store.js";
import {
  apiUrl,
  awardStamp,
  clearAdminSession,
  clearStudentSession,
  fetchAnnouncements,
  fetchFeedback,
  fetchOps,
  fetchStamps,
  getAdminSession,
  getStudentSession,
  lookupStudent,
  postAnnouncement,
  redeemPass,
  setAnnouncementActive,
  signIn,
  submitFeedback,
  normalizeAdminNumber,
} from "./session.js";
import {
  disablePushNotifications,
  enablePushNotifications,
  paintPushHint,
  registerPushWorker,
  resumePushIfWanted,
  setWantsPush,
  syncPushWatch,
} from "./push.js";

let setGamesVisible = () => {};
let flushGameProgress = () => {};
let applyGameAccount = () => {};

const STATUS_LABEL = Object.fromEntries(STATUSES.map((s) => [s.id, s.label]));
const STAMP_SLOTS = BOOTHS.map((b) => ({
  id: Number(b.id),
  icon: b.icon,
  label: b.name,
}));

const els = {
  views: [...document.querySelectorAll(".view")],
  navButtons: [...document.querySelectorAll("[data-nav]")],
  houseGrid: document.getElementById("houseGrid"),
  shortWaits: document.getElementById("shortWaits"),
  mapWorld: document.getElementById("mapWorld"),
  mapViewport: document.getElementById("mapViewport"),
  mapPins: document.getElementById("mapPinLayer"),
  zoomLabel: document.getElementById("zoomLabel"),
  liveMode: document.getElementById("liveMode"),
  modal: document.getElementById("detailModal"),
  stampRoadmap: document.getElementById("stampRoadmap"),
  stampGrid: document.getElementById("stampGrid"),
  stampModal: document.getElementById("stampModal"),
  boothModal: document.getElementById("boothModal"),
  boothsModal: document.getElementById("boothsModal"),
  stampForm: document.getElementById("stampForm"),
  stampBy: document.getElementById("stampBy"),
  stampPass: document.getElementById("stampPass"),
  stampError: document.getElementById("stampError"),
  stampHolderName: document.getElementById("stampHolderName"),
  stampHolderId: document.getElementById("stampHolderId"),
  stampFill: document.getElementById("stampFill"),
  stampProgress: document.getElementById("stampProgress"),
  passId: document.getElementById("passId"),
  adminGate: document.getElementById("adminGate"),
  adminApp: document.getElementById("adminApp"),
  adminForm: document.getElementById("adminPassForm"),
  adminTable: document.getElementById("adminTable"),
  autoSave: document.getElementById("autoSave"),
  publishAll: document.getElementById("publishAll"),
  waitSaveStatus: document.getElementById("waitSaveStatus"),
  dbBanner: document.getElementById("dbBanner"),
  studentAuth: document.getElementById("studentAuth"),
  studentAuthForm: document.getElementById("studentAuthForm"),
  studentAuthError: document.getElementById("studentAuthError"),
  stampApp: document.getElementById("stampApp"),
  sessionChip: document.getElementById("sessionChip"),
  passHolder: document.getElementById("passHolder"),
  passAdmin: document.getElementById("passAdmin"),
  lanternRaise: document.getElementById("lanternRaise"),
  lanternHint: document.getElementById("lanternHint"),
  passKicker: document.getElementById("passKicker"),
  passUsedMark: document.getElementById("passUsedMark"),
  redeemedNote: document.getElementById("redeemedNote"),
  adminAuthError: document.getElementById("adminAuthError"),
  fastPassCard: document.getElementById("fastPassCard"),
  feedbackForm: document.getElementById("feedbackForm"),
  feedbackKind: document.getElementById("feedbackKind"),
  feedbackTarget: document.getElementById("feedbackTarget"),
  feedbackError: document.getElementById("feedbackError"),
  feedbackOk: document.getElementById("feedbackOk"),
  awardStampForm: document.getElementById("awardStampForm"),
  awardBooth: document.getElementById("awardBooth"),
  awardStampError: document.getElementById("awardStampError"),
  awardStampOk: document.getElementById("awardStampOk"),
  adminFeedbackList: document.getElementById("adminFeedbackList"),
  adminFeedbackTarget: document.getElementById("adminFeedbackTarget"),
  adminFeedbackError: document.getElementById("adminFeedbackError"),
  announceStrip: document.getElementById("announceStrip"),
  announceList: document.getElementById("announceList"),
  nightTimeline: document.getElementById("nightTimeline"),
  announceForm: document.getElementById("announceForm"),
  announceError: document.getElementById("announceError"),
  adminAnnounceList: document.getElementById("adminAnnounceList"),
};

let store;
let houses = HOUSES.map((h) => ({
  id: h.id,
  name: h.name,
  wait_minutes: h.wait,
  status: h.status,
}));
let pendingStampId = null;
let staffTab = "waits";
let feedbackKindFilter = "";
let stampPoll = 0;
let waitSync = { liveOk: false, wasLive: false, lastLiveAt: null };
let autoSave = true;
let cardState = { stamps: {}, redeemedAt: null, redeemedBy: null, fullName: "", studentNumber: "", passId: "" };
const drafts = new Map();
const houseFilter = { q: "", status: "", tag: "" };

const mapState = {
  scale: 1,
  x: 0,
  y: 0,
  min: 0.6,
  max: 3.2,
  dragging: false,
  pointers: new Map(),
  lastPinch: 0,
};

function houseMeta(id) {
  return HOUSES.find((h) => h.id === id);
}

function waitLabel(minutes, status) {
  if (status === "closed") return "Closed";
  if (status === "at_capacity") return `${minutes} min · Full`;
  if (!minutes) return "Walk in";
  return `${minutes} min`;
}

function waitRank(row) {
  const status = row.status || "open";
  const band = status === "closed" ? 2 : status === "at_capacity" ? 1 : 0;
  return band * 1000 + (Number(row.wait_minutes) || 0);
}

function sortedHouses(list = houses) {
  return [...list].sort((a, b) => waitRank(a) - waitRank(b) || a.name.localeCompare(b.name));
}

function houseSearchHay(row) {
  const meta = houseMeta(row.id);
  return `${row.name} ${meta?.short || ""} ${row.id}`.toLowerCase();
}

function houseMatchesFilter(row) {
  const q = houseFilter.q.trim().toLowerCase();
  if (q && !houseSearchHay(row).includes(q)) return false;
  const wait = Number(row.wait_minutes) || 0;
  if (houseFilter.status === "walkin") {
    if (row.status === "closed" || row.status === "at_capacity" || wait !== 0) return false;
  } else if (houseFilter.status === "queue") {
    if (row.status !== "open" && row.status !== "busy") return false;
  } else if (houseFilter.status === "at_capacity") {
    if (row.status !== "at_capacity") return false;
  } else if (houseFilter.status === "closed") {
    if (row.status !== "closed") return false;
  }
  if (houseFilter.tag) {
    const tags = houseMeta(row.id)?.tags || [];
    if (!tags.includes(houseFilter.tag)) return false;
  }
  return true;
}

function filterIsActive() {
  return Boolean(houseFilter.q.trim() || houseFilter.status || houseFilter.tag);
}

function filteredHouses() {
  return sortedHouses().filter(houseMatchesFilter);
}

function goNowHouses() {
  let list = sortedHouses().filter((row) => row.status === "open" || row.status === "busy");
  const q = houseFilter.q.trim().toLowerCase();
  if (q) list = list.filter((row) => houseSearchHay(row).includes(q));
  return list.slice(0, 3);
}

function paintHouseFilters() {
  document.querySelectorAll("[data-filter-status]").forEach((btn) => {
    btn.classList.toggle("is-on", btn.dataset.filterStatus === houseFilter.status);
  });
  document.querySelectorAll("[data-filter-tag]").forEach((btn) => {
    btn.classList.toggle("is-on", btn.dataset.filterTag === houseFilter.tag);
  });
}

function freshnessLabel(iso) {
  if (!iso) return "Not updated";
  const { ago } = formatPostedAt(iso);
  return ago ? `Updated ${ago}` : "Not updated";
}

function tagChips(meta) {
  return (meta?.tags || []).map((t) => `<span class="tag-chip">${escapeHtml(t)}</span>`).join("");
}

function staffScope() {
  return getAdminSession()?.payload?.staffScope || "admin";
}

function canStaff(tab) {
  const scope = staffScope();
  if (scope === "admin") return true;
  if (tab === "waits") return scope === "waits";
  if (tab === "stamps") return scope === "stamps";
  return false;
}

function nightStorageKey() {
  const student = getStudentSession();
  if (student?.payload?.studentNumber) return `scream-night:${student.payload.studentNumber}`;
  return "";
}

function readNight() {
  try {
    const key = nightStorageKey();
    const raw = key ? localStorage.getItem(key) : sessionStorage.getItem("scream-night-guest");
    return JSON.parse(raw || "null") || { houses: [], watch: [] };
  } catch {
    return { houses: [], watch: [] };
  }
}

function writeNight(data) {
  const payload = JSON.stringify({
    houses: [...new Set(data.houses || [])],
    watch: [...new Set(data.watch || [])],
  });
  const key = nightStorageKey();
  if (key) localStorage.setItem(key, payload);
  else sessionStorage.setItem("scream-night-guest", payload);
}

let watchSnapshot = new Map();
let openHouseId = "";
let boardTimer = 0;

const WELCOME_SEEN_KEY = "scream-welcome-seen";

function hashToView() {
  const raw = (location.hash || "#map").replace(/^#/, "");
  const [view, extra] = raw.split("/");
  return { view: view || "map", extra: extra || "" };
}

function welcomeSeen() {
  try {
    return sessionStorage.getItem(WELCOME_SEEN_KEY) === "1";
  } catch {
    return false;
  }
}

function markWelcomeSeen() {
  try {
    sessionStorage.setItem(WELCOME_SEEN_KEY, "1");
  } catch {
    /* private mode */
  }
  try {
    sessionStorage.removeItem(WELCOME_PENDING_KEY);
  } catch {
    /* private mode */
  }
  document.documentElement.classList.remove("event-welcome");
}

function wantsOpeningNight() {
  if (welcomeSeen()) return false;
  const raw = (location.hash || "").replace(/^#/, "");
  const view = raw.split("/")[0];
  if (view === "admin" || view === "board") return false;
  return true;
}

function setHash(view, extra) {
  const next = extra ? `#${view}/${extra}` : `#${view}`;
  if (location.hash !== next) history.replaceState(null, "", next);
}

function setView(name, extra) {
  if (!isEventOpen()) {
    if (location.hash) history.replaceState(null, "", location.pathname + location.search);
    return;
  }
  const student = getStudentSession();
  const admin = getAdminSession();
  if (name === "admin" && !admin) name = "login";
  if (name === "login" && admin) name = "admin";
  else if (name === "login" && student) name = "stamps";
  if (name === "house") {
    name = "map";
    if (extra) openHouse(extra);
  } else {
    closeModals();
  }
  if (name === "welcome") {
    document.documentElement.classList.add("event-welcome");
  } else if (document.documentElement.classList.contains("event-welcome")) {
    markWelcomeSeen();
  }
  els.views.forEach((view) => {
    const active = view.dataset.view === name;
    view.classList.toggle("is-active", active);
    view.hidden = !active;
  });
  document.body.classList.toggle("is-board", name === "board");
  document.querySelectorAll(".nav [data-nav]").forEach((btn) => {
    const on = btn.dataset.nav === name;
    btn.classList.toggle("is-active", on);
    if (on) btn.setAttribute("aria-current", "page");
    else btn.removeAttribute("aria-current");
  });
  setGamesVisible(name === "games");
  if (!setView.skipHash) {
    if (name === "map" && extra) setHash("house", extra);
    else if (name === "map") setHash("map");
    else setHash(name);
  }
  setView.skipHash = false;
  if (name === "admin") renderAdmin();
  if (name === "tonight") {
    renderTimeline();
    loadPublicAnnouncements();
  }
  if (name === "feedback") fillFeedbackTargets();
  if (name === "stamps") {
    updateNav();
    paintStampUi();
  }
  if (name === "map") {
    renderMyNight();
    requestAnimationFrame(() => fitMap());
  }
  if (name === "safety") paintSafety();
  if (name === "follow") paintClubs();
  if (name === "board") startBoard();
  else stopBoard();
  setMoreMenu(false);
}

function toggleWatchHouse(id) {
  if (!id) return;
  const night = readNight();
  const watching = night.watch.includes(id);
  night.watch = watching ? night.watch.filter((hid) => hid !== id) : [...night.watch, id];
  writeNight(night);
  renderDashboard();
  renderPins();
  if (openHouseId === id && els.modal && !els.modal.hidden) openHouse(id);
  if (!watching) {
    setWantsPush(true);
    enablePushNotifications(night.watch).then((result) => {
      paintPushHint();
      if (result?.ok) {
        showWaitToast("Walk-in alert on", "We’ll ping this phone when the wait hits 0 minutes.", false);
        return;
      }
      if (result?.reason === "ios-install") {
        showWaitToast("Add to Home Screen", "On iPhone, install the app first, then tap Alert when walk-in again.", false);
        return;
      }
      if (result?.reason === "denied") {
        showWaitToast("Notifications blocked", "Allow notifications for this site in your phone settings.", false);
        return;
      }
      showWaitToast("Walk-in alert on", "You’ll see a message here when the wait hits 0. Phone alerts need notification permission.", false);
    }).catch(paintPushHint);
  } else {
    syncPushWatch(night.watch);
    showWaitToast("Alert off", "This house will no longer ping you at 0 minutes.", false);
  }
}

function renderDashboard() {
  paintHouseFilters();
  const goNow = goNowHouses();
  if (els.shortWaits) {
    els.shortWaits.innerHTML = goNow.length
      ? `<div class="short-waits__head">
          <p class="short-waits__kicker">Shortest queues</p>
          <h3>Go now</h3>
          <p class="short-waits__hint">These houses are open with the shortest waits. Walk in if it says 0 minutes — tap a card to open it.</p>
        </div>
        <div class="short-waits__row">${goNow.map((row) => {
        const meta = houseMeta(row.id);
        const walkIn = row.status !== "closed" && row.status !== "at_capacity" && !(Number(row.wait_minutes) > 0);
        return `<button type="button" class="short-wait${walkIn ? " short-wait--walkin" : ""}" data-open-house="${escapeHtml(row.id)}">
          <span class="short-wait__code">${escapeHtml(meta?.short || "")}</span>
          <strong class="short-wait__name">${escapeHtml(row.name)}</strong>
          <span class="short-wait__wait">${escapeHtml(waitLabel(row.wait_minutes, row.status))}</span>
        </button>`;
      }).join("")}</div>`
      : "";
  }
  if (!els.houseGrid) return;
  const list = filteredHouses();
  const watching = new Set(readNight().watch);
  if (!list.length) {
    els.houseGrid.innerHTML = `<div class="empty-state house-filters__empty"><p class="empty-state__title">No houses match</p><p class="empty-state__hint">Clear a filter or try a different search.</p></div>`;
    renderMyNight();
    return;
  }
  els.houseGrid.innerHTML = list
    .map((row) => {
      const meta = houseMeta(row.id);
      const on = watching.has(row.id);
      return `
        <article class="house-card status-${row.status}">
          <button class="house-card__open" type="button" data-open-house="${escapeHtml(row.id)}">
            <span class="house-card__short">${escapeHtml(meta?.short || "")}</span>
            <strong>${escapeHtml(row.name)}</strong>
            <span class="status-pill">${STATUS_LABEL[row.status] || row.status}</span>
            <span class="wait">${waitLabel(row.wait_minutes, row.status)}</span>
            <span class="fresh muted">${escapeHtml(freshnessLabel(row.updated_at))}</span>
            <span class="house-tags">${tagChips(meta)}</span>
          </button>
          <button class="house-card__watch${on ? " is-on" : ""}" type="button" data-watch-house="${escapeHtml(row.id)}" aria-pressed="${on}">${on ? "Alert on" : "Alert"}</button>
        </article>`;
    })
    .join("");
  renderMyNight();
}

function renderMyNight() {
  const panel = document.getElementById("myNightPanel");
  const list = document.getElementById("myNightList");
  const hint = document.getElementById("myNightHint");
  if (!panel || !list) return;
  const night = readNight();
  const rows = sortedHouses(night.houses.map((id) => houses.find((h) => h.id === id)).filter(Boolean));
  panel.hidden = false;
  if (hint) hint.hidden = rows.length > 0;
  list.innerHTML = rows.map((row) => {
    const meta = houseMeta(row.id);
    return `<li><button type="button" data-open-house="${escapeHtml(row.id)}">${escapeHtml(meta?.short || "")} · ${escapeHtml(row.name)} · ${escapeHtml(waitLabel(row.wait_minutes, row.status))}</button></li>`;
  }).join("");
}

function showWaitToast(title, body, walkIn = false) {
  const host = document.getElementById("waitToasts");
  if (!host) return;
  const el = document.createElement("aside");
  el.className = `wait-toast${walkIn ? " wait-toast--go" : ""}`;
  el.innerHTML = `<strong>${escapeHtml(title)}</strong><span>${escapeHtml(body)}</span>`;
  host.appendChild(el);
  while (host.children.length > 3) host.removeChild(host.firstChild);
  setTimeout(() => {
    el.remove();
  }, walkIn ? 12000 : 8000);
}

function phoneNotify(title, body, url) {
  if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
  const options = {
    body,
    icon: "/icons/icon-192.png",
    badge: "/icons/icon-192.png",
    tag: url || "scream-wait",
    data: { url: url || "/#map" },
  };
  if (navigator.serviceWorker?.ready) {
    navigator.serviceWorker.ready.then((reg) => reg.showNotification(title, options)).catch(() => {
      try {
        new Notification(title, options);
      } catch {
        /* ignore */
      }
    });
    return;
  }
  try {
    new Notification(title, options);
  } catch {
    /* ignore */
  }
}

function notifyWatches(nextHouses) {
  const night = readNight();
  if (!night.watch.length) {
    watchSnapshot = new Map(nextHouses.map((h) => [h.id, `${h.wait_minutes}:${h.status}`]));
    return;
  }
  nextHouses.forEach((row) => {
    if (!night.watch.includes(row.id)) return;
    const prev = watchSnapshot.get(row.id);
    const key = `${row.wait_minutes}:${row.status}`;
    if (!prev || prev === key) return;
    const [prevWait] = String(prev).split(":");
    const wasWait = Number(prevWait);
    const nowWait = Number(row.wait_minutes) || 0;
    const meta = houseMeta(row.id);
    const label = meta?.short || row.name;
    const walkIn = nowWait === 0 && row.status !== "closed" && row.status !== "at_capacity" && wasWait > 0;
    const title = walkIn ? "Walk in now" : label;
    const body = walkIn
      ? `${row.name} is 0 minutes. Head over.`
      : `${row.name}: ${waitLabel(row.wait_minutes, row.status)}`;
    showWaitToast(title, body, walkIn);
    if (walkIn || document.hidden) phoneNotify(title, body, `/#house/${row.id}`);
  });
  watchSnapshot = new Map(nextHouses.map((h) => [h.id, `${h.wait_minutes}:${h.status}`]));
}

function paintSafety() {
  const list = document.getElementById("safetyList");
  if (!list) return;
  const lines = [
    SAFETY.helpDesk,
    SAFETY.meetup,
    SAFETY.firstAid,
    SAFETY.skipHouse,
    SAFETY.intensity,
    "Stay with your group. Watch your step in fog, cables, and low light. No running in queues.",
    "Drink water and take a break if you feel unwell.",
    "Keep bags closed. Respect capacity and closed areas. Staff calls are final.",
  ];
  list.innerHTML = lines.map((line) => `<li>${escapeHtml(line)}</li>`).join("");
}

function paintClubs() {
  const credits = document.getElementById("clubCredits");
  if (credits) {
    credits.textContent = CLUBS.map((club) => club.abbr).join(" · ");
  }
  const list = document.getElementById("clubFollowList");
  if (!list) return;
  list.innerHTML = CLUBS.map((club) => `
    <article class="club-card">
      <p class="club-card__abbr">${escapeHtml(club.abbr)}</p>
      <h3>${escapeHtml(club.name)}</h3>
      <p class="club-card__links">
        <a href="${escapeHtml(club.instagram)}" target="_blank" rel="noopener noreferrer">Instagram</a>
        <a href="mailto:${escapeHtml(club.email)}">Email</a>
      </p>
    </article>
  `).join("");
}

async function startBoard() {
  const grid = document.getElementById("boardGrid");
  if (!grid) return;
  async function paint() {
    const games = ["clicker", "memory", "catch"];
    const blocks = await Promise.all(games.map(async (id) => {
      try {
        const res = await fetch(apiUrl("scores", { game: id }));
        const data = await res.json().catch(() => ({}));
        const title = id === "clicker" ? "Pumpkin clicker" : id === "memory" ? "Memory match" : "Catch the treats";
        const rows = (data.top || []).map((row, i) => `<li><span>${i + 1}. ${escapeHtml(row.name)}</span><strong>${Number(row.score) || 0}</strong></li>`).join("");
        return `<article class="board-card"><h3>${title}</h3><ol>${rows || "<li class='empty-state__hint'>No scores yet</li>"}</ol></article>`;
      } catch {
        return `<article class="board-card"><h3>${id === "clicker" ? "Pumpkin clicker" : id === "memory" ? "Memory match" : "Catch the treats"}</h3><p class="empty-state__hint">Scores unavailable</p></article>`;
      }
    }));
    grid.innerHTML = blocks.join("");
  }
  paint();
  clearInterval(boardTimer);
  boardTimer = setInterval(paint, 12000);
}

function stopBoard() {
  clearInterval(boardTimer);
  boardTimer = 0;
}

function mapImageSize() {
  const img = els.mapWorld?.querySelector("img");
  return {
    img,
    width: img?.naturalWidth || img?.clientWidth || 0,
    height: img?.naturalHeight || img?.clientHeight || 0,
  };
}

const MAP_VB = { w: 2301, h: 1405 };
const BOOTHS_PIN = { x: 67.14, y: 35.23 };

function pctToSvg(x, y) {
  return { cx: (Number(x) / 100) * MAP_VB.w, cy: (Number(y) / 100) * MAP_VB.h };
}

function renderPins() {
  const layer = document.getElementById("mapPinLayer");
  if (!layer) return;
  const watching = new Set(readNight().watch);
  const filtering = filterIsActive();
  const housePins = HOUSES.map((house) => {
    const { cx, cy } = pctToSvg(house.x, house.y);
    const row = houses.find((h) => h.id === house.id) || house;
    const status = row.status || house.status || "open";
    const label = escapeHtml(house.short || house.name);
    const match = houseMatchesFilter(row);
    const dim = filtering && !match;
    const on = watching.has(house.id);
    const wx = (cx + 34).toFixed(1);
    const wy = (cy - 22).toFixed(1);
    return `<g class="map-pin status-${status}${dim ? " map-pin--dim" : ""}${on ? " map-pin--watch" : ""}" data-open-house="${escapeHtml(house.id)}" tabindex="0" role="button" aria-label="${escapeHtml(house.name)}">
      <text class="map-pin__label" x="${cx.toFixed(1)}" y="${(cy - 34).toFixed(1)}" text-anchor="middle">${label}</text>
      <circle class="map-pin__ring" cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="30"></circle>
      <circle class="map-pin__mark" cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="22"></circle>
      <g class="map-pin__watch${on ? " is-on" : ""}" data-watch-house="${escapeHtml(house.id)}" tabindex="0" role="button" aria-label="Walk-in alert">
        <circle class="map-pin__watch-hit" cx="${wx}" cy="${wy}" r="16"></circle>
        <path class="map-pin__watch-icon" d="M${Number(wx) - 7} ${Number(wy) + 2}c0-5 3-8 7-8s7 3 7 8v4l2 3H${Number(wx) - 9}l2-3z M${wx} ${Number(wy) + 10}a2.5 2.5 0 0 0 2.5-2.5" fill="none" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"/>
      </g>
    </g>`;
  });
  const booth = pctToSvg(BOOTHS_PIN.x, BOOTHS_PIN.y);
  const boothPin = `<g class="map-pin map-pin--booths" data-open-booths tabindex="0" role="button" aria-label="Booths at Eleven Square">
    <text class="map-pin__label" x="${booth.cx.toFixed(1)}" y="${(booth.cy - 34).toFixed(1)}" text-anchor="middle">Booths</text>
    <circle class="map-pin__mark" cx="${booth.cx.toFixed(1)}" cy="${booth.cy.toFixed(1)}" r="22"></circle>
  </g>`;
  layer.innerHTML = housePins.join("") + boothPin;
}

function paintBoothsPinList() {
  const list = document.getElementById("boothsPinList");
  if (!list || list.dataset.filled) return;
  list.innerHTML = BOOTHS.map(
    (b) => `<button type="button" class="booths-list__btn" data-open-booth="${escapeHtml(b.id)}">
      <span>${escapeHtml(b.icon)} ${escapeHtml(b.short)}</span>
      <strong>${escapeHtml(b.name)}</strong>
      <small>${escapeHtml(b.place)}</small>
    </button>`
  ).join("");
  list.dataset.filled = "1";
}

function openBooths() {
  paintBoothsPinList();
  const modal = els.boothsModal;
  if (!modal) return;
  modal.hidden = false;
  modal.querySelector(".modal__panel")?.focus();
}

function applyMapTransform() {
  if (!els.mapWorld) return;
  els.mapWorld.style.transform = `translate(${mapState.x}px, ${mapState.y}px) scale(${mapState.scale})`;
  els.mapWorld.style.setProperty("--map-scale", String(mapState.scale || 1));
  if (els.zoomLabel) els.zoomLabel.textContent = `${Math.round(mapState.scale * 100)}%`;
}

function sizeMapWorld() {
  const { img, width, height } = mapImageSize();
  if (!img || !width || !height || !els.mapWorld) return;
  img.style.width = `${width}px`;
  img.style.height = `${height}px`;
  els.mapWorld.style.width = `${width}px`;
  els.mapWorld.style.height = `${height}px`;
}

function fitMap() {
  const img = els.mapWorld?.querySelector("img");
  if (!img || !els.mapViewport) return;
  sizeMapWorld();
  renderPins();
  const vp = els.mapViewport.getBoundingClientRect();
  const w = img.naturalWidth || img.clientWidth || 1600;
  const h = img.naturalHeight || img.clientHeight || 900;
  if (!vp.width || !vp.height || !w || !h) return;
  const fit = Math.min(vp.width / w, vp.height / h);
  mapState.min = fit * 0.85;
  mapState.max = Math.max(2.4, fit * 6);
  mapState.scale = Math.min(mapState.max, fit);
  mapState.x = (vp.width - w * mapState.scale) / 2;
  mapState.y = (vp.height - h * mapState.scale) / 2;
  applyMapTransform();
}

function zoomAt(clientX, clientY, nextScale) {
  const rect = els.mapViewport.getBoundingClientRect();
  const cx = clientX - rect.left;
  const cy = clientY - rect.top;
  const clamped = Math.min(mapState.max, Math.max(mapState.min, nextScale));
  const ratio = clamped / mapState.scale;
  mapState.x = cx - (cx - mapState.x) * ratio;
  mapState.y = cy - (cy - mapState.y) * ratio;
  mapState.scale = clamped;
  applyMapTransform();
}

function resetMap() {
  fitMap();
}

function openHouse(id) {
  const meta = houseMeta(id);
  const row = houses.find((h) => h.id === id);
  if (!meta || !row || !els.modal) return;
  openHouseId = id;
  els.modal.querySelector("[data-modal-title]").textContent = meta.name;
  els.modal.querySelector("[data-modal-wait]").textContent = waitLabel(row.wait_minutes, row.status);
  els.modal.querySelector("[data-modal-status]").textContent = STATUS_LABEL[row.status];
  els.modal.querySelector("[data-modal-status]").className = `status-pill status-${row.status}`;
  els.modal.querySelector("[data-modal-story]").textContent = meta.story;
  els.modal.querySelector("[data-modal-code]").textContent = meta.short;
  const tagsEl = els.modal.querySelector("[data-modal-tags]");
  if (tagsEl) tagsEl.innerHTML = tagChips(meta) || "";
  const upd = els.modal.querySelector("[data-modal-updated]");
  if (upd) upd.textContent = freshnessLabel(row.updated_at);
  const night = readNight();
  const addBtn = document.getElementById("modalAddNight");
  const watchBtn = document.getElementById("modalWatch");
  if (addBtn) addBtn.textContent = night.houses.includes(id) ? "Remove from my night" : "Add to my night";
  if (watchBtn) watchBtn.textContent = night.watch.includes(id) ? "Stop walk-in alert" : "Alert when walk-in";
  els.modal.hidden = false;
  els.modal.querySelector(".modal__panel").focus();
  setHash("house", id);
}

function openBooth(id) {
  const booth = boothById(id);
  const modal = els.boothModal;
  if (!booth || !modal) return;
  const stamped = cardState.stamps[slotKey(id)] || cardState.stamps[Number(id)];
  modal.querySelector("[data-booth-code]").textContent = booth.short;
  modal.querySelector("[data-booth-title]").textContent = booth.name;
  modal.querySelector("[data-booth-place]").textContent = booth.place;
  modal.querySelector("[data-booth-summary]").textContent = booth.summary;
  modal.querySelector("[data-booth-about]").textContent = booth.about;
  modal.querySelector("[data-booth-stamp]").textContent = stamped
    ? `Collected · staff ${stamped.by}`
    : "Not on your card yet. Staff award this after you finish the booth.";
  modal.hidden = false;
  modal.querySelector(".modal__panel").focus();
}

function slotKey(id) {
  return String(id);
}

function closeModals() {
  if (els.modal) els.modal.hidden = true;
  if (els.boothModal) els.boothModal.hidden = true;
  if (els.boothsModal) els.boothsModal.hidden = true;
  if (els.stampModal) els.stampModal.hidden = true;
  pendingStampId = null;
}

function isAdminUnlocked() {
  return Boolean(getAdminSession());
}

function updateNav() {
  const student = Boolean(getStudentSession());
  const admin = Boolean(getAdminSession());
  document.querySelectorAll("[data-nav]").forEach((btn) => {
    const show = btn.dataset.navShow;
    if (show === "guest") btn.hidden = student || admin;
    else if (show === "admin") btn.hidden = !admin;
    else btn.hidden = false;
  });
  renderSessionChip();
}

function renderSessionChip() {
  const student = getStudentSession();
  const admin = getAdminSession();
  if (!els.sessionChip) return;
  if (student && admin) {
    els.sessionChip.hidden = false;
    els.sessionChip.innerHTML = `<span>${escapeHtml(student.payload.name)}</span><button type="button" data-logout="student">Log out</button><span>Staff · ${escapeHtml(admin.payload.staffId)}</span><button type="button" data-logout="admin">Staff out</button>`;
  } else if (student) {
    els.sessionChip.hidden = false;
    els.sessionChip.innerHTML = `<span>${escapeHtml(student.payload.name)}</span><button type="button" data-logout="student">Log out</button>`;
  } else if (admin) {
    els.sessionChip.hidden = false;
    els.sessionChip.innerHTML = `<span>Staff · ${escapeHtml(admin.payload.name || admin.payload.staffId)}</span><button type="button" data-logout="admin">Log out</button>`;
  } else {
    els.sessionChip.hidden = true;
    els.sessionChip.innerHTML = "";
  }
  paintLiveChip();
}

function paintLiveChip() {
  if (!els.liveMode) return;
  els.liveMode.hidden = !getAdminSession();
}

function stampCount(stamps = cardState.stamps) {
  return STAMP_SLOTS.filter((slot) => stamps[slot.id] || stamps[String(slot.id)]).length;
}

async function loadCardFromServer() {
  const session = getStudentSession();
  if (!session) {
    cardState = { stamps: {}, redeemedAt: null, redeemedBy: null, fullName: "", studentNumber: "", passId: "" };
    return;
  }
  const data = await fetchStamps();
  cardState = {
    stamps: data.stamps || {},
    redeemedAt: data.redeemedAt || null,
    redeemedBy: data.redeemedBy || null,
    fullName: data.fullName || session.payload.name,
    studentNumber: data.studentNumber || session.payload.studentNumber,
    passId: data.passId || `SP-FP-${session.payload.studentNumber}`,
  };
}

let spiritRaised = false;
let ghostRoaming = false;
let ghostRoamGen = 0;
let ghostRoamFrame = 0;

function stopGhostRoam() {
  ghostRoamGen += 1;
  if (ghostRoamFrame) cancelAnimationFrame(ghostRoamFrame);
  ghostRoamFrame = 0;
  ghostRoaming = false;
  document.querySelectorAll(".ghost--roam, .ghost-trail, .ghost-wisp").forEach((node) => node.remove());
  els.fastPassCard?.classList.remove("is-roaming");
}

function roamGhost() {
  const card = els.fastPassCard;
  const ghost = card?.querySelector(".ghost");
  if (!card || !ghost || ghostRoaming) return;
  if (card.classList.contains("is-redeemed") || !card.classList.contains("is-complete")) return;

  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    spiritRaised = !spiritRaised;
    paintStampUi();
    return;
  }

  const gen = ++ghostRoamGen;
  ghostRoaming = true;
  spiritRaised = true;
  card.classList.add("is-roaming");
  if (els.lanternHint) els.lanternHint.textContent = "Your spirit is loose — it will come back";

  const home = () => ghost.getBoundingClientRect();
  const start = home();
  const hue = getComputedStyle(card).getPropertyValue("--ghost-h");
  const sat = getComputedStyle(card).getPropertyValue("--ghost-s");
  const clone = ghost.cloneNode(true);
  clone.classList.add("ghost--roam");
  clone.setAttribute("aria-hidden", "true");
  clone.style.setProperty("--ghost-h", hue);
  clone.style.setProperty("--ghost-s", sat);
  clone.style.width = `${start.width}px`;
  document.body.appendChild(clone);

  let x = start.left;
  let y = start.top;
  let vx = (Math.random() > 0.5 ? 1 : -1) * (2.2 + Math.random() * 1.1);
  let vy = -1.4 - Math.random() * 1.2;
  let lastTrail = 0;
  const t0 = performance.now();
  const roamMs = 8200;
  const homeMs = 980;
  let phase = "roam";
  let homeFrom = { x, y };
  let homeT0 = t0;

  const dropTrail = (now) => {
    if (now - lastTrail < 58) return;
    lastTrail = now;
    const extras = document.querySelectorAll(".ghost-trail");
    if (extras.length > 10) extras[0].remove();
    const trail = clone.cloneNode(true);
    trail.classList.remove("ghost--roam");
    trail.classList.add("ghost-trail");
    trail.style.left = `${x}px`;
    trail.style.top = `${y}px`;
    trail.style.width = `${start.width}px`;
    trail.style.setProperty("--ghost-h", hue);
    trail.style.setProperty("--ghost-s", sat);
    document.body.appendChild(trail);
    window.setTimeout(() => trail.remove(), 720);
    const wisp = document.createElement("i");
    wisp.className = "ghost-wisp";
    wisp.style.left = `${x + start.width * (0.28 + Math.random() * 0.4)}px`;
    wisp.style.top = `${y + start.height * (0.35 + Math.random() * 0.3)}px`;
    wisp.style.setProperty("--ghost-h", hue);
    wisp.style.setProperty("--ghost-s", sat);
    document.body.appendChild(wisp);
    window.setTimeout(() => wisp.remove(), 980);
  };

  const finish = () => {
    if (gen !== ghostRoamGen) return;
    clone.remove();
    document.querySelectorAll(".ghost-trail, .ghost-wisp").forEach((node) => node.remove());
    ghostRoaming = false;
    card.classList.remove("is-roaming");
    paintStampUi();
  };

  const tick = (now) => {
    if (gen !== ghostRoamGen) return;
    const minX = 10;
    const minY = 58;
    const maxX = Math.max(minX, window.innerWidth - start.width - 10);
    const maxY = Math.max(minY, window.innerHeight - start.height - 12);

    if (phase === "roam" && now - t0 >= roamMs) {
      phase = "home";
      homeFrom = { x, y };
      homeT0 = now;
    }

    if (phase === "roam") {
      const elapsed = now - t0;
      vx += Math.cos(elapsed / 390) * 0.045 + (Math.random() - 0.5) * 0.16;
      vy += Math.sin(elapsed / 260) * 0.055 + (Math.random() - 0.5) * 0.14;
      const speed = Math.hypot(vx, vy);
      const cap = 3.8;
      if (speed > cap) {
        vx = (vx / speed) * cap;
        vy = (vy / speed) * cap;
      }
      x += vx;
      y += vy;
      if (x <= minX) {
        x = minX;
        vx = Math.abs(vx) * 0.92;
      } else if (x >= maxX) {
        x = maxX;
        vx = -Math.abs(vx) * 0.92;
      }
      if (y <= minY) {
        y = minY;
        vy = Math.abs(vy) * 0.88;
      } else if (y >= maxY) {
        y = maxY;
        vy = -Math.abs(vy) * 0.88;
      }
    } else {
      const back = home();
      const t = Math.min(1, (now - homeT0) / homeMs);
      const ease = t * t * (3 - 2 * t);
      x = homeFrom.x + (back.left - homeFrom.x) * ease;
      y = homeFrom.y + (back.top - homeFrom.y) * ease;
      if (t >= 1) {
        finish();
        return;
      }
    }

    const elapsed = now - t0;
    const bob = Math.sin(elapsed / 210) * 11;
    const sway = Math.sin(elapsed / 280) * 10;
    const scale = 1.02 + Math.sin(elapsed / 240) * 0.08;
    clone.style.left = `${x}px`;
    clone.style.top = `${y}px`;
    clone.style.opacity = String(0.72 + Math.sin(elapsed / 130) * 0.28);
    clone.style.transform = `translateY(${bob}px) rotate(${sway}deg) scale(${scale})`;
    dropTrail(now);
    ghostRoamFrame = requestAnimationFrame(tick);
  };

  ghostRoamFrame = requestAnimationFrame(tick);
}

function isPassRedeemed(value) {
  if (!value) return false;
  const t = Date.parse(value);
  return Number.isFinite(t);
}

function paintStampUi() {
  const session = getStudentSession();
  if (!session) {
    els.studentAuth.hidden = false;
    els.stampApp.hidden = true;
    updateNav();
    return;
  }

  els.studentAuth.hidden = true;
  els.stampApp.hidden = false;
  updateNav();

  const stamps = cardState.stamps;
  const filled = stampCount(stamps);
  const complete = filled === 6;
  const sessionName = cardState.fullName || session.payload.name;
  const sessionNum = cardState.studentNumber || session.payload.studentNumber;
  if (els.stampHolderName) els.stampHolderName.textContent = sessionName || "Student";
  if (els.stampHolderId) els.stampHolderId.textContent = sessionNum || "";
  if (els.stampProgress) els.stampProgress.textContent = `${filled} / 6 runes lit`;
  if (els.stampFill) {
    const offset = 100 - (filled / 6) * 100;
    els.stampFill.style.strokeDashoffset = String(offset);
  }

  if (els.stampGrid) {
    const isLit = (id) => Boolean(stamps[id] || stamps[Number(id)]);
    const litFlags = BOOTHS.map((booth) => isLit(booth.id));
    els.stampGrid.classList.toggle("is-complete", complete);
    els.stampGrid.classList.toggle("has-ink", litFlags.some(Boolean));
    const pads = BOOTHS.map((booth, index) => {
      const stamped = litFlags[index];
      const col = index % 3;
      const row = Math.floor(index / 3);
      const joins = [];
      if (stamped && col < 2 && litFlags[index + 1]) joins.push("is-join-e");
      if (stamped && col > 0 && litFlags[index - 1]) joins.push("is-join-w");
      if (stamped && row < 1 && litFlags[index + 3]) joins.push("is-join-s");
      if (stamped && row > 0 && litFlags[index - 3]) joins.push("is-join-n");
      const cls = ["stamp-pad", stamped ? "is-lit" : "", ...joins].filter(Boolean).join(" ");
      return `
        <button class="${cls}" type="button" data-stamp="${booth.id}" aria-label="${escapeHtml(booth.name)} · ${escapeHtml(booth.place)}${stamped ? " · stamped" : " · empty"}">
          <span class="stamp-pad__ink" aria-hidden="true">${booth.icon}</span>
          <span class="stamp-pad__meta">
            <strong>${escapeHtml(booth.name)}</strong>
            <small>${escapeHtml(booth.short)}</small>
          </span>
        </button>`;
    }).join("");
    els.stampGrid.innerHTML = `
      <div class="stamp-grid__ticket" aria-hidden="true">
        <img src="img/fast-pass-ticket.png?v=map70" alt="">
      </div>
      ${pads}`;
  }

  if (els.stampRoadmap) {
    const isLit = (id) => Boolean(stamps[id] || stamps[Number(id)]);
    const litBooths = BOOTHS.filter((booth) => isLit(booth.id));
    const pins = BOOTHS.map((booth) => {
      const stamped = isLit(booth.id);
      const side = booth.map.side || "s";
      return `
        <button class="station-map__pin is-${side}${stamped ? " is-lit" : ""}" type="button" data-stamp="${booth.id}" style="left:${booth.map.x}%;top:${booth.map.y}%" aria-label="${escapeHtml(booth.name)} · ${escapeHtml(booth.place)}">
          <span class="station-map__icon" aria-hidden="true">${booth.icon}</span>
          <span class="station-map__name">${escapeHtml(booth.name)}</span>
        </button>`;
    }).join("");
    els.stampRoadmap.classList.toggle("is-complete", complete);
    els.stampRoadmap.classList.toggle("is-inked", filled > 0);
    els.stampRoadmap.innerHTML = `
      <div class="station-map__board">
        <div class="station-map__fog" aria-hidden="true"></div>
        <img class="station-map__art" src="img/fast-pass-ticket.png?v=map70" alt="">
        ${pins}
      </div>`;
    const art = els.stampRoadmap.querySelector(".station-map__art");
    if (art) {
      if (complete) {
        art.style.maskImage = "none";
        art.style.webkitMaskImage = "none";
      } else if (!litBooths.length) {
        const hidden = "linear-gradient(transparent, transparent)";
        art.style.maskImage = hidden;
        art.style.webkitMaskImage = hidden;
      } else {
        const spots = litBooths
          .map((booth) => {
            const r = booth.map.r || 28;
            return `radial-gradient(circle at ${booth.map.x}% ${booth.map.y}%, #fff 0 ${r * 0.4}%, transparent ${r}%)`;
          })
          .join(", ");
        art.style.maskImage = spots;
        art.style.webkitMaskImage = spots;
        art.style.maskRepeat = "no-repeat";
        art.style.webkitMaskRepeat = "no-repeat";
        art.style.maskSize = "100% 100%";
        art.style.webkitMaskSize = "100% 100%";
        art.style.maskComposite = "add";
        art.style.webkitMaskComposite = "source-over";
      }
    }
  }

  const adminNo = cardState.studentNumber || session.payload.studentNumber || "";
  const redeemed = isPassRedeemed(cardState.redeemedAt);
  if (redeemed) spiritRaised = false;
  const lit = STAMP_SLOTS.filter((slot) => stamps[slot.id] || stamps[String(slot.id)]).map((slot) => slot.id);
  if (els.passHolder) {
    els.passHolder.textContent = cardState.fullName || session.payload.name || "";
  }
  if (els.passAdmin) els.passAdmin.textContent = adminNo;
  if (els.passId) {
    els.passId.classList.toggle("is-locked", !complete);
    els.passId.textContent = complete
      ? cardState.passId
      : `Locked · ${filled} / 6 runes lit`;
  }
  applyGhostPass(els.fastPassCard, {
    seed: adminNo || cardState.passId,
    raised: spiritRaised,
    redeemed,
    lit,
    complete,
  });
  if (els.passKicker) {
    els.passKicker.textContent = redeemed
      ? "Laid to rest"
      : complete
        ? "Show this at Fast Pass"
        : "Caged spirit";
  }
  if (els.lanternHint) {
    els.lanternHint.textContent = redeemed
      ? "This spirit has been laid to rest"
      : complete
        ? ghostRoaming
          ? "Your spirit is loose — it will come back"
          : spiritRaised
          ? "Show your name and admin number to staff"
          : "Tap the ghost to let it fly"
        : filled
          ? `Uncover ${6 - filled} more piece${6 - filled === 1 ? "" : "s"} of your Fast Pass`
          : "The spirit is caged. Stamp booths to uncover your ticket";
  }
  if (els.passUsedMark) els.passUsedMark.hidden = !redeemed;
  if (els.redeemedNote) {
    els.redeemedNote.hidden = !redeemed;
    if (redeemed) {
      const when = new Date(cardState.redeemedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      els.redeemedNote.textContent = `Redeemed at ${when}${cardState.redeemedBy ? ` by ${cardState.redeemedBy}` : ""}.`;
    }
  }
}

async function renderStamps({ refresh = false } = {}) {
  const session = getStudentSession();
  if (!session) {
    paintStampUi();
    return;
  }

  paintStampUi();

  if (!refresh && cardState.studentNumber) return;

  try {
    await loadCardFromServer();
    paintStampUi();
  } catch (error) {
    if (!cardState.studentNumber && session) {
      cardState = {
        stamps: {},
        redeemedAt: null,
        redeemedBy: null,
        fullName: session.payload.name || "",
        studentNumber: session.payload.studentNumber || "",
        passId: `SP-FP-${session.payload.studentNumber || ""}`,
      };
    }
    paintStampUi();
    console.warn("Stamp card sync failed", error);
  }
}

function fillFeedbackTargets(selectEl, kind) {
  const el = selectEl || els.feedbackTarget;
  if (!el) return;
  const type = kind || els.feedbackKind?.value || "scare_house";
  const options = type === "booth"
    ? BOOTHS.map((b) => `<option value="${b.id}">${b.name}</option>`)
    : HOUSES.map((h) => `<option value="${h.id}">${h.name}</option>`);
  const keep = el.value;
  el.innerHTML = options.join("");
  if ([...el.options].some((o) => o.value === keep)) el.value = keep;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function feedbackLabel(row) {
  if (row.kind === "booth") return boothById(row.target_id)?.name || row.target_id;
  return houseMeta(row.target_id)?.name || row.target_id;
}

async function loadAdminFeedback() {
  if (!els.adminFeedbackList) return;
  if (els.adminFeedbackError) els.adminFeedbackError.hidden = true;
  try {
    const target = els.adminFeedbackTarget?.value || "";
    const data = await fetchFeedback(feedbackKindFilter, target);
    const rows = data.feedback || [];
    const withRating = rows.filter((r) => r.rating);
    const avg = withRating.length
      ? (withRating.reduce((n, r) => n + Number(r.rating), 0) / withRating.length).toFixed(1)
      : null;
    els.adminFeedbackList.innerHTML = (avg ? `<li class="muted">Average rating ${avg} / 5 (${withRating.length} rated)</li>` : "") + (rows.length
      ? rows.map((row) => {
        const when = row.created_at ? new Date(row.created_at).toLocaleString() : "";
        const who = row.student_number ? escapeHtml(row.student_number) : "Visitor";
        return `<li class="feedback-item">
          <p><strong>${escapeHtml(feedbackLabel(row))}</strong> · ${row.kind === "booth" ? "Booth" : "Scare house"}</p>
          <p>${escapeHtml(row.message)}</p>
          <p class="muted">${who} · ${escapeHtml(when)}${row.rating ? ` · ${row.rating}/5` : ""}</p>
        </li>`;
      }).join("")
      : "<li class='empty-state'><p class='empty-state__title'>No feedback yet</p><p class='empty-state__hint'>Student comments will land here as the night goes on.</p></li>");
  } catch (error) {
    if (els.adminFeedbackError) {
      els.adminFeedbackError.hidden = false;
      els.adminFeedbackError.textContent = error.message;
    }
  }
}

function paintAdminFeedbackTargetSelect() {
  const wrap = document.getElementById("feedbackTargetWrap");
  const select = els.adminFeedbackTarget;
  if (!wrap || !select) return;
  if (!feedbackKindFilter) {
    wrap.hidden = true;
    select.innerHTML = `<option value="">All in this type</option>`;
    return;
  }
  wrap.hidden = false;
  const items = feedbackKindFilter === "booth"
    ? BOOTHS.map((b) => `<option value="${b.id}">${b.name}</option>`)
    : HOUSES.map((h) => `<option value="${h.id}">${h.name}</option>`);
  select.innerHTML = `<option value="">All in this type</option>${items.join("")}`;
}

function renderTimeline() {
  const label = document.getElementById("scheduleDateLabel");
  if (label) {
    label.textContent = `${EVENT_DATE_LABEL} · Singapore time. Performances and house hours.`;
  }
  if (!els.nightTimeline) return;
  els.nightTimeline.innerHTML = SCHEDULE.map((item) => {
    const state = scheduleStatus(item);
    const tag = state === "live" ? "Now" : state === "done" ? "Ended" : "Upcoming";
    return `<li class="night-stop is-${state}"${state === "live" ? " aria-current=\"true\"" : ""}>
      <time datetime="${item.start}">${item.start}–${item.end}</time>
      <div>
        <p class="night-stop__kind">${item.kind === "performance" ? "Performance" : "Event"} · ${tag}</p>
        <strong>${escapeHtml(item.title)}</strong>
        <p>${escapeHtml(item.place)}</p>
        <p class="muted">${escapeHtml(item.note)}</p>
      </div>
    </li>`;
  }).join("");
}

function formatPostedAt(iso) {
  if (!iso) return { clock: "", ago: "" };
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return { clock: "", ago: "" };
  const clock = then.toLocaleString([], {
    hour: "2-digit",
    minute: "2-digit",
    day: "numeric",
    month: "short",
  });
  const sec = Math.max(0, Math.floor((Date.now() - then.getTime()) / 1000));
  let ago = "just now";
  if (sec >= 45 && sec < 90) ago = "1 min ago";
  else if (sec >= 90 && sec < 3600) ago = `${Math.floor(sec / 60)} min ago`;
  else if (sec < 5400) ago = "1 hour ago";
  else if (sec < 86400) ago = `${Math.floor(sec / 3600)} hours ago`;
  else if (sec < 172800) ago = "1 day ago";
  else ago = `${Math.floor(sec / 86400)} days ago`;
  return { clock, ago };
}

function announceItemHtml(row) {
  const { clock, ago } = formatPostedAt(row.created_at);
  const when = [clock, ago].filter(Boolean).join(" · ");
  const audience = row.audience && row.audience !== "all" ? row.audience : "";
  const house = row.house_id ? houseMeta(row.house_id)?.short : "";
  return `<li class="announce-item">
    <p class="announce-item__label">Staff announcement${audience ? ` · ${escapeHtml(audience)}${house ? ` ${escapeHtml(house)}` : ""}` : ""}</p>
    <p class="announce-item__when">${escapeHtml(when)}</p>
    <p class="announce-item__body">${escapeHtml(row.message)}</p>
  </li>`;
}

async function loadPublicAnnouncements() {
  const rows = await fetchAnnouncements().catch(() => []);
  const empty = `<li class="empty-state"><p class="empty-state__title">No staff announcements yet</p><p class="empty-state__hint">Official notes from facilitators will show up here.</p></li>`;
  const html = rows.length ? rows.map(announceItemHtml).join("") : empty;
  if (els.announceStrip) els.announceStrip.innerHTML = html;
  if (els.announceList) els.announceList.innerHTML = html;
  const details = document.getElementById("announceDetails");
  if (details) details.open = rows.length > 0;
}

async function loadAdminAnnouncements() {
  if (!els.adminAnnounceList) return;
  try {
    const rows = await fetchAnnouncements({ all: true });
    els.adminAnnounceList.innerHTML = rows.length
      ? rows.map((row) => {
        const { clock, ago } = formatPostedAt(row.created_at);
        const posted = row.active !== false;
        return `<li class="feedback-item">
          <p>${escapeHtml(row.message)}</p>
          <p class="muted">${escapeHtml(row.posted_by || "Staff")} · ${escapeHtml(row.audience || "all")}${row.house_id ? ` · ${escapeHtml(row.house_id)}` : ""}${row.expires_at ? ` · expires ${escapeHtml(formatPostedAt(row.expires_at).clock)}` : ""} · Posted ${escapeHtml(clock)}${ago ? ` · ${escapeHtml(ago)}` : ""} · ${posted ? "Showing" : "Taken down"}</p>
          ${posted ? `<button class="btn btn--ghost" type="button" data-announce-off="${escapeHtml(row.id)}">Take down</button>` : ""}
        </li>`;
      }).join("")
      : `<li class="empty-state"><p class="empty-state__title">No announcements yet</p><p class="empty-state__hint">Post a note above for Event Map and Tonight.</p></li>`;
  } catch (error) {
    els.adminAnnounceList.innerHTML = `<li class="form-error">${escapeHtml(error.message)}</li>`;
  }
}

async function loadOps() {
  const grid = document.getElementById("opsGrid");
  const audit = document.getElementById("opsAudit");
  if (!grid) return;
  try {
    const data = await fetchOps();
    const boothBits = BOOTHS.map((b) => `<div class="ops-card"><span>${escapeHtml(b.name)}</span><strong>${data.stampsPerBooth?.[b.id] || 0}</strong></div>`).join("");
    grid.innerHTML = `
      <div class="ops-card"><span>Students</span><strong>${data.students || 0}</strong></div>
      <div class="ops-card"><span>Fast Pass unlocked</span><strong>${data.fastPassUnlocked || 0}</strong></div>
      <div class="ops-card"><span>Houses at capacity</span><strong>${data.housesAtCapacity || 0}</strong></div>
      <div class="ops-card"><span>Feedback (6h)</span><strong>${data.recentFeedback || 0}</strong></div>
      ${boothBits}`;
    if (audit) {
      const rows = data.audit || [];
      audit.innerHTML = rows.length
        ? rows.map((row) => `<li class="feedback-item"><p>${escapeHtml(row.action)} · ${escapeHtml(row.target || "")}</p><p class="muted">${escapeHtml(row.staff_id)} · ${escapeHtml(row.at || "")}</p></li>`).join("")
        : "<li class='empty-state'><p class='empty-state__title'>No audit rows yet</p><p class='empty-state__hint'>Staff actions will appear here.</p></li>";
    }
  } catch (error) {
    grid.innerHTML = `<p class="form-error">${escapeHtml(error.message)}</p>`;
  }
}

function fillAwardBoothSelect() {
  if (!els.awardBooth) return;
  if (els.awardBooth.options.length && els.awardBooth.dataset.filled) return;
  els.awardBooth.innerHTML = BOOTHS.map((b) => `<option value="${b.id}">${b.short} · ${b.name}</option>`).join("");
  els.awardBooth.dataset.filled = "1";
}

function readStaffLog() {
  try {
    return JSON.parse(sessionStorage.getItem("scream-staff-log") || "[]");
  } catch {
    return [];
  }
}

function paintStaffLog() {
  const list = document.getElementById("staffErrorLog");
  if (!list) return;
  const rows = readStaffLog();
  list.innerHTML = rows.length
    ? rows.map((row) => `<li><strong>${escapeHtml(row.at)} · ${escapeHtml(row.action)}</strong>${escapeHtml(row.message)}</li>`).join("")
    : "<li class='empty-state'><p class='empty-state__title'>No errors yet</p><p class='empty-state__hint'>Failed staff actions will be listed here.</p></li>";
}

function pushStaffLog(action, error) {
  const rows = readStaffLog();
  rows.unshift({
    at: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
    action,
    message: error && error.message ? String(error.message) : String(error || "Unknown error"),
  });
  sessionStorage.setItem("scream-staff-log", JSON.stringify(rows.slice(0, 40)));
  paintStaffLog();
}

function renderAdmin() {
  if (!isAdminUnlocked()) {
    els.adminGate.hidden = false;
    els.adminApp.hidden = true;
    updateNav();
    return;
  }
  els.adminGate.hidden = true;
  els.adminApp.hidden = false;
  updateNav();

  els.adminTable.innerHTML = houses
    .map((row) => {
      const draft = drafts.get(row.id) || {
        wait_minutes: row.wait_minutes,
        status: row.status,
      };
      const options = STATUSES.map(
        (s) => `<option value="${s.id}" ${draft.status === s.id ? "selected" : ""}>${s.label}</option>`
      ).join("");
      return `
        <tr data-admin-row="${row.id}">
          <td>
            <strong>${row.name}</strong>
            <div class="muted">${houseMeta(row.id)?.short || ""}</div>
          </td>
          <td>
            <div class="wait-editor">
              <button type="button" data-adjust="-5" aria-label="Decrease wait by 5 minutes">−5</button>
              <input type="number" min="0" step="1" value="${draft.wait_minutes}" data-wait-input aria-label="Wait minutes for ${escapeHtml(row.name)}">
              <button type="button" data-adjust="5" aria-label="Increase wait by 5 minutes">+5</button>
            </div>
          </td>
          <td>
            <select data-status>${options}</select>
          </td>
          <td>
            <button class="btn btn--ghost" type="button" data-publish-one>Publish</button>
          </td>
        </tr>`;
    })
    .join("");
  fillAwardBoothSelect();
  const houseSel = document.getElementById("announceHouse");
  if (houseSel && !houseSel.dataset.filled) {
    houseSel.innerHTML = HOUSES.map((h) => `<option value="${h.id}">${h.name}</option>`).join("");
    houseSel.dataset.filled = "1";
  }
  const scope = staffScope();
  const allowed = [...document.querySelectorAll("[data-staff-tab]")].filter((btn) => {
    const need = btn.dataset.staffScope || "admin";
    const ok = scope === "admin" || need === scope;
    btn.hidden = !ok;
    return ok;
  });
  if (!allowed.some((btn) => btn.dataset.staffTab === staffTab)) {
    staffTab = allowed[0]?.dataset.staffTab || "waits";
  }
  document.querySelectorAll("[data-staff-tab]").forEach((btn) => {
    btn.classList.toggle("is-active", btn.dataset.staffTab === staffTab);
  });
  document.querySelectorAll("[data-staff-panel]").forEach((panel) => {
    panel.hidden = panel.dataset.staffPanel !== staffTab;
  });
  if (staffTab === "ops") loadOps();
}

function readAdminRow(tr) {
  const id = tr.dataset.adminRow;
  const wait = Math.max(0, Number(tr.querySelector("[data-wait-input]").value) || 0);
  const status = tr.querySelector("[data-status]").value;
  drafts.set(id, { wait_minutes: wait, status });
  return { id, wait_minutes: wait, status };
}

function setWaitSaveStatus(message, isError = true) {
  if (!els.waitSaveStatus) return;
  if (!message) {
    els.waitSaveStatus.hidden = true;
    els.waitSaveStatus.textContent = "";
    els.waitSaveStatus.classList.add("form-error");
    els.waitSaveStatus.classList.remove("muted");
    return;
  }
  els.waitSaveStatus.hidden = false;
  els.waitSaveStatus.textContent = message;
  els.waitSaveStatus.classList.toggle("form-error", isError);
  els.waitSaveStatus.classList.toggle("muted", !isError);
}

async function maybePublish(id, patch) {
  drafts.set(id, patch);
  if (!autoSave) return;
  await persistHouse(id, patch);
}

async function persistHouse(id, patch) {
  if (!store) return { ok: false, error: "Wait times are still loading." };
  const result = await store.publish(id, patch, { persist: true });
  if (result?.ok) {
    drafts.delete(id);
    setWaitSaveStatus("Saved to the live database.", false);
    return result;
  }
  setWaitSaveStatus(result?.error || "Could not save wait times to the database.");
  if (result?.error) pushStaffLog("Wait times", result.error);
  return result;
}

function bindMap() {
  const vp = els.mapViewport;
  if (!vp || !els.mapWorld) return;
  vp.addEventListener("wheel", (event) => {
    event.preventDefault();
    const delta = event.deltaY > 0 ? 0.9 : 1.1;
    zoomAt(event.clientX, event.clientY, mapState.scale * delta);
  }, { passive: false });

  vp.addEventListener("pointerdown", (event) => {
    if (event.target.closest(".map-pin")) return;
    event.preventDefault();
    vp.setPointerCapture(event.pointerId);
    mapState.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (mapState.pointers.size === 1) mapState.dragging = true;
  });

  vp.addEventListener("pointermove", (event) => {
    if (!mapState.pointers.has(event.pointerId)) return;
    const prev = mapState.pointers.get(event.pointerId);
    mapState.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (mapState.pointers.size === 2) {
      const pts = [...mapState.pointers.values()];
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      if (mapState.lastPinch) {
        const rect = vp.getBoundingClientRect();
        zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, mapState.scale * (dist / mapState.lastPinch));
      }
      mapState.lastPinch = dist;
      return;
    }

    if (mapState.dragging) {
      event.preventDefault();
      mapState.x += event.clientX - prev.x;
      mapState.y += event.clientY - prev.y;
      applyMapTransform();
    }
  });

  const endPointer = (event) => {
    mapState.pointers.delete(event.pointerId);
    if (!mapState.pointers.size) mapState.dragging = false;
    if (mapState.pointers.size < 2) mapState.lastPinch = 0;
  };
  vp.addEventListener("pointerup", endPointer);
  vp.addEventListener("pointercancel", endPointer);

  document.getElementById("zoomIn")?.addEventListener("click", () => {
    const rect = vp.getBoundingClientRect();
    zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, mapState.scale * 1.2);
  });
  document.getElementById("zoomOut")?.addEventListener("click", () => {
    const rect = vp.getBoundingClientRect();
    zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, mapState.scale / 1.2);
  });
  document.getElementById("zoomReset")?.addEventListener("click", resetMap);
  const pinFade = document.getElementById("pinOpacity");
  const pinLayer = document.getElementById("mapPinLayer");
  const applyPinFade = (raw) => {
    const n = Math.min(100, Math.max(0, Number(raw)));
    const t = Number.isFinite(n) ? n : 100;
    if (pinLayer) {
      pinLayer.style.opacity = String(t / 100);
      pinLayer.style.pointerEvents = t < 8 ? "none" : "";
    }
    if (pinFade) {
      pinFade.value = String(t);
      pinFade.style.setProperty("--pin-pct", `${t}%`);
      pinFade.setAttribute("aria-valuetext", `${t} percent`);
    }
    try {
      localStorage.setItem("scream-pin-opacity", String(t));
    } catch {
      /* ignore */
    }
  };
  if (pinFade && pinLayer) {
    let saved = 100;
    try {
      saved = Number(localStorage.getItem("scream-pin-opacity"));
    } catch {
      saved = 100;
    }
    applyPinFade(Number.isFinite(saved) ? saved : 100);
    pinFade.addEventListener("input", () => applyPinFade(pinFade.value));
    pinFade.addEventListener("change", () => applyPinFade(pinFade.value));
  }
  pinLayer?.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    const watch = event.target.closest("[data-watch-house]");
    if (watch) {
      event.preventDefault();
      toggleWatchHouse(watch.dataset.watchHouse);
      return;
    }
    const pin = event.target.closest(".map-pin");
    if (!pin) return;
    event.preventDefault();
    if (pin.hasAttribute("data-open-booths")) openBooths();
    else if (pin.dataset.openHouse) openHouse(pin.dataset.openHouse);
  });
  window.addEventListener("resize", fitMap);
  const img = els.mapWorld.querySelector("img");
  if (img?.complete) fitMap();
  else img?.addEventListener("load", fitMap, { once: true });
}

function setMoreMenu(open) {
  const menu = document.getElementById("navMoreMenu");
  const more = document.getElementById("navMore");
  if (!menu || !more) return;
  menu.hidden = !open;
  more.setAttribute("aria-expanded", String(open));
}

function bindUi() {
  fillAwardBoothSelect();
  paintStaffLog();
  document.getElementById("staffLogClear")?.addEventListener("click", () => {
    sessionStorage.removeItem("scream-staff-log");
    paintStaffLog();
  });
  const houseSearch = document.getElementById("houseSearch");
  houseSearch?.addEventListener("input", () => {
    houseFilter.q = houseSearch.value || "";
    renderDashboard();
    renderPins();
  });
  document.getElementById("houseFilters")?.addEventListener("click", (event) => {
    const statusBtn = event.target.closest("[data-filter-status]");
    const tagBtn = event.target.closest("[data-filter-tag]");
    if (statusBtn) {
      const next = statusBtn.dataset.filterStatus;
      houseFilter.status = houseFilter.status === next ? "" : next;
      renderDashboard();
      renderPins();
      return;
    }
    if (tagBtn) {
      const next = tagBtn.dataset.filterTag;
      houseFilter.tag = houseFilter.tag === next ? "" : next;
      renderDashboard();
      renderPins();
    }
  });
  document.getElementById("navMore")?.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    const menu = document.getElementById("navMoreMenu");
    if (!menu) return;
    setMoreMenu(Boolean(menu.hidden));
  });
  document.addEventListener("click", (event) => {
    const menu = document.getElementById("navMoreMenu");
    const more = document.getElementById("navMore");
    if (!menu || menu.hidden) return;
    if (more?.contains(event.target) || menu.contains(event.target)) return;
    setMoreMenu(false);
  });
  els.navButtons.forEach((btn) => {
    if (btn.id === "navMore") return;
    btn.addEventListener("click", () => setView(btn.dataset.nav));
  });
  window.addEventListener("hashchange", () => {
    const { view, extra } = hashToView();
    setView.skipHash = true;
    setView(view, extra);
  });
  document.getElementById("announceAudience")?.addEventListener("change", (event) => {
    const wrap = document.getElementById("announceHouseWrap");
    if (wrap) wrap.hidden = event.target.value !== "house";
  });
  document.getElementById("modalAddNight")?.addEventListener("click", () => {
    if (!openHouseId) return;
    const night = readNight();
    night.houses = night.houses.includes(openHouseId)
      ? night.houses.filter((id) => id !== openHouseId)
      : [...night.houses, openHouseId];
    writeNight(night);
    openHouse(openHouseId);
    renderMyNight();
  });
  document.getElementById("modalWatch")?.addEventListener("click", () => {
    if (!openHouseId) return;
    toggleWatchHouse(openHouseId);
  });

  document.body.addEventListener("click", (event) => {
    const jump = event.target.closest("button[data-nav]");
    if (jump && !jump.closest(".nav")) {
      setView(jump.dataset.nav);
      return;
    }
    const watchBtn = event.target.closest("[data-watch-house]");
    if (watchBtn) {
      event.preventDefault();
      event.stopPropagation();
      toggleWatchHouse(watchBtn.dataset.watchHouse);
      return;
    }
    const houseBtn = event.target.closest("[data-open-house]");
    if (houseBtn) openHouse(houseBtn.dataset.openHouse);

    const boothsPin = event.target.closest("[data-open-booths]");
    if (boothsPin) openBooths();

    const boothBtn = event.target.closest("[data-open-booth]");
    if (boothBtn) {
      if (els.boothsModal) els.boothsModal.hidden = true;
      openBooth(boothBtn.dataset.openBooth);
    }

    const stampBtn = event.target.closest("[data-stamp]");
    if (stampBtn) {
      openBooth(stampBtn.dataset.stamp);
    }

    const logout = event.target.closest("[data-logout]");
    if (logout) {
      if (logout.dataset.logout === "student") {
        flushGameProgress();
        disablePushNotifications();
        clearStudentSession();
        applyGameAccount();
        cardState = { stamps: {}, redeemedAt: null, redeemedBy: null, fullName: "", studentNumber: "", passId: "" };
        spiritRaised = false;
        stopGhostRoam();
        updateNav();
        renderStamps();
      } else {
        flushGameProgress();
        clearAdminSession();
        applyGameAccount();
        updateNav();
        const onStaff = document.querySelector(".view.is-active")?.dataset.view === "admin";
        if (onStaff) setView("login");
        else renderAdmin();
      }
    }

    if (event.target.closest("[data-close-modal]")) closeModals();
  });

  ["studentLoginId", "staffLoginId", "awardStudentNumber"].forEach((id) => {
    document.getElementById(id)?.addEventListener("blur", (event) => {
      event.target.value = normalizeAdminNumber(event.target.value);
    });
  });

  async function handleAuthSubmit(event, { staff }) {
    event.preventDefault();
    const err = document.getElementById(staff ? "staffLoginError" : "studentLoginError");
    const submit = event.currentTarget.querySelector('button[type="submit"]');
    if (err) err.hidden = true;
    if (submit) submit.disabled = true;
    try {
      flushGameProgress();
      const data = await signIn({
        adminNumber: document.getElementById(staff ? "staffLoginId" : "studentLoginId").value,
        fullName: document.getElementById(staff ? "staffLoginName" : "studentLoginName").value,
        password: staff ? document.getElementById("staffLoginPassword").value : "",
      });
      if (staff && !data.staff) {
        throw new Error("Staff password is required for this form.");
      }
      if (!staff && data.staff) {
        throw new Error("Use the staff form for facilitator sign-in.");
      }
      applyGameAccount();
      updateNav();
      setView(data.staff ? "admin" : "stamps");
      if (!data.staff) {
        cardState.studentNumber = "";
        renderStamps({ refresh: true }).catch(() => paintStampUi());
        const notify = document.getElementById("studentNotifyOptIn");
        if (notify?.checked) {
          setWantsPush(true);
          enablePushNotifications(readNight().watch).then(paintPushHint).catch(paintPushHint);
        } else {
          paintPushHint();
        }
      }
    } catch (error) {
      if (err) {
        err.hidden = false;
        err.textContent = error.message;
      }
    } finally {
      if (submit) submit.disabled = false;
    }
  }

  document.getElementById("studentLoginForm")?.addEventListener("submit", (event) => handleAuthSubmit(event, { staff: false }));
  document.getElementById("staffLoginForm")?.addEventListener("submit", (event) => handleAuthSubmit(event, { staff: true }));

  els.lanternRaise?.addEventListener("click", () => {
    if (els.fastPassCard?.classList.contains("is-redeemed")) return;
    if (!els.fastPassCard?.classList.contains("is-complete")) return;
    roamGhost();
  });

  function resetStaffRedeemView() {
    const form = document.getElementById("staffRedeemLookupForm");
    const ready = document.getElementById("staffRedeemReady");
    const used = document.getElementById("staffRedeemUsed");
    const err = document.getElementById("staffRedeemError");
    if (form) form.hidden = false;
    if (ready) ready.hidden = true;
    if (used) used.hidden = true;
    if (err) {
      err.hidden = true;
      err.textContent = "";
    }
  }

  function formatRedeemedLine(at, by) {
    if (!at) return "This pass is marked used.";
    const when = new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    return `Redeemed at ${when}${by ? ` by ${by}` : ""}.`;
  }

  function showStaffUsedPass(data) {
    const form = document.getElementById("staffRedeemLookupForm");
    const ready = document.getElementById("staffRedeemReady");
    const used = document.getElementById("staffRedeemUsed");
    if (form) form.hidden = true;
    if (ready) ready.hidden = true;
    if (used) used.hidden = false;
    const name = document.getElementById("staffUsedName");
    const id = document.getElementById("staffUsedId");
    const note = document.getElementById("staffUsedNote");
    if (name) name.textContent = `${data.fullName || ""} · ${data.studentNumber || ""}`;
    if (id) id.textContent = data.passId || `SP-FP-${data.studentNumber || ""}`;
    if (note) note.textContent = formatRedeemedLine(data.redeemedAt, data.redeemedBy);
  }

  document.getElementById("staffRedeemLookupForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const err = document.getElementById("staffRedeemError");
    if (err) {
      err.hidden = true;
      err.textContent = "";
    }
    const input = document.getElementById("redeemStudentNumber");
    try {
      const data = await lookupStudent(input.value);
      if (data.demo) throw new Error("Could not reach the live database. Try again when the staff tools are online.");
      const filled = typeof data.stampCount === "number" ? data.stampCount : stampCount(data.stamps || {});
      const passId = data.passId || `SP-FP-${data.studentNumber}`;
      if (isPassRedeemed(data.redeemedAt)) {
        showStaffUsedPass({ ...data, passId });
        return;
      }
      if (filled < 6) {
        throw new Error(`This student has ${filled} / 6 stamps. Fast Pass is not unlocked.`);
      }
      const form = document.getElementById("staffRedeemLookupForm");
      const ready = document.getElementById("staffRedeemReady");
      const used = document.getElementById("staffRedeemUsed");
      if (form) form.hidden = true;
      if (used) used.hidden = true;
      if (ready) ready.hidden = false;
      document.getElementById("staffRedeemName").textContent = `${data.fullName} · ${data.studentNumber}`;
      document.getElementById("staffRedeemId").textContent = passId;
      document.getElementById("staffRedeemStamps").textContent = `${filled} / 6 stamps · ready to skip the wait line`;
      document.getElementById("staffRedeemConfirm").dataset.studentNumber = data.studentNumber;
    } catch (error) {
      pushStaffLog("Redeem lookup", error);
      if (err) {
        err.hidden = false;
        err.textContent = error.message;
      }
    }
  });

  document.getElementById("staffRedeemConfirm")?.addEventListener("click", async () => {
    const btn = document.getElementById("staffRedeemConfirm");
    const err = document.getElementById("staffRedeemError");
    const studentNumber = btn?.dataset.studentNumber;
    if (!studentNumber) return;
    btn.disabled = true;
    try {
      const result = await redeemPass(studentNumber);
      showStaffUsedPass(result);
      if (getStudentSession()?.payload.studentNumber === result.studentNumber) {
        await renderStamps({ refresh: true });
        paintStampUi();
      }
    } catch (error) {
      resetStaffRedeemView();
      pushStaffLog("Redeem Fast Pass", error);
      if (err) {
        err.hidden = false;
        err.textContent = error.message;
      }
    } finally {
      btn.disabled = false;
    }
  });

  document.querySelectorAll("[data-redeem-reset]").forEach((btn) => {
    btn.addEventListener("click", () => {
      resetStaffRedeemView();
      const input = document.getElementById("redeemStudentNumber");
      if (input) {
        input.value = "";
        input.focus();
      }
    });
  });

  document.getElementById("adminLock")?.addEventListener("click", () => {
    clearAdminSession();
    updateNav();
    setView("login");
  });

  els.autoSave?.addEventListener("change", () => {
    autoSave = els.autoSave.checked;
  });

  els.adminTable?.addEventListener("click", (event) => {
    const tr = event.target.closest("[data-admin-row]");
    if (!tr) return;
    const adjust = event.target.closest("[data-adjust]");
    if (adjust) {
      const input = tr.querySelector("[data-wait-input]");
      input.value = Math.max(0, Number(input.value) + Number(adjust.dataset.adjust));
      const patch = readAdminRow(tr);
      maybePublish(patch.id, { wait_minutes: patch.wait_minutes, status: patch.status });
    }
    if (event.target.closest("[data-publish-one]")) {
      const patch = readAdminRow(tr);
      persistHouse(patch.id, { wait_minutes: patch.wait_minutes, status: patch.status });
    }
  });

  els.adminTable?.addEventListener("change", (event) => {
    const tr = event.target.closest("[data-admin-row]");
    if (!tr) return;
    const patch = readAdminRow(tr);
    maybePublish(patch.id, { wait_minutes: patch.wait_minutes, status: patch.status });
  });

  els.publishAll?.addEventListener("click", async () => {
    const results = await Promise.all(
      [...els.adminTable.querySelectorAll("[data-admin-row]")].map((tr) => {
        const patch = readAdminRow(tr);
        return persistHouse(patch.id, { wait_minutes: patch.wait_minutes, status: patch.status });
      })
    );
    const failed = results.find((r) => r && r.ok === false);
    if (!failed) setWaitSaveStatus("All wait times saved to the live database.", false);
  });

  document.querySelectorAll("[data-staff-tab]").forEach((btn) => {
    btn.addEventListener("click", () => {
      staffTab = btn.dataset.staffTab;
      document.querySelectorAll("[data-staff-tab]").forEach((b) => {
        b.classList.toggle("is-active", b.dataset.staffTab === staffTab);
      });
      document.querySelectorAll("[data-staff-panel]").forEach((panel) => {
        panel.hidden = panel.dataset.staffPanel !== staffTab;
      });
      if (staffTab === "feedback") {
        paintAdminFeedbackTargetSelect();
        loadAdminFeedback();
      }
      if (staffTab === "announce") loadAdminAnnouncements();
      if (staffTab === "ops") loadOps();
      if (staffTab === "announce") loadAdminAnnouncements();
    });
  });

  document.querySelectorAll("[data-fb-kind]").forEach((btn) => {
    btn.addEventListener("click", () => {
      feedbackKindFilter = btn.dataset.fbKind || "";
      document.querySelectorAll("[data-fb-kind]").forEach((b) => {
        b.classList.toggle("is-active", b.dataset.fbKind === feedbackKindFilter);
      });
      paintAdminFeedbackTargetSelect();
      loadAdminFeedback();
    });
  });

  els.adminFeedbackTarget?.addEventListener("change", () => loadAdminFeedback());

  els.awardStampForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (els.awardStampError) els.awardStampError.hidden = true;
    if (els.awardStampOk) els.awardStampOk.hidden = true;
    const busy = document.getElementById("awardStampBusy");
    const submit = document.getElementById("awardStampSubmit") || els.awardStampForm.querySelector("button[type=submit]");
    const phrases = ["Looking up student…", "Saving stamp…", "Confirming on the card…"];
    let phraseIndex = 0;
    if (busy) {
      busy.hidden = false;
      busy.textContent = phrases[0];
    }
    if (submit) submit.disabled = true;
    const tick = window.setInterval(() => {
      phraseIndex = (phraseIndex + 1) % phrases.length;
      if (busy) busy.textContent = phrases[phraseIndex];
    }, 800);
    try {
      const data = await awardStamp(
        document.getElementById("awardStudentNumber").value,
        els.awardBooth.value
      );
      if (els.awardStampOk) {
        els.awardStampOk.hidden = false;
        els.awardStampOk.textContent = data.local
          ? `Awarded ${data.boothName} to ${data.studentNumber} on this device (demo).`
          : `Awarded ${data.boothName} to ${data.fullName} (${data.studentNumber}).`;
      }
      if (getStudentSession()?.payload.studentNumber === data.studentNumber) {
        await renderStamps({ refresh: true });
      }
    } catch (error) {
      pushStaffLog("Award stamp", error);
      if (els.awardStampError) {
        els.awardStampError.hidden = false;
        els.awardStampError.textContent = error.message;
      }
    } finally {
      window.clearInterval(tick);
      if (busy) busy.hidden = true;
      if (submit) submit.disabled = false;
    }
  });

  els.feedbackKind?.addEventListener("change", () => fillFeedbackTargets());
  els.feedbackForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (els.feedbackError) els.feedbackError.hidden = true;
    if (els.feedbackOk) els.feedbackOk.hidden = true;
    try {
      await submitFeedback(
        els.feedbackKind.value,
        els.feedbackTarget.value,
        document.getElementById("feedbackMessage").value,
        document.getElementById("feedbackRating")?.value
      );
      document.getElementById("feedbackMessage").value = "";
      const ratingEl = document.getElementById("feedbackRating");
      if (ratingEl) ratingEl.value = "";
      if (els.feedbackOk) els.feedbackOk.hidden = false;
    } catch (error) {
      if (els.feedbackError) {
        els.feedbackError.hidden = false;
        els.feedbackError.textContent = error.message;
      }
    }
  });

  els.announceForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (els.announceError) els.announceError.hidden = true;
    try {
      await postAnnouncement(document.getElementById("announceMessage").value, {
        audience: document.getElementById("announceAudience")?.value || "all",
        houseId: document.getElementById("announceHouse")?.value || "",
        expiresMinutes: document.getElementById("announceExpires")?.value || "",
      });
      document.getElementById("announceMessage").value = "";
      await loadAdminAnnouncements();
      await loadPublicAnnouncements();
    } catch (error) {
      if (els.announceError) {
        els.announceError.hidden = false;
        els.announceError.textContent = error.message;
      }
    }
  });

  els.adminAnnounceList?.addEventListener("click", async (event) => {
    const btn = event.target.closest("[data-announce-off]");
    if (!btn) return;
    try {
      await setAnnouncementActive(btn.dataset.announceOff, false);
      await loadAdminAnnouncements();
      await loadPublicAnnouncements();
    } catch (error) {
      if (els.announceError) {
        els.announceError.hidden = false;
        els.announceError.textContent = error.message;
      }
    }
  });

  fillFeedbackTargets();
  stampPoll = window.setInterval(() => {
    if (document.hidden) return;
    if (document.querySelector(".view.is-active")?.dataset.view !== "stamps") return;
    if (!getStudentSession()) return;
    renderStamps({ refresh: true });
  }, 4000);

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeModals();
  });
  window.addEventListener("online", () => paintWaitBanner());
  window.addEventListener("offline", () => paintWaitBanner());
}

function paintWaitBanner(sync) {
  const note = document.getElementById("siteLiveNote");
  if (!note) return;
  if (sync) waitSync = sync;
  else if (store?.getSync) waitSync = store.getSync();
  if (waitSync.liveOk || !waitSync.wasLive) {
    note.hidden = true;
    note.classList.remove("is-stale");
    note.textContent = "";
    return;
  }
  note.hidden = false;
  note.classList.add("is-stale");
  const ago = waitSync.lastLiveAt
    ? freshnessLabel(waitSync.lastLiveAt).replace(/^Updated /, "updated ")
    : "connection lost";
  note.textContent = `Last known waits · ${ago}`;
}

function paintConnectionUi(mode, error) {
  const live = mode === "live" || Boolean(store?.getSync?.().liveOk);
  const accounts = Boolean(window.HALLOWEEN_CONFIG && window.HALLOWEEN_CONFIG.studentLogin);
  const status = window.__CONFIG_STATUS || {};
  if (els.liveMode) {
    els.liveMode.textContent = live ? (accounts ? "Live · Supabase" : "Live · waits only") : "Demo · local sync";
    els.liveMode.classList.toggle("is-live", live);
    paintLiveChip();
  }
  if (!els.dbBanner) return;
  els.dbBanner.hidden = false;
  els.dbBanner.classList.toggle("is-live", live);
  const localHint = {
    "no-api": " /api/config is missing. On Vercel, add SUPABASE_URL / supabaseUrl, the anon key, JWT_SECRET, then redeploy.",
    "api-not-json": " /api/config did not return JSON, so Vercel is not running the API function. Redeploy with the api/ folder at the project root.",
    "empty-keys": " /api/config loaded but SUPABASE_URL / SUPABASE_ANON_KEY are empty. Set them in .env (local) or Vercel env vars, then restart/redeploy.",
    "api-404": " /api/config was not found.",
    "api-500": " /api/config crashed.",
    ok: "",
  }[status.reason] || "";
  els.dbBanner.textContent = live
    ? (accounts
      ? "LIVE. Wait times and stamps write to the database."
      : "LIVE waits. Student sign-up needs SUPABASE_SERVICE_ROLE_KEY on Vercel (or run supabase/schema.sql), then redeploy.")
    : `DEMO MODE — not writing to the database. Staff changes and new accounts stay on this device only.${error ? ` ${error}` : ""}${localHint} For the real night set JWT_SECRET, ADMIN_PASSCODE, and the Supabase service role on Vercel.`;
}

function onStoreChange(next, sync) {
  notifyWatches(next);
  houses = next;
  if (sync) {
    paintWaitBanner(sync);
    if (sync.liveOk) paintConnectionUi("live");
  }
  renderDashboard();
  renderPins();
  if (document.querySelector('.view.is-active')?.dataset.view === "admin" && isAdminUnlocked()) {
    const active = document.activeElement;
    if (!active?.matches("[data-wait-input], [data-status]")) renderAdmin();
  }
}

async function init() {
  try {
    initEventGate();
  } catch (error) {
    console.warn("Event gate failed", error);
  }
  try {
    bindUi();
    paintSafety();
    paintClubs();
  } catch (error) {
    console.warn("UI bind failed", error);
  }
  try {
    bindMap();
    renderDashboard();
    renderPins();
  } catch (error) {
    console.warn("Map setup failed", error);
  }
  import("./games.js")
    .then((games) => {
      setGamesVisible = games.setGamesVisible;
      flushGameProgress = games.flushGameProgress;
      applyGameAccount = games.applyGameAccount;
      games.initGames();
    })
    .catch((error) => console.warn("Games failed to load", error));
  updateNav();
  renderStamps();
  renderAdmin();
  renderTimeline();
  loadPublicAnnouncements();
  registerPushWorker();
  paintPushHint();
  resumePushIfWanted(readNight().watch);
  const start = hashToView();
  if (wantsOpeningNight()) {
    setView("welcome");
  } else if (location.hash && start.view) {
    setView.skipHash = true;
    setView(start.view, start.extra);
  }
  window.addEventListener("scream-gates-opened", () => {
    if (wantsOpeningNight()) setView("welcome");
  });
  window.setInterval(() => {
    if (document.hidden) return;
    loadPublicAnnouncements();
    if (document.querySelector(".view.is-active")?.dataset.view === "tonight") renderTimeline();
  }, 20000);

  await (window.loadHalloweenConfig ? window.loadHalloweenConfig() : Promise.resolve());

  store = createStore(onStoreChange);
  const connected = store.connect();
  const connectWait = new Promise((resolve) => setTimeout(() => resolve({ mode: "local", error: "Connection timed out." }), 12000));
  const { mode, error } = await Promise.race([connected, connectWait]);
  paintConnectionUi(mode, error);
  const note = document.getElementById("siteLiveNote");
  if (note) paintWaitBanner(store.getSync ? store.getSync() : { liveOk: mode === "live", wasLive: mode === "live", lastLiveAt: mode === "live" ? new Date().toISOString() : null });
  connected.then((result) => {
    if (result?.mode === "live") {
      paintConnectionUi("live");
      paintWaitBanner(store.getSync());
    }
  });
}

init().catch((error) => {
  console.error(error);
  if (els.liveMode) {
    els.liveMode.textContent = "Demo · local sync";
    els.liveMode.classList.remove("is-live");
    paintLiveChip();
  }
});
