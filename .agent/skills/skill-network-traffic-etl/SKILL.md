---
name: skill-network-traffic-etl
description: |
  Extract, transform, and load per-device network traffic data from Island Routers
  into analytics platforms. Covers bandwidth consumption, site visit history,
  content categorization, and device activity tracking. Supports export to
  Grafana/Loki, InfluxDB, BigQuery, CSV/Parquet files, and custom pipelines.
  Use when building traffic dashboards, usage reports, or billing/compliance systems.
category: networking
risk: safe
source: community
tags: [etl, analytics, traffic, bandwidth, history, grafana, influxdb, bigquery, reporting]
date_added: "2026-04-03"
---

# Network Traffic ETL Pipeline

Extract per-device network activity from Island Routers and load it into analytics platforms for dashboards, usage reports, and compliance monitoring.

## When to Use

- Building per-device bandwidth consumption dashboards
- Tracking site visit history and content categories per client
- Creating usage reports (daily/weekly/monthly) for billing or compliance
- Loading network activity into a data warehouse (BigQuery, Snowflake, etc.)
- Feeding traffic data to InfluxDB/Prometheus for time-series analysis
- Exporting event logs to SIEM platforms (Splunk, Elastic, etc.)

## When NOT to Use

- System-level syslog forwarding → use `skill-observability-pipeline` instead
- Real-time packet capture / deep inspection → use `tcpdump` directly
- Application-layer logging from endpoints → use endpoint agents

---

## Data Sources on the Island Router

The Island Router provides **three tiers** of traffic data. Understanding what's available is critical to designing an effective ETL pipeline.

### Tier 1: Event History (richest data)

**Command:** `show history begin <time> first json:`

This is the **primary data source** for per-device analytics. The history system records subscriber-level events including:

| Field | Specifier | Description |
| --- | --- | --- |
| Timestamp | `%D` | ISO 8601 event time |
| Subscriber IP | `%i` | Client device IP address |
| Subscriber Name | `%s` | Device hostname (if known) |
| MAC Address | `%m` | Client hardware address |
| Subscriber Desc | `%E` | Device description |
| Event Type | `%t` | Event classification |
| Category Number | `%c` | Content category (numeric) |
| Group Number | `%g` | Policy group assignment |
| Bytes Received | `%xr` | Download bytes for this event |
| Bytes Transmitted | `%xt` | Upload bytes for this event |
| Subscriber Addr:Port | `%ys` | Source address and port |
| Destination Addr:Port | `%yd` | Destination address and port |
| Source Name | `%rn` | Destination hostname / domain |
| Source IP | `%ri` | Actual destination IP |
| Source Type | `%rt` | Source classification type |
| Source Qualifier | `%rq` | Additional source metadata |
| Host Category Map | `%Mh` | Category mapping for the host |
| Allowed Categories | `%Ma` | Which categories were permitted |
| Denied Categories | `%Md` | Which categories were blocked |

**Output formats:** `json:`, `csv`, `all` (tag=value), `syslog`, `avro:`

**Time ranges:** `30m`, `1h`, `6h`, `1d`, `1w`, `1M`, `1Y`

**Example — JSON export of last 24 hours:**
```
show history begin 1d first json:
```

**Example — CSV with specific fields:**
```
show history begin 1d first csv
```

**Example — filtered by a device MAC:**
```
show history begin 1d where mac=aa:bb:cc:dd:ee:ff first json:
```

### Tier 2: Interface Counters (aggregate bandwidth)

**Command:** `show interface` or `show stats json interfaces`

Provides cumulative TX/RX bytes per interface — useful for total WAN throughput but **not per-device**. Must be polled at regular intervals and diffed to calculate rates.

| Metric | Description |
| --- | --- |
| TX Bytes | Cumulative bytes transmitted on interface |
| RX Bytes | Cumulative bytes received on interface |
| TX Packets | Cumulative packets transmitted |
| RX Packets | Cumulative packets received |
| TX Errors | Transmit error count |
| RX Errors | Receive error count |

**Relationship to Tier 1:** Interface counters give you the "big picture" — total network throughput. History events give you the per-device breakdown. Use both together for accurate dashboards.

### Tier 3: Device Inventory (enrichment data)

Used to **enrich** Tier 1 and Tier 2 data with human-readable device names.

| Command | Data |
| --- | --- |
| `show ip dhcp-reservations csv` | MAC → IP → Hostname static mappings |
| `show ip neighbors` | IP → MAC → Interface → State (active devices) |
| `show stats json dhcpd` | Active DHCP leases with device identifiers |

---

## Architecture

```
┌────────────────────────────────────────────────────────────┐
│                    Island Router                            │
│                                                             │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐  │
│  │ Event History │  │ Interface    │  │ Device Inventory │  │
│  │ (Tier 1)     │  │ Stats (T2)   │  │ (Tier 3)         │  │
│  └──────┬───────┘  └──────┬───────┘  └────────┬─────────┘  │
└─────────┼─────────────────┼───────────────────┼────────────┘
          │                 │                   │
          ▼                 ▼                   ▼
┌────────────────────────────────────────────────────────────┐
│                    EXTRACT Layer                            │
│                                                             │
│  Method A: MCP Server (on-demand)                          │
│    island_query → history / interfaces / dhcp_reservations │
│                                                             │
│  Method B: Router Push (automated)                         │
│    history <instance> url sftp://... interval 3600          │
│                                                             │
│  Method C: Cron + SSH Script (scheduled)                   │
│    Python/Node script → SSH → parse → store                │
└──────────────────────────┬─────────────────────────────────┘
                           │
                           ▼
┌────────────────────────────────────────────────────────────┐
│                    TRANSFORM Layer                          │
│                                                             │
│  1. Parse JSON/CSV from router output                      │
│  2. Enrich with device names (MAC → hostname lookup)       │
│  3. Aggregate by device, category, time bucket             │
│  4. Calculate bandwidth rates (diff interface counters)    │
│  5. Normalize timestamps to UTC                            │
└──────────────────────────┬─────────────────────────────────┘
                           │
                           ▼
┌────────────────────────────────────────────────────────────┐
│                    LOAD Targets                             │
│                                                             │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────┐  │
│  │ Grafana  │ │ InfluxDB │ │ BigQuery │ │ CSV/Parquet  │  │
│  │ + Loki   │ │          │ │          │ │ (files)      │  │
│  └──────────┘ └──────────┘ └──────────┘ └──────────────┘  │
│                                                             │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐                   │
│  │ Splunk   │ │ Elastic  │ │ Custom   │                   │
│  │ / SIEM   │ │ search   │ │ webhook  │                   │
│  └──────────┘ └──────────┘ └──────────┘                   │
└────────────────────────────────────────────────────────────┘
```

---

## Extract Methods

### Method A: MCP Server (On-Demand Queries)

Use the `island_query` tool for interactive or ad-hoc extraction. Best for exploration, debugging, and small-scale reporting.

```
# Per-device event history (last 24 hours, JSON)
island_query → action: history, time: "1d"

# DHCP reservations for device name enrichment
island_query → action: dhcp_reservations

# Interface counters for total bandwidth
island_query → action: interfaces, detail: true

# Active devices on the network
island_query → action: neighbors
```

### Method B: Router Push (Automated Export)

The router's **history instance** system pushes data to a remote server on a schedule. This is the **recommended approach for production ETL** — zero SSH polling, no rate-limiting concerns.

**Setup via SSH (or island_configure in future):**

```bash
# Create history instance for JSON export every hour
history traffic-etl interval 3600
history traffic-etl output-format json
history traffic-etl url sftp://etl-user:password@192.168.2.50/data/router-history/
history traffic-etl utc
write memory
```

**Setup via MCP (using the `command` action for now):**

> ⚠️ History instance management is not yet a dedicated `island_configure` action. Use direct SSH or the `command` action when available.

**Receiver setup (on the target server):**

```bash
# Create the landing directory
sudo mkdir -p /data/router-history
sudo chown etl-user:etl-user /data/router-history

# Ensure SFTP subsystem is enabled in sshd_config
grep "Subsystem sftp" /etc/ssh/sshd_config
# Should show: Subsystem sftp /usr/lib/openssh/sftp-server
```

**What lands on the server:**
The router writes timestamped JSON files (one per interval) to the SFTP path. File names include the instance name and rotation timestamp.

### Method C: Cron + SSH Script (Scheduled Polling)

For environments where router push isn't available, poll via SSH on a schedule.

**Python ETL script (`etl_traffic.py`):**

```python
#!/usr/bin/env python3
"""
Island Router Traffic ETL — Scheduled Extractor

Polls the router for event history and interface stats,
enriches with device names, and writes to the target platform.

Usage:
  # Run every hour via cron
  python3 etl_traffic.py --range 1h --output json --dest /data/traffic/

  # Run daily summary
  python3 etl_traffic.py --range 1d --output csv --dest /data/daily/
"""

import json
import csv
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

# Assumes paramiko is installed: pip install paramiko python-dotenv
import paramiko
from dotenv import load_dotenv

load_dotenv()

ROUTER_IP = os.getenv("ROUTER_IP", "192.168.2.1")
ROUTER_USER = os.getenv("ROUTER_USER", "admin")
ROUTER_PASS = os.getenv("ROUTER_PASS", "")


def connect():
    """Establish SSH connection and return interactive shell channel."""
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(ROUTER_IP, username=ROUTER_USER, password=ROUTER_PASS)
    channel = client.invoke_shell()

    # Disable pager
    _send(channel, "terminal length 0")
    return client, channel


def _send(channel, cmd, wait=2):
    """Send a command and collect output."""
    import time
    channel.send(cmd + "\n")
    time.sleep(wait)
    output = ""
    while channel.recv_ready():
        output += channel.recv(65535).decode("utf-8", errors="replace")
    return output


def extract_history(channel, time_range="1h"):
    """Extract event history as JSON."""
    raw = _send(channel, f"show history begin {time_range} first json:", wait=5)

    # The output contains JSON between the command echo and the next prompt
    # Find the JSON array or objects in the output
    events = []
    for line in raw.split("\n"):
        line = line.strip()
        if line.startswith("{") and line.endswith("}"):
            try:
                events.append(json.loads(line))
            except json.JSONDecodeError:
                continue
    return events


def extract_interface_stats(channel):
    """Extract interface byte counters."""
    raw = _send(channel, "show interface", wait=3)
    # Parse interface stats (simplified — use the MCP parser for full fidelity)
    interfaces = {}
    current = None
    for line in raw.split("\n"):
        if " is " in line and not line.startswith(" "):
            name = line.split()[0]
            current = name
            interfaces[current] = {"tx_bytes": 0, "rx_bytes": 0}
        if current and "bytes" in line.lower():
            parts = line.strip().split()
            for i, part in enumerate(parts):
                if part.isdigit() and i + 1 < len(parts):
                    next_word = parts[i + 1].lower()
                    if "output" in next_word or "tx" in next_word or "sent" in next_word:
                        interfaces[current]["tx_bytes"] = int(part)
                    elif "input" in next_word or "rx" in next_word or "received" in next_word:
                        interfaces[current]["rx_bytes"] = int(part)
    return interfaces


def extract_device_map(channel):
    """Extract MAC → hostname mapping from DHCP reservations."""
    raw = _send(channel, "show ip dhcp-reservations csv", wait=2)
    device_map = {}
    for line in raw.split("\n"):
        parts = line.strip().split(",")
        if len(parts) >= 3:
            mac, ip = parts[0].strip(), parts[1].strip()
            hostname = parts[2].strip() if len(parts) > 2 else ""
            if ":" in mac:  # looks like a MAC
                device_map[mac.lower()] = {
                    "ip": ip,
                    "hostname": hostname or ip,
                }
    return device_map


def transform(events, device_map):
    """Enrich events with device names and normalize."""
    enriched = []
    for event in events:
        mac = (event.get("mac", "") or "").lower()
        device = device_map.get(mac, {})

        enriched.append({
            "timestamp": event.get("date", event.get("time", "")),
            "device_mac": mac,
            "device_ip": event.get("ip", device.get("ip", "")),
            "device_name": device.get("hostname", event.get("subscriber", mac)),
            "event_type": event.get("type", ""),
            "category": event.get("category", ""),
            "destination": event.get("source_name", event.get("destination", "")),
            "destination_ip": event.get("source_ip", ""),
            "bytes_rx": int(event.get("bytes_received", 0) or 0),
            "bytes_tx": int(event.get("bytes_transmitted", 0) or 0),
            "bytes_total": int(event.get("bytes_received", 0) or 0)
                         + int(event.get("bytes_transmitted", 0) or 0),
        })
    return enriched


def load_json(records, dest_dir):
    """Write records to a timestamped JSON file."""
    Path(dest_dir).mkdir(parents=True, exist_ok=True)
    ts = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    filepath = Path(dest_dir) / f"traffic_{ts}.json"
    with open(filepath, "w") as f:
        json.dump(records, f, indent=2)
    print(f"Wrote {len(records)} records to {filepath}")
    return filepath


def load_csv(records, dest_dir):
    """Write records to a timestamped CSV file."""
    if not records:
        return None
    Path(dest_dir).mkdir(parents=True, exist_ok=True)
    ts = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    filepath = Path(dest_dir) / f"traffic_{ts}.csv"
    with open(filepath, "w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=records[0].keys())
        writer.writeheader()
        writer.writerows(records)
    print(f"Wrote {len(records)} records to {filepath}")
    return filepath


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Island Router Traffic ETL")
    parser.add_argument("--range", default="1h", help="Time range (e.g. 1h, 1d, 1w)")
    parser.add_argument("--output", choices=["json", "csv"], default="json")
    parser.add_argument("--dest", default="./traffic-data/")
    args = parser.parse_args()

    client, channel = connect()
    try:
        print(f"Extracting history (last {args.range})...")
        events = extract_history(channel, args.range)
        print(f"  → {len(events)} events")

        print("Extracting device map...")
        device_map = extract_device_map(channel)
        print(f"  → {len(device_map)} known devices")

        print("Extracting interface stats...")
        iface_stats = extract_interface_stats(channel)
        print(f"  → {len(iface_stats)} interfaces")

        print("Transforming...")
        records = transform(events, device_map)

        print(f"Loading to {args.output}...")
        if args.output == "json":
            load_json(records, args.dest)
        else:
            load_csv(records, args.dest)

        # Also save interface stats as a separate file
        load_json(
            [{"timestamp": datetime.now(timezone.utc).isoformat(), **iface_stats}],
            args.dest,
        )

        print("Done.")
    finally:
        channel.close()
        client.close()
```

**Cron schedule (hourly):**
```bash
# crontab -e
0 * * * * cd /opt/island-etl && /usr/bin/python3 etl_traffic.py --range 1h --output json --dest /data/traffic/ >> /var/log/island-etl.log 2>&1
```

---

## Transform Patterns

### Per-Device Bandwidth Aggregation

Group events by device and sum bytes for a given time period:

```python
from collections import defaultdict

def aggregate_by_device(records):
    """Roll up traffic data by device name."""
    by_device = defaultdict(lambda: {
        "bytes_rx": 0, "bytes_tx": 0, "bytes_total": 0,
        "event_count": 0, "destinations": set(),
    })

    for r in records:
        name = r["device_name"]
        by_device[name]["bytes_rx"] += r["bytes_rx"]
        by_device[name]["bytes_tx"] += r["bytes_tx"]
        by_device[name]["bytes_total"] += r["bytes_total"]
        by_device[name]["event_count"] += 1
        if r["destination"]:
            by_device[name]["destinations"].add(r["destination"])

    # Convert sets to counts for serialization
    return {
        name: {**stats, "unique_destinations": len(stats["destinations"])}
        for name, stats in by_device.items()
    }
```

### Category Breakdown

Map numeric category IDs to human-readable names and aggregate:

```python
# Island Router categories (typical mapping — verify against your router)
CATEGORY_MAP = {
    "1": "General/Uncategorized",
    "2": "Search Engines",
    "3": "Social Media",
    "4": "Streaming Video",
    "5": "Streaming Audio",
    "6": "News",
    "7": "Shopping",
    "8": "Gaming",
    "9": "Education",
    "10": "Business/Finance",
    # Add more based on your router's category database
}

def aggregate_by_category(records):
    """Roll up traffic by content category."""
    by_cat = defaultdict(lambda: {"bytes_total": 0, "event_count": 0})
    for r in records:
        cat_id = str(r.get("category", "0"))
        cat_name = CATEGORY_MAP.get(cat_id, f"Category {cat_id}")
        by_cat[cat_name]["bytes_total"] += r["bytes_total"]
        by_cat[cat_name]["event_count"] += 1
    return dict(by_cat)
```

### Top Destinations (Sites Visited)

```python
def top_destinations(records, limit=25):
    """Rank destinations by total bytes transferred."""
    by_dest = defaultdict(lambda: {
        "bytes_total": 0, "hit_count": 0, "devices": set(),
    })
    for r in records:
        dest = r["destination"]
        if not dest:
            continue
        by_dest[dest]["bytes_total"] += r["bytes_total"]
        by_dest[dest]["hit_count"] += 1
        by_dest[dest]["devices"].add(r["device_name"])

    ranked = sorted(by_dest.items(), key=lambda x: x[1]["bytes_total"], reverse=True)
    return [
        {"destination": dest, **{k: v for k, v in stats.items() if k != "devices"},
         "device_count": len(stats["devices"])}
        for dest, stats in ranked[:limit]
    ]
```

### Interface Rate Calculation

Convert cumulative counters to rates by diffing snapshots:

```python
def calculate_rates(prev_stats, curr_stats, interval_seconds):
    """Calculate bits-per-second from counter diffs.

    Args:
        prev_stats: Previous interface stats snapshot
        curr_stats: Current interface stats snapshot
        interval_seconds: Time between snapshots
    """
    rates = {}
    for iface in curr_stats:
        if iface not in prev_stats:
            continue
        tx_diff = curr_stats[iface]["tx_bytes"] - prev_stats[iface]["tx_bytes"]
        rx_diff = curr_stats[iface]["rx_bytes"] - prev_stats[iface]["rx_bytes"]

        # Handle counter rollover
        if tx_diff < 0:
            tx_diff = curr_stats[iface]["tx_bytes"]
        if rx_diff < 0:
            rx_diff = curr_stats[iface]["rx_bytes"]

        rates[iface] = {
            "tx_bps": (tx_diff * 8) / interval_seconds,
            "rx_bps": (rx_diff * 8) / interval_seconds,
            "tx_mbps": round((tx_diff * 8) / interval_seconds / 1_000_000, 2),
            "rx_mbps": round((rx_diff * 8) / interval_seconds / 1_000_000, 2),
        }
    return rates
```

---

## Load Targets

### Target 1: Grafana + Loki (Log-Based)

Push per-device events as structured log entries to Loki for LogQL querying.

**Promtail pipeline config (append to existing promtail-config.yaml):**

```yaml
scrape_configs:
  - job_name: island-traffic
    static_configs:
      - targets: [localhost]
        labels:
          job: island-traffic
          __path__: /data/traffic/traffic_*.json
    pipeline_stages:
      - json:
          expressions:
            device_name: device_name
            device_ip: device_ip
            destination: destination
            bytes_rx: bytes_rx
            bytes_tx: bytes_tx
            event_type: event_type
            category: category
      - labels:
          device_name:
          event_type:
          category:
      - metrics:
          traffic_bytes_total:
            type: Counter
            description: "Total bytes transferred"
            source: bytes_total
            config:
              action: add
```

**Grafana dashboard queries:**

| Panel | LogQL Query |
| --- | --- |
| Bytes by device (1h) | `sum by (device_name) (sum_over_time({job="island-traffic"} \| json \| unwrap bytes_total [1h]))` |
| Top destinations | `topk(10, sum by (destination) (count_over_time({job="island-traffic"} \| json [1h])))` |
| Traffic timeline | `sum(rate({job="island-traffic"} \| json \| unwrap bytes_total [5m])) by (device_name)` |
| Blocked categories | `{job="island-traffic"} \| json \| event_type = "denied"` |

### Target 2: InfluxDB (Time-Series)

Write per-device bandwidth as InfluxDB line protocol for precise time-series dashboards.

**Python loader:**

```python
from influxdb_client import InfluxDBClient, Point
from influxdb_client.client.write_api import SYNCHRONOUS

def load_influxdb(records, url="http://localhost:8086",
                  token="my-token", org="home", bucket="traffic"):
    """Write traffic records to InfluxDB as time-series points."""
    client = InfluxDBClient(url=url, token=token, org=org)
    write_api = client.write_api(write_options=SYNCHRONOUS)

    points = []
    for r in records:
        p = (Point("device_traffic")
             .tag("device_name", r["device_name"])
             .tag("device_mac", r["device_mac"])
             .tag("event_type", r["event_type"])
             .tag("category", r.get("category", ""))
             .tag("destination", r.get("destination", "")[:128])
             .field("bytes_rx", r["bytes_rx"])
             .field("bytes_tx", r["bytes_tx"])
             .field("bytes_total", r["bytes_total"]))
        points.append(p)

    write_api.write(bucket=bucket, record=points)
    print(f"Wrote {len(points)} points to InfluxDB")
    client.close()
```

**InfluxDB Flux queries for Grafana:**

| Panel | Flux Query |
| --- | --- |
| Top devices (1h) | `from(bucket:"traffic") \|> range(start: -1h) \|> filter(fn: (r) => r._measurement == "device_traffic") \|> sum() \|> group(columns: ["device_name"]) \|> sort(columns: ["_value"], desc: true)` |
| Bandwidth over time | `from(bucket:"traffic") \|> range(start: -24h) \|> filter(fn: (r) => r._field == "bytes_total") \|> aggregateWindow(every: 5m, fn: sum)` |

### Target 3: BigQuery (Data Warehouse)

For long-term retention and SQL analytics across large date ranges.

**Schema:**

```sql
CREATE TABLE IF NOT EXISTS `project.network.traffic_events` (
  timestamp TIMESTAMP,
  device_mac STRING,
  device_ip STRING,
  device_name STRING,
  event_type STRING,
  category STRING,
  destination STRING,
  destination_ip STRING,
  bytes_rx INT64,
  bytes_tx INT64,
  bytes_total INT64
)
PARTITION BY DATE(timestamp)
CLUSTER BY device_name, category;
```

**Python loader (uses google-cloud-bigquery):**

```python
from google.cloud import bigquery

def load_bigquery(records, table_id="project.network.traffic_events"):
    """Insert traffic records into BigQuery."""
    client = bigquery.Client()
    errors = client.insert_rows_json(table_id, records)
    if errors:
        print(f"BigQuery errors: {errors}")
    else:
        print(f"Loaded {len(records)} rows to {table_id}")
```

**Example analytics queries:**

```sql
-- Top 10 devices by total bandwidth (last 7 days)
SELECT device_name, SUM(bytes_total) AS total_bytes,
       ROUND(SUM(bytes_total) / 1073741824, 2) AS total_gb
FROM `project.network.traffic_events`
WHERE timestamp > TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 7 DAY)
GROUP BY device_name
ORDER BY total_bytes DESC
LIMIT 10;

-- Daily bandwidth breakdown by category
SELECT DATE(timestamp) AS day, category,
       ROUND(SUM(bytes_total) / 1073741824, 2) AS gb
FROM `project.network.traffic_events`
WHERE timestamp > TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 30 DAY)
GROUP BY day, category
ORDER BY day DESC, gb DESC;

-- Top 25 destinations by traffic volume this week
SELECT destination, COUNT(*) AS hit_count,
       ROUND(SUM(bytes_total) / 1048576, 1) AS total_mb
FROM `project.network.traffic_events`
WHERE timestamp > TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 7 DAY)
  AND destination IS NOT NULL AND destination != ''
GROUP BY destination
ORDER BY total_mb DESC
LIMIT 25;
```

### Target 4: CSV/Parquet Files (Local Storage)

For simple setups or as a staging area before loading to other platforms.

The ETL script's `load_csv()` and `load_json()` functions handle this directly. For Parquet (columnar, compressed):

```python
import pandas as pd

def load_parquet(records, dest_dir):
    """Write records to a timestamped Parquet file."""
    df = pd.DataFrame(records)
    ts = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    filepath = Path(dest_dir) / f"traffic_{ts}.parquet"
    df.to_parquet(filepath, index=False)
    print(f"Wrote {len(df)} records to {filepath}")
```

---

## Dashboard Recipes

### Recipe 1: Per-Device Bandwidth (Grafana + InfluxDB)

**Panels:**

| Panel | Type | Description |
| --- | --- | --- |
| Total bandwidth (24h) | Stat | Sum of all `bytes_total` in last 24h, formatted as GB |
| Active devices | Stat | Count of unique `device_name` values in last 1h |
| Bandwidth by device | Bar chart | Top 10 devices by `bytes_total` (1h window) |
| Traffic timeline | Time series | `bytes_total` per 5-minute bucket, grouped by device |
| Category breakdown | Pie chart | Percentage of traffic by content category |
| Top destinations | Table | Top 25 destinations ranked by total bytes |

### Recipe 2: Usage Report (Weekly Email)

Generate a weekly HTML or PDF report and send via email or Slack:

```python
def generate_weekly_report(records):
    """Create a summary report dictionary."""
    by_device = aggregate_by_device(records)
    by_category = aggregate_by_category(records)
    top_sites = top_destinations(records, limit=10)

    total_bytes = sum(r["bytes_total"] for r in records)

    return {
        "period": "Last 7 days",
        "total_traffic_gb": round(total_bytes / 1073741824, 2),
        "total_events": len(records),
        "unique_devices": len(by_device),
        "top_devices": sorted(
            by_device.items(),
            key=lambda x: x[1]["bytes_total"],
            reverse=True,
        )[:10],
        "category_breakdown": by_category,
        "top_destinations": top_sites,
    }
```

### Recipe 3: Real-Time Activity Feed (WebSocket)

For a live activity dashboard, poll the router in near real-time:

```python
import asyncio

async def activity_feed(interval=30):
    """Poll router every N seconds for recent history."""
    client, channel = connect()
    prev_events = set()

    try:
        while True:
            events = extract_history(channel, "5m")
            new_events = [e for e in events if id(e) not in prev_events]

            if new_events:
                # Push to WebSocket, file, or queue
                yield new_events
                prev_events.update(id(e) for e in events)

            await asyncio.sleep(interval)
    finally:
        channel.close()
        client.close()
```

> ⚠️ **Rate-limiting warning:** Maintain a **single persistent SSH connection** for real-time polling. Do NOT open new connections per poll — the router's `MaxStartups` constraint will lock you out.

---

## Important Limitations

### No Native Per-Device Counters

The Island Router does **not** maintain cumulative per-device byte counters like some enterprise routers. Instead:
- **Event history** provides per-event byte counts that can be summed
- **Interface counters** are aggregate (entire WAN/LAN), not per-device
- Accurate per-device totals require **continuous event history collection** without gaps

### History Retention

- The router's history buffer has a finite size
- Old events are evicted when the buffer fills
- For complete coverage, poll frequently enough that no events are lost between extractions
- **Recommended polling interval:** Every 30-60 minutes for hourly JSON exports

### Category Mapping

- Content category numbers are router-specific
- The mapping between numbers and category names may change with firmware updates
- Build your own mapping table from observed data or Island's documentation

### DNS Visibility

- The router sees DNS queries for standard DNS (port 53)
- Traffic using **DNS over HTTPS (DoH)** bypasses the router's visibility
- To ensure full visibility, configure clients to use the router as their DNS resolver and block external DoH endpoints

---

## Quick Start Checklist

- [ ] **Extract:** Choose your method (MCP, router push, or cron script)
- [ ] **Device map:** Run `show ip dhcp-reservations csv` to build MAC → hostname lookup
- [ ] **First pull:** Extract 1 hour of history: `show history begin 1h first json:`
- [ ] **Transform:** Enrich events with device names, aggregate by device
- [ ] **Load:** Write to your target (start with JSON files, graduate to InfluxDB/BigQuery)
- [ ] **Automate:** Set up cron job or history instance for continuous extraction
- [ ] **Dashboard:** Build your first Grafana panel (bandwidth by device, last 24h)
- [ ] **Validate:** Confirm no event gaps by checking record counts across intervals

---

## Relationship to Other Skills

| Skill | Relationship |
| --- | --- |
| `island-router-cli` | Source reference for all CLI commands and output formats |
| `skill-observability-pipeline` | Covers **syslog** forwarding (system logs, not traffic data). Complementary — use both for full observability |
| `skill-homelab-pi` | Target deployment platform for the ETL receiver and analytics stack |
| `skill-finops-gcp` | BigQuery loading patterns for long-term traffic analytics |
| `skill-network-fleet` | Multi-device ETL across a fleet of Island Routers |
