# AGENTS.md

Orientation for AI coding agents working in **island-router-mcp**.

## Read first (in order)

1. **[`.agent/PREREQUISITES.md`](.agent/PREREQUISITES.md)** — build, credentials, SSH, Cursor/Claude/Antigravity wiring
2. **This file** — how to work here
3. [`REPOMAP.md`](REPOMAP.md) — layout, entrypoints, architecture
4. [`CODING-STANDARDS.md`](CODING-STANDARDS.md) — conventions + Island CLI gotchas
5. [`CHANGELOG.md`](CHANGELOG.md) — what changed recently

Deep references (load on demand via skills):

| Need | Skill / path |
| --- | --- |
| Agent shell CLI (`island-axi`) | `.agent/skills/island-axi/SKILL.md` or `skills/island-axi/SKILL.md` |
| AXI design principles | `.agent/skills/axi/SKILL.md` · [axi.md](https://axi.md/) |
| Full Island Router CLI (fw 2.3.2) | `.agent/skills/island-router-cli/SKILL.md` |
| MCP meta-tool patterns | `.agent/skills/skill-mcp-builder/SKILL.md` |

Skill roots: `.agent/skills/` (primary) and `.agents/skills/` (symlink — Codex/OpenCode compatible).

## Architecture: core + thin surfaces

```
island-axi (primary for agents)     MCP (optional adapter)
        └─────────────┬─────────────┘
                      ▼
                 src/core/          ← add router actions HERE
         (query.ts, configure.ts, session, validate)
                      │
        devices · islandSsh · parsers · allowedCommands
```

| Surface | Entrypoint | Role | Writes guarded by |
| --- | --- | --- | --- |
| **AXI CLI** | `island-axi` / `node build/cli/island-axi.js` | **Primary** agent interface (TOON) | `--confirm` |
| **MCP** | `node build/server.js` | Thin adapter for MCP-only hosts | `confirmation_phrase: "apply_change"` |

Shared core (`src/core/`):

- `query.ts` / `configure.ts` — all router actions (`dispatchQuery`, `dispatchConfigure`)
- `session.ts` / `validate.ts` / `syslog.ts`
- Plus `src/devices.ts`, `islandSsh.ts`, `parsers/*`, `allowedCommands.ts`

When you add a capability: implement once in `src/core/`, then wire MCP enums + AXI command presentation.

## Critical Island CLI rules (do not violate)

- **Not Cisco IOS.** Config commands run from the **global** prompt. Do **not** wrap with `configure terminal` / `end`.
- `end` only exits **interface** context.
- Syslog levels are **numeric 0–7**, never string names (`info`, `warning`).
- SSH must use interactive `shell()` + `terminal length 0` (see `islandSsh.ts`).
- Persist config with `write memory` after mutations.

## How to extend (decision tree)

```
New router capability?
├─ Read-only?
│  ├─ Parser in src/parsers/ (if structured)
│  ├─ Handler + dispatchQuery case in src/core/query.ts
│  ├─ MCP: add to QUERY_ACTIONS (server imports from core)
│  ├─ AXI: present in src/cli/commands/ + island-axi.ts + help.ts
│  └─ Allowlist: src/allowedCommands.ts if raw show
└─ Write?
   ├─ Handler + dispatchConfigure in src/core/configure.ts
   ├─ Validate in core/validate (before SSH)
   ├─ MCP: CONFIGURE_ACTIONS + confirmation_phrase
   ├─ AXI: configure <kebab> + --confirm presentation
   └─ Global prompt → write memory → verify
```

## Commands agents should run

```bash
npm install
npm run build          # required before running bins
npm test               # vitest unit tests
npm start              # MCP server (stdio)
node build/cli/island-axi.js          # AXI home (devices + help)
node build/cli/island-axi.js --help
```

Secrets: `devices.json` (gitignored) or `ROUTER_IP` + `ROUTER_PASS` / `ROUTER_KEY`. Never commit secrets.

## Definition of done (agent PRs)

- [ ] `npm run build` and `npm test` pass
- [ ] Action implemented in `src/core/` (not duplicated in MCP/CLI)
- [ ] MCP + AXI surfaces wired to the new core action
- [ ] Allowlist only in `src/allowedCommands.ts`
- [ ] No `configure terminal` in new config paths
- [ ] `CHANGELOG.md` updated under Unreleased or next version
- [ ] Action inventory in `CODING-STANDARDS.md` updated if actions added
- [ ] Skills updated if agent-facing usage changed (`island-axi` / `island-router-cli`)

## Prefer

- Small, focused diffs; reuse parsers and `withSession`
- AXI principles for CLI: TOON (via axi-sdk-js), minimal fields, truncation + `--full`, definitive empty states, contextual `help[]`
- Meta-tools on MCP (do not add a new top-level tool per action)

## Avoid

- Interactive prompts in CLI or MCP
- Logging passwords / writing secrets to stdout
- Silent unknown flags (fail loud)
- Duplicating allowlists or device loaders
