import { initEventGate, isEventOpen, isDevPreview, WELCOME_PENDING_KEY } from "./gate.js?v=r11";
import { CLUBS } from "./clubs.js?v=r6";
import { CLUSTERS, HOUSES, PINS, clusterById, pinById, STATUSES } from "./houses.js?v=r22";
import { BOOTHS, STAMP_BOOTHS, FOOD_BOOTHS, boothById } from "./booths.js?v=r39";
import { SPONSORS } from "./sponsors.js?v=r21";
import { applyGhostPass } from "./ghost-pass.js?v=r6";
import { markImg } from "./marks.js?v=r6";
import { createStore } from "./store.js?v=r8";
import {
  apiFetch,
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
  canUseStaffUi,
  verifyAdminSession,
  lookupStudent,
  postAnnouncement,
  redeemPass,
  setAnnouncementActive,
  signIn,
  submitFeedback,
  normalizeAdminNumber,
  isAdminNumber,
  userFacingError,
} from "./session.js?v=r11";
import {
  disablePushNotifications,
  enablePushNotifications,
  paintPushHint,
  registerPushWorker,
  resumePushIfWanted,
  setWantsPush,
  syncPushWatch,
  dismissPushHint,
} from "./push.js?v=r7";

let setGamesVisible = () => {};
let flushGameProgress = () => {};
let applyGameAccount = () => {};

const STATUS_LABEL = Object.fromEntries(STATUSES.map((s) => [s.id, s.label]));

const els = {
  views: [...document.querySelectorAll(".view")],
  navButtons: [...document.querySelectorAll("[data-nav]")],
  houseGrid: document.getElementById("houseGrid"),
  mapWorld: document.getElementById("mapWorld"),
  mapViewport: document.getElementById("mapViewport"),
  mapPins: document.getElementById("mapPinLayer"),
  zoomLabel: document.getElementById("zoomLabel"),
  liveMode: document.getElementById("liveMode"),
  modal: document.getElementById("detailModal"),
  stampRoadmap: document.getElementById("stampRoadmap"),
  stampGrid: document.getElementById("stampGrid"),
  boothModal: document.getElementById("boothModal"),
  boothsModal: document.getElementById("boothsModal"),
  clusterModal: document.getElementById("clusterModal"),
  stampHolderName: document.getElementById("stampHolderName"),
  stampHolderId: document.getElementById("stampHolderId"),
  stampFill: document.getElementById("stampFill"),
  stampProgress: document.getElementById("stampProgress"),
  passId: document.getElementById("passId"),
  adminGate: document.getElementById("adminGate"),
  adminApp: document.getElementById("adminApp"),
  adminTable: document.getElementById("adminTable"),
  autoSave: document.getElementById("autoSave"),
  publishAll: document.getElementById("publishAll"),
  waitSaveStatus: document.getElementById("waitSaveStatus"),
  dbBanner: document.getElementById("dbBanner"),
  studentAuth: document.getElementById("studentAuth"),
  stampApp: document.getElementById("stampApp"),
  sessionChip: document.getElementById("sessionChip"),
  passHolder: document.getElementById("passHolder"),
  passAdmin: document.getElementById("passAdmin"),
  lanternRaise: document.getElementById("lanternRaise"),
  lanternHint: document.getElementById("lanternHint"),
  passKicker: document.getElementById("passKicker"),
  passUsedMark: document.getElementById("passUsedMark"),
  redeemedNote: document.getElementById("redeemedNote"),
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

function statusFromWait(minutes) {
  if (minutes === null || minutes === undefined || minutes === "") return "open";
  const wait = Math.max(0, Number(minutes) || 0);
  if (wait >= 60) return "closed";
  if (wait >= 40) return "long";
  if (wait >= 21) return "busy";
  if (wait >= 6) return "open";
  return "gonow";
}

function hasPublishedWait(row) {
  const wait = row?.wait_minutes;
  return wait !== null && wait !== undefined && wait !== "" && Number.isFinite(Number(wait));
}

function normalizeHouseRow(row) {
  const raw = row.wait_minutes ?? row.wait;
  const published = raw !== null && raw !== undefined && raw !== "";
  const wait = published ? Math.max(0, Number(raw) || 0) : null;
  return {
    ...row,
    wait_minutes: wait,
    status: published ? statusFromWait(wait) : "open",
  };
}

let store;
let houses = HOUSES.filter((h) => h.kind !== "screening" && h.kind !== "scarezone").map((h) => normalizeHouseRow({
  id: h.id,
  name: h.name,
  wait_minutes: h.wait,
  status: h.status,
}));
let staffTab = "waits";
let feedbackKindFilter = "";
let stampPoll = 0;
let waitSync = { liveOk: false, wasLive: false, lastLiveAt: null };
let autoSave = false;
let cardState = { stamps: {}, redeemedAt: null, redeemedBy: null, fullName: "", studentNumber: "", passId: "" };
const drafts = new Map();
const waitSaveTimers = new Map();
const waitSaveFlight = new Set();
const WAIT_SAVE_MS = 800;
const WAIT_MAX = 60;
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
  if (minutes === null || minutes === undefined || minutes === "") return "Not published";
  if (status === "closed" || statusFromWait(minutes) === "closed") return "Closed";
  if ((Number(minutes) || 0) === 0) return "No queue";
  return `${Number(minutes) || 0} min`;
}

function isGoNowHouse(row) {
  if (!hasPublishedWait(row)) return false;
  return statusFromWait(row.wait_minutes) === "gonow";
}

function statusPillLabel(row) {
  return STATUS_LABEL[statusFromWait(row.wait_minutes)] || row.status;
}

function waitMetric(row) {
  if (!hasPublishedWait(row)) return { value: "-", unit: "Not published", kind: "queue" };
  const minutes = Number(row.wait_minutes) || 0;
  const status = statusFromWait(minutes);
  if (status === "closed") return { value: "Closed", unit: "Not running", kind: "closed" };
  if (minutes === 0) return { value: "No queue", unit: "", kind: "clear" };
  return { value: String(minutes), unit: "min wait", kind: "queue" };
}

function waitRank(row) {
  const status = statusFromWait(row.wait_minutes);
  const band = { gonow: 0, open: 1, busy: 2, long: 3, closed: 4 }[status] ?? 1;
  return band * 1000 + (Number(row.wait_minutes) || 0);
}

function sortedHouses(list = houses) {
  return [...list].sort((a, b) => waitRank(a) - waitRank(b) || a.name.localeCompare(b.name));
}

function houseSearchHay(row) {
  const meta = houseMeta(row.id);
  const cluster = clusterById(meta?.cluster);
  return `${row.name} ${meta?.short || ""} ${meta?.rooms || ""} ${cluster?.name || ""} ${row.id}`.toLowerCase();
}

function houseMatchesFilter(row) {
  const q = houseFilter.q.trim().toLowerCase();
  if (q && !houseSearchHay(row).includes(q)) return false;
  const status = statusFromWait(row.wait_minutes);
  if (houseFilter.status) {
    if (!hasPublishedWait(row) || status !== houseFilter.status) return false;
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

function paintHouseFilters() {
  document.querySelectorAll("[data-filter-status]").forEach((btn) => {
    btn.classList.toggle("is-on", btn.dataset.filterStatus === houseFilter.status);
  });
  document.querySelectorAll("[data-filter-tag]").forEach((btn) => {
    btn.classList.toggle("is-on", btn.dataset.filterTag === houseFilter.tag);
  });
  const clear = document.querySelector("[data-clear-filters]");
  if (clear) clear.hidden = !filterIsActive();
}

function clearHouseFilters(which) {
  if (!which || which === "status") houseFilter.status = "";
  if (!which || which === "tag") houseFilter.tag = "";
  if (!which || which === "q") {
    houseFilter.q = "";
    const search = document.getElementById("houseSearch");
    if (search) search.value = "";
  }
  renderDashboard();
  renderPins();
}

function freshnessLabel(iso) {
  if (!iso) return "Not updated";
  const { ago } = formatPostedAt(iso);
  return ago ? `Updated ${ago}` : "Not updated";
}

function tagChips(meta) {
  return (meta?.tags || []).map((t) => `<span class="tag-chip">${escapeHtml(t)}</span>`).join("");
}

function houseCardOpenInner(row, meta) {
  const metric = waitMetric(row);
  const tags = tagChips(meta);
  return `
    <span class="house-card__rail" aria-hidden="true"></span>
    <span class="house-card__top">
      <span class="house-card__short">${escapeHtml(meta?.short || "")}</span>
    </span>
    <strong class="house-card__name">${escapeHtml(row.name)}</strong>
    <span class="house-card__metric">
      <span class="status-pill">${escapeHtml(statusPillLabel(row))}</span>
      <span class="house-card__wait${metric.kind === "clear" ? " is-phrase" : ""}">${escapeHtml(metric.value)}</span>
      ${metric.unit ? `<span class="house-card__unit">${escapeHtml(metric.unit)}</span>` : ""}
    </span>
    <span class="house-card__meta">
      ${meta?.rooms ? `<span class="fresh">${escapeHtml(meta.rooms)}</span>` : ""}
      <span class="fresh">${escapeHtml(freshnessLabel(row.updated_at))}</span>
      ${tags ? `<span class="house-tags">${tags}</span>` : ""}
    </span>`;
}

function staffScope() {
  return getAdminSession()?.payload?.staffScope || "admin";
}

function staffBoothId() {
  const match = /^booth:([0-9]+)$/.exec(staffScope());
  return match ? match[1] : "";
}

function staffSeesTab(scope, need) {
  if (scope === "admin") return true;
  if (need === "waits") return scope === "waits";
  if (need === "stamps") return /^booth:[0-9]+$/.test(scope);
  if (need === "redeem") return scope === "redeem";
  return false;
}

function canStaff(tab) {
  return staffSeesTab(staffScope(), tab === "stamps" || tab === "redeem" || tab === "waits" ? tab : "admin");
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
let openClusterKey = "";
let boardTimer = 0;

const WELCOME_SEEN_KEY = "scream-welcome-seen";
/** Set true to show the Games tab again. */
const GAMES_ENABLED = false;
/** Food stalls stay off this list until they are named as sponsors. */
const SPONSORS_ENABLED = true;

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

function writeHash(hash, mode) {
  const next = `${location.pathname}${location.search}${hash}`;
  const current = `${location.pathname}${location.search}${location.hash}`;
  if (current === next) return;
  if (mode === "replace") history.replaceState(null, "", next);
  else history.pushState(null, "", next);
}

function setHash(view, extra) {
  writeHash(extra ? `#${view}/${extra}` : `#${view}`, "push");
}

function canSeeStaffTab() {
  return canUseStaffUi();
}

function setView(name, extra) {
  if (!isEventOpen() && !document.documentElement.classList.contains("event-open")) {
    if (location.hash) history.replaceState(null, "", location.pathname + location.search);
    return;
  }
  const student = getStudentSession();
  const admin = getAdminSession();
  const rawName = name;
  let scrollId = "";
  let hashName = name;
  let navName = name;
  if (name === "tonight") {
    name = "map";
    hashName = "map";
    navName = "map";
  } else if (name === "guide" || (name === "help" && extra === "guide")) {
    name = "help";
    extra = "guide";
    hashName = "help";
    navName = "help";
    scrollId = "help-how";
  } else if (name === "safety" || (name === "help" && extra === "safety")) {
    name = "help";
    extra = "safety";
    hashName = "help";
    navName = "help";
    scrollId = "help-safety";
  } else if (name === "follow") {
    hashName = "follow";
    navName = "";
  }
  if (name === "games" && !GAMES_ENABLED) {
    name = "map";
    hashName = "map";
    navName = "map";
  }
  if (name === "admin" && !canSeeStaffTab()) name = student ? "stamps" : "login";
  if (name === "login" && admin) name = "admin";
  else if (name === "login" && student) name = "stamps";
  if (!["tonight", "guide", "safety", "follow", "house", "booths", "booth", "pin", "help"].includes(rawName)) {
    navName = name;
  }
  const fromHistory = Boolean(setView.skipHash);
  if (name === "house" || name === "booths" || name === "booth" || name === "pin" || name === "cluster") {
    name = "map";
    navName = "map";
    if (rawName === "house" && extra) openHouse(extra, { fromHash: fromHistory });
    else if (rawName === "booths") openBooths({ fromHash: fromHistory });
    else if (rawName === "booth" && extra) openBooth(extra, { fromHash: fromHistory });
    else if (rawName === "pin" && extra) openPin(extra, { fromHash: fromHistory });
    else if (rawName === "cluster" && extra) openCluster(extra, { fromHash: fromHistory });
  } else {
    closeModals({ restore: false });
  }
  const alreadyHere = document.querySelector(".view.is-active")?.dataset.view === name;
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
    const on = navName && btn.dataset.nav === navName;
    btn.classList.toggle("is-active", on);
    if (on) btn.setAttribute("aria-current", "page");
    else btn.removeAttribute("aria-current");
  });
  setGamesVisible(name === "games");
  if (rawName === "guide" || rawName === "safety") {
    writeHash(`#help/${rawName}`, "replace");
  } else if (!setView.skipHash) {
    let hash = `#${name}`;
    if (name === "help" && (extra === "guide" || extra === "safety")) {
      hash = `#help/${extra}`;
    } else if (rawName === "house" && extra) hash = `#house/${extra}`;
    else if (rawName === "booths") hash = "#booths";
    else if (rawName === "booth" && extra) hash = `#booth/${extra}`;
    else if (rawName === "pin" && extra) hash = `#pin/${extra}`;
    else if (rawName === "cluster" && extra) hash = `#cluster/${extra}`;
    else if (rawName === "games" && !GAMES_ENABLED) hash = "#map";
    writeHash(hash, rawName === "guide" || rawName === "safety" || rawName === "tonight" ? "replace" : "push");
  }
  setView.skipHash = false;
  setMoreMenu(false);
  updateNav();
  if (name === "admin") renderAdmin();
  if (name === "map") {
    renderTimeline();
    loadPublicAnnouncements();
    requestAnimationFrame(() => fitMap());
  }
  if (name === "feedback") fillFeedbackTargets();
  if (name === "stamps") {
    paintStampUi();
    requestAnimationFrame(layoutStampPage);
  }
  if (name === "help") paintSafety();
  paintClubs();
  paintSponsors();
  paintWelcomeBoothCount();
  if (name === "board") startBoard();
  else stopBoard();
  setMoreMenu(false);
  if (scrollId) {
    window.setTimeout(() => {
      document.getElementById(scrollId)?.scrollIntoView({ block: "start" });
    }, 50);
  } else if (!alreadyHere) {
    window.scrollTo(0, 0);
  }
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
  if (openClusterKey && els.clusterModal && !els.clusterModal.hidden) paintClusterModal(openClusterKey);
  if (!watching) {
    setWantsPush(true);
    enablePushNotifications(pushWatchList(night.watch)).then((result) => {
      paintPushHint();
      const when = alertChoiceLabel();
      if (result?.ok) {
        showWaitToast("Alerts on", when ? `We’ll ping this phone at ${when}.` : "Pick at least one wait on the sign-in page.", false);
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
      showWaitToast("Alerts on", alertChoiceLabel() ? `You’ll see a message here at ${alertChoiceLabel()}.` : "Pick at least one wait on the sign-in page.", false);
    }).catch(paintPushHint);
  } else {
    syncPushWatch(pushWatchList(night.watch));
    showWaitToast("Alert off", "This house will no longer ping you.", false);
  }
}

function houseCardHtml(row, watching) {
  const meta = houseMeta(row.id);
  const on = watching.has(row.id);
  const status = statusFromWait(row.wait_minutes);
  return `<article class="house-card status-${status}">
    <button class="house-card__open" type="button" data-open-house="${escapeHtml(row.id)}">
      ${houseCardOpenInner(row, meta)}
    </button>
    <button class="house-card__watch${on ? " is-on" : ""}" type="button" data-watch-house="${escapeHtml(row.id)}" aria-pressed="${on}" aria-label="${escapeHtml(row.name)} walk-in alert">
      <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
        <path d="M6 9a6 6 0 0 1 12 0c0 7 3 8 3 8H3s3-1 3-8" />
        <path d="M10 18a2 2 0 0 0 4 0" />
      </svg>
      ${on ? "Watching" : "Notify"}
    </button>
  </article>`;
}

function clusterMembers(clusterId) {
  return HOUSES.filter((house) => house.cluster === clusterId);
}

function isWalkthrough(meta) {
  return meta?.kind === "screening" || meta?.kind === "scarezone";
}

function listingMatches(meta) {
  if (isWalkthrough(meta)) {
    if (houseFilter.status || houseFilter.tag) return false;
    const q = houseFilter.q.trim().toLowerCase();
    if (!q) return true;
    const cluster = clusterById(meta.cluster);
    return `${meta.name} ${meta.rooms} ${meta.short} ${cluster?.name || ""}`.toLowerCase().includes(q);
  }
  const row = houses.find((h) => h.id === meta.id);
  return Boolean(row && houseMatchesFilter(row));
}

function boothIsStamped(id) {
  if (!getStudentSession()) return false;
  const stamps = cardState.stamps || {};
  return Boolean(stamps[String(id)] || stamps[Number(id)]);
}

function boothSealHtml() {
  return `<span class="booth-seal" aria-hidden="true"><span class="booth-seal__ink">Stamped</span></span>`;
}

const BOOTH_THEMES = {
  1: "ink",
  2: "hat",
  8: "eye",
  4: "skel",
  7: "scream",
  9: "jagua",
  3: "glam",
  5: "tarot",
  6: "polaroid",
};

function boothTheme(booth) {
  if (booth.food && booth.theme) return booth.theme;
  return BOOTH_THEMES[String(booth.id)] || "";
}

const BOOTH_TILT = {
  ink: "-1.6deg",
  hat: "1.5deg",
  eye: "-1deg",
  skel: "1.8deg",
  scream: "-1.8deg",
  jagua: "1.2deg",
  glam: "-1.4deg",
  tarot: "1.7deg",
  polaroid: "-0.8deg",
  beamori: "1.3deg",
  pasta: "-1.5deg",
  kwazy: "1.6deg",
  matcha: "-1.2deg",
};

function posterArt(fill, line, shapes, details = "") {
  return `<svg viewBox="0 0 96 96" aria-hidden="true"><g fill="${line}" transform="translate(2.2 2.2)">${shapes}</g><g fill="${fill}" stroke="${line}" stroke-width="2.6" stroke-linejoin="round" paint-order="stroke fill">${shapes}</g>${details}</svg>`;
}

const BOOTH_IDLE_DELAY = {
  ink: "0s",
  hat: "0.45s",
  eye: "0.9s",
  skel: "1.4s",
  scream: "0.2s",
  jagua: "1.7s",
  glam: "0.7s",
  tarot: "1.15s",
  polaroid: "1.95s",
  beamori: "0.3s",
  pasta: "1.5s",
  kwazy: "0.6s",
  matcha: "2.1s",
};

function boothArt(theme) {
  const hi = "#fff6ea";
  const art = {
    ink: `<svg viewBox="0 0 96 96" aria-hidden="true"><path d="M8 8h68a4 4 0 0 1 4 4v44L56 88H12a4 4 0 0 1-4-4V12a4 4 0 0 1 4-4z" fill="#1a1022" transform="translate(1.5 1.5)"/><path d="M8 8h68a4 4 0 0 1 4 4v44L56 88H12a4 4 0 0 1-4-4V12a4 4 0 0 1 4-4z" fill="#f7f1e4" stroke="#1a1022" stroke-width="2.6" stroke-linejoin="round"/><g fill="#3cbf6a" stroke="#1a1022" stroke-width="1.6" stroke-linejoin="round"><path d="M24 26c-8-6-14 1-7 5 2.4-1.6 4.6-1.6 7 0z"/><path d="M24 26c8-6 14 1 7 5-2.4-1.6-4.6-1.6-7 0z"/><circle cx="24" cy="26.6" r="2.3"/></g><circle cx="62" cy="30" r="10" fill="#ff8a2e" stroke="#1a1022" stroke-width="1.8"/><path d="M62 20v-5" stroke="#3cbf6a" stroke-width="2.4" stroke-linecap="round"/><path d="M57 28h3.2l-1.6 2.4zM67 28h-3.2l1.6 2.4z" fill="#1a1022"/><path d="M57 35c2 3 8 3 10 0" fill="none" stroke="#1a1022" stroke-width="1.6" stroke-linecap="round"/><path d="M22 46c2-8 16-10 18-2v12l-3.2-3-2.8 3-3-3-3 3-3-3-3 3z" fill="#fff" stroke="#6a3cae" stroke-width="1.7" stroke-linejoin="round"/><circle cx="28" cy="50" r="1.5" fill="#1a1022"/><circle cx="34" cy="50" r="1.5" fill="#1a1022"/><circle cx="52" cy="54" r="8" fill="#fff" stroke="#6a3cae" stroke-width="1.7"/><circle cx="49" cy="53" r="1.5" fill="#1a1022"/><circle cx="55" cy="53" r="1.5" fill="#1a1022"/><path d="M52 56.5v2.2M49 62h6" stroke="#1a1022" stroke-width="1.4" stroke-linecap="round"/><g fill="none" stroke="#7a4fd0" stroke-width="1.5" stroke-linecap="round"><circle cx="28" cy="72" r="8"/><circle cx="28" cy="72" r="4"/><path d="M28 64v16M20 72h16M22.4 66.4l11.2 11.2M33.6 66.4 22.4 77.6"/></g><g class="peel"><path d="M56 62c16 1 24 12 20 22-10-1-16-9-20-22z" fill="#fffaf3" stroke="#1a1022" stroke-width="2.2" stroke-linejoin="round"/></g></svg>`,
    hat: `<svg viewBox="0 0 96 96" aria-hidden="true"><path class="hoop" d="M18 44a22 8 0 0 0 44 0" fill="none" stroke="#ff8a2e" stroke-width="6" stroke-linecap="round"/><path d="M36 4 30 22 18 66h44L52 22 42 4z" fill="#2a1848" stroke="#100814" stroke-width="2.6" stroke-linejoin="round"/><path d="M34 14 26 58" fill="none" stroke="#e4d8ff" stroke-width="2.6" stroke-linecap="round"/><path d="M26 54h28l-1 3.2H27z" fill="#d4c4ff"/><ellipse cx="40" cy="68" rx="34" ry="7" fill="#140e24" stroke="#100814" stroke-width="2.4"/><path d="M10 66c10-4 20-6 30-6s20 2 30 6" fill="none" stroke="#d8ccf8" stroke-width="2" stroke-linecap="round"/><path class="hoop" d="M18 44a22 8 0 0 1 44 0" fill="none" stroke="#ff8a2e" stroke-width="6" stroke-linecap="round"/><path d="M70 8c6 2 12 6 14 12" fill="none" stroke="#ffb15a" stroke-width="2.4" stroke-linecap="round" stroke-dasharray="3 3.4"/><g transform="rotate(-22 78 18)"><g class="arc"><ellipse cx="78" cy="18" rx="22" ry="8" fill="none" stroke="#ff8a2e" stroke-width="6"/></g></g><g class="bat"><path d="M12 18c-6-5-11 1-5 4 2-1.2 3.4-1.2 5 0z" fill="#f4f0ff" stroke="#100814" stroke-width="1.3" stroke-linejoin="round"/><path d="M12 18c6-5 11 1 5 4-2-1.2-3.4-1.2-5 0z" fill="#f4f0ff" stroke="#100814" stroke-width="1.3" stroke-linejoin="round"/><circle cx="12" cy="18.6" r="1.5" fill="#f4f0ff" stroke="#100814" stroke-width="1"/></g></svg>`,
    eye: posterArt("#d4f3c6", "#14301c", `
      <path d="M22 52h52l-8 30H30z"/>
    `, `<g class="bob"><circle cx="28" cy="22" r="12" fill="${hi}" stroke="#14301c" stroke-width="2.4"/><circle cx="28" cy="23" r="5" fill="#e23b3b"/><circle cx="28" cy="23" r="2" fill="#1a100c"/><circle cx="52" cy="34" r="10" fill="${hi}" stroke="#14301c" stroke-width="2.4"/><circle cx="52" cy="35" r="4" fill="#e23b3b"/><circle cx="52" cy="35" r="1.6" fill="#1a100c"/></g><ellipse cx="48" cy="52" rx="16" ry="4" fill="${hi}"/>`),
    skel: `<svg viewBox="0 0 96 96" aria-hidden="true"><g fill="#141a28" transform="translate(1.6 1.8)"><circle cx="24" cy="16" r="10"/><rect x="16" y="28" width="16" height="16" rx="4"/><rect x="8" y="32" width="10" height="4" rx="2"/><rect x="30" y="30" width="12" height="4" rx="2" transform="rotate(-24 30 32)"/><rect x="16" y="46" width="16" height="6" rx="2"/><rect x="16" y="54" width="5" height="20" rx="2"/><rect x="27" y="54" width="5" height="20" rx="2"/><path d="M62 18h20c-2 8-8 12-10 16 2 4 8 8 10 16H62c2-8 8-12 10-16-2-4-8-8-10-16z"/></g><circle cx="24" cy="16" r="10" fill="#f7f4ec" stroke="#141a28" stroke-width="2.4"/><circle cx="20" cy="15" r="1.7" fill="#141a28"/><circle cx="28" cy="15" r="1.7" fill="#141a28"/><g class="jaw"><path d="M17 20h14c0 4-3 7-7 7s-7-3-7-7z" fill="#f7f4ec" stroke="#141a28" stroke-width="2"/></g><rect x="16" y="28" width="16" height="16" rx="4" fill="#f7f4ec" stroke="#141a28" stroke-width="2.2"/><path d="M18 33h12M18 37h12M18 41h12" stroke="#141a28" stroke-width="1.6" stroke-linecap="round"/><rect x="8" y="32" width="10" height="4" rx="2" fill="#f7f4ec" stroke="#141a28" stroke-width="2"/><g class="arm"><rect x="30" y="28" width="14" height="4.5" rx="2" transform="rotate(-28 32 30)" fill="#f7f4ec" stroke="#141a28" stroke-width="2"/></g><rect x="16" y="46" width="16" height="6" rx="2" fill="#f7f4ec" stroke="#141a28" stroke-width="2"/><rect x="16" y="54" width="5" height="22" rx="2.5" fill="#f7f4ec" stroke="#141a28" stroke-width="2"/><rect x="27" y="54" width="5" height="22" rx="2.5" fill="#f7f4ec" stroke="#141a28" stroke-width="2"/><path d="M60 16h22c-2 9-9 13-11 18 2 5 9 9 11 18H60c2-9 9-13 11-18-2-5-9-9-11-18z" fill="#f7f4ec" stroke="#141a28" stroke-width="2.4" stroke-linejoin="round"/><ellipse cx="71" cy="28" rx="6" ry="4" fill="#e8b34a"/><ellipse cx="71" cy="56" rx="7" ry="4" fill="#f0c14a"/><g class="sand"><rect x="70" y="32" width="2.4" height="8" rx="1" fill="#e8b34a"/><circle cx="71.2" cy="42" r="2.2" fill="#f6d56a"/></g></svg>`,
    scream: posterArt("#f6d0d4", "#2a1218", ``, `<g class="ghost"><path d="M18 34c0-16 34-18 36 0 8 2 14 16 4 24 4 12-6 22-18 24S14 72 18 54c-10-2-12-14-4-20z" fill="#f6d0d4" stroke="#2a1218" stroke-width="2.6" stroke-linejoin="round"/><circle cx="32" cy="36" r="2.4" fill="#2a1218"/><circle cx="46" cy="36" r="2.4" fill="#2a1218"/><ellipse cx="39" cy="48" rx="5" ry="8" fill="#2a1218"/></g><g class="meter"><rect x="70" y="18" width="8" height="18" rx="2" fill="#ffd8dc" stroke="#2a1218" stroke-width="2"/><rect x="70" y="40" width="12" height="8" rx="2" fill="#ff9aa6" stroke="#2a1218" stroke-width="2"/><rect x="70" y="52" width="16" height="8" rx="2" fill="#ff6d80" stroke="#2a1218" stroke-width="2"/></g>`),
    jagua: `<svg viewBox="0 0 96 96" aria-hidden="true"><defs><clipPath id="jaguaPalm"><path d="M16 60h48c3 8 1 16-6 22-10 8-26 8-36 0-6-6-8-14-6-22z"/></clipPath><clipPath id="jaguaThumb"><rect x="0" y="60" width="24" height="14" rx="7" transform="rotate(42 24 67)"/></clipPath></defs><g fill="#f2c7a6" stroke="#3a2218" stroke-width="2.1" stroke-linejoin="round"><rect x="16" y="32" width="10" height="30" rx="5"/><rect x="30" y="10" width="10" height="50" rx="5"/><rect x="44" y="20" width="10" height="40" rx="5"/><rect x="58" y="32" width="8" height="28" rx="4"/><path d="M16 60h48c3 8 1 16-6 22-10 8-26 8-36 0-6-6-8-14-6-22z"/><rect x="0" y="60" width="24" height="14" rx="7" transform="rotate(42 24 67)"/></g><g clip-path="url(#jaguaPalm)"><path class="henna" pathLength="100" d="M28 78c2-14 20-16 24-1" fill="none" stroke="#140c3a" stroke-width="3" stroke-linecap="round"/></g><g fill="none" stroke="#140c3a" stroke-width="3" stroke-linecap="round"><path class="henna henna-b" pathLength="100" d="M18.5 46h5M32.5 26h5M46.5 36h5M60 46h4"/></g><g fill="#140c3a"><circle cx="21" cy="36" r="1.6"/><circle cx="35" cy="15" r="1.6"/><circle cx="49" cy="25" r="1.6"/><circle cx="62" cy="36.5" r="1.45"/></g><g clip-path="url(#jaguaThumb)" stroke="#140c3a" stroke-width="3" stroke-linecap="round"><path class="henna henna-c" pathLength="100" d="M8 67h12" transform="rotate(42 24 67)" fill="none"/><circle cx="5" cy="67" r="1.6" transform="rotate(42 24 67)" fill="#140c3a" stroke="none"/></g><path d="M78 28l12 6-14 30z" fill="#f4f1ea" stroke="#12142e" stroke-width="2.4" stroke-linejoin="round"/><circle cx="77" cy="63" r="3.2" fill="#5ec8ff" stroke="#12142e" stroke-width="1.6"/><g class="gel"><path d="M75 69c2.6 5 1 9-3.4 9s-5.8-4-3.2-9c1.2-2 3.4-2 6.6 0z" fill="#7ad4ff" stroke="#12142e" stroke-width="1.5"/></g><g class="bat"><path d="M70 12c-6-5-11 1-5 4 1.8-1.3 3.2-1.3 5 0z" fill="#f4f6ff" stroke="#12142e" stroke-width="1.4" stroke-linejoin="round"/><path d="M70 12c6-5 11 1 5 4-1.8-1.3-3.2-1.3-5 0z" fill="#f4f6ff" stroke="#12142e" stroke-width="1.4" stroke-linejoin="round"/><circle cx="70" cy="12.6" r="1.6" fill="#f4f6ff" stroke="#12142e" stroke-width="1.1"/></g></svg>`,
    glam: `<svg viewBox="0 0 96 96" aria-hidden="true"><g fill="#2a1218" transform="translate(2 2)"><ellipse cx="28" cy="64" rx="22" ry="14"/><circle cx="62" cy="36" r="18"/></g><ellipse cx="28" cy="64" rx="22" ry="14" fill="#fff6f8" stroke="#1a1014" stroke-width="2.4"/><circle cx="16" cy="62" r="5" fill="#ff4d88" stroke="#1a1014" stroke-width="1.6"/><circle cx="28" cy="58" r="5" fill="#fff" stroke="#1a1014" stroke-width="1.6"/><circle cx="40" cy="62" r="5" fill="#1a1014"/><circle cx="28" cy="70" r="4" fill="#ffb3cc" stroke="#1a1014" stroke-width="1.4"/><circle cx="62" cy="36" r="18" fill="#fff6f8" stroke="#1a1014" stroke-width="2.4"/><path d="M62 18a18 18 0 0 1 0 36V18z" fill="#ff5c93"/><circle cx="55" cy="34" r="2.2" fill="#1a1014"/><circle cx="69" cy="34" r="2.2" fill="#1a1014"/><path d="M62 40v5" stroke="#1a1014" stroke-width="2" stroke-linecap="round"/><path d="M56 48c2 2 10 2 12 0" fill="none" stroke="#1a1014" stroke-width="1.8" stroke-linecap="round"/><g class="brush"><rect x="44" y="72" width="30" height="6" rx="3" transform="rotate(-32 58 75)" fill="#ffd0e0" stroke="#1a1014" stroke-width="2"/><path d="M70 58l8 6-3 4-8-6z" fill="#1a1014"/></g></svg>`,
    tarot: `<svg viewBox="0 0 96 96" aria-hidden="true"><g transform="rotate(-16 24 52)"><rect x="8" y="30" width="24" height="38" rx="3" fill="#4a2c78" stroke="#f6e7b0" stroke-width="2.6"/><path d="M20 42a5 5 0 1 0 0.1 0zM16 50h8" fill="#f6e7b0" stroke="#f6e7b0" stroke-width="1.6"/></g><g transform="rotate(10 46 48)"><rect x="28" y="22" width="24" height="38" rx="3" fill="#3c2468" stroke="#f6e7b0" stroke-width="2.6"/><path d="M40 34l1.6 3.4 3.6.4-2.7 2.4.8 3.6L40 42l-3.3 1.8.8-3.6-2.7-2.4 3.6-.4z" fill="#f6e7b0"/></g><ellipse cx="66" cy="74" rx="16" ry="5" fill="#e2b85a" stroke="#6a4a16" stroke-width="1.6"/><path d="M54 60h24l-4 12H58z" fill="#f3d78c" stroke="#6a4a16" stroke-width="1.8" stroke-linejoin="round"/><g class="ball"><circle cx="66" cy="44" r="18" fill="#c9fff4" stroke="#14302c" stroke-width="2.6"/><circle class="glow" cx="66" cy="44" r="18" fill="#efe4ff"/><circle cx="59" cy="38" r="4.5" fill="#fff"/><g class="swirl"><path d="M60 42c7 0 9 7 3 11" fill="none" stroke="#7a4fd0" stroke-width="2.2" stroke-linecap="round"/><path d="M70 48l1.2 2.4 2.6.2-2 1.8.6 2.6-2.4-1.4-2.4 1.4.6-2.6-2-1.8 2.6-.2z" fill="#f6e7b0"/></g></g></svg>`,
    polaroid: posterArt("#f0d4b4", "#2a1c12", `
      <rect x="18" y="8" width="58" height="72" rx="3"/>
    `, `<rect x="26" y="16" width="42" height="40" fill="#1a140e"/><g class="develop"><path d="M40 28c10-10 20 2 10 14-6 8-16 6-16-2 2-2 4-2 6-12z" fill="${hi}"/><circle cx="46" cy="34" r="1.8" fill="#2a1c12"/><circle cx="54" cy="34" r="1.8" fill="#2a1c12"/></g>`),
    beamori: `<svg viewBox="0 0 96 96" aria-hidden="true"><defs><clipPath id="beamoriCup"><path d="M26 50h44l-7 38H33z"/></clipPath></defs><path d="M6 56h18l-3 26H9z" fill="#f0d78a" stroke="#2a1c12" stroke-width="1.6" stroke-linejoin="round"/><path d="M5 56c0-9 20-9 20 0" fill="#fff8f0" stroke="#2a1c12" stroke-width="1.6"/><path d="M72 58h18l-3 24H75z" fill="#ead6b4" stroke="#2a1c12" stroke-width="1.6" stroke-linejoin="round"/><path d="M71 58c0-9 20-9 20 0" fill="#fff8f0" stroke="#2a1c12" stroke-width="1.6"/><g clip-path="url(#beamoriCup)"><path d="M26 50h44l-7 38H33z" fill="#e09a4e"/><rect x="34" y="62" width="12" height="8" rx="2" transform="rotate(-14 40 66)" fill="#fff6e8" fill-opacity="0.78" stroke="#a86a32" stroke-width="1.2"/><rect x="50" y="70" width="10" height="7" rx="2" transform="rotate(10 55 73)" fill="#fff6e8" fill-opacity="0.7" stroke="#a86a32" stroke-width="1.2"/></g><path d="M26 50h44l-7 38H33z" fill="none" stroke="#2a1c12" stroke-width="1.8" stroke-linejoin="round"/><g class="ghost"><path d="M22 52C22 24 74 24 74 52Z" fill="#fff6ea" stroke="#2a1c12" stroke-width="1.8"/><circle cx="42" cy="40" r="1.7" fill="#3a2a22"/><circle cx="54" cy="40" r="1.7" fill="#3a2a22"/><circle cx="42.6" cy="39.4" r="0.55" fill="#fff6ea"/><circle cx="54.6" cy="39.4" r="0.55" fill="#fff6ea"/><g class="spark" fill="#e2b84a" stroke="#2a1c12" stroke-width="0.6"><circle cx="36" cy="34" r="1.7"/><circle cx="48" cy="30" r="1.5"/><circle cx="58" cy="35" r="1.6"/><circle cx="44" cy="36" r="1.2"/></g></g></svg>`,
    pasta: `<svg viewBox="0 0 96 96" aria-hidden="true"><path d="M42 14h14v14l18 32c4 16-6 26-26 26s-30-10-26-26l20-32z" fill="#3a1714" transform="translate(2 2)"/><path d="M42 14h14v14l18 32c4 16-6 26-26 26s-30-10-26-26l20-32z" fill="#f7f3ee" stroke="#3a1714" stroke-width="2.6" stroke-linejoin="round"/><path d="M32 64c4 14 28 16 36 2-6 12-16 16-20 16s-14-4-16-18z" fill="#ff3b3b"/><path d="M36 50c8 4 8-4 16 0M34 58c10 4 10-5 20 0M38 66c6 3 8-2 14 1" fill="none" stroke="#f0c84a" stroke-width="3.2" stroke-linecap="round"/><path d="M46 4v18M53 4v18" stroke="#f7f3ee" stroke-width="2.6" stroke-linecap="round"/><path d="M44 6h12" stroke="#3a1714" stroke-width="2.4" stroke-linecap="round"/><g class="bub"><circle cx="34" cy="20" r="3" fill="#fff6ea" stroke="#3a1714" stroke-width="1.4"/><circle cx="60" cy="14" r="2.3" fill="#fff6ea" stroke="#3a1714" stroke-width="1.3"/><circle cx="48" cy="10" r="1.7" fill="#fff6ea" stroke="#3a1714" stroke-width="1.2"/></g></svg>`,
    kwazy: posterArt("#ffe0a8", "#3a1024", `
      <rect x="30" y="6" width="28" height="46" rx="14"/>
      <rect x="40" y="48" width="8" height="22" rx="3"/>
    `, `<g class="drip"><path d="M24 62c6 10 2 16-4 20 6-2 10-8 4-20z" fill="#ff8fbe" stroke="#3a1024" stroke-width="2.2"/><path d="M62 60c4 12 8 16 2 22-2-8-2-14-2-22z" fill="#ff8fbe" stroke="#3a1024" stroke-width="2.2"/></g>`),
    matcha: `<svg viewBox="0 0 96 96" aria-hidden="true"><defs><clipPath id="matchaGlass"><path d="M26 34h44l-6 50H32z"/></clipPath></defs><g clip-path="url(#matchaGlass)"><path d="M24 34h50l-8 54H30z" fill="#f4efe4"/><path d="M26 34h44l-4 36H31z" fill="#3f9a2c"/><path d="M28 50c10 5 16-3 26 1 6 2 12 1 16-3v16H30z" fill="#2d7420"/><g class="swirl"><path d="M48 52c6 0 8 6 3 9-5 3-10 0-9-5 0-3 3-4 6-4z" fill="none" stroke="#d6ff9a" stroke-width="2.5" stroke-linecap="round"/></g><rect x="34" y="42" width="11" height="8" rx="2" transform="rotate(-14 39 46)" fill="#e7f6ff" stroke="#163024" stroke-width="1.4"/><rect x="52" y="48" width="10" height="7" rx="2" transform="rotate(12 57 51)" fill="#e7f6ff" stroke="#163024" stroke-width="1.4"/></g><path d="M26 34h44l-6 50H32z" fill="none" stroke="#e7ffd4" stroke-width="2.8" stroke-linejoin="round"/><g class="ghost"><path d="M38 30c0-8 18-8 18 0v7l-3-2.2-3 2.2-3-2.2-3 2.2-3-2.2-3 2.2z" fill="#f7fff2" stroke="#163024" stroke-width="1.6" stroke-linejoin="round"/><circle cx="43" cy="29" r="1.3" fill="#163024"/><circle cx="51" cy="29" r="1.3" fill="#163024"/></g><rect x="58" y="10" width="5" height="30" rx="2.5" transform="rotate(16 60 25)" fill="#f7f3ea" stroke="#163024" stroke-width="1.8"/></svg>`,
  };
  return art[theme] || "";
}

function boothDirectoryCard(booth) {
  const food = Boolean(booth.food);
  const ticket = !food && booth.stamp !== false;
  const stamped = ticket && boothIsStamped(booth.id);
  const theme = boothTheme(booth);
  const logo = food && booth.logo
    ? `<img class="house-card__logo" src="${escapeHtml(booth.logo)}" alt="">`
    : "";
  const pill = food ? "Food" : "Booth";
  const art = boothArt(theme);
  const tilt = BOOTH_TILT[theme] || "0deg";
  return `<article class="house-card${food ? " house-card--food" : " house-card--zone"}${ticket ? " is-ticket" : ""}${stamped ? " is-stamped" : ""}" data-theme="${escapeHtml(theme)}">
    <span class="house-card__rail" aria-hidden="true"></span>
    <button class="house-card__open" type="button" data-open-booth="${escapeHtml(booth.id)}">
      <span class="house-card__top">
        <span class="house-card__title">${logo}<strong class="house-card__name">${escapeHtml(booth.name)}</strong></span>
        <span class="status-pill">${pill}</span>
      </span>
      <span class="house-card__meta"><span class="fresh">${escapeHtml(booth.summary || (food ? "Menu still to come." : "Booth"))}</span></span>
      <span class="booth-art">${art ? `<span class="booth-mark" style="--tilt:${tilt};--idle-delay:${BOOTH_IDLE_DELAY[theme] || "0s"}" aria-hidden="true">${art}</span>` : ""}</span>
      ${ticket ? `<span class="visually-hidden">Needed to spin the wheel.</span>` : ""}
      ${stamped ? boothSealHtml() : ""}
      ${stamped ? `<span class="visually-hidden">Stamped</span>` : ""}
    </button>
  </article>`;
}

function boothsInDirectoryOrder() {
  const ticket = BOOTHS.filter((booth) => booth.stamp !== false);
  const rest = BOOTHS.filter((booth) => booth.stamp === false);
  return [...ticket, ...rest, ...FOOD_BOOTHS];
}

let boothMotionObserver = null;

function watchBoothMotion() {
  if (boothMotionObserver) boothMotionObserver.disconnect();
  if (!("IntersectionObserver" in window)) return;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const nodes = document.querySelectorAll("#boothDirectory .booth-mark");
  if (!nodes.length) return;
  boothMotionObserver = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add("is-peek");
      boothMotionObserver.unobserve(entry.target);
    });
  }, { threshold: 0.6 });
  nodes.forEach((node) => boothMotionObserver.observe(node));
}

function paintBoothDirectory() {
  const booths = document.getElementById("boothDirectory");
  if (booths) booths.innerHTML = boothsInDirectoryOrder().map(boothDirectoryCard).join("");
  watchBoothMotion();
}

function renderDashboard() {
  paintHouseFilters();
  paintBoothDirectory();
  if (!els.houseGrid) return;
  const watching = new Set(readNight().watch);
  const goNow = sortedHouses().filter((row) => houseMatchesFilter(row) && isGoNowHouse(row));
  const groups = CLUSTERS.map((cluster) => ({
    cluster,
    members: clusterMembers(cluster.id).filter(listingMatches),
  })).filter((group) => group.members.length);
  if (!goNow.length && !groups.length) {
    els.houseGrid.innerHTML = `<div class="empty-state house-filters__empty"><p class="empty-state__title">No houses match</p><p class="empty-state__hint">Nothing is left with these filters.</p><button class="btn" type="button" data-clear-filters>Clear filters</button></div>`;
    return;
  }
  const showGoNow = goNow.length || !filterIsActive();
  const goNowBlock = showGoNow
    ? `<div class="house-grid__gonow">
        <p class="house-grid__gonow-kicker">Go now</p>
        ${goNow.length
          ? goNow.map((row) => houseCardHtml(row, watching)).join("")
          : `<p class="gonow-empty">No house is at 5 minutes or less yet. Staff publish the waits.</p>`}
      </div>`
    : "";
  const clusterBlock = groups.map(({ cluster, members }) => {
    const places = [...new Set(members.map((house) => pinById(house.pin)?.label || house.short))].join(" · ");
    const cards = members.map((meta) => {
      if (meta.kind === "screening") return screeningCardHtml(meta);
      if (meta.kind === "scarezone") return scareZoneCardHtml(meta);
      const row = houses.find((h) => h.id === meta.id);
      return row ? houseCardHtml(row, watching) : "";
    }).join("");
    return `<section class="cluster-group">
      <header class="cluster-group__head">
        <p class="cluster-group__kicker">${escapeHtml(cluster.kicker)} · ${escapeHtml(places)}</p>
        <h3>${escapeHtml(cluster.name)}</h3>
      </header>
      <div class="cluster-group__grid">${cards}</div>
    </section>`;
  }).join("");
  els.houseGrid.innerHTML = `${goNowBlock}${clusterBlock}`;
}

function placeCardHtml(meta, pill, label) {
  return `<article class="house-card${meta.kind === "scarezone" ? " house-card--zone" : ""}">
    <button class="house-card__open" type="button" data-open-house="${escapeHtml(meta.id)}">
      <span class="house-card__rail" aria-hidden="true"></span>
      <span class="house-card__top">
        <span class="house-card__short">${escapeHtml(meta.short || "")}</span>
        <span class="status-pill">${escapeHtml(pill)}</span>
      </span>
      <strong class="house-card__name">${escapeHtml(meta.name)}</strong>
      <span class="house-card__metric">
        <span class="house-card__wait is-venue">${escapeHtml(meta.rooms || "")}</span>
      </span>
      <span class="house-card__meta">
        <span class="fresh">${escapeHtml(label)}</span>
      </span>
    </button>
  </article>`;
}

function scareZoneCardHtml(meta) {
  return placeCardHtml(meta, "Scare Zone", "Scare Zone");
}

function screeningCardHtml(meta) {
  return placeCardHtml(meta, "Screening", "Movie");
}

function screeningFilmsHtml(films) {
  return films.map((film) => `
    <article class="screening-film">
      <h4>${escapeHtml(film.title)}</h4>
      <p class="screening-film__meta">${escapeHtml(film.meta || "")}</p>
      <p>${escapeHtml(film.synopsis || "")}</p>
      ${film.trailer ? `<iframe class="screening-film__trailer" src="https://www.youtube-nocookie.com/embed/${encodeURIComponent(film.trailer)}" title="${escapeHtml(film.title)} trailer" allow="fullscreen" allowfullscreen loading="lazy"></iframe>` : ""}
    </article>`).join("");
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

function showAnnounceToast(row) {
  const host = document.getElementById("announceToasts");
  if (!host) return;
  const el = document.createElement("aside");
  el.className = "wait-toast wait-toast--announce";
  el.innerHTML = `<strong>New announcement</strong><span>${escapeHtml(row.message || "")}</span>`;
  host.appendChild(el);
  while (host.children.length > 3) host.removeChild(host.firstChild);
  setTimeout(() => {
    el.remove();
  }, 12000);
}

function milestoneCopy(level, name, wait) {
  const minutes = Math.round(Number(wait) || 0);
  const step = ALERT_STEPS.find((item) => item.id === level);
  if (!step) return null;
  if (level === "open") return { title: step.title, body: `${name}. No queue. Head over.` };
  return { title: step.title, body: `${name} is down to ${minutes} minutes.` };
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
    const level = alertForLevels(prevWait, row.wait_minutes, row.status, readAlertLevels())?.id;
    if (!level) return;
    const copy = milestoneCopy(level, row.name, row.wait_minutes);
    if (!copy || document.hidden) return;
    showWaitToast(copy.title, copy.body, level === "open");
  });
  watchSnapshot = new Map(nextHouses.map((h) => [h.id, `${h.wait_minutes}:${h.status}`]));
}

function paintSafety() {
  const list = document.getElementById("safetyList");
  if (!list) return;
  const lines = [
    "Follow the people running the night.",
    "If you do not feel comfortable, say so. You can step out of any house.",
    "Drink water, and take a break if you need one.",
    "Stay with your group. Watch your step, and do not run in the queues.",
    "Keep your bag closed, and give people space in the line.",
  ];
  list.innerHTML = lines.map((line) => `<li>${escapeHtml(line)}</li>`).join("");
}

function paintClubs() {
  const links = CLUBS.map((club) =>
    `<a href="${escapeHtml(club.instagram)}" target="_blank" rel="noopener noreferrer"><img src="${escapeHtml(encodeURI(club.logo))}" alt="${escapeHtml(club.name)}" width="64" height="64"></a>`
  ).join("");
  const credits = document.getElementById("clubCredits");
  if (credits) credits.innerHTML = links;
  const footer = document.getElementById("footerClubs");
  if (footer) footer.innerHTML = links;
  const follow = document.getElementById("followClubs");
  if (follow) follow.innerHTML = links;
}

function paintWelcomeBoothCount() {
  const el = document.getElementById("welcomeBoothCount");
  if (!el) return;
  el.textContent = `${BOOTHS.length + FOOD_BOOTHS.length} Booths`;
}

function paintSponsors() {
  document.querySelectorAll(".site-sponsors").forEach((block) => {
    block.hidden = !SPONSORS_ENABLED;
  });
  if (!SPONSORS_ENABLED) return;
  const html = SPONSORS.map((sponsor) => {
    const logo = sponsor.logo
      ? `<img class="site-sponsors__logo" src="${escapeHtml(sponsor.logo)}" alt="">`
      : "";
    const inner = `<span class="site-sponsors__slot">${logo}</span><span>${escapeHtml(sponsor.name)}</span>`;
    const body = sponsor.url
      ? `<a href="${escapeHtml(sponsor.url)}" target="_blank" rel="noopener noreferrer">${inner}</a>`
      : inner;
    return `<li class="site-sponsors__item">${body}</li>`;
  }).join("");
  ["sponsorList", "gateSponsorList"].forEach((id) => {
    const list = document.getElementById(id);
    if (list) list.innerHTML = html;
  });
}

function staffDeskError(error) {
  const message = userFacingError(error, "Something went wrong. Try again.");
  if (error?.code === "no_student" || /no student found/i.test(message)) {
    return "No student found for that admin number. Check the number and try again.";
  }
  return message;
}

async function startBoard() {
  const grid = document.getElementById("boardGrid");
  if (!grid) return;
  async function paint() {
    const games = ["clicker", "memory", "catch"];
    const blocks = await Promise.all(games.map(async (id) => {
      try {
        const res = await apiFetch(apiUrl("scores", { game: id }));
        const data = await res.json().catch(() => ({}));
        const title = id === "clicker" ? "Pumpkin clicker" : id === "memory" ? "Memory match" : "Catch the treats";
        const rows = (data.top || []).map((row, i) => `<li><span>${i + 1}. ${escapeHtml(row.name)}</span><strong>${Number(row.score) || 0}</strong></li>`).join("");
        return `<article class="board-card"><h3>${title}</h3><ol>${rows || "<li class='empty-state'><p class='empty-state__title'>No scores yet</p><p class='empty-state__hint'>Play a round to open the board.</p></li>"}</ol></article>`;
      } catch {
        return `<article class="board-card"><h3>${id === "clicker" ? "Pumpkin clicker" : id === "memory" ? "Memory match" : "Catch the treats"}</h3><div class="empty-state"><p class="empty-state__title">Scores unavailable</p><p class="empty-state__hint">Try again when the board is back online.</p></div></article>`;
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

const MAP_NATURAL = { w: 2301, h: 1405 };

function renderPins() {
  const layer = document.getElementById("mapPinLayer");
  if (!layer) return;
  const housePins = PINS.map((pin) => {
    const atPin = HOUSES.filter((house) => house.pin === pin.id);
    const timed = atPin.filter((house) => !isWalkthrough(house));
    const rows = timed.map((house) => houses.find((row) => row.id === house.id)).filter(Boolean);
    const matched = atPin.some(listingMatches);
    const dim = filterIsActive() && !matched;
    const ranked = rows.filter(hasPublishedWait).sort((a, b) => waitRank(a) - waitRank(b));
    const lead = ranked[0];
    const onlyZone = !timed.length && atPin.some((house) => house.kind === "scarezone");
    const status = lead ? statusFromWait(lead.wait_minutes) : onlyZone ? "zone" : "open";
    const names = atPin.map((house) => house.name).join(", ");
    return `<div class="map-pin status-${status}${dim ? " map-pin--dim" : ""}" data-pin="${escapeHtml(pin.id)}">
      <div class="map-pin__gfx">
        <button class="map-pin__hit" type="button" data-open-pin="${escapeHtml(pin.id)}" aria-label="${escapeHtml(pin.label)}: ${escapeHtml(names)}">
          <span class="map-pin__label">${escapeHtml(pin.label)}</span>
          <span class="map-pin__mark"></span>
        </button>
      </div>
    </div>`;
  });
  const stampedBooths = STAMP_BOOTHS.filter((booth) => boothIsStamped(booth.id));
  const boothStampNote = stampedBooths.length
    ? `, ${stampedBooths.length} of ${STAMP_BOOTHS.length} stamped`
    : "";
  const boothPin = `<div class="map-pin map-pin--booths${stampedBooths.length ? " is-stamped" : ""}${stampedBooths.length === STAMP_BOOTHS.length ? " is-stamped-all" : ""}" data-pin="booths">
    <div class="map-pin__gfx">
      <button class="map-pin__hit" type="button" data-open-booths aria-label="Booths, Eleven squared${boothStampNote}">
        <span class="map-pin__label">Booths</span>
        <span class="map-pin__mark"></span>
        ${stampedBooths.length ? `<span class="map-pin__seal" aria-hidden="true"></span>` : ""}
      </button>
    </div>
  </div>`;
  layer.innerHTML = housePins.join("") + boothPin;
}

function boothListButton(booth) {
  const stamped = !booth.food && booth.stamp !== false && boothIsStamped(booth.id);
  const mark = booth.logo
    ? `<img class="booths-list__logo" data-brand="${escapeHtml(booth.theme || "")}" src="${escapeHtml(booth.logo)}" alt="">`
    : markImg(booth.icon, "mark mark--booth");
  const label = booth.food ? escapeHtml(booth.short) : "";
  return `<button type="button" class="booths-list__btn${stamped ? " is-stamped" : ""}" data-open-booth="${escapeHtml(booth.id)}">
      <span>${mark}${label ? ` ${label}` : ""}</span>
      <strong>${escapeHtml(booth.name)}</strong>
      ${stamped ? boothSealHtml() : ""}
      ${stamped ? `<span class="visually-hidden">Stamped</span>` : ""}
    </button>`;
}

function paintBoothsPinList() {
  const list = document.getElementById("boothsPinList");
  if (!list) return;
  list.innerHTML = boothsInDirectoryOrder().map(boothListButton).join("");
}

function syncBoothStampsOnMap() {
  paintBoothDirectory();
  paintBoothsPinList();
  renderPins();
  layoutPinHits();
}

let modalHash = "";
let modalReturnHash = "";
let modalOpener = null;
let blockPageClick = false;
let sheetOpenedAt = 0;

function sheetFocusables(panel) {
  return [...panel.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')]
    .filter((node) => !node.closest("[hidden]") && node.offsetParent !== null);
}

function trapSheetKey(event) {
  const modal = event.currentTarget.closest(".modal");
  const panel = modal?.querySelector(".modal__panel");
  if (!panel || event.key !== "Tab") return;
  const items = sheetFocusables(panel);
  if (!items.length) {
    event.preventDefault();
    panel.focus();
    return;
  }
  const first = items[0];
  const last = items[items.length - 1];
  if (event.shiftKey && (document.activeElement === first || document.activeElement === panel)) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

function bindSheetSwipe(modal) {
  const bar = modal.querySelector(".modal__bar");
  if (!bar || bar.dataset.swipe) return;
  bar.dataset.swipe = "1";
  let startY = 0;
  bar.addEventListener("pointerdown", (event) => {
    if (event.target.closest("button, a, input, select, textarea")) return;
    startY = event.clientY;
  });
  bar.addEventListener("pointerup", (event) => {
    if (startY && event.clientY - startY > 56) closeModals({ restore: true });
    startY = 0;
  });
}

function showSheet(modal, hash, fromHash) {
  if (!modal) return;
  document.querySelectorAll(".modal").forEach((other) => {
    if (other !== modal) other.hidden = true;
  });
  if (!modalOpener) modalOpener = document.activeElement;
  modal.hidden = false;
  bindSheetSwipe(modal);
  const panel = modal.querySelector(".modal__panel");
  panel?.removeEventListener("keydown", trapSheetKey);
  panel?.addEventListener("keydown", trapSheetKey);
  const close = modal.querySelector(".modal__close");
  (close || panel)?.focus({ preventScroll: true });
  sheetOpenedAt = Date.now();
  if (fromHash) {
    modalHash = location.hash;
    modalReturnHash = "#map";
    return;
  }
  if (!hash || location.hash === hash) {
    modalHash = "";
    modalReturnHash = "";
    return;
  }
  modalReturnHash = location.hash || "#map";
  modalHash = hash;
  writeHash(hash, "push");
}

function openBooths(opts = {}) {
  paintBoothsPinList();
  showSheet(els.boothsModal, "#booths", opts.fromHash);
}

function layoutPinHits() {
  document.querySelectorAll(".map-pin__gfx").forEach((gfx) => {
    gfx.style.transform = "";
  });
  const showLabels = mapState.scale >= 0.4;
  document.querySelectorAll(".map-pin__label").forEach((label) => {
    label.classList.toggle("is-hidden", !showLabels);
    label.style.transform = "";
  });
}

function applyMapTransform() {
  if (!els.mapWorld) return;
  els.mapWorld.style.transform = `translate(${mapState.x}px, ${mapState.y}px) scale(${mapState.scale})`;
  els.mapWorld.style.setProperty("--map-scale", String(mapState.scale || 1));
  if (els.zoomLabel) els.zoomLabel.textContent = `${Math.round(mapState.scale * 100)}%`;
  layoutPinHits();
}

function sizeMapWorld() {
  if (!els.mapWorld) return;
  const w = `${MAP_NATURAL.w}px`;
  const h = `${MAP_NATURAL.h}px`;
  const img = els.mapWorld.querySelector("img");
  els.mapWorld.style.width = w;
  els.mapWorld.style.height = h;
  if (img) {
    img.style.width = w;
    img.style.height = h;
  }
}

function fitMap() {
  const img = els.mapWorld?.querySelector("img");
  if (!img || !els.mapViewport) return;
  sizeMapWorld();
  renderPins();
  const vp = els.mapViewport.getBoundingClientRect();
  const w = MAP_NATURAL.w;
  const h = MAP_NATURAL.h;
  if (vp.width < 8 || vp.height < 8) return;
  const fitAll = Math.min(vp.width / w, vp.height / h);
  if (!fitAll) return;
  mapState.min = fitAll * 0.85;
  mapState.max = Math.max(2.4, fitAll * 6);
  const pins = [...document.querySelectorAll(".map-pin")];
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  pins.forEach((pin) => {
    minX = Math.min(minX, pin.offsetLeft);
    minY = Math.min(minY, pin.offsetTop);
    maxX = Math.max(maxX, pin.offsetLeft);
    maxY = Math.max(maxY, pin.offsetTop);
  });
  let scale = fitAll;
  if (pins.length && maxX > minX && maxY > minY) {
    const screenPad = 64;
    let mapPad = 48;
    for (let pass = 0; pass < 4; pass += 1) {
      const boxW = Math.max(maxX - minX + mapPad * 2, 1);
      const boxH = Math.max(maxY - minY + mapPad * 2, 1);
      scale = Math.min(vp.width / boxW, vp.height / boxH);
      mapPad = screenPad / Math.max(scale, 0.05);
    }
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    mapState.scale = Math.min(mapState.max, Math.max(mapState.min, scale));
    mapState.x = vp.width / 2 - cx * mapState.scale;
    mapState.y = vp.height / 2 - cy * mapState.scale;
  } else {
    mapState.scale = Math.min(mapState.max, fitAll);
    mapState.x = (vp.width - w * mapState.scale) / 2;
    mapState.y = (vp.height - h * mapState.scale) / 2;
  }
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

function openHouse(id, opts = {}) {
  const meta = houseMeta(id);
  const row = houses.find((h) => h.id === id);
  if (!meta || !els.modal) return;
  if (!isWalkthrough(meta) && !row) return;
  openHouseId = meta.kind === "screening" ? "" : id;
  openClusterKey = "";
  if (els.clusterModal) els.clusterModal.hidden = true;
  els.modal.querySelector("[data-modal-title]").textContent = meta.name;
  const zone = meta.kind === "scarezone";
  const screening = meta.kind === "screening";
  const status = row && !zone ? statusFromWait(row.wait_minutes) : "open";
  els.modal.querySelector("[data-modal-wait]").textContent = zone ? "Scare Zone" : screening ? "Movie" : waitLabel(row.wait_minutes, status);
  els.modal.querySelector("[data-modal-status]").textContent = zone ? "Scare Zone" : screening ? "Screening" : statusPillLabel(row);
  els.modal.querySelector("[data-modal-status]").className = `status-pill${row && !zone ? ` status-${status}` : ""}`;
  const storyEl = els.modal.querySelector("[data-modal-story]");
  const filmsEl = els.modal.querySelector("[data-modal-films]");
  if (meta.films?.length && filmsEl) {
    storyEl.hidden = true;
    filmsEl.hidden = false;
    filmsEl.innerHTML = screeningFilmsHtml(meta.films);
  } else if (storyEl) {
    if (filmsEl) {
      filmsEl.hidden = true;
      filmsEl.innerHTML = "";
    }
    storyEl.hidden = false;
    storyEl.textContent = meta.blurb || "";
  }
  els.modal.querySelector("[data-modal-code]").textContent = meta.rooms || meta.short;
  const tagsEl = els.modal.querySelector("[data-modal-tags]");
  if (tagsEl) tagsEl.innerHTML = tagChips(meta) || "";
  const upd = els.modal.querySelector("[data-modal-updated]");
  if (upd) upd.textContent = row && !isWalkthrough(meta) ? freshnessLabel(row.updated_at) : "";
  const night = readNight();
  const watchBtn = document.getElementById("modalWatch");
  if (watchBtn) {
    watchBtn.hidden = isWalkthrough(meta);
    if (row) watchBtn.textContent = night.watch.includes(id) ? "Stop walk-in alert" : "Alert when walk-in";
  }
  showSheet(els.modal, meta.kind === "screening" ? "" : `#house/${id}`, opts.fromHash);
}

function clusterHouseHtml(meta, watching) {
  const row = houses.find((h) => h.id === meta.id);
  const zone = meta.kind === "scarezone";
  const wait = meta.kind === "screening" ? "Movie" : zone ? "Scare Zone" : row ? waitLabel(row.wait_minutes, statusFromWait(row.wait_minutes)) : "";
  const on = watching.has(meta.id);
  const alert = isWalkthrough(meta)
    ? ""
    : `<button class="btn btn--ghost cluster-house__alert" type="button" data-watch-house="${escapeHtml(meta.id)}" aria-pressed="${on}">${on ? "Alert on" : "Alert when walk-in"}</button>`;
  return `<li class="cluster-house">
    <div>
      <h4>${escapeHtml(meta.name)}</h4>
      <p class="cluster-house__where">${escapeHtml(meta.rooms || meta.short)} · ${escapeHtml(wait)}</p>
      ${meta.films?.length ? screeningFilmsHtml(meta.films) : `<p>${escapeHtml(meta.blurb || "")}</p>`}
    </div>
    ${alert}
  </li>`;
}

function paintClusterModal(key, opts = {}) {
  const modal = els.clusterModal;
  if (!modal) return;
  const [mode, id] = key.split(":");
  const watching = new Set(readNight().watch);
  let title = "";
  let kicker = "";
  let story = "";
  let members = [];
  if (mode === "cluster") {
    const cluster = clusterById(id);
    if (!cluster) return;
    title = cluster.name;
    kicker = cluster.kicker;
    story = cluster.story;
    members = clusterMembers(id);
  } else {
    const pin = pinById(id);
    if (!pin) return;
    members = HOUSES.filter((house) => house.pin === id);
    const clusters = [...new Set(members.map((house) => clusterById(house.cluster)?.name).filter(Boolean))];
    title = pin.label;
    kicker = clusters.join(" · ");
    story = clusters.length === 1
      ? clusterById(members[0].cluster)?.story || ""
      : "Houses from more than one cluster share this building.";
  }
  modal.querySelector("[data-cluster-kicker]").textContent = kicker;
  modal.querySelector("[data-cluster-title]").textContent = title;
  modal.querySelector("[data-cluster-story]").textContent = story;
  modal.querySelector("[data-cluster-houses]").innerHTML = members.map((meta) => clusterHouseHtml(meta, watching)).join("");
  const pinId = openClusterKey.startsWith("pin:") ? openClusterKey.slice(4) : "";
  showSheet(modal, pinId ? `#pin/${pinId}` : `#cluster/${openClusterKey.slice(8)}`, Boolean(opts.fromHash));
}

function openCluster(id, opts = {}) {
  openHouseId = "";
  openClusterKey = `cluster:${id}`;
  if (els.modal) els.modal.hidden = true;
  paintClusterModal(openClusterKey, opts);
}

function openPin(id, opts = {}) {
  openHouseId = "";
  openClusterKey = `pin:${id}`;
  if (els.modal) els.modal.hidden = true;
  paintClusterModal(openClusterKey, opts);
}

function openBooth(id, opts = {}) {
  const booth = boothById(id);
  const modal = els.boothModal;
  if (!booth || !modal) return;
  const stamped = cardState.stamps[slotKey(id)] || cardState.stamps[Number(id)];
  modal.querySelector("[data-booth-code]").textContent = booth.food ? booth.short : "Booth";
  modal.querySelector("[data-booth-title]").textContent = booth.name;
  const place = modal.querySelector("[data-booth-place]");
  if (place) {
    place.textContent = "";
    place.hidden = true;
  }
  const summary = modal.querySelector("[data-booth-summary]");
  const blurb = modal.querySelector("[data-booth-blurb]");
  const about = modal.querySelector("[data-booth-about]");
  if (booth.food) {
    if (blurb) {
      blurb.textContent = booth.about || booth.summary || "";
      blurb.hidden = !blurb.textContent;
    }
    summary.textContent = "";
    summary.hidden = true;
    about.textContent = "";
    about.hidden = true;
  } else {
    if (blurb) {
      blurb.textContent = "";
      blurb.hidden = true;
    }
    summary.textContent = booth.summary || "";
    summary.hidden = !summary.textContent;
    about.textContent = booth.about || "";
    about.hidden = !about.textContent;
  }
  const items = modal.querySelector("[data-booth-items]");
  if (items) {
    const rows = booth.items || [];
    items.hidden = !rows.length;
    items.innerHTML = rows
      .map((item) => `<li>
        <span class="booth-items__name">${escapeHtml(item.name)}</span>
        ${item.price ? `<span class="booth-items__price">${escapeHtml(item.price)}</span>` : ""}
        ${item.note ? `<span class="booth-items__note">${escapeHtml(item.note)}</span>` : ""}
      </li>`)
      .join("");
  }
  const note = modal.querySelector("[data-booth-note]");
  if (note) {
    note.textContent = booth.note || "";
    note.hidden = !booth.note;
  }
  const logo = modal.querySelector("[data-booth-logo]");
  if (logo) {
    const showLogo = Boolean(booth.logo) && !(booth.menu || []).length;
    if (showLogo) {
      logo.hidden = false;
      logo.src = booth.logo;
      logo.dataset.brand = booth.theme || "";
    } else {
      logo.hidden = true;
      logo.removeAttribute("src");
      logo.dataset.brand = "";
    }
  }
  const linksEl = modal.querySelector("[data-booth-links]");
  if (linksEl) {
    const links = booth.links || [];
    linksEl.hidden = !links.length;
    linksEl.innerHTML = links
      .map((link) => `<a class="btn btn--ghost" href="${escapeHtml(link.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(link.label)}</a>`)
      .join("");
  }
  const menu = modal.querySelector("[data-booth-menu]");
  if (menu) {
    const images = booth.menu || [];
    menu.hidden = !images.length;
    menu.innerHTML = images
      .map((src) => `<img src="${escapeHtml(src)}" alt="">`)
      .join("");
  }
  const stampLine = modal.querySelector("[data-booth-stamp]");
  if (booth.food || booth.stamp === false) {
    stampLine.hidden = true;
    stampLine.textContent = "";
  } else if (stamped) {
    stampLine.textContent = "";
    stampLine.hidden = true;
  } else {
    stampLine.hidden = false;
    stampLine.textContent = "Not on your card yet. Staff award this after you finish the booth.";
  }
  showSheet(modal, `#booth/${id}`, opts.fromHash);
}

function slotKey(id) {
  return String(id);
}

function closeModals(opts = {}) {
  if (opts.restore && !opts.force && sheetOpenedAt && Date.now() - sheetOpenedAt < 500) return;
  const hash = modalHash;
  const backTo = modalReturnHash;
  const wasOpen = Boolean(document.querySelector(".modal:not([hidden])"));
  document.querySelectorAll(".modal").forEach((modal) => {
    modal.querySelector(".modal__panel")?.removeEventListener("keydown", trapSheetKey);
    modal.hidden = true;
  });
  openClusterKey = "";
  openHouseId = "";
  modalHash = "";
  modalReturnHash = "";
  const opener = modalOpener;
  modalOpener = null;
  if (wasOpen) {
    blockPageClick = true;
    window.setTimeout(() => {
      blockPageClick = false;
    }, 400);
  }
  if (opener && typeof opener.focus === "function") opener.focus({ preventScroll: true });
  if (opts.restore && hash && location.hash === hash) writeHash(backTo || "#map", "replace");
}

function isAdminUnlocked() {
  return Boolean(getAdminSession());
}

function updateNav() {
  const badge = document.getElementById("devBadge");
  if (badge) badge.hidden = !isDevPreview();
  const student = Boolean(getStudentSession());
  const admin = Boolean(getAdminSession());
  const staffTab = canSeeStaffTab();
  document.querySelectorAll("[data-nav]").forEach((btn) => {
    const show = btn.dataset.navShow;
    if (btn.dataset.nav === "games" && !GAMES_ENABLED) btn.hidden = true;
    else if (show === "guest") btn.hidden = student || admin;
    else if (show === "admin") btn.hidden = !staffTab;
    else btn.hidden = false;
  });
  renderSessionChip();
}

function renderSessionChip() {
  const student = getStudentSession();
  const admin = getAdminSession();
  if (!els.sessionChip) return;
  if (student) {
    els.sessionChip.hidden = false;
    els.sessionChip.innerHTML = `<span>${escapeHtml(student.payload.name)}</span><button type="button" data-logout="student">Log out</button>`;
  } else if (admin) {
    els.sessionChip.hidden = false;
    els.sessionChip.innerHTML = `<span>${escapeHtml(admin.payload.name || admin.payload.staffId)}</span><button type="button" data-logout="admin">Log out</button>`;
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

const ALERT_LEVELS = ["fifty", "forty", "thirty", "twenty", "ten", "five"];
const ALERT_KEY = "scream-alert-levels";
const DEFAULT_ALERTS = ["forty", "thirty", "twenty"];
const ALERT_STEPS = [
  { id: "five", max: 5, title: "5 minutes" },
  { id: "ten", max: 10, title: "10 minutes" },
  { id: "twenty", max: 20, title: "20 minutes" },
  { id: "thirty", max: 30, title: "30 minutes" },
  { id: "forty", max: 40, title: "40 minutes" },
  { id: "fifty", max: 50, title: "50 minutes" },
];

function readAlertLevels() {
  const raw = localStorage.getItem(ALERT_KEY);
  if (raw == null) return DEFAULT_ALERTS.slice();
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return DEFAULT_ALERTS.slice();
    return parsed.filter((id) => ALERT_LEVELS.includes(id));
  } catch {
    return DEFAULT_ALERTS.slice();
  }
}

function writeAlertLevels(ids) {
  const next = ALERT_LEVELS.filter((id) => ids.includes(id));
  localStorage.setItem(ALERT_KEY, JSON.stringify(next));
  return next;
}

function pushWatchList(houseIds) {
  return [...houseIds, ...readAlertLevels().map((id) => `level:${id}`)];
}

function alertForLevels(prev, next, status, levels) {
  if (status === "closed") return null;
  const n = Number(next);
  const p = Number(prev);
  if (!Number.isFinite(n) || !Number.isFinite(p) || n >= p) return null;
  const wanted = new Set(levels);
  return ALERT_STEPS.find((step) => wanted.has(step.id) && n <= step.max && p > step.max) || null;
}

function alertChoiceLabel() {
  const picked = readAlertLevels();
  if (!picked.length) return "";
  const names = { fifty: "50 minutes", forty: "40 minutes", thirty: "30 minutes", twenty: "20 minutes", ten: "10 minutes", five: "5 minutes" };
  return picked.map((id) => names[id]).filter(Boolean).join(", ");
}

function stampCount(stamps = cardState.stamps) {
  return STAMP_BOOTHS.filter((booth) => stamps[booth.id] || stamps[String(booth.id)] || stamps[Number(booth.id)]).length;
}

function cssVarPx(el, name, fallback) {
  if (!el) return fallback;
  const probe = document.createElement("span");
  probe.style.cssText = `position:absolute;left:0;top:0;width:var(${name});height:0;overflow:hidden;visibility:hidden;pointer-events:none`;
  el.appendChild(probe);
  const width = probe.getBoundingClientRect().width;
  probe.remove();
  return width > 1 ? width : fallback;
}

function lanternSpoke(index, count, radius) {
  const rad = (index * (360 / count) - 90) * (Math.PI / 180);
  return { x: 140 + Math.cos(rad) * radius, y: 140 + Math.sin(rad) * radius };
}

function layoutLanternSigil(count) {
  const n = Math.max(3, count || 0);
  const svg = document.querySelector(".lantern__sigil");
  if (!svg) return;
  const points = (radius) => Array.from({ length: n }, (_, index) => {
    const spoke = lanternSpoke(index, n, radius);
    return `${spoke.x.toFixed(1)},${spoke.y.toFixed(1)}`;
  }).join(" ");
  const outer = svg.querySelector(".lantern__sigil-hex:not(.lantern__sigil-hex--inner)");
  const inner = svg.querySelector(".lantern__sigil-hex--inner");
  if (outer) outer.setAttribute("points", points(140));
  if (inner) inner.setAttribute("points", points(126));
  const ticks = svg.querySelector(".lantern__sigil-ticks");
  const nodes = svg.querySelector(".lantern__sigil-nodes");
  const script = svg.querySelector(".lantern__sigil-script");
  if (script) {
    script.innerHTML = Array.from({ length: n }, (_, index) => {
      const start = lanternSpoke(index, n, 114);
      const end = lanternSpoke(index, n, 122);
      return `<path d="M${start.x.toFixed(1)} ${start.y.toFixed(1)}L${end.x.toFixed(1)} ${end.y.toFixed(1)}"></path>`;
    }).join("");
  }
  if (ticks) {
    ticks.innerHTML = Array.from({ length: n }, (_, index) => {
      const start = lanternSpoke(index, n, 128);
      const end = lanternSpoke(index, n, 140);
      return `<path d="M${start.x.toFixed(1)} ${start.y.toFixed(1)}L${end.x.toFixed(1)} ${end.y.toFixed(1)}"></path>`;
    }).join("");
  }
  if (nodes) {
    nodes.innerHTML = Array.from({ length: n }, (_, index) => {
      const spoke = lanternSpoke(index, n, 140);
      return `<circle cx="${spoke.x.toFixed(1)}" cy="${spoke.y.toFixed(1)}" r="3.2"></circle>`;
    }).join("");
  }
}

function layoutLanternRunes() {
  document.querySelectorAll(".lantern").forEach((lantern) => {
    const ring = lantern.querySelector(".lantern__runes");
    if (!ring) return;
    const orbit = parseFloat(getComputedStyle(lantern).getPropertyValue("--rune-orbit")) || 168;
    const slots = [...ring.querySelectorAll(".lantern__rune-slot")];
    const count = slots.length || 5;
    layoutLanternSigil(count);
    slots.forEach((slot, index) => {
      const n = Number.parseFloat(String(slot.style.getPropertyValue("--rune") || index));
      const i = Number.isFinite(n) ? n : index;
      const rad = (i * (360 / count) - 90) * (Math.PI / 180);
      slot.style.left = `${Math.cos(rad) * orbit}px`;
      slot.style.top = `${Math.sin(rad) * orbit}px`;
    });
  });
}

function layoutStampBoard(board) {
  if (!board) return;
  const width = board.clientWidth;
  const height = board.clientHeight;
  if (width < 8 || height < 8) return;
  board.querySelectorAll(".station-map__pin").forEach((pin) => {
    const x = Number(pin.dataset.x);
    const y = Number(pin.dataset.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    pin.style.left = `${(x / 100) * width}px`;
    pin.style.top = `${(y / 100) * height}px`;
  });
  const art = board.querySelector(".station-map__art");
  if (!art) return;
  const map = board.closest(".station-map");
  const complete = Boolean(map?.classList.contains("is-complete") || map?.classList.contains("is-preview"));
  const lit = [...board.querySelectorAll(".station-map__pin.is-lit")];
  if (complete) {
    art.style.mask = "none";
    art.style.webkitMask = "none";
    return;
  }
  const shapes = lit
    .map((pin) => {
      const booth = BOOTHS.find((item) => String(item.id) === String(pin.dataset.stamp));
      if (!booth?.map?.region) return "";
      return `<polygon points="${booth.map.region}" fill="white" stroke="white" stroke-width="0.6" stroke-linejoin="round"/>`;
    })
    .filter(Boolean)
    .join("");
  if (!shapes) {
    const hidden = "linear-gradient(transparent, transparent)";
    art.style.mask = hidden;
    art.style.webkitMask = hidden;
    return;
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" preserveAspectRatio="none">${shapes}</svg>`;
  const mask = `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
  art.style.mask = `${mask} center / 100% 100% no-repeat`;
  art.style.webkitMask = `${mask} center / 100% 100% no-repeat`;
}

function layoutStampArt() {
  document.querySelectorAll(".station-map__board").forEach(layoutStampBoard);
}

function layoutStampPage() {
  layoutLanternRunes();
  layoutStampArt();
  layoutStampLock();
}

function pageOffset(el) {
  let x = 0;
  let y = 0;
  let node = el;
  while (node && node !== document.body && node !== document.documentElement) {
    x += node.offsetLeft;
    y += node.offsetTop;
    node = node.offsetParent;
  }
  return { x, y };
}

function layoutStampLock() {
  const stage = document.querySelector('[data-view="stamps"]');
  const app = els.stampApp;
  const chains = document.querySelector(".stamp-lock__chains");
  const card = document.querySelector(".stamp-lock__card");
  if (!stage || !app) return;
  if (!stage.classList.contains("is-locked")) {
    stage.style.removeProperty("height");
    app.style.removeProperty("top");
    app.style.removeProperty("transform");
    if (card) card.style.removeProperty("top");
    if (els.studentAuth) {
      els.studentAuth.style.removeProperty("top");
      els.studentAuth.style.removeProperty("bottom");
      els.studentAuth.style.removeProperty("left");
      els.studentAuth.style.removeProperty("width");
      els.studentAuth.style.removeProperty("height");
    }
    if (chains) chains.replaceChildren();
    return;
  }
  stage.style.removeProperty("height");
  app.style.removeProperty("top");
  app.style.removeProperty("transform");
  if (!chains || !card || !els.studentAuth) return;
  const lock = els.studentAuth;
  const header = document.querySelector(".site-header");
  const footer = document.querySelector(".site-footer");
  const stageAt = pageOffset(stage);
  const headerBottom = header ? pageOffset(header).y + header.offsetHeight : stageAt.y;
  const footerTop = footer ? pageOffset(footer).y : stageAt.y + stage.offsetHeight;
  const top = headerBottom - stageAt.y;
  const height = Math.max(footerTop - headerBottom, 160);
  lock.style.top = `${top}px`;
  lock.style.left = `${-stageAt.x}px`;
  lock.style.height = `${height}px`;
  lock.style.bottom = "auto";
  lock.style.right = "auto";
  lock.style.width = `${document.documentElement.clientWidth}px`;
  const cardH = card.offsetHeight;
  card.style.top = `${Math.max(16, (height - cardH) / 2)}px`;
  const width = lock.clientWidth;
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("width", String(width));
  svg.setAttribute("height", String(height));
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  const cTop = Number.parseFloat(card.style.top) || 0;
  const cLeft = Math.max(0, (width - card.offsetWidth) / 2);
  const cRight = cLeft + card.offsetWidth;
  const cBottom = cTop + card.offsetHeight;
  const runs = [
    [0, 0, cLeft, cTop],
    [width, 0, cRight, cTop],
    [0, height, cLeft, cBottom],
    [width, height, cRight, cBottom],
  ];
  const flats = [];
  const crosses = [];
  runs.forEach(([x1, y1, x2, y2]) => {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len = Math.hypot(dx, dy);
    if (len < 8) return;
    const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
    const reach = 9;
    const count = Math.max(2, Math.round((len - reach * 2) / 12) + 1);
    for (let index = 0; index < count; index += 1) {
      const dist = count === 1 ? len / 2 : reach + ((len - reach * 2) * index) / (count - 1);
      const t = dist / len;
      const cx = x1 + dx * t;
      const cy = y1 + dy * t;
      const cross = index !== 0 && index !== count - 1 && index % 2 === 1;
      const el = document.createElementNS(ns, "ellipse");
      el.setAttribute("cx", String(cx));
      el.setAttribute("cy", String(cy));
      el.setAttribute("rx", cross ? "5.2" : "9.2");
      el.setAttribute("ry", cross ? "8.4" : "5.2");
      el.setAttribute("transform", `rotate(${angle} ${cx} ${cy})`);
      if (cross) el.classList.add("is-cross");
      (cross ? crosses : flats).push(el);
    }
  });
  chains.replaceChildren(svg);
  flats.forEach((el) => svg.appendChild(el));
  crosses.forEach((el) => svg.appendChild(el));
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
let ghostFleeCtl = null;

function stopGhostRoam() {
  ghostRoamGen += 1;
  ghostFleeCtl?.abort();
  ghostFleeCtl = null;
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
  ghostFleeCtl?.abort();
  ghostFleeCtl = new AbortController();
  const { signal } = ghostFleeCtl;
  ghostRoaming = true;
  spiritRaised = true;
  card.classList.add("is-roaming");

  const home = () => ghost.getBoundingClientRect();
  const start = home();
  const hue = getComputedStyle(card).getPropertyValue("--ghost-h");
  const sat = getComputedStyle(card).getPropertyValue("--ghost-s");
  const clone = ghost.cloneNode(true);
  clone.classList.add("ghost--roam");
  clone.removeAttribute("aria-hidden");
  clone.setAttribute("role", "button");
  clone.setAttribute("tabindex", "0");
  clone.setAttribute("aria-label", "Shoo the spirit");
  clone.style.setProperty("--ghost-h", hue.trim() || "28");
  clone.style.setProperty("--ghost-s", sat.trim() || "92%");
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
  let dash = null;

  const bounds = () => {
    const minX = 10;
    const minY = 58;
    const maxX = Math.max(minX, window.innerWidth - start.width - 10);
    const maxY = Math.max(minY, window.innerHeight - start.height - 12);
    return { minX, minY, maxX, maxY };
  };

  const startDash = (px, py) => {
    const { minX, minY, maxX, maxY } = bounds();
    const cx = x + start.width / 2;
    const cy = y + start.height / 2;
    let ang = Math.atan2(cy - py, cx - px);
    if (!Number.isFinite(ang)) ang = Math.random() * Math.PI * 2;
    ang += (Math.random() - 0.5) * 0.85;
    const dist = 240 + Math.random() * 280;
    let toX = x + Math.cos(ang) * dist;
    let toY = y + Math.sin(ang) * dist;
    toX = Math.min(maxX, Math.max(minX, toX));
    toY = Math.min(maxY, Math.max(minY, toY));
    if (Math.hypot(toX - x, toY - y) < 120) {
      toX = Math.random() > 0.5 ? minX : maxX;
      toY = minY + Math.random() * Math.max(1, maxY - minY);
    }
    dash = {
      fromX: x,
      fromY: y,
      toX,
      toY,
      t0: performance.now(),
      dur: 160 + Math.random() * 70,
    };
    vx = (toX - x) / 12;
    vy = (toY - y) / 12;
  };

  clone.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (phase !== "roam") return;
    startDash(event.clientX, event.clientY);
  }, { signal });

  const dropTrail = (now) => {
    if (now - lastTrail < 58) return;
    lastTrail = now;
    const extras = document.querySelectorAll(".ghost-trail");
    if (extras.length > 10) extras[0].remove();
    const trail = clone.cloneNode(true);
    trail.classList.remove("ghost--roam", "is-fleeing");
    trail.classList.add("ghost-trail");
    trail.removeAttribute("role");
    trail.removeAttribute("tabindex");
    trail.setAttribute("aria-hidden", "true");
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
    ghostFleeCtl?.abort();
    ghostFleeCtl = null;
    clone.remove();
    document.querySelectorAll(".ghost-trail, .ghost-wisp").forEach((node) => node.remove());
    ghostRoaming = false;
    card.classList.remove("is-roaming");
    paintStampUi();
  };

  const tick = (now) => {
    if (gen !== ghostRoamGen) return;
    const { minX, minY, maxX, maxY } = bounds();
    const dashing = Boolean(dash);
    clone.classList.toggle("is-fleeing", dashing);

    if (phase === "roam" && now - t0 >= roamMs && !dashing) {
      phase = "home";
      homeFrom = { x, y };
      homeT0 = now;
    }

    if (phase === "roam" && dash) {
      const t = Math.min(1, (now - dash.t0) / dash.dur);
      const ease = 1 - (1 - t) ** 3;
      x = dash.fromX + (dash.toX - dash.fromX) * ease;
      y = dash.fromY + (dash.toY - dash.fromY) * ease;
      if (t >= 1) {
        x = dash.toX;
        y = dash.toY;
        dash = null;
      }
    } else if (phase === "roam") {
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
    const bob = dashing ? 0 : Math.sin(elapsed / 210) * 11;
    const sway = dashing ? Math.sin(elapsed / 50) * 22 : Math.sin(elapsed / 280) * 10;
    const scale = dashing ? 1.16 : 1.02 + Math.sin(elapsed / 240) * 0.08;
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

function boothNameLines(name) {
  const lines = {
    "Trick-or-Ink": ["Trick-or-", "Ink"],
    "Hat Trick": ["Hat", "Trick"],
    "Cursed Eyeballs": ["Cursed", "Eyeballs"],
    "Jagua Tattoo": ["Jagua", "Tattoo"],
    "Ghoulish Glam": ["Ghoulish", "Glam"],
    "Make a Monster": ["Make a", "Monster"],
    "Tarot Reading": ["Tarot", "Reading"],
    "Drawn Alive": ["Drawn", "Alive"],
    Screamometer: ["Scream-", "ometer"],
  }[name] || [name];
  return lines.map((line) => `<span>${escapeHtml(line)}</span>`).join("");
}

function stampBoardHtml({ lit, interactive } = {}) {
  const pins = STAMP_BOOTHS.map((booth) => {
    const stamped = lit ? lit(booth.id) : false;
    const side = booth.map.side || "s";
    const cls = `station-map__pin is-${side}${stamped ? " is-lit" : ""}`;
    const inner = `
        <span class="station-map__icon" aria-hidden="true">${markImg(booth.icon)}</span>
        <span class="station-map__name">${boothNameLines(booth.name)}</span>`;
    if (!interactive) {
      return `<span class="${cls}" data-x="${booth.map.x}" data-y="${booth.map.y}">${inner}</span>`;
    }
    return `<button class="${cls}" type="button" data-stamp="${booth.id}" data-x="${booth.map.x}" data-y="${booth.map.y}" aria-label="${escapeHtml(booth.name)} · ${escapeHtml(booth.place)}">${inner}</button>`;
  }).join("");
  const regions = interactive
    ? `<svg class="station-map__regions" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">${STAMP_BOOTHS.map((booth) => `<polygon points="${booth.map.region}"></polygon>`).join("")}</svg>`
    : "";
  return `
    <div class="station-map__board">
      <div class="station-map__fog" aria-hidden="true"></div>
      <img class="station-map__art" src="img/wheel-ticket.png?v=r1" alt="">
      ${regions}
      ${pins}
    </div>`;
}

function paintStampUi() {
  const real = getStudentSession();
  const locked = !real;
  const session = real || { payload: { name: "Student", studentNumber: "" } };
  const stampsView = document.querySelector('[data-view="stamps"]');
  els.studentAuth.hidden = !locked;
  els.stampApp.hidden = false;
  els.stampApp.classList.toggle("is-ghost", locked);
  els.stampApp.toggleAttribute("inert", locked);
  if (locked) els.stampApp.setAttribute("aria-hidden", "true");
  else els.stampApp.removeAttribute("aria-hidden");
  stampsView?.classList.toggle("is-locked", locked);
  updateNav();

  const stamps = locked ? {} : cardState.stamps;
  const filled = stampCount(stamps);
  const goal = STAMP_BOOTHS.length;
  const complete = filled === goal;
  const sessionName = locked ? "Student" : cardState.fullName || session.payload.name;
  const sessionNum = locked ? "" : cardState.studentNumber || session.payload.studentNumber;
  if (els.stampHolderName) els.stampHolderName.textContent = sessionName || "Student";
  if (els.stampHolderId) els.stampHolderId.textContent = sessionNum || "";
  if (els.stampProgress) els.stampProgress.textContent = `${filled} / ${goal} runes lit`;
  if (els.stampFill) {
    const offset = 100 - (filled / goal) * 100;
    els.stampFill.style.strokeDashoffset = String(offset);
  }

  if (els.stampGrid) {
    const isLit = (id) => Boolean(stamps[id] || stamps[Number(id)]);
    const litFlags = STAMP_BOOTHS.map((booth) => isLit(booth.id));
    els.stampGrid.classList.toggle("is-complete", complete);
    els.stampGrid.classList.toggle("has-ink", litFlags.some(Boolean));
    const cols = goal > 4 ? 3 : 2;
    els.stampGrid.style.gridTemplateColumns = `repeat(${cols}, minmax(0, 1fr))`;
    const pads = STAMP_BOOTHS.map((booth, index) => {
      const stamped = litFlags[index];
      const col = index % cols;
      const row = Math.floor(index / cols);
      const rows = Math.ceil(litFlags.length / cols);
      const joins = [];
      if (stamped && col < cols - 1 && litFlags[index + 1]) joins.push("is-join-e");
      if (stamped && col > 0 && litFlags[index - 1]) joins.push("is-join-w");
      if (stamped && row < rows - 1 && litFlags[index + cols]) joins.push("is-join-s");
      if (stamped && row > 0 && litFlags[index - cols]) joins.push("is-join-n");
      const cls = ["stamp-pad", stamped ? "is-lit" : "", ...joins].filter(Boolean).join(" ");
      return `
        <button class="${cls}" type="button" data-stamp="${booth.id}" aria-label="${escapeHtml(booth.name)} · ${escapeHtml(booth.place)}${stamped ? " · stamped" : " · empty"}">
          <span class="stamp-pad__ink" aria-hidden="true">${markImg(booth.icon)}</span>
          <span class="stamp-pad__meta">
            <strong>${escapeHtml(booth.name)}</strong>
            <small>${escapeHtml(booth.short)}</small>
          </span>
        </button>`;
    }).join("");
    els.stampGrid.innerHTML = `
      <div class="stamp-grid__ticket" aria-hidden="true">
        <img src="img/wheel-ticket.png?v=r1" alt="">
      </div>
      ${pads}`;
    const ticket = els.stampGrid.querySelector(".stamp-grid__ticket");
    if (ticket) {
      if (complete) {
        ticket.style.maskImage = "none";
        ticket.style.webkitMaskImage = "none";
      } else {
        const cells = litFlags
          .map((lit, index) => {
            if (!lit) return "";
            const col = index % cols;
            const row = Math.floor(index / cols);
            const rows = Math.ceil(litFlags.length / cols);
            return `linear-gradient(#fff, #fff) ${(col / cols) * 100}% ${(row / rows) * 100}% / ${100 / cols}% ${100 / rows}% no-repeat`;
          })
          .filter(Boolean);
        const mask = cells.length ? cells.join(", ") : "linear-gradient(transparent, transparent)";
        ticket.style.mask = mask;
        ticket.style.webkitMask = mask;
      }
    }
  }

  if (els.stampRoadmap) {
    const isLit = (id) => Boolean(stamps[id] || stamps[Number(id)]);
    els.stampRoadmap.classList.toggle("is-complete", complete);
    els.stampRoadmap.classList.toggle("is-inked", filled > 0);
    els.stampRoadmap.innerHTML = stampBoardHtml({ lit: isLit, interactive: true });
    const artEl = els.stampRoadmap.querySelector(".station-map__art");
    if (artEl && !artEl.complete) artEl.addEventListener("load", layoutStampArt, { once: true });
    layoutStampArt();
  }

  const runeRing = document.getElementById("lanternRunes");
  if (runeRing) {
    const signature = STAMP_BOOTHS.map((booth) => booth.id).join(",");
    if (runeRing.dataset.booths !== signature) {
      runeRing.dataset.booths = signature;
      runeRing.innerHTML = STAMP_BOOTHS.map((booth, index) => `
      <div class="lantern__rune-slot" style="--rune: ${index}">
        <button class="lantern__rune" type="button" data-stamp="${escapeHtml(booth.id)}" aria-label="${escapeHtml(booth.name)}">
          <span class="lantern__rune-glow"></span>
          <span class="lantern__rune-stone"></span>
          <span class="lantern__rune-glyph" aria-hidden="true">${markImg(booth.icon)}</span>
        </button>
      </div>`).join("");
      const orbit = runeRing.getAnimations().find((anim) => anim.animationName === "rune-orbit");
      if (orbit && orbit.currentTime != null) {
        runeRing.querySelectorAll(".lantern__rune-glyph").forEach((glyph) => {
          const spin = glyph.getAnimations().find((anim) => anim.animationName === "rune-spin");
          if (spin) spin.currentTime = orbit.currentTime;
        });
      }
    }
    const isLit = (id) => Boolean(stamps[id] || stamps[Number(id)]);
    runeRing.querySelectorAll(".lantern__rune").forEach((btn) => {
      btn.classList.toggle("is-lit", isLit(btn.dataset.stamp));
    });
  }

  const adminNo = cardState.studentNumber || session.payload.studentNumber || "";
  const redeemed = isPassRedeemed(cardState.redeemedAt);
  if (redeemed) spiritRaised = false;
  const lit = STAMP_BOOTHS.filter((booth) => stamps[booth.id] || stamps[String(booth.id)] || stamps[Number(booth.id)]).map((booth) => booth.id);
  if (els.passHolder) {
    els.passHolder.textContent = locked ? "Student" : cardState.fullName || session.payload.name || "";
  }
  if (els.passAdmin) els.passAdmin.textContent = adminNo;
  if (els.passId) {
    els.passId.classList.toggle("is-locked", !complete);
    els.passId.classList.remove("is-rested");
    els.passId.textContent = complete
      ? cardState.passId
      : `Locked · ${filled} / ${goal} runes lit`;
  }
  applyGhostPass(els.fastPassCard, {
    seed: adminNo || cardState.passId,
    raised: spiritRaised,
    redeemed,
    lit,
    complete,
  });
  layoutLanternRunes();
  if (els.passKicker) {
    els.passKicker.textContent = redeemed
      ? "Spirit keepsake"
      : complete
        ? "Show this at the wheel"
        : "Caged spirit";
  }
  if (els.lanternHint) {
    const hideHint = complete || redeemed || ghostRoaming;
    els.lanternHint.hidden = hideHint;
    if (!hideHint) {
      els.lanternHint.textContent = filled
        ? `Uncover ${goal - filled} more piece${goal - filled === 1 ? "" : "s"} of your wheel ticket`
        : "The spirit is caged. Stamp booths to uncover your ticket";
    }
  }
  if (els.passUsedMark) els.passUsedMark.hidden = !redeemed;
  if (els.redeemedNote) {
    els.redeemedNote.hidden = !redeemed;
    if (redeemed) {
      const when = new Date(cardState.redeemedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      els.redeemedNote.textContent = `Redeemed at ${when}`;
    }
  }
  if (locked) requestAnimationFrame(layoutStampPage);
  syncBoothStampsOnMap();
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
  const type = kind || els.feedbackKind?.value || "general";
  const which = document.getElementById("feedbackWhich");
  if (type === "general") {
    if (which) which.hidden = true;
    el.innerHTML = `<option value="night">The night</option>`;
    el.value = "night";
    return;
  }
  if (which) which.hidden = false;
  const options = type === "booth"
    ? BOOTHS.map((b) => `<option value="${b.id}">${b.name}</option>`)
    : HOUSES.filter((h) => h.kind !== "screening").map((h) => `<option value="${h.id}">${h.name}</option>`);
  const keep = el.value;
  el.innerHTML = options.join("");
  if ([...el.options].some((o) => o.value === keep)) el.value = keep;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function feedbackLabel(row) {
  if (row.kind === "general") return "The night";
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
          <p><strong>${escapeHtml(feedbackLabel(row))}</strong> · ${row.kind === "booth" ? "Booth" : row.kind === "general" ? "General" : "Scare house"}</p>
          <p>${escapeHtml(row.message)}</p>
          <p class="muted">${who} · ${escapeHtml(when)}${row.rating ? ` · ${row.rating}/5` : ""}</p>
        </li>`;
      }).join("")
      : "<li class='empty-state'><p class='empty-state__title'>No feedback yet</p><p class='empty-state__hint'>Student comments will land here as the night goes on.</p></li>");
  } catch (error) {
    if (els.adminFeedbackError) {
      els.adminFeedbackError.hidden = false;
      els.adminFeedbackError.textContent = userFacingError(error, "Could not load feedback. Try again.");
    }
  }
}

function paintAdminFeedbackTargetSelect() {
  const wrap = document.getElementById("feedbackTargetWrap");
  const select = els.adminFeedbackTarget;
  if (!wrap || !select) return;
  if (!feedbackKindFilter || feedbackKindFilter === "general") {
    wrap.hidden = true;
    select.innerHTML = `<option value="">All in this type</option>`;
    return;
  }
  wrap.hidden = false;
  const items = feedbackKindFilter === "booth"
    ? BOOTHS.map((b) => `<option value="${b.id}">${b.name}</option>`)
    : HOUSES.filter((h) => h.kind !== "screening").map((h) => `<option value="${h.id}">${h.name}</option>`);
  select.innerHTML = `<option value="">All in this type</option>${items.join("")}`;
}

function renderTimeline() {
  document.getElementById("night-programme")?.setAttribute("hidden", "");
  if (els.nightTimeline) els.nightTimeline.replaceChildren();
}

function formatPostedAt(iso) {
  if (!iso) return { clock: "", ago: "", fresh: false };
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return { clock: "", ago: "", fresh: false };
  const clock = then.toLocaleString([], {
    hour: "2-digit",
    minute: "2-digit",
    day: "numeric",
    month: "short",
  });
  const sec = Math.max(0, Math.floor((Date.now() - then.getTime()) / 1000));
  let ago = "just now";
  if (sec < 60) ago = "just now";
  else if (sec < 3600) {
    const mins = Math.floor(sec / 60);
    ago = mins === 1 ? "1 min ago" : `${mins} min ago`;
  } else if (sec < 86400) {
    const hours = Math.floor(sec / 3600);
    ago = hours === 1 ? "1 hour ago" : `${hours} hours ago`;
  } else if (sec < 172800) ago = "1 day ago";
  else ago = `${Math.floor(sec / 86400)} days ago`;
  return { clock, ago, fresh: sec < 60 };
}

function announceItemHtml(row) {
  const { clock, ago, fresh } = formatPostedAt(row.created_at);
  const relative = fresh ? "just posted" : ago;
  const when = [clock, relative].filter(Boolean).join(" · ");
  const audience = row.audience && row.audience !== "all" ? row.audience : "";
  const house = row.house_id ? houseMeta(row.house_id)?.short : "";
  const where = [audience, house].filter(Boolean).join(" · ");
  return `<li class="announce-item">
    <p class="announce-item__body">${escapeHtml(row.message)}</p>
    <p class="announce-item__when">${escapeHtml([when, where].filter(Boolean).join(" · "))}</p>
  </li>`;
}

async function loadPublicAnnouncements() {
  const rows = await fetchAnnouncements().catch(() => []);
  noteNewAnnouncements(rows);
  const empty = `<li class="announce-item announce-item--empty"><p class="announce-item__body">No announcements yet.</p></li>`;
  const html = rows.length ? rows.map(announceItemHtml).join("") : empty;
  if (els.announceStrip) els.announceStrip.innerHTML = html;
  if (els.announceList) els.announceList.innerHTML = html;
  const details = document.getElementById("announceDetails");
  if (details) details.open = rows.length > 0;
}

const ANNOUNCE_SEEN_KEY = "scream-announce-seen";
let announceSeenReady = false;

function noteNewAnnouncements(rows) {
  const ids = rows.map((row) => String(row.id || "")).filter(Boolean);
  let seen = [];
  try {
    seen = JSON.parse(sessionStorage.getItem(ANNOUNCE_SEEN_KEY) || "[]");
  } catch {
    seen = [];
  }
  if (!announceSeenReady) {
    sessionStorage.setItem(ANNOUNCE_SEEN_KEY, JSON.stringify(ids));
    announceSeenReady = true;
    return;
  }
  const known = new Set(seen);
  rows.forEach((row) => {
    if (!row?.id || known.has(String(row.id))) return;
    showAnnounceToast(row);
  });
  sessionStorage.setItem(ANNOUNCE_SEEN_KEY, JSON.stringify([...new Set([...seen, ...ids])].slice(-40)));
}

async function loadAdminAnnouncements() {
  if (!els.adminAnnounceList) return;
  try {
    const rows = await fetchAnnouncements({ all: true });
    els.adminAnnounceList.innerHTML = rows.length
      ? rows.map((row) => {
        const { clock, ago, fresh } = formatPostedAt(row.created_at);
        const posted = row.active !== false;
        const relative = fresh ? "just posted" : ago;
        return `<li class="feedback-item">
          <p>${escapeHtml(row.message)}</p>
          <p class="muted">${escapeHtml(row.posted_by || "Staff")} · ${escapeHtml(row.audience || "all")}${row.house_id ? ` · ${escapeHtml(row.house_id)}` : ""}${row.expires_at ? ` · expires ${escapeHtml(formatPostedAt(row.expires_at).clock)}` : ""} · Posted ${escapeHtml(clock)}${relative ? ` · ${escapeHtml(relative)}` : ""} · ${posted ? "Showing" : "Taken down"}</p>
          ${posted ? `<button class="btn btn--ghost" type="button" data-announce-off="${escapeHtml(row.id)}">Take down</button>` : ""}
        </li>`;
      }).join("")
      : `<li class="empty-state"><p class="empty-state__title">No announcements yet</p><p class="empty-state__hint">Post a note above for the Map page.</p></li>`;
  } catch (error) {
    els.adminAnnounceList.innerHTML = `<li class="form-error">${escapeHtml(userFacingError(error, "Could not load announcements. Try again."))}</li>`;
  }
}

async function loadOps() {
  const grid = document.getElementById("opsGrid");
  const audit = document.getElementById("opsAudit");
  if (!grid) return;
  try {
    const data = await fetchOps();
    const boothBits = STAMP_BOOTHS.map((b) => `<div class="ops-card"><span>${escapeHtml(b.name)}</span><strong>${data.stampsPerBooth?.[b.id] || 0}</strong></div>`).join("");
    grid.innerHTML = `
      <div class="ops-card"><span>Students</span><strong>${data.students || 0}</strong></div>
      <div class="ops-card"><span>Wheel tickets unlocked</span><strong>${data.fastPassUnlocked || 0}</strong></div>
      <div class="ops-card"><span>Houses busy</span><strong>${data.housesBusy || 0}</strong></div>
      <div class="ops-card"><span>Houses long</span><strong>${data.housesLong || 0}</strong></div>
      <div class="ops-card"><span>Houses closed</span><strong>${data.housesClosed || 0}</strong></div>
      <div class="ops-card"><span>Feedback (6h)</span><strong>${data.recentFeedback || 0}</strong></div>
      ${boothBits}`;
    if (audit) {
      const rows = data.audit || [];
      audit.innerHTML = rows.length
        ? rows.map((row) => `<li class="feedback-item"><p>${escapeHtml(row.action)} · ${escapeHtml(row.target || "")}</p><p class="muted">${escapeHtml(row.staff_id)} · ${escapeHtml(row.at || "")}</p></li>`).join("")
        : "<li class='empty-state'><p class='empty-state__title'>No audit rows yet</p><p class='empty-state__hint'>Staff actions will appear here.</p></li>";
    }
  } catch (error) {
    grid.innerHTML = `<div class="empty-state"><p class="empty-state__title">Command post unavailable</p><p class="empty-state__hint">${escapeHtml(userFacingError(error, "Could not load the command post. Try again."))}</p></div>`;
  }
}

function fillAwardBoothSelect() {
  if (!els.awardBooth) return;
  const lockedId = staffBoothId();
  const list = lockedId ? STAMP_BOOTHS.filter((booth) => booth.id === lockedId) : STAMP_BOOTHS;
  const signature = `${staffScope()}:${list.map((booth) => booth.id).join(",")}`;
  if (els.awardBooth.dataset.filled !== signature) {
    els.awardBooth.innerHTML = list.map((booth) => `<option value="${booth.id}">${booth.short} · ${booth.name}</option>`).join("");
    els.awardBooth.dataset.filled = signature;
  }
  const booth = list[0];
  const locked = Boolean(lockedId && booth);
  els.awardBooth.disabled = locked;
  const lockNote = document.getElementById("awardBoothLock");
  const title = document.getElementById("awardStampTitle");
  const lead = document.getElementById("awardStampLead");
  const boothLabel = document.getElementById("awardBoothLabel");
  const submit = document.getElementById("awardStampSubmit");
  if (lockNote) {
    lockNote.hidden = !locked;
    lockNote.textContent = locked ? `This login awards ${booth.name}.` : "";
  }
  if (title) title.textContent = locked ? booth.name : "Award a booth stamp";
  if (lead) lead.hidden = !locked;
  if (boothLabel) boothLabel.hidden = locked;
  if (submit) submit.textContent = locked ? `Award ${booth.name}` : "Award stamp";
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
    message: userFacingError(error, "Something went wrong. Try again."),
  });
  sessionStorage.setItem("scream-staff-log", JSON.stringify(rows.slice(0, 40)));
  paintStaffLog();
}

async function renderAdmin() {
  if (!canSeeStaffTab()) {
    els.adminGate.hidden = true;
    els.adminApp.hidden = true;
    updateNav();
    return;
  }
  const admin = await verifyAdminSession();
  if (!admin) {
    els.adminGate.hidden = false;
    els.adminApp.hidden = true;
    const lead = document.getElementById("staffGateLead");
    const studentSession = getStudentSession();
    if (lead) {
      lead.hidden = !studentSession;
      lead.textContent = studentSession
        ? "Enter the night staff password to open wait times, stamps, and the rest of the desk."
        : "";
    }
    updateNav();
    queueMicrotask(() => document.getElementById("staffUnlockPassword")?.focus());
    return;
  }
  const signedIn = document.getElementById("staffSignedIn");
  if (signedIn) signedIn.hidden = false;
  els.adminGate.hidden = true;
  els.adminApp.hidden = false;
  updateNav();

  els.adminTable.innerHTML = CLUSTERS.map((cluster) => {
    const members = houses.filter((row) => houseMeta(row.id)?.cluster === cluster.id);
    if (!members.length) return "";
    const head = `<tr class="admin-cluster"><td colspan="4">${escapeHtml(cluster.kicker)} · ${escapeHtml(cluster.name)}</td></tr>`;
    const body = members.map((row) => {
      const meta = houseMeta(row.id);
      const draft = drafts.get(row.id);
      const minutes = draft ? draft.wait_minutes : row.wait_minutes;
      const published = hasPublishedWait(row) && Number(row.wait_minutes) === Number(minutes);
      return `
        <tr data-admin-row="${row.id}">
          <td>
            <strong>${escapeHtml(row.name)}</strong>
            <div class="muted">${escapeHtml(meta?.rooms || meta?.short || "")}</div>
          </td>
          <td>
            <div class="wait-editor">
              <button type="button" data-adjust="-5" aria-label="Decrease wait by 5 minutes">−5</button>
              <button type="button" data-adjust="-1" aria-label="Decrease wait by 1 minute">−1</button>
              <input type="number" min="0" max="${WAIT_MAX}" step="1" value="${minutes ?? ""}" data-wait-input aria-label="Wait minutes for ${escapeHtml(row.name)}">
              <button type="button" data-adjust="1" aria-label="Increase wait by 1 minute">+1</button>
              <button type="button" data-adjust="5" aria-label="Increase wait by 5 minutes">+5</button>
            </div>
          </td>
          <td class="wait-status" data-publish-state="${published ? "saved" : "dirty"}">${published ? "Published" : "Not published yet"}</td>
          <td>
            <button class="btn btn--ghost" type="button" data-publish-one>Publish</button>
          </td>
        </tr>`;
    }).join("");
    return head + body;
  }).join("");
  fillAwardBoothSelect();
  const houseSel = document.getElementById("announceHouse");
  if (houseSel && !houseSel.dataset.filled) {
    houseSel.innerHTML = `<option value="">General, not tied to a house</option>${HOUSES.filter((h) => h.kind !== "screening").map((h) => `<option value="${h.id}">${h.name}</option>`).join("")}`;
    houseSel.dataset.filled = "1";
  }
  const scope = staffScope();
  const errorLog = document.getElementById("staffErrorLogWrap");
  if (errorLog) errorLog.hidden = scope !== "admin";
  const allowed = [...document.querySelectorAll("[data-staff-tab]")].filter((btn) => {
    const need = btn.dataset.staffScope || "admin";
    const ok = staffSeesTab(scope, need);
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
  const wait = Math.max(0, Math.min(WAIT_MAX, Math.round(Number(tr.querySelector("[data-wait-input]").value) || 0)));
  const status = statusFromWait(wait);
  const row = houses.find((house) => house.id === id);
  const published = hasPublishedWait(row) && Number(row.wait_minutes) === wait;
  const label = tr.querySelector("[data-publish-state]");
  if (label) {
    label.textContent = published ? "Published" : "Not published yet";
    label.dataset.publishState = published ? "saved" : "dirty";
  }
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

function scheduleWaitSave(id, patch) {
  drafts.set(id, patch);
  if (!autoSave) return;
  clearTimeout(waitSaveTimers.get(id));
  waitSaveTimers.set(
    id,
    setTimeout(() => {
      waitSaveTimers.delete(id);
      flushWaitSave(id);
    }, WAIT_SAVE_MS)
  );
}

async function flushWaitSave(id, attempt = 0) {
  if (waitSaveFlight.has(id)) return;
  const patch = drafts.get(id);
  if (!patch) return;
  waitSaveFlight.add(id);
  let result;
  try {
    result = await persistHouse(id, patch);
  } finally {
    waitSaveFlight.delete(id);
  }
  const latest = drafts.get(id);
  if (latest && Number(latest.wait_minutes) !== Number(patch.wait_minutes)) {
    scheduleWaitSave(id, latest);
    return;
  }
  const retryable = result && result.ok === false && !/demo-only|sign in again/i.test(result.error || "");
  if (retryable && latest && attempt < 2) {
    await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)));
    const still = drafts.get(id);
    if (still && Number(still.wait_minutes) === Number(patch.wait_minutes)) flushWaitSave(id, attempt + 1);
  }
}

async function persistHouse(id, patch) {
  if (!store) return { ok: false, error: "Wait times are still loading." };
  clearTimeout(waitSaveTimers.get(id));
  waitSaveTimers.delete(id);
  const result = await store.publish(id, patch, { persist: true });
  if (result?.ok) {
    const current = drafts.get(id);
    if (!current || Number(current.wait_minutes) === Number(patch.wait_minutes)) drafts.delete(id);
    setWaitSaveStatus("Saved to the live database.", false);
    return result;
  }
  const latest = drafts.get(id);
  if (latest && Number(latest.wait_minutes) !== Number(patch.wait_minutes)) {
    scheduleWaitSave(id, latest);
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
      const raw = localStorage.getItem("scream-pin-opacity");
      saved = raw == null ? 100 : Number(raw);
    } catch {
      saved = 100;
    }
    if (!Number.isFinite(saved) || saved < 8) saved = 100;
    applyPinFade(saved);
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
    const booths = event.target.closest("[data-open-booths]");
    if (booths) {
      event.preventDefault();
      openBooths();
      return;
    }
    const pin = event.target.closest("[data-open-pin]");
    if (pin) {
      event.preventDefault();
      openPin(pin.dataset.openPin);
      return;
    }
    const house = event.target.closest("[data-open-house]");
    if (!house) return;
    event.preventDefault();
    openHouse(house.dataset.openHouse);
  });
  window.addEventListener("resize", () => {
    fitMap();
    layoutStampPage();
  });
  window.visualViewport?.addEventListener("resize", layoutStampPage);
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
    const clearOne = event.target.closest("[data-clear-filter]");
    if (clearOne) {
      clearHouseFilters(clearOne.dataset.clearFilter);
      return;
    }
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
  document.querySelector("[data-dismiss-push-hint]")?.addEventListener("click", () => {
    dismissPushHint();
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
    btn.addEventListener("click", (event) => {
      if (blockPageClick) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      setView(btn.dataset.nav);
    });
  });
  window.addEventListener("hashchange", () => {
    const { view, extra } = hashToView();
    setView.skipHash = true;
    setView(view, extra);
  });
  document.getElementById("announceAudience")?.addEventListener("change", (event) => {
    const wrap = document.getElementById("announceHouseWrap");
    if (wrap) wrap.hidden = event.target.value === "booths";
  });
  document.getElementById("modalWatch")?.addEventListener("click", () => {
    if (!openHouseId) return;
    toggleWatchHouse(openHouseId);
  });

  document.addEventListener("pointerdown", () => {
    if (sheetOpenedAt && Date.now() - sheetOpenedAt > 80) sheetOpenedAt = 0;
    blockPageClick = false;
  }, true);

  document.body.addEventListener("click", (event) => {
    if (blockPageClick && !event.target.closest("[data-close-modal]")) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
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
    const clusterBtn = event.target.closest("[data-open-cluster]");
    if (clusterBtn) {
      openCluster(clusterBtn.dataset.openCluster);
      return;
    }
    const pinBtn = event.target.closest("[data-open-pin]");
    if (pinBtn) {
      openPin(pinBtn.dataset.openPin);
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
        clearAdminSession();
        applyGameAccount();
        cardState = { stamps: {}, redeemedAt: null, redeemedBy: null, fullName: "", studentNumber: "", passId: "" };
        spiritRaised = false;
        stopGhostRoam();
        updateNav();
        renderStamps();
        if (document.querySelector(".view.is-active")?.dataset.view === "admin") setView("login");
      } else {
        flushGameProgress();
        clearAdminSession();
        applyGameAccount();
        updateNav();
        const onStaff = document.querySelector(".view.is-active")?.dataset.view === "admin";
        if (onStaff) setView(getStudentSession() ? "stamps" : "login");
        else renderAdmin();
      }
    }

    if (event.target.closest("[data-clear-filters]")) {
      clearHouseFilters();
      return;
    }
    if (event.target.closest("[data-close-modal]")) closeModals({ restore: true });
  });

  ["studentLoginId", "awardStudentNumber"].forEach((id) => {
    document.getElementById(id)?.addEventListener("blur", (event) => {
      event.target.value = normalizeAdminNumber(event.target.value);
    });
  });

  function setFieldError(input, errorId, message) {
  const error = document.getElementById(errorId);
  if (!input || !error) return false;
  if (message) {
    error.hidden = false;
    error.textContent = message;
    input.setAttribute("aria-invalid", "true");
    input.setAttribute("aria-describedby", errorId);
    return true;
  }
  error.hidden = true;
  error.textContent = "";
  input.removeAttribute("aria-invalid");
  return false;
}

async function handleAuthSubmit(event) {
    event.preventDefault();
    const err = document.getElementById("studentLoginError");
    const submit = event.currentTarget.querySelector('button[type="submit"]');
    const idInput = document.getElementById("studentLoginId");
    const nameInput = document.getElementById("studentLoginName");
    if (err) err.hidden = true;
    const idValue = normalizeAdminNumber(idInput?.value || "");
    if (idInput) idInput.value = idValue;
    const idBad = setFieldError(idInput, "studentLoginIdError", isAdminNumber(idValue) ? "" : "Enter an admin number like P2512345. The digits start with 22, 23, 24, 25, or 26.");
    const nameBad = setFieldError(nameInput, "studentLoginNameError", nameInput?.value.trim() ? "" : "Enter your full name.");
    if (idBad || nameBad) {
      (idBad ? idInput : nameInput)?.focus();
      return;
    }
    if (submit) submit.disabled = true;
    try {
      flushGameProgress();
      const data = await signIn({
        adminNumber: idValue,
        fullName: nameInput.value,
      });
      applyGameAccount();
      updateNav();
      setView("stamps");
      if (data.student) {
        cardState.studentNumber = "";
        renderStamps({ refresh: true }).catch(() => paintStampUi());
        const picked = [...document.querySelectorAll('input[name="alertLevel"]:checked')].map((input) => input.value);
        writeAlertLevels(picked);
        if (picked.length) {
          setWantsPush(true);
          enablePushNotifications(pushWatchList(readNight().watch)).then(paintPushHint).catch(paintPushHint);
        } else {
          paintPushHint();
        }
      }
    } catch (error) {
      if (err) {
        err.hidden = false;
        err.textContent = userFacingError(error, "Sign-in failed. Check your admin number and name, then try again.");
      }
    } finally {
      if (submit) submit.disabled = false;
    }
  }

  document.getElementById("studentLoginForm")?.addEventListener("submit", (event) => handleAuthSubmit(event));

  document.getElementById("staffUnlockForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const err = document.getElementById("staffUnlockError");
    const submit = event.currentTarget.querySelector('button[type="submit"]');
    const student = getStudentSession();
    if (err) err.hidden = true;
    if (submit) submit.disabled = true;
    try {
      if (!student) throw new Error("Sign in with your admin number first.");
      await signIn({
        adminNumber: student.payload.studentNumber,
        fullName: student.payload.name,
        password: document.getElementById("staffUnlockPassword").value,
      });
      const pass = document.getElementById("staffUnlockPassword");
      if (pass) pass.value = "";
      applyGameAccount();
      updateNav();
      renderAdmin();
    } catch (error) {
      if (err) {
        err.hidden = false;
        err.textContent = userFacingError(error, "Staff password is incorrect.");
      }
    } finally {
      if (submit) submit.disabled = false;
    }
  });

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
    if (!at) return "This ticket is marked used.";
    const when = new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    return `Ticket used at ${when}${by ? ` by ${by}` : ""}.`;
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
      if (filled < STAMP_BOOTHS.length) {
        throw new Error(`This student has ${filled} / ${STAMP_BOOTHS.length} stamps. The wheel ticket is not unlocked.`);
      }
      const form = document.getElementById("staffRedeemLookupForm");
      const ready = document.getElementById("staffRedeemReady");
      const used = document.getElementById("staffRedeemUsed");
      if (form) form.hidden = true;
      if (used) used.hidden = true;
      if (ready) ready.hidden = false;
      document.getElementById("staffRedeemName").textContent = `${data.fullName} · ${data.studentNumber}`;
      document.getElementById("staffRedeemId").textContent = passId;
      document.getElementById("staffRedeemStamps").textContent = `${filled} / ${STAMP_BOOTHS.length} stamps · ready to spin the wheel`;
      document.getElementById("staffRedeemConfirm").dataset.studentNumber = data.studentNumber;
    } catch (error) {
      pushStaffLog("Redeem lookup", error);
      if (err) {
        err.hidden = false;
        err.textContent = staffDeskError(error);
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
      pushStaffLog("Redeem wheel ticket", error);
      if (err) {
        err.hidden = false;
        err.textContent = staffDeskError(error);
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
    setView(getStudentSession() ? "admin" : "login");
  });

  els.adminTable?.addEventListener("click", (event) => {
    const tr = event.target.closest("[data-admin-row]");
    if (!tr) return;
    const adjust = event.target.closest("[data-adjust]");
    if (adjust) {
      const input = tr.querySelector("[data-wait-input]");
      input.value = Math.max(0, Math.min(WAIT_MAX, Number(input.value) + Number(adjust.dataset.adjust)));
      const patch = readAdminRow(tr);
      scheduleWaitSave(patch.id, { wait_minutes: patch.wait_minutes, status: patch.status });
    }
    if (event.target.closest("[data-publish-one]")) {
      const patch = readAdminRow(tr);
      persistHouse(patch.id, { wait_minutes: patch.wait_minutes, status: patch.status });
    }
  });

  els.adminTable?.addEventListener("input", (event) => {
    if (!event.target.matches("[data-wait-input]")) return;
    const tr = event.target.closest("[data-admin-row]");
    if (tr) readAdminRow(tr);
  });

  els.adminTable?.addEventListener("change", (event) => {
    const tr = event.target.closest("[data-admin-row]");
    if (!tr) return;
    const patch = readAdminRow(tr);
    scheduleWaitSave(patch.id, { wait_minutes: patch.wait_minutes, status: patch.status });
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
        els.awardStampError.textContent = staffDeskError(error);
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
    const kind = els.feedbackKind?.value || "general";
    const general = kind === "general";
    const kindBad = setFieldError(els.feedbackKind, "feedbackKindError", kind ? "" : "Choose what this note is about.");
    const targetBad = setFieldError(
      els.feedbackTarget,
      "feedbackTargetError",
      general || els.feedbackTarget?.value ? "" : "Choose which house or booth."
    );
    if (kindBad || targetBad) {
      (kindBad ? els.feedbackKind : els.feedbackTarget)?.focus();
      return;
    }
    try {
      await submitFeedback(
        kind,
        general ? "night" : els.feedbackTarget.value,
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
        els.feedbackError.textContent = userFacingError(error, "Could not send feedback. Try again.");
      }
    }
  });

  els.announceForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (els.announceError) els.announceError.hidden = true;
    try {
      const audienceSelect = document.getElementById("announceAudience")?.value || "all";
      const houseId = document.getElementById("announceHouse")?.value || "";
      const audience = audienceSelect === "booths" ? "booths" : houseId ? "house" : "all";
      await postAnnouncement(document.getElementById("announceMessage").value, {
        audience,
        houseId,
        expiresMinutes: document.getElementById("announceExpires")?.value || "",
      });
      document.getElementById("announceMessage").value = "";
      await loadAdminAnnouncements();
      await loadPublicAnnouncements();
    } catch (error) {
      if (els.announceError) {
        els.announceError.hidden = false;
        els.announceError.textContent = userFacingError(error, "Could not save that announcement. Try again.");
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
        els.announceError.textContent = userFacingError(error, "Could not save that announcement. Try again.");
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
    if (event.key === "Escape") {
      const open = document.querySelector(".modal:not([hidden])");
      if (open) closeModals({ restore: true, force: true });
    }
  });
  window.addEventListener("online", () => paintWaitBanner());
  window.addEventListener("offline", () => paintWaitBanner());
}

function paintWaitBanner(sync) {
  const note = document.getElementById("siteLiveNote");
  if (!note) return;
  if (sync) waitSync = sync;
  else if (store?.getSync) waitSync = store.getSync();
  const offline = typeof navigator !== "undefined" && navigator.onLine === false;
  if (waitSync.liveOk && !offline) {
    note.hidden = true;
    note.classList.remove("is-stale");
    note.textContent = "";
    return;
  }
  if (!offline && !waitSync.wasLive) {
    note.hidden = true;
    note.classList.remove("is-stale");
    note.textContent = "";
    return;
  }
  note.hidden = false;
  note.classList.add("is-stale");
  const ago = waitSync.lastLiveAt
    ? freshnessLabel(waitSync.lastLiveAt).replace(/^Updated /, "updated ")
    : "";
  note.textContent = offline
    ? ago
      ? `No connection. The map and house stories stay on this page. Last known waits, ${ago}.`
      : "No connection. The map, houses, and help stay on this page. Waits catch up when the signal returns."
    : `Last known waits${ago ? ` · ${ago}` : ""}`;
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
    : `DEMO MODE. Not writing to the database. Staff changes and new accounts stay on this device only.${error ? ` ${error}` : ""}${localHint} For the real night set JWT_SECRET, ADMIN_PASSCODE, and the Supabase service role on Vercel.`;
}

function onStoreChange(next, sync) {
  const normalized = (next || []).map(normalizeHouseRow);
  notifyWatches(normalized);
  houses = normalized;
  if (sync) {
    paintWaitBanner(sync);
    if (sync.liveOk) paintConnectionUi("live");
  }
  renderDashboard();
  renderPins();
  if (document.querySelector('.view.is-active')?.dataset.view === "admin" && isAdminUnlocked()) {
    const active = document.activeElement;
    if (!active?.matches("[data-wait-input]")) renderAdmin();
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
    paintSponsors();
  } catch (error) {
    console.warn("UI bind failed", error);
  }
  try {
    bindMap();
  } catch (error) {
    console.warn("Map setup failed", error);
  }
  try {
    renderDashboard();
    renderPins();
  } catch (error) {
    console.warn("House list failed", error);
  }
  import("./games.js?v=r9")
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
  resumePushIfWanted(pushWatchList(readNight().watch));
  const start = hashToView();
  const explicitTab = Boolean(location.hash) && start.view && start.view !== "welcome";
  if (wantsOpeningNight() && !explicitTab) {
    setView("welcome");
  } else if (location.hash && start.view) {
    setView.skipHash = true;
    setView(start.view, start.extra);
  }
  window.addEventListener("scream-gates-opened", () => {
    const next = hashToView();
    const asked = Boolean(location.hash) && next.view && next.view !== "welcome";
    if (wantsOpeningNight() && !asked) setView("welcome");
  });
  window.setInterval(() => {
    if (document.hidden) return;
    loadPublicAnnouncements();
    if (document.querySelector(".view.is-active")?.dataset.view === "map") renderTimeline();
  }, 20000);
  window.addEventListener("offline", () => paintWaitBanner());
  window.addEventListener("online", () => {
    paintWaitBanner();
    if (store?.refresh) store.refresh();
  });

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
