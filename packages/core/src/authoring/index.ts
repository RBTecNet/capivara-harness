export { MAX_CRITERIA_PER_PHASE, MAX_CRITERIA_PER_TASK, MAX_TASKS_PER_PHASE } from "./ledger.js";
export { IntervalPartError, assertSinglePhasePart, partId } from "./parts.js";
export {
  DocumentNameError,
  assertDocumentName,
  discardStaging,
  publish,
  readStaged,
  stage,
  stagingRoot,
} from "./staging.js";
export type { StagedDocument } from "./staging.js";
export { classifyDefect, isRepairable, repairDeterministically, stripDeadDesignRefs, stripResolvedMarkers, substanceDefects } from "./repair.js";
export type { DefectClass, DeterministicRepair } from "./repair.js";
