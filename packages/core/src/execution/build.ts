import { readFile, mkdir } from 'node:fs/promises';
import type { DevelopmentPlan, EnvironmentNode, ProductBrief, Verification, WorkUnit } from '../domain/types.js';
import { contextForTask, packetText } from '../domain/context.js';
import { allowedCapabilities } from '../domain/authority.js';
import { taskReferences } from '../domain/material.js';
import { jsonObject, object } from '../domain/json.js';
import { executeCommand as realCommand, runTerminal as realTerminal } from '../runtime/index.js';
import type { AgentResult } from '../runtime/types.js';
import { backup, changedSince, digest, inputHash, inside, introducedServers, restoreFiles, snapshot } from './files.js';
import { executionConstraints, prepareEnvironmentNode, prepareProjectDependencies, type CommandExecutor } from './environment.js';
import { checkInputHash, derivedChecks, hostTarget, nativeTargetAvailable, runVerification, selectVerifications, taskInputs } from './checks.js';
import type { BuildIncident, BuildOptions, BuildOutcome, BuildState, TaskProgress } from './types.js';

export function createBuildState(plan: DevelopmentPlan): BuildState {
  return {schema:'capivara/build/1',planRevision:plan.revision,tasks:{},environment:{},evidence:[],incidents:[],updatedAt:new Date().toISOString()};
}
function incident(kind:BuildIncident['kind'],subject:string,message:string,evidence='',external=false):BuildIncident {
  return {id:digest(`${kind}:${subject}:${message}`).slice(0,16),kind,subject,message,evidence,external,action:'Recover this cause in the current execution, preserve confirmed work and continue.'};
}
function isExternal(result:AgentResult):boolean { return result.status==='unavailable' || result.issue?.kind==='authentication'||result.issue?.kind==='rate-limit'||result.issue?.kind==='capacity'; }
function observer(options:BuildOptions,type:Parameters<NonNullable<BuildOptions['onEvent']>>[0]['type'],message:string,subject?:string):void {
  try{options.onEvent?.({type,message,...(subject?{subject}:{})});}catch{/* Display is not execution authority. */}
}
async function save(options:BuildOptions,state:BuildState):Promise<void>{state.updatedAt=new Date().toISOString();await options.onState?.(state);}
function note(state:BuildState,value:BuildIncident):void {
  const index=state.incidents.findIndex(item=>item.id===value.id);
  if(index>=0)state.incidents[index]=value;else state.incidents.push(value);
}
function clearIncidents(state:BuildState,subject:string):void {state.incidents=state.incidents.filter(item=>item.subject!==subject);}
async function call(options:BuildOptions,role:string,instruction:string,context:string,readOnly:boolean):Promise<AgentResult>{
  if(options.signal?.aborted)return{status:'cancelled',text:'',commands:[],changedFiles:[]};
  try{
    const before=readOnly?undefined:await snapshot(options.workspace);
    if(before)await backup(options.workspace,role,before);
    let result:AgentResult;
    try{result=await options.agent({workspace:options.workspace,role,instruction,context,readOnly,constraints:executionConstraints(options.brief,options.allowSystemInstall),...(options.signal?{signal:options.signal}:{}),...(options.onEvent?{onEvent:options.onEvent}:{})});}
    catch(error){result={status:'unavailable',text:'',issue:{kind:'transport',recoverable:true,message:String(error)},commands:[],changedFiles:[]};}
    if(before&&!allowedCapabilities(options.brief,['http-server'])){
      const offending=await introducedServers(options.workspace,before);
      if(offending.length){
        await restoreFiles(options.workspace,before,offending);
        const message=`Restored forbidden HTTP effect in ${offending.join(', ')}. Recover only the instrument or original behavior without an HTTP listener; installer/verification preferences cannot change the product.`;
        observer(options,'recovery','Efeito HTTP indevido removido após operação mutável; preservando as demais alterações.');
        return{...result,status:result.status==='cancelled'?'cancelled':'partial',issue:{kind:'constraint',recoverable:true,message},changedFiles:await changedSince(options.workspace,before)};
      }
    }
    return result;
  }
  catch(error){return{status:'unavailable',text:'',issue:{kind:'transport',recoverable:true,message:String(error)},commands:[],changedFiles:[]};}
}
async function taskContext(options:BuildOptions,plan:DevelopmentPlan,task:WorkUnit,reserveRatio=0.15):Promise<string>{
  const limit=options.contextChars??24000;
  const packet=packetText(contextForTask(options.brief,plan,task,Math.floor(limit/2)));
  let remaining=Math.max(0,limit-packet.length-Math.ceil(limit*reserveRatio)-100);
  const excerpts:string[]=[];
  for(const file of task.files){
    if(remaining<=0)break;
    const content=await readFile(inside(options.workspace,file),'utf8').catch(()=>null);
    if(content===null)continue;
    const text=content.slice(0,Math.min(2800,remaining));remaining-=text.length+file.length+50;
    excerpts.push(`FILE ${file}${content.length>text.length?' (excerpt; read the needed remainder with tools)':''}\n${text}`);
  }
  return `${packet}\n\n${excerpts.join('\n\n')}`;
}
interface Review { approved:boolean; findings:string[]; readable:boolean; }
function unsupportedTestingDemand(text:string,brief:ProductBrief,task:WorkUnit):boolean{
  const normalized=text.normalize('NFD').replace(/\p{Diacritic}/gu,'').toLowerCase();
  const demand=/(?:missing|lack|absence|no tests|add|write|create|increase|more|falt\w*|ausencia|nao ha|adicion\w*|cri\w*|escrev\w*|mais).{0,90}\b(?:tests?|testes|coverage|cobertura)\b|\b(?:coverage|cobertura).{0,35}(?:low|insufficient|baixa|insuficient)/.test(normalized);
  if(!demand||/\b(?:throws?|crashes?|returns?|incorrect\w*|exception|retorna|excecao|resultado incorreto|quebra o|falha ao)\b/.test(normalized))return false;
  const requested=brief.requirements.filter(value=>task.requirementIds.includes(value.id)).some(value=>{
    const literal=value.source.text.normalize('NFD').replace(/\p{Diacritic}/gu,'').toLowerCase();
    return /(?:create|write|include|add|implemente?|crie|escreva|adicione|inclua).{0,60}\b(?:tests?|testes)\b|\b(?:tests?|testes).{0,35}(?:required|obrigatorios)/.test(literal)&&!/(?:do not|never|nao|sem).{0,40}(?:create|write|include|add|crie|escreva|adicione|inclua|testes)/.test(literal);
  });
  return !requested;
}
/** Accept useful review content without requiring a document title or an exact field vocabulary. */
export function interpretReview(text:string):Review {
  const value=jsonObject(text);
  if(value){
    const raw=Array.isArray(value.findings)?value.findings:Array.isArray(value.issues)?value.issues:Array.isArray(value.defects)?value.defects:[];
    const findings=raw.flatMap(item=>{
      if(typeof item==='string')return item.trim()?[item]:[];
      if(!object(item))return[];
      if(item.material===false||item.severity==='suggestion'||item.severity==='style'||item.severity==='info')return[];
      const expected=typeof item.expected==='string'?item.expected:'';
      const observed=typeof item.observed==='string'?item.observed:typeof item.problem==='string'?item.problem:typeof item.message==='string'?item.message:'';
      const where=typeof item.file==='string'?item.file:typeof item.location==='string'?item.location:'';
      const evidence=typeof item.evidence==='string'?item.evidence:'';
      const fix=typeof item.fix==='string'?item.fix:typeof item.action==='string'?item.action:'';
      return observed?[`${where?`${where}: `:''}${observed}${expected?` Expected: ${expected}`:''}${evidence?` Evidence: ${evidence}`:''}${fix?` Suggested repair: ${fix}`:''}`]:[];
    });
    const status=String(value.status??value.verdict??'').toLowerCase();
    const explicit=value.approved===true||value.complete===true||['approved','complete','correct','pass','ok'].includes(status);
    const rejected=value.approved===false||value.complete===false||['rejected','incomplete','fail'].includes(status);
    return{approved:findings.length===0&&explicit,findings,readable:explicit||rejected||findings.length>0};
  }
  const positive=/^(?:approved|complete|correct|aprovado|correto)\s*[.!]?\s*$/i.test(text.trim())||/\b(?:no material defects|no defects found|nenhum defeito material|sem defeitos materiais)\b/i.test(text)&&!/\b(?:but|however|except|missing|crashes?|fails?|mas|porem|falta|falha|exceto)\b/i.test(text);
  return{approved:positive,findings:[],readable:positive};
}
function revisionDescription(brief:ProductBrief,plan:DevelopmentPlan,task:WorkUnit):string {
  return JSON.stringify({task,requirements:brief.requirements.filter(value=>task.requirementIds.includes(value.id)),constraints:brief.constraints,contracts:plan.contracts.filter(value=>task.contractIds.includes(value.id)),references:taskReferences(brief,task)});
}
async function taskRevision(options:BuildOptions,plan:DevelopmentPlan,task:WorkUnit):Promise<string>{return inputHash(options.workspace,taskInputs(plan,task),JSON.stringify({unit:revisionDescription(options.brief,plan,task),environment:environmentClosure(plan,task.environmentIds),platform:process.platform,node:process.version}));}
async function manifestHash(workspace:string):Promise<string>{return inputHash(workspace,['package.json','package-lock.json','pnpm-lock.yaml','yarn.lock','bun.lock','Cargo.toml','Cargo.lock','go.mod','go.sum','requirements.txt','pyproject.toml']);}
function environmentClosure(plan:DevelopmentPlan,ids:readonly string[]):EnvironmentNode[]{
  const result:EnvironmentNode[]=[],seen=new Set<string>();
  const visit=(id:string):void=>{if(seen.has(id))return;seen.add(id);const node=plan.environment.find(value=>value.id===id);if(!node)return;node.dependsOn.forEach(visit);result.push(node);};ids.forEach(visit);return result;
}
async function recoverEnvironment(options:BuildOptions,node:EnvironmentNode,problem:BuildIncident):Promise<AgentResult>{
  const limit=options.contextChars??24000;
  const details=JSON.stringify({id:node.id,name:node.name,kind:node.kind,dependsOn:node.dependsOn,check:node.check,reason:node.reason});
  return call(options,'repair','Prepare only the missing development dependency. Inspect the actual host and manifest, prefer a local/isolated installation, verify readiness, and preserve the product requirements. Installer preference is not a reason to stop. Do not add a browser or HTTP service unless the product requires it.',`ENVIRONMENT NODE\n${details.slice(0,Math.floor(limit*0.45))}\nCURRENT FAILURE\n${problem.message}\n${problem.evidence.slice(-Math.floor(limit*0.35))}\nPRODUCT CAPABILITY LIMITS\n${JSON.stringify({constraints:executionConstraints(options.brief,options.allowSystemInstall),modes:options.brief.modes,targets:options.brief.targets})}`,false);
}
async function recoverVerifications(options:BuildOptions,plan:DevelopmentPlan,task:WorkUnit,context:string,problem:BuildIncident,requiredKind?:Verification['kind']):Promise<DevelopmentPlan|null>{
  // An incorrect instrument has no authority to restructure product tasks or create new source files.
  // Local read-only recipe repair is the complete recovery route for this incident class.
  let preceding='';
  const limit=options.contextChars??24000;
  for(;;){
    if(options.signal?.aborted)return null;
    const answer=await call(options,'repair','Repair only the verification recipe for this existing work unit. Read the actual entrypoint and observed stdout/stderr, then choose a valid invocation compatible with the required interface. Preserve tasks, dependencies, contracts, files and product code. Return JSON {checks:[{kind,command,args,expected,expectedExitCode,input,steps,closeInput,requiredCapabilities,target}]}. For TUI, waitFor contains literal text actually printed by the application, never a description such as "visible on screen". Use steps:[{waitFor:"exact initial text"},{input:"actual key bytes",waitFor:"exact changed text"}] and closeInput for its valid exit key. Do not create a controller script or new product artifact to work around an incorrect literal. A CLI invocation uses documented valid arguments. Do not invent an HTTP server to accommodate a verifier.',`${context.slice(0,Math.floor(limit*0.65))}\nINSTRUMENT TO RECOVER\n${problem.evidence.slice(-Math.floor(limit*0.25))}${preceding?`\nThe preceding answer did not contain an executable compatible recipe. Clarify only that recipe:\n${preceding.slice(-Math.floor(limit*0.05))}`:''}`,true);
    if(answer.status==='cancelled'||isExternal(answer))return null;
    const proposal=jsonObject(answer.text),values=Array.isArray(proposal?.checks)?proposal.checks:[];
    const compatible:Verification[]=values.filter(object).filter(value=>typeof value.command==='string').map((value,index)=>({
      id:`${task.id}-recovered-${index+1}`,kind:typeof value.kind==='string'&&['command','cli','tui','web','desktop'].includes(value.kind)?value.kind as Verification['kind']:'command',command:String(value.command),
      ...(Array.isArray(value.args)?{args:value.args.filter((arg):arg is string=>typeof arg==='string')}:{}),...(typeof value.expected==='string'?{expected:value.expected}:{}),
      ...(typeof value.expectedExitCode==='number'&&Number.isInteger(value.expectedExitCode)?{expectedExitCode:value.expectedExitCode}:{}),
      ...(Array.isArray(value.input)?{input:value.input.filter((arg):arg is string=>typeof arg==='string')}:{}),
      ...(Array.isArray(value.steps)?{steps:value.steps.filter(object).map(step=>({...typeof step.input==='string'?{input:step.input}:{},...typeof step.waitFor==='string'?{waitFor:step.waitFor}:{},...typeof step.timeoutMs==='number'?{timeoutMs:step.timeoutMs}:{}}))}:{}),
      ...(typeof value.closeInput==='string'?{closeInput:value.closeInput}:{}),
      ...(typeof value.target==='string'&&['linux','windows','macos','browser','portable'].includes(value.target)?{target:value.target as NonNullable<Verification['target']>}:{}),
      requirementIds:task.requirementIds,requiredCapabilities:Array.isArray(value.requiredCapabilities)?value.requiredCapabilities.filter((cap):cap is string=>typeof cap==='string'):[],
    })).filter(check=>(!requiredKind||check.kind===requiredKind)&&selectVerifications(options.brief,{...task,checks:[check]}).every(value=>!value.replaced));
    if(compatible.length)return{...plan,revision:plan.revision+1,tasks:plan.tasks.map(value=>value.id===task.id?{...value,checks:compatible}:value)};
    preceding=answer.text;observer(options,'recovery','Esclarecendo a receita de verificação sem alterar o produto.',task.id);
  }
}
interface Diagnosis{kind:'product'|'instrument'|'environment'|'plan'|'recheck';guidance:string;}
async function diagnoseRepeatedFailure(options:BuildOptions,context:string,problem:BuildIncident):Promise<Diagnosis|null>{
  let preceding='';
  const limit=options.contextChars??24000;
  for(;;){
    if(options.signal?.aborted)return null;
    const answer=await call(options,'reviewer','Diagnose this repeated failure without changing code. The preceding repair left the same product and the same negative proof. Determine whether the cause is product behavior, an incorrect instrument/assertion, environment readiness, or task/contract scope. Inspect the actual source and recipe; an intentional error exit is not automatically a defect. Return {kind:"product"|"instrument"|"environment"|"plan",cause,fix}, with a concrete smaller next action. Do not request more tests by count or repeat the unchanged failed action.',`${context.slice(0,Math.floor(limit*0.65))}\nUNCHANGED FAILURE\n${problem.evidence.slice(-Math.floor(limit*0.25))}${preceding?`\nCLARIFY THE CAUSE/ACTION\n${preceding.slice(-Math.floor(limit*0.05))}`:''}`,true);
    if(answer.status==='cancelled'||isExternal(answer))return null;
    if(answer.changedFiles.length||answer.issue?.kind==='constraint')return{kind:'recheck',guidance:'The diagnostic operation changed source or violated read-only constraints. Revalidate affected proof before accepting a conclusion.'};
    const value=jsonObject(answer.text),kind=String(value?.kind??value?.classification??value?.category??'').toLowerCase();
    const guidance=[value?.cause,value?.fix??value?.action??value?.guidance].filter((item):item is string=>typeof item==='string'&&item.trim().length>0).join('\n');
    if(['product','instrument','environment','plan'].includes(kind)&&guidance)return{kind:kind as Diagnosis['kind'],guidance};
    const plain=answer.text.trim().match(/^(product|instrument|environment|plan)\s*:\s*([\s\S]+)$/i);
    if(plain)return{kind:plain[1]!.toLowerCase() as Diagnosis['kind'],guidance:plain[2]!};
    preceding=answer.text;observer(options,'recovery','Esclarecendo a causa da falha repetida antes de solicitar outra edição.',problem.subject);
  }
}
/** One scheduler handles dependencies and recovery. Temporary impossibility returns WAITING to the coordinator, never process.exit. */
export async function runBuild(options:BuildOptions):Promise<BuildOutcome>{
  const state=options.state??createBuildState(options.plan);
  let plan=options.plan;
  const execute:CommandExecutor=options.executeCommand??realCommand;
  const terminal=options.runTerminal??realTerminal;
  const prepared=new Set<string>();
  let dependenciesPrepared='';
  const attemptedThisPass=new Set<string>();
  const hasCurrentProof=async(kind:Verification['kind'],target?:string):Promise<boolean>=>{
    for(const evidence of state.evidence){
      if(!evidence.passed||evidence.kind!==kind||kind==='tui'&&!evidence.terminal||target&&evidence.target!==target)continue;
      const unit=plan.tasks.find(value=>value.id===evidence.taskId),check=unit?.checks.find(value=>value.id===evidence.checkId);
      if(unit&&check&&evidence.inputHash===await checkInputHash(options.workspace,plan,unit,check,options.brief))return true;
    }
    return false;
  };
  const finish=(status:BuildOutcome['status']):BuildOutcome=>({status,state,plan,completed:plan.tasks.filter(task=>state.tasks[task.id]?.status==='complete').map(task=>task.id),pending:plan.tasks.filter(task=>state.tasks[task.id]?.status!=='complete').map(task=>task.id),incidents:state.incidents});
  try{
    await mkdir(options.workspace,{recursive:true});
    for(;;){
      if(options.signal?.aborted){await save(options,state);return finish('cancelled');}
      state.planRevision=plan.revision;
      for(const task of plan.tasks){
        const progress=state.tasks[task.id];
        if(progress?.status==='complete'&&progress.revision!==await taskRevision(options,plan,task)){progress.status='checking';progress.strategy='revalidate-only';}
      }
      if(plan.tasks.every(task=>state.tasks[task.id]?.status==='complete')){
        if(options.brief.modes.includes('tui')&&!await hasCurrentProof('tui')){
          const unit=plan.tasks.findLast(value=>value.checks.some(check=>check.kind==='tui'))??plan.tasks.findLast(value=>value.requirementIds.some(id=>options.brief.requirements.some(requirement=>requirement.id===id&&requirement.mode==='tui')))??plan.tasks.at(-1);
          const problem=incident('instrument',unit?.id??'tui-proof','The requested TUI still needs actual terminal interaction evidence.','Recover a kind=tui recipe for the existing product: wait for its ready screen in a real PTY, send a meaningful key/input, observe the resulting screen/state, then exit through its valid key. A syntax check, ordinary CLI process, or approval without terminal interaction is insufficient. Preserve all product source.');note(state,problem);
          if(unit){
            const revised=await recoverVerifications(options,plan,unit,await taskContext(options,plan,unit),problem,'tui');
            if(revised&&JSON.stringify(revised)!==JSON.stringify(plan)){plan=revised;const progress=state.tasks[unit.id];if(progress){progress.status='checking';progress.strategy='revalidate-only';}continue;}
          }
          await save(options,state);return finish('waiting');
        }
        const nativeTargets=options.brief.modes.includes('desktop')?options.brief.targets.filter(target=>['linux','windows','macos'].includes(target)):[];
        const unverified:string[]=[];for(const target of nativeTargets)if(!await hasCurrentProof('desktop',target))unverified.push(target);
        if(unverified.length){
          for(const target of unverified)note(state,incident('environment',`target-${target}`,`Native behavior is awaiting a compatible ${target} runner.`,target===hostTarget()?'Provide an actual native behavior recipe.':'This host cannot prove another operating system by keeping a process alive.',true));
          const localUnit=unverified.includes(hostTarget())?plan.tasks.findLast(value=>value.checks.some(check=>check.kind==='desktop'&&nativeTargetAvailable(check)))??plan.tasks.at(-1):undefined;
          if(localUnit){
            const problem=incident('instrument',localUnit.id,'The local desktop behavior needs an actual proof recipe.',`Recover a desktop verification for target ${hostTarget()} that exercises the essential requested interaction in the native application. Building or leaving the process alive alone does not prove the interaction. Preserve all product source.`);
            const revised=await recoverVerifications(options,plan,localUnit,await taskContext(options,plan,localUnit),problem,'desktop');
            if(revised&&JSON.stringify(revised)!==JSON.stringify(plan)){plan=revised;const progress=state.tasks[localUnit.id];if(progress){progress.status='checking';progress.strategy='revalidate-only';}continue;}
          }
          await save(options,state);return finish('waiting');
        }
        await save(options,state);observer(options,'complete','Todos os fragmentos foram construídos e conferidos.');return finish('complete');
      }
      const ready=plan.tasks.filter(task=>state.tasks[task.id]?.status!=='complete'&&!attemptedThisPass.has(task.id)&&task.dependsOn.every(id=>state.tasks[id]?.status==='complete')&&!task.blockedBy.some(id=>options.brief.gaps.some(gap=>gap.id===id&&gap.status==='pending')));
      const task=ready[0];
      if(!task){
        for(const pending of plan.tasks.filter(value=>state.tasks[value.id]?.status!=='complete')){
          const missing=pending.dependsOn.filter(id=>!plan.tasks.some(value=>value.id===id));
          if(missing.length){
            const problem=incident('integration',pending.id,'Task references missing dependencies.',missing.join(', '));note(state,problem);
            const repaired=await options.repairPlan?.(problem,pending);
            if(repaired){plan=repaired;attemptedThisPass.clear();break;}
          }
        }
        if(plan.tasks.some(value=>!attemptedThisPass.has(value.id)&&state.tasks[value.id]?.status!=='complete'&&value.dependsOn.every(id=>state.tasks[id]?.status==='complete')&&value.blockedBy.length===0))continue;
        await save(options,state);observer(options,'waiting','Dependências externas ou decisões pendentes estão aguardando recuperação; o trabalho confirmado permanece disponível.');return finish('waiting');
      }
      const progress:TaskProgress=state.tasks[task.id]??{status:'pending',revision:'',attempts:0,changedFiles:[],findings:[],strategy:'implement'};
      state.tasks[task.id]=progress;
      const envNodes=environmentClosure(plan,task.environmentIds);
      let environmentReady=true;
      for(const node of envNodes){
        const stamp=digest(JSON.stringify(node));
        if(prepared.has(`${node.id}:${stamp}`))continue;
        observer(options,'environment',`Preparando ${node.name}.`,node.id);
        let readiness=await prepareEnvironmentNode(options.workspace,node,options.brief,execute,{terminal,...(options.allowSystemInstall!==undefined?{allowSystemInstall:options.allowSystemInstall}:{}),...(options.signal?{signal:options.signal}:{})});
        if(!readiness.ready){
          const problem=readiness.incidents[0]??incident('environment',node.id,`Dependency ${node.name} needs preparation.`);note(state,problem);await save(options,state);
          const repaired=await recoverEnvironment(options,node,problem);
          if(repaired.status==='cancelled')return finish('cancelled');
          if(!isExternal(repaired))readiness=await prepareEnvironmentNode(options.workspace,node,options.brief,execute,{terminal,...(options.allowSystemInstall!==undefined?{allowSystemInstall:options.allowSystemInstall}:{}),...(options.signal?{signal:options.signal}:{})});
        }
        state.environment[node.id]={inputHash:stamp,ready:readiness.ready};
        if(!readiness.ready){readiness.incidents.forEach(value=>note(state,value));environmentReady=false;break;}
        prepared.add(`${node.id}:${stamp}`);clearIncidents(state,node.id);await save(options,state);
      }
      if(!environmentReady){progress.status='waiting';attemptedThisPass.add(task.id);await save(options,state);continue;}
      let context:string;
      try{context=await taskContext({...options,contextChars:progress.contextChars??options.contextChars??24000},plan,task);}
      catch(error){
        const problem={...incident('integration',task.id,'The task exceeds the available context. Split this unit rather than enlarging the context.',String(error)),contextChars:progress.contextChars??options.contextChars??24000};note(state,problem);
        const revised=await options.repairPlan?.(problem,task);
        if(revised){plan=revised;continue;}
        progress.status='waiting';attemptedThisPass.add(task.id);await save(options,state);continue;
      }
      if(progress.strategy==='focused-repair'){
        const previousFailures=state.evidence.filter(value=>value.taskId===task.id&&!value.passed);
        let staleFailure=false;
        for(const previous of previousFailures){const check=task.checks.find(value=>value.id===previous.checkId);if(check&&previous.inputHash!==await checkInputHash(options.workspace,plan,task,check,options.brief)){staleFailure=true;break;}}
        if(staleFailure){progress.status='checking';progress.strategy='revalidate-only';progress.findings=[];observer(options,'recovery','Reavaliando uma observação cuja fonte ou instrumento mudou antes de solicitar outra edição.',task.id);}
      }
      const shouldEdit=progress.status!=='checking'&&progress.status!=='reviewing'&&!['clarify-review','resume-review','revalidate-only','instrument','environment-only','diagnose-failure'].includes(progress.strategy);
      if(shouldEdit){
      // The source snapshot includes user changes; rollback can only restore what this task itself changed.
      const before=await snapshot(options.workspace);
      progress.status='editing';progress.attempts+=1;await save(options,state);
      observer(options,'task',`${task.id}: ${progress.findings.length?'corrigindo pendência concreta':'construindo'} ${task.title}.`,task.id);
      const strategy=progress.attempts>2?'Use a different, smaller implementation strategy. Diagnose the cause from the current files and previous evidence; do not repeat an unchanged failed action.':'';
      const edited=await call(options,progress.findings.length?'repair':'editor',[
        'Implement the small work unit in this workspace. Follow only its requested behavior and the original constraints. Read the necessary files with tools. Preserve existing user work and all unrelated code.',
        'Use existing verification evidence; run only checks needed for a concrete risk or the requirements. A test quota, document format, framework preference, or installer preference is not a product requirement.',
        strategy,
        progress.findings.length?`Resolve these observations with the smallest correct change:\n${progress.findings.join('\n')}`:'',
      ].filter(Boolean).join('\n\n'),context,false);
      if(edited.status==='cancelled')return finish('cancelled');
      const changes=await changedSince(options.workspace,before);progress.changedFiles=[...new Set([...progress.changedFiles,...changes])];
      if(isExternal(edited)&&edited.issue?.kind!=='context'&&changes.length===0){note(state,incident('transport',task.id,edited.issue?.message??'The editor is temporarily unavailable.',edited.text,true));progress.status='waiting';attemptedThisPass.add(task.id);await save(options,state);continue;}
      if(edited.issue?.kind==='constraint'&&edited.issue.message.startsWith('Restored forbidden HTTP effect')){
        progress.findings=[edited.issue.message];progress.status='pending';progress.strategy='constraint-repair';
        note(state,incident('instrument',task.id,'A forbidden effect was recovered automatically.',edited.issue.message));await save(options,state);continue;
      }
      if(edited.issue?.kind==='context'){
        const reduced=Math.floor((progress.contextChars??options.contextChars??24000)/2);progress.contextChars=reduced;
        const problem={...incident('integration',task.id,'The editor exhausted its actual context. Split this work unit using the smaller measured capacity and preserve all partial source.',edited.issue.message),contextChars:reduced};note(state,problem);
        const revised=await options.repairPlan?.(problem,task);
        if(revised&&JSON.stringify(revised)!==JSON.stringify(plan))plan=revised;
        progress.status='pending';progress.strategy='context-repair';await save(options,state);continue;
      }
      }
      const depsHash=await manifestHash(options.workspace);
      if(depsHash!==dependenciesPrepared){
        let prep=await prepareProjectDependencies(options.workspace,options.brief,execute,{terminal,...(options.allowSystemInstall!==undefined?{allowSystemInstall:options.allowSystemInstall}:{}),...(options.signal?{signal:options.signal}:{})});
        if(!prep.ready){
          const problem=prep.incidents[0]??incident('environment',task.id,'Dependencies are not ready.');note(state,{...problem,subject:task.id});
          if(prep.results.some(result=>result.issue?.kind==='rate-limit'||/ENETUNREACH|EAI_AGAIN|ETIMEDOUT|ECONNREFUSED/.test(`${result.stdout}\n${result.stderr}`))){progress.status='waiting';attemptedThisPass.add(task.id);await save(options,state);continue;}
          const repaired=await call(options,'repair','Repair only the development environment and dependency manifest responsible for this installation failure. Inspect the real cause, prefer a local isolated preparation, and keep product behavior intact. Do not change application code to work around an installer failure.',`${context}\nENVIRONMENT FAILURE\n${problem.message}\n${problem.evidence}`,false);
          if(repaired.status==='cancelled')return finish('cancelled');
          if(!isExternal(repaired))prep=await prepareProjectDependencies(options.workspace,options.brief,execute,{terminal,...(options.allowSystemInstall!==undefined?{allowSystemInstall:options.allowSystemInstall}:{}),...(options.signal?{signal:options.signal}:{})});
          if(!prep.ready){progress.findings=[];progress.strategy='environment-only';progress.status='waiting';attemptedThisPass.add(task.id);await save(options,state);continue;}
        }
        dependenciesPrepared=await manifestHash(options.workspace);
      }
      progress.status='checking';await save(options,state);
      const selected=selectVerifications(options.brief,task);
      if(selected.some(item=>item.replaced)){
        const problem=incident('instrument',task.id,'The selected verifier is incompatible with the product.',selected.filter(item=>item.replaced).map(item=>item.replaced).join('\n'));note(state,problem);
        const revised=await recoverVerifications(options,plan,task,context,problem);
        if(revised&&JSON.stringify(revised)!==JSON.stringify(plan)){plan=revised;progress.status='checking';progress.strategy='revalidate-only';await save(options,state);continue;}
        progress.status='waiting';progress.strategy='instrument';attemptedThisPass.add(task.id);await save(options,state);continue;
      }
      let checks=selected.filter(item=>!item.replaced).map(item=>item.check);
      for(const replaced of selected.filter(item=>item.replaced))observer(options,'recovery',replaced.replaced??'',task.id);
      if(checks.length===0||selected.some(item=>item.replaced))checks=[...checks,...await derivedChecks(options.workspace,task)];
      checks=[...new Map(checks.map(check=>{const{id:_id,...contract}=check;return[JSON.stringify(contract),check];})).values()];
      const failures:string[]=[],proof:string[]=[];
      let missingInstrument=false;
      for(const check of checks){
        if(check.kind==='desktop'&&!nativeTargetAvailable(check)){
          note(state,incident('environment',`target-${check.target}`,`The ${check.target} native proof needs a compatible runner. Local and independent work continues.`,check.command??'',true));continue;
        }
        const hash=await checkInputHash(options.workspace,plan,task,check,options.brief);
        const previous=state.evidence.find(value=>value.taskId===task.id&&value.checkId===check.id&&value.inputHash===hash&&value.passed);
        if(previous){proof.push(`${check.id}: previous observed proof still valid.\n${previous.output}`);continue;}
        observer(options,'verification',`${task.id}: verificando ${check.kind}.`,check.id);
        const verification=await runVerification(options.workspace,options.brief,task,plan,check,execute,terminal,{...(options.allowSystemInstall!==undefined?{allowSystemInstall:options.allowSystemInstall}:{}),...(options.signal?{signal:options.signal}:{})});
        state.evidence=state.evidence.filter(value=>!(value.taskId===task.id&&value.checkId===check.id));state.evidence.push(verification.evidence);await save(options,state);
        proof.push(`${check.id}: ${verification.evidence.passed?'passed':'needs correction'}\n${verification.evidence.output}`);
        if(!verification.evidence.passed){
          failures.push(`${verification.needsInstrument?'Instrument/environment':'Observed behavior'}: ${check.expected??check.command??check.kind}\n${verification.evidence.output}`);
          if(verification.needsInstrument)missingInstrument=true;
        }
      }
      if(failures.length){
        const signature=digest(`${await taskRevision(options,plan,task)}\n${failures.join('\n')}`);
        const repeated=progress.failureSignature===signature;progress.failureSignature=signature;
        if(repeated&&!missingInstrument){
          const problem=incident('integration',task.id,'The same negative proof repeated without a product change. Diagnose the cause before requesting another edit.',failures.join('\n'));note(state,problem);
          const diagnosis=await diagnoseRepeatedFailure({...options,contextChars:progress.contextChars??options.contextChars??24000},context,problem);
          if(!diagnosis){progress.status='waiting';progress.strategy='diagnose-failure';attemptedThisPass.add(task.id);await save(options,state);continue;}
          if(diagnosis.kind==='recheck'){progress.status='checking';progress.strategy='revalidate-only';await save(options,state);continue;}
          if(diagnosis.kind==='instrument'||diagnosis.kind==='plan'){
            const classified={...problem,kind:diagnosis.kind==='instrument'?'instrument' as const:'integration' as const,evidence:`${diagnosis.guidance}\n${problem.evidence}`};
            const revised=diagnosis.kind==='instrument'?await recoverVerifications(options,plan,task,context,classified):await options.repairPlan?.(classified,task);
            if(revised&&JSON.stringify(revised)!==JSON.stringify(plan)){plan=revised;progress.status='checking';progress.strategy='revalidate-only';await save(options,state);continue;}
            progress.status='waiting';progress.strategy='diagnose-failure';attemptedThisPass.add(task.id);await save(options,state);continue;
          }
          if(diagnosis.kind==='environment'){
            prepared.clear();dependenciesPrepared='';
            const repaired=await call(options,'repair','Repair only the development environment diagnosed below. Inspect the real readiness failure, preserve application behavior, and verify the dependency needed by this fragment.',`${context}\nDIAGNOSED ENVIRONMENT CAUSE\n${diagnosis.guidance}`,false);
            progress.status=isExternal(repaired)?'waiting':'checking';progress.strategy='environment-only';progress.findings=[];
            if(isExternal(repaired))attemptedThisPass.add(task.id);await save(options,state);continue;
          }
          progress.findings=[diagnosis.guidance];progress.status='pending';progress.strategy='partner-guidance';await save(options,state);continue;
        }
        if(missingInstrument){
          const problem=incident('instrument',task.id,'A verification recipe or its environment needs correction.',failures.join('\n'));
          note(state,problem);const revised=await recoverVerifications(options,plan,task,context,problem);
          if(revised&&JSON.stringify(revised)!==JSON.stringify(plan)){plan=revised;progress.findings=[];await save(options,state);continue;}
        }
        if(missingInstrument){progress.findings=[];progress.strategy='instrument';progress.status='waiting';attemptedThisPass.add(task.id);await save(options,state);continue;}
        progress.findings=failures;progress.strategy='focused-repair';progress.status='pending';observer(options,'recovery','Corrigindo a causa observada e preservando as provas não afetadas.',task.id);await save(options,state);continue;
      }
      progress.status='reviewing';await save(options,state);
      let reviewBudget=progress.contextChars??options.contextChars??24000;
      const makeReviewContext=async(budget:number):Promise<string>=>{
        const base=await taskContext({...options,contextChars:budget},plan,task,0.4);
        const proofBudget=Math.max(1,Math.floor(budget*0.25)),changedBudget=Math.max(1,Math.floor(budget*0.05));
        return `${base}\n\nOBSERVED VERIFICATION RESULTS\n${proof.map(value=>value.slice(-1500)).join('\n\n').slice(-proofBudget)}\n\nCHANGED FILES\n${progress.changedFiles.join('\n').slice(-changedBudget)}`;
      };
      let reviewContext=await makeReviewContext(reviewBudget);
      let reducedReview=false;
      let preceding='';
      let clarifications=0;
      for(;;){
        const review=await call(options,'reviewer',preceding
          ?'Clarify only the preceding conclusion about this same code. Identify a concrete remaining defect or confirm that the unit meets its criteria. A formatting issue is not a product defect. For a verification request, demonstrate the behavioral failure or cite the original user requirement mandating that test; missing tests alone is not a code defect. Do not ask the editor to rewrite correct code and do not review unrelated work. A compact JSON object {approved:true,findings:[]} is sufficient when no material defect remains.'
          :'Help the editor finish this work unit. Read its relevant code and actual evidence. Report only material defects against the supplied requirements or introduced regressions, with location, expected/observed behavior and a useful next repair. Do not invent new product requirements to fit a tool; fix the instrument instead. Do not require tests by count, style changes, a different installer, or document formatting. Return a compact JSON object {approved:true,findings:[]} when the unit fulfills its criteria. Otherwise use findings:[{file,expected,observed,evidence,fix}]. Partial field information is acceptable; substantive evidence matters.',
          preceding?`${reviewContext.slice(0,Math.floor(reviewBudget*0.8))}\nPRECEDING REVIEW\n${preceding.slice(-Math.floor(reviewBudget*0.15))}`:reviewContext,true);
        if(review.status==='cancelled')return finish('cancelled');
        if(review.issue?.kind==='context'){
          const reduced=Math.floor(reviewBudget/2);progress.contextChars=reduced;
          const problem={...incident('integration',task.id,'The reviewer exhausted its context. Preserve confirmed source and split only the affected work unit to the smaller capacity.',review.issue.message),contextChars:reduced};note(state,problem);
          if(!reducedReview){
            try{reviewContext=await makeReviewContext(reduced);reviewBudget=reduced;reducedReview=true;preceding='';await save(options,state);continue;}
            catch{/* The requirements themselves need splitting; never truncate them to make room. */}
          }
          const revised=await options.repairPlan?.(problem,task);
          if(revised&&JSON.stringify(revised)!==JSON.stringify(plan)){plan=revised;progress.status='checking';progress.strategy='revalidate-only';}
          else{progress.status='waiting';progress.strategy='resume-review';attemptedThisPass.add(task.id);}
          await save(options,state);break;
        }
        if(isExternal(review)){
          note(state,incident('transport',task.id,review.issue?.message??'Reviewer temporarily unavailable.',review.text,true));progress.status='waiting';progress.strategy='resume-review';attemptedThisPass.add(task.id);await save(options,state);break;
        }
        if(review.issue?.kind==='constraint'||review.changedFiles.length>0){
          progress.status='checking';progress.strategy='revalidate-only';progress.findings=[];
          note(state,incident('instrument',task.id,'The reviewer changed code or violated its read-only role. Revalidate affected evidence before another conclusion.',review.issue?.message??review.changedFiles.join(', ')));await save(options,state);break;
        }
        const judgment=interpretReview(review.text);
        judgment.findings=judgment.findings.filter(finding=>!unsupportedTestingDemand(finding,options.brief,task));
        if(judgment.approved){
          progress.status='complete';progress.findings=[];progress.strategy='verified';progress.revision=await taskRevision(options,plan,task);clearIncidents(state,task.id);observer(options,'task',`${task.id}: comportamento conferido.`,task.id);await save(options,state);break;
        }
        if(judgment.findings.length){
          progress.status='pending';progress.findings=judgment.findings;progress.strategy='partner-guidance';note(state,incident('product',task.id,'Reviewer identified a material pendency.',judgment.findings.join('\n')));await save(options,state);break;
        }
        // This loop has no editor edge: an unreadable review cannot cause a rewrite of correct code.
        preceding=`${review.issue?.message??''}\n${review.text}`;clarifications+=1;progress.strategy='clarify-review';
        note(state,incident('instrument',task.id,'The review conclusion is being clarified without changing the product.',review.text));
        observer(options,'recovery','Esclarecendo somente o parecer; o editor e o código confirmado permanecem intactos.',task.id);await save(options,state);
        if(clarifications>1)await new Promise<void>(resolve=>setTimeout(resolve,Math.min(10000,clarifications*1000)));
        if(options.signal?.aborted)return finish('cancelled');
      }
      await save(options,state);
    }
  }catch(error){
    note(state,incident('integration','execution','An execution operation needs recovery.',error instanceof Error?`${error.message}\n${error.stack??''}`:String(error)));
    observer(options,'recovery','Recuperando uma operação do motor; o coordenador mantém a execução ativa.');
    try{await save(options,state);}catch{/* The caller retains the in-memory state and can recover persistence. */}
    return finish(options.signal?.aborted?'cancelled':'waiting');
  }
}
