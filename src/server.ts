#!/usr/bin/env node
/**
 * server.ts — Island Router MCP Server (meta-tool architecture)
 *
 * Reduces token overhead by consolidating into 3 meta-tools:
 *   - island_list_devices   (inventory, no SSH)
 *   - island_query          (all read-only operations, dispatched by action)
 *   - island_configure      (all write operations, dispatched by action, guarded)
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import fs from "node:fs";

import {
  openSession,
  closeSession,
  runCommand,
  type DeviceConfig,
  type ShellSession,
} from "./islandSsh.js";

import { parseInterfaceSummary, parseInterfaceDetail } from "./parsers/interfaces.js";
import { parseRoutes, parseNeighbors } from "./parsers/routes.js";
import { parseLogEntries, parseSyslogConfig } from "./parsers/logs.js";

// ─── Device inventory ────────────────────────────────────────────────────────

const inventoryPath = process.env["ISLAND_DEVICE_INVENTORY"] ?? "devices.json";

let devices: DeviceConfig[];
try {
  devices = JSON.parse(fs.readFileSync(inventoryPath, "utf8"));
} catch {
  devices = [
    {
      id: process.env["ISLAND_DEVICE_ID"] ?? "island-default",
      host: process.env["ROUTER_HOST"] ?? "192.168.2.1",
      port: parseInt(process.env["ROUTER_PORT"] ?? "22", 10),
      username: process.env["ROUTER_USER"] ?? "admin",
      authMethod: "password" as const,
      description: "Default Island Router (from env)",
    },
  ];
  process.stderr.write(
    `[island-mcp] No devices.json at '${inventoryPath}', using env-based default\n`,
  );
}

function getDeviceOrThrow(deviceId: string): DeviceConfig {
  const dev = devices.find((d) => d.id === deviceId);
  if (!dev) {
    const available = devices.map((d) => d.id).join(", ");
    throw new Error(`Unknown device_id '${deviceId}'. Available: ${available}`);
  }
  return dev;
}

// ─── Allowlisted show commands ───────────────────────────────────────────────

const ALLOWED_SHOW_COMMANDS = [
  "show version", "show hardware", "show clock", "show users",
  "show free-space", "show public-key", "show running-config",
  "show startup-config", "show history", "show dumps", "show packages",
  "show interface", "show interface summary", "show interface transceivers",
  "show ip interface", "show ip routes", "show ip neighbors",
  "show ip sockets", "show ip dhcp-reservations", "show ip recommendations",
  "show vpns", "show ntp", "show syslog", "show log", "show stats",
  "show config authorized-keys", "show config known-hosts", "show ssh-client-keys",
];

function isCommandAllowed(cmd: string): boolean {
  const n = cmd.trim().toLowerCase();
  return ALLOWED_SHOW_COMMANDS.some(
    (a) => n === a.toLowerCase() || n.startsWith(a.toLowerCase() + " "),
  );
}

// ─── Session helper ──────────────────────────────────────────────────────────

async function withSession<T>(
  device: DeviceConfig,
  fn: (session: ShellSession) => Promise<T>,
): Promise<T> {
  const session = await openSession(device);
  try {
    return await fn(session);
  } finally {
    closeSession(session);
  }
}

// ─── Query action handlers ──────────────────────────────────────────────────

type QueryResult = { content: Array<{ type: "text"; text: string }> };

async function queryStatus(dev: DeviceConfig): Promise<QueryResult> {
  const result = await withSession(dev, async (s) => {
    const cmds = [
      { cmd: "show interface summary", waitMs: 2000 },
      { cmd: "show ip interface", waitMs: 2000 },
      { cmd: "show ip routes", waitMs: 2000 },
      { cmd: "show ip neighbors", waitMs: 2000 },
      { cmd: "show version", waitMs: 2000 },
      { cmd: "show stats", waitMs: 2000 },
      { cmd: "show clock", waitMs: 1500 },
    ];
    const out: Record<string, string> = {};
    for (const { cmd, waitMs } of cmds) {
      out[cmd] = await runCommand(s, cmd, waitMs);
    }
    return out;
  });

  return text({
    device_id: dev.id, host: dev.host,
    interfaces: result["show interface summary"],
    ip_interfaces: result["show ip interface"],
    routes: result["show ip routes"],
    neighbors: result["show ip neighbors"],
    version: result["show version"],
    stats: result["show stats"],
    clock: result["show clock"],
  });
}

async function queryInterfaces(dev: DeviceConfig, detail: boolean): Promise<QueryResult> {
  const cmd = detail ? "show interface" : "show interface summary";
  const output = await withSession(dev, (s) => runCommand(s, cmd, 3000));
  const parsed = detail ? parseInterfaceDetail(output) : parseInterfaceSummary(output);
  return text({ device_id: dev.id, command: cmd, interfaces: parsed });
}

async function queryNeighbors(dev: DeviceConfig): Promise<QueryResult> {
  const output = await withSession(dev, (s) => runCommand(s, "show ip neighbors", 2000));
  const parsed = parseNeighbors(output);
  return text({ device_id: dev.id, count: parsed.length, neighbors: parsed });
}

async function queryRoutes(dev: DeviceConfig): Promise<QueryResult> {
  const output = await withSession(dev, (s) => runCommand(s, "show ip routes", 2000));
  const parsed = parseRoutes(output);
  return text({ device_id: dev.id, count: parsed.length, routes: parsed });
}

async function queryLogs(dev: DeviceConfig): Promise<QueryResult> {
  const result = await withSession(dev, async (s) => ({
    log: await runCommand(s, "show log", 3000),
    syslog: await runCommand(s, "show syslog", 2000),
  }));
  const entries = parseLogEntries(result.log);
  const syslogConfig = parseSyslogConfig(result.syslog);
  return text({ device_id: dev.id, count: entries.length, syslog_config: syslogConfig, entries: entries.slice(-100) });
}

async function queryConfig(dev: DeviceConfig): Promise<QueryResult> {
  const output = await withSession(dev, (s) => runCommand(s, "show running-config", 4000));
  return { content: [{ type: "text" as const, text: output }] };
}

async function queryVpns(dev: DeviceConfig): Promise<QueryResult> {
  const output = await withSession(dev, (s) => runCommand(s, "show vpns", 2000));
  return { content: [{ type: "text" as const, text: output }] };
}

async function queryCommand(dev: DeviceConfig, command: string): Promise<QueryResult> {
  if (!isCommandAllowed(command)) {
    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify({
          error: `Command not allowed: '${command}'`,
          hint: "Only read-only 'show' commands are permitted.",
          allowed: ALLOWED_SHOW_COMMANDS,
        }, null, 2),
      }],
    };
  }
  const output = await withSession(dev, (s) => runCommand(s, command, 3000));
  return text({ device_id: dev.id, command, output });
}

async function queryPing(dev: DeviceConfig, target: string): Promise<QueryResult> {
  if (/[;&|`$(){}]/.test(target)) {
    throw new Error("Invalid target — contains shell metacharacters");
  }
  const output = await withSession(dev, (s) => runCommand(s, `ping ${target}`, 10000));
  return text({ device_id: dev.id, target, output });
}

// ─── Configure action handlers ──────────────────────────────────────────────

async function configAddDhcp(
  dev: DeviceConfig, mac: string, ip: string, hostname?: string,
): Promise<QueryResult> {
  if (!/^([0-9a-fA-F]{2}[:\-.]){5}[0-9a-fA-F]{2}$/.test(mac)) {
    throw new Error(`Invalid MAC: '${mac}'`);
  }
  if (!/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(ip)) {
    throw new Error(`Invalid IP: '${ip}'`);
  }

  const result = await withSession(dev, async (s) => {
    await runCommand(s, "configure terminal", 1500);
    let cmd = `ip dhcp-reserve ${mac} ${ip}`;
    if (hostname) cmd += ` ${hostname}`;
    const configOut = await runCommand(s, cmd, 2000);
    await runCommand(s, "end", 1000);
    const writeOut = await runCommand(s, "write memory", 3000);
    const verify = await runCommand(s, "show ip dhcp-reservations", 2000);
    return { configOut, writeOut, verify };
  });

  return text({
    applied: true, device_id: dev.id, mac, ip,
    hostname: hostname ?? null,
    config_output: result.configOut,
    write_output: result.writeOut,
    reservations: result.verify,
  });
}

async function configRemoveDhcp(dev: DeviceConfig, mac: string): Promise<QueryResult> {
  if (!/^([0-9a-fA-F]{2}[:\-.]){5}[0-9a-fA-F]{2}$/.test(mac)) {
    throw new Error(`Invalid MAC: '${mac}'`);
  }

  const result = await withSession(dev, async (s) => {
    await runCommand(s, "configure terminal", 1500);
    const configOut = await runCommand(s, `no ip dhcp-reserve ${mac}`, 2000);
    await runCommand(s, "end", 1000);
    const writeOut = await runCommand(s, "write memory", 3000);
    const verify = await runCommand(s, "show ip dhcp-reservations", 2000);
    return { configOut, writeOut, verify };
  });

  return text({
    removed: true, device_id: dev.id, mac,
    config_output: result.configOut,
    write_output: result.writeOut,
    reservations: result.verify,
  });
}

async function configSyslog(
  dev: DeviceConfig, serverIp: string, port: number, level: string, protocol: string,
): Promise<QueryResult> {
  if (!/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(serverIp)) {
    throw new Error(`Invalid syslog server IP: '${serverIp}'`);
  }

  const result = await withSession(dev, async (s) => {
    await runCommand(s, "configure terminal", 1500);
    await runCommand(s, `syslog server ${serverIp} ${port}`, 2000);
    await runCommand(s, `syslog level ${level}`, 1500);
    await runCommand(s, `syslog protocol ${protocol}`, 1500);
    await runCommand(s, "end", 1000);
    const writeOut = await runCommand(s, "write memory", 3000);
    const verify = await runCommand(s, "show syslog", 2000);
    return { writeOut, verify };
  });

  return text({
    configured: true, device_id: dev.id,
    server_ip: serverIp, port, level, protocol,
    write_output: result.writeOut,
    verified_config: parseSyslogConfig(result.verify),
  });
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function text(obj: unknown): QueryResult {
  return { content: [{ type: "text" as const, text: JSON.stringify(obj, null, 2) }] };
}

// ═════════════════════════════════════════════════════════════════════════════
// MCP Server — 3 meta-tools
// ═════════════════════════════════════════════════════════════════════════════

const server = new McpServer({
  name: "island-router-mcp",
  version: "0.2.0",
});

// ─── Tool 1: island_list_devices ─────────────────────────────────────────────

server.tool(
  "island_list_devices",
  "List all configured Island Router devices. No SSH needed.",
  {},
  async () => text(
    devices.map(({ id, host, port, description }) => ({
      id, host, port, description: description ?? null,
    })),
  ),
);

// ─── Tool 2: island_query (all read-only operations) ─────────────────────────

const QueryActions = z.enum([
  "status",        // Full overview (interfaces, routes, neighbors, version, stats, clock)
  "interfaces",    // Parsed interface data (set detail=true for TX/RX byte counters)
  "neighbors",     // Parsed ARP table (IP → MAC → interface → state)
  "routes",        // Parsed routing table
  "logs",          // Parsed log entries + syslog config
  "config",        // Full running-config text
  "vpns",          // VPN peer status
  "command",       // Run an allowlisted show command (pass 'command' param)
  "ping",          // ICMP ping from router (pass 'target' param)
]);

server.tool(
  "island_query",
  `Read-only query against an Island Router. Actions: status (full overview), interfaces (parsed, set detail=true for byte counters), neighbors (ARP table), routes (routing table), logs (parsed entries + syslog config), config (running-config), vpns (peer status), command (any allowlisted show command — pass 'command'), ping (pass 'target').`,
  {
    device_id: z.string().describe("Device ID from inventory"),
    action: QueryActions.describe("Query action to perform"),
    command: z.string().optional().describe("For action='command': the show command to run"),
    target: z.string().optional().describe("For action='ping': IP or hostname to ping"),
    detail: z.boolean().optional().default(false).describe("For action='interfaces': true for detailed TX/RX stats"),
  },
  async ({ device_id, action, command, target, detail }) => {
    const dev = getDeviceOrThrow(device_id);

    switch (action) {
      case "status":     return queryStatus(dev);
      case "interfaces": return queryInterfaces(dev, detail);
      case "neighbors":  return queryNeighbors(dev);
      case "routes":     return queryRoutes(dev);
      case "logs":       return queryLogs(dev);
      case "config":     return queryConfig(dev);
      case "vpns":       return queryVpns(dev);
      case "command": {
        if (!command) throw new Error("'command' parameter required for action='command'");
        return queryCommand(dev, command);
      }
      case "ping": {
        if (!target) throw new Error("'target' parameter required for action='ping'");
        return queryPing(dev, target);
      }
      default:
        throw new Error(`Unknown action: '${action}'`);
    }
  },
);

// ─── Tool 3: island_configure (all write operations, guarded) ────────────────

const ConfigureActions = z.enum([
  "add_dhcp",       // Add DHCP reservation (mac, ip, hostname?)
  "remove_dhcp",    // Remove DHCP reservation (mac)
  "set_syslog",     // Configure syslog forwarding (server_ip, port?, level?, protocol?)
]);

server.tool(
  "island_configure",
  `WRITE operation on an Island Router — persists changes with 'write memory'. Requires confirmation_phrase='apply_change'. Actions: add_dhcp (mac, ip, hostname?), remove_dhcp (mac), set_syslog (server_ip, port?, level?, protocol?).`,
  {
    device_id: z.string().describe("Device ID from inventory"),
    action: ConfigureActions.describe("Configuration action"),
    confirmation_phrase: z.literal("apply_change").describe("Must be exactly 'apply_change' to proceed"),
    // DHCP params
    mac: z.string().optional().describe("MAC address (for add_dhcp / remove_dhcp)"),
    ip: z.string().optional().describe("IPv4 address (for add_dhcp)"),
    hostname: z.string().optional().describe("Hostname label (for add_dhcp)"),
    // Syslog params
    server_ip: z.string().optional().describe("Syslog server IP (for set_syslog)"),
    port: z.number().optional().default(514).describe("Syslog port (for set_syslog, default 514)"),
    level: z.enum(["debug", "info", "notice", "warning", "error", "critical"]).optional().default("info").describe("Syslog severity level"),
    protocol: z.enum(["udp", "tcp"]).optional().default("udp").describe("Syslog transport protocol"),
  },
  async ({ device_id, action, confirmation_phrase, mac, ip, hostname, server_ip, port, level, protocol }) => {
    if (confirmation_phrase !== "apply_change") {
      throw new Error("confirmation_phrase must be exactly 'apply_change'");
    }

    const dev = getDeviceOrThrow(device_id);

    switch (action) {
      case "add_dhcp": {
        if (!mac) throw new Error("'mac' required for add_dhcp");
        if (!ip) throw new Error("'ip' required for add_dhcp");
        return configAddDhcp(dev, mac, ip, hostname);
      }
      case "remove_dhcp": {
        if (!mac) throw new Error("'mac' required for remove_dhcp");
        return configRemoveDhcp(dev, mac);
      }
      case "set_syslog": {
        if (!server_ip) throw new Error("'server_ip' required for set_syslog");
        return configSyslog(dev, server_ip, port, level, protocol);
      }
      default:
        throw new Error(`Unknown configure action: '${action}'`);
    }
  },
);

// ═════════════════════════════════════════════════════════════════════════════
// Server startup
// ═════════════════════════════════════════════════════════════════════════════

async function main() {
  process.stderr.write(
    `[island-mcp] Starting v0.2.0 (meta-tool) with ${devices.length} device(s)\n`,
  );
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  process.stderr.write(`[island-mcp] Fatal error: ${err}\n`);
  process.exit(1);
});
