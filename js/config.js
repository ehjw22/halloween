window.HALLOWEEN_CONFIG = {
  supabaseUrl: "",
  supabaseAnonKey: "",
  adminPasscode: "SP2026",
};

window.loadHalloweenConfig = async function loadHalloweenConfig() {
  try {
    const res = await fetch("/api/config", { cache: "no-store" });
    if (!res.ok) return;
    const data = await res.json();
    if (data.supabaseUrl) window.HALLOWEEN_CONFIG.supabaseUrl = data.supabaseUrl;
    if (data.supabaseAnonKey) window.HALLOWEEN_CONFIG.supabaseAnonKey = data.supabaseAnonKey;
  } catch {
    // Local static hosting has no /api/config — stay in demo mode.
  }
};
