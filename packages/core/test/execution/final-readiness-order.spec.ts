import { afterEach, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DevelopmentPlan, EnvironmentNode, ProductBrief, WorkUnit } from '../../src/domain/types.js';
import { createBuildState, runBuild } from '../../src/execution/build.js';
import { digest } from '../../src/execution/files.js';
import { prepareEnvironmentNode } from '../../src/execution/environment.js';
import { executeCommand } from '../../src/runtime/command.js';
import type { AgentResult } from '../../src/runtime/types.js';

const roots:string[]=[];
afterEach(async()=>{await Promise.all(roots.splice(0).map(root=>rm(root,{recursive:true,force:true})));});
const complete=(text=''):AgentResult=>({status:'complete',text,commands:[],changedFiles:[]});

it('preserves approved work and defers final provider revalidation while a downstream delivery remains blocked',async()=>{
  const workspace=await mkdtemp(join(tmpdir(),'capivara-final-readiness-'));roots.push(workspace);
  const brief:ProductBrief={schema:'capivara/product/1',id:'b',revision:1,status:'waiting',name:'Commands',summary:'Deliver base and future commands.',request:'Deliver base and future CLI commands.',modes:['cli'],targets:['portable'],requirements:['base','future'].map(id=>({id,statement:`Deliver ${id}.`,mode:'cli',source:{kind:'request',reference:'request',text:`Deliver ${id}.`}})),constraints:[],decisions:[],gaps:[{id:'future-decision',status:'pending',fact:'Future interaction',question:'Which future interaction is required?',reason:'The downstream interaction has not been specified.',impact:'Blocks the future delivery.',category:'behavior',modes:['cli'],options:[],blocks:['future']}]};
  const task=(id:string):WorkUnit=>({id,title:id,goal:`Deliver ${id}.`,instructions:`Implement ${id}.`,requirementIds:[id],dependsOn:[],environmentIds:[],contractIds:[],files:[`${id}.mjs`],criteria:[`The ${id} command runs.`],checks:[{id:`${id}-behavior`,kind:'cli',command:process.execPath,args:[`${id}.mjs`],assertion:{type:'contains',source:'stdout',value:id.toUpperCase()},level:'behavior',inputs:[`${id}.mjs`],requirementIds:[id],requiredCapabilities:[]}],risk:'normal',blockedBy:[]});
  const foundation=task('base'),future=task('future');future.dependsOn=['base'];future.environmentIds=['future-tool'];future.blockedBy=['future-decision'];
  const node:EnvironmentNode={id:'future-tool',name:'Future delivery tool',kind:'tool',identity:{capability:'future-tool',kind:'cli',provider:'Selected interpreter'},dependsOn:[],targets:[],reason:'Needed by the future delivery.',check:{command:process.execPath,args:['-e',"console.log('FUTURE_PROVIDER_READY')"]},prepare:[],provides:{command:[process.execPath]}};
  const prepared=await prepareEnvironmentNode(workspace,node,brief,executeCommand);expect(prepared.ready).toBe(true);
  const plan:DevelopmentPlan={schema:'capivara/plan/1',status:'ready',revision:1,briefId:brief.id,briefRevision:brief.revision,environment:[node],contracts:[],tasks:[foundation,future],acceptance:[]};
  const state=createBuildState(plan);state.environment[node.id]={ready:true,inputHash:digest(JSON.stringify(node)),fingerprint:prepared.fingerprint,operational:prepared.operational};
  let editors=0,reviewers=0,providerCommands=0,productCommands=0;
  const agent:Parameters<typeof runBuild>[0]['agent']=async request=>{
    expect(request.context).toContain('Work unit base:');
    if(request.role==='reviewer'){reviewers++;return complete('{"approved":true,"findings":[]}');}
    expect(request.role).toBe('editor');editors++;await writeFile(join(request.workspace,'base.mjs'),"console.log('BASE');\n");return complete();
  };
  const execute:typeof executeCommand=async request=>{
    if((typeof request.command==='string'?request.command:request.command.join(' ')).includes('FUTURE_PROVIDER_READY'))providerCommands++;
    if(request.executionPolicy?.purpose==='verification')productCommands++;
    return executeCommand(request);
  };
  const first=await runBuild({workspace,brief,plan,state,agent,executeCommand:execute,signal:AbortSignal.timeout(5000)});
  expect(first.status).toBe('waiting');expect(first.completed).toEqual(['base']);expect(first.pending).toEqual(['future']);
  expect({editors,reviewers,providerCommands,productCommands}).toEqual({editors:1,reviewers:1,providerCommands:0,productCommands:1});
  expect(first.state.metrics?.invalidations).toEqual([]);expect(first.state.tasks.base?.status).toBe('complete');
  expect(first.state.blockers?.some(blocker=>blocker.subject==='scheduler'&&blocker.evidence.includes('future-decision'))).toBe(true);
  expect(await readFile(join(workspace,'base.mjs'),'utf8')).toContain('BASE');
  const before=structuredClone(first.state.tasks.base);
  const resumed=await runBuild({workspace,brief,plan:first.plan,state:structuredClone(first.state),agent,executeCommand:execute,signal:AbortSignal.timeout(5000)});
  expect(resumed.status).toBe('waiting');expect(resumed.state.tasks.base).toEqual(before);
  expect({editors,reviewers,providerCommands,productCommands}).toEqual({editors:1,reviewers:1,providerCommands:0,productCommands:1});
});
