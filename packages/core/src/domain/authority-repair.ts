import { PlanningFailure } from './control.js';
import { object } from './json.js';
import { resolveLiteralExcerpt } from './literal-source.js';
import type { DevelopmentPlan, PlanAuthorityCorrection, ProductBrief } from './types.js';

/** Changes only exact derived fragments. Semantic interpretation is proposed by
 * the auditor; executable scope, user obligations and old evidence stay intact. */
export function applyAuthorityAmendments(brief:ProductBrief,originalPlan:DevelopmentPlan,amendments:unknown,scopeTaskId?:string):{plan:DevelopmentPlan;corrections:PlanAuthorityCorrection[]}{
  const fail=(message:string):never=>{throw new PlanningFailure('invalid-plan',[message],'source-authority');};
  if(!Array.isArray(amendments)||!amendments.length)throw new PlanningFailure('no-progress',['Nenhuma correção de autoridade foi proposta.'],'source-authority');
  const corrections:PlanAuthorityCorrection[]=[];
  const authority=[brief.request,...brief.requirements.flatMap(requirement=>[requirement.statement,requirement.source.text]),...brief.constraints.flatMap(constraint=>[constraint.statement,constraint.source.text])].filter(Boolean);
  for(const entry of amendments){
    if(!object(entry)||typeof entry.taskId!=='string'||typeof entry.original!=='string'||!entry.original||!['criteria','instructions'].includes(String(entry.field))||!(entry.replacement===null||typeof entry.replacement==='string'&&!!entry.replacement.trim())||typeof entry.requirementId!=='string'||typeof entry.quote!=='string'||typeof entry.reason!=='string'||!entry.reason.trim())fail('A correção precisa identificar tarefa, campo, fragmento original, substituição, requisito, citação literal e razão.');
    if(!object(entry))continue;
    const task=originalPlan.tasks.find(candidate=>candidate.id===entry.taskId);
    if(!task||scopeTaskId&&task.id!==scopeTaskId)fail('A correção não pertence à unidade de desenvolvimento afetada.');
    const requirement=brief.requirements.find(candidate=>candidate.id===entry.requirementId);
    if(!requirement||!task!.requirementIds.includes(requirement.id))fail('A origem precisa ser um requisito ativo já coberto pela unidade.');
    const quote=resolveLiteralExcerpt(requirement!.source.text,entry.quote as string);
    if(!quote)fail('A citação não identifica uma origem literal inequívoca do requisito.');
    const field=entry.field as PlanAuthorityCorrection['field'],original=entry.original as string,replacement=entry.replacement as string|null;
    let range:{start:number;end:number};
    if(field==='criteria'){
      if(!Number.isInteger(entry.index)||Number(entry.index)<0||task!.criteria[Number(entry.index)]!==original)fail('O índice e o critério original precisam corresponder exatamente ao plano.');
      range={start:0,end:original.length};
    }else{
      if(entry.index!==undefined)fail('Uma correção de instrução identifica um fragmento literal, sem índice de critério.');
      const start=task!.instructions.indexOf(original);
      if(start<0||start!==task!.instructions.lastIndexOf(original))fail('O fragmento da instrução precisa existir uma única vez no campo original.');
      range={start,end:start+original.length};
    }
    if(replacement===original)fail('A substituição proposta não altera o fragmento derivado.');
    // An audit can remove its own invented instruction, never a literal user
    // acceptance criterion or an immutable requirement copied into that field.
    if(authority.some(text=>text.includes(original)||!!resolveLiteralExcerpt(text,original)))fail('Uma exigência literal do usuário não pode ser retirada ou reescrita como se fosse critério derivado.');
    if(authority.some(text=>text.length<=original.length&&original.includes(text)&&!(replacement??'').includes(text)))fail('O fragmento contém uma obrigação literal que a substituição descartaria; selecione somente a parte derivada conflitante.');
    const correction:PlanAuthorityCorrection={taskId:task!.id,field,...(field==='criteria'?{index:Number(entry.index)}:{}),range,original,replacement,requirementId:requirement!.id,quote:entry.quote as string,source:{...requirement!.source,text:quote!},reason:entry.reason as string};
    if(corrections.some(previous=>previous.taskId===correction.taskId&&previous.field===field&&(field==='criteria'?previous.index===correction.index:previous.range.start<range.end&&range.start<previous.range.end)))fail('Duas correções se sobrepõem no mesmo fragmento; nenhuma foi aplicada.');
    corrections.push(correction);
  }
  const plan=structuredClone(originalPlan);
  for(const correction of [...corrections].sort((left,right)=>left.taskId.localeCompare(right.taskId)||left.field.localeCompare(right.field)||(right.index??right.range.start)-(left.index??left.range.start))){
    const task=plan.tasks.find(candidate=>candidate.id===correction.taskId)!;
    if(correction.field==='criteria')task.criteria.splice(correction.index!,1,...(correction.replacement===null?[]:[correction.replacement]));
    else task.instructions=task.instructions.slice(0,correction.range.start)+(correction.replacement??'')+task.instructions.slice(correction.range.end);
  }
  if(plan.tasks.some(task=>corrections.some(correction=>correction.taskId===task.id)&&!task.criteria.length))fail('A correção não pode apagar todos os critérios da entrega; forneça o resultado correto sustentado pela fonte.');
  plan.authorityCorrections=[...(plan.authorityCorrections??[]),...structuredClone(corrections)];
  return{plan,corrections};
}
