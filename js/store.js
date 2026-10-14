import { HOUSES } from "./houses.js?v=r19";
import { getAdminSession, apiUrl, apiFetch, userFacingError } from "./session.js?v=r11";

const CHANNEL = "halloween-wait-times";
const STORAGE_KEY = "sp-halloween-houses-v2";
const SYNC_KEY = "sp-halloween-waits-sync-v1";
const POLL_MS = 4000;

function cloneHouses() {
  return HOUSES.filter((h) => h.kind !== "screening" && h.kind !== "scarezone").map((h) => ({
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

function statusFor(wait) {
  const n = Number(wait) || 0;
  if (n >= 60) return "closed";
  if (n >= 40) return "long";
  if (n >= 21) return "busy";
  if (n >= 6) return "open";
  return "gonow";
}

function rowFromRemote(fallback, incoming) {
  const raw = incoming.wait_minutes ?? incoming.wait;
  const published = raw !== null && raw !== undefined && raw !== "";
  const wait = published ? Math.max(0, Number(raw) || 0) : null;
  return {
    id: fallback.id,
    name: incoming.name || fallback.name,
    wait_minutes: wait,
    status: published ? statusFor(wait) : "open",
    updated_at: incoming.updated_at || null,
  };
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
  const pending = new Map();
  const ack = new Map();

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

  function applyRows(next, { broadcastLocal = false, fromRemote = false, partial = false } = {}) {
    if (!Array.isArray(next)) return false;
    if (!next.length && !fromRemote) return false;
    const byId = new Map(next.map((row) => [row.id, row]));
    const current = new Map(rows.map((row) => [row.id, row]));
    const merged = cloneHouses().map((fallback) => {
      if (pending.has(fallback.id)) {
        const local = current.get(fallback.id) || fallback;
        return { ...fallback, ...local, ...pending.get(fallback.id) };
      }
      const incoming = byId.get(fallback.id);
      if (fromRemote) {
        const held = ack.get(fallback.id);
        if (held && Date.now() > held.until) ack.delete(fallback.id);
        else if (held) {
          const remoteWait = incoming ? incoming.wait_minutes ?? incoming.wait : null;
          if (incoming && Number(remoteWait) === Number(held.wait_minutes)) ack.delete(fallback.id);
          else {
            const local = current.get(fallback.id) || fallback;
            return {
              ...fallback,
              ...local,
              wait_minutes: held.wait_minutes,
              status: held.status,
              updated_at: held.updated_at,
            };
          }
        }
      }
      const local = current.get(fallback.id);
      if (incoming && fromRemote) return rowFromRemote(fallback, incoming);
      if (incoming) return { ...fallback, ...incoming };
      if (fromRemote && !partial) {
        return { ...fallback, wait_minutes: null, status: "open", updated_at: null };
      }
      return local ? { ...fallback, ...local } : fallback;
    });
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
    const changed = applyRows(data || [], { fromRemote: true, broadcastLocal: true });
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
      return { mode: "local" };
    }

    client = window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey, {
      realtime: { params: { eventsPerSecond: 20 } },
    });

    const { data, error } = await client.from("scare_houses").select("*").order("name");
    if (error) {
      console.warn("Supabase read failed, using local demo mode.", error.message);
      markStale();
      emit();
      return { mode: "local" };
    }

    markLive();
    applyRows(data || [], { fromRemote: true });

    channel = client
      .channel("scare-houses-live", { config: { broadcast: { ack: false } } })
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "scare_houses" },
        (payload) => {
          const next = payload.new;
          if (!next?.id) return;
          markLive();
          applyRows([next], { fromRemote: true, partial: true, broadcastLocal: true });
        }
      )
      .on("broadcast", { event: "wait-times" }, ({ payload }) => {
        if (Array.isArray(payload?.rows)) {
          markLive();
          applyRows(payload.rows, { fromRemote: true, partial: true });
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
    const row = rows.find((r) => r.id === id);
    if (!row) return { ok: false, error: "Unknown scare house." };

    const updated_at = new Date().toISOString();
    if (!persist) {
      applyRows(
        rows.map((item) => (item.id === id ? { ...item, ...patch, updated_at } : item)),
        { broadcastLocal: true }
      );
      return { ok: true, local: true };
    }

    const session = getAdminSession();
    if (!session) {
      return { ok: false, error: "Staff session expired. Sign in again to save wait times." };
    }
    if (session.payload.local) {
      return {
        ok: false,
        error: "This staff login is demo-only. Wait times stay on this device.",
      };
    }

    pending.set(id, { ...patch, updated_at });
    applyRows(
      rows.map((item) => (item.id === id ? { ...item, ...patch, updated_at } : item)),
      { broadcastLocal: true }
    );

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
          wait_minutes: patch.wait_minutes,
          status: patch.status,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        pending.delete(id);
        await refreshFromDb();
        const error = userFacingError(data.error, "Could not save the wait time. Try again.");
        console.warn("Wait time save failed.", error);
        return { ok: false, error };
      }
      pending.delete(id);
      ack.set(id, {
        wait_minutes: patch.wait_minutes,
        status: patch.status,
        updated_at: data.house?.updated_at || updated_at,
        until: Date.now() + 5000,
      });
      if (data.house) {
        applyRows([data.house], { fromRemote: true, partial: true, broadcastLocal: true });
      }
      return { ok: true };
    } catch (error) {
      pending.delete(id);
      await refreshFromDb();
      console.warn("Wait time save failed.", error.message);
      return { ok: false, error: userFacingError(error, "Could not save the wait time. Try again.") };
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
