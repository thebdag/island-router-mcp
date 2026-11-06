#!/usr/bin/env node
/**
 * CLI runner for Island Router ADK workflows (`@google/adk`).
 *
 * Usage:
 *   node build/agents/cli.js fleet-audit [--demo-healthy | --demo-drift | --live] [--baseline-file <path>]
 *   node build/agents/cli.js firmware-preflight [--demo | --live] [--device <id>]
 */

import fs from "node:fs";
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

const DEMO_DEVICES: DeviceConfig[] = [
  {
    id: "hq-router",
    host: "192.168.2.1",
    port: 22,
    username: "admin",
    authMethod: "password",
    description: "HQ Island Router",
  },
  {
    id: "branch-router",
    host: "10.0.1.1",
    port: 22,
    username: "admin",
    authMethod: "key",
    description: "Branch Office Island Router",
  },
];

const DEMO_GOLDEN_BASELINES: Record<string, string> = {
  "hq-router": [
    "hostname Island-HQ",
    "syslog server 192.168.2.50:514",
    "syslog level 5",
    "ntp pool.ntp.org",
  ].join("\n"),
  "branch-router": [
    "hostname Island-Branch",
    "syslog server 192.168.2.50:514",
    "syslog level 5",
    "ntp pool.ntp.org",
  ].join("\n"),
};

function createDemoQueryFn(simulateDrift: boolean) {
  return async (dev: DeviceConfig, params: QueryParams): Promise<unknown> => {
    const isBranchDrift = simulateDrift && dev.id === "branch-router";
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
              status: isBranchDrift ? "down" : "up",
              protocol: isBranchDrift ? "down" : "up",
              ipAddress: "10.10.0.1",
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
              ip: "10.10.0.25",
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
          syslog_config: isBranchDrift
            ? {
                enabled: false,
                server: null,
                port: null,
                level: null,
                protocol: null,
              }
            : {
                enabled: true,
                server: "192.168.2.50",
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
            referenceId: "162.159.200.1",
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
            peers: [
              {
                id: "peer-1",
                name: "site-to-site",
                endpoint: "198.51.100.10:51820",
                localIp: "10.255.0.1",
                remoteIp: "10.255.0.2",
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
              ip: "10.10.0.25",
              hostname: "nas-01",
              interface: "en1",
              status: "active",
            },
          ],
        };
      case "config":
        return {
          device_id: dev.id,
          config: isBranchDrift
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
      default:
        throw new Error(`Unsupported demo action: ${params.action}`);
    }
  };
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

function parseCliArgs(argv: string[]): ParsedCliArgs {
  let subcommand = "fleet-audit";
  let help = false;
  let live = false;
  let demoDrift = false;
  let deviceId: string | undefined;
  let baselineFile: string | undefined;
  let subcommandSeen = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--help" || arg === "-h") {
      help = true;
      continue;
    }
    if (!arg.startsWith("-")) {
      if (!subcommandSeen) {
        subcommand = arg;
        subcommandSeen = true;
        continue;
      }
      throw new Error(`Unexpected positional argument: '${arg}'`);
    }

    const eqIdx = arg.indexOf("=");
    const flagName = eqIdx === -1 ? arg : arg.slice(0, eqIdx);
    if (!VALID_FLAGS.has(flagName)) {
      throw new Error(
        `Unknown flag '${flagName}'. Valid flags: ${[...VALID_FLAGS].join(", ")}`,
      );
    }

    if (VALUE_FLAGS.has(flagName)) {
      const val = eqIdx === -1 ? argv[++i] : arg.slice(eqIdx + 1);
      if (!val || val.startsWith("-")) {
        throw new Error(`Flag '${flagName}' requires a value`);
      }
      if (flagName === "--device") deviceId = val;
      if (flagName === "--baseline-file") baselineFile = val;
      continue;
    }

    if (flagName === "--live") live = true;
    if (flagName === "--demo-drift") demoDrift = true;
    if (flagName === "--demo-healthy") demoDrift = false;
  }

  return { subcommand, help, live, demoDrift, deviceId, baselineFile };
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

    const payload = await collectWorkflowRunResult(
      runner,
      "Run fleet compliance and drift audit",
    );
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    return;
  }

  if (parsed.subcommand === "firmware-preflight") {
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
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    return;
  }

  process.stderr.write(
    `Error: Unknown subcommand '${parsed.subcommand}'.\n\n${USAGE_TEXT}`,
  );
  process.exitCode = 2;
}

await main();
