import { afterEach, describe, expect, it } from 'vitest';

import { resolveDatabaseId } from '../db9';

describe('resolveDatabaseId', () => {
  const originalDbId = process.env.DB9_QUEUE_DB_ID;

  afterEach(() => {
    if (originalDbId === undefined) {
      delete process.env.DB9_QUEUE_DB_ID;
    } else {
      process.env.DB9_QUEUE_DB_ID = originalDbId;
    }
  });

  it('prefers explicit id over env and config', async () => {
    process.env.DB9_QUEUE_DB_ID = 'env-db';
    await expect(
      resolveDatabaseId(
        {
          version: 1,
          databaseId: 'config-db',
          databaseName: 'queue',
          baseUrl: 'https://api.db9.ai',
          updatedAt: '2026-04-21T00:00:00.000Z',
        },
        'explicit-db'
      )
    ).resolves.toBe('explicit-db');
  });

  it('uses DB9_QUEUE_DB_ID when no explicit id is provided', async () => {
    process.env.DB9_QUEUE_DB_ID = 'env-db';
    await expect(resolveDatabaseId(null)).resolves.toBe('env-db');
  });
});
