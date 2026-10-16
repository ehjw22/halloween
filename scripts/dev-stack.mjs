// Full local stack with a throwaway database: PGlite (scripts/dev-db.mjs) + server.js.
// Nothing touches the live Supabase project, whatever .env says.
//
//   npm run dev:local        then open http://127.0.0.1:3000/?dev=scream
//
// Test passwords are printed on start. Staff unlock also needs an account with a staff
// role, so the admin number below is pre-seeded as one.

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { startDevDb } from "./dev-db.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
if (!fs.existsSync(path.join(ROOT, "server.js"))) {
  console.error("server.js (the local static server) is missing.");
  process.exit(1);
}

const dev = await startDevDb();
const STAFF_NUMBER = "P2400001";
await dev.db.query(
  "insert into public.students (student_number, full_name, role) values ($1, 'Local Staff', 'admin') on conflict (student_number) do update set role = 'admin'",
  [STAFF_NUMBER]
);

const passes = {
  ADMIN_PASSCODE: "local-admin-pass",
  WAIT_PASSCODE: "local-waits-pass",
  REDEEM_PASSCODE: "local-redeem-pass",
  BOOTH_INK_PASSCODE: "local-ink-pass",
  BOOTH_HAT_PASSCODE: "local-hat-pass",
  BOOTH_EYE_PASSCODE: "local-eye-pass",
  BOOTH_SKEL_PASSCODE: "local-skel-pass",
  BOOTH_SCREAM_PASSCODE: "local-scream-pass",
  HOUSE_THREE_DOORS_PASSCODE: "local-house-pass",
};

for (const key of Object.keys(process.env)) {
  if (/_PASSCODE$/.test(key)) delete process.env[key];
}
Object.assign(process.env, {
  SUPABASE_URL: dev.url,
  SUPABASE_ANON_KEY: dev.anonKey,
  SUPABASE_SERVICE_ROLE_KEY: dev.serviceKey,
  JWT_SECRET: crypto.randomBytes(32).toString("hex"),
  REQUIRE_STAFF_ROLE: "1",
  ...passes,
});
for (const name of ["NEXT_PUBLIC_SUPABASE_URL", "VITE_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "VITE_SUPABASE_ANON_KEY"]) {
  delete process.env[name];
}

require(path.join(ROOT, "server.js"));

console.log("\nLocal test passwords (throwaway, this process only):");
Object.entries(passes).forEach(([k, v]) => console.log(`  ${k.padEnd(28)} ${v}`));
console.log(`  Staff admin number            ${STAFF_NUMBER} (name "Local Staff")\n`);
