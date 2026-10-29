import { afterEach, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runWorkflow } from '../../src/app/workflow.js';
import { createBuildState, runBuild } from '../../src/execution/build.js';
import type { AgentResult } from '../../src/runtime/types.js';

const roots:string[]=[];
afterEach(async()=>{await Promise.all(roots.splice(0).map(root=>rm(root,{recursive:true,force:true})));});
const answer=(value:unknown):AgentResult=>({status:'complete',text:typeof value==='string'?value:JSON.stringify(value),commands:[],changedFiles:[]});

it.each(['cli','web'] as const)('keeps fresh %s planning independent of executable recipes, then recovers verification without replaying the editor',async mode=>{
  const workspace=await mkdtemp(join(tmpdir(),'capivara-verification-debt-'));roots.push(workspace);
  const request=mode==='cli'?'Create a CLI that prints healthy.':'Create a web application that displays healthy.';
  const planned=await runWorkflow({workspace,stage:'plan',request,signal:AbortSignal.timeout(8000),config:{provider:'injected-test'},agent:async call=>{
    if(call.role==='analyst')return answer({name:'Health',summary:request,modes:[mode],requirements:[{statement:request,quote:mode==='cli'?'prints healthy':'displays healthy',mode:mode==='cli'?'shared':'web',kind:mode==='cli'?'behavior':'interface'}],questions:[]});
    if(call.instruction.startsWith('Plan executable technical prerequisites'))return answer({environment:[]});
    if(call.instruction.startsWith('Structure small executable')){
      const requirements=JSON.parse(call.instruction.split('Requirements of this slice:\n')[1]!.split('\n\n')[0]!) as {id:string}[];
      return answer({tasks:[{id:'health',title:'Health display',goal:request,instructions:'Implement the requested health display.',requirementIds:requirements.map(item=>item.id),files:[mode==='cli'?'cli.mjs':'index.html','package.json'],dependsOn:[],environmentIds:[],contractIds:[],criteria:[request],checks:[]}],acceptance:[]});
    }
    throw Error('Planning must not ask an agent to prove code that does not exist.');
  }});
  expect(planned.status).toBe('complete');expect(planned.plan!.tasks[0]!.checks).toEqual([]);
  // An environment-created manifest is not an implemented delivery. The first
  // product operation must still be the editor, preserving that existing file.
  await writeFile(join(workspace,'package.json'),JSON.stringify({name:'health-fixture',private:true}));
  let editors=0,reviewers=0,technical=0;
  const code="if(process.argv.includes('--help'))console.log('Usage: cli --health');else if(process.argv.includes('--health'))console.log('healthy');else process.exitCode=2;";
  const agent:Parameters<typeof runBuild>[0]['agent']=async call=>{
    if(call.role==='editor'){editors++;await writeFile(join(call.workspace,mode==='cli'?'cli.mjs':'index.html'),mode==='cli'?code:'<!doctype html><h1>healthy</h1>');return answer('Implemented.');}
    if(call.role==='reviewer'){reviewers++;return answer({approved:true,findings:[]});}
    expect(call.role).toBe('repair');expect(call.readOnly).toBe(true);technical++;
    if(mode==='web')return answer({});
    if(technical===1)return answer({});
    if(technical===2)return answer({checks:[{kind:'web',command:process.execPath,args:['-e',"console.log('healthy')"],level:'behavior',assertion:{type:'contains',value:'healthy'}}]});
    const context=JSON.parse(call.context!) as {operation:string;entrypointObservation:string};
    expect(context.operation).toBe('compose-verification-runner');expect(context.entrypointObservation).toContain('Usage: cli --health');
    return answer({checks:[{id:'health-interaction',kind:'cli',command:process.execPath,args:['cli.mjs','--health'],inputs:['cli.mjs'],level:'behavior',assertion:{type:'contains',value:'healthy'}}]});
  };
  // A plan reconciliation previously marked every affected unit "checking",
  // including units whose editor had never run. That label is not saved work.
  const state=createBuildState(planned.plan!);
  // Legacy context overflow incremented attempts before an agent was called.
  // That counter alone must not suppress the actual first implementation.
  state.tasks.health={status:'checking',revision:'',attempts:1,changedFiles:[],findings:[],strategy:'reconcile-existing-work',actions:[],reviews:[]};
  state.pendingReplans={health:{id:'missing-earlier-instrument',kind:'instrument',subject:'health',message:'The earlier recipe was unavailable.',evidence:'No command existed before implementation.',action:'Recover the proof contract.',external:false,repairScope:'verification'}};
  const result=await runBuild({workspace,brief:planned.brief!,plan:planned.plan!,state,agent});
  expect(editors).toBe(1);expect(technical).toBe(3);
  if(mode==='cli'){
    expect(result.status,JSON.stringify(result.incidents)).toBe('complete');expect(reviewers).toBe(1);
    expect(result.state.pendingReplans?.health).toBeUndefined();
    expect(result.state.evidence.some(proof=>proof.level==='behavior'&&proof.passed&&proof.output.includes('healthy'))).toBe(true);
    expect(await readFile(join(workspace,'cli.mjs'),'utf8')).toBe(code);
    const resumed=await runBuild({workspace,brief:planned.brief!,plan:result.plan,state:structuredClone(result.state),agent:async()=>{throw Error('A completed unchanged delivery must not call an agent again.');}});
    expect(resumed.status).toBe('complete');expect(resumed.state.evidence).toHaveLength(result.state.evidence.length);
  }else{
    expect(result.status).toBe('waiting');expect(reviewers).toBe(0);expect(result.completed).toEqual([]);
    expect(result.state.evidence.filter(proof=>proof.level==='behavior'&&proof.passed)).toEqual([]);
    expect(result.state.pendingReplans?.health?.repairScope).toBe('verification');
    expect(await readFile(join(result.state.tasks.health!.checkpoint!.directory,'index.html'),'utf8')).toContain('healthy');
  }
},10_000);
