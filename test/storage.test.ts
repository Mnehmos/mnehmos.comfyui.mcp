import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { RunsDb } from '../src/storage/db.js';

let dbPath: string;

beforeEach(() => {
  dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'comfy-db-')), 'runs.db');
});

afterEach(() => {
  fs.rmSync(path.dirname(dbPath), { recursive: true, force: true });
});

describe('runs + audit storage', () => {
  it('round-trips a run with status updates', () => {
    const db = new RunsDb(dbPath);
    try {
      db.insertRun({
        run_id: 'r1', prompt_id: 'p1', workflow_name: 'w.json', workflow_hash: 'abc',
        master_seed: 42, seeds_json: '[]', status: 'queued', error: null,
        comfy_version: '0.34.3', submitted_at: '2026-09-03T00:00:00Z',
      });
      db.updateRunStatus('r1', 'success', {
        finished_at: '2026-09-03T00:01:00Z',
        outputs_json: JSON.stringify([{ filename: 'out.png', subfolder: '', type: 'output' }]),
      });
      const row = db.getRun('r1');
      expect(row?.status).toBe('success');
      expect(row?.master_seed).toBe(42);
      expect(JSON.parse(row!.outputs_json)).toHaveLength(1);
      expect(db.getRunByPromptId('p1')?.run_id).toBe('r1');
      expect(db.recentRuns(5)).toHaveLength(1);
    } finally {
      db.close();
    }
  });

  it('records accepted and rejected calls in the audit trail', () => {
    const db = new RunsDb(dbPath);
    try {
      db.logCall('comfy_render', 'submit', { a: 1 }, 'accepted', 'ok');
      db.logCall('comfy_render', 'submit', { a: 2 }, 'rejected', 'validation_failed');
      const rows = db['db'].prepare('SELECT * FROM calls ORDER BY id').all() as Array<{ verdict: string }>;
      expect(rows.map((r) => r.verdict)).toEqual(['accepted', 'rejected']);
    } finally {
      db.close();
    }
  });
});
