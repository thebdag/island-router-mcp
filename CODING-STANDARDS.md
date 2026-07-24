# Coding Standards

Development conventions for the Island Router MCP Server + `island-axi` CLI.

> **Agent entry:** [`AGENTS.md`](AGENTS.md) · **Map:** [`REPOMAP.md`](REPOMAP.md)  
> **Canonical CLI reference:** `.agent/skills/island-router-cli/SKILL.md` (fw 2.3.2)

---

## Language & Runtime

- **TypeScript** with `strict: true` — no implicit `any`, no unchecked nulls.
- **Node.js 20+** with ESM (`"type": "module"` in package.json).
- **Module resolution**: `NodeNext` — all local imports must use `.js` extensions.
- **Target**: `ES2022` — use modern syntax (`??`, `?.`, `using`, top-level await).

## Project Structure

```
src/
  core/                 # ★ Shared router actions (source of truth)
  server.ts             # Thin MCP adapter — meta-tools only
  devices.ts            # Shared device inventory loader
  allowedCommands.ts    # Shared show allowlist
  islandSsh.ts          # SSH session lifecycle — no business logic
  cli/                  # island-axi presentation (TOON, help, flags)
  parsers/              # Pure CLI → typed data
```

- **core/** — implement new router ops here (`dispatchQuery` / `dispatchConfigure`).
- **server.ts** — MCP schemas + call into core; no SSH/business logic.
- **cli/** — flag parsing, truncation, `help[]`; call core via `callCore()`.
- **Parsers** — pure `(raw: string) => StructuredType[]`. No SSH / I/O imports.
- **islandSsh.ts** — connection + command execution only.
- **allowedCommands.ts** — edit here only.

## Naming Conventions

| Thing | Convention | Example |
|---|---|---|
| Files | `camelCase.ts` | `islandSsh.ts` |
| Parser files | `camelCase.ts` in `parsers/` | `parsers/interfaces.ts` |
| CLI command files | `camelCase.ts` in `cli/commands/` | `cli/commands/dnsRedirects.ts` |
| Functions | `camelCase` | `parseNeighbors()` |
| Interfaces/Types | `PascalCase` | `DeviceConfig`, `ShellSession` |
| Constants | `UPPER_SNAKE_CASE` | `ALLOWED_SHOW_COMMANDS` |
| MCP tool names | `snake_case` prefixed with `island_` | `island_query` |
| MCP / configure actions | `snake_case` | `add_dhcp`, `set_syslog` |
| AXI CLI commands | `kebab-case` | `config-diff`, `dns-redirects`, `add-dhcp` |

## Dual-surface extension playbook

Every new router capability should land on **both** surfaces unless intentionally MCP-only or CLI-only (document why in the PR).

### Adding a read (query) action

1. Parser in `src/parsers/` if structured.
2. Handler + `QUERY_ACTIONS` / `dispatchQuery` case in **`src/core/query.ts`**.
3. MCP picks up the action via `z.enum(QUERY_ACTIONS)` in `server.ts` (no duplicate handler).
4. AXI: presentation command in `src/cli/commands/`, register in `island-axi.ts` + `help.ts`.
5. Raw show allowlist: `src/allowedCommands.ts` only.
6. Update inventories, `CHANGELOG.md`, skills if UX changed.
7. AXI defaults: 3–4 fields, `count`, definitive empty states, `help[]`, `--full`.

### Adding a write (configure) action

1. Validate in **`src/core/validate.ts`** before SSH.
2. Handler + `CONFIGURE_ACTIONS` / `dispatchConfigure` in **`src/core/configure.ts`**.
3. MCP: confirmation_phrase only in `server.ts`; dispatch into core.
4. AXI: `configure <kebab-action>` flags + `--confirm`, map to snake_case core action.
5. Global prompt → `write memory` → verify show.
6. Prefer idempotent re-apply → success where the router allows it.
7. Update inventories, changelog, skills as above.

### AXI CLI checklist ([axi.md](https://axi.md/))

- [ ] TOON via `axi-sdk-js` (do not print ad-hoc JSON to stdout)
- [ ] Unknown flags → `AxiError` / exit 2 with valid-flag list
- [ ] Empty results → explicit `0 … found` message
- [ ] Large bodies → truncate + `--full` hint
- [ ] Mutations → `--confirm` only (never interactive)
- [ ] Per-command `--help` text in `help.ts`

## MCP Tool Design

### Meta-Tool Pattern

Tools are consolidated into as few MCP tool definitions as possible to reduce token overhead:

1. **`island_list_devices`** — no parameters, no SSH, kept separate for zero-cost discovery.
2. **`island_query`** — all read-only operations, dispatched by `action` enum.
3. **`island_configure`** — all write operations, dispatched by `action` enum, guarded.

When adding a new operation:
- **Read-only?** Add to `QUERY_ACTIONS` + handler in `src/core/query.ts`.
- **Write?** Add to `CONFIGURE_ACTIONS` + handler in `src/core/configure.ts`.
- **Do not** put SSH/business logic in `server.ts` or duplicate it in CLI commands.
- **Do not** register a new top-level `server.tool()` unless the schema shape is fundamentally different.

### Current Action Inventory

**Query actions** (15 total):

| Action | Core handler (`src/core/`) | Description |
|---|---|---|
| `status` | `queryStatus()` | Full overview (7 show commands) |
| `interfaces` | `queryInterfaces()` | Parsed interface data (detail flag for TX/RX) |
| `neighbors` | `queryNeighbors()` | Parsed ARP table |
| `routes` | `queryRoutes()` | Parsed routing table |
| `logs` | `queryLogs()` | Parsed log entries + syslog config |
| `config` | `queryConfig()` | Full running-config text |
| `config_diff` | `queryConfigDiff()` | Running vs startup config diff |
| `vpns` | `queryVpns()` | VPN peer status |
| `dhcp_reservations` | `queryDhcpReservations()` | DHCP reservations (CSV) |
| `speedtest` | `querySpeedtest()` | Speed test history |
| `history` | `queryHistory()` | Event history (JSON, with `time` param) |
| `ntp` | `queryNtp()` | NTP config + status + associations |
| `dns_redirects` | `queryDnsRedirects()` | DNS redirect rules (hostname → server) |
| `command` | `queryCommand()` | Any allowlisted show command |
| `ping` | `queryPing()` | ICMP ping from router |

**Configure actions** (13 total):

| Action | Core handler (`src/core/`) | Description |
|---|---|---|
| `add_dhcp` | `configAddDhcp()` | Add DHCP reservation |
| `remove_dhcp` | `configRemoveDhcp()` | Remove DHCP reservation |
| `set_syslog` | `configSyslog()` | Configure syslog (numeric level 0-7) |
| `remove_syslog` | `configRemoveSyslog()` | Remove syslog server |
| `set_hostname` | `configHostname()` | Set router hostname |
| `set_auto_update` | `configAutoUpdate()` | Set update days + time |
| `update` | `configUpdate()` | Check/install firmware (`update [<url>]`) — no write memory |
| `clear_update` | `configClearUpdate()` | Clear stuck/incomplete update — no write memory |
| `set_led` | `configLed()` | Set LED brightness (0-100) |
| `set_timezone` | `configTimezone()` | Set timezone |
| `set_ntp` | `configNtp()` | Set NTP server |
| `add_dns_redirect` | `configAddDnsRedirect()` | Add DNS redirect / block hostname |
| `remove_dns_redirect` | `configRemoveDnsRedirect()` | Remove DNS redirect for a domain |

### AXI CLI command inventory

| Command | Notes |
|---|---|
| `(home)` / `devices` | Inventory, no SSH |
| `status` | Aggregates (up/down counts) |
| `interfaces` | `--detail`, `--fields`, `--limit` |
| `neighbors` / `routes` | Minimal fields + count |
| `logs` / `config` / `config-diff` | Truncation + `--full` |
| `vpns` / `dhcp` / `ntp` / `dns-redirects` | Structured lists |
| `ping` / `show` | Diagnostics / allowlisted show |
| `configure` | Writes; requires `--confirm` |
| `setup hooks` | Ambient SessionStart integration |

### Write Safety

All write tools must:
1. Require `confirmation_phrase: z.literal("apply_change")` (MCP) or `--confirm` (AXI).
2. Validate all user-supplied values (MAC, IP, hostnames) before sending to the router.
3. Issue config commands **directly at the global prompt** — do NOT use `configure terminal` or `end`.
4. Call `write memory` after applying **configuration** changes. Exceptions: `update` / `clear_update` (firmware lifecycle, not running-config).
5. Return verification output (e.g., `show ip dhcp-reservations` after adding a reservation; `show version` after `update`).

### Error Handling

- MCP: throw descriptive `Error` objects — the MCP SDK serializes them to the client.
- AXI: throw `AxiError` with code + suggestions (stdout structured error).
- Validate inputs early (before opening SSH sessions).
- Use `withSession()` to guarantee `closeSession()` runs even on errors.

## Island Router CLI Model

> ⚠️ **The Island Router is NOT Cisco IOS.** Key differences from Cisco:

| Aspect | Cisco IOS | Island Router |
|---|---|---|
| Configuration entry | `configure terminal` required | Config commands work from global prompt |
| CLI modes | EXEC → Config → Interface Config | Global context + Interface context only |
| `end` command | Returns from config to EXEC | Exits interface context to global |
| `configure terminal` | Enters config mode | Accepted but **unnecessary** |
| Syslog level | String names (`info`, `warning`) | **Numeric 0-7** (0=critical, 7=verbose) |

**Rules for config handlers:**
- **Do NOT** wrap commands in `configure terminal` → `end`. Issue commands directly.
- **Do NOT** assume separate EXEC/config mode prompts beyond interface context.
- The `interface <name>` command enters interface context; `end` returns to global.

## SSH Client Rules

1. **Always use `shell()`** — never `exec()`. The Island Router CLI is stateful.
2. **Always send `terminal length 0`** after connecting to disable the pager.
3. **Always use `withSession()`** wrapper in tool handlers for cleanup guarantees.
4. **Pager handling**: `runCommand()` auto-dismisses `--More--` prompts. If you add new pager strings, update `PAGER_PROMPTS` in `islandSsh.ts`.
5. **Prompt detection**: The `PROMPT_RE` regex matches `Router#`, `Router(config)#`, etc. Update it if the hostname changes.
6. **Rate-limiting**: The router enforces strict SSH rate-limiting after failed authentication attempts. If connections start failing with auth errors, wait 60+ seconds before retrying.
7. **Password quoting**: Router passwords may contain special characters (`!`, `@`, `^`, `&`). In `.env` files, wrap them in single quotes.

## CLI Syntax Corrections

> Verified against the official CLI Reference Guide (firmware 2.3.2).

| What was assumed | What the router actually accepts |
|---|---|
| `syslog server <IP> <port>` | `syslog server <IP>:<port>` (colon separator) |
| `syslog level info` | `syslog level <0-7>` (numeric severity, not keyword) |
| `led level <0-3>` | `led level <0-100>` (percentage, not level) |
| `auto-update schedule <cron>` | `auto-update days <day>...` + `auto-update time <hh:mm>` |
| `update check` / read-only update probe | `update` (checks for newer firmware and installs if found; optional `[<url>]`) |
| `show update` | (none) — use `show version` / `show version history`; availability check is `update` |
| `ip dns mode manual` | `ip dns mode recursive` or `https <name>` or `dnssec` |
| `configure terminal` required for config | Config commands work from any context |
| `end` returns from config to EXEC | `end` exits interface context to global |

## Parsers

- Each parser takes a `string` (raw CLI output) and returns a typed array or object.
- Parsers must be **resilient** — skip unparseable lines rather than throwing.
- Export both the parser function and its return type.
- Prefer unit tests under `test/` for non-trivial parse rules.

## Code Style

- Use `const` by default; `let` only when reassignment is needed.
- Prefer `for...of` over `.forEach()`.
- Prefer explicit returns over implicit.
- String interpolation with template literals, not concatenation.
- Trailing commas in multi-line arrays, objects, and parameters.
- Use `as const` for literal type assertions.
- Extract validators into shared helper functions (e.g., `validateMac()`, `validateIp()`).

## Documentation hygiene

When changing behavior, update the matching docs in the same PR:

| Artifact | Update when |
|---|---|
| `CHANGELOG.md` | Any user/agent-visible change |
| `CODING-STANDARDS.md` | Actions, allowlist policy, CLI model |
| `REPOMAP.md` | Layout, entrypoints, architecture |
| `AGENTS.md` | Workflow / definition of done |
| `README.md` | Public usage / tool tables |
| `skills/island-axi` + `.agent/skills/island-axi` | CLI UX for agents |
| `.agent/skills/island-router-cli` | Official CLI semantics |

Keep `.agent/skills/island-axi/SKILL.md` and `skills/island-axi/SKILL.md` identical.

## Git Conventions

- **Branch**: `main` (no develop branch for now).
- **Commits**: [Conventional Commits](https://www.conventionalcommits.org/) — `feat:`, `fix:`, `refactor:`, `docs:`, `chore:`, `test:`.
- **Never commit**: `devices.json`, `build/`, `node_modules/`, `.DS_Store`.
- **Always commit**: `package-lock.json`.

## Dependencies

- Keep dependencies minimal. Current stack:
  - `@modelcontextprotocol/sdk` — MCP protocol
  - `axi-sdk-js` — AXI CLI runner / TOON / hooks
  - `ssh2` — SSH client
  - `zod` — schema validation
  - `dotenv` — `.env` for local development
- Avoid HTTP frameworks, ORMs, or utility libraries unless strictly necessary.
- Pin major versions in `package.json` (e.g., `^1.18.0`, not `*`).

## Environment Variables

| Variable | Purpose | Default |
|---|---|---|
| `ISLAND_DEVICE_INVENTORY` | Path to `devices.json` | `./devices.json` |
| `ROUTER_PASS` | Fallback password (when no key auth) — quote if contains `!^&@` | — |
| `ROUTER_IP` | Fallback host (preferred) | `192.168.2.1` |
| `ROUTER_HOST` | Fallback host (legacy alias) | `192.168.2.1` |
| `ROUTER_KEY` | SSH private key content | — |
| `ROUTER_PORT` | Fallback port | `22` |
| `ROUTER_USER` | Fallback username | `admin` |
| `ISLAND_DEVICE_ID` | Fallback device ID | `island-default` |

`ROUTER_IP` takes precedence over `ROUTER_HOST`. Never hardcode or log secrets.

## Extending the Command Allowlist

Edit **`src/allowedCommands.ts` only** (MCP `command` + AXI `show`):

1. Only read-only `show` commands — never `clear`, `write`, `reload`, etc.
2. Prefix matching: `"show log"` also permits `"show log kernel"`, etc.
3. See `.agent/skills/island-router-cli/SKILL.md` for available show subcommands.

### Discovered Capabilities Not Yet Exposed as Actions

| Feature | Show Command | Config Command | Notes |
|---|---|---|---|
| SNMP | `show snmp` | `snmp-server community/host/user` | SNMPv1/v2c/v3 |
| Packet capture | — | `tcpdump interface <name> filter <spec>` | Live BPF capture |
| DNS over HTTPS | — | `ip dns mode https cloudflare\|google\|opendns` | Encrypted DNS |
| Port forwarding | — | `ip port-forward tcp\|udp [pub-ip:]port target` | DNAT rules |
| VPN peer mgmt | `show vpns` | `vpn peer <id> remote-ip/shutdown/visible` | WireGuard peers |
| History instances | `show history` | `history <name> interval/filter/url` | Automated ETL |
| Backup config | — | `backup url/interval/days` | Scheduled backup |
