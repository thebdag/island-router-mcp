/**
 * Island Router ADK Agents & Workflows (`@google/adk`).
 *
 * Exports native ADK FunctionTools, SkillToolset loader, and executable
 * multi-step workflows for Fleet Auditing and Firmware Upgrade Planning.
 */

export {
  createIslandAdkTools,
  createIslandSkillToolset,
  type AgentToolDependencies,
} from "./tools.js";

export {
  collectDeviceAuditSnapshot,
  computeConfigDrift,
  createCollectFleetAuditNode,
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
} from "./fleetAuditorAgent.js";

export {
  captureFirmwareSnapshot,
  createFirmwarePlannerAgent,
  createFirmwareUpgradeWorkflow,
  createPreflightSnapshotNode,
  diffFirmwareSnapshots,
  enforcePreflightBeforeUpdateCallback,
  type FirmwareDeviceSnapshot,
  type FirmwareSnapshotDiff,
  type FirmwareUpgradeWorkflowOptions,
} from "./firmwareUpgradeAgent.js";
