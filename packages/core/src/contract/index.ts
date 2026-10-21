export { INVARIANTS, PHASES_CONTRACT, invariant } from "./invariants.js";
export { ENVIRONMENT_CONTRACT, PLANNING_CONTRACT, PLANNING_UPGRADE, environmentRequirements } from "./environment.js";
export type { EnvironmentRequirement } from "./environment.js";
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
export { checkTestPrescription, testPrescriptionHint, testPrescriptions, testRunPrescriptions, testToolPrescriptions } from "./test-prescription.js";
export type { TestAuthority } from "./test-prescription.js";
export { mechanismPrescriptionHint, mechanismPrescriptions } from "./mechanism-prescription.js";
export { WRITE_OWNERSHIP_INVARIANT, checkWriteOwnership, effectiveDependencies, projectPaths, writeConflicts, writeIntents, writeOwnershipHint } from "./ownership.js";
export type { WriteConflict, WriteIntent, WriteKind, WriteOwnershipOptions } from "./ownership.js";
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
export { canonicalDependsOn, canonicalWorkflowTraces, phaseDependencies, extractTasks, joinPhaseMetadata, repairInlineCriteria, repairLabelLists, repairMissingBullets, normalizePhasePart, stripLegacyFeatureTests } from "./phase-part.js";
export type { NormalizedPart, PhasePartExpectation } from "./phase-part.js";
export { checkRewriteDrift, parsePhaseFragment, preserveUnaddressedTasks } from "./drift.js";
export { affectedPhases, phaseReferences, planAddresses } from "./phase-references.js";
export { blocoDaDisponibilidade, cobreWorkflow, contradicoesTemporais, disponibilidadeDosFluxos, fasesNomeadas, fechoDosComponentes, tabelaDaDisponibilidade } from "./disponibilidade.js";
export type { Adiamento, ContradicaoTemporal, Disponibilidade, EntradaDaDisponibilidade, FaseNoTempo, Incerteza, MotivoDoAdiamento, Revisita } from "./disponibilidade.js";
export type { DriftInput } from "./drift.js";
export { AREAS_VALIDAS, SKELETON_CONTRACT, coverageFromSkeleton, parseSkeleton, renderSkeleton, repairSkeleton, sliceForPhase, workflowsForPhase } from "./skeleton.js";
export {
  ARCHITECTURE_CONTRACT,
  architectureSliceForPhase,
  architectureViewForPhase,
  checkArchitectureBinding,
  disponibilidadeDaArquitetura,
  entradaTemporal,
  parseArchitecture,
  phasesFromArchitecture,
  renderArchitecture,
  renderInfrastructure,
  requirementsFromArchitecture,
} from "./architecture.js";
export type {
  Architecture,
  ArchitectureBinding,
  ArchitectureComponent,
  ArchitectureDefect,
  ArchitectureFlow,
  ArchitecturePhase,
  ArchitecturePhaseView,
  ArchitectureResult,
  Infrastructure,
  InfrastructureDependency,
  InfrastructureItem,
  InfrastructureService,
} from "./architecture.js";
export type {
  Skeleton,
  SkeletonDefect,
  SkeletonEntity,
  SkeletonField,
  SkeletonLimits,
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
export { desgrudarChaves } from "./protocolo.js";
export { jsonDaResposta } from "./resposta.js";
export {
  DOCUMENTOS_DA_ETAPA,
  OPCOES_DE_ESCOPO,
  SECOES_DO_DIAGNOSTICO,
  UPSTREAM_REPAIR_CONTRACT,
  checkUpstreamPackage,
  escopoDoReparo,
  idDoReparo,
  registrarDecisao,
  secoesFaltando,
  shaDoImpacto,
} from "./upstream.js";
export type { DecisaoDeEscopo, EstadoDoReparoUpstream, EtapaDestino, ImpactoUpstream, PacoteLido, ResultadoDoPacote, UpstreamEvidence, UpstreamManifest } from "./upstream.js";
