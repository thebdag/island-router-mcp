/**
 * parsers/vlans.ts — Parse VLAN interfaces from running-config and interface summaries.
 */

import type { InterfaceSummary } from "./interfaces.js";

export interface VlanInterface {
  name: string;
  vlanId: number;
  parent: string | null;
  ipAddress: string | null;
  ipv6Address?: string | null;
  autoconfig: string | null;
  dhcpServer: boolean | null;
  dhcpScope: string | null;
  dhcpLease: number | null;
  description: string | null;
  status: string;
  protocol: string;
}

export function parseVlans(
  runningConfig: string,
  summaries: readonly InterfaceSummary[] = [],
): VlanInterface[] {
  const summaryMap = new Map<string, InterfaceSummary>();
  for (const s of summaries) {
    summaryMap.set(s.name.toLowerCase(), s);
  }

  const results: VlanInterface[] = [];
  const lines = runningConfig.split("\n");

  let currentVlan: Partial<VlanInterface> | null = null;

  function commitCurrent() {
    if (!currentVlan || currentVlan.vlanId === undefined || !currentVlan.name) return;
    const summary = summaryMap.get(currentVlan.name.toLowerCase());
    const parentSummary = currentVlan.parent ? summaryMap.get(currentVlan.parent.toLowerCase()) : undefined;
    results.push({
      name: currentVlan.name,
      vlanId: currentVlan.vlanId,
      parent: currentVlan.parent ?? null,
      ipAddress: currentVlan.ipAddress ?? null,
      ipv6Address: currentVlan.ipv6Address ?? null,
      autoconfig: currentVlan.autoconfig ?? null,
      dhcpServer: currentVlan.dhcpServer ?? null,
      dhcpScope: currentVlan.dhcpScope ?? null,
      dhcpLease: currentVlan.dhcpLease ?? null,
      description: currentVlan.description ?? summary?.description ?? null,
      status: summary?.status ?? parentSummary?.status ?? "active",
      protocol: summary?.protocol ?? parentSummary?.protocol ?? "active",
    });
    currentVlan = null;
  }

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (!trimmed) continue;

    // Check for interface block start
    const ifaceMatch = /^interface\s+vlan(\d+)/i.exec(trimmed);
    if (ifaceMatch) {
      commitCurrent();
      const vlanId = Number.parseInt(ifaceMatch[1] ?? "0", 10);
      currentVlan = {
        name: `vlan${vlanId}`,
        vlanId,
      };
      continue;
    }

    // If another top-level command or interface starts
    if (/^(?:interface\s+|!\s*$|end\s*$)/i.test(trimmed) && currentVlan) {
      commitCurrent();
      continue;
    }

    if (!currentVlan) continue;

    const parentMatch = /^parent\s+(\S+)/i.exec(trimmed);
    if (parentMatch) {
      currentVlan.parent = parentMatch[1] ?? null;
      continue;
    }

    const ipMatch = /^ip\s+address\s+(\S+)/i.exec(trimmed);
    if (ipMatch) {
      const addr = ipMatch[1] ?? "";
      if (addr.includes(":")) {
        currentVlan.ipv6Address = addr;
      } else {
        currentVlan.ipAddress = addr;
      }
      continue;
    }

    const autoconfigMatch = /^ip\s+autoconfig\s+(\S+)/i.exec(trimmed);
    if (autoconfigMatch) {
      currentVlan.autoconfig = autoconfigMatch[1] ?? null;
      continue;
    }

    const dhcpServerMatch = /^ip\s+dhcp-server\s+(on|off)/i.exec(trimmed);
    if (dhcpServerMatch) {
      currentVlan.dhcpServer = dhcpServerMatch[1]?.toLowerCase() === "on";
      continue;
    }

    const dhcpScopeMatch = /^ip\s+dhcp-scope\s+(\S+)/i.exec(trimmed);
    if (dhcpScopeMatch) {
      currentVlan.dhcpScope = dhcpScopeMatch[1] ?? null;
      continue;
    }

    const dhcpLeaseMatch = /^ip\s+dhcp-lease\s+(\d+)/i.exec(trimmed);
    if (dhcpLeaseMatch) {
      currentVlan.dhcpLease = Number.parseInt(dhcpLeaseMatch[1] ?? "0", 10);
      continue;
    }

    const descMatch = /^description\s+(?:"([^"]+)"|'([^']+)'|(\S.*))$/i.exec(trimmed);
    if (descMatch) {
      currentVlan.description = descMatch[1] ?? descMatch[2] ?? descMatch[3] ?? null;
      continue;
    }
  }

  commitCurrent();

  return results;
}
