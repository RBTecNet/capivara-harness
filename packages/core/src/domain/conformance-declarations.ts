import { matchesGlob } from 'node:path';
import type { CapabilityIdentity, ConformanceDeclarationCorrection, DevelopmentPlan, ProductBrief, Verification, WorkUnit } from './types.js';
import { obligationMatchesProvider } from './bindings.js';

const canonical=(value:string):string=>value.normalize('NFC').trim().replace(/\s+/g,' ').toLowerCase();
const exact=(left:CapabilityIdentity,right:CapabilityIdentity):boolean=>left.kind===right.kind&&canonical(left.provider)===canonical(right.provider)&&canonical(left.capability)===canonical(right.capability);
const path=(value:string):string=>value.replaceAll('\\','/').replace(/^\.\//,'').replace(/\/$/,'');
const intersects=(scope:string,input:string):boolean=>{scope=path(scope);input=path(input);return scope===input||matchesGlob(input,scope)||!/[?*{[\]]/.test(scope)&&input.startsWith(`${scope}/`);};

/** Decode only a unique declaration reference within the real consumer scope.
 * Provider identity is preserved; neither an ambiguous binding nor a different
 * named provider can be substituted to make a declaration look conforming. */
export function canonicalizeConformanceDeclaration(brief:ProductBrief,plan:DevelopmentPlan,task:WorkUnit,check:Verification):{check:Verification;correction?:ConformanceDeclarationCorrection}{
  const original=check.conformance;if(!original)return{check};
  const nodes=new Set<string>();
  const visit=(id:string):void=>{if(nodes.has(id))return;nodes.add(id);plan.environment.find(node=>node.id===id)?.dependsOn.forEach(visit);};task.environmentIds.forEach(visit);
  const selected=structuredClone(original),reasons:ConformanceDeclarationCorrection['reasons']=[];
  const referenced=brief.requirements.find(requirement=>requirement.id===original.requirementId);
  // An explicitly contradictory stack reference requires real reconciliation,
  // rather than silently changing which chosen provider the claim certifies.
  if(!referenced?.binding){
    const matches=brief.requirements.filter(requirement=>requirement.kind==='stack'&&requirement.binding&&task.requirementIds.includes(requirement.id)&&exact(requirement.binding,original)&&plan.environment.some(node=>nodes.has(node.id)&&node.identity&&exact(node.identity,original)&&obligationMatchesProvider(requirement,node.identity)));
    if(matches.length===1&&matches[0]!.id!==selected.requirementId){selected.requirementId=matches[0]!.id;reasons.push('unique-scoped-provider-reference');}
  }
  const obligation=brief.requirements.find(requirement=>requirement.id===selected.requirementId);
  const bound=obligation?.binding&&task.requirementIds.includes(obligation.id)&&exact(obligation.binding,selected)&&plan.environment.some(node=>nodes.has(node.id)&&node.identity&&exact(node.identity,selected)&&obligationMatchesProvider(obligation,node.identity));
  if(bound&&!selected.productInputs.some(input=>task.files.some(scope=>intersects(scope,input)))){
    const candidates=[...new Set([...selected.productInputs,...task.files])];
    if(candidates.length!==selected.productInputs.length){selected.productInputs=candidates;reasons.push('owned-product-input-candidates');}
  }
  if(!reasons.length)return{check};
  const coverage=check.requirementIds.filter(id=>id!==original.requirementId||referenced!==undefined);
  return{check:{...check,requirementIds:[...new Set([...coverage,...(referenced?[original.requirementId]:[]),selected.requirementId])],conformance:selected},correction:{schema:'capivara/conformance-declaration/1',taskId:task.id,checkId:check.id,original:structuredClone(original),selected:structuredClone(selected),reasons,environmentIds:[...nodes].sort(),validation:'actual-provider-consumption-required'}};
}

export function recordConformanceCorrection(plan:DevelopmentPlan,correction:ConformanceDeclarationCorrection|undefined):void{
  if(!correction)return;
  plan.conformanceCorrections??=[];
  if(!plan.conformanceCorrections.some(previous=>JSON.stringify(previous)===JSON.stringify(correction)))plan.conformanceCorrections.push(correction);
}

/** Resuming a saved task does not require asking a model to restate an already
 * unique provider declaration. Global recipes need an unambiguous task owner. */
export function canonicalizePlanConformance(brief:ProductBrief,plan:DevelopmentPlan):void{
  for(const task of plan.tasks)task.checks=task.checks.map(check=>{const decoded=canonicalizeConformanceDeclaration(brief,plan,task,check);recordConformanceCorrection(plan,decoded.correction);return decoded.check;});
  if(plan.acceptance)plan.acceptance=plan.acceptance.map(check=>{
    const owners=plan.tasks.filter(task=>check.requirementIds.length>0&&check.requirementIds.every(id=>task.requirementIds.includes(id)));
    if(owners.length!==1)return check;
    const decoded=canonicalizeConformanceDeclaration(brief,plan,owners[0]!,check);recordConformanceCorrection(plan,decoded.correction);return decoded.check;
  });
}
