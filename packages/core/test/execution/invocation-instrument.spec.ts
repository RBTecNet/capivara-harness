import { afterEach, expect, it } from 'vitest';
import { mkdtemp, writeFile, rm, readFile, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { prepareInvocationInstrument } from '../../src/execution/invocation-instrument.js';
import { applyOperationalEnvironment, emptyOperationalEnvironment, OperationalInvocationConflict, type OperationalEnvironment } from '../../src/execution/environment.js';
import { runBuild } from '../../src/execution/build.js';
import { executeCommand } from '../../src/runtime/index.js';
import type { DevelopmentPlan, ProductBrief, WorkUnit } from '../../src/domain/types.js';
const temporary:string[]=[];
afterEach(async()=>{await Promise.all(temporary.splice(0).map(path=>rm(path,{recursive:true,force:true})));});
async function workspace():Promise<string>{const root=await mkdtemp(join(tmpdir(),'capivara-instrument-'));temporary.push(root);return root;}
function operational(root:string):OperationalEnvironment{return{...emptyOperationalEnvironment(root),bindings:{runtime:{capability:'runtime',kind:'runtime',provider:'selected',ready:true,command:[process.execPath],aliases:['node']}}};}
it('recovers a file occupying its runtime directory without discarding the obstruction',async()=>{
  const root=await workspace();await writeFile(join(root,'.capivara-runtime'),'preserve this diagnostic');
  const prepared=await prepareInvocationInstrument(root,operational(root));expect(prepared.repairs).toHaveLength(1);
  expect(await readFile(prepared.repairs[0]!.quarantined!,'utf8')).toBe('preserve this diagnostic');
  const consumer=await executeCommand({cwd:root,command:['node','--version'],environment:prepared.environment});expect(consumer.exitCode).toBe(0);
  expect(await readFile(join(root,'.capivara-runtime/bin/node'),'utf8')).not.toContain("'npm'");
});
it.skipIf(process.platform==='win32')('replaces a runtime symlink without changing its external target',async()=>{
  const root=await workspace(),external=await workspace();await writeFile(join(external,'keep'),'unchanged');await symlink(external,join(root,'.capivara-runtime'),'dir');
  const prepared=await prepareInvocationInstrument(root,operational(root));expect(prepared.repairs).toHaveLength(1);
  expect(await readFile(join(external,'keep'),'utf8')).toBe('unchanged');await expect(readFile(join(external,'bin/node'))).rejects.toMatchObject({code:'ENOENT'});
});
it('rejects conflicting provider aliases with the same classification in execution and wrapper publication',async()=>{
  const root=await workspace(),environment=operational(root);environment.bindings.other={capability:'other',kind:'cli',provider:'different',ready:true,command:[process.execPath,'other.mjs'],aliases:['node']};
  expect(()=>applyOperationalEnvironment({cwd:root,command:['node','--version']},environment)).toThrow(OperationalInvocationConflict);
  await expect(prepareInvocationInstrument(root,environment)).rejects.toMatchObject({kind:'instrument',alias:'node'});
  await expect(readFile(join(root,'.capivara-runtime/bin/node'))).rejects.toMatchObject({code:'ENOENT'});
});
it('continues through an unusable optional alias and persists its audit without changing the concrete provider',async()=>{
  const root=await workspace();let calls=0;
  const brief:ProductBrief={schema:'capivara/product/1',status:'ready',id:'b',revision:1,name:'Fixture',summary:'CLI',request:'Print ok',modes:['cli'],targets:['portable'],requirements:[{id:'r',statement:'Print ok',mode:'cli',source:{kind:'request',reference:'request',text:'Print ok'}}],constraints:[],decisions:[],gaps:[]};
  const unit:WorkUnit={id:'t',title:'CLI',goal:'Print ok',instructions:'Print ok',requirementIds:['r'],dependsOn:[],environmentIds:['runtime'],contractIds:[],files:['app.mjs'],criteria:['Print ok'],checks:[{id:'c',kind:'cli',command:process.execPath,args:['app.mjs'],expected:'contains:ok',requirementIds:['r'],requiredCapabilities:[]}],risk:'normal',blockedBy:[]};
  const plan:DevelopmentPlan={schema:'capivara/plan/1',status:'ready',revision:1,briefId:'b',briefRevision:1,contracts:[],tasks:[unit],environment:[{id:'runtime',name:'Runtime',kind:'runtime',identity:{capability:'runtime',kind:'runtime',provider:'selected'},dependsOn:[],targets:['portable'],reason:'Runs CLI',check:{command:process.execPath,args:['--version']},prepare:[],provides:{command:[process.execPath],aliases:['x'.repeat(300)]}}]};
  const result=await runBuild({workspace:root,brief,plan,signal:AbortSignal.timeout(3000),agent:async request=>{calls++;if(request.role==='editor')await writeFile(join(request.workspace,'app.mjs'),'console.log(\"ok\");');return{status:'complete',text:request.role==='reviewer'?'{\"approved\":true,\"findings\":[]}':'',commands:[],changedFiles:[]};}});
  expect(result.status,JSON.stringify(result.incidents)).toBe('complete');expect(calls).toBe(2);expect(result.state.metrics?.active).toBe(0);expect(result.state.metrics?.callsByRole).toEqual({editor:1,reviewer:1});
  const actions=result.state.tasks.t!.actions!;expect(actions.every(action=>action.outcome!=='running'&&action.result&&!action.result.issue)).toBe(true);
  expect(result.state.evidence.some(proof=>proof.passed&&proof.checkId==='c')).toBe(true);
  const durable=JSON.parse(JSON.stringify(result.state));expect(durable.tasks.t.actions.some((action:{instrumentRepairs?:{action:string;reason:string;alias:string;invocation:string[]}[]})=>action.instrumentRepairs?.some(repair=>repair.action==='omit-optional-alias'&&repair.reason.includes('ENAMETOOLONG')&&repair.alias==='x'.repeat(300)&&repair.invocation[0]===process.execPath))).toBe(true);
  expect((result.state.environment.runtime!.operational as {bindings:Record<string,{command:string[]}>}).bindings.runtime!.command).toEqual([process.execPath]);
});
it.skipIf(process.platform==='win32')('restores read-only source without following a substituted file or parent-directory symlink',async()=>{
  const {mkdir}=await import('node:fs/promises');
  const {snapshot,changedSince,restoreFiles}=await import('../../src/execution/files.js');
  for(const replaceParent of [false,true]){
    const root=await workspace(),external=await workspace();await mkdir(join(root,'src'));await writeFile(join(root,'src','app.mjs'),'original source');await writeFile(join(external,'app.mjs'),'external source');
    const before=await snapshot(root);
    if(replaceParent){await rm(join(root,'src'),{recursive:true});await symlink(external,join(root,'src'),'dir');}
    else{await rm(join(root,'src','app.mjs'));await symlink(join(external,'app.mjs'),join(root,'src','app.mjs'),'file');}
    await restoreFiles(root,before,await changedSince(root,before));
    expect(await readFile(join(root,'src','app.mjs'),'utf8')).toBe('original source');expect(await readFile(join(external,'app.mjs'),'utf8')).toBe('external source');
  }
});
it('preserves a required instrument filesystem failure instead of treating it as an optional alias',async()=>{
  const root=await workspace(),blocked=join(root,'not-a-workspace');await writeFile(blocked,'existing user file');
  await expect(prepareInvocationInstrument(blocked,operational(blocked))).rejects.toMatchObject({code:'ENOTDIR'});
  expect(await readFile(blocked,'utf8')).toBe('existing user file');
});
