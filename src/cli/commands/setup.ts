import { AxiError, installSessionStartHooks } from "axi-sdk-js";

export function setupCommand(args: string[]): Record<string, unknown> {
  if (args[0] !== "hooks") {
    throw new AxiError("unknown setup command", "VALIDATION_ERROR", [
      "Run `island-axi setup hooks`",
    ]);
  }

  installSessionStartHooks({
    marker: "island-axi",
    binaryNames: ["island-axi"],
    distEntrypoints: ["build/cli/island-axi.js"],
  });

  return {
    setup: "hooks installed or already up to date",
    help: [
      "Restart your agent session to load ambient island-axi context",
      "Or install the skill: npx skills add thebdag/island-router-mcp --skill island-axi",
    ],
  };
}
