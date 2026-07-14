import {
  callCore,
  deviceFromContext,
  parseDeviceArgs,
  type CliContext,
} from "../session.js";
import { queryDnsRedirects } from "../../core/query.js";

export async function dnsRedirectsCommand(
  args: string[],
  context?: CliContext,
): Promise<Record<string, unknown>> {
  const { deviceId } = parseDeviceArgs(args, ["device"], "dns-redirects");
  const device = deviceFromContext(context, deviceId);
  const data = await callCore(() => queryDnsRedirects(device));

  if (data.dns_redirects.length === 0) {
    return {
      device: device.id,
      dns_redirects: "0 DNS redirects found",
      help: [
        "Run `island-axi configure add-dns-redirect --domain <name> --redirect-server 0.0.0.0 --confirm` to block a hostname",
      ],
    };
  }

  return {
    device: device.id,
    count: data.count,
    dns_redirects: data.dns_redirects.map((r) => ({
      domain: r.domain,
      server: r.server,
    })),
    help: [
      "Run `island-axi configure remove-dns-redirect --domain <name> --confirm` to remove",
    ],
  };
}
