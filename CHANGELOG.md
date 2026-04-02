# Changelog

All notable changes to the Island Router MCP Server will be documented in this file.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), versioned per [Semantic Versioning](https://semver.org/).

---

## [0.3.0] — 2026-04-01

### Changed
- **SKILL.md**: Complete rewrite with exhaustive CLI reference auto-discovered from live router (3,136 commands across EXEC and CONFIG modes). Added SNMP, tcpdump, speed test, event history format specifiers, DNS-over-HTTPS providers, and VPN server configuration sections.
- **Syslog syntax fix**: Changed `syslog server <IP> <port>` to `syslog server <IP>:<port>` — the router uses a colon separator, not a space.
- **Expanded show command allowlist**: Added `show speedtest`, `show config email` to `ALLOWED_SHOW_COMMANDS` in `server.ts`.
- **CODING-STANDARDS.md**: Added SSH rate-limiting guidance, password quoting rules, CLI syntax corrections table, `dotenv` dependency docs, `ROUTER_IP`/`ROUTER_KEY` env var documentation, and a "Discovered Capabilities Not Yet Exposed" roadmap section.
- **REPOMAP.md**: Restructured to show parent workspace (`island-router-cli/`) with discovery scripts alongside `island-mcp-server/`. Added discovery data files to Key Files table.
- **README.md**: Expanded environment variables documentation (`ROUTER_IP`, `ROUTER_KEY`, `ROUTER_HOST`), added CLI discovery reference and troubleshooting section for SSH rate-limiting and password quoting.

### Fixed
- `configSyslog()` in `server.ts` now uses colon-separated `IP:port` format for the `syslog server` command, matching the router's actual CLI syntax.
- Added `ROUTER_IP` as preferred alias for `ROUTER_HOST` in env var documentation.

## [0.2.0] — 2025-04-01

### Changed
- **Meta-tool architecture**: Consolidated 13 individual tools into 3 meta-tools (`island_list_devices`, `island_query`, `island_configure`) to reduce token overhead by ~80%.
- `island_query` dispatches via `action` enum: `status`, `interfaces`, `neighbors`, `routes`, `logs`, `config`, `vpns`, `command`, `ping`.
- `island_configure` dispatches via `action` enum: `add_dhcp`, `remove_dhcp`, `set_syslog`.
- Bumped server version to `0.2.0`.
- Updated README to document meta-tool pattern and rationale.

## [0.1.0] — 2025-04-01

### Added
- Initial release of the Island Router MCP server.
- **SSH client** (`islandSsh.ts`): Interactive shell sessions via ssh2's `shell()` (not `exec()`), with pager auto-dismiss, prompt detection, and session lifecycle management.
- **Parsers**: Structured JSON extraction from CLI output for interfaces, routes, neighbors, logs, and syslog config.
- **13 MCP tools**: `island_list_devices`, `island_show_status`, `island_show_interfaces`, `island_show_neighbors`, `island_show_routes`, `island_show_logs`, `island_show_config`, `island_show_vpns`, `island_run_command`, `island_ping`, `island_add_dhcp_reservation`, `island_remove_dhcp_reservation`, `island_configure_syslog`.
- **Safety**: Write operations guarded by `confirmation_phrase: "apply_change"`, allowlisted show commands, input validation for MAC/IP, shell metacharacter rejection.
- **Device inventory**: JSON-based multi-device config with password and SSH key auth support, env-var fallback.
- **Agent skill**: `.agent/skills/island-router-cli/SKILL.md` — comprehensive CLI reference for firmware 2.3.2.
- **Antigravity integration**: `mcp_config.json` entry for stdio transport.
