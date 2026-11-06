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

/**
 * Normalize an Island Router running-config while preserving `interface <name>`
 * context blocks (Island Router's 2-context CLI: Global + Interface).
 *
 * Sub-commands inside `interface <name> ... end` are prefixed with
 * `[interface <name>] ` so per-interface changes (e.g. `shutdown` moved from
 * `en0` to `en1` or added to a second interface) are always detected.
 */
export function normalizeConfigLines(rawConfig: string): string[] {
  const normalized: string[] = [];
  let currentInterface: string | null = null;

  for (const rawLine of rawConfig.split(/\r?\n/)) {
    const trimmed = rawLine.trim();
    if (trimmed.length === 0) continue;
    if (EPHEMERAL_CONFIG_PATTERNS.some((re) => re.test(trimmed))) continue;
    if (trimmed === "!" || trimmed === "#") continue;

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

    const isUnindented = rawLine.length > 0 && !/^\s/.test(rawLine);
    if (
      currentInterface !== null &&
      isUnindented &&
      GLOBAL_COMMAND_PREFIXES.some((re) => re.test(trimmed))
    ) {
      currentInterface = null;
    }

    if (currentInterface !== null) {
      normalized.push(`[interface ${currentInterface}] ${trimmed}`);
    } else {
      normalized.push(trimmed);
    }
  }
  return normalized;
}

/**
 * Compare running-config against an approved golden baseline with context awareness
 * and multiset occurrence counting.
 */
export function computeConfigDrift(
  runningConfig: string,
  baselineConfig: string,
): ConfigDriftResult {
  const runningLines = normalizeConfigLines(runningConfig);
  const baselineLines = normalizeConfigLines(baselineConfig);

  const countMap = (lines: string[]): Map<string, number> => {
    const counts = new Map<string, number>();
    for (const line of lines) {
      counts.set(line, (counts.get(line) ?? 0) + 1);
    }
    return counts;
  };

  const runningCounts = countMap(runningLines);
  const baselineCounts = countMap(baselineLines);

  const added: string[] = [];
  for (const [line, count] of runningCounts.entries()) {
    const baseCount = baselineCounts.get(line) ?? 0;
    for (let i = 0; i < count - baseCount; i++) {
      added.push(line);
    }
  }

  const removed: string[] = [];
  for (const [line, count] of baselineCounts.entries()) {
    const runCount = runningCounts.get(line) ?? 0;
    for (let i = 0; i < count - runCount; i++) {
      removed.push(line);
    }
  }

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
        : Number.parseInt(String(snapshot.syslog_config.level), 10);
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
 * Generate a deterministic, zero-LLM-token remediation plan from a `FleetAuditReport`.
 * Used both by core `audit` queries and as the keyless fallback in the ADK workflow.
 */
export function buildDeterministicRemediationPlan(
  report: FleetAuditReport,
): RemediationStep[] {
  const steps: RemediationStep[] = [];
  for (const device of report.devices) {
    if (device.compliant) continue;
    for (const check of device.checks) {
      if (check.passed) continue;
      switch (check.name) {
        case "syslog_forwarding":
          steps.push({
            device_id: device.device_id,
            check: check.name,
            summary: `Configure syslog forwarding on ${device.device_id} (numeric level 0-7)`,
            axi_command: `island-axi configure set-syslog --device ${device.device_id} --server-ip <syslog-ip> --port 514 --level 5 --protocol udp --confirm`,
            mcp_action: "island_configure (action='set_syslog')",
          });
          break;
        case "ntp_configuration":
          steps.push({
            device_id: device.device_id,
            check: check.name,
            summary: `Configure NTP server on ${device.device_id}`,
            axi_command: `island-axi configure set-ntp --device ${device.device_id} --server pool.ntp.org --confirm`,
            mcp_action: "island_configure (action='set_ntp')",
          });
          break;
        case "interfaces_up":
          steps.push({
            device_id: device.device_id,
            check: check.name,
            summary: `${check.detail} on ${device.device_id}; inspect physical link or interface configuration`,
            axi_command: `island-axi interfaces --device ${device.device_id} --detail`,
            mcp_action: "island_query (action='interfaces', params={ detail: true })",
          });
          break;
        case "golden_baseline_drift":
          steps.push({
            device_id: device.device_id,
            check: check.name,
            summary: `Reconcile running-config drift on ${device.device_id} (${check.detail})`,
            axi_command: `island-axi config-diff --device ${device.device_id} --full`,
            mcp_action: "island_query (action='config_diff')",
          });
          break;
        default:
          break;
      }
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

    const vpnSummary = parseVpnPeers(raw["show vpns"] ?? "");
    return {
      device_id: dev.id,
      host: dev.host,
      version: parseVersion(raw["show version"] ?? ""),
      interfaces: parseInterfaceSummary(raw["show interface summary"] ?? ""),
      vpn_peers: vpnSummary.peers,
      syslog_config: parseSyslogConfig(raw["show syslog"] ?? ""),
      ntp_config: parseNtpConfig(raw["show ntp"] ?? ""),
      ntp_status: parseNtpStatus(raw["show ntp status"] ?? ""),
      running_config: raw["show running-config"] ?? "",
    };
  }

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
      vpn: VpnSummary | VpnPeer[];
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
    vpn_peers: extractVpnPeers(vpnsRaw.vpn),
    syslog_config: logsRaw.syslog_config,
    ntp_config: ntpRaw.ntp_config,
    ntp_status: ntpRaw.status,
    running_config: configRaw.config,
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
