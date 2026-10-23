/**
 * devices.ts — Shared Island Router device inventory loading.
 */

import fs from "node:fs";
import type { DeviceConfig } from "./islandSsh.js";
import { PathAccessError, resolveLocalPath } from "./safePath.js";

export function resolveInventoryPath(inventoryPath?: string): string {
  const raw = inventoryPath ?? process.env["ISLAND_DEVICE_INVENTORY"] ?? "devices.json";
  const resolved = resolveLocalPath(raw, "inventory path");
  if (!resolved.endsWith(".json")) {
    throw new PathAccessError("inventory path must be a .json file");
  }
  return resolved;
}

function readInventory(filePath: string): string {
  // filePath is already confined to the cwd or home directory.
  // nosec
  return fs.readFileSync(filePath, "utf8");
}

export function loadDevices(inventoryPath?: string): DeviceConfig[] {
  const path = resolveInventoryPath(inventoryPath);

  try {
    return JSON.parse(readInventory(path)) as DeviceConfig[];
  } catch (error) {
    if (error instanceof PathAccessError) throw error;
    return [
      {
        id: process.env["ISLAND_DEVICE_ID"] ?? "island-default",
        host: process.env["ROUTER_IP"] ?? process.env["ROUTER_HOST"] ?? "192.168.2.1", // NOSONAR
        port: Number.parseInt(process.env["ROUTER_PORT"] ?? "22", 10),
        username: process.env["ROUTER_USER"] ?? "admin",
        authMethod: "password" as const,
        description: "Default Island Router (from env)",
      },
    ];
  }
}

export function getDeviceOrThrow(devices: DeviceConfig[], deviceId: string): DeviceConfig {
  const dev = devices.find((d) => d.id === deviceId);
  if (!dev) {
    const available = devices.map((d) => d.id).join(", ") || "(none)";
    throw new Error(`Unknown device_id '${deviceId}'. Available: ${available}`);
  }
  return dev;
}

/** Resolve `--device` flag or fall back to first inventory entry. */
export function resolveDevice(
  devices: DeviceConfig[],
  deviceId?: string,
): DeviceConfig {
  if (deviceId) return getDeviceOrThrow(devices, deviceId);
  if (devices.length === 0) {
    throw new Error(
      "No devices configured. Create devices.json or set ROUTER_IP / ROUTER_PASS.",
    );
  }
  return devices[0]!;
}
