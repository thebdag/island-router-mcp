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
        name: parts[0]!,
        status: parts[1]!,
        protocol: parts[2]!,
        description: parts.slice(3).join(" "),
      });
    }
  }

  return results;
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
    const headerMatch = header.match(/^(\S+)\s+is\s+(\S+)/);
    if (!headerMatch) continue;

    const detail: InterfaceDetail = {
      name: headerMatch[1]!,
      status: headerMatch[2]!.replace(",", ""),
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

    const fullBlock = block.toLowerCase();

    // Extract MTU
    const mtuMatch = fullBlock.match(/mtu\s+(\d+)/);
    if (mtuMatch) detail.mtu = parseInt(mtuMatch[1]!, 10);

    // Extract MAC
    const macMatch = block.match(/([0-9a-fA-F]{2}(?:[:\-.]){1}[0-9a-fA-F]{2}(?:[:\-.]){1}[0-9a-fA-F]{2}(?:[:\-.]){1}[0-9a-fA-F]{2}(?:[:\-.]){1}[0-9a-fA-F]{2}(?:[:\-.]){1}[0-9a-fA-F]{2})/);
    if (macMatch) detail.macAddress = macMatch[1]!;

    // Extract TX/RX bytes
    const txBytesMatch = fullBlock.match(/(\d+)\s+(?:bytes?\s+)?(?:output|tx|sent)/);
    if (txBytesMatch) detail.txBytes = parseInt(txBytesMatch[1]!, 10);

    const rxBytesMatch = fullBlock.match(/(\d+)\s+(?:bytes?\s+)?(?:input|rx|received)/);
    if (rxBytesMatch) detail.rxBytes = parseInt(rxBytesMatch[1]!, 10);

    // Extract TX/RX packets
    const txPktsMatch = fullBlock.match(/(\d+)\s+(?:packets?\s+)?(?:output|tx|sent)/);
    if (txPktsMatch) detail.txPackets = parseInt(txPktsMatch[1]!, 10);

    const rxPktsMatch = fullBlock.match(/(\d+)\s+(?:packets?\s+)?(?:input|rx|received)/);
    if (rxPktsMatch) detail.rxPackets = parseInt(rxPktsMatch[1]!, 10);

    // Extract errors
    const txErrMatch = fullBlock.match(/(\d+)\s+(?:output|tx)?\s*errors?/);
    if (txErrMatch) detail.txErrors = parseInt(txErrMatch[1]!, 10);

    const rxErrMatch = fullBlock.match(/(\d+)\s+(?:input|rx)?\s*errors?/);
    if (rxErrMatch) detail.rxErrors = parseInt(rxErrMatch[1]!, 10);

    // Extract speed/duplex
    const speedMatch = fullBlock.match(/(?:speed|bw)\s+(\S+)/);
    if (speedMatch) detail.speed = speedMatch[1]!;

    const duplexMatch = fullBlock.match(/duplex\s+(\S+)/i);
    if (duplexMatch) detail.duplex = duplexMatch[1]!;

    results.push(detail);
  }

  return results;
}
