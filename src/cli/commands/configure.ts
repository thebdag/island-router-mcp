import { AxiError } from "axi-sdk-js";
import { flagBool, flagString, parseFlags } from "../args.js";
import {
  callCore,
  deviceFromContext,
  type CliContext,
} from "../session.js";
import {
  dispatchConfigure,
  type ConfigureAction,
  type ConfigureParams,
} from "../../core/configure.js";

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

const ACTION_TO_CORE: Record<Action, ConfigureAction> = {
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

/** Required flags per action — table-driven to keep configureCommand simple. */
const REQUIRED_FLAGS: Record<Action, string[]> = {
  "add-dhcp": ["mac", "ip"],
  "remove-dhcp": ["mac"],
  "set-syslog": ["server-ip"],
  "remove-syslog": [],
  "set-hostname": ["hostname"],
  "set-auto-update": ["days"],
  "set-led": ["level"],
  "set-timezone": ["timezone"],
  "set-ntp": ["server"],
  "add-dns-redirect": ["domain", "redirect-server"],
  "remove-dns-redirect": ["domain"],
};

const HELP_BY_ACTION: Partial<Record<Action, string[]>> = {
  "add-dhcp": ["Run `island-axi dhcp` to list reservations"],
  "remove-dhcp": ["Run `island-axi dhcp` to verify"],
  "set-syslog": ["Run `island-axi logs` to view recent entries"],
  "set-ntp": ["Run `island-axi ntp` to verify sync status"],
  "add-dns-redirect": ["Run `island-axi dns-redirects` to list rules"],
  "remove-dns-redirect": ["Run `island-axi dns-redirects` to verify"],
};

function requireFlag(
  flags: Record<string, string | boolean>,
  name: string,
  action: string,
): string {
  const value = flagString(flags, name);
  if (!value) {
    const helpCmd = `island-axi configure ${action} --help`;
    throw new AxiError(`--${name} is required for ${action}`, "VALIDATION_ERROR", [helpCmd]);
  }
  return value;
}

function parseConfigureAction(args: string[]): {
  action: Action;
  flags: Record<string, string | boolean>;
} {
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
    const helpCmd = `island-axi configure ${action} --help`;
    throw new AxiError(
      `unexpected argument '${positionals[0]}'`,
      "VALIDATION_ERROR",
      [helpCmd],
    );
  }

  const known = ACTION_FLAGS[action];
  const unknown = Object.keys(flags).filter((k) => !known.includes(k));
  if (unknown.length > 0) {
    const validList = known.map((k) => `--${k}`).join(", ");
    throw new AxiError(
      `unknown flag --${unknown[0]} for \`configure ${action}\``,
      "VALIDATION_ERROR",
      [`valid flags: ${validList}`],
    );
  }

  if (!flagBool(flags, "confirm")) {
    throw new AxiError(
      "mutations require --confirm (no interactive prompts)",
      "VALIDATION_ERROR",
      ["Re-run with --confirm after reviewing the change"],
    );
  }

  for (const name of REQUIRED_FLAGS[action]) {
    requireFlag(flags, name, action);
  }

  return { action, flags };
}

function buildCoreParams(
  action: Action,
  flags: Record<string, string | boolean>,
): ConfigureParams {
  const portStr = flagString(flags, "port");
  const levelStr = flagString(flags, "level");
  const protocol = flagString(flags, "protocol");

  return {
    action: ACTION_TO_CORE[action],
    mac: flagString(flags, "mac"),
    ip: flagString(flags, "ip"),
    hostname: flagString(flags, "hostname"),
    server_ip: flagString(flags, "server-ip"),
    port: portStr ? Number.parseInt(portStr, 10) : undefined,
    level: action === "set-syslog" && levelStr
      ? Number.parseInt(levelStr, 10)
      : undefined,
    protocol: protocol === "tcp" || protocol === "udp" ? protocol : undefined,
    days: flagString(flags, "days"),
    time_str: flagString(flags, "time"),
    led_level: action === "set-led" && levelStr
      ? Number.parseInt(levelStr, 10)
      : undefined,
    timezone: flagString(flags, "timezone"),
    ntp_server: flagString(flags, "server"),
    domain: flagString(flags, "domain"),
    redirect_server: flagString(flags, "redirect-server"),
  };
}

function compactConfigureResult(
  action: Action,
  result: Record<string, unknown>,
): Record<string, unknown> {
  const compact: Record<string, unknown> = { ...result };
  delete compact.config_output;
  delete compact.write_output;
  delete compact.days_output;
  delete compact.time_output;
  if (typeof compact.reservations === "string") delete compact.reservations;
  if (typeof compact.ntp_config === "string") delete compact.ntp_config;
  const help = HELP_BY_ACTION[action];
  if (help) compact.help = help;
  return compact;
}

export async function configureCommand(
  args: string[],
  context?: CliContext,
): Promise<Record<string, unknown>> {
  const { action, flags } = parseConfigureAction(args);
  const device = deviceFromContext(context, flagString(flags, "device"));
  const params = buildCoreParams(action, flags);
  const result = await callCore(() => dispatchConfigure(device, params));
  return compactConfigureResult(action, result);
}
