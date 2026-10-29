import type { DevelopmentPlan, Verification, WorkUnit } from '../domain/types.js';
import type { BuildState, VerificationEvidence } from './types.js';
import { browserObservationSummary, verificationLevel } from './checks.js';
import { pathScopesConflict } from './isolation.js';

export interface ReviewEvidenceOptions { maxChars?:number; }
export interface OwnReviewProof { checkId:string; evidence:VerificationEvidence; }
export interface RelatedReviewProof extends OwnReviewProof {
  taskId:string;
  relation:'dependency'|'consumer'|'shared-scope';
  selection:'verified-batch'|'completed-task-record';
  requirementIds:string[];
  summary:string;
  header:string;
}
export interface ReviewEvidencePacket {
  status:'ready'|'needs-check';
  missing:string[];
  own:OwnReviewProof[];
  related:RelatedReviewProof[];
  text:string;
  truncated:boolean;
}
function proofFor(state:BuildState,task:WorkUnit,check:Verification):{evidence?:VerificationEvidence;missing?:string}{
  const references=state.tasks[task.id]?.verificationEvidence?.filter(item=>item.checkId===check.id)??[];
  if(references.length!==1)return{missing:`${check.id}: ${references.length?'ambiguous':'missing'} current verification receipt`};
  const reference=references[0]!;
  const evidence=state.evidence.findLast(item=>item.id===reference.evidenceId&&item.taskId===task.id&&item.checkId===reference.checkId&&item.inputHash===reference.inputHash);
  if(!evidence)return{missing:`${check.id}: selected evidence ${reference.evidenceId} / ${reference.inputHash} is unavailable`};
  if(evidence.kind!==check.kind||evidence.level!==verificationLevel(check))return{missing:`${check.id}: selected evidence has a different interface or verification level`};
  return{evidence,...(!evidence.passed?{missing:`${check.id}: selected evidence ${evidence.id} is negative (${evidence.classification??'unclassified'})`}:{})};
}
function ancestors(plan:DevelopmentPlan,task:WorkUnit):Map<string,number>{
  const tasks=new Map(plan.tasks.map(item=>[item.id,item])),result=new Map<string,number>(),queue=task.dependsOn.map(id=>({id,distance:1}));
  for(let index=0;index<queue.length;index++){const next=queue[index]!;if(next.id===task.id||result.has(next.id))continue;result.set(next.id,next.distance);for(const id of tasks.get(next.id)?.dependsOn??[])queue.push({id,distance:next.distance+1});}
  return result;
}
function metadata(prefix:string,checkId:string,evidence:VerificationEvidence):string{
  return`${prefix} ${checkId}: ${evidence.passed?'PASS':'FAIL'} ${evidence.kind??'unknown'}/${evidence.level??'unknown'} evidence=${evidence.id} input=${evidence.inputHash}\nevaluatedAt=${evidence.checkedAt} observedAt=${evidence.observedAt??evidence.checkedAt}${evidence.reinterpretedFrom?` reinterpretedFrom=${evidence.reinterpretedFrom}`:''}`;
}
/** Tail excerpts retain test-runner summaries and explicitly disclose omitted text. */
function excerpt(value:string,limit:number):{text:string;truncated:boolean}{
  if(value.length<=limit)return{text:value,truncated:false};
  const receipt=`[truncated: tail excerpt of ${value.length} recorded characters]\n`;
  if(limit<=receipt.length)return{text:receipt.slice(0,Math.max(0,limit)),truncated:true};
  return{text:receipt+value.slice(-(limit-receipt.length)),truncated:true};
}
function rawProof(evidence:VerificationEvidence):string{
  const observation=evidence.observation;
  const raw=observation?`command=${observation.command}\nexit=${observation.exitCode} cancelled=${observation.cancelled} timedOut=${observation.timedOut}\nSTDOUT:\n${observation.stdout}\nSTDERR:\n${observation.stderr}`:evidence.output;
  const provenance=evidence.provenance;
  return`${provenance?`PROVENANCE: ${JSON.stringify({command:provenance.command,cwd:provenance.cwd,exitCode:provenance.exitCode,runtimeWitnesses:provenance.runtimeWitnesses?.map(item=>({execPath:item.execPath,argv:item.argv,inputs:item.inputs}))})}\n`:''}${evidence.browserObservation?`BROWSER INTERFACE: ${browserObservationSummary(evidence.browserObservation)}\n`:''}${raw}`;
}
/** Review sees the exact batch the scheduler verified, not the array's last N
 * entries. Related records are context, never substitutes for this unit's proof
 * or automatic approval. The scheduler still validates current hashes at finish. */
export function buildReviewEvidence(state:BuildState,plan:DevelopmentPlan,task:WorkUnit,checks:readonly Verification[]=state.tasks[task.id]?.checks??task.checks,options:ReviewEvidenceOptions={}):ReviewEvidencePacket{
  const own:OwnReviewProof[]=[],missing:string[]=[];
  for(const check of checks){const selected=proofFor(state,task,check);if(selected.evidence)own.push({checkId:check.id,evidence:structuredClone(selected.evidence)});if(selected.missing)missing.push(selected.missing);}
  const dependencies=ancestors(plan,task),scope=[...task.files,...task.inputs??[]];
  const candidates:({task:WorkUnit;relation:RelatedReviewProof['relation'];distance:number;proofs:OwnReviewProof[];selection:RelatedReviewProof['selection'];requirements:string[]})[]=[];
  for(const candidate of plan.tasks){
    const progress=state.tasks[candidate.id];if(candidate.id===task.id||progress?.status!=='complete')continue;
    const dependenciesOfCandidate=ancestors(plan,candidate),requirements=task.requirementIds.filter(id=>candidate.requirementIds.includes(id));
    const overlap=scope.some(path=>[...candidate.files,...candidate.inputs??[]].some(other=>pathScopesConflict(path,other)));
    const relation:RelatedReviewProof['relation']|undefined=dependencies.has(candidate.id)?'dependency':dependenciesOfCandidate.has(task.id)?'consumer':requirements.length&&overlap?'shared-scope':undefined;
    if(!relation)continue;
    const relatedChecks=progress.checks??candidate.checks,proofs:OwnReviewProof[]=[];
    const selection:RelatedReviewProof['selection']=progress.verificationEvidence?'verified-batch':'completed-task-record';
    for(const check of relatedChecks){
      const exact=selection==='verified-batch'?proofFor(state,candidate,check):undefined;
      const evidence=exact?.evidence??(selection==='completed-task-record'?state.evidence.findLast(item=>item.taskId===candidate.id&&item.checkId===check.id&&item.passed&&item.kind===check.kind&&item.level===verificationLevel(check)):undefined);
      if(evidence?.passed&&!exact?.missing)proofs.push({checkId:check.id,evidence:structuredClone(evidence)});
    }
    if(proofs.length)candidates.push({task:candidate,relation,distance:dependencies.get(candidate.id)??dependenciesOfCandidate.get(task.id)??Number.MAX_SAFE_INTEGER,proofs,selection,requirements});
  }
  const rank=(relation:RelatedReviewProof['relation']):number=>relation==='dependency'?0:relation==='consumer'?1:2;
  const quality=(proof:OwnReviewProof):number=>proof.evidence.kind==='web'?3:proof.evidence.level==='behavior'?2:1;
  candidates.sort((left,right)=>rank(left.relation)-rank(right.relation)||left.distance-right.distance||Math.max(...right.proofs.map(quality))-Math.max(...left.proofs.map(quality))||right.requirements.length-left.requirements.length||left.task.id.localeCompare(right.task.id));
  const related:RelatedReviewProof[]=candidates.slice(0,3).map(candidate=>{
    const selected=candidate.proofs.sort((left,right)=>quality(right)-quality(left)||right.evidence.checkedAt.localeCompare(left.evidence.checkedAt))[0]!;
    const label=candidate.selection==='verified-batch'?'exact selected batch':'recorded passed proof of a completed task; source-hash revalidation belongs to the scheduler';
    const header=`RELATED ${candidate.task.id} (${candidate.relation}; ${label}; requirements=${candidate.requirements.join(',')||'dependency contract'})\n${metadata('RECORDED',selected.checkId,selected.evidence)}\n`;
    const raw=selected.evidence.observation?.stdout||selected.evidence.output;
    const summary=header+excerpt(raw,Math.max(0,1200-header.length)).text;
    return{...selected,taskId:candidate.task.id,relation:candidate.relation,selection:candidate.selection,requirementIds:candidate.requirements,summary:summary.slice(0,1200),header};
  });
  const maxChars=Math.max(0,Math.floor(options.maxChars??4800));
  let text=`CURRENT UNIT VERIFICATION: ${missing.length?'NEEDS CHECK':'SELECTED BATCH'}\n${own.length?own.map(item=>metadata('OWN',item.checkId,item.evidence)).join('\n'):'No mechanical proofs selected for this unit.'}${missing.length?`\nMISSING CURRENT EVIDENCE:\n${missing.join('\n')}`:''}\n`;
  let truncated=false;
  if(text.length>maxChars){const receipt='\n[Own metadata truncated by context capacity.]';text=(text.slice(0,Math.max(0,maxChars-receipt.length))+receipt).slice(0,maxChars);truncated=true;}
  else{
    const ownBudget=Math.min(1600,Math.floor((maxChars-text.length)*.45));
    for(const item of own){const header=`RAW OWN ${item.checkId}\n`,limit=Math.floor(ownBudget/Math.max(1,own.length));const block=excerpt(rawProof(item.evidence),Math.max(0,limit-header.length));if(block.text)text+=`\n${header}${block.text}`;truncated||=block.truncated;}
    for(let index=0;index<related.length;index++){
      const current=related[index]!,remaining=Math.max(0,maxChars-text.length-1),share=Math.floor(remaining/(related.length-index));
      const limit=Math.min(1200,share>=current.header.length+80?share:remaining);
      if(limit<current.header.length+40){const receipt=`\n[${related.length-index} related evidence summaries omitted by context capacity.]`;if(receipt.length<=remaining)text+=receipt;truncated=true;break;}
      const body=current.summary.slice(current.header.length),block=excerpt(body,limit-current.header.length);text+=`\n${current.header}${block.text}`;truncated||=block.truncated;
    }
  }
  // Separate objects preserve the complete records even when the rendered packet
  // has an explicit bounded excerpt for a small model's context.
  return{status:missing.length?'needs-check':'ready',missing,own,related,text:text.slice(0,maxChars),truncated};
}
