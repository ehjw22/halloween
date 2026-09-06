window.HALLOWEEN_CONFIG = {
  supabaseUrl: "",
  supabaseAnonKey: "",
  vapidPublicKey: "",
  studentLogin: false,
};

window.__CONFIG_STATUS = { ok: false, reason: "not-loaded" };

window.loadHalloweenConfig = async function loadHalloweenConfig() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4000);
  try {
    const res = await fetch("/api/config", { cache: "no-store", signal: controller.signal });
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
    if (data.vapidPublicKey) window.HALLOWEEN_CONFIG.vapidPublicKey = data.vapidPublicKey;
    window.HALLOWEEN_CONFIG.studentLogin = Boolean(data.studentLogin);
    const ready = Boolean(data.supabaseUrl && data.supabaseAnonKey);
    window.__CONFIG_STATUS = {
      ok: ready,
      reason: ready ? "ok" : "empty-keys",
    };
  } catch {
    window.__CONFIG_STATUS = { ok: false, reason: "no-api" };
  } finally {
    clearTimeout(timer);
  }
};
