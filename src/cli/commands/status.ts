import {
  callCore,
  deviceFromContext,
  parseDeviceArgs,
  type CliContext,
} from "../session.js";
import { queryStatus } from "../../core/query.js";

export async function statusCommand(
  args: string[],
  context?: CliContext,
): Promise<Record<string, unknown>> {
  const { deviceId } = parseDeviceArgs(args, ["device"], "status");
  const device = deviceFromContext(context, deviceId);
  const data = await callCore(() => queryStatus(device));

  const ifaces = data.interfaces;
  const up = ifaces.filter((i) => /up/i.test(i.status)).length;
  const down = ifaces.length - up;

  return {
    device: { id: device.id, host: device.host },
    version: {
      firmware: data.version.firmware || "(unknown)",
      hostname: data.version.hostname || "(unknown)",
      uptime: data.version.uptime || "(unknown)",
    },
    interfaces: `${up} up, ${down} down (${ifaces.length} total)`,
    routes: data.routes.length,
    neighbors: data.neighbors.length,
    help: [
      "Run `island-axi interfaces` for interface details",
      "Run `island-axi neighbors` for ARP table",
      "Run `island-axi routes` for routing table",
    ],
  };
}
