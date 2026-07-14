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

/** Label chars for DNS domains / wildcards — linear check, no nested quantifiers. */
const DOMAIN_LABEL_RE = /^[\w*-]+$/;

export function validateDomain(domain: string): void {
  validateSafe(domain, "domain");
  if (domain.length === 0 || domain.length > 253) {
    throw new Error(`Invalid domain: '${domain}'`);
  }
  const labels = domain.split(".");
  if (labels.some((label) => label.length === 0 || label.length > 63 || !DOMAIN_LABEL_RE.test(label))) {
    throw new Error(`Invalid domain: '${domain}'`);
  }
}

export function requireParam(value: string | undefined, name: string): string {
  if (!value) throw new Error(`'${name}' required`);
  return value;
}
