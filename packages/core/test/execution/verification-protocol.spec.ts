import { expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runVerification, selectVerifications } from '../../src/execution/checks.js';
import { executeCommand } from '../../src/runtime/command.js';
import type { DevelopmentPlan, ProductBrief, Verification, WorkUnit } from '../../src/domain/types.js';

it('recovers a generic browser behavior protocol before spawning while preserving explicit CLI product failures',async()=>{
  const workspace=await mkdtemp(join(tmpdir(),'capivara-verification-protocol-'));
  try{
    const brief:ProductBrief={schema:'capivara/product/1',id:'p',revision:1,status:'ready',name:'Interface',summary:'Observe its actual interface.',request:'Observe the web interface and the command interface.',modes:['web','cli'],targets:[],requirements:[],constraints:[],decisions:[],gaps:[]};
    const check:Verification={id:'behavior',kind:'command',command:process.execPath,args:['-e',"throw Error('This incompatible observation must never execute');"],level:'behavior',target:'browser',requiredCapabilities:['browser'],requirementIds:[],inputs:[],expected:'The user observes the actual page.',assertion:{type:'contains',source:'stdout',value:'Actual page state'}};
    const task:WorkUnit={id:'interface',title:'Interface',goal:brief.summary,instructions:'Implement the requested interface.',requirementIds:[],dependsOn:[],environmentIds:[],contractIds:[],files:[],inputs:[],criteria:['The interface works.'],checks:[check],risk:'normal',blockedBy:[]};
    const plan:DevelopmentPlan={schema:'capivara/plan/1',status:'ready',revision:1,briefId:brief.id,briefRevision:1,environment:[],contracts:[],tasks:[task]};
    const original=structuredClone(check),selected=selectVerifications(brief,task)[0]!;
    expect(selected.requiredKind).toBe('web');expect(selected.protocolIssue).toEqual({code:'ambiguous-browser-command',requiredKind:'web',original});
    expect(selected.check).toMatchObject({id:check.id,kind:'web',expected:check.expected,assertion:check.assertion});expect(selected.check.command).toBeUndefined();expect(selected.check.args).toBeUndefined();
    let spawns=0;
    const rejected=await runVerification(workspace,brief,task,plan,check,async request=>{spawns++;return executeCommand(request);},async()=>{throw Error('No terminal instrument is requested.');});
    expect(spawns).toBe(0);expect(rejected).toMatchObject({result:null,classification:'instrument',needsInstrument:true,evidence:{passed:false,kind:'command'}});expect(rejected.evidence.output).toContain('not executed');expect(check).toEqual(original);
    for(const level of ['build','syntax'] as const)expect(selectVerifications(brief,{...task,checks:[{...check,level}]})[0]!.replaced).toBeUndefined();
    const cli:Verification={...check,kind:'cli',command:process.execPath,args:['-e',"process.stderr.write('actual material failure');process.exit(2);"],assertion:{type:'contains',source:'stdout',value:'expected product output'}};
    expect(selectVerifications(brief,{...task,checks:[cli]})[0]!.replaced).toBeUndefined();
    const failure=await runVerification(workspace,brief,task,plan,cli,executeCommand,async()=>{throw Error('No terminal instrument is requested.');});
    expect(failure.classification).toBe('product');expect(failure.needsInstrument).toBe(false);expect(failure.evidence.passed).toBe(false);expect(failure.evidence.output).toContain('actual material failure');expect(failure.result!.exitCode).toBe(2);
  }finally{await rm(workspace,{recursive:true,force:true});}
});

it('executa uma prova técnica na plataforma browser sem promovê-la a interação web',async()=>{
  const workspace=await mkdtemp(join(tmpdir(),'capivara-platform-proof-'));
  try{
    const brief:ProductBrief={schema:'capivara/product/1',id:'p',revision:1,status:'ready',name:'App',summary:'Persist records.',request:'Persist records in a web application.',modes:['web'],targets:['browser'],requirements:[],constraints:[],decisions:[],gaps:[]};
    const script="const{execFileSync}=require('node:child_process');execFileSync(process.execPath,['-e',\"require('node:fs').writeFileSync('record.txt','saved')\"]);const value=execFileSync(process.execPath,['-e',\"process.stdout.write(require('node:fs').readFileSync('record.txt','utf8'))\"],{encoding:'utf8'});if(value!=='saved')throw Error('Record missing in new process');console.log('RESTORED');";
    const check:Verification={id:'restart',kind:'command',command:process.execPath,args:['-e',script],target:'browser',level:'behavior',assertion:{type:'contains',source:'stdout',value:'RESTORED'},requirementIds:[],requiredCapabilities:[]};
    const task:WorkUnit={id:'persistence',title:'Persistence',goal:brief.summary,instructions:brief.summary,requirementIds:[],dependsOn:[],environmentIds:[],contractIds:[],files:[],inputs:[],criteria:[brief.summary],checks:[check],risk:'normal',blockedBy:[]};
    const plan:DevelopmentPlan={schema:'capivara/plan/1',status:'ready',revision:1,briefId:brief.id,briefRevision:1,environment:[],contracts:[],tasks:[task]};
    expect(selectVerifications(brief,task)[0]!.replaced).toBeUndefined();
    const result=await runVerification(workspace,brief,task,plan,check,executeCommand,async()=>{throw Error('No terminal required.');});
    expect(result.evidence.passed,result.evidence.output).toBe(true);
    expect(result.evidence.kind).toBe('command');
    const web=await runVerification(workspace,brief,task,plan,{...check,kind:'web'},executeCommand,async()=>{throw Error('No terminal required.');});
    expect(web.evidence.passed).toBe(false);expect(web.classification).toBe('instrument');
  }finally{await rm(workspace,{recursive:true,force:true});}
});
