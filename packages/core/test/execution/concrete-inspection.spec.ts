import { afterEach, expect, it } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DevelopmentPlan, ProductBrief, WorkUnit } from '../../src/domain/types.js';
import { runBuild } from '../../src/execution/build.js';
import { deliveryWriteSet } from '../../src/execution/delivery-sources.js';
import { inspectionStillCurrent } from '../../src/execution/inspection.js';
import { executeCommand } from '../../src/runtime/command.js';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });

it('keeps broad write permission separate from concrete delivery inspection while rerunning genuinely global proofs', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'capivara-concrete-inspection-')); roots.push(workspace);
  const brief: ProductBrief = { schema: 'capivara/product/1', id: 'b', revision: 1, status: 'ready', name: 'Commands', summary: 'Provide base and child commands.', request: 'Provide base and child CLI commands.', modes: ['cli'], targets: ['portable'], requirements: ['base', 'child'].map(id => ({ id, statement: `Provide the ${id} command.`, mode: 'cli', source: { kind: 'request', reference: 'request', text: `Provide the ${id} command.` } })), constraints: [], decisions: [], gaps: [] };
  const scaffold: WorkUnit = { id: 'scaffold', title: 'Base command', goal: 'Provide the base command and reproducible build.', instructions: 'Implement the base command and build utility.', requirementIds: ['base'], dependsOn: [], environmentIds: [], contractIds: [], files: ['src/', 'build.mjs'], criteria: ['The base command prints BASE.', 'The build records the current sources.'], checks: [
    { id: 'global-build', kind: 'command', command: process.execPath, args: ['build.mjs'], level: 'build', inputs: ['src/', 'build.mjs'], outputs: ['dist/summary.json'], assertion: { type: 'contains', value: 'BUILD' }, requirementIds: ['base'], requiredCapabilities: [] },
    { id: 'base-behavior', kind: 'cli', command: process.execPath, args: ['src/base.mjs'], level: 'behavior', inputs: ['src/base.mjs'], assertion: { type: 'contains', value: 'BASE' }, requirementIds: ['base'], requiredCapabilities: [] },
  ], risk: 'normal', blockedBy: [] };
  const child: WorkUnit = { id: 'child', title: 'Child command', goal: 'Provide the child command.', instructions: 'Implement the child command.', requirementIds: ['child'], dependsOn: ['scaffold'], environmentIds: [], contractIds: [], files: ['src/module/'], criteria: ['The child command prints CHILD.'], checks: [{ id: 'child-behavior', kind: 'cli', command: process.execPath, args: ['src/module/child.mjs'], level: 'behavior', inputs: ['src/module/child.mjs'], assertion: { type: 'contains', value: 'CHILD' }, requirementIds: ['child'], requiredCapabilities: [] }], risk: 'normal', blockedBy: [] };
  const plan: DevelopmentPlan = { schema: 'capivara/plan/1', status: 'ready', revision: 1, briefId: brief.id, briefRevision: 1, environment: [], contracts: [], tasks: [scaffold, child], acceptance: [] };
  const calls = { scaffoldEditor: 0, scaffoldReviewer: 0, childEditor: 0, childReviewer: 0, globalProof: 0 };
  const options = { workspace, brief, plan, signal: AbortSignal.timeout(15_000), executeCommand: async (request: Parameters<typeof executeCommand>[0]) => {
    if (request.executionPolicy?.purpose === 'verification' && (Array.isArray(request.command) ? request.command : [request.command]).includes('build.mjs')) calls.globalProof++;
    return executeCommand(request);
  }, agent: async (request: Parameters<NonNullable<Parameters<typeof runBuild>[0]['agent']>>[0]) => {
    const foundation = request.context?.includes('Work unit scaffold:');
    if (request.role === 'reviewer') {
      if (foundation) calls.scaffoldReviewer++; else calls.childReviewer++;
      return { status: 'complete' as const, text: '{"approved":true,"findings":[]}', changedFiles: [], commands: [] };
    }
    expect(request.role).toBe('editor');
    if (foundation) {
      calls.scaffoldEditor++;
      await mkdir(join(request.workspace, 'src'), { recursive: true });
      await writeFile(join(request.workspace, 'src/base.mjs'), "console.log('BASE');\n");
      await writeFile(join(request.workspace, 'build.mjs'), "import{readdir,readFile,mkdir,writeFile}from'node:fs/promises';import{join}from'node:path';import{createHash}from'node:crypto';const files={};async function scan(dir){for(const item of await readdir(dir,{withFileTypes:true})){const path=join(dir,item.name);if(item.isDirectory())await scan(path);else files[path]=createHash('sha256').update(await readFile(path)).digest('hex');}}await scan('src');await mkdir('dist',{recursive:true});await writeFile('dist/summary.json',JSON.stringify(files));console.log('BUILD');");
    } else {
      calls.childEditor++;
      await mkdir(join(request.workspace, 'src/module'), { recursive: true });
      await writeFile(join(request.workspace, 'src/module/child.mjs'), "console.log('CHILD');\n");
    }
    return { status: 'complete' as const, text: '', changedFiles: ['untrusted-model-report'], commands: [] };
  } };
  const first = await runBuild(options);
  expect(first.status, JSON.stringify(first.incidents)).toBe('complete');
  expect(calls).toEqual({ scaffoldEditor: 1, scaffoldReviewer: 1, childEditor: 1, childReviewer: 1, globalProof: 2 });
  const progress = first.state.tasks.scaffold!, approved = progress.reviews!.find(review => review.assessment.decision === 'approved')!.inspection!;
  expect(approved.deliveryFiles).toEqual(['build.mjs', 'src/base.mjs']);
  expect(approved.sources['src/module/child.mjs']).toBeUndefined();
  expect(approved.sources['dist/summary.json']).toBeUndefined();
  expect(progress.changedFiles).not.toContain('untrusted-model-report');
  const globalProofs = first.state.evidence.filter(evidence => evidence.taskId === scaffold.id && evidence.checkId === 'global-build');
  expect(globalProofs).toHaveLength(2); expect(globalProofs[0]!.inputHash).not.toBe(globalProofs[1]!.inputHash);
  expect(progress.verificationEvidence?.find(reference => reference.checkId === 'global-build')?.evidenceId).toBe(globalProofs[1]!.id);
  const artifact = JSON.parse(await readFile(join(workspace, 'dist/summary.json'), 'utf8')) as Record<string, string>;
  expect(artifact['src/module/child.mjs']).toMatch(/^[a-f0-9]{64}$/);
  const second = await runBuild({ ...options, plan: first.plan, state: structuredClone(first.state), signal: AbortSignal.timeout(10_000) });
  expect(second.status, JSON.stringify(second.incidents)).toBe('complete');
  expect(calls).toEqual({ scaffoldEditor: 1, scaffoldReviewer: 1, childEditor: 1, childReviewer: 1, globalProof: 2 });
  expect(deliveryWriteSet('legacy', { changedFiles: [] })).toBeUndefined();
  expect(deliveryWriteSet(scaffold.id, { changedFiles: [] }, first.state.integrations)).toBeUndefined();
  const writeSet = deliveryWriteSet(scaffold.id, progress, first.state.integrations)!;
  await writeFile(join(workspace, 'src/base.mjs'), "console.log('BASE'); // actual owned change\n");
  expect(await inspectionStillCurrent(approved, workspace, brief, first.plan, scaffold, writeSet)).toBe(false);
});
