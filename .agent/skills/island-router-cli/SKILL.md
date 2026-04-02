---
name: island-router-cli
description: |
  Skill for managing an Island Router via its Cisco-style SSH CLI (firmware 2.3.2).
  Covers all CLI commands, session management, DHCP reservations, DNS/syslog configuration,
  device monitoring, VPN, SNMP, tcpdump, and automation patterns using paramiko.
  Exhaustive command reference auto-discovered from live router on 2026-04-01.
---

# Island Router CLI Skill

## Overview

The Island Router uses a **stateful, Cisco-style CLI** accessible over SSH (port 22) or serial
console. Commands are context-sensitive — the prompt changes depending on context (`Router>`,
`Router#`, `Router(config)#`, `Router(config-if)#`).

**Key constraints:**
- Configuration changes are **non-persistent** until `write memory` is executed.
- The CLI uses a pager (`--More--`) for long output — you must send a space or `q` to continue.
- `paramiko.invoke_shell()` is required (not `exec_command()`) to maintain session state.
- Commands can be abbreviated as long as they are unambiguous (e.g., `sh ip ne` = `show ip neighbors`).

**Environment variables (required):**
- `ROUTER_IP` — defaults to `192.168.2.1` (also accepts `ROUTER_HOST`)
- `ROUTER_PASS` — admin password (never hardcode; quote if it contains special chars like `&`, `!`, `^`)
- `ROUTER_KEY` — (optional) SSH private key content for key-based auth

**Access:**
- User: `admin` (full access) or `user` (read-only show commands)
- Default SSH port: 22

**Context-sensitive help:** Type `?` at any point to list available commands or parameters.
- `show ?` — lists all show subcommands
- `show ip ?` — lists ip subcommands
- `interface ethernet1 ?` — lists interface subcommands

**URL format** (for file transfer commands like `backup`, `write network`):
```
tftp://[username:password@]host[/path]
sftp://[username:password@]host[/path]
scp://[username:password@]host[/path]
ftp://[username:password@]host[/path]
```

---

## CLI Modes / Contexts

| Prompt               | Context             | How to Enter                     |
| -------------------- | ------------------- | -------------------------------- |
| `Router>`            | EXEC (unprivileged) | Login as `user`                  |
| `Router#`            | Privileged EXEC     | Login as `admin`                 |
| `Router(config)#`    | Global Config       | `configure terminal`             |
| `Router(config-if)#` | Interface Config    | `interface <name>` (from config) |

**Navigate between contexts:**
```
configure terminal          # Enter global config from privileged EXEC
interface ethernet1         # Enter interface config (from global config)
exit                        # Move up one context level
end                         # Return to privileged EXEC from any config context
```

---

## Exhaustive Command Reference

> **Note:** This reference was auto-discovered from the live router CLI help system (`?`) on 2026-04-01.
> Both EXEC and CONFIG modes share the same command set on this firmware.

### Session / Navigation

| Command                         | Context | Description                                   |
| ------------------------------- | ------- | --------------------------------------------- |
| `help`                          | Any     | Display help information                      |
| `?`                             | Any     | Context-sensitive help (list commands/params)  |
| `exit`                          | Any     | Exit current mode / logout                    |
| `end`                           | Config  | Return to privileged EXEC                     |
| `history`                       | Any     | Manage command history                        |
| `terminal length <0-512>`       | EXEC    | Set lines per page (0 = disable pager)        |
| `terminal width <0-512>`        | EXEC    | Set terminal column width                     |
| `terminal terminal-type <type>` | EXEC    | Set terminal type (e.g., `vt100`)             |

**Important for automation:** Set `terminal length 0` at session start to disable the pager.

---

### Configuration Mode Entry

| Command                           | Context         | Description                         |
| --------------------------------- | --------------- | ----------------------------------- |
| `configure terminal`              | Privileged EXEC | Enter global configuration mode     |
| `configure network <url>`         | Privileged EXEC | Load config from a network URL      |
| `configure authorized-keys <url>` | Privileged EXEC | Load SSH authorized keys from a URL |
| `configure known-hosts <url>`     | Privileged EXEC | Load SSH known hosts from a URL     |

---

### System / Device Management

| Command                      | Context         | Description                                             |
| ---------------------------- | --------------- | ------------------------------------------------------- |
| `hostname <name>`            | Config          | Set router hostname                                     |
| `description <text>`         | Config          | Set interface description                               |
| `password admin [<password>]`| Config          | Set admin password                                      |
| `password user [<password>]` | Config          | Set read-only user password                             |
| `reload`                     | Privileged EXEC | Reboot the router (⚠️ requires confirmation)            |
| `rollback`                   | Privileged EXEC | Roll back to the previous saved configuration           |
| `compact`                    | Privileged EXEC | Compact (defragment) the router's flash storage         |
| `led level <0-100>`          | Config          | Set LED brightness percentage                           |
| `mac output-format <format>` | Config          | Set MAC address display format template                 |
| `login confirm`              | Config          | Require confirmation before login                       |
| `login console`              | Config          | Configure console login settings                        |
| `login remote`               | Config          | Configure remote (SSH) login settings                   |
| `login support`              | Config          | Enable/disable Island support access                    |
| `show version`               | EXEC            | Show firmware version and system info                   |
| `show version history`       | EXEC            | Show version update history                             |
| `show hardware`              | EXEC            | Show hardware details (model, serial, etc.)             |
| `show clock`                 | EXEC            | Display the current date and time                       |
| `show users`                 | EXEC            | Show currently logged-in users                          |
| `show free-space`            | EXEC            | Show available flash storage space                      |
| `show public-key`            | EXEC            | Display this router's public SSH key                    |
| `show running-config`        | EXEC            | Show the current (unsaved) running configuration        |
| `show running-config differences` | EXEC       | Show differences from startup config                    |
| `show startup-config`        | EXEC            | Show the saved (startup) configuration                  |
| `show dumps`                 | EXEC            | List stored crash dumps                                 |
| `show packages`              | EXEC            | Show installed software packages                        |
| `show packages detail`       | EXEC            | Show detailed package information                       |

---

### Persistence

| Command               | Context         | Description                                                        |
| --------------------- | --------------- | ------------------------------------------------------------------ |
| `write memory`        | Privileged EXEC | **Save running config to flash** (makes config persistent)         |
| `write terminal`      | Privileged EXEC | Display running config to terminal (same as `show running-config`) |
| `write dump <url>`    | Privileged EXEC | Copy crash dumps to a remote URL                                   |
| `write network <url>` | Privileged EXEC | Copy running config to a remote URL                                |
| `write syslog <url>`  | Privileged EXEC | Copy syslog to a remote URL                                        |

> **Critical:** `write memory` must be called after making any configuration changes that should survive a reboot.

---

### Interface Configuration

| Command                                | Context          | Description                                               |
| -------------------------------------- | ---------------- | --------------------------------------------------------- |
| `interface <name>`                     | Config           | Enter interface config mode (e.g., `interface ethernet1`) |
| `description <text>`                   | Interface Config | Set a description for the interface                       |
| `duplex <auto|full|half>`              | Interface Config | Set duplex mode for an ethernet interface                 |
| `speed <auto|10|100|1000>`             | Interface Config | Set link speed for an ethernet interface                  |
| `parent <interface>`                   | Interface Config | Set parent interface (for logical sub-interfaces/VLANs)   |
| `move <iface>`                         | Interface Config | Move interface configuration to another interface         |
| `swap <iface>`                         | Interface Config | Swap configurations between two interfaces                |
| `ethernet polling auto`                | Interface Config | Enable automatic ethernet polling                         |
| `ethernet polling <1-n>`              | Interface Config | Set number of cores for polled mode                       |
| `disable network`                      | Config           | Shut down all packet processing                           |
| `show interface`                       | EXEC             | Show detailed interface status and counters               |
| `show interface enX`                   | EXEC             | Show detail for specific interface (replace X)            |
| `show interface summary`               | EXEC             | Show a summary table of all interfaces                    |
| `show interface transceivers`          | EXEC             | Show SFP/transceiver module information                   |
| `show interface transceivers diagnostics` | EXEC          | Show digital diagnostic monitoring details                |

---

### IP Configuration

**IP (Interface/Global Context)** — configured after `interface <name>` or from `configure terminal`:

| Command                                                     | Description                                                      |
| ----------------------------------------------------------- | ---------------------------------------------------------------- |
| `ip address <addr>[/<n>]`                                   | Set a static IP on this interface                                |
| `ip autoconfig <mode>`                                      | Set automatic IP configuration mode                              |
| `ip autovlan on|off`                                       | Enable/disable automatic VLAN discovery                          |
| `ip arp-scan on|off`                                       | Enable/disable ARP scanning                                      |
| `ip dhcp-client on|off`                                    | Enable/disable DHCP client                                       |
| `ip dhcp-server on|off`                                    | Enable/disable DHCP server                                       |
| `ip dhcp6-client on|off`                                   | Enable/disable DHCPv6 client                                     |
| `ip dhcp6-server on|off`                                   | Enable/disable DHCPv6 server                                     |
| `ip dhcp-lease <seconds>`                                   | Set DHCP lease time                                              |
| `ip dhcp-monitor on|off`                                   | Enable/disable DHCP monitor                                      |
| `ip dhcp-option-43 <class> <subtype> <value-type> <value>` | Configure DHCP vendor option 43                                  |
| `ip dhcp-reserve <ip> <mac>`                                | **Create a DHCP reservation** — pin a MAC to a specific IP      |
| `ip dhcp-scope [<low>]-[<high>]`                            | Set DHCP scope IP range                                          |
| `ip dns local-only on|off`                                 | Respond only to local IP addresses                               |
| `ip dns mode dnssec`                                        | Recursive resolution with DNSSEC verification                    |
| `ip dns mode https <name|url>`                              | DNS over HTTPS (e.g., cloudflare, google, opendns, or custom)    |
| `ip dns mode recursive`                                     | Recursive resolution without DNSSEC                              |
| `ip dns redirect <domain> <server>`                         | Redirect domain queries to a specific server                     |
| `ip ddns name <name>`                                       | Set DDNS hostname                                                |
| `ip ddns ipv6 on|off`                                      | Enable/disable IPv6 for DDNS                                     |
| `ip firewall on|off`                                       | Enable/disable single-port firewall                              |
| `ip ident4 on|off`                                         | Enable/disable IPv4 device identification                        |
| `ip ident6 on|off`                                         | Enable/disable IPv6 device identification                        |
| `ip idle <n>`                                               | Set idle time before purging an IP                               |
| `ip ipv6 on|off`                                           | Enable/disable global IPv6 support                               |
| `ip load-sharing dst-ip`                                    | Equal-cost path: use only destination IP                         |
| `ip load-sharing random`                                    | Equal-cost path: random selection                                |
| `ip load-sharing src-dst-ip`                                | Equal-cost path: use source and destination IP                   |
| `ip max-clients <n>`                                        | Set maximum allowed IPs                                          |
| `ip mtu <n>`                                                | Set Maximum Transmit Unit                                        |
| `ip nat4 on|off`                                           | Enable/disable IPv4 NAT                                          |
| `ip nat6 on|off`                                           | Enable/disable IPv6 NAT                                          |
| `ip port-forward tcp|tcp+udp|udp [<pub-ip>:]<port> <mac|ip|island> [<port>]` | Add D-NAT port forward rule   |
| `ip prefix-delegation on|off`                              | Enable/disable IPv6 Prefix Delegation                            |
| `ip priority <1-4>`                                         | Set interface priority                                           |
| `ip rip-announce on|off`                                   | Enable/disable RIP announcement                                  |
| `ip route <addr>/n <gw>`                                    | Install a static route                                           |
| `ip router-advertise on|off`                               | Enable/disable IPv6 router advertisement                         |
| `ip router-solicit on|off`                                 | Enable/disable IPv6 router solicitation                          |

**Show commands for IP:**

| Command                                 | Description                                                          |
| --------------------------------------- | -------------------------------------------------------------------- |
| `show ip dhcp-reservations`             | **List all DHCP static reservations** (MAC → IP mappings)            |
| `show ip dhcp-reservations csv`         | List DHCP reservations in CSV format                                 |
| `show ip interface`                     | Show IP address information for each interface                       |
| `show ip interface <iface>`             | Show IP info for a specific interface                                |
| `show ip neighbors`                     | **Show ARP/neighbor table** — lists devices by IP and MAC with state |
| `show ip routes`                        | Show the routing table                                               |
| `show ip sockets`                       | **Show active local IP sockets** (open connections/listeners)        |
| `show ip recommendations`              | Show IP auto-configuration suggestions                               |
| `show ip recommendations no-disabled`  | Suggestions excluding disabled interfaces                            |
| `show ip recommendations enX`          | Suggestions for a specific interface                                 |

---

### DNS Configuration

| Command                                   | Description                                              |
| ----------------------------------------- | -------------------------------------------------------- |
| `ip dns mode dnssec`                      | Recursive resolution with DNSSEC verification            |
| `ip dns mode https <name|url>`            | DNS over HTTPS (cloudflare, google, opendns, custom URL) |
| `ip dns mode recursive`                   | Recursive resolution without DNSSEC                      |
| `ip dns local-only on|off`               | Respond only to local IP addresses                       |
| `ip dns redirect <domain> <server>`       | Redirect domain queries to specific server               |
| `no ip dns redirect`                      | Remove DNS redirect                                      |

**DNS over HTTPS providers (discovered):**
```
ip dns mode https cloudflare     # CloudFlare DoH
ip dns mode https google         # Google DoH
ip dns mode https opendns        # OpenDNS DoH
ip dns mode https <url>          # Custom DoH endpoint
```

---

### Syslog / Logging

| Command                         | Context         | Description                                                          |
| ------------------------------- | --------------- | -------------------------------------------------------------------- |
| `syslog server <IP>[:<port>]`   | Config          | Set the remote syslog server IP (and optional port)                  |
| `no syslog server`              | Config          | Remove the external syslog server                                    |
| `syslog level <n>`              | Config          | Set minimum severity to forward (7=debug through 0=emergency)        |
| `syslog protocol tcp|udp`       | Config          | Set transport protocol for syslog (default: UDP)                     |
| `show syslog`                   | EXEC            | Display the syslog configuration                                     |
| `show log`                      | EXEC            | View local activity log entries                                      |
| `show log all`                  | EXEC            | Use all of buffer                                                    |
| `show log clear`                | EXEC            | Clear buffer after output                                            |
| `show log end`                  | EXEC            | Start at end of buffer & wait                                        |
| `show log kernel`               | EXEC            | Show only kernel log entries                                         |
| `show log last`                 | EXEC            | Use last portion of buffer                                           |
| `show log module <name>`        | EXEC            | Show entries from specific module                                    |
| `show log priority <level>`     | EXEC            | Show entries equal or above severity level                           |
| `show log utc`                  | EXEC            | Show times in UTC                                                    |
| `show log wait`                 | EXEC            | Wait for new records (tail mode)                                     |
| `show log where <string>`       | EXEC            | Filter log entries by condition                                      |
| `clear syslog <file>`           | EXEC            | Remove system log file                                               |
| `clear log`                     | EXEC            | Clear the activity log                                               |
| `write syslog <url>`            | Privileged EXEC | Export syslog to a remote file URL                                   |

**Log command modifiers** can be combined. For example:
```
show log all utc where "error"    # Show all log entries in UTC filtered by "error"
show log last priority warning    # Show recent entries at warning level or above
show log kernel wait              # Wait for new kernel log entries
```

**Example — forward logs to Raspberry Pi running rsyslog/Loki:**
```
configure terminal
  syslog server 192.168.2.50
  syslog level info
  syslog protocol udp
end
write memory
```

---

### Event History

The router maintains structured event history that can be queried with extensive format specifiers.

| Command                              | Description                                          |
| ------------------------------------ | ---------------------------------------------------- |
| `show history`                       | Display event history                                |
| `show history begin <time>`          | Earliest time to show (e.g., `1d`, `2h`, `30m`)     |
| `show history end <time>`            | Latest time to show                                  |
| `show history counts`                | Show record counts                                   |
| `show history first <template>`      | Show only first occurrence per template              |
| `show history format <template>`     | Set output format template                           |
| `show history ignore`                | Ignore output restrictions                           |
| `show history unadjusted`            | Output unadjusted times                              |
| `show history wait`                  | Wait for new records (tail mode)                     |
| `show history where <test>`          | Filter by condition                                  |

**Time range formats:**
```
show history begin 1d     # last 24 hours
show history begin 2h     # last 2 hours
show history begin 30m    # last 30 minutes
show history begin 1w     # last week
show history begin 1Y     # last year
```

**Format specifiers** (use with `show history first <specifier>` or `show history format`):

| Specifier     | Description                          |
| ------------- | ------------------------------------ |
| `%d[(<fmt>)]` | Date/time (default %Y/%m/%d %T)     |
| `%D`          | ISO 8601 date/time                   |
| `%h`          | Host name                            |
| `%i`          | Subscriber IP address                |
| `%m`          | MAC address                          |
| `%s`          | Subscriber name                      |
| `%E`          | Subscriber description               |
| `%t`          | Event type                           |
| `%c`          | Category number                      |
| `%g`          | Group number                         |
| `%u`          | Rule number                          |
| `%p`          | Policy number                        |
| `%n`          | Delivery count                       |
| `%f`          | Event flags                          |
| `%b`          | Button name                          |
| `%w`          | Waited time (seconds)                |
| `%j`          | Time offset from past                |
| `%R`          | Constant random number               |
| `%xr`         | Bytes received                       |
| `%xt`         | Bytes transmitted                    |
| `%ys`         | Subscriber IP & port                 |
| `%yd`         | Destination IP & port                |
| `%ri`         | Source IP                            |
| `%rn`         | Source name                          |
| `%rt`         | Source type                          |
| `%rq`         | Source qualifier                     |
| `%ah`         | Audit host name                      |
| `%asp`        | Audit source port                    |
| `%adi`        | Audit destination IP                 |
| `%adp`        | Audit destination port               |
| `%am`         | Audit method                         |
| `%ap`         | Audit path                           |
| `%av`         | Audit version                        |
| `%Mh`         | Host category map                    |
| `%Ma`         | Allowed category map                 |
| `%Md`         | Denied category map                  |
| `%F<x>`       | Boolean output of flag `<x>`        |
| `all`         | All attributes (tag=value)           |
| `json:`       | Output as JSON                       |
| `avro:`       | Output as Avro                       |
| `csv`         | Output as CSV                        |
| `syslog`      | Structured syslog format             |
| `usyslog`     | Unstructured syslog                  |
| `raw`         | Raw binary                           |
| `speedtest`   | Speed test results                   |
| `audit`       | AuditSentry format                   |

---

### NTP / Time

| Command                  | Context | Description                                                 |
| ------------------------ | ------- | ----------------------------------------------------------- |
| `ntp <address>...`       | Config  | Set NTP server address(es)                                  |
| `no ntp`                 | Config  | Remove NTP server                                           |
| `timezone <country|spec>`| Config  | Set timezone (2-letter country code or timezone name)       |
| `show ntp`               | EXEC    | Display NTP configuration                                   |
| `show ntp associations`  | EXEC    | Show NTP peer associations                                  |
| `show ntp status`        | EXEC    | Show NTP synchronization status                             |
| `show clock`             | EXEC    | Display current system time                                 |

---

### Statistics & Monitoring

| Command                              | Description                                                     |
| ------------------------------------ | --------------------------------------------------------------- |
| `show stats`                         | Show hardware/packet summary                                    |
| `show stats <component>`             | Show component-specific diagnostics (use `show stats ?`)        |
| `show ip sockets`                    | List active local IP sockets (TCP/UDP)                          |
| `show ip neighbors`                  | ARP neighbor table — IP, MAC, interface, and state              |
| `show ip routes`                     | Current routing table                                           |
| `show interface`                     | Detailed per-interface stats including TX/RX bytes, errors      |
| `show interface summary`             | Brief table of all interface states                             |
| `show hardware`                      | Hardware info (model, serial number, temps)                     |
| `show version`                       | Firmware version string                                         |
| `ping <ip|hostname>`                 | Send ICMP ping from the router                                  |
| `traceroute <host>`                  | Trace route to host                                             |
| `telnet <ip> [<port>]`              | Open a telnet connection from the router                        |
| `ssh [<user>@]<host>`               | Open an SSH connection from the router                          |

---

### Speed Test

| Command                              | Description                                          |
| ------------------------------------ | ---------------------------------------------------- |
| `speedtest`                          | Run a speed test                                     |
| `speedtest comment <text>`           | Add a comment to speed test history                  |
| `speedtest history`                  | Include results in history                           |
| `speedtest interface <name>`         | Run speed test on specific interface                 |
| `speedtest wait`                     | Wait for prior run to finish                         |
| `show speedtest`                     | Show speed test history                              |
| `show speedtest begin <time>`        | Show history from a specific time                    |
| `show speedtest counts`              | Show record counts                                   |
| `show speedtest first <template>`    | Show first occurrence per template                   |

Speed test history supports the same format specifiers as `show history`.

---

### Backup / Restore / Updates

| Command                           | Context         | Description                                      |
| --------------------------------- | --------------- | ------------------------------------------------ |
| `backup url <URL>`                | Config          | Set automatic backup upload URL                  |
| `backup days <days>`              | Config          | Set days of history to include in backup         |
| `backup interval <secs>`          | Config          | Set backup interval in seconds                   |
| `auto-update days <day>...`       | Config          | Set days for automatic updates                   |
| `auto-update time <hh:mm>`        | Config          | Set time for automatic updates                   |
| `show packages`                   | EXEC            | Show installed packages and versions             |
| `show packages detail`            | EXEC            | Show detailed package information                |
| `update`                          | Privileged EXEC | Trigger a firmware update                        |
| `clear update`                    | Privileged EXEC | Clear pending update state                       |
| `rollback`                        | Privileged EXEC | Roll back to previous firmware/config            |

**Auto-update day values:** `all`, `none`, `sunday`, `monday`, `tuesday`, `wednesday`, `thursday`, `friday`, `saturday`. Multiple days are specified positionally.

---

### VPN (WireGuard)

| Command                                  | Context         | Description                               |
| ---------------------------------------- | --------------- | ----------------------------------------- |
| `vpn key-exchange <host> <secret>`       | Config          | Exchange public keys with peer             |
| `vpn peer <n|auto> ...`                  | Config          | Define/configure a VPN peer                |
| `vpn port <n>`                           | Config          | Set WireGuard UDP port number              |
| `vpn renumber`                           | Config          | Renumber pool assignments                  |
| `vpn route <addr/bits>`                  | Config          | Specify manual VPN route                   |
| `vpn sort`                               | Config          | Sort peers by name                         |
| `vpn server auto-trust on|off`           | Config          | Auto-trust new VPN peers                   |
| `vpn server auto-visible on|off`         | Config          | Make VPN server auto-visible               |
| `vpn server force-nat on|off`            | Config          | Force NAT for VPN traffic                  |
| `vpn server no-local`                    | Config          | Disable local network access via VPN       |
| `vpn server pool`                        | Config          | Configure VPN address pool                 |
| `vpn server secret <secret>`             | Config          | Set VPN server shared secret               |
| `show vpns`                              | EXEC            | Show VPN status and peer list              |
| `show vpns <iface|mac>`                  | EXEC            | Show VPN status for specific peer          |
| `clear vpn-keys`                         | Privileged EXEC | Clear all VPN keys                         |

---

### SNMP

| Command                                                          | Context | Description                          |
| ---------------------------------------------------------------- | ------- | ------------------------------------ |
| `snmp-server community <name>`                                   | Config  | Define SNMP community name           |
| `snmp-server contact <string>`                                   | Config  | Set system contact string            |
| `snmp-server location <string>`                                  | Config  | Set system location string           |
| `snmp-server engineID <hex>`                                     | Config  | Set SNMPv3 engine ID                 |
| `snmp-server host <host> v1|v2c|v3 ...`                         | Config  | Configure trap host                  |
| `snmp-server user <name> [MD5|SHA <auth> [AES|DES [<priv>]]]`   | Config  | Configure SNMPv3 user                |
| `snmp-server notifications all`                                  | Config  | Enable all notification types        |
| `snmp-server notifications cpuUtilization <threshold>`           | Config  | CPU utilization notifications        |
| `snmp-server notifications ipLimitExceeded <threshold>`          | Config  | IP limit exceeded notifications      |
| `snmp-server notifications linkUpDown`                           | Config  | Link up/down notifications           |
| `snmp-server notifications psu`                                  | Config  | Power supply notifications           |
| `no snmp-server`                                                 | Config  | Remove SNMP configuration            |

---

### Packet Capture (tcpdump)

| Command                    | Context     | Description                          |
| -------------------------- | ----------- | ------------------------------------ |
| `tcpdump`                  | EXEC        | Start packet capture                 |
| `tcpdump count <n>`        | EXEC        | Stop after `<n>` packets             |
| `tcpdump filter <spec>`    | EXEC        | Apply BPF filter specification       |
| `tcpdump hex`              | EXEC        | Include hex dump in output           |
| `tcpdump interface <name>` | EXEC        | Capture on specific interface        |
| `tcpdump pager`            | EXEC        | Use pager for output                 |
| `tcpdump read <file>`      | EXEC        | Read from capture file               |
| `tcpdump verbose`          | EXEC        | Increase capture verbosity           |
| `tcpdump write <file>`     | EXEC        | Write capture to file                |

**Example:**
```
tcpdump interface ethernet1 count 100 filter "port 53"
```

---

### SSH & Security

| Command                           | Context         | Description                         |
| --------------------------------- | --------------- | ----------------------------------- |
| `show config authorized-keys`     | EXEC            | Show configured SSH authorized keys |
| `show config authorized-keys admin` | EXEC          | Show admin user's authorized keys   |
| `show config authorized-keys user`  | EXEC          | Show read-only user's authorized keys |
| `show config email`               | EXEC            | Show email notification addresses   |
| `show config known-hosts`         | EXEC            | Show SSH known hosts                |
| `show ssh-client-keys`            | EXEC            | Show SSH client key pairs           |
| `show ssh-client-keys detail`     | EXEC            | Show detailed SSH client keys       |
| `configure authorized-keys <url>` | Privileged EXEC | Load authorized_keys from a URL     |
| `configure known-hosts <url>`     | Privileged EXEC | Load known_hosts from a URL         |
| `clear ssh`                       | Privileged EXEC | Clear SSH objects                   |

---

### DHCP Reservations

DHCP reservations permanently bind a MAC address to an IP address:

```
# Enter config mode
configure terminal

# Reserve IP for a device by MAC
ip dhcp-reserve aa:bb:cc:dd:ee:ff 192.168.2.100 my-device-name

# Multiple devices
ip dhcp-reserve 11:22:33:44:55:66 192.168.2.101 raspberry-pi
ip dhcp-reserve aa:bb:cc:11:22:33 192.168.2.102 laptop

# Save
end
write memory
```

```
# View all reservations
show ip dhcp-reservations
show ip dhcp-reservations csv    # CSV format for parsing
```

---

### Packet / Debug

| Command              | Context         | Description                      |
| -------------------- | --------------- | -------------------------------- |
| `packet level <n>`   | Config/EXEC     | Set packet processing verbosity  |
| `show dumps`         | EXEC            | List stored crash dumps          |
| `write dump <url>`   | Privileged EXEC | Export crash dumps to remote URL |

---

### Clear (Reset) Commands

> ⚠️ Some of these commands are destructive and require confirmation.

| Command             | Description                                          |
| ------------------- | ---------------------------------------------------- |
| `clear everything`  | **Factory reset** — erase all configuration and data |
| `clear network`     | Clear all network configuration                      |
| `clear connections` | Drop all active connections                          |
| `clear log`         | Clear the local event log                            |
| `clear dhcp-client` | Release and clear DHCP client state                  |
| `clear dump`        | Delete stored crash dumps (or `<file>` for specific) |
| `clear package`     | Clear package cache (or `<name>` for specific)       |
| `clear pin`         | Remove the access PIN                                |
| `clear ssh`         | Clear SSH objects                                    |
| `clear syslog`      | Remove system log file                               |
| `clear update`      | Clear pending update state                           |
| `clear vpn-keys`    | Clear all VPN keys                                   |

---

### Negation (`no`) Command

The `no` prefix removes or disables a configuration:
```
no ip dhcp-reserve <mac>          # Remove a DHCP reservation
no ip port-forward <proto> <port> # Remove a port-forward rule
no ip route <dest> <mask>         # Remove a static route
no ip dns local-only              # Disable local-only DNS
no syslog server                  # Remove syslog server
no ntp                            # Remove NTP server
no snmp-server                    # Remove SNMP configuration
```

---

### Miscellaneous

| Command                          | Context | Description                           |
| -------------------------------- | ------- | ------------------------------------- |
| `package <name> <tag> <value>`   | Config  | Set installed package parameter       |
| `stats`                          | EXEC    | Display statistics                    |

---

## Automation Patterns (Python / paramiko)

### Key Rules
1. Use `invoke_shell()` — not `exec_command()` — to maintain CLI state.
2. Send `terminal length 0\n` immediately after connecting to disable paging.
3. Wait for the prompt string (`Router#`, `Router(config)#`) before sending next command.
4. Read output in a loop, watching for both prompt and `--More--`.
5. Call `write memory\n` after any config change to persist it.

### Device Data Usage Reporting

**Critical Limitation:** The Island Router **lacks native historical per-device accounting metrics** (i.e. it does not maintain cumulative byte tallies per client IP or MAC address).

To track per-device bandwidth data, you must heuristically proxy it using global interface stats combined with actively leased devices.

```python
# Interface byte counters — parse precise TX/RX cumulative bytes per interface
output = run_command(channel, "show stats json interfaces")

# Active DHCP clients - map active dynamic IP/MAC address statuses
output = run_command(channel, "show stats json dhcpd")
```

Parse strategy:
- Query `show stats json interfaces` to calculate true network-wide byte consumption diffs over your polling interval.
- Query `show stats json dhcpd` to identify online devices.
- Mathematically distribute/weight the global network spikes across the actively leased devices, enabling extremely realistic visual proxies without resource-draining TCPDump operations.
- **WARNING**: Always maintain one persistent SSH connection instead of invoking one-shot commands rapidly. Frequent new SSH connections will immediately lock the router's rate limiter (see Error Handling).

### DHCP Reservation Automation

```python
def add_dhcp_reservation(channel, mac: str, ip: str, hostname: str = ""):
    """Pin a device MAC to a static IP via DHCP reservation."""
    run_command(channel, "configure terminal")
    cmd = f"ip dhcp-reserve {mac} {ip}"
    if hostname:
        cmd += f" {hostname}"
    run_command(channel, cmd)
    run_command(channel, "end")
    run_command(channel, "write memory")

def list_dhcp_reservations(channel) -> str:
    """Return raw output of all current DHCP reservations."""
    return run_command(channel, "show ip dhcp-reservations")
```

### Syslog Configuration Automation

```python
def configure_syslog(channel, server_ip: str, port: int = 514,
                     level: str = "info", protocol: str = "udp"):
    """Configure the router to forward logs to an external syslog server."""
    run_command(channel, "configure terminal")
    run_command(channel, f"syslog server {server_ip}:{port}")
    run_command(channel, f"syslog level {level}")
    run_command(channel, f"syslog protocol {protocol}")
    run_command(channel, "end")
    run_command(channel, "write memory")
```

### Configuration Snapshot & Diff

```python
def get_running_config(channel) -> str:
    """Fetch the current running configuration."""
    return run_command(channel, "show running-config")

def get_config_diff(channel) -> str:
    """Show differences between running and startup config."""
    return run_command(channel, "show running-config differences")

def backup_config_to_file(channel, sftp_url: str):
    """Back up configuration to a remote file via SFTP."""
    run_command(channel, f"backup {sftp_url}")
```

---

## Quick Reference: Most Useful Monitoring Commands

```bash
# Current devices on network (ARP table)
show ip neighbors

# Open connections (active TCP/UDP sockets)
show ip sockets

# Interface traffic counters (TX/RX bytes)
show interface

# DHCP static reservations
show ip dhcp-reservations

# Summary stats (CPU, memory, packets)
show stats

# System version
show version

# Syslog config
show syslog

# All interface statuses
show interface summary

# Routing table
show ip routes

# NTP sync status
show ntp

# Event history (JSON format, last 1 hour)
show history begin 1h first json:

# Speed test results
show speedtest

# Running vs startup config diff
show running-config differences

# VPN peer status
show vpns
```

---

## Error Handling Notes

- **`% Unknown command`** — check context (are you in config mode?), check spelling
- **`% Incomplete command`** — use `?` to see required arguments
- **`% Invalid input detected`** — argument type or range error
- **Config not persisting** — forgot to run `write memory`
- **Pager blocking output** — send `terminal length 0` first in any automated session
- **SSH host key rejection** — may need to clear known hosts or add `StrictHostKeyChecking=no` in paramiko
- **SSH rate-limiting** — The router's SSH daemon strictly enforces rate limits (`MaxStartups`). Launching multiple parallel one-shot connections or polling too rapidly will cause total SSH gridlock (yielding `EOF / Timeout` or `client is closing` errors on all subsequent attempts). To prevent this, always rely on long-lived persistent SSH sessions. If locked out, wait for the connection queue to decay naturally (often >5 minutes) or reboot the router.

---

## Discovery Data

Full discovery results (JSON with complete command tree) are available at:
- `scripts/cli_discovery_results.json` — structured command tree with descriptions
- `scripts/cli_commands_flat.txt` — flat text reference of all commands

Generated by `scripts/cli_discovery.py` on 2026-04-01 from router at 192.168.2.1.