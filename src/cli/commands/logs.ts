import { parseLogEntries, parseSyslogConfig } from "../../parsers/logs.js";
import { flagBool, parseLimit } from "../args.js";
import { truncateText } from "../format.js";
import {
  deviceFromContext,
  parseDeviceArgs,
  withSession,
  type CliContext,
} from "../session.js";
import { runCommand } from "../../islandSsh.js";

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

  const raw = await withSession(device, async (s) => ({
    log: await runCommand(s, "show log", 3000),
    syslog: await runCommand(s, "show syslog", 2000),
  }));

  const entries = parseLogEntries(raw.log);
  const syslog = parseSyslogConfig(raw.syslog);
  const sliced = entries.slice(-limit);

  if (sliced.length === 0) {
    return {
      device: device.id,
      logs: "0 log entries found",
      syslog,
      help: ["Run `island-axi configure set-syslog --server-ip <ip> --confirm` to enable forwarding"],
    };
  }

  const rows = sliced.map((e) => {
    const msg = full
      ? e.message
      : truncateText(e.message, 120).text;
    return {
      timestamp: e.timestamp,
      severity: e.severity,
      message: msg,
    };
  });

  const help = [
    "Run `island-axi logs --full` for untruncated messages",
    "Run `island-axi config` to inspect running-config",
  ];
  if (entries.length > sliced.length) {
    help.unshift(`Showing last ${sliced.length} of ${entries.length} — use --limit for more`);
  }

  return {
    device: device.id,
    count: `${sliced.length} of ${entries.length} total`,
    syslog,
    logs: rows,
    help,
  };
}
