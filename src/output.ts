import type { TaskRecord } from './types';

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

export function printTask(task: TaskRecord): void {
  console.log(`id:          ${task.id}`);
  console.log(`title:       ${task.title}`);
  console.log(`status:      ${task.status}`);
  console.log(`assignee:    ${task.assignee ?? '-'}`);
  console.log(`created_at:  ${formatTimestamp(task.created_at)}`);
  console.log(`claimed_at:  ${formatTimestamp(task.claimed_at)}`);
  console.log(`completed_at:${task.completed_at ? ` ${formatTimestamp(task.completed_at)}` : ' -'}`);
  console.log(`payload:     ${stringifyPayload(task.payload)}`);
}

export function printTaskTable(tasks: TaskRecord[]): void {
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
