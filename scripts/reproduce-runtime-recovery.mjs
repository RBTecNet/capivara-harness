/** Same public API fixtures against archived RC2 source and the current source. No model calls or installs. */
import { mkdtemp, mkdir, readFile, writeFile, rm, symlink, cp, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, resolve, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { build } from 'esbuild';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const baseline = process.argv[2] ?? '0f193a3';
const output = resolve(root, process.argv[3] ?? 'docs/rc2-evidence/runtime-recovery-before-after.json');
const temporary = await mkdtemp(join(tmpdir(), 'capivara-runtime-recovery-comparison-'));
const complete = (text = '') => ({ status: 'complete', text, commands: [], changedFiles: [] });
const request = 'Create a CLI that prints alpha.';
function fixture(api) {
  const brief = { schema: 'capivara/product/1', status: 'ready', id: api.identity('product', request), revision: 1, name: 'Alpha', summary: 'Alpha', request, modes: ['cli'], targets: [], constraints: [], gaps: [], decisions: [], requirements: [{ id: 'alpha', statement: request, mode: 'cli', source: { kind: 'request', reference: 'request', text: request } }] };
  const task = { id: 'alpha', title: 'alpha', goal: 'Print alpha', instructions: 'Use alpha.mjs', requirementIds: ['alpha'], dependsOn: [], environmentIds: [], contractIds: [], files: ['alpha.mjs'], criteria: ['Print alpha'], checks: [{ id: 'alpha-cli', kind: 'cli', command: process.execPath, args: ['alpha.mjs'], expected: 'contains:alpha', requirementIds: ['alpha'], requiredCapabilities: [] }], blockedBy: [], risk: 'normal' };
  const plan = { schema: 'capivara/plan/1', status: 'ready', revision: 1, briefId: brief.id, briefRevision: 1, environment: [], contracts: [], tasks: [task] };
  return { brief, plan };
}
async function sourceDigest(path) {
  const entries = [];
  const visit = async directory => { for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) { const file = join(directory, entry.name); if (entry.isDirectory()) await visit(file); else if (entry.isFile()) entries.push([relative(path, file), createHash('sha256').update(await readFile(file)).digest('hex')]); } };
  await visit(path); return createHash('sha256').update(JSON.stringify(entries)).digest('hex');
}
async function compare(label, source) {
  const entry = join(source, 'packages/core/src/index.ts'), module = join(source, 'comparison.mjs');
  await build({ entryPoints: [entry], outfile: module, bundle: true, platform: 'node', format: 'esm', packages: 'external', target: 'node24', logLevel: 'silent' });
  const api = await import(pathToFileURL(module).href);
  const working = async name => { const directory = join(temporary, `${label}-${name}`); await mkdir(directory); return directory; };
  const envRoot = await working('invocation'), { brief } = fixture(api);
  const environment = { id: 'runtime', name: 'Node.js', kind: 'runtime', identity: { capability: 'runtime', kind: 'runtime', provider: 'installed-provider' }, dependsOn: [], targets: [], reason: 'Run JavaScript', check: { command: 'node', args: ['--version'] }, prepare: [], provides: { command: ['node', 'npm'] } };
  const preparation = await api.prepareEnvironmentNode(envRoot, environment, brief, api.executeCommand);
  const binding = preparation.operational.bindings.runtime;
  const invocation = { ready: preparation.ready, command: binding?.command, probes: preparation.results.map(item => ({ command: item.command.replaceAll(envRoot, '$WORKSPACE'), exitCode: item.exitCode, output: `${item.stderr}\n${item.stdout}`.replaceAll(envRoot, '$WORKSPACE').trim() })), transformations: binding?.transformations ?? [], incidents: preparation.incidents.map(item => ({ kind: item.kind, message: item.message })) };
  const webRequest = 'Crie uma aplicação web.\n- Fluxos reais executados no navegador.';
  let discoveryCalls = 0;
  const webBrief = await api.runInit({ request: webRequest, agent: async () => { discoveryCalls++; return JSON.stringify({ name: 'Browser flows', summary: 'Browser flows', requirements: [{ statement: 'Fluxos reais executados no navegador.', quote: 'Fluxos reais executados no navegador.', mode: 'web', kind: 'behavior' }], questions: [] }); } });
  const browser = { request: webRequest, allowed: api.allowedCapabilities(webBrief, ['browser']), constraints: webBrief.constraints.map(item => ({ statement: item.statement, forbiddenCapabilities: item.forbiddenCapabilities })), discoveryCalls };
  const productRoot = await working('partial-source'), product = fixture(api); let editors = 0, reviews = 0;
  await writeFile(join(productRoot, 'alpha.mjs'), "console.log('alpha');\n");
  const built = await api.runBuild({ workspace: productRoot, ...product, signal: AbortSignal.timeout(5000), agent: async call => { if (call.role === 'reviewer') { reviews++; return complete('{"approved":true,"findings":[]}'); } editors++; return complete(); } });
  const partialSource = { status: built.status, editorCalls: editors, reviewerCalls: reviews, passedProofs: built.state.evidence.filter(item => item.passed).length, sourcePreserved: await readFile(join(productRoot, 'alpha.mjs'), 'utf8') === "console.log('alpha');\n" };
  const ledgerRoot = await working('waiting-ledger'), ledgerFixture = fixture(api);
  await writeFile(join(ledgerRoot, 'alpha.mjs'), "console.log('alpha');\n");
  const store = new api.ProjectStore(ledgerRoot);
  let suspension;
  try {
    store.update({ ...ledgerFixture, request, config: { provider: 'injected-test' } });
    const outcome = await api.runWorkflow({ workspace: ledgerRoot, stage: 'build', store, signal: AbortSignal.timeout(5000), agent: async () => complete('{"approved":false,"findings":[]}') });
    const saved = store.read();
    suspension = { status: outcome.status, lastFailure: saved.lastFailure ?? null, blockers: saved.execution?.blockers ?? [], passedProofs: saved.execution?.evidence.filter(item => item.passed).length ?? 0 };
  } finally { store.close(); }
  return { sourceSHA256: await sourceDigest(join(source, 'packages/core/src')), invocation, browser, partialSource, suspension };
}

try {
  const before = join(temporary, 'before'), after = join(temporary, 'after'); await mkdir(before); await mkdir(join(after, 'packages/core'), { recursive: true });
  const archive = spawnSync('git', ['archive', baseline, 'packages/core/src', 'packages/core/package.json', 'package.json'], { cwd: root, maxBuffer: 32 * 1024 * 1024 });
  if (archive.status !== 0) throw new Error(String(archive.stderr));
  const extract = spawnSync('tar', ['-x', '-C', before], { input: archive.stdout }); if (extract.status !== 0) throw new Error(String(extract.stderr));
  await cp(join(root, 'packages/core/src'), join(after, 'packages/core/src'), { recursive: true });
  await cp(join(root, 'packages/core/package.json'), join(after, 'packages/core/package.json'));
  await cp(join(root, 'package.json'), join(after, 'package.json'));
  for (const directory of [before, after]) await symlink(join(root, 'node_modules'), join(directory, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
  const report = { schema: 'capivara/runtime-recovery-comparison/1', generatedAt: new Date().toISOString(), baselineCommit: spawnSync('git', ['rev-parse', baseline], { cwd: root, encoding: 'utf8' }).stdout.trim(), host: { platform: process.platform, node: process.version }, paidInferenceCalls: 0, packageInstalls: 0, before: await compare('before', before), after: await compare('after', after) };
  const { before: old, after: current } = report;
  if (old.invocation.ready || !current.invocation.ready || old.browser.allowed || !current.browser.allowed || old.partialSource.editorCalls !== 1 || current.partialSource.editorCalls !== 0 || old.suspension.lastFailure !== null || !current.suspension.lastFailure?.message) throw new Error(`Unexpected comparison; evidence follows:\n${JSON.stringify(report, null, 2)}`);
  await mkdir(dirname(output), { recursive: true }); await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ output, baseline: report.baselineCommit, invocationReady: [old.invocation.ready, current.invocation.ready], browserAllowed: [old.browser.allowed, current.browser.allowed], editorCallsForExistingSource: [old.partialSource.editorCalls, current.partialSource.editorCalls], waitingHasCause: [Boolean(old.suspension.lastFailure), Boolean(current.suspension.lastFailure)], paidInferenceCalls: 0 }));
} finally { await rm(temporary, { recursive: true, force: true }); }
