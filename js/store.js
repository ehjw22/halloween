import { HOUSES } from "./houses.js";

const CHANNEL = "halloween-wait-times";
const STORAGE_KEY = "sp-halloween-houses-v1";

function cloneHouses() {
  return HOUSES.map((h) => ({
    id: h.id,
    name: h.name,
    wait_minutes: h.wait,
    status: h.status,
    updated_at: new Date().toISOString(),
  }));
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

  const emit = () => onChange(rows.map((r) => ({ ...r })));

  const broadcast = new BroadcastChannel(CHANNEL);
  broadcast.onmessage = (event) => {
    if (event.data?.type === "houses" && Array.isArray(event.data.rows)) {
      rows = event.data.rows;
      writeLocal(rows);
      emit();
    }
  };

  async function connect() {
    if (!hasRemote || !window.supabase) {
      emit();
      return { mode: "local" };
    }

    client = window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey, {
      realtime: { params: { eventsPerSecond: 10 } },
    });

    const { data, error } = await client.from("scare_houses").select("*").order("name");
    if (error) {
      console.warn("Supabase read failed, using local demo mode.", error.message);
      emit();
      return { mode: "local", error: error.message };
    }

    if (data?.length) {
      const byId = new Map(data.map((row) => [row.id, row]));
      rows = cloneHouses().map((row) => ({ ...row, ...byId.get(row.id) }));
      writeLocal(rows);
    } else {
      await client.from("scare_houses").upsert(rows);
    }

    channel = client
      .channel("scare-houses-live")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "scare_houses" },
        (payload) => {
          const next = payload.new;
          if (!next?.id) return;
          rows = rows.map((row) => (row.id === next.id ? { ...row, ...next } : row));
          writeLocal(rows);
          emit();
        }
      )
      .subscribe();

    emit();
    return { mode: "live" };
  }

  async function publish(id, patch, { persist = true } = {}) {
    const updated_at = new Date().toISOString();
    rows = rows.map((row) =>
      row.id === id ? { ...row, ...patch, updated_at } : row
    );
    writeLocal(rows);
    broadcast.postMessage({ type: "houses", rows });
    emit();

    if (!persist || !client) return;

    const row = rows.find((r) => r.id === id);
    const { error } = await client
      .from("scare_houses")
      .upsert({
        id: row.id,
        name: row.name,
        wait_minutes: row.wait_minutes,
        status: row.status,
        updated_at: row.updated_at,
      });
    if (error) console.warn("Supabase write failed.", error.message);
  }

  function get() {
    return rows.map((r) => ({ ...r }));
  }

  function destroy() {
    broadcast.close();
    if (channel && client) client.removeChannel(channel);
  }

  return { connect, publish, get, destroy, hasRemote };
}
