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
  showTask,
} from './queue';
import type { QueueConfig, TaskStatus } from './types';
import type { OutputFormat } from './output';

interface ParsedArgs {
  positionals: string[];
  flags: Record<string, string | true>;
}

function printHelp(): void {
  console.log(`dbqueue

Usage:
  dbqueue init [--name dbqueue] [--token <db9-token>] [--base-url <url>]
  dbqueue add <title> [--payload <json>] [--output table|json] [--token <db9-token>] [--db-id <id>]
  dbqueue list [--status todo|in_progress|done] [--assignee <worker>] [--limit 50 | --all] [--output table|json]
  dbqueue claim [--worker <name>] [--output table|json]
  dbqueue done <id> [--output table|json]
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

function defaultWorkerName(): string {
  return (
    process.env.DBQUEUE_WORKER?.trim() ||
    process.env.USER?.trim() ||
    os.hostname()
  );
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
  const task = await addTask(
    client,
    databaseId,
    title,
    parsePayload(requireFlagString(flags, 'payload'))
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
  const output = parseOutputFormat(requireFlagString(flags, 'output'));
  const all = flags.all === true;
  const limitRaw = requireFlagString(flags, 'limit');
  if (all && limitRaw) {
    throw new Error('`--all` and `--limit` are mutually exclusive.');
  }
  const tasks = await listTasks(client, databaseId, {
    status: parseStatus(requireFlagString(flags, 'status')),
    assignee: requireFlagString(flags, 'assignee'),
    limit:
      !all && limitRaw
        ? requirePositiveInteger(limitRaw, '--limit')
        : undefined,
    all,
  });
  printTaskList(tasks, output);
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
  const worker = requireFlagString(flags, 'worker') ?? defaultWorkerName();
  const output = parseOutputFormat(requireFlagString(flags, 'output'));
  const task = await claimTask(client, databaseId, worker);
  if (!task) {
    if (output === 'json') {
      console.error('No todo tasks are available to claim.');
    }
    printClaimResult(null, output);
    return;
  }
  printClaimResult(task, output);
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
  const task = await markTaskDone(client, databaseId, id);
  if (!task) {
    throw new Error(`Task ${id} was not updated. It may not exist.`);
  }
  printTask(task, parseOutputFormat(requireFlagString(flags, 'output')));
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
