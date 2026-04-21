export type TaskStatus = 'todo' | 'in_progress' | 'done';

export interface QueueConfig {
  version: 1;
  databaseId: string;
  databaseName: string;
  baseUrl: string;
  updatedAt: string;
}

export interface Db9CredentialRecord {
  token?: string;
  customer_id?: string;
  anonymous_id?: string;
  anonymous_secret?: string;
  is_anonymous?: boolean;
  [key: string]: string | boolean | number | undefined;
}

export interface AnonymousRegisterResponse {
  token: string;
  expires_at: string;
  is_anonymous: boolean;
  anonymous_id: string;
  anonymous_secret: string;
}

export interface AnonymousRefreshResponse {
  token: string;
  expires_at: string;
}

export interface ResolvedAuth {
  token: string;
  baseUrl: string;
  source:
    | 'flag'
    | 'environment'
    | 'shared-credentials'
    | 'anonymous-bootstrap'
    | 'anonymous-refresh';
  isAnonymous: boolean;
}

export interface TaskRecord {
  id: number;
  title: string;
  payload: unknown | null;
  status: TaskStatus;
  assignee: string | null;
  lease_seconds: number | null;
  created_at: string | null;
  claimed_at: string | null;
  completed_at: string | null;
}
