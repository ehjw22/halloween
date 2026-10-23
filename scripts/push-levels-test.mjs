// Unit test for wait-time push thresholds: node scripts/push-levels-test.mjs
import { createRequire } from "node:module";
import assert from "node:assert/strict";

const require = createRequire(import.meta.url);
const { alertForLevels, levelsFromWatch, ALERT_STEPS } = require("../api/_lib/push.js");

const ALL = ALERT_STEPS.map((s) => s.id);
let passed = 0;
function check(label, actual, expected) {
  assert.equal(actual ? actual.id : null, expected, label);
  passed += 1;
}

// Each level fires when the wait drops from above it to at/below it.
const crossings = [
  ["fifty", 55, 50], ["fifty", 60, 45],
  ["forty", 45, 40], ["forty", 50, 35],
  ["thirty", 35, 30], ["thirty", 40, 25],
  ["twenty", 25, 20], ["twenty", 30, 15],
  ["ten", 15, 10], ["ten", 20, 6],
  ["five", 10, 5], ["five", 6, 0],
];
for (const [id, prev, next] of crossings) {
  check(`${prev}->${next} crosses ${id} (only ${id} wanted)`, alertForLevels(prev, next, "open", [id]), id);
  check(`${prev}->${next} crosses ${id} (all wanted)`, alertForLevels(prev, next, "open", ALL), id);
}

// No alert when not crossing, rising, unchanged, closed, or level not wanted.
check("50->50 unchanged", alertForLevels(50, 50, "open", ALL), null);
check("41->41", alertForLevels(41, 41, "open", ALL), null);
check("45->42 no boundary", alertForLevels(45, 42, "open", ALL), null);
check("30->40 rising", alertForLevels(30, 40, "open", ALL), null);
check("30->25 below 30 already", alertForLevels(30, 25, "open", ALL), null);
check("closed status", alertForLevels(60, 0, "closed", ALL), null);
check("unwanted level", alertForLevels(45, 35, "open", ["ten"]), null);
check("null previous", alertForLevels(null, 10, "open", ALL), null);

// String inputs (as JSON/DB may give) still work.
check("string minutes", alertForLevels("55", "45", "open", ALL), "fifty");

// Big drop crossing several wanted levels: the lowest crossed level is reported once.
check("60->8 all levels -> ten", alertForLevels(60, 8, "open", ALL), "ten");
check("60->25 forty+thirty wanted -> thirty", alertForLevels(60, 25, "open", ["forty", "thirty"]), "thirty");

// Reopened house (server passes previous = 999).
check("reopened at 0", alertForLevels(999, 0, "gonow", ALL), "five");
check("reopened at 35, defaults", alertForLevels(999, 35, "open", levelsFromWatch(["h1"])), "forty");

// Watch parsing: explicit levels, defaults, and JSON-string jsonb.
assert.deepEqual(levelsFromWatch(["h1", "level:fifty", "level:ten"]), ["fifty", "ten"]); passed += 1;
assert.deepEqual(levelsFromWatch(["h1"]), ["forty", "thirty", "twenty"]); passed += 1;
assert.deepEqual(levelsFromWatch('["h1","level:five"]'), ["five"]); passed += 1;
assert.deepEqual(levelsFromWatch(["level:bogus"]), ["forty", "thirty", "twenty"]); passed += 1;

// Repeated cycles are not deduped forever: 55->45 fires, back up, fires again.
check("cycle 1", alertForLevels(55, 45, "open", ALL), "fifty");
check("cycle back up", alertForLevels(45, 55, "open", ALL), null);
check("cycle 2", alertForLevels(55, 45, "open", ALL), "fifty");

console.log(`push-levels-test: ${passed} checks passed`);
