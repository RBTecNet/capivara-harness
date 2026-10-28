import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { stdin, stdout } from 'node:process';
import { DashboardTerminal } from '../dashboard/terminal.js';
import { DashboardModel } from '../dashboard/model.js';
import type { DashboardEvent } from '../dashboard/types.js';
import { inspectProject } from './wizard.js';
import { ProjectStore } from './store.js';

export function hydrateDashboard(dashboard: DashboardTerminal, store: ProjectStore): void {
  let cursor = 0;
  for (;;) {
    const rows = store.eventsAfter(cursor);
    if (!rows.length) break;
    for (const row of rows) dashboard.observe(row);
    cursor = rows.at(-1)!.id;
  }
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
    } catch { /* State and readable snapshots remain useful without a journal. */ }
    finally { db?.close(); }
    const view = model.snapshot();
    if (json) stdout.write(`${JSON.stringify(view, null, 2)}\n`);
    else stdout.write(`${view.panels.map(panel => `${panel.title}\n${panel.lines.join('\n')}`).join('\n\n')}\n`);
    return;
  }
  let done: () => void = () => undefined;
  const finished = new Promise<void>(resolve => { done = resolve; });
  const dashboard = new DashboardTerminal({ workspace, initial, viewer: true, onClose: () => done(), onAnswer: async (id, answer) => {
    const store = new ProjectStore(workspace);
    try {
      if (!store.read().brief?.gaps.some(gap => gap.id === id)) throw new Error('Essa decisão já não pertence ao pedido atual.');
      store.answer(id, answer);
      dashboard.updateProject(store.read());
    } finally { store.close(); }
  } });
  let cursor = 0; let updating = false; let stamp = initial.updatedAt;
  const update = async (): Promise<void> => {
    if (updating || !dashboard.active) return;
    updating = true;
    let db: DatabaseSync | undefined;
    try {
      const state = await inspectProject(workspace);
      if (state.updatedAt !== stamp) { dashboard.updateProject(state); stamp = state.updatedAt; }
      db = new DatabaseSync(join(workspace, '.capivara-next/project.sqlite'), { readOnly: true });
      for (let page = 0; page < 10; page++) {
        const rows = db.prepare('SELECT id,at,type,body FROM events WHERE id>? ORDER BY id LIMIT 500').all(cursor) as unknown as { id: number; at: string; type: string; body: string }[];
        if (!rows.length) break;
        for (const row of rows) dashboard.observe(row as DashboardEvent);
        cursor = rows.at(-1)!.id;
      }
    } catch { /* A reader's temporary unavailability cannot interfere with construction. */ }
    finally { db?.close(); updating = false; }
  };
  const stop = (): void => { dashboard.close(); };
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
  let timer: ReturnType<typeof setInterval> | undefined;
  try {
    if (!dashboard.start()) return;
    await update();
    timer = setInterval(() => { void update(); }, 500);
    await finished;
  } finally {
    clearInterval(timer); process.off('SIGINT', stop); process.off('SIGTERM', stop); dashboard.close();
  }
}
