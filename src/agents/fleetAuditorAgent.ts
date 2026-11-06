/**
 * ADK Fleet Auditor Workflow — thin `@google/adk` graph adapter over `src/core/fleet.ts`.
 *
 * Replaces prose instructions with a hybrid ADK graph (`Workflow`):
 * 1. `collect_fleet_audit` (`FunctionNode`): Deterministically polls all devices in inventory,
 *    normalizes & diffs running-config against golden baselines, and evaluates compliance policies.
 * 2. Conditional routing (`ctx.route`):
 *    - `"healthy"` → `healthy_fleet_summary` (`FunctionNode`, 0 LLM tokens).
 *    - `"needs_remediation"` (when LLM credentials/model exist) → `fleet_remediation_planner` (`LlmAgent`).
 *    - `"needs_remediation_deterministic"` (when no Gemini API key is set) → `deterministic_remediation_planner` (`FunctionNode`, 0 LLM tokens, never crashes).
 */

import {
  FunctionNode,
  LlmAgent,
  Workflow,
  type BaseLlm,
  type NodeContext,
} from "@google/adk";
import {
  buildDeterministicRemediationPlan,
  collectDeviceAuditSnapshot,
  computeConfigDrift,
  evaluateDeviceCompliance,
  normalizeConfigLines,
  type ConfigDriftResult,
  type DeviceAuditResult,
  type DeviceAuditSnapshot,
  type DeviceComplianceCheck,
  type FleetAuditReport,
  type FleetCompliancePolicy,
  type RemediationStep,
} from "../core/index.js";
import { loadDevices } from "../devices.js";
import {
  createIslandAdkTools,
  hasLlmCredentials,
  type AgentToolDependencies,
} from "./tools.js";

export {
  buildDeterministicRemediationPlan,
  collectDeviceAuditSnapshot,
  computeConfigDrift,
  evaluateDeviceCompliance,
  normalizeConfigLines,
  type ConfigDriftResult,
  type DeviceAuditResult,
  type DeviceAuditSnapshot,
  type DeviceComplianceCheck,
  type FleetAuditReport,
  type FleetCompliancePolicy,
  type RemediationStep,
};

export interface FleetAuditWorkflowOptions extends AgentToolDependencies {
  policy?: FleetCompliancePolicy;
  model?: string | BaseLlm;
}

/**
 * Build the ADK `FunctionNode` that audits all devices and routes to:
 * - `"healthy"` when all routers pass
 * - `"needs_remediation"` when non-compliant and LLM credentials/model are available
 * - `"needs_remediation_deterministic"` when non-compliant and no LLM API key is configured
 */
export function createCollectFleetAuditNode(
  options: FleetAuditWorkflowOptions = {},
): FunctionNode<unknown, FleetAuditReport> {
  const getDevices = options.loadDevicesFn ?? (() => loadDevices());
  const queryFn = options.queryFn;
  const policy = options.policy ?? {};

  return new FunctionNode<unknown, FleetAuditReport>(
    "collect_fleet_audit",
    async (ctx: NodeContext): Promise<FleetAuditReport> => {
      const devices = getDevices();
      const results: DeviceAuditResult[] = [];

      for (const dev of devices) {
        const snapshot = await collectDeviceAuditSnapshot(dev, queryFn);
        results.push(evaluateDeviceCompliance(snapshot, policy));
      }

      const compliantCount = results.filter((r) => r.compliant).length;
      const nonCompliantCount = results.length - compliantCount;

      const report: FleetAuditReport = {
        timestamp: new Date().toISOString(),
        total_devices: results.length,
        compliant_count: compliantCount,
        non_compliant_count: nonCompliantCount,
        devices: results,
      };
      report.remediation_steps = buildDeterministicRemediationPlan(report);

      ctx.state.set("fleet_audit_report", report);
      if (nonCompliantCount === 0) {
        ctx.route = "healthy";
      } else if (hasLlmCredentials(options.model)) {
        ctx.route = "needs_remediation";
      } else {
        ctx.route = "needs_remediation_deterministic";
      }
      return report;
    },
    {
      description:
        "Polls all Island Routers in inventory, computes golden baseline drift and compliance checks, and routes to healthy summary, deterministic remediation, or LLM remediation.",
    },
  );
}

/**
 * Zero-LLM-token terminal node when every device in the fleet passes compliance.
 */
export function createHealthyFleetSummaryNode(): FunctionNode<
  FleetAuditReport,
  { status: "healthy"; mode: "deterministic"; summary: string; report: FleetAuditReport }
> {
  return new FunctionNode(
    "healthy_fleet_summary",
    (ctx: NodeContext, input: FleetAuditReport) => {
      const report =
        input ?? (ctx.state.get("fleet_audit_report") as FleetAuditReport);
      return {
        status: "healthy" as const,
        mode: "deterministic" as const,
        summary: `All ${String(report.total_devices)} Island Router device(s) passed compliance and drift checks at ${report.timestamp}.`,
        report,
      };
    },
    {
      description:
        "Emits a deterministic summary when all routers in the fleet are compliant (zero LLM calls).",
    },
  );
}

/**
 * Zero-LLM-token deterministic remediation terminal node used when no Gemini API key is configured.
 */
export function createDeterministicRemediationNode(): FunctionNode<
  FleetAuditReport,
  {
    status: "needs_remediation";
    mode: "deterministic";
    summary: string;
    report: FleetAuditReport;
    remediation_steps: RemediationStep[];
  }
> {
  return new FunctionNode(
    "deterministic_remediation_planner",
    (ctx: NodeContext, input: FleetAuditReport) => {
      const report =
        input ?? (ctx.state.get("fleet_audit_report") as FleetAuditReport);
      const steps =
        report.remediation_steps ?? buildDeterministicRemediationPlan(report);
      return {
        status: "needs_remediation" as const,
        mode: "deterministic" as const,
        summary: `Detected ${String(report.non_compliant_count)} non-compliant device(s); generated ${String(steps.length)} deterministic remediation step(s) (no LLM API key required).`,
        report,
        remediation_steps: steps,
      };
    },
    {
      description:
        "Generates deterministic remediation commands when fleet drift or compliance issues are detected and no LLM API key is configured.",
    },
  );
}

/**
 * ADK `LlmAgent` invoked when `collect_fleet_audit` detects drift or compliance violations
 * and an LLM model/API key is available.
 */
export function createFleetRemediationAgent(
  options: FleetAuditWorkflowOptions = {},
): LlmAgent {
  const tools = createIslandAdkTools(options);

  return new LlmAgent({
    name: "fleet_remediation_planner",
    model: options.model ?? "gemini-2.5-flash",
    description:
      "Analyzes Island Router fleet compliance failures and config drift, and proposes or executes guarded remediations.",
    instruction: [
      "You are the Island Router Fleet Compliance & Remediation Agent.",
      "Review the structured `FleetAuditReport` provided in the workflow input / session state.",
      "For every non-compliant device:",
      "1. Summarize failed compliance checks (syslog numeric level 0-7, NTP servers, down interfaces, golden baseline drift).",
      "2. Recommend the exact remediation action (e.g. `set_syslog`, `set_ntp`, `set_hostname`, `add_dns_redirect`).",
      "3. Remember Island Router CLI rules: config commands run directly at the global prompt (never `configure terminal`), and syslog levels are numeric 0-7.",
      "4. Do NOT call `island_configure` unless the user explicitly asks to apply remediations; when called, `island_configure` enforces human-in-the-loop confirmation.",
    ].join("\n"),
    tools,
    outputKey: "fleet_remediation_plan",
  });
}

/**
 * Complete ADK `Workflow` combining deterministic fleet telemetry collection,
 * conditional routing (`healthy` vs `needs_remediation` vs `needs_remediation_deterministic`),
 * and LLM or deterministic remediation planning.
 */
export function createFleetAuditWorkflow(
  options: FleetAuditWorkflowOptions = {},
): Workflow {
  const collectNode = createCollectFleetAuditNode(options);
  const healthyNode = createHealthyFleetSummaryNode();
  const deterministicRemediationNode = createDeterministicRemediationNode();
  const remediationAgent = createFleetRemediationAgent(options);

  return new Workflow({
    name: "island_fleet_audit_workflow",
    description:
      "Audits an Island Router fleet for compliance and golden-baseline drift, routing healthy fleets or keyless environments to deterministic nodes and LLM-enabled non-compliant fleets to the remediation planner.",
    edges: [
      [
        "START",
        collectNode,
        {
          healthy: healthyNode,
          needs_remediation: remediationAgent,
          needs_remediation_deterministic: deterministicRemediationNode,
        },
      ],
    ],
  });
}
