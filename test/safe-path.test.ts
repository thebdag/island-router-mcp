import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PathAccessError, resolveLocalPath } from "../src/safePath.js";
import { resolveInventoryPath } from "../src/devices.js";

describe("resolveLocalPath", () => {
  it("allows a relative path inside the working directory", () => {
    expect(resolveLocalPath("devices.json", "inventory path")).toBe(
      path.resolve("devices.json"),
    );
  });

  it("rejects paths that escape the working directory and home", () => {
    expect(() => resolveLocalPath("/etc/passwd", "inventory path")).toThrow(PathAccessError);
    expect(() => resolveLocalPath("../../../../../../etc/passwd", "privateKeyPath")).toThrow(
      PathAccessError,
    );
  });

  it("allows a path under the home directory", () => {
    const key = path.join(os.homedir(), ".ssh", "id_ed25519");
    expect(resolveLocalPath(key, "privateKeyPath")).toBe(key);
    expect(resolveLocalPath("~/.ssh/id_ed25519", "privateKeyPath")).toBe(key);
  });

  it("requires inventory files to be json", () => {
    expect(resolveInventoryPath("devices.json")).toBe(path.resolve("devices.json"));
    expect(() => resolveInventoryPath("devices.txt")).toThrow(PathAccessError);
  });
});
