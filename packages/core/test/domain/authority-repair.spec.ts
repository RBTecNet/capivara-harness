import { expect, it } from 'vitest';
import { applyAuthorityAmendments } from '../../src/domain/authority-repair.js';
import { repairWorkPlan } from '../../src/domain/plan.js';
import type { DevelopmentPlan, ProductBrief } from '../../src/domain/types.js';

const literal='Modules must remain independent. Do not create relationships between their records.';
const validCriterion='Records persist across restarts.';
const inventedCriterion='Linked resources have a cascading deletion policy.';
const inventedInstruction='Decide how linked resources cascade into records.';
function fixture(){
  const brief:ProductBrief={schema:'capivara/product/1',id:'p',status:'ready',revision:1,name:'Records',summary:'Independent persistent modules.',request:`${literal}\n${validCriterion}`,modes:['api'],targets:[],requirements:[{id:'independence',kind:'behavior',statement:'Keep the modules independent.',mode:'api',source:{kind:'request',reference:'request',text:literal}},{id:'persistence',kind:'behavior',statement:validCriterion,mode:'api',source:{kind:'request',reference:'request',text:validCriterion}}],constraints:[],decisions:[],gaps:[]};
  const plan:DevelopmentPlan={schema:'capivara/plan/1',status:'ready',revision:1,briefId:brief.id,briefRevision:brief.revision,environment:[],contracts:[],tasks:[{id:'storage',title:'Storage',goal:'Persist independent records.',instructions:`Implement each repository. ${inventedInstruction} Preserve existing records.`,requirementIds:['independence','persistence'],dependsOn:[],environmentIds:[],contractIds:[],files:['src/storage.ts'],criteria:[validCriterion,inventedCriterion],checks:[{id:'storage-proof',kind:'command',command:'node',args:['--test','test/storage.test.mjs'],level:'behavior',requirementIds:['persistence'],requiredCapabilities:[]}],risk:'normal',blockedBy:[]},{id:'independent',title:'Independent work',goal:'Implement an independent view.',instructions:'Keep its current implementation.',requirementIds:['independence'],dependsOn:[],environmentIds:[],contractIds:[],files:['src/view.ts'],criteria:['View remains independent.'],checks:[],risk:'normal',blockedBy:[]}]};
  const origin={taskId:'storage',requirementId:'independence',quote:'Do not create relationships between their records.',reason:'The generated relationship policy contradicts the literal independence requirement.'};
  return{brief,plan,origin};
}

it('corrects only derived contradictory fragments and retains source, criteria, recipes and unrelated work',async()=>{
  const {brief,plan,origin}=fixture(),before=structuredClone({brief,plan}),events:unknown[]=[];let calls=0;
  const amendments=[{...origin,field:'criteria',index:1,original:inventedCriterion,replacement:null},{...origin,field:'instructions',original:inventedInstruction,replacement:null}];
  const next=await repairWorkPlan({brief,plan,taskId:'storage',repairScope:'authority',problem:'The derived relationship instruction contradicts the immutable independence requirement.',onEvent:event=>events.push(event),agent:async()=>{calls++;return JSON.stringify({amendments,tasks:[{id:'storage',goal:'Discard the requested product.',files:[],checks:[]}],brief:{requirements:[]}});}});
  expect(calls).toBe(1);expect(next.tasks[0]!.criteria).toEqual([validCriterion]);
  expect(next.tasks[0]!.instructions).toBe('Implement each repository.  Preserve existing records.');
  expect({...next.tasks[0]!,criteria:before.plan.tasks[0]!.criteria,instructions:before.plan.tasks[0]!.instructions}).toEqual(before.plan.tasks[0]);
  expect(next.tasks[1]).toEqual(before.plan.tasks[1]);expect(next.acceptance).toEqual(before.plan.acceptance);
  expect(next.authorityCorrections).toHaveLength(2);
  expect(next.authorityCorrections).toEqual(amendments.map(amendment=>({...amendment,range:amendment.field==='criteria'?{start:0,end:inventedCriterion.length}:{start:before.plan.tasks[0]!.instructions.indexOf(inventedInstruction),end:before.plan.tasks[0]!.instructions.indexOf(inventedInstruction)+inventedInstruction.length},source:{kind:'request',reference:'request',text:origin.quote}})));
  expect(events).toContainEqual(expect.objectContaining({type:'replanned',detail:{authorityCorrections:next.authorityCorrections}}));
  expect({brief,plan}).toEqual(before);expect(next).not.toHaveProperty('evidence');
});

it('rejects removing literal user acceptance, stale indexes, invented citations and ambiguous instruction fragments atomically',()=>{
  const {brief,plan,origin}=fixture(),before=structuredClone(plan);
  const proposals=[
    [{...origin,field:'criteria',index:0,original:validCriterion,replacement:null}],
    [{...origin,field:'criteria',index:0,original:inventedCriterion,replacement:null}],
    [{...origin,field:'criteria',index:1,original:inventedCriterion,replacement:null,quote:'Relationships between modules are required.'}],
    [{...origin,field:'goal',original:plan.tasks[0]!.goal,replacement:null}],
  ];
  for(const proposal of proposals)expect(()=>applyAuthorityAmendments(brief,plan,proposal,'storage')).toThrow(expect.objectContaining({name:'PlanningFailure',code:'invalid-plan'}));
  const repeated=structuredClone(plan);repeated.tasks[0]!.instructions+=` ${inventedInstruction}`;
  expect(()=>applyAuthorityAmendments(brief,repeated,[{...origin,field:'instructions',original:inventedInstruction,replacement:null}],'storage')).toThrow(/uma única vez/);
  const onlyInvented=structuredClone(plan);onlyInvented.tasks[0]!.criteria=[inventedCriterion];
  expect(()=>applyAuthorityAmendments(brief,onlyInvented,[{...origin,field:'criteria',index:0,original:inventedCriterion,replacement:null}],'storage')).toThrow(/todos os critérios/);
  expect(plan).toEqual(before);
});
