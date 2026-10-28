import { describe, expect, it } from 'vitest';
import { explicitModes, normalizeEnvironment, normalizeTasks, reconcilePlan, repairWorkPlan, runInit, runPlan, validatePlan } from '../../src/domain/index.js';
import { requestObject } from '../../src/domain/json.js';
import type { DevelopmentPlan, ProductBrief, Requirement, WorkUnit } from '../../src/domain/types.js';

function brief():ProductBrief {
  return {schema:'capivara/product/1',id:'product',status:'ready',revision:1,name:'Exportação',summary:'Exportar dados',request:'Crie uma CLI para exportar dados.',modes:['cli'],targets:['portable'],requirements:['a','b'].map(id=>({id,statement:`Exportar ${id}`,source:{kind:'request',reference:'request',text:`Exportar ${id}: ${'dado '.repeat(100)}`},mode:'cli'})),constraints:[],decisions:[],gaps:[]};
}
function unit(id:string,goal:string,requirementIds:string[]):WorkUnit{return{id,title:goal,goal,instructions:goal,requirementIds,dependsOn:[],environmentIds:[],contractIds:[],files:[`${id}.ts`],criteria:[goal],checks:[],risk:'normal',blockedBy:[]};}
function plan(product:ProductBrief,tasks:WorkUnit[]):DevelopmentPlan{return{schema:'capivara/plan/1',status:'ready',revision:1,briefId:product.id,briefRevision:product.revision,environment:[],contracts:[],tasks};}

describe('planejamento RC2 sem trabalho textual ou repetição sem progresso',()=>{
  it('não confunde tecnologias ou consumidores com a interface do produto',()=>{
    expect(explicitModes('Crie uma TUI com React.')).toEqual(['tui']);
    expect(explicitModes('Crie uma CLI usando uma biblioteca SQL e um SDK de API externa.')).toEqual(['cli']);
    expect(explicitModes('Crie uma biblioteca reutilizável para consultar uma API externa.')).toEqual(['library']);
  });
  it('mantém prosa residual como fonte, sem convertê-la em novos requisitos',async()=>{
    const request='Contexto: a equipe gastou várias horas em atividades manuais. Crie uma CLI para exportar CSV.';
    const result=await runInit({request,agent:async()=>JSON.stringify({name:'Exportador',summary:'Exportar CSV pela CLI',requirements:[{statement:'Exportar CSV pela CLI',quote:'Crie uma CLI para exportar CSV.',mode:'cli'}],questions:[]})});
    expect(result.request).toBe(request);
    expect(result.requirements.map(requirement=>requirement.statement)).toEqual(['Exportar CSV pela CLI']);
  });

  it('reconcilia a mesma fundação emitida por fatias distintas em uma entrega',async()=>{
    const product=brief();
    const result=await runPlan({brief:product,contextChars:6000,agent:async call=>{
      if(call.operation==='environment')return JSON.stringify({environment:[]});
      const requirements=JSON.parse(call.prompt.split('Requirements of this slice:\n')[1]?.split('\n\n')[0]??'[]') as Requirement[];
      return JSON.stringify({tasks:[{id:'foundation',title:'Fundação',goal:'Preparar a fundação compartilhada',instructions:'Criar os contratos comuns.',requirementIds:requirements.map(requirement=>requirement.id),files:['src/foundation.ts'],criteria:['Contratos disponíveis'],checks:[]}]});
    }});
    expect(result.tasks).toHaveLength(1);
    expect(result.tasks[0]?.id).toBe('foundation');
    expect(result.tasks[0]?.requirementIds.sort()).toEqual(['a','b']);
  });

  it('encerra a recuperação de um envelope idêntico sem sleeps nem chamadas ilimitadas',async()=>{
    let calls=0;
    await expect(requestObject({operation:'outline',prompt:'Planeje.',signal:AbortSignal.timeout(100),agent:async()=>{calls++;return 'resposta inválida';}})).rejects.toMatchObject({name:'PlanningFailure',code:'no-progress'});
    expect(calls).toBeLessThanOrEqual(3);
  });

  it('recusa dependência inexistente após reparo sem mudança real',async()=>{
    let repairs=0;
    await expect(runPlan({brief:brief(),signal:AbortSignal.timeout(100),agent:async call=>{
      if(call.operation==='environment')return JSON.stringify({environment:[{id:'tool',name:'tool',kind:'tool',check:{command:'tool --version'},prepare:[],dependsOn:['missing']}]});
      if(call.operation==='repair'){repairs++;return JSON.stringify({updates:[]});}
      return JSON.stringify({tasks:[]});
    }})).rejects.toMatchObject({name:'PlanningFailure',code:'no-progress'});
    expect(repairs).toBeLessThanOrEqual(3);
  });

  it('replanejamento local reconcilia fundação repetida e preserva IDs de entregas independentes',async()=>{
    const product=brief();
    const foundation=unit('foundation','Preparar a fundação compartilhada',['a']);
    const feature=unit('feature','Exportar b',['b']);feature.dependsOn=['foundation'];
    const current=plan(product,[foundation,feature]);
    const result=await repairWorkPlan({brief:product,plan:current,taskId:'feature',problem:'Refinar somente a exportação.',agent:async()=>JSON.stringify({tasks:[{...foundation,id:'foundation-new'},{...feature,id:'export-b',dependsOn:['foundation-new']}],environment:[],contracts:[]})});
    expect(result.tasks.map(task=>task.id)).toEqual(['foundation','feature']);
    expect(result.tasks[1]?.dependsOn).toEqual(['foundation']);
    expect(result.tasks.filter(task=>task.goal===foundation.goal)).toHaveLength(1);
    expect(current.tasks).toEqual([foundation,feature]);
    expect(reconcilePlan(product,result,current).tasks.map(task=>task.id)).toEqual(['foundation','feature']);
  });

  it('preserva contrato operacional e impede stack obrigatória satisfeita por outra capacidade',()=>{
    const product=brief();
    product.requirements[0]!.kind='stack';
    product.requirements[0]!.binding={capability:'data-query',kind:'cli',provider:'RequiredDB'};
    const environment=normalizeEnvironment([{id:'db',name:'Database',kind:'tool',identity:{capability:'data-query',kind:'driver',provider:'OtherDB'},provides:{command:['.tools/db-cli'],env:{DB_HOME:'.tools'},paths:['.tools'],inputs:['.tools/db-cli']},check:{command:'.tools/db-cli',args:['--version']},prepare:[]}],product);
    const tasks=normalizeTasks([{...unit('data','Consultar dados',['a','b']),environmentIds:['db'],inputs:['src/**/*.ts'],resources:['db-file'],exclusiveContracts:['contract'],checks:[{id:'stack-proof',kind:'command',command:'.tools/db-cli',args:['--version'],level:'build',inputs:['.tools/db-cli'],requirementIds:['a'],requiredCapabilities:[]}]}],product,environment,[]);
    const proposed={...plan(product,tasks),environment,acceptance:[{...tasks[0]!.checks[0]!,conformance:{requirementId:'a',capability:'data-query',kind:'cli' as const,provider:'RequiredDB',productInputs:['data.ts']}}]};
    expect(environment[0]?.provides).toMatchObject({command:['.tools/db-cli'],paths:['.tools']});
    expect(tasks[0]).toMatchObject({inputs:['src/**/*.ts'],resources:['db-file'],exclusiveContracts:['contract']});
    expect(tasks[0]?.checks[0]).toMatchObject({level:'build',inputs:['.tools/db-cli']});
    expect(validatePlan(product,proposed).some(issue=>issue.code==='mandatory-provider-mismatch')).toBe(true);
    environment[0]!.identity={capability:'data-query',kind:'cli',provider:'RequiredDB'};
    tasks[0]!.exclusiveContracts=[];
    expect(validatePlan(product,proposed)).toEqual([]);
    proposed.acceptance[0]!.level='syntax';
    expect(validatePlan(product,proposed).some(issue=>issue.code==='unproven-mandatory-provider')).toBe(true);
  });

  it('não atribui silenciosamente todos os requisitos a uma tarefa sem cobertura explícita',()=>{
    const product=brief();
    const tasks=normalizeTasks([{title:'Algo',goal:'Criar algo',criteria:['Resultado observável']}],product,[],[]);
    expect(tasks[0]?.requirementIds).toEqual([]);
    expect(validatePlan(product,plan(product,tasks)).map(issue=>issue.code)).toEqual(expect.arrayContaining(['ungrounded-task','uncovered-requirement']));
  });

  it('preserva entregas distintas com goal genérico igual e outputs disjuntos',()=>{
    const product=brief();
    const left=unit('customer-controller','Criar controlador',['a']);left.files=['src/customers/controller.ts'];
    const right=unit('order-controller','Criar controlador',['b']);right.files=['src/orders/controller.ts'];
    const result=reconcilePlan(product,plan(product,[left,right]));
    expect(result.tasks.map(task=>task.id)).toEqual(['customer-controller','order-controller']);
    expect(result.tasks.map(task=>task.files)).toEqual([left.files,right.files]);
    expect(()=>reconcilePlan(product,plan(product,[left,{...right,id:left.id,goal:'Criar outro produto'}]))).toThrow(/duas entregas diferentes/);
  });
});
