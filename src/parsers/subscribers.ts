/**
 * parsers/subscribers.ts — Correlate ARP, DHCP leases/reservations, and Island subscriber
 * history fingerprinting to discover and classify IoT and network devices.
 */

import type { DhcpReservation } from "./dhcp.js";
import type { Neighbor } from "./routes.js";

export type DeviceCategory = "iot" | "media" | "infrastructure" | "compute" | "unknown";

export interface SubscriberDevice {
  mac: string;
  ip: string | null;
  interface: string | null;
  name: string | null;
  description: string | null;
  vendor: string | null;
  category: DeviceCategory;
  signals: string[];
  state: string | null;
  reservedIp: string | null;
}

const KNOWN_OUIS: Record<string, { vendor: string; category?: DeviceCategory }> = {
  // Espressif (IoT)
  "24:0a:c4": { vendor: "Espressif", category: "iot" },
  "24:62:ab": { vendor: "Espressif", category: "iot" },
  "30:ae:a4": { vendor: "Espressif", category: "iot" },
  "3c:71:bf": { vendor: "Espressif", category: "iot" },
  "40:f5:20": { vendor: "Espressif", category: "iot" },
  "48:3f:da": { vendor: "Espressif", category: "iot" },
  "4c:75:25": { vendor: "Espressif", category: "iot" },
  "54:04:a6": { vendor: "Espressif", category: "iot" },
  "5c:cf:7f": { vendor: "Espressif", category: "iot" },
  "60:01:94": { vendor: "Espressif", category: "iot" },
  "68:c6:3a": { vendor: "Espressif", category: "iot" },
  "70:03:9f": { vendor: "Espressif", category: "iot" },
  "7c:df:a1": { vendor: "Espressif", category: "iot" },
  "80:7d:3a": { vendor: "Espressif", category: "iot" },
  "84:0d:8e": { vendor: "Espressif", category: "iot" },
  "84:f3:eb": { vendor: "Espressif", category: "iot" },
  "90:97:d5": { vendor: "Espressif", category: "iot" },
  "a0:20:a6": { vendor: "Espressif", category: "iot" },
  "a4:cf:12": { vendor: "Espressif", category: "iot" },
  "a4:e5:7c": { vendor: "Espressif", category: "iot" },
  "ac:d0:74": { vendor: "Espressif", category: "iot" },
  "b4:e6:2d": { vendor: "Espressif", category: "iot" },
  "bc:dd:c2": { vendor: "Espressif", category: "iot" },
  "c4:4f:33": { vendor: "Espressif", category: "iot" },
  "c8:2b:96": { vendor: "Espressif", category: "iot" },
  "cc:50:e3": { vendor: "Espressif", category: "iot" },
  "d8:a0:1d": { vendor: "Espressif", category: "iot" },
  "dc:4f:22": { vendor: "Espressif", category: "iot" },
  "e0:e2:e6": { vendor: "Espressif", category: "iot" },
  "e8:68:e7": { vendor: "Espressif", category: "iot" },
  "ec:fa:bc": { vendor: "Espressif", category: "iot" },
  // Tuya
  "10:5a:17": { vendor: "Tuya", category: "iot" },
  "18:69:d8": { vendor: "Tuya", category: "iot" },
  "68:57:2d": { vendor: "Tuya", category: "iot" },
  "70:89:cc": { vendor: "Tuya", category: "iot" },
  "7c:2c:67": { vendor: "Tuya", category: "iot" },
  "a0:92:08": { vendor: "Tuya", category: "iot" },
  "d4:a6:51": { vendor: "Tuya", category: "iot" },
  "dc:23:4d": { vendor: "Tuya", category: "iot" },
  // Shelly
  "48:55:19": { vendor: "Shelly", category: "iot" },
  "34:94:54": { vendor: "Shelly", category: "iot" },
  "ec:62:60": { vendor: "Shelly", category: "iot" },
  "ec:64:c9": { vendor: "Shelly", category: "iot" },
  // Wyze
  "2c:aa:8e": { vendor: "Wyze", category: "iot" },
  "7c:78:b2": { vendor: "Wyze", category: "iot" },
  "a4:da:22": { vendor: "Wyze", category: "iot" },
  // Philips Hue / Signify
  "00:17:88": { vendor: "Philips Lighting", category: "iot" },
  "ec:b5:fa": { vendor: "Philips Lighting", category: "iot" },
  // Ecobee
  "44:61:32": { vendor: "Ecobee", category: "iot" },
  // TP-Link
  "50:c7:bf": { vendor: "TP-Link", category: "iot" },
  "54:af:97": { vendor: "TP-Link", category: "iot" },
  "b4:b0:24": { vendor: "TP-Link", category: "iot" },
  // Amazon
  "00:fc:8b": { vendor: "Amazon", category: "iot" },
  "0c:47:c9": { vendor: "Amazon", category: "iot" },
  "18:74:2e": { vendor: "Amazon", category: "iot" },
  "34:d2:70": { vendor: "Amazon", category: "iot" },
  "44:65:0d": { vendor: "Amazon", category: "iot" },
  "68:37:e9": { vendor: "Amazon", category: "iot" },
  "68:54:5a": { vendor: "Amazon", category: "iot" },
  "74:c2:46": { vendor: "Amazon", category: "iot" },
  "ac:63:be": { vendor: "Amazon", category: "iot" },
  "fc:65:de": { vendor: "Amazon", category: "iot" },
  // Google / Nest
  "00:1a:11": { vendor: "Google", category: "iot" },
  "18:b4:30": { vendor: "Nest", category: "iot" },
  "64:16:66": { vendor: "Nest", category: "iot" },
  "3c:8d:20": { vendor: "Google", category: "iot" },
  // Media devices
  "00:0d:4b": { vendor: "Roku", category: "media" },
  "20:82:c0": { vendor: "Roku", category: "media" },
  "84:ea:99": { vendor: "Roku", category: "media" },
  "b0:a7:37": { vendor: "Roku", category: "media" },
  "d8:31:34": { vendor: "Roku", category: "media" },
  "d4:be:dc": { vendor: "Roku", category: "media" },
  "00:0e:58": { vendor: "Sonos", category: "media" },
  "48:a6:b8": { vendor: "Sonos", category: "media" },
  "5c:aa:fd": { vendor: "Sonos", category: "media" },
  "94:9f:3e": { vendor: "Sonos", category: "media" },
  "34:f1:50": { vendor: "Gaoshengda", category: "media" },
  // Infrastructure
  "08:00:8a": { vendor: "Island", category: "infrastructure" },
  "00:27:22": { vendor: "Ubiquiti", category: "infrastructure" },
  "04:18:d6": { vendor: "Ubiquiti", category: "infrastructure" },
  "24:5a:4c": { vendor: "Ubiquiti", category: "infrastructure" },
  "44:d9:e7": { vendor: "Ubiquiti", category: "infrastructure" },
  "68:d7:9a": { vendor: "Ubiquiti", category: "infrastructure" },
  "70:a7:41": { vendor: "Ubiquiti", category: "infrastructure" },
  "74:83:c2": { vendor: "Ubiquiti", category: "infrastructure" },
  "78:45:58": { vendor: "Ubiquiti", category: "infrastructure" },
  "80:2a:a8": { vendor: "Ubiquiti", category: "infrastructure" },
  "ac:8b:a9": { vendor: "Ubiquiti", category: "infrastructure" },
  "b4:fb:e4": { vendor: "Ubiquiti", category: "infrastructure" },
  "dc:9f:db": { vendor: "Ubiquiti", category: "infrastructure" },
  "e0:63:da": { vendor: "Ubiquiti", category: "infrastructure" },
  "f0:9f:c2": { vendor: "Ubiquiti", category: "infrastructure" },
  "b8:27:eb": { vendor: "Raspberry Pi", category: "infrastructure" },
  "dc:a6:32": { vendor: "Raspberry Pi", category: "infrastructure" },
  "e4:5f:01": { vendor: "Raspberry Pi", category: "infrastructure" },
  "28:cd:c1": { vendor: "Raspberry Pi", category: "infrastructure" },
  // Compute (Apple / Intel / HP / etc)
  "00:03:93": { vendor: "Apple", category: "compute" },
  "00:10:fa": { vendor: "Apple", category: "compute" },
  "18:65:90": { vendor: "Apple", category: "compute" },
  "28:cf:e9": { vendor: "Apple", category: "compute" },
  "3c:07:54": { vendor: "Apple", category: "compute" },
  "40:6c:8f": { vendor: "Apple", category: "compute" },
  "68:2f:67": { vendor: "Apple", category: "compute" },
  "7c:6d:62": { vendor: "Apple", category: "compute" },
  "8c:85:90": { vendor: "Apple", category: "compute" },
  "a4:83:e7": { vendor: "Apple", category: "compute" },
  "bc:d1:77": { vendor: "Apple", category: "compute" },
  "f0:18:98": { vendor: "Apple", category: "compute" },
  "6c:02:e0": { vendor: "HP", category: "iot" },
};

const IOT_KEYWORDS = [
  "esp_",
  "espressif",
  "tuya",
  "smart",
  "plug",
  "bulb",
  "light",
  "smart-switch",
  "camera",
  "cam",
  "doorbell",
  "sensor",
  "lock",
  "thermostat",
  "vacuum",
  "roborock",
  "roomba",
  "purifier",
  "humidifier",
  "fridge",
  "washer",
  "dryer",
  "oven",
  "printer",
  "scanner",
  "laserjet",
  "deskjet",
  "brother",
  "epson",
  "kasa",
  "tapo",
  "shelly",
  "meross",
  "sonoff",
  "wemo",
  "ring",
  "wyze",
  "blink",
  "nest",
  "ecobee",
  "hue",
  "lutron",
  "myq",
  "chamberlain",
  "broadlink",
  "aqara",
  "matter",
  "zigbee",
  "zwave",
  "smartlife",
];

const IOT_DOMAINS = [
  "tuyaus.com",
  "tuya.com",
  "wyzecam.com",
  "ring.com",
  "ecobee.com",
  "meethue.com",
  "tplinkcloud.com",
  "shelly.cloud",
  "xlink.cn",
  "smartthings.com",
];

const MEDIA_KEYWORDS = [
  "tv",
  "roku",
  "appletv",
  "apple-tv",
  "firetv",
  "firestick",
  "chromecast",
  "shield",
  "sonos",
  "denon",
  "marantz",
  "yamaha",
  "heos",
  "bose",
  "speaker",
  "soundbar",
  "receiver",
  "playstation",
  "xbox",
  "nintendo",
];

const INFRASTRUCTURE_KEYWORDS = [
  "unifi",
  "ubnt",
  "access-point",
  "ap-",
  "usw-",
  "uap-",
  "switch",
  "router",
  "gateway",
  "controller",
  "island",
  "pi-hole",
  "pihole",
  "dns",
  "proxmox",
  "esxi",
  "nas",
  "synology",
  "qnap",
  "truenas",
  "server",
];

const COMPUTE_KEYWORDS = [
  "macbook",
  "iphone",
  "ipad",
  "android",
  "pixel",
  "galaxy",
  "laptop",
  "desktop",
  "thinkpad",
  "dell",
  "hp",
  "lenovo",
  "surface",
  "pc",
  "workstation",
  "imac",
];

function matchesKeyword(text: string, kw: string): boolean {
  if (kw.length <= 4) {
    const escaped = kw.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
    const re = new RegExp(`(?:^|[^a-z0-9])${escaped}(?:[^a-z0-9]|$)`, "i");
    return re.test(text);
  }
  return text.toLowerCase().includes(kw.toLowerCase());
}

function hasKeyword(text: string, keywords: readonly string[]): boolean {
  return keywords.some((kw) => matchesKeyword(text, kw));
}

function normalizeMac(raw: string): string {
  return raw.trim().toLowerCase().replace(/-/g, ":");
}

function cleanIp(raw: string): string {
  let s = raw.trim();
  if (s.startsWith("[") && s.includes("]")) {
    s = s.slice(1, s.indexOf("]"));
  } else if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}:\d+$/.test(s)) {
    s = s.split(":")[0] ?? s;
  }
  return s;
}

function assignIp(dev: { ip: string | null }, rawIp: string | null | undefined): void {
  if (!rawIp) return;
  const cleaned = cleanIp(rawIp);
  if (!cleaned || cleaned === "0.0.0.0") return;
  // If dev already has an IPv4 address, prefer it over IPv6
  if (dev.ip && /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(dev.ip)) {
    return;
  }
  dev.ip = cleaned;
}

interface HistorySubscriberItem {
  mac?: string;
  sub?: string;
  name?: string;
  desc?: string;
  ident?: string;
  host?: string;
  ip?: string;
}

export function parseSubscribers(options: {
  neighbors?: readonly Neighbor[];
  reservations?: readonly DhcpReservation[];
  dhcpdStatsRaw?: string;
  historyRaw?: string;
}): SubscriberDevice[] {
  const deviceMap = new Map<
    string,
    {
      mac: string;
      ip: string | null;
      interface: string | null;
      name: string | null;
      description: string | null;
      vendor: string | null;
      state: string | null;
      reservedIp: string | null;
      signals: Set<string>;
      hosts: Set<string>;
    }
  >();

  function getOrCreate(rawMac: string) {
    const mac = normalizeMac(rawMac);
    let dev = deviceMap.get(mac);
    if (!dev) {
      const prefix = mac.slice(0, 8);
      const known = KNOWN_OUIS[prefix];
      dev = {
        mac,
        ip: null,
        interface: null,
        name: null,
        description: null,
        vendor: known?.vendor ?? null,
        state: null,
        reservedIp: null,
        signals: new Set<string>(),
        hosts: new Set<string>(),
      };
      if (known) {
        dev.signals.add(`OUI: ${known.vendor}`);
      }
      deviceMap.set(mac, dev);
    }
    return dev;
  }

  // 1. Process ARP neighbors
  for (const n of options.neighbors ?? []) {
    if (!n.mac) continue;
    const dev = getOrCreate(n.mac);
    assignIp(dev, n.ip);
    if (n.interface) dev.interface = n.interface;
    if (n.state) dev.state = n.state;
    if (n.hostname) {
      dev.name = dev.name ?? n.hostname;
      dev.signals.add(`Neighbor name: ${n.hostname}`);
    }
  }

  // 2. Process DHCP reservations
  for (const r of options.reservations ?? []) {
    if (!r.mac) continue;
    const dev = getOrCreate(r.mac);
    if (r.ip) {
      dev.reservedIp = r.ip;
      assignIp(dev, r.ip);
    }
    if (r.hostname) {
      dev.name = dev.name ?? r.hostname;
      dev.signals.add(`DHCP reservation: ${r.hostname}`);
    }
  }

  // 3. Process DHCP leases / stats if available
  if (options.dhcpdStatsRaw) {
    try {
      const stats = JSON.parse(options.dhcpdStatsRaw);
      const leases = Array.isArray(stats?.leases) ? stats.leases : Array.isArray(stats) ? stats : [];
      for (const item of leases) {
        const mac = item.mac ?? item.hardware_address;
        if (!mac || typeof mac !== "string") continue;
        const dev = getOrCreate(mac);
        assignIp(dev, item.ip);
        if (item.hostname) {
          dev.name = dev.name ?? item.hostname;
          dev.signals.add(`DHCP lease hostname: ${item.hostname}`);
        }
      }
    } catch {
      // Ignore unparseable dhcpd stats
    }
  }

  // 4. Process history records (JSON or line-by-line JSON)
  if (options.historyRaw) {
    const lines = options.historyRaw.split("\n").map((l) => l.trim()).filter(Boolean);
    for (const line of lines) {
      try {
        const parsed = JSON.parse(line) as HistorySubscriberItem | HistorySubscriberItem[];
        const items = Array.isArray(parsed) ? parsed : [parsed];
        for (const item of items) {
          if (!item.mac) continue;
          const dev = getOrCreate(item.mac);
          assignIp(dev, item.ip);
          if (item.sub) {
            dev.name = dev.name ?? item.sub;
            dev.signals.add(`Subscriber name: ${item.sub}`);
          }
          if (item.name) {
            dev.name = dev.name ?? item.name;
          }
          if (item.desc) {
            dev.description = dev.description ?? item.desc;
            dev.signals.add(`Fingerprint desc: ${item.desc}`);
          }
          if (item.ident) {
            dev.description = dev.description ?? item.ident;
            dev.signals.add(`Fingerprint: ${item.ident}`);
          }
          if (item.host) {
            dev.hosts.add(item.host.toLowerCase());
          }
        }
      } catch {
        // Not JSON line; ignore
      }
    }
  }

  // 5. Classify each device based on aggregated signals
  const results: SubscriberDevice[] = [];
  for (const dev of deviceMap.values()) {
    const deviceIdentityText = [
      dev.name ?? "",
      dev.description ?? "",
      dev.vendor ?? "",
    ]
      .join(" ")
      .toLowerCase();

    const hostDomainsText = Array.from(dev.hosts).join(" ").toLowerCase();

    let category: DeviceCategory = "unknown";
    const prefix = dev.mac.slice(0, 8);
    const knownOUI = KNOWN_OUIS[prefix];

    // Priority 1: Infrastructure (switches, APs, routers, servers, gateways)
    if (
      hasKeyword(deviceIdentityText, INFRASTRUCTURE_KEYWORDS) ||
      knownOUI?.category === "infrastructure"
    ) {
      category = "infrastructure";
    } else if (
      hasKeyword(deviceIdentityText, MEDIA_KEYWORDS) ||
      knownOUI?.category === "media"
    ) {
      category = "media";
    } else if (
      hasKeyword(deviceIdentityText, IOT_KEYWORDS) ||
      IOT_DOMAINS.some((dom) => hostDomainsText.includes(dom)) ||
      knownOUI?.category === "iot"
    ) {
      category = "iot";
    } else if (
      hasKeyword(deviceIdentityText, COMPUTE_KEYWORDS) ||
      knownOUI?.category === "compute"
    ) {
      category = "compute";
    }

    results.push({
      mac: dev.mac,
      ip: dev.ip,
      interface: dev.interface,
      name: dev.name,
      description: dev.description,
      vendor: dev.vendor,
      category,
      signals: Array.from(dev.signals),
      state: dev.state,
      reservedIp: dev.reservedIp,
    });
  }

  // Sort by IP then MAC
  results.sort((a, b) => (a.ip ?? "").localeCompare(b.ip ?? "") || a.mac.localeCompare(b.mac));
  return results;
}
