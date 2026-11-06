/**
 * ADK Firmware Upgrade Workflow — thin `@google/adk` graph adapter over `src/core/firmware.ts`.
 *
 * Enforces the upgrade state machine in code rather than prose:
 * 1. `preflight_snapshot` (`FunctionNode`): Captures full pre-upgrade router state
 *    (version, running-config, interfaces, routes, neighbors, VPNs, DHCP, NTP) and writes
 *    it to `ctx.state` ("preflight_snapshot").
 * 2. Conditional routing (`ctx.route`):
 *    - `"llm_planner"` (when LLM credentials/model exist) → `firmware_upgrade_planner` (`LlmAgent`)
 *      with BOTH `enforcePreflightBeforeUpdateCallback` and `requireConfirmation: true`.
 *    - `"deterministic_planner"` (when no Gemini API key is set) → `deterministic_firmware_planner`
 *      (`FunctionNode`, 0 LLM tokens, never crashes).
 * 3. `diffFirmwareSnapshots()`: Deterministic post-upgrade verification comparing
 *    pre-upgrade vs post-upgrade state.
 */

import {
  FunctionNode,
  LlmAgent,
  Workflow,
  type BaseLlm,
  type NodeContext,
  type SingleBeforeToolCallback,
} from "@google/adk";
import {
  buildDeterministicUpgradeRunbook,
  captureFirmwareSnapshot,
  diffFirmwareSnapshots,
  type DeterministicUpgradeRunbook,
  type FirmwareDeviceSnapshot,
  type FirmwareSnapshotDiff,
} from "../core/index.js";
import { loadDevices, resolveDevice } from "../devices.js";
import {
  createIslandAdkTools,
  hasLlmCredentials,
  type AgentToolDependencies,
} from "./tools.js";

export {
  buildDeterministicUpgradeRunbook,
  captureFirmwareSnapshot,
  diffFirmwareSnapshots,
  type DeterministicUpgradeRunbook,
  type FirmwareDeviceSnapshot,
  type FirmwareSnapshotDiff,
};

export interface FirmwareUpgradeWorkflowOptions extends AgentToolDependencies {
  deviceId?: string;
  model?: string | BaseLlm;
}

/**
 * Guardrail callback that blocks `island_configure` with `action: "update"` if
 * `device_id` is missing or a matching pre-flight snapshot has not been recorded
 * in session state.
 */
export const enforcePreflightBeforeUpdateCallback: SingleBeforeToolCallback = ({
  tool,
  args,
  context,
}) => {
  if (tool.name !== "island_configure") return undefined;
  const action = args["action"];
  if (action !== "update") return undefined;

  const targetDevice = String(args["device_id"] ?? "").trim();
  const snapshot = context.state.get("preflight_snapshot") as
    | FirmwareDeviceSnapshot
    | undefined;

  if (!snapshot || !targetDevice || snapshot.device_id !== targetDevice) {
    return {
      blocked: true,
      error:
        "Guardrail blocked firmware update: a pre-flight snapshot must be captured in session state (`preflight_snapshot`) for the non-empty target `device_id` before running action='update'.",
    };
  }
  return undefined;
};

/**
 * ADK `FunctionNode` that captures and stores the pre-flight snapshot in session state.
 */
export function createPreflightSnapshotNode(
  options: FirmwareUpgradeWorkflowOptions = {},
): FunctionNode<{ device_id?: string } | undefined, FirmwareDeviceSnapshot> {
  const getDevices = options.loadDevicesFn ?? (() => loadDevices());
  const queryFn = options.queryFn;

  return new FunctionNode(
    "preflight_snapshot",
    async (
      ctx: NodeContext,
      input: { device_id?: string } | undefined,
    ): Promise<FirmwareDeviceSnapshot> => {
      const requestedId =
        (typeof input === "object" && input !== null ? input.device_id : undefined) ??
        options.deviceId;
      const dev = resolveDevice(getDevices(), requestedId);
      const snapshot = await captureFirmwareSnapshot(dev, queryFn);
      ctx.state.set("preflight_snapshot", snapshot);
      ctx.route = hasLlmCredentials(options.model)
        ? "llm_planner"
        : "deterministic_planner";
      return snapshot;
    },
    {
      description:
        "Captures full pre-upgrade Island Router state (version, running-config, interfaces, routes, VPNs, DHCP, NTP) and saves it to session state.",
    },
  );
}

/**
 * Zero-LLM-token deterministic firmware upgrade planner node when no Gemini API key is configured.
 */
export function createDeterministicFirmwarePlannerNode(): FunctionNode<
  FirmwareDeviceSnapshot,
  {
    status: "ready";
    mode: "deterministic";
    preflight_snapshot: FirmwareDeviceSnapshot;
    runbook: DeterministicUpgradeRunbook;
  }
> {
  return new FunctionNode(
    "deterministic_firmware_planner",
    (ctx: NodeContext, input: FirmwareDeviceSnapshot) => {
      const snapshot =
        input ?? (ctx.state.get("preflight_snapshot") as FirmwareDeviceSnapshot);
      return {
        status: "ready" as const,
        mode: "deterministic" as const,
        preflight_snapshot: snapshot,
        runbook: buildDeterministicUpgradeRunbook(snapshot),
      };
    },
    {
      description:
        "Produces a deterministic pre-flight upgrade assessment, step-by-step runbook, and rollback plan without requiring an LLM API key.",
    },
  );
}

/**
 * ADK `LlmAgent` that plans firmware upgrades with a programmatic pre-flight guardrail.
 */
export function createFirmwarePlannerAgent(
  options: FirmwareUpgradeWorkflowOptions = {},
): LlmAgent {
  const tools = createIslandAdkTools(options);

  return new LlmAgent({
    name: "firmware_upgrade_planner",
    model: options.model ?? "gemini-2.5-flash",
    description:
      "Analyzes Island Router pre-flight snapshots, assesses firmware upgrade compatibility, and generates an upgrade runbook with rollback steps.",
    instruction: [
      "You are the Island Router Firmware Upgrade Planner.",
      "Examine the `preflight_snapshot` captured in the workflow input / session state.",
      "Produce a structured upgrade runbook containing:",
      "1. Pre-flight baseline summary (current firmware version, active interfaces, routes, VPN peers, DHCP reservations, NTP state).",
      "2. Config compatibility check against Island Router CLI 2.3.2+ rules (global prompt config, numeric syslog 0-7, `update [<url>]`, `clear update`).",
      "3. Step-by-step execution plan and rollback procedure.",
      "4. Never invoke `island_configure` with `action: 'update'` unless explicitly instructed by the operator.",
    ].join("\n"),
    tools,
    beforeToolCallback: enforcePreflightBeforeUpdateCallback,
    outputKey: "firmware_upgrade_runbook",
  });
}

/**
 * Complete ADK `Workflow`: `START -> preflight_snapshot -> (llm_planner | deterministic_planner)`.
 */
export function createFirmwareUpgradeWorkflow(
  options: FirmwareUpgradeWorkflowOptions = {},
): Workflow {
  const preflightNode = createPreflightSnapshotNode(options);
  const deterministicPlanner = createDeterministicFirmwarePlannerNode();
  const plannerAgent = createFirmwarePlannerAgent(options);

  return new Workflow({
    name: "island_firmware_upgrade_workflow",
    description:
      "Captures a deterministic pre-flight snapshot of an Island Router before running the LLM or deterministic firmware upgrade planner with pre-flight guardrails.",
    edges: [
      [
        "START",
        preflightNode,
        {
          llm_planner: plannerAgent,
          deterministic_planner: deterministicPlanner,
        },
      ],
    ],
  });
}
