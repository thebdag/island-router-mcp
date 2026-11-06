/**
 * Core Firmware Pre-flight Snapshot, Regression Diff & Runbook Engine.
 *
 * Shared by MCP (`island_query` action=`firmware_snapshot`),
 * AXI CLI (`island-axi firmware-snapshot`), and the Google ADK Firmware
 * Upgrade workflow (`src/agents/firmwareUpgradeAgent.ts`).
 */

import { runCommands, type DeviceConfig } from "../islandSsh.js";
import { parseDhcpReservationsCsv, type DhcpReservation } from "../parsers/dhcp.js";
import { parseInterfaceSummary, type InterfaceSummary } from "../parsers/interfaces.js";
import { parseNtpConfig, parseNtpStatus, type NtpConfig, type NtpStatus } from "../parsers/ntp.js";
import { parseNeighbors, parseRoutes, type Neighbor, type Route } from "../parsers/routes.js";
import { parseVersion, type VersionInfo } from "../parsers/system.js";
import { parseVpnPeers, type VpnPeer, type VpnSummary } from "../parsers/vpn.js";
import { computeConfigDrift, extractVpnPeers, type ConfigDriftResult } from "./fleet.js";
import type { QueryParams } from "./query.js";
import { withSession } from "./session.js";

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

export interface DeterministicUpgradeRunbook {
  device_id: string;
  host: string;
  current_firmware: string | null;
  readiness_passed: boolean;
  warnings: string[];
  baseline_counts: {
    interfaces_up: number;
    interfaces_total: number;
    routes: number;
    neighbors: number;
    vpn_peers: number;
    dhcp_reservations: number;
    ntp_synchronized: boolean;
  };
  steps: string[];
  rollback_plan: string[];
}

/**
 * Capture the complete pre-upgrade or post-upgrade device snapshot.
 * - When `queryFn` is omitted, batches all 8 CLI commands inside a SINGLE SSH session (`withSession`).
 * - When `queryFn` is provided (e.g. unit tests), delegates to `queryFn`.
 */
export async function captureFirmwareSnapshot(
  dev: DeviceConfig,
  queryFn?: (dev: DeviceConfig, params: QueryParams) => Promise<unknown>,
): Promise<FirmwareDeviceSnapshot> {
  if (!queryFn) {
    const raw = await withSession(dev, (session) =>
      runCommands(session, [
        { cmd: "show version", waitMs: 2000 },
        { cmd: "show interface summary", waitMs: 2000 },
        { cmd: "show ip routes", waitMs: 2000 },
        { cmd: "show ip neighbors", waitMs: 2000 },
        { cmd: "show vpns", waitMs: 2000 },
        { cmd: "show ip dhcp-reservations csv", waitMs: 2000 },
        { cmd: "show ntp", waitMs: 2000 },
        { cmd: "show ntp status", waitMs: 2000 },
        { cmd: "show running-config", waitMs: 4000 },
      ]),
    );

    const vpnSummary = parseVpnPeers(raw["show vpns"] ?? "");
    return {
      captured_at: new Date().toISOString(),
      device_id: dev.id,
      host: dev.host,
      version: parseVersion(raw["show version"] ?? ""),
      running_config: raw["show running-config"] ?? "",
      interfaces: parseInterfaceSummary(raw["show interface summary"] ?? ""),
      routes: parseRoutes(raw["show ip routes"] ?? ""),
      neighbors: parseNeighbors(raw["show ip neighbors"] ?? ""),
      vpn_peers: vpnSummary.peers,
      dhcp_reservations: parseDhcpReservationsCsv(
        raw["show ip dhcp-reservations csv"] ?? "",
      ),
      ntp_config: parseNtpConfig(raw["show ntp"] ?? ""),
      ntp_status: parseNtpStatus(raw["show ntp status"] ?? ""),
    };
  }

  const [statusRaw, configRaw, vpnsRaw, dhcpRaw, ntpRaw] = await Promise.all([
    queryFn(dev, { action: "status" }) as Promise<{
      version: VersionInfo;
      interfaces: InterfaceSummary[];
      routes: Route[];
      neighbors: Neighbor[];
    }>,
    queryFn(dev, { action: "config" }) as Promise<{ config: string }>,
    queryFn(dev, { action: "vpns" }) as Promise<{ vpn: VpnSummary | VpnPeer[] }>,
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
    vpn_peers: extractVpnPeers(vpnsRaw.vpn),
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
      regressions.push(
        `Interface '${ifaceName}' was up before upgrade but is down/missing after upgrade`,
      );
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

/**
 * Generate a deterministic firmware upgrade runbook & rollback plan from a pre-flight snapshot.
 * Requires zero LLM calls and works in any harness.
 */
export function buildDeterministicUpgradeRunbook(
  snapshot: FirmwareDeviceSnapshot,
): DeterministicUpgradeRunbook {
  const warnings: string[] = [];
  const upIfaces = snapshot.interfaces.filter(
    (i) => i.status.toLowerCase() === "up",
  );
  if (upIfaces.length === 0 && snapshot.interfaces.length > 0) {
    warnings.push("No interfaces reported 'up' in pre-flight snapshot");
  }
  if (!snapshot.ntp_status.synchronized) {
    warnings.push(
      "NTP clock is not synchronized; log timestamps during upgrade may be skewed",
    );
  }
  if (snapshot.routes.length === 0) {
    warnings.push("Routing table is empty in pre-flight snapshot");
  }

  return {
    device_id: snapshot.device_id,
    host: snapshot.host,
    current_firmware: snapshot.version.firmware || null,
    readiness_passed: warnings.length === 0,
    warnings,
    baseline_counts: {
      interfaces_up: upIfaces.length,
      interfaces_total: snapshot.interfaces.length,
      routes: snapshot.routes.length,
      neighbors: snapshot.neighbors.length,
      vpn_peers: snapshot.vpn_peers.length,
      dhcp_reservations: snapshot.dhcp_reservations.length,
      ntp_synchronized: snapshot.ntp_status.synchronized,
    },
    steps: [
      `1. Verify pre-flight snapshot captured at ${snapshot.captured_at} (${String(upIfaces.length)}/${String(snapshot.interfaces.length)} interfaces up, ${String(snapshot.routes.length)} routes, ${String(snapshot.vpn_peers.length)} VPN peers).`,
      `2. Persist current configuration at global prompt before upgrading.`,
      `3. Execute firmware update via \`island-axi configure update --device ${snapshot.device_id} --confirm\` (or MCP \`island_configure\` with action='update', confirmation_phrase='apply_change').`,
      `4. Capture post-upgrade snapshot via \`island-axi firmware-snapshot --device ${snapshot.device_id}\` and verify zero interface, route, VPN, or DHCP regressions.`,
    ],
    rollback_plan: [
      `1. If update hangs or fails to apply, run \`island-axi configure clear-update --device ${snapshot.device_id} --confirm\`.`,
      `2. Re-apply any missing lines from pre-flight running_config directly at the global prompt (never use 'configure terminal') followed by 'write memory'.`,
    ],
  };
}

/**
 * Core read-only query action (`action: "firmware_snapshot"`) for MCP and `island-axi`.
 */
export async function queryFirmwareSnapshot(dev: DeviceConfig) {
  const snapshot = await captureFirmwareSnapshot(dev);
  const runbook = buildDeterministicUpgradeRunbook(snapshot);
  return {
    ...snapshot,
    runbook,
  };
}
