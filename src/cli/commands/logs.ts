import { flagBool, parseLimit } from "../args.js";
import { truncateText } from "../format.js";
import {
  callCore,
  deviceFromContext,
  parseDeviceArgs,
  type CliContext,
} from "../session.js";
import { queryLogs } from "../../core/query.js";

export async function logsCommand(
  args: string[],
  context?: CliContext,
): Promise<Record<string, unknown>> {
  const { parsed, deviceId } = parseDeviceArgs(
    args,
    ["device", "limit", "full"],
    "logs",
  );
  const device = deviceFromContext(context, deviceId);
  const limit = parseLimit(parsed.flags["limit"], 50, 200);
  const full = flagBool(parsed.flags, "full");

  const data = await callCore(() => queryLogs(device));
  const sliced = data.entries.slice(-limit);

  if (sliced.length === 0) {
    return {
      device: device.id,
      logs: "0 log entries found",
      syslog: data.syslog_config,
      help: ["Run `island-axi configure set-syslog --server-ip <ip> --confirm` to enable forwarding"],
    };
  }

  const rows = sliced.map((e) => ({
    timestamp: e.timestamp,
    severity: e.severity,
    message: full ? e.message : truncateText(e.message, 120).text,
  }));

  const help = [
    "Run `island-axi logs --full` for untruncated messages",
    "Run `island-axi config` to inspect running-config",
  ];
  if (data.entries.length > sliced.length) {
    help.unshift(`Showing last ${sliced.length} of ${data.entries.length} — use --limit for more`);
  }

  return {
    device: device.id,
    count: `${sliced.length} of ${data.entries.length} total`,
    syslog: data.syslog_config,
    logs: rows,
    help,
  };
}
