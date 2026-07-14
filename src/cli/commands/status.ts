import { parseInterfaceSummary } from "../../parsers/interfaces.js";
import { parseNeighbors, parseRoutes } from "../../parsers/routes.js";
import { parseVersion } from "../../parsers/system.js";
import {
  deviceFromContext,
  parseDeviceArgs,
  withSession,
  type CliContext,
} from "../session.js";
import { runCommand } from "../../islandSsh.js";

export async function statusCommand(
  args: string[],
  context?: CliContext,
): Promise<Record<string, unknown>> {
  const { parsed, deviceId } = parseDeviceArgs(args, ["device"], "status");
  void parsed;
  const device = deviceFromContext(context, deviceId);

  const raw = await withSession(device, async (s) => {
    const interfaces = await runCommand(s, "show interface summary", 2000);
    const routes = await runCommand(s, "show ip routes", 2000);
    const neighbors = await runCommand(s, "show ip neighbors", 2000);
    const version = await runCommand(s, "show version", 2000);
    return { interfaces, routes, neighbors, version };
  });

  const ifaces = parseInterfaceSummary(raw.interfaces);
  const routes = parseRoutes(raw.routes);
  const neighbors = parseNeighbors(raw.neighbors);
  const version = parseVersion(raw.version);

  const up = ifaces.filter((i) => /up/i.test(i.status)).length;
  const down = ifaces.length - up;

  return {
    device: { id: device.id, host: device.host },
    version: {
      firmware: version.firmware || "(unknown)",
      hostname: version.hostname || "(unknown)",
      uptime: version.uptime || "(unknown)",
    },
    interfaces: `${up} up, ${down} down (${ifaces.length} total)`,
    routes: routes.length,
    neighbors: neighbors.length,
    help: [
      "Run `island-axi interfaces` for interface details",
      "Run `island-axi neighbors` for ARP table",
      "Run `island-axi routes` for routing table",
    ],
  };
}
