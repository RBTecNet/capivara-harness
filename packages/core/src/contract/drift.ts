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
import { planAddresses } from "./phase-references.js";

/**
 * Lê uma fase solta, cercando-a do mínimo que o parser exige.
 *
 * Só o contrato sabe do que um documento precisa para ser lido, e é aqui que
 * esse conhecimento fica. Montar este envelope em outro módulo seria recriar a
 * gramática fora de casa — exatamente o que o teste de arquitetura impede.
 */
export function parsePhaseFragment(phaseMarkdown: string): PhaseBlock | null {
  /*
   * O documento exige fases numeradas a partir de 1, e uma fase solta é UMA fase:
   * sem isto, só a primeira do plano era legível. Do assistencia2 em diante as
   * duas memórias de tasks — a do auditor no `plan` e a do verificador no `build`
   * — ficaram mudas da fase 2 à 12: nada foi guardado, e task aprovada voltou a
   * ser julgada. A fase é lida como 1 e devolvida com o número dela.
   */
  const numero = /^##\s+Phase\s+(\d+)\s*:/m.exec(phaseMarkdown);
  const original = numero ? Number(numero[1]) : null;
  const dependencia = /\*\*Depends on:\*\*\s*([^·\n]*?)\s*(?:·|$)/m.exec(phaseMarkdown)?.[1]?.trim();
  const comoPrimeira =
    original !== null && original !== 1
      ? phaseMarkdown
          .replace(/^(##\s+Phase\s+)\d+(\s*:)/m, "$11$2")
          .replace(/^(###\s+Phase\s+)(\d+)(\.\d+\s*:)/gm, (whole, prefix: string, major: string, suffix: string) =>
            Number(major) === original ? `${prefix}1${suffix}` : whole)
          // Numa fase solta não há fase anterior a que se referir.
          .replace(/(\*\*Depends on:\*\*\s*)[^·\n]*?(\s*(?:·|$))/m, "$1none$2")
      : phaseMarkdown;
  const envelope = ["# X — Project Phases", "", "<!-- inputs: a.md@sha256:000000000000 -->", "", comoPrimeira, ""].join("\n");
  const lido = parsePhases(envelope);
  const fase = lido.ok ? (lido.document.phases[0] ?? null) : null;
  return fase !== null && original !== null && original !== 1
    ? { ...fase, number: original, subPhases: fase.subPhases.map(section => ({ ...section, phase: original })), ...(dependencia !== undefined ? { dependsOn: dependencia } : {}) }
    : fase;
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

/** Mantém os bytes das tasks que não pertencem a uma emenda endereçada. */
export function preserveUnaddressedTasks(before: string, after: string, phase: number, findings: DriftInput["findings"]): string {
  const targets = new Set<number>();
  const parsed = parsePhaseFragment(before);
  for (const finding of findings) {
    if (/divid|consolid|redistribu|\bsplit\b|\bmerge\b|renumber/i.test(finding.fix)) return after;
    const addresses = planAddresses(finding.where).filter(address => address.phase === phase);
    if (addresses.length === 0) {
      const sections = [...finding.where.matchAll(/\b(?:phase|fase)\s+(\d+)\.(\d+)\b/gi)].filter(match => Number(match[1]) === phase);
      const matched = new Set<number>();
      for (const section of sections) {
        const position = parsed?.subPhases.findIndex(entry => entry.number === Number(section[2])) ?? -1;
        if (!parsed || position < 0) continue;
        const start = parsed.subPhases[position]!.line;
        const end = parsed.subPhases[position + 1]?.line ?? Infinity;
        for (const task of parsed.tasks.filter(task => task.line > start && task.line < end)) matched.add(task.index);
      }
      if (matched.size === 0) return after;
      for (const task of matched) targets.add(task);
    }
    for (const address of addresses) targets.add(address.task);
  }
  if (targets.size === 0) return after;
  const blocks = (source: string): { start: number; end: number; text: string; title: string }[] => {
    const markers = [...source.matchAll(/^- \[[ xX]\] \*\*Task:\*\* (.+)$/gm)];
    return markers.map((marker, index) => {
      const start = marker.index;
      const next = markers[index + 1]?.index ?? source.length;
      const heading = /^#{2,3} /m.exec(source.slice(start, next));
      const end = heading ? start + heading.index : next;
      return { start, end, text: source.slice(start, end), title: marker[1]!.trim() };
    });
  };
  const original = blocks(before);
  const candidate = blocks(after);
  if ([...targets].some(task => task < 1 || task > original.length)) return after;
  let result = before;
  for (let index = original.length - 1; index >= 0; index -= 1) {
    if (!targets.has(index + 1)) continue;
    const block = original[index]!;
    const matching = candidate.filter(entry => entry.title === block.title);
    const correction = original.length === candidate.length ? candidate[index] : matching.length === 1 ? matching[0] : undefined;
    /*
     * A task endereçada sumiu ou mudou de nome numa reescrita que também
     * mudou a contagem: a emenda a reestruturou (apagou a task que era a
     * suíte, fundiu-a noutra), e não há bloco para pôr no lugar dela. Antes
     * isto deixava o bloco ORIGINAL — e a correção pedida era descartada em
     * silêncio: o I-16 voltava a cada rodada sobre a mesma task que o
     * escritor tinha removido (§124). A reescrita inteira vale, como já valia
     * para a divisão pedida; o que se perde é a proteção das vizinhas nesta
     * emenda, que é o menor dos dois males.
     */
    if (!correction) return after;
    result = result.slice(0, block.start) + correction.text + result.slice(block.end);
  }
  return result;
}
