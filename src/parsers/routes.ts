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

// Pre-compiled regexes
const DIRECT_RE = /^([A-Z*]+)\s+(\S+)\s+is\s+directly\s+connected,?\s*(\S*)$/i;
const IP_RE = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/;

/** Split a CIDR destination into separate destination and mask fields. */
function splitCidr(dest: string): { destination: string; mask: string } {
  const [destination, mask] = dest.split("/");
  return { destination: destination ?? "", mask: mask ? `/${mask}` : "" };
}

function parseMetric(token: string | undefined): number | null {
  if (!token?.startsWith("[") || !token.endsWith("]")) return null;
  const metric = token.slice(1, -1).split("/")[0];
  if (!metric || !/^\d+$/.test(metric)) return null;
  return Number.parseInt(metric, 10);
}

function parseViaRoute(line: string): Route | undefined {
  const words = line.trim().split(/\s+/);
  const viaIndex = words.findIndex((word) => word.toLowerCase() === "via");
  if (viaIndex < 2 || viaIndex === words.length - 1) return undefined;

  const prefix = words.slice(0, viaIndex).join(" ");
  const suffix = words.slice(viaIndex + 1).join(" ");

  const prefixParts = prefix.split(" ");
  const type = prefixParts[0];
  const dest = prefixParts[1];
  if (!type || !dest) return undefined;

  const commaIndex = suffix.indexOf(",");
  const gatewayAndInterface = suffix.split(" ");
  const gateway = commaIndex === -1
    ? gatewayAndInterface[0]
    : suffix.slice(0, commaIndex).trim();
  const iface = commaIndex === -1
    ? gatewayAndInterface.slice(1).join(" ")
    : suffix.slice(commaIndex + 1).trim();
  if (!gateway) return undefined;

  const { destination, mask } = splitCidr(dest);
  return {
    destination,
    mask,
    gateway,
    interface: iface,
    metric: parseMetric(prefixParts[2]),
    type,
  };
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
    const viaRoute = parseViaRoute(line);
    if (viaRoute) {
      results.push(viaRoute);
      continue;
    }

    // Pattern: TYPE  dest/mask  is directly connected, interface
    const directMatch = DIRECT_RE.exec(line);
    if (directMatch) {
      const [, type, dest, iface] = directMatch;
      const { destination, mask } = splitCidr(dest ?? "");
      results.push({
        destination,
        mask,
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
    if (parts.length >= 4 && IP_RE.test(parts[0] ?? "")) {
      results.push({
        ip: parts[0] ?? "",
        mac: parts[1] ?? "",
        interface: parts[2] ?? "",
        state: parts.slice(3).join(" "),
      });
    }
  }

  return results;
}
