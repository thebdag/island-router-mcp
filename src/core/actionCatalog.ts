/**
 * Progressive action catalog — cheap discovery + per-action schemas.
 * MCP uses this so tools/list stays slim; AXI does not depend on it.
 */

export type ActionKind = "query" | "configure";
export type ActionParamType = "string" | "number" | "boolean";

export interface ActionParamSpec {
  name: string;
  type: ActionParamType;
  required: boolean;
  description: string;
  enum?: readonly string[];
}

export interface ActionSpec {
  name: string;
  kind: ActionKind;
  summary: string;
  params: readonly ActionParamSpec[];
  example: Record<string, unknown>;
}

export interface CompactAction {
  name: string;
  kind: ActionKind;
  summary: string;
  required: string[];
}

export interface ActionErrorPayload {
  error: string;
  action?: string;
  required?: string[];
  optional?: string[];
  example?: Record<string, unknown>;
  help: string;
}

export interface ListActionsResult {
  count: number;
  actions: CompactAction[] | string;
  help: string[];
}

export class ActionCatalogError extends Error {
  readonly payload: ActionErrorPayload;

  constructor(payload: ActionErrorPayload) {
    super(payload.error);
    this.name = "ActionCatalogError";
    this.payload = payload;
  }
}

/** RFC 5737 TEST-NET-1 — documentation-only; catalog examples, not live endpoints. */
const EXAMPLE_IPV4 = "192.0.2.1";
const EXAMPLE_DHCP_IPV4 = "192.0.2.50";
const EXAMPLE_SYSLOG_IPV4 = "192.0.2.10";

function makeSpec(
  name: string,
  kind: ActionKind,
  summary: string,
  params: readonly ActionParamSpec[] = [],
  example: Record<string, unknown> = {},
): ActionSpec {
  return { name, kind, summary, params, example };
}

const QUERY_SPECS: ActionSpec[] = [
  makeSpec("status", "query", "Full overview (interfaces, routes, neighbors, version, stats, clock)"),
  makeSpec(
    "interfaces",
    "query",
    "Parsed interface table; set detail for TX/RX stats",
    [
      {
        name: "detail",
        type: "boolean",
        required: false,
        description: "true for per-interface TX/RX counters",
      },
    ],
    { detail: false },
  ),
  ...(
    [
      ["neighbors", "Parsed ARP / neighbor table"],
      ["routes", "Parsed routing table"],
      ["logs", "Recent log entries plus syslog config"],
      ["config", "Full running-config text"],
      ["config_diff", "Running vs startup config diff"],
      ["vpns", "VPN peer status"],
      ["dhcp_reservations", "DHCP reservations (CSV-parsed)"],
      ["speedtest", "Speed test history"],
    ] as const
  ).map(([name, summary]) => makeSpec(name, "query", summary)),
  makeSpec(
    "history",
    "query",
    "Event history JSON for a time range",
    [
      {
        name: "time",
        type: "string",
        required: false,
        description: "Range such as 1h, 1d, 30m, 1w (default 1h)",
      },
    ],
    { time: "1h" },
  ),
  makeSpec("ntp", "query", "NTP config, sync status, and associations"),
  makeSpec("dns_redirects", "query", "DNS redirect rules (hostname → server)"),
  makeSpec(
    "command",
    "query",
    "Run an allowlisted show command",
    [
      {
        name: "command",
        type: "string",
        required: true,
        description: "Allowlisted show command (e.g. 'show version')",
      },
    ],
    { command: "show version" },
  ),
  makeSpec(
    "ping",
    "query",
    "ICMP ping from the router",
    [
      {
        name: "target",
        type: "string",
        required: true,
        description: "IP or hostname to ping",
      },
    ],
    { target: EXAMPLE_IPV4 },
  ),
];

const CONFIGURE_SPECS: ActionSpec[] = [
  makeSpec(
    "add_dhcp",
    "configure",
    "Add a MAC → IP DHCP reservation",
    [
      { name: "mac", type: "string", required: true, description: "MAC address" },
      { name: "ip", type: "string", required: true, description: "IPv4 address to reserve" },
      {
        name: "hostname",
        type: "string",
        required: false,
        description: "Optional hostname label",
      },
    ],
    { mac: "aa:bb:cc:dd:ee:ff", ip: EXAMPLE_DHCP_IPV4, hostname: "nas" },
  ),
  makeSpec(
    "remove_dhcp",
    "configure",
    "Remove a DHCP reservation",
    [{ name: "mac", type: "string", required: true, description: "MAC address to unreserve" }],
    { mac: "aa:bb:cc:dd:ee:ff" },
  ),
  makeSpec(
    "set_syslog",
    "configure",
    "Configure syslog forwarding (numeric level 0–7)",
    [
      { name: "server_ip", type: "string", required: true, description: "Syslog server IPv4" },
      {
        name: "port",
        type: "number",
        required: false,
        description: "Syslog port (default 514)",
      },
      {
        name: "level",
        type: "number",
        required: false,
        description: "Severity 0–7 (default 7). Never use string names.",
      },
      {
        name: "protocol",
        type: "string",
        required: false,
        description: "Transport protocol (default udp)",
        enum: ["udp", "tcp"],
      },
    ],
    { server_ip: EXAMPLE_SYSLOG_IPV4, port: 514, level: 5, protocol: "udp" },
  ),
  makeSpec("remove_syslog", "configure", "Remove syslog server configuration"),
  makeSpec(
    "set_hostname",
    "configure",
    "Set router hostname",
    [{ name: "hostname", type: "string", required: true, description: "New hostname" }],
    { hostname: "island-edge-1" },
  ),
  makeSpec(
    "set_auto_update",
    "configure",
    "Set auto-update days and optional time",
    [
      {
        name: "days",
        type: "string",
        required: true,
        description: "'all', 'none', or weekday names",
      },
      {
        name: "time_str",
        type: "string",
        required: false,
        description: "Time as hh:mm (e.g. '3:00')",
      },
    ],
    { days: "all", time_str: "3:00" },
  ),
  makeSpec(
    "update",
    "configure",
    "Check for / install firmware (update [<url>]); no write memory",
    [
      {
        name: "url",
        type: "string",
        required: false,
        description: "Optional firmware/package URL or filename",
      },
    ],
  ),
  makeSpec("clear_update", "configure", "Stop a stuck or incomplete firmware update; no write memory"),
  makeSpec(
    "set_led",
    "configure",
    "Set LED brightness 0–100",
    [
      {
        name: "led_level",
        type: "number",
        required: true,
        description: "Brightness 0–100",
      },
    ],
    { led_level: 50 },
  ),
  makeSpec(
    "set_timezone",
    "configure",
    "Set system timezone",
    [
      {
        name: "timezone",
        type: "string",
        required: true,
        description: "Country code or timezone name",
      },
    ],
    { timezone: "US/Pacific" },
  ),
  makeSpec(
    "set_ntp",
    "configure",
    "Set NTP server address",
    [
      {
        name: "ntp_server",
        type: "string",
        required: true,
        description: "NTP server hostname or IP",
      },
    ],
    { ntp_server: "time.cloudflare.com" },
  ),
  makeSpec(
    "add_dns_redirect",
    "configure",
    "Add DNS redirect / sinkhole",
    [
      { name: "domain", type: "string", required: true, description: "Domain to redirect" },
      {
        name: "redirect_server",
        type: "string",
        required: true,
        description: "Redirect IP (0.0.0.0 to sinkhole)",
      },
    ],
    { domain: "ads.example.com", redirect_server: "0.0.0.0" },
  ),
  makeSpec(
    "remove_dns_redirect",
    "configure",
    "Remove DNS redirect for a domain",
    [{ name: "domain", type: "string", required: true, description: "Domain to un-redirect" }],
    { domain: "ads.example.com" },
  ),
];

export const ACTION_CATALOG: readonly ActionSpec[] = [...QUERY_SPECS, ...CONFIGURE_SPECS];

const CATALOG_BY_NAME = new Map(ACTION_CATALOG.map((spec) => [spec.name, spec]));

function compact(spec: ActionSpec): CompactAction {
  return {
    name: spec.name,
    kind: spec.kind,
    summary: spec.summary,
    required: spec.params.filter((p) => p.required).map((p) => p.name),
  };
}

export function listActions(opts: { query?: string; kind?: ActionKind } = {}): ListActionsResult {
  let items = ACTION_CATALOG as ActionSpec[];
  if (opts.kind) {
    items = items.filter((a) => a.kind === opts.kind);
  }
  const q = opts.query?.trim().toLowerCase();
  if (q) {
    items = items.filter(
      (a) => a.name.toLowerCase().includes(q) || a.summary.toLowerCase().includes(q),
    );
  }

  if (items.length === 0) {
    const label = opts.query?.trim() || opts.kind || "";
    return {
      count: 0,
      actions: `0 actions matched '${label}'`,
      help: ["Call island_actions without query/kind to list all actions"],
    };
  }

  return {
    count: items.length,
    actions: items.map(compact),
    help: ["Call island_actions with action=<name> for the full schema and example"],
  };
}

export function describeAction(name: string): ActionSpec {
  const spec = CATALOG_BY_NAME.get(name);
  if (!spec) {
    throw new ActionCatalogError({
      error: `Unknown action: '${name}'`,
      help: "Call island_actions without action to list names",
    });
  }
  return spec;
}

export function formatDescribe(spec: ActionSpec): Record<string, unknown> {
  const body: Record<string, unknown> = {
    name: spec.name,
    kind: spec.kind,
    invoke: spec.kind === "query" ? "island_query" : "island_configure",
    summary: spec.summary,
    params: spec.params,
    example: spec.example,
  };
  if (spec.kind === "configure") {
    body.confirmation_phrase = "apply_change";
  }
  return body;
}

export function formatActionError(action: string, message: string): ActionErrorPayload {
  const spec = CATALOG_BY_NAME.get(action);
  if (!spec) {
    return {
      error: message,
      help: "Call island_actions to list actions",
    };
  }
  return {
    error: message,
    action: spec.name,
    required: spec.params.filter((p) => p.required).map((p) => p.name),
    optional: spec.params.filter((p) => !p.required).map((p) => p.name),
    example: spec.example,
    help: `Call island_actions with action='${spec.name}' for the full schema`,
  };
}

function isParamType(value: unknown, type: ActionParamType): boolean {
  return typeof value === type;
}

/**
 * Copy only catalog-known keys. Reject unknown keys and type mismatches.
 * Required-field checks stay in dispatch handlers (AXI + MCP share those).
 */
export function pickActionParams(
  spec: ActionSpec,
  raw: Record<string, unknown> | undefined,
): Record<string, unknown> {
  const src = raw ?? {};
  const allowed = new Set(spec.params.map((p) => p.name));
  const extras = Object.keys(src).filter((key) => !allowed.has(key));
  if (extras.length > 0) {
    throw new ActionCatalogError(
      formatActionError(spec.name, `unknown param(s): ${extras.join(", ")}`),
    );
  }

  const out: Record<string, unknown> = { action: spec.name };
  for (const param of spec.params) {
    if (!Object.hasOwn(src, param.name)) continue;
    const value = src[param.name];
    if (!isParamType(value, param.type)) {
      throw new ActionCatalogError(
        formatActionError(
          spec.name,
          `'${param.name}' must be ${param.type}, got ${value === null ? "null" : typeof value}`,
        ),
      );
    }
    if (param.enum && typeof value === "string" && !param.enum.includes(value)) {
      throw new ActionCatalogError(
        formatActionError(
          spec.name,
          `'${param.name}' must be one of: ${param.enum.join(", ")}`,
        ),
      );
    }
    out[param.name] = value;
  }
  return out;
}
