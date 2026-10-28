import type { DevelopmentPlan, ProductBrief, Verification, WorkUnit } from '../domain/types.js';
import type { AgentRequest, AgentResult, CommandRequest, CommandResult, RuntimeEvent, TerminalRequest } from '../runtime/types.js';
import type { ProgressMeasurement } from '../telemetry/progress.js';

export interface BuildIncident {
  id: string;
  kind: 'environment' | 'product' | 'instrument' | 'transport' | 'decision' | 'integration';
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
}
export interface TaskProgress {
  status: 'pending' | 'editing' | 'checking' | 'reviewing' | 'complete' | 'waiting';
  revision: string;
  attempts: number;
  changedFiles: string[];
  findings: string[];
  strategy: string;
  contextChars?: number;
  failureSignature?: string;
}
export interface BuildState {
  schema: 'capivara/build/1';
  planRevision: number;
  tasks: Record<string, TaskProgress>;
  environment: Record<string, { inputHash: string; ready: boolean }>;
  evidence: VerificationEvidence[];
  incidents: BuildIncident[];
  updatedAt: string;
}
export interface BuildEvent {
  type: 'task' | 'environment' | 'verification' | 'recovery' | 'waiting' | 'complete' | 'progress';
  message: string;
  subject?: string;
  progress?: ProgressMeasurement;
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
