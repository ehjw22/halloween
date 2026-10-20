const crypto = require("crypto");
const { BOOTHS, STAMP_BOOTH_IDS, STAFF_HOUSES, isBoothId, isStampBoothId, isHouseId, isStaffHouseId, boothIdFromCode } = require("./catalog");

let bcrypt = null;
try {
  bcrypt = require("bcryptjs");
} catch {
  bcrypt = null;
}

const STUDENT_TTL_SEC = 10 * 60 * 60;
const STAFF_TTL_SEC = 6 * 60 * 60;
const JWT_TTL_SEC = STUDENT_TTL_SEC;
const JWT_ISS = "sp-scream-fest";
const MAX_JSON_BYTES = 32 * 1024;
const WEAK_JWT = "sp-scream-fest-local";
const WEAK_PASS = "SP2026";
const COOKIE_STUDENT = "sp_scream_student";
const COOKIE_STAFF = "sp_scream_staff";
const UNDO_SECONDS = 120;
const STAFF_MAX_FAILURES = envPositiveInt("STAFF_ACCOUNT_FAIL_MAX", 5);
const STAFF_LOCK_SECONDS = 15 * 60;

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
  const key = firstEnv(
    "SUPABASE_ANON_KEY",
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    "VITE_SUPABASE_ANON_KEY",
    "supabaseAnonKey"
  );
  if (!key) return "";
  if (tokenRole(key) === "service_role") return "";
  return key;
}

function resolveServiceKey() {
  const direct = firstEnv(
    "SUPABASE_SERVICE_ROLE_KEY",
    "supabaseServiceRoleKey",
    "SUPABASE_SERVICE_KEY",
    "SERVICE_ROLE_KEY"
  );
  if (direct) return direct;
  const anon = firstEnv("SUPABASE_ANON_KEY", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "VITE_SUPABASE_ANON_KEY", "supabaseAnonKey");
  if (anon && tokenRole(anon) === "service_role") return anon;
  return "";
}

function jwtFromAdminPass() {
  const adminPass = firstEnv("ADMIN_PASSCODE", "adminPasscode");
  if (!adminPass || adminPass === WEAK_PASS) return "";
  return crypto.createHmac("sha256", "sp-scream-fest-hs256").update(`admin:${adminPass}`).digest("hex");
}

function resolveJwtSecret() {
  const explicit = firstEnv("JWT_SECRET", "jwtSecret", "SUPABASE_JWT_SECRET");
  if (explicit && explicit !== WEAK_JWT && explicit.length >= 16) return explicit;
  const service = resolveServiceKey();
  if (service) {
    return crypto.createHmac("sha256", "sp-scream-fest-hs256").update(service).digest("hex");
  }
  const fromPass = jwtFromAdminPass();
  if (fromPass) return fromPass;
  if (!onHosted()) return WEAK_JWT;
  return "";
}

/** Bump SESSION_EPOCH to sign every student and staff device out at once. */
function sessionEpoch() {
  return firstEnv("SESSION_EPOCH") || "2";
}

function getEnv() {
  const adminPass = firstEnv("ADMIN_PASSCODE", "adminPasscode") || (onHosted() ? "" : WEAK_PASS);
  return {
    url: resolveSupabaseUrl(),
    anon: resolveAnonKey(),
    service: resolveServiceKey(),
    jwtSecret: resolveJwtSecret(),
    adminPass,
    waitPass: firstEnv("WAIT_PASSCODE", "waitPasscode"),
    redeemPass: firstEnv("REDEEM_PASSCODE", "redeemPasscode"),
    boothPasses: boothPassMap(adminPass),
    housePasses: housePassMap(adminPass),
  };
}

function boothPassMap(adminPass) {
  const passes = {};
  BOOTHS.forEach((booth) => {
    if (!isStampBoothId(booth.id)) return;
    const pass = firstEnv(`BOOTH_${booth.code}_PASSCODE`);
    if (!passcodeConfigured(pass) || pass === adminPass) {
      if (pass && pass === adminPass) console.warn("[scream] booth-password-matches-admin", booth.code);
      return;
    }
    passes[booth.id] = pass;
  });
  return passes;
}

function housePassMap(adminPass) {
  const passes = {};
  STAFF_HOUSES.forEach((house) => {
    const pass = firstEnv(`HOUSE_${house.code}_PASSCODE`);
    if (!passcodeConfigured(pass) || pass === adminPass) {
      if (pass && pass === adminPass) console.warn("[scream] house-password-matches-admin", house.id);
      return;
    }
    passes[house.id] = pass;
  });
  return passes;
}

function hostedJwtOk() {
  const secret = getEnv().jwtSecret;
  return Boolean(secret && secret !== WEAK_JWT && secret.length >= 16);
}

function hostedDbOk() {
  const env = getEnv();
  return Boolean(env.url && env.service);
}

function isBcryptHash(value) {
  return /^\$2[abxy]\$\d{2}\$/.test(String(value || ""));
}

function passcodeConfigured(value) {
  const v = String(value || "").trim();
  if (!v || v === WEAK_PASS) return false;
  if (isBcryptHash(v)) return v.length >= 50;
  return v.length >= 8;
}

let warnedPlainPasscodes = false;
function warnPlainPasscodes(env) {
  if (warnedPlainPasscodes || !onHosted()) return;
  const plain = [env.adminPass, env.waitPass, env.redeemPass, ...Object.values(env.boothPasses), ...Object.values(env.housePasses)]
    .filter((pass) => pass && !isBcryptHash(pass));
  if (plain.length) {
    warnedPlainPasscodes = true;
    console.warn(`[scream] ${plain.length} staff passcode(s) are stored as plain text. Replace them with bcrypt hashes (npm run hash-passcode).`);
  }
}

function hostedStaffOk() {
  return passcodeConfigured(getEnv().adminPass);
}

function studentLoginReady() {
  return hostedJwtOk() && hostedDbOk();
}

function b64url(input) {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input);
  return buf.toString("base64url");
}

function signJwt(payload, ttl = STUDENT_TTL_SEC) {
  const secret = getEnv().jwtSecret;
  if (!secret || (onHosted() && (secret === WEAK_JWT || secret.length < 16))) {
    const err = new Error("JWT_SECRET is not set");
    err.status = 500;
    throw err;
  }
  const now = Math.floor(Date.now() / 1000);
  const body = {
    ...payload,
    iss: JWT_ISS,
    ep: sessionEpoch(),
    jti: crypto.randomBytes(9).toString("base64url"),
    iat: now,
    exp: now + ttl,
  };
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
  const a = Buffer.from(String(sig));
  const b = Buffer.from(String(expected));
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(mid, "base64url").toString("utf8"));
    if (payload.iss !== JWT_ISS) return null;
    if (payload.ep !== sessionEpoch()) return null;
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

function timingSafeEqualStr(a, b) {
  const left = crypto.createHash("sha256").update(String(a)).digest();
  const right = crypto.createHash("sha256").update(String(b)).digest();
  return crypto.timingSafeEqual(left, right) && String(a).length === String(b).length;
}

async function checkPass(input, expected) {
  if (!expected) return false;
  const secret = String(expected);
  if (isBcryptHash(secret)) {
    if (!bcrypt) return false;
    try {
      return await bcrypt.compare(String(input), secret);
    } catch {
      return false;
    }
  }
  return timingSafeEqualStr(input, secret);
}

function sanitizePlain(value, max = 1000) {
  return String(value || "")
    .replace(/<[^>]*>/g, "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .trim()
    .slice(0, max);
}

function isAdminNumber(value) {
  return /^P(22|23|24|25|26)[0-9]{5}$/.test(value);
}

const ADMIN_NUMBER_HINT =
  "Enter your admin number as P followed by 7 digits, starting with 22, 23, 24, 25, or 26 (for example P2509460).";
const STAFF_NUMBER_HINT = "Admin number should be P followed by 7 digits, starting with 22 to 26.";
function accountRole(row) {
  const role = String((row && (row.role || row.account_role || row.accountRole)) || "student")
    .toLowerCase()
    .trim();
  if (role === "admin" || role === "stamps" || role === "waits") return role;
  return "student";
}

function staffPublicFlags(row) {
  const role = accountRole(row);
  return { staffChallenge: role !== "student", accountRole: role };
}

function isStaffAccount(row) {
  return accountRole(row) !== "student";
}

function staffRoleRequired() {
  return onHosted() || process.env.REQUIRE_STAFF_ROLE === "1";
}

const memoryHits = new Map();
const localStudents = new Map();

function clientKey(req) {
  const real = String(req.headers["x-real-ip"] || "").trim();
  if (real) return real.slice(0, 64);
  const fwd = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  return (fwd || req.socket?.remoteAddress || "unknown").slice(0, 64);
}

function envPositiveInt(name, fallback) {
  const n = Number(process.env[name]);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(Math.floor(n), 1_000_000);
}

/**
 * Every rate limit in one place: [env var, default, window seconds].
 * Campus Wi-Fi puts thousands of phones behind a few public IPs, so per-IP limits are generous;
 * per-student and per-staff limits stay tight. Each value is read per request, so an env change
 * takes effect on the next deploy without code edits.
 */
const RATE = {
  loginIp: ["LOGIN_RATE_MAX", 5000, 600],
  loginNum: ["LOGIN_NUM_RATE_MAX", 25, 600],
  staffIp: ["STAFF_IP_RATE_MAX", 300, 15 * 60],
  wait: ["WAIT_RATE_MAX", 400, 600],
  lookup: ["LOOKUP_RATE_MAX", 600, 600],
  award: ["AWARD_RATE_MAX", 600, 600],
  unaward: ["UNAWARD_RATE_MAX", 40, 600],
  redeem: ["REDEEM_RATE_MAX", 300, 600],
  unredeem: ["UNREDEEM_RATE_MAX", 40, 600],
  feedbackIp: ["FEEDBACK_IP_RATE_MAX", 3000, 600],
  feedbackNum: ["FEEDBACK_NUM_RATE_MAX", 10, 600],
  announce: ["ANNOUNCE_RATE_MAX", 30, 600],
  scores: ["SCORES_RATE_MAX", 60, 600],
  pushIp: ["PUSH_IP_RATE_MAX", 3000, 600],
  stampsVersion: ["STAMPS_VERSION_RATE_MAX", 240, 600],
};

function rateOf(name) {
  const [env, fallback, windowSec] = RATE[name];
  return [envPositiveInt(env, fallback), windowSec];
}

function memoryHit(bucket, max, windowSec, peek = false) {
  const now = Date.now();
  const row = memoryHits.get(bucket) || { n: 0, t: now };
  if (now - row.t > windowSec * 1000) {
    row.n = 0;
    row.t = now;
  }
  if (!peek) row.n += 1;
  memoryHits.set(bucket, row);
  if (memoryHits.size > 10000) {
    const first = memoryHits.keys().next().value;
    if (first) memoryHits.delete(first);
  }
  const retryAfter = Math.max(0, Math.ceil((row.t + windowSec * 1000 - now) / 1000));
  return { ok: peek ? row.n < max : row.n <= max, retryAfter };
}

/**
 * Shared limiter. The in-memory check stops floods on a warm instance; the database row
 * makes the limit hold across every Vercel instance.
 */
async function limit(bucket, max, windowSec, { peek = false } = {}) {
  const local = memoryHit(bucket, max, windowSec, peek);
  if (!local.ok) return local;
  return remoteLimit(local, bucket, max, windowSec, { peek });
}

/** The database half of limit(): the row that makes a limit hold across every Vercel instance. */
async function remoteLimit(local, bucket, max, windowSec, { peek = false } = {}) {
  if (!getEnv().url || !privilegedKey()) return local;
  try {
    const remote = await sbRpc(peek ? "scream_rate_peek" : "scream_rate_hit", {
      p_bucket: bucket,
      p_max: max,
      p_window_seconds: windowSec,
    });
    if (remote && typeof remote === "object" && remote.ok === false) {
      return { ok: false, retryAfter: Number(remote.retry_after) || windowSec };
    }
  } catch (error) {
    console.warn("[scream] rate-limit store unavailable", String(error.code || error.status || ""));
  }
  return local;
}

async function resetLimit(bucket) {
  memoryHits.delete(bucket);
  if (!getEnv().url || !privilegedKey()) return;
  try {
    await sbRpc("scream_rate_reset", { p_bucket: bucket });
  } catch {
    /* the window expires on its own */
  }
}

function retryMinutes(sec) {
  const mins = Math.max(1, Math.ceil(Number(sec || 0) / 60));
  return mins === 1 ? "1 minute" : `${mins} minutes`;
}

function tooMany(res, retryAfter, message) {
  res.setHeader("Retry-After", String(Math.max(1, Math.round(retryAfter || 60))));
  return send(res, 429, { error: message || `Too many attempts. Try again in ${retryMinutes(retryAfter)}.`, code: "rate_limited" });
}

/** Responses are no-store unless a handler passes an explicit cache policy (public reads and private polls). */
function send(res, status, body, { cache = "no-store" } = {}) {
  res.setHeader("Cache-Control", status === 200 ? cache : "no-store");
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

function looksInternal(raw) {
  return /select\s+.+\s+from|insert\s+into|schema\.sql|sql editor|service_role|jwt_secret|supabase|postgres|pgrst|row-level security|permission denied|relation |duplicate key|unique constraint|check constraint|violates|sqlstate|syntax error|stack|at Object|\/api\/config|vercel|anon key|passcode|function .*does not exist/i.test(String(raw || ""));
}

function publicErrorMessage(error, status) {
  const offered = error && error.public ? String(error.public) : "";
  const raw = String((error && error.message) || "");
  if (offered && !looksInternal(offered)) return offered.slice(0, 200);
  if (looksInternal(raw) || status >= 500) return "Something went wrong. Try again.";
  if (error && error.status && error.status < 500 && raw) return raw.slice(0, 200);
  return "Something went wrong. Try again.";
}

function fail(res, error, action) {
  const status = Number(error && error.status) || 500;
  const detail = String((error && (error.detail || error.message)) || "").slice(0, 280);
  const code = (error && error.code) || (status >= 500 ? "server" : "request");
  console.error("[scream]", action || "api", status, code, detail);
  return send(res, status, {
    error: publicErrorMessage(error, status),
    code: status >= 500 ? "server" : code,
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
  if (onHosted()) return "";
  const header = req.headers.authorization || req.headers.Authorization || "";
  const match = String(header).match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim().slice(0, 4096) : "";
}

function cookieMap(req) {
  const raw = String(req.headers.cookie || "");
  const out = {};
  raw.split(";").forEach((part) => {
    const idx = part.indexOf("=");
    if (idx < 0) return;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (!key) return;
    try {
      out[key] = decodeURIComponent(value);
    } catch {
      out[key] = value;
    }
  });
  return out;
}

function cookieSecure(req) {
  if (onHosted()) return true;
  const proto = String(req.headers["x-forwarded-proto"] || req.headers["x-forwarded-protocol"] || "");
  return proto.toLowerCase().includes("https");
}

function cookieName(req, role) {
  const base = role === "admin" ? COOKIE_STAFF : COOKIE_STUDENT;
  return cookieSecure(req) ? `__Host-${base}` : base;
}

function appendCookie(res, cookie) {
  const prev = res.getHeader && res.getHeader("Set-Cookie");
  if (!prev) {
    res.setHeader("Set-Cookie", cookie);
    return;
  }
  const list = Array.isArray(prev) ? prev.concat(cookie) : [prev, cookie];
  res.setHeader("Set-Cookie", list);
}

function sessionCookie(req, name, token, maxAge) {
  const secure = cookieSecure(req) ? "; Secure" : "";
  return `${name}=${encodeURIComponent(token)}; HttpOnly; Path=/; Max-Age=${maxAge}; SameSite=Strict${secure}`;
}

function ttlFor(role) {
  return role === "admin" ? STAFF_TTL_SEC : STUDENT_TTL_SEC;
}

function setSessionCookie(res, req, role, token) {
  appendCookie(res, sessionCookie(req, cookieName(req, role), token, ttlFor(role)));
}

function clearSessionCookie(res, req, role) {
  const base = role === "admin" ? COOKIE_STAFF : COOKIE_STUDENT;
  appendCookie(res, sessionCookie(req, cookieName(req, role), "", 0));
  if (cookieSecure(req)) appendCookie(res, sessionCookie(req, base, "", 0));
}

function tokenForRole(req, role) {
  const header = bearer(req);
  if (header) {
    const payload = verifyJwt(header);
    if (payload && (!role || payload.role === role)) return header;
  }
  const cookies = cookieMap(req);
  const pick = (base) => cookies[`__Host-${base}`] || cookies[base] || "";
  if (role === "admin") return pick(COOKIE_STAFF);
  if (role === "student") return pick(COOKIE_STUDENT);
  return pick(COOKIE_STAFF) || pick(COOKIE_STUDENT);
}

function allowedOrigins(req) {
  const host = String(req.headers.host || "").toLowerCase();
  const list = new Set();
  if (host) {
    list.add(`https://${host}`);
    if (!onHosted()) list.add(`http://${host}`);
  }
  firstEnv("SITE_ORIGIN")
    .split(",")
    .map((value) => value.trim().toLowerCase().replace(/\/+$/, ""))
    .filter(Boolean)
    .forEach((value) => list.add(value));
  return list;
}

/** CSRF guard for every state-changing request: same origin, same site, JSON only. */
function sameOrigin(req) {
  const site = String(req.headers["sec-fetch-site"] || "").toLowerCase();
  if (site && site !== "same-origin" && site !== "none") return false;
  const origins = allowedOrigins(req);
  const origin = String(req.headers.origin || "").toLowerCase().replace(/\/+$/, "");
  if (origin) return origins.has(origin);
  const referer = String(req.headers.referer || "");
  if (referer) {
    try {
      return origins.has(new URL(referer).origin.toLowerCase());
    } catch {
      return false;
    }
  }
  return !onHosted();
}

function jsonRequest(req) {
  const type = String(req.headers["content-type"] || "").toLowerCase();
  return type.startsWith("application/json");
}

function privilegedKey() {
  const env = getEnv();
  if (env.service) return env.service;
  if (!onHosted()) return env.anon;
  return "";
}

function dbMissing() {
  const err = new Error("Supabase is not configured");
  err.status = 503;
  err.code = "no-supabase";
  err.public = "This tool is offline right now. Try again in a moment.";
  return err;
}

/**
 * Every database call gives up after SUPABASE_TIMEOUT_MS (default 8s). Without it a slow database
 * makes requests pile up inside the function for minutes instead of answering "try again".
 */
function dbTimeoutMs() {
  return envPositiveInt("SUPABASE_TIMEOUT_MS", 8000);
}

async function dbFetch(url, init, what) {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(dbTimeoutMs()) });
  } catch (error) {
    const timedOut = error && (error.name === "TimeoutError" || error.name === "AbortError");
    const err = new Error(timedOut ? `Database timed out (${what})` : `Database unreachable (${what})`);
    err.status = 503;
    err.code = timedOut ? "db-timeout" : "db-unreachable";
    err.detail = `${what} · ${(error && (error.cause?.code || error.name)) || "fetch"}`;
    throw err;
  }
}

async function sb(path, { method = "GET", body, query = "", prefer } = {}) {
  const env = getEnv();
  const key = privilegedKey();
  if (!env.url || !key) throw dbMissing();
  if (!/^[a-z0-9_]+$/i.test(path)) {
    const err = new Error("Invalid table");
    err.status = 500;
    throw err;
  }
  const res = await dbFetch(`${env.url}/rest/v1/${path}${query}`, {
    method,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      Accept: "application/json",
      "Content-Type": "application/json",
      Prefer: prefer || "return=representation",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  }, path);
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
  const key = privilegedKey();
  if (!env.url || !key) throw dbMissing();
  if (!/^[a-z0-9_]+$/i.test(fn)) {
    const err = new Error("Invalid function");
    err.status = 500;
    throw err;
  }
  const res = await dbFetch(`${env.url}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(args),
  }, fn);
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
    err.status = res.status >= 400 && res.status < 500 ? 503 : 500;
    err.code = pg.code || `rpc-${res.status}`;
    err.detail = [fn, pg.details, pg.hint, pg.code, `HTTP ${res.status}`].filter(Boolean).join(" · ");
    if (res.status === 404 || pg.code === "PGRST202" || pg.code === "42883") {
      console.error(`[scream] database function ${fn} is missing. Run the sign-in section of supabase/schema.sql on this project.`);
    }
    throw err;
  }
  return data;
}

function rpcMissing(error) {
  return /PGRST202|42883|rpc-404/.test(String((error && error.code) || ""));
}

function rpcObject(data) {
  if (Array.isArray(data)) return data[0] && typeof data[0] === "object" ? data[0] : {};
  return data && typeof data === "object" ? data : {};
}

function studentConfigError() {
  if (!hostedJwtOk()) {
    console.error("[scream] student sign-in is missing a signing secret");
    return "Sign-in is not available right now. Try again later.";
  }
  if (!hostedDbOk()) {
    console.error("[scream] student sign-in is missing the database");
    return "Sign-in is not available right now. Try again later.";
  }
  return "";
}

function staffConfigError() {
  if (!hostedStaffOk()) {
    console.error("[scream] staff sign-in is missing its password");
  } else if (!hostedJwtOk()) {
    console.error("[scream] staff sign-in is missing a signing secret");
  }
  return "Staff sign-in is not available right now. Try again later.";
}

async function handleStudentAuth(req, res) {
  if (req.method !== "POST") return send(res, 405, { error: "Method not allowed" });
  try {
    const body = await readBody(req);
    return signInStudent(req, res, body);
  } catch (error) {
    return fail(res, error);
  }
}

function signInRefusal(res, code) {
  if (code === "bad_number") return send(res, 400, { error: ADMIN_NUMBER_HINT, code });
  if (code === "bad_name") return send(res, 400, { error: "Enter your full name as on your student card.", code });
  if (code === "name_mismatch") return send(res, 409, { error: "This admin number is already registered.", code });
  return send(res, 401, {
    error: "That admin number and name don't match.",
    code: "bad_credentials",
  });
}

async function signInStudent(req, res, body) {
  try {
    if (onHosted() && !studentLoginReady()) {
      return send(res, 503, { error: studentConfigError() || "Student sign-in is not configured." });
    }
    const studentNumber = normalizeNumber(body.studentNumber || body.adminNumber);
    const fullName = sanitizePlain(normalizeName(body.fullName), 80);
    if (!isAdminNumber(studentNumber)) return signInRefusal(res, "bad_number");
    if (!fullName || fullName.length < 2) return signInRefusal(res, "bad_name");

    const ip = clientKey(req);
    const [ipMax, ipWindow] = rateOf("loginIp");
    const [numMax, numWindow] = rateOf("loginNum");
    // In-memory first: stops a flood on a warm instance without touching the database.
    const ipLocal = memoryHit(`login-ip:${ip}`, ipMax, ipWindow);
    if (!ipLocal.ok) return tooMany(res, ipLocal.retryAfter);
    const numLocal = memoryHit(`login-num:${studentNumber}`, numMax, numWindow);
    if (!numLocal.ok) return tooMany(res, numLocal.retryAfter);

    if (!getEnv().url) {
      if (onHosted()) return send(res, 503, { error: "Sign-in is not available right now. Try again later." });
      return signInLocalStudent(req, res, studentNumber, fullName);
    }

    const row = await studentSignInRow({ ip, studentNumber, fullName, ipMax, ipWindow, numMax, numWindow, ipLocal, numLocal });
    if (row.error === "rate_limited") return tooMany(res, row.retry_after);
    if (!row.ok) {
      if (row.error === "name_mismatch" || row.error === "bad_credentials") {
        console.warn("[scream] student-sign-in-fail", row.error, clientKey(req));
      }
      return signInRefusal(res, row.error);
    }
    const name = row.full_name || fullName;
    const number = row.student_number || studentNumber;
    const flags = staffPublicFlags(row);
    const token = signJwt({ role: "student", studentNumber: number, name, ...flags }, STUDENT_TTL_SEC);
    return sendAuth(req, res, "student", token, {
      created: Boolean(row.created),
      student: { studentNumber: number, fullName: name },
      ...flags,
    });
  } catch (error) {
    return fail(res, error, "student-sign-in");
  }
}

/**
 * One database round trip per sign-in: scream_student_login (supabase/signin-fast.sql) runs the
 * per-IP limit (sharded, no hot row), the per-number limit and the conflict-safe sign-in in one
 * transaction. Until that SQL is installed it falls back to the old three calls.
 */
async function studentSignInRow({ ip, studentNumber, fullName, ipMax, ipWindow, numMax, numWindow, ipLocal, numLocal }) {
  if (ipWindow === numWindow) {
    try {
      return rpcObject(await sbRpc("scream_student_login", {
        p_number: studentNumber,
        p_name: fullName,
        p_ip: ip,
        p_ip_max: ipMax,
        p_num_max: numMax,
        p_window_seconds: ipWindow,
      }));
    } catch (error) {
      if (!rpcMissing(error)) throw error;
      if (!warnedSlowSignIn) {
        warnedSlowSignIn = true;
        console.warn("[scream] scream_student_login is missing. Run supabase/signin-fast.sql; using the slower 3-call sign-in.");
      }
    }
  }
  const ipGate = await remoteLimit(ipLocal, `login-ip:${ip}`, ipMax, ipWindow);
  if (!ipGate.ok) return { ok: false, error: "rate_limited", retry_after: ipGate.retryAfter };
  const numGate = await remoteLimit(numLocal, `login-num:${studentNumber}`, numMax, numWindow);
  if (!numGate.ok) return { ok: false, error: "rate_limited", retry_after: numGate.retryAfter };
  return rpcObject(await sbRpc("scream_student_sign_in", { p_number: studentNumber, p_name: fullName }));
}

let warnedSlowSignIn = false;

async function signInLocalStudent(req, res, studentNumber, fullName) {
  let row = localStudents.get(studentNumber);
  let created = false;
  if (!row) {
    row = { student_number: studentNumber, full_name: fullName, role: "student" };
    localStudents.set(studentNumber, row);
    created = true;
  } else if (!namesMatch(row.full_name, fullName)) {
    return signInRefusal(res, "name_mismatch");
  }
  const flags = staffPublicFlags(row);
  const token = signJwt({ role: "student", studentNumber, name: row.full_name, ...flags }, STUDENT_TTL_SEC);
  return sendAuth(req, res, "student", token, {
    created,
    student: { studentNumber, fullName: row.full_name },
    ...flags,
  });
}

async function handleAdminAuth(req, res) {
  if (req.method === "GET") {
    const session = verifyJwt(tokenForRole(req, "admin"));
    if (!session || session.role !== "admin" || !isAdminNumber(session.staffId)) {
      return send(res, 200, { staff: null });
    }
    return send(res, 200, {
      staff: {
        staffId: session.staffId || "",
        fullName: session.name || "",
        staffScope: staffScope(session),
        expiresAt: session.exp ? new Date(session.exp * 1000).toISOString() : null,
      },
    });
  }
  if (req.method !== "POST") return send(res, 405, { error: "Method not allowed" });
  try {
    const body = await readBody(req);
    return signInStaff(req, res, body);
  } catch (error) {
    return fail(res, error);
  }
}

async function handleLogin(req, res) {
  if (req.method !== "POST") return send(res, 405, { error: "Method not allowed" });
  try {
    const body = await readBody(req);
    const password = String(body.password || body.passcode || "").trim();
    if (password) return signInStaff(req, res, { passcode: password });
    return signInStudent(req, res, body);
  } catch (error) {
    return fail(res, error);
  }
}

function sendAuth(req, res, role, token, extra, also = []) {
  setSessionCookie(res, req, role, token);
  (also || []).forEach((item) => {
    if (item && item.role && item.token) setSessionCookie(res, req, item.role, item.token);
  });
  const body = { expiresIn: ttlFor(role), ...extra };
  if (!onHosted()) {
    body.token = token;
    if (role === "student") body.studentToken = token;
    if (role === "admin") body.staffToken = token;
    also.forEach((item) => {
      if (item.role === "student") body.studentToken = item.token;
      if (item.role === "admin") body.staffToken = item.token;
    });
  }
  return send(res, 200, body);
}

async function staffAccountRow(staffId) {
  if (!getEnv().url) {
    return localStudents.get(staffId) || null;
  }
  const row = rpcObject(await sbRpc("scream_lookup_student", { p_number: staffId }));
  return row.ok ? row : null;
}

/**
 * Staff unlock. The caller must already hold a student session; the staff
 * password then picks exactly one scope. Admin number alone unlocks nothing.
 */
async function signInStaff(req, res, body) {
  try {
    if (onHosted() && (!hostedJwtOk() || !hostedStaffOk())) {
      return send(res, 503, { error: staffConfigError() });
    }
    const student = verifyJwt(tokenForRole(req, "student"));
    if (!student || student.role !== "student" || !isAdminNumber(student.studentNumber)) {
      return send(res, 401, { error: "Sign in with your admin number and full name first.", code: "no_student_session" });
    }
    const staffId = student.studentNumber;
    const passcode = String(body.passcode || body.password || "").trim().slice(0, 128);
    if (!passcode) return send(res, 400, { error: "Enter the staff password." });

    const ipBucket = `staff-ip:${clientKey(req)}`;
    const accountBucket = `staff-fail:${staffId}`;
    const ipGate = await limit(ipBucket, rateOf("staffIp")[0], STAFF_LOCK_SECONDS, { peek: true });
    if (!ipGate.ok) return tooMany(res, ipGate.retryAfter, `Too many staff password attempts. Try again in ${retryMinutes(ipGate.retryAfter)}.`);
    const accountGate = await limit(accountBucket, STAFF_MAX_FAILURES, STAFF_LOCK_SECONDS, { peek: true });
    if (!accountGate.ok) {
      return tooMany(res, accountGate.retryAfter, `Staff unlock is locked for ${retryMinutes(accountGate.retryAfter)} after too many wrong passwords.`);
    }

    const recordFailure = async () => {
      await limit(ipBucket, rateOf("staffIp")[0], STAFF_LOCK_SECONDS);
      await limit(accountBucket, STAFF_MAX_FAILURES, STAFF_LOCK_SECONDS);
    };

    const row = await staffAccountRow(staffId).catch(() => null);
    if (staffRoleRequired() && !isStaffAccount(row)) {
      await recordFailure();
      console.warn("[scream] staff-login-denied", clientKey(req));
      return send(res, 401, { error: "Staff sign-in failed." });
    }
    const env = getEnv();
    warnPlainPasscodes(env);
    const scopeName = await matchStaffScope(passcode, env);
    if (!scopeName) {
      await recordFailure();
      console.warn("[scream] staff-login-fail", clientKey(req));
      return send(res, 401, { error: "Staff sign-in failed. Check the password for your post." });
    }
    await resetLimit(accountBucket);
    const name = (row && row.full_name) || student.name;
    const token = signJwt({ role: "admin", staffId, name, staffScope: scopeName }, STAFF_TTL_SEC);
    return sendAuth(req, res, "admin", token, {
      staff: { staffId, fullName: name, staffScope: scopeName },
      student: { studentNumber: staffId, fullName: name },
      staffChallenge: true,
      accountRole: accountRole(row),
    });
  } catch (error) {
    return fail(res, error, "staff-sign-in");
  }
}

function requireStudent(req, res) {
  const payload = verifyJwt(tokenForRole(req, "student"));
  if (!payload || payload.role !== "student" || !isAdminNumber(payload.studentNumber)) {
    send(res, 401, { error: "Student session expired. Sign in again.", code: "no_session" });
    return null;
  }
  return payload;
}

function requireAdmin(req, res) {
  const payload = verifyJwt(tokenForRole(req, "admin"));
  if (!payload || payload.role !== "admin" || !isAdminNumber(payload.staffId)) {
    send(res, 401, { error: "Staff session expired. Sign in again.", code: "no_session" });
    return null;
  }
  return payload;
}

async function handleLogout(req, res) {
  if (req.method !== "POST") return send(res, 405, { error: "Method not allowed" });
  let role = "";
  try {
    const body = await readBody(req);
    role = String(body.role || "").trim();
  } catch {
    role = "";
  }
  if (role === "admin") clearSessionCookie(res, req, "admin");
  else {
    clearSessionCookie(res, req, "student");
    clearSessionCookie(res, req, "admin");
  }
  return send(res, 200, { ok: true });
}

function staffScope(session) {
  return session?.staffScope || "admin";
}

function boothIdFromScope(scope) {
  const match = /^booth:([0-9]+)$/.exec(String(scope || ""));
  return match && isStampBoothId(match[1]) ? match[1] : "";
}

function houseIdFromScope(scope) {
  const match = /^house:([a-z0-9-]+)$/.exec(String(scope || ""));
  return match && isStaffHouseId(match[1]) ? match[1] : "";
}

async function matchStaffScope(passcode, env) {
  const options = [];
  if (passcodeConfigured(env.adminPass) || (!onHosted() && env.adminPass)) options.push({ scope: "admin", pass: env.adminPass });
  if (passcodeConfigured(env.waitPass)) options.push({ scope: "waits", pass: env.waitPass });
  if (passcodeConfigured(env.redeemPass)) options.push({ scope: "redeem", pass: env.redeemPass });
  Object.entries(env.boothPasses || {}).forEach(([id, pass]) => {
    if (passcodeConfigured(pass)) options.push({ scope: `booth:${id}`, pass });
  });
  Object.entries(env.housePasses || {}).forEach(([id, pass]) => {
    if (passcodeConfigured(pass)) options.push({ scope: `house:${id}`, pass });
  });
  const checks = await Promise.all(options.map((option) => checkPass(passcode, option.pass)));
  const hits = options.filter((_, index) => checks[index]).map((option) => option.scope);
  if (hits.length > 1) {
    console.warn("[scream] staff-password-overlap", hits.join(","));
    return "";
  }
  return hits[0] || "";
}

function requireScope(req, res, allowed) {
  const session = requireAdmin(req, res);
  if (!session) return null;
  const scope = staffScope(session);
  const boothOk = allowed.includes("booth") && boothIdFromScope(scope);
  const houseOk = allowed.includes("house") && houseIdFromScope(scope);
  if (scope === "admin" || allowed.includes(scope) || boothOk || houseOk) return session;
  send(res, 403, { error: "This staff login cannot use that tool.", code: "wrong_scope" });
  return null;
}

async function writeAudit(session, action, target, detail) {
  try {
    await sb("staff_audit", {
      method: "POST",
      body: {
        staff_id: session.staffId || "staff",
        action,
        target: String(target || "").slice(0, 80),
        detail: detail || {},
        at: new Date().toISOString(),
      },
      prefer: "return=minimal",
    });
  } catch {
    /* the action itself already succeeded */
  }
}

function statusForWait(wait, closed) {
  if (closed) return "closed";
  if (wait >= 40) return "long";
  if (wait >= 21) return "busy";
  if (wait >= 6) return "open";
  return "gonow";
}

async function handleWaitTimes(req, res) {
  if (req.method !== "POST") return send(res, 405, { error: "Method not allowed" });
  const session = requireScope(req, res, ["waits", "house"]);
  if (!session) return;
  const gate = await limit(`wait:${session.staffId}`, ...rateOf("wait"));
  if (!gate.ok) return tooMany(res, gate.retryAfter, "Too many updates. Wait a moment.");
  let body;
  try {
    body = await readBody(req);
  } catch (error) {
    return fail(res, error);
  }
  const id = String(body.id || "").trim();
  if (!isHouseId(id)) return send(res, 400, { error: "Unknown scare house." });
  const lockedHouse = houseIdFromScope(staffScope(session));
  if (lockedHouse && lockedHouse !== id) {
    return send(res, 403, { error: "This staff login can only update its own scare house.", code: "wrong_house" });
  }
  const hasWait = body.wait_minutes !== undefined && body.wait_minutes !== null && body.wait_minutes !== "";
  const wait = hasWait ? Math.max(0, Math.min(240, Math.round(Number(body.wait_minutes) || 0))) : null;
  if (wait === null) return send(res, 400, { error: "Send a wait time." });
  // Optional: the updated_at the staff screen was looking at. The database refuses a stale save.
  const expectedMs = body.expected_updated_at ? Date.parse(String(body.expected_updated_at)) : NaN;
  try {
    const rpcArgs = {
      p_id: id,
      p_wait: wait,
      p_closed: null,
      p_staff: session.staffId,
      p_scope: staffScope(session),
    };
    if (Number.isFinite(expectedMs)) rpcArgs.p_expected_updated_at = new Date(expectedMs).toISOString();
    const result = rpcObject(await sbRpc("scream_set_wait", rpcArgs));
    if (result.error === "conflict") {
      return send(res, 409, {
        error: "Someone else just changed this wait time. Check the new number and try again.",
        code: "conflict",
        house: result.house || null,
      });
    }
    if (!result.ok || !result.house) {
      return send(res, 400, { error: "Could not save that scare house wait time." });
    }
    const row = result.house;
    const previousWait = result.previous_wait == null ? null : Number(result.previous_wait);
    try {
      const { notifyHouseWatchers } = require("./push");
      if (previousWait != null || result.previous_closed) {
        await Promise.race([
          notifyHouseWatchers(id, {
            name: row.name,
            wait_minutes: row.wait_minutes,
            status: row.status,
            previous: result.previous_closed ? 999 : previousWait,
          }),
          new Promise((resolve) => setTimeout(resolve, 4000)),
        ]);
      }
    } catch {
      /* push is optional */
    }
    return send(res, 200, { house: row });
  } catch (error) {
    return fail(res, error, "wait-times");
  }
}

const CACHE_VERSIONS = "public, s-maxage=5, stale-while-revalidate=20";
const CACHE_WAITS_PUBLIC = "public, s-maxage=10, stale-while-revalidate=30";
const CACHE_ANNOUNCE_PUBLIC = "public, s-maxage=30, stale-while-revalidate=60";
const CACHE_PRIVATE = "private, no-store";

function epochMs(value) {
  const t = Date.parse(String(value || ""));
  return Number.isFinite(t) ? t : 0;
}

/** One cheap RPC (two max() lookups on indexed columns). Falls back to two tiny reads if the RPC is not installed yet. */
async function readVersions() {
  try {
    const row = rpcObject(await sbRpc("scream_versions", {}));
    if (row.waits_v !== undefined) {
      return { waits_v: Number(row.waits_v) || 0, announce_v: Number(row.announce_v) || 0 };
    }
  } catch (error) {
    if (!rpcMissing(error)) throw error;
  }
  const newest = async (table, col) => {
    const rows = await sb(table, { query: `?select=${col}&order=${col}.desc&limit=1` });
    return Array.isArray(rows) && rows[0] ? epochMs(rows[0][col]) : 0;
  };
  const [waits, announce] = await Promise.all([
    newest("scare_houses", "updated_at"),
    newest("announcements", "updated_at").catch(() => newest("announcements", "created_at")),
  ]);
  return { waits_v: waits, announce_v: announce };
}

/** Public, CDN-cached (s-maxage=5). Phones poll this and fetch real data only when a number moves. */
async function handleVersions(req, res) {
  if (req.method !== "GET" && req.method !== "HEAD") return send(res, 405, { error: "Method not allowed" });
  try {
    const v = getEnv().url ? await readVersions() : { waits_v: 0, announce_v: 0 };
    return send(res, 200, { ...v, server_time: Date.now() }, { cache: CACHE_VERSIONS });
  } catch (error) {
    return fail(res, error, "versions");
  }
}

/** Public, CDN-cached wait times: only the columns the board needs. Writes still go through wait-times. */
async function handleWaitTimesPublic(req, res) {
  if (req.method !== "GET" && req.method !== "HEAD") return send(res, 405, { error: "Method not allowed" });
  try {
    if (!getEnv().url) return send(res, 200, { houses: [], waits_v: 0, local: true, server_time: Date.now() });
    const rows = await sb("scare_houses", { query: "?select=id,name,wait_minutes,status,updated_at&order=name" });
    const houses = Array.isArray(rows) ? rows : [];
    const waitsV = houses.reduce((max, row) => Math.max(max, epochMs(row.updated_at)), 0);
    return send(res, 200, { houses, waits_v: waitsV, server_time: Date.now() }, { cache: CACHE_WAITS_PUBLIC });
  } catch (error) {
    return fail(res, error, "wait-times-public");
  }
}

/** Private tiny poll for the open stamp card: the card's updated_at in ms. Moves on every stamp, undo and redeem. */
async function handleStampsVersion(req, res) {
  if (req.method !== "GET") return send(res, 405, { error: "Method not allowed" });
  try {
    const session = requireStudent(req, res);
    if (!session) return;
    const gate = memoryHit(`stamps-ver:${session.studentNumber}`, ...rateOf("stampsVersion"));
    if (!gate.ok) return tooMany(res, gate.retryAfter);
    if (!getEnv().url) return send(res, 200, { v: 0 }, { cache: CACHE_PRIVATE });
    const rows = await sb("stamp_cards", {
      query: `?student_number=eq.${encodeURIComponent(session.studentNumber)}&select=updated_at&limit=1`,
    });
    const v = Array.isArray(rows) && rows[0] ? epochMs(rows[0].updated_at) : 0;
    return send(res, 200, { v }, { cache: CACHE_PRIVATE });
  } catch (error) {
    return fail(res, error, "stamps-version");
  }
}

function cardResponse(row) {
  return {
    version: epochMs(row.updated_at),
    studentNumber: row.student_number,
    fullName: row.full_name,
    stamps: asStampMap(row.stamps),
    stampCount: Number(row.stamp_count) || Object.keys(asStampMap(row.stamps)).filter(isStampBoothId).length,
    redeemedAt: row.redeemed_at || null,
    redeemedBy: row.redeemed_by || null,
    updatedAt: row.updated_at || null,
    passId: `SP-FP-${row.student_number}`,
  };
}

async function handleStamps(req, res) {
  if (req.method !== "GET") {
    if (req.method === "PUT" || req.method === "POST" || req.method === "PATCH") {
      return send(res, 403, { error: "Only signed-in staff can award stamps." });
    }
    return send(res, 405, { error: "Method not allowed" });
  }
  try {
    const session = requireStudent(req, res);
    if (!session) return;
    const num = session.studentNumber;
    if (!getEnv().url) {
      return send(res, 200, { studentNumber: num, fullName: session.name, stamps: {}, stampCount: 0, redeemedAt: null, passId: `SP-FP-${num}` });
    }
    const row = rpcObject(await sbRpc("scream_lookup_student", { p_number: num }));
    if (!row.ok) {
      return send(res, 401, { error: "Student session expired. Sign in again.", code: "no_session" });
    }
    return send(res, 200, { ...cardResponse(row), fullName: row.full_name || session.name, ...staffPublicFlags(row) });
  } catch (error) {
    return fail(res, error, "stamps");
  }
}

async function lookupRow(studentNumber) {
  const row = rpcObject(await sbRpc("scream_lookup_student", { p_number: studentNumber }));
  return row.ok ? row : null;
}

function noStudent(res) {
  return send(res, 404, {
    error: "No student found for that admin number. They need to sign in on the Stamp card once first.",
    code: "no_student",
  });
}

async function handleLookupStudent(req, res) {
  if (req.method !== "GET" && req.method !== "POST") return send(res, 405, { error: "Method not allowed" });
  try {
    const session = requireScope(req, res, ["redeem", "booth"]);
    if (!session) return;
    let studentNumber = "";
    if (req.method === "GET") {
      const url = new URL(req.url, "http://localhost");
      studentNumber = normalizeNumber((req.query && req.query.studentNumber) || url.searchParams.get("studentNumber"));
    } else {
      const body = await readBody(req);
      studentNumber = normalizeNumber(body.studentNumber);
    }
    if (!isAdminNumber(studentNumber)) return send(res, 400, { error: STAFF_NUMBER_HINT });
    const gate = await limit(`lookup:${session.staffId}`, ...rateOf("lookup"));
    if (!gate.ok) return tooMany(res, gate.retryAfter);
    const row = await lookupRow(studentNumber);
    if (!row) return noStudent(res);
    return send(res, 200, cardResponse(row));
  } catch (error) {
    return fail(res, error, "lookup-student");
  }
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

function stampRefusal(res, code) {
  if (code === "no_student") return noStudent(res);
  if (code === "bad_booth") return send(res, 400, { error: "That booth does not take a stamp.", code });
  if (code === "bad_number") return send(res, 400, { error: STAFF_NUMBER_HINT, code });
  if (code === "not_stamped") return send(res, 409, { error: "This student does not have that stamp.", code });
  if (code === "window_closed") return send(res, 409, { error: "The two-minute undo window has closed.", code });
  if (code === "redeemed") return send(res, 409, { error: "The wheel ticket is already used, so this stamp stays.", code });
  return send(res, 400, { error: "Could not update that stamp card. Try again.", code: code || "stamp" });
}

function readBoothId(body) {
  return boothIdFromCode(body.boothId || body.slotId || body.stationCode) || String(body.boothId || body.slotId || "");
}

async function handleAwardStamp(req, res) {
  if (req.method !== "POST") return send(res, 405, { error: "Method not allowed" });
  try {
    const session = requireScope(req, res, ["booth"]);
    if (!session) return;
    const body = await readBody(req);
    const studentNumber = normalizeNumber(body.studentNumber);
    const boothId = readBoothId(body);
    if (!isAdminNumber(studentNumber)) return send(res, 400, { error: STAFF_NUMBER_HINT });
    if (!isStampBoothId(boothId)) return send(res, 400, { error: "That booth does not take a stamp." });
    const lockedBooth = boothIdFromScope(staffScope(session));
    if (lockedBooth && lockedBooth !== String(boothId)) {
      return send(res, 403, { error: "This staff login can only award its own booth.", code: "wrong_booth" });
    }
    const gate = await limit(`award:${session.staffId}`, ...rateOf("award"));
    if (!gate.ok) return tooMany(res, gate.retryAfter);
    const booth = BOOTHS.find((b) => b.id === String(boothId));
    const row = rpcObject(await sbRpc("scream_award_stamp", {
      p_number: studentNumber,
      p_booth: String(boothId),
      p_staff: session.staffId,
    }));
    if (!row.ok) return stampRefusal(res, row.error);
    return send(res, 200, {
      studentNumber: row.student_number,
      fullName: row.full_name || "",
      stamps: asStampMap(row.stamps),
      awarded: String(boothId),
      boothId: String(boothId),
      boothName: booth ? booth.name : boothId,
      already: Boolean(row.already),
    });
  } catch (error) {
    return fail(res, error, "award-stamp");
  }
}

async function handleUnawardStamp(req, res) {
  if (req.method !== "POST") return send(res, 405, { error: "Method not allowed" });
  try {
    const session = requireScope(req, res, ["booth"]);
    if (!session) return;
    const body = await readBody(req);
    const studentNumber = normalizeNumber(body.studentNumber);
    const boothId = readBoothId(body);
    if (!isAdminNumber(studentNumber)) return send(res, 400, { error: STAFF_NUMBER_HINT });
    if (!isStampBoothId(boothId)) return send(res, 400, { error: "That booth does not take a stamp." });
    const lockedBooth = boothIdFromScope(staffScope(session));
    if (lockedBooth && lockedBooth !== String(boothId)) {
      return send(res, 403, { error: "This staff login can only update its own booth.", code: "wrong_booth" });
    }
    const gate = await limit(`unaward:${session.staffId}`, ...rateOf("unaward"));
    if (!gate.ok) return tooMany(res, gate.retryAfter, "Too many undo attempts. Wait a few minutes.");
    const row = rpcObject(await sbRpc("scream_unaward_stamp", {
      p_number: studentNumber,
      p_booth: String(boothId),
      p_staff: session.staffId,
      p_window_seconds: UNDO_SECONDS,
    }));
    if (!row.ok) return stampRefusal(res, row.error);
    const booth = BOOTHS.find((b) => b.id === String(boothId));
    return send(res, 200, {
      studentNumber: row.student_number,
      fullName: row.full_name,
      stamps: asStampMap(row.stamps),
      boothId: String(boothId),
      boothName: booth ? booth.name : boothId,
    });
  } catch (error) {
    return fail(res, error, "unaward-stamp");
  }
}

function feedbackTargetOk(kind, targetId) {
  if (kind === "general") return targetId === "night";
  if (kind === "booth") return isBoothId(targetId);
  if (kind === "scare_house") return isHouseId(targetId);
  return false;
}

async function handleFeedback(req, res) {
  try {
    if (req.method === "POST") {
      const ipGate = await limit(`feedback-ip:${clientKey(req)}`, ...rateOf("feedbackIp"));
      if (!ipGate.ok) return tooMany(res, ipGate.retryAfter, "Too many feedback notes from this network. Try again in a few minutes.");
      const student = verifyJwt(tokenForRole(req, "student"));
      const studentNumber = student?.role === "student" ? student.studentNumber : null;
      if (studentNumber) {
        const mine = await limit(`feedback-num:${studentNumber}`, ...rateOf("feedbackNum"));
        if (!mine.ok) return tooMany(res, mine.retryAfter, "You have sent a lot of notes. Try again in a few minutes.");
      }
      const body = await readBody(req);
      const kind = String(body.kind || "").trim();
      const targetId = kind === "general" ? "night" : String(body.targetId || "").trim();
      const message = sanitizePlain(body.message, 1000);
      const rating = Math.round(Number(body.rating));
      const hasRating = Number.isFinite(rating) && rating >= 1 && rating <= 5;
      if (kind !== "general" && kind !== "scare_house" && kind !== "booth") {
        return send(res, 400, { error: "Choose General, Scare Houses, or Booths." });
      }
      if (!feedbackTargetOk(kind, targetId)) {
        return send(res, 400, { error: "Choose a valid scare house or booth." });
      }
      if (!hasRating && (message.length < 4 || message.length > 1000)) {
        return send(res, 400, { error: "Add a star rating or write feedback between 4 and 1000 characters." });
      }
      const row = {
        kind,
        target_id: targetId,
        message: message || (hasRating ? `Rated ${rating}/5` : ""),
        rating: hasRating ? rating : null,
        student_number: studentNumber,
        created_at: new Date().toISOString(),
      };
      try {
        await sbRpc("scream_add_feedback", {
          p_kind: row.kind,
          p_target: row.target_id,
          p_message: row.message,
          p_rating: row.rating,
          p_student: row.student_number,
        });
      } catch (error) {
        if (!rpcMissing(error)) throw error;
        await sb("event_feedback", { method: "POST", body: row, prefer: "return=minimal" });
      }
      return send(res, 200, { ok: true });
    }

    if (req.method === "GET") {
      const session = requireScope(req, res, []);
      if (!session) return;
      const url = new URL(req.url, "http://localhost");
      const kind = (req.query && req.query.kind) || url.searchParams.get("kind") || "";
      const targetId = (req.query && req.query.target) || url.searchParams.get("target") || "";
      const parts = ["select=id,kind,target_id,message,rating,student_number,created_at&order=created_at.desc&limit=200"];
      if (kind === "general" || kind === "scare_house" || kind === "booth") {
        parts.push(`kind=eq.${encodeURIComponent(kind)}`);
      }
      if (targetId && (isBoothId(targetId) || isHouseId(targetId))) {
        parts.push(`target_id=eq.${encodeURIComponent(targetId)}`);
      }
      const rows = await sb("event_feedback", { query: `?${parts.join("&")}` });
      return send(res, 200, { feedback: Array.isArray(rows) ? rows : [] });
    }

    return send(res, 405, { error: "Method not allowed" });
  } catch (error) {
    return fail(res, error, "feedback");
  }
}

function publicAnnouncement(row) {
  if (!row || typeof row !== "object") return null;
  return {
    id: row.id,
    message: row.message,
    created_at: row.created_at,
    audience: row.audience || "all",
    house_id: row.house_id || null,
    expires_at: row.expires_at || null,
    active: row.active !== false,
  };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
          query: "?select=id,message,posted_by,active,audience,house_id,expires_at,created_at&order=created_at.desc&limit=50",
        });
        return send(res, 200, { announcements: Array.isArray(rows) ? rows : [] });
      }
      const rows = await sb("announcements", {
        query: "?select=id,message,created_at,audience,house_id,expires_at,active&active=eq.true&order=created_at.desc&limit=40",
      });
      const now = Date.now();
      const live = (Array.isArray(rows) ? rows : [])
        .map(publicAnnouncement)
        .filter(Boolean)
        .filter((row) => !(row.expires_at && new Date(row.expires_at).getTime() < now))
        .slice(0, 20);
      return send(res, 200, { announcements: live }, { cache: CACHE_ANNOUNCE_PUBLIC });
    }

    if (req.method === "POST") {
      const session = requireScope(req, res, []);
      if (!session) return;
      const gate = await limit(`announce:${session.staffId}`, ...rateOf("announce"));
      if (!gate.ok) return tooMany(res, gate.retryAfter);
      const body = await readBody(req);
      const message = sanitizePlain(body.message, 400);
      if (message.length < 3 || message.length > 400) {
        return send(res, 400, { error: "Announcement must be between 3 and 400 characters." });
      }
      const audience = ["all", "house", "booths"].includes(body.audience) ? body.audience : "all";
      const houseId = audience === "house" && isHouseId(body.houseId) ? body.houseId : null;
      let expiresAt = null;
      const minutes = Math.round(Number(body.expiresMinutes));
      if (Number.isFinite(minutes) && minutes > 0) {
        expiresAt = new Date(Date.now() + Math.min(minutes, 24 * 60) * 60000).toISOString();
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
      await writeAudit(session, "announce_post", saved && saved.id, { audience, houseId });
      try {
        const { notifyAnnouncement } = require("./push");
        await Promise.race([
          notifyAnnouncement({ message, id: saved && saved.id }),
          new Promise((resolve) => setTimeout(resolve, 4000)),
        ]);
      } catch {
        /* push is optional */
      }
      return send(res, 200, { announcement: publicAnnouncement(saved) });
    }

    if (req.method === "PATCH") {
      const session = requireScope(req, res, []);
      if (!session) return;
      const body = await readBody(req);
      const id = String(body.id || "").trim();
      if (!UUID_RE.test(id)) return send(res, 400, { error: "Missing announcement id." });
      const active = body.active !== false;
      const updated = await sb("announcements", {
        method: "PATCH",
        query: `?id=eq.${encodeURIComponent(id)}`,
        body: { active },
      });
      const row = Array.isArray(updated) ? updated[0] : updated;
      await writeAudit(session, active ? "announce_on" : "announce_off", id, {});
      return send(res, 200, { announcement: publicAnnouncement(row) });
    }

    return send(res, 405, { error: "Method not allowed" });
  } catch (error) {
    return fail(res, error, "announcements");
  }
}

function redeemRefusal(res, row) {
  if (row.error === "no_student") return noStudent(res);
  if (row.error === "bad_number") return send(res, 400, { error: STAFF_NUMBER_HINT, code: row.error });
  if (row.error === "needs_stamps") {
    const filled = Number(row.stamp_count) || 0;
    return send(res, 409, {
      error: `Needs ${STAMP_BOOTH_IDS.length}/${STAMP_BOOTH_IDS.length} stamps. This card has ${filled}.`,
      code: "needs_stamps",
      stampCount: filled,
    });
  }
  if (row.error === "not_redeemed") return send(res, 409, { error: "This ticket is not marked used.", code: row.error });
  if (row.error === "window_closed") return send(res, 409, { error: "The two-minute undo window has closed.", code: row.error });
  return send(res, 400, { error: "Could not update that wheel ticket. Try again.", code: row.error || "redeem" });
}

async function handleRedeem(req, res) {
  if (req.method !== "POST") return send(res, 405, { error: "Method not allowed" });
  try {
    const session = requireScope(req, res, ["redeem"]);
    if (!session) return;
    const gate = await limit(`redeem:${session.staffId}`, ...rateOf("redeem"));
    if (!gate.ok) return tooMany(res, gate.retryAfter);
    const body = await readBody(req);
    const studentNumber = normalizeNumber(body.studentNumber);
    if (!isAdminNumber(studentNumber)) return send(res, 400, { error: STAFF_NUMBER_HINT });
    const row = rpcObject(await sbRpc("scream_redeem_pass", { p_number: studentNumber, p_staff: session.staffId }));
    if (!row.ok) return redeemRefusal(res, row);
    return send(res, 200, {
      studentNumber: row.student_number,
      fullName: row.full_name,
      passId: `SP-FP-${row.student_number}`,
      redeemedAt: row.redeemed_at,
      redeemedBy: row.redeemed_by,
      stampCount: Number(row.stamp_count) || 0,
      already: Boolean(row.already),
    });
  } catch (error) {
    return fail(res, error, "redeem");
  }
}

async function handleUnredeem(req, res) {
  if (req.method !== "POST") return send(res, 405, { error: "Method not allowed" });
  try {
    const session = requireScope(req, res, ["redeem"]);
    if (!session) return;
    const gate = await limit(`unredeem:${session.staffId}`, ...rateOf("unredeem"));
    if (!gate.ok) return tooMany(res, gate.retryAfter, "Too many undo attempts. Wait a few minutes.");
    const body = await readBody(req);
    const studentNumber = normalizeNumber(body.studentNumber);
    if (!isAdminNumber(studentNumber)) return send(res, 400, { error: STAFF_NUMBER_HINT });
    const row = rpcObject(await sbRpc("scream_unredeem_pass", {
      p_number: studentNumber,
      p_staff: session.staffId,
      p_window_seconds: UNDO_SECONDS,
    }));
    if (!row.ok) return redeemRefusal(res, row);
    return send(res, 200, {
      studentNumber: row.student_number,
      fullName: row.full_name,
      passId: `SP-FP-${row.student_number}`,
      redeemedAt: null,
    });
  } catch (error) {
    return fail(res, error, "unredeem");
  }
}

/** Only used until supabase/scale-3000.sql has been run: read, then write (not race-proof). */
async function saveScoreLegacy(studentNumber, id, score) {
  const who = encodeURIComponent(studentNumber);
  const game = encodeURIComponent(id);
  const existing = await sb("game_scores", { query: `?student_number=eq.${who}&game_id=eq.${game}&select=score` });
  const row = Array.isArray(existing) ? existing[0] : null;
  if (row && score <= row.score) return { ok: true, best: row.score, updated: false };
  if (!row) {
    await sb("game_scores", {
      method: "POST",
      body: { student_number: studentNumber, game_id: id, score, updated_at: new Date().toISOString() },
    });
  } else {
    await sb("game_scores", {
      method: "PATCH",
      query: `?student_number=eq.${who}&game_id=eq.${game}`,
      body: { score, updated_at: new Date().toISOString() },
    });
  }
  return { ok: true, best: score, updated: true };
}

async function handleScores(req, res) {
  const GAMES = ["clicker", "memory", "catch"];
  try {
    const url = new URL(req.url, "http://localhost");
    const gameId = (req.query && req.query.game) || url.searchParams.get("game") || "";

    if (req.method === "GET") {
      if (gameId && GAMES.includes(gameId)) {
        const rows = await sb("game_scores", {
          query: `?game_id=eq.${encodeURIComponent(gameId)}&select=score&order=score.desc&limit=5`,
        });
        const top = (Array.isArray(rows) ? rows : []).map((row) => ({
          score: row.score,
        }));
        let mine = null;
        const payload = verifyJwt(tokenForRole(req, "student"));
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
      const gate = await limit(`scores:${session.studentNumber}`, ...rateOf("scores"));
      if (!gate.ok) return tooMany(res, gate.retryAfter, "Too many score saves. Wait a moment.");
      const body = await readBody(req);
      const id = String(body.gameId || "");
      const score = Math.floor(Number(body.score));
      if (!GAMES.includes(id)) return send(res, 400, { error: "Unknown game." });
      if (!Number.isFinite(score) || score < 0 || score > 999999999) {
        return send(res, 400, { error: "Invalid score." });
      }
      let saved;
      try {
        saved = rpcObject(await sbRpc("scream_save_score", { p_number: session.studentNumber, p_game: id, p_score: score }));
      } catch (error) {
        if (!rpcMissing(error)) throw error;
        saved = await saveScoreLegacy(session.studentNumber, id, score);
      }
      if (!saved.ok) return send(res, 400, { error: "Invalid score." });
      return send(res, 200, { best: Number(saved.best) || 0, updated: Boolean(saved.updated) });
    }

    return send(res, 405, { error: "Method not allowed" });
  } catch (error) {
    return fail(res, error, "scores");
  }
}

async function handleGameSave(req, res) {
  try {
    const session = requireStudent(req, res);
    if (!session) return;
    if (req.method === "GET") {
      const rows = await sb("game_saves", {
        query: `?student_number=eq.${encodeURIComponent(session.studentNumber)}&game_id=eq.clicker&select=state`,
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
        state = JSON.parse(raw, (key, val) => {
          if (key === "__proto__" || key === "constructor" || key === "prototype") return undefined;
          return val;
        });
      } catch {
        return send(res, 400, { error: "Missing clicker state." });
      }
      if (!state || typeof state !== "object" || Array.isArray(state)) {
        return send(res, 400, { error: "Missing clicker state." });
      }
      await sb("game_saves", {
        method: "POST",
        query: "?on_conflict=student_number,game_id",
        prefer: "resolution=merge-duplicates,return=minimal",
        body: {
          student_number: session.studentNumber,
          game_id: "clicker",
          state,
          updated_at: new Date().toISOString(),
        },
      });
      return send(res, 200, { ok: true });
    }
    return send(res, 405, { error: "Method not allowed" });
  } catch (error) {
    return fail(res, error, "game-save");
  }
}

async function handleOps(req, res) {
  if (req.method !== "GET") return send(res, 405, { error: "Method not allowed" });
  const session = requireScope(req, res, []);
  if (!session) return;
  try {
    const data = rpcObject(await sbRpc("scream_ops_summary", { p_audit_limit: 30 }));
    const perBooth = data.stamps_per_booth && typeof data.stamps_per_booth === "object" ? data.stamps_per_booth : {};
    const stampsPerBooth = {};
    STAMP_BOOTH_IDS.forEach((id) => {
      stampsPerBooth[id] = Number(perBooth[id]) || 0;
    });
    return send(res, 200, {
      students: Number(data.students) || 0,
      stampsPerBooth,
      fastPassUnlocked: Number(data.fast_pass_unlocked) || 0,
      redeemed: Number(data.redeemed) || 0,
      housesBusy: Number(data.houses_busy) || 0,
      housesLong: Number(data.houses_long) || 0,
      housesClosed: Number(data.houses_closed) || 0,
      recentFeedback: Number(data.recent_feedback) || 0,
      audit: Array.isArray(data.audit) ? data.audit : [],
    });
  } catch (error) {
    return fail(res, error, "ops");
  }
}

async function handlePushRoute(req, res) {
  if (req.method !== "GET") {
    const gate = await limit(`push-ip:${clientKey(req)}`, ...rateOf("pushIp"));
    if (!gate.ok) return tooMany(res, gate.retryAfter, "Too many notification updates. Wait a few minutes.");
  }
  return require("./push").handlePush(req, res, { readBody, fail, verifyJwt, tokenForRole });
}

module.exports = {
  JWT_TTL_SEC,
  STAFF_TTL_SEC,
  getEnv,
  handleStudentAuth,
  handleAdminAuth,
  handleLogin,
  handleStamps,
  handleAwardStamp,
  handleUnawardStamp,
  handleFeedback,
  handleAnnouncements,
  handleRedeem,
  handleUnredeem,
  handleScores,
  handleWaitTimes,
  handleVersions,
  handleWaitTimesPublic,
  handleStampsVersion,
  PUBLIC_CACHE: {
    versions: CACHE_VERSIONS,
    "wait-times-public": CACHE_WAITS_PUBLIC,
    announcements: CACHE_ANNOUNCE_PUBLIC,
  },
  handleLookupStudent,
  handleOps,
  handleGameSave,
  handleLogout,
  studentLoginReady,
  sameOrigin,
  jsonRequest,
  verifyJwt,
  tokenForRole,
  statusForWait,
  handlePush: handlePushRoute,
};
