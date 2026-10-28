import { expect, it } from 'vitest';
import { validatePlan } from '../../src/domain/index.js';
import type { CapabilityIdentity, DevelopmentPlan, ProductBrief, WorkUnit } from '../../src/domain/types.js';

function brief():ProductBrief{return{schema:'capivara/product/1',id:'multi-stack',status:'ready',revision:1,name:'Mandatory stack',summary:'A complete application',request:'Use Node.js, TypeScript, React, Vite and SQLite.',modes:['web'],targets:['browser'],requirements:[],constraints:[],decisions:[],gaps:[]};}
function unit(id:string,goal:string,requirementIds:string[]):WorkUnit{return{id,title:goal,goal,instructions:goal,requirementIds,dependsOn:[],environmentIds:[],contractIds:[],files:[`${id}.ts`],criteria:[goal],checks:[],risk:'normal',blockedBy:[]};}
function plan(product:ProductBrief,tasks:WorkUnit[]):DevelopmentPlan{return{schema:'capivara/plan/1',status:'ready',revision:1,briefId:product.id,briefRevision:product.revision,environment:[],contracts:[],tasks};}

it('exige provedor e aceite específicos para cada escolha de uma stack composta, sem tratar Node como cobertura das demais',()=>{
  const bindings:CapabilityIdentity[]=[
    {capability:'javascript-runtime',kind:'runtime',provider:'Node.js'},
    {capability:'typescript-compiler',kind:'sdk',provider:'TypeScript'},
    {capability:'ui-framework',kind:'library',provider:'React'},
    {capability:'frontend-bundler',kind:'cli',provider:'Vite'},
    {capability:'embedded-storage',kind:'library',provider:'SQLite'},
  ];
  const product=brief();product.requirements=bindings.map((binding,index)=>({id:`stack-${index}`,statement:`Usar ${binding.provider}.`,kind:'stack',binding,mode:'shared',source:{kind:'request',reference:'request',text:binding.provider}}));
  const task=unit('foundation','Construir a aplicação com todas as escolhas obrigatórias',product.requirements.map(requirement=>requirement.id));task.environmentIds=bindings.map((_,index)=>`provider-${index}`);
  const current=plan(product,[task]);
  current.environment=bindings.map((binding,index)=>({id:`provider-${index}`,name:binding.provider,kind:binding.kind==='runtime'?'runtime':binding.kind==='sdk'?'sdk':binding.kind==='cli'?'tool':'package',identity:binding,requirementIds:[`stack-${index}`],dependsOn:[],targets:[],reason:'Capacidade escolhida explicitamente no pedido.',check:{command:`provider-${index}`,args:['--version']},prepare:[]}));
  current.acceptance=bindings.map((binding,index)=>({id:`proof-${index}`,kind:'command',command:`verify-${index}`,level:binding.kind==='sdk'?'build':'behavior',assertion:{type:'contains',value:`provider-${index}-observed`},requirementIds:[`stack-${index}`],requiredCapabilities:[],conformance:{...binding,requirementId:`stack-${index}`,productInputs:['foundation.ts'],...(binding.kind==='sdk'?{artifacts:['dist/foundation.js']}:{})}}));
  expect(validatePlan(product,current)).toEqual([]);
  for(const requirement of product.requirements){
    const missingProvider=structuredClone(current);missingProvider.environment=missingProvider.environment.filter(node=>node.requirementIds?.includes(requirement.id)!==true);
    expect(validatePlan(product,missingProvider).some(issue=>issue.code==='mandatory-provider-mismatch'&&issue.subject===requirement.id)).toBe(true);
    const missingProof=structuredClone(current);missingProof.acceptance=missingProof.acceptance!.filter(check=>check.conformance?.requirementId!==requirement.id);
    expect(validatePlan(product,missingProof).filter(issue=>issue.code==='unproven-mandatory-provider').map(issue=>issue.subject)).toEqual([requirement.id]);
  }
  const onlyRuntime=structuredClone(current);onlyRuntime.acceptance=[{...current.acceptance[0]!,requirementIds:product.requirements.map(requirement=>requirement.id)}];
  expect(validatePlan(product,onlyRuntime).filter(issue=>issue.code==='unproven-mandatory-provider').map(issue=>issue.subject)).toEqual(['stack-1','stack-2','stack-3','stack-4']);
});

