/**
 * parsers/dnsRedirects.ts — Parse DNS redirect entries from running-config output.
 *
 * The Island Router CLI exposes `ip dns redirect <domain> <server>` for
 * redirecting DNS queries for specific domains to a designated server.
 * This is the CLI-accessible mechanism for hostname-level filtering
 * (e.g., sinkholing a domain to 0.0.0.0 to block it).
 *
 * This parser extracts those entries from `show running-config` output.
 */

export interface DnsRedirect {
  /** The domain being redirected (e.g., "facebook.com") */
  domain: string;
  /** The server the domain is redirected to (e.g., "0.0.0.0" for sinkhole) */
  server: string;
}

/**
 * Parse DNS redirect entries from raw `show running-config` output.
 *
 * Looks for lines matching:
 *   ip dns redirect <domain> <server>
 *
 * @param rawConfig - Raw output from `show running-config`
 * @returns Array of parsed DNS redirect entries
 */
export function parseDnsRedirects(rawConfig: string): DnsRedirect[] {
  const results: DnsRedirect[] = [];
  const lines = rawConfig.split("\n");

  for (const line of lines) {
    const trimmed = line.trim();
    // Match: ip dns redirect <domain> <server>
    const match = /^ip\s+dns\s+redirect\s+(\S+)\s+(\S+)$/i.exec(trimmed);
    if (match) {
      results.push({
        domain: match[1] as string,
        server: match[2] as string,
      });
    }
  }

  return results;
}
