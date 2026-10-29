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

  it('corrige claim inferido no mesmo comando e ID, une cobertura autorizada e registra a transformação sem criar prova',async()=>{
    const product=structuredClone(brief);
    product.requirements.unshift({id:'sqlite',kind:'stack',statement:'Use SQLite.',source:{kind:'request',reference:'request',text:'SQLite'},mode:'api',binding:{capability:'file database',kind:'driver',provider:'SQLite'}});
    product.requirements.push({id:'child-outcome',kind:'behavior',statement:'Reopen and read the persisted records.',source:{kind:'request',reference:'request',text:'Reopen and read the persisted records.'},mode:'api'});
    const original=plan(),check={...original.tasks[0]!.checks[0]!,conformance:{requirementId:'sqlite',capability:'file database',kind:'driver' as const,provider:'SQLite',productInputs:['src/old.ts']},requirementIds:['sqlite']};
    original.tasks[0]!.checks=[check,{id:'untouched',kind:'command',command:'node',args:['--test','test/other.test.ts'],level:'behavior',requirementIds:['crud'],requiredCapabilities:[]}];
    original.tasks[0]!.requirementIds=['sqlite','crud','child-outcome'];original.tasks[0]!.environmentIds=['sqlite'];
    original.environment=[{id:'sqlite',name:'SQLite',kind:'package',identity:{capability:'embedded database',kind:'library',provider:'SQLite'},dependsOn:[],targets:[],reason:'Use the runtime-provided library.',check:{command:'node',args:['-e',"require('node:sqlite')"]},prepare:[],provides:{modules:[{protocol:'node',specifier:'node:sqlite',runtimeCommand:['node']}]}}];
    const snapshot=structuredClone(original),events:unknown[]=[];let calls=0;
    const next=await repairWorkPlan({brief:product,plan:original,taskId:task.id,repairScope:'verification',problem:'The inferred driver label does not describe the operational library; cover the existing CRUD obligation.',onEvent:event=>events.push(event),agent:async()=>{
      calls++;return JSON.stringify({checks:[{id:check.id,expected:'Do not replace the human acceptance criterion.',requirementIds:['child-outcome','unknown'],conformance:{kind:'library',capability:'embedded database',productInputs:['src/records.ts']}}]});
    }});
    expect(calls).toBe(1);expect(next.tasks[0]!.checks).toHaveLength(2);
    expect(next.tasks[0]!.checks.map(candidate=>candidate.id)).toEqual(original.tasks[0]!.checks.map(candidate=>candidate.id));
    const actual=next.tasks[0]!.checks.find(candidate=>candidate.id===check.id)!;
    expect(actual).toEqual({...check,requirementIds:['sqlite','child-outcome'],conformance:{...check.conformance,kind:'library',capability:'embedded database',productInputs:['src/records.ts']}});
    expect(next.tasks[0]!.checks.find(candidate=>candidate.id==='untouched')).toEqual(original.tasks[0]!.checks[1]);
    expect({...next.tasks[0]!,checks:snapshot.tasks[0]!.checks}).toEqual(snapshot.tasks[0]);
    expect(events).toContainEqual(expect.objectContaining({type:'replanned',detail:{verificationTransformations:[{taskId:task.id,checkId:check.id,before:check,after:actual}]}}));
    expect(original).toEqual(snapshot);expect(next).not.toHaveProperty('evidence');
  });

  it('rejeita claim de outro provedor ou papel explicitamente obrigatório sem alterar a receita original',async()=>{
    for(const mismatch of [{provider:'OtherDB',kind:'driver'},{provider:'SQLite',kind:'library'}]){
      const product=structuredClone(brief);
      product.requirements.unshift({id:'sqlite',kind:'stack',statement:'Use SQLite driver.',source:{kind:'request',reference:'request',text:'Use SQLite driver.'},mode:'api',binding:{capability:'database',kind:'driver',provider:'SQLite'}});
      const original=plan();original.tasks[0]!.requirementIds.push('sqlite');original.tasks[0]!.environmentIds=['sqlite'];
      original.tasks[0]!.checks[0]!.conformance={requirementId:'sqlite',capability:'database',kind:'driver',provider:'SQLite',productInputs:['src/records.ts']};
      original.environment=[{id:'sqlite',name:'SQLite driver',kind:'package',identity:{capability:'database',kind:'driver',provider:'SQLite'},dependsOn:[],targets:[],reason:'Use the explicitly required driver.',check:{command:'node',args:['--version']},prepare:[]}];
      const snapshot=structuredClone(original);let saves=0;
      await expect(repairWorkPlan({brief:product,plan:original,taskId:task.id,repairScope:'verification',problem:'Repair technical claim.',save:async()=>{saves++;},agent:async()=>JSON.stringify({checks:[{id:original.tasks[0]!.checks[0]!.id,conformance:mismatch}]})})).rejects.toMatchObject({name:'PlanningFailure',code:'invalid-plan'});
      expect(saves).toBe(0);expect(original).toEqual(snapshot);
    }
  });
});
