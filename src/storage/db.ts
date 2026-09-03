/**
 * SQLite persistence (doctrine: durable state lives in the database, never in
 * conversation context). Two tables:
 *   runs  — every submitted render + its provenance
 *   calls — audit trail: every tool call, accepted or rejected
 */
import Database from 'better-sqlite3';
import * as fs from 'node:fs';
import * as path from 'node:path';

export interface RunRow {
  run_id: string;
  prompt_id: string;
  workflow_name: string | null;
  workflow_hash: string;
  master_seed: number;
  seeds_json: string;
  status: string;
  error: string | null;
  comfy_version: string;
  submitted_at: string;
  finished_at: string | null;
  outputs_json: string;
}

export interface CallRow {
  id: number;
  ts: string;
  tool: string;
  action: string;
  args_json: string;
  verdict: 'accepted' | 'rejected';
  detail: string;
}

export class RunsDb {
  private db: Database.Database;

  constructor(dbPath: string) {
    fs.mkdirSync(path.dirname(path.resolve(dbPath)), { recursive: true });
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS runs (
        run_id        TEXT PRIMARY KEY,
        prompt_id     TEXT NOT NULL,
        workflow_name TEXT,
        workflow_hash TEXT NOT NULL,
        master_seed   INTEGER NOT NULL,
        seeds_json    TEXT NOT NULL,
        status        TEXT NOT NULL,
        error         TEXT,
        comfy_version TEXT NOT NULL,
        submitted_at  TEXT NOT NULL,
        finished_at   TEXT,
        outputs_json  TEXT NOT NULL DEFAULT '[]'
      );
      CREATE INDEX IF NOT EXISTS idx_runs_prompt ON runs(prompt_id);
      CREATE TABLE IF NOT EXISTS calls (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ts TEXT NOT NULL,
        tool TEXT NOT NULL,
        action TEXT NOT NULL,
        args_json TEXT NOT NULL,
        verdict TEXT NOT NULL CHECK (verdict IN ('accepted','rejected')),
        detail TEXT NOT NULL
      );
    `);
  }

  insertRun(r: Omit<RunRow, 'finished_at' | 'outputs_json'>): void {
    this.db
      .prepare(
        `INSERT INTO runs (run_id, prompt_id, workflow_name, workflow_hash, master_seed,
         seeds_json, status, error, comfy_version, submitted_at, finished_at, outputs_json)
         VALUES (@run_id, @prompt_id, @workflow_name, @workflow_hash, @master_seed,
         @seeds_json, @status, @error, @comfy_version, @submitted_at, NULL, '[]')`,
      )
      .run(r);
  }

  updateRunStatus(
    runId: string,
    status: string,
    opts: { finished_at?: string; outputs_json?: string; error?: string } = {},
  ): void {
    this.db
      .prepare(
        `UPDATE runs SET status=@status,
         finished_at = COALESCE(@finished_at, finished_at),
         outputs_json = COALESCE(@outputs_json, outputs_json),
         error = COALESCE(@error, error)
         WHERE run_id = @run_id`,
      )
      .run({
        run_id: runId,
        status,
        finished_at: opts.finished_at ?? null,
        outputs_json: opts.outputs_json ?? null,
        error: opts.error ?? null,
      });
  }

  getRun(runId: string): RunRow | undefined {
    return this.db.prepare('SELECT * FROM runs WHERE run_id = ?').get(runId) as RunRow | undefined;
  }

  getRunByPromptId(promptId: string): RunRow | undefined {
    return this.db
      .prepare('SELECT * FROM runs WHERE prompt_id = ? ORDER BY submitted_at DESC LIMIT 1')
      .get(promptId) as RunRow | undefined;
  }

  recentRuns(limit = 20): Array<Partial<RunRow>> {
    return this.db
      .prepare(
        'SELECT run_id, prompt_id, workflow_name, status, master_seed, submitted_at, finished_at FROM runs ORDER BY submitted_at DESC LIMIT ?',
      )
      .all(limit) as Array<Partial<RunRow>>;
  }

  logCall(tool: string, action: string, args: unknown, verdict: 'accepted' | 'rejected', detail: string): void {
    this.db
      .prepare(
        'INSERT INTO calls (ts, tool, action, args_json, verdict, detail) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run(new Date().toISOString(), tool, action, JSON.stringify(args), verdict, detail);
  }

  close(): void {
    this.db.close();
  }
}
