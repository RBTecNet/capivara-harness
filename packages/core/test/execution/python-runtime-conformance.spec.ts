import { afterEach, expect, it } from 'vitest';
import { appendFile, chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DevelopmentPlan, EnvironmentNode, ProductBrief, Verification, WorkUnit } from '../../src/domain/types.js';
import { executeCommand } from '../../src/runtime/command.js';
import { runVerification } from '../../src/execution/checks.js';
import { validateConformance } from '../../src/execution/conformance.js';
import { prepareEnvironmentNode } from '../../src/execution/environment.js';
import { inputSnapshot } from '../../src/execution/files.js';
import { PROVIDER_OBSERVATION_PROTOCOL, runtimeObservationProtocol } from '../../src/runtime/provider-observation.js';

const roots:string[]=[];
afterEach(async()=>{await Promise.all(roots.splice(0).map(root=>rm(root,{recursive:true,force:true})));});

it.skipIf(process.platform==='win32')('proves a real Python runtime executing current product source while versions, echoes, source reads and stale hosts remain unproved',async()=>{
  const workspace=await mkdtemp(join(tmpdir(),'capivara-python-runtime-'));roots.push(workspace);
  const host=join(workspace,'selected-host');await writeFile(host,'#!/bin/sh\nexec python3 "$@"\n');await chmod(host,0o755);
  const source='from operations import add\nprint(add(2, 3))\n';await writeFile(join(workspace,'calc.py'),source);await writeFile(join(workspace,'operations.py'),'def add(left, right):\n    return left + right\n');
  const binding={capability:'execution',kind:'runtime' as const,provider:'Selected host'};
  const literal='Use Selected host to execute the CLI.';
  const brief:ProductBrief={schema:'capivara/product/1',id:'b',revision:1,status:'ready',name:'Sum',summary:literal,request:literal,modes:['cli'],targets:['portable'],requirements:[{id:'host',statement:literal,kind:'stack',mode:'cli',source:{kind:'request',reference:'request',text:literal},binding}],constraints:[],decisions:[],gaps:[]};
  const node:EnvironmentNode={id:'host',name:'Selected host',kind:'runtime',identity:binding,dependsOn:[],targets:['portable'],reason:literal,check:{command:host,args:['--version']},prepare:[],provides:{command:[host]}};
  const prepared=await prepareEnvironmentNode(workspace,node,brief,executeCommand);expect(prepared.ready).toBe(true);
  const check:Verification={id:'actual-cli',kind:'cli',level:'behavior',command:host,args:['calc.py'],inputs:['calc.py','operations.py'],assertion:{type:'contains',source:'stdout',value:'5'},requirementIds:['host'],requiredCapabilities:['terminal'],conformance:{requirementId:'host',...binding,productInputs:['calc.py','operations.py']}};
  const task:WorkUnit={id:'sum',title:'Sum',goal:literal,instructions:literal,requirementIds:['host'],dependsOn:[],environmentIds:['host'],contractIds:[],files:['calc.py','operations.py'],criteria:[literal],checks:[check],risk:'normal',blockedBy:[]};
  const plan:DevelopmentPlan={schema:'capivara/plan/1',status:'ready',revision:1,briefId:'b',briefRevision:1,environment:[node],contracts:[],tasks:[task]};
  const run=(recipe:Verification)=>runVerification(workspace,brief,{...task,checks:[recipe]},{...plan,tasks:[{...task,checks:[recipe]}]},recipe,executeCommand,async()=>{throw Error('No terminal interaction is needed.');},{operational:prepared.operational});
  const observed=await run(check);expect(observed.evidence.passed).toBe(true);
  expect(await runtimeObservationProtocol(workspace,check,prepared.operational)).toBe(PROVIDER_OBSERVATION_PROTOCOL.runtimePython);
  expect(observed.evidence.provenance?.runtimeProvider).toMatchObject({protocol:'python',bindingCommand:[host],provider:binding.provider,version:expect.any(String)});
  const current=await inputSnapshot(workspace,['calc.py','operations.py']);
  expect(observed.evidence.provenance?.runtimeWitnesses).toContainEqual(expect.objectContaining({source:'python-profile-hook',version:expect.any(String),inputs:{'calc.py':current['calc.py'],'operations.py':current['operations.py']}}));
  expect(await validateConformance(brief,plan,prepared.operational,[observed.evidence],workspace)).toEqual([]);
  for(const args of [['--version'],['-c',"print('5')"],['-c',"open('calc.py').read(); print('5')"]]){
    const recipe={...check,args,assertion:{type:'contains' as const,source:'stdout' as const,value:args[0]==='--version'?'Python':'5'}};
    const probe=await run(recipe);expect(probe.evidence.passed).toBe(true);
    expect(probe.evidence.provenance?.runtimeWitnesses??[]).toEqual([]);
    expect(await validateConformance(brief,{...plan,tasks:[{...task,checks:[recipe]}]},prepared.operational,[probe.evidence],workspace)).toEqual([expect.objectContaining({requirementId:'host',code:'unproven-product-provider-usage'})]);
  }
  await writeFile(join(workspace,'calc.py'),source+'# changed source\n');
  expect(await validateConformance(brief,plan,prepared.operational,[observed.evidence],workspace)).not.toEqual([]);
  await writeFile(join(workspace,'calc.py'),source);await appendFile(host,'# changed launcher\n');
  expect(await validateConformance(brief,plan,prepared.operational,[observed.evidence],workspace)).not.toEqual([]);
  expect(await readFile(join(workspace,'operations.py'),'utf8')).toContain('return left + right');
});
