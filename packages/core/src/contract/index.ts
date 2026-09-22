export { INVARIANTS, PHASES_CONTRACT, invariant } from "./invariants.js";
export type { Invariant, InvariantChecker, InvariantCode, InvariantEnforcement } from "./invariants.js";
export { checkDesignRefs, parsePhases } from "./phases.js";
export type {
  ContractError,
  InputStamp,
  ParseResult,
  PhaseBlock,
  PhasesDocument,
  SubPhaseBlock,
  TaskBlock,
} from "./phases.js";
export { buildStamp, checkStamp, isStampLine, sha12 } from "./stamps.js";
export type { StampInput } from "./stamps.js";
export type { Workflow } from "./coverage.js";
export { checkCoverage, checkEntities, checkStories, checkWorkflows } from "./coverage.js";
export type { CoverageSources } from "./coverage.js";
export { renderContractDocument } from "./doc.js";
export { TASKS_BLOCK, assemblePhase, tasksBlock } from "./templates.js";
export type { PhaseEnvelope } from "./templates.js";
export {
  GRAMMAR_BLOCK,
  PHASE_BLOCK,
  STAMP_MARKER,
  STRUCTURAL_LABELS,
  assemblePhasesDocument,
  grammarBlock,
  phaseBlock,
  phaseHeading,
} from "./templates.js";
export type { PhasesDocumentParts } from "./templates.js";
export { canonicalDependsOn, canonicalWorkflowTraces, extractTasks, joinPhaseMetadata, repairInlineCriteria, repairLabelLists, repairMissingBullets, normalizePhasePart } from "./phase-part.js";
export type { NormalizedPart, PhasePartExpectation } from "./phase-part.js";
export { checkRewriteDrift, parsePhaseFragment } from "./drift.js";
export { affectedPhases } from "./phase-references.js";
export { featureTestNames } from "./feature-tests.js";
export type { NamedFeatureTest } from "./feature-tests.js";
export type { DriftInput } from "./drift.js";
export { SKELETON_CONTRACT, coverageFromSkeleton, parseSkeleton, renderSkeleton, sliceForPhase, workflowsForPhase } from "./skeleton.js";
export type {
  Skeleton,
  SkeletonDefect,
  SkeletonEntity,
  SkeletonField,
  SkeletonPhase,
  SkeletonResult,
  SkeletonRule,
  SkeletonStack,
  SkeletonStory,
  SkeletonWorkflow,
} from "./skeleton.js";
export { CAMADAS, SURVEY_CONTRACT, parseSurvey } from "./survey.js";
export type {
  Camada,
  Evidencia,
  Survey,
  SurveyDeadCode,
  SurveyDefect,
  SurveyDomain,
  SurveyEntity,
  SurveyFlow,
  SurveyIntegration,
  SurveyQuestion,
  SurveyParseOptions,
  SurveyResult,
  SurveyRule,
} from "./survey.js";
export { renderSurvey, surveyCoverage } from "./survey-render.js";
export type { SurveyCoverage } from "./survey-render.js";
export { CHANGE_CONTRACT, MAX_FASES_DA_MUDANCA, applyChange, parseChange } from "./change.js";
export type { Change, ChangeApplied, ChangeDefect, ChangePhase, ChangeQuestion, ChangeResult, ChangeRule } from "./change.js";
