const crypto = require("crypto");
const { BOOTHS, isBoothId, isHouseId } = require("./catalog");

const JWT_TTL_SEC = 60 * 60;

function getEnv() {
  const adminPass = process.env.ADMIN_PASSCODE || process.env.adminPasscode || "SP2026";
  return {
    url: process.env.SUPABASE_URL || process.env.supabaseUrl || "",
    anon: process.env.SUPABASE_ANON_KEY || process.env.supabaseAnonKey || "",
    service: process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.supabaseServiceRoleKey || "",
    jwtSecret: process.env.JWT_SECRET || process.env.jwtSecret || "",
    adminPass,
    stampPass: process.env.STAMP_PASSCODE || process.env.stampPasscode || adminPass,
  };
}

function b64url(input) {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input);
  return buf.toString("base64url");
}

function signJwt(payload) {
  const secret = getEnv().jwtSecret;
  if (!secret) {
    const err = new Error("JWT_SECRET is not set");
    err.status = 500;
    throw err;
  }
  const now = Math.floor(Date.now() / 1000);
  const body = { ...payload, iat: now, exp: now + JWT_TTL_SEC };
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const mid = b64url(JSON.stringify(body));
  const data = `${header}.${mid}`;
  const sig = b64url(crypto.createHmac("sha256", secret).update(data).digest());
  return `${data}.${sig}`;
}

function verifyJwt(token) {
  const secret = getEnv().jwtSecret;
  if (!secret || !token) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [header, mid, sig] = parts;
  const expected = b64url(crypto.createHmac("sha256", secret).update(`${header}.${mid}`).digest());
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(mid, "base64url").toString("utf8"));
    if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

function normalizeNumber(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

function normalizeName(value) {
  return String(value || "").trim().replace(/\s+/g, " ");
}

function namesMatch(a, b) {
  return normalizeName(a).toLowerCase() === normalizeName(b).toLowerCase();
}

function checkPass(input, expected) {
  const left = crypto.createHash("sha256").update(String(input)).digest();
  const right = crypto.createHash("sha256").update(String(expected)).digest();
  return crypto.timingSafeEqual(left, right);
}

function sanitizePlain(value, max = 1000) {
  return String(value || "")
    .replace(/<[^>]*>/g, "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .trim()
    .slice(0, max);
}

function isAdminNumber(value) {
  return /^P[0-9]{7}$/.test(value);
}

function isStudentNumber(value) {
  return isAdminNumber(value);
}

const authHits = new Map();

function clientKey(req) {
  const fwd = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  return fwd || req.headers["x-real-ip"] || req.socket?.remoteAddress || "unknown";
}

function rateLimit(req, max = 20, windowMs = 10 * 60 * 1000) {
  const key = clientKey(req);
  const now = Date.now();
  const row = authHits.get(key) || { n: 0, t: now };
  if (now - row.t > windowMs) {
    row.n = 0;
    row.t = now;
  }
  row.n += 1;
  authHits.set(key, row);
  if (authHits.size > 5000) authHits.clear();
  return row.n <= max;
}

function send(res, status, body) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("X-Content-Type-Options", "nosniff");
  if (status >= 500) {
    res.status(status).json({ error: "Something went wrong. Try again." });
    return;
  }
  res.status(status).json(body);
}

async function readBody(req) {
  if (Buffer.isBuffer(req.body)) {
    try {
      return JSON.parse(req.body.toString("utf8") || "{}");
    } catch {
      return {};
    }
  }
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") {
    try {
      return JSON.parse(req.body || "{}");
    } catch {
      return {};
    }
  }
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function bearer(req) {
  const header = req.headers.authorization || req.headers.Authorization || "";
  const match = String(header).match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : "";
}

async function sb(path, { method = "GET", body, query = "" } = {}) {
  const env = getEnv();
  const key = env.service || env.anon;
  if (!env.url || !key) {
    const err = new Error("Supabase is not configured");
    err.status = 500;
    throw err;
  }
  const res = await fetch(`${env.url}/rest/v1/${path}${query}`, {
    method,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  if (!res.ok) {
    const err = new Error((data && data.message) || text || `Supabase ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

async function handleStudentAuth(req, res) {
  if (req.method !== "POST") return send(res, 405, { error: "Method not allowed" });
  if (!rateLimit(req)) return send(res, 429, { error: "Too many attempts. Wait a few minutes." });
  try {
    const body = await readBody(req);
    req.body = body;
    return signInStudent(req, res, body);
  } catch (error) {
    return send(res, error.status || 500, { error: error.message || "Sign-in failed." });
  }
}

async function signInStudent(req, res, body) {
  try {
    const studentNumber = normalizeNumber(body.studentNumber || body.adminNumber);
    const fullName = sanitizePlain(normalizeName(body.fullName), 80);
    if (!isAdminNumber(studentNumber)) {
      return send(res, 400, { error: "Enter your admin number as P followed by 7 digits, for example P1234567." });
    }
    if (!fullName || fullName.length < 2) {
      return send(res, 400, { error: "Enter your full name as on your student card." });
    }

    const existing = await sb("students", {
      query: `?student_number=eq.${encodeURIComponent(studentNumber)}&select=*`,
    });
    const row = Array.isArray(existing) ? existing[0] : null;
    let created = false;
    let name = fullName;

    if (!row) {
      try {
        const inserted = await sb("students", {
          method: "POST",
          body: { student_number: studentNumber, full_name: fullName },
        });
        const student = Array.isArray(inserted) ? inserted[0] : inserted;
        name = (student && student.full_name) || fullName;
        try {
          await sb("stamp_cards", {
            method: "POST",
            body: { student_number: studentNumber, stamps: {} },
          });
        } catch (cardError) {
          if (cardError.status !== 409) throw cardError;
        }
        created = true;
      } catch (error) {
        if (error.status === 409) {
          const again = await sb("students", {
            query: `?student_number=eq.${encodeURIComponent(studentNumber)}&select=*`,
          });
          const taken = Array.isArray(again) ? again[0] : null;
          if (taken && namesMatch(taken.full_name, fullName)) {
            name = taken.full_name;
          } else {
            return send(res, 409, { error: "This admin number already has a stamp card. Check the name matches." });
          }
        } else if (error.status === 401 || error.status === 403) {
          return send(res, 503, { error: "Sign-in is not available right now. Staff need to finish server setup." });
        } else {
          throw error;
        }
      }
    } else if (!namesMatch(row.full_name, fullName)) {
      return send(res, 401, { error: "Admin number and name do not match." });
    } else {
      name = row.full_name;
    }

    const token = signJwt({ role: "student", studentNumber, name });
    return send(res, 200, {
      token,
      expiresIn: JWT_TTL_SEC,
      created,
      student: { studentNumber, fullName: name },
    });
  } catch (error) {
    return send(res, error.status || 500, { error: error.message || "Sign-in failed." });
  }
}

async function handleAdminAuth(req, res) {
  if (req.method !== "POST") return send(res, 405, { error: "Method not allowed" });
  if (!rateLimit(req, 12)) return send(res, 429, { error: "Too many attempts. Wait a few minutes." });
  try {
    const body = await readBody(req);
    req.body = body;
    return signInStaff(req, res, body);
  } catch (error) {
    return send(res, error.status || 500, { error: error.message || "Staff sign-in failed." });
  }
}

async function signInStaff(req, res, body) {
  try {
    const staffId = normalizeNumber(body.staffId || body.adminNumber || body.studentNumber);
    const fullName = sanitizePlain(normalizeName(body.fullName || body.staffId), 80);
    const passcode = String(body.passcode || body.password || "").trim().slice(0, 80);
    if (!isAdminNumber(staffId)) {
      return send(res, 400, { error: "Enter your admin number as P followed by 7 digits, for example P1234567." });
    }
    if (!fullName || fullName.length < 2) {
      return send(res, 400, { error: "Enter your full name." });
    }
    if (!passcode) return send(res, 400, { error: "Enter the staff password." });
    if (!checkPass(passcode, getEnv().adminPass)) {
      return send(res, 401, { error: "Incorrect staff password." });
    }
    const token = signJwt({ role: "admin", staffId, name: fullName });
    return send(res, 200, {
      token,
      expiresIn: JWT_TTL_SEC,
      staff: { staffId, fullName },
    });
  } catch (error) {
    return send(res, error.status || 500, { error: error.message || "Staff sign-in failed." });
  }
}

async function handleLogin(req, res) {
  if (req.method !== "POST") return send(res, 405, { error: "Method not allowed" });
  const body = await readBody(req);
  req.body = body;
  const password = String(body.password || body.passcode || "").trim();
  const adminNumber = normalizeNumber(body.adminNumber || body.studentNumber || body.staffId);
  const fullName = body.fullName;
  if (password) {
    if (!rateLimit(req, 12)) return send(res, 429, { error: "Too many attempts. Wait a few minutes." });
    return signInStaff(req, res, { staffId: adminNumber, fullName, passcode: password });
  }
  if (!rateLimit(req)) return send(res, 429, { error: "Too many attempts. Wait a few minutes." });
  return signInStudent(req, res, { studentNumber: adminNumber, fullName });
}

function requireStudent(req, res) {
  const payload = verifyJwt(bearer(req));
  if (!payload || payload.role !== "student") {
    send(res, 401, { error: "Student session expired. Sign in again." });
    return null;
  }
  return payload;
}

function requireAdmin(req, res) {
  const payload = verifyJwt(bearer(req));
  if (!payload || payload.role !== "admin") {
    send(res, 401, { error: "Staff session expired. Sign in again." });
    return null;
  }
  return payload;
}

const HOUSE_STATUSES = new Set(["open", "busy", "closed", "at_capacity"]);

async function handleWaitTimes(req, res) {
  if (req.method !== "POST") return send(res, 405, { error: "Method not allowed" });
  if (!rateLimit(req, 80, 10 * 60 * 1000)) {
    return send(res, 429, { error: "Too many updates. Wait a moment." });
  }
  const session = requireAdmin(req, res);
  if (!session) return;
  try {
    const body = await readBody(req);
    const id = String(body.id || "").trim();
    if (!isHouseId(id)) return send(res, 400, { error: "Unknown scare house." });
    const wait = Math.max(0, Math.min(240, Math.round(Number(body.wait_minutes) || 0)));
    const status = String(body.status || "").trim();
    if (!HOUSE_STATUSES.has(status)) return send(res, 400, { error: "Invalid house status." });
    const updated = await sb("scare_houses", {
      method: "PATCH",
      query: `?id=eq.${encodeURIComponent(id)}`,
      body: {
        wait_minutes: wait,
        status,
        updated_at: new Date().toISOString(),
      },
    });
    const row = Array.isArray(updated) ? updated[0] : updated;
    if (!row) return send(res, 404, { error: "Scare house not found." });
    return send(res, 200, { house: row });
  } catch (error) {
    return send(res, error.status || 500, { error: error.message || "Could not update wait time." });
  }
}

async function handleStamps(req, res) {
  try {
    const session = requireStudent(req, res);
    if (!session) return;
    const num = session.studentNumber;
    const cards = await sb("stamp_cards", {
      query: `?student_number=eq.${encodeURIComponent(num)}&select=*`,
    });
    let card = Array.isArray(cards) ? cards[0] : null;
    if (!card) {
      const created = await sb("stamp_cards", {
        method: "POST",
        body: { student_number: num, stamps: {} },
      });
      card = Array.isArray(created) ? created[0] : created;
    }

    if (req.method === "GET") {
      return send(res, 200, {
        studentNumber: num,
        fullName: session.name,
        stamps: card.stamps || {},
        redeemedAt: card.redeemed_at || null,
        redeemedBy: card.redeemed_by || null,
        passId: `SP-FP-${num}`,
      });
    }

    if (req.method === "PUT" || req.method === "POST" || req.method === "PATCH") {
      return send(res, 403, { error: "Only signed-in staff can award stamps." });
    }

    return send(res, 405, { error: "Method not allowed" });
  } catch (error) {
    return send(res, error.status || 500, { error: error.message || "Stamp card failed." });
  }
}

async function handleAwardStamp(req, res) {
  if (req.method !== "POST") return send(res, 405, { error: "Method not allowed" });
  try {
    const session = requireAdmin(req, res);
    if (!session) return;
    const body = await readBody(req);
    const studentNumber = normalizeNumber(body.studentNumber);
    const boothId = String(body.boothId || body.slotId || "");
    if (!isAdminNumber(studentNumber)) {
      return send(res, 400, { error: "Enter a valid admin number, for example P1234567." });
    }
    if (!isBoothId(boothId)) {
      return send(res, 400, { error: "Choose a valid booth." });
    }

    const students = await sb("students", {
      query: `?student_number=eq.${encodeURIComponent(studentNumber)}&select=*`,
    });
    const student = Array.isArray(students) ? students[0] : null;
    if (!student) {
      return send(res, 404, { error: "No student found. They must sign in on Stamp Card once first." });
    }

    let cards = await sb("stamp_cards", {
      query: `?student_number=eq.${encodeURIComponent(studentNumber)}&select=*`,
    });
    let card = Array.isArray(cards) ? cards[0] : null;
    if (!card) {
      const created = await sb("stamp_cards", {
        method: "POST",
        body: { student_number: studentNumber, stamps: {} },
      });
      card = Array.isArray(created) ? created[0] : created;
    }

    const stamps = { ...(card.stamps || {}) };
    if (stamps[boothId]) {
      return send(res, 409, { error: "This student already has that booth stamp." });
    }

    stamps[boothId] = { by: session.staffId, at: Date.now(), boothId };
    const updated = await sb("stamp_cards", {
      method: "PATCH",
      query: `?student_number=eq.${encodeURIComponent(studentNumber)}`,
      body: { stamps, updated_at: new Date().toISOString() },
    });
    const next = Array.isArray(updated) ? updated[0] : updated;
    const booth = BOOTHS.find((b) => b.id === boothId);
    return send(res, 200, {
      studentNumber,
      fullName: student.full_name,
      stamps: next.stamps || stamps,
      awarded: boothId,
      boothName: booth ? booth.name : boothId,
    });
  } catch (error) {
    return send(res, error.status || 500, { error: error.message || "Could not award stamp." });
  }
}

function feedbackTargetOk(kind, targetId) {
  if (kind === "booth") return isBoothId(targetId);
  if (kind === "scare_house") return isHouseId(targetId);
  return false;
}

async function handleFeedback(req, res) {
  try {
    if (req.method === "POST") {
      const body = await readBody(req);
      const kind = String(body.kind || "").trim();
      const targetId = String(body.targetId || "").trim();
      const message = sanitizePlain(body.message, 1000);
      if (kind !== "scare_house" && kind !== "booth") {
        return send(res, 400, { error: "Choose Scare Houses or Booths." });
      }
      if (!feedbackTargetOk(kind, targetId)) {
        return send(res, 400, { error: "Choose a valid scare house or booth." });
      }
      if (message.length < 4 || message.length > 1000) {
        return send(res, 400, { error: "Feedback must be between 4 and 1000 characters." });
      }
      const student = verifyJwt(bearer(req));
      const row = {
        kind,
        target_id: targetId,
        message,
        student_number: student?.role === "student" ? student.studentNumber : null,
        created_at: new Date().toISOString(),
      };
      const inserted = await sb("event_feedback", { method: "POST", body: row });
      const saved = Array.isArray(inserted) ? inserted[0] : inserted;
      return send(res, 200, { ok: true, id: saved?.id || null });
    }

    if (req.method === "GET") {
      const session = requireAdmin(req, res);
      if (!session) return;
      const url = new URL(req.url, "http://localhost");
      const kind = (req.query && req.query.kind) || url.searchParams.get("kind") || "";
      const targetId = (req.query && req.query.target) || url.searchParams.get("target") || "";
      const parts = ["select=*&order=created_at.desc&limit=200"];
      if (kind === "scare_house" || kind === "booth") {
        parts.push(`kind=eq.${encodeURIComponent(kind)}`);
      }
      if (targetId && (isBoothId(targetId) || isHouseId(targetId))) {
        parts.push(`target_id=eq.${encodeURIComponent(targetId)}`);
      }
      const query = `?${parts.join("&")}`;
      const rows = await sb("event_feedback", { query });
      return send(res, 200, { feedback: Array.isArray(rows) ? rows : [] });
    }

    return send(res, 405, { error: "Method not allowed" });
  } catch (error) {
    return send(res, error.status || 500, { error: error.message || "Feedback failed." });
  }
}

async function handleAnnouncements(req, res) {
  try {
    if (req.method === "GET") {
      const url = new URL(req.url, "http://localhost");
      const all = ((req.query && req.query.all) || url.searchParams.get("all")) === "1";
      if (all) {
        const session = requireAdmin(req, res);
        if (!session) return;
        const rows = await sb("announcements", {
          query: "?select=*&order=created_at.desc&limit=50",
        });
        return send(res, 200, { announcements: Array.isArray(rows) ? rows : [] });
      }
      const rows = await sb("announcements", {
        query: "?select=*&active=eq.true&order=created_at.desc&limit=20",
      });
      return send(res, 200, { announcements: Array.isArray(rows) ? rows : [] });
    }

    if (req.method === "POST") {
      const session = requireAdmin(req, res);
      if (!session) return;
      const body = await readBody(req);
      const message = sanitizePlain(body.message, 400);
      if (message.length < 3 || message.length > 400) {
        return send(res, 400, { error: "Announcement must be between 3 and 400 characters." });
      }
      const inserted = await sb("announcements", {
        method: "POST",
        body: {
          message,
          posted_by: session.staffId,
          active: true,
          created_at: new Date().toISOString(),
        },
      });
      const saved = Array.isArray(inserted) ? inserted[0] : inserted;
      return send(res, 200, { announcement: saved });
    }

    if (req.method === "PATCH") {
      const session = requireAdmin(req, res);
      if (!session) return;
      const body = await readBody(req);
      const id = String(body.id || "").trim();
      if (!id) return send(res, 400, { error: "Missing announcement id." });
      const active = body.active !== false;
      const updated = await sb("announcements", {
        method: "PATCH",
        query: `?id=eq.${encodeURIComponent(id)}`,
        body: { active },
      });
      const row = Array.isArray(updated) ? updated[0] : updated;
      return send(res, 200, { announcement: row });
    }

    return send(res, 405, { error: "Method not allowed" });
  } catch (error) {
    return send(res, error.status || 500, { error: error.message || "Announcements failed." });
  }
}

async function handleRedeem(req, res) {
  if (req.method !== "POST") return send(res, 405, { error: "Method not allowed" });
  try {
    const session = requireStudent(req, res);
    if (!session) return;
    const body = await readBody(req);
    const passcode = String(body.passcode || "").trim();
    const staffId = normalizeName(body.staffId) || "staff";
    if (!checkPass(passcode, getEnv().adminPass)) {
      return send(res, 401, { error: "Incorrect facilitator passcode." });
    }
    const num = session.studentNumber;
    const cards = await sb("stamp_cards", {
      query: `?student_number=eq.${encodeURIComponent(num)}&select=*`,
    });
    const card = Array.isArray(cards) ? cards[0] : null;
    if (!card) return send(res, 404, { error: "Stamp card not found." });
    const filled = Object.keys(card.stamps || {}).length;
    if (filled < 6) return send(res, 400, { error: "All six stamps are required before redeem." });
    if (card.redeemed_at) {
      return send(res, 200, {
        redeemedAt: card.redeemed_at,
        redeemedBy: card.redeemed_by,
        already: true,
      });
    }
    const updated = await sb("stamp_cards", {
      method: "PATCH",
      query: `?student_number=eq.${encodeURIComponent(num)}`,
      body: {
        redeemed_at: new Date().toISOString(),
        redeemed_by: staffId,
        updated_at: new Date().toISOString(),
      },
    });
    const next = Array.isArray(updated) ? updated[0] : updated;
    return send(res, 200, {
      redeemedAt: next.redeemed_at,
      redeemedBy: next.redeemed_by,
      already: false,
    });
  } catch (error) {
    return send(res, error.status || 500, { error: error.message || "Redeem failed." });
  }
}

async function handleScores(req, res) {
  const GAMES = ["clicker", "memory", "catch"];
  try {
    const url = new URL(req.url, "http://localhost");
    const gameId = (req.query && req.query.game) || url.searchParams.get("game") || "";

    if (req.method === "GET") {
      if (gameId && GAMES.includes(gameId)) {
        const rows = await sb("game_scores", {
          query: `?game_id=eq.${encodeURIComponent(gameId)}&select=score,student_number,students(full_name)&order=score.desc&limit=5`,
        });
        const top = (Array.isArray(rows) ? rows : []).map((row) => ({
          score: row.score,
          name: (row.students && row.students.full_name) || "Student",
        }));
        let mine = null;
        const payload = verifyJwt(bearer(req));
        if (payload?.role === "student") {
          const own = await sb("game_scores", {
            query: `?student_number=eq.${encodeURIComponent(payload.studentNumber)}&game_id=eq.${encodeURIComponent(gameId)}&select=score`,
          });
          mine = Array.isArray(own) && own[0] ? own[0].score : 0;
        }
        return send(res, 200, { top, mine });
      }
      const session = requireStudent(req, res);
      if (!session) return;
      const own = await sb("game_scores", {
        query: `?student_number=eq.${encodeURIComponent(session.studentNumber)}&select=game_id,score`,
      });
      return send(res, 200, { scores: own || [] });
    }

    if (req.method === "PUT") {
      const session = requireStudent(req, res);
      if (!session) return;
      const body = await readBody(req);
      const id = String(body.gameId || "");
      const score = Math.floor(Number(body.score));
      if (!GAMES.includes(id)) return send(res, 400, { error: "Unknown game." });
      if (!Number.isFinite(score) || score < 0 || score > 999999999) {
        return send(res, 400, { error: "Invalid score." });
      }
      const existing = await sb("game_scores", {
        query: `?student_number=eq.${encodeURIComponent(session.studentNumber)}&game_id=eq.${encodeURIComponent(id)}&select=*`,
      });
      const row = Array.isArray(existing) ? existing[0] : null;
      if (row && score <= row.score) {
        return send(res, 200, { best: row.score, updated: false });
      }
      if (!row) {
        await sb("game_scores", {
          method: "POST",
          body: {
            student_number: session.studentNumber,
            game_id: id,
            score,
            updated_at: new Date().toISOString(),
          },
        });
      } else {
        await sb("game_scores", {
          method: "PATCH",
          query: `?student_number=eq.${encodeURIComponent(session.studentNumber)}&game_id=eq.${encodeURIComponent(id)}`,
          body: { score, updated_at: new Date().toISOString() },
        });
      }
      return send(res, 200, { best: score, updated: true });
    }

    return send(res, 405, { error: "Method not allowed" });
  } catch (error) {
    return send(res, error.status || 500, { error: error.message || "Scores failed." });
  }
}

module.exports = {
  JWT_TTL_SEC,
  getEnv,
  handleStudentAuth,
  handleAdminAuth,
  handleLogin,
  handleStamps,
  handleAwardStamp,
  handleFeedback,
  handleAnnouncements,
  handleRedeem,
  handleScores,
  handleWaitTimes,
};
