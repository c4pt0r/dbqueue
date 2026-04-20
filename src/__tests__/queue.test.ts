import { describe, expect, it } from 'vitest';

import {
  buildAddTaskSql,
  buildClaimTaskSql,
  buildDoneTaskSql,
  buildListTasksSql,
  sqlJson,
  sqlString,
} from '../queue';

describe('queue SQL helpers', () => {
  it('escapes single quotes in SQL string literals', () => {
    expect(sqlString("O'Hara")).toBe("'O''Hara'");
  });

  it('serializes JSON payloads as jsonb literals', () => {
    expect(sqlJson({ priority: 'high', count: 2 })).toBe(
      `'{"priority":"high","count":2}'::jsonb`
    );
  });

  it('builds add-task SQL with escaped title and json payload', () => {
    const sql = buildAddTaskSql("ship it's done", { ok: true });
    expect(sql).toContain("VALUES ('ship it''s done', '{\"ok\":true}'::jsonb)");
    expect(sql).toContain('RETURNING');
  });

  it('serializes null payloads as SQL NULL', () => {
    expect(sqlJson(undefined)).toBe('NULL');
  });

  it('builds list-task SQL with optional filters and bounded limit', () => {
    const sql = buildListTasksSql({
      status: 'in_progress',
      assignee: 'worker-1',
      limit: 999,
    });
    expect(sql).toContain("status = 'in_progress'");
    expect(sql).toContain("assignee = 'worker-1'");
    expect(sql).toContain('LIMIT 200');
    expect(sql).toContain('ORDER BY id DESC');
  });

  it('builds list-task SQL without a limit when `all` is requested', () => {
    const sql = buildListTasksSql({
      all: true,
    });
    expect(sql).toContain('ORDER BY id DESC');
    expect(sql).not.toContain('LIMIT');
  });

  it('builds claim and done SQL against the namespaced schema', () => {
    expect(buildClaimTaskSql('worker-1')).toContain('UPDATE dbqueue.tasks');
    expect(buildDoneTaskSql(42)).toContain('WHERE id = 42');
  });
});
