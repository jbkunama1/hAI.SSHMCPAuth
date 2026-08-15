# hAI.SSHMCPAuth

[![Build and publish Docker image](https://github.com/jbkunama1/hAI.SSHMCPAuth/actions/workflows/docker-image.yml/badge.svg)](https://github.com/jbkunama1/hAI.SSHMCPAuth/actions/workflows/docker-image.yml)
[![Docker Image](https://img.shields.io/badge/ghcr.io-image-2496ED?logo=docker&logoColor=white)](https://github.com/jbkunama1/hAI.SSHMCPAuth/pkgs/container/hai.sshmcpauth)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Repository](https://img.shields.io/badge/GitHub-public-181717?logo=github&logoColor=white)](https://github.com/jbkunama1/hAI.SSHMCPAuth)
[![Portainer](https://img.shields.io/badge/Portainer-ready-13BEF9?logo=portainer&logoColor=white)](https://www.portainer.io/)

Auth-layered MCP SSH gateway for secure agent access into your LAN.

The published GHCR image is:

```text
ghcr.io/jbkunama1/hai.sshmcpauth:latest
```

```text
MCP client / AnythingMCP
        |
        |  HTTP MCP + Authorization: ****** key>
        v
sshmcp-auth :8822
        |
        |  highfishNetwork
        v
sshmcp-core :8000
        |
        |  SSH
        v
LAN servers
```

> Security notice: This project is an access gateway to SSH-capable systems. Use it only in a trusted network or behind a VPN/tunnel with HTTPS. Use dedicated, least-privileged SSH accounts and preferably SSH keys instead of passwords.

---

## English

### Overview

- `sshmcp-auth` is a Node.js API-key authentication layer in front of the MCP SSH service.
- `sshmcp-core` is the upstream `mingyang91/ssh-mcp` service.
- `sshmcp-auth` validates the HTTP `Authorization` header of every incoming MCP request.
- Valid requests are forwarded internally to `sshmcp-core`.
- The API key is supplied only at runtime and is not included in the public Docker image.
- Port `8822` is externally published.
- Port `8000` must remain internal.

### Requirements

- Docker and Docker Compose, or Portainer.
- A Docker network named `highfishNetwork`, or a different external network name configured in the stack.
- A host that can reach the target LAN servers via SSH.
- An upstream-compatible `mingyang91/ssh-mcp` deployment exposing its MCP HTTP endpoint on port `8000` inside the Docker network.

Create the external network if it does not exist:

```bash
docker network create highfishNetwork
```

### Portainer deployment from the Git repository

1. Open Portainer.
2. Go to **Stacks**.
3. Select **Add stack**.
4. Enter a stack name, for example `sshmcp-auth`.
5. Select **Repository** as the build method.
6. Enter this repository URL:

   ```text
   https://github.com/jbkunama1/hAI.SSHMCPAuth.git
   ```

7. Set the Compose path to:

   ```text
   docker-compose.yml
   ```

8. Select or enter branch:

   ```text
   main
   ```

9. Add the environment variables.
10. Deploy the stack.

The repository's `docker-compose.yml` already references:

```text
image: ghcr.io/jbkunama1/hai.sshmcpauth:latest
```

Portainer pulls the image from GHCR when the stack is deployed or updated. No local build takes place.

The upstream `sshmcp-core` container is reachable only through the external Docker network `highfishNetwork`.

#### Private GHCR packages

- If the package is private, Portainer needs registry credentials for `ghcr.io`.
- Use a GitHub token with `package-read` permission.
- Never put the token into `docker-compose.yml` or README.md.

### Portainer deployment using the Web editor

Alternatively, users can select **Web editor** and paste the repository's `docker-compose.yml`.

Complete Compose example:

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
      volumes:
        - ./data:/data:ro
      environment:
        SSHMCP_API_KEY: "CHANGE_ME_WITH_A_LONG_RANDOM_API_KEY"
        SSHMCP_TARGET_HOST: "sshmcp-core"
        SSHMCP_TARGET_PORT: "8000"
        SSHMCP_LISTEN_PORT: "8822"
        SSHMCP_ALIASES_FILE: "/data/ssh_aliases.json"

  networks:
    highfishNetwork:
      external: true
  ```

  The external network can be created with:

```bash
docker network create highfishNetwork
```

> **Warning:** `CHANGE_ME_WITH_A_LONG_RANDOM_API_KEY` must be replaced with a long, random API key and must never be committed to GitHub.

### Check the containers

```bash
docker ps --filter name=sshmcp

docker logs --tail=100 sshmcp-auth
```

The auth container should report that it is listening on port `8822`. The core container must be reachable by the service name `sshmcp-core` on the shared Docker network.

### Environment variables

#### `sshmcp-auth`

| Variable | Required | Default | Description |
|---|---:|---|---|
| `SSHMCP_API_KEY` | yes | none | API key expected in `Authorization: ****** The container exits if it is missing. |
| `SSHMCP_TARGET_HOST` | no | `sshmcp-core` | Docker DNS name or hostname of the upstream MCP server. |
| `SSHMCP_TARGET_PORT` | no | `8000` | Internal TCP port of the upstream MCP server. |
| `SSHMCP_LISTEN_PORT` | no | `8822` | Port on which the auth layer listens. |
| `SSHMCP_ALIASES_FILE` | no | `/usr/src/app/data/ssh_aliases.json` | Path to the JSON alias registry (SSH host, port, username, password/key path). |

#### `sshmcp-core`

| Variable | Default | Description |
|---|---|---|
| `RUST_LOG` | `info` | Logging level of the upstream Rust application. |
| `MCP_PORT` | `8000` | Internal MCP port. Verify this against the upstream image version. |

Generate a strong API key:

```bash
openssl rand -hex 32
```

The key must only be stored in Portainer's environment-variable or secret configuration. Keep it out of the Dockerfile, the GitHub Actions workflow, and this repository.

### AnythingMCP configuration

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
        "Authorization": "******"
      }
    }
  }
}
```

Direct LAN test endpoint:

```text
http://192.168.178.10:8822/mcp
```

External access should use HTTPS through the tunnel, so the API key is transmitted only over an encrypted connection.

### How authentication works

The auth layer compares the incoming `Authorization` header to:

```text
****** of SSHMCP_API_KEY>
```

Requests with a missing or incorrect header receive HTTP `401 Unauthorized`. Requests with a matching header are streamed to the configured upstream host and port. The layer does not perform SSH authentication itself; the upstream MCP SSH server handles the SSH connection to the selected LAN host.

### SSH alias registry

The auth layer can pre-load up to 20 SSH servers with credentials so you can address them by alias (for example `ssh1`, `ssh2`, ...) instead of typing `host`, `username` and `password` on every call.

1. Create your credentials file from the sample (never commit the real one):

   ```bash
   cp data/ssh_aliases.example.json data/ssh_aliases.json
   ```

   Fill in your servers:

   ```json
   {
     "ssh1": {
       "host": "10.0.0.11",
       "port": 22,
       "username": "your-user",
       "password": "your-secret"
     }
   }
   ```

   Entries may use `password` for password authentication or `key_path` for key-based authentication. `data/ssh_aliases.json` is excluded from git (see `data/.gitignore`) so passwords are never committed. Store the file on the host and bind-mount it into the container:

   ```yaml
   volumes:
     - ./data:/data:ro
   ```

2. Point the proxy at the file:

   ```yaml
   environment:
     SSHMCP_ALIASES_FILE: "/data/ssh_aliases.json"
   ```

3. Use the alias in `ssh_connect`:

   ```json
   {
     "method": "tools/call",
     "params": {
       "name": "ssh_connect",
       "arguments": { "address": "ssh1" }
     }
   }
   ```

   The proxy rewrites `address` to `host:port` and injects the stored `username` and `password`/`key_path`.

4. List configured aliases with the `ssh_list_aliases` tool. This tool is served by the auth layer directly and never returns passwords or keys.

#### Admin UI and CLI

The auth layer exposes a password-protected admin server on its own port (`8825` by default, `SSHMCP_ADMIN_PORT`) for managing the alias registry at runtime — no file editing needed.

1. Set the admin password:

   ```yaml
   environment:
     SSHMCP_ADMIN_PASSWORD: "choose-a-strong-password"
   ```

   > If `SSHMCP_ADMIN_PASSWORD` is unset or empty the admin server is disabled (the proxy logs a warning and continues).

2. **UI**: open `http://<host>:8825/`, log in with the admin password, and manage aliases from the browser. The login sets an `HttpOnly` cookie; a `X-Admin-Token` header is used by the CLI.

3. **CLI** (runs wherever Node is available, targets the admin REST API):

   ```bash
   export SSHMCP_ADMIN_BASE="http://localhost:8825"
   export SSHMCP_ADMIN_PASSWORD="choose-a-strong-password"

   node auth/manage-aliases.mjs list
   node auth/manage-aliases.mjs add ssh1 --host 10.0.0.11 --port 22 --username your-user --password your-secret
   node auth/manage-aliases.mjs update ssh1 --port 2222
   node auth/manage-aliases.mjs get ssh1
   node auth/manage-aliases.mjs remove ssh1
   ```

   All commands write through to `SSHMCP_ALIASES_FILE` (atomic), take effect immediately, respect the 20-alias limit, and never print passwords or keys (only `hasPassword` / `hasKeyPath` flags).

Upgrade path: credentials are stored in plaintext for now. The `key_path` field already supports SSH keys, and secrets handling can later be moved to Docker secrets without changing the alias format.

### GitHub Actions and GHCR

- Workflow location: `.github/workflows/docker-image.yml`.
- It runs on pushes to `main`.
- It can also run through `workflow_dispatch`.
- It builds the auth image.
- It publishes:

  ```text
  ghcr.io/jbkunama1/hai.sshmcpauth:latest
  ```

- The API key is never included in the image and is always injected at runtime.

### Build locally

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

---

## Deutsch

### Übersicht

- `sshmcp-auth` ist eine Node.js-API-Key-Authentifizierungsschicht vor dem MCP-SSH-Dienst.
- `sshmcp-core` ist der Upstream-Dienst `mingyang91/ssh-mcp`.
- `sshmcp-auth` prüft den HTTP-`Authorization`-Header jeder eingehenden MCP-Anfrage.
- Gültige Anfragen werden intern an `sshmcp-core` weitergeleitet.
- Der API-Key wird ausschließlich zur Laufzeit bereitgestellt und ist nicht im öffentlichen Docker-Image enthalten.
- Port `8822` wird extern veröffentlicht.
- Port `8000` muss intern bleiben.

### Voraussetzungen

- Docker und Docker Compose oder Portainer.
- Ein Docker-Netzwerk namens `highfishNetwork` oder ein abweichender externer Netzwerkname, der im Stack konfiguriert ist.
- Ein Host, der die Ziel-LAN-Server per SSH erreichen kann.
- Eine kompatible `mingyang91/ssh-mcp`-Bereitstellung, die ihren MCP-HTTP-Endpunkt im Docker-Netzwerk auf Port `8000` bereitstellt.

Falls das externe Netzwerk nicht existiert, legen Sie es an:

```bash
docker network create highfishNetwork
```

### Portainer-Deployment aus dem Git-Repository

1. Portainer öffnen.
2. Zu **Stacks** wechseln.
3. **Add stack** auswählen.
4. Einen Stack-Namen vergeben, zum Beispiel `sshmcp-auth`.
5. Als Build-Methode **Repository** auswählen.
6. Repository-URL eintragen:

   ```text
   https://github.com/jbkunama1/hAI.SSHMCPAuth.git
   ```

7. Compose-Pfad eintragen:

   ```text
   docker-compose.yml
   ```

8. Branch `main` auswählen.
9. Umgebungsvariablen setzen.
10. Stack deployen.

Die `docker-compose.yml` des Repositorys verweist bereits auf:

```text
image: ghcr.io/jbkunama1/hai.sshmcpauth:latest
```

Portainer zieht das Image beim Deployen oder Aktualisieren des Stacks aus GHCR. Es findet kein lokaler Build statt.

Der Upstream-Container `sshmcp-core` ist ausschließlich über das externe Docker-Netzwerk `highfishNetwork` erreichbar.

#### Private GHCR-Pakete

- Ist das Paket privat, benötigt Portainer Registry-Zugangsdaten für `ghcr.io`.
- Verwenden Sie einen GitHub-Token mit der Berechtigung `package-read`.
- Geben Sie den Token niemals in `docker-compose.yml` oder in die README.md ein.

### Portainer-Deployment mit dem Web-Editor

Alternativ können Benutzer **Web editor** auswählen und die `docker-compose.yml` des Repositorys einfügen.

Vollständiges Compose-Beispiel:

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
        volumes:
          - ./data:/data:ro
        environment:
          SSHMCP_API_KEY: "CHANGE_ME_WITH_A_LONG_RANDOM_API_KEY"
          SSHMCP_TARGET_HOST: "sshmcp-core"
          SSHMCP_TARGET_PORT: "8000"
          SSHMCP_LISTEN_PORT: "8822"
          SSHMCP_ALIASES_FILE: "/data/ssh_aliases.json"

    networks:
      highfishNetwork:
        external: true
    ```

    Das externe Netzwerk kann wie folgt angelegt werden:

```bash
docker network create highfishNetwork
```

> **Warnung:** `CHANGE_ME_WITH_A_LONG_RANDOM_API_KEY` muss durch einen langen, zufälligen API-Key ersetzt werden und darf niemals auf GitHub committet werden.

### Container prüfen

```bash
docker ps --filter name=sshmcp

docker logs --tail=100 sshmcp-auth
```

Der Auth-Container sollte melden, dass er auf Port `8822` lauscht. Der Core-Container muss über den Dienstnamen `sshmcp-core` im gemeinsamen Docker-Netzwerk erreichbar sein.

### Umgebungsvariablen

#### `sshmcp-auth`

| Variable | Erforderlich | Standard | Beschreibung |
|---|---:|---|---|
| `SSHMCP_API_KEY` | ja | keine | API-Key, der in `Authorization: ******` erwartet wird. Der Container beendet sich, wenn er fehlt. |
| `SSHMCP_TARGET_HOST` | nein | `sshmcp-core` | Docker-DNS-Name oder Hostname des Upstream-MCP-Servers. |
| `SSHMCP_TARGET_PORT` | nein | `8000` | Interner TCP-Port des Upstream-MCP-Servers. |
| `SSHMCP_LISTEN_PORT` | nein | `8822` | Port, auf dem die Auth-Schicht lauscht. |
| `SSHMCP_ALIASES_FILE` | nein | `/usr/src/app/data/ssh_aliases.json` | Pfad zur JSON-Alias-Registrierung (SSH-Host, Port, Benutzername, Passwort/Key-Pfad). |

#### `sshmcp-core`

| Variable | Standard | Beschreibung |
|---|---|---|
| `RUST_LOG` | `info` | Protokollierungsgrad der Upstream-Rust-Anwendung. |
| `MCP_PORT` | `8000` | Interner MCP-Port. Gegen die Version des Upstream-Images prüfen. |

Einen starken API-Key erzeugen:

```bash
openssl rand -hex 32
```

Der Key darf ausschließlich in der Umgebungsvariablen- oder Secret-Konfiguration von Portainer gespeichert werden – nicht im Dockerfile, im GitHub-Actions-Workflow oder in diesem Repository.

### AnythingMCP-Konfiguration

Konfigurieren Sie AnythingMCP oder einen anderen kompatiblen MCP-Client so, dass er die Auth-Schicht und nicht den Core-Dienst verwendet:

```json
{
  "mcpServers": {
    "ssh-lan": {
      "name": "SSH MCP LAN",
      "type": "streamable",
      "url": "https://sshmcp.arbeitermili.eu/mcp",
      "enabled": true,
      "headers": {
        "Authorization": "******"
      }
    }
  }
}
```

Direkter LAN-Test-Endpunkt:

```text
http://192.168.178.10:8822/mcp
```

Für den externen Zugriff HTTPS über den Tunnel verwenden, damit der API-Key ausschließlich über eine verschlüsselte Verbindung übertragen wird.

### So funktioniert die Authentifizierung

Die Auth-Schicht vergleicht den eingehenden `Authorization`-Header mit:

```text
****** of SSHMCP_API_KEY>
```

Anfragen mit fehlendem oder falschem Header erhalten HTTP `401 Unauthorized`. Anfragen mit passendem Header werden an den konfigurierten Upstream-Host und -Port gestreamt. Die Schicht führt selbst keine SSH-Authentifizierung durch; der Upstream-MCP-SSH-Server übernimmt die SSH-Verbindung zum ausgewählten LAN-Host.

### SSH-Alias-Registrierung

Die Auth-Schicht kann bis zu 20 SSH-Server mit Zugangsdaten vorbelegen, sodass Sie sie über einen Alias (zum Beispiel `ssh1`, `ssh2`, ...) ansprechen können, statt bei jedem Aufruf `host`, `username` und `password` einzugeben.

1. Zugangsdaten-Datei aus dem Beispiel anlegen (die echte Datei niemals committen):

   ```bash
   cp data/ssh_aliases.example.json data/ssh_aliases.json
   ```

   Server eintragen:

   ```json
   {
     "ssh1": {
       "host": "10.0.0.11",
       "port": 22,
       "username": "dein-benutzer",
       "password": "dein-geheimnis"
     }
   }
   ```

   Einträge können `password` für Passwort-Authentifizierung oder `key_path` für Schlüssel-Authentifizierung verwenden. `data/ssh_aliases.json` ist von git ausgeschlossen (siehe `data/.gitignore`), damit Passwörter nie committet werden. Die Datei auf dem Host ablegen und in den Container bind-mounten:

   ```yaml
   volumes:
     - ./data:/data:ro
   ```

2. Proxy auf die Datei zeigen lassen:

   ```yaml
   environment:
     SSHMCP_ALIASES_FILE: "/data/ssh_aliases.json"
   ```

3. Alias in `ssh_connect` verwenden:

   ```json
   {
     "method": "tools/call",
     "params": {
       "name": "ssh_connect",
       "arguments": { "address": "ssh1" }
     }
   }
   ```

   Der Proxy schreibt `address` zu `host:port` um und fügt die gespeicherten `username`- und `password`/`key_path`-Werte ein.

4. Konfigurierte Aliase mit dem Tool `ssh_list_aliases` auflisten. Dieses Tool wird direkt von der Auth-Schicht bedient und gibt niemals Passwörter oder Schlüssel zurück.

#### Admin-UI und CLI

Die Auth-Schicht stellt einen passwortgeschützten Admin-Server auf einem eigenen Port (`8825` standardmäßig, `SSHMCP_ADMIN_PORT`) bereit, um die Alias-Registrierung zur Laufzeit zu verwalten — ohne Datei-Editierung.

1. Admin-Passwort setzen:

   ```yaml
   environment:
     SSHMCP_ADMIN_PASSWORD: "ein-starkes-passwort-waehlen"
   ```

   > Ist `SSHMCP_ADMIN_PASSWORD` nicht gesetzt oder leer, ist der Admin-Server deaktiviert (der Proxy loggt eine Warnung und läuft weiter).

2. **UI**: `http://<host>:8825/` im Browser öffnen, mit dem Admin-Passwort anmelden und Aliase verwalten. Der Login setzt ein `HttpOnly`-Cookie; für die CLI wird der `X-Admin-Token`-Header verwendet.

3. **CLI** (läuft überall, wo Node verfügbar ist, spricht die Admin-REST-API an):

   ```bash
   export SSHMCP_ADMIN_BASE="http://localhost:8825"
   export SSHMCP_ADMIN_PASSWORD="ein-starkes-passwort-waehlen"

   node auth/manage-aliases.mjs list
   node auth/manage-aliases.mjs add ssh1 --host 10.0.0.11 --port 22 --username dein-benutzer --password dein-geheimnis
   node auth/manage-aliases.mjs update ssh1 --port 2222
   node auth/manage-aliases.mjs get ssh1
   node auth/manage-aliases.mjs remove ssh1
   ```

   Alle Befehle schreiben atomar in `SSHMCP_ALIASES_FILE`, wirken sofort, respektieren das 20-Alias-Limit und geben niemals Passwörter oder Schlüssel aus (nur `hasPassword`-/`hasKeyPath`-Flags).

Ausbaupfad: Die Zugangsdaten liegen derzeit im Klartext vor. Das Feld `key_path` unterstützt bereits SSH-Keys; die Secret-Verwaltung kann später ohne Formatänderung auf Docker-Secrets umgestellt werden.

### GitHub Actions und GHCR

- Workflow-Speicherort: `.github/workflows/docker-image.yml`.
- Er läuft bei Pushes auf `main`.
- Er kann auch über `workflow_dispatch` ausgelöst werden.
- Er baut das Auth-Image.
- Er veröffentlicht:

  ```text
  ghcr.io/jbkunama1/hai.sshmcpauth:latest
  ```

- Der API-Key ist niemals im Image enthalten und wird immer zur Laufzeit injiziert.

### Lokal bauen

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

---

## Security / Sicherheit

- Do not expose port `8000` externally.
- Port `8000` nicht nach außen exponieren.
- Use HTTPS for external access.
- Für externen Zugriff HTTPS verwenden.
- Restrict port `8822` with firewall, VPN, or tunnel.
- Port `8822` mit Firewall, VPN oder Tunnel beschränken.
- Use least-privileged SSH users.
- Dedizierte SSH-Benutzer mit möglichst wenigen Rechten verwenden.
- Prefer SSH keys over passwords.
- SSH-Keys gegenüber Passwörtern bevorzugen.
- Rotate the API key if it is exposed.
- Bei Offenlegung den API-Key sofort ersetzen.
- Do not commit API keys, passwords, registry tokens, or private SSH keys.
- Niemals API-Keys, Passwörter, Registry-Tokens oder private SSH-Keys committen.

---

## License / Lizenz

MIT License. See [LICENSE](LICENSE).

MIT-Lizenz. Siehe [LICENSE](LICENSE).