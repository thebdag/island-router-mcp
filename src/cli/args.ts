/**
 * Minimal flag parser for island-axi commands.
 * Supports `--flag value`, `--flag=value`, and boolean `--flag`.
 */

import { AxiError } from "axi-sdk-js";

export interface ParsedArgs {
  positionals: string[];
  flags: Record<string, string | boolean>;
}

const BOOLEAN_FLAGS = new Set([
  "detail",
  "full",
  "confirm",
  "json",
]);

export function parseFlags(args: string[]): ParsedArgs {
  const positionals: string[] = [];
  const flags: Record<string, string | boolean> = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;

    if (arg === "--") {
      positionals.push(...args.slice(i + 1));
      break;
    }

    if (!arg.startsWith("--")) {
      positionals.push(arg);
      continue;
    }

    const eq = arg.indexOf("=");
    if (eq !== -1) {
      const key = arg.slice(2, eq);
      flags[key] = arg.slice(eq + 1);
      continue;
    }

    const key = arg.slice(2);
    if (BOOLEAN_FLAGS.has(key)) {
      flags[key] = true;
      continue;
    }

    const next = args[i + 1];
    if (next !== undefined && !next.startsWith("--")) {
      flags[key] = next;
      i++;
    } else {
      flags[key] = true;
    }
  }

  return { positionals, flags };
}

export function flagString(
  flags: Record<string, string | boolean>,
  name: string,
): string | undefined {
  const value = flags[name];
  if (typeof value === "string") return value;
  return undefined;
}

export function flagBool(
  flags: Record<string, string | boolean>,
  name: string,
): boolean {
  return flags[name] === true || flags[name] === "true";
}

export function parseLimit(
  value: string | boolean | undefined,
  defaultLimit: number,
  maxLimit: number,
): number {
  if (value === undefined || value === true) return defaultLimit;
  const n = Number.parseInt(String(value), 10);
  if (!Number.isFinite(n) || n < 1) return defaultLimit;
  return Math.min(n, maxLimit);
}

/** Reject unknown flags; `--help` is always allowed by the SDK before dispatch. */
export function assertKnownFlags(
  flags: Record<string, string | boolean>,
  known: string[],
  command: string,
): void {
  const allowed = new Set(known);
  const unknown = Object.keys(flags).filter((k) => !allowed.has(k));
  if (unknown.length === 0) return;

  const first = unknown[0]!;
  const flagList = known.map((k) => `--${k}`).join(", ");
  throw new AxiError(
    `unknown flag --${first} for \`${command}\``,
    "VALIDATION_ERROR",
    [
      `valid flags for \`${command}\`: ${flagList} (--help always allowed)`,
    ],
  );
}
