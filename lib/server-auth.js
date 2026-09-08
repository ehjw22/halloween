const crypto = require("crypto");
const { BOOTHS, isBoothId, isHouseId, boothIdFromCode } = require("./catalog");

const JWT_TTL_SEC = 8 * 60 * 60;
const JWT_ISS = "sp-scream-fest";
const MAX_JSON_BYTES = 32 * 1024;
const WEAK_JWT = "sp-scream-fest-local";
const WEAK_PASS = "SP2026";

function onHosted() {
  return Boolean(process.env.VERCEL);
}

function firstEnv(...names) {
  for (const name of names) {
    const value = process.env[name];
    if (value && String(value).trim()) return String(value).trim();
  }
  return "";
}

function tokenRole(jwt) {
  try {
    const mid = String(jwt || "").split(".")[1];
    if (!mid) return "";
    const json = Buffer.from(mid.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
    return String(JSON.parse(json).role || "");
  } catch {
    return "";
  }
}

function resolveSupabaseUrl() {
  return firstEnv("SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL", "VITE_SUPABASE_URL", "supabaseUrl");
}

function resolveAnonKey() {
  return firstEnv(
    "SUPABASE_ANON_KEY",
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    "VITE_SUPABASE_ANON_KEY",
    "supabaseAnonKey"
  );
}

function resolveServiceKey() {
  const direct = firstEnv(
    "SUPABASE_SERVICE_ROLE_KEY",
    "supabaseServiceRoleKey",
    "SUPABASE_SERVICE_KEY",
    "SERVICE_ROLE_KEY"
  );
  if (direct) return direct;
  const anon = resolveAnonKey();
  if (anon && tokenRole(anon) === "service_role") return anon;
  return "";
}

function resolveJwtSecret() {
  const explicit = firstEnv("JWT_SECRET", "jwtSecret", "SUPABASE_JWT_SECRET");
  if (explicit && explicit !== WEAK_JWT && explicit.length >= 16) return explicit;
  const service = resolveServiceKey();
  if (service) {
    return crypto.createHmac("sha256", "sp-scream-fest-hs256").update(service).digest("hex");
  }
  const adminPass = firstEnv("ADMIN_PASSCODE", "adminPasscode");
  if (adminPass && adminPass !== WEAK_PASS) {
    return crypto.createHmac("sha256", "sp-scream-fest-hs256").update(`admin:${adminPass}`).digest("hex");
  }
  const url = resolveSupabaseUrl();
  const anon = resolveAnonKey();
  if (onHosted() && url && anon) {
    return crypto.createHmac("sha256", "sp-scream-fest-hs256").update(`hosted:${url}:${anon}`).digest("hex");
  }
  if (!onHosted()) return WEAK_JWT;
  return "";
}

function getEnv() {
  const adminPass = firstEnv("ADMIN_PASSCODE", "adminPasscode") || (onHosted() ? "" : WEAK_PASS);
  return {
    url: resolveSupabaseUrl(),
    anon: resolveAnonKey(),
    service: resolveServiceKey(),
    jwtSecret: resolveJwtSecret(),
    adminPass,
    stampPass: firstEnv("STAMP_PASSCODE", "stampPasscode") || adminPass,
    waitPass: firstEnv("WAIT_PASSCODE", "waitPasscode") || adminPass,
  };
}

function hostedJwtOk() {
  const secret = getEnv().jwtSecret;
  return Boolean(secret && secret !== WEAK_JWT && secret.length >= 16);
}

function hostedDbOk() {
  const env = getEnv();
  return Boolean(env.url && (env.service || env.anon));
}

function hostedStaffOk() {
  return Boolean(String(getEnv().adminPass || "").trim());
}

function studentLoginReady() {
  return hostedJwtOk() && hostedDbOk();
}

function secretsOk() {
  const env = getEnv();
  if (!onHosted()) return Boolean(env.jwtSecret && env.adminPass);
  return hostedJwtOk() && Boolean(env.url && env.service);
}

function b64url(input) {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input);
  return buf.toString("base64url");
}

function signJwt(payload) {
  const secret = getEnv().jwtSecret;
  if (!secret || (onHosted() && (secret === WEAK_JWT || secret.length < 16))) {
    const err = new Error("JWT_SECRET is not set");
    err.status = 500;
    throw err;
  }
  const now = Math.floor(Date.now() / 1000);
  const body = { ...payload, iss: JWT_ISS, iat: now, exp: now + JWT_TTL_SEC };
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const mid = b64url(JSON.stringify(body));
  const data = `${header}.${mid}`;
  const sig = b64url(crypto.createHmac("sha256", secret).update(data).digest());
  return `${data}.${sig}`;
}

function verifyJwt(token) {
  const secret = getEnv().jwtSecret;
  if (!secret || !token || typeof token !== "string" || token.length > 4096) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [headerB64, mid, sig] = parts;
  try {
    const header = JSON.parse(Buffer.from(headerB64, "base64url").toString("utf8"));
    if (header.alg !== "HS256" || header.typ !== "JWT") return null;
  } catch {
    return null;
  }
  const expected = b64url(crypto.createHmac("sha256", secret).update(`${headerB64}.${mid}`).digest());
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(mid, "base64url").toString("utf8"));
    if (payload.iss !== JWT_ISS) return null;
    if (payload.role !== "student" && payload.role !== "admin") return null;
    if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

function normalizeNumber(value) {
  let id = String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
  if (/^[0-9]{7}$/.test(id)) id = `P${id}`;
  return id;
}

function normalizeName(value) {
  return String(value || "").trim().replace(/\s+/g, " ");
}

function foldName(value) {
  return normalizeName(value)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, "");
}

function namesMatch(a, b) {
  const left = foldName(a);
  const right = foldName(b);
  return Boolean(left) && left === right;
}

function checkPass(input, expected) {
  if (!expected) return false;
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
const localStudents = new Map();

function clientKey(req) {
  const fwd = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  return fwd || req.headers["x-real-ip"] || req.socket?.remoteAddress || "unknown";
}

function envPositiveInt(name, fallback) {
  const n = Number(process.env[name]);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(Math.floor(n), 1_000_000);
}

function rateLimit(req, max = 20, windowMs = 10 * 60 * 1000, bucket = "auth") {
  const cap = max === 20 ? envPositiveInt("LOGIN_RATE_MAX", 40) : max;
  const key = `${bucket}:${clientKey(req)}`;
  const now = Date.now();
  const row = authHits.get(key) || { n: 0, t: now };
  if (now - row.t > windowMs) {
    row.n = 0;
    row.t = now;
  }
  row.n += 1;
  authHits.set(key, row);
  if (authHits.size > 5000) {
    const first = authHits.keys().next().value;
    if (first) authHits.delete(first);
  }
  return row.n <= cap;
}

function send(res, status, body) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  const payload = body && typeof body === "object" ? { ...body } : { error: String(body || "") };
  if (status >= 500 && !payload.error) {
    payload.error = "Something went wrong. Try again.";
  }
  res.status(status).json(payload);
}

function publicErrorMessage(error, status) {
  if (error && error.public) return String(error.public);
  const raw = String((error && error.message) || "");
  if (/not configured|service role|SERVICE_ROLE/i.test(raw)) {
    return "Could not save to the database. Set SUPABASE_SERVICE_ROLE_KEY on Vercel, then redeploy.";
  }
  if (/permission denied|PGRST|row-level security|42501/i.test(raw)) {
    return "The database refused this write. Run the latest supabase/schema.sql, or set SUPABASE_SERVICE_ROLE_KEY.";
  }
  if (/relation .* does not exist|42P01/i.test(raw)) {
    return "A required table is missing. Run supabase/schema.sql in the Supabase SQL editor.";
  }
  if (status >= 500) return raw ? `Something went wrong. ${raw.slice(0, 160)}` : "Something went wrong. Try again.";
  return raw.slice(0, 200) || "Request failed.";
}

function fail(res, error, action) {
  const status = Number(error && error.status) || 500;
  const detail = String((error && (error.detail || error.message)) || "").slice(0, 280);
  const code = (error && error.code) || (status >= 500 ? "server" : "request");
  console.error("[scream]", action || "api", status, code, detail);
  return send(res, status, {
    error: publicErrorMessage(error, status),
    code,
    detail: detail || undefined,
  });
}

function parseJsonLimited(raw, maxBytes) {
  const text = String(raw || "");
  if (Buffer.byteLength(text, "utf8") > maxBytes) {
    const err = new Error("Payload too large.");
    err.status = 413;
    throw err;
  }
  if (!text) return {};
  try {
    const data = JSON.parse(text);
    if (!data || typeof data !== "object" || Array.isArray(data)) return {};
    return data;
  } catch (error) {
    if (error.status === 413) throw error;
    const err = new Error("Invalid JSON.");
    err.status = 400;
    throw err;
  }
}

async function readBody(req, maxBytes = MAX_JSON_BYTES) {
  if (Buffer.isBuffer(req.body)) {
    return parseJsonLimited(req.body.toString("utf8"), maxBytes);
  }
  if (req.body && typeof req.body === "object" && !Array.isArray(req.body)) {
    const encoded = JSON.stringify(req.body);
    if (Buffer.byteLength(encoded, "utf8") > maxBytes) {
      const err = new Error("Payload too large.");
      err.status = 413;
      throw err;
    }
    return req.body;
  }
  if (typeof req.body === "string") {
    return parseJsonLimited(req.body, maxBytes);
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) {
      const err = new Error("Payload too large.");
      err.status = 413;
      throw err;
    }
    chunks.push(chunk);
  }
  return parseJsonLimited(Buffer.concat(chunks).toString("utf8"), maxBytes);
}

function bearer(req) {
  const header = req.headers.authorization || req.headers.Authorization || "";
  const match = String(header).match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : "";
}

async function sb(path, { method = "GET", body, query = "", prefer } = {}) {
  const env = getEnv();
  const key = env.service || env.anon;
  if (!env.url || !key) {
    const err = new Error("Supabase is not configured");
    err.status = 503;
    err.code = "no-supabase";
    err.public = "Supabase URL or key is missing on Vercel.";
    throw err;
  }
  if (!/^[a-z0-9_]+$/i.test(path)) {
    const err = new Error("Invalid table");
    err.status = 500;
    throw err;
  }
  const res = await fetch(`${env.url}/rest/v1/${path}${query}`, {
    method,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      Accept: "application/json",
      "Content-Type": "application/json",
      Prefer: prefer || "return=representation",
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
    const pg = data && typeof data === "object" ? data : {};
    const err = new Error(pg.message || text || `Supabase ${res.status}`);
    err.status = res.status >= 400 && res.status < 500 ? res.status : 500;
    err.code = pg.code || `sb-${res.status}`;
    err.detail = [pg.details, pg.hint, pg.code, `HTTP ${res.status}`].filter(Boolean).join(" · ");
    throw err;
  }
  return data;
}

async function sbRpc(fn, args) {
  const env = getEnv();
  const key = env.service || env.anon;
  if (!env.url || !key) {
    const err = new Error("Supabase is not configured");
    err.status = 500;
    throw err;
  }
  if (!/^[a-z0-9_]+$/i.test(fn)) {
    const err = new Error("Invalid function");
    err.status = 500;
    throw err;
  }
  const res = await fetch(`${env.url}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(args),
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
    const pg = data && typeof data === "object" ? data : {};
    const err = new Error(pg.message || text || `RPC ${res.status}`);
    err.status = res.status >= 400 && res.status < 500 ? res.status : 500;
    err.code = pg.code || `rpc-${res.status}`;
    err.detail = [pg.details, pg.hint, pg.code, `HTTP ${res.status}`].filter(Boolean).join(" · ");
    throw err;
  }
  return data;
}

function studentConfigError() {
  if (!hostedJwtOk()) {
    return "Student sign-up needs a signing secret. Set JWT_SECRET (at least 16 characters) on Vercel.";
  }
  if (!hostedDbOk()) {
    return "Student sign-up needs SUPABASE_URL and a Supabase key on Vercel.";
  }
  return "";
}

async function handleStudentAuth(req, res) {
  if (req.method !== "POST") return send(res, 405, { error: "Method not allowed" });
  if (onHosted() && !studentLoginReady()) {
    return send(res, 503, { error: studentConfigError() || "Student sign-in is not configured." });
  }
  if (!rateLimit(req)) return send(res, 429, { error: "Too many attempts. Wait a few minutes." });
  try {
    const body = await readBody(req);
    req.body = body;
    return signInStudent(req, res, body);
  } catch (error) {
    return fail(res, error);
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

    if (!onHosted() && !getEnv().url) {
      const row = localStudents.get(studentNumber);
      if (!row) {
        localStudents.set(studentNumber, { student_number: studentNumber, full_name: fullName });
        const token = signJwt({ role: "student", studentNumber, name: fullName });
        return send(res, 200, {
          token,
          expiresIn: JWT_TTL_SEC,
          created: true,
          student: { studentNumber, fullName },
        });
      }
      if (!namesMatch(row.full_name, fullName)) {
        return send(res, 401, { error: "This admin number is already registered under a different name." });
      }
      const token = signJwt({ role: "student", studentNumber, name: row.full_name });
      return send(res, 200, {
        token,
        expiresIn: JWT_TTL_SEC,
        created: false,
        student: { studentNumber, fullName: row.full_name },
      });
    }

    const env = getEnv();
    if (env.service) {
      try {
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
            } catch {
              /* card is created on first stamps fetch */
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
                return send(res, 401, { error: "This admin number is already registered under a different name." });
              }
            } else if (error.status === 401 || error.status === 403) {
              throw error;
            } else {
              throw error;
            }
          }
        } else if (!namesMatch(row.full_name, fullName)) {
          return send(res, 401, { error: "This admin number is already registered under a different name." });
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
        if (error.status !== 401 && error.status !== 403) return fail(res, error);
      }
    }

    try {
      const registered = await sbRpc("register_scream_student", {
        p_number: studentNumber,
        p_name: fullName,
      });
      const row = registered && typeof registered === "object" && !Array.isArray(registered) ? registered : {};
      if (row.ok === false && row.error === "name_mismatch") {
        return send(res, 401, { error: "This admin number is already registered under a different name." });
      }
      if (row.ok === false && row.error === "bad_name") {
        return send(res, 400, { error: "Enter your full name as on your student card." });
      }
      if (row.ok === false && row.error === "bad_number") {
        return send(res, 400, { error: "Enter your admin number as P followed by 7 digits, for example P1234567." });
      }
      if (!row.ok) {
        return send(res, 503, {
          error: "Student sign-up could not write to Supabase. On Vercel add SUPABASE_SERVICE_ROLE_KEY, or run the latest supabase/schema.sql.",
        });
      }
      const name = row.full_name || fullName;
      const number = row.student_number || studentNumber;
      const token = signJwt({ role: "student", studentNumber: number, name });
      return send(res, 200, {
        token,
        expiresIn: JWT_TTL_SEC,
        created: Boolean(row.created),
        student: { studentNumber: number, fullName: name },
      });
    } catch {
      return send(res, 503, {
        error: "Student sign-up could not write to Supabase. On Vercel add SUPABASE_SERVICE_ROLE_KEY, or run the latest supabase/schema.sql.",
      });
    }
  } catch (error) {
    return fail(res, error);
  }
}

async function handleAdminAuth(req, res) {
  if (req.method !== "POST") return send(res, 405, { error: "Method not allowed" });
  if (onHosted() && (!hostedJwtOk() || !hostedStaffOk())) {
    return send(res, 503, { error: "Staff sign-in is not configured." });
  }
  if (!rateLimit(req, 12)) return send(res, 429, { error: "Too many attempts. Wait a few minutes." });
  try {
    const body = await readBody(req);
    req.body = body;
    return signInStaff(req, res, body);
  } catch (error) {
    return fail(res, error);
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
    const env = getEnv();
    let staffScopeName = "";
    if (checkPass(passcode, env.adminPass)) staffScopeName = "admin";
    else if (checkPass(passcode, env.stampPass)) staffScopeName = "stamps";
    else if (checkPass(passcode, env.waitPass)) staffScopeName = "waits";
    else return send(res, 401, { error: "Incorrect staff password." });
    const token = signJwt({ role: "admin", staffId, name: fullName, staffScope: staffScopeName });
    return send(res, 200, {
      token,
      expiresIn: JWT_TTL_SEC,
      staff: { staffId, fullName, staffScope: staffScopeName },
    });
  } catch (error) {
    return fail(res, error);
  }
}

async function handleLogin(req, res) {
  if (req.method !== "POST") return send(res, 405, { error: "Method not allowed" });
  try {
    const body = await readBody(req);
    req.body = body;
    const password = String(body.password || body.passcode || "").trim();
    const adminNumber = normalizeNumber(body.adminNumber || body.studentNumber || body.staffId);
    const fullName = body.fullName;
    if (password) {
      if (onHosted() && (!hostedJwtOk() || !hostedStaffOk())) {
        return send(res, 503, { error: "Staff sign-in is not configured." });
      }
      if (!rateLimit(req, 12)) return send(res, 429, { error: "Too many attempts. Wait a few minutes." });
      return signInStaff(req, res, { staffId: adminNumber, fullName, passcode: password });
    }
    if (onHosted() && !studentLoginReady()) {
      return send(res, 503, { error: studentConfigError() || "Student sign-in is not configured." });
    }
    if (!rateLimit(req)) return send(res, 429, { error: "Too many attempts. Wait a few minutes." });
    return signInStudent(req, res, { studentNumber: adminNumber, fullName });
  } catch (error) {
    return fail(res, error);
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

function requireAdmin(req, res) {
  const payload = verifyJwt(bearer(req));
  if (!payload || payload.role !== "admin") {
    send(res, 401, { error: "Staff session expired. Sign in again." });
    return null;
  }
  return payload;
}

function staffScope(session) {
  return session?.staffScope || "admin";
}

function requireScope(req, res, allowed) {
  const session = requireAdmin(req, res);
  if (!session) return null;
  const scope = staffScope(session);
  if (scope === "admin" || allowed.includes(scope)) return session;
  send(res, 403, { error: "This staff login cannot use that tool." });
  return null;
}

async function writeAudit(session, action, target, detail) {
  try {
    await sb("staff_audit", {
      method: "POST",
      body: {
        staff_id: session.staffId || "staff",
        action,
        target: String(target || ""),
        detail: detail || {},
        at: new Date().toISOString(),
      },
    });
  } catch {
    /* table may be missing in local demo */
  }
}

const HOUSE_STATUSES = new Set(["open", "busy", "closed", "at_capacity"]);

async function handleWaitTimes(req, res) {
  if (req.method !== "POST") return send(res, 405, { error: "Method not allowed" });
  if (!rateLimit(req, 80, 10 * 60 * 1000, "wait")) {
    return send(res, 429, { error: "Too many updates. Wait a moment." });
  }
  const session = requireScope(req, res, ["waits"]);
  if (!session) return;
  try {
    const env = getEnv();
    if (!env.url || (!env.service && !env.anon)) {
      return send(res, 503, {
        error: "Wait times cannot be saved. Set SUPABASE_URL and a Supabase key, then redeploy.",
      });
    }
    const body = await readBody(req);
    const id = String(body.id || "").trim();
    if (!isHouseId(id)) return send(res, 400, { error: "Unknown scare house." });
    const wait = Math.max(0, Math.min(240, Math.round(Number(body.wait_minutes) || 0)));
    const status = String(body.status || "").trim();
    if (!HOUSE_STATUSES.has(status)) return send(res, 400, { error: "Invalid house status." });
    const patch = {
      wait_minutes: wait,
      status,
      updated_at: new Date().toISOString(),
    };
    const name = String(body.name || id).slice(0, 80);

    let row = null;
    if (env.service) {
      try {
        const updated = await sb("scare_houses", {
          method: "PATCH",
          query: `?id=eq.${encodeURIComponent(id)}`,
          body: patch,
        });
        row = Array.isArray(updated) ? updated[0] : updated;
        if (!row) {
          const inserted = await sb("scare_houses", {
            method: "POST",
            query: "?on_conflict=id",
            body: { id, name, ...patch },
            prefer: "resolution=merge-duplicates,return=representation",
          });
          row = Array.isArray(inserted) ? inserted[0] : inserted;
        }
      } catch {
        try {
          const updated = await sb("scare_houses", {
            method: "PATCH",
            query: `?id=eq.${encodeURIComponent(id)}`,
            body: { wait_minutes: wait, status },
          });
          row = Array.isArray(updated) ? updated[0] : updated;
        } catch {
          row = null;
        }
      }
    }

    if (!row) {
      try {
        const result = await sbRpc("set_scare_house_wait", {
          p_id: id,
          p_wait: wait,
          p_status: status,
        });
        if (result && result.ok === false) {
          return send(res, 400, { error: "Could not save that scare house wait time." });
        }
        row = (result && result.house) || result;
      } catch {
        return send(res, 503, {
          error:
            "Wait times did not save. Add SUPABASE_SERVICE_ROLE_KEY on Vercel, or run the latest supabase/schema.sql in the SQL editor.",
        });
      }
    }

    if (!row || !row.id) {
      return send(res, 503, {
        error:
          "Wait times did not save. Add SUPABASE_SERVICE_ROLE_KEY on Vercel, or run the latest supabase/schema.sql in the SQL editor.",
      });
    }
    await writeAudit(session, "wait_update", id, { wait_minutes: wait, status });
    try {
      const { notifyHouseWatchers } = require("./push");
      await Promise.race([
        notifyHouseWatchers(id, { name: row.name, wait_minutes: wait, status }),
        new Promise((resolve) => setTimeout(resolve, 4000)),
      ]);
    } catch {
      /* push is optional */
    }
    return send(res, 200, { house: row });
  } catch (error) {
    return fail(res, error);
  }
}

async function handleStamps(req, res) {
  try {
    const session = requireStudent(req, res);
    if (!session) return;
    const num = session.studentNumber;
    let card = null;
    try {
      const cards = await sb("stamp_cards", {
        query: `?student_number=eq.${encodeURIComponent(num)}&select=*`,
      });
      card = Array.isArray(cards) ? cards[0] : null;
      if (!card) {
        const created = await sb("stamp_cards", {
          method: "POST",
          body: { student_number: num, stamps: {} },
        });
        card = Array.isArray(created) ? created[0] : created;
      }
    } catch {
      try {
        const remote = await sbRpc("get_scream_card", { p_number: num });
        if (remote && remote.ok) card = remote;
      } catch {
        card = { stamps: {}, redeemed_at: null, redeemed_by: null };
      }
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
    return fail(res, error);
  }
}

async function handleLookupStudent(req, res) {
  if (req.method !== "GET" && req.method !== "POST") return send(res, 405, { error: "Method not allowed" });
  try {
    const session = requireScope(req, res, ["stamps"]);
    if (!session) return;
    let studentNumber = "";
    if (req.method === "GET") {
      const url = new URL(req.url, "http://localhost");
      studentNumber = normalizeNumber((req.query && req.query.studentNumber) || url.searchParams.get("studentNumber"));
    } else {
      const body = await readBody(req);
      studentNumber = normalizeNumber(body.studentNumber);
    }
    if (!isAdminNumber(studentNumber)) {
      return send(res, 400, { error: "Enter a valid admin number, for example P1234567." });
    }
    const students = await sb("students", {
      query: `?student_number=eq.${encodeURIComponent(studentNumber)}&select=student_number,full_name`,
    });
    const student = Array.isArray(students) ? students[0] : null;
    if (!student) {
      return send(res, 404, { error: "No student found. They must sign in on Stamp Card once first." });
    }
    let stamps = {};
    let redeemedAt = null;
    let redeemedBy = null;
    try {
      const cards = await sb("stamp_cards", {
        query: `?student_number=eq.${encodeURIComponent(studentNumber)}&select=stamps,redeemed_at,redeemed_by`,
      });
      const card = Array.isArray(cards) ? cards[0] : null;
      stamps = (card && card.stamps) || {};
      redeemedAt = (card && card.redeemed_at) || null;
      redeemedBy = (card && card.redeemed_by) || null;
    } catch {
      stamps = {};
    }
    const stampCount = Object.keys(stamps).filter((id) => isBoothId(id)).length;
    return send(res, 200, {
      studentNumber: student.student_number,
      fullName: student.full_name,
      stamps,
      stampCount,
      redeemedAt,
      redeemedBy,
      passId: `SP-FP-${student.student_number}`,
    });
  } catch (error) {
    return fail(res, error);
  }
}

function firstRow(data) {
  if (Array.isArray(data)) return data[0] || null;
  if (data && typeof data === "object") return data;
  return null;
}

function asStampMap(raw) {
  let value = raw;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return {};
    }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out = {};
  Object.entries(value).forEach(([key, row]) => {
    if (row) out[String(key)] = row;
  });
  return out;
}

function hasBoothStamp(stamps, boothId) {
  const id = String(boothId);
  return Boolean(stamps[id] || stamps[Number(id)]);
}

async function awardViaRpc(studentNumber, boothId, staffId) {
  const remote = await sbRpc("award_scream_stamp", {
    p_number: studentNumber,
    p_booth: String(boothId),
    p_staff: staffId || "staff",
  });
  if (!remote || remote.ok === false) {
    const code = remote && remote.error;
    const err = new Error(
      code === "no_student"
        ? "No student found. They must sign in on Stamp Card once first."
        : code === "already"
          ? "This student already has that booth stamp."
          : code === "bad_booth"
            ? "Choose a valid booth."
            : "Could not award stamp. Run the latest supabase/schema.sql if this keeps failing."
    );
    err.status = code === "already" ? 409 : code === "no_student" ? 404 : 400;
    err.code = code || "award-rpc";
    throw err;
  }
  return remote;
}

async function handleAwardStamp(req, res) {
  if (req.method !== "POST") return send(res, 405, { error: "Method not allowed" });
  try {
    const session = requireScope(req, res, ["stamps"]);
    if (!session) return;
    const body = await readBody(req);
    const studentNumber = normalizeNumber(body.studentNumber);
    const boothId = boothIdFromCode(body.boothId || body.slotId || body.stationCode) || String(body.boothId || body.slotId || "");
    if (!isAdminNumber(studentNumber)) {
      return send(res, 400, { error: "Enter a valid admin number, for example P1234567." });
    }
    if (!isBoothId(boothId)) {
      return send(res, 400, { error: "Choose a valid booth." });
    }
    const booth = BOOTHS.find((b) => b.id === String(boothId));
    const staffId = session.staffId || session.name || "staff";

    let restError = null;
    try {
      const students = await sb("students", {
        query: `?student_number=eq.${encodeURIComponent(studentNumber)}&select=*`,
      });
      const student = firstRow(students);
      if (!student) {
        return send(res, 404, { error: "No student found. They must sign in on Stamp Card once first." });
      }

      let cards = await sb("stamp_cards", {
        query: `?student_number=eq.${encodeURIComponent(studentNumber)}&select=*`,
      });
      let card = firstRow(cards);
      if (!card) {
        try {
          const created = await sb("stamp_cards", {
            method: "POST",
            body: { student_number: studentNumber, stamps: {} },
          });
          card = firstRow(created);
        } catch (createErr) {
          cards = await sb("stamp_cards", {
            query: `?student_number=eq.${encodeURIComponent(studentNumber)}&select=*`,
          });
          card = firstRow(cards);
          if (!card) throw createErr;
        }
      }

      const stamps = asStampMap(card && card.stamps);
      if (hasBoothStamp(stamps, boothId)) {
        return send(res, 409, { error: "This student already has that booth stamp." });
      }

      stamps[String(boothId)] = { by: staffId, at: Date.now(), boothId: String(boothId) };
      const updated = await sb("stamp_cards", {
        method: "PATCH",
        query: `?student_number=eq.${encodeURIComponent(studentNumber)}`,
        body: { stamps, updated_at: new Date().toISOString() },
      });
      const next = firstRow(updated);
      await writeAudit(session, "award_stamp", studentNumber, { boothId, boothName: booth ? booth.name : boothId });
      return send(res, 200, {
        studentNumber,
        fullName: student.full_name,
        stamps: (next && next.stamps) || stamps,
        awarded: String(boothId),
        boothName: booth ? booth.name : boothId,
      });
    } catch (error) {
      restError = error;
    }

    try {
      const remote = await awardViaRpc(studentNumber, boothId, staffId);
      await writeAudit(session, "award_stamp", studentNumber, { boothId, boothName: booth ? booth.name : boothId, via: "rpc" });
      return send(res, 200, {
        studentNumber: remote.student_number || studentNumber,
        fullName: remote.full_name || "",
        stamps: remote.stamps || {},
        awarded: String(boothId),
        boothName: booth ? booth.name : boothId,
      });
    } catch (rpcError) {
      return fail(res, restError || rpcError, "award-stamp");
    }
  } catch (error) {
    return fail(res, error, "award-stamp");
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
      if (!rateLimit(req, 12, 10 * 60 * 1000)) {
        return send(res, 429, { error: "Too many feedback submissions. Wait a few minutes." });
      }
      const body = await readBody(req);
      const kind = String(body.kind || "").trim();
      const targetId = String(body.targetId || "").trim();
      const message = sanitizePlain(body.message, 1000);
      const rating = Math.round(Number(body.rating));
      const hasRating = Number.isFinite(rating) && rating >= 1 && rating <= 5;
      if (kind !== "scare_house" && kind !== "booth") {
        return send(res, 400, { error: "Choose Scare Houses or Booths." });
      }
      if (!feedbackTargetOk(kind, targetId)) {
        return send(res, 400, { error: "Choose a valid scare house or booth." });
      }
      if (!hasRating && (message.length < 4 || message.length > 1000)) {
        return send(res, 400, { error: "Add a star rating or write feedback between 4 and 1000 characters." });
      }
      const student = verifyJwt(bearer(req));
      const row = {
        kind,
        target_id: targetId,
        message: message || (hasRating ? `Rated ${rating}/5` : ""),
        rating: hasRating ? rating : null,
        student_number: student?.role === "student" ? student.studentNumber : null,
        created_at: new Date().toISOString(),
      };
      const inserted = await sb("event_feedback", { method: "POST", body: row });
      const saved = Array.isArray(inserted) ? inserted[0] : inserted;
      return send(res, 200, { ok: true, id: saved?.id || null });
    }

    if (req.method === "GET") {
      const session = requireScope(req, res, []);
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
    return fail(res, error);
  }
}

async function handleAnnouncements(req, res) {
  try {
    if (req.method === "GET") {
      const url = new URL(req.url, "http://localhost");
      const all = ((req.query && req.query.all) || url.searchParams.get("all")) === "1";
      if (!getEnv().url) {
        return send(res, 200, { announcements: [] });
      }
      if (all) {
        const session = requireScope(req, res, []);
        if (!session) return;
        const rows = await sb("announcements", {
          query: "?select=*&order=created_at.desc&limit=50",
        });
        return send(res, 200, { announcements: Array.isArray(rows) ? rows : [] });
      }
      const rows = await sb("announcements", {
        query: "?select=*&active=eq.true&order=created_at.desc&limit=40",
      });
      const now = Date.now();
      const live = (Array.isArray(rows) ? rows : []).filter((row) => {
        if (row.expires_at && new Date(row.expires_at).getTime() < now) return false;
        return true;
      }).slice(0, 20);
      return send(res, 200, { announcements: live });
    }

    if (req.method === "POST") {
      const session = requireScope(req, res, []);
      if (!session) return;
      const body = await readBody(req);
      const message = sanitizePlain(body.message, 400);
      if (message.length < 3 || message.length > 400) {
        return send(res, 400, { error: "Announcement must be between 3 and 400 characters." });
      }
      const audience = ["all", "house", "booths"].includes(body.audience) ? body.audience : "all";
      const houseId = audience === "house" && isHouseId(body.houseId) ? body.houseId : null;
      let expiresAt = null;
      if (body.expiresAt) {
        const exp = new Date(body.expiresAt);
        if (!Number.isNaN(exp.getTime())) expiresAt = exp.toISOString();
      } else if (Number(body.expiresMinutes) > 0) {
        expiresAt = new Date(Date.now() + Number(body.expiresMinutes) * 60000).toISOString();
      }
      const inserted = await sb("announcements", {
        method: "POST",
        body: {
          message,
          posted_by: session.staffId,
          active: true,
          audience,
          house_id: houseId,
          expires_at: expiresAt,
          created_at: new Date().toISOString(),
        },
      });
      const saved = Array.isArray(inserted) ? inserted[0] : inserted;
      return send(res, 200, { announcement: saved });
    }

    if (req.method === "PATCH") {
      const session = requireScope(req, res, []);
      if (!session) return;
      const body = await readBody(req);
      const id = String(body.id || "").trim();
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
        return send(res, 400, { error: "Missing announcement id." });
      }
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
    return fail(res, error);
  }
}

async function handleRedeem(req, res) {
  if (req.method !== "POST") return send(res, 405, { error: "Method not allowed" });
  if (!rateLimit(req, 12)) return send(res, 429, { error: "Too many attempts. Wait a few minutes." });
  try {
  const session = requireScope(req, res, ["stamps"]);
  if (!session) return;
  const body = await readBody(req);
  const studentNumber = normalizeNumber(body.studentNumber);
  if (!isAdminNumber(studentNumber)) {
    return send(res, 400, { error: "Enter a valid admin number, for example P1234567." });
  }
  const students = await sb("students", {
    query: `?student_number=eq.${encodeURIComponent(studentNumber)}&select=student_number,full_name`,
  });
  const student = Array.isArray(students) ? students[0] : null;
  if (!student) {
    return send(res, 404, { error: "No student found. They must sign in on Stamp Card once first." });
  }
  const cards = await sb("stamp_cards", {
    query: `?student_number=eq.${encodeURIComponent(studentNumber)}&select=*`,
  });
  const card = Array.isArray(cards) ? cards[0] : null;
  if (!card) return send(res, 404, { error: "Stamp card not found." });
  const filled = Object.keys(card.stamps || {}).filter((id) => isBoothId(id)).length;
  if (filled < 6) return send(res, 400, { error: "All six stamps are required before redeem." });
  const passId = `SP-FP-${studentNumber}`;
  if (card.redeemed_at) {
    return send(res, 200, {
      studentNumber,
      fullName: student.full_name,
      passId,
      redeemedAt: card.redeemed_at,
      redeemedBy: card.redeemed_by,
      already: true,
    });
  }
  const staffId = session.staffId || session.name || "staff";
  const updated = await sb("stamp_cards", {
    method: "PATCH",
    query: `?student_number=eq.${encodeURIComponent(studentNumber)}`,
    body: {
      redeemed_at: new Date().toISOString(),
      redeemed_by: staffId,
      updated_at: new Date().toISOString(),
    },
  });
  const next = Array.isArray(updated) ? updated[0] : updated;
  await writeAudit(session, "redeem_pass", studentNumber, { passId });
  return send(res, 200, {
    studentNumber,
    fullName: student.full_name,
    passId,
    redeemedAt: next.redeemed_at,
    redeemedBy: next.redeemed_by,
    already: false,
  });
  } catch (error) {
    return fail(res, error);
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
    return fail(res, error);
  }
}

async function handleGameSave(req, res) {
  try {
    const session = requireStudent(req, res);
    if (!session) return;
    if (req.method === "GET") {
      const rows = await sb("game_saves", {
        query: `?student_number=eq.${encodeURIComponent(session.studentNumber)}&game_id=eq.clicker&select=*`,
      });
      const row = Array.isArray(rows) ? rows[0] : null;
      return send(res, 200, { state: row?.state || null });
    }
    if (req.method === "PUT") {
      const body = await readBody(req, 24 * 1024);
      const rawState = body.state;
      if (!rawState || typeof rawState !== "object" || Array.isArray(rawState)) {
        return send(res, 400, { error: "Missing clicker state." });
      }
      let state;
      try {
        const raw = JSON.stringify(rawState);
        if (raw.length > 20000) return send(res, 413, { error: "Save is too large." });
        state = JSON.parse(raw);
      } catch {
        return send(res, 400, { error: "Missing clicker state." });
      }
      if (!state || typeof state !== "object" || Array.isArray(state)) {
        return send(res, 400, { error: "Missing clicker state." });
      }
      const existing = await sb("game_saves", {
        query: `?student_number=eq.${encodeURIComponent(session.studentNumber)}&game_id=eq.clicker&select=student_number`,
      });
      const row = Array.isArray(existing) ? existing[0] : null;
      const payload = {
        student_number: session.studentNumber,
        game_id: "clicker",
        state,
        updated_at: new Date().toISOString(),
      };
      if (!row) {
        await sb("game_saves", { method: "POST", body: payload });
      } else {
        await sb("game_saves", {
          method: "PATCH",
          query: `?student_number=eq.${encodeURIComponent(session.studentNumber)}&game_id=eq.clicker`,
          body: { state, updated_at: payload.updated_at },
        });
      }
      return send(res, 200, { ok: true });
    }
    return send(res, 405, { error: "Method not allowed" });
  } catch (error) {
    return fail(res, error);
  }
}

async function handleOps(req, res) {
  if (req.method !== "GET") return send(res, 405, { error: "Method not allowed" });
  const session = requireScope(req, res, []);
  if (!session) return;
  try {
    const students = await sb("students", { query: "?select=student_number" });
    const cards = await sb("stamp_cards", { query: "?select=stamps,redeemed_at" });
    const houses = await sb("scare_houses", { query: "?select=id,status" });
    const feedback = await sb("event_feedback", { query: "?select=id,rating,kind,target_id,created_at&order=created_at.desc&limit=80" });
    const audit = await sb("staff_audit", { query: "?select=*&order=at.desc&limit=25" }).catch(() => []);
    const cardRows = Array.isArray(cards) ? cards : [];
    const stampsPerBooth = {};
    BOOTHS.forEach((b) => {
      stampsPerBooth[b.id] = 0;
    });
    let fastPass = 0;
    cardRows.forEach((card) => {
      const stamps = card.stamps || {};
      const ids = Object.keys(stamps);
      ids.forEach((id) => {
        if (stampsPerBooth[id] != null) stampsPerBooth[id] += 1;
      });
      if (ids.length >= 6) fastPass += 1;
    });
    const houseRows = Array.isArray(houses) ? houses : [];
    const atCapacity = houseRows.filter((h) => h.status === "at_capacity").length;
    const fb = Array.isArray(feedback) ? feedback : [];
    const recentHours = Date.now() - 6 * 60 * 60 * 1000;
    const recentFeedback = fb.filter((row) => new Date(row.created_at).getTime() > recentHours).length;
    return send(res, 200, {
      students: Array.isArray(students) ? students.length : 0,
      stampsPerBooth,
      fastPassUnlocked: fastPass,
      housesAtCapacity: atCapacity,
      recentFeedback,
      audit: Array.isArray(audit) ? audit : [],
      feedbackSample: fb.slice(0, 20),
    });
  } catch (error) {
    return fail(res, error);
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
  handleLookupStudent,
  handleOps,
  handleGameSave,
  studentLoginReady,
  handlePush: (...args) => require("./push").handlePush(args[0], args[1], { requireStudent, readBody, fail }),
};
