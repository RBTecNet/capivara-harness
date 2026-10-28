import { afterEach, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runWorkflow } from '../../src/app/workflow.js';
import { ProjectStore } from '../../src/app/store.js';
import type { AgentRequest, AgentResult } from '../../src/runtime/types.js';

const temporary: string[] = [];
afterEach(async () => { await Promise.all(temporary.splice(0).map(path => rm(path, { recursive: true, force: true }))); });
const completed = (value: unknown): AgentResult => ({ status: 'complete', text: JSON.stringify(value), changedFiles: [], commands: [] });

it('recovers interrupted technical metadata repair without rediscovering the product or losing its stack choices', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'capivara-init-semantic-'));
  temporary.push(workspace);
  const request = 'Crie uma aplicação TUI para registrar notas. Stack obrigatória: Python e Textual.';
  const discovery = {
    name: 'Notas', summary: 'Registrar notas no terminal.', modes: ['tui'], targets: ['linux'],
    requirements: [
      { statement: 'Registrar notas no terminal.', quote: 'registrar notas', mode: 'tui', kind: 'behavior' },
      { statement: 'Usar Python e Textual.', quote: 'Python e Textual', mode: 'shared', kind: 'stack' },
    ], constraints: [], questions: [],
  };
  const repair = { requirements: [{ index: 1, quote: 'Python e Textual', bindings: [
    { capability: 'application-runtime', kind: 'runtime', provider: 'Python' },
    { capability: 'terminal-ui', kind: 'library', provider: 'Textual' },
  ] }] };
  const calls: AgentRequest[] = [];
  let interrupted = false;
  const agent = async (call: AgentRequest): Promise<AgentResult> => {
    calls.push(call);
    if (call.role === 'analyst') return completed(discovery);
    if (!interrupted) { interrupted = true; return { status: 'cancelled', text: '', changedFiles: [], commands: [] }; }
    return completed(repair);
  };
  const options = { workspace, stage: 'init' as const, request, config: { provider: 'injected-test' }, signal: AbortSignal.timeout(5000), agent, ask: async () => { throw new Error('Technical extraction repair is not a product interview.'); } };
  expect((await runWorkflow(options)).status).toBe('cancelled');
  expect((await runWorkflow(options)).status).toBe('complete');
  expect(calls.filter(call => call.role === 'analyst')).toHaveLength(1);
  const repairs = calls.filter(call => call.role === 'planner');
  expect(repairs).toHaveLength(2);
  expect(repairs[0]!.operationKey).not.toBe(repairs[1]!.operationKey);
  const store = new ProjectStore(workspace);
  try {
    const project = store.read();
    expect(project.brief?.status).toBe('ready');
    expect(project.brief?.modes).toEqual(['tui']);
    expect(project.brief?.requirements.some(requirement => requirement.statement === discovery.requirements[0]!.statement)).toBe(true);
    expect(project.brief?.requirements.some(requirement => requirement.statement === discovery.requirements[1]!.statement)).toBe(true);
    expect(project.brief?.requirements.flatMap(requirement => requirement.binding ? [requirement.binding.provider] : []).sort()).toEqual(['Python', 'Textual']);
    expect(Object.values(project.domainCalls ?? {}).every(call => call.status === 'complete')).toBe(true);
    expect(project.execution).toBeUndefined();
  } finally { store.close(); }
  const count = calls.length;
  expect((await runWorkflow(options)).status).toBe('complete');
  expect(calls).toHaveLength(count);
});
