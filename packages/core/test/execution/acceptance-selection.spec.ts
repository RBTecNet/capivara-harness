import { afterEach, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { selectPendingAcceptance } from '../../src/execution/acceptance-selection.js';
import { runVerification } from '../../src/execution/checks.js';
import { mergeOperationalEnvironments } from '../../src/execution/environment.js';
import { executeCommand, runTerminal } from '../../src/runtime/index.js';
import type { DevelopmentPlan, ProductBrief, Verification, WorkUnit } from '../../src/domain/types.js';

const temporary:string[]=[];
afterEach(async()=>{await Promise.all(temporary.splice(0).map(root=>rm(root,{recursive:true,force:true})));});
async function fixture(sdk=false){
  const workspace=await mkdtemp(join(tmpdir(),'capivara-acceptance-selection-'));temporary.push(workspace);
  const binding={capability:'implementation',kind:sdk?'sdk' as const:'runtime' as const,provider:'Required provider'};
  const brief:ProductBrief={schema:'capivara/product/1',status:'ready',id:'product',revision:1,name:'Application',summary:'Use a required provider.',request:`Use Required provider as ${binding.kind}.`,modes:['cli'],targets:['portable'],requirements:[{id:'stack',statement:`Use Required provider as ${binding.kind}.`,kind:'stack',binding,mode:'shared',source:{kind:'request',reference:'request',text:`Required provider ${binding.kind}`}}],constraints:[],decisions:[],gaps:[]};
  const task:WorkUnit={id:'implementation',title:'Application',goal:'Execute product behavior.',instructions:'Implement the application.',requirementIds:['stack'],dependsOn:[],environmentIds:['provider'],contractIds:[],files:sdk?['compiler.mjs','input.expr','out/run.mjs']:['app.mjs'],criteria:['The required provider executes the product.'],checks:[],risk:'normal',blockedBy:[]};
  const own:Verification={id:'own',kind:'command',command:process.execPath,args:sdk?['compiler.mjs','input.expr','out/run.mjs']:['app.mjs'],level:sdk?'build':'behavior',...(sdk?{expectedExitCode:0,outputs:['out/run.mjs']}:{assertion:{type:'contains' as const,value:'HELLO'}}),inputs:sdk?['compiler.mjs','input.expr']:['app.mjs'],requirementIds:['stack'],requiredCapabilities:[],conformance:{...binding,requirementId:'stack',productInputs:sdk?['input.expr']:['app.mjs'],...(sdk?{artifacts:['out/run.mjs']}:{})}};
  const operational=mergeOperationalEnvironments(workspace,{root:workspace,revision:'',env:{},bindings:{provider:{...binding,ready:true,fingerprint:'fixture',command:sdk?[process.execPath,join(workspace,'compiler.mjs')]:[process.execPath]}}});
  const plan:DevelopmentPlan={schema:'capivara/plan/1',status:'ready',revision:1,briefId:brief.id,briefRevision:brief.revision,environment:[{id:'provider',name:'Required provider',kind:sdk?'sdk':'runtime',identity:binding,dependsOn:[],targets:[],reason:'Execute the product.',check:{command:process.execPath,args:['--version']},prepare:[]}],contracts:[],tasks:[task],acceptance:[]};
  if(sdk){
    await mkdir(join(workspace,'out'));await writeFile(join(workspace,'input.expr'),'2 + 3');
    await writeFile(join(workspace,'compiler.mjs'),"import{readFileSync,writeFileSync}from'node:fs';const [source,out]=process.argv.slice(2);const [a,b]=readFileSync(source,'utf8').split('+').map(Number);writeFileSync(out,`console.log(${a+b});`);");
  }else await writeFile(join(workspace,'app.mjs'),"import{existsSync,readFileSync,writeFileSync}from'node:fs';const p='runs.txt';writeFileSync(p,String((existsSync(p)?Number(readFileSync(p,'utf8')):0)+1));console.log('HELLO');");
  task.checks=[own];
  const observed=await runVerification(workspace,brief,task,plan,own,executeCommand,runTerminal,{operational});expect(observed.evidence.passed).toBe(true);
  const global:Verification={...structuredClone(own),id:'global',expected:'A translated description of the same criterion.'};
  const select=(checks:Verification[],proofs=[observed.evidence])=>selectPendingAcceptance({brief,plan,operational,currentTaskProofs:proofs,workspace,checks});
  return{workspace,brief,plan,operational,task,own,observed,global,select};
}

it('reuses an identical current task observation without creating a global PASS or executing the command again',async()=>{
  const f=await fixture(),before=structuredClone(f.observed.evidence);
  const result=await f.select([f.global]);
  expect(result.checks).toEqual([]);expect(result.reused).toEqual([{checkId:'global',receiptIds:[f.observed.evidence.id],requirementIds:['stack']}]);
  expect(f.observed.evidence).toEqual(before);expect(await readFile(join(f.workspace,'runs.txt'),'utf8')).toBe('1');
});

it('keeps behavior obligations, constraints and different invocations or predicates',async()=>{
  const f=await fixture();f.brief.requirements.push({id:'behavior',statement:'Persist after a restart.',kind:'behavior',mode:'shared',source:{kind:'request',reference:'request',text:'Persist after a restart.'}});
  const checks:Verification[]=[{...f.global,id:'behavior',requirementIds:['stack','behavior']},{...f.global,id:'constraint',constraintIds:['specific-constraint']},{...f.global,id:'different-command',args:['app.mjs','--restart']},{...f.global,id:'different-predicate',assertion:{type:'contains',value:'RESTARTED'}},{...f.global,id:'different-input',input:['restart\n']}];
  const result=await f.select(checks);expect(result.checks).toEqual(checks);expect(result.reused).toEqual([]);
});

it('keeps additional global inputs, product scopes and changed source that the task snapshot cannot prove',async()=>{
  const f=await fixture();await writeFile(join(f.workspace,'extra.mjs'),'export const extra=true;');
  const checks:Verification[]=[{...f.global,id:'new-input',inputs:['app.mjs','extra.mjs']},{...f.global,id:'new-product',conformance:{...f.global.conformance!,productInputs:['app.mjs','extra.mjs']}},{...f.global,id:'missing-input',inputs:['app.mjs','missing.json']},{...f.global,id:'invalid-selector',inputs:['../outside']}];
  expect((await f.select(checks)).checks).toEqual(checks);
  await writeFile(join(f.workspace,'app.mjs'),"console.log('CHANGED');");expect((await f.select([f.global])).checks).toEqual([f.global]);
});

it('retains every producer needed by a final verification that remains pending',async()=>{
  const f=await fixture();const consumer:Verification={...f.global,id:'consumer',requirementIds:[],dependsOn:['global']};delete consumer.conformance;
  const result=await f.select([f.global,consumer]);expect(result.checks).toEqual([f.global,consumer]);expect(result.reused).toEqual([]);
  expect(result.retained.find(check=>check.checkId==='global')?.reason).toBe('required-by-pending-final-verification');
});

it('requires the real SDK artifact and dependent functional receipt before reusing a build observation',async()=>{
  const f=await fixture(true);
  expect((await f.select([f.global])).checks).toEqual([f.global]);
  const run:Verification={id:'functional',kind:'command',command:process.execPath,args:['out/run.mjs'],level:'behavior',assertion:{type:'contains',value:'5'},inputs:['out/run.mjs'],requirementIds:['stack'],requiredCapabilities:[],dependsOn:['own']};
  f.task.checks.push(run);const functional=await runVerification(f.workspace,f.brief,f.task,f.plan,run,executeCommand,runTerminal,{operational:f.operational});expect(functional.evidence.passed).toBe(true);
  const result=await f.select([f.global],[f.observed.evidence,functional.evidence]);expect(result.checks).toEqual([]);expect(result.reused[0]!.receiptIds).toEqual([f.observed.evidence.id,functional.evidence.id]);
  const finalConsumer={...run,id:'final-functional',dependsOn:['global']};
  expect((await f.select([f.global,finalConsumer],[f.observed.evidence,functional.evidence])).checks).toEqual([f.global,finalConsumer]);
});
