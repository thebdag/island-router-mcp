/**
 * parsers/ntp.ts — Parse `show ntp`, `show ntp status`, and `show ntp associations`.
 */

export interface NtpConfig {
  servers: string[];
  enabled: boolean;
}

export interface NtpStatus {
  synchronized: boolean;
  stratum: number | null;
  refId: string;
  offset: number | null;
  jitter: number | null;
  rootDelay: number | null;
  precision: string;
  pollInterval: string;
}

export interface NtpAssociation {
  remote: string;
  refid: string;
  stratum: number | null;
  type: string;
  when: string;
  poll: string;
  reach: string;
  delay: number | null;
  offset: number | null;
  jitter: number | null;
  tally: string;  // *, +, -, etc.
}

const SEPARATOR_RE = /^[=-]{3,}/;

/** Add a server address to the config if it is a real value. */
function addServer(config: NtpConfig, server: string): void {
  const cleaned = server.replace(",", "");
  if (cleaned === "none" || cleaned === "not" || cleaned === "configured") return;
  if (config.servers.includes(cleaned)) return;
  config.servers.push(cleaned);
  config.enabled = true;
}

/**
 * Parse `show ntp` output — NTP server configuration.
 *
 * Expected format (key-value or list):
 *   ntp server 0.pool.ntp.org
 *   ntp server 1.pool.ntp.org
 * or:
 *   NTP server: 0.pool.ntp.org
 */
export function parseNtpConfig(raw: string): NtpConfig {
  const config: NtpConfig = {
    servers: [],
    enabled: false,
  };

  const lines = raw.split("\n").map((l) => l.trim()).filter(Boolean);

  for (const line of lines) {
    // Match "ntp server <address>" or "NTP server: <address>"
    const serverMatch = /(?:ntp\s+)?server[:\s]+(\S+)/i.exec(line);
    if (serverMatch?.[1]) {
      addServer(config, serverMatch[1]);
    }

    // Also match bare addresses on "server" lines
    const bareMatch = /^server\s+(\S+)/i.exec(line);
    if (bareMatch?.[1]) {
      addServer(config, bareMatch[1]);
    }
  }

  return config;
}

/** Apply a single regex capture as an integer field on status. */
function applyIntField(status: NtpStatus, line: string, re: RegExp, key: "stratum"): void {
  const m = re.exec(line);
  if (m) status[key] = Number.parseInt(m[1] ?? "0", 10);
}

/** Apply a single regex capture as a float field on status. */
function applyFloatField(
  status: NtpStatus,
  line: string,
  re: RegExp,
  key: "offset" | "jitter" | "rootDelay",
): void {
  const m = re.exec(line);
  if (m) status[key] = Number.parseFloat(m[1] ?? "0");
}

/** Apply a single regex capture as a string field on status. */
function applyStringField(
  status: NtpStatus,
  line: string,
  re: RegExp,
  key: "refId" | "precision" | "pollInterval",
): void {
  const m = re.exec(line);
  if (m) status[key] = (m[1] ?? "").trim();
}

/** Update synchronization flags from a status line. */
function applySyncLine(status: NtpStatus, line: string): void {
  if (/synch?ronized|sync\s+status/i.test(line)) {
    status.synchronized = /yes|true|synch?ronized/i.test(line) && !/not\s+synch?ronized|unsync/i.test(line);
  }
}

/** Infer synchronized from a valid stratum value. */
function inferSyncFromStratum(status: NtpStatus): void {
  if (status.stratum !== null && status.stratum > 0 && status.stratum < 16) {
    status.synchronized = true;
  }
}

/**
 * Parse `show ntp status` output.
 *
 * Expected format (ntpd/chronyc style):
 *   Reference ID    : 85.199.214.101 (ntp1.example.com)
 *   Stratum         : 2
 *   Root delay      : 0.012345 seconds
 *   Offset          : +0.000123 seconds
 *   ...
 * or:
 *   system peer:        ntp1.example.com
 *   system peer mode:   client
 *   leap indicator:     00 (no warning)
 *   stratum:            2
 *   precision:          -23
 *   ...
 */
export function parseNtpStatus(raw: string): NtpStatus {
  const status: NtpStatus = {
    synchronized: false,
    stratum: null,
    refId: "",
    offset: null,
    jitter: null,
    rootDelay: null,
    precision: "",
    pollInterval: "",
  };

  for (const line of raw.split("\n").map((l) => l.trim()).filter(Boolean)) {
    applySyncLine(status, line);
    applyIntField(status, line, /stratum[:\s]+(\d+)/i, "stratum");
    applyStringField(status, line, /ref(?:erence)?\s*id[:\s]+(\S+)/i, "refId");
    applyFloatField(status, line, /offset[:\s]+([+-]?[0-9.]+)/i, "offset");
    applyFloatField(status, line, /jitter[:\s]+([0-9.]+)/i, "jitter");
    applyFloatField(status, line, /root\s+delay[:\s]+([0-9.]+)/i, "rootDelay");
    applyStringField(status, line, /precision[:\s]+(\S+)/i, "precision");
    applyStringField(status, line, /poll\s+interval[:\s]+(.+)/i, "pollInterval");
    inferSyncFromStratum(status);
  }

  return status;
}

/** Parse a single ntpq-style association/peer line. */
function parseAssociationLine(line: string): NtpAssociation | null {
  if (SEPARATOR_RE.test(line)) return null;

  let tally = "";
  let rest = line;
  if (/^[*+\-#ox. ]/.test(line) && !/^\d/.test(line)) {
    tally = line[0] ?? "";
    rest = line.slice(1).trim();
  }

  const parts = rest.split(/\s+/);
  if (parts.length < 8) return null;

  return {
    remote: parts[0] ?? "",
    refid: parts[1] ?? "",
    stratum: parts[2] ? Number.parseInt(parts[2], 10) : null,
    type: parts[3] ?? "",
    when: parts[4] ?? "",
    poll: parts[5] ?? "",
    reach: parts[6] ?? "",
    delay: parts[7] ? Number.parseFloat(parts[7]) : null,
    offset: parts[8] ? Number.parseFloat(parts[8]) : null,
    jitter: parts[9] ? Number.parseFloat(parts[9]) : null,
    tally,
  };
}

/**
 * Parse `show ntp associations` output.
 *
 * Expected format (ntpq-style peers table):
 *      remote           refid      st t when poll reach   delay   offset  jitter
 *   ==============================================================================
 *   *ntp1.example.com   .GPS.      1 u   36   64  377    1.234   +0.567   0.123
 *   +ntp2.example.com   85.199.1.  2 u   42   64  377    2.345   -0.123   0.456
 */
export function parseNtpAssociations(raw: string): NtpAssociation[] {
  const lines = raw.split("\n").map((l) => l.trim()).filter(Boolean);
  const results: NtpAssociation[] = [];

  let dataStarted = false;
  for (const line of lines) {
    if (!dataStarted) {
      if (SEPARATOR_RE.test(line) || /remote\s+refid/i.test(line)) {
        dataStarted = true;
      }
      continue;
    }

    const assoc = parseAssociationLine(line);
    if (assoc) results.push(assoc);
  }

  return results;
}
