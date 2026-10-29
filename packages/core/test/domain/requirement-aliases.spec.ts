import { expect, it } from 'vitest';
import { normalizeTasks, runPlan } from '../../src/domain/plan.js';
import { reconcilePlan, resolveRequirementAlias, validatePlan } from '../../src/domain/reconcile.js';
import type { DevelopmentPlan, ProductBrief, WorkUnit } from '../../src/domain/types.js';

function fixture(){
  const binding={capability:'javascript-runtime',kind:'runtime' as const,provider:'Node.js'};
  const brief:ProductBrief={schema:'capivara/product/1',status:'ready',id:'product',revision:2,name:'Application',summary:'Run the application',request:'Use Node.js runtime with capability: javascript-runtime.',modes:['api'],targets:[],requirements:[{id:'runtime',statement:'Use Node.js.',kind:'stack',binding,mode:'shared',source:{kind:'request',reference:'request',text:'Node.js runtime, capability: javascript-runtime'}}],requirementAliases:{'generated-child':'runtime'},constraints:[],decisions:[],gaps:[]};
  const check={id:'runtime-proof',kind:'command' as const,command:'node',args:['app.mjs'],level:'behavior' as const,assertion:{type:'contains' as const,value:'running'},requirementIds:['generated-child'],requiredCapabilities:[],conformance:{...binding,requirementId:'generated-child',productInputs:['app.mjs']}};
  const task:WorkUnit={id:'foundation',title:'Application',goal:'Run the requested application',instructions:'Implement the application.',requirementIds:['generated-child','runtime'],dependsOn:[],environmentIds:['node'],contractIds:['api'],files:['app.mjs'],criteria:['The application runs.'],checks:[check],risk:'normal',blockedBy:[]};
  const plan:DevelopmentPlan={schema:'capivara/plan/1',status:'ready',revision:1,briefId:brief.id,briefRevision:1,environment:[{id:'node',name:'Node.js',kind:'runtime',identity:binding,requirementIds:['generated-child'],dependsOn:[],targets:[],reason:'Execute product.',check:{command:'node',args:['--version']},prepare:[]}],contracts:[{id:'api',name:'API',description:'Application behavior.',inputs:[],outputs:[],requirementIds:['generated-child']}],tasks:[task],acceptance:[check]};
  return{brief,plan,binding};
}

it('remaps retired generated requirement references through active aliases without changing the provider contract',()=>{
  const {brief,plan,binding}=fixture(),original=structuredClone(plan);
  brief.requirementAliases!['generated-child']='intermediate';brief.requirementAliases!.intermediate='runtime';
  const reconciled=reconcilePlan(brief,plan,plan);
  expect(reconciled.tasks[0]!.requirementIds).toEqual(['runtime']);
  expect(reconciled.tasks[0]!.checks[0]!.requirementIds).toEqual(['runtime']);
  expect(reconciled.acceptance![0]!.conformance).toEqual({...binding,requirementId:'runtime',productInputs:['app.mjs']});
  expect(reconciled.contracts[0]!.requirementIds).toEqual(['runtime']);expect(reconciled.environment[0]!.requirementIds).toEqual(['runtime']);
  expect(validatePlan(brief,reconciled)).toEqual([]);expect(plan).toEqual(original);
});

it('consumes valid aliases before filtering normalized task coverage or deciding to regenerate an existing plan',async()=>{
  const {brief,plan}=fixture();
  const normalized=normalizeTasks([plan.tasks[0]],brief,plan.environment,plan.contracts);
  expect(normalized[0]!.requirementIds).toEqual(['runtime']);
  let calls=0;
  const result=await runPlan({brief,existing:plan,agent:async()=>{calls++;throw new Error('A valid retired child must not trigger full planning.');}});
  expect(calls).toBe(0);expect(result.status).toBe('ready');expect(result.tasks.map(task=>task.id)).toEqual(['foundation']);
  expect(result.acceptance![0]!.conformance!.requirementId).toBe('runtime');expect(validatePlan(brief,result)).toEqual([]);
});

it('never changes capability, provider or kind to make an old conformance claim satisfy the active requirement',()=>{
  const {brief,plan}=fixture();plan.acceptance![0]!.conformance!.capability='backend-runtime';
  plan.tasks[0]!.checks[0]!.conformance!.capability='backend-runtime';
  const reconciled=reconcilePlan(brief,plan);
  expect(reconciled.acceptance![0]!.conformance!.requirementId).toBe('runtime');
  expect(reconciled.acceptance![0]!.conformance!.capability).toBe('backend-runtime');
  expect(validatePlan(brief,reconciled)).toEqual([]);
  expect(reconciled.obligations).toContainEqual(expect.objectContaining({requirementId:'runtime',kind:'provider',recipeStatus:'pending',verification:'required-in-build'}));
});

it('keeps cycles and nonexistent targets diagnosable instead of mapping them to an arbitrary active requirement',()=>{
  for(const aliases of [{'generated-child':'other',other:'generated-child'},{'generated-child':'missing'}]){
    const {brief,plan}=fixture();brief.requirementAliases=aliases;
    const reconciled=reconcilePlan(brief,plan);
    expect(resolveRequirementAlias(brief,'generated-child')).toBe('generated-child');
    expect(reconciled.tasks[0]!.requirementIds).toContain('generated-child');
    const issues=validatePlan(brief,reconciled);
    expect(issues.some(issue=>issue.code==='invalid-requirement-alias')).toBe(true);expect(issues.some(issue=>issue.code==='unknown-requirement')).toBe(true);
  }
});

it('does not retire an active original obligation through an alias entry',()=>{
  const {brief,plan}=fixture();brief.requirementAliases!.runtime='generated-child';
  const reconciled=reconcilePlan(brief,plan);
  expect(resolveRequirementAlias(brief,'runtime')).toBe('runtime');expect(reconciled.tasks[0]!.requirementIds).toContain('runtime');
  expect(validatePlan(brief,reconciled).some(issue=>issue.code==='invalid-requirement-alias'&&issue.subject==='runtime')).toBe(true);
});
