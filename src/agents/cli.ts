#!/usr/bin/env node
/**
 * CLI runner for Island Router ADK workflows (`@google/adk`).
 *
 * Usage:
 *   node build/agents/cli.js fleet-audit [--demo-healthy | --demo-drift]
 *   node build/agents/cli.js firmware-preflight [--demo]
 */

import { InMemoryRunner, asRunnableRoot } from "@google/adk";
import type { DeviceConfig } from "../islandSsh.js";
import type { QueryParams } from "../core/index.js";
import {
  createFleetAuditWorkflow,
  type FleetCompliancePolicy,
} from "./fleetAuditorAgent.js";
import {
  createPreflightSnapshotNode,
  diffFirmwareSnapshots,
} from "./firmwareUpgradeAgent.js";

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
              ip_address: dev.host,
              description: "WAN",
            },
            {
              name: "en1",
              status: isBranchDrift ? "down" : "up",
              protocol: isBranchDrift ? "down" : "up",
              ip_address: "10.10.0.1",
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
                raw: "No syslog server configured",
              }
            : {
                enabled: true,
                server: "192.168.2.50",
                port: 514,
                level: 5,
                protocol: "udp",
                raw: "syslog server 192.168.2.50:514",
              },
          entries: [],
        };
      case "ntp":
        return {
          device_id: dev.id,
          ntp_config: {
            servers: ["pool.ntp.org"],
            raw: "ntp pool.ntp.org",
          },
          status: {
            synchronized: true,
            stratum: 2,
            reference_id: "162.159.200.1",
            system_time: null,
            raw: "Synchronized",
          },
          associations: [],
        };
      case "vpns":
        return {
          device_id: dev.id,
          vpn: [
            {
              peer_id: "site-to-site",
              endpoint: "198.51.100.10:51820",
              allowed_ips: ["10.0.0.0/16"],
              latest_handshake: "30 seconds ago",
              transfer_rx: "1.2 GiB",
              transfer_tx: "850 MiB",
              status: "active",
            },
          ],
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

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const subcommand = args[0] ?? "fleet-audit";
  const isDemoDrift = args.includes("--demo-drift");
  const isDemoHealthy = args.includes("--demo-healthy") || !args.includes("--live");

  if (subcommand === "fleet-audit") {
    const policy: FleetCompliancePolicy = {
      goldenBaselines: isDemoHealthy || isDemoDrift ? DEMO_GOLDEN_BASELINES : undefined,
    };
    const workflow = createFleetAuditWorkflow({
      loadDevicesFn: isDemoHealthy || isDemoDrift ? () => DEMO_DEVICES : undefined,
      queryFn:
        isDemoHealthy || isDemoDrift
          ? createDemoQueryFn(isDemoDrift && !args.includes("--demo-healthy"))
          : undefined,
      policy,
    });

    const runner = new InMemoryRunner({
      agent: workflow,
      appName: "island-adk-prototype",
    });

    for await (const event of runner.runEphemeral({
      userId: "operator",
      newMessage: { parts: [{ text: "Run fleet compliance and drift audit" }] },
    })) {
      if (event.output !== undefined) {
        process.stdout.write(`${JSON.stringify(event.output, null, 2)}\n`);
      } else if (event.content?.parts?.length) {
        for (const part of event.content.parts) {
          if (part.text) process.stdout.write(`${part.text}\n`);
        }
      }
    }
    return;
  }

  if (subcommand === "firmware-preflight") {
    const preflightNode = createPreflightSnapshotNode({
      loadDevicesFn: () => DEMO_DEVICES,
      queryFn: createDemoQueryFn(false),
    });
    const runner = new InMemoryRunner({
      agent: asRunnableRoot(preflightNode),
      appName: "island-adk-prototype",
    });
    for await (const event of runner.runEphemeral({
      userId: "operator",
      newMessage: { parts: [{ text: "Capture preflight snapshot" }] },
    })) {
      if (event.output !== undefined) {
        const snapshot = event.output as Parameters<typeof diffFirmwareSnapshots>[0];
        const postVerifyDiff = diffFirmwareSnapshots(snapshot, {
          ...snapshot,
          version: { ...snapshot.version, firmware: "2.4.0" },
        });
        process.stdout.write(
          `${JSON.stringify({ preflight_snapshot: snapshot, sample_post_verify: postVerifyDiff }, null, 2)}\n`,
        );
      }
    }
    return;
  }

  process.stderr.write(
    "Usage: node build/agents/cli.js <fleet-audit|firmware-preflight> [--demo-healthy|--demo-drift|--live]\n",
  );
  process.exitCode = 2;
}

await main();
