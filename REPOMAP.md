# Repository Map

> Quick orientation for developers and AI assistants working in this codebase.

## Project

**island-router-mcp** — An MCP server that exposes Island Router CLI operations as structured tools for AI assistants. Unofficial, not affiliated with Island Technology Inc.

**Stack:** TypeScript · Node.js 20+ · ESM · ssh2 · Zod · MCP SDK

## Directory Structure

```
island-router-mcp/
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
│
├── .agent/
│   └── skills/
│       └── island-router-cli/
│           └── SKILL.md          # CLI reference skill (firmware 2.3.2)
│
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
|---|---|---|
| `src/server.ts` | MCP server — all tool registration and dispatch logic | ✅ `node build/server.js` |
| `src/islandSsh.ts` | SSH session management — `openSession()`, `runCommand()`, `closeSession()` | |
| `src/parsers/*.ts` | Transform raw CLI text into typed objects | |
| `devices.json` | Runtime device inventory (not committed) | |
| `.agent/skills/island-router-cli/SKILL.md` | AI-readable CLI command reference | |

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
