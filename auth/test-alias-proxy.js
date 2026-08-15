// Test for ssh alias resolution + ssh_list_aliases in the auth proxy.
// Spins up a mock upstream core, starts the proxy with test env, asserts behavior.
const { spawn } = require("child_process");
const http = require("http");
const os = require("os");
const path = require("path");
const fs = require("fs");

const API_KEY = "test-key-123";
const PROXY_PORT = 18822;
const MOCK_PORT = 18000;

// --- mock upstream core ---
const mock = http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    const msg = JSON.parse(body);
    if (msg.method === "tools/list") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          jsonrpc: "2.0",
          id: msg.id,
          result: { tools: [{ name: "ssh_connect" }] },
        })
      );
      return;
    }
    // echo back the ssh_connect arguments so we can assert rewriting
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        jsonrpc: "2.0",
        id: msg.id,
        result: { content: [{ type: "text", text: "args:" + JSON.stringify(msg.params.arguments) }] },
      })
    );
  });
});

// --- helpers ---
function post(payload) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(payload);
    const req = http.request(
      {
        host: "127.0.0.1",
        port: PROXY_PORT,
        path: "/mcp",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(data),
          Authorization: "Bearer " + API_KEY,
        },
      },
      (res) => {
        let b = "";
        res.on("data", (c) => (b += c));
        res.on("end", () => resolve({ status: res.statusCode, body: JSON.parse(b) }));
      }
    );
    req.on("error", reject);
    req.end(data);
  });
}

async function main() {
  const tmpdir = fs.mkdtempSync(path.join(os.tmpdir(), "aliastest-"));
  const aliasesFile = path.join(tmpdir, "ssh_aliases.json");
  fs.writeFileSync(
    aliasesFile,
    JSON.stringify({
      ssh1: { host: "10.9.9.9", port: 2222, username: "alice", password: "s3cret" },
      ssh2: { host: "10.1.1.1", port: 22, username: "bob", key_path: "/keys/bob" },
    })
  );

  await new Promise((r) => mock.listen(MOCK_PORT, r));

  const proxy = spawn(process.execPath, [path.resolve("auth/auth-proxy.js")], {
    env: {
      ...process.env,
      SSHMCP_API_KEY: '  "test-key-123"  ', // messy env (quotes + whitespace) must be normalized
      SSHMCP_TARGET_HOST: "127.0.0.1",
      SSHMCP_TARGET_PORT: String(MOCK_PORT),
      SSHMCP_LISTEN_PORT: String(PROXY_PORT),
      SSHMCP_ALIASES_FILE: aliasesFile,
    },
    stdio: "pipe",
  });
  proxy.stderr.on("data", (d) => process.stderr.write(d));
  await new Promise((r) => setTimeout(r, 700));

  const results = [];
  const check = (name, cond, extra) => {
    results.push({ name, ok: !!cond, extra });
    console.log(`${cond ? "PASS" : "FAIL"} - ${name}${extra ? " :: " + extra : ""}`);
  };

  // 1. tools/call ssh_connect with alias -> rewritten address + merged creds
  const r1 = await post({
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: { name: "ssh_connect", arguments: { address: "ssh1" } },
  });
  const text1 = r1.body.result.content[0].text;
  check(
    "ssh_connect alias resolves host:port + creds",
    /"address":"10\.9\.9\.9:2222"/.test(text1) &&
      /"username":"alice"/.test(text1) &&
      /"password":"s3cret"/.test(text1),
    text1
  );

  // 2. tools/call ssh_connect with explicit args keeps them, but resolves address
  const r2 = await post({
    jsonrpc: "2.0",
    id: 2,
    method: "tools/call",
    params: { name: "ssh_connect", arguments: { address: "ssh2", username: "override" } },
  });
  const text2 = r2.body.result.content[0].text;
  check(
    "explicit username wins, key_path injected",
    /"address":"10\.1\.1\.1:22"/.test(text2) &&
      /"username":"override"/.test(text2) &&
      /"key_path":"\/keys\/bob"/.test(text2),
    text2
  );

  // 3. tools/call ssh_list_aliases -> intercepted locally, no password leaked
  const r3 = await post({
    jsonrpc: "2.0",
    id: 3,
    method: "tools/call",
    params: { name: "ssh_list_aliases", arguments: {} },
  });
  const text3 = r3.body.result.content[0].text;
  check(
    "ssh_list_aliases returns aliases without secrets",
      /"ssh1"/.test(text3) &&
        /"username":\s*"alice"/.test(text3) &&
        !/s3cret/.test(text3) &&
        !/"password"/.test(text3),
      text3
    );

  // 4. tools/list gets ssh_list_aliases appended
  const r4 = await post({ jsonrpc: "2.0", id: 4, method: "tools/list" });
  const names = r4.body.result.tools.map((t) => t.name);
  check("tools/list includes ssh_list_aliases", names.includes("ssh_list_aliases"), names.join(","));

  // 5. bad auth -> 401
  const r5 = await new Promise((resolve, reject) => {
    const data = JSON.stringify({ jsonrpc: "2.0", id: 5, method: "tools/list" });
    const req = http.request(
      {
        host: "127.0.0.1",
        port: PROXY_PORT,
        path: "/mcp",
        method: "POST",
        headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data), Authorization: "Bearer wrong" },
      },
      (res) => {
        let b = "";
        res.on("data", (c) => (b += c));
        res.on("end", () => resolve({ status: res.statusCode }));
      }
    );
    req.end(data);
  });
  check("bad api key -> 401", r5.status === 401, "status=" + r5.status);

  // 6. tolerant auth: lowercase "bearer" scheme still authorizes
  const r6 = await new Promise((resolve, reject) => {
    const data = JSON.stringify({ jsonrpc: "2.0", id: 6, method: "tools/list" });
    const req = http.request(
      {
        host: "127.0.0.1",
        port: PROXY_PORT,
        path: "/mcp",
        method: "POST",
        headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data), Authorization: "bearer " + API_KEY },
      },
      (res) => {
        let b = "";
        res.on("data", (c) => (b += c));
        res.on("end", () => resolve({ status: res.statusCode }));
      }
    );
    req.end(data);
  });
  check("lowercase bearer + messy env key -> 200", r6.status === 200, "status=" + r6.status);

  proxy.kill();
  mock.close();
  fs.rmSync(tmpdir, { recursive: true, force: true });

  const failed = results.filter((r) => !r.ok).length;
  if (failed) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});