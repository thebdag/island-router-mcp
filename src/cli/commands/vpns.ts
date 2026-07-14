import {
  callCore,
  deviceFromContext,
  parseDeviceArgs,
  type CliContext,
} from "../session.js";
import { queryVpns } from "../../core/query.js";

export async function vpnsCommand(
  args: string[],
  context?: CliContext,
): Promise<Record<string, unknown>> {
  const { deviceId } = parseDeviceArgs(args, ["device"], "vpns");
  const device = deviceFromContext(context, deviceId);
  const data = await callCore(() => queryVpns(device));
  const peers = data.vpn.peers ?? [];

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
    interface: data.vpn.interfaceName || undefined,
    peers: rows,
    help: ["Run `island-axi neighbors` for LAN ARP table"],
  };
}
