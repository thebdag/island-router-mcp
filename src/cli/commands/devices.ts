import type { CliContext } from "../session.js";
import { parseDeviceArgs } from "../session.js";
import { homeCommand } from "../home.js";

export function devicesCommand(
  args: string[],
  context?: CliContext,
): Record<string, unknown> {
  parseDeviceArgs(args, [], "devices");
  return homeCommand([], context);
}
