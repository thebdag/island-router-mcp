---
name: island-router-cli
description: |
  Skill for managing an Island Router via its SSH CLI (firmware 2.3.2).
  Covers all CLI commands, session management, DHCP reservations, DNS/syslog configuration,
  device monitoring, VPN, SNMP, tcpdump, and automation patterns.
  Aligned with official Island Router CLI Reference Guide (260 pages, fw 2.3.2).
---

# Island Router CLI Skill

## Overview

The Island Router uses a **stateful CLI** accessible over SSH (port 22) or serial
console. Unlike Cisco IOS, the Island CLI has only **two real contexts**: a global
context and an interface context (entered via `interface <name>`).

> **Critical clarification from official guide:**
> - `configure terminal` is **unnecessary** — configuration commands can be entered at any time from the global prompt. The command is provided only for users familiar with systems that require it.
> - `end` exits **interface context** and returns to global context. It does NOT switch from "config mode" to "EXEC mode" — the Island CLI does not have a separate EXEC/config mode distinction.
> - The `no` prefix is used universally to undo or disable commands.

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
- Users without a password **cannot log in via SSH**
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

## CLI Contexts

The Island CLI has **two** contexts, not the four-level Cisco hierarchy:

| Prompt               | Context          | How to Enter                     |
| -------------------- | ---------------- | -------------------------------- |
| `Router>`            | Global (user)    | Login as `user` (read-only)      |
| `Router#`            | Global (admin)   | Login as `admin` (full access)   |
| `Router(config-if)#` | Interface        | `interface <name>`               |

**Navigate between contexts:**
```
interface ethernet1         # Enter interface context
end                         # Return to global context from interface context
exit                        # Move up one level / logout from global
```

> **Note:** `configure terminal` and `Router(config)#` are accepted for compatibility but are not meaningful distinctions. All configuration commands work directly from the global `Router#` prompt.

---

## Exhaustive Command Reference

> **Note:** This reference is aligned with the official Island Router CLI Reference Guide (firmware 2.3.2, 260 pages) and augmented with live CLI discovery from 2026-04-01.

### Session / Navigation

| Command                         | Context | Description                                   |
| ------------------------------- | ------- | --------------------------------------------- |
| `help`                          | Any     | Display help information                      |
| `?`                             | Any     | Context-sensitive help (list commands/params)  |
| `exit`                          | Any     | Exit current mode / logout                    |
| `end`                           | Iface   | Return to global context from interface       |
| `terminal length <0-512>`       | Global  | Set lines per page (0 = disable pager)        |
| `terminal width <0-512>`        | Global  | Set terminal column width                     |
| `terminal terminal-type <type>` | Global  | Set terminal type (e.g., `vt100`, `ansi`, `linux`) |

**Important for automation:** Set `terminal length 0` at session start to disable the pager.

---

### Configuration Mode Entry

| Command                           | Context | Description                                   |
| --------------------------------- | ------- | --------------------------------------------- |
| `configure terminal`              | Global  | No-op (config commands work from any context) |
| `configure network <url>`         | Global  | Load configuration from a network URL         |
| `configure authorized-keys [admin|user]` | Global | Edit SSH authorized keys (opens vim)   |
| `configure known-hosts`           | Global  | Edit SSH known hosts (opens vim)              |

> ⚠️ `configure authorized-keys` and `configure known-hosts` open the **vim text editor** and are NOT automatable over SSH.

---

### System / Device Management

| Command                      | Context | Description                                             |
| ---------------------------- | ------- | ------------------------------------------------------- |
| `hostname <name>`            | Global  | Set router hostname                                     |
| `description <text>`         | Iface   | Set interface description                               |
| `password admin [<password>]`| Global  | Set admin password (prompts if omitted)                 |
| `password user [<password>]` | Global  | Set read-only user password (prompts if omitted)        |
| `reload`                     | Global  | Reboot the router (⚠️ requires confirmation)            |
| `rollback`                   | Global  | Roll back to the previous saved configuration           |
| `compact`                    | Global  | Compact (defragment) the router's flash storage         |
| `led level <0-100>`          | Global  | Set LED brightness (0=off, 100=full, **default 100**)   |
| `mac output-format <format>` | Global  | Set MAC address display format template                 |
| `login confirm`              | Global  | Require confirmation before login                       |
| `login console`              | Global  | Configure console login settings                        |
| `login remote`               | Global  | Configure remote (SSH) login settings                   |
| `login support`              | Global  | Enable/disable Island support VPN access                |
| `show version`               | Global  | Show firmware version and system info                   |
| `show version history`       | Global  | Show firmware version update history                    |
| `show hardware`              | Global  | Show hardware details (model, serial, etc.)             |
| `show clock`                 | Global  | Display the current date and time                       |
| `show users`                 | Global  | Show currently logged-in users                          |
| `show free-space`            | Global  | Show available flash storage space                      |
| `show public-key`            | Global  | Display this router's public SSH key                    |
| `show running-config`        | Global  | Show the current (unsaved) running configuration        |
| `show running-config differences` | Global | Side-by-side diff of running vs startup config     |
| `show startup-config`        | Global  | Show the saved (startup) configuration                  |
| `show dumps`                 | Global  | List stored crash dumps                                 |
| `show packages`              | Global  | Show installed software packages                        |
| `show packages detail`       | Global  | Show detailed package information                       |

---

### Persistence

| Command               | Context | Description                                                        |
| --------------------- | ------- | ------------------------------------------------------------------ |
| `write memory`        | Global  | **Save running config to flash** (makes config persistent)         |
| `write terminal`      | Global  | Display running config to terminal (same as `show running-config`) |
| `write dump <url>`    | Global  | Copy crash dumps to a remote URL                                   |
| `write network <url>` | Global  | Copy running config to a remote URL                                |
| `write syslog <url>`  | Global  | Copy syslog to a remote URL                                        |

> **Critical:** `write memory` must be called after making any configuration changes that should survive a reboot. Changes made through the Island app also save automatically.

---

### Interface Configuration

| Command                                | Context  | Description                                               |
| -------------------------------------- | -------- | --------------------------------------------------------- |
| `interface <name>`                     | Global   | Enter interface context (e.g., `interface ethernet1`)     |
| `description <text>`                   | Iface    | Set a description for the interface                       |
| `duplex <auto|full|half>`              | Iface    | Set duplex mode for an ethernet interface                 |
| `speed <auto|10|100|1000>`             | Iface    | Set link speed for an ethernet interface                  |
| `parent <interface>`                   | Iface    | Set parent interface (for logical sub-interfaces/VLANs)   |
| `move <iface>`                         | Iface    | Move interface configuration to another interface         |
| `swap <iface>`                         | Iface    | Swap configurations between two interfaces                |
| `ethernet polling auto`                | Iface    | Enable automatic ethernet polling                         |
| `ethernet polling <1-n>`              | Iface    | Set number of cores for polled mode                       |
| `disable network`                      | Global   | Shut down all packet processing                           |
| `show interface`                       | Global   | Show detailed interface status and counters               |
| `show interface enX`                   | Global   | Show detail for specific interface (replace X)            |
| `show interface summary`               | Global   | Show a summary table of all interfaces                    |
| `show interface transceivers`          | Global   | Show SFP/transceiver module information                   |
| `show interface transceivers diagnostics` | Global | Show digital diagnostic monitoring details               |

---

### IP Configuration

**IP commands are valid ONLY in interface context** (after `interface <name>`):

| Command                                                     | Description                                                      |
| ----------------------------------------------------------- | ---------------------------------------------------------------- |
| `ip address <addr>[/<n>]`                                   | Set static IP (does NOT auto-set mode to manual)                 |
| `ip autoconfig <mode>`                                      | Set automatic IP configuration mode                              |
| `ip autovlan on|off`                                       | Enable/disable automatic VLAN discovery                          |
| `ip arp-scan on|off`                                       | Enable/disable ARP scanning                                      |
| `ip arp-spoof on|off`                                      | Enable/disable ARP spoofing (insert into existing network)       |
| `ip dhcp-client on|off`                                    | Enable/disable DHCP client                                       |
| `ip dhcp-server on|off`                                    | Enable/disable DHCP server                                       |
| `ip dhcp6-client on|off`                                   | Enable/disable DHCPv6 client                                     |
| `ip dhcp6-server on|off`                                   | Enable/disable DHCPv6 server                                     |
| `ip dhcp-lease <seconds>`                                   | Set DHCP lease time (**default 1800s / 30 minutes**)             |
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
| `ip ident4 on|off`                                         | Enable/disable IPv4 device fingerprinting (SSDP/mDNS)           |
| `ip ident6 on|off`                                         | Enable/disable IPv6 device fingerprinting (SSDP/mDNS)           |
| `ip idle <n>`                                               | Set idle time before purging an IP                               |
| `ip ipv6 on|off`                                           | Enable/disable global IPv6 support                               |
| `ip load-sharing dst-ip|random|src-dst-ip`                  | Set equal-cost multipath load balancing strategy                 |
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
| `ip router-solicit on|off`                                 | Enable/disable IPv6 Router Solicitation                          |

> **Defaults from official guide:**
> - Device fingerprinting (`ident4`/`ident6`): enabled on LAN, disabled on WAN
> - ARP spoofing: disabled
> - DHCP lease: 1800 seconds (30 minutes)

**Show commands for IP:**

| Command                                 | Description                                                          |
| --------------------------------------- | -------------------------------------------------------------------- |
| `show ip dhcp-reservations`             | **List all DHCP static reservations** (MAC → IP mappings)            |
| `show ip dhcp-reservations csv`         | List DHCP reservations in CSV format (parse-friendly)                |
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
| `no ip dns redirect <domain>`             | Remove DNS redirect for a specific domain                |
| `no ip dns redirect`                      | Remove all DNS redirects                                 |

**DNS over HTTPS providers (discovered):**
```
ip dns mode https cloudflare     # CloudFlare DoH
ip dns mode https google         # Google DoH
ip dns mode https opendns        # OpenDNS DoH
ip dns mode https <url>          # Custom DoH endpoint
```

> ⚠️ **DoH limitation:** Island will **never** intercept and respond to DNS over HTTPS (DoH) requests targeted to another server. To force all DNS through Island, block access to external DoH servers using Island's filtering capabilities.

#### DNS Redirect / Hostname Filtering

The `ip dns redirect` command is the **CLI-accessible mechanism for hostname-level filtering**. It redirects all DNS queries for a specific domain to a designated server IP. This enables two key use cases:

1. **Sinkhole / Block a domain** — redirect to `0.0.0.0` so the domain becomes unreachable
2. **Redirect to a custom server** — send queries to a Pi-hole, AdGuard, or other DNS filter

**Syntax:**
```
ip dns redirect <domain> <server-ip>
no ip dns redirect <domain>
```

**Examples — Blocking (sinkhole to 0.0.0.0):**
```
ip dns redirect facebook.com 0.0.0.0
ip dns redirect tiktok.com 0.0.0.0
ip dns redirect ads.doubleclick.net 0.0.0.0
write memory
```

**Examples — Redirecting to Pi-hole / AdGuard:**
```
ip dns redirect ads.example.com 192.168.2.50
ip dns redirect tracking.example.com 192.168.2.50
write memory
```

**Removing a redirect:**
```
no ip dns redirect facebook.com
write memory
```

**Viewing active redirects:**
Active DNS redirects appear in the running configuration:
```
show running-config
```
Look for lines matching: `ip dns redirect <domain> <server>`

> **Note:** The primary content filtering interface is the Island app (umbrellas, categories, custom hostname lists). The `ip dns redirect` CLI command provides a supplementary mechanism for per-domain DNS redirection that can be automated via SSH.

---

### Syslog / Logging

| Command                         | Context | Description                                                          |
| ------------------------------- | ------- | -------------------------------------------------------------------- |
| `syslog server <IP>[:<port>]`   | Global  | Set the remote syslog server IP (and optional port)                  |
| `no syslog server`              | Global  | Remove the external syslog server                                    |
| `syslog level <0-7>`            | Global  | Set minimum severity to forward (see table below)                    |
| `syslog protocol tcp|udp`       | Global  | Set transport protocol for syslog (default: UDP)                     |
| `show syslog`                   | Global  | Display the syslog configuration                                     |
| `show log [options...]`         | Global  | View local activity log entries (see syntax below)                   |
| `clear syslog <file>`           | Global  | Remove system log file                                               |
| `clear log`                     | Global  | Clear the activity log                                               |
| `write syslog <url>`            | Global  | Export syslog to a remote file URL                                   |

**Syslog severity levels (numeric, 0 = highest, 7 = lowest/default):**

| Level | Name                    | Description                             |
| ----- | ----------------------- | --------------------------------------- |
| 0     | Critical system failure | System is unusable                      |
| 1     | Critical unrecoverable  | Critical or unexpected unrecoverable    |
| 2     | Recoverable error       | Unexpected recoverable error            |
| 3     | Less severe error       | Less severe error                       |
| 4     | Warning                 | Warning conditions                      |
| 5     | Informational           | Informational messages                  |
| 6     | Debug                   | Debugging messages                      |
| 7     | Verbose debug           | Verbose debugging (default)             |

**`show log` — official full syntax:**
```
show log [all] [clear] [end] [kernel] [last] [module <modname>]
         [priority <level>] [utc] [wait] [where <string>]
```

| Option              | Description                                                |
| ------------------- | ---------------------------------------------------------- |
| `all`               | Show entire buffer instead of most recent                  |
| `clear`             | Clear buffer after displaying                              |
| `end`               | Start at end of buffer (implies `wait`)                    |
| `kernel`            | Show kernel log (all other options ignored)                 |
| `last`              | Show most recent entries                                   |
| `module <name>`     | Show entries from a specific software module               |
| `priority <level>`  | Show entries of specified severity or higher               |
| `utc`               | Show times in UTC                                          |
| `wait`              | Wait for new records (tail mode, Ctrl-C to abort)          |
| `where <string>`    | Filter by string or **regular expression**                 |

**Options are combinable:**
```
show log all utc where "error"     # All entries in UTC matching "error"
show log last priority 4           # Recent warnings and above
show log kernel wait               # Tail kernel log
show log module dhcpd              # Entries from DHCP module only
```

**Example — forward logs to Raspberry Pi running rsyslog/Loki:**
```
syslog server 192.168.2.50
syslog level 5
syslog protocol udp
write memory
```

---

### Event History

The router maintains structured event history that can be queried and exported.

**Querying history (`show history`):**

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

### History Instance Management (ETL/Export)

The `history` command manages **named instances** for automated event logging and export to remote servers. This is a powerful feature for ETL pipelines.

**Syntax:** `[no] history <instance> <command>`

| Command                                      | Description                                          |
| -------------------------------------------- | ---------------------------------------------------- |
| `history <name> interval <seconds>`          | Enable logging and set file rotation (min 60s)       |
| `history <name> filter <string>`             | Filter events by field/op/value expressions          |
| `history <name> output-format <format>`      | Set format: all, csv, syslog, usyslog, json, raw     |
| `history <name> url <URL>`                   | Set upload destination (sftp://, scp://, etc.)       |
| `history <name> utc`                         | Use UTC timestamps for files and records             |
| `history <name> rename <new-name>`           | Rename the instance                                  |
| `history <name> empty`                       | Truncate the current history file                    |
| `no history <name>`                          | Delete the instance                                  |

**Default:** History files are NOT written by default. You must set an `interval` to enable.

**Filter syntax:** `<field><op><value>[<conj>...]`
- Fields: event type, MAC, host, category, etc.
- Operators: `=`, `!=`, `<`, `>`, etc.

**Output format options:**

| Format    | Description                           |
| --------- | ------------------------------------- |
| `all`     | All attributes in "tag=value" format  |
| `csv`     | All attributes in CSV format          |
| `syslog`  | Structured syslog                     |
| `usyslog` | Unstructured syslog                   |
| `json`    | JSON format                           |
| `raw`     | Raw binary                            |
| Custom    | Printf-style format string            |

**Example — set up automated JSON history export:**
```
history myexport interval 3600
history myexport output-format json
history myexport url sftp://user:pass@192.168.2.50/history/
history myexport utc
write memory
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
| `ntp <address>...`       | Global  | Set NTP server address(es)                                  |
| `no ntp`                 | Global  | Remove NTP server                                           |
| `timezone <country|spec>`| Global  | Set timezone (2-letter country code or timezone name)       |
| `show ntp`               | Global  | Display NTP configuration                                   |
| `show ntp associations`  | Global  | Show NTP peer associations                                  |
| `show ntp status`        | Global  | Show NTP synchronization status                             |
| `show clock`             | Global  | Display current system time                                 |

---

### Statistics & Monitoring

| Command                              | Description                                                     |
| ------------------------------------ | --------------------------------------------------------------- |
| `show stats`                         | Show hardware/packet summary                                    |
| `show stats <component> [<params>]`  | Show component-specific diagnostics (use `show stats ?`)        |
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
| `ssh [<user>@]<host> [<command>]`    | Open an SSH connection (or run remote command)                  |

> **`show stats` note:** This command is primarily for diagnostic use by Island support. Supported components and parameters are subject to change.

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

| Command                           | Context | Description                                      |
| --------------------------------- | ------- | ------------------------------------------------ |
| `backup url <URL>`                | Global  | Set automatic backup upload URL                  |
| `backup days <days>`              | Global  | Set days of history to include in backup         |
| `backup interval <secs>`          | Global  | Set backup interval (**default 3600s / 1 hour**) |
| `auto-update days <day>...`       | Global  | Set days for automatic updates                   |
| `auto-update time <hh:mm>`        | Global  | Set time for automatic updates                   |
| `show packages`                   | Global  | Show installed packages and versions             |
| `show packages detail`            | Global  | Show detailed package information                |
| `update`                          | Global  | Trigger a firmware update                        |
| `clear update`                    | Global  | Clear pending update state                       |
| `rollback`                        | Global  | Roll back to previous firmware/config            |

**Defaults from official guide:**
- Auto-update: **3:00 AM local time, any day of the week**
- Backup interval: **3600 seconds (1 hour)**

**Auto-update day values:** `all`, `none`, `sunday`, `monday`, `tuesday`, `wednesday`, `thursday`, `friday`, `saturday`. Multiple days are specified positionally.

**Firmware update impact note:** Updates may or may not interrupt packet routing. Some updates don't interrupt at all, some cause a short (5-10 second) interruption, and some may require a full reboot.

---

### Installable Packages

Island supports installable software packages to add features not included in the base firmware:

| Command                          | Context | Description                           |
| -------------------------------- | ------- | ------------------------------------- |
| `package <name> <param> <value>` | Global  | Set package configuration parameter   |
| `clear package <name>`           | Global  | Remove an installed package           |
| `show packages`                  | Global  | List installed packages               |
| `show packages detail`           | Global  | Detailed package info                 |

---

### VPN (WireGuard)

| Command                                  | Context | Description                                    |
| ---------------------------------------- | ------- | ---------------------------------------------- |
| `vpn key-exchange <host> <secret>`       | Global  | Exchange public keys with peer                 |
| `vpn peer <n|auto> ...`                  | Global  | Define/configure a VPN peer (ID 0-1022)        |
| `vpn peer <id> remote-ip <addr>`         | Global  | Set peer remote IP (v4 or v6)                  |
| `vpn peer <id> local-ip <addr>`          | Global  | Set peer local IP                              |
| `vpn peer <id> route <prefix>`           | Global  | Add route through peer                         |
| `vpn peer <id> shutdown`                 | Global  | Disable a VPN peer                             |
| `vpn peer <id> unapproved`              | Global  | Mark peer as unapproved (auto-trust feature)   |
| `vpn peer <id> visible on|off`           | Global  | Set peer visibility                            |
| `vpn port <n>`                           | Global  | Set WireGuard UDP port (**default 51820**)      |
| `vpn renumber`                           | Global  | Renumber pool assignments                      |
| `vpn route <addr/bits>`                  | Global  | Specify manual VPN route                       |
| `vpn sort`                               | Global  | Sort peers by name                             |
| `vpn server auto-trust on|off`           | Global  | Auto-trust new VPN peers (IslandExpress)       |
| `vpn server auto-visible on|off`         | Global  | Make VPN server auto-visible                   |
| `vpn server force-nat on|off`            | Global  | Force NAT for VPN traffic                      |
| `vpn server no-local`                    | Global  | Disable local network access via VPN           |
| `vpn server pool`                        | Global  | Configure VPN address pool                     |
| `vpn server secret <secret>`             | Global  | Set VPN server shared secret                   |
| `show vpns`                              | Global  | Show VPN status and peer list                  |
| `show vpns <iface|mac>`                  | Global  | Show VPN status for specific peer              |
| `clear vpn-keys`                         | Global  | Clear all VPN keys                             |

---

### SNMP

| Command                                                          | Context | Description                          |
| ---------------------------------------------------------------- | ------- | ------------------------------------ |
| `snmp-server community <name>`                                   | Global  | Define SNMP community name           |
| `snmp-server contact <string>`                                   | Global  | Set system contact string            |
| `snmp-server location <string>`                                  | Global  | Set system location string           |
| `snmp-server engineID <hex>`                                     | Global  | Set SNMPv3 engine ID                 |
| `snmp-server host <host> v1|v2c|v3 ...`                         | Global  | Configure trap host                  |
| `snmp-server user <name> [MD5|SHA <auth> [AES|DES [<priv>]]]`   | Global  | Configure SNMPv3 user                |
| `snmp-server notifications all`                                  | Global  | Enable all notification types        |
| `snmp-server notifications cpuUtilization <threshold>`           | Global  | CPU utilization notifications        |
| `snmp-server notifications ipLimitExceeded <threshold>`          | Global  | IP limit exceeded notifications      |
| `snmp-server notifications linkUpDown`                           | Global  | Link up/down notifications           |
| `snmp-server notifications psu`                                  | Global  | Power supply notifications           |
| `no snmp-server`                                                 | Global  | Remove SNMP configuration            |

---

### Packet Capture (tcpdump)

| Command                    | Context | Description                          |
| -------------------------- | ------- | ------------------------------------ |
| `tcpdump`                  | Global  | Start packet capture                 |
| `tcpdump count <n>`        | Global  | Stop after `<n>` packets             |
| `tcpdump filter <spec>`    | Global  | Apply BPF filter specification       |
| `tcpdump hex`              | Global  | Include hex dump in output           |
| `tcpdump interface <name>` | Global  | Capture on specific interface        |
| `tcpdump pager`            | Global  | Use pager for output                 |
| `tcpdump read <file>`      | Global  | Read from capture file               |
| `tcpdump verbose`          | Global  | Increase capture verbosity           |
| `tcpdump write <file>`     | Global  | Write capture to file                |

**Example:**
```
tcpdump interface ethernet1 count 100 filter "port 53"
```

---

### SSH & Security

| Command                           | Context | Description                                    |
| --------------------------------- | ------- | ---------------------------------------------- |
| `show config authorized-keys`     | Global  | Show configured SSH authorized keys            |
| `show config authorized-keys admin` | Global | Show admin user's authorized keys              |
| `show config authorized-keys user`  | Global | Show read-only user's authorized keys          |
| `show config email`               | Global  | Show email notification addresses              |
| `show config known-hosts`         | Global  | Show SSH known hosts                           |
| `show ssh-client-keys`            | Global  | Show SSH client key pairs                      |
| `show ssh-client-keys detail`     | Global  | Show detailed SSH client keys                  |
| `configure authorized-keys [admin|user]` | Global | Edit authorized_keys via vim (⚠️ interactive) |
| `configure known-hosts`           | Global  | Edit known_hosts via vim (⚠️ interactive)      |
| `clear ssh host-key [ed25519|rsa]` | Global | Regenerate SSH host keys                       |
| `clear ssh known-hosts`           | Global  | Clear SSH known hosts list                     |

---

### DHCP Reservations

DHCP reservations permanently bind a MAC address to an IP address:

```
# Reserve IP for a device by MAC (from global prompt, no configure terminal needed)
ip dhcp-reserve aa:bb:cc:dd:ee:ff 192.168.2.100 my-device-name

# Multiple devices
ip dhcp-reserve 11:22:33:44:55:66 192.168.2.101 raspberry-pi
ip dhcp-reserve aa:bb:cc:11:22:33 192.168.2.102 laptop

# Save
write memory
```

```
# View all reservations
show ip dhcp-reservations
show ip dhcp-reservations csv    # CSV format for parsing
```

---

### Packet / Debug

| Command              | Context | Description                      |
| -------------------- | ------- | -------------------------------- |
| `packet level <n>`   | Global  | Set packet processing verbosity  |
| `show dumps`         | Global  | List stored crash dumps          |
| `write dump <url>`   | Global  | Export crash dumps to remote URL |

---

### Clear (Reset) Commands

> ⚠️ Some of these commands are destructive and require confirmation.

| Command             | Description                                          |
| ------------------- | ---------------------------------------------------- |
| `clear everything`  | **Factory reset** — erase all configuration and data |
| `clear network`     | Clear all network configuration                      |
| `clear connections` | Drop all active firewall state table entries          |
| `clear log`         | Clear the local event log                            |
| `clear dhcp-client` | Release and clear DHCP client state                  |
| `clear dump [<file>]` | Delete stored crash dumps                          |
| `clear package <name>` | Remove an installed package                       |
| `clear pin`         | Remove the access PIN                                |
| `clear ssh host-key [ed25519|rsa]` | Regenerate SSH host keys            |
| `clear ssh known-hosts` | Clear SSH known hosts                            |
| `clear syslog <file>` | Remove system log file                             |
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
no history <instance>             # Delete a history instance
```

---

## Automation Patterns (Python / paramiko)

### Key Rules
1. Use `invoke_shell()` — not `exec_command()` — to maintain CLI state.
2. Send `terminal length 0\n` immediately after connecting to disable paging.
3. Wait for the prompt string (`Router#`, `Router(config-if)#`) before sending next command.
4. Read output in a loop, watching for both prompt and `--More--`.
5. Call `write memory\n` after any config change to persist it.
6. **Do NOT use `configure terminal`** — configuration commands work directly from the global prompt.

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
    cmd = f"ip dhcp-reserve {mac} {ip}"
    if hostname:
        cmd += f" {hostname}"
    run_command(channel, cmd)
    run_command(channel, "write memory")

def list_dhcp_reservations(channel) -> str:
    """Return raw output of all current DHCP reservations."""
    return run_command(channel, "show ip dhcp-reservations")
```

### Syslog Configuration Automation

```python
def configure_syslog(channel, server_ip: str, port: int = 514,
                     level: int = 7, protocol: str = "udp"):
    """Configure the router to forward logs to an external syslog server.
    
    Level is numeric 0-7:
      0=critical, 1=critical-unrecoverable, 2=recoverable-error,
      3=less-severe, 4=warning, 5=informational, 6=debug, 7=verbose-debug
    """
    run_command(channel, f"syslog server {server_ip}:{port}")
    run_command(channel, f"syslog level {level}")
    run_command(channel, f"syslog protocol {protocol}")
    run_command(channel, "write memory")
```

### Configuration Snapshot & Diff

```python
def get_running_config(channel) -> str:
    """Fetch the current running configuration."""
    return run_command(channel, "show running-config")

def get_config_diff(channel) -> str:
    """Show side-by-side diff of running vs startup config."""
    return run_command(channel, "show running-config differences")

def backup_config_to_file(channel, sftp_url: str):
    """Back up configuration to a remote file via SFTP."""
    run_command(channel, f"backup url {sftp_url}")
    run_command(channel, "write memory")
```

### History ETL Export Setup

```python
def setup_history_export(channel, name: str, url: str,
                          interval: int = 3600, fmt: str = "json"):
    """Configure automated history export to a remote server."""
    run_command(channel, f"history {name} interval {interval}")
    run_command(channel, f"history {name} output-format {fmt}")
    run_command(channel, f"history {name} url {url}")
    run_command(channel, f"history {name} utc")
    run_command(channel, "write memory")
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

# DHCP static reservations (CSV for parsing)
show ip dhcp-reservations csv

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
show ntp status

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

- **`% Unknown command`** — check context (are you in interface mode?), check spelling
- **`% Incomplete command`** — use `?` to see required arguments
- **`% Invalid input detected`** — argument type or range error
- **Config not persisting** — forgot to run `write memory`
- **Pager blocking output** — send `terminal length 0` first in any automated session
- **SSH host key rejection** — may need to clear known hosts or add `StrictHostKeyChecking=no` in paramiko
- **SSH rate-limiting** — The router's SSH daemon strictly enforces rate limits (`MaxStartups`). Launching multiple parallel one-shot connections or polling too rapidly will cause total SSH gridlock (yielding `EOF / Timeout` or `client is closing` errors on all subsequent attempts). To prevent this, always rely on long-lived persistent SSH sessions. If locked out, wait for the connection queue to decay naturally (often >5 minutes) or reboot the router.

---

## Default Values Reference (from Official Guide)

| Parameter         | Default Value                        |
| ----------------- | ------------------------------------ |
| DHCP lease time   | 1800 seconds (30 minutes)            |
| Backup interval   | 3600 seconds (1 hour)                |
| Auto-update time  | 3:00 AM local time                   |
| Auto-update days  | All days                             |
| VPN (WireGuard) port | 51820                             |
| LED brightness    | 100 (full)                           |
| Syslog level      | 7 (verbose debug — all messages)     |
| SSH default user  | admin                                |

---

## Discovery Data

Full discovery results (JSON with complete command tree) are available at:
- `scripts/cli_discovery_results.json` — structured command tree with descriptions
- `scripts/cli_commands_flat.txt` — flat text reference of all commands

Generated by `scripts/cli_discovery.py` on 2026-04-01 from router at 192.168.2.1.
Reference aligned with official Island Router CLI Reference Guide (firmware 2.3.2).