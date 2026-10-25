/** Identificação das sessões de revisão para atividade e evidência: hoje, o roteirista dos fluxos da aceitação final. */
export const FLOW_REVIEWS = {
  "flow-author": { label: "roteirista dos fluxos" },
} as const;

export type FlowReviewPurpose = keyof typeof FLOW_REVIEWS;
