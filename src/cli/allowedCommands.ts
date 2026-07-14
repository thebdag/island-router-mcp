/**
 * Allowlisted show commands — shared with MCP server semantics.
 */

export const ALLOWED_SHOW_COMMANDS = [
  "show version", "show version history", "show hardware", "show clock",
  "show users", "show free-space", "show public-key",
  "show running-config", "show running-config differences",
  "show startup-config",
  "show history", "show dumps", "show log", "show syslog",
  "show interface", "show interface summary",
  "show interface transceivers", "show interface transceivers diagnostics",
  "show ip interface", "show ip routes", "show ip neighbors",
  "show ip sockets", "show ip dhcp-reservations",
  "show ip recommendations",
  "show vpns", "show ntp", "show ntp associations", "show ntp status",
  "show packages", "show packages detail",
  "show stats",
  "show config authorized-keys", "show config known-hosts",
  "show config email",
  "show ssh-client-keys", "show ssh-client-keys detail",
  "show speedtest",
] as const;

export function isCommandAllowed(cmd: string): boolean {
  const n = cmd.trim().toLowerCase();
  const withShow = n.startsWith("show ") ? n : `show ${n}`;
  return ALLOWED_SHOW_COMMANDS.some(
    (a) => withShow === a.toLowerCase() || withShow.startsWith(a.toLowerCase() + " "),
  );
}

export function normalizeShowCommand(cmd: string): string {
  const trimmed = cmd.trim();
  return trimmed.toLowerCase().startsWith("show ") ? trimmed : `show ${trimmed}`;
}
