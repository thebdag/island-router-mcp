import { parseInterfaceDetail, parseInterfaceSummary } from "../../parsers/interfaces.js";
import { flagBool, parseLimit } from "../args.js";
import { parseFieldsFlag, pickFields } from "../format.js";
import {
  deviceFromContext,
  parseDeviceArgs,
  runShow,
  type CliContext,
} from "../session.js";

const DEFAULT_FIELDS = ["name", "status", "protocol", "description"];
const DETAIL_FIELDS = ["name", "status", "txBytes", "rxBytes"];

export async function interfacesCommand(
  args: string[],
  context?: CliContext,
): Promise<Record<string, unknown>> {
  const { parsed, deviceId } = parseDeviceArgs(
    args,
    ["device", "detail", "fields", "limit"],
    "interfaces",
  );
  const device = deviceFromContext(context, deviceId);
  const detail = flagBool(parsed.flags, "detail");
  const fields = parseFieldsFlag(
    parsed.flags["fields"],
    detail ? DETAIL_FIELDS : DEFAULT_FIELDS,
  );
  const limit = parseLimit(parsed.flags["limit"], 100, 500);

  const cmd = detail ? "show interface" : "show interface summary";
  const output = await runShow(device, cmd, 3000);
  const parsedIfaces = detail
    ? parseInterfaceDetail(output)
    : parseInterfaceSummary(output);

  if (parsedIfaces.length === 0) {
    return {
      device: device.id,
      interfaces: "0 interfaces found",
      help: ["Run `island-axi status` for overview"],
    };
  }

  const rows = parsedIfaces
    .slice(0, limit)
    .map((row) => pickFields(row as unknown as Record<string, unknown>, fields));

  const help = [
    "Run `island-axi interfaces --detail` for TX/RX counters",
    "Run `island-axi neighbors` for ARP table",
  ];
  if (parsedIfaces.length > rows.length) {
    help.unshift(
      `Run \`island-axi interfaces --limit ${Math.min(limit + 50, 500)}\` for more`,
    );
  }

  return {
    device: device.id,
    count: `${rows.length} of ${parsedIfaces.length} total`,
    interfaces: rows,
    help,
  };
}
