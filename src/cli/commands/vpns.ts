import { parseVpnPeers } from "../../parsers/vpn.js";
import {
  deviceFromContext,
  parseDeviceArgs,
  runShow,
  type CliContext,
} from "../session.js";

export async function vpnsCommand(
  args: string[],
  context?: CliContext,
): Promise<Record<string, unknown>> {
  const { deviceId } = parseDeviceArgs(args, ["device"], "vpns");
  const device = deviceFromContext(context, deviceId);

  const output = await runShow(device, "show vpns", 2000);
  const vpn = parseVpnPeers(output);
  const peers = vpn.peers ?? [];

  if (peers.length === 0) {
    return {
      device: device.id,
      vpns: "0 VPN peers found",
      help: ["Run `island-axi status` for overview"],
    };
  }

  const rows = peers.map((p) => ({
    name: p.name || p.id,
    status: p.status,
    endpoint: p.endpoint,
    handshake: p.latestHandshake,
  }));

  const online = peers.filter((p) => /up|active|online/i.test(p.status)).length;

  return {
    device: device.id,
    count: peers.length,
    peers_online: online,
    interface: vpn.interfaceName || undefined,
    peers: rows,
    help: ["Run `island-axi neighbors` for LAN ARP table"],
  };
}
