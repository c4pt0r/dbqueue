import type { Db9Client, DatabaseResponse, SqlResult } from 'get-db9';

import type { TaskRecord, TaskStatus } from './types';

const QUEUE_SCHEMA_SQL = `
CREATE SCHEMA IF NOT EXISTS dbqueue;

CREATE TABLE IF NOT EXISTS dbqueue.tasks (
  id BIGSERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  payload JSONB,
  status TEXT NOT NULL DEFAULT 'todo',
  assignee TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  claimed_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  CHECK (status IN ('todo', 'in_progress', 'done'))
);

CREATE INDEX IF NOT EXISTS idx_dbqueue_tasks_status
  ON dbqueue.tasks (status, id);

CREATE INDEX IF NOT EXISTS idx_dbqueue_tasks_assignee
  ON dbqueue.tasks (assignee, status, id);
`;

const TASK_COLUMNS = `
  id,
  title,
  payload,
  status,
  assignee,
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
    status: String(row.status ?? 'todo') as TaskStatus,
    assignee: row.assignee == null ? null : String(row.assignee),
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

export function buildAddTaskSql(title: string, payload?: unknown): string {
  return `
    INSERT INTO dbqueue.tasks (title, payload)
    VALUES (${sqlString(title)}, ${sqlJson(payload)})
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
  const limit = Math.max(1, Math.min(options.limit ?? 50, 200));
  return `
    SELECT ${TASK_COLUMNS}
    FROM dbqueue.tasks
    WHERE ${clauses.join(' AND ')}
    ORDER BY id DESC
    LIMIT ${limit};
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

export function buildDoneTaskSql(id: number): string {
  return `
    UPDATE dbqueue.tasks
    SET status = 'done',
        completed_at = now()
    WHERE id = ${id}
      AND status <> 'done'
    RETURNING ${TASK_COLUMNS};
  `;
}

export function buildClaimTaskSql(worker: string): string {
  return `
    UPDATE dbqueue.tasks
    SET status = 'in_progress',
        assignee = ${sqlString(worker)},
        claimed_at = now()
    WHERE id = (
      SELECT id
      FROM dbqueue.tasks
      WHERE status = 'todo'
      ORDER BY id
      LIMIT 1
    )
      AND status = 'todo'
    RETURNING ${TASK_COLUMNS};
  `;
}

export async function addTask(
  client: Db9Client,
  databaseId: string,
  title: string,
  payload?: unknown
): Promise<TaskRecord> {
  const result = await client.databases.sql(
    databaseId,
    buildAddTaskSql(title, payload)
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
  id: number
): Promise<TaskRecord | null> {
  const result = await client.databases.sql(databaseId, buildDoneTaskSql(id));
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
  attempts = 3
): Promise<TaskRecord | null> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const result = await client.databases.sql(
      databaseId,
      buildClaimTaskSql(worker)
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
