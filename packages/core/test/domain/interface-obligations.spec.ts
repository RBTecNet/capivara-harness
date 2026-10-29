import { expect, it } from 'vitest';
import { runPlan } from '../../src/domain/plan.js';
import { derivePlanObligations, preferredProofOwner, requiredTaskInterfaces, validatePlan } from '../../src/domain/reconcile.js';
import { scopeContribution } from '../../src/domain/contribution.js';
import type { DevelopmentPlan, ProductBrief, Verification } from '../../src/domain/types.js';

it.each(['web','tui','desktop','cli'] as const)('persists required %s behavior as explicit BUILD debt without inventing a pre-code command',async mode=>{
  const brief:ProductBrief={schema:'capivara/product/1',id:'product',revision:1,status:'ready',name:'Application',summary:`Deliver a ${mode} application.`,request:`Deliver a working ${mode} interface.`,modes:[mode],targets:[],requirements:[{id:'interaction',statement:`Deliver a working ${mode} interface.`,kind:'interface',mode,source:{kind:'request',reference:'request',text:`Deliver a working ${mode} interface.`}}],constraints:[],decisions:[],gaps:[]};
  const plan:DevelopmentPlan={schema:'capivara/plan/1',status:'planning',revision:1,briefId:brief.id,briefRevision:brief.revision,environment:[],contracts:[],tasks:[{id:'application',title:'Application',goal:brief.summary,instructions:'Implement the requested interaction.',requirementIds:['interaction'],dependsOn:[],environmentIds:[],contractIds:[],files:['product.mjs'],criteria:[brief.requirements[0]!.statement],checks:[],risk:'normal',blockedBy:[]}],acceptance:[]};
  let calls=0;const saved:DevelopmentPlan[]=[];
  const result=await runPlan({brief,existing:plan,agent:async()=>{calls++;throw new Error('A future executable does not exist yet.');},save:async patch=>{if(patch.plan)saved.push(structuredClone(patch.plan));}});
  const debt={requirementId:'interaction',kind:'interface',interface:mode,recipeStatus:'pending',recipes:[],verification:'required-in-build'};
  expect(calls).toBe(0);expect(result.status).toBe('ready');expect(validatePlan(brief,result)).toEqual([]);
  expect(result.obligations).toEqual([debt]);expect(saved.at(-1)!.obligations).toEqual([debt]);
  expect(result.tasks).toEqual(plan.tasks);expect(result.acceptance).toEqual([]);
  expect(requiredTaskInterfaces(brief,result,result.tasks[0]!)).toEqual([mode]);
  const candidate:Verification={id:'candidate',kind:mode,command:process.execPath,args:['--version'],level:'behavior',requirementIds:['interaction'],requiredCapabilities:mode==='web'?['browser']:[]};
  const {command:_command,...withoutCommand}=candidate;
  for(const recipe of [{...withoutCommand,args:[]},{...candidate,level:'syntax' as const,args:['--check','product.mjs']},{...candidate,kind:'command' as const,level:'build' as const,args:['product.mjs']},candidate]){
    result.tasks[0]!.checks=[recipe];
    expect(validatePlan(brief,result)).toEqual([]);
    expect(derivePlanObligations(brief,result)).toEqual([debt]);
  }
  result.tasks[0]!.checks=[{...candidate,args:['product.mjs'],assertion:{type:'exit',value:0}}];
  expect(derivePlanObligations(brief,result)).toEqual([{...debt,recipeStatus:'planned',recipes:[{taskId:'application',checkId:'candidate'}]}]);
  expect(result).not.toHaveProperty('evidence');
});

it('a suggested browser recipe cannot promote a partial contribution into the final interaction owner',()=>{
  const brief:ProductBrief={schema:'capivara/product/1',id:'p',revision:1,status:'ready',name:'Web',summary:'A working web application.',request:'A working web application.',modes:['web'],targets:[],requirements:[{id:'ui',statement:'A working web application.',kind:'interface',mode:'web',source:{kind:'request',reference:'request',text:'A working web application.'}}],constraints:[],decisions:[],gaps:[]};
  const foundation={id:'shell',title:'Shell',goal:'Navigation structure.',instructions:'Implement navigation.',requirementIds:['ui'],dependsOn:[],environmentIds:[],contractIds:[],files:['src/'],criteria:['Navigation structure.'],checks:[{id:'suggested',kind:'command' as const,command:'npm',args:['run','dev'],level:'behavior' as const,requirementIds:['ui'],requiredCapabilities:['browser']}],risk:'normal' as const,blockedBy:[]};
  const final={...foundation,id:'interaction',title:'Interaction',dependsOn:['shell'],checks:[]};
  const plan:DevelopmentPlan={schema:'capivara/plan/1',status:'ready',revision:1,briefId:'p',briefRevision:1,environment:[],contracts:[],tasks:[foundation,final],acceptance:[]};
  expect(requiredTaskInterfaces(brief,plan,foundation)).toEqual([]);
  expect(requiredTaskInterfaces(brief,plan,final)).toEqual(['web']);
  expect(foundation.checks[0]).toEqual(expect.objectContaining({id:'suggested',command:'npm'}));
});

it('keeps interface debt global when a downstream contract consumes an internal contribution without repeating every requirement ID',()=>{
  const brief:ProductBrief={schema:'capivara/product/1',id:'p',revision:1,status:'ready',name:'TUI',summary:'Search through the terminal interface.',request:'Search through the terminal interface.',modes:['tui'],targets:[],requirements:[{id:'search',statement:'Search records through the terminal interface.',kind:'behavior',mode:'tui',source:{kind:'request',reference:'request',text:'Search records through the terminal interface.'}},{id:'layout',statement:'Render terminal navigation.',kind:'interface',mode:'tui',source:{kind:'request',reference:'request',text:'Render terminal navigation.'}}],constraints:[],decisions:[],gaps:[]};
  const backend={id:'catalog',title:'Catalog',goal:'Return filtered records.',instructions:'Provide the catalog interface.',requirementIds:['search'],dependsOn:[],environmentIds:[],contractIds:['catalog'],files:['catalog.py'],criteria:['Return filtered records.'],checks:[],risk:'normal' as const,blockedBy:[]};
  const frontend={...backend,id:'navigation',title:'Navigation',goal:'Render terminal navigation.',requirementIds:['layout'],dependsOn:['catalog'],files:['navigation.py']};
  const plan:DevelopmentPlan={schema:'capivara/plan/1',status:'ready',revision:1,briefId:'p',briefRevision:1,environment:[],contracts:[{id:'catalog',name:'Searchable records',description:'Provide filtered records to navigation.',inputs:[],outputs:['filtered records'],requirementIds:['search']}],tasks:[backend,frontend]};
  expect(requiredTaskInterfaces(brief,plan,backend)).toEqual([]);
  expect(requiredTaskInterfaces(brief,plan,frontend)).toEqual(['tui']);
  expect(scopeContribution(brief,plan,backend).requirements).toEqual([{requirementId:'search',contribution:'partial',downstreamTaskIds:['navigation']}]);
  expect(preferredProofOwner(plan,'search')).toBeUndefined();
  expect(derivePlanObligations(brief,plan)).toContainEqual(expect.objectContaining({requirementId:'search',interface:'tui',recipeStatus:'pending',verification:'required-in-build'}));
  frontend.dependsOn=[];
  expect(requiredTaskInterfaces(brief,plan,backend)).toEqual(['tui']);
});
