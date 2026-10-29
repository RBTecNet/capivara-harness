import { readFile, readdir } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { randomUUID } from 'node:crypto';
import type { DevelopmentPlan, ProductBrief, Verification, VerificationAssertion, WorkUnit } from '../domain/types.js';
import { normalizeVerificationAssertion, verificationAssertionStatus } from '../domain/assertions.js';
import { verificationConformanceClaims } from '../domain/verifications.js';
export { normalizeVerificationAssertion, verificationAssertionStatus } from '../domain/assertions.js';
import { allowedCapabilities, inferredCapabilities } from '../domain/authority.js';
import { taskReferences } from '../domain/material.js';
import type { CommandRequest, CommandResult, TerminalRequest } from '../runtime/types.js';
import { digest, inputSnapshot } from './files.js';
import { applyOperationalEnvironment, recipeCwd, executionConstraints, type CommandExecutor, type OperationalEnvironment, verificationOperationalRevision } from './environment.js';
import type { SelectedVerification, VerificationEvidence, VerificationObservation } from './types.js';
import { beginConformanceObservation, finishConformanceObservation } from './conformance.js';
import { classifyReviewFailure, type ReviewFailureContext, type ReviewFailureKind } from './review.js';
import { declaredTaskInputs, resolveVerificationInputs } from './dependencies.js';
import { emitProgress, type ProgressEvent } from '../telemetry/progress.js';
import { PROVIDER_OBSERVATION_PROTOCOL, runtimeObservationProtocol, startProviderObservation, type ModuleProviderWitness, type ProviderConsumption, type ProviderProcessWitness, type ProviderWitness, type ProviderWrite } from '../runtime/provider-observation.js';
import { checkInlineNodeSyntax, inlineNodeSyntaxCandidate } from './inline-verification.js';
import { InvocationDeclarationError, literalInvocationArguments, normalizeCommandInvocation } from '../runtime/invocation.js';
import { BROWSER_OBSERVATION_CONTRACT, browserInteractionAttempted, browserInteractionsObserved, startBrowserObservation } from '../runtime/browser-observation.js';

export function inlineVerificationSyntaxRequired(check:Verification):boolean{
  if(check.kind==='cli'||check.kind==='tui'||!check.command)return false;
  if(!check.args)return inlineNodeSyntaxCandidate(check.command);
  const literal=literalInvocationArguments(check.command);
  const duplicated=literal&&literal.length>1&&literal.length===check.args.length+1&&check.args.every((arg,index)=>arg===literal[index+1]);
  return inlineNodeSyntaxCandidate(duplicated?literal:[check.command,...check.args]);
}

/** A platform does not identify a verification interface. Technical process or
 * API checks can support a browser application without interacting with a page.
 * An explicitly required browser capability still needs its actual protocol. */
function ambiguousBrowserCommand(check:Verification):boolean{return check.kind==='command'&&verificationLevel(check)==='behavior'&&check.requiredCapabilities.includes('browser');}

/** Shell and PTY observations do not certify a native window. This contract
 * stays explicitly unsupported until a coordinator-owned adapter can witness
 * the application window, input and changed native state. */
export const DESKTOP_OBSERVATION_CONTRACT={schema:'capivara/native-interaction/1',interface:'desktop',supportedAdapters:[],requiredObservations:['application-owned native window','actual native input','observed changed native state'],commandOutputIsInteraction:false,buildIsInteraction:false} as const;

/** A model-supplied interface label cannot promote command output into an
 * observed browser interaction. Legacy receipts remain auditable but need a
 * fresh compatible instrument before they can certify web behavior. */
export function interfaceEvidenceUsable(check:Verification,evidence:VerificationEvidence):boolean{
  if(check.kind==='desktop')return false;
  if(check.kind!=='web'||verificationLevel(check)!=='behavior')return true;
  try{return evidence.kind==='web'&&evidence.browserObservation?.schema==='capivara/browser-interaction/1'&&Array.isArray(evidence.browserObservation.witnesses)&&browserInteractionsObserved(evidence.browserObservation.witnesses);}
  catch{return false;}
}

export function browserObservationSummary(observation:NonNullable<VerificationEvidence['browserObservation']>):string{
  const witnesses=observation.witnesses;
  const bounded=(values:string[],limit:number):string[]=>[...new Set(values)].slice(0,limit);
  const location=(value:string):string=>{try{const url=new URL(value);url.username='';url.password='';url.search='';url.hash='';return url.href.slice(0,240);}catch{return'[unresolved location]';}};
  return JSON.stringify({schema:observation.schema,counts:{launched:witnesses.filter(item=>item.phase==='launch'&&item.status==='passed').length,navigated:witnesses.filter(item=>item.phase==='navigation'&&item.status==='passed').length,dom:witnesses.filter(item=>item.phase==='dom'&&item.status==='passed').length,failed:witnesses.filter(item=>item.status==='failed').length},navigation:bounded(witnesses.filter(item=>item.phase==='navigation'&&item.status==='passed'&&item.url).map(item=>location(item.url!)),4),operations:bounded(witnesses.filter(item=>item.phase==='dom'&&item.status==='passed').map(item=>item.operation.slice(0,100)),12),failedOperations:bounded(witnesses.filter(item=>item.status==='failed').map(item=>`${item.phase}:${item.operation}`.slice(0,120)),4)});
}

/** Wrong instruments are replaced; their failure never becomes an invented product requirement. */
export function selectVerifications(brief: ProductBrief, task: WorkUnit): SelectedVerification[] {
  const result: SelectedVerification[]=[];
  for (const check of task.checks) {
    const capabilities=[...new Set([...check.requiredCapabilities,...inferredCapabilities(check.command??'')])];
    const wrongMode=check.kind==='web'&&!brief.modes.includes('web') || check.kind==='desktop'&&!brief.modes.includes('desktop') || check.kind==='tui'&&!brief.modes.includes('tui');
    if (wrongMode || !allowedCapabilities(brief,capabilities)) {
      const {command:_command,args:_args,...compatible}=check;
      result.push({check:{...compatible,id:`${check.id}-compatible`,kind:'command',requiredCapabilities:[]},replaced:`${check.id}: ${check.kind} requires capabilities outside this product. Select a compatible proof.`});
    } else if(ambiguousBrowserCommand(check)){
      const {command:_command,args:_args,...pending}=check;
      result.push({check:{...pending,kind:'web',requiredCapabilities:[...new Set([...capabilities,'browser'])]},requiredKind:'web',protocolIssue:{code:'ambiguous-browser-command',requiredKind:'web',original:structuredClone(check)},replaced:`${check.id}: browser behavior is declared through a generic command protocol. Preserve the original criterion and materialize an actual web interaction instrument; starting a process or interpreting stdout cannot prove this target.`});
    }else result.push({check:{...check,requiredCapabilities:capabilities}});
  }
  return result;
}
export async function derivedChecks(workspace: string, task: WorkUnit): Promise<Verification[]> {
  const scripts=await readFile(join(workspace,'package.json'),'utf8').then(text=>(JSON.parse(text) as {scripts?:Record<string,string>}).scripts??{}).catch(()=>({} as Record<string,string>));
  const common={requirementIds:task.requirementIds,requiredCapabilities:[]};
  if(scripts.build)return [{...common,id:`${task.id}-build`,kind:'command',command:'npm run build',level:'build'}];
  if(scripts.typecheck)return [{...common,id:`${task.id}-typecheck`,kind:'command',command:'npm run typecheck',level:'syntax'}];
  const checks: Verification[]=[];
  for(const file of task.files) {
    if(/\.(?:cjs|mjs|js)$/.test(file))checks.push({...common,id:`${task.id}-syntax-${digest(file).slice(0,8)}`,kind:'command',command:'node',args:['--check',file],level:'syntax'});
    if(/\.py$/.test(file))checks.push({...common,id:`${task.id}-syntax-${digest(file).slice(0,8)}`,kind:'command',command:process.platform==='win32'?'py':'python3',args:['-m','py_compile',file],level:'syntax'});
  }
  if(checks.length)return checks;
  const files:string[]=await readdir(workspace,{encoding:'utf8'}).catch(()=>[] as string[]);
  if(files.includes('Cargo.toml'))return[{...common,id:`${task.id}-compile`,kind:'command',command:'cargo',args:['build','--release'],level:'build'}];
  if(files.includes('go.mod'))return[{...common,id:`${task.id}-compile`,kind:'command',command:'go',args:['build','./...'],level:'build'}];
  if(files.some(name=>/\.(?:csproj|fsproj|sln|slnx)$/.test(name)))return[{...common,id:`${task.id}-compile`,kind:'command',command:'dotnet',args:['build','--no-restore','--configuration','Release'],level:'build'}];
  return [];
}
export function taskInputs(plan:DevelopmentPlan,task:WorkUnit):string[]{return declaredTaskInputs(plan,task);}
export interface VerificationIdentity { inputHash:string; observationHash:string; inputs:string[]; environmentRevision?:string; }
/** One resolved graph and one content snapshot identify both execution and its
 * interpretation. Predicates may change without manufacturing a new execution. */
export async function verificationIdentity(workspace:string,plan:DevelopmentPlan,task:WorkUnit,check:Verification,brief?:ProductBrief,operational?:OperationalEnvironment,resolvedInputs?:readonly string[]):Promise<VerificationIdentity>{
  const inputs=resolvedInputs?[...resolvedInputs]:await resolveVerificationInputs(workspace,plan,task,check);
  const snapshot=await inputSnapshot(workspace,inputs);
  const claims=verificationConformanceClaims(check),requirementsForProof=[...(check.requirementIds.length?check.requirementIds:task.requirementIds),...claims.map(claim=>claim.requirementId)];
  const requirements=brief?.requirements.filter(requirement=>requirementsForProof.includes(requirement.id))
    .map(({bindingAuthority:_classification,bindingTransformations:_interpretations,...requirement})=>requirement);
  const contracts=plan.contracts.filter(contract=>task.contractIds.includes(contract.id));
  const environmentRevision=operational?verificationOperationalRevision(operational,inputs,check):undefined;
  const moduleClaim=claims.some(claim=>['sdk','library','driver'].includes(claim.kind)),runtimeClaim=claims.some(claim=>claim.kind==='runtime');
  const consumptionNeeded=moduleClaim||inputs.length>0&&(Object.values(operational?.bindings??{}).some(binding=>['sdk','library','driver'].includes(binding.kind))||plan.environment.some(node=>['sdk','library','driver'].includes(node.identity?.kind??node.kind)));
  const runtimeProtocol=runtimeClaim?(operational?await runtimeObservationProtocol(workspace,check,operational):PROVIDER_OBSERVATION_PROTOCOL.runtime):undefined;
  const providerObservation=consumptionNeeded?{consumptions:PROVIDER_OBSERVATION_PROTOCOL.consumptions,processes:PROVIDER_OBSERVATION_PROTOCOL.processes,...(moduleClaim?{modules:PROVIDER_OBSERVATION_PROTOCOL.modules}:{}),...(runtimeClaim?{runtime:runtimeProtocol}:{}),...(verificationLevel(check)==='build'&&check.conformanceClaims?.length?{writes:PROVIDER_OBSERVATION_PROTOCOL.writes}:{})}:runtimeProtocol;
  let invocationProtocol:string|undefined;
  if(check.command&&check.args&&(literalInvocationArguments(check.command)?.length??0)>1){
    try{if((await normalizeCommandInvocation({cwd:recipeCwd(workspace,check.cwd),command:[check.command,...check.args],environment:operational?.env??{}})).transformation)invocationProtocol='literal-argv/1';}
    catch(error){if(error instanceof InvocationDeclarationError)invocationProtocol='literal-argv/1';else throw error;}
  }
  const descriptor={verifier:verificationLevel(check)==='behavior'?'capivara-verification/5':'capivara-verification/4',providerObservation,invocationProtocol,browserProtocol:check.kind==='web'&&verificationLevel(check)==='behavior'?'observed-page-interaction/1':ambiguousBrowserCommand(check)?'declared-interface/1':undefined,nativeProtocol:check.kind==='desktop'?'native-observer-unavailable/1':undefined,assertionContract:verificationAssertionStatus(check).status==='invalid'?'strict-invalid/1':undefined,check,requirements,contracts,constraints:brief?.constraints,environment:plan.environment.filter(node=>task.environmentIds.includes(node.id)),operational:environmentRevision,platform:process.platform,node:process.version,references:brief?taskReferences(brief,task):[]};
  const fingerprint=(description:unknown):string=>digest(JSON.stringify({description:JSON.stringify(description),inputs:snapshot}));
  const {expected:_criterion,assertion:_assertion,assertionIssue:_assertionIssue,...execution}=check;
  return{inputHash:fingerprint(descriptor),observationHash:fingerprint({...descriptor,assertionContract:undefined,check:execution}),inputs,...(environmentRevision?{environmentRevision}:{})};
}
export async function checkInputHash(workspace:string,plan:DevelopmentPlan,task:WorkUnit,check:Verification,brief?:ProductBrief,operational?:OperationalEnvironment,resolvedInputs?:readonly string[]):Promise<string>{
  return(await verificationIdentity(workspace,plan,task,check,brief,operational,resolvedInputs)).inputHash;
}
export type VerificationFailureClass=ReviewFailureKind;
function invocationArgs(check:Verification):{binary:string;args:string[]}|undefined{
  if(check.args)return{binary:basename(check.command??'').replace(/\.(?:exe|cmd|bat)$/i,'').toLowerCase(),args:check.args};
  const tokens:string[]=[];let token='',quote='',escaped=false,started=false;
  for(const char of check.command??''){
    if(escaped){token+=char;escaped=false;started=true;continue;}
    if(char==='\\'&&quote!=="'"){escaped=true;continue;}
    if(quote){if(char===quote)quote='';else token+=char;started=true;continue;}
    if(char==='"'||char==="'"){quote=char;started=true;continue;}
    if(/[;&|<>\n\r`]/.test(char))return undefined;
    if(/\s/.test(char)){if(started){tokens.push(token);token='';started=false;}continue;}
    token+=char;started=true;
  }
  if(quote||escaped)return undefined;if(started)tokens.push(token);if(!tokens.length)return undefined;
  return{binary:basename(tokens[0]!).replace(/\.(?:exe|cmd|bat)$/i,'').toLowerCase(),args:tokens.slice(1)};
}
export function verificationLevel(check:Verification):'syntax'|'build'|'behavior'{
  const invocation=invocationArgs(check);
  if(invocation){
    const {binary,args}=invocation;
    if(binary==='node'){
      for(let index=0;index<args.length;index++){
        const arg=args[index]!;
        if(arg==='--'||!arg.startsWith('-'))break;
        if(['-e','--eval','-p','--print'].includes(arg)||/^(?:--eval|--print)=/.test(arg))break;
        if(arg==='--check'||arg==='-c')return 'syntax';
        if(['-r','--require','--import','--loader','--experimental-loader','--conditions','-C'].includes(arg))index++;
      }
    }
    if(binary==='tsc'&&args.includes('--noEmit'))return 'syntax';
    if(/^python[\d.]*$/.test(binary)||binary==='py'){const module=args.indexOf('-m');if(module>=0&&['py_compile','compileall'].includes(args[module+1]??''))return 'syntax';}
    if(binary==='cargo'&&args[0]==='check')return 'syntax';
  }
  // Script names, source text and arbitrary user flags do not establish evidence strength.
  return check.level??'behavior';
}
export function classifyVerificationFailure(result:CommandResult,context:ReviewFailureContext={purpose:'verification',writeScope:'isolated-workspace'}):VerificationFailureClass{
  if(result.issue?.kind==='tool'||result.issue?.kind==='constraint')return 'instrument';
  if(result.exitCode===127)return 'environment';
  return classifyReviewFailure(result,context)??'product';
}
export function hostTarget(): 'windows'|'macos'|'linux' { return process.platform==='win32'?'windows':process.platform==='darwin'?'macos':'linux'; }
export function nativeTargetAvailable(check:Verification):boolean { return !check.target || check.target==='portable' || check.target===hostTarget(); }
/** Preserve intentional error exits from a typed recipe or an existing human criterion. */
export function inferredExpectedExit(expected:string|undefined):number|undefined{
  if(!expected)return undefined;
  const normalized=expected.normalize('NFD').replace(/\p{Diacritic}/gu,'').toLowerCase();
  const direct=normalized.match(/^exit:\s*(-?\d+)$/)?.[1];
  if(direct!==undefined)return Number(direct);
  const codes=[...normalized.matchAll(/\b(?:exit\s+(?:code|status)|(?:codigo|status)\s+(?:de\s+)?(?:saida|retorno))\s*(?:(?:esperado|expected|is|e|eh)\s*)?[:=]?\s*(-?\d+)\b/g)].map(match=>Number(match[1]));
  const distinct=[...new Set(codes)];return distinct.length===1?distinct[0]:undefined;
}
function terminalInteraction(check:Verification):boolean{
  let ready=false,input=false;
  for(const step of check.steps??[]){
    if(step.input){if(!ready)return false;input=true;}
    if(step.waitFor){if(input)return true;ready=true;}
  }
  return false;
}
function preparationOnly(check:Verification):boolean{
  if(verificationLevel(check)!=='behavior')return true;
  const invocation=invocationArgs(check);if(!invocation)return false;
  const {binary,args}=invocation;
  if(['tasklist','pgrep','ps'].includes(binary))return true;
  if(binary==='cargo'&&['build','check','fetch'].includes(args[0]??''))return true;
  if(binary==='go'&&['build','mod'].includes(args[0]??''))return true;
  if(binary==='dotnet'&&['build','restore','publish'].includes(args[0]??''))return true;
  return ['npm','pnpm','yarn','bun'].includes(binary)&&['ci','install'].includes(args[0]??'');
}
type AssertionResult = Pick<CommandResult,'stdout'|'stderr'|'exitCode'>;
export interface EvaluatedVerificationAssertion {
  status: 'passed' | 'failed' | 'missing' | 'invalid';
  passed: boolean | null;
  detail: string;
  instrument: boolean;
  assertion?: VerificationAssertion;
}
function evaluateAssertion(assertion:VerificationAssertion,result:AssertionResult):{passed:boolean;detail:string}{
  const output=(source:'stdout'|'stderr'|'output'|undefined):string=>source==='stderr'?result.stderr:source==='output'?`${result.stdout}\n${result.stderr}`:result.stdout;
  if(assertion.type==='contains')return{passed:output(assertion.source).includes(assertion.value),detail:`${assertion.source??'stdout'} contains ${JSON.stringify(assertion.value)}`};
  if(assertion.type==='regex')return{passed:new RegExp(assertion.pattern,assertion.flags??'m').test(output(assertion.source)),detail:`${assertion.source??'stdout'} matches ${JSON.stringify(assertion.pattern)}`};
  if(assertion.type==='empty')return{passed:output(assertion.source).trim()==='',detail:`${assertion.source??'stdout'} is empty`};
  if(assertion.type==='exit')return{passed:result.exitCode===assertion.value,detail:`exit code equals ${assertion.value}`};
  if(assertion.type==='all'||assertion.type==='any'){
    const parts=assertion.assertions.map(item=>evaluateAssertion(item,result));
    return{passed:assertion.type==='all'?parts.every(item=>item.passed):parts.some(item=>item.passed),detail:`${assertion.type}: ${parts.map(item=>`${item.passed?'passed':'failed'} (${item.detail})`).join('; ')}`};
  }
  let value:unknown;
  try{value=JSON.parse(output(assertion.source).trim());}catch{return{passed:false,detail:`${assertion.source??'stdout'} is not valid JSON`};}
  let exists=true;
  for(const key of assertion.path??[]){
    if(value===null||typeof value!=='object'||!Object.prototype.hasOwnProperty.call(value,key)){exists=false;value=undefined;break;}
    value=(value as Record<string|number,unknown>)[key];
  }
  const equality=Object.prototype.hasOwnProperty.call(assertion,'equals');
  const passed=(assertion.exists===undefined||exists===assertion.exists)&&(!equality||exists&&isDeepStrictEqual(value,assertion.equals));
  return{passed,detail:`JSON path ${JSON.stringify(assertion.path??[])}${assertion.exists!==undefined?` exists=${assertion.exists}`:''}${equality?` equals ${JSON.stringify(assertion.equals)}`:''}; observed=${exists?JSON.stringify(value):'missing'}`};
}
export function evaluateVerificationAssertion(check:Pick<Verification,'assertion'|'assertionIssue'|'expected'>,result:AssertionResult):EvaluatedVerificationAssertion{
  const selected=verificationAssertionStatus(check);
  if(!selected.assertion)return{status:selected.status==='invalid'?'invalid':'missing',passed:null,detail:selected.issues.join(' '),instrument:selected.status==='invalid'};
  const evaluated=evaluateAssertion(selected.assertion,result);
  return{...evaluated,status:evaluated.passed?'passed':'failed',instrument:false,assertion:selected.assertion};
}
/** JSON transport for assertion recovery; raw output remains distinct from the criterion. */
export function verificationObservation(result:CommandResult):VerificationObservation{
  return{command:result.command,stdout:result.stdout,stderr:result.stderr,exitCode:result.exitCode,cancelled:result.cancelled,timedOut:result.timedOut,terminal:result.terminal===true,...(result.issue?{issue:structuredClone(result.issue)}:{}),...(result.invocationTransformation?{invocationTransformation:structuredClone(result.invocationTransformation)}:{})};
}
/** Kept for callers of the explicit legacy assertion syntax. */
export function expectedResult(expected:string|undefined,result:CommandResult):EvaluatedVerificationAssertion{return evaluateVerificationAssertion(expected===undefined?{}:{expected},result);}
export interface VerificationOutcome {
  evidence:VerificationEvidence & {level:'syntax'|'build'|'behavior';classification?:VerificationFailureClass;inputs:string[];environmentRevision?:string};
  result:CommandResult|null;
  needsInstrument:boolean;
  classification:VerificationFailureClass|null;
  assertionPending?:boolean;
  assertionStatus?:VerificationEvidence['assertionStatus'];
}
export interface RecordedObservationOptions { instrumentClassification?: { reference:string; reason:string }; }
/** Reinterpret an unchanged successful execution, never a different command or
 * an unclassified product failure. The original evidence and its transcript stay
 * intact; a separate proof explicitly links to the recorded observation. */
export function evaluateRecordedObservation(check:Verification,recorded:VerificationEvidence,identity:VerificationIdentity,options:RecordedObservationOptions={}):VerificationOutcome|undefined{
  if(!interfaceEvidenceUsable(check,recorded))return undefined;
  const observation=recorded.observation;
  if(!observation||!recorded.observationHash||recorded.observationHash!==identity.observationHash||recorded.inputHash===identity.inputHash)return undefined;
  if(observation.exitCode!==0||observation.issue||observation.cancelled||observation.timedOut)return undefined;
  const independent=options.instrumentClassification??recorded.instrumentClassification;
  const classified=independent&&independent.reference.trim()&&independent.reason.trim()?independent:undefined;
  if(!recorded.passed&&recorded.classification!=='instrument'&&!classified)return undefined;
  const assertion=evaluateVerificationAssertion(check,observation);
  const expectedExit=check.expectedExitCode??(assertion.assertion?.type==='exit'?assertion.assertion.value:undefined)??0;
  if(expectedExit!==0)return undefined;
  if(check.kind==='tui'&&(!observation.terminal||!terminalInteraction(check)))return undefined;
  const level=verificationLevel(check);
  const passed=!assertion.instrument&&(level==='behavior'?assertion.passed===true:assertion.passed!==false)&&(check.kind!=='tui'||observation.terminal);
  const classification:VerificationFailureClass|null=passed?null:assertion.instrument||assertion.passed===null?'instrument':'product';
  const observedAt=recorded.observedAt??recorded.checkedAt;
  const evidence:VerificationOutcome['evidence']={...structuredClone(recorded),id:randomUUID(),checkId:check.id,inputHash:identity.inputHash,observationHash:identity.observationHash,inputs:[...identity.inputs],kind:check.kind,target:check.target??hostTarget(),level,passed,checkedAt:new Date().toISOString(),observedAt,reinterpretedFrom:recorded.id,assertionStatus:assertion.status==='passed'?'ready':assertion.status,output:`${recorded.output}\nRecorded observation: ${recorded.id} at ${observedAt}. Command was not executed again.\nReinterpreted assertion: ${assertion.detail}`,...(identity.environmentRevision?{environmentRevision:identity.environmentRevision}:{}),...(classified?{instrumentClassification:structuredClone(classified)}:{})};
  delete evidence.classification;if(classification)evidence.classification=classification;
  return{evidence,result:null,classification,needsInstrument:classification!==null&&classification!=='product',assertionStatus:evidence.assertionStatus,...(classification==='instrument'&&(evidence.assertionStatus==='missing'||evidence.assertionStatus==='invalid')?{assertionPending:true}:{})};
}
export async function runVerification(workspace:string,brief:ProductBrief,task:WorkUnit,plan:DevelopmentPlan,check:Verification,execute:CommandExecutor,terminal:(request:TerminalRequest)=>Promise<CommandResult>,options:{signal?:AbortSignal;allowSystemInstall?:boolean;onEvent?:(event:ProgressEvent)=>void;operational?:OperationalEnvironment;instrument?:ReviewFailureContext;preparationFailure?:string;identity?:VerificationIdentity}={}):Promise<VerificationOutcome>{
  const progress={id:`verification:${task.id}:${check.id}`,label:`${task.id}: ${check.id}`,stage:'build'};
  const finish=(result:CommandResult|null,classification:VerificationFailureClass|null):VerificationOutcome=>{
    if(evidence.passed)delete evidence.instrumentSyntaxChecked;
    if(classification)evidence.classification=classification;
    emitProgress(options.onEvent,{...progress,status:evidence.passed?'complete':'waiting'});
    return{evidence,result,classification,needsInstrument:classification!==null&&classification!=='product',...(evidence.assertionStatus?{assertionStatus:evidence.assertionStatus,assertionPending:classification==='instrument'&&(evidence.assertionStatus==='missing'||evidence.assertionStatus==='invalid')}:{})};
  };
  emitProgress(options.onEvent,{...progress,status:'running'});
  const identity=options.identity??await verificationIdentity(workspace,plan,task,check,brief,options.operational);
  const {inputs,inputHash:hash}=identity;
  const evidence:VerificationOutcome['evidence']={id:randomUUID(),taskId:task.id,checkId:check.id,inputHash:hash,observationHash:identity.observationHash,passed:false,command:check.command??'',output:'',terminal:false,checkedAt:new Date().toISOString(),kind:check.kind,target:check.target??hostTarget(),level:verificationLevel(check),inputs,...(identity.environmentRevision?{environmentRevision:identity.environmentRevision}:{})};
  if(ambiguousBrowserCommand(check)){
    evidence.output=`The command was not executed: browser behavior has no compatible declared web interaction protocol. Preserve the product and recover its actual browser instrument. Original invocation: ${JSON.stringify({command:check.command,args:check.args,target:check.target,requiredCapabilities:check.requiredCapabilities})}`;
    return finish(null,'instrument');
  }
  if(options.preparationFailure){evidence.output=`The product command was not executed because its concrete runtime resource is unavailable.\n${options.preparationFailure}`;return finish(null,'environment');}
  if(task.requirementIds.length&&!inputs.length&&check.inputs===undefined&&task.inputs===undefined&&!task.files.length){
    evidence.output='The product proof has no declared read set. Declare its source/configuration/generated inputs, or explicitly declare an empty input set for a genuinely input-free operation. Unknown inputs cannot produce a reusable product proof.';
    return finish(null,'instrument');
  }
  if(!check.command){evidence.output='No executable recipe exists for this proof. Recover an instrument for the requested behavior.';return finish(null,'instrument');}
  if(check.kind==='desktop'&&!nativeTargetAvailable(check)){evidence.output='The declared target requires a compatible native runner. Independent work can continue, but this interaction is not proved.';return finish(null,'environment');}
  if(check.kind==='desktop'){
    evidence.output=`The native desktop interaction was NOT evaluated: the current executor has command and terminal instruments but no trusted native-window observation adapter. A printed report, process exit or successful build cannot certify native interaction. Preserve independent source and mechanical proofs; desktop acceptance remains unresolved.\nInterface observation contract: ${JSON.stringify(DESKTOP_OBSERVATION_CONTRACT)}`;
    return finish(null,'instrument');
  }
  if(check.kind==='tui'&&(!terminalInteraction(check)||!check.expected&&!check.assertion)){evidence.output='Interactive terminal proof needs an observed ready screen, input and a newly observed state. Recover the recipe without changing the product.';return finish(null,'instrument');}
  if(['desktop','web'].includes(check.kind)&&preparationOnly(check)){evidence.output='Compilation, installation or process status does not exercise application interaction.';return finish(null,'instrument');}
  let request:CommandRequest={cwd:recipeCwd(workspace,check.cwd),command:check.args?[check.command,...check.args]:check.command,constraints:executionConstraints(brief,options.allowSystemInstall),capabilities:check.requiredCapabilities,inputs,...(check.kind!=='tui'&&check.input?{input:check.input.join('')}:{}),...(check.timeoutMs?{timeoutMs:check.timeoutMs}:{}),...(options.signal?{signal:options.signal}:{})};
  let invocationTransformation:CommandResult['invocationTransformation'];
  if(typeof request.command!=='string'){
    try{
      const normalized=await normalizeCommandInvocation({...request,environment:options.operational?.env??{}});
      if(normalized.transformation){request.command=[normalized.binary,...normalized.args];invocationTransformation=normalized.transformation;}
    }catch(error){
      if(!(error instanceof InvocationDeclarationError))throw error;
      evidence.output=`The product was NOT executed. Its verification invocation has conflicting or invalid executable/argv declarations. Recover the instrument without editing the product.\n${error.message}`;
      return finish(null,'instrument');
    }
  }
  request=applyOperationalEnvironment(request,options.operational);
  if(check.kind!=='cli'&&check.kind!=='tui'&&inlineNodeSyntaxCandidate(request.command)){
    const syntax=await checkInlineNodeSyntax(request,execute,options.operational?.revision);
    if(syntax)evidence.instrumentSyntaxChecked={protocol:'inline-node-syntax/1',identity:syntax.identity,passed:syntax.result.exitCode===0&&!syntax.result.issue&&!syntax.result.cancelled&&!syntax.result.timedOut};
    if(syntax&&(syntax.result.exitCode!==0||syntax.result.issue||syntax.result.cancelled||syntax.result.timedOut)){
      evidence.output=`The product was NOT executed. The inline verification program failed its separate Node syntax probe; recover the instrument without editing product code.\nSyntax probe identity: ${syntax.identity}\nSyntax probe command: ${syntax.result.command}\nExit code: ${syntax.result.exitCode}\nSTDOUT:\n${syntax.result.stdout}\nSTDERR:\n${syntax.result.stderr}`;
      return finish(null,'instrument');
    }
  }
  const observedCheck={...check,inputs};
  const observation=await beginConformanceObservation(workspace,observedCheck,typeof request.command==='string'?request.command:[...request.command],request.cwd);
  const providerObservation=options.operational?await startProviderObservation(workspace,observedCheck,{...options.operational,env:{...options.operational.env,...request.environment}}):undefined;
  if(providerObservation?.enabled)request.environment={...request.environment,...providerObservation.environment};
  let browserObservation:Awaited<ReturnType<typeof startBrowserObservation>>|undefined;
  try{if(check.kind==='web'&&evidence.level==='behavior')browserObservation=await startBrowserObservation(workspace,request.environment);}
  catch(error){
    try{await providerObservation?.cleanup();}catch{/* Both instrument failures are recoverable; no product claim was executed. */}
    evidence.output=`Browser observation could not be prepared: ${error instanceof Error?error.message:String(error)}. Product behavior was not evaluated.\nInterface observation contract: ${JSON.stringify(BROWSER_OBSERVATION_CONTRACT)}`;
    return finish(null,'instrument');
  }
  if(browserObservation)request.environment={...request.environment,...browserObservation.environment};
  let result:CommandResult,witnesses:ProviderWitness[]=[],moduleWitnesses:ModuleProviderWitness[]=[],consumptions:ProviderConsumption[]=[],processes:ProviderProcessWitness[]=[],writes:ProviderWrite[]=[];
  try{result=check.kind==='tui'?await terminal({...request,steps:check.steps??[],closeInput:check.closeInput??'\u0003'}):await execute(request);}
  finally{if(providerObservation){
    try{witnesses=await providerObservation.finish();moduleWitnesses=await providerObservation.finishModules?.()??[];consumptions=await providerObservation.finishConsumptions?.()??[];processes=await providerObservation.finishProcesses?.()??[];writes=await providerObservation.finishWrites?.()??[];}
    catch(error){providerObservation.diagnostics.push(`Provider observation could not be read: ${error instanceof Error?error.message:String(error)}`);}
    finally{try{await providerObservation.cleanup();}catch(error){providerObservation.diagnostics.push(`Provider observation cleanup failed: ${error instanceof Error?error.message:String(error)}`);}}
  }
  if(browserObservation){
    let browserWitnesses:Awaited<ReturnType<typeof browserObservation.finish>>=[];
    try{browserWitnesses=await browserObservation.finish();}
    catch(error){browserObservation.diagnostics.push(`Browser observation could not be read: ${error instanceof Error?error.message:String(error)}`);}
    finally{try{await browserObservation.cleanup();}catch(error){browserObservation.diagnostics.push(`Browser observation cleanup failed: ${error instanceof Error?error.message:String(error)}`);}}
    evidence.browserObservation={schema:'capivara/browser-interaction/1',witnesses:browserWitnesses,diagnostics:[...browserObservation.diagnostics]};
  }}
  if(invocationTransformation)result.invocationTransformation=invocationTransformation;
  evidence.provenance=await finishConformanceObservation(observation,check,result);
  if(witnesses.length)evidence.provenance.runtimeWitnesses=witnesses;
  if(moduleWitnesses.length)evidence.provenance.moduleWitnesses=moduleWitnesses;
  if(consumptions.length)evidence.provenance.consumptions=consumptions;
  if(processes.length)evidence.provenance.processes=processes;
  if(writes.length)evidence.provenance.generatedArtifacts=writes;
  if(providerObservation){
    evidence.provenance.runtimeObservation={enabled:providerObservation.enabled,...(providerObservation.reason?{reason:providerObservation.reason}:{}),diagnostics:[...providerObservation.diagnostics]};
    if(providerObservation.runtimeProvider)evidence.provenance.runtimeProvider=structuredClone(providerObservation.runtimeProvider);
    if(providerObservation.runtimeProviders)evidence.provenance.runtimeProviders=structuredClone(providerObservation.runtimeProviders);
    if(providerObservation.moduleProviders)evidence.provenance.moduleProviders=structuredClone(providerObservation.moduleProviders);
  }
  evidence.observation=verificationObservation(result);
  evidence.observedAt=new Date().toISOString();
  evidence.command=result.command;evidence.terminal=result.terminal===true;
  evidence.output=`Command: ${result.command}\nExit code: ${result.exitCode}${result.timedOut?' (timed out)':''}${result.cancelled?' (cancelled)':''}\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`;
  if(result.issue)evidence.output+=`\nRuntime issue (${result.issue.kind}): ${result.issue.message}`;
  if(evidence.browserObservation)evidence.output+=`\nObserved browser interface: ${browserObservationSummary(evidence.browserObservation)}`;
  const assertion=evaluateVerificationAssertion(check,result);
  evidence.assertionStatus=assertion.status==='passed'?'ready':assertion.status;
  const expectedExit=check.expectedExitCode??(assertion.assertion?.type==='exit'?assertion.assertion.value:undefined)??0;
  const terminalClosed=check.kind==='tui'&&result.terminal===true&&result.exitCode===130&&expectedExit===0&&assertion.passed===true;
  evidence.output+=`\nEvidence level: ${evidence.level}\nExpected exit code: ${expectedExit}\nAssertion: ${assertion.detail}`;
  const commandOkay=(result.exitCode===expectedExit||terminalClosed)&&!result.timedOut&&!result.cancelled&&!result.issue;
  const observed=!assertion.instrument&&(evidence.level==='behavior'?assertion.passed===true:assertion.passed!==false);
  evidence.passed=commandOkay&&observed&&(check.kind!=='tui'||result.terminal===true);
  if(!interfaceEvidenceUsable(check,evidence)){
    evidence.passed=false;
    const browserWitnesses=evidence.browserObservation?.witnesses??[];
    if(!commandOkay&&browserInteractionAttempted(browserWitnesses))return finish(result,browserWitnesses.some(witness=>witness.phase==='launch'&&witness.status==='failed')?'environment':classifyVerificationFailure(result,options.instrument));
    evidence.output+=`\nBrowser interaction: no completed browser session, page navigation and page observation/action were recorded by a compatible interface instrument. The original command observation is preserved.\nInterface observation contract: ${JSON.stringify(BROWSER_OBSERVATION_CONTRACT)}`;
    return finish(result,'instrument');
  }
  if(evidence.passed)return finish(result,null);
  if(!commandOkay)return finish(result,classifyVerificationFailure(result,options.instrument));
  // A missing predicate is an unresolved assertion over a retained observation,
  // rather than a command or product defect. The coordinator can repair just
  // that predicate and reuse the observation without running the command again.
  if(assertion.instrument||commandOkay&&assertion.passed===null&&evidence.level==='behavior')return finish(result,'instrument');
  return finish(result,classifyVerificationFailure(result,options.instrument));
}
