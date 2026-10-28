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
}
export interface ActionRecord {
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
  revalidationFingerprint?: string;
  integrationConflict?: { path: string; before: string | null; current: string | null; proposed: string | null };
  integrationReconciliations?: string[];
  proposals?: string[];
}
export interface BuildState {
  schema: 'capivara/build/1';
  planRevision: number;
  tasks: Record<string, TaskProgress>;
  environment: Record<string, { inputHash: string; ready: boolean; fingerprint?: string; operational?: unknown; failedFingerprint?: string; actions?: ActionRecord[]; preparedAt?: string }>;
  evidence: VerificationEvidence[];
  incidents: BuildIncident[];
  updatedAt: string;
  controlVersion?: 2;
  metrics?: BuildMetrics;
  integrations?: IntegrationTransaction[];
  acceptance?: VerificationEvidence[];
  acceptanceRecovery?: Record<string, string>;
  acceptanceChecks?: Verification[];
  acceptancePlanHash?: string;
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
  executeCommand?: (request: CommandRequest) => Promise<CommandResult>;
  runTerminal?: (request: TerminalRequest) => Promise<CommandResult>;
  onState?: (state: BuildState) => Promise<void>;
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
