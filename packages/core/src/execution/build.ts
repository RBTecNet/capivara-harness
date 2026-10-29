import { access, cp, mkdir, readFile, writeFile, unlink, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join, relative, dirname } from 'node:path';
import { ContextTooLarge, ordered } from '../domain/context.js';
import { allowedCapabilities } from '../domain/authority.js';
import { materializeProductInvariants } from '../domain/product-invariants.js';
import { obligationMatchesProvider } from '../domain/bindings.js';
import { verificationConformanceClaims, verificationOutputs } from '../domain/verifications.js';
import { normalizeChecks, normalizeEnvironment } from '../domain/plan.js';
import { jsonObject } from '../domain/json.js';
import { reconcileChecks, reconcilePlan, requiredRequirementInterface, requiredTaskInterfaces, validatePlan } from '../domain/reconcile.js';
import type { DevelopmentPlan, EnvironmentNode, Verification, WorkUnit } from '../domain/types.js';
import { executeCommand, runTerminal, verificationEnvironment } from '../runtime/index.js';
import type { AgentRequest, AgentResult, CommandRequest, TerminalRequest } from '../runtime/types.js';
import { emitEvent, emitGate, emitProgress, type BuildGateId, type BuildGateStatus } from '../telemetry/progress.js';
import { changedSince, digest, inputHash, inputSnapshot, inside, introducedServers, restoreFiles, snapshot, sourceFiles } from './files.js';
import { declaredCheckInputs, resolveInputDependencies, verificationInputSelectors } from './dependencies.js';
import { applyOperationalEnvironment, emptyOperationalEnvironment, environmentFingerprint, executionConstraints, mergeOperationalEnvironments, OperationalInvocationConflict, prepareEnvironmentNode, prepareProjectDependencies, projectDependencyScope, projectInstallationEnvironment, relocateOperationalEnvironment, selectOperationalEnvironment, type OperationalEnvironment, type PreparedEnvironment } from './environment.js';
import { derivedChecks, evaluateRecordedObservation, evaluateVerificationAssertion, inlineVerificationSyntaxRequired, interfaceEvidenceUsable, normalizeVerificationAssertion, runVerification, selectVerifications, taskInputs, verificationAssertionStatus, verificationIdentity, verificationLevel, type VerificationOutcome } from './checks.js';
import { createTaskWorkspace, fileDigest, IntegrationConflict, pathScopesConflict, prepareIntegration, publishIntegration, SerialQueue } from './isolation.js';
import { interpretReview, reviewFindingText } from './review.js';
import { validateConformance } from './conformance.js';
import { enrichVerificationConformance } from './conformance-candidates.js';
import { deriveObservedProducerOutputs } from './verification-effects.js';
import { selectPendingAcceptance } from './acceptance-selection.js';
import { prepareInvocationInstrument } from './invocation-instrument.js';
import { assembleTaskContext } from './task-context.js';
import { preparedContextPlan } from './prepared-context.js';
import { substantiateSourceFinding } from './source-review.js';
import { resolveReviewScope, validateFindingDeferral } from './source-finding-scope.js';
import { buildReviewEvidence } from './review-evidence.js';
import { createInspectionIdentity, inspectionStillCurrent } from './inspection.js';
import { resolveInspectionReuse } from './inspection-composition.js';
import { deliveryProofSelectors, deliveryWriteSet } from './delivery-sources.js';
import { recoverPlanLineage } from './plan-lineage.js';
import { repositoryRecipeCandidate } from './recipe-candidates.js';
import { repositoryVerificationCandidates, verificationSurfaces } from './verification-debt.js';
import { cachedPositiveVerifications } from './verification-cache.js';
import { VerificationMutationError, verificationMutationError } from './verification-mutations.js';
import { candidateFromRecordedInterfaceProof, interfaceInvocationKey, narrowUnobservedWebRecipe } from './verification-interface-recovery.js';
import { prepareBrowserResources, type BrowserResourceResult } from '../runtime/browser-resources.js';
import { beginEnvironmentRecovery, commitEnvironmentRecovery, environmentRecoveryTask, environmentRecoveryContext, resumeEnvironmentRecovery } from './recovery-scope.js';
import { publishedToolInstallationRoots } from './recovery-scope.js';
import { ProviderSynchronizationError, synchronizePublishedInstallations } from './provider-synchronization.js';
import type { ActionRecord, BuildIncident, BuildMetrics, BuildOptions, BuildOutcome, BuildState, TaskProgress, VerificationEvidence } from './types.js';
export { interpretReview } from './review.js';

const now = (): string => new Date().toISOString();
const executionProtocol = 'capivara-control/22';
const external = (result: AgentResult): boolean => result.status === 'unavailable' && !result.issue || ['transport','authentication','rate-limit','capacity','configuration'].includes(result.issue?.kind ?? '');
const definitionHash = (task: WorkUnit): string => digest(JSON.stringify(task));
const exists = (path: string): Promise<boolean> => access(path).then(() => true, () => false);
const declaredOutputs = verificationOutputs;
const taskWriteScopes = (task:WorkUnit,state:BuildState):string[] => [...new Set([...task.files,...(state.tasks[task.id]?.checks??task.checks).flatMap(declaredOutputs)])];
class WorkPlanningError extends Error {}
const operationalValue = (value: unknown): OperationalEnvironment | undefined => value && typeof value === 'object' && 'revision' in value && 'bindings' in value ? value as OperationalEnvironment : undefined;

export function createBuildState(plan: DevelopmentPlan): BuildState {
  return { schema: 'capivara/build/1', controlVersion: 2, planRevision: plan.revision, tasks: {}, environment: {}, evidence: [], incidents: [], integrations: [], acceptance: [], updatedAt: now() };
}
function initialTask(): TaskProgress { return { status: 'pending', revision: '', attempts: 0, changedFiles: [], findings: [], strategy: 'implement', actions: [], reviews: [], noProgress: 0 }; }
function hasRecordedDelivery(progress:TaskProgress):boolean {
  return progress.changedFiles.length>0||Boolean(progress.reviews?.length)||progress.actions?.some(action=>Boolean(action.result?.changedFiles.length)||action.purpose==='implementation'&&Boolean(action.agentStartedAt)||!action.purpose&&Boolean(action.result)&&(action.action==='editor'||action.action==='repair'&&Boolean(action.sourceCoverage?.length)))===true||progress.status==='complete';
}
/** A new explanation of the same operation is not a new recovery strategy. */
export function recoveryPlanIdentity(plan:DevelopmentPlan,scope:BuildIncident['repairScope']):string {
  const recipe=({capabilities:_capabilities,...value}:EnvironmentNode['check']):unknown=>value;
  const environment=plan.environment.map(({reason:_reason,name:_name,identityTransformations:_interpretations,check,prepare,...node})=>({...node,check:recipe(check),prepare:prepare.map(recipe)}));
  if(scope==='environment')return digest(JSON.stringify({environment,consumers:plan.tasks.map(task=>({id:task.id,environmentIds:task.environmentIds}))}));
  const check=({expected:_expected,assertionIssue:_assertionIssue,declarationTransformation:_interpretation,...value}:Verification):unknown=>{const assertion=verificationAssertionStatus({...value,...(_assertionIssue?{assertionIssue:_assertionIssue}:{}),...(_expected?{expected:_expected}:{})});return{...value,assertion:assertion.assertion??null,assertionStatus:assertion.status};};
  if(scope==='verification')return digest(JSON.stringify({environment,tasks:plan.tasks.map(task=>({id:task.id,checks:task.checks.map(check)})),acceptance:plan.acceptance?.map(check)}));
  if(scope!=='authority'){
    // A paraphrase is not another executable recovery transition. Literal
    // authority corrections have their own source-bound reconciliation scope.
    const operation=(task:WorkUnit):unknown=>{const {id:_id,title:_title,goal:_goal,instructions:_instructions,criteria:_criteria,risk:_risk,dependsOn:_dependsOn,checks,...value}=task;return{...value,checks:checks.map(check)};};
    const operations=new Map(plan.tasks.map(task=>[task.id,digest(JSON.stringify(operation(task)))]));
    const tasks=[...new Set(plan.tasks.map(task=>JSON.stringify({operation:operation(task),dependsOn:task.dependsOn.map(id=>operations.get(id)??`missing:${id}`).sort()})))].sort();
    return digest(JSON.stringify({environment,contracts:plan.contracts,tasks,acceptance:plan.acceptance?.map(check)}));
  }
  return digest(JSON.stringify({...plan,revision:0,environment}));
}
function closure(plan: DevelopmentPlan, task: WorkUnit): EnvironmentNode[] {
  const nodes: EnvironmentNode[] = [], visited = new Set<string>();
  const visit = (id: string): void => { if (visited.has(id)) return; visited.add(id); const node = plan.environment.find(item => item.id === id); if (!node) return; node.dependsOn.forEach(visit); nodes.push(node); };
  task.environmentIds.forEach(visit); return nodes;
}
function incident(kind: BuildIncident['kind'], subject: string, message: string, evidence = '', externalResource = false): BuildIncident {
  return { id: digest(`${kind}:${subject}:${message}`).slice(0,20), kind, subject, message, evidence, external: externalResource, action: 'Resolve the classified cause or change the relevant input/provider; confirmed source and proofs remain preserved.',...(kind==='environment'?{repairScope:'environment' as const}:kind==='instrument'?{repairScope:'verification' as const}:{}) };
}
function conflict(plan: DevelopmentPlan, left: WorkUnit, right: WorkUnit, state: BuildState): boolean {
  const writes = (task: WorkUnit): string[] => [...new Set([...(task.files.length ? taskWriteScopes(task,state) : ['.']), ...state.tasks[task.id]?.changedFiles ?? []])];
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

function retireObsoleteReplans(state:BuildState,plan:DevelopmentPlan):[string,BuildIncident][]{
  const owners=new Set(plan.tasks.map(task=>task.id));
  const retired=Object.entries(state.pendingReplans??{}).filter(([id])=>!owners.has(id));
  for(const [id] of retired)delete state.pendingReplans![id];
  return retired;
}

/** Explicit persisted transitions, isolated workers and one FIFO publication coordinator. No sleep/retry loop owns execution. */
export async function runBuild(options: BuildOptions): Promise<BuildOutcome> {
  materializeProductInvariants(options.brief);
  let plan = reconcilePlan(options.brief,options.plan,options.plan);
  const state = options.state ?? createBuildState(plan);
  state.controlProtocol=executionProtocol;
  const usableProof=(check:Verification,proof:VerificationEvidence):boolean=>interfaceEvidenceUsable(check,proof)&&!state.proofInterpretations?.some(item=>item.evidenceId===proof.id&&item.classification==='invalidated');
  // A historical proposal must not resurrect a recovery job whose delivery was
  // retired by an already committed plan. Its incident remains in the journal.
  const retiredReplans=retireObsoleteReplans(state,plan);
  const lineage=recoverPlanLineage(options.brief,plan,state,options.domainCalls);plan=lineage.plan;
  if(lineage.restored.length){state.planLineage??=[];state.planLineage.push(...lineage.restored);}
  state.controlVersion = 2; state.integrations ??= []; state.acceptance ??= [];
  state.environmentDefinitions ??= {};
  for(const node of plan.environment){
    const recovered=state.environmentDefinitions[node.id];
    if(recovered&&(digest(JSON.stringify(node))===recovered.originalHash||digest(JSON.stringify(node))===digest(JSON.stringify(recovered.definition))))Object.assign(node,structuredClone(recovered.definition));
  }
  const metrics: BuildMetrics = state.metrics ??= { startedAt: now(), elapsedMs: 0, maxConcurrency: 0, active: 0, callsByRole: {}, timeByStageMs: {}, invalidations: [], repetitions: [], timeline: [] };
  for(const restored of lineage.restored){metrics.repetitions.push({taskId:restored.previousTaskId,action:'restore-plan-lineage',reason:`Recovered exact checkpoint definition ${restored.previousDefinitionHash}; replaced ${restored.replacementTaskId} without replaying implementation.`,at:now()});emitEvent(options.onEvent,{type:'recovery',subject:restored.previousTaskId,message:'Contrato e proposta parcial recuperados por identidade exata; verificação e revisão continuam obrigatórias.',detail:restored});}
  metrics.active = 0;
  const started = Date.now(), elapsedBefore = metrics.elapsedMs;
  const publication = new SerialQueue(), persistence = new SerialQueue();
  const nodeFlights = new Map<string, Promise<boolean>>(), replans = new Map<string, BuildIncident>(Object.entries(state.pendingReplans??{}).filter(([id])=>plan.tasks.some(task=>task.id===id)));
  const workers = new Map<string, Promise<void>>(), attempted = new Set<string>();
  const integrationConflicts = new Set<string>();
  const capacity = Math.max(1, Math.min(64, Math.floor(options.maxConcurrent ?? 2)));
  const command = options.executeCommand ?? executeCommand, terminal = options.runTerminal ?? runTerminal;
  let cancelled = false, persistenceFailed = false, integrationBlocked = false;
  const operationRun=randomUUID();let operationSequence=0;
  const operationLabels:Record<string,string>={
    browserPreparation:'Preparando recursos do navegador',agentInstrument:'Preparando instrumentos do agente',providerPublication:'Publicando provedor de ambiente',
    dependencies:'Preparando dependências',verificationIsolation:'Isolando verificações',environmentPreparation:'Preparando ambiente',isolation:'Isolando área de trabalho',
    integration:'Integrando alterações verificadas',integrationRecovery:'Recuperando integração',integrationReconciliation:'Preparando reconciliação de alterações',cleanup:'Limpando área integrada',
    environmentRevalidation:'Revalidando ambiente',providerSynchronization:'Disponibilizando ferramentas recuperadas',proofRevalidation:'Revalidando provas',proofInputs:'Resolvendo entradas e hashes das provas',acceptance:'Executando aceite final',acceptanceIntegration:'Integrando artefatos do aceite',
    conformance:'Conferindo conformidade dos requisitos e provedores',
  };
  const measured=async<T>(stage:string,operation:()=>Promise<T>):Promise<T>=>{
    const start=Date.now(),startedAt=new Date(start).toISOString(),id=`operation:${operationRun}:${++operationSequence}`,label=operationLabels[stage]??stage;
    let completed=false;
    emitProgress(options.onEvent,{id,label,startedAt,status:'running',stage:'build'});
    try{const result=await operation();completed=true;return result;}
    finally{
      metrics.timeByStageMs[stage]=(metrics.timeByStageMs[stage]??0)+Date.now()-start;
      emitProgress(options.onEvent,{id,label,startedAt,status:completed?'complete':'waiting',stage:'build'});
    }
  };
  const serial=async<T>(stage:string,operation:()=>Promise<T>):Promise<T>=>{const queued=Date.now();return publication.run(async()=>{metrics.timeByStageMs.queueWait=(metrics.timeByStageMs.queueWait??0)+Date.now()-queued;return measured(stage,operation);});};
  const event = (type: Parameters<NonNullable<BuildOptions['onEvent']>>[0]['type'], message: string, subject?: string, detail?: unknown): void => emitEvent(options.onEvent,{type,message,...(subject ? {subject} : {}),...(detail !== undefined ? {detail} : {})});
  const note = (problem: BuildIncident): void => { const index = state.incidents.findIndex(item => item.id === problem.id); if (index < 0) state.incidents.push(problem); else state.incidents[index] = problem; };
  const recordRetiredReplans=(retired:[string,BuildIncident][]):void=>{for(const [id,problem] of retired){
    replans.delete(id);note(problem);
    const reason=`Recovery ${problem.id} belongs to retired task ${id}; the committed plan no longer contains its owner. The original incident is preserved; a new current failure must schedule its own recovery.`;
    metrics.repetitions.push({taskId:id,action:'retire-replan',reason,at:now()});event('recovery','Reconciliação antiga aposentada com seu plano; causa histórica preservada.',id,{incidentId:problem.id,reason});
  }};
  recordRetiredReplans(retiredReplans);
  const scheduleReplan=(task:WorkUnit,problem:BuildIncident):void=>{const consumers=plan.tasks.filter(unit=>unit.requirementIds.some(id=>task.requirementIds.includes(id)));const owner=plan.tasks.find(unit=>unit.id===task.id)??consumers.find(unit=>!consumers.some(other=>other.dependsOn.includes(unit.id)))??consumers[0]??plan.tasks[0];if(!problem.repairScope)problem.repairScope=state.tasks[task.id]?.checkpoint?.phase==='checking'?'verification':'delivery';if(owner){replans.set(owner.id,problem);state.pendingReplans??={};state.pendingReplans[owner.id]=structuredClone(problem);}else note(problem);};
  const save = async (): Promise<void> => {
    state.planRevision = plan.revision; state.updatedAt = now(); metrics.elapsedMs = elapsedBefore + Date.now() - started;
    const value = structuredClone(state),currentPlan=structuredClone(plan);
    await persistence.run(async () => { try { await options.onState?.(value,currentPlan); } catch (error) { persistenceFailed = true; note(incident('integration','persistence','Persistent state could not be committed; new agent work is suspended.',String(error),true)); } });
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
  const canonicalOperational = (task: WorkUnit): OperationalEnvironment => mergeOperationalEnvironments(options.workspace,...Object.entries(state.environment).filter(([key])=>key.startsWith('$project:')).sort(([,left],[,right])=>(left.preparedAt??'').localeCompare(right.preparedAt??'')).flatMap(([,value])=>{const stored=operationalValue(value.operational);return stored?[projectInstallationEnvironment(stored)]:[];}),...closure(plan,task).map(node => operationalValue(state.environment[node.id]?.operational)));
  const providerGeneration=():string=>{
    const latest=new Map<string,string|null>();
    for(const transaction of state.integrations??[])if(transaction.phase==='applied')for(const installation of transaction.installations??[])if(publishedToolInstallationRoots.includes(installation.path))latest.set(installation.path,installation.after);
    return digest(JSON.stringify([...latest].sort(([a],[b])=>a.localeCompare(b))));
  };
  const synchronizeProviders=async(task:WorkUnit,workspace:string,operational:OperationalEnvironment):Promise<OperationalEnvironment>=>{
    if(workspace===options.workspace||!plan.tasks.some(unit=>unit.id===task.id))return operational;
    const progress=state.tasks[task.id]!;const revision=providerGeneration();
    if(progress.providerSynchronization?.directory===workspace&&progress.providerSynchronization.revision===revision)return operational;
    const result=await serial('providerSynchronization',()=>synchronizePublishedInstallations(options.workspace,workspace,state.integrations??[],progress.changedFiles));
    progress.providerSynchronization={directory:workspace,revision};
    if(result.synchronized.length){
      progress.retryGeneration=(progress.retryGeneration??0)+1;
      metrics.repetitions.push({taskId:task.id,action:'provider-synchronization',reason:JSON.stringify(result.synchronized),at:now()});
      event('recovery','Ferramentas recuperadas disponibilizadas na área existente; código e dependências privadas preservados.',task.id,result);
    }
    await save();
    return result.synchronized.length?mergeOperationalEnvironments(workspace,relocateOperationalEnvironment(canonicalOperational(task),options.workspace,workspace),projectInstallationEnvironment(operational)):operational;
  };
  const checkOperational=(task:WorkUnit,check:Verification,workspace:string,base:OperationalEnvironment):OperationalEnvironment=>{
    const key=state.resourceBindings?.[task.id]?.[check.id],resource=key?operationalValue(state.environment[key]?.operational):undefined;
    return resource?mergeOperationalEnvironments(workspace,base,relocateOperationalEnvironment(resource,resource.root??options.workspace,workspace)):base;
  };
  const proofSelectors=async(task:WorkUnit,check:Verification,workspace:string):Promise<string[]>=>deliveryProofSelectors(check,await verificationInputSelectors(workspace,plan,task,check),deliveryWriteSet(task.id,state.tasks[task.id],state.integrations)??[],verificationLevel(check));
  const verificationContext=async(task:WorkUnit,check:Verification,workspace:string,operational:OperationalEnvironment):Promise<{check:Verification;operational:OperationalEnvironment}>=>{
    if(task.id!=='$acceptance'||!state.nativeConformanceCheckIds?.includes(check.id))return{check,operational};
    const ready=plan.environment.flatMap(node=>{const saved=state.environment[node.id];const value=saved?.ready?operationalValue(saved.operational):undefined;return value?[relocateOperationalEnvironment(value,value.root??options.workspace,workspace)]:[];});
    const pool=mergeOperationalEnvironments(workspace,...ready,operational);
    const observed=[...new Set(plan.tasks.flatMap(unit=>deliveryWriteSet(unit.id,state.tasks[unit.id],state.integrations)??unit.files))];
    const enriched=await enrichVerificationConformance({brief:options.brief,plan,task,check,operational:pool,workspace,evidence:state.evidence,deliveryFiles:observed});
    state.nativeConformanceCoverage??=[];
    const id=digest(JSON.stringify(enriched.coverage));
    if(!state.nativeConformanceCoverage.some(item=>item.id===id))state.nativeConformanceCoverage.push({id,checkId:check.id,coverage:enriched.coverage});
    return{check:enriched.check,operational:pool};
  };
  const proofIdentity=async(task:WorkUnit,check:Verification,workspace:string,operational:OperationalEnvironment)=>{
    const context=await verificationContext(task,check,workspace,operational);
    return verificationIdentity(workspace,plan,task,context.check,options.brief,checkOperational(task,context.check,workspace,context.operational),await resolveInputDependencies(workspace,await proofSelectors(task,context.check,workspace)));
  };
  const proofHash=async(task:WorkUnit,check:Verification,workspace:string,operational:OperationalEnvironment):Promise<string>=>(await proofIdentity(task,check,workspace,operational)).inputHash;
  const interfaceSourceStamp=async(task:WorkUnit,workspace:string,operational:OperationalEnvironment):Promise<string>=>inputHash(workspace,await resolveInputDependencies(workspace,[...new Set([...taskInputs(plan,task),...deliveryWriteSet(task.id,state.tasks[task.id],state.integrations)??[]])]),operational.revision);
  const interfaceKey=(check:Verification,workspace:string,operational:OperationalEnvironment,sourceStamp:string):string=>{
    if(check.kind==='command'||!check.command)throw new Error('An interface recovery key requires a concrete interface invocation.');
    return interfaceInvocationKey({requiredKind:check.kind,sourceStamp,workspace,request:applyOperationalEnvironment({cwd:check.cwd?inside(workspace,check.cwd):workspace,command:check.args?[check.command,...check.args]:check.command,environment:operational.env},operational)});
  };
  const reuseInspection=async(task:WorkUnit,review:NonNullable<TaskProgress['reviews']>[number],workspace:string):Promise<'current'|'composed'|false>=>{
    const progress=state.tasks[task.id]!;
    const currentProofs:Record<string,VerificationEvidence[]>={};
    const deliveryFiles=deliveryWriteSet(task.id,progress,state.integrations);
    const inputs={...(deliveryFiles?{deliveryFiles}:{}),tasks:state.tasks,integrations:state.integrations??[],currentProofs};
    let result=await resolveInspectionReuse(review,workspace,options.brief,plan,task,inputs);
    if(result.status==='awaiting-peer-proofs'){
      for(const id of result.waitingFor??[]){
        const unit=plan.tasks.find(item=>item.id===id);if(!unit)continue;
        const local=relocateOperationalEnvironment(canonicalOperational(unit),options.workspace,workspace);
        currentProofs[id]=[];
        for(const check of state.tasks[id]?.checks??unit.checks){
          const hash=await proofHash(unit,check,workspace,local);
          const latest=state.evidence.findLast(item=>item.taskId===id&&item.checkId===check.id&&item.inputHash===hash);
          if(latest?.passed&&usableProof(check,latest))currentProofs[id]!.push(latest);
        }
      }
      result=await resolveInspectionReuse(review,workspace,options.brief,plan,task,inputs);
    }
    if(result.status==='current')return'current';
    if(result.status!=='composed'||!result.composition)return false;
    progress.inspectionCompositions??=[];
    if(!progress.inspectionCompositions.some(item=>item.id===result.composition!.id)){
      progress.inspectionCompositions.push(result.composition);
      metrics.repetitions.push({taskId:task.id,action:'reuse-composed-inspection',reason:JSON.stringify(result.composition),at:now()});
      event('recovery','Inspeções de fontes compostas a partir de pareceres independentes e provas atuais das entregas responsáveis.',task.id,{compositionId:result.composition.id});await save();
    }
    return'composed';
  };
  const prepareResources=async(task:WorkUnit,check:Verification,workspace:string,base:OperationalEnvironment):Promise<BrowserResourceResult>=>{
    const caches=[workspace,state.tasks[task.id]?.checkpoint?.directory,...state.tasks[task.id]?.proposals??[],options.workspace].filter((path):path is string=>!!path).map(path=>join(path,'.capivara-runtime','cache','ms-playwright'));
    const result=await measured('browserPreparation',()=>prepareBrowserResources(workspace,check,base,{resourceRoot:join(options.workspace,'.capivara-next','providers'),caches,...(options.signal?{signal:options.signal}:{}),execute:request=>command({...request,constraints:executionConstraints(options.brief,options.allowSystemInstall),onOutput:(message,stream)=>emitEvent(options.onEvent,{type:'output',message,detail:{stream}})})}));
    if(!result.applicable){
      if(check.instrument?.provider==='playwright'){
        if(check.instrument.declaredInputs)check.inputs=[...check.instrument.declaredInputs];
        if(check.instrument.originalKind)check.kind=check.instrument.originalKind;
        delete check.instrument;
      }
      if(state.resourceBindings?.[task.id]?.[check.id]){delete state.resourceBindings[task.id]![check.id];await save();}return result;
    }
    const requestedWeb=options.brief.requirements.some(requirement=>check.requirementIds.includes(requirement.id)&&requiredRequirementInterface(requirement)==='web');
    const declaredInputs=check.instrument?.declaredInputs??declaredCheckInputs(plan,task,check);
    check.instrument={...check.instrument,provider:'playwright',output:'runner',declaredInputs:[...declaredInputs],sourceInputs:[...result.inputs??[]],...(check.instrument?.originalKind?{originalKind:check.instrument.originalKind}:check.kind!=='web'&&requestedWeb?{originalKind:check.kind}:{})};
    if(result.ready&&result.invocation){
      check.instrument.transformations??=[];check.instrument.transformations.push(structuredClone(result.invocation.audit));
      check.command=result.invocation.command;check.args=result.invocation.args;check.cwd=result.invocation.cwd;
      metrics.repetitions.push({taskId:task.id,action:'normalize-browser-invocation',reason:JSON.stringify(result.invocation.audit),at:now()});
    }
    if(check.kind==='command'&&requestedWeb){check.kind='web';check.requiredCapabilities=[...new Set([...check.requiredCapabilities,'browser'])];}
    check.inputs=[...new Set([...declaredInputs,...result.inputs??[]])];
    const key=`$resource:browser:${result.identity||digest(check.command??'')}`;
    const resource:OperationalEnvironment={root:options.workspace,env:result.environment,bindings:{browser:{capability:'browser',kind:'runtime',provider:'playwright-browser',relocation:'fixed',dependencyFamily:'browser',ready:result.ready,fingerprint:result.fingerprint??result.identity,env:result.environment,...(result.executable?{command:[result.executable]}:{})}},revision:''};
    state.environment[key]={ready:result.ready,inputHash:result.identity,fingerprint:result.fingerprint??result.identity,operational:mergeOperationalEnvironments(options.workspace,resource),preparedAt:now()};
    state.resourceBindings??={};state.resourceBindings[task.id]??={};state.resourceBindings[task.id]![check.id]=key;
    event('environment',result.ready?'Recurso de navegador utilizável no mesmo caminho por editor e verificador.':'O recurso de navegador ainda precisa de recuperação; o código não foi reprovado.',task.id,{identity:result.identity,ready:result.ready,changed:result.changed,details:result.details});
    await save();return result;
  };
  const revisionState = async (task: WorkUnit, workspace: string, operational: OperationalEnvironment): Promise<{hash:string;proofs:Record<string,string>}> => measured('proofInputs',async()=>{
    const checks = state.tasks[task.id]?.checks ?? task.checks;
    const proofs = await Promise.all(checks.map(check=>proofHash(task,check,workspace,operational)));
    return{hash:await inputHash(workspace,taskInputs(plan,task),JSON.stringify({task,proofs,requirements:options.brief.requirements.filter(item => task.requirementIds.includes(item.id)),constraints:options.brief.constraints,contracts:plan.contracts.filter(item => task.contractIds.includes(item.id)),environment:operational.revision})),proofs:Object.fromEntries(checks.map((check,index)=>[check.id,proofs[index]!]))};
  });
  const revision = async(task:WorkUnit,workspace:string,operational:OperationalEnvironment):Promise<string>=>(await revisionState(task,workspace,operational)).hash;
  const suspensionFingerprint = async (task: WorkUnit, progress: TaskProgress): Promise<string> => digest(JSON.stringify({protocol:executionProtocol,canonical:await revision(task,options.workspace,canonicalOperational(task)),local:progress.checkpoint && await exists(progress.checkpoint.directory) ? await inputHash(progress.checkpoint.directory,taskInputs(plan,task)) : '',configuration:options.configurationRevision ?? '',checks:progress.checks,environment:closure(plan,task).map(node=>state.environment[node.id]?.fingerprint)}));
  const suspend = async (task: WorkUnit,kind: BuildIncident['kind'],reason: string,evidence = '',resource = false): Promise<void> => {
    const progress = state.tasks[task.id]!; note(incident(kind,task.id,reason,evidence,resource));
    progress.suspension = { fingerprint: await suspensionFingerprint(task,progress), reason, action: kind };
    await transition(task,'waiting',reason); gate(task,kind === 'product' ? 'G3' : 'G0','waiting',reason);
  };
  const acknowledgedHandoffs=async(task:WorkUnit,workspace:string):Promise<Set<string>>=>{
    const progress=state.tasks[task.id],acknowledged=new Set<string>();if(!progress)return acknowledged;
    for(const review of progress.reviews??[])if(review.assessment.decision==='approved'&&review.handoffIds?.length&&await inspectionStillCurrent(review.inspection,workspace,options.brief,plan,task,deliveryWriteSet(task.id,progress,state.integrations)))for(const id of review.handoffIds)acknowledged.add(id);
    return acknowledged;
  };
  const context = async (task: WorkUnit,workspace: string,extra='',operational?: OperationalEnvironment) => {
    const progress=state.tasks[task.id];
    const focus=[...new Set([...(progress?.reviews?.at(-1)?.assessment.findings.filter(finding=>finding.disposition==='defect').flatMap(finding=>finding.file?[finding.file]:[])??[]),...(progress?.contextFocus??[])])];
    const limit=progress?.contextChars??options.contextChars??24000,acknowledged=await acknowledgedHandoffs(task,workspace);
    const pending=(state.reviewHandoffs??[]).filter(item=>item.ownerTaskId===task.id&&!acknowledged.has(item.id));
    const selected:typeof pending=[],details:unknown[]=[];
    for(const item of pending){let summary:unknown={id:item.id,requirementId:item.requirementId,fromTaskId:item.fromTaskId,status:item.status,observed:item.finding.observed.slice(0,250),expected:item.finding.expected?.slice(0,250),excerpt:item.finding.observed.length>250||Boolean(item.finding.expected&&item.finding.expected.length>250),source:{kind:item.source.kind,reference:item.source.reference,quote:item.source.text.slice(0,150)}};const budget=Math.max(700,Math.floor(limit*.12));if(JSON.stringify([...details,summary]).length>budget){if(details.length)break;summary={id:item.id,requirementId:item.requirementId,fromTaskId:item.fromTaskId,expected:item.finding.expected?.slice(0,80),excerpt:true};}selected.push(item);details.push(summary);}
    const obligations=details.length?`\nINTEGRATION OBLIGATIONS ${JSON.stringify({remaining:pending.length,items:details})}\nThese original observations came from an earlier partial contribution. Inspect the current product against their expected outcomes; do not assume the old defect persists. Current owner proof and explicit review are still required.`:'';
    const supplied=await assembleTaskContext(options.brief,operational?preparedContextPlan(plan,task,operational):plan,task,workspace,limit,extra+obligations,focus,deliveryWriteSet(task.id,progress,state.integrations));
    return{...supplied,handoffIds:selected.map(item=>item.id)};
  };
  const invoke = async (task: WorkUnit,workspace: string,role: string,instruction: string,extra: string,readOnly: boolean,strategy: string,operational: OperationalEnvironment,operationContext?: string,operationPurpose?: AgentRequest['purpose']): Promise<AgentResult> => {
    const progress = state.tasks[task.id]!; progress.actions ??= [];
    if (options.signal?.aborted || persistenceFailed) return {status:'cancelled',text:'',commands:[],changedFiles:[]};
    operational=await synchronizeProviders(task,workspace,operational);
    const resources=[...new Set(Object.values(state.resourceBindings?.[task.id]??{}))].map(key=>state.environment[key]).filter(value=>value?.ready).flatMap(value=>{const prepared=operationalValue(value?.operational);return prepared?[prepared]:[];});
    if(resources.length===1)operational=mergeOperationalEnvironments(workspace,operational,relocateOperationalEnvironment(resources[0]!,resources[0]!.root??options.workspace,workspace));
    const supplied = operationContext ? {text:operationContext,coverage:[],handoffIds:[]} : await context(task,workspace,extra,operational);
    const suppliedContext = supplied.text;
    const input = digest(JSON.stringify({protocol:executionProtocol,role,strategy,instruction,context:suppliedContext,source:await inputHash(workspace,taskInputs(plan,task)),environment:operational.revision,configuration:options.configurationRevision ?? '',resourceAttempt:progress.retryGeneration ?? 0}));
    const previous = progress.actions.findLast(action => action.id === input && action.result && action.outcome !== 'cancelled');
    if (previous?.result) { metrics.repetitions.push({taskId:task.id,action:role,reason:`Reused persisted result: same input and strategy (${strategy}).`,at:now()}); return structuredClone(previous.result); }
    const unresolved = progress.actions.findLast(action => action.id === input && action.outcome === 'running');
    if (unresolved) return {status:'unavailable',text:'',commands:[],changedFiles:[],issue:{kind:'instrument',recoverable:true,message:'The preceding identical operation was interrupted without a recorded result. Inspect its persisted workspace before requesting another action.'}};
    const purpose=operationPurpose??(operationContext?'environment-recovery':readOnly?'inspection':'implementation');
    const action: ActionRecord = {id:input,action:role,purpose,input,strategy,reason:extra.slice(0,1200) || 'Initial implementation of this work unit.',at:now(),durationMs:0,outcome:'running',sourceCoverage:supplied.coverage,...(supplied.handoffIds.length?{handoffIds:supplied.handoffIds}:{})};
    progress.actions.push(action); await save();
    const begin=Date.now();
    let before:Awaited<ReturnType<typeof snapshot>>|undefined;
    let active=false,agentDuration=0;
    let phase='source snapshot';
    let result:AgentResult={status:'unavailable',text:'',commands:[],changedFiles:[],issue:{kind:'instrument',recoverable:true,message:'The invocation instrument did not become executable.'}};
    const instrumentFailure=(error:unknown):void=>{
      const message=`Invocation ${phase} failed: ${error instanceof Error?error.message:String(error)}`;
      const kind=error instanceof OperationalInvocationConflict?'environment':'instrument';
      result={...result,status:result.changedFiles.length?'partial':'unavailable',issue:{kind:'instrument',recoverable:true,message}};
      note(incident(kind,task.id,message,workspace));
      if(error instanceof OperationalInvocationConflict)scheduleReplan(task,incident('environment',task.id,'Provider invocation aliases conflict; reconcile bindings for this consumer.',message));
    };
    try{
      before=await snapshot(workspace);
      phase='instrument preparation';
      const instrument=await measured('agentInstrument',()=>prepareInvocationInstrument(workspace,operational));
      if(instrument.repairs.length)action.instrumentRepairs=structuredClone(instrument.repairs);
      for(const repair of instrument.repairs)note(incident('instrument',task.id,'Recovered a corrupted invocation instrument without stopping the work unit.',JSON.stringify(repair)));
      phase='agent transport';
      action.agentStartedAt=now();
      if(purpose==='implementation'&&!readOnly)progress.attempts++;
      await save();
      const timeline={taskId:task.id,stage:role,start:Date.now()};metrics.timeline.push(timeline);
      metrics.active++;active=true;metrics.maxConcurrency=Math.max(metrics.maxConcurrency,metrics.active);metrics.callsByRole[role]=(metrics.callsByRole[role]??0)+1;
      try{
        result=await options.agent({workspace,role,purpose,operationKey:input,instruction,context:suppliedContext,readOnly,environment:instrument.environment,constraints:executionConstraints(options.brief,options.allowSystemInstall),...(options.signal?{signal:options.signal}:{}),onEvent:detail=>emitEvent(options.onEvent,detail)});
      }catch(error){result={status:'unavailable',text:'',commands:[],changedFiles:[],issue:{kind:'transport',recoverable:true,message:String(error)}};}
      finally{agentDuration=Date.now()-timeline.start;Object.assign(timeline,{end:Date.now()});metrics.active--;active=false;}
      phase='source protection';
      const changes=await changedSince(workspace,before);
      if(readOnly&&changes.length){
        await restoreFiles(workspace,before,changes);
        result={...result,status:'partial',changedFiles:changes,issue:{kind:'instrument',recoverable:true,message:`Read-only inspection changed product files; its original source was restored: ${changes.join(', ')}.`}};
      }else if(!readOnly&&!allowedCapabilities(options.brief,['http-server'])){
        const forbidden=await introducedServers(workspace,before);
        if(forbidden.length){await restoreFiles(workspace,before,forbidden);result={...result,status:'partial',issue:{kind:'constraint',recoverable:true,message:`Restored forbidden HTTP effect in ${forbidden.join(', ')}. Preserve the requested interface and repair only the observed cause.`}};}
      }
    }catch(error){instrumentFailure(error);}
    finally{
      if(active)metrics.active--;
      phase='result finalization';
      try{if(before)result.changedFiles=await changedSince(workspace,before);}
      catch(error){instrumentFailure(error);}
      try{action.after=await inputHash(workspace,taskInputs(plan,task));}
      catch(error){instrumentFailure(error);}
      action.durationMs=Date.now()-begin;
      action.outcome=result.status==='cancelled'?'cancelled':result.changedFiles.length?'changed':result.status==='complete'&&!result.issue?'unchanged':'failed';
      action.result=structuredClone(result);if(result.issue)action.failure=result.issue.message;
      metrics.timeByStageMs[role]=(metrics.timeByStageMs[role]??0)+agentDuration;
      progress.changedFiles=[...new Set([...progress.changedFiles,...result.changedFiles])];
      await save();
    }
    return result;
  };
  const consumerHints = (node:EnvironmentNode):{inputs:string[];checks:Verification[]} => {
    const consumers=plan.tasks.filter(task=>closure(plan,task).some(prerequisite=>prerequisite.id===node.id));
    return {inputs:[...new Set(consumers.flatMap(task=>taskInputs(plan,task)))],checks:consumers.flatMap(task=>state.tasks[task.id]?.checks??task.checks)};
  };
  const installationEnvironment=(workspace:string):OperationalEnvironment=>relocateOperationalEnvironment(mergeOperationalEnvironments(options.workspace,...plan.environment.flatMap(node=>{
    const value=state.environment[node.id];
    const prepared=value?.ready&&value.inputHash===digest(JSON.stringify(node))?operationalValue(value.operational):undefined;
    return prepared?[prepared]:[];
  })),options.workspace,workspace);
  const preparations = async (task: WorkUnit): Promise<boolean> => {
    for (const node of closure(plan,task)) {
      const installer=installationEnvironment(options.workspace);
      const flightKey = `${node.id}:${await environmentFingerprint(options.workspace,node,operationalValue(state.environment[node.id]?.operational))}:${installer.revision}`;
      let flight = nodeFlights.get(flightKey);
      if (!flight) {
        flight = serial('environmentPreparation',async () => {
          if (integrationBlocked || persistenceFailed) return false;
          const previous = state.environment[node.id];
          const storedDefinition=state.environmentDefinitions![node.id];const declarationHash=digest(JSON.stringify(node));
          const originalHash=storedDefinition&&(storedDefinition.originalHash===declarationHash||digest(JSON.stringify(storedDefinition.definition))===declarationHash)?storedDefinition.originalHash:declarationHash;
          const rememberDeclaration=():void=>{state.environmentDefinitions![node.id]={originalHash,definition:structuredClone(node)};};
          const base = mergeOperationalEnvironments(options.workspace,...node.dependsOn.map(id=>operationalValue(state.environment[id]?.operational)));
          let result = await prepareEnvironmentNode(options.workspace,node,options.brief,command,{...consumerHints(node),operational:base,installationOperational:installationEnvironment(options.workspace),...(options.signal?{signal:options.signal}:{}),allowSystemInstall:options.allowSystemInstall === true,terminal,onEvent:detail=>emitEvent(options.onEvent,detail),...(previous?.fingerprint ? {previous:{ready:previous.ready,fingerprint:previous.fingerprint,...(previous.installationRevision?{installationRevision:previous.installationRevision}:{}),operational:operationalValue(previous.operational) ?? base,...(previous.failedFingerprint?{noProgress:true}: {})}} : {})});
          const exhausted = previous?.recovery?.exhausted && previous.recovery.protocol===executionProtocol && previous.recovery.fingerprint===result.fingerprint && previous.recovery.configuration===(options.configurationRevision??'') && previous.installationRevision===installer.revision && !options.retrySuspended;
          if (!result.ready && !exhausted) {
            // An environment operation owns only installation/configuration. Its private proposal
            // cannot silently become an implementation of the product work unit.
            const recovery = environmentRecoveryTask(task,node);
            const recoveryProgress = state.tasks[recovery.id] ??= initialTask();
            recoveryProgress.actions ??= []; recoveryProgress.reviews ??= [];
            const observe = (): string => environmentRecoveryContext(node,result.incidents);
            const probe = async (): Promise<void> => {
              rememberDeclaration();await save();
              result = await prepareEnvironmentNode(options.workspace,node,options.brief,command,{...consumerHints(node),previous:result.cache,revalidate:true,operational:base,installationOperational:installationEnvironment(options.workspace),allowSystemInstall:options.allowSystemInstall === true,terminal,...(options.signal?{signal:options.signal}:{}),onEvent:detail=>emitEvent(options.onEvent,detail)});
              for (const problem of result.incidents) note(problem);
              await save();
            };
            const applyDeclaration = (text: string,from: string): void => {
              const proposal = jsonObject(text);
              if (!proposal) return;
              const candidate = proposal.environment && typeof proposal.environment==='object' && !Array.isArray(proposal.environment) ? proposal.environment as Record<string,unknown> : proposal;
              // Repairs may change invocation/recipes, never mandatory identity or ownership.
              const decoded=JSON.parse(JSON.stringify(candidate).replaceAll(from,options.workspace)) as Record<string,unknown>;
              const revised=normalizeEnvironment([{...node,...(decoded.provides&&typeof decoded.provides==='object'?{provides:decoded.provides}:{}),...(decoded.check&&typeof decoded.check==='object'?{check:decoded.check}:{}),...(Array.isArray(decoded.prepare)?{prepare:decoded.prepare}:{})}],options.brief)[0];
              if(revised){if(revised.provides)node.provides=revised.provides;else delete node.provides;node.check=revised.check;node.prepare=revised.prepare;}
            };
            const repair = async (strategy: string,guidance=''): Promise<boolean> => {
              const area = recoveryProgress.checkpoint ??= await beginEnvironmentRecovery(options.workspace,node);
              recoveryProgress.proposals ??= [];
              if(!recoveryProgress.proposals.includes(area.directory)) recoveryProgress.proposals.push(area.directory);
              await save();
              const local=relocateOperationalEnvironment(base,options.workspace,area.directory);
              const details=`${observe()}${guidance?`\nINDEPENDENT DIAGNOSIS\n${guidance}`:''}`;
              const answer=await invoke(recovery,area.directory,'repair','Restore this exact capability within the isolated installation scope. Inspect the actual available provider and failed invocation. Return JSON {provides,check,prepare} for concrete changed invocation/recipes. Product changes are quarantined by the coordinator.',details,false,strategy,local,details);
              if(answer.status==='cancelled'||options.signal?.aborted){cancelled=true;return false;}
              if(external(answer)){note(incident('transport',node.id,'The environment recovery transport is unavailable.',answer.issue?.message??answer.text,true));return false;}
              applyDeclaration(answer.text,area.directory);
              rememberDeclaration();await save();
              const publication=await commitEnvironmentRecovery(options.workspace,node,area,node.provides,async transaction=>{state.integrations!.push(transaction);await save();});
              if(publication.quarantined.length)note(incident('instrument',node.id,'Environment recovery attempted out-of-scope product edits; they remain preserved as a private proposal.',JSON.stringify({directory:area.directory,paths:publication.quarantined})));
              // A later strategy starts from the actual published environment, not an old local copy.
              delete recoveryProgress.checkpoint;
              await probe();
              metrics.repetitions.push({taskId:task.id,action:'environment-recovery',reason:`${strategy}: readiness ${result.ready?'confirmed':'still negative'} after isolated scope publication.`,at:now()});
              return result.ready;
            };
            for(const problem of result.incidents)note(problem);
            const first=result.fingerprint;
            if(!await repair(`environment:${node.id}:${first}`)&&!cancelled){
              const details=observe();
              const diagnosticArea=await beginEnvironmentRecovery(options.workspace,node);
              const diagnosis=await invoke(recovery,diagnosticArea.directory,'reviewer','Diagnose this failed environment repair from concrete files and the host. Distinguish provider absence, invalid invocation, invalid readiness recipe and plan ownership. Return JSON {cause,fix,environment:{provides,check,prepare}}. Give a genuinely different executable recovery; do not implement the application.',details,true,`environment-diagnosis:${node.id}:${result.fingerprint}`,relocateOperationalEnvironment(base,options.workspace,diagnosticArea.directory),details);
              if(diagnosis.status==='cancelled')cancelled=true;
              else if(!external(diagnosis)&&!diagnosis.issue){
                const before=digest(JSON.stringify(node));applyDeclaration(diagnosis.text,diagnosticArea.directory);
                if(before!==digest(JSON.stringify(node)))await probe();
                if(!result.ready){
                  const parsed=jsonObject(diagnosis.text);
                  const guidance=[parsed?.cause,parsed?.fix].filter(item=>typeof item==='string'&&item.trim()).join('\n');
                  if(guidance)await repair(`environment-guided:${node.id}:${digest(guidance)}:${result.fingerprint}`,guidance);
                }
              }
              if(!result.ready&&!cancelled){
                const failure=incident('planning',node.id,'Provider preparation and independent recovery did not produce a usable invocation. Reconcile this capability, readiness and consumer contract before suspending.',observe());
                failure.repairScope='environment';
                scheduleReplan(task,failure);note(failure);
              }
            }
          }
          rememberDeclaration();
          if(result.ready){
            try{await measured('providerPublication',()=>prepareInvocationInstrument(options.workspace,mergeOperationalEnvironments(options.workspace,base,result.operational)));}
            catch(error){note(incident('instrument',node.id,'The provider is ready, but its canonical convenience wrappers could not be published. The isolated invocation instrument will repair or classify the concrete cause.',String(error)));}
          }
          state.environment[node.id] = {ready:result.ready,inputHash:digest(JSON.stringify(node)),fingerprint:result.fingerprint,...(result.cache.installationRevision?{installationRevision:result.cache.installationRevision}:{}),operational:result.operational,...(!result.ready?{failedFingerprint:result.fingerprint,recovery:{fingerprint:result.fingerprint,configuration:options.configurationRevision??'',protocol:executionProtocol,exhausted:!cancelled,reason:result.incidents.map(item=>`${item.message}\n${item.evidence}`).join('\n')}}:{})};
          for (const problem of result.incidents) note(problem); await save(); return result.ready;
        });
        nodeFlights.set(flightKey,flight);
      }
      if (!await flight) return false;
    }
    const dependenciesReady=await serial('dependencies',async()=>{
      if(integrationBlocked||persistenceFailed)return false;
      const inputs=taskInputs(plan,task),checks=state.tasks[task.id]?.checks??task.checks;const key=`$project:${projectDependencyScope(inputs,checks)}`;
      const previous=state.environment[key];const base=canonicalOperational(task);
      const result=await prepareProjectDependencies(options.workspace,options.brief,request=>command(applyOperationalEnvironment(request,base)),{inputs:taskInputs(plan,task),checks:state.tasks[task.id]?.checks??task.checks,operational:base,terminal,installationOperational:installationEnvironment(options.workspace),allowSystemInstall:options.allowSystemInstall===true,...(options.signal?{signal:options.signal}:{}),...(previous?.fingerprint?{previous:{ready:previous.ready,fingerprint:previous.fingerprint,operational:operationalValue(previous.operational)??emptyOperationalEnvironment(options.workspace),...(previous.failedFingerprint?{noProgress:true}: {})}}:{}),onEvent:detail=>emitEvent(options.onEvent,detail)});
      state.environment[key]={ready:result.ready,inputHash:result.fingerprint,fingerprint:result.fingerprint,operational:selectOperationalEnvironment(result.cache.operational,inputs,checks),preparedAt:now(),...(!result.ready?{failedFingerprint:result.fingerprint}:{})};
      if(!state.tasks[task.id]!.dependencyCache)state.tasks[task.id]!.dependencyCache=result.cache;
      for(const problem of result.incidents)note(problem);
      if(!result.ready){const problem=incident('environment',task.id,'Project dependency preparation has no usable consumer environment; reconcile its concrete installation and provider contract.',result.incidents.map(item=>`${item.message}\n${item.evidence}`).join('\n'));problem.repairScope='environment';scheduleReplan(task,problem);}
      await save();return result.ready;
    });
    if(!dependenciesReady)return false;
    const proposal=state.tasks[task.id]?.checkpoint?.directory;
    const workspace=proposal&&await exists(proposal)?proposal:options.workspace;
    const operational=relocateOperationalEnvironment(canonicalOperational(task),options.workspace,workspace);
    for(const check of state.tasks[task.id]?.checks??task.checks){
      if(selectVerifications(options.brief,{...task,checks:[check]}).some(item=>item.replaced))continue;
      const resource=await prepareResources(task,check,workspace,operational);
      if(!resource.ready){const problem=incident('environment',task.id,'The concrete browser provider is not usable yet; recover its cache or host prerequisites.',resource.details);scheduleReplan(task,problem);note(problem);return false;}
    }
    return true;
  };
  const projectDependencies = async (task: WorkUnit,workspace: string,operational: OperationalEnvironment): Promise<OperationalEnvironment | null> => {
    const progress = state.tasks[task.id]!;
    operational=await synchronizeProviders(task,workspace,operational);
    const old=progress.dependencyCache as PreparedEnvironment|undefined;
    const previous=old?{...old,operational:old.operational.root&&old.operational.root!==workspace?relocateOperationalEnvironment(old.operational,old.operational.root,workspace):old.operational}:undefined;
    const result = await measured('dependencies',()=>prepareProjectDependencies(workspace,options.brief,command,{inputs:taskInputs(plan,task),checks:progress.checks??task.checks,operational,terminal,installationOperational:installationEnvironment(workspace),allowSystemInstall:options.allowSystemInstall === true,...(options.signal?{signal:options.signal}:{}),...(previous?{previous}:{}),onEvent:detail=>emitEvent(options.onEvent,detail)}));
    progress.dependencyCache = result.cache; await save();
    if (result.ready) return result.operational;
    for (const problem of result.incidents) note({...problem,subject:task.id});
    const answer = await invoke(task,workspace,'repair','Repair only the dependency preparation and exact local provider responsible for this failure. Reconcile the manifest or install locally; do not change product behavior or replace a mandatory stack.',result.incidents.map(item=>`${item.message}\n${item.evidence}`).join('\n'),false,`project-environment:${result.fingerprint}`,operational);
    if (answer.status === 'cancelled' || external(answer)) return null;
    let again = await measured('dependencies',()=>prepareProjectDependencies(workspace,options.brief,command,{inputs:taskInputs(plan,task),checks:progress.checks??task.checks,previous:result.cache,revalidate:true,operational:result.operational,terminal,installationOperational:installationEnvironment(workspace),allowSystemInstall:options.allowSystemInstall === true,...(options.signal?{signal:options.signal}:{}),onEvent:detail=>emitEvent(options.onEvent,detail)}));
    progress.dependencyCache = again.cache;await save();
    if(again.ready)return again.operational;
    const detail=again.incidents.map(item=>`${item.message}\n${item.evidence}`).join('\n');
    const diagnosis=await invoke(task,workspace,'reviewer','Diagnose this unchanged dependency preparation without editing product behavior. Return JSON {cause,fix}. Name a concrete different provider or installation action consistent with the required stack; explain why it can change the failed observation.',detail,true,`diagnose-project-environment:${again.fingerprint}`,again.operational);
    if(diagnosis.status==='cancelled'||options.signal?.aborted){cancelled=true;return null;}
    const explanation=jsonObject(diagnosis.text),fix=[explanation?.cause,explanation?.fix].filter(item=>typeof item==='string').join('\n');
    if(fix&&!diagnosis.issue){
      const guided=await invoke(task,workspace,'repair','Repair only the dependency/provider cause using this independently diagnosed alternative. Preserve product behavior and the mandatory stack.',`${detail}\nDIAGNOSED ALTERNATIVE\n${fix}`,false,`guided-project-environment:${again.fingerprint}:${digest(fix)}`,again.operational);
      if(guided.status==='cancelled'||options.signal?.aborted){cancelled=true;return null;}
      if(!external(guided))again=await measured('dependencies',()=>prepareProjectDependencies(workspace,options.brief,command,{inputs:taskInputs(plan,task),checks:progress.checks??task.checks,previous:again.cache,revalidate:true,operational:again.operational,terminal,installationOperational:installationEnvironment(workspace),allowSystemInstall:options.allowSystemInstall === true,...(options.signal?{signal:options.signal}:{}),onEvent:detail=>emitEvent(options.onEvent,detail)}));
      progress.dependencyCache=again.cache;await save();if(again.ready)return again.operational;
    }
    const problem=incident('environment',task.id,'Dependency preparation and the independently diagnosed alternative did not produce a usable consumer environment. Reconcile the provider contract.',`${detail}\n${diagnosis.text}`);problem.repairScope='environment';scheduleReplan(task,problem);note(problem);await save();return null;
  };
  const recoverAssertions = async (task: WorkUnit,workspace: string,operational: OperationalEnvironment,failures: VerificationOutcome[],observedInstrument=false): Promise<boolean> => {
    const pending=failures.filter(failure=>failure.classification==='instrument'&&(failure.evidence.assertionStatus==='missing'||failure.evidence.assertionStatus==='invalid'));
    if(!pending.length)return false;
    const progress=state.tasks[task.id]!;
    const checks=progress.checks??task.checks;
    const observations=pending.map(failure=>({check:checks.find(check=>check.id===failure.evidence.checkId),inputHash:failure.evidence.inputHash,observation:failure.evidence.observation,transcript:failure.evidence.observation?undefined:failure.evidence.output}));
    let diagnostics='';
    for(const role of ['repair','reviewer']){
      const payload=JSON.stringify({operation:'bind-observed-assertion',criteria:task.criteria,observations,diagnostics});
      const answer=await invoke(task,workspace,role,'Bind a mechanical assertion to each observed command without changing that command or the product. Return JSON {assertions:[{checkId,assertion:{type:"contains",source:"stdout",value:"exact observed output"}}]}. Other assertion types: regex(pattern,flags), json(path,equals), exit(value), all(assertions). Preserve the semantic expected criterion; the independent product review must still establish that criterion. A description is not an assertion object.',payload,true,`assertion-contract:${role}:${digest(payload)}`,operational,payload,'inspection');
      if(answer.status==='cancelled'){cancelled=true;return false;}
      if(external(answer)||answer.issue)return false;
      const value=jsonObject(answer.text);
      const replacements=new Map<string,Verification>();
      for(const proposal of Array.isArray(value?.assertions)?value.assertions:[]){
        if(!proposal||typeof proposal!=='object')continue;
        const candidate=proposal as {checkId?:unknown;assertion?:unknown};
        const original=checks.find(check=>check.id===candidate.checkId&&pending.some(failure=>failure.evidence.checkId===check.id));
        const assertion=normalizeVerificationAssertion(candidate.assertion);
        if(!original||!assertion)continue;
        const earlier=replacements.get(original.id)?.assertion;
        const revised:Verification={...original,assertion:earlier&&JSON.stringify(earlier)!==JSON.stringify(assertion)?{type:'all',assertions:[earlier,assertion]}:assertion};
        delete revised.assertionIssue;
        const observation=pending.find(failure=>failure.evidence.checkId===original.id)?.evidence.observation;
        if(observedInstrument&&(!observation||evaluateVerificationAssertion(revised,observation).passed!==true))continue;
        if(verificationAssertionStatus(revised).status==='ready')replacements.set(original.id,revised);
      }
      if(replacements.size===pending.length){
        const revised=checks.map(check=>replacements.get(check.id)??check);
        if(JSON.stringify(revised)!==JSON.stringify(checks)){progress.checks=revised;progress.strategy='revalidate-only';event('recovery','Asserções tipadas associadas às observações reais; receitas, critérios e código preservados.',task.id);await save();return true;}
      }
      diagnostics=JSON.stringify({received:value,problem:'Every pending check needs a structurally valid assertion object bound by its exact checkId; prose cannot be executed.'});
    }
    const problem=incident('planning',task.id,'The observed command has no executable assertion contract after independent interpretation. Reconcile only this proof; preserve implemented work.',JSON.stringify(observations));problem.repairScope='verification';scheduleReplan(task,problem);
    return false;
  };
  const triageAssertionFailure = async(task:WorkUnit,workspace:string,operational:OperationalEnvironment,failures:VerificationOutcome[]):Promise<boolean>=>{
    const checks=state.tasks[task.id]!.checks??task.checks;
    const candidates=failures.filter(failure=>{
      const check=checks.find(check=>check.id===failure.evidence.checkId),observed=failure.evidence.observation;
      const instrument=check?.kind==='command'||check?.instrument?.output==='runner'||check?.kind==='cli'&&!options.brief.modes.includes('cli')||check?.kind==='web'&&usableProof(check,failure.evidence);
      return instrument&&failure.classification==='product'&&failure.evidence.assertionStatus==='failed'&&observed&&!observed.issue&&!observed.cancelled&&!observed.timedOut&&observed.exitCode===(check!.expectedExitCode??0);
    });
    if(!candidates.length)return false;
    const payload=JSON.stringify({criteria:task.criteria,checks:candidates.map(failure=>({definition:checks.find(check=>check.id===failure.evidence.checkId),observation:failure.evidence.observation}))});
    const diagnosis=await invoke(task,workspace,'reviewer','Classify a successful verification command whose generated output assertion failed. Preserve the original negative proof. Distinguish an actual product failure from a wrong assertion or reporter format. Inspect the existing verification source when needed. Return JSON {kind:"product"|"instrument",cause,fix}. A product defect needs concrete expected/observed behavior; do not edit product code to match an invented test-runner summary.',payload,true,`assertion-diagnosis:${digest(payload)}`,operational,payload,'inspection');
    if(diagnosis.status==='cancelled'){cancelled=true;return false;}
    const value=jsonObject(diagnosis.text);
    if(value?.kind==='product')return false;
    if(value?.kind!=='instrument'||typeof value.cause!=='string'||!value.cause.trim()){
      const problem=incident('planning',task.id,'The negative assertion needs a concrete product/instrument resolution before authorizing an edit.',diagnosis.text);problem.repairScope='verification';scheduleReplan(task,problem);return false;
    }
    state.proofInterpretations??=[];
    for(const failure of candidates)state.proofInterpretations.push({evidenceId:failure.evidence.id,at:now(),originalClassification:failure.classification??'product',classification:'instrument',reason:JSON.stringify(value),...(state.tasks[task.id]!.actions?.at(-1)?.id?{actionId:state.tasks[task.id]!.actions!.at(-1)!.id}:{})});
    await save();
    const classified=candidates.map(failure=>({...failure,classification:'instrument' as const,evidence:{...failure.evidence,assertionStatus:'invalid' as const}}));
    return recoverAssertions(task,workspace,operational,classified,true);
  };
  const repairRecipe = async (task: WorkUnit,workspace: string,operational: OperationalEnvironment,reason: string,requiredKind?: Verification['kind'],extend=false,strategy='instrument',packet?:string,behaviorRequired=false): Promise<boolean> => {
    const progress = state.tasks[task.id]!;
    const answer = await invoke(task,workspace,'repair','Repair only the verification recipe for this existing work unit. Inspect the actual entrypoint and evidence; preserve product files, requirements and interface. Return JSON {checks:[{kind,command,args,expected,assertion:{type:"contains",value:"literal observable output"},expectedExitCode,input,steps,closeInput,requiredCapabilities,target,inputs,level}]}. expected is the human criterion; assertion is an executable object. An inline Node/Python runner may perform actual interaction and create temporary instruments under .capivara-verification in its private writable verification workspace; it is not delivered product code. TUI steps must observe literal ready output before input and a new literal state after input. Do not require more tests by count.',`INSTRUMENT TO RECOVER\n${reason}`,true,`${strategy}:${digest(reason)}`,operational,packet,packet?'inspection':undefined);
    if (answer.status === 'cancelled' || external(answer) || answer.issue) return false;
    const value = jsonObject(answer.text);
    const decoded=normalizeChecks(value?.checks,options.brief);
    let checks = decoded.map(check=>({...check,...(requiredKind==='web'&&check.kind==='command'&&(check.target==='browser'||check.requiredCapabilities.includes('browser'))?{kind:'web' as const}:{}),requirementIds:check.requirementIds.length?check.requirementIds:task.requirementIds})).filter(check=>(!requiredKind || check.kind === requiredKind) && (!behaviorRequired||verificationLevel(check)==='behavior') && check.command && selectVerifications(options.brief,{...task,checks:[check]}).every(item=>!item.replaced));
    if(progress.interfaceRejections?.length){
      const stamp=await interfaceSourceStamp(task,workspace,operational);
      checks=checks.filter(check=>{
        if(check.kind==='command')return true;
        const rejected=progress.interfaceRejections!.find(item=>item.key===interfaceKey(check,workspace,operational,stamp));
        if(!rejected)return true;
        metrics.repetitions.push({taskId:task.id,action:'reject-repeated-interface-invocation',reason:JSON.stringify({original:check,previousEvidenceId:rejected.evidenceId,basis:'The same invocation, source and operational environment already supplied no interaction in this interface. A new ID, predicate or label is not an executable strategy.'}),at:now()});return false;
      });
    }
    const key = (items: Verification[]): string => digest(JSON.stringify(items.map(check=>{const {id:_id,expected:_criterion,assertionIssue:_issue,...item}=check;return {...item,assertion:verificationAssertionStatus(check).assertion??null};})));
    const revised=reconcileChecks(extend?[...(progress.checks??task.checks),...checks]:checks);
    if (!checks.length || key(revised) === key(progress.checks ?? task.checks)) return false;
    for(const original of decoded)if(original.kind==='command'&&checks.some(check=>check.id===original.id&&check.kind==='web'))metrics.repetitions.push({taskId:task.id,action:'verification-interface-decoding',reason:JSON.stringify({original,selectedKind:'web',basis:'The recovery operation explicitly requested web interaction and the declaration explicitly targets browser. No execution or approval is inferred.'}),at:now()});
    progress.checks = revised; progress.strategy = 'revalidate-only';if(progress.checkpoint)progress.checkpoint.phase='checking';event('recovery','Receita alterada; o código do produto permanece preservado.',task.id); await save(); return true;
  };
  const materializeVerification = async(task:WorkUnit,workspace:string,operational:OperationalEnvironment,reason:string,requiredKind?:Verification['kind'],integrated=false):Promise<boolean>=>{
    const progress=state.tasks[task.id]!;
    // A write permission such as src/ or . does not assign every future test
    // to this fragment. Before integration, native runners need a concrete
    // source changed by this delivery; project suites belong to final proof.
    const native=await repositoryVerificationCandidates(workspace,integrated?task:{...task,files:progress.changedFiles},requiredKind,integrated);
    const before=progress.checks??task.checks;
    const fresh=native.filter(check=>!before.some(existing=>existing.command===check.command&&JSON.stringify(existing.args)===JSON.stringify(check.args)&&existing.kind===check.kind));
    if(fresh.length){progress.checks=reconcileChecks([...before,...fresh]);progress.strategy='revalidate-only';if(progress.checkpoint)progress.checkpoint.phase='checking';metrics.repetitions.push({taskId:task.id,action:'materialize-repository-verification',reason:'A concrete current repository runner now supplies a candidate; its command and interaction still have to execute.',at:now()});await save();return true;}
    if(requiredKind&&requiredKind!=='command'){
      const target:Verification={id:`${task.id}-observed-${requiredKind}`,kind:requiredKind,level:'behavior',expected:task.goal,requirementIds:[...task.requirementIds],requiredCapabilities:requiredKind==='web'?['browser']:[]};
      const candidate=candidateFromRecordedInterfaceProof({plan,targetTaskId:task.id,target,requiredKind,evidence:state.evidence.filter(proof=>!state.proofInterpretations?.some(item=>item.evidenceId===proof.id&&item.classification==='invalidated')),taskChecks:Object.fromEntries(plan.tasks.map(unit=>[unit.id,state.tasks[unit.id]?.checks??unit.checks])),workspace,sourceWorkspaces:Object.fromEntries(plan.tasks.map(unit=>[unit.id,[...state.tasks[unit.id]?.proposals??[],...state.integrations?.filter(item=>item.taskId===unit.id).map(item=>item.workspace)??[],...(state.tasks[unit.id]?.checkpoint?[state.tasks[unit.id]!.checkpoint!.directory]:[])]]))});
      if(candidate){
        const key=interfaceKey(candidate.check,workspace,operational,await interfaceSourceStamp(task,workspace,operational));
        if(!progress.interfaceRejections?.some(item=>item.key===key)&&!before.some(check=>check.id===candidate.check.id&&JSON.stringify(check)===JSON.stringify(candidate.check))){
          progress.checks=reconcileChecks([...before,candidate.check]);progress.strategy='revalidate-only';if(progress.checkpoint)progress.checkpoint.phase='checking';
          metrics.repetitions.push({taskId:task.id,action:'materialize-observed-interface-recipe',reason:JSON.stringify(candidate.transformation),at:now()});
          event('recovery','Receita com interação real já observada adotada como candidata; a execução e a revisão atuais continuam obrigatórias.',task.id);await save();return true;
        }
      }
    }
    if(await repairRecipe(task,workspace,operational,reason,requiredKind,true,'materialize-verification',undefined,true))return true;
    if(cancelled||options.signal?.aborted)return false;
    const surfaces=await verificationSurfaces(workspace,task);
    const first=progress.actions?.findLast(action=>action.strategy===`materialize-verification:${digest(reason)}`);
    const packet=JSON.stringify({operation:'resolve-verification-interface',taskId:task.id,interface:requiredKind,criteria:task.criteria,requirementIds:task.requirementIds,sourceIndex:surfaces,previousAnswer:first?.result?.text,problem:'The first answer supplied no different executable behavior recipe. Inspect these actual files and return only the missing proof; source code is preserved.'});
    if(await repairRecipe(task,workspace,operational,`${reason}\nA concrete source/manifest index is now available; resolve the actual interface, not the previous proposed format.`,requiredKind,true,'inspect-verification-surface',packet,true))return true;
    if(cancelled||options.signal?.aborted)return false;
    let probe:unknown;
    if(surfaces.probe&&(requiredKind==='cli'||!requiredKind&&options.brief.modes.length===1&&options.brief.modes[0]==='cli')){
      const request=surfaces.probe,key=digest(JSON.stringify({request,source:await inputHash(workspace,taskInputs(plan,task)),environment:operational.revision}));
      let action=progress.actions?.findLast(item=>item.id===key&&item.action==='verification-probe');
      if(!action){
        action={id:key,action:'verification-probe',input:key,strategy:'observe-entrypoint',reason:'The recorded recipe answers were unusable; observe a bounded real entrypoint interface before choosing an alternative.',at:now(),durationMs:0,outcome:'running'};progress.actions??=[];progress.actions.push(action);await save();
        const area=await serial('verificationIsolation',()=>createTaskWorkspace(workspace,`${task.id}:interface-probe`,definitionHash(task),taskWriteScopes(task,state))),start=Date.now();
        try{const result=await command(applyOperationalEnvironment({cwd:area.directory,command:[request.command,...request.args],timeoutMs:1500,constraints:executionConstraints(options.brief,options.allowSystemInstall),executionPolicy:{purpose:'verification',writeScope:'isolated-workspace'},...(options.signal?{signal:options.signal}:{})},relocateOperationalEnvironment(operational,workspace,area.directory)));action.result={status:result.cancelled?'cancelled':'complete',text:JSON.stringify({command:result.command,exitCode:result.exitCode,stdout:result.stdout,stderr:result.stderr,timedOut:result.timedOut}),commands:[result],changedFiles:[]};action.outcome=result.cancelled?'cancelled':'complete';}
        catch(error){action.outcome='failed';action.failure=String(error);}
        finally{action.durationMs=Date.now()-start;await save();await rm(dirname(area.directory),{recursive:true,force:true}).catch(()=>{});}
      }
      probe=action.result?.text??action.failure;
    }
    const alternative=JSON.stringify({operation:'compose-verification-runner',taskId:task.id,interface:requiredKind,criteria:task.criteria,sourceIndex:surfaces,entrypointObservation:probe,recordedFailures:progress.actions?.filter(action=>action.strategy.startsWith('materialize-verification:')||action.strategy.startsWith('inspect-verification-surface:')).map(action=>({strategy:action.strategy,result:action.result?.text})),strategy:'Use a self-contained focused runner for the existing product when no repository test interface exists. Return a literal command/args and a typed assertion for the requested interaction. A runner can live in command args and create its temporary files in the isolated verification directory. Missing delivered functionality remains a product finding; a missing recipe alone never authorizes a product rewrite.'});
    return repairRecipe(task,workspace,operational,`${reason}\nThe repository runner and prior interface proposals were unavailable. Compose a different executable instrument from the actual source${probe?' and the recorded entrypoint observation':''}.`,requiredKind,true,'compose-verification-runner',alternative,true);
  };
  const verify = async (task: WorkUnit,workspace: string,operational: OperationalEnvironment,checks: Verification[]): Promise<VerificationOutcome[]> => {
    const order=ordered(checks.map(check=>({...check,dependsOn:check.dependsOn??[]})));
    if(order.unresolved.length)throw new WorkPlanningError(`Verification dependencies are cyclic or missing: ${order.unresolved.map(check=>check.id).join(', ')}.`);
    checks=order.ready.map(item=>checks.find(check=>check.id===item.id)!);
    const owner=state.tasks[task.id];
    const invalidated=new Set(state.proofInterpretations?.filter(item=>item.classification==='invalidated').map(item=>item.evidenceId));
    const available=state.evidence.filter(item=>!invalidated.has(item.id));
    if(checks.length&&checks.every(check=>available.some(item=>item.taskId===task.id&&item.checkId===check.id&&item.passed))){
      const reused=await cachedPositiveVerifications({workspace,taskId:task.id,checks,evidence:state.evidence,invalidatedEvidenceIds:invalidated,identity:check=>proofIdentity(task,check,workspace,operational),resource:check=>prepareResources(task,check,workspace,operational)});
      if(reused){
        if(owner)owner.verificationEvidence=reused.map(result=>({checkId:result.evidence.checkId,evidenceId:result.evidence.id,inputHash:result.evidence.inputHash}));
        for(const id of new Set(checks.map(check=>['web','tui','desktop'].includes(check.kind)?'G4' as const:'G2' as const)))gate(task,id,'complete','Provas atuais reaproveitadas; nenhuma cópia ou execução adicional foi necessária.');
        metrics.repetitions.push({taskId:task.id,action:'reuse-proof-without-fork',reason:JSON.stringify({proofIds:reused.map(result=>result.evidence.id),basis:'Current source, operational resource, interface and artifact identities match completed positive observations.'}),at:now()});
        emitProgress(options.onEvent,{id:'verification',label:`${task.id}: verificações avaliadas`,completed:checks.length,total:checks.length,status:'complete',stage:'build',unit:'verificações'});
        await save();return reused;
      }
    }
    const {selectors,sourceHash}=await measured('proofInputs',async()=>{
      const selectors=[...new Set([...(await Promise.all(checks.map(check=>proofSelectors(task,check,workspace)))).flat(),...checks.flatMap(declaredOutputs)])];
      return{selectors,sourceHash:await inputHash(workspace,await resolveInputDependencies(workspace,selectors),operational.revision)};
    });
    let area=owner?.verificationCheckpoint;
    let areaCurrent=Boolean(area&&area.sourceHash===sourceHash&&await exists(area.directory));
    if(areaCurrent&&area){
      const actual=await measured('proofInputs',async()=>inputHash(area!.directory,await resolveInputDependencies(area!.directory,selectors),operational.revision));
      if(actual!==sourceHash){
        areaCurrent=false;
        metrics.repetitions.push({taskId:task.id,action:'replace-mutated-verification-workspace',reason:JSON.stringify({recordedSourceHash:area.sourceHash,currentProposalHash:sourceHash,actualVerificationHash:actual,basis:'A previous verification changed its private input state. Recreate the instrument from current delivered inputs; preserve the product and observations.'}),at:now()});
        event('recovery','A área privada foi alterada pela verificação anterior; preparando entradas atuais sem reeditar o produto.',task.id);
      }
    }
    if(!areaCurrent){
      const copied=await measured('verificationIsolation',()=>createTaskWorkspace(workspace,`${task.id}:proofs`,definitionHash(task),[...task.files,...checks.flatMap(declaredOutputs)]));
      area={directory:copied.directory,sourceHash};if(owner){owner.verificationCheckpoint=area;await save();}
    }
    if(!area)throw new Error('The private verification workspace was not established.');
    const local=relocateOperationalEnvironment(operational,workspace,area.directory);
    const results: VerificationOutcome[] = []; const groups = new Map<BuildGateId,BuildGateStatus[]>();
    for (const check of checks) {
      const resource=await prepareResources(task,check,area.directory,local);
      const id: BuildGateId = ['web','tui','desktop'].includes(check.kind) ? 'G4' : 'G2';
      const completed = groups.get(id) ?? []; groups.set(id,completed); gate(task,id,'running','Conferindo a prova pertinente em área isolada gravável.');
      const effective=checkOperational(task,check,area.directory,local);
      const identity=await measured('proofInputs',()=>proofIdentity(task,check,area.directory,local)),hash=identity.inputHash;
      const artifactState=await inputSnapshot(area.directory,declaredOutputs(check));
      // A successful execution already proves the outer runner parses. Legacy
      // negative observations do not: classify the runner before blaming code.
      const reusableSyntax=(item:VerificationEvidence):boolean=>!invalidated.has(item.id)&&(!item.passed||usableProof(check,item))&&(item.passed||!inlineVerificationSyntaxRequired(check)||item.instrumentSyntaxChecked?.protocol==='inline-node-syntax/1');
      const latest = state.evidence.findLast(item=>item.taskId===task.id&&item.checkId===check.id&&item.inputHash===hash&&item.kind===check.kind&&item.level===verificationLevel(check)&&(!declaredOutputs(check).length||JSON.stringify(item.artifacts)===JSON.stringify(artifactState)));
      const cached=latest&&reusableSyntax(latest)&&!latest.observation?.cancelled&&(latest.passed||latest.classification==='product'||latest.classification==='instrument')?latest:undefined;
      if (cached&&resource.ready) results.push({evidence:{...cached,level:cached.level ?? verificationLevel(check),inputs:cached.inputs ?? []},result:null,classification:cached.passed?null:cached.classification??'product',needsInstrument:!cached.passed&&cached.classification==='instrument'});
      else {
        const latestObservation=state.evidence.findLast(item=>item.taskId===task.id&&item.checkId===check.id&&item.observationHash===identity.observationHash&&(!declaredOutputs(check).length||JSON.stringify(item.artifacts)===JSON.stringify(artifactState)));
        const observed=latestObservation&&reusableSyntax(latestObservation)&&usableProof(check,latestObservation)?latestObservation:undefined;
        const interpretation=observed?state.proofInterpretations?.findLast(item=>item.evidenceId===observed.id&&item.classification==='instrument'):undefined;
        const reused=resource.ready&&observed?evaluateRecordedObservation(check,observed,identity,interpretation?{instrumentClassification:{reference:interpretation.actionId??interpretation.evidenceId,reason:interpretation.reason}}:{}):undefined;
        if(reused){
          state.evidence.push(reused.evidence);results.push(reused);
          metrics.repetitions.push({taskId:task.id,action:'reuse-observation',reason:`Only the assertion changed. Evaluated the actual observation ${observed!.id} from ${observed!.observedAt??observed!.checkedAt}; source, invocation and environment remain identical.`,at:now()});
          event('recovery','Asserção avaliada sobre a execução real preservada; nenhum comando ou edição foi repetido.',task.id,{originalEvidenceId:observed!.id,evidenceId:reused.evidence.id});await save();
        }else{
        const env = await verificationEnvironment(area.directory);
        const native=await verificationContext(task,check,area.directory,effective);
        const execute = (request: CommandRequest) => command(applyOperationalEnvironment({...request,environment:{...env,...request.environment},executionPolicy:{purpose:'verification',writeScope:'isolated-workspace'}},native.operational));
        const pty = (request: TerminalRequest) => terminal(applyOperationalEnvironment({...request,environment:{...env,...request.environment},executionPolicy:{purpose:'verification',writeScope:'isolated-workspace'}},native.operational));
        const start = Date.now(); const result = await runVerification(area.directory,options.brief,task,plan,native.check,execute,pty,{operational:native.operational,identity,...(!resource.ready?{preparationFailure:resource.details}:{}),allowSystemInstall:options.allowSystemInstall === true,...(options.signal?{signal:options.signal}:{}),onEvent:detail=>emitEvent(options.onEvent,detail)});
        result.evidence.output=`Verification workspace: ${area.directory}\nProduct proposal: ${workspace}\n${result.evidence.output}`;
        if(declaredOutputs(check).length)result.evidence.artifacts=await inputSnapshot(area.directory,declaredOutputs(check));
        metrics.timeByStageMs.verification = (metrics.timeByStageMs.verification ?? 0) + Date.now() - start;
        state.evidence.push(result.evidence); results.push(result); await save();
        }
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
        const current=await proofHash(task,checks[index]!,workspace,operational);
        if(current!==results[index]!.evidence.inputHash){
          const proof=results[index]!.evidence;
          const problem=await verificationMutationError({workspace,verificationWorkspace:area.directory,check:checks[index]!,inputs:proof.inputs??selectors,expectedInputHash:proof.inputHash,currentInputHash:current});
          state.proofInterpretations??=[];
          state.proofInterpretations.push({evidenceId:proof.id,at:now(),originalClassification:proof.passed?'passed':proof.classification??'unknown',classification:'invalidated',reason:JSON.stringify(problem.report)});
          await save();throw problem;
        }
      }
      if(owner){area.sourceHash=await measured('proofInputs',async()=>inputHash(workspace,await resolveInputDependencies(workspace,selectors),operational.revision));await save();}
    }
    if(owner&&results.length===checks.length)owner.verificationEvidence=results.map(result=>({checkId:result.evidence.checkId,evidenceId:result.evidence.id,inputHash:result.evidence.inputHash}));
    if (!checks.some(check=>!['web','tui','desktop'].includes(check.kind))) gate(task,'G2','neutral','Nenhuma verificação mecânica adicional é pertinente.');
    return results;
  };
  const requireInterface = (task: WorkUnit,results: VerificationOutcome[]): Verification['kind'] | undefined => {
    const checks=state.tasks[task.id]?.checks??task.checks;
    return requiredTaskInterfaces(options.brief,plan,task).find(mode=>!results.some(result=>result.evidence.passed&&result.evidence.kind===mode&&result.evidence.level==='behavior'&&checks.some(check=>check.id===result.evidence.checkId&&usableProof(check,result.evidence))));
  };
  const recoverAcceptance=async(failure:VerificationOutcome,check:Verification,work:WorkUnit,workspace:string,operational:OperationalEnvironment):Promise<boolean>=>{
    note(incident(failure.classification??'instrument',check.id,'Mandatory acceptance did not pass.',failure.evidence.output));
    const fingerprint=digest(JSON.stringify({protocol:executionProtocol,configuration:options.configurationRevision??'',check,input:failure.evidence.inputHash,classification:failure.classification}));state.acceptanceRecovery??={};
    const preceding=state.acceptanceRecovery[fingerprint];
    if(preceding&&!preceding.startsWith('running:')&&!preceding.startsWith('interrupted:'))return false;
    const classification=failure.classification??'instrument';
    state.acceptanceRecovery[fingerprint]=`running:${classification}`;await save();
    let finished=false;
    const recoveryId=`$acceptance:${check.id}`;
    const precedingActions=state.tasks[recoveryId]?.actions?.length??0;
    const interrupted=():boolean=>Boolean(options.signal?.aborted||cancelled||(state.tasks[recoveryId]?.actions?.length??0)>precedingActions&&state.tasks[recoveryId]?.actions?.at(-1)?.result?.status==='cancelled');
    try{
    if(interrupted()){cancelled=true;return true;}
    const consumers=plan.tasks.filter(task=>task.requirementIds.some(id=>check.requirementIds.includes(id)));
    const paths=[...(check.inputs??[]),...(check.conformance?.productInputs??[])];
    const scoped=paths.length?consumers.filter(task=>task.files.some(file=>paths.some(path=>pathScopesConflict(file,path)))):consumers;
    const leaves=scoped.filter(task=>!scoped.some(other=>other.dependsOn.includes(task.id)));
    const owner=leaves.length===1?leaves[0]:scoped.length===1?scoped[0]:undefined;
    if(failure.classification==='instrument'){
      const recovery:WorkUnit={...work,id:`$acceptance:${check.id}`,title:`Recover ${check.id}`,requirementIds:check.requirementIds,files:paths,inputs:paths,checks:[check],criteria:[check.expected??'Restore an executable proof of this mandatory outcome.']};
      const progress=state.tasks[recovery.id]??=initialTask();progress.checks=[check];
      const asserted=await recoverAssertions(recovery,workspace,operational,[failure]);
      if(interrupted()){cancelled=true;return true;}
      if(asserted||await repairRecipe(recovery,workspace,operational,failure.evidence.output)){
        if(interrupted()){cancelled=true;return true;}
        state.acceptanceChecks=reconcileChecks((state.acceptanceChecks??[]).flatMap(item=>item.id===check.id?progress.checks??[item]:[item]));
        metrics.repetitions.push({taskId:recovery.id,action:'acceptance-instrument',reason:'An actual failed final recipe was replaced; the original verdict and code were preserved.',at:now()});await save();finished=true;return true;
      }
    }
    if(interrupted()){cancelled=true;return true;}
    if(failure.classification==='product'&&owner){
      const progress=state.tasks[owner.id]!;progress.checks=reconcileChecks([...(progress.checks??owner.checks),{...check,requirementIds:check.requirementIds.filter(id=>owner.requirementIds.includes(id))}]);
      progress.findings=[`Mandatory acceptance ${check.id} failed against the integrated product.\n${failure.evidence.output}`];progress.status='checking';progress.strategy='acceptance-repair';delete progress.checkpoint;delete progress.verificationCheckpoint;delete progress.suspension;attempted.delete(owner.id);
      metrics.repetitions.push({taskId:owner.id,action:'acceptance-repair',reason:`New negative final proof ${check.id} is owned by this delivery; independent accepted units are preserved.`,at:now()});await save();finished=true;return true;
    }
    if(options.repairPlan){const anchor=owner??consumers[0]??plan.tasks[0];if(anchor){const problem=incident('planning',check.id,'Mandatory acceptance needs a reconciled owner, provider or verification contract.',failure.evidence.output);problem.repairScope=failure.classification==='environment'?'environment':'verification';scheduleReplan(anchor,problem);finished=true;return true;}}
    note(incident('planning',check.id,'No executable acceptance-recovery path is available for this classified failure.',failure.evidence.output));finished=true;return false;
    }finally{
      const latest=state.tasks[recoveryId]?.actions?.at(-1);
      const incomplete=interrupted()||!finished||latest?.outcome==='running'||Boolean(latest?.result&&external(latest.result));
      state.acceptanceRecovery[fingerprint]=`${incomplete?'interrupted':'complete'}:${classification}`;
      await save();
    }
  };
  const runTask = async (task: WorkUnit): Promise<void> => {
    const progress = state.tasks[task.id] ??= initialTask(); progress.actions ??= []; progress.reviews ??= [];
    progress.checks??=structuredClone(task.checks);
    try {
      if(options.retrySuspended&&progress.suspension&&['environment','transport'].includes(progress.suspension.action)){
        progress.retryGeneration=(progress.retryGeneration??0)+1;delete progress.suspension;
        metrics.repetitions.push({taskId:task.id,action:'resource-probe',reason:'Explicit request to probe a suspended external resource once.',at:now()});await save();
      }
      if (!await preparations(task)) {
        const failed=closure(plan,task).filter(node=>!state.environment[node.id]?.ready);
        const roots=[...failed.flatMap(node=>state.incidents.filter(item=>item.subject===node.id)),...state.incidents.filter(item=>item.subject===task.id&&item.kind==='environment')].slice(-Math.max(2,failed.length*2));
        await suspend(task,'environment','Provider recovery has not established usable readiness for this work unit.',roots.map(item=>`${item.subject}: ${item.message}\n${item.evidence}`).join('\n')||'The project dependency preparation still fails.',roots.some(item=>item.external)); return;
      }
      if (progress.suspension && progress.suspension.fingerprint === await suspensionFingerprint(task,progress)) { attempted.add(task.id); event('waiting',progress.suspension.reason,task.id); return; }
      delete progress.suspension;
      const taskHash = definitionHash(task);
      if (!progress.checkpoint || progress.checkpoint.taskHash !== taskHash || !await exists(progress.checkpoint.directory)) {
        const recordedWork=hasRecordedDelivery(progress);
        const phase = recordedWork ? 'checking' : 'editing';
        if(recordedWork)event('recovery','Trabalho registrado preservado: verificar os critérios da unidade antes de solicitar nova edição.',task.id);
        progress.checkpoint = await serial('isolation',async()=>{ if(integrationBlocked||persistenceFailed)throw new Error('Canonical publication is blocked; the private work remains preserved.');return createTaskWorkspace(options.workspace,task.id,taskHash,taskWriteScopes(task,state)); }); progress.checkpoint.phase = phase; await save();
      }
      const workspace = progress.checkpoint.directory;
      let operational = relocateOperationalEnvironment(canonicalOperational(task),options.workspace,workspace);
      operational=await synchronizeProviders(task,workspace,operational);
      for (;;) {
        if (options.signal?.aborted || persistenceFailed || integrationBlocked) { cancelled = options.signal?.aborted === true; return; }
        const controlState=digest(JSON.stringify({protocol:executionProtocol,phase:progress.checkpoint.phase,input:await revision(task,workspace,operational),strategy:progress.strategy,findings:progress.findings,reviewFailure:progress.reviewFailureSignature,configuration:options.configurationRevision??'',resourceGeneration:progress.retryGeneration??0}));
        progress.controlStates??=[];
        if(progress.controlStates.includes(controlState)&&progress.pendingControlState!==controlState){
          const problem=incident('integration',task.id,'No progress: the same execution state has no unused recovery transition.',JSON.stringify({phase:progress.checkpoint.phase,strategy:progress.strategy,input:controlState}));scheduleReplan(task,problem);await suspend(task,'integration',problem.message,problem.evidence);return;
        }
        if(!progress.controlStates.includes(controlState))progress.controlStates.push(controlState);
        progress.pendingControlState=controlState;await save();
        try {
        if (progress.checkpoint.phase === 'editing') {
          await transition(task,'editing',progress.findings.length ? 'Repairing an observed material defect.' : 'Implementing the planned delivery.');
          gate(task,'G0','running','Sessão do editor em execução.'); gate(task,'G1','running','Edição da unidade isolada.');
          const result = await invoke(task,workspace,hasRecordedDelivery(progress) ? 'repair' : 'editor','Implement the small work unit in this workspace. Preserve unrelated user work, mandatory providers and the requested interface. Correct only supplied concrete observations; a test quota is not an application requirement.',progress.findings.join('\n'),false,progress.strategy,operational);
          gate(task,'G0',result.status==='complete'&&!result.issue?'complete':external(result)?'waiting':'returned',result.issue?.message ?? 'A sessão terminou com resultado utilizável.');
          gate(task,'G1',result.changedFiles.length?'complete':'neutral',result.changedFiles.length?`${result.changedFiles.length} arquivo(s) alterado(s).`:'Sem alteração de arquivos; isso não reprova a unidade.');
          progress.checkpoint.phase = result.changedFiles.length || result.status === 'complete' ? 'checking' : 'editing'; await save();
          if (result.status === 'cancelled' || options.signal?.aborted) { cancelled = true; return; }
          if (external(result)) { await suspend(task,'transport','Agent transport cannot make progress with the current configuration.',result.issue?.message ?? result.text,true); return; }
          if (result.issue?.kind === 'context') {
            const problem = incident('planning',task.id,'The delivery exceeds the measured agent context; split it while preserving existing files.',result.issue.message);problem.contextChars=Math.max(256,Math.floor((progress.contextChars??options.contextChars??24000)/2));progress.contextChars=problem.contextChars;scheduleReplan(task,problem); await suspend(task,'planning',problem.message,problem.evidence); return;
          }
          if (result.issue?.kind === 'constraint') {
            progress.findings = [result.issue.message]; progress.strategy = 'constraint-repair'; progress.checkpoint.phase = 'editing';continue;
          }
        }
        const prepared = await projectDependencies(task,workspace,operational);
        if (!prepared) { await suspend(task,'environment','Dependency recovery made no usable operational progress.','The consumer still cannot use its selected provider.'); return; }
        operational = prepared;
        if (progress.checkpoint.phase === 'checking') {
          await transition(task,'checking','Checking only relevant, current proof inputs.');
          const selected = selectVerifications(options.brief,{...task,checks:progress.checks ?? task.checks});
          if (selected.some(item=>item.replaced)) {
            const detail=selected.filter(item=>item.replaced).map(item=>item.replaced).join('\n');
            const protocols=selected.filter(item=>item.protocolIssue);
            if(protocols.length){
              const originals=protocols.map(item=>item.protocolIssue!.original),ids=new Set(originals.map(check=>check.id));
              // Retire an incoherent instrument, never a product failure. The
              // original declaration stays in the durable recovery audit.
              progress.checks=reconcileChecks((progress.checks??task.checks).filter(check=>!ids.has(check.id)));
              metrics.repetitions.push({taskId:task.id,action:'verification-protocol',reason:JSON.stringify({issues:protocols.map(item=>item.protocolIssue),ownership:requiredTaskInterfaces(options.brief,plan,task)}),at:now()});
              await save();
              const owned=protocols.find(item=>item.requiredKind&&requiredTaskInterfaces(options.brief,plan,task).some(kind=>kind===item.requiredKind));
              if(!owned){
                const local=await derivedChecks(workspace,task);
                if(local.length){
                  progress.checks=reconcileChecks([...progress.checks,...local]);progress.strategy='revalidate-only';
                  event('recovery','Instrumento incompatível substituído pela verificação local pertinente; a interação completa continua obrigatória no responsável final.',task.id);await save();continue;
                }
              }
              const kind=owned?.requiredKind??protocols[0]!.requiredKind;
              if(await materializeVerification(task,workspace,operational,`${detail}\nOriginal declarations (preserved, not executed as browser proof):\n${JSON.stringify(originals)}`,kind))continue;
              const problem=incident('instrument',task.id,'The declared browser interaction needs a compatible executable runner; starting a server alone supplies no interaction proof.',detail);scheduleReplan(task,problem);await suspend(task,'instrument',problem.message,detail);return;
            }
            if (await repairRecipe(task,workspace,operational,detail)) continue;
            const problem=incident('instrument',task.id,'The verification recipe needs a compatible invocation; reconcile its proof contract without editing the product.',detail);problem.repairScope='verification';scheduleReplan(task,problem);
            await suspend(task,'instrument',problem.message,detail); return;
          }
          let checks = selected.map(item=>item.check);
          if (!checks.length) checks = await derivedChecks(workspace,task);
          progress.checks = reconcileChecks(checks); await save();
          const results = await verify(task,workspace,operational,progress.checks);
          if (options.signal?.aborted) { cancelled = true; return; }
          const failures = results.filter(result=>!result.evidence.passed);
          if (failures.length) {
            let candidateChanged=false;
            const localRecipes=failures.some(failure=>failure.classification==='instrument'&&failure.evidence.kind==='web')?await derivedChecks(workspace,task):[];
            for(const failure of failures){
              const original:Verification|undefined=progress.checks.find(check=>check.id===failure.evidence.checkId);
              const narrowed:ReturnType<typeof narrowUnobservedWebRecipe>=original?narrowUnobservedWebRecipe(original,failure,localRecipes):undefined;
              if(narrowed){
                const stamp=await interfaceSourceStamp(task,workspace,operational),key=interfaceKey(original!,workspace,operational,stamp);
                progress.interfaceRejections??=[];
                if(!progress.interfaceRejections.some(item=>item.key===key))progress.interfaceRejections.push({key,kind:'web',evidenceId:failure.evidence.id,at:now()});
                progress.checks=progress.checks.map(check=>check.id===original!.id?narrowed.check:check);candidateChanged=true;
                metrics.repetitions.push({taskId:task.id,action:'narrow-observed-interface',reason:JSON.stringify(narrowed.transformation),at:now()});
                event('recovery','O comando observado será verificado no seu alcance real; a interação de navegador continua obrigatória e sem aprovação automática.',task.id,{evidenceId:failure.evidence.id});continue;
              }
              if(failure.evidence.kind!=='command')continue;
              const check:Verification|undefined=progress.checks.find(item=>item.id===failure.evidence.checkId);
              if(!check)continue;
              const candidate:Verification|undefined=await repositoryRecipeCandidate(workspace,check);
              if(!candidate)continue;
              progress.checks=progress.checks.map(current=>current.id===check.id?candidate:current);candidateChanged=true;
              metrics.repetitions.push({taskId:task.id,action:'repository-recipe',reason:`A unique current manifest interface consumes the same declared source: ${JSON.stringify(candidate.recipeCandidate)}. The original negative proof remains; the candidate must execute successfully.`,at:now()});
            }
            if(candidateChanged){progress.strategy='revalidate-only';await save();continue;}
            if(await triageAssertionFailure(task,workspace,operational,failures))continue;
            if(cancelled)return;
            if(replans.has(task.id)){const problem=replans.get(task.id)!;await suspend(task,'planning',problem.message,problem.evidence);return;}
            const detail = failures.map(result=>`${result.classification}: ${result.evidence.checkId}\n${result.evidence.output.replaceAll(workspace,'$WORKSPACE')}`).join('\n');
            const signature = digest(detail); progress.noProgress = progress.failureSignature === signature ? (progress.noProgress ?? 0) + 1 : 1; progress.failureSignature = signature;
            metrics.repetitions.push({taskId:task.id,action:'verify',reason:`Observed ${failures.length} failed proofs; consecutive identical failure ${progress.noProgress}.`,at:now()}); await save();
            if (failures.some(result=>result.classification==='transport'||result.classification==='environment')) {
              const kind=failures.some(result=>result.classification==='environment')?'environment':'transport';
              if(kind==='environment')scheduleReplan(task,incident('environment',task.id,'The verification consumer cannot use its declared environment. Reconcile the actual invocation, dependency and readiness contract.',detail));
              await suspend(task,kind,'A verification resource must be recovered before its behavior can be proved.',detail,kind==='transport'); return;
            }
            if (failures.some(result=>result.classification==='instrument')) {
              if(await recoverAssertions(task,workspace,operational,failures))continue;
              if(cancelled)return;
              if(replans.has(task.id)){await suspend(task,'planning','The proof assertion contract needs reconciliation; product code and observed command results are preserved.',detail);return;}
              if ((progress.noProgress ?? 0) <= 2 && await repairRecipe(task,workspace,operational,detail)) continue;
              scheduleReplan(task,incident('planning',task.id,'The verification instrument still has no executable recovery; reconcile only the failed proof contract.',detail));
              await suspend(task,'instrument','Verification recovery produced no different executable instrument.',detail); return;
            }
            progress.findings = failures.map(result=>result.evidence.output);
            if ((progress.noProgress ?? 0) === 1) { progress.strategy = 'targeted-repair'; progress.checkpoint.phase = 'editing'; await save(); continue; }
            if ((progress.noProgress ?? 0) === 2) {
              const diagnosis = await invoke(task,workspace,'reviewer','Diagnose this repeated failure without changing code. Return JSON {kind:"product"|"instrument"|"environment"|"plan",cause,fix}. Explain a different, concrete smaller action; do not repeat the unchanged repair.',detail,true,'diagnose-failure',operational);
              const explanation = jsonObject(diagnosis.text); const kind = String(explanation?.kind ?? ''); const fix = [explanation?.cause,explanation?.fix].filter(item=>typeof item==='string').join('\n');
              if (kind === 'instrument' && fix && await repairRecipe(task,workspace,operational,`${detail}\n${fix}`)) continue;
              if (kind === 'plan') { scheduleReplan(task,incident('planning',task.id,'Repeated failure requires a different delivery boundary.',fix)); await suspend(task,'planning','The current delivery cannot progress without reconciliation.',fix); return; }
              if (kind === 'product' && fix) { progress.findings = [fix]; progress.strategy = `guided-repair:${digest(fix)}`; progress.checkpoint.phase = 'editing'; await save(); continue; }
            }
            const problem = incident('integration',task.id,'No progress: the same failed proof survived the targeted repair and independent diagnosis.',detail); scheduleReplan(task,problem); await suspend(task,'integration',problem.message,detail); return;
          }
          const requiredKind = requireInterface(task,results);
          if (requiredKind) {
            const detail=`The work unit requires actual ${requiredKind} interaction; syntax or compilation alone does not establish its behavior. Observed proofs:\n${results.map(result=>result.evidence.output).join('\n')}`;
            if (await materializeVerification(task,workspace,operational,detail,requiredKind)) continue;
            const problem=incident('instrument',task.id,`The requested ${requiredKind} behavior still needs an executable proof contract after local recipe recovery. Reconcile its actual interface and invocation while preserving existing product work.`,detail);problem.repairScope='verification';scheduleReplan(task,problem);
            await suspend(task,'instrument',problem.message,detail); return;
          }
          const recovered=replans.get(task.id)??state.pendingReplans?.[task.id];
          if(recovered&&['verification','environment'].includes(recovered.repairScope??'')){
            replans.delete(task.id);delete state.pendingReplans?.[task.id];
            metrics.repetitions.push({taskId:task.id,action:'resolve-operational-incident',reason:JSON.stringify({original:recovered,resolution:'Current provider preparation and selected proofs succeeded, and the unit interface obligation is satisfied. Independent product review remains required.'}),at:now()});
          }
          progress.noProgress = 0; progress.findings = []; progress.checkpoint.phase = 'reviewing'; await save();
        }
        if (progress.checkpoint.phase === 'reviewing') {
          await transition(task,'reviewing','Inspection is read-only; executable evidence was collected separately.');
          const current = await revisionState(task,workspace,operational),hash=current.hash;
          const checks=progress.checks??task.checks;
          const referencesCurrent=checks.every(check=>progress.verificationEvidence?.some(reference=>reference.checkId===check.id&&reference.inputHash===current.proofs[check.id]&&state.evidence.some(proof=>proof.id===reference.evidenceId&&proof.passed&&usableProof(check,proof))));
          const proofPacket=buildReviewEvidence(state,plan,task,checks,{maxChars:Math.max(1000,Math.floor((progress.contextChars??options.contextChars??24000)*.2))});
          const missingInterface=requiredTaskInterfaces(options.brief,plan,task).some(mode=>!proofPacket.own.some(proof=>proof.evidence.passed&&proof.evidence.kind===mode&&proof.evidence.level==='behavior'&&checks.some(check=>check.id===proof.evidence.checkId&&usableProof(check,proof.evidence))));
          if(!referencesCurrent||proofPacket.status==='needs-check'||missingInterface){
            progress.checkpoint.phase='checking';progress.strategy='recover-review-evidence';
            event('recovery','Referências de provas ausentes ou desatualizadas; reconciliando a verificação antes de solicitar um parecer.',task.id,{missing:proofPacket.missing,referencesCurrent});await save();continue;
          }
          const operationalIncident=replans.get(task.id)??state.pendingReplans?.[task.id];
          if(operationalIncident&&['verification','environment'].includes(operationalIncident.repairScope??'')){
            replans.delete(task.id);delete state.pendingReplans?.[task.id];
            metrics.repetitions.push({taskId:task.id,action:'resolve-operational-incident',reason:JSON.stringify({original:operationalIncident,resolution:'The resumed review has current successful proof receipts and no missing local interface obligation. The old operational blocker is retired; an explicit product verdict is still required.'}),at:now()});await save();
          }
          let approved:NonNullable<TaskProgress['reviews']>[number]|undefined,composed=false;
          const acknowledged=await acknowledgedHandoffs(task,workspace);
          const incoming=(state.reviewHandoffs??[]).filter(item=>item.ownerTaskId===task.id);
          if(incoming.every(item=>acknowledged.has(item.id)))for(const review of [...progress.reviews].reverse())if(review.assessment.decision==='approved'){
            const reused=review.inspection?await reuseInspection(task,review,workspace):review.inputHash===hash?'current':false;
            if(reused){approved=review;composed=reused==='composed';break;}
          }
          if(approved){
            gate(task,'G3','complete',composed?'Inspeção composta preservada: alterações posteriores têm pareceres de fontes e provas atuais.':'Inspeção independente preservada: fontes e critérios idênticos; provas atuais confirmadas.');
            if(!composed&&approved.inputHash!==hash){metrics.repetitions.push({taskId:task.id,action:'reuse-inspection',reason:`Independent approval ${approved.inputHash} remains bound to unchanged authority and source; every current verification receipt passed.`,at:now()});event('recovery','Provas revalidadas; o parecer de código válido foi preservado sem nova chamada ao auditor.',task.id);}
          }
          if (!approved) {
            let accepted = false, inspectAgain = false;
            for (let clarification = 0; clarification < 2; clarification++) {
              gate(task,'G3','running',clarification?'Esclarecendo o parecer sem nova edição.':'Revisão independente das evidências e do código.');
              const previous = progress.reviews.filter(item=>item.inputHash===hash).at(-1);
              const previousLimit=Math.max(256,Math.floor((progress.contextChars??options.contextChars??24000)*.08));
              const preceding=clarification&&previous?`\nPRECEDING REVIEW ${JSON.stringify({characters:previous.assessment.original.length,complete:previous.assessment.original.length<=previousLimit})}\n${previous.assessment.original.slice(0,previousLimit)}`:'';
              const result = await invoke(task,workspace,'reviewer',(clarification ? 'Clarify only the preceding review of these same files. Identify a material expected/observed defect linked to a supplied criterion, or explicitly approve. An instrument restriction, absent test quota or unreadable format is not grounds to edit correct code. Return one JSON {approved,findings:[{kind,file,observed,expected,evidence,fix,evidenceType,verification}]}.' : 'Inspect this work unit and its actual evidence without executing mutating verification commands. Return one JSON {approved:true,findings:[]} if its supplied criteria and mandatory stack are fulfilled, otherwise findings:[{kind,file,observed,expected,evidence,fix}]. Report only material product defects; classify instrument, environment and planning failures separately. A runtime claim must cite existing verification evidence or declare evidenceType:"inspection-command" with a concrete verification recipe for independent writable reproduction. Static source findings use evidenceType:"source" with location and expected/observed behavior.')+' A finding may declare scope:"unit"|"integration", requirementId, deferToTaskId and criterionId. Only the supplied DAG/source can assign a later owner; a local criterion stays with this unit. Explicitly state whether this unit is approved while a valid integration obligation remains pending.',`${proofPacket.text}${preceding}`,true,clarification?'clarify-review':'review',operational);
              if (result.status === 'cancelled' || options.signal?.aborted) { cancelled = true; return; }
              if (external(result)) { progress.strategy = 'resume-review'; await suspend(task,'transport','The reviewer is unavailable; no edit or confirmed proof will be replayed.',result.issue?.message ?? '',true); return; }
              let assessment = interpretReview(result.text);
              if(result.issue){assessment.decision='unresolved';assessment.approved=false;assessment.transformations.push({path:'$',operation:'unresolved',reason:`The inspection operation failed (${result.issue.kind}); its original verdict is retained but is not a valid approval.`});}
              const scoped=await resolveReviewScope(workspace,options.brief,plan,task,assessment);assessment=scoped.assessment;
              if(scoped.handoffs.length){
                state.reviewHandoffs??=[];
                for(const handoff of scoped.handoffs){const previous=state.reviewHandoffs.find(item=>item.id===handoff.id);if(previous){previous.status='pending';delete previous.proofIds;delete previous.resolvedAt;}else state.reviewHandoffs.push({...handoff,createdAt:now()});}
                event('recovery','Achado de integração preservado na fila do responsável final; o critério local permanece separado.',task.id,{handoffIds:scoped.handoffs.map(item=>item.id)});await save();
              }
              const reviewAction=progress.actions.findLast(action=>action.action==='reviewer'&&action.strategy===(clarification?'clarify-review':'review')&&action.result?.text===result.text);
              const coverage=reviewAction?.sourceCoverage??[];
              for(const finding of assessment.findings){
                if(finding.disposition!=='defect'||!finding.file||finding.evidenceType==='verification'||finding.evidenceType==='inspection-command')continue;
                const source=await substantiateSourceFinding(workspace,finding,coverage);
                if(source.verified)continue;
                assessment.decision='unresolved';assessment.approved=false;
                assessment.transformations.push({path:`findings.${finding.id}`,operation:'unresolved',reason:source.reason,original:structuredClone(finding)});
                if(finding.file)progress.contextFocus=[finding.file,...(progress.contextFocus??[]).filter(path=>path!==finding.file)];
              }
              for(const finding of assessment.findings){
                if(finding.disposition!=='defect'||finding.evidenceType!=='inspection-command')continue;
                const recipes=normalizeChecks(finding.reproduction?[finding.reproduction]:[],options.brief).map(check=>({...check,id:`inspection-${finding.id}`,requirementIds:task.requirementIds}));
                if(!recipes.length||recipes.some(check=>selectVerifications(options.brief,{...task,checks:[check]}).some(selected=>selected.replaced))){
                  assessment.decision='unresolved';assessment.approved=false;assessment.transformations.push({path:`findings.${finding.id}`,operation:'unresolved',reason:'A runtime claim needs a concrete compatible reproduction in writable isolation. The original claim is preserved and is not grounds for an edit.'});
                  if(await repairRecipe(task,workspace,operational,`${reviewFindingText(finding)}\nRecover an executable focused reproduction for this existing source. Preserve already confirmed checks.`,undefined,true))progress.checkpoint.phase='checking';
                  else scheduleReplan(task,incident('instrument',task.id,'The runtime finding has no executable reproduction yet; reconcile its focused proof contract without changing the delivery.',reviewFindingText(finding)));
                  continue;
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
              const inspection=assessment.decision==='approved'?await createInspectionIdentity(workspace,options.brief,plan,task,coverage,deliveryWriteSet(task.id,progress,state.integrations)):undefined;
              progress.reviews.push({inputHash:hash,at:now(),assessment,...(inspection?{inspection}:{}),...(reviewAction?.handoffIds?.length?{handoffIds:[...reviewAction.handoffIds]}:{})}); event('review',`Review decision: ${assessment.decision}`,task.id,assessment); await save();
              if(progress.checkpoint.phase==='checking')break;
              if(replans.has(task.id)){const problem=replans.get(task.id)!;await suspend(task,'planning',problem.message,problem.evidence);return;}
              const observedProofs=state.evidence.filter(item=>item.taskId===task.id);
              const vague = assessment.actionableFindings.some(finding=>!finding.expected&&!finding.file&&!observedProofs.some(proof=>finding.evidence&&(finding.evidence.includes(proof.checkId)||finding.evidence.length>=8&&proof.output.includes(finding.evidence))));
              if (result.issue || assessment.decision === 'unresolved' || vague) continue;
              if (assessment.decision === 'approved') { accepted = true; gate(task,'G3','complete','O revisor confirmou a unidade e suas provas.'); break; }
              const nonProduct = assessment.actionableFindings.find(finding=>finding.kind!=='product');
              if (nonProduct) {
                if (nonProduct.kind === 'instrument' && await repairRecipe(task,workspace,operational,reviewFindingText(nonProduct))) { progress.checkpoint.phase='checking'; break; }
                const problem=incident(nonProduct.kind,task.id,`Review identified a ${nonProduct.kind} cause requiring its own recovery before further product edits.`,nonProduct.text);problem.repairScope=nonProduct.kind==='environment'?'environment':'verification';scheduleReplan(task,problem);
                await suspend(task,nonProduct.kind,problem.message,problem.evidence); return;
              }
              gate(task,'G3','returned','Pendência material preservada e encaminhada para correção.');
              const failure=digest(JSON.stringify(assessment.actionableFindings.map(finding=>({kind:finding.kind,observed:finding.observed,expected:finding.expected,file:finding.file,evidence:finding.evidence}))));
              progress.reviewNoProgress=progress.reviewFailureSignature===failure?(progress.reviewNoProgress??0)+1:1;progress.reviewFailureSignature=failure;
              if(progress.reviewNoProgress>=3){const problem=incident('planning',task.id,'The same material review defect survived repair and diagnosis; reconcile its delivery boundary while preserving the original obligation.',assessment.original);problem.repairScope='delivery';scheduleReplan(task,problem);await suspend(task,'planning',problem.message,problem.evidence);return;}
              if(progress.reviewNoProgress===2){
                const diagnosis=await invoke(task,workspace,'reviewer','Diagnose this repeated failure without changing code. Return JSON {kind:"product"|"instrument"|"environment"|"plan",cause,fix}. Explain why the previous repair did not resolve this exact material review finding and supply a different concrete action.',assessment.actionableFindings.map(reviewFindingText).join('\n'),true,'diagnose-review-failure',operational);
                const explanation=jsonObject(diagnosis.text);const fix=[explanation?.cause,explanation?.fix].filter(item=>typeof item==='string').join('\n');
                if(explanation?.kind==='instrument'&&fix){
                  progress.contextFocus=[...new Set(assessment.actionableFindings.flatMap(finding=>finding.file?[finding.file]:[]))];
                  if(await repairRecipe(task,workspace,operational,`${diagnosis.text}\n${assessment.original}`)){progress.checkpoint.phase='checking';break;}
                  progress.strategy=`focused-inspection:${digest(fix)}`;progress.checkpoint.phase='reviewing';inspectAgain=true;await save();break;
                }
                if(explanation?.kind!=='product'||!fix){
                  const problem=incident('planning',task.id,'Independent diagnosis requires a different context, instrument or ownership before any further product edit.',diagnosis.text);scheduleReplan(task,problem);await suspend(task,'planning',problem.message,problem.evidence);return;
                }
                progress.findings=[fix];progress.strategy=`review-guided-repair:${digest(fix)}`;progress.checkpoint.phase='editing';break;
              }
              progress.findings = assessment.actionableFindings.map(reviewFindingText); progress.strategy = 'partner-guidance'; progress.checkpoint.phase = 'editing'; break;
            }
            if (inspectAgain || progress.checkpoint.phase !== 'reviewing') { await save(); continue; }
            if (!accepted) { progress.strategy='clarify-review';const problem=incident('instrument',task.id,'Review remained unresolved after clarification; reconcile its evidence contract without silently approving or editing the product.',progress.reviews.at(-1)?.assessment.original ?? '');problem.repairScope='verification';scheduleReplan(task,problem);await suspend(task,'instrument',problem.message,problem.evidence);return; }
          }
          progress.checkpoint.phase='integrating'; await save();
        }
        if (progress.checkpoint.phase === 'integrating') {
          await transition(task,'integrating','Publishing an approved write set through the FIFO coordinator.');
          await serial('integration',async()=>{
            if(integrationBlocked||persistenceFailed)throw new Error('A preceding publication is unresolved; no later write set can be applied.');
            const transaction = await prepareIntegration(options.workspace,task.id,progress.checkpoint!,taskWriteScopes(task,state));
            state.integrations!.push(transaction); await save(); if(persistenceFailed)return;
            transaction.phase='applying'; await save();
            try{await publishIntegration(options.workspace,transaction);transaction.phase='applied';}
            catch(error){integrationBlocked=true;throw error;}
            progress.revision = await revision(task,options.workspace,canonicalOperational(task)); progress.definitionHash=definitionHash(task); progress.findings=[]; progress.strategy='verified'; delete progress.suspension;
            state.incidents = state.incidents.filter(item=>item.subject!==task.id);
            await transition(task,'complete','Approved isolated changes integrated without overwriting concurrent work.');
            const recovered=replans.get(task.id);
            if(recovered){
              replans.delete(task.id);delete state.pendingReplans?.[task.id];
              metrics.repetitions.push({taskId:task.id,action:'resolve-replan',reason:`The queued incident ${recovered.id} is superseded by current successful verification, explicit approval and integration of this same delivery.`,at:now()});
            }
            if(!persistenceFailed){const directory=progress.checkpoint!.directory;delete progress.checkpoint;delete progress.verificationCheckpoint;delete progress.dependencyCache;await save();if(!persistenceFailed)await measured('cleanup',()=>rm(dirname(directory),{recursive:true,force:true})).catch(error=>event('recovery',`A área já integrada será limpa depois: ${String(error)}`,task.id));}
          });
          emitProgress(options.onEvent,{id:`task:${task.id}:stages`,label:`${task.id}: edição, verificações e revisão`,completed:3,total:3,status:'complete',stage:'build',unit:'etapas'}); return;
        }
        } finally { if(!options.signal?.aborted&&!cancelled)delete progress.pendingControlState; }
      }
    } catch (error) {
      if (options.signal?.aborted) { cancelled = true; return; }
      if(error instanceof VerificationMutationError){
        const report=JSON.stringify(error.report);
        const problem=incident('instrument',task.id,error.message,report);problem.repairScope='verification';note(problem);
        if(progress.checkpoint&&await repairRecipe(task,progress.checkpoint.directory,relocateOperationalEnvironment(canonicalOperational(task),options.workspace,progress.checkpoint.directory),report)){
          delete progress.verificationCheckpoint;progress.checkpoint.phase='checking';progress.status='checking';attempted.delete(task.id);await save();return;
        }
        scheduleReplan(task,problem);await suspend(task,'instrument',problem.message,problem.evidence);return;
      }
      if(error instanceof IntegrationConflict&&!integrationBlocked){progress.integrationConflict={path:error.path,before:error.before,current:error.current,proposed:error.proposed};integrationConflicts.add(task.id);progress.strategy='integration-conflict';}
      if(error instanceof ContextTooLarge||error instanceof WorkPlanningError){
        const problem=incident('planning',task.id,error.message,progress.checkpoint?.directory??'');
        // A locally measured overflow changes the work partition, not the
        // provider's known capacity. Halving it creates additional false debt.
        if(error instanceof ContextTooLarge){problem.contextChars=error.limit;problem.repairScope='delivery';}
        scheduleReplan(task,problem);await suspend(task,'planning',problem.message,problem.evidence);return;
      }
      if(error instanceof OperationalInvocationConflict||error instanceof ProviderSynchronizationError){const problem=incident('environment',task.id,error instanceof OperationalInvocationConflict?'Provider aliases resolve to contradictory invocations for this consumer.':'A published provider could not be materialized for the existing consumer.',error.message);scheduleReplan(task,problem);await suspend(task,'environment',problem.message,problem.evidence);return;}
      await suspend(task,error instanceof IntegrationConflict?'integration':'instrument',error instanceof Error?error.message:String(error),progress.checkpoint?.directory ?? '');
    }
  };
  const finish = async (status: BuildOutcome['status']): Promise<BuildOutcome> => {
    state.blockers = status === 'waiting' ? plan.tasks.flatMap(task => {
      const pending = state.tasks[task.id]?.suspension;
      if (!pending || state.tasks[task.id]?.status === 'complete') return [];
      return [incident(pending.action as BuildIncident['kind'], task.id, pending.reason,
        state.incidents.findLast(item=>item.subject===task.id&&item.message===pending.reason)?.evidence ?? '')];
    }) : [];
    if (status === 'waiting' && !state.blockers.length) state.blockers = state.incidents.slice(-1);
    if (status === 'waiting' && !state.blockers.length) state.blockers = [incident('planning','scheduler','No task is executable and mandatory work remains.',JSON.stringify(plan.tasks.filter(task=>state.tasks[task.id]?.status!=='complete').map(task=>({id:task.id,dependsOn:task.dependsOn,blockedBy:task.blockedBy}))))];
    if (status === 'waiting') event('waiting',state.blockers.map(item=>`${item.subject}: ${item.message}`).join('\n'),undefined,state.blockers);
    await save(); return {status,state,plan,completed:plan.tasks.filter(task=>state.tasks[task.id]?.status==='complete').map(task=>task.id),pending:plan.tasks.filter(task=>state.tasks[task.id]?.status!=='complete').map(task=>task.id),incidents:state.incidents};
  };
  await mkdir(options.workspace,{recursive:true});
  for (const task of plan.tasks){state.tasks[task.id]??=initialTask();if(state.tasks[task.id]!.integrationConflict)integrationConflicts.add(task.id);}
  // Incompatible recipes already have an executable recovery transition in the
  // worker. A preflight finding must not prevent that very recovery from running.
  for(;;){
    if(options.signal?.aborted||cancelled)return finish('cancelled');
    const issues = validatePlan(options.brief,plan).filter(issue=>issue.code!=='forbidden-proof-capability');
    if(!issues.length)break;
    issues.forEach(issue=>note(incident('planning',issue.subject,issue.message,issue.code)));
    const key=digest(JSON.stringify({protocol:executionProtocol,phase:'preflight',issues,configuration:options.configurationRevision??''}));state.acceptanceRecovery??={};
    const preceding=state.acceptanceRecovery[key];
    if(!options.repairPlan||preceding&&!preceding.startsWith('running:')&&!preceding.startsWith('interrupted:'))return finish('waiting');
    const issue=issues[0]!,owner=plan.tasks.find(task=>task.id===issue.subject||task.requirementIds.includes(issue.subject))??plan.tasks[0];
    if(!owner)return finish('waiting');
    const progress=state.tasks[owner.id]??=initialTask();progress.actions??=[];
    const previous=progress.actions.findLast(action=>action.id===key&&action.strategy==='preflight');
    const action:ActionRecord=previous??{id:key,action:'replan',input:key,strategy:'preflight',reason:issue.message,at:now(),durationMs:0,outcome:'running'};
    if(!previous)progress.actions.push(action);else action.outcome='running';
    state.acceptanceRecovery[key]='running:preflight';await save();
    const started=Date.now();let advanced=false;
    try{
      if(options.signal?.aborted){cancelled=true;action.outcome='cancelled';}
      else{
        const problem=incident('planning',issue.subject,issue.message,issue.code);
        problem.repairScope=/unproven|proof|interface/.test(issue.code)?'verification':/environment|provider/.test(issue.code)?'environment':'delivery';
        let proposed=action.planProposal;
        if(!proposed){
          proposed=await options.repairPlan(problem,{...owner,checks:structuredClone(progress.checks??owner.checks)})??undefined;
          if(proposed){action.planProposal=structuredClone(proposed);await save();}
        }
        if(options.signal?.aborted||persistenceFailed){if(options.signal?.aborted){cancelled=true;action.outcome='cancelled';}}
        else if(proposed){
          const reconciled=reconcilePlan(options.brief,proposed,plan);
          const remaining=validatePlan(options.brief,reconciled).filter(issue=>issue.code!=='forbidden-proof-capability');
          const unchanged=issues.every(issue=>remaining.some(current=>JSON.stringify(current)===JSON.stringify(issue)));
          if(unchanged){action.outcome='unchanged';note(incident('planning',owner.id,'Preflight reconciliation did not resolve any recorded invariant; no product work was discarded or approved.',JSON.stringify({before:issues,after:remaining})));}
          else{
            reconciled.status=remaining.length?'planning':'ready';plan=reconciled;
            for(const task of plan.tasks)state.tasks[task.id]??=initialTask();
            action.outcome='complete';advanced=true;
          }
        }else action.outcome=options.signal?.aborted?'cancelled':'unchanged';
      }
    }catch(error){
      action.outcome=options.signal?.aborted?'cancelled':'failed';
      action.failure=error instanceof Error?error.message:String(error);
      if(options.signal?.aborted)cancelled=true;
      else note(incident('planning',owner.id,'Preflight plan reconciliation failed before producing an executable contract; the original plan and work remain preserved.',`${issue.code}: ${issue.message}\n${action.failure}`));
    }finally{
      action.durationMs=Date.now()-started;
      state.acceptanceRecovery[key]=`${action.outcome==='cancelled'||action.outcome==='running'?'interrupted':'complete'}:preflight`;
      await save();
    }
    if(options.signal?.aborted||cancelled)return finish('cancelled');
    if(!advanced)return finish('waiting');
  }
  for (const transaction of state.integrations) if (transaction.phase!=='applied') {
    try { await serial('integrationRecovery',()=>transaction.installations?resumeEnvironmentRecovery(options.workspace,transaction):publishIntegration(options.workspace,transaction)); transaction.phase='applied'; const task=plan.tasks.find(item=>item.id===transaction.taskId); if(task){const progress=state.tasks[task.id]!;progress.status='complete';progress.strategy='verified';progress.definitionHash=definitionHash(task);progress.revision=await revision(task,options.workspace,canonicalOperational(task));delete progress.checkpoint;delete progress.verificationCheckpoint;} await save(); }
    catch(error){note(incident('integration',transaction.taskId,'Interrupted integration conflicts with newer canonical work.',String(error)));return finish('waiting');}
  }
  execution: for (;;) {
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
        const fresh=await serial('integrationReconciliation',()=>createTaskWorkspace(options.workspace,task.id,definitionHash(task),taskWriteScopes(task,state)));
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
        progress.contextFocus=[failed.path];
        progress.findings=[`Resolve an actual integration conflict while preserving the already integrated peer delivery. Canonical input changed, so this is a different operation.\nPATH ${failed.path}\nCURRENT EXCERPT (full file supplied/indexed in context)\n${canonical.slice(0,2400)}\nPROPOSED EXCERPT (full proposal at ${relative(fresh.directory,archive)})\n${proposed.slice(0,2400)}\nOther proposed files are readable under ${relative(fresh.directory,archive)}. Uncontested edits were mechanically preserved.`];
        progress.strategy=`integration-reconcile:${key}`;progress.status='pending';attempted.delete(id);resumed=true;
        metrics.repetitions.push({taskId:id,action:'integration-reconcile',reason:`Fresh canonical baseline for conflicting path ${failed.path}; preserved proposal ${proposal.directory}.`,at:now()});await save();
      }
      integrationConflicts.clear();if(resumed)continue;
    }
    if(replans.size&&options.repairPlan){
      let changed=false;
      for(const [id,problem] of [...replans]){
        if(replans.get(id)!==problem)continue;
        const task=plan.tasks.find(item=>item.id===id);
        if(!task){recordRetiredReplans(retireObsoleteReplans(state,plan));continue;}
        const progress=state.tasks[id]!;const key=digest(JSON.stringify({problem,input:await suspensionFingerprint(task,progress)}));
        if(options.signal?.aborted||cancelled)break;
        if(replans.get(id)===problem)replans.delete(id);
        const consume=():void=>{if(JSON.stringify(state.pendingReplans?.[id])===JSON.stringify(problem))delete state.pendingReplans?.[id];};
        const existing=progress.actions!.findLast(action=>action.id===key);
        if(existing&&!['running','cancelled'].includes(existing.outcome)){consume();continue;}
        const action:ActionRecord=existing??{id:key,action:'replan',input:key,strategy:'reconcile',reason:problem.message,at:now(),durationMs:0,outcome:'running'};if(!existing)progress.actions!.push(action);else action.outcome='running';await save();const start=Date.now();
        for(const definition of plan.tasks){state.taskDefinitionHistory??={};state.taskDefinitionHistory[definitionHash(definition)]=structuredClone(definition);}await save();
        let proposal:DevelopmentPlan|null|undefined;
        try{if(options.signal?.aborted){cancelled=true;action.outcome='cancelled';}else{proposal=action.planProposal??await options.repairPlan(problem,{...task,checks:structuredClone(progress.checks??task.checks)});if(proposal)action.planProposal=structuredClone(proposal);action.outcome=options.signal?.aborted?'cancelled':proposal?'running':'unchanged';if(options.signal?.aborted)cancelled=true;}}
        catch(error){
          action.outcome=options.signal?.aborted?'cancelled':'failed';action.failure=error instanceof Error?error.message:String(error);
          if(options.signal?.aborted)cancelled=true;
          else{
            note(incident('planning',task.id,'Plan reconciliation failed; its completed work and original cause remain preserved.',action.failure));
            if(problem.repairScope==='verification'){
              const workspace=progress.checkpoint&&await exists(progress.checkpoint.directory)?progress.checkpoint.directory:options.workspace;
              const operational=relocateOperationalEnvironment(canonicalOperational(task),options.workspace,workspace);
              if(await repairRecipe(task,workspace,operational,`The scoped planner could not reconcile this instrument. Inspect the actual private files and observed results instead of repeating that plan proposal.\nORIGINAL CAUSE\n${problem.message}\n${problem.evidence}\nPLANNER FAILURE\n${action.failure}`)){
                if(progress.checkpoint)progress.checkpoint.phase='checking';progress.status='checking';delete progress.suspension;attempted.delete(task.id);changed=true;
              }
            }
          }
        }finally{action.durationMs=Date.now()-start;await save();}
        if(cancelled||options.signal?.aborted)break;
        if(proposal){
          const reconciled=reconcilePlan(options.brief,proposal,plan);
          const effectiveProofChanged=problem.repairScope==='verification'&&JSON.stringify(progress.checks??task.checks)!==JSON.stringify(reconciled.tasks.find(unit=>unit.id===task.id)?.checks??[]);
          if(!validatePlan(options.brief,reconciled).length&&(recoveryPlanIdentity(reconciled,problem.repairScope)!==recoveryPlanIdentity(plan,problem.repairScope)||effectiveProofChanged)){
            const preceding=plan;plan=reconciled;
            recordRetiredReplans(retireObsoleteReplans(state,plan));
            for(const definition of plan.tasks){state.taskDefinitions??={};state.taskDefinitionHistory??={};state.taskDefinitions[definition.id]=structuredClone(definition);state.taskDefinitionHistory[definitionHash(definition)]=structuredClone(definition);}
            for(const unit of plan.tasks){
              const progress=state.tasks[unit.id]??=initialTask();const old=preceding.tasks.find(item=>item.id===unit.id);
              if(old&&(definitionHash(old)!==definitionHash(unit)||unit.id===id&&effectiveProofChanged)){
                if(JSON.stringify(old.checks)!==JSON.stringify(unit.checks)||unit.id===id&&effectiveProofChanged)delete progress.checks;
                delete progress.suspension;delete progress.verificationCheckpoint;
                const recordedWork=hasRecordedDelivery(progress);
                if(progress.checkpoint){progress.checkpoint.taskHash=definitionHash(unit);progress.checkpoint.phase=recordedWork?'checking':'editing';}
                progress.status=recordedWork?'checking':'pending';progress.strategy=recordedWork?'reconcile-existing-work':'implement';
              }
            }
            attempted.clear();changed=true;
          }else if(!validatePlan(options.brief,reconciled).length){action.outcome='unchanged';note(incident('planning',task.id,'The scoped reconciliation changed no executable operation. Its explanation is preserved without replaying the same failed preparation.',problem.evidence));}
        }
        if(action.outcome==='running')action.outcome='complete';consume();await save();
      }if(cancelled||options.signal?.aborted)return finish('cancelled');if(changed||replans.size)continue;
    }
    // Finalization cannot prepare unrelated providers or invalidate completed
    // deliveries while a drained worker still has an unresolved obligation.
    if(plan.tasks.some(task=>state.tasks[task.id]?.status!=='complete'))return finish('waiting');
    // Revalidate concrete provider identity before trusting cached proofs or final acceptance.
    for(const node of plan.environment){
      const previous=state.environment[node.id];if(!previous)continue;
      const base=mergeOperationalEnvironments(options.workspace,...node.dependsOn.map(id=>operationalValue(state.environment[id]?.operational)));
      const result=await measured('environmentRevalidation',()=>prepareEnvironmentNode(options.workspace,node,options.brief,command,{...consumerHints(node),operational:base,installationOperational:installationEnvironment(options.workspace),previous:{ready:previous.ready,fingerprint:previous.fingerprint??'',...(previous.installationRevision?{installationRevision:previous.installationRevision}:{}),operational:operationalValue(previous.operational)??base,...(previous.failedFingerprint?{noProgress:true}:{})},revalidate:true,terminal,allowSystemInstall:options.allowSystemInstall===true,...(options.signal?{signal:options.signal}:{}),onEvent:detail=>emitEvent(options.onEvent,detail)}));
      state.environment[node.id]={...previous,ready:result.ready,inputHash:digest(JSON.stringify(node)),fingerprint:result.fingerprint,...(result.cache.installationRevision?{installationRevision:result.cache.installationRevision}:{}),operational:result.operational,...(!result.ready?{failedFingerprint:result.fingerprint}:{})};
      if(!result.ready){
        for(const problem of result.incidents)note(problem);
        // Final readiness uses the same recovery path as initial readiness. A
        // damaged provider is a repairable incident, not a new terminal gate.
        const owner=plan.tasks.find(task=>closure(plan,task).some(required=>required.id===node.id));
        if(owner){
          nodeFlights.clear();
          if(await preparations(owner)){event('recovery','Pré-requisito restaurado durante a revalidação final; retomando provas afetadas.',node.id);continue;}
          if(cancelled||options.signal?.aborted)return finish('cancelled');
          if(replans.size&&options.repairPlan)continue execution;
        }
        return finish('waiting');
      }
    }
    // Browser assets have their own durable identity and lifecycle. Revalidate
    // them even when product proofs are cached, without relocating their store.
    let resourcesRecovered=false,resourceReplan=false;
    for(const task of plan.tasks){for(const check of state.tasks[task.id]?.checks??task.checks){
      const key=state.resourceBindings?.[task.id]?.[check.id];if(!key)continue;
      const before=state.environment[key];const previousReady=before?.ready,previousFingerprint=before?.fingerprint;
      const proposal=state.tasks[task.id]?.checkpoint?.directory;
      const workspace=proposal&&await exists(proposal)?proposal:options.workspace;
      const base=relocateOperationalEnvironment(canonicalOperational(task),options.workspace,workspace);
      const resource=await prepareResources(task,check,workspace,base);
      const currentKey=state.resourceBindings?.[task.id]?.[check.id],current=currentKey?state.environment[currentKey]:undefined;
      if(resource.ready&&(previousReady!==true||previousFingerprint!==current?.fingerprint)&&state.tasks[task.id]?.status==='waiting'){
        const progress=state.tasks[task.id]!;delete progress.suspension;if(progress.checkpoint)progress.checkpoint.phase='checking';progress.status='checking';attempted.delete(task.id);resourcesRecovered=true;
        metrics.repetitions.push({taskId:task.id,action:'resource-recovery',reason:'A newly usable concrete browser resource changed the verification environment; retry its existing proof without replaying implementation.',at:now()});await save();
      }else if(!resource.ready&&previousReady===true){
        const problem=incident('environment',task.id,'A previously usable browser resource no longer launches; recover its concrete provider.',resource.details);scheduleReplan(task,problem);await suspend(task,'environment',problem.message,problem.evidence);resourceReplan=true;
      }
    }}
    if(resourcesRecovered||resourceReplan&&options.repairPlan)continue execution;
    // Only after ready work has drained do changes in shared inputs invalidate affected proof consumers.
    let invalidated=false;
    for(const task of plan.tasks){const progress=state.tasks[task.id]!;if(progress.status!=='complete')continue;
      const operational=canonicalOperational(task);const current=await measured('proofRevalidation',()=>revision(task,options.workspace,operational));
      const checks=progress.checks??task.checks;const stale:Verification[]=[];
      for(const check of checks){const hash=await proofHash(task,check,options.workspace,operational);const latest=state.evidence.findLast(item=>item.taskId===task.id&&item.checkId===check.id&&item.inputHash===hash);if(!latest?.passed||!usableProof(check,latest))stale.push(check);}
      if(!stale.length){
        delete progress.revalidationFingerprint;
        let currentInspection=false;
        for(const review of [...progress.reviews??[]].reverse())if(review.assessment.decision==='approved'&&(review.inspection?await reuseInspection(task,review,options.workspace):review.inputHash===current)){currentInspection=true;break;}
        if(progress.definitionHash!==definitionHash(task)||!currentInspection){
          const area=await serial('isolation',()=>createTaskWorkspace(options.workspace,task.id,definitionHash(task),taskWriteScopes(task,state)));area.phase='reviewing';progress.checkpoint=area;progress.status='reviewing';progress.strategy='review-changed-criteria';attempted.delete(task.id);invalidated=true;await save();
        }else progress.revision=current;
        continue;
      }
      const repeated=digest(JSON.stringify({current,checks:await Promise.all(stale.map(async check=>({id:check.id,input:await proofHash(task,check,options.workspace,operational)})))}));
      if(progress.revalidationFingerprint===repeated){await suspend(task,'instrument','No progress: proof identity did not stabilize after revalidation of unchanged declared inputs.',JSON.stringify(stale.map(check=>check.id)));return finish('waiting');}
      progress.revalidationFingerprint=repeated;
      metrics.invalidations.push(...stale.map(check=>({taskId:task.id,checkId:check.id,reason:'A declared relevant input changed after publication.',at:now()})));
      event('invalidation','Relevant proof inputs changed; rechecking without replaying implementation.',task.id,stale.map(check=>check.id));
      delete progress.checkpoint;progress.status='checking';progress.strategy='revalidate-only';attempted.delete(task.id);invalidated=true;await save();
    }
    if(invalidated)continue;
    if(state.integrations.some(transaction=>transaction.phase!=='applied'))return finish('waiting');
    // Final recipes and requirement/interface coverage are independent of the model's approval.
    const acceptanceTask:WorkUnit={id:'$acceptance',title:'Final acceptance',goal:'Prove mandatory outcomes in the requested interface.',instructions:'Verify integrated deliveries without changing them.',requirementIds:options.brief.requirements.map(item=>item.id),dependsOn:[],environmentIds:plan.environment.map(item=>item.id),contractIds:plan.contracts.map(item=>item.id),files:[],inputs:[...new Set(plan.tasks.flatMap(task=>task.files))],criteria:['Every mandatory requirement has current appropriate evidence.'],checks:plan.acceptance??[],risk:'normal',blockedBy:[]};
    const operational=canonicalOperational(acceptanceTask);
    const production=(plan.acceptance??[]).some(check=>verificationLevel(check)==='build')?[]:(await derivedChecks(options.workspace,acceptanceTask)).filter(check=>verificationLevel(check)==='build');
    const proposedFinal=reconcileChecks([...(plan.acceptance??[]),...production]);const acceptanceHash=digest(JSON.stringify(proposedFinal));
    if(state.acceptancePlanHash!==acceptanceHash){state.acceptancePlanHash=acceptanceHash;state.acceptanceChecks=proposedFinal;delete state.nativeConformanceCheckIds;}
    let effectsChanged=false;
    for(const producer of state.acceptanceChecks??[]){
      if(!state.nativeConformanceCheckIds?.includes(producer.id)||verificationLevel(producer)!=='build')continue;
      const observation=state.evidence.findLast(proof=>proof.taskId==='$acceptance'&&proof.checkId===producer.id&&proof.passed&&proof.level==='build');
      if(!observation)continue;
      const effects=await deriveObservedProducerOutputs({workspace:options.workspace,check:producer,evidence:observation,sourceFiles:[...new Set(plan.tasks.flatMap(unit=>deliveryWriteSet(unit.id,state.tasks[unit.id],state.integrations)??unit.files))]});
      if(!effects.transformation)continue;
      state.acceptanceChecks=(state.acceptanceChecks??[]).map(check=>check.id===producer.id?effects.check:state.nativeConformanceCheckIds!.includes(check.id)&&verificationLevel(check)==='behavior'?{...check,dependsOn:[...new Set([...(check.dependsOn??[]).filter(id=>state.acceptanceChecks!.some(candidate=>candidate.id===id)),producer.id])]}:check);
      metrics.repetitions.push({taskId:'$acceptance',action:'declare-observed-producer-effects',reason:JSON.stringify(effects.transformation),at:now()});
      event('recovery','Saídas observadas vinculadas ao produtor e aos consumidores; fontes preservadas, provas serão revalidadas.',undefined,{producerId:producer.id,outputs:effects.outputs.map(output=>output.path)});effectsChanged=true;
    }
    if(effectsChanged){await save();continue execution;}
    const nativeProducer=state.acceptanceChecks?.find(check=>state.nativeConformanceCheckIds?.includes(check.id)&&verificationLevel(check)==='build');
    if(nativeProducer&&production.length){
      const redundant=new Set(production.filter(check=>check.command===nativeProducer.command&&JSON.stringify(check.args??[])===JSON.stringify(nativeProducer.args??[])&&check.cwd===nativeProducer.cwd).map(check=>check.id));
      if(state.acceptanceChecks?.some(check=>redundant.has(check.id))){
        state.acceptanceChecks=state.acceptanceChecks.filter(check=>!redundant.has(check.id));
        metrics.repetitions.push({taskId:'$acceptance',action:'replace-derived-production-check',reason:JSON.stringify({retired:[...redundant],selected:nativeProducer.id,basis:'The same engine-derived production invocation now records mandatory provider usage. User acceptance declarations remain in the registry.'}),at:now()});await save();
      }
    }
    const taskProofsBeforeAcceptance:VerificationEvidence[]=[];
    for(const task of plan.tasks){const local=canonicalOperational(task);for(const check of state.tasks[task.id]?.checks??task.checks){const hash=await proofHash(task,check,options.workspace,local);const proof=state.evidence.findLast(item=>item.taskId===task.id&&item.checkId===check.id&&item.inputHash===hash&&item.kind===check.kind&&item.level===verificationLevel(check));if(proof?.passed&&usableProof(check,proof))taskProofsBeforeAcceptance.push(proof);}}
    const selection=await measured('acceptanceSelection',()=>selectPendingAcceptance({brief:options.brief,plan,taskChecks:Object.fromEntries(plan.tasks.map(task=>[task.id,state.tasks[task.id]?.checks??task.checks])),operational,currentTaskProofs:taskProofsBeforeAcceptance,workspace:options.workspace,checks:state.acceptanceChecks??proposedFinal}));
    const finalChecks=selection.checks;
    for(const reuse of selection.reused){
      const reason=JSON.stringify(reuse);
      if(!metrics.repetitions.some(item=>item.action==='reuse-verification-receipt'&&item.reason===reason)){
        metrics.repetitions.push({taskId:acceptanceTask.id,action:'reuse-verification-receipt',reason,at:now()});
        event('recovery','A mesma execução já possui observação válida na tarefa; critério, entradas e ambiente foram conferidos. Nenhum PASS de aceite foi inventado.',reuse.checkId,reuse);
      }
    }
    if(finalChecks.length){
      const invalidated=new Set(state.proofInterpretations?.filter(item=>item.classification==='invalidated').map(item=>item.evidenceId));
      const cachedFinal=await cachedPositiveVerifications({workspace:options.workspace,taskId:acceptanceTask.id,checks:finalChecks,evidence:state.evidence,invalidatedEvidenceIds:invalidated,identity:check=>proofIdentity(acceptanceTask,check,options.workspace,operational),resource:check=>prepareResources(acceptanceTask,check,options.workspace,operational)});
      if(cachedFinal){
        state.acceptance!.push(...cachedFinal.map(result=>result.evidence));
        event('recovery','Aceite atual preservado por seus recibos; nenhuma área de execução ou prova adicional foi criada.');await save();
      }else{
      const area=await serial('isolation',()=>createTaskWorkspace(options.workspace,acceptanceTask.id,definitionHash(acceptanceTask),acceptanceTask.inputs??[]));
      const local=relocateOperationalEnvironment(operational,options.workspace,area.directory);
      try{
        const results=await measured('acceptance',()=>verify(acceptanceTask,area.directory,local,finalChecks));state.acceptance!.push(...results.map(result=>result.evidence));
        const failed=results.find(result=>!result.evidence.passed);if(failed){const check=finalChecks.find(item=>item.id===failed.evidence.checkId)!;if(await recoverAcceptance(failed,check,acceptanceTask,area.directory,local))continue;return finish('waiting');}
        const outputs=finalChecks.flatMap(declaredOutputs);
        if(outputs.length)await serial('acceptanceIntegration',async()=>{const transaction=await prepareIntegration(options.workspace,acceptanceTask.id,area,outputs);state.integrations!.push(transaction);await save();if(persistenceFailed)return;transaction.phase='applying';await save();try{await publishIntegration(options.workspace,transaction);transaction.phase='applied';await save();}catch(error){integrationBlocked=true;throw error;}});
      }catch(error){note(incident(error instanceof WorkPlanningError?'planning':'integration',acceptanceTask.id,error instanceof Error?error.message:String(error)));return finish('waiting');}
      }
    }
    const currentProofs:VerificationEvidence[]=[];
    for(const task of plan.tasks){const local=canonicalOperational(task);for(const check of state.tasks[task.id]?.checks??task.checks){const hash=await proofHash(task,check,options.workspace,local);const proof=state.evidence.findLast(item=>item.taskId===task.id&&item.checkId===check.id&&item.inputHash===hash&&item.kind===check.kind&&item.level===verificationLevel(check));if(proof?.passed&&usableProof(check,proof))currentProofs.push(proof);}}
    for(const check of finalChecks){const hash=await proofHash(acceptanceTask,check,options.workspace,operational);const proof=state.evidence.findLast(item=>item.taskId===acceptanceTask.id&&item.checkId===check.id&&item.inputHash===hash&&item.kind===check.kind&&item.level===verificationLevel(check));if(proof?.passed&&usableProof(check,proof))currentProofs.push(proof);}
    if(selection.reused.some(reuse=>reuse.receiptIds.some(id=>!currentProofs.some(proof=>proof.id===id)))){
      event('invalidation','Uma verificação posterior alterou entradas de uma observação reutilizada; reavaliando as provas afetadas.');
      continue execution;
    }
    for(const requirement of options.brief.requirements){
      const consumers=plan.tasks.filter(task=>task.requirementIds.includes(requirement.id));
      const candidates=currentProofs.filter(item=>item.level==='behavior'&&(consumers.some(task=>task.id===item.taskId&&(state.tasks[task.id]?.checks??task.checks).some(check=>check.id===item.checkId&&check.requirementIds.includes(requirement.id)))||finalChecks.some(check=>item.taskId===acceptanceTask.id&&check.id===item.checkId&&check.requirementIds.includes(requirement.id))));
      const kind=requiredRequirementInterface(requirement);
      const binding=requirement.binding;
      // A stack obligation is certified below by actual provider consumption
      // and its functional evidence chain. Requiring another behavior recipe
      // with the identical metadata ID would reject a valid compiled product.
      const proof=requirement.kind==='stack'&&binding?true:candidates.some(item=>!kind||item.kind===kind);
      const provider=binding?Object.values(operational.bindings).some(item=>item.ready&&obligationMatchesProvider(requirement,item)):true;
      if(!proof||!provider){
        const problem=incident(binding&&!provider?'environment':'instrument',requirement.id,'Mandatory requirement has no current proof in its required interface/provider.',requirement.statement);note(problem);
        problem.repairScope=binding&&!provider?'environment':'verification';
        const fingerprint=digest(JSON.stringify({protocol:executionProtocol,requirement,kind,proof,provider,proofs:currentProofs.map(item=>item.inputHash)}));state.acceptanceRecovery??={};
        const owner=consumers.find(task=>!consumers.some(other=>other.dependsOn.includes(task.id)))??consumers[0];
        const materializationKey=`${fingerprint}:verification-materialization`;
        if(!proof&&provider&&owner&&!state.acceptanceRecovery[materializationKey]){
          state.acceptanceRecovery[materializationKey]='running:verification-materialization';await save();
          if(await materializeVerification(owner,options.workspace,canonicalOperational(owner),`Mandatory outcome still needs its actual final proof after integration. Preserve the delivery and materialize only verification.\n${requirement.statement}`,kind,true)){
            state.acceptanceRecovery[materializationKey]='complete:verification-materialization';
            const progress=state.tasks[owner.id]!;progress.status='checking';progress.strategy='revalidate-only';delete progress.checkpoint;delete progress.verificationCheckpoint;delete progress.suspension;attempted.delete(owner.id);await save();continue execution;
          }
          if(options.signal?.aborted||cancelled)return finish('cancelled');
          state.acceptanceRecovery[materializationKey]='complete:instrument-unresolved';await save();
        }
        if(options.repairPlan&&owner&&!state.acceptanceRecovery[fingerprint]){state.acceptanceRecovery[fingerprint]='planning';scheduleReplan(owner,problem);await save();continue execution;}
        return finish('waiting');
      }
    }
    const observedFinalChecks=await Promise.all(finalChecks.map(async check=>(await verificationContext(acceptanceTask,check,options.workspace,operational)).check));
    const effectivePlan:DevelopmentPlan={...plan,tasks:plan.tasks.map(task=>({...task,checks:state.tasks[task.id]?.checks??task.checks})),acceptance:observedFinalChecks};
    const conformity=await measured('conformance',()=>validateConformance(options.brief,effectivePlan,operational,currentProofs,options.workspace));
    if(conformity.length){
      if(!state.nativeConformanceCheckIds?.length&&conformity.some(issue=>issue.code!=='provider-unavailable')){
        const requirements=options.brief.requirements.filter(requirement=>requirement.binding).map(requirement=>requirement.id);
        const native:Verification[]=[];
        const productionCheck=production[0]??finalChecks.find(check=>verificationLevel(check)==='build');
        if(productionCheck){
          const {conformance:_oldClaim,conformanceClaims:_oldCandidates,...recipe}=productionCheck;
          native.push({...recipe,id:'native-providers-build',kind:'command',level:'build',requirementIds:requirements,expected:'Observe actual product build and mandatory provider consumption.',assertion:{type:'exit',value:0},expectedExitCode:0});
        }
        const mode=options.brief.modes.find(kind=>kind==='web'||kind==='tui'||kind==='cli'||kind==='desktop');
        if(mode){
          const target:Verification={id:'native-providers-behavior',kind:mode,level:'behavior',expected:'Observe mandatory providers while the existing real product scenario executes.',requirementIds:options.brief.requirements.map(requirement=>requirement.id),requiredCapabilities:mode==='web'?['browser']:[]};
          const candidate=candidateFromRecordedInterfaceProof({plan,targetTaskId:'$acceptance',target,requiredKind:mode,evidence:currentProofs,taskChecks:Object.fromEntries(plan.tasks.map(task=>[task.id,state.tasks[task.id]?.checks??task.checks])),workspace:options.workspace,sourceWorkspaces:Object.fromEntries(plan.tasks.map(task=>[task.id,state.integrations?.filter(transaction=>transaction.taskId===task.id).map(transaction=>transaction.workspace)??[]]))});
          if(candidate){
            const check:Verification={...candidate.check,requirementIds:requirements};
            if(mode!=='tui')check.assertion={type:'exit',value:check.expectedExitCode??0};
            native.push(check);
            metrics.repetitions.push({taskId:'$acceptance',action:'native-provider-observation-candidate',reason:JSON.stringify(candidate.transformation),at:now()});
          }
        }else{
          const proof=[...currentProofs].reverse().find(item=>item.passed&&item.level==='behavior'&&item.kind==='command');
          const owner=proof?plan.tasks.find(task=>task.id===proof.taskId):undefined;
          const recipe=owner?(state.tasks[owner.id]?.checks??owner.checks).find(check=>check.id===proof!.checkId):undefined;
          if(recipe){const {conformance:_oldClaim,conformanceClaims:_oldCandidates,...check}=recipe;native.push({...check,id:'native-providers-behavior',requirementIds:requirements,expected:'Observe actual product execution and mandatory provider consumption.',assertion:{type:'exit',value:check.expectedExitCode??0}});}
        }
        if(native.length){
          state.nativeConformanceCheckIds=native.map(check=>check.id);
          state.acceptanceChecks=reconcileChecks([...(state.acceptanceChecks??[]),...native]);
          event('recovery','Certificação nativa dos provedores preparada em lote; os cenários atuais serão observados sem novas receitas de modelo.',undefined,{checkIds:state.nativeConformanceCheckIds,requirementIds:requirements});await save();continue execution;
        }
      }
      for(const issue of conformity)note(incident('planning',issue.requirementId,issue.message,issue.code));
      const fingerprint=digest(JSON.stringify({protocol:executionProtocol,issues:conformity,proofs:currentProofs.map(proof=>proof.inputHash)}));state.acceptanceRecovery??={};
      if(options.repairPlan&&!state.acceptanceRecovery[fingerprint]){state.acceptanceRecovery[fingerprint]='planning';const issue=conformity[0]!,owner=plan.tasks.find(task=>task.requirementIds.includes(issue.requirementId))??plan.tasks[0];if(owner){const problem=incident(issue.code==='provider-unavailable'?'environment':'instrument',issue.requirementId,'Mandatory provider usage is not yet proved; reconcile its actual provider and verification contract before changing any delivery.',issue.message);problem.repairScope=issue.code==='provider-unavailable'?'environment':'verification';scheduleReplan(owner,problem);await save();continue;}}
      return finish('waiting');
    }
    // Moving an integration finding never proves it. Only the current final
    // owner's acknowledgement and a fresh appropriate receipt can discharge it.
    for(const handoff of state.reviewHandoffs??[]){
      const origin=plan.tasks.find(task=>task.id===handoff.fromTaskId),owner=plan.tasks.find(task=>task.id===handoff.ownerTaskId),requirement=options.brief.requirements.find(item=>item.id===handoff.requirementId);
      const relation=origin?await validateFindingDeferral(options.workspace,options.brief,plan,origin,handoff.finding):{valid:false,reason:'The originating contribution no longer has an active plan identity.'};
      if(!relation.valid||!owner||!requirement||JSON.stringify(requirement.source)!==JSON.stringify(handoff.source)){
        handoff.status='pending';const problem=incident('instrument',handoff.id,'The deferred finding needs a current source and final owner before completion.',relation.reason);problem.repairScope='verification';note(problem);await save();return finish('waiting');
      }
      const kind=requiredRequirementInterface(requirement),stack=requirement.kind==='stack'&&Boolean(requirement.binding);
      const recipes=[...effectivePlan.tasks.flatMap(task=>task.checks.map(check=>({taskId:task.id,check}))),...observedFinalChecks.map(check=>({taskId:'$acceptance',check}))];
      const proofs=currentProofs.filter(proof=>recipes.some(({taskId,check})=>taskId===proof.taskId&&check.id===proof.checkId&&(stack?verificationConformanceClaims(check).some(claim=>claim.requirementId===requirement.id):(taskId===owner.id||taskId==='$acceptance')&&check.requirementIds.includes(requirement.id)))&&(stack?proof.level!=='syntax':proof.level==='behavior'&&(!kind||proof.kind===kind)));
      if(!proofs.length){
        handoff.status='pending';const key=digest(JSON.stringify({protocol:executionProtocol,handoff:handoff.id,proofs:currentProofs.map(proof=>proof.inputHash)}));state.acceptanceRecovery??={};
        const previous=state.acceptanceRecovery[key];
        if(!previous||previous.startsWith('running:')||previous.startsWith('interrupted:')){
          state.acceptanceRecovery[key]='running:handoff-proof';await save();
          if(await materializeVerification(owner,options.workspace,canonicalOperational(owner),`The final integration obligation still has no current owner proof. Preserve the earlier contribution; verify this expected outcome on the integrated product.\n${reviewFindingText(handoff.finding)}`,kind,true)){
            state.acceptanceRecovery[key]='complete:handoff-proof-recipe';
            const progress=state.tasks[owner.id]!;progress.status='checking';progress.strategy='revalidate-only';delete progress.checkpoint;delete progress.verificationCheckpoint;delete progress.suspension;attempted.delete(owner.id);await save();continue execution;
          }
          if(options.signal?.aborted||cancelled){state.acceptanceRecovery[key]='interrupted:handoff-proof';await save();return finish('cancelled');}
          state.acceptanceRecovery[key]='complete:handoff-proof-unresolved';
        }
        const problem=incident('instrument',handoff.id,'The deferred integration finding remains unproved by its final owner.',reviewFindingText(handoff.finding));problem.repairScope='verification';note(problem);
        if(options.repairPlan&&state.acceptanceRecovery[key]!=='planning-handoff'){state.acceptanceRecovery[key]='planning-handoff';scheduleReplan(owner,problem);await save();continue execution;}
        await save();return finish('waiting');
      }
      const acknowledged=await acknowledgedHandoffs(owner,options.workspace);
      if(!acknowledged.has(handoff.id)){
        handoff.status='pending';const progress=state.tasks[owner.id]!,area=await serial('isolation',()=>createTaskWorkspace(options.workspace,owner.id,definitionHash(owner),taskWriteScopes(owner,state)));
        area.phase='reviewing';progress.checkpoint=area;progress.status='reviewing';progress.strategy=`integration-obligation:${digest(JSON.stringify((state.reviewHandoffs??[]).filter(item=>item.ownerTaskId===owner.id&&!acknowledged.has(item.id)).map(item=>item.id)))}`;delete progress.suspension;attempted.delete(owner.id);await save();continue execution;
      }
      const proofIds=proofs.map(proof=>proof.id);
      if(handoff.status!=='resolved'||JSON.stringify(handoff.proofIds)!==JSON.stringify(proofIds)){handoff.status='resolved';handoff.proofIds=proofIds;handoff.resolvedAt=now();handoff.resolutions??=[];handoff.resolutions.push({at:handoff.resolvedAt,proofIds});event('recovery','Obrigação de integração confirmada pelo responsável final com provas atuais.',owner.id,{handoffId:handoff.id,proofIds});await save();}
    }
    event('complete','Todos os fragmentos foram integrados e os requisitos obrigatórios possuem provas observadas.');return finish('complete');
  }
}
