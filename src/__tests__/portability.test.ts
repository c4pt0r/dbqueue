import { describe, expect, it } from 'vitest';

import {
  decodeQueueExportBlob,
  encodeQueueExportBlob,
} from '../portability';

describe('portability helpers', () => {
  it('round-trips token-mode export blobs', () => {
    const blob = {
      version: 1 as const,
      mode: 'token' as const,
      databaseId: 'db_123',
      databaseName: 'queue',
      baseUrl: 'https://api.db9.ai',
      token: 'secret-token',
      exportedAt: '2026-04-21T00:00:00.000Z',
    };
    expect(decodeQueueExportBlob(encodeQueueExportBlob(blob))).toEqual(blob);
  });

  it('rejects invalid blob payloads', () => {
    expect(() => decodeQueueExportBlob('not-base64')).toThrow(
      'Invalid export blob:'
    );
  });
});
