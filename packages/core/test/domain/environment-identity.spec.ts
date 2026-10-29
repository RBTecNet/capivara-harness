import { expect, it } from 'vitest';
import { normalizeEnvironment, runPlan } from '../../src/domain/plan.js';
import { validatePlan } from '../../src/domain/reconcile.js';
import type { DevelopmentPlan, EnvironmentNode, ProductBrief, Verification, WorkUnit } from '../../src/domain/types.js';

function fixture(name='TinyLang'){
  const brief:ProductBrief={schema:'capivara/product/1',status:'ready',id:'product',revision:1,name:'Application',summary:'Compile and run an application.',request:'Use TinyLang.',modes:['cli'],targets:[],requirements:[{id:'language',statement:'Use TinyLang.',kind:'stack',binding:{capability:'language',kind:'runtime',provider:'TinyLang'},mode:'shared',source:{kind:'request',reference:'request',text:'TinyLang'}}],constraints:[],decisions:[],gaps:[]};
  const environment:EnvironmentNode={id:'compiler',name,kind:'sdk',dependsOn:[],targets:[],reason:'Compile product source.',check:{command:'tinyc',args:['--version'],capabilities:[]},prepare:[]};
  const check:Verification={id:'compile',kind:'command',command:'tinyc',args:['src/main.tiny','-o','dist/app'],level:'build',expectedExitCode:0,inputs:['src/main.tiny'],outputs:['dist/app'],requirementIds:['language'],requiredCapabilities:[],conformance:{capability:'compiler',kind:'sdk',provider:'TinyLang',requirementId:'language',productInputs:['src/main.tiny'],artifacts:['dist/app']}};
  const task:WorkUnit={id:'application',title:'Application',goal:'Compile and execute the requested application.',instructions:'Implement the application.',requirementIds:['language'],dependsOn:[],environmentIds:['compiler'],contractIds:[],files:['src/main.tiny'],criteria:['The application works.'],checks:[check],risk:'normal',blockedBy:[]};
  const plan:DevelopmentPlan={schema:'capivara/plan/1',status:'ready',revision:1,briefId:brief.id,briefRevision:1,environment:[environment],contracts:[],tasks:[task],acceptance:[]};
  return{brief,environment,plan,task};
}

it('completes exact provider identities from the operational node role without a technology catalogue',()=>{
  const {brief}=fixture();
  const decoded=normalizeEnvironment([{id:'compiler',name:'TinyLang',kind:'sdk',check:{command:'tinyc',args:['--version']},prepare:[]}],brief)[0]!;
  expect(decoded.identity).toEqual({capability:'compiler',kind:'sdk',provider:'TinyLang'});
  expect(decoded.identityOrigin).toEqual({kind:'literal-provider-name',requirementIds:['language'],operationalKind:'sdk'});
  expect(decoded.requirementIds).toEqual(['language']);expect(brief.requirements[0]!.binding!.kind).toBe('runtime');expect(decoded.provides).toBeUndefined();
  expect(normalizeEnvironment([decoded],brief)).toEqual([decoded]);
});

it('preserves concrete module provider declarations without treating their text as an executable',()=>{
  const {brief,environment}=fixture();
  const modules=[{protocol:'node',specifier:'node:sqlite',runtimeCommand:['node']},{protocol:'python',specifier:'sqlite3',runtimeCommand:['python3','-I']}];
  const decoded=normalizeEnvironment([{...environment,provides:{modules:[...modules,{protocol:'unknown',specifier:'x',runtimeCommand:['x']},{protocol:'node',specifier:'',runtimeCommand:[]}]}}],brief)[0]!;
  expect(decoded.provides?.modules).toEqual(modules);expect(decoded.provides?.command).toBeUndefined();
});

it('normalizes an already saved READY environment before validation without buying another inference',async()=>{
  const {brief,plan,task}=fixture(),original=structuredClone(plan);let calls=0;
  const result=await runPlan({brief,existing:plan,agent:async()=>{calls++;throw new Error('Exact identity completion is native work.');}});
  expect(calls).toBe(0);expect(result.status).toBe('ready');expect(validatePlan(brief,result)).toEqual([]);
  expect(result.environment[0]!.identity?.kind).toBe('sdk');expect(result.tasks).toEqual([task]);expect(plan).toEqual(original);
  expect(brief.requirements[0]!.bindingTransformations?.[0]?.to.kind).toBe('sdk');
});

it('publishes the completed operational identity before asking for construction slices',async()=>{
  const {brief,environment,task}=fixture();const calls:string[]=[];
  const result=await runPlan({brief,agent:async request=>{
    calls.push(request.operation);
    if(request.operation==='environment')return JSON.stringify({environment:[environment]});
    expect(request.operation).toBe('outline');
    const providers=JSON.parse(request.prompt.split('Technical prerequisites available in this slice (the full tree is recorded separately):\n')[1]!.split('\n\n')[0]!) as EnvironmentNode[];
    expect(providers[0]!.identity).toEqual({capability:'compiler',kind:'sdk',provider:'TinyLang'});
    return JSON.stringify({tasks:[task]});
  }});
  expect(calls).toEqual(['environment','outline']);expect(validatePlan(brief,result)).toEqual([]);
});

it('records pending product usage without buying metadata before the code exists',async()=>{
  const {brief,plan}=fixture();delete plan.tasks[0]!.checks[0]!.conformance;
  let calls=0;
  const result=await runPlan({brief,existing:plan,agent:async()=>{calls++;throw new Error('Missing conformance metadata is explicit BUILD debt.');}});
  expect(calls).toBe(0);expect(validatePlan(brief,result)).toEqual([]);expect(result.environment[0]!.identity?.kind).toBe('sdk');expect(brief.requirements[0]!.binding!.kind).toBe('runtime');
  expect(result.obligations).toContainEqual(expect.objectContaining({requirementId:'language',kind:'provider',recipeStatus:'pending',verification:'required-in-build'}));
});

it('keeps partial names, conflicting identities and ambiguous explicit capabilities unresolved',()=>{
  const {brief,environment}=fixture();
  for(const name of ['TinyLang runtime','OtherTinyLang','Tiny'])expect(normalizeEnvironment([{...environment,name}],brief)[0]!.identity).toBeUndefined();
  const conflicting={...environment,identity:{capability:'compiler',kind:'sdk' as const,provider:'Other provider'}};
  expect(normalizeEnvironment([conflicting],brief)[0]!.identity).toEqual(conflicting.identity);
  const explicit=structuredClone(brief);explicit.requirements[0]!.source.text='TinyLang CLI';
  expect(normalizeEnvironment([environment],explicit)[0]!.identity).toBeUndefined();
  for(const [index,capability] of ['compiler-a','compiler-b'].entries())brief.requirements[index]={...brief.requirements[0]!,id:`capability-${index}`,binding:{capability,kind:'sdk',provider:'TinyLang'},source:{kind:'request',reference:'request',text:`TinyLang sdk, capability: ${capability}`}};
  expect(normalizeEnvironment([environment],brief)[0]!.identity).toBeUndefined();
});

it('patches only missing environment identity over the existing readiness and preparation definition',async()=>{
  const {brief,plan,environment,task}=fixture('Compiler toolchain');let calls=0;
  const result=await runPlan({brief,existing:plan,agent:async request=>{
    calls++;expect(request.prompt).toContain('Repair protocol: environment-identity');expect(request.prompt).toContain('environmentUpdates');
    return JSON.stringify({environmentUpdates:[{id:environment.id,identity:{capability:'compiler',kind:'sdk',provider:'TinyLang'}}]});
  }});
  expect(calls).toBe(1);expect(validatePlan(brief,result)).toEqual([]);expect(result.tasks).toEqual([task]);
  expect(result.environment[0]!.check).toEqual(environment.check);expect(result.environment[0]!.prepare).toEqual(environment.prepare);expect(result.environment).toHaveLength(1);
});

it('escalates an identity-free answer to an environment patch instead of repeating proof-only repairs',async()=>{
  const {brief,plan,environment}=fixture('Compiler toolchain');const protocols:string[]=[];
  const result=await runPlan({brief,existing:plan,agent:async request=>{
    protocols.push(request.prompt.split('\n')[0]!);
    return JSON.stringify(protocols.length===1?{environment:[environment],verificationUpdates:[{owner:'application',check:{id:'compile',conformance:plan.tasks[0]!.checks[0]!.conformance}}]}:{environmentUpdates:[{id:'compiler',identity:{capability:'compiler',kind:'sdk',provider:'TinyLang'}}]});
  }});
  expect(protocols).toHaveLength(2);expect(protocols[0]).toContain('environment-identity');expect(protocols[1]).toContain('environment-reference-patches');expect(validatePlan(brief,result)).toEqual([]);
});
