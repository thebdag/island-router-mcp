---
name: skill-meta-pipeline
description: "Orchestrate the full skill lifecycle from idea to published quality skill. Chains skill-creator → skill-scanner → skill-check → skill-installer → skill-sentinel → skill-improver into a single supervised pipeline. Use when creating a new skill end-to-end, running the full validation pipeline, or automating skill quality assurance."
category: meta
risk: safe
source: community
tags: [skill-lifecycle, orchestration, pipeline, quality-assurance, meta-skill]
date_added: "2026-04-01"
---

# Skill Lifecycle Pipeline

Orchestrate the complete skill lifecycle — from idea to published, quality-verified skill — by chaining existing meta-skills into a supervised pipeline.

## When to Use

- Creating a new skill and want the full quality pipeline in one flow
- Running batch validation across multiple skills
- Ensuring a skill meets all quality gates before publishing
- Resuming a partially completed skill creation workflow

## When NOT to Use

- Quick one-off edits to an existing skill (edit directly)
- Running a single validation check (use `skill-check` directly)
- Reviewing a skill without fixing it (use skill-check or skill-scanner)

---

## Pipeline Stages

```
┌─────────────┐    ┌──────────────┐    ┌─────────────┐
│ 1. CREATE   │───▶│ 2. SCAN      │───▶│ 3. CHECK    │
│ skill-writer│    │ skill-scanner│    │ skill-check │
└─────────────┘    └──────────────┘    └─────────────┘
       │                  │                   │
       │            [security issues?]  [quality issues?]
       │              ▼ STOP              ▼ FIX
       │                                      │
┌─────────────┐    ┌──────────────┐    ┌─────────────┐
│ 6. IMPROVE  │◀───│ 5. AUDIT     │◀───│ 4. INSTALL  │
│ skill-      │    │ skill-       │    │ skill-      │
│ improver    │    │ sentinel     │    │ installer   │
└─────────────┘    └──────────────┘    └─────────────┘
       │
       ▼
  ✅ PUBLISHED
```

---

## Stage 1: Create

**Skill:** `skill-writer` or `skill-creator`

**Input:** Skill idea, purpose, target domain
**Output:** `SKILL.md` + optional `references/`, `scripts/`

**Decision point:** After creation, inspect the generated skill directory:
- Confirm `SKILL.md` exists with valid frontmatter
- Confirm the description includes trigger keywords
- Verify the file is under 500 lines

**Proceed when:** SKILL.md exists with `name` and `description` in frontmatter.

---

## Stage 2: Security Scan

**Skill:** `skill-scanner`

**Input:** Path to the skill directory
**Output:** Security assessment (Clean / Low / Medium / High / Critical)

**Gate rule:**
- **Critical or High findings** → STOP. Present findings. Do not proceed until resolved.
- **Medium findings** → Present findings. Ask user whether to proceed or fix first.
- **Low or Clean** → Proceed automatically.

**Proceed when:** No critical or high security findings remain.

---

## Stage 3: Quality Check

**Skill:** `skill-check`

**Input:** Path to `SKILL.md`
**Output:** Score (0-100), grade, issue list

**Gate rule:**
- **Score < 60 (Poor)** → Fix critical and warning issues before proceeding.
- **Score 60-84 (Needs Work)** → Fix warnings; suggestions are optional.
- **Score ≥ 85 (Good/Excellent)** → Proceed.

**Auto-fixable issues:**
- Missing WHEN clause in description → append trigger info
- Second-person voice → rewrite in imperative
- Missing negative triggers → add "When NOT to Use" section

**Proceed when:** Score ≥ 85 or all warnings resolved.

---

## Stage 4: Install

**Skill:** `skill-installer`

**Input:** Skill directory path
**Output:** Installed to skills/, registered, packaged

**Steps executed:**
1. Validate source
2. Copy to skills directory
3. Register in CLI
4. Update registry
5. Package ZIP (if applicable)
6. Verify installation

**Proceed when:** Installation verification passes (all 5 checks green).

---

## Stage 5: Ecosystem Audit

**Skill:** `skill-sentinel`

**Input:** Newly installed skill name
**Output:** Audit report with scores across 7 dimensions

**Gate rule:**
- Check for duplications with existing skills
- Verify documentation score ≥ 70%
- Verify security score ≥ 80%
- Flag any cross-skill issues

**Proceed when:** No critical audit findings and overall score ≥ 70.

---

## Stage 6: Iterative Improvement

**Skill:** `skill-improver`

**Input:** Skill path + audit findings from Stage 5
**Output:** Improved skill that passes all quality gates

**Loop:**
1. Feed audit findings to the improver
2. Apply fixes for critical and major issues
3. Re-run skill-check to verify fixes
4. Repeat until quality bar is met
5. Output `<skill-improvement-complete>` marker

**Terminal condition:** All critical/major issues resolved and score ≥ 85.

---

## Pipeline Modes

### Full Pipeline (default)

Run all 6 stages in sequence. Pause at each gate for user review.

```
Run full pipeline for skill at <path>
```

### Validate Only (stages 2-3)

Scan and check without creating or installing.

```
Validate skill at <path>
```

### Install and Audit (stages 4-5)

For skills that already pass quality checks.

```
Install and audit skill at <path>
```

### Resume

Pick up from a specific stage after fixing issues.

```
Resume pipeline for <skill-name> at stage 3
```

---

## Pipeline State Tracking

Track progress using this template:

```
## Pipeline: <skill-name>

| Stage | Status | Score/Result | Notes |
|---|---|---|---|
| 1. Create | ✅ Complete | SKILL.md created | 287 lines |
| 2. Scan | ✅ Clean | Low risk | No findings |
| 3. Check | ✅ Good | 92/100 | 1 suggestion skipped |
| 4. Install | ✅ Installed | 5/5 checks | Registered + ZIP |
| 5. Audit | ✅ Passed | 78/100 overall | Cross-skill: no dupes |
| 6. Improve | ✅ Complete | 91/100 final | 2 fixes applied |

**Result:** ✅ Published
```

---

## Error Handling

| Error | Stage | Recovery |
|---|---|---|
| SKILL.md missing frontmatter | 1 | Re-run skill-writer with explicit frontmatter prompt |
| Critical security finding | 2 | Show finding, STOP pipeline, require manual review |
| Score below 60 | 3 | Auto-fix what's possible, re-check, escalate to user |
| Install conflict (existing skill) | 4 | Ask: overwrite, rename, or abort |
| Duplicate detected in audit | 5 | Show both skills, ask user to merge or differentiate |
| Improvement loop stuck (>5 iterations) | 6 | Show remaining issues, ask user to accept or manually fix |
