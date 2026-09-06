const STUDENT_KEY = "sp-student-jwt";
const ADMIN_KEY = "sp-admin-jwt";

function isBrowserLocal() {
  const host = String(window.location.hostname || "").toLowerCase();
  if (host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host === "0.0.0.0") return true;
  if (host.endsWith(".localhost")) return true;
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

function readSession(storageKey) {
  const token = localStorage.getItem(storageKey);
  if (!token) return null;
  const payload = decodePayload(token);
  if (!payload?.exp || payload.exp * 1000 < Date.now()) {
    localStorage.removeItem(storageKey);
    return null;
  }
  return { token, payload };
}

export function getStudentSession() {
  const session = readSession(STUDENT_KEY);
  if (!session || session.payload.role !== "student") return null;
  if (session.payload.local && !isBrowserLocal()) {
    localStorage.removeItem(STUDENT_KEY);
    return null;
  }
  return session;
}

export function getAdminSession() {
  const session = readSession(ADMIN_KEY);
  if (!session || session.payload.role !== "admin") return null;
  if (session.payload.local && !isBrowserLocal()) {
    localStorage.removeItem(ADMIN_KEY);
    return null;
  }
  return session;
}

export function setStudentToken(token) {
  localStorage.setItem(STUDENT_KEY, token);
}

export function setAdminToken(token) {
  localStorage.setItem(ADMIN_KEY, token);
}

export function clearStudentSession() {
  localStorage.removeItem(STUDENT_KEY);
}

export function clearAdminSession() {
  localStorage.removeItem(ADMIN_KEY);
}

async function parseError(res) {
  try {
    const data = await res.json();
    return data.error || res.statusText;
  } catch {
    return res.statusText;
  }
}

export function normalizeAdminNumber(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

export function isAdminNumber(value) {
  return /^P[0-9]{7}$/.test(normalizeAdminNumber(value));
}

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

function localSignIn({ id, fullName, password }) {
  if (!isBrowserLocal()) {
    throw new Error("Sign-in is unavailable. Try again in a moment.");
  }
  const pass = String(password || "");
  if (pass) {
    if (pass !== "SP2026") {
      throw new Error("Staff password is incorrect.");
    }
    const token = mintLocalJwt({ role: "admin", staffId: id, name: fullName, staffScope: "admin" });
    setAdminToken(token);
    return { staff: true, token, local: true };
  }
  const token = mintLocalJwt({ role: "student", studentNumber: id, name: fullName });
  setStudentToken(token);
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
  return { staff: false, token, local: true };
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
    throw new Error("Enter your admin number as P followed by 7 digits, for example P1234567.");
  }
  const name = String(fullName || "").trim();
  if (name.length < 2) {
    throw new Error("Enter your full name.");
  }
  try {
    const res = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ adminNumber: id, fullName: name, password: password || "" }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.token) {
      if (data.staff) setAdminToken(data.token);
      else setStudentToken(data.token);
      return data;
    }
    if (res.ok) {
      throw new Error("Sign-in did not return a session. Try again.");
    }
    const apiError = String(data.error || "").trim();
    if (res.status === 401 || res.status === 400 || res.status === 429 || res.status === 503) {
      throw new Error(apiError || "Sign-in failed.");
    }
    if (isBrowserLocal()) {
      return localSignIn({ id, fullName: name, password });
    }
    throw new Error(apiError || "Sign-in is unavailable. Try again in a moment.");
  } catch (error) {
    if (error && error.message && !/failed to fetch|networkerror|load failed/i.test(error.message)) {
      throw error;
    }
    if (isBrowserLocal()) {
      return localSignIn({ id, fullName: name, password });
    }
    throw new Error("Sign-in is unavailable. Try again in a moment.");
  }
}

export async function studentSignIn(studentNumber, fullName) {
  return signIn({ adminNumber: studentNumber, fullName, password: "" });
}

export async function adminSignIn(staffId, fullName, passcode) {
  return signIn({ adminNumber: staffId, fullName, password: passcode });
}

export async function fetchStamps() {
  const session = getStudentSession();
  if (!session) throw new Error("Sign in to open your stamp card.");
  const local = readLocalCard(session.payload.studentNumber) || emptyCard(session);
  if (session.payload.local) return local;
  try {
    const res = await fetch("/api/stamps", {
      headers: { Authorization: `Bearer ${session.token}` },
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) return data;
  } catch {
    /* use local card */
  }
  return local;
}

export async function lookupStudent(studentNumber) {
  const session = getAdminSession();
  if (!session) throw new Error("Staff session expired.");
  try {
    const res = await fetch(`/api/lookup-student?studentNumber=${encodeURIComponent(normalizeAdminNumber(studentNumber))}`, {
      headers: { Authorization: `Bearer ${session.token}` },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (data.error && /student|admin number|sign in/i.test(data.error)) {
        throw new Error(data.error);
      }
      return {
        studentNumber: normalizeAdminNumber(studentNumber),
        fullName: "Name not confirmed (offline)",
        stamps: {},
        demo: true,
      };
    }
    return data;
  } catch (error) {
    if (error.message && /student|admin number|Staff session/i.test(error.message)) throw error;
    return {
      studentNumber: normalizeAdminNumber(studentNumber),
      fullName: "Name not confirmed (offline)",
      stamps: {},
      demo: true,
    };
  }
}

export async function fetchOps() {
  const session = getAdminSession();
  if (!session) throw new Error("Staff session expired.");
  const res = await fetch("/api/ops", {
    headers: { Authorization: `Bearer ${session.token}` },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Could not load command post.");
  return data;
}

export async function fetchClickerSave() {
  const session = getStudentSession();
  if (!session) return null;
  try {
    const res = await fetch("/api/game-save", {
      headers: { Authorization: `Bearer ${session.token}` },
    });
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
  await fetch("/api/game-save", {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.token}`,
    },
    body: JSON.stringify({ state }),
  });
}

export async function awardStamp(studentNumber, boothId) {
  const session = getAdminSession();
  if (!session) throw new Error("Staff session expired.");
  const res = await fetch("/api/award-stamp", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.token}`,
    },
    body: JSON.stringify({ studentNumber, boothId }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Could not award stamp.");
  return data;
}

export async function submitFeedback(kind, targetId, message, rating) {
  const session = getStudentSession();
  const headers = { "Content-Type": "application/json" };
  if (session) headers.Authorization = `Bearer ${session.token}`;
  const res = await fetch("/api/feedback", {
    method: "POST",
    headers,
    body: JSON.stringify({ kind, targetId, message, rating }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Could not send feedback.");
  return data;
}

export async function fetchFeedback(kind, targetId) {
  const session = getAdminSession();
  if (!session) throw new Error("Staff session expired.");
  const params = new URLSearchParams();
  if (kind) params.set("kind", kind);
  if (targetId) params.set("target", targetId);
  const q = params.toString();
  const res = await fetch(`/api/feedback${q ? `?${q}` : ""}`, {
    headers: { Authorization: `Bearer ${session.token}` },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Could not load feedback.");
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
  const session = getAdminSession();
  const headers = {};
  if (session) headers.Authorization = `Bearer ${session.token}`;
  const q = all ? "?all=1" : "";
  try {
    const res = await fetch(`/api/announcements${q}`, { headers });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Could not load announcements.");
    return data.announcements || [];
  } catch {
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
    const res = await fetch("/api/announcements", {
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
  } catch (error) {
    if (error.message && error.message.includes("Staff session")) throw error;
  }
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
    const res = await fetch("/api/announcements", {
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
  } catch (error) {
    if (error.message && error.message.includes("Staff session")) throw error;
  }
  const next = readLocalAnnouncements().map((row) => (row.id === id ? { ...row, active } : row));
  writeLocalAnnouncements(next);
  return next.find((r) => r.id === id);
}

export async function fetchLeaderboard(gameId) {
  const session = getStudentSession();
  const headers = {};
  if (session) headers.Authorization = `Bearer ${session.token}`;
  const res = await fetch(`/api/scores?game=${encodeURIComponent(gameId)}`, { headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Could not load scores.");
  return data;
}

export async function submitScore(gameId, score) {
  const session = getStudentSession();
  if (!session) return null;
  const res = await fetch("/api/scores", {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.token}`,
    },
    body: JSON.stringify({ gameId, score }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Could not save score.");
  return data;
}

export async function redeemPass(staffId, passcode) {
  const session = getStudentSession();
  if (!session) throw new Error("Student session expired.");
  const res = await fetch("/api/redeem", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.token}`,
    },
    body: JSON.stringify({ staffId, passcode }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Redeem failed.");
  return data;
}
