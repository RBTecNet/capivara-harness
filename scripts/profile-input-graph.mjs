/** Same private verifier, same frozen plan/check; read-only resolver comparison without product commands. */
import { mkdtemp, readFile, writeFile, rm, stat, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { build } from 'esbuild';

if (!process.argv[2] || !process.argv[3] || !process.argv[4]) throw new Error('Usage: node scripts/profile-input-graph.mjs <project> <task-id> <check-id> [baseline-commit] [output.json]');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..'), projectRoot = resolve(process.argv[2]);
const taskId = process.argv[3], checkId = process.argv[4], baseline = process.argv[5] ?? '5c27692';
const output = resolve(root, process.argv[6] ?? 'docs/rc2-evidence/input-graph-comparison-runtime-recovery.json');
const hash = value => createHash('sha256').update(value).digest('hex');
const temporary = await mkdtemp(join(tmpdir(), 'capivara-input-graph-'));
const db = new DatabaseSync(join(projectRoot, '.capivara-next/project.sqlite'), { readOnly: true });
let project;
try { project = JSON.parse(db.prepare('SELECT body FROM project WHERE id=1').get().body); } finally { db.close(); }
const task = project.plan.tasks.find(task => task.id === taskId), progress = project.execution.tasks[taskId];
const check = (progress?.checks ?? task?.checks)?.find(check => check.id === checkId), workspace = progress?.verificationCheckpoint?.directory;
if (!task || !check || !workspace) throw new Error('The selected task/check needs an existing private verifier checkpoint.');
await stat(workspace);
try {
  const archived = spawnSync('git', ['show', `${baseline}:packages/core/src/execution/dependencies.ts`], { cwd: root, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
  if (archived.status !== 0) throw new Error(archived.stderr);
  const current = await readFile(join(root, 'packages/core/src/execution/dependencies.ts'), 'utf8');
  const reports = {};
  for (const [label, source] of [['before', archived.stdout], ['after', current]]) {
    const entry = join(temporary, `${label}.mjs`);
    await build({ stdin: { contents: source, resolveDir: join(root, 'packages/core/src/execution'), sourcefile: 'dependencies.ts', loader: 'ts' }, outfile: entry, bundle: true, platform: 'node', format: 'esm', packages: 'external', logLevel: 'silent' });
    const api = await import(pathToFileURL(entry).href), timing = {};
    const timed = async (name, operation) => { const began = performance.now(), result = await operation(); timing[name] = Math.round((performance.now() - began) * 100) / 100; console.log(JSON.stringify({ label, stage: name, durationMs: timing[name] })); return result; };
    const selectors = await timed('verificationInputSelectors', () => api.verificationInputSelectors(workspace, project.plan, task, check));
    const resolved = await timed('resolveInputDependencies', () => api.resolveInputDependencies(workspace, selectors));
    const filesEntry = join(temporary, `${label}-files.mjs`);
    await build({ entryPoints: [join(root, 'packages/core/src/execution/files.ts')], outfile: filesEntry, bundle: true, platform: 'node', format: 'esm', packages: 'external', logLevel: 'silent' });
    const files = await import(pathToFileURL(filesEntry).href);
    const snapshot = await timed('inputSnapshot', () => files.inputSnapshot(workspace, resolved));
    reports[label] = { resolverSourceSHA256: hash(source), selectors, resolvedEntries: resolved.length, resolvedSetSHA256: hash(JSON.stringify(resolved)), snapshotEntries: Object.keys(snapshot).length, inputSnapshotSHA256: hash(JSON.stringify(snapshot)), timings: timing };
  }
  const report = { schema: 'capivara/input-graph-comparison/1', capturedAt: new Date().toISOString(), baselineResolverCommit: baseline, taskId, checkId, workspace, commandNotExecuted: true, projectModified: false, before: reports.before, after: reports.after, equalResolvedSet: reports.before.resolvedSetSHA256 === reports.after.resolvedSetSHA256, equalContentSnapshot: reports.before.inputSnapshotSHA256 === reports.after.inputSnapshotSHA256, limits: ['Comparison changes only resolver implementation; both use the same current file inventory/hash helper and the same captured plan/check.', 'The resolver memoization is confined to each invocation; no cross-proof or cross-restart cache is used.', 'Concurrent live verification can influence elapsed time; the content and resolved-set hashes must still match.'] };
  await mkdir(dirname(output), { recursive: true }); await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
  if (!report.equalResolvedSet || !report.equalContentSnapshot) throw new Error(`Read sets or file bytes changed during the comparison; inspect ${output}`);
  console.log(JSON.stringify({ output, equalResolvedSet: true, equalContentSnapshot: true, beforeMs: report.before.timings.resolveInputDependencies, afterMs: report.after.timings.resolveInputDependencies }));
} finally { await rm(temporary, { recursive: true, force: true }); }
