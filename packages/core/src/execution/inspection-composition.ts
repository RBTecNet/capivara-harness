import type { DevelopmentPlan, ProductBrief, WorkUnit } from '../domain/types.js';
import { taskDependsOn } from '../domain/contribution.js';
import { interfaceEvidenceUsable } from './checks.js';
import { deliveryWriteSet } from './delivery-sources.js';
import { digest } from './files.js';
import { createInspectionIdentity, inspectionStillCurrent } from './inspection.js';
import { fileDigest } from './isolation.js';
import type { IntegrationTransaction, TaskProgress, VerificationEvidence } from './types.js';

type ReviewReceipt=NonNullable<TaskProgress['reviews']>[number];
type InspectionPeer=Pick<TaskProgress,'reviews'|'checks'|'changedFiles'>;
export interface InspectionCompositionOptions {
  deliveryFiles?:readonly string[];
  tasks:Readonly<Record<string,InspectionPeer>>;
  integrations:readonly IntegrationTransaction[];
  /** Already checked by the controller against current source, recipe,
   * environment, interface and artifact identities. Never historical positives. */
  currentProofs:Readonly<Record<string,readonly VerificationEvidence[]>>;
}
export interface CompositeInspectionReceipt {
  schema:'capivara/inspection-composition/1';
  id:string;
  predecessor:{taskId:string;inputHash:string;at:string;authorityHash:string};
  sources:Record<string,string>;
  transfers:{path:string;hash:string|null;publisher:string;integrationId:string;review:{inputHash:string;at:string;authorityHash:string};requirementIds:string[];contractIds:string[]}[];
  proofs:{taskId:string;checkId:string;id:string;inputHash:string}[];
}
export interface InspectionReuseResolution {
  status:'current'|'composed'|'awaiting-peer-proofs'|'stale';
  composition?:CompositeInspectionReceipt;
  waitingFor?:string[];
  reason?:string;
}
const same=(left:unknown,right:unknown):boolean=>JSON.stringify(left)===JSON.stringify(right);
const normalize=(path:string):string=>path.replaceAll('\\','/').replace(/^\.\//,'');

/** A later, explicitly approved contribution can replace the corresponding
 * source inspection, but cannot make the old receipt describe changed code.
 * All unchanged source/authority remains bound to that original receipt. */
export async function resolveInspectionReuse(review:ReviewReceipt|undefined,workspace:string,brief:ProductBrief,plan:DevelopmentPlan,task:WorkUnit,options:InspectionCompositionOptions):Promise<InspectionReuseResolution>{
  const old=review?.inspection;
  const stale=(reason:string):InspectionReuseResolution=>({status:'stale',reason});
  if(review?.assessment.decision!=='approved'||old?.schema!=='capivara/inspection/1'||!old.usable||!Array.isArray(old.focusPaths))return stale('No usable original independent approval exists.');
  const writes=options.deliveryFiles??old.deliveryFiles;
  if(await inspectionStillCurrent(old,workspace,brief,plan,task,writes))return{status:'current'};
  const current=await createInspectionIdentity(workspace,brief,plan,task,old.focusPaths.map(path=>({path})),writes);
  if(!current.usable||old.authorityHash!==current.authorityHash||!same(old.selectors,current.selectors))return stale('The predecessor authority, source scope or usable receipt changed.');
  const owned=new Set(old.deliveryFiles??[]),paths=new Set<string>();
  for(const key of new Set([...Object.keys(old.sources),...Object.keys(current.sources)]))if(old.sources[key]!==current.sources[key])paths.add(key.startsWith('selector:')?key.slice('selector:'.length):key);
  if(!paths.size||[...paths].some(path=>!owned.has(path)))return stale('A changed explicit read dependency or unowned source needs a fresh inspection.');
  const proofs:CompositeInspectionReceipt['proofs']=[],waiting=new Set<string>(),transfers:CompositeInspectionReceipt['transfers']=[];
  const requireProofs=(unit:WorkUnit):void=>{
    const checks=options.tasks[unit.id]?.checks??unit.checks,available=options.currentProofs[unit.id]??[];
    if(!checks.length){waiting.add(unit.id);return;}
    for(const check of checks){
      const proof=available.find(item=>item.taskId===unit.id&&item.checkId===check.id&&item.passed&&interfaceEvidenceUsable(check,item));
      if(!proof)waiting.add(unit.id);
      else if(!proofs.some(item=>item.id===proof.id))proofs.push({taskId:unit.id,checkId:check.id,id:proof.id,inputHash:proof.inputHash});
    }
  };
  requireProofs(task);
  const currentPartners=new Map<string,Promise<boolean>>();
  for(const path of [...paths].sort()){
    const transaction=[...options.integrations].reverse().find(item=>item.phase==='applied'&&item.files.some(file=>normalize(file.path)===path));
    const published=transaction?.files.find(file=>normalize(file.path)===path),owner=plan.tasks.find(unit=>unit.id===transaction?.taskId);
    if(!transaction||!published||!owner||owner.id===task.id||!taskDependsOn(plan,owner,task.id))return stale(`The current publisher of ${path} is not an approved downstream contribution.`);
    if(await fileDigest(workspace,path)!==published.after)return stale(`The source ${path} differs from its recorded downstream publication.`);
    const partner=options.tasks[owner.id],approval=partner?.reviews?.at(-1),identity=approval?.inspection;
    if(approval?.assessment.decision!=='approved'||!identity?.deliveryFiles?.includes(path)||identity.sources[path]!==current.sources[path]||identity.sources[`selector:${path}`]!==current.sources[`selector:${path}`])return stale(`The downstream approval does not inspect the exact current delivery ${path}.`);
    let partnerCurrent=currentPartners.get(owner.id);
    if(!partnerCurrent){partnerCurrent=inspectionStillCurrent(identity,workspace,brief,plan,owner,deliveryWriteSet(owner.id,partner,options.integrations));currentPartners.set(owner.id,partnerCurrent);}
    if(!await partnerCurrent)return stale(`The downstream source or authority for ${path} changed after its approval.`);
    const contracts=plan.contracts.filter(contract=>owner.contractIds.includes(contract.id));
    const coverage=new Set([...owner.requirementIds,...contracts.flatMap(contract=>contract.requirementIds)]);
    const commonContracts=task.contractIds.filter(id=>owner.contractIds.includes(id));
    if(task.requirementIds.some(id=>!coverage.has(id))||task.contractIds.length&&!commonContracts.length)return stale(`The downstream approval of ${path} does not cover the predecessor requirements and shared contracts.`);
    requireProofs(owner);
    transfers.push({path,hash:current.sources[path]??null,publisher:owner.id,integrationId:transaction.id,review:{inputHash:approval.inputHash,at:approval.at,authorityHash:identity.authorityHash},requirementIds:[...task.requirementIds],contractIds:commonContracts});
  }
  if(waiting.size)return{status:'awaiting-peer-proofs',waitingFor:[...waiting].sort(),reason:'Independent source approvals are compatible, but every contributing verification must first be current.'};
  const body={schema:'capivara/inspection-composition/1' as const,predecessor:{taskId:task.id,inputHash:review.inputHash,at:review.at,authorityHash:old.authorityHash},sources:{...current.sources},transfers,proofs};
  return{status:'composed',composition:{...body,id:digest(JSON.stringify(body))}};
}
