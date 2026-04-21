import { readFile, writeFile, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { parse as parseToml, stringify as stringifyToml } from '@iarna/toml';
import { createDb9Client } from 'get-db9';

import type {
  AnonymousRefreshResponse,
  AnonymousRegisterResponse,
  Db9CredentialRecord,
  ResolvedAuth,
} from './types';

const PROD_API_BASE_URL = 'https://api.db9.ai';

function credentialPath(): string {
  return path.join(os.homedir(), '.db9', 'credentials');
}

export function resolveBaseUrl(explicit?: string): string {
  if (explicit?.trim()) {
    return explicit.trim();
  }
  if (process.env.DB9_API_URL?.trim()) {
    return process.env.DB9_API_URL.trim();
  }
  return PROD_API_BASE_URL;
}

async function readCredentialRecord(): Promise<Db9CredentialRecord | null> {
  const filePath = credentialPath();
  try {
    const content = await readFile(filePath, 'utf8');
    const parsed = parseToml(content) as Record<string, unknown>;
    const record: Db9CredentialRecord = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (
        typeof value === 'string' ||
        typeof value === 'boolean' ||
        typeof value === 'number'
      ) {
        record[key] = value;
      }
    }
    return record;
  } catch (error) {
    const errno = error as NodeJS.ErrnoException;
    if (errno.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

async function writeCredentialRecord(record: Db9CredentialRecord): Promise<void> {
  const filePath = credentialPath();
  await mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const serializable: Record<string, string | boolean | number> = {};
  for (const [key, value] of Object.entries(record)) {
    if (
      typeof value === 'string' ||
      typeof value === 'boolean' ||
      typeof value === 'number'
    ) {
      serializable[key] = value;
    }
  }
  await writeFile(filePath, stringifyToml(serializable), { mode: 0o600 });
}

export async function saveTokenCredential(token: string): Promise<void> {
  await writeCredentialRecord({
    token,
    is_anonymous: false,
  });
}

async function mergeCredentialRecord(
  patch: Partial<Db9CredentialRecord>
): Promise<void> {
  const existing = (await readCredentialRecord()) ?? {};
  const merged: Db9CredentialRecord = { ...existing, ...patch };
  await writeCredentialRecord(merged);
}

async function anonymousRegister(
  baseUrl: string
): Promise<AnonymousRegisterResponse> {
  const response = await fetch(`${baseUrl}/customer/anonymous-register`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: '{}',
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `Anonymous registration failed (${response.status}): ${text || response.statusText}`
    );
  }

  return (await response.json()) as AnonymousRegisterResponse;
}

async function anonymousRefresh(
  baseUrl: string,
  anonymousId: string,
  anonymousSecret: string
): Promise<AnonymousRefreshResponse> {
  const response = await fetch(`${baseUrl}/customer/anonymous-refresh`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      anonymous_id: anonymousId,
      anonymous_secret: anonymousSecret,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `Anonymous token refresh failed (${response.status}): ${text || response.statusText}`
    );
  }

  return (await response.json()) as AnonymousRefreshResponse;
}

function isUnauthorizedError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'statusCode' in error &&
    (error as { statusCode?: unknown }).statusCode === 401
  );
}

async function validateStoredToken(
  baseUrl: string,
  token: string
): Promise<void> {
  const client = createDb9Client({ baseUrl, token });
  await client.auth.me();
}

function resolveEnvironmentToken(): string | undefined {
  const candidates = [
    process.env.DB9_QUEUE_TOKEN,
    process.env.DB9_API_KEY,
    process.env.DB9_TOKEN,
  ];
  for (const candidate of candidates) {
    if (candidate?.trim()) {
      return candidate.trim();
    }
  }
  return undefined;
}

export interface ResolveAuthOptions {
  token?: string;
  baseUrl?: string;
  allowAnonymousBootstrap?: boolean;
}

export async function resolveAuth(
  options: ResolveAuthOptions = {}
): Promise<ResolvedAuth> {
  const baseUrl = resolveBaseUrl(options.baseUrl);
  if (options.token?.trim()) {
    return {
      token: options.token.trim(),
      baseUrl,
      source: 'flag',
      isAnonymous: false,
    };
  }

  const envToken = resolveEnvironmentToken();
  if (envToken) {
    return {
      token: envToken,
      baseUrl,
      source: 'environment',
      isAnonymous: false,
    };
  }

  const stored = await readCredentialRecord();

  if (stored?.token) {
    try {
      await validateStoredToken(baseUrl, stored.token);
      return {
        token: stored.token,
        baseUrl,
        source: 'shared-credentials',
        isAnonymous: stored.is_anonymous === true,
      };
    } catch (error) {
      if (
        !isUnauthorizedError(error) ||
        !stored.anonymous_id ||
        !stored.anonymous_secret
      ) {
        throw error;
      }
      const refreshed = await anonymousRefresh(
        baseUrl,
        stored.anonymous_id,
        stored.anonymous_secret
      );
      await mergeCredentialRecord({
        token: refreshed.token,
        customer_id: stored.customer_id ?? stored.anonymous_id,
        anonymous_id: stored.anonymous_id,
        anonymous_secret: stored.anonymous_secret,
        is_anonymous: true,
      });
      return {
        token: refreshed.token,
        baseUrl,
        source: 'anonymous-refresh',
        isAnonymous: true,
      };
    }
  }

  if (stored?.anonymous_id && stored.anonymous_secret) {
    const refreshed = await anonymousRefresh(
      baseUrl,
      stored.anonymous_id,
      stored.anonymous_secret
    );
    await mergeCredentialRecord({
      token: refreshed.token,
      customer_id: stored.customer_id ?? stored.anonymous_id,
      anonymous_id: stored.anonymous_id,
      anonymous_secret: stored.anonymous_secret,
      is_anonymous: true,
    });
    return {
      token: refreshed.token,
      baseUrl,
      source: 'anonymous-refresh',
      isAnonymous: true,
    };
  }

  if (options.allowAnonymousBootstrap) {
    const registered = await anonymousRegister(baseUrl);
    await mergeCredentialRecord({
      token: registered.token,
      customer_id: registered.anonymous_id,
      anonymous_id: registered.anonymous_id,
      anonymous_secret: registered.anonymous_secret,
      is_anonymous: true,
    });
    return {
      token: registered.token,
      baseUrl,
      source: 'anonymous-bootstrap',
      isAnonymous: true,
    };
  }

  throw new Error(
    'No db9 token available. Pass `--token`, set `DB9_QUEUE_TOKEN`/`DB9_API_KEY`/`DB9_TOKEN`, reuse `~/.db9/credentials`, or run `dbqueue init` with no token to bootstrap an anonymous db9 account.'
  );
}
