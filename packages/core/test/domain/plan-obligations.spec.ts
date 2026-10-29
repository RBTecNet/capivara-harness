import { expect, it } from 'vitest';
import { runPlan } from '../../src/domain/plan.js';
import { derivePlanObligations, reconcilePlan, validatePlan } from '../../src/domain/reconcile.js';
import { validateConformance } from '../../src/execution/conformance.js';
import { emptyOperationalEnvironment } from '../../src/execution/environment.js';
import type { DevelopmentPlan, ProductBrief, Verification } from '../../src/domain/types.js';

function fixture(){
  const binding={capability:'runtime',kind:'runtime' as const,provider:'Node.js'};
  const brief:ProductBrief={schema:'capivara/product/1',status:'ready',id:'product',revision:1,name:'Application',summary:'Implement an API.',request:'Use Node.js runtime.',modes:['api'],targets:[],requirements:[{id:'stack',statement:'Use Node.js runtime.',kind:'stack',binding,mode:'shared',source:{kind:'request',reference:'request',text:'Node.js runtime'}}],constraints:[],decisions:[],gaps:[]};
  const plan:DevelopmentPlan={schema:'capivara/plan/1',status:'planning',revision:1,briefId:brief.id,briefRevision:1,environment:[{id:'node',name:'Node.js',kind:'runtime',identity:binding,dependsOn:[],targets:[],reason:'Execute the API.',check:{command:process.execPath,args:['--version'],capabilities:[]},prepare:[]}],contracts:[],tasks:[{id:'application',title:'Application',goal:'Implement the requested API.',instructions:'Implement the API.',requirementIds:['stack'],dependsOn:[],environmentIds:['node'],contractIds:[],files:['app.mjs'],criteria:['The API works.'],checks:[],risk:'normal',blockedBy:[]}],acceptance:[]};
  return{brief,plan,binding};
}

it('persists verification debt and finishes planning with zero model calls before source or usage recipes exist',async()=>{
  const {brief,plan}=fixture();let calls=0;const saved:DevelopmentPlan[]=[];
  const result=await runPlan({brief,existing:plan,save:async patch=>{if(patch.plan)saved.push(structuredClone(patch.plan));},agent:async()=>{calls++;throw new Error('No product code or proof metadata is needed to structure this plan.');}});
  expect(calls).toBe(0);expect(result.status).toBe('ready');expect(validatePlan(brief,result)).toEqual([]);
  const debt={requirementId:'stack',kind:'provider',provider:{provider:'Node.js',kind:'runtime'},recipeStatus:'pending',recipes:[],verification:'required-in-build'};
  expect(result.obligations).toEqual([debt]);expect(saved.at(-1)!.obligations).toEqual([debt]);expect(result.tasks[0]!.checks).toEqual([]);expect(result.acceptance).toEqual([]);
  expect(await validateConformance(brief,result,emptyOperationalEnvironment(process.cwd()),[],process.cwd())).toContainEqual(expect.objectContaining({code:'missing-conformance',requirementId:'stack'}));
});

it('does not classify a version probe or syntax check as a planned product proof',async()=>{
  const {brief,plan,binding}=fixture();
  for(const [args,level] of [[['--version'],'behavior'],[['--check','app.mjs'],'syntax']] as const){
    const check:Verification={id:'candidate',kind:'command',command:process.execPath,args:[...args],level,requirementIds:['stack'],requiredCapabilities:[],conformance:{...binding,requirementId:'stack',productInputs:['app.mjs']}};
    plan.tasks[0]!.checks=[check];const current=reconcilePlan(brief,plan);
    expect(validatePlan(brief,current)).toEqual([]);expect(current.obligations![0]!.recipeStatus).toBe('pending');
    const operational={...emptyOperationalEnvironment(process.cwd()),bindings:{node:{...binding,ready:true,command:[process.execPath]}}};
    expect((await validateConformance(brief,current,operational,[],process.cwd())).length).toBeGreaterThan(0);
  }
  plan.tasks[0]!.checks=[{...plan.tasks[0]!.checks[0]!,args:['app.mjs'],level:'behavior'}];
  expect(derivePlanObligations(brief,plan)[0]!).toMatchObject({recipeStatus:'planned',recipes:[{taskId:'application',checkId:'candidate'}],verification:'required-in-build'});
});

it('keeps actual provider, graph, coverage and browser interface defects blocking',()=>{
  const {brief,plan}=fixture();
  const wrong=structuredClone(plan);wrong.environment[0]!.identity!.provider='Other runtime';
  expect(validatePlan(brief,wrong).some(issue=>issue.code==='mandatory-provider-mismatch')).toBe(true);
  const unsupported=structuredClone(brief);unsupported.requirements[0]!.source.text='The source did not select a provider.';
  const unresolved=reconcilePlan(unsupported,plan);
  expect(unresolved.obligations![0]!).toMatchObject({provider:{provider:'Node.js'},recipeStatus:'pending'});
  expect(validatePlan(unsupported,unresolved).some(issue=>issue.code==='mandatory-provider-mismatch')).toBe(true);
  const cycle=structuredClone(plan);cycle.tasks[0]!.dependsOn=['application'];
  expect(validatePlan(brief,cycle).some(issue=>issue.code==='task-cycle')).toBe(true);
  const uncovered=structuredClone(plan);uncovered.tasks[0]!.requirementIds=[];
  expect(validatePlan(brief,uncovered).some(issue=>issue.code==='uncovered-requirement')).toBe(true);
  brief.requirements.push({id:'browser',statement:'Execute actual browser flows.',kind:'interface',mode:'web',source:{kind:'request',reference:'request',text:'Execute actual browser flows.'}});plan.tasks[0]!.requirementIds.push('browser');
  expect(validatePlan(brief,plan).some(issue=>issue.code==='unproven-interface-behavior')).toBe(true);
});

it('adopts an explicit literal identity correction without changing its executable or manufacturing a proof',async()=>{
  const {brief,plan,binding}=fixture();plan.environment[0]!.name='Runtime adapter';plan.environment[0]!.identity={...binding,provider:'Old adapter label'};
  let calls=0;
  const result=await runPlan({brief,existing:plan,agent:async()=>{calls++;return JSON.stringify({environmentUpdates:[{id:'node',identity:binding}],reason:'Correct the provider metadata while retaining the existing runtime.'});}});
  expect(calls).toBe(1);expect(result.environment[0]!.check).toEqual(plan.environment[0]!.check);expect(result.environment[0]!.prepare).toEqual(plan.environment[0]!.prepare);
  expect(result.environment[0]!.identityTransformations).toContainEqual(expect.objectContaining({from:{...binding,provider:'Old adapter label'},to:binding,requirementId:'stack',source:brief.requirements[0]!.source}));
  expect(result.tasks).toEqual(plan.tasks);expect(result.obligations![0]!.recipeStatus).toBe('pending');expect(result.tasks[0]!.checks).toEqual([]);
});
