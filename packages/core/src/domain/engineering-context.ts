import { createHash } from 'node:crypto';
import { ContextTooLarge } from './context.js';
import type { DevelopmentPlan, ProductBrief, WorkUnit } from './types.js';

interface RepairContextOptions { brief:ProductBrief; plan:DevelopmentPlan; task:WorkUnit; problem:string; limit:number; }
const hash=(value:unknown):string=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const unique=(values:string[]):string[]=>[...new Set(values)];

/** Repair a responsibility, not a collection of literal request fragments.
 * Large executable recipes and repeated source quotations stay with their
 * actual owners. Indexed references let the decoder retain them losslessly. */
export function engineeringRepairContext({brief,plan,task,problem,limit}:RepairContextOptions):string{
  const capacity=Math.floor(limit), taskIndex=plan.tasks.findIndex(item=>item.id===task.id);
  if(!Number.isFinite(capacity)||capacity<=0)throw new RangeError('Engineering context capacity must be positive.');
  const snapshot='.capivara-next/project.snapshot.json';
  const reference=(value:unknown,pointer:(string|number)[])=>({complete:false,sha256:hash(value),characters:JSON.stringify(value).length,...(pointer[0]==='project'?{snapshot,pointer}:{origin:'coordinator-incident'}),retainedByCoordinator:true});
  const taskPointer=['project','plan','tasks',taskIndex] as (string|number)[];
  const prerequisites=new Set(task.environmentIds);
  for(;;){const size=prerequisites.size;for(const node of plan.environment)if(prerequisites.has(node.id))node.dependsOn.forEach(id=>prerequisites.add(id));if(size===prerequisites.size)break;}
  const requirements=brief.requirements.filter(item=>task.requirementIds.includes(item.id));
  const contracts=plan.contracts.filter(item=>task.contractIds.includes(item.id));
  const header=[
    'Repair this engineering responsibility. Return JSON; do not edit code.',
    'Shape: {"tasks":[{"id":"stable responsibility id","title":"engineering capability","goal":"observable result","instructions":"local work","requirementIds":[],"dependsOn":[],"environmentIds":[],"contractIds":[],"files":[],"inputs":[],"inputIndexes":[],"resources":[],"resourceIndexes":[],"exclusiveContracts":[],"exclusiveContractIndexes":[],"criteria":[],"criterionIndexes":[],"checkIds":[],"checks":[]}],"environment":[],"contracts":[],"questions":[]}.',
    'criterionIndexes, inputIndexes, resourceIndexes, exclusiveContractIndexes and checkIds refer to the original unit below: the coordinator copies their complete original definitions. Preserve every criterion, required outcome and verification recipe across the replacement set. Return only engineering responsibilities with coherent owned paths and real ordering. A technology label or a sentence from the request is not a work unit. Do not duplicate every owned file into a serial unit for each requirement.',
    'complete=false is an explicit metadata reference, never absence of an obligation. Original values remain with the coordinator; a saved snapshot may be read at the supplied pointer after checking its hash. Do not change user scope, criteria or interfaces to fit a verification instrument. Ask only for a missing product decision, never an engineering preference.',
  ].join('\n');
  const make=(detail:number)=>{
    const text=(value:string,pointer:(string|number)[],maximum:number)=>value.length<=maximum?value:{...reference(value,pointer),excerpt:value.slice(0,maximum)};
    return{
      schema:'capivara/engineering-decomposition/1',
      product:{name:brief.name,modes:brief.modes,targets:brief.targets,limits:{forbidden:unique(brief.constraints.flatMap(item=>item.forbiddenCapabilities)),required:unique(brief.constraints.flatMap(item=>item.requiredCapabilities))}},
      unit:{id:task.id,title:task.title,goal:text(task.goal,[...taskPointer,'goal'],detail?800:2400),instructions:text(task.instructions,[...taskPointer,'instructions'],detail?400:2400),requirementIds:task.requirementIds,dependsOn:task.dependsOn,environmentIds:task.environmentIds,contractIds:task.contractIds,files:task.files,inputs:task.inputs,resources:task.resources,exclusiveContracts:task.exclusiveContracts,risk:task.risk,blockedBy:task.blockedBy,
        criteria:task.criteria.map((value,index)=>({index,text:text(value,[...taskPointer,'criteria',index],detail>1?240:detail?1000:capacity)})),
        checks:task.checks.map((check,index)=>({id:check.id,kind:check.kind,level:check.level,requirementIds:check.requirementIds,
          ...(detail?{}:{command:check.command,args:check.args,expected:check.expected}),
          definition:reference(check,[...taskPointer,'checks',index])})),
      },
      requirements:requirements.map(item=>({id:item.id,kind:item.kind,statement:text(item.statement,['project','brief','requirements',brief.requirements.indexOf(item),'statement'],detail>1?200:1200),binding:item.binding,
        source:{reference:item.source.reference,sha256:hash(item.source.text),characters:item.source.text.length,...(item.source.localPath?{localPath:item.source.localPath}:{})}})),
      contracts:contracts.map(item=>({id:item.id,name:item.name,...(detail?{definition:reference(item,['project','plan','contracts',plan.contracts.indexOf(item)])}:{description:item.description,inputs:item.inputs,outputs:item.outputs})})),
      prerequisites:plan.environment.filter(item=>prerequisites.has(item.id)).map(item=>({id:item.id,name:item.name,kind:item.kind,identity:item.identity,dependsOn:item.dependsOn})),
      incident:text(problem,['incident'],detail?1000:3000),
    };
  };
  let result='';
  for(const detail of [0,1,2]){result=`${header}\n\n${JSON.stringify(make(detail))}`;if(result.length<=capacity)return result;}
  throw new ContextTooLarge(task.id,result.length,capacity);
}
