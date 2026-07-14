import { describe, expect, it } from "vitest";
import { assertKnownFlags, parseFlags, parseLimit } from "../src/cli/args.js";
import { parseFieldsFlag, pickFields, truncateText } from "../src/cli/format.js";
import { homeCommand } from "../src/cli/home.js";
import { isCommandAllowed, normalizeShowCommand } from "../src/allowedCommands.js";
import { AxiError } from "axi-sdk-js";

describe("parseFlags", () => {
  it("parses positionals and value flags", () => {
    const { positionals, flags } = parseFlags([
      "1.1.1.1",
      "--device",
      "edge-1",
      "--limit=20",
      "--full",
    ]);
    expect(positionals).toEqual(["1.1.1.1"]);
    expect(flags.device).toBe("edge-1");
    expect(flags.limit).toBe("20");
    expect(flags.full).toBe(true);
  });

  it("rejects unknown flags via assertKnownFlags", () => {
    const { flags } = parseFlags(["--stat", "closed"]);
    expect(() => assertKnownFlags(flags, ["state", "limit"], "list")).toThrow(AxiError);
  });
});

describe("parseLimit / fields / truncate", () => {
  it("caps limit", () => {
    expect(parseLimit("999", 50, 100)).toBe(100);
    expect(parseLimit(undefined, 50, 100)).toBe(50);
  });

  it("picks fields and truncates", () => {
    expect(parseFieldsFlag("a,b", ["x"])).toEqual(["a", "b"]);
    expect(pickFields({ a: 1, b: 2, c: 3 }, ["a", "c"])).toEqual({ a: 1, c: 3 });
    const t = truncateText("abcdefghij", 5);
    expect(t.truncated).toBe(true);
    expect(t.totalChars).toBe(10);
    expect(t.text).toContain("truncated");
  });
});

describe("homeCommand", () => {
  it("shows definitive empty state", () => {
    const out = homeCommand([], { devices: [] });
    expect(String(out.devices)).toContain("0 devices");
    expect(out.help).toBeTruthy();
  });

  it("lists devices with count", () => {
    const out = homeCommand([], {
      devices: [
        {
          id: "edge-1",
          host: "192.168.2.1",
          port: 22,
          username: "admin",
          authMethod: "password",
          description: "Primary",
        },
      ],
    });
    expect(out.count).toBe(1);
    expect(out.devices).toEqual([
      { id: "edge-1", host: "192.168.2.1", port: 22, description: "Primary" },
    ]);
  });
});

describe("allowed show commands", () => {
  it("normalizes and allowlists", () => {
    expect(normalizeShowCommand("version")).toBe("show version");
    expect(isCommandAllowed("show version")).toBe(true);
    expect(isCommandAllowed("reload")).toBe(false);
  });
});
