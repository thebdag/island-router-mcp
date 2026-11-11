import { describe, expect, it } from "vitest";
import { parseVersion } from "../src/parsers/system.js";

describe("parseVersion", () => {
  it("parses firmware 4.1 show version output", () => {
    const raw = `
Island Router firmware version 4.1
Model: IX2400
Serial number: ISL99887766
Uptime: 5 days, 12 hours, 4 minutes
Build date: 2026-11-01
Hostname: Island-Core
    `.trim();

    const result = parseVersion(raw);
    expect(result.firmware).toBe("4.1");
    expect(result.model).toBe("IX2400");
    expect(result.serialNumber).toBe("ISL99887766");
    expect(result.uptime).toBe("5 days, 12 hours, 4 minutes");
    expect(result.buildDate).toBe("2026-11-01");
    expect(result.hostname).toBe("Island-Core");
    expect(result.raw).toBe(raw);
  });

  it("parses baseline firmware 2.3.2 show version output", () => {
    const raw = `
Island Router firmware version 2.3.2
Model: IX2400
Serial number: ISL12345678
Uptime: 14 days, 3 hours, 22 minutes
Build date: 2026-01-15
Hostname: Router
    `.trim();

    const result = parseVersion(raw);
    expect(result.firmware).toBe("2.3.2");
    expect(result.model).toBe("IX2400");
    expect(result.serialNumber).toBe("ISL12345678");
    expect(result.uptime).toBe("14 days, 3 hours, 22 minutes");
    expect(result.buildDate).toBe("2026-01-15");
    expect(result.hostname).toBe("Router");
  });

  it("handles variations in formatting and key names", () => {
    const raw = `
Software Version: 4.1.0
Hardware: Island Pro Mini
Serial #: SN-445566
System Name: Branch-Office
    `.trim();

    const result = parseVersion(raw);
    expect(result.firmware).toBe("4.1.0");
    expect(result.model).toBe("Island Pro Mini");
    expect(result.serialNumber).toBe("SN-445566");
    expect(result.hostname).toBe("Branch-Office");
  });
});
