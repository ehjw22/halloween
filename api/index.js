const {
  getEnv,
  handleAdminAuth,
  handleAnnouncements,
  handleAwardStamp,
  handleUnawardStamp,
  handleFeedback,
  handleGameSave,
  handleLogin,
  handleLookupStudent,
  handleLogout,
  handleOps,
  handlePush,
  handleRedeem,
  handleUnredeem,
  handleScores,
  handleStamps,
  handleStampsVersion,
  handleStudentAuth,
  handleVersions,
  handleWaitTimes,
  handleWaitTimesPublic,
  PUBLIC_CACHE,
  jsonRequest,
  sameOrigin,
  studentLoginReady,
} = require("./_lib/server-auth");

function handleConfig(req, res) {
  const env = getEnv();
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  let vapidPublicKey = process.env.VAPID_PUBLIC_KEY || "";
  try {
    vapidPublicKey = require("./_lib/push").getPublicVapidKey() || vapidPublicKey;
  } catch {
    /* push extras must not block live Supabase config */
  }
  res.status(200).json({
    supabaseUrl: env.url || "",
    supabaseAnonKey: env.anon || "",
    vapidPublicKey,
    studentLogin: studentLoginReady(),
  });
}

function firstSegment(value) {
  return String(value || "").split("/").filter(Boolean)[0] || "";
}

function routeName(req) {
  const q = req.query || {};
  const fromParam = (value) => {
    const raw = Array.isArray(value) ? value[0] : value;
    const name = firstSegment(raw);
    return name && name !== "index" && name !== "[name]" ? name : "";
  };
  const named = fromParam(q.name) || fromParam(q.path);
  if (named === "wait_times" || named === "waittimes" || named === "waits") return "wait-times";
  if (named) return named;
  const invoke = String(req.headers["x-invoke-path"] || req.headers["x-matched-path"] || "");
  const fromInvoke = firstSegment(invoke.replace(/^\/api\/?/, ""));
  if (fromInvoke && fromInvoke !== "index" && fromInvoke !== "[name]") return fromInvoke;
  try {
    const url = new URL(req.url, "http://localhost");
    const fromQuery = firstSegment(url.searchParams.get("path"));
    if (fromQuery && fromQuery !== "index") return fromQuery;
    const parts = url.pathname.replace(/^\/api\/?/, "").split("/").filter(Boolean);
    if (parts[0] === "index" || parts[0] === "[name]") {
      return firstSegment(parts.slice(1).join("/")) || fromQuery;
    }
    return parts[0] || "";
  } catch {
    return "";
  }
}

const HANDLERS = {
  login: handleLogin,
  stamps: handleStamps,
  "award-stamp": handleAwardStamp,
  "unaward-stamp": handleUnawardStamp,
  "lookup-student": handleLookupStudent,
  feedback: handleFeedback,
  announcements: handleAnnouncements,
  redeem: handleRedeem,
  unredeem: handleUnredeem,
  scores: handleScores,
  "wait-times": handleWaitTimes,
  "wait-times-public": handleWaitTimesPublic,
  versions: handleVersions,
  "stamps-version": handleStampsVersion,
  ops: handleOps,
  "game-save": handleGameSave,
  "student-auth": handleStudentAuth,
  "admin-auth": handleAdminAuth,
  logout: handleLogout,
  push: async (req, res) => {
    try {
      return await handlePush(req, res);
    } catch {
      if (!res.headersSent) res.status(503).json({ error: "Push is not available." });
    }
  },
};

/**
 * Only these GETs may sit on the CDN, and only without credentials in the key: the response is
 * identical for everyone. The staff announcement list (all=1) and every write stay no-store.
 */
function publicCachePolicy(req, name) {
  if (req.method !== "GET" && req.method !== "HEAD") return "";
  if (!Object.prototype.hasOwnProperty.call(PUBLIC_CACHE, name)) return "";
  if (name === "announcements") {
    const q = req.query || {};
    const all = Array.isArray(q.all) ? q.all[0] : q.all;
    let urlAll = "";
    try {
      urlAll = new URL(req.url, "http://localhost").searchParams.get("all") || "";
    } catch {
      urlAll = "";
    }
    if (String(all || urlAll) === "1") return "";
  }
  return PUBLIC_CACHE[name];
}

module.exports = async function handler(req, res) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Vary", "Origin, Cookie");
  try {
    if (req.method === "OPTIONS") {
      res.status(204).end();
      return;
    }
    const mutating = req.method !== "GET" && req.method !== "HEAD";
    if (mutating && !sameOrigin(req)) {
      res.status(403).json({ error: "Request origin is not allowed." });
      return;
    }
    if (mutating && !jsonRequest(req)) {
      res.status(415).json({ error: "Send JSON." });
      return;
    }
    const name = routeName(req);
    if (name === "config") {
      if (req.method !== "GET" && req.method !== "HEAD") {
        res.status(405).json({ error: "Method not allowed" });
        return;
      }
      return handleConfig(req, res);
    }
    const fn = Object.prototype.hasOwnProperty.call(HANDLERS, name) ? HANDLERS[name] : null;
    if (!fn) {
      res.status(404).json({ error: "Unknown API route.", code: "unknown-route" });
      return;
    }
    const cachePolicy = publicCachePolicy(req, name);
    if (cachePolicy) {
      // Vary: Cookie would give every phone its own CDN entry. These bodies never depend on cookies.
      res.setHeader("Vary", "Accept-Encoding");
      res.setHeader("Cache-Control", cachePolicy);
    }
    return await fn(req, res);
  } catch (error) {
    console.error("[api]", error && error.message ? error.message : error);
    if (!res.headersSent) {
      res.status(500).json({
        error: "Something went wrong. Try again.",
        code: "unhandled",
      });
    }
  }
};
