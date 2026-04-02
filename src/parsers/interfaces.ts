/**
 * parsers/interfaces.ts — Parse `show interface summary` and `show interface` output
 * into structured JSON objects.
 */

export interface InterfaceSummary {
  name: string;
  status: string;
  protocol: string;
  description: string;
}

export interface InterfaceDetail {
  name: string;
  status: string;
  mtu: number | null;
  macAddress: string | null;
  txBytes: number | null;
  rxBytes: number | null;
  txPackets: number | null;
  rxPackets: number | null;
  txErrors: number | null;
  rxErrors: number | null;
  speed: string | null;
  duplex: string | null;
}

/**
 * Parse `show interface summary` output.
 *
 * Expected format (table with columns):
 *   Interface         Status  Protocol  Description
 *   ethernet1         up      up        WAN
 *   ...
 */
export function parseInterfaceSummary(raw: string): InterfaceSummary[] {
  const lines = raw.split("\n").map((l) => l.trim()).filter(Boolean);
  const results: InterfaceSummary[] = [];

  // Skip until we find the header line
  let dataStarted = false;
  for (const line of lines) {
    if (!dataStarted) {
      if (/^interface\s+status\s+protocol/i.test(line) || /^-{3,}/.test(line)) {
        dataStarted = true;
        continue;
      }
      // Also start capturing if we see the separator line
      if (line.startsWith("---")) {
        dataStarted = true;
        continue;
      }
      continue;
    }

    // Skip separator lines
    if (/^-{3,}/.test(line)) continue;

    // Parse space-delimited columns
    const parts = line.split(/\s+/);
    if (parts.length >= 3) {
      results.push({
        name: parts[0] ?? "",
        status: parts[1] ?? "",
        protocol: parts[2] ?? "",
        description: parts.slice(3).join(" "),
      });
    }
  }

  return results;
}

// Simplified MAC regex: two hex chars separated by a consistent delimiter
const MAC_RE = /([0-9a-fA-F]{2}[:.‑-][0-9a-fA-F]{2}[:.‑-][0-9a-fA-F]{2}[:.‑-][0-9a-fA-F]{2}[:.‑-][0-9a-fA-F]{2}[:.‑-][0-9a-fA-F]{2})/;

/** Extract a numeric stat from the block, returning null if not found. */
function extractStat(block: string, pattern: RegExp): number | null {
  const m = pattern.exec(block);
  return m ? Number.parseInt(m[1] ?? "0", 10) : null;
}

/**
 * Parse `show interface` detailed output.
 *
 * The output is split into per-interface blocks, each starting with a line like:
 *   ethernet1 is up, line protocol is up
 *
 * We extract key metrics from each block.
 */
export function parseInterfaceDetail(raw: string): InterfaceDetail[] {
  const results: InterfaceDetail[] = [];

  // Split on interface header lines
  const blocks = raw.split(/(?=^\S+\s+is\s+)/m).filter((b) => b.trim());

  for (const block of blocks) {
    const lines = block.split("\n");
    const header = lines[0] ?? "";

    // Parse header: "ethernet1 is up, line protocol is up"
    const headerMatch = /^(\S+)\s+is\s+(\S+)/.exec(header);
    if (!headerMatch) continue;

    const detail: InterfaceDetail = {
      name: headerMatch[1] ?? "",
      status: (headerMatch[2] ?? "").replace(",", ""),
      mtu: null,
      macAddress: null,
      txBytes: null,
      rxBytes: null,
      txPackets: null,
      rxPackets: null,
      txErrors: null,
      rxErrors: null,
      speed: null,
      duplex: null,
    };

    const lower = block.toLowerCase();

    detail.mtu = extractStat(lower, /mtu\s+(\d+)/);

    const macMatch = MAC_RE.exec(block);
    if (macMatch) detail.macAddress = macMatch[1] ?? null;

    detail.txBytes   = extractStat(lower, /(\d+)\s+(?:(?:bytes|byte)\s+)?(?:output|tx|sent)/);
    detail.rxBytes   = extractStat(lower, /(\d+)\s+(?:(?:bytes|byte)\s+)?(?:input|rx|received)/);
    detail.txPackets = extractStat(lower, /(\d+)\s+(?:(?:packets|packet)\s+)?(?:output|tx|sent)/);
    detail.rxPackets = extractStat(lower, /(\d+)\s+(?:(?:packets|packet)\s+)?(?:input|rx|received)/);
    detail.txErrors  = extractStat(lower, /(\d+)\s+(?:(?:output|tx)\s+)?errors?/);
    detail.rxErrors  = extractStat(lower, /(\d+)\s+(?:(?:input|rx)\s+)?errors?/);

    const speedMatch = /(?:speed|bw)\s+(\S+)/.exec(lower);
    if (speedMatch) detail.speed = speedMatch[1] ?? null;

    const duplexMatch = /duplex\s+(\S+)/i.exec(block);
    if (duplexMatch) detail.duplex = duplexMatch[1] ?? null;

    results.push(detail);
  }

  return results;
}
