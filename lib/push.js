const { HOUSE_IDS, isHouseId } = require("./catalog");

const LOCAL_VAPID = {
  publicKey: "BAxHJWHz7kot8UXl2iPON6jxb9szfXBPYcT20c_zjlTWoR16J7pItgMnG9jsBrYx7yxUamcGRdlMuvobk4DApfM",
  privateKey: "zlNhhe3b8pT-nqizOwd4eVF9JworahzYCWt859dej_0",
};

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
  return LOCAL_VAPID;
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

function supabaseReady() {
  return Boolean(
    process.env.SUPABASE_URL || process.env.supabaseUrl
  ) && Boolean(
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.supabaseServiceRoleKey
  );
}

async function sb(path, { method = "GET", body, query = "", prefer = "return=representation" } = {}) {
  const url = process.env.SUPABASE_URL || process.env.supabaseUrl || "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.supabaseServiceRoleKey || "";
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
    student_number: studentNumber,
    p256dh: parsed.p256dh,
    auth: parsed.auth,
    watch,
    updated_at: new Date().toISOString(),
  };
  if (!supabaseReady()) {
    localSubs.set(parsed.endpoint, row);
    return;
  }
  await sb("push_subscriptions", {
    method: "POST",
    query: "?on_conflict=endpoint",
    prefer: "resolution=merge-duplicates,return=representation",
    body: { ...row, created_at: new Date().toISOString() },
  });
}

async function updateWatch(endpoint, studentNumber, watch) {
  if (!supabaseReady()) {
    const row = localSubs.get(endpoint);
    if (!row || row.student_number !== studentNumber) {
      const err = new Error("No push subscription on this device.");
      err.status = 404;
      throw err;
    }
    row.watch = watch;
    row.updated_at = new Date().toISOString();
    return;
  }
  const updated = await sb("push_subscriptions", {
    method: "PATCH",
    query: `?endpoint=eq.${encodeURIComponent(endpoint)}&student_number=eq.${encodeURIComponent(studentNumber)}`,
    body: { watch, updated_at: new Date().toISOString() },
  });
  if (!updated || (Array.isArray(updated) && !updated.length)) {
    const err = new Error("No push subscription on this device.");
    err.status = 404;
    throw err;
  }
}

async function deleteSub(endpoint, studentNumber) {
  if (!supabaseReady()) {
    const row = localSubs.get(endpoint);
    if (row && row.student_number === studentNumber) localSubs.delete(endpoint);
    return;
  }
  await sb("push_subscriptions", {
    method: "DELETE",
    query: `?endpoint=eq.${encodeURIComponent(endpoint)}&student_number=eq.${encodeURIComponent(studentNumber)}`,
  });
}

async function handlePush(req, res, { requireStudent, readBody, fail }) {
  if (!pushConfigured()) {
    return sendJson(res, 503, { error: "Phone notifications are not configured yet." });
  }
  if (req.method === "GET") {
    return sendJson(res, 200, { vapidPublicKey: getPublicVapidKey() });
  }
  const session = requireStudent(req, res);
  if (!session) return;
  try {
    const body = await readBody(req);
    const parsed = validSubscription(body.subscription || body);
    if (!parsed) return sendJson(res, 400, { error: "This browser did not return a valid push subscription." });
    if (req.method === "DELETE") {
      await deleteSub(parsed.endpoint, session.studentNumber);
      return sendJson(res, 200, { ok: true });
    }
    const watch = cleanWatch(body.watch);
    if (req.method === "PATCH") {
      await updateWatch(parsed.endpoint, session.studentNumber, watch);
      return sendJson(res, 200, { ok: true, watch });
    }
    if (req.method === "POST" || req.method === "PUT") {
      await saveSub(session.studentNumber, parsed, watch);
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
  if (!supabaseReady()) {
    return [...localSubs.values()].filter((row) => Array.isArray(row.watch) && row.watch.includes(houseId));
  }
  const encoded = encodeURIComponent(JSON.stringify([houseId]));
  const rows = await sb("push_subscriptions", {
    query: `?watch=cs.${encoded}&select=endpoint,p256dh,auth,student_number`,
  });
  return Array.isArray(rows) ? rows : [];
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
  const body = `${name || "Scare house"}: ${waitLine(wait_minutes, status)} (${STATUS_LABEL[status] || status})`;
  const payload = JSON.stringify({
    title: "SP Scream Fest",
    body,
    url: `/#house/${houseId}`,
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
        { TTL: 3600, urgency: "high" }
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
