import type { DevelopmentPlan, Verification } from './types.js';

/** A recipe keeps the owner whose actual command observation can prove it. */
export interface OwnedVerification { taskId:string; check:Verification; }

/** A build artifact is a declared write even when its producer described it
 * in the conformance claim. Behavior checks consume artifacts, not produce them. */
export function verificationOutputs(check:Verification):string[]{
  return [...new Set([...(check.outputs??[]),...(check.level==='build'?check.conformance?.artifacts??[]:[])])];
}

export function verificationRegistry(plan:DevelopmentPlan):OwnedVerification[]{
  return[
    ...plan.tasks.flatMap(task=>task.checks.map(check=>({taskId:task.id,check}))),
    ...(plan.acceptance??[]).map(check=>({taskId:'$acceptance',check})),
  ];
}

/** Cross-owner artifact consumption needs both an unambiguous producer recipe
 * and an explicit ordering edge. A final acceptance consumer follows all tasks. */
export function consumesVerification(plan:DevelopmentPlan,registry:OwnedVerification[],consumer:OwnedVerification,producer:OwnedVerification):boolean{
  if(!consumer.check.dependsOn?.includes(producer.check.id))return false;
  if(consumer.taskId===producer.taskId)return true;
  if(registry.filter(entry=>entry.check.id===producer.check.id).length!==1)return false;
  if(consumer.taskId==='$acceptance')return producer.taskId!=='$acceptance';
  if(producer.taskId==='$acceptance')return false;
  const seen=new Set<string>();
  const dependsOn=(id:string):boolean=>{
    if(id===producer.taskId)return true;if(seen.has(id))return false;seen.add(id);
    return plan.tasks.find(task=>task.id===id)?.dependsOn.some(dependsOn)??false;
  };
  return plan.tasks.find(task=>task.id===consumer.taskId)?.dependsOn.some(dependsOn)??false;
}
