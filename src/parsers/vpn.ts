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

/** Apply interface-level WireGuard fields (returns true if handled). */
function applyInterfaceField(summary: VpnSummary, trimmed: string, currentPeer: Partial<VpnPeer> | null): boolean {
  const ifaceMatch = /^interface:\s*(\S+)/i.exec(trimmed);
  if (ifaceMatch) {
    summary.interfaceName = ifaceMatch[1] ?? "";
    return true;
  }

  const pubKeyMatch = /^public\s+key:\s*(\S+)/i.exec(trimmed);
  if (pubKeyMatch && !currentPeer) {
    summary.publicKey = pubKeyMatch[1] ?? "";
    return true;
  }

  const portMatch = /^listening\s+port:\s*(\d+)/i.exec(trimmed);
  if (portMatch) {
    summary.listeningPort = Number.parseInt(portMatch[1] ?? "0", 10);
    return true;
  }

  return false;
}

/** Apply peer-level WireGuard property fields (returns true if handled). */
function applyPeerField(peer: Partial<VpnPeer>, trimmed: string): boolean {
  const endpointMatch = /^endpoint:\s*(\S+)/i.exec(trimmed);
  if (endpointMatch) {
    peer.endpoint = endpointMatch[1] ?? "";
    return true;
  }

  const allowedMatch = /^allowed\s+ips?:\s*(.+)/i.exec(trimmed);
  if (allowedMatch) {
    peer.remoteIp = (allowedMatch[1] ?? "").split(",")[0]?.trim() ?? "";
    return true;
  }

  const handshakeMatch = /^latest\s+handshake:\s*(.+)/i.exec(trimmed);
  if (handshakeMatch) {
    peer.latestHandshake = handshakeMatch[1] ?? "";
    return true;
  }

  const transferMatch = /^transfer:\s*(.+)/i.exec(trimmed);
  if (transferMatch) {
    const transferStr = transferMatch[1] ?? "";
    peer.rxBytes = parseTransferValue(transferStr, /(\d+(?:\.\d+)?)\s+([KMGT]i?B)\s+received/i);
    peer.txBytes = parseTransferValue(transferStr, /(\d+(?:\.\d+)?)\s+([KMGT]i?B)\s+sent/i);
    return true;
  }

  const nameMatch = /^(?:name|preshared\s+key|comment):\s*(.+)/i.exec(trimmed);
  if (nameMatch) {
    peer.name = nameMatch[1] ?? "";
    return true;
  }

  return false;
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

  let currentPeer: Partial<VpnPeer> | null = null;
  let peerIndex = 0;

  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    if (applyInterfaceField(summary, trimmed, currentPeer)) continue;

    const peerMatch = /^peer:\s*(\S+)/i.exec(trimmed);
    if (peerMatch) {
      if (currentPeer) {
        summary.peers.push(finalizePeer(currentPeer, peerIndex));
        peerIndex++;
      }
      currentPeer = { id: peerMatch[1] ?? "" };
      continue;
    }

    if (currentPeer) {
      applyPeerField(currentPeer, trimmed);
    }
  }

  if (currentPeer) {
    summary.peers.push(finalizePeer(currentPeer, peerIndex));
  }

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
