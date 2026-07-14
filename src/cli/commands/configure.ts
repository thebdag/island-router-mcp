import { AxiError } from "axi-sdk-js";
import { flagBool, flagString, parseFlags } from "../args.js";
import {
  callCore,
  deviceFromContext,
  type CliContext,
} from "../session.js";
import { dispatchConfigure } from "../../core/configure.js";

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

const ACTION_TO_CORE: Record<Action, string> = {
  "add-dhcp": "add_dhcp",
  "remove-dhcp": "remove_dhcp",
  "set-syslog": "set_syslog",
  "remove-syslog": "remove_syslog",
  "set-hostname": "set_hostname",
  "set-auto-update": "set_auto_update",
  "set-led": "set_led",
  "set-timezone": "set_timezone",
  "set-ntp": "set_ntp",
  "add-dns-redirect": "add_dns_redirect",
  "remove-dns-redirect": "remove_dns_redirect",
};

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
      ["Re-run with --confirm after reviewing the change"],
    );
  }

  // Validate required flags before SSH
  if (action === "add-dhcp") {
    requireFlag(flags, "mac", action);
    requireFlag(flags, "ip", action);
  } else if (action === "remove-dhcp") {
    requireFlag(flags, "mac", action);
  } else if (action === "set-syslog") {
    requireFlag(flags, "server-ip", action);
  } else if (action === "set-hostname") {
    requireFlag(flags, "hostname", action);
  } else if (action === "set-auto-update") {
    requireFlag(flags, "days", action);
  } else if (action === "set-led") {
    requireFlag(flags, "level", action);
  } else if (action === "set-timezone") {
    requireFlag(flags, "timezone", action);
  } else if (action === "set-ntp") {
    requireFlag(flags, "server", action);
  } else if (action === "add-dns-redirect") {
    requireFlag(flags, "domain", action);
    requireFlag(flags, "redirect-server", action);
  } else if (action === "remove-dns-redirect") {
    requireFlag(flags, "domain", action);
  }

  const device = deviceFromContext(context, flagString(flags, "device"));
  const portStr = flagString(flags, "port");
  const levelStr = flagString(flags, "level");

  const result = await callCore(() =>
    dispatchConfigure(device, {
      action: ACTION_TO_CORE[action],
      mac: flagString(flags, "mac"),
      ip: flagString(flags, "ip"),
      hostname: flagString(flags, "hostname"),
      server_ip: flagString(flags, "server-ip"),
      port: portStr ? Number.parseInt(portStr, 10) : undefined,
      level: action === "set-syslog" && levelStr
        ? Number.parseInt(levelStr, 10)
        : undefined,
      protocol: flagString(flags, "protocol"),
      days: flagString(flags, "days"),
      time_str: flagString(flags, "time"),
      led_level: action === "set-led" && levelStr
        ? Number.parseInt(levelStr, 10)
        : undefined,
      timezone: flagString(flags, "timezone"),
      ntp_server: flagString(flags, "server"),
      domain: flagString(flags, "domain"),
      redirect_server: flagString(flags, "redirect-server"),
    }),
  );

  const compact: Record<string, unknown> = { ...result };
  delete compact.config_output;
  delete compact.write_output;
  delete compact.days_output;
  delete compact.time_output;
  if (typeof compact.reservations === "string") delete compact.reservations;
  if (typeof compact.ntp_config === "string") delete compact.ntp_config;

  const helpByAction: Partial<Record<Action, string[]>> = {
    "add-dhcp": ["Run `island-axi dhcp` to list reservations"],
    "remove-dhcp": ["Run `island-axi dhcp` to verify"],
    "set-syslog": ["Run `island-axi logs` to view recent entries"],
    "set-ntp": ["Run `island-axi ntp` to verify sync status"],
    "add-dns-redirect": ["Run `island-axi dns-redirects` to list rules"],
    "remove-dns-redirect": ["Run `island-axi dns-redirects` to verify"],
  };
  if (helpByAction[action]) compact.help = helpByAction[action];

  return compact;
}
