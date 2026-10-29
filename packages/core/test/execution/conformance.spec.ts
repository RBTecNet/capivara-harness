import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { executeCommand, runTerminal } from '../../src/runtime/index.js';
import { runBuild } from '../../src/execution/build.js';
import { emptyOperationalEnvironment } from '../../src/execution/environment.js';
import type { OperationalEnvironment } from '../../src/execution/environment.js';
import { validateConformance } from '../../src/execution/conformance.js';
import { runVerification } from '../../src/execution/checks.js';
import { validatePlan } from '../../src/domain/reconcile.js';
import type { DevelopmentPlan, ProductBrief, Verification, WorkUnit } from '../../src/domain/types.js';
import type { VerificationEvidence } from '../../src/execution/types.js';

const roots:string[]=[];
afterEach(async()=>{await Promise.all(roots.splice(0).map(root=>rm(root,{recursive:true,force:true})));});
async function workspace():Promise<string>{const root=await mkdtemp(join(tmpdir(),'capivara-conformance-'));roots.push(root);return root;}
function brief(kind:'runtime'|'sdk'|'library'='runtime'):ProductBrief{return{schema:'capivara/product/1',status:'ready',id:'product',revision:1,name:'Greeting',summary:'Print hello with the mandatory provider.',request:'Create a Node.js CLI that prints hello.',modes:['cli'],targets:['portable'],requirements:[{id:'mandatory',statement:'Print hello using the mandatory provider.',source:{kind:'request',reference:'request',text:`Use the Required provider as ${kind}.`},mode:'cli',kind:'stack',binding:{capability:'implementation',kind,provider:'Required provider'}}],constraints:[],decisions:[],gaps:[]};}
function unit(checks:Verification[]):WorkUnit{return{id:'greeting',title:'Greeting',goal:'Print hello.',instructions:'Implement the greeting.',requirementIds:['mandatory'],dependsOn:[],environmentIds:['provider'],contractIds:[],files:['cli.mjs'],criteria:['The CLI prints hello using the mandatory provider.'],checks,risk:'normal',blockedBy:[]};}
function plan(product:ProductBrief,checks:Verification[]):DevelopmentPlan{return{schema:'capivara/plan/1',status:'ready',revision:1,briefId:product.id,briefRevision:1,environment:[{id:'provider',name:'Required provider',kind:product.requirements[0]!.binding!.kind==='sdk'?'sdk':'runtime',identity:product.requirements[0]!.binding!,reason:'Mandatory implementation provider.',dependsOn:[],targets:['portable'],check:{command:process.execPath,args:['--version']},prepare:[],provides:{command:[process.execPath]}}],contracts:[],tasks:[unit(checks)],acceptance:checks};}
function runtimeCheck(command=process.execPath,args=['cli.mjs']):Verification{return{id:'runtime-usage',kind:'cli',command,args,expected:'contains:hello',level:'behavior',inputs:['cli.mjs'],requirementIds:['mandatory'],requiredCapabilities:[],conformance:{requirementId:'mandatory',capability:'implementation',kind:'runtime',provider:'Required provider',productInputs:['cli.mjs']}};}
function operational(root:string,product:ProductBrief,command?:string[]):OperationalEnvironment{return{...emptyOperationalEnvironment(root),bindings:{implementation:{...product.requirements[0]!.binding!,ready:true,...(command?{command}:{}),inputs:['vendor/provider.lib']}}};}
async function observed(root:string,check:Verification):Promise<VerificationEvidence>{
  const product=brief(),proposal=plan(product,[check]),task={...unit([check]),id:'$acceptance'};
  const result=await runVerification(root,product,task,proposal,check,executeCommand,runTerminal);
  expect(result.evidence.passed).toBe(true);
  expect(result.evidence.provenance).toBeDefined();
  return result.evidence;
}

describe('mandatory provider conformance uses product execution provenance',()=>{
  it('reuses task-owned runtime conformance without promoting or rerunning it as final acceptance',async()=>{
    const root=await workspace(),product=brief(),check=runtimeCheck(),proposal=plan(product,[check]);proposal.acceptance=[];
    let productRuns=0,calls=0;
    const execute:typeof executeCommand=async request=>{if(Array.isArray(request.command)&&request.command.includes('cli.mjs'))productRuns++;return executeCommand(request);};
    const agent:Parameters<typeof runBuild>[0]['agent']=async request=>{
      calls++;if(request.role==='editor')await writeFile(join(request.workspace,'cli.mjs'),"console.log('hello');\n");
      return{status:'complete',text:request.role==='reviewer'?'{"approved":true,"findings":[]}':'Implemented.',commands:[],changedFiles:[]};
    };
    const result=await runBuild({workspace:root,brief:product,plan:proposal,executeCommand:execute,agent});
    expect(result.status,JSON.stringify(result.incidents)).toBe('complete');expect(productRuns).toBe(1);
    expect(result.state.evidence.filter(proof=>proof.checkId===check.id&&proof.passed).map(proof=>proof.taskId)).toEqual(['greeting']);
    expect(result.plan.acceptance).toEqual([]);const previousCalls=calls;
    const resumed=await runBuild({workspace:root,brief:product,plan:result.plan,state:structuredClone(result.state),executeCommand:execute,agent});
    expect(resumed.status,JSON.stringify(resumed.incidents)).toBe('complete');expect(productRuns).toBe(1);expect(calls).toBe(previousCalls);
  });

  it('rejects a proof from the wrong owner and a task proof whose product input changed',async()=>{
    const root=await workspace(),product=brief(),check=runtimeCheck(),proposal=plan(product,[check]);proposal.acceptance=[];
    await writeFile(join(root,'cli.mjs'),"console.log('hello');\n");
    const run=(taskId:string)=>runVerification(root,product,{...unit([check]),id:taskId},proposal,check,executeCommand,runTerminal);
    const unrelated=await run('unrelated');expect(unrelated.evidence.passed).toBe(true);
    expect((await validateConformance(product,proposal,operational(root,product,[process.execPath]),[unrelated.evidence],root))[0]?.code).toBe('unproven-product-provider-usage');
    const current=await run('greeting');expect(await validateConformance(product,proposal,operational(root,product,[process.execPath]),[current.evidence],root)).toEqual([]);
    await writeFile(join(root,'cli.mjs'),"console.log('changed');\n");
    expect((await validateConformance(product,proposal,operational(root,product,[process.execPath]),[current.evidence],root))[0]?.message).toContain('Product inputs changed');
  });

  it('the real engine accepts actual runtime execution of product inputs',async()=>{
    const root=await workspace(),product=brief(),check=runtimeCheck();
    const result=await runBuild({workspace:root,brief:product,plan:plan(product,[check]),runTerminal,agent:async request=>{
      if(request.role==='editor')await writeFile(join(request.workspace,'cli.mjs'),"console.log('hello');\n");
      return{status:'complete',text:request.role==='reviewer'?'{"approved":true,"findings":[]}':'Implemented.',commands:[],changedFiles:[]};
    }});
    expect(result.status).toBe('complete');
    const receipt=result.state.evidence.find(proof=>proof.taskId==='greeting'&&proof.provenance&&proof.passed);
    expect(receipt?.provenance?.runtimeObservation?.enabled).toBe(true);
    expect(result.state.metrics?.repetitions.some(item=>item.action==='reuse-verification-receipt'&&item.reason.includes(receipt!.id))).toBe(true);
    expect(result.state.evidence.some(proof=>proof.taskId==='$acceptance'&&proof.checkId===check.id)).toBe(false);
  });

  it('the real engine rejects a different executable despite a ready correct provider and generic approvals',async()=>{
    const root=await workspace(),product=brief();
    const check={...runtimeCheck('/bin/sh',['cli.sh']),inputs:['cli.sh'],conformance:{...runtimeCheck().conformance!,productInputs:['cli.sh']}};
    const proposed=plan(product,[check]);proposed.tasks[0]!.files=['cli.sh'];
    const result=await runBuild({workspace:root,brief:product,plan:proposed,agent:async request=>{
      if(request.role==='editor')await writeFile(join(request.workspace,'cli.sh'),"printf 'hello\\n'\n");
      return{status:'complete',text:request.role==='reviewer'?'{"approved":true,"findings":[]}':'Implemented.',commands:[],changedFiles:[]};
    }});
    expect(result.status).toBe('waiting');
    expect(result.state.incidents.some(problem=>/conform|provider|usage/i.test(problem.message+' '+problem.evidence))).toBe(true);
  });

  it('availability probes cannot be relabeled as runtime product behavior',async()=>{
    const root=await workspace(),product=brief();await writeFile(join(root,'cli.mjs'),"console.log('hello');\n");
    const check={...runtimeCheck(),args:['--version'],expected:'regex:v\\d+'};
    const evidence=await observed(root,check);
    expect(await validateConformance(product,plan(product,[check]),operational(root,product,[process.execPath]),[evidence],root)).toEqual(expect.arrayContaining([expect.objectContaining({code:'unproven-product-provider-usage'})]));
  });

  it('compiled SDK acceptance links a produced artifact to real functional execution',async()=>{
    const root=await workspace(),product=brief('sdk');await mkdir(join(root,'out'));await writeFile(join(root,'input.expr'),'2 + 3');
    await writeFile(join(root,'compiler.mjs'),"import {readFileSync,writeFileSync} from 'node:fs'; const [source,out]=process.argv.slice(2);const m=readFileSync(source,'utf8').match(/^(\\d+) \\+ (\\d+)$/);if(!m)process.exit(2);writeFileSync(out,`console.log(${Number(m[1])+Number(m[2])});`);\n");
    const build:Verification={id:'produce',kind:'command',command:process.execPath,args:['compiler.mjs','input.expr','out/run.mjs'],expectedExitCode:0,level:'build',inputs:['compiler.mjs','input.expr'],outputs:['out/run.mjs'],requirementIds:['mandatory'],requiredCapabilities:[],conformance:{requirementId:'mandatory',...product.requirements[0]!.binding!,productInputs:['input.expr'],artifacts:['out/run.mjs']}};
    const run:Verification={id:'exercise',kind:'cli',command:process.execPath,args:['out/run.mjs'],expected:'contains:5',level:'behavior',dependsOn:['produce'],inputs:['out/run.mjs'],requirementIds:['mandatory'],requiredCapabilities:[]};
    const proposal=plan(product,[build,run]);const provider=operational(root,product,[process.execPath,join(root,'compiler.mjs')]);
    const produced=await observed(root,build),executed=await observed(root,run);
    const issues=await validateConformance(product,proposal,provider,[produced,executed],root);
    expect(issues,JSON.stringify(issues)).toEqual([]);
    expect((await validateConformance(product,proposal,provider,[produced],root))[0]?.message).toMatch(/artifact/);
    const taskOwned=structuredClone(proposal);taskOwned.acceptance=[];
    expect((await validateConformance(product,taskOwned,provider,[produced,executed],root))[0]?.code).toBe('unproven-product-provider-usage');
    const localBuild=await runVerification(root,product,taskOwned.tasks[0]!,taskOwned,build,executeCommand,runTerminal);
    const localRun=await runVerification(root,product,taskOwned.tasks[0]!,taskOwned,run,executeCommand,runTerminal);
    expect(await validateConformance(product,taskOwned,provider,[localBuild.evidence,localRun.evidence],root)).toEqual([]);
    expect((await validateConformance(product,taskOwned,provider,[localBuild.evidence],root))[0]?.message).toContain('functional recipe');
    const inferred=structuredClone(product);inferred.requirements[0]!.source.text='Required provider';inferred.requirements[0]!.binding!.kind='runtime';inferred.requirements[0]!.binding!.capability='An inferred language description';
    expect(validatePlan(inferred,taskOwned)).toEqual([]);
    expect(await validateConformance(inferred,taskOwned,provider,[localBuild.evidence,localRun.evidence],root)).toEqual([]);
    expect((await validateConformance(inferred,taskOwned,provider,[localBuild.evidence],root))[0]?.message).toContain('functional recipe');
  });

  it('a compiler label with no observed artifact and a library label with no consumption are refused',async()=>{
    const root=await workspace();await writeFile(join(root,'cli.mjs'),"console.log('hello');\n");
    const compiler=brief('sdk'),fake={...runtimeCheck(),level:'build' as const,conformance:{...runtimeCheck().conformance!,kind:'sdk' as const,artifacts:['out/nonexistent']}};
    const fakeProof=await observed(root,fake);
    expect((await validateConformance(compiler,plan(compiler,[fake]),operational(root,compiler,[process.execPath]),[fakeProof],root))[0]?.message).toMatch(/no observed artifact/);
    const library=brief('library'),check={...runtimeCheck(),conformance:{...runtimeCheck().conformance!,kind:'library' as const}};
    const proof=await observed(root,check);
    expect((await validateConformance(library,plan(library,[check]),operational(root,library),[proof],root))[0]?.message).toMatch(/Metadata alone/);
  });

  it('a behavior label on real SDK compiler output cannot bypass artifact interaction',async()=>{
    const root=await workspace(),product=brief('sdk');
    await mkdir(join(root,'out'));await writeFile(join(root,'input.expr'),'2 + 3');
    await writeFile(join(root,'compiler.mjs'),"import {readFileSync,writeFileSync} from 'node:fs';const [source,out]=process.argv.slice(2);const m=readFileSync(source,'utf8').match(/^(\\d+) \\+ (\\d+)$/);if(!m)process.exit(2);writeFileSync(out,`console.log(${Number(m[1])+Number(m[2])});`);console.log('compiled');\n");
    const check:Verification={id:'mislabelled-sdk',kind:'command',command:process.execPath,args:['compiler.mjs','input.expr','out/run.mjs'],expected:'contains:compiled',level:'behavior',inputs:['compiler.mjs','input.expr'],outputs:['out/run.mjs'],requirementIds:['mandatory'],requiredCapabilities:[],conformance:{requirementId:'mandatory',...product.requirements[0]!.binding!,productInputs:['input.expr'],artifacts:['out/run.mjs']}};
    const proof=await observed(root,check);
    const issues=await validateConformance(product,plan(product,[check]),operational(root,product,[process.execPath,join(root,'compiler.mjs')]),[proof],root);
    expect(issues[0]?.code).toBe('unproven-product-provider-usage');
    expect(issues[0]?.message).toContain('behavior label');
  });
});

describe('runtime conformance through real package-manager descendants',()=>{
  it('accepts npm → Node acceptance → imported product API with current load hashes',async()=>{
    const {prepareEnvironmentNode}=await import('../../src/execution/environment.js');
    const {inputSnapshot}=await import('../../src/execution/files.js');
    const root=await workspace(),product=brief();
    await writeFile(join(root,'product-api.mjs'),'export function answer(){return 42;}');
    await writeFile(join(root,'acceptance.mjs'),'import {answer} from "./product-api.mjs";if(answer()!==42)throw Error("API failed");console.log("API_OK 42");');
    await writeFile(join(root,'package.json'),JSON.stringify({scripts:{verify:`"${process.execPath}" acceptance.mjs`}}));
    const check:Verification={...runtimeCheck('npm',['run','verify']),expected:'The integrated product API returns its actual answer.',assertion:{type:'contains',value:'API_OK 42',source:'stdout'},inputs:['product-api.mjs','acceptance.mjs','package.json'],conformance:{...runtimeCheck().conformance!,productInputs:['product-api.mjs']}};
    const proposal=plan(product,[check]);
    const prepared=await prepareEnvironmentNode(root,proposal.environment[0]!,product,executeCommand);expect(prepared.ready).toBe(true);
    const result=await runVerification(root,product,{...unit([check]),id:'$acceptance'},proposal,check,executeCommand,runTerminal,{operational:prepared.operational});
    expect(result.evidence.passed).toBe(true);expect(result.evidence.assertionStatus).toBe('ready');
    expect(result.evidence.provenance?.command[0]).toBe('npm');
    const witnesses=result.evidence.provenance?.runtimeWitnesses??[];expect(witnesses).toHaveLength(1);
    const hash=(await inputSnapshot(root,['product-api.mjs']))['product-api.mjs'];
    expect(witnesses[0]!.inputs).toEqual({'product-api.mjs':hash});expect(witnesses[0]!.argv[1]).toBe(join(root,'acceptance.mjs'));
    expect(witnesses.every(witness=>!('acceptance.mjs' in witness.inputs))).toBe(true);
    expect(await validateConformance(product,proposal,prepared.operational,[result.evidence],root)).toEqual([]);
  });

  it('rejects a different runtime and a version probe even when npm and the product-source snapshot are present',async()=>{
    const {prepareEnvironmentNode}=await import('../../src/execution/environment.js');
    for(const probe of [false,true]){
      const root=await workspace(),product=brief();await writeFile(join(root,'product-api.mjs'),'export function answer(){return 42;}');
      const script=probe?`"${process.execPath}" --version`:process.platform==='win32'?'cmd /c echo API_OK 42':'printf "API_OK 42"';
      await writeFile(join(root,'package.json'),JSON.stringify({scripts:{verify:script}}));
      const check:Verification={...runtimeCheck('npm',['run','verify']),expected:probe?'The runtime is available.':'The API returns its answer.',assertion:probe?{type:'regex',pattern:'v\\d+\\.\\d+',source:'stdout'}:{type:'contains',value:'API_OK 42',source:'stdout'},inputs:['product-api.mjs','package.json'],conformance:{...runtimeCheck().conformance!,productInputs:['product-api.mjs']}};
      const proposal=plan(product,[check]);const prepared=await prepareEnvironmentNode(root,proposal.environment[0]!,product,executeCommand);expect(prepared.ready).toBe(true);
      const result=await runVerification(root,product,{...unit([check]),id:'$acceptance'},proposal,check,executeCommand,runTerminal,{operational:prepared.operational});
      expect(result.evidence.passed).toBe(true);expect(result.evidence.provenance?.inputs['product-api.mjs']).toBeDefined();expect(result.evidence.provenance?.runtimeWitnesses??[]).toEqual([]);
      const issues=await validateConformance(product,proposal,prepared.operational,[result.evidence],root);expect(issues[0]?.code).toBe('unproven-product-provider-usage');
    }
  });
});

describe('native runtime identity behind a concrete consumer launcher',()=>{
  for(const mode of ['product-import','echo-only','version-only'] as const)it.skipIf(process.platform==='win32')(`validates actual npm binding with ${mode}`,async()=>{
    const root=await workspace(),product=brief();
    const recipe:Verification={...runtimeCheck('npm',['run','verify']),inputs:['product-api.mjs','acceptance.mjs','package.json'],expected:mode==='version-only'?'The runtime version is visible.':'The product API returns its answer.',assertion:mode==='version-only'?{type:'regex',source:'stdout',pattern:'v\\d+\\.\\d+'}:{type:'contains',source:'stdout',value:'API_OK 42'},conformance:{...runtimeCheck().conformance!,productInputs:['product-api.mjs']}};
    const proposal=plan(product,[recipe]);proposal.environment[0]!.check={command:'npm',args:['--version']};proposal.environment[0]!.provides={command:['npm'],aliases:['npm']};proposal.tasks[0]!.files=['product-api.mjs','acceptance.mjs','package.json'];
    const outcome=await runBuild({workspace:root,brief:product,plan:proposal,signal:AbortSignal.timeout(10000),agent:async request=>{
      if(request.role==='editor'){
        await writeFile(join(request.workspace,'product-api.mjs'),'export const answer=()=>42;');await writeFile(join(request.workspace,'acceptance.mjs'),'import {answer} from "./product-api.mjs";if(answer()!==42)throw Error("product failed");console.log("API_OK 42")');
        const script=mode==='product-import'?`"${process.execPath}" acceptance.mjs`:mode==='version-only'?`"${process.execPath}" --version`:`"${process.execPath}" -e "console.log('API_OK 42')"`;
        await writeFile(join(request.workspace,'package.json'),JSON.stringify({name:'native-launcher-fixture',private:true,scripts:{verify:script}}));
      }
      return{status:'complete',text:request.role==='reviewer'?'{"approved":true,"findings":[]}':'Implemented.',commands:[],changedFiles:[]};
    }});
    const final=outcome.state.evidence.findLast(proof=>proof.taskId==='$acceptance'&&proof.checkId===recipe.id)??outcome.state.evidence.findLast(proof=>proof.taskId==='greeting'&&proof.checkId===recipe.id)!;expect(final.passed).toBe(true);expect(final.provenance?.runtimeObservation?.enabled).toBe(true);expect(final.provenance?.runtimeProvider?.launcher.shebang).toBe('#!/usr/bin/env node');expect(final.provenance?.runtimeProvider?.execPath).toBe(process.execPath);expect(final.provenance?.runtimeProvider?.bindingCommand[0]).not.toBe(process.execPath);
    if(mode==='product-import'){
      expect(outcome.status,JSON.stringify(outcome.incidents)).toBe('complete');expect(final.provenance?.runtimeWitnesses?.some(witness=>witness.inputs['product-api.mjs'])).toBe(true);
      expect(final.taskId).toBe('greeting');expect(outcome.state.metrics?.repetitions.some(item=>item.action==='reuse-verification-receipt'&&item.reason.includes(final.id))).toBe(true);
      const provider=outcome.state.environment.provider!.operational as OperationalEnvironment;
      const damaged=structuredClone(final);damaged.provenance!.runtimeProvider!.fingerprint='unrelated provider fingerprint';expect((await validateConformance(product,outcome.plan,provider,[damaged],root))[0]?.code).toBe('unproven-product-provider-usage');
    }else{
      expect(outcome.status).toBe('waiting');expect(final.provenance?.runtimeWitnesses??[]).toEqual([]);expect(outcome.incidents.some(issue=>issue.evidence.includes('unproven-product-provider-usage'))).toBe(true);
    }
  });
});
