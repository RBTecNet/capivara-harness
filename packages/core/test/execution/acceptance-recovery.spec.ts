import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runBuild } from '../../src/execution/build.js';
import type { BuildOptions, BuildState } from '../../src/execution/types.js';
import type { DevelopmentPlan, ProductBrief, WorkUnit } from '../../src/domain/types.js';
import type { AgentResult } from '../../src/runtime/types.js';

const roots:string[]=[];
afterEach(async()=>{await Promise.all(roots.splice(0).map(root=>rm(root,{recursive:true,force:true})));});
const complete=(text=''):AgentResult=>({status:'complete',text,commands:[],changedFiles:[]});
const brief:ProductBrief={schema:'capivara/product/1',id:'b',revision:1,status:'ready',name:'Alpha',summary:'Observe alpha',request:'Create a CLI that prints alpha.',modes:['cli'],targets:['portable'],requirements:[{id:'alpha',statement:'The CLI prints alpha.',mode:'cli',source:{kind:'request',reference:'request',text:'Create a CLI that prints alpha.'}}],constraints:[],decisions:[],gaps:[]};
const task:WorkUnit={id:'alpha',title:'Alpha',goal:'Print alpha.',instructions:'Implement the alpha CLI.',requirementIds:['alpha'],dependsOn:[],environmentIds:[],contractIds:[],files:['alpha.mjs'],criteria:['The CLI prints alpha.'],checks:[{id:'alpha-cli',kind:'cli',command:process.execPath,args:['alpha.mjs'],assertion:{type:'contains',value:'alpha'},inputs:['alpha.mjs'],level:'behavior',requirementIds:['alpha'],requiredCapabilities:[]}],risk:'normal',blockedBy:[]};
const plan:DevelopmentPlan={schema:'capivara/plan/1',status:'ready',revision:1,briefId:'b',briefRevision:1,environment:[],contracts:[],tasks:[task],acceptance:[{id:'final-alpha',kind:'cli',command:process.execPath,args:['alpha.mjs'],expected:'The final CLI observes alpha.',inputs:['alpha.mjs'],level:'behavior',requirementIds:['alpha'],requiredCapabilities:[]}]};

describe('recuperação do aceite distingue tentativa interrompida de recurso esgotado',()=>{
  it('aposenta uma reconciliação cujo dono saiu do plano sem reabrir entrega ou apagar a causa histórica',async()=>{
    const root=await mkdtemp(join(tmpdir(),'capivara-retired-replan-'));roots.push(root);
    const current={...structuredClone(plan),acceptance:[]};let calls=0,replans=0;
    const agent:BuildOptions['agent']=async request=>{calls++;if(request.role==='reviewer')return complete('{"approved":true,"findings":[]}');await writeFile(join(request.workspace,'alpha.mjs'),'console.log("alpha");\n');return complete();};
    const first=await runBuild({workspace:root,brief,plan:current,agent,signal:AbortSignal.timeout(4000)});
    expect(first.status).toBe('complete');
    const cause={id:'retired-cause',kind:'planning' as const,subject:'retired-alpha',message:'An older proof needs reconciliation.',evidence:'Original unproven invocation.',external:false,action:'Reconcile its proof.',repairScope:'verification' as const};
    const state=structuredClone(first.state);state.pendingReplans={'retired-alpha':cause};state.incidents.push(cause);
    const proofCount=state.evidence.length,beforeCalls=calls;
    const resumed=await runBuild({workspace:root,brief,plan:first.plan,state,agent,repairPlan:async()=>{replans++;return null;},signal:AbortSignal.timeout(4000)});
    expect(resumed.status).toBe('complete');expect(resumed.plan).toEqual(first.plan);
    expect(calls).toBe(beforeCalls);expect(replans).toBe(0);expect(resumed.state.evidence).toHaveLength(proofCount);
    expect(resumed.state.pendingReplans).toEqual({});expect(resumed.state.incidents).toContainEqual(cause);
    expect(resumed.state.metrics?.repetitions).toContainEqual(expect.objectContaining({taskId:'retired-alpha',action:'retire-replan'}));
  });

  it('encaminha asserção final malformada para reconciliação da prova sem redefinir a entrega',async()=>{
    const root=await mkdtemp(join(tmpdir(),'capivara-acceptance-scope-'));roots.push(root);let editors=0,replans=0;
    const result=await runBuild({workspace:root,brief,plan:structuredClone(plan),signal:AbortSignal.timeout(4000),repairPlan:async(problem,owner)=>{replans++;expect(problem.repairScope).toBe('verification');expect(owner.id).toBe('alpha');return null;},agent:async request=>{
      if(request.instruction.startsWith('Bind a mechanical assertion')||request.instruction.startsWith('Repair only the verification recipe'))return complete('{}');
      if(request.role==='reviewer')return complete('{"approved":true,"findings":[]}');
      expect(request.role).toBe('editor');editors++;await writeFile(join(request.workspace,'alpha.mjs'),'console.log("alpha");\n');return complete();
    }});
    expect(result.status).toBe('waiting');expect(editors).toBe(1);expect(replans).toBe(1);
    expect(result.plan.tasks).toEqual(plan.tasks);expect(result.state.tasks.alpha?.status).toBe('complete');
  });

  for(const point of ['durable-guard','assertion-action'] as const)it(`retoma após cancelamento em ${point} preservando entrega e tentativas não concluídas`,async()=>{
    const root=await mkdtemp(join(tmpdir(),'capivara-acceptance-recovery-'));roots.push(root);
    const controller=new AbortController();let state:BuildState|undefined,editors=0,reviewers=0,assertions=0,interrupted=false;
    const agent:BuildOptions['agent']=async request=>{
      if(request.instruction.startsWith('Bind a mechanical assertion')){
        assertions++;
        if(point==='assertion-action'&&!interrupted){interrupted=true;return{status:'cancelled',text:'',commands:[],changedFiles:[]};}
        return complete(JSON.stringify({assertions:[{checkId:'final-alpha',assertion:{type:'contains',source:'stdout',value:'alpha'}}]}));
      }
      if(request.role==='reviewer'){reviewers++;return complete('{"approved":true,"findings":[]}');}
      expect(request.role).toBe('editor');editors++;await writeFile(join(request.workspace,'alpha.mjs'),'console.log("alpha");\n');return complete();
    };
    const first=await runBuild({workspace:root,brief,plan,agent,signal:controller.signal,onState:async next=>{
      state=structuredClone(next);
      if(point==='durable-guard'&&!interrupted&&Object.values(next.acceptanceRecovery??{}).some(value=>value.startsWith('running:'))){interrupted=true;controller.abort();}
    }});
    expect(first.status,JSON.stringify(first.incidents)).toBe('cancelled');
    expect(editors).toBe(1);expect(reviewers).toBe(1);
    expect(first.state.tasks.alpha?.status).toBe('complete');
    expect(Object.values(first.state.acceptanceRecovery??{})).toContain('interrupted:instrument');
    expect(first.state.evidence.some(proof=>proof.checkId==='final-alpha'&&!proof.passed)).toBe(true);
    const taskProofs=first.state.evidence.filter(proof=>proof.taskId==='alpha').length;
    const resumed=await runBuild({workspace:root,brief,plan:first.plan,state:JSON.parse(JSON.stringify(state)),agent,signal:AbortSignal.timeout(4000)});
    expect(resumed.status,JSON.stringify(resumed.incidents)).toBe('complete');
    expect(editors).toBe(1);expect(reviewers).toBe(1);
    expect(assertions).toBe(point==='assertion-action'?2:1);
    expect(resumed.state.evidence.filter(proof=>proof.taskId==='alpha')).toHaveLength(taskProofs);
    expect(resumed.state.evidence.some(proof=>proof.checkId==='final-alpha'&&proof.passed)).toBe(true);
    expect(Object.values(resumed.state.acceptanceRecovery??{})).toContain('complete:instrument');
  });
});
