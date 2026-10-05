# Agent skills

Primary skill tree for this repo. Codex / OpenCode also resolve `.agents/skills/` (symlink here).

| Skill | Domain | Load when |
| --- | --- | --- |
| [`island-axi`](./island-axi/SKILL.md) | AXI CLI | Operating or extending `island-axi` |
| [`axi`](./axi/SKILL.md) | Standards | Designing agent-ergonomic CLIs ([axi.md](https://axi.md/)) |
| [`island-router-cli`](./island-router-cli/SKILL.md) | Island CLI | Exact command syntax (fw 2.3.2) |
| [`skill-network-fleet`](./skill-network-fleet/SKILL.md) | Networking | Multi-device Island Router fleet / drift |
| [`skill-firmware-differ`](./skill-firmware-differ/SKILL.md) | Networking | Island Router firmware upgrades |
| [`skill-network-traffic-etl`](./skill-network-traffic-etl/SKILL.md) | Analytics | Island Router traffic ETL |
| [`skill-observability-pipeline`](./skill-observability-pipeline/SKILL.md) | DevOps | Island Router syslog → Grafana |

Installable copy of the AXI skill also lives at `skills/island-axi/` (keep in sync with `.agent/skills/island-axi/`).

See [`AGENTS.md`](../../AGENTS.md) for workflow.
