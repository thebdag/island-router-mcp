import type { CliContext } from "./session.js";

const STATIC_HELP = [
  "Run `island-axi devices` to list inventory",
  "Run `island-axi status` for a compact router overview",
  "Run `island-axi neighbors` to inspect ARP table",
  "Run `island-axi setup hooks` to install ambient session context",
];

/**
 * Content-first home view (AXI principle 8).
 * Lists inventory without SSH. Live status is opt-in via `status`.
 */
export function homeCommand(
  _args: string[] = [],
  context?: CliContext,
): Record<string, unknown> {
  const devices = context?.devices ?? [];

  if (devices.length === 0) {
    return {
      devices: "0 devices configured — create devices.json or set ROUTER_IP",
      help: [
        "Copy devices.example.json to devices.json and edit credentials",
        "Or set ROUTER_IP and ROUTER_PASS env vars",
        ...STATIC_HELP.slice(1),
      ],
    };
  }

  const rows = devices.map((d) => ({
    id: d.id,
    host: d.host,
    port: d.port,
    description: d.description ?? "",
  }));

  return {
    count: devices.length,
    devices: rows,
    help: STATIC_HELP,
  };
}
