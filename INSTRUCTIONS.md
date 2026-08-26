# hAI.SSHMCPAuth – Agent Instructions

Diese Datei beschreibt, wie Agenten den MCP-Server **hAI.SSHMCPAuth** nutzen sollen, um sicher per MCP über einen API-Key auf SSH-Ziele im LAN zuzugreifen.[web:23][web:25][web:29]

## 1. Überblick

- **Projektname:** hAI.SSHMCPAuth  
- **Zweck:** Auth-layered MCP SSH-Gateway für sicheren Agentenzugang in dein LAN.[web:23][web:25][web:29]  
- **Architektur:** Node.js API-Key-Proxy vor einem bestehenden `ssh-mcp`-Server.[web:23][web:25]  
- **Einsatzszenario:** Zugriff von LLM-Agenten auf SSH-fähige Systeme im LAN über MCP, abgesichert durch einen API-Key.[web:23][web:25][web:29]

## 2. Sicherheits-Hinweise

- Dieses Projekt ist ein Zugangsgateway zu SSH-fähigen Systemen.[web:25]  
- Nutze es nur in einem **vertrauenswürdigen Netzwerk** oder **hinter einem VPN/Tunnel mit HTTPS**.[web:25]  
- Verwende **dedizierte, minimal berechtigte SSH-Accounts** und **bevorzuge SSH Keys statt Passwörtern**.[web:25]  

> **Verpflichtend für Agenten:**  
> Behandle jeden Zugriff über diesen MCP-Server so, als würdest du direkt auf ein sensibles Produktionssystem zugreifen. Führe keine Aktionen ohne expliziten Auftrag des Nutzers aus.

## 3. Voraussetzungen

- **Docker** installiert.[web:29]  
- **Docker Compose** installiert, um den bereitgestellten Docker-Compose-Stack auszuführen.[web:29]  
- Zugriff auf eine gültige **SSH-Infrastruktur** (Ziele im LAN mit SSH-Servern).[web:25]  

> **Hinweis:** Die konkreten Compose-Dateien und Beispiel-Konfigurationen entnimmst du dem Projekt-Repository bzw. den bereitgestellten Projektdateien deines Deployments.

## 4. Authentifizierung per API-Key

- Der MCP-Server verwendet einen **API-Key** zur Authentifizierung von Agenten.[web:29]  
- Der API-Key wird über die Umgebungsvariable **`SSHMCP_API_KEY`** konfiguriert.[web:29]  

### Richtlinien für Agenten

- Gehe davon aus, dass **ohne gültigen API-Key kein Zugriff** auf den Gateway möglich ist.[web:29]  
- Wie genau der API-Key vom MCP-Host an den Gateway übergeben wird (z. B. Header, Query-Parameter, MCP-spezifische Auth-Erweiterung), ist **deploymentspezifisch** und wird außerhalb dieser Datei definiert.  
- Passe dich immer den Einstellungen des Betreibers an (z. B. `.mcp.json`, Host-spezifische Konfiguration, Secrets).

## 5. Betrieb (High-Level)

> Die folgenden Punkte beschreiben nur das **Verhaltensprofil** für Agenten. Technische Details wie Portnummern, Endpunkte oder Compose-Dateien werden durch die jeweilige Umgebung vorgegeben.

1. **Verbindung**  
   - Verwende den vom Betreiber bereitgestellten MCP-Endpunkt (z. B. über HTTP/Remote-MCP), um dich mit hAI.SSHMCPAuth zu verbinden.  
   - Stelle sicher, dass dein Host (z. B. LLM-Client, IDE, MCP-Host) korrekt so konfiguriert ist, dass er den API-Key bereitstellt.

2. **Authentifizierte Nutzung**  
   - Führe nur dann Tools/Kommandos aus, wenn deine Verbindung als authentifiziert gilt (z. B. keine Fehler im Sinne von „Unauthorized“ oder ähnlichen Meldungen).  
   - Frage im Zweifel beim Nutzer nach, ob der API-Key bzw. die MCP-Konfiguration korrekt gesetzt ist.

3. **SSH-Zugriff über MCP**  
   - Behandle jede vom MCP bereitgestellte SSH-Funktion (z. B. Kommandos ausführen, Dateien verwalten) mit hoher Vorsicht.  
   - Dokumentiere für den Nutzer, welches Zielsystem, welcher Befehl und welches Zielverzeichnis betroffen ist (Transparenzpflicht).

## 6. Rollenverständnis für Agenten

### Was dieser MCP-Server ist

- Ein **Auth-Layer** vor einem bestehenden `ssh-mcp`-Server: Der Auth-Layer nimmt MCP-Anfragen entgegen und reicht sie nur dann an `ssh-mcp` weiter, wenn der API-Key gültig ist.[web:23][web:25][web:29]  
- Ein **Gateway in das LAN**: Der Zugriff erfolgt nicht direkt über öffentliche IPs, sondern über das interne Netzwerk.[web:23][web:25][web:29]  

### Was Agenten tun dürfen

- **Erlaubt (wenn vom Nutzer angewiesen):**
  - Diagnose-Befehle (z. B. Statusabfragen, Logs lesen).
  - Konfigurationsprüfung (z. B. Anzeigen von Config-Dateien, ohne Änderungen).
  - Ausführen von klar beschriebenen Kommandos, die der Nutzer autorisiert.

- **Nicht ohne explizite Freigabe:**
  - Änderungen an Systemkonfigurationen.
  - Benutzerverwaltung (Anlegen/Löschen von Accounts).
  - Installation/Deinstallation von Software.
  - Änderungen an produktiven Daten oder kritischen Diensten.

## 7. Best Practices bei der Nutzung

1. **Explizite Bestätigung einholen**  
   - Vor destruktiven oder schwer rückgängig zu machenden Aktionen (z. B. Löschen, Neustarts) immer die Zustimmung des Nutzers einholen.

2. **Zielumgebung klar benennen**  
   - Nenne dem Nutzer stets:
     - Zielhost (Name/IP, soweit bekannt),
     - Art der Aktion (lesen/schreiben),
     - betroffene Pfade oder Dienste.

3. **Minimalprinzip beachten**  
   - Führe nur die minimal notwendigen Aktionen aus.  
   - Schlage alternative, risikoärmere Schritte vor (z. B. Konfigurationsprüfung statt sofortigem Neustart).

4. **Dokumentation des Vorgehens**  
   - Beschreibe kurz, was du getan hast (z. B. „Logfile X gelesen“, „Service Y neu gestartet“), damit der Nutzer nachverfolgen kann, welche Aktionen über den MCP-Gateway liefen.

## 8. Konfiguration & Deployment (für Betreiber, Read-Only für Agenten)

- Es existiert ein veröffentliches GHCR-Image für dieses Projekt.[web:25]  
- Konkrete Image-Namen, Compose-Dateien und Startbefehle sind in der Projekt-README und in der Deployment-Umgebung dokumentiert.[web:25]  

> **Für Agenten:**  
> Du nimmst **keine Änderungen** an Docker-, Compose- oder Infrastrukturkonfigurationen vor. Diese Verantwortung liegt beim Betreiber. Du arbeitest ausschließlich innerhalb der bereitgestellten MCP-Tools.

---

## 9. Zusammenfassung für Agenten

- hAI.SSHMCPAuth ist ein **API-Key-geschützter MCP-Gateway** vor einem `ssh-mcp`-Server für sicheren SSH-Zugriff im LAN.[web:23][web:25][web:29]  
- Du arbeitest immer **authentifiziert** (API-Key) und in einem **vertrauenswürdigen Netzwerk** (bzw. hinter VPN/Tunnel mit HTTPS).[web:25][web:29]  
- Du nutzt **least privilege**: so wenig Aktionen wie nötig, so sicher wie möglich.[web:25]
