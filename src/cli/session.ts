/**
 * Session helpers for island-axi — wraps islandSsh with device resolution.
 */

import { AxiError } from "axi-sdk-js";
import {
  closeSession,
  openSession,
  runCommand,
  type DeviceConfig,
  type ShellSession,
} from "../islandSsh.js";
import { loadDevices, resolveDevice } from "../devices.js";
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
  let session: ShellSession;
  try {
    session = await openSession(device);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new AxiError(
      `SSH failed for device '${device.id}' (${device.host}): ${message}`,
      "CONNECTION_ERROR",
      [
        "Set ROUTER_PASS or ROUTER_KEY, or configure devices.json",
        "Run `island-axi devices` to list configured devices",
      ],
    );
  }

  try {
    return await fn(session);
  } finally {
    closeSession(session);
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

export async function runShow(
  device: DeviceConfig,
  command: string,
  waitMs = 3000,
): Promise<string> {
  return withSession(device, (s) => runCommand(s, command, waitMs));
}
