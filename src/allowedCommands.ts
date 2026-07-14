#!/usr/bin/env node
/**
 * Shared allowlist for read-only show commands (MCP `command` action + island-axi `show`).
 * Keep MCP and AXI surfaces in sync — edit this file only.
 */

export const ALLOWED_SHOW_COMMANDS = [
  // System
  "show version", "show version history", "show hardware", "show clock",
  "show users", "show free-space", "show public-key",
  // Configuration
  "show running-config", "show running-config differences",
  "show startup-config",
  // Event history & logs
  "show history", "show dumps", "show log", "show syslog",
  // Interfaces
  "show interface", "show interface summary",
  "show interface transceivers", "show interface transceivers diagnostics",
  // IP & networking
  "show ip interface", "show ip routes", "show ip neighbors",
  "show ip sockets", "show ip dhcp-reservations",
  "show ip recommendations",
  // VPN / NTP
  "show vpns", "show ntp", "show ntp associations", "show ntp status",
  // Packages
  "show packages", "show packages detail",
  // Stats
  "show stats",
  // SSH & security
  "show config authorized-keys", "show config known-hosts",
  "show config email",
  "show ssh-client-keys", "show ssh-client-keys detail",
  // Speed test
  "show speedtest",
] as const;

export function isCommandAllowed(cmd: string): boolean {
  const n = cmd.trim().toLowerCase();
  const withShow = n.startsWith("show ") ? n : `show ${n}`;
  return ALLOWED_SHOW_COMMANDS.some(
    (a) => withShow === a.toLowerCase() || withShow.startsWith(`${a.toLowerCase()} `),
  );
}

export function normalizeShowCommand(cmd: string): string {
  const trimmed = cmd.trim();
  return trimmed.toLowerCase().startsWith("show ") ? trimmed : `show ${trimmed}`;
}
