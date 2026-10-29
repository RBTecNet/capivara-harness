import { afterEach, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DevelopmentPlan, ProductBrief, WorkUnit } from '../../src/domain/types.js';
import { createBuildState, runBuild } from '../../src/execution/build.js';
import { interpretReview } from '../../src/execution/review.js';
import { createTaskWorkspace, refreshWorkspaceInputs } from '../../src/execution/isolation.js';
import { digest, sourceFiles } from '../../src/execution/files.js';
import { repairWorkPlan } from '../../src/domain/plan.js';
import type { TaskProgress } from '../../src/execution/types.js';
import type { AgentResult } from '../../src/runtime/types.js';

const roots:string[]=[];
afterEach(async()=>{await Promise.all(roots.splice(0).map(root=>rm(root,{recursive:true,force:true})));});
const complete=(text=''):AgentResult=>({status:'complete',text,commands:[],changedFiles:[]});
const brief:ProductBrief={schema:'capivara/product/1',id:'b',revision:1,status:'ready',name:'CLI',summary:'Print a value.',request:'Create a CLI that prints ready.',modes:['cli'],targets:['portable'],requirements:[{id:'r',statement:'The CLI prints ready.',mode:'cli',source:{kind:'request',reference:'request',text:'The CLI prints ready.'}}],constraints:[],decisions:[],gaps:[]};
const task:WorkUnit={id:'delivery',title:'CLI',goal:'Print ready.',instructions:'Implement cli.mjs.',requirementIds:['r'],dependsOn:[],environmentIds:[],contractIds:[],files:['cli.mjs'],criteria:['The CLI prints ready.'],checks:[{id:'cli',kind:'cli',level:'behavior',command:process.execPath,args:['cli.mjs'],assertion:{type:'contains',source:'stdout',value:'ready'},requirementIds:['r'],requiredCapabilities:[]}],risk:'normal',blockedBy:[]};
const plan:DevelopmentPlan={schema:'capivara/plan/1',status:'ready',revision:1,briefId:'b',briefRevision:1,environment:[],contracts:[],tasks:[task]};

it('checks actual partial files after a recoverable transport timeout instead of suspending completed code',async()=>{
  const workspace=await mkdtemp(join(tmpdir(),'capivara-partial-timeout-'));roots.push(workspace);let edits=0,reviews=0;
  const result=await runBuild({workspace,brief:structuredClone(brief),plan:structuredClone(plan),agent:async request=>{
    if(request.role==='editor'){edits++;await writeFile(join(request.workspace,'cli.mjs'),"console.log('ready');\n");return{status:'partial',text:'Transport deadline reached after the code was written.',commands:[],changedFiles:[],issue:{kind:'transport',recoverable:true,message:'The transport timed out.'}};}
    if(request.role==='reviewer'){reviews++;return complete('{"approved":true,"findings":[]}');}
    throw Error('Completed partial code must be checked before another edit.');
  }});
  expect(result.status,JSON.stringify(result.incidents)).toBe('complete');expect({edits,reviews}).toEqual({edits:1,reviews:1});
  expect(await readFile(join(workspace,'cli.mjs'),'utf8')).toContain('ready');
  expect(result.state.tasks.delivery?.actions?.[0]?.result?.issue?.kind).toBe('transport');
  expect(result.state.evidence.some(proof=>proof.passed&&proof.checkId==='cli')).toBe(true);
});

it('reconciles a missing producer and refreshes its publication while preserving the consumer partial code',async()=>{
  const workspace=await mkdtemp(join(tmpdir(),'capivara-producer-resume-'));roots.push(workspace);
  const consumer={...structuredClone(task),id:'consumer',instructions:'Consume the existing provider through its interface.'};
  const provider:WorkUnit={...structuredClone(task),id:'provider',title:'Provider',goal:'Provide the imported ready value.',files:['provider.mjs'],checks:[{...task.checks[0]!,id:'provider-cli',args:['provider.mjs']}]};
  const original:DevelopmentPlan={...structuredClone(plan),tasks:[consumer,provider]},state=createBuildState(original);
  const checkpoint=await createTaskWorkspace(workspace,consumer.id,digest(JSON.stringify(consumer)),consumer.files);
  const partial="import {value} from './provider.mjs';console.log(value);\n";
  await writeFile(join(checkpoint.directory,'cli.mjs'),partial);checkpoint.phase='reviewing';
  const review=interpretReview(JSON.stringify({approved:false,findings:[{kind:'product',file:'cli.mjs',observed:'The unfinished provider is missing.',expected:'Consume provider before running this CLI.',fix:'Wait for provider and import its actual interface.'}]}));
  state.tasks.consumer={status:'waiting',revision:'old',attempts:1,changedFiles:['cli.mjs'],findings:[],strategy:'clarify-review',actions:[],reviews:[{inputHash:'old',at:new Date().toISOString(),assessment:review}],noProgress:0,checkpoint} satisfies TaskProgress;
  let producerEdits=0,consumerEdits=0,reconciliations=0;
  const result=await runBuild({workspace,brief:structuredClone(brief),plan:original,state,maxConcurrent:2,repairPlan:async(incident,unit)=>{
    expect(incident.repairScope).toBe('dependencies');expect(unit.id).toBe('consumer');reconciliations++;
    expect(producerEdits).toBe(0);
    return repairWorkPlan({brief:structuredClone(brief),plan:original,taskId:unit.id,problem:incident.evidence,repairScope:'dependencies',agent:async()=>JSON.stringify({dependsOn:['provider'],inputs:['provider.mjs'],reason:'Actual imported provider must publish before its consumer.'})});
  },agent:async request=>{
    if(request.role==='reviewer')return complete('{"approved":true,"findings":[]}');
    if(request.context?.includes('Work unit provider:')){producerEdits++;await writeFile(join(request.workspace,'provider.mjs'),"export const value='ready';console.log(value);\n");return complete();}
    consumerEdits++;throw Error('Private consumer code must survive reconciliation and receive the published provider.');
  }});
  expect(result.status,JSON.stringify(result.incidents)).toBe('complete');
  expect({producerEdits,consumerEdits,reconciliations}).toEqual({producerEdits:1,consumerEdits:0,reconciliations:1});
  expect(await readFile(join(workspace,'cli.mjs'),'utf8')).toBe(partial);
  expect(result.plan.tasks.find(unit=>unit.id==='consumer')!.dependsOn).toContain('provider');
  expect(result.state.metrics?.repetitions.some(item=>item.action==='refresh-published-inputs')).toBe(true);
});

it('refreshes removed read inputs and refuses to overwrite a divergent private input',async()=>{
  const workspace=await mkdtemp(join(tmpdir(),'capivara-input-refresh-'));roots.push(workspace);
  await writeFile(join(workspace,'input.txt'),'old');const checkpoint=await createTaskWorkspace(workspace,'consumer','hash',[]);
  await writeFile(join(workspace,'input.txt'),'published');await writeFile(join(checkpoint.directory,'input.txt'),'private');
  await expect(refreshWorkspaceInputs(workspace,checkpoint,['input.txt'])).rejects.toThrow('input.txt');
  expect(await readFile(join(checkpoint.directory,'input.txt'),'utf8')).toBe('private');
  await writeFile(join(checkpoint.directory,'input.txt'),'old');await rm(join(workspace,'input.txt'));
  expect(await refreshWorkspaceInputs(workspace,checkpoint,['input.txt'])).toEqual(['input.txt']);
  await expect(readFile(join(checkpoint.directory,'input.txt'))).rejects.toThrow();
});

it('separates an installed Python environment by protocol while preserving explicit dependency reads',async()=>{
  const workspace=await mkdtemp(join(tmpdir(),'capivara-managed-environment-'));roots.push(workspace);
  const root=join(workspace,'custom-toolchain');await mkdir(join(root,'bin'),{recursive:true});
  await writeFile(join(root,'pyvenv.cfg'),'home = /usr/bin\ninclude-system-site-packages = false\n');
  await writeFile(join(root,'bin/python'),'runtime fixture');await writeFile(join(root,'dependency.py'),'library = True\n');
  await writeFile(join(workspace,'application.py'),'print("ready")\n');
  expect(await sourceFiles(workspace)).toEqual(['application.py']);
  expect(await sourceFiles(workspace,['custom-toolchain/dependency.py'])).toEqual(['custom-toolchain/dependency.py']);
});

it('runs a local operational recovery against preserved files before asking the planner to repeat its obsolete diagnosis',async()=>{
  const workspace=await mkdtemp(join(tmpdir(),'capivara-operational-recovery-'));roots.push(workspace);
  const state=createBuildState(plan),checkpoint=await createTaskWorkspace(workspace,'delivery',digest(JSON.stringify(task)),task.files);
  await writeFile(join(checkpoint.directory,'cli.mjs'),"console.log('ready');\n");checkpoint.phase='checking';
  state.tasks.delivery={status:'waiting',revision:'old',attempts:1,changedFiles:['cli.mjs'],findings:[],strategy:'revalidate-only',actions:[],reviews:[],noProgress:0,checkpoint};
  const incident={id:'old-instrument',kind:'instrument' as const,subject:'delivery',message:'The preceding verification operation needs recovery.',evidence:'Historical instrument diagnosis.',external:false,action:'Recover its actual contract.',repairScope:'verification' as const};
  state.pendingReplans={delivery:incident};state.incidents.push(incident);let reviews=0;
  const result=await runBuild({workspace,brief:structuredClone(brief),plan:structuredClone(plan),state,repairPlan:async()=>{throw Error('A preserved, executable local proof must be checked before another plan proposal.');},agent:async request=>{
    if(request.role!=='reviewer')throw Error('Current executable source must not be rewritten.');reviews++;return complete('{"approved":true,"findings":[]}');
  }});
  expect(result.status,JSON.stringify(result.incidents)).toBe('complete');expect(reviews).toBe(1);
  expect(result.state.pendingReplans?.delivery).toBeUndefined();
  expect(result.state.metrics?.repetitions.some(item=>item.action==='resolve-operational-incident'&&JSON.parse(item.reason).original.id===incident.id)).toBe(true);
  expect(result.state.evidence.some(proof=>proof.passed&&proof.checkId==='cli')).toBe(true);
});

it('continues executable work after an unproductive reconciliation instead of ending at the coordinator',async()=>{
  const workspace=await mkdtemp(join(tmpdir(),'capivara-coordinator-progress-'));roots.push(workspace);
  const independent:WorkUnit={...structuredClone(task),id:'independent',title:'Independent command',goal:'Expose independent readiness.',files:['other.mjs'],checks:[{...task.checks[0]!,id:'other-cli',args:['other.mjs']}]};
  const workPlan={...structuredClone(plan),tasks:[structuredClone(task),independent]},state=createBuildState(workPlan);
  const checkpoint=await createTaskWorkspace(workspace,'delivery',digest(JSON.stringify(task)),task.files);
  await writeFile(join(checkpoint.directory,'cli.mjs'),"console.log('ready');\n");checkpoint.phase='checking';
  state.tasks.delivery={status:'waiting',revision:'old',attempts:1,changedFiles:['cli.mjs'],findings:[],strategy:'revalidate-only',actions:[],reviews:[],noProgress:0,checkpoint};
  state.pendingReplans={delivery:{id:'unresolved-relation',kind:'planning',subject:'delivery',message:'Reconcile the recorded task relation.',evidence:'An older relationship proposal was inconclusive.',external:false,action:'Check the current executable work.',repairScope:'dependencies'}};
  let edits=0,replans=0;
  const result=await runBuild({workspace,brief:structuredClone(brief),plan:workPlan,state,repairPlan:async()=>{replans++;return null;},agent:async request=>{
    if(request.role==='reviewer')return complete('{"approved":true,"findings":[]}');
    if(request.role==='editor'&&request.context?.includes('Work unit independent:')){edits++;await writeFile(join(request.workspace,'other.mjs'),"console.log('ready');\n");return complete();}
    throw Error('The already executable delivery must be checked without another edit.');
  }});
  expect(result.status,JSON.stringify(result.incidents)).toBe('complete');expect({edits,replans}).toEqual({edits:1,replans:1});
  expect(result.completed).toHaveLength(2);expect(result.state.evidence.filter(proof=>proof.passed)).toHaveLength(2);
});
