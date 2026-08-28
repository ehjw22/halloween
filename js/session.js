const STUDENT_KEY = "sp-student-jwt";
const ADMIN_KEY = "sp-admin-jwt";

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
  return session;
}

export function getAdminSession() {
  const session = readSession(ADMIN_KEY);
  if (!session || session.payload.role !== "admin") return null;
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

export async function studentSignIn(studentNumber, fullName) {
  const res = await fetch("/api/student-auth", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ studentNumber, fullName }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Sign-in failed.");
  setStudentToken(data.token);
  return data;
}

export async function adminSignIn(staffId, passcode) {
  const res = await fetch("/api/admin-auth", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ staffId, passcode }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Staff sign-in failed.");
  setAdminToken(data.token);
  return data;
}

export async function fetchStamps() {
  const session = getStudentSession();
  if (!session) throw new Error("Sign in to open your stamp card.");
  const res = await fetch("/api/stamps", {
    headers: { Authorization: `Bearer ${session.token}` },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || (await parseError(res)));
  return data;
}

export async function applyStamp(slotId, staffId, passcode) {
  const session = getStudentSession();
  if (!session) throw new Error("Sign in to save stamps.");
  const res = await fetch("/api/stamps", {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.token}`,
    },
    body: JSON.stringify({ slotId, staffId, passcode }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Could not save stamps.");
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
