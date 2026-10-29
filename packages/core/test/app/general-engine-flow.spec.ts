import { afterEach, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { runWorkflow } from '../../src/app/workflow.js';
import { ProjectStore } from '../../src/app/store.js';
import { validatePlan } from '../../src/domain/reconcile.js';
import type { Requirement, Verification } from '../../src/domain/types.js';
import type { AgentRequest, AgentResult } from '../../src/runtime/types.js';
import type { BuildState } from '../../src/execution/types.js';

const temporary: string[] = [];
afterEach(async () => { await Promise.all(temporary.splice(0).map(path => rm(path, { recursive: true, force: true }))); });
const complete = (value: unknown): AgentResult => ({ status: 'complete', text: typeof value === 'string' ? value : JSON.stringify(value), commands: [], changedFiles: [] });
const compiler = resolve(import.meta.dirname, '../../../../node_modules/typescript/bin/tsc');

const scenarios = [
  { provider: 'Node.js', file: 'main.mjs', command: process.execPath, kind: 'runtime' as const, source: "console.log('healthy');\n", capability: 'javascript-execution' },
  { provider: 'Python', file: 'main.py', command: 'python3', kind: 'runtime' as const, source: "print('healthy')\n", capability: 'python-interpreter' },
  { provider: 'TypeScript', file: 'main.ts', command: compiler, kind: 'sdk' as const, source: "export {}; const message: string = 'healthy'; console.log(message);\n", capability: 'typescript-compilation' },
];

it.each(scenarios)('runs discovery, planning, implementation and task-owned proof for $provider without global proof copies', async scenario => {
  const workspace = await mkdtemp(join(tmpdir(), 'capivara-general-flow-'));
  temporary.push(workspace);
  const request = `Crie uma CLI que imprima healthy. Use ${scenario.provider}.`;
  const calls: AgentRequest[] = [];
  const agent = async (call: AgentRequest): Promise<AgentResult> => {
    calls.push(call);
    if (call.role === 'analyst') return complete({ name: 'Health', summary: 'Print healthy.', modes: ['cli'], targets: ['linux'], requirements: [
      { statement: 'Imprimir healthy na CLI.', quote: 'imprima healthy', mode: 'cli', kind: 'behavior' },
      // This role is an extraction hypothesis. The operational compiler must
      // remain an SDK and prove its actual artifact and functional execution.
      { statement: `Usar ${scenario.provider}.`, quote: scenario.provider, mode: 'shared', kind: 'stack', binding: { capability: 'initial extraction label', kind: 'runtime', provider: scenario.provider } },
    ], questions: [], constraints: [] });
    if (call.role === 'planner' && call.instruction.startsWith('Plan executable technical prerequisites')) return complete({ environment: [{
      id: 'toolchain', name: scenario.provider, kind: scenario.kind, dependsOn: [], targets: ['linux'], reason: 'Run the requested product.',
      // Small-model responses may omit redundant identity/invocation metadata.
      // The exact literal name, operational kind and executable are present.
      // A generated project configuration is not a prerequisite for finding
      // an already installed compiler. Availability recovery must not invent
      // a successful product build from this failed pre-implementation probe.
      check: { command: scenario.command, args: scenario.kind === 'sdk' ? ['--project', 'tsconfig.json', '--noEmit'] : ['--version'] }, prepare: [],
    }] });
    if (call.role === 'planner' && call.instruction.startsWith('Structure small executable')) {
      const requirements = JSON.parse(call.instruction.split('Requirements of this slice:\n')[1]!.split('\n\n')[0]!) as Requirement[];
      const stack = requirements.find(requirement => requirement.binding)!;
      const ids = requirements.map(requirement => requirement.id);
      const conformance = { requirementId: stack.id, capability: scenario.capability, kind: scenario.kind, provider: scenario.provider, productInputs: [scenario.file] };
      const functional: Verification = { id: 'functional', kind: 'cli', command: scenario.kind === 'sdk' ? process.execPath : scenario.command,
        args: [scenario.kind === 'sdk' ? 'dist/main.js' : scenario.file], level: 'behavior', expected: 'The actual product prints healthy.', assertion: { type: 'contains', value: 'healthy' },
        requirementIds: scenario.kind === 'sdk' ? ids.filter(id=>id!==stack.id) : ids,
        requiredCapabilities: [], inputs: [scenario.kind === 'sdk' ? 'dist/main.js' : scenario.file],
        ...(scenario.kind === 'sdk' ? {} : { conformance }) };
      const checks: Verification[] = scenario.kind === 'sdk' ? [{ id: 'compile', kind: 'command', command: compiler,
        args: ['--ignoreConfig', '--target', 'ES2022', '--module', 'commonjs', '--outDir', 'dist', scenario.file], level: 'build', assertion: { type: 'exit', value: 0 },
        requirementIds: [stack.id], requiredCapabilities: [], inputs: [scenario.file], conformance: { ...conformance, artifacts: ['dist/main.js'] } }, functional] : [functional];
      const acceptance=scenario.provider==='Node.js'?[{...functional,id:'duplicate-runtime',requirementIds:[stack.id]}]:[];
      return complete({ tasks: [{ id: 'product', title: 'Implement health CLI', goal: 'The CLI prints healthy.', instructions: `Implement ${scenario.file}.`,
        requirementIds: ids, environmentIds: ['toolchain'], dependsOn: [], contractIds: [], files: [scenario.file], criteria: ['The real CLI prints healthy.'], checks }], acceptance });
    }
    if (call.role === 'editor') {
      await writeFile(join(call.workspace, scenario.file), scenario.source);
      return { ...complete('Implemented.'), changedFiles: [scenario.file] };
    }
    if (call.role === 'reviewer') return complete({ approved: true, findings: [] });
    throw new Error(`An unnecessary recovery was requested: ${call.instruction.slice(0, 160)}`);
  };
  const options = { workspace, stage: 'run' as const, request, agent, ask: async () => { throw new Error('There is no product gap in this scenario.'); },
    signal: AbortSignal.timeout(14_000), config: { provider: 'injected-test' } };
  const result = await runWorkflow(options);
  const store = new ProjectStore(workspace);
  try {
    const project = store.read();
    expect({ status: result.status, failure: project.lastFailure }).toEqual({ status: 'complete', failure: null });
    expect(validatePlan(project.brief!, project.plan!)).toEqual([]);
    expect(project.plan?.acceptance?.length??0).toBe(scenario.provider==='Node.js'?1:0);
    const execution = project.execution as BuildState;
    expect(execution.evidence.some(proof => proof.taskId === 'product' && proof.checkId === 'functional' && proof.passed && proof.output.includes('healthy'))).toBe(true);
    expect(execution.evidence.some(proof => proof.taskId === '$acceptance' && proof.checkId === 'functional')).toBe(false);
    expect(execution.evidence.some(proof => proof.checkId === 'duplicate-runtime')).toBe(false);
    if(scenario.provider==='Node.js')expect(execution.metrics?.repetitions.some(item=>item.action==='reuse-verification-receipt')).toBe(true);
    if (scenario.kind === 'sdk') expect(await readFile(join(workspace, 'dist/main.js'), 'utf8')).toContain('healthy');
  } finally { store.close(); }
  const callsBeforeResume = calls.length;
  expect((await runWorkflow(options)).status).toBe('complete');
  expect(calls).toHaveLength(callsBeforeResume);
}, 15_000);

it.each(['tui', 'web'] as const)('plans a fresh %s interface with its proof on the task and without an artificial interview', async mode => {
  const workspace = await mkdtemp(join(tmpdir(), `capivara-plan-${mode}-`));
  temporary.push(workspace);
  const request = `Crie uma aplicação ${mode} para mostrar healthy. Use Node.js.`;
  const calls: AgentRequest[] = [];
  const agent = async (call: AgentRequest): Promise<AgentResult> => {
    calls.push(call);
    if (call.role === 'analyst') return complete({ name: 'Health interface', summary: request, modes: [mode], targets: mode === 'web' ? ['browser'] : ['linux'], requirements: [
      { statement: `Mostrar healthy em ${mode}.`, quote: 'mostrar healthy', mode, kind: 'interface' },
      { statement: 'Usar Node.js.', quote: 'Node.js', kind: 'stack', binding: { capability: 'runtime', kind: 'runtime', provider: 'Node.js' } },
    ], questions: [] });
    if (call.role === 'planner' && call.instruction.startsWith('Plan executable technical prerequisites')) return complete({ environment: [{ id: 'runtime', name: 'Node.js', kind: 'runtime',
      check: { command: process.execPath, args: ['--version'] }, prepare: [], dependsOn: [] }] });
    if (call.role === 'planner' && call.instruction.startsWith('Structure small executable')) {
      const requirements = JSON.parse(call.instruction.split('Requirements of this slice:\n')[1]!.split('\n\n')[0]!) as Requirement[];
      const stack = requirements.find(requirement => requirement.binding)!;
      return complete({ tasks: [{ id: 'interface', title: `Implement ${mode}`, goal: `The ${mode} displays healthy.`, instructions: 'Implement the requested interaction.',
        files: ['interface.mjs'], environmentIds: ['runtime'], requirementIds: requirements.map(requirement => requirement.id), dependsOn: [], criteria: ['The requested interface displays healthy.'],
        checks: [{ id: 'interaction', kind: mode, command: mode === 'web' ? 'npm run test:e2e' : process.execPath, args: mode === 'tui' ? ['interface.mjs'] : [],
          level: 'behavior', assertion: { type: 'contains', value: 'healthy' }, requirementIds: requirements.map(requirement => requirement.id), requiredCapabilities: [], inputs: ['interface.mjs'],
          ...(mode === 'tui' ? { steps: [{ waitFor: 'healthy' }], closeInput: 'q' } : {}),
          conformance: { requirementId: stack.id, capability: 'javascript', kind: 'runtime', provider: 'Node.js', productInputs: ['interface.mjs'] } }] }], acceptance: [] });
    }
    throw new Error(`Unexpected role or repair: ${call.role} ${call.instruction.slice(0, 120)}`);
  };
  const result = await runWorkflow({ workspace, stage: 'plan', request, agent, config: { provider: 'injected-test' }, signal: AbortSignal.timeout(5000),
    ask: async () => { throw new Error('The interface and product result are already explicit.'); } });
  expect(result.status).toBe('complete');
  expect(result.brief?.modes).toContain(mode);
  expect(result.plan?.status).toBe('ready');
  expect(result.plan?.tasks[0]?.checks[0]?.kind).toBe(mode);
  expect(result.plan?.acceptance ?? []).toEqual([]);
  expect(calls.filter(call => call.role === 'analyst')).toHaveLength(1);
}, 6000);
