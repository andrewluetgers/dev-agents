# Agent Templates

CLAUDE.md templates that shape agent behavior for different roles. The orchestrator can copy a template into an agent's workspace to configure its personality and approach.

Agents see this directory at `/home/agent/shared/templates/` (read-only).

## Usage

When the orchestrator spawns an agent for a specific role, it copies the appropriate template:

```bash
cp /home/agent/shared/templates/researcher.md /home/agent/workspace/CLAUDE.md
```

## Example

See `researcher.md` for a template that configures an agent for codebase research and analysis.
