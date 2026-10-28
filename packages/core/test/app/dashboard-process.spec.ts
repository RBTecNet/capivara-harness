import { afterEach, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startDashboardProcess, type DashboardProcess } from '../../src/app/dashboard-process.js';
import type { Question } from '../../src/domain/types.js';

const temporary: string[] = [];
const dashboards: DashboardProcess[] = [];
afterEach(async () => {
  await Promise.all(dashboards.splice(0).map(dashboard => dashboard.close()));
  await Promise.all(temporary.splice(0).map(path => rm(path, { recursive: true, force: true })));
});

async function fixture(): Promise<{ workspace: string; entrypoint: string }> {
  const workspace = await mkdtemp(join(tmpdir(), 'capivara-dashboard-process-')); temporary.push(workspace);
  const entrypoint = join(workspace, 'dashboard.mjs');
  await writeFile(entrypoint, `
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
writeFileSync(join(process.cwd(), 'child.json'), JSON.stringify({pid:process.pid, ppid:process.ppid, argv:process.argv.slice(2), child:process.env.CAPIVARA_DASHBOARD_CHILD}));
process.on('message', message => {
  if(message.type === 'close') { process.send({type:'closed'}); process.disconnect(); return; }
  if(message.type !== 'ask') return;
  if(message.question.fact === 'busy') { const until=Date.now()+350; while(Date.now()<until) Math.sqrt(Math.random()); }
  if(message.question.fact === 'q') { process.send({type:'closed'}); process.disconnect(); return; }
  if(message.question.fact === 'error') { process.send({type:'error', message:'render failure'}); process.disconnect(); return; }
  if(message.question.fact === 'cancel') { process.send({type:'cancel'}); process.send({type:'cancel'}); return; }
  if(message.question.fact === 'hang') { process.on('SIGTERM', () => {}); writeFileSync(join(process.cwd(), 'hung'), '1'); for(;;) Math.sqrt(Math.random()); }
  process.send({type:'answer', id:message.id, value:message.question.fact});
});
setTimeout(() => process.send({type:'ready'}), 40);
`);
  return { workspace, entrypoint };
}
const question = (fact: string): Question => ({ id: 'shared-question-id', fact, question: 'Escolha', reason: 'Lacuna real', impact: 'Contrato', category: 'behavior', modes: ['cli'], options: ['sim'], blocks: [] });

it('keeps the constructor event loop progressing during CPU-heavy UI work and correlates queued answers', async () => {
  const input = await fixture(); let cancelled = 0, closed = 0, ticks = 0;
  const dashboard = startDashboardProcess({ ...input, cancel: () => { cancelled++; }, onClose: () => { closed++; } }); dashboards.push(dashboard);
  const timer = setInterval(() => { ticks++; }, 10);
  try {
    expect(dashboard.active).toBe(true);
    expect(await Promise.all([dashboard.ask(question('busy')), dashboard.ask(question('second'))])).toEqual(['busy', 'second']);
    const child = JSON.parse(await readFile(join(input.workspace, 'child.json'), 'utf8')) as { pid: number; ppid: number; argv: string[]; child: string };
    expect(child.pid).not.toBe(process.pid); expect(child.ppid).toBe(process.pid);
    expect(child.argv).toEqual(['dashboard', '--project', input.workspace]); expect(child.child).toBe('1');
    expect(ticks).toBeGreaterThanOrEqual(10);
    await dashboard.close(); expect(dashboard.active).toBe(false); expect(closed).toBe(1); expect(cancelled).toBe(0);
  } finally { clearInterval(timer); }
});

it('resolves pending questions when the UI is hidden without cancelling construction', async () => {
  const input = await fixture(); let cancelled = 0;
  const dashboard = startDashboardProcess({ ...input, cancel: () => { cancelled++; } }); dashboards.push(dashboard);
  expect(await dashboard.ask(question('q'))).toBeNull();
  expect(dashboard.active).toBe(false); expect(cancelled).toBe(0);
  expect(await dashboard.ask(question('later'))).toBeNull();
});

it('isolates UI failures and forwards only an explicit cancellation once', async () => {
  const input = await fixture(); let cancelled = 0; const errors: unknown[] = [];
  const broken = startDashboardProcess({ ...input, cancel: () => { cancelled++; }, onError: error => { errors.push(error); } }); dashboards.push(broken);
  expect(await broken.ask(question('error'))).toBeNull(); expect(errors).toHaveLength(1); expect(cancelled).toBe(0);
  let sawCancellation: () => void = () => undefined;
  const receivedCancellation = new Promise<void>(resolve => { sawCancellation = resolve; });
  const cancel = startDashboardProcess({ ...input, cancel: () => { cancelled++; sawCancellation(); } }); dashboards.push(cancel);
  const waiting = cancel.ask(question('cancel'));
  await receivedCancellation;
  expect(cancelled).toBe(1); await cancel.close(); expect(await waiting).toBeNull();
});

it('bounds shutdown even when the UI event loop cannot process IPC', async () => {
  const input = await fixture(); let cancelled = 0;
  const dashboard = startDashboardProcess({ ...input, cancel: () => { cancelled++; } }); dashboards.push(dashboard);
  const pending = dashboard.ask(question('hang'));
  const deadline = Date.now() + 2000;
  for (;;) {
    if (await readFile(join(input.workspace, 'hung'), 'utf8').catch(() => '') === '1') break;
    if (Date.now() >= deadline) throw new Error('Fixture UI did not enter its blocked event loop.');
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  const child = JSON.parse(await readFile(join(input.workspace, 'child.json'), 'utf8')) as { pid: number };
  const started = Date.now(); await dashboard.close();
  expect(Date.now() - started).toBeLessThan(1100); expect(await pending).toBeNull(); expect(cancelled).toBe(0);
  expect(() => process.kill(child.pid, 0)).toThrow();
});
