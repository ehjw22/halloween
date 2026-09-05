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
  handleRedeem,
  handleScores,
  handleStamps,
  handleStudentAuth,
  handleWaitTimes,
} = require("../lib/server-auth");

function handleConfig(req, res) {
  const env = getEnv();
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.status(200).json({
    supabaseUrl: env.url || "",
    supabaseAnonKey: env.anon || "",
  });
}

function routeName(req) {
  if (req.query && req.query.path) {
    return String(req.query.path).split("/").filter(Boolean)[0] || "";
  }
  try {
    const url = new URL(req.url, "http://localhost");
    const parts = url.pathname.replace(/^\/api\/?/, "").split("/").filter(Boolean);
    if (parts[0] === "index") return "";
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
};

module.exports = async function handler(req, res) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Referrer-Policy", "no-referrer");
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
  return fn(req, res);
};
