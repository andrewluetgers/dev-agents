---
name: msg
description: Send a message to a running dev agent's Claude session.
user-invocable: true
---

# Message Agent

Send a message directly into a running agent's Claude Code session. The message arrives immediately as a channel event.

## Usage

`/msg <agent-name> <message>`

Examples:
- `/msg cs-playwright focus on the login flow first`
- `/msg cs-auth-fix stop what you're doing, there's a new requirement`
- `/msg cs-playwright` — asks what message to send

## Procedure

### 1. Resolve the agent

**If no agent name:** Use `list_agents` to show running agents and ask which one.

**If agent name given but no message:** Ask what to send.

### 2. Send the message

```
message(agent: "<name>", content: "<message>")
```

### 3. Confirm

Tell the user the message was delivered. If the response indicates no Claude session is active (`no_claude_session`), inform the user the agent's Claude isn't running and suggest using `dispatch` to run a command instead.
