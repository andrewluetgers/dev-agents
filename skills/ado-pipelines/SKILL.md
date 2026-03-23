---
name: ado-pipelines
description: Manage Azure DevOps pipeline approvals — list pending, approve, reject, and monitor pipeline runs.
argument-hint: [approve|status|list|monitor]
---

# ADO Pipeline Approvals

Manage Azure DevOps pipeline approvals and monitor runs. Uses the `az` CLI with your existing SSO session.

## Configuration

Read the config file at `~/dev-agents/shared/skills/ado-pipelines/config.json` before doing anything. It defines which org, project, and pipelines you're allowed to work with.

## Prerequisites

- `az` CLI installed and authenticated (`az login`)
- The `azure-devops` extension (auto-installs on first use)
- `PATH` must include the Python bin: `export PATH="$PATH:$HOME/Library/Python/3.9/bin"`

## Commands

Based on `$ARGUMENTS`, do one of the following:

### `list`

List pending approvals for configured pipelines:

```bash
export PATH="$PATH:$HOME/Library/Python/3.9/bin"

az rest --method get \
  --resource "499b84ac-1321-427f-aa17-267ca6975798" \
  --url "https://dev.azure.com/{org}/{project}/_apis/pipelines/approvals?api-version=7.2-preview.2" \
  2>/dev/null
```

Filter the results to only show approvals where `status` is `"pending"` and `pipeline.name` matches one of the configured pipelines. Show the most recent first. For each, display:
- Pipeline name
- Build number / run name
- Created date
- Instructions (if any)
- Approval ID

### `approve`

Approve the most recent pending approval for a specified pipeline (or the default pipeline if not specified).

**Step 1: Find the approval ID**

Fetch pending approvals (same as `list`), filter to the target pipeline, sort by `createdOn` descending, take the first one.

**Step 2: Approve it**

```bash
az rest --method patch \
  --resource "499b84ac-1321-427f-aa17-267ca6975798" \
  --url "https://dev.azure.com/{org}/{project}/_apis/pipelines/approvals?api-version=7.2-preview.2" \
  --body '[{"approvalId": "<id>", "status": "approved", "comment": "Approved via ado-pipelines skill"}]'
```

**Step 3: Confirm**

Report the approval status back to the user. Then proceed to monitor the pipeline run (see `monitor`).

### `reject`

Same as approve but with `"status": "rejected"` and a comment explaining why.

### `status`

Check the status of a specific pipeline run or the most recent run:

```bash
az pipelines runs show --id <run-id> \
  --org https://dev.azure.com/{org} \
  --project "{project}" \
  --query "{pipeline: definition.name, status: status, result: result, branch: sourceBranch, requestedBy: requestedFor.displayName}" \
  -o json
```

### `monitor`

After approving, monitor the pipeline run until it completes or fails. Poll every 30 seconds:

```bash
az pipelines runs show --id <run-id> \
  --org https://dev.azure.com/{org} \
  --project "{project}" \
  --query "{status: status, result: result}" \
  -o json
```

Keep polling until `status` is `"completed"`. Then report:
- Final result (succeeded/failed/canceled)
- Duration
- Link to the run: `https://dev.azure.com/{org}/{project}/_build/results?buildId={run-id}`

If the run fails, fetch the timeline to identify which stage/job failed:

```bash
az rest --method get \
  --resource "499b84ac-1321-427f-aa17-267ca6975798" \
  --url "https://dev.azure.com/{org}/{project}/_apis/build/builds/{run-id}/timeline?api-version=7.1" \
  2>/dev/null
```

Filter for records where `result` is `"failed"` and report the stage/job name and any issues.

## Safety

- Only approve pipelines listed in config.json
- Always include a comment with the approval
- Never reject without explaining why
- If the pipeline has instructions (e.g. "Review Terraform plan before approving"), mention them to the user before approving
