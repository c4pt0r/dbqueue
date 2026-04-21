# Changelog

## 0.3.0

- Added leased claims via `claim --lease-seconds` and recovery via `reap`.
- Added task priority, priority-aware claiming, and guarded completion with `done --worker`.
- Added blocking `claim --wait`, streamed `list --all` paging, and `--output jsonl`.
- Added token-backed portability with `config export` / `init --from <blob>` and stateless execution via `DB9_QUEUE_DB_ID`.
- Tightened `done` semantics to require `status='in_progress'`.
