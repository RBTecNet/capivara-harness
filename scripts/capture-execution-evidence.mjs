/** Read-only, bounded execution metrics. Agent transcripts, commands and configuration are not exported. */
import { DatabaseSync } from 'node:sqlite';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

if (!process.argv[2]) throw new Error('Usage: node scripts/capture-execution-evidence.mjs <workspace> [output.json] [first-event-id]');
const workspace = resolve(process.argv[2]), output = resolve(process.argv[3] ?? 'docs/rc2-evidence/execution-snapshot.json');
const firstEventId = Number(process.argv[4] ?? 1);
if (!Number.isInteger(firstEventId) || firstEventId < 1) throw new Error('first-event-id must be a positive integer');
const db = new DatabaseSync(join(workspace, '.capivara-next/project.sqlite'), { readOnly: true });
let project, events, lastEventId;
try {
  db.exec('BEGIN');
  project = JSON.parse(db.prepare('SELECT body FROM project WHERE id=1').get().body);
  events = db.prepare('SELECT id,at,type,body FROM events WHERE id>=? ORDER BY id').all(firstEventId).map(row => ({ ...row, body: JSON.parse(row.body) }));
  lastEventId = db.prepare('SELECT max(id) AS id FROM events').get().id;
  db.exec('COMMIT');
} finally { db.close(); }
const add = (map, key) => { map[key] = (map[key] ?? 0) + 1; };
const secretValues = [...new Set([project.config?.apiKey, project.reviewer?.apiKey, ...Object.entries({ ...process.env, ...project.config?.environment, ...project.reviewer?.environment }).filter(([key]) => /TOKEN|SECRET|PASSWORD|API_KEY|ACCESS_KEY/i.test(key)).map(([, value]) => value)].filter(value => typeof value === 'string' && value.length >= 4))];
const short = value => {
  if (typeof value !== 'string') return value;
  let summary = value.split('\n')[0];
  for (const secret of secretValues) summary = summary.replaceAll(secret, '[REDACTED]');
  return summary.slice(0, 400);
};
const count = (values, key) => { const result = {}; for (const value of values) add(result, key(value)); return result; };
const usageSummary = values => {
  const observed = values.filter(value => value.usage), priced = observed.filter(value => typeof value.usage.costUsd === 'number');
  return { callsWithReportedUsage: observed.length, inputTokens: observed.reduce((sum, value) => sum + (value.usage.inputTokens ?? 0), 0), cachedInputTokens: observed.reduce((sum, value) => sum + (value.usage.cachedInputTokens ?? 0), 0), outputTokens: observed.reduce((sum, value) => sum + (value.usage.outputTokens ?? 0), 0), callsWithReportedCost: priced.length, reportedCostUsd: priced.length ? priced.reduce((sum, value) => sum + value.usage.costUsd, 0) : null };
};
const execution = project.execution ?? {}, currentTaskIds = new Set(project.plan?.tasks.map(task => task.id) ?? []);
const taskRecords = Object.entries(execution.tasks ?? {}).filter(([id]) => !id.startsWith('$')).map(([id, task]) => ({ id, status: task.status, attempts: task.attempts, strategy: task.strategy, phase: task.checkpoint?.phase }));
const tasks = taskRecords.filter(task => currentTaskIds.has(task.id)), retiredTaskRecords = taskRecords.filter(task => !currentTaskIds.has(task.id));
const actions = Object.entries(execution.tasks ?? {}).flatMap(([taskId, task]) => (task.actions ?? []).map(action => ({ taskId, ...action })));
const completed = new Map(events.filter(event => event.type === 'agent.result').map(event => [event.body.detail?.id, event]));
const stages = new Map(events.filter(event => event.type === 'progress' && event.body.progress?.id?.startsWith('agent:')).map(event => [event.body.progress.id.slice(6), event.body.progress.stage]));
const calls = events.filter(event => event.type === 'agent.start').map(event => {
  const { id, role, provider, model } = event.body.detail, result = completed.get(id);
  const candidates = actions.filter(action => action.action === role && Date.parse(action.at) <= Date.parse(event.at) && Date.parse(event.at) - Date.parse(action.at) < 5000).sort((left, right) => Date.parse(right.at) - Date.parse(left.at));
  const action = candidates[0], strategy = action?.strategy;
  const phase = role === 'planner' ? 'planning' : role === 'analyst' ? 'understanding' : strategy?.startsWith('environment') ? 'environment-recovery' : strategy?.startsWith('assertion-contract') ? 'assertion-recovery' : strategy?.startsWith('instrument') ? 'verification-recipe-recovery' : role === 'reviewer' ? 'review' : 'implementation';
  const usage = result?.body.detail?.usage;
  return { eventId: event.id, id, role, provider, model, recordedStage: stages.get(id), phase, ...(action ? { taskId: action.taskId, strategy } : {}), startedAt: event.at, ...(result ? { resultEventId: result.id, finishedAt: result.at, durationMs: Date.parse(result.at) - Date.parse(event.at), status: result.body.detail.status } : { status: 'no-result-recorded-at-capture' }), ...(usage ? { usage: Object.fromEntries(['inputTokens', 'outputTokens', 'cachedInputTokens', 'costUsd'].filter(key => typeof usage[key] === 'number').map(key => [key, usage[key]])) } : {}) };
});
const phaseSummary = {};
for (const call of calls) {
  const phase = phaseSummary[call.phase] ??= { starts: 0, finished: 0, measuredAgentMs: 0, callsByRole: {} };
  phase.starts++; if (call.finishedAt) phase.finished++; phase.measuredAgentMs += call.durationMs ?? 0; add(phase.callsByRole, call.role);
}
for (const [name, phase] of Object.entries(phaseSummary)) phase.reportedUsage = usageSummary(calls.filter(call => call.phase === name));
const epochs = [];
let beginning = firstEventId;
const ends = events.filter(event => event.type === 'waiting' && !event.body.subject);
for (const ending of [...ends, { id: lastEventId + 1, at: project.updatedAt, terminal: true }]) {
  const started = calls.filter(call => call.eventId >= beginning && call.eventId < ending.id);
  const interval = events.filter(event => event.id >= beginning && event.id <= ending.id);
  if (!interval.length && !started.length) continue;
  epochs.push({ firstEventId: beginning, lastEventId: Math.min(ending.id, lastEventId), firstObservedAt: interval[0]?.at, lastObservedAt: interval.at(-1)?.at, ending: ending.terminal ? 'point-in-time-capture' : 'workflow-waiting-event', calls: started.length, callsByRole: count(started, call => call.role), reportedUsage: usageSummary(started), integratedTasksInInterval: [...new Set(interval.filter(event => event.type === 'transition' && event.body.detail?.after === 'complete').map(event => event.body.subject))], ...(ending.terminal ? {} : { blockingMessage: short(ending.body.message) }) });
  beginning = ending.id + 1;
}
const evidence = execution.evidence ?? [], acceptance = execution.acceptance ?? [];
const report = { schema: 'capivara/execution-evidence/1', capturedAt: new Date().toISOString(), project: project.brief?.name, projectUpdatedAt: project.updatedAt, status: project.status, stage: project.stage, eventRange: { firstInclusive: firstEventId, lastInclusive: lastEventId, captured: events.length }, completedProductTasks: tasks.filter(task => task.status === 'complete').length, totalProductTasks: project.plan?.tasks.length ?? tasks.length, tasks, retiredTaskRecords, lastFailure: project.lastFailure ? { kind: project.lastFailure.kind, message: short(project.lastFailure.message), fingerprint: project.lastFailure.fingerprint, at: project.lastFailure.at } : null, proofRecords: { total: evidence.length, passedHistorical: evidence.filter(item => item.passed).length, failedHistorical: evidence.filter(item => !item.passed).length, byTask: count(evidence, item => item.taskId), acceptanceTotal: acceptance.length, acceptancePassedHistorical: acceptance.filter(item => item.passed).length, caution: 'Historical records are counts, not a claim of current valid coverage or completed acceptance.' }, incidentsByKind: count(execution.incidents ?? [], item => item.kind), cumulativePersistedMetrics: { workflow: project.workflowMetrics, build: execution.metrics ? { startedAt: execution.metrics.startedAt, elapsedMs: execution.metrics.elapsedMs, maxConcurrency: execution.metrics.maxConcurrency, active: execution.metrics.active, callsByRole: execution.metrics.callsByRole, timeByStageMs: execution.metrics.timeByStageMs, invalidations: execution.metrics.invalidations?.length, repetitions: execution.metrics.repetitions?.length } : null }, observedCalls: { starts: calls.length, finished: calls.filter(call => call.finishedAt).length, callsByRole: count(calls, call => call.role), callsByRecordedStage: count(calls, call => call.recordedStage ?? 'unknown'), phases: phaseSummary, reportedUsage: usageSummary(calls), epochs, calls }, limits: ['Point-in-time read transaction; execution can progress after capture.', 'Persisted active counts do not establish OS process liveness.', 'No agent stdout, commands, input prompts, credentials or configuration exported.', 'Phase attribution uses role and the nearest persisted action within five seconds, when one exists.', 'Epochs end at recorded workflow waiting events; they do not infer unrecorded process stops or manual debugging duration.', 'Agent duration includes provider work and transport; financial cost is absent unless the provider reports it.'] };
await mkdir(dirname(output), { recursive: true }); await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ output, capturedAt: report.capturedAt, status: report.status, stage: report.stage, productTasks: `${report.completedProductTasks}/${report.totalProductTasks}`, eventRange: report.eventRange, calls: report.observedCalls.callsByRole, phases: phaseSummary }));
