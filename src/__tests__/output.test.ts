import { describe, expect, it, vi } from 'vitest';

import { printClaimResult, printTask, printTaskList } from '../output';
import type { TaskRecord } from '../types';

const task: TaskRecord = {
  id: 7,
  title: 'ship it',
  payload: { priority: 'high' },
  priority: 5,
  status: 'todo',
  assignee: null,
  lease_seconds: null,
  created_at: '2026-04-19T18:30:00Z',
  claimed_at: null,
  completed_at: null,
};

describe('output formatters', () => {
  it('prints task lists as JSON envelopes', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    printTaskList([task], 'json');
    expect(log).toHaveBeenCalledWith(
      JSON.stringify(
        {
          tasks: [
            {
              ...task,
              created_at: '2026-04-19T18:30:00.000Z',
            },
          ],
        },
        null,
        2
      )
    );
    log.mockRestore();
  });

  it('prints task lists as JSONL when requested', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    printTaskList([task], 'jsonl');
    expect(log).toHaveBeenCalledWith(
      JSON.stringify({
        ...task,
        created_at: '2026-04-19T18:30:00.000Z',
      })
    );
    log.mockRestore();
  });

  it('prints single tasks as JSON envelopes', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    printTask(task, 'json');
    expect(log).toHaveBeenCalledWith(
      JSON.stringify(
        {
          task: {
            ...task,
            created_at: '2026-04-19T18:30:00.000Z',
          },
        },
        null,
        2
      )
    );
    log.mockRestore();
  });

  it('prints empty claim results as JSON null envelopes', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    printClaimResult(null, 'json');
    expect(log).toHaveBeenCalledWith(
      JSON.stringify({ task: null }, null, 2)
    );
    log.mockRestore();
  });

  it('normalizes postgres-style timestamps to ISO8601 in JSON output', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    printTask(
      {
        ...task,
        created_at: '2026-04-20 01:52:12.604000+00',
      },
      'json'
    );
    expect(log).toHaveBeenCalledWith(
      JSON.stringify(
        {
          task: {
            ...task,
            created_at: '2026-04-20T01:52:12.604Z',
          },
        },
        null,
        2
      )
    );
    log.mockRestore();
  });
});
