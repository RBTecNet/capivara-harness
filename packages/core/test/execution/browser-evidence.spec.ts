import { expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DevelopmentPlan, ProductBrief, Verification, WorkUnit } from '../../src/domain/types.js';
import { evaluateRecordedObservation, interfaceEvidenceUsable, runVerification, verificationIdentity } from '../../src/execution/checks.js';
import { executeCommand } from '../../src/runtime/command.js';
import { narrowUnobservedWebRecipe } from '../../src/execution/verification-interface-recovery.js';

it('preserves a real passing Node test observation while rejecting its relabeling or cached reinterpretation as browser behavior',async()=>{
  const workspace=await mkdtemp(join(tmpdir(),'capivara-browser-evidence-'));
  try{
    await writeFile(join(workspace,'package.json'),JSON.stringify({name:'interface-proof-fixture',version:'1.0.0',scripts:{test:'node --test api.test.cjs'}}));
    await writeFile(join(workspace,'api.test.cjs'),"const{test}=require('node:test');const assert=require('node:assert/strict');test('actual API contract',()=>assert.equal(JSON.parse('{\"healthy\":true}').healthy,true));\n");
    const brief:ProductBrief={schema:'capivara/product/1',id:'b',revision:1,status:'ready',name:'Web and API',summary:'Observe web behavior and API tests.',request:'Observe the web interface and run the API tests.',modes:['web','api'],targets:['browser'],requirements:[],constraints:[],decisions:[],gaps:[]};
    const check:Verification={id:'web-tests',kind:'web',command:'npm',args:['run','test'],level:'behavior',target:'browser',inputs:['package.json','api.test.cjs'],assertion:{type:'contains',source:'stdout',value:'tests 1'},requirementIds:[],requiredCapabilities:[]};
    const task:WorkUnit={id:'tests',title:'Tests',goal:brief.summary,instructions:'Execute the existing suite.',requirementIds:[],dependsOn:[],environmentIds:[],contractIds:[],files:['api.test.cjs'],criteria:['The actual browser flow works.'],checks:[check],risk:'normal',blockedBy:[]};
    const plan:DevelopmentPlan={schema:'capivara/plan/1',status:'ready',revision:1,briefId:brief.id,briefRevision:brief.revision,environment:[],contracts:[],tasks:[task]};
    let commands=0;
    const execute:typeof executeCommand=async request=>{commands++;return executeCommand(request);};
    const terminal=async()=>{throw Error('No terminal interaction is requested.');};
    const mislabeled=await runVerification(workspace,brief,task,plan,check,execute,terminal);
    expect(commands).toBe(1);expect(mislabeled.result?.exitCode).toBe(0);expect(mislabeled.evidence.observation?.stdout).toContain('tests 1');
    expect(mislabeled.evidence.passed).toBe(false);expect(mislabeled.classification).toBe('instrument');expect(mislabeled.needsInstrument).toBe(true);
    expect(mislabeled.evidence.output).toContain('Observed browser interface:');expect(mislabeled.evidence.output).toContain('"launched":0');expect(mislabeled.evidence.output).toContain('Interface observation contract:');
    expect(mislabeled.evidence.browserObservation?.witnesses).toEqual([]);expect(interfaceEvidenceUsable(check,mislabeled.evidence)).toBe(false);
    const legacy={...mislabeled.evidence,passed:true};delete legacy.browserObservation;
    expect(interfaceEvidenceUsable(check,legacy)).toBe(false);
    const interpreted={...check,assertion:{type:'contains' as const,source:'stdout' as const,value:'pass 1'}};
    const identity=await verificationIdentity(workspace,plan,task,interpreted,brief);
    expect(evaluateRecordedObservation(interpreted,legacy,identity)).toBeUndefined();expect(commands).toBe(1);
    const narrowed=narrowUnobservedWebRecipe(check,mislabeled);
    expect(narrowed).toBeDefined();expect(narrowed!.check).toMatchObject({kind:'command',level:'behavior',command:check.command,args:check.args,requirementIds:check.requirementIds,assertion:check.assertion});
    expect(narrowed!.check.target).toBeUndefined();expect(narrowed!.transformation).toMatchObject({sourceEvidenceId:mislabeled.evidence.id,original:check,interfaceObligation:'web-still-required'});
    expect(mislabeled.evidence.passed).toBe(false);expect(check.kind).toBe('web');
    expect(narrowUnobservedWebRecipe({...check,level:'build'},mislabeled)!.check.level).toBe('behavior');
    const derived:Verification={...check,id:'known-build',kind:'command',command:'npm run test',level:'build'};delete derived.args;
    expect(narrowUnobservedWebRecipe(check,mislabeled,[derived])!.check.level).toBe('build');
    expect(narrowUnobservedWebRecipe(check,{...mislabeled,classification:'product'})).toBeUndefined();
    expect(narrowUnobservedWebRecipe(check,{...mislabeled,result:{...mislabeled.result!,exitCode:1}})).toBeUndefined();
    const attempted={...mislabeled,evidence:{...mislabeled.evidence,browserObservation:{...mislabeled.evidence.browserObservation!,witnesses:[{source:'playwright-public-api' as const,invocationId:'observed',pid:123,sequence:1,observedAt:new Date().toISOString(),phase:'navigation' as const,status:'failed' as const,operation:'goto',browserId:'browser',contextId:'context',pageId:'page',url:'http://127.0.0.1/product',error:'Real page interaction failed.'}]}}};
    expect(narrowUnobservedWebRecipe(check,attempted)).toBeUndefined();
    const api=narrowed!.check;
    const actual=await runVerification(workspace,brief,task,plan,api,execute,terminal);
    expect(actual.evidence.passed).toBe(true);expect(actual.classification).toBeNull();expect(interfaceEvidenceUsable(api,actual.evidence)).toBe(true);expect(commands).toBe(2);
    expect(interfaceEvidenceUsable(check,actual.evidence)).toBe(false);
  }finally{await rm(workspace,{recursive:true,force:true});}
});
