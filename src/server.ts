#!/usr/bin/env node
/**
 * server.ts — Island Router MCP Server (meta-tool architecture)
 *
 * Reduces token overhead by consolidating into 3 meta-tools:
 *   - island_list_devices   (inventory, no SSH)
 *   - island_query          (all read-only operations, dispatched by action)
 *   - island_configure      (all write operations, dispatched by action, guarded)
 *
 * Aligned with official Island Router CLI Reference Guide (firmware 2.3.2).
 * NOTE: The Island CLI does NOT require `configure terminal` — config commands
 * work from the global prompt. `end` exits interface context, not config mode.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import fs from "node:fs";
import "dotenv/config";

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
      host: process.env["ROUTER_IP"] ?? process.env["ROUTER_HOST"] ?? "192.168.2.1", // NOSONAR
      port: Number.parseInt(process.env["ROUTER_PORT"] ?? "22", 10),
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
  // System
  "show version", "show version history", "show hardware", "show clock",
  "show users", "show free-space", "show public-key",
  // Configuration
  "show running-config", "show running-config differences",
  "show startup-config",
  // Event history & logs
  "show history", "show dumps", "show log", "show syslog",
  // Interfaces
  "show interface", "show interface summary",
  "show interface transceivers", "show interface transceivers diagnostics",
  // IP & networking
  "show ip interface", "show ip routes", "show ip neighbors",
  "show ip sockets", "show ip dhcp-reservations",
  "show ip recommendations",
  // VPN / NTP
  "show vpns", "show ntp", "show ntp associations", "show ntp status",
  // Packages
  "show packages", "show packages detail",
  // Stats
  "show stats",
  // SSH & security
  "show config authorized-keys", "show config known-hosts",
  "show config email",
  "show ssh-client-keys", "show ssh-client-keys detail",
  // Speed test
  "show speedtest",
];

function isCommandAllowed(cmd: string): boolean {
  const n = cmd.trim().toLowerCase();
  return ALLOWED_SHOW_COMMANDS.some(
    (a) => n === a.toLowerCase() || n.startsWith(a.toLowerCase() + " "),
  );
}

// ─── Syslog level map ────────────────────────────────────────────────────────
// Official guide: syslog level is numeric 0-7
// 0 = Critical system failure
// 1 = Critical or unexpected unrecoverable error
// 2 = Unexpected recoverable error
// 3 = Less severe error
// 4 = Warning
// 5 = Informational message
// 6 = Debugging message
// 7 = Verbose debugging message (default)

const SYSLOG_LEVEL_NAMES: Record<number, string> = {
  0: "critical-system-failure",
  1: "critical-unrecoverable",
  2: "recoverable-error",
  3: "less-severe-error",
  4: "warning",
  5: "informational",
  6: "debug",
  7: "verbose-debug",
};

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

// ─── Input validators ────────────────────────────────────────────────────────

function validateMac(mac: string): void {
  if (!/^([0-9a-fA-F]{2}[:\-.]){5}[0-9a-fA-F]{2}$/.test(mac)) {
    throw new Error(`Invalid MAC: '${mac}'`);
  }
}

function validateIp(ip: string): void {
  if (!/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(ip)) {
    throw new Error(`Invalid IP: '${ip}'`);
  }
}

function validateSafe(value: string, label: string): void {
  if (/[;&|`$(){}]/.test(value)) {
    throw new Error(`Invalid ${label} — contains shell metacharacters`);
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
  validateSafe(target, "target");
  const output = await withSession(dev, (s) => runCommand(s, `ping ${target}`, 10000));
  return text({ device_id: dev.id, target, output });
}

async function queryDhcpReservations(dev: DeviceConfig): Promise<QueryResult> {
  const output = await withSession(dev, (s) => runCommand(s, "show ip dhcp-reservations csv", 2000));
  return text({ device_id: dev.id, command: "show ip dhcp-reservations csv", output });
}

async function querySpeedtest(dev: DeviceConfig): Promise<QueryResult> {
  const output = await withSession(dev, (s) => runCommand(s, "show speedtest", 3000));
  return text({ device_id: dev.id, command: "show speedtest", output });
}

async function queryHistory(dev: DeviceConfig, time?: string): Promise<QueryResult> {
  // Default to last 1 hour, JSON format
  const timeRange = time ?? "1h";
  validateSafe(timeRange, "time");
  const cmd = `show history begin ${timeRange} first json:`;
  const output = await withSession(dev, (s) => runCommand(s, cmd, 5000));
  return text({ device_id: dev.id, command: cmd, time_range: timeRange, output });
}

async function queryConfigDiff(dev: DeviceConfig): Promise<QueryResult> {
  const output = await withSession(dev, (s) => runCommand(s, "show running-config differences", 4000));
  return text({ device_id: dev.id, command: "show running-config differences", output });
}

async function queryNtp(dev: DeviceConfig): Promise<QueryResult> {
  const result = await withSession(dev, async (s) => ({
    ntp: await runCommand(s, "show ntp", 2000),
    status: await runCommand(s, "show ntp status", 2000),
    associations: await runCommand(s, "show ntp associations", 2000),
  }));
  return text({
    device_id: dev.id,
    ntp_config: result.ntp,
    ntp_status: result.status,
    ntp_associations: result.associations,
  });
}

// ─── Configure action handlers ──────────────────────────────────────────────
// NOTE: `configure terminal` is unnecessary on the Island CLI (fw 2.3.2) —
// configuration commands work from the global prompt. We issue commands
// directly without entering/exiting config mode.

async function configAddDhcp(
  dev: DeviceConfig, mac: string, ip: string, hostname?: string,
): Promise<QueryResult> {
  validateMac(mac);
  validateIp(ip);

  const result = await withSession(dev, async (s) => {
    let cmd = `ip dhcp-reserve ${mac} ${ip}`;
    if (hostname) cmd += ` ${hostname}`;
    const configOut = await runCommand(s, cmd, 2000);
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
  validateMac(mac);

  const result = await withSession(dev, async (s) => {
    const configOut = await runCommand(s, `no ip dhcp-reserve ${mac}`, 2000);
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
  dev: DeviceConfig, serverIp: string, port: number, level: number, protocol: string,
): Promise<QueryResult> {
  validateIp(serverIp);

  const result = await withSession(dev, async (s) => {
    const serverArg = port === 514 ? serverIp : `${serverIp}:${port}`;
    await runCommand(s, `syslog server ${serverArg}`, 2000);
    await runCommand(s, `syslog level ${level}`, 1500);
    await runCommand(s, `syslog protocol ${protocol}`, 1500);
    const writeOut = await runCommand(s, "write memory", 3000);
    const verify = await runCommand(s, "show syslog", 2000);
    return { writeOut, verify };
  });

  return text({
    configured: true, device_id: dev.id,
    server_ip: serverIp, port,
    level, level_name: SYSLOG_LEVEL_NAMES[level] ?? "unknown",
    protocol,
    write_output: result.writeOut,
    verified_config: parseSyslogConfig(result.verify),
  });
}

async function configRemoveSyslog(dev: DeviceConfig): Promise<QueryResult> {
  const result = await withSession(dev, async (s) => {
    const configOut = await runCommand(s, "no syslog server", 2000);
    const writeOut = await runCommand(s, "write memory", 3000);
    const verify = await runCommand(s, "show syslog", 2000);
    return { configOut, writeOut, verify };
  });

  return text({
    removed: true, device_id: dev.id,
    config_output: result.configOut,
    write_output: result.writeOut,
    verified_config: parseSyslogConfig(result.verify),
  });
}

async function configHostname(dev: DeviceConfig, hostname: string): Promise<QueryResult> {
  validateSafe(hostname, "hostname");

  const result = await withSession(dev, async (s) => {
    const configOut = await runCommand(s, `hostname ${hostname}`, 2000);
    const writeOut = await runCommand(s, "write memory", 3000);
    return { configOut, writeOut };
  });

  return text({
    configured: true, device_id: dev.id,
    hostname,
    config_output: result.configOut,
    write_output: result.writeOut,
  });
}

async function configAutoUpdate(
  dev: DeviceConfig, days: string, time?: string,
): Promise<QueryResult> {
  validateSafe(days, "days");

  const result = await withSession(dev, async (s) => {
    const daysOut = await runCommand(s, `auto-update days ${days}`, 2000);
    let timeOut = "";
    if (time) {
      validateSafe(time, "time");
      timeOut = await runCommand(s, `auto-update time ${time}`, 2000);
    }
    const writeOut = await runCommand(s, "write memory", 3000);
    return { daysOut, timeOut, writeOut };
  });

  return text({
    configured: true, device_id: dev.id,
    days, time: time ?? null,
    days_output: result.daysOut,
    time_output: result.timeOut || null,
    write_output: result.writeOut,
  });
}

async function configLed(dev: DeviceConfig, ledLevel: number): Promise<QueryResult> {
  const result = await withSession(dev, async (s) => {
    const configOut = await runCommand(s, `led level ${ledLevel}`, 2000);
    const writeOut = await runCommand(s, "write memory", 3000);
    return { configOut, writeOut };
  });

  return text({
    configured: true, device_id: dev.id,
    led_level: ledLevel,
    config_output: result.configOut,
    write_output: result.writeOut,
  });
}

async function configTimezone(dev: DeviceConfig, timezone: string): Promise<QueryResult> {
  validateSafe(timezone, "timezone");

  const result = await withSession(dev, async (s) => {
    const configOut = await runCommand(s, `timezone ${timezone}`, 2000);
    const writeOut = await runCommand(s, "write memory", 3000);
    const verify = await runCommand(s, "show clock", 1500);
    return { configOut, writeOut, verify };
  });

  return text({
    configured: true, device_id: dev.id,
    timezone,
    config_output: result.configOut,
    write_output: result.writeOut,
    clock_after: result.verify,
  });
}

async function configNtp(dev: DeviceConfig, ntpServer: string): Promise<QueryResult> {
  validateSafe(ntpServer, "ntp_server");

  const result = await withSession(dev, async (s) => {
    const configOut = await runCommand(s, `ntp ${ntpServer}`, 2000);
    const writeOut = await runCommand(s, "write memory", 3000);
    const verify = await runCommand(s, "show ntp", 2000);
    return { configOut, writeOut, verify };
  });

  return text({
    configured: true, device_id: dev.id,
    ntp_server: ntpServer,
    config_output: result.configOut,
    write_output: result.writeOut,
    ntp_config: result.verify,
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
  version: "0.3.0",
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
  "status",              // Full overview (interfaces, routes, neighbors, version, stats, clock)
  "interfaces",          // Parsed interface data (set detail=true for TX/RX byte counters)
  "neighbors",           // Parsed ARP table (IP → MAC → interface → state)
  "routes",              // Parsed routing table
  "logs",                // Parsed log entries + syslog config
  "config",              // Full running-config text
  "config_diff",         // Side-by-side diff of running vs startup config
  "vpns",                // VPN peer status
  "dhcp_reservations",   // DHCP reservations (CSV format, parse-friendly)
  "speedtest",           // Speed test history
  "history",             // Event history (JSON format; pass 'time' for range, e.g. '1h', '1d', '1w')
  "ntp",                 // Full NTP status (config + sync status + associations)
  "command",             // Run an allowlisted show command (pass 'command' param)
  "ping",                // ICMP ping from router (pass 'target' param)
]);

server.tool(
  "island_query",
  `Read-only query against an Island Router. Actions: status (full overview), interfaces (parsed, set detail=true for byte counters), neighbors (ARP table), routes (routing table), logs (parsed entries + syslog config), config (running-config), config_diff (running vs startup diff), vpns (peer status), dhcp_reservations (CSV format), speedtest (history), history (event history JSON — pass 'time' e.g. '1h','1d','1w'), ntp (config + status + associations), command (any allowlisted show command — pass 'command'), ping (pass 'target').`,
  {
    device_id: z.string().describe("Device ID from inventory"),
    action: QueryActions.describe("Query action to perform"),
    command: z.string().optional().describe("For action='command': the show command to run"),
    target: z.string().optional().describe("For action='ping': IP or hostname to ping"),
    detail: z.boolean().optional().default(false).describe("For action='interfaces': true for detailed TX/RX stats"),
    time: z.string().optional().describe("For action='history': time range (e.g. '1h', '1d', '30m', '1w')"),
  },
  async ({ device_id, action, command, target, detail, time }) => {
    const dev = getDeviceOrThrow(device_id);

    switch (action) {
      case "status":             return queryStatus(dev);
      case "interfaces":         return queryInterfaces(dev, detail);
      case "neighbors":          return queryNeighbors(dev);
      case "routes":             return queryRoutes(dev);
      case "logs":               return queryLogs(dev);
      case "config":             return queryConfig(dev);
      case "config_diff":        return queryConfigDiff(dev);
      case "vpns":               return queryVpns(dev);
      case "dhcp_reservations":  return queryDhcpReservations(dev);
      case "speedtest":          return querySpeedtest(dev);
      case "history":            return queryHistory(dev, time);
      case "ntp":                return queryNtp(dev);
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
  "add_dhcp",         // Add DHCP reservation (mac, ip, hostname?)
  "remove_dhcp",      // Remove DHCP reservation (mac)
  "set_syslog",       // Configure syslog forwarding (server_ip, port?, level?, protocol?)
  "remove_syslog",    // Remove syslog server
  "set_hostname",     // Set router hostname (hostname)
  "set_auto_update",  // Configure auto-update schedule (days, time_str?)
  "set_led",          // Set LED brightness (led_level: 0-100)
  "set_timezone",     // Set system timezone (timezone)
  "set_ntp",          // Set NTP server (ntp_server)
]);

server.tool(
  "island_configure",
  `WRITE operation on an Island Router — persists changes with 'write memory'. Requires confirmation_phrase='apply_change'. Actions: add_dhcp (mac, ip, hostname?), remove_dhcp (mac), set_syslog (server_ip, port?, level 0-7, protocol?), remove_syslog, set_hostname (hostname), set_auto_update (days e.g. 'all'/'none'/'monday friday', time_str e.g. '3:00'), set_led (led_level 0-100), set_timezone (timezone e.g. 'US' or 'America/Los_Angeles'), set_ntp (ntp_server).`,
  {
    device_id: z.string().describe("Device ID from inventory"),
    action: ConfigureActions.describe("Configuration action"),
    confirmation_phrase: z.literal("apply_change").describe("Must be exactly 'apply_change' to proceed"),
    // DHCP params
    mac: z.string().optional().describe("MAC address (for add_dhcp / remove_dhcp)"),
    ip: z.string().optional().describe("IPv4 address (for add_dhcp)"),
    hostname: z.string().optional().describe("Hostname label (for add_dhcp / set_hostname)"),
    // Syslog params
    server_ip: z.string().optional().describe("Syslog server IP (for set_syslog)"),
    port: z.number().optional().default(514).describe("Syslog port (for set_syslog, default 514)"),
    level: z.number().min(0).max(7).optional().default(7).describe(
      "Syslog severity level 0-7 (0=critical-failure, 4=warning, 5=info, 6=debug, 7=verbose-debug). Default 7.",
    ),
    protocol: z.enum(["udp", "tcp"]).optional().default("udp").describe("Syslog transport protocol"),
    // Auto-update params
    days: z.string().optional().describe("For set_auto_update: day(s) — 'all', 'none', or weekday names separated by spaces"),
    time_str: z.string().optional().describe("For set_auto_update: time as hh:mm (e.g. '3:00')"),
    // LED params
    led_level: z.number().min(0).max(100).optional().describe("For set_led: brightness 0 (off) to 100 (full)"),
    // Timezone params
    timezone: z.string().optional().describe("For set_timezone: 2-letter country code or timezone name (e.g. 'US', 'America/Los_Angeles')"),
    // NTP params
    ntp_server: z.string().optional().describe("For set_ntp: NTP server address"),
  },
  async (params) => {
    if (params.confirmation_phrase !== "apply_change") {
      throw new Error("confirmation_phrase must be exactly 'apply_change'");
    }

    const dev = getDeviceOrThrow(params.device_id);

    switch (params.action) {
      case "add_dhcp": {
        if (!params.mac) throw new Error("'mac' required for add_dhcp");
        if (!params.ip) throw new Error("'ip' required for add_dhcp");
        return configAddDhcp(dev, params.mac, params.ip, params.hostname);
      }
      case "remove_dhcp": {
        if (!params.mac) throw new Error("'mac' required for remove_dhcp");
        return configRemoveDhcp(dev, params.mac);
      }
      case "set_syslog": {
        if (!params.server_ip) throw new Error("'server_ip' required for set_syslog");
        return configSyslog(dev, params.server_ip, params.port, params.level, params.protocol);
      }
      case "remove_syslog": {
        return configRemoveSyslog(dev);
      }
      case "set_hostname": {
        if (!params.hostname) throw new Error("'hostname' required for set_hostname");
        return configHostname(dev, params.hostname);
      }
      case "set_auto_update": {
        if (!params.days) throw new Error("'days' required for set_auto_update");
        return configAutoUpdate(dev, params.days, params.time_str);
      }
      case "set_led": {
        if (params.led_level === undefined) throw new Error("'led_level' required for set_led");
        return configLed(dev, params.led_level);
      }
      case "set_timezone": {
        if (!params.timezone) throw new Error("'timezone' required for set_timezone");
        return configTimezone(dev, params.timezone);
      }
      case "set_ntp": {
        if (!params.ntp_server) throw new Error("'ntp_server' required for set_ntp");
        return configNtp(dev, params.ntp_server);
      }
      default:
        throw new Error(`Unknown configure action: '${params.action}'`);
    }
  },
);

// ═════════════════════════════════════════════════════════════════════════════
// Server startup
// ═════════════════════════════════════════════════════════════════════════════

process.stderr.write(
  `[island-mcp] Starting v0.3.0 (meta-tool) with ${devices.length} device(s)\n`,
);
const transport = new StdioServerTransport();
await server.connect(transport);
