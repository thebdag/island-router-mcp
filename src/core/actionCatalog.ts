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

const QUERY_SPECS: ActionSpec[] = [
  {
    name: "status",
    kind: "query",
    summary: "Full overview (interfaces, routes, neighbors, version, stats, clock)",
    params: [],
    example: {},
  },
  {
    name: "interfaces",
    kind: "query",
    summary: "Parsed interface table; set detail for TX/RX stats",
    params: [
      {
        name: "detail",
        type: "boolean",
        required: false,
        description: "true for per-interface TX/RX counters",
      },
    ],
    example: { detail: false },
  },
  {
    name: "neighbors",
    kind: "query",
    summary: "Parsed ARP / neighbor table",
    params: [],
    example: {},
  },
  {
    name: "routes",
    kind: "query",
    summary: "Parsed routing table",
    params: [],
    example: {},
  },
  {
    name: "logs",
    kind: "query",
    summary: "Recent log entries plus syslog config",
    params: [],
    example: {},
  },
  {
    name: "config",
    kind: "query",
    summary: "Full running-config text",
    params: [],
    example: {},
  },
  {
    name: "config_diff",
    kind: "query",
    summary: "Running vs startup config diff",
    params: [],
    example: {},
  },
  {
    name: "vpns",
    kind: "query",
    summary: "VPN peer status",
    params: [],
    example: {},
  },
  {
    name: "dhcp_reservations",
    kind: "query",
    summary: "DHCP reservations (CSV-parsed)",
    params: [],
    example: {},
  },
  {
    name: "speedtest",
    kind: "query",
    summary: "Speed test history",
    params: [],
    example: {},
  },
  {
    name: "history",
    kind: "query",
    summary: "Event history JSON for a time range",
    params: [
      {
        name: "time",
        type: "string",
        required: false,
        description: "Range such as 1h, 1d, 30m, 1w (default 1h)",
      },
    ],
    example: { time: "1h" },
  },
  {
    name: "ntp",
    kind: "query",
    summary: "NTP config, sync status, and associations",
    params: [],
    example: {},
  },
  {
    name: "dns_redirects",
    kind: "query",
    summary: "DNS redirect rules (hostname → server)",
    params: [],
    example: {},
  },
  {
    name: "command",
    kind: "query",
    summary: "Run an allowlisted show command",
    params: [
      {
        name: "command",
        type: "string",
        required: true,
        description: "Allowlisted show command (e.g. 'show version')",
      },
    ],
    example: { command: "show version" },
  },
  {
    name: "ping",
    kind: "query",
    summary: "ICMP ping from the router",
    params: [
      {
        name: "target",
        type: "string",
        required: true,
        description: "IP or hostname to ping",
      },
    ],
    example: { target: "1.1.1.1" },
  },
];

const CONFIGURE_SPECS: ActionSpec[] = [
  {
    name: "add_dhcp",
    kind: "configure",
    summary: "Add a MAC → IP DHCP reservation",
    params: [
      { name: "mac", type: "string", required: true, description: "MAC address" },
      { name: "ip", type: "string", required: true, description: "IPv4 address to reserve" },
      {
        name: "hostname",
        type: "string",
        required: false,
        description: "Optional hostname label",
      },
    ],
    example: { mac: "aa:bb:cc:dd:ee:ff", ip: "192.168.1.50", hostname: "nas" },
  },
  {
    name: "remove_dhcp",
    kind: "configure",
    summary: "Remove a DHCP reservation",
    params: [
      { name: "mac", type: "string", required: true, description: "MAC address to unreserve" },
    ],
    example: { mac: "aa:bb:cc:dd:ee:ff" },
  },
  {
    name: "set_syslog",
    kind: "configure",
    summary: "Configure syslog forwarding (numeric level 0–7)",
    params: [
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
    example: { server_ip: "192.168.1.10", port: 514, level: 5, protocol: "udp" },
  },
  {
    name: "remove_syslog",
    kind: "configure",
    summary: "Remove syslog server configuration",
    params: [],
    example: {},
  },
  {
    name: "set_hostname",
    kind: "configure",
    summary: "Set router hostname",
    params: [
      { name: "hostname", type: "string", required: true, description: "New hostname" },
    ],
    example: { hostname: "island-edge-1" },
  },
  {
    name: "set_auto_update",
    kind: "configure",
    summary: "Set auto-update days and optional time",
    params: [
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
    example: { days: "all", time_str: "3:00" },
  },
  {
    name: "update",
    kind: "configure",
    summary: "Check for / install firmware (update [<url>]); no write memory",
    params: [
      {
        name: "url",
        type: "string",
        required: false,
        description: "Optional firmware/package URL or filename",
      },
    ],
    example: {},
  },
  {
    name: "clear_update",
    kind: "configure",
    summary: "Stop a stuck or incomplete firmware update; no write memory",
    params: [],
    example: {},
  },
  {
    name: "set_led",
    kind: "configure",
    summary: "Set LED brightness 0–100",
    params: [
      {
        name: "led_level",
        type: "number",
        required: true,
        description: "Brightness 0–100",
      },
    ],
    example: { led_level: 50 },
  },
  {
    name: "set_timezone",
    kind: "configure",
    summary: "Set system timezone",
    params: [
      {
        name: "timezone",
        type: "string",
        required: true,
        description: "Country code or timezone name",
      },
    ],
    example: { timezone: "US/Pacific" },
  },
  {
    name: "set_ntp",
    kind: "configure",
    summary: "Set NTP server address",
    params: [
      {
        name: "ntp_server",
        type: "string",
        required: true,
        description: "NTP server hostname or IP",
      },
    ],
    example: { ntp_server: "time.cloudflare.com" },
  },
  {
    name: "add_dns_redirect",
    kind: "configure",
    summary: "Add DNS redirect / sinkhole",
    params: [
      { name: "domain", type: "string", required: true, description: "Domain to redirect" },
      {
        name: "redirect_server",
        type: "string",
        required: true,
        description: "Redirect IP (0.0.0.0 to sinkhole)",
      },
    ],
    example: { domain: "ads.example.com", redirect_server: "0.0.0.0" },
  },
  {
    name: "remove_dns_redirect",
    kind: "configure",
    summary: "Remove DNS redirect for a domain",
    params: [
      { name: "domain", type: "string", required: true, description: "Domain to un-redirect" },
    ],
    example: { domain: "ads.example.com" },
  },
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
