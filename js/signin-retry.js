// Student sign-in retry: when the door rush makes the server answer "busy" (503), drop the
// connection, or rate-limit with a short Retry-After, try again by itself with exponential
// backoff and full random jitter, for about a minute. Sign-in is conflict-safe on the server
// (a repeat just answers "already exists"), so a retry can never create a second card.
// Pure logic, no DOM, so scripts/signin-retry-test.mjs can run it in Node.

export const RETRY_BASE_MS = 1000;
export const RETRY_CAP_MS = 8000;
export const RETRY_BUDGET_MS = 55000;
/** Show "Lots of ghouls…" once the first attempt has been in flight this long, or on the first retry. */
export const STAGE_ONE_AFTER_MS = 2000;
/** Switch the button to "Almost there…" after this much total wait. */
export const STAGE_TWO_AFTER_MS = 12000;
export const FIRST_TRY_JITTER_MS = 1500;

export const SIGNIN_TEXT = {
  stageOne: "Lots of people signing in… hang tight",
  stageTwo: "Almost there… keep this page open",
  gaveUp: "The crypt is crowded — tap to try again",
};

/** "retry" for busy / unreachable / short rate limits; "stop" for everything the student must fix. */
export function classifySignInError(error, remainingMs = RETRY_BUDGET_MS) {
  if (!error) return "stop";
  const status = Number(error.status) || 0;
  if (error.network || error.timeout || status === 0) return "retry";
  if (status === 502 || status === 503 || status === 504) return "retry";
  if (status === 429) {
    const wait = Number(error.retryAfter) || 0;
    return wait > 0 && wait * 1000 <= remainingMs ? "retry" : "stop";
  }
  return "stop";
}

/** Full jitter: random 0..min(cap, base * 2^attempt), but never sooner than the server's Retry-After. */
export function backoffDelay(attempt, retryAfterSec = 0, rand = Math.random) {
  const ceiling = Math.min(RETRY_CAP_MS, RETRY_BASE_MS * 2 ** Math.max(0, attempt));
  const jittered = Math.round(rand() * ceiling);
  const floor = Math.max(0, Number(retryAfterSec) || 0) * 1000;
  return Math.max(jittered, floor);
}

/**
 * Button status line. Empty string = keep the initial "Summoning your card…".
 * `retried` forces stage one even before the 2 s mark (first retry wins).
 */
export function retryStageText(elapsedMs, { retried = false } = {}) {
  if (elapsedMs >= STAGE_TWO_AFTER_MS) return SIGNIN_TEXT.stageTwo;
  if (retried || elapsedMs >= STAGE_ONE_AFTER_MS) return SIGNIN_TEXT.stageOne;
  return "";
}

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Runs attempt() until it succeeds, fails with a "stop" error, or the budget runs out.
 * onStatus(text) fires when the reassuring line should change (after ~2 s, on first retry,
 * and at ~12 s). A budget run-out rethrows the last error with crowded = true.
 */
export async function withSignInRetry(attempt, {
  onStatus,
  budgetMs = RETRY_BUDGET_MS,
  now = Date.now,
  sleep = defaultSleep,
  rand = Math.random,
  setIntervalFn = typeof setInterval === "function" ? setInterval : null,
  clearIntervalFn = typeof clearInterval === "function" ? clearInterval : null,
} = {}) {
  const started = now();
  let lastText = "";
  let retried = false;
  const publish = () => {
    const text = retryStageText(now() - started, { retried });
    if (text && text !== lastText) {
      lastText = text;
      onStatus?.(text);
    }
  };
  const ticker = onStatus && setIntervalFn ? setIntervalFn(publish, 250) : null;
  try {
    for (let tries = 0; ; tries += 1) {
      try {
        return await attempt();
      } catch (error) {
        const elapsed = now() - started;
        const remaining = budgetMs - elapsed;
        if (classifySignInError(error, remaining) !== "retry") throw error;
        const wait = backoffDelay(tries, error.retryAfter, rand);
        if (wait >= remaining) {
          error.crowded = true;
          throw error;
        }
        retried = true;
        publish();
        await sleep(wait);
        publish();
      }
    }
  } finally {
    if (ticker != null && clearIntervalFn) clearIntervalFn(ticker);
  }
}
