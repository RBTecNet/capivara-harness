import { afterEach, expect, it } from 'vitest';
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { applyOperationalEnvironment, emptyOperationalEnvironment, OperationalInvocationConflict, operationalInvocations, prepareEnvironmentNode, relocateOperationalEnvironment } from '../../src/execution/environment.js';
import { prepareInvocationInstrument } from '../../src/execution/invocation-instrument.js';
import { executeCommand } from '../../src/runtime/command.js';
import type { EnvironmentNode, ProductBrief } from '../../src/domain/types.js';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });

it.skipIf(process.platform === 'win32')('recognizes one executable through relative, absolute, PATH and symlink declarations across relocation while preserving genuinely different fixed arguments', async () => {
  const root = await mkdtemp(join(tmpdir(), 'capivara-canonical-invocation-')); roots.push(root);
  await mkdir(join(root, 'tools/bin'), { recursive: true });
  const program = join(root, 'tools/builder.mjs'), link = join(root, 'tools/bin/builder');
  await writeFile(program, `#!${process.execPath}\nconsole.log('BUILDER '+process.argv.slice(2).join(' '));\n`, { mode: 0o755 });
  await symlink('../builder.mjs', link);
  const operational = emptyOperationalEnvironment(root); operational.env.PATH = join(root, 'tools/bin');
  operational.bindings.relative = { capability: 'relative', kind: 'cli', provider: 'Selected builder', ready: true, command: ['./tools/bin/builder'], aliases: ['builder'] };
  operational.bindings.absolute = { capability: 'absolute', kind: 'cli', provider: 'Selected builder', ready: true, command: [program], aliases: ['builder'] };
  operational.bindings.path = { capability: 'path', kind: 'cli', provider: 'Selected builder', ready: true, command: ['builder'], aliases: ['builder'] };
  const original = structuredClone(operational);
  expect(() => operationalInvocations(operational)).not.toThrow();
  expect(new Set(operationalInvocations(operational).map(invocation => JSON.stringify(invocation.command))).size).toBe(1);
  expect((await executeCommand(applyOperationalEnvironment({ cwd: root, command: ['builder', '--version'] }, operational))).stdout).toContain('BUILDER --version');
  const instrument = await prepareInvocationInstrument(root, operational);
  expect((await executeCommand({ cwd: root, command: ['builder', '--version'], environment: instrument.environment })).stdout).toContain('BUILDER --version');
  expect(operational).toEqual(original);
  const privateRoot = await mkdtemp(join(tmpdir(), 'capivara-canonical-private-')); roots.push(privateRoot);
  await cp(join(root, 'tools'), join(privateRoot, 'tools'), { recursive: true, dereference: false, verbatimSymlinks: true });
  const relocated = relocateOperationalEnvironment(operational, root, privateRoot);
  expect(() => operationalInvocations(relocated)).not.toThrow();
  expect((await executeCommand(applyOperationalEnvironment({ cwd: privateRoot, command: ['builder', 'private'] }, relocated))).stdout).toContain('BUILDER private');
  const conflicting = structuredClone(operational);
  conflicting.bindings.absolute!.command = [program, '--different-loader'];
  expect(() => operationalInvocations(conflicting)).toThrow(OperationalInvocationConflict);
  await expect(prepareInvocationInstrument(root, conflicting)).rejects.toBeInstanceOf(OperationalInvocationConflict);
  expect(await readFile(program, 'utf8')).toContain('BUILDER');
});

it.skipIf(process.platform === 'win32')('recovers a missing provider through its independent instrument without equating unavailable aliases', async () => {
  const root = await mkdtemp(join(tmpdir(), 'capivara-unavailable-invocation-')); roots.push(root);
  await mkdir(join(root, 'tools/bin'), { recursive: true });
  const program = join(root, 'tools/builder.mjs'), link = join(root, 'tools/bin/builder');
  const body = `#!${process.execPath}\nconsole.log('builder-version');\n`;
  await writeFile(program, body, { mode: 0o755 }); await symlink('../builder.mjs', link);
  const operational = emptyOperationalEnvironment(root); operational.env.PATH = join(root, 'tools/bin');
  operational.bindings.historical = { capability: 'historical', kind: 'cli', provider: 'Builder', ready: true, command: [link], aliases: ['builder'] };
  operational.bindings.current = { capability: 'current', kind: 'sdk', provider: 'Builder', ready: true, command: ['builder'], aliases: ['builder'] };
  await rm(program);
  // The references are unresolved, not proven equivalent. Global publication
  // and an actual ambiguous consumer must continue to reject them.
  expect(() => operationalInvocations(operational)).toThrow(OperationalInvocationConflict);
  expect(() => applyOperationalEnvironment({ cwd: root, command: ['builder', '--version'] }, operational)).toThrow(OperationalInvocationConflict);
  const brief:ProductBrief={schema:'capivara/product/1',status:'ready',id:'b',revision:1,name:'fixture',summary:'fixture',request:'CLI prints its version',modes:['cli'],targets:['portable'],requirements:[],constraints:[],decisions:[],gaps:[]};
  const probe = `const r=require('node:child_process').spawnSync(${JSON.stringify(link)},['--version'],{encoding:'utf8'});process.stdout.write(r.stdout||'');process.stderr.write(r.stderr||String(r.error||''));process.exit(r.status??4)`;
  const node:EnvironmentNode={id:'builder',name:'Builder',kind:'sdk',identity:{capability:'current',kind:'sdk',provider:'Builder'},targets:['portable'],dependsOn:[],reason:'Compiles the product',provides:{command:['builder'],paths:['tools/bin']},check:{command:process.execPath,args:['--eval',probe]},prepare:[]};
  const missing = await prepareEnvironmentNode(root,node,brief,executeCommand,{operational,revalidate:true});
  expect(missing.ready).toBe(false); expect(missing.results).toHaveLength(1);
  expect(missing.results[0]?.exitCode).toBe(4); expect(missing.incidents[0]?.kind).toBe('environment');
  node.prepare=[{command:process.execPath,args:['--eval',`require('node:fs').writeFileSync(${JSON.stringify(program)},${JSON.stringify(body)},{mode:0o755})`]}];
  const restored = await prepareEnvironmentNode(root,node,brief,executeCommand,{operational,previous:missing.cache,revalidate:true});
  expect(restored.ready).toBe(true); expect(restored.results).toHaveLength(3);
  expect(restored.results[0]?.exitCode).toBe(4); expect(restored.results.at(-1)?.stdout).toContain('builder-version');
  expect(() => operationalInvocations(restored.operational)).not.toThrow();
  const instrument = await prepareInvocationInstrument(root,restored.operational);
  expect((await executeCommand({cwd:root,command:['builder','--version'],environment:instrument.environment})).stdout).toContain('builder-version');
  const different = structuredClone(restored.operational); different.bindings.historical!.command=[process.execPath];
  expect(() => applyOperationalEnvironment({cwd:root,command:['builder']},different)).toThrow(OperationalInvocationConflict);
});
