import { parseDhcpReservationsCsv } from "../../parsers/dhcp.js";
import { parseFieldsFlag, pickFields } from "../format.js";
import {
  deviceFromContext,
  parseDeviceArgs,
  runShow,
  type CliContext,
} from "../session.js";

const DEFAULT_FIELDS = ["mac", "ip", "hostname", "status"];

export async function dhcpCommand(
  args: string[],
  context?: CliContext,
): Promise<Record<string, unknown>> {
  const { parsed, deviceId } = parseDeviceArgs(
    args,
    ["device", "fields"],
    "dhcp",
  );
  const device = deviceFromContext(context, deviceId);
  const fields = parseFieldsFlag(parsed.flags["fields"], DEFAULT_FIELDS);

  const output = await runShow(device, "show ip dhcp-reservations csv", 2000);
  const reservations = parseDhcpReservationsCsv(output);

  if (reservations.length === 0) {
    return {
      device: device.id,
      dhcp: "0 DHCP reservations found",
      help: [
        "Run `island-axi configure add-dhcp --mac <mac> --ip <ip> --confirm` to add one",
      ],
    };
  }

  const rows = reservations.map((row) =>
    pickFields(row as unknown as Record<string, unknown>, fields),
  );

  return {
    device: device.id,
    count: reservations.length,
    reservations: rows,
    help: [
      "Run `island-axi configure add-dhcp --mac <mac> --ip <ip> --confirm` to add",
      "Run `island-axi configure remove-dhcp --mac <mac> --confirm` to remove",
    ],
  };
}
