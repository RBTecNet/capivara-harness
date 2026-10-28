import { lstat, readFile, realpath } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import type { DevelopmentPlan, ProductBrief, WorkUnit } from '../domain/types.js';
import { taskReferences } from '../domain/material.js';
import { digest, inputSnapshot, inside, sourceFiles } from './files.js';

export interface InspectionIdentity {
  schema: 'capivara/inspection/1';
  authorityHash: string;
  selectors: string[];
  focusPaths: string[];
  /** Explicit selector membership, missing paths and content/mode hashes. */
  sources: Record<string,string>;
  usable: boolean;
  issues?: string[];
}
type InspectionCoverage = { path:string; hash?:string|null };
const canonical=(value:unknown):unknown=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>[key,canonical(item)])):value;
const fingerprint=(value:unknown):string=>digest(JSON.stringify(canonical(value)));
function providerIdentities(plan:DevelopmentPlan,task:WorkUnit):unknown[]{
  const seen=new Set<string>();
  const visit=(id:string):void=>{if(seen.has(id))return;seen.add(id);plan.environment.find(node=>node.id===id)?.dependsOn.forEach(visit);};
  task.environmentIds.forEach(visit);
  return [...seen].sort().map(id=>{const node=plan.environment.find(node=>node.id===id);return{id,identity:node?.identity??{capability:id,kind:node?.kind??'missing',provider:id}};});
}
function authority(brief:ProductBrief,plan:DevelopmentPlan,task:WorkUnit):unknown{
  const {checks:_mechanicalProofs,...delivery}=task;
  const requirements=brief.requirements.filter(requirement=>task.requirementIds.includes(requirement.id));
  const words=new Set([task.title,task.goal,...requirements.map(requirement=>requirement.statement)].join(' ').toLowerCase().split(/\W+/).filter(word=>word.length>3));
  const decisions=brief.decisions.filter(decision=>task.blockedBy.includes(decision.questionId)||`${decision.fact} ${decision.answer}`.toLowerCase().split(/\W+/).some(word=>words.has(word)));
  const contracts=new Set([...task.contractIds,...task.exclusiveContracts??[]]);
  return{product:brief.id,delivery,requirements,constraints:brief.constraints,contracts:plan.contracts.filter(contract=>contracts.has(contract.id)),decisions,modes:brief.modes,targets:brief.targets,references:taskReferences(brief,task).map(({reference,localPath,scope,contentHash})=>({reference,localPath,scope,contentHash})),providers:providerIdentities(plan,task)};
}
function normalizedSelector(workspace:string,value:string):string{
  const exclusion=value.startsWith('!'),given=exclusion?value.slice(1):value;
  const path=(isAbsolute(given)?relative(resolve(workspace),given):given).replaceAll('\\','/').replace(/^\.\//,'');
  if(path==='.'||path==='')return exclusion?'!.':'.';
  inside(workspace,path);
  return`${exclusion?'!':''}${path}`;
}

/** Independent inspection concerns product authority and explicitly inspected
 * sources. Automatically discovered build manifests belong to mechanical proof
 * identity and never become hidden inspection-wide dependencies. */
export async function createInspectionIdentity(workspace:string,brief:ProductBrief,plan:DevelopmentPlan,task:WorkUnit,coverage:readonly InspectionCoverage[]=[]):Promise<InspectionIdentity>{
  const sources:Record<string,string>={},issues:string[]=[];
  const identity:InspectionIdentity={schema:'capivara/inspection/1',authorityHash:fingerprint(authority(brief,plan,task)),selectors:[],focusPaths:[],sources,usable:false};
  try{
    identity.focusPaths=[...new Set(coverage.map(item=>normalizedSelector(workspace,item.path)))].sort();
    identity.selectors=[...new Set([...task.files,...task.inputs??[],...identity.focusPaths].map(path=>normalizedSelector(workspace,path)))].sort();
    const files=await sourceFiles(workspace,identity.selectors),root=resolve(workspace);
    for(const path of files){
      const actual=await realpath(inside(root,path)),rel=relative(root,actual);
      if(rel==='..'||rel.startsWith(`..${sep}`)||isAbsolute(rel))throw Error(`Inspection source escapes the isolated workspace: ${path}`);
    }
    Object.assign(sources,await inputSnapshot(workspace,identity.selectors));
    for(const selector of identity.selectors){
      if(selector.startsWith('!')||/[*?{}[\]]/.test(selector))continue;
      const path=selector==='.'?root:inside(root,selector);
      const info=await lstat(path).catch(error=>{if((error as NodeJS.ErrnoException).code==='ENOENT')return undefined;throw error;});
      sources[`selector:${selector}`]=!info?'missing':info.isSymbolicLink()?'link':info.isDirectory()?'directory':info.isFile()?'file':'other';
    }
    for(const delivered of coverage){
      if(delivered.hash===undefined)continue;
      const path=normalizedSelector(workspace,delivered.path);
      const bytes=await readFile(inside(workspace,path)).catch(error=>{if((error as NodeJS.ErrnoException).code==='ENOENT')return undefined;throw error;});
      if((bytes?digest(bytes):null)!==delivered.hash)issues.push(`Delivered inspection source changed before its receipt was recorded: ${path}`);
    }
  }catch(error){issues.push(error instanceof Error?error.message:String(error));}
  identity.usable=issues.length===0;
  if(issues.length)identity.issues=issues;
  return identity;
}

/** Only callers holding an approved verdict may consider reuse. Failed and
 * unresolved reviews never acquire approval merely by matching this identity. */
export async function inspectionStillCurrent(identity:InspectionIdentity|undefined,workspace:string,brief:ProductBrief,plan:DevelopmentPlan,task:WorkUnit):Promise<boolean>{
  if(identity?.schema!=='capivara/inspection/1'||!identity.usable||!Array.isArray(identity.focusPaths))return false;
  const current=await createInspectionIdentity(workspace,brief,plan,task,identity.focusPaths.map(path=>({path})));
  return current.usable&&current.authorityHash===identity.authorityHash&&fingerprint(current.selectors)===fingerprint(identity.selectors)&&fingerprint(current.sources)===fingerprint(identity.sources);
}
