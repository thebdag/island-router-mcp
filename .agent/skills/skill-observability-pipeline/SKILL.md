---
name: skill-observability-pipeline
description: "Build log ingestion and monitoring pipelines from network devices to Grafana. Covers syslog forwarding, rsyslog/Promtail receivers, Loki log storage, Grafana dashboards, and alerting. Use when setting up logging, forwarding syslog, configuring Loki, or building Grafana dashboards for infrastructure monitoring."
category: devops
risk: safe
source: community
tags: [observability, grafana, loki, promtail, syslog, monitoring, logging, raspberry-pi]
date_added: "2026-04-01"
---

# Observability Pipeline Builder

Build end-to-end log ingestion pipelines from network devices and servers to Grafana for visualization and alerting.

## When to Use

- Setting up syslog forwarding from routers, switches, or servers
- Configuring Promtail or rsyslog as log receivers
- Deploying Loki for log aggregation and querying
- Building Grafana dashboards for infrastructure monitoring
- Creating alert rules for network events (interface flaps, VPN disconnects, etc.)
- Standing up a monitoring stack on a Raspberry Pi or homelab server

## When NOT to Use

- Application-level logging (use language-specific logging frameworks)
- Metrics-only monitoring without logs (use Prometheus + Grafana instead)
- Cloud-native logging (CloudWatch, Cloud Logging) — use cloud-specific skills

---

## Architecture Overview

```
┌─────────────────────┐
│ Network Devices     │   syslog (UDP/TCP:514)
│ (routers, switches) ├──────────────────────────┐
└─────────────────────┘                          │
                                                 ▼
┌─────────────────────┐    ┌──────────────────────────┐
│ Linux Servers       │    │ Log Receiver              │
│ (app logs, journal) ├───▶│ rsyslog or Promtail       │
└─────────────────────┘    └────────────┬─────────────┘
                                        │ push
                                        ▼
                           ┌──────────────────────────┐
                           │ Loki                      │
                           │ (log storage + query)     │
                           └────────────┬─────────────┘
                                        │ datasource
                                        ▼
                           ┌──────────────────────────┐
                           │ Grafana                   │
                           │ (dashboards + alerts)     │
                           └──────────────────────────┘
```

---

## Step 1: Configure Syslog Source

### Network Devices (General)

Most network devices can send standard syslog messages. Configure the remote source on the device CLI:

```
configure terminal
syslog server <receiver-ip> 514
syslog level info
syslog protocol udp
end
write memory
```

Or via the `island-router-mcp` server:

```
island_configure → action: set_syslog, server_ip: <receiver-ip>, port: 514, level: info, protocol: udp
```

### Linux Servers (systemd journal)

For forwarding journald logs, configure rsyslog or use Promtail to tail the journal directly.

---

## Step 2: Set Up the Log Receiver

### Option A: Promtail (recommended for Loki)

Promtail natively pushes to Loki. Install via Docker or binary.

**promtail-config.yaml:**

```yaml
server:
  http_listen_port: 9080

positions:
  filename: /tmp/positions.yaml

clients:
  - url: http://localhost:3100/loki/api/v1/push

scrape_configs:
  # Receive syslog over UDP
  - job_name: syslog
    syslog:
      listen_address: 0.0.0.0:1514
      idle_timeout: 60s
      label_structured_data: true
      labels:
        job: syslog
    relabel_configs:
      - source_labels: [__syslog_message_hostname]
        target_label: host
      - source_labels: [__syslog_message_severity]
        target_label: severity
      - source_labels: [__syslog_message_facility]
        target_label: facility
      - source_labels: [__syslog_message_app_name]
        target_label: app

  # Tail local log files
  - job_name: system
    static_configs:
      - targets: [localhost]
        labels:
          job: system
          __path__: /var/log/*.log
```

> **Note:** Promtail listens on port 1514 (not 514) to avoid needing root. Either configure the device to send to 1514, or use iptables to redirect 514 → 1514.

### Option B: rsyslog (traditional receiver)

**`/etc/rsyslog.d/10-remote.conf`:**

```
# Receive UDP syslog on port 514
module(load="imudp")
input(type="imudp" port="514")

# Receive TCP syslog on port 514
module(load="imtcp")
input(type="imtcp" port="514")

# Write remote logs to per-host files
template(name="RemoteLogs" type="string"
  string="/var/log/remote/%HOSTNAME%/%PROGRAMNAME%.log")

if $fromhost-ip != '127.0.0.1' then {
  action(type="omfile" dynaFile="RemoteLogs")
  stop
}
```

Then configure Promtail to tail `/var/log/remote/**/*.log`.

---

## Step 3: Deploy Loki

### Docker Compose (single-node, small scale)

**`docker-compose.yml`:**

```yaml
services:
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
    depends_on: [loki]
    restart: unless-stopped
    ports:
      - "1514:1514/udp"   # syslog receiver

  grafana:
    image: grafana/grafana:11.5.0
    ports:
      - "3000:3000"
    volumes:
      - grafana-data:/var/lib/grafana
    restart: unless-stopped
    environment:
      GF_SECURITY_ADMIN_PASSWORD: "${GRAFANA_ADMIN_PASSWORD:-changeme}"

volumes:
  loki-data:
  grafana-data:
```

### Loki Config (small-scale / Raspberry Pi)

**`loki-config.yaml`:**

```yaml
auth_enabled: false

server:
  http_listen_port: 3100

common:
  ring:
    instance_addr: 127.0.0.1
    kvstore:
      store: inmemory
  replication_factor: 1
  path_prefix: /loki

schema_config:
  configs:
    - from: 2024-01-01
      store: tsdb
      object_store: filesystem
      schema: v13
      index:
        prefix: index_
        period: 24h

storage_config:
  filesystem:
    directory: /loki/chunks

limits_config:
  retention_period: 30d
  ingestion_rate_mb: 4
  ingestion_burst_size_mb: 6

compactor:
  working_directory: /loki/compactor
  retention_enabled: true
```

---

## Step 4: Configure Grafana Data Source

After Grafana is running (http://\<host\>:3000):

1. Navigate to **Configuration → Data Sources → Add data source**
2. Select **Loki**
3. Set URL to `http://loki:3100` (if Docker Compose) or `http://localhost:3100`
4. Click **Save & Test**

### Provisioning (automated)

**`grafana/provisioning/datasources/loki.yaml`:**

```yaml
apiVersion: 1
datasources:
  - name: Loki
    type: loki
    access: proxy
    url: http://loki:3100
    isDefault: true
```

---

## Step 5: Build Dashboards

### Essential LogQL Queries

| Purpose | Query |
|---|---|
| All logs from a host | `{host="island-router"}` |
| Error-level only | `{host="island-router"} \|= "error"` |
| VPN events | `{host="island-router"} \|~ "(?i)vpn"` |
| Interface state changes | `{host="island-router"} \|~ "(?i)(link up\|link down\|interface)"` |
| DHCP events | `{host="island-router"} \|~ "(?i)dhcp"` |
| Rate of errors per minute | `rate({severity="err"} [1m])` |

### Dashboard Panel Suggestions

| Panel | Visualization | Query |
|---|---|---|
| Log volume by host | Time series | `sum(rate({job="syslog"} [5m])) by (host)` |
| Error rate | Stat | `sum(rate({severity=~"err\|crit\|alert\|emerg"} [5m]))` |
| Recent logs | Logs panel | `{job="syslog"} \| line_format "{{.host}}: {{.msg}}"` |
| Top talkers | Bar gauge | `topk(5, sum(rate({job="syslog"} [1h])) by (host))` |

---

## Step 6: Configure Alerts

### Grafana Alert Rule Example

In Grafana UI: **Alerting → Alert Rules → New Alert Rule**

| Field | Value |
|---|---|
| Query | `count_over_time({host="island-router", severity="err"} [5m])` |
| Condition | `> 5` |
| Evaluate every | `1m` |
| For | `5m` |
| Summary | `High error rate on router` |

### Contact Points

Configure notification channels: email, Slack webhook, PagerDuty, etc.

---

## Raspberry Pi Considerations

| Concern | Mitigation |
|---|---|
| Limited RAM (1-4 GB) | Use Loki's `ingestion_rate_mb: 4` and short retention |
| SD card wear | Mount data volumes on USB SSD |
| CPU spikes on queries | Keep dashboards simple, avoid regex-heavy LogQL |
| ARM architecture | Use `grafana/loki:3.4.0` (multi-arch images available) |
| Port 514 requires root | Use Promtail on 1514 + iptables redirect, or run as root |

### iptables Redirect (port 514 → 1514)

```bash
sudo iptables -t nat -A PREROUTING -p udp --dport 514 -j REDIRECT --to-port 1514
sudo iptables-save > /etc/iptables/rules.v4
```

---

## Verification Checklist

After deploying the pipeline:

- [ ] Syslog source sends to receiver IP:port (verify with `tcpdump -i any port 514`)
- [ ] Promtail/rsyslog receives logs (check Promtail targets at `http://<host>:9080/targets`)
- [ ] Loki ingests logs (`curl http://localhost:3100/ready`)
- [ ] Grafana connects to Loki data source (Save & Test succeeds)
- [ ] LogQL queries return results in Explore view
- [ ] Dashboard panels show data
- [ ] Alert rules fire on test conditions
- [ ] Logs survive a container restart (volumes mounted)
