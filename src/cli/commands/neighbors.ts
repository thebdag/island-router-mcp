import { parseLimit } from "../args.js";
import { parseFieldsFlag, pickFields } from "../format.js";
import {
  callCore,
  deviceFromContext,
  parseDeviceArgs,
  type CliContext,
} from "../session.js";
import { queryNeighbors } from "../../core/query.js";

const DEFAULT_FIELDS = ["ip", "mac", "interface", "state"];

export async function neighborsCommand(
  args: string[],
  context?: CliContext,
): Promise<Record<string, unknown>> {
  const { parsed, deviceId } = parseDeviceArgs(
    args,
    ["device", "fields", "limit"],
    "neighbors",
  );
  const device = deviceFromContext(context, deviceId);
  const fields = parseFieldsFlag(parsed.flags["fields"], DEFAULT_FIELDS);
  const limit = parseLimit(parsed.flags["limit"], 100, 500);

  const data = await callCore(() => queryNeighbors(device));
  const neighbors = data.neighbors;

  if (neighbors.length === 0) {
    return {
      device: device.id,
      neighbors: "0 neighbors found",
      help: ["Run `island-axi interfaces` to check link status"],
    };
  }

  const rows = neighbors
    .slice(0, limit)
    .map((row) => pickFields(row as unknown as Record<string, unknown>, fields));

  const help = ["Run `island-axi routes` for routing table"];
  if (neighbors.length > rows.length) {
    help.unshift(`Run \`island-axi neighbors --limit ${Math.min(limit + 50, 500)}\` for more`);
  }

  return {
    device: device.id,
    count: `${rows.length} of ${neighbors.length} total`,
    neighbors: rows,
    help,
  };
}
