---
name: island-axi
description: >
  Operate Island Routers through the island-axi CLI — status, interfaces, neighbors,
  routes, logs, DHCP, VPN, NTP, DNS redirects, ping, VLANs, subscribers (IoT discovery),
  and guarded configure mutations.
  Use whenever a task needs Island Router CLI access over SSH with token-efficient TOON output.
---

# island-axi

Agent ergonomic wrapper around Island Router SSH CLI ([AXI](https://axi.md/) principles).
Prefer this over raw SSH, ad-hoc expect scripts, **and MCP** for agent shell workflows.
(MCP remains available as a thin adapter over the same `src/core/` actions.)

You do not need island-axi installed globally — invoke with:

```sh
# after npm install && npm run build in this repo:
node build/cli/island-axi.js <command>
# or npm link / PATH install:
island-axi <command>
# or via npm bin without global install:
npx -y -p island-mcp-server island-axi <command>
```

If output shows a follow-up starting with `island-axi`, run the same binary form you used above.

## Requirements

- `devices.json` (from `devices.example.json`) **or** `ROUTER_IP` + `ROUTER_PASS` / `ROUTER_KEY`
- Network SSH access to the Island Router (firmware 2.3.2 - 4.1 CLI model)

## When to use

Use island-axi for Island Router read/write: inventory, status, interfaces, ARP neighbors, routes, logs/syslog, running-config, VPN peers, DHCP reservations, NTP, DNS redirects/blocks, ping from the router, VLAN interfaces, subscriber & IoT discovery, allowlisted `show` commands, and guarded config changes.

## Workflow

1. Run `island-axi` with no args for device inventory + next-step hints (content-first).
2. Drill in: `status`, `interfaces`, `neighbors`, `routes`, `logs`, `dhcp`, `vpns`, `ntp`, `vlans`, `subscribers`.
3. Target a device with `--device <id>` after the command.
4. Discover & classify IoT devices: `island-axi subscribers --category iot`.
5. Create VLANs: `island-axi configure create-vlan --vlan-id <id> --parent <iface> --cidr <ip/prefix> --confirm`.
6. Follow `help:` suggestions in every response.

## Commands

```
commands[18]:
  (none)=devices dashboard, devices, status, interfaces, neighbors, routes,
  logs, config, config-diff, vpns, dhcp, ntp, dns-redirects, ping, vlans,
  subscribers, show, configure, setup
```

## Tips

- Output is TOON-encoded and token-efficient.
- Large bodies (`config`, `logs`, `show`) truncate by default — use `--full`.
- List schemas stay minimal; request more with `--fields a,b,c`.
- Config commands run at the global prompt — no `configure terminal` on Island CLI.
- Syslog levels are numeric **0–7** (not string names).
- **VLANs & Segmentation:** Island Router isolates distinct LAN/VLAN subnets automatically. Use `island-axi vlans` to inspect VLANs, and `island-axi configure create-vlan` / `delete-vlan` with `--confirm`.
- **IoT & Subscriber Discovery:** `island-axi subscribers [--category iot|media|infrastructure|compute|unknown]` correlates ARP, DHCP leases, reservations, and Island SSDP/mDNS history fingerprinting.
- **Firmware updates (CLI 2.3.2 - 4.1):** there is no read-only “check for updates” show command. Use `island-axi configure update --confirm` (`update [<url>]`) — Island looks for newer firmware and installs if found. Baseline with `show version` / `show version history`. Stuck update: `configure clear-update --confirm`.
- Install ambient context: `island-axi setup hooks`
- Deep CLI reference: see skill `island-router-cli` in this repo (and https://docs.islandrouter.com/island-router-cli-2.3.2).
