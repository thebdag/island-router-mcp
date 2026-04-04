# Changelog

All notable changes to the Island Router MCP Server will be documented in this file.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), versioned per [Semantic Versioning](https://semver.org/).

---

## [0.3.0] — 2026-04-03

### Added
- **5 new query actions** in `island_query`:
  - `dhcp_reservations` — DHCP reservations in parse-friendly CSV format
  - `speedtest` — speed test history
  - `history` — event history in JSON format with `time` parameter for range (e.g., `1h`, `1d`, `1w`)
  - `config_diff` — side-by-side running vs startup config diff
  - `ntp` — full NTP status (config + sync status + associations)
- **6 new configure actions** in `island_configure`:
  - `set_hostname` — set router hostname
  - `set_auto_update` — configure auto-update schedule (days + time)
  - `set_led` — set LED brightness (0-100)
  - `set_timezone` — set system timezone
  - `set_ntp` — set NTP server address
  - `remove_syslog` — remove syslog server configuration
- **9 new show commands** added to `ALLOWED_SHOW_COMMANDS`:
  - `show version history`, `show running-config differences`, `show ntp associations`, `show ntp status`, `show packages detail`, `show interface transceivers diagnostics`, `show ip recommendations`, `show ssh-client-keys detail`, `show config email`
- **Syslog level reference table** in SKILL.md (numeric 0-7 with descriptions)
- **History Instance Management** section in SKILL.md — full ETL export documentation (`history <instance> interval/filter/output-format/url`)
- **Default values table** in SKILL.md from official guide (DHCP lease 1800s, backup interval 3600s, VPN port 51820, LED level 100, etc.)
- Input validation helpers: `validateMac()`, `validateIp()`, `validateSafe()`

### Changed
- **SKILL.md**: Complete rewrite aligned with official 260-page CLI Reference Guide (firmware 2.3.2):
  - CLI mode model corrected from 4-level Cisco hierarchy to **2 contexts** (Global + Interface)
  - All `configure terminal` references removed from documentation and automation examples
  - `end` documented as exiting **interface context** (not config mode)
  - Device fingerprinting (`ip ident4/6`) clarified as SSDP/mDNS-based
  - DNS over HTTPS limitation documented (Island does NOT intercept DoH)
  - `show log` syntax expanded with all 10 combining options; `where` supports regex
  - VPN peer sub-commands documented (remote-ip, local-ip, route, shutdown, unapproved, visible)
- **server.ts**: Removed `configure terminal` / `end` calls from all 3 existing config handlers (`configAddDhcp`, `configRemoveDhcp`, `configSyslog`) — config commands run directly from the global prompt per the official guide
- **CODING-STANDARDS.md**: Updated for 2-context CLI model, expanded "Discovered Capabilities" to reflect newly implemented actions, updated CLI syntax corrections table
- **REPOMAP.md**: Updated architecture diagram and data flow to reflect new actions and corrected CLI model
- **README.md**: Updated tool tables with all new query and configure actions, corrected CLI terminology, added official guide reference

### Fixed
- **🔴 Critical: Syslog level format** — changed from broken string enum (`"info"`, `"warning"`) to **numeric 0-7** matching the official guide. Previous string values would produce `% Invalid input` on the router.
- Syslog server command already uses colon separator (fixed in prior version)
- `configSyslog()` response now includes `level_name` for human-readable output alongside the numeric level

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
