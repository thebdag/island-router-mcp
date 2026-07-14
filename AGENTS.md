# AGENTS.md

Orientation for AI coding agents working in **island-router-mcp**.

## Read first (in order)

1. **This file** — how to work here
2. [`REPOMAP.md`](REPOMAP.md) — layout, entrypoints, architecture
3. [`CODING-STANDARDS.md`](CODING-STANDARDS.md) — conventions + Island CLI gotchas
4. [`CHANGELOG.md`](CHANGELOG.md) — what changed recently

Deep references (load on demand via skills):

| Need | Skill / path |
| --- | --- |
| Agent shell CLI (`island-axi`) | `.agent/skills/island-axi/SKILL.md` or `skills/island-axi/SKILL.md` |
| AXI design principles | `.agent/skills/axi/SKILL.md` · [axi.md](https://axi.md/) |
| Full Island Router CLI (fw 2.3.2) | `.agent/skills/island-router-cli/SKILL.md` |
| MCP meta-tool patterns | `.agent/skills/skill-mcp-builder/SKILL.md` |

Skill roots: `.agent/skills/` (primary) and `.agents/skills/` (symlink — Codex/OpenCode compatible).

## Two surfaces (keep in sync)

| Surface | Entrypoint | Output | Writes guarded by |
| --- | --- | --- | --- |
| **MCP** | `node build/server.js` | JSON text in tool results | `confirmation_phrase: "apply_change"` |
| **AXI CLI** | `node build/cli/island-axi.js` / `island-axi` | TOON on stdout | `--confirm` |

Shared code:

- `src/devices.ts` — inventory
- `src/islandSsh.ts` — SSH shell sessions
- `src/parsers/*` — CLI text → typed data
- `src/allowedCommands.ts` — show-command allowlist (**single source of truth**)

When you add a capability, update **both** MCP and AXI unless the change is surface-specific.

## Critical Island CLI rules (do not violate)

- **Not Cisco IOS.** Config commands run from the **global** prompt. Do **not** wrap with `configure terminal` / `end`.
- `end` only exits **interface** context.
- Syslog levels are **numeric 0–7**, never string names (`info`, `warning`).
- SSH must use interactive `shell()` + `terminal length 0` (see `islandSsh.ts`).
- Persist config with `write memory` after mutations.

## How to extend (decision tree)

```
New router capability?
├─ Read-only show / parse?
│  ├─ Add parser in src/parsers/ (if structured)
│  ├─ MCP: new island_query action + handler in server.ts
│  ├─ AXI: new command under src/cli/commands/ + register in island-axi.ts + help.ts
│  ├─ Allowlist: edit src/allowedCommands.ts if exposing via show/command
│  └─ Docs: CODING-STANDARDS inventory, REPOMAP if architecture changes, CHANGELOG
└─ Write / config?
   ├─ Validate inputs before SSH
   ├─ MCP: island_configure action + confirmation_phrase
   ├─ AXI: configure <action> flags + --confirm
   ├─ Issue at global prompt → write memory → verify show
   └─ Docs + CHANGELOG as above
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
- [ ] MCP + AXI updated together when adding router ops
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
