/** Official Island syslog severity levels (numeric 0–7). */

export const SYSLOG_LEVEL_NAMES: Record<number, string> = {
  0: "critical-system-failure",
  1: "critical-unrecoverable",
  2: "recoverable-error",
  3: "less-severe-error",
  4: "warning",
  5: "informational",
  6: "debug",
  7: "verbose-debug",
};
