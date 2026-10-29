import { afterEach, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DevelopmentPlan, ProductBrief, Verification, WorkUnit } from '../../src/domain/types.js';
import { runBuild } from '../../src/execution/build.js';
import type { AgentResult } from '../../src/runtime/types.js';

const roots:string[]=[];
afterEach(async()=>{await Promise.all(roots.splice(0).map(root=>rm(root,{recursive:true,force:true})));});
const complete=(text=''):AgentResult=>({status:'complete',text,commands:[],changedFiles:[]});

it('diagnoses a failing inline fixture before editing and replaces only that recipe while retaining prior proof',async()=>{
  const workspace=await mkdtemp(join(tmpdir(),'capivara-inline-recovery-'));roots.push(workspace);
  const source="console.log(JSON.stringify({title:'hello'}));\n";
  const statement='The CLI returns a record whose title is hello.';
  const brief:ProductBrief={schema:'capivara/product/1',id:'product',revision:1,status:'ready',name:'Records',summary:statement,request:statement,modes:['cli'],targets:['portable'],requirements:[{id:'record',statement,kind:'behavior',mode:'cli',source:{kind:'request',reference:'request',text:statement}}],constraints:[],decisions:[],gaps:[]};
  const healthy:Verification={id:'actual-product',kind:'cli',level:'behavior',command:process.execPath,args:['application.mjs'],expected:statement,assertion:{type:'json',path:['title'],equals:'hello'},inputs:['application.mjs'],requirementIds:['record'],requiredCapabilities:[]};
  const inline=(field:string)=>`import {spawnSync} from 'node:child_process';const result=spawnSync(process.execPath,['application.mjs'],{encoding:'utf8'});if(result.status!==0)throw Error(result.stderr);const record=JSON.parse(result.stdout);if(record.${field}!=='hello')throw Error('Runner fixture expects ${field} but the application contract returns title');console.log('verified hello');`;
  const bad:Verification={id:'inline-reproduction',kind:'command',level:'behavior',command:process.execPath,args:['--input-type=module','-e',inline('message')],expected:'The observed product record has title hello.',assertion:{type:'contains',source:'stdout',value:'verified hello'},inputs:['application.mjs'],requirementIds:['record'],requiredCapabilities:[]};
  const task:WorkUnit={id:'delivery',title:'Records',goal:statement,instructions:'Implement the actual CLI record.',requirementIds:['record'],dependsOn:[],environmentIds:[],contractIds:[],files:['application.mjs'],criteria:[statement],checks:[healthy,bad],risk:'normal',blockedBy:[]};
  const plan:DevelopmentPlan={schema:'capivara/plan/1',status:'ready',revision:1,briefId:brief.id,briefRevision:1,environment:[],contracts:[],tasks:[task]};
  let editors=0,diagnoses=0,recipeRepairs=0;
  const outcome=await runBuild({workspace,brief,plan,repairPlan:async()=>{throw Error('A fixture correction must not replan the product.');},agent:async request=>{
    if(request.role==='editor'){
      editors++;expect(editors).toBe(1);await writeFile(join(request.workspace,'application.mjs'),source);return complete();
    }
    if(request.role==='reviewer'&&request.instruction.startsWith('Classify')){
      diagnoses++;expect(request.readOnly).toBe(true);expect(request.context).toContain('inline-reproduction');
      return complete(JSON.stringify({kind:'instrument',cause:'The supplied contract and actual product response use title; the inline fixture incorrectly reads message.',fix:'Read record.title in the reproduction and preserve the implemented application.'}));
    }
    if(request.role==='reviewer')return complete('{"approved":true,"findings":[]}');
    if(request.role==='repair'){
      recipeRepairs++;expect(request.readOnly).toBe(true);
      expect(request.instruction).toContain('verification recipe');
      return complete(JSON.stringify({checks:[{...bad,args:['--input-type=module','-e',inline('title')]}]}));
    }
    throw Error(`Unexpected role ${request.role}`);
  }});
  expect(outcome.status,JSON.stringify(outcome.incidents)).toBe('complete');
  expect({editors,diagnoses,recipeRepairs}).toEqual({editors:1,diagnoses:1,recipeRepairs:1});
  expect(await readFile(join(workspace,'application.mjs'),'utf8')).toBe(source);
  const current=outcome.state.tasks.delivery!;
  expect(current.checks).toHaveLength(2);
  expect(current.checks?.find(check=>check.id===healthy.id)).toEqual(healthy);
  const previous=outcome.state.evidence.find(proof=>proof.checkId===healthy.id)!;
  expect(previous.passed).toBe(true);
  expect(new Set(outcome.state.evidence.filter(proof=>proof.checkId===healthy.id).map(proof=>proof.id)).size).toBe(1);
  expect(current.verificationEvidence).toContainEqual(expect.objectContaining({checkId:healthy.id,evidenceId:previous.id}));
  const original=outcome.state.evidence.find(proof=>proof.checkId===bad.id&&!proof.passed)!;
  expect(original.observation?.exitCode).not.toBe(0);
  expect(original.output).toContain('Runner fixture expects message');
  expect(outcome.state.proofInterpretations).toContainEqual(expect.objectContaining({evidenceId:original.id,originalClassification:'product',classification:'instrument'}));
  expect(outcome.state.evidence.some(proof=>proof.checkId===bad.id&&proof.passed&&proof.observation?.stdout.includes('verified hello'))).toBe(true);
});
