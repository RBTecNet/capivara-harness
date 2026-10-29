import { afterEach, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DevelopmentPlan, ProductBrief, Verification, WorkUnit } from '../../src/domain/types.js';
import { verificationOutputs } from '../../src/domain/verifications.js';
import { executeCommand } from '../../src/runtime/command.js';
import { runVerification, verificationIdentity } from '../../src/execution/checks.js';
import { emptyOperationalEnvironment } from '../../src/execution/environment.js';
import { inputSnapshot } from '../../src/execution/files.js';
import { createTaskWorkspace } from '../../src/execution/isolation.js';
import { cachedPositiveVerifications } from '../../src/execution/verification-cache.js';

const roots:string[]=[];
afterEach(async()=>{await Promise.all(roots.splice(0).map(root=>rm(root,{recursive:true,force:true})));});

it('avoids a fork for a real current positive command and falls back after its product source changes',async()=>{
  const workspace=await mkdtemp(join(tmpdir(),'capivara-verification-cache-'));roots.push(workspace);
  await writeFile(join(workspace,'product.mjs'),'export const result = 5;\n');
  await writeFile(join(workspace,'runner.mjs'),"import {result} from './product.mjs';import {writeFileSync} from 'node:fs';writeFileSync('result.txt',String(result));console.log(result);\n");
  const literal='The CLI prints the required sum.';
  const brief:ProductBrief={schema:'capivara/product/1',id:'b',revision:1,status:'ready',name:'Sum',summary:literal,request:literal,modes:['cli'],targets:['portable'],requirements:[{id:'sum',statement:literal,kind:'behavior',mode:'cli',source:{kind:'request',reference:'request',text:literal}}],constraints:[],decisions:[],gaps:[]};
  const check:Verification={id:'sum-cli',kind:'cli',level:'behavior',command:process.execPath,args:['runner.mjs'],expected:'The actual command prints 5.',assertion:{type:'contains',source:'stdout',value:'5'},requirementIds:['sum'],requiredCapabilities:['terminal'],inputs:['product.mjs','runner.mjs'],outputs:['result.txt']};
  const task:WorkUnit={id:'sum',title:'Sum',goal:literal,instructions:literal,requirementIds:['sum'],dependsOn:[],environmentIds:[],contractIds:[],files:['product.mjs','runner.mjs'],criteria:[literal],checks:[check],risk:'normal',blockedBy:[]};
  const plan:DevelopmentPlan={schema:'capivara/plan/1',status:'ready',revision:1,briefId:brief.id,briefRevision:1,environment:[],contracts:[],tasks:[task]};
  const operational=emptyOperationalEnvironment(workspace);
  let commands=0,forks=0;
  const observed=await runVerification(workspace,brief,task,plan,check,async request=>{commands++;return executeCommand(request);},async()=>{throw Error('This is an actual CLI command, not a TUI.');},{operational});
  expect(observed.evidence.passed).toBe(true);expect(observed.evidence.observation?.exitCode).toBe(0);
  observed.evidence.artifacts=await inputSnapshot(workspace,verificationOutputs(check));
  const evidence=[observed.evidence];
  const cached=()=>cachedPositiveVerifications({workspace,taskId:task.id,checks:[check],evidence,resource:async()=>({ready:true}),identity:recipe=>verificationIdentity(workspace,plan,task,recipe,brief,operational)});
  const verifyOrFork=async()=>{const reused=await cached();if(reused)return reused;forks++;await createTaskWorkspace(workspace,task.id,'changed-source',task.files);return undefined;};
  const reused=await verifyOrFork();
  expect(reused?.[0]?.evidence.id).toBe(observed.evidence.id);expect(reused?.[0]?.result).toBeNull();expect(forks).toBe(0);expect(commands).toBe(1);
  expect(await readFile(join(workspace,'result.txt'),'utf8')).toBe('5');
  await writeFile(join(workspace,'product.mjs'),'export const result = 8;\n');
  expect(await verifyOrFork()).toBeUndefined();expect(forks).toBe(1);expect(commands).toBe(1);
  expect(observed.evidence.passed).toBe(true); // The original receipt remains immutable historical evidence.
});
