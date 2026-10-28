import { afterEach, expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm, chmod, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { DevelopmentPlan, EnvironmentNode, ProductBrief, WorkUnit } from '../../src/domain/types.js';
import { executeCommand, runTerminal } from '../../src/runtime/index.js';
import { inputHash } from '../../src/execution/files.js';
import { checkInputHash, derivedChecks, runVerification, verificationLevel } from '../../src/execution/checks.js';
import { applyOperationalEnvironment, capabilitySatisfied, relocateOperationalEnvironment, prepareEnvironmentNode, prepareProjectDependencies, mergeOperationalEnvironments } from '../../src/execution/environment.js';
const temporary:string[]=[];
afterEach(async()=>{await Promise.all(temporary.splice(0).map(path=>rm(path,{recursive:true,force:true})));});
async function workspace():Promise<string>{const root=await mkdtemp(join(tmpdir(),'capivara-env-proof-'));temporary.push(root);return root;}
const brief:ProductBrief={schema:'capivara/product/1',status:'ready',id:'b',revision:1,name:'fixture',summary:'fixture',request:'CLI prints ok',modes:['cli'],targets:['portable'],requirements:[],constraints:[],decisions:[],gaps:[]};
const task:WorkUnit={id:'cli',title:'CLI',goal:'Print ok',instructions:'Print ok',requirementIds:[],dependsOn:[],environmentIds:[],contractIds:[],files:[],criteria:['Print ok'],checks:[],risk:'normal',blockedBy:[]};
const plan:DevelopmentPlan={schema:'capivara/plan/1',status:'ready',revision:1,briefId:'b',briefRevision:1,environment:[],contracts:[],tasks:[task]};
it('fingerprints explicit globs, new matching files and explicitly declared generated inputs',async()=>{
  const root=await workspace();await mkdir(join(root,'src'));await mkdir(join(root,'dist'));
  await writeFile(join(root,'src','one.ts'),'export const value=1;');await writeFile(join(root,'dist','client.js'),'first');
  const before=await inputHash(root,['src/**/*.ts','dist/client.js']);await writeFile(join(root,'src','two.ts'),'export const second=2;');
  const added=await inputHash(root,['src/**/*.ts','dist/client.js']);expect(added).not.toBe(before);
  await writeFile(join(root,'dist','client.js'),'second');expect(await inputHash(root,['src/**/*.ts','dist/client.js'])).not.toBe(added);
  if(process.platform!=='win32'){const beforeMode=await inputHash(root,['dist/client.js']);await chmod(join(root,'dist','client.js'),0o755);expect(await inputHash(root,['dist/client.js'])).not.toBe(beforeMode);}
});
it('does not invalidate a declared proof after unrelated documentation changes and detects its source changes',async()=>{
  const root=await workspace();await mkdir(join(root,'src'));await writeFile(join(root,'src','cli.mjs'),'console.log("ok")');await writeFile(join(root,'README.md'),'old');
  const check={id:'behavior',kind:'cli' as const,command:process.execPath,args:['src/cli.mjs'],inputs:['src/cli.mjs'],expected:'contains:ok',requirementIds:[],requiredCapabilities:[]};
  const before=await checkInputHash(root,plan,task,check,brief);await writeFile(join(root,'README.md'),'new');expect(await checkInputHash(root,plan,task,check,brief)).toBe(before);
  await writeFile(join(root,'src','cli.mjs'),'console.log("changed")');expect(await checkInputHash(root,plan,task,check,brief)).not.toBe(before);
});
it('recognizes a locally prepared executable and returns invocation usable by the consumer',async()=>{
  if(process.platform==='win32')return;const root=await workspace();
  const node:EnvironmentNode={id:'fixture-cli',name:'Fixture CLI',kind:'tool',dependsOn:[],targets:['portable'],reason:'Needed CLI',identity:{capability:'fixture-query',kind:'cli',provider:'fixture'},check:{command:'fixture_query_cli',args:['--version']},prepare:[{command:process.execPath,args:['-e',"require('fs').mkdirSync('.tools/bin',{recursive:true});require('fs').writeFileSync('.tools/bin/fixture_query_cli','#!/bin/sh\\nprintf fixture-version\\n',{mode:0o755});"]}]};
  const result=await prepareEnvironmentNode(root,node,brief,executeCommand);expect(result.ready).toBe(true);
  const consumer=await executeCommand(applyOperationalEnvironment({cwd:root,command:['fixture_query_cli','--version']},result.operational));
  expect(consumer.exitCode).toBe(0);expect(consumer.stdout).toContain('fixture-version');
  const relocated=relocateOperationalEnvironment(result.operational,root,`${root}-private`);expect(relocated.revision).toBe(result.operational.revision);
  expect(capabilitySatisfied(result.operational.bindings['fixture-query'],{capability:'fixture-query',kind:'cli'})).toBe(true);
  expect(capabilitySatisfied({...result.operational.bindings['fixture-query']!,kind:'driver'},{capability:'fixture-query',kind:'cli'})).toBe(false);
  const check={id:'provider',kind:'cli' as const,command:'fixture_query_cli',args:['--version'],expected:'contains:fixture-version',requirementIds:[],requiredCapabilities:[]};
  const previousProof=await checkInputHash(root,plan,task,check,brief,result.operational);
  await writeFile(join(root,'.tools','bin','fixture_query_cli'),'#!/bin/sh\nprintf updated-version\n',{mode:0o755});
  const updated=await prepareEnvironmentNode(root,node,brief,executeCommand,{previous:result.cache});expect(updated.ready).toBe(true);expect(updated.operational.revision).not.toBe(result.operational.revision);
  expect(await checkInputHash(root,plan,task,check,brief,updated.operational)).not.toBe(previousProof);
});
it('attributes a write restriction to the instrument instead of the product',async()=>{
  const root=await workspace();const check={id:'restricted',kind:'cli' as const,command:process.execPath,args:['cli.mjs'],expected:'contains:ok',requirementIds:[],requiredCapabilities:[]};
  const execute:typeof executeCommand=async request=>({command:String(request.command),cwd:root,exitCode:1,stdout:'',stderr:'EROFS: read-only file system, mkdir /tmp/test-run',durationMs:1,timedOut:false,cancelled:false,signal:null,fingerprint:'sandbox'});
  const failure=await runVerification(root,brief,task,plan,check,execute,runTerminal,{instrument:{purpose:'verification',writeScope:'read-only',sandboxApplied:true}});
  expect(failure.needsInstrument).toBe(true);expect(failure.evidence.passed).toBe(false);
  const product=await runVerification(root,brief,task,plan,check,execute,runTerminal);expect(product.classification).toBe('product');
});
it('does not pass a functional assertion from an exit code alone',async()=>{
  const root=await workspace();const check={id:'behavior',kind:'cli' as const,command:process.execPath,args:['-e','console.log("placeholder")'],expected:'The selected record is saved and can be reopened.',requirementIds:[],requiredCapabilities:[]};
  const result=await runVerification(root,brief,task,plan,check,executeCommand,runTerminal);expect(result.evidence.passed).toBe(false);expect(result.needsInstrument).toBe(true);
  const concrete=await runVerification(root,brief,task,plan,{...check,expected:'contains:correct'},executeCommand,runTerminal);expect(concrete.classification).toBe('product');
});
it('keeps production build evidence distinct from a successful syntax/type check',async()=>{
  const root=await workspace();await writeFile(join(root,'package.json'),JSON.stringify({scripts:{typecheck:'tsc --noEmit',build:'vite build'}}));
  const checks=await derivedChecks(root,task);expect(checks.some(check=>check.command==='npm run build')).toBe(true);
});

it('persists ineffective preparation, avoids replay and revalidates after a relevant local provider appears',async()=>{
  if(process.platform==='win32')return;const root=await workspace();let commands=0;
  const execute:typeof executeCommand=async request=>{commands++;return executeCommand(request);};
  const node:EnvironmentNode={id:'missing',name:'Required executable',kind:'tool',identity:{capability:'required-tool',kind:'cli',provider:'local'},dependsOn:[],targets:['portable'],reason:'Concrete CLI',check:{command:'fixture_missing_cli',args:['--version']},prepare:[{command:process.execPath,args:['-e','process.exit(0)']}]};
  const failed=await prepareEnvironmentNode(root,node,brief,execute);expect(failed.ready).toBe(false);expect(failed.cache.noProgress).toBe(true);
  const count=commands;
  const resumed=await prepareEnvironmentNode(root,node,brief,execute,{previous:JSON.parse(JSON.stringify(failed.cache))});expect(resumed.ready).toBe(false);expect(commands).toBe(count);
  await mkdir(join(root,'.tools','bin'),{recursive:true});await writeFile(join(root,'.tools','bin','fixture_missing_cli'),'#!/bin/sh\nprintf recovered\n',{mode:0o755});
  const recovered=await prepareEnvironmentNode(root,node,brief,execute,{previous:resumed.cache});expect(recovered.ready).toBe(true);expect(commands).toBe(count+1);
  const reused=await prepareEnvironmentNode(root,node,brief,execute,{previous:recovered.cache});expect(reused.ready).toBe(true);expect(commands).toBe(count+1);
  await rm(join(root,'.tools','bin','fixture_missing_cli'));
  const removed=await prepareEnvironmentNode(root,node,brief,execute,{previous:reused.cache});expect(removed.ready).toBe(false);expect(commands).toBeGreaterThan(count+1);
});
it('tracks imported implementation but ignores manifests belonging to an unrelated stack',async()=>{
  const root=await workspace();await mkdir(join(root,'src'));await writeFile(join(root,'src','main.mjs'),"import {value} from './value.mjs'; console.log(value)");await writeFile(join(root,'src','value.mjs'),'export const value=1');
  const check={id:'behavior',kind:'cli' as const,command:process.execPath,args:['src/main.mjs'],expected:'contains:1',requirementIds:[],requiredCapabilities:[]};
  const before=await checkInputHash(root,plan,task,check,brief);await writeFile(join(root,'Cargo.toml'),'[package]\nname="unrelated"');expect(await checkInputHash(root,plan,task,check,brief)).toBe(before);
  await writeFile(join(root,'src','value.mjs'),'export const value=2');expect(await checkInputHash(root,plan,task,check,brief)).not.toBe(before);
  await mkdir(join(root,'node_modules','local-provider'),{recursive:true});await writeFile(join(root,'node_modules','local-provider','package.json'),'{"name":"local-provider","main":"index.js"}');await writeFile(join(root,'node_modules','local-provider','index.js'),'module.exports=1;');
  await writeFile(join(root,'src','main.mjs'),"import value from 'local-provider';console.log(value)");const packageProof=await checkInputHash(root,plan,task,check,brief);
  await writeFile(join(root,'node_modules','local-provider','index.js'),'module.exports=2;');expect(await checkInputHash(root,plan,task,check,brief)).not.toBe(packageProof);
});

it('keeps dependency invocation revisions stable across cache reuse and private workspace relocation',async()=>{
  const root=await workspace();await mkdir(join(root,'node_modules','.bin'),{recursive:true});await writeFile(join(root,'package.json'),'{"name":"dependency-free"}');
  const first=await prepareProjectDependencies(root,brief,executeCommand);
  const second=await prepareProjectDependencies(root,brief,executeCommand,{previous:first.cache,operational:first.operational});expect(second.operational.revision).toBe(first.operational.revision);
  const relocated=relocateOperationalEnvironment(second.operational,root,`${root}-private`);expect(relocated.revision).toBe(second.operational.revision);
});

it('scopes preparation and installed provider observations to the consumer in a mixed-stack project',async()=>{
  const root=await workspace();await mkdir(join(root,'src'));await writeFile(join(root,'src','main.mjs'),'console.log("ok")');await writeFile(join(root,'package.json'),'{"name":"node-consumer"}');await writeFile(join(root,'Cargo.toml'),'[package]\nname="rust-consumer"\nversion="0.1.0"');
  const check={id:'behavior',kind:'cli' as const,command:process.execPath,args:['src/main.mjs'],expected:'contains:ok',requirementIds:[],requiredCapabilities:[]};
  const commands:string[]=[];const execute:typeof executeCommand=async request=>{commands.push(String(request.command));return{command:String(request.command),cwd:root,exitCode:0,stdout:'',stderr:'',durationMs:0,timedOut:false,cancelled:false,signal:null,fingerprint:'fixture'};};
  const first=await prepareProjectDependencies(root,brief,execute,{inputs:['src/main.mjs'],checks:[check]});expect(first.ready).toBe(true);expect(commands.some(command=>command.includes('cargo'))).toBe(false);
  const ownTask={...task,files:['src/main.mjs']};const ownPlan={...plan,tasks:[ownTask]};
  const before=await checkInputHash(root,ownPlan,ownTask,check,brief,first.operational);
  await writeFile(join(root,'Cargo.toml'),'[package]\nname="rust-consumer"\nversion="0.2.0"');
  const unrelated=await prepareProjectDependencies(root,brief,execute,{inputs:['src/main.mjs'],checks:[check],previous:JSON.parse(JSON.stringify(first.cache))});
  expect(await checkInputHash(root,ownPlan,ownTask,check,brief,unrelated.operational)).toBe(before);expect(commands).toHaveLength(0);
  await mkdir(join(root,'node_modules'),{recursive:true});await writeFile(join(root,'node_modules','.package-lock.json'),'{"packages":{"node_modules/required-provider":{"version":"2.0.0"}}}');
  const changed=await prepareProjectDependencies(root,brief,execute,{inputs:['src/main.mjs'],checks:[check],previous:unrelated.cache});expect(await checkInputHash(root,ownPlan,ownTask,check,brief,changed.operational)).not.toBe(before);
});

it.skipIf(process.platform==='win32')('keeps selected runtime identity while invoking its validated project virtual environment',async()=>{
  const root=await workspace();const discovery=await executeCommand({cwd:root,command:['python3','-c','import sys; print(sys.executable)']});expect(discovery.exitCode).toBe(0);const executable=discovery.stdout.trim();
  expect((await executeCommand({cwd:root,command:[executable,'-m','venv','--without-pip','.venv']})).exitCode).toBe(0);
  await writeFile(join(root,'pyproject.toml'),'[tool.fixture]\nvalue=true');
  const node:EnvironmentNode={id:'python',name:'Selected Python',kind:'runtime',identity:{capability:'python',kind:'runtime',provider:'selected-python'},provides:{command:[executable]},dependsOn:[],targets:['portable'],reason:'Required runtime',check:{command:executable,args:['--version']},prepare:[]};
  const selected=await prepareEnvironmentNode(root,node,brief,executeCommand);expect(selected.ready).toBe(true);
  const project=await prepareProjectDependencies(root,brief,executeCommand,{inputs:['main.py']});expect(project.ready).toBe(true);
  const merged=mergeOperationalEnvironments(root,project.operational,selected.operational);expect(merged.bindings.python?.provider).toBe('selected-python');
  const result=await executeCommand(applyOperationalEnvironment({cwd:root,command:['python3','-c','import sys; print(sys.prefix)']},merged));expect(result.exitCode).toBe(0);expect(result.stdout.trim()).toBe(join(root,'.venv'));
  const repeated=await prepareProjectDependencies(root,brief,executeCommand,{inputs:['main.py'],operational:merged,previous:project.cache});expect(repeated.operational).toEqual(merged);expect(repeated.operational.revision).toBe(merged.revision);
  const reverse=mergeOperationalEnvironments(root,selected.operational,project.operational);expect(reverse.revision).toBe(merged.revision);
});

it('distinguishes actual syntax operations from words and flags belonging to an application',()=>{
  const common={id:'level',kind:'command' as const,requirementIds:[],requiredCapabilities:[]};
  expect(verificationLevel({...common,command:process.execPath,args:['-e',"console.log('build')"]})).toBe('behavior');
  expect(verificationLevel({...common,command:'custom-app',args:['--check']})).toBe('behavior');
  expect(verificationLevel({...common,command:process.execPath,args:['cli.js','--check']})).toBe('behavior');
  expect(verificationLevel({...common,command:process.execPath,args:['--check','cli.js'],level:'behavior'})).toBe('syntax');
});

it('excludes newly produced artifacts from implicit build inputs while keeping explicit artifact consumers current',async()=>{
  const root=await workspace();await mkdir(join(root,'src'));await mkdir(join(root,'dist'));await writeFile(join(root,'src','value.js'),'export const value=1;');await writeFile(join(root,'build.mjs'),'// SDK build recipe');
  const unit={...task,files:['src','dist']};const productPlan={...plan,tasks:[unit]};
  const producer={id:'build',kind:'command' as const,command:process.execPath,args:['build.mjs'],level:'build' as const,outputs:['dist/client.js'],requirementIds:[],requiredCapabilities:[]};
  const before=await checkInputHash(root,productPlan,unit,producer,brief);await writeFile(join(root,'dist','client.js'),'built-one');expect(await checkInputHash(root,productPlan,unit,producer,brief)).toBe(before);
  const consumer={id:'interaction',kind:'cli' as const,command:process.execPath,args:['dist/client.js'],inputs:['dist/client.js'],expected:'contains:one',requirementIds:[],requiredCapabilities:[]};
  const consumed=await checkInputHash(root,productPlan,unit,consumer,brief);await writeFile(join(root,'dist','client.js'),'built-two');expect(await checkInputHash(root,productPlan,unit,consumer,brief)).not.toBe(consumed);
});

it.skipIf(process.platform==='win32')('canonicalizes internal package aliases and terminates self-referencing import graphs',async()=>{
  const root=await workspace();await mkdir(join(root,'src'));await mkdir(join(root,'node_modules'));await writeFile(join(root,'package.json'),'{"name":"self-fixture","exports":"./src/main.mjs","type":"module"}');
  await writeFile(join(root,'src','main.mjs'),"export {value} from './value.mjs'; import 'self-fixture';");await writeFile(join(root,'src','value.mjs'),'export const value=1;');
  const link=join(root,'node_modules','self-fixture');await symlink(root,link,'dir');
  const check={id:'behavior',kind:'cli' as const,command:process.execPath,args:['src/main.mjs'],expected:'exit:0',requirementIds:[],requiredCapabilities:[]};
  const first=await checkInputHash(root,plan,task,check,brief);await rm(link);await symlink('..',link,'dir');expect(await checkInputHash(root,plan,task,check,brief)).toBe(first);
  await writeFile(join(root,'src','value.mjs'),'export const value=2;');expect(await checkInputHash(root,plan,task,check,brief)).not.toBe(first);
});
