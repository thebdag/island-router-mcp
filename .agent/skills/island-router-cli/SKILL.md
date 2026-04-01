---
name: island-router-cli
description: |
  Skill for managing an Island Router via its Cisco-style SSH CLI (firmware 2.3.2).
  Covers all CLI commands, session management, DHCP reservations, DNS/syslog configuration,
  device monitoring, VPN, and automation patterns using paramiko.
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
- `ROUTER_HOST` — defaults to `192.168.2.1`
- `ROUTER_PASS` — admin password (never hardcode)

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

## Command Reference

### Session / Navigation

| Command                         | Context | Description                                   |
| ------------------------------- | ------- | --------------------------------------------- |
| `help`                          | Any     | Display help information                      |
| `?`                             | Any     | Context-sensitive help (list commands/params) |
| `exit`                          | Any     | Exit current mode / logout                    |
| `end`                           | Config  | Return to privileged EXEC                     |
| `history`                       | Any     | Manage command history                        |
| `show history`                  | EXEC    | Display command history for current session   |
| `terminal length <0-512>`       | EXEC    | Set lines per page (0 = disable pager)        |
| `terminal width <0-512>`        | EXEC    | Set terminal column width                     |
| `terminal terminal-type <type>` | EXEC    | Set terminal type (e.g., `vt100`)             |

**Important for automation:** Set `terminal length 0` at session start to disable the pager:
```
terminal length 0
```

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
| `password <old> <new>`       | EXEC            | Change current user's password                          |
| `reload`                     | Privileged EXEC | Reboot the router (⚠️ requires confirmation)             |
| `rollback`                   | Privileged EXEC | Roll back to the previous saved configuration           |
| `compact`                    | Privileged EXEC | Compact (defragment) the router's flash storage         |
| `led level <0-3>`            | Config          | Set LED brightness level (0=off, 3=brightest)           |
| `mac output-format <format>` | Config          | Set MAC address display format (`colon`, `dot`, `dash`) |
| `login confirm`              | Config          | Require confirmation before login                       |
| `login console`              | Config          | Configure console login settings                        |
| `login remote`               | Config          | Configure remote (SSH) login settings                   |
| `login support`              | Config          | Enable/disable Island support access                    |
| `show version`               | EXEC            | Show firmware version and system info                   |
| `show hardware`              | EXEC            | Show hardware details (model, serial, etc.)             |
| `show clock`                 | EXEC            | Display the current date and time                       |
| `show users`                 | EXEC            | Show currently logged-in users                          |
| `show free-space`            | EXEC            | Show available flash storage space                      |
| `show public-key`            | EXEC            | Display this router's public SSH key                    |
| `show running-config`        | EXEC            | Show the current (unsaved) running configuration        |
| `show startup-config`        | EXEC            | Show the saved (startup) configuration                  |
| `show history`               | EXEC            | Display command history                                 |
| `show dumps`                 | EXEC            | List stored crash dumps                                 |
| `show packages`              | EXEC            | Show installed software packages                        |

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

| Command                       | Context          | Description                                               |
| ----------------------------- | ---------------- | --------------------------------------------------------- |
| `interface <name>`            | Config           | Enter interface config mode (e.g., `interface ethernet1`) |
| `description <text>`          | Interface Config | Set a description for the interface                       |
| `duplex <auto                 | full             | half>`                                                    | Interface Config | Set duplex mode for an ethernet interface |
| `speed <auto                  | 10               | 100                                                       | 1000>`           | Interface Config                          | Set link speed for an ethernet interface |
| `parent <interface>`          | Interface Config | Set parent interface (for logical sub-interfaces)         |
| `ethernet polling`            | Interface Config | Configure ethernet polling behavior                       |
| `show interface`              | EXEC             | Show detailed interface status and counters               |
| `show interface summary`      | EXEC             | Show a summary table of all interfaces                    |
| `show interface transceivers` | EXEC             | Show SFP/transceiver module information                   |

**IP (Interface Context)** — configured after `interface <name>`:

| Command                            | Description                                       |
| ---------------------------------- | ------------------------------------------------- |
| `ip address <addr> <mask>`         | Set a static IP on this interface                 |
| `ip address dhcp`                  | Configure interface to get IP via DHCP            |
| `ip nat outside` / `ip nat inside` | Mark interface as NAT outside/inside              |
| `ip mtu <size>`                    | Set the MTU for this interface                    |
| `ip router-solicit`                | Enable IPv6 router solicitation on this interface |
| `ip ipv6 address <addr/prefix>`    | Set a static IPv6 address on this interface       |
| `show ip interface`                | Show IP configuration per interface               |

---

### Network / IP (Global Context)

These commands configure network-wide parameters from `configure terminal`:

| Command                                                  | Description                                                        |
| -------------------------------------------------------- | ------------------------------------------------------------------ |
| `ip dhcp-reserve <mac> <ip> [<hostname>]`                | **Create a DHCP reservation** — pin a MAC address to a specific IP |
| `no ip dhcp-reserve <mac>`                               | Remove a DHCP reservation                                          |
| `ip dns mode <mode>`                                     | Set DNS mode (`auto`, `manual`, `dhcp`)                            |
| `ip dns local-only`                                      | Enable local-only DNS mode (no forwarding)                         |
| `no ip dns local-only`                                   | Disable local-only DNS mode                                        |
| `ip firewall <on                                         | off>`                                                              | Enable or disable the built-in firewall |
| `ip ipv6 <on                                             | off>`                                                              | Enable or disable IPv6 globally         |
| `ip load-sharing`                                        | Configure load-sharing across multiple WAN connections             |
| `ip max-clients <n>`                                     | Set maximum DHCP clients                                           |
| `ip port-forward <proto> <ext-port> <int-ip> <int-port>` | Add a port-forwarding rule                                         |
| `no ip port-forward <proto> <ext-port>`                  | Remove a port-forwarding rule                                      |
| `ip route <dest> <mask> <gateway>`                       | Add a static route                                                 |
| `no ip route <dest> <mask>`                              | Remove a static route                                              |
| `ip ddns name <hostname>`                                | Configure Dynamic DNS hostname                                     |
| `ip ddns ipv6 <on                                        | off>`                                                              | Enable/disable IPv6 for DDNS            |

**Show commands for IP:**

| Command                     | Description                                                          |
| --------------------------- | -------------------------------------------------------------------- |
| `show ip dhcp-reservations` | **List all DHCP static reservations** (MAC → IP mappings)            |
| `show ip interface`         | Show IP address information for each interface                       |
| `show ip neighbors`         | **Show ARP/neighbor table** — lists devices by IP and MAC with state |
| `show ip routes`            | Show the routing table                                               |
| `show ip sockets`           | **Show active local IP sockets** (open connections/listeners)        |
| `show ip recommendations`   | Show IP configuration recommendations                                |

---

### DNS / Ad Blocking

The router supports DNS mode configuration. For ad blocking via DNS sinkhole:

```
# Point DNS resolver to a local Pi-hole / AdGuard Home
configure terminal
  ip dns mode manual
  # Set upstream DNS to local sinkhole (typically via port-forward or router config)
  ip dns local-only         # optional: prevent DNS leaks
end
write memory
```

> **Note:** The Island Router does not have a native hosts-file or DNS block-list feature. The recommended approach is to set a local sinkhole (e.g., Pi-hole at 192.168.2.x) as the DNS server via the DHCP or DNS settings, or point `ip dns` to a custom resolver.

---

### DHCP Reservations

DHCP reservations permanently bind a MAC address to an IP address, making devices identifiable:

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
```

---

### Syslog / Logging

The `syslog` command group configures forwarding to an external syslog server:

| Command                       | Context         | Description                                                                                 |
| ----------------------------- | --------------- | ------------------------------------------------------------------------------------------- |
| `syslog server <ip> [<port>]` | Config          | Set the remote syslog server IP (and optional port)                                         |
| `no syslog server`            | Config          | Remove the external syslog server                                                           |
| `syslog level <level>`        | Config          | Set minimum severity to forward (`debug`, `info`, `notice`, `warning`, `error`, `critical`) |
| `syslog protocol <udp         | tcp>`           | Config                                                                                      | Set transport protocol for syslog (default: UDP) |
| `show syslog`                 | EXEC            | Display the syslog configuration                                                            |
| `show log`                    | EXEC            | View local log entries                                                                      |
| `clear syslog`                | EXEC            | Clear the in-memory syslog buffer                                                           |
| `write syslog <url>`          | Privileged EXEC | Export syslog to a remote file URL                                                          |

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

### NTP / Time

| Command         | Context    | Description                                    |
| --------------- | ---------- | ---------------------------------------------- |
| `ntp server <ip | hostname>` | Config                                         | Set NTP server |
| `no ntp server` | Config     | Remove NTP server                              |
| `timezone <tz>` | Config     | Set system timezone (e.g., `America/New_York`) |
| `show ntp`      | EXEC       | Display NTP status and configuration           |
| `show clock`    | EXEC       | Display current system time                    |

---

### Statistics & Monitoring

| Command                  | Description                                                      |
| ------------------------ | ---------------------------------------------------------------- |
| `show stats`             | Show a hardware/packet summary (default, no args)                |
| `show stats <component>` | Show component-specific diagnostics (use `show stats ?` to list) |
| `show ip sockets`        | List active local IP sockets (TCP/UDP listeners and connections) |
| `show ip neighbors`      | ARP neighbor table — IP, MAC, interface, and state               |
| `show ip routes`         | Show current routing table                                       |
| `show interface`         | Detailed per-interface stats including TX/RX bytes, errors       |
| `show interface summary` | Brief table of all interface states                              |
| `show hardware`          | Hardware info (model, serial number, temps)                      |
| `show version`           | Firmware version string                                          |
| `ping <ip                | hostname>`                                                       | Send ICMP ping from the router |
| `telnet <ip> [<port>]`   | Open a telnet connection from the router                         |
| `ssh <user>@<host>`      | Open an SSH connection from the router                           |

> **For data usage reporting:** `show ip sockets` and `show interface` are the primary sources. Parse TX/RX byte counters per-interface and correlate with `show ip neighbors` for per-device attribution.

---

### Backup / Restore

| Command                       | Context         | Description                                      |
| ----------------------------- | --------------- | ------------------------------------------------ |
| `backup <url>`                | Privileged EXEC | Backup full router configuration to a remote URL |
| `backup restore <url>`        | Privileged EXEC | Restore a configuration from a remote URL        |
| `auto-update check`           | Privileged EXEC | Check for available firmware updates             |
| `auto-update enable`          | Config          | Enable automatic updates                         |
| `auto-update disable`         | Config          | Disable automatic updates                        |
| `auto-update schedule <cron>` | Config          | Set auto-update schedule (cron-like syntax)      |
| `show packages`               | EXEC            | Show installed packages and versions             |
| `update`                      | Privileged EXEC | Trigger a firmware update                        |
| `clear update`                | Privileged EXEC | Clear pending update state                       |
| `rollback`                    | Privileged EXEC | Roll back to previous firmware/config            |

---

### VPN

| Command                      | Context         | Description                               |
| ---------------------------- | --------------- | ----------------------------------------- |
| `vpn key-exchange <type>`    | Config          | Set VPN key exchange type (e.g., `ikev2`) |
| `vpn peer <name>`            | Config          | Define a VPN peer                         |
| `vpn port <port>`            | Config          | Set VPN UDP port                          |
| `vpn renumber`               | Config          | Renumber VPN peer indices                 |
| `vpn route <peer> <network>` | Config          | Add a route via a VPN peer                |
| `vpn server`                 | Config          | Configure VPN server settings             |
| `vpn sort`                   | Config          | Sort VPN peer list                        |
| `show vpns`                  | EXEC            | Show VPN status and peer list             |
| `clear vpn-keys`             | Privileged EXEC | Clear all VPN keys                        |

---

### SSH & Security

| Command                           | Context         | Description                         |
| --------------------------------- | --------------- | ----------------------------------- |
| `show config authorized-keys`     | EXEC            | Show configured SSH authorized keys |
| `show config known-hosts`         | EXEC            | Show SSH known hosts                |
| `show ssh-client-keys`            | EXEC            | Show SSH client key pairs           |
| `configure authorized-keys <url>` | Privileged EXEC | Load authorized_keys from a URL     |
| `configure known-hosts <url>`     | Privileged EXEC | Load known_hosts from a URL         |
| `clear ssh client-keys`           | Privileged EXEC | Clear SSH client key cache          |
| `clear ssh host-keys`             | Privileged EXEC | Clear SSH host keys                 |
| `clear ssh known-hosts`           | Privileged EXEC | Clear SSH known hosts list          |

**Password encryption:** The router stores passwords in an encrypted form in the config. Use `password <oldpass> <newpass>` to change — never store plaintext in scripts; use environment variables.

---

### Packet / Debug

| Command              | Context         | Description                      |
| -------------------- | --------------- | -------------------------------- |
| `packet level <0-5>` | Config/EXEC     | Set packet capture/debug level   |
| `show dumps`         | EXEC            | List stored crash dumps          |
| `write dump <url>`   | Privileged EXEC | Export crash dumps to remote URL |

---

### Dangerous / Destructive Commands

> ⚠️ These commands require explicit user confirmation before execution.

| Command             | Description                                          |
| ------------------- | ---------------------------------------------------- |
| `clear everything`  | **Factory reset** — erase all configuration and data |
| `clear network`     | Clear all network configuration                      |
| `clear connections` | Drop all active connections                          |
| `clear log`         | Clear the local event log                            |
| `clear dhcp-client` | Release and clear DHCP client state                  |
| `clear dump`        | Delete stored crash dumps                            |
| `clear package`     | Clear package cache                                  |
| `clear pin`         | Clear stored PIN                                     |
| `reload`            | Reboot the router                                    |

---

### Misc Configuration Commands

| Command                  | Context         | Description                |
| ------------------------ | --------------- | -------------------------- |
| `package install <name>` | Config          | Install a software package |
| `package remove <name>`  | Config          | Remove a software package  |
| `clear package`          | Privileged EXEC | Clear package cache        |

---

## Command Scheduler

The router supports scheduled commands using a cron-like syntax. Schedules are calculated based on wall-clock time at the time of arm, with intervals applied from that moment.

From configuration mode:
```
# Example: auto-update on a schedule
auto-update schedule 0 3 * * *   # run at 3am daily
```

Intervals are relative to when the scheduler arms — e.g., if you set `every 1 hour` at 1:30pm, it fires at 2:30pm, 3:30pm, etc.

---

## Automation Patterns (Python / paramiko)

### Key Rules
1. Use `invoke_shell()` — not `exec_command()` — to maintain CLI state.
2. Send `terminal length 0\n` immediately after connecting to disable paging.
3. Wait for the prompt string (`Router#`, `Router(config)#`) before sending next command.
4. Read output in a loop, watching for both prompt and `--More--`.
5. Call `write memory\n` after any config change to persist it.

### Device Data Usage Reporting

To get per-device bandwidth data, poll these commands and parse:

```python
# Neighbors (ARP table) — cross-reference MACs to IPs
output = run_command(channel, "show ip neighbors")

# Interface byte counters — parse TX/RX bytes per interface
output = run_command(channel, "show interface")

# Active socket connections — per-connection view
output = run_command(channel, "show ip sockets")

# System-wide stats summary
output = run_command(channel, "show stats")
```

Parse strategy:
- `show ip neighbors` → maps `{ip: mac}` so you can correlate with DHCP reservations
- `show interface` → provides cumulative TX/RX byte counters per physical interface
- Diff counter snapshots between polls to compute delta (bytes/sec or bytes/period)

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
    run_command(channel, f"syslog server {server_ip} {port}")
    run_command(channel, f"syslog level {level}")
    run_command(channel, f"syslog protocol {protocol}")
    run_command(channel, "end")
    run_command(channel, "write memory")
```

### DNS Configuration for Ad Blocking

```python
def configure_sinkhole_dns(channel, sinkhole_ip: str):
    """
    Point the router's DNS resolver to a local sinkhole (Pi-hole / AdGuard).
    The sinkhole_ip should be a device on the LAN.
    """
    run_command(channel, "configure terminal")
    run_command(channel, "ip dns mode manual")
    # Note: Actual upstream DNS server setting depends on router's specific
    # DNS configuration options — use 'ip dns ?' for current firmware options.
    run_command(channel, "end")
    run_command(channel, "write memory")
```

### Configuration Snapshot & Diff

```python
def get_running_config(channel) -> str:
    """Fetch the current running configuration."""
    return run_command(channel, "show running-config")

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
```

---

## Error Handling Notes

- **`% Unknown command`** — check context (are you in config mode?), check spelling
- **`% Incomplete command`** — use `?` to see required arguments
- **`% Invalid input detected`** — argument type or range error
- **Config not persisting** — forgot to run `write memory`
- **Pager blocking output** — send `terminal length 0` first in any automated session
- **SSH host key rejection** — may need to clear known hosts or add `StrictHostKeyChecking=no` in paramiko