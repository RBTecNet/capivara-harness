/**
 * O envelope da fase: título, goal, dependências, cobertura e áreas (§126).
 *
 * A emenda de uma fase — do escritor ou do auditor que repara — devolve só as
 * TASKS; o harness monta o envelope por cima, e o envelope vem da arquitetura
 * (`phasesFromArchitecture`, aplicada ao esqueleto publicado). Um achado que
 * pede para mudar o goal é, portanto, um achado sobre `architecture.md`, por
 * mais que tenha sido lido em `project-phases.md`.
 *
 * No Parallel Lab com Luna (0.7.0) o auditor apontou o Goal das fases 2 a 5
 * — "a execução automatizada dos testes e dos fluxos cria e destrói o banco
 * descartável…" — dez rodadas seguidas, com razão. Nenhuma emenda podia
 * fechá-lo; o achado foi ao reparo, ao verifier, à arbitragem do
 * desenvolvedor três vezes e ao impasse, e a segunda reorganização da
 * arquitetura, a única saída que alcançava o texto, nunca foi usada: só um
 * `where` que começa com "Architecture" chegava lá.
 *
 * O reconhecimento é pela forma do endereço, e só pela prosa quando o
 * endereço não tem outra coisa que fases (a coerência escreve "Phase 2 vs
 * Phase 3" e fala das "descrições das fases"). Um achado cuja correção pede
 * TASK ou CRITÉRIO ("inclua nesta fase uma tarefa…") é da fase, mesmo citando
 * o goal: o goal promete, e quem entrega é a task. Achado mecânico nunca é do
 * envelope — o harness sabe onde ele está.
 *
 * Na primeira aparição o achado do envelope segue a emenda de sempre: uma vez
 * é defeito (§70), e o reconhecimento por forma pode errar para o lado de uma
 * fase que a emenda conserta. Quando ele VOLTA ao mesmo lugar do envelope, em
 * qualquer redação, é herança: vai à arquitetura, e nunca à arbitragem.
 */

import { phaseReferences } from "../contract/phase-references.js";
import type { Finding } from "./protocol.js";

export type CampoDoEnvelope = "goal" | "title" | "dependsOn" | "covers" | "areas";

/** O campo do envelope que um endereço nomeia, com a fase opcional na frente: "Goal", "Phase 4, Goal", "Phase 3 · Depends on". */
const NO_ENDERECO =
  /^\s*[*`]*(?:(?:phase|fase)\s*\d+\s*[,·:|\-–—]?\s*)?[*`]*(goal|objetivo|t[ií]tulo\s+da\s+fase|descri[cç][aã]o\s+da\s+fase|depends\s+on|depende\s+de|depend[eê]ncias\s+da\s+fase|covers|cobre|cobertura\s+da\s+fase|[aá]reas)(?![\p{L}\p{N}_])/iu;

/** O envelope na prosa de um achado cujo endereço só nomeia fases. */
const NA_PROSA =
  /(?<![\p{L}\p{N}_])(?:goals?|objetivos?\s+(?:(?!tarefas?|tasks?|crit)\S+\s+){0,3}?fases?|descri[cç](?:[aã]o|[oõ]es)\s+(?:(?!tarefas?|tasks?|crit)\S+\s+){0,3}?fases?)(?![\p{L}\p{N}_])/iu;

/** Endereço que nomeia task, critério ou traces: o defeito está nas tasks. */
const DE_TASK = /\bP\d+\.T\d+|(?<![\p{L}\p{N}_])(?:tasks?|tarefas?|crit[eé]rios?|criteria|traces)(?![\p{L}\p{N}_])/iu;

/** A correção que pede task ou critério é trabalho da fase. */
const CORRECAO_DE_TASK = /(?<![\p{L}\p{N}_])(?:tasks?|tarefas?|crit[eé]rios?|criteria)(?![\p{L}\p{N}_])/iu;

/*
 * A correção do auditor que prescrevia teste chega aqui já trocada pela da
 * regra (`semPrescricaoDeTeste`, I-16), e a regra fala em "critério de aceite
 * de uma task" — o que, lido como pedido de trabalho de task, tirava do
 * envelope justamente o Goal do Luna reescrito com a frase entre aspas. O que
 * decide é o que o AUDITOR pediu, citado dentro da troca.
 */
const CORRECAO_TROCADA = /a corre[cç][aã]o que o auditor prop[oô]s — "([\s\S]*)" — prescrevia teste/u;

function correcaoDoAuditor(fix: string): string {
  return CORRECAO_TROCADA.exec(fix)?.[1] ?? fix;
}

const CAMPO: Record<string, CampoDoEnvelope> = {
  goal: "goal",
  objetivo: "goal",
  covers: "covers",
  cobre: "covers",
  areas: "areas",
  "áreas": "areas",
};

/** O campo que o achado aponta, ou `null` quando ele não é do envelope. */
export function campoDoEnvelope(finding: Finding): CampoDoEnvelope | null {
  if (finding.mechanical === true) return null;
  if (CORRECAO_DE_TASK.test(correcaoDoAuditor(finding.fix))) return null;

  const rotulo = NO_ENDERECO.exec(finding.where)?.[1]?.toLowerCase();
  if (rotulo !== undefined) {
    if (/^t[ií]tulo/u.test(rotulo)) return "title";
    if (/^depend/u.test(rotulo)) return "dependsOn";
    if (/^cobertura/u.test(rotulo)) return "covers";
    return CAMPO[rotulo] ?? "goal";
  }

  // Pela prosa, só quando nem o endereço nem o problema apontam task ou critério: "P2.T1.C2 exige… P3.T1.C2 exclui…" é contradição entre tasks.
  const soFases = phaseReferences(finding.where).length > 0 && !DE_TASK.test(finding.where) && !DE_TASK.test(finding.problem);
  return soFases && NA_PROSA.test(finding.problem) ? "goal" : null;
}

/** O achado pede uma mudança que só a arquitetura alcança? */
export function alvoNoEnvelope(finding: Finding): boolean {
  return campoDoEnvelope(finding) !== null;
}

function fasesDoAchado(finding: Finding, totalPhases: number): number[] {
  if (finding.phase !== undefined) return [finding.phase];
  return phaseReferences(finding.where).filter((numero) => numero >= 1 && numero <= totalPhases);
}

/**
 * O endereço do achado no envelope: `P2·goal`, um por fase citada.
 *
 * É a identidade que decide se o ponto VOLTOU, e não o vocabulário: as
 * leituras reais do Goal da fase 2, rodada a rodada, têm Jaccard de 0,24
 * entre si ("Determina que a execução … crie e destrua" × "A instrução de que
 * a execução automatizada cria e destrói … contraria a decisão aceita") — para
 * `mesmoPonto`, dois pontos diferentes. O lugar é que é o mesmo: o goal da
 * fase 2, que nenhuma emenda mudou entre as duas leituras.
 *
 * Quem chama passa a `assinatura` do envelope que está na mesa (o laço de
 * auditoria passa o sha da fase): depois de uma reorganização o goal é outro,
 * e o achado sobre ele volta a ser primeira aparição.
 */
export function chavesDoEnvelope(finding: Finding, totalPhases: number, assinatura?: (fase: number) => string): string[] {
  const campo = campoDoEnvelope(finding);
  if (campo === null) return [];
  const fases = fasesDoAchado(finding, totalPhases);
  const sufixo = (numero: number): string => (assinatura ? `·${assinatura(numero)}` : "");
  return fases.length > 0 ? fases.map((numero) => `P${numero}·${campo}${sufixo(numero)}`) : [`*·${campo}`];
}

/** A marca, no endereço, de um achado que veio do envelope: é por ela que o diagnóstico diz a origem. */
export const MARCA_DO_ENVELOPE = "envelope da fase, escrito por architecture.md";

export function veioDoEnvelope(finding: Finding): boolean {
  return finding.where.includes(MARCA_DO_ENVELOPE);
}

/**
 * O achado, endereçado a quem escreve o envelope.
 *
 * O `where` passa a começar por "Architecture" e a dizer a fase e o campo —
 * `phases[].goal` da Phase 2 —, porque o arquiteto lê a arquitetura inteira e
 * "Goal" sozinho não diz de qual fase. Problema e correção ficam com as
 * palavras do auditor: é a evidência, e é com ela que a próxima leitura é
 * comparada.
 */
export function achadoNaOrigem(finding: Finding, totalPhases: number): Finding {
  const campo = campoDoEnvelope(finding) ?? "goal";
  const fases = fasesDoAchado(finding, totalPhases);
  const onde = fases.length > 0 ? fases.map((numero) => `Phase ${numero}`).join(", ") : "phases";
  return {
    where: `Architecture · ${onde} · ${campo} (${MARCA_DO_ENVELOPE})`,
    problem: finding.problem,
    fix: finding.fix,
    ...(finding.phase !== undefined ? { phase: finding.phase } : {}),
  };
}
