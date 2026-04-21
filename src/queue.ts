import type { Db9Client, DatabaseResponse, SqlResult } from 'get-db9';

import type { TaskRecord, TaskStatus } from './types';

const QUEUE_SCHEMA_SQL = `
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

ALTER TABLE dbqueue.tasks
  ADD COLUMN IF NOT EXISTS lease_seconds INTEGER;

ALTER TABLE dbqueue.tasks
  ADD COLUMN IF NOT EXISTS priority INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_dbqueue_tasks_status
  ON dbqueue.tasks (status, id);

CREATE INDEX IF NOT EXISTS idx_dbqueue_tasks_assignee
  ON dbqueue.tasks (assignee, status, id);

CREATE INDEX IF NOT EXISTS idx_dbqueue_tasks_reap
  ON dbqueue.tasks (status, claimed_at);

CREATE INDEX IF NOT EXISTS idx_dbqueue_tasks_claim_order
  ON dbqueue.tasks (status, priority DESC, id);
`;

const TASK_COLUMNS = `
  id,
  title,
  payload,
  priority,
  status,
  assignee,
  lease_seconds,
  created_at,
  claimed_at,
  completed_at
`;

export function sqlString(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

export function sqlNullableString(value: string | null | undefined): string {
  if (value == null) {
    return 'NULL';
  }
  return sqlString(value);
}

export function sqlNullableInteger(value: number | null | undefined): string {
  if (value == null) {
    return 'NULL';
  }
  return String(value);
}

export function sqlJson(value: unknown | undefined): string {
  if (value === undefined) {
    return 'NULL';
  }
  return `${sqlString(JSON.stringify(value))}::jsonb`;
}

function assertSqlOk(result: SqlResult, action: string): void {
  if (result.error) {
    const message =
      typeof result.error === 'string' ? result.error : result.error.message;
    throw new Error(`${action} failed: ${message}`);
  }
}

function rowsToObjects(result: SqlResult): Record<string, unknown>[] {
  return result.rows.map((row) => {
    const object: Record<string, unknown> = {};
    for (let i = 0; i < result.columns.length; i += 1) {
      object[result.columns[i]?.name ?? `col_${i}`] = row[i];
    }
    return object;
  });
}

function normalizePayload(value: unknown): unknown | null {
  if (value == null) {
    return null;
  }
  if (typeof value !== 'string') {
    return value;
  }
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function coerceTask(row: Record<string, unknown>): TaskRecord {
  return {
    id: Number(row.id),
    title: String(row.title ?? ''),
    payload: normalizePayload(row.payload),
    priority: Number(row.priority ?? 0),
    status: String(row.status ?? 'todo') as TaskStatus,
    assignee: row.assignee == null ? null : String(row.assignee),
    lease_seconds:
      row.lease_seconds == null ? null : Number(row.lease_seconds),
    created_at: row.created_at == null ? null : String(row.created_at),
    claimed_at: row.claimed_at == null ? null : String(row.claimed_at),
    completed_at:
      row.completed_at == null ? null : String(row.completed_at),
  };
}

export interface ListTaskOptions {
  status?: TaskStatus;
  assignee?: string;
  limit?: number;
  all?: boolean;
  sort?: 'id' | 'priority';
}

export interface ReapTaskOptions {
  olderThanSeconds?: number;
}

export interface ListTaskCursor {
  id: number;
  priority: number;
}

export async function ensureQueueSchema(
  client: Db9Client,
  databaseId: string
): Promise<void> {
  const result = await client.databases.sql(databaseId, QUEUE_SCHEMA_SQL);
  assertSqlOk(result, 'Queue schema bootstrap');
}

export async function getOrCreateQueueDatabase(
  client: Db9Client,
  databaseName: string,
  existingDatabaseId?: string
): Promise<DatabaseResponse> {
  if (existingDatabaseId) {
    try {
      return await client.databases.get(existingDatabaseId);
    } catch {
      // Fall through to name-based lookup.
    }
  }

  const databases = await client.databases.list();
  const existing = databases.find((database) => database.name === databaseName);
  if (existing) {
    return existing;
  }

  return client.databases.create({ name: databaseName });
}

export function buildAddTaskSql(
  title: string,
  payload?: unknown,
  priority = 0
): string {
  return `
    INSERT INTO dbqueue.tasks (title, payload, priority)
    VALUES (${sqlString(title)}, ${sqlJson(payload)}, ${priority})
    RETURNING ${TASK_COLUMNS};
  `;
}

export function buildListTasksSql(options: ListTaskOptions): string {
  const clauses = ['TRUE'];
  if (options.status) {
    clauses.push(`status = ${sqlString(options.status)}`);
  }
  if (options.assignee) {
    clauses.push(`assignee = ${sqlString(options.assignee)}`);
  }
  const limitClause = options.all
    ? ''
    : `\n    LIMIT ${Math.max(1, Math.min(options.limit ?? 50, 200))}`;
  const orderBy =
    options.sort === 'priority'
      ? 'priority DESC, id ASC'
      : 'id DESC';
  return `
    SELECT ${TASK_COLUMNS}
    FROM dbqueue.tasks
    WHERE ${clauses.join(' AND ')}
    ORDER BY ${orderBy}
    ${limitClause};
  `;
}

export function buildListTaskPageSql(
  options: Omit<ListTaskOptions, 'limit' | 'all'>,
  cursor?: ListTaskCursor,
  pageSize = 500
): string {
  const clauses = ['TRUE'];
  if (options.status) {
    clauses.push(`status = ${sqlString(options.status)}`);
  }
  if (options.assignee) {
    clauses.push(`assignee = ${sqlString(options.assignee)}`);
  }
  if (cursor) {
    if (options.sort === 'priority') {
      clauses.push(
        `(priority < ${cursor.priority} OR (priority = ${cursor.priority} AND id > ${cursor.id}))`
      );
    } else {
      clauses.push(`id < ${cursor.id}`);
    }
  }
  const orderBy =
    options.sort === 'priority'
      ? 'priority DESC, id ASC'
      : 'id DESC';
  return `
    SELECT ${TASK_COLUMNS}
    FROM dbqueue.tasks
    WHERE ${clauses.join(' AND ')}
    ORDER BY ${orderBy}
    LIMIT ${pageSize};
  `;
}

export function buildShowTaskSql(id: number): string {
  return `
    SELECT ${TASK_COLUMNS}
    FROM dbqueue.tasks
    WHERE id = ${id}
    LIMIT 1;
  `;
}

export function buildDoneTaskSql(id: number, worker?: string): string {
  const clauses = [`id = ${id}`, `status = 'in_progress'`];
  if (worker) {
    clauses.push(`assignee = ${sqlString(worker)}`);
  }
  return `
    UPDATE dbqueue.tasks
    SET status = 'done',
        completed_at = now()
    WHERE ${clauses.join('\n      AND ')}
    RETURNING ${TASK_COLUMNS};
  `;
}

export function buildClaimTaskSql(
  worker: string,
  leaseSeconds?: number
): string {
  return `
    UPDATE dbqueue.tasks
    SET status = 'in_progress',
        assignee = ${sqlString(worker)},
        lease_seconds = ${sqlNullableInteger(leaseSeconds)},
        claimed_at = now()
    WHERE id = (
      SELECT id
      FROM dbqueue.tasks
      WHERE status = 'todo'
      ORDER BY priority DESC, id ASC
      LIMIT 1
    )
      AND status = 'todo'
    RETURNING ${TASK_COLUMNS};
  `;
}

export function buildReapTasksSql(options: ReapTaskOptions = {}): string {
  const whereClause =
    options.olderThanSeconds == null
      ? `status = 'in_progress'
      AND lease_seconds IS NOT NULL
      AND claimed_at IS NOT NULL
      AND claimed_at + make_interval(secs => lease_seconds) < now()`
      : `status = 'in_progress'
      AND claimed_at IS NOT NULL
      AND claimed_at < now() - make_interval(secs => ${options.olderThanSeconds})`;

  return `
    UPDATE dbqueue.tasks
    SET status = 'todo',
        assignee = NULL,
        claimed_at = NULL,
        lease_seconds = NULL
    WHERE ${whereClause}
    RETURNING ${TASK_COLUMNS};
  `;
}

export async function addTask(
  client: Db9Client,
  databaseId: string,
  title: string,
  payload?: unknown,
  priority = 0
): Promise<TaskRecord> {
  const result = await client.databases.sql(
    databaseId,
    buildAddTaskSql(title, payload, priority)
  );
  assertSqlOk(result, 'Add task');
  const [task] = rowsToObjects(result).map(coerceTask);
  if (!task) {
    throw new Error('Add task failed: no task row returned');
  }
  return task;
}

export async function listTasks(
  client: Db9Client,
  databaseId: string,
  options: ListTaskOptions
): Promise<TaskRecord[]> {
  const result = await client.databases.sql(
    databaseId,
    buildListTasksSql(options)
  );
  assertSqlOk(result, 'List tasks');
  return rowsToObjects(result).map(coerceTask);
}

export async function streamAllTasks(
  client: Db9Client,
  databaseId: string,
  options: Omit<ListTaskOptions, 'limit' | 'all'>,
  onPage: (tasks: TaskRecord[]) => Promise<void> | void,
  pageSize = 500
): Promise<void> {
  let cursor: ListTaskCursor | undefined;

  for (;;) {
    const result = await client.databases.sql(
      databaseId,
      buildListTaskPageSql(options, cursor, pageSize)
    );
    assertSqlOk(result, 'List tasks');
    const tasks = rowsToObjects(result).map(coerceTask);
    if (tasks.length === 0) {
      return;
    }

    await onPage(tasks);

    if (tasks.length < pageSize) {
      return;
    }

    const last = tasks[tasks.length - 1];
    cursor = {
      id: last.id,
      priority: last.priority,
    };
  }
}

export async function showTask(
  client: Db9Client,
  databaseId: string,
  id: number
): Promise<TaskRecord | null> {
  const result = await client.databases.sql(databaseId, buildShowTaskSql(id));
  assertSqlOk(result, 'Show task');
  const [task] = rowsToObjects(result).map(coerceTask);
  return task ?? null;
}

export async function markTaskDone(
  client: Db9Client,
  databaseId: string,
  id: number,
  worker?: string
): Promise<TaskRecord | null> {
  const result = await client.databases.sql(
    databaseId,
    buildDoneTaskSql(id, worker)
  );
  assertSqlOk(result, 'Complete task');
  const [task] = rowsToObjects(result).map(coerceTask);
  return task ?? null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export async function claimTask(
  client: Db9Client,
  databaseId: string,
  worker: string,
  leaseSeconds?: number,
  attempts = 3
): Promise<TaskRecord | null> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const result = await client.databases.sql(
      databaseId,
      buildClaimTaskSql(worker, leaseSeconds)
    );
    assertSqlOk(result, 'Claim task');
    const [task] = rowsToObjects(result).map(coerceTask);
    if (task) {
      return task;
    }
    if (attempt + 1 < attempts) {
      await sleep(25);
    }
  }
  return null;
}

export async function reapTasks(
  client: Db9Client,
  databaseId: string,
  options: ReapTaskOptions = {}
): Promise<TaskRecord[]> {
  const result = await client.databases.sql(
    databaseId,
    buildReapTasksSql(options)
  );
  assertSqlOk(result, 'Reap tasks');
  return rowsToObjects(result).map(coerceTask);
}
