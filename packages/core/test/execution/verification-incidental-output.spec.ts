import { afterEach, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DevelopmentPlan, ProductBrief, Verification, WorkUnit } from '../../src/domain/types.js';
import { executeCommand } from '../../src/runtime/command.js';
import { runVerification } from '../../src/execution/checks.js';
import { emptyOperationalEnvironment } from '../../src/execution/environment.js';
import { createTaskWorkspace } from '../../src/execution/isolation.js';
import { deriveObservedProducerOutputs } from '../../src/execution/verification-effects.js';

const roots:string[]=[];
afterEach(async()=>{await Promise.all(roots.splice(0).map(path=>rm(path,{recursive:true,force:true})));});

it('reclassifies an incidental pre-existing build output while retaining declared and dynamically consumed inputs',async()=>{
  const workspace=await mkdtemp(join(tmpdir(),'capivara-incidental-output-'));roots.push(workspace);
  await writeFile(join(workspace,'source.txt'),'actual source');
  await writeFile(join(workspace,'artifact.payload'),'previous artifact');
  await writeFile(join(workspace,'dynamic.payload'),'actual dynamic input');
  await writeFile(join(workspace,'build.mjs'),"import {readFileSync,writeFileSync} from 'node:fs';const value=readFileSync('source.txt','utf8');writeFileSync('artifact.payload','generated '+value);if(process.argv.includes('--consume-dynamic')){const input=readFileSync('dynamic.payload','utf8');writeFileSync('dynamic.payload',input+' overwritten');}console.log('built');\n");
  const check:Verification={id:'build',kind:'command',level:'build',command:process.execPath,args:['build.mjs'],inputs:['source.txt','build.mjs','artifact.payload','dynamic.payload'],assertion:{type:'contains',source:'stdout',value:'built'},requirementIds:[],requiredCapabilities:[]};
  const brief:ProductBrief={schema:'capivara/product/1',id:'b',revision:1,status:'ready',name:'Builder',summary:'Build outputs',request:'Build outputs',modes:['cli'],targets:['portable'],requirements:[],constraints:[],decisions:[],gaps:[]};
  const task:WorkUnit={id:'producer',title:'Producer',goal:brief.summary,instructions:brief.summary,files:['source.txt','build.mjs'],requirementIds:[],environmentIds:[],contractIds:[],dependsOn:[],checks:[check],criteria:[brief.summary],risk:'normal',blockedBy:[]};
  const plan:DevelopmentPlan={schema:'capivara/plan/1',status:'ready',revision:1,briefId:'b',briefRevision:1,environment:[],contracts:[],tasks:[task]};
  const area=await createTaskWorkspace(workspace,'producer','definition',task.files);
  const run=(directory:string,recipe:Verification)=>runVerification(directory,brief,task,plan,recipe,executeCommand,async()=>{throw Error('No terminal needed.');},{operational:emptyOperationalEnvironment(directory)});
  const observed=await run(area.directory,check),original=structuredClone(observed.evidence);
  expect(observed.evidence.passed).toBe(true);
  expect(observed.evidence.provenance?.inputs['artifact.payload']).toBeTruthy();
  expect(observed.evidence.provenance?.artifactsBefore['artifact.payload']).toBeUndefined();
  const effects=await deriveObservedProducerOutputs({workspace,check,evidence:observed.evidence,declaredInputs:task.files,sourceFiles:task.files});
  expect(effects.outputs.map(output=>output.path)).toEqual(['artifact.payload']);
  expect(effects.check.outputs).toEqual(['artifact.payload']);
  expect(effects.transformation).toMatchObject({status:'candidate-declaration',reclassifiedInputs:['artifact.payload']});
  expect(await readFile(join(workspace,'artifact.payload'),'utf8')).toBe('previous artifact');
  expect(observed.evidence).toEqual(original);
  // A real input remains protected both through declarations and an observed
  // file read, even if an accidental delivery index also calls it an output.
  const protectedOutput=await deriveObservedProducerOutputs({workspace,check,evidence:observed.evidence,declaredInputs:[...task.files,'artifact.payload']});
  expect(protectedOutput.outputs).toEqual([]);
  await writeFile(join(area.directory,'source.txt'),'instrument changed a source');
  expect((await deriveObservedProducerOutputs({workspace,check,evidence:observed.evidence,declaredInputs:task.files})).outputs).toEqual([]);
  await writeFile(join(area.directory,'source.txt'),'actual source');
  await writeFile(join(workspace,'source.txt'),'a concurrent source edit');
  expect((await deriveObservedProducerOutputs({workspace,check,evidence:observed.evidence,declaredInputs:task.files})).outputs).toEqual([]);
  await writeFile(join(workspace,'source.txt'),'actual source');
  const dynamicArea=await createTaskWorkspace(workspace,'dynamic-producer','definition',task.files);
  const dynamicCheck={...check,id:'dynamic-build',args:['build.mjs','--consume-dynamic']};
  const dynamic=await run(dynamicArea.directory,dynamicCheck);
  expect(dynamic.evidence.provenance?.consumptions?.some(read=>read.path==='dynamic.payload'&&read.method==='file-read')).toBe(true);
  const denied=await deriveObservedProducerOutputs({workspace,check:dynamicCheck,evidence:dynamic.evidence,declaredInputs:task.files});
  expect(denied.outputs).toEqual([]);
  expect(denied.rejected).toEqual(expect.arrayContaining([expect.objectContaining({path:'dynamic.payload'})]));
});
