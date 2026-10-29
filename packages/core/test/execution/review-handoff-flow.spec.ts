import { afterEach, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runBuild } from '../../src/execution/build.js';
import type { BuildState } from '../../src/execution/types.js';
import type { DevelopmentPlan, ProductBrief, WorkUnit } from '../../src/domain/types.js';
import type { AgentResult } from '../../src/runtime/types.js';

const roots:string[]=[];
afterEach(async()=>{await Promise.all(roots.splice(0).map(root=>rm(root,{recursive:true,force:true})));});
const result=(value:unknown):AgentResult=>({status:'complete',text:JSON.stringify(value),commands:[],changedFiles:[]});

it('persists a deferred integration finding before its owner runs, resumes without replaying the foundation and requires the current owner proof',async()=>{
  const workspace=await mkdtemp(join(tmpdir(),'capivara-review-handoff-'));roots.push(workspace);
  const request='Create a CLI with a stable foundation and an integrated greeting that prints hello.';
  const brief:ProductBrief={schema:'capivara/product/1',status:'ready',id:'b',revision:1,name:'Greeting',summary:request,request,modes:['cli'],targets:['portable'],requirements:[{id:'greeting',statement:request,mode:'cli',kind:'behavior',source:{kind:'request',reference:'request',text:request}}],constraints:[],decisions:[],gaps:[]};
  const foundation:WorkUnit={id:'foundation',title:'Foundation',goal:'Export the stable primitive.',instructions:'Create base.mjs only.',files:['base.mjs'],requirementIds:['greeting'],dependsOn:[],environmentIds:[],contractIds:[],criteria:['The primitive exports base.'],checks:[{id:'base-syntax',kind:'command',command:process.execPath,args:['--check','base.mjs'],inputs:['base.mjs'],level:'syntax',requirementIds:['greeting'],requiredCapabilities:[]}],risk:'normal',blockedBy:[]};
  const app:WorkUnit={...foundation,id:'app',title:'Integrated CLI',goal:'Print hello from the integrated primitive.',instructions:'Create app.mjs.',files:['app.mjs'],dependsOn:['foundation'],criteria:['The integrated CLI prints hello.'],checks:[{id:'greet',kind:'cli',command:process.execPath,args:['app.mjs'],inputs:['app.mjs','base.mjs'],level:'behavior',assertion:{type:'contains',value:'hello'},requirementIds:['greeting'],requiredCapabilities:[]}]};
  const plan:DevelopmentPlan={schema:'capivara/plan/1',status:'ready',revision:1,briefId:'b',briefRevision:1,environment:[],contracts:[],tasks:[foundation,app],acceptance:[]};
  const edits={foundation:0,app:0},reviews={foundation:0,app:0};
  const agent:Parameters<typeof runBuild>[0]['agent']=async call=>{
    const owner=call.context!.includes('Work unit foundation:')?'foundation':'app';
    if(call.role==='editor'){edits[owner]++;await writeFile(join(call.workspace,owner==='foundation'?'base.mjs':'app.mjs'),owner==='foundation'?"export const primitive='base';":"import {primitive} from './base.mjs';if(primitive!=='base')throw Error('broken primitive');console.log('hello');");return result('Implemented.');}
    expect(call.role).toBe('reviewer');reviews[owner]++;
    if(owner==='foundation')return result({approved:true,findings:[{kind:'product',scope:'integration',requirementId:'greeting',deferToTaskId:'app',file:'app.mjs',observed:'The final greeting does not exist in this partial contribution yet.',expected:'The integrated CLI prints hello.',evidenceType:'inspection-command',verification:{kind:'cli',command:process.execPath,args:['app.mjs'],assertion:{type:'contains',value:'hello'}}}]});
    expect(call.context).toContain('INTEGRATION OBLIGATIONS');expect(call.context).toContain('The integrated CLI prints hello.');
    return result({approved:true,findings:[]});
  };
  const abort=new AbortController();let persisted:BuildState|undefined;
  const interrupted=await runBuild({workspace,brief,plan,agent,signal:abort.signal,onState:async state=>{
    persisted=JSON.parse(JSON.stringify(state)) as BuildState;
    if(state.tasks.foundation?.status==='complete'&&state.reviewHandoffs?.[0]?.status==='pending'&&edits.app===0)abort.abort();
  }});
  expect(interrupted.status).toBe('cancelled');expect(edits).toEqual({foundation:1,app:0});expect(reviews).toEqual({foundation:1,app:0});
  expect(persisted!.reviewHandoffs?.[0]?.status).toBe('pending');expect(persisted!.reviewHandoffs?.[0]?.finding.original).toMatchObject({scope:'integration',deferToTaskId:'app'});
  expect(await readFile(join(workspace,'base.mjs'),'utf8')).toContain('primitive');
  const completed=await runBuild({workspace,brief,plan:interrupted.plan,state:persisted!,agent});
  expect(completed.status,JSON.stringify(completed.incidents)).toBe('complete');expect(edits).toEqual({foundation:1,app:1});expect(reviews).toEqual({foundation:1,app:1});
  const handoff=completed.state.reviewHandoffs![0]!;expect(handoff.status).toBe('resolved');expect(handoff.proofIds?.length).toBeGreaterThan(0);
  expect(handoff.proofIds!.every(id=>completed.state.evidence.some(proof=>proof.id===id&&proof.taskId==='app'&&proof.passed&&proof.level==='behavior'))).toBe(true);
  const resumed=await runBuild({workspace,brief,plan:completed.plan,state:structuredClone(completed.state),agent:async()=>{throw Error('A discharged unchanged obligation must not replay agents.');}});
  expect(resumed.status).toBe('complete');expect(resumed.state.evidence).toHaveLength(completed.state.evidence.length);
});
