/**
 * parsers/routes.ts — Parse `show ip routes` and `show ip neighbors` output.
 */

export interface Route {
  destination: string;
  mask: string;
  gateway: string;
  interface: string;
  metric: number | null;
  type: string;
}

export interface Neighbor {
  ip: string;
  mac: string;
  interface: string;
  state: string;
}

/**
 * Parse `show ip routes` output.
 *
 * Expected format varies but typically contains lines like:
 *   C    192.168.2.0/24 is directly connected, ethernet2
 *   S    0.0.0.0/0 [1/0] via 100.64.0.1, ethernet1
 */
export function parseRoutes(raw: string): Route[] {
  const lines = raw.split("\n").map((l) => l.trim()).filter(Boolean);
  const results: Route[] = [];

  for (const line of lines) {
    // Skip header/legend lines
    if (/^codes/i.test(line) || /^gateway/i.test(line) || line.startsWith("---")) continue;

    // Pattern: TYPE  dest/mask  [metric] via gateway, interface
    const viaMatch = line.match(
      /^([A-Z*]+)\s+(\S+)\s+(?:\[(\d+)(?:\/\d+)?\]\s+)?via\s+([^,\s]+),?\s*(\S*)$/i,
    );
    if (viaMatch) {
      const [, type, dest, metric, gw, iface] = viaMatch;
      const [destination, mask] = (dest ?? "").split("/");
      results.push({
        destination: destination ?? "",
        mask: mask ? `/${mask}` : "",
        gateway: gw ?? "",
        interface: iface ?? "",
        metric: metric ? parseInt(metric, 10) : null,
        type: type ?? "",
      });
      continue;
    }

    // Pattern: TYPE  dest/mask  is directly connected, interface
    const directMatch = line.match(
      /^([A-Z*]+)\s+(\S+)\s+is\s+directly\s+connected,?\s*(\S*)$/i,
    );
    if (directMatch) {
      const [, type, dest, iface] = directMatch;
      const [destination, mask] = (dest ?? "").split("/");
      results.push({
        destination: destination ?? "",
        mask: mask ? `/${mask}` : "",
        gateway: "directly connected",
        interface: iface ?? "",
        metric: null,
        type: type ?? "",
      });
    }
  }

  return results;
}

/**
 * Parse `show ip neighbors` (ARP/neighbor table) output.
 *
 * Expected format (table):
 *   IP Address      MAC Address        Interface    State
 *   192.168.2.100   aa:bb:cc:dd:ee:ff  ethernet2    REACHABLE
 */
export function parseNeighbors(raw: string): Neighbor[] {
  const lines = raw.split("\n").map((l) => l.trim()).filter(Boolean);
  const results: Neighbor[] = [];

  let dataStarted = false;
  for (const line of lines) {
    if (!dataStarted) {
      if (/ip\s+address/i.test(line) || /^-{3,}/.test(line)) {
        dataStarted = true;
        continue;
      }
      continue;
    }

    if (/^-{3,}/.test(line)) continue;

    // Match: IP  MAC  Interface  State
    const parts = line.split(/\s+/);
    if (parts.length >= 4) {
      // Validate that the first part looks like an IP
      if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(parts[0]!)) {
        results.push({
          ip: parts[0]!,
          mac: parts[1]!,
          interface: parts[2]!,
          state: parts.slice(3).join(" "),
        });
      }
    }
  }

  return results;
}
