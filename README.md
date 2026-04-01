# Island Router MCP Server

> **⚠️ Disclaimer:** This is an **unofficial**, community-built project. It is **not affiliated with, endorsed by, or associated with Island Technology Inc.** or any of its products, services, or trademarks in any way. "Island" and "Island Router" are trademarks of their respective owners. Use this software at your own risk.

An [MCP (Model Context Protocol)](https://modelcontextprotocol.io/) server that exposes Island Router CLI operations as structured tools for AI assistants like Google Antigravity, Claude, and other MCP-compatible clients.

---

## What This Does

This project provides two things:

### 🔧 MCP Server

A TypeScript server that connects to Island Routers over SSH and exposes their Cisco-style CLI through **3 meta-tools** — designed to minimize token usage while covering all router operations.

#### `island_list_devices`
Lists configured devices from the inventory. No SSH connection required.

#### `island_query` — All Read-Only Operations

A single tool for all read operations, dispatched by `action`:

| Action | What It Returns |
|---|---|
| `status` | Full overview — interfaces, routes, neighbors, version, stats, clock |
| `interfaces` | Parsed interface data (set `detail: true` for TX/RX byte counters) |
| `neighbors` | Parsed ARP table (IP → MAC → interface → state) |
| `routes` | Parsed routing table with destinations, gateways, metrics |
| `logs` | Parsed log entries + syslog forwarding configuration |
| `config` | Full running-config text |
| `vpns` | VPN peer status |
| `command` | Run any allowlisted `show` command (pass `command` param) |
| `ping` | ICMP ping from the router (pass `target` param) |

#### `island_configure` — All Write Operations (Guarded)

A single tool for all config mutations, dispatched by `action`. Every call requires `confirmation_phrase: "apply_change"` to prevent accidental changes.

| Action | Params | What It Does |
|---|---|---|
| `add_dhcp` | `mac`, `ip`, `hostname?` | Add a MAC → IP DHCP reservation |
| `remove_dhcp` | `mac` | Remove a DHCP reservation |
| `set_syslog` | `server_ip`, `port?`, `level?`, `protocol?` | Configure syslog forwarding |

#### Why Meta-Tools?

Traditional MCP servers register one tool per operation (13+ tools). Each tool's schema is serialized into every LLM request, consuming tokens even when unused. The meta-tool pattern consolidates related operations behind a single schema with an `action` discriminator — **reducing schema overhead by ~80%** while preserving full functionality.

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
        "ROUTER_PASS": "your-router-password"
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
        "ROUTER_PASS": "your-router-password"
      }
    }
  }
}
```

Restart Claude Desktop. The tools will appear in the 🔨 tool menu when starting a new conversation.

> **Tip:** For all clients, replace `/absolute/path/to/` with the actual path where you cloned the repo. If using SSH key auth instead of a password, you can omit the `ROUTER_PASS` env var.

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
  server.ts              # MCP server — 3 meta-tools with action dispatch
  islandSsh.ts           # Interactive shell SSH client (uses ssh2 shell(), not exec())
  parsers/
    interfaces.ts        # Parses show interface / show interface summary
    routes.ts            # Parses show ip routes / show ip neighbors
    logs.ts              # Parses show log / show syslog
```

**Key design decision:** The Island Router uses a stateful Cisco-style CLI, so this server uses ssh2's interactive `shell()` mode (not `exec()`) to maintain session context across commands like `configure terminal` → config commands → `end` → `write memory`.

## Safety

- **Read-only by default** — `island_query` only runs `show` commands
- **Allowlisted commands** — the `command` action only permits a curated list of safe commands
- **Write confirmation** — `island_configure` requires `confirmation_phrase: "apply_change"`
- **Input validation** — MAC addresses and IP addresses are validated before being sent to the router
- **Shell injection prevention** — ping targets are checked for metacharacters
- **No hardcoded secrets** — passwords come from env vars or the device inventory file (git-ignored)

## License

MIT

---

> **This project is not affiliated with Island Technology Inc.** It is an independent, community-built tool created for personal and educational use. The authors make no warranties regarding its suitability for production use. Always test configuration changes on a lab network first.
