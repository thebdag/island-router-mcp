import { parseFieldsFlag, pickFields } from "../format.js";
import {
  callCore,
  deviceFromContext,
  parseDeviceArgs,
  type CliContext,
} from "../session.js";
import { queryDhcpReservations } from "../../core/query.js";

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
  const data = await callCore(() => queryDhcpReservations(device));

  if (data.reservations.length === 0) {
    return {
      device: device.id,
      dhcp: "0 DHCP reservations found",
      help: [
        "Run `island-axi configure add-dhcp --mac <mac> --ip <ip> --confirm` to add one",
      ],
    };
  }

  return {
    device: device.id,
    count: data.reservations.length,
    reservations: data.reservations.map((row) =>
      pickFields(row as unknown as Record<string, unknown>, fields),
    ),
    help: [
      "Run `island-axi configure add-dhcp --mac <mac> --ip <ip> --confirm` to add",
      "Run `island-axi configure remove-dhcp --mac <mac> --confirm` to remove",
    ],
  };
}
