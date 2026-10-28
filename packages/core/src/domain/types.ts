/** Product data, independent of model transport, presentation and persistence. */
export type ApplicationMode = "web" | "desktop" | "tui" | "cli" | "api" | "service" | "library" | "other";
export type TargetPlatform = "linux" | "windows" | "macos" | "browser" | "portable";
export type Risk = "low" | "normal" | "high";

export interface Source {
  kind: "request" | "answer" | "repository";
  text: string;
  reference: string;
}

export interface Requirement {
  id: string;
  statement: string;
  source: Source;
  mode: ApplicationMode | "shared";
}

export interface ProductConstraint {
  id: string;
  statement: string;
  source: Source;
  forbiddenCapabilities: string[];
  requiredCapabilities: string[];
}

export interface Question {
  id: string;
  fact: string;
  question: string;
  reason: string;
  impact: string;
  category: "behavior" | "platform" | "data" | "integration" | "security" | "distribution" | "appearance";
  modes: ApplicationMode[];
  options: string[];
  blocks: string[];
}

export interface Decision {
  id: string;
  questionId: string;
  fact: string;
  answer: string;
  source: Source;
}

export interface Gap extends Question {
  status: "pending" | "resolved";
}

export interface ProductBrief {
  schema: "capivara/product/1";
  status: "discovering" | "ready" | "waiting";
  id: string;
  revision: number;
  name: string;
  summary: string;
  /** Kept once for provenance. Task packets contain only their requirement slices. */
  request: string;
  modes: ApplicationMode[];
  targets: TargetPlatform[];
  requirements: Requirement[];
  constraints: ProductConstraint[];
  decisions: Decision[];
  gaps: Gap[];
}

export interface CommandRecipe {
  command: string;
  args?: string[];
  cwd?: string;
  system?: boolean;
  capabilities?: string[];
  timeoutMs?: number;
}

export interface EnvironmentNode {
  id: string;
  name: string;
  kind: "runtime" | "sdk" | "tool" | "package" | "service" | "database";
  dependsOn: string[];
  targets: string[];
  reason: string;
  check: CommandRecipe;
  prepare: CommandRecipe[];
}

export interface IntegrationContract {
  id: string;
  name: string;
  description: string;
  inputs: string[];
  outputs: string[];
  requirementIds: string[];
}

export interface Verification {
  id: string;
  kind: "command" | "cli" | "tui" | "web" | "desktop";
  command?: string;
  args?: string[];
  expected?: string;
  expectedExitCode?: number;
  input?: string[];
  steps?: { input?: string; waitFor?: string; timeoutMs?: number }[];
  closeInput?: string;
  requirementIds: string[];
  requiredCapabilities: string[];
  timeoutMs?: number;
  target?: TargetPlatform;
}

export interface WorkUnit {
  id: string;
  title: string;
  goal: string;
  instructions: string;
  requirementIds: string[];
  dependsOn: string[];
  environmentIds: string[];
  contractIds: string[];
  files: string[];
  criteria: string[];
  checks: Verification[];
  risk: Risk;
  /** Only unanswered product decisions can withhold a consumer. */
  blockedBy: string[];
}

export interface DevelopmentPlan {
  schema: "capivara/plan/1";
  status: "planning" | "ready";
  revision: number;
  briefId: string;
  briefRevision: number;
  environment: EnvironmentNode[];
  contracts: IntegrationContract[];
  tasks: WorkUnit[];
}

export interface DomainAgentRequest {
  operation: "discover" | "environment" | "outline" | "task" | "repair";
  prompt: string;
  readOnly: true;
}
export type DomainAgent = (request: DomainAgentRequest) => Promise<string>;

export interface DomainEvent {
  type: string;
  message: string;
  subject?: string;
}

export interface DomainHooks {
  agent: DomainAgent;
  ask?: (question: Question) => Promise<string | null>;
  save?: (state: { brief?: ProductBrief; plan?: DevelopmentPlan }) => Promise<void>;
  onEvent?: (event: DomainEvent) => void;
  signal?: AbortSignal;
  /** Total model input capacity; work packets use half, leaving room for tools and evidence. */
  contextChars?: number;
}

export interface InitOptions extends DomainHooks {
  request: string;
  existing?: ProductBrief;
  repository?: string;
  repositoryConstraints?: { text: string; reference: string }[];
}

export interface PlanOptions extends DomainHooks {
  brief: ProductBrief;
  existing?: DevelopmentPlan;
  repository?: string;
  repositoryConstraints?: { text: string; reference: string }[];
}

export interface ContextPacket {
  task: WorkUnit;
  project: { name: string; modes: ApplicationMode[]; targets: TargetPlatform[] };
  requirements: Requirement[];
  constraints: ProductConstraint[];
  decisions: Decision[];
  contracts: IntegrationContract[];
  environment: EnvironmentNode[];
  capabilityLimits: { forbidden: string[]; required: string[] };
}

export type ProductAction = { requiredCapabilities: string[]; description?: string };
