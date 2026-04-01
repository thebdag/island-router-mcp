---
name: skill-mcp-orchestrator
description: "Chain multiple MCP server calls into end-to-end workflows. Recipes for Jira + Cloud Run + Confluence, incident triage, sprint automation, and router management pipelines. Use when automating cross-tool workflows, chaining MCP calls, or building end-to-end automation across Atlassian, GCP, and infrastructure tools."
category: automation
risk: safe
source: community
tags: [mcp, orchestration, workflow, jira, confluence, cloud-run, automation, cross-tool]
date_added: "2026-04-01"
---

# Cross-MCP Workflow Orchestrator

Chain calls across multiple MCP servers to build end-to-end automated workflows spanning Jira, Confluence, Cloud Run, network devices, and more.

## When to Use

- Automating multi-step workflows that span multiple tools
- Creating Jira issues and linking them to deployments
- Documenting infrastructure changes in Confluence automatically
- Building incident triage pipelines (detect → ticket → investigate → document)
- Sprint planning automation
- Deploying code and updating all tracking systems

## When NOT to Use

- Single-tool operations (use the specific MCP server directly)
- Building new MCP servers (use `skill-mcp-builder`)
- Complex data pipelines (use data engineering skills)

---

## Available MCP Servers

| Server | Key Tools | Domain |
|---|---|---|
| `atlassian-mcp-server` | Jira issues, Confluence pages, search | Project management, docs |
| `cloudrun` | Deploy, service management, logs | GCP deployment |
| `island-router-mcp` | Query, configure network devices | Network infrastructure |
| `context7` | Documentation search | Library/framework docs |
| `google-developer-knowledge-mcp` | Google product docs | Google APIs |

---

## Recipe 1: Deploy and Document

**Trigger:** "deploy and document" or "ship and update Jira"

**Flow:**
1. Deploy to Cloud Run
2. Get service URL and status
3. Update Jira issue with deployment info
4. Create/update Confluence page with release notes

### Steps

```
Step 1: Deploy
  cloudrun → deploy_local_folder or deploy_container_image
  Capture: service URL, revision, status

Step 2: Verify
  cloudrun → get_service
  Confirm: service is healthy, URL is reachable

Step 3: Update Jira
  atlassian → editJiraIssue
  Add comment with deployment details:
    - Service URL
    - Revision/version
    - Deployment timestamp
    - Status

Step 4: Transition Jira
  atlassian → transitionJiraIssue
  Move to "Done" or "Deployed" status

Step 5: Update Confluence
  atlassian → updateConfluencePage (or createConfluencePage)
  Add deployment entry to release notes page
```

---

## Recipe 2: Incident Triage

**Trigger:** "triage incident" or "service is down"

**Flow:**
1. Gather service logs and status
2. Check network infrastructure
3. Create Jira incident ticket
4. Document findings in Confluence

### Steps

```
Step 1: Check Service Health
  cloudrun → get_service (status, URL, traffic)
  cloudrun → get_service_log (recent errors)

Step 2: Check Network (if applicable)
  island-router → island_query action: status
  island-router → island_query action: logs

Step 3: Create Incident Ticket
  atlassian → createJiraIssue
    type: Bug
    priority: High
    summary: "[INCIDENT] <service-name> — <symptom>"
    description: Include service logs, network status, timestamps

Step 4: Document Investigation
  atlassian → createConfluencePage
    title: "Incident: <date> — <service-name>"
    body: Timeline, logs, root cause hypothesis, resolution steps

Step 5: Link Ticket to Page
  atlassian → addCommentToJiraIssue
    Link to Confluence page
```

---

## Recipe 3: Sprint Planning

**Trigger:** "plan sprint" or "create sprint tasks"

**Flow:**
1. Search Jira for backlog items
2. Estimate and prioritize
3. Create sub-tasks for approved items
4. Update Confluence sprint planning page

### Steps

```
Step 1: Get Backlog
  atlassian → searchJiraIssuesUsingJql
    JQL: "project = PROJ AND status = Backlog ORDER BY priority DESC"

Step 2: Review and Select
  Present backlog items with priority and estimates
  Get user approval on sprint scope

Step 3: Create Sub-tasks
  For each approved item:
    atlassian → createJiraIssue (type: Sub-task, parent: <story-key>)

Step 4: Update Sprint Page
  atlassian → updateConfluencePage
    Add sprint goals, committed items, capacity
```

---

## Recipe 4: Network Change → Document → Ticket

**Trigger:** "configure router and track"

**Flow:**
1. Apply network configuration change
2. Verify the change took effect
3. Create Jira change record
4. Document in Confluence runbook

### Steps

```
Step 1: Apply Change
  island-router → island_configure
    action: <action>, confirmation_phrase: "apply_change"

Step 2: Verify
  island-router → island_query action: config
  Confirm change appears in running-config

Step 3: Create Change Record
  atlassian → createJiraIssue
    type: Task
    summary: "[CHANGE] <device-id> — <change-description>"
    description: Before/after config diff

Step 4: Update Runbook
  atlassian → updateConfluencePage
    Append change entry with timestamp, who, what, why
```

---

## Recipe 5: Research and Create

**Trigger:** "research and build" or "look up docs and implement"

**Flow:**
1. Search documentation for implementation guidance
2. Create a Jira task for the work
3. Implement based on docs
4. Document the approach in Confluence

### Steps

```
Step 1: Research
  context7 → resolve-library-id → query-docs
  OR google-developer-knowledge-mcp → search_documents → get_documents

Step 2: Create Task
  atlassian → createJiraIssue
    summary: "Implement <feature>"
    description: Summary of research findings + approach

Step 3: Implement
  Use the appropriate development skill or manual coding

Step 4: Document
  atlassian → createConfluencePage
    Architecture decision record with research sources
```

---

## Orchestration Patterns

### Sequential Chain

Execute steps one after another, passing outputs forward:

```
Result_A = MCP_1.tool_x(params)
Result_B = MCP_2.tool_y(params + Result_A.data)
Result_C = MCP_3.tool_z(params + Result_B.data)
```

### Error Handling Across Boundaries

```
try:
  deploy_result = cloudrun.deploy(...)
  if deploy_result.status != "healthy":
    raise DeploymentFailed(deploy_result)
  jira.update(issue, status="deployed")
except DeploymentFailed:
  jira.update(issue, comment="Deployment failed: <logs>")
  jira.transition(issue, status="Blocked")
```

### Parallel Where Possible

When operations have no dependencies, run them in parallel:

```
# These can run simultaneously:
parallel:
  - cloudrun.get_service_log(service)    # gather logs
  - island_router.query(action: status)  # check network
  - jira.search(project: PROJ)           # get related tickets

# Then use combined results:
sequential:
  - create_incident_report(logs, network_status, related_tickets)
```

---

## Best Practices

| Do | Don't |
|---|---|
| Verify each step before proceeding | Assume success — check results |
| Include rollback plan for write operations | Chain write operations without verification |
| Log intermediate results for debugging | Silently swallow errors |
| Ask for user confirmation on destructive steps | Auto-apply cross-tool changes without review |
| Keep recipes focused (3-5 steps) | Build monolithic 20-step chains |
| Use Jira issue keys as correlation IDs | Lose track of which ticket maps to which deploy |
