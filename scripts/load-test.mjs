// 3000-phone event-night scenario, no extra tooling (Node 18+ fetch only).
//
//   1. sign-up burst: every phone creates its card (one shared campus IP, like the real Wi-Fi)
//   2. each phone loads the board once (wait-times-public + announcements)
//   3. phones poll /api?path=versions every 17s +-3s; the board and announcements are fetched only
//      when a version moves (staff change a wait time / post a note during the run)
//   4. a share of phones sit on the stamp card, polling stamps-version and fetching the card when it moves
//
//   npm run load:test                      built-in throwaway stack (PGlite), nothing external
//   PHONES=1000 POLL_SECONDS=30 npm run load:test
//   CDN=0 npm run load:test                see the origin with no cache in front (worst case)
//   BASE_URL=http://127.0.0.1:3000 npm run load:test      a stack you started yourself
//
// BASE_URL is required to aim anywhere else. Anything that is not loopback also needs
// LOAD_CONFIRM=I_OWN_THIS_TARGET, because the run creates thousands of test students (P269xxxx).
// Never point this at the live site.
//
// The built-in stack puts a small edge-cache emulator (honours s-maxage and stale-while-revalidate,
// ignores requests that carry credentials) in front of the API, the way Vercel's CDN sits in front of
// the function. The report separates what phones asked for from what reached the "function".

import http from "node:http";
import crypto from "node:crypto";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const PHONES = Number(process.env.PHONES) || 3000;
const POLL_SECONDS = Number(process.env.POLL_SECONDS) || 60;
const SIGNUP_CONCURRENCY = Number(process.env.SIGNUP_CONCURRENCY) || 100;
const STAMP_VIEW_FRACTION = Number(process.env.STAMP_VIEW_FRACTION) || 0.1;
const POLL_MS = 17000;
const JITTER_MS = 3000;
const EXTERNAL = (process.env.BASE_URL || "").replace(/\/$/, "");

if (EXTERNAL) {
  const host = new URL(EXTERNAL).hostname;
  const loopback = /^(127\.0\.0\.1|localhost|\[::1\])$/.test(host);
  if (!loopback && process.env.LOAD_CONFIRM !== "I_OWN_THIS_TARGET") {
    console.error(`Refusing to load ${host}. Set LOAD_CONFIRM=I_OWN_THIS_TARGET only for a target you own and may flood.`);
    process.exit(2);
  }
}

let BASE = EXTERNAL;
let dev = null;
let server = null;
let edge = null;
const originHits = new Map();
const edgeHits = { hit: 0, stale: 0, miss: 0, bypass: 0 };
const USE_CDN = process.env.CDN !== "0";
let staffPass = process.env.LOAD_ADMIN_PASS || "";
const STAFF = "P2400001";

if (!EXTERNAL) {
  const { startDevDb } = await import("./dev-db.mjs");
  dev = await startDevDb({ port: 54394, quiet: true });
  staffPass = "load-admin-" + crypto.randomBytes(4).toString("hex");
  await dev.db.query(
    "insert into public.students (student_number, full_name, role) values ($1, 'Local Staff', 'admin') on conflict (student_number) do update set role = 'admin'",
    [STAFF]
  );
  Object.assign(process.env, {
    SUPABASE_URL: dev.url,
    SUPABASE_ANON_KEY: dev.anonKey,
    SUPABASE_SERVICE_ROLE_KEY: dev.serviceKey,
    JWT_SECRET: crypto.randomBytes(32).toString("hex"),
    ADMIN_PASSCODE: staffPass,
    REQUIRE_STAFF_ROLE: "1",
    SITE_ORIGIN: "",
  });
  const apiHandler = require("../api/index.js");
  server = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    req.query = Object.fromEntries(url.searchParams);
    res.status = (code) => {
      res.statusCode = code;
      return res;
    };
    res.json = (body) => {
      if (!res.headersSent) res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.end(JSON.stringify(body));
      return res;
    };
    await apiHandler(req, res);
  });
  await new Promise((resolve) => server.listen(54393, "127.0.0.1", resolve));
  BASE = "http://127.0.0.1:54393";
  if (USE_CDN) {
    const cache = new Map();
    const inflight = new Map();
    const ORIGIN = BASE;
    const fromOrigin = async (req, body) => {
      const name = new URL(req.url, ORIGIN).searchParams.get("path") || "other";
      originHits.set(name, (originHits.get(name) || 0) + 1);
      const headers = { ...req.headers };
      delete headers.host;
      delete headers.connection;
      delete headers["content-length"];
      if (headers.origin) headers.origin = ORIGIN; // the function sees its own origin, as it does behind the real CDN
      const res = await fetch(ORIGIN + req.url, { method: req.method, headers, body: body.length ? body : undefined });
      const buf = Buffer.from(await res.arrayBuffer());
      return { status: res.status, headers: Object.fromEntries(res.headers), buf };
    };
    edge = http.createServer(async (req, res) => {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const body = Buffer.concat(chunks);
      const send = (out) => {
        const headers = { ...out.headers };
        delete headers["content-encoding"];
        delete headers["transfer-encoding"];
        res.writeHead(out.status, headers);
        res.end(out.buf);
      };
      const cacheable = req.method === "GET" && !req.headers.authorization && !req.headers.cookie;
      const now = Date.now();
      const entry = cacheable ? cache.get(req.url) : null;
      if (entry && now < entry.fresh) {
        edgeHits.hit += 1;
        return send(entry.out);
      }
      if (entry && now < entry.stale) {
        edgeHits.stale += 1;
        if (!entry.refreshing) {
          entry.refreshing = true;
          fromOrigin(req, body).then((out) => store(req.url, out)).catch(() => {}).finally(() => (entry.refreshing = false));
        }
        return send(entry.out);
      }
      edgeHits[cacheable ? "miss" : "bypass"] += 1;
      if (!cacheable) return send(await fromOrigin(req, body).catch(() => ({ status: 502, headers: {}, buf: Buffer.from("{}") })));
      // Like the real CDN, simultaneous misses for one URL share a single trip to the function.
      let pending = inflight.get(req.url);
      if (!pending) {
        pending = fromOrigin(req, body)
          .catch(() => ({ status: 502, headers: {}, buf: Buffer.from("{}") }))
          .finally(() => inflight.delete(req.url));
        inflight.set(req.url, pending);
        pending.then((out) => store(req.url, out));
      }
      send(await pending);
    });
    const store = (key, out) => {
      const cc = String(out.headers["cache-control"] || "");
      const max = /s-maxage=(\d+)/.exec(cc);
      if (out.status !== 200 || !/public/.test(cc) || !max) return;
      const swr = /stale-while-revalidate=(\d+)/.exec(cc);
      const t = Date.now();
      cache.set(key, { out, fresh: t + Number(max[1]) * 1000, stale: t + (Number(max[1]) + Number(swr ? swr[1] : 0)) * 1000 });
    };
    await new Promise((resolve) => edge.listen(54392, "127.0.0.1", resolve));
    BASE = "http://127.0.0.1:54392";
  }
}

const stats = new Map();
function record(label, ms, status) {
  let s = stats.get(label);
  if (!s) stats.set(label, (s = { ms: [], ok: 0, err: 0, codes: new Map() }));
  s.ms.push(ms);
  if (status >= 200 && status < 300) s.ok += 1;
  else s.err += 1;
  s.codes.set(status, (s.codes.get(status) || 0) + 1);
}

async function call(label, route, { method = "GET", body, token, ip = "10.20.30.40" } = {}) {
  const headers = { Origin: BASE, "X-Forwarded-For": ip };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (token) headers.Authorization = `Bearer ${token}`;
  const t0 = performance.now();
  let status = 0;
  let data = null;
  try {
    const res = await fetch(`${BASE}/api?path=${route}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    status = res.status;
    data = await res.json().catch(() => null);
  } catch {
    status = 0;
  }
  record(label, performance.now() - t0, status);
  return { status, data };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const jittered = () => POLL_MS + (Math.random() * 2 - 1) * JITTER_MS;

// --- staff (changes waits and posts a note during the run, so versions really move) -------------
const staffCookieless = { token: "" };
async function staffLogin() {
  const login = await call("staff-setup", "login", { method: "POST", body: { adminNumber: STAFF, fullName: "Local Staff" }, ip: "10.99.0.1" });
  const studentToken = login.data && login.data.token;
  const unlock = await fetch(`${BASE}/api?path=admin-auth`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: BASE, Authorization: `Bearer ${studentToken}`, "X-Forwarded-For": "10.99.0.1" },
    body: JSON.stringify({ passcode: staffPass }),
  });
  const data = await unlock.json().catch(() => ({}));
  staffCookieless.token = data.staffToken || "";
  staffCookieless.student = studentToken;
  return Boolean(staffCookieless.token);
}

// --- phones -------------------------------------------------------------------------------------
const phones = [];
const runUntil = { at: 0 };

async function phoneLoop(phone) {
  await sleep(Math.random() * POLL_MS); // phones join at random points in the cycle
  let waitsV = null;
  let announceV = null;
  let stampV = null;
  while (Date.now() < runUntil.at) {
    const v = await call("versions", "versions");
    if (v.status === 200) {
      if (waitsV !== null && v.data.waits_v !== waitsV) await call("wait-times-public", `wait-times-public&v=${v.data.waits_v}`);
      if (announceV !== null && v.data.announce_v !== announceV) await call("announcements-public", `announcements&v=${v.data.announce_v}`);
      waitsV = v.data.waits_v;
      announceV = v.data.announce_v;
    }
    if (phone.onStamps) {
      const s = await call("stamps-version", "stamps-version", { token: phone.token });
      if (s.status === 200) {
        if (stampV !== null && s.data.v !== stampV) await call("stamp-card", "stamps", { token: phone.token });
        stampV = s.data.v;
      }
    }
    await sleep(jittered());
  }
}

async function main() {
  console.log(`Target ${BASE}${dev ? " (built-in throwaway stack)" : ""}`);
  console.log(`${PHONES} phones, ${POLL_SECONDS}s of polling, sign-up concurrency ${SIGNUP_CONCURRENCY}\n`);

  // 1. sign-up burst
  const t0 = performance.now();
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(SIGNUP_CONCURRENCY, PHONES) }, async () => {
      while (next < PHONES) {
        const i = next++;
        const number = `P26${String(90000 + i).padStart(5, "0")}`;
        const r = await call("signup", "login", { method: "POST", body: { adminNumber: number, fullName: `Load Test ${i}` } });
        phones[i] = { number, token: (r.data && r.data.token) || "", onStamps: Math.random() < STAMP_VIEW_FRACTION };
      }
    })
  );
  const signupSeconds = (performance.now() - t0) / 1000;

  // 2. first paint of the board for everyone
  next = 0;
  await Promise.all(
    Array.from({ length: SIGNUP_CONCURRENCY }, async () => {
      while (next < PHONES) {
        const i = next++;
        await call("wait-times-public", "wait-times-public");
        await call("announcements-public", "announcements");
        if (phones[i].onStamps) await call("stamp-card", "stamps", { token: phones[i].token });
      }
    })
  );

  // 3 + 4. polling, with staff activity in the middle
  const staffOk = await staffLogin();
  runUntil.at = Date.now() + POLL_SECONDS * 1000;
  const loops = phones.map((p) => phoneLoop(p));
  const staffTask = (async () => {
    if (!staffOk) return;
    let n = 0;
    while (Date.now() < runUntil.at - 2000) {
      await sleep(Math.min(8000, (POLL_SECONDS * 1000) / 6));
      n += 1;
      await call("staff-wait-update", "wait-times", { method: "POST", token: staffCookieless.token, body: { id: "clowns", wait_minutes: 10 + (n % 30) } });
      if (n % 3 === 0) await call("staff-announce", "announcements", { method: "POST", token: staffCookieless.token, body: { message: `Load note ${n}` } });
      if (phones[n]) await call("staff-award", "award-stamp", { method: "POST", token: staffCookieless.token, body: { studentNumber: phones[n].number, boothId: "1" } });
    }
  })();
  const started = performance.now();
  await Promise.all([...loops, staffTask]);
  const pollSeconds = (performance.now() - started) / 1000;

  report(signupSeconds, pollSeconds);
}

function pct(sorted, p) {
  if (!sorted.length) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}

function report(signupSeconds, pollSeconds) {
  const rows = [];
  let total = 0;
  let errors = 0;
  for (const [label, s] of [...stats].sort()) {
    const sorted = [...s.ms].sort((a, b) => a - b);
    total += s.ok + s.err;
    errors += s.err;
    rows.push({
      endpoint: label,
      requests: s.ok + s.err,
      errors: s.err,
      "err%": ((100 * s.err) / (s.ok + s.err)).toFixed(2),
      p50ms: Math.round(pct(sorted, 50)),
      p95ms: Math.round(pct(sorted, 95)),
      p99ms: Math.round(pct(sorted, 99)),
      codes: [...s.codes].map(([c, n]) => `${c}x${n}`).join(" "),
    });
  }
  console.table(rows);
  const versions = stats.get("versions");
  const versionRate = versions ? versions.ms.length / pollSeconds : 0;
  console.log(`Sign-up burst: ${PHONES} cards in ${signupSeconds.toFixed(1)}s (${(PHONES / signupSeconds).toFixed(0)}/s)`);
  console.log(`Polling phase: ${pollSeconds.toFixed(0)}s, versions ${versionRate.toFixed(0)} req/s (expected ~${(PHONES / (POLL_MS / 1000)).toFixed(0)}/s for ${PHONES} phones)`);
  console.log(`All requests: ${total}, errors: ${errors} (${((100 * errors) / total).toFixed(2)}%)`);
  if (edge) {
    const origin = [...originHits].sort().map(([k, n]) => `${k}=${n}`).join("  ");
    const sum = [...originHits.values()].reduce((a, b) => a + b, 0);
    console.log(`Edge cache: ${edgeHits.hit} hits, ${edgeHits.stale} stale-served, ${edgeHits.miss} misses, ${edgeHits.bypass} uncached (credentialed/writes)`);
    console.log(`Reached the function: ${sum} of ${total} requests (${((100 * sum) / total).toFixed(1)}%)  [${origin}]`);
    console.log("Note: one local edge instead of many regions, so this is the best case for caching; the estimate below allows 3 regions.");
  }

  // Event-night estimate. Assumptions (edit to taste): 4 hour night, 3000 phones each open ~2 hours on
  // average, CDN keeps one origin hit per s-maxage window per edge region that serves traffic.
  const nightHours = 4;
  const regions = 3;
  const versionsOrigin = Math.ceil((nightHours * 3600) / 5) * regions; // s-maxage=5
  const waitsChanges = nightHours * 60 * 2; // staff update about twice a minute across all houses
  const waitsOrigin = waitsChanges * regions; // ?v=<waits_v> keys: one origin hit per version per region
  const announceOrigin = 40 * regions;
  const phoneHours = 3000 * 2;
  const stampPolls = Math.round(phoneHours * (3600 / 17) * 0.1 * 0.25); // 10% on stamps view a quarter of the time
  const signups = 3000 * 1; // login: 1 invocation each
  const firstLoad = 3000 * 3; // config, wait-times-public (shared), announcements (shared), stamps
  const staff = 4000; // ~20 staff, award/redeem/lookup/ops
  const night = versionsOrigin + waitsOrigin + announceOrigin + stampPolls + signups + firstLoad + staff;
  console.log("\nEstimated Vercel function invocations for ONE event night (CDN-cached endpoints counted at origin):");
  console.log(`  versions (s-maxage=5, ${regions} regions, ${nightHours}h)      ${versionsOrigin}`);
  console.log(`  wait-times-public (per version, ${regions} regions)          ${waitsOrigin}`);
  console.log(`  announcements (cached 30s / per version)           ${announceOrigin}`);
  console.log(`  stamps-version (private, never cached)             ${stampPolls}`);
  console.log(`  sign-ups                                           ${signups}`);
  console.log(`  first-load config/stamps and misc                  ${firstLoad}`);
  console.log(`  staff desk                                         ${staff}`);
  console.log(`  total                                              ~${night}`);
  const uncached = Math.round(phoneHours * (3600 / 4)); // the old 4s direct poll equivalent through a function
  console.log(`  (for comparison, polling every 4s through the function with no CDN would be ~${uncached})`);
}

try {
  await main();
} finally {
  edge?.close();
  server?.close();
  dev?.server.close();
}
process.exit(0);
