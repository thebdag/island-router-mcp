/**
 * Native Google ADK tools and skill loaders backed by `src/core/`.
 *
 * Bridges Island Router's shared core layer (`dispatchQuery`, `dispatchConfigure`,
 * `actionCatalog`, `loadDevices`) directly into `@google/adk` without MCP stdio
 * serialization overhead, while enforcing human-in-the-loop (HITL) confirmation
 * on all write/firmware actions.
 */

import path from "node:path";
import {
  FunctionTool,
  LogLevel,
  SkillToolset,
  loadAllSkillsInDir,
  setLogLevel,
  type BaseTool,
} from "@google/adk";
import { z } from "zod";
import {
  ActionCatalogError,
  CONFIGURE_ACTIONS,
  QUERY_ACTIONS,
  describeAction,
  dispatchConfigure,
  dispatchQuery,
  formatActionError,
  formatDescribe,
  listActions,
  pickActionParams,
  type ConfigureParams,
  type QueryParams,
} from "../core/index.js";
import { getDeviceOrThrow, loadDevices } from "../devices.js";
import type { DeviceConfig } from "../islandSsh.js";
import { resolveLocalPath } from "../safePath.js";

export interface AgentToolDependencies {
  loadDevicesFn?: () => DeviceConfig[];
  queryFn?: (dev: DeviceConfig, params: QueryParams) => Promise<unknown>;
  configureFn?: (
    dev: DeviceConfig,
    params: ConfigureParams,
  ) => Promise<Record<string, unknown>>;
}

/**
 * Create the 4 progressive Island Router tools as native `@google/adk` FunctionTools.
 * Accepts optional dependency overrides for deterministic unit/trajectory testing.
 */
export function createIslandAdkTools(deps: AgentToolDependencies = {}): BaseTool[] {
  const getDevices = deps.loadDevicesFn ?? (() => loadDevices());
  const runQuery = deps.queryFn ?? dispatchQuery;
  const runConfigure = deps.configureFn ?? dispatchConfigure;

  const listDevicesTool = new FunctionTool({
    name: "island_list_devices",
    description:
      "List all configured Island Router devices from the inventory without opening SSH connections.",
    parameters: z.object({}),
    execute: async () => {
      const devices = getDevices().map((d) => ({
        id: d.id,
        host: d.host,
        port: d.port ?? 22,
        username: d.username,
        authMethod: d.authMethod,
        description: d.description ?? "",
      }));
      return { count: devices.length, devices };
    },
  });

  const actionsTool = new FunctionTool({
    name: "island_actions",
    description:
      "List or describe Island Router query and configure actions (no SSH). Pass `action` for full parameter schema and example.",
    parameters: z.object({
      action: z
        .string()
        .optional()
        .describe("Exact action name to inspect (e.g. 'ping', 'set_syslog')."),
      query: z
        .string()
        .optional()
        .describe("Substring filter on action name or summary."),
      kind: z
        .enum(["query", "configure"])
        .optional()
        .describe("Filter catalog by read-only ('query') or write ('configure')."),
    }),
    execute: async ({ action, query, kind }) => {
      if (action !== undefined) {
        try {
          return formatDescribe(describeAction(action));
        } catch (err) {
          if (err instanceof ActionCatalogError) {
            return err.payload;
          }
          throw err;
        }
      }
      return listActions({ query, kind });
    },
  });

  const queryTool = new FunctionTool({
    name: "island_query",
    description:
      "Execute a read-only query action on an Island Router device and return structured telemetry.",
    parameters: z.object({
      device_id: z
        .string()
        .describe("Target device ID from island_list_devices."),
      action: z
        .enum(QUERY_ACTIONS)
        .describe("Read-only query action to execute."),
      params: z
        .record(z.string(), z.unknown())
        .optional()
        .describe(
          "Action-specific parameters (e.g. { target: '1.1.1.1' } for ping, { detail: true } for interfaces).",
        ),
    }),
    execute: async ({ device_id, action, params }) => {
      const dev = getDeviceOrThrow(getDevices(), device_id);
      try {
        const spec = describeAction(action);
        const picked = pickActionParams(spec, params) as unknown as QueryParams;
        return await runQuery(dev, picked);
      } catch (err) {
        if (err instanceof ActionCatalogError) {
          return err.payload;
        }
        const msg = err instanceof Error ? err.message : String(err);
        return formatActionError(action, msg);
      }
    },
  });

  const configureTool = new FunctionTool({
    name: "island_configure",
    description:
      "Execute a configuration or firmware action on an Island Router. Runs directly at the global prompt and persists config changes with `write memory`.",
    parameters: z.object({
      device_id: z
        .string()
        .describe("Target device ID from island_list_devices."),
      action: z
        .enum(CONFIGURE_ACTIONS)
        .describe("Write or firmware action to execute."),
      params: z
        .record(z.string(), z.unknown())
        .optional()
        .describe("Action-specific configuration parameters."),
    }),
    // Native ADK Human-in-the-Loop (HITL) gate: pauses LlmAgent execution
    // and emits an `adk_request_confirmation` interrupt before mutating router state.
    requireConfirmation: true,
    execute: async ({ device_id, action, params }) => {
      const dev = getDeviceOrThrow(getDevices(), device_id);
      try {
        const spec = describeAction(action);
        const picked = pickActionParams(spec, params) as unknown as ConfigureParams;
        return await runConfigure(dev, picked);
      } catch (err) {
        if (err instanceof ActionCatalogError) {
          return err.payload;
        }
        const msg = err instanceof Error ? err.message : String(err);
        return formatActionError(action, msg);
      }
    },
  });

  return [listDevicesTool, actionsTool, queryTool, configureTool];
}

/**
 * Load `.agent/skills/` (reference `.md` skills such as `island-router-cli` and `island-axi`)
 * into an ADK `SkillToolset` so LlmAgents can progressively read CLI syntax on demand.
 */
export async function createIslandSkillToolset(
  skillsDir = path.join(process.cwd(), ".agent", "skills"),
): Promise<SkillToolset> {
  const safeDir = resolveLocalPath(skillsDir, "skills directory");
  // Suppress @google/adk's warn logs for optional missing `references/` or `assets/` folders.
  setLogLevel(LogLevel.ERROR);
  const skills = await loadAllSkillsInDir(safeDir);
  return new SkillToolset(skills, {
    allowInlineScripts: false,
  });
}
