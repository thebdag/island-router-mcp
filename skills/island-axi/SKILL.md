---
name: island-axi
description: >
  Operate Island Routers through the island-axi CLI — status, interfaces, neighbors,
  routes, logs, DHCP, VPN, NTP, DNS redirects, ping, and guarded configure mutations.
  Use whenever a task needs Island Router CLI access over SSH with token-efficient TOON output.
---

# island-axi

Agent ergonomic wrapper around Island Router SSH CLI ([AXI](https://axi.md/) principles).
Prefer this over raw SSH or ad-hoc expect scripts for router operations.

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
- Network SSH access to the Island Router (firmware 2.3.2 CLI model)

## When to use

Use island-axi for Island Router read/write: inventory, status, interfaces, ARP neighbors, routes, logs/syslog, running-config, VPN peers, DHCP reservations, NTP, DNS redirects/blocks, ping from the router, allowlisted `show` commands, and guarded config changes.

## Workflow

1. Run `island-axi` with no args for device inventory + next-step hints (content-first).
2. Drill in: `status`, `interfaces`, `neighbors`, `routes`, `logs`, `dhcp`, `vpns`, `ntp`.
3. Target a device with `--device <id>` after the command.
4. Mutations use `configure <action> ... --confirm` (idempotent where possible; no prompts).
5. Follow `help:` suggestions in every response.

## Commands

```
commands[16]:
  (none)=devices dashboard, devices, status, interfaces, neighbors, routes,
  logs, config, config-diff, vpns, dhcp, ntp, dns-redirects, ping, show,
  configure, setup
```

## Tips

- Output is TOON-encoded and token-efficient.
- Large bodies (`config`, `logs`, `show`) truncate by default — use `--full`.
- List schemas stay minimal; request more with `--fields a,b,c`.
- Config commands run at the global prompt — no `configure terminal` on Island CLI.
- Syslog levels are numeric **0–7** (not string names).
- Install ambient context: `island-axi setup hooks`
- Deep CLI reference: see skill `island-router-cli` in this repo.
