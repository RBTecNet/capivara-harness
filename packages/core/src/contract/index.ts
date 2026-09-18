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
export { extractEntities, extractStoryIds, extractWorkflows } from "./documents.js";
export type { Workflow } from "./documents.js";
export { checkCoverage, checkEntities, checkStories, checkWorkflows } from "./coverage.js";
export type { CoverageSources } from "./coverage.js";
export { renderContractDocument } from "./doc.js";
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
export { canonicalDependsOn, canonicalWorkflowTraces, normalizePhasePart } from "./phase-part.js";
export type { NormalizedPart, PhasePartExpectation } from "./phase-part.js";
export { checkRewriteDrift, parsePhaseFragment } from "./drift.js";
export type { DriftInput } from "./drift.js";
