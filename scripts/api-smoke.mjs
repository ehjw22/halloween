// End-to-end API check against an in-memory copy of the database (scripts/dev-db.mjs).
// Uses throwaway test passwords and never reads the live Supabase project.
//
//   npm run test:api

import http from "node:http";
import crypto from "node:crypto";
import { createRequire } from "node:module";
import { startDevDb } from "./dev-db.mjs";

const require = createRequire(import.meta.url);
const dev = await startDevDb({ port: 54398, quiet: true });

const bcrypt = require("bcryptjs");
const webpush = require("web-push");
const vapid = webpush.generateVAPIDKeys();

const PASS = {
  admin: "test-admin-" + crypto.randomBytes(4).toString("hex"),
  waits: "test-waits-" + crypto.randomBytes(4).toString("hex"),
  redeem: "test-redeem-" + crypto.randomBytes(4).toString("hex"),
  ink: "test-ink-" + crypto.randomBytes(4).toString("hex"),
  hat: "test-hat-" + crypto.randomBytes(4).toString("hex"),
  house: "test-house-" + crypto.randomBytes(4).toString("hex"),
};

Object.assign(process.env, {
  SUPABASE_URL: dev.url,
  SUPABASE_ANON_KEY: dev.anonKey,
  SUPABASE_SERVICE_ROLE_KEY: dev.serviceKey,
  JWT_SECRET: crypto.randomBytes(32).toString("hex"),
  ADMIN_PASSCODE: bcrypt.hashSync(PASS.admin, 10),
  WAIT_PASSCODE: PASS.waits,
  REDEEM_PASSCODE: PASS.redeem,
  BOOTH_INK_PASSCODE: bcrypt.hashSync(PASS.ink, 10),
  BOOTH_HAT_PASSCODE: PASS.hat,
  HOUSE_THREE_DOORS_PASSCODE: PASS.house,
  REQUIRE_STAFF_ROLE: "1",
  VAPID_PUBLIC_KEY: vapid.publicKey,
  VAPID_PRIVATE_KEY: vapid.privateKey,
  VAPID_SUBJECT: "mailto:test@example.com",
  SITE_ORIGIN: "",
});
for (const key of Object.keys(process.env)) {
  if (/^(BOOTH|HOUSE)_.+_PASSCODE$/.test(key) && !["BOOTH_INK_PASSCODE", "BOOTH_HAT_PASSCODE", "HOUSE_THREE_DOORS_PASSCODE"].includes(key)) {
    delete process.env[key];
  }
}

const apiHandler = require("../api/index.js");
const server = http.createServer(async (req, res) => {
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
await new Promise((resolve) => server.listen(54397, "127.0.0.1", resolve));
const BASE = "http://127.0.0.1:54397";

function client() {
  const jar = new Map();
  return async function call(route, { method = "GET", body, headers = {}, ip } = {}) {
    const h = { Origin: BASE, ...headers };
    if (body !== undefined && !h["Content-Type"]) h["Content-Type"] = "application/json";
    if (jar.size) h.Cookie = [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
    if (ip) h["X-Forwarded-For"] = ip;
    const res = await fetch(`${BASE}/api?path=${route}`, {
      method,
      headers: h,
      body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
    });
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
    return { status: res.status, data, cookies: res.headers.getSetCookie(), headers: res.headers };
  };
}

async function sql(text, params = []) {
  const res = await fetch(`${dev.url}/dev/sql`, {
    method: "POST",
    headers: { "x-dev-token": dev.devToken, "Content-Type": "application/json" },
    body: JSON.stringify({ sql: text, params }),
  });
  const data = await res.json();
  if (!res.ok) throw Object.assign(new Error(data.message), { code: data.code });
  return data;
}

async function anonRest(pathname, init = {}) {
  const res = await fetch(`${dev.url}/rest/v1/${pathname}`, {
    ...init,
    headers: { apikey: dev.anonKey, Authorization: `Bearer ${dev.anonKey}`, "Content-Type": "application/json", ...(init.headers || {}) },
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  return { status: res.status, data };
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

const STUDENT = "P2509460";
const STAFF = "P2400001";
const kid = client();
const staff = client();
const ipA = "10.0.0.1";

await check("config exposes only public keys", async () => {
  const r = await kid("config");
  expect(r.status === 200 && r.data.supabaseAnonKey === dev.anonKey, "config missing anon key");
  expect(!JSON.stringify(r.data).includes(dev.serviceKey), "service key leaked in config");
});

await check("anon key cannot read or write private tables", async () => {
  for (const table of ["students", "stamp_cards", "staff_audit", "push_subscriptions", "scream_rate_limits", "feedback"]) {
    const r = await anonRest(`${table}?select=*`);
    expect(r.status >= 400 || (Array.isArray(r.data) && r.data.length === 0), `${table} readable by anon (${r.status})`);
  }
  const ins = await anonRest("students", { method: "POST", body: JSON.stringify({ student_number: "P2500009", full_name: "Hacker" }) });
  expect(ins.status >= 400, `anon insert into students allowed (${ins.status})`);
  const patch = await anonRest("scare_houses?id=eq.clowns", { method: "PATCH", body: JSON.stringify({ wait_minutes: 1 }) });
  const after = await sql("select wait_minutes from public.scare_houses where id = 'clowns'");
  expect(patch.status >= 400 || after[0].wait_minutes !== 1, "anon could change a wait time");
});

await check("anon key cannot call privileged database functions", async () => {
  for (const fn of ["scream_award_stamp", "scream_redeem_pass", "scream_set_wait", "scream_student_sign_in", "scream_ops_summary", "scream_lookup_student", "scream_rate_reset"]) {
    const r = await anonRest(`rpc/${fn}`, { method: "POST", body: JSON.stringify({}) });
    expect(r.status === 401 || r.status === 403 || r.status === 404, `${fn} callable by anon (${r.status})`);
  }
});

await check("anon key can still read public wait times", async () => {
  const r = await anonRest("scare_houses?select=id,wait_minutes,status");
  expect(r.status === 200 && r.data.length >= 10, `scare_houses read failed (${r.status})`);
});

await check("database rejects admin numbers outside 22-26", async () => {
  let failed = false;
  try {
    await sql("insert into public.students (student_number, full_name) values ('P2109460', 'Old Timer')");
  } catch (error) {
    failed = error.code === "23514";
  }
  expect(failed, "check constraint missing");
});

await check("sign-in validates number and name", async () => {
  let r = await kid("login", { method: "POST", body: { adminNumber: "P2109460", fullName: "Test Kid" }, ip: ipA });
  expect(r.status === 400 && r.data.code === "bad_number", `old year accepted (${r.status})`);
  r = await kid("login", { method: "POST", body: { adminNumber: STUDENT, fullName: "A" }, ip: ipA });
  expect(r.status === 400 && r.data.code === "bad_name", `short name accepted (${r.status})`);
});

await check("new student signs up with number and name", async () => {
  const r = await kid("login", { method: "POST", body: { adminNumber: "p2509460", fullName: "  test   kid " }, ip: ipA });
  expect(r.status === 200 && r.data.created, `sign-up failed ${r.status} ${JSON.stringify(r.data)}`);
  const cookie = r.cookies.find((c) => c.startsWith("sp_scream_student="));
  expect(cookie && /HttpOnly/i.test(cookie) && /SameSite=Strict/i.test(cookie), "student cookie flags wrong");
  const rows = await sql("select full_name from public.students where student_number = $1", [STUDENT]);
  expect(rows[0] && rows[0].full_name === "test kid", `stored name ${rows[0] && rows[0].full_name}`);
});

await check("returning student signs in; a different name is refused", async () => {
  const other = client();
  let r = await other("login", { method: "POST", body: { adminNumber: STUDENT, fullName: "Test Kid" }, ip: ipA });
  expect(r.status === 200 && !r.data.created, `returning sign-in failed (${r.status})`);
  r = await other("login", { method: "POST", body: { adminNumber: STUDENT, fullName: "Someone Else" }, ip: ipA });
  expect(r.status === 409 && r.data.code === "name_mismatch", `wrong name gave ${r.status}`);
});

await check("staff unlock needs a student session and a staff account", async () => {
  const stranger = client();
  let r = await stranger("login", { method: "POST", body: { password: PASS.admin }, ip: ipA });
  expect(r.status === 401, `staff unlock without session gave ${r.status}`);
  r = await kid("login", { method: "POST", body: { password: PASS.admin }, ip: ipA });
  expect(r.status === 401, `non-staff student unlocked staff (${r.status})`);
});

await sql("insert into public.students (student_number, full_name, role) values ($1, 'Staff Person', 'admin') on conflict (student_number) do update set role = 'admin'", [STAFF]);

await check("admin number alone unlocks nothing", async () => {
  const r = await staff("admin-auth");
  expect(r.status === 200 && r.data.staff === null, `admin-auth GET without session gave ${r.status}`);
  const ops = await staff("ops");
  expect(ops.status === 401, `ops without staff session gave ${ops.status}`);
});

async function unlock(pass) {
  const c = client();
  let r = await c("login", { method: "POST", body: { adminNumber: STAFF, fullName: "Staff Person" }, ip: "10.0.0.2" });
  expect(r.status === 200, `staff student sign-in failed ${r.status} ${JSON.stringify(r.data)}`);
  r = await c("login", { method: "POST", body: { password: pass }, ip: "10.0.0.2" });
  return { c, r };
}

await check("wrong staff password is refused", async () => {
  const { r } = await unlock("definitely-wrong-pass");
  expect(r.status === 401, `wrong staff password gave ${r.status}`);
});

const ink = await unlock(PASS.ink);
const hat = await unlock(PASS.hat);
const waits = await unlock(PASS.waits);
const houseStaff = await unlock(PASS.house);
const redeem = await unlock(PASS.redeem);
const admin = await unlock(PASS.admin);

await check("each password unlocks exactly its scope (bcrypt and plain)", async () => {
  expect(ink.r.data?.staff?.staffScope === "booth:1", `ink scope ${JSON.stringify(ink.r.data)}`);
  expect(hat.r.data?.staff?.staffScope === "booth:2", "hat scope");
  expect(waits.r.data?.staff?.staffScope === "waits", "waits scope");
  expect(houseStaff.r.data?.staff?.staffScope === "house:three-doors", "house scope");
  expect(redeem.r.data?.staff?.staffScope === "redeem", "redeem scope");
  expect(admin.r.data?.staff?.staffScope === "admin", "admin scope");
  const cookie = admin.r.cookies.find((c) => c.startsWith("sp_scream_staff="));
  expect(cookie && /HttpOnly/i.test(cookie) && /Max-Age=21600/.test(cookie), "staff cookie not HttpOnly or not 6h");
});

await check("booth staff award only their own booth, idempotently", async () => {
  let r = await ink.c("award-stamp", { method: "POST", body: { studentNumber: STUDENT, boothId: "1" } });
  expect(r.status === 200 && r.data.stamps["1"] && !r.data.already, `ink award ${r.status}`);
  r = await ink.c("award-stamp", { method: "POST", body: { studentNumber: STUDENT, boothId: "1" } });
  expect(r.status === 200 && r.data.already, "second award not marked already");
  r = await ink.c("award-stamp", { method: "POST", body: { studentNumber: STUDENT, boothId: "2" } });
  expect(r.status === 403, `ink awarded hat (${r.status})`);
  r = await ink.c("redeem", { method: "POST", body: { studentNumber: STUDENT } });
  expect(r.status === 403, `booth staff redeemed (${r.status})`);
  r = await ink.c("wait-times", { method: "POST", body: { id: "clowns", wait_minutes: 5 } });
  expect(r.status === 403, `booth staff changed waits (${r.status})`);
  const audit = await sql("select count(*)::int n from public.staff_audit where action = 'award_stamp'");
  expect(audit[0].n === 1, `award audited ${audit[0].n} times, expected 1`);
});

await check("concurrent duplicate awards write one stamp", async () => {
  const all = await Promise.all([1, 2, 3].map(() => hat.c("award-stamp", { method: "POST", body: { studentNumber: STUDENT, boothId: "2" } })));
  expect(all.every((r) => r.status === 200), "a parallel award failed");
  expect(all.filter((r) => !r.data.already).length === 1, "more than one award counted as new");
});

await check("stamp undo works inside the window", async () => {
  let r = await hat.c("unaward-stamp", { method: "POST", body: { studentNumber: STUDENT, boothId: "2" } });
  expect(r.status === 200 && !r.data.stamps["2"], `undo failed ${r.status}`);
  r = await hat.c("unaward-stamp", { method: "POST", body: { studentNumber: STUDENT, boothId: "2" } });
  expect(r.status === 409 && r.data.code === "not_stamped", `double undo gave ${r.status}`);
  r = await hat.c("award-stamp", { method: "POST", body: { studentNumber: STUDENT, boothId: "2" } });
  expect(r.status === 200, "re-award failed");
});

await check("redeem needs 5/5 stamps", async () => {
  const r = await redeem.c("redeem", { method: "POST", body: { studentNumber: STUDENT } });
  expect(r.status === 409 && r.data.code === "needs_stamps" && r.data.stampCount === 2, `redeem early gave ${r.status} ${JSON.stringify(r.data)}`);
  const look = await redeem.c("lookup-student", { method: "POST", body: { studentNumber: STUDENT } });
  expect(look.status === 200 && look.data.stampCount === 2, "lookup stamp count wrong");
});

await check("redeem and undo round-trip, and the card sees it", async () => {
  for (const booth of ["8", "4", "7"]) {
    const r = await admin.c("award-stamp", { method: "POST", body: { studentNumber: STUDENT, boothId: booth } });
    expect(r.status === 200, `admin award ${booth} failed`);
  }
  let r = await redeem.c("redeem", { method: "POST", body: { studentNumber: STUDENT } });
  expect(r.status === 200 && r.data.redeemedAt && !r.data.already, `redeem failed ${r.status}`);
  r = await redeem.c("redeem", { method: "POST", body: { studentNumber: STUDENT } });
  expect(r.status === 200 && r.data.already, "second redeem not marked already");
  let card = await kid("stamps");
  expect(card.status === 200 && card.data.redeemedAt && card.data.stampCount === 5, "student card does not show redeemed");
  r = await ink.c("unaward-stamp", { method: "POST", body: { studentNumber: STUDENT, boothId: "1" } });
  expect(r.status === 409 && r.data.code === "redeemed", "stamp removed from a used ticket");
  r = await redeem.c("unredeem", { method: "POST", body: { studentNumber: STUDENT } });
  expect(r.status === 200, `unredeem failed ${r.status}`);
  const row = await sql("select redeemed_at, redeemed_by from public.stamp_cards where student_number = $1", [STUDENT]);
  expect(row[0].redeemed_at === null && row[0].redeemed_by === null, "unredeem did not reset the database row");
  card = await kid("stamps");
  expect(card.data.redeemedAt === null, "student card still redeemed");
  r = await redeem.c("unredeem", { method: "POST", body: { studentNumber: STUDENT } });
  expect(r.status === 409 && r.data.code === "not_redeemed", "double unredeem not refused");
  const audit = await sql("select action from public.staff_audit where action in ('redeem_pass','unredeem_pass') order by at");
  expect(audit.map((a) => a.action).join(",") === "redeem_pass,unredeem_pass", `audit ${JSON.stringify(audit)}`);
});

await check("undo window closes after two minutes", async () => {
  await redeem.c("redeem", { method: "POST", body: { studentNumber: STUDENT } });
  await sql("update public.stamp_cards set redeemed_at = now() - interval '5 minutes' where student_number = $1", [STUDENT]);
  const r = await redeem.c("unredeem", { method: "POST", body: { studentNumber: STUDENT } });
  expect(r.status === 409 && r.data.code === "window_closed", `late undo gave ${r.status}`);
});

await check("wait bands (60 minutes or more reads as Closed)", async () => {
  const bands = [[3, "gonow"], [5, "gonow"], [6, "open"], [20, "open"], [21, "busy"], [39, "busy"], [40, "long"], [59, "long"], [60, "closed"], [75, "closed"], [10, "open"]];
  for (const [wait, status] of bands) {
    const r = await waits.c("wait-times", { method: "POST", body: { id: "clowns", wait_minutes: wait } });
    expect(r.status === 200 && r.data.house.status === status, `${wait} min gave ${r.data?.house?.status}`);
    expect(r.data.house.wait_minutes === wait, `${wait} min was saved as ${r.data.house.wait_minutes}`);
  }
  let r = await waits.c("wait-times", { method: "POST", body: { id: "clowns", closed: true } });
  expect(r.status === 400, `a closed-only write gave ${r.status}; the Closed switch is gone`);
  r = await waits.c("wait-times", { method: "POST", body: { id: "not-a-house", wait_minutes: 10 } });
  expect(r.status === 400, "unknown house accepted");
});

await check("house password updates only its own house", async () => {
  let r = await houseStaff.c("wait-times", { method: "POST", body: { id: "three-doors", wait_minutes: 12 } });
  expect(r.status === 200, `own house failed ${r.status}`);
  r = await houseStaff.c("wait-times", { method: "POST", body: { id: "marionette", wait_minutes: 12 } });
  expect(r.status === 403, `other house allowed ${r.status}`);
  r = await houseStaff.c("award-stamp", { method: "POST", body: { studentNumber: STUDENT, boothId: "1" } });
  expect(r.status === 403, "house staff awarded a stamp");
});

await check("command post counts are right", async () => {
  await client()("login", { method: "POST", body: { adminNumber: "P2600002", fullName: "Second Kid" }, ip: "10.0.0.9" });
  await ink.c("award-stamp", { method: "POST", body: { studentNumber: "P2600002", boothId: "1" } });
  await admin.c("award-stamp", { method: "POST", body: { studentNumber: "P2600002", boothId: "8" } });
  const r = await admin.c("ops");
  expect(r.status === 200, `ops ${r.status}`);
  expect(r.data.fastPassUnlocked === 1, `fastPassUnlocked ${r.data.fastPassUnlocked}`);
  expect(r.data.stampsPerBooth["8"] === 2, `eyeballs ${r.data.stampsPerBooth["8"]}`);
  expect(r.data.stampsPerBooth["1"] === 2, `ink ${r.data.stampsPerBooth["1"]}`);
  expect(r.data.redeemed === 1, `redeemed ${r.data.redeemed}`);
  expect(r.data.audit.length > 0 && r.data.audit[0].at, "audit missing");
  const other = await redeem.c("ops");
  expect(other.status === 403, `redeem scope saw ops (${other.status})`);
});

await check("cross-site and non-JSON writes are refused", async () => {
  let r = await kid("feedback", { method: "POST", body: { kind: "general", targetId: "night", rating: 5 }, headers: { Origin: "https://evil.example" } });
  expect(r.status === 403, `cross-origin POST gave ${r.status}`);
  r = await kid("feedback", { method: "POST", body: "kind=general", headers: { "Content-Type": "text/plain" } });
  expect(r.status === 415, `text/plain POST gave ${r.status}`);
  r = await kid("feedback", { method: "POST", body: { kind: "general" }, headers: { "Sec-Fetch-Site": "cross-site" } });
  expect(r.status === 403, `sec-fetch-site cross-site gave ${r.status}`);
});

await check("errors do not leak internals", async () => {
  const r = await admin.c("award-stamp", { method: "POST", body: "{not json" });
  const text = JSON.stringify(r.data || {});
  expect(r.status >= 400 && !/stack|at Object|supabase|postgres|select /i.test(text), `leaky error ${text}`);
});

await check("push subscribe needs a session and a real push service", async () => {
  const sub = {
    endpoint: "https://fcm.googleapis.com/fcm/send/abc123",
    keys: { p256dh: "B".repeat(87), auth: "A".repeat(22) },
  };
  const anon = client();
  let r = await anon("push", { method: "POST", body: { subscription: sub, watch: ["clowns"] } });
  expect(r.status === 401, `anon push subscribe gave ${r.status}`);
  r = await kid("push", { method: "POST", body: { subscription: { ...sub, endpoint: "https://evil.example/hook" }, watch: ["clowns"] } });
  expect(r.status === 400, `evil endpoint gave ${r.status}`);
  r = await kid("push", { method: "POST", body: { subscription: { ...sub, endpoint: "http://169.254.169.254/latest" }, watch: ["clowns"] } });
  expect(r.status === 400, `metadata endpoint gave ${r.status}`);
  r = await kid("push", { method: "POST", body: { subscription: sub, watch: ["clowns", "level:ten"] } });
  expect(r.status === 200, `valid subscribe gave ${r.status} ${JSON.stringify(r.data)}`);
  const rows = await sql("select student_number, watch from public.push_subscriptions");
  expect(rows.length === 1 && rows[0].student_number === STUDENT, `subscription not stored against the student ${JSON.stringify(rows)}`);
  r = await kid("push", { method: "DELETE", body: { subscription: sub } });
  expect(r.status === 200, "unsubscribe failed");
  const left = await sql("select count(*)::int n from public.push_subscriptions");
  expect(left[0].n === 0, "unsubscribe left the row");
});

await check("a wait drop pushes to watchers and 410s are deleted", async () => {
  const sent = [];
  const original = webpush.sendNotification;
  webpush.sendNotification = async (sub, payload) => {
    sent.push({ endpoint: sub.endpoint, payload: JSON.parse(payload) });
    if (sub.endpoint.endsWith("/gone")) throw Object.assign(new Error("gone"), { statusCode: 410 });
    return { statusCode: 201 };
  };
  try {
    const keys = { p256dh: "B".repeat(87), auth: "A".repeat(22) };
    const live = { endpoint: "https://fcm.googleapis.com/fcm/send/live", keys };
    const gone = { endpoint: "https://fcm.googleapis.com/fcm/send/gone", keys };
    const other = { endpoint: "https://fcm.googleapis.com/fcm/send/other", keys };
    await waits.c("wait-times", { method: "POST", body: { id: "prisoner", wait_minutes: 35 } });
    await kid("push", { method: "POST", body: { subscription: live, watch: ["prisoner", "level:twenty"] } });
    await kid("push", { method: "POST", body: { subscription: gone, watch: ["prisoner", "level:twenty"] } });
    await kid("push", { method: "POST", body: { subscription: other, watch: ["clowns", "level:twenty"] } });

    await waits.c("wait-times", { method: "POST", body: { id: "prisoner", wait_minutes: 25 } });
    expect(sent.length === 0, "pushed before crossing the 20-minute line");
    await waits.c("wait-times", { method: "POST", body: { id: "prisoner", wait_minutes: 15 } });
    expect(sent.length === 2, `expected 2 sends, got ${sent.length}`);
    expect(sent.every((s) => s.payload.houseId === "prisoner" && /15 min/.test(s.payload.title)), "payload wrong");
    expect(!sent.some((s) => s.endpoint.endsWith("/other")), "pushed someone watching another house");
    const left = await sql("select endpoint from public.push_subscriptions order by endpoint");
    expect(!left.some((r) => r.endpoint.endsWith("/gone")), "410 subscription not deleted");
    expect(left.some((r) => r.endpoint.endsWith("/live")), "live subscription deleted");

    sent.length = 0;
    // 60+ minutes reads as Closed: no alert while it climbs or stays closed, one alert when it drops back.
    sent.length = 0;
    await waits.c("wait-times", { method: "POST", body: { id: "prisoner", wait_minutes: 60 } });
    await waits.c("wait-times", { method: "POST", body: { id: "prisoner", wait_minutes: 70 } });
    expect(sent.length === 0, "pushed while closed");
    await waits.c("wait-times", { method: "POST", body: { id: "prisoner", wait_minutes: 8 } });
    expect(sent.length === 1 && sent[0].endpoint.endsWith("/live") && /8 min/.test(sent[0].payload.title), `reopen alert: ${sent.length} sends`);
  } finally {
    webpush.sendNotification = original;
  }
});

await check("versions is public, tiny and CDN-cacheable", async () => {
  const r = await client()("versions");
  expect(r.status === 200, `versions gave ${r.status}`);
  expect(r.headers.get("cache-control") === "public, s-maxage=5, stale-while-revalidate=20", `versions cache-control: ${r.headers.get("cache-control")}`);
  expect(!/cookie/i.test(r.headers.get("vary") || ""), "versions varies on Cookie");
  expect(Number(r.data.waits_v) > 0 && r.data.announce_v !== undefined && r.data.server_time > 0, `versions body ${JSON.stringify(r.data)}`);
  expect(JSON.stringify(r.data).length < 120, "versions body is not tiny");
  const before = r.data.waits_v;
  await waits.c("wait-times", { method: "POST", body: { id: "clowns", wait_minutes: 33 } });
  const after = await client()("versions");
  expect(after.data.waits_v > before, "waits_v did not move after a wait update");
});

await check("wait-times-public serves only board fields, cached, no auth needed", async () => {
  const r = await client()("wait-times-public");
  expect(r.status === 200 && Array.isArray(r.data.houses) && r.data.houses.length >= 10, "no houses");
  expect(r.headers.get("cache-control") === "public, s-maxage=10, stale-while-revalidate=30", `cache-control: ${r.headers.get("cache-control")}`);
  const keys = Object.keys(r.data.houses[0]).sort().join(",");
  expect(keys === "id,name,status,updated_at,wait_minutes", `columns ${keys}`);
  const clowns = r.data.houses.find((h) => h.id === "clowns");
  expect(clowns && clowns.wait_minutes === 33, "published wait missing");
  const post = await client()("wait-times-public", { method: "POST", body: {} });
  expect(post.status !== 200, "wait-times-public accepted a write");
});

await check("public announcements cache; the staff list and writes do not", async () => {
  const pub = await client()("announcements");
  expect(pub.status === 200 && pub.headers.get("cache-control") === "public, s-maxage=30, stale-while-revalidate=60", `public cache-control: ${pub.headers.get("cache-control")}`);
  const all = await admin.c("announcements&all=1");
  expect(all.status === 200 && all.headers.get("cache-control") === "no-store", `staff list cache-control: ${all.headers.get("cache-control")}`);
  const anon = await client()("announcements&all=1");
  expect(anon.status === 401, `anonymous staff list gave ${anon.status}`);
  const posted = await admin.c("announcements", { method: "POST", body: { message: "Doors at six" } });
  expect(posted.status === 200 && posted.headers.get("cache-control") === "no-store", "post was cacheable");
  const v1 = await client()("versions");
  const patch = await admin.c("announcements", { method: "PATCH", body: { id: posted.data.announcement.id, active: false } });
  expect(patch.status === 200, "take down failed");
  const v2 = await client()("versions");
  expect(v2.data.announce_v >= v1.data.announce_v && v1.data.announce_v > 0, "announce_v did not move");
});

await check("stamps-version is private and moves with the card", async () => {
  const anon = await client()("stamps-version");
  expect(anon.status === 401, `anonymous stamps-version gave ${anon.status}`);
  const a = await kid("stamps-version");
  expect(a.status === 200 && a.headers.get("cache-control") === "private, no-store", `cache-control: ${a.headers.get("cache-control")}`);
  const card = await kid("stamps");
  expect(card.data.version === a.data.v && a.data.v > 0, "card version and stamps-version disagree");
  await new Promise((resolve) => setTimeout(resolve, 5));
  await sql("update public.stamp_cards set updated_at = now() where student_number = $1", [STUDENT]);
  const b = await kid("stamps-version");
  expect(b.data.v > a.data.v, "stamps-version did not move after the card changed");
});

await check("scores keep the best, feedback drops a double tap", async () => {
  const scoreClient = client();
  await scoreClient("login", { method: "POST", body: { adminNumber: STUDENT, fullName: "Test Kid" }, ip: "10.0.0.7" });
  const put = (score) => scoreClient("scores", { method: "PUT", body: { gameId: "memory", score } });
  const results = await Promise.all([put(5), put(9), put(7), put(9), put(1)]);
  expect(results.every((r) => r.status === 200), "a parallel score save failed");
  const rows = await sql("select score from public.game_scores where student_number = $1 and game_id = 'memory'", [STUDENT]);
  expect(rows.length === 1 && rows[0].score === 9, `best score is ${JSON.stringify(rows)}`);
  const note = { kind: "general", message: "Loved the lanterns" };
  const sent = await Promise.all([scoreClient("feedback", { method: "POST", body: note }), scoreClient("feedback", { method: "POST", body: note })]);
  expect(sent.every((r) => r.status === 200), "feedback failed");
  const stored = await sql("select count(*)::int as n from public.event_feedback where student_number = $1 and message = 'Loved the lanterns'", [STUDENT]);
  expect(stored[0].n === 1, `duplicate feedback stored ${stored[0].n} times`);
});

await check("a stale wait save is refused with a clear message", async () => {
  const before = (await sql("select updated_at from public.scare_houses where id = 'clowns'"))[0].updated_at;
  const stale = new Date(new Date(before).getTime() - 60000).toISOString();
  const r = await waits.c("wait-times", { method: "POST", body: { id: "clowns", wait_minutes: 12, expected_updated_at: stale } });
  expect(r.status === 409 && r.data.code === "conflict" && /someone else/i.test(r.data.error), `stale save gave ${r.status} ${JSON.stringify(r.data)}`);
  const ok = await waits.c("wait-times", { method: "POST", body: { id: "clowns", wait_minutes: 12, expected_updated_at: new Date(before).toISOString() } });
  expect(ok.status === 200 && ok.data.house.wait_minutes === 12, `fresh save gave ${ok.status}`);
});

await check("logout clears both session cookies", async () => {
  const r = await admin.c("logout", { method: "POST", body: {} });
  expect(r.status === 200, "logout failed");
  const cleared = r.cookies.filter((c) => /Max-Age=0/i.test(c)).length;
  expect(cleared >= 2, `logout cleared ${cleared} cookies`);
  const after = await admin.c("ops");
  expect(after.status === 401, `ops after logout gave ${after.status}`);
});

server.close();
dev.server.close();

const failed = results.filter((r) => !r.ok);
for (const r of results) console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name}${r.ok ? "" : `\n      ${r.why}`}`);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
