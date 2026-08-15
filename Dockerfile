# Syntax: Dockerfile for the SSHMCPAuth auth proxy container

FROM node:18-alpine

# Arbeitsverzeichnis im Container
WORKDIR /usr/src/app

# Auth-Proxy-Skripte ins Image kopieren
COPY auth/auth-proxy.js ./auth-proxy.js
COPY auth/admin-server.js ./admin-server.js
COPY auth/manage-aliases.mjs ./manage-aliases.mjs

# Alias-Registrierung (Beispieldaten; echte Zugangsdaten per Mount bereitstellen)
COPY data/ssh_aliases.example.json ./data/ssh_aliases.json

# Standard-Umgebungsvariablen (können zur Laufzeit überschrieben werden)
ENV SSHMCP_TARGET_HOST=sshmcp-core \
    SSHMCP_TARGET_PORT=8000 \
    SSHMCP_LISTEN_PORT=8822 \
    SSHMCP_ADMIN_PORT=8825 \
    SSHMCP_ADMIN_PASSWORD="" \
    SSHMCP_ALIASES_FILE=/usr/src/app/data/ssh_aliases.json

# API-Key wird NICHT ins Image gebacken, sondern zur Laufzeit per Env gesetzt:
#   SSHMCP_API_KEY="DEIN_STARKER_API_KEY"

# Startkommando: Node.js-Proxy ausführen
CMD ["node", "./auth-proxy.js"]
