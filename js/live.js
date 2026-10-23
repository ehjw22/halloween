// Shared "has anything changed?" polling.
//
// Phones never hold a Realtime connection and never poll full data. They poll one tiny,
// CDN-cached endpoint (/api?path=versions) and fetch real data only when a number moves.
// Everything here pauses while the tab is hidden, jitters each wait so 3000 phones do not
// tick in step, and backs off exponentially after failures.
import { apiUrl } from "./session.js?v=40779f5429";

const VERSIONS_BASE_MS = 17000;
const JITTER_MS = 3000;
const MAX_BACKOFF_MS = 120000;
const FETCH_TIMEOUT_MS = 8000;

const pageVisible = () => typeof document === "undefined" || !document.hidden;

/**
 * Self-scheduling poller. run() may throw: that counts as a failure and doubles the wait
 * (up to MAX_BACKOFF_MS). It goes idle when the page is hidden or active() is false, and
 * start()/kick() wake it again.
 */
export function createPoller({ run, active = () => true, baseMs = VERSIONS_BASE_MS, jitterMs = JITTER_MS, minGapMs = 1000 }) {
  let timer = 0;
  let running = false;
  let idle = true;
  let fails = 0;
  let lastRunAt = 0;
  let base = baseMs;

  function nextDelay() {
    const backoff = fails ? Math.min(MAX_BACKOFF_MS, base * 2 ** fails) : base;
    const jitter = (Math.random() * 2 - 1) * jitterMs;
    return Math.max(3000, Math.round(backoff + jitter));
  }

  function schedule() {
    window.clearTimeout(timer);
    timer = 0;
    if (idle) return;
    timer = window.setTimeout(tick, nextDelay());
  }

  async function tick() {
    timer = 0;
    if (idle) return;
    if (!pageVisible() || !active()) {
      idle = true;
      return;
    }
    if (running) {
      schedule();
      return;
    }
    running = true;
    lastRunAt = Date.now();
    try {
      await run();
      fails = 0;
    } catch {
      fails = Math.min(fails + 1, 10);
    } finally {
      running = false;
      schedule();
    }
  }

  /** Run now (once the minimum gap has passed) and keep going on the normal cadence. */
  function kick({ force = false } = {}) {
    if (!pageVisible() || !active()) return;
    if (running) return;
    idle = false;
    if (!force && Date.now() - lastRunAt < minGapMs) {
      if (!timer) schedule();
      return;
    }
    window.clearTimeout(timer);
    timer = 0;
    tick();
  }

  function stop() {
    idle = true;
    window.clearTimeout(timer);
    timer = 0;
  }

  return {
    start: () => kick({ force: true }),
    kick,
    stop,
    setBase(ms) {
      base = Math.max(3000, Number(ms) || baseMs);
    },
    get failures() {
      return fails;
    },
  };
}

/** GET a public JSON endpoint without cookies so the CDN can serve it to everyone. */
export async function fetchPublicJson(name, params = {}) {
  const ctrl = new AbortController();
  const timeout = window.setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(apiUrl(name, params), { credentials: "omit", signal: ctrl.signal });
    const type = res.headers.get("content-type") || "";
    if (!type.includes("application/json")) {
      const err = new Error("Not an API response.");
      err.status = res.status === 200 ? 404 : res.status;
      throw err;
    }
    const data = await res.json().catch(() => null);
    if (!res.ok || !data) {
      const err = new Error("Request failed.");
      err.status = res.status;
      throw err;
    }
    return data;
  } finally {
    window.clearTimeout(timeout);
  }
}

// ---------------------------------------------------------------------------
// Shared versions poller: one request every ~17s per phone, whoever is listening.
// ---------------------------------------------------------------------------

const KEYS = ["waits_v", "announce_v"];
const subscribers = new Set();
const baseline = {};

async function pollVersions() {
  let data;
  try {
    data = await fetchPublicJson("versions");
  } catch (error) {
    subscribers.forEach((sub) => {
      try {
        sub.onFail?.(error);
      } catch {
        /* a listener must not stop the poll */
      }
    });
    throw error;
  }
  const changed = [];
  KEYS.forEach((key) => {
    if (data[key] === undefined || data[key] === null) return;
    const prev = baseline[key];
    baseline[key] = data[key];
    if (prev !== undefined && prev !== data[key]) changed.push(key);
  });
  subscribers.forEach((sub) => {
    try {
      sub.onOk?.(data);
      changed.forEach((key) => sub.onChange?.(key, data[key], data));
    } catch {
      /* a listener must not stop the poll */
    }
  });
}

const versionsPoller = createPoller({ run: pollVersions, active: () => subscribers.size > 0 });

/**
 * sub: { onChange(key, value), onOk(data), onFail(error) }. The first successful poll only sets
 * the baseline (the page just loaded fresh data); later changes call onChange once per change.
 */
export function subscribeVersions(sub) {
  subscribers.add(sub);
  versionsPoller.kick();
  return () => {
    subscribers.delete(sub);
    if (!subscribers.size) versionsPoller.stop();
  };
}

/** Tell the poller which version the data you just loaded belongs to (only used if it has no baseline yet). */
export function seedVersion(key, value) {
  if (baseline[key] === undefined && value !== undefined && value !== null) baseline[key] = value;
}

export function kickVersions() {
  versionsPoller.kick();
}

export function setVersionsBase(ms) {
  versionsPoller.setBase(ms);
}

if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) kickVersions();
    else versionsPoller.stop();
  });
  window.addEventListener("focus", kickVersions);
  window.addEventListener("online", () => versionsPoller.kick({ force: true }));
}
