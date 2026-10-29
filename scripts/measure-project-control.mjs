/** Read-only control-plane measurements; never publishes requests or transcripts. */
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const [beforePath, afterPath, outputPath] = process.argv.slice(2);
if (!beforePath || !afterPath || !outputPath) throw new Error('Usage: node scripts/measure-project-control.mjs BEFORE.sqlite AFTER.sqlite OUTPUT.json');
async function measure(path) {
  const database = resolve(path), db = new DatabaseSync(database, { readOnly: true });
  let project, events;
  try {
    db.exec('BEGIN');
    project = JSON.parse(db.prepare('SELECT body FROM project WHERE id=1').get().body);
    events = db.prepare('SELECT id,at,type,body FROM events ORDER BY id').all().map(row => ({ ...row, event: JSON.parse(row.body) }));
    db.exec('ROLLBACK');
  } finally { db.close(); }
  const starts = new Map(events.filter(row => row.type === 'agent.start').map(row => [row.event.detail?.id, row]));
  const calls = events.filter(row => row.type === 'agent.result').map(row => {
    const start = starts.get(row.event.detail?.id);
    return { eventId: row.id, role: row.event.detail?.role, status: row.event.detail?.status,
      durationMs: start ? Date.parse(row.at) - Date.parse(start.at) : null };
  });
  const roles = {};
  for (const call of calls) {
    const entry = roles[call.role] ??= { calls: 0, durationMs: 0 };
    entry.calls++; entry.durationMs += call.durationMs ?? 0;
  }
  const covered = new Set(project.plan?.tasks.flatMap(task => task.requirementIds) ?? []);
  return { databaseSHA256: createHash('sha256').update(await readFile(database)).digest('hex'),
    status: project.status, stage: project.stage, lastFailureKind: project.lastFailure?.kind ?? null,
    events: events.length, lastEventId: events.at(-1)?.id ?? null,
    domainCalls: Object.values(project.domainCalls ?? {}).length, roles, calls,
    requirements: project.brief?.requirements.length ?? 0,
    uncoveredRequirementIds: project.brief?.requirements.filter(requirement => !covered.has(requirement.id)).map(requirement => requirement.id) ?? [],
    interview: { gaps: project.brief?.gaps.length ?? 0, answered: project.brief?.decisions.length ?? 0, pending: !!project.pendingQuestion },
    plan: { status: project.plan?.status, tasks: project.plan?.tasks.length ?? 0,
      obligations: (project.plan?.obligations ?? []).map(item => ({ requirementId: item.requirementId,
        kind: item.kind, recipeStatus: item.recipeStatus,
        recipes: item.recipes?.map(recipe => ({ taskId: recipe.taskId, checkId: recipe.checkId })),
        verification: item.verification })) },
    execution: { present: !!project.execution, completed: Object.values(project.execution?.tasks ?? {}).filter(task => task.status === 'complete').length,
      proofs: project.execution?.evidence?.length ?? 0 } };
}
const before = await measure(beforePath), after = await measure(afterPath);
const result = { schema: 'capivara/control-measurement/1', generatedAt: new Date().toISOString(), before, after,
  delta: { domainCalls: after.domainCalls - before.domainCalls,
    calls: after.calls.filter(call => call.eventId > (before.lastEventId ?? 0)) },
  limits: ['A ready plan is not product acceptance.', 'Agent wall time is not financial cost.', 'Database hashes cover the named database file, not uncheckpointed WAL contents.'] };
const output = resolve(outputPath); await mkdir(dirname(output), { recursive: true });
await writeFile(output, JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ output, status: after.status, stage: after.stage, plan: after.plan.status, newDomainCalls: result.delta.domainCalls, execution: after.execution }));
