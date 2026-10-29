import type { DevelopmentPlan, ProductBrief, Verification, WorkUnit } from '../domain/types.js';
import type { AgentRequest, AgentResult, CommandRequest, CommandResult, RuntimeEvent, TerminalRequest } from '../runtime/types.js';
import type { ProgressMeasurement, BuildGateMeasurement } from '../telemetry/progress.js';
import type { ReviewAssessment } from './review.js';
import type { ConformanceProvenance } from './conformance.js';
import type { ReviewScopeHandoff } from './source-finding-scope.js';
import type { CompositeInspectionReceipt } from './inspection-composition.js';

export type PersistedReviewHandoff = Omit<ReviewScopeHandoff,'status'> & {
  status:'pending'|'resolved';
  createdAt:string;
  resolutions?:{at:string;proofIds:string[]}[];
  resolvedAt?:string;
  proofIds?:string[];
};

export interface BuildIncident {
  id: string;
  kind: 'environment' | 'product' | 'instrument' | 'transport' | 'decision' | 'integration' | 'planning';
  subject: string;
  message: string;
  evidence: string;
  action: string;
  external: boolean;
  /** Reduced total context capacity discovered from the provider, for local task splitting. */
  contextChars?: number;
  repairScope?: 'verification' | 'environment' | 'delivery' | 'authority';
}
export interface VerificationEvidence {
  id: string;
  taskId: string;
  checkId: string;
  inputHash: string;
  /** Execution identity excludes only criterion and predicate interpretation fields. */
  observationHash?: string;
  /** Original observation timestamp, retained by predicate-only reinterpretation. */
  observedAt?: string;
  reinterpretedFrom?: string;
  instrumentClassification?: { reference:string; reason:string };
  passed: boolean;
  command: string;
  output: string;
  terminal: boolean;
  kind?: Verification['kind'];
  target?: string;
  checkedAt: string;
  level?: 'syntax' | 'build' | 'behavior';
  environmentRevision?: string;
  inputs?: string[];
  classification?: 'product' | 'instrument' | 'environment' | 'transport' | 'planning';
  provenance?: ConformanceProvenance;
  artifacts?: Record<string, string>;
  observation?: VerificationObservation;
  browserObservation?: { schema:'capivara/browser-interaction/1'; witnesses:import('../runtime/browser-observation.js').BrowserInteractionWitness[]; diagnostics:string[] };
  assertionStatus?: 'ready' | 'missing' | 'invalid' | 'failed';
  /** Negative inline-runner evidence distinguishes parsing from product execution. */
  instrumentSyntaxChecked?:{protocol:'inline-node-syntax/1';identity:string;passed:boolean};
}
/** Original runner observation, reusable when only its predicate needs repair. */
export interface VerificationObservation {
  command: string;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  cancelled: boolean;
  timedOut: boolean;
  terminal: boolean;
  issue?: CommandResult['issue'];
  invocationTransformation?: CommandResult['invocationTransformation'];
}
export interface ActionRecord {
  purpose?: AgentRequest['purpose'];
  /** Set only after context and invocation tools are ready for the agent. */
  agentStartedAt?: string;
  /** A completed reconciliation result awaiting atomic adoption with execution. */
  planProposal?: DevelopmentPlan;
  id: string;
  action: string;
  input: string;
  strategy: string;
  reason: string;
  at: string;
  durationMs: number;
  outcome: 'running' | 'changed' | 'unchanged' | 'failed' | 'complete' | 'cancelled';
  after?: string;
  failure?: string;
  result?: AgentResult;
  sourceCoverage?: import('./task-context.js').TaskSourceCoverage[];
  /** Integration obligations actually included in this invocation packet. */
  handoffIds?:string[];
  instrumentRepairs?: import('./invocation-instrument.js').InstrumentRepair[];
}
export interface WorkspaceCheckpoint {
  directory: string;
  base: Record<string, string>;
  phase: 'editing' | 'checking' | 'reviewing' | 'integrating';
  taskHash: string;
}
export interface IntegrationTransaction {
  id: string;
  taskId: string;
  workspace: string;
  files: { path: string; before: string | null; after: string | null; mode?: number }[];
  phase: 'prepared' | 'applying' | 'applied';
  /** Durable staged provider directories, including executable links; resumed before their consumer. */
  installations?: { path: string; staged: string; backup: string; before: string | null; after: string | null }[];
}
export interface BuildMetrics {
  startedAt: string;
  elapsedMs: number;
  maxConcurrency: number;
  active: number;
  callsByRole: Record<string, number>;
  timeByStageMs: Record<string, number>;
  invalidations: { taskId: string; checkId?: string; reason: string; at: string }[];
  repetitions: { taskId: string; action: string; reason: string; at: string }[];
  timeline: { taskId: string; stage: string; start: number; end?: number }[];
}
export interface TaskProgress {
  status: 'pending' | 'preparing' | 'editing' | 'checking' | 'reviewing' | 'integrating' | 'complete' | 'waiting';
  revision: string;
  attempts: number;
  changedFiles: string[];
  /** Exact files observed as mechanical producer outputs, separate from editor source. */
  generatedFiles?: string[];
  findings: string[];
  strategy: string;
  contextChars?: number;
  failureSignature?: string;
  actions?: ActionRecord[];
  reviews?: { inputHash: string; at: string; assessment: ReviewAssessment; inspection?: import('./inspection.js').InspectionIdentity; handoffIds?:string[] }[];
  inspectionCompositions?: CompositeInspectionReceipt[];
  interfaceRejections?:{key:string;kind:Exclude<Verification['kind'],'command'>;evidenceId:string;at:string}[];
  checkpoint?: WorkspaceCheckpoint;
  checks?: Verification[];
  /** Exact records selected by the latest verification batch, including reused proofs. */
  verificationEvidence?: { checkId:string; evidenceId:string; inputHash:string }[];
  suspension?: { fingerprint: string; reason: string; action: string };
  noProgress?: number;
  dependencyCache?: unknown;
  providerSynchronization?:{directory:string;revision:string};
  retryGeneration?: number;
  reviewFailureSignature?: string;
  reviewNoProgress?: number;
  definitionHash?: string;
  verificationCheckpoint?: { directory: string; sourceHash: string };
  controlStates?: string[];
  pendingControlState?: string;
  revalidationFingerprint?: string;
  integrationConflict?: { path: string; before: string | null; current: string | null; proposed: string | null };
  integrationReconciliations?: string[];
  proposals?: string[];
  contextFocus?: string[];
}
export interface BuildState {
  schema: 'capivara/build/1';
  planRevision: number;
  tasks: Record<string, TaskProgress>;
  environment: Record<string, { inputHash: string; ready: boolean; fingerprint?: string; installationRevision?: string; operational?: unknown; failedFingerprint?: string; actions?: ActionRecord[]; preparedAt?: string; recovery?: { fingerprint: string; configuration: string; protocol?: string; exhausted: boolean; reason: string } }>;
  evidence: VerificationEvidence[];
  incidents: BuildIncident[];
  /** Deferred findings remain obligations until their final owner proves them. */
  reviewHandoffs?:PersistedReviewHandoff[];
  updatedAt: string;
  controlVersion?: 2;
  /** Version of executable recovery transitions, independent of product proofs. */
  controlProtocol?:string;
  metrics?: BuildMetrics;
  integrations?: IntegrationTransaction[];
  acceptance?: VerificationEvidence[];
  acceptanceRecovery?: Record<string, string>;
  /** A queued reconciliation is executable work, including after interruption. */
  pendingReplans?: Record<string, BuildIncident>;
  acceptanceChecks?: Verification[];
  acceptancePlanHash?: string;
  nativeConformanceCheckIds?:string[];
  retiredInstruments?:{key:string;authorityHash:string;checkId:string;evidenceId:string;at:string}[];
  nativeConformanceCoverage?:{id:string;checkId:string;coverage:import('./conformance-candidates.js').ConformanceCandidateCoverage}[];
  /** Current blocking causes, separate from the append-only incident history. */
  blockers?: BuildIncident[];
  /** Recovered recipes are durable even before the build publishes its final plan. */
  environmentDefinitions?: Record<string, { originalHash: string; definition: import('../domain/types.js').EnvironmentNode }>;
  proofInterpretations?: { evidenceId: string; at: string; originalClassification: string; classification: string; reason: string; actionId?: string }[];
  /** Exact effective definitions keep isolated proposals identifiable across replanning and restarts. */
  taskDefinitions?: Record<string, WorkUnit>;
  taskDefinitionHistory?: Record<string, WorkUnit>;
  resourceBindings?: Record<string, Record<string, string>>;
  planLineage?: import('./plan-lineage.js').RestoredPlanLineage[];
}
export interface BuildEvent {
  type: 'task' | 'environment' | 'verification' | 'recovery' | 'waiting' | 'complete' | 'progress' | 'gate' | 'scheduler' | 'transition' | 'review' | 'invalidation';
  message: string;
  subject?: string;
  progress?: ProgressMeasurement;
  gate?: BuildGateMeasurement;
  detail?: unknown;
}
export type BuildAgentRequest = Omit<AgentRequest, 'config'>;
export interface BuildOptions {
  workspace: string;
  brief: ProductBrief;
  plan: DevelopmentPlan;
  agent: (request: BuildAgentRequest) => Promise<AgentResult>;
  state?: BuildState;
  signal?: AbortSignal;
  allowSystemInstall?: boolean;
  contextChars?: number;
  maxConcurrent?: number;
  retrySuspended?: boolean;
  configurationRevision?: string;
  domainCalls?: import('./plan-lineage.js').PlanDomainCalls;
  executeCommand?: (request: CommandRequest) => Promise<CommandResult>;
  runTerminal?: (request: TerminalRequest) => Promise<CommandResult>;
  onState?: (state: BuildState, plan: DevelopmentPlan) => Promise<void>;
  onEvent?: (event: BuildEvent | RuntimeEvent) => void;
  repairPlan?: (incident: BuildIncident, task: WorkUnit) => Promise<DevelopmentPlan | null>;
}
export interface BuildOutcome {
  status: 'complete' | 'waiting' | 'cancelled';
  state: BuildState;
  plan: DevelopmentPlan;
  completed: string[];
  pending: string[];
  incidents: BuildIncident[];
}
export interface SelectedVerification {
  check: Verification;
  replaced?: string;
  requiredKind?:Verification['kind'];
  protocolIssue?:{code:'ambiguous-browser-command';requiredKind:'web';original:Verification};
}
