// Unit test for the student sign-in retry rules (js/signin-retry.js). No network, no browser.
//
//   npm run test:retry

import {
  RETRY_BUDGET_MS,
  RETRY_CAP_MS,
  SIGNIN_TEXT,
  backoffDelay,
  classifySignInError,
  retryStageText,
  withSignInRetry,
} from "../js/signin-retry.js";

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
const fail = (props) => Object.assign(new Error("x"), props);

// A fake clock: sleep() just moves time forward.
function clock() {
  let t = 0;
  return { now: () => t, sleep: async (ms) => { t += ms; }, get t() { return t; } };
}

await check("busy, unreachable and timed-out sign-ins are retried", async () => {
  for (const e of [fail({ status: 503 }), fail({ status: 502 }), fail({ status: 504 }), fail({ status: 0, network: true }), fail({ status: 0, timeout: true })]) {
    expect(classifySignInError(e) === "retry", `status ${e.status} not retried`);
  }
});

await check("validation errors and name mismatches are never retried", async () => {
  for (const e of [fail({ status: 400, code: "bad_number" }), fail({ status: 400, code: "bad_name" }), fail({ status: 409, code: "name_mismatch" }), fail({ status: 401 }), fail({ status: 403 }), fail({ status: 500 })]) {
    expect(classifySignInError(e) === "stop", `status ${e.status} retried`);
  }
});

await check("a 429 retries only with a Retry-After that fits the budget", async () => {
  expect(classifySignInError(fail({ status: 429, retryAfter: 3 })) === "retry", "short Retry-After not retried");
  expect(classifySignInError(fail({ status: 429 })) === "stop", "429 without Retry-After retried");
  expect(classifySignInError(fail({ status: 429, retryAfter: 600 })) === "stop", "10-minute lockout retried");
});

await check("backoff is full jitter, capped, and honours Retry-After", async () => {
  expect(backoffDelay(0, 0, () => 0.999) <= 1000, "first wait above 1 s");
  expect(backoffDelay(2, 0, () => 0.5) === 2000, "attempt 3 should be half of 4 s");
  expect(backoffDelay(10, 0, () => 0.999) <= RETRY_CAP_MS, "cap ignored");
  expect(backoffDelay(0, 0, () => 0) === 0, "jitter floor not 0");
  expect(backoffDelay(0, 4, () => 0.1) === 4000, "Retry-After not honoured");
});

await check("status text: ghouls first, then keep-this-page-open after 10 s", async () => {
  expect(retryStageText(0) === SIGNIN_TEXT.stageOne && retryStageText(9999) === SIGNIN_TEXT.stageOne, "stage one wrong");
  expect(retryStageText(10000) === SIGNIN_TEXT.stageTwo, "stage two wrong");
});

await check("recovers after a few busy answers and shows each line", async () => {
  const c = clock();
  const shown = [];
  let calls = 0;
  const data = await withSignInRetry(async () => {
    calls += 1;
    if (calls < 4) throw fail({ status: 503, retryAfter: 2 });
    return { student: {}, created: false };
  }, { now: c.now, sleep: c.sleep, rand: () => 0.5, onRetry: (text) => shown.push(text) });
  expect(calls === 4 && data.created === false, `calls ${calls}`);
  expect(shown.length === 3 && shown[0] === SIGNIN_TEXT.stageOne, `shown ${JSON.stringify(shown)}`);
});

await check("a name mismatch fails at once, no retry", async () => {
  const c = clock();
  let calls = 0;
  let caught = null;
  try {
    await withSignInRetry(async () => {
      calls += 1;
      throw fail({ status: 409, code: "name_mismatch" });
    }, { now: c.now, sleep: c.sleep });
  } catch (error) {
    caught = error;
  }
  expect(calls === 1 && caught && !caught.crowded, `calls ${calls}`);
});

await check("gives up inside the budget and marks the error crowded", async () => {
  const c = clock();
  const shown = [];
  let calls = 0;
  let caught = null;
  try {
    await withSignInRetry(async () => {
      calls += 1;
      throw fail({ status: 503 });
    }, { now: c.now, sleep: c.sleep, rand: () => 0.999, onRetry: (text) => shown.push(text) });
  } catch (error) {
    caught = error;
  }
  expect(caught && caught.crowded === true, "not marked crowded");
  expect(c.t < RETRY_BUDGET_MS && c.t > 40000, `waited ${c.t} ms in total`);
  expect(shown.includes(SIGNIN_TEXT.stageTwo), "never moved to stage two");
  expect(calls >= 6, `only ${calls} attempts`);
});

const failed = results.filter((r) => !r.ok);
for (const r of results) console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name}${r.ok ? "" : `\n      ${r.why}`}`);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
