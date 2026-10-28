import { afterEach, expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink, readlink, chmod, rename, lstat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { EnvironmentNode, WorkUnit } from '../../src/domain/types.js';
import type { IntegrationTransaction } from '../../src/execution/types.js';
import { allowedRecoveryPath, beginEnvironmentRecovery, commitEnvironmentRecovery, environmentRecoveryContext, environmentRecoveryTask, resumeEnvironmentRecovery } from '../../src/execution/recovery-scope.js';

const temporary: string[] = [];
afterEach(async () => { await Promise.all(temporary.splice(0).map(path => rm(path, { recursive: true, force: true }))); });
async function workspace() { const path = await mkdtemp(join(tmpdir(), 'capivara-environment-scope-')); temporary.push(path); return path; }
const node: EnvironmentNode = { id: 'runtime', name: 'Runtime', kind: 'runtime', dependsOn: [], targets: [], reason: 'Execute the application', check: { command: 'runtime', args: ['--version'] }, prepare: [], identity: { capability: 'runtime', kind: 'runtime', provider: 'local' }, provides: { paths: ['server/src/index.ts'], inputs: ['server/src/db.ts'] } };
const task: WorkUnit = { id: 'foundation', title: 'Build product', goal: 'Implement CRUD', instructions: 'Create the whole frontend and backend', requirementIds: ['r1'], dependsOn: [], environmentIds: ['runtime'], contractIds: [], files: ['server/src/index.ts'], criteria: ['CRUD works'], checks: [], risk: 'normal', blockedBy: [] };

it('builds an environment-only work packet without granting authority over product source', () => {
  const recovery = environmentRecoveryTask(task, node);
  expect(recovery.id).toBe('$environment:runtime');
  expect(recovery.goal).not.toContain('CRUD');
  expect(recovery.instructions).not.toContain(task.instructions);
  expect(recovery.requirementIds).toEqual([]);
  expect(recovery.files).not.toContain('server/src/index.ts');
  expect(environmentRecoveryContext(node, [{ message: 'unavailable', evidence: 'exit 127' }])).toContain('exit 127');
  expect(allowedRecoveryPath(node, 'server/src/index.ts')).toBe(false);
  expect(allowedRecoveryPath(node, '../package.json')).toBe(false);
  expect(allowedRecoveryPath(node, '.capivara-next/package.json')).toBe(false);
  expect(allowedRecoveryPath(node, 'packages/client/package.json')).toBe(true);
});

it('publishes dependency preparation while quarantining unexpected application changes in the durable proposal', async () => {
  const root = await workspace(); await mkdir(join(root, 'server/src'), { recursive: true });
  await writeFile(join(root, 'server/src/index.ts'), 'original product');
  await writeFile(join(root, 'package.json'), '{"dependencies":{}}');
  const checkpoint = await beginEnvironmentRecovery(root, node);
  await writeFile(join(checkpoint.directory, 'server/src/index.ts'), 'unexpected product rewrite');
  await writeFile(join(root, 'server/src/index.ts'), 'concurrent product progress');
  await writeFile(join(checkpoint.directory, 'package.json'), '{"dependencies":{"driver":"1"}}');
  await mkdir(join(checkpoint.directory, '.tools/bin'), { recursive: true });
  await writeFile(join(checkpoint.directory, '.tools/bin/runtime'), '#!/bin/sh\necho ready\n', { mode: 0o755 });
  const phases: string[] = [];
  const result = await commitEnvironmentRecovery(root, node, checkpoint, undefined, async transaction => { phases.push(transaction.phase); expect(await readFile(join(root, 'package.json'), 'utf8')).toBe('{"dependencies":{}}'); });
  expect(phases).toEqual(['prepared']);
  expect(result.transaction.phase).toBe('applied');
  expect(result.quarantined).toContain('server/src/index.ts');
  expect(await readFile(join(root, 'server/src/index.ts'), 'utf8')).toBe('concurrent product progress');
  expect(await readFile(join(checkpoint.directory, 'server/src/index.ts'), 'utf8')).toBe('unexpected product rewrite');
  expect(await readFile(join(root, 'package.json'), 'utf8')).toContain('driver');
  expect(await readFile(join(root, '.tools/bin/runtime'), 'utf8')).toContain('ready');
  await commitEnvironmentRecovery(root, node, checkpoint);
  expect(await readFile(join(root, 'server/src/index.ts'), 'utf8')).toBe('concurrent product progress');
});

it('retains dependency binary links so the next consumer can actually invoke the prepared tool', async () => {
  if (process.platform === 'win32') return;
  const root = await workspace(), checkpoint = await beginEnvironmentRecovery(root, node);
  await mkdir(join(checkpoint.directory, 'node_modules/tool/bin'), { recursive: true });
  await mkdir(join(checkpoint.directory, 'node_modules/.bin'), { recursive: true });
  await writeFile(join(checkpoint.directory, 'node_modules/tool/bin/tool'), '#!/bin/sh\necho usable-provider\n');
  await chmod(join(checkpoint.directory, 'node_modules/tool/bin/tool'), 0o755);
  await symlink('../tool/bin/tool', join(checkpoint.directory, 'node_modules/.bin/tool'));
  const result = await commitEnvironmentRecovery(root, node, checkpoint);
  expect(result.dependencyDirectories).toContain('node_modules');
  expect(await readlink(join(root, 'node_modules/.bin/tool'))).toBe('../tool/bin/tool');
  const command = await promisify(execFile)(join(root, 'node_modules/.bin/tool'), [], { cwd: root });
  expect(command.stdout.trim()).toBe('usable-provider');
});

it('refuses an installation link that could publish an external directory into the product', async () => {
  if (process.platform === 'win32') return;
  const root = await workspace(), outside = await workspace(), checkpoint = await beginEnvironmentRecovery(root, node);
  await mkdir(join(checkpoint.directory, '.tools'), { recursive: true });
  await symlink(outside, join(checkpoint.directory, '.tools/outside'), 'dir');
  await expect(commitEnvironmentRecovery(root, node, checkpoint)).rejects.toThrow(/escape/);
  await expect(readFile(join(root, 'package.json'))).rejects.toMatchObject({ code: 'ENOENT' });
});

it('resumes a staged dependency publication after interruption between directory renames', async () => {
  const root = await workspace(); await mkdir(join(root, 'node_modules/driver'), { recursive: true });
  await writeFile(join(root, 'node_modules/driver/index.js'), 'old driver');
  const checkpoint = await beginEnvironmentRecovery(root, node);
  await writeFile(join(checkpoint.directory, 'node_modules/driver/index.js'), 'ready driver');
  let recorded: IntegrationTransaction | undefined;
  await expect(commitEnvironmentRecovery(root, node, checkpoint, undefined, async transaction => { recorded = JSON.parse(JSON.stringify(transaction)) as IntegrationTransaction; throw new Error('process interrupted after its durable commit'); })).rejects.toThrow('process interrupted');
  const transaction = recorded!, installation = transaction.installations![0]!;
  await rename(join(root, 'node_modules'), installation.backup); // died after retaining before-image
  await resumeEnvironmentRecovery(root, JSON.parse(JSON.stringify(transaction)) as IntegrationTransaction);
  expect(await readFile(join(root, 'node_modules/driver/index.js'), 'utf8')).toBe('ready driver');
  await resumeEnvironmentRecovery(root, transaction);
  expect(transaction.phase).toBe('applied');
  expect(await readFile(join(checkpoint.directory, 'node_modules/driver/index.js'), 'utf8')).toBe('ready driver');
});

it('materializes external regular runtime links instead of losing a virtual environment executable', async () => {
  if (process.platform === 'win32') return;
  const root = await workspace(), outside = await workspace(), checkpoint = await beginEnvironmentRecovery(root, node);
  const provider = join(outside, 'runtime'); await writeFile(provider, '#!/bin/sh\necho virtual-runtime\n', { mode: 0o755 });
  await mkdir(join(checkpoint.directory, '.venv/bin'), { recursive: true });
  await symlink(provider, join(checkpoint.directory, '.venv/bin/runtime'));
  await commitEnvironmentRecovery(root, node, checkpoint);
  expect((await lstat(join(root, '.venv/bin/runtime'))).isSymbolicLink()).toBe(false);
  expect((await promisify(execFile)(join(root, '.venv/bin/runtime'), [], { cwd: root })).stdout.trim()).toBe('virtual-runtime');
});
