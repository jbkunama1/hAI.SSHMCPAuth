// auth/auth-proxy.js
// HTTP auth proxy for ssh-mcp. Checks an API key, resolves SSH aliases, forwards to core.

const http = require("http");
const fs = require("fs");
const path = require("path");

const API_KEY = process.env.SSHMCP_API_KEY;
const TARGET_HOST = process.env.SSHMCP_TARGET_HOST || "sshmcp-core";
const TARGET_PORT = parseInt(process.env.SSHMCP_TARGET_PORT || "8000", 10);
const LISTEN_PORT = parseInt(process.env.SSHMCP_LISTEN_PORT || "8822", 10);
const ALIASES_FILE =
  process.env.SSHMCP_ALIASES_FILE ||
  path.join(__dirname, "data", "ssh_aliases.json");

if (!API_KEY) {
  console.error("SSHMCP_API_KEY is not set – exiting.");
  process.exit(1);
}

// --- Alias registry (plaintext for now; upgrade path: docker secrets + key_path) ---
let aliases = {};

function loadAliases() {
  try {
    aliases = JSON.parse(fs.readFileSync(ALIASES_FILE, "utf8"));
    console.log(`Loaded ${Object.keys(aliases).length} SSH aliases from ${ALIASES_FILE}`);
  } catch (err) {
    console.error(`Warning: cannot load aliases file ${ALIASES_FILE}: ${err.message}`);
    aliases = {};
  }
}

function resolveAlias(name) {
  if (typeof name !== "string") return null;
  return aliases[name] || null;
}

function aliasListText() {
  const entries = Object.keys(aliases)
    .sort()
    .map((key) => {
      const a = aliases[key];
      return {
        alias: key,
        host: a.host,
        port: a.port != null ? a.port : 22,
        username: a.username,
        usesKey: Boolean(a.key_path),
      };
    });
  return JSON.stringify({ aliases: entries }, null, 2);
}

// Inject stored host/port/credentials when ssh_connect is addressed by alias.
function applyAlias(msg) {
  let name;
  let args;
  if (msg.method === "tools/call" && msg.params && msg.params.arguments) {
    name = msg.params.name;
    args = msg.params.arguments;
  } else {
    name = msg.method;
    args = msg.params;
  }
  if (name !== "ssh_connect" || !args || typeof args !== "object") return;

  const alias = resolveAlias(args.address);
  if (!alias) return;

  args.address = `${alias.host}:${alias.port != null ? alias.port : 22}`;
  if (!args.username) args.username = alias.username;
  if (!args.password && !args.key_path) {
    if (alias.key_path) args.key_path = alias.key_path;
    else if (alias.password) args.password = alias.password;
  }
}

function aliasToolDefinition() {
  return {
    name: "ssh_list_aliases",
    description:
      "List all configured SSH aliases (alias, host, port, username). Never includes passwords or keys.",
  };
}

function isAliasListRequest(msg) {
  return (
    msg &&
    (msg.method === "ssh_list_aliases" ||
      (msg.method === "tools/call" &&
        msg.params &&
        msg.params.name === "ssh_list_aliases"))
  );
}

function respondDirect(msg, res) {
  const payload = {
    jsonrpc: "2.0",
    id: msg.id !== undefined ? msg.id : null,
    result: {
      content: [{ type: "text", text: aliasListText() }],
      isError: false,
    },
  };
  const body = Buffer.from(JSON.stringify(payload), "utf8");
  res.writeHead(200, {
    "Content-Type": "application/json",
    "Content-Length": body.length,
  });
  res.end(body);
}

// Append ssh_list_aliases to a tools/list response if it is missing.
function patchToolsList(raw) {
  try {
    const parsed = JSON.parse(raw);
    const messages = Array.isArray(parsed) ? parsed : [parsed];
    for (const m of messages) {
      const tools = m && m.result && Array.isArray(m.result.tools) ? m.result.tools : null;
      if (tools && !tools.some((t) => t && t.name === "ssh_list_aliases")) {
        tools.push(aliasToolDefinition());
      }
    }
    return JSON.stringify(parsed);
  } catch {
    return raw;
  }
}

function forward(req, res, modifiedBody, onResponse) {
  const headers = { ...req.headers };
  delete headers["content-length"];

  const proxyReq = http.request(
    {
      hostname: TARGET_HOST,
      port: TARGET_PORT,
      path: req.url,
      method: req.method,
      headers,
    },
    (proxyRes) => {
      if (onResponse) {
        const chunks = [];
        proxyRes.on("data", (c) => chunks.push(c));
        proxyRes.on("end", () => {
          const patched = onResponse(Buffer.concat(chunks).toString("utf8"));
          res.writeHead(proxyRes.statusCode || 500, proxyRes.headers);
          res.end(patched);
        });
      } else {
        res.writeHead(proxyRes.statusCode || 500, proxyRes.headers);
        proxyRes.pipe(res, { end: true });
      }
    }
  );

  proxyReq.on("error", (err) => {
    console.error("Error in proxy request:", err);
    res.writeHead(502, { "Content-Type": "text/plain" });
    res.end("Bad Gateway");
  });

  if (modifiedBody === undefined) {
    req.pipe(proxyReq, { end: true });
  } else {
    proxyReq.end(modifiedBody);
  }
}

loadAliases();

const server = http.createServer((req, res) => {
  const authHeader = req.headers["authorization"] || "";
  const expected = "Bearer " + API_KEY;

  if (authHeader !== expected) {
    res.writeHead(401, { "Content-Type": "text/plain" });
    res.end("Unauthorized");
    return;
  }

  if (req.method !== "POST") {
    forward(req, res);
    return;
  }

  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => {
    const rawBody = Buffer.concat(chunks).toString("utf8");
    let jsonBody = null;
    try {
      jsonBody = JSON.parse(rawBody);
    } catch {
      // Not JSON (SSE etc.) – forward untouched.
    }

    if (!jsonBody) {
      req.body = rawBody; // no-op placeholder; forward below uses original stream
      forward(req, res);
      return;
    }

    const messages = Array.isArray(jsonBody) ? jsonBody : [jsonBody];
    let interceptResponse = false;
    for (const m of messages) {
      if (!m || typeof m !== "object") continue;
      if (isAliasListRequest(m)) {
        respondDirect(m, res);
        return;
      }
      if (m.method === "tools/list") {
        interceptResponse = true;
      }
      applyAlias(m);
    }

    const newBody = Buffer.from(JSON.stringify(jsonBody), "utf8");
    forward(req, res, newBody, interceptResponse ? patchToolsList : undefined);
  });
});

server.listen(LISTEN_PORT, () => {
  console.log(
    `Auth proxy listening on port ${LISTEN_PORT}, forwarding to ${TARGET_HOST}:${TARGET_PORT}`
  );
});