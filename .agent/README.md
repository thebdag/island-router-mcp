# `.agent/` — agent workspace

Orientation for Cursor, Claude, Antigravity, Codex, and other coding agents.

## Start here

1. **[PREREQUISITES.md](./PREREQUISITES.md)** — Node build, `devices.json` / env credentials, SSH, smoke tests, MCP vs AXI wiring  
2. **[../AGENTS.md](../AGENTS.md)** — how to work in this repo  
3. **[skills/](./skills/)** — on-demand skills (`island-axi`, Island CLI, AXI principles, …)

`.agents/skills` → symlink to `skills/` for Codex/OpenCode-compatible roots.

## Preferred interface

Use **`island-axi`** for shell agents. MCP (`build/server.js`) is a thin adapter for MCP-only hosts. Both share `src/core/`.
