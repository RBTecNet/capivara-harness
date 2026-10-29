import { readFile, stat } from 'node:fs/promises';
import { basename, isAbsolute, relative, resolve, matchesGlob } from 'node:path';
import type { CapabilityIdentity, DevelopmentPlan, ProductBrief, Verification, WorkUnit } from '../domain/types.js';
import { obligationMatchesProvider } from '../domain/bindings.js';
import { verificationOutputs } from '../domain/verifications.js';
import { literalInvocationArguments } from '../runtime/invocation.js';
import type { OperationalEnvironment } from './environment.js';
import { sourceFiles } from './files.js';
import { dependencyFamilies } from './dependencies.js';
import type { VerificationEvidence } from './types.js';

type Claim=NonNullable<Verification['conformance']>;
export interface ConformanceCandidateCoverage {
  schema:'capivara/conformance-candidates/1';
  taskId:string;
  sourceTaskIds:string[];
  environmentIds:string[];
  inputs:string[];
  excludedOutputs?:string[];
  instrument:{resolved:boolean;inputs:string[]};
  requirements:{requirementId:string;status:'candidate'|'unavailable';providers:(CapabilityIdentity&{fingerprint?:string;productInputs:string[]})[]}[];
}
export interface EnrichVerificationConformanceOptions {
  brief:ProductBrief;plan:DevelopmentPlan;task:WorkUnit;check:Verification;
  operational:OperationalEnvironment;workspace:string;
  evidence?:readonly VerificationEvidence[];
  deliveryFiles?:readonly string[];
}
const normalize=(path:string):string=>path.replaceAll('\\','/').replace(/^\.\//,'');
function local(root:string,value:string):string|undefined{
  if(!value||value.startsWith('!')||/[\0\r\n]/.test(value))return undefined;
  const path=normalize(isAbsolute(value)?relative(root,value):value);
  if(!path||path==='.'||path==='..'||path.startsWith('../')||isAbsolute(path)||/^[A-Za-z]:/.test(path))return undefined;
  return path;
}
const control=(path:string):boolean=>{const first=path.split('/')[0]??'';return first.startsWith('.capivara')||['.git','.project-inputs','node_modules','.venv','venv','.tools','.local','.deps','.vendor','.sdk'].includes(first);};
async function existing(root:string,selectors:readonly string[],providers=false):Promise<string[]>{
  const safe=[...new Set(selectors.map(selector=>local(root,selector)).filter((path):path is string=>Boolean(path&&(providers||!control(path)))))];
  return safe.length?(await sourceFiles(root,safe)).filter(path=>providers||!control(path)).sort():[];
}
function literalPrograms(command:string):string[][]|undefined{
  const parts:string[]=[];let start=0,quote='',escape=false;
  for(let index=0;index<command.length;index++){
    const char=command[index]!;
    if(escape){escape=false;continue;}
    if(char==='\\'&&quote!=="'"){escape=true;continue;}
    if(quote){if(char===quote)quote='';continue;}
    if(char==='"'||char==="'"){quote=char;continue;}
    if(/[<>`$\r\n]/.test(char))return undefined;
    if(char===';'||char==='|'||char==='&'){
      if(char==='&'&&command[index+1]!=='&')return undefined;
      parts.push(command.slice(start,index));if(command[index+1]===char)index++;start=index+1;
    }
  }
  if(quote||escape)return undefined;parts.push(command.slice(start));
  const parsed=parts.filter(part=>part.trim()).map(literalInvocationArguments);
  return parsed.length&&parsed.every((argv):argv is string[]=>Boolean(argv?.length))?parsed:undefined;
}
async function instrumentInputs(options:EnrichVerificationConformanceOptions,owners:WorkUnit[]):Promise<{resolved:boolean;inputs:string[]}>{
  const {workspace,check,brief}=options,root=resolve(workspace),cwd=resolve(root,check.cwd??'.');
  const seed=await existing(root,check.instrument?.sourceInputs??[]);
  // A delivered CLI entrypoint is product code, not a browser/test instrument.
  if(check.kind==='cli'&&brief.modes.includes('cli'))return{resolved:true,inputs:seed};
  const owned=owners.flatMap(task=>task.files),programs:string[][]=[];
  const expand=async(argv:string[],depth:number,seen:Set<string>):Promise<boolean>=>{
    if(depth>8)return false;
    const binary=basename(argv[0]??'').replace(/\.(?:exe|cmd|bat)$/i,'').toLowerCase();
    let index=1;
    if(['npm','pnpm','yarn','bun'].includes(binary)){
      while(['--silent','-s'].includes(argv[index]??''))index++;
      const operation=argv[index],name=operation==='run'||operation==='run-script'?argv[++index]:operation;
      if(name&&!name.startsWith('-')){
        let scripts:Record<string,unknown>|undefined;
        try{scripts=(JSON.parse(await readFile(resolve(cwd,'package.json'),'utf8')) as {scripts?:Record<string,unknown>}).scripts;}catch{/* No manifest script can be resolved. */}
        const source=scripts?.[name];
        if(typeof source==='string'){
          const key=resolve(cwd,'package.json')+':'+name;if(seen.has(key))return false;
          const nested=literalPrograms(source);if(!nested)return false;
          const forwarded=argv.slice(index+1).filter((value,position)=>position!==0||value!=='--');
          const next=new Set(seen);next.add(key);
          for(const command of nested)if(!await expand([...command,...forwarded],depth+1,next))return false;
          return true;
        }
        if(operation==='run'||operation==='run-script'||['test','start','stop','restart'].includes(operation??''))return false;
      }
    }
    programs.push(argv);return true;
  };
  const supplied=check.recipeCandidate?.expandedArgv?.length?[check.recipeCandidate.expandedArgv]:check.args?[[check.command??'',...check.args]]:literalPrograms(check.command??'');
  let resolved=Boolean(supplied?.length);
  for(const argv of supplied??[])if(!await expand(argv,0,new Set()))resolved=false;
  const instrument=new Set(seed);
  for(const argv of programs)for(const argument of argv){
    if(argument.startsWith('-'))continue;
    const candidate=local(root,relative(root,resolve(cwd,argument)));if(!candidate||control(candidate)||(await stat(resolve(root,candidate)).catch(()=>null))?.isFile()!==true)continue;
    const product=check.kind!=='web'&&!check.instrument&&owned.some(scope=>{const selector=normalize(scope).replace(/\/$/,'');return candidate===selector||candidate.startsWith(selector+'/')||matchesGlob(candidate,selector);});
    if(!product)instrument.add(candidate);
  }
  return{resolved,inputs:[...instrument].sort()};
}

/** Coordinator declarations are hypotheses for actual observation. No source
 * path, provider readiness or declaration emitted here creates a passed proof. */
export async function enrichVerificationConformance(options:EnrichVerificationConformanceOptions):Promise<{check:Verification;coverage:ConformanceCandidateCoverage}>{
  const {brief,plan,task,check,operational}=options,workspace=resolve(options.workspace),owners=new Map<string,WorkUnit>();
  const visit=(unit:WorkUnit):void=>{if(owners.has(unit.id))return;owners.set(unit.id,unit);for(const id of unit.dependsOn){const parent=plan.tasks.find(candidate=>candidate.id===id);if(parent)visit(parent);}};visit(task);
  const environment=new Set<string>();
  const provider=(id:string):void=>{if(environment.has(id))return;environment.add(id);plan.environment.find(node=>node.id===id)?.dependsOn.forEach(provider);};
  for(const owner of owners.values())owner.environmentIds.forEach(provider);
  const requirements=new Set([...owners.values()].flatMap(owner=>owner.requirementIds));
  for(const contract of plan.contracts)if([...owners.values()].some(owner=>owner.contractIds.includes(contract.id)))contract.requirementIds.forEach(id=>requirements.add(id));
  for(const node of plan.environment)if(environment.has(node.id)){
    node.requirementIds?.forEach(id=>requirements.add(id));
    for(const requirement of brief.requirements)if(obligationMatchesProvider(requirement,node.identity))requirements.add(requirement.id);
  }
  const obligations=brief.requirements.filter(requirement=>requirement.binding&&requirements.has(requirement.id));
  const supportedSource=(path:string):boolean=>dependencyFamilies([path]).length>0;
  const previous=(options.evidence??[]).filter(evidence=>owners.has(evidence.taskId)||brief.requirements.every(requirement=>task.requirementIds.includes(requirement.id)));
  const declaredArtifacts=[...new Set([...(check.outputs??[]),...(check.conformance?.artifacts??[])])];
  const knownArtifacts=[...declaredArtifacts,...previous.flatMap(evidence=>Object.keys(evidence.provenance?.artifactsAfter??{}))];
  const generatedCode=previous.flatMap(evidence=>(evidence.provenance?.generatedArtifacts??[]).map(artifact=>artifact.path)).filter(supportedSource);
  const selectors=[...(check.inputs??[]),...(check.conformance?.productInputs??[]),...(options.deliveryFiles??[])];
  const sourcePool=[...(await sourceFiles(workspace)).filter(path=>!control(path)&&supportedSource(path)),...(await existing(workspace,selectors)).filter(supportedSource)];
  // Database fixtures, mutable application data and documentation are not code
  // just because an editor or test wrote them. Unknown generated formats need
  // an explicit artifact contract rather than nominal filename inference.
  const inputs=[...new Set([...sourcePool,...await existing(workspace,[...knownArtifacts,...generatedCode])])].sort();
  const ownOutputs=check.level==='build'?verificationOutputs(check).map(output=>local(workspace,output)).filter((path):path is string=>Boolean(path)):[];
  const produces=(path:string):boolean=>ownOutputs.some(scope=>path===scope||matchesGlob(path,scope)||path.startsWith(scope.replace(/\/$/,'')+'/'));
  const instrument=await instrumentInputs(options,[...owners.values()]),productInputs=inputs.filter(path=>!instrument.inputs.includes(path)&&!produces(path));
  const coverage:ConformanceCandidateCoverage={schema:'capivara/conformance-candidates/1',taskId:task.id,sourceTaskIds:[...owners.keys()].sort(),environmentIds:[...environment].sort(),inputs:productInputs,...(ownOutputs.length?{excludedOutputs:ownOutputs}:{}),instrument,requirements:[]};
  const candidates:Claim[]=[];
  for(const requirement of obligations){
    const bindings=Object.entries(operational.bindings).filter(([,binding])=>binding.ready===true&&obligationMatchesProvider(requirement,binding)).sort(([left],[right])=>left.localeCompare(right));
    const providers:ConformanceCandidateCoverage['requirements'][number]['providers']=[];
    if(instrument.resolved&&productInputs.length)for(const [,binding] of bindings){
      const providerInputs=await existing(workspace,binding.inputs??[],true);
      const claim:Claim={requirementId:requirement.id,capability:binding.capability,kind:binding.kind,provider:binding.provider,productInputs:[...productInputs],...(providerInputs.length?{providerInputs}:{}),...(declaredArtifacts.length?{artifacts:declaredArtifacts}:{})};
      if(!candidates.some(previous=>JSON.stringify(previous)===JSON.stringify(claim)))candidates.push(claim);
      providers.push({capability:binding.capability,kind:binding.kind,provider:binding.provider,...(binding.fingerprint?{fingerprint:binding.fingerprint}:{}),productInputs:[...productInputs]});
    }
    coverage.requirements.push({requirementId:requirement.id,status:providers.length?'candidate':'unavailable',providers});
  }
  if(!candidates.length)return{check,coverage};
  // A declared producer cannot regain its own generated outputs through an
  // inherited directory read-set or a previous singular conformance claim.
  // Consumers keep those exact files as inputs in their separate observation.
  const withoutOutputs=(selectors:readonly string[]):string[]=>[...new Set([...selectors.filter(selector=>selector.startsWith('!')||!produces(normalize(selector))),...ownOutputs.map(output=>'!'+output)])];
  return{check:{...check,...(ownOutputs.length?{inputs:withoutOutputs(check.inputs??task.inputs??task.files),...(check.conformance?{conformance:{...check.conformance,productInputs:withoutOutputs(check.conformance.productInputs)}}:{})}:{}),conformanceClaims:candidates,conformanceInstrumentInputs:instrument.inputs},coverage};
}
