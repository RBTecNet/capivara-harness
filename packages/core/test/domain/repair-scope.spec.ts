import { describe, expect, it } from 'vitest';
import { repairWorkPlan } from '../../src/domain/plan.js';
import type { DevelopmentPlan, EnvironmentNode, ProductBrief, WorkUnit } from '../../src/domain/types.js';

const brief:ProductBrief={schema:'capivara/product/1',id:'b',revision:1,status:'ready',name:'Records',summary:'Persistent records',request:'Create an API for persistent records.',modes:['api'],targets:['portable'],requirements:[{id:'crud',statement:'Create, read, update and delete persistent records.',mode:'api',source:{kind:'request',reference:'request',text:'Create, read, update and delete persistent records.'}}],constraints:[],decisions:[],gaps:[]};
const task:WorkUnit={id:'records-api',title:'Records API',goal:'Provide persistent CRUD with validation.',instructions:'Implement real routes and persistence.',requirementIds:['crud'],dependsOn:[],environmentIds:[],contractIds:[],files:['src/records.ts','test/records.test.ts'],inputs:['src/db.ts'],criteria:['CRUD persists after reopening the database.','Invalid input is rejected.'],checks:[{id:'crud-tests',kind:'command',command:'node',args:['--test','test/records.test.ts'],expected:'CRUD scenarios pass.',assertion:{type:'contains',value:'# pass 4'},level:'behavior',requirementIds:['crud'],requiredCapabilities:[]}],risk:'normal',blockedBy:[]};
const plan=():DevelopmentPlan=>({schema:'capivara/plan/1',status:'ready',revision:1,briefId:'b',briefRevision:1,environment:[],contracts:[],tasks:[structuredClone(task)]});

describe('escopo do reparo preserva o contrato da entrega',()=>{
  it('corrige receita sem trocar a implementação por tarefa burocrática nem perder checkpoint por ID',async()=>{
    const original=plan();
    const next=await repairWorkPlan({brief,plan:original,taskId:task.id,repairScope:'verification',problem:'The report prints ℹ pass 4 rather than # pass 4.',agent:async()=>JSON.stringify({tasks:[{id:'verification-review',title:'Review the verification',goal:'Record the test command and log.',instructions:'Only save the report.',requirementIds:['crud'],files:['src/records.ts','test/records.test.ts'],dependsOn:['invented'],criteria:['The log records success.'],checks:[{id:'new-report-proof',kind:'command',command:'node',args:['--test','test/records.test.ts'],assertion:{type:'regex',source:'stdout',pattern:'(?:#|ℹ) pass 4'},level:'behavior',requirementIds:['crud'],requiredCapabilities:[]}]}]})});
    const actual=next.tasks[0]!;
    expect({...actual,checks:task.checks}).toEqual(task);
    expect(actual.checks[0]).toMatchObject({id:'crud-tests',expected:'CRUD scenarios pass.',assertion:{type:'regex',source:'stdout',pattern:'(?:#|ℹ) pass 4'}});
    expect(next.tasks.map(candidate=>candidate.id)).toEqual(['records-api']);
    expect(original.tasks).toEqual([task]);
  });

  it('limita recuperação de ambiente aos providers e suas referências',async()=>{
    const original=plan();
    const provider:EnvironmentNode={id:'node',name:'Node runtime',kind:'runtime',dependsOn:[],targets:[],reason:'Execute the backend',check:{command:'node',args:['--version']},prepare:[]};
    const next=await repairWorkPlan({brief,plan:original,taskId:task.id,repairScope:'environment',problem:'The runtime invocation is wrong.',agent:async()=>JSON.stringify({environment:[provider],tasks:[{id:'replace-everything',goal:'Document the tool.',criteria:['Only logs'],files:[],dependsOn:['fake'],environmentIds:['node'],checks:[]}]})});
    expect(next.tasks[0]).toEqual({...task,environmentIds:['node']});
    expect(next.environment[0]).toMatchObject({id:'node',check:{command:'node',args:['--version']}});
    expect(original.tasks).toEqual([task]);
  });

  it('recusa apagar cobertura obrigatória ou considerar renomeação como progresso técnico',async()=>{
    await expect(repairWorkPlan({brief,plan:plan(),taskId:task.id,repairScope:'verification',problem:'Recover the recipe.',agent:async()=>JSON.stringify({checks:[]})})).rejects.toMatchObject({name:'PlanningFailure',code:'invalid-plan'});
    await expect(repairWorkPlan({brief,plan:plan(),taskId:task.id,repairScope:'verification',problem:'Recover the recipe.',agent:async()=>JSON.stringify({tasks:[{id:'new-id',goal:'Save the report.',criteria:['Report exists']}]})})).rejects.toMatchObject({name:'PlanningFailure',code:'no-progress'});
  });
});
