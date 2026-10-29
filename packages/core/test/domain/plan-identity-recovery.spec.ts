import { expect, it } from 'vitest';
import { runPlan } from '../../src/domain/plan.js';
import type { DevelopmentPlan, ProductBrief, WorkUnit } from '../../src/domain/types.js';

it('recovers a real identity collision without deleting definitions or guessing an ambiguous prerequisite owner',async()=>{
  const brief:ProductBrief={schema:'capivara/product/1',id:'p',revision:1,status:'ready',name:'Records',summary:'Manage customers and orders.',request:'Manage customers and orders.',modes:['cli'],targets:['portable'],requirements:[{id:'records',statement:'Manage customers and orders.',source:{kind:'request',reference:'request',text:'Manage customers and orders.'},mode:'shared'}],constraints:[],decisions:[],gaps:[]};
  const unit=(id:string,goal:string,files:string[],dependsOn:string[]=[]):WorkUnit=>({id,title:goal,goal,instructions:goal,requirementIds:['records'],dependsOn,environmentIds:[],contractIds:[],files,criteria:[goal],checks:[],risk:'normal',blockedBy:[]});
  const tasks=[unit('delivery','Persist customers.',['customers.ts']),unit('delivery','Persist orders.',['orders.ts']),unit('consumer','Expose both repositories.',['main.ts'],['delivery'])];
  const existing:DevelopmentPlan={schema:'capivara/plan/1',revision:1,briefId:brief.id,briefRevision:1,status:'planning',environment:[],contracts:[],tasks,planning:{schema:'capivara/plan-progress/1',briefRevision:1,groups:[{requirementIds:['records'],environmentComplete:true,outlineComplete:true,environmentScope:[]}]}};
  const original=structuredClone(existing);
  let calls=0;
  const result=await runPlan({brief,existing,agent:async request=>{
    expect(request.operation).toBe('repair');expect(request.prompt).toContain('Resolve colliding task identifiers only');calls++;
    // The first naming-only answer must not silently bind the consumer to one
    // definition. Recovery requests its actual owners before adopting it.
    return JSON.stringify({renames:[{index:1,id:'orders'}],references:calls===1?[]:[{index:2,dependencyId:'delivery',targetIndexes:[0,1]}],reason:'Customers and orders are separate repository deliveries; the entry point consumes both.'});
  }});
  expect(calls).toBe(2);expect(result.status).toBe('ready');
  expect(result.tasks.map(task=>task.id)).toEqual(['delivery','orders','consumer']);
  expect(result.tasks[0]).toEqual(original.tasks[0]);
  expect(result.tasks[1]).toEqual({...original.tasks[1],id:'orders'});
  expect(result.tasks[2]).toEqual({...original.tasks[2],dependsOn:['delivery','orders']});
  expect(existing).toEqual(original);
});
