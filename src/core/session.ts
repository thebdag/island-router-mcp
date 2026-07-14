/**
 * Shared SSH session helper for the Island Router core.
 * Surfaces (MCP / AXI) may wrap errors for their own protocols.
 */

import {
  closeSession,
  openSession,
  type DeviceConfig,
  type ShellSession,
} from "../islandSsh.js";

export async function withSession<T>(
  device: DeviceConfig,
  fn: (session: ShellSession) => Promise<T>,
): Promise<T> {
  const session = await openSession(device);
  try {
    return await fn(session);
  } finally {
    closeSession(session);
  }
}
