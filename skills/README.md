# Shared Skills

Custom Claude Code skills available to all agents. Each skill is a folder with a `SKILL.md` file.

Agents see this directory at `/home/agent/shared/skills/` (read-only). To use a skill, an agent can symlink or copy it into their own `.claude/skills/` directory.

Claude Code also has built-in skill discovery via `/plugin install` and `/plugin marketplace` — check there first before writing a custom skill.

## Example

See `example-reviewer/` for a simple code review skill.
