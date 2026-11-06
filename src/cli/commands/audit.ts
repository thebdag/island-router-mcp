import fs from "node:fs";
import { flagBool, flagString } from "../args.js";
import { truncateText } from "../format.js";
import {
  callCore,
  deviceFromContext,
  parseDeviceArgs,
  type CliContext,
} from "../session.js";
import { queryAudit, queryFirmwareSnapshot } from "../../core/query.js";
import { resolveLocalPath } from "../../safePath.js";

export async function auditCommand(
  args: string[],
  context?: CliContext,
): Promise<Record<string, unknown>> {
  const { parsed, deviceId } = parseDeviceArgs(
    args,
    ["device", "baseline-file"],
    "audit",
  );
  const device = deviceFromContext(context, deviceId);
  const baselineFile = flagString(parsed.flags, "baseline-file");
  let baselineText: string | undefined;
  if (baselineFile !== undefined) {
    const safePath = resolveLocalPath(baselineFile, "baseline file");
    baselineText = fs.readFileSync(safePath, "utf8");
  }

  const data = await callCore(() => queryAudit(device, baselineText));

  return {
    device: { id: device.id, host: device.host },
    compliant: data.compliant,
    firmware: data.firmware_version ?? "(unknown)",
    interfaces: `${String(data.interfaces_up)}/${String(data.interfaces_total)} up`,
    vpn_peers: data.vpn_peers_count,
    checks: data.checks,
    drift: data.drift ?? "not checked (pass --baseline-file <path>)",
    remediation_steps:
      data.remediation_steps.length === 0
        ? "0 remediation steps needed"
        : data.remediation_steps,
    help: [
      "Run `island-axi audit --baseline-file <path>` to check golden baseline drift",
      "Run `island-axi configure <action> ... --confirm` to apply remediations",
    ],
  };
}

export async function firmwareSnapshotCommand(
  args: string[],
  context?: CliContext,
): Promise<Record<string, unknown>> {
  const { parsed, deviceId } = parseDeviceArgs(
    args,
    ["device", "full"],
    "firmware-snapshot",
  );
  const full = flagBool(parsed.flags, "full");
  const device = deviceFromContext(context, deviceId);
  const data = await callCore(() => queryFirmwareSnapshot(device));
  const { text, truncated } = truncateText(data.running_config, 1200);

  return {
    device: { id: device.id, host: device.host },
    captured_at: data.captured_at,
    firmware: data.version.firmware || "(unknown)",
    readiness_passed: data.runbook.readiness_passed,
    warnings:
      data.runbook.warnings.length === 0
        ? "0 pre-flight warnings"
        : data.runbook.warnings,
    baseline_counts: data.runbook.baseline_counts,
    steps: data.runbook.steps,
    rollback_plan: data.runbook.rollback_plan,
    running_config: full ? data.running_config : text,
    help: [
      ...(!full && truncated
        ? ["Re-run `island-axi firmware-snapshot --full` for complete running-config"]
        : []),
      "Run `island-axi configure update --confirm` to check/install firmware",
    ],
  };
}
