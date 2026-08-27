import { HOUSES, STATUSES } from "./houses.js";
import { createStore } from "./store.js";

const STATUS_LABEL = Object.fromEntries(STATUSES.map((s) => [s.id, s.label]));
const STAMP_KEY = "sp-halloween-stamps-v1";
const STAMP_SLOTS = [
  { id: 1, icon: "🎃", label: "Pumpkin Gate" },
  { id: 2, icon: "🦇", label: "Bat Colony" },
  { id: 3, icon: "👻", label: "Plaza Ghost" },
  { id: 4, icon: "🕸️", label: "Web Lab" },
  { id: 5, icon: "🍬", label: "Candy Court" },
  { id: 6, icon: "💀", label: "Crypt Keep" },
];

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
  stampModal: document.getElementById("stampModal"),
  stampForm: document.getElementById("stampForm"),
  stampBy: document.getElementById("stampBy"),
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
};

let store;
let houses = [];
let pendingStampId = null;
let showPass = false;
let adminUnlocked = sessionStorage.getItem("sp-admin") === "1";
let autoSave = true;
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
  els.views.forEach((view) => {
    const active = view.dataset.view === name;
    view.classList.toggle("is-active", active);
    view.hidden = !active;
  });
  els.navButtons.forEach((btn) => btn.classList.toggle("is-active", btn.dataset.nav === name));
  if (name === "admin") renderAdmin();
  if (name === "stamps") renderStamps();
}

function renderDashboard() {
  els.houseGrid.innerHTML = houses
    .map((row) => {
      const meta = houseMeta(row.id);
      return `
        <button class="house-card status-${row.status}" type="button" data-open-house="${row.id}">
          <span class="house-card__short">${meta?.short || ""}</span>
          <strong>${row.name}</strong>
          <span class="status-pill">${STATUS_LABEL[row.status] || row.status}</span>
          <span class="wait">${waitLabel(row.wait_minutes, row.status)}</span>
        </button>`;
    })
    .join("");
}

function renderPins() {
  els.mapPins.innerHTML = HOUSES.map((house) => {
    const row = houses.find((h) => h.id === house.id) || house;
    const status = row.status || house.status;
    return `
      <button class="map-pin status-${status}" type="button" style="left:${house.x}%; top:${house.y}%"
        data-open-house="${house.id}" aria-label="${house.name}">
        <span class="map-pin__dot"></span>
        <span class="map-pin__label">${house.short}</span>
      </button>`;
  }).join("");
}

function applyMapTransform() {
  els.mapWorld.style.transform = `translate(${mapState.x}px, ${mapState.y}px) scale(${mapState.scale})`;
  els.zoomLabel.textContent = `${Math.round(mapState.scale * 100)}%`;
}

function fitMap() {
  const img = els.mapWorld.querySelector("img");
  const vp = els.mapViewport.getBoundingClientRect();
  const w = img.naturalWidth || img.clientWidth || 1600;
  const h = img.naturalHeight || img.clientHeight || 900;
  const fit = Math.min(vp.width / w, vp.height / h);
  mapState.scale = fit;
  mapState.x = (vp.width - w * fit) / 2;
  mapState.y = (vp.height - h * fit) / 2;
  mapState.min = fit * 0.7;
  mapState.max = fit * 4.5;
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

function closeModals() {
  els.modal.hidden = true;
  els.stampModal.hidden = true;
  pendingStampId = null;
}

function loadStamps() {
  try {
    return JSON.parse(localStorage.getItem(STAMP_KEY)) || {};
  } catch {
    return {};
  }
}

function saveStamps(data) {
  localStorage.setItem(STAMP_KEY, JSON.stringify(data));
}

function stampCount() {
  return STAMP_SLOTS.filter((slot) => loadStamps()[slot.id]).length;
}

function passCode() {
  const stamps = loadStamps();
  const seed = STAMP_SLOTS.map((s) => stamps[s.id]?.by || "").join("|");
  let hash = 2166136261;
  for (const ch of seed || "SP-HALLOWEEN") {
    hash ^= ch.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return `SP-FP-${(hash >>> 0).toString(16).toUpperCase().padStart(8, "0")}`;
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

function renderStamps() {
  const stamps = loadStamps();
  const filled = stampCount();
  els.stampProgress.textContent = `${filled} / 6 stamped`;
  els.stampGrid.innerHTML = STAMP_SLOTS.map((slot) => {
    const stamped = stamps[slot.id];
    return `
      <button class="stamp-slot ${stamped ? "is-stamped" : ""}" type="button" data-stamp="${slot.id}">
        <span class="stamp-slot__icon">${slot.icon}</span>
        <strong>${slot.label}</strong>
        <small>${stamped ? `Stamped by ${stamped.by}` : "Tap to stamp"}</small>
      </button>`;
  }).join("");

  const complete = filled === 6;
  els.passToggle.hidden = !complete;
  if (complete && showPass) {
    els.stampView.hidden = true;
    els.passView.hidden = false;
    els.passToggle.textContent = "Review stamp card";
    const code = passCode();
    els.passId.textContent = code;
    drawQr(code);
  } else {
    els.stampView.hidden = false;
    els.passView.hidden = true;
    els.passToggle.textContent = "Show Fast Pass";
    if (complete) showPass = false;
  }
}

function renderAdmin() {
  if (!adminUnlocked) {
    els.adminGate.hidden = false;
    els.adminApp.hidden = true;
    return;
  }
  els.adminGate.hidden = true;
  els.adminApp.hidden = false;

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
            <button class="btn btn--ghost" type="button" data-publish-one>Publish</button>
          </td>
        </tr>`;
    })
    .join("");
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
  vp.addEventListener("wheel", (event) => {
    event.preventDefault();
    const delta = event.deltaY > 0 ? 0.9 : 1.1;
    zoomAt(event.clientX, event.clientY, mapState.scale * delta);
  }, { passive: false });

  vp.addEventListener("pointerdown", (event) => {
    if (event.target.closest(".map-pin")) return;
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

  document.getElementById("zoomIn").addEventListener("click", () => {
    const rect = vp.getBoundingClientRect();
    zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, mapState.scale * 1.2);
  });
  document.getElementById("zoomOut").addEventListener("click", () => {
    const rect = vp.getBoundingClientRect();
    zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, mapState.scale / 1.2);
  });
  document.getElementById("zoomReset").addEventListener("click", resetMap);
  window.addEventListener("resize", fitMap);
  const img = els.mapWorld.querySelector("img");
  if (img.complete) fitMap();
  else img.addEventListener("load", fitMap, { once: true });
}

function bindUi() {
  els.navButtons.forEach((btn) => {
    btn.addEventListener("click", () => setView(btn.dataset.nav));
  });

  document.body.addEventListener("click", (event) => {
    const houseBtn = event.target.closest("[data-open-house]");
    if (houseBtn) openHouse(houseBtn.dataset.openHouse);

    const stampBtn = event.target.closest("[data-stamp]");
    if (stampBtn) {
      const id = Number(stampBtn.dataset.stamp);
      const stamps = loadStamps();
      if (stamps[id]) return;
      pendingStampId = id;
      els.stampBy.value = "";
      els.stampModal.hidden = false;
      els.stampBy.focus();
    }

    if (event.target.closest("[data-close-modal]")) closeModals();
  });

  els.stampForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const by = els.stampBy.value.trim();
    if (!by || pendingStampId == null) return;
    const stamps = loadStamps();
    stamps[pendingStampId] = { by, at: Date.now() };
    saveStamps(stamps);
    closeModals();
    if (stampCount() === 6) showPass = true;
    renderStamps();
  });

  els.passToggle.addEventListener("click", () => {
    showPass = !showPass;
    renderStamps();
  });

  els.adminForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const input = document.getElementById("adminPasscode");
    const expected = window.HALLOWEEN_CONFIG?.adminPasscode || "SP2026";
    if (input.value.trim() === expected) {
      adminUnlocked = true;
      sessionStorage.setItem("sp-admin", "1");
      renderAdmin();
    } else {
      input.setCustomValidity("Incorrect passcode");
      input.reportValidity();
      input.setCustomValidity("");
    }
  });

  document.getElementById("adminLock").addEventListener("click", () => {
    adminUnlocked = false;
    sessionStorage.removeItem("sp-admin");
    renderAdmin();
  });

  els.autoSave.addEventListener("change", () => {
    autoSave = els.autoSave.checked;
  });

  els.adminTable.addEventListener("click", (event) => {
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

  els.adminTable.addEventListener("change", (event) => {
    const tr = event.target.closest("[data-admin-row]");
    if (!tr) return;
    const patch = readAdminRow(tr);
    maybePublish(patch.id, { wait_minutes: patch.wait_minutes, status: patch.status });
  });

  els.publishAll.addEventListener("click", () => {
    [...els.adminTable.querySelectorAll("[data-admin-row]")].forEach((tr) => {
      const patch = readAdminRow(tr);
      store.publish(patch.id, { wait_minutes: patch.wait_minutes, status: patch.status }, { persist: true });
    });
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeModals();
  });
}

function onStoreChange(next) {
  houses = next;
  renderDashboard();
  renderPins();
  if (document.querySelector('.view.is-active')?.dataset.view === "admin" && adminUnlocked) {
    const active = document.activeElement;
    if (!active?.matches("[data-wait-input], [data-status]")) renderAdmin();
  }
}

async function init() {
  bindUi();
  bindMap();
  renderStamps();
  renderAdmin();

  if (typeof window.loadHalloweenConfig === "function") {
    await window.loadHalloweenConfig();
  }

  store = createStore(onStoreChange);
  const { mode, error } = await store.connect();
  const live = mode === "live";
  const status = window.__CONFIG_STATUS || {};
  els.liveMode.textContent = live ? "Live · Supabase" : "Demo · local sync";
  els.liveMode.classList.toggle("is-live", live);
  if (els.dbBanner) {
    els.dbBanner.hidden = false;
    els.dbBanner.classList.toggle("is-live", live);
    const localHint = {
      "no-api": " /api/config is missing. Stop python -m http.server and run: python serve.py after adding a .env (see .env.example). On Vercel, add SUPABASE_URL and SUPABASE_ANON_KEY and redeploy.",
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

init();
