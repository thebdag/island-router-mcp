/**
 * parsers/system.ts — Parse system-level CLI output:
 *   - `show version`
 *   - `ping <target>`
 *   - `show speedtest`
 */

// ─── Version ─────────────────────────────────────────────────────────────────

export interface VersionInfo {
  firmware: string;
  model: string;
  serialNumber: string;
  uptime: string;
  buildDate: string;
  hostname: string;
  raw: string;
}

/**
 * Parse `show version` output.
 *
 * Expected format varies, but typically includes lines like:
 *   Island Router firmware version 2.3.2
 *   Model: IX2400
 *   Serial number: ISL12345678
 *   Uptime: 14 days, 3 hours, 22 minutes
 *   Build date: 2026-01-15
 *   Hostname: Router
 */
export function parseVersion(raw: string): VersionInfo {
  const info: VersionInfo = {
    firmware: "",
    model: "",
    serialNumber: "",
    uptime: "",
    buildDate: "",
    hostname: "",
    raw,
  };

  const lines = raw.split("\n").map((l) => l.trim()).filter(Boolean);

  for (const line of lines) {
    // Firmware version
    const fwMatch = /(?:firmware|software|version)[:\s]+(.+)/i.exec(line);
    if (fwMatch && !info.firmware) {
      info.firmware = fwMatch[1]?.trim() ?? "";
    }

    // Model
    const modelMatch = /^(?:model|hardware|platform)[:\s]+(.+)/i.exec(line);
    if (modelMatch) {
      info.model = modelMatch[1]?.trim() ?? "";
    }

    // Serial number
    const serialMatch = /serial\s*(?:number|no\.?|#)?[:\s]+(\S+)/i.exec(line);
    if (serialMatch) {
      info.serialNumber = serialMatch[1] ?? "";
    }

    // Uptime
    const uptimeMatch = /uptime[:\s]+(.+)/i.exec(line);
    if (uptimeMatch) {
      info.uptime = uptimeMatch[1]?.trim() ?? "";
    }

    // Build date
    const buildMatch = /(?:build|compile)\s*(?:date|time)?[:\s]+(.+)/i.exec(line);
    if (buildMatch) {
      info.buildDate = buildMatch[1]?.trim() ?? "";
    }

    // Hostname
    const hostMatch = /^(?:hostname|host\s*name|system\s*name)[:\s]+(\S+)/i.exec(line);
    if (hostMatch) {
      info.hostname = hostMatch[1] ?? "";
    }
  }

  return info;
}

// ─── Ping ────────────────────────────────────────────────────────────────────

export interface PingResult {
  target: string;
  sent: number;
  received: number;
  lost: number;
  lossPercent: number;
  rttMin: number | null;
  rttAvg: number | null;
  rttMax: number | null;
  ttl: number | null;
  raw: string;
}

/**
 * Parse ICMP ping output.
 *
 * Expected format:
 *   PING 8.8.8.8 (8.8.8.8): 56 data bytes
 *   64 bytes from 8.8.8.8: icmp_seq=0 ttl=117 time=3.456 ms
 *   ...
 *   --- 8.8.8.8 ping statistics ---
 *   5 packets transmitted, 5 packets received, 0% packet loss
 *   round-trip min/avg/max = 3.123/3.456/3.789 ms
 */
export function parsePing(raw: string): PingResult {
  const result: PingResult = {
    target: "",
    sent: 0,
    received: 0,
    lost: 0,
    lossPercent: 0,
    rttMin: null,
    rttAvg: null,
    rttMax: null,
    ttl: null,
    raw,
  };

  const lines = raw.split("\n").map((l) => l.trim()).filter(Boolean);

  for (const line of lines) {
    // Target from first PING line
    const pingMatch = /^PING\s+(\S+)/i.exec(line);
    if (pingMatch) {
      result.target = pingMatch[1] ?? "";
    }

    // TTL from response lines
    if (result.ttl === null) {
      const ttlMatch = /ttl[=:](\d+)/i.exec(line);
      if (ttlMatch) {
        result.ttl = Number.parseInt(ttlMatch[1] ?? "0", 10);
      }
    }

    // Stats line: "5 packets transmitted, 5 packets received, 0% packet loss"
    const statsMatch = /(\d+)\s+(?:packets?\s+)?(?:transmitted|sent)[,\s]+(\d+)\s+(?:packets?\s+)?received[,\s]+(\d+(?:\.\d+)?)\s*%\s*(?:packet\s+)?loss/i.exec(line);
    if (statsMatch) {
      result.sent = Number.parseInt(statsMatch[1] ?? "0", 10);
      result.received = Number.parseInt(statsMatch[2] ?? "0", 10);
      result.lossPercent = Number.parseFloat(statsMatch[3] ?? "0");
      result.lost = result.sent - result.received;
    }

    // RTT line: "round-trip min/avg/max = 3.123/3.456/3.789 ms"
    const rttMatch = /(?:round-trip|rtt)\s+\S+\s*=\s*([0-9.]+)\/([0-9.]+)\/([0-9.]+)/i.exec(line);
    if (rttMatch) {
      result.rttMin = Number.parseFloat(rttMatch[1] ?? "0");
      result.rttAvg = Number.parseFloat(rttMatch[2] ?? "0");
      result.rttMax = Number.parseFloat(rttMatch[3] ?? "0");
    }
  }

  return result;
}

// ─── Speed Test ──────────────────────────────────────────────────────────────

export interface SpeedtestEntry {
  timestamp: string;
  download: number | null;    // Mbps
  upload: number | null;      // Mbps
  latency: number | null;     // ms
  server: string;
  interface: string;
  comment: string;
}

/**
 * Parse `show speedtest` output.
 *
 * Expected format varies — could be table or key-value for each test run:
 *
 * Table format:
 *   Date/Time            Download   Upload   Latency  Server          Interface
 *   2026/04/01 15:23:01  94.5 Mbps  11.2 Mbps  3.2ms  speedtest.net  ethernet1
 *
 * Key-value format:
 *   Download: 94.5 Mbps
 *   Upload: 11.2 Mbps
 *   Latency: 3.2 ms
 */
export function parseSpeedtest(raw: string): SpeedtestEntry[] {
  const lines = raw.split("\n").map((l) => l.trim()).filter(Boolean);
  const results: SpeedtestEntry[] = [];

  // Detect table vs key-value format
  const isTable = lines.some((l) => /download\s+upload/i.test(l) || /date.*time.*download/i.test(l));

  if (isTable) {
    let dataStarted = false;
    for (const line of lines) {
      if (!dataStarted) {
        if (/download|upload/i.test(line) && /date|time|latency/i.test(line)) {
          dataStarted = true;
          continue;
        }
        if (/^[-=]{3,}/.test(line)) {
          dataStarted = true;
          continue;
        }
        continue;
      }

      if (/^[-=]{3,}/.test(line)) continue;

      // Extract numeric values from the line
      const entry = parseSpeedtestLine(line);
      if (entry) results.push(entry);
    }
  } else {
    // Key-value format — accumulate into entries
    let current: Partial<SpeedtestEntry> = {};

    for (const line of lines) {
      const dlMatch = /download[:\s]+([0-9.]+)\s*(?:mbps|mb\/s|mbit)/i.exec(line);
      if (dlMatch) {
        current.download = Number.parseFloat(dlMatch[1] ?? "0");
        continue;
      }

      const ulMatch = /upload[:\s]+([0-9.]+)\s*(?:mbps|mb\/s|mbit)/i.exec(line);
      if (ulMatch) {
        current.upload = Number.parseFloat(ulMatch[1] ?? "0");
        continue;
      }

      const latMatch = /latency[:\s]+([0-9.]+)\s*(?:ms)?/i.exec(line);
      if (latMatch) {
        current.latency = Number.parseFloat(latMatch[1] ?? "0");
        continue;
      }

      const dateMatch = /^(\d{4}[/-]\d{2}[/-]\d{2}\s+\d{2}:\d{2}(?::\d{2})?)/.exec(line);
      if (dateMatch) {
        // New entry starting with a date — push previous if non-empty
        if (current.download !== undefined || current.upload !== undefined) {
          results.push(finalizeSpeedtest(current));
        }
        current = { timestamp: dateMatch[1] ?? "" };
        continue;
      }

      const serverMatch = /server[:\s]+(.+)/i.exec(line);
      if (serverMatch) {
        current.server = serverMatch[1]?.trim() ?? "";
      }

      const commentMatch = /comment[:\s]+(.+)/i.exec(line);
      if (commentMatch) {
        current.comment = commentMatch[1]?.trim() ?? "";
      }
    }

    // Push last accumulated entry
    if (current.download !== undefined || current.upload !== undefined) {
      results.push(finalizeSpeedtest(current));
    }
  }

  return results;
}

/** Try to parse a table-format speedtest line. */
function parseSpeedtestLine(line: string): SpeedtestEntry | null {
  // Look for a date/time prefix
  const dateMatch = /^(\d{4}[/-]\d{2}[/-]\d{2}\s+\d{2}:\d{2}(?::\d{2})?)/.exec(line);
  if (!dateMatch) return null;

  const timestamp = dateMatch[1] ?? "";
  const rest = line.slice(timestamp.length);

  // Extract numbers — likely download, upload, latency
  const numbers = rest.match(/[0-9.]+/g);
  if (!numbers || numbers.length < 2) return null;

  return {
    timestamp,
    download: Number.parseFloat(numbers[0] ?? "0"),
    upload: Number.parseFloat(numbers[1] ?? "0"),
    latency: numbers[2] ? Number.parseFloat(numbers[2]) : null,
    server: "",
    interface: "",
    comment: "",
  };
}

/** Finalize a partial speedtest entry with defaults. */
function finalizeSpeedtest(partial: Partial<SpeedtestEntry>): SpeedtestEntry {
  return {
    timestamp: partial.timestamp ?? "",
    download: partial.download ?? null,
    upload: partial.upload ?? null,
    latency: partial.latency ?? null,
    server: partial.server ?? "",
    interface: partial.interface ?? "",
    comment: partial.comment ?? "",
  };
}
