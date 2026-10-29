import { afterEach, expect, it } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DevelopmentPlan, ProductBrief, Verification, WorkUnit } from '../../src/domain/types.js';
import { executeCommand } from '../../src/runtime/command.js';
import { runVerification } from '../../src/execution/checks.js';
import { emptyOperationalEnvironment } from '../../src/execution/environment.js';
import { createTaskWorkspace } from '../../src/execution/isolation.js';
import { deriveObservedProducerOutputs } from '../../src/execution/verification-effects.js';

const roots:string[]=[];
afterEach(async()=>{await Promise.all(roots.splice(0).map(root=>rm(root,{recursive:true,force:true})));});

it('derives only real exact producer outputs while preserving source inputs, user conflicts and the original proof',async()=>{
  const workspace=await mkdtemp(join(tmpdir(),'capivara-producer-effects-'));roots.push(workspace);
  await writeFile(join(workspace,'source.txt'),'actual product source');
  await writeFile(join(workspace,'build.mjs'),"import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';const value=readFileSync('source.txt','utf8');mkdirSync('generated',{recursive:true});writeFileSync('generated/application.mjs',`console.log(${JSON.stringify(value)})`);writeFileSync('generated/conflict.mjs','new generated value');console.log('built');\n");
  const area=await createTaskWorkspace(workspace,'producer','definition',['source.txt']);
  const brief:ProductBrief={schema:'capivara/product/1',id:'b',revision:1,status:'ready',name:'Builder',summary:'Build actual output',request:'Build actual output',modes:['cli'],targets:['portable'],requirements:[],constraints:[],decisions:[],gaps:[]};
  const check:Verification={id:'build',kind:'command',level:'build',command:process.execPath,args:['build.mjs'],inputs:['source.txt','build.mjs'],assertion:{type:'contains',source:'stdout',value:'built'},requirementIds:[],requiredCapabilities:[]};
  const task:WorkUnit={id:'producer',title:'Producer',goal:brief.summary,instructions:brief.summary,files:['source.txt'],requirementIds:[],environmentIds:[],contractIds:[],dependsOn:[],checks:[check],criteria:[brief.summary],risk:'normal',blockedBy:[]};
  const plan:DevelopmentPlan={schema:'capivara/plan/1',status:'ready',revision:1,briefId:'b',briefRevision:1,environment:[],contracts:[],tasks:[task]};
  const observed=await runVerification(area.directory,brief,task,plan,check,executeCommand,async()=>{throw Error('No terminal needed.');},{operational:emptyOperationalEnvironment(area.directory)});
  expect(observed.evidence.passed).toBe(true);expect(observed.evidence.provenance?.generatedArtifacts?.length).toBeGreaterThan(0);
  const original=structuredClone(observed.evidence);
  await mkdir(join(workspace,'generated'));await writeFile(join(workspace,'generated/conflict.mjs'),'unrelated user content');
  const effects=await deriveObservedProducerOutputs({workspace,check,evidence:observed.evidence,sourceFiles:['source.txt','build.mjs']});
  expect(effects.outputs).toEqual([expect.objectContaining({path:'generated/application.mjs',proposalBeforeHash:null,sourceEvidenceId:observed.evidence.id})]);
  expect(effects.check.outputs).toEqual(['generated/application.mjs']);expect(check.outputs).toBeUndefined();
  expect((await deriveObservedProducerOutputs({workspace,check:effects.check,evidence:observed.evidence})).outputs).toEqual([]);
  expect(effects.rejected).toEqual(expect.arrayContaining([expect.objectContaining({path:'generated/conflict.mjs'})]));
  expect(await readFile(join(workspace,'source.txt'),'utf8')).toBe('actual product source');expect(await readFile(join(workspace,'generated/conflict.mjs'),'utf8')).toBe('unrelated user content');
  expect(observed.evidence).toEqual(original);
  const mutation=await executeCommand({cwd:area.directory,command:[process.execPath,'-e',"require('node:fs').writeFileSync('source.txt','mutated verification source')"]});expect(mutation.exitCode).toBe(0);
  const unsafe=await deriveObservedProducerOutputs({workspace,check,evidence:observed.evidence});expect(unsafe.outputs).toEqual([]);
  await writeFile(join(workspace,'source.txt'),'concurrent source edit');
  const stale=await deriveObservedProducerOutputs({workspace,check,evidence:observed.evidence});expect(stale.outputs).toEqual([]);
});
