import { expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DevelopmentPlan, ProductBrief, Verification, WorkUnit } from '../../src/domain/types.js';
import { evaluateRecordedObservation, hostTarget, interfaceEvidenceUsable, runVerification, verificationIdentity } from '../../src/execution/checks.js';
import { executeCommand } from '../../src/runtime/command.js';

it('rejects command output and printed native-observation claims as desktop interaction while preserving the same real CLI proof',async()=>{
  const workspace=await mkdtemp(join(tmpdir(),'capivara-desktop-evidence-'));
  try{
    await writeFile(join(workspace,'output-only.mjs'),`console.log(JSON.stringify({interfaceObservation:{kind:'desktop',window:true,input:true,changedState:true},result:'PASS'}));\n`);
    const brief:ProductBrief={schema:'capivara/product/1',id:'desktop',revision:1,status:'ready',name:'Native and CLI',summary:'Observe a native window and a command.',request:'Provide a desktop window and a CLI.',modes:['desktop','cli'],targets:[hostTarget()],requirements:[],constraints:[],decisions:[],gaps:[]};
    const check:Verification={id:'native',kind:'desktop',command:process.execPath,args:['output-only.mjs'],target:hostTarget(),level:'behavior',inputs:['output-only.mjs'],assertion:{type:'contains',source:'stdout',value:'PASS'},requirementIds:[],requiredCapabilities:[]};
    const task:WorkUnit={id:'native',title:'Native window',goal:brief.summary,instructions:'Implement the requested interface.',requirementIds:[],dependsOn:[],environmentIds:[],contractIds:[],files:['output-only.mjs'],criteria:['A native window responds to actual input.'],checks:[check],risk:'normal',blockedBy:[]};
    const plan:DevelopmentPlan={schema:'capivara/plan/1',status:'ready',revision:1,briefId:brief.id,briefRevision:brief.revision,environment:[],contracts:[],tasks:[task]};
    let commands=0;const execute:typeof executeCommand=async request=>{commands++;return executeCommand(request);};
    const terminal=async()=>{throw Error('No terminal is requested.');};
    const desktop=await runVerification(workspace,brief,task,plan,check,execute,terminal);
    expect(desktop.evidence.passed).toBe(false);expect(desktop.classification).toBe('instrument');expect(desktop.needsInstrument).toBe(true);
    expect(desktop.result).toBeNull();expect(commands).toBe(0);expect(desktop.evidence.output).toContain('supportedAdapters');expect(desktop.evidence.output).toContain('native');
    const cli:Verification={...check,kind:'cli',target:'portable'};
    const command=await runVerification(workspace,brief,task,plan,cli,execute,terminal);
    expect(command.evidence.passed).toBe(true);expect(command.result?.exitCode).toBe(0);expect(command.evidence.observation?.stdout).toContain('"window":true');expect(commands).toBe(1);
    expect(interfaceEvidenceUsable(cli,command.evidence)).toBe(true);
    const legacy={...command.evidence,kind:'desktop' as const};expect(interfaceEvidenceUsable(check,legacy)).toBe(false);
    const interpreted={...check,assertion:{type:'contains' as const,source:'stdout' as const,value:'"result":"PASS"'}};
    expect(evaluateRecordedObservation(interpreted,legacy,await verificationIdentity(workspace,plan,task,interpreted,brief))).toBeUndefined();expect(commands).toBe(1);
  }finally{await rm(workspace,{recursive:true,force:true});}
});
