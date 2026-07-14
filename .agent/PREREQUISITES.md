# Prerequisites — Island Router agent access

Complete these before using `island-axi` or the MCP server from Cursor, Claude, Antigravity, or any other agent.

## 1. Runtime

- **Node.js 20+**
- Repo dependencies and build:

```sh
npm install
npm run build
```

Bins after build:

| Surface | Command |
| --- | --- |
| AXI CLI (preferred) | `node build/cli/island-axi.js` or `island-axi` |
| MCP adapter | `node build/server.js` / `npm start` |

## 2. Device credentials (pick one)

### Option A — `devices.json` (recommended)

```sh
cp devices.example.json devices.json
```

Edit `devices.json` (gitignored — never commit):

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

| Field | Notes |
| --- | --- |
| `id` | Stable id agents pass as `--device` / `device_id` |
| `host` | Router management IP/hostname |
| `port` | SSH port (default `22`) |
| `username` | Usually `admin` (full) or `user` (read-only) |
| `authMethod` | `"password"` or `"key"` |
| `privateKeyPath` | Optional path when `authMethod` is `"key"` |

Password / key still come from env (below) unless you only use key file path.

### Option B — environment only

No `devices.json` needed; a default device is synthesized:

```sh
export ROUTER_IP='192.168.2.1'          # or ROUTER_HOST
export ROUTER_PASS='your-password'      # quote if it contains ! ^ & @
# optional:
export ROUTER_USER='admin'
export ROUTER_PORT='22'
export ISLAND_DEVICE_ID='island-default'
```

### SSH key auth

```sh
export ROUTER_KEY='-----BEGIN OPENSSH PRIVATE KEY-----
...
-----END OPENSSH PRIVATE KEY-----'
# or set authMethod: "key" + privateKeyPath in devices.json
```

| Variable | Purpose |
| --- | --- |
| `ROUTER_PASS` | Password when `authMethod` is `password` |
| `ROUTER_KEY` | Private key PEM contents (preferred over file for agents) |
| `ISLAND_DEVICE_INVENTORY` | Alternate path to inventory JSON (default `./devices.json`) |

**Never** hardcode passwords in skills, commits, or tool args. Never log secrets.

## 3. Network reachability

- Agent host must reach the router on SSH (port 22 by default).
- Failed auth can trigger Island SSH rate-limiting — wait 60s+ before retrying.
- Firmware target: **2.3.2** CLI model (global + interface contexts; no `configure terminal`).

## 4. Smoke test

```sh
node build/cli/island-axi.js              # inventory (no SSH)
node build/cli/island-axi.js status       # needs credentials + SSH
node build/cli/island-axi.js neighbors
```

Success looks like TOON on stdout with `help[]` next steps.  
SSH/auth failures return structured `error:` / `code: CONNECTION_ERROR`.

## 5. Agent host wiring

### Cursor / Claude Code / Codex / OpenCode (shell)

1. Meet prereqs 1–3 above.
2. Prefer **`island-axi`** over MCP.
3. Optional ambient context: `node build/cli/island-axi.js setup hooks`
4. Load skills under `.agent/skills/` (also `.agents/skills/` symlink).

### Antigravity / MCP-only clients

Point the MCP client at:

```text
command: node
args: [<absolute-path-to-repo>/build/server.js]
env: ROUTER_IP, ROUTER_PASS (or ROUTER_KEY), cwd = repo root
```

Same `devices.json` / env as AXI. MCP tools: `island_list_devices`, `island_query`, `island_configure` (`confirmation_phrase: "apply_change"` for writes).

## Checklist

- [ ] `npm install && npm run build`
- [ ] `devices.json` **or** `ROUTER_IP` + `ROUTER_PASS`/`ROUTER_KEY`
- [ ] SSH from this host to the router works
- [ ] `island-axi` home + `status` succeed
- [ ] Skills/hooks optional but recommended for Cursor/Claude/Codex

## See also

- [`../AGENTS.md`](../AGENTS.md) — agent workflow
- [`skills/island-axi/SKILL.md`](./skills/island-axi/SKILL.md) — CLI usage
- [`skills/island-router-cli/SKILL.md`](./skills/island-router-cli/SKILL.md) — full CLI reference
- [`../devices.example.json`](../devices.example.json) — inventory template
