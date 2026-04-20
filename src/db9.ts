import { createDb9Client, type Db9Client } from 'get-db9';

import type { QueueConfig, ResolvedAuth } from './types';

export function openDb9Client(auth: ResolvedAuth): Db9Client {
  return createDb9Client({
    baseUrl: auth.baseUrl,
    token: auth.token,
  });
}

export async function resolveDatabaseId(
  config: QueueConfig | null,
  explicitId?: string
): Promise<string> {
  if (explicitId?.trim()) {
    return explicitId.trim();
  }
  if (config?.databaseId) {
    return config.databaseId;
  }
  throw new Error(
    'No queue database is configured. Run `dbqueue init` first or pass `--db-id`.'
  );
}
