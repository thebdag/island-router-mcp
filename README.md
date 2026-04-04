# Island Router MCP Server

> **⚠️ Disclaimer:** This is an **unofficial**, community-built project. It is **not affiliated with, endorsed by, or associated with Island Technology Inc.** or any of its products, services, or trademarks in any way. "Island" and "Island Router" are trademarks of their respective owners. Use this software at your own risk.

An [MCP (Model Context Protocol)](https://modelcontextprotocol.io/) server that exposes Island Router CLI operations as structured tools for AI assistants like Google Antigravity, Claude, and other MCP-compatible clients.

CLI behavior is aligned with the **official Island Router CLI Reference Guide (firmware 2.3.2)**.

---

## What This Does

This project provides two things:

### 🔧 MCP Server

A TypeScript server that connects to Island Routers over SSH and exposes their CLI through **3 meta-tools** — designed to minimize token usage while covering all router operations.

#### `island_list_devices`

Lists configured devices from the inventory. No SSH connection required.

#### `island_query` — All Read-Only Operations (14 actions)

A single tool for all read operations, dispatched by `action`:

| Action | What It Returns |
| --- | --- |
| `status` | Full overview — interfaces, routes, neighbors, version, stats, clock |
| `interfaces` | Parsed interface data (set `detail: true` for TX/RX byte counters) |
| `neighbors` | Parsed ARP table (IP → MAC → interface → state) |
| `routes` | Parsed routing table with destinations, gateways, metrics |
| `logs` | Parsed log entries + syslog forwarding configuration |
| `config` | Full running-config text |
| `config_diff` | Side-by-side diff of running vs startup configuration |
| `vpns` | VPN peer status |
| `dhcp_reservations` | DHCP static reservations in parse-friendly CSV format |
| `speedtest` | Speed test history |
| `history` | Event history in JSON format (pass `time` param, e.g. `1h`, `1d`, `1w`) |
| `ntp` | Full NTP status — config, sync status, and peer associations |
| `command` | Run any allowlisted `show` command (pass `command` param) |
| `ping` | ICMP ping from the router (pass `target` param) |

#### `island_configure` — All Write Operations (9 actions, guarded)

A single tool for all config mutations, dispatched by `action`. Every call requires `confirmation_phrase: "apply_change"` to prevent accidental changes.

| Action | Params | What It Does |
| --- | --- | --- |
| `add_dhcp` | `mac`, `ip`, `hostname?` | Add a MAC → IP DHCP reservation |
| `remove_dhcp` | `mac` | Remove a DHCP reservation |
| `set_syslog` | `server_ip`, `port?`, `level?` (0-7), `protocol?` | Configure syslog forwarding |
| `remove_syslog` | — | Remove syslog server configuration |
| `set_hostname` | `hostname` | Set the router hostname |
| `set_auto_update` | `days`, `time_str?` | Configure auto-update schedule |
| `set_led` | `led_level` (0-100) | Set LED brightness |
| `set_timezone` | `timezone` | Set system timezone |
| `set_ntp` | `ntp_server` | Set NTP server address |

> **Syslog levels are numeric 0-7:** 0=critical, 1=critical-unrecoverable, 2=recoverable-error, 3=less-severe-error, 4=warning, 5=informational, 6=debug, 7=verbose-debug (default).

#### Why Meta-Tools?

Traditional MCP servers register one tool per operation (13+ tools). Each tool's schema is serialized into every LLM request, consuming tokens even when unused. The meta-tool pattern consolidates related operations behind a single schema with an `action` discriminator — **reducing schema overhead by ~80%** while preserving full functionality.

### 📖 Agent Skills

Located in `.agent/skills/`, these are AI-readable references that give assistants context when this repo is open as a workspace.

| Skill | Domain | What It Provides |
| --- | --- | --- |
| `island-router-cli` | Networking | CLI reference for Island Router fw 2.3.2 — aligned with official 260-page guide. 2-context model (Global + Interface), history ETL, syslog (numeric 0-7), VPN, SNMP, DNS-over-HTTPS |
| `skill-mcp-builder` | Development | Guide for building MCP servers — project scaffolding, tool registration (v1 + v2), Zod schemas, meta-tool patterns |
| `skill-observability-pipeline` | DevOps | Syslog → Promtail → Loki → Grafana pipeline setup with Docker Compose configs and Raspberry Pi considerations |
| `skill-finops-gcp` | Cloud | GCP cost analysis via BigQuery billing exports, anomaly detection, budget alerts, Cloud Run rightsizing |
| `skill-meta-pipeline` | Meta | Orchestrates skill lifecycle: create → scan → check → install → audit → improve |
| `skill-network-fleet` | Networking | Multi-device config drift detection, compliance audits, automated backups |
| `skill-mcp-orchestrator` | Automation | Cross-MCP workflow recipes — Jira + Cloud Run + Confluence, incident triage, sprint planning |
| `skill-homelab-pi` | DevOps | Raspberry Pi service management — Docker Compose, systemd hardening, SD card longevity, backups |
| `skill-publisher` | Meta | Skill publishing pipeline — validation gates, README generation, GitHub releases, catalog updates |
| `skill-firmware-differ` | Networking | Firmware upgrade runbooks with pre/post snapshots, compatibility analysis, rollback plans |
| `skill-knowledge-harvester` | Meta | Extracts reusable knowledge from conversation logs into structured Knowledge Items |

---

## Prerequisites

- **Node.js 20+**
- SSH access to one or more Island Routers
- Password or SSH key authentication configured

## Quick Start

```bash
# Clone
git clone https://github.com/thebdag/island-router-mcp.git
cd island-router-mcp

# Install & build
npm install
npm run build

# Configure your device inventory
cp devices.example.json devices.json
# Edit devices.json with your router's IP, port, and credentials

# Set credentials (pick one auth method)
# Option A: Password auth (quote passwords with special chars)
export ROUTER_IP='192.168.2.1'
export ROUTER_PASS='your-router-password'

# Option B: SSH key auth
export ROUTER_IP='192.168.2.1'
export ROUTER_KEY='-----BEGIN OPENSSH PRIVATE KEY-----...'

# Test locally
node build/server.js
```

## Configure in Google Antigravity

Add the following to your `~/.gemini/antigravity/mcp_config.json`:

```json
{
  "island-router-mcp": {
    "command": "node",
    "args": ["/absolute/path/to/island-router-mcp/build/server.js"],
    "env": {
      "ISLAND_DEVICE_INVENTORY": "/absolute/path/to/island-router-mcp/devices.json",
      "ROUTER_IP": "192.168.2.1",
      "ROUTER_PASS": "your-router-password",
      "ROUTER_KEY": "-----BEGIN OPENSSH PRIVATE KEY-----..."
    }
  }
}
```

Restart Antigravity, then verify with: *"List my Island Router devices"*

## Configure in Cursor

Add the server to your Cursor MCP settings. Open **Settings → MCP** (or edit `~/.cursor/mcp.json`) and add:

```json
{
  "mcpServers": {
    "island-router-mcp": {
      "command": "node",
      "args": ["/absolute/path/to/island-router-mcp/build/server.js"],
      "env": {
        "ISLAND_DEVICE_INVENTORY": "/absolute/path/to/island-router-mcp/devices.json",
        "ROUTER_IP": "192.168.2.1",
        "ROUTER_PASS": "your-router-password",
        "ROUTER_KEY": "-----BEGIN OPENSSH PRIVATE KEY-----..."
      }
    }
  }
}
```

Restart Cursor, then open the MCP tools panel to confirm the three tools appear: `island_list_devices`, `island_query`, `island_configure`.

## Configure in Claude Desktop

Edit your Claude Desktop config file:

- **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`

Add the server entry:

```json
{
  "mcpServers": {
    "island-router-mcp": {
      "command": "node",
      "args": ["/absolute/path/to/island-router-mcp/build/server.js"],
      "env": {
        "ISLAND_DEVICE_INVENTORY": "/absolute/path/to/island-router-mcp/devices.json",
        "ROUTER_IP": "192.168.2.1",
        "ROUTER_PASS": "your-router-password",
        "ROUTER_KEY": "-----BEGIN OPENSSH PRIVATE KEY-----..."
      }
    }
  }
}
```

Restart Claude Desktop. The tools will appear in the 🔨 tool menu when starting a new conversation.

> **Tip:** For all clients, replace `/absolute/path/to/` with the actual path where you cloned the repo. If using SSH key auth instead of a password, you can provide the key content via the `ROUTER_KEY` environment variable and omit `ROUTER_PASS`.

## Device Inventory

Create `devices.json` from the example template:

```json
[
  {
    "id": "island-edge-1",
    "host": "192.168.2.1",
    "port": 22,
    "username": "admin",
    "authMethod": "password",
    "description": "Primary Island Router"
  }
]
```

Supports `"authMethod": "key"` with a `"privateKeyPath"` field for SSH key-based authentication.

> **Note:** `devices.json` is git-ignored — it is not committed to the repository since it contains real host addresses and key paths.

## Environment Variables

| Variable | Purpose | Default |
| --- | --- | --- |
| `ROUTER_IP` | Router IP address (preferred) | `192.168.X.X` |
| `ROUTER_HOST` | Router IP address (legacy alias for `ROUTER_IP`) | `192.168.X.X` |
| `ROUTER_PASS` | Admin password — wrap in single quotes if it contains `!`, `@`, `^`, `&` | — |
| `ROUTER_KEY` | SSH private key content for key-based auth (full key, not a file path) | — |
| `ROUTER_PORT` | SSH port | `22` |
| `ROUTER_USER` | SSH username | `admin` |
| `ISLAND_DEVICE_INVENTORY` | Path to `devices.json` inventory file | `./devices.json` |
| `ISLAND_DEVICE_ID` | Default device ID when no inventory file is found | `island-default` |

> **Note:** `ROUTER_IP` takes precedence over `ROUTER_HOST`. Either works, but `ROUTER_IP` is preferred. Provide either `ROUTER_PASS` or `ROUTER_KEY` — not both.

## Architecture

```text
island-router-mcp/                # Workspace root
├── .agent/
│   └── skills/
│       └── island-router-cli/    # Skill & scripts consolidated here
│           ├── SKILL.md          # CLI reference (official guide-aligned)
│           └── scripts/          # CLI discovery tooling
│               ├── cli_discovery.py
│               ├── cli_discovery_results.json
│               └── cli_commands_flat.txt
│
└── src/                          # TypeScript source
    ├── server.ts                 # 3 meta-tools with action dispatch
    ├── islandSsh.ts              # Interactive shell SSH client
    └── parsers/                  # CLI output → structured JSON
        ├── interfaces.ts
        ├── routes.ts
        └── logs.ts
```

**Key design decisions:**
- The Island Router has a **2-context CLI** (Global + Interface), not a Cisco-style 4-level hierarchy. Configuration commands work directly from the global prompt — `configure terminal` is unnecessary.
- This server uses ssh2's interactive `shell()` mode (not `exec()`) because the CLI is stateful across commands.
- Config commands are issued directly without `configure terminal` → `end` wrappers, per the official CLI Reference Guide.

## Safety

- **Read-only by default** — `island_query` only runs `show` commands
- **Allowlisted commands** — the `command` action only permits a curated list of safe commands
- **Write confirmation** — `island_configure` requires `confirmation_phrase: "apply_change"`
- **Input validation** — MAC addresses, IP addresses, and hostnames are validated before being sent to the router
- **Shell injection prevention** — targets and values are checked for metacharacters
- **No hardcoded secrets** — passwords come from env vars or the device inventory file (git-ignored)

## CLI Discovery

The `.agent/skills/island-router-cli/scripts/` directory contains tooling for exhaustive CLI command discovery:

- **`cli_discovery.py`** — Recursive crawler that traverses the router's `?` help system to map every command and argument. Includes safety guards (skips destructive commands), enum detection (prunes combinatorial explosions), and retry logic for SSH rate-limiting.
- **`cli_discovery_results.json`** — Structured JSON output of the full command tree (3,136 commands).
- **`cli_commands_flat.txt`** — Human-readable flat reference of all discovered commands.

To re-run discovery after a firmware update:

```bash
cd .agent/skills/island-router-cli/scripts
pip install paramiko python-dotenv
python cli_discovery.py
```

> **Note:** Discovery takes 15-30 minutes. The script uses an interactive SSH shell and sends `?` at each command node. Ensure `ROUTER_IP` and `ROUTER_PASS` are set in `../island-mcp-server/.env`.

## Troubleshooting

| Problem | Cause | Solution |
| --- | --- | --- |
| `AuthenticationException` after first failure | Router rate-limits SSH after failed auth | Wait 60+ seconds, then retry |
| Password with `!`, `^`, `&` characters fails | Shell or `.env` parsing interpreting special chars | Wrap in single quotes: `ROUTER_PASS='p@ss!w0rd'` |
| Output is truncated or hangs | Pager (`--More--`) blocking | The server sends `terminal length 0` automatically; if using scripts, send it manually after connecting |
| `exec_command()` returns empty output | Router CLI is stateful, requires interactive shell | Use `shell()` / `invoke_shell()` instead of `exec()` / `exec_command()` |
| `Unknown device_id` error | Device ID doesn't match inventory | Check `devices.json` or set `ISLAND_DEVICE_ID` env var |
| Syslog level rejected | Using string names (`info`) instead of numbers | Use numeric levels 0-7 (e.g., `5` for informational) |
| `configure terminal` errors | Command accepted but unnecessary | Issue config commands directly at the global prompt |

## License

MIT

---

> **This project is not affiliated with Island Technology Inc.** It is an independent, community-built tool created for personal and educational use. The authors make no warranties regarding its suitability for production use. Always test configuration changes on a lab network first.
