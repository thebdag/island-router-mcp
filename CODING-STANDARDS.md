# Coding Standards

Development conventions for the Island Router MCP Server.

> **Canonical CLI reference:** See `SKILL.md` at the repo root for the exhaustive command
> reference (auto-discovered 2026-04-01, 3,136 commands across EXEC and CONFIG modes).

---

## Language & Runtime

- **TypeScript** with `strict: true` — no implicit `any`, no unchecked nulls.
- **Node.js 20+** with ESM (`"type": "module"` in package.json).
- **Module resolution**: `NodeNext` — all local imports must use `.js` extensions.
- **Target**: `ES2022` — use modern syntax (`??`, `?.`, `using`, top-level await).

## Project Structure

```
src/
  server.ts           # Tool registration only — dispatch to handler functions
  islandSsh.ts        # SSH session lifecycle — no business logic
  parsers/            # One file per CLI output domain — pure functions, no I/O
```

- **server.ts** should contain tool registration and action dispatch only. Handler logic lives in standalone `async` functions above the tool definitions.
- **Parsers** are pure functions: `(raw: string) => StructuredType[]`. They must not import SSH modules or perform I/O.
- **islandSsh.ts** handles connection, command execution, and output cleaning. It should not import parsers or server code.

## Naming Conventions

| Thing | Convention | Example |
|---|---|---|
| Files | `camelCase.ts` | `islandSsh.ts` |
| Parser files | `camelCase.ts` in `parsers/` | `parsers/interfaces.ts` |
| Functions | `camelCase` | `parseNeighbors()` |
| Interfaces/Types | `PascalCase` | `DeviceConfig`, `ShellSession` |
| Constants | `UPPER_SNAKE_CASE` | `ALLOWED_SHOW_COMMANDS` |
| MCP tool names | `snake_case` prefixed with `island_` | `island_query` |
| Action enums | `snake_case` | `add_dhcp`, `set_syslog` |

## MCP Tool Design

### Meta-Tool Pattern

Tools are consolidated into as few MCP tool definitions as possible to reduce token overhead:

1. **`island_list_devices`** — no parameters, no SSH, kept separate for zero-cost discovery.
2. **`island_query`** — all read-only operations, dispatched by `action` enum.
3. **`island_configure`** — all write operations, dispatched by `action` enum, guarded.

When adding a new operation:
- **Read-only?** Add a new action to `QueryActions` enum and a handler function.
- **Write?** Add a new action to `ConfigureActions` enum and a handler function.
- **Do not** register a new top-level `server.tool()` unless it has a fundamentally different schema shape.

### Write Safety

All write tools must:
1. Require `confirmation_phrase: z.literal("apply_change")` as a parameter.
2. Validate all user-supplied values (MAC, IP, hostnames) before sending to the router.
3. Call `write memory` after applying changes.
4. Return verification output (e.g., `show ip dhcp-reservations` after adding a reservation).

### Error Handling

- Throw descriptive `Error` objects — the MCP SDK serializes them to the client.
- Validate inputs early (before opening SSH sessions).
- Use `withSession()` to guarantee `closeSession()` runs even on errors.

## SSH Client Rules

1. **Always use `shell()`** — never `exec()`. The Island Router CLI is stateful.
2. **Always send `terminal length 0`** after connecting to disable the pager.
3. **Always use `withSession()`** wrapper in tool handlers for cleanup guarantees.
4. **Pager handling**: `runCommand()` auto-dismisses `--More--` prompts. If you add new pager strings, update `PAGER_PROMPTS` in `islandSsh.ts`.
5. **Prompt detection**: The `PROMPT_RE` regex matches `Router#`, `Router(config)#`, etc. Update it if the hostname changes.
6. **Rate-limiting**: The router enforces strict SSH rate-limiting after failed authentication attempts. If connections start failing with auth errors, wait 60+ seconds before retrying. Consider implementing exponential backoff in long-running scripts.
7. **Password quoting**: Router passwords may contain special characters (`!`, `@`, `^`, `&`). In `.env` files, wrap them in single quotes. In shell exports, escape appropriately.

## CLI Syntax Corrections

> These corrections were verified against the live router's `?` help system on 2026-04-01.

| What the docs said | What the router actually accepts |
|---|---|
| `syslog server <IP> <port>` | `syslog server <IP>:<port>` (colon separator) |
| `syslog level info` | `syslog level <n>` (numeric severity, not keyword) |
| `led level <0-3>` | `led level <0-100>` (percentage, not level) |
| `auto-update schedule <cron>` | `auto-update days <day>...` + `auto-update time <hh:mm>` |
| `ip dns mode manual` | `ip dns mode recursive` or `ip dns mode https <name>` or `ip dns mode dnssec` |

## Parsers

- Each parser function takes a `string` (raw CLI output) and returns a typed array or object.
- Parsers must be **resilient** — they should skip lines they can't parse rather than throwing.
- Export both the parser function and its return type.
- Test parsers against real CLI output samples when available.

## Code Style

- Use `const` by default; `let` only when reassignment is needed.
- Prefer `for...of` over `.forEach()`.
- Prefer explicit returns over implicit.
- String interpolation with template literals, not concatenation.
- Trailing commas in multi-line arrays, objects, and parameters.
- Use `as const` for literal type assertions.

## Git Conventions

- **Branch**: `main` (no develop branch for now).
- **Commits**: [Conventional Commits](https://www.conventionalcommits.org/) — `feat:`, `fix:`, `refactor:`, `docs:`, `chore:`.
- **Never commit**: `devices.json`, `build/`, `node_modules/`, `.DS_Store`.
- **Always commit**: `package-lock.json`.

## Dependencies

- Keep dependencies minimal. Current stack:
  - `@modelcontextprotocol/sdk` — MCP protocol implementation
  - `ssh2` — SSH client
  - `zod` — schema validation
  - `dotenv` — loads `.env` file for local development (import via `import "dotenv/config"` at top of `server.ts`)
- Avoid adding HTTP frameworks, ORMs, or utility libraries unless strictly necessary.
- Pin major versions in `package.json` (e.g., `^1.18.0`, not `*`).

## Environment Variables

| Variable | Purpose | Default |
|---|---|---|
| `ISLAND_DEVICE_INVENTORY` | Path to `devices.json` | `./devices.json` |
| `ROUTER_PASS` | Fallback password (when no key auth) — quote if contains `!^&@` | — |
| `ROUTER_IP` | Fallback host (preferred alias, when no `devices.json`) | `192.168.2.1` |
| `ROUTER_HOST` | Fallback host (legacy alias for `ROUTER_IP`) | `192.168.2.1` |
| `ROUTER_KEY` | SSH private key content for key-based auth (no file path needed) | — |
| `ROUTER_PORT` | Fallback port | `22` |
| `ROUTER_USER` | Fallback username | `admin` |
| `ISLAND_DEVICE_ID` | Fallback device ID | `island-default` |

> **Note:** `ROUTER_IP` takes precedence over `ROUTER_HOST`. Either can be used, but `ROUTER_IP` is preferred.

Never hardcode secrets. Never log passwords.

## Extending the Command Allowlist

The `ALLOWED_SHOW_COMMANDS` array in `server.ts` controls which commands the `command` action
will execute. When adding new commands:

1. Only add read-only `show` commands — never `clear`, `write`, `reload`, etc.
2. The allowlist uses prefix matching: `"show log"` also permits `"show log kernel"`, `"show log priority warning"`, etc.
3. Refer to the exhaustive command reference in `SKILL.md` for the complete list of available `show` subcommands.

### Discovered Capabilities Not Yet Exposed as Actions

The following router features were discovered during CLI exploration and may warrant new
`QueryActions` or `ConfigureActions` in the future:

| Feature | Show Command | Config Command | Notes |
|---|---|---|---|
| SNMP | `show snmp` | `snmp-server community/host/user` | SNMPv1/v2c/v3 |
| Packet capture | — | `tcpdump interface <name> filter <spec>` | Live BPF capture |
| Speed test | `show speedtest` | `speedtest interface <name>` | Run & view results |
| DNS over HTTPS | — | `ip dns mode https cloudflare\|google\|opendns` | Encrypted DNS |
| Event history | `show history begin <time> first json:` | — | Structured JSON output |
| Config diff | `show running-config differences` | — | Running vs startup diff |
