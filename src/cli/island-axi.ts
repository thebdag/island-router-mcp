#!/usr/bin/env node
/**
 * island-axi — Agent eXperience Interface for Island Router CLI.
 * @see https://axi.md/
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runAxiCli } from "axi-sdk-js";
import "dotenv/config";

import { COMMAND_HELP, TOP_LEVEL_HELP } from "./help.js";
import { homeCommand } from "./home.js";
import { createContext } from "./session.js";
import { devicesCommand } from "./commands/devices.js";
import { statusCommand } from "./commands/status.js";
import { interfacesCommand } from "./commands/interfaces.js";
import { neighborsCommand } from "./commands/neighbors.js";
import { routesCommand } from "./commands/routes.js";
import { logsCommand } from "./commands/logs.js";
import { configCommand, configDiffCommand } from "./commands/config.js";
import { vpnsCommand } from "./commands/vpns.js";
import { dhcpCommand } from "./commands/dhcp.js";
import { ntpCommand } from "./commands/ntp.js";
import { dnsRedirectsCommand } from "./commands/dnsRedirects.js";
import { pingCommand } from "./commands/ping.js";
import { showCommand } from "./commands/show.js";
import { configureCommand } from "./commands/configure.js";
import { setupCommand } from "./commands/setup.js";

function readVersion(): string {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const pkg = JSON.parse(readFileSync(join(here, "../../package.json"), "utf8"));
    return typeof pkg.version === "string" ? pkg.version : "0.0.0";
  } catch {
    return "0.0.0";
  }
}

await runAxiCli({
  description: "Query and configure Island Routers over SSH with token-efficient TOON output",
  version: readVersion(),
  packageName: "island-mcp-server",
  topLevelHelp: TOP_LEVEL_HELP,
  getCommandHelp: (command) => COMMAND_HELP[command] ?? null,
  resolveContext: () => createContext(),
  home: (args, context) => homeCommand(args, context),
  commands: {
    devices: (args, context) => devicesCommand(args, context),
    status: (args, context) => statusCommand(args, context),
    interfaces: (args, context) => interfacesCommand(args, context),
    neighbors: (args, context) => neighborsCommand(args, context),
    routes: (args, context) => routesCommand(args, context),
    logs: (args, context) => logsCommand(args, context),
    config: (args, context) => configCommand(args, context),
    "config-diff": (args, context) => configDiffCommand(args, context),
    vpns: (args, context) => vpnsCommand(args, context),
    dhcp: (args, context) => dhcpCommand(args, context),
    ntp: (args, context) => ntpCommand(args, context),
    "dns-redirects": (args, context) => dnsRedirectsCommand(args, context),
    ping: (args, context) => pingCommand(args, context),
    show: (args, context) => showCommand(args, context),
    configure: (args, context) => configureCommand(args, context),
    setup: (args) => setupCommand(args),
  },
});
