import { HOUSES } from "./houses.js";
import { getAdminSession } from "./session.js";

const CHANNEL = "halloween-wait-times";
const STORAGE_KEY = "sp-halloween-houses-v1";
const POLL_MS = 4000;

function cloneHouses() {
  return HOUSES.map((h) => ({
    id: h.id,
    name: h.name,
    wait_minutes: h.wait,
    status: h.status,
    updated_at: new Date().toISOString(),
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

export function createStore(onChange) {
  const config = window.HALLOWEEN_CONFIG || {};
  const hasRemote = Boolean(config.supabaseUrl && config.supabaseAnonKey);
  let rows = readLocal();
  let client = null;
  let channel = null;
  let pollTimer = null;

  const emit = () => onChange(rows.map((r) => ({ ...r })));

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
    if (error || !data) return;
    applyRows(data, { broadcastLocal: true });
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
      emit();
      return { mode: "local", error: error.message };
    }

    if (data?.length) applyRows(data);

    channel = client
      .channel("scare-houses-live", { config: { broadcast: { ack: false } } })
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "scare_houses" },
        (payload) => {
          const next = payload.new;
          if (!next?.id) return;
          applyRows(rows.map((row) => (row.id === next.id ? { ...row, ...next } : row)), {
            broadcastLocal: true,
          });
        }
      )
      .on("broadcast", { event: "wait-times" }, ({ payload }) => {
        if (Array.isArray(payload?.rows)) applyRows(payload.rows);
      })
      .subscribe((status) => {
        if (status === "SUBSCRIBED") refreshFromDb();
      });

    startPolling();
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) refreshFromDb();
    });
    window.addEventListener("focus", refreshFromDb);

    emit();
    return { mode: "live" };
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
      const res = await fetch("/api/wait-times", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.token}`,
        },
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

  return { connect, publish, refresh: refreshFromDb, get, destroy, hasRemote };
}
