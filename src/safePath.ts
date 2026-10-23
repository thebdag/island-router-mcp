/**
 * Confine operator-supplied filesystem paths to the working directory or home.
 * Inventory files and SSH private keys must not be able to read arbitrary paths.
 */

import os from "node:os";
import path from "node:path";

export class PathAccessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PathAccessError";
  }
}

/** Resolve `input` and reject paths that escape the cwd or the home directory. */
export function resolveLocalPath(input: string, label: string): string {
  if (input.length === 0 || input.includes("\0")) {
    throw new PathAccessError(`Invalid ${label}`);
  }

  let expanded = input;
  if (input === "~") {
    expanded = os.homedir();
  } else if (input.startsWith("~/")) {
    expanded = path.join(os.homedir(), input.slice(2));
  }
  const resolved = path.resolve(expanded);
  const roots = [process.cwd(), os.homedir()].map((root) => path.resolve(root));
  const allowed = roots.some(
    (root) => resolved === root || resolved.startsWith(root + path.sep),
  );
  if (!allowed) {
    throw new PathAccessError(
      `${label} must be a file inside the working directory or home directory`,
    );
  }
  return resolved;
}
