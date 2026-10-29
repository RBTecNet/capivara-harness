import { afterEach, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DevelopmentPlan, ProductBrief, Verification, WorkUnit } from '../../src/domain/types.js';
import { verificationIdentity, verificationLevel, runVerification, type VerificationOutcome } from '../../src/execution/checks.js';
import { verificationInputSelectors, resolveInputDependencies } from '../../src/execution/dependencies.js';
import { deliveryProofSelectors } from '../../src/execution/delivery-sources.js';
import { inputHash } from '../../src/execution/files.js';
import { createTaskWorkspace } from '../../src/execution/isolation.js';
import { executeCommand } from '../../src/runtime/command.js';
import { runTerminal } from '../../src/runtime/terminal.js';

const roots:string[]=[];
afterEach(async()=>{await Promise.all(roots.splice(0).map(root=>rm(root,{recursive:true,force:true})));});

it('refreshes failed and passed build proofs from actual delivery writes outside planned paths while retaining unrelated and unchanged proof caches',async()=>{
  const workspace=await mkdtemp(join(tmpdir(),'capivara-delivery-freshness-'));roots.push(workspace);
  await mkdir(join(workspace,'server/db'),{recursive:true});await mkdir(join(workspace,'config'));
  await writeFile(join(workspace,'config/reader.json'),JSON.stringify({entry:'server/database.ts'}));
  await writeFile(join(workspace,'server/database.ts'),"throw Error('actual database module is defective');export const ready=true;\n");
  await writeFile(join(workspace,'README.md'),'Documentation of another unit.\n');
  const brief:ProductBrief={schema:'capivara/product/1',id:'b',revision:1,status:'ready',name:'Module',summary:'Build a working module.',request:'Build a working module.',modes:['api'],targets:['portable'],requirements:[{id:'module',statement:'The module builds and loads.',mode:'api',source:{kind:'request',reference:'request',text:'Build a working module.'}}],constraints:[],decisions:[],gaps:[]};
  // The concrete source is a dynamic configuration input. The command operands
  // identify its configuration; only the observed delivery ledger identifies
  // the source that the editor actually wrote outside its planned wildcard.
  const script="const{readFileSync}=await import('node:fs');const{resolve}=await import('node:path');const{pathToFileURL}=await import('node:url');const config=JSON.parse(readFileSync(process.argv[1],'utf8'));const actual=await import(pathToFileURL(resolve(config.entry)).href);if(actual.ready!==true)throw Error('module is not ready');console.log('BUILD_COMPLETE');";
  const check:Verification={id:'build',kind:'command',command:process.execPath,args:['--eval',script,'config/reader.json'],inputs:[],level:'build',assertion:{type:'contains',source:'stdout',value:'BUILD_COMPLETE'},requirementIds:['module'],requiredCapabilities:[]};
  const task:WorkUnit={id:'module',title:'Module',goal:'Build and load the module.',instructions:'Implement its working source.',requirementIds:['module'],dependsOn:[],environmentIds:[],contractIds:[],files:['server/db/**'],inputs:['config/reader.json'],criteria:['The module builds and loads.'],checks:[check],risk:'normal',blockedBy:[]};
  const plan:DevelopmentPlan={schema:'capivara/plan/1',status:'ready',revision:1,briefId:brief.id,briefRevision:brief.revision,environment:[],contracts:[],tasks:[task]};
  const observedWrites=['server/database.ts'],proofs=new Map<string,VerificationOutcome>();
  let checkpoint:Awaited<ReturnType<typeof createTaskWorkspace>>|undefined,clonedHash='',clones=0,executions=0;
  const observe=async()=>{
    const declared=await verificationInputSelectors(workspace,plan,task,check);
    expect(declared).toContain('config/reader.json');expect(declared).not.toContain('server/database.ts');
    const selectors=deliveryProofSelectors(check,declared,observedWrites,verificationLevel(check));
    const resolved=await resolveInputDependencies(workspace,selectors);
    expect(resolved).toContain('server/database.ts');expect(resolved).not.toContain('README.md');
    const identity=await verificationIdentity(workspace,plan,task,check,brief,undefined,resolved),sourceHash=await inputHash(workspace,resolved);
    const cached=proofs.get(identity.inputHash);if(cached)return{proof:cached,sourceHash};
    if(!checkpoint||clonedHash!==sourceHash){checkpoint=await createTaskWorkspace(workspace,task.id,sourceHash,task.files);clonedHash=sourceHash;clones++;}
    expect(await inputHash(checkpoint.directory,resolved)).toBe(sourceHash);
    const localIdentity=await verificationIdentity(checkpoint.directory,plan,task,check,brief,undefined,resolved);
    expect(localIdentity.inputHash).toBe(identity.inputHash);
    const proof=await runVerification(checkpoint.directory,brief,task,plan,check,async request=>{executions++;return executeCommand(request);},runTerminal,{identity:localIdentity});
    expect(proof.evidence.inputs).toEqual(resolved);proofs.set(identity.inputHash,proof);return{proof,sourceHash};
  };
  const broken=await observe();expect(broken.proof.evidence.passed).toBe(false);expect(broken.proof.result?.stderr).toContain('actual database module is defective');
  await writeFile(join(workspace,'server/database.ts'),'export const ready=true;\n');
  const repaired=await observe();expect(repaired.proof.evidence.passed).toBe(true);expect(repaired.sourceHash).not.toBe(broken.sourceHash);expect(repaired.proof.evidence.inputHash).not.toBe(broken.proof.evidence.inputHash);
  await writeFile(join(workspace,'README.md'),'Unrelated documentation changed.\n');
  const unrelated=await observe();expect(unrelated.sourceHash).toBe(repaired.sourceHash);expect(unrelated.proof.evidence.id).toBe(repaired.proof.evidence.id);expect({clones,executions}).toEqual({clones:2,executions:2});
  await writeFile(join(workspace,'server/database.ts'),'export const ready=false;\n');
  const regressed=await observe();expect(regressed.proof.evidence.passed).toBe(false);expect(regressed.sourceHash).not.toBe(repaired.sourceHash);expect(regressed.proof.result?.stderr).toContain('module is not ready');
  await writeFile(join(workspace,'server/database.ts'),'export const ready=true; // repaired actual source\n');
  const final=await observe();expect(final.proof.evidence.passed).toBe(true);expect({clones,executions}).toEqual({clones:4,executions:4});
  const resumed=await observe();expect(resumed.proof.evidence.id).toBe(final.proof.evidence.id);expect({clones,executions}).toEqual({clones:4,executions:4});
});
