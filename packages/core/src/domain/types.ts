import type { ProgressMeasurement } from '../telemetry/progress.js';

/** Product data, independent of model transport, presentation and persistence. */
export type ApplicationMode = "web" | "desktop" | "tui" | "cli" | "api" | "service" | "library" | "other";
export type TargetPlatform = "linux" | "windows" | "macos" | "browser" | "portable";
export type Risk = "low" | "normal" | "high";
export interface CapabilityIdentity {
  capability: string;
  kind: "cli" | "library" | "driver" | "service" | "runtime" | "sdk";
  provider: string;
}

export interface Source {
  kind: "request" | "answer" | "repository";
  text: string;
  reference: string;
  /** Materialized selected input, available when this literal excerpt needs its original file. */
  localPath?: string;
}

export interface Requirement {
  id: string;
  statement: string;
  source: Source;
  mode: ApplicationMode | "shared";
  kind?: "behavior" | "stack" | "interface" | "constraint";
  /** Literal mandatory technology choice, checked against the operational provider. */
  binding?: CapabilityIdentity;
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
  /** Fingerprint of the selected documentary material, independent of the literal request. */
  materialRevision?: string;
  /** Selected inputs are indexed once; their bodies stay in the materialized files. */
  references?: DocumentReference[];
  name: string;
  summary: string;
  /** Kept once for provenance. Task packets contain only their requirement slices. */
  request: string;
  modes: ApplicationMode[];
  targets: TargetPlatform[];
  requirements: Requirement[];
  constraints: ProductConstraint[];
  /** Original literal authority survives corrections to the harness interpretation. */
  authorityCorrections?: { constraintId: string; source: Source; before: { forbiddenCapabilities: string[]; requiredCapabilities: string[] }; after: { forbiddenCapabilities: string[]; requiredCapabilities: string[] }; reason: string }[];
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
  /** Required capability and its actual provider, independent of display names. */
  identity?: CapabilityIdentity;
  requirementIds?: string[];
  /** Operational bindings made available to consumers after readiness is proven. */
  provides?: { command?: string[]; aliases?: string[]; invocations?: { command: string[]; aliases?: string[] }[]; env?: Record<string, string>; paths?: string[]; inputs?: string[] };
}

export interface IntegrationContract {
  id: string;
  name: string;
  description: string;
  inputs: string[];
  outputs: string[];
  requirementIds: string[];
}

export type AssertionJson = null | boolean | number | string | AssertionJson[] | { [key: string]: AssertionJson };
export type VerificationAssertion =
  | { type: "contains"; value: string; source?: "stdout" | "stderr" | "output" }
  | { type: "regex"; pattern: string; flags?: string; source?: "stdout" | "stderr" | "output" }
  | { type: "exit"; value: number }
  | { type: "empty"; source?: "stdout" | "stderr" | "output" }
  | { type: "json"; source?: "stdout" | "stderr"; path?: (string | number)[]; equals?: AssertionJson; exists?: boolean }
  | { type: "all"; assertions: VerificationAssertion[] }
  | { type: "any"; assertions: VerificationAssertion[] };

export interface Verification {
  id: string;
  kind: "command" | "cli" | "tui" | "web" | "desktop";
  command?: string;
  args?: string[];
  expected?: string;
  /** A human criterion is not a machine predicate. This is the explicit witness selector. */
  assertion?: VerificationAssertion;
  /** A malformed model proposal stays visibly invalid after normalization. */
  assertionIssue?: string;
  expectedExitCode?: number;
  input?: string[];
  steps?: { input?: string; waitFor?: string; timeoutMs?: number }[];
  closeInput?: string;
  requirementIds: string[];
  requiredCapabilities: string[];
  constraintIds?: string[];
  timeoutMs?: number;
  target?: TargetPlatform;
  inputs?: string[];
  cwd?: string;
  level?: "syntax" | "build" | "behavior";
  outputs?: string[];
  dependsOn?: string[];
  /** A documented manifest adapter is a candidate invocation, never an approval. */
  recipeCandidate?: { kind: "package-script"; manifest: string; manifestHash: string; script: string; expandedArgv: string[]; target: string; original: { command: string; args?: string[]; cwd?: string } };
  /** Populated by a concrete runtime adapter, not accepted as a model assertion. */
  instrument?: { provider: string; output: "runner"; originalKind?: Verification["kind"]; declaredInputs?: string[]; sourceInputs?: string[]; transformations?: { original: { command?: string; args?: string[]; cwd?: string }; removedPreparations: { command: string; args: string[]; cwd: string }[]; reason: string }[] };
  /** Dedicated proof that product inputs actually consume the mandatory provider. */
  conformance?: CapabilityIdentity & { requirementId: string; productInputs: string[]; providerCommand?: string[]; providerInputs?: string[]; artifacts?: string[] };
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
  /** Explicit read dependencies. files are owned outputs, not the entire project. */
  inputs?: string[];
  /** Exclusive named resources (ports, generated state or external services). */
  resources?: string[];
  exclusiveContracts?: string[];
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
  /** Final proof recipes for mandatory outcomes, stack choices and constraints. */
  acceptance?: Verification[];
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
  progress?: ProgressMeasurement;
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
  /** Approved documents selected for this project; never the whole remote collection. */
  documents?: SelectedDocument[];
  existing?: ProductBrief;
  repository?: string;
  repositoryConstraints?: { text: string; reference: string }[];
}

export interface SelectedDocument {
  reference: string;
  title?: string;
  text: string;
  localPath?: string;
  kind?: "document" | "reference";
  topics?: string[];
  scope?: "global";
  contentHash?: string;
}

export interface DocumentReference {
  reference: string;
  title?: string;
  localPath?: string;
  topics?: string[];
  scope?: "global";
  contentHash?: string;
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
  references?: DocumentReference[];
}

export type ProductAction = { requiredCapabilities: string[]; description?: string };
