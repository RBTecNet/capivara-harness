import { afterEach, expect, it } from 'vitest';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runBuild } from '../../src/execution/build.js';
import { runVerification } from '../../src/execution/checks.js';
import { executeCommand, runTerminal } from '../../src/runtime/index.js';
import type { BuildOptions, BuildState } from '../../src/execution/types.js';
import type { DevelopmentPlan, ProductBrief, WorkUnit } from '../../src/domain/types.js';
import type { AgentResult } from '../../src/runtime/types.js';

const temporary:string[]=[];
afterEach(async()=>{await Promise.all(temporary.splice(0).map(path=>rm(path,{recursive:true,force:true})));});
async function workspace(){const path=await mkdtemp(join(tmpdir(),'capivara-control-'));temporary.push(path);return path;}
const complete=(text=''):AgentResult=>({status:'complete',text,commands:[],changedFiles:[]});
const brief:ProductBrief={schema:'capivara/product/1',status:'ready',id:'b',revision:1,name:'Independent CLI commands',summary:'Commands',request:'Build independent alpha and beta CLI commands.',modes:['cli'],targets:['portable'],constraints:[],gaps:[],decisions:[],requirements:['alpha','beta'].map(id=>({id,statement:`${id} command prints ${id}`,mode:'cli',source:{kind:'request',reference:'request',text:`${id} command prints ${id}`}}))};
function unit(id:string,files=[`${id}.mjs`],dependsOn:string[]=[]):WorkUnit{return{id,title:id,goal:`Print ${id}`,instructions:`Write ${files.join(', ')}`,requirementIds:[id],dependsOn,environmentIds:[],contractIds:[],files,criteria:[`Print ${id}`],checks:[{id:`check-${id}`,kind:'cli',command:process.execPath,args:files[0]!.endsWith('.json')?['-e',`console.log(require('./${files[0]}').join(','))`]:[files[0]!],expected:`contains:${id}`,requirementIds:[id],requiredCapabilities:[]}],blockedBy:[],risk:'normal'};}
function plan(tasks:WorkUnit[]):DevelopmentPlan{return{schema:'capivara/plan/1',status:'ready',revision:1,briefId:'b',briefRevision:1,environment:[],contracts:[],tasks};}

it('overlaps independent editors, integrates both products, and never overlaps conflicting writes',async()=>{
  for(const conflict of [false,true]){
    const root=await workspace();let active=0,max=0;
    const tasks=['alpha','beta'].map(id=>unit(id,conflict?['shared.json']:[`${id}.mjs`]));
    const options={workspace:root,brief,plan:plan(tasks),maxConcurrent:2,signal:AbortSignal.timeout(3000),agent:async(request:Parameters<BuildOptions['agent']>[0])=>{
      if(request.role==='reviewer')return complete('{"approved":true}');
      const id=request.context!.match(/Work unit (\w+):/)![1]!;
      active++;max=Math.max(max,active);await new Promise(resolve=>setTimeout(resolve,60));
      if(conflict){const path=join(request.workspace,'shared.json');const before=JSON.parse(await readFile(path,'utf8').catch(()=>'[]'));await writeFile(path,JSON.stringify([...new Set([...before,id])]));}
      else await writeFile(join(request.workspace,`${id}.mjs`),`console.log('${id}');`);
      active--;return complete();
    }};
    const outcome=await runBuild(options);
    expect(outcome.status).toBe('complete');expect(max).toBe(conflict?1:2);
    if(conflict)expect(JSON.parse(await readFile(join(root,'shared.json'),'utf8'))).toEqual(['alpha','beta']);
    else for(const id of ['alpha','beta'])expect(await readFile(join(root,`${id}.mjs`),'utf8')).toContain(id);
  }
});

it('suspends a repeated unchanged failure durably instead of replaying repairs on restart',async()=>{
  const root=await workspace();let edits=0;let saved:BuildState|undefined;
  const product={...brief,requirements:brief.requirements.slice(0,1)};
  const options={workspace:root,brief:product,plan:plan([unit('alpha')]),signal:AbortSignal.timeout(1000),onState:async(state:BuildState)=>{saved=structuredClone(state);},agent:async(request:Parameters<BuildOptions['agent']>[0])=>{
    if(request.role==='editor'||request.role==='repair'){edits++;await writeFile(join(request.workspace,'alpha.mjs'),"console.log('wrong');");return complete();}
    return complete('{"kind":"product","cause":"The command still prints wrong.","fix":"Make alpha print alpha."}');
  }};
  const first=await runBuild(options);
  expect(first.status).toBe('waiting');expect(edits).toBeLessThanOrEqual(4);
  expect(first.incidents.some(item=>item.kind==='integration'&&/progress|progresso|unchanged/i.test(item.message))).toBe(true);
  const before=edits;
  const second=await runBuild({...options,state:JSON.parse(JSON.stringify(saved)),signal:AbortSignal.timeout(1000)});
  expect(second.status).toBe('waiting');expect(edits).toBe(before);
});

it('serializes declared exclusive resources and strict dependencies while keeping disjoint files',async()=>{
  for(const dependency of [false,true]){
    const root=await workspace();let active=0,max=0;
    const tasks=[unit('alpha'),unit('beta',undefined,dependency?['alpha']:[])];
    if(!dependency)for(const task of tasks)task.resources=['exclusive-database-fixture'];
    const result=await runBuild({workspace:root,brief,plan:plan(tasks),maxConcurrent:2,signal:AbortSignal.timeout(3000),agent:async request=>{
      if(request.role==='reviewer')return complete('{"approved":true}');
      const id=request.context!.match(/Work unit (\w+):/)![1]!;active++;max=Math.max(active,max);
      if(dependency&&id==='beta')expect(await readFile(join(request.workspace,'alpha.mjs'),'utf8')).toContain('alpha');
      await new Promise(resolve=>setTimeout(resolve,25));await writeFile(join(request.workspace,`${id}.mjs`),`console.log('${id}');`);active--;return complete();
    }});
    expect(result.status).toBe('complete');expect(max).toBe(1);
  }
});

it('resumes recorded verification and review without reimplementing accepted source',async()=>{
  const root=await workspace();let edits=0,reviews=0;let durable:BuildState|undefined;
  const controller=new AbortController();
  const product={...brief,requirements:brief.requirements.slice(0,1)};
  const agent:BuildOptions['agent']=async request=>{
    if(request.role==='reviewer'){reviews++;return complete('{"approved":true}');}
    edits++;await writeFile(join(request.workspace,'alpha.mjs'),"console.log('alpha');");return complete();
  };
  const first=await runBuild({workspace:root,brief:product,plan:plan([unit('alpha')]),agent,signal:controller.signal,onState:async state=>{durable=structuredClone(state);if(state.tasks.alpha?.status==='reviewing')controller.abort();}});
  expect(first.status).toBe('cancelled');expect(edits).toBe(1);
  const result=await runBuild({workspace:root,brief:product,plan:plan([unit('alpha')]),state:JSON.parse(JSON.stringify(durable)),agent,signal:AbortSignal.timeout(3000)});
  expect(result.status).toBe('complete');expect(edits).toBe(1);expect(reviews).toBe(1);
  const before=result.state.evidence.length;
  const again=await runBuild({workspace:root,brief:product,plan:result.plan,state:JSON.parse(JSON.stringify(result.state)),agent,signal:AbortSignal.timeout(3000)});
  expect(again.status).toBe('complete');expect(edits).toBe(1);expect(reviews).toBe(1);expect(again.state.evidence.length).toBe(before);
});

it('cannot declare completion while a mandatory acceptance proof fails',async()=>{
  const root=await workspace();const product={...brief,requirements:brief.requirements.slice(0,1)};
  const proposal=plan([unit('alpha')]);
  proposal.acceptance=[{id:'required-artifact',kind:'command',command:process.execPath,args:['-e',"if(!require('fs').existsSync('mandatory-artifact.bin'))process.exit(7);console.log('artifact present')"],expected:'contains:artifact present',level:'behavior',requirementIds:['alpha'],requiredCapabilities:[]}];
  const result=await runBuild({workspace:root,brief:product,plan:proposal,signal:AbortSignal.timeout(3000),agent:async request=>{
    if(request.role==='reviewer')return complete('{"approved":true}');await writeFile(join(request.workspace,'alpha.mjs'),"console.log('alpha');");return complete();
  }});
  expect(result.status).toBe('waiting');expect(result.incidents.some(item=>item.kind==='planning'||item.kind==='product')).toBe(true);
});

it('rechecks imported code and manifests at quiescence without reopening implementation or unrelated documentation',async()=>{
  const root=await workspace();await writeFile(join(root,'settings.mjs'),'export const value=3;\n');
  const tasks=[unit('alpha'),unit('beta',['settings.mjs'],['alpha'])];
  const edits:Record<string,number>={};
  const agent:BuildOptions['agent']=async request=>{
    if(request.role==='reviewer')return complete('{"approved":true}');
    const id=request.context!.match(/Work unit (\w+):/)![1]!;edits[id]=(edits[id]??0)+1;
    if(id==='alpha')await writeFile(join(request.workspace,'alpha.mjs'),"import {value} from './settings.mjs';console.log(value>0?'alpha':'wrong');\n");
    else await writeFile(join(request.workspace,'settings.mjs'),"export const value=4;console.log('beta');\n");
    return complete();
  };
  const first=await runBuild({workspace:root,brief,plan:plan(tasks),agent,signal:AbortSignal.timeout(5000)});
  expect(first.status).toBe('complete');expect(edits).toEqual({alpha:1,beta:1});
  expect(first.state.evidence.filter(item=>item.taskId==='alpha'&&item.passed).length).toBe(2);
  expect(first.state.metrics?.invalidations.some(item=>item.taskId==='alpha')).toBe(true);
  await writeFile(join(root,'README.md'),'Unrelated documentation only.');
  const before=first.state.evidence.length;
  const second=await runBuild({workspace:root,brief,plan:first.plan,state:JSON.parse(JSON.stringify(first.state)),agent,signal:AbortSignal.timeout(5000)});
  expect(second.status).toBe('complete');expect(second.state.evidence.length).toBe(before);expect(edits).toEqual({alpha:1,beta:1});
  await writeFile(join(root,'settings.mjs'),"export const value=5;console.log('beta');\n");
  const third=await runBuild({workspace:root,brief,plan:second.plan,state:JSON.parse(JSON.stringify(second.state)),agent,signal:AbortSignal.timeout(5000)});
  expect(third.status).toBe('complete');expect(third.state.evidence.length).toBe(before+2);expect(edits).toEqual({alpha:1,beta:1});
});

it('obtains a current review when criteria change while reusing unchanged valid executable proofs',async()=>{
  const root=await workspace();let edits=0,reviews=0;
  const product={...brief,requirements:brief.requirements.slice(0,1)};
  const agent:BuildOptions['agent']=async request=>{
    if(request.role==='reviewer'){reviews++;return complete('{"approved":true}');}
    edits++;await writeFile(join(request.workspace,'alpha.mjs'),"console.log('alpha');");return complete();
  };
  const first=await runBuild({workspace:root,brief:product,plan:plan([unit('alpha')]),agent,signal:AbortSignal.timeout(3000)});
  expect(first.status).toBe('complete');const before=first.state.evidence.length;
  const revised=structuredClone(first.plan);revised.revision++;
  revised.tasks[0]!.criteria.push('The implementation must keep the explicitly requested alpha spelling.');
  const second=await runBuild({workspace:root,brief:product,plan:revised,state:JSON.parse(JSON.stringify(first.state)),agent,signal:AbortSignal.timeout(3000)});
  expect(second.status).toBe('complete');expect(edits).toBe(1);expect(reviews).toBe(2);expect(second.state.evidence.length).toBe(before);
});

it('keeps generated build artifacts available to later checks without publishing verification scratch files',async()=>{
  const root=await workspace();let edits=0;
  const product={...brief,requirements:brief.requirements.slice(0,1)};
  const delivery=unit('alpha',['source.txt','dist/alpha.mjs']);
  const generate={id:'generate',kind:'command' as const,command:process.execPath,args:['-e',"const fs=require('fs');fs.mkdirSync('dist',{recursive:true});fs.copyFileSync('source.txt','dist/alpha.mjs');fs.writeFileSync('temporary-database.sqlite','scratch');console.log('built');"],expected:'contains:built',level:'build' as const,inputs:['source.txt'],outputs:['dist/alpha.mjs'],requirementIds:['alpha'],requiredCapabilities:[]};
  const interact={id:'interact',kind:'cli' as const,command:process.execPath,args:['dist/alpha.mjs'],expected:'contains:alpha',level:'behavior' as const,inputs:['dist/alpha.mjs'],dependsOn:['generate'],requirementIds:['alpha'],requiredCapabilities:[]};
  delivery.checks=[generate,interact];
  const agent:BuildOptions['agent']=async request=>{if(request.role==='reviewer')return complete('{"approved":true}');edits++;await writeFile(join(request.workspace,'source.txt'),"console.log('alpha');");return complete();};
  const first=await runBuild({workspace:root,brief:product,plan:plan([delivery]),agent,signal:AbortSignal.timeout(5000)});
  expect(first.status).toBe('complete');expect(await readFile(join(root,'dist/alpha.mjs'),'utf8')).toContain('alpha');
  await expect(readFile(join(root,'temporary-database.sqlite'))).rejects.toMatchObject({code:'ENOENT'});
  const second=await runBuild({workspace:root,brief:product,plan:first.plan,state:JSON.parse(JSON.stringify(first.state)),agent,signal:AbortSignal.timeout(5000)});
  expect(second.status).toBe('complete');expect(edits).toBe(1);expect(second.state.evidence.length).toBe(first.state.evidence.length);
});

it('reconciles an observed undeclared integration conflict on a fresh base while preserving both deliveries',async()=>{
  const root=await workspace();await writeFile(join(root,'shared.json'),'[]');let repairs=0;
  const result=await runBuild({workspace:root,brief,plan:plan([unit('alpha'),unit('beta')]),maxConcurrent:2,signal:AbortSignal.timeout(7000),agent:async request=>{
    if(request.role==='reviewer')return complete('{"approved":true}');
    const id=request.context!.match(/Work unit (\w+):/)![1]!;
    if(request.role==='repair')repairs++;
    const path=join(request.workspace,'shared.json');const entries=JSON.parse(await readFile(path,'utf8'));
    await new Promise(resolve=>setTimeout(resolve,25));
    await writeFile(path,JSON.stringify([...new Set([...entries,id])]));
    await writeFile(join(request.workspace,`${id}.mjs`),`console.log('${id}');`);
    return complete();
  }});
  expect(result.status).toBe('complete');expect(repairs).toBe(1);
  expect(JSON.parse(await readFile(join(root,'shared.json'),'utf8')).sort()).toEqual(['alpha','beta']);
  for(const id of ['alpha','beta'])expect(await readFile(join(root,`${id}.mjs`),'utf8')).toContain(id);
});

it('does not cycle cached rejection and a no-op repair when shallow checks happen to pass',async()=>{
  const root=await workspace();let writes=0,reviews=0;
  const product=structuredClone(brief);product.requirements=product.requirements.slice(0,1);
  product.requirements[0]!.statement='The alpha command prints alpha and beta.';product.requirements[0]!.source.text=product.requirements[0]!.statement;
  const delivery=unit('alpha');delivery.criteria.push('Print beta as well as alpha.');
  const agent:BuildOptions['agent']=async request=>{
    if(request.role==='reviewer'){reviews++;return complete(JSON.stringify({approved:false,findings:[{kind:'product',file:'alpha.mjs',expected:'Print alpha and beta.',observed:'Only alpha is printed.',evidence:'alpha.mjs contains only one console.log.',fix:'Print the requested beta line as well.'}]}));}
    writes++;await writeFile(join(request.workspace,'alpha.mjs'),"console.log('alpha');");return complete();
  };
  const first=await runBuild({workspace:root,brief:product,plan:plan([delivery]),agent,signal:AbortSignal.timeout(4000)});
  expect(first.status).toBe('waiting');expect(writes).toBeLessThanOrEqual(3);expect(reviews).toBeLessThanOrEqual(3);
  const before={writes,reviews};
  const second=await runBuild({workspace:root,brief:product,plan:first.plan,state:JSON.parse(JSON.stringify(first.state)),agent,signal:AbortSignal.timeout(4000)});
  expect(second.status).toBe('waiting');expect({writes,reviews}).toEqual(before);
});

it('distinguishes unknown product inputs from an explicitly input-free verification',async()=>{
  const root=await workspace();const delivery={...unit('alpha'),files:[]};
  const check={id:'constant',kind:'cli' as const,command:process.execPath,args:['-e',"console.log('alpha')"],expected:'contains:alpha',requirementIds:['alpha'],requiredCapabilities:[]};
  const unknown=await runVerification(root,brief,delivery,plan([delivery]),check,executeCommand,runTerminal);
  expect(unknown.evidence.passed).toBe(false);expect(unknown.classification).toBe('instrument');expect(unknown.result).toBeNull();
  const explicit=await runVerification(root,brief,delivery,plan([delivery]),{...check,inputs:[]},executeCommand,runTerminal);
  expect(explicit.evidence.passed).toBe(true);
});
