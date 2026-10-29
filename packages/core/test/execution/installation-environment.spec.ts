import { afterEach, expect, it } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import type { EnvironmentNode, ProductBrief } from '../../src/domain/types.js';
import { applyOperationalEnvironment, prepareEnvironmentNode, prepareProjectDependencies } from '../../src/execution/environment.js';
import { executeCommand } from '../../src/runtime/command.js';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });

it.skipIf(process.platform === 'win32')('uses a ready local tool and expanded library path only for the actual offline installation, without exporting its bindings to the consumer', async () => {
  const root = await mkdtemp(join(tmpdir(), 'capivara-install env-')); roots.push(root);
  const bin = join(root, '.capivara-tools/bin'), libraries = join(root, '.capivara-tools/lib'), tool = join(bin, 'fixture-native-compiler');
  await mkdir(bin, { recursive: true }); await mkdir(libraries, { recursive: true });
  await writeFile(tool, `#!${process.execPath}\nif(!process.env.LD_LIBRARY_PATH?.split(${JSON.stringify(delimiter)}).includes(${JSON.stringify(libraries)}))throw Error('actual library path unavailable');console.log('NATIVE_READY');\n`, { mode: 0o755 });
  const brief: ProductBrief = { schema: 'capivara/product/1', id: 'b', revision: 1, status: 'ready', name: 'Installation', summary: 'Install a local dependency.', request: 'Build a CLI.', modes: ['cli'], targets: ['portable'], requirements: [], constraints: [], decisions: [], gaps: [] };
  const runtime: EnvironmentNode = { id: 'node', name: 'Runtime', kind: 'runtime', identity: { capability: 'node', kind: 'runtime', provider: 'Node.js' }, dependsOn: [], targets: [], reason: 'Run the consumer.', check: { command: process.execPath, args: ['--version'] }, prepare: [], provides: { command: [process.execPath], aliases: ['node'] } };
  const consumer = await prepareEnvironmentNode(root, runtime, brief, executeCommand); expect(consumer.ready).toBe(true);
  const native: EnvironmentNode = { id: 'native', name: 'Installer tool', kind: 'tool', identity: { capability: 'installer-native', kind: 'cli', provider: 'Local compiler' }, dependsOn: [], targets: [], reason: 'Needed only by the dependency installation.', check: { command: tool, args: ['--version'] }, prepare: [], provides: { command: [tool], paths: ['.capivara-tools/bin'], env: { PATH: '$PWD/.capivara-tools/bin:$PATH', LD_LIBRARY_PATH: '$PWD/.capivara-tools/lib:${LD_LIBRARY_PATH:-}' } } };
  const prepared = await prepareEnvironmentNode(root, native, brief, executeCommand, { operational: consumer.operational });
  expect(prepared.ready, JSON.stringify(prepared.incidents)).toBe(true);
  expect(prepared.operational.env.LD_LIBRARY_PATH).not.toContain('$');
  expect(prepared.operational.bindings['installer-native']!.transformations).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'literal-provider-search-path-template', original: { LD_LIBRARY_PATH: native.provides!.env!.LD_LIBRARY_PATH } })]));
  const literal = '$(touch MUST_NOT_EXIST)';
  const probe = await executeCommand(applyOperationalEnvironment({ cwd: root, command: ['env', 'LD_LIBRARY_PATH=$PWD/.capivara-tools/lib:${LD_LIBRARY_PATH:-}', `UNEXECUTED=${literal}`, process.execPath, '-e', 'console.log(JSON.stringify({literal:"$PWD",unexecuted:process.env.UNEXECUTED,library:process.env.LD_LIBRARY_PATH}));'] }, consumer.operational));
  expect(probe.exitCode).toBe(0); expect(JSON.parse(probe.stdout)).toMatchObject({ literal: '$PWD', unexecuted: literal });
  expect(JSON.parse(probe.stdout).library).not.toContain('$');
  expect(await stat(join(root, 'MUST_NOT_EXIST')).catch(() => null)).toBeNull();
  const source = join(root, 'package-src'); await mkdir(source);
  await writeFile(join(source, 'package.json'), JSON.stringify({ name: 'fixture-dependency', version: '1.0.0', main: 'index.cjs', scripts: { install: 'node build.mjs' } }));
  await writeFile(join(source, 'build.mjs'), "import{spawnSync}from'node:child_process';import{writeFileSync}from'node:fs';const result=spawnSync('fixture-native-compiler',[],{encoding:'utf8'});if(result.status!==0){console.error(result.stderr||String(result.error));process.exit(1);}if(!result.stdout.includes('NATIVE_READY'))throw Error('wrong tool');writeFileSync(new URL('native.ready',import.meta.url),'COMPILED');");
  await writeFile(join(source, 'index.cjs'), "module.exports=require('node:fs').readFileSync(require('node:path').join(__dirname,'native.ready'),'utf8');");
  const packed = await executeCommand({ cwd: source, command: ['npm', 'pack', '--ignore-scripts', '--silent', '--pack-destination', root], environment: { npm_config_registry: 'http://127.0.0.1:9' } });
  expect(packed.exitCode, packed.stderr).toBe(0);
  await writeFile(join(root, 'package.json'), JSON.stringify({ name: 'consumer', version: '1.0.0', dependencies: { 'fixture-dependency': `file:./${packed.stdout.trim()}` } }));
  let installs = 0;
  const result = await prepareProjectDependencies(root, brief, async request => {
    if ((typeof request.command === 'string' ? request.command : request.command.join(' ')).includes('npm install')) {
      installs++; expect(request.environment?.PATH?.split(delimiter)).toContain(bin); expect(request.environment?.LD_LIBRARY_PATH?.split(delimiter)).toContain(libraries);
    }
    return executeCommand({ ...request, environment: { ...request.environment, npm_config_registry: 'http://127.0.0.1:9', npm_config_ignore_scripts: 'false' } });
  }, { operational: consumer.operational, installationOperational: prepared.operational, inputs: ['app.mjs'] });
  expect(result.ready, JSON.stringify(result.incidents)).toBe(true); expect(installs).toBe(1);
  expect(await readFile(join(root, 'node_modules/fixture-dependency/native.ready'), 'utf8')).toBe('COMPILED');
  expect(result.operational.bindings['installer-native']).toBeUndefined(); expect(result.cache.operational.bindings['installer-native']).toBeUndefined();
  expect(result.operational.env.LD_LIBRARY_PATH).toBeUndefined(); expect(result.operational.env.PATH?.split(delimiter)).not.toContain(bin);
  expect(result.cache.installationRevision).toBe(prepared.operational.revision);
  const observed = await executeCommand(applyOperationalEnvironment({ cwd: root, command: ['node', '-e', "console.log(require('fixture-dependency'))"] }, result.operational));
  expect(observed.exitCode, observed.stderr).toBe(0); expect(observed.stdout.trim()).toBe('COMPILED');
  // Provider preparation can install the same offline dependency. Its compiler
  // is an installer prerequisite, not part of the provider's consumption scope.
  await rm(join(root,'node_modules'),{recursive:true,force:true}); await rm(join(root,'package-lock.json'),{force:true});
  const sdk:EnvironmentNode={id:'sdk',name:'Fixture SDK',kind:'sdk',identity:{capability:'fixture-sdk',kind:'sdk',provider:'Fixture compiler'},dependsOn:[],targets:[],reason:'Build the product.',provides:{command:[process.execPath,'compiler.mjs'],aliases:['fixture-sdk']},check:{command:'fixture-sdk',args:['--version']},prepare:[{command:'npm',args:['install','--offline','--no-audit','--no-fund']},{command:process.execPath,args:['-e',`require('node:fs').writeFileSync('compiler.mjs',"import dependency from 'fixture-dependency';console.log(dependency);")`]}]};
  let providerInstallations=0;
  const execute:typeof executeCommand=async request=>{
    const command=typeof request.command==='string'?request.command:request.command.join(' ');
    if(command.includes('npm install'))providerInstallations++;
    else if(!command.includes(sdk.prepare[1]!.args![1]!)){expect(request.environment?.LD_LIBRARY_PATH).toBeUndefined();expect(request.environment?.PATH?.split(delimiter)).not.toContain(bin);}
    return executeCommand({...request,environment:{...request.environment,npm_config_registry:'http://127.0.0.1:9',npm_config_ignore_scripts:'false'}});
  };
  const unavailable=await prepareEnvironmentNode(root,sdk,brief,execute,{operational:consumer.operational});
  expect(unavailable.ready).toBe(false); expect(unavailable.cache.noProgress).toBe(true); expect(providerInstallations).toBe(1);
  const unchanged=await prepareEnvironmentNode(root,sdk,brief,execute,{operational:consumer.operational,previous:unavailable.cache});
  expect(unchanged.ready).toBe(false); expect(unchanged.results).toHaveLength(0); expect(providerInstallations).toBe(1);
  const installed=await prepareEnvironmentNode(root,sdk,brief,execute,{operational:consumer.operational,previous:unchanged.cache,installationOperational:prepared.operational});
  expect(installed.ready,JSON.stringify(installed.incidents)).toBe(true); expect(providerInstallations).toBe(2);
  expect(installed.results.at(-1)?.stdout.trim()).toBe('COMPILED'); expect(installed.cache.installationRevision).toBe(prepared.operational.revision);
  expect(installed.operational.bindings['installer-native']).toBeUndefined(); expect(installed.operational.env.LD_LIBRARY_PATH).toBeUndefined();
  expect(installed.operational.env.PATH?.split(delimiter)).not.toContain(bin);
  const cached=await prepareEnvironmentNode(root,sdk,brief,execute,{operational:consumer.operational,previous:installed.cache});
  expect(cached.ready).toBe(true); expect(cached.fingerprint).toBe(installed.fingerprint); expect(cached.results).toHaveLength(0); expect(providerInstallations).toBe(2);
});
