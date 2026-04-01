---
name: skill-network-fleet
description: "Manage multiple network devices as a fleet. Pull configs, detect drift against golden baselines, run compliance checks, schedule automated backups, and generate reports. Use when managing multiple routers or switches, detecting config drift, running compliance audits, or automating config backups across devices."
category: networking
risk: moderate
source: community
tags: [networking, fleet-management, config-drift, compliance, automation, router, backup]
date_added: "2026-04-01"
---

# Network Fleet Management

Manage multiple network devices as a coordinated fleet — config backups, drift detection, compliance audits, and bulk operations.

## When to Use

- Managing more than one network device (routers, switches, APs)
- Detecting configuration drift from approved baselines
- Running compliance checks (NTP servers, DNS settings, syslog config, etc.)
- Automating scheduled config backups across all devices
- Generating fleet-wide status reports
- Comparing configurations between devices

## When NOT to Use

- Single-device management (use `island-router-cli` directly)
- Non-network infrastructure (use cloud-specific skills)
- Deep packet inspection or traffic analysis (use Wireshark skills)

---

## Prerequisites

- `devices.json` inventory file with all managed devices
- SSH connectivity to all devices
- The island-router-mcp server (or equivalent) configured and running
- Optional: Git repository for config version control

---

## Device Inventory

### devices.json Format

```json
[
  {
    "id": "hq-router",
    "host": "192.168.2.1",
    "port": 22,
    "username": "admin",
    "authMethod": "password",
    "description": "HQ Island Router",
    "tags": ["production", "hq"],
    "baseline": "baselines/hq-router.cfg"
  },
  {
    "id": "branch-router",
    "host": "10.0.1.1",
    "port": 22,
    "username": "admin",
    "authMethod": "key",
    "keyFile": "~/.ssh/island_router_key",
    "description": "Branch Office Router",
    "tags": ["production", "branch"],
    "baseline": "baselines/branch-router.cfg"
  }
]
```

### Discovery

List all configured devices:

```
island_list_devices
```

---

## Workflow 1: Fleet Status Report

Pull status from all devices and generate a unified report.

### Steps

1. **Iterate** over all devices in inventory
2. **Query** each device for status (interfaces, routes, VPN, clock)
3. **Aggregate** results into a summary table

### Output Format

```markdown
## Fleet Status Report — 2026-04-01 15:30 UTC

| Device | Hostname | Firmware | Uptime | Interfaces (up/total) | VPN Peers | Syslog |
|---|---|---|---|---|---|---|
| hq-router | Island-HQ | 2.3.2 | 47d 3h | 4/6 | 3 active | ✅ configured |
| branch-router | Island-Branch | 2.3.2 | 12d 8h | 2/4 | 1 active | ❌ not configured |

### Alerts
- ⚠️ branch-router: syslog not configured
- ⚠️ branch-router: 2 interfaces down (en2, en3)
```

---

## Workflow 2: Config Drift Detection

Compare running configs against approved golden baselines.

### Steps

1. **Pull** running-config from each device
2. **Load** golden baseline from `baselines/<device-id>.cfg`
3. **Diff** running vs baseline, ignoring ephemeral lines (timestamps, uptime)
4. **Report** additions, removals, and changes

### Ignore Patterns (ephemeral lines)

```
# Lines that change naturally and should not flag drift:
- Lines containing timestamps or uptime
- Lines with "last-modified" or "generated-by"
- Comment lines starting with !
- Blank lines
```

### Output Format

```markdown
## Config Drift Report — hq-router

**Status:** ⚠️ DRIFT DETECTED (3 changes)

### Additions (in running, not in baseline)
```diff
+ ip dhcp-reserve aa:bb:cc:dd:ee:ff 192.168.2.50
+ syslog server 192.168.2.100 514
```

### Removals (in baseline, not in running)
```diff
- ntp time.google.com
```

### Recommended Actions
1. If intentional: update baseline with `save-baseline hq-router`
2. If unintentional: remediate with config commands to restore baseline
```

### Save New Baseline

After verifying drift is intentional:

```bash
# Pull current config and save as new baseline
island_query → action: config, device_id: hq-router
# Save output to baselines/hq-router.cfg
```

---

## Workflow 3: Compliance Audit

Check all devices against a defined compliance policy.

### Default Compliance Rules

| Rule | Check | Severity |
|---|---|---|
| NTP configured | `show ntp` returns a valid server | High |
| Syslog forwarding | `show syslog` shows configured server | High |
| Firmware version | `show version` matches expected version | Medium |
| Admin password changed | Not using default credentials | Critical |
| DNS configured | DNS mode is set appropriately | Medium |
| Firewall enabled | `ip firewall on` in config | High |
| VPN secret set | VPN server has a preshared key | Medium |

### Compliance Report Format

```markdown
## Compliance Audit — Full Fleet

| Rule | hq-router | branch-router | Overall |
|---|---|---|---|
| NTP configured | ✅ time.cloudflare.com | ❌ not set | ⚠️ 1/2 |
| Syslog forwarding | ✅ 192.168.2.100 | ❌ not set | ⚠️ 1/2 |
| Firmware 2.3.2 | ✅ match | ✅ match | ✅ 2/2 |
| Firewall enabled | ✅ on | ✅ on | ✅ 2/2 |
| VPN secret | ✅ set | ✅ set | ✅ 2/2 |

**Compliance Score:** 80% (8/10 checks passed)

### Remediation Required
1. branch-router: Configure NTP → `ntp time.cloudflare.com`
2. branch-router: Configure syslog → `syslog server 192.168.2.100 514`
```

---

## Workflow 4: Automated Config Backup

### Backup All Devices

For each device in inventory:

1. Connect and pull `show running-config`
2. Save to `backups/<device-id>/<date>.cfg`
3. Optionally commit to git

### Backup via SCP (router-native)

```
island_query → action: command, device_id: <id>,
  command: "write network scp://backup@192.168.1.100/backups/<device-id>.cfg"
```

### Git-Based Config Versioning

```bash
# After pulling configs
cd backups/
git add .
git commit -m "Config backup $(date +%Y-%m-%d)"
git push
```

---

## Workflow 5: Bulk Configuration

Apply the same configuration change across multiple devices.

### Safety Protocol

1. **Preview** the change against one device first
2. **Verify** with `show running-config` on the test device
3. **Apply** to remaining devices only after confirmation
4. **Verify** all devices after application
5. **Persist** with `write memory` only after full fleet verification

### Example: Set NTP on All Devices

```
For each device in fleet:
  1. island_configure → action: (custom) → configure terminal → ntp time.cloudflare.com → end
  2. Verify: island_query → action: command → show ntp
  3. Persist: write memory (with user confirmation)
```

> **CAUTION:** Never bulk-persist without individual verification. A misconfiguration applied to all devices simultaneously can cause a network-wide outage.

---

## File Structure

```
network-fleet/
├── devices.json              # Device inventory
├── baselines/                # Golden config baselines
│   ├── hq-router.cfg
│   └── branch-router.cfg
├── backups/                  # Timestamped config backups
│   ├── hq-router/
│   │   ├── 2026-04-01.cfg
│   │   └── 2026-03-25.cfg
│   └── branch-router/
│       └── 2026-04-01.cfg
├── compliance/
│   └── rules.yaml            # Compliance rule definitions
└── reports/                  # Generated reports
    └── 2026-04-01-fleet-status.md
```

---

## Verification Checklist

- [ ] All devices in `devices.json` are reachable via SSH
- [ ] Golden baselines exist for all production devices
- [ ] Config drift detection correctly ignores ephemeral lines
- [ ] Compliance rules match organizational policy
- [ ] Backup directory has write permissions
- [ ] Bulk operations tested on a single device before fleet-wide rollout
