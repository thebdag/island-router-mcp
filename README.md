# Island Router MCP Server

> **⚠️ Disclaimer:** This is an **unofficial**, community-built project. It is **not affiliated with, endorsed by, or associated with Island Technology Inc.** or any of its products, services, or trademarks in any way. "Island" and "Island Router" are trademarks of their respective owners. Use this software at your own risk.

An [MCP (Model Context Protocol)](https://modelcontextprotocol.io/) server that exposes Island Router CLI operations as structured tools for AI assistants like Google Antigravity, Claude, and other MCP-compatible clients.

---

## What This Does

This project provides two things:

### 🔧 MCP Server

A TypeScript server that connects to Island Routers over SSH and exposes their Cisco-style CLI as **13 MCP tools** — enabling AI assistants to query router status, manage DHCP reservations, configure syslog forwarding, and more, all through natural language.

| Tool | Type | What It Does |
|---|---|---|
| `island_list_devices` | Read | List configured devices in inventory |
| `island_show_status` | Read | Comprehensive router overview (interfaces, routes, neighbors, version, stats) |
| `island_show_interfaces` | Read | Parsed interface data with TX/RX byte counters |
| `island_show_neighbors` | Read | Parsed ARP table (IP → MAC → interface → state) |
| `island_show_routes` | Read | Parsed routing table |
| `island_show_logs` | Read | Parsed log entries + syslog configuration |
| `island_show_config` | Read | Full running configuration |
| `island_show_vpns` | Read | VPN peer status |
| `island_run_command` | Read | Run any allowlisted `show` command |
| `island_ping` | Read | ICMP ping from the router |
| `island_add_dhcp_reservation` | **Write** | Add a MAC → IP DHCP binding |
| `island_remove_dhcp_reservation` | **Write** | Remove a DHCP reservation |
| `island_configure_syslog` | **Write** | Set syslog server, level, and protocol |

All **write operations** require an explicit `confirmation_phrase: "apply_change"` parameter to prevent accidental configuration changes. Read-only commands are restricted to an allowlist of safe `show` commands.

### 📖 Agent Skill (CLI Reference)

Located at `.agent/skills/island-router-cli/SKILL.md`, this is a comprehensive reference for the Island Router CLI (firmware 2.3.2). When this repo is opened as a workspace, AI assistants automatically gain context on:

- All CLI commands organized by function (interfaces, IP, DHCP, DNS, VPN, syslog, NTP, etc.)
- CLI modes and context navigation (`Router#`, `Router(config)#`, `Router(config-if)#`)
- Automation patterns with Python/paramiko code examples
- Pager handling, prompt detection, and session management
- DHCP reservation and DNS sinkhole configuration for ad blocking
- Monitoring commands for device data usage reporting

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

# Set password (if using password auth)
export ROUTER_PASS='your-router-password'

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
      "ISLAND_DEVICE_INVENTORY": "/absolute/path/to/island-router-mcp/devices.json"
    }
  }
}
```

Restart Antigravity, then verify with: *"List my Island Router devices"*

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

## Architecture

```
src/
  server.ts              # MCP server — all 13 tools defined here
  islandSsh.ts           # Interactive shell SSH client (uses ssh2 shell(), not exec())
  parsers/
    interfaces.ts        # Parses show interface / show interface summary
    routes.ts            # Parses show ip routes / show ip neighbors
    logs.ts              # Parses show log / show syslog
```

**Key design decision:** The Island Router uses a stateful Cisco-style CLI, so this server uses ssh2's interactive `shell()` mode (not `exec()`) to maintain session context across commands like `configure terminal` → config commands → `end` → `write memory`.

## Safety

- **Read-only by default** — most tools only run `show` commands
- **Allowlisted commands** — `island_run_command` only permits a curated list of safe commands
- **Write confirmation** — all config-changing tools require `confirmation_phrase: "apply_change"`
- **Input validation** — MAC addresses and IP addresses are validated before being sent to the router
- **Shell injection prevention** — ping targets are checked for metacharacters
- **No hardcoded secrets** — passwords come from env vars or the device inventory file (git-ignored)

## License

MIT

---

> **This project is not affiliated with Island Technology Inc.** It is an independent, community-built tool created for personal and educational use. The authors make no warranties regarding its suitability for production use. Always test configuration changes on a lab network first.
