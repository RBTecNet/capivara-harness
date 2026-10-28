import { afterEach, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runWorkflow } from '../../src/app/workflow.js';
import { ProjectStore } from '../../src/app/store.js';
import type { AgentResult } from '../../src/runtime/types.js';

const temporary: string[] = [];
afterEach(async () => { await Promise.all(temporary.splice(0).map(path => rm(path, { recursive: true, force: true }))); });
const request = 'Create a CLI that prints alpha.';
const completed: AgentResult = {
  status: 'complete', commands: [], changedFiles: [],
  text: JSON.stringify({ name: 'Alpha', summary: request, modes: ['cli'], targets: ['linux'], requirements: [{ statement: request, quote: request, mode: 'cli' }], questions: [] }),
};
const cancelled: AgentResult = { status: 'cancelled', text: '', commands: [], changedFiles: [] };
async function workspace(): Promise<string> { const path = await mkdtemp(join(tmpdir(), 'capivara-domain-invocation-')); temporary.push(path); return path; }
const options = (path: string) => ({ workspace: path, stage: 'init' as const, request, config: { provider: 'injected-test' }, signal: AbortSignal.timeout(3000) });

it.each(['cancelled', 'exception'] as const)('resumes an interrupted domain invocation after %s without freezing or reusing its attempt identity', async interruption => {
  const path = await workspace(); let calls = 0; const identities: (string | undefined)[] = [];
  const agent = async (call: Parameters<NonNullable<Parameters<typeof runWorkflow>[0]['agent']>>[0]): Promise<AgentResult> => {
    calls++; identities.push(call.operationKey);
    if (calls === 1) { if (interruption === 'exception') throw new Error('Worker disappeared before returning an answer.'); return cancelled; }
    return completed;
  };
  expect((await runWorkflow({ ...options(path), agent })).status).toBe(interruption === 'cancelled' ? 'cancelled' : 'waiting');
  const firstStore = new ProjectStore(path);
  try {
    const call = Object.values(firstStore.read().domainCalls ?? {})[0]!;
    expect(call.status).toBe('interrupted'); expect(call.invocationId).toBeTruthy();
  } finally { firstStore.close(); }
  expect((await runWorkflow({ ...options(path), agent })).status).toBe('complete');
  expect(calls).toBe(2); expect(identities[0]).not.toBe(identities[1]);
  const finalStore = new ProjectStore(path);
  try { expect(Object.values(finalStore.read().domainCalls ?? {}).map(call => call.status)).toEqual(['complete']); }
  finally { finalStore.close(); }
});

it('adopts a recorded usable answer after a crash between transcript publication and domain completion without invoking a model', async () => {
  const path = await workspace();
  await runWorkflow({ ...options(path), agent: async () => cancelled });
  const store = new ProjectStore(path); let invocationId: string;
  try {
    const calls = store.read().domainCalls!; const record = Object.values(calls)[0]!; invocationId = record.invocationId!;
    expect(invocationId).toBeTruthy();
    // Reproduce the durable boundary of a process death: result exists, promotion did not commit.
    await writeFile(join(store.directory, 'calls', `${invocationId}.result.json`), JSON.stringify(completed));
    record.status = 'running'; delete record.failure;
    store.update({ status: 'working', domainCalls: calls });
  } finally { store.close(); }
  let modelCalls = 0;
  expect((await runWorkflow({ ...options(path), agent: async () => { modelCalls++; throw new Error('Completed inference must not replay.'); } })).status).toBe('complete');
  expect(modelCalls).toBe(0);
  const finalStore = new ProjectStore(path);
  try {
    expect(Object.values(finalStore.read().domainCalls ?? {})[0]).toMatchObject({ status: 'complete', invocationId, result: completed.text });
    expect(finalStore.recent(20).some(row => String((row as { body: string }).body).includes('invocation-transcript'))).toBe(true);
    expect(JSON.parse(await readFile(join(finalStore.directory, 'calls', `${invocationId}.result.json`), 'utf8'))).toEqual(completed);
  } finally { finalStore.close(); }
});

it('preserves complete cached domain answers that predate invocation correlation', async () => {
  const path = await workspace();
  await runWorkflow({ ...options(path), agent: async () => cancelled });
  const store = new ProjectStore(path);
  try {
    const calls = store.read().domainCalls!; const [key, old] = Object.entries(calls)[0]!;
    calls[key] = { operation: old.operation, status: 'complete', at: old.at, result: completed.text };
    store.update({ domainCalls: calls });
  } finally { store.close(); }
  let calls = 0;
  expect((await runWorkflow({ ...options(path), agent: async () => { calls++; return completed; } })).status).toBe('complete');
  expect(calls).toBe(0);
});

it('does not adopt a recorded resource failure as a successful answer', async () => {
  const path = await workspace();
  await runWorkflow({ ...options(path), agent: async () => cancelled });
  const store = new ProjectStore(path);
  try {
    const calls = store.read().domainCalls!; const record = Object.values(calls)[0]!;
    await writeFile(join(store.directory, 'calls', `${record.invocationId}.result.json`), JSON.stringify({ ...completed, issue: { kind: 'authentication', message: 'Credential missing.', recoverable: true } }));
    record.status = 'running'; store.update({ domainCalls: calls });
  } finally { store.close(); }
  let calls = 0;
  const agent = async (): Promise<AgentResult> => { calls++; return completed; };
  expect((await runWorkflow({ ...options(path), agent })).status).toBe('waiting');
  expect(calls).toBe(0);
  const failedStore = new ProjectStore(path);
  try { expect(Object.values(failedStore.read().domainCalls ?? {})[0]).toMatchObject({ status: 'failed', failure: 'Credential missing.' }); }
  finally { failedStore.close(); }
  expect((await runWorkflow({ ...options(path), retrySuspended: true, agent })).status).toBe('complete');
  expect(calls).toBe(1);
});
