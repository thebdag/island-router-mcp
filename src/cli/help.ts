/** Per-command help text for island-axi (AXI principle 10). */

export const TOP_LEVEL_HELP = `island-axi — Agent-friendly Island Router CLI (AXI)

USAGE
  island-axi [--help] [--version]
  island-axi <command> [flags]

COMMANDS
  devices          List configured devices (no SSH)
  status           Compact router overview
  interfaces       Interface summary (use --detail for TX/RX)
  neighbors        ARP / neighbor table
  routes           Routing table
  logs             Recent log entries + syslog config
  config           Running-config (truncated; --full for complete)
  config-diff      Running vs startup config differences
  vpns             VPN peer status
  dhcp             DHCP reservations
  ntp              NTP config + sync status
  dns-redirects    DNS redirect / sinkhole rules
  ping             ICMP ping from the router
  show             Run an allowlisted show command
  configure        Write operations (requires --confirm)
  setup            Install agent session hooks

GLOBAL FLAGS
  --device <id>    Target device from inventory (default: first)
  --help           Concise help for a command
  --version        Print version

EXAMPLES
  island-axi
  island-axi neighbors --device island-edge-1
  island-axi ping 1.1.1.1
  island-axi configure set-hostname --hostname edge1 --confirm
`;

export const COMMAND_HELP: Record<string, string> = {
  devices: `island-axi devices

List devices from devices.json / env inventory. No SSH.

FLAGS
  (none)

EXAMPLES
  island-axi devices
`,

  status: `island-axi status [--device <id>]

Compact overview: version, interface up/down counts, route count, neighbor count.

FLAGS
  --device <id>   Device id (default: first inventory entry)

EXAMPLES
  island-axi status
  island-axi status --device island-edge-1
`,

  interfaces: `island-axi interfaces [--device <id>] [--detail] [--fields name,status,protocol]

List interfaces. Default fields: name, status, protocol, description.

FLAGS
  --device <id>
  --detail           Include TX/RX byte counters (slower)
  --fields <list>    Comma-separated fields

EXAMPLES
  island-axi interfaces
  island-axi interfaces --detail --fields name,status,txBytes,rxBytes
`,

  neighbors: `island-axi neighbors [--device <id>] [--fields ip,mac,interface,state] [--limit N]

ARP / neighbor table. Default fields: ip, mac, interface, state.

FLAGS
  --device <id>
  --fields <list>
  --limit <n>        Max rows (default 100)

EXAMPLES
  island-axi neighbors
  island-axi neighbors --limit 20
`,

  routes: `island-axi routes [--device <id>] [--fields destination,gateway,interface,type] [--limit N]

Routing table. Default fields: destination, gateway, interface, type.

FLAGS
  --device <id>
  --fields <list>
  --limit <n>

EXAMPLES
  island-axi routes
`,

  logs: `island-axi logs [--device <id>] [--limit N] [--full]

Recent log entries + syslog config. Messages truncated unless --full.

FLAGS
  --device <id>
  --limit <n>        Max entries (default 50)
  --full             Do not truncate message bodies

EXAMPLES
  island-axi logs
  island-axi logs --limit 20 --full
`,

  config: `island-axi config [--device <id>] [--full]

Show running-config. Truncated by default with size hint.

FLAGS
  --device <id>
  --full             Emit complete config

EXAMPLES
  island-axi config
  island-axi config --full
`,

  "config-diff": `island-axi config-diff [--device <id>] [--full]

Show running-config differences vs startup.

FLAGS
  --device <id>
  --full

EXAMPLES
  island-axi config-diff
`,

  vpns: `island-axi vpns [--device <id>]

VPN peer summary with handshake / transfer aggregates.

FLAGS
  --device <id>

EXAMPLES
  island-axi vpns
`,

  dhcp: `island-axi dhcp [--device <id>] [--fields mac,ip,hostname,status]

DHCP reservations (CSV-backed parse).

FLAGS
  --device <id>
  --fields <list>

EXAMPLES
  island-axi dhcp
`,

  ntp: `island-axi ntp [--device <id>]

NTP server config, sync status, and associations.

FLAGS
  --device <id>

EXAMPLES
  island-axi ntp
`,

  "dns-redirects": `island-axi dns-redirects [--device <id>]

DNS redirect / sinkhole rules from running-config.

FLAGS
  --device <id>

EXAMPLES
  island-axi dns-redirects
`,

  ping: `island-axi ping <target> [--device <id>]

ICMP ping from the router to <target>.

ARGS
  <target>           IP or hostname

FLAGS
  --device <id>

EXAMPLES
  island-axi ping 1.1.1.1
  island-axi ping google.com --device island-edge-1
`,

  show: `island-axi show <command...> [--device <id>] [--full]

Run an allowlisted read-only show command.

ARGS
  <command...>       e.g. version, ip neighbors, clock

FLAGS
  --device <id>
  --full             Do not truncate output

EXAMPLES
  island-axi show version
  island-axi show ip neighbors
`,

  configure: `island-axi configure <action> [flags] --confirm

WRITE operations. Requires --confirm. Persists with write memory.

ACTIONS
  add-dhcp --mac <mac> --ip <ip> [--hostname <name>]
  remove-dhcp --mac <mac>
  set-syslog --server-ip <ip> [--port 514] [--level 0-7] [--protocol udp|tcp]
  remove-syslog
  set-hostname --hostname <name>
  set-auto-update --days <days> [--time <hh:mm>]
  set-led --level <0-100>
  set-timezone --timezone <tz>
  set-ntp --server <addr>
  add-dns-redirect --domain <name> --redirect-server <ip>
  remove-dns-redirect --domain <name>

FLAGS
  --device <id>
  --confirm          Required safety gate (no interactive prompts)

EXAMPLES
  island-axi configure set-hostname --hostname edge1 --confirm
  island-axi configure add-dhcp --mac aa:bb:cc:dd:ee:ff --ip 192.168.2.50 --confirm
`,

  setup: `island-axi setup hooks

Install opt-in SessionStart hooks for Claude Code, Codex, and OpenCode
so agents see a compact island-axi dashboard at session start.

EXAMPLES
  island-axi setup hooks
`,
};
