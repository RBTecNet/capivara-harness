import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { stdin, stdout } from 'node:process';
import { stat } from 'node:fs/promises';
import type { Question } from '../domain/types.js';
import { DashboardTerminal } from '../dashboard/terminal.js';
import { DashboardModel } from '../dashboard/model.js';
import type { DashboardEvent } from '../dashboard/types.js';
import { inspectProject } from './wizard.js';
import { ProjectStore } from './store.js';

function readRuntime(db: DatabaseSync, attached = false) {
  const owner = db.prepare('SELECT pid FROM owner WHERE id=1').get() as { pid: number } | undefined;
  const candidate = owner?.pid ?? (attached ? process.ppid : undefined);
  const pid = candidate && Number.isSafeInteger(candidate) && candidate > 0 ? candidate : undefined;
  let alive = false;
  if (pid) { try { process.kill(pid, 0); alive = true; } catch (error) { alive = (error as NodeJS.ErrnoException).code === 'EPERM'; } }
  const latest = db.prepare('SELECT id,at FROM events ORDER BY id DESC LIMIT 1').get() as { id: number; at: string } | undefined;
  return { runtime: { ...(pid ? { pid } : {}), alive, ...(latest ? { lastEventAt: latest.at } : {}) }, latest };
}

/** The separate viewer reads the journal and never claims the running constructor's lease. */
export async function showProjectDashboard(workspace: string, json = false): Promise<void> {
  const initial = await inspectProject(workspace);
  if (json || !stdin.isTTY || !stdout.isTTY) {
    const model = new DashboardModel(initial, { workspace });
    let db: DatabaseSync | undefined;
    try {
      db = new DatabaseSync(join(workspace, '.capivara-next/project.sqlite'), { readOnly: true });
      let after = 0;
      for (;;) {
        const rows = db.prepare('SELECT id,at,type,body FROM events WHERE id>? ORDER BY id LIMIT 1000').all(after) as unknown as { id: number; at: string; type: string; body: string }[];
        if (!rows.length) break;
        for (const row of rows) model.observe(row);
        after = rows.at(-1)!.id;
      }
      model.updateRuntime(readRuntime(db).runtime);
    } catch { /* State and readable snapshots remain useful without a journal. */ }
    finally { db?.close(); }
    const view = model.snapshot();
    if (json) stdout.write(`${JSON.stringify(view, null, 2)}\n`);
    else stdout.write(`${view.panels.map(panel => `${panel.title}\n${panel.lines.join('\n')}`).join('\n\n')}\n`);
    return;
  }
  const attached = process.env.CAPIVARA_DASHBOARD_CHILD === '1' && typeof process.send === 'function';
  const send = (message: object): void => { if (attached && process.connected) { try { process.send!(message, () => undefined); } catch { /* Parent may already have exited. */ } } };
  let done: () => void = () => undefined;
  const finished = new Promise<void>(resolve => { done = resolve; });
  const dashboard = new DashboardTerminal({ workspace, initial, viewer: !attached, cancel: () => send({ type: 'cancel' }), onClose: () => queueMicrotask(() => { send({ type: 'closed' }); done(); }), onError: () => send({ type: 'error', message: 'O painel ficou indisponível; o motor continua independente.' }), onAnswer: async (id, answer) => {
    const store = new ProjectStore(workspace);
    try {
      if (!store.read().brief?.gaps.some(gap => gap.id === id)) throw new Error('Essa decisão já não pertence ao pedido atual.');
      store.answer(id, answer);
      dashboard.updateProject(store.read());
    } finally { store.close(); }
  } });
  let cursor = 0; let updating = false;
  let db: DatabaseSync | undefined, revision: number | undefined, hasRevision: boolean | undefined, dataVersion: number | undefined;
  let fileIdentity = '', checkedFileAt = 0, historyLoaded = 0, historyShown = -1, historyTotal: number | undefined;
  let continuation: ReturnType<typeof setTimeout> | undefined;
  const databasePath = join(workspace, '.capivara-next/project.sqlite');
  const update = async (): Promise<void> => {
    if (updating || !dashboard.active) return;
    updating = true;
    try {
      if (Date.now() - checkedFileAt > 2000) {
        const file = await stat(databasePath), identity = `${file.dev}:${file.ino}`;
        if (fileIdentity && fileIdentity !== identity) { db?.close(); db = undefined; revision = undefined; dataVersion = undefined; hasRevision = undefined; }
        fileIdentity = identity; checkedFileAt = Date.now();
      }
      if (!db) { db = new DatabaseSync(databasePath, { readOnly: true }); db.exec('PRAGMA busy_timeout=25'); }
      const version = (db.prepare('PRAGMA data_version').get() as { data_version: number }).data_version;
      let nextRevision: number | undefined;
      if (hasRevision !== false) {
        try { nextRevision = (db.prepare('SELECT revision FROM project_revision WHERE id=1').get() as { revision: number } | undefined)?.revision; hasRevision = nextRevision !== undefined; }
        catch { hasRevision = false; }
      }
      if (hasRevision ? nextRevision !== revision : version !== dataVersion) {
        const row = db.prepare('SELECT body FROM project WHERE id=1').get() as { body: string } | undefined;
        if (row) dashboard.updateProject(JSON.parse(row.body));
        revision = nextRevision; dataVersion = version;
      }
      const { runtime, latest } = readRuntime(db, attached);
      dashboard.updateRuntime(runtime);
      historyTotal ??= (db.prepare('SELECT count(*) AS total FROM events').get() as { total: number }).total;
      const began = performance.now();
      for (const row of db.prepare('SELECT id,at,type,body FROM events WHERE id>? ORDER BY id LIMIT 250').all(cursor) as unknown as { id: number; at: string; type: string; body: string }[]) {
        dashboard.observe(row as DashboardEvent); cursor = row.id; historyLoaded++;
        if (performance.now() - began > 12) break;
      }
      const loaded = Math.min(historyLoaded, historyTotal);
      if (historyShown !== loaded) {
        dashboard.observe({ type: 'progress', progress: { id: 'dashboard:history', label: 'Leitura do histórico', completed: loaded, total: historyTotal, status: historyLoaded >= historyTotal ? 'complete' : 'running', stage: 'dashboard', unit: 'eventos' } });
        historyShown = loaded;
      }
      if (latest && cursor < latest.id && !continuation) continuation = setTimeout(() => { continuation = undefined; void update(); }, 0);
    } catch { /* A reader's temporary unavailability cannot interfere with construction. */ }
    finally { updating = false; }
  };
  const stop = (): void => { dashboard.close(); };
  const interrupt = (): void => { if (attached) send({ type: 'cancel' }); stop(); };
  const message = (value: unknown): void => {
    if (!attached || !value || typeof value !== 'object') return;
    const request = value as { type?: string; id?: string; question?: Question };
    if (request.type === 'close') stop();
    else if (request.type === 'ask' && typeof request.id === 'string' && request.question?.id) void dashboard.ask(request.question).then(answer => send({ type: 'answer', id: request.id, value: answer }), () => send({ type: 'answer', id: request.id, value: null }));
  };
  process.on('SIGINT', interrupt); process.on('SIGTERM', stop); process.on('SIGHUP', stop);
  if (attached) { process.on('message', message); process.on('disconnect', stop); }
  let timer: ReturnType<typeof setInterval> | undefined;
  try {
    if (!dashboard.start()) { send({ type: 'error', message: 'Terminal indisponível para o painel.' }); return; }
    send({ type: 'ready' });
    await update();
    timer = setInterval(() => { void update(); }, 500);
    await finished;
  } finally {
    clearInterval(timer); clearTimeout(continuation); process.off('SIGINT', interrupt); process.off('SIGTERM', stop); process.off('SIGHUP', stop);
    if (attached) { process.off('message', message); process.off('disconnect', stop); }
    db?.close(); dashboard.close();
    if (attached && process.connected) process.disconnect?.();
  }
}
