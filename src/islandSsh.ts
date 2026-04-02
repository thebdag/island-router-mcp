/**
 * islandSsh.ts — Interactive shell SSH client for the Island Router CLI.
 *
 * The Island Router uses a stateful Cisco-style CLI that requires an interactive
 * shell session (ssh2 `shell()`) — NOT `exec()` — to maintain context across
 * commands like `configure terminal` → config commands → `end`.
 *
 * This module mirrors the proven approach from the Python paramiko client
 * (`island_router.py`) but implemented in TypeScript with the ssh2 library.
 */

import { Client, type ClientChannel, type ConnectConfig } from "ssh2";
import fs from "node:fs";

// ─── Device configuration ────────────────────────────────────────────────────

export interface DeviceConfig {
  id: string;
  host: string;
  port: number;
  username: string;
  /** "password" or "key" — determines auth method */
  authMethod: "password" | "key";
  /** Path to private key file (when authMethod is "key") */
  privateKeyPath?: string;
  /** Description for display — never sent to the router */
  description?: string;
}

// ─── Prompt & pager constants ────────────────────────────────────────────────

const PROMPT_SUFFIXES = ["# ", "> ", "$ "] as const;

/** Regex that matches a CLI prompt at the end of buffered output */
const PROMPT_RE = /(?:Router(?:\([^)]*\))?[#>$])\s*$/;

/** Pager strings the router emits mid-output — we auto-dismiss with a space */
const PAGER_PROMPTS = [
  "(press RETURN)",
  "--More--",
  "--- more ---",
  "Press any key",
] as const;

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ShellSession {
  conn: Client;
  channel: ClientChannel;
}

export interface CommandResult {
  output: string;
  raw: string;
}

// ─── Connection ──────────────────────────────────────────────────────────────

/**
 * Open an interactive shell session to the Island Router.
 *
 * Automatically:
 *  - Connects via password or SSH key
 *  - Opens a wide interactive shell (220×50)
 *  - Waits for the initial banner/prompt
 *  - Sends `terminal length 0` to disable paging
 */
export async function openSession(
  device: DeviceConfig,
  password?: string,
  timeoutMs = 15_000,
): Promise<ShellSession> {
  const conn = new Client();

  const connectConfig: ConnectConfig = {
    host: device.host,
    port: device.port,
    username: device.username,
    readyTimeout: timeoutMs,
    // Don't reject unknown host keys for router devices
    hostVerifier: (_hashedKey: string) => true,
  };

  if (device.authMethod === "key") {
    const envKey = process.env["ROUTER_KEY"];
    if (envKey) {
      connectConfig.privateKey = envKey;
    } else if (device.privateKeyPath) {
      connectConfig.privateKey = fs.readFileSync(device.privateKeyPath);
    } else {
      throw new Error(
        `authMethod is 'key' for device '${device.id}', but neither ROUTER_KEY env var nor privateKeyPath is set`,
      );
    }
  } else if (password) {
    connectConfig.password = password;
  } else {
    const envPass = process.env["ROUTER_PASS"];
    if (!envPass) {
      throw new Error(
        `No password provided for device '${device.id}' and ROUTER_PASS env var is not set`,
      );
    }
    connectConfig.password = envPass;
  }

  return new Promise<ShellSession>((resolve, reject) => {
    const timer = setTimeout(() => {
      conn.end();
      reject(new Error(`SSH connection to ${device.host} timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    conn.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });

    conn.on("ready", () => {
      // Request an interactive shell with a wide terminal
      conn.shell({ rows: 50, cols: 220, term: "vt100" }, async (err, channel) => {
        if (err) {
          clearTimeout(timer);
          conn.end();
          return reject(err);
        }

        const session: ShellSession = { conn, channel };

        try {
          // Wait for the initial banner/MOTD and first prompt
          await drain(channel, 2000);

          // Disable pager so all output streams without --More-- prompts
          await runCommand(session, "terminal length 0", 1000);

          clearTimeout(timer);
          resolve(session);
        } catch (initErr) {
          clearTimeout(timer);
          conn.end();
          reject(initErr);
        }
      });
    });

    conn.connect(connectConfig);
  });
}

/**
 * Close the SSH session cleanly.
 */
export function closeSession(session: ShellSession): void {
  try {
    session.channel.end();
  } catch {
    // ignore
  }
  try {
    session.conn.end();
  } catch {
    // ignore
  }
}

// ─── I/O helpers ─────────────────────────────────────────────────────────────

/**
 * Read all pending data from the shell channel until silence.
 * Returns the accumulated buffer as a string.
 */
function drain(channel: ClientChannel, waitMs = 500): Promise<string> {
  return new Promise((resolve) => {
    let buf = "";
    let timer: ReturnType<typeof setTimeout>;

    const resetTimer = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        channel.removeListener("data", onData);
        resolve(buf);
      }, waitMs);
    };

    const onData = (data: Buffer) => {
      buf += data.toString("utf8");
      resetTimer();
    };

    channel.on("data", onData);
    resetTimer();
  });
}

/**
 * Check if output ends with a CLI prompt (Router#, Router(config)#, etc.)
 */
function endsWithPrompt(text: string): boolean {
  const trimmed = text.trimEnd();
  return PROMPT_RE.test(trimmed) ||
    PROMPT_SUFFIXES.some((s) => trimmed.endsWith(s));
}

/**
 * Check if output contains any pager prompt that needs dismissing.
 */
function containsPager(text: string): boolean {
  const lower = text.toLowerCase();
  return PAGER_PROMPTS.some((p) => lower.includes(p.toLowerCase()));
}

// ─── Command execution ──────────────────────────────────────────────────────

/**
 * Send a single command to the Island Router CLI and return its output.
 *
 * Automatically dismisses pager prompts (--More--, press RETURN, etc.)
 * so multi-page output is fully captured.
 *
 * @param session  Active shell session
 * @param cmd      CLI command string (no trailing newline)
 * @param waitMs   Milliseconds to wait for output after each read
 * @param maxPages Maximum pager pages to auto-advance (safety limit)
 */
export async function runCommand(
  session: ShellSession,
  cmd: string,
  waitMs = 1500,
  maxPages = 30,
): Promise<string> {
  const { channel } = session;

  // Send the command
  channel.write(cmd + "\n");

  let allOutput = "";

  for (let page = 0; page < maxPages; page++) {
    const chunk = await drain(channel, waitMs);
    allOutput += chunk;

    // If we see a pager prompt, dismiss it with a space
    if (containsPager(chunk)) {
      channel.write(" ");
      await new Promise((r) => setTimeout(r, 300));
      continue;
    }

    // If we've landed on a CLI prompt, we're done
    if (endsWithPrompt(allOutput)) {
      break;
    }

    // No pager and no prompt yet — wait a bit more
    if (chunk.length === 0) {
      break; // silence — assume done
    }
  }

  return stripCommandEcho(allOutput, cmd);
}

/**
 * Run multiple commands sequentially and return results keyed by command.
 */
export async function runCommands(
  session: ShellSession,
  commands: Array<{ cmd: string; waitMs?: number }>,
): Promise<Record<string, string>> {
  const results: Record<string, string> = {};
  for (const { cmd, waitMs } of commands) {
    results[cmd] = await runCommand(session, cmd, waitMs);
  }
  return results;
}

// ─── Output cleaning ─────────────────────────────────────────────────────────

/**
 * Strip the echoed command line and trailing prompt from raw output.
 */
function stripCommandEcho(raw: string, cmd: string): string {
  const lines = raw.split("\n");
  const filtered: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();

    // Skip echoed command
    if (trimmed === cmd.trim()) continue;

    // Skip prompt-only lines
    if (PROMPT_RE.test(trimmed) && trimmed.length < 40) continue;

    // Skip pager artifacts
    if (PAGER_PROMPTS.some((p) => trimmed.toLowerCase().includes(p.toLowerCase()))) continue;

    filtered.push(line);
  }

  return filtered.join("\n").trim();
}

// ─── Convenience: one-shot command ───────────────────────────────────────────

/**
 * Connect, run a single command, disconnect. Good for quick one-off queries.
 */
export async function execOneShot(
  device: DeviceConfig,
  cmd: string,
  password?: string,
): Promise<string> {
  const session = await openSession(device, password);
  try {
    return await runCommand(session, cmd);
  } finally {
    closeSession(session);
  }
}
