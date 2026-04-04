# Repository Map

> Quick orientation for developers and AI assistants working in this codebase.

## Project

**island-router-mcp** — An MCP server that exposes Island Router CLI operations as structured tools for AI assistants. Unofficial, not affiliated with Island Technology Inc.

**Stack:** TypeScript · Node.js 20+ · ESM · ssh2 · Zod · MCP SDK
**CLI Reference:** Aligned with official Island Router CLI Reference Guide (firmware 2.3.2, 260 pages)

## Directory Structure

```
island-router-mcp/                # Workspace root
├── .agent/
│   └── skills/                   # AI-readable skill references
│       ├── island-router-cli/    # CLI reference (firmware 2.3.2) & discovery tools
│       │   ├── SKILL.md          # Canonical CLI reference (official guide-aligned)
│       │   └── scripts/          # CLI discovery tooling
│       │       ├── cli_discovery.py
│       │       ├── cli_discovery_results.json
│       │       ├── cli_commands_flat.txt
│       │       └── island_router.py
│       │
│       ├── skill-mcp-builder/    # MCP server development guide
│       ├── skill-observability-pipeline/  # Syslog → Grafana pipeline
│       ├── skill-finops-gcp/     # GCP cost analysis & automation
│       ├── skill-meta-pipeline/  # Skill lifecycle orchestrator
│       ├── skill-network-fleet/  # Multi-device fleet management
│       ├── skill-mcp-orchestrator/  # Cross-MCP workflow chains
│       ├── skill-homelab-pi/     # Raspberry Pi homelab management
│       ├── skill-publisher/      # Skill publishing pipeline
│       ├── skill-firmware-differ/  # Firmware upgrade planner
│       └── skill-knowledge-harvester/  # Conversation → KI extractor
│
├── src/                          # TypeScript source
│   ├── server.ts                 # MCP server entrypoint — 3 meta-tools (14 query + 9 configure actions)
│   ├── islandSsh.ts              # SSH client (interactive shell via ssh2)
│   └── parsers/                  # CLI output → structured JSON
│       ├── interfaces.ts         # show interface / show interface summary
│       ├── routes.ts             # show ip routes / show ip neighbors
│       └── logs.ts               # show log / show syslog
│
├── build/                        # Compiled JS output (git-ignored)
├── package.json                  # ESM project config
├── tsconfig.json                 # TypeScript compiler settings
├── devices.example.json          # Template device inventory
├── devices.json                  # Real device config (git-ignored)
├── .gitignore
├── README.md
├── REPOMAP.md                    # ← You are here
├── CHANGELOG.md                  # Version history
└── CODING-STANDARDS.md           # Development conventions
```

## Key Files

| File | Purpose | Entry Point? |
| --- | --- | --- |
| `src/server.ts` | MCP server — 3 meta-tools with 14 query actions and 9 configure actions | ✅ `node build/server.js` |
| `src/islandSsh.ts` | SSH session management — `openSession()`, `runCommand()`, `closeSession()` | |
| `src/parsers/*.ts` | Transform raw CLI text into typed objects | |
| `devices.json` | Runtime device inventory (not committed) | |
| `.agent/skills/island-router-cli/SKILL.md` | Canonical CLI reference — aligned with official 260-page guide (fw 2.3.2) | |
| `.agent/skills/island-router-cli/scripts/cli_discovery_results.json` | Full command tree (3,136 commands) — structured JSON | |
| `.agent/skills/island-router-cli/scripts/cli_discovery.py` | Recursive CLI crawler for re-running discovery | |
| `CODING-STANDARDS.md` | Dev conventions, CLI model notes, action inventory, syntax corrections | |

## Agent Skills

| Skill | Domain | Purpose |
|---|---|---|
| `island-router-cli` | Networking | CLI reference for Island Router fw 2.3.2 — 2-context model (Global + Interface), history ETL, VPN, SNMP, DNS-over-HTTPS, syslog (numeric levels 0-7) |
| `skill-mcp-builder` | Development | Build MCP servers (TypeScript, Zod schemas, meta-tool patterns) |
| `skill-observability-pipeline` | DevOps | Syslog → Promtail → Loki → Grafana pipeline setup |
| `skill-finops-gcp` | Cloud | GCP billing queries, anomaly detection, budget alerts |
| `skill-meta-pipeline` | Meta | Orchestrate full skill lifecycle (create → publish) |
| `skill-network-fleet` | Networking | Multi-device config drift, compliance, backups |
| `skill-mcp-orchestrator` | Automation | Cross-MCP workflow recipes (Jira + Cloud Run + Confluence) |
| `skill-homelab-pi` | DevOps | Docker Compose, systemd hardening, Pi maintenance |
| `skill-publisher` | Meta | Skill validation → GitHub release → catalog update |
| `skill-firmware-differ` | Networking | Firmware upgrade runbooks with rollback plans |
| `skill-network-traffic-etl` | Analytics | Per-device traffic ETL — bandwidth, sites visited, categories → Grafana/InfluxDB/BigQuery |
| `skill-knowledge-harvester` | Meta | Extract conversation learnings into Knowledge Items |

## Architecture

```
┌─────────────────────────────────────────────────────┐
│ MCP Client (Antigravity / Claude / Cursor / etc.)   │
└───────────────┬─────────────────────────────────────┘
                │ stdio (JSON-RPC)
┌───────────────▼─────────────────────────────────────┐
│ server.ts  (v0.3.0)                                 │
│  ├─ island_list_devices  → devices.json             │
│  ├─ island_query (14 actions)                       │
│  │   ├─ status, interfaces, neighbors, routes       │
│  │   ├─ logs, config, config_diff, vpns             │
│  │   ├─ dhcp_reservations, speedtest, history, ntp  │
│  │   └─ command, ping                               │
│  └─ island_configure (9 actions)                    │
│      ├─ add_dhcp, remove_dhcp                       │
│      ├─ set_syslog (numeric 0-7), remove_syslog    │
│      ├─ set_hostname, set_auto_update               │
│      └─ set_led, set_timezone, set_ntp              │
└───────────────┬─────────────────────────────────────┘
                │ SSH (interactive shell)
┌───────────────▼─────────────────────────────────────┐
│ Island Router (2-context CLI: Global + Interface)   │
│  - Config commands work directly from global prompt │
│  - No `configure terminal` needed                   │
│  - `end` exits interface context only               │
└─────────────────────────────────────────────────────┘
```

## Data Flow

1. MCP client sends a tool call (e.g., `island_query` with `action: "neighbors"`)
2. `server.ts` dispatches to the appropriate handler function
3. Handler calls `openSession()` → establishes SSH interactive shell
4. `runCommand()` sends CLI commands, auto-dismisses pagers, waits for prompt
5. Raw output flows through a parser (e.g., `parseNeighbors()`) → structured JSON
6. `closeSession()` tears down SSH
7. JSON result returned to MCP client

**Config write flow:**
1. MCP client sends `island_configure` with `action`, params, and `confirmation_phrase`
2. Handler validates inputs (MAC, IP, etc.) before opening SSH
3. Config command issued **directly at global prompt** (no `configure terminal`)
4. `write memory` persists the change
5. Verification command confirms the result
6. Structured response returned

## Build & Run

```bash
npm install          # Install dependencies
npm run build        # Compile TypeScript → build/
npm run watch        # Compile in watch mode
npm start            # Run the MCP server
```
