#!/usr/bin/env node
/**
 * CLI runner for Island Router ADK workflows (`@google/adk`).
 *
 * Usage:
 *   node build/agents/cli.js fleet-audit [--demo-healthy | --demo-drift | --live] [--baseline-file <path>]
 *   node build/agents/cli.js firmware-preflight [--demo | --live] [--device <id>]
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  InMemoryRunner,
  LogLevel,
  REQUEST_CONFIRMATION_FUNCTION_CALL_NAME,
  getFunctionCalls,
  setLogLevel,
  type Event,
} from "@google/adk";
import type { QueryParams } from "../core/index.js";
import type { DeviceConfig } from "../islandSsh.js";
import { resolveLocalPath } from "../safePath.js";
import {
  createFleetAuditWorkflow,
  type FleetCompliancePolicy,
} from "./fleetAuditorAgent.js";
import {
  createFirmwareUpgradeWorkflow,
  diffFirmwareSnapshots,
  type FirmwareDeviceSnapshot,
} from "./firmwareUpgradeAgent.js";

const USAGE_TEXT = `island-adk — Google ADK Workflow Runner for Island Router

USAGE
  node build/agents/cli.js <subcommand> [flags]

SUBCOMMANDS
  fleet-audit          Audit fleet compliance, golden baseline drift, and remediation steps
  firmware-preflight   Capture pre-flight snapshot, compatibility runbook, and post-verify diff

FLAGS
  --demo-healthy       Run fleet-audit against compliant demo routers (default for fleet-audit)
  --demo-drift         Run fleet-audit with simulated config drift and down interface
  --demo               Run firmware-preflight against demo router (default for firmware-preflight)
  --live               Run against real devices from devices.json / env
  --device <id>        Target device ID for firmware-preflight
  --baseline-file <p>  Golden baseline config file for live fleet-audit
  --help, -h           Print this help message
`;

/** RFC 5737 TEST-NET-1 / TEST-NET-2 demo devices for offline verification. */
export const DEMO_DEVICES: DeviceConfig[] = [
  {
    id: "hq-router",
    host: "192.0.2.10",
    port: 22,
    username: "admin",
    authMethod: "password",
    description: "HQ Island Router",
  },
  {
    id: "branch-router",
    host: "198.51.100.10",
    port: 22,
    username: "admin",
    authMethod: "key",
    description: "Branch Office Island Router",
  },
];

export const DEMO_GOLDEN_BASELINES: Record<string, string> = {
  "hq-router": [
    "hostname Island-HQ",
    "syslog server 192.0.2.50:514",
    "syslog level 5",
    "ntp pool.ntp.org",
  ].join("\n"),
  "branch-router": [
    "hostname Island-Branch",
    "syslog server 192.0.2.50:514",
    "syslog level 5",
    "ntp pool.ntp.org",
  ].join("\n"),
};

export interface DemoQueryOptions {
  simulateDrift?: boolean;
  driftAllDevices?: boolean;
  dropVpnPeer?: boolean;
}

export function createDemoQueryFn(
  optionsOrSimulateDrift: boolean | DemoQueryOptions = false,
): (dev: DeviceConfig, params: QueryParams) => Promise<unknown> {
  const opts: DemoQueryOptions =
    typeof optionsOrSimulateDrift === "boolean"
      ? { simulateDrift: optionsOrSimulateDrift }
      : optionsOrSimulateDrift;

  return (dev: DeviceConfig, params: QueryParams): Promise<unknown> => {
    const isDrifted =
      Boolean(opts.simulateDrift) &&
      (Boolean(opts.driftAllDevices) || dev.id === "branch-router");

    return Promise.resolve(
      buildDemoActionResult(dev, params, isDrifted, Boolean(opts.dropVpnPeer)),
    );
  };
}

function buildDemoActionResult(
  dev: DeviceConfig,
  params: QueryParams,
  isDrifted: boolean,
  dropVpnPeer: boolean,
): unknown {
  switch (params.action) {
    case "status":
      return {
        device_id: dev.id,
        host: dev.host,
        version: {
          firmware: "2.3.2",
          model: "Island Pro",
          serialNumber: `ISL-${dev.id.toUpperCase()}`,
          uptime: "47 days, 3 hours",
          buildDate: "2026-01-15",
          hostname: dev.id,
          raw: "Island Router v2.3.2",
        },
        interfaces: [
          {
            name: "en0",
            status: "up",
            protocol: "up",
            ipAddress: dev.host,
            macAddress: "00:11:22:33:44:01",
            speed: "1000Mb/s",
            duplex: "full",
            mtu: 1500,
            description: "WAN",
          },
          {
            name: "en1",
            status: isDrifted ? "down" : "up",
            protocol: isDrifted ? "down" : "up",
            ipAddress: "192.0.2.1",
            macAddress: "00:11:22:33:44:02",
            speed: "1000Mb/s",
            duplex: "full",
            mtu: 1500,
            description: "LAN",
          },
        ],
        routes: [
          {
            destination: "0.0.0.0",
            mask: "0.0.0.0",
            gateway: "192.0.2.1",
            interface: "en0",
            metric: 1,
            type: "static",
          },
        ],
        neighbors: [
          {
            ip: "192.0.2.25",
            mac: "aa:bb:cc:dd:ee:01",
            interface: "en1",
            state: "REACHABLE",
          },
        ],
      };
    case "logs":
      return {
        device_id: dev.id,
        count: 0,
        syslog_config: isDrifted
          ? {
              enabled: false,
              server: null,
              port: null,
              level: null,
              protocol: null,
            }
          : {
              enabled: true,
              server: "192.0.2.50",
              port: 514,
              level: "5",
              protocol: "udp",
            },
        entries: [],
      };
    case "ntp":
      return {
        device_id: dev.id,
        ntp_config: {
          servers: ["pool.ntp.org"],
          enabled: true,
          raw: "ntp pool.ntp.org",
        },
        status: {
          synchronized: true,
          stratum: 2,
          referenceId: "198.51.100.1",
          systemTime: "",
          offset: 0,
          jitter: 0,
          raw: "Synchronized",
        },
        associations: [],
      };
    case "vpns":
      return {
        device_id: dev.id,
        vpn: {
          interfaceName: "wg0",
          publicKey: "demo-pub-key",
          listeningPort: 51820,
          peers: dropVpnPeer
            ? []
            : [
                {
                  id: "peer-1",
                  name: "site-to-site",
                  endpoint: "198.51.100.10:51820",
                  localIp: "198.51.100.1",
                  remoteIp: "198.51.100.2",
                  status: "active",
                  txBytes: 850_000_000,
                  rxBytes: 1_200_000_000,
                  latestHandshake: "30 seconds ago",
                },
              ],
        },
      };
    case "dhcp_reservations":
      return {
        device_id: dev.id,
        count: 1,
        reservations: [
          {
            mac: "aa:bb:cc:dd:ee:01",
            ip: "192.0.2.25",
            hostname: "nas-01",
            interface: "en1",
            status: "active",
          },
        ],
      };
    case "config":
      return {
        device_id: dev.id,
        config: isDrifted
          ? [
              "# Generated 2026-11-05T21:00:00Z",
              "hostname Island-Branch",
              "ip dns redirect ads.example.com 0.0.0.0",
              "ntp pool.ntp.org",
            ].join("\n")
          : [
              "# Generated 2026-11-05T21:00:00Z",
              DEMO_GOLDEN_BASELINES[dev.id] ?? "",
            ].join("\n"),
      };
    case "ping":
      return {
        device_id: dev.id,
        ping: { target: params.target, sent: 5, received: 5, lossPercent: 0 },
      };
    default:
      throw new Error(`Unsupported demo action: ${params.action}`);
  }
}

const VALID_FLAGS = new Set([
  "--demo-healthy",
  "--demo-drift",
  "--demo",
  "--live",
  "--device",
  "--baseline-file",
  "--help",
  "-h",
]);

const VALUE_FLAGS = new Set(["--device", "--baseline-file"]);

interface ParsedCliArgs {
  subcommand: string;
  help: boolean;
  live: boolean;
  demoDrift: boolean;
  deviceId?: string;
  baselineFile?: string;
}

function splitFlagToken(arg: string): { flagName: string; inlineValue?: string } {
  const eqIdx = arg.indexOf("=");
  const flagName = eqIdx === -1 ? arg : arg.slice(0, eqIdx);
  if (!VALID_FLAGS.has(flagName)) {
    throw new Error(
      `Unknown flag '${flagName}'. Valid flags: ${[...VALID_FLAGS].join(", ")}`,
    );
  }
  return {
    flagName,
    inlineValue: eqIdx === -1 ? undefined : arg.slice(eqIdx + 1),
  };
}

function readRequiredFlagValue(
  flagName: string,
  inlineValue: string | undefined,
  nextToken: string | undefined,
): { value: string; consumedNext: boolean } {
  const value = inlineValue ?? nextToken;
  if (!value || value.startsWith("-")) {
    throw new Error(`Flag '${flagName}' requires a value`);
  }
  return { value, consumedNext: inlineValue === undefined };
}

function applyParsedFlag(
  state: ParsedCliArgs,
  flagName: string,
  value?: string,
): void {
  if (flagName === "--help" || flagName === "-h") state.help = true;
  if (flagName === "--live") state.live = true;
  if (flagName === "--demo-drift") state.demoDrift = true;
  if (flagName === "--demo-healthy") state.demoDrift = false;
  if (flagName === "--device") state.deviceId = value;
  if (flagName === "--baseline-file") state.baselineFile = value;
}

function parseCliArgs(argv: string[]): ParsedCliArgs {
  const state: ParsedCliArgs = {
    subcommand: "fleet-audit",
    help: false,
    live: false,
    demoDrift: false,
  };
  let subcommandSeen = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (!arg.startsWith("-")) {
      if (subcommandSeen) {
        throw new Error(`Unexpected positional argument: '${arg}'`);
      }
      state.subcommand = arg;
      subcommandSeen = true;
      continue;
    }

    const { flagName, inlineValue } = splitFlagToken(arg);
    if (VALUE_FLAGS.has(flagName)) {
      const { value, consumedNext } = readRequiredFlagValue(
        flagName,
        inlineValue,
        argv[i + 1],
      );
      if (consumedNext) i += 1;
      applyParsedFlag(state, flagName, value);
    } else {
      applyParsedFlag(state, flagName);
    }
  }

  return state;
}

/** Collect events from an ADK workflow run and format a single root JSON payload. */
async function collectWorkflowRunResult(
  runner: InMemoryRunner,
  promptText: string,
): Promise<Record<string, unknown>> {
  const outputs: unknown[] = [];
  const messages: string[] = [];
  const pendingConfirmations: unknown[] = [];

  for await (const event of runner.runEphemeral({
    userId: "operator",
    newMessage: { parts: [{ text: promptText }] },
  })) {
    collectEventDetails(event, outputs, messages, pendingConfirmations);
  }

  const finalOutput = outputs.at(-1);
  const basePayload: Record<string, unknown> =
    typeof finalOutput === "object" && finalOutput !== null
      ? { ...(finalOutput as Record<string, unknown>) }
      : { result: finalOutput ?? null };

  if (messages.length > 0) {
    basePayload["agent_response"] = messages.join("\n");
  }
  if (pendingConfirmations.length > 0) {
    basePayload["status"] = "awaiting_confirmation";
    basePayload["pending_confirmations"] = pendingConfirmations;
  }
  return basePayload;
}

function collectEventDetails(
  event: Event,
  outputs: unknown[],
  messages: string[],
  pendingConfirmations: unknown[],
): void {
  if (event.output !== undefined) {
    outputs.push(event.output);
  }
  for (const part of event.content?.parts ?? []) {
    if (part.text) messages.push(part.text);
  }
  const fnCalls = getFunctionCalls(event);
  for (const call of fnCalls) {
    if (call.name === REQUEST_CONFIRMATION_FUNCTION_CALL_NAME) {
      pendingConfirmations.push({
        id: call.id,
        name: call.name,
        args: call.args,
      });
    }
  }
  const requested = event.actions?.requestedToolConfirmations;
  if (requested && Object.keys(requested).length > 0) {
    pendingConfirmations.push(requested);
  }
}

async function runFleetAuditSubcommand(
  parsed: ParsedCliArgs,
): Promise<Record<string, unknown>> {
  let goldenBaselines: Record<string, string> | undefined = parsed.live
    ? undefined
    : DEMO_GOLDEN_BASELINES;

  if (parsed.baselineFile) {
    const safePath = resolveLocalPath(parsed.baselineFile, "baseline file");
    const content = fs.readFileSync(safePath, "utf8");
    const targetId = parsed.deviceId ?? "hq-router";
    goldenBaselines = { [targetId]: content };
  }

  const policy: FleetCompliancePolicy = { goldenBaselines };
  const workflow = createFleetAuditWorkflow({
    loadDevicesFn: parsed.live ? undefined : () => DEMO_DEVICES,
    queryFn: parsed.live ? undefined : createDemoQueryFn(parsed.demoDrift),
    policy,
  });

  const runner = new InMemoryRunner({
    agent: workflow,
    appName: "island-adk-prototype",
  });

  return collectWorkflowRunResult(
    runner,
    "Run fleet compliance and drift audit",
  );
}

async function runFirmwarePreflightSubcommand(
  parsed: ParsedCliArgs,
): Promise<Record<string, unknown>> {
  const workflow = createFirmwareUpgradeWorkflow({
    deviceId: parsed.deviceId,
    loadDevicesFn: parsed.live ? undefined : () => DEMO_DEVICES,
    queryFn: parsed.live ? undefined : createDemoQueryFn(false),
  });
  const runner = new InMemoryRunner({
    agent: workflow,
    appName: "island-adk-prototype",
  });

  const payload = await collectWorkflowRunResult(
    runner,
    "Capture preflight snapshot and generate upgrade runbook",
  );
  const snapshot = payload["preflight_snapshot"] as
    | FirmwareDeviceSnapshot
    | undefined;
  if (!parsed.live && snapshot) {
    payload["sample_post_verify"] = diffFirmwareSnapshots(snapshot, {
      ...snapshot,
      version: { ...snapshot.version, firmware: "2.4.0" },
    });
  }
  return payload;
}

async function main(): Promise<void> {
  // Keep stdout clean of ADK's experimental class notices.
  setLogLevel(LogLevel.ERROR);

  let parsed: ParsedCliArgs;
  try {
    parsed = parseCliArgs(process.argv.slice(2));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`Error: ${msg}\n\n${USAGE_TEXT}`);
    process.exitCode = 2;
    return;
  }

  if (parsed.help) {
    process.stdout.write(USAGE_TEXT);
    return;
  }

  if (parsed.subcommand === "fleet-audit") {
    const payload = await runFleetAuditSubcommand(parsed);
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    return;
  }

  if (parsed.subcommand === "firmware-preflight") {
    const payload = await runFirmwarePreflightSubcommand(parsed);
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    return;
  }

  process.stderr.write(
    `Error: Unknown subcommand '${parsed.subcommand}'.\n\n${USAGE_TEXT}`,
  );
  process.exitCode = 2;
}

const isEntrypoint =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isEntrypoint) {
  await main();
}
