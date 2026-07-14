/**
 * Shared read-only Island Router actions.
 * Returns plain structured data — MCP and AXI adapt presentation.
 */

import { runCommand, type DeviceConfig } from "../islandSsh.js";
import { ALLOWED_SHOW_COMMANDS, isCommandAllowed, normalizeShowCommand } from "../allowedCommands.js";
import { parseInterfaceDetail, parseInterfaceSummary } from "../parsers/interfaces.js";
import { parseNeighbors, parseRoutes } from "../parsers/routes.js";
import { parseLogEntries, parseSyslogConfig } from "../parsers/logs.js";
import { parseDhcpReservationsCsv } from "../parsers/dhcp.js";
import { parseVpnPeers } from "../parsers/vpn.js";
import { parseNtpAssociations, parseNtpConfig, parseNtpStatus } from "../parsers/ntp.js";
import { parsePing, parseSpeedtest, parseVersion } from "../parsers/system.js";
import { parseDnsRedirects } from "../parsers/dnsRedirects.js";
import { withSession } from "./session.js";
import { validateSafe } from "./validate.js";

export async function queryStatus(dev: DeviceConfig) {
  const result = await withSession(dev, async (s) => {
    const cmds = [
      { cmd: "show interface summary", waitMs: 2000 },
      { cmd: "show ip interface", waitMs: 2000 },
      { cmd: "show ip routes", waitMs: 2000 },
      { cmd: "show ip neighbors", waitMs: 2000 },
      { cmd: "show version", waitMs: 2000 },
      { cmd: "show stats", waitMs: 2000 },
      { cmd: "show clock", waitMs: 1500 },
    ];
    const out: Record<string, string> = {};
    for (const { cmd, waitMs } of cmds) {
      out[cmd] = await runCommand(s, cmd, waitMs);
    }
    return out;
  });

  return {
    device_id: dev.id,
    host: dev.host,
    interfaces: parseInterfaceSummary(result["show interface summary"] ?? ""),
    ip_interfaces: result["show ip interface"],
    routes: parseRoutes(result["show ip routes"] ?? ""),
    neighbors: parseNeighbors(result["show ip neighbors"] ?? ""),
    version: parseVersion(result["show version"] ?? ""),
    stats: result["show stats"],
    clock: result["show clock"],
  };
}

export async function queryInterfaces(dev: DeviceConfig, detail = false) {
  const cmd = detail ? "show interface" : "show interface summary";
  const output = await withSession(dev, (s) => runCommand(s, cmd, 3000));
  const parsed = detail ? parseInterfaceDetail(output) : parseInterfaceSummary(output);
  return { device_id: dev.id, command: cmd, interfaces: parsed };
}

export async function queryNeighbors(dev: DeviceConfig) {
  const output = await withSession(dev, (s) => runCommand(s, "show ip neighbors", 2000));
  const neighbors = parseNeighbors(output);
  return { device_id: dev.id, count: neighbors.length, neighbors };
}

export async function queryRoutes(dev: DeviceConfig) {
  const output = await withSession(dev, (s) => runCommand(s, "show ip routes", 2000));
  const routes = parseRoutes(output);
  return { device_id: dev.id, count: routes.length, routes };
}

export async function queryLogs(dev: DeviceConfig) {
  const result = await withSession(dev, async (s) => ({
    log: await runCommand(s, "show log", 3000),
    syslog: await runCommand(s, "show syslog", 2000),
  }));
  const entries = parseLogEntries(result.log);
  return {
    device_id: dev.id,
    count: entries.length,
    syslog_config: parseSyslogConfig(result.syslog),
    entries: entries.slice(-100),
  };
}

export async function queryConfig(dev: DeviceConfig) {
  const config = await withSession(dev, (s) => runCommand(s, "show running-config", 4000));
  return { device_id: dev.id, config };
}

export async function queryConfigDiff(dev: DeviceConfig) {
  const output = await withSession(dev, (s) =>
    runCommand(s, "show running-config differences", 4000),
  );
  return {
    device_id: dev.id,
    command: "show running-config differences",
    output,
  };
}

export async function queryVpns(dev: DeviceConfig) {
  const output = await withSession(dev, (s) => runCommand(s, "show vpns", 2000));
  return { device_id: dev.id, vpn: parseVpnPeers(output) };
}

export async function queryDhcpReservations(dev: DeviceConfig) {
  const output = await withSession(dev, (s) =>
    runCommand(s, "show ip dhcp-reservations csv", 2000),
  );
  const reservations = parseDhcpReservationsCsv(output);
  return { device_id: dev.id, count: reservations.length, reservations };
}

export async function querySpeedtest(dev: DeviceConfig) {
  const output = await withSession(dev, (s) => runCommand(s, "show speedtest", 3000));
  const speedtest_results = parseSpeedtest(output);
  return { device_id: dev.id, count: speedtest_results.length, speedtest_results };
}

export async function queryHistory(dev: DeviceConfig, time = "1h") {
  validateSafe(time, "time");
  const cmd = `show history begin ${time} first json:`;
  const output = await withSession(dev, (s) => runCommand(s, cmd, 5000));
  return { device_id: dev.id, command: cmd, time_range: time, output };
}

export async function queryNtp(dev: DeviceConfig) {
  const result = await withSession(dev, async (s) => ({
    ntp: await runCommand(s, "show ntp", 2000),
    status: await runCommand(s, "show ntp status", 2000),
    associations: await runCommand(s, "show ntp associations", 2000),
  }));
  return {
    device_id: dev.id,
    ntp_config: parseNtpConfig(result.ntp),
    status: parseNtpStatus(result.status),
    associations: parseNtpAssociations(result.associations),
  };
}

export async function queryDnsRedirects(dev: DeviceConfig) {
  const output = await withSession(dev, (s) => runCommand(s, "show running-config", 4000));
  const dns_redirects = parseDnsRedirects(output);
  return { device_id: dev.id, count: dns_redirects.length, dns_redirects };
}

export async function queryCommand(dev: DeviceConfig, command: string) {
  const normalized = normalizeShowCommand(command);
  if (!isCommandAllowed(normalized)) {
    throw new Error(
      `Command not allowed: '${command}'. Only read-only show commands are permitted. Allowed: ${ALLOWED_SHOW_COMMANDS.join(", ")}`,
    );
  }
  const output = await withSession(dev, (s) => runCommand(s, normalized, 3000));
  return { device_id: dev.id, command: normalized, output };
}

export async function queryPing(dev: DeviceConfig, target: string) {
  validateSafe(target, "target");
  const output = await withSession(dev, (s) => runCommand(s, `ping ${target}`, 10_000));
  return { device_id: dev.id, ping: parsePing(output) };
}

export const QUERY_ACTIONS = [
  "status",
  "interfaces",
  "neighbors",
  "routes",
  "logs",
  "config",
  "config_diff",
  "vpns",
  "dhcp_reservations",
  "speedtest",
  "history",
  "ntp",
  "dns_redirects",
  "command",
  "ping",
] as const;

export type QueryAction = (typeof QUERY_ACTIONS)[number];

export interface QueryParams {
  action: QueryAction;
  command?: string;
  target?: string;
  detail?: boolean;
  time?: string;
}

/** Dispatch a read action by name. */
export async function dispatchQuery(dev: DeviceConfig, params: QueryParams) {
  switch (params.action) {
    case "status":
      return queryStatus(dev);
    case "interfaces":
      return queryInterfaces(dev, params.detail ?? false);
    case "neighbors":
      return queryNeighbors(dev);
    case "routes":
      return queryRoutes(dev);
    case "logs":
      return queryLogs(dev);
    case "config":
      return queryConfig(dev);
    case "config_diff":
      return queryConfigDiff(dev);
    case "vpns":
      return queryVpns(dev);
    case "dhcp_reservations":
      return queryDhcpReservations(dev);
    case "speedtest":
      return querySpeedtest(dev);
    case "history":
      return queryHistory(dev, params.time ?? "1h");
    case "ntp":
      return queryNtp(dev);
    case "dns_redirects":
      return queryDnsRedirects(dev);
    case "command": {
      if (!params.command) throw new Error("'command' parameter required for action='command'");
      return queryCommand(dev, params.command);
    }
    case "ping": {
      if (!params.target) throw new Error("'target' parameter required for action='ping'");
      return queryPing(dev, params.target);
    }
    default:
      throw new Error(`Unknown action: '${String(params.action)}'`);
  }
}
