import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync, writeFileSync, renameSync, existsSync, chmodSync, lstatSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { ProductBrief, DevelopmentPlan, Question } from '../domain/types.js';
import type { AgentConfig } from '../runtime/types.js';
import type { SelectedProjectInput } from './data-source.js';

export interface SavedProject {
  request?: string;
  brief?: ProductBrief;
  plan?: DevelopmentPlan;
  execution?: unknown;
  dataCenter?: SelectedProjectInput | null;
  config?: AgentConfig;
  reviewer?: AgentConfig;
  allowSystemInstall?: boolean;
  maxConcurrent?: number;
  lastFailure?: { kind: string; message: string; fingerprint: string; at: string } | null;
  domainCalls?: Record<string, { operation: string; status: 'running' | 'complete' | 'failed'; at: string; result?: string; failure?: string }>;
  workflowMetrics?: { timeByStageMs: Record<string, number>; callsByRole: Record<string, number>; activeAgents: number; maxConcurrency: number };
  status?: 'working' | 'recovering' | 'waiting' | 'complete' | 'cancelled' | 'critical';
  stage?: string;
  pendingQuestion?: Question | null;
  updatedAt?: string;
}

interface RecoverySnapshot {
  schema: 'capivara/recovery/1';
  project: SavedProject;
  answers: { id: string; body: string }[];
}

export interface ProjectEventRow { id: number; at: string; type: string; body: string; }

/** One transaction owns the published project revision. The JSON copy is disaster recovery only. */
export class ProjectStore {
  readonly directory: string;
  private readonly db: DatabaseSync;
  private readonly owner = randomUUID();
  private claimed = false;

  constructor(workspace: string) {
    this.directory = join(resolve(workspace), '.capivara-next');
    if (existsSync(this.directory) && lstatSync(this.directory).isSymbolicLink()) throw new Error('A pasta de controle .capivara-next precisa ser uma pasta real do projeto.');
    mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    chmodSync(this.directory, 0o700);
    const path = join(this.directory, 'project.sqlite');
    let db: DatabaseSync | undefined;
    let confirmedCorruption = false;
    try {
      db = new DatabaseSync(path);
      db.exec('PRAGMA busy_timeout=5000');
      const checks = db.prepare('PRAGMA quick_check').all() as { quick_check: string }[];
      if (checks.some(check => check.quick_check !== 'ok')) {
        confirmedCorruption = true;
        throw new Error('Estado SQLite precisa de recuperação.');
      }
      db.exec('CREATE TABLE IF NOT EXISTS project (id INTEGER PRIMARY KEY CHECK(id=1), body TEXT NOT NULL);');
    } catch (error) {
      try { db?.close(); } catch { /* Preserve the damaged copy before recovery. */ }
      const sqlite = error as { errcode?: number; message?: string };
      if (!confirmedCorruption && sqlite.errcode !== 11 && sqlite.errcode !== 26 && !/database disk image is malformed|file is not a database/i.test(sqlite.message ?? '')) throw error;
      const backup = join(this.directory, 'project.snapshot.json');
      if (!existsSync(backup)) throw error;
      const parsed = JSON.parse(readFileSync(backup, 'utf8')) as RecoverySnapshot;
      if (parsed.schema !== 'capivara/recovery/1' || !parsed.project || typeof parsed.project !== 'object' || !Array.isArray(parsed.answers) || parsed.answers.some(answer => typeof answer.id !== 'string' || typeof answer.body !== 'string')) throw new Error('A cópia de recuperação não contém pedido e respostas consistentes.', { cause: error });
      const stamp = `${Date.now()}-${randomUUID()}`;
      for (const suffix of ['', '-wal', '-shm']) {
        const source = path + suffix;
        if (existsSync(source)) renameSync(source, `${source}.damaged-${stamp}`);
      }
      db = new DatabaseSync(path);
      db.exec('BEGIN IMMEDIATE; CREATE TABLE project (id INTEGER PRIMARY KEY CHECK(id=1), body TEXT NOT NULL); CREATE TABLE answers (id TEXT PRIMARY KEY, body TEXT NOT NULL);');
      db.prepare('INSERT INTO project VALUES(1,?)').run(JSON.stringify(parsed.project));
      for (const answer of parsed.answers) db.prepare('INSERT INTO answers VALUES(?,?)').run(answer.id, answer.body);
      db.exec('COMMIT');
    }
    this.db = db;
    chmodSync(path, 0o600);
    db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY, at TEXT NOT NULL, type TEXT NOT NULL, body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS answers (id TEXT PRIMARY KEY, body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS owner (id INTEGER PRIMARY KEY CHECK(id=1), token TEXT NOT NULL, pid INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS project_revision (id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL);
      INSERT OR IGNORE INTO project_revision VALUES(1,0);
      CREATE TRIGGER IF NOT EXISTS project_revision_insert AFTER INSERT ON project BEGIN UPDATE project_revision SET revision=revision+1 WHERE id=1; END;
      CREATE TRIGGER IF NOT EXISTS project_revision_update AFTER UPDATE ON project BEGIN UPDATE project_revision SET revision=revision+1 WHERE id=1; END;`);
  }

  read(): SavedProject {
    const row = this.db.prepare('SELECT body FROM project WHERE id=1').get() as { body: string } | undefined;
    return row ? JSON.parse(row.body) as SavedProject : {};
  }

  update(patch: Partial<SavedProject>): SavedProject {
    this.db.exec('BEGIN IMMEDIATE');
    let state: SavedProject;
    try {
      state = { ...this.read(), ...patch, updatedAt: new Date().toISOString() };
      this.db.prepare('INSERT INTO project VALUES(1,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body').run(JSON.stringify(state));
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
    this.writeRecoverySnapshot();
    return state;
  }

  event(type: string, detail: unknown): void {
    try { this.db.prepare('INSERT INTO events(at,type,body) VALUES(?,?,?)').run(new Date().toISOString(), type, JSON.stringify(detail)); }
    catch { /* Observation failure cannot end the construction. */ }
  }

  recent(limit = 20): unknown[] {
    return this.db.prepare('SELECT at,type,body FROM events ORDER BY id DESC LIMIT ?').all(limit);
  }

  /** Ordered pages let the dashboard reach the entire journal without a fixed history cutoff. */
  eventsAfter(after = 0, limit = 1000): ProjectEventRow[] {
    const pageSize = Math.max(1, Math.min(5000, Math.floor(limit)));
    return this.db.prepare('SELECT id,at,type,body FROM events WHERE id>? ORDER BY id LIMIT ?').all(after, pageSize) as unknown as ProjectEventRow[];
  }

  answer(id: string, answer: string): void {
    this.db.prepare('INSERT INTO answers VALUES(?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body').run(id, answer);
    this.writeRecoverySnapshot();
  }

  getAnswer(id: string): string | undefined {
    const row = this.db.prepare('SELECT body FROM answers WHERE id=?').get(id) as { body: string } | undefined;
    return row?.body;
  }

  private writeRecoverySnapshot(): void {
    let locked = false;
    try {
      // Serialize publication with other writers, so an older observer cannot replace a newer answer snapshot.
      this.db.exec('BEGIN IMMEDIATE'); locked = true;
      const project = this.db.prepare("SELECT body,CASE WHEN json_valid(body) THEN json_type(body) END AS type FROM project WHERE id=1").get() as { body: string; type: string | null } | undefined;
      if (project && project.type !== 'object') throw new Error('O estado persistido do projeto não é um objeto JSON válido.');
      const answers = this.db.prepare('SELECT id,body FROM answers ORDER BY id').all() as RecoverySnapshot['answers'];
      // The committed JSON is already serialized. Preserve its exact contents
      // without allocating another parsed project or formatting its full tree.
      const snapshot = `{"schema":"capivara/recovery/1","project":${project?.body ?? '{}'},"answers":${JSON.stringify(answers)}}\n`;
      const temp = join(this.directory, `.snapshot-${this.owner}`);
      writeFileSync(temp, snapshot, { mode: 0o600, flush: true });
      renameSync(temp, join(this.directory, 'project.snapshot.json'));
      this.db.exec('COMMIT'); locked = false;
    } catch {
      if (locked) { try { this.db.exec('ROLLBACK'); } catch { /* Preserve the committed authoritative tables. */ } }
      // Backup publication failure does not undo the already durable answer or project revision.
    }
  }

  claim(): boolean {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const row = this.db.prepare('SELECT token,pid FROM owner WHERE id=1').get() as { token: string; pid: number } | undefined;
      let alive = false;
      if (row) {
        try { process.kill(row.pid, 0); alive = true; }
        catch (error) { alive = (error as NodeJS.ErrnoException).code === 'EPERM'; }
      }
      if (alive && row?.token !== this.owner) { this.db.exec('COMMIT'); return false; }
      this.db.prepare('INSERT INTO owner VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET token=excluded.token,pid=excluded.pid').run(this.owner, process.pid);
      this.db.exec('COMMIT');
      this.claimed = true;
      return true;
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }

  release(): void {
    if (!this.claimed) return;
    this.db.prepare('DELETE FROM owner WHERE token=?').run(this.owner);
    this.claimed = false;
  }
  close(): void { this.release(); this.db.close(); }
}
