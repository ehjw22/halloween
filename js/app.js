import { HOUSES, STATUSES } from "./houses.js";
import { BOOTHS, boothById } from "./booths.js";
import { EVENT_DATE_LABEL, SCHEDULE, scheduleStatus } from "./schedule.js";
import { createStore } from "./store.js";
import {
  awardStamp,
  clearAdminSession,
  clearStudentSession,
  fetchAnnouncements,
  fetchFeedback,
  fetchStamps,
  getAdminSession,
  getStudentSession,
  postAnnouncement,
  redeemPass,
  setAnnouncementActive,
  signIn,
  submitFeedback,
  normalizeAdminNumber,
} from "./session.js";

let setGamesVisible = () => {};

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
  mapWorld: document.getElementById("mapWorld"),
  mapViewport: document.getElementById("mapViewport"),
  mapPins: document.getElementById("mapPins"),
  zoomLabel: document.getElementById("zoomLabel"),
  liveMode: document.getElementById("liveMode"),
  modal: document.getElementById("detailModal"),
  stampGrid: document.getElementById("stampGrid"),
  stampRoadmap: document.getElementById("stampRoadmap"),
  passBack: document.getElementById("passBack"),
  stampModal: document.getElementById("stampModal"),
  boothModal: document.getElementById("boothModal"),
  stampForm: document.getElementById("stampForm"),
  stampBy: document.getElementById("stampBy"),
  stampPass: document.getElementById("stampPass"),
  stampError: document.getElementById("stampError"),
  stampHolderName: document.getElementById("stampHolderName"),
  stampHolderId: document.getElementById("stampHolderId"),
  stampFill: document.getElementById("stampFill"),
  stampProgress: document.getElementById("stampProgress"),
  stampView: document.getElementById("stampCardPanel"),
  passView: document.getElementById("fastPassPanel"),
  passToggle: document.getElementById("passToggle"),
  qrCanvas: document.getElementById("qrCanvas"),
  passId: document.getElementById("passId"),
  adminGate: document.getElementById("adminGate"),
  adminApp: document.getElementById("adminApp"),
  adminForm: document.getElementById("adminPassForm"),
  adminTable: document.getElementById("adminTable"),
  autoSave: document.getElementById("autoSave"),
  publishAll: document.getElementById("publishAll"),
  dbBanner: document.getElementById("dbBanner"),
  studentAuth: document.getElementById("studentAuth"),
  studentAuthForm: document.getElementById("studentAuthForm"),
  studentAuthError: document.getElementById("studentAuthError"),
  stampApp: document.getElementById("stampApp"),
  sessionChip: document.getElementById("sessionChip"),
  passHolder: document.getElementById("passHolder"),
  passKicker: document.getElementById("passKicker"),
  redeemOpen: document.getElementById("redeemOpen"),
  redeemedNote: document.getElementById("redeemedNote"),
  redeemModal: document.getElementById("redeemModal"),
  redeemForm: document.getElementById("redeemForm"),
  redeemError: document.getElementById("redeemError"),
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
let showPass = false;
let autoSave = true;
let cardState = { stamps: {}, redeemedAt: null, redeemedBy: null, fullName: "", studentNumber: "", passId: "" };
const drafts = new Map();

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

function setView(name) {
  const student = getStudentSession();
  const admin = getAdminSession();
  if (name === "admin" && !admin) name = "login";
  if (name === "login" && admin) name = "admin";
  else if (name === "login" && student) name = "stamps";
  els.views.forEach((view) => {
    const active = view.dataset.view === name;
    view.classList.toggle("is-active", active);
    view.hidden = !active;
  });
  els.navButtons.forEach((btn) => btn.classList.toggle("is-active", btn.dataset.nav === name));
  setGamesVisible(name === "games");
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
    requestAnimationFrame(() => fitMap());
  }
}

function renderDashboard() {
  els.houseGrid.innerHTML = houses
    .map((row) => {
      const meta = houseMeta(row.id);
      return `
        <button class="house-card status-${row.status}" type="button" data-open-house="${escapeHtml(row.id)}">
          <span class="house-card__short">${escapeHtml(meta?.short || "")}</span>
          <strong>${escapeHtml(row.name)}</strong>
          <span class="status-pill">${STATUS_LABEL[row.status] || row.status}</span>
          <span class="wait">${waitLabel(row.wait_minutes, row.status)}</span>
        </button>`;
    })
    .join("");
}

function renderPins() {
  if (!els.mapPins) return;
  els.mapPins.innerHTML = HOUSES.map((house) => {
    const row = houses.find((h) => h.id === house.id) || house;
    const status = row.status || house.status;
    return `
      <button class="map-pin status-${status}" type="button" style="left:${house.x}%; top:${house.y}%"
        data-open-house="${house.id}" aria-label="${house.name}">
        <span class="map-pin__dot"></span>
        <span class="map-pin__name">${house.short}</span>
      </button>`;
  }).join("");
}

function applyMapTransform() {
  if (!els.mapWorld) return;
  els.mapWorld.style.transform = `translate(${mapState.x}px, ${mapState.y}px) scale(${mapState.scale})`;
  els.mapWorld.style.setProperty("--map-scale", String(mapState.scale || 1));
  if (els.zoomLabel) els.zoomLabel.textContent = `${Math.round(mapState.scale * 100)}%`;
}

function sizeMapWorld() {
  const img = els.mapWorld?.querySelector("img");
  if (!img?.naturalWidth || !els.mapWorld) return;
  els.mapWorld.style.width = `${img.naturalWidth}px`;
  els.mapWorld.style.height = `${img.naturalHeight}px`;
}

function fitMap() {
  const img = els.mapWorld?.querySelector("img");
  if (!img || !els.mapViewport) return;
  sizeMapWorld();
  const vp = els.mapViewport.getBoundingClientRect();
  const w = img.naturalWidth || img.clientWidth || 1600;
  const h = img.naturalHeight || img.clientHeight || 900;
  if (!vp.width || !vp.height || !w || !h) return;
  const fit = Math.min(vp.width / w, vp.height / h);
  mapState.min = fit * 0.85;
  mapState.max = Math.max(2.4, fit * 6);
  mapState.scale = Math.min(mapState.max, Math.max(fit * 1.75, fit * 1.2));
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
  if (!meta || !row) return;
  els.modal.querySelector("[data-modal-title]").textContent = meta.name;
  els.modal.querySelector("[data-modal-wait]").textContent = waitLabel(row.wait_minutes, row.status);
  els.modal.querySelector("[data-modal-status]").textContent = STATUS_LABEL[row.status];
  els.modal.querySelector("[data-modal-status]").className = `status-pill status-${row.status}`;
  els.modal.querySelector("[data-modal-story]").textContent = meta.story;
  els.modal.querySelector("[data-modal-code]").textContent = meta.short;
  els.modal.hidden = false;
  els.modal.querySelector(".modal__panel").focus();
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
  if (els.stampModal) els.stampModal.hidden = true;
  if (els.redeemModal) els.redeemModal.hidden = true;
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
    return;
  }
  if (student) {
    els.sessionChip.hidden = false;
    els.sessionChip.innerHTML = `<span>${escapeHtml(student.payload.name)}</span><button type="button" data-logout="student">Log out</button>`;
    return;
  }
  if (admin) {
    els.sessionChip.hidden = false;
    els.sessionChip.innerHTML = `<span>Staff · ${escapeHtml(admin.payload.name || admin.payload.staffId)}</span><button type="button" data-logout="admin">Log out</button>`;
    return;
  }
  els.sessionChip.hidden = true;
  els.sessionChip.innerHTML = "";
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

let lastQr = "";

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
  const sessionName = cardState.fullName || session.payload.name;
  const sessionNum = cardState.studentNumber || session.payload.studentNumber;
  if (els.stampHolderName) els.stampHolderName.textContent = sessionName || "Student";
  if (els.stampHolderId) els.stampHolderId.textContent = sessionNum || "";
  els.stampProgress.textContent = `${filled} / 6 checkpoints`;
  if (els.stampFill) {
    const offset = 100 - (filled / 6) * 100;
    els.stampFill.style.strokeDashoffset = String(offset);
  }
  els.stampGrid.innerHTML = STAMP_SLOTS.map((slot) => {
    const stamped = stamps[slot.id] || stamps[String(slot.id)];
    return `
      <button class="stamp-slot ${stamped ? "is-stamped" : ""}" type="button" data-stamp="${slot.id}">
        <span class="stamp-slot__seal" aria-hidden="true">${slot.icon}</span>
        <span class="stamp-slot__index">0${slot.id}</span>
        <strong>${slot.label}</strong>
        <small>${stamped ? `Collected · ${escapeHtml(stamped.by || "")}` : "Tap for booth info"}</small>
      </button>`;
  }).join("");

  if (els.stampRoadmap) {
    els.stampRoadmap.innerHTML = STAMP_SLOTS.map((slot, index) => {
      const stamped = stamps[slot.id] || stamps[String(slot.id)];
      const nextUp = !stamped && STAMP_SLOTS.slice(0, index).every((s) => stamps[s.id] || stamps[String(s.id)]);
      const state = stamped ? "is-done" : nextUp ? "is-next" : "";
      return `
        <li class="roadmap__stop ${state}">
          <button class="roadmap__node" type="button" data-stamp="${slot.id}">
            <span class="roadmap__icon">${slot.icon}</span>
            <span class="roadmap__num">${index + 1}</span>
            <strong>${slot.label}</strong>
            <small>${stamped ? `Stamped · ${escapeHtml(stamped.by || "")}` : "Visit this booth"}</small>
          </button>
        </li>`;
    }).join("");
  }

  const complete = filled === 6;
  els.passToggle.hidden = !complete;
  if (els.passHolder) {
    els.passHolder.textContent = `${cardState.fullName || session.payload.name} · ${cardState.studentNumber || session.payload.studentNumber}`;
  }
  if (complete && showPass) {
    els.stampView.hidden = true;
    els.passView.hidden = false;
    els.passToggle.textContent = "Review stamp card";
    els.passId.textContent = cardState.passId;
    if (cardState.passId && cardState.passId !== lastQr) {
      lastQr = cardState.passId;
      drawQr(cardState.passId);
    }
    const redeemed = Boolean(cardState.redeemedAt);
    els.fastPassCard.classList.toggle("is-redeemed", redeemed);
    els.passKicker.textContent = redeemed ? "Redeemed" : "Unlocked";
    els.redeemOpen.hidden = redeemed;
    els.redeemedNote.hidden = !redeemed;
    if (redeemed) {
      const when = new Date(cardState.redeemedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      els.redeemedNote.textContent = `Redeemed at ${when}${cardState.redeemedBy ? ` by ${cardState.redeemedBy}` : ""}.`;
    }
  } else {
    els.stampView.hidden = false;
    els.passView.hidden = true;
    els.passToggle.textContent = complete ? "Show Fast Pass" : "Show Fast Pass";
    if (!complete) els.passToggle.hidden = true;
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
    els.adminFeedbackList.innerHTML = rows.length
      ? rows.map((row) => {
        const when = row.created_at ? new Date(row.created_at).toLocaleString() : "";
        const who = row.student_number ? escapeHtml(row.student_number) : "Visitor";
        return `<li class="feedback-item">
          <p><strong>${escapeHtml(feedbackLabel(row))}</strong> · ${row.kind === "booth" ? "Booth" : "Scare house"}</p>
          <p>${escapeHtml(row.message)}</p>
          <p class="muted">${who} · ${escapeHtml(when)}</p>
        </li>`;
      }).join("")
      : "<li class='muted'>No feedback yet.</li>";
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
    const tag = state === "live" ? "Now" : state === "done" ? "Done" : "Next";
    return `<li class="night-stop is-${state}">
      <time>${item.start}–${item.end}</time>
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
  else if (sec < 3600) ago = `${Math.floor(sec / 60)} min ago`;
  else if (sec < 5400) ago = "1 hour ago";
  else if (sec < 86400) ago = `${Math.floor(sec / 3600)} hours ago`;
  else if (sec < 172800) ago = "1 day ago";
  else ago = `${Math.floor(sec / 86400)} days ago`;
  return { clock, ago };
}

function announceItemHtml(row) {
  const { clock, ago } = formatPostedAt(row.created_at);
  const when = [clock, ago].filter(Boolean).join(" · ");
  return `<li class="announce-item">
    <p class="announce-item__label">Staff announcement</p>
    <p class="announce-item__when">${escapeHtml(when)}</p>
    <p class="announce-item__body">${escapeHtml(row.message)}</p>
  </li>`;
}

async function loadPublicAnnouncements() {
  const rows = await fetchAnnouncements().catch(() => []);
  const empty = "<li class='muted'>No staff announcements yet.</li>";
  const html = rows.length ? rows.map(announceItemHtml).join("") : empty;
  if (els.announceStrip) els.announceStrip.innerHTML = html;
  if (els.announceList) els.announceList.innerHTML = html;
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
          <p class="muted">${escapeHtml(row.posted_by || "Staff")} · Posted ${escapeHtml(clock)}${ago ? ` · ${escapeHtml(ago)}` : ""} · ${posted ? "Showing" : "Taken down"}</p>
          ${posted ? `<button class="btn btn--ghost" type="button" data-announce-off="${escapeHtml(row.id)}">Take down</button>` : ""}
        </li>`;
      }).join("")
      : "<li class='muted'>No announcements yet.</li>";
  } catch (error) {
    els.adminAnnounceList.innerHTML = `<li class="form-error">${escapeHtml(error.message)}</li>`;
  }
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
              <button type="button" data-adjust="-5">−5</button>
              <input type="number" min="0" step="1" value="${draft.wait_minutes}" data-wait-input>
              <button type="button" data-adjust="5">+5</button>
            </div>
          </td>
          <td>
            <select data-status>${options}</select>
          </td>
          <td>
        </tr>`;
    })
    .join("");
  if (els.awardBooth && !els.awardBooth.dataset.filled) {
    els.awardBooth.innerHTML = BOOTHS.map((b) => `<option value="${b.id}">${b.name}</option>`).join("");
    els.awardBooth.dataset.filled = "1";
  }
  document.querySelectorAll("[data-staff-tab]").forEach((btn) => {
    btn.classList.toggle("is-active", btn.dataset.staffTab === staffTab);
  });
  document.querySelectorAll("[data-staff-panel]").forEach((panel) => {
    panel.hidden = panel.dataset.staffPanel !== staffTab;
  });
}

async function drawQr(text) {
  if (!els.qrCanvas) return;
  if (typeof QRCode !== "undefined" && QRCode.toCanvas) {
    await QRCode.toCanvas(els.qrCanvas, text, {
      width: 196,
      margin: 1,
      color: { dark: "#14080c", light: "#fff4d6" },
    });
    return;
  }
  const ctx = els.qrCanvas.getContext("2d");
  const size = 196;
  els.qrCanvas.width = size;
  els.qrCanvas.height = size;
  ctx.fillStyle = "#fff4d6";
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = "#14080c";
  let n = 0;
  for (const ch of text) n = (n * 33 + ch.charCodeAt(0)) >>> 0;
  const cells = 21;
  const cell = Math.floor(size / cells);
  for (let y = 0; y < cells; y += 1) {
    for (let x = 0; x < cells; x += 1) {
      const bit = ((n >> ((x * 3 + y) % 24)) ^ (x * 17 + y * 13)) & 1;
      const finder = (x < 7 && y < 7) || (x > 13 && y < 7) || (x < 7 && y > 13);
      if (bit || finder) ctx.fillRect(x * cell, y * cell, cell, cell);
    }
  }
}

function readAdminRow(tr) {
  const id = tr.dataset.adminRow;
  const wait = Math.max(0, Number(tr.querySelector("[data-wait-input]").value) || 0);
  const status = tr.querySelector("[data-status]").value;
  drafts.set(id, { wait_minutes: wait, status });
  return { id, wait_minutes: wait, status };
}

function maybePublish(id, patch) {
  drafts.set(id, patch);
  if (autoSave) store.publish(id, patch, { persist: true });
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
  window.addEventListener("resize", fitMap);
  const img = els.mapWorld.querySelector("img");
  if (img?.complete) fitMap();
  else img?.addEventListener("load", fitMap, { once: true });
}

function bindUi() {
  els.navButtons.forEach((btn) => {
    btn.addEventListener("click", () => setView(btn.dataset.nav));
  });

  document.body.addEventListener("click", (event) => {
    const jump = event.target.closest("button[data-nav]");
    if (jump && !jump.closest(".nav")) {
      setView(jump.dataset.nav);
      return;
    }
    const houseBtn = event.target.closest("[data-open-house]");
    if (houseBtn) openHouse(houseBtn.dataset.openHouse);

    const stampBtn = event.target.closest("[data-stamp]");
    if (stampBtn) {
      openBooth(stampBtn.dataset.stamp);
    }

    const logout = event.target.closest("[data-logout]");
    if (logout) {
      if (logout.dataset.logout === "student") {
        clearStudentSession();
        cardState = { stamps: {}, redeemedAt: null, redeemedBy: null, fullName: "", studentNumber: "", passId: "" };
        showPass = false;
        updateNav();
        renderStamps();
      } else {
        clearAdminSession();
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
    if (err) err.hidden = true;
    try {
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
      updateNav();
      setView(data.staff ? "admin" : "stamps");
      if (!data.staff) {
        cardState.studentNumber = "";
        await renderStamps({ refresh: true });
      }
    } catch (error) {
      if (err) {
        err.hidden = false;
        err.textContent = error.message;
      }
    }
  }

  document.getElementById("studentLoginForm")?.addEventListener("submit", (event) => handleAuthSubmit(event, { staff: false }));
  document.getElementById("staffLoginForm")?.addEventListener("submit", (event) => handleAuthSubmit(event, { staff: true }));

  els.passToggle?.addEventListener("click", () => {
    showPass = !showPass;
    paintStampUi();
  });
  if (els.passBack) {
    els.passBack.addEventListener("click", () => {
      showPass = false;
      paintStampUi();
    });
  }

  els.redeemOpen?.addEventListener("click", () => {
    els.redeemError.hidden = true;
    els.redeemModal.hidden = false;
    document.getElementById("redeemStaffId").focus();
  });

  els.redeemForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    els.redeemError.hidden = true;
    try {
      const result = await redeemPass(
        document.getElementById("redeemStaffId").value,
        document.getElementById("redeemPasscode").value
      );
      cardState.redeemedAt = result.redeemedAt;
      cardState.redeemedBy = result.redeemedBy;
      closeModals();
      showPass = true;
      paintStampUi();
    } catch (error) {
      els.redeemError.hidden = false;
      els.redeemError.textContent = error.message;
    }
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
      store.publish(patch.id, { wait_minutes: patch.wait_minutes, status: patch.status }, { persist: true });
    }
  });

  els.adminTable?.addEventListener("change", (event) => {
    const tr = event.target.closest("[data-admin-row]");
    if (!tr) return;
    const patch = readAdminRow(tr);
    maybePublish(patch.id, { wait_minutes: patch.wait_minutes, status: patch.status });
  });

  els.publishAll?.addEventListener("click", () => {
    [...els.adminTable.querySelectorAll("[data-admin-row]")].forEach((tr) => {
      const patch = readAdminRow(tr);
      store.publish(patch.id, { wait_minutes: patch.wait_minutes, status: patch.status }, { persist: true });
    });
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
    try {
      const data = await awardStamp(
        document.getElementById("awardStudentNumber").value,
        els.awardBooth.value
      );
      if (els.awardStampOk) {
        els.awardStampOk.hidden = false;
        els.awardStampOk.textContent = `Awarded ${data.boothName} to ${data.fullName} (${data.studentNumber}).`;
      }
      if (getStudentSession()?.payload.studentNumber === data.studentNumber) {
        await renderStamps({ refresh: true });
      }
    } catch (error) {
      if (els.awardStampError) {
        els.awardStampError.hidden = false;
        els.awardStampError.textContent = error.message;
      }
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
        document.getElementById("feedbackMessage").value
      );
      document.getElementById("feedbackMessage").value = "";
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
      await postAnnouncement(document.getElementById("announceMessage").value);
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
}

function onStoreChange(next) {
  houses = next;
  renderDashboard();
  renderPins();
  if (document.querySelector('.view.is-active')?.dataset.view === "admin" && isAdminUnlocked()) {
    const active = document.activeElement;
    if (!active?.matches("[data-wait-input], [data-status]")) renderAdmin();
  }
}

async function init() {
  try {
    bindUi();
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
      games.initGames();
    })
    .catch((error) => console.warn("Games failed to load", error));
  updateNav();
  renderStamps();
  renderAdmin();
  renderTimeline();
  loadPublicAnnouncements();
  window.setInterval(() => {
    if (document.hidden) return;
    loadPublicAnnouncements();
    if (document.querySelector(".view.is-active")?.dataset.view === "tonight") renderTimeline();
  }, 20000);

  const loadConfig = window.loadHalloweenConfig
    ? window.loadHalloweenConfig()
    : Promise.resolve();
  const timeout = new Promise((resolve) => setTimeout(resolve, 4000));
  await Promise.race([loadConfig, timeout]);

  store = createStore(onStoreChange);
  const connected = store.connect();
  const connectWait = new Promise((resolve) => setTimeout(() => resolve({ mode: "local", error: "Connection timed out." }), 6000));
  const { mode, error } = await Promise.race([connected, connectWait]);
  const live = mode === "live";
  const status = window.__CONFIG_STATUS || {};
  els.liveMode.textContent = live ? "Live · Supabase" : "Demo · local sync";
  els.liveMode.classList.toggle("is-live", live);
  if (els.dbBanner) {
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
      ? "Connected to Supabase. Staff edits write to the scare_houses table."
      : `Not writing to the database.${error ? ` ${error}` : ""}${localHint}`;
  }
}

init().catch((error) => {
  console.error(error);
  if (els.liveMode) {
    els.liveMode.textContent = "Demo · local sync";
    els.liveMode.classList.remove("is-live");
  }
});
