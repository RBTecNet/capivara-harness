/**
 * O ensaio do verificador.
 *
 * O piloto 2 fez quatro fases verdes e parou na quinta contra um critério que
 * exigia "as dependências fixadas declaradas no projeto" de um projeto que,
 * por decisão confirmada, não tem dependência nenhuma. O verificador olhou, não
 * achou, e reprovou uma fase que estava certa. Três ciclos de correção pagos
 * para descobrir que o defeito nascera no plano, não no código.
 *
 * O buraco não era de rigor: era de ordem. Quem decide DONE ou INCOMPLETE só era
 * consultado depois de o código existir, quando corrigir custa um ciclo por
 * descoberta. O ensaio inverte isso — o mesmo papel, com a mesma regra da
 * dúvida, lê o plano antes de qualquer linha ser escrita e responde uma única
 * pergunta por critério: existe alguma implementação capaz de provar isto?
 *
 * Não é auditoria. O auditor julga o documento como prosa — fidelidade,
 * conformidade, executabilidade — e na dúvida aprova, porque reprovar
 * documentação trava o init. O ensaio julga o critério como alvo de observação e
 * não tem opinião sobre redação. São perguntas diferentes, e é por isso que a
 * primeira passou por cima da segunda no piloto 2.
 *
 * A regra da dúvida aqui é estreita de propósito. Dúvida sobre se uma
 * implementação vai satisfazer o critério é trabalho do build, e responde
 * OBSERVABLE. Só bloqueia o que nenhuma implementação resolve: o critério que
 * afirma o que as decisões negam, e o critério que não nomeia observação alguma.
 */

import type { PhasesDocument } from "../contract/index.js";
import { languageBlock } from "./language.js";

export const REHEARSAL_HEADER = "CAPIVARA_REHEARSAL";

export interface CriterionRef {
  /** `P2.T3.C1` — fase, task dentro da fase, critério dentro da task. */
  address: string;
  phase: number;
  task: number;
  index: number;
  phaseTitle: string;
  taskTitle: string;
  text: string;
}

/** Endereça todo critério do plano, na ordem de leitura. */
export function enumerateCriteria(document: PhasesDocument): CriterionRef[] {
  const refs: CriterionRef[] = [];
  for (const phase of document.phases) {
    for (const task of phase.tasks) {
      task.acceptanceCriteria.forEach((text, position) => {
        refs.push({
          address: `P${phase.number}.T${task.index}.C${position + 1}`,
          phase: phase.number,
          task: task.index,
          index: position + 1,
          phaseTitle: phase.title,
          taskTitle: task.title,
          text,
        });
      });
    }
  }
  return refs;
}

export interface RehearsalContext {
  language: string;
  request: string;
  /** Decisões confirmadas na entrevista: a autoridade sobre o que existe. */
  decisions: string[];
  upstream: { name: string; content: string }[];
  criteria: CriterionRef[];
}

export function rehearsalPrompt(context: RehearsalContext): string {
  const criteria = context.criteria
    .map((criterion) => `${criterion.address} [${criterion.phaseTitle} · ${criterion.taskTitle}] ${criterion.text}`)
    .join("\n");

  return [
    languageBlock(context.language),
    "",
    REHEARSAL_HEADER,
    "",
    "You are the independent verifier, called before the build starts. Later, once each phase is",
    "implemented, you will read the real code and declare each task DONE or INCOMPLETE. Right now",
    "there is no code at all: the tree is empty on purpose.",
    "",
    "So you are NOT checking whether anything is implemented. Everything is absent, and absence",
    "proves nothing here. You are answering one question per acceptance criterion:",
    "",
    "   Could ANY correct implementation ever make this criterion provable?",
    "",
    "You are the one who will judge it. A criterion you could never say DONE to is a phase that will",
    "burn every correction cycle and stop the loop with correct code on disk.",
    "",
    "## What you receive",
    "- the developer's original prompt, verbatim",
    "- the confirmed decisions from the interview — the authority on what this project HAS and what",
    "  it deliberately does NOT have",
    "- the upstream documents of the chain",
    "- every acceptance criterion of the plan, addressed",
    "",
    "## Emit exactly one line per criterion, in the order given",
    "",
    "CRITERION <address>: OBSERVABLE — <the observation you would make to decide it>",
    "CRITERION <address>: UNSATISFIABLE — <what it asserts, and which decision says that does not exist>",
    "CRITERION <address>: UNOBSERVABLE — <why no observation could decide it either way>",
    "",
    "Rules:",
    "- <address> is copied verbatim from the list. One line per criterion, no grouping, no reordering.",
    "- Emit no other text: no preamble, no summary, no closing sentence.",
    "- OBSERVABLE is the normal answer. Most criteria are fine.",
    "- UNSATISFIABLE is for a criterion that asserts the PRESENCE of something the confirmed decisions",
    "  say does not exist. A project decided with no external dependencies cannot have them declared in",
    "  its package metadata; looking for them will always fail, and the phase gets rejected for being",
    "  correct. Such a criterion must assert the absence instead. Name the decision that denies it.",
    "- UNOBSERVABLE is for a criterion that names nothing you could look at: clean code, good",
    "  performance, proper structure, adequate coverage. If two honest verifiers could read the same",
    "  code and disagree, the criterion decides nothing.",
    "- Doubt about whether an implementation will SATISFY the criterion is not your problem: that is",
    "  what the build is for. Answer OBSERVABLE.",
    "- Doubt about whether the criterion can be OBSERVED at all is your problem. Say so.",
    "- A criterion that depends on code, files, routes, schemas or tests that do not exist yet is",
    "  OBSERVABLE: that is exactly what the phase is going to create.",
    "",
    "## The developer's prompt",
    context.request,
    "",
    "## Confirmed decisions",
    context.decisions.length > 0 ? context.decisions.map((decision) => `- ${decision}`).join("\n") : "- (none)",
    "",
    ...context.upstream.flatMap((document) => [`## ${document.name}`, document.content, ""]),
    "## The criteria to rehearse",
    criteria,
  ].join("\n");
}

export type CriterionRuling = "OBSERVABLE" | "UNSATISFIABLE" | "UNOBSERVABLE";

export interface CriterionVerdict {
  address: string;
  ruling: CriterionRuling;
  reason: string;
}

/*
 * O endereço, o veredito, e tolerância ao que vier no meio.
 *
 * O prompt lista cada critério como `P2.T1.C1 [fase · task] texto`, e o modelo
 * espelha esse formato na resposta — devolvendo `P2.T1.C1 [fase · task]:
 * OBSERVABLE — …`. A regex antiga exigia o dois-pontos colado ao endereço e
 * reconhecia ZERO linhas de uma resposta perfeita.
 *
 * Isso custou caro e me levou a um diagnóstico errado: no piloto 3 eu concluí
 * que os lotes eram grandes demais e mudei o lote por isso; no piloto 4, 21 de
 * 72 critérios voltaram como "não ensaiados" com o verificador tendo respondido
 * todos. O defeito nunca esteve na resposta — estava em quem a lia.
 */
const CRITERION_LINE = /^CRITERION\s+(P\d+\.T\d+\.C\d+)\b[^:]*:\s*(OBSERVABLE|UNSATISFIABLE|UNOBSERVABLE)\b\s*(?:[—:-]\s*(.*))?$/;

/** Lê as linhas CRITERION, ignorando prosa em volta e indentação acidental. */
export function parseRehearsal(output: string): CriterionVerdict[] {
  const verdicts = new Map<string, CriterionVerdict>();
  for (const rawLine of output.split("\n")) {
    const match = CRITERION_LINE.exec(rawLine.replace(/\r$/, "").trim());
    if (!match) continue;
    const address = match[1] ?? "";
    // Repetição é erro de formatação, não voto duplo: a primeira linha vale.
    if (!verdicts.has(address)) {
      verdicts.set(address, { address, ruling: match[2] as CriterionRuling, reason: (match[3] ?? "").trim() });
    }
  }
  return [...verdicts.values()];
}

export interface RehearsalResult {
  /** Critérios que nenhuma implementação resolve. Bloqueiam o RALPH READY. */
  blocking: { criterion: CriterionRef; ruling: CriterionRuling; reason: string }[];
  /** Critérios que o ensaio não julgou. Silêncio não é aprovação. */
  unrehearsed: CriterionRef[];
}

/**
 * Cruza o veredito com a lista enviada.
 *
 * Critério sem linha não passa por omissão. A assimetria do verificador vale
 * aqui: o preço de bloquear um plano bom é um NOT READY com o endereço na tela;
 * o preço de liberar um plano impossível é o piloto 2 inteiro.
 */
export function assessRehearsal(criteria: CriterionRef[], verdicts: CriterionVerdict[]): RehearsalResult {
  const byAddress = new Map(verdicts.map((verdict) => [verdict.address, verdict]));
  const blocking: RehearsalResult["blocking"] = [];
  const unrehearsed: CriterionRef[] = [];

  for (const criterion of criteria) {
    const verdict = byAddress.get(criterion.address);
    if (verdict === undefined) {
      unrehearsed.push(criterion);
      continue;
    }
    if (verdict.ruling !== "OBSERVABLE") {
      blocking.push({ criterion, ruling: verdict.ruling, reason: verdict.reason });
    }
  }

  return { blocking, unrehearsed };
}
