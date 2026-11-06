/** Shared input validators for Island Router actions. */

export function validateMac(mac: string): void {
  if (!/^([0-9a-fA-F]{2}[:\-.]){5}[0-9a-fA-F]{2}$/.test(mac)) {
    throw new Error(`Invalid MAC: '${mac}'`);
  }
}

export function validateIp(ip: string): void {
  if (!/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(ip)) {
    throw new Error(`Invalid IP: '${ip}'`);
  }
  const octets = ip.split(".").map((n) => Number.parseInt(n, 10));
  if (octets.some((o) => o < 0 || o > 255)) {
    throw new Error(`Invalid IP: '${ip}' (octets must be 0–255)`);
  }
}

export function validateSafe(value: string, label: string): void {
  if (/[;&|`$(){}]/.test(value)) {
    throw new Error(`Invalid ${label} — contains shell metacharacters`);
  }
}

export function validateDomain(domain: string): void {
  validateSafe(domain, "domain");
  if (!/^[\w.*-]+$/.test(domain)) {
    throw new Error(`Invalid domain: '${domain}'`);
  }
}

export function requireParam(value: string | undefined, name: string): string {
  if (!value) throw new Error(`'${name}' required`);
  return value;
}

export function validateVlanId(vlanId: number): void {
  if (!Number.isInteger(vlanId) || vlanId < 1 || vlanId > 4094) {
    throw new Error(`Invalid vlan_id: '${vlanId}' (must be an integer 1–4094)`);
  }
}

export function validateInterfaceName(iface: string): void {
  validateSafe(iface, "interface");
  if (!/^[a-zA-Z][a-zA-Z0-9._-]{0,31}$/.test(iface)) {
    throw new Error(`Invalid interface name: '${iface}'`);
  }
}

export function validateCidr(cidr: string): void {
  const parts = cidr.split("/");
  if (parts.length !== 2) {
    throw new Error(`Invalid CIDR: '${cidr}' (expected <ipv4>/<prefix>, e.g. 192.0.2.1/24)`);
  }
  validateIp(parts[0] ?? "");
  const bits = Number.parseInt(parts[1] ?? "", 10);
  if (!Number.isInteger(bits) || bits < 8 || bits > 30 || String(bits) !== parts[1]) {
    throw new Error(`Invalid CIDR prefix length in '${cidr}' (must be 8–30)`);
  }
}

export function validateDhcpScope(scope: string): void {
  if (!/^\d{1,4}-(\d{1,4})?$/.test(scope)) {
    throw new Error(`Invalid dhcp_scope: '${scope}' (expected '<low>-<high>' or '<low>-', e.g. '50-250')`);
  }
}
