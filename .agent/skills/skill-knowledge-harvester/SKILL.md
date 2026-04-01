---
name: skill-knowledge-harvester
description: "Extract reusable knowledge from completed conversations and codify it into structured Knowledge Items (KIs). Analyzes conversation logs for decisions, workarounds, architecture patterns, and gotchas, then deduplicates against existing KIs and creates new ones. Use when harvesting learnings from past work, updating stale knowledge, or building a project knowledge base."
category: meta
risk: safe
source: community
tags: [knowledge-management, KI, conversation-mining, documentation, learning, context]
date_added: "2026-04-01"
---

# Knowledge Harvester

Extract reusable knowledge from completed conversations and codify it into structured Knowledge Items (KIs).

## When to Use

- After completing a complex debugging session
- After making important architecture decisions
- When you notice you're solving the same problem again
- Periodically (weekly) to mine recent conversations for unmined learnings
- When onboarding to understand what past-you learned about a codebase
- After incident resolution to capture root cause and fix

## When NOT to Use

- For scratch notes or temporary thoughts (use task.md instead)
- For code documentation (use inline comments and READMEs)
- For project status updates (use Jira/Confluence)

---

## Knowledge Item (KI) Structure

Each KI lives in `<appDataDir>/knowledge/<ki-id>/`:

```
knowledge/
├── <ki-id>/
│   ├── metadata.json        # Summary, timestamps, references
│   └── artifacts/
│       ├── main.md           # The core knowledge document
│       └── <supporting files>
```

### metadata.json Format

```json
{
  "id": "<ki-id>",
  "title": "Descriptive Title of What Was Learned",
  "summary": "One paragraph summary of the knowledge captured.",
  "created": "2026-04-01T15:30:00Z",
  "updated": "2026-04-01T15:30:00Z",
  "tags": ["topic1", "topic2"],
  "references": [
    {
      "type": "conversation",
      "id": "<conversation-id>",
      "title": "Original conversation title"
    },
    {
      "type": "file",
      "path": "/absolute/path/to/relevant/file"
    }
  ],
  "corpus": "repo-name-or-workspace"
}
```

---

## Extraction Process

### Step 1: Identify Candidate Conversations

Review recent conversation summaries for knowledge-rich patterns:

| Signal | Example | KI Type |
|---|---|---|
| Bug fix with root cause | "timeout was caused by..." | Gotcha / Debugging |
| Architecture decision | "we chose X because..." | Architecture Decision Record |
| Workaround discovered | "the fix is to set X=Y" | Workaround |
| Tool/config learned | "MCP config needs $typeName removed" | Configuration Pattern |
| Performance fix | "reduced latency by..." | Optimization |
| Repeated question | Asked same thing in 3 conversations | FAQ / Reference |

### Step 2: Read Conversation Logs

```
# Conversation logs location:
<appDataDir>/brain/<conversation-id>/.system_generated/logs/overview.txt
```

Read the `overview.txt` to find the key moments:
- Error messages and how they were resolved
- Decisions made and their rationale
- Commands run and their results
- Files modified and why

### Step 3: Extract Knowledge

For each piece of knowledge found, extract:

1. **What happened** — the problem or situation
2. **Why it happened** — the root cause or context
3. **What was done** — the solution or decision
4. **How to apply it** — actionable steps for next time
5. **References** — conversation ID, files, URLs

### Step 4: Deduplicate

Before creating a new KI, check existing KIs:

```
ls <appDataDir>/knowledge/
```

Read `metadata.json` of potential duplicates. If a relevant KI exists:
- **Update** the existing KI with new information
- **Merge** if two KIs cover the same topic
- **Skip** if the knowledge is already well-captured

### Step 5: Write the KI

Create the knowledge item following the structure above.

---

## KI Templates

### Template: Debugging Gotcha

```markdown
# <Problem Title>

## Symptom
<What the user sees — error messages, unexpected behavior>

## Root Cause
<Why it happens — the underlying issue>

## Fix
<Exact steps to resolve>

## Prevention
<How to avoid this in the future>

## Context
- Repo: <repository name>
- Files: <affected files>
- First seen: <date>
```

### Template: Architecture Decision

```markdown
# ADR: <Decision Title>

## Status
Accepted / Proposed / Deprecated

## Context
<What problem prompted this decision>

## Decision
<What was decided and why>

## Alternatives Considered
| Option | Pros | Cons | Reason Rejected |
|---|---|---|---|
| Option A | ... | ... | ... |
| Option B | ... | ... | ... |

## Consequences
<What follows from this decision — positive and negative>
```

### Template: Configuration Pattern

```markdown
# <Tool/Service> Configuration: <Specific Pattern>

## When to Apply
<Trigger conditions>

## Configuration
```<language>
<exact configuration snippet>
```

## Key Parameters
| Parameter | Value | Why |
|---|---|---|

## Gotchas
- <common mistake 1>
- <common mistake 2>
```

---

## Harvesting Schedule

| Frequency | Action | Focus |
|---|---|---|
| After each complex task | Quick harvest | Debugging gotchas, one-off fixes |
| Weekly | Batch harvest | Review all conversations from the week |
| Monthly | Knowledge audit | Check for stale KIs, merge duplicates |

---

## Quality Criteria for KIs

| Criterion | Standard |
|---|---|
| Actionable | Reader can apply the knowledge without additional research |
| Specific | Includes exact commands, file paths, or config values |
| Contextual | States when and where this applies |
| Referenced | Links to source conversations and files |
| Dated | Timestamps for creation and last update |
| Deduplicated | No overlapping KIs covering the same topic |

---

## Verification Checklist

- [ ] Conversation log reviewed for knowledge-rich segments
- [ ] Extracted knowledge is actionable and specific
- [ ] KI deduplicated against existing knowledge items
- [ ] metadata.json includes references to source conversations
- [ ] KI artifacts contain exact commands, configs, or code
- [ ] Tags are consistent with existing KI tag taxonomy
- [ ] KI is findable via its title and summary
