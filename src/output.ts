import type { TaskRecord } from './types';

export type OutputFormat = 'table' | 'json';

function formatTimestamp(value: string | null): string {
  if (!value) {
    return '-';
  }
  return value.replace('T', ' ').replace(/\.\d+Z$/, 'Z');
}

function stringifyPayload(payload: unknown | null): string {
  if (payload == null) {
    return 'null';
  }
  return JSON.stringify(payload, null, 2);
}

function printJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}

function toIsoTimestamp(value: string | null): string | null {
  if (!value) {
    return null;
  }
  const normalized = value
    .replace(' ', 'T')
    .replace(/([+-]\d{2})$/, '$1:00');
  const timestamp = new Date(normalized);
  if (Number.isNaN(timestamp.getTime())) {
    return normalized;
  }
  return timestamp.toISOString();
}

function toJsonTask(task: TaskRecord): TaskRecord {
  return {
    ...task,
    created_at: toIsoTimestamp(task.created_at),
    claimed_at: toIsoTimestamp(task.claimed_at),
    completed_at: toIsoTimestamp(task.completed_at),
  };
}

function printTaskKeyValue(task: TaskRecord): void {
  console.log(`id:          ${task.id}`);
  console.log(`title:       ${task.title}`);
  console.log(`status:      ${task.status}`);
  console.log(`assignee:    ${task.assignee ?? '-'}`);
  console.log(`created_at:  ${formatTimestamp(task.created_at)}`);
  console.log(`claimed_at:  ${formatTimestamp(task.claimed_at)}`);
  console.log(`completed_at:${task.completed_at ? ` ${formatTimestamp(task.completed_at)}` : ' -'}`);
  console.log(`payload:     ${stringifyPayload(task.payload)}`);
}

function printTaskTable(tasks: TaskRecord[]): void {
  if (tasks.length === 0) {
    console.log('No tasks found.');
    return;
  }

  const rows = tasks.map((task) => ({
    ID: String(task.id),
    TITLE: task.title,
    STATUS: task.status,
    ASSIGNEE: task.assignee ?? '-',
    CREATED: formatTimestamp(task.created_at),
  }));

  const columns = Object.keys(rows[0] ?? {}) as Array<keyof (typeof rows)[number]>;
  const widths = new Map<string, number>();
  for (const column of columns) {
    let width = column.length;
    for (const row of rows) {
      width = Math.max(width, row[column].length);
    }
    widths.set(column, width);
  }

  const header = columns
    .map((column) => column.padEnd(widths.get(column) ?? column.length))
    .join('  ');
  const separator = columns
    .map((column) => '─'.repeat(widths.get(column) ?? column.length))
    .join('  ');
  console.log(header);
  console.log(separator);
  for (const row of rows) {
    console.log(
      columns
        .map((column) => row[column].padEnd(widths.get(column) ?? row[column].length))
        .join('  ')
    );
  }
}

export function printTask(task: TaskRecord, format: OutputFormat): void {
  if (format === 'json') {
    printJson({ task: toJsonTask(task) });
    return;
  }
  printTaskKeyValue(task);
}

export function printClaimResult(
  task: TaskRecord | null,
  format: OutputFormat
): void {
  if (format === 'json') {
    printJson({ task: task ? toJsonTask(task) : null });
    return;
  }
  if (!task) {
    console.log('No todo tasks are available to claim.');
    return;
  }
  printTaskKeyValue(task);
}

export function printTaskList(tasks: TaskRecord[], format: OutputFormat): void {
  if (format === 'json') {
    printJson({ tasks: tasks.map(toJsonTask) });
    return;
  }
  printTaskTable(tasks);
}
