# dbqueue

`npx @c4pt0r/dbqueue init`

`dbqueue` is a minimal task queue CLI built on top of [db9](https://db9.ai/sdk/) and the official `get-db9` TypeScript SDK.

## Features

- Zero-install launch via `npx`
- Works with an explicit db9 API token or shared db9 CLI credentials
- Can bootstrap an anonymous db9 account when no credentials exist
- Creates or reuses a db9 database and manages a namespaced queue schema
- Supports `init`, `add`, `list`, `claim`, `reap`, `done`, and `show`
- Supports opt-in claim leases via `claim --lease-seconds` and timed recovery via `reap`
- Supports task priority and priority-aware claiming
- Supports blocking `claim --wait` polling and streamed `list --all --output jsonl`
- Supports token-backed queue portability via `config export` / `init --from`
- Supports stateless operation with `DB9_QUEUE_DB_ID` plus token/base-url env vars

## Install / Run

```bash
npx @c4pt0r/dbqueue init
```

After publish, the installed executable name is still `dbqueue`.

## Authentication

`dbqueue` resolves auth in this order:

1. `--token`
2. `DB9_QUEUE_TOKEN`
3. `DB9_API_KEY`
4. `DB9_TOKEN`
5. `~/.db9/credentials`
6. Anonymous registration during `init` only

`dbqueue` does **not** duplicate bearer tokens into its own config file. It reuses the shared db9 credential store at `~/.db9/credentials`.

## Config

Queue metadata is stored at `~/.dbqueue/config.json`.

The config stores:

- `databaseId`
- `databaseName`
- `baseUrl`
- `updatedAt`

You can also bypass the local config file completely by supplying:

- `DB9_QUEUE_DB_ID`
- one of `DB9_QUEUE_TOKEN`, `DB9_API_KEY`, or `DB9_TOKEN`
- optional `DB9_API_URL`

## Security

`dbqueue config export` emits a credential-bearing blob for token-backed queues.
Treat it like a password.

Recommended handling:

```bash
dbqueue config export > ~/dbqueue.blob
chmod 600 ~/dbqueue.blob
```

To import that attachment on another machine or clean shell:

```bash
dbqueue init --from "$(cat ~/dbqueue.blob)"
```

For fully stateless runs, skip `~/.dbqueue/config.json` entirely:

```bash
DB9_QUEUE_DB_ID=db_123 DB9_QUEUE_TOKEN="$DB9_QUEUE_TOKEN" dbqueue list --output jsonl
```

## Commands

```bash
npx @c4pt0r/dbqueue init [--name dbqueue] [--token <db9-token>] [--base-url <url>]
npx @c4pt0r/dbqueue init --from <blob|->
npx @c4pt0r/dbqueue add "ship it" [--payload '{"kind":"docs"}'] [--priority 5] [--output table|json]
npx @c4pt0r/dbqueue list [--status todo|in_progress|done] [--assignee worker-1] [--sort id|priority] [--limit 50 | --all] [--output table|json|jsonl]
npx @c4pt0r/dbqueue claim [--worker worker-1] [--lease-seconds 300] [--wait] [--poll 2s] [--timeout 0] [--output table|json]
npx @c4pt0r/dbqueue reap [--older-than 600] [--output table|json]
npx @c4pt0r/dbqueue done 42 [--worker worker-1] [--output table|json]
npx @c4pt0r/dbqueue show 42 [--output table|json]
npx @c4pt0r/dbqueue config export [--token <db9-token>] [--base-url <url>] [--db-id <id>]
```

## Schema

`dbqueue` creates a dedicated schema to avoid clobbering user tables:

```sql
CREATE SCHEMA IF NOT EXISTS dbqueue;

CREATE TABLE IF NOT EXISTS dbqueue.tasks (
  id BIGSERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  payload JSONB,
  priority INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'todo',
  assignee TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  claimed_at TIMESTAMPTZ,
  lease_seconds INTEGER,
  completed_at TIMESTAMPTZ,
  CHECK (status IN ('todo', 'in_progress', 'done'))
);
```

## Notes

- Anonymous mode uses the existing db9 customer endpoints for register/refresh.
- If the anonymous token expires, `dbqueue` refreshes it from the stored anonymous credentials when possible.
- `claim --lease-seconds N` records an opt-in lease; `reap` returns expired `in_progress` tasks to `todo`.
- `claim` always picks the highest-priority `todo` task first (`priority DESC, id ASC`).
- `claim --wait` is implemented as client-side polling, not a server push subscription.
- `list --sort priority` is opt-in; the default list order remains `id DESC`.
- `done --worker <name>` guards completion against reclaimed tasks. `DB9_QUEUE_WORKER` can provide the same identity non-interactively.
- `dbqueue list --all` now pages through the queue internally. `--output jsonl` streams page-by-page; `--output json` still buffers the full result in memory.
- `config export` / `init --from` are token-backed portability features. Anonymous queues remain one-machine-only.
- A bare `npx dbqueue ...` flow is not available unless the unscoped npm package name is acquired. The currently publishable form is `npx @c4pt0r/dbqueue ...`.

## Known limitations

- `list --all --output json` still buffers the full result in memory. For very large queues, prefer `--output jsonl`.
- Anonymous-mode queues are single-machine only. For cross-machine portability, use token mode with `config export` / `init --from` or env-only stateless execution.
