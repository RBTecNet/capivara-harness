/**
 * A gramática, em forma de texto para o modelo.
 *
 * O bloco "estrutura obrigatória" que o escritor recebe É o contrato. Se ele
 * fosse escrito à mão num prompt, divergiria do parser na primeira mudança — e
 * a divergência entre o que se pede e o que se valida é exatamente a falha que
 * este produto existe para eliminar. Por isso mora aqui, dentro de `contract/`,
 * e tanto o documento gerado quanto os prompts o consomem daqui.
 */

export const GRAMMAR_BLOCK: readonly string[] = [
  "# <Projeto> — Project Phases",
  "",
  "<!-- inputs: skeleton.md@sha256:abc123abc123 -->",
  "",
  "## Overview",
  "",
  "<estratégia de build, número de fases, linha de corte do MVP>",
  "",
  "**Conventions:**",
  "- `[ ]` pendente · `[x]` concluído",
  "",
  "## Phase 1: <título>",
  "",
  "**Goal:** <resultado observável> · **Depends on:** <none | Phase N> · **Covers:** <stories/entidades/workflows>",
  "",
  "### Phase 1.1: <sub-fase>",
  "",
  "- [ ] **Task:** <o que construir>",
  "  - **Acceptance criteria:**",
  "    - <condição concreta e validável>",
  "  - **Feature tests:** <nome do teste → a regra de negócio que ele afirma>",
  "  - **Design ref:** <caminho sob o diretório de design>",
  "  - **Traces:** US-1.1, users, workflow 2",
  "",
  "## Open Questions",
];

/** O recorte de uma fase, que é o que uma parte do escritor deve emitir. */
export const PHASE_BLOCK: readonly string[] = [
  "## Phase {{PHASE_NUMBER}}: <title>",
  "",
  "**Goal:** <one line> · **Depends on:** <none | Phase N> · **Covers:** <stories/entities/workflows>",
  "",
  "### Phase {{PHASE_NUMBER}}.<M>: <sub-phase name>",
  "",
  "- [ ] **Task:** <what to build>",
  "  - **Acceptance criteria:**",
  "    - <concrete, validatable condition>",
  "  - **Feature tests:** <test name -> the business rule it asserts>",
  "  - **Design ref:** <path under the design directory>",
  "  - **Traces:** <US-N.M / entity / workflow>",
];

/** O marcador do stamp, como é citado para o modelo. Também é do contrato. */
export const STAMP_MARKER = "<!-- inputs: ... -->";

/** Rótulos casados literalmente pelo parser. Traduzi-los invalida o documento. */
export const STRUCTURAL_LABELS: readonly string[] = [
  "## Phase",
  "### Phase",
  "- [ ] **Task:**",
  "**Acceptance criteria:**",
  "**Feature tests:**",
  "**Design ref:**",
  "**Traces:**",
  "**Goal:**",
  "**Depends on:**",
  "**Covers:**",
  "**Conventions:**",
];

export function grammarBlock(): string {
  return GRAMMAR_BLOCK.join("\n");
}

export function phaseBlock(phaseNumber: number): string {
  return PHASE_BLOCK.join("\n").replaceAll("{{PHASE_NUMBER}}", String(phaseNumber));
}

/** O heading exato de uma fase. Citá-lo é conhecimento do contrato. */
export function phaseHeading(phaseNumber: number): string {
  return `## Phase ${phaseNumber}:`;
}

export interface PhasesDocumentParts {
  projectName: string;
  stamp: string;
  overview: string;
  /** O markdown de cada fase, na ordem, como o escritor emitiu. */
  phases: string[];
  openQuestions: string[];
}

/**
 * Monta o documento final EM CÓDIGO.
 *
 * O modelo escreve uma fase por vez; cabeçalho, stamp, overview e as convenções
 * são determinísticos e não passam por ele. Tudo o que é montado em código é
 * uma classe inteira de defeito que o escritor não tem como cometer.
 */
export function assemblePhasesDocument(parts: PhasesDocumentParts): string {
  const lines = [
    `# ${parts.projectName} — Project Phases`,
    "",
    parts.stamp,
    "",
    "## Overview",
    "",
    parts.overview,
    "",
    "**Conventions:**",
    "- `[ ]` pendente · `[x]` concluído",
    "",
  ];
  for (const phase of parts.phases) lines.push(phase.trimEnd(), "");
  if (parts.openQuestions.length > 0) {
    lines.push("## Open Questions", "");
    for (const question of parts.openQuestions) lines.push(`- ${question}`);
    lines.push("");
  }
  return `${lines.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd()}\n`;
}
