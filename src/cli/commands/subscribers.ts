import { parseLimit, flagString } from "../args.js";
import { parseFieldsFlag, pickFields } from "../format.js";
import {
  callCore,
  deviceFromContext,
  parseDeviceArgs,
  type CliContext,
} from "../session.js";
import { querySubscribers } from "../../core/query.js";

const DEFAULT_FIELDS = ["mac", "ip", "interface", "name", "vendor", "category"];

export async function subscribersCommand(
  args: string[],
  context?: CliContext,
): Promise<Record<string, unknown>> {
  const { parsed, deviceId } = parseDeviceArgs(
    args,
    ["device", "category", "time", "fields", "limit"],
    "subscribers",
  );
  const device = deviceFromContext(context, deviceId);
  const fields = parseFieldsFlag(parsed.flags["fields"], DEFAULT_FIELDS);
  const limit = parseLimit(parsed.flags["limit"], 100, 500);
  const time = flagString(parsed.flags, "time") ?? "1d";
  const category = flagString(parsed.flags, "category");

  const data = await callCore(() => querySubscribers(device, time, category));
  const subs = data.subscribers ?? [];

  if (subs.length === 0) {
    const filterDesc = category ? ` in category '${category}'` : "";
    return {
      device: device.id,
      subscribers: `0 subscribers found${filterDesc}`,
      help: [
        "Run `island-axi subscribers` without --category to see all devices",
        "Run `island-axi neighbors` for raw ARP table",
      ],
    };
  }

  const rows = subs
    .slice(0, limit)
    .map((row) => pickFields(row as unknown as Record<string, unknown>, fields));

  const help = [
    "Run `island-axi subscribers --category iot` to list IoT candidates",
    "Run `island-axi vlans` to check current VLAN segmentation",
  ];
  if (subs.length > rows.length) {
    help.unshift(
      `Run \`island-axi subscribers --limit ${Math.min(limit + 50, 500)}\` for more`,
    );
  }

  return {
    device: device.id,
    count: `${rows.length} of ${subs.length} total`,
    category_filter: category ?? null,
    subscribers: rows,
    help,
  };
}
