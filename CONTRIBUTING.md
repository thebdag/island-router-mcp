# Contributing

This project is designed for humans and coding agents. Start with [`AGENTS.md`](AGENTS.md), then [`REPOMAP.md`](REPOMAP.md) and [`CODING-STANDARDS.md`](CODING-STANDARDS.md).

## Setup

```bash
npm install
cp devices.example.json devices.json   # then edit credentials
npm run build
npm test
```

## Surfaces

- **MCP server** — `npm start` → `build/server.js`
- **AXI CLI** — `node build/cli/island-axi.js` (bin: `island-axi`)

Router ops added to one surface should almost always land in the other. Shared allowlist: `src/allowedCommands.ts`.

## Docs to update with code

| Change | Update |
| --- | --- |
| New query/configure action | `CODING-STANDARDS.md` inventory, `CHANGELOG.md`, often `README.md` |
| New CLI command | `src/cli/help.ts`, `skills/island-axi/SKILL.md`, `.agent/skills/island-axi/SKILL.md` |
| Layout / architecture | `REPOMAP.md` |
| Agent workflow | `AGENTS.md` |

## Commits

[Conventional Commits](https://www.conventionalcommits.org/): `feat:`, `fix:`, `docs:`, `refactor:`, `chore:`, `test:`.

Never commit `devices.json`, `build/`, or secrets.
