const crypto = require("crypto");
const { BOOTHS, isBoothId, isHouseId, boothIdFromCode } = require("./catalog");

let bcrypt = null;
try {
  bcrypt = require("bcryptjs");
} catch {
  bcrypt = null;
}

const JWT_TTL_SEC = 8 * 60 * 60;
const JWT_ISS = "sp-scream-fest";
const MAX_JSON_BYTES = 32 * 1024;
const WEAK_JWT = "sp-scream-fest-local";
const WEAK_PASS = "SP2026";
const COOKIE_STUDENT = "sp_scream_student";
const COOKIE_STAFF = "sp_scream_staff";

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
  const anon = resolveAnonKey();
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
  return Boolean(env.url && env.service);
}

function passcodeConfigured(value) {
  const v = String(value || "").trim();
  if (!v || v === WEAK_PASS) return false;
  if (/^\$2[abxy]\$/.test(v)) return v.length >= 50;
  return v.length >= 8;
}

function hostedStaffOk() {
  return passcodeConfigured(getEnv().adminPass);
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
  const a = Buffer.from(String(sig));
  const b = Buffer.from(String(expected));
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

function timingSafeEqualStr(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  const size = Math.max(left.length, right.length, 1);
  const x = Buffer.alloc(size);
  const y = Buffer.alloc(size);
  left.copy(x);
  right.copy(y);
  return crypto.timingSafeEqual(x, y) && left.length === right.length;
}

async function checkPass(input, expected) {
  if (!expected) return false;
  const secret = String(expected);
  if (/^\$2[abxy]\$/.test(secret)) {
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

function rateLimit(req, max = 40, windowMs = 10 * 60 * 1000, bucket = "auth") {
  const cap = bucket === "auth" ? envPositiveInt("LOGIN_RATE_MAX", max) : max;
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
    return "Could not save to the database. Staff: set the service role key on the host, then redeploy.";
  }
  if (/permission denied|PGRST|row-level security|42501/i.test(raw)) {
    return "The database refused this write. Staff: run the latest schema and set the service role key.";
  }
  if (/relation .* does not exist|42P01/i.test(raw)) {
    return "A required table is missing. Staff: run supabase/schema.sql in the SQL editor.";
  }
  if (status >= 500) return "Something went wrong. Try again.";
  if (error && error.status && error.status < 500 && raw && !/sql|postgres|stack|at Object/i.test(raw)) {
    return raw.slice(0, 200);
  }
  return "Request failed.";
}

function fail(res, error, action) {
  const status = Number(error && error.status) || 500;
  const detail = String((error && (error.detail || error.message)) || "").slice(0, 280);
  const code = (error && error.code) || (status >= 500 ? "server" : "request");
  console.error("[scream]", action || "api", status, code, detail);
  const body = {
    error: publicErrorMessage(error, status),
    code,
  };
  if (!onHosted() && detail) body.detail = detail;
  return send(res, status, body);
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
  const age = Number.isFinite(maxAge) ? maxAge : JWT_TTL_SEC;
  return `${name}=${encodeURIComponent(token)}; HttpOnly; Path=/; Max-Age=${age}; SameSite=Lax${secure}`;
}

function setSessionCookie(res, req, role, token) {
  const name = role === "admin" ? COOKIE_STAFF : COOKIE_STUDENT;
  appendCookie(res, sessionCookie(req, name, token, JWT_TTL_SEC));
}

function clearSessionCookie(res, req, role) {
  const name = role === "admin" ? COOKIE_STAFF : COOKIE_STUDENT;
  appendCookie(res, sessionCookie(req, name, "", 0));
}

function tokenForRole(req, role) {
  const header = bearer(req);
  if (header) return header;
  const cookies = cookieMap(req);
  if (role === "admin") return cookies[COOKIE_STAFF] || "";
  if (role === "student") return cookies[COOKIE_STUDENT] || "";
  return cookies[COOKIE_STAFF] || cookies[COOKIE_STUDENT] || "";
}

function sameOrigin(req) {
  const host = String(req.headers.host || "").toLowerCase();
  if (!host) return !onHosted();
  const matches = (value) => {
    if (!value) return false;
    try {
      return new URL(value).host.toLowerCase() === host;
    } catch {
      return false;
    }
  };
  if (matches(req.headers.origin)) return true;
  if (matches(req.headers.referer)) return true;
  if (!req.headers.origin && !req.headers.referer) {
    return Boolean(bearer(req)) || !onHosted();
  }
  return false;
}

function privilegedKey() {
  const env = getEnv();
  if (env.service) return env.service;
  if (!onHosted()) return env.anon;
  return "";
}

async function sb(path, { method = "GET", body, query = "", prefer } = {}) {
  const env = getEnv();
  const key = privilegedKey();
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
  const key = privilegedKey();
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
    return "Student sign-up needs a signing secret. Set JWT_SECRET (at least 16 characters) on Vercel, or set ADMIN_PASSCODE (8+ characters).";
  }
  if (!hostedDbOk()) {
    return "Student sign-up needs SUPABASE_URL and a Supabase key on Vercel.";
  }
  return "";
}

function staffConfigError() {
  if (!hostedStaffOk()) {
    return "Staff sign-in needs ADMIN_PASSCODE on Vercel (at least 8 characters, and not SP2026).";
  }
  if (!hostedJwtOk()) {
    return "Staff sign-in needs a signing secret. Set JWT_SECRET, or ADMIN_PASSCODE (8+ characters).";
  }
  return "Staff sign-in is not configured.";
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
        return sendAuth(req, res, "student", token, {
          created: true,
          student: { studentNumber, fullName },
          staffChallenge: false,
        });
      }
      if (!namesMatch(row.full_name, fullName)) {
        return send(res, 401, { error: "This admin number is already registered under a different name." });
      }
      const token = signJwt({ role: "student", studentNumber, name: row.full_name });
      return sendAuth(req, res, "student", token, {
        created: false,
        student: { studentNumber, fullName: row.full_name },
        staffChallenge: isStaffAccount(row),
        accountRole: accountRole(row),
      });
    }

    const env = getEnv();
    if (env.service) {
      try {
        const existing = await sb("students", {
          query: `?student_number=eq.${encodeURIComponent(studentNumber)}&select=*`,
        });
        let row = Array.isArray(existing) ? existing[0] : null;
        let created = false;
        let name = fullName;

        if (!row) {
          try {
            const inserted = await sb("students", {
              method: "POST",
              body: { student_number: studentNumber, full_name: fullName },
            });
            const student = Array.isArray(inserted) ? inserted[0] : inserted;
            row = student || { student_number: studentNumber, full_name: fullName, role: "student" };
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
                row = taken;
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

        const token = signJwt({
          role: "student",
          studentNumber,
          name,
          staffChallenge: isStaffAccount(row),
          accountRole: accountRole(row),
        });
        return sendAuth(req, res, "student", token, {
          created,
          student: { studentNumber, fullName: name },
          ...staffPublicFlags(row),
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
      const token = signJwt({
        role: "student",
        studentNumber: number,
        name,
        staffChallenge: isStaffAccount(row),
        accountRole: accountRole(row),
      });
      return sendAuth(req, res, "student", token, {
        created: Boolean(row.created),
        student: { studentNumber: number, fullName: name },
        ...staffPublicFlags(row),
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
  if (req.method === "GET") {
    const session = requireAdmin(req, res);
    if (!session) return;
    return send(res, 200, {
      staff: {
        staffId: session.staffId || "",
        fullName: session.name || "",
        staffScope: staffScope(session),
      },
    });
  }
  if (req.method !== "POST") return send(res, 405, { error: "Method not allowed" });
  if (onHosted() && (!hostedJwtOk() || !hostedStaffOk())) {
    return send(res, 503, { error: staffConfigError() });
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
        return send(res, 503, { error: staffConfigError() });
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

function sendAuth(req, res, role, token, extra, also = []) {
  setSessionCookie(res, req, role, token);
  (also || []).forEach((item) => {
    if (item && item.role && item.token) setSessionCookie(res, req, item.role, item.token);
  });
  const body = { expiresIn: JWT_TTL_SEC, ...extra };
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

async function resolveNamedAccount(studentNumber, fullName) {
  if (!onHosted() && !getEnv().url) {
    const row = localStudents.get(studentNumber);
    if (!row) return { missing: true };
    if (!namesMatch(row.full_name, fullName)) return { mismatch: true };
    return { row };
  }
  let row = null;
  try {
    const existing = await sb("students", {
      query: `?student_number=eq.${encodeURIComponent(studentNumber)}&select=*`,
    });
    row = Array.isArray(existing) ? existing[0] : null;
  } catch {
    row = null;
  }
  if (!row) {
    const found = await findStudentRow(studentNumber);
    if (found) row = found;
  }
  if (!row) return { missing: true };
  if (!namesMatch(row.full_name, fullName)) return { mismatch: true };
  return { row };
}

async function signInStaff(req, res, body) {
  const failStaff = (message) =>
    send(res, 401, { error: onHosted() ? "Staff sign-in failed." : message });
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

    let found = await resolveNamedAccount(staffId, fullName);
    if (found.mismatch) {
      return failStaff("This admin number is already registered under a different name.");
    }
    if (found.missing) {
      if (!onHosted() && !env.url) {
        localStudents.set(staffId, { student_number: staffId, full_name: fullName, role: "admin" });
        found = { row: localStudents.get(staffId) };
      } else {
        return failStaff("No account for that admin number. Sign in with your name first.");
      }
    }
    if (onHosted() && !isStaffAccount(found.row)) {
      console.warn("[scream] staff-login-denied", clientKey(req));
      return failStaff("This account is not authorised for staff tools.");
    }
    let staffScopeName = "";
    if (await checkPass(passcode, env.adminPass)) staffScopeName = "admin";
    else if (await checkPass(passcode, env.stampPass)) staffScopeName = "stamps";
    else if (await checkPass(passcode, env.waitPass)) staffScopeName = "waits";
    else {
      console.warn("[scream] staff-login-fail", clientKey(req));
      return failStaff("Incorrect staff password.");
    }
    const name = found.row.full_name || fullName;
    const studentToken = signJwt({ role: "student", studentNumber: staffId, name });
    const token = signJwt({ role: "admin", staffId, name, staffScope: staffScopeName });
    return sendAuth(
      req,
      res,
      "admin",
      token,
      {
        staff: { staffId, fullName: name, staffScope: staffScopeName },
        student: { studentNumber: staffId, fullName: name },
        staffChallenge: true,
        accountRole: accountRole(found.row),
      },
      [{ role: "student", token: studentToken }]
    );
  } catch (error) {
    return fail(res, error);
  }
}

function requireStudent(req, res) {
  const payload = verifyJwt(tokenForRole(req, "student"));
  if (!payload || payload.role !== "student") {
    send(res, 401, { error: "Student session expired. Sign in again." });
    return null;
  }
  return payload;
}

function requireAdmin(req, res) {
  const payload = verifyJwt(tokenForRole(req, "admin"));
  if (!payload || payload.role !== "admin") {
    send(res, 401, { error: "Staff session expired. Sign in again." });
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
  if (role === "admin" || role === "student") clearSessionCookie(res, req, role);
  else {
    clearSessionCookie(res, req, "student");
    clearSessionCookie(res, req, "admin");
  }
  return send(res, 200, { ok: true });
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

const HOUSE_STATUSES = new Set(["open", "busy", "closed"]);

async function handleWaitTimes(req, res) {
  if (req.method !== "POST") return send(res, 405, { error: "Method not allowed" });
  if (!rateLimit(req, 80, 10 * 60 * 1000, "wait")) {
    return send(res, 429, { error: "Too many updates. Wait a moment." });
  }
  const session = requireScope(req, res, ["waits"]);
  if (!session) return;
  try {
    const env = getEnv();
    if (!env.url || !privilegedKey()) {
      return send(res, 503, {
        error: "Wait times cannot be saved. Set the database URL and service role key, then redeploy.",
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
      let flags = { staffChallenge: false, accountRole: "student" };
      try {
        flags = staffPublicFlags(await findStudentRow(num));
      } catch {
        /* stamp card still loads */
      }
      return send(res, 200, {
        studentNumber: num,
        fullName: session.name,
        stamps: card.stamps || {},
        redeemedAt: card.redeemed_at || null,
        redeemedBy: card.redeemed_by || null,
        passId: `SP-FP-${num}`,
        ...flags,
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

function firstRow(data) {
  if (Array.isArray(data)) return data[0] || null;
  if (data && typeof data === "object" && (data.student_number || data.full_name || data.id)) return data;
  return null;
}

function numberVariants(num) {
  const n = normalizeNumber(num);
  const out = new Set([n]);
  if (/^P[0-9]{7}$/.test(n)) {
    out.add(n.slice(1));
    out.add(n.toLowerCase());
    out.add(`p${n.slice(1)}`);
  }
  return [...out];
}

async function findStudentRow(studentNumber) {
  const variants = numberVariants(studentNumber);
  const or = variants.map((id) => `student_number.eq.${encodeURIComponent(id)}`).join(",");
  try {
    const rows = await sb("students", {
      query: `?or=(${or})&select=*`,
    });
    const row = firstRow(rows);
    if (row && row.student_number) return row;
  } catch {
    /* anon key cannot read students */
  }
  try {
    const remote = await sbRpc("lookup_scream_student", { p_number: studentNumber });
    if (remote && remote.ok && remote.student_number) {
      return {
        student_number: remote.student_number,
        full_name: remote.full_name,
        role: remote.role || "student",
        stamps: remote.stamps,
        redeemed_at: remote.redeemed_at,
        redeemed_by: remote.redeemed_by,
      };
    }
  } catch {
    /* RPC not installed yet */
  }
  return null;
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
    const student = await findStudentRow(studentNumber);
    if (!student) {
      return send(res, 404, {
        error: "No student found for that admin number. Check P plus 7 digits matches the students table, and that they have signed in once.",
        code: "no_student",
      });
    }
    const num = student.student_number;
    let stamps = asStampMap(student.stamps);
    let redeemedAt = student.redeemed_at || null;
    let redeemedBy = student.redeemed_by || null;
    if (!student.stamps) {
      try {
        const cards = await sb("stamp_cards", {
          query: `?student_number=eq.${encodeURIComponent(num)}&select=stamps,redeemed_at,redeemed_by`,
        });
        const card = firstRow(cards);
        stamps = asStampMap(card && card.stamps);
        redeemedAt = (card && card.redeemed_at) || null;
        redeemedBy = (card && card.redeemed_by) || null;
      } catch {
        stamps = {};
      }
    }
    const stampCount = Object.keys(stamps).filter((id) => isBoothId(id)).length;
    return send(res, 200, {
      studentNumber: num,
      fullName: student.full_name,
      stamps,
      stampCount,
      redeemedAt,
      redeemedBy,
      passId: `SP-FP-${num}`,
    });
  } catch (error) {
    return fail(res, error);
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

    try {
      const remote = await awardViaRpc(studentNumber, boothId, staffId);
      writeAudit(session, "award_stamp", remote.student_number || studentNumber, {
        boothId,
        boothName: booth ? booth.name : boothId,
        via: "rpc",
      }).catch(() => {});
      return send(res, 200, {
        studentNumber: remote.student_number || studentNumber,
        fullName: remote.full_name || "",
        stamps: remote.stamps || {},
        awarded: String(boothId),
        boothName: booth ? booth.name : boothId,
      });
    } catch (rpcError) {
      if (rpcError.code === "already") {
        return send(res, 409, { error: "This student already has that booth stamp.", code: "already" });
      }
      if (rpcError.code === "no_student") {
        return send(res, 404, {
          error: "No student found for that admin number. They must sign in on Stamp Card once first.",
          code: "no_student",
        });
      }
      if (rpcError.code === "bad_booth") {
        return send(res, 400, { error: "Choose a valid booth." });
      }
    }

    const student = await findStudentRow(studentNumber);
    const num = student && student.student_number ? student.student_number : studentNumber;
    if (!student) {
      return send(res, 404, {
        error: "No student found for that admin number. If they are in Supabase, set SUPABASE_SERVICE_ROLE_KEY or run the latest schema.sql.",
        code: "no_student",
      });
    }

    let cards = await sb("stamp_cards", {
      query: `?student_number=eq.${encodeURIComponent(num)}&select=*`,
    });
    let card = firstRow(cards);
    if (!card) {
      try {
        const created = await sb("stamp_cards", {
          method: "POST",
          body: { student_number: num, stamps: {} },
        });
        card = firstRow(created);
      } catch (createErr) {
        cards = await sb("stamp_cards", {
          query: `?student_number=eq.${encodeURIComponent(num)}&select=*`,
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
      query: `?student_number=eq.${encodeURIComponent(num)}`,
      body: { stamps, updated_at: new Date().toISOString() },
    });
    const next = firstRow(updated);
    writeAudit(session, "award_stamp", num, { boothId, boothName: booth ? booth.name : boothId }).catch(() => {});
    return send(res, 200, {
      studentNumber: num,
      fullName: student.full_name,
      stamps: (next && next.stamps) || stamps,
      awarded: String(boothId),
      boothName: booth ? booth.name : boothId,
    });
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
      const student = verifyJwt(tokenForRole(req, "student"));
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
      let rows = [];
      try {
        rows = await sb("announcements", {
          query:
            "?select=id,message,created_at,audience,house_id,expires_at,active&active=eq.true&order=created_at.desc&limit=40",
        });
      } catch {
        rows = await sb("announcements", {
          query: "?select=id,message,created_at,active&active=eq.true&order=created_at.desc&limit=40",
        });
      }
      const now = Date.now();
      const live = (Array.isArray(rows) ? rows : [])
        .map(publicAnnouncement)
        .filter(Boolean)
        .filter((row) => {
          if (row.expires_at && new Date(row.expires_at).getTime() < now) return false;
          return true;
        })
        .slice(0, 20);
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
  const student = await findStudentRow(studentNumber);
  if (!student) {
    return send(res, 404, {
      error: "No student found for that admin number. If they are in Supabase, set SUPABASE_SERVICE_ROLE_KEY or run the latest schema.sql.",
      code: "no_student",
    });
  }
  const num = student.student_number;
  const cards = await sb("stamp_cards", {
    query: `?student_number=eq.${encodeURIComponent(num)}&select=*`,
  });
  const card = firstRow(cards);
  if (!card) return send(res, 404, { error: "Stamp card not found." });
  const filled = Object.keys(asStampMap(card.stamps)).filter((id) => isBoothId(id)).length;
  if (filled < BOOTHS.length) return send(res, 400, { error: `All ${BOOTHS.length} stamps are required before redeem.` });
  const passId = `SP-FP-${num}`;
  if (card.redeemed_at) {
    return send(res, 200, {
      studentNumber: num,
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
    query: `?student_number=eq.${encodeURIComponent(num)}`,
    body: {
      redeemed_at: new Date().toISOString(),
      redeemed_by: staffId,
      updated_at: new Date().toISOString(),
    },
  });
  const next = firstRow(updated);
  await writeAudit(session, "redeem_pass", num, { passId });
  return send(res, 200, {
    studentNumber: num,
    fullName: student.full_name,
    passId,
    redeemedAt: next && next.redeemed_at,
    redeemedBy: next && next.redeemed_by,
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
      if (!rateLimit(req, 60, 10 * 60 * 1000, "scores")) {
        return send(res, 429, { error: "Too many score saves. Wait a moment." });
      }
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
      if (ids.filter((id) => isBoothId(id)).length >= BOOTHS.length) fastPass += 1;
    });
    const houseRows = Array.isArray(houses) ? houses : [];
    const waitStatus = (row) => {
      const wait = Math.max(0, Number(row.wait_minutes) || 0);
      if (wait >= 60) return "closed";
      if (wait >= 30) return "busy";
      return "open";
    };
    const housesBusy = houseRows.filter((h) => waitStatus(h) === "busy").length;
    const housesClosed = houseRows.filter((h) => waitStatus(h) === "closed").length;
    const fb = Array.isArray(feedback) ? feedback : [];
    const recentHours = Date.now() - 6 * 60 * 60 * 1000;
    const recentFeedback = fb.filter((row) => new Date(row.created_at).getTime() > recentHours).length;
    return send(res, 200, {
      students: Array.isArray(students) ? students.length : 0,
      stampsPerBooth,
      fastPassUnlocked: fastPass,
      housesBusy,
      housesClosed,
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
  handleLogout,
  studentLoginReady,
  sameOrigin,
  verifyJwt,
  tokenForRole,
  handlePush: async (req, res) => {
    if (req.method !== "GET" && !rateLimit(req, 40, 10 * 60 * 1000, "push")) {
      return send(res, 429, { error: "Too many notification updates. Wait a few minutes." });
    }
    return require("./push").handlePush(req, res, { readBody, fail, verifyJwt, tokenForRole });
  },
};
