import { access, chmod, cp, mkdir, readFile, writeFile, unlink, rm } from 'node:fs/promises';
import { join, delimiter, isAbsolute, relative, dirname } from 'node:path';
import { ContextTooLarge, contextForTask, ordered, packetText } from '../domain/context.js';
import { allowedCapabilities } from '../domain/authority.js';
import { normalizeChecks } from '../domain/plan.js';
import { jsonObject } from '../domain/json.js';
import { reconcileChecks, reconcilePlan, validatePlan } from '../domain/reconcile.js';
import type { DevelopmentPlan, EnvironmentNode, Verification, WorkUnit } from '../domain/types.js';
import { executeCommand, runTerminal, verificationEnvironment } from '../runtime/index.js';
import type { AgentResult, CommandRequest, TerminalRequest } from '../runtime/types.js';
import { emitEvent, emitGate, emitProgress, type BuildGateId, type BuildGateStatus } from '../telemetry/progress.js';
import { changedSince, digest, inputHash, inputSnapshot, inside, introducedServers, restoreFiles, snapshot, sourceFiles } from './files.js';
import { declaredCheckInputs, resolveInputDependencies } from './dependencies.js';
import { applyOperationalEnvironment, emptyOperationalEnvironment, environmentFingerprint, executionConstraints, mergeOperationalEnvironments, prepareEnvironmentNode, prepareProjectDependencies, projectDependencyScope, relocateOperationalEnvironment, selectOperationalEnvironment, type OperationalEnvironment, type PreparedEnvironment } from './environment.js';
import { checkInputHash, derivedChecks, runVerification, selectVerifications, taskInputs, verificationLevel, type VerificationOutcome } from './checks.js';
import { createTaskWorkspace, fileDigest, IntegrationConflict, pathScopesConflict, prepareIntegration, publishIntegration, SerialQueue } from './isolation.js';
import { interpretReview, reviewFindingText } from './review.js';
import { validateConformance } from './conformance.js';
import type { ActionRecord, BuildIncident, BuildMetrics, BuildOptions, BuildOutcome, BuildState, TaskProgress, VerificationEvidence } from './types.js';
export { interpretReview } from './review.js';

const now = (): string => new Date().toISOString();
const external = (result: AgentResult): boolean => result.status === 'unavailable' && !result.issue || ['transport','authentication','rate-limit','capacity','configuration'].includes(result.issue?.kind ?? '');
const definitionHash = (task: WorkUnit): string => digest(JSON.stringify(task));
const exists = (path: string): Promise<boolean> => access(path).then(() => true, () => false);
const quote = (text: string): string => `'${text.replaceAll("'", "'\\''")}'`;
const declaredOutputs = (check: Verification): string[] => (check as Verification & {outputs?:string[]}).outputs ?? [];
class WorkPlanningError extends Error {}
const operationalValue = (value: unknown): OperationalEnvironment | undefined => value && typeof value === 'object' && 'revision' in value && 'bindings' in value ? value as OperationalEnvironment : undefined;

export function createBuildState(plan: DevelopmentPlan): BuildState {
  return { schema: 'capivara/build/1', controlVersion: 2, planRevision: plan.revision, tasks: {}, environment: {}, evidence: [], incidents: [], integrations: [], acceptance: [], updatedAt: now() };
}
function initialTask(): TaskProgress { return { status: 'pending', revision: '', attempts: 0, changedFiles: [], findings: [], strategy: 'implement', actions: [], reviews: [], noProgress: 0 }; }
function closure(plan: DevelopmentPlan, task: WorkUnit): EnvironmentNode[] {
  const nodes: EnvironmentNode[] = [], visited = new Set<string>();
  const visit = (id: string): void => { if (visited.has(id)) return; visited.add(id); const node = plan.environment.find(item => item.id === id); if (!node) return; node.dependsOn.forEach(visit); nodes.push(node); };
  task.environmentIds.forEach(visit); return nodes;
}
function incident(kind: BuildIncident['kind'], subject: string, message: string, evidence = '', externalResource = false): BuildIncident {
  return { id: digest(`${kind}:${subject}:${message}`).slice(0,20), kind, subject, message, evidence, external: externalResource, action: 'Resolve the classified cause or change the relevant input/provider; confirmed source and proofs remain preserved.' };
}
function conflict(plan: DevelopmentPlan, left: WorkUnit, right: WorkUnit, state: BuildState): boolean {
  const writes = (task: WorkUnit): string[] => [...new Set([...(task.files.length ? task.files : ['.']), ...state.tasks[task.id]?.changedFiles ?? []])];
  const a = writes(left), b = writes(right);
  if (a.some(path => b.some(other => pathScopesConflict(path, other))) || a.some(path => taskInputs(plan,right).some(other => pathScopesConflict(path,other))) || b.some(path => taskInputs(plan,left).some(other => pathScopesConflict(path,other)))) return true;
  const resources = (task: WorkUnit): string[] => {
    const declared = task.resources ?? [];
    const network = task.checks.some(check => ['web','desktop'].includes(check.kind) || check.requiredCapabilities.some(capability => ['http-server','browser','web-browser'].includes(capability)));
    return declared.length || !network ? declared : ['network:undeclared'];
  };
  if (resources(left).some(resource => resources(right).includes(resource))) return true;
  if ((left.exclusiveContracts ?? []).some(id => [...right.contractIds,...right.exclusiveContracts ?? []].includes(id)) || (right.exclusiveContracts ?? []).some(id => left.contractIds.includes(id))) return true;
  const exclusiveEnvironment = (task: WorkUnit): string[] => closure(plan,task).filter(node => ['service','database'].includes(node.kind) || node.identity?.kind === 'service').map(node => node.id);
  return exclusiveEnvironment(left).some(id => exclusiveEnvironment(right).includes(id));
}

/** Explicit persisted transitions, isolated workers and one FIFO publication coordinator. No sleep/retry loop owns execution. */
export async function runBuild(options: BuildOptions): Promise<BuildOutcome> {
  let plan = reconcilePlan(options.brief,options.plan,options.plan);
  const state = options.state ?? createBuildState(plan);
  state.controlVersion = 2; state.integrations ??= []; state.acceptance ??= [];
  const metrics: BuildMetrics = state.metrics ??= { startedAt: now(), elapsedMs: 0, maxConcurrency: 0, active: 0, callsByRole: {}, timeByStageMs: {}, invalidations: [], repetitions: [], timeline: [] };
  metrics.active = 0;
  const started = Date.now(), elapsedBefore = metrics.elapsedMs;
  const publication = new SerialQueue(), persistence = new SerialQueue();
  const nodeFlights = new Map<string, Promise<boolean>>(), replans = new Map<string, BuildIncident>();
  const workers = new Map<string, Promise<void>>(), attempted = new Set<string>();
  const integrationConflicts = new Set<string>();
  const capacity = Math.max(1, Math.min(64, Math.floor(options.maxConcurrent ?? 2)));
  const command = options.executeCommand ?? executeCommand, terminal = options.runTerminal ?? runTerminal;
  let cancelled = false, persistenceFailed = false, integrationBlocked = false;
  const measured=async<T>(stage:string,operation:()=>Promise<T>):Promise<T>=>{const start=Date.now();try{return await operation();}finally{metrics.timeByStageMs[stage]=(metrics.timeByStageMs[stage]??0)+Date.now()-start;}};
  const serial=async<T>(stage:string,operation:()=>Promise<T>):Promise<T>=>{const queued=Date.now();return publication.run(async()=>{metrics.timeByStageMs.queueWait=(metrics.timeByStageMs.queueWait??0)+Date.now()-queued;return measured(stage,operation);});};
  const event = (type: Parameters<NonNullable<BuildOptions['onEvent']>>[0]['type'], message: string, subject?: string, detail?: unknown): void => emitEvent(options.onEvent,{type,message,...(subject ? {subject} : {}),...(detail !== undefined ? {detail} : {})});
  const note = (problem: BuildIncident): void => { const index = state.incidents.findIndex(item => item.id === problem.id); if (index < 0) state.incidents.push(problem); else state.incidents[index] = problem; };
  const save = async (): Promise<void> => {
    state.planRevision = plan.revision; state.updatedAt = now(); metrics.elapsedMs = elapsedBefore + Date.now() - started;
    const value = structuredClone(state);
    await persistence.run(async () => { try { await options.onState?.(value); } catch (error) { persistenceFailed = true; note(incident('integration','persistence','Persistent state could not be committed; new agent work is suspended.',String(error),true)); } });
    const complete = plan.tasks.filter(task => state.tasks[task.id]?.status === 'complete').length;
    emitProgress(options.onEvent,{id:'tasks',label:'Tarefas concluídas',completed:complete,total:plan.tasks.length,status:complete === plan.tasks.length ? 'complete' : 'running',stage:'build',unit:'tarefas'});
    const ready = plan.environment.filter(node => state.environment[node.id]?.ready).length;
    emitProgress(options.onEvent,{id:'environment',label:'Pré-requisitos disponíveis',completed:ready,total:plan.environment.length,status:ready === plan.environment.length ? 'complete' : 'running',stage:'build',unit:'pré-requisitos'});
  };
  const gate = (task: WorkUnit,id: BuildGateId,status: BuildGateStatus,detail: string): void => emitGate(options.onEvent,{taskId:task.id,gate:id,status,attempt:state.tasks[task.id]?.attempts ?? 0,planRevision:plan.revision,detail});
  const transition = async (task: WorkUnit, status: TaskProgress['status'], reason: string): Promise<void> => {
    const progress = state.tasks[task.id]!; const before = progress.status;
    const allowed:Record<TaskProgress['status'],TaskProgress['status'][]>={pending:['pending','preparing','editing','checking','reviewing','integrating','waiting'],preparing:['preparing','editing','checking','waiting'],editing:['editing','checking','waiting'],checking:['checking','editing','reviewing','waiting'],reviewing:['reviewing','checking','editing','integrating','waiting'],integrating:['integrating','complete','waiting'],complete:['complete','checking','waiting'],waiting:['waiting','preparing','editing','checking','reviewing','integrating']};
    if(!allowed[before].includes(status))throw new Error(`Invalid task transition ${task.id}: ${before} -> ${status}.`);
    progress.status = status;
    event('transition',`${task.id}: ${before} → ${status}. ${reason}`,task.id,{before,after:status,reason}); await save();
  };
  const canonicalOperational = (task: WorkUnit): OperationalEnvironment => mergeOperationalEnvironments(options.workspace,...Object.entries(state.environment).filter(([key])=>key.startsWith('$project:')).sort(([,left],[,right])=>(left.preparedAt??'').localeCompare(right.preparedAt??'')).map(([,value])=>operationalValue(value.operational)),...closure(plan,task).map(node => operationalValue(state.environment[node.id]?.operational)));
  const revision = async (task: WorkUnit, workspace: string, operational: OperationalEnvironment): Promise<string> => {
    const checks = state.tasks[task.id]?.checks ?? task.checks;
    const proofs = await Promise.all(checks.map(check=>checkInputHash(workspace,plan,task,check,options.brief,operational)));
    return inputHash(workspace,taskInputs(plan,task),JSON.stringify({task,proofs,requirements:options.brief.requirements.filter(item => task.requirementIds.includes(item.id)),constraints:options.brief.constraints,contracts:plan.contracts.filter(item => task.contractIds.includes(item.id)),environment:operational.revision}));
  };
  const suspensionFingerprint = async (task: WorkUnit, progress: TaskProgress): Promise<string> => digest(JSON.stringify({canonical:await revision(task,options.workspace,canonicalOperational(task)),local:progress.checkpoint && await exists(progress.checkpoint.directory) ? await inputHash(progress.checkpoint.directory,taskInputs(plan,task)) : '',configuration:options.configurationRevision ?? '',checks:progress.checks,environment:closure(plan,task).map(node=>state.environment[node.id]?.fingerprint)}));
  const suspend = async (task: WorkUnit,kind: BuildIncident['kind'],reason: string,evidence = '',resource = false): Promise<void> => {
    const progress = state.tasks[task.id]!; note(incident(kind,task.id,reason,evidence,resource));
    progress.suspension = { fingerprint: await suspensionFingerprint(task,progress), reason, action: kind };
    await transition(task,'waiting',reason); gate(task,kind === 'product' ? 'G3' : 'G0','waiting',reason);
  };
  const context = async (task: WorkUnit, workspace: string, extra = ''): Promise<string> => {
    const limit = state.tasks[task.id]?.contextChars ?? options.contextChars ?? 24000;
    const packet = packetText(contextForTask(options.brief,plan,task,Math.floor(limit * .5)));
    const snippets: string[] = []; let remaining = Math.max(0,limit - packet.length - Math.min(extra.length,Math.floor(limit*.3)) - 150);
    for (const path of task.files) { if (remaining <= 0) break; const source = await readFile(inside(workspace,path),'utf8').catch(()=>null); if (source === null) continue; const excerpt = source.slice(0,Math.min(2400,remaining)); snippets.push(`FILE ${path}\n${excerpt}`); remaining -= excerpt.length + path.length + 20; }
    return `${packet}\n${snippets.join('\n')}\n${extra.slice(-Math.floor(limit*.3))}`.slice(0,limit);
  };
  const invoke = async (task: WorkUnit,workspace: string,role: string,instruction: string,extra: string,readOnly: boolean,strategy: string,operational: OperationalEnvironment): Promise<AgentResult> => {
    const progress = state.tasks[task.id]!; progress.actions ??= [];
    if (options.signal?.aborted || persistenceFailed) return {status:'cancelled',text:'',commands:[],changedFiles:[]};
    const suppliedContext = await context(task,workspace,extra);
    const input = digest(JSON.stringify({role,strategy,instruction,context:suppliedContext,source:await inputHash(workspace,taskInputs(plan,task)),environment:operational.revision,configuration:options.configurationRevision ?? '',resourceAttempt:progress.retryGeneration ?? 0}));
    const previous = progress.actions.findLast(action => action.id === input && action.result && action.outcome !== 'cancelled');
    if (previous?.result) { metrics.repetitions.push({taskId:task.id,action:role,reason:`Reused persisted result: same input and strategy (${strategy}).`,at:now()}); return structuredClone(previous.result); }
    const unresolved = progress.actions.findLast(action => action.id === input && action.outcome === 'running');
    if (unresolved) return {status:'unavailable',text:'',commands:[],changedFiles:[],issue:{kind:'instrument',recoverable:true,message:'The preceding identical operation was interrupted without a recorded result. Inspect its persisted workspace before requesting another action.'}};
    const action: ActionRecord = {id:input,action:role,input,strategy,reason:extra.slice(0,1200) || 'Initial implementation of this work unit.',at:now(),durationMs:0,outcome:'running'};
    progress.actions.push(action); await save();
    const before = await snapshot(workspace); const begin = Date.now();
    const timeline = {taskId:task.id,stage:role,start:begin}; metrics.timeline.push(timeline);
    metrics.active++; metrics.maxConcurrency = Math.max(metrics.maxConcurrency,metrics.active); metrics.callsByRole[role] = (metrics.callsByRole[role] ?? 0) + 1;
    const environment = await verificationEnvironment(workspace,operational.env);
    // Concrete aliases are materialized locally so API shell tools consume the same provider as the verifier.
    const bin = join(workspace,'.capivara-runtime','bin'); await mkdir(bin,{recursive:true});
    for (const binding of Object.values(operational.bindings)) if (binding.command?.length && (isAbsolute(binding.command[0]!) || binding.command[0]!.includes('/'))) for (const alias of binding.aliases ?? []) {
      if (!/^[a-zA-Z0-9._+-]+$/.test(alias)) continue;
      const path = join(bin,process.platform === 'win32' ? `${alias}.cmd` : alias);
      await writeFile(path,process.platform === 'win32' ? `@echo off\r\n${binding.command.map(part=>`"${part.replaceAll('"','""')}"`).join(' ')} %*\r\n` : `#!/bin/sh\nexec ${binding.command.map(quote).join(' ')} "$@"\n`); await chmod(path,0o755);
    }
    environment.PATH = `${bin}${delimiter}${environment.PATH ?? process.env.PATH ?? ''}`;
    let result: AgentResult;
    try { result = await options.agent({workspace,role,operationKey:input,instruction,context:suppliedContext,readOnly,environment,constraints:executionConstraints(options.brief,options.allowSystemInstall),...(options.signal ? {signal:options.signal} : {}),onEvent: detail=>emitEvent(options.onEvent,detail)}); }
    catch (error) { result = {status:'unavailable',text:'',commands:[],changedFiles:[],issue:{kind:'transport',recoverable:true,message:String(error)}}; }
    const changes = await changedSince(workspace,before);
    if (readOnly && changes.length) {
      await restoreFiles(workspace,before,changes);
      result = {...result,status:'partial',changedFiles:changes,issue:{kind:'instrument',recoverable:true,message:`Read-only inspection changed product files; its original source was restored: ${changes.join(', ')}.`}};
    } else if (!readOnly && !allowedCapabilities(options.brief,['http-server'])) {
      const forbidden = await introducedServers(workspace,before);
      if (forbidden.length) { await restoreFiles(workspace,before,forbidden); result = {...result,status:'partial',issue:{kind:'constraint',recoverable:true,message:`Restored forbidden HTTP effect in ${forbidden.join(', ')}. Preserve the requested interface and repair only the observed cause.`}}; }
    }
    const actual = await changedSince(workspace,before); result.changedFiles = actual;
    action.durationMs = Date.now() - begin; action.after = await inputHash(workspace,taskInputs(plan,task));
    action.outcome = result.status === 'cancelled' ? 'cancelled' : actual.length ? 'changed' : result.status === 'complete' ? 'unchanged' : 'failed'; action.result = structuredClone(result);
    if (result.issue) action.failure = result.issue.message;
    metrics.active--; metrics.timeByStageMs[role] = (metrics.timeByStageMs[role] ?? 0) + action.durationMs; Object.assign(timeline,{end:Date.now()});
    progress.changedFiles = [...new Set([...progress.changedFiles,...actual])]; await save(); return result;
  };
  const preparations = async (task: WorkUnit): Promise<boolean> => {
    for (const node of closure(plan,task)) {
      const flightKey = `${node.id}:${await environmentFingerprint(options.workspace,node,operationalValue(state.environment[node.id]?.operational))}`;
      let flight = nodeFlights.get(flightKey);
      if (!flight) {
        flight = serial('environmentPreparation',async () => {
          if (integrationBlocked || persistenceFailed) return false;
          const previous = state.environment[node.id];
          const base = mergeOperationalEnvironments(options.workspace,...node.dependsOn.map(id=>operationalValue(state.environment[id]?.operational)));
          let result = await prepareEnvironmentNode(options.workspace,node,options.brief,command,{operational:base,...(options.signal?{signal:options.signal}:{}),allowSystemInstall:options.allowSystemInstall === true,terminal,onEvent:detail=>emitEvent(options.onEvent,detail),...(previous?.fingerprint ? {previous:{ready:previous.ready,fingerprint:previous.fingerprint,operational:operationalValue(previous.operational) ?? base,...(previous.failedFingerprint?{noProgress:true}: {})}} : {})});
          if (!result.ready) {
            const input = result.fingerprint;
            const answer = await invoke(task,options.workspace,'repair','Prepare only this exact missing capability, with its declared kind and provider. Inspect the host, install locally and expose a concrete invocation. A driver, CLI, library and service are different capabilities. Preserve all application behavior. Return any changed invocation as JSON {provides:{command,paths,env,inputs}}.',`ENVIRONMENT NODE\n${JSON.stringify(node)}\nFAILURE\n${result.incidents.map(item=>item.evidence||item.message).join('\n')}`,false,`environment:${node.id}:${input}`,result.operational);
            if (answer.status !== 'cancelled' && !external(answer)) {
              const proposal = jsonObject(answer.text);
              if (proposal?.provides && typeof proposal.provides === 'object') {
                const provides = proposal.provides as EnvironmentNode['provides'];
                node.provides = {...node.provides,...provides};
              }
              result = await prepareEnvironmentNode(options.workspace,node,options.brief,command,{previous:result.cache,revalidate:true,operational:result.operational,allowSystemInstall:options.allowSystemInstall === true,terminal,...(options.signal?{signal:options.signal}:{}),onEvent:detail=>emitEvent(options.onEvent,detail)});
            }
          }
          state.environment[node.id] = {ready:result.ready,inputHash:digest(JSON.stringify(node)),fingerprint:result.fingerprint,operational:result.operational,...(!result.ready?{failedFingerprint:result.fingerprint}:{})};
          for (const problem of result.incidents) note(problem); await save(); return result.ready;
        });
        nodeFlights.set(flightKey,flight);
      }
      if (!await flight) return false;
    }
    return serial('dependencies',async()=>{
      if(integrationBlocked||persistenceFailed)return false;
      const inputs=taskInputs(plan,task),checks=state.tasks[task.id]?.checks??task.checks;const key=`$project:${projectDependencyScope(inputs,checks)}`;
      const previous=state.environment[key];const base=canonicalOperational(task);
      const result=await prepareProjectDependencies(options.workspace,options.brief,request=>command(applyOperationalEnvironment(request,base)),{inputs:taskInputs(plan,task),checks:state.tasks[task.id]?.checks??task.checks,operational:emptyOperationalEnvironment(options.workspace),terminal,allowSystemInstall:options.allowSystemInstall===true,...(options.signal?{signal:options.signal}:{}),...(previous?.fingerprint?{previous:{ready:previous.ready,fingerprint:previous.fingerprint,operational:operationalValue(previous.operational)??emptyOperationalEnvironment(options.workspace),...(previous.failedFingerprint?{noProgress:true}: {})}}:{}),onEvent:detail=>emitEvent(options.onEvent,detail)});
      state.environment[key]={ready:result.ready,inputHash:result.fingerprint,fingerprint:result.fingerprint,operational:selectOperationalEnvironment(result.operational,inputs,checks),preparedAt:now(),...(!result.ready?{failedFingerprint:result.fingerprint}:{})};
      if(!state.tasks[task.id]!.dependencyCache)state.tasks[task.id]!.dependencyCache=result.cache;
      for(const problem of result.incidents)note(problem);await save();return result.ready;
    });
  };
  const projectDependencies = async (task: WorkUnit,workspace: string,operational: OperationalEnvironment): Promise<OperationalEnvironment | null> => {
    const progress = state.tasks[task.id]!;
    const old=progress.dependencyCache as PreparedEnvironment|undefined;
    const previous=old?{...old,operational:old.operational.root&&old.operational.root!==workspace?relocateOperationalEnvironment(old.operational,old.operational.root,workspace):old.operational}:undefined;
    const result = await measured('dependencies',()=>prepareProjectDependencies(workspace,options.brief,command,{inputs:taskInputs(plan,task),checks:progress.checks??task.checks,operational,terminal,allowSystemInstall:options.allowSystemInstall === true,...(options.signal?{signal:options.signal}:{}),...(previous?{previous}:{}),onEvent:detail=>emitEvent(options.onEvent,detail)}));
    progress.dependencyCache = result.cache; await save();
    if (result.ready) return result.operational;
    for (const problem of result.incidents) note({...problem,subject:task.id});
    const answer = await invoke(task,workspace,'repair','Repair only the dependency preparation and exact local provider responsible for this failure. Reconcile the manifest or install locally; do not change product behavior or replace a mandatory stack.',result.incidents.map(item=>`${item.message}\n${item.evidence}`).join('\n'),false,`project-environment:${result.fingerprint}`,operational);
    if (answer.status === 'cancelled' || external(answer)) return null;
    const again = await measured('dependencies',()=>prepareProjectDependencies(workspace,options.brief,command,{inputs:taskInputs(plan,task),checks:progress.checks??task.checks,previous:result.cache,revalidate:true,operational:result.operational,terminal,allowSystemInstall:options.allowSystemInstall === true,...(options.signal?{signal:options.signal}:{}),onEvent:detail=>emitEvent(options.onEvent,detail)}));
    progress.dependencyCache = again.cache; await save(); return again.ready ? again.operational : null;
  };
  const repairRecipe = async (task: WorkUnit,workspace: string,operational: OperationalEnvironment,reason: string,requiredKind?: Verification['kind']): Promise<boolean> => {
    const progress = state.tasks[task.id]!;
    const answer = await invoke(task,workspace,'repair','Repair only the verification recipe for this existing work unit. Inspect the actual entrypoint and evidence; preserve product files, requirements and interface. Return JSON {checks:[{kind,command,args,expected,expectedExitCode,input,steps,closeInput,requiredCapabilities,target,inputs,level}]}. TUI steps must observe literal ready output before input and a new literal state after input. Do not require more tests by count.',`INSTRUMENT TO RECOVER\n${reason}`,true,`instrument:${digest(reason)}`,operational);
    if (answer.status === 'cancelled' || external(answer) || answer.issue) return false;
    const value = jsonObject(answer.text);
    const checks = normalizeChecks(value?.checks,options.brief).map(check=>({...check,requirementIds:check.requirementIds.length?check.requirementIds:task.requirementIds})).filter(check=>(!requiredKind || check.kind === requiredKind) && check.command && selectVerifications(options.brief,{...task,checks:[check]}).every(item=>!item.replaced));
    const key = (items: Verification[]): string => digest(JSON.stringify(items.map(({id:_id,...item})=>item)));
    if (!checks.length || key(checks) === key(progress.checks ?? task.checks)) return false;
    progress.checks = reconcileChecks(checks); progress.strategy = 'revalidate-only'; event('recovery','Receita alterada; o código do produto permanece preservado.',task.id); await save(); return true;
  };
  const verify = async (task: WorkUnit,workspace: string,operational: OperationalEnvironment,checks: Verification[]): Promise<VerificationOutcome[]> => {
    const order=ordered(checks.map(check=>({...check,dependsOn:check.dependsOn??[]})));
    if(order.unresolved.length)throw new WorkPlanningError(`Verification dependencies are cyclic or missing: ${order.unresolved.map(check=>check.id).join(', ')}.`);
    checks=order.ready.map(item=>checks.find(check=>check.id===item.id)!);
    const owner=state.tasks[task.id];
    const selectors=[...new Set(checks.flatMap(check=>[...declaredCheckInputs(plan,task,check),...declaredOutputs(check)]))];
    const sourceHash=await inputHash(workspace,await resolveInputDependencies(workspace,selectors),operational.revision);
    let area=owner?.verificationCheckpoint;
    if(!area||area.sourceHash!==sourceHash||!await exists(area.directory)){
      const copied=await measured('verificationIsolation',()=>createTaskWorkspace(workspace,`${task.id}:proofs`,definitionHash(task),[...task.files,...checks.flatMap(declaredOutputs)]));
      area={directory:copied.directory,sourceHash};if(owner){owner.verificationCheckpoint=area;await save();}
    }
    const local=relocateOperationalEnvironment(operational,workspace,area.directory);
    const results: VerificationOutcome[] = []; const groups = new Map<BuildGateId,BuildGateStatus[]>();
    for (const check of checks) {
      const id: BuildGateId = ['web','tui','desktop'].includes(check.kind) ? 'G4' : 'G2';
      const completed = groups.get(id) ?? []; groups.set(id,completed); gate(task,id,'running','Executando a prova pertinente em área isolada gravável.');
      const hash = await checkInputHash(area.directory,plan,task,check,options.brief,local);
      const artifactState=await inputSnapshot(area.directory,declaredOutputs(check));
      const cached = state.evidence.findLast(item=>item.taskId===task.id&&item.checkId===check.id&&item.inputHash===hash&&(item.passed||item.classification==='product'||item.classification==='instrument')&&(!declaredOutputs(check).length||JSON.stringify(item.artifacts)===JSON.stringify(artifactState)));
      if (cached) results.push({evidence:{...cached,level:cached.level ?? verificationLevel(check),inputs:cached.inputs ?? []},result:null,classification:cached.passed?null:cached.classification??'product',needsInstrument:!cached.passed&&cached.classification==='instrument'});
      else {
        const env = await verificationEnvironment(area.directory);
        const execute = (request: CommandRequest) => command(applyOperationalEnvironment({...request,environment:{...env,...request.environment},executionPolicy:{purpose:'verification',writeScope:'isolated-workspace'}},local));
        const pty = (request: TerminalRequest) => terminal(applyOperationalEnvironment({...request,environment:{...env,...request.environment},executionPolicy:{purpose:'verification',writeScope:'isolated-workspace'}},local));
        const start = Date.now(); const result = await runVerification(area.directory,options.brief,task,plan,check,execute,pty,{operational:local,allowSystemInstall:options.allowSystemInstall === true,...(options.signal?{signal:options.signal}:{}),onEvent:detail=>emitEvent(options.onEvent,detail)});
        result.evidence.command=result.evidence.command.replaceAll(area.directory,workspace);result.evidence.output=result.evidence.output.replaceAll(area.directory,workspace);
        if(declaredOutputs(check).length)result.evidence.artifacts=await inputSnapshot(area.directory,declaredOutputs(check));
        metrics.timeByStageMs.verification = (metrics.timeByStageMs.verification ?? 0) + Date.now() - start;
        state.evidence.push(result.evidence); results.push(result); await save();
      }
      const result = results.at(-1)!; completed.push(result.evidence.passed ? 'complete' : result.classification === 'transport' || result.classification === 'environment' ? 'waiting' : 'returned');
      gate(task,id,completed.includes('returned')?'returned':completed.includes('waiting')?'waiting':'complete',`${completed.filter(value=>value==='complete').length}/${completed.length} provas confirmadas.`);
      emitProgress(options.onEvent,{id:'verification',label:`${task.id}: verificações avaliadas`,completed:results.length,total:checks.length,status:results.length===checks.length?'complete':'running',stage:'build',unit:'verificações'});
      if (options.signal?.aborted) break;
    }
    if(results.length===checks.length&&results.every(result=>result.evidence.passed)){
      const outputs=[...new Set(checks.flatMap(declaredOutputs))];
      const delivered=await sourceFiles(area.directory,outputs);
      for(const path of await sourceFiles(workspace,outputs))if(!delivered.includes(path))await unlink(inside(workspace,path));
      for(const path of delivered){const destination=inside(workspace,path);await mkdir(dirname(destination),{recursive:true});await cp(inside(area.directory,path),destination,{preserveTimestamps:true});}
      for(let index=0;index<checks.length;index++){
        const current=await checkInputHash(workspace,plan,task,checks[index]!,options.brief,operational);
        if(current!==results[index]!.evidence.inputHash)throw new WorkPlanningError(`Proof ${checks[index]!.id} consumes a generated or mutated input without an owned declared output. Declare its producer outputs and verification dependency instead of replaying the proof.`);
      }
      if(owner){area.sourceHash=await inputHash(workspace,await resolveInputDependencies(workspace,selectors),operational.revision);await save();}
    }
    if (!checks.some(check=>!['web','tui','desktop'].includes(check.kind))) gate(task,'G2','neutral','Nenhuma verificação mecânica adicional é pertinente.');
    return results;
  };
  const requireInterface = (task: WorkUnit,results: VerificationOutcome[]): Verification['kind'] | undefined => {
    const modes = options.brief.requirements.filter(item=>task.requirementIds.includes(item.id)).map(item=>item.mode);
    return (['tui','web','desktop','cli'] as const).find(mode=>modes.includes(mode)&&!results.some(result=>result.evidence.passed&&result.evidence.kind===mode&&result.evidence.level==='behavior'));
  };
  const recoverAcceptance=async(failure:VerificationOutcome,check:Verification,work:WorkUnit,workspace:string,operational:OperationalEnvironment):Promise<boolean>=>{
    note(incident(failure.classification??'instrument',check.id,'Mandatory acceptance did not pass.',failure.evidence.output));
    const fingerprint=digest(JSON.stringify({check,input:failure.evidence.inputHash,classification:failure.classification}));state.acceptanceRecovery??={};
    if(state.acceptanceRecovery[fingerprint])return false;
    state.acceptanceRecovery[fingerprint]=failure.classification??'instrument';await save();
    const consumers=plan.tasks.filter(task=>task.requirementIds.some(id=>check.requirementIds.includes(id)));
    const paths=[...(check.inputs??[]),...(check.conformance?.productInputs??[])];
    const scoped=paths.length?consumers.filter(task=>task.files.some(file=>paths.some(path=>pathScopesConflict(file,path)))):consumers;
    const leaves=scoped.filter(task=>!scoped.some(other=>other.dependsOn.includes(task.id)));
    const owner=leaves.length===1?leaves[0]:scoped.length===1?scoped[0]:undefined;
    if(failure.classification==='instrument'){
      const recovery:WorkUnit={...work,id:`$acceptance:${check.id}`,title:`Recover ${check.id}`,requirementIds:check.requirementIds,files:paths,inputs:paths,checks:[check],criteria:[check.expected??'Restore an executable proof of this mandatory outcome.']};
      const progress=state.tasks[recovery.id]??=initialTask();progress.checks=[check];
      if(await repairRecipe(recovery,workspace,operational,failure.evidence.output)){
        state.acceptanceChecks=reconcileChecks((state.acceptanceChecks??[]).flatMap(item=>item.id===check.id?progress.checks??[item]:[item]));
        metrics.repetitions.push({taskId:recovery.id,action:'acceptance-instrument',reason:'An actual failed final recipe was replaced; the original verdict and code were preserved.',at:now()});await save();return true;
      }
    }
    if(failure.classification==='product'&&owner){
      const progress=state.tasks[owner.id]!;progress.checks=reconcileChecks([...(progress.checks??owner.checks),{...check,requirementIds:check.requirementIds.filter(id=>owner.requirementIds.includes(id))}]);
      progress.findings=[`Mandatory acceptance ${check.id} failed against the integrated product.\n${failure.evidence.output}`];progress.status='checking';progress.strategy='acceptance-repair';delete progress.checkpoint;delete progress.verificationCheckpoint;delete progress.suspension;attempted.delete(owner.id);
      metrics.repetitions.push({taskId:owner.id,action:'acceptance-repair',reason:`New negative final proof ${check.id} is owned by this delivery; independent accepted units are preserved.`,at:now()});await save();return true;
    }
    if(options.repairPlan){const anchor=owner??consumers[0]??plan.tasks[0];if(anchor){replans.set(anchor.id,incident('planning',check.id,'Mandatory acceptance needs a reconciled owner, provider or verification contract.',failure.evidence.output));return true;}}
    note(incident('planning',check.id,'No executable acceptance-recovery path is available for this classified failure.',failure.evidence.output));return false;
  };
  const runTask = async (task: WorkUnit): Promise<void> => {
    const progress = state.tasks[task.id] ??= initialTask(); progress.actions ??= []; progress.reviews ??= [];
    try {
      if(options.retrySuspended&&progress.suspension&&['environment','transport'].includes(progress.suspension.action)){
        progress.retryGeneration=(progress.retryGeneration??0)+1;delete progress.suspension;
        metrics.repetitions.push({taskId:task.id,action:'resource-probe',reason:'Explicit request to probe a suspended external resource once.',at:now()});await save();
      }
      if (!await preparations(task)) { await suspend(task,'environment','No usable provider is ready for this work unit.','Dependency preparation did not change readiness.',true); return; }
      if (progress.suspension && progress.suspension.fingerprint === await suspensionFingerprint(task,progress)) { attempted.add(task.id); event('waiting',progress.suspension.reason,task.id); return; }
      delete progress.suspension;
      const taskHash = definitionHash(task);
      if (!progress.checkpoint || progress.checkpoint.taskHash !== taskHash || !await exists(progress.checkpoint.directory)) {
        const phase = progress.status === 'checking' || progress.status === 'reviewing' || progress.status === 'complete' ? 'checking' : 'editing';
        progress.checkpoint = await serial('isolation',async()=>{ if(integrationBlocked||persistenceFailed)throw new Error('Canonical publication is blocked; the private work remains preserved.');return createTaskWorkspace(options.workspace,task.id,taskHash,task.files); }); progress.checkpoint.phase = phase; await save();
      }
      const workspace = progress.checkpoint.directory;
      let operational = relocateOperationalEnvironment(canonicalOperational(task),options.workspace,workspace);
      for (;;) {
        if (options.signal?.aborted || persistenceFailed || integrationBlocked) { cancelled = options.signal?.aborted === true; return; }
        const controlState=digest(JSON.stringify({phase:progress.checkpoint.phase,input:await revision(task,workspace,operational),strategy:progress.strategy,findings:progress.findings,reviewFailure:progress.reviewFailureSignature,configuration:options.configurationRevision??'',resourceGeneration:progress.retryGeneration??0}));
        progress.controlStates??=[];
        if(progress.controlStates.includes(controlState)){
          const problem=incident('integration',task.id,'No progress: the same execution state has no unused recovery transition.',JSON.stringify({phase:progress.checkpoint.phase,strategy:progress.strategy,input:controlState}));replans.set(task.id,problem);await suspend(task,'integration',problem.message,problem.evidence);return;
        }
        progress.controlStates.push(controlState);await save();
        if (progress.checkpoint.phase === 'editing') {
          await transition(task,'editing',progress.findings.length ? 'Repairing an observed material defect.' : 'Implementing the planned delivery.'); progress.attempts++; await save();
          gate(task,'G0','running','Sessão do editor em execução.'); gate(task,'G1','running','Edição da unidade isolada.');
          const result = await invoke(task,workspace,progress.attempts === 1 ? 'editor' : 'repair','Implement the small work unit in this workspace. Preserve unrelated user work, mandatory providers and the requested interface. Correct only supplied concrete observations; a test quota is not an application requirement.',progress.findings.join('\n'),false,progress.strategy,operational);
          gate(task,'G0',result.status==='complete'&&!result.issue?'complete':external(result)?'waiting':'returned',result.issue?.message ?? 'A sessão terminou com resultado utilizável.');
          gate(task,'G1',result.changedFiles.length?'complete':'neutral',result.changedFiles.length?`${result.changedFiles.length} arquivo(s) alterado(s).`:'Sem alteração de arquivos; isso não reprova a unidade.');
          progress.checkpoint.phase = result.changedFiles.length || result.status === 'complete' ? 'checking' : 'editing'; await save();
          if (result.status === 'cancelled' || options.signal?.aborted) { cancelled = true; return; }
          if (external(result)) { await suspend(task,'transport','Agent transport cannot make progress with the current configuration.',result.issue?.message ?? result.text,true); return; }
          if (result.issue?.kind === 'context') {
            const problem = incident('planning',task.id,'The delivery exceeds the measured agent context; split it while preserving existing files.',result.issue.message);problem.contextChars=Math.max(256,Math.floor((progress.contextChars??options.contextChars??24000)/2));progress.contextChars=problem.contextChars;replans.set(task.id,problem); await suspend(task,'planning',problem.message,problem.evidence); return;
          }
          if (result.issue?.kind === 'constraint') {
            progress.findings = [result.issue.message]; progress.strategy = 'constraint-repair'; progress.checkpoint.phase = 'editing';continue;
          }
        }
        const prepared = await projectDependencies(task,workspace,operational);
        if (!prepared) { await suspend(task,'environment','Dependency recovery made no usable operational progress.','The consumer still cannot use its selected provider.',true); return; }
        operational = prepared;
        if (progress.checkpoint.phase === 'checking') {
          await transition(task,'checking','Checking only relevant, current proof inputs.');
          const selected = selectVerifications(options.brief,{...task,checks:progress.checks ?? task.checks});
          if (selected.some(item=>item.replaced)) {
            if (await repairRecipe(task,workspace,operational,selected.filter(item=>item.replaced).map(item=>item.replaced).join('\n'))) continue;
            await suspend(task,'instrument','No compatible verification recipe is available.',selected.map(item=>item.replaced).join('\n')); return;
          }
          let checks = selected.map(item=>item.check);
          if (!checks.length) checks = await derivedChecks(workspace,task);
          progress.checks = reconcileChecks(checks); await save();
          const results = await verify(task,workspace,operational,progress.checks);
          if (options.signal?.aborted) { cancelled = true; return; }
          const failures = results.filter(result=>!result.evidence.passed);
          if (failures.length) {
            const detail = failures.map(result=>`${result.classification}: ${result.evidence.checkId}\n${result.evidence.output.replaceAll(workspace,'$WORKSPACE')}`).join('\n');
            const signature = digest(detail); progress.noProgress = progress.failureSignature === signature ? (progress.noProgress ?? 0) + 1 : 1; progress.failureSignature = signature;
            metrics.repetitions.push({taskId:task.id,action:'verify',reason:`Observed ${failures.length} failed proofs; consecutive identical failure ${progress.noProgress}.`,at:now()}); await save();
            if (failures.some(result=>result.classification==='transport'||result.classification==='environment')) { await suspend(task,failures.some(result=>result.classification==='environment')?'environment':'transport','A verification resource is unavailable; confirmed work is preserved.',detail,true); return; }
            if (failures.some(result=>result.classification==='instrument')) {
              if ((progress.noProgress ?? 0) <= 2 && await repairRecipe(task,workspace,operational,detail)) continue;
              await suspend(task,'instrument','Verification recovery produced no different executable instrument.',detail); return;
            }
            progress.findings = failures.map(result=>result.evidence.output);
            if ((progress.noProgress ?? 0) === 1) { progress.strategy = 'targeted-repair'; progress.checkpoint.phase = 'editing'; await save(); continue; }
            if ((progress.noProgress ?? 0) === 2) {
              const diagnosis = await invoke(task,workspace,'reviewer','Diagnose this repeated failure without changing code. Return JSON {kind:"product"|"instrument"|"environment"|"plan",cause,fix}. Explain a different, concrete smaller action; do not repeat the unchanged repair.',detail,true,'diagnose-failure',operational);
              const explanation = jsonObject(diagnosis.text); const kind = String(explanation?.kind ?? ''); const fix = [explanation?.cause,explanation?.fix].filter(item=>typeof item==='string').join('\n');
              if (kind === 'instrument' && fix && await repairRecipe(task,workspace,operational,`${detail}\n${fix}`)) continue;
              if (kind === 'plan') { replans.set(task.id,incident('planning',task.id,'Repeated failure requires a different delivery boundary.',fix)); await suspend(task,'planning','The current delivery cannot progress without reconciliation.',fix); return; }
              if (kind === 'product' && fix) { progress.findings = [fix]; progress.strategy = `guided-repair:${digest(fix)}`; progress.checkpoint.phase = 'editing'; await save(); continue; }
            }
            const problem = incident('integration',task.id,'No progress: the same failed proof survived the targeted repair and independent diagnosis.',detail); replans.set(task.id,problem); await suspend(task,'integration',problem.message,detail); return;
          }
          const requiredKind = requireInterface(task,results);
          if (requiredKind) {
            if (await repairRecipe(task,workspace,operational,`The work unit requires actual ${requiredKind} interaction; syntax or compilation alone does not establish its behavior. Observed proofs:\n${results.map(result=>result.evidence.output).join('\n')}`,requiredKind)) continue;
            await suspend(task,'instrument',`The requested ${requiredKind} behavior has no observed compatible proof.`); return;
          }
          progress.noProgress = 0; progress.findings = []; progress.checkpoint.phase = 'reviewing'; await save();
        }
        if (progress.checkpoint.phase === 'reviewing') {
          await transition(task,'reviewing','Inspection is read-only; executable evidence was collected separately.');
          const hash = await revision(task,workspace,operational);
          const approved = progress.reviews.findLast(item=>item.inputHash===hash&&item.assessment.decision==='approved');
          if (!approved) {
            let accepted = false;
            for (let clarification = 0; clarification < 2; clarification++) {
              gate(task,'G3','running',clarification?'Esclarecendo o parecer sem nova edição.':'Revisão independente das evidências e do código.');
              const previous = progress.reviews.filter(item=>item.inputHash===hash).at(-1);
              const evidence = state.evidence.filter(item=>item.taskId===task.id).slice(-Math.max(1,progress.checks?.length ?? 1)).map(item=>item.output).join('\n');
              const result = await invoke(task,workspace,'reviewer',clarification ? 'Clarify only the preceding review of these same files. Identify a material expected/observed defect linked to a supplied criterion, or explicitly approve. An instrument restriction, absent test quota or unreadable format is not grounds to edit correct code. Return one JSON {approved,findings:[{kind,file,observed,expected,evidence,fix,evidenceType,verification}]}.' : 'Inspect this work unit and its actual evidence without executing mutating verification commands. Return one JSON {approved:true,findings:[]} if its supplied criteria and mandatory stack are fulfilled, otherwise findings:[{kind,file,observed,expected,evidence,fix}]. Report only material product defects; classify instrument, environment and planning failures separately. A runtime claim must cite existing verification evidence or declare evidenceType:"inspection-command" with a concrete verification recipe for independent writable reproduction. Static source findings use evidenceType:"source" with location and expected/observed behavior.',`${evidence}${clarification&&previous?`\nPRECEDING REVIEW\n${previous.assessment.original}`:''}`,true,clarification?'clarify-review':'review',operational);
              if (result.status === 'cancelled' || options.signal?.aborted) { cancelled = true; return; }
              if (external(result)) { progress.strategy = 'resume-review'; await suspend(task,'transport','The reviewer is unavailable; no edit or confirmed proof will be replayed.',result.issue?.message ?? '',true); return; }
              const assessment = interpretReview(result.text);
              if(result.issue){assessment.decision='unresolved';assessment.approved=false;assessment.transformations.push({path:'$',operation:'unresolved',reason:`The inspection operation failed (${result.issue.kind}); its original verdict is retained but is not a valid approval.`});}
              for(const finding of assessment.findings){
                if(finding.evidenceType!=='inspection-command')continue;
                const recipes=normalizeChecks(finding.reproduction?[finding.reproduction]:[],options.brief).map(check=>({...check,id:`inspection-${finding.id}`,requirementIds:task.requirementIds}));
                if(!recipes.length||recipes.some(check=>selectVerifications(options.brief,{...task,checks:[check]}).some(selected=>selected.replaced))){
                  assessment.decision='unresolved';assessment.approved=false;assessment.transformations.push({path:`findings.${finding.id}`,operation:'unresolved',reason:'A command run during read-only inspection needs a concrete compatible reproduction in a writable verification area before it can authorize an edit.'});continue;
                }
                const reproduced=(await verify(task,workspace,operational,recipes))[0]!;
                const prior=structuredClone(finding);
                if(reproduced.evidence.passed){
                  finding.kind='instrument';finding.disposition='advisory';
                  finding.evidence=`${finding.evidence??''}\nWritable reproduction ${reproduced.evidence.checkId}:\n${reproduced.evidence.output}`;
                  assessment.decision='unresolved';assessment.approved=false;
                  assessment.transformations.push({path:`findings.${finding.id}`,operation:'classify',reason:'The claimed inspection-command failure was not reproduced with the prepared provider in writable isolation. The original observation is retained as an instrument incident and requires explicit verdict resolution.',original:prior});
                  note(incident('instrument',task.id,'A read-only inspection command was contradicted by its writable reproduction.',reproduced.evidence.output));
                }else{
                  finding.kind=reproduced.classification==='planning'?'planning':reproduced.classification??'product';finding.evidenceType='verification';finding.evidence=`${reproduced.evidence.checkId}:\n${reproduced.evidence.output}`;
                  assessment.transformations.push({path:`findings.${finding.id}`,operation:'classify',reason:'The claim was reproduced independently; its classified observed result now governs recovery.',original:prior});
                  if(finding.kind==='product')progress.checks=reconcileChecks([...(progress.checks??task.checks),...recipes]);
                }
                finding.text=reviewFindingText(finding);
              }
              assessment.actionableFindings=assessment.findings.filter(finding=>finding.disposition==='defect');assessment.advisories=assessment.findings.filter(finding=>finding.disposition==='advisory');
              progress.reviews.push({inputHash:hash,at:now(),assessment}); event('review',`Review decision: ${assessment.decision}`,task.id,assessment); await save();
              const observedProofs=state.evidence.filter(item=>item.taskId===task.id);
              const vague = assessment.actionableFindings.some(finding=>!finding.expected&&!finding.file&&!observedProofs.some(proof=>finding.evidence&&(finding.evidence.includes(proof.checkId)||finding.evidence.length>=8&&proof.output.includes(finding.evidence))));
              if (result.issue || assessment.decision === 'unresolved' || vague) continue;
              if (assessment.decision === 'approved') { accepted = true; gate(task,'G3','complete','O revisor confirmou a unidade e suas provas.'); break; }
              const nonProduct = assessment.actionableFindings.find(finding=>finding.kind!=='product');
              if (nonProduct) {
                if (nonProduct.kind === 'instrument' && await repairRecipe(task,workspace,operational,reviewFindingText(nonProduct))) { progress.checkpoint.phase='checking'; break; }
                await suspend(task,nonProduct.kind,`Review identified a ${nonProduct.kind} cause, not a product edit.`,nonProduct.text); return;
              }
              gate(task,'G3','returned','Pendência material preservada e encaminhada para correção.');
              const failure=digest(JSON.stringify(assessment.actionableFindings.map(finding=>({kind:finding.kind,observed:finding.observed,expected:finding.expected,file:finding.file,evidence:finding.evidence}))));
              progress.reviewNoProgress=progress.reviewFailureSignature===failure?(progress.reviewNoProgress??0)+1:1;progress.reviewFailureSignature=failure;
              if(progress.reviewNoProgress>=3){await suspend(task,'integration','No progress: the same material review defect survived repair and diagnosis.',assessment.original);return;}
              if(progress.reviewNoProgress===2){
                const diagnosis=await invoke(task,workspace,'reviewer','Diagnose this repeated failure without changing code. Return JSON {kind:"product"|"instrument"|"environment"|"plan",cause,fix}. Explain why the previous repair did not resolve this exact material review finding and supply a different concrete action.',assessment.actionableFindings.map(reviewFindingText).join('\n'),true,'diagnose-review-failure',operational);
                const explanation=jsonObject(diagnosis.text);const fix=[explanation?.cause,explanation?.fix].filter(item=>typeof item==='string').join('\n');
                if(explanation?.kind!=='product'||!fix){await suspend(task,'integration','No progress: independent diagnosis did not provide a different executable product repair.',diagnosis.text);return;}
                progress.findings=[fix];progress.strategy=`review-guided-repair:${digest(fix)}`;progress.checkpoint.phase='editing';break;
              }
              progress.findings = assessment.actionableFindings.map(reviewFindingText); progress.strategy = 'partner-guidance'; progress.checkpoint.phase = 'editing'; break;
            }
            if (progress.checkpoint.phase !== 'reviewing') { await save(); continue; }
            if (!accepted) { progress.strategy='clarify-review'; await suspend(task,'instrument','Review remained unresolved after one clarification; identical inputs will not trigger another reviewer loop.',progress.reviews.at(-1)?.assessment.original ?? ''); return; }
          }
          progress.checkpoint.phase='integrating'; await save();
        }
        if (progress.checkpoint.phase === 'integrating') {
          await transition(task,'integrating','Publishing an approved write set through the FIFO coordinator.');
          await serial('integration',async()=>{
            if(integrationBlocked||persistenceFailed)throw new Error('A preceding publication is unresolved; no later write set can be applied.');
            const transaction = await prepareIntegration(options.workspace,task.id,progress.checkpoint!,task.files);
            state.integrations!.push(transaction); await save(); if(persistenceFailed)return;
            transaction.phase='applying'; await save();
            try{await publishIntegration(options.workspace,transaction);transaction.phase='applied';}
            catch(error){integrationBlocked=true;throw error;}
            progress.revision = await revision(task,options.workspace,canonicalOperational(task)); progress.definitionHash=definitionHash(task); progress.findings=[]; progress.strategy='verified'; delete progress.suspension;
            state.incidents = state.incidents.filter(item=>item.subject!==task.id);
            await transition(task,'complete','Approved isolated changes integrated without overwriting concurrent work.');
            if(!persistenceFailed){const directory=progress.checkpoint!.directory;delete progress.checkpoint;delete progress.verificationCheckpoint;delete progress.dependencyCache;await save();if(!persistenceFailed)await measured('cleanup',()=>rm(dirname(directory),{recursive:true,force:true})).catch(error=>event('recovery',`A área já integrada será limpa depois: ${String(error)}`,task.id));}
          });
          emitProgress(options.onEvent,{id:`task:${task.id}:stages`,label:`${task.id}: edição, verificações e revisão`,completed:3,total:3,status:'complete',stage:'build',unit:'etapas'}); return;
        }
      }
    } catch (error) {
      if (options.signal?.aborted) { cancelled = true; return; }
      if(error instanceof IntegrationConflict&&!integrationBlocked){progress.integrationConflict={path:error.path,before:error.before,current:error.current,proposed:error.proposed};integrationConflicts.add(task.id);progress.strategy='integration-conflict';}
      if(error instanceof ContextTooLarge||error instanceof WorkPlanningError){
        const problem=incident('planning',task.id,error.message,progress.checkpoint?.directory??'');
        if(error instanceof ContextTooLarge)problem.contextChars=Math.max(1,Math.floor((progress.contextChars??options.contextChars??24000)/2));
        replans.set(task.id,problem);await suspend(task,'planning',problem.message,problem.evidence);return;
      }
      await suspend(task,error instanceof IntegrationConflict?'integration':'instrument',error instanceof Error?error.message:String(error),progress.checkpoint?.directory ?? '');
    }
  };
  const finish = async (status: BuildOutcome['status']): Promise<BuildOutcome> => { await save(); return {status,state,plan,completed:plan.tasks.filter(task=>state.tasks[task.id]?.status==='complete').map(task=>task.id),pending:plan.tasks.filter(task=>state.tasks[task.id]?.status!=='complete').map(task=>task.id),incidents:state.incidents}; };
  await mkdir(options.workspace,{recursive:true});
  for (const task of plan.tasks){state.tasks[task.id]??=initialTask();if(state.tasks[task.id]!.integrationConflict)integrationConflicts.add(task.id);}
  const issues = validatePlan(options.brief,plan);
  if (issues.length) { issues.forEach(issue=>note(incident('planning',issue.subject,issue.message,issue.code))); return finish('waiting'); }
  for (const transaction of state.integrations) if (transaction.phase!=='applied') {
    try { await serial('integrationRecovery',()=>publishIntegration(options.workspace,transaction)); transaction.phase='applied'; const task=plan.tasks.find(item=>item.id===transaction.taskId); if(task){const progress=state.tasks[task.id]!;progress.status='complete';progress.strategy='verified';progress.definitionHash=definitionHash(task);progress.revision=await revision(task,options.workspace,canonicalOperational(task));delete progress.checkpoint;delete progress.verificationCheckpoint;} await save(); }
    catch(error){note(incident('integration',transaction.taskId,'Interrupted integration conflicts with newer canonical work.',String(error)));return finish('waiting');}
  }
  for (;;) {
    if (options.signal?.aborted || cancelled) { await Promise.allSettled(workers.values()); return finish('cancelled'); }
    if (persistenceFailed || integrationBlocked) { await Promise.allSettled(workers.values()); return finish('waiting'); }
    for (const task of plan.tasks) {
      if (workers.size>=capacity) break;
      const progress=state.tasks[task.id]!;
      if(progress.status==='complete'||attempted.has(task.id)||workers.has(task.id)||task.dependsOn.some(id=>state.tasks[id]?.status!=='complete')||task.blockedBy.some(id=>options.brief.gaps.some(gap=>gap.id===id&&gap.status==='pending')))continue;
      if([...workers.keys()].some(id=>conflict(plan,task,plan.tasks.find(item=>item.id===id)!,state)))continue;
      attempted.add(task.id); const worker=runTask(task).finally(()=>workers.delete(task.id));workers.set(task.id,worker);event('scheduler',`Worker ${task.id} started; ${workers.size}/${capacity} active.`,task.id);
    }
    if(workers.size){await Promise.race(workers.values());continue;}
    if(integrationConflicts.size){
      let resumed=false;
      for(const id of integrationConflicts){
        const task=plan.tasks.find(item=>item.id===id),progress=state.tasks[id];const failed=progress?.integrationConflict,proposal=progress?.checkpoint;
        if(!task||!progress||!failed||!proposal)continue;
        const key=digest(JSON.stringify({canonical:await fileDigest(options.workspace,failed.path),proposed:await fileDigest(proposal.directory,failed.path),base:failed.before,task:definitionHash(task)}));
        progress.integrationReconciliations??=[];
        if(progress.integrationReconciliations.includes(key)){await suspend(task,'integration','No progress: the same canonical/proposed conflict already used its reconciliation strategy.',failed.path);continue;}
        progress.integrationReconciliations.push(key);await save();
        const fresh=await serial('integrationReconciliation',()=>createTaskWorkspace(options.workspace,task.id,definitionHash(task),task.files));
        const archive=join(fresh.directory,'.project-inputs','integration-proposals',key);await mkdir(archive,{recursive:true});
        for(const path of progress.changedFiles){
          const proposed=await fileDigest(proposal.directory,path),current=await fileDigest(fresh.directory,path);
          if(proposed!==null){const target=inside(archive,path);await mkdir(dirname(target),{recursive:true});await cp(inside(proposal.directory,path),target,{preserveTimestamps:true});}
          if(current===(proposal.base[path]??null)){
            const target=inside(fresh.directory,path);
            if(proposed===null)await unlink(target).catch(()=>undefined);else{await mkdir(dirname(target),{recursive:true});await cp(inside(proposal.directory,path),target,{preserveTimestamps:true});}
          }
        }
        const canonical=await readFile(inside(fresh.directory,failed.path),'utf8').catch(()=>'(absent)');const proposed=await readFile(inside(proposal.directory,failed.path),'utf8').catch(()=>'(deleted)');
        progress.proposals??=[];progress.proposals.push(proposal.directory);progress.checkpoint=fresh;delete progress.verificationCheckpoint;delete progress.suspension;delete progress.integrationConflict;
        progress.findings=[`Resolve an actual integration conflict while preserving the already integrated peer delivery. Canonical input changed, so this is a different operation.\nPATH ${failed.path}\nCURRENT\n${canonical.slice(0,2400)}\nPROPOSED\n${proposed.slice(0,2400)}\nOther proposed files are readable under ${relative(fresh.directory,archive)}. Uncontested edits were mechanically preserved.`];
        progress.strategy=`integration-reconcile:${key}`;progress.status='pending';attempted.delete(id);resumed=true;
        metrics.repetitions.push({taskId:id,action:'integration-reconcile',reason:`Fresh canonical baseline for conflicting path ${failed.path}; preserved proposal ${proposal.directory}.`,at:now()});await save();
      }
      integrationConflicts.clear();if(resumed)continue;
    }
    if(replans.size&&options.repairPlan){
      let changed=false;
      for(const [id,problem] of replans){const task=plan.tasks.find(item=>item.id===id)!;const progress=state.tasks[id]!;const key=digest(JSON.stringify({problem,input:await suspensionFingerprint(task,progress)}));
        if(progress.actions!.some(action=>action.id===key))continue;
        const action:ActionRecord={id:key,action:'replan',input:key,strategy:'reconcile',reason:problem.message,at:now(),durationMs:0,outcome:'running'};progress.actions!.push(action);await save();const start=Date.now();
        const proposal=await options.repairPlan(problem,task);action.durationMs=Date.now()-start;action.outcome=proposal?'complete':'unchanged';
        if(proposal){
          const reconciled=reconcilePlan(options.brief,proposal,plan);const meaningful=(value:DevelopmentPlan):string=>digest(JSON.stringify({...value,revision:0}));
          if(!validatePlan(options.brief,reconciled).length&&meaningful(reconciled)!==meaningful(plan)){
            const preceding=plan;plan=reconciled;
            for(const unit of plan.tasks){
              const progress=state.tasks[unit.id]??=initialTask();const old=preceding.tasks.find(item=>item.id===unit.id);
              if(old&&definitionHash(old)!==definitionHash(unit)){
                if(JSON.stringify(old.checks)!==JSON.stringify(unit.checks))delete progress.checks;
                delete progress.suspension;delete progress.verificationCheckpoint;
                if(progress.checkpoint){progress.checkpoint.taskHash=definitionHash(unit);progress.checkpoint.phase='checking';}
                progress.status='checking';progress.strategy='reconcile-existing-work';
              }
            }
            attempted.clear();changed=true;
          }
        }
        await save();
      }replans.clear();if(changed)continue;
    }
    // Revalidate concrete provider identity before trusting cached proofs or final acceptance.
    for(const node of plan.environment){
      const previous=state.environment[node.id];if(!previous)continue;
      const base=mergeOperationalEnvironments(options.workspace,...node.dependsOn.map(id=>operationalValue(state.environment[id]?.operational)));
      const result=await measured('environmentRevalidation',()=>prepareEnvironmentNode(options.workspace,node,options.brief,command,{operational:base,previous:{ready:previous.ready,fingerprint:previous.fingerprint??'',operational:operationalValue(previous.operational)??base,...(previous.failedFingerprint?{noProgress:true}:{})},revalidate:true,terminal,allowSystemInstall:options.allowSystemInstall===true,...(options.signal?{signal:options.signal}:{}),onEvent:detail=>emitEvent(options.onEvent,detail)}));
      state.environment[node.id]={ready:result.ready,inputHash:digest(JSON.stringify(node)),fingerprint:result.fingerprint,operational:result.operational,...(!result.ready?{failedFingerprint:result.fingerprint}:{})};
      if(!result.ready){for(const problem of result.incidents)note(problem);return finish('waiting');}
    }
    // Only after ready work has drained do changes in shared inputs invalidate affected proof consumers.
    let invalidated=false;
    for(const task of plan.tasks){const progress=state.tasks[task.id]!;if(progress.status!=='complete')continue;
      const operational=canonicalOperational(task);const current=await measured('proofRevalidation',()=>revision(task,options.workspace,operational));
      const checks=progress.checks??task.checks;const stale:Verification[]=[];
      for(const check of checks){const hash=await checkInputHash(options.workspace,plan,task,check,options.brief,operational);if(!state.evidence.some(item=>item.taskId===task.id&&item.checkId===check.id&&item.inputHash===hash&&item.passed))stale.push(check);}
      if(!stale.length){
        delete progress.revalidationFingerprint;
        if(progress.definitionHash!==definitionHash(task)){
          const area=await serial('isolation',()=>createTaskWorkspace(options.workspace,task.id,definitionHash(task),task.files));area.phase='reviewing';progress.checkpoint=area;progress.status='reviewing';progress.strategy='review-changed-criteria';attempted.delete(task.id);invalidated=true;await save();
        }else progress.revision=current;
        continue;
      }
      const repeated=digest(JSON.stringify({current,checks:await Promise.all(stale.map(async check=>({id:check.id,input:await checkInputHash(options.workspace,plan,task,check,options.brief,operational)})))}));
      if(progress.revalidationFingerprint===repeated){await suspend(task,'instrument','No progress: proof identity did not stabilize after revalidation of unchanged declared inputs.',JSON.stringify(stale.map(check=>check.id)));return finish('waiting');}
      progress.revalidationFingerprint=repeated;
      metrics.invalidations.push(...stale.map(check=>({taskId:task.id,checkId:check.id,reason:'A declared relevant input changed after publication.',at:now()})));
      event('invalidation','Relevant proof inputs changed; rechecking without replaying implementation.',task.id,stale.map(check=>check.id));
      delete progress.checkpoint;progress.status='checking';progress.strategy='revalidate-only';attempted.delete(task.id);invalidated=true;await save();
    }
    if(invalidated)continue;
    if(plan.tasks.some(task=>state.tasks[task.id]?.status!=='complete')||state.integrations.some(transaction=>transaction.phase!=='applied'))return finish('waiting');
    // Final recipes and requirement/interface coverage are independent of the model's approval.
    const acceptanceTask:WorkUnit={id:'$acceptance',title:'Final acceptance',goal:'Prove mandatory outcomes in the requested interface.',instructions:'Verify integrated deliveries without changing them.',requirementIds:options.brief.requirements.map(item=>item.id),dependsOn:[],environmentIds:plan.environment.map(item=>item.id),contractIds:plan.contracts.map(item=>item.id),files:[],inputs:[...new Set(plan.tasks.flatMap(task=>task.files))],criteria:['Every mandatory requirement has current appropriate evidence.'],checks:plan.acceptance??[],risk:'normal',blockedBy:[]};
    const operational=canonicalOperational(acceptanceTask);
    const production=(plan.acceptance??[]).some(check=>verificationLevel(check)==='build')?[]:(await derivedChecks(options.workspace,acceptanceTask)).filter(check=>verificationLevel(check)==='build');
    const proposedFinal=reconcileChecks([...(plan.acceptance??[]),...production]);const acceptanceHash=digest(JSON.stringify(proposedFinal));
    if(state.acceptancePlanHash!==acceptanceHash){state.acceptancePlanHash=acceptanceHash;state.acceptanceChecks=proposedFinal;}
    const finalChecks=state.acceptanceChecks??proposedFinal;
    if(finalChecks.length){
      const area=await serial('isolation',()=>createTaskWorkspace(options.workspace,acceptanceTask.id,definitionHash(acceptanceTask),acceptanceTask.inputs??[]));
      const local=relocateOperationalEnvironment(operational,options.workspace,area.directory);
      try{
        const results=await measured('acceptance',()=>verify(acceptanceTask,area.directory,local,finalChecks));state.acceptance!.push(...results.map(result=>result.evidence));
        const failed=results.find(result=>!result.evidence.passed);if(failed){const check=finalChecks.find(item=>item.id===failed.evidence.checkId)!;if(await recoverAcceptance(failed,check,acceptanceTask,area.directory,local))continue;return finish('waiting');}
        const outputs=finalChecks.flatMap(declaredOutputs);
        if(outputs.length)await serial('acceptanceIntegration',async()=>{const transaction=await prepareIntegration(options.workspace,acceptanceTask.id,area,outputs);state.integrations!.push(transaction);await save();if(persistenceFailed)return;transaction.phase='applying';await save();try{await publishIntegration(options.workspace,transaction);transaction.phase='applied';await save();}catch(error){integrationBlocked=true;throw error;}});
      }catch(error){note(incident(error instanceof WorkPlanningError?'planning':'integration',acceptanceTask.id,error instanceof Error?error.message:String(error)));return finish('waiting');}
    }
    const currentProofs:VerificationEvidence[]=[];
    for(const task of plan.tasks){const local=canonicalOperational(task);for(const check of state.tasks[task.id]?.checks??task.checks){const hash=await checkInputHash(options.workspace,plan,task,check,options.brief,local);const proof=state.evidence.findLast(item=>item.taskId===task.id&&item.checkId===check.id&&item.inputHash===hash&&item.kind===check.kind&&item.level===verificationLevel(check));if(proof?.passed)currentProofs.push(proof);}}
    for(const check of finalChecks){const hash=await checkInputHash(options.workspace,plan,acceptanceTask,check,options.brief,operational);const proof=state.evidence.findLast(item=>item.taskId===acceptanceTask.id&&item.checkId===check.id&&item.inputHash===hash&&item.kind===check.kind&&item.level===verificationLevel(check));if(proof?.passed)currentProofs.push(proof);}
    for(const requirement of options.brief.requirements){
      const consumers=plan.tasks.filter(task=>task.requirementIds.includes(requirement.id));
      const candidates=currentProofs.filter(item=>item.level==='behavior'&&(consumers.some(task=>task.id===item.taskId&&(state.tasks[task.id]?.checks??task.checks).some(check=>check.id===item.checkId&&check.requirementIds.includes(requirement.id)))||finalChecks.some(check=>item.taskId===acceptanceTask.id&&check.id===item.checkId&&check.requirementIds.includes(requirement.id))));
      const kind=['cli','tui','web','desktop'].includes(requirement.mode)?requirement.mode:undefined;
      const proof=candidates.some(item=>!kind||item.kind===kind);
      const binding=requirement.binding;
      const provider=binding?Object.values(operational.bindings).some(item=>item.ready&&item.capability===binding.capability&&item.kind===binding.kind&&item.provider===binding.provider):true;
      if(!proof||!provider){note(incident(binding&&!provider?'environment':'instrument',requirement.id,'Mandatory requirement has no current proof in its required interface/provider.',requirement.statement));return finish('waiting');}
    }
    const conformity=await validateConformance(options.brief,plan,operational,currentProofs,options.workspace);
    if(conformity.length){
      for(const issue of conformity)note(incident('planning',issue.requirementId,issue.message,issue.code));
      const fingerprint=digest(JSON.stringify({issues:conformity,proofs:currentProofs.map(proof=>proof.inputHash)}));state.acceptanceRecovery??={};
      if(options.repairPlan&&!state.acceptanceRecovery[fingerprint]){state.acceptanceRecovery[fingerprint]='planning';const issue=conformity[0]!,owner=plan.tasks.find(task=>task.requirementIds.includes(issue.requirementId))??plan.tasks[0];if(owner){replans.set(owner.id,incident('planning',issue.requirementId,'The mandatory provider is not consumed by the actual product; reconcile its plan and proof contract.',issue.message));await save();continue;}}
      return finish('waiting');
    }
    event('complete','Todos os fragmentos foram integrados e os requisitos obrigatórios possuem provas observadas.');return finish('complete');
  }
}
