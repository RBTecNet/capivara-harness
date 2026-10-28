import { readFile, stat, realpath } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import type { DevelopmentPlan, ProductBrief, Verification } from '../domain/types.js';
import type { CommandResult } from '../runtime/types.js';
import type { OperationalEnvironment } from './environment.js';
import type { VerificationEvidence } from './types.js';
import { digest, inside, sourceFiles } from './files.js';
import type { ProviderWitness } from '../runtime/provider-observation.js';

export interface ObservedArtifact { hash: string; modified: string; changed: string; }
export interface ConformanceProvenance {
  workspace: string;
  command: string | string[];
  cwd: string;
  inputs: Record<string, string>;
  artifactsBefore: Record<string, ObservedArtifact>;
  artifactsAfter: Record<string, ObservedArtifact>;
  exitCode: number | null;
  cancelled: boolean;
  timedOut: boolean;
  runtimeWitnesses?: ProviderWitness[];
}
export interface ConformanceObservation {
  workspace: string; command: string | string[]; cwd: string;
  inputs: Record<string,string>; artifacts: string[]; artifactsBefore: Record<string,ObservedArtifact>;
}
export interface ConformanceIssue { code: string; requirementId: string; message: string; }

/** Shell programs with chaining/substitution are not an unambiguous provider invocation. */
export function invocationArguments(command: string | string[]): string[] | null {
  if (Array.isArray(command)) return command.length ? [...command] : null;
  const result: string[]=[]; let token='', quoted: 'single'|'double'|null=null, escaped=false, present=false;
  for(const char of command){
    if(escaped){token+=char;escaped=false;present=true;continue;}
    if(char==='\\'&&quoted!=='single'){escaped=true;present=true;continue;}
    if(char==="'"&&quoted!=='double'){quoted=quoted==='single'?null:'single';present=true;continue;}
    if(char==='"'&&quoted!=='single'){quoted=quoted==='double'?null:'double';present=true;continue;}
    if(!quoted&&/[;&|<>`$\n\r]/.test(char))return null;
    if(!quoted&&/\s/.test(char)){if(present){result.push(token);token='';present=false;}continue;}
    token+=char;present=true;
  }
  if(escaped||quoted)return null;
  if(present)result.push(token);
  return result.length?result:null;
}
async function observedFiles(workspace:string,selectors:string[]):Promise<Record<string,ObservedArtifact>>{
  const result:Record<string,ObservedArtifact>={};
  for(const path of await sourceFiles(workspace,selectors)){
    const absolute=inside(workspace,path),info=await stat(absolute,{bigint:true}),bytes=await readFile(absolute);
    result[path]={hash:digest(JSON.stringify({mode:Number(info.mode)&0o777,content:digest(bytes)})),modified:String(info.mtimeNs),changed:String(info.ctimeNs)};
  }
  return result;
}
function localArgument(workspace:string,cwd:string,token:string):string|undefined{
  const value=token.includes('=')?token.slice(token.indexOf('=')+1):token;
  if(!value||value.startsWith('-')||/[\n\r\0]/.test(value))return undefined;
  const absolute=resolve(cwd,value),path=relative(resolve(workspace),absolute).replaceAll('\\','/');
  return path==='..'||path.startsWith('../')?undefined:path||'.';
}

/** Captured by the command runner, before execution, rather than supplied by the model. */
export async function beginConformanceObservation(workspace:string,check:Verification,actualCommand:string|string[],cwd:string):Promise<ConformanceObservation>{
  const inputs=[...(check.inputs??[]),...(check.conformance?.productInputs??[]),...(check.conformance?.providerInputs??[])];
  for(const token of invocationArguments(actualCommand)??[]){
    const path=localArgument(workspace,cwd,token);if(!path||path==='.')continue;
    if((await stat(inside(workspace,path)).catch(()=>null))?.isFile())inputs.push(path);
  }
  const files=await observedFiles(workspace,[...new Set(inputs)]);
  const artifacts=[...new Set([...(check.outputs??[]),...(check.conformance?.artifacts??[])])];
  return{workspace:resolve(workspace),command:Array.isArray(actualCommand)?[...actualCommand]:actualCommand,cwd:resolve(cwd),inputs:Object.fromEntries(Object.entries(files).map(([path,value])=>[path,value.hash])),artifacts,artifactsBefore:await observedFiles(workspace,artifacts)};
}
export async function finishConformanceObservation(observation:ConformanceObservation,_check:Verification,result:CommandResult):Promise<ConformanceProvenance>{
  return{workspace:observation.workspace,command:observation.command,cwd:observation.cwd,inputs:observation.inputs,artifactsBefore:observation.artifactsBefore,artifactsAfter:await observedFiles(observation.workspace,observation.artifacts),exitCode:result.exitCode,cancelled:result.cancelled,timedOut:result.timedOut};
}
const portable=(value:string,workspace:string):string=>value.replaceAll(resolve(workspace),'$WORKSPACE').replaceAll('\\','/');
function matchingPrefix(actual:string[],expected:string[],actualRoot:string,expectedRoot:string,actualCwd=actualRoot):boolean{
  return actual.length>=expected.length&&expected.every((value,index)=>{
    const target=portable(value,expectedRoot),given=portable(actual[index]!,actualRoot);
    return given===target||target.startsWith('$WORKSPACE/')&&portable(resolve(actualCwd,actual[index]!),actualRoot)===target;
  });
}
function consumes(provenance:ConformanceProvenance,path:string,start=1):boolean{
  const args=invocationArguments(provenance.command);if(!args)return false;
  for(let index=start;index<args.length;index++){
    // Probe/evaluation flags before a source argument do not establish execution of that source.
    if(['--version','-V','--help','-h','--eval','-e','-c','--command'].includes(args[index]!))return false;
    const candidate=localArgument(provenance.workspace,provenance.cwd,args[index]!);
    if(candidate&&(candidate==='.'||path===candidate||path.startsWith(`${candidate.replace(/\/$/,'')}/`)))return true;
  }
  return false;
}
function produced(provenance:ConformanceProvenance,path:string):boolean{
  const after=provenance.artifactsAfter[path],before=provenance.artifactsBefore[path];
  return Boolean(after&&(!before||after.hash!==before.hash||after.modified!==before.modified||after.changed!==before.changed));
}

/** Availability is never product conformance. Only actual invocation/input/artifact provenance qualifies. */
export async function validateConformance(brief:ProductBrief,plan:DevelopmentPlan,operational:OperationalEnvironment,evidence:VerificationEvidence[],workspace:string):Promise<ConformanceIssue[]>{
  const issues:ConformanceIssue[]=[];
  const report=(requirementId:string,code:string,message:string):void=>{issues.push({requirementId,code,message});};
  const checks=plan.acceptance??[];
  for(const requirement of brief.requirements){
    const binding=requirement.binding;if(!binding)continue;
    const dedicated=checks.filter(check=>check.conformance?.requirementId===requirement.id&&check.requirementIds.includes(requirement.id)&&check.conformance.capability===binding.capability&&check.conformance.kind===binding.kind&&check.conformance.provider===binding.provider);
    if(!dedicated.length){report(requirement.id,'missing-conformance','A mandatory provider needs dedicated product-usage evidence; readiness and generic behavior IDs are insufficient.');continue;}
    const provider=Object.values(operational.bindings).find(candidate=>candidate.ready&&candidate.capability===binding.capability&&candidate.kind===binding.kind&&candidate.provider===binding.provider);
    if(!provider){report(requirement.id,'provider-unavailable','The exact mandatory operational provider is not ready.');continue;}
    let accepted=false;const reasons:string[]=[];
    for(const check of dedicated){
      const claim=check.conformance!;
      const proof=evidence.findLast(item=>item.taskId==='$acceptance'&&item.checkId===check.id&&item.passed&&item.provenance);
      const observed=proof?.provenance;
      if(!proof||!observed||observed.cancelled||observed.timedOut||proof.level==='build'&&observed.exitCode!==0){reasons.push('No successful execution provenance exists for the dedicated recipe.');continue;}
      if(proof.level==='syntax'){reasons.push('Syntax does not establish provider consumption by the product.');continue;}
      if(binding.kind==='sdk'&&proof.level!=='build'){reasons.push('A mandatory SDK needs an observed build, a produced artifact and a dependent functional execution; a behavior label on its compiler output is insufficient.');continue;}
      if(['runtime','service'].includes(binding.kind)&&proof.level!=='behavior'){reasons.push('A mandatory runtime or service must execute the product behavior, rather than merely generate an artifact.');continue;}
      const args=invocationArguments(observed.command);
      const productFiles=await sourceFiles(workspace,claim.productInputs);
      if(!productFiles.length){reasons.push('No existing product inputs are bound to this proof.');continue;}
      const canonical=await observedFiles(workspace,claim.productInputs);
      if(productFiles.some(path=>observed.inputs[path]!==canonical[path]?.hash)){reasons.push('Product inputs changed or were not captured before the provider invocation.');continue;}
      let runtimeWitness=false;
      if(binding.kind==='runtime'&&provider.command?.length){
        const selected=await realpath(provider.command[0]!).catch(()=>provider.command![0]!);
        for(const witness of observed.runtimeWitnesses??[]){
          if(witness.source!=='node-load-hook'||witness.execArgv.some(arg=>['--check','-c','--version','--help'].includes(arg)))continue;
          const executable=await realpath(witness.execPath).catch(()=>witness.execPath);
          const actual=[executable,...witness.execArgv,...witness.argv.slice(1)];
          if(!matchingPrefix(actual,[selected,...provider.command.slice(1)],observed.workspace,operational.root??workspace,observed.cwd))continue;
          if(productFiles.some(path=>witness.inputs[path]===canonical[path]?.hash)){runtimeWitness=true;break;}
        }
      }
      const directConsumption=Boolean(args&&productFiles.some(path=>consumes(observed,path,provider.command?.length??1)));
      if(!directConsumption&&!runtimeWitness){reasons.push('Neither the actual invocation nor a concrete descendant runtime loaded a current product input. Readiness and instrument scripts are insufficient.');continue;}
      if(provider.command?.length){
        if(!runtimeWitness&&(!args||!matchingPrefix(args,provider.command,observed.workspace,operational.root??workspace,observed.cwd))){reasons.push('The command that ran is not the mandatory operational provider.');continue;}
        if(claim.providerCommand?.length&&!matchingPrefix(claim.providerCommand,provider.command,workspace,operational.root??workspace)){reasons.push('The declared provider invocation contradicts its operational binding.');continue;}
      }else{
        const providerInputs=claim.providerInputs??[];
        const declared=[...(provider.inputs??[]),...(provider.paths??[])].map(path=>portable(isAbsolute(path)?path:resolve(workspace,path),operational.root??workspace));
        const providerFiles=await sourceFiles(workspace,providerInputs);
        if(!providerFiles.length||!providerFiles.every(path=>declared.some(scope=>{const target=portable(resolve(workspace,path),workspace);return target===scope||target.startsWith(`${scope.replace(/\/$/,'')}/`);})&&observed.inputs[path]&&consumes(observed,path,0))){reasons.push('A library/driver/service needs actual provider-file consumption or a concrete provider invocation, plus product interaction. Metadata alone is insufficient.');continue;}
      }
      if(proof.level==='build'){
        const artifacts=Object.keys(observed.artifactsAfter).filter(path=>produced(observed,path));
        if(!artifacts.length){reasons.push('The purported production build produced no observed artifact.');continue;}
        const functional=evidence.some(run=>run.passed&&run.level==='behavior'&&run.provenance&&checks.some(recipe=>recipe.id===run.checkId&&recipe.dependsOn?.includes(check.id)&&recipe.requirementIds.includes(requirement.id))&&artifacts.some(path=>run.provenance!.inputs[path]===observed.artifactsAfter[path]!.hash&&consumes(run.provenance!,path,0)));
        if(!functional){reasons.push('No successful functional recipe consumed the exact artifact produced by the mandatory provider.');continue;}
      }else if(proof.level!=='behavior'){reasons.push('The dedicated recipe has no observed build or behavior level.');continue;}
      accepted=true;break;
    }
    if(!accepted)report(requirement.id,'unproven-product-provider-usage',[...new Set(reasons)].join(' '));
  }
  return issues;
}
