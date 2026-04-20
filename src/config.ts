import { mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import type { QueueConfig } from './types';

const CONFIG_DIR = path.join(os.homedir(), '.dbqueue');
const CONFIG_PATH = path.join(CONFIG_DIR, 'config.json');

export function getQueueConfigPath(): string {
  return CONFIG_PATH;
}

export async function loadQueueConfig(): Promise<QueueConfig | null> {
  try {
    const content = await readFile(CONFIG_PATH, 'utf8');
    const parsed = JSON.parse(content) as QueueConfig;
    if (!parsed.databaseId || !parsed.databaseName || !parsed.baseUrl) {
      return null;
    }
    return parsed;
  } catch (error) {
    const errno = error as NodeJS.ErrnoException;
    if (errno.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

export async function saveQueueConfig(config: QueueConfig): Promise<void> {
  await mkdir(CONFIG_DIR, { recursive: true, mode: 0o700 });
  await writeFile(CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`, {
    mode: 0o600,
  });
}
