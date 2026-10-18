// Race-condition test: N parallel requests for the same student/booth/ticket, and the database
// has to pick exactly one winner. Runs against a throwaway in-memory database (PGlite) through the
// real API handler, so it never touches Supabase or the live site.
//
//   npm run test:concurrency
//   CONCURRENCY=40 npm run test:concurrency
//
// To aim it at an already running `npm run dev:local` instead of the built-in stack:
//   BASE_URL=http://127.0.0.1:3000 npm run test:concurrency
// Only loopback addresses are accepted. The script writes test students (P2400101...), stamps and
// tickets, so it refuses anything else, whatever the environment says.
//
// Note: PGlite runs one connection, so Postgres itself serialises the requests here. The test proves
// the API/function logic (idempotent awards, single redeem, one sign-up row, best score). Row-lock
// behaviour under real parallel connections comes from the same SQL (FOR UPDATE / primary key /
// ON CONFLICT), which Postgres enforces on Supabase.

import http from "node:http";
import crypto from "node:crypto";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const N = Math.max(2, Number(process.env.CONCURRENCY) || 20);
const EXTERNAL = (process.env.BASE_URL || "").replace(/\/$/, "");

if (EXTERNAL) {
  const host = new URL(EXTERNAL).hostname;
  if (!/^(127\.0\.0\.1|localhost|\[::1\])$/.test(host)) {
    console.error(`Refusing to run against ${host}. This test writes data and only targets localhost.`);
    process.exit(2);
  }
}

const PASS = {
  admin: process.env.CONC_ADMIN_PASS || (EXTERNAL ? "local-admin-pass" : "conc-admin-" + crypto.randomBytes(4).toString("hex")),
};
const STAFF = "P2400001";

let BASE = EXTERNAL;
let dev = null;
let server = null;
let sql = async () => {
  throw new Error("sql helper needs the built-in stack");
};

if (!EXTERNAL) {
  const { startDevDb } = await import("./dev-db.mjs");
  dev = await startDevDb({ port: 54396, quiet: true });
  await dev.db.query(
    "insert into public.students (student_number, full_name, role) values ($1, 'Local Staff', 'admin') on conflict (student_number) do update set role = 'admin'",
    [STAFF]
  );
  Object.assign(process.env, {
    SUPABASE_URL: dev.url,
    SUPABASE_ANON_KEY: dev.anonKey,
    SUPABASE_SERVICE_ROLE_KEY: dev.serviceKey,
    JWT_SECRET: crypto.randomBytes(32).toString("hex"),
    ADMIN_PASSCODE: PASS.admin,
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
  await new Promise((resolve) => server.listen(54395, "127.0.0.1", resolve));
  BASE = "http://127.0.0.1:54395";
  sql = async (text, params = []) => (await dev.db.query(text, params)).rows;
}

function client() {
  const jar = new Map();
  return async function call(route, { method = "GET", body } = {}) {
    const h = { Origin: BASE, "X-Forwarded-For": "10.9.8.7" };
    if (body !== undefined) h["Content-Type"] = "application/json";
    if (jar.size) h.Cookie = [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
    const res = await fetch(`${BASE}/api?path=${route}`, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
    for (const line of res.headers.getSetCookie()) {
      const [pair] = line.split(";");
      const eq = pair.indexOf("=");
      const name = pair.slice(0, eq);
      const value = pair.slice(eq + 1);
      if (!value || /Max-Age=0/i.test(line)) jar.delete(name);
      else jar.set(name, value);
    }
    let data = null;
    try {
      data = await res.json();
    } catch {
      data = null;
    }
    return { status: res.status, data };
  };
}

const results = [];
async function check(name, fn) {
  try {
    await fn();
    results.push({ name, ok: true });
  } catch (error) {
    results.push({ name, ok: false, why: error.message });
  }
}
function expect(cond, why) {
  if (!cond) throw new Error(why);
}
const count = (list, fn) => list.filter(fn).length;
const burst = (fn) => Promise.all(Array.from({ length: N }, (_, i) => fn(i)));

const STUDENT = "P2400101";
const STUDENT_NAME = "Race Runner";

const staff = client();
await staff("login", { method: "POST", body: { adminNumber: STAFF, fullName: "Local Staff" } });
const unlocked = await staff("admin-auth", { method: "POST", body: { passcode: PASS.admin } });
if (unlocked.status !== 200) {
  console.error(`Could not unlock the staff desk (${unlocked.status}). For BASE_URL runs set CONC_ADMIN_PASS.`);
  process.exit(2);
}

await check(`${N} phones sign up the same new number at once: one student row`, async () => {
  const rs = await burst(() => client()("login", { method: "POST", body: { adminNumber: STUDENT, fullName: STUDENT_NAME } }));
  expect(rs.every((r) => r.status === 200), `statuses ${[...new Set(rs.map((r) => r.status))]}`);
  expect(count(rs, (r) => r.data.created === true) === 1, `created=true ${count(rs, (r) => r.data.created === true)} times`);
  if (dev) {
    const rows = await sql("select count(*)::int as n from public.students where student_number = $1", [STUDENT]);
    expect(rows[0].n === 1, `${rows[0].n} student rows`);
  }
});

await check(`${N} parallel awards, same student and booth: one stamp, the rest "already"`, async () => {
  const rs = await burst(() => staff("award-stamp", { method: "POST", body: { studentNumber: STUDENT, boothId: "1" } }));
  expect(rs.every((r) => r.status === 200), `statuses ${[...new Set(rs.map((r) => r.status))]}`);
  expect(count(rs, (r) => r.data.already === false) === 1, `${count(rs, (r) => r.data.already === false)} winners`);
  expect(count(rs, (r) => r.data.already === true) === N - 1, "losers were not idempotent successes");
  if (dev) {
    const audit = await sql("select count(*)::int as n from public.staff_audit where action = 'award_stamp' and target = $1", [STUDENT]);
    expect(audit[0].n === 1, `${audit[0].n} award audit rows`);
  }
});

await check("different booths awarded in parallel all land (no lost update on the card)", async () => {
  const booths = ["2", "8", "4", "7"];
  const rs = await Promise.all(
    Array.from({ length: N }, (_, i) => staff("award-stamp", { method: "POST", body: { studentNumber: STUDENT, boothId: booths[i % booths.length] } }))
  );
  expect(rs.every((r) => r.status === 200), "an award failed");
  const card = await staff("lookup-student", { method: "POST", body: { studentNumber: STUDENT } });
  expect(card.data.stampCount === 5, `card has ${card.data.stampCount}/5 stamps`);
});

await check(`${N} parallel redeems: exactly one redeems, the rest say already used`, async () => {
  const rs = await burst(() => staff("redeem", { method: "POST", body: { studentNumber: STUDENT } }));
  expect(rs.every((r) => r.status === 200), `statuses ${[...new Set(rs.map((r) => r.status))]}`);
  expect(count(rs, (r) => r.data.already === false) === 1, `${count(rs, (r) => r.data.already === false)} redeems won`);
  expect(count(rs, (r) => r.data.already === true) === N - 1, "losers did not get the 'already used' answer");
  if (dev) {
    const audit = await sql("select count(*)::int as n from public.staff_audit where action = 'redeem_pass' and target = $1", [STUDENT]);
    expect(audit[0].n === 1, `${audit[0].n} redeem audit rows`);
  }
});

await check("parallel stamp undo after redeem is refused (ticket already used)", async () => {
  const rs = await burst(() => staff("unaward-stamp", { method: "POST", body: { studentNumber: STUDENT, boothId: "1" } }));
  expect(rs.every((r) => r.status === 409 && r.data.code === "redeemed"), `statuses ${[...new Set(rs.map((r) => r.status))]}`);
});

await check(`${N} parallel undo-redeems inside the window: exactly one succeeds`, async () => {
  const rs = await burst(() => staff("unredeem", { method: "POST", body: { studentNumber: STUDENT } }));
  expect(count(rs, (r) => r.status === 200) === 1, `${count(rs, (r) => r.status === 200)} undos succeeded`);
  expect(count(rs, (r) => r.status === 409 && r.data.code === "not_redeemed") === N - 1, "losers did not get a clear 'not marked used' answer");
});

await check(`${N} parallel stamp undos inside the window: exactly one succeeds`, async () => {
  const rs = await burst(() => staff("unaward-stamp", { method: "POST", body: { studentNumber: STUDENT, boothId: "1" } }));
  expect(count(rs, (r) => r.status === 200) === 1, `${count(rs, (r) => r.status === 200)} undos succeeded`);
  expect(count(rs, (r) => r.status === 409 && r.data.code === "not_stamped") === N - 1, "losers did not get a clear 'no such stamp' answer");
});

await check("wheel ticket cannot be redeemed with 4/5 stamps, even in parallel", async () => {
  const rs = await burst(() => staff("redeem", { method: "POST", body: { studentNumber: STUDENT } }));
  expect(rs.every((r) => r.status === 409 && r.data.code === "needs_stamps"), `statuses ${[...new Set(rs.map((r) => r.status))]}`);
});

await check("parallel wait-time saves: every one answers, the board ends on one of them", async () => {
  const before = await client()("versions");
  const rs = await Promise.all(Array.from({ length: N }, (_, i) => staff("wait-times", { method: "POST", body: { id: "clowns", wait_minutes: 10 + i } })));
  expect(rs.every((r) => r.status === 200), `statuses ${[...new Set(rs.map((r) => r.status))]}`);
  const board = await client()("wait-times-public");
  const final = board.data.houses.find((h) => h.id === "clowns").wait_minutes;
  expect(final >= 10 && final < 10 + N, `final wait ${final}`);
  const after = await client()("versions");
  expect(after.data.waits_v > before.data.waits_v, "waits_v did not move");
});

await check("parallel score saves keep the highest", async () => {
  const kid = client();
  await kid("login", { method: "POST", body: { adminNumber: STUDENT, fullName: STUDENT_NAME } });
  const rs = await burst((i) => kid("scores", { method: "PUT", body: { gameId: "catch", score: i * 3 } }));
  expect(rs.every((r) => r.status === 200), "a score save failed");
  const mine = await kid("scores&game=catch");
  expect(mine.data.mine === (N - 1) * 3, `best is ${mine.data.mine}, wanted ${(N - 1) * 3}`);
});

server?.close();
dev?.server.close();

const failed = results.filter((r) => !r.ok);
for (const r of results) console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name}${r.ok ? "" : `\n      ${r.why}`}`);
console.log(`\n${results.length - failed.length}/${results.length} passed (${N} parallel requests per race)`);
process.exit(failed.length ? 1 : 0);
