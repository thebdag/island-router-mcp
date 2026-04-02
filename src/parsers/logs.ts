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
    const syslogMatch = line.match(
      /^(\w{3}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2})\s+\S+\s+(\w+)\s+([^:\s]+):\s*(.*)$/,
    );
    if (syslogMatch) {
      results.push({
        timestamp: syslogMatch[1]!.trim(),
        severity: syslogMatch[2]!,
        facility: syslogMatch[3]!,
        message: syslogMatch[4]!,
      });
      continue;
    }

    // Fallback: try bracketed severity: [info] message
    const bracketMatch = line.match(
      /^(?:([^\[\]\s]+\s+[^\[\]\s]+)\s+)?\[(\w+)\]\s*(.*)$/,
    );
    if (bracketMatch) {
      results.push({
        timestamp: bracketMatch[1]?.trim() ?? "",
        severity: bracketMatch[2]!,
        facility: "",
        message: bracketMatch[3]!,
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

    const serverMatch = lower.match(/(?:syslog\s+)?server[:\s]+(\S+)/);
    if (serverMatch && serverMatch[1] !== "none" && serverMatch[1] !== "not") {
      config.server = serverMatch[1]!;
      config.enabled = true;
    }

    const portMatch = lower.match(/port[:\s]+(\d+)/);
    if (portMatch) config.port = parseInt(portMatch[1]!, 10);

    const levelMatch = lower.match(/level[:\s]+(\w+)/);
    if (levelMatch) config.level = levelMatch[1]!;

    const protoMatch = lower.match(/protocol[:\s]+(\w+)/);
    if (protoMatch) config.protocol = protoMatch[1]!;
  }

  return config;
}
