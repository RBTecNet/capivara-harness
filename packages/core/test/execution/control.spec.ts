import { afterEach, expect, it } from 'vitest';
import { mkdtemp, writeFile, readFile, rm, mkdir, chmod } from 'node:fs/promises';
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

it('recovers a throwing scoped planner through an actual different proof recipe without reediting the product',async()=>{
  const root=await workspace();const product={...brief,requirements:brief.requirements.slice(0,1)};
  const task=unit('alpha');task.checks=[{...task.checks[0]!,kind:'web',requiredCapabilities:['browser']}];
  let editors=0,recipes=0,plans=0;
  const result=await runBuild({workspace:root,brief:product,plan:plan([task]),signal:AbortSignal.timeout(3000),repairPlan:async problem=>{plans++;expect(problem.repairScope).toBe('verification');throw new Error('The model returned an unchanged plan.');},agent:async request=>{
    if(request.role==='editor'){editors++;await writeFile(join(request.workspace,'alpha.mjs'),'console.log("alpha");');return complete();}
    if(request.role==='repair'){recipes++;return complete(recipes===1?'not a recipe':JSON.stringify({checks:[unit('alpha').checks[0]]}));}
    return complete('{"approved":true,"findings":[]}');
  }});
  expect(result.status,JSON.stringify(result.incidents)).toBe('complete');
  expect(editors).toBe(1);expect(plans).toBe(1);expect(recipes).toBe(2);
  expect(result.state.tasks.alpha?.actions?.find(action=>action.action==='replan')).toMatchObject({outcome:'failed',failure:'The model returned an unchanged plan.'});
  expect(result.state.evidence.some(proof=>proof.passed&&proof.kind==='cli')).toBe(true);
});

it.each(['before-call','after-result'] as const)('resumes an interrupted reconciliation %s without losing its recovery transition or replaying a completed planner',async point=>{
  const root=await workspace();const product={...brief,requirements:brief.requirements.slice(0,1)};
  const task=unit('alpha');task.checks=[{...task.checks[0]!,kind:'web',requiredCapabilities:['browser']}];
  const controller=new AbortController();let durable:BuildState|undefined,editors=0,plans=0;
  const agent:BuildOptions['agent']=async request=>{
    if(request.role==='editor'){editors++;await writeFile(join(request.workspace,'alpha.mjs'),'console.log("alpha");');return complete();}
    if(request.role==='repair')return complete('not a recipe');
    return complete('{"approved":true,"findings":[]}');
  };
  const repairPlan:NonNullable<BuildOptions['repairPlan']>=async()=>{plans++;return plan([unit('alpha')]);};
  const first=await runBuild({workspace:root,brief:product,plan:plan([task]),agent,repairPlan,signal:controller.signal,onState:async state=>{durable=structuredClone(state);if(state.tasks.alpha?.actions?.some(action=>action.action==='replan'&&action.outcome==='running'&&(point==='before-call'||action.planProposal)))controller.abort();}});
  expect(first.status).toBe('cancelled');expect(plans).toBe(point==='before-call'?0:1);expect(editors).toBe(1);
  expect(durable?.pendingReplans?.alpha).toBeDefined();
  if(point==='after-result')expect(durable?.tasks.alpha?.actions?.find(action=>action.action==='replan')?.planProposal).toBeDefined();
  const resumed=await runBuild({workspace:root,brief:product,plan:first.plan,state:JSON.parse(JSON.stringify(durable)),agent,repairPlan,signal:AbortSignal.timeout(3000)});
  expect(resumed.status,JSON.stringify(resumed.incidents)).toBe('complete');expect(plans).toBe(1);expect(editors).toBe(1);
  expect(resumed.state.pendingReplans).toEqual({});
});

it('retires queued owners removed by reconciliation instead of replaying a second obsolete plan',async()=>{
  const root=await workspace();let planners=0,editors=0;
  const original=plan(['alpha','beta'].map(id=>{const task=unit(id);task.checks=[{...task.checks[0]!,kind:'web',requiredCapabilities:['browser']}];return task;}));
  const combined=unit('combined',['alpha.mjs','beta.mjs']);combined.requirementIds=['alpha','beta'];combined.criteria=['Both commands remain available.'];combined.checks=[{id:'both-cli',kind:'cli',command:process.execPath,args:['-e',"await import('./alpha.mjs');await import('./beta.mjs');"],assertion:{type:'all',assertions:[{type:'contains',value:'alpha'},{type:'contains',value:'beta'}]},inputs:['alpha.mjs','beta.mjs'],requirementIds:['alpha','beta'],requiredCapabilities:[]}];
  const result=await runBuild({workspace:root,brief,plan:original,signal:AbortSignal.timeout(5000),repairPlan:async()=>{planners++;return plan([combined]);},agent:async request=>{
    if(request.role==='reviewer')return complete('{"approved":true,"findings":[]}');
    if(request.role==='repair')return complete('not a recipe');
    editors++;const id=request.context!.match(/Work unit (\w+):/)![1]!;
    for(const file of id==='combined'?['alpha','beta']:[id])await writeFile(join(request.workspace,`${file}.mjs`),`console.log('${file}');`);return complete();
  }});
  expect(result.status,JSON.stringify(result.incidents)).toBe('complete');expect(planners).toBe(1);expect(editors).toBe(3);
  expect(result.plan.tasks.map(task=>task.id)).toEqual(['combined']);expect(result.state.pendingReplans).toEqual({});
  expect(result.state.metrics?.repetitions?.filter(item=>item.action==='retire-replan')).toHaveLength(2);
});

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

it('prioritizes the current review source over a stale focus file instead of repeating an incomplete inspection',async()=>{
  const root=await workspace();await writeFile(join(root,'old-guide.md'),'old guidance '.repeat(750));await writeFile(join(root,'alpha.mjs'),'// '+ 'existing source '.repeat(350)+'\nconsole.log("alpha");');
  const product={...brief,requirements:brief.requirements.slice(0,1)},task=unit('alpha');task.files.push('old-guide.md');
  const original=plan([task]);const state:BuildState={schema:'capivara/build/1',planRevision:1,environment:{},evidence:[],incidents:[],updatedAt:new Date().toISOString(),tasks:{alpha:{status:'pending',revision:'',attempts:0,changedFiles:[],findings:[],strategy:'implement',contextFocus:['old-guide.md']}}};
  let inspections=0,editors=0;
  const result=await runBuild({workspace:root,brief:product,plan:original,state,contextChars:14000,signal:AbortSignal.timeout(3000),agent:async request=>{
    if(request.role!=='reviewer'){editors++;return complete();}
    inspections++;
    const receipt=request.context?.split('\n').find(line=>line.startsWith('SOURCE ')&&line.includes('"path":"alpha.mjs"'));
    expect(receipt).toBeDefined();
    if(inspections===1){expect(JSON.parse(receipt!.slice(7)).complete).toBe(false);return complete('{"approved":false,"findings":[{"kind":"product","file":"alpha.mjs","observed":"The supplied excerpt is insufficient to establish the alpha branch.","expected":"The alpha command prints alpha.","evidenceType":"source"}]}');}
    expect(JSON.parse(receipt!.slice(7)).complete).toBe(true);return complete('{"approved":true,"findings":[]}');
  }});
  expect(result.status,JSON.stringify(result.incidents)).toBe('complete');expect(inspections).toBe(2);expect(editors).toBe(0);
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


it('continues an ineffective environment repair with diagnosis and isolated recovery instead of suspending executable work',async()=>{
  const root=await workspace();let repairs=0,diagnoses=0,editors=0;
  const product={...brief,requirements:brief.requirements.slice(0,1)};
  const task=unit('alpha');task.environmentIds=['local-tool'];
  const proposal=plan([task]);proposal.environment=[{id:'local-tool',name:'local tool',kind:'tool',dependsOn:[],targets:[],reason:'Required local capability',identity:{capability:'local-tool',kind:'cli',provider:'local-tool'},check:{command:'.tools/bin/tool',args:['--version'],capabilities:[]},prepare:[]}];
  const result=await runBuild({workspace:root,brief:product,plan:proposal,signal:AbortSignal.timeout(10000),agent:async request=>{
    if(request.purpose==='environment-recovery'){
      expect(request.workspace).not.toBe(root);expect(request.context).not.toContain('Print alpha');
      if(request.readOnly){diagnoses++;return complete(JSON.stringify({cause:'The first operation changed product source rather than installing its provider.',fix:'Create the executable local provider at .tools/bin/tool; preserve application source.'}));}
      repairs++;
      if(repairs===1)await writeFile(join(request.workspace,'unrelated-product.mjs'),"throw new Error('wrong operation');");
      else{await mkdir(join(request.workspace,'.tools/bin'),{recursive:true});await writeFile(join(request.workspace,'.tools/bin/tool'),'#!/bin/sh\nprintf "local-tool 1\\n"\n');await chmod(join(request.workspace,'.tools/bin/tool'),0o755);}
      return complete('{}');
    }
    if(request.role==='reviewer')return complete('{"approved":true}');
    editors++;await writeFile(join(request.workspace,'alpha.mjs'),"console.log('alpha');");return complete();
  }});
  expect(result.status).toBe('complete');expect(repairs).toBe(2);expect(diagnoses).toBe(1);expect(editors).toBe(1);
  expect(result.state.environment['local-tool']?.ready).toBe(true);
  await expect(readFile(join(root,'unrelated-product.mjs'))).rejects.toMatchObject({code:'ENOENT'});
  expect(result.incidents.some(item=>/out-of-scope/.test(item.message))).toBe(true);
});

it('validates existing partial source before asking another editor to implement it',async()=>{
  const root=await workspace();await writeFile(join(root,'alpha.mjs'),"console.log('alpha');");let editors=0;
  const result=await runBuild({workspace:root,brief:{...brief,requirements:brief.requirements.slice(0,1)},plan:plan([unit('alpha')]),signal:AbortSignal.timeout(3000),agent:async request=>{
    if(request.role==='reviewer')return complete('{"approved":true}');editors++;return complete();
  }});
  expect(result.status).toBe('complete');expect(editors).toBe(0);expect(result.state.evidence.some(item=>item.passed)).toBe(true);
});

it('recovers a provider damaged after publication through the same active recovery path',async()=>{
  const {writeFileSync}=await import('node:fs');
  const root=await workspace();await mkdir(join(root,'.tools/bin'),{recursive:true});
  const tool=join(root,'.tools/bin/tool');await writeFile(tool,'#!/bin/sh\nprintf "ready\\n"\n',{mode:0o755});
  const product={...brief,requirements:brief.requirements.slice(0,1)};
  const task=unit('alpha');task.environmentIds=['tool'];const proposed=plan([task]);
  proposed.environment=[{id:'tool',name:'Tool',kind:'tool',dependsOn:[],targets:[],reason:'Local tool',identity:{capability:'tool',kind:'cli',provider:'local'},check:{command:'.tools/bin/tool',args:['--version']},prepare:[]}];
  let damaged=false,repairs=0;
  const outcome=await runBuild({workspace:root,brief:product,plan:proposed,signal:AbortSignal.timeout(10000),onEvent:event=>{
    if(!damaged&&event.type==='transition'&&event.message.includes('→ complete')){damaged=true;writeFileSync(tool,'#!/bin/sh\nexit 7\n',{mode:0o755});}
  },agent:async request=>{
    if(request.purpose==='environment-recovery'){repairs++;await writeFile(join(request.workspace,'.tools/bin/tool'),'#!/bin/sh\nprintf "ready\\n"\n',{mode:0o755});return complete('{}');}
    if(request.role==='reviewer')return complete('{"approved":true}');await writeFile(join(request.workspace,'alpha.mjs'),"console.log('alpha');");return complete();
  }});
  expect(damaged).toBe(true);expect(repairs).toBe(1);expect(outcome.status).toBe('complete');
  expect(outcome.state.environment.tool?.ready).toBe(true);
});

it('repairs an assertion format through concrete observations and independent interpretation without reediting product code',async()=>{
  const root=await workspace();let editors=0,assertionRepairs=0,assertionDiagnosis=0;
  const task=unit('alpha');task.checks[0]!.expected='The command must demonstrate its requested alpha behavior.';
  const outcome=await runBuild({workspace:root,brief:{...brief,requirements:brief.requirements.slice(0,1)},plan:plan([task]),signal:AbortSignal.timeout(5000),agent:async request=>{
    if(request.instruction.startsWith('Bind a mechanical assertion')){
      const payload=JSON.parse(request.context!);expect(payload.observations[0].observation.stdout).toContain('alpha');
      if(request.role==='repair'){assertionRepairs++;return complete('{"assertions":[{"checkId":"check-alpha","assertion":"It prints alpha successfully."}]}');}
      assertionDiagnosis++;return complete('{"assertions":[{"checkId":"check-alpha","assertion":{"type":"contains","source":"stdout","value":"alpha"}}]}');
    }
    if(request.role==='reviewer')return complete('{"approved":true}');
    editors++;await writeFile(join(request.workspace,'alpha.mjs'),"console.log('alpha');");return complete();
  }});
  expect(outcome.status).toBe('complete');expect(editors).toBe(1);expect(assertionRepairs).toBe(1);expect(assertionDiagnosis).toBe(1);
  expect(outcome.state.evidence.some(item=>item.assertionStatus==='missing'&&!item.passed)).toBe(true);
  expect(outcome.state.tasks.alpha?.checks?.[0]?.expected).toBe('The command must demonstrate its requested alpha behavior.');
  expect(outcome.state.tasks.alpha?.checks?.[0]?.assertion).toEqual({type:'contains',source:'stdout',value:'alpha'});
});

it.each([{kind:'command' as const,mode:'cli' as const},{kind:'cli' as const,mode:'api' as const}])('classifies a wrong generated $kind instrument assertion in a $mode product before editing successful code',async({kind,mode})=>{
  const root=await workspace();let edits=0,diagnoses=0;
  const task=unit('alpha');task.checks=[{...task.checks[0]!,kind,expected:'The product behavior test succeeds.',assertion:{type:'contains',value:'# pass 1'}}];
  const original=plan([task]);
  const outcome=await runBuild({workspace:root,brief:{...brief,modes:[mode],requirements:[{...brief.requirements[0]!,mode:'shared'}]},plan:original,signal:AbortSignal.timeout(5000),agent:async request=>{
    if(request.instruction.startsWith('Classify a successful verification')){diagnoses++;return complete('{"kind":"instrument","cause":"The runner reports a successful result with a different presentation; its generated summary assertion is wrong.","fix":"Bind an assertion to the actually observed alpha output, preserving the behavior criterion."}');}
    if(request.instruction.startsWith('Bind a mechanical assertion'))return complete('{"assertions":[{"checkId":"check-alpha","assertion":{"type":"contains","source":"stdout","value":"alpha"}}]}');
    if(request.role==='reviewer')return complete('{"approved":true}');edits++;await writeFile(join(request.workspace,'alpha.mjs'),"console.log('alpha');");return complete();
  }});
  expect(outcome.status).toBe('complete');expect(edits).toBe(1);expect(diagnoses).toBe(1);
  const negative=outcome.state.evidence.find(item=>!item.passed)!;expect(negative.classification).toBe('product');
  expect(outcome.state.proofInterpretations?.some(item=>item.evidenceId===negative.id&&item.classification==='instrument')).toBe(true);
  expect(outcome.state.evidence.some(item=>item.passed)).toBe(true);
});

it('resumes an interrupted verification state without replaying its editor or reusing a cancelled observation',async()=>{
  const root=await workspace();await writeFile(join(root,'alpha.mjs'),"console.log('alpha');");
  const controller=new AbortController();let probes=0,editors=0;
  const options={workspace:root,brief:{...brief,requirements:brief.requirements.slice(0,1)},plan:plan([unit('alpha')]),agent:async(request:Parameters<BuildOptions['agent']>[0])=>{if(request.role==='reviewer')return complete('{"approved":true}');editors++;return complete();}};
  const interrupted=await runBuild({...options,signal:controller.signal,executeCommand:async request=>{const result=await executeCommand(request);probes++;controller.abort();return {...result,cancelled:true,exitCode:null};}});
  expect(interrupted.status).toBe('cancelled');expect(interrupted.state.tasks.alpha?.pendingControlState).toBeTruthy();
  const resumed=await runBuild({...options,state:JSON.parse(JSON.stringify(interrupted.state)),signal:AbortSignal.timeout(4000),executeCommand:async request=>{probes++;return executeCommand(request);}});
  expect(resumed.status).toBe('complete');expect(probes).toBe(2);expect(editors).toBe(0);
  expect(new Set(resumed.state.evidence.map(item=>item.id)).size).toBe(resumed.state.evidence.length);
});
