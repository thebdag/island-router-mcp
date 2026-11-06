import { parseFieldsFlag, pickFields } from "../format.js";
import {
  callCore,
  deviceFromContext,
  parseDeviceArgs,
  type CliContext,
} from "../session.js";
import { queryVlans } from "../../core/query.js";

const DEFAULT_FIELDS = ["name", "vlanId", "parent", "ipAddress", "dhcpServer", "status"];

export async function vlansCommand(
  args: string[],
  context?: CliContext,
): Promise<Record<string, unknown>> {
  const { parsed, deviceId } = parseDeviceArgs(args, ["device", "fields"], "vlans");
  const device = deviceFromContext(context, deviceId);
  const fields = parseFieldsFlag(parsed.flags["fields"], DEFAULT_FIELDS);

  const data = await callCore(() => queryVlans(device));
  const vlans = data.vlans ?? [];

  if (vlans.length === 0) {
    return {
      device: device.id,
      vlans: "0 VLAN interfaces found",
      help: [
        "Create a VLAN with `island-axi configure create-vlan --vlan-id <id> --parent <iface> --cidr <cidr> --confirm`",
      ],
    };
  }

  const rows = vlans.map((row) =>
    pickFields(row as unknown as Record<string, unknown>, fields),
  );

  return {
    device: device.id,
    count: vlans.length,
    vlans: rows,
    help: [
      "Run `island-axi interfaces` for physical interfaces",
      "Delete with `island-axi configure delete-vlan --vlan-id <id> --confirm`",
    ],
  };
}
