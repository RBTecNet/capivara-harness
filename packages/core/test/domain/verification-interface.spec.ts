import { expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { normalizeChecks } from '../../src/domain/plan.js';
import { verificationInterfaceDeclaration } from '../../src/domain/verification-declarations.js';
import { hostTarget, runVerification } from '../../src/execution/checks.js';
import { executeCommand } from '../../src/runtime/command.js';
import type { DevelopmentPlan, ProductBrief, WorkUnit } from '../../src/domain/types.js';

it('decodes an explicit CLI target without another recipe, preserving argv, audit and genuine product failures',async()=>{
  const workspace=await mkdtemp(join(tmpdir(),'capivara-interface-decode-'));
  try{
    const brief:ProductBrief={schema:'capivara/product/1',id:'p',revision:1,status:'ready',name:'CLI',summary:'Print healthy.',request:'Create a CLI printing healthy.',modes:['cli'],targets:[],requirements:[],constraints:[],decisions:[],gaps:[]};
    const declaration={id:'behavior',kind:'command',target:'cli',platform:hostTarget(),command:process.platform==='win32'?'py':'python3',args:['main.py'],level:'behavior',inputs:['main.py'],requirementIds:[],requiredCapabilities:[],assertion:{type:'contains',source:'stdout',value:'healthy'}};
    const before=structuredClone(declaration),check=normalizeChecks([declaration],brief)[0]!;
    expect(check.kind).toBe('cli');expect(check.target).toBe(hostTarget());expect(check.command).toBe(declaration.command);expect(check.args).toEqual(declaration.args);
    expect(check.declarationTransformation).toEqual({schema:'capivara/verification-interface/1',original:{kind:'command',target:'cli'},selectedKind:'cli',reason:'explicit-interface-target'});
    expect(normalizeChecks([check],brief)[0]).toEqual(check);expect(declaration).toEqual(before);
    for(const target of ['cli','tui','web','desktop'])expect(verificationInterfaceDeclaration({target}).kind).toBe(target);
    expect(verificationInterfaceDeclaration({kind:'command',target:'browser'})).toEqual({kind:'command',target:'browser'});
    expect(verificationInterfaceDeclaration({kind:'cli',target:'web'}).kind).toBe('cli');
    expect(normalizeChecks([{id:'api',kind:'api',command:'python3',args:['api.py'],expected:'The CLI request returns API data.'}],brief)[0]!.kind).toBe('command');
    const forged=normalizeChecks([{...check,kind:'command',declarationTransformation:{...check.declarationTransformation,selectedKind:'web',original:{kind:'command',target:'web'}}}],brief)[0]!;
    expect(forged.kind).toBe('command');expect(forged.declarationTransformation).toBeUndefined();
    const task:WorkUnit={id:'cli',title:'CLI',goal:brief.summary,instructions:'Implement the requested command.',requirementIds:[],dependsOn:[],environmentIds:[],contractIds:[],files:['main.py'],criteria:['The actual CLI prints healthy.'],checks:[check],risk:'normal',blockedBy:[]};
    const plan:DevelopmentPlan={schema:'capivara/plan/1',status:'ready',revision:1,briefId:brief.id,briefRevision:brief.revision,environment:[],contracts:[],tasks:[task]};
    const terminal=async()=>{throw Error('A CLI recipe does not require a PTY.');};
    await writeFile(join(workspace,'main.py'),"print('healthy')\n");
    const passed=await runVerification(workspace,brief,task,plan,check,executeCommand,terminal);
    expect(passed.evidence.passed).toBe(true);expect(passed.evidence.kind).toBe('cli');
    await writeFile(join(workspace,'main.py'),'def broken(:\n');
    const broken=await runVerification(workspace,brief,task,plan,check,executeCommand,terminal);
    expect(broken.classification).toBe('product');expect(broken.evidence.passed).toBe(false);expect(broken.evidence.output).toContain('SyntaxError');
  }finally{await rm(workspace,{recursive:true,force:true});}
});
