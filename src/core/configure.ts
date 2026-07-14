/**
 * Shared write actions for Island Router.
 * Config commands run at the global prompt (no configure terminal).
 */

import { runCommand, type DeviceConfig } from "../islandSsh.js";
import { parseDnsRedirects } from "../parsers/dnsRedirects.js";
import { parseSyslogConfig } from "../parsers/logs.js";
import { withSession } from "./session.js";
import { SYSLOG_LEVEL_NAMES } from "./syslog.js";
import {
  requireParam,
  validateDomain,
  validateIp,
  validateMac,
  validateSafe,
} from "./validate.js";

export async function configAddDhcp(
  dev: DeviceConfig,
  mac: string,
  ip: string,
  hostname?: string,
) {
  validateMac(mac);
  validateIp(ip);

  const result = await withSession(dev, async (s) => {
    let cmd = `ip dhcp-reserve ${mac} ${ip}`;
    if (hostname) cmd += ` ${hostname}`;
    const configOut = await runCommand(s, cmd, 2000);
    const writeOut = await runCommand(s, "write memory", 3000);
    const verify = await runCommand(s, "show ip dhcp-reservations", 2000);
    return { configOut, writeOut, verify };
  });

  return {
    applied: true,
    device_id: dev.id,
    mac,
    ip,
    hostname: hostname ?? null,
    config_output: result.configOut,
    write_output: result.writeOut,
    reservations: result.verify,
  };
}

export async function configRemoveDhcp(dev: DeviceConfig, mac: string) {
  validateMac(mac);

  const result = await withSession(dev, async (s) => {
    const configOut = await runCommand(s, `no ip dhcp-reserve ${mac}`, 2000);
    const writeOut = await runCommand(s, "write memory", 3000);
    const verify = await runCommand(s, "show ip dhcp-reservations", 2000);
    return { configOut, writeOut, verify };
  });

  return {
    removed: true,
    device_id: dev.id,
    mac,
    config_output: result.configOut,
    write_output: result.writeOut,
    reservations: result.verify,
  };
}

export async function configSyslog(
  dev: DeviceConfig,
  serverIp: string,
  port: number,
  level: number,
  protocol: string,
) {
  validateIp(serverIp);

  const result = await withSession(dev, async (s) => {
    const serverArg = port === 514 ? serverIp : `${serverIp}:${port}`;
    await runCommand(s, `syslog server ${serverArg}`, 2000);
    await runCommand(s, `syslog level ${level}`, 1500);
    await runCommand(s, `syslog protocol ${protocol}`, 1500);
    const writeOut = await runCommand(s, "write memory", 3000);
    const verify = await runCommand(s, "show syslog", 2000);
    return { writeOut, verify };
  });

  return {
    configured: true,
    device_id: dev.id,
    server_ip: serverIp,
    port,
    level,
    level_name: SYSLOG_LEVEL_NAMES[level] ?? "unknown",
    protocol,
    write_output: result.writeOut,
    verified_config: parseSyslogConfig(result.verify),
  };
}

export async function configRemoveSyslog(dev: DeviceConfig) {
  const result = await withSession(dev, async (s) => {
    const configOut = await runCommand(s, "no syslog server", 2000);
    const writeOut = await runCommand(s, "write memory", 3000);
    const verify = await runCommand(s, "show syslog", 2000);
    return { configOut, writeOut, verify };
  });

  return {
    removed: true,
    device_id: dev.id,
    config_output: result.configOut,
    write_output: result.writeOut,
    verified_config: parseSyslogConfig(result.verify),
  };
}

export async function configHostname(dev: DeviceConfig, hostname: string) {
  validateSafe(hostname, "hostname");

  const result = await withSession(dev, async (s) => {
    const configOut = await runCommand(s, `hostname ${hostname}`, 2000);
    const writeOut = await runCommand(s, "write memory", 3000);
    return { configOut, writeOut };
  });

  return {
    configured: true,
    device_id: dev.id,
    hostname,
    config_output: result.configOut,
    write_output: result.writeOut,
  };
}

export async function configAutoUpdate(
  dev: DeviceConfig,
  days: string,
  time?: string,
) {
  validateSafe(days, "days");

  const result = await withSession(dev, async (s) => {
    const daysOut = await runCommand(s, `auto-update days ${days}`, 2000);
    let timeOut = "";
    if (time) {
      validateSafe(time, "time");
      timeOut = await runCommand(s, `auto-update time ${time}`, 2000);
    }
    const writeOut = await runCommand(s, "write memory", 3000);
    return { daysOut, timeOut, writeOut };
  });

  return {
    configured: true,
    device_id: dev.id,
    days,
    time: time ?? null,
    days_output: result.daysOut,
    time_output: result.timeOut || null,
    write_output: result.writeOut,
  };
}

export async function configLed(dev: DeviceConfig, ledLevel: number) {
  const result = await withSession(dev, async (s) => {
    const configOut = await runCommand(s, `led level ${ledLevel}`, 2000);
    const writeOut = await runCommand(s, "write memory", 3000);
    return { configOut, writeOut };
  });

  return {
    configured: true,
    device_id: dev.id,
    led_level: ledLevel,
    config_output: result.configOut,
    write_output: result.writeOut,
  };
}

export async function configTimezone(dev: DeviceConfig, timezone: string) {
  validateSafe(timezone, "timezone");

  const result = await withSession(dev, async (s) => {
    const configOut = await runCommand(s, `timezone ${timezone}`, 2000);
    const writeOut = await runCommand(s, "write memory", 3000);
    const verify = await runCommand(s, "show clock", 1500);
    return { configOut, writeOut, verify };
  });

  return {
    configured: true,
    device_id: dev.id,
    timezone,
    config_output: result.configOut,
    write_output: result.writeOut,
    clock_after: result.verify,
  };
}

export async function configNtp(dev: DeviceConfig, ntpServer: string) {
  validateSafe(ntpServer, "ntp_server");

  const result = await withSession(dev, async (s) => {
    const configOut = await runCommand(s, `ntp ${ntpServer}`, 2000);
    const writeOut = await runCommand(s, "write memory", 3000);
    const verify = await runCommand(s, "show ntp", 2000);
    return { configOut, writeOut, verify };
  });

  return {
    configured: true,
    device_id: dev.id,
    ntp_server: ntpServer,
    config_output: result.configOut,
    write_output: result.writeOut,
    ntp_config: result.verify,
  };
}

export async function configAddDnsRedirect(
  dev: DeviceConfig,
  domain: string,
  redirectServer: string,
) {
  validateDomain(domain);
  validateIp(redirectServer);

  const result = await withSession(dev, async (s) => {
    const configOut = await runCommand(s, `ip dns redirect ${domain} ${redirectServer}`, 2000);
    const writeOut = await runCommand(s, "write memory", 3000);
    const verify = await runCommand(s, "show running-config", 4000);
    return { configOut, writeOut, verify };
  });

  return {
    applied: true,
    device_id: dev.id,
    domain,
    redirect_server: redirectServer,
    config_output: result.configOut,
    write_output: result.writeOut,
    active_redirects: parseDnsRedirects(result.verify),
  };
}

export async function configRemoveDnsRedirect(dev: DeviceConfig, domain: string) {
  validateDomain(domain);

  const result = await withSession(dev, async (s) => {
    const configOut = await runCommand(s, `no ip dns redirect ${domain}`, 2000);
    const writeOut = await runCommand(s, "write memory", 3000);
    const verify = await runCommand(s, "show running-config", 4000);
    return { configOut, writeOut, verify };
  });

  return {
    removed: true,
    device_id: dev.id,
    domain,
    config_output: result.configOut,
    write_output: result.writeOut,
    active_redirects: parseDnsRedirects(result.verify),
  };
}

export const CONFIGURE_ACTIONS = [
  "add_dhcp",
  "remove_dhcp",
  "set_syslog",
  "remove_syslog",
  "set_hostname",
  "set_auto_update",
  "set_led",
  "set_timezone",
  "set_ntp",
  "add_dns_redirect",
  "remove_dns_redirect",
] as const;

export type ConfigureAction = (typeof CONFIGURE_ACTIONS)[number];

export interface ConfigureParams {
  action: ConfigureAction;
  mac?: string;
  ip?: string;
  hostname?: string;
  server_ip?: string;
  port?: number;
  level?: number;
  protocol?: "udp" | "tcp";
  days?: string;
  domain?: string;
  redirect_server?: string;
  time_str?: string;
  led_level?: number;
  timezone?: string;
  ntp_server?: string;
}

type ConfigureHandler = (dev: DeviceConfig, p: ConfigureParams) => Promise<Record<string, unknown>>;

const configureHandlers: Record<string, ConfigureHandler> = {
  add_dhcp: (dev, p) =>
    configAddDhcp(dev, requireParam(p.mac, "mac"), requireParam(p.ip, "ip"), p.hostname),
  remove_dhcp: (dev, p) => configRemoveDhcp(dev, requireParam(p.mac, "mac")),
  set_syslog: (dev, p) =>
    configSyslog(
      dev,
      requireParam(p.server_ip, "server_ip"),
      p.port ?? 514,
      p.level ?? 7,
      p.protocol ?? "udp",
    ),
  remove_syslog: (dev) => configRemoveSyslog(dev),
  set_hostname: (dev, p) => configHostname(dev, requireParam(p.hostname, "hostname")),
  set_auto_update: (dev, p) =>
    configAutoUpdate(dev, requireParam(p.days, "days"), p.time_str),
  set_led: (dev, p) => {
    if (p.led_level === undefined) throw new Error("'led_level' required for set_led");
    return configLed(dev, p.led_level);
  },
  set_timezone: (dev, p) => configTimezone(dev, requireParam(p.timezone, "timezone")),
  set_ntp: (dev, p) => configNtp(dev, requireParam(p.ntp_server, "ntp_server")),
  add_dns_redirect: (dev, p) => {
    if (!p.domain) throw new Error("'domain' required for add_dns_redirect");
    if (!p.redirect_server) {
      throw new Error(
        "'redirect_server' required for add_dns_redirect (use '0.0.0.0' to block/sinkhole)",
      );
    }
    return configAddDnsRedirect(dev, p.domain, p.redirect_server);
  },
  remove_dns_redirect: (dev, p) =>
    configRemoveDnsRedirect(dev, requireParam(p.domain, "domain")),
};

/** Dispatch a configure action — shared by MCP and AXI. */
export async function dispatchConfigure(
  dev: DeviceConfig,
  params: ConfigureParams,
): Promise<Record<string, unknown>> {
  const handler = configureHandlers[params.action];
  if (!handler) throw new Error(`Unknown configure action: '${params.action}'`);
  return handler(dev, params);
}
