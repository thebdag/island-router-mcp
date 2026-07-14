import { AxiError } from "axi-sdk-js";
import { flagBool } from "../args.js";
import { truncateText } from "../format.js";
import {
  ALLOWED_SHOW_COMMANDS,
  isCommandAllowed,
  normalizeShowCommand,
} from "../allowedCommands.js";
import {
  deviceFromContext,
  parseDeviceArgs,
  runShow,
  type CliContext,
} from "../session.js";

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

  const command = normalizeShowCommand(parsed.positionals.join(" "));
  if (!isCommandAllowed(command)) {
    throw new AxiError(
      `Command not allowed: '${command}'`,
      "VALIDATION_ERROR",
      [
        "Only read-only show commands are permitted",
        "Run `island-axi show --help` for usage",
      ],
    );
  }

  const device = deviceFromContext(context, deviceId);
  const output = await runShow(device, command, 3000);
  const { text, truncated, totalChars } = truncateText(output, 1500);

  const result: Record<string, unknown> = {
    device: device.id,
    command,
    chars: totalChars,
    output: full ? output : text,
  };
  if (!full && truncated) {
    result.help = [`Run \`island-axi show ${parsed.positionals.join(" ")} --full\` for complete output`];
  }
  return result;
}
