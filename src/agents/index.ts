/**
 * Island Router ADK Agents & Workflows (`@google/adk`).
 *
 * Exports native ADK FunctionTools, SkillToolset loader, and executable
 * multi-step workflows for Fleet Auditing and Firmware Upgrade Planning.
 */

export {
  createIslandAdkTools,
  createIslandSkillToolset,
  hasLlmCredentials,
  type AgentToolDependencies,
} from "./tools.js";

export {
  buildDeterministicRemediationPlan,
  collectDeviceAuditSnapshot,
  computeConfigDrift,
  createCollectFleetAuditNode,
  createDeterministicRemediationNode,
  createFleetAuditWorkflow,
  createFleetRemediationAgent,
  createHealthyFleetSummaryNode,
  evaluateDeviceCompliance,
  normalizeConfigLines,
  type ConfigDriftResult,
  type DeviceAuditResult,
  type DeviceAuditSnapshot,
  type DeviceComplianceCheck,
  type FleetAuditReport,
  type FleetAuditWorkflowOptions,
  type FleetCompliancePolicy,
  type RemediationStep,
} from "./fleetAuditorAgent.js";

export {
  buildDeterministicUpgradeRunbook,
  captureFirmwareSnapshot,
  createDeterministicFirmwarePlannerNode,
  createFirmwarePlannerAgent,
  createFirmwareUpgradeWorkflow,
  createPreflightSnapshotNode,
  diffFirmwareSnapshots,
  enforcePreflightBeforeUpdateCallback,
  type DeterministicUpgradeRunbook,
  type FirmwareDeviceSnapshot,
  type FirmwareSnapshotDiff,
  type FirmwareUpgradeWorkflowOptions,
} from "./firmwareUpgradeAgent.js";
