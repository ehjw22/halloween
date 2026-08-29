const crypto = require("crypto");

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
  return String(value || "").trim().toUpperCase().replace(/\s+/g, "");
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

function send(res, status, body) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.status(status).json(body);
}

async function readBody(req) {
  if (req.body && typeof req.body === "object" && !Buffer.isBuffer(req.body)) return req.body;
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
  try {
    const body = await readBody(req);
    const studentNumber = normalizeNumber(body.studentNumber);
    const fullName = normalizeName(body.fullName);
    if (!studentNumber || studentNumber.length < 4) {
      return send(res, 400, { error: "Enter a valid student number." });
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
        name = student.full_name;
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
            return send(res, 409, { error: "This student number already has a stamp card." });
          }
        } else {
          throw error;
        }
      }
    } else if (!namesMatch(row.full_name, fullName)) {
      return send(res, 401, { error: "Student number and name do not match." });
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
  try {
    const body = await readBody(req);
    const staffId = normalizeName(body.staffId);
    const passcode = String(body.passcode || "").trim();
    if (!staffId) return send(res, 400, { error: "Enter your staff ID or name." });
    if (!checkPass(passcode, getEnv().adminPass)) {
      return send(res, 401, { error: "Incorrect staff passcode." });
    }
    const token = signJwt({ role: "admin", staffId });
    return send(res, 200, {
      token,
      expiresIn: JWT_TTL_SEC,
      staff: { staffId },
    });
  } catch (error) {
    return send(res, error.status || 500, { error: error.message || "Staff sign-in failed." });
  }
}

function requireStudent(req, res) {
  const payload = verifyJwt(bearer(req));
  if (!payload || payload.role !== "student") {
    send(res, 401, { error: "Student session expired. Sign in again." });
    return null;
  }
  return payload;
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

    if (req.method === "PUT") {
      if (card.redeemed_at) {
        return send(res, 409, { error: "This Fast Pass has already been redeemed." });
      }
      const body = await readBody(req);
      const slotId = String(body.slotId || "");
      const staffId = normalizeName(body.staffId);
      const passcode = String(body.passcode || "").trim();
      if (!["1", "2", "3", "4", "5", "6"].includes(slotId)) {
        return send(res, 400, { error: "Invalid stamp slot." });
      }
      if (!staffId) return send(res, 400, { error: "Enter the staff ID / admin number." });
      if (!checkPass(passcode, getEnv().stampPass)) {
        return send(res, 401, { error: "Incorrect stamp password." });
      }

      const stamps = { ...(card.stamps || {}) };
      if (stamps[slotId]) {
        return send(res, 409, { error: "This slot is already stamped." });
      }

      stamps[slotId] = { by: staffId, at: Date.now() };
      const updated = await sb("stamp_cards", {
        method: "PATCH",
        query: `?student_number=eq.${encodeURIComponent(num)}`,
        body: { stamps, updated_at: new Date().toISOString() },
      });
      const next = Array.isArray(updated) ? updated[0] : updated;
      return send(res, 200, { stamps: next.stamps || stamps, redeemedAt: next.redeemed_at || null });
    }

    return send(res, 405, { error: "Method not allowed" });
  } catch (error) {
    return send(res, error.status || 500, { error: error.message || "Stamp card failed." });
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
  handleStamps,
  handleRedeem,
  handleScores,
};
