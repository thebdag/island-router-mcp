---
name: skill-firmware-differ
description: "Plan and assess safe firmware upgrades for network devices. Compare running configs against release notes, identify deprecated CLI commands, generate upgrade runbooks with rollback plans, and create pre/post upgrade snapshots. Use when a firmware update is available, planning a router upgrade, or diffing configs between firmware versions."
category: networking
risk: moderate
source: community
tags: [firmware, upgrade, network, router, diff, config-management, rollback]
date_added: "2026-04-01"
---

# Firmware Upgrade Planner

Plan safe firmware upgrades for network devices by analyzing config compatibility, generating runbooks, and creating rollback plans.

## When to Use

- A new firmware version is available for a network device
- Planning an upgrade from one firmware version to another
- Checking if current configuration is compatible with a new firmware
- Creating a step-by-step upgrade runbook with rollback
- Diffing config behavior between firmware versions

## When NOT to Use

- Software application upgrades (use `skill-rails-upgrade` or similar)
- Cloud infrastructure updates (use Terraform/Pulumi skills)
- Routine config changes without firmware change (use `island-router-cli`)

---

## Upgrade Assessment Process

```
┌─────────────────┐   ┌──────────────────┐   ┌─────────────────┐
│ 1. PRE-FLIGHT   │──▶│ 2. COMPATIBILITY │──▶│ 3. RUNBOOK      │
│ Snapshot state   │   │ Analyze changes  │   │ Generate steps  │
└─────────────────┘   └──────────────────┘   └─────────────────┘
                                                      │
┌─────────────────┐   ┌──────────────────┐            │
│ 5. VERIFY       │◀──│ 4. EXECUTE       │◀───────────┘
│ Post-check      │   │ Apply upgrade    │
└─────────────────┘   └──────────────────┘
```

---

## Step 1: Pre-Flight Snapshot

Before any upgrade, capture the complete device state.

### What to Capture

| Data | Command | Purpose |
|---|---|---|
| Firmware version | `show version` | Baseline version |
| Running config | `show running-config` | Full config backup |
| Startup config | `show startup-config` | Saved config |
| Interface state | `show interface summary` | Link status |
| Routes | `show ip routes` | Routing baseline |
| ARP table | `show ip neighbors` | Neighbor baseline |
| VPN status | `show vpns` | VPN peer status |
| DHCP reservations | `show ip dhcp-reservations` | Static assignments |
| Free space | `show free-space` | Storage for upgrade |
| NTP status | `show ntp` | Time sync state |

### Snapshot Storage

```
upgrades/<device-id>/<date>/
├── pre-upgrade/
│   ├── version.txt
│   ├── running-config.cfg
│   ├── startup-config.cfg
│   ├── interfaces.txt
│   ├── routes.txt
│   ├── neighbors.txt
│   ├── vpns.txt
│   ├── dhcp.txt
│   └── full-status.json
└── post-upgrade/
    └── (same files, captured after upgrade)
```

---

## Step 2: Compatibility Analysis

### Config Key Changes

Compare the current firmware's CLI commands against the target firmware's release notes.

| Check | Method | Risk if Missed |
|---|---|---|
| Deprecated commands | Diff CLI command tree | Config fails to apply |
| Renamed parameters | Check release notes | Settings silently ignored |
| New required fields | Check upgrade guide | Service disruption |
| Changed defaults | Compare default configs | Unexpected behavior |
| Removed features | Release notes review | Functionality loss |

### Release Notes Analysis Template

```markdown
## Firmware Upgrade Analysis: v2.3.2 → v<target>

### Breaking Changes
- [ ] List any deprecated commands found in current config
- [ ] List any renamed parameters
- [ ] List any removed features currently in use

### New Features
- [ ] Features available in target that could benefit config

### Config Migration Required
| Current Command | New Command | Status |
|---|---|---|
| `old-command param` | `new-command param` | ⚠️ Must update |

### Risk Assessment
- **Overall Risk:** Low / Medium / High
- **Expected Downtime:** < 5 min (reboot cycle)
- **Rollback Complexity:** Low (restore startup-config + reload)
```

---

## Step 3: Generate Upgrade Runbook

### Runbook Template

```markdown
# Upgrade Runbook: <device-id>
# Date: <date>
# From: v<current> → v<target>

## Pre-Upgrade Checklist
- [ ] Backup running-config saved to local file
- [ ] Backup running-config exported via SCP (`write network scp://...`)
- [ ] All interfaces documented
- [ ] VPN peer status recorded
- [ ] Free space verified (need <X> MB for firmware)
- [ ] Maintenance window communicated
- [ ] Rollback plan reviewed

## Upgrade Steps

### 1. Verify Current State
```
show version
show running-config
show free-space
```

### 2. Backup Config
```
write memory              # Ensure startup-config is current
write network scp://backup@server/upgrades/<device-id>/pre-upgrade.cfg
```

### 3. Download Firmware
```
auto-update               # Or manual firmware download
```

### 4. Apply Firmware
Follow device-specific upgrade procedure.

### 5. Reboot
```
reload                    # REQUIRES USER CONFIRMATION
```

### 6. Post-Upgrade Verification
```
show version              # Confirm new firmware version
show running-config       # Verify config survived upgrade
show interface summary    # Check all expected interfaces up
show ip routes            # Verify routing table
show vpns                 # Check VPN peers reconnected
show ip neighbors         # Verify ARP table populated
```

### 7. Config Migration (if needed)
Apply any command changes identified in compatibility analysis:
```
configure terminal
<new-command replacing deprecated one>
end
write memory
```

## Rollback Plan

If the upgrade fails or causes issues:

### Option A: Rollback to Previous Config
```
rollback                  # Restores startup-config
reload                    # Reboots with previous config
```

### Option B: Restore from Backup
```
# From backup server — consult device documentation
# for firmware downgrade procedure
```

### Rollback Triggers
- Device fails to boot after upgrade
- Critical services (VPN, DHCP) not functioning
- Interface link states don't match pre-upgrade snapshot
- Routing table missing expected routes
```

---

## Step 4: Post-Upgrade Verification

### Automated Comparison

After upgrade, capture the same data as pre-flight and compare:

```markdown
## Post-Upgrade Verification Report

| Check | Pre-Upgrade | Post-Upgrade | Match? |
|---|---|---|---|
| Firmware version | 2.3.2 | 2.4.0 | ✅ Changed (expected) |
| Interface count | 6 (4 up) | 6 (4 up) | ✅ Match |
| Route count | 12 | 12 | ✅ Match |
| VPN peers | 3 active | 3 active | ✅ Match |
| DHCP reservations | 8 | 8 | ✅ Match |
| NTP synced | yes | yes | ✅ Match |
| Running-config lines | 142 | 145 | ⚠️ Check (+3 new defaults) |
```

---

## Verification Checklist

- [ ] Pre-upgrade snapshot captured and stored
- [ ] Config exported to external backup (SCP/SFTP)
- [ ] Release notes analyzed for breaking changes
- [ ] Config migration commands identified (if any)
- [ ] Upgrade runbook generated with all steps
- [ ] Rollback plan documented with clear triggers
- [ ] Post-upgrade verification shows all services operational
- [ ] New firmware version confirmed in `show version`
