---
name: skill-finops-gcp
description: "Analyze and optimize Google Cloud Platform costs using BigQuery billing exports, budget alerts, and automation. Covers billing export setup, cost queries, anomaly detection, rightsizing Cloud Run and GKE workloads, and FinOps dashboard creation. Use when investigating GCP spend, setting up cost alerts, or building FinOps automation."
category: cloud
risk: safe
source: community
tags: [finops, gcp, google-cloud, billing, cost-optimization, bigquery, cloud-run, budget-alerts]
date_added: "2026-04-01"
---

# GCP FinOps & Cost Optimization

Analyze, monitor, and optimize Google Cloud Platform costs using BigQuery billing exports and automation.

## When to Use

- Investigating unexpected GCP cost increases
- Setting up billing export and cost dashboards
- Creating budget alerts and automated responses
- Rightsizing Cloud Run services or GKE workloads
- Building FinOps automation pipelines (data refresh, anomaly detection)
- Tag-based cost allocation analysis
- Preparing cost reports for stakeholders

## When NOT to Use

- AWS cost optimization (use `aws-cost-optimizer` or `aws-cost-cleanup`)
- Azure cost management (use Azure-specific skills)
- General financial modeling (use startup financial skills)

---

## Prerequisites

- GCP project with billing enabled
- BigQuery billing export configured (standard or detailed)
- `bq` CLI or BigQuery API access
- Cloud Run MCP or `gcloud` CLI for service management

---

## Step 1: Enable Billing Export

### Standard Usage Cost Export

```bash
# Via gcloud
gcloud billing accounts list
gcloud alpha billing accounts export enable \
  --billing-account=ACCOUNT_ID \
  --project=PROJECT_ID \
  --dataset=billing_export
```

Or configure via Console: **Billing → Billing export → BigQuery export → Enable**.

### Export Tables

| Table | Contents | Granularity |
|---|---|---|
| `gcp_billing_export_v1_*` | Standard cost + usage | Daily |
| `gcp_billing_export_resource_v1_*` | Resource-level detail | Daily |
| `cloud_pricing_export` | Published pricing data | Updated periodically |

---

## Step 2: Core Cost Queries

### Daily Spend by Service (last 30 days)

```sql
SELECT
  invoice.month AS month,
  service.description AS service,
  ROUND(SUM(cost) + SUM(IFNULL((SELECT SUM(c.amount) FROM UNNEST(credits) AS c), 0)), 2) AS net_cost
FROM `PROJECT.billing_export.gcp_billing_export_v1_XXXXXX`
WHERE DATE(_PARTITIONTIME) >= DATE_SUB(CURRENT_DATE(), INTERVAL 30 DAY)
GROUP BY month, service
ORDER BY net_cost DESC
LIMIT 20;
```

### Top 10 Costliest Resources

```sql
SELECT
  project.id AS project,
  service.description AS service,
  sku.description AS sku,
  resource.name AS resource_name,
  ROUND(SUM(cost), 2) AS total_cost
FROM `PROJECT.billing_export.gcp_billing_export_resource_v1_XXXXXX`
WHERE DATE(_PARTITIONTIME) >= DATE_SUB(CURRENT_DATE(), INTERVAL 30 DAY)
GROUP BY project, service, sku, resource_name
ORDER BY total_cost DESC
LIMIT 10;
```

### Cost by Label / Tag

```sql
SELECT
  label.key,
  label.value,
  ROUND(SUM(cost), 2) AS total_cost
FROM `PROJECT.billing_export.gcp_billing_export_v1_XXXXXX`,
  UNNEST(labels) AS label
WHERE DATE(_PARTITIONTIME) >= DATE_SUB(CURRENT_DATE(), INTERVAL 30 DAY)
GROUP BY label.key, label.value
ORDER BY total_cost DESC;
```

### Daily Cost Trend

```sql
SELECT
  DATE(usage_start_time) AS day,
  ROUND(SUM(cost), 2) AS daily_cost
FROM `PROJECT.billing_export.gcp_billing_export_v1_XXXXXX`
WHERE DATE(_PARTITIONTIME) >= DATE_SUB(CURRENT_DATE(), INTERVAL 90 DAY)
GROUP BY day
ORDER BY day;
```

---

## Step 3: Anomaly Detection

### Simple Threshold: Day-over-Day Spike

```sql
WITH daily AS (
  SELECT
    DATE(usage_start_time) AS day,
    ROUND(SUM(cost), 2) AS cost
  FROM `PROJECT.billing_export.gcp_billing_export_v1_XXXXXX`
  WHERE DATE(_PARTITIONTIME) >= DATE_SUB(CURRENT_DATE(), INTERVAL 14 DAY)
  GROUP BY day
),
with_change AS (
  SELECT
    day,
    cost,
    LAG(cost) OVER (ORDER BY day) AS prev_cost,
    ROUND((cost - LAG(cost) OVER (ORDER BY day)) / NULLIF(LAG(cost) OVER (ORDER BY day), 0) * 100, 1) AS pct_change
  FROM daily
)
SELECT * FROM with_change
WHERE pct_change > 25  -- flag >25% day-over-day increases
ORDER BY day DESC;
```

### Rolling Average Deviation

```sql
WITH daily AS (
  SELECT DATE(usage_start_time) AS day, ROUND(SUM(cost), 2) AS cost
  FROM `PROJECT.billing_export.gcp_billing_export_v1_XXXXXX`
  WHERE DATE(_PARTITIONTIME) >= DATE_SUB(CURRENT_DATE(), INTERVAL 30 DAY)
  GROUP BY day
)
SELECT
  day, cost,
  ROUND(AVG(cost) OVER (ORDER BY day ROWS BETWEEN 6 PRECEDING AND CURRENT ROW), 2) AS rolling_7d_avg,
  ROUND(cost - AVG(cost) OVER (ORDER BY day ROWS BETWEEN 6 PRECEDING AND CURRENT ROW), 2) AS deviation
FROM daily
ORDER BY day DESC;
```

---

## Step 4: Budget Alerts

### Create via gcloud

```bash
gcloud billing budgets create \
  --billing-account=ACCOUNT_ID \
  --display-name="Monthly $500 Budget" \
  --budget-amount=500USD \
  --threshold-rules=percent=0.5,basis=CURRENT_SPEND \
  --threshold-rules=percent=0.9,basis=CURRENT_SPEND \
  --threshold-rules=percent=1.0,basis=CURRENT_SPEND \
  --notifications-pubsub-topic=projects/PROJECT/topics/billing-alerts
```

### Automated Response (Cloud Function)

Create a Pub/Sub-triggered Cloud Function to react to budget alerts:

```python
import base64
import json
from google.cloud import run_v2

def budget_alert_handler(event, context):
    """Scale down Cloud Run services when budget exceeded."""
    data = json.loads(base64.b64decode(event["data"]).decode())

    cost_amount = data.get("costAmount", 0)
    budget_amount = data.get("budgetAmount", 0)

    if cost_amount > budget_amount:
        print(f"BUDGET EXCEEDED: ${cost_amount} > ${budget_amount}")
        # Scale down non-critical services
        scale_down_services(project="my-project", region="us-central1")

def scale_down_services(project, region):
    """Set min-instances to 0 for non-critical services."""
    client = run_v2.ServicesClient()
    parent = f"projects/{project}/locations/{region}"
    for service in client.list_services(parent=parent):
        if "critical" not in service.labels:
            # Log but don't auto-scale in production without approval
            print(f"Would scale down: {service.name}")
```

---

## Step 5: Cloud Run Rightsizing

### Identify Over-Provisioned Services

```bash
# List all services with resource settings
gcloud run services list --format="table(
  metadata.name,
  spec.template.spec.containers[0].resources.limits.cpu,
  spec.template.spec.containers[0].resources.limits.memory,
  status.traffic[0].percent
)" --project=PROJECT_ID
```

### Check Actual Usage vs Limits

Use Cloud Monitoring to compare allocated vs actual:

```bash
# CPU utilization (last 7 days)
gcloud monitoring read \
  "fetch cloud_run_revision | metric 'run.googleapis.com/container/cpu/utilizations' | \
   filter resource.service_name = 'SERVICE_NAME' | \
   within 7d | every 1h | group_by [], [mean(val())]"
```

### Rightsizing Recommendations

| Current | Observed Peak | Recommendation |
|---|---|---|
| 2 vCPU / 1Gi | 0.2 vCPU / 256Mi | Reduce to 1 vCPU / 512Mi |
| Always-on (min=1) | 3 req/hour | Set min=0, use startup CPU boost |
| 2nd gen execution | Simple HTTP handler | Consider 1st gen for lower cost |

---

## Step 6: Data Refresh Pipeline

### Scheduled Query in BigQuery

Create a scheduled query that materializes a daily cost summary:

```sql
-- Scheduled query: daily_cost_summary (runs daily at 06:00 UTC)
CREATE OR REPLACE TABLE `PROJECT.billing_export.daily_cost_summary` AS
SELECT
  DATE(usage_start_time) AS day,
  project.id AS project,
  service.description AS service,
  ROUND(SUM(cost), 2) AS gross_cost,
  ROUND(SUM(IFNULL((SELECT SUM(c.amount) FROM UNNEST(credits) AS c), 0)), 2) AS credits,
  ROUND(SUM(cost) + SUM(IFNULL((SELECT SUM(c.amount) FROM UNNEST(credits) AS c), 0)), 2) AS net_cost
FROM `PROJECT.billing_export.gcp_billing_export_v1_XXXXXX`
WHERE DATE(_PARTITIONTIME) >= DATE_SUB(CURRENT_DATE(), INTERVAL 90 DAY)
GROUP BY day, project, service;
```

### Troubleshooting Data Refresh Failures

| Symptom | Cause | Fix |
|---|---|---|
| No new data | Billing export lag (up to 24h) | Wait; check export config |
| Query fails | Table reference outdated | Verify table suffix matches billing account |
| Stale dashboard | Scheduled query not running | Check BigQuery transfer runs |
| Permission denied | Service account missing roles | Grant `bigquery.dataViewer` + `bigquery.jobUser` |

---

## Quick Reference: Cost Reduction Levers

| Lever | Savings Potential | Effort |
|---|---|---|
| Committed Use Discounts (CUDs) | 25-57% | Low — purchase commitment |
| Sustained Use Discounts (auto) | Up to 30% | Zero — automatic |
| Cloud Run min-instances=0 | 50-90% for low-traffic | Low |
| Preemptible/Spot VMs | 60-80% | Medium — must handle interruptions |
| Storage class lifecycle rules | 40-80% on cold data | Low |
| Remove idle resources | 100% of waste | Medium — requires audit |
| Right-size instances | 20-50% | Medium — requires monitoring data |

---

## Verification Checklist

- [ ] Billing export enabled and data flowing to BigQuery
- [ ] Core cost queries return meaningful results
- [ ] Budget alerts configured with appropriate thresholds
- [ ] Daily cost summary materialized table created
- [ ] Scheduled query runs successfully
- [ ] Grafana or Looker Studio dashboard connected to BigQuery
- [ ] Anomaly detection query identifies real spikes
- [ ] Cloud Run services reviewed for rightsizing opportunities
