#!/usr/bin/env node
/**
 * server.ts — Island Router MCP Server
 *
 * Exposes Island Router CLI operations as MCP tools for use with
 * Google Antigravity and other MCP-compatible AI assistants.
 *
 * Tools:
 *   - island_list_devices        (read-only, no SSH)
 *   - island_show_status         (read-only, SSH queries)
 *   - island_show_interfaces     (read-only, parsed JSON)
 *   - island_show_neighbors      (read-only, parsed JSON)
 *   - island_show_routes         (read-only, parsed JSON)
 *   - island_show_logs           (read-only, parsed JSON)
 *   - island_show_config         (read-only, returns running-config)
 *   - island_show_vpns           (read-only, returns VPN status)
 *   - island_run_command         (read-only, allowlisted show commands)
 *   - island_ping                (read-only, ICMP from router)
 *   - island_add_dhcp_reservation  (write, guarded)
 *   - island_remove_dhcp_reservation (write, guarded)
 *   - island_configure_syslog    (write, guarded)
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
  // Fallback: single device from env
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
    `[island-mcp] No devices.json found at '${inventoryPath}', using env-based default device\n`,
  );
}

function getDeviceOrThrow(deviceId: string): DeviceConfig {
  const dev = devices.find((d) => d.id === deviceId);
  if (!dev) {
    const available = devices.map((d) => d.id).join(", ");
    throw new Error(
      `Unknown device_id '${deviceId}'. Available devices: ${available}`,
    );
  }
  return dev;
}

// ─── Allowlisted commands ────────────────────────────────────────────────────

const ALLOWED_SHOW_COMMANDS = [
  "show version",
  "show hardware",
  "show clock",
  "show users",
  "show free-space",
  "show public-key",
  "show running-config",
  "show startup-config",
  "show history",
  "show dumps",
  "show packages",
  "show interface",
  "show interface summary",
  "show interface transceivers",
  "show ip interface",
  "show ip routes",
  "show ip neighbors",
  "show ip sockets",
  "show ip dhcp-reservations",
  "show ip recommendations",
  "show vpns",
  "show ntp",
  "show syslog",
  "show log",
  "show stats",
  "show config authorized-keys",
  "show config known-hosts",
  "show ssh-client-keys",
];

function isCommandAllowed(cmd: string): boolean {
  const normalized = cmd.trim().toLowerCase();
  // Allow exact matches and commands that start with an allowed prefix + space
  // (e.g., "show stats cpu" should be allowed if "show stats" is allowed)
  return ALLOWED_SHOW_COMMANDS.some(
    (allowed) =>
      normalized === allowed.toLowerCase() ||
      normalized.startsWith(allowed.toLowerCase() + " "),
  );
}

// ─── Session helper ──────────────────────────────────────────────────────────

/**
 * Open a session, run the callback, and always close the session.
 */
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

// ─── MCP Server ──────────────────────────────────────────────────────────────

const server = new McpServer({
  name: "island-router-mcp",
  version: "0.1.0",
});

// ═══════════════════════════════════════════════════════════════════════════════
// Tool: island_list_devices
// ═══════════════════════════════════════════════════════════════════════════════

server.tool(
  "island_list_devices",
  "List all configured Island Router devices in the inventory. Returns device IDs, hosts, and ports. No SSH connection required.",
  {},
  async () => {
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(
            devices.map(({ id, host, port, description }) => ({
              id,
              host,
              port,
              description: description ?? null,
            })),
            null,
            2,
          ),
        },
      ],
    };
  },
);

// ═══════════════════════════════════════════════════════════════════════════════
// Tool: island_show_status
// ═══════════════════════════════════════════════════════════════════════════════

server.tool(
  "island_show_status",
  "Get a comprehensive status overview of an Island Router. Returns interface summary, IP configuration, routes, ARP neighbors, system version, and internal stats. All read-only — no configuration changes.",
  {
    device_id: z.string().describe("ID of the Island Router device from the inventory"),
  },
  async ({ device_id }) => {
    const dev = getDeviceOrThrow(device_id);

    const result = await withSession(dev, async (session) => {
      const commands = [
        { cmd: "show interface summary", waitMs: 2000 },
        { cmd: "show ip interface", waitMs: 2000 },
        { cmd: "show ip routes", waitMs: 2000 },
        { cmd: "show ip neighbors", waitMs: 2000 },
        { cmd: "show version", waitMs: 2000 },
        { cmd: "show stats", waitMs: 2000 },
        { cmd: "show clock", waitMs: 1500 },
      ];

      const outputs: Record<string, string> = {};
      for (const { cmd, waitMs } of commands) {
        outputs[cmd] = await runCommand(session, cmd, waitMs);
      }
      return outputs;
    });

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(
            {
              device_id,
              host: dev.host,
              interfaces_raw: result["show interface summary"],
              ip_interfaces_raw: result["show ip interface"],
              routes_raw: result["show ip routes"],
              neighbors_raw: result["show ip neighbors"],
              version_raw: result["show version"],
              stats_raw: result["show stats"],
              clock_raw: result["show clock"],
            },
            null,
            2,
          ),
        },
      ],
    };
  },
);

// ═══════════════════════════════════════════════════════════════════════════════
// Tool: island_show_interfaces
// ═══════════════════════════════════════════════════════════════════════════════

server.tool(
  "island_show_interfaces",
  "Get interface details from an Island Router, parsed into structured JSON. Returns interface names, statuses, TX/RX bytes, errors, MTU, MAC addresses, and more.",
  {
    device_id: z.string().describe("ID of the Island Router device"),
    detail: z
      .boolean()
      .optional()
      .default(false)
      .describe("If true, return detailed per-interface stats (TX/RX bytes, errors). If false, return summary table."),
  },
  async ({ device_id, detail }) => {
    const dev = getDeviceOrThrow(device_id);
    const cmd = detail ? "show interface" : "show interface summary";

    const output = await withSession(dev, (s) => runCommand(s, cmd, 3000));
    const parsed = detail
      ? parseInterfaceDetail(output)
      : parseInterfaceSummary(output);

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({ device_id, command: cmd, interfaces: parsed }, null, 2),
        },
      ],
    };
  },
);

// ═══════════════════════════════════════════════════════════════════════════════
// Tool: island_show_neighbors
// ═══════════════════════════════════════════════════════════════════════════════

server.tool(
  "island_show_neighbors",
  "Get the ARP/neighbor table from an Island Router, parsed into structured JSON. Shows IP addresses, MAC addresses, interfaces, and connection states for all devices on the network.",
  {
    device_id: z.string().describe("ID of the Island Router device"),
  },
  async ({ device_id }) => {
    const dev = getDeviceOrThrow(device_id);

    const output = await withSession(dev, (s) => runCommand(s, "show ip neighbors", 2000));
    const parsed = parseNeighbors(output);

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({ device_id, neighbor_count: parsed.length, neighbors: parsed }, null, 2),
        },
      ],
    };
  },
);

// ═══════════════════════════════════════════════════════════════════════════════
// Tool: island_show_routes
// ═══════════════════════════════════════════════════════════════════════════════

server.tool(
  "island_show_routes",
  "Get the routing table from an Island Router, parsed into structured JSON. Shows destinations, gateways, interfaces, metrics, and route types.",
  {
    device_id: z.string().describe("ID of the Island Router device"),
  },
  async ({ device_id }) => {
    const dev = getDeviceOrThrow(device_id);

    const output = await withSession(dev, (s) => runCommand(s, "show ip routes", 2000));
    const parsed = parseRoutes(output);

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({ device_id, route_count: parsed.length, routes: parsed }, null, 2),
        },
      ],
    };
  },
);

// ═══════════════════════════════════════════════════════════════════════════════
// Tool: island_show_logs
// ═══════════════════════════════════════════════════════════════════════════════

server.tool(
  "island_show_logs",
  "Get recent log entries from an Island Router, parsed into structured JSON. Returns timestamps, severity levels, facilities, and messages. Also returns syslog forwarding configuration.",
  {
    device_id: z.string().describe("ID of the Island Router device"),
  },
  async ({ device_id }) => {
    const dev = getDeviceOrThrow(device_id);

    const result = await withSession(dev, async (session) => {
      const logOutput = await runCommand(session, "show log", 3000);
      const syslogOutput = await runCommand(session, "show syslog", 2000);
      return { logOutput, syslogOutput };
    });

    const entries = parseLogEntries(result.logOutput);
    const syslogConfig = parseSyslogConfig(result.syslogOutput);

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(
            {
              device_id,
              entry_count: entries.length,
              syslog_config: syslogConfig,
              entries: entries.slice(-100), // last 100 entries
            },
            null,
            2,
          ),
        },
      ],
    };
  },
);

// ═══════════════════════════════════════════════════════════════════════════════
// Tool: island_show_config
// ═══════════════════════════════════════════════════════════════════════════════

server.tool(
  "island_show_config",
  "Get the current running configuration from an Island Router. Returns the full running-config text. Read-only — no changes made.",
  {
    device_id: z.string().describe("ID of the Island Router device"),
  },
  async ({ device_id }) => {
    const dev = getDeviceOrThrow(device_id);
    const output = await withSession(dev, (s) => runCommand(s, "show running-config", 4000));

    return {
      content: [{ type: "text" as const, text: output }],
    };
  },
);

// ═══════════════════════════════════════════════════════════════════════════════
// Tool: island_show_vpns
// ═══════════════════════════════════════════════════════════════════════════════

server.tool(
  "island_show_vpns",
  "Get VPN status and peer list from an Island Router. Returns raw CLI output from 'show vpns'. Read-only.",
  {
    device_id: z.string().describe("ID of the Island Router device"),
  },
  async ({ device_id }) => {
    const dev = getDeviceOrThrow(device_id);
    const output = await withSession(dev, (s) => runCommand(s, "show vpns", 2000));

    return {
      content: [{ type: "text" as const, text: output }],
    };
  },
);

// ═══════════════════════════════════════════════════════════════════════════════
// Tool: island_run_command (allowlisted read-only)
// ═══════════════════════════════════════════════════════════════════════════════

server.tool(
  "island_run_command",
  "Run an allowlisted read-only 'show' command on an Island Router. Only show commands are permitted (show version, show interface, show ip routes, etc.). Returns raw CLI output.",
  {
    device_id: z.string().describe("ID of the Island Router device"),
    command: z.string().describe("The show command to run (e.g., 'show ip sockets', 'show stats')"),
  },
  async ({ device_id, command }) => {
    if (!isCommandAllowed(command)) {
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                error: `Command not allowed: '${command}'`,
                hint: "Only read-only 'show' commands are permitted through this tool.",
                allowed_commands: ALLOWED_SHOW_COMMANDS,
              },
              null,
              2,
            ),
          },
        ],
        isError: true,
      };
    }

    const dev = getDeviceOrThrow(device_id);
    const output = await withSession(dev, (s) => runCommand(s, command, 3000));

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({ device_id, command, output }, null, 2),
        },
      ],
    };
  },
);

// ═══════════════════════════════════════════════════════════════════════════════
// Tool: island_ping
// ═══════════════════════════════════════════════════════════════════════════════

server.tool(
  "island_ping",
  "Send an ICMP ping from the Island Router to test reachability of a host. Returns raw ping output.",
  {
    device_id: z.string().describe("ID of the Island Router device"),
    target: z.string().describe("IP address or hostname to ping"),
  },
  async ({ device_id, target }) => {
    // Validate target — basic sanity check
    if (/[;&|`$(){}]/.test(target)) {
      throw new Error("Invalid target — contains shell metacharacters");
    }

    const dev = getDeviceOrThrow(device_id);
    const output = await withSession(dev, (s) => runCommand(s, `ping ${target}`, 10000));

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({ device_id, target, output }, null, 2),
        },
      ],
    };
  },
);

// ═══════════════════════════════════════════════════════════════════════════════
// Tool: island_add_dhcp_reservation (WRITE — guarded)
// ═══════════════════════════════════════════════════════════════════════════════

server.tool(
  "island_add_dhcp_reservation",
  "Add a DHCP reservation on an Island Router, permanently binding a MAC address to an IP address. WRITE operation — persists the change with 'write memory'. Requires exact confirmation phrase 'apply_change' to proceed.",
  {
    device_id: z.string().describe("ID of the Island Router device"),
    mac: z.string().describe("MAC address (e.g., 'aa:bb:cc:dd:ee:ff')"),
    ip: z.string().describe("IPv4 address to reserve (e.g., '192.168.2.100')"),
    hostname: z
      .string()
      .optional()
      .describe("Optional hostname label for the reservation"),
    confirmation_phrase: z
      .literal("apply_change")
      .describe("Must be exactly 'apply_change' to proceed — prevents accidental writes"),
  },
  async ({ device_id, mac, ip, hostname, confirmation_phrase }) => {
    if (confirmation_phrase !== "apply_change") {
      throw new Error("confirmation_phrase must be exactly 'apply_change'");
    }

    // Validate MAC format
    if (!/^([0-9a-fA-F]{2}[:\-.]){5}[0-9a-fA-F]{2}$/.test(mac)) {
      throw new Error(`Invalid MAC address format: '${mac}'`);
    }

    // Validate IP format
    if (!/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(ip)) {
      throw new Error(`Invalid IPv4 address format: '${ip}'`);
    }

    const dev = getDeviceOrThrow(device_id);

    const result = await withSession(dev, async (session) => {
      // Enter config mode
      await runCommand(session, "configure terminal", 1500);

      // Apply the DHCP reservation
      let cmd = `ip dhcp-reserve ${mac} ${ip}`;
      if (hostname) cmd += ` ${hostname}`;
      const configOutput = await runCommand(session, cmd, 2000);

      // Exit config mode
      await runCommand(session, "end", 1000);

      // Persist
      const writeOutput = await runCommand(session, "write memory", 3000);

      // Verify
      const verifyOutput = await runCommand(session, "show ip dhcp-reservations", 2000);

      return { configOutput, writeOutput, verifyOutput };
    });

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(
            {
              applied: true,
              device_id,
              mac,
              ip,
              hostname: hostname ?? null,
              config_output: result.configOutput,
              write_output: result.writeOutput,
              current_reservations: result.verifyOutput,
            },
            null,
            2,
          ),
        },
      ],
    };
  },
);

// ═══════════════════════════════════════════════════════════════════════════════
// Tool: island_remove_dhcp_reservation (WRITE — guarded)
// ═══════════════════════════════════════════════════════════════════════════════

server.tool(
  "island_remove_dhcp_reservation",
  "Remove a DHCP reservation from an Island Router by MAC address. WRITE operation — persists with 'write memory'. Requires confirmation phrase 'apply_change'.",
  {
    device_id: z.string().describe("ID of the Island Router device"),
    mac: z.string().describe("MAC address of the reservation to remove"),
    confirmation_phrase: z
      .literal("apply_change")
      .describe("Must be exactly 'apply_change' to proceed"),
  },
  async ({ device_id, mac, confirmation_phrase }) => {
    if (confirmation_phrase !== "apply_change") {
      throw new Error("confirmation_phrase must be exactly 'apply_change'");
    }

    if (!/^([0-9a-fA-F]{2}[:\-.]){5}[0-9a-fA-F]{2}$/.test(mac)) {
      throw new Error(`Invalid MAC address format: '${mac}'`);
    }

    const dev = getDeviceOrThrow(device_id);

    const result = await withSession(dev, async (session) => {
      await runCommand(session, "configure terminal", 1500);
      const configOutput = await runCommand(session, `no ip dhcp-reserve ${mac}`, 2000);
      await runCommand(session, "end", 1000);
      const writeOutput = await runCommand(session, "write memory", 3000);
      const verifyOutput = await runCommand(session, "show ip dhcp-reservations", 2000);

      return { configOutput, writeOutput, verifyOutput };
    });

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(
            {
              removed: true,
              device_id,
              mac,
              config_output: result.configOutput,
              write_output: result.writeOutput,
              current_reservations: result.verifyOutput,
            },
            null,
            2,
          ),
        },
      ],
    };
  },
);

// ═══════════════════════════════════════════════════════════════════════════════
// Tool: island_configure_syslog (WRITE — guarded)
// ═══════════════════════════════════════════════════════════════════════════════

server.tool(
  "island_configure_syslog",
  "Configure syslog forwarding on an Island Router. Sets the remote syslog server IP, severity level, and protocol. WRITE operation — persists with 'write memory'. Requires confirmation phrase 'apply_change'.",
  {
    device_id: z.string().describe("ID of the Island Router device"),
    server_ip: z.string().describe("IP address of the syslog server (e.g., '192.168.2.50')"),
    port: z
      .number()
      .optional()
      .default(514)
      .describe("Syslog port (default: 514)"),
    level: z
      .enum(["debug", "info", "notice", "warning", "error", "critical"])
      .optional()
      .default("info")
      .describe("Minimum severity level to forward"),
    protocol: z
      .enum(["udp", "tcp"])
      .optional()
      .default("udp")
      .describe("Transport protocol"),
    confirmation_phrase: z
      .literal("apply_change")
      .describe("Must be exactly 'apply_change' to proceed"),
  },
  async ({ device_id, server_ip, port, level, protocol, confirmation_phrase }) => {
    if (confirmation_phrase !== "apply_change") {
      throw new Error("confirmation_phrase must be exactly 'apply_change'");
    }

    if (!/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(server_ip)) {
      throw new Error(`Invalid syslog server IP: '${server_ip}'`);
    }

    const dev = getDeviceOrThrow(device_id);

    const result = await withSession(dev, async (session) => {
      await runCommand(session, "configure terminal", 1500);
      await runCommand(session, `syslog server ${server_ip} ${port}`, 2000);
      await runCommand(session, `syslog level ${level}`, 1500);
      await runCommand(session, `syslog protocol ${protocol}`, 1500);
      await runCommand(session, "end", 1000);
      const writeOutput = await runCommand(session, "write memory", 3000);
      const verifyOutput = await runCommand(session, "show syslog", 2000);

      return { writeOutput, verifyOutput };
    });

    const verifiedConfig = parseSyslogConfig(result.verifyOutput);

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(
            {
              configured: true,
              device_id,
              server_ip,
              port,
              level,
              protocol,
              write_output: result.writeOutput,
              verified_config: verifiedConfig,
            },
            null,
            2,
          ),
        },
      ],
    };
  },
);

// ═══════════════════════════════════════════════════════════════════════════════
// Server startup
// ═══════════════════════════════════════════════════════════════════════════════

async function main() {
  process.stderr.write(
    `[island-mcp] Starting Island Router MCP server v0.1.0 with ${devices.length} device(s)\n`,
  );
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  process.stderr.write(`[island-mcp] Fatal error: ${err}\n`);
  process.exit(1);
});
