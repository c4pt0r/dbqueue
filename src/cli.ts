import os from 'node:os';

import { resolveAuth } from './auth';
import { loadQueueConfig, saveQueueConfig } from './config';
import { openDb9Client, resolveDatabaseId } from './db9';
import {
  printClaimResult,
  printTask,
  printTaskList,
} from './output';
import {
  addTask,
  claimTask,
  ensureQueueSchema,
  getOrCreateQueueDatabase,
  listTasks,
  markTaskDone,
  reapTasks,
  streamAllTasks,
  showTask,
} from './queue';
import type { QueueConfig, TaskStatus } from './types';
import type { ListOutputFormat, OutputFormat } from './output';

interface ParsedArgs {
  positionals: string[];
  flags: Record<string, string | true>;
}

function printHelp(): void {
  console.log(`dbqueue

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
`);
}

function parseArgs(argv: string[]): ParsedArgs {
  const positionals: string[] = [];
  const flags: Record<string, string | true> = {};

  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (!item.startsWith('--')) {
      positionals.push(item);
      continue;
    }

    const trimmed = item.slice(2);
    const [name, inlineValue] = trimmed.split('=', 2);
    if (inlineValue !== undefined) {
      flags[name] = inlineValue;
      continue;
    }

    const next = argv[index + 1];
    if (!next || next.startsWith('--')) {
      flags[name] = true;
      continue;
    }

    flags[name] = next;
    index += 1;
  }

  return { positionals, flags };
}

function requireFlagString(
  flags: Record<string, string | true>,
  name: string
): string | undefined {
  const value = flags[name];
  if (value === undefined || value === true) {
    return undefined;
  }
  return value;
}

function requirePositiveInteger(raw: string, label: string): number {
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${label} must be a positive integer.`);
  }
  return parsed;
}

function requireInteger(raw: string, label: string): number {
  const parsed = Number(raw);
  if (!Number.isInteger(parsed)) {
    throw new Error(`${label} must be an integer.`);
  }
  return parsed;
}

function parseStatus(raw: string | undefined): TaskStatus | undefined {
  if (!raw) {
    return undefined;
  }
  if (raw === 'todo' || raw === 'in_progress' || raw === 'done') {
    return raw;
  }
  throw new Error('`--status` must be one of: todo, in_progress, done.');
}

function parsePayload(raw: string | undefined): unknown | undefined {
  if (!raw) {
    return undefined;
  }
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `Invalid JSON for --payload: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
}

function parseOutputFormat(raw: string | undefined): OutputFormat {
  if (!raw || raw === 'table') {
    return 'table';
  }
  if (raw === 'json') {
    return 'json';
  }
  throw new Error('`--output` must be one of: table, json.');
}

function parseListOutputFormat(raw: string | undefined): ListOutputFormat {
  if (!raw || raw === 'table') {
    return 'table';
  }
  if (raw === 'json' || raw === 'jsonl') {
    return raw;
  }
  throw new Error('`--output` must be one of: table, json, jsonl.');
}

function parseSort(raw: string | undefined): 'id' | 'priority' {
  if (!raw || raw === 'id') {
    return 'id';
  }
  if (raw === 'priority') {
    return 'priority';
  }
  throw new Error('`--sort` must be one of: id, priority.');
}

function defaultWorkerName(): string {
  return (
    process.env.DB9_QUEUE_WORKER?.trim() ||
    process.env.DBQUEUE_WORKER?.trim() ||
    process.env.USER?.trim() ||
    os.hostname()
  );
}

function doneWorkerName(flags: Record<string, string | true>): string | undefined {
  return (
    requireFlagString(flags, 'worker') ??
    process.env.DB9_QUEUE_WORKER?.trim() ??
    process.env.DBQUEUE_WORKER?.trim()
  );
}

function parseDurationMs(
  raw: string | undefined,
  label: string,
  defaultValueMs: number,
  options: { allowZero?: boolean } = {}
): number {
  if (raw === undefined) {
    return defaultValueMs;
  }

  if (raw === '0') {
    if (options.allowZero) {
      return 0;
    }
    throw new Error(`${label} must be greater than zero.`);
  }

  const match = raw.match(/^(\d+)(ms|s|m|h)?$/);
  if (!match) {
    throw new Error(`${label} must look like 250ms, 2s, 3m, or 1h.`);
  }

  const value = Number(match[1]);
  const unit = match[2] ?? 'ms';
  const factor =
    unit === 'ms' ? 1 : unit === 's' ? 1000 : unit === 'm' ? 60_000 : 3_600_000;
  const durationMs = value * factor;
  if (durationMs <= 0 && !options.allowZero) {
    throw new Error(`${label} must be greater than zero.`);
  }
  return durationMs;
}

async function runInit(flags: Record<string, string | true>): Promise<void> {
  const auth = await resolveAuth({
    token: requireFlagString(flags, 'token'),
    baseUrl: requireFlagString(flags, 'base-url'),
    allowAnonymousBootstrap: true,
  });
  const client = openDb9Client(auth);
  const currentConfig = await loadQueueConfig();
  const databaseName = requireFlagString(flags, 'name') ?? 'dbqueue';
  const databaseIdOverride = requireFlagString(flags, 'db-id');
  const database = await getOrCreateQueueDatabase(
    client,
    databaseName,
    databaseIdOverride ?? currentConfig?.databaseId
  );
  await ensureQueueSchema(client, database.id);
  const config: QueueConfig = {
    version: 1,
    databaseId: database.id,
    databaseName: database.name,
    baseUrl: auth.baseUrl,
    updatedAt: new Date().toISOString(),
  };
  await saveQueueConfig(config);

  console.log(`Initialized dbqueue.`);
  console.log(`database_id: ${database.id}`);
  console.log(`database_name: ${database.name}`);
  console.log(`auth_source: ${auth.source}`);
  console.log(`base_url: ${auth.baseUrl}`);
}

async function runAdd(
  positionals: string[],
  flags: Record<string, string | true>
): Promise<void> {
  const title = positionals[0];
  if (!title) {
    throw new Error('Usage: dbqueue add <title> [--payload <json>]');
  }
  const config = await loadQueueConfig();
  const auth = await resolveAuth({
    token: requireFlagString(flags, 'token'),
    baseUrl: requireFlagString(flags, 'base-url') ?? config?.baseUrl,
  });
  const client = openDb9Client(auth);
  const databaseId = await resolveDatabaseId(
    config,
    requireFlagString(flags, 'db-id')
  );
  await ensureQueueSchema(client, databaseId);
  const task = await addTask(
    client,
    databaseId,
    title,
    parsePayload(requireFlagString(flags, 'payload')),
    requireInteger(requireFlagString(flags, 'priority') ?? '0', '--priority')
  );
  printTask(task, parseOutputFormat(requireFlagString(flags, 'output')));
}

async function runList(flags: Record<string, string | true>): Promise<void> {
  const config = await loadQueueConfig();
  const auth = await resolveAuth({
    token: requireFlagString(flags, 'token'),
    baseUrl: requireFlagString(flags, 'base-url') ?? config?.baseUrl,
  });
  const client = openDb9Client(auth);
  const databaseId = await resolveDatabaseId(
    config,
    requireFlagString(flags, 'db-id')
  );
  await ensureQueueSchema(client, databaseId);
  const output = parseListOutputFormat(requireFlagString(flags, 'output'));
  const all = flags.all === true;
  const limitRaw = requireFlagString(flags, 'limit');
  const sort = parseSort(requireFlagString(flags, 'sort'));
  if (all && limitRaw) {
    throw new Error('`--all` and `--limit` are mutually exclusive.');
  }
  const status = parseStatus(requireFlagString(flags, 'status'));
  const assignee = requireFlagString(flags, 'assignee');

  if (!all) {
    const tasks = await listTasks(client, databaseId, {
      status,
      assignee,
      sort,
      limit: limitRaw
        ? requirePositiveInteger(limitRaw, '--limit')
        : undefined,
      all,
    });
    printTaskList(tasks, output);
    return;
  }

  if (output === 'json') {
    const tasks: Awaited<ReturnType<typeof listTasks>> = [];
    await streamAllTasks(
      client,
      databaseId,
      { status, assignee, sort },
      (page) => {
        tasks.push(...page);
      }
    );
    printTaskList(tasks, output);
    return;
  }

  let sawAny = false;
  await streamAllTasks(
    client,
    databaseId,
    { status, assignee, sort },
    (page) => {
      sawAny = true;
      printTaskList(page, output);
    }
  );
  if (!sawAny) {
    printTaskList([], output);
  }
}

async function runClaim(flags: Record<string, string | true>): Promise<void> {
  const config = await loadQueueConfig();
  const auth = await resolveAuth({
    token: requireFlagString(flags, 'token'),
    baseUrl: requireFlagString(flags, 'base-url') ?? config?.baseUrl,
  });
  const client = openDb9Client(auth);
  const databaseId = await resolveDatabaseId(
    config,
    requireFlagString(flags, 'db-id')
  );
  await ensureQueueSchema(client, databaseId);
  const worker = requireFlagString(flags, 'worker') ?? defaultWorkerName();
  const output = parseOutputFormat(requireFlagString(flags, 'output'));
  const leaseRaw = requireFlagString(flags, 'lease-seconds');
  const leaseSeconds = leaseRaw
    ? requirePositiveInteger(leaseRaw, '--lease-seconds')
    : undefined;
  const wait = flags.wait === true;
  const pollMs = parseDurationMs(
    requireFlagString(flags, 'poll'),
    '--poll',
    2_000
  );
  const timeoutMs = parseDurationMs(
    requireFlagString(flags, 'timeout'),
    '--timeout',
    0,
    { allowZero: true }
  );
  const deadline = timeoutMs === 0 ? Number.POSITIVE_INFINITY : Date.now() + timeoutMs;
  let interrupted = false;
  const onSigint = (): void => {
    interrupted = true;
  };
  process.once('SIGINT', onSigint);
  let task = null;
  try {
    for (;;) {
      task = await claimTask(
        client,
        databaseId,
        worker,
        leaseSeconds
      );
      if (task || !wait) {
        break;
      }
      if (interrupted) {
        throw new Error('Interrupted while waiting for a task.');
      }
      const now = Date.now();
      if (now >= deadline) {
        break;
      }
      const sleepMs = Math.min(pollMs, deadline - now);
      await new Promise((resolve) => setTimeout(resolve, sleepMs));
    }
  } finally {
    process.off('SIGINT', onSigint);
  }
  if (!task) {
    const message = wait
      ? 'Timed out waiting for todo tasks.'
      : 'No todo tasks are available to claim.';
    if (output === 'json') {
      console.error(message);
      printClaimResult(null, output);
      return;
    }
    if (wait) {
      console.log(message);
      return;
    } else {
      printClaimResult(null, output);
      return;
    }
  }
  printClaimResult(task, output);
}

async function runReap(flags: Record<string, string | true>): Promise<void> {
  const config = await loadQueueConfig();
  const auth = await resolveAuth({
    token: requireFlagString(flags, 'token'),
    baseUrl: requireFlagString(flags, 'base-url') ?? config?.baseUrl,
  });
  const client = openDb9Client(auth);
  const databaseId = await resolveDatabaseId(
    config,
    requireFlagString(flags, 'db-id')
  );
  await ensureQueueSchema(client, databaseId);
  const output = parseOutputFormat(requireFlagString(flags, 'output'));
  const olderThanRaw = requireFlagString(flags, 'older-than');
  const tasks = await reapTasks(client, databaseId, {
    olderThanSeconds: olderThanRaw
      ? requirePositiveInteger(olderThanRaw, '--older-than')
      : undefined,
  });
  printTaskList(tasks, output);
}

async function runDone(
  positionals: string[],
  flags: Record<string, string | true>
): Promise<void> {
  const rawId = positionals[0];
  if (!rawId) {
    throw new Error('Usage: dbqueue done <id>');
  }
  const id = requirePositiveInteger(rawId, 'Task id');
  const config = await loadQueueConfig();
  const auth = await resolveAuth({
    token: requireFlagString(flags, 'token'),
    baseUrl: requireFlagString(flags, 'base-url') ?? config?.baseUrl,
  });
  const client = openDb9Client(auth);
  const databaseId = await resolveDatabaseId(
    config,
    requireFlagString(flags, 'db-id')
  );
  await ensureQueueSchema(client, databaseId);
  const output = parseOutputFormat(requireFlagString(flags, 'output'));
  const worker = doneWorkerName(flags);
  if (!worker) {
    console.error(
      '# hint: pass --worker/$DB9_QUEUE_WORKER to guard against reclaimed tasks'
    );
  }
  const task = await markTaskDone(client, databaseId, id, worker);
  if (!task) {
    if (worker) {
      throw new Error(
        `done failed: task ${id} not claimed by ${worker} (may be reclaimed or already done)`
      );
    }
    throw new Error(
      `Task ${id} was not updated. It may already be done or not be in progress.`
    );
  }
  printTask(task, output);
}

async function runShow(
  positionals: string[],
  flags: Record<string, string | true>
): Promise<void> {
  const rawId = positionals[0];
  if (!rawId) {
    throw new Error('Usage: dbqueue show <id>');
  }
  const id = requirePositiveInteger(rawId, 'Task id');
  const config = await loadQueueConfig();
  const auth = await resolveAuth({
    token: requireFlagString(flags, 'token'),
    baseUrl: requireFlagString(flags, 'base-url') ?? config?.baseUrl,
  });
  const client = openDb9Client(auth);
  const databaseId = await resolveDatabaseId(
    config,
    requireFlagString(flags, 'db-id')
  );
  await ensureQueueSchema(client, databaseId);
  const task = await showTask(client, databaseId, id);
  if (!task) {
    throw new Error(`Task ${id} was not found.`);
  }
  printTask(task, parseOutputFormat(requireFlagString(flags, 'output')));
}

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  if (!command || command === 'help' || command === '--help' || command === '-h') {
    printHelp();
    return;
  }

  const parsed = parseArgs(rest);

  switch (command) {
    case 'init':
      await runInit(parsed.flags);
      return;
    case 'add':
      await runAdd(parsed.positionals, parsed.flags);
      return;
    case 'list':
      await runList(parsed.flags);
      return;
    case 'claim':
      await runClaim(parsed.flags);
      return;
    case 'reap':
      await runReap(parsed.flags);
      return;
    case 'done':
      await runDone(parsed.positionals, parsed.flags);
      return;
    case 'show':
      await runShow(parsed.positionals, parsed.flags);
      return;
    default:
      throw new Error(`Unknown command: ${command}`);
  }
}

main().catch((error) => {
  console.error(
    error instanceof Error ? `Error: ${error.message}` : `Error: ${String(error)}`
  );
  process.exitCode = 1;
});
