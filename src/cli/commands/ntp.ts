import {
  parseNtpAssociations,
  parseNtpConfig,
  parseNtpStatus,
} from "../../parsers/ntp.js";
import { runCommand } from "../../islandSsh.js";
import {
  deviceFromContext,
  parseDeviceArgs,
  withSession,
  type CliContext,
} from "../session.js";

export async function ntpCommand(
  args: string[],
  context?: CliContext,
): Promise<Record<string, unknown>> {
  const { deviceId } = parseDeviceArgs(args, ["device"], "ntp");
  const device = deviceFromContext(context, deviceId);

  const raw = await withSession(device, async (s) => ({
    ntp: await runCommand(s, "show ntp", 2000),
    status: await runCommand(s, "show ntp status", 2000),
    associations: await runCommand(s, "show ntp associations", 2000),
  }));

  const config = parseNtpConfig(raw.ntp);
  const status = parseNtpStatus(raw.status);
  const associations = parseNtpAssociations(raw.associations);

  return {
    device: device.id,
    config,
    status,
    association_count: associations.length,
    associations: associations.slice(0, 10).map((a) => ({
      remote: a.remote,
      stratum: a.stratum,
      tally: a.tally,
    })),
    help: [
      "Run `island-axi configure set-ntp --server <addr> --confirm` to change NTP server",
    ],
  };
}
