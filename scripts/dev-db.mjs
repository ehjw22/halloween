// Local stand-in for Supabase: an in-memory Postgres (PGlite) running the real
// supabase/schema.sql + migrations, behind a small PostgREST-style HTTP API.
// Local testing only. Nothing here talks to the live project.
//
//   node scripts/dev-db.mjs            start on 127.0.0.1:54321
//   import { startDevDb } from "./dev-db.mjs"   (used by dev-stack.mjs)

import http from "node:http";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const IDENT = /^[a-z_][a-z0-9_]*$/;

function fakeJwt(role) {
  const enc = (obj) => Buffer.from(JSON.stringify(obj)).toString("base64url");
  return `${enc({ alg: "HS256", typ: "JWT" })}.${enc({ role, iss: "dev-db" })}.${crypto.randomBytes(16).toString("base64url")}`;
}

function json(res, status, body, extra = {}) {
  const text = body === undefined ? "" : JSON.stringify(body, (_k, v) => (typeof v === "bigint" ? Number(v) : v));
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", ...cors(), ...extra });
  res.end(text);
}

function cors() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "apikey, authorization, content-type, prefer, x-client-info, accept-profile, content-profile, range",
    "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
    "Access-Control-Expose-Headers": "content-range",
  };
}

function pgError(res, error, role) {
  const code = error.code || "";
  let status = 400;
  if (code === "23505") status = 409;
  else if (code === "42501") status = role === "anon" ? 401 : 403;
  else if (code === "42P01") status = 404;
  else if (code === "42883") status = 404;
  json(res, status, { message: error.message, code: code === "42883" ? "PGRST202" : code, details: error.detail || null, hint: error.hint || null });
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString("utf8");
  return text ? JSON.parse(text) : {};
}

function toParam(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "object") return JSON.stringify(value);
  return value;
}

function parseFilters(searchParams, params) {
  const where = [];
  for (const [key, raw] of searchParams.entries()) {
    if (["select", "order", "limit", "offset", "on_conflict", "columns"].includes(key)) continue;
    if (!IDENT.test(key)) throw Object.assign(new Error(`bad column ${key}`), { code: "42703" });
    const dot = raw.indexOf(".");
    const op = raw.slice(0, dot);
    const val = raw.slice(dot + 1);
    const col = `"${key}"`;
    if (op === "is") {
      where.push(`${col} is ${val === "null" ? "null" : val === "true" ? "true" : "false"}`);
      continue;
    }
    const ops = { eq: "=", neq: "<>", gt: ">", gte: ">=", lt: "<", lte: "<=" };
    if (ops[op]) {
      params.push(val);
      where.push(`${col}::text ${ops[op]} $${params.length}::text`);
    } else if (op === "cs") {
      params.push(val);
      where.push(`${col} @> $${params.length}::jsonb`);
    } else if (op === "in") {
      const list = val.replace(/^\(|\)$/g, "").split(",").map((item) => item.trim());
      const marks = list.map((item) => {
        params.push(item);
        return `$${params.length}::text`;
      });
      where.push(`${col}::text in (${marks.join(",")})`);
    } else {
      throw Object.assign(new Error(`unsupported filter ${op}`), { code: "PGRST100" });
    }
  }
  return where.length ? ` where ${where.join(" and ")}` : "";
}

function selectList(raw) {
  if (!raw || raw === "*") return "*";
  const cols = raw.split(",").map((c) => c.trim()).filter(Boolean);
  cols.forEach((c) => {
    if (!IDENT.test(c)) throw Object.assign(new Error(`bad select ${c}`), { code: "42703" });
  });
  return cols.map((c) => `"${c}"`).join(", ");
}

function orderClause(raw) {
  if (!raw) return "";
  const parts = raw.split(",").map((item) => {
    const [col, dir] = item.split(".");
    if (!IDENT.test(col)) throw Object.assign(new Error(`bad order ${col}`), { code: "42703" });
    return `"${col}" ${dir === "desc" ? "desc" : "asc"}`;
  });
  return ` order by ${parts.join(", ")}`;
}

export async function startDevDb({ port = Number(process.env.DEV_DB_PORT) || 54321, quiet = false } = {}) {
  const db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin bypassrls;
    grant usage on schema public to anon, authenticated, service_role;
    -- Supabase's default privileges: every new table and function is open to the API roles.
    -- The schema has to take those grants away, which is exactly what the tests check.
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
    alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
  `);
  await db.exec(await fs.readFile(path.join(ROOT, "supabase", "schema.sql"), "utf8"));
  const migrations = (await fs.readdir(path.join(ROOT, "supabase")))
    .filter((name) => /^\d{4}-\d{2}-\d{2}-.+\.sql$/.test(name))
    .sort();
  for (const name of migrations) {
    await db.exec(await fs.readFile(path.join(ROOT, "supabase", name), "utf8"));
  }
  await db.exec("grant usage on schema extensions to service_role;");

  const keys = { anon: fakeJwt("anon"), service: fakeJwt("service_role"), dev: crypto.randomBytes(18).toString("base64url") };
  const fnShape = new Map();

  async function shapeOf(fn) {
    if (fnShape.has(fn)) return fnShape.get(fn);
    const { rows } = await db.query(
      `select p.proretset as retset, t.typname as ret from pg_proc p join pg_namespace n on n.oid = p.pronamespace join pg_type t on t.oid = p.prorettype where n.nspname = 'public' and p.proname = $1 limit 1`,
      [fn]
    );
    const shape = rows[0] || null;
    fnShape.set(fn, shape);
    return shape;
  }

  function roleFor(req) {
    const key = String(req.headers.apikey || "").trim() || String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
    if (key === keys.service) return "service_role";
    if (key === keys.anon) return "anon";
    return "";
  }

  async function asRole(role, fn) {
    return db.transaction(async (tx) => {
      await tx.exec(`set local role ${role}`);
      return fn(tx);
    });
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || "127.0.0.1"}`);
    if (req.method === "OPTIONS") {
      res.writeHead(204, cors());
      res.end();
      return;
    }
    try {
      if (url.pathname === "/dev/sql") {
        if (req.headers["x-dev-token"] !== keys.dev) return json(res, 403, { message: "dev token" });
        const body = await readJson(req);
        const result = await db.query(String(body.sql || ""), Array.isArray(body.params) ? body.params : []);
        return json(res, 200, result.rows);
      }
      if (!url.pathname.startsWith("/rest/v1/")) return json(res, 404, { message: "not found" });
      const role = roleFor(req);
      if (!role) return json(res, 401, { message: "Invalid API key", code: "PGRST301" });
      const rest = url.pathname.slice("/rest/v1/".length);

      if (rest.startsWith("rpc/")) {
        const fn = rest.slice(4);
        if (!IDENT.test(fn) || req.method !== "POST") return json(res, 404, { message: "not found", code: "PGRST202" });
        const shape = await shapeOf(fn);
        if (!shape) return json(res, 404, { message: `function ${fn} not found`, code: "PGRST202" });
        const args = await readJson(req);
        const names = Object.keys(args);
        names.forEach((name) => {
          if (!IDENT.test(name)) throw Object.assign(new Error(`bad arg ${name}`), { code: "42883" });
        });
        const params = names.map((name) => toParam(args[name]));
        const call = `public.${fn}(${names.map((name, i) => `${name} => $${i + 1}`).join(", ")})`;
        const result = await asRole(role, (tx) => tx.query(`select * from ${call}`, params));
        if (shape.ret === "void") return json(res, 200, null);
        if (shape.retset) return json(res, 200, result.rows);
        const first = result.rows[0] || {};
        return json(res, 200, first[fn] === undefined ? Object.values(first)[0] ?? null : first[fn]);
      }

      const table = rest;
      if (!IDENT.test(table)) return json(res, 404, { message: "not found", code: "42P01" });
      const prefer = String(req.headers.prefer || "");
      const wantRows = !/return=minimal/.test(prefer);
      const params = [];

      if (req.method === "GET") {
        const where = parseFilters(url.searchParams, params);
        const limit = Number(url.searchParams.get("limit"));
        const sql = `select ${selectList(url.searchParams.get("select"))} from public."${table}"${where}${orderClause(url.searchParams.get("order"))}${Number.isFinite(limit) && limit > 0 ? ` limit ${Math.floor(limit)}` : ""}`;
        const result = await asRole(role, (tx) => tx.query(sql, params));
        return json(res, 200, result.rows);
      }

      if (req.method === "POST") {
        const body = await readJson(req);
        const rows = Array.isArray(body) ? body : [body];
        const cols = [...new Set(rows.flatMap((row) => Object.keys(row)))];
        cols.forEach((c) => {
          if (!IDENT.test(c)) throw Object.assign(new Error(`bad column ${c}`), { code: "42703" });
        });
        const values = rows.map((row) => `(${cols.map((c) => {
          params.push(toParam(row[c]));
          return `$${params.length}`;
        }).join(", ")})`);
        let sql = `insert into public."${table}" (${cols.map((c) => `"${c}"`).join(", ")}) values ${values.join(", ")}`;
        const conflict = url.searchParams.get("on_conflict");
        if (conflict && /merge-duplicates/.test(prefer)) {
          const keysOn = conflict.split(",").map((c) => c.trim());
          keysOn.forEach((c) => {
            if (!IDENT.test(c)) throw Object.assign(new Error(`bad conflict ${c}`), { code: "42703" });
          });
          const updates = cols.filter((c) => !keysOn.includes(c)).map((c) => `"${c}" = excluded."${c}"`);
          sql += ` on conflict (${keysOn.map((c) => `"${c}"`).join(", ")}) do ${updates.length ? `update set ${updates.join(", ")}` : "nothing"}`;
        }
        if (wantRows) sql += " returning *";
        const result = await asRole(role, (tx) => tx.query(sql, params));
        return json(res, 201, wantRows ? result.rows : undefined);
      }

      if (req.method === "PATCH") {
        const body = await readJson(req);
        const cols = Object.keys(body);
        cols.forEach((c) => {
          if (!IDENT.test(c)) throw Object.assign(new Error(`bad column ${c}`), { code: "42703" });
        });
        const sets = cols.map((c) => {
          params.push(toParam(body[c]));
          return `"${c}" = $${params.length}`;
        });
        const where = parseFilters(url.searchParams, params);
        const sql = `update public."${table}" set ${sets.join(", ")}${where}${wantRows ? " returning *" : ""}`;
        const result = await asRole(role, (tx) => tx.query(sql, params));
        return json(res, 200, wantRows ? result.rows : undefined);
      }

      if (req.method === "DELETE") {
        const where = parseFilters(url.searchParams, params);
        const sql = `delete from public."${table}"${where}${wantRows ? " returning *" : ""}`;
        const result = await asRole(role, (tx) => tx.query(sql, params));
        return json(res, 200, wantRows ? result.rows : undefined);
      }

      return json(res, 405, { message: "method" });
    } catch (error) {
      if (!quiet) console.warn("[dev-db]", error.code || "", error.message);
      return pgError(res, error, roleFor(req));
    }
  });

  await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));
  const urlBase = `http://127.0.0.1:${port}`;
  if (!quiet) console.log(`[dev-db] PGlite Supabase stand-in on ${urlBase}`);
  return { db, server, url: urlBase, anonKey: keys.anon, serviceKey: keys.service, devToken: keys.dev };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dev = await startDevDb();
  console.log(`SUPABASE_URL=${dev.url}`);
  console.log(`SUPABASE_ANON_KEY=${dev.anonKey}`);
  console.log(`SUPABASE_SERVICE_ROLE_KEY=${dev.serviceKey}`);
  console.log(`DEV_DB_TOKEN=${dev.devToken}`);
}
