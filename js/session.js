import { boothById } from "./booths.js?v=40779f5429";

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

function looksTechnical(raw) {
  return /select\s+.+\s+from|insert\s+into|schema\.sql|sql editor|service_role|jwt_secret|supabase|postgres|pgrst|row-level security|relation |duplicate key|unique constraint|check constraint|violates|sqlstate|syntax error|stack trace|at Object|\/api\/config|vercel|anon key|passcode/i.test(String(raw || ""));
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
  if (!raw || looksTechnical(raw) || /^(request failed|not found|internal server error|bad request|unauthorized|forbidden|error)$/i.test(raw)) {
    return fallback;
  }
  return raw;
}

function apiFail(data, res, fallback) {
  const status = res && res.status;
  const err = new Error(userFacingError((data && data.error) || fallback, fallback || "Something went wrong. Try again."));
  err.code = (data && data.code) || "";
  err.status = status || 0;
  if (data && data.stampCount !== undefined) err.stampCount = data.stampCount;
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
  if (session.payload.local) {
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
  if (session.payload.local) {
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
  try {
    const res = await apiFetch(apiUrl("admin-auth"), { asRole: "admin" });
    if (res.ok) {
      const data = await res.json().catch(() => ({}));
      if (!data.staff) {
        forgetAdminSession();
        return null;
      }
      const prev = readMeta(ADMIN_META, "admin") || { ...session.payload, role: "admin" };
      const exp = data.staff.expiresAt ? Math.floor(new Date(data.staff.expiresAt).getTime() / 1000) : prev.exp || session.payload.exp;
      writeMeta(ADMIN_META, {
        ...prev,
        role: "admin",
        staffId: data.staff.staffId || prev.staffId,
        name: data.staff.fullName || prev.name,
        staffScope: data.staff.staffScope || prev.staffScope || "admin",
        exp,
      });
      return getAdminSession();
    }
    if (res.status === 401 || res.status === 403) {
      forgetAdminSession();
      return null;
    }
  } catch {
    /* offline: keep the local copy, the server still checks every action */
  }
  return getAdminSession();
}

export function setStudentToken(token) {
  localStorage.setItem(STUDENT_KEY, token);
}

export function setAdminToken(token) {
  localStorage.setItem(ADMIN_KEY, token);
}

async function logoutRemote(role) {
  const timeout = new Promise((resolve) => setTimeout(resolve, 4000));
  const call = apiFetch(apiUrl("logout"), {
    method: "POST",
    skipAuth: true,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ role }),
  }).catch(() => null);
  await Promise.race([call, timeout]);
}

function forgetStudentSession() {
  localStorage.removeItem(STUDENT_KEY);
  localStorage.removeItem(STUDENT_META);
}

function forgetAdminSession() {
  localStorage.removeItem(ADMIN_KEY);
  localStorage.removeItem(ADMIN_META);
}

/** Signs out of both the student card and any staff unlock (the server clears both cookies). */
export async function clearStudentSession() {
  forgetStudentSession();
  forgetAdminSession();
  await logoutRemote("student");
}

export async function clearAdminSession() {
  forgetAdminSession();
  await logoutRemote("admin");
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
const STAFF_NUMBER_HINT = "Admin number should be P followed by 7 digits.";

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
  const exp = Math.floor(Date.now() / 1000) + Number(data.expiresIn || 6 * 60 * 60);
  if (data.student && !data.staff) {
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
    else if (data.token) setStudentToken(data.token);
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

function offline(error) {
  return !error || /failed to fetch|networkerror|load failed|network request failed/i.test(String(error.message || ""));
}

const LOGIN_TIMEOUT_MS = 15000;

async function postLogin(body, fallback) {
  let res;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), LOGIN_TIMEOUT_MS);
  try {
    res = await apiFetch(apiUrl("login"), {
      method: "POST",
      skipAuth: true,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
  } catch (error) {
    // status 0 + network/timeout lets the student sign-in retry by itself (js/signin-retry.js).
    if (ctrl.signal.aborted) throw Object.assign(new Error("Can't reach the server. Check your connection and try again."), { status: 0, timeout: true });
    if (offline(error)) throw Object.assign(new Error("Can't reach the server. Check your connection and try again."), { status: 0, network: true });
    throw error;
  } finally {
    clearTimeout(timer);
  }
  const data = await res.json().catch(() => ({}));
  if (res.ok && (data.student || data.staff)) {
    applyRemoteSession(data);
    return data;
  }
  if (res.ok) throw new Error("Sign-in did not return a session. Try again.");
  const err = apiFail(data, res, fallback);
  err.retryAfter = Number(res.headers.get("Retry-After")) || 0;
  throw err;
}

/** Student sign-in. A new admin number and name creates the card. */
export async function signIn({ adminNumber, fullName }) {
  const id = normalizeAdminNumber(adminNumber);
  if (!isAdminNumber(id)) throw new Error(ADMIN_NUMBER_HINT);
  const name = String(fullName || "").trim();
  if (name.length < 2) throw new Error("Enter your full name.");
  return postLogin({ adminNumber: id, fullName: name }, "Sign-in failed. Check your admin number and name.");
}

/** Staff unlock on top of the signed-in student card. The password picks the post. */
export async function unlockStaff(password) {
  if (!getStudentSession()) throw new Error("Sign in with your admin number and full name first.");
  const pass = String(password || "").trim();
  if (!pass) throw new Error("Enter the staff password.");
  return postLogin({ password: pass }, "Staff sign-in failed. Check the password for your post.");
}

export async function fetchStamps() {
  const session = getStudentSession();
  if (!session) throw new Error("Sign in to open your stamp card.");
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), LOGIN_TIMEOUT_MS);
  let res;
  try {
    res = await apiFetch(apiUrl("stamps"), { asRole: "student", signal: ctrl.signal });
  } catch (error) {
    if (ctrl.signal.aborted) throw Object.assign(new Error("Could not load your stamp card."), { status: 0, timeout: true });
    if (offline(error)) throw Object.assign(new Error("Could not load your stamp card."), { status: 0, network: true });
    throw error;
  } finally {
    clearTimeout(timer);
  }
  const data = await res.json().catch(() => ({}));
  if (res.ok) {
    applyStaffFlags(data);
    return data;
  }
  if (res.status === 401) forgetStudentSession();
  const err = apiFail(data, res, "Could not load your stamp card.");
  err.retryAfter = Number(res.headers.get("Retry-After")) || 0;
  throw err;
}

/** Tiny private poll for the open stamp card: a number that moves whenever the card changes. */
export async function fetchStampsVersion() {
  const session = getStudentSession();
  if (!session) throw new Error("Sign in to open your stamp card.");
  const res = await apiFetch(apiUrl("stamps-version"), { asRole: "student", cache: "no-store" });
  const data = await res.json().catch(() => ({}));
  if (res.ok) return Number(data.v) || 0;
  if (res.status === 401) forgetStudentSession();
  throw apiFail(data, res, "Could not check your stamp card.");
}

export async function lookupStudent(studentNumber) {
  const session = getAdminSession();
  if (!session) throw new Error("Staff session expired.");
  const num = normalizeAdminNumber(studentNumber);
  if (!isAdminNumber(num)) throw new Error(STAFF_NUMBER_HINT);
  const res = await apiFetch(apiUrl("lookup-student"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ studentNumber: num }),
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
    throw new Error(STAFF_NUMBER_HINT);
  }
  const booth = boothById(boothId);
  if (!booth) throw new Error("Choose a valid booth.");

  const res = await apiFetch(apiUrl("award-stamp"), {
    method: "POST",
    asRole: "admin",
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

export async function unawardStamp(studentNumber, boothId) {
  const session = getAdminSession();
  if (!session) throw new Error("Staff session expired. Sign in again.");
  const num = normalizeAdminNumber(studentNumber);
  if (!isAdminNumber(num)) throw new Error(STAFF_NUMBER_HINT);
  const booth = boothById(boothId);
  if (!booth) throw new Error("Choose a valid booth.");
  const res = await apiFetch(apiUrl("unaward-stamp"), {
    method: "POST",
    asRole: "admin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ studentNumber: num, boothId: booth.id }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw apiFail(data, res, "Could not undo that stamp.");
  return data;
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

/**
 * Public list: a plain cookie-less GET the CDN can cache for everyone (`v` is the announce_v that
 * just changed, so phones on the same version share one copy; `fresh` skips the cache for staff who
 * just posted). The staff list (all) stays authenticated and uncached. `strict` makes a failed
 * public load throw so the caller can keep what is already on screen.
 */
export async function fetchAnnouncements({ all = false, v, fresh = false, strict = false } = {}) {
  try {
    const params = all ? { all: "1" } : v ? { v } : fresh ? { fresh: Date.now() } : {};
    const res = all
      ? await apiFetch(apiUrl("announcements", params))
      : await fetch(apiUrl("announcements", params), { credentials: "omit" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw apiFail(data, res, "Could not load announcements.");
    return data.announcements || [];
  } catch (error) {
    if (!isBrowserLocal()) {
      if (all || strict) throw error;
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
      asRole: "admin",
      headers: {
        "Content-Type": "application/json",
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
    if (res.status === 401 || res.status === 403) throw new Error(userFacingError(data.error, "Staff session expired."));
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
      asRole: "admin",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ id, active }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) return data.announcement;
    if (res.status === 401 || res.status === 403) throw new Error(userFacingError(data.error, "Staff session expired."));
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
