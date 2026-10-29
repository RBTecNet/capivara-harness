import { matchesGlob, resolve } from 'node:path';
import type { DevelopmentPlan, ProductBrief, Verification, VerificationAssertion, WorkUnit } from '../domain/types.js';
import { verificationAssertionStatus } from '../domain/assertions.js';
import { obligationMatchesProvider } from '../domain/bindings.js';
import { consumesVerification, verificationRegistry } from '../domain/verifications.js';
import { interfaceEvidenceUsable, verificationLevel } from './checks.js';
import { invocationArguments, validateConformance } from './conformance.js';
import { resolveVerificationInputs } from './dependencies.js';
import { applyOperationalEnvironment, recipeCwd, verificationOperationalRevision, type OperationalEnvironment } from './environment.js';
import { inputSnapshot, sourceFiles } from './files.js';
import type { VerificationEvidence } from './types.js';

export interface AcceptanceSelectionOptions {
  brief:ProductBrief;
  plan:DevelopmentPlan;
  taskChecks?:Readonly<Record<string,readonly Verification[]>>;
  operational:OperationalEnvironment;
  /** The controller already validated each receipt's current input/artifact hashes. */
  currentTaskProofs:readonly VerificationEvidence[];
  workspace:string;
  checks:readonly Verification[];
}
export interface AcceptanceReuse { checkId:string; receiptIds:string[]; requirementIds:string[]; }
export interface AcceptanceSelection {
  checks:Verification[];
  reused:AcceptanceReuse[];
  retained:{checkId:string;reason:string}[];
}
const stable=(value:unknown):string=>JSON.stringify(value,(_key,item:unknown)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.entries(item).sort(([a],[b])=>a.localeCompare(b))):item);
function portable(value:string,workspace:string):string{
  const root=resolve(workspace).replaceAll('\\','/'),given=value.replaceAll('\\','/');
  const path=(candidate:string):string=>candidate===root?'$WORKSPACE':candidate.startsWith(`${root}/`)?`$WORKSPACE${candidate.slice(root.length)}`:candidate;
  const separator=given.indexOf('=');
  return separator>=0?`${given.slice(0,separator+1)}${path(given.slice(separator+1))}`:path(given);
}
function predicate(assertion:VerificationAssertion):VerificationAssertion{
  if(assertion.type==='all'||assertion.type==='any')return{...assertion,assertions:assertion.assertions.map(predicate)};
  if(assertion.type==='exit')return assertion;
  if(assertion.type==='json')return{...assertion,source:assertion.source??'stdout'};
  return{...assertion,source:assertion.source??'stdout'};
}
function selectorCovered(selector:string,files:string[]):boolean{
  const value=selector.replaceAll('\\','/').replace(/\/$/,'');
  return value==='.'?!!files.length:!value.startsWith('!')&&files.some(path=>path===value||path.startsWith(`${value}/`)||matchesGlob(path,value)||matchesGlob(path,`${value}/**`));
}
function execution(check:Verification,workspace:string,operational:OperationalEnvironment):{key:string;argv:string[];cwd:string}|undefined{
  if(!check.command)return undefined;
  const selected=verificationAssertionStatus(check),level=verificationLevel(check);
  if(selected.status==='invalid'||selected.status==='missing'&&level==='behavior')return undefined;
  const request=applyOperationalEnvironment({cwd:recipeCwd(workspace,check.cwd),command:check.args?[check.command,...check.args]:check.command},operational);
  const args=invocationArguments(request.command);if(!args)return undefined;
  const argv=args.map(arg=>portable(arg,workspace)),cwd=portable(request.cwd,workspace);
  return{argv,cwd,key:stable({argv,cwd,kind:check.kind,level,target:check.target??null,assertion:selected.assertion?predicate(selected.assertion):null,expectedExit:check.expectedExitCode??(selected.assertion?.type==='exit'?selected.assertion.value:0),input:check.input??[],steps:check.steps??[],closeInput:check.closeInput??null,capabilities:[...check.requiredCapabilities].sort(),timeoutMs:check.timeoutMs??null})};
}

/** Select final observations that still need execution. A reused entry points
 * at real task receipts; it never creates a global result or changes a proof. */
export async function selectPendingAcceptance(options:AcceptanceSelectionOptions):Promise<AcceptanceSelection>{
  const {brief,workspace,operational}=options;
  const taskPlan:DevelopmentPlan={...options.plan,tasks:options.plan.tasks.map(task=>({...task,checks:[...(options.taskChecks?.[task.id]??task.checks)]})),acceptance:[]};
  const registry=verificationRegistry(taskPlan),requirements=new Map(brief.requirements.map(requirement=>[requirement.id,requirement]));
  const receipts=options.currentTaskProofs.filter(proof=>proof.taskId!=='$acceptance'&&proof.passed&&proof.provenance&&!proof.provenance.cancelled&&!proof.provenance.timedOut&&registry.some(owner=>owner.taskId===proof.taskId&&owner.check.id===proof.checkId&&interfaceEvidenceUsable(owner.check,proof)));
  const finalTask:WorkUnit={id:'$acceptance',title:'Final acceptance',goal:'Prove mandatory outcomes.',instructions:'Observe the integrated product.',requirementIds:brief.requirements.map(requirement=>requirement.id),dependsOn:[],environmentIds:taskPlan.environment.map(node=>node.id),contractIds:taskPlan.contracts.map(contract=>contract.id),files:[],inputs:[...new Set(taskPlan.tasks.flatMap(task=>task.files))],criteria:[],checks:[...options.checks],risk:'normal',blockedBy:[]};
  const reusable=new Map<Verification,AcceptanceReuse>(),reasons=new Map<Verification,string>();
  const snapshots=new Map<string,Promise<Record<string,string>>>(),validations=new Map<string,Promise<boolean>>();
  const snapshot=(inputs:string[]):Promise<Record<string,string>>=>{const key=stable([...inputs].sort());let value=snapshots.get(key);if(!value){value=inputSnapshot(workspace,inputs);snapshots.set(key,value);}return value;};
  for(const check of options.checks){
    try{
    const claim=check.conformance,ids=[...new Set(check.requirementIds)];
    const obligations=ids.map(id=>requirements.get(id));
    if(!claim||!ids.length||!ids.includes(claim.requirementId)||check.constraintIds?.length||obligations.some(requirement=>!requirement||requirement.kind!=='stack'||!requirement.binding||!obligationMatchesProvider(requirement,claim))){reasons.set(check,'not-exclusively-stack-conformance');continue;}
    let selected:ReturnType<typeof execution>;
    try{selected=execution(check,workspace,operational);}catch{reasons.set(check,'ambiguous-operational-invocation');continue;}
    if(!selected){reasons.set(check,'ambiguous-operational-invocation');continue;}
    const candidates=registry.flatMap(owner=>{
      let candidate:ReturnType<typeof execution>;try{candidate=execution(owner.check,workspace,operational);}catch{return[];}
      if(!candidate||candidate.key!==selected!.key)return[];
      return receipts.filter(proof=>proof.taskId===owner.taskId&&proof.checkId===owner.check.id&&proof.kind===check.kind&&proof.level===verificationLevel(check)).map(proof=>({owner,proof}));
    });
    if(!candidates.length){reasons.set(check,'no-identical-task-observation');continue;}
    const inputs=await resolveVerificationInputs(workspace,taskPlan,finalTask,check),current=await snapshot(inputs),files=Object.keys(current).filter(path=>!path.startsWith('selector:'));
    const productFiles=await sourceFiles(workspace,claim.productInputs);
    const outputs=[...new Set([...(check.outputs??[]),...(check.level==='build'?claim.artifacts??[]:[])])];
    const artifacts=outputs.length?await snapshot(outputs):{};
    if(!files.length||!productFiles.length||claim.productInputs.some(selector=>!selectorCovered(selector,productFiles))){reasons.set(check,'unproved-global-input-scope');continue;}
    for(const {owner,proof} of candidates){
      const observed=proof.provenance!,actual=invocationArguments(observed.command);
      if(!actual||stable(actual.map(arg=>portable(arg,observed.workspace)))!==stable(selected.argv)||portable(observed.cwd,observed.workspace)!==selected.cwd)continue;
      if(!proof.environmentRevision||proof.environmentRevision!==verificationOperationalRevision(operational,inputs,check))continue;
      if(files.some(path=>observed.inputs[path]!==current[path]))continue;
      // Missing selectors need the same recorded dependency; file snapshots
      // alone cannot prove that an unrecorded path was absent during execution.
      let absent=false;
      for(const selector of inputs)if(!selectorCovered(selector,files)&&!proof.inputs?.includes(selector)){absent=true;break;}
      if(absent)continue;
      const ownProducts=owner.check.conformance?await sourceFiles(workspace,owner.check.conformance.productInputs):[];
      if(productFiles.some(path=>!ownProducts.includes(path)||observed.inputs[path]!==current[path]))continue;
      if(Object.entries(artifacts).some(([path,hash])=>!path.startsWith('selector:')&&observed.artifactsAfter[path]?.hash!==hash))continue;
      if(outputs.some(selector=>!selectorCovered(selector,Object.keys(artifacts).filter(path=>!path.startsWith('selector:')))))continue;
      const supporting=receipts.filter(receipt=>receipt.id===proof.id||registry.some(candidate=>candidate.taskId===receipt.taskId&&candidate.check.id===receipt.checkId&&consumesVerification(taskPlan,registry,candidate,owner)));
      const key=stable({requirements:ids,receipts:supporting.map(receipt=>receipt.id),environment:operational.revision});
      let valid=validations.get(key);
      if(!valid){valid=validateConformance({...brief,requirements:obligations as ProductBrief['requirements']},taskPlan,operational,supporting,workspace).then(issues=>issues.length===0);validations.set(key,valid);}
      if(await valid){reusable.set(check,{checkId:check.id,receiptIds:[...new Set(supporting.map(receipt=>receipt.id))],requirementIds:ids});break;}
    }
    if(!reusable.has(check))reasons.set(check,'task-observation-does-not-cover-current-global-scope');
    }catch{
      // This optimization has no execution authority. An unreadable scope or
      // unresolved instrument must follow normal verification and recovery.
      reusable.delete(check);reasons.set(check,'unresolved-observation-scope');
    }
  }
  const pending=new Set(options.checks.filter(check=>!reusable.has(check)));
  for(;;){let changed=false;for(const consumer of pending)for(const dependency of consumer.dependsOn??[])for(const producer of options.checks.filter(check=>check.id===dependency))if(!pending.has(producer)){pending.add(producer);reusable.delete(producer);reasons.set(producer,'required-by-pending-final-verification');changed=true;}if(!changed)break;}
  return{checks:options.checks.filter(check=>pending.has(check)),reused:options.checks.flatMap(check=>reusable.has(check)?[reusable.get(check)!]:[]),retained:options.checks.filter(check=>pending.has(check)).map(check=>({checkId:check.id,reason:reasons.get(check)??'verification-required'}))};
}
