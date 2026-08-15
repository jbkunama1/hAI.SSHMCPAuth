# hAI.SSHMCPAuth

Auth-layered MCP SSH gateway for secure agent access into your LAN.

This repository provides:

- `sshmcp-core`: the upstream `mingyang91/ssh-mcp` MCP SSH server.
- `sshmcp-auth`: a lightweight Node.js API-key layer in front of the MCP server.
- A Dockerfile for the auth layer.
- A GitHub Actions workflow that builds and publishes the auth image to GHCR.
- A Portainer-ready stack using the published GHCR image.

The intended request path is:

```text
MCP client / AnythingMCP
        |
        |  HTTP MCP + Authorization: Bearer <API key>
        v
sshmcp-auth :8822
        |
        |  internal Docker network
        v
sshmcp-core :8000
        |
        |  SSH
        v
LAN servers
```

> Security notice: This project is an access gateway to SSH-capable systems. Use it only in a trusted network or behind a VPN/tunnel with HTTPS. Use dedicated, least-privileged SSH accounts and preferably SSH keys instead of passwords.

## Requirements

- Docker and Docker Compose, or Portainer.
- A Docker network named `highfishNetwork`, or a different external network name configured in the stack.
- A host that can reach the target LAN servers via SSH.
- An upstream-compatible `mingyang91/ssh-mcp` deployment exposing its MCP HTTP endpoint on port `8000` inside the Docker network.

Create the external network if it does not exist:

```bash
docker network create highfishNetwork
```

## GHCR image

The auth-layer image is published by GitHub Actions as:

```text
ghcr.io/jbkunama1/hai.sshmcpauth:latest
```

The image contains `auth/auth-proxy.js`; the script is copied into the image at build time and starts automatically as the container command. The API key is deliberately not built into the image. It must be supplied at runtime.

The workflow is located at `.github/workflows/docker-image.yml`. It builds on pushes to `main` and can also be started manually with `workflow_dispatch`.

## Portainer installation using GHCR

### 1. Pull permissions

If the GHCR package is public, no registry login is normally required. If the package is private, log in on the Docker host with a GitHub token that has package read permission:

```bash
echo "$CR_PAT" | docker login ghcr.io -u YOUR_GITHUB_USERNAME --password-stdin
```

Do not put the token into the stack or commit it to Git.

### 2. Create the stack

In Portainer:

1. Open **Stacks**.
2. Select **Add stack**.
3. Give it a name, for example `sshmcp-auth`.
4. Paste the following Compose file.
5. Replace `CHANGE_ME_WITH_A_LONG_RANDOM_API_KEY`.
6. Deploy the stack.

```yaml
services:
  sshmcp-core:
    image: mingyang91/ssh-mcp:latest
    container_name: sshmcp-core
    restart: unless-stopped
    networks:
      - highfishNetwork
    expose:
      - "8000"
    volumes:
      - /home/sshmcp:/data
    environment:
      RUST_LOG: "info"
      MCP_PORT: "8000"

  sshmcp-auth:
    image: ghcr.io/jbkunama1/hai.sshmcpauth:latest
    container_name: sshmcp-auth
    restart: unless-stopped
    networks:
      - highfishNetwork
    ports:
      - "8822:8822"
    environment:
      SSHMCP_API_KEY: "CHANGE_ME_WITH_A_LONG_RANDOM_API_KEY"
      SSHMCP_TARGET_HOST: "sshmcp-core"
      SSHMCP_TARGET_PORT: "8000"
      SSHMCP_LISTEN_PORT: "8822"

networks:
  highfishNetwork:
    external: true
```

The core service is not published to the host. Only `sshmcp-auth` exposes port `8822`. The auth container forwards authenticated requests to `sshmcp-core:8000` over `highfishNetwork`.

### 3. Generate an API key

Generate a strong key on the Docker host:

```bash
openssl rand -hex 32
```

Put the result into `SSHMCP_API_KEY` in Portainer. Do not use the example value in production. If you change the key, redeploy the stack.

### 4. Check the containers

```bash
docker ps --filter name=sshmcp

docker logs --tail=100 sshmcp-auth
```

The auth container should report that it is listening on port `8822`. The core container must be reachable by the service name `sshmcp-core` on the shared Docker network.

## Environment variables

### `sshmcp-auth`

| Variable | Required | Default | Description |
|---|---:|---|---|
| `SSHMCP_API_KEY` | yes | none | Secret expected in the HTTP header `Authorization: Bearer <value>`. The container exits if it is missing. |
| `SSHMCP_TARGET_HOST` | no | `sshmcp-core` | Docker DNS name or hostname of the upstream MCP server. |
| `SSHMCP_TARGET_PORT` | no | `8000` | TCP port of the upstream MCP server inside the Docker network. |
| `SSHMCP_LISTEN_PORT` | no | `8822` | Port on which the auth layer listens inside the container. |

### `sshmcp-core`

| Variable | Default | Description |
|---|---|---|
| `RUST_LOG` | `info` | Logging level for the upstream Rust application. |
| `MCP_PORT` | `8000` | Internal MCP port used by the upstream server. Verify this against the upstream image version you deploy. |

The API key must not be placed in the Dockerfile, GitHub Actions workflow, or a public repository. Supply it only as a Portainer secret/environment value at deployment time.

## MCP client configuration

Configure AnythingMCP or another compatible MCP client to use the auth layer, not the core service:

```json
{
  "mcpServers": {
    "ssh-lan": {
      "name": "SSH MCP LAN",
      "type": "streamable",
      "url": "https://sshmcp.arbeitermili.eu/mcp",
      "enabled": true,
      "headers": {
        "Authorization": "Bearer CHANGE_ME_WITH_A_LONG_RANDOM_API_KEY"
      }
    }
  }
}
```

For a direct LAN test without HTTPS, use:

```text
http://192.168.178.10:8822/mcp
```

For production, prefer HTTPS through your tunnel and ensure that the API key is transmitted only over an encrypted connection.

## How authentication works

The auth layer compares the incoming `Authorization` header to:

```text
Bearer <value of SSHMCP_API_KEY>
```

Requests with a missing or incorrect header receive HTTP `401 Unauthorized`. Requests with a matching header are streamed to the configured upstream host and port. The layer does not perform SSH authentication itself; the upstream MCP SSH server handles the SSH connection to the selected LAN host.

## Build locally

```bash
docker build -t hai-sshmcpauth:local .

docker run --rm \
  -p 8822:8822 \
  -e SSHMCP_API_KEY="CHANGE_ME_WITH_A_LONG_RANDOM_API_KEY" \
  -e SSHMCP_TARGET_HOST="sshmcp-core" \
  -e SSHMCP_TARGET_PORT="8000" \
  -e SSHMCP_LISTEN_PORT="8822" \
  hai-sshmcpauth:local
```

## Security recommendations

- Do not expose port `8000` from `sshmcp-core`.
- Restrict access to port `8822` with a firewall, VPN, or private tunnel.
- Use HTTPS for any access outside the LAN.
- Use separate, least-privileged SSH accounts on target servers.
- Prefer SSH key authentication over reusable passwords.
- Do not allow root login for the SSH accounts used by agents.
- Restrict allowed commands at the SSH/MCP layer where supported.
- Rotate the MCP API key if it is ever exposed.
- Review container and upstream image updates before deploying `latest` in production; pin tested image tags or digests where practical.

## License

This project is licensed under the MIT License. See `LICENSE` for details.
