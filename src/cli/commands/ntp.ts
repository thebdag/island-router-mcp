import {
  callCore,
  deviceFromContext,
  parseDeviceArgs,
  type CliContext,
} from "../session.js";
import { queryNtp } from "../../core/query.js";

export async function ntpCommand(
  args: string[],
  context?: CliContext,
): Promise<Record<string, unknown>> {
  const { deviceId } = parseDeviceArgs(args, ["device"], "ntp");
  const device = deviceFromContext(context, deviceId);
  const data = await callCore(() => queryNtp(device));

  return {
    device: device.id,
    config: data.ntp_config,
    status: data.status,
    association_count: data.associations.length,
    associations: data.associations.slice(0, 10).map((a) => ({
      remote: a.remote,
      stratum: a.stratum,
      tally: a.tally,
    })),
    help: [
      "Run `island-axi configure set-ntp --server <addr> --confirm` to change NTP server",
    ],
  };
}
