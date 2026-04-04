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
    if (serverMatch && serverMatch[1]) {
      const server = serverMatch[1].replace(",", "");
      if (server !== "none" && server !== "not" && server !== "configured") {
        config.servers.push(server);
        config.enabled = true;
      }
    }

    // Also match bare addresses on "server" lines
    const bareMatch = /^server\s+(\S+)/i.exec(line);
    if (bareMatch && bareMatch[1] && !config.servers.includes(bareMatch[1])) {
      config.servers.push(bareMatch[1]);
      config.enabled = true;
    }
  }

  return config;
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

  const lines = raw.split("\n").map((l) => l.trim()).filter(Boolean);

  for (const line of lines) {
    const lower = line.toLowerCase();

    // Synchronization status
    if (/synch?ronized|sync\s+status/i.test(line)) {
      status.synchronized = /yes|true|synch?ronized/i.test(line) && !/not\s+synch?ronized|unsync/i.test(line);
    }

    // Stratum
    const stratumMatch = /stratum[:\s]+(\d+)/i.exec(line);
    if (stratumMatch) {
      status.stratum = Number.parseInt(stratumMatch[1] ?? "0", 10);
    }

    // Reference ID
    const refMatch = /ref(?:erence)?\s*id[:\s]+(\S+)/i.exec(line);
    if (refMatch) {
      status.refId = refMatch[1] ?? "";
    }

    // Offset
    const offsetMatch = /offset[:\s]+([+-]?[0-9.]+)/i.exec(line);
    if (offsetMatch) {
      status.offset = Number.parseFloat(offsetMatch[1] ?? "0");
    }

    // Jitter
    const jitterMatch = /jitter[:\s]+([0-9.]+)/i.exec(line);
    if (jitterMatch) {
      status.jitter = Number.parseFloat(jitterMatch[1] ?? "0");
    }

    // Root delay
    const delayMatch = /root\s+delay[:\s]+([0-9.]+)/i.exec(line);
    if (delayMatch) {
      status.rootDelay = Number.parseFloat(delayMatch[1] ?? "0");
    }

    // Precision
    const precMatch = /precision[:\s]+(\S+)/i.exec(line);
    if (precMatch) {
      status.precision = precMatch[1] ?? "";
    }

    // Poll interval
    const pollMatch = /poll\s+interval[:\s]+(.+)/i.exec(line);
    if (pollMatch) {
      status.pollInterval = (pollMatch[1] ?? "").trim();
    }

    // Infer synchronization from stratum (stratum > 0 means synchronized)
    if (status.stratum !== null && status.stratum > 0 && status.stratum < 16) {
      status.synchronized = true;
    }
  }

  return status;
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
      if (/^[=\-]{3,}/.test(line) || /remote\s+refid/i.test(line)) {
        dataStarted = true;
        continue;
      }
      continue;
    }

    if (/^[=\-]{3,}/.test(line)) continue;

    // Parse peer line — first char is tally code (*, +, -, #, space, etc.)
    let tally = "";
    let rest = line;
    if (/^[*+\-#ox. ]/.test(line) && !/^\d/.test(line)) {
      tally = line[0] ?? "";
      rest = line.slice(1).trim();
    }

    const parts = rest.split(/\s+/);
    if (parts.length < 8) continue;

    results.push({
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
    });
  }

  return results;
}
