import { HOUSES } from "./houses.js?v=e5069938de";
import { getAdminSession, apiUrl, apiFetch, userFacingError } from "./session.js?v=e5069938de";
import { statusFor } from "./wait-status.js?v=e5069938de";
import { fetchPublicJson, kickVersions, seedVersion, setVersionsBase, subscribeVersions } from "./live.js?v=e5069938de";

const CHANNEL = "halloween-wait-times";
const STORAGE_KEY = "sp-halloween-houses-v2";
const SYNC_KEY = "sp-halloween-waits-sync-v1";
const STUDENT_VERSIONS_MS = 17000;
const STAFF_VERSIONS_MS = 8000;
const MAX_RETRY_MS = 120000;

// The UMD bundle sets self.supabase when it runs; it exports nothing. Fetched once, on demand, same origin
// (script-src 'self'). Not stamped with ?v= because the file name carries the library version.
let supabaseLib = null;
function loadSupabaseLib() {
  if (self.supabase?.createClient) return Promise.resolve(self.supabase);
  if (!supabaseLib) {
    supabaseLib = import("./vendor/supabase-2.49.1.js").then(() => self.supabase || null);
    supabaseLib.catch(() => {
      supabaseLib = null;
    });
  }
  return supabaseLib;
}

function cloneHouses() {
  return HOUSES.filter((h) => h.kind !== "screening" && h.kind !== "scarezone").map((h) => ({
    id: h.id,
    name: h.name,
    wait_minutes: h.wait,
    closed: false,
    status: h.status,
    updated_at: null,
  }));
}

function fingerprint(list) {
  return list.map((row) => `${row.id}:${row.wait_minutes ?? "-"}:${row.closed ? 1 : 0}:${row.status}:${row.updated_at || ""}`).join("|");
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

function rowFromRemote(fallback, incoming) {
  const raw = incoming.wait_minutes ?? incoming.wait;
  const published = raw !== null && raw !== undefined && raw !== "";
  const wait = published ? Math.max(0, Number(raw) || 0) : null;
  const closed = incoming.closed === true || (incoming.closed === undefined && incoming.status === "closed");
  return {
    id: fallback.id,
    name: incoming.name || fallback.name,
    wait_minutes: wait,
    closed,
    status: closed ? "closed" : published ? statusFor(wait) : "open",
    updated_at: incoming.updated_at || null,
  };
}

export function createStore(onChange) {
  const readConfig = () => window.HALLOWEEN_CONFIG || {};
  let rows = readLocal();
  let client = null;
  let channel = null;
  let realtimeLoading = false;
  let unsubscribe = null;
  let inflight = null;
  let dirty = false;
  let retryAt = 0;
  let retryStep = 0;
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
          const remote = incoming ? rowFromRemote(fallback, incoming) : null;
          if (remote && remote.wait_minutes === held.wait_minutes && remote.closed === held.closed) ack.delete(fallback.id);
          else {
            const local = current.get(fallback.id) || fallback;
            return {
              ...fallback,
              ...local,
              wait_minutes: held.wait_minutes,
              closed: held.closed,
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
        return { ...fallback, wait_minutes: null, closed: false, status: "open", updated_at: null };
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

  /**
   * Reads go through the CDN-cached /api?path=wait-times-public (never the Supabase table with the
   * anon key). `v` is the waits_v that just changed, so every phone seeing the same version shares
   * one cached copy. `fresh` skips the cache for a staff phone that just failed to save.
   */
  function loadRemote({ v, fresh = false } = {}) {
    if (inflight) return inflight;
    inflight = (async () => {
      try {
        const params = {};
        if (v !== undefined && v !== null) params.v = v;
        else if (fresh) params.fresh = Date.now();
        const data = await fetchPublicJson("wait-times-public", params);
        if (data.local) return { local: true };
        if (!Array.isArray(data.houses)) throw new Error("Bad wait times response.");
        markLive();
        dirty = false;
        retryStep = 0;
        retryAt = 0;
        seedVersion("waits_v", data.waits_v);
        const changed = applyRows(data.houses, { fromRemote: true, broadcastLocal: true });
        if (!changed) emit();
        return { ok: true };
      } catch (error) {
        // Keep the last data on screen. The board shows its existing "last known waits" note after two misses.
        dirty = true;
        retryStep = Math.min(retryStep + 1, 6);
        retryAt = Date.now() + Math.min(MAX_RETRY_MS, 4000 * 2 ** retryStep);
        failStreak += 1;
        if (failStreak >= 2) {
          markStale();
          emit();
        }
        return { ok: false, error };
      } finally {
        inflight = null;
      }
    })();
    return inflight;
  }

  /** Staff phones only: Realtime for instant updates, and a faster version poll. Students never open this. */
  function syncStaffRealtime() {
    const config = readConfig();
    const staff = Boolean(getAdminSession());
    setVersionsBase(staff ? STAFF_VERSIONS_MS : STUDENT_VERSIONS_MS);
    if (staff && !channel && !realtimeLoading && config.supabaseUrl && config.supabaseAnonKey) {
      realtimeLoading = true;
      // The Supabase library is only fetched here, for a signed-in staff session. Students never download it.
      loadSupabaseLib()
        .then((lib) => {
          if (!lib || channel || !getAdminSession()) return;
          openStaffChannel(lib, config);
        })
        .catch(() => {
          /* no Realtime: the version poll still keeps this phone current */
        })
        .finally(() => {
          realtimeLoading = false;
        });
    } else if (!staff && channel) {
      try {
        client.removeChannel(channel);
      } catch {
        /* ignore */
      }
      channel = null;
      client = null;
    }
  }

  function openStaffChannel(lib, config) {
    client = lib.createClient(config.supabaseUrl, config.supabaseAnonKey, {
      realtime: { params: { eventsPerSecond: 20 } },
    });
    // Only database change events: public broadcast messages can be sent by anyone holding the anon key.
    channel = client
      .channel("scare-houses-live")
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
      .subscribe((status) => {
        if (status === "SUBSCRIBED") loadRemote({ fresh: true });
      });
  }

  const versionListener = {
    onChange(key, value) {
      if (key === "waits_v") loadRemote({ v: value });
    },
    onOk() {
      if (dirty) {
        if (Date.now() >= retryAt) loadRemote();
      } else {
        const wasOk = liveOk;
        markLive();
        if (!wasOk) emit();
      }
      syncStaffRealtime();
    },
    onFail() {
      failStreak += 1;
      if (failStreak >= 2) {
        markStale();
        emit();
      }
    },
  };

  function refresh() {
    kickVersions();
    return dirty ? loadRemote() : Promise.resolve();
  }

  async function connect() {
    const first = await loadRemote();
    if (first.local || (first.error && first.error.status === 404)) {
      // No API behind this page (static hosting or no database): demo mode, no polling.
      emit();
      return { mode: "local" };
    }
    unsubscribe = subscribeVersions(versionListener);
    syncStaffRealtime();
    window.addEventListener("offline", () => {
      markStale();
      emit();
    });
    if (!first.ok) {
      // First read failed: stay on the saved board and keep retrying with backoff.
      console.warn("Wait times unavailable, retrying.", first.error && first.error.message);
      emit();
      return { mode: "local" };
    }
    emit();
    return { mode: liveOk ? "live" : "local" };
  }

  /** patch: { wait_minutes }. Status is derived from the minutes. A stored closed flag is left as the database has it. */
  async function publish(id, input, { persist = true } = {}) {
    const row = rows.find((r) => r.id === id);
    if (!row) return { ok: false, error: "Unknown scare house." };

    const updated_at = new Date().toISOString();
    const body = { id: row.id };
    if (input.wait_minutes !== undefined) body.wait_minutes = input.wait_minutes;
    const nextWait = body.wait_minutes !== undefined ? body.wait_minutes : row.wait_minutes;
    const nextClosed = Boolean(row.closed);
    const patch = { wait_minutes: nextWait, closed: nextClosed, status: statusFor(nextWait, nextClosed) };
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
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        pending.delete(id);
        await loadRemote({ fresh: true });
        const error = userFacingError(data.error, "Could not save the wait time. Try again.");
        console.warn("Wait time save failed.", error);
        return { ok: false, error };
      }
      pending.delete(id);
      const saved = data.house ? rowFromRemote(row, data.house) : { ...patch, updated_at };
      ack.set(id, {
        wait_minutes: saved.wait_minutes,
        closed: saved.closed,
        status: saved.status,
        updated_at: saved.updated_at || updated_at,
        until: Date.now() + 5000,
      });
      if (data.house) {
        applyRows([data.house], { fromRemote: true, partial: true, broadcastLocal: true });
      }
      return { ok: true, house: saved };
    } catch (error) {
      pending.delete(id);
      await loadRemote({ fresh: true });
      console.warn("Wait time save failed.", error.message);
      return { ok: false, error: userFacingError(error, "Could not save the wait time. Try again.") };
    }
  }

  function get() {
    return rows.map((r) => ({ ...r }));
  }

  function destroy() {
    if (unsubscribe) unsubscribe();
    unsubscribe = null;
    tabChannel.close();
    if (channel && client) client.removeChannel(channel);
  }

  return { connect, publish, refresh, get, destroy, hasRemote: Boolean(readConfig().supabaseUrl && readConfig().supabaseAnonKey), getSync };
}
