/**
 * Core Fleet Compliance & Config Drift Engine.
 *
 * Shared by MCP (`island_query` action=`audit`), AXI CLI (`island-axi audit`),
 * and the Google ADK Fleet Auditor workflow (`src/agents/fleetAuditorAgent.ts`).
 */

import { runCommands, type DeviceConfig } from "../islandSsh.js";
import { parseInterfaceSummary, type InterfaceSummary } from "../parsers/interfaces.js";
import { parseSyslogConfig, type SyslogConfig } from "../parsers/logs.js";
import { parseNtpConfig, parseNtpStatus, type NtpConfig, type NtpStatus } from "../parsers/ntp.js";
import { parseVersion, type VersionInfo } from "../parsers/system.js";
import { parseVpnPeers, type VpnPeer, type VpnSummary } from "../parsers/vpn.js";
import type { QueryParams } from "./query.js";
import { withSession } from "./session.js";

/** Ephemeral running-config lines that change naturally and must not trigger drift. */
const EPHEMERAL_CONFIG_PATTERNS: readonly RegExp[] = [
  /^#\s*Generated/i,
  /^!\s*Last configuration change/i,
  /^ntp clock-period\b/i,
  /^!\s*Time:/i,
];

/** Top-level Global context command prefixes that implicitly exit an interface block if `end` was omitted. */
const GLOBAL_COMMAND_PREFIXES: readonly RegExp[] = [
  /^hostname\b/i,
  /^syslog\b/i,
  /^no\s+syslog\b/i,
  /^ntp\b/i,
  /^no\s+ntp\b/i,
  /^timezone\b/i,
  /^led\b/i,
  /^auto-update\b/i,
  /^ip\s+dhcp-reserve\b/i,
  /^no\s+ip\s+dhcp-reserve\b/i,
  /^ip\s+dns\b/i,
  /^no\s+ip\s+dns\b/i,
  /^ip\s+route\b/i,
  /^no\s+ip\s+route\b/i,
  /^ip\s+port-forward\b/i,
  /^vpn\b/i,
  /^snmp-server\b/i,
  /^history\b/i,
  /^backup\b/i,
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
  /** Require NTP clock to be synchronized. Default: false */
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

export interface RemediationStep {
  device_id: string;
  check: string;
  summary: string;
  axi_command: string;
  mcp_action: string;
}

export interface FleetAuditReport {
  timestamp: string;
  total_devices: number;
  compliant_count: number;
  non_compliant_count: number;
  devices: DeviceAuditResult[];
  remediation_steps?: RemediationStep[];
}

function isSkippableConfigLine(trimmed: string): boolean {
  if (trimmed.length === 0 || trimmed === "!" || trimmed === "#") {
    return true;
  }
  return EPHEMERAL_CONFIG_PATTERNS.some((re) => re.test(trimmed));
}

function isUnindentedGlobalCommand(rawLine: string, trimmed: string): boolean {
  const isUnindented = rawLine.length > 0 && !/^\s/.test(rawLine);
  return isUnindented && GLOBAL_COMMAND_PREFIXES.some((re) => re.test(trimmed));
}

/**
 * Normalize an Island Router running-config while preserving `interface <name>`
 * context blocks (Island Router's 2-context CLI: Global + Interface).
 */
export function normalizeConfigLines(rawConfig: string): string[] {
  const normalized: string[] = [];
  let currentInterface: string | null = null;

  for (const rawLine of rawConfig.split(/\r?\n/)) {
    const trimmed = rawLine.trim();
    if (isSkippableConfigLine(trimmed)) continue;

    const ifaceMatch = /^interface\s+(\S+)$/i.exec(trimmed);
    if (ifaceMatch) {
      currentInterface = ifaceMatch[1]!;
      normalized.push(`interface ${currentInterface}`);
      continue;
    }

    if (/^end$/i.test(trimmed)) {
      currentInterface = null;
      continue;
    }

    if (currentInterface !== null && isUnindentedGlobalCommand(rawLine, trimmed)) {
      currentInterface = null;
    }

    normalized.push(
      currentInterface === null
        ? trimmed
        : `[interface ${currentInterface}] ${trimmed}`,
    );
  }
  return normalized;
}

function buildLineCounts(lines: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const line of lines) {
    counts.set(line, (counts.get(line) ?? 0) + 1);
  }
  return counts;
}

function diffLineCounts(
  sourceCounts: Map<string, number>,
  targetCounts: Map<string, number>,
): string[] {
  const delta: string[] = [];
  for (const [line, count] of sourceCounts.entries()) {
    const other = targetCounts.get(line) ?? 0;
    for (let i = 0; i < count - other; i++) {
      delta.push(line);
    }
  }
  return delta;
}

/**
 * Compare running-config against an approved golden baseline with context awareness
 * and multiset occurrence counting.
 */
export function computeConfigDrift(
  runningConfig: string,
  baselineConfig: string,
): ConfigDriftResult {
  const runningCounts = buildLineCounts(normalizeConfigLines(runningConfig));
  const baselineCounts = buildLineCounts(normalizeConfigLines(baselineConfig));

  const added = diffLineCounts(runningCounts, baselineCounts);
  const removed = diffLineCounts(baselineCounts, runningCounts);

  return {
    drifted: added.length > 0 || removed.length > 0,
    added,
    removed,
  };
}

function checkSyslogCompliance(
  syslog: SyslogConfig,
  minSyslogLevel: number,
): DeviceComplianceCheck {
  const hasServer = syslog.enabled && Boolean(syslog.server);
  const parsedLevel =
    syslog.level === null ? Number.NaN : Number.parseInt(String(syslog.level), 10);
  const levelOk =
    syslog.level === null ||
    (!Number.isNaN(parsedLevel) && parsedLevel >= minSyslogLevel);
  return {
    name: "syslog_forwarding",
    passed: hasServer && levelOk,
    detail: hasServer
      ? `Syslog server ${syslog.server} (level ${String(syslog.level ?? "default")})`
      : "Syslog forwarding is not configured",
  };
}

function checkNtpCompliance(
  ntpConfig: NtpConfig,
  ntpStatus: NtpStatus,
  requireNtpSynced: boolean,
): DeviceComplianceCheck {
  const hasServers = ntpConfig.servers.length > 0;
  const syncOk = !requireNtpSynced || ntpStatus.synchronized;
  return {
    name: "ntp_configuration",
    passed: hasServers && syncOk,
    detail: hasServers
      ? `NTP servers: ${ntpConfig.servers.join(", ")} (synced=${String(ntpStatus.synchronized)})`
      : "No NTP servers configured",
  };
}

function checkInterfacesCompliance(
  interfaces: InterfaceSummary[],
  allowedDown: Set<string>,
): DeviceComplianceCheck {
  const unexpectedDown = interfaces.filter(
    (iface) =>
      iface.status.toLowerCase() !== "up" && !allowedDown.has(iface.name),
  );
  return {
    name: "interfaces_up",
    passed: unexpectedDown.length === 0,
    detail:
      unexpectedDown.length === 0
        ? `All ${String(interfaces.length)} monitored interfaces up`
        : `Interfaces down: ${unexpectedDown.map((i) => i.name).join(", ")}`,
  };
}

/**
 * Deterministically evaluate a single router snapshot against fleet compliance policy.
 */
export function evaluateDeviceCompliance(
  snapshot: DeviceAuditSnapshot,
  policy: FleetCompliancePolicy = {},
): DeviceAuditResult {
  const checks: DeviceComplianceCheck[] = [];

  if (policy.requireSyslog ?? true) {
    checks.push(
      checkSyslogCompliance(snapshot.syslog_config, policy.minSyslogLevel ?? 4),
    );
  }

  if (policy.requireNtp ?? true) {
    checks.push(
      checkNtpCompliance(
        snapshot.ntp_config,
        snapshot.ntp_status,
        policy.requireNtpSynced ?? false,
      ),
    );
  }

  if (policy.requireAllInterfacesUp ?? true) {
    checks.push(
      checkInterfacesCompliance(
        snapshot.interfaces,
        new Set(policy.allowedDownInterfaces ?? []),
      ),
    );
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

  const upIfaces = snapshot.interfaces.filter(
    (iface) => iface.status.toLowerCase() === "up",
  );

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

function checkToRemediationStep(
  deviceId: string,
  check: DeviceComplianceCheck,
): RemediationStep | null {
  switch (check.name) {
    case "syslog_forwarding":
      return {
        device_id: deviceId,
        check: check.name,
        summary: `Configure syslog forwarding on ${deviceId} (numeric level 0-7)`,
        axi_command: `island-axi configure set-syslog --device ${deviceId} --server-ip <syslog-ip> --port 514 --level 5 --protocol udp --confirm`,
        mcp_action: "island_configure (action='set_syslog')",
      };
    case "ntp_configuration":
      return {
        device_id: deviceId,
        check: check.name,
        summary: `Configure NTP server on ${deviceId}`,
        axi_command: `island-axi configure set-ntp --device ${deviceId} --server pool.ntp.org --confirm`,
        mcp_action: "island_configure (action='set_ntp')",
      };
    case "interfaces_up":
      return {
        device_id: deviceId,
        check: check.name,
        summary: `${check.detail} on ${deviceId}; inspect physical link or interface configuration`,
        axi_command: `island-axi interfaces --device ${deviceId} --detail`,
        mcp_action: "island_query (action='interfaces', params={ detail: true })",
      };
    case "golden_baseline_drift":
      return {
        device_id: deviceId,
        check: check.name,
        summary: `Reconcile running-config drift on ${deviceId} (${check.detail})`,
        axi_command: `island-axi config-diff --device ${deviceId} --full`,
        mcp_action: "island_query (action='config_diff')",
      };
    default:
      return null;
  }
}

/**
 * Generate a deterministic, zero-LLM-token remediation plan from a `FleetAuditReport`.
 */
export function buildDeterministicRemediationPlan(
  report: FleetAuditReport,
): RemediationStep[] {
  const steps: RemediationStep[] = [];
  for (const device of report.devices) {
    if (device.compliant) continue;
    for (const check of device.checks) {
      if (check.passed) continue;
      const step = checkToRemediationStep(device.device_id, check);
      if (step) steps.push(step);
    }
  }
  return steps;
}

/** Extract `VpnPeer[]` whether `vpn` is a `VpnSummary` (real parser) or `VpnPeer[]` (test mock). */
export function extractVpnPeers(vpnField: VpnSummary | VpnPeer[] | undefined): VpnPeer[] {
  if (!vpnField) return [];
  if (Array.isArray(vpnField)) return vpnField;
  return Array.isArray(vpnField.peers) ? vpnField.peers : [];
}

/**
 * Collect a device audit snapshot.
 * - When `queryFn` is omitted, batches all CLI commands into a SINGLE SSH session (`withSession`).
 * - When `queryFn` is provided (e.g. unit tests), delegates to `queryFn`.
 */
export async function collectDeviceAuditSnapshot(
  dev: DeviceConfig,
  queryFn?: (dev: DeviceConfig, params: QueryParams) => Promise<unknown>,
): Promise<DeviceAuditSnapshot> {
  if (!queryFn) {
    const raw = await withSession(dev, (session) =>
      runCommands(session, [
        { cmd: "show interface summary", waitMs: 2000 },
        { cmd: "show version", waitMs: 2000 },
        { cmd: "show syslog", waitMs: 2000 },
        { cmd: "show ntp", waitMs: 2000 },
        { cmd: "show ntp status", waitMs: 2000 },
        { cmd: "show vpns", waitMs: 2000 },
        { cmd: "show running-config", waitMs: 4000 },
      ]),
    );

    return {
      device_id: dev.id,
      host: dev.host,
      version: parseVersion(raw["show version"] ?? ""),
      interfaces: parseInterfaceSummary(raw["show interface summary"] ?? ""),
      vpn_peers: parseVpnPeers(raw["show vpns"] ?? "").peers,
      syslog_config: parseSyslogConfig(raw["show syslog"] ?? ""),
      ntp_config: parseNtpConfig(raw["show ntp"] ?? ""),
      ntp_status: parseNtpStatus(raw["show ntp status"] ?? ""),
      running_config: raw["show running-config"] ?? "",
    };
  }

  const statusRes = (await queryFn(dev, { action: "status" })) as {
    version: VersionInfo;
    interfaces: InterfaceSummary[];
  };
  const logsRes = (await queryFn(dev, { action: "logs" })) as {
    syslog_config: SyslogConfig;
  };
  const ntpRes = (await queryFn(dev, { action: "ntp" })) as {
    ntp_config: NtpConfig;
    status: NtpStatus;
  };
  const vpnsRes = (await queryFn(dev, { action: "vpns" })) as {
    vpn: VpnSummary | VpnPeer[];
  };
  const configRes = (await queryFn(dev, { action: "config" })) as {
    config: string;
  };

  return {
    device_id: dev.id,
    host: dev.host,
    version: statusRes.version,
    interfaces: statusRes.interfaces,
    vpn_peers: extractVpnPeers(vpnsRes.vpn),
    syslog_config: logsRes.syslog_config,
    ntp_config: ntpRes.ntp_config,
    ntp_status: ntpRes.status,
    running_config: configRes.config,
  };
}

/**
 * Core read-only query action (`action: "audit"`) for MCP and `island-axi`.
 */
export async function queryAudit(dev: DeviceConfig, baseline?: string) {
  const snapshot = await collectDeviceAuditSnapshot(dev);
  const policy: FleetCompliancePolicy =
    baseline === undefined
      ? {}
      : { goldenBaselines: { [dev.id]: baseline } };
  const result = evaluateDeviceCompliance(snapshot, policy);
  const report: FleetAuditReport = {
    timestamp: new Date().toISOString(),
    total_devices: 1,
    compliant_count: result.compliant ? 1 : 0,
    non_compliant_count: result.compliant ? 0 : 1,
    devices: [result],
  };
  return {
    ...result,
    remediation_steps: buildDeterministicRemediationPlan(report),
  };
}
