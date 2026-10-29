import { describe, expect, it } from 'vitest';
import { explicitModes, normalizeEnvironment, normalizeTasks, reconcilePlan, repairWorkPlan, runInit, runPlan, validatePlan } from '../../src/domain/index.js';
import { requestObject } from '../../src/domain/json.js';
import type { DevelopmentPlan, DomainAgent, ProductBrief, Requirement, WorkUnit } from '../../src/domain/types.js';

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

  it('retoma um plano parcial preservando ambiente e entregas já aceitos sem extrair novamente os mesmos requisitos',async()=>{
    const product=brief(),foundation=unit('foundation','Preparar exportação de a',['a']);
    const partial=plan(product,[foundation]);partial.status='planning';partial.environment=[{id:'runtime',name:'Runtime já escolhido',kind:'runtime',dependsOn:[],targets:['portable'],reason:'Executar exportação.',check:{command:'node --version'},prepare:[]}];
    partial.contracts=[{id:'export-contract',name:'Arquivo exportado',description:'Exportações usam o mesmo contrato CSV.',inputs:[],outputs:['CSV'],requirementIds:['a','b']}];
    const calls:string[]=[];
    const result=await runPlan({brief:product,existing:partial,contextChars:6000,agent:async call=>{
      calls.push(call.operation);expect(call.operation).toBe('outline');
      const requirements=JSON.parse(call.prompt.split('Requirements of this slice:\n')[1]?.split('\n\n')[0]??'[]') as Requirement[];
      expect(requirements.map(requirement=>requirement.id)).toEqual(['b']);
      return JSON.stringify({tasks:[{...unit('export-b','Exportar b',['b']),dependsOn:['foundation'],environmentIds:['runtime'],contractIds:['export-contract']}]});
    }});
    expect(result.status).toBe('ready');expect(calls).toEqual(['outline']);
    expect(result.tasks.map(task=>task.id)).toEqual(['foundation','export-b']);
    expect(result.tasks[0]).toEqual(foundation);expect(result.environment).toEqual(partial.environment);expect(result.contracts).toEqual(partial.contracts);
    expect(partial.status).toBe('planning');expect(partial.tasks).toEqual([foundation]);
  });

  it('persiste a adoção de cada fatia e retoma somente a próxima com o índice compacto das entregas existentes',async()=>{
    const product=brief(),controller=new AbortController();let durable:DevelopmentPlan|undefined;
    const calls:string[]=[];
    const agent:DomainAgent=async call=>{
      calls.push(call.operation);
      if(call.operation==='environment')return JSON.stringify({environment:[]});
      const requirements=JSON.parse(call.prompt.split('Requirements of this slice:\n')[1]?.split('\n\n')[0]??'[]') as Requirement[];
      if(requirements[0]!.id==='a')return JSON.stringify({tasks:[unit('foundation','Preparar exportação',['a']),unit('export-a','Exportar a',['a'])]});
      const registry=JSON.parse(call.prompt.split('Existing delivery identities and owned paths (details are stored separately):\n')[1]?.split('\n\n')[0]??'[]') as {id:string;files:string[]}[];
      expect(registry).toEqual(expect.arrayContaining([{id:'foundation',files:['foundation.ts'],contractIds:[]},{id:'export-a',files:['export-a.ts'],contractIds:[]}]));
      return JSON.stringify({tasks:[{...unit('export-b','Exportar b',['b']),dependsOn:['foundation']}]});
    };
    await expect(runPlan({brief:product,contextChars:6000,agent,signal:controller.signal,save:async patch=>{
      if(!patch.plan)return;durable=structuredClone(patch.plan);
      if(patch.plan.tasks.length===2)controller.abort(new Error('Interrupção após adotar a primeira fatia.'));
    }})).rejects.toThrow('Interrupção após adotar a primeira fatia.');
    expect(durable?.planning?.groups.map(group=>[group.environmentComplete,group.outlineComplete])).toEqual([[true,true],[true,false]]);
    expect(durable?.planning?.groups.every(group=>!group.environmentPrompt)).toBe(true);
    const before=calls.length;
    const resumed=await runPlan({brief:product,existing:durable!,contextChars:6000,agent});
    expect(calls.slice(before)).toEqual(['outline']);expect(resumed.tasks.map(task=>task.id)).toEqual(['foundation','export-a','export-b']);
    expect(resumed.planning).toBeUndefined();
  });

  it.each([true,false])('preserva a identidade legada somente quando sua resposta já está no cache: %s',async cached=>{
    const product=brief(),partial=plan(product,[unit('foundation','Preparar exportação',['a']),unit('export-a','Exportar a',['a'])]);partial.status='planning';
    let probes=0,calls=0;
    const result=await runPlan({brief:product,existing:partial,contextChars:6000,hasCachedCall:request=>{
      probes++;expect(request.operation).toBe('outline');expect(request.prompt).toContain('Earlier foundations and relevant unit identifiers:');return cached;
    },agent:async request=>{
      calls++;expect(request.operation).toBe('outline');
      if(cached)expect(request.prompt).toContain('Earlier foundations and relevant unit identifiers:');
      else{
        expect(request.prompt).toContain('Existing delivery identities and owned paths (details are stored separately):');
        expect(request.prompt).toContain('"id":"export-a","files":["export-a.ts"]');
      }
      return JSON.stringify({tasks:[unit('export-b','Exportar b',['b'])]});
    }});
    expect(result.status).toBe('ready');expect(calls).toBe(1);expect(probes).toBe(1);expect(result.planning).toBeUndefined();
  });

  it('reaproveita o prompt pendente exato após uma resposta paga e interrupção anterior à adoção',async()=>{
    const product=brief(),cache=new Map<string,string>();let durable:DevelopmentPlan|undefined,delivered=false,paidOutlines=0,reuses=0;
    const agent:DomainAgent=async call=>{
      const key=JSON.stringify(call),cached=cache.get(key);if(cached!==undefined){reuses++;return cached;}
      let response:string;
      if(call.operation==='environment')response=JSON.stringify({environment:[]});
      else{
        paidOutlines++;const requirements=JSON.parse(call.prompt.split('Requirements of this slice:\n')[1]?.split('\n\n')[0]??'[]') as Requirement[];
        response=JSON.stringify({tasks:requirements.map(requirement=>unit(`export-${requirement.id}`,`Exportar ${requirement.id}`,[requirement.id]))});delivered=true;
      }
      cache.set(key,response);return response;
    };
    await expect(runPlan({brief:product,contextChars:6000,agent,save:async patch=>{
      if(patch.plan)durable=structuredClone(patch.plan);
      else if(delivered)throw new Error('Interrupção entre resposta e adoção.');
    }})).rejects.toThrow('Interrupção entre resposta e adoção.');
    const pending=durable?.planning?.groups[0]?.outlinePrompt;expect(pending).toContain('Requirements of this slice:');
    expect(durable?.tasks).toEqual([]);expect(paidOutlines).toBe(1);
    const result=await runPlan({brief:product,existing:durable!,contextChars:6500,agent});
    expect(result.status).toBe('ready');expect(paidOutlines).toBe(2);expect(reuses).toBe(1);
    expect(result.tasks.map(task=>task.id)).toEqual(['export-a','export-b']);expect(result.planning).toBeUndefined();
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
    product.requirements[0]!.binding={capability:'data-query',kind:'cli',provider:'RequiredDB'};product.requirements[0]!.source.text='RequiredDB CLI';
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

  it('reconcilia identidade enriquecida por contrato operacional exato e preserva todas as referências sem inferência',async()=>{
    const product=brief();product.requirements[0]!.binding={capability:'runtime',kind:'runtime',provider:'RequiredRuntime'};product.requirements[0]!.source.text='RequiredRuntime runtime';
    const task=unit('foundation','Exportar a e b',['a','b']);task.environmentIds=['runtime-original'];
    const current=plan(product,[task]);
    const original={id:'runtime-original',name:'Runtime escolhido',kind:'runtime' as const,dependsOn:[],targets:['portable' as const],reason:'Executar produto.',check:{command:'selected-runtime',args:['--version']},prepare:[]};
    current.environment=[original,{...original,id:'runtime-enriched',name:'Outro nome descritivo',identity:product.requirements[0]!.binding,requirementIds:['a']},{id:'tool',name:'Ferramenta dependente',kind:'tool',dependsOn:['runtime-enriched'],targets:[],reason:'Consumir runtime.',check:{command:'tool --version'},prepare:[]}];
    current.acceptance=[{id:'runtime-behavior',kind:'command',command:'selected-runtime',args:['foundation.ts'],level:'behavior',assertion:{type:'contains',value:'exported'},requirementIds:['a'],requiredCapabilities:[],conformance:{...product.requirements[0]!.binding,requirementId:'a',productInputs:['foundation.ts']}}];
    const events:string[]=[];let calls=0;
    const result=await runPlan({brief:product,existing:current,agent:async()=>{calls++;throw new Error('No new model call is justified.');},onEvent:event=>events.push(event.message)});
    expect(calls).toBe(0);expect(validatePlan(product,result)).toEqual([]);expect(result.status).toBe('ready');
    expect(result.tasks).toEqual(current.tasks);expect(result.acceptance).toEqual(current.acceptance);
    expect(result.environment.map(node=>node.id)).toEqual(['runtime-original','tool']);
    expect(result.environment[0]!.identity).toEqual(product.requirements[0]!.binding);expect(result.environment[1]!.dependsOn).toEqual(['runtime-original']);
    expect(events.some(message=>message.includes('runtime-enriched → runtime-original')&&message.includes('contrato operacional idêntico'))).toBe(true);
    expect(current.environment).toHaveLength(3);
  });

  it('adota uma identidade sem id sob o pré-requisito estável e restringe um reparo de ambiente às referências',async()=>{
    const product=brief();product.requirements[0]!.binding={capability:'runtime',kind:'runtime',provider:'RequiredRuntime'};product.requirements[0]!.source.text='RequiredRuntime runtime';
    const task=unit('foundation','Exportar a e b',['a','b']);task.environmentIds=['runtime-original'];
    const current=plan(product,[task]);
    const original={id:'runtime-original',name:'Runtime escolhido',kind:'runtime' as const,dependsOn:[],targets:['portable' as const],reason:'Executar produto.',check:{command:'selected-runtime',args:['--version']},prepare:[]};
    current.environment=[original];current.acceptance=[{id:'runtime-behavior',kind:'command',command:'selected-runtime',level:'behavior',assertion:{type:'contains',value:'exported'},requirementIds:['a'],requiredCapabilities:[],conformance:{...product.requirements[0]!.binding,requirementId:'a',productInputs:['foundation.ts']}}];
    let calls=0;
    const result=await runPlan({brief:product,existing:current,agent:async()=>{calls++;const {id:_id,...anonymous}=original;return JSON.stringify({environment:[{...anonymous,identity:product.requirements[0]!.binding,requirementIds:['a']}],tasks:[{...task,goal:'Mudança indevida da entrega',files:['other-product.ts'],checks:[],criteria:['Outro resultado']}],acceptance:[]});}});
    expect(calls).toBe(1);expect(validatePlan(product,result)).toEqual([]);expect(result.environment).toHaveLength(1);
    expect(result.environment[0]!.id).toBe('runtime-original');expect(result.tasks).toEqual(current.tasks);expect(result.acceptance).toEqual(current.acceptance);
  });

  it('não escolhe por nome entre contratos operacionais diferentes nem entre duas origens equivalentes',async()=>{
    const product=brief();product.requirements[0]!.binding={capability:'runtime',kind:'runtime',provider:'RequiredRuntime'};product.requirements[0]!.source.text='RequiredRuntime runtime';
    const task=unit('foundation','Exportar a e b',['a','b']);task.environmentIds=['left'];
    const current=plan(product,[task]);
    const original={id:'left',name:'Runtime',kind:'runtime' as const,dependsOn:[],targets:['portable' as const],reason:'Executar produto.',check:{command:'selected-runtime',args:['--version']},prepare:[]};
    current.environment=[original,{...original,id:'right',name:'Segunda origem'},{...original,id:'bound',name:'Runtime vinculado',identity:product.requirements[0]!.binding}];
    current.acceptance=[{id:'runtime-behavior',kind:'command',command:'selected-runtime',level:'behavior',assertion:{type:'contains',value:'exported'},requirementIds:['a'],requiredCapabilities:[],conformance:{...product.requirements[0]!.binding,requirementId:'a',productInputs:['foundation.ts']}}];
    let calls=0;
    const result=await runPlan({brief:product,existing:current,agent:async()=>{calls++;return JSON.stringify({tasks:[{...task,environmentIds:['bound']}],environment:[],acceptance:[]});}});
    expect(calls).toBe(1);expect(result.environment).toHaveLength(3);expect(result.tasks[0]!.environmentIds).toEqual(['bound']);
    const variants=normalizeEnvironment([{...original,id:'typed-a',identity:product.requirements[0]!.binding},{...original,id:'typed-b',identity:product.requirements[0]!.binding,check:{command:'different-runtime',args:['--version']}}],product);
    expect(variants.map(node=>node.id)).toEqual(['typed-a','typed-b']);
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
