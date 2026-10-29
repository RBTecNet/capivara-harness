import { readFile, stat, realpath } from 'node:fs/promises';
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { createRequire } from 'node:module';
import type { DevelopmentPlan, ProductBrief, Verification } from '../domain/types.js';
import type { CommandResult } from '../runtime/types.js';
import type { CapabilityBinding, OperationalEnvironment } from './environment.js';
import type { VerificationEvidence } from './types.js';
import { digest, inside, sourceFiles } from './files.js';
import { literalProviderImports, providerConsumptionCurrent, providerProcessCurrent, resolveModuleHost, resolveNativeNode, resolveProviderModuleFiles, resolveProviderProgram, type ModuleProviderReceipt, type ModuleProviderWitness, type ProviderConsumption, type ProviderProcessWitness, type ProviderWitness, type RuntimeProviderReceipt } from '../runtime/provider-observation.js';
import { verificationRegistry } from '../domain/verifications.js';
import { matchesOperationalClaim, obligationMatchesProvider } from '../domain/bindings.js';

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
  runtimeProvider?: RuntimeProviderReceipt;
  moduleProviders?:ModuleProviderReceipt[];
  moduleWitnesses?:ModuleProviderWitness[];
  consumptions?:ProviderConsumption[];
  processes?:ProviderProcessWitness[];
  runtimeObservation?: { enabled:boolean; reason?:string; diagnostics:string[] };
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
    if(['--version','-V','--help','-h','--check','--eval','-e','-c','--command'].includes(args[index]!))return false;
    const candidate=localArgument(provenance.workspace,provenance.cwd,args[index]!);
    if(candidate&&(candidate==='.'||path===candidate||path.startsWith(`${candidate.replace(/\/$/,'')}/`)))return true;
  }
  return false;
}
function produced(provenance:ConformanceProvenance,path:string):boolean{
  const after=provenance.artifactsAfter[path],before=provenance.artifactsBefore[path];
  return Boolean(after&&(!before||after.hash!==before.hash||after.modified!==before.modified||after.changed!==before.changed));
}
async function loadedProviderModule(observed:ConformanceProvenance,provider:CapabilityBinding,operational:OperationalEnvironment,workspace:string,canonical:Record<string,ObservedArtifact>):Promise<boolean>{
  if(!provider.modules?.length||!['library','driver','sdk'].includes(provider.kind))return false;
  for(const declaration of provider.modules){
    const receipt=observed.moduleProviders?.find(item=>item.capability===provider.capability&&item.kind===provider.kind&&item.provider===provider.provider&&item.fingerprint===provider.fingerprint&&item.protocol===declaration.protocol&&item.specifier===declaration.specifier&&item.runtimeCommand.length===declaration.runtimeCommand.length&&matchingPrefix(item.runtimeCommand,declaration.runtimeCommand,observed.workspace,operational.root??workspace,observed.cwd));
    if(!receipt)return false;
    const currentCwd=resolve(workspace,relative(observed.workspace,observed.cwd));
    const current=await resolveModuleHost(currentCwd,declaration,operational.env).catch(()=>undefined);
    if(!current||current.nativeFingerprint!==receipt.nativeFingerprint||current.launcher.fingerprint!==receipt.launcher.fingerprint||!matchingPrefix([receipt.execPath],[current.execPath],observed.workspace,operational.root??workspace)||!matchingPrefix([receipt.launcher.path],[current.launcher.path],observed.workspace,operational.root??workspace))return false;
    let proved=false;
    for(const witness of observed.moduleWitnesses??[]){
      if(witness.protocol!==declaration.protocol||witness.source!==(declaration.protocol==='node'?'node-module-hook':'python-audit-hook'))continue;
      const native=await realpath(witness.execPath).catch(()=>undefined);if(!native||native!==current.execPath)continue;
      const args=declaration.protocol==='node'?[native,...witness.execArgv,...witness.argv.slice(1)]:[native,...witness.argv.slice(1)];
      if(declaration.protocol==='node'&&witness.execArgv.some(arg=>['--check','-c','--version','--help'].includes(arg)))continue;
      if(!current.launcher.shebang&&!matchingPrefix(args,[native,...declaration.runtimeCommand.slice(1)],observed.workspace,operational.root??workspace,observed.cwd))continue;
      if(!Object.entries(witness.inputs).some(([path,hash])=>canonical[path]?.hash===hash))continue;
      for(const module of witness.modules.filter(item=>item.specifier===declaration.specifier)){
        if(!Object.entries(module.importedBy??{}).some(([path,hash])=>canonical[path]?.hash===hash))continue;
        if(module.origin.startsWith('builtin:')&&!module.hash){proved=true;break;}
        if(!module.hash||!isAbsolute(module.origin))continue;
        const relativeOrigin=relative(observed.workspace,module.origin);
        const path=relativeOrigin==='..'||relativeOrigin.startsWith(`..${sep}`)?module.origin:resolve(workspace,relativeOrigin);
        try{const info=await stat(path);if(info.isFile()&&digest(JSON.stringify({mode:info.mode&0o777,content:digest(await readFile(path))}))===module.hash){proved=true;break;}}catch{/* Removed or changed module files cannot reuse their old witness. */}
      }
      if(proved)break;
    }
    if(!proved)return false;
  }
  return true;
}
async function observedConsumption(observed:ConformanceProvenance,path:string,hash:string,workspace:string):Promise<boolean>{
  if((await observedFiles(workspace,[path]))[path]?.hash!==hash)return false;
  for(const receipt of observed.consumptions??[])if(receipt.path===path&&await providerConsumptionCurrent(workspace,observed.workspace,receipt,hash))return true;
  // A concrete source operand remains a valid direct observation. Named read
  // sets alone never enter this branch: snapshots are not execution witnesses.
  return observed.inputs[path]===hash&&consumes(observed,path,0);
}
async function sourceUsesProvider(workspace:string,observed:ConformanceProvenance,productFiles:string[],provider:CapabilityBinding,providerInputs:string[]):Promise<boolean>{
  const entries=await resolveProviderModuleFiles(workspace,provider.modules??[]);
  const scopes=await Promise.all([...(provider.inputs??[]),...(provider.paths??[])].map(path=>realpath(resolve(workspace,path)).catch(()=>resolve(workspace,path))));
  for(const source of productFiles){
    const file=resolve(workspace,source),text=await readFile(file,'utf8');
    for(const specifier of literalProviderImports(text)){
      let target:string|undefined;
      try{target=specifier.startsWith('.')||isAbsolute(specifier)?resolve(dirname(file),specifier):createRequire(file).resolve(specifier);}catch{continue;}
      if(basename(target)==='package.json')continue;
      target=await realpath(target).catch(()=>target!);
      const declared=entries.filter(entry=>entry.path===target);
      if(!declared.length&&!scopes.some(scope=>target===scope||target!.startsWith(`${scope}${sep}`)))continue;
      const info=await stat(target).catch(()=>null);if(!info?.isFile())continue;
      const hash=digest(JSON.stringify({mode:info.mode&0o777,content:digest(await readFile(target))}));
      const local=relative(resolve(workspace),target).replaceAll('\\','/');
      const aliases=declared.map(entry=>entry.logicalPath);
      if(local!=='..'&&!local.startsWith('../')&&!isAbsolute(local))aliases.push(local);
      for(const path of new Set(aliases))if(await observedConsumption(observed,path,hash,workspace))return true;
    }
  }
  return false;
}
async function functionalArtifactChain(workspace:string,plan:DevelopmentPlan,evidence:VerificationEvidence[],requirementId:string,product:Record<string,ObservedArtifact>,producer?:VerificationEvidence):Promise<boolean>{
  const registry=verificationRegistry(plan);
  const producers=producer?[producer]:evidence.filter(proof=>proof.passed&&proof.level==='build'&&registry.some(({taskId,check})=>taskId===proof.taskId&&check.id===proof.checkId&&check.kind===proof.kind));
  for(const build of producers){
    const built=build.provenance;if(!built||built.exitCode!==0||built.cancelled||built.timedOut||!Object.keys(product).length||!Object.keys(product).every(path=>built.inputs[path]===product[path]!.hash))continue;
    const artifacts=Object.keys(built.artifactsAfter).filter(path=>produced(built,path));
    for(const run of evidence){
      if(!run.passed||run.level!=='behavior'||!run.provenance||run.provenance.cancelled||run.provenance.timedOut||!registry.some(({taskId,check})=>taskId===run.taskId&&check.id===run.checkId&&check.kind===run.kind))continue;
      for(const path of artifacts)if(await observedConsumption(run.provenance,path,built.artifactsAfter[path]!.hash,workspace))return true;
    }
  }
  return false;
}

/** Availability is never product conformance. Only actual invocation/input/artifact provenance qualifies. */
export async function validateConformance(brief:ProductBrief,plan:DevelopmentPlan,operational:OperationalEnvironment,evidence:VerificationEvidence[],workspace:string):Promise<ConformanceIssue[]>{
  const issues:ConformanceIssue[]=[];
  const report=(requirementId:string,code:string,message:string):void=>{issues.push({requirementId,code,message});};
  const checks=verificationRegistry(plan);
  for(const requirement of brief.requirements){
    const binding=requirement.binding;if(!binding)continue;
    const dedicated=checks.filter(({check})=>check.conformance?.requirementId===requirement.id&&check.requirementIds.includes(requirement.id)&&obligationMatchesProvider(requirement,check.conformance));
    if(!dedicated.length){report(requirement.id,'missing-conformance','A mandatory provider needs dedicated product-usage evidence; readiness and generic behavior IDs are insufficient.');continue;}
    const providers=Object.values(operational.bindings).filter(candidate=>candidate.ready&&obligationMatchesProvider(requirement,candidate));
    if(!providers.length){report(requirement.id,'provider-unavailable','The mandatory operational provider and its explicitly required role are not ready.');continue;}
    let accepted=false;const reasons:string[]=[];
    for(const owned of dedicated){
      const check=owned.check;
      const claim=check.conformance!;
      const candidates=providers.filter(candidate=>matchesOperationalClaim(requirement,claim,candidate));
      const exact=candidates.filter(candidate=>candidate.capability===claim.capability);
      const provider=exact.length===1?exact[0]:candidates.length===1?candidates[0]:undefined;
      if(!provider){reasons.push('The proof has no unique operational provider with its actual claimed role. Inferred labels cannot replace the provider or its role.');continue;}
      const proof=evidence.findLast(item=>item.taskId===owned.taskId&&item.checkId===check.id&&item.kind===check.kind&&item.passed&&item.provenance);
      const observed=proof?.provenance;
      if(!proof||!observed||observed.cancelled||observed.timedOut||proof.level==='build'&&observed.exitCode!==0){reasons.push('No successful execution provenance exists for the dedicated recipe.');continue;}
      if(proof.level==='syntax'&&provider.kind!=='sdk'){reasons.push('Syntax does not establish provider consumption by the product.');continue;}
      if(['runtime','service'].includes(provider.kind)&&proof.level!=='behavior'){reasons.push('A mandatory runtime or service must execute the product behavior, rather than merely generate an artifact.');continue;}
      const args=invocationArguments(observed.command);
      const productFiles=await sourceFiles(workspace,claim.productInputs);
      if(!productFiles.length){reasons.push('No existing product inputs are bound to this proof.');continue;}
      const canonical=await observedFiles(workspace,claim.productInputs);
      if(productFiles.some(path=>observed.inputs[path]!==canonical[path]?.hash)){reasons.push('Product inputs changed or were not captured before the provider invocation.');continue;}
      let runtimeWitness=false;
      if(provider.kind==='runtime'&&provider.command?.length){
        const receipt=observed.runtimeProvider;
        let receiptMatches=false;
        if(receipt&&receipt.capability===provider.capability&&receipt.kind===provider.kind&&receipt.provider===provider.provider&&receipt.fingerprint===provider.fingerprint&&receipt.bindingCommand.length===provider.command.length&&matchingPrefix(receipt.bindingCommand,provider.command,observed.workspace,operational.root??workspace,observed.cwd)){
          try{
            const currentCwd=resolve(workspace,relative(observed.workspace,observed.cwd));
            const current=await resolveNativeNode(currentCwd,provider.command,operational.env);
            receiptMatches=Boolean(current&&current.nativeFingerprint===receipt.nativeFingerprint&&current.launcher.fingerprint===receipt.launcher.fingerprint&&matchingPrefix([receipt.execPath],[current.execPath],observed.workspace,operational.root??workspace,observed.cwd));
          }catch{/* A missing or changed native binding is unproved, never a product failure. */}
        }
        if(receipt&&!receiptMatches){reasons.push('The recorded native runtime identity no longer matches the selected operational provider.');continue;}
        const selected=await realpath(provider.command[0]!).catch(()=>provider.command![0]!);
        for(const witness of observed.runtimeWitnesses??[]){
          if(witness.source!=='node-load-hook'||witness.execArgv.some(arg=>['--check','-c','--version','--help'].includes(arg)))continue;
          const executable=await realpath(witness.execPath).catch(()=>witness.execPath);
          const actual=[executable,...witness.execArgv,...witness.argv.slice(1)];
          if(receipt){
            if(!receiptMatches||executable!==await realpath(receipt.execPath).catch(()=>receipt.execPath))continue;
            // Native bindings retain fixed interpreter arguments. Launcher scripts
            // instead identify their interpreter through the verified shebang.
            if(!receipt.launcher.shebang&&selected===executable&&!matchingPrefix(actual,[executable,...provider.command.slice(1)],observed.workspace,operational.root??workspace,observed.cwd))continue;
          }else if(!matchingPrefix(actual,[selected,...provider.command.slice(1)],observed.workspace,operational.root??workspace,observed.cwd))continue;
          if(productFiles.some(path=>witness.inputs[path]===canonical[path]?.hash)){runtimeWitness=true;break;}
        }
      }
      const moduleWitness=proof.level==='behavior'&&await loadedProviderModule(observed,provider,operational,workspace,canonical);
      if(provider.kind==='sdk'&&proof.level==='behavior'&&!moduleWitness){reasons.push('A behavior label on compiler output cannot bypass the observed build and functional artifact chain. A client SDK instead needs actual module consumption by the product.');continue;}
      let directConsumption=Boolean(args&&productFiles.some(path=>consumes(observed,path,provider.command?.length??1)));
      if(!directConsumption&&provider.kind!=='runtime')for(const path of productFiles)if(await observedConsumption(observed,path,canonical[path]!.hash,workspace)){directConsumption=true;break;}
      let providerProcess=false;
      if(provider.command?.length&&['sdk','cli'].includes(provider.kind)){
        const program=await resolveProviderProgram(resolve(workspace,relative(observed.workspace,observed.cwd)),provider.command,operational.env).catch(()=>undefined);
        if(program)for(const process of observed.processes??[])if(await providerProcessCurrent(workspace,observed.workspace,process,program)){
          providerProcess=true;
          const invocation={...observed,cwd:process.cwd??observed.cwd,command:[process.execPath,...process.execArgv,...process.argv.slice(1)]};
          if(productFiles.some(path=>consumes(invocation,path,1)))directConsumption=true;
          break;
        }
      }
      if(!directConsumption&&!runtimeWitness&&!moduleWitness){reasons.push('Neither the actual invocation nor a concrete descendant runtime loaded a current product input. Readiness and instrument scripts are insufficient.');continue;}
      if(provider.command?.length&&!moduleWitness){
        if(!runtimeWitness&&!providerProcess&&(!args||!matchingPrefix(args,provider.command,observed.workspace,operational.root??workspace,observed.cwd))){reasons.push('The command that ran is not the mandatory operational provider.');continue;}
        if(claim.providerCommand?.length&&!matchingPrefix(claim.providerCommand,provider.command,workspace,operational.root??workspace)){reasons.push('The declared provider invocation contradicts its operational binding.');continue;}
      }else if(!moduleWitness){
        const providerInputs=claim.providerInputs??[];
        const declared=[...(provider.inputs??[]),...(provider.paths??[])].map(path=>portable(isAbsolute(path)?path:resolve(workspace,path),operational.root??workspace));
        const providerFiles=await sourceFiles(workspace,providerInputs);
        const compiledUse=proof.level==='build'&&['library','driver'].includes(provider.kind)&&await sourceUsesProvider(workspace,observed,productFiles,provider,providerInputs);
        if(!compiledUse&&(!providerFiles.length||!providerFiles.every(path=>declared.some(scope=>{const target=portable(resolve(workspace,path),workspace);return target===scope||target.startsWith(`${scope.replace(/\/$/,'')}/`);})&&observed.inputs[path]&&consumes(observed,path,0)))){reasons.push('A library/driver/service needs a current module-load witness in the same process as the executed product, actual provider-file consumption or a concrete provider invocation, plus product interaction. Metadata alone is insufficient.');continue;}
      }
      if(proof.level==='syntax'&&provider.kind==='sdk'){
        if(!await functionalArtifactChain(workspace,plan,evidence,requirement.id,canonical)){reasons.push('A non-emitting SDK check proves source participation only; a real build and functional consumption of its current artifact are still required.');continue;}
      }else if(proof.level==='build'){
        const artifacts=Object.keys(observed.artifactsAfter).filter(path=>produced(observed,path));
        if(!artifacts.length){reasons.push('The purported production build produced no observed artifact.');continue;}
        const functional=await functionalArtifactChain(workspace,plan,evidence,requirement.id,canonical,proof);
        if(!functional){reasons.push('No successful functional recipe consumed the exact artifact produced by the mandatory provider.');continue;}
      }else if(proof.level!=='behavior'){reasons.push('The dedicated recipe has no observed build or behavior level.');continue;}
      accepted=true;break;
    }
    if(!accepted)report(requirement.id,'unproven-product-provider-usage',[...new Set(reasons)].join(' '));
  }
  return issues;
}
