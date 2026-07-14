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
const MAC_RE = /^[0-9a-fA-F]{2}[:-][0-9a-fA-F]{2}[:-][0-9a-fA-F]{2}[:-][0-9a-fA-F]{2}[:-][0-9a-fA-F]{2}[:-][0-9a-fA-F]{2}$/;
const SEPARATOR_RE = /^-{3,}/;

type HeaderMap = Record<string, number>;

/** Map CSV header column names to field indices. */
function buildHeaderMap(cols: string[]): HeaderMap {
  const headerMap: HeaderMap = {};
  for (let j = 0; j < cols.length; j++) {
    const col = cols[j] ?? "";
    if (col.includes("mac")) headerMap["mac"] = j;
    else if (col.includes("ip") || col.includes("address")) headerMap["ip"] = j;
    else if (col.includes("host") || col.includes("name")) headerMap["hostname"] = j;
    else if (col.includes("interface") || col.includes("iface")) headerMap["interface"] = j;
    else if (col.includes("status") || col.includes("state")) headerMap["status"] = j;
  }
  return headerMap;
}

/** Detect a CSV header row and return its column map + next data index. */
function detectCsvHeader(lines: string[]): { headerMap: HeaderMap; startIdx: number } | null {
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const lower = line.toLowerCase();
    if (!lower.includes("mac") || (!lower.includes("ip") && !lower.includes("address"))) {
      continue;
    }
    const cols = line.split(",").map((c) => c.trim().toLowerCase());
    return { headerMap: buildHeaderMap(cols), startIdx: i + 1 };
  }
  return null;
}

/** Identify MAC/IP when both columns match their expected patterns (CSV heuristic). */
function identifyMacIpStrict(first: string, second: string): { mac: string; ip: string } | null {
  if (MAC_RE.test(first) && IP_RE.test(second)) return { mac: first, ip: second };
  if (IP_RE.test(first) && MAC_RE.test(second)) return { mac: second, ip: first };
  return null;
}

/** Identify MAC/IP from the first column's type (table format). */
function identifyMacIpLoose(first: string, second: string): { mac: string; ip: string } | null {
  if (MAC_RE.test(first)) return { mac: first, ip: second };
  if (IP_RE.test(first)) return { mac: second, ip: first };
  return null;
}

/** Parse one CSV data row using a header map. */
function parseMappedCsvRow(parts: string[], headerMap: HeaderMap): DhcpReservation | null {
  const mac = parts[headerMap["mac"] ?? 0] ?? "";
  const ip = parts[headerMap["ip"] ?? 1] ?? "";
  if (!mac || !ip) return null;
  return {
    mac,
    ip,
    hostname: parts[headerMap["hostname"] ?? 2] ?? "",
    interface: parts[headerMap["interface"] ?? 3] ?? "",
    status: parts[headerMap["status"] ?? 4] ?? "",
  };
}

/** Parse one CSV data row without a header (heuristic column order). */
function parseHeuristicCsvRow(parts: string[]): DhcpReservation | null {
  const [first, second, ...rest] = parts;
  if (!first || !second) return null;
  const ids = identifyMacIpStrict(first, second);
  if (!ids) return null;
  return {
    mac: ids.mac,
    ip: ids.ip,
    hostname: rest[0] ?? "",
    interface: rest[1] ?? "",
    status: rest[2] ?? "",
  };
}

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

  const detected = detectCsvHeader(lines);
  const headerMap = detected?.headerMap ?? null;
  const startIdx = detected?.startIdx ?? 0;

  for (let i = startIdx; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (line.startsWith("---") || line.startsWith("Router") || line.startsWith("show ")) continue;

    const parts = line.split(",").map((p) => p.trim());
    if (parts.length < 2) continue;

    const row = headerMap ? parseMappedCsvRow(parts, headerMap) : parseHeuristicCsvRow(parts);
    if (row) results.push(row);
  }

  return results;
}

/** Skip preamble until a table header or separator is found. */
function isTableDataStart(line: string): boolean {
  return (/mac|address/i.test(line) && /ip|address/i.test(line)) || SEPARATOR_RE.test(line);
}

/** Parse one space-delimited table row into a reservation. */
function parseTableRow(line: string): DhcpReservation | null {
  if (SEPARATOR_RE.test(line)) return null;

  const parts = line.split(/\s+/);
  if (parts.length < 2) return null;

  const [first, second, ...rest] = parts;
  if (!first || !second) return null;

  const ids = identifyMacIpLoose(first, second);
  if (!ids) return null;

  return {
    mac: ids.mac,
    ip: ids.ip,
    hostname: rest[0] ?? "",
    interface: rest[1] ?? "",
    status: rest.slice(2).join(" "),
  };
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
      if (isTableDataStart(line)) dataStarted = true;
      continue;
    }

    const row = parseTableRow(line);
    if (row) results.push(row);
  }

  return results;
}
