/** Identificação das sessões de revisão para atividade e evidência. */
export const FLOW_REVIEWS = {
  "flow-author": { label: "roteirista G4" },
  "flow-triage": { label: "triagem G4" },
} as const;

export type FlowReviewPurpose = keyof typeof FLOW_REVIEWS;
