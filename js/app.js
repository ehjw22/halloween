import { initEventGate, isEventOpen, isDevPreview, WELCOME_PENDING_KEY } from "./gate.js?v=21e51c2e51";
import { CLUBS } from "./clubs.js?v=21e51c2e51";
import { CLUSTERS, HOUSES, PINS, RETIRED_HOUSES, clusterById, pinById, STATUSES } from "./houses.js?v=21e51c2e51";
import { BOOTHS, STAMP_BOOTHS, FOOD_BOOTHS, boothById } from "./booths.js?v=21e51c2e51";
import { SPONSORS } from "./sponsors.js?v=21e51c2e51";
import { applyGhostPass } from "./ghost-pass.js?v=21e51c2e51";
import { markImg } from "./marks.js?v=21e51c2e51";
import { stationSvg } from "./station-art.js?v=21e51c2e51";
import { createStore } from "./store.js?v=21e51c2e51";
import { createPoller, subscribeVersions } from "./live.js?v=21e51c2e51";
import { statusFor, statusChipLabel, statusName } from "./wait-status.js?v=21e51c2e51";
import {
  apiFetch,
  apiUrl,
  awardStamp,
  unawardStamp,
  clearAdminSession,
  clearStudentSession,
  fetchAnnouncements,
  fetchFeedback,
  fetchOps,
  fetchStamps,
  fetchStampsVersion,
  getAdminSession,
  getStudentSession,
  canUseStaffUi,
  verifyAdminSession,
  lookupStudent,
  postAnnouncement,
  redeemPass,
  unredeemPass,
  setAnnouncementActive,
  signIn,
  unlockStaff,
  submitFeedback,
  normalizeAdminNumber,
  isAdminNumber,
  userFacingError,
} from "./session.js?v=21e51c2e51";
import { FIRST_TRY_JITTER_MS, SIGNIN_TEXT, withSignInRetry } from "./signin-retry.js?v=21e51c2e51";
import {
  describePushBlock,
  disablePushNotifications,
  enablePushNotifications,
  paintPushHint,
  registerPushWorker,
  resumePushIfWanted,
  setWantsPush,
  syncPushWatch,
  dismissPushHint,
  pushIsLive,
} from "./push.js?v=21e51c2e51";

let setGamesVisible = () => {};
let flushGameProgress = () => {};
let applyGameAccount = () => {};

const STATUS_LABEL = Object.fromEntries(STATUSES.map((s) => [s.id, s.label]));
const WAIT_MAX = 120;

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

function statusFromWait(minutes, closed = false) {
  return statusFor(minutes, closed);
}

function hasPublishedWait(row) {
  const wait = row?.wait_minutes;
  return wait !== null && wait !== undefined && wait !== "" && Number.isFinite(Number(wait));
}

/**
 * Stamp card ticket art. "prize" = generic Scream Fest prize ticket (default).
 * Set to "wheel" to bring back the original WHEEL TICKET / ONE SPIN artwork (img/wheel-ticket.png).
 */
const TICKET_ART = "prize";
const TICKET_ART_SRC = TICKET_ART === "wheel" ? "img/wheel-ticket.png?v=r1" : "img/prize-ticket.png?v=r2";

/** "Nº 0007" on the prize ticket's stub: completion order, only once the card is complete. */
function ticketNoHtml(complete) {
  const no = cardState.completeNo;
  if (TICKET_ART !== "prize" || !complete || !no) return "";
  return `<span class="ticket-no" aria-hidden="true"><span>Nº ${String(no).padStart(4, "0")}</span></span>`;
}

function normalizeHouseRow(row) {
  const raw = row.wait_minutes ?? row.wait;
  // Combined cards (e.g. Cursed Cavern + No One Leaves) keep the live row but show the joint title.
  const shown = HOUSES.find((h) => h.id === row.id);
  const published = raw !== null && raw !== undefined && raw !== "";
  const wait = published ? Math.max(0, Number(raw) || 0) : null;
  const closed = row.closed === true || (row.closed === undefined && row.status === "closed");
  return {
    ...row,
    ...(shown?.combined ? { name: shown.name } : {}),
    wait_minutes: wait,
    closed,
    status: closed ? "closed" : published ? statusFromWait(wait) : "open",
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
let stampVersion = 0;
let announceRows = [];
let announceLoaded = false;
let announceDirty = false;
let waitSync = { liveOk: false, wasLive: false, lastLiveAt: null };
let autoSave = false;
let cardState = { stamps: {}, redeemedAt: null, redeemedBy: null, fullName: "", studentNumber: "", passId: "" };
const drafts = new Map();
const waitSaveTimers = new Map();
const waitSaveFlight = new Set();
const WAIT_SAVE_MS = 800;
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

function admissionNumberProblem(id) {
  if (!id) return "Enter your admin number, e.g. P2XXXXXX.";
  if (!/^P\d{7}$/.test(id)) return "That's a P and then 7 digits, e.g. P2XXXXXX.";
  if (!isAdminNumber(id)) return "The digits after the P start with 22, 23, 24, 25 or 26.";
  return "";
}

function roomLabel(rooms) {
  const text = String(rooms || "").trim();
  return /^T\d{2}[A-Z]?\d{2,3}$/.test(text) ? `Room ${text}` : text;
}

function rowStatus(row) {
  if (!row) return "open";
  return statusFromWait(row.wait_minutes, Boolean(row.closed));
}

function waitLabel(minutes, status) {
  if (status === "closed") return "Closed";
  if (minutes === null || minutes === undefined || minutes === "") return "Not published";
  if ((Number(minutes) || 0) === 0) return "No queue";
  return `${Number(minutes) || 0} min`;
}

function statusPillLabel(row) {
  return STATUS_LABEL[rowStatus(row)] || row.status;
}

function waitMetric(row) {
  if (row?.closed) return { value: "Closed", unit: "Not running", kind: "closed" };
  if (!hasPublishedWait(row)) return { value: "-", unit: "Not published", kind: "queue" };
  const minutes = Number(row.wait_minutes) || 0;
  if (minutes === 0) return { value: "No queue", unit: "", kind: "clear" };
  return { value: String(minutes), unit: "min wait", kind: "queue" };
}

function waitRank(row) {
  const status = rowStatus(row);
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
  const status = rowStatus(row);
  if (houseFilter.status) {
    if ((!hasPublishedWait(row) && !row.closed) || status !== houseFilter.status) return false;
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
    btn.textContent = statusChipLabel(btn.dataset.filterStatus);
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

function houseArt(id) {
  const ink = "#1a1218";
  const art = {
    "three-doors": `<svg viewBox="0 0 96 96" aria-hidden="true"><rect x="8" y="16" width="22" height="64" rx="2" fill="#f3d7ae" stroke="${ink}" stroke-width="2.4"/><g class="arm"><rect x="37" y="16" width="22" height="64" rx="2" fill="#e7c48a" stroke="${ink}" stroke-width="2.4"/></g><rect x="66" y="16" width="22" height="64" rx="2" fill="#f3d7ae" stroke="${ink}" stroke-width="2.4"/><circle cx="26" cy="50" r="2" fill="${ink}"/><circle cx="54" cy="50" r="2" fill="${ink}"/><circle cx="84" cy="50" r="2" fill="${ink}"/></svg>`,
    marionette: `<svg viewBox="0 0 96 96" aria-hidden="true"><path d="M48 6v16M28 8l14 20M68 8 54 28" stroke="${ink}" stroke-width="2" stroke-linecap="round"/><g class="bob"><circle cx="48" cy="32" r="12" fill="#f6e2c4" stroke="${ink}" stroke-width="2.4"/><circle cx="43" cy="31" r="1.6" fill="${ink}"/><circle cx="53" cy="31" r="1.6" fill="${ink}"/><rect x="38" y="46" width="20" height="28" rx="6" fill="#d85a6a" stroke="${ink}" stroke-width="2.2"/><path d="M38 54H22M58 54h16" stroke="${ink}" stroke-width="2.2" stroke-linecap="round"/></g></svg>`,
    caligari: `<svg viewBox="0 0 96 96" aria-hidden="true"><path d="M48 18 86 84H10Z" fill="#f6efe4" stroke="${ink}" stroke-width="2.6" stroke-linejoin="round"/><path d="M48 24 70 84H58Z" fill="#d23a42"/><path d="M48 24 26 84H38Z" fill="#d23a42"/><path d="M48 30 62 84h-10Z" fill="#d23a42"/><path d="M48 30 34 84h10Z" fill="#d23a42"/><path d="M36 84c2-24 8-30 12-30s10 8 12 30" fill="#10080c"/><path d="M34 68c10 8 18 6 26-2" fill="none" stroke="#f6efe4" stroke-width="2" stroke-linecap="round"/><g class="glow"><circle cx="43" cy="72" r="3.4" fill="#f6e7b0" stroke="${ink}" stroke-width="1.2"/><circle cx="55" cy="72" r="3.4" fill="#f6e7b0" stroke="${ink}" stroke-width="1.2"/><circle cx="44" cy="72" r="1.5" fill="${ink}"/><circle cx="56" cy="72" r="1.5" fill="${ink}"/></g><path d="M20 60h56" stroke="#f0d36a" stroke-width="5" stroke-linecap="round"/><path d="M48 18V8" stroke="${ink}" stroke-width="2.4" stroke-linecap="round"/><g class="arm"><path d="M48 8h16l-4 4.5 4 4.5H48z" fill="#e23b4a" stroke="${ink}" stroke-width="1.6" stroke-linejoin="round"/></g></svg>`,
    clowns: `<svg viewBox="0 0 96 96" aria-hidden="true"><circle cx="48" cy="50" r="28" fill="#fff6ea" stroke="${ink}" stroke-width="2.6"/><path d="M22 40c8-16 44-16 52 0" fill="#e23b4a" stroke="${ink}" stroke-width="2"/><circle cx="38" cy="48" r="3" fill="${ink}"/><circle cx="58" cy="48" r="3" fill="${ink}"/><circle cx="48" cy="56" r="4" fill="#e23b4a"/><g class="jaw"><path d="M36 64c6 8 18 8 24 0" fill="none" stroke="${ink}" stroke-width="2.4" stroke-linecap="round"/></g></svg>`,
    illusionist: `<svg viewBox="0 0 96 96" aria-hidden="true"><path d="M16 12h28v72H16z" fill="#6a2a4a" stroke="${ink}" stroke-width="2.2"/><path d="M52 12h28v72H52z" fill="#4a1c38" stroke="${ink}" stroke-width="2.2"/><g class="glow"><path d="M48 40l2 6 6 1-5 4 2 6-5-3-5 3 2-6-5-4 6-1z" fill="#f6e7b0"/></g></svg>`,
    "last-laugh": `<svg viewBox="0 0 96 96" aria-hidden="true"><path d="M14 78V34c0-16 68-16 68 0v44" fill="#2a2438" stroke="#f3e6d8" stroke-width="2.6"/><circle cx="48" cy="50" r="14" fill="#fff6ea" stroke="${ink}" stroke-width="2.2"/><circle cx="43" cy="48" r="2" fill="${ink}"/><circle cx="53" cy="48" r="2" fill="${ink}"/><g class="jaw"><path d="M42 56c3 4 9 4 12 0" fill="none" stroke="${ink}" stroke-width="2" stroke-linecap="round"/></g></svg>`,
    "cursed-cavern": `<svg viewBox="0 0 96 96" aria-hidden="true"><path d="M8 80c8-28 16-48 40-52 24 4 32 24 40 52" fill="#243028" stroke="#d7ecdf" stroke-width="2.6"/><path d="M28 80c4-16 10-24 20-26 10 2 16 10 20 26" fill="#0e1612"/><g class="bat"><path d="M46 36c-6-5-11 1-5 4 2-1 3-1 5 0z" fill="#f4f0ff" stroke="${ink}" stroke-width="1.2"/><path d="M46 36c6-5 11 1 5 4-2-1-3-1-5 0z" fill="#f4f0ff" stroke="${ink}" stroke-width="1.2"/></g></svg>`,
    "no-one-leaves": `<svg viewBox="0 0 96 96" aria-hidden="true"><path d="M48 14 84 46H12z" fill="#e7d3b4" stroke="${ink}" stroke-width="2.4" stroke-linejoin="round"/><rect x="22" y="46" width="52" height="34" fill="#f3e6d0" stroke="${ink}" stroke-width="2.4"/><g class="glow"><rect x="30" y="56" width="12" height="12" fill="#1a1218"/><rect x="54" y="56" width="12" height="12" fill="#1a1218"/></g></svg>`,
    prisoner: `<svg viewBox="0 0 96 96" aria-hidden="true"><rect x="14" y="8" width="68" height="80" rx="3" fill="#1c2430" stroke="#f3e6d8" stroke-width="2.4"/><g class="ghost"><circle cx="48" cy="32" r="12" fill="#f4f7fb" stroke="${ink}" stroke-width="2.2"/><circle cx="44" cy="31" r="1.7" fill="${ink}"/><circle cx="53" cy="31" r="1.7" fill="${ink}"/><path d="M38 38h4M56 38h4" stroke="${ink}" stroke-width="1.4" stroke-linecap="round"/><path d="M34 46h28l-2 32H36z" fill="#f7f4ec" stroke="${ink}" stroke-width="2.2"/><path d="M44 38c2 2 6 2 8 0" fill="none" stroke="${ink}" stroke-width="1.6" stroke-linecap="round"/><rect x="35" y="52" width="26" height="6" fill="${ink}"/><rect x="34" y="64" width="27" height="6" fill="${ink}"/></g><path d="M28 8v80M48 8v80M68 8v80" stroke="#e7e1d6" stroke-width="4.5" stroke-linecap="round"/><circle cx="28" cy="58" r="4.2" fill="#f4f7fb" stroke="${ink}" stroke-width="1.8"/><circle cx="68" cy="58" r="4.2" fill="#f4f7fb" stroke="${ink}" stroke-width="1.8"/></svg>`,
    "whispering-woods": `<svg viewBox="0 0 96 96" aria-hidden="true"><ellipse cx="48" cy="84" rx="36" ry="6" fill="#d5e4ea"/><g class="bob" fill="none" stroke="#f3e6d8" stroke-linecap="round" stroke-linejoin="round"><path d="M22 84c1-18-2-28-8-36" stroke-width="4"/><path d="M14 48c6-8 2-16-4-20M14 50c8-2 12-12 6-18M16 58c8 0 10-8 16-6" stroke-width="3"/><path d="M48 86c-1-26-6-34-2-50" stroke-width="5"/><path d="M46 36c-8-4-10-14-2-20M46 40c10-2 16-12 10-18M50 52c12-4 16 2 18 10" stroke-width="3"/><path d="M74 84c1-16 6-26 2-38" stroke-width="4"/><path d="M76 46c8-6 10-14 2-18M76 48c-8-2-12-12-4-16" stroke-width="3"/></g><ellipse class="glow" cx="48" cy="82" rx="28" ry="5" fill="#eef6f8"/></svg>`,
    slenderman: `<svg viewBox="0 0 96 96" aria-hidden="true"><g class="ghost"><ellipse cx="48" cy="14" rx="8" ry="10" fill="#f7f8fb" stroke="${ink}" stroke-width="2.2"/><path d="M41 24h14l5 58H36z" fill="#12121a" stroke="#f4f6fb" stroke-width="2.2" stroke-linejoin="round"/><path d="M45 28h6l2 20h-10z" fill="#e23b4a"/><path d="M40 34C18 48 8 68 6 88" fill="none" stroke="#12121a" stroke-width="5.5" stroke-linecap="round"/><path d="M56 34c22 14 32 34 34 54" fill="none" stroke="#12121a" stroke-width="5.5" stroke-linecap="round"/><path d="M40 34C18 48 8 68 6 88M56 34c22 14 32 34 34 54" fill="none" stroke="#f4f6fb" stroke-width="1.5" stroke-linecap="round"/></g><g class="tendril"><path d="M44 40c-8 12-4 24-14 30" fill="none" stroke="#d5dcf0" stroke-width="1.7" stroke-linecap="round"/><path d="M52 42c10 10 8 22 18 28" fill="none" stroke="#d5dcf0" stroke-width="1.7" stroke-linecap="round"/><path d="M48 46c2 14-6 22-2 32" fill="none" stroke="#d5dcf0" stroke-width="1.5" stroke-linecap="round"/></g></svg>`,
    "he-who-watches": `<svg viewBox="0 0 96 96" aria-hidden="true"><rect x="22" y="12" width="52" height="72" rx="2" fill="#16120e" stroke="#f3e6d8" stroke-width="2.4"/><path d="M48 16v64" stroke="#0c0908" stroke-width="6" stroke-linecap="round"/><g class="look"><ellipse cx="38" cy="44" rx="7" ry="5.5" fill="#f7fbff" stroke="${ink}" stroke-width="1.6"/><ellipse cx="58" cy="44" rx="7" ry="5.5" fill="#f7fbff" stroke="${ink}" stroke-width="1.6"/><circle cx="39" cy="44" r="2.4" fill="${ink}"/><circle cx="59" cy="44" r="2.4" fill="${ink}"/></g><g class="blink"><rect x="30" y="37" width="16" height="14" rx="6" fill="#16120e"/><rect x="50" y="37" width="16" height="14" rx="6" fill="#16120e"/></g><path d="M22 74c8-8 12-4 16 2M58 78c8-10 14-4 16 0" fill="#143024" stroke="#d7ecdf" stroke-width="2" stroke-linejoin="round"/></svg>`,
    "screening-lt17a": `<svg viewBox="0 0 96 96" aria-hidden="true"><rect x="14" y="22" width="68" height="52" rx="4" fill="#1a1c28" stroke="#f3e6d8" stroke-width="2.6"/><path d="M14 32h68M14 64h68" stroke="#f3e6d8" stroke-width="3"/><path d="M42 42l16 8-16 8z" fill="#f6e7b0"/></svg>`,
    "abandoned-asylum": `<svg viewBox="0 0 96 96" aria-hidden="true"><g class="tilt"><path d="M30 30 36 12l8 16 6-18 6 18 8-14 6 16" fill="#2a221c" stroke="${ink}" stroke-width="1.8" stroke-linejoin="round"/><circle cx="48" cy="34" r="14" fill="#f3e0d4" stroke="${ink}" stroke-width="2.4"/><ellipse cx="42" cy="34" rx="3.2" ry="4.4" fill="${ink}"/><ellipse cx="55" cy="34" rx="3.2" ry="4.4" fill="${ink}"/><path d="M44 42h8" stroke="${ink}" stroke-width="1.8" stroke-linecap="round"/></g><path d="M26 54h44l6 30H20z" fill="#f4f7f2" stroke="${ink}" stroke-width="2.4" stroke-linejoin="round"/><path d="M30 64c14 8 22 8 36 0" fill="none" stroke="${ink}" stroke-width="2.4" stroke-linecap="round"/><path d="M24 70c16 10 32 8 48-6" fill="none" stroke="#8a3038" stroke-width="3.4" stroke-linecap="round"/></svg>`,
    "forever-patients": `<svg viewBox="0 0 96 96" aria-hidden="true"><path d="M48 4v12" stroke="${ink}" stroke-width="2.2" stroke-linecap="round"/><g class="flicker"><path d="M34 16h28l-5 12H39z" fill="#f6e7b0" stroke="${ink}" stroke-width="2.2" stroke-linejoin="round"/></g><path d="M72 22v34" stroke="#d5dde4" stroke-width="2.6" stroke-linecap="round"/><rect x="64" y="12" width="16" height="14" rx="2" fill="#f4f7fb" stroke="${ink}" stroke-width="1.8"/><path d="M72 36c-10 8-8 16-2 22" fill="none" stroke="#d5dde4" stroke-width="1.8" stroke-linecap="round"/><path d="M12 62h72" stroke="#c5ced6" stroke-width="4" stroke-linecap="round"/><path d="M18 62v20M78 62v20M18 78h60" stroke="#9aa6b0" stroke-width="3" stroke-linecap="round"/><path d="M20 60c6-14 50-16 58 2v16H20z" fill="#f4efe6" stroke="${ink}" stroke-width="2.2" stroke-linejoin="round"/><path d="M28 54c12 8 20 2 28 10 4-8 2-6-2-12-8 6-16 2-26 2z" fill="#8a3038"/></svg>`,
    "living-dead": `<svg viewBox="0 0 96 96" aria-hidden="true"><g class="ghost"><path d="M24 40c0-16 48-18 48 2 6 2 10 14 4 22 4 10-4 18-14 18l-6-8-6 8-6-8-6 8c-10 0-16-8-14-18-8-2-10-12 0-16z" fill="#f4fff8" stroke="${ink}" stroke-width="2.4"/><circle cx="40" cy="42" r="2.2" fill="${ink}"/><circle cx="56" cy="42" r="2.2" fill="${ink}"/></g></svg>`,
    "screening-lt12c": `<svg viewBox="0 0 96 96" aria-hidden="true"><rect x="10" y="28" width="34" height="44" rx="3" fill="#1c1428" stroke="#f3e6d8" stroke-width="2.2"/><rect x="52" y="22" width="34" height="50" rx="3" fill="#241820" stroke="#f3e6d8" stroke-width="2.2"/><path d="M22 46l10 6-10 6zM64 42l10 6-10 6z" fill="#f6e7b0"/></svg>`,
  };
  return art[id] || "";
}

function posterImgs(meta, size) {
  return (meta?.posters || []).map((base) => (
    `<img class="house-card__logo house-card__logo--poster" src="${escapeHtml(base)}${size === "sm" ? "-sm" : ""}.webp" alt="" width="46" height="46" loading="lazy" decoding="async">`
  )).join("");
}

function houseMarkHtml(meta) {
  const svg = houseArt(meta?.id);
  if (!svg) return "";
  const tilt = ["-1.5deg", "1.2deg", "-1deg", "1.6deg"][(meta.id || "").length % 4];
  const delay = `${((meta.id || "").length % 7) * 0.35}s`;
  return `<span class="house-art"><span class="booth-mark" data-tilt="${tilt}" data-idle-delay="${delay}" aria-hidden="true">${svg}</span></span>`;
}

function attractionLabel(meta) {
  if (meta?.kind === "scarezone") return "Scare Zone";
  if (meta?.kind === "screening") return "Screening";
  return "Scare House";
}

function kindBadge(meta) {
  return `<span class="map-badge map-badge--kind">${escapeHtml(attractionLabel(meta))}</span>`;
}

const CARD_CHARMS = {
  "three-doors": ["skull"],
  marionette: ["hat"],
  clowns: ["pumpkins"],
  illusionist: ["curtain"],
  "no-one-leaves": ["spider"],
  prisoner: ["web"],
  "whispering-woods": ["candle", "crow"],
  "screening-lt17a": ["ears"],
  "screening-lt12c": ["ears"],
};

function cardCharm(id) {
  const kinds = CARD_CHARMS[id];
  if (!kinds) return "";
  const ink = "#1a1218";
  const svg = {
    curtain: `<svg viewBox="0 0 92 46"><g class="drip"><path d="M14 0c1.2 8 0 14 2.6 24 1 3.4-.4 7-3.4 7s-4.8-3-3.6-7.2C11.6 14 11 7 14 0z" fill="#8e2430" stroke="${ink}" stroke-width="1.6"/><path d="M34 0c2 10-.6 16 4 28 1.4 3.6-.6 8-4.6 8s-6.4-3.6-4.8-8.4C32 16 30 8 34 0z" fill="#c2454c" stroke="${ink}" stroke-width="1.6"/><path d="M56 0c1.4 7 .2 12 3 20 1 3-.4 6.2-3.2 6.2s-4.4-2.6-3.2-6.4C54.4 12 53.4 6 56 0z" fill="#9a2834" stroke="${ink}" stroke-width="1.6"/><path d="M74 1c1 6-.2 10 2.2 16 .8 2.2-.2 4.8-2.4 4.8s-3.4-2-2.6-4.8C72.6 10 72 5 74 1z" fill="#7a1c28" stroke="${ink}" stroke-width="1.6"/><path d="M16 8c.8 2 .2 3-.4 2.6M36 8c1.2 3 .2 5-.4 4.4" fill="none" stroke="#f3c2bc" stroke-width="1.3" stroke-linecap="round"/></g></svg>`,
    hat: `<svg viewBox="0 0 64 40"><g class="hat"><path d="M28 30C32 16 34 8 40 3c1.6-1.4 4-.6 4.2 2 .6 8-1 16 1.4 25" fill="#2a1c24" stroke="${ink}" stroke-width="1.7"/><path d="M4 30c5-3 12-4 20-2 8 1 14 0 22-2 8-1 14 1 16 4-2 5-12 8-24 7C22 38 8 36 4 30z" fill="#241820" stroke="${ink}" stroke-width="1.7"/><path d="M16 29c8 2 18 1 28-2" fill="none" stroke="#6a3038" stroke-width="2.6" stroke-linecap="round"/><path d="M34 25h6l-.6 4.5h-4.6z" fill="#e2b34a" stroke="${ink}" stroke-width="1.1" transform="rotate(-8 37 27)"/></g></svg>`,
    skull: `<svg viewBox="0 0 48 54"><path d="M24 3c-11 1-19 10-19 21 0 8 4 13 8 16v2h22v-2c4-3 8-8 8-16C43 13 35 2 24 3z" fill="#f4ead8" stroke="${ink}" stroke-width="1.8"/><ellipse cx="16.5" cy="23" rx="4.6" ry="5.6" fill="${ink}" transform="rotate(-8 16.5 23)"/><ellipse cx="31" cy="22" rx="4.4" ry="5.8" fill="${ink}" transform="rotate(6 31 22)"/><path d="M22 31h4.2l-.6 5h-3z" fill="${ink}"/><g class="jaw"><path d="M13 40h22v5.5c0 3.2-4.4 6-11 6s-11-2.8-11-6z" fill="#f4ead8" stroke="${ink}" stroke-width="1.8"/><path d="M18 44.5v3.2M23 44.2v4M28 44.5v3.2" stroke="${ink}" stroke-width="1.5" stroke-linecap="round"/></g></svg>`,
    pumpkins: `<svg viewBox="0 0 96 40"><g transform="translate(2 10)"><path d="M12 2c.6 1.4.4 2.2-.2 3" fill="none" stroke="#3d6a32" stroke-width="1.6" stroke-linecap="round"/><path d="M2 16c0-5 2.4-8 5-8 1.6 0 2.2 1.6 5 1.6s3.2-1.6 4.8-1.6c2.6 0 5 3 5 8 0 5.4-3.4 9-7.4 9H9.2C5.2 25 2 21.4 2 16z" fill="#d86a14" stroke="${ink}" stroke-width="1.5"/><path d="M8 20l2 1.4-2 1.4M16 20l-2 1.4 2 1.4" fill="${ink}"/></g><g transform="translate(28 0)"><path d="M20 4c1.2 2.4 1 4-.2 6" fill="none" stroke="#3d6a32" stroke-width="2" stroke-linecap="round"/><path d="M4 22c0-8 4-14 8-14 2.4 0 3.2 2.6 8 2.6s5.4-2.6 8-2.6c4 0 8 6 8 14 0 8-5 14-12 14h-8C9 36 4 30 4 22z" fill="#e07a18" stroke="${ink}" stroke-width="1.7"/><path d="M14 14c-.4 6-.2 12.4 1 20M26 14c.4 6 .2 12-1 20" fill="none" stroke="#a85210" stroke-width="1.4"/><path d="M14 22l3.2 2.4L14 27M26 22l-3.2 2.4L26 27" fill="${ink}"/><path d="M16 30c1.6 1.6 5 1.6 7 0" fill="none" stroke="${ink}" stroke-width="1.4" stroke-linecap="round"/></g><g transform="translate(72 12)"><path d="M10 1c.5 1.2.3 2-.2 2.6" fill="none" stroke="#3d6a32" stroke-width="1.5" stroke-linecap="round"/><path d="M1 14c0-4.4 2-7 4.4-7 1.4 0 2 1.4 4.4 1.4S14 7 15.2 7c2.2 0 4.4 2.6 4.4 7 0 4.6-3 8-6.4 8H7.2C3.8 22 1 18.6 1 14z" fill="#c45e12" stroke="${ink}" stroke-width="1.5"/><path d="M7 17l1.6 1.1L7 19.2M14 17l-1.6 1.1L14 19.2" fill="${ink}"/></g></svg>`,
    web: `<svg viewBox="0 0 64 64"><g fill="none" stroke="#f4efe6" stroke-linecap="round"><path d="M62 62V6M62 62H6" stroke-width="1.7"/><path d="M62 62 38 10M62 62 18 28M62 62 10 46" stroke-width="1.5"/><path d="M62 50a12 12 0 0 0-12 12" stroke-width="1.6"/><path d="M62 36a26 26 0 0 0-26 26" stroke-width="1.6"/><path d="M62 20a42 42 0 0 0-42 42" stroke-width="1.5"/><path d="M50 62a8 8 0 0 1 8-10M36 62c2-10 8-16 18-20" stroke-width="1.3"/></g><g class="spider"><ellipse cx="40" cy="44" rx="4.2" ry="3.3" fill="${ink}"/><circle cx="40" cy="39.4" r="2.2" fill="${ink}"/><path d="M36 41l-6-4M36 43.5l-7 0M36 46l-6 4M44 41l6-4M44 43.5l7 .2M44 46l6 4" fill="none" stroke="${ink}" stroke-width="1.3" stroke-linecap="round"/></g></svg>`,
    candle: `<svg viewBox="0 0 36 56"><g class="flame"><path d="M18 1c4 6 8 10 8 15 0 5-3.4 8.5-8 8.5S10 21 10 16C10 11 14 7 18 1z" fill="#ffe7a0" stroke="${ink}" stroke-width="1.5"/><path d="M18 10c1.6 2.4 2.8 4 2.8 6.2 0 2-1.2 3.4-2.8 3.4s-2.8-1.4-2.8-3.4c0-2.2 1.2-3.8 2.8-6.2z" fill="#e07a18"/></g><path d="M11 24h14l-2 28H13z" fill="#fff6e8" stroke="${ink}" stroke-width="1.8"/><path d="M13 30c2 4 1 7-1.2 9 3.2-.6 5.4 1.4 4.2 5" fill="#c2454c" stroke="${ink}" stroke-width="1.1"/><path d="M23 36c1.2 2.4.4 5-.2 7" fill="none" stroke="#c2454c" stroke-width="1.7" stroke-linecap="round"/></svg>`,
    ears: `<svg viewBox="0 0 96 44"><g class="ears"><path d="M4 42 26 3l20 39z" fill="#2a1c24" stroke="#f3e6d8" stroke-width="2.2" stroke-linejoin="round"/><path d="M16 42 26 16l10 26z" fill="#6a3040"/><path d="M50 42 76 6l20 36z" fill="#2a1c24" stroke="#f3e6d8" stroke-width="2.2" stroke-linejoin="round"/><path d="M64 42 76 18l10 24z" fill="#6a3040"/></g></svg>`,
    crow: `<svg viewBox="0 0 48 36"><g class="crow"><path d="M24 2v8" fill="none" stroke="#f3e6d8" stroke-width="1.4"/><path d="M8 22c2-8 10-12 16-10 4 1 8 6 14 4-2 6-6 8-10 8 2 4-2 8-8 7-8 1-14-2-16-8 2-1 3-1 4-1z" fill="#241820" stroke="#f3e6d8" stroke-width="1.7"/><circle cx="30" cy="18" r="1.6" fill="#f6e7b0"/><path d="M36 18l8 2-8 3z" fill="#e2b34a" stroke="#1a1218" stroke-width="1"/></g></svg>`,
    spider: `<svg viewBox="0 0 36 64"><path d="M18 0v18" fill="none" stroke="#f4efe6" stroke-width="1.4" stroke-linecap="round"/><g class="spider"><path d="M14 30c-9-2-12 5-8 9M22 30c9-2 12 5 8 9M13 38c-8 2-8 9-2 10M23 38c8 2 8 9 2 10M12 34c-7 0-9 4-6 7M24 34c7 0 9 4 6 7" fill="none" stroke="#f7f3ec" stroke-width="1.6" stroke-linecap="round"/><ellipse cx="18" cy="38" rx="6.2" ry="7" fill="#f7f3ec" stroke="#2a211c" stroke-width="1.15"/><circle cx="18" cy="29.2" r="4" fill="#f7f3ec" stroke="#2a211c" stroke-width="1.15"/><circle cx="16.3" cy="28.4" r="0.85" fill="#2a211c"/><circle cx="19.7" cy="28.4" r="0.85" fill="#2a211c"/><path d="M16.2 31.2c.7.9 2.8.9 3.6 0" fill="none" stroke="#2a211c" stroke-width="0.8" stroke-linecap="round"/></g></svg>`,
  };
  return kinds.map((kind) => (
    `<span class="card-charm card-charm--${kind}" aria-hidden="true">${svg[kind]}</span>`
  )).join("");
}

function houseCardOpenInner(row, meta) {
  const tags = tagChips(meta);
  const status = rowStatus(row);
  return `
    <span class="house-card__rail" aria-hidden="true"></span>
    ${kindBadge(meta)}
    <span class="house-card__top">
      <span class="house-card__short">${escapeHtml(meta?.short || "")}</span>
    </span>
    ${meta?.posters?.length
      ? `<span class="house-card__title house-card__title--logos"><span class="house-card__logos" aria-hidden="true">${posterImgs(meta, "sm")}</span><strong class="house-card__name">${escapeHtml(row.name)}</strong></span>`
      : `<strong class="house-card__name">${escapeHtml(row.name)}</strong>`}
    <span class="house-card__metric">
      <span class="status-pill">${escapeHtml(waitLabel(row.wait_minutes, status))}${hasPublishedWait(row) && status !== "closed" ? `<span class="status-pill__band"> · ${escapeHtml(statusName(status))}</span>` : ""}</span>
    </span>
    <span class="house-card__meta">
      ${meta?.rooms ? `<span class="fresh">${escapeHtml(roomLabel(meta.rooms))}</span>` : ""}
      ${meta?.metaNote ? `<span class="fresh">${escapeHtml(meta.metaNote)}</span>` : ""}
      <span class="fresh">${escapeHtml(freshnessLabel(row.updated_at))}</span>
      ${tags ? `<span class="house-tags">${tags}</span>` : ""}
    </span>
    ${houseMarkHtml(meta)}`;
}

function staffScope() {
  return getAdminSession()?.payload?.staffScope || "admin";
}

function staffBoothId() {
  const match = /^booth:([0-9]+)$/.exec(staffScope());
  return match ? match[1] : "";
}

function staffHouseId() {
  const match = /^house:([a-z0-9-]+)$/.exec(staffScope());
  return match ? match[1] : "";
}

function staffSeesTab(scope, need) {
  if (scope === "admin") return true;
  if (need === "waits") return scope === "waits" || /^house:[a-z0-9-]+$/.test(scope);
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
    const night = JSON.parse(raw || "null") || { houses: [], watch: [] };
    // Watching a retired house means watching the card it was folded into.
    if (Array.isArray(night.watch)) night.watch = [...new Set(night.watch.map((id) => RETIRED_HOUSES[id] || id))];
    return night;
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
  const routable = ["house", "booths", "booth", "pin", "cluster"].includes(name);
  if (!routable && !document.querySelector(`.view[data-view="${CSS.escape(name)}"]`)) {
    name = "map";
    hashName = "map";
    navName = "map";
    writeHash("#map", "replace");
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
    if (!announceLoaded || announceDirty) loadPublicAnnouncements();
    requestAnimationFrame(() => fitMap());
  }
  if (name === "feedback") fillFeedbackTargets();
  if (name === "stamps") {
    paintStampUi();
    stampWatch.start();
    requestAnimationFrame(layoutStampPage);
  }
  if (name === "help") {
    paintSafety();
    paintGuideHouses();
  }
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

function paintWatchedHouse(id) {
  renderDashboard();
  renderPins();
  if (openHouseId === id && els.modal && !els.modal.hidden) openHouse(id);
  if (openClusterKey && els.clusterModal && !els.clusterModal.hidden) paintClusterModal(openClusterKey);
}

const watchInFlight = new Set();

function setWatchButtonsBusy(id, busy) {
  document.querySelectorAll(`[data-watch-house="${CSS.escape(id)}"], #modalWatch[data-house-id="${CSS.escape(id)}"]`).forEach((btn) => {
    btn.disabled = busy;
    btn.classList.toggle("is-busy", busy);
    if (busy) btn.setAttribute("aria-busy", "true");
    else btn.removeAttribute("aria-busy");
  });
}

function toggleWatchHouse(id) {
  if (!id || watchInFlight.has(id)) return;
  const night = readNight();
  const watching = night.watch.includes(id);
  if (watching) {
    night.watch = night.watch.filter((hid) => hid !== id);
    writeNight(night);
    paintWatchedHouse(id);
    syncPushWatch(pushWatchList(night.watch));
    showWaitToast("Alert off", "This house will stop pinging you. It's a little hurt, but it'll cope.", false);
    return;
  }
  if (!getStudentSession()) {
    showWaitToast("Sign in first", describePushBlock("signin"), false);
    return;
  }
  const nextWatch = pushWatchList([...night.watch, id]);
  watchInFlight.add(id);
  setWatchButtonsBusy(id, true);
  enablePushNotifications(nextWatch).then((result) => {
    paintPushHint();
    if (!result?.ok) {
      const blocked = result?.reason === "denied" || result?.reason === "ios-install";
      showWaitToast(
        blocked ? "Notifications blocked" : "Alert not on",
        describePushBlock(result?.reason),
        false
      );
      return;
    }
    const latest = readNight();
    if (!latest.watch.includes(id)) latest.watch = [...latest.watch, id];
    writeNight(latest);
    paintWatchedHouse(id);
    const when = alertChoiceLabel();
    showWaitToast("Alerts on", when ? `We'll ping this device at ${when}.` : "Pick at least one wait on the sign-in page.", false);
  }).catch(() => {
    paintPushHint();
    showWaitToast("Alert not on", describePushBlock("save-failed"), false);
  }).finally(() => {
    watchInFlight.delete(id);
    setWatchButtonsBusy(id, false);
    paintWatchedHouse(id);
  });
}

/** On load, drop "Watching" marks this browser can no longer deliver (permission revoked, subscription gone). */
async function reconcileWatchState() {
  const night = readNight();
  if (!night.watch.length) return;
  if (await pushIsLive()) return;
  const stale = night.watch.slice();
  night.watch = [];
  writeNight(night);
  stale.forEach((id) => paintWatchedHouse(id));
}

function houseCardHtml(row, watching) {
  const meta = houseMeta(row.id);
  const on = watching.has(row.id);
  const status = rowStatus(row);
  return `<article class="house-card status-${status}" data-cluster="${escapeHtml(meta?.cluster || "")}">
    ${cardCharm(row.id)}
    <div class="house-card__face">
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
    </div>
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
  bree: "1.4deg",
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
  bree: "0.85s",
};

function boothArt(theme) {
  const hi = "#fff6ea";
  const art = {
    ink: `<svg viewBox="0 0 96 96" aria-hidden="true"><path d="M8 8h68a4 4 0 0 1 4 4v44L56 88H12a4 4 0 0 1-4-4V12a4 4 0 0 1 4-4z" fill="#1a1022" transform="translate(1.5 1.5)"/><path d="M8 8h68a4 4 0 0 1 4 4v44L56 88H12a4 4 0 0 1-4-4V12a4 4 0 0 1 4-4z" fill="#f7f1e4" stroke="#1a1022" stroke-width="2.6" stroke-linejoin="round"/><g fill="#3cbf6a" stroke="#1a1022" stroke-width="1.6" stroke-linejoin="round"><path d="M24 26c-8-6-14 1-7 5 2.4-1.6 4.6-1.6 7 0z"/><path d="M24 26c8-6 14 1 7 5-2.4-1.6-4.6-1.6-7 0z"/><circle cx="24" cy="26.6" r="2.3"/></g><circle cx="62" cy="30" r="10" fill="#ff8a2e" stroke="#1a1022" stroke-width="1.8"/><path d="M62 20v-5" stroke="#3cbf6a" stroke-width="2.4" stroke-linecap="round"/><path d="M57 28h3.2l-1.6 2.4zM67 28h-3.2l1.6 2.4z" fill="#1a1022"/><path d="M57 35c2 3 8 3 10 0" fill="none" stroke="#1a1022" stroke-width="1.6" stroke-linecap="round"/><path d="M22 46c2-8 16-10 18-2v12l-3.2-3-2.8 3-3-3-3 3-3-3-3 3z" fill="#fff" stroke="#6a3cae" stroke-width="1.7" stroke-linejoin="round"/><circle cx="28" cy="50" r="1.5" fill="#1a1022"/><circle cx="34" cy="50" r="1.5" fill="#1a1022"/><circle cx="52" cy="54" r="8" fill="#fff" stroke="#6a3cae" stroke-width="1.7"/><circle cx="49" cy="53" r="1.5" fill="#1a1022"/><circle cx="55" cy="53" r="1.5" fill="#1a1022"/><path d="M52 56.5v2.2M49 62h6" stroke="#1a1022" stroke-width="1.4" stroke-linecap="round"/><g fill="none" stroke="#7a4fd0" stroke-width="1.5" stroke-linecap="round"><circle cx="28" cy="72" r="8"/><circle cx="28" cy="72" r="4"/><path d="M28 64v16M20 72h16M22.4 66.4l11.2 11.2M33.6 66.4 22.4 77.6"/></g><g class="peel"><path d="M56 62c16 1 24 12 20 22-10-1-16-9-20-22z" fill="#fffaf3" stroke="#1a1022" stroke-width="2.2" stroke-linejoin="round"/></g></svg>`,
    hat: `<svg viewBox="0 0 96 96" aria-hidden="true"><path class="hoop" d="M18 44a22 8 0 0 0 44 0" fill="none" stroke="#ff8a2e" stroke-width="6" stroke-linecap="round"/><path d="M36 4 30 22 18 66h44L52 22 42 4z" fill="#2a1848" stroke="#100814" stroke-width="2.6" stroke-linejoin="round"/><path d="M34 14 26 58" fill="none" stroke="#e4d8ff" stroke-width="2.6" stroke-linecap="round"/><path d="M26 54h28l-1 3.2H27z" fill="#d4c4ff"/><ellipse cx="40" cy="68" rx="34" ry="7" fill="#140e24" stroke="#100814" stroke-width="2.4"/><path d="M10 66c10-4 20-6 30-6s20 2 30 6" fill="none" stroke="#d8ccf8" stroke-width="2" stroke-linecap="round"/><path class="hoop" d="M18 44a22 8 0 0 1 44 0" fill="none" stroke="#ff8a2e" stroke-width="6" stroke-linecap="round"/><path d="M70 8c6 2 12 6 14 12" fill="none" stroke="#ffb15a" stroke-width="2.4" stroke-linecap="round" stroke-dasharray="3 3.4"/><g transform="rotate(-22 78 18)"><g class="arc"><ellipse cx="78" cy="18" rx="22" ry="8" fill="none" stroke="#ff8a2e" stroke-width="6"/></g></g><g class="bat"><path d="M12 18c-6-5-11 1-5 4 2-1.2 3.4-1.2 5 0z" fill="#f4f0ff" stroke="#100814" stroke-width="1.3" stroke-linejoin="round"/><path d="M12 18c6-5 11 1 5 4-2-1.2-3.4-1.2-5 0z" fill="#f4f0ff" stroke="#100814" stroke-width="1.3" stroke-linejoin="round"/><circle cx="12" cy="18.6" r="1.5" fill="#f4f0ff" stroke="#100814" stroke-width="1"/></g></svg>`,
    eye: posterArt("#d4f3c6", "#14301c", `
      <path d="M22 52h52l-8 30H30z"/>
    `, `<g class="bob"><circle cx="28" cy="22" r="12" fill="${hi}" stroke="#14301c" stroke-width="2.4"/><circle cx="28" cy="23" r="5" fill="#e23b3b"/><circle cx="28" cy="23" r="2" fill="#1a100c"/><circle cx="52" cy="34" r="10" fill="${hi}" stroke="#14301c" stroke-width="2.4"/><circle cx="52" cy="35" r="4" fill="#e23b3b"/><circle cx="52" cy="35" r="1.6" fill="#1a100c"/></g><ellipse cx="48" cy="52" rx="16" ry="4" fill="${hi}"/>`),
    skel: `<svg viewBox="0 0 96 96" aria-hidden="true"><g fill="#141a28" transform="translate(1.6 1.8)"><circle cx="24" cy="16" r="10"/><rect x="16" y="28" width="16" height="16" rx="4"/><rect x="8" y="32" width="10" height="4" rx="2"/><rect x="30" y="30" width="12" height="4" rx="2" transform="rotate(-24 30 32)"/><rect x="16" y="46" width="16" height="6" rx="2"/><rect x="16" y="54" width="5" height="20" rx="2"/><rect x="27" y="54" width="5" height="20" rx="2"/><rect x="55" y="11" width="32" height="6" rx="2"/><rect x="55" y="53" width="32" height="6" rx="2"/><rect x="57" y="16" width="4" height="38"/><rect x="81" y="16" width="4" height="38"/></g><circle cx="24" cy="16" r="10" fill="#f7f4ec" stroke="#141a28" stroke-width="2.4"/><circle cx="20" cy="15" r="1.7" fill="#141a28"/><circle cx="28" cy="15" r="1.7" fill="#141a28"/><g class="jaw"><path d="M17 20h14c0 4-3 7-7 7s-7-3-7-7z" fill="#f7f4ec" stroke="#141a28" stroke-width="2"/></g><rect x="16" y="28" width="16" height="16" rx="4" fill="#f7f4ec" stroke="#141a28" stroke-width="2.2"/><path d="M18 33h12M18 37h12M18 41h12" stroke="#141a28" stroke-width="1.6" stroke-linecap="round"/><rect x="8" y="32" width="10" height="4" rx="2" fill="#f7f4ec" stroke="#141a28" stroke-width="2"/><g class="arm"><rect x="30" y="28" width="14" height="4.5" rx="2" transform="rotate(-28 32 30)" fill="#f7f4ec" stroke="#141a28" stroke-width="2"/></g><rect x="16" y="46" width="16" height="6" rx="2" fill="#f7f4ec" stroke="#141a28" stroke-width="2"/><rect x="16" y="54" width="5" height="22" rx="2.5" fill="#f7f4ec" stroke="#141a28" stroke-width="2"/><rect x="27" y="54" width="5" height="22" rx="2.5" fill="#f7f4ec" stroke="#141a28" stroke-width="2"/><defs><clipPath id="skelGlass"><path d="M62 17h18c0 9-6 12-7.5 17 1.5 5 7.5 8 7.5 17H62c0-9 6-12 7.5-17-1.5-5-7.5-8-7.5-17z"/></clipPath></defs><path d="M62 17h18c0 9-6 12-7.5 17 1.5 5 7.5 8 7.5 17H62c0-9 6-12 7.5-17-1.5-5-7.5-8-7.5-17z" fill="#e9f0fa"/><g clip-path="url(#skelGlass)"><path d="M64 23h14c-1.5 4-4.5 7-7 10-2.5-3-5.5-6-7-10z" fill="#e8b34a"/><g class="sand"><rect x="70.3" y="32" width="1.4" height="9" rx="0.7" fill="#f6d56a"/></g><path d="M62 51c2.5-6 6-8.5 9-8.5s6.5 2.5 9 8.5z" fill="#f0c14a"/></g><path d="M62 17h18c0 9-6 12-7.5 17 1.5 5 7.5 8 7.5 17H62c0-9 6-12 7.5-17-1.5-5-7.5-8-7.5-17z" fill="none" stroke="#141a28" stroke-width="2.2" stroke-linejoin="round"/><g fill="#c98a4a" stroke="#141a28" stroke-width="2" stroke-linejoin="round"><rect x="58" y="16" width="3" height="36" rx="1"/><rect x="81" y="16" width="3" height="36" rx="1"/><rect x="55" y="11" width="32" height="6" rx="2"/><rect x="55" y="51" width="32" height="6" rx="2"/></g></svg>`,
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
    bree: `<svg viewBox="0 0 96 96" aria-hidden="true"><g fill="#2a140c" transform="translate(2 2)"><path d="M18 56c0-20 14-28 30-28s30 8 30 28z"/><path d="M24 54h48l-6 32H30z"/></g><path d="M24 54h48l-6 32H30z" fill="#ff8a2e" stroke="#2a140c" stroke-width="2.6" stroke-linejoin="round"/><path d="M36 56l2 28M48 56v28M60 56l-2 28" stroke="#2a140c" stroke-width="2" stroke-linecap="round"/><path d="M18 56c0-20 14-28 30-28s30 8 30 28c-4 3-8-2-12 1s-8-2-12 1-8-2-12 1-8-2-12 1-8-1-12-1z" fill="#e0a052" stroke="#2a140c" stroke-width="2.6" stroke-linejoin="round"/><g fill="#3a1c10"><circle cx="30" cy="46" r="2.4"/><circle cx="62" cy="44" r="2.4"/><circle cx="40" cy="52" r="2"/><circle cx="58" cy="53" r="2"/><circle cx="70" cy="51" r="1.8"/></g><g class="ghost"><path d="M38 34c0-12 20-12 20 0v8l-3.3-2.4-3.3 2.4-3.4-2.4-3.3 2.4-3.4-2.4-3.3 2.4z" fill="#fff6ea" stroke="#2a140c" stroke-width="2" stroke-linejoin="round"/><circle cx="44.5" cy="31" r="1.6" fill="#2a140c"/><circle cx="51.5" cy="31" r="1.6" fill="#2a140c"/><ellipse cx="48" cy="36" rx="1.6" ry="2" fill="#2a140c"/></g><g class="bub"><circle cx="24" cy="24" r="2.6" fill="#fff6ea" stroke="#2a140c" stroke-width="1.3"/><circle cx="74" cy="18" r="2.1" fill="#fff6ea" stroke="#2a140c" stroke-width="1.2"/><circle cx="68" cy="28" r="1.5" fill="#fff6ea" stroke="#2a140c" stroke-width="1.1"/></g></svg>`,
  };
  return art[theme] || "";
}

function boothDirectoryCard(booth) {
  const food = Boolean(booth.food);
  const ticket = !food && booth.stamp !== false;
  const stamped = ticket && boothIsStamped(booth.id);
  const theme = boothTheme(booth);
  const logo = food && booth.logo
    ? `<img class="house-card__logo" src="${escapeHtml(booth.logo)}" alt=""${logoDims(booth.logo)}>`
    : "";
  const pill = food ? "Food" : "Booth";
  const art = boothArt(theme);
  const tilt = BOOTH_TILT[theme] || "0deg";
  return `<article class="house-card${food ? " house-card--food" : " house-card--zone"}${ticket ? " is-ticket" : ""}${stamped ? " is-stamped" : ""}" data-theme="${escapeHtml(theme)}">
    <span class="house-card__rail" aria-hidden="true"></span>
    <button class="house-card__open" type="button" data-open-booth="${escapeHtml(booth.id)}">
      <span class="house-card__top">
        <span class="house-card__title">${logo}<strong class="house-card__name">${escapeHtml(booth.name).replace(/-/g, "\u2011")}</strong></span>
        <span class="house-card__marks">${ticket ? `<span class="map-badge map-badge--wheel">Wheel</span>` : ""}${stamped ? `<span class="map-badge map-badge--done">✓ Done</span>` : ""}<span class="status-pill">${pill}</span></span>
      </span>
      <span class="house-card__meta"><span class="fresh">${escapeHtml(booth.summary || (food ? "Menu still to come." : "Booth"))}</span></span>
      <span class="booth-art">${art ? `<span class="booth-mark" data-tilt="${escapeHtml(tilt)}" data-idle-delay="${escapeHtml(BOOTH_IDLE_DELAY[theme] || "0s")}" aria-hidden="true">${art}</span>` : ""}</span>
      ${ticket ? `<span class="visually-hidden">Needed for your prize.</span>` : ""}
      ${stamped ? `<span class="visually-hidden">Done</span>` : ""}
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
  const nodes = document.querySelectorAll("#boothDirectory .booth-mark:not(.is-peek), #boothsPinList .booth-mark:not(.is-peek), #houseGrid .booth-mark:not(.is-peek)");
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
  const html = boothsInDirectoryOrder().map(boothDirectoryCard).join("");
  if (booths && booths.screamHtml !== html) {
    booths.screamHtml = html;
    booths.innerHTML = html;
  }
  watchBoothMotion();
}

function renderDashboard() {
  paintHouseFilters();
  paintBoothDirectory();
  if (!els.houseGrid) return;
  const watching = new Set(readNight().watch);
  const groups = CLUSTERS.map((cluster) => ({
    cluster,
    members: clusterMembers(cluster.id).filter(listingMatches).sort(compareClusterMembers),
  })).filter((group) => group.members.length);
  if (!groups.length) {
    els.houseGrid.screamHtml = "";
    els.houseGrid.innerHTML = `<div class="empty-state house-filters__empty"><p class="empty-state__title">No houses match</p><p class="empty-state__hint">These filters scared everything off.</p><button class="btn" type="button" data-clear-filters>Clear filters</button></div>`;
    paintMapJump([]);
    return;
  }
  const clusterBlock = groups.map(({ cluster, members }) => {
    const cards = members.map((meta) => {
      if (meta.kind === "screening") return screeningCardHtml(meta);
      if (meta.kind === "scarezone") return scareZoneCardHtml(meta);
      const row = houses.find((h) => h.id === meta.id);
      return row ? houseCardHtml(row, watching) : "";
    }).join("");
    return `<section class="cluster-group" id="cluster-${escapeHtml(cluster.id)}">
      <header class="cluster-group__head">
        <p class="cluster-group__kicker">${escapeHtml(cluster.kicker)} · ${escapeHtml([...new Set(members.map((m) => m.short).filter(Boolean))].join(" · "))}</p>
        <h3>${escapeHtml(cluster.name)}</h3>
      </header>
      <div class="cluster-group__grid">${cards}</div>
    </section>`;
  }).join("");
  // Polls repaint every few seconds; identical markup is skipped so focus, hover and smooth scrolls survive.
  if (els.houseGrid.screamHtml !== clusterBlock) {
    els.houseGrid.screamHtml = clusterBlock;
    els.houseGrid.innerHTML = clusterBlock;
  }
  paintMapJump(groups.map(({ cluster }) => cluster.id));
  watchBoothMotion();
  syncCardsSky();
}

function compareClusterMembers(a, b) {
  const walkA = !isWalkthrough(a);
  const walkB = !isWalkthrough(b);
  if (walkA !== walkB) return walkA ? -1 : 1;
  return 0; // keep the listed order in js/houses.js
  const rowA = houses.find((house) => house.id === a.id);
  const rowB = houses.find((house) => house.id === b.id);
  const wa = rowA && hasPublishedWait(rowA) ? Number(rowA.wait_minutes) : Number.POSITIVE_INFINITY;
  const wb = rowB && hasPublishedWait(rowB) ? Number(rowB.wait_minutes) : Number.POSITIVE_INFINITY;
  return wa - wb || a.name.localeCompare(b.name);
}

function placeCardHtml(meta, pill, label) {
  return `<article class="house-card${meta.kind === "scarezone" ? " house-card--zone" : ""}" data-cluster="${escapeHtml(meta.cluster || "")}">
    ${cardCharm(meta.id)}
    <div class="house-card__face">
    <button class="house-card__open" type="button" data-open-house="${escapeHtml(meta.id)}">
      <span class="house-card__rail" aria-hidden="true"></span>
      ${kindBadge(meta)}
      <span class="house-card__top">
        <span class="house-card__short">${escapeHtml(meta?.short || "")}</span>
      </span>
      ${meta.posters?.length
        ? `<span class="house-card__title house-card__title--logos"><span class="house-card__logos" aria-hidden="true">${posterImgs(meta, "sm")}</span><strong class="house-card__name">${escapeHtml(meta.name)}</strong></span>`
        : `<strong class="house-card__name">${escapeHtml(meta.name)}</strong>`}
      <span class="house-card__metric">
        <span class="house-card__wait is-venue">${escapeHtml(roomLabel(meta.rooms))}</span>
      </span>
      <span class="house-card__meta">
        <span class="fresh">${escapeHtml(label)}</span>
        ${meta?.metaNote ? `<span class="fresh">${escapeHtml(meta.metaNote)}</span>` : ""}
      </span>
      ${houseMarkHtml(meta)}
    </button>
    </div>
  </article>`;
}

let mapJumpObserver = null;
let jumpLockId = "";
let jumpLockTimer = 0;
let jumpRest = null;

/** Where the window should sit so a section lands just under the sticky chip bar. */
function jumpTargetTop(id) {
  const target = document.getElementById(id);
  if (!target) return window.scrollY;
  const margin = parseFloat(getComputedStyle(target).scrollMarginTop) || 0;
  const max = document.documentElement.scrollHeight - window.innerHeight;
  return Math.max(0, Math.min(max, window.scrollY + target.getBoundingClientRect().top - margin));
}

function releaseJumpLock(event) {
  if (event && event.target !== document && event.target !== window) return;
  window.clearTimeout(jumpLockTimer);
  window.removeEventListener("scrollend", releaseJumpLock);
  if (jumpLockId) {
    // Snap the last few pixels if a repaint interrupted the glide.
    const top = jumpTargetTop(jumpLockId);
    if (Math.abs(top - window.scrollY) > 8) window.scrollTo({ top, behavior: "auto" });
    jumpRest = { id: jumpLockId, y: window.scrollY };
  }
  jumpLockId = "";
  syncMapJump();
}

/** Sticky chip bar bottom edge, so sections land just under it instead of behind it. */
function measureJumpClear() {
  const bar = document.getElementById("mapJump");
  if (!bar || !bar.offsetParent) return;
  const top = parseFloat(getComputedStyle(bar).top) || 0;
  const clear = Math.round(top + bar.getBoundingClientRect().height);
  document.documentElement.style.setProperty("--jump-clear", `${clear}px`);
}

function syncJumpHint() {
  const track = document.getElementById("mapJumpTrack");
  const bar = document.getElementById("mapJump");
  if (!track || !bar) return;
  const more = track.scrollWidth - track.clientWidth - track.scrollLeft > 6;
  bar.classList.toggle("has-more", more);
  bar.classList.toggle("has-less", track.scrollLeft > 6);
}

function jumpSections() {
  const track = document.getElementById("mapJumpTrack");
  if (!track) return [];
  return [...track.querySelectorAll("[data-jump]")].map((btn) => document.getElementById(btn.dataset.jump)).filter(Boolean);
}

function sectionUnderJumpBar(sections) {
  const list = sections || jumpSections();
  if (!list.length) return null;
  const bar = document.getElementById("mapJump");
  const line = (bar ? bar.getBoundingClientRect().bottom : 64) + 24;
  let current = list[0];
  list.forEach((section) => {
    if (section.getBoundingClientRect().top <= line) current = section;
  });
  const atBottom = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4;
  if (atBottom) {
    const last = list[list.length - 1];
    if (last.getBoundingClientRect().top < window.innerHeight) current = last;
  }
  return current;
}

function markJumpChip(id, { scrollTrack = true } = {}) {
  const track = document.getElementById("mapJumpTrack");
  if (!track || !id) return;
  track.querySelectorAll("[data-jump]").forEach((btn) => {
    const on = btn.dataset.jump === id;
    btn.classList.toggle("is-on", on);
    if (!on) {
      btn.removeAttribute("aria-current");
      return;
    }
    btn.setAttribute("aria-current", "true");
    // A second smooth scroll on another scroller cancels the page's in-flight one in Chrome.
    if (!scrollTrack || jumpLockId) return;
    const edge = 28;
    const left = btn.offsetLeft;
    const right = left + btn.offsetWidth;
    const viewLeft = track.scrollLeft;
    const viewRight = viewLeft + track.clientWidth;
    // Instant on purpose: a smooth strip scroll leaves Chrome ignoring the next smooth page jump.
    if (left < viewLeft + edge) {
      track.scrollLeft = Math.max(0, left - edge);
    } else if (right > viewRight - edge) {
      track.scrollLeft = right - track.clientWidth + edge;
    }
  });
}

function syncMapJump() {
  if (jumpLockId) return;
  const map = document.querySelector('.view[data-view="map"]');
  if (!map || map.hidden || !map.classList.contains("is-active")) return;
  // A tapped chip stays lit until the reader actually scrolls away (short last sections can't reach the bar).
  if (jumpRest) {
    if (Math.abs(window.scrollY - jumpRest.y) < 48) {
      markJumpChip(jumpRest.id);
      return;
    }
    jumpRest = null;
  }
  const current = sectionUnderJumpBar();
  if (current) markJumpChip(current.id);
}

function paintMapJump(visibleIds) {
  const track = document.getElementById("mapJumpTrack");
  if (!track) return;
  const chips = CLUSTERS.filter((cluster) => visibleIds.includes(cluster.id)).map((cluster) => (
    `<button type="button" class="map-jump__chip" data-jump="cluster-${escapeHtml(cluster.id)}">${escapeHtml(cluster.name)}</button>`
  ));
  chips.push(`<button type="button" class="map-jump__chip" data-jump="map-booths">Booths</button>`);
  const html = chips.join("");
  // Wait-time polls repaint the house list; rebuilding identical chips would drop the lit chip and the strip's scroll.
  if (track.dataset.sig !== html) {
    track.dataset.sig = html;
    track.innerHTML = html;
  }
  if (!track.dataset.hintBound) {
    track.dataset.hintBound = "1";
    track.addEventListener("scroll", syncJumpHint, { passive: true });
    window.addEventListener("resize", () => {
      measureJumpClear();
      syncJumpHint();
    });
  }
  requestAnimationFrame(() => {
    measureJumpClear();
    syncJumpHint();
  });
  if (mapJumpObserver) mapJumpObserver.disconnect();
  const sections = jumpSections();
  if (!sections.length || !("IntersectionObserver" in window)) return;
  const bar = document.getElementById("mapJump");
  const topInset = Math.max(48, Math.round(bar?.getBoundingClientRect().height || 64));
  mapJumpObserver = new IntersectionObserver(() => {
    syncMapJump();
  }, { rootMargin: `-${topInset}px 0px -45% 0px`, threshold: [0, 0.01, 0.2, 0.6, 1] });
  sections.forEach((section) => mapJumpObserver.observe(section));
  if (jumpLockId) markJumpChip(jumpLockId, { scrollTrack: false });
  else syncMapJump();
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

function paintGuideHouses() {
  document.querySelectorAll("[data-guide-house]").forEach((card) => {
    const meta = HOUSES.find((house) => house.id === card.dataset.guideHouse);
    if (!meta) return;
    const short = card.querySelector(".house-card__short");
    const name = card.querySelector(".house-card__name");
    if (short) short.textContent = meta.short || "";
    if (name) name.textContent = meta.name;
  });
}

function paintClubs() {
  const links = CLUBS.map((club) =>
    `<a href="${escapeHtml(club.instagram)}" target="_blank" rel="noopener noreferrer"><img src="${escapeHtml(encodeURI(club.logo))}" alt="${escapeHtml(club.name)}"${logoDims(club.logo)}></a>`
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
      ? `<img class="site-sponsors__logo" src="${escapeHtml(sponsor.logo)}" alt=""${logoDims(sponsor.logo, [160, 72])} loading="lazy" decoding="async">`
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
        return `<article class="board-card"><h3>${title}</h3><ol>${rows || "<li class='empty-state'><p class='empty-state__title'>No scores yet</p><p class='empty-state__hint'>The board is empty. Haunt it first.</p></li>"}</ol></article>`;
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
    const status = lead ? rowStatus(lead) : onlyZone ? "zone" : "open";
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
      <button class="map-pin__hit" type="button" data-open-booths aria-label="Booths, Eleven Square${boothStampNote}">
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
    ? `<img class="booths-list__logo" data-brand="${escapeHtml(booth.theme || "")}" src="${escapeHtml(booth.logo)}" alt=""${logoDims(booth.logo)}>`
    : markImg(booth.icon, "mark mark--booth");
  const label = booth.food ? escapeHtml(booth.short) : "";
  return `<button type="button" class="booths-list__btn${stamped ? " is-stamped" : ""}" data-open-booth="${escapeHtml(booth.id)}">
      <span>${mark}${label ? ` ${label}` : ""}</span>
      <strong>${escapeHtml(booth.name)}</strong>
      ${stamped ? `<span class="map-badge map-badge--done">✓ Done</span>` : ""}
      ${stamped ? `<span class="visually-hidden">Done</span>` : ""}
    </button>`;
}

function paintBoothsPinList() {
  const list = document.getElementById("boothsPinList");
  if (!list) return;
  // Same two-column cards (with the short description) as the map's booth section.
  const html = `<div class="cluster-group__grid">${boothsInDirectoryOrder().map(boothDirectoryCard).join("")}</div>`;
  if (list.screamHtml === html) return;
  list.screamHtml = html;
  list.innerHTML = html;
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
// Detail opened from a list sheet (booths pin, house cluster/pin): how to get back to that list.
let sheetBack = null;

function listScrollOf(modal) {
  return modal?.querySelector(".modal__body")?.scrollTop || 0;
}

function syncSheetBack(modal) {
  document.querySelectorAll("[data-sheet-back]").forEach((btn) => {
    btn.hidden = !(sheetBack && btn.closest(".modal") === modal);
  });
}

function restoreListScroll(list) {
  if (!sheetBack || sheetBack.list !== list) return;
  const modal = list === "booths" ? els.boothsModal : els.clusterModal;
  const y = sheetBack.scroll;
  sheetBack = null;
  const body = modal?.querySelector(".modal__body");
  if (!body) return;
  // The sheet animates open, so set it again once its height has settled.
  const apply = () => { body.scrollTop = y; };
  apply();
  requestAnimationFrame(apply);
  [180, 420].forEach((ms) => window.setTimeout(() => {
    if (!modal.hidden && Math.abs(body.scrollTop - y) > 2) apply();
  }, ms));
}

function goBackToList() {
  const back = sheetBack;
  if (!back) return;
  // Detail was pushed on top of the list in history: step back so the phone back gesture stays in sync.
  if (modalHash && location.hash === modalHash && modalReturnHash === back.hash) {
    history.back();
    return;
  }
  if (back.list === "booths") openBooths();
  else if (back.key.startsWith("pin:")) openPin(back.key.slice(4));
  else openCluster(back.key.slice(8));
}

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

let scrollLock = null;

/** Freeze the page under a sheet without the jump that overflow:hidden causes on mobile. */
function lockPageScroll() {
  if (scrollLock) return;
  const body = document.body;
  const y = window.scrollY;
  const gap = window.innerWidth - document.documentElement.clientWidth;
  const keep = ["position", "top", "left", "right", "width", "paddingRight"];
  scrollLock = { y, prev: Object.fromEntries(keep.map((k) => [k, body.style[k]])) };
  body.style.position = "fixed";
  body.style.top = `-${y}px`;
  body.style.left = "0";
  body.style.right = "0";
  body.style.width = "100%";
  if (gap > 0) body.style.paddingRight = `${gap}px`;
  document.documentElement.classList.add("is-scroll-locked");
}

function unlockPageScroll() {
  if (!scrollLock) return;
  const { y, prev } = scrollLock;
  scrollLock = null;
  Object.assign(document.body.style, prev);
  document.documentElement.classList.remove("is-scroll-locked");
  const html = document.documentElement;
  const behavior = html.style.scrollBehavior;
  html.style.scrollBehavior = "auto";
  window.scrollTo(0, y);
  html.style.scrollBehavior = behavior;
}

function showSheet(modal, hash, fromHash) {
  if (!modal) return;
  document.querySelectorAll(".modal").forEach((other) => {
    if (other !== modal) other.hidden = true;
  });
  if (!modalOpener) modalOpener = document.activeElement;
  lockPageScroll();
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
  restoreListScroll("booths");
  watchBoothMotion();
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
    // Fit the haunt area with room for the neighbouring blocks (T18 sits just past T17),
    // and never open zoomed in past 100%.
    const spanX = maxX - minX;
    const spanY = maxY - minY;
    const mapPadX = Math.max(spanX * 0.18, 90);
    const mapPadY = Math.max(spanY * 0.25, 60);
    const screenPad = 24;
    scale = Math.min(
      (vp.width - screenPad * 2) / (spanX + mapPadX * 2),
      (vp.height - screenPad * 2) / (spanY + mapPadY * 2),
      1
    );
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
  const status = row && !zone ? rowStatus(row) : "open";
  const panel = els.modal.querySelector(".modal__panel");
  if (panel) {
    panel.dataset.cluster = meta.cluster || "";
    panel.dataset.houseStatus = zone || screening ? "plain" : status;
  }
  const artEl = els.modal.querySelector("[data-modal-art]");
  if (artEl) {
    const svg = houseArt(meta.id);
    artEl.innerHTML = svg ? `<span class="booth-mark" aria-hidden="true">${svg}</span>` : "";
  }
  const logosEl = els.modal.querySelector("[data-modal-logos]");
  if (logosEl) {
    logosEl.innerHTML = posterImgs(meta, "sm");
    logosEl.hidden = !meta.posters?.length;
  }
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
  els.modal.querySelector("[data-modal-code]").textContent = roomLabel(meta.rooms) || meta.short;
  const tagsEl = els.modal.querySelector("[data-modal-tags]");
  if (tagsEl) tagsEl.innerHTML = tagChips(meta) || "";
  const upd = els.modal.querySelector("[data-modal-updated]");
  if (upd) upd.textContent = row && !isWalkthrough(meta) ? freshnessLabel(row.updated_at) : "";
  const night = readNight();
  const watchBtn = document.getElementById("modalWatch");
  if (watchBtn) {
    watchBtn.hidden = isWalkthrough(meta);
    watchBtn.dataset.houseId = id;
    if (row) watchBtn.textContent = night.watch.includes(id) ? "Stop walk-in alert" : "Alert when walk-in";
    const busy = watchInFlight.has(id);
    watchBtn.disabled = busy;
    watchBtn.classList.toggle("is-busy", busy);
  }
  showSheet(els.modal, meta.kind === "screening" ? "" : `#house/${id}`, opts.fromHash);
  syncSheetBack(els.modal);
}

function clusterHouseHtml(meta, watching) {
  const row = houses.find((h) => h.id === meta.id);
  const zone = meta.kind === "scarezone";
  const wait = meta.kind === "screening" ? "Movie" : zone ? "Scare Zone" : row ? waitLabel(row.wait_minutes, rowStatus(row)) : "";
  const on = watching.has(meta.id);
  const alert = isWalkthrough(meta)
    ? ""
    : `<button class="btn btn--ghost cluster-house__alert" type="button" data-watch-house="${escapeHtml(meta.id)}" aria-pressed="${on}">${on ? "Alert on" : "Alert when walk-in"}</button>`;
  return `<li class="cluster-house">
    <div>
      <h4>${escapeHtml(meta.name)}</h4>
      <p class="cluster-house__where">${escapeHtml(roomLabel(meta.rooms) || meta.short)} · ${escapeHtml(wait)}</p>
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
  // Same two-column house cards as the Houses section (logo, tag, wait, queue, drawing, Notify).
  const cards = members.map((meta) => {
    if (meta.kind === "screening") return screeningCardHtml(meta);
    if (meta.kind === "scarezone") return scareZoneCardHtml(meta);
    const row = houses.find((h) => h.id === meta.id);
    return row ? houseCardHtml(row, watching) : "";
  }).join("");
  const list = modal.querySelector("[data-cluster-houses]");
  const html = `<div class="cluster-group__grid">${cards}</div>`;
  if (list.screamHtml !== html) {
    list.screamHtml = html;
    list.innerHTML = html;
  }
  const pinId = openClusterKey.startsWith("pin:") ? openClusterKey.slice(4) : "";
  showSheet(modal, pinId ? `#pin/${pinId}` : `#cluster/${openClusterKey.slice(8)}`, Boolean(opts.fromHash));
  restoreListScroll("cluster");
  watchBoothMotion();
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
    const showLogo = Boolean(booth.food && booth.logo);
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
  showSheet(modal, `#booth/${id}`, opts.fromHash);
  syncSheetBack(modal);
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
  sheetBack = null;
  const opener = modalOpener;
  modalOpener = null;
  unlockPageScroll();
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
  // Centre in the part of the stage visible on first load (between header and bottom menu), not the whole ghost card.
  const nav = document.querySelector(".nav");
  const navRect = nav ? nav.getBoundingClientRect() : null;
  const navClear = navRect && navRect.top > window.innerHeight / 2 ? Math.max(0, window.innerHeight - navRect.top) : 0;
  const visibleH = Math.min(height, Math.max(cardH + 32, window.innerHeight - headerBottom - navClear));
  card.style.top = `${Math.max(16, (visibleH - cardH) / 2)}px`;
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

let cardSeq = 0;
let justLit = new Set();

function litStampIds(stamps) {
  return STAMP_BOOTHS.filter((booth) => stamps && (stamps[booth.id] || stamps[Number(booth.id)])).map((booth) => booth.id);
}

const SEEN_STAMPS_KEY = "scream-stamps-seen";

function readSeenStamps(studentNumber) {
  if (!studentNumber) return null;
  try {
    const all = JSON.parse(localStorage.getItem(SEEN_STAMPS_KEY) || "{}");
    return Array.isArray(all[studentNumber]) ? new Set(all[studentNumber].map(String)) : null;
  } catch {
    return null;
  }
}

function writeSeenStamps(studentNumber, ids) {
  if (!studentNumber) return;
  try {
    const all = JSON.parse(localStorage.getItem(SEEN_STAMPS_KEY) || "{}");
    all[studentNumber] = ids.map(String);
    localStorage.setItem(SEEN_STAMPS_KEY, JSON.stringify(all));
  } catch {
    /* private mode: no memory, so no stamp toasts rather than repeated ones */
  }
}

function cardSignature(card) {
  return `${card.studentNumber}|${litStampIds(card.stamps).join(",")}|${card.redeemedAt || ""}|${card.completeNo || ""}`;
}

/** Returns true when the card changed. Responses that arrive after a newer request are dropped. */
async function loadCardFromServer({ retry = false } = {}) {
  const session = getStudentSession();
  if (!session) {
    cardState = { stamps: {}, redeemedAt: null, redeemedBy: null, fullName: "", studentNumber: "", passId: "" };
    return true;
  }
  const seq = ++cardSeq;
  const data = retry ? await withSignInRetry(() => fetchStamps()) : await fetchStamps();
  if (seq !== cardSeq) return false;
  const next = {
    stamps: data.stamps || {},
    redeemedAt: data.redeemedAt || null,
    redeemedBy: data.redeemedBy || null,
    fullName: data.fullName || session.payload.name,
    studentNumber: data.studentNumber || session.payload.studentNumber,
    passId: data.passId || `SP-FP-${session.payload.studentNumber}`,
    completeNo: Number.isInteger(data.completeNo) && data.completeNo > 0 ? data.completeNo : null,
  };
  const changed = cardSignature(next) !== cardSignature(cardState);
  // Toast only stamps this device has not seen for this student. The first load (sign-in, reload,
  // new device) seeds the seen list silently, so old stamps never pop up again.
  const lit = litStampIds(next.stamps);
  const seen = readSeenStamps(next.studentNumber);
  justLit = seen ? new Set(lit.filter((id) => !seen.has(id))) : new Set();
  writeSeenStamps(next.studentNumber, lit);
  cardState = next;
  stampVersion = Number(data.version) || 0;
  return changed;
}

/**
 * Stamp card freshness: while the stamps view is open and the tab is visible, ask a tiny private
 * endpoint for the card's version every ~17s (jittered, backing off on errors) and fetch the full
 * card only when it moved. Other views never poll. Opening the view, returning to the tab and the
 * student's own actions all refresh straight away.
 */
const stampWatch = createPoller({
  baseMs: 17000,
  active: () => Boolean(getStudentSession()) && document.querySelector(".view.is-active")?.dataset.view === "stamps",
  run: async () => {
    const version = await fetchStampsVersion();
    if (version === stampVersion) return;
    const changed = await loadCardFromServer();
    if (changed) {
      paintStampUi();
      if (justLit.size) celebrateStamps();
    }
  },
});

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
  if (lines.length === 1) return `<span>${escapeHtml(name)}</span>`;
  const visual = lines
    .map((line, i) => `<span${i && lines[i - 1].endsWith("-") ? ' class="is-joined"' : ""}>${escapeHtml(line)}</span>`)
    .join("");
  return `<span class="name-lines" aria-hidden="true">${visual}</span><span class="visually-hidden">${escapeHtml(name)}</span>`;
}

/** Both art sets ship; html[data-art] decides which one shows, so the switch needs no re-render. */
function stationMark(booth) {
  const poster = stationSvg(booth.id);
  if (!poster) return markImg(booth.icon);
  return `<span class="art-classic">${markImg(booth.icon)}</span><span class="art-poster station-art">${poster}</span>`;
}

function stampBoardHtml({ lit, interactive } = {}) {
  const complete = Boolean(lit) && STAMP_BOOTHS.every((booth) => lit(booth.id));
  const pins = STAMP_BOOTHS.map((booth) => {
    const stamped = lit ? lit(booth.id) : false;
    const side = booth.map.side || "s";
    const cls = `station-map__pin is-${side}${stamped ? " is-lit" : ""}`;
    const inner = `
        <span class="station-map__icon" aria-hidden="true">${stationMark(booth)}</span>
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
      <img class="station-map__art" src="${TICKET_ART_SRC}" alt="">
      ${ticketNoHtml(complete)}
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
          <span class="stamp-pad__ink" aria-hidden="true">${stationMark(booth)}</span>
          <span class="stamp-pad__meta">
            <strong>${escapeHtml(booth.name)}</strong>
            <small>${escapeHtml(booth.short)}</small>
          </span>
        </button>`;
    }).join("");
    els.stampGrid.innerHTML = `
      <div class="stamp-grid__ticket" aria-hidden="true">
        <img src="${TICKET_ART_SRC}" alt="">
        ${ticketNoHtml(complete)}
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
      <div class="lantern__rune-slot" data-rune="${index}">
        <button class="lantern__rune" type="button" data-stamp="${escapeHtml(booth.id)}" aria-label="${escapeHtml(booth.name)}">
          <span class="lantern__rune-glow"></span>
          <span class="lantern__rune-stone"></span>
          <span class="lantern__rune-glyph" aria-hidden="true">${stationMark(booth)}</span>
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
        ? "Show this at the Information Counter"
        : "Caged spirit";
  }
  if (els.lanternHint) {
    const hideHint = complete || redeemed || ghostRoaming;
    els.lanternHint.hidden = hideHint;
    if (!hideHint) {
      els.lanternHint.textContent = filled
        ? `Uncover ${goal - filled} more piece${goal - filled === 1 ? "" : "s"} of your prize ticket`
        : "The spirit is caged. Stamp booths to uncover your ticket";
    }
  }
  if (els.passUsedMark) els.passUsedMark.hidden = !redeemed;
  if (els.fastPassCard) {
    const tear = redeemed && (document.documentElement.dataset.art || "poster") !== "classic";
    if (!redeemed) delete els.fastPassCard.dataset.tearPlayed;
    if (tear && !els.fastPassCard.dataset.tearPlayed) {
      els.fastPassCard.dataset.tearPlayed = "1";
      els.fastPassCard.classList.add("is-tearing");
      window.setTimeout(() => els.fastPassCard.classList.remove("is-tearing"), 700);
    }
    if (!tear) els.fastPassCard.classList.remove("is-tearing");
  }
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

function celebrateStamps() {
  const ids = [...justLit];
  justLit = new Set();
  ids.forEach((id) => {
    document.querySelectorAll(`[data-stamp="${CSS.escape(id)}"]`).forEach((el) => {
      el.classList.remove("is-new");
      void el.offsetWidth;
      el.classList.add("is-new");
      window.setTimeout(() => el.classList.remove("is-new"), 1800);
    });
  });
  const names = ids.map((id) => boothById(id)?.name).filter(Boolean);
  if (!names.length) return;
  const left = STAMP_BOOTHS.length - litStampIds(cardState.stamps).length;
  const tail = left > 0 ? `${left} to go.` : "That's all five. Show your completed card to the staff at the Information Counter to redeem your prize.";
  showWaitToast("Stamp collected!", `${names.join(" & ")} is on your card. ${tail}`, false);
}

async function renderStamps({ refresh = false, quiet = false, retry = false } = {}) {
  const session = getStudentSession();
  if (!session) {
    paintStampUi();
    return;
  }

  if (!quiet) paintStampUi();

  if (!refresh && cardState.studentNumber) return;

  try {
    const changed = await loadCardFromServer({ retry });
    if (changed || !quiet) paintStampUi();
    if (changed && justLit.size) celebrateStamps();
  } catch (error) {
    if (!getStudentSession()) {
      cardState = { stamps: {}, redeemedAt: null, redeemedBy: null, fullName: "", studentNumber: "", passId: "" };
      paintStampUi();
      updateNav();
      return;
    }
    if (quiet) return;
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

/** CSP bans style="" attributes, so per-element CSS variables ride on data-* and are set through CSSOM. */
const STYLE_VARS = { tilt: "--tilt", idleDelay: "--idle-delay", rune: "--rune" };
const STYLE_VAR_SELECTOR = "[data-tilt], [data-idle-delay], [data-rune]";

function applyStyleVars(root) {
  if (!root || root.nodeType !== 1) return;
  const nodes = root.matches(STYLE_VAR_SELECTOR) ? [root] : [];
  nodes.push(...root.querySelectorAll(STYLE_VAR_SELECTOR));
  nodes.forEach((node) => {
    Object.entries(STYLE_VARS).forEach(([key, prop]) => {
      if (node.dataset[key] !== undefined) node.style.setProperty(prop, node.dataset[key]);
    });
  });
}

function watchStyleVars() {
  applyStyleVars(document.body);
  new MutationObserver((records) => {
    records.forEach((record) => record.addedNodes.forEach(applyStyleVars));
  }).observe(document.body, { childList: true, subtree: true });
}

/** Intrinsic logo sizes so the layout doesn't jump while images load. */
const LOGO_SIZES = {
  "img/food/beamori.png": [162, 197],
  "img/food/kwazy.png": [240, 128],
  "img/food/matcha-hour.png": [756, 408],
  "img/food/baked-bree.png": [160, 160],
  "img/food/pasta-lab.png": [634, 633],
  "img/sponsors/aeroflow.png": [814, 144],
  "img/sponsors/boulder-planet.png": [1616, 139],
  "img/sponsors/charms-n-links.png": [394, 432],
  "img/sponsors/double-chin.png": [726, 708],
  "img/sponsors/sonic-bowl.webp": [308, 144],
  "img/sponsors/potico.webp": [380, 75],
  "img/sponsors/weplay-paintball.webp": [174, 144],
  "img/sponsors/sim-ge.webp": [195, 144],
  "img/clubLogos/clean/abec.png": [640, 210],
  "img/clubLogos/clean/clsc.png": [426, 426],
  "img/clubLogos/clean/cscc.png": [900, 888],
  "img/clubLogos/clean/eeec.png": [640, 397],
  "img/clubLogos/clean/madc.png": [640, 640],
  "img/clubLogos/clean/maec.png": [640, 640],
  "img/clubLogos/clean/sbc.png": [640, 635],
  "img/clubLogos/clean/smac.png": [557, 591],
  "img/clubLogos/clean/socc.png": [559, 640],
  "img/clubLogos/clean/spssc.png": [423, 423],
  "img/clubLogos/clean/spsu.png": [290, 333],
};

function logoDims(src, fallback = [64, 64]) {
  const [w, h] = LOGO_SIZES[String(src || "").split("?")[0]] || fallback;
  return ` width="${w}" height="${h}"`;
}

/** Spinner + disabled + aria-busy on a button; restores the original label afterwards. */
function setBusy(btn, busy, label) {
  if (!btn) return;
  if (busy) {
    if (btn.dataset.idleLabel === undefined) btn.dataset.idleLabel = btn.textContent.trim();
    btn.disabled = true;
    btn.classList.add("is-busy");
    btn.setAttribute("aria-busy", "true");
    const text = label || btn.dataset.busyLabel;
    if (text) btn.textContent = text;
  } else {
    btn.disabled = false;
    btn.classList.remove("is-busy");
    btn.removeAttribute("aria-busy");
    if (btn.dataset.idleLabel !== undefined) {
      btn.textContent = btn.dataset.idleLabel;
      delete btn.dataset.idleLabel;
    }
  }
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

function paintAnnouncements(rows) {
  const empty = `<li class="announce-item announce-item--empty"><p class="announce-item__body">No announcements yet. All quiet in the crypt.</p></li>`;
  const html = rows.length ? rows.map(announceItemHtml).join("") : empty;
  if (els.announceStrip) els.announceStrip.innerHTML = html;
  if (els.announceList) els.announceList.innerHTML = html;
  const details = document.getElementById("announceDetails");
  if (details) details.open = rows.length > 0;
}

/** Announcements load once, then only when the shared versions poll says announce_v moved. A failed load keeps what is on screen. */
async function loadPublicAnnouncements({ v, fresh = false } = {}) {
  let rows;
  try {
    rows = await fetchAnnouncements({ v, fresh, strict: true });
  } catch {
    announceDirty = true;
    if (!announceLoaded) {
      announceLoaded = true;
      paintAnnouncements([]);
    }
    return;
  }
  announceDirty = false;
  announceLoaded = true;
  announceRows = rows;
  noteNewAnnouncements(rows);
  paintAnnouncements(rows);
}

/** No network: drops expired notes and refreshes the "x min ago" labels from the rows already loaded. */
function repaintAnnouncements() {
  if (!announceLoaded) return;
  const now = Date.now();
  announceRows = announceRows.filter((row) => !(row.expires_at && new Date(row.expires_at).getTime() < now));
  paintAnnouncements(announceRows);
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

let opsSeq = 0;
let opsTimer = 0;

const SGT_PARTS = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Singapore",
  day: "numeric",
  month: "short",
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});

/** "16 Oct, 5:05 PM" in Singapore time, whatever the device clock zone is. */
function formatSgt(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  const parts = Object.fromEntries(SGT_PARTS.formatToParts(date).map((p) => [p.type, p.value]));
  return `${parts.day} ${parts.month}, ${parts.hour}:${parts.minute} ${String(parts.dayPeriod || "").toUpperCase()}`.trim();
}

const AUDIT_ACTIONS = {
  award_stamp: "Stamp awarded",
  unaward_stamp: "Stamp undone",
  redeem_pass: "Wheel ticket redeemed",
  unredeem_pass: "Redeem undone",
  wait_update: "Wait updated",
  announce_post: "Announcement posted",
  announce_on: "Announcement shown",
  announce_off: "Announcement taken down",
};

function auditLine(row) {
  const action = AUDIT_ACTIONS[row.action] || String(row.action || "").replace(/_/g, " ");
  const detail = row.detail && typeof row.detail === "object" ? row.detail : {};
  const bits = [];
  const booth = detail.boothId ? boothById(String(detail.boothId)) : null;
  const house = houseMeta(row.target);
  if (booth) bits.push(booth.name);
  if (house) bits.push(house.name);
  else if (row.target) bits.push(row.target);
  if (row.action === "wait_update" && detail.wait_minutes != null) bits.push(`${detail.wait_minutes} min`);
  return { action, target: bits.join(" · ") };
}

function stopStaffPolls() {
  stopOpsRefresh();
}

function noteStaffChange() {
  if (staffScope() === "admin") loadOps();
}

function startOpsRefresh() {
  window.clearInterval(opsTimer);
  loadOps();
  opsTimer = window.setInterval(() => {
    if (staffTab === "ops" && document.visibilityState !== "hidden") loadOps();
  }, 12000);
}

function stopOpsRefresh() {
  window.clearInterval(opsTimer);
  opsTimer = 0;
}

async function loadOps() {
  const grid = document.getElementById("opsGrid");
  const audit = document.getElementById("opsAudit");
  if (!grid) return;
  const seq = ++opsSeq;
  try {
    const data = await fetchOps();
    if (seq !== opsSeq) return;
    const counts = data.stampsPerBooth || {};
    const boothBits = STAMP_BOOTHS.map((b) => {
      const n = counts[b.id] ?? counts[String(b.id)] ?? 0;
      return `<div class="ops-card"><span>${escapeHtml(b.name)}</span><strong>${n}</strong></div>`;
    }).join("");
    const n = (value) => Number(value) || 0;
    grid.innerHTML = `
      <div class="ops-card"><span>Students</span><strong>${n(data.students)}</strong></div>
      <div class="ops-card"><span>Wheel tickets unlocked (5/5)</span><strong>${n(data.fastPassUnlocked)}</strong></div>
      <div class="ops-card"><span>Wheel tickets redeemed</span><strong>${n(data.redeemed)}</strong></div>
      <div class="ops-card"><span>Houses busy</span><strong>${n(data.housesBusy)}</strong></div>
      <div class="ops-card"><span>Houses long</span><strong>${n(data.housesLong)}</strong></div>
      <div class="ops-card"><span>Houses closed</span><strong>${n(data.housesClosed)}</strong></div>
      <div class="ops-card"><span>Feedback (6h)</span><strong>${n(data.recentFeedback)}</strong></div>
      ${boothBits}`;
    if (audit) {
      const rows = data.audit || [];
      audit.innerHTML = rows.length
        ? rows.map((row) => {
          const line = auditLine(row);
          return `<li class="feedback-item"><p><strong>${escapeHtml(line.action)}</strong>${line.target ? ` · ${escapeHtml(line.target)}` : ""}</p><p class="muted">${escapeHtml(row.staff_id || "Staff")} · ${escapeHtml(formatSgt(row.at))}</p></li>`;
        }).join("")
        : "<li class='empty-state'><p class='empty-state__title'>No staff actions yet</p><p class='empty-state__hint'>Stamps, redeems and wait changes show up here.</p></li>";
    }
  } catch (error) {
    if (seq !== opsSeq) return;
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
  if (lead) {
    lead.hidden = !locked;
    lead.textContent = locked ? `Look up the student, then confirm the ${booth.name} stamp.` : "";
  }
  if (boothLabel) boothLabel.hidden = locked;
  if (submit) submit.textContent = "Look up";
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
    ? rows.map((row) => `<li class="${row.ok ? "is-ok" : "is-error"}"><strong>${escapeHtml(row.at)} · ${escapeHtml(row.action)}</strong>${escapeHtml(row.message)}</li>`).join("")
    : "<li class='empty-state'><p class='empty-state__title'>Nothing yet</p><p class='empty-state__hint'>What you do on this device (and anything that fails) is listed here.</p></li>";
}

function writeStaffLog(entry) {
  const rows = readStaffLog();
  rows.unshift({ at: formatSgt(new Date()), ...entry });
  try {
    sessionStorage.setItem("scream-staff-log", JSON.stringify(rows.slice(0, 40)));
  } catch {
    /* private mode */
  }
  paintStaffLog();
}

function pushStaffLog(action, error) {
  writeStaffLog({ action, ok: false, message: userFacingError(error, "Something went wrong. Try again.") });
}

function logStaffAction(action, message) {
  writeStaffLog({ action, ok: true, message });
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
  els.adminGate.hidden = true;
  els.adminApp.hidden = false;
  updateNav();

  const lockedHouse = staffHouseId();
  const lockedMeta = lockedHouse ? houseMeta(lockedHouse) : null;
  const waitTitle = document.querySelector('[data-staff-panel="waits"] h2');
  if (waitTitle) waitTitle.textContent = lockedMeta ? lockedMeta.name : "Wait-Time Control";
  if (els.publishAll) els.publishAll.hidden = Boolean(lockedHouse);
  const waitHouses = lockedHouse ? houses.filter((row) => row.id === lockedHouse) : houses;
  els.adminTable.innerHTML = CLUSTERS.map((cluster) => {
    const members = waitHouses.filter((row) => houseMeta(row.id)?.cluster === cluster.id);
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
            <div class="muted">${escapeHtml(roomLabel(meta?.rooms) || meta?.short || "")}</div>
          </td>
          <td>
            <div class="wait-editor">
              <span class="wait-editor__label">Minutes</span>
              <button type="button" data-adjust="-5" aria-label="Decrease wait by 5 minutes">−5</button>
              <button type="button" data-adjust="-1" aria-label="Decrease wait by 1 minute">−1</button>
              <input type="number" inputmode="numeric" min="0" max="${WAIT_MAX}" step="1" value="${minutes ?? ""}" data-wait-input aria-label="Wait minutes for ${escapeHtml(row.name)}">
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
  if (errorLog) errorLog.hidden = false;
  paintStaffLog();
  const allowed = [...document.querySelectorAll("[data-staff-tab]")].filter((btn) => {
    const need = btn.dataset.staffScope || "admin";
    const ok = staffSeesTab(scope, need);
    btn.hidden = !ok;
    return ok;
  });
  if (!allowed.some((btn) => btn.dataset.staffTab === staffTab)) {
    staffTab = allowed[0]?.dataset.staffTab || "waits";
  }
  const staffTabs = document.querySelector(".staff-tabs");
  if (staffTabs) staffTabs.hidden = allowed.length < 2;
  document.querySelectorAll("[data-staff-tab]").forEach((btn) => {
    btn.classList.toggle("is-active", btn.dataset.staffTab === staffTab);
  });
  document.querySelectorAll("[data-staff-panel]").forEach((panel) => {
    panel.hidden = panel.dataset.staffPanel !== staffTab;
  });
  if (staffTab === "ops") startOpsRefresh();
  else stopOpsRefresh();
}

function readAdminRow(tr) {
  const id = tr.dataset.adminRow;
  const wait = Math.max(0, Math.min(WAIT_MAX, Math.round(Number(tr.querySelector("[data-wait-input]").value) || 0)));
  const row = houses.find((house) => house.id === id);
  const published = hasPublishedWait(row) && Number(row.wait_minutes) === wait;
  const label = tr.querySelector("[data-publish-state]");
  if (label) {
    label.textContent = published ? "Published" : "Not published yet";
    label.dataset.publishState = published ? "saved" : "dirty";
  }
  drafts.set(id, { wait_minutes: wait });
  return { id, wait_minutes: wait };
}

let waitSaveStatusTimer = 0;

function setWaitSaveStatus(message, isError = true) {
  if (!els.waitSaveStatus) return;
  clearTimeout(waitSaveStatusTimer);
  if (!message) {
    els.waitSaveStatus.hidden = true;
    els.waitSaveStatus.textContent = "";
    els.waitSaveStatus.classList.add("form-error");
    els.waitSaveStatus.classList.remove("muted");
    return;
  }
  const show = () => {
    els.waitSaveStatus.hidden = false;
    els.waitSaveStatus.textContent = message;
    els.waitSaveStatus.classList.toggle("form-error", isError);
    els.waitSaveStatus.classList.toggle("muted", !isError);
  };
  if (!isError && !els.waitSaveStatus.hidden && els.waitSaveStatus.textContent === message) {
    els.waitSaveStatus.hidden = true;
    requestAnimationFrame(show);
  } else {
    show();
  }
  if (!isError) {
    waitSaveStatusTimer = setTimeout(() => setWaitSaveStatus(""), 4000);
  }
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
  const lockedHouse = staffHouseId();
  if (lockedHouse && id !== lockedHouse) {
    const message = "This login can only update its own scare house.";
    setWaitSaveStatus(message);
    return { ok: false, error: message };
  }
  if (!store) return { ok: false, error: "Wait times are still loading." };
  clearTimeout(waitSaveTimers.get(id));
  waitSaveTimers.delete(id);
  const result = await store.publish(id, patch, { persist: true });
  const name = houseMeta(id)?.name || "Scare house";
  if (result?.ok) {
    const current = drafts.get(id);
    if (patch.wait_minutes !== undefined && (!current || Number(current.wait_minutes) === Number(patch.wait_minutes))) drafts.delete(id);
    const saved = result.house || {};
    const minutes = saved.wait_minutes ?? patch.wait_minutes;
    setWaitSaveStatus("Saved to the live database.", false);
    logStaffAction("Wait updated", `${name}: ${minutes} min`);
    noteStaffChange();
    return result;
  }
  const latest = drafts.get(id);
  if (patch.wait_minutes !== undefined && latest && Number(latest.wait_minutes) !== Number(patch.wait_minutes)) {
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

function syncCardsSky() {
  const start = document.getElementById("scareHouses");
  const end = document.getElementById("map-booths");
  const sky = document.getElementById("cardsSky");
  if (!start || !end || !sky) return;
  const top = Math.max(0, start.getBoundingClientRect().top);
  const bottom = Math.max(0, window.innerHeight - end.getBoundingClientRect().bottom);
  sky.style.setProperty("--sky-top", `${top}px`);
  sky.style.setProperty("--sky-bottom", `${bottom}px`);
}

function bindUi() {
  fillAwardBoothSelect();
  paintStaffLog();
  document.getElementById("staffLogClear")?.addEventListener("click", () => {
    sessionStorage.removeItem("scream-staff-log");
    paintStaffLog();
  });
  syncCardsSky();
  window.addEventListener("scroll", () => {
    syncCardsSky();
    syncMapJump();
  }, { passive: true });
  window.addEventListener("resize", syncCardsSky);
  document.getElementById("mapJump")?.addEventListener("click", (event) => {
    const chip = event.target.closest("[data-jump]");
    if (!chip) return;
    const target = document.getElementById(chip.dataset.jump);
    if (!target) return;
    window.removeEventListener("scrollend", releaseJumpLock);
    window.clearTimeout(jumpLockTimer);
    measureJumpClear();
    jumpRest = null;
    jumpLockId = target.id;
    markJumpChip(target.id, { scrollTrack: false });
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const startY = window.scrollY;
    window.scrollTo({ top: jumpTargetTop(target.id), behavior: reduce ? "auto" : "smooth" });
    if (reduce) {
      releaseJumpLock();
      return;
    }
    window.addEventListener("scrollend", releaseJumpLock);
    jumpLockTimer = window.setTimeout(releaseJumpLock, "onscrollend" in window ? 2500 : 1100);
    // Live repaints can swallow a smooth scroll before it starts; nudge once if nothing moved.
    window.setTimeout(() => {
      if (jumpLockId !== target.id || Math.abs(window.scrollY - startY) > 1) return;
      const top = jumpTargetTop(target.id);
      if (Math.abs(top - startY) > 4) window.scrollTo({ top, behavior: "smooth" });
    }, 180);
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
    const backBtn = event.target.closest("[data-sheet-back]");
    if (backBtn) {
      goBackToList();
      return;
    }
    const houseBtn = event.target.closest("[data-open-house]");
    if (houseBtn) {
      sheetBack = houseBtn.closest("#clusterModal") && openClusterKey
        ? { list: "cluster", key: openClusterKey, hash: location.hash, scroll: listScrollOf(els.clusterModal) }
        : null;
      openHouse(houseBtn.dataset.openHouse);
    }

    const boothsPin = event.target.closest("[data-open-booths]");
    if (boothsPin) openBooths();

    const boothBtn = event.target.closest("[data-open-booth]");
    if (boothBtn) {
      sheetBack = boothBtn.closest("#boothsModal")
        ? { list: "booths", key: "booths", hash: location.hash, scroll: listScrollOf(els.boothsModal) }
        : null;
      if (els.boothsModal) els.boothsModal.hidden = true;
      openBooth(boothBtn.dataset.openBooth);
    }

    const stampBtn = event.target.closest("[data-stamp]");
    if (stampBtn) {
      sheetBack = null;
      openBooth(stampBtn.dataset.stamp);
    }

    const logout = event.target.closest("[data-logout]");
    if (logout && !logout.classList.contains("is-busy")) {
      handleLogout(logout);
    }

    if (event.target.closest("[data-clear-filters]")) {
      clearHouseFilters();
      return;
    }
    if (event.target.closest("[data-close-modal]")) closeModals({ restore: true });
  });

  ["studentLoginId", "awardStudentNumber", "redeemStudentNumber"].forEach((id) => {
    document.getElementById(id)?.addEventListener("blur", (event) => {
      event.target.value = normalizeAdminNumber(event.target.value).slice(0, 8);
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

  async function handleLogout(btn) {
    const student = btn.dataset.logout === "student";
    setBusy(btn, true, student ? "Vanishing…" : "Locking up…");
    flushGameProgress();
    try {
      if (student) {
        const night = readNight();
        night.watch = [];
        writeNight(night);
        await Promise.all([disablePushNotifications().catch(() => {}), clearStudentSession()]);
        cardState = { stamps: {}, redeemedAt: null, redeemedBy: null, fullName: "", studentNumber: "", passId: "" };
        cardSeq += 1;
        spiritRaised = false;
        stopGhostRoam();
        stopStaffPolls();
      } else {
        await clearAdminSession();
        stopStaffPolls();
      }
    } finally {
      setBusy(btn, false);
    }
    applyGameAccount();
    updateNav();
    const view = document.querySelector(".view.is-active")?.dataset.view;
    if (student) {
      renderStamps();
      renderDashboard();
      renderPins();
      if (view === "admin" || view === "stamps") setView("login");
      showWaitToast("Signed out", "Your card is safe in the crypt until next time.", false);
    } else {
      if (view === "admin") setView(getStudentSession() ? "stamps" : "login");
      else renderAdmin();
      showWaitToast("Staff locked", "Staff tools are closed on this device.", false);
    }
  }

  const SIGNIN_DRAFT_KEY = "sp-signin-draft";

  function readSignInDraft() {
    try {
      return JSON.parse(sessionStorage.getItem(SIGNIN_DRAFT_KEY) || "null");
    } catch {
      return null;
    }
  }

  function writeSignInDraft(adminNumber, fullName) {
    try {
      sessionStorage.setItem(SIGNIN_DRAFT_KEY, JSON.stringify({ adminNumber, fullName }));
    } catch {
      /* private mode */
    }
  }

  function clearSignInDraft() {
    try {
      sessionStorage.removeItem(SIGNIN_DRAFT_KEY);
    } catch {
      /* ignore */
    }
  }

  function fillSignInFormFromDraft() {
    const draft = readSignInDraft();
    if (!draft) return;
    const idInput = document.getElementById("studentLoginId");
    const nameInput = document.getElementById("studentLoginName");
    if (idInput && !idInput.value && draft.adminNumber) idInput.value = draft.adminNumber;
    if (nameInput && !nameInput.value && draft.fullName) nameInput.value = draft.fullName;
  }

  fillSignInFormFromDraft();
  ["studentLoginId", "studentLoginName"].forEach((id) => {
    document.getElementById(id)?.addEventListener("change", () => {
      const idInput = document.getElementById("studentLoginId");
      const nameInput = document.getElementById("studentLoginName");
      const num = normalizeAdminNumber(idInput?.value || "");
      const name = String(nameInput?.value || "").trim();
      if (num || name) writeSignInDraft(num, name);
    });
  });

  let authPromise = null;
  let lastSignInCrowded = false;

  async function handleAuthSubmit(event) {
    event.preventDefault();
    // A tap during an active retry keeps that attempt going — never start a parallel one.
    if (authPromise) return authPromise;
    const err = document.getElementById("studentLoginError");
    const submit = event.currentTarget.querySelector('button[type="submit"]');
    const idInput = document.getElementById("studentLoginId");
    const nameInput = document.getElementById("studentLoginName");
    if (err) err.hidden = true;
    const idValue = normalizeAdminNumber(idInput?.value || "");
    if (idInput) idInput.value = idValue;
    const nameValue = String(nameInput?.value || "").trim();
    const idBad = setFieldError(idInput, "studentLoginIdError", admissionNumberProblem(idValue));
    const nameBad = setFieldError(nameInput, "studentLoginNameError", nameValue.length >= 2 ? "" : "Enter your full name, like it's on your student card.");
    if (idBad || nameBad) {
      (idBad ? idInput : nameInput)?.focus();
      return;
    }
    writeSignInDraft(idValue, nameValue);
    authPromise = (async () => {
      setBusy(submit, true);
      try {
        flushGameProgress();
        // After a crowded failure, a quick re-tap waits a random moment so phones don't retry in step.
        if (lastSignInCrowded) await new Promise((resolve) => setTimeout(resolve, Math.random() * FIRST_TRY_JITTER_MS));
        const data = await withSignInRetry(
          () => signIn({ adminNumber: idValue, fullName: nameValue }),
          { onStatus: (text) => setBusy(submit, true, text) }
        );
        // created:false (already exists) is success — signIn already applied the session.
        lastSignInCrowded = false;
        clearSignInDraft();
        applyGameAccount();
        updateNav();
        // Into the map first; the stamp card loads quietly in the background with the same retry.
        setView("map");
        if (data.created) {
          showWaitToast("Card created", "Use this same admin number and name to sign in on another device.", false);
        }
        if (data.student) {
          // Seed the card from the session so the stamps tab isn't empty while we fetch.
          cardState.fullName = data.student.fullName || nameValue;
          cardState.studentNumber = data.student.studentNumber || idValue;
          cardState.passId = `SP-FP-${cardState.studentNumber}`;
          cardState.stamps = cardState.stamps || {};
          renderStamps({ refresh: true, quiet: true, retry: true }).catch(() => paintStampUi());
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
        lastSignInCrowded = Boolean(error && error.crowded);
        if (err) {
          err.hidden = false;
          err.textContent = lastSignInCrowded ? SIGNIN_TEXT.gaveUp : userFacingError(error, "Sign-in failed. Check your admin number and name.");
        }
      } finally {
        setBusy(submit, false);
      }
    })();
    try {
      await authPromise;
    } finally {
      authPromise = null;
    }
  }

  document.getElementById("studentLoginForm")?.addEventListener("submit", (event) => handleAuthSubmit(event));

  document.getElementById("staffUnlockForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const err = document.getElementById("staffUnlockError");
    const submit = event.currentTarget.querySelector('button[type="submit"]');
    const pass = document.getElementById("staffUnlockPassword");
    if (err) err.hidden = true;
    setBusy(submit, true, "Checking…");
    try {
      await unlockStaff(pass?.value || "");
      if (pass) pass.value = "";
      applyGameAccount();
      updateNav();
      renderAdmin();
    } catch (error) {
      if (err) {
        err.hidden = false;
        err.textContent = userFacingError(error, "Staff sign-in failed. Check the password for your post.");
      }
    } finally {
      setBusy(submit, false);
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
    return `Ticket used ${formatSgt(at)}${by ? ` by ${by}` : ""}.`;
  }

  /** Lookup result for the wheel desk. Under 5/5 the button stays visible but disabled. */
  function showStaffRedeemReady(data, filled) {
    const form = document.getElementById("staffRedeemLookupForm");
    const ready = document.getElementById("staffRedeemReady");
    const used = document.getElementById("staffRedeemUsed");
    if (form) form.hidden = true;
    if (used) used.hidden = true;
    if (ready) ready.hidden = false;
    const readyErr = document.getElementById("staffRedeemReadyError");
    if (readyErr) {
      readyErr.hidden = true;
      readyErr.textContent = "";
    }
    const goal = STAMP_BOOTHS.length;
    const enough = filled >= goal;
    const passId = data.passId || `SP-FP-${data.studentNumber}`;
    document.getElementById("staffRedeemName").textContent = `${data.fullName || ""} · ${data.studentNumber || ""}`;
    document.getElementById("staffRedeemId").textContent = passId;
    document.getElementById("staffRedeemStamps").textContent = enough
      ? `${filled} / ${goal} stamps · ready to spin the wheel`
      : `${filled} / ${goal} stamps · ${goal - filled} more to go`;
    const confirm = document.getElementById("staffRedeemConfirm");
    const need = document.getElementById("staffRedeemNeed");
    if (confirm) {
      confirm.disabled = !enough;
      confirm.setAttribute("aria-disabled", String(!enough));
      confirm.dataset.studentNumber = enough ? data.studentNumber : "";
      confirm.dataset.fullName = data.fullName || "";
      if (need) {
        need.hidden = enough;
        need.textContent = enough ? "" : `Needs ${goal}/${goal} stamps`;
        if (!enough) confirm.setAttribute("aria-describedby", "staffRedeemNeed");
        else confirm.removeAttribute("aria-describedby");
      }
    }
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
    const usedErr = document.getElementById("staffUsedError");
    if (usedErr) {
      usedErr.hidden = true;
      usedErr.textContent = "";
    }
    const undo = document.getElementById("staffRedeemUndo");
    if (undo) {
      const at = data.redeemedAt ? new Date(data.redeemedAt).getTime() : (data.allowUndo ? Date.now() : 0);
      const open = Number.isFinite(at) && at > 0 && Date.now() - at < 2 * 60 * 1000;
      undo.hidden = !open;
      undo.disabled = false;
      undo.textContent = "Undo redeem";
      undo.dataset.studentNumber = open ? data.studentNumber || "" : "";
      undo.dataset.fullName = open ? data.fullName || "" : "";
    }
  }

  let redeemLookupSeq = 0;

  document.getElementById("staffRedeemLookupForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const seq = ++redeemLookupSeq;
    const err = document.getElementById("staffRedeemError");
    const ready = document.getElementById("staffRedeemReady");
    const used = document.getElementById("staffRedeemUsed");
    const submit = document.getElementById("staffRedeemLookup");
    if (err) {
      err.hidden = true;
      err.textContent = "";
    }
    if (ready) ready.hidden = true;
    if (used) used.hidden = true;
    setBusy(submit, true, "Looking up…");
    const input = document.getElementById("redeemStudentNumber");
    try {
      const data = await lookupStudent(input.value);
      if (seq !== redeemLookupSeq) return;
      const filled = typeof data.stampCount === "number" ? data.stampCount : stampCount(data.stamps || {});
      const passId = data.passId || `SP-FP-${data.studentNumber}`;
      if (isPassRedeemed(data.redeemedAt)) {
        showStaffUsedPass({ ...data, passId });
        return;
      }
      showStaffRedeemReady({ ...data, passId }, filled);
    } catch (error) {
      if (seq !== redeemLookupSeq) return;
      pushStaffLog("Redeem lookup", error);
      if (err) {
        err.hidden = false;
        err.textContent = staffDeskError(error);
      }
    } finally {
      if (seq === redeemLookupSeq) setBusy(submit, false);
    }
  });

  document.getElementById("staffRedeemConfirm")?.addEventListener("click", async () => {
    const btn = document.getElementById("staffRedeemConfirm");
    const err = document.getElementById("staffRedeemError");
    const studentNumber = btn?.dataset.studentNumber;
    const fullName = btn?.dataset.fullName || "";
    if (!studentNumber || !btn || btn.disabled) return;
    const who = fullName ? `${fullName} (${studentNumber})` : studentNumber;
    if (!window.confirm(`Mark the wheel ticket as used for ${who}? Only do this once they've spun.`)) return;
    setBusy(btn, true, "Marking…");
    try {
      const result = await redeemPass(studentNumber);
      showStaffUsedPass({ ...result, allowUndo: !result.already });
      logStaffAction(result.already ? "Already redeemed" : "Wheel ticket redeemed", `${result.fullName || fullName} · ${result.studentNumber || studentNumber}`);
      noteStaffChange();
      if (getStudentSession()?.payload.studentNumber === result.studentNumber) {
        await renderStamps({ refresh: true });
      }
    } catch (error) {
      pushStaffLog("Redeem wheel ticket", error);
      if (error && error.code === "needs_stamps") {
        showStaffRedeemReady({ studentNumber, fullName }, Number(error.stampCount) || 0);
        const readyErr = document.getElementById("staffRedeemReadyError");
        if (readyErr) {
          readyErr.hidden = false;
          readyErr.textContent = staffDeskError(error);
        }
      } else {
        resetStaffRedeemView();
        if (err) {
          err.hidden = false;
          err.textContent = staffDeskError(error);
        }
      }
    } finally {
      setBusy(btn, false);
    }
  });

  document.getElementById("staffRedeemUndo")?.addEventListener("click", async () => {
    const undo = document.getElementById("staffRedeemUndo");
    const err = document.getElementById("staffUsedError");
    const studentNumber = undo?.dataset.studentNumber;
    const fullName = undo?.dataset.fullName || "";
    if (!undo || !studentNumber) return;
    const who = fullName ? `${fullName} (${studentNumber})` : studentNumber;
    if (!window.confirm(`Undo the redeem for ${who}? The ticket will be usable again.`)) return;
    setBusy(undo, true, "Undoing…");
    try {
      const result = await unredeemPass(studentNumber);
      const lookup = await lookupStudent(studentNumber);
      if (isPassRedeemed(lookup.redeemedAt)) {
        throw new Error("Undo did not clear the ticket. It is still marked used.");
      }
      setBusy(undo, false);
      const filled = typeof lookup.stampCount === "number" ? lookup.stampCount : stampCount(lookup.stamps || {});
      showStaffRedeemReady({ ...lookup, fullName: result.fullName || lookup.fullName || fullName, passId: result.passId }, filled);
      logStaffAction("Redeem undone", `${result.fullName || fullName} · ${result.studentNumber || studentNumber}`);
      noteStaffChange();
      if (getStudentSession()?.payload.studentNumber === (result.studentNumber || studentNumber)) {
        await renderStamps({ refresh: true });
      }
    } catch (error) {
      setBusy(undo, false);
      pushStaffLog("Undo redeem", error);
      if (err) {
        err.hidden = false;
        err.textContent = staffDeskError(error);
      }
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

  document.getElementById("adminLock")?.addEventListener("click", async () => {
    stopOpsRefresh();
    try {
      await clearAdminSession();
    } catch {
      /* the local session is gone either way */
    }
    updateNav();
    setView(getStudentSession() ? "admin" : "login");
    showWaitToast("Staff locked", "Staff tools are closed on this device.", false);
  });

  els.adminTable?.addEventListener("click", (event) => {
    const tr = event.target.closest("[data-admin-row]");
    if (!tr) return;
    const adjust = event.target.closest("[data-adjust]");
    if (adjust) {
      const input = tr.querySelector("[data-wait-input]");
      input.value = Math.max(0, Math.min(WAIT_MAX, Number(input.value) + Number(adjust.dataset.adjust)));
      const patch = readAdminRow(tr);
      scheduleWaitSave(patch.id, { wait_minutes: patch.wait_minutes });
    }
    const publish = event.target.closest("[data-publish-one]");
    if (publish && !publish.classList.contains("is-busy")) {
      const patch = readAdminRow(tr);
      setBusy(publish, true, "Saving…");
      persistHouse(patch.id, { wait_minutes: patch.wait_minutes }).finally(() => setBusy(publish, false));
    }
  });

  els.adminTable?.addEventListener("input", (event) => {
    if (!event.target.matches("[data-wait-input]")) return;
    const tr = event.target.closest("[data-admin-row]");
    if (tr) readAdminRow(tr);
  });

  els.adminTable?.addEventListener("change", (event) => {
    const tr = event.target.closest("[data-admin-row]");
    if (!tr || !event.target.matches("[data-wait-input]")) return;
    const patch = readAdminRow(tr);
    scheduleWaitSave(patch.id, { wait_minutes: patch.wait_minutes });
  });

  els.publishAll?.addEventListener("click", async () => {
    if (els.publishAll.classList.contains("is-busy")) return;
    setBusy(els.publishAll, true, "Publishing…");
    try {
      const results = await Promise.all(
        [...els.adminTable.querySelectorAll("[data-admin-row]")].map((tr) => {
          const patch = readAdminRow(tr);
          return persistHouse(patch.id, { wait_minutes: patch.wait_minutes });
        })
      );
      const failed = results.find((r) => r && r.ok === false);
      if (failed) setWaitSaveStatus(failed.error || "Could not save wait times to the database.");
    } finally {
      setBusy(els.publishAll, false);
    }
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
      if (staffTab === "ops") startOpsRefresh();
      else stopOpsRefresh();
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

  function stampRecord(stamps, boothId) {
    const map = stamps || {};
    return map[boothId] || map[String(boothId)] || map[Number(boothId)] || null;
  }

  function resetAwardView() {
    const form = document.getElementById("awardStampForm");
    const ready = document.getElementById("awardStampReady");
    const done = document.getElementById("awardStampDone");
    if (form) form.hidden = false;
    if (ready) ready.hidden = true;
    if (done) done.hidden = true;
    if (els.awardStampError) {
      els.awardStampError.hidden = true;
      els.awardStampError.textContent = "";
    }
  }

  function showAwardReady(data, booth) {
    const form = document.getElementById("awardStampForm");
    const ready = document.getElementById("awardStampReady");
    const done = document.getElementById("awardStampDone");
    if (form) form.hidden = true;
    if (done) done.hidden = true;
    if (ready) ready.hidden = false;
    const boothName = booth?.name || "Booth";
    document.getElementById("awardReadyBooth").textContent = boothName;
    document.getElementById("awardReadyName").textContent = `${data.fullName || ""} · ${data.studentNumber || ""}`;
    document.getElementById("awardReadyId").textContent = data.passId || `SP-FP-${data.studentNumber || ""}`;
    document.getElementById("awardReadyNote").textContent = `Does not have the ${boothName} stamp yet.`;
    const confirm = document.getElementById("awardStampConfirm");
    if (confirm) {
      confirm.disabled = false;
      confirm.textContent = `Award ${boothName}`;
      confirm.dataset.studentNumber = data.studentNumber || "";
      confirm.dataset.fullName = data.fullName || "";
      confirm.dataset.boothId = booth?.id || "";
      confirm.dataset.boothName = boothName;
    }
  }

  function showAwardDone(data, booth, opts = {}) {
    const form = document.getElementById("awardStampForm");
    const ready = document.getElementById("awardStampReady");
    const done = document.getElementById("awardStampDone");
    if (form) form.hidden = true;
    if (ready) ready.hidden = true;
    if (done) done.hidden = false;
    const boothName = data.boothName || booth?.name || "Booth";
    const boothId = String(data.boothId || data.awarded || booth?.id || "");
    document.getElementById("awardDoneBooth").textContent = boothName;
    document.getElementById("awardDoneName").textContent = `${data.fullName || ""} · ${data.studentNumber || ""}`;
    document.getElementById("awardDoneId").textContent = data.passId || `SP-FP-${data.studentNumber || ""}`;
    const stamp = stampRecord(data.stamps, boothId);
    const at = Number(stamp && stamp.at) || (opts.allowUndo ? Date.now() : 0);
    const open = Number.isFinite(at) && at > 0 && Date.now() - at < 2 * 60 * 1000;
    document.getElementById("awardDoneNote").textContent = open
      ? `${boothName} is on this card. You can undo it for two minutes.`
      : `${boothName} is already on this card.`;
    const doneErr = document.getElementById("awardDoneError");
    if (doneErr) {
      doneErr.hidden = true;
      doneErr.textContent = "";
    }
    const undo = document.getElementById("awardStampUndo");
    if (undo) {
      undo.hidden = !open;
      undo.disabled = false;
      undo.textContent = "Undo stamp";
      undo.dataset.studentNumber = open ? data.studentNumber || "" : "";
      undo.dataset.fullName = open ? data.fullName || "" : "";
      undo.dataset.boothId = open ? boothId : "";
      undo.dataset.boothName = open ? boothName : "";
    }
  }

  let awardSeq = 0;
  els.awardStampForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const seq = ++awardSeq;
    if (els.awardStampError) {
      els.awardStampError.hidden = true;
      els.awardStampError.textContent = "";
    }
    const submit = document.getElementById("awardStampSubmit") || els.awardStampForm.querySelector("button[type=submit]");
    const ready = document.getElementById("awardStampReady");
    const done = document.getElementById("awardStampDone");
    if (ready) ready.hidden = true;
    if (done) done.hidden = true;
    setBusy(submit, true, "Looking up…");
    const booth = boothById(els.awardBooth.value);
    try {
      const data = await lookupStudent(document.getElementById("awardStudentNumber").value);
      if (seq !== awardSeq) return;
      if (stampRecord(data.stamps, booth?.id)) showAwardDone(data, booth);
      else showAwardReady(data, booth);
    } catch (error) {
      if (seq !== awardSeq) return;
      pushStaffLog("Award lookup", error);
      if (els.awardStampError) {
        els.awardStampError.hidden = false;
        els.awardStampError.textContent = staffDeskError(error);
      }
    } finally {
      setBusy(submit, false);
    }
  });

  document.getElementById("awardStampConfirm")?.addEventListener("click", async () => {
    const btn = document.getElementById("awardStampConfirm");
    const studentNumber = btn?.dataset.studentNumber;
    const fullName = btn?.dataset.fullName || "";
    const boothId = btn?.dataset.boothId;
    if (!btn || !studentNumber || !boothId || btn.classList.contains("is-busy")) return;
    const seq = ++awardSeq;
    setBusy(btn, true, "Stamping…");
    try {
      const result = await awardStamp(studentNumber, boothId);
      if (seq !== awardSeq) return;
      const booth = boothById(boothId);
      showAwardDone({ ...result, fullName: result.fullName || fullName, passId: `SP-FP-${result.studentNumber || studentNumber}` }, booth, { allowUndo: !result.already });
      logStaffAction(result.already ? "Already stamped" : "Stamp awarded", `${booth?.name || "Booth"} · ${result.fullName || fullName} · ${result.studentNumber || studentNumber}`);
      noteStaffChange();
      if (getStudentSession()?.payload.studentNumber === result.studentNumber) {
        await renderStamps({ refresh: true });
      }
    } catch (error) {
      if (seq !== awardSeq) return;
      resetAwardView();
      pushStaffLog("Award stamp", error);
      if (els.awardStampError) {
        els.awardStampError.hidden = false;
        els.awardStampError.textContent = staffDeskError(error);
      }
    } finally {
      setBusy(btn, false);
    }
  });

  document.getElementById("awardStampUndo")?.addEventListener("click", async () => {
    const undo = document.getElementById("awardStampUndo");
    const err = document.getElementById("awardDoneError");
    const studentNumber = undo?.dataset.studentNumber;
    const fullName = undo?.dataset.fullName || "";
    const boothId = undo?.dataset.boothId;
    const boothName = undo?.dataset.boothName || "this booth";
    if (!undo || !studentNumber || !boothId) return;
    const who = fullName ? `${fullName} (${studentNumber})` : studentNumber;
    if (!window.confirm(`Remove the ${boothName} stamp from ${who}?`)) return;
    setBusy(undo, true, "Undoing…");
    try {
      const result = await unawardStamp(studentNumber, boothId);
      const lookup = await lookupStudent(studentNumber);
      if (stampRecord(lookup.stamps, boothId)) {
        throw new Error("Undo did not remove the stamp.");
      }
      setBusy(undo, false);
      showAwardReady({ ...lookup, fullName: result.fullName || lookup.fullName || fullName }, boothById(boothId));
      logStaffAction("Stamp undone", `${boothName} · ${result.fullName || fullName} · ${studentNumber}`);
      noteStaffChange();
      if (getStudentSession()?.payload.studentNumber === (result.studentNumber || studentNumber)) {
        await renderStamps({ refresh: true });
      }
    } catch (error) {
      setBusy(undo, false);
      pushStaffLog("Undo stamp", error);
      if (err) {
        err.hidden = false;
        err.textContent = staffDeskError(error);
      }
    }
  });

  document.querySelectorAll("[data-award-reset]").forEach((btn) => {
    btn.addEventListener("click", () => {
      resetAwardView();
      const input = document.getElementById("awardStudentNumber");
      if (input) {
        input.value = "";
        input.focus();
      }
    });
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
      await loadPublicAnnouncements({ fresh: true });
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
      await loadPublicAnnouncements({ fresh: true });
    } catch (error) {
      if (els.announceError) {
        els.announceError.hidden = false;
        els.announceError.textContent = userFacingError(error, "Could not save that announcement. Try again.");
      }
    }
  });

  fillFeedbackTargets();
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) stampWatch.start();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      const open = document.querySelector(".modal:not([hidden])");
      if (open) closeModals({ restore: true, force: true });
    }
  });
  window.addEventListener("online", () => {
    paintWaitBanner();
    stampWatch.start();
  });
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

function paintConnectionUi(mode) {
  const live = mode === "live" || Boolean(store?.getSync?.().liveOk);
  const accounts = Boolean(window.HALLOWEEN_CONFIG && window.HALLOWEEN_CONFIG.studentLogin);
  if (els.liveMode) {
    els.liveMode.textContent = live ? (accounts ? "Live" : "Live · waits only") : "Demo";
    els.liveMode.classList.toggle("is-live", live);
    paintLiveChip();
  }
  if (!els.dbBanner) return;
  if (live) {
    els.dbBanner.hidden = true;
    els.dbBanner.textContent = "";
    return;
  }
  els.dbBanner.hidden = false;
  els.dbBanner.classList.remove("is-live");
  els.dbBanner.textContent = "DEMO MODE. Changes stay on this device.";
}

function onStoreChange(next, sync) {
  const normalized = (next || []).filter((row) => !RETIRED_HOUSES[row?.id]).map(normalizeHouseRow);
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

/** Sticky offsets follow the real header height (it grows by the safe-area inset in home-screen mode). */
function watchHeaderHeight() {
  const header = document.querySelector(".site-header");
  if (!header) return;
  const root = document.documentElement;
  const apply = () => {
    if (getComputedStyle(header).position === "sticky") root.style.setProperty("--nav-h", `${Math.round(header.getBoundingClientRect().height)}px`);
    else root.style.removeProperty("--nav-h");
  };
  apply();
  if (typeof ResizeObserver === "function") new ResizeObserver(apply).observe(header);
  window.addEventListener("resize", apply);
}

/** iOS Safari can leave fixed/sticky bars offset after the keyboard closes; a 1px scroll nudge re-anchors them. */
function reanchorAfterKeyboard() {
  if (!/iP(hone|ad|od)/.test(navigator.userAgent) && !(navigator.maxTouchPoints > 1 && /Mac/.test(navigator.platform))) return;
  document.addEventListener("focusout", (e) => {
    if (!e.target || !e.target.matches || !e.target.matches("input, textarea, select")) return;
    setTimeout(() => {
      const el = document.activeElement;
      if (el && el.matches && el.matches("input, textarea, select")) return;
      if (document.documentElement.classList.contains("is-scroll-locked")) return;
      const y = window.scrollY;
      window.scrollTo(window.scrollX, y + 1);
      window.scrollTo(window.scrollX, y);
    }, 350);
  });
}

async function init() {
  watchHeaderHeight();
  reanchorAfterKeyboard();
  watchStyleVars();
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
  import("./games.js?v=21e51c2e51")
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
  resumePushIfWanted(pushWatchList(readNight().watch))
    .catch(() => {})
    .then(() => reconcileWatchState())
    .catch(() => {});
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
  // No data polling here: this only refreshes "x min ago" labels from what is already loaded.
  window.setInterval(() => {
    if (document.hidden) return;
    repaintAnnouncements();
    if (document.querySelector(".view.is-active")?.dataset.view === "map") renderTimeline();
  }, 20000);
  subscribeVersions({
    onChange(key, value) {
      if (key === "announce_v") loadPublicAnnouncements({ v: value });
    },
    onOk() {
      if (announceDirty) loadPublicAnnouncements();
    },
  });
  window.addEventListener("offline", () => paintWaitBanner());
  window.addEventListener("online", () => {
    paintWaitBanner();
    if (store?.refresh) store.refresh();
  });

  await (window.loadHalloweenConfig ? window.loadHalloweenConfig() : Promise.resolve());

  store = createStore(onStoreChange);
  const connected = store.connect();
  const connectWait = new Promise((resolve) => setTimeout(() => resolve({ mode: "local", error: "Connection timed out." }), 12000));
  const { mode } = await Promise.race([connected, connectWait]);
  paintConnectionUi(mode);
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
