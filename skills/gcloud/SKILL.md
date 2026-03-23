---
name: gcloud
description: Google Cloud Platform operations — auth, storage, Cloud Run, Cloud SQL, logging.
argument-hint: [auth|storage|run|sql|logs]
---

# GCloud

Google Cloud Platform operations via the `gcloud` CLI.

## Setup

1. Read the config file at `~/dev-agents/shared/skills/gcloud/config.json`
2. Check auth. If expired, run login (opens browser for OAuth):

```bash
gcloud auth print-access-token >/dev/null 2>&1 || (gcloud auth login && gcloud auth application-default login)
```

3. Set the project:

```bash
gcloud config set project $GCP_PROJECT
```

## Commands

Based on `$ARGUMENTS`:

### `auth`

Check current auth status and refresh if needed:

```bash
gcloud auth list
gcloud auth print-access-token >/dev/null 2>&1 && echo "Auth valid" || echo "Auth expired"
```

If expired, run:
```bash
gcloud auth login
gcloud auth application-default login
```

Both open browser for OAuth. Wait for completion.

### `storage <subcommand>`

GCS operations:

```bash
# List buckets
gcloud storage ls

# List objects in a bucket
gcloud storage ls gs://$GCS_IMAGE_BUCKET/$GCS_IMAGE_PATH/ --limit=20

# Copy file to/from GCS
gcloud storage cp <source> <dest>

# Get object metadata
gcloud storage objects describe gs://bucket/path
```

### `run <subcommand>`

Cloud Run operations:

```bash
# List services
gcloud run services list --region=$GCP_REGION

# Describe a service
gcloud run services describe <service> --region=$GCP_REGION

# View logs
gcloud run services logs read <service> --region=$GCP_REGION --limit=50

# Get current revision traffic
gcloud run services describe <service> --region=$GCP_REGION --format="json(status.traffic)"
```

### `sql <subcommand>`

Cloud SQL operations (read-only):

```bash
# List instances
gcloud sql instances list

# Describe instance
gcloud sql instances describe <instance>

# List databases
gcloud sql databases list --instance=<instance>
```

### `logs <query>`

Cloud Logging queries:

```bash
# Recent errors
gcloud logging read "severity>=ERROR AND resource.type=cloud_run_revision" --limit=20 --format=json

# Specific service
gcloud logging read "resource.labels.service_name=<service> AND severity>=WARNING" --limit=50 --freshness=1h

# Custom filter
gcloud logging read "<filter>" --limit=20 --format=json
```

## Safety

- **Read the permissions in config.json** before any write operation.
- **Storage writes** are allowed but be careful with overwrites — GCS doesn't have undo.
- **Cloud SQL writes** are not permitted through this skill. Use the app's DB connection for data operations.
- **Never modify IAM policies, service accounts, or networking** through this skill.
- **ADC tokens expire** — if operations start failing with auth errors, re-run the auth flow.
