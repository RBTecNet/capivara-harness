import { afterEach, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { contextForTask, ContextTooLarge, packetText } from '../../src/domain/context.js';
import type { DevelopmentPlan, EnvironmentNode, ProductBrief, WorkUnit } from '../../src/domain/types.js';
import { prepareEnvironmentNode, emptyOperationalEnvironment } from '../../src/execution/environment.js';
import { preparedContextPlan } from '../../src/execution/prepared-context.js';
import { assembleTaskContext } from '../../src/execution/task-context.js';
import { executeCommand } from '../../src/runtime/command.js';

const temporary: string[] = [];
afterEach(async () => { await Promise.all(temporary.splice(0).map(path => rm(path, { recursive: true, force: true }))); });
const brief: ProductBrief = { schema: 'capivara/product/1', id: 'b', revision: 1, status: 'ready', name: 'Storage', summary: 'Store a row', request: 'Create a CLI using SQLite.', modes: ['cli'], targets: ['portable'], requirements: [], constraints: [], decisions: [], gaps: [] };
const node: EnvironmentNode = { id: 'database', name: 'SQLite', kind: 'package', identity: { capability: 'embedded-sql', provider: 'SQLite', kind: 'library' }, reason: 'Store rows.', check: { command: process.execPath, args: ['-e', "require('node:sqlite')"] }, prepare: [], dependsOn: [], targets: ['portable'] };
const task: WorkUnit = { id: 'storage', title: 'Storage', goal: 'Store a row', instructions: 'Implement storage', requirementIds: [], dependsOn: [], environmentIds: ['database'], contractIds: [], files: [], criteria: ['A row persists'], checks: [], risk: 'normal', blockedBy: [] };
const plan = (environment: EnvironmentNode[]): DevelopmentPlan => ({ schema: 'capivara/plan/1', status: 'ready', revision: 1, briefId: brief.id, briefRevision: brief.revision, environment, contracts: [], tasks: [task] });

it('includes declared module specifiers and actual host invocation only for the task environment', () => {
  const declared = { ...node, provides: { modules: [{ protocol: 'node' as const, specifier: 'node:sqlite', runtimeCommand: [process.execPath] }], env: { SECRET: 'must-not-be-exposed' } } };
  const unrelated = { ...declared, id: 'unrelated', name: 'Other', provides: { modules: [{ protocol: 'node' as const, specifier: 'unrelated-module', runtimeCommand: ['unrelated-runtime'] }] } };
  const text = packetText(contextForTask(brief, plan([declared, unrelated]), task));
  expect(text).toContain('node:sqlite'); expect(text).toContain(JSON.stringify(process.execPath));
  expect(text).not.toContain('unrelated-module'); expect(text).not.toContain('must-not-be-exposed');
  expect(text).not.toContain('; invocation=');
});

it('delivers a readiness-inferred module to the consumer without changing the authoritative plan or inventing a CLI', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'capivara-prepared-context-')); temporary.push(directory);
  const definition = plan([structuredClone(node)]), original = structuredClone(definition);
  const prepared = await prepareEnvironmentNode(directory, definition.environment[0]!, brief, executeCommand);
  expect(prepared.ready, JSON.stringify(prepared.incidents)).toBe(true);
  const view = preparedContextPlan(definition, task, prepared.operational);
  const context = await assembleTaskContext(brief, view, task, directory, 4000);
  expect(context.text).toContain('node:sqlite'); expect(context.text).toContain(JSON.stringify(process.execPath));
  expect(context.text).toContain('"protocol":"node"'); expect(context.text).not.toContain('; invocation=');
  expect(context.text.length).toBeLessThanOrEqual(4000);
  expect(definition).toEqual(original); expect(definition.environment[0]!.provides).toBeUndefined();
  expect(view.environment[0]!.provides?.modules).toEqual([{ protocol: 'node', specifier: 'node:sqlite', runtimeCommand: [process.execPath] }]);
  view.environment[0]!.provides!.modules![0]!.runtimeCommand.push('modified-context-only');
  expect(prepared.operational.bindings['embedded-sql']!.modules![0]!.runtimeCommand).toEqual([process.execPath]);
});

it('rejects oversized provider packets through the original budget and excludes mismatched or unready providers', () => {
  const definition = plan([structuredClone(node)]), operational = emptyOperationalEnvironment();
  operational.bindings['embedded-sql'] = { capability: 'embedded-sql', kind: 'library', provider: 'Other', ready: true, modules: [{ protocol: 'node', specifier: 'wrong-provider-module', runtimeCommand: [process.execPath] }] };
  expect(preparedContextPlan(definition, task, operational)).toBe(definition);
  operational.bindings['embedded-sql']!.provider = 'SQLite'; operational.bindings['embedded-sql']!.ready = false;
  expect(preparedContextPlan(definition, task, operational)).toBe(definition);
  operational.bindings['embedded-sql']!.ready = true;
  operational.bindings['embedded-sql']!.modules![0]!.specifier = 'large-provider-specifier'.repeat(200);
  const view = preparedContextPlan(definition, task, operational);
  expect(() => contextForTask(brief, view, task, 2000)).toThrow(ContextTooLarge);
});
