const {
  getEnv,
  handleAdminAuth,
  handleAnnouncements,
  handleAwardStamp,
  handleFeedback,
  handleGameSave,
  handleLogin,
  handleLookupStudent,
  handleOps,
  handlePush,
  handleRedeem,
  handleScores,
  handleStamps,
  handleStudentAuth,
  handleWaitTimes,
  studentLoginReady,
} = require("../lib/server-auth");

function handleConfig(req, res) {
  const env = getEnv();
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  let vapidPublicKey = process.env.VAPID_PUBLIC_KEY || "";
  try {
    vapidPublicKey = require("../lib/push").getPublicVapidKey() || vapidPublicKey;
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
  "lookup-student": handleLookupStudent,
  feedback: handleFeedback,
  announcements: handleAnnouncements,
  redeem: handleRedeem,
  scores: handleScores,
  "wait-times": handleWaitTimes,
  ops: handleOps,
  "game-save": handleGameSave,
  "student-auth": handleStudentAuth,
  "admin-auth": handleAdminAuth,
  push: async (req, res) => {
    try {
      return await handlePush(req, res);
    } catch {
      if (!res.headersSent) res.status(503).json({ error: "Push is not available." });
    }
  },
};

module.exports = async function handler(req, res) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Referrer-Policy", "no-referrer");
  try {
    if (req.method === "OPTIONS") {
      res.status(204).end();
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
    const fn = HANDLERS[name];
    if (!fn) {
      res.status(404).json({ error: "Unknown API route." });
      return;
    }
    return await fn(req, res);
  } catch (error) {
    if (!res.headersSent) {
      res.status(500).json({ error: "Something went wrong. Try again." });
    }
  }
};
