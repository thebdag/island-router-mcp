# Repository Map

> Agent/human orientation. For workflow rules see [`AGENTS.md`](AGENTS.md).

## Project

**island-router-mcp** — Unofficial MCP server + AXI CLI for Island Router (fw 2.3.2). Not affiliated with Island Technology Inc.

| | |
| --- | --- |
| Stack | TypeScript · Node 20+ · ESM · ssh2 · Zod · MCP SDK · axi-sdk-js |
| Surfaces | MCP (`island-mcp-server`) · AXI CLI (`island-axi`) |
| Agent docs | `AGENTS.md` → this file → `CODING-STANDARDS.md` → `CHANGELOG.md` |
| Skills | `.agent/skills/` (also `.agents/skills/` symlink) |

## Directory Structure

```
island-router-mcp/
├── AGENTS.md / CLAUDE.md     # Agent entrypoints
├── CONTRIBUTING.md
├── REPOMAP.md                # ← You are here
├── CODING-STANDARDS.md
├── CHANGELOG.md
├── README.md
│
├── .agent/skills/            # Primary skill tree (Cursor / Antigravity)
├── .agents/skills/           # → symlink to ../.agent/skills (Codex / OpenCode)
├── skills/island-axi/        # Installable AXI skill (npx skills add …)
│
├── src/
│   ├── server.ts             # MCP: 3 meta-tools
│   ├── devices.ts            # Shared inventory
│   ├── allowedCommands.ts    # Shared show allowlist (edit once)
│   ├── islandSsh.ts          # SSH interactive shell
│   ├── cli/                  # island-axi (AXI)
│   │   ├── island-axi.ts
│   │   ├── home.ts, help.ts, args.ts, format.ts, session.ts
│   │   └── commands/         # One file per noun/command
│   └── parsers/              # Pure CLI → typed data
│       ├── interfaces.ts, routes.ts, logs.ts, dhcp.ts
│       ├── vpn.ts, ntp.ts, system.ts, dnsRedirects.ts
│
├── test/                     # vitest (no live router required)
├── devices.example.json
├── devices.json              # gitignored
├── package.json              # bins: island-mcp-server, island-axi
└── build/                    # tsc output (gitignored)
```

## Entrypoints

| File | Role | Run |
| --- | --- | --- |
| `src/server.ts` | MCP meta-tools | `npm start` / `node build/server.js` |
| `src/cli/island-axi.ts` | AXI CLI | `node build/cli/island-axi.js` |
| `src/devices.ts` | Inventory load | imported |
| `src/allowedCommands.ts` | Show allowlist | imported |
| `src/islandSsh.ts` | SSH session | imported |
| `src/parsers/*.ts` | Output parsers | imported |

## Architecture (dual surface)

```
┌──────────────────────┐     ┌──────────────────────┐
│ MCP client (stdio)   │     │ Agent shell (AXI)    │
│ island_query /       │     │ island-axi <cmd>     │
│ island_configure     │     │ TOON stdout          │
└──────────┬───────────┘     └──────────┬───────────┘
           │                            │
           └────────────┬───────────────┘
                        ▼
              devices.ts + parsers + allowedCommands
                        │
                        ▼
                   islandSsh.ts
                        │
                        ▼
         Island Router (Global + Interface contexts)
         Config at global prompt · write memory · no conf t
```

### MCP (v0.4.0)

| Tool | Role |
| --- | --- |
| `island_list_devices` | Inventory, no SSH |
| `island_query` | 15 read actions (status … ping, dns_redirects) |
| `island_configure` | 11 write actions; requires `confirmation_phrase=apply_change` |

### AXI CLI

| Command | Role |
| --- | --- |
| (none) / `devices` | Content-first inventory + help |
| `status` … `show` | Reads with minimal schemas / truncation |
| `configure … --confirm` | Writes |
| `setup hooks` | SessionStart ambient context |

Full action tables: `CODING-STANDARDS.md`.

## Skills catalog

| Skill | When to load |
| --- | --- |
| `island-axi` | Using/extending the AXI CLI |
| `axi` | Designing agent-ergonomic CLI output |
| `island-router-cli` | Exact Island CLI syntax (fw 2.3.2) |
| `skill-mcp-builder` | MCP schema / meta-tool patterns |
| `skill-network-fleet` | Multi-device drift / backups |
| `skill-firmware-differ` | Firmware upgrade runbooks |
| `skill-network-traffic-etl` | Traffic ETL pipelines |
| `skill-observability-pipeline` | Syslog → Grafana |
| `skill-homelab-pi` | Pi / Docker host ops |
| `skill-finops-gcp` | GCP cost |
| `skill-mcp-orchestrator` | Cross-MCP workflows |
| `skill-meta-pipeline` / `skill-knowledge-harvester` | Skill lifecycle / KI extraction |

Index: `.agent/skills/README.md`.

## Data flow

**Read:** tool/CLI → `openSession` → `runCommand` → parser → JSON/TOON → `closeSession`

**Write:** validate → global-prompt config cmd → `write memory` → verify show → structured result

## Extend checklist (summary)

1. Parser (if needed) in `src/parsers/`
2. MCP handler + action enum in `server.ts`
3. AXI command in `src/cli/commands/` + `island-axi.ts` + `help.ts`
4. Allowlist only via `src/allowedCommands.ts`
5. Update `CODING-STANDARDS.md` inventory, `CHANGELOG.md`, skills if UX changed
6. `npm run build && npm test`

See `AGENTS.md` for the full decision tree and definition of done.

## Build & Run

```bash
npm install && npm run build
npm test
npm start
node build/cli/island-axi.js
```
