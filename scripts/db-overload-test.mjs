// Unit/smoke checks for DB-overload → 503 mapping and per-instance sign-in admission.
// Run via: node scripts/db-overload-test.mjs  (also invoked from test:api)

import { createRequire } from "node:module";
import assert from "node:assert/strict";

const require = createRequire(import.meta.url);

process.env.JWT_SECRET = process.env.JWT_SECRET || "test-jwt-secret-for-overload-checks-32b";
process.env.SUPABASE_URL = process.env.SUPABASE_URL || "http://127.0.0.1:9";
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "service-test-key";

const auth = require("../api/_lib/server-auth.js");

const results = [];
function check(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => results.push({ ok: true, name }))
    .catch((err) => results.push({ ok: false, name, why: err && err.message ? err.message : String(err) }));
}

await check("overload PG codes and upstream 5xx map to 503", () => {
  const cases = [
    [502, "", "Bad Gateway", 503],
    [503, "", "Service Unavailable", 503],
    [504, "", "Gateway Timeout", 503],
    [500, "53300", "too many connections", 503],
    [500, "57014", "canceling statement due to statement timeout", 503],
    [500, "57P03", "the database system is in recovery mode", 503],
    [429, "", "Too Many Requests", 503],
    [408, "", "Request Timeout", 503],
    [200, "", "remaining connection slots are reserved", 503],
    [500, "PGRST003", "Timed out waiting to acquire connection", 503],
  ];
  for (const [st, code, msg, want] of cases) {
    assert.equal(auth.isTransientDbFailure(st, code, msg), true, `transient ${st}/${code}`);
    assert.equal(auth.dbFailureStatus(st, code, msg), want, `status ${st}/${code}`);
  }
});

await check("genuine schema/input bugs stay 500", () => {
  const cases = [
    [500, "42P01", "relation \"students\" does not exist"],
    [500, "22P02", "invalid input syntax for type integer"],
    [500, "42703", "column \"nope\" does not exist"],
  ];
  for (const [st, code, msg] of cases) {
    assert.equal(auth.isTransientDbFailure(st, code, msg), false, `not transient ${code}`);
    assert.equal(auth.dbFailureStatus(st, code, msg), 500, `bug ${code}`);
  }
});

await check("client 4xx (except 408/429) keep their status", () => {
  assert.equal(auth.dbFailureStatus(400, "", "bad request"), 400);
  assert.equal(auth.dbFailureStatus(401, "", "JWT expired"), 401);
  assert.equal(auth.dbFailureStatus(404, "PGRST116", "JSON object requested"), 404);
});

await check("SIGNIN_MAX_INFLIGHT queues briefly then returns busy 503", async () => {
  auth.__resetAdmissionForTests();
  process.env.SIGNIN_MAX_INFLIGHT = "2";
  process.env.SIGNIN_QUEUE_MS = "80";
  const started = Date.now();
  const blockers = [
    auth.withSignInGate(() => new Promise((r) => setTimeout(r, 400))),
    auth.withSignInGate(() => new Promise((r) => setTimeout(r, 400))),
  ];
  let busy = null;
  try {
    await auth.withSignInGate(async () => "should-not-run");
  } catch (err) {
    busy = err;
  }
  const waited = Date.now() - started;
  assert.ok(busy && busy.status === 503 && busy.code === "busy", `expected busy, got ${busy && busy.code}`);
  assert.ok(waited >= 60 && waited < 350, `queue wait ${waited} ms (want ~80)`);
  await Promise.all(blockers);
  auth.__resetAdmissionForTests();
  delete process.env.SIGNIN_MAX_INFLIGHT;
  delete process.env.SIGNIN_QUEUE_MS;
});

await check("under the cap, concurrent sign-in work all complete", async () => {
  auth.__resetAdmissionForTests();
  process.env.SIGNIN_MAX_INFLIGHT = "8";
  process.env.SIGNIN_QUEUE_MS = "500";
  const n = 6;
  const out = await Promise.all(
    Array.from({ length: n }, (_, i) => auth.withSignInGate(async () => i))
  );
  assert.deepEqual(out.sort((a, b) => a - b), [...Array(n).keys()]);
  auth.__resetAdmissionForTests();
  delete process.env.SIGNIN_MAX_INFLIGHT;
  delete process.env.SIGNIN_QUEUE_MS;
});

for (const r of results) console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name}${r.ok ? "" : `\n      ${r.why}`}`);
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} db-overload checks passed`);
process.exit(failed.length ? 1 : 0);
