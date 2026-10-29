import { afterEach, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { evaluateRecordedObservation, runVerification, verificationIdentity } from '../../src/execution/checks.js';
import { runBuild } from '../../src/execution/build.js';
import { emptyOperationalEnvironment } from '../../src/execution/environment.js';
import { annotateBindingAuthority, recordBindingTransformation } from '../../src/domain/bindings.js';
import { createInspectionIdentity } from '../../src/execution/inspection.js';
import { executeCommand, runTerminal } from '../../src/runtime/index.js';
import type { DevelopmentPlan, ProductBrief, Verification, WorkUnit } from '../../src/domain/types.js';
import type { AgentResult } from '../../src/runtime/types.js';
const roots:string[]=[];
afterEach(async()=>{await Promise.all(roots.splice(0).map(root=>rm(root,{recursive:true,force:true})));});
async function workspace(){const root=await mkdtemp(join(tmpdir(),'capivara-observation-reuse-'));roots.push(root);return root;}
const product:ProductBrief={schema:'capivara/product/1',status:'ready',id:'b',revision:1,name:'Completion CLI',summary:'Report completion with current timing metadata.',request:'Create a CLI that reports completion and its current timing.',modes:['cli'],targets:['portable'],constraints:[],decisions:[],gaps:[],requirements:[{id:'r',statement:'The CLI reports completion and its current timing.',mode:'cli',source:{kind:'request',reference:'request',text:'Create a CLI that reports completion and its current timing.'}}]};
function check():Verification{return{id:'proof',kind:'cli',command:process.execPath,args:['runner.mjs'],inputs:['runner.mjs'],expected:'The CLI reports completion and the current timing metadata.',expectedExitCode:0,level:'behavior',requirementIds:['r'],requiredCapabilities:[]};}
function fixture(recipe=check()){
  const task:WorkUnit={id:'cli',title:'Completion CLI',goal:'Report completion.',instructions:'Implement the completion command.',requirementIds:['r'],dependsOn:[],environmentIds:[],contractIds:[],files:['runner.mjs'],criteria:['Report completion and current timing metadata.'],checks:[recipe],risk:'normal',blockedBy:[]};
  const plan:DevelopmentPlan={schema:'capivara/plan/1',status:'ready',revision:1,briefId:'b',briefRevision:1,environment:[],contracts:[],tasks:[task]};return{task,plan};
}
const source='console.log("completed at "+process.hrtime.bigint());';
const complete=(text=''):AgentResult=>({status:'complete',text,commands:[],changedFiles:[]});
it('preserves receipt identity across classification audit metadata while invalidating changed user outcomes',async()=>{
  const root=await workspace();await writeFile(join(root,'runner.mjs'),source);
  const brief=structuredClone(product),requirement=brief.requirements[0]!;
  requirement.binding={capability:'extracted role',kind:'runtime',provider:'Node.js'};requirement.source.text='Node.js';
  const recipe=check(),{plan,task}=fixture(recipe),before=await verificationIdentity(root,plan,task,recipe,brief);
  const inspectionBefore=await createInspectionIdentity(root,brief,plan,task);
  annotateBindingAuthority(requirement,'Use Node.js.','init');
  recordBindingTransformation(requirement,{capability:'operational interpreter',kind:'runtime',provider:'Node.js'});
  expect(requirement.bindingTransformations).toHaveLength(1);
  expect(await verificationIdentity(root,plan,task,recipe,brief)).toEqual(before);
  expect((await createInspectionIdentity(root,brief,plan,task)).authorityHash).toBe(inspectionBefore.authorityHash);
  requirement.statement+=' It must also reject invalid input.';
  expect((await verificationIdentity(root,plan,task,recipe,brief)).inputHash).not.toBe(before.inputHash);
  expect((await createInspectionIdentity(root,brief,plan,task)).authorityHash).not.toBe(inspectionBefore.authorityHash);
});
it('separates execution identity from only criterion and assertion fields',async()=>{
  const root=await workspace();await writeFile(join(root,'runner.mjs'),source);const recipe=check(),{plan,task}=fixture(recipe),base=await verificationIdentity(root,plan,task,recipe,product);
  for(const revised of [{...recipe,expected:'A clarified criterion.'},{...recipe,assertion:{type:'contains' as const,value:'completed'}},{...recipe,assertionIssue:'An invalid predicate'}]){
    const next=await verificationIdentity(root,plan,task,revised,product);expect(next.inputHash).not.toBe(base.inputHash);expect(next.observationHash).toBe(base.observationHash);
  }
  for(const revised of [{...recipe,args:['runner.mjs','new argument']},{...recipe,expectedExitCode:7},{...recipe,requiredCapabilities:['browser']},{...recipe,steps:[{input:'x',waitFor:'next'}]}])expect((await verificationIdentity(root,plan,task,revised,product)).observationHash).not.toBe(base.observationHash);
  const environment=emptyOperationalEnvironment(root);environment.env.FIXTURE_SETTING='changed';expect((await verificationIdentity(root,plan,task,recipe,product,environment)).observationHash).not.toBe(base.observationHash);
  await writeFile(join(root,'runner.mjs'),source+'\n// actual source change');expect((await verificationIdentity(root,plan,task,recipe,product)).observationHash).not.toBe(base.observationHash);
});
it('reinterprets an actual successful observation without changing its raw result or original timestamp',async()=>{
  const root=await workspace();await writeFile(join(root,'runner.mjs'),source);const recipe=check(),{plan,task}=fixture(recipe);let commands=0;
  const pending=await runVerification(root,product,task,plan,recipe,async request=>{commands++;return executeCommand(request);},runTerminal);expect(pending.classification).toBe('instrument');const original=JSON.stringify(pending.evidence);
  const revised:Verification={...recipe,assertion:{type:'contains',value:pending.evidence.observation!.stdout.trim(),source:'stdout'}},identity=await verificationIdentity(root,plan,task,revised,product);
  const reinterpreted=evaluateRecordedObservation(revised,pending.evidence,identity)!;expect(reinterpreted.evidence.passed).toBe(true);expect(reinterpreted.result).toBeNull();expect(reinterpreted.evidence.reinterpretedFrom).toBe(pending.evidence.id);expect(reinterpreted.evidence.observedAt).toBe(pending.evidence.observedAt);expect(reinterpreted.evidence.observation).toEqual(pending.evidence.observation);expect(JSON.stringify(pending.evidence)).toBe(original);expect(commands).toBe(1);
  const invalid={...recipe,assertionIssue:'Missing typed assertion'};const unresolved=evaluateRecordedObservation(invalid,pending.evidence,await verificationIdentity(root,plan,task,invalid,product));expect(unresolved?.classification).toBe('instrument');expect(unresolved?.evidence.passed).toBe(false);expect(commands).toBe(1);
});
it('does not reinterpret material CLI mismatches or interrupted observations as approvals',async()=>{
  const root=await workspace();await writeFile(join(root,'runner.mjs'),'console.log("wrong actual output");');const recipe:Verification={...check(),assertion:{type:'contains',value:'correct actual output'}},{plan,task}=fixture(recipe);
  const material=await runVerification(root,product,task,plan,recipe,executeCommand,runTerminal);expect(material.classification).toBe('product');const revised:Verification={...recipe,assertion:{type:'contains',value:'wrong actual output'}},identity=await verificationIdentity(root,plan,task,revised,product);
  expect(evaluateRecordedObservation(revised,material.evidence,identity)).toBeUndefined();
  for(const altered of [{...material.evidence,classification:'instrument' as const,observation:{...material.evidence.observation!,cancelled:true}},{...material.evidence,classification:'instrument' as const,observation:{...material.evidence.observation!,timedOut:true}},{...material.evidence,classification:'instrument' as const,observation:{...material.evidence.observation!,exitCode:1}}])expect(evaluateRecordedObservation(revised,altered,identity)).toBeUndefined();
});
it('finishes and resumes with one actual volatile-output execution, one binding and no extra editor',async()=>{
  const root=await workspace(),{plan}=fixture();let editors=0,bindings=0,reviews=0,commands=0;
  const options={workspace:root,brief:product,plan,signal:AbortSignal.timeout(5000),executeCommand:async(request:Parameters<typeof executeCommand>[0])=>{if(request.executionPolicy?.purpose==='verification')commands++;return executeCommand(request);},agent:async(request:Parameters<Parameters<typeof runBuild>[0]['agent']>[0])=>{
    if(request.context?.includes('"operation":"bind-observed-assertion"')){bindings++;const payload=JSON.parse(request.context) as {observations:{check:{id:string};observation:{stdout:string}}[]};return complete(JSON.stringify({assertions:payload.observations.map(item=>({checkId:item.check.id,assertion:{type:'contains',source:'stdout',value:item.observation.stdout.trim()}}))}));}
    if(request.role==='reviewer'){reviews++;return complete('{"approved":true,"findings":[]}');}
    editors++;await writeFile(join(request.workspace,'runner.mjs'),source);return complete();
  }};
  const result=await runBuild(options);expect(result.status,JSON.stringify(result.incidents)).toBe('complete');expect({editors,bindings,reviews,commands}).toEqual({editors:1,bindings:1,reviews:1,commands:1});
  const original=result.state.evidence.find(item=>item.assertionStatus==='missing')!,interpreted=result.state.evidence.find(item=>item.passed&&item.reinterpretedFrom===original.id)!;expect(original.passed).toBe(false);expect(interpreted.observedAt).toBe(original.observedAt);expect(interpreted.observation).toEqual(original.observation);
  const resumed=await runBuild({...options,state:JSON.parse(JSON.stringify(result.state)),plan:result.plan,signal:AbortSignal.timeout(5000)});expect(resumed.status,JSON.stringify(resumed.incidents)).toBe('complete');expect({editors,bindings,reviews,commands}).toEqual({editors:1,bindings:1,reviews:1,commands:1});
});
