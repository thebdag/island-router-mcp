import { AxiError } from "axi-sdk-js";
import { parseDhcpReservationsCsv } from "../../parsers/dhcp.js";
import { parseDnsRedirects } from "../../parsers/dnsRedirects.js";
import { parseSyslogConfig } from "../../parsers/logs.js";
import { runCommand } from "../../islandSsh.js";
import { flagBool, flagString, parseFlags } from "../args.js";
import {
  deviceFromContext,
  withSession,
  type CliContext,
} from "../session.js";

const ACTIONS = [
  "add-dhcp",
  "remove-dhcp",
  "set-syslog",
  "remove-syslog",
  "set-hostname",
  "set-auto-update",
  "set-led",
  "set-timezone",
  "set-ntp",
  "add-dns-redirect",
  "remove-dns-redirect",
] as const;

type Action = (typeof ACTIONS)[number];

const ACTION_FLAGS: Record<Action, string[]> = {
  "add-dhcp": ["device", "mac", "ip", "hostname", "confirm"],
  "remove-dhcp": ["device", "mac", "confirm"],
  "set-syslog": ["device", "server-ip", "port", "level", "protocol", "confirm"],
  "remove-syslog": ["device", "confirm"],
  "set-hostname": ["device", "hostname", "confirm"],
  "set-auto-update": ["device", "days", "time", "confirm"],
  "set-led": ["device", "level", "confirm"],
  "set-timezone": ["device", "timezone", "confirm"],
  "set-ntp": ["device", "server", "confirm"],
  "add-dns-redirect": ["device", "domain", "redirect-server", "confirm"],
  "remove-dns-redirect": ["device", "domain", "confirm"],
};

function requireFlag(
  flags: Record<string, string | boolean>,
  name: string,
  action: string,
): string {
  const value = flagString(flags, name);
  if (!value) {
    throw new AxiError(`--${name} is required for ${action}`, "VALIDATION_ERROR", [
      `island-axi configure ${action} --help`,
    ]);
  }
  return value;
}

function validateMac(mac: string): void {
  if (!/^([0-9a-fA-F]{2}[:\-.]){5}[0-9a-fA-F]{2}$/.test(mac)) {
    throw new AxiError(`Invalid MAC: '${mac}'`, "VALIDATION_ERROR");
  }
}

function validateIp(ip: string): void {
  if (!/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(ip)) {
    throw new AxiError(`Invalid IP: '${ip}'`, "VALIDATION_ERROR");
  }
}

function validateSafe(value: string, label: string): void {
  if (/[;&|`$(){}]/.test(value)) {
    throw new AxiError(`Invalid ${label} — contains shell metacharacters`, "VALIDATION_ERROR");
  }
}

export async function configureCommand(
  args: string[],
  context?: CliContext,
): Promise<Record<string, unknown>> {
  const actionRaw = args[0];
  if (!actionRaw || actionRaw === "--help") {
    throw new AxiError("configure action is required", "VALIDATION_ERROR", [
      `actions: ${ACTIONS.join(", ")}`,
      "island-axi configure <action> ... --confirm",
    ]);
  }
  if (!(ACTIONS as readonly string[]).includes(actionRaw)) {
    throw new AxiError(`unknown configure action: ${actionRaw}`, "VALIDATION_ERROR", [
      `valid actions: ${ACTIONS.join(", ")}`,
    ]);
  }
  const action = actionRaw as Action;

  const { positionals, flags } = parseFlags(args.slice(1));
  if (positionals.length > 0) {
    throw new AxiError(
      `unexpected argument '${positionals[0]}'`,
      "VALIDATION_ERROR",
      [`island-axi configure ${action} --help`],
    );
  }

  const known = ACTION_FLAGS[action];
  const unknown = Object.keys(flags).filter((k) => !known.includes(k));
  if (unknown.length > 0) {
    throw new AxiError(
      `unknown flag --${unknown[0]} for \`configure ${action}\``,
      "VALIDATION_ERROR",
      [`valid flags: ${known.map((k) => `--${k}`).join(", ")}`],
    );
  }

  if (!flagBool(flags, "confirm")) {
    throw new AxiError(
      "mutations require --confirm (no interactive prompts)",
      "VALIDATION_ERROR",
      [`Re-run with --confirm after reviewing the change`],
    );
  }

  const device = deviceFromContext(context, flagString(flags, "device"));

  switch (action) {
    case "add-dhcp": {
      const mac = requireFlag(flags, "mac", action);
      const ip = requireFlag(flags, "ip", action);
      const hostname = flagString(flags, "hostname");
      validateMac(mac);
      validateIp(ip);
      if (hostname) validateSafe(hostname, "hostname");

      const result = await withSession(device, async (s) => {
        let cmd = `ip dhcp-reserve ${mac} ${ip}`;
        if (hostname) cmd += ` ${hostname}`;
        await runCommand(s, cmd, 2000);
        await runCommand(s, "write memory", 3000);
        return runCommand(s, "show ip dhcp-reservations csv", 2000);
      });
      const reservations = parseDhcpReservationsCsv(result);
      return {
        applied: true,
        device: device.id,
        mac,
        ip,
        hostname: hostname ?? null,
        count: reservations.length,
        help: ["Run `island-axi dhcp` to list reservations"],
      };
    }

    case "remove-dhcp": {
      const mac = requireFlag(flags, "mac", action);
      validateMac(mac);
      await withSession(device, async (s) => {
        await runCommand(s, `no ip dhcp-reserve ${mac}`, 2000);
        await runCommand(s, "write memory", 3000);
      });
      return {
        removed: true,
        device: device.id,
        mac,
        help: ["Run `island-axi dhcp` to verify"],
      };
    }

    case "set-syslog": {
      const serverIp = requireFlag(flags, "server-ip", action);
      validateIp(serverIp);
      const port = Number.parseInt(flagString(flags, "port") ?? "514", 10);
      const level = Number.parseInt(flagString(flags, "level") ?? "7", 10);
      const protocol = flagString(flags, "protocol") ?? "udp";
      if (level < 0 || level > 7) {
        throw new AxiError("level must be 0-7", "VALIDATION_ERROR");
      }
      if (protocol !== "udp" && protocol !== "tcp") {
        throw new AxiError("protocol must be udp or tcp", "VALIDATION_ERROR");
      }
      const verify = await withSession(device, async (s) => {
        const serverArg = port === 514 ? serverIp : `${serverIp}:${port}`;
        await runCommand(s, `syslog server ${serverArg}`, 2000);
        await runCommand(s, `syslog level ${level}`, 1500);
        await runCommand(s, `syslog protocol ${protocol}`, 1500);
        await runCommand(s, "write memory", 3000);
        return runCommand(s, "show syslog", 2000);
      });
      return {
        configured: true,
        device: device.id,
        server_ip: serverIp,
        port,
        level,
        protocol,
        verified: parseSyslogConfig(verify),
        help: ["Run `island-axi logs` to view recent entries"],
      };
    }

    case "remove-syslog": {
      const verify = await withSession(device, async (s) => {
        await runCommand(s, "no syslog server", 2000);
        await runCommand(s, "write memory", 3000);
        return runCommand(s, "show syslog", 2000);
      });
      return {
        removed: true,
        device: device.id,
        verified: parseSyslogConfig(verify),
      };
    }

    case "set-hostname": {
      const hostname = requireFlag(flags, "hostname", action);
      validateSafe(hostname, "hostname");
      await withSession(device, async (s) => {
        await runCommand(s, `hostname ${hostname}`, 2000);
        await runCommand(s, "write memory", 3000);
      });
      return { configured: true, device: device.id, hostname };
    }

    case "set-auto-update": {
      const days = requireFlag(flags, "days", action);
      validateSafe(days, "days");
      const time = flagString(flags, "time");
      if (time) validateSafe(time, "time");
      await withSession(device, async (s) => {
        await runCommand(s, `auto-update days ${days}`, 2000);
        if (time) await runCommand(s, `auto-update time ${time}`, 2000);
        await runCommand(s, "write memory", 3000);
      });
      return { configured: true, device: device.id, days, time: time ?? null };
    }

    case "set-led": {
      const levelStr = requireFlag(flags, "level", action);
      const ledLevel = Number.parseInt(levelStr, 10);
      if (!Number.isFinite(ledLevel) || ledLevel < 0 || ledLevel > 100) {
        throw new AxiError("level must be 0-100", "VALIDATION_ERROR");
      }
      await withSession(device, async (s) => {
        await runCommand(s, `led level ${ledLevel}`, 2000);
        await runCommand(s, "write memory", 3000);
      });
      return { configured: true, device: device.id, led_level: ledLevel };
    }

    case "set-timezone": {
      const timezone = requireFlag(flags, "timezone", action);
      validateSafe(timezone, "timezone");
      await withSession(device, async (s) => {
        await runCommand(s, `timezone ${timezone}`, 2000);
        await runCommand(s, "write memory", 3000);
      });
      return { configured: true, device: device.id, timezone };
    }

    case "set-ntp": {
      const server = requireFlag(flags, "server", action);
      validateSafe(server, "server");
      await withSession(device, async (s) => {
        await runCommand(s, `ntp ${server}`, 2000);
        await runCommand(s, "write memory", 3000);
      });
      return {
        configured: true,
        device: device.id,
        ntp_server: server,
        help: ["Run `island-axi ntp` to verify sync status"],
      };
    }

    case "add-dns-redirect": {
      const domain = requireFlag(flags, "domain", action);
      const redirectServer = requireFlag(flags, "redirect-server", action);
      validateSafe(domain, "domain");
      validateIp(redirectServer);
      const verify = await withSession(device, async (s) => {
        await runCommand(s, `ip dns redirect ${domain} ${redirectServer}`, 2000);
        await runCommand(s, "write memory", 3000);
        return runCommand(s, "show running-config", 4000);
      });
      return {
        applied: true,
        device: device.id,
        domain,
        redirect_server: redirectServer,
        count: parseDnsRedirects(verify).length,
        help: ["Run `island-axi dns-redirects` to list rules"],
      };
    }

    case "remove-dns-redirect": {
      const domain = requireFlag(flags, "domain", action);
      validateSafe(domain, "domain");
      await withSession(device, async (s) => {
        await runCommand(s, `no ip dns redirect ${domain}`, 2000);
        await runCommand(s, "write memory", 3000);
      });
      return {
        removed: true,
        device: device.id,
        domain,
        help: ["Run `island-axi dns-redirects` to verify"],
      };
    }

    default:
      throw new AxiError(`unhandled action: ${action}`, "INTERNAL_ERROR");
  }
}
