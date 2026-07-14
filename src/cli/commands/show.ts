import { AxiError } from "axi-sdk-js";
import { flagBool } from "../args.js";
import { truncateText } from "../format.js";
import { ALLOWED_SHOW_COMMANDS } from "../../allowedCommands.js";
import {
  callCore,
  deviceFromContext,
  parseDeviceArgs,
  type CliContext,
} from "../session.js";
import { queryCommand } from "../../core/query.js";

export async function showCommand(
  args: string[],
  context?: CliContext,
): Promise<Record<string, unknown>> {
  const { parsed, deviceId } = parseDeviceArgs(args, ["device", "full"], "show");
  const full = flagBool(parsed.flags, "full");

  if (parsed.positionals.length === 0) {
    throw new AxiError("show command is required", "VALIDATION_ERROR", [
      "island-axi show <command...> [--device <id>] [--full]",
      `examples: ${ALLOWED_SHOW_COMMANDS.slice(0, 5).join(", ")}`,
    ]);
  }

  const device = deviceFromContext(context, deviceId);
  const data = await callCore(() =>
    queryCommand(device, parsed.positionals.join(" ")),
  );
  const { text, truncated, totalChars } = truncateText(data.output, 1500);

  const result: Record<string, unknown> = {
    device: device.id,
    command: data.command,
    chars: totalChars,
    output: full ? data.output : text,
  };
  if (!full && truncated) {
    result.help = [
      `Run \`island-axi show ${parsed.positionals.join(" ")} --full\` for complete output`,
    ];
  }
  return result;
}
