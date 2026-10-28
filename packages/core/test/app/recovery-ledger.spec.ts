import { afterEach, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runWorkflow } from '../../src/app/workflow.js';
import { ProjectStore } from '../../src/app/store.js';
import { recoverOperation } from '../../src/app/recovery.js';
import { identity } from '../../src/domain/authority.js';
import { createBuildState } from '../../src/execution/build.js';
import { createTaskWorkspace } from '../../src/execution/isolation.js';
import { digest } from '../../src/execution/files.js';
import type { DevelopmentPlan, ProductBrief, WorkUnit } from '../../src/domain/types.js';
import type { BuildState } from '../../src/execution/types.js';

const temporary:string[]=[];
afterEach(async()=>{await Promise.all(temporary.splice(0).map(path=>rm(path,{recursive:true,force:true})));});

it('persists a domain transport suspension and probes again only on an explicit retry',async()=>{
  const workspace=await mkdtemp(join(tmpdir(),'capivara-domain-ledger-'));temporary.push(workspace);let calls=0;
  const options={workspace,stage:'init' as const,request:'Create a CLI that prints alpha.',config:{provider:'injected-test'},signal:AbortSignal.timeout(2000),agent:async()=>{calls++;return{status:'unavailable' as const,text:'',commands:[],changedFiles:[],issue:{kind:'authentication' as const,message:'Credential is unavailable.',recoverable:true}};}};
  expect((await runWorkflow(options)).status).toBe('waiting');expect(calls).toBe(1);
  expect((await runWorkflow(options)).status).toBe('waiting');expect(calls).toBe(1);
  expect((await runWorkflow({...options,retrySuspended:true})).status).toBe('waiting');expect(calls).toBe(2);
  const store=new ProjectStore(workspace);
  try{expect(store.read().lastFailure?.kind).toBe('no-progress');expect(Object.values(store.read().domainCalls??{})).toHaveLength(1);}finally{store.close();}
});

it('does not cut off recovery while each step proves a new necessary state',async()=>{
  let resource=0,calls=0;
  const result=await recoverOperation(async()=>{calls++;if(resource<4)throw new Error(`missing stage ${resource}`);return 'ready';},{announce:()=>{},progressKey:()=>String(resource),recover:async()=>{resource++;}});
  expect(result).toBe('ready');expect(calls).toBe(5);
});

it('persists the actual cause when the build suspends without throwing',async()=>{
  const workspace=await mkdtemp(join(tmpdir(),'capivara-build-ledger-'));temporary.push(workspace);
  const request='Create a CLI that prints alpha.';
  const brief={schema:'capivara/product/1' as const,status:'ready' as const,id:identity('product',request),revision:1,name:'Alpha',summary:'Alpha',request,modes:['cli' as const],targets:[],constraints:[],gaps:[],decisions:[],requirements:[{id:'alpha',statement:request,mode:'cli' as const,source:{kind:'request' as const,reference:'request',text:request}}]};
  const task={id:'alpha',title:'alpha',goal:'Print alpha',instructions:'Use alpha.mjs',requirementIds:['alpha'],dependsOn:[],environmentIds:[],contractIds:[],files:['alpha.mjs'],criteria:['Print alpha'],checks:[{id:'alpha-cli',kind:'cli' as const,command:process.execPath,args:['alpha.mjs'],expected:'contains:alpha',requirementIds:['alpha'],requiredCapabilities:[]}],blockedBy:[],risk:'normal' as const};
  const plan={schema:'capivara/plan/1' as const,status:'ready' as const,revision:1,briefId:brief.id,briefRevision:1,environment:[],contracts:[],tasks:[task]};
  await writeFile(join(workspace,'alpha.mjs'),"console.log('alpha');");
  const store=new ProjectStore(workspace);
  try{
    store.update({brief,plan,request,config:{provider:'injected-test'}});
    const outcome=await runWorkflow({workspace,stage:'build',store,signal:AbortSignal.timeout(3000),agent:async()=>({status:'complete',text:'{"approved":false,"findings":[]}',commands:[],changedFiles:[]})});
    expect(outcome.status).toBe('waiting');
    const saved=store.read();
    expect(saved.lastFailure?.kind,JSON.stringify(saved.lastFailure)).toBe('instrument');
    expect(saved.lastFailure?.message).toMatch(/review|verdict|parecer/i);
    expect(saved.lastFailure?.fingerprint).toBeTruthy();
    const execution=saved.execution as import('../../src/execution/types.js').BuildState;
    expect(execution.evidence.some(item=>item.passed)).toBe(true);
    expect(execution.blockers?.length).toBeGreaterThan(0);
  }finally{store.close();}
});

it('publishes a repaired plan only together with the execution state that adopted it',async()=>{
  const workspace=await mkdtemp(join(tmpdir(),'capivara-plan-adoption-'));temporary.push(workspace);
  const request='Create a CLI that prints alpha.';
  const brief:ProductBrief={schema:'capivara/product/1',status:'ready',id:identity('product',request),revision:1,name:'Alpha',summary:'Alpha',request,modes:['cli'],targets:[],constraints:[],gaps:[],decisions:[],requirements:[{id:'alpha',statement:request,mode:'cli',source:{kind:'request',reference:'request',text:request}}]};
  const task:WorkUnit={id:'alpha',title:'alpha',goal:'Print alpha',instructions:'Use alpha.mjs',requirementIds:['alpha'],dependsOn:[],environmentIds:[],contractIds:[],files:['alpha.mjs'],criteria:['Print alpha'],checks:[{id:'alpha-cli',kind:'cli',command:process.execPath,args:['alpha.mjs'],expected:'contains:alpha',requirementIds:['alpha'],requiredCapabilities:[]}],blockedBy:[],risk:'normal'};
  const plan:DevelopmentPlan={schema:'capivara/plan/1',status:'ready',revision:1,briefId:brief.id,briefRevision:1,environment:[],contracts:[],tasks:[task]};
  await writeFile(join(workspace,'alpha.mjs'),"console.log('alpha');");
  const checkpoint=await createTaskWorkspace(workspace,task.id,digest(JSON.stringify(task)),task.files);checkpoint.phase='checking';
  const execution=createBuildState(plan);
  execution.tasks.alpha={status:'checking',revision:'',attempts:0,changedFiles:[],findings:[],strategy:'revalidate-only',checkpoint,checks:[{...task.checks[0]!,kind:'web',requiredCapabilities:['browser']}],actions:[],reviews:[]};
  const store=new ProjectStore(workspace), mismatched:{plan:number;execution:number}[]=[];
  let plannerCalls=0,editorCalls=0,adoptedFrames=0;
  try{
    store.update({brief,plan,execution,request,config:{provider:'injected-test'}});
    const result=await runWorkflow({workspace,stage:'build',store,signal:AbortSignal.timeout(5000),onState:saved=>{
      const current=saved.execution as BuildState|undefined;
      if(saved.plan&&current){if(saved.plan.revision!==current.planRevision)mismatched.push({plan:saved.plan.revision,execution:current.planRevision});if(saved.plan.revision>1)adoptedFrames++;}
    },agent:async call=>{
      if(call.role==='planner'){
        plannerCalls++;
        return{status:'complete',text:JSON.stringify({checks:[{...task.checks[0]!,assertion:{type:'contains',source:'stdout',value:'alpha'}}]}),commands:[],changedFiles:[]};
      }
      if(call.role==='editor')editorCalls++;
      return{status:'complete',text:call.role==='reviewer'?'{"approved":true,"findings":[]}':'not a recipe',commands:[],changedFiles:[]};
    }});
    expect(result.status,JSON.stringify(store.read().lastFailure)).toBe('complete');
    expect(plannerCalls).toBe(1);expect(editorCalls).toBe(0);expect(adoptedFrames).toBeGreaterThan(0);
    expect(mismatched).toEqual([]);
    const saved=store.read();expect(saved.plan?.revision).toBe((saved.execution as BuildState).planRevision);
  }finally{store.close();}
});
