import { AxiError } from "axi-sdk-js";
import { parsePing } from "../../parsers/system.js";
import {
  deviceFromContext,
  parseDeviceArgs,
  runShow,
  type CliContext,
} from "../session.js";

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
  if (/[;&|`$(){}]/.test(target)) {
    throw new AxiError("invalid target — contains shell metacharacters", "VALIDATION_ERROR");
  }

  const device = deviceFromContext(context, deviceId);
  const output = await runShow(device, `ping ${target}`, 10_000);
  const ping = parsePing(output);

  return {
    device: device.id,
    target,
    ping,
  };
}
