# Agent skills

Primary skill tree for this repo. Codex / OpenCode also resolve `.agents/skills/` (symlink here).

| Skill | Domain | Load when |
| --- | --- | --- |
| [`island-axi`](./island-axi/SKILL.md) | AXI CLI | Operating or extending `island-axi` |
| [`axi`](./axi/SKILL.md) | Standards | Designing agent-ergonomic CLIs ([axi.md](https://axi.md/)) |
| [`island-router-cli`](./island-router-cli/SKILL.md) | Island CLI | Exact command syntax (fw 2.3.2) |
| [`skill-mcp-builder`](./skill-mcp-builder/SKILL.md) | MCP | Building / changing MCP tools |
| [`skill-network-fleet`](./skill-network-fleet/SKILL.md) | Networking | Multi-device fleet / drift |
| [`skill-firmware-differ`](./skill-firmware-differ/SKILL.md) | Networking | Firmware upgrades |
| [`skill-network-traffic-etl`](./skill-network-traffic-etl/SKILL.md) | Analytics | Traffic ETL |
| [`skill-observability-pipeline`](./skill-observability-pipeline/SKILL.md) | DevOps | Syslog → Grafana |
| [`skill-homelab-pi`](./skill-homelab-pi/SKILL.md) | DevOps | Pi / Docker hosts |
| [`skill-finops-gcp`](./skill-finops-gcp/SKILL.md) | Cloud | GCP cost |
| [`skill-mcp-orchestrator`](./skill-mcp-orchestrator/SKILL.md) | Automation | Cross-MCP recipes |
| [`skill-meta-pipeline`](./skill-meta-pipeline/SKILL.md) | Meta | Skill lifecycle |
| [`skill-knowledge-harvester`](./skill-knowledge-harvester/SKILL.md) | Meta | Conversation → knowledge items |

Installable copy of the AXI skill also lives at `skills/island-axi/` (keep in sync with `.agent/skills/island-axi/`).

See [`AGENTS.md`](../../AGENTS.md) for workflow.
