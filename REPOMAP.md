# Repository Map

> Quick orientation for developers and AI assistants working in this codebase.

## Project

**island-router-mcp** — An MCP server that exposes Island Router CLI operations as structured tools for AI assistants. Unofficial, not affiliated with Island Technology Inc.

**Stack:** TypeScript · Node.js 20+ · ESM · ssh2 · Zod · MCP SDK

## Directory Structure

```
island-router-mcp/                # Workspace root
├── .agent/
│   └── skills/                   # AI-readable skill references
│       ├── island-router-cli/    # CLI reference (firmware 2.3.2) & discovery tools
│       │   ├── SKILL.md          # Exhaustive CLI reference (canonical)
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
│   ├── server.ts                 # MCP server entrypoint — 3 meta-tools defined here
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
| `src/server.ts` | MCP server — all tool registration and dispatch logic | ✅ `node build/server.js` |
| `src/islandSsh.ts` | SSH session management — `openSession()`, `runCommand()`, `closeSession()` | |
| `src/parsers/*.ts` | Transform raw CLI text into typed objects | |
| `devices.json` | Runtime device inventory (not committed) | |
| `.agent/skills/island-router-cli/SKILL.md` | Canonical CLI reference — exhaustive, auto-discovered from live router | |
| `.agent/skills/island-router-cli/scripts/cli_discovery_results.json` | Full command tree (3,136 commands) — structured JSON | |
| `.agent/skills/island-router-cli/scripts/cli_discovery.py` | Recursive CLI crawler for re-running discovery | |

## Agent Skills

| Skill | Domain | Purpose |
|---|---|---|
| `island-router-cli` | Networking | Exhaustive CLI reference for Island Router firmware 2.3.2 — auto-discovered 3,136 commands, SNMP, tcpdump, DNS-over-HTTPS, VPN, event history |
| `skill-mcp-builder` | Development | Build MCP servers (TypeScript, Zod schemas, meta-tool patterns) |
| `skill-observability-pipeline` | DevOps | Syslog → Promtail → Loki → Grafana pipeline setup |
| `skill-finops-gcp` | Cloud | GCP billing queries, anomaly detection, budget alerts |
| `skill-meta-pipeline` | Meta | Orchestrate full skill lifecycle (create → publish) |
| `skill-network-fleet` | Networking | Multi-device config drift, compliance, backups |
| `skill-mcp-orchestrator` | Automation | Cross-MCP workflow recipes (Jira + Cloud Run + Confluence) |
| `skill-homelab-pi` | DevOps | Docker Compose, systemd hardening, Pi maintenance |
| `skill-publisher` | Meta | Skill validation → GitHub release → catalog update |
| `skill-firmware-differ` | Networking | Firmware upgrade runbooks with rollback plans |
| `skill-knowledge-harvester` | Meta | Extract conversation learnings into Knowledge Items |

## Architecture

```
┌─────────────────────────────────────────────────────┐
│ MCP Client (Antigravity / Claude / etc.)            │
└───────────────┬─────────────────────────────────────┘
                │ stdio (JSON-RPC)
┌───────────────▼─────────────────────────────────────┐
│ server.ts                                           │
│  ├─ island_list_devices  → devices.json             │
│  ├─ island_query         → islandSsh → parsers      │
│  └─ island_configure     → islandSsh → write memory │
└───────────────┬─────────────────────────────────────┘
                │ SSH (interactive shell)
┌───────────────▼─────────────────────────────────────┐
│ Island Router (Cisco-style CLI over SSH)            │
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

## Build & Run

```bash
npm install          # Install dependencies
npm run build        # Compile TypeScript → build/
npm run watch        # Compile in watch mode
npm start            # Run the MCP server
```
