import { identity, normalize } from './authority.js';
import type { ProductBrief, ProductConstraint, Source } from './types.js';

/** Only normative negatives qualify. Descriptions such as "not found" or
 * "não encontrado" and quoted interface text do not declare product policy. */
function explicitProhibition(text:string):boolean{
  const prose=normalize(text.replace(/```[\s\S]*?```|`[^`]*`|"[^"\n]*"|“[^”]*”|‘[^’]*’/g,' '));
  return /\bnao\s+(?:(?:deve[m]?|deverao|devera|pode[m]?|poderao|podera)\s+[a-z]|(?:e|sera)\s+permitid[oa]\b|(?:utilizar|usar|criar|permitir|adicionar|incluir|executar|instalar|estabelecer|alterar|excluir|misturar|compartilhar)\b)|\b(?:must|shall)\s+not\s+[a-z]|\bdo\s+not\s+[a-z]|\bdon't\s+[a-z]|(?:^|[.!?]\s+)\s*never\s+(?:use|allow|include|add|create|run|install|change|delete|share|connect|combine)\b|\b(?:e|fica)\s+proibid[oa]\b/.test(prose);
}

function authorityText(brief:ProductBrief,source:Source):string|undefined{
  if(source.kind==='request'&&source.reference==='request')return brief.request;
  if(source.kind==='answer'){
    const decision=brief.decisions.find(item=>item.source.kind==='answer'&&item.questionId===source.reference&&item.source.reference===source.reference);
    return decision?.answer;
  }
  return undefined;
}

/** Validate derived metadata again when resuming; documentary references never
 * acquire direct user authority merely by repeating the same words. */
export function isLiteralProductInvariant(brief:ProductBrief,constraint:ProductConstraint):boolean{
  const text=authorityText(brief,constraint.source);
  return constraint.origin?.schema==='capivara/constraint-origin/1'&&constraint.origin.kind==='explicit-prohibition'&&Boolean(text?.includes(constraint.source.text))&&constraint.statement===constraint.source.text&&explicitProhibition(constraint.source.text);
}

/** Additive source-bound projection. The full paragraph preserves its subject
 * and conditions; neither capability names nor new behavioral rules are inferred. */
export function productConstraints(brief:ProductBrief):ProductConstraint[]{
  const constraints=[...brief.constraints];
  for(const requirement of brief.requirements){
    const source=requirement.source,raw=authorityText(brief,source);
    if(!raw||!source.text)continue;
    const occurrences:number[]=[];
    for(let offset=raw.indexOf(source.text);offset!==-1;offset=raw.indexOf(source.text,offset+Math.max(1,source.text.length)))occurrences.push(offset);
    if(!occurrences.length)continue;
    let cursor=0;
    for(const part of raw.split(/\r?\n[ \t]*\r?\n/)){
      const offset=raw.indexOf(part,cursor);cursor=offset+part.length;
      const statement=part.trim();if(!statement)continue;
      const start=offset+part.indexOf(statement),end=start+statement.length;
      if(!occurrences.some(index=>explicitProhibition(raw.slice(Math.max(start,index),Math.min(end,index+source.text.length)))))continue;
      const existing=constraints.findIndex(constraint=>constraint.source.kind===source.kind&&constraint.source.reference===source.reference&&constraint.source.text===statement&&constraint.statement===statement);
      const previous=existing<0?undefined:constraints[existing];
      const constraint:ProductConstraint={id:previous?.id??identity('constraint',`${source.reference}:${statement}`),statement,source:{kind:source.kind,reference:source.reference,text:statement},forbiddenCapabilities:previous?.forbiddenCapabilities??[],requiredCapabilities:previous?.requiredCapabilities??[],origin:{schema:'capivara/constraint-origin/1',kind:'explicit-prohibition',requirementIds:[...new Set([...previous?.origin?.requirementIds??[],requirement.id])].sort()}};
      if(existing<0)constraints.push(constraint);else constraints[existing]=constraint;
    }
  }
  return constraints;
}

/** Restores transmission of already recorded authority, not a new user choice.
 * Keep the brief revision and all planning/proof references unchanged. */
export function materializeProductInvariants(brief:ProductBrief):void{brief.constraints=productConstraints(brief);}
