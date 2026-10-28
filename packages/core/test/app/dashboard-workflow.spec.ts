import { afterEach, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runWorkflow, type WorkflowEvent } from '../../src/app/workflow.js';
import { ProjectStore, type SavedProject } from '../../src/app/store.js';
import type { Requirement } from '../../src/domain/types.js';
import type { AgentRequest, AgentResult } from '../../src/runtime/types.js';
import type { BuildState } from '../../src/execution/types.js';

const temporary: string[] = [];
afterEach(async () => { await Promise.all(temporary.splice(0).map(path => rm(path, { recursive: true, force: true }))); });
const complete = (value: unknown): AgentResult => ({ status: 'complete', text: typeof value === 'string' ? value : JSON.stringify(value), commands: [], changedFiles: [] });

it('conclui e publica progresso observado mesmo quando todos os observers do dashboard falham', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'capivara-dashboard-workflow-'));
  temporary.push(workspace);
  const events: WorkflowEvent[] = [];
  const states: SavedProject[] = [];
  let editorCalls = 0, discoveryCalls = 0;
  const agent = async (call: AgentRequest): Promise<AgentResult> => {
    call.onEvent?.({ type: 'tool', message: `Executando ${call.role}` });
    if (call.role === 'analyst') {
      if (++discoveryCalls === 1) return complete('Resposta sem JSON; deve recuperar a estrutura.');
      return complete({ name: 'Saudação', summary: 'CLI de saudação', requirements: [], questions: [{ fact: 'texto da saudação', question: 'Qual saudação o comando deve imprimir?', reason: 'O pedido não informa o texto.', impact: 'Define a saída observável do comando.', category: 'behavior', modes: ['cli'], options: ['hello', 'olá'], blocks: [] }] });
    }
    if (call.role === 'planner' && call.instruction.startsWith('Plan executable technical prerequisites')) return complete({ environment: [{ id: 'node', name: 'Node.js', kind: 'runtime', dependsOn: [], targets: [], reason: 'Executar a CLI', check: { command: process.execPath, args: ['--version'] }, prepare: [] }] });
    if (call.role === 'planner') {
      const requirements = JSON.parse(call.instruction.split('Requirements of this slice:\n')[1]?.split('\n\n')[0] ?? '[]') as Requirement[];
      return complete({ tasks: [{ id: 'greet', title: 'Saudação', goal: 'Imprimir hello com --greet', instructions: 'Criar cli.mjs para a saudação escolhida.', requirementIds: requirements.map(requirement => requirement.id), dependsOn: [], environmentIds: ['node'], contractIds: [], files: ['cli.mjs'], criteria: ['--greet imprime hello.'], checks: [{ id: 'greeting', kind: 'cli', command: process.execPath, args: ['cli.mjs', '--greet'], expected: 'contains:hello', requirementIds: requirements.map(requirement => requirement.id), requiredCapabilities: [] }] }] });
    }
    if (call.role === 'editor') {
      editorCalls += 1;
      await writeFile(join(workspace, 'cli.mjs'), "if (process.argv.includes('--greet')) console.log('hello'); else process.exitCode = 2;\n");
      return { ...complete('Implementado.'), changedFiles: ['cli.mjs'] };
    }
    if (call.role === 'reviewer') return complete({ approved: true, findings: [] });
    throw new Error(`Operação inesperada: ${call.role}`);
  };
  const outcome = await runWorkflow({
    workspace, stage: 'run', request: 'Crie uma CLI Node.js em cli.mjs que imprima uma saudação ao receber --greet.', config: { provider: 'injected-test' }, signal: AbortSignal.timeout(8_000), agent,
    ask: async () => '1',
    onEvent: event => { events.push(structuredClone(event)); throw new Error('A interface de eventos falhou.'); },
    onState: state => { states.push(structuredClone(state)); throw new Error('A interface de estado falhou.'); },
    announce: () => { throw new Error('A interface de mensagens falhou.'); },
  });

  expect(outcome.status).toBe('complete');
  expect(editorCalls).toBe(1);
  expect(outcome.brief?.decisions.some(decision => decision.answer === 'hello')).toBe(true);
  expect(events.some(event => event.type === 'recovering' && event.subject === 'discover')).toBe(true);
  expect(states.some(state => state.plan?.status === 'ready')).toBe(true);
  expect(states.some(state => (state.execution as BuildState | undefined)?.tasks.greet?.status === 'complete')).toBe(true);
  expect(states.some(state => state.status === 'recovering')).toBe(false);
  for (const id of ['init:sources', 'plan:environment', 'plan:outline', 'environment', 'tasks', 'verification']) {
    expect(events.some(event => event.progress?.id === id && event.progress.completed === 1 && event.progress.total === 1)).toBe(true);
  }
  expect(events.some(event => event.progress?.id === 'task:greet:stages' && event.progress.completed === 3 && event.progress.status === 'complete')).toBe(true);
  const modelProgress = events.filter(event => event.progress?.id.startsWith('agent:'));
  expect(modelProgress.length).toBeGreaterThan(0);
  expect(modelProgress.every(event => event.progress?.completed === undefined && event.progress?.total === undefined)).toBe(true);
  expect((await promisify(execFile)(process.execPath, ['cli.mjs', '--greet'], { cwd: workspace })).stdout.trim()).toBe('hello');
  expect(await readFile(join(workspace, 'cli.mjs'), 'utf8')).toContain("console.log('hello')");
  const store = new ProjectStore(workspace);
  try {
    expect(store.read().status).toBe('complete');
    expect((store.read().execution as BuildState).evidence.some(evidence => evidence.passed && evidence.checkId === 'greeting')).toBe(true);
  } finally { store.close(); }
}, 10_000);
