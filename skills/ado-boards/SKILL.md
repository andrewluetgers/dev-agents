---
name: ado-boards
description: Read and manage Azure DevOps work items — query, update state, create items, add relations. Respects permission boundaries.
argument-hint: [mine|show <id>|query <wiql>|update <id>|create|link]
---

# ADO Boards

Read and manage Azure DevOps work items. Uses the `az` CLI with your existing SSO session.

## Setup

1. Read the config file at `~/dev-agents/shared/skills/ado-boards/config.json`
2. Apply the `pathSetup` from the auth section before any `az` command
3. Check auth with the `check` command. If it fails, run the `login` command (opens browser for OAuth — wait for it to complete)

```bash
eval "$(cat ~/dev-agents/shared/skills/ado-boards/config.json | python3 -c "import sys,json; print(json.load(sys.stdin)['auth']['pathSetup'])")"
az account show >/dev/null 2>&1 || az login
```

Set the default org/project for the session:

```bash
az devops configure --defaults organization=https://dev.azure.com/$ADO_ORG project="$ADO_PROJECT"
```

## Permission model

**Read the permissions section of config.json before every write operation.** The rules:

- **Read**: anything in the project
- **Write**: only work items assigned to `@me`, only the fields listed in `allowedFields`
- **State changes**: only transitions listed in `allowedStateTransitions` (e.g. Active → Resolved, never skip states)
- **Create**: only the types listed in `allowedTypes`. Always set AreaPath and IterationPath from config.
- **Relations**: only the link types listed in `allowed`
- **Delete**: never. Use state `Removed` or `Closed` instead.

## Commands

Based on `$ARGUMENTS`:

### `mine`

List all active work items assigned to me:

```bash
az boards query --wiql "
  SELECT [System.Id], [System.Title], [System.State], [System.WorkItemType], [Microsoft.VSTS.Common.Priority]
  FROM workitems
  WHERE [System.AssignedTo] = @me
    AND [System.State] <> 'Closed'
    AND [System.State] <> 'Removed'
    AND [System.TeamProject] = '$ADO_PROJECT'
  ORDER BY [Microsoft.VSTS.Common.Priority] ASC, [System.ChangedDate] DESC
" --org https://dev.azure.com/$ADO_ORG --project "$ADO_PROJECT" -o table
```

### `show <id>`

Show full details of a work item:

```bash
az boards work-item show --id <id> --org https://dev.azure.com/$ADO_ORG -o json
```

Parse and display: title, type, state, assigned to, priority, description, acceptance criteria, tags, relations, and the web URL.

### `query <wiql>`

Run a custom WIQL query. If the argument looks like natural language rather than WIQL, translate it to WIQL first. Common patterns:

- "bugs in SearchApp" → `WHERE [System.WorkItemType] = 'Bug' AND [System.AreaPath] UNDER 'GenAI Digipath\Projects\SearchApp'`
- "resolved this week" → `WHERE [System.State] = 'Resolved' AND [System.ChangedDate] >= @Today - 7`
- "features under Cohort Building" → `WHERE [System.WorkItemType] = 'Feature' AND [System.Parent] = <id>`

```bash
az boards query --wiql "<wiql>" --org https://dev.azure.com/$ADO_ORG --project "$ADO_PROJECT" -o table
```

### `update <id> <field=value ...>`

Update fields on a work item. **Before updating, verify:**
1. The item is assigned to `@me` (check `System.AssignedTo`)
2. The fields are in `allowedFields`
3. State transitions are in `allowedStateTransitions`

```bash
az boards work-item update --id <id> \
  --fields "System.State=Resolved" "Microsoft.VSTS.Common.Priority=2" \
  --org https://dev.azure.com/$ADO_ORG -o json
```

For description or acceptance criteria (HTML fields), use:

```bash
az boards work-item update --id <id> \
  --description "<p>Updated description</p>" \
  --org https://dev.azure.com/$ADO_ORG -o json
```

Always confirm the update with the user before executing. Show what will change.

### `create <type> <title>`

Create a new work item. Always set area and iteration paths from config:

```bash
az boards work-item create \
  --type "User Story" \
  --title "The title" \
  --area "$ADO_AREA_PATH" \
  --iteration "$ADO_ITERATION_PATH" \
  --assigned-to @me \
  --org https://dev.azure.com/$ADO_ORG \
  --project "$ADO_PROJECT" \
  -o json
```

After creation, report the ID and web URL.

### `link <source-id> <target-id> <relation>`

Add a relation between work items. Only use relation types from config.

```bash
az boards work-item relation add \
  --id <source-id> \
  --relation-type <relation> \
  --target-id <target-id> \
  --org https://dev.azure.com/$ADO_ORG -o json
```

Friendly names for relation types:
- `parent` → `System.LinkTypes.Hierarchy-Reverse`
- `child` → `System.LinkTypes.Hierarchy-Forward`
- `related` → `System.LinkTypes.Related`
- `duplicate` → `System.LinkTypes.Duplicate-Forward`
- `duplicate-of` → `System.LinkTypes.Duplicate-Reverse`

### `resolve <id>`

Shortcut: set state to Resolved. Verifies item is currently Active and assigned to @me.

```bash
az boards work-item update --id <id> \
  --fields "System.State=Resolved" \
  --org https://dev.azure.com/$ADO_ORG -o json
```

### `close <id>`

Shortcut: set state to Closed. Verifies item is currently Resolved and assigned to @me.

## Safety

- **Always check permissions before writing.** Read config.json permissions section.
- **Never delete work items.** Use Removed or Closed state.
- **Confirm updates with the user** before executing write operations.
- **Don't modify items assigned to other people** unless reassigned to you first.
- **Preserve existing field values** — only change what's explicitly requested.
- **Use the web URL format** when referencing items: `https://dev.azure.com/{org}/{project}/_workitems/edit/{id}`
