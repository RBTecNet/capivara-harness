import { readFile, readdir } from 'node:fs/promises';
import { join, basename } from 'node:path';
import type { DevelopmentPlan, ProductBrief, Verification, WorkUnit } from '../domain/types.js';
import { allowedCapabilities, inferredCapabilities } from '../domain/authority.js';
import { taskReferences } from '../domain/material.js';
import type { CommandResult, TerminalRequest } from '../runtime/types.js';
import { digest, inputHash } from './files.js';
import { applyOperationalEnvironment, recipeCwd, executionConstraints, type CommandExecutor, type OperationalEnvironment, verificationOperationalRevision } from './environment.js';
import type { SelectedVerification, VerificationEvidence } from './types.js';
import { beginConformanceObservation, finishConformanceObservation } from './conformance.js';
import { classifyReviewFailure, type ReviewFailureContext, type ReviewFailureKind } from './review.js';
import { declaredTaskInputs, declaredCheckInputs, resolveInputDependencies } from './dependencies.js';
import { emitProgress, type ProgressEvent } from '../telemetry/progress.js';

/** Wrong instruments are replaced; their failure never becomes an invented product requirement. */
export function selectVerifications(brief: ProductBrief, task: WorkUnit): SelectedVerification[] {
  const result: SelectedVerification[]=[];
  for (const check of task.checks) {
    const capabilities=[...new Set([...check.requiredCapabilities,...inferredCapabilities(check.command??'')])];
    const wrongMode=check.kind==='web'&&!brief.modes.includes('web') || check.kind==='desktop'&&!brief.modes.includes('desktop') || check.kind==='tui'&&!brief.modes.includes('tui');
    if (wrongMode || !allowedCapabilities(brief,capabilities)) {
      const {command:_command,args:_args,...compatible}=check;
      result.push({check:{...compatible,id:`${check.id}-compatible`,kind:'command',requiredCapabilities:[]},replaced:`${check.id}: ${check.kind} requires capabilities outside this product. Select a compatible proof.`});
    } else result.push({check:{...check,requiredCapabilities:capabilities}});
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
export async function checkInputHash(workspace:string,plan:DevelopmentPlan,task:WorkUnit,check:Verification,brief?:ProductBrief,operational?:OperationalEnvironment):Promise<string>{
  const inputs=await resolveInputDependencies(workspace,declaredCheckInputs(plan,task,check));
  const requirements=brief?.requirements.filter(requirement=>(check.requirementIds.length?check.requirementIds:task.requirementIds).includes(requirement.id));
  const contracts=plan.contracts.filter(contract=>task.contractIds.includes(contract.id));
  return inputHash(workspace,inputs,JSON.stringify({verifier:'capivara-verification/4',check,requirements,contracts,constraints:brief?.constraints,environment:plan.environment.filter(node=>task.environmentIds.includes(node.id)),operational:operational?verificationOperationalRevision(operational,inputs,check):undefined,platform:process.platform,node:process.version,references:brief?taskReferences(brief,task):[]}));
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
export function expectedResult(expected:string|undefined,result:CommandResult):{passed:boolean|null;detail:string;instrument:boolean}{
  if(!expected)return{passed:null,detail:'No output assertion declared; the reviewer must establish the behavioral evidence.',instrument:false};
  const text=result.stdout+'\n'+result.stderr;
  if(expected.startsWith('contains:'))return{passed:text.includes(expected.slice(9).trim()),detail:expected,instrument:false};
  if(expected.startsWith('regex:')){try{return{passed:new RegExp(expected.slice(6).trim(),'m').test(text),detail:expected,instrument:false};}catch{return{passed:false,detail:'The assertion regex is invalid; repair the instrument.',instrument:true};}}
  if(/^exit:\s*-?\d+$/.test(expected))return{passed:result.exitCode===Number(expected.slice(5).trim()),detail:expected,instrument:false};
  if(expected==='json'){try{JSON.parse(result.stdout.trim());return{passed:true,detail:'stdout decoded as JSON; the reviewer must inspect its required contents.',instrument:false};}catch{return{passed:false,detail:'stdout is not valid JSON.',instrument:false};}}
  const normalized=expected.normalize('NFD').replace(/\p{Diacritic}/gu,'').toLowerCase();
  if(/(?:stdout|saida padrao)\s+(?:is\s+)?(?:empty|vazi[oa])/.test(normalized))return{passed:result.stdout.trim()==='',detail:'Observed stdout is empty.',instrument:false};
  if(text.includes(expected))return{passed:true,detail:`Observed expected output: ${expected}`,instrument:false};
  return{passed:null,detail:`Semantic assertion for the reviewer: ${expected}`,instrument:false};
}
export interface VerificationOutcome {
  evidence:VerificationEvidence & {level:'syntax'|'build'|'behavior';classification?:VerificationFailureClass;inputs:string[];environmentRevision?:string};
  result:CommandResult|null;
  needsInstrument:boolean;
  classification:VerificationFailureClass|null;
}
export async function runVerification(workspace:string,brief:ProductBrief,task:WorkUnit,plan:DevelopmentPlan,check:Verification,execute:CommandExecutor,terminal:(request:TerminalRequest)=>Promise<CommandResult>,options:{signal?:AbortSignal;allowSystemInstall?:boolean;onEvent?:(event:ProgressEvent)=>void;operational?:OperationalEnvironment;instrument?:ReviewFailureContext}={}):Promise<VerificationOutcome>{
  const progress={id:`verification:${task.id}:${check.id}`,label:`${task.id}: ${check.id}`,stage:'build'};
  const finish=(result:CommandResult|null,classification:VerificationFailureClass|null):VerificationOutcome=>{
    if(classification)evidence.classification=classification;
    emitProgress(options.onEvent,{...progress,status:evidence.passed?'complete':'waiting'});
    return{evidence,result,classification,needsInstrument:classification!==null&&classification!=='product'};
  };
  emitProgress(options.onEvent,{...progress,status:'running'});
  const inputs=await resolveInputDependencies(workspace,declaredCheckInputs(plan,task,check));
  const hash=await checkInputHash(workspace,plan,task,check,brief,options.operational);
  const evidence:VerificationOutcome['evidence']={id:digest(`${task.id}:${check.id}:${hash}`).slice(0,20),taskId:task.id,checkId:check.id,inputHash:hash,passed:false,command:check.command??'',output:'',terminal:false,checkedAt:new Date().toISOString(),kind:check.kind,target:check.target??hostTarget(),level:verificationLevel(check),inputs,...(options.operational?{environmentRevision:verificationOperationalRevision(options.operational,inputs,check)}:{})};
  if(task.requirementIds.length&&!inputs.length&&check.inputs===undefined&&task.inputs===undefined&&!task.files.length){
    evidence.output='The product proof has no declared read set. Declare its source/configuration/generated inputs, or explicitly declare an empty input set for a genuinely input-free operation. Unknown inputs cannot produce a reusable product proof.';
    return finish(null,'instrument');
  }
  if(!check.command){evidence.output='No executable recipe exists for this proof. Recover an instrument for the requested behavior.';return finish(null,'instrument');}
  if(check.kind==='desktop'&&!nativeTargetAvailable(check)){evidence.output='The declared target requires a compatible native runner. Independent work can continue, but this interaction is not proved.';return finish(null,'environment');}
  if(check.kind==='tui'&&(!terminalInteraction(check)||!check.expected)){evidence.output='Interactive terminal proof needs an observed ready screen, input and a newly observed state. Recover the recipe without changing the product.';return finish(null,'instrument');}
  if(['desktop','web'].includes(check.kind)&&preparationOnly(check)){evidence.output='Compilation, installation or process status does not exercise application interaction.';return finish(null,'instrument');}
  const request=applyOperationalEnvironment({cwd:recipeCwd(workspace,check.cwd),command:check.args?[check.command,...check.args]:check.command,constraints:executionConstraints(brief,options.allowSystemInstall),capabilities:check.requiredCapabilities,inputs,...(check.kind!=='tui'&&check.input?{input:check.input.join('')}:{}),...(check.timeoutMs?{timeoutMs:check.timeoutMs}:{}),...(options.signal?{signal:options.signal}:{})},options.operational);
  const observation=await beginConformanceObservation(workspace,check,request.command,request.cwd);
  const result=check.kind==='tui'?await terminal({...request,steps:check.steps??[],closeInput:check.closeInput??'\u0003'}):await execute(request);
  evidence.provenance=await finishConformanceObservation(observation,check,result);
  evidence.command=result.command;evidence.terminal=result.terminal===true;
  evidence.output=`Command: ${result.command}\nExit code: ${result.exitCode}${result.timedOut?' (timed out)':''}${result.cancelled?' (cancelled)':''}\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`;
  if(result.issue)evidence.output+=`\nRuntime issue (${result.issue.kind}): ${result.issue.message}`;
  const assertion=expectedResult(check.expected,result);
  const expectedExit=check.expectedExitCode??inferredExpectedExit(check.expected)??0;
  const terminalClosed=check.kind==='tui'&&result.terminal===true&&result.exitCode===130&&expectedExit===0&&assertion.passed===true;
  evidence.output+=`\nEvidence level: ${evidence.level}\nExpected exit code: ${expectedExit}\nAssertion: ${assertion.detail}`;
  const commandOkay=(result.exitCode===expectedExit||terminalClosed)&&!result.timedOut&&!result.cancelled&&!result.issue;
  const observed=evidence.level==='behavior'?assertion.passed===true:assertion.passed!==false;
  evidence.passed=commandOkay&&observed&&(check.kind!=='tui'||result.terminal===true);
  if(evidence.passed)return finish(result,null);
  if(assertion.instrument||commandOkay&&assertion.passed===null&&evidence.level==='behavior')return finish(result,'instrument');
  return finish(result,classifyVerificationFailure(result,options.instrument));
}
