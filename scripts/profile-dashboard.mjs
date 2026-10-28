/** Compare renderers against one frozen SQLite read; never execute project code. */
import { DatabaseSync } from 'node:sqlite';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import { build } from 'esbuild';

if (!process.argv[2]) throw new Error('Usage: node scripts/profile-dashboard.mjs <project> [baseline-commit] [output.json]');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const workspace = resolve(process.argv[2]), baseline = process.argv[3] ?? '064d610';
const output = resolve(root, process.argv[4] ?? 'docs/rc2-evidence/dashboard-performance.json');
const temporary = await mkdtemp(join(tmpdir(), 'capivara-dashboard-profile-'));
const hash = value => createHash('sha256').update(value).digest('hex');
const rounded = value => Math.round(value * 1000) / 1000;
const median = values => { const sorted = [...values].sort((a, b) => a - b); return sorted.length % 2 ? sorted[(sorted.length - 1) / 2] : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2; };
const p95 = values => [...values].sort((a, b) => a - b)[Math.ceil(values.length * 0.95) - 1];
const stripAnsi = value => value.replace(/\u001b(?:\[[0-?]*[ -/]*[@-~]|\][^\u0007\u001b]*(?:\u0007|\u001b\\|$))/g, '');

try {
  const began = performance.now();
  const db = new DatabaseSync(join(workspace, '.capivara-next/project.sqlite'), { readOnly: true });
  let body, events;
  try {
    db.exec('PRAGMA query_only=ON; PRAGMA busy_timeout=5000; BEGIN');
    body = db.prepare('SELECT body FROM project WHERE id=1').get()?.body;
    if (typeof body !== 'string') throw new Error('The database has no committed project JSON.');
    events = db.prepare('SELECT id,at,type,body FROM events ORDER BY id').all();
    db.exec('COMMIT');
  } finally { db.close(); }
  const databaseReadMs = performance.now() - began;
  const directory = join(root, 'packages/core/src/dashboard');
  const archived = spawnSync('git', ['show', `${baseline}:packages/core/src/dashboard/screen.ts`], { cwd: root, encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 });
  if (archived.status !== 0) throw new Error(archived.stderr || 'Cannot read the baseline renderer.');
  const currentSource = await readFile(join(directory, 'screen.ts'), 'utf8');
  const compile = async (name, source) => {
    const path = join(temporary, `${name}.mjs`);
    await build({ stdin: { contents: source, resolveDir: directory, sourcefile: `${name}.ts`, loader: 'ts' }, outfile: path, bundle: true, platform: 'node', format: 'esm', packages: 'external', logLevel: 'silent' });
    return import(pathToFileURL(path).href);
  };
  const [modelApi, beforeApi, afterApi] = await Promise.all([
    compile('model', await readFile(join(directory, 'model.ts'), 'utf8')),
    compile('before', archived.stdout), compile('after', currentSource),
  ]);
  const hydrateStart = performance.now();
  const model = new modelApi.DashboardModel(JSON.parse(body));
  for (const event of events) model.observe(event);
  const snapshotStart = performance.now();
  const view = model.snapshot(); // Exactly one model and one snapshot for both renderers.
  const snapshotMs = performance.now() - snapshotStart;
  const navigation = { focusPanel: 'phases', scrollByPanel: {}, followPanels: { log: true, activity: true } };
  const modes = [
    ['compact', navigation],
    ['expandedLog', { ...navigation, focusPanel: 'log', expandedPanel: 'log' }],
  ];
  const comparisons = {};
  for (const [mode, navigationState] of modes) {
    const renderings = {}, measurements = {};
    for (const [name, api] of [['before', beforeApi], ['after', afterApi]]) {
      const durations = [], frames = [];
      for (let frame = 0; frame < 3; frame++) {
        const started = performance.now();
        const rendered = api.renderDashboard(view, navigationState, 120, 40, true, frame);
        durations.push(performance.now() - started);
        const plain = stripAnsi(rendered), rows = plain.split('\n');
        frames.push({ sha256: hash(plain), rows: rows.length, cells: rows.reduce((sum, line) => sum + api.dashboardWidthOf(line), 0), bounded: rows.length <= 40 && rows.every(line => api.dashboardWidthOf(line) <= 120) });
      }
      const warm = durations.slice(1);
      renderings[name] = frames;
      measurements[name] = { framesMs: durations.map(rounded), firstMs: rounded(durations[0]), warmMedianMs: rounded(median(warm)), warmP95Ms: rounded(p95(warm)) };
    }
    comparisons[mode] = {
      ...measurements,
      equalTextWithoutAnsi: renderings.before.every((frame, index) => frame.sha256 === renderings.after[index].sha256),
      equalCellCounts: renderings.before.every((frame, index) => frame.cells === renderings.after[index].cells && frame.rows === renderings.after[index].rows),
      frames: renderings.after,
    };
  }
  const report = {
    schema: 'capivara/dashboard-performance/1', capturedAt: new Date().toISOString(), baselineRendererCommit: baseline,
    projectReadOnly: true, projectCommandsExecuted: false, modelsConstructed: 1, snapshotsConstructed: 1, sameReadTransaction: true,
    node: process.version, dimensions: { columns: 120, rows: 40 }, framesPerMode: 3, warmSamplesPerMode: 2,
    source: { projectBodyChars: body.length, projectBodySHA256: hash(body), events: events.length, lastEventId: events.at(-1)?.id ?? 0, eventBodyChars: events.reduce((sum, event) => sum + event.body.length, 0) },
    renderers: { beforeSHA256: hash(archived.stdout), afterSHA256: hash(currentSource) },
    setup: { databaseReadMs: rounded(databaseReadMs), modelHydrationMs: rounded(snapshotStart - hydrateStart), snapshotMs: rounded(snapshotMs) },
    panels: view.panels.map(panel => ({ id: panel.id, sourceLines: panel.lines.length, sourceCharacters: panel.lines.reduce((sum, line) => sum + line.length, 0) })),
    comparisons,
    limits: ['Three frames provide two warm samples; p95 is their maximum, not a throughput/load-test percentile.', 'The first overlay at a new width still indexes the complete wrapped history.', 'This measures the renderer and frozen model only, not CLI/PTY process isolation or project completion.', 'Elapsed times depend on host load; no prompts, configuration, project source or raw log content are exported.'],
  };
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
  if (Object.values(comparisons).some(mode => !mode.equalTextWithoutAnsi || !mode.equalCellCounts || mode.frames.some(frame => !frame.bounded))) throw new Error(`Renderer output differs; inspect ${output}`);
  console.log(JSON.stringify({ output, events: events.length, comparisons: Object.fromEntries(Object.entries(comparisons).map(([name, result]) => [name, { beforeWarmMedianMs: result.before.warmMedianMs, afterWarmMedianMs: result.after.warmMedianMs, equalTextWithoutAnsi: result.equalTextWithoutAnsi, equalCellCounts: result.equalCellCounts }])) }));
} finally { await rm(temporary, { recursive: true, force: true }); }
