import { expect, it } from 'vitest';
import { access, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { inlineVerificationSyntaxRequired, runVerification } from '../../src/execution/checks.js';
import { emptyOperationalEnvironment } from '../../src/execution/environment.js';
import { executeCommand } from '../../src/runtime/command.js';
import type { CommandRequest } from '../../src/runtime/types.js';
import type { DevelopmentPlan, ProductBrief, Verification, WorkUnit } from '../../src/domain/types.js';

it('parses only inline verifier code without startup execution, preserving imported product syntax errors and reusing grammar checks',async()=>{
  const workspace=await mkdtemp(join(tmpdir(),'capivara-inline-verifier-'));
  try{
    const marker=join(workspace,'startup-ran'),startup=join(workspace,'startup.mjs'),startupURL=pathToFileURL(startup).href;
    await writeFile(startup,`import{writeFileSync}from'node:fs';writeFileSync(${JSON.stringify(marker)},'loaded');`);
    await writeFile(join(workspace,'broken-product.mjs'),'export const value = ;');
    const brief:ProductBrief={schema:'capivara/product/1',id:'p',revision:1,status:'ready',name:'API',summary:'Observe the real API.',request:'Build an API.',modes:['api'],targets:[],requirements:[],constraints:[],decisions:[],gaps:[]};
    const quote=(value:string)=>`'${value.replaceAll("'","'\\''")}'`;
    const check:Verification={id:'api',kind:'command',command:`${quote(process.execPath)} --import ${quote(startupURL)} --input-type=module -e ${quote('<inline Node.js runner>')}`,level:'behavior',requirementIds:[],requiredCapabilities:[],inputs:[],assertion:{type:'exit',value:0}};
    const task:WorkUnit={id:'api',title:'API',goal:brief.summary,instructions:'Implement the API.',requirementIds:[],dependsOn:[],environmentIds:[],contractIds:[],files:[],inputs:[],criteria:['The actual API responds.'],checks:[check],risk:'normal',blockedBy:[]};
    const plan:DevelopmentPlan={schema:'capivara/plan/1',status:'ready',revision:1,briefId:brief.id,briefRevision:1,environment:[],contracts:[],tasks:[task]};
    const operational={...emptyOperationalEnvironment(workspace),env:{NODE_OPTIONS:`--import ${startupURL}`}};
    let parses=0,productExecutions=0;
    const execute=async(request:CommandRequest)=>{
      const argv=typeof request.command==='string'?[]:request.command;
      if(argv.includes('--check')){parses++;expect(request.environment?.NODE_OPTIONS).toBe('');expect(argv).not.toContain('--import');expect(request.input).toBeDefined();}
      else productExecutions++;
      return executeCommand(request);
    };
    const terminal=async()=>{throw Error('No terminal interaction was requested.');};
    const invalid=await runVerification(workspace,brief,task,plan,check,execute,terminal,{operational});
    expect(parses).toBe(1);expect(productExecutions).toBe(0);expect(invalid.classification).toBe('instrument');expect(invalid.result).toBeNull();expect(invalid.evidence.output).toContain('product was NOT executed');
    expect(invalid.evidence.observation).toBeUndefined();expect(invalid.evidence.provenance).toBeUndefined();expect(invalid.evidence.instrumentSyntaxChecked).toMatchObject({protocol:'inline-node-syntax/1',passed:false});
    await expect(access(marker)).rejects.toThrow();
    await runVerification(workspace,brief,task,plan,check,execute,terminal,{operational});expect(parses).toBe(1);expect(productExecutions).toBe(0);
    const valid:Verification={...check,command:process.execPath,args:['--import',startupURL,'--input-type=module','-e','await import("./broken-product.mjs")'],inputs:['startup.mjs','broken-product.mjs']};
    const failure=await runVerification(workspace,brief,task,plan,valid,execute,terminal,{operational});
    expect(parses).toBe(2);expect(productExecutions).toBe(1);expect(failure.classification).toBe('product');expect(failure.needsInstrument).toBe(false);expect(failure.evidence.observation?.exitCode).toBe(1);expect(failure.evidence.output).toContain('broken-product.mjs');
    expect(failure.evidence.instrumentSyntaxChecked).toMatchObject({protocol:'inline-node-syntax/1',passed:true});await expect(access(marker)).resolves.toBeUndefined();
    await writeFile(join(workspace,'broken-product.mjs'),'export const value = ( ;');
    const changed=await runVerification(workspace,brief,task,plan,valid,execute,terminal,{operational});
    expect(changed.classification).toBe('product');expect(parses).toBe(2);expect(productExecutions).toBe(2);
    expect(inlineVerificationSyntaxRequired({...valid,kind:'cli'})).toBe(false);expect(inlineVerificationSyntaxRequired({...valid,kind:'tui'})).toBe(false);
  }finally{await rm(workspace,{recursive:true,force:true});}
});
