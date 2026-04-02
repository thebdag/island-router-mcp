/**
 * parsers/logs.ts — Parse `show log` and `show syslog` output.
 */

export interface LogEntry {
  timestamp: string;
  severity: string;
  facility: string;
  message: string;
}

export interface SyslogConfig {
  server: string | null;
  port: number | null;
  level: string | null;
  protocol: string | null;
  enabled: boolean;
}

// Pre-compiled regexes for log parsing
const SYSLOG_RE = /^(\w{3}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2})\s+\S+\s+(\w+)\s+([^:\s]+):\s*(.*)$/;
const BRACKET_RE = /^(?:([^\[\]\s]+\s+[^\[\]\s]+)\s+)?\[(\w+)]\s*(.*)$/;
const SERVER_RE = /(?:syslog\s+)?server[:\s]+(\S+)/;
const PORT_RE = /port[:\s]+(\d+)/;
const LEVEL_RE = /level[:\s]+(\w+)/;
const PROTO_RE = /protocol[:\s]+(\w+)/;

/**
 * Parse `show log` output into structured log entries.
 *
 * Output format varies, but typically:
 *   Apr  1 14:23:01 Router info kernel: ...
 *   or lines with severity in brackets: [info] message
 */
export function parseLogEntries(raw: string): LogEntry[] {
  const lines = raw.split("\n").filter((l) => l.trim());
  const results: LogEntry[] = [];

  for (const line of lines) {
    // Try standard syslog format: Month Day HH:MM:SS hostname severity facility: message
    const syslogMatch = SYSLOG_RE.exec(line);
    if (syslogMatch) {
      results.push({
        timestamp: (syslogMatch[1] ?? "").trim(),
        severity: syslogMatch[2] ?? "",
        facility: syslogMatch[3] ?? "",
        message: syslogMatch[4] ?? "",
      });
      continue;
    }

    // Fallback: try bracketed severity: [info] message
    const bracketMatch = BRACKET_RE.exec(line);
    if (bracketMatch) {
      results.push({
        timestamp: bracketMatch[1]?.trim() ?? "",
        severity: bracketMatch[2] ?? "",
        facility: "",
        message: bracketMatch[3] ?? "",
      });
      continue;
    }

    // Last resort: treat the whole line as a message
    if (line.trim() && !line.startsWith("---")) {
      results.push({
        timestamp: "",
        severity: "unknown",
        facility: "",
        message: line.trim(),
      });
    }
  }

  return results;
}

/**
 * Parse `show syslog` configuration output.
 *
 * Expected format (key-value lines):
 *   Syslog server: 192.168.2.50
 *   Port: 514
 *   Level: info
 *   Protocol: udp
 */
export function parseSyslogConfig(raw: string): SyslogConfig {
  const config: SyslogConfig = {
    server: null,
    port: null,
    level: null,
    protocol: null,
    enabled: false,
  };

  const lines = raw.split("\n");
  for (const line of lines) {
    const lower = line.toLowerCase();

    const serverMatch = SERVER_RE.exec(lower);
    if (serverMatch && serverMatch[1] !== "none" && serverMatch[1] !== "not") {
      config.server = serverMatch[1] ?? null;
      config.enabled = true;
    }

    const portMatch = PORT_RE.exec(lower);
    if (portMatch) config.port = Number.parseInt(portMatch[1] ?? "0", 10);

    const levelMatch = LEVEL_RE.exec(lower);
    if (levelMatch) config.level = levelMatch[1] ?? null;

    const protoMatch = PROTO_RE.exec(lower);
    if (protoMatch) config.protocol = protoMatch[1] ?? null;
  }

  return config;
}
