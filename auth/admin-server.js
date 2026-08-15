// auth/admin-server.js
// Password-protected admin server for the SSH alias registry.
// Serves a small web UI plus a REST API on the admin port (default 8825).
// The CLI (auth/manage-aliases.mjs) talks to the same REST API.
// Auth: a single password. Login sets an HttpOnly cookie; the API also
// accepts "X-Admin-Token: <hmac>" (used by the CLI). Both tokens are an
// HMAC-SHA256 of the password - possession of the token == admin access.

const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const MAX_ALIASES = 20;
const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$/;

function tokenFor(password) {
  return crypto
    .createHmac("sha256", String(password))
    .update("sshmcp-admin-session-v1")
    .digest("hex");
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return {};
  }
}

// Atomic write: write a temp file, then rename over the target.
function writeJson(file, data) {
  const tmp = file + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + "\n", "utf8");
  fs.renameSync(tmp, file);
}

function publicView(aliases) {
  return Object.keys(aliases)
    .sort()
    .map((name) => {
      const a = aliases[name];
      return {
        alias: name,
        host: a.host,
        port: a.port != null ? a.port : 22,
        username: a.username,
        hasPassword: Boolean(a.password),
        hasKeyPath: Boolean(a.key_path),
      };
    });
}

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq > 0) out[part.slice(0, eq).trim()] = part.slice(eq + 1).trim();
  }
  return out;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > 1024 * 1024) {
        reject(new Error("body too large"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function send(res, status, type, body) {
  const buf = Buffer.from(body, "utf8");
  res.writeHead(status, {
    "Content-Type": type,
    "Content-Length": buf.length,
  });
  res.end(buf);
}

function sendJson(res, status, obj, extraHeaders) {
  const buf = Buffer.from(JSON.stringify(obj, null, 2), "utf8");
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": buf.length,
    ...(extraHeaders || {}),
  });
  res.end(buf);
}

// Validate one entry for create (existing == null) or update.
// Returns { error } or { entry }.
function validateEntry(name, body, existing) {
  if (!NAME_RE.test(name)) {
    return { error: "invalid alias name (a-z0-9, _ , - , max 32 chars)" };
  }
  if (body.host !== undefined && (typeof body.host !== "string" || !body.host.trim())) {
    return { error: "host must be a non-empty string" };
  }
  if (body.username !== undefined && (typeof body.username !== "string" || !body.username.trim())) {
    return { error: "username must be a non-empty string" };
  }
  if (body.port !== undefined) {
    const port = Number(body.port);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      return { error: "port must be an integer between 1 and 65535" };
    }
  }
  if (body.password !== undefined && typeof body.password !== "string") {
    return { error: "password must be a string" };
  }
  if (body.key_path !== undefined && typeof body.key_path !== "string") {
    return { error: "key_path must be a string" };
  }

  const entry = existing
    ? {
        host: existing.host,
        port: existing.port,
        username: existing.username,
        password: existing.password,
        key_path: existing.key_path,
      }
    : {};

  if (body.host !== undefined) entry.host = body.host.trim();
  if (body.username !== undefined) entry.username = body.username.trim();
  if (body.port !== undefined) entry.port = Number(body.port);
  if (body.password !== undefined) entry.password = body.password === "" ? undefined : body.password;
  if (body.key_path !== undefined) entry.key_path = body.key_path === "" ? undefined : body.key_path;

  if (!entry.host || !entry.username || (!entry.password && !entry.key_path)) {
    return { error: "host, username and (password or key_path) are required" };
  }
  return { entry };
}

const UI_HTML = `<!DOCTYPE html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>SSH Alias Registry</title>
<style>
  :root { color-scheme: dark; }
  body { font-family: system-ui, sans-serif; background: #111; color: #eee; margin: 0; padding: 24px; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  .sub { color: #888; font-size: 13px; margin-bottom: 20px; }
  table { border-collapse: collapse; width: 100%; max-width: 860px; background: #1a1a1a; }
  th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid #2a2a2a; font-size: 14px; }
  th { color: #aaa; font-weight: 600; }
  .mono { font-family: ui-monospace, monospace; }
  button { background: #2d6cdf; color: #fff; border: 0; border-radius: 6px; padding: 7px 12px; cursor: pointer; font-size: 13px; }
  button.ghost { background: transparent; color: #ccc; border: 1px solid #444; }
  button.danger { background: #b23b3b; }
  form { max-width: 860px; background: #1a1a1a; padding: 16px; border-radius: 8px; }
  label { display: block; color: #aaa; font-size: 12px; margin: 10px 2px 4px; }
  input { width: 100%; box-sizing: border-box; background: #222; color: #eee; border: 1px solid #3a3a3a; border-radius: 6px; padding: 8px; font-size: 14px; }
  .row { display: flex; gap: 10px; }
  .row > div { flex: 1; }
  .row > div.w1 { flex: 0 0 220px; }
  .msg { background: #22331f; border: 1px solid #3e6b35; padding: 10px 12px; border-radius: 6px; margin-bottom: 14px; }
  .err { background: #3d1f1f; border-color: #8a3b3b; }
  .login { max-width: 340px; margin: 80px auto; }
  .badge { font-size: 11px; padding: 2px 7px; border-radius: 10px; background: #2a2a2a; color: #aaa; }
  .badge.key { background: #3b3b7a; color: #c3c3ff; }
</style>
</head>
<body>
<div id="app"></div>
<script>
var APP = (function () {
  var app = document.getElementById("app");

  function loginScreen() {
    app.innerHTML =
      '<form class="login">' +
      "<h1>SSH Alias Registry</h1>" +
      '<p class="sub">Admin-Zugang – Passwort eingeben.</p>' +
      '<label for="pw">Passwort</label>' +
      '<input type="password" id="pw" autofocus>' +
      '<p style="margin-top:16px"><button type="submit">Anmelden</button></p>' +
      '<p class="err" id="loginErr" style="display:none">Falsches Passwort.</p>' +
      "</form>";
    app.querySelector("form").onsubmit = function (ev) {
      ev.preventDefault();
      var pw = document.getElementById("pw").value;
      fetch("/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: pw }),
      }).then(function (r) {
        if (r.ok) load();
        else document.getElementById("loginErr").style.display = "block";
      });
    };
  }

  function esc(s) {
    var d = document.createElement("div");
    d.textContent = s == null ? "" : String(s);
    return d.innerHTML;
  }

  function rowHtml(a) {
    return (
      "<tr>" +
      '<td class="mono">' + esc(a.alias) + "</td>" +
      "<td>" + esc(a.host) + ":" + esc(a.port) + "</td>" +
      "<td>" + esc(a.username) + "</td>" +
      "<td>" + (a.hasPassword ? '<span class="badge">pw</span> ' : "") + (a.hasKeyPath ? '<span class="badge key">key</span>' : "") + "</td>" +
      "<td>" +
      '<button class="ghost" data-edit="' + esc(a.alias) + '">Bearbeiten</button> ' +
      '<button class="danger" data-del="' + esc(a.alias) + '">Löschen</button>' +
      "</td>" +
      "</tr>"
    );
  }

  function showForm(alias) {
    var isEdit = !!alias;
    app.innerHTML =
      (alias ? "<p><button class='ghost' id='back'>← Zurück</button></p>" : "") +
      "<form id='entryForm'>" +
      "<h1>" + (isEdit ? "Alias bearbeiten: " + esc(alias) : "Neuer Alias") + "</h1>" +
      '<div class="row">' +
      '<div><label for="fName">Alias</label><input id="fName" class="mono" placeholder="ssh3"' + (isEdit ? " disabled" : "") + "></div>" +
      '<div class="w1"><label for="fHost">Host</label><input id="fHost" placeholder="10.0.0.13"></div>' +
      '<div><label for="fPort">Port</label><input id="fPort" type="number" value="22" min="1" max="65535"></div>' +
      '<div><label for="fUser">Username</label><input id="fUser" placeholder="root"></div>' +
      "</div>" +
      '<div class="row">' +
      '<div><label for="fPass">Passwort (leer lassen = behalten)</label><input id="fPass" type="password" autocomplete="new-password"></div>' +
      '<div><label for="fKey">Key-Pfad (optional, ersetzt Passwort)</label><input id="fKey" class="mono" placeholder="/keys/id_ed25519"></div>' +
      "</div>" +
      '<p style="margin-top:16px"><button type="submit">Speichern</button></p>' +
      "<p class='err' id='formErr' style='display:none'></p>" +
      "</form>";

    if (isEdit) {
      document.getElementById("back").onclick = load;
      fetch("/api/aliases/" + encodeURIComponent(alias)).then(function (r) {
        r.json().then(function (a) {
          document.getElementById("fHost").value = a.host || "";
          document.getElementById("fPort").value = a.port || 22;
          document.getElementById("fUser").value = a.username || "";
        });
      });
    }

    document.getElementById("entryForm").onsubmit = function (ev) {
      ev.preventDefault();
      var payload = {
        host: document.getElementById("fHost").value,
        port: document.getElementById("fPort").value,
        username: document.getElementById("fUser").value,
      };
      var pw = document.getElementById("fPass").value;
      var key = document.getElementById("fKey").value;
      if (pw !== "") payload.password = pw;
      if (key !== "") payload.key_path = key;
      var name = isEdit ? alias : document.getElementById("fName").value.trim();
      fetch("/api/aliases/" + encodeURIComponent(name), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }).then(function (r) {
        if (r.ok) load();
        else
                r.text().then(function (t) {
                  var msg = "Fehler " + r.status;
                  try { msg = JSON.parse(t).error || msg; } catch (e) {}
                  var el = document.getElementById("formErr");
                  el.textContent = msg;
                  el.style.display = "block";
                });
            }).catch(function (err) {
              var el = document.getElementById("formErr");
              el.textContent = "Netzwerkfehler: " + err.message;
              el.style.display = "block";
            });
    };
  }

  function load() {
    fetch("/api/aliases").then(function (r) {
      if (r.status === 401) return loginScreen();
      r.json().then(function (data) {
        var items = data.aliases || [];
        var html =
          "<h1>SSH Alias Registry</h1>" +
          '<p class="sub">Maximal ' + 20 + ' Einträge – verwaltet über Admin-Port. Zugangsdaten bleiben lokal (Datei ' + "data/ssh_aliases.json" + ").</p>";
        html += '<p><button id="addBtn">+ Neuer Alias</button></p>';
        if (!items.length) html += "<p style='color:#888'>Noch keine Aliase hinterlegt.</p>";
        else {
          html += "<table><tr><th>Alias</th><th>Adresse</th><th>User</th><th>Creds</th><th></th></tr>";
          items.forEach(function (a) { html += rowHtml(a); });
          html += "</table>";
        }
        app.innerHTML = html;
        var addBtn = document.getElementById("addBtn");
        if (addBtn) addBtn.onclick = function () { showForm(null); };
        app.querySelectorAll("[data-edit]").forEach(function (b) {
          b.onclick = function () { showForm(b.getAttribute("data-edit")); };
        });
        app.querySelectorAll("[data-del]").forEach(function (b) {
          b.onclick = function () {
            if (!window.confirm("Alias '" + b.getAttribute("data-del") + "' löschen?")) return;
            fetch("/api/aliases/" + encodeURIComponent(b.getAttribute("data-del")), { method: "DELETE" }).then(function (r) {
              if (r.ok) load();
            });
          };
        });
      });
    });
  }

  return { login: loginScreen, load: load };
})();

APP.load();
</script>
</body>
</html>
`;

function startAdminServer({ port, password, aliasesFile, onReload }) {
  // Trim: env values from Portainer often carry trailing whitespace/newlines,
    // or literal wrapping quotes when a YAML value was pasted into the field.
    let p = String(password || "").trim();
    if ((p.startsWith('"') && p.endsWith('"')) || (p.startsWith("'") && p.endsWith("'"))) {
      p = p.slice(1, -1).trim();
    }
    password = p;
    if (!password) {
    console.warn("SSHMCP_ADMIN_PASSWORD is not set - admin server disabled.");
    return null;
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");
    const cookies = parseCookies(req.headers.cookie);
    const token = cookies.sshmcp_admin || req.headers["x-admin-token"];
    const authed = token === tokenFor(password);

    // Web UI
    if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
      return send(res, 200, "text/html", authed ? UI_HTML : UI_HTML);
    }

    // Login (no auth required)
    if (req.method === "POST" && url.pathname === "/login") {
      let bodyErr = null;
      let ok = false;
      try {
        const body = JSON.parse(await readBody(req));
        ok = String(body.password).trim() === password;
      } catch (err) {
        bodyErr = err.message;
      }
            if (bodyErr || !ok) {
              return sendJson(res, 401, { error: bodyErr || "invalid password" });
            }
            return sendJson(res, 200, { ok: true }, {
              "Set-Cookie": `sshmcp_admin=${tokenFor(password)}; HttpOnly; SameSite=Lax; Path=/`,
            });
    }

    if (!authed) {
      return sendJson(res, 401, { error: "unauthorized" });
    }

    const base = "/api/aliases";
    const aliasMatch = url.pathname.match(/^\/api\/aliases\/([^/]+)$/);

    if (req.method === "GET" && url.pathname === base) {
      return sendJson(res, 200, { aliases: publicView(readJson(aliasesFile)) });
    }

    if (req.method === "GET" && aliasMatch) {
      const name = decodeURIComponent(aliasMatch[1]);
      const aliases = readJson(aliasesFile);
      if (!aliases[name]) return sendJson(res, 404, { error: "alias not found" });
      return sendJson(res, 200, { alias: name, ...publicView(aliases).find((x) => x.alias === name) });
    }

    if (req.method === "PUT" && aliasMatch) {
      const name = decodeURIComponent(aliasMatch[1]);
      let body;
      try {
        body = JSON.parse(await readBody(req));
      } catch (err) {
        return sendJson(res, 400, { error: "invalid JSON: " + err.message });
      }
      const aliases = readJson(aliasesFile);
      const existing = aliases[name] || null;
      const result = validateEntry(name, body, existing);
      if (result.error) return sendJson(res, 400, { error: result.error });
      if (!existing && Object.keys(aliases).length >= MAX_ALIASES) {
        return sendJson(res, 400, { error: `maximum of ${MAX_ALIASES} aliases reached` });
      }
      aliases[name] = result.entry;
      writeJson(aliasesFile, aliases);
      if (onReload) onReload();
      return sendJson(res, 200, { ok: true, ...publicView(aliases).find((x) => x.alias === name) });
    }

    if (req.method === "DELETE" && aliasMatch) {
      const name = decodeURIComponent(aliasMatch[1]);
      const aliases = readJson(aliasesFile);
      if (!aliases[name]) return sendJson(res, 404, { error: "alias not found" });
      delete aliases[name];
      writeJson(aliasesFile, aliases);
      if (onReload) onReload();
      return sendJson(res, 200, { ok: true });
    }

    return sendJson(res, 404, { error: "not found" });
  });

  server.listen(port, () => {
    console.log(`Admin server (alias registry) listening on port ${port}`);
  });

  return server;
}

module.exports = { startAdminServer, tokenFor };

// Allow running standalone: node auth/admin-server.js
if (require.main === module) {
  const PORT = parseInt(process.env.SSHMCP_ADMIN_PORT || "8825", 10);
  const FILE = process.env.SSHMCP_ALIASES_FILE || path.join(__dirname, "data", "ssh_aliases.json");
  startAdminServer({ port: PORT, password: process.env.SSHMCP_ADMIN_PASSWORD || "", aliasesFile: FILE });
}