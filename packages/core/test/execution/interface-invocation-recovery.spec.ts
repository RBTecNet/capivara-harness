import { expect, it } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DevelopmentPlan, ProductBrief, Verification, WorkUnit } from '../../src/domain/types.js';
import { runVerification } from '../../src/execution/checks.js';
import { candidateFromRecordedInterfaceProof, interfaceInvocationKey } from '../../src/execution/verification-interface-recovery.js';
import { executeCommand } from '../../src/runtime/command.js';

it('rejects renamed invocations persistently and borrows a related observed recipe only as a candidate requiring fresh execution', async () => {
  const project = await mkdtemp(join(tmpdir(), 'capivara-interface-recovery-'));
  const peer = join(project, 'peer'), workspace = join(project, 'target');
  try {
    await mkdir(peer); await mkdir(workspace);
    const rejected = new Set<string>();
    const identity = { requiredKind: 'web' as const, sourceStamp: 'current-read-write-hashes', request: { command: ['npm', 'run', 'test'], cwd: peer, environment: { MODE: 'verification', PATH: `${peer}/bin:/usr/bin` } }, workspace: peer };
    rejected.add(interfaceInvocationKey(identity));
    const renamedRecipe: Verification = { id: 'a-brand-new-label', kind: 'web', command: 'npm', args: ['run', 'test'], assertion: { type: 'exit', value: 0 }, requirementIds: ['web'], requiredCapabilities: [] };
    expect(rejected.has(interfaceInvocationKey({ ...identity, request: { ...identity.request, command: [renamedRecipe.command!, ...renamedRecipe.args!] } }))).toBe(true);
    expect(interfaceInvocationKey({ ...identity, workspace, request: { ...identity.request, cwd: workspace, environment: { PATH: `${workspace}/bin:/usr/bin`, MODE: 'verification' } } })).toBe(interfaceInvocationKey(identity));
    expect(rejected.has(interfaceInvocationKey({ ...identity, sourceStamp: 'repaired-real-source' }))).toBe(false);
    expect(rejected.has(interfaceInvocationKey({ ...identity, request: { ...identity.request, command: ['npm', 'run', 'actual-browser'] } }))).toBe(false);
    expect(rejected.has(interfaceInvocationKey({ ...identity, request: { ...identity.request, environment: { ...identity.request.environment, MODE: 'different-provider' } } }))).toBe(false);

    await writeFile(join(peer, 'browser.cjs'), "console.log('actual-command-only');\n");
    await writeFile(join(workspace, 'browser.cjs'), "console.log('actual-command-only');\n");
    const brief: ProductBrief = { schema: 'capivara/product/1', id: 'p', revision: 1, status: 'ready', name: 'Web', summary: 'Exercise the interface.', request: 'Create a web interface.', modes: ['web'], targets: ['browser'], requirements: [], constraints: [], decisions: [], gaps: [] };
    const recipe: Verification = { id: 'known-interface', kind: 'command', command: process.execPath, args: [join(peer, 'browser.cjs')], level: 'behavior', inputs: ['browser.cjs'], requirementIds: ['web'], requiredCapabilities: [], assertion: { type: 'contains', value: 'actual-command-only' } };
    const unit = (id: string, checks: Verification[], dependsOn: string[] = []): WorkUnit => ({ id, title: id, goal: brief.summary, instructions: 'Implement the requested interface.', requirementIds: ['web'], dependsOn, environmentIds: [], contractIds: [], files: ['browser.cjs'], criteria: ['The actual web interface responds.'], checks, risk: 'normal', blockedBy: [] });
    const target = { ...renamedRecipe, expected: 'The actual web interface responds.' };
    const predecessor = unit('automated-tests', [target]), descendant = unit('integrated-acceptance', [recipe], [predecessor.id]);
    const plan: DevelopmentPlan = { schema: 'capivara/plan/1', status: 'ready', revision: 1, briefId: brief.id, briefRevision: 1, environment: [], contracts: [], tasks: [predecessor, descendant] };
    let executions = 0;
    const execute: typeof executeCommand = async request => { executions++; return executeCommand(request); };
    const terminal = async () => { throw Error('No PTY is requested.'); };
    const original = await runVerification(peer, brief, descendant, plan, recipe, execute, terminal);
    expect(original.evidence.passed).toBe(true);
    // A recorded physical-interface fixture tests candidate selection only.
    // The fresh run below must observe the interface independently.
    const observed = structuredClone(original.evidence);
    observed.kind = 'web';
    observed.browserObservation = { schema: 'capivara/browser-interaction/1', diagnostics: [], witnesses: [
      { source: 'playwright-public-api', invocationId: 'recorded-session', pid: 100, sequence: 1, observedAt: observed.checkedAt, phase: 'launch', status: 'passed', operation: 'launch', browserId: 'browser' },
      { source: 'playwright-public-api', invocationId: 'recorded-session', pid: 100, sequence: 2, observedAt: observed.checkedAt, phase: 'navigation', status: 'passed', operation: 'goto', browserId: 'browser', contextId: 'context', pageId: 'page', url: 'http://127.0.0.1/product', contentNavigation: true },
      { source: 'playwright-public-api', invocationId: 'recorded-session', pid: 100, sequence: 3, observedAt: observed.checkedAt, phase: 'dom', status: 'passed', operation: 'textContent', browserId: 'browser', contextId: 'context', pageId: 'page' },
    ] };
    descendant.checks = [{ ...recipe, kind: 'web', conformance: { requirementId: 'foreign-stack', capability: 'foreign-runtime', kind: 'runtime', provider: 'Foreign', productInputs: ['browser.cjs'] } }];
    const options = { plan, targetTaskId: predecessor.id, target, requiredKind: 'web' as const, evidence: [observed], workspace, sourceWorkspaces: { [descendant.id]: [project, peer] } };
    expect(candidateFromRecordedInterfaceProof({ ...options, evidence: [original.evidence] })).toBeUndefined();
    const candidate = candidateFromRecordedInterfaceProof(options)!;
    expect(candidate.check.id).toBe(target.id); expect(candidate.check.args).toEqual([join(workspace, 'browser.cjs')]); expect(candidate.check.conformance).toBeUndefined();
    expect(candidate.check.expected).toBe(target.expected); expect(candidate.transformation).toMatchObject({ sourceEvidenceId: observed.id, sourceTaskId: descendant.id, validation: 'fresh-execution-and-review-required' });
    expect(original.evidence.kind).toBe('command'); expect(observed.kind).toBe('web'); expect(executions).toBe(1);
    const fresh = await runVerification(workspace, brief, predecessor, plan, candidate.check, execute, terminal);
    expect(executions).toBe(2); expect(fresh.evidence.passed).toBe(false); expect(fresh.classification).toBe('instrument'); expect(fresh.evidence.id).not.toBe(observed.id);
    expect(candidateFromRecordedInterfaceProof({ ...options, target: { ...target, requirementIds: ['unrelated'] } })).toBeUndefined();
    const unrelatedPlan = { ...plan, tasks: [predecessor, { ...descendant, dependsOn: [] }] };
    expect(candidateFromRecordedInterfaceProof({ ...options, plan: unrelatedPlan })).toBeUndefined();
  } finally { await rm(project, { recursive: true, force: true }); }
});
