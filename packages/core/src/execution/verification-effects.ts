import { lstat, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep, matchesGlob } from 'node:path';
import type { Verification } from '../domain/types.js';
import { verificationOutputs } from '../domain/verifications.js';
import { providerWriteCurrent } from '../runtime/provider-observation.js';
import { inputSnapshot, inside } from './files.js';
import type { VerificationEvidence } from './types.js';

export interface ObservedProducerOutput {
  path:string;
  hash:string;
  proposalBeforeHash:string|null;
  sourceEvidenceId:string;
}
export interface ObservedProducerEffects {
  check:Verification;
  outputs:ObservedProducerOutput[];
  rejected:{path:string;reason:string}[];
  transformation?:{
    schema:'capivara/observed-producer-outputs/1';
    sourceEvidenceId:string;
    checkId:string;
    originalOutputs:string[];
    selectedOutputs:string[];
    status:'candidate-declaration';
  };
}
const normalized=(value:string):string=>value.replaceAll('\\','/').replace(/^\.\//,'');
const control=(path:string):boolean=>['.git','.capivara-next','.capivara-runtime','.capivara-verification','.capivara-tools','.project-inputs','node_modules'].includes(path.split('/')[0]!);
const contained=(path:string,scope:string):boolean=>path===scope||path.startsWith(scope.replace(/\/$/,'')+'/');

async function safeTarget(workspace:string,path:string):Promise<boolean>{
  const target=inside(workspace,path),root=await realpath(workspace);
  let current=target;
  for(;;){
    const info=await lstat(current).catch(error=>{if((error as NodeJS.ErrnoException).code==='ENOENT')return null;throw error;});
    if(info?.isSymbolicLink())return false;
    if(info){
      const actual=relative(root,await realpath(current));
      if(actual==='..'||actual.startsWith(`..${sep}`))return false;
      if(current!==target&&!info.isDirectory()||current===target&&!info.isFile())return false;
    }
    if(resolve(current)===resolve(workspace))return true;
    const parent=dirname(current);if(parent===current)return false;current=parent;
  }
}

/** Derive exact producer-output candidates from a real successful write trace.
 * Existing source inputs and conflicting user files cannot become generated
 * outputs merely because a verification program overwrote them. The caller
 * persists this declaration, orders its consumers, verifies again and publishes
 * through the normal conflict-checked integration; this helper writes nothing. */
export async function deriveObservedProducerOutputs(options:{workspace:string;check:Verification;evidence:VerificationEvidence;sourceFiles?:readonly string[];protectedPaths?:readonly string[]}):Promise<ObservedProducerEffects>{
  const {check,evidence}=options,observed=evidence.provenance;
  const result:ObservedProducerEffects={check,outputs:[],rejected:[]};
  if(!observed||!evidence.passed||evidence.checkId!==check.id||evidence.level!=='build'||observed.exitCode!==0||observed.cancelled||observed.timedOut||evidence.observation?.issue)return result;
  const candidates=new Map((observed.generatedArtifacts??[]).map(write=>[normalized(write.path),write]));
  const sourcePaths=Object.keys(observed.inputs),sources=new Set([...sourcePaths,...options.sourceFiles??[]].map(normalized));
  const [current,executed]=await Promise.all([inputSnapshot(options.workspace,sourcePaths),inputSnapshot(observed.workspace,sourcePaths)]);
  const changed=sourcePaths.filter(path=>current[path]!==observed.inputs[path]||executed[path]!==observed.inputs[path]);
  for(const [path,write] of [...candidates].sort(([left],[right])=>left.localeCompare(right))){
    const reject=(reason:string):void=>{result.rejected.push({path,reason});};
    if(!path||path==='.'||isAbsolute(path)||/^[A-Za-z]:/.test(path)||path.split('/').includes('..')||/[\0*?{}[\]]/.test(path)||control(path)||(options.protectedPaths??[]).some(scope=>contained(path,normalized(scope)))){reject('The observed write is not a publishable product output path.');continue;}
    if(sources.has(path)){reject('The observed write overlaps an original input or concrete product source. Recover the instrument; source mutation is not a generated output.');continue;}
    if(verificationOutputs(check).some(output=>contained(path,normalized(output))||matchesGlob(path,normalized(output))))continue;
    if(changed.length){reject(`Original producer inputs no longer match in the proposal or execution area: ${changed.join(', ')}.`);continue;}
    if(!await providerWriteCurrent(observed.workspace,observed.workspace,write)){reject('The actual producer host or isolated artifact changed since the write observation.');continue;}
    if(!await safeTarget(options.workspace,path)){reject('The publication target or its ancestors are not safe independent project files/directories.');continue;}
    const proposalBeforeHash=(await inputSnapshot(options.workspace,[path]))[path]??null;
    const declaredBefore=observed.artifactsBefore[path]?.hash;
    if(proposalBeforeHash!==null&&proposalBeforeHash!==write.hash&&proposalBeforeHash!==declaredBefore){reject('An existing proposal/user file has no matching producer baseline; retain it and resolve the integration conflict.');continue;}
    result.outputs.push({path,hash:write.hash,proposalBeforeHash,sourceEvidenceId:evidence.id});
  }
  if(result.outputs.length){
    const originalOutputs=check.outputs??[],selectedOutputs=[...new Set([...originalOutputs,...result.outputs.map(output=>output.path)])].sort();
    result.check={...check,outputs:selectedOutputs};
    result.transformation={schema:'capivara/observed-producer-outputs/1',sourceEvidenceId:evidence.id,checkId:check.id,originalOutputs:[...originalOutputs],selectedOutputs,status:'candidate-declaration'};
  }
  return result;
}
