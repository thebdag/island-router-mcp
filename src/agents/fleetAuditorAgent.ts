/**
 * ADK Fleet Auditor Workflow — executable counterpart to `.agent/skills/skill-network-fleet/SKILL.md`.
 *
 * Replaces prose instructions with a hybrid ADK graph (`Workflow`):
 * 1. `collect_fleet_audit` (`FunctionNode`): Deterministically polls all devices in inventory,
 *    normalizes & diffs running-config against golden baselines, and evaluates compliance policies.
 * 2. Conditional routing (`ctx.route`):
 *    - `"healthy"` → `healthy_fleet_summary` (`FunctionNode`, 0 LLM tokens).
 *    - `"needs_remediation"` → `fleet_remediation_planner` (`LlmAgent` with HITL `island_configure`).
 */

import {
  FunctionNode,
  LlmAgent,
  Workflow,
  type BaseLlm,
  type NodeContext,
} from "@google/adk";
import {
  dispatchQuery,
  type QueryParams,
} from "../core/index.js";
import { loadDevices } from "../devices.js";
import type { DeviceConfig } from "../islandSsh.js";
import type { InterfaceSummary } from "../parsers/interfaces.js";
import type { SyslogConfig } from "../parsers/logs.js";
import type { NtpConfig, NtpStatus } from "../parsers/ntp.js";
import type { VersionInfo } from "../parsers/system.js";
import type { VpnPeer } from "../parsers/vpn.js";
import { createIslandAdkTools, type AgentToolDependencies } from "./tools.js";

/** Ephemeral running-config lines that change naturally and must not trigger drift. */
const EPHEMERAL_CONFIG_PATTERNS: readonly RegExp[] = [
  /^#\s*Generated/i,
  /^!\s*Last configuration change/i,
  /^ntp clock-period\b/i,
  /^!\s*Time:/i,
];

export interface ConfigDriftResult {
  drifted: boolean;
  added: string[];
  removed: string[];
}

export interface FleetCompliancePolicy {
  /** Require syslog forwarding to be configured. Default: true */
  requireSyslog?: boolean;
  /** Minimum syslog severity level numeric threshold (0-7, e.g. >= 4 for warning+). Default: 4 */
  minSyslogLevel?: number;
  /** Require at least one NTP server configured. Default: true */
  requireNtp?: boolean;
  /** Require NTP clock to be synchronized. Default: false (optional for lab routers) */
  requireNtpSynced?: boolean;
  /** Flag any down interfaces unless listed in `allowedDownInterfaces`. Default: true */
  requireAllInterfacesUp?: boolean;
  /** Interface names allowed to be down (e.g. unused LAN ports). */
  allowedDownInterfaces?: string[];
  /** Optional map of device_id -> golden baseline config text. */
  goldenBaselines?: Record<string, string>;
}

export interface DeviceAuditSnapshot {
  device_id: string;
  host: string;
  version: VersionInfo;
  interfaces: InterfaceSummary[];
  vpn_peers: VpnPeer[];
  syslog_config: SyslogConfig;
  ntp_config: NtpConfig;
  ntp_status: NtpStatus;
  running_config: string;
}

export interface DeviceComplianceCheck {
  name: string;
  passed: boolean;
  detail: string;
}

export interface DeviceAuditResult {
  device_id: string;
  host: string;
  firmware_version: string | null;
  uptime: string | null;
  interfaces_up: number;
  interfaces_total: number;
  vpn_peers_count: number;
  compliant: boolean;
  checks: DeviceComplianceCheck[];
  drift: ConfigDriftResult | null;
}

export interface FleetAuditReport {
  timestamp: string;
  total_devices: number;
  compliant_count: number;
  non_compliant_count: number;
  devices: DeviceAuditResult[];
}

/**
 * Strip comments, empty lines, and ephemeral timestamps/clock-periods from an
 * Island Router config so diffs reflect real administrative changes.
 */
export function normalizeConfigLines(rawConfig: string): string[] {
  const normalized: string[] = [];
  for (const rawLine of rawConfig.split(/\r?\n/)) {
    const trimmed = rawLine.trim();
    if (trimmed.length === 0) continue;
    if (EPHEMERAL_CONFIG_PATTERNS.some((re) => re.test(trimmed))) continue;
    if (trimmed === "!" || trimmed === "#") continue;
    normalized.push(trimmed);
  }
  return normalized;
}

/**
 * Compare running-config against an approved golden baseline.
 */
export function computeConfigDrift(
  runningConfig: string,
  baselineConfig: string,
): ConfigDriftResult {
  const runningLines = normalizeConfigLines(runningConfig);
  const baselineLines = normalizeConfigLines(baselineConfig);

  const runningSet = new Set(runningLines);
  const baselineSet = new Set(baselineLines);

  const added = runningLines.filter((line) => !baselineSet.has(line));
  const removed = baselineLines.filter((line) => !runningSet.has(line));

  return {
    drifted: added.length > 0 || removed.length > 0,
    added,
    removed,
  };
}

/**
 * Deterministically evaluate a single router snapshot against fleet compliance policy.
 */
export function evaluateDeviceCompliance(
  snapshot: DeviceAuditSnapshot,
  policy: FleetCompliancePolicy = {},
): DeviceAuditResult {
  const requireSyslog = policy.requireSyslog ?? true;
  const minSyslogLevel = policy.minSyslogLevel ?? 4;
  const requireNtp = policy.requireNtp ?? true;
  const requireNtpSynced = policy.requireNtpSynced ?? false;
  const requireAllInterfacesUp = policy.requireAllInterfacesUp ?? true;
  const allowedDown = new Set(policy.allowedDownInterfaces ?? []);

  const checks: DeviceComplianceCheck[] = [];

  if (requireSyslog) {
    const hasServer =
      snapshot.syslog_config.enabled && Boolean(snapshot.syslog_config.server);
    const parsedLevel =
      snapshot.syslog_config.level === null
        ? Number.NaN
        : Number.parseInt(snapshot.syslog_config.level, 10);
    const levelOk =
      snapshot.syslog_config.level === null ||
      (!Number.isNaN(parsedLevel) && parsedLevel >= minSyslogLevel);
    checks.push({
      name: "syslog_forwarding",
      passed: hasServer && levelOk,
      detail: hasServer
        ? `Syslog server ${snapshot.syslog_config.server} (level ${String(snapshot.syslog_config.level ?? "default")})`
        : "Syslog forwarding is not configured",
    });
  }

  if (requireNtp) {
    const hasServers = snapshot.ntp_config.servers.length > 0;
    const syncOk = !requireNtpSynced || snapshot.ntp_status.synchronized;
    checks.push({
      name: "ntp_configuration",
      passed: hasServers && syncOk,
      detail: hasServers
        ? `NTP servers: ${snapshot.ntp_config.servers.join(", ")} (synced=${String(snapshot.ntp_status.synchronized)})`
        : "No NTP servers configured",
    });
  }

  const upIfaces = snapshot.interfaces.filter(
    (iface) => iface.status.toLowerCase() === "up",
  );
  if (requireAllInterfacesUp) {
    const unexpectedDown = snapshot.interfaces.filter(
      (iface) =>
        iface.status.toLowerCase() !== "up" && !allowedDown.has(iface.name),
    );
    checks.push({
      name: "interfaces_up",
      passed: unexpectedDown.length === 0,
      detail:
        unexpectedDown.length === 0
          ? `All ${String(snapshot.interfaces.length)} monitored interfaces up`
          : `Interfaces down: ${unexpectedDown.map((i) => i.name).join(", ")}`,
    });
  }

  const baseline = policy.goldenBaselines?.[snapshot.device_id];
  const drift =
    baseline === undefined
      ? null
      : computeConfigDrift(snapshot.running_config, baseline);

  if (drift !== null) {
    checks.push({
      name: "golden_baseline_drift",
      passed: !drift.drifted,
      detail: drift.drifted
        ? `Config drift detected (+${String(drift.added.length)} / -${String(drift.removed.length)} lines)`
        : "Running config matches golden baseline",
    });
  }

  return {
    device_id: snapshot.device_id,
    host: snapshot.host,
    firmware_version: snapshot.version.firmware || null,
    uptime: snapshot.version.uptime || null,
    interfaces_up: upIfaces.length,
    interfaces_total: snapshot.interfaces.length,
    vpn_peers_count: snapshot.vpn_peers.length,
    compliant: checks.every((c) => c.passed),
    checks,
    drift,
  };
}

/**
 * Collect live telemetry from a single device via `queryFn` (defaults to `dispatchQuery`).
 */
export async function collectDeviceAuditSnapshot(
  dev: DeviceConfig,
  queryFn: (dev: DeviceConfig, params: QueryParams) => Promise<unknown> = dispatchQuery,
): Promise<DeviceAuditSnapshot> {
  const [statusRaw, logsRaw, ntpRaw, vpnsRaw, configRaw] = await Promise.all([
    queryFn(dev, { action: "status" }) as Promise<{
      version: VersionInfo;
      interfaces: InterfaceSummary[];
    }>,
    queryFn(dev, { action: "logs" }) as Promise<{
      syslog_config: SyslogConfig;
    }>,
    queryFn(dev, { action: "ntp" }) as Promise<{
      ntp_config: NtpConfig;
      status: NtpStatus;
    }>,
    queryFn(dev, { action: "vpns" }) as Promise<{
      vpn: VpnPeer[];
    }>,
    queryFn(dev, { action: "config" }) as Promise<{
      config: string;
    }>,
  ]);

  return {
    device_id: dev.id,
    host: dev.host,
    version: statusRaw.version,
    interfaces: statusRaw.interfaces,
    vpn_peers: vpnsRaw.vpn,
    syslog_config: logsRaw.syslog_config,
    ntp_config: ntpRaw.ntp_config,
    ntp_status: ntpRaw.status,
    running_config: configRaw.config,
  };
}

export interface FleetAuditWorkflowOptions extends AgentToolDependencies {
  policy?: FleetCompliancePolicy;
  model?: string | BaseLlm;
}

/**
 * Build the ADK `FunctionNode` that audits all devices and routes to `"healthy"` or `"needs_remediation"`.
 */
export function createCollectFleetAuditNode(
  options: FleetAuditWorkflowOptions = {},
): FunctionNode<unknown, FleetAuditReport> {
  const getDevices = options.loadDevicesFn ?? (() => loadDevices());
  const queryFn = options.queryFn ?? dispatchQuery;
  const policy = options.policy ?? {};

  return new FunctionNode<unknown, FleetAuditReport>(
    "collect_fleet_audit",
    async (ctx: NodeContext): Promise<FleetAuditReport> => {
      const devices = getDevices();
      const results: DeviceAuditResult[] = [];

      for (const dev of devices) {
        const snapshot = await collectDeviceAuditSnapshot(dev, queryFn);
        results.push(evaluateDeviceCompliance(snapshot, policy));
      }

      const compliantCount = results.filter((r) => r.compliant).length;
      const nonCompliantCount = results.length - compliantCount;

      const report: FleetAuditReport = {
        timestamp: new Date().toISOString(),
        total_devices: results.length,
        compliant_count: compliantCount,
        non_compliant_count: nonCompliantCount,
        devices: results,
      };

      ctx.state.set("fleet_audit_report", report);
      ctx.route = nonCompliantCount === 0 ? "healthy" : "needs_remediation";
      return report;
    },
    {
      description:
        "Polls all Island Routers in inventory, computes golden baseline drift and compliance checks, and routes to healthy summary or LLM remediation.",
    },
  );
}

/**
 * Zero-LLM-token terminal node when every device in the fleet passes compliance.
 */
export function createHealthyFleetSummaryNode(): FunctionNode<
  FleetAuditReport,
  { status: "healthy"; summary: string; report: FleetAuditReport }
> {
  return new FunctionNode(
    "healthy_fleet_summary",
    (ctx: NodeContext, input: FleetAuditReport) => {
      const report =
        input ?? (ctx.state.get("fleet_audit_report") as FleetAuditReport);
      return {
        status: "healthy" as const,
        summary: `All ${String(report.total_devices)} Island Router device(s) passed compliance and drift checks at ${report.timestamp}.`,
        report,
      };
    },
    {
      description:
        "Emits a deterministic summary when all routers in the fleet are compliant (zero LLM calls).",
    },
  );
}

/**
 * ADK `LlmAgent` invoked only when `collect_fleet_audit` detects drift or compliance violations.
 */
export function createFleetRemediationAgent(
  options: FleetAuditWorkflowOptions = {},
): LlmAgent {
  const tools = createIslandAdkTools(options);

  return new LlmAgent({
    name: "fleet_remediation_planner",
    model: options.model ?? "gemini-2.5-flash",
    description:
      "Analyzes Island Router fleet compliance failures and config drift, and proposes or executes guarded remediations.",
    instruction: [
      "You are the Island Router Fleet Compliance & Remediation Agent.",
      "Review the structured `FleetAuditReport` provided in the workflow input / session state.",
      "For every non-compliant device:",
      "1. Summarize failed compliance checks (syslog numeric level 0-7, NTP servers, down interfaces, golden baseline drift).",
      "2. Recommend the exact remediation action (e.g. `set_syslog`, `set_ntp`, `set_hostname`, `add_dns_redirect`).",
      "3. Remember Island Router CLI rules: config commands run directly at the global prompt (never `configure terminal`), and syslog levels are numeric 0-7.",
      "4. Do NOT call `island_configure` unless the user explicitly asks to apply remediations; when called, `island_configure` enforces human-in-the-loop confirmation.",
    ].join("\n"),
    tools,
    outputKey: "fleet_remediation_plan",
  });
}

/**
 * Complete ADK `Workflow` combining deterministic fleet telemetry collection,
 * conditional routing (`healthy` vs `needs_remediation`), and LLM remediation planning.
 */
export function createFleetAuditWorkflow(
  options: FleetAuditWorkflowOptions = {},
): Workflow {
  const collectNode = createCollectFleetAuditNode(options);
  const healthyNode = createHealthyFleetSummaryNode();
  const remediationAgent = createFleetRemediationAgent(options);

  return new Workflow({
    name: "island_fleet_audit_workflow",
    description:
      "Audits an Island Router fleet for compliance and golden-baseline drift, routing only non-compliant fleets to the LLM remediation planner.",
    edges: [
      [
        "START",
        collectNode,
        {
          healthy: healthyNode,
          needs_remediation: remediationAgent,
        },
      ],
    ],
  });
}
