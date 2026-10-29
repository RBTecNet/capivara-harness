import { afterEach, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DevelopmentPlan, ProductBrief, Verification, WorkUnit } from '../../src/domain/types.js';
import { runBuild } from '../../src/execution/build.js';
import { executeCommand } from '../../src/runtime/command.js';
import { inputSnapshot } from '../../src/execution/files.js';
import type { AgentResult, CommandRequest } from '../../src/runtime/types.js';

const roots:string[]=[];
afterEach(async()=>{await Promise.all(roots.splice(0).map(root=>rm(root,{recursive:true,force:true})));});
const complete=(text=''):AgentResult=>({status:'complete',text,commands:[],changedFiles:[]});

it('adopts an observed build output separately from source and resumes without replay or a second editor',async()=>{
  const workspace=await mkdtemp(join(tmpdir(),'capivara-producer-flow-'));roots.push(workspace);
  const statement='Build the actual library artifact from its source.';
  const brief:ProductBrief={schema:'capivara/product/1',id:'product',revision:1,status:'ready',name:'Builder',summary:statement,request:statement,modes:['library'],targets:['portable'],requirements:[{id:'build-output',statement,mode:'library',kind:'behavior',source:{kind:'request',reference:'request',text:statement}}],constraints:[],decisions:[],gaps:[]};
  const check:Verification={id:'actual-build',kind:'command',level:'build',command:process.execPath,args:['builder.cjs'],assertion:{type:'contains',source:'stdout',value:'built v1'},inputs:['source.txt','builder.cjs'],requirementIds:['build-output'],requiredCapabilities:[]};
  const consumer:Verification={id:'read-artifact',kind:'command',level:'behavior',command:process.execPath,args:['-e',"console.log(require('node:fs').readFileSync('artifact.payload','utf8'))"],dependsOn:[check.id],inputs:['artifact.payload'],assertion:{type:'contains',source:'stdout',value:'compiled:v1'},requirementIds:['build-output'],requiredCapabilities:[]};
  const task:WorkUnit={id:'producer',title:'Builder',goal:statement,instructions:'Create the actual builder and source.',requirementIds:['build-output'],dependsOn:[],environmentIds:['filesystem'],contractIds:[],files:['source.txt','builder.cjs'],criteria:[statement],checks:[check,consumer],risk:'normal',blockedBy:[]};
  const plan:DevelopmentPlan={schema:'capivara/plan/1',status:'ready',revision:1,briefId:brief.id,briefRevision:1,environment:[{id:'filesystem',name:'Node filesystem',kind:'package',identity:{capability:'filesystem',kind:'library',provider:'node:fs'},dependsOn:[],targets:['portable'],reason:'The builder consumes the runtime filesystem library.',check:{command:process.execPath,args:['-e',"require('node:fs')"]},prepare:[],provides:{modules:[{protocol:'node',specifier:'node:fs',runtimeCommand:[process.execPath]}]}}],contracts:[],tasks:[task]};
  let editors=0,builds=0,reviews=0,initialArtifactHash:string|undefined;
  const command=async(request:CommandRequest)=>{if(Array.isArray(request.command)&&request.command.includes('builder.cjs'))builds++;return executeCommand(request);};
  const result=await runBuild({workspace,brief,plan,executeCommand:command,repairPlan:async()=>{throw Error('Observed producer outputs must not replan the delivery.');},agent:async request=>{
    if(request.role==='editor'){
      editors++;expect(editors).toBe(1);
      await writeFile(join(request.workspace,'source.txt'),'v1');
      await writeFile(join(request.workspace,'builder.cjs'),"const fs=require('node:fs');const value=fs.readFileSync('source.txt','utf8');fs.writeFileSync('artifact.payload','compiled:'+value);console.log('built '+value);\n");
      // An artifact produced before verification is an incidental editor write,
      // not automatically a source dependency or an authorized output.
      await writeFile(join(request.workspace,'artifact.payload'),'compiled:old');
      initialArtifactHash=(await inputSnapshot(request.workspace,['artifact.payload']))['artifact.payload'];
      return complete();
    }
    if(request.role==='reviewer'){reviews++;return complete('{"approved":true,"findings":[]}');}
    throw Error('Output-contract recovery must not invoke a repair editor.');
  }});
  expect(result.status,JSON.stringify(result.incidents)).toBe('complete');
  expect(editors).toBe(1);expect(reviews).toBe(1);expect(builds).toBe(2);
  const progress=result.state.tasks.producer!;
  expect(progress.generatedFiles).toEqual(['artifact.payload']);
  expect(progress.checks?.find(recipe=>recipe.id===check.id)?.outputs).toEqual(['artifact.payload']);
  expect(result.state.metrics?.repetitions).toContainEqual(expect.objectContaining({taskId:task.id,action:'observe-producer-outputs'}));
  expect(await readFile(join(workspace,'artifact.payload'),'utf8')).toBe('compiled:v1');
  expect(await readFile(join(workspace,'source.txt'),'utf8')).toBe('v1');
  const proofs=result.state.evidence.filter(proof=>proof.taskId===task.id&&proof.checkId===check.id);
  expect(new Set(proofs.map(proof=>proof.id)).size).toBe(2);
  expect(initialArtifactHash).toBeDefined();
  expect(proofs[0]!.provenance?.inputs['artifact.payload']).toBe(initialArtifactHash);
  expect(proofs[0]!.provenance?.generatedArtifacts?.some(write=>write.path==='artifact.payload')).toBe(true);
  expect(proofs.at(-1)?.artifacts).toHaveProperty('artifact.payload');
  expect(proofs.at(-1)?.artifacts?.['artifact.payload']).not.toBe(initialArtifactHash);
  expect(proofs.at(-1)?.inputs).not.toContain('artifact.payload');
  expect(progress.verificationEvidence).toContainEqual(expect.objectContaining({checkId:check.id,evidenceId:proofs.at(-1)!.id}));
  const resumed=await runBuild({workspace,brief,plan:result.plan,state:result.state,executeCommand:command,agent:async()=>{throw Error('An unchanged completed producer does not require another model call.');}});
  expect(resumed.status,JSON.stringify(resumed.incidents)).toBe('complete');expect(builds).toBe(2);
  expect(resumed.state.evidence.map(proof=>proof.id)).toEqual(result.state.evidence.map(proof=>proof.id));
});
