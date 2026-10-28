import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { DevelopmentPlan, ProductBrief, Verification, WorkUnit } from '../domain/types.js';
import { allowedCapabilities, inferredCapabilities } from '../domain/authority.js';
import { taskReferences } from '../domain/material.js';
import type { CommandResult, TerminalRequest } from '../runtime/types.js';
import { digest, inputHash } from './files.js';
import { executionConstraints, type CommandExecutor } from './environment.js';
import type { SelectedVerification, VerificationEvidence } from './types.js';
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
  if(scripts.typecheck)return [{...common,id:`${task.id}-typecheck`,kind:'command',command:'npm run typecheck'}];
  if(scripts.build)return [{...common,id:`${task.id}-build`,kind:'command',command:'npm run build'}];
  const checks: Verification[]=[];
  for(const file of task.files) {
    if(/\.(?:cjs|mjs|js)$/.test(file))checks.push({...common,id:`${task.id}-syntax-${digest(file).slice(0,8)}`,kind:'command',command:'node',args:['--check',file]});
    if(/\.py$/.test(file))checks.push({...common,id:`${task.id}-syntax-${digest(file).slice(0,8)}`,kind:'command',command:process.platform==='win32'?'py':'python3',args:['-m','py_compile',file]});
  }
  if(checks.length)return checks;
  const files:string[]=await readdir(workspace,{encoding:'utf8'}).catch(()=>[] as string[]);
  if(files.includes('Cargo.toml'))return[{...common,id:`${task.id}-compile`,kind:'command',command:'cargo',args:['check']}];
  if(files.includes('go.mod'))return[{...common,id:`${task.id}-compile`,kind:'command',command:'go',args:['build','./...']}];
  if(files.some(name=>/\.(?:csproj|fsproj|sln|slnx)$/.test(name)))return[{...common,id:`${task.id}-compile`,kind:'command',command:'dotnet',args:['build','--no-restore']}];
  return [];
}
export function taskInputs(plan: DevelopmentPlan, task: WorkUnit): string[] {
  const dependencies=plan.tasks.filter(other=>task.dependsOn.includes(other.id)).flatMap(other=>other.files);
  return [...new Set([...task.files,...dependencies,'package.json','package-lock.json','pnpm-lock.yaml','pnpm-workspace.yaml','yarn.lock','bun.lock','bun.lockb','.npmrc','.yarnrc','.yarnrc.yml','Cargo.toml','Cargo.lock','.cargo/config.toml','go.mod','go.sum','pyproject.toml','requirements.txt','poetry.lock','uv.lock','tsconfig.json','jsconfig.json','global.json','Directory.Build.props','Directory.Build.targets','Directory.Packages.props','NuGet.Config'])];
}
export async function checkInputHash(workspace: string,plan:DevelopmentPlan,task:WorkUnit,check:Verification,brief?:ProductBrief):Promise<string> {
  return inputHash(workspace,task.files.length?taskInputs(plan,task):[],JSON.stringify({verifier:'capivara-verification/2',check,targets:plan.environment.filter(node=>task.environmentIds.includes(node.id)),platform:process.platform,node:process.version,references:brief?taskReferences(brief,task):[]}));
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
  const command=`${check.command??''} ${(check.args??[]).join(' ')}`;
  return /\b(?:dotnet\s+(?:build|restore)|cargo\s+(?:build|check|fetch)|go\s+(?:build|mod)|(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?(?:build|typecheck|install|ci)|tsc\b|node\s+--check|python\w*\s+-m\s+(?:py_compile|compileall)|tasklist\b|pgrep\b|ps\s+-)/i.test(command);
}
export function expectedResult(expected:string|undefined,result:CommandResult):{passed:boolean|null;detail:string;instrument:boolean}{
  if(!expected)return{passed:null,detail:'No output assertion declared; the reviewer must establish the behavioral evidence.',instrument:false};
  const text=result.stdout+'\n'+result.stderr;
  if(expected.startsWith('contains:'))return{passed:text.includes(expected.slice(9).trim()),detail:expected,instrument:false};
  if(expected.startsWith('regex:')){try{return{passed:new RegExp(expected.slice(6).trim(),'m').test(text),detail:expected,instrument:false};}catch{return{passed:false,detail:'The assertion regex is invalid; repair the instrument.',instrument:true};}}
  if(/^exit:\s*-?\d+$/.test(expected))return{passed:result.exitCode===Number(expected.slice(5).trim()),detail:expected,instrument:false};
  if(expected==='json'){try{JSON.parse(result.stdout.trim());return{passed:true,detail:'stdout decoded as JSON; the reviewer must inspect its required contents.',instrument:false};}catch{return{passed:false,detail:'stdout is not valid JSON.',instrument:false};}}
  if(text.includes(expected))return{passed:true,detail:`Observed expected output: ${expected}`,instrument:false};
  return{passed:null,detail:`Semantic assertion for the reviewer: ${expected}`,instrument:false};
}
export async function runVerification(workspace:string,brief:ProductBrief,task:WorkUnit,plan:DevelopmentPlan,check:Verification,execute:CommandExecutor,terminal:(request:TerminalRequest)=>Promise<CommandResult>,options:{signal?:AbortSignal;allowSystemInstall?:boolean;onEvent?:(event:ProgressEvent)=>void}={}):Promise<{evidence:VerificationEvidence;result:CommandResult|null;needsInstrument:boolean}> {
  const progress = { id: `verification:${task.id}:${check.id}`, label: `${task.id}: ${check.id}`, stage: 'build' };
  const finish = (result: {evidence:VerificationEvidence;result:CommandResult|null;needsInstrument:boolean}): typeof result => {
    emitProgress(options.onEvent, { ...progress, status: result.evidence.passed ? 'complete' : 'waiting' });
    return result;
  };
  emitProgress(options.onEvent, { ...progress, status: 'running' });
  const hash=await checkInputHash(workspace,plan,task,check,brief);
  const evidence:VerificationEvidence={id:digest(`${task.id}:${check.id}:${hash}`).slice(0,20),taskId:task.id,checkId:check.id,inputHash:hash,passed:false,command:check.command??'',output:'',terminal:false,checkedAt:new Date().toISOString()};
  if(!check.command){evidence.output='No executable recipe is available for this proof. Derive a compatible recipe from the actual product; do not change the product to satisfy an invented convention.';return finish({evidence,result:null,needsInstrument:true});}
  if(check.kind==='desktop'&&!nativeTargetAvailable(check)){evidence.output='A required desktop target has no native runner on this host. Continue independent work and provide a compatible runner; do not claim its workflows were executed.';return finish({evidence,result:null,needsInstrument:true});}
  if(check.kind==='tui'&&(!terminalInteraction(check)||!check.expected)){evidence.output='Interactive terminal proof needs an observed ready screen BEFORE input and a newly observed screen/state AFTER that input. Provide synchronized steps and an expected result; repair this recipe rather than rewriting the product for a missing instrument.';return finish({evidence,result:null,needsInstrument:true});}
  if(check.kind==='desktop'&&preparationOnly(check)){evidence.output='Compilation, installation and process status do not exercise native desktop interaction. Recover an actual native automation recipe and an observable assertion; preserve product code.';return finish({evidence,result:null,needsInstrument:true});}
  const request={cwd:workspace,command:check.args?[check.command,...check.args]:check.command,constraints:executionConstraints(brief,options.allowSystemInstall),capabilities:check.requiredCapabilities,inputs:taskInputs(plan,task),...(check.kind!=='tui'&&check.input?{input:check.input.join('')}:{}),...(check.timeoutMs?{timeoutMs:check.timeoutMs}:{}),...(options.signal?{signal:options.signal}:{})};
  const result=check.kind==='tui'?await terminal({...request,steps:check.steps??[],closeInput:check.closeInput??'\u0003'}):await execute(request);
  evidence.command=result.command;evidence.output=`Command: ${result.command}\nExit code: ${result.exitCode}${result.timedOut?' (timed out)':''}${result.cancelled?' (cancelled)':''}\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`;evidence.terminal=result.terminal===true;
  if(result.issue)evidence.output+=`\nRuntime issue (${result.issue.kind}): ${result.issue.message}`;
  const assertion=expectedResult(check.expected,result);
  if(check.kind==='desktop'&&assertion.passed!==true){evidence.output+='\nNative interaction needs an assertion that was actually observed. A semantic statement that a window opens does not prove the workflow.';return finish({evidence,result,needsInstrument:true});}
  const expectedExit=check.expectedExitCode??inferredExpectedExit(check.expected)??0;
  const exitedAsExpected=result.exitCode===expectedExit;
  const terminalClosed=check.kind==='tui'&&result.terminal===true&&result.exitCode===130&&expectedExit===0&&assertion.passed===true;
  evidence.passed=(exitedAsExpected||terminalClosed)&&!result.timedOut&&!result.cancelled&&!result.issue&&(check.kind!=='tui'||result.terminal===true)&&assertion.passed!==false;
  evidence.output+=`\nExpected exit code: ${expectedExit}\nAssertion: ${assertion.detail}${assertion.passed===null?' (requires semantic review)':''}`;
  evidence.kind=check.kind;evidence.target=check.target??hostTarget();
  const needsInstrument=assertion.instrument||!!result.issue || result.exitCode===127&&expectedExit!==127 || /(?:command not found|not recognized as|cannot find module|no module named|ENOENT|ECONNREFUSED|ENETUNREACH)/i.test(evidence.output);
  return finish({evidence,result,needsInstrument});
}
