---
name: dbqueue
description: Lightweight task queue CLI backed by db9; use to create/list/claim/complete tasks without provisioning infra. Runs via `npx --yes @c4pt0r/dbqueue`. Supports anonymous db9 cluster bootstrap or user-supplied API token.
---

# dbqueue

## What it does

`dbqueue` provides a persistent task queue on top of a db9 SQL database.

## Install / invoke

No global install is required. Invoke it directly with:

```bash
npx --yes @c4pt0r/dbqueue <command>
```

## Commands

```text
dbqueue

Usage:
  dbqueue init [--name dbqueue] [--token <db9-token>] [--base-url <url>]
  dbqueue add <title> [--payload <json>] [--output table|json] [--token <db9-token>] [--db-id <id>]
  dbqueue list [--status todo|in_progress|done] [--assignee <worker>] [--limit 50 | --all] [--output table|json]
  dbqueue claim [--worker <name>] [--output table|json]
  dbqueue done <id> [--output table|json]
  dbqueue show <id> [--output table|json]

Auth precedence:
  --token > DB9_QUEUE_TOKEN > DB9_API_KEY > DB9_TOKEN > ~/.db9/credentials > anonymous bootstrap (init only)
```

- `init`: create or reuse a db9 database and bootstrap the queue schema.
  Canonical example:
  ```bash
  npx --yes @c4pt0r/dbqueue init --name agent-queue
  ```
- `add`: enqueue a task with optional JSON payload.
  Canonical example:
  ```bash
  npx --yes @c4pt0r/dbqueue add "ship docs" --payload '{"priority":"high"}'
  ```
- `list`: inspect tasks with optional filters or machine-readable JSON.
  Canonical example:
  ```bash
  npx --yes @c4pt0r/dbqueue list --all --output json
  ```
- `claim`: atomically take one `todo` task and move it to `in_progress`.
  Canonical example:
  ```bash
  npx --yes @c4pt0r/dbqueue claim --worker planner-1 --output json
  ```
- `done`: mark a task complete.
  Canonical example:
  ```bash
  npx --yes @c4pt0r/dbqueue done 42 --output json
  ```
- `show`: fetch one task by id.
  Canonical example:
  ```bash
  npx --yes @c4pt0r/dbqueue show 42 --output json
  ```

## Auth precedence

The CLI resolves auth in this order:

1. `--token`
2. `DB9_QUEUE_TOKEN`
3. `DB9_API_KEY`
4. `DB9_TOKEN`
5. `~/.db9/credentials`
6. Anonymous bootstrap during `init` only

How to interpret that:

- `--token`: use this when the caller already has a db9 API token and wants explicit, per-command auth.
- `DB9_QUEUE_TOKEN`, `DB9_API_KEY`, `DB9_TOKEN`: use these for non-interactive shell execution or CI.
- `~/.db9/credentials`: reuse the shared db9 CLI credential store if the machine already ran `db9 login` or another db9 workflow.
- Anonymous bootstrap: only `init` can auto-register an anonymous db9 account when no other credentials exist.

## Typical flow

Human-readable flow:

```bash
npx --yes @c4pt0r/dbqueue init --name agent-queue
npx --yes @c4pt0r/dbqueue add "investigate flaky job"
npx --yes @c4pt0r/dbqueue claim --worker agent-1
npx --yes @c4pt0r/dbqueue done 1
```

Machine-readable flow:

```bash
npx --yes @c4pt0r/dbqueue add "triage queue" --payload '{"kind":"ops"}' --output json
npx --yes @c4pt0r/dbqueue list --status todo --output json | jq
npx --yes @c4pt0r/dbqueue claim --worker agent-1 --output json | jq
```

Automation notes:

- Prefer `--output json` when another agent or shell pipeline will consume the result.
- `claim --output json` is pipe-safe even when the queue is empty: stdout is `{"task": null}` and the human hint stays on stderr.
- `list --all` removes the default cap and returns the full result set; use it deliberately.

## When to use

Use `dbqueue` when AI agents need a shared, persistent queue across sessions or machines without provisioning separate queue infrastructure.

Do not use it as a general-purpose database abstraction, document store, or workflow engine.

## Limitations

V1 limitations:

- No visibility timeout or lease expiry for claimed tasks.
- No priorities.
- No watch/subscribe or push notifications.
- `list --all` loads the full result set in one shot; be careful with very large queues.
- Queue metadata is stored locally in `~/.dbqueue/config.json`, so a different machine or clean environment does not automatically know which queue database to use.
- Anonymous identity is stored in `~/.db9/credentials`; a different machine or clean environment gets a different anonymous account and cannot access the old queue unless explicit credentials are supplied.
