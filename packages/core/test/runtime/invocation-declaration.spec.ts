import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { executeCommand, quoteArgument } from '../../src/runtime/command.js';
import { inlineVerificationSyntaxRequired, runVerification, verificationIdentity } from '../../src/execution/checks.js';
import { digest } from '../../src/execution/files.js';
import type { DevelopmentPlan, ProductBrief, Verification, WorkUnit } from '../../src/domain/types.js';
import type { OperationalEnvironment } from '../../src/execution/environment.js';

describe('literal invocation declarations', () => {
  it('executes a duplicated Python declaration once and returns typed startup failures without changing product code', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'capivara-invocation-'));
    try {
      const code = "from pathlib import Path; p=Path('observations'); p.write_text((p.read_text() if p.exists() else '')+'once\\n'); print('real-python-observation')" + '; ' + ' ' .repeat(220);
      const original = [`python3 -c ${quoteArgument(code)}`, '-c', code];
      expect(original[0]!.length).toBeGreaterThan(255);
      const result = await executeCommand({ cwd, command: original, inputs: [], timeoutMs: 3000 });
      expect(result.exitCode).toBe(0);
      expect(result.issue).toBeUndefined();
      expect(result.stdout).toBe('real-python-observation\n');
      expect(await readFile(join(cwd, 'observations'), 'utf8')).toBe('once\n');
      expect(result.invocationTransformation).toEqual({ schema: 'capivara/invocation/1', original, resolved: ['python3', '-c', code], reason: 'duplicate-literal-arguments' });
      expect(result.command).toContain('python3 -c');

      const brief:ProductBrief={schema:'capivara/product/1',id:'p',revision:1,status:'ready',name:'CLI',summary:'Observe the requested command.',request:'Create a CLI.',modes:['cli'],targets:[],requirements:[],constraints:[],decisions:[],gaps:[]};
      const check:Verification={id:'actual-cli',kind:'cli',command:`python-proof -c ${quoteArgument("print('actual-cli')")}`,args:['-c',"print('actual-cli')"],inputs:[],level:'behavior',requirementIds:[],requiredCapabilities:[],assertion:{type:'contains',value:'actual-cli'}};
      const task:WorkUnit={id:'cli',title:'CLI',goal:brief.summary,instructions:'Implement the command.',requirementIds:[],dependsOn:[],environmentIds:[],contractIds:[],files:[],inputs:[],criteria:['The command responds.'],checks:[check],risk:'normal',blockedBy:[]};
      const plan:DevelopmentPlan={schema:'capivara/plan/1',status:'ready',revision:1,briefId:brief.id,briefRevision:1,environment:[],contracts:[],tasks:[task]};
      const operational:OperationalEnvironment={root:cwd,revision:'providers',env:{},bindings:{python:{capability:'runtime',kind:'runtime',provider:'Python',ready:true,command:['python3'],aliases:['python-proof']}}};
      let actualExecutions=0;
      const execute=async(request:Parameters<typeof executeCommand>[0])=>{actualExecutions++;expect(typeof request.command).not.toBe('string');expect(request.command[0]).not.toContain('python-proof');return executeCommand(request);};
      const terminal=async()=>{throw Error('No PTY is required.');};
      const verified=await runVerification(cwd,brief,task,plan,check,execute,terminal,{operational});
      expect(actualExecutions).toBe(1);expect(verified.evidence.passed).toBe(true);
      expect(verified.evidence.observation?.invocationTransformation).toMatchObject({schema:'capivara/invocation/1',original:[check.command,...check.args!],resolved:['python-proof',...check.args!],reason:'duplicate-literal-arguments'});

      // Simple valid observations keep the exact legacy identity; only the
      // causal hybrid protocol changes, so its old ENOENT cannot be replayed.
      const legacyHash=(recipe:Verification)=>digest(JSON.stringify({description:JSON.stringify({verifier:'capivara-verification/5',check:recipe,contracts:[],environment:[],platform:process.platform,node:process.version,references:[]}),inputs:{}}));
      const simple:Verification={...check,command:'python3',args:[...check.args!]};
      expect((await verificationIdentity(cwd,plan,task,simple,undefined,undefined,[])).inputHash).toBe(legacyHash(simple));
      expect((await verificationIdentity(cwd,plan,task,check,undefined,undefined,[])).inputHash).not.toBe(legacyHash(check));

      const invalidCode='<not an executable Node program>';
      const node:Verification={...check,id:'inline',kind:'command',command:`${quoteArgument(process.execPath)} --input-type=module -e ${quoteArgument(invalidCode)}`,args:['--input-type=module','-e',invalidCode],assertion:{type:'exit',value:0}};
      expect(inlineVerificationSyntaxRequired(node)).toBe(true);
      let syntaxProbes=0,productExecutions=0;
      const invalidVerification=await runVerification(cwd,brief,task,plan,node,async request=>{if(typeof request.command!=='string'&&request.command.includes('--check'))syntaxProbes++;else productExecutions++;return executeCommand(request);},terminal);
      expect(syntaxProbes).toBe(1);expect(productExecutions).toBe(0);expect(invalidVerification.result).toBeNull();expect(invalidVerification.classification).toBe('instrument');
      const invalidDeclaration=await runVerification(cwd,brief,task,plan,{...check,args:['-c',"print('different')"]},execute,terminal,{operational});
      expect(actualExecutions).toBe(1);expect(invalidDeclaration.result).toBeNull();expect(invalidDeclaration.classification).toBe('instrument');

      const conflicting = await executeCommand({ cwd, command: [original[0]!, '-c', "print('different')"], inputs: [] });
      expect(conflicting.issue).toMatchObject({ kind: 'instrument', recoverable: true, code: 'ERR_INVALID_ARG_VALUE' });
      expect(conflicting.exitCode).toBeNull();
      expect(await readFile(join(cwd, 'observations'), 'utf8')).toBe('once\n');

      const missing = await executeCommand({ cwd, command: [join(cwd, 'missing-executable')], inputs: [] });
      expect(missing.issue).toMatchObject({ kind: 'configuration', recoverable: true, code: 'ENOENT' });
      expect(missing.exitCode).toBeNull();
      const invalid = await executeCommand({ cwd, command: ['invalid\0executable'], inputs: [] });
      expect(invalid.issue).toMatchObject({ kind: 'instrument', recoverable: true, code: 'ERR_INVALID_ARG_VALUE' });
      const tooLong = await executeCommand({ cwd, command: [join(cwd, 'x'.repeat(300))], inputs: [] });
      expect(tooLong.issue).toMatchObject({ kind: 'instrument', recoverable: true, code: 'ENAMETOOLONG' });

      if (process.platform !== 'win32') {
        const binary = join(cwd, 'real executable with spaces');
        await writeFile(binary, '#!/bin/sh\nprintf "%s" "$1"\n', { mode: 0o755 });
        const withSpaces = await executeCommand({ cwd, command: [binary, 'literal argument'], inputs: [] });
        expect(withSpaces.exitCode).toBe(0);
        expect(withSpaces.stdout).toBe('literal argument');
        expect(withSpaces.invocationTransformation).toBeUndefined();
      }
    } finally { await rm(cwd, { recursive: true, force: true }); }
  });
});
