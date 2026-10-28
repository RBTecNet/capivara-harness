import type { DevelopmentPlan, ProductBrief, Verification, WorkUnit } from '../domain/types.js';
import type { AgentRequest, AgentResult, CommandRequest, CommandResult, RuntimeEvent, TerminalRequest } from '../runtime/types.js';
import type { ProgressMeasurement, BuildGateMeasurement } from '../telemetry/progress.js';
import type { ReviewAssessment } from './review.js';
import type { ConformanceProvenance } from './conformance.js';

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
  repairScope?: 'verification' | 'environment' | 'delivery';
}
export interface VerificationEvidence {
  id: string;
  taskId: string;
  checkId: string;
  inputHash: string;
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
  assertionStatus?: 'ready' | 'missing' | 'invalid' | 'failed';
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
}
export interface ActionRecord {
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
  findings: string[];
  strategy: string;
  contextChars?: number;
  failureSignature?: string;
  actions?: ActionRecord[];
  reviews?: { inputHash: string; at: string; assessment: ReviewAssessment }[];
  checkpoint?: WorkspaceCheckpoint;
  checks?: Verification[];
  suspension?: { fingerprint: string; reason: string; action: string };
  noProgress?: number;
  dependencyCache?: unknown;
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
  environment: Record<string, { inputHash: string; ready: boolean; fingerprint?: string; operational?: unknown; failedFingerprint?: string; actions?: ActionRecord[]; preparedAt?: string; recovery?: { fingerprint: string; configuration: string; protocol?: string; exhausted: boolean; reason: string } }>;
  evidence: VerificationEvidence[];
  incidents: BuildIncident[];
  updatedAt: string;
  controlVersion?: 2;
  metrics?: BuildMetrics;
  integrations?: IntegrationTransaction[];
  acceptance?: VerificationEvidence[];
  acceptanceRecovery?: Record<string, string>;
  /** A queued reconciliation is executable work, including after interruption. */
  pendingReplans?: Record<string, BuildIncident>;
  acceptanceChecks?: Verification[];
  acceptancePlanHash?: string;
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
}
