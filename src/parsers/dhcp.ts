/**
 * parsers/dhcp.ts — Parse `show ip dhcp-reservations` output.
 * Supports both table format and CSV format.
 */

export interface DhcpReservation {
  mac: string;
  ip: string;
  hostname: string;
  interface: string;
  status: string;
}

const IP_RE = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/;
const MAC_RE = /^[0-9a-fA-F]{2}[:\-][0-9a-fA-F]{2}[:\-][0-9a-fA-F]{2}[:\-][0-9a-fA-F]{2}[:\-][0-9a-fA-F]{2}[:\-][0-9a-fA-F]{2}$/;

/**
 * Parse `show ip dhcp-reservations csv` output.
 *
 * Expected CSV format:
 *   MAC,IP,Hostname,Interface,Status
 *   aa:bb:cc:dd:ee:ff,192.168.2.100,my-device,ethernet2,active
 *
 * If headers aren't present, assumes MAC,IP,hostname order from columns.
 */
export function parseDhcpReservationsCsv(raw: string): DhcpReservation[] {
  const lines = raw.split("\n").map((l) => l.trim()).filter(Boolean);
  const results: DhcpReservation[] = [];

  // Detect header line
  let headerMap: Record<string, number> | null = null;
  let startIdx = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const lower = line.toLowerCase();
    if (lower.includes("mac") && (lower.includes("ip") || lower.includes("address"))) {
      // This is a header line — build column index
      const cols = line.split(",").map((c) => c.trim().toLowerCase());
      headerMap = {};
      for (let j = 0; j < cols.length; j++) {
        const col = cols[j]!;
        if (col.includes("mac")) headerMap["mac"] = j;
        else if (col.includes("ip") || col.includes("address")) headerMap["ip"] = j;
        else if (col.includes("host") || col.includes("name")) headerMap["hostname"] = j;
        else if (col.includes("interface") || col.includes("iface")) headerMap["interface"] = j;
        else if (col.includes("status") || col.includes("state")) headerMap["status"] = j;
      }
      startIdx = i + 1;
      break;
    }
  }

  for (let i = startIdx; i < lines.length; i++) {
    const line = lines[i]!;

    // Skip non-data lines
    if (line.startsWith("---") || line.startsWith("Router") || line.startsWith("show ")) continue;

    const parts = line.split(",").map((p) => p.trim());
    if (parts.length < 2) continue;

    if (headerMap) {
      // Use header-mapped columns
      const mac = parts[headerMap["mac"] ?? 0] ?? "";
      const ip = parts[headerMap["ip"] ?? 1] ?? "";
      if (!mac || !ip) continue;

      results.push({
        mac,
        ip,
        hostname: parts[headerMap["hostname"] ?? 2] ?? "",
        interface: parts[headerMap["interface"] ?? 3] ?? "",
        status: parts[headerMap["status"] ?? 4] ?? "",
      });
    } else {
      // No header — heuristic: detect MAC and IP in first two columns
      const [first, second, ...rest] = parts;
      if (!first || !second) continue;

      let mac = "", ip = "", hostname = "";
      if (MAC_RE.test(first) && IP_RE.test(second)) {
        mac = first;
        ip = second;
        hostname = rest[0] ?? "";
      } else if (IP_RE.test(first) && MAC_RE.test(second)) {
        ip = first;
        mac = second;
        hostname = rest[0] ?? "";
      } else {
        continue; // Can't identify fields
      }

      results.push({
        mac,
        ip,
        hostname,
        interface: rest[1] ?? "",
        status: rest[2] ?? "",
      });
    }
  }

  return results;
}

/**
 * Parse `show ip dhcp-reservations` table output (non-CSV).
 *
 * Fallback parser for the table format with space-delimited columns.
 */
export function parseDhcpReservationsTable(raw: string): DhcpReservation[] {
  const lines = raw.split("\n").map((l) => l.trim()).filter(Boolean);
  const results: DhcpReservation[] = [];

  let dataStarted = false;
  for (const line of lines) {
    if (!dataStarted) {
      if (/mac|address/i.test(line) && /ip|address/i.test(line)) {
        dataStarted = true;
        continue;
      }
      if (/^-{3,}/.test(line)) {
        dataStarted = true;
        continue;
      }
      continue;
    }

    if (/^-{3,}/.test(line)) continue;

    const parts = line.split(/\s+/);
    if (parts.length < 2) continue;

    const [first, second, ...rest] = parts;
    if (!first || !second) continue;

    let mac = "", ip = "";
    if (MAC_RE.test(first)) {
      mac = first;
      ip = second;
    } else if (IP_RE.test(first)) {
      ip = first;
      mac = second;
    } else {
      continue;
    }

    results.push({
      mac,
      ip,
      hostname: rest[0] ?? "",
      interface: rest[1] ?? "",
      status: rest.slice(2).join(" "),
    });
  }

  return results;
}
