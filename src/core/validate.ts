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
}

export function validateSafe(value: string, label: string): void {
  if (/[;&|`$(){}]/.test(value)) {
    throw new Error(`Invalid ${label} — contains shell metacharacters`);
  }
}

export function validateDomain(domain: string): void {
  validateSafe(domain, "domain");
  if (!/^[\w.*-]+(?:\.[\w.*-]+)*$/.test(domain)) {
    throw new Error(`Invalid domain: '${domain}'`);
  }
}

export function requireParam(value: string | undefined, name: string): string {
  if (!value) throw new Error(`'${name}' required`);
  return value;
}
