import { describe, expect, it } from "vitest";
import { parseVlans } from "../src/parsers/vlans.js";
import { parseSubscribers } from "../src/parsers/subscribers.js";
import {
  validateCidr,
  validateDhcpScope,
  validateInterfaceName,
  validateVlanId,
} from "../src/core/validate.js";

describe("VLAN & Network Validators", () => {
  it("validates valid and invalid VLAN IDs", () => {
    expect(() => validateVlanId(1)).not.toThrow();
    expect(() => validateVlanId(20)).not.toThrow();
    expect(() => validateVlanId(4094)).not.toThrow();
    expect(() => validateVlanId(0)).toThrow(/Invalid vlan_id/);
    expect(() => validateVlanId(4095)).toThrow(/Invalid vlan_id/);
    expect(() => validateVlanId(3.14)).toThrow(/Invalid vlan_id/);
  });

  it("validates interface names", () => {
    expect(() => validateInterfaceName("en1")).not.toThrow();
    expect(() => validateInterfaceName("ethernet1")).not.toThrow();
    expect(() => validateInterfaceName("vlan20")).not.toThrow();
    expect(() => validateInterfaceName("123")).toThrow(/Invalid interface name/);
    expect(() => validateInterfaceName("en1; rm -rf")).toThrow(/metacharacters/);
  });

  it("validates IPv4 CIDR notations", () => {
    expect(() => validateCidr("192.168.20.1/24")).not.toThrow();
    expect(() => validateCidr("10.0.0.1/8")).not.toThrow();
    expect(() => validateCidr("172.16.0.1/30")).not.toThrow();
    expect(() => validateCidr("192.168.20.1")).toThrow(/Invalid CIDR/);
    expect(() => validateCidr("192.168.20.1/32")).toThrow(/prefix length/);
    expect(() => validateCidr("192.168.20.1/7")).toThrow(/prefix length/);
    expect(() => validateCidr("999.168.20.1/24")).toThrow(/Invalid IP/);
  });

  it("validates DHCP scopes", () => {
    expect(() => validateDhcpScope("50-250")).not.toThrow();
    expect(() => validateDhcpScope("100-")).not.toThrow();
    expect(() => validateDhcpScope("invalid")).toThrow(/Invalid dhcp_scope/);
  });
});

describe("parseVlans", () => {
  it("extracts VLAN interface blocks and merges operational summaries", () => {
    const rawRunningConfig = `
hostname Island-Router
!
interface en1
 description "LAN Trunk"
!
interface vlan20
 parent en1
 ip autoconfig lan
 ip address 192.168.20.1/24
 ip dhcp-server on
 ip dhcp-scope 50-250
 ip dhcp-lease 1800
 description "IoT VLAN"
!
interface vlan30
 parent en1
 ip autoconfig lan-no-dhcp
 ip address 192.168.30.1/24
 ip dhcp-server off
 description "Guest Network"
!
end
`;

    const summaries = [
      { name: "en1", status: "up", protocol: "up", description: "LAN Trunk" },
      { name: "vlan20", status: "up", protocol: "up", description: "IoT VLAN" },
      { name: "vlan30", status: "down", protocol: "down", description: "Guest Network" },
    ];

    const result = parseVlans(rawRunningConfig, summaries);
    expect(result).toHaveLength(2);

    const v20 = result.find((v) => v.vlanId === 20);
    expect(v20).toBeDefined();
    expect(v20?.name).toBe("vlan20");
    expect(v20?.parent).toBe("en1");
    expect(v20?.ipAddress).toBe("192.168.20.1/24");
    expect(v20?.autoconfig).toBe("lan");
    expect(v20?.dhcpServer).toBe(true);
    expect(v20?.dhcpScope).toBe("50-250");
    expect(v20?.dhcpLease).toBe(1800);
    expect(v20?.description).toBe("IoT VLAN");
    expect(v20?.status).toBe("up");
    expect(v20?.protocol).toBe("up");

    const v30 = result.find((v) => v.vlanId === 30);
    expect(v30).toBeDefined();
    expect(v30?.dhcpServer).toBe(false);
    expect(v30?.status).toBe("down");
  });

  it("handles dual-stack IPv4 and IPv6 on VLAN interface and inherits parent status", () => {
    const rawRunningConfig = `
hostname Daggett
interface en1
 ip address 192.168.2.1/24
!
interface vlan2
 parent en1
 ip address 192.168.84.1/24
 ip address fdce:6780:17e4:8::1/64
 ip autoconfig lan
!
end
`;
    const summaries = [
      { name: "en1", status: "Up", protocol: "Up", description: null },
    ];
    const result = parseVlans(rawRunningConfig, summaries);
    expect(result).toHaveLength(1);
    expect(result[0]?.vlanId).toBe(2);
    expect(result[0]?.ipAddress).toBe("192.168.84.1/24");
    expect(result[0]?.ipv6Address).toBe("fdce:6780:17e4:8::1/64");
    expect(result[0]?.status).toBe("Up");
  });

  it("handles empty or non-VLAN configs cleanly", () => {
    expect(parseVlans("hostname Island-Router\n!")).toEqual([]);
  });
});

describe("parseSubscribers & IoT classification", () => {
  it("correlates ARP, DHCP, and history to classify devices into IoT, media, infrastructure, and compute", () => {
    const neighbors = [
      {
        ip: "192.168.2.50",
        mac: "24:0a:c4:11:22:33", // Espressif OUI
        interface: "en1",
        state: "REACHABLE",
      },
      {
        ip: "192.168.2.51",
        mac: "00:0d:4b:aa:bb:cc", // Roku OUI
        interface: "en1",
        state: "REACHABLE",
      },
      {
        ip: "192.168.2.2",
        mac: "00:27:22:33:44:55", // Ubiquiti OUI
        interface: "en1",
        state: "REACHABLE",
      },
      {
        ip: "192.168.2.105",
        mac: "00:03:93:44:55:66", // Apple OUI
        interface: "en1",
        state: "REACHABLE",
      },
      {
        ip: "192.168.2.80",
        mac: "aa:bb:cc:dd:ee:ff", // Generic MAC with IoT signals
        interface: "en1",
        state: "REACHABLE",
      },
    ];

    const reservations = [
      {
        mac: "24:0a:c4:11:22:33",
        ip: "192.168.2.50",
        hostname: "smart-plug-kitchen",
        interface: "en1",
        status: "active",
      },
      {
        mac: "00:27:22:33:44:55",
        ip: "192.168.2.2",
        hostname: "unifi-usw-lite-16",
        interface: "en1",
        status: "active",
      },
    ];

    const historyRaw = `
{"mac": "aa:bb:cc:dd:ee:ff", "sub": "SmartThermostat", "desc": "Ecobee Smart Thermostat", "ident": "urn:schemas-upnp-org:device:Thermostat:1"}
{"mac": "00:0d:4b:aa:bb:cc", "sub": "RokuLivingRoom", "desc": "Roku Ultra 4800X"}
`;

    const subscribers = parseSubscribers({
      neighbors,
      reservations,
      historyRaw,
    });

    expect(subscribers).toHaveLength(5);

    const espPlug = subscribers.find((s) => s.mac === "24:0a:c4:11:22:33");
    expect(espPlug?.category).toBe("iot");
    expect(espPlug?.vendor).toBe("Espressif");
    expect(espPlug?.name).toBe("smart-plug-kitchen");

    const roku = subscribers.find((s) => s.mac === "00:0d:4b:aa:bb:cc");
    expect(roku?.category).toBe("media");
    expect(roku?.vendor).toBe("Roku");
    expect(roku?.name).toBe("RokuLivingRoom");

    const unifi = subscribers.find((s) => s.mac === "00:27:22:33:44:55");
    expect(unifi?.category).toBe("infrastructure");
    expect(unifi?.vendor).toBe("Ubiquiti");
    expect(unifi?.name).toBe("unifi-usw-lite-16");

    const apple = subscribers.find((s) => s.mac === "00:03:93:44:55:66");
    expect(apple?.category).toBe("compute");
    expect(apple?.vendor).toBe("Apple");

    const ecobee = subscribers.find((s) => s.mac === "aa:bb:cc:dd:ee:ff");
    expect(ecobee?.category).toBe("iot");
    expect(ecobee?.name).toBe("SmartThermostat");
    expect(ecobee?.description).toBe("Ecobee Smart Thermostat");
  });
});
