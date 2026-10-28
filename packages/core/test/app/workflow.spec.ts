import { afterEach, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runWorkflow } from '../../src/app/workflow.js';
import { ProjectStore } from '../../src/app/store.js';
import type { Requirement } from '../../src/domain/types.js';
import type { AgentRequest, AgentResult } from '../../src/runtime/types.js';
import type { BuildState } from '../../src/execution/types.js';

const temporary: string[] = [];
afterEach(async () => { await Promise.all(temporary.splice(0).map(path => rm(path, { recursive: true, force: true }))); });
const complete = (value: unknown): AgentResult => ({ status: 'complete', text: typeof value === 'string' ? value : JSON.stringify(value), commands: [], changedFiles: [] });

it('constrói um novo pedido no mesmo workspace quando ambos os briefs têm revisão 1', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'capivara-workflow-'));
  temporary.push(workspace);
  const edits: string[] = [];
  const plans: string[] = [];
  const agent = async (call: AgentRequest): Promise<AgentResult> => {
    if (call.role === 'analyst') return complete({ name: 'Greeting', summary: 'CLI de saudação', requirements: [], questions: [] });
    if (call.role === 'planner' && call.instruction.startsWith('Plan executable technical prerequisites')) return complete({ environment: [{ id: 'node', name: 'Node.js', kind: 'runtime', dependsOn: [], targets: [], reason: 'Executar a CLI solicitada', check: { command: process.execPath, args: ['--version'] }, prepare: [] }] });
    if (call.role === 'planner') {
      const requirements = JSON.parse(call.instruction.split('Requirements of this slice:\n')[1]?.split('\n\n')[0] ?? '[]') as Requirement[];
      const greeting = requirements.some(requirement => requirement.source.text.includes('beta')) ? 'beta' : 'alpha';
      plans.push(greeting);
      return complete({ tasks: [{ id: 'greet', title: `Saudação ${greeting}`, goal: `Imprimir ${greeting} ao receber --greet`, instructions: 'Implementar a CLI em cli.mjs', requirementIds: requirements.map(requirement => requirement.id), dependsOn: [], environmentIds: ['node'], contractIds: [], files: ['cli.mjs'], criteria: [`--greet imprime ${greeting}`], checks: [{ id: 'greeting', kind: 'cli', command: process.execPath, args: ['cli.mjs', '--greet'], expected: `contains:${greeting}`, expectedExitCode: 0, requirementIds: requirements.map(requirement => requirement.id), requiredCapabilities: [] }] }] });
    }
    if (call.role === 'editor') {
      const greeting = call.context?.includes('beta') ? 'beta' : 'alpha';
      edits.push(greeting);
      await writeFile(join(workspace, 'cli.mjs'), `if (process.argv.includes('--greet')) console.log('${greeting}'); else process.exitCode = 2;\n`);
      return { ...complete('Implementado.'), changedFiles: ['cli.mjs'] };
    }
    if (call.role === 'reviewer') return complete({ approved: true, findings: [] });
    return complete({ approved: false, findings: ['Unexpected operation in this deterministic scenario.'] });
  };
  const options = { workspace, stage: 'run' as const, config: { provider: 'injected-test' }, signal: AbortSignal.timeout(8_000), agent };
  const first = await runWorkflow({ ...options, request: 'Crie uma CLI Node.js em cli.mjs que imprima alpha ao receber --greet.' });
  expect(first.status).toBe('complete');
  expect((await promisify(execFile)(process.execPath, ['cli.mjs', '--greet'], { cwd: workspace })).stdout.trim()).toBe('alpha');

  const second = await runWorkflow({ ...options, request: 'Crie uma CLI Node.js em cli.mjs que imprima beta ao receber --greet.' });
  expect(second.status).toBe('complete');
  expect(first.brief?.revision).toBe(1);
  expect(second.brief?.revision).toBe(1);
  expect(second.brief?.id).not.toBe(first.brief?.id);
  expect(second.plan?.briefId).toBe(second.brief?.id);
  expect(plans).toEqual(['alpha', 'beta']);
  expect(edits).toEqual(['alpha', 'beta']);
  expect((await promisify(execFile)(process.execPath, ['cli.mjs', '--greet'], { cwd: workspace })).stdout.trim()).toBe('beta');
  expect(await readFile(join(workspace, 'cli.mjs'), 'utf8')).toContain("console.log('beta')");
  const store = new ProjectStore(workspace);
  try {
    const execution = store.read().execution as BuildState;
    expect(store.read().status).toBe('complete');
    expect(execution.evidence.some(evidence => evidence.passed && evidence.output.includes('beta'))).toBe(true);
  } finally { store.close(); }
}, 10_000);
