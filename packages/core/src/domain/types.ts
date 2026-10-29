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
export interface ProviderModule {
  protocol: "node" | "python";
  specifier: string;
  runtimeCommand: string[];
}

export interface BindingAuthority {
  schema: "capivara/binding-authority/1";
  original: CapabilityIdentity;
  provider: { authority: "literal"; quote: string };
  kind: { authority: "literal" | "inferred" | "legacy-conservative"; value?: CapabilityIdentity["kind"]; quote?: string };
  capability: { authority: "literal" | "inferred"; quote?: string };
}
export interface BindingTransformation {
  from: CapabilityIdentity;
  to: CapabilityIdentity;
  reason: "inferred-operational-role";
  source: { reference: string; text: string };
}

export interface Source {
  kind: "request" | "answer" | "repository";
  text: string;
  reference: string;
  /** Materialized selected input, available when this literal excerpt needs its original file. */
  localPath?: string;
  /** A malformed model citation was expanded to its unique real source span.
   * Omitted clauses remain in text; this is provenance, never product evidence. */
  citationRecovery?: { strategy:"ordered-literal-paragraphs"; quote:string; spans:{start:number;end:number}[]; includedGaps:{start:number;end:number}[] };
}

export interface Requirement {
  id: string;
  statement: string;
  source: Source;
  mode: ApplicationMode | "shared";
  kind?: "behavior" | "stack" | "interface" | "constraint";
  /** Literal mandatory technology choice, checked against the operational provider. */
  binding?: CapabilityIdentity;
  bindingAuthority?: BindingAuthority;
  bindingTransformations?: BindingTransformation[];
  /** Semantic classification of a mixed literal list; outcomes never imply a chosen tool. */
  technicalClassification?: {
    schema: "capivara/technical-choices/1";
    source: Source;
    providers: { quote: string; binding: CapabilityIdentity }[];
    outcomes: { quote: string; statement: string; requirementId?: string }[];
    /** Superseded generated interpretations stay auditable, never become product evidence. */
    previous?: { requirementId: string; statement: string; source: Source; binding: CapabilityIdentity }[];
  };
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
  /** Retired generated obligations map to active requirement identities; evidence remains immutable. */
  requirementAliases?: Record<string,string>;
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
  /** Engine completion from an exact literal provider name and the real node role; not readiness evidence. */
  identityOrigin?: { kind:"literal-provider-name"; requirementIds:string[]; operationalKind:CapabilityIdentity['kind'] };
  identityTransformations?: { from:CapabilityIdentity; to:CapabilityIdentity; requirementId:string; source:Source; reason:string }[];
  requirementIds?: string[];
  /** Operational bindings made available to consumers after readiness is proven. */
  provides?: { command?: string[]; aliases?: string[]; invocations?: { command: string[]; aliases?: string[] }[]; modules?: ProviderModule[]; env?: Record<string, string>; paths?: string[]; inputs?: string[] };
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

export interface PlanVerificationObligation {
  requirementId:string;
  kind:'provider'|'interface';
  provider?:{provider:string;kind?:CapabilityIdentity['kind'];capability?:string};
  interface?:'cli'|'tui'|'web'|'desktop';
  recipeStatus:'planned'|'pending';
  recipes:{taskId:string;checkId:string}[];
  /** Planning never certifies execution. BUILD still requires current real evidence. */
  verification:'required-in-build';
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
  obligations?:PlanVerificationObligation[];
  /** Durable construction checkpoints; pending prompts retain exact cached-call identity. Removed when ready. */
  planning?: {
    schema: "capivara/plan-progress/1";
    briefRevision: number;
    /** Preserve pre-checkpoint request identity until cached legacy slices are adopted. */
    legacyRequestShape?: boolean;
    groups: {
      requirementIds: string[];
      environmentComplete: boolean;
      outlineComplete: boolean;
      environmentScope: string[];
      environmentPrompt?: string;
      outlinePrompt?: string;
    }[];
  };
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
  /** Original completed answers, for lossless adoption of metadata discarded by an older normalizer. */
  completedResponses?: () => readonly { operation: string; result: string }[];
  /** Read-only lookup of an exact completed call; never authorizes another model invocation. */
  hasCachedCall?: (request: DomainAgentRequest) => boolean;
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
