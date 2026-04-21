import type { QueueExportBlob } from './types';

export function encodeQueueExportBlob(blob: QueueExportBlob): string {
  return Buffer.from(JSON.stringify(blob), 'utf8').toString('base64url');
}

export function decodeQueueExportBlob(raw: string): QueueExportBlob {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw.trim(), 'base64url').toString('utf8'));
  } catch (error) {
    throw new Error(
      `Invalid export blob: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }

  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    (parsed as { version?: unknown }).version !== 1 ||
    (parsed as { mode?: unknown }).mode !== 'token' ||
    typeof (parsed as { databaseId?: unknown }).databaseId !== 'string' ||
    typeof (parsed as { databaseName?: unknown }).databaseName !== 'string' ||
    typeof (parsed as { baseUrl?: unknown }).baseUrl !== 'string' ||
    typeof (parsed as { token?: unknown }).token !== 'string' ||
    typeof (parsed as { exportedAt?: unknown }).exportedAt !== 'string'
  ) {
    throw new Error('Invalid export blob: unsupported shape.');
  }

  return parsed as QueueExportBlob;
}
