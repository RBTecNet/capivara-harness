/**
 * O que uma emenda mudou além do que foi pedido.
 *
 * Instrução de prompt não é garantia. "Mude apenas o que os findings citam"
 * estava escrito e o modelo reescrevia a fase inteira mesmo assim — no piloto 3,
 * um finding sobre número de tasks voltou com contagem de critérios diferente em
 * tasks que ninguém tinha citado.
 *
 * Isto é conferível em código, então é conferido em código: as tasks que nenhum
 * finding nomeia precisam voltar iguais. O que sobrar é deriva, e deriva volta
 * para quem a produziu com o desvio nomeado.
 */

import { parsePhases } from "./phases.js";
import type { PhaseBlock, TaskBlock } from "./phases.js";

/**
 * Lê uma fase solta, cercando-a do mínimo que o parser exige.
 *
 * Só o contrato sabe do que um documento precisa para ser lido, e é aqui que
 * esse conhecimento fica. Montar este envelope em outro módulo seria recriar a
 * gramática fora de casa — exatamente o que o teste de arquitetura impede.
 */
export function parsePhaseFragment(phaseMarkdown: string): PhaseBlock | null {
  const envelope = ["# X — Project Phases", "", "<!-- inputs: a.md@sha256:000000000000 -->", "", phaseMarkdown, ""].join("\n");
  const lido = parsePhases(envelope);
  return lido.ok ? (lido.document.phases[0] ?? null) : null;
}

export interface DriftInput {
  before: readonly TaskBlock[];
  after: readonly TaskBlock[];
  /** Textos dos findings, para saber o que foi legitimamente pedido. */
  findings: readonly { where: string; problem: string; fix: string }[];
}

/** Uma task foi citada quando seu título aparece em algum finding. */
function citada(title: string, findings: DriftInput["findings"]): boolean {
  const alvo = title.toLowerCase();
  return findings.some((finding) => `${finding.where} ${finding.problem} ${finding.fix}`.toLowerCase().includes(alvo));
}

/**
 * Um finding pode pedir mudança estrutural — dividir task, consolidar critério.
 * Quando pede, acrescentar e remover task deixa de ser deriva.
 */
function autorizaEstrutura(findings: DriftInput["findings"]): boolean {
  const texto = findings.map((finding) => `${finding.problem} ${finding.fix}`).join(" ").toLowerCase();
  return /divid|consolid|task|critério|criterio|dimension|fase/.test(texto);
}

export function checkRewriteDrift(input: DriftInput): string[] {
  const desvios: string[] = [];
  const estrutural = autorizaEstrutura(input.findings);

  const antes = new Map(input.before.map((task) => [task.title.trim(), task]));
  const depois = new Map(input.after.map((task) => [task.title.trim(), task]));

  for (const [title, task] of antes) {
    const novo = depois.get(title);
    if (!novo) {
      if (!estrutural && !citada(title, input.findings)) desvios.push(`a task "${title}" desapareceu sem nenhum finding pedir`);
      continue;
    }
    if (citada(title, input.findings)) continue;

    if (novo.acceptanceCriteria.length !== task.acceptanceCriteria.length) {
      desvios.push(
        `a task "${title}" foi de ${task.acceptanceCriteria.length} para ${novo.acceptanceCriteria.length} critérios sem nenhum finding citá-la`,
      );
    }
    if (novo.traces.join(",") !== task.traces.join(",")) {
      desvios.push(`os Traces da task "${title}" mudaram sem nenhum finding citá-la`);
    }
  }

  if (!estrutural) {
    for (const title of depois.keys()) {
      if (!antes.has(title)) desvios.push(`a task "${title}" foi acrescentada sem nenhum finding pedir`);
    }
  }

  return desvios;
}
