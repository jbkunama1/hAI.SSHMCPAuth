# hAI.SSHMCPAuth

Auth-layered MCP SSH gateway for secure agent access into your LAN.

This repo provides:

- A Portainer-ready Docker Compose stack with:
  - `sshmcp-core`: the original `mingyang91/ssh-mcp` MCP SSH server
  - `sshmcp-auth`: a lightweight Node.js HTTP proxy that enforces an API key before forwarding to `sshmcp-core`
- A small `auth-proxy.js` implementation that checks `Authorization: Bearer <API_KEY>` and only then proxies the request to the MCP server
- A Docker image for the auth proxy, built and published via GitHub Actions to GitHub Container Registry (`ghcr.io/<owner>/hai.sshmcpauth:latest`)

The goal: allow AI agents (Claude, ChatGPT, Copilot, AnythingMCP, etc.) to reach your LAN via MCP+SSH, while enforcing an application-level API key directly in the container stack.

> NOTE: This is a simple, educational example. For production, combine this pattern with proper network isolation (VPN, firewalls) and SSH key authentication.

## Architecture

Overview:

- Incoming HTTP/MCP traffic hits `sshmcp-auth` on port `8822` (or another port you choose)
- `sshmcp-auth` verifies that the `Authorization` header matches your configured API key
- If valid, the request is forwarded to `sshmcp-core` on its internal port `8000`
- `sshmcp-core` runs `mingyang91/ssh-mcp` and handles MCP/SSH tool calls into your LAN machines

All components run inside one Docker stack; no external reverse proxy is required.

## Requirements

- Host system with Docker and Docker Compose (or Portainer)
- A custom Docker network (e.g. `highfishNetwork`) if you want to integrate with other containers
- Node.js image is pulled automatically as part of the stack (`node:18-alpine`)

## Files

- `docker-compose.yml` — the stack definition
- `auth/auth-proxy.js` — Node.js HTTP auth/proxy layer
- `Dockerfile` — container definition for the auth proxy
- `.github/workflows/docker-image.yml` — GitHub Actions workflow to build/push the image

## Installation (Stack-Variante)

### 1. Clone the repo

```bash
git clone https://github.com/jbkunama1/hAI.SSHMCPAuth.git
cd hAI.SSHMCPAuth
```

### 2. Prepare host directories

Create a host directory for SSHMCP data and the auth script. You can change paths if needed.

```bash
mkdir -p /home/sshmcp/auth
cp auth/auth-proxy.js /home/sshmcp/auth/
```

By default, the compose file mounts `/home/sshmcp` into `sshmcp-core` as `/data` and `/home/sshmcp/auth` into `sshmcp-auth` as `/auth`.

### 3. Set your API key

Generate a strong random API key and keep it secret:

```bash
openssl rand -hex 32
# copy the output
```

Open `docker-compose.yml` and set:

```yaml
environment:
  SSHMCP_API_KEY: "DEIN_STARKER_API_KEY"
```

Replace `DEIN_STARKER_API_KEY` with your generated value.

### 4. Adjust network and ports (optional)

In `docker-compose.yml`, you can:

- Change the external port mapping from `8822:8822` to another port
- Change the external network name from `highfishNetwork` to your own network

Example:

```yaml
services:
  sshmcp-auth:
    ports:
      - "8822:8822"

networks:
  highfishNetwork:
    external: true
```

If you do not have an external network yet, create one:

```bash
docker network create highfishNetwork
```

### 5. Start the stack

Using Docker Compose:

```bash
docker compose up -d
```

Using Portainer:

- Go to *Stacks*
- Create new stack
- Paste the contents of `docker-compose.yml`
- Deploy the stack

### 6. Configure your MCP client (e.g. AnythingMCP)

Point your MCP client or gateway at the auth layer, and send the API key as a header.

Example configuration snippet:

```json
{
  "mcpServers": {
    "ssh-lan": {
      "name": "SSH MCP LAN",
      "type": "streamable",
      "url": "http://192.168.178.10:8822/mcp",
      "enabled": true,
      "headers": {
        "Authorization": "Bearer DEIN_STARKER_API_KEY"
      }
    }
  }
}
```

### 7. Use MCP tools from your agent

Once connected, your agent can call the MCP tools exposed by `ssh-mcp`, such as:

- `ssh_connect` — establish SSH connection to a LAN host
- `ssh_execute` — run commands on the remote host
- `ssh_upload` / `ssh_download` — transfer files

Refer to the upstream `ssh-mcp` documentation for the exact tool names and parameters.

## Docker-Image-Variante (GitHub Actions)

Statt den Auth-Layer aus `node:18-alpine` + Volume aufzubauen, kannst du das vorbereitete Docker-Image nutzen.

### 1. GitHub Actions Workflow

Der Workflow `.github/workflows/docker-image.yml`:

- läuft bei Push auf `main` oder manuellem Trigger
- baut das Image aus `Dockerfile`
- pusht es nach GitHub Container Registry unter:
  - `ghcr.io/<owner>/hai.sshmcpauth:latest`

### 2. Image lokal nutzen

Nach dem ersten erfolgreichen Build:

```bash
docker pull ghcr.io/jbkunama1/hai.sshmcpauth:latest

docker run -d \
  --name sshmcp-auth \
  --network highfishNetwork \
  -e SSHMCP_API_KEY="DEIN_STARKER_API_KEY" \
  -e SSHMCP_TARGET_HOST="sshmcp-core" \
  -e SSHMCP_TARGET_PORT="8000" \
  -e SSHMCP_LISTEN_PORT="8822" \
  -p 8822:8822 \
  ghcr.io/jbkunama1/hai.sshmcpauth:latest
```

In deiner Compose-Datei kannst du den Service `sshmcp-auth` alternativ so definieren:

```yaml
  sshmcp-auth:
    image: ghcr.io/jbkunama1/hai.sshmcpauth:latest
    container_name: sshmcp-auth
    restart: unless-stopped
    networks:
      - highfishNetwork
    ports:
      - "8822:8822"
    environment:
      SSHMCP_API_KEY: "DEIN_STARKER_API_KEY"
      SSHMCP_TARGET_HOST: "sshmcp-core"
      SSHMCP_TARGET_PORT: "8000"
      SSHMCP_LISTEN_PORT: "8822"
```

Damit brauchst du das Volume `/home/sshmcp/auth` nicht mehr – das Skript ist bereits im Image enthalten.

## Security Notes

- This pattern enforces an API key at the HTTP/MCP boundary, but you should **also**:
  - Use SSH keys instead of passwords for your LAN servers
  - Limit which commands are allowed on remote hosts
  - Restrict network access to the `sshmcp-auth` port (e.g. via firewall or VPN)
- Do not hard-code production secrets into the repo. Always inject secrets via environment variables.

## License

This project is licensed under the MIT License. See `LICENSE` for details.
