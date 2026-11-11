#!/usr/bin/env node
/**
 * server.ts — Thin MCP adapter over the Island Router core.
 *
 * Prefer `island-axi` for agent shell workflows. This server exists for
 * MCP-only hosts and shares the same action core as the AXI CLI.
 *
 * Meta-tools: island_list_devices | island_actions | island_query | island_configure
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import fs from "node:fs";
import "dotenv/config";

import { posthog } from "./posthog.js";
import { logMcpLifecycle, shutdownPosthogLogs } from "./posthogLogs.js";
import type { DeviceConfig } from "./islandSsh.js";
import { getDeviceOrThrow as lookupDevice, loadDevices, resolveInventoryPath } from "./devices.js";
import {
  ActionCatalogError,
  CONFIGURE_ACTIONS,
  describeAction,
  dispatchConfigure,
  dispatchQuery,
  formatActionError,
  formatDescribe,
  listActions,
  pickActionParams,
  QUERY_ACTIONS,
  type ConfigureParams,
  type QueryParams,
} from "./core/index.js";

const inventoryPath = resolveInventoryPath();
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

function asErrorPayload(action: string, err: unknown): McpText {
  if (err instanceof ActionCatalogError) return text(err.payload);
  const message = err instanceof Error ? err.message : String(err);
  return text(formatActionError(action, message));
}

const ParamsRecord = z
  .record(z.union([z.string(), z.number(), z.boolean()]))
  .optional()
  .describe(
    "Action-specific fields. Call island_actions with action=<name> for the schema and example.",
  );

const server = new McpServer({
  name: "island-router-mcp",
  version: "0.5.0",
});

server.tool(
  "island_list_devices",
  "List all configured Island Router devices. No SSH needed.",
  {},
  () => {
    posthog?.capture({
      event: "island_devices_listed",
      properties: { device_count: devices.length },
    });
    return text(
      devices.map(({ id, host, port, description }) => ({
        id,
        host,
        port,
        description: description ?? null,
      })),
    );
  },
);

const QueryActions = z.enum(QUERY_ACTIONS);
const ConfigureActions = z.enum(CONFIGURE_ACTIONS);
const ActionKind = z.enum(["query", "configure"]);

server.tool(
  "island_actions",
  "Discover Island Router actions. Omit action for a compact catalog (optional query/kind filters). Pass action=<name> for full param schema and example. No SSH.",
  {
    query: z
      .string()
      .optional()
      .describe("Substring filter on action name or summary"),
    kind: ActionKind.optional().describe("Limit catalog to query or configure actions"),
    action: z
      .string()
      .optional()
      .describe("If set, return the full schema and example for this action"),
  },
  ({ query, kind, action }) => {
    const properties = {
      view: action ? "detail" : "catalog",
      has_filter: Boolean(query || kind),
    };
    try {
      if (action) {
        const response = text(formatDescribe(describeAction(action)));
        posthog?.capture({
          event: "island_actions_viewed",
          properties: { ...properties, outcome: "success" },
        });
        return response;
      }
      const response = text(listActions({ query, kind }));
      posthog?.capture({
        event: "island_actions_viewed",
        properties: { ...properties, outcome: "success" },
      });
      return response;
    } catch (err) {
      posthog?.capture({
        event: "island_actions_viewed",
        properties: { ...properties, outcome: "error" },
      });
      return asErrorPayload(action ?? "", err);
    }
  },
);

server.tool(
  "island_query",
  "Read-only Island Router query. Pass device_id, action, and params. Call island_actions to list actions and schemas.",
  {
    device_id: z.string().describe("Device ID from inventory"),
    action: QueryActions.describe("Query action to perform"),
    params: ParamsRecord,
  },
  async ({ device_id, action, params }) => {
    try {
      const spec = describeAction(action);
      const picked = pickActionParams(spec, params);
      const dev = getDeviceOrThrow(device_id);
      const result = await dispatchQuery(dev, picked as unknown as QueryParams);
      posthog?.capture({
        event: "island_query_completed",
        properties: { action, outcome: "success" },
      });

      if (action === "config" && result && typeof result === "object" && "config" in result) {
        return {
          content: [{ type: "text" as const, text: String((result as { config: string }).config) }],
        };
      }
      return text(result);
    } catch (err) {
      posthog?.capture({
        event: "island_query_completed",
        properties: { action, outcome: "error" },
      });
      return asErrorPayload(action, err);
    }
  },
);

server.tool(
  "island_configure",
  "WRITE Island Router config (persists with write memory except update/clear_update). Requires confirmation_phrase='apply_change'. Pass device_id, action, params. Call island_actions with kind='configure' for schemas.",
  {
    device_id: z.string().describe("Device ID from inventory"),
    action: ConfigureActions.describe("Configuration action"),
    confirmation_phrase: z
      .literal("apply_change")
      .describe("Must be exactly 'apply_change' to proceed"),
    params: ParamsRecord,
  },
  async ({ device_id, action, confirmation_phrase, params }) => {
    if (confirmation_phrase !== "apply_change") {
      return text({
        error: "confirmation_phrase must be exactly 'apply_change'",
        help: "Retry island_configure with confirmation_phrase='apply_change'",
      });
    }
    try {
      const spec = describeAction(action);
      const picked = pickActionParams(spec, params);
      const dev = getDeviceOrThrow(device_id);
      const result = await dispatchConfigure(dev, picked as unknown as ConfigureParams);
      posthog?.capture({
        event: "island_configuration_completed",
        properties: { action, outcome: "success" },
      });
      return text(result);
    } catch (err) {
      posthog?.capture({
        event: "island_configuration_completed",
        properties: { action, outcome: "error" },
      });
      return asErrorPayload(action, err);
    }
  },
);

let shutdownStarted = false;

function handleShutdown(): void {
  if (shutdownStarted) return;
  shutdownStarted = true;
  void Promise.race([
    Promise.all([shutdownPosthogLogs(), posthog?.shutdown(3000).catch(() => {})]),
    new Promise<void>((resolve) => setTimeout(resolve, 3000)),
  ]).finally(() => process.exit(0));
}

process.once("SIGINT", handleShutdown);
process.once("SIGTERM", handleShutdown);

process.stderr.write(
  `[island-mcp] Starting v0.5.0 (core + thin MCP adapter) with ${devices.length} device(s)\n`,
);
logMcpLifecycle("mcp_server_starting");
const transport = new StdioServerTransport();
await server.connect(transport);
logMcpLifecycle("mcp_server_connected");
