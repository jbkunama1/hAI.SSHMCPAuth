// auth/manage-aliases.mjs
// CLI for the SSH alias registry. Talks to the admin REST API (admin-server.js).
//
// Usage (Windows PowerShell example):
//   $env:SSHMCP_ADMIN_BASE = "http://localhost:8825"; $env:SSHMCP_ADMIN_PASSWORD = "..."
//   node auth\manage-aliases.mjs list
//   node auth\manage-aliases.mjs add ssh3 --host 10.0.0.13 --port 22 --username root --password "s3cret"
//   node auth\manage-aliases.mjs remove ssh3
//
// Commands: list | get <alias> | add <alias> | update <alias> | remove <alias>
//   add/update flags: --host <h> --port <p> --username <u> --password <p> --key-path <path>
//   update: omitted fields are kept; --password "" / --key-path "" clears that field.
//   passwords may also be supplied via SSHMCP_ADMIN_PASSWORD (env) or read from stdin.

import http from "node:http";
import crypto from "node:crypto";

// Password normalization - must match admin-server.js startAdminServer() so the
// X-Admin-Token equals the token the server expects.
function normalizePassword(p) {
  let s = String(p || "").trim();
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) s = s.slice(1, -1).trim();
  return s;
}

const BASE = process.env.SSHMCP_ADMIN_BASE || "http://localhost:8825";
const ADMIN_PASSWORD = normalizePassword(process.env.SSHMCP_ADMIN_PASSWORD || "");
const PORT_RE = /^[1-9][0-9]{0,4}$/;

function request(method, pathname, bodyObj) {
  const url = new URL(BASE + pathname);
  const body = bodyObj === undefined ? null : Buffer.from(JSON.stringify(bodyObj), "utf8");
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: url.hostname,
        port: url.port || (url.protocol === "https:" ? 443 : 80),
        path: url.pathname + url.search,
        method,
        headers: {
          "Content-Type": "application/json",
          "X-Admin-Token": tokenFor(ADMIN_PASSWORD),
          ...(body ? { "Content-Length": body.length } : {}),
        },
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          let json = null;
          try {
            json = JSON.parse(text);
          } catch {
            json = null;
          }
          resolve({ status: res.statusCode, json, text });
        });
      }
    );
    req.on("error", reject);
    if (body) req.end(body);
    else req.end();
  });
}

// Must match admin-server.js tokenFor().
function tokenFor(password) {
  return crypto
    .createHmac("sha256", String(password))
    .update("sshmcp-admin-session-v1")
    .digest("hex");
}

function parseFlags(argv) {
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    let key = null;
    let value = null;
    if (a === "--host") { key = "host"; value = argv[i + 1]; i++; }
    else if (a === "--port") { key = "port"; value = argv[i + 1]; i++; }
    else if (a === "--username" || a === "--user") { key = "username"; value = argv[i + 1]; i++; }
    else if (a === "--password") { key = "password"; value = argv[i + 1]; i++; }
    else if (a === "--key-path") { key = "key_path"; value = argv[i + 1]; i++; }
    if (key !== null) {
      if (value === undefined) {
        console.error(`Missing value for ${a}.`);
        process.exit(2);
      }
      flags[key] = value;
    }
  }
  return flags;
}

function table(rows) {
  const cols = new Set();
  for (const row of rows) for (const k of Object.keys(row)) cols.add(k);
  const keys = [...cols];
  const widths = {};
  for (const k of keys) widths[k] = Math.max(k.length, ...rows.map((r) => String(r[k] ?? "").length));
  const line = (cells) => "  " + cells.map((c, i) => String(c).padEnd(widths[keys[i]])).join("  ");
  return [line(keys), ...rows.map((r) => line(keys.map((k) => r[k] ?? "")))].join("\n");
}

async function readStdin() {
  return new Promise((resolve) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (c) => (data += c));
    process.stdin.on("end", () => resolve(data.trim()));
  });
}

async function main() {
  const [cmd, name, ...rest] = process.argv.slice(2);
  const flags = parseFlags(rest);

  if (!cmd) {
    console.log(
      "Usage: node manage-aliases.mjs list|get|add|update|remove\n" +
        "  add/update <alias> --host <h> [--port <p>] --username <u> (--password <p> | --key-path <path>)\n" +
        "  env: SSHMCP_ADMIN_BASE (default " + BASE + "), SSHMCP_ADMIN_PASSWORD"
    );
    return;
  }

  if (!ADMIN_PASSWORD && cmd !== "list" && cmd !== "get") {
    console.error("SSHMCP_ADMIN_PASSWORD is not set.");
    process.exit(2);
  }

  if (cmd === "list") {
    const { status, json } = await request("GET", "/api/aliases");
    if (status !== 200) {
      console.error(`list failed (${status}): ${JSON.stringify(json)}`);
      process.exit(1);
    }
    const rows = (json.aliases || []).map((a) => ({
      alias: a.alias,
      host: a.host,
      port: a.port,
      username: a.username,
      creds: a.hasPassword && a.hasKeyPath ? "pw+key" : a.hasPassword ? "pw" : a.hasKeyPath ? "key" : "-",
    }));
    console.log(rows.length ? table(rows) : "No aliases configured.");
    return;
  }

  if (!name) {
    console.error(`Command "${cmd}" requires an alias name.`);
    process.exit(2);
  }

  if (cmd === "get") {
    const { status, json } = await request("GET", `/api/aliases/${encodeURIComponent(name)}`);
    if (status !== 200) {
      console.error(`get failed (${status}): ${JSON.stringify(json)}`);
      process.exit(1);
    }
    console.log(table([json]));
    return;
  }

  if (cmd === "add" || cmd === "update") {
    const payload = { ...flags };
    if (payload.port !== undefined) {
      if (!PORT_RE.test(String(payload.port))) {
        console.error("Invalid --port.");
        process.exit(2);
      }
      payload.port = Number(payload.port);
    }
    if ((payload.password === undefined && payload.key_path === undefined) && cmd === "update") {
      // keep existing creds on partial update
    }
    if (payload.password === undefined && payload.key_path === undefined && cmd === "add") {
      payload.password = await readStdin(); // e.g. echo pass | node ...
    }
    const { status, json } = await request("PUT", `/api/aliases/${encodeURIComponent(name)}`, payload);
    if (status !== 200) {
      console.error(`${cmd} failed (${status}): ${JSON.stringify(json)}`);
      process.exit(1);
    }
    console.log(`OK: ${name} (${json.host}:${json.port}, user ${json.username})`);
    return;
  }

  if (cmd === "remove") {
    const { status, json } = await request("DELETE", `/api/aliases/${encodeURIComponent(name)}`);
    if (status !== 200) {
      console.error(`remove failed (${status}): ${JSON.stringify(json)}`);
      process.exit(1);
    }
    console.log(`OK: removed ${name}`);
    return;
  }

  console.error(`Unknown command: ${cmd}`);
  process.exit(2);
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});