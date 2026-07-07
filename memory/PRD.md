# ZipForge — Mobile Dev Studio

## Vision
"Kannst du alles besser machen 100 mal und es verschwiesen neue noch nie da gesehen Module erstellen und besser machen alles alles was die nächsten 10 Jahre kommt"

ZipForge fasst die vom Nutzer hochgeladenen Systeme (codelab-system, ziprunner, zippy-executor, CORE_FORGE_LOKI/powershell-ki-debate, TERMUX_APK_INSTALLER) in **einer** offline-fähigen Expo Mobile App zusammen — mit AI-Analyse (Claude Sonnet 4.5), 3-Stage Forge Pipeline und Termux-Installer-Export.

## Tech Stack
- **Frontend**: Expo Router (React Native), file-based routing, JSZip für Offline-Extraction, WebView Live-Preview, Emergent LLM Key
- **Backend**: FastAPI, Motor (async MongoDB), emergentintegrations (Claude Sonnet 4.5)
- **DB**: MongoDB (chat_messages, projects, forge_jobs, forge_runs)

## Screens (6 Bottom Tabs)
1. **FORGE (Home)** – ZIP-Import (Offline via JSZip), Blank-Project Erstellung, Recent Projects
2. **EDITOR** – File-Tree mit Ordner-Baum, Code-Editor (SpaceMono font), Save/Copy/Ask-AI/Termux-Export/Preview Actions
3. **PREVIEW** – Live HTML/CSS/JS in WebView, Console-Bridge für Logs
4. **AI LAB** – Chat mit Claude Sonnet 4.5, Code-Kontext aus aktiver Datei anhängbar, Quick-Prompts, Code-Fence-Rendering
5. **LIBRARY** – 8 Offline-Snippets (HTML, JS, Python, Java, C++, CSS, RN, Canvas-Game), Filter-Chips, „Use as Project"
6. **PIPELINE** – 3-Stage Forge (Architect → Refiner → Synthesizer) für 6 Target-Envs: HTML/JS, Python, Termux Bash, PowerShell, SQLite, Lua VM. Async Job-Pattern mit Polling.

## Key Features
- **Offline-first**: Alle Projekte in AsyncStorage, ZIP-Extraction lokal via JSZip
- **AI-Integration**: Claude Sonnet 4.5 via Emergent LLM Key (kostenlos für Nutzer)
- **Forge Pipeline**: Sequential 3-stage code generation (Async Job pattern - kein Cloudflare Timeout)
- **Termux-Installer-Export**: Aus jedem Projekt einen consolidated .sh Installer bauen (ähnlich CORE_FORGE_LOKI)
- **Sprach-agnostic**: Automatische Language-Detection für 20+ Extensions

## API Endpoints
- `GET /api/` health
- `POST /api/ai/chat/simple` – single-turn Claude chat
- `GET /api/ai/sessions/{id}/messages` – Verlauf
- `GET /api/ai/sessions` – alle Sessions
- `DELETE /api/ai/sessions/{id}` – Session löschen
- `GET /api/snippets` – 8 Offline-Snippets
- `POST /api/forge/pipeline` – Startet Async-Job, returned `{job_id}`
- `GET /api/forge/pipeline/{job_id}` – Polling Status + Files (pending/running/done/error)
- `GET /api/forge/runs` – History
- `POST /api/export/termux` – Consolidated `install_termux_*.sh` Skript
- CRUD `/api/projects`

## Design
- Cyberpunk-Terminal Dark: `#050505` bg, `#E5FF00` neon accent, `#00F0FF` cyan
- SpaceMono für Code + Meta-Labels
- 44+px Touch-Targets, SafeArea-aware, 6 Bottom-Tabs mit aktivem Neon-Indikator

## Status
- ✅ Backend & Frontend end-to-end getestet (Iteration 1: 12/15 backend pass; Pipeline blocker durch Async-Refactor gefixt)
- ✅ Pipeline erfolgreich: 3 Files (~60KB Code) für "counter button" HTML/JS Prompt generiert
- ✅ Alle 6 Tabs verifiziert per Screenshot
