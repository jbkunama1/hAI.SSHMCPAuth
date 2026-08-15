# Syntax: Dockerfile for the SSHMCPAuth auth proxy container

FROM node:18-alpine

# Arbeitsverzeichnis im Container
WORKDIR /usr/src/app

# Auth-Proxy-Skript ins Image kopieren
COPY auth/auth-proxy.js ./auth-proxy.js

# Standard-Umgebungsvariablen (können zur Laufzeit überschrieben werden)
ENV SSHMCP_TARGET_HOST=sshmcp-core \
    SSHMCP_TARGET_PORT=8000 \
    SSHMCP_LISTEN_PORT=8822

# API-Key wird NICHT ins Image gebacken, sondern zur Laufzeit per Env gesetzt:
#   SSHMCP_API_KEY="DEIN_STARKER_API_KEY"

# Startkommando: Node.js-Proxy ausführen
CMD ["node", "./auth-proxy.js"]
