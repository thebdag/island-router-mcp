#!/usr/bin/env node
/**
 * server.ts — Thin MCP adapter over the Island Router core.
 *
 * Prefer `island-axi` for agent shell workflows. This server exists for
 * MCP-only hosts and shares the same action core as the AXI CLI.
 *
 * Meta-tools: island_list_devices | island_query | island_configure
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import fs from "node:fs";
import "dotenv/config";

import type { DeviceConfig } from "./islandSsh.js";
import { getDeviceOrThrow as lookupDevice, loadDevices } from "./devices.js";
import {
  CONFIGURE_ACTIONS,
  dispatchConfigure,
  dispatchQuery,
  QUERY_ACTIONS,
  type QueryAction,
} from "./core/index.js";

const inventoryPath = process.env["ISLAND_DEVICE_INVENTORY"] ?? "devices.json";
const devices: DeviceConfig[] = loadDevices(inventoryPath);
if (!fs.existsSync(inventoryPath)) {
  process.stderr.write(
    `[island-mcp] No devices.json at '${inventoryPath}', using env-based default\n`,
  );
}

function getDeviceOrThrow(deviceId: string): DeviceConfig {
  return lookupDevice(devices, deviceId);
}

type McpText = { content: Array<{ type: "text"; text: string }> };

function text(obj: unknown): McpText {
  return { content: [{ type: "text" as const, text: JSON.stringify(obj, null, 2) }] };
}

const server = new McpServer({
  name: "island-router-mcp",
  version: "0.5.0",
});

server.tool(
  "island_list_devices",
  "List all configured Island Router devices. No SSH needed.",
  {},
  async () =>
    text(
      devices.map(({ id, host, port, description }) => ({
        id,
        host,
        port,
        description: description ?? null,
      })),
    ),
);

const QueryActions = z.enum(QUERY_ACTIONS);

server.tool(
  "island_query",
  `Read-only query against an Island Router (shared core with island-axi). Actions: ${QUERY_ACTIONS.join(", ")}.`,
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
    const result = await dispatchQuery(dev, {
      action: action as QueryAction,
      command,
      target,
      detail,
      time,
    });

    // Preserve raw running-config text for MCP clients expecting plain config body
    if (action === "config" && result && typeof result === "object" && "config" in result) {
      return {
        content: [{ type: "text" as const, text: String((result as { config: string }).config) }],
      };
    }
    return text(result);
  },
);

const ConfigureActions = z.enum(CONFIGURE_ACTIONS);

server.tool(
  "island_configure",
  `WRITE operation on an Island Router via shared core — persists with write memory. Requires confirmation_phrase='apply_change'. Actions: ${CONFIGURE_ACTIONS.join(", ")}.`,
  {
    device_id: z.string().describe("Device ID from inventory"),
    action: ConfigureActions.describe("Configuration action"),
    confirmation_phrase: z.literal("apply_change").describe("Must be exactly 'apply_change' to proceed"),
    mac: z.string().optional().describe("MAC address (for add_dhcp / remove_dhcp)"),
    ip: z.string().optional().describe("IPv4 address (for add_dhcp)"),
    hostname: z.string().optional().describe("Hostname label (for add_dhcp / set_hostname)"),
    server_ip: z.string().optional().describe("Syslog server IP (for set_syslog)"),
    port: z.number().optional().default(514).describe("Syslog port (for set_syslog, default 514)"),
    level: z.number().min(0).max(7).optional().default(7).describe(
      "Syslog severity level 0-7 (0=critical-failure, 4=warning, 5=info, 6=debug, 7=verbose-debug). Default 7.",
    ),
    protocol: z.enum(["udp", "tcp"]).optional().default("udp").describe("Syslog transport protocol"),
    days: z.string().optional().describe("For set_auto_update: day(s) — 'all', 'none', or weekday names"),
    time_str: z.string().optional().describe("For set_auto_update: time as hh:mm (e.g. '3:00')"),
    url: z
      .string()
      .optional()
      .describe(
        "For update: optional firmware/package URL or filename (omit to check/install latest from Island)",
      ),
    led_level: z.number().min(0).max(100).optional().describe("For set_led: brightness 0-100"),
    timezone: z.string().optional().describe("For set_timezone: country code or timezone name"),
    ntp_server: z.string().optional().describe("For set_ntp: NTP server address"),
    domain: z.string().optional().describe("For DNS redirect actions: domain name"),
    redirect_server: z.string().optional().describe("For add_dns_redirect: redirect IP (0.0.0.0 to sinkhole)"),
  },
  async (params) => {
    if (params.confirmation_phrase !== "apply_change") {
      throw new Error("confirmation_phrase must be exactly 'apply_change'");
    }
    const dev = getDeviceOrThrow(params.device_id);
    return text(await dispatchConfigure(dev, params));
  },
);

process.stderr.write(
  `[island-mcp] Starting v0.5.0 (core + thin MCP adapter) with ${devices.length} device(s)\n`,
);
const transport = new StdioServerTransport();
await server.connect(transport);
