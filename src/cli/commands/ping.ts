import { AxiError } from "axi-sdk-js";
import {
  callCore,
  deviceFromContext,
  parseDeviceArgs,
  type CliContext,
} from "../session.js";
import { queryPing } from "../../core/query.js";

export async function pingCommand(
  args: string[],
  context?: CliContext,
): Promise<Record<string, unknown>> {
  const { parsed, deviceId } = parseDeviceArgs(args, ["device"], "ping");
  const target = parsed.positionals[0];
  if (!target) {
    throw new AxiError("target is required", "VALIDATION_ERROR", [
      "island-axi ping <target> [--device <id>]",
    ]);
  }

  const device = deviceFromContext(context, deviceId);
  const data = await callCore(() => queryPing(device, target));
  return {
    device: device.id,
    target,
    ping: data.ping,
  };
}
