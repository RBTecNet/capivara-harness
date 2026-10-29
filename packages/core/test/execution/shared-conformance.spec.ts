import { afterEach, expect, it } from 'vitest';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DevelopmentPlan, EnvironmentNode, ProductBrief, Requirement, Verification, WorkUnit } from '../../src/domain/types.js';
import { executeCommand } from '../../src/runtime/command.js';
import { runVerification } from '../../src/execution/checks.js';
import { validateConformance } from '../../src/execution/conformance.js';
import { enrichVerificationConformance } from '../../src/execution/conformance-candidates.js';
import { emptyOperationalEnvironment, prepareEnvironmentNode } from '../../src/execution/environment.js';
import { annotateBindingAuthority } from '../../src/domain/bindings.js';

const roots:string[]=[];
afterEach(async()=>{await Promise.all(roots.splice(0).map(root=>rm(root,{recursive:true,force:true})));});

it.skipIf(process.platform==='win32')('uses one real build and one real application observation for multiple provider obligations without trusting an instrument-only import',async()=>{
  const workspace=await mkdtemp(join(tmpdir(),'capivara-shared-conformance-'));roots.push(workspace);
  await mkdir(join(workspace,'node_modules/widget-code'),{recursive:true});
  await writeFile(join(workspace,'package.json'),JSON.stringify({type:'module'}));
  await writeFile(join(workspace,'node_modules/widget-code/package.json'),JSON.stringify({name:'widget-code',version:'1.0.0',type:'module',exports:'./index.mjs'}));
  await writeFile(join(workspace,'node_modules/widget-code/index.mjs'),'export const add = (left, right) => left + right;\n');
  await writeFile(join(workspace,'source.mjs'),"import {add} from 'widget-code';import {DatabaseSync} from 'node:sqlite';let db=new DatabaseSync('persist.payload');db.exec('CREATE TABLE IF NOT EXISTS result(value INTEGER); DELETE FROM result');db.prepare('INSERT INTO result VALUES (?)').run(add(2,3));db.close();db=new DatabaseSync('persist.payload');const value=db.prepare('SELECT value FROM result').get().value;db.close();if(value!==5)throw Error('Persistence failed');console.log('actual sum='+value);\n");
  const builder=join(workspace,'builder');
  await writeFile(builder,"#!/usr/bin/env node\nimport {mkdirSync,readFileSync,writeFileSync} from 'node:fs';if(process.argv.includes('--version'))console.log('builder 1');else{mkdirSync('out',{recursive:true});writeFileSync('out/application.mjs',readFileSync('source.mjs'));console.log('built actual application');}\n");await chmod(builder,0o755);
  const bindings=[{capability:'application-runtime',kind:'runtime' as const,provider:'Selected host'},{capability:'application-runtime',kind:'runtime' as const,provider:'Selected host'},{capability:'numeric-library',kind:'library' as const,provider:'Widgets'},{capability:'file-database',kind:'driver' as const,provider:'SQLite'},{capability:'application-builder',kind:'cli' as const,provider:'Builder'}];
  const quotes=['Use Selected host.','The backend also uses Selected host.','Use Widgets.','Use SQLite in a file.','Use Builder.'];
  const requirements:Requirement[]=bindings.map((binding,index)=>({id:`r${index}`,statement:quotes[index]!,source:{kind:'request',reference:'request',text:quotes[index]!},mode:'cli',kind:'stack',binding}));
  const brief:ProductBrief={schema:'capivara/product/1',id:'b',revision:1,status:'ready',name:'Sum',summary:'Build and run the actual sum.',request:quotes.join('\n'),modes:['cli'],targets:['portable'],requirements,constraints:[],decisions:[],gaps:[]};
  requirements.forEach(requirement=>annotateBindingAuthority(requirement,brief.request,'init'));
  const node=(id:string,index:number,check:EnvironmentNode['check'],provides:NonNullable<EnvironmentNode['provides']>):EnvironmentNode=>({id,name:bindings[index]!.provider,kind:index===0?'runtime':index===4?'tool':'package',identity:bindings[index]!,dependsOn:[],targets:['portable'],reason:quotes[index]!,check,prepare:[],provides});
  const nodes=[node('host',0,{command:process.execPath,args:['--version']},{command:[process.execPath]}),node('widgets',2,{command:process.execPath,args:['--input-type=module','-e',"import {add} from 'widget-code';if(add(2,3)!==5)throw Error('unavailable');console.log('ready')"]},{modules:[{protocol:'node',specifier:'widget-code',runtimeCommand:[process.execPath]}]}),node('store',3,{command:process.execPath,args:['--input-type=module','-e',"import {DatabaseSync} from 'node:sqlite';const db=new DatabaseSync(':memory:');db.exec('SELECT 1');db.close();console.log('ready')"]},{modules:[{protocol:'node',specifier:'node:sqlite',runtimeCommand:[process.execPath]}]}),node('builder',4,{command:builder,args:['--version']},{command:[builder]})];
  let operational=emptyOperationalEnvironment(workspace);
  for(const provider of nodes){const prepared=await prepareEnvironmentNode(workspace,provider,brief,executeCommand,{operational});expect(prepared.ready).toBe(true);operational=prepared.operational;}
  const task:WorkUnit={id:'$acceptance',title:'Acceptance',goal:brief.summary,instructions:brief.summary,requirementIds:requirements.map(item=>item.id),dependsOn:[],environmentIds:nodes.map(item=>item.id),contractIds:[],files:['source.mjs'],criteria:[brief.summary],checks:[],risk:'normal',blockedBy:[]};
  const plan:DevelopmentPlan={schema:'capivara/plan/1',status:'ready',revision:1,briefId:brief.id,briefRevision:1,environment:nodes,contracts:[],tasks:[task]};
  const build:Verification={id:'shared-build',kind:'command',level:'build',command:builder,assertion:{type:'contains',source:'stdout',value:'built actual application'},inputs:['source.mjs'],requirementIds:[],requiredCapabilities:[]};
  const behavior:Verification={id:'shared-behavior',kind:'cli',level:'behavior',command:process.execPath,args:['out/application.mjs'],assertion:{type:'contains',source:'stdout',value:'actual sum=5'},inputs:['source.mjs'],requirementIds:[],requiredCapabilities:[]};
  const evidence:Awaited<ReturnType<typeof runVerification>>['evidence'][]=[];
  const checks:Verification[]=[];
  let commands=0;
  const observe=async(original:Verification)=>{
    const enriched=await enrichVerificationConformance({brief,plan,task,check:original,operational,workspace,evidence,deliveryFiles:['source.mjs']});
    checks.push(enriched.check);
    const result=await runVerification(workspace,brief,task,plan,enriched.check,async request=>{commands++;return executeCommand(request);},async()=>{throw Error('No pseudo terminal is needed.');},{operational});
    expect(result.evidence.passed,result.evidence.output).toBe(true);evidence.push(result.evidence);return result.evidence;
  };
  const built=await observe(build),ran=await observe(behavior);
  expect(commands).toBe(2);expect(new Set(evidence.map(proof=>proof.id)).size).toBe(2);
  expect(built.provenance?.generatedArtifacts).toContainEqual(expect.objectContaining({path:'out/application.mjs'}));
  expect(ran.provenance?.moduleWitnesses?.some(witness=>witness.modules.some(module=>module.specifier==='node:sqlite'))).toBe(true);
  const effective={...plan,tasks:[{...task,checks}]};
  expect(await validateConformance(brief,effective,operational,evidence,workspace)).toEqual([]);
  expect(build).not.toHaveProperty('conformanceClaims');expect(behavior).not.toHaveProperty('conformanceClaims');
  expect(await readFile(join(workspace,'persist.payload')).then(bytes=>bytes.subarray(0,16).toString())).toBe('SQLite format 3\u0000');
  // An instrument importing the same providers and printing the expected text
  // cannot borrow the application's source identity or its old successful run.
  await writeFile(join(workspace,'probe.mjs'),"import 'widget-code';import 'node:sqlite';console.log('actual sum=5');\n");
  const instrument={...behavior,id:'instrument-only',kind:'command' as const,command:process.execPath,args:['probe.mjs']};
  const probe=await observe(instrument);
  const withoutApplication={...plan,tasks:[{...task,checks:[checks[0]!,checks[2]!]}]};
  expect((await validateConformance(brief,withoutApplication,operational,[built,probe],workspace)).some(issue=>issue.requirementId==='r3')).toBe(true);
  const explicitCli=structuredClone(brief);explicitCli.request+='\nUse SQLite CLI.';const required=explicitCli.requirements.find(item=>item.id==='r3')!;required.source.text='Use SQLite CLI.';required.statement=required.source.text;required.binding={...required.binding!,kind:'cli'};delete required.bindingAuthority;annotateBindingAuthority(required,explicitCli.request,'init');
  expect((await validateConformance(explicitCli,effective,operational,evidence,workspace)).some(issue=>issue.requirementId==='r3')).toBe(true);
});
