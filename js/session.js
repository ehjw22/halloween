import { boothById } from "./booths.js";

const STUDENT_KEY = "sp-student-jwt";
const ADMIN_KEY = "sp-admin-jwt";
const STUDENT_META = "sp-student-session";
const ADMIN_META = "sp-admin-session";

export function apiUrl(name, params = {}) {
  const q = new URLSearchParams();
  q.set("path", name);
  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null || value === "") return;
    q.set(key, String(value));
  });
  return `/api?${q.toString()}`;
}

export function userFacingError(error, fallback = "Something went wrong. Try again.") {
  const raw = String((error && error.message) || error || "")
    .split(/\s+[—–-]\s+/)[0]
    .replace(/[—–]/g, ", ")
    .replace(/\bHTTP\s*\d{3}\b/gi, "")
    .replace(/\bSupabase\s+\d{3}\b/gi, "")
    .replace(/\bRPC\s+\d{3}\b/gi, "")
    .replace(/\s*[·|]\s*/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
  if (!raw || /^(request failed|not found|internal server error|bad request|unauthorized|forbidden|error)$/i.test(raw)) {
    return fallback;
  }
  return raw;
}

function apiFail(data, res, fallback) {
  const status = res && res.status;
  const err = new Error(userFacingError((data && data.error) || fallback, fallback || "Something went wrong. Try again."));
  err.code = (data && data.code) || "";
  err.status = status || 0;
  return err;
}

function isLoopback() {
  const host = String(window.location.hostname || "").toLowerCase();
  return host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host === "0.0.0.0" || host.endsWith(".localhost");
}

function isBrowserLocal() {
  const host = String(window.location.hostname || "").toLowerCase();
  if (isLoopback()) return true;
  if (/^10\.\d+\.\d+\.\d+$/.test(host)) return true;
  if (/^192\.168\.\d+\.\d+$/.test(host)) return true;
  if (/^172\.(1[6-9]|2\d|3[0-1])\.\d+\.\d+$/.test(host)) return true;
  return false;
}

function decodePayload(token) {
  try {
    const mid = token.split(".")[1];
    if (!mid) return null;
    const padded = mid.replace(/-/g, "+").replace(/_/g, "/");
    const base64 = padded + "=".repeat((4 - (padded.length % 4)) % 4);
    const binary = atob(base64);
    const json = decodeURIComponent(
      [...binary].map((ch) => `%${ch.charCodeAt(0).toString(16).padStart(2, "0")}`).join("")
    );
    return JSON.parse(json);
  } catch {
    return null;
  }
}

function readMeta(key, role) {
  try {
    const payload = JSON.parse(localStorage.getItem(key) || "null");
    if (!payload || payload.role !== role) return null;
    if (!payload.exp || payload.exp * 1000 < Date.now()) {
      localStorage.removeItem(key);
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}

function writeMeta(key, payload) {
  localStorage.setItem(key, JSON.stringify(payload));
}

function readSession(storageKey, metaKey, role) {
  const token = localStorage.getItem(storageKey);
  if (token) {
    const payload = decodePayload(token);
    if (!payload?.exp || payload.exp * 1000 < Date.now()) {
      localStorage.removeItem(storageKey);
    } else if (payload.role === role) {
      return { token, payload };
    }
  }
  const meta = readMeta(metaKey, role);
  if (!meta) return null;
  return { token: "", payload: meta };
}

export function getStudentSession() {
  const session = readSession(STUDENT_KEY, STUDENT_META, "student");
  if (!session || session.payload.role !== "student") return null;
  if (session.payload.local && !isBrowserLocal()) {
    localStorage.removeItem(STUDENT_KEY);
    localStorage.removeItem(STUDENT_META);
    return null;
  }
  const meta = readMeta(STUDENT_META, "student");
  if (meta) {
    session.payload = {
      ...session.payload,
      staffChallenge: Boolean(session.payload.staffChallenge || meta.staffChallenge),
      accountRole: session.payload.accountRole || meta.accountRole,
    };
  }
  return session;
}

export function getAdminSession() {
  const session = readSession(ADMIN_KEY, ADMIN_META, "admin");
  if (!session || session.payload.role !== "admin") return null;
  if (session.payload.local && !isBrowserLocal()) {
    localStorage.removeItem(ADMIN_KEY);
    localStorage.removeItem(ADMIN_META);
    return null;
  }
  return session;
}

function isStaffRoleName(value) {
  const role = String(value || "").toLowerCase().trim();
  return role === "admin" || role === "stamps" || role === "waits";
}

/** Staff nav and #admin require a staff cookie/token, or a student marked for the staff challenge. */
export function canUseStaffUi() {
  if (getAdminSession()) return true;
  const student = getStudentSession();
  if (!student) return false;
  return Boolean(student.payload.staffChallenge) || isStaffRoleName(student.payload.accountRole);
}

export async function verifyAdminSession() {
  const session = getAdminSession();
  if (!session) return null;
  if (session.payload.local && isBrowserLocal()) return session;
  try {
    const res = await apiFetch(apiUrl("admin-auth"), { asRole: "admin" });
    if (res.ok) {
      const data = await res.json().catch(() => ({}));
      if (data.staff) {
        const prev = readMeta(ADMIN_META, "admin") || { ...session.payload, role: "admin" };
        writeMeta(ADMIN_META, {
          ...prev,
          role: "admin",
          staffId: data.staff.staffId || prev.staffId,
          name: data.staff.fullName || prev.name,
          staffScope: data.staff.staffScope || prev.staffScope || "admin",
          exp: prev.exp || session.payload.exp,
        });
      }
      return getAdminSession();
    }
  } catch {
    /* treat as signed out */
  }
  clearAdminSession();
  return null;
}

export function setStudentToken(token) {
  localStorage.setItem(STUDENT_KEY, token);
}

export function setAdminToken(token) {
  localStorage.setItem(ADMIN_KEY, token);
}

function logoutRemote(role) {
  apiFetch(apiUrl("logout"), {
    method: "POST",
    skipAuth: true,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ role }),
  }).catch(() => {});
}

export function clearStudentSession() {
  localStorage.removeItem(STUDENT_KEY);
  localStorage.removeItem(STUDENT_META);
  logoutRemote("student");
}

export function clearAdminSession() {
  localStorage.removeItem(ADMIN_KEY);
  localStorage.removeItem(ADMIN_META);
  logoutRemote("admin");
}

export function apiFetch(url, options = {}) {
  const { skipAuth = false, asRole, ...rest } = options;
  const headers = { ...(rest.headers || {}) };
  if (!skipAuth && !headers.Authorization) {
    const admin = getAdminSession();
    const student = getStudentSession();
    let token = "";
    if (asRole === "admin") token = (admin && admin.token) || "";
    else if (asRole === "student") token = (student && student.token) || "";
    else if (admin && admin.token && student && student.token) token = "";
    else token = (admin && admin.token) || (student && student.token) || "";
    if (token) headers.Authorization = `Bearer ${token}`;
  }
  return fetch(url, { ...rest, credentials: "same-origin", headers });
}

async function parseError(res) {
  try {
    const data = await res.json();
    return userFacingError(data.error, "Something went wrong. Try again.");
  } catch {
    return "Something went wrong. Try again.";
  }
}

export function normalizeAdminNumber(value) {
  let id = String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
  if (/^[0-9]{7}$/.test(id)) id = `P${id}`;
  return id;
}

export function isAdminNumber(value) {
  return /^P(22|23|24|25|26)[0-9]{5}$/.test(normalizeAdminNumber(value));
}

const ADMIN_NUMBER_HINT =
  "Enter your admin number as P followed by 7 digits, starting with 22, 23, 24, 25, or 26.";

function toB64Url(obj) {
  const json = JSON.stringify(obj);
  const bytes = new TextEncoder().encode(json);
  let bin = "";
  bytes.forEach((b) => {
    bin += String.fromCharCode(b);
  });
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function mintLocalJwt(payload) {
  const now = Math.floor(Date.now() / 1000);
  const header = toB64Url({ alg: "none", typ: "JWT" });
  const mid = toB64Url({ ...payload, iat: now, exp: now + 3600, local: true });
  return `${header}.${mid}.local`;
}

function stampsKey(studentNumber) {
  return `sp-stamps-${studentNumber}`;
}

function readLocalCard(studentNumber) {
  try {
    return JSON.parse(localStorage.getItem(stampsKey(studentNumber)) || "null");
  } catch {
    return null;
  }
}

function writeLocalCard(studentNumber, card) {
  localStorage.setItem(stampsKey(studentNumber), JSON.stringify(card));
}

export function applyStaffFlags(data) {
  if (!data) return;
  const challenge = Boolean(data.staffChallenge) || isStaffRoleName(data.accountRole);
  if (!challenge) return;
  const session = getStudentSession();
  if (!session) return;
  const prev = readMeta(STUDENT_META, "student") || { ...session.payload, role: "student" };
  writeMeta(STUDENT_META, {
    ...prev,
    role: "student",
    studentNumber: prev.studentNumber || session.payload.studentNumber,
    name: prev.name || session.payload.name,
    staffChallenge: true,
    accountRole: data.accountRole || prev.accountRole || "admin",
    exp: prev.exp || session.payload.exp,
  });
}

function applyRemoteSession(data) {
  const exp = Math.floor(Date.now() / 1000) + Number(data.expiresIn || 8 * 60 * 60);
  if (data.student) {
    localStorage.removeItem(STUDENT_KEY);
    writeMeta(STUDENT_META, {
      role: "student",
      studentNumber: data.student.studentNumber,
      name: data.student.fullName,
      staffChallenge: Boolean(data.staffChallenge) || isStaffRoleName(data.accountRole),
      accountRole: data.accountRole || "student",
      exp,
    });
    if (data.studentToken) setStudentToken(data.studentToken);
    else if (data.token && !data.staff) setStudentToken(data.token);
  }
  if (data.staff) {
    localStorage.removeItem(ADMIN_KEY);
    writeMeta(ADMIN_META, {
      role: "admin",
      staffId: data.staff.staffId,
      name: data.staff.fullName,
      staffScope: data.staff.staffScope || "admin",
      exp,
    });
    if (data.staffToken) setAdminToken(data.staffToken);
    else if (data.token && data.staff) setAdminToken(data.token);
  }
}

function localSignIn({ id, fullName, password }) {
  if (!isLoopback()) {
    throw new Error("Sign-in is unavailable. Try again in a moment.");
  }
  const pass = String(password || "");
  const studentToken = mintLocalJwt({
    role: "student",
    studentNumber: id,
    name: fullName,
    staffChallenge: Boolean(pass),
  });
  setStudentToken(studentToken);
  if (!readLocalCard(id)) {
    writeLocalCard(id, {
      stamps: {},
      redeemedAt: null,
      redeemedBy: null,
      fullName,
      studentNumber: id,
      passId: `SP-FP-${id}`,
    });
  }
  if (pass) {
    if (pass !== "SP2026") {
      throw new Error("Staff password is incorrect.");
    }
    const token = mintLocalJwt({ role: "admin", staffId: id, name: fullName, staffScope: "admin" });
    setAdminToken(token);
    return { staff: { staffId: id, fullName, staffScope: "admin" }, student: { studentNumber: id, fullName }, token, local: true };
  }
  return {
    staff: false,
    student: { studentNumber: id, fullName },
    token: studentToken,
    staffChallenge: false,
    local: true,
  };
}

function emptyCard(session) {
  return {
    stamps: {},
    redeemedAt: null,
    redeemedBy: null,
    fullName: session.payload.name,
    studentNumber: session.payload.studentNumber,
    passId: `SP-FP-${session.payload.studentNumber}`,
  };
}

export async function signIn({ adminNumber, fullName, password }) {
  const id = normalizeAdminNumber(adminNumber);
  if (!isAdminNumber(id)) {
    throw new Error(ADMIN_NUMBER_HINT);
  }
  const name = String(fullName || "").trim();
  if (name.length < 2) {
    throw new Error("Enter your full name.");
  }
  try {
    const res = await apiFetch(apiUrl("login"), {
      method: "POST",
      skipAuth: true,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ adminNumber: id, fullName: name, password: password || "" }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok && (data.token || data.student || data.staff || data.staffChallenge)) {
      applyRemoteSession(data);
      return data;
    }
    if (res.ok) {
      throw new Error("Sign-in did not return a session. Try again.");
    }
    const apiError = userFacingError(data.error, "");
    throw new Error(apiError || "Sign-in failed. Check your admin number and name, then try again.");
  } catch (error) {
    if (error && error.message && !/failed to fetch|networkerror|load failed/i.test(error.message)) {
      throw error;
    }
    if (isLoopback()) {
      return localSignIn({ id, fullName: name, password });
    }
    throw new Error("Sign-in is unavailable. Try again in a moment.");
  }
}

export async function fetchStamps() {
  const session = getStudentSession();
  if (!session) throw new Error("Sign in to open your stamp card.");
  const local = readLocalCard(session.payload.studentNumber) || emptyCard(session);
  if (session.payload.local) return local;
  try {
    const res = await apiFetch(apiUrl("stamps"));
    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      applyStaffFlags(data);
      return data;
    }
  } catch {
    /* use local card */
  }
  return local;
}

export async function lookupStudent(studentNumber) {
  const session = getAdminSession();
  if (!session) throw new Error("Staff session expired.");
  const res = await apiFetch(apiUrl("lookup-student"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ studentNumber: normalizeAdminNumber(studentNumber) }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw apiFail(data, res, "Could not look up that student.");
  return data;
}

export async function fetchOps() {
  const session = getAdminSession();
  if (!session) throw new Error("Staff session expired.");
  const res = await apiFetch(apiUrl("ops"));
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw apiFail(data, res, "Could not load command post.");
  return data;
}

export async function fetchClickerSave() {
  const session = getStudentSession();
  if (!session) return null;
  try {
    const res = await apiFetch(apiUrl("game-save"));
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return null;
    return data.state || null;
  } catch {
    return null;
  }
}

export async function saveClickerRemote(state) {
  const session = getStudentSession();
  if (!session) return;
  await apiFetch(apiUrl("game-save"), {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ state }),
  });
}

export async function awardStamp(studentNumber, boothId) {
  const session = getAdminSession();
  if (!session) throw new Error("Staff session expired. Sign in again.");
  const num = normalizeAdminNumber(studentNumber);
  if (!isAdminNumber(num)) {
    throw new Error(ADMIN_NUMBER_HINT);
  }
  const booth = boothById(boothId);
  if (!booth) throw new Error("Choose a valid booth.");

  if (session.payload.local) {
    return awardStampLocal(session, num, booth);
  }

  const res = await apiFetch(apiUrl("award-stamp"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ studentNumber: num, boothId: booth.id }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 404 && /unknown api/i.test(data.error || "")) {
      throw new Error("Could not award that stamp. Try again.");
    }
    throw apiFail(data, res, "Could not award stamp.");
  }
  return data;
}

function awardStampLocal(session, num, booth) {
  const card = readLocalCard(num) || {
    stamps: {},
    redeemedAt: null,
    redeemedBy: null,
    fullName: "",
    studentNumber: num,
    passId: `SP-FP-${num}`,
  };
  const stamps = { ...(card.stamps || {}) };
  if (stamps[booth.id] || stamps[Number(booth.id)]) {
    throw new Error("This student already has that booth stamp.");
  }
  stamps[booth.id] = { by: session.payload.staffId || session.payload.name || "staff", at: Date.now(), boothId: booth.id };
  const next = { ...card, stamps, studentNumber: num };
  writeLocalCard(num, next);
  return {
    studentNumber: num,
    fullName: card.fullName || "",
    stamps,
    awarded: booth.id,
    boothName: booth.name,
    local: true,
  };
}

export async function submitFeedback(kind, targetId, message, rating) {
  const res = await apiFetch(apiUrl("feedback"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kind, targetId, message, rating }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw apiFail(data, res, "Could not send feedback.");
  return data;
}

export async function fetchFeedback(kind, targetId) {
  const session = getAdminSession();
  if (!session) throw new Error("Staff session expired.");
  const res = await apiFetch(apiUrl("feedback", { kind, target: targetId }));
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw apiFail(data, res, "Could not load feedback.");
  return data;
}

const LOCAL_ANNOUNCE = "scream-announcements";

function readLocalAnnouncements() {
  try {
    return JSON.parse(localStorage.getItem(LOCAL_ANNOUNCE) || "[]");
  } catch {
    return [];
  }
}

function writeLocalAnnouncements(rows) {
  localStorage.setItem(LOCAL_ANNOUNCE, JSON.stringify(rows.slice(0, 50)));
}

export async function fetchAnnouncements({ all = false } = {}) {
  try {
    const res = await apiFetch(apiUrl("announcements", all ? { all: "1" } : {}));
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw apiFail(data, res, "Could not load announcements.");
    return data.announcements || [];
  } catch (error) {
    if (!isBrowserLocal()) {
      if (all) throw error;
      return [];
    }
    const rows = readLocalAnnouncements();
    return all
      ? rows
      : rows.filter((r) => r.active !== false && (!r.expires_at || new Date(r.expires_at).getTime() > Date.now()));
  }
}

export async function postAnnouncement(message, extra = {}) {
  const session = getAdminSession();
  if (!session) throw new Error("Staff session expired.");
  try {
    const res = await apiFetch(apiUrl("announcements"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.token}`,
      },
      body: JSON.stringify({
        message,
        audience: extra.audience || "all",
        houseId: extra.houseId || "",
        expiresMinutes: extra.expiresMinutes || "",
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) return data.announcement;
    if (res.status === 401 || res.status === 403) throw new Error(data.error || "Staff session expired.");
    if (!isBrowserLocal()) throw apiFail(data, res, "Could not post announcement.");
  } catch (error) {
    if (!isBrowserLocal() || (error.message && error.message.includes("Staff session"))) throw error;
  }
  if (!isBrowserLocal()) throw new Error("Could not post announcement.");
  const row = {
    id: `local-${Date.now()}`,
    message,
    posted_by: session.payload.staffId,
    active: true,
    audience: extra.audience || "all",
    house_id: extra.houseId || null,
    expires_at: extra.expiresMinutes
      ? new Date(Date.now() + Number(extra.expiresMinutes) * 60000).toISOString()
      : null,
    created_at: new Date().toISOString(),
  };
  writeLocalAnnouncements([row, ...readLocalAnnouncements()]);
  return row;
}

export async function setAnnouncementActive(id, active) {
  const session = getAdminSession();
  if (!session) throw new Error("Staff session expired.");
  try {
    const res = await apiFetch(apiUrl("announcements"), {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.token}`,
      },
      body: JSON.stringify({ id, active }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) return data.announcement;
    if (res.status === 401 || res.status === 403) throw new Error(data.error || "Staff session expired.");
    if (!isBrowserLocal()) throw apiFail(data, res, "Could not update announcement.");
  } catch (error) {
    if (!isBrowserLocal() || (error.message && error.message.includes("Staff session"))) throw error;
  }
  if (!isBrowserLocal()) throw new Error("Could not update announcement.");
  const next = readLocalAnnouncements().map((row) => (row.id === id ? { ...row, active } : row));
  writeLocalAnnouncements(next);
  return next.find((r) => r.id === id);
}

export async function fetchLeaderboard(gameId) {
  const res = await apiFetch(apiUrl("scores", { game: gameId }));
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw apiFail(data, res, "Could not load scores.");
  return data;
}

export async function submitScore(gameId, score) {
  const session = getStudentSession();
  if (!session) return null;
  const res = await apiFetch(apiUrl("scores"), {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ gameId, score }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw apiFail(data, res, "Could not save score.");
  return data;
}

export async function unredeemPass(studentNumber) {
  const session = getAdminSession();
  if (!session) throw new Error("Staff session expired.");
  const res = await apiFetch(apiUrl("unredeem"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ studentNumber }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw apiFail(data, res, "Could not undo that redeem.");
  return data;
}

export async function redeemPass(studentNumber) {
  const session = getAdminSession();
  if (!session) throw new Error("Staff session expired.");
  const res = await apiFetch(apiUrl("redeem"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ studentNumber }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw apiFail(data, res, "Redeem failed.");
  return data;
}
