import { afterEach, expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { prepareEnvironmentNode } from '../../src/execution/environment.js';
import { executeCommand } from '../../src/runtime/command.js';
import type { EnvironmentNode, ProductBrief } from '../../src/domain/types.js';

const temporary: string[] = [];
afterEach(async () => { await Promise.all(temporary.splice(0).map(path => rm(path, { recursive: true, force: true }))); });
const brief: ProductBrief = { schema: 'capivara/product/1', status: 'ready', id: 'b', revision: 1, name: 'Fixture', summary: 'Local product', request: 'Crie uma CLI.', modes: ['cli'], targets: [], requirements: [], constraints: [], gaps: [], decisions: [] };
const compiler = "import fs from 'node:fs'; if(!globalThis.fixtureLoader)process.exit(17); if(process.argv.includes('--version'))console.log('fixture-sdk 1.0'); else { fs.readFileSync(process.argv[process.argv.findIndex(arg=>['--project','-p'].includes(arg))+1]); console.log('product compiled'); }";
async function fixture(installed = true) {
  const root = await mkdtemp(join(tmpdir(), 'capivara-availability-')); temporary.push(root);
  await mkdir(join(root, '.tools')); await writeFile(join(root, '.tools', 'loader.mjs'), 'globalThis.fixtureLoader=true;');
  if (installed) await writeFile(join(root, '.tools', 'compiler.mjs'), compiler);
  const node: EnvironmentNode = { id: 'sdk', name: 'Compiler SDK', kind: 'sdk', identity: { capability: 'compiler', kind: 'sdk', provider: 'fixture-sdk' }, dependsOn: [], targets: [], reason: 'Compile the product', check: { command: process.execPath, args: ['--import', './.tools/loader.mjs', './.tools/compiler.mjs', '--project', 'app.conf'] }, prepare: [] };
  return { root, node };
}

it.each(['--project', '-p'])('separates SDK availability from a missing product config while preserving the program and loader (%s)', async option => {
  const { root, node } = await fixture();
  node.check.args = node.check.args!.map(arg => arg === '--project' ? option : arg);
  node.prepare = [{ command: process.execPath, args: ['-e', 'throw Error("An installed SDK must not be installed again.")'] }];
  const prepared = await prepareEnvironmentNode(root, node, brief, executeCommand, { inputs: ['app.conf', 'src/**'] });
  expect(prepared.ready).toBe(true); expect(prepared.results).toHaveLength(2);
  expect(prepared.results[0]!.exitCode).not.toBe(0); expect(prepared.results[1]!.exitCode).toBe(0);
  expect(prepared.results[1]!.stdout).toContain('fixture-sdk 1.0');
  expect(prepared.results[1]!.command).toContain('compiler.mjs'); expect(prepared.results[1]!.command).toContain('loader.mjs');
  const binding = prepared.operational.bindings.compiler!;
  expect(binding.command).toEqual([process.execPath, '--import', './.tools/loader.mjs', './.tools/compiler.mjs']);
  expect(binding.aliases).not.toContain('node');
  const receipt = binding.transformations!.find(item => item.kind === 'product-probe-separated-from-availability')!;
  expect(receipt.original).toMatchObject({ result: { exitCode: 1 } }); expect(receipt.selected).toMatchObject({ result: { exitCode: 0 } });
  expect(prepared).not.toHaveProperty('evidence');
  await writeFile(join(root, 'app.conf'), 'valid product config');
  const revalidated = await prepareEnvironmentNode(root, node, brief, executeCommand, { previous: prepared.cache, revalidate: true, inputs: ['app.conf'] });
  expect(revalidated.ready).toBe(true); expect(revalidated.results).toHaveLength(1); expect(revalidated.results[0]!.stdout).toContain('product compiled');
  expect(revalidated.fingerprint).toBe(prepared.fingerprint); expect(revalidated.operational.revision).toBe(prepared.operational.revision);
});

it('rechecks availability after actual preparation without mistaking the interpreter for the absent SDK', async () => {
  const { root, node } = await fixture(false);
  node.prepare = [{ command: process.execPath, args: ['-e', `require('fs').writeFileSync('.tools/compiler.mjs',${JSON.stringify(compiler)})`] }];
  const prepared = await prepareEnvironmentNode(root, node, brief, executeCommand, { inputs: ['app.conf'] });
  expect(prepared.ready).toBe(true);
  expect(prepared.results.slice(0, 2).every(result => result.exitCode !== 0)).toBe(true);
  expect(prepared.results.at(-1)!.stdout).toContain('fixture-sdk 1.0');
  expect(prepared.results.some(result => result.command.includes('writeFileSync') && result.exitCode === 0)).toBe(true);
  expect(prepared.operational.bindings.compiler!.command).toContain('./.tools/compiler.mjs');
});

it('invalidates availability when the SDK program disappears and persists an ineffective fallback', async () => {
  const { root, node } = await fixture(); let calls = 0;
  const execute: typeof executeCommand = async request => { calls++; return executeCommand(request); };
  const initial = await prepareEnvironmentNode(root, node, brief, execute, { inputs: ['app.conf'] });
  expect(initial.ready).toBe(true);
  await rm(join(root, '.tools', 'compiler.mjs'));
  const removed = await prepareEnvironmentNode(root, node, brief, execute, { previous: initial.cache, inputs: ['app.conf'] });
  expect(removed.ready).toBe(false); expect(removed.fingerprint).not.toBe(initial.fingerprint);
  expect(removed.operational.bindings.compiler!.transformations!.find(item => item.kind === 'product-probe-separated-from-availability')!.selected).toMatchObject({ result: { exitCode: 1 } });
  const count = calls;
  const resumed = await prepareEnvironmentNode(root, node, brief, execute, { previous: removed.cache, inputs: ['app.conf'] });
  expect(resumed.ready).toBe(false); expect(calls).toBe(count);
});

it('uses explicit product hints for an implicit build command, without inferring them from failure prose', async () => {
  const { root } = await fixture();
  await writeFile(join(root, '.tools', 'builder.mjs'), "if(process.argv.includes('--version'))console.log('builder 1.0');else process.exit(4);");
  const node: EnvironmentNode = { id: 'builder', name: 'Builder', kind: 'tool', identity: { capability: 'build', kind: 'cli', provider: 'fixture-builder' }, dependsOn: [], targets: [], reason: 'Build app', provides: { command: [process.execPath, './.tools/builder.mjs'], aliases: ['builder'] }, check: { command: 'builder', args: ['build'] }, prepare: [] };
  expect((await prepareEnvironmentNode(root, node, brief, executeCommand)).ready).toBe(false);
  const hinted = await prepareEnvironmentNode(root, node, brief, executeCommand, { inputs: ['src/**'] });
  expect(hinted.ready).toBe(true); expect(hinted.results[0]!.exitCode).toBe(4); expect(hinted.results[1]!.stdout).toContain('builder 1.0');
});

it('never replaces library, driver, service or explicit version assertions with interpreter availability', async () => {
  for (const kind of ['library', 'driver', 'service', 'runtime'] as const) {
    const { root, node } = await fixture();
    node.identity!.kind = kind;
    node.check = { command: process.execPath, args: ['-e', 'process.exit(9)'] };
    const prepared = await prepareEnvironmentNode(root, node, brief, executeCommand, { inputs: ['app.conf', 'src/**'] });
    expect(prepared.ready).toBe(false); expect(prepared.results).toHaveLength(1); expect(prepared.results[0]!.exitCode).toBe(9);
  }
  const { root, node } = await fixture();
  await writeFile(join(root, '.tools', 'version-check.mjs'), 'process.exit(8);');
  node.identity!.kind = 'runtime'; node.provides = { command: [process.execPath, './.tools/version-check.mjs'] };
  node.check = { command: process.execPath, args: ['./.tools/version-check.mjs', '--version'] };
  const version = await prepareEnvironmentNode(root, node, brief, executeCommand, { inputs: ['src/**'] });
  expect(version.ready).toBe(false); expect(version.results).toHaveLength(1); expect(version.results[0]!.exitCode).toBe(8);
});
