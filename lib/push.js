const { HOUSE_IDS, isHouseId } = require("./catalog");

const STATUS_LABEL = {
  open: "Open",
  busy: "Busy",
  closed: "Closed",
  at_capacity: "At capacity",
};

const localSubs = new Map();

function vapidKeys() {
  const publicKey = process.env.VAPID_PUBLIC_KEY || "";
  const privateKey = process.env.VAPID_PRIVATE_KEY || "";
  if (publicKey && privateKey) return { publicKey, privateKey };
  if (process.env.VERCEL) return { publicKey: "", privateKey: "" };
  if (!vapidKeys.local) {
    try {
      vapidKeys.local = require("web-push").generateVAPIDKeys();
    } catch {
      vapidKeys.local = { publicKey: "", privateKey: "" };
    }
  }
  return vapidKeys.local;
}

function vapidSubject() {
  if (process.env.VAPID_SUBJECT) return process.env.VAPID_SUBJECT;
  const host = process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL;
  if (host) return `https://${String(host).replace(/^https?:\/\//, "")}`;
  return "mailto:screamfest-local@localhost";
}

function pushConfigured() {
  const keys = vapidKeys();
  return Boolean(keys.publicKey && keys.privateKey);
}

function getPublicVapidKey() {
  return vapidKeys().publicKey || "";
}

function applyVapid() {
  const keys = vapidKeys();
  if (!keys.publicKey || !keys.privateKey) return null;
  let webpush;
  try {
    webpush = require("web-push");
  } catch {
    return null;
  }
  webpush.setVapidDetails(vapidSubject(), keys.publicKey, keys.privateKey);
  return webpush;
}

function firstEnv(...names) {
  for (const name of names) {
    const value = process.env[name];
    if (value && String(value).trim()) return String(value).trim();
  }
  return "";
}

function supabaseUrl() {
  return firstEnv("SUPABASE_URL", "supabaseUrl");
}

function supabaseKey() {
  return firstEnv(
    "SUPABASE_SERVICE_ROLE_KEY",
    "supabaseServiceRoleKey",
    "SUPABASE_SERVICE_KEY"
  );
}

function supabaseReady() {
  return Boolean(supabaseUrl() && supabaseKey());
}

async function sb(path, { method = "GET", body, query = "", prefer = "return=representation" } = {}) {
  const url = supabaseUrl();
  const key = supabaseKey();
  if (!url || !key) {
    const err = new Error("Supabase is not configured");
    err.status = 500;
    throw err;
  }
  const res = await fetch(`${url}/rest/v1/${path}${query}`, {
    method,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Prefer: prefer,
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

async function sbRpc(fn, args) {
  const url = supabaseUrl();
  const key = supabaseKey();
  if (!url || !key) {
    const err = new Error("Supabase is not configured");
    err.status = 500;
    throw err;
  }
  const res = await fetch(`${url}/rest/v1/rpc/${fn}`, {
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
    const err = new Error((data && data.message) || text || `Supabase ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

function sessionNumber(req, verifyJwt, tokenForRole) {
  if (typeof verifyJwt !== "function") return "";
  const token = typeof tokenForRole === "function" ? tokenForRole(req, "student") : "";
  const payload = verifyJwt(token);
  if (!payload || payload.role !== "student") return "";
  return String(payload.studentNumber || "").slice(0, 16);
}

function cleanWatch(list) {
  const ids = Array.isArray(list) ? list : [];
  return [...new Set(ids.map((id) => String(id || "").trim()).filter((id) => isHouseId(id)))].slice(0, HOUSE_IDS.length);
}

function validSubscription(sub) {
  const endpoint = String(sub && sub.endpoint ? sub.endpoint : "");
  const p256dh = String(sub && sub.keys && sub.keys.p256dh ? sub.keys.p256dh : "");
  const auth = String(sub && sub.keys && sub.keys.auth ? sub.keys.auth : "");
  if (!endpoint || endpoint.length > 2048) return null;
  if (!/^https:\/\//i.test(endpoint) && !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//i.test(endpoint)) return null;
  if (!p256dh || p256dh.length > 200 || !auth || auth.length > 200) return null;
  return { endpoint, p256dh, auth };
}

function sendJson(res, status, body) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.status(status).json(body);
}

async function saveSub(studentNumber, parsed, watch) {
  const row = {
    endpoint: parsed.endpoint,
    student_number: studentNumber || null,
    p256dh: parsed.p256dh,
    auth: parsed.auth,
    watch,
    updated_at: new Date().toISOString(),
  };
  localSubs.set(parsed.endpoint, row);
  if (!supabaseReady()) return;
  try {
    await sb("push_subscriptions", {
      method: "POST",
      query: "?on_conflict=endpoint",
      prefer: "resolution=merge-duplicates,return=representation",
      body: { ...row, created_at: new Date().toISOString() },
    });
  } catch {
    await sbRpc("upsert_push_subscription", {
      p_endpoint: parsed.endpoint,
      p_student: studentNumber || "",
      p_p256dh: parsed.p256dh,
      p_auth: parsed.auth,
      p_watch: watch,
    });
  }
}

async function updateWatch(endpoint, studentNumber, watch) {
  const local = localSubs.get(endpoint);
  if (local) {
    local.watch = watch;
    local.updated_at = new Date().toISOString();
  }
  if (!supabaseReady()) {
    if (!local) {
      const err = new Error("No push subscription on this device.");
      err.status = 404;
      throw err;
    }
    return;
  }
  try {
    const updated = await sb("push_subscriptions", {
      method: "PATCH",
      query: `?endpoint=eq.${encodeURIComponent(endpoint)}`,
      body: { watch, student_number: studentNumber || null, updated_at: new Date().toISOString() },
    });
    if (updated && (!Array.isArray(updated) || updated.length)) return;
  } catch {
    /* use rpc */
  }
  await sbRpc("upsert_push_subscription", {
    p_endpoint: endpoint,
    p_student: studentNumber || "",
    p_p256dh: (local && local.p256dh) || "",
    p_auth: (local && local.auth) || "",
    p_watch: watch,
  });
}

async function deleteSub(endpoint) {
  localSubs.delete(endpoint);
  if (!supabaseReady()) return;
  try {
    await sb("push_subscriptions", {
      method: "DELETE",
      query: `?endpoint=eq.${encodeURIComponent(endpoint)}`,
    });
  } catch {
    try {
      await sbRpc("delete_push_subscription", { p_endpoint: endpoint });
    } catch {
      /* ignore */
    }
  }
}

async function handlePush(req, res, { readBody, fail, verifyJwt, tokenForRole }) {
  if (!pushConfigured()) {
    return sendJson(res, 503, { error: "Phone notifications are not configured yet." });
  }
  if (req.method === "GET") {
    return sendJson(res, 200, { vapidPublicKey: getPublicVapidKey() });
  }
  try {
    const body = await readBody(req);
    const parsed = validSubscription(body.subscription || body);
    if (!parsed) return sendJson(res, 400, { error: "This browser did not return a valid push subscription." });
    const who = sessionNumber(req, verifyJwt, tokenForRole);
    if (req.method === "DELETE") {
      await deleteSub(parsed.endpoint);
      return sendJson(res, 200, { ok: true });
    }
    const watch = cleanWatch(body.watch);
    if (req.method === "PATCH") {
      await updateWatch(parsed.endpoint, who, watch);
      return sendJson(res, 200, { ok: true, watch });
    }
    if (req.method === "POST" || req.method === "PUT") {
      await saveSub(who, parsed, watch);
      return sendJson(res, 200, { ok: true, watch });
    }
    return sendJson(res, 405, { error: "Method not allowed" });
  } catch (error) {
    return fail(res, error);
  }
}

function waitLine(minutes, status) {
  if (status === "closed") return "Closed";
  if (status === "at_capacity") return `${minutes} min · Full`;
  if (!minutes) return "Walk in";
  return `${minutes} min`;
}

async function loadWatchers(houseId) {
  if (supabaseReady()) {
    try {
      const rows = await sbRpc("list_push_watchers", { p_house: houseId });
      if (Array.isArray(rows) && rows.length) return rows;
    } catch {
      /* table query next */
    }
    try {
      const encoded = encodeURIComponent(JSON.stringify([houseId]));
      const rows = await sb("push_subscriptions", {
        query: `?watch=cs.${encoded}&select=endpoint,p256dh,auth,student_number`,
      });
      if (Array.isArray(rows)) return rows;
    } catch {
      /* local fallback */
    }
  }
  return [...localSubs.values()].filter((row) => Array.isArray(row.watch) && row.watch.includes(houseId));
}

async function dropEndpoint(endpoint) {
  if (!supabaseReady()) {
    localSubs.delete(endpoint);
    return;
  }
  try {
    await sb("push_subscriptions", {
      method: "DELETE",
      query: `?endpoint=eq.${encodeURIComponent(endpoint)}`,
    });
  } catch {
    /* ignore */
  }
}

async function mapPool(items, limit, fn) {
  const pending = [...items];
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (pending.length) {
      const item = pending.shift();
      if (!item) return;
      await fn(item);
    }
  });
  await Promise.all(workers);
}

async function notifyHouseWatchers(houseId, { name, wait_minutes, status }) {
  const webpush = applyVapid();
  if (!webpush) return { sent: 0 };
  let rows = [];
  try {
    rows = await loadWatchers(houseId);
  } catch {
    return { sent: 0 };
  }
  if (!rows.length) return { sent: 0 };
  const walkIn = Number(wait_minutes) === 0 && status !== "closed" && status !== "at_capacity";
  const title = walkIn ? "Walk in now" : "SP Scream Fest";
  const body = walkIn
    ? `${name || "Scare house"} is 0 minutes. Head over.`
    : `${name || "Scare house"}: ${waitLine(wait_minutes, status)} (${STATUS_LABEL[status] || status})`;
  const payload = JSON.stringify({
    title,
    body,
    url: `/#house/${houseId}`,
    walkIn,
  });
  let sent = 0;
  await mapPool(rows.slice(0, 250), 8, async (row) => {
    try {
      await webpush.sendNotification(
        {
          endpoint: row.endpoint,
          keys: { p256dh: row.p256dh, auth: row.auth },
        },
        payload,
        { TTL: 3600, urgency: walkIn ? "high" : "normal" }
      );
      sent += 1;
    } catch (error) {
      const code = Number(error && error.statusCode);
      if (code === 404 || code === 410) await dropEndpoint(row.endpoint);
    }
  });
  return { sent };
}

module.exports = {
  getPublicVapidKey,
  handlePush,
  notifyHouseWatchers,
  pushConfigured,
};
