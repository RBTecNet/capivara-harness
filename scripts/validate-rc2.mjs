/** Deterministic engine pilots: real files/commands/PTY, scripted agent responses, no paid inference. */
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { runBuild } from '../packages/core/dist/index.js';

const output = resolve(process.argv[2] ?? 'docs/rc2-evidence/pilots.json');
const roots = [];
const requirement = (id, statement, mode) => ({ id, statement, mode, source: { kind: 'request', reference: 'pilot-request', text: statement } });
const check = (id, kind, command, args, expected, inputs, requirementIds) => ({ id, kind, command, args, expected, inputs, requirementIds, requiredCapabilities: [], level: 'behavior' });
const task = (id, files, requirementIds, dependsOn, checks) => ({ id, title: id, goal: `Deliver ${id}`, instructions: `Implement the specified ${id} artifact in ${files.join(', ')}`, requirementIds, dependsOn, environmentIds: [], contractIds: [], files, criteria: [`${id} satisfies its original executable criterion`], checks, risk: 'normal', blockedBy: [] });
const complete = text => ({ status: 'complete', text, commands: [], changedFiles: [] });

async function pilot(name, modes, requirements, tasks, implementations, jobs, options = {}) {
  const workspace = await mkdtemp(join(tmpdir(), `capivara-rc2-${name}-`)); roots.push(workspace);
  const brief = { schema: 'capivara/product/1', id: name, revision: 1, status: 'ready', name, summary: name, request: requirements.map(item => item.statement).join('\n'), modes, targets: ['linux'], requirements, constraints: [], decisions: [], gaps: [] };
  const plan = { schema: 'capivara/plan/1', revision: 1, status: 'ready', briefId: name, briefRevision: 1, environment: options.environment ?? [], contracts: [], tasks, ...(options.acceptance ? { acceptance: options.acceptance } : {}) };
  let durable;
  const result = await runBuild({ workspace, brief, plan, maxConcurrent: jobs, signal: AbortSignal.timeout(25000), onState: async state => { durable = structuredClone(state); }, agent: async request => {
    if (request.role === 'reviewer') return complete('{"approved":true,"findings":[]}');
    const id = request.context?.match(/Work unit ([^:]+):/)?.[1];
    if (!implementations[id]) throw new Error(`Unexpected implementation ${id}`);
    // A controlled work interval makes useful overlap reproducible independently of model speed.
    await new Promise(resolve => setTimeout(resolve, 80));
    for (const [path, content] of Object.entries(implementations[id])) {
      await mkdir(join(request.workspace, path, '..'), { recursive: true });
      await writeFile(join(request.workspace, path), content);
    }
    return complete('Implemented the declared artifact.');
  } });
  await writeFile(join(workspace, '.capivara-next', 'pilot-state.json'), JSON.stringify(durable, null, 2));
  const metrics = result.state.metrics;
  const editor = metrics?.timeline.filter(item => item.stage === 'editor' || item.stage === 'repair') ?? [];
  const overlaps = editor.flatMap((left, index) => editor.slice(index + 1).filter(right => left.start < right.end && right.start < left.end).map(right => [left.taskId, right.taskId]));
  const report = { name, workspace, status: result.status, jobs, metrics, overlaps, passedProofs: result.state.evidence.filter(item => item.passed).map(item => ({ task: item.taskId, check: item.checkId, kind: item.kind, level: item.level, terminal: item.terminal, output: item.output })), incidents: result.incidents };
  if (result.status !== 'complete') throw new Error(`${name} did not complete: ${JSON.stringify(report)}`);
  return report;
}

const nodeRequirements = [requirement('r-a', 'The alpha library exports and prints 3.', 'library'), requirement('r-b', 'The beta library exports and prints 4.', 'library'), requirement('r-cli', 'The documented Node.js CLI prints the sum 7.', 'cli')];
const nodeTasks = [
  task('alpha', ['alpha.mjs'], ['r-a'], [], [check('alpha', 'cli', process.execPath, ['alpha.mjs'], 'contains:3', ['alpha.mjs'], ['r-a'])]),
  task('beta', ['beta.mjs'], ['r-b'], [], [check('beta', 'cli', process.execPath, ['beta.mjs'], 'contains:4', ['beta.mjs'], ['r-b'])]),
  task('cli', ['cli.mjs'], ['r-cli'], ['alpha', 'beta'], [check('sum', 'cli', process.execPath, ['cli.mjs'], 'contains:7', ['cli.mjs', 'alpha.mjs', 'beta.mjs'], ['r-cli'])]),
];
const nodeCode = { alpha: { 'alpha.mjs': "export const alpha=3; console.log(alpha);\n" }, beta: { 'beta.mjs': "export const beta=4; console.log(beta);\n" }, cli: { 'cli.mjs': "import {alpha} from './alpha.mjs'; import {beta} from './beta.mjs'; console.log(alpha+beta);\n" } };
const reports = [];
reports.push(await pilot('node-serial-control', ['cli', 'library'], nodeRequirements, nodeTasks, nodeCode, 1));
reports.push(await pilot('node-parallel', ['cli', 'library'], nodeRequirements, nodeTasks, nodeCode, 2));
if (!reports[1].overlaps.some(pair => pair.includes('alpha') && pair.includes('beta'))) throw new Error('Independent Node tasks did not overlap.');
if (reports[1].overlaps.some(pair => pair.includes('cli'))) throw new Error('Dependent CLI overlapped a prerequisite.');

const requiredNode = structuredClone(nodeRequirements);
requiredNode[2].binding = { capability: 'node-runtime', kind: 'runtime', provider: 'Node.js' };
const requiredTasks = structuredClone(nodeTasks); requiredTasks[2].environmentIds = ['node'];
const conforms = { ...check('node-product-usage', 'cli', process.execPath, ['cli.mjs'], 'contains:7', ['cli.mjs', 'alpha.mjs', 'beta.mjs'], ['r-cli']), conformance: { requirementId: 'r-cli', capability: 'node-runtime', kind: 'runtime', provider: 'Node.js', productInputs: ['cli.mjs', 'alpha.mjs', 'beta.mjs'] } };
reports.push(await pilot('required-node-runtime', ['cli', 'library'], requiredNode, requiredTasks, nodeCode, 2, { environment: [{ id: 'node', name: 'Node.js runtime', kind: 'runtime', dependsOn: [], targets: ['linux'], reason: 'The request requires Node.js for the actual delivered CLI.', identity: { capability: 'node-runtime', kind: 'runtime', provider: 'Node.js' }, provides: { command: [process.execPath], aliases: ['node'] }, check: { command: process.execPath, args: ['--version'] }, prepare: [], requirementIds: ['r-cli'] }], acceptance: [conforms] }));

const pyRequirements = [requirement('r-core', 'The Python library doubles an integer.', 'library'), requirement('r-python', 'The Python CLI prints 12 when passed 6.', 'cli')];
reports.push(await pilot('python-strict', ['cli', 'library'], pyRequirements, [
  task('core', ['core.py'], ['r-core'], [], [check('double', 'command', 'python3', ['-c', 'from core import double; assert double(6)==12; print("double verified")'], 'contains:double verified', ['core.py'], ['r-core'])]),
  task('entry', ['entry.py'], ['r-python'], ['core'], [check('python-cli', 'cli', 'python3', ['entry.py', '6'], 'contains:12', ['core.py', 'entry.py'], ['r-python'])]),
], { core: { 'core.py': 'def double(value):\n    return value * 2\n' }, entry: { 'entry.py': 'import sys\nfrom core import double\nprint(double(int(sys.argv[1])))\n' } }, 3));
if (reports.at(-1).overlaps.length) throw new Error('Strict Python dependencies overlapped.');

const tuiCheck = { ...check('interactive', 'tui', process.execPath, ['menu.mjs'], 'contains:SELECTED 2', ['menu.mjs'], ['r-tui']), steps: [{ waitFor: 'READY 1' }, { input: 'j', waitFor: 'SELECTED 2' }], closeInput: 'q' };
reports.push(await pilot('tui-interaction', ['tui'], [requirement('r-tui', 'A terminal menu shows READY 1; j selects 2; q exits.', 'tui')], [task('menu', ['menu.mjs'], ['r-tui'], [], [tuiCheck])], { menu: { 'menu.mjs': "process.stdin.setRawMode(true);process.stdin.resume();console.log('READY 1');process.stdin.on('data',b=>{if(b.toString()==='j')console.log('SELECTED 2');if(b.toString()==='q')process.exit(0);});\n" } }, 2));
if (!reports.at(-1).passedProofs.some(proof => proof.kind === 'tui' && proof.terminal)) throw new Error('No real PTY interaction was proven.');

await mkdir(join(output, '..'), { recursive: true });
await writeFile(output, JSON.stringify({ generatedAt: new Date().toISOString(), source: 'scripted agents with real generated products and native commands', paidInferenceCalls: 0, reports }, null, 2));
console.log(JSON.stringify({ output, results: reports.map(({ name, status, metrics, overlaps }) => ({ name, status, elapsedMs: metrics.elapsedMs, maxConcurrency: metrics.maxConcurrency, callsByRole: metrics.callsByRole, overlaps })) }, null, 2));
