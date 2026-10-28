/** Real, read-only-beforehand resume check. No model is mocked or approved by this script. */
import { DatabaseSync } from 'node:sqlite';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

if (!process.argv[2]) throw Error('Usage: node scripts/verify-completed-resume.mjs <project> [report.json] [cli.js]');
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const workspace = resolve(process.argv[2]);
const output = resolve(process.argv[3] ?? 'docs/rc2-evidence/completed-resume.json');
const cli = resolve(process.argv[4] ?? join(root, 'packages/core/dist/cli.js'));
const hash = value => createHash('sha256').update(value).digest('hex');
function snapshot() {
  const db = new DatabaseSync(join(workspace, '.capivara-next/project.sqlite'), { readOnly: true });
  try {
    db.exec('BEGIN');
    const p = JSON.parse(db.prepare('SELECT body FROM project WHERE id=1').get().body);
    const eventId = db.prepare('SELECT max(id) AS id FROM events').get().id;
    const x = p.execution;
    const value = { status: p.status, stage: p.stage, updatedAt: p.updatedAt, eventId,
      planHash: hash(JSON.stringify(p.plan)), taskIds: p.plan.tasks.map(task => task.id),
      completed: p.plan.tasks.filter(task => x.tasks[task.id]?.status === 'complete').length,
      blockers: x.blockers?.length ?? 0, pendingReplans: Object.keys(x.pendingReplans ?? {}),
      evidenceRecords: x.evidence.length, acceptanceRecords: x.acceptance.length,
      evidenceIds: [...new Set(x.evidence.map(proof => proof.id))],
      acceptanceIds: [...new Set(x.acceptance.map(proof => proof.id))] };
    db.exec('COMMIT'); return value;
  } finally { db.close(); }
}
const before = snapshot();
if (before.status !== 'complete' || before.stage !== 'build' || before.completed !== before.taskIds.length)
  throw Error('The project must have completed before this resume check. No CLI was started.');
const startedAt = new Date().toISOString(), start = performance.now();
const exitCode = await new Promise((done, reject) => {
  const child = spawn(process.execPath, [cli, 'build', '--project', workspace, '--no-dashboard'], { stdio: 'inherit' });
  child.once('error', reject); child.once('exit', code => done(code));
});
const after = snapshot(), db = new DatabaseSync(join(workspace, '.capivara-next/project.sqlite'), { readOnly: true });
let calls;
try { calls = db.prepare("SELECT body FROM events WHERE id>? AND type='agent.start' ORDER BY id").all(before.eventId).map(row => JSON.parse(row.body).detail.role); }
finally { db.close(); }
const result = { schema: 'capivara/completed-resume/1', startedAt, finishedAt: new Date().toISOString(), elapsedMs: Math.round(performance.now() - start),
  command: [process.execPath, cli, 'build', '--project', workspace, '--no-dashboard'], cliSHA256: hash(await readFile(cli)), exitCode,
  before, after, unchangedPlan: before.planHash === after.planHash, modelCallsStarted: calls.length,
  callsByRole: Object.fromEntries([...new Set(calls)].map(role => [role, calls.filter(value => value === role).length])),
  newProofIds: after.evidenceIds.filter(id => !before.evidenceIds.includes(id)),
  newAcceptanceProofIds: after.acceptanceIds.filter(id => !before.acceptanceIds.includes(id)),
  limits: ['Runtime readiness probes and input hashing still run.', 'Acceptance ledger entries may reference existing proof IDs again; they do not represent a new product execution.'] };
result.passed = exitCode === 0 && after.status === 'complete' && after.completed === after.taskIds.length && !after.blockers && !after.pendingReplans.length && result.unchangedPlan && !calls.length && !result.newProofIds.length && !result.newAcceptanceProofIds.length;
await mkdir(dirname(output), { recursive: true }); await writeFile(output, `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify({ output, passed: result.passed, elapsedMs: result.elapsedMs, modelCallsStarted: calls.length, newProofs: result.newProofIds.length, newAcceptanceProofs: result.newAcceptanceProofIds.length, unchangedPlan: result.unchangedPlan }));
if (!result.passed) process.exitCode = 1;
