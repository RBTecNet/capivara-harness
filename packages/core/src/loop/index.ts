export { resolveTestCommand } from "./testcmd.js";
export type { TestCommand, TestCommandOptions } from "./testcmd.js";
export { materializeSessions, phaseId, splitPhases } from "./split.js";
export type { PhaseSession, SplitResult } from "./split.js";
export { preflight } from "./preflight.js";
export type { PreflightOptions, PreflightResult, PreflightWarning } from "./preflight.js";
export { commitPhase, commitSpecification, hasPendingChanges, isClean, isRepository, treeSignature } from "./git.js";
export type { CommitResult } from "./git.js";
export { DEFAULT_WAIT_SECONDS, RESET_BUFFER_SECONDS, detectRateLimit, planWait } from "./ratelimit.js";
export type { RateLimit, WaitPlan } from "./ratelimit.js";
export { declaredComplete, defaultTestRunner, gate0, gate1, gate2, gate3 } from "./gates.js";
export type { GateName, GateResult, TestRun, TestRunner } from "./gates.js";
export {
  FLOWS_DIR,
  FLOW_CONFIG,
  FLOW_PORT,
  checkFlowScript,
  defaultFlowRunner,
  ehFalhaDoRoteiro,
  existingFlowScripts,
  faltaORunner,
  flowScriptName,
  gate4,
  renderFlowConfig,
} from "./flows.js";
export type { FlowDefect, FlowGateOptions, FlowGateResult, FlowRun, FlowRunner } from "./flows.js";
export { DEFAULT_MAX_CYCLES, DEFAULT_MAX_LIMIT_WAITS, runPhase } from "./runner.js";
export type { EngineCall, EngineCaller, EngineResult, PhaseOutcome, PhaseRunOptions } from "./runner.js";
export { runBuild } from "./build.js";
export type { BuildOptions, BuildOutcome, PhaseReport } from "./build.js";
export {
  checkPrerequisites,
  describeMissing,
  detectPrerequisites,
  readPrerequisiteChoice,
  renderPrerequisiteChoice,
  resolvePrerequisites,
  unverifiedTechnologies,
} from "./prerequisites.js";
export type { Prerequisite, PrerequisiteChoice, PrerequisiteStatus, Resolution } from "./prerequisites.js";
export { deriveAcceptance, defaultRunner, runAcceptance, serviceRunner, startCommandFor } from "./acceptance.js";
export type { AcceptanceOptions, AcceptanceResult, AcceptanceStep, CommandRunner, StepResult } from "./acceptance.js";
export type { BuildProgress, BuildProgressListener, LoopGate, LoopGateState, LoopPhaseState } from "./progress.js";
export { procurarTestesNomeados } from "./feature-tests.js";
export type { FeatureTestSearch } from "./feature-tests.js";
export { lerFasesFechadas, registrarFaseFechada, shaDaFase } from "./ledger.js";
export type { FaseFechada } from "./ledger.js";
export { dependenciasAusentes, descreverDependencias } from "./dependencias.js";
export type { DependenciaAusente } from "./dependencias.js";
export { portaLivre } from "./flows.js";
