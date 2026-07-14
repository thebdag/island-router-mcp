import { parseLimit } from "../args.js";
import { parseFieldsFlag, pickFields } from "../format.js";
import {
  callCore,
  deviceFromContext,
  parseDeviceArgs,
  type CliContext,
} from "../session.js";
import { queryRoutes } from "../../core/query.js";

const DEFAULT_FIELDS = ["destination", "gateway", "interface", "type"];

export async function routesCommand(
  args: string[],
  context?: CliContext,
): Promise<Record<string, unknown>> {
  const { parsed, deviceId } = parseDeviceArgs(
    args,
    ["device", "fields", "limit"],
    "routes",
  );
  const device = deviceFromContext(context, deviceId);
  const fields = parseFieldsFlag(parsed.flags["fields"], DEFAULT_FIELDS);
  const limit = parseLimit(parsed.flags["limit"], 100, 500);

  const data = await callCore(() => queryRoutes(device));
  const routes = data.routes;

  if (routes.length === 0) {
    return {
      device: device.id,
      routes: "0 routes found",
      help: ["Run `island-axi status` for overview"],
    };
  }

  const rows = routes
    .slice(0, limit)
    .map((row) => pickFields(row as unknown as Record<string, unknown>, fields));

  const help = ["Run `island-axi neighbors` for ARP table"];
  if (routes.length > rows.length) {
    help.unshift(`Run \`island-axi routes --limit ${Math.min(limit + 50, 500)}\` for more`);
  }

  return {
    device: device.id,
    count: `${rows.length} of ${routes.length} total`,
    routes: rows,
    help,
  };
}
