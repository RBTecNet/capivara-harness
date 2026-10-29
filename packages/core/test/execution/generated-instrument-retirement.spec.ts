import { afterEach, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DevelopmentPlan, ProductBrief, Verification, WorkUnit } from '../../src/domain/types.js';
import { runBuild } from '../../src/execution/build.js';
import { executeCommand } from '../../src/runtime/command.js';
import type { AgentResult } from '../../src/runtime/types.js';

const roots:string[]=[];
afterEach(async()=>{await Promise.all(roots.splice(0).map(root=>rm(root,{recursive:true,force:true})));});
const complete=(text=''):AgentResult=>({status:'complete',text,commands:[],changedFiles:[]});

it.skipIf(process.platform==='win32')('retires a diagnosed generated runner while still refusing an unproved mandatory SDK artifact chain',async()=>{
  const workspace=await mkdtemp(join(tmpdir(),'capivara-retirement-product-')),tools=await mkdtemp(join(tmpdir(),'capivara-retirement-tools-'));roots.push(workspace,tools);
  const compiler=join(tools,'compiler.cjs');
  await writeFile(compiler,"const fs=require('node:fs');if(process.argv.includes('--version'))console.log('TestCompiler 1');else{const [source,out]=process.argv.slice(2);fs.writeFileSync(out,fs.readFileSync(source));console.log('COMPILED');}\n");
  const statement='The CLI prints OK using the mandatory compiled SDK output.';
  const binding={capability:'compiler',kind:'sdk' as const,provider:'TestCompiler'};
  const brief:ProductBrief={schema:'capivara/product/1',id:'product',revision:1,status:'ready',name:'Compiler',summary:statement,request:'Use TestCompiler SDK. The CLI prints OK using the mandatory compiled SDK output.',modes:['cli'],targets:['portable'],requirements:[{id:'sdk',statement:'Use TestCompiler SDK.',kind:'stack',binding,mode:'shared',source:{kind:'request',reference:'request',text:'Use TestCompiler SDK.'}},{id:'outcome',statement,kind:'behavior',mode:'cli',source:{kind:'request',reference:'request',text:statement}}],constraints:[],decisions:[],gaps:[]};
  const build:Verification={id:'build',kind:'command',level:'build',command:process.execPath,args:[compiler,'source.cjs','artifact.cjs'],inputs:['source.cjs'],outputs:['artifact.cjs'],assertion:{type:'contains',source:'stdout',value:'COMPILED'},requirementIds:['sdk'],requiredCapabilities:[]};
  const cli:Verification={id:'source-cli',kind:'cli',level:'behavior',command:process.execPath,args:['cli.cjs'],inputs:['cli.cjs'],assertion:{type:'contains',source:'stdout',value:'OK'},requirementIds:['outcome'],requiredCapabilities:[]};
  const broken:Verification={id:'generated-broken-fixture',kind:'cli',level:'behavior',command:process.execPath,args:['--input-type=module','-e',"throw Error('instrument fixture');"],assertion:{type:'exit',value:0},expectedExitCode:0,inputs:['cli.cjs'],requirementIds:['sdk'],requiredCapabilities:[]};
  const task:WorkUnit={id:'delivery',title:'CLI',goal:statement,instructions:'Build and execute the actual compiled product.',requirementIds:['sdk','outcome'],dependsOn:[],environmentIds:['compiler'],contractIds:[],files:['source.cjs','cli.cjs','package.json'],criteria:[statement],checks:[build,cli],risk:'normal',blockedBy:[]};
  const plan:DevelopmentPlan={schema:'capivara/plan/1',status:'ready',revision:1,briefId:brief.id,briefRevision:1,environment:[{id:'compiler',name:'TestCompiler',kind:'sdk',identity:binding,dependsOn:[],targets:['portable'],reason:'The required compiler produces the product artifact.',check:{command:process.execPath,args:[compiler,'--version']},prepare:[],provides:{command:[process.execPath,compiler]}}],contracts:[],tasks:[task]};
  let editors=0,compositions=0,diagnoses=0;
  const outcome=await runBuild({workspace,brief,plan,repairPlan:async()=>null,agent:async request=>{
    if(request.role==='editor'){
      editors++;expect(editors).toBe(1);
      await writeFile(join(request.workspace,'source.cjs'),"module.exports = 'OK';\n");
      // This deliberately does not consume artifact.cjs. A source-level CLI
      // success cannot establish the mandatory compiled SDK artifact chain.
      await writeFile(join(request.workspace,'cli.cjs'),"console.log('OK');\n");
      await writeFile(join(request.workspace,'package.json'),JSON.stringify({scripts:{build:`"${process.execPath}" "${compiler}" source.cjs artifact.cjs`}}));
      return complete();
    }
    if(request.role==='reviewer'&&request.instruction.startsWith('Classify')){
      diagnoses++;return complete(JSON.stringify({kind:'instrument',cause:'The generated verifier throws its own fixture error before exercising the application; the existing CLI scenario already executes successfully.',fix:'Retire this generated broken candidate without treating source-level CLI success as proof of the compiled artifact.'}));
    }
    if(request.role==='reviewer')return complete('{"approved":true,"findings":[]}');
    if(request.role==='repair'&&request.context?.includes('execute-compiled-product')){
      compositions++;return complete(JSON.stringify({checks:[broken]}));
    }
    throw Error('Retirement must neither edit the product nor invent a replacement proof.');
  }});
  expect(outcome.status,JSON.stringify(outcome.incidents)).toBe('waiting');
  expect({editors,compositions,diagnoses}).toEqual({editors:1,compositions:1,diagnoses:1});
  expect(outcome.state.tasks.delivery?.status).toBe('complete');
  expect(outcome.state.metrics?.repetitions).toContainEqual(expect.objectContaining({action:'retire-failed-generated-instrument'}));
  const negative=outcome.state.evidence.find(proof=>proof.checkId==='generated-broken-fixture'&&!proof.passed)!;
  expect(negative).toBeDefined();expect(negative.observation?.exitCode).not.toBe(0);expect(negative.output).toContain('instrument fixture');
  expect(outcome.state.proofInterpretations).toContainEqual(expect.objectContaining({evidenceId:negative.id,classification:'instrument',originalClassification:'product'}));
  expect(outcome.state.nativeConformanceCheckIds).not.toContain('generated-broken-fixture');
  expect(outcome.state.acceptanceChecks?.some(check=>check.id==='generated-broken-fixture')).toBe(false);
  expect(outcome.state.evidence.some(proof=>proof.checkId==='native-providers-behavior'&&proof.passed)).toBe(true);
  expect(outcome.incidents.some(incident=>incident.subject==='sdk'&&/artifact|provider|conform/i.test(incident.message+' '+incident.evidence))).toBe(true);
  expect(outcome.state.retiredInstruments).toContainEqual(expect.objectContaining({checkId:broken.id,evidenceId:negative.id}));
  const initialRetirements=structuredClone(outcome.state.retiredInstruments);

  // A planner may repeat the same operation under a different display ID. Its
  // durable retirement remains scoped to the unchanged literal authority.
  const replanned=structuredClone(outcome.plan);replanned.revision++;
  replanned.tasks[0]!.checks.push({...broken,id:'planner-resurrected-fixture'});
  const resumed=await runBuild({workspace,brief,plan:replanned,state:outcome.state,repairPlan:async()=>null,agent:async()=>{throw Error('A planner paraphrase must not resurrect a retired generated verifier.');}});
  expect(resumed.status).toBe('waiting');
  expect(resumed.plan.tasks[0]!.checks.some(check=>check.id==='planner-resurrected-fixture')).toBe(false);
  expect(resumed.state.evidence.some(proof=>proof.checkId==='planner-resurrected-fixture')).toBe(false);
  expect(resumed.state.retiredInstruments).toEqual(initialRetirements);

  // A new literal instruction, even in a freshly extracted revision-one brief,
  // must not inherit the old authority's retirement through journal replay.
  const newAuthority=structuredClone(brief);
  newAuthority.request+='\nRequire the exact verification command declared in final acceptance to succeed.';
  expect(newAuthority.revision).toBe(1);
  const requiredPlan=structuredClone(resumed.plan);requiredPlan.revision++;
  requiredPlan.acceptance=[structuredClone(broken)];
  const beforeRequiredNegativeCount=resumed.state.evidence.filter(proof=>proof.checkId===broken.id&&!proof.passed).length;
  let requiredInvocations=0;
  const required=await runBuild({workspace,brief:newAuthority,plan:requiredPlan,state:resumed.state,repairPlan:async()=>null,executeCommand:async request=>{if(JSON.stringify(request.command).includes('instrument fixture'))requiredInvocations++;return executeCommand(request);},agent:async request=>{
    if(request.role==='reviewer')return complete(request.instruction.startsWith('Classify')?JSON.stringify({kind:'instrument',cause:'The explicitly required recipe throws its fixture error.',fix:'Its literal obligation still needs a valid resolution.'}):'{"approved":true,"findings":[]}');
    return{status:'unavailable',text:'No alternate operation is configured for this deliberately unsatisfied explicit obligation.',commands:[],changedFiles:[],issue:{kind:'configuration',message:'The explicit failing criterion remains unfulfilled.',recoverable:false}};
  }});
  expect(required.status).toBe('waiting');
  expect(required.plan.acceptance?.some(check=>check.id===broken.id)).toBe(true);
  expect(requiredInvocations).toBeGreaterThan(0);
  expect(required.state.evidence.filter(proof=>proof.checkId===broken.id&&!proof.passed).length).toBeGreaterThan(beforeRequiredNegativeCount);
  expect(required.state.retiredInstruments).toEqual(initialRetirements);
});
