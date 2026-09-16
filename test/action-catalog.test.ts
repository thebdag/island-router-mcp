import { describe, expect, it } from "vitest";
import {
  ACTION_CATALOG,
  ActionCatalogError,
  describeAction,
  formatActionError,
  formatDescribe,
  listActions,
  pickActionParams,
} from "../src/core/actionCatalog.js";
import { QUERY_ACTIONS } from "../src/core/query.js";
import { CONFIGURE_ACTIONS } from "../src/core/configure.js";

describe("ACTION_CATALOG completeness", () => {
  it("covers every query and configure action exactly once", () => {
    const catalogNames = ACTION_CATALOG.map((s) => s.name);
    const expected = [...QUERY_ACTIONS, ...CONFIGURE_ACTIONS];
    expect([...catalogNames].sort()).toEqual([...expected].sort());
    expect(new Set(catalogNames).size).toBe(catalogNames.length);
  });

  it("tags query vs configure kinds to match core arrays", () => {
    const queryNames = ACTION_CATALOG.filter((s) => s.kind === "query").map((s) => s.name);
    const configureNames = ACTION_CATALOG.filter((s) => s.kind === "configure").map((s) => s.name);
    expect(queryNames).toEqual([...QUERY_ACTIONS]);
    expect(configureNames).toEqual([...CONFIGURE_ACTIONS]);
  });
});

describe("listActions", () => {
  it("returns compact entries with required names only", () => {
    const result = listActions();
    expect(result.count).toBe(ACTION_CATALOG.length);
    expect(Array.isArray(result.actions)).toBe(true);
    const ping = (result.actions as { name: string; required: string[] }[]).find(
      (a) => a.name === "ping",
    );
    expect(ping?.required).toEqual(["target"]);
    expect(result.help[0]).toContain("island_actions");
  });

  it("filters by kind", () => {
    const result = listActions({ kind: "configure" });
    expect(result.count).toBe(CONFIGURE_ACTIONS.length);
    const names = (result.actions as { kind: string }[]).map((a) => a.kind);
    expect(new Set(names)).toEqual(new Set(["configure"]));
  });

  it("filters by query substring on name or summary", () => {
    const byName = listActions({ query: "syslog" });
    expect(byName.count).toBeGreaterThan(0);
    const names = (byName.actions as { name: string }[]).map((a) => a.name);
    expect(names).toEqual(expect.arrayContaining(["set_syslog", "remove_syslog"]));

    const bySummary = listActions({ query: "ARP" });
    expect(bySummary.count).toBe(1);
    expect((bySummary.actions as { name: string }[])[0]?.name).toBe("neighbors");
  });

  it("returns a definitive empty state", () => {
    const result = listActions({ query: "no-such-action-xyz" });
    expect(result.count).toBe(0);
    expect(result.actions).toBe("0 actions matched 'no-such-action-xyz'");
    expect(result.help[0]).toMatch(/without query\/kind/);
  });
});

describe("describeAction", () => {
  it("returns the full spec", () => {
    const spec = describeAction("add_dhcp");
    expect(spec.kind).toBe("configure");
    expect(spec.params.map((p) => p.name)).toEqual(["mac", "ip", "hostname"]);
  });

  it("throws ActionCatalogError for unknown names", () => {
    expect(() => describeAction("not_an_action")).toThrow(ActionCatalogError);
    try {
      describeAction("not_an_action");
    } catch (err) {
      expect(err).toBeInstanceOf(ActionCatalogError);
      expect((err as ActionCatalogError).payload.error).toContain("not_an_action");
      expect((err as ActionCatalogError).payload.help).toContain("island_actions");
    }
  });

  it("formatDescribe points at the invoke tool and confirmation gate", () => {
    const described = formatDescribe(describeAction("set_led"));
    expect(described.invoke).toBe("island_configure");
    expect(described.confirmation_phrase).toBe("apply_change");
    expect(described.example).toEqual({ led_level: 50 });

    const queryDescribed = formatDescribe(describeAction("ping"));
    expect(queryDescribed.invoke).toBe("island_query");
    expect(queryDescribed.confirmation_phrase).toBeUndefined();
  });
});

describe("pickActionParams", () => {
  const ping = describeAction("ping");
  const syslog = describeAction("set_syslog");

  it("copies known keys and injects action", () => {
    expect(pickActionParams(ping, { target: "1.1.1.1" })).toEqual({
      action: "ping",
      target: "1.1.1.1",
    });
  });

  it("treats missing raw as empty params", () => {
    expect(pickActionParams(describeAction("status"), undefined)).toEqual({ action: "status" });
  });

  it("rejects unknown keys", () => {
    expect(() => pickActionParams(ping, { target: "1.1.1.1", extra: true })).toThrow(
      ActionCatalogError,
    );
    try {
      pickActionParams(ping, { target: "1.1.1.1", extra: true });
    } catch (err) {
      expect((err as ActionCatalogError).payload.error).toContain("unknown param(s): extra");
      expect((err as ActionCatalogError).payload.required).toEqual(["target"]);
      expect((err as ActionCatalogError).payload.example).toEqual({ target: "1.1.1.1" });
    }
  });

  it("rejects type mismatches", () => {
    expect(() => pickActionParams(ping, { target: 1 })).toThrow(ActionCatalogError);
    try {
      pickActionParams(ping, { target: 1 });
    } catch (err) {
      expect((err as ActionCatalogError).payload.error).toContain("must be string");
    }
  });

  it("rejects enum mismatches", () => {
    expect(() => pickActionParams(syslog, { server_ip: "10.0.0.1", protocol: "icmp" })).toThrow(
      ActionCatalogError,
    );
  });

  it("only assigns catalog-known own keys", () => {
    const picked = pickActionParams(ping, { target: "8.8.8.8" });
    expect(Object.keys(picked).sort()).toEqual(["action", "target"]);
  });
});

describe("formatActionError", () => {
  it("includes required, optional, example, and island_actions help", () => {
    const payload = formatActionError("add_dhcp", "'mac' required");
    expect(payload.error).toBe("'mac' required");
    expect(payload.action).toBe("add_dhcp");
    expect(payload.required).toEqual(["mac", "ip"]);
    expect(payload.optional).toEqual(["hostname"]);
    expect(payload.example).toEqual({
      mac: "aa:bb:cc:dd:ee:ff",
      ip: "192.168.1.50",
      hostname: "nas",
    });
    expect(payload.help).toBe("Call island_actions with action='add_dhcp' for the full schema");
  });

  it("falls back for unknown actions", () => {
    const payload = formatActionError("nope", "Unknown configure action: 'nope'");
    expect(payload.required).toBeUndefined();
    expect(payload.help).toBe("Call island_actions to list actions");
  });
});
