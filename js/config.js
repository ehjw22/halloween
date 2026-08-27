window.HALLOWEEN_CONFIG = {
  supabaseUrl: "",
  supabaseAnonKey: "",
};

window.__CONFIG_STATUS = { ok: false, reason: "not-loaded" };

window.loadHalloweenConfig = async function loadHalloweenConfig() {
  try {
    const res = await fetch("/api/config", { cache: "no-store" });
    if (!res.ok) {
      window.__CONFIG_STATUS = { ok: false, reason: `api-${res.status}` };
      return;
    }
    const type = res.headers.get("content-type") || "";
    if (!type.includes("application/json")) {
      window.__CONFIG_STATUS = { ok: false, reason: "api-not-json" };
      return;
    }
    const data = await res.json();
    if (data.supabaseUrl) window.HALLOWEEN_CONFIG.supabaseUrl = data.supabaseUrl;
    if (data.supabaseAnonKey) window.HALLOWEEN_CONFIG.supabaseAnonKey = data.supabaseAnonKey;
    const ready = Boolean(data.supabaseUrl && data.supabaseAnonKey);
    window.__CONFIG_STATUS = {
      ok: ready,
      reason: ready ? "ok" : "empty-keys",
    };
  } catch {
    window.__CONFIG_STATUS = { ok: false, reason: "no-api" };
  }
};
