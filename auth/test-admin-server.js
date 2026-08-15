// auth/test-admin-server.js
// Self-contained check for the admin server (password gate, CRUD, alias limit)
// and the CLI (manage-aliases.mjs) talking to the same REST API.
// Run: node auth\test-admin-server.js

const assert = require("node:assert");
const http = require("node:http");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

const { startAdminServer, tokenFor } = require("./admin-server.js");

function runCli(args, env) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(__dirname, "manage-aliases.mjs"), ...args], {
      encoding: "utf8",
      env,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("close", (code) => resolve({ status: code, stdout, stderr }));
  });
}

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sshmcp-admin-test-"));
const aliasesFile = path.join(tmpDir, "aliases.json");
const port = 18925;
const password = "test-pw";
const base = `http://127.0.0.1:${port}`;

function req(method, p, token, body, p2) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : Buffer.from(JSON.stringify(body), "utf8");
    const r = http.request(
      {
        hostname: "127.0.0.1",
        port: p2 || port,
        path: p,
        method,
        headers: {
          ...(token ? { "X-Admin-Token": token } : {}),
          ...(payload ? { "Content-Type": "application/json", "Content-Length": payload.length } : {}),
        },
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          let json = null;
          try { json = JSON.parse(text); } catch { json = null; }
                  resolve({ status: res.statusCode, json, text, headers: res.headers });
        });
      }
    );
    r.on("error", reject);
    payload ? r.end(payload) : r.end();
  });
}

const token = tokenFor(password);
let server;

(async () => {
  server = startAdminServer({ port, password, aliasesFile });
  await new Promise((r) => setTimeout(r, 300));

  // 1. unauthenticated requests are rejected
  assert.strictEqual((await req("GET", "/api/aliases")).status, 401, "no-token -> 401");
  assert.strictEqual((await req("GET", "/api/aliases", "wrong-token")).status, 401, "wrong-token -> 401");
  console.log("PASS - admin requires token");

  // 2. bad password login -> 401
  const badLogin = await req("POST", "/login", null, { password: "nope" });
  assert.strictEqual(badLogin.status, 401, "bad login -> 401");
  console.log("PASS - bad login rejected");

    // 2b. UI reachable, HTML served
    const ui = await req("GET", "/");
    assert.strictEqual(ui.status, 200, "GET / ok");
    assert.match(ui.headers && ui.headers["content-type"] || "", /text\/html/, "serves HTML");
    assert.ok(ui.text && ui.text.includes("SSH Alias Registry"), "UI title present");
    console.log("PASS - UI reachable (HTML)");

    // 2c. good login sets a cookie
        const goodLogin = await req("POST", "/login", null, { password });
        assert.strictEqual(goodLogin.status, 200, "good login 200");
        assert.ok(
          (goodLogin.headers && JSON.stringify(goodLogin.headers["set-cookie"] || "")).includes("sshmcp_admin"),
          "cookie set"
        );
        console.log("PASS - login sets cookie");

  // 3. create
  let r = await req("PUT", "/api/aliases/ssh1", token, { host: "10.0.0.11", port: 22, username: "root", password: "s3cret" });
  assert.strictEqual(r.status, 200, "create ssh1");
  r = await req("GET", "/api/aliases", token);
  assert.strictEqual(r.status, 200, "list ok");
  assert.strictEqual(r.json.aliases.length, 1, "one alias");
  assert.strictEqual(r.json.aliases[0].alias, "ssh1");
  assert.strictEqual(r.json.aliases[0].hasPassword, true);
  assert.ok(!JSON.stringify(r.json).includes("s3cret"), "no secret in list");
  console.log("PASS - create + list (no secrets exposed)");

  // 4. update without password keeps existing creds?
  r = await req("PUT", "/api/aliases/ssh1", token, { host: "10.0.0.99" });
  assert.strictEqual(r.status, 200, "partial update");
  assert.strictEqual(r.json.host, "10.0.0.99", "host updated");
  assert.strictEqual(r.json.hasPassword, true, "password kept");
  console.log("PASS - partial update keeps creds");

  // 5. invalid: missing host/username/creds
  r = await req("PUT", "/api/aliases/bad1", token, { host: "", username: "x", password: "x" });
  assert.strictEqual(r.status, 400, "missing host -> 400");
  r = await req("PUT", "/api/aliases/bad2", token, { host: "h", username: "u" });
  assert.strictEqual(r.status, 400, "no creds -> 400");
  console.log("PASS - validation rejects bad entries");

  // 6. limit of 20
  for (let i = 2; i <= 20; i++) {
    r = await req("PUT", `/api/aliases/ssh${i}`, token, { host: "10.0.0.1", username: "u", password: "p" });
    assert.strictEqual(r.status, 200, `create ssh${i}`);
  }
  r = await req("PUT", "/api/aliases/ssh21", token, { host: "10.0.0.1", username: "u", password: "p" });
  assert.strictEqual(r.status, 400, "21st alias rejected");
  assert.ok(/maximum/.test(r.json.error || ""), "limit message");
  console.log("PASS - 20 alias limit enforced");

    // Free one slot for the CLI test
    r = await req("DELETE", "/api/aliases/ssh20", token);
    assert.strictEqual(r.status, 200, "delete ssh20 ok");

    // 7. CLI list + add + remove end-to-end
  const env = { ...process.env, SSHMCP_ADMIN_BASE: base, SSHMCP_ADMIN_PASSWORD: password };
    let out = await runCli(["list"], env);
    assert.strictEqual(out.status, 0, "cli list ok");
    assert.ok(out.stdout.includes("ssh1"), "cli list shows ssh1");

    out = await runCli(["add", "clinox", "--host", "10.1.1.1", "--username", "daniel", "--password", "pw1"], env);
    assert.strictEqual(out.status, 0, `cli add ok: ${out.stderr}${out.stdout}`);
    assert.ok(out.stdout.includes("clinox"), "cli add echoes name");

    out = await runCli(["remove", "clinox"], env);
    assert.strictEqual(out.status, 0, "cli remove ok");
    out = await runCli(["list"], env);
    assert.ok(!out.stdout.includes("clinox"), "removed via cli");
    console.log("PASS - CLI end-to-end (list/add/remove)");

      // 8. env password normalization: trailing whitespace / wrapping quotes in the
      //    env value (common in Portainer) must still authenticate.
      const messyPw = '  "test-pw"  ';
      const p2 = 18926;
      const server2 = startAdminServer({ port: p2, password: messyPw, aliasesFile });
      await new Promise((r) => setTimeout(r, 300));
      const login2 = await req("POST", "/login", null, { password }, p2);
      assert.strictEqual(login2.status, 200, "login with trimmed env password ok");
      const login3 = await req("POST", "/login", null, { password: "test-pw " }, p2);
      assert.strictEqual(login3.status, 200, "login with trailing space in input ok");
      const badLogin2 = await req("POST", "/login", null, { password: "nope" }, p2);
      assert.strictEqual(badLogin2.status, 401, "bad login still rejected");
      const cli = await runCli(["list"], { ...process.env, SSHMCP_ADMIN_BASE: `http://127.0.0.1:${p2}`, SSHMCP_ADMIN_PASSWORD: messyPw });
      assert.strictEqual(cli.status, 0, `cli token matches trimmed env pw: ${cli.stderr}${cli.stdout}`);
      server2.close();
      console.log("PASS - env password normalization (quotes + whitespace)");

      // 9. delete via API
      r = await req("DELETE", "/api/aliases/ssh1", token);
      assert.strictEqual(r.status, 200, "delete ok");

      // 10. onReload hook fired (file content matches in-memory reload)
  const onDisk = JSON.parse(fs.readFileSync(aliasesFile, "utf8"));
  assert.ok(!onDisk.ssh1, "deleted alias absent on disk");

  console.log("ALL ADMIN TESTS PASSED");
  server.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
  process.exit(0);
})().catch((err) => {
  console.error("FAIL:", err.message);
  if (server) server.close();
  process.exit(1);
});