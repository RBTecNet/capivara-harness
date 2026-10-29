import { afterEach, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DevelopmentPlan, ProductBrief, Verification, WorkUnit } from '../../src/domain/types.js';
import { closeVerificationGraph } from '../../src/execution/verification-graph.js';
import { runVerification } from '../../src/execution/checks.js';
import { executeCommand } from '../../src/runtime/command.js';

const roots:string[]=[];
afterEach(async()=>{await Promise.all(roots.splice(0).map(root=>rm(root,{recursive:true,force:true})));});

it('executes an explicit cross-owner producer closure with its own inputs and refuses missing, ambiguous or cyclic owners',async()=>{
  const workspace=await mkdtemp(join(tmpdir(),'capivara-verification-graph-'));roots.push(workspace);
  await writeFile(join(workspace,'source.txt'),'actual product');
  const producer:Verification={id:'global-build',kind:'command',level:'build',command:process.execPath,args:['-e',"const fs=require('node:fs');fs.writeFileSync('artifact.payload',fs.readFileSync('source.txt','utf8'));console.log('built');"],outputs:['artifact.payload'],requirementIds:[],requiredCapabilities:[],assertion:{type:'contains',value:'built'}};
  const consumer:Verification={id:'local-behavior',kind:'command',level:'behavior',command:process.execPath,args:['-e',"console.log(require('node:fs').readFileSync('artifact.payload','utf8'));"],inputs:['artifact.payload'],dependsOn:[producer.id],requirementIds:[],requiredCapabilities:[],assertion:{type:'contains',value:'actual product'}};
  const original=structuredClone({producer,consumer});
  const registry=[{check:producer,inputs:['source.txt']}];
  const closed=closeVerificationGraph([consumer],registry);
  expect(closed.imported).toEqual([producer.id]);expect(closed.checks.map(check=>check.id)).toEqual([producer.id,consumer.id]);
  expect(closed.checks[0]!.inputs).toEqual(['source.txt']);expect(closed.checks[1]!.dependsOn).toEqual([producer.id]);
  expect({producer,consumer}).toEqual(original);
  const brief:ProductBrief={schema:'capivara/product/1',id:'b',revision:1,status:'ready',name:'Artifact',summary:'Read the actual artifact.',request:'Read the actual artifact.',modes:['library'],targets:['portable'],requirements:[],constraints:[],decisions:[],gaps:[]};
  const task:WorkUnit={id:'consumer',title:'Consumer',goal:brief.summary,instructions:brief.summary,requirementIds:[],dependsOn:[],environmentIds:[],contractIds:[],files:['consumer.txt'],criteria:[brief.summary],checks:[consumer],risk:'normal',blockedBy:[]};
  const plan:DevelopmentPlan={schema:'capivara/plan/1',status:'ready',revision:1,briefId:brief.id,briefRevision:1,environment:[],contracts:[],tasks:[task]};
  const proofs=[];
  for(const check of closed.checks){const observed=await runVerification(workspace,brief,task,plan,check,executeCommand,async()=>{throw Error('No terminal required.');});expect(observed.evidence.passed,observed.evidence.output).toBe(true);proofs.push(observed.evidence);}
  expect(new Set(proofs.map(proof=>proof.id)).size).toBe(2);expect(await readFile(join(workspace,'artifact.payload'),'utf8')).toBe('actual product');
  expect(()=>closeVerificationGraph([consumer],[])).toThrow(/unavailable producer/);
  expect(()=>closeVerificationGraph([consumer],[...registry,{check:{...producer,args:['-e',"throw Error('different producer')"]},inputs:['source.txt']}])).toThrow(/incompatible executable/);
  expect(()=>closeVerificationGraph([consumer],[{check:{...producer,dependsOn:[consumer.id]},inputs:['source.txt']}])).toThrow(/cyclic/);
});
