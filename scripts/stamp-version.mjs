// Stamps one build id into every versioned asset URL, so Vercel can cache /js and /css for a year
// ("immutable") and every deploy still reaches every phone.
//
//   npm run stamp          rewrite ?v=<build> in index.html, js/*.js imports, sw.js (+ its cache name)
//   npm run stamp:check    change nothing; exit 1 if anything is out of date (use before deploy)
//
// The build id is a hash of the contents of index.html, css/ and js/ (ignoring the ?v= values
// themselves), so running it twice is a no-op and it only changes when a file really changed.
// There is no build step on Vercel: run this locally, commit the result, then deploy.

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CHECK = process.argv.includes("--check");

function walk(dir, ext, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "vendor") continue;
      walk(full, ext, out);
    } else if (entry.name.endsWith(ext)) {
      out.push(full);
    }
  }
  return out;
}

const rel = (file) => path.relative(ROOT, file).split(path.sep).join("/");
const VERSION_QUERY = /\?v=[A-Za-z0-9_-]+/g;

const jsFiles = walk(path.join(ROOT, "js"), ".js").sort();
const cssFiles = walk(path.join(ROOT, "css"), ".css").sort();
const htmlFile = path.join(ROOT, "index.html");
const swFile = path.join(ROOT, "sw.js");

// Keep each file's own line endings.
const eolOf = (text) => ((text.match(/\r\n/g) || []).length > (text.match(/\n/g) || []).length / 2 ? "\r\n" : "\n");

const hash = crypto.createHash("sha256");
for (const file of [htmlFile, ...cssFiles, ...jsFiles]) {
  const text = fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n").replace(VERSION_QUERY, "");
  hash.update(`${rel(file)}\0${text}\0`);
}
const BUILD = hash.digest("hex").slice(0, 10);

const problems = [];
const changes = [];

function rewrite(file, transform) {
  const raw = fs.readFileSync(file, "utf8");
  const eol = eolOf(raw);
  const next = transform(raw.replace(/\r\n/g, "\n")).replace(/\n/g, eol);
  if (next !== raw) {
    changes.push(rel(file));
    if (!CHECK) fs.writeFileSync(file, next, "utf8");
  }
}

// index.html: local css/js (never js/vendor, which is versioned by its file name).
rewrite(htmlFile, (text) =>
  text.replace(
    /\b(href|src)="((?:css|js)\/(?!vendor\/)[^"?#]+\.(?:css|js))(?:\?v=[A-Za-z0-9_-]+)?"/g,
    (_m, attr, url) => `${attr}="${url}?v=${BUILD}"`
  )
);

// js/*.js: static imports, dynamic imports and the service worker registration.
for (const file of jsFiles) {
  rewrite(file, (text) =>
    text
      .replace(/(\bfrom\s+)(["'])(\.{1,2}\/(?!vendor\/)[\w\-./]+\.js)(?:\?v=[A-Za-z0-9_-]+)?\2/g, (_m, pre, q, url) => `${pre}${q}${url}?v=${BUILD}${q}`)
      .replace(/(\bimport\(\s*)(["'])(\.{1,2}\/(?!vendor\/)[\w\-./]+\.js)(?:\?v=[A-Za-z0-9_-]+)?\2/g, (_m, pre, q, url) => `${pre}${q}${url}?v=${BUILD}${q}`)
      .replace(/(\.register\(\s*)(["'])(\/sw\.js)(?:\?v=[A-Za-z0-9_-]+)?\2/g, (_m, pre, q, url) => `${pre}${q}${url}?v=${BUILD}${q}`)
  );
  const left = fs
    .readFileSync(file, "utf8")
    .split(/\r?\n/)
    .map((line, i) => ({ line, n: i + 1 }))
    .filter(({ line }) => /\bfrom\s+["']\.{1,2}\/(?!vendor\/)[\w\-./]+\.js["']/.test(line) || /\bimport\(\s*["']\.{1,2}\/(?!vendor\/)[\w\-./]+\.js["']/.test(line));
  left.forEach(({ n }) => problems.push(`${rel(file)}:${n} import without ?v=`));
}

// sw.js: build id and a cache name that changes with it, so a deploy drops the old cache.
rewrite(swFile, (text) => text.replace(/const BUILD = "[^"]*";/, `const BUILD = "${BUILD}";`));
if (!/const BUILD = "/.test(fs.readFileSync(swFile, "utf8"))) problems.push("sw.js has no BUILD constant");

if (CHECK) {
  if (changes.length || problems.length) {
    console.error(`Out of date for build ${BUILD}:`);
    changes.forEach((f) => console.error(`  needs stamping: ${f}`));
    problems.forEach((p) => console.error(`  ${p}`));
    console.error("Run: npm run stamp");
    process.exit(1);
  }
  console.log(`Assets are stamped (build ${BUILD}).`);
} else {
  if (problems.length) {
    problems.forEach((p) => console.error(p));
    process.exit(1);
  }
  console.log(`Build ${BUILD}: ${changes.length ? `updated ${changes.length} file(s)` : "nothing to change"}.`);
  changes.forEach((f) => console.log(`  ${f}`));
}
