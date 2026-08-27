const { getEnv } = require("../lib/server-auth");

module.exports = function handler(req, res) {
  const env = getEnv();
  res.setHeader("Cache-Control", "no-store");
  res.status(200).json({
    supabaseUrl: env.url,
    supabaseAnonKey: env.anon,
  });
};
