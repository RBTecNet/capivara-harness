import { afterEach, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { delimiter, dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import type { EnvironmentNode, ProductBrief } from '../../src/domain/types.js';
import { applyOperationalEnvironment, emptyOperationalEnvironment, prepareEnvironmentNode } from '../../src/execution/environment.js';
import { executeCommand } from '../../src/runtime/command.js';

const temporary: string[] = [];
afterEach(async () => { await Promise.all(temporary.splice(0).map(path => rm(path, { recursive: true, force: true }))); });

it.skipIf(process.platform === 'win32')('repairs literal provider PATH and env argv against a real local executable without reinstalling, evaluating code or changing identity on resume', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'capivara-path with-spaces-')); temporary.push(workspace);
  const bin = join(workspace, 'node_modules/.bin'), tool = join(bin, 'sample-builder');
  await mkdir(bin, { recursive: true });
  await writeFile(tool, `#!${process.execPath}\nconsole.log('sample-builder 8.3.5');\n`, { mode: 0o755 });
  const brief: ProductBrief = { schema: 'capivara/product/1', id: 'b', revision: 1, status: 'ready', name: 'Local CLI', summary: 'Use the local builder.', request: 'Use a local CLI.', modes: ['cli'], targets: ['portable'], requirements: [], constraints: [], decisions: [], gaps: [] };
  const template = '$PWD/node_modules/.bin:$PATH';
  const node: EnvironmentNode = { id: 'builder', name: 'Selected local builder', kind: 'tool', identity: { capability: 'local-builder', kind: 'cli', provider: 'Selected provider' }, reason: 'Build the product.', dependsOn: [], targets: ['portable'], check: { command: 'env', args: [`PATH=${template}`, 'sample-builder', '--version'] }, prepare: [{ command: 'must-never-reinstall' }], provides: { command: ['sample-builder'], env: { PATH: template }, paths: ['node_modules/.bin/sample-builder'] } };
  const old = emptyOperationalEnvironment(workspace); old.env.PATH = `${dirname(process.execPath)}${delimiter}${template}`;
  const first = await prepareEnvironmentNode(workspace, node, brief, executeCommand, { operational: old });
  expect(first.ready, JSON.stringify(first.incidents)).toBe(true);
  expect(first.results).toHaveLength(1); expect(first.results[0]!.stdout).toContain('sample-builder 8.3.5');
  expect(first.results.some(result => result.command.includes('must-never-reinstall'))).toBe(false);
  const binding = first.operational.bindings['local-builder']!;
  expect(binding.command).toEqual([tool]); expect(binding.transformations).toEqual(expect.arrayContaining([
    expect.objectContaining({ kind: 'literal-provider-path-template', original: { PATH: template } }),
    expect.objectContaining({ kind: 'literal-env-argv', original: ['env', `PATH=${template}`, 'sample-builder', '--version'] }),
  ]));
  const paths = first.operational.env.PATH!.split(delimiter);
  expect(paths.filter(path => path === bin)).toHaveLength(1);
  expect(first.operational.env.PATH).not.toContain('$PWD'); expect(first.operational.env.PATH).not.toContain('$PATH');
  const consumer = await executeCommand(applyOperationalEnvironment({ cwd: workspace, command: ['sample-builder', '--version'] }, first.operational));
  expect(consumer.exitCode).toBe(0); expect(consumer.stdout).toContain('sample-builder 8.3.5');
  const literal = '$(touch MUST_NOT_EXIST)';
  const code = 'console.log(JSON.stringify({literal:"$PWD",attempt:process.env.ATTEMPT}));';
  const request = applyOperationalEnvironment({ cwd: workspace, command: ['env', 'PATH=${PWD}/node_modules/.bin:${PATH}', `ATTEMPT=${literal}`, process.execPath, '-e', code] }, first.operational);
  expect(request.command).toEqual([process.execPath, '-e', code]);
  const observed = await executeCommand(request);
  expect(observed.exitCode).toBe(0); expect(JSON.parse(observed.stdout)).toEqual({ literal: '$PWD', attempt: literal });
  expect(await stat(join(workspace, 'MUST_NOT_EXIST')).catch(() => null)).toBeNull();
  const cached = await prepareEnvironmentNode(workspace, node, brief, executeCommand, { previous: structuredClone(first.cache) });
  expect(cached.ready).toBe(true); expect(cached.results).toHaveLength(0);
  const revalidated = await prepareEnvironmentNode(workspace, node, brief, executeCommand, { previous: structuredClone(cached.cache), revalidate: true });
  expect(revalidated.ready).toBe(true); expect(revalidated.results).toHaveLength(1);
  expect(revalidated.fingerprint).toBe(first.fingerprint); expect(revalidated.operational.revision).toBe(first.operational.revision);
  expect(await readFile(tool, 'utf8')).toContain('sample-builder 8.3.5');
});
