import { flagBool } from "../args.js";
import { truncateText } from "../format.js";
import {
  deviceFromContext,
  parseDeviceArgs,
  runShow,
  type CliContext,
} from "../session.js";

export async function configCommand(
  args: string[],
  context?: CliContext,
): Promise<Record<string, unknown>> {
  const { parsed, deviceId } = parseDeviceArgs(args, ["device", "full"], "config");
  const device = deviceFromContext(context, deviceId);
  const full = flagBool(parsed.flags, "full");

  const output = await runShow(device, "show running-config", 4000);
  const { text, truncated, totalChars } = truncateText(output, 1200);

  const result: Record<string, unknown> = {
    device: device.id,
    chars: totalChars,
    config: full ? output : text,
  };

  if (!full && truncated) {
    result.help = ["Run `island-axi config --full` to see complete running-config"];
  } else {
    result.help = ["Run `island-axi config-diff` for running vs startup differences"];
  }

  return result;
}

export async function configDiffCommand(
  args: string[],
  context?: CliContext,
): Promise<Record<string, unknown>> {
  const { parsed, deviceId } = parseDeviceArgs(
    args,
    ["device", "full"],
    "config-diff",
  );
  const device = deviceFromContext(context, deviceId);
  const full = flagBool(parsed.flags, "full");

  const output = await runShow(device, "show running-config differences", 4000);
  const trimmed = output.trim();
  if (!trimmed) {
    return {
      device: device.id,
      diff: "0 differences — running-config matches startup-config",
    };
  }

  const { text, truncated, totalChars } = truncateText(output, 1200);
  const result: Record<string, unknown> = {
    device: device.id,
    chars: totalChars,
    diff: full ? output : text,
  };
  if (!full && truncated) {
    result.help = ["Run `island-axi config-diff --full` for complete diff"];
  }
  return result;
}
