import { afterEach, expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { EnvironmentNode, ProductBrief } from '../../src/domain/types.js';
import { normalizeEnvironment } from '../../src/domain/plan.js';
import { executeCommand } from '../../src/runtime/index.js';
import { applyOperationalEnvironment, operationalInvocations, prepareEnvironmentNode } from '../../src/execution/environment.js';
const temporary:string[]=[];
afterEach(async()=>{await Promise.all(temporary.splice(0).map(path=>rm(path,{recursive:true,force:true})));});
async function workspace():Promise<string>{const root=await mkdtemp(join(tmpdir(),'capivara-invocation-'));temporary.push(root);return root;}
const brief:ProductBrief={schema:'capivara/product/1',status:'ready',id:'b',revision:1,name:'fixture',summary:'fixture',request:'CLI prints ok',modes:['cli'],targets:['portable'],requirements:[],constraints:[],decisions:[],gaps:[]};
function prerequisite(provides:EnvironmentNode['provides'],check:EnvironmentNode['check']={command:'node',args:['--version']}):EnvironmentNode{return{id:'runtime',name:'Runtime',kind:'runtime',identity:{capability:'runtime',kind:'runtime',provider:'installed-provider'},dependsOn:[],targets:['portable'],reason:'Runs product',check,prepare:[{command:'must-never-install'}],...(provides?{provides}:{})};}
it('recovers a list of executable names through readiness without installing or replaying the same bad invocation',async()=>{
  const root=await workspace();let calls=0;
  const node=prerequisite({command:['node','npm']});
  const execute:typeof executeCommand=async request=>{calls++;return executeCommand(request);};
  const prepared=await prepareEnvironmentNode(root,node,brief,execute);
  expect(prepared.ready).toBe(true);expect(prepared.results).toHaveLength(2);
  expect(prepared.results[0]?.exitCode).not.toBe(0);expect(prepared.results[1]?.exitCode).toBe(0);
  expect(prepared.results.every(result=>!result.command.includes('must-never-install'))).toBe(true);
  const binding=prepared.operational.bindings.runtime!;expect(binding.command).toEqual([process.execPath]);
  expect(binding.transformations?.some(item=>item.kind==='separated-executable-list'&&JSON.stringify(item.original)==='["node","npm"]')).toBe(true);
  expect(operationalInvocations(prepared.operational).map(item=>item.aliases)).toEqual([['node'],['npm']]);
  const consumer=await executeCommand(applyOperationalEnvironment({cwd:root,command:['node','--version']},prepared.operational));expect(consumer.exitCode).toBe(0);
  const packageManager=await executeCommand(applyOperationalEnvironment({cwd:root,command:['npm','--version']},prepared.operational));expect(packageManager.exitCode).toBe(0);
  const resumed=await prepareEnvironmentNode(root,node,brief,execute,{previous:JSON.parse(JSON.stringify(prepared.cache))});expect(resumed.ready).toBe(true);expect(resumed.operational.revision).toBe(prepared.operational.revision);expect(calls).toBe(2);
});
it('keeps interpreter arguments intact and only rewrites the matching argv prefix',async()=>{
  const root=await workspace();await writeFile(join(root,'tool.mjs'),'console.log(process.argv.slice(2).join(" "))');
  const node=prerequisite({command:['node','tool.mjs']},{command:'node',args:['tool.mjs','--version']});
  const prepared=await prepareEnvironmentNode(root,node,brief,executeCommand);expect(prepared.ready).toBe(true);
  const consumer=applyOperationalEnvironment({cwd:root,command:['node','tool.mjs','one']},prepared.operational);
  expect(consumer.command).toEqual([process.execPath,'tool.mjs','one']);expect((await executeCommand(consumer)).stdout.trim()).toBe('one');
  expect(applyOperationalEnvironment({cwd:root,command:'node tool.mjs "two words"'},prepared.operational).command).toBe(`'${process.execPath}' 'tool.mjs' "two words"`);
  expect(operationalInvocations(prepared.operational).flatMap(item=>item.aliases??[])).not.toContain('node');
  expect(applyOperationalEnvironment({cwd:root,command:['node','--version']},prepared.operational).command).toEqual(['node','--version']);
});
it('publishes explicit aliases for compound commands without hijacking their interpreter or readiness executable',async()=>{
  const root=await workspace();await writeFile(join(root,'tool.mjs'),'console.log("fixture-version")');
  const node=prerequisite({command:['node','tool.mjs'],aliases:['fixture-cli']},{command:'fixture-cli',args:['--version']});
  const prepared=await prepareEnvironmentNode(root,node,brief,executeCommand);expect(prepared.ready).toBe(true);
  expect((await executeCommand(applyOperationalEnvironment({cwd:root,command:['fixture-cli','--version']},prepared.operational))).stdout).toContain('fixture-version');
  expect(applyOperationalEnvironment({cwd:root,command:['node','--version']},prepared.operational).command).toEqual(['node','--version']);
});
it('normalizes separate invocation declarations and recovers legacy independent command strings',async()=>{
  const root=await workspace();await writeFile(join(root,'one.mjs'),'console.log("one")');await writeFile(join(root,'two.mjs'),'console.log("two")');
  const normalized=normalizeEnvironment([{...prerequisite({command:['node','one.mjs'],aliases:['first'],invocations:[{command:['node','two.mjs'],aliases:['second']}]},{command:'first',args:[]})}],brief)[0]!;
  expect(normalized.provides?.invocations).toEqual([{command:['node','two.mjs'],aliases:['second']}]);
  const structured=await prepareEnvironmentNode(root,normalized,brief,executeCommand);expect(structured.ready).toBe(true);
  expect((await executeCommand(applyOperationalEnvironment({cwd:root,command:['second']},structured.operational))).stdout.trim()).toBe('two');
  const legacy=await prepareEnvironmentNode(root,prerequisite({command:['node one.mjs','node two.mjs']}),brief,executeCommand);expect(legacy.ready).toBe(true);
  expect(legacy.operational.bindings.runtime?.invocations?.[0]?.command).toEqual([process.execPath,'two.mjs']);
  expect((await executeCommand(applyOperationalEnvironment({cwd:root,command:['node','two.mjs']},legacy.operational))).stdout.trim()).toBe('two');
});
it('does not export source files into PATH or unconsumed product descriptions as provider configuration',async()=>{
  const root=await workspace();await mkdir(join(root,'src'));await writeFile(join(root,'src','api.mjs'),'console.log("api")');
  const node=prerequisite({command:['node'],paths:['src/api.mjs'],env:{PORT:'the local HTTP server port',DATABASE_PATH:'path to the SQLite file'}});
  const prepared=await prepareEnvironmentNode(root,node,brief,executeCommand);expect(prepared.ready).toBe(false);expect(prepared.results).toHaveLength(0);
  expect(prepared.incidents[0]?.kind).toBe('planning');expect(prepared.operational.env.PORT).toBeUndefined();expect(prepared.operational.env.DATABASE_PATH).toBeUndefined();
  expect(prepared.operational.env.PATH?.split(':')).not.toContain(join(root,'src','api.mjs'));
  expect(prepared.operational.bindings.runtime?.transformations?.some(item=>item.kind==='discarded-non-directory-path')).toBe(true);
});
it('exports concrete provider values consumed by its readiness operation',async()=>{
  const root=await workspace();
  const prepared=await prepareEnvironmentNode(root,prerequisite({command:['node'],env:{FIXTURE_PROVIDER_VALUE:'concrete value'}},{command:'node',args:['-e','if(process.env.FIXTURE_PROVIDER_VALUE!=="concrete value")process.exit(1)']}),brief,executeCommand);
  expect(prepared.ready).toBe(true);expect(prepared.operational.env.FIXTURE_PROVIDER_VALUE).toBe('concrete value');expect(prepared.results).toHaveLength(1);
});
it('does not rediscover stale harness wrappers as a newly installed local provider',async()=>{
  const root=await workspace();await mkdir(join(root,'.capivara-runtime','bin'),{recursive:true});await writeFile(join(root,'.capivara-runtime','bin','fixture_unknown_provider'),'#!/bin/sh\nexit 0\n',{mode:0o755});
  const node=prerequisite(undefined,{command:'fixture_unknown_provider',args:['--version']});node.prepare=[];
  expect((await prepareEnvironmentNode(root,node,brief,executeCommand)).ready).toBe(false);
});
it('does not approve a failing compound provider from a successful interpreter version probe',async()=>{
  const root=await workspace();await writeFile(join(root,'broken.mjs'),'process.exit(7)');
  const node=prerequisite({command:['node','broken.mjs']});node.prepare=[];
  const prepared=await prepareEnvironmentNode(root,node,brief,executeCommand);expect(prepared.ready).toBe(false);
  expect(prepared.results.every(result=>result.exitCode===7)).toBe(true);
  expect(prepared.operational.bindings.runtime?.command).toEqual([process.execPath,'broken.mjs']);
});
