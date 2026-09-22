import { HOUSES } from "./houses.js?v=r17";
import { getAdminSession, apiUrl, apiFetch } from "./session.js";

const CHANNEL = "halloween-wait-times";
const STORAGE_KEY = "sp-halloween-houses-v2";
const SYNC_KEY = "sp-halloween-waits-sync-v1";
const POLL_MS = 4000;

function cloneHouses() {
  return HOUSES.filter((h) => h.kind !== "screening").map((h) => ({
    id: h.id,
    name: h.name,
    wait_minutes: h.wait,
    status: h.status,
    updated_at: h.wait == null ? null : new Date().toISOString(),
  }));
}

function fingerprint(list) {
  return list.map((row) => `${row.id}:${Number(row.wait_minutes) || 0}:${row.status}`).join("|");
}

function readLocal() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return cloneHouses();
    const parsed = JSON.parse(raw);
    const byId = new Map(parsed.map((row) => [row.id, row]));
    return cloneHouses().map((row) => ({ ...row, ...byId.get(row.id) }));
  } catch {
    return cloneHouses();
  }
}

function writeLocal(rows) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(rows));
}

function readLastLiveAt() {
  try {
    const raw = JSON.parse(localStorage.getItem(SYNC_KEY) || "null");
    return raw?.lastLiveAt || null;
  } catch {
    return null;
  }
}

function writeLastLiveAt(iso) {
  localStorage.setItem(SYNC_KEY, JSON.stringify({ lastLiveAt: iso }));
}

export function createStore(onChange) {
  const readConfig = () => window.HALLOWEEN_CONFIG || {};
  let rows = readLocal();
  let client = null;
  let channel = null;
  let pollTimer = null;
  let liveOk = false;
  let wasLive = false;
  let failStreak = 0;

  const getSync = () => ({ liveOk, wasLive, lastLiveAt: readLastLiveAt() });
  const emit = () => onChange(rows.map((r) => ({ ...r })), getSync());

  function markLive() {
    liveOk = true;
    wasLive = true;
    failStreak = 0;
    writeLastLiveAt(new Date().toISOString());
  }

  function markStale() {
    liveOk = false;
  }

  function applyRows(next, { broadcastLocal = false } = {}) {
    if (!next?.length) return false;
    const byId = new Map(next.map((row) => [row.id, row]));
    const merged = cloneHouses().map((row) => ({ ...row, ...byId.get(row.id) }));
    if (fingerprint(merged) === fingerprint(rows)) return false;
    rows = merged;
    writeLocal(rows);
    if (broadcastLocal) {
      try {
        tabChannel.postMessage({ type: "houses", rows });
      } catch {
        /* ignore */
      }
    }
    emit();
    return true;
  }

  const tabChannel = new BroadcastChannel(CHANNEL);
  tabChannel.onmessage = (event) => {
    if (event.data?.type === "houses" && Array.isArray(event.data.rows)) {
      applyRows(event.data.rows);
    }
  };

  async function refreshFromDb() {
    if (!client) return;
    const { data, error } = await client.from("scare_houses").select("*");
    if (error || !data) {
      failStreak += 1;
      if (failStreak >= 2) {
        markStale();
        emit();
      }
      return;
    }
    markLive();
    const changed = applyRows(data, { broadcastLocal: true });
    if (!changed) emit();
  }

  function startPolling() {
    stopPolling();
    pollTimer = setInterval(() => {
      if (document.hidden) return;
      refreshFromDb();
    }, POLL_MS);
  }

  function stopPolling() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = null;
  }

  async function connect() {
    const config = readConfig();
    const hasRemote = Boolean(config.supabaseUrl && config.supabaseAnonKey);
    if (!hasRemote || !window.supabase) {
      emit();
      return {
        mode: "local",
        error: hasRemote ? "Supabase library failed to load." : "No Supabase keys loaded.",
      };
    }

    client = window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey, {
      realtime: { params: { eventsPerSecond: 20 } },
    });

    const { data, error } = await client.from("scare_houses").select("*").order("name");
    if (error) {
      console.warn("Supabase read failed, using local demo mode.", error.message);
      markStale();
      emit();
      return { mode: "local", error: error.message };
    }

    markLive();
    if (data?.length) applyRows(data);
    else emit();

    channel = client
      .channel("scare-houses-live", { config: { broadcast: { ack: false } } })
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "scare_houses" },
        (payload) => {
          const next = payload.new;
          if (!next?.id) return;
          markLive();
          applyRows(rows.map((row) => (row.id === next.id ? { ...row, ...next } : row)), {
            broadcastLocal: true,
          });
        }
      )
      .on("broadcast", { event: "wait-times" }, ({ payload }) => {
        if (Array.isArray(payload?.rows)) {
          markLive();
          applyRows(payload.rows);
        }
      })
      .subscribe((status) => {
        if (status === "SUBSCRIBED") refreshFromDb();
      });

    startPolling();
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) refreshFromDb();
    });
    window.addEventListener("focus", refreshFromDb);
    window.addEventListener("online", () => {
      refreshFromDb();
    });
    window.addEventListener("offline", () => {
      markStale();
      emit();
    });

    emit();
    return { mode: liveOk ? "live" : "local" };
  }

  async function publish(id, patch, { persist = true } = {}) {
    const updated_at = new Date().toISOString();
    applyRows(
      rows.map((row) => (row.id === id ? { ...row, ...patch, updated_at } : row)),
      { broadcastLocal: true }
    );

    if (!persist) return { ok: true, local: true };

    const row = rows.find((r) => r.id === id);
    if (!row) return { ok: false, error: "Unknown scare house." };

    const session = getAdminSession();
    if (!session?.token) {
      return { ok: false, error: "Staff session expired. Sign in again to save wait times." };
    }
    if (session.payload.local) {
      return {
        ok: false,
        error: "This staff login is demo-only. Wait times stay on this device and are not written to Supabase.",
      };
    }

    try {
      const res = await apiFetch(apiUrl("wait-times"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        asRole: "admin",
        body: JSON.stringify({
          id: row.id,
          name: row.name,
          wait_minutes: row.wait_minutes,
          status: row.status,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        await refreshFromDb();
        const error = data.error || (res.status === 404 ? "Wait-time API was not found." : res.statusText);
        console.warn("Wait time save failed.", error);
        return { ok: false, error };
      }
      if (data.house) {
        applyRows(
          rows.map((r) => (r.id === data.house.id ? { ...r, ...data.house } : r)),
          { broadcastLocal: true }
        );
      }
      return { ok: true };
    } catch (error) {
      console.warn("Wait time save failed.", error.message);
      return { ok: false, error: error.message || "Could not reach the wait-time API." };
    }
  }

  function get() {
    return rows.map((r) => ({ ...r }));
  }

  function destroy() {
    stopPolling();
    tabChannel.close();
    if (channel && client) client.removeChannel(channel);
  }

  return { connect, publish, refresh: refreshFromDb, get, destroy, hasRemote: Boolean(readConfig().supabaseUrl && readConfig().supabaseAnonKey), getSync };
}
