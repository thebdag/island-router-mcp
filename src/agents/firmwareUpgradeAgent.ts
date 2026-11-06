/**
 * ADK Firmware Upgrade Workflow — executable counterpart to `.agent/skills/skill-firmware-differ/SKILL.md`.
 *
 * Enforces the upgrade state machine in code rather than prose:
 * 1. `preflight_snapshot` (`FunctionNode`): Captures full pre-upgrade router state
 *    (version, running-config, interfaces, routes, neighbors, VPNs, DHCP, NTP) and writes
 *    it to `ctx.state` ("preflight_snapshot").
 * 2. `firmware_upgrade_planner` (`LlmAgent`): Analyzes compatibility, generates the
 *    upgrade runbook & rollback plan, and gates `island_configure(action="update")`
 *    behind BOTH:
 *    - A `beforeToolCallback` guardrail verifying `preflight_snapshot` exists in session state
 *    - Native ADK `requireConfirmation: true` (Human-in-the-Loop approval)
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
import { dispatchQuery, type QueryParams } from "../core/index.js";
import { loadDevices, resolveDevice } from "../devices.js";
import type { DeviceConfig } from "../islandSsh.js";
import type { DhcpReservation } from "../parsers/dhcp.js";
import type { InterfaceSummary } from "../parsers/interfaces.js";
import type { NtpConfig, NtpStatus } from "../parsers/ntp.js";
import type { Neighbor, Route } from "../parsers/routes.js";
import type { VersionInfo } from "../parsers/system.js";
import type { VpnPeer } from "../parsers/vpn.js";
import { computeConfigDrift, type ConfigDriftResult } from "./fleetAuditorAgent.js";
import { createIslandAdkTools, type AgentToolDependencies } from "./tools.js";

export interface FirmwareDeviceSnapshot {
  captured_at: string;
  device_id: string;
  host: string;
  version: VersionInfo;
  running_config: string;
  interfaces: InterfaceSummary[];
  routes: Route[];
  neighbors: Neighbor[];
  vpn_peers: VpnPeer[];
  dhcp_reservations: DhcpReservation[];
  ntp_config: NtpConfig;
  ntp_status: NtpStatus;
}

export interface FirmwareSnapshotDiff {
  device_id: string;
  version_before: string | null;
  version_after: string | null;
  version_changed: boolean;
  passed: boolean;
  regressions: string[];
  config_drift: ConfigDriftResult;
}

/**
 * Capture the complete pre-upgrade or post-upgrade device snapshot.
 */
export async function captureFirmwareSnapshot(
  dev: DeviceConfig,
  queryFn: (dev: DeviceConfig, params: QueryParams) => Promise<unknown> = dispatchQuery,
): Promise<FirmwareDeviceSnapshot> {
  const [statusRaw, configRaw, vpnsRaw, dhcpRaw, ntpRaw] = await Promise.all([
    queryFn(dev, { action: "status" }) as Promise<{
      version: VersionInfo;
      interfaces: InterfaceSummary[];
      routes: Route[];
      neighbors: Neighbor[];
    }>,
    queryFn(dev, { action: "config" }) as Promise<{ config: string }>,
    queryFn(dev, { action: "vpns" }) as Promise<{ vpn: VpnPeer[] }>,
    queryFn(dev, { action: "dhcp_reservations" }) as Promise<{
      reservations: DhcpReservation[];
    }>,
    queryFn(dev, { action: "ntp" }) as Promise<{
      ntp_config: NtpConfig;
      status: NtpStatus;
    }>,
  ]);

  return {
    captured_at: new Date().toISOString(),
    device_id: dev.id,
    host: dev.host,
    version: statusRaw.version,
    running_config: configRaw.config,
    interfaces: statusRaw.interfaces,
    routes: statusRaw.routes,
    neighbors: statusRaw.neighbors,
    vpn_peers: vpnsRaw.vpn,
    dhcp_reservations: dhcpRaw.reservations,
    ntp_config: ntpRaw.ntp_config,
    ntp_status: ntpRaw.status,
  };
}

/**
 * Deterministically compare pre-upgrade and post-upgrade snapshots to detect regressions.
 */
export function diffFirmwareSnapshots(
  pre: FirmwareDeviceSnapshot,
  post: FirmwareDeviceSnapshot,
): FirmwareSnapshotDiff {
  const regressions: string[] = [];

  const preUpIfaces = new Set(
    pre.interfaces
      .filter((i) => i.status.toLowerCase() === "up")
      .map((i) => i.name),
  );
  const postUpIfaces = new Set(
    post.interfaces
      .filter((i) => i.status.toLowerCase() === "up")
      .map((i) => i.name),
  );
  for (const ifaceName of preUpIfaces) {
    if (!postUpIfaces.has(ifaceName)) {
      regressions.push(`Interface '${ifaceName}' was up before upgrade but is down/missing after upgrade`);
    }
  }

  if (post.routes.length < pre.routes.length) {
    regressions.push(
      `Route count decreased from ${String(pre.routes.length)} to ${String(post.routes.length)}`,
    );
  }

  if (post.vpn_peers.length < pre.vpn_peers.length) {
    regressions.push(
      `VPN peer count decreased from ${String(pre.vpn_peers.length)} to ${String(post.vpn_peers.length)}`,
    );
  }

  if (post.dhcp_reservations.length < pre.dhcp_reservations.length) {
    regressions.push(
      `DHCP reservation count decreased from ${String(pre.dhcp_reservations.length)} to ${String(post.dhcp_reservations.length)}`,
    );
  }

  const configDrift = computeConfigDrift(
    post.running_config,
    pre.running_config,
  );
  if (configDrift.removed.length > 0) {
    regressions.push(
      `${String(configDrift.removed.length)} config line(s) removed after upgrade: ${configDrift.removed.slice(0, 3).join("; ")}`,
    );
  }

  return {
    device_id: post.device_id,
    version_before: pre.version.firmware || null,
    version_after: post.version.firmware || null,
    version_changed: pre.version.firmware !== post.version.firmware,
    passed: regressions.length === 0,
    regressions,
    config_drift: configDrift,
  };
}

export interface FirmwareUpgradeWorkflowOptions extends AgentToolDependencies {
  deviceId?: string;
  model?: string | BaseLlm;
}

/**
 * Guardrail callback that blocks `island_configure` with `action: "update"` if
 * a pre-flight snapshot has not been recorded in session state.
 */
export const enforcePreflightBeforeUpdateCallback: SingleBeforeToolCallback = ({
  tool,
  args,
  context,
}) => {
  if (tool.name !== "island_configure") return undefined;
  const action = args["action"];
  if (action !== "update") return undefined;

  const targetDevice = String(args["device_id"] ?? "");
  const snapshot = context.state.get("preflight_snapshot") as
    | FirmwareDeviceSnapshot
    | undefined;

  if (!snapshot || (targetDevice && snapshot.device_id !== targetDevice)) {
    return {
      blocked: true,
      error:
        "Guardrail blocked firmware update: a pre-flight snapshot must be captured in session state (`preflight_snapshot`) for the target device before running action='update'.",
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
  const queryFn = options.queryFn ?? dispatchQuery;

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
      return snapshot;
    },
    {
      description:
        "Captures full pre-upgrade Island Router state (version, running-config, interfaces, routes, VPNs, DHCP, NTP) and saves it to session state.",
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
 * Complete ADK `Workflow`: `START -> preflight_snapshot -> firmware_upgrade_planner`.
 */
export function createFirmwareUpgradeWorkflow(
  options: FirmwareUpgradeWorkflowOptions = {},
): Workflow {
  const preflightNode = createPreflightSnapshotNode(options);
  const plannerAgent = createFirmwarePlannerAgent(options);

  return new Workflow({
    name: "island_firmware_upgrade_workflow",
    description:
      "Captures a deterministic pre-flight snapshot of an Island Router before running the LLM firmware upgrade planner with pre-flight guardrails.",
    edges: [["START", preflightNode, plannerAgent]],
  });
}
