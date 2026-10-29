import { expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { CapabilityIdentity, DevelopmentPlan, ProductBrief, Verification, WorkUnit } from '../../src/domain/types.js';
import { enrichVerificationConformance } from '../../src/execution/conformance-candidates.js';
import { emptyOperationalEnvironment } from '../../src/execution/environment.js';
import type { VerificationEvidence } from '../../src/execution/types.js';

it('adds scoped literal-provider candidates from ready bindings and existing code without promoting metadata, mutable data or verifier programs into product proof',async()=>{
  const workspace=await mkdtemp(join(tmpdir(),'capivara-conformance-candidates-'));
  try{
    const files:Record<string,string>={'src/app.ts':'export const app=true;','src/ui.tsx':'export const ui=true;','src/db.ts':'export const database=true;','scripts/browser.mjs':'console.log("browser runner");','dist/app.js':'console.log("built app");','dist/generated.js':'console.log("generated app");','data/fixture.sqlite':'mutable database bytes','README.md':'Documentation.','node_modules/provider/index.js':'provider implementation','.capivara-tools/tool.mjs':'tool implementation'};
    for(const [path,body] of Object.entries(files)){await mkdir(dirname(join(workspace,path)),{recursive:true});await writeFile(join(workspace,path),body);}
    await writeFile(join(workspace,'package.json'),JSON.stringify({name:'candidate-fixture',version:'1.0.0',scripts:{browser:'node scripts/browser.mjs'}}));
    const identities:CapabilityIdentity[]=[{provider:'Node.js',kind:'runtime',capability:'runtime'},{provider:'TypeScript',kind:'runtime',capability:'language'},{provider:'React',kind:'library',capability:'ui'},{provider:'Vite',kind:'cli',capability:'builder'},{provider:'SQLite',kind:'driver',capability:'database'},{provider:'StrictVM',kind:'runtime',capability:'strict-runtime'}];
    const brief:ProductBrief={schema:'capivara/product/1',id:'p',revision:1,status:'ready',name:'App',summary:'An integrated application.',request:'Use Node.js, TypeScript, React, Vite and SQLite. Use runtime StrictVM. Observe the interface.',modes:['web'],targets:['browser'],requirements:identities.map((binding,index)=>({id:`provider-${index}`,statement:`Use ${binding.provider}.`,kind:'stack',binding,mode:'shared',source:{kind:'request',reference:'request',text:index===5?'Use runtime StrictVM.':binding.provider}})),constraints:[],decisions:[],gaps:[]};
    const foundation:WorkUnit={id:'foundation',title:'Foundation',goal:'Prepare application code.',instructions:'Implement the foundation.',requirementIds:brief.requirements.map(requirement=>requirement.id),dependsOn:[],environmentIds:identities.map((_,index)=>`env-${index}`),contractIds:[],files:['src/'],criteria:['The application code works.'],checks:[],risk:'normal',blockedBy:[]};
    const task:WorkUnit={...foundation,id:'integration',title:'Integration',requirementIds:[],dependsOn:['foundation'],environmentIds:[],files:['scripts/browser.mjs']};
    const plan:DevelopmentPlan={schema:'capivara/plan/1',status:'ready',revision:1,briefId:brief.id,briefRevision:brief.revision,environment:identities.map((identity,index)=>({id:`env-${index}`,name:identity.provider,kind:identity.kind==='library'||identity.kind==='driver'?'package':identity.kind==='cli'?'tool':'runtime',identity,dependsOn:[],targets:[],reason:'Required by the product.',check:{command:'prepared-tool'},prepare:[]})),contracts:[],tasks:[foundation,task]};
    const operational=emptyOperationalEnvironment(workspace);
    identities.forEach((identity,index)=>{operational.bindings[`binding-${index}`]={...identity,...(index===5?{kind:'cli' as const}:{}),ready:true,fingerprint:`prepared-${index}`};});
    operational.bindings['typescript-cli']={provider:'TypeScript',kind:'cli',capability:'compiler invocation',ready:true,fingerprint:'prepared-ts-cli'};
    operational.bindings['sqlite-other']={provider:'SQLite',kind:'driver',capability:'alternative driver',ready:true,fingerprint:'prepared-sqlite-other'};
    operational.bindings.unrelated={provider:'OtherVM',kind:'runtime',capability:'unrelated',ready:true};
    const check:Verification={id:'shared-observation',kind:'web',command:'npm',args:['run','browser'],expected:'The original requested interaction succeeds.',assertion:{type:'contains',value:'observed'},inputs:['src/app.ts'],requirementIds:[],requiredCapabilities:['browser'],conformance:{requirementId:'provider-2',provider:'TypeScript',kind:'cli',capability:'compiler invocation',productInputs:['src/app.ts']}};
    const artifact={hash:'prior-output-hash',modified:'1',changed:'1'};
    const evidence:VerificationEvidence={id:'previous-build',taskId:foundation.id,checkId:'build',inputHash:'previous-input',passed:false,command:'build',output:'original failed observation remains negative',terminal:false,checkedAt:'2026-01-01T00:00:00.000Z',provenance:{workspace,command:'build',cwd:workspace,inputs:{},artifactsBefore:{},artifactsAfter:{'dist/app.js':artifact},exitCode:1,cancelled:false,timedOut:false,generatedArtifacts:['dist/generated.js','data/fixture.sqlite'].map(path=>({path,hash:'written-by-actual-process',execPath:process.execPath,nativeFingerprint:'host-fingerprint',pid:1,observedAt:'2026-01-01T00:00:00.000Z'}))}};
    const original=structuredClone(check),originalEvidence=structuredClone(evidence);
    const result=await enrichVerificationConformance({brief,plan,task,check,operational,workspace,evidence:[evidence],deliveryFiles:Object.keys(files)});
    const {conformanceClaims,conformanceInstrumentInputs,...preserved}=result.check;expect(preserved).toEqual(original);expect(evidence).toEqual(originalEvidence);
    expect(conformanceInstrumentInputs).toEqual(['scripts/browser.mjs']);expect(result.coverage.instrument.resolved).toBe(true);
    expect(conformanceClaims?.filter(claim=>claim.provider==='TypeScript').map(claim=>claim.kind).sort()).toEqual(['cli','runtime']);
    expect(conformanceClaims?.filter(claim=>claim.provider==='SQLite')).toHaveLength(2);expect(conformanceClaims?.some(claim=>['StrictVM','OtherVM'].includes(claim.provider))).toBe(false);
    expect(result.coverage.requirements.find(requirement=>requirement.requirementId==='provider-5')?.status).toBe('unavailable');
    for(const claim of conformanceClaims??[]){expect(claim.productInputs).toEqual(expect.arrayContaining(['src/app.ts','src/db.ts','src/ui.tsx','dist/app.js','dist/generated.js']));expect(claim.productInputs).not.toEqual(expect.arrayContaining(['README.md']));for(const omitted of ['data/fixture.sqlite','scripts/browser.mjs','node_modules/provider/index.js','.capivara-tools/tool.mjs'])expect(claim.productInputs).not.toContain(omitted);}
    await writeFile(join(workspace,'README.md'),'Changed documentation.');await writeFile(join(workspace,'data/fixture.sqlite'),'Changed mutable data.');
    const again=await enrichVerificationConformance({brief,plan,task,check:result.check,operational,workspace,evidence:[evidence],deliveryFiles:Object.keys(files)});
    expect(again.check).toEqual(result.check);
    const unavailable=structuredClone(operational);for(const binding of Object.values(unavailable.bindings))binding.ready=false;
    expect((await enrichVerificationConformance({brief,plan,task,check,operational:unavailable,workspace})).check).toBe(check);
  }finally{await rm(workspace,{recursive:true,force:true});}
});
