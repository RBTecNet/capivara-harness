import { describe, expect, it } from 'vitest';
import { ContextTooLarge, contextForTask, packetText } from '../../src/domain/context.js';
import { repairWorkPlan, runPlan } from '../../src/domain/plan.js';
import type { DevelopmentPlan, ProductBrief, WorkUnit } from '../../src/domain/types.js';

function fixture():{brief:ProductBrief;plan:DevelopmentPlan;task:WorkUnit}{
  const brief:ProductBrief={schema:'capivara/product/1',id:'records',revision:1,status:'ready',name:'Records',summary:'Persist and expose records.',request:'Persist records and expose validated operations.',modes:['api'],targets:['portable'],requirements:['storage','reload','crud','invalid'].map(id=>({id,statement:`Required outcome: ${id}.`,mode:'api',source:{kind:'request',reference:'request',text:`Required outcome: ${id}. ${'Recorded acceptance context. '.repeat(60)}`}})),constraints:[],decisions:[],gaps:[]};
  const task:WorkUnit={id:'application',title:'Persistent application',goal:'Persist records and expose validated operations.',instructions:'Implement persistence and transport responsibilities.',requirementIds:brief.requirements.map(requirement=>requirement.id),dependsOn:[],environmentIds:[],contractIds:['storage-contract','api-contract'],files:['src/**'],inputs:['spec/schema.json'],resources:['schema-generation'],exclusiveContracts:['storage-contract'],criteria:['Records persist.','Records remain available after reopening.','CRUD routes expose records.','Invalid input is rejected.'],checks:[{id:'storage-proof',kind:'command',command:'node',args:['--test','test/storage.test.mjs'],expected:'Persistent records survive reopening.',level:'behavior',requirementIds:['storage','reload'],requiredCapabilities:[]},{id:'api-proof',kind:'command',command:'node',args:['--test','test/api.test.mjs'],expected:'CRUD and invalid-input scenarios pass.',level:'behavior',requirementIds:['crud','invalid'],requiredCapabilities:[]}],risk:'normal',blockedBy:[]};
  const plan:DevelopmentPlan={schema:'capivara/plan/1',status:'planning',revision:1,briefId:brief.id,briefRevision:brief.revision,environment:[],contracts:[{id:'storage-contract',name:'Repository',description:'Persistent record operations.',inputs:['Record'],outputs:['StoredRecord'],requirementIds:['storage','reload']},{id:'api-contract',name:'Transport',description:'Validated CRUD routes.',inputs:['Request'],outputs:['Response'],requirementIds:['crud','invalid']}],tasks:[task]};
  return{brief,plan,task};
}

function engineeringTasks(){return[
  {id:'repository',title:'Persistent repository',goal:'Provide persistent record operations.',instructions:'Implement storage and reopening.',requirementIds:['storage','reload'],dependsOn:[],environmentIds:[],contractIds:['storage-contract'],files:['src/repository.ts'],criterionIndexes:[0,1],checkIds:['storage-proof'],inputIndexes:[0],resourceIndexes:[0],exclusiveContractIndexes:[0]},
  {id:'transport',title:'Validated transport',goal:'Expose validated CRUD operations.',instructions:'Integrate repository through its contract.',requirementIds:['crud','invalid'],dependsOn:['repository'],environmentIds:[],contractIds:['api-contract'],files:['src/transport.ts'],criterionIndexes:[2,3],checkIds:['api-proof']},
];}

describe('decomposição por responsabilidades dentro da capacidade real',()=>{
  it('mantém uma unidade que cabe no teto configurado sem aplicar desconto artificial de metade',async()=>{
    const {brief,plan,task}=fixture(),limit=12_000;
    const size=packetText(contextForTask(brief,plan,task,limit)).length;
    expect(size).toBeGreaterThan(limit/2);expect(size).toBeLessThan(limit);
    let calls=0;
    const result=await runPlan({brief,existing:plan,contextChars:limit,agent:async()=>{calls++;throw new Error('No engineering change is necessary.');}});
    expect(result.status).toBe('ready');expect(result.tasks).toHaveLength(1);expect(result.tasks[0]!.id).toBe(task.id);expect(calls).toBe(0);
  });

  it('pede decomposição real de pacote grande e conserva critérios e receitas por referências exatas',async()=>{
    const {brief,plan,task}=fixture(),limit=6_000;
    expect(()=>contextForTask(brief,plan,task,limit)).toThrow(ContextTooLarge);
    let calls=0;
    const result=await repairWorkPlan({brief,plan,taskId:task.id,problem:'The work packet exceeds the configured capacity.',contextChars:limit,agent:async request=>{
      calls++;expect(request.operation).toBe('repair');expect(request.prompt.length).toBeLessThanOrEqual(limit);
      const packet=JSON.parse(request.prompt.slice(request.prompt.indexOf('{"schema":')));
      expect(packet.schema).toBe('capivara/engineering-decomposition/1');
      expect(packet.unit.criteria.map((criterion:{index:number})=>criterion.index)).toEqual([0,1,2,3]);
      expect(packet.unit.checks.map((check:{id:string})=>check.id)).toEqual(['storage-proof','api-proof']);
      expect(packet.requirements[0].source).toHaveProperty('sha256');
      return JSON.stringify({tasks:engineeringTasks()});
    }});
    expect(calls).toBe(1);expect(result.status).toBe('ready');
    expect(result.tasks.map(unit=>unit.id)).toEqual(['repository','transport']);
    expect(result.tasks.flatMap(unit=>unit.criteria)).toEqual(task.criteria);
    expect(result.tasks.flatMap(unit=>unit.checks)).toEqual(task.checks);
    expect(result.tasks.flatMap(unit=>unit.requirementIds)).toEqual(task.requirementIds);
    expect(result.tasks.map(unit=>unit.files)).toEqual([['src/repository.ts'],['src/transport.ts']]);
    expect(result.tasks[0]).toMatchObject({inputs:task.inputs,resources:task.resources,exclusiveContracts:task.exclusiveContracts,dependsOn:[]});
    expect(result.tasks[1]!.dependsOn).toEqual(['repository']);
    for(const unit of result.tasks)expect(()=>contextForTask(brief,result,unit,limit)).not.toThrow();
    expect(plan.tasks).toEqual([task]);
  });

  it('recusa uma proposta que apaga aceite e corrige a atribuição antes de salvar qualquer substituição',async()=>{
    const {brief,plan,task}=fixture();let calls=0;
    const saved:DevelopmentPlan[]=[];const events:string[]=[];
    const result=await repairWorkPlan({brief,plan,taskId:task.id,problem:'Split storage and transport responsibilities.',contextChars:6_000,save:async patch=>{if(patch.plan)saved.push(structuredClone(patch.plan));},onEvent:event=>events.push(event.type),agent:async request=>{
      calls++;const replacements=engineeringTasks();
      if(calls===1){replacements[1]!.criterionIndexes=[2];replacements[1]!.checkIds=[];}
      else{expect(request.prompt).toContain('Previous proposal was not adopted');expect(request.prompt).toContain('api-proof');}
      return JSON.stringify({tasks:replacements});
    }});
    expect(calls).toBe(2);expect(events).toContain('recovering');
    expect(saved).toHaveLength(1);expect(saved[0]!.tasks.flatMap(unit=>unit.checks)).toEqual(task.checks);
    expect(result.tasks.flatMap(unit=>unit.criteria)).toEqual(task.criteria);
    expect(plan.tasks).toEqual([task]);
  });
});
