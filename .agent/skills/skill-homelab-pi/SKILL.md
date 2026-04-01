---
name: skill-homelab-pi
description: "Manage Raspberry Pi homelab services. Covers Docker Compose deployments, systemd service hardening, backup strategies, health monitoring, and SD card longevity. Use when setting up services on a Raspberry Pi, deploying Docker stacks, configuring systemd units, or managing homelab infrastructure."
category: devops
risk: safe
source: community
tags: [raspberry-pi, homelab, docker, systemd, monitoring, linux, self-hosted]
date_added: "2026-04-01"
---

# Raspberry Pi Homelab Management

Deploy, manage, and maintain self-hosted services on a Raspberry Pi.

## When to Use

- Setting up a new service on a Raspberry Pi
- Creating Docker Compose stacks for homelab services
- Hardening systemd service units
- Implementing backup strategies for Pi-hosted data
- Monitoring Pi health (CPU temp, disk, memory)
- Optimizing for SD card longevity

## When NOT to Use

- Cloud server management (use cloud-specific skills)
- Bare-metal enterprise servers (use datacenter skills)
- Raspberry Pi hardware projects / GPIO (use electronics skills)

---

## Service Deployment with Docker Compose

### Template: Multi-Service Stack

```yaml
# docker-compose.yml
services:
  grafana:
    image: grafana/grafana:11.5.0
    ports:
      - "3000:3000"
    volumes:
      - grafana-data:/var/lib/grafana
    restart: unless-stopped
    environment:
      GF_SECURITY_ADMIN_PASSWORD: "${GRAFANA_ADMIN_PASSWORD}"

  loki:
    image: grafana/loki:3.4.0
    ports:
      - "3100:3100"
    volumes:
      - ./loki-config.yaml:/etc/loki/config.yaml
      - loki-data:/loki
    command: -config.file=/etc/loki/config.yaml
    restart: unless-stopped

  promtail:
    image: grafana/promtail:3.4.0
    volumes:
      - ./promtail-config.yaml:/etc/promtail/config.yaml
      - /var/log:/var/log:ro
    command: -config.file=/etc/promtail/config.yaml
    restart: unless-stopped
    ports:
      - "1514:1514/udp"

volumes:
  grafana-data:
    driver: local
    driver_opts:
      type: none
      device: /mnt/usb/docker/grafana
      o: bind
  loki-data:
    driver: local
    driver_opts:
      type: none
      device: /mnt/usb/docker/loki
      o: bind
```

### ARM-Compatible Images

Always verify images support `linux/arm64` or `linux/arm/v7`:

```bash
docker manifest inspect grafana/grafana:11.5.0 | grep architecture
```

---

## systemd Service Hardening

### Template: Hardened Service Unit

```ini
# /etc/systemd/system/my-service.service
[Unit]
Description=My Homelab Service
After=network-online.target docker.service
Wants=network-online.target
StartLimitIntervalSec=300
StartLimitBurst=5

[Service]
Type=simple
User=pi
Group=pi
WorkingDirectory=/opt/my-service
ExecStart=/opt/my-service/run.sh
Restart=on-failure
RestartSec=10

# Security hardening
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/opt/my-service/data
PrivateTmp=true
ProtectKernelTunables=true
ProtectControlGroups=true

# Resource limits
MemoryMax=512M
CPUQuota=50%

[Install]
WantedBy=multi-user.target
```

### Docker Compose as systemd Service

```ini
# /etc/systemd/system/homelab-stack.service
[Unit]
Description=Homelab Docker Compose Stack
After=docker.service
Requires=docker.service

[Service]
Type=oneshot
RemainAfterExit=true
WorkingDirectory=/opt/homelab
ExecStart=/usr/bin/docker compose up -d --remove-orphans
ExecStop=/usr/bin/docker compose down

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable --now homelab-stack.service
```

---

## SD Card Longevity

### Problem

SD cards have limited write cycles. Excessive writes (logs, temp files, databases) degrade the card.

### Mitigations

| Strategy | Implementation |
|---|---|
| Move data to USB SSD | Mount USB drive at `/mnt/usb`, bind-mount Docker volumes |
| tmpfs for temp data | `tmpfs /tmp tmpfs defaults,noatime,size=100M 0 0` |
| Reduce logging | Set journald `SystemMaxUse=50M` and `MaxRetentionSec=7day` |
| Disable swap on SD | `sudo dphys-swapfile swapoff && sudo systemctl disable dphys-swapfile` |
| Use f2fs or ext4 noatime | Mount with `noatime,commit=60` to reduce write frequency |
| Log rotation | Configure logrotate with `maxsize 10M` and `rotate 3` |

### USB SSD Setup

```bash
# Identify the USB drive
lsblk

# Format (if new)
sudo mkfs.ext4 -L usb-data /dev/sda1

# Auto-mount via fstab
echo 'LABEL=usb-data /mnt/usb ext4 defaults,noatime 0 2' | sudo tee -a /etc/fstab
sudo mount -a

# Create Docker data directories
sudo mkdir -p /mnt/usb/docker/{grafana,loki,promtail}
sudo chown -R 472:472 /mnt/usb/docker/grafana  # Grafana UID
```

---

## Health Monitoring

### Quick Health Check Script

```bash
#!/bin/bash
# pi-health.sh — Run with cron every 5 minutes

TEMP=$(vcgencmd measure_temp | cut -d= -f2 | cut -d\' -f1)
DISK=$(df -h / | awk 'NR==2{print $5}' | tr -d '%')
MEM=$(free | awk '/Mem/{printf "%.0f", $3/$2 * 100}')
LOAD=$(cat /proc/loadavg | cut -d' ' -f1)

# Alert thresholds
[[ $(echo "$TEMP > 75" | bc) -eq 1 ]] && echo "ALERT: CPU temp ${TEMP}°C"
[[ $DISK -gt 85 ]] && echo "ALERT: Disk ${DISK}% full"
[[ $MEM -gt 90 ]] && echo "ALERT: Memory ${MEM}% used"

echo "$(date): temp=${TEMP}°C disk=${DISK}% mem=${MEM}% load=${LOAD}"
```

### Docker Container Health

```bash
# Check all container statuses
docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"

# Check container resource usage
docker stats --no-stream --format "table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.NetIO}}"
```

---

## Backup Strategies

### What to Back Up

| Data | Location | Method |
|---|---|---|
| Docker volumes | `/mnt/usb/docker/` | rsync to NAS or cloud |
| Compose configs | `/opt/homelab/` | Git repository |
| System configs | `/etc/` | etckeeper or tar |
| Crontabs | `/var/spool/cron/` | Git or file copy |

### Automated Backup Script

```bash
#!/bin/bash
# backup-pi.sh — Run weekly via cron

BACKUP_DIR="/mnt/usb/backups"
DATE=$(date +%Y-%m-%d)

# Stop services for consistent backup
docker compose -f /opt/homelab/docker-compose.yml down

# Backup Docker volumes
tar czf "${BACKUP_DIR}/docker-volumes-${DATE}.tar.gz" -C /mnt/usb/docker .

# Restart services
docker compose -f /opt/homelab/docker-compose.yml up -d

# Backup system configs
tar czf "${BACKUP_DIR}/etc-${DATE}.tar.gz" -C / etc/

# Prune old backups (keep last 4)
ls -t ${BACKUP_DIR}/docker-volumes-*.tar.gz | tail -n +5 | xargs rm -f
ls -t ${BACKUP_DIR}/etc-*.tar.gz | tail -n +5 | xargs rm -f

echo "Backup complete: ${DATE}"
```

---

## Common Services for Homelab

| Service | Image | Purpose | Port |
|---|---|---|---|
| Grafana | `grafana/grafana` | Dashboards | 3000 |
| Loki | `grafana/loki` | Log aggregation | 3100 |
| Promtail | `grafana/promtail` | Log collection | 9080 |
| Pi-hole | `pihole/pihole` | DNS ad blocking | 53, 80 |
| Home Assistant | `homeassistant/home-assistant` | Home automation | 8123 |
| Uptime Kuma | `louislam/uptime-kuma` | Service monitoring | 3001 |
| Portainer | `portainer/portainer-ce` | Docker management GUI | 9443 |

---

## Verification Checklist

- [ ] USB SSD mounted and Docker volumes stored off SD card
- [ ] systemd services set to `restart: unless-stopped` or `Restart=on-failure`
- [ ] journald log limits configured to prevent disk fill
- [ ] Swap disabled on SD card
- [ ] Health check script runs via cron every 5 minutes
- [ ] Backup script runs weekly and retains 4 copies
- [ ] All Docker images verified for ARM compatibility
- [ ] Docker Compose stack survives `sudo reboot`
