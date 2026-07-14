/**
 * AXI CLI session helpers — device resolution + AxiError wrapping around core SSH.
 */

import { AxiError } from "axi-sdk-js";
import type { DeviceConfig, ShellSession } from "../islandSsh.js";
import { loadDevices, resolveDevice } from "../devices.js";
import { withSession as coreWithSession } from "../core/session.js";
import { assertKnownFlags, flagString, parseFlags, type ParsedArgs } from "./args.js";

export interface CliContext {
  devices: DeviceConfig[];
}

export function createContext(): CliContext {
  return { devices: loadDevices() };
}

export async function withSession<T>(
  device: DeviceConfig,
  fn: (session: ShellSession) => Promise<T>,
): Promise<T> {
  try {
    return await coreWithSession(device, fn);
  } catch (err) {
    if (err instanceof AxiError) throw err;
    const message = err instanceof Error ? err.message : String(err);
    if (/SSH|password|ROUTER_|auth|ECONNREFUSED|timed out/i.test(message)) {
      throw new AxiError(
        `SSH failed for device '${device.id}' (${device.host}): ${message}`,
        "CONNECTION_ERROR",
        [
          "Set ROUTER_PASS or ROUTER_KEY, or configure devices.json",
          "Run `island-axi devices` to list configured devices",
        ],
      );
    }
    throw new AxiError(message, "ERROR");
  }
}

export function parseDeviceArgs(
  args: string[],
  knownFlags: string[],
  command: string,
): { parsed: ParsedArgs; deviceId?: string } {
  const parsed = parseFlags(args);
  assertKnownFlags(parsed.flags, knownFlags, command);
  return {
    parsed,
    deviceId: flagString(parsed.flags, "device"),
  };
}

export function deviceFromContext(
  context: CliContext | undefined,
  deviceId?: string,
): DeviceConfig {
  const devices = context?.devices ?? loadDevices();
  try {
    return resolveDevice(devices, deviceId);
  } catch (err) {
    throw new AxiError(
      err instanceof Error ? err.message : String(err),
      "VALIDATION_ERROR",
      ["Run `island-axi devices` to list device ids"],
    );
  }
}

/** Map core Error → AxiError for CLI presentation. */
export async function callCore<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof AxiError) throw err;
    const message = err instanceof Error ? err.message : String(err);
    let code = "ERROR";
    if (/Invalid |required|not allowed/i.test(message)) {
      code = "VALIDATION_ERROR";
    } else if (/SSH|password|ROUTER_|auth|ECONNREFUSED|timed out/i.test(message)) {
      code = "CONNECTION_ERROR";
    }
    throw new AxiError(message, code);
  }
}
