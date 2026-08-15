// auth/auth-proxy.js
// Lightweight HTTP auth proxy for ssh-mcp. Checks an API key before proxying.

const http = require("http");

const API_KEY = process.env.SSHMCP_API_KEY;
const TARGET_HOST = process.env.SSHMCP_TARGET_HOST || "sshmcp-core";
const TARGET_PORT = parseInt(process.env.SSHMCP_TARGET_PORT || "8000", 10);
const LISTEN_PORT = parseInt(process.env.SSHMCP_LISTEN_PORT || "8822", 10);

if (!API_KEY) {
  console.error("SSHMCP_API_KEY is not set – exiting.");
  process.exit(1);
}

const server = http.createServer((req, res) => {
  const authHeader = req.headers["authorization"] || "";
  const expected = `Bearer ${API_KEY}`;

  if (authHeader !== expected) {
    res.writeHead(401, { "Content-Type": "text/plain" });
    res.end("Unauthorized");
    return;
  }

  const options = {
    hostname: TARGET_HOST,
    port: TARGET_PORT,
    path: req.url,
    method: req.method,
    headers: req.headers,
  };

  const proxyReq = http.request(options, (proxyRes) => {
    res.writeHead(proxyRes.statusCode || 500, proxyRes.headers);
    proxyRes.pipe(res, { end: true });
  });

  proxyReq.on("error", (err) => {
    console.error("Error in proxy request:", err);
    res.writeHead(502, { "Content-Type": "text/plain" });
    res.end("Bad Gateway");
  });

  req.pipe(proxyReq, { end: true });
});

server.listen(LISTEN_PORT, () => {
  console.log(
    `Auth proxy listening on port ${LISTEN_PORT}, forwarding to ${TARGET_HOST}:${TARGET_PORT}`
  );
});
