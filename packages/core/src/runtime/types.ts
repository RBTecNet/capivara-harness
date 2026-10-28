import type { ProgressMeasurement } from '../telemetry/progress.js';

/** New execution boundary. A failed operation is data for the coordinator, never a process exit. */
export interface AgentConfig {
  provider: string;
  model?: string;
  effort?: string;
  baseUrl?: string;
  apiKeyEnv?: string;
  apiKey?: string;
  command?: string;
  args?: string[];
  contextTokens?: number;
  maxOutputTokens?: number;
  /** Complementary bound; repeated no-progress tool actions are stopped earlier. */
  maxToolRounds?: number;
  environment?: Record<string, string>;
}

export interface ExecutionConstraints {
  /** Capabilities excluded by the product. The coordinator retains their original requirement IDs. */
  forbiddenCapabilities?: readonly string[];
  allowSystemInstall?: boolean;
  /** Optional allowed product paths. The default is the workspace, excluding harness control state. */
  writablePaths?: readonly string[];
}

export interface RuntimeEvent {
  type: 'agent' | 'output' | 'command' | 'tool' | 'recovery' | 'progress';
  message: string;
  detail?: unknown;
  progress?: ProgressMeasurement;
}

export interface RuntimeIssue {
  kind: 'transport' | 'authentication' | 'rate-limit' | 'capacity' | 'configuration' | 'context' | 'output-limit' | 'tool' | 'constraint' | 'instrument';
  message: string;
  retryAfterMs?: number;
  recoverable: boolean;
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens?: number;
  costUsd?: number;
}

export interface CommandRequest {
  cwd: string;
  /** String commands use the platform shell; argv arrays execute directly without a shell. */
  command: string | readonly string[];
  environment?: Record<string, string>;
  signal?: AbortSignal;
  timeoutMs?: number;
  input?: string;
  maxOutputBytes?: number;
  onOutput?: (text: string, stream: 'stdout' | 'stderr') => void;
  /** Relevant input paths, relative to cwd. Without this the product source tree is fingerprinted. */
  inputs?: readonly string[];
  constraints?: ExecutionConstraints;
  /** Actual capability of this operation, declared by the coordinator rather than inferred from modality. */
  capabilities?: readonly string[];
  /** Request host workspace isolation for model shell tools when the host can supply it. */
  isolateWorkspace?: boolean;
  /** The coordinator or transport adapter supplies actual execution policy, never the model's claim. */
  executionPolicy?: {
    purpose: 'inspection' | 'verification' | 'implementation';
    writeScope: 'read-only' | 'workspace' | 'isolated-workspace';
  };
}

export interface CommandResult {
  command: string;
  cwd: string;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
  cancelled: boolean;
  signal: string | null;
  fingerprint: string;
  /** Whether the actual execution used a pseudoterminal. */
  terminal?: boolean;
  issue?: RuntimeIssue;
}

export interface TerminalStep {
  /** Literal terminal bytes, e.g. '\u001b[B' for the down arrow. */
  input?: string;
  waitFor?: string;
  timeoutMs?: number;
}

export interface TerminalRequest extends CommandRequest {
  steps?: readonly TerminalStep[];
  columns?: number;
  rows?: number;
  /** Exit after the steps by sending this input. No implicit success is inferred from process survival. */
  closeInput?: string;
}

export interface AgentRequest {
  workspace: string;
  config: AgentConfig;
  /** Operational bindings prepared by the coordinator; inherited by all process tools. */
  environment?: Record<string, string>;
  role: string;
  purpose?: 'implementation' | 'environment-recovery' | 'inspection';
  /** Stable identity assigned by the coordinator's persisted action ledger, never a per-call random ID. */
  operationKey?: string;
  instruction: string;
  context?: string;
  readOnly?: boolean;
  signal?: AbortSignal;
  onEvent?: (event: RuntimeEvent) => void;
  timeoutMs?: number;
  constraints?: ExecutionConstraints;
}

export interface ApiProgressDiagnostics {
  kind: 'api-progress';
  stateFingerprint: string;
  toolRounds: number;
  toolActions: number;
  informationalObservations: number;
  mutations: number;
  stagnantActions: number;
  stoppedBecause?: 'no-progress' | 'round-limit';
  repeatedAction?: string;
  replayedStop?: boolean;
  persistence?: 'written' | 'unavailable';
}

export interface AgentResult {
  status: 'complete' | 'partial' | 'unavailable' | 'cancelled';
  text: string;
  issue?: RuntimeIssue;
  usage?: Usage;
  commands: CommandResult[];
  changedFiles: string[];
  sessionId?: string;
  diagnostics?: ApiProgressDiagnostics;
}
