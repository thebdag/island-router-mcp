import { describe, expect, it } from "vitest";
import {
  BaseLlm,
  InMemoryRunner,
  isFunctionTool,
  type BaseLlmConnection,
  type Context,
  type LlmRequest,
  type LlmResponse,
} from "@google/adk";
import {
  captureFirmwareSnapshot,
  computeConfigDrift,
  createFirmwareUpgradeWorkflow,
  createFleetAuditWorkflow,
  createIslandAdkTools,
  createIslandSkillToolset,
  diffFirmwareSnapshots,
  enforcePreflightBeforeUpdateCallback,
  normalizeConfigLines,
} from "../src/agents/index.js";
import {
  ACTION_CATALOG,
  QUERY_ACTIONS,
  type ConfigureParams,
  type QueryParams,
} from "../src/core/index.js";
import type { DeviceConfig } from "../src/islandSsh.js";

class MockLlm extends BaseLlm {
  public callCount = 0;
  private readonly replyText: string;

  constructor(replyText: string) {
    super({ model: "mock-gemini" });
    this.replyText = replyText;
  }

  async *generateContentAsync(_llmRequest: LlmRequest): AsyncGenerator<LlmResponse, void> {
    this.callCount += 1;
    yield {
      content: {
        role: "model",
        parts: [{ text: this.replyText }],
      },
    };
  }

  async connect(_llmRequest: LlmRequest): Promise<BaseLlmConnection> {
    throw new Error("Live connection not used in unit tests");
  }
}

const TEST_DEVICES: DeviceConfig[] = [
  {
    id: "hq-router",
    host: "192.168.2.1",
    port: 22,
    username: "admin",
    authMethod: "password",
    description: "HQ Router",
  },
];

function createMockQueryFn(options: { drift?: boolean; dropVpnPeer?: boolean } = {}) {
  return async (dev: DeviceConfig, params: QueryParams): Promise<unknown> => {
    switch (params.action) {
      case "status":
        return {
          device_id: dev.id,
          host: dev.host,
          version: {
            firmware: "2.3.2",
            model: "IX2400",
            serialNumber: "ISL-001",
            uptime: "10 days",
            buildDate: "2026-01-15",
            hostname: "Island-HQ",
            raw: "v2.3.2",
          },
          interfaces: [
            {
              name: "en0",
              status: "up",
              protocol: "up",
              ipAddress: "192.168.2.1",
              macAddress: "00:11:22:33:44:55",
              speed: "1000Mb/s",
              duplex: "full",
              mtu: 1500,
              description: "WAN",
            },
            {
              name: "en1",
              status: options.drift ? "down" : "up",
              protocol: options.drift ? "down" : "up",
              ipAddress: "10.0.0.1",
              macAddress: "00:11:22:33:44:56",
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
              ip: "10.0.0.10",
              mac: "aa:bb:cc:dd:ee:ff",
              interface: "en1",
              state: "REACHABLE",
            },
          ],
        };
      case "logs":
        return {
          device_id: dev.id,
          count: 0,
          syslog_config: {
            enabled: !options.drift,
            server: options.drift ? null : "192.168.2.50",
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
            raw: "synchronized",
          },
          associations: [],
        };
      case "vpns":
        return {
          device_id: dev.id,
          // Matches exact VpnSummary return shape of parseVpnPeers() in src/parsers/vpn.ts
          vpn: {
            interfaceName: "wg0",
            publicKey: "abc-pub-key",
            listeningPort: 51820,
            peers: options.dropVpnPeer
              ? []
              : [
                  {
                    id: "peer1",
                    name: "site-to-site",
                    endpoint: "198.51.100.1:51820",
                    localIp: "10.1.0.1",
                    remoteIp: "10.1.0.2",
                    status: "up",
                    rxBytes: 1000,
                    txBytes: 1000,
                    latestHandshake: "10s ago",
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
              mac: "aa:bb:cc:dd:ee:ff",
              ip: "10.0.0.10",
              hostname: "nas",
              interface: "en1",
              status: "active",
            },
          ],
        };
      case "config":
        return {
          device_id: dev.id,
          config: options.drift
            ? "# Generated today\nhostname Island-HQ\nip dns redirect rogue.example 0.0.0.0\n"
            : "# Generated today\nhostname Island-HQ\nsyslog server 192.168.2.50:514\nsyslog level 5\nntp pool.ntp.org\n",
        };
      case "ping":
        return {
          device_id: dev.id,
          ping: { target: params.target, sent: 5, received: 5, lossPercent: 0 },
        };
      default:
        throw new Error(`Unexpected action in test: ${params.action}`);
    }
  };
}

describe("Core & ADK Surface Integration", () => {
  it("exposes audit and firmware_snapshot in QUERY_ACTIONS and ACTION_CATALOG for MCP and AXI", () => {
    expect(QUERY_ACTIONS).toContain("audit");
    expect(QUERY_ACTIONS).toContain("firmware_snapshot");
    const catalogNames = ACTION_CATALOG.map((s) => s.name);
    expect(catalogNames).toContain("audit");
    expect(catalogNames).toContain("firmware_snapshot");
  });

  it("exposes the 4 progressive Island Router tools and enforces HITL confirmation on writes", async () => {
    const tools = createIslandAdkTools({
      loadDevicesFn: () => TEST_DEVICES,
      queryFn: createMockQueryFn(),
      configureFn: async (dev: DeviceConfig, params: ConfigureParams) => ({
        configured: true,
        device_id: dev.id,
        action: params.action,
      }),
    });

    expect(tools.map((t) => t.name)).toEqual([
      "island_list_devices",
      "island_actions",
      "island_query",
      "island_configure",
    ]);

    const configureTool = tools.find((t) => t.name === "island_configure");
    expect(isFunctionTool(configureTool)).toBe(true);
    if (isFunctionTool(configureTool)) {
      const needsConfirmation = await configureTool.checkRequireConfirmation({
        device_id: "hq-router",
        action: "set_led",
        params: { led_level: 50 },
      });
      expect(needsConfirmation).toBe(true);
    }

    const queryTool = tools.find((t) => t.name === "island_query");
    expect(isFunctionTool(queryTool)).toBe(true);
    if (isFunctionTool(queryTool)) {
      const needsConfirmation = await queryTool.checkRequireConfirmation({
        device_id: "hq-router",
        action: "ping",
        params: { target: "1.1.1.1" },
      });
      expect(needsConfirmation).toBe(false);
    }
  });

  it("loads `.agent/skills` into an ADK SkillToolset for progressive reference", async () => {
    const skillToolset = await createIslandSkillToolset();
    expect(skillToolset.getSkill("island-router-cli")).toBeDefined();
    expect(skillToolset.getSkill("island-axi")).toBeDefined();
    const skillTools = await skillToolset.getTools();
    expect(skillTools.map((t) => t.name)).toEqual(
      expect.arrayContaining(["list_skills", "load_skill"]),
    );
  });
});

describe("Fleet Auditor Engine & ADK Workflow", () => {
  it("normalizes config lines with interface context and detects per-interface drift", () => {
    const baseline = [
      "# Generated 2026-04-01",
      "! Last configuration change at 12:00",
      "hostname Island-HQ",
      "interface en0",
      "  shutdown",
      "end",
      "interface en1",
      "  ip address 10.0.0.1/24",
      "end",
      "syslog server 192.168.2.50:514",
    ].join("\n");
    const running = [
      "# Generated 2026-11-05",
      "ntp clock-period 17179869",
      "hostname Island-HQ",
      "interface en0",
      "  shutdown",
      "end",
      "interface en1",
      "  ip address 10.0.0.1/24",
      "  shutdown",
      "end",
      "ip dns redirect ad.example.com 0.0.0.0",
    ].join("\n");

    expect(normalizeConfigLines(baseline)).toEqual([
      "hostname Island-HQ",
      "interface en0",
      "[interface en0] shutdown",
      "interface en1",
      "[interface en1] ip address 10.0.0.1/24",
      "syslog server 192.168.2.50:514",
    ]);

    const drift = computeConfigDrift(running, baseline);
    expect(drift.drifted).toBe(true);
    expect(drift.added).toEqual([
      "[interface en1] shutdown",
      "ip dns redirect ad.example.com 0.0.0.0",
    ]);
    expect(drift.removed).toEqual(["syslog server 192.168.2.50:514"]);
  });

  it("routes healthy fleets to the zero-LLM-token summary node", async () => {
    const mockLlm = new MockLlm("Should not be called when fleet is healthy");
    const workflow = createFleetAuditWorkflow({
      loadDevicesFn: () => TEST_DEVICES,
      queryFn: createMockQueryFn({ drift: false }),
      model: mockLlm,
      policy: {
        goldenBaselines: {
          "hq-router":
            "hostname Island-HQ\nsyslog server 192.168.2.50:514\nsyslog level 5\nntp pool.ntp.org",
        },
      },
    });

    const runner = new InMemoryRunner({ agent: workflow });
    const outputs: unknown[] = [];

    for await (const event of runner.runEphemeral({
      userId: "test-operator",
      newMessage: { parts: [{ text: "Audit fleet" }] },
    })) {
      if (event.output !== undefined) {
        outputs.push(event.output);
      }
    }

    expect(mockLlm.callCount).toBe(0);
    const finalSummary = outputs.at(-1) as { status: string; summary: string };
    expect(finalSummary.status).toBe("healthy");
    expect(finalSummary.summary).toContain("passed compliance and drift checks");
  });

  it("routes non-compliant fleets to deterministic remediation when no Gemini API key is configured", async () => {
    const savedKeys = {
      GOOGLE_GENAI_API_KEY: process.env["GOOGLE_GENAI_API_KEY"],
      GOOGLE_API_KEY: process.env["GOOGLE_API_KEY"],
      GEMINI_API_KEY: process.env["GEMINI_API_KEY"],
    };
    delete process.env["GOOGLE_GENAI_API_KEY"];
    delete process.env["GOOGLE_API_KEY"];
    delete process.env["GEMINI_API_KEY"];

    try {
      const workflow = createFleetAuditWorkflow({
        loadDevicesFn: () => TEST_DEVICES,
        queryFn: createMockQueryFn({ drift: true }),
        policy: {
          goldenBaselines: {
            "hq-router":
              "hostname Island-HQ\nsyslog server 192.168.2.50:514\nsyslog level 5\nntp pool.ntp.org",
          },
        },
      });

      const runner = new InMemoryRunner({ agent: workflow });
      const outputs: unknown[] = [];

      for await (const event of runner.runEphemeral({
        userId: "test-operator",
        newMessage: { parts: [{ text: "Audit fleet without API key" }] },
      })) {
        if (event.output !== undefined) {
          outputs.push(event.output);
        }
      }

      const finalOutput = outputs.at(-1) as {
        status: string;
        mode: string;
        remediation_steps: { check: string }[];
      };
      expect(finalOutput.status).toBe("needs_remediation");
      expect(finalOutput.mode).toBe("deterministic");
      expect(finalOutput.remediation_steps.map((s) => s.check)).toEqual(
        expect.arrayContaining([
          "syslog_forwarding",
          "interfaces_up",
          "golden_baseline_drift",
        ]),
      );
    } finally {
      for (const [k, v] of Object.entries(savedKeys)) {
        if (v !== undefined) process.env[k] = v;
      }
    }
  });

  it("routes non-compliant/drifted fleets to the LLM remediation planner when model is provided", async () => {
    const mockLlm = new MockLlm(
      "Remediation Plan: configure syslog server 192.168.2.50 level 5 and inspect interface en1.",
    );
    const workflow = createFleetAuditWorkflow({
      loadDevicesFn: () => TEST_DEVICES,
      queryFn: createMockQueryFn({ drift: true }),
      model: mockLlm,
      policy: {
        goldenBaselines: {
          "hq-router":
            "hostname Island-HQ\nsyslog server 192.168.2.50:514\nsyslog level 5\nntp pool.ntp.org",
        },
      },
    });

    const runner = new InMemoryRunner({ agent: workflow });
    const textReplies: string[] = [];

    for await (const event of runner.runEphemeral({
      userId: "test-operator",
      newMessage: { parts: [{ text: "Audit fleet and plan remediation" }] },
    })) {
      for (const part of event.content?.parts ?? []) {
        if (part.text) textReplies.push(part.text);
      }
    }

    expect(mockLlm.callCount).toBe(1);
    expect(textReplies.join("\n")).toContain("Remediation Plan");
  });
});

describe("Firmware Upgrade ADK Workflow & Pre-flight Guardrails", () => {
  it("captures snapshots with real VpnSummary shape and flags interface + VPN peer regressions", async () => {
    const pre = await captureFirmwareSnapshot(
      TEST_DEVICES[0]!,
      createMockQueryFn({ drift: false, dropVpnPeer: false }),
    );
    expect(pre.vpn_peers).toHaveLength(1);

    const postWithRegression = await captureFirmwareSnapshot(
      TEST_DEVICES[0]!,
      createMockQueryFn({ drift: true, dropVpnPeer: true }),
    );
    expect(postWithRegression.vpn_peers).toHaveLength(0);

    const diff = diffFirmwareSnapshots(pre, postWithRegression);
    expect(diff.passed).toBe(false);
    expect(diff.regressions).toEqual(
      expect.arrayContaining([
        expect.stringContaining("Interface 'en1' was up before upgrade"),
        expect.stringContaining("VPN peer count decreased from 1 to 0"),
      ]),
    );
  });

  it("blocks firmware update via beforeToolCallback unless preflight_snapshot matches non-empty device_id", () => {
    const stateMap = new Map<string, unknown>();
    const fakeContext = {
      state: {
        get: (key: string) => stateMap.get(key),
      },
    } as unknown as Context;

    const tools = createIslandAdkTools({ loadDevicesFn: () => TEST_DEVICES });
    const configureTool = tools.find((t) => t.name === "island_configure")!;

    // 1. Blocked when preflight_snapshot is missing
    expect(
      enforcePreflightBeforeUpdateCallback({
        tool: configureTool,
        args: { device_id: "hq-router", action: "update" },
        context: fakeContext,
      }),
    ).toEqual(expect.objectContaining({ blocked: true }));

    // 2. Blocked when device_id is empty even after a snapshot is saved
    stateMap.set("preflight_snapshot", { device_id: "hq-router" });
    expect(
      enforcePreflightBeforeUpdateCallback({
        tool: configureTool,
        args: { device_id: "", action: "update" },
        context: fakeContext,
      }),
    ).toEqual(expect.objectContaining({ blocked: true }));

    // 3. Allowed once preflight_snapshot matches non-empty target device_id
    expect(
      enforcePreflightBeforeUpdateCallback({
        tool: configureTool,
        args: { device_id: "hq-router", action: "update" },
        context: fakeContext,
      }),
    ).toBeUndefined();
  });

  it("runs preflight_snapshot before firmware_upgrade_planner in the ADK Workflow", async () => {
    const mockLlm = new MockLlm(
      "Upgrade Runbook: v2.3.2 pre-flight verified (2/2 interfaces up, 1 VPN peer). Safe to proceed.",
    );
    const workflow = createFirmwareUpgradeWorkflow({
      loadDevicesFn: () => TEST_DEVICES,
      queryFn: createMockQueryFn({ drift: false }),
      model: mockLlm,
    });

    const runner = new InMemoryRunner({ agent: workflow });
    const textReplies: string[] = [];

    for await (const event of runner.runEphemeral({
      userId: "test-operator",
      newMessage: { parts: [{ text: "Generate firmware upgrade runbook for hq-router" }] },
    })) {
      for (const part of event.content?.parts ?? []) {
        if (part.text) textReplies.push(part.text);
      }
    }

    expect(mockLlm.callCount).toBe(1);
    expect(textReplies.join("\n")).toContain("Upgrade Runbook");
  });
});
