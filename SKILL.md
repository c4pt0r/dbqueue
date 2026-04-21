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
  dbqueue add <title> [--payload <json>] [--priority <int>] [--output table|json] [--token <db9-token>] [--db-id <id>]
  dbqueue list [--status todo|in_progress|done] [--assignee <worker>] [--sort id|priority] [--limit 50 | --all] [--output table|json|jsonl]
  dbqueue claim [--worker <name>] [--lease-seconds <sec>] [--wait] [--poll 2s] [--timeout 0] [--output table|json]
  dbqueue reap [--older-than <sec>] [--output table|json]
  dbqueue done <id> [--worker <name>] [--output table|json]
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
  npx --yes @c4pt0r/dbqueue add "ship docs" --priority 9 --payload '{"kind":"docs"}'
  ```
- `list`: inspect tasks with optional filters, explicit sort order, or machine-readable JSON.
  Canonical example:
  ```bash
  npx --yes @c4pt0r/dbqueue list --all --output jsonl
  ```
- `claim`: atomically take one `todo` task and move it to `in_progress`.
  Canonical example:
  ```bash
  npx --yes @c4pt0r/dbqueue claim --worker planner-1 --lease-seconds 300 --wait --timeout 30s --output json
  ```
- `reap`: move expired `in_progress` tasks back to `todo`.
  Canonical example:
  ```bash
  npx --yes @c4pt0r/dbqueue reap --output json
  ```
- `done`: mark a task complete.
  Canonical example:
  ```bash
  npx --yes @c4pt0r/dbqueue done 42 --worker planner-1 --output json
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
npx --yes @c4pt0r/dbqueue add "investigate flaky job" --priority 5
npx --yes @c4pt0r/dbqueue claim --worker agent-1 --lease-seconds 300
npx --yes @c4pt0r/dbqueue reap
npx --yes @c4pt0r/dbqueue done 1 --worker agent-1
```

Machine-readable flow:

```bash
npx --yes @c4pt0r/dbqueue add "triage queue" --payload '{"kind":"ops"}' --output json
npx --yes @c4pt0r/dbqueue list --all --output jsonl | jq
npx --yes @c4pt0r/dbqueue claim --worker agent-1 --wait --timeout 30s --output json | jq
npx --yes @c4pt0r/dbqueue done 1 --worker agent-1 --output json | jq
```

Automation notes:

- Prefer `--output json` when another agent or shell pipeline will consume the result.
- Prefer `--output jsonl` for very large `list --all` scans; it streams one task per line and does not require one giant result array in memory.
- `claim --output json` is pipe-safe even when the queue is empty: stdout is `{"task": null}` and the human hint stays on stderr.
- `claim --wait` is client-side polling. Tune it with `--poll` and `--timeout`; `--timeout 0` waits indefinitely.
- `claim --lease-seconds N` is opt-in. Omit it when the worker wants an indefinite claim.
- `done --worker <name>` is the safe completion path once leases exist. Without a worker guard, the CLI allows completion of any `in_progress` task and only prints a stderr hint.
- `DB9_QUEUE_WORKER` can provide a stable non-interactive worker identity for both `claim` and `done`.
- `list --all` removes the default cap and returns the full result set; use it deliberately.

## When to use

Use `dbqueue` when AI agents need a shared, persistent queue across sessions or machines without provisioning separate queue infrastructure.

Do not use it as a general-purpose database abstraction, document store, or workflow engine.

## Limitations

V1 limitations:

- `list --all --output json` still buffers the full result in memory; for very large queues prefer `--output jsonl` which streams.
- Queue metadata is stored locally in `~/.dbqueue/config.json`, so a different machine or clean environment does not automatically know which queue database to use.
- Anonymous identity is stored in `~/.db9/credentials`; a different machine or clean environment gets a different anonymous account and cannot access the old queue unless explicit credentials are supplied.
