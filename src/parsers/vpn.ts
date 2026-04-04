/**
 * parsers/vpn.ts — Parse `show vpns` output into structured VPN peer data.
 */

export interface VpnPeer {
  id: string;
  name: string;
  endpoint: string;
  localIp: string;
  remoteIp: string;
  status: string;
  txBytes: number | null;
  rxBytes: number | null;
  latestHandshake: string;
}

export interface VpnSummary {
  interfaceName: string;
  publicKey: string;
  listeningPort: number | null;
  peers: VpnPeer[];
}

/**
 * Parse `show vpns` output.
 *
 * The output format varies but typically includes a WireGuard-style listing:
 *
 *   interface: wg0
 *     public key: ...
 *     listening port: 51820
 *
 *   peer: <base64-key>
 *     endpoint: 1.2.3.4:51820
 *     allowed ips: 10.0.0.2/32
 *     latest handshake: 1 minute, 3 seconds ago
 *     transfer: 1.23 MiB received, 4.56 MiB sent
 *
 * Or a table-based format:
 *   ID  Name      Endpoint       Status  Transfer
 *   1   peer-1    1.2.3.4:51820  up      1.2M/3.4M
 */
export function parseVpnPeers(raw: string): VpnSummary {
  const summary: VpnSummary = {
    interfaceName: "",
    publicKey: "",
    listeningPort: null,
    peers: [],
  };

  const lines = raw.split("\n");

  // Try WireGuard-style format first
  let currentPeer: Partial<VpnPeer> | null = null;
  let peerIndex = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Interface line
    const ifaceMatch = /^interface:\s*(\S+)/i.exec(trimmed);
    if (ifaceMatch) {
      summary.interfaceName = ifaceMatch[1] ?? "";
      continue;
    }

    // Public key (interface level)
    const pubKeyMatch = /^public\s+key:\s*(\S+)/i.exec(trimmed);
    if (pubKeyMatch && !currentPeer) {
      summary.publicKey = pubKeyMatch[1] ?? "";
      continue;
    }

    // Listening port
    const portMatch = /^listening\s+port:\s*(\d+)/i.exec(trimmed);
    if (portMatch) {
      summary.listeningPort = Number.parseInt(portMatch[1] ?? "0", 10);
      continue;
    }

    // New peer block
    const peerMatch = /^peer:\s*(\S+)/i.exec(trimmed);
    if (peerMatch) {
      if (currentPeer) {
        summary.peers.push(finalizePeer(currentPeer, peerIndex));
        peerIndex++;
      }
      currentPeer = { id: peerMatch[1] ?? "" };
      continue;
    }

    // Peer properties (indented)
    if (currentPeer) {
      const endpointMatch = /^endpoint:\s*(\S+)/i.exec(trimmed);
      if (endpointMatch) {
        currentPeer.endpoint = endpointMatch[1] ?? "";
        continue;
      }

      const allowedMatch = /^allowed\s+ips?:\s*(.+)/i.exec(trimmed);
      if (allowedMatch) {
        // Use allowed IPs to derive remote IP
        currentPeer.remoteIp = (allowedMatch[1] ?? "").split(",")[0]?.trim() ?? "";
        continue;
      }

      const handshakeMatch = /^latest\s+handshake:\s*(.+)/i.exec(trimmed);
      if (handshakeMatch) {
        currentPeer.latestHandshake = handshakeMatch[1] ?? "";
        continue;
      }

      const transferMatch = /^transfer:\s*(.+)/i.exec(trimmed);
      if (transferMatch) {
        const transferStr = transferMatch[1] ?? "";
        currentPeer.rxBytes = parseTransferValue(transferStr, /(\d+(?:\.\d+)?)\s+([KMGT]i?B)\s+received/i);
        currentPeer.txBytes = parseTransferValue(transferStr, /(\d+(?:\.\d+)?)\s+([KMGT]i?B)\s+sent/i);
        continue;
      }

      // Peer name (preshared key or name field)
      const nameMatch = /^(?:name|preshared\s+key|comment):\s*(.+)/i.exec(trimmed);
      if (nameMatch) {
        currentPeer.name = nameMatch[1] ?? "";
        continue;
      }
    }
  }

  // Push last peer
  if (currentPeer) {
    summary.peers.push(finalizePeer(currentPeer, peerIndex));
  }

  // If no WireGuard-style peers found, try table format
  if (summary.peers.length === 0) {
    summary.peers = parseVpnTable(raw);
  }

  return summary;
}

/** Parse transfer value strings like "1.23 MiB" into bytes. */
function parseTransferValue(str: string, re: RegExp): number | null {
  const match = re.exec(str);
  if (!match) return null;

  const value = Number.parseFloat(match[1] ?? "0");
  const unit = (match[2] ?? "").toLowerCase();

  const multipliers: Record<string, number> = {
    "b": 1,
    "kib": 1024,
    "kb": 1000,
    "mib": 1024 * 1024,
    "mb": 1000 * 1000,
    "gib": 1024 * 1024 * 1024,
    "gb": 1000 * 1000 * 1000,
    "tib": 1024 ** 4,
    "tb": 1000 ** 4,
  };

  return Math.round(value * (multipliers[unit] ?? 1));
}

/** Finalize a partial peer object with defaults. */
function finalizePeer(partial: Partial<VpnPeer>, index: number): VpnPeer {
  return {
    id: partial.id ?? String(index),
    name: partial.name ?? "",
    endpoint: partial.endpoint ?? "",
    localIp: partial.localIp ?? "",
    remoteIp: partial.remoteIp ?? "",
    status: partial.latestHandshake ? "active" : "inactive",
    txBytes: partial.txBytes ?? null,
    rxBytes: partial.rxBytes ?? null,
    latestHandshake: partial.latestHandshake ?? "",
  };
}

/** Fallback: parse a table-formatted VPN output. */
function parseVpnTable(raw: string): VpnPeer[] {
  const lines = raw.split("\n").map((l) => l.trim()).filter(Boolean);
  const results: VpnPeer[] = [];

  let dataStarted = false;
  for (const line of lines) {
    if (!dataStarted) {
      if (/id|name|peer|endpoint/i.test(line) && /status|state|transfer/i.test(line)) {
        dataStarted = true;
        continue;
      }
      if (/^-{3,}/.test(line)) {
        dataStarted = true;
        continue;
      }
      continue;
    }

    if (/^-{3,}/.test(line)) continue;

    const parts = line.split(/\s+/);
    if (parts.length >= 3) {
      results.push({
        id: parts[0] ?? "",
        name: parts[1] ?? "",
        endpoint: parts[2] ?? "",
        localIp: "",
        remoteIp: "",
        status: parts[3] ?? "",
        txBytes: null,
        rxBytes: null,
        latestHandshake: parts.slice(4).join(" "),
      });
    }
  }

  return results;
}
