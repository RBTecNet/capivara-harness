/**
 * O gate RALPH READY.
 *
 * Nove itens, todos verdadeiros ou o run termina em NOT READY — retomável e
 * dizendo exatamente o que falta. Nunca "quase pronto": um pacote quase pronto
 * entregue ao loop vira uma aplicação quase feita, descoberta fase a fase, ao
 * preço de uma chamada de modelo por descoberta.
 */

import { checkCoverage, checkDesignRefs, checkStamp, parsePhases } from "../contract/index.js";
import type { ContractError, CoverageSources, StampInput } from "../contract/index.js";

/** Os artefatos que um run do ciclo publica, na ordem em que nascem. */
export const INIT_ARTIFACTS = ["skeleton.md", "project-phases.md"] as const;

export interface ReadinessInput {
  /** O plano executável publicado; vazio significa que não há plano. */
  plan: string;
  /** Inputs do plano executável, para verificar o frescor do stamp. */
  stampInputs: StampInput[];
  coverage: CoverageSources;
  /** O auditor devolveu APPROVED sobre o plano. */
  approved: boolean;
  /** Perguntas materiais ainda não resolvidas. */
  unresolvedQuestions: string[];
  designRoot: string;
  designExists: (path: string) => boolean;
  /**
   * O que o ensaio do verificador reprovou no plano, já formatado. Ausente
   * significa que o ensaio não rodou — e não rodar não aprova nada.
   */
  rehearsal?: { blocked: string[] } | undefined;
}

export interface ReadinessCheck {
  id: string;
  title: string;
  passed: boolean;
  /** O que falta e o que fazer. Vazio quando passou. */
  detail: string;
}

export interface Readiness {
  ready: boolean;
  checks: ReadinessCheck[];
  contractErrors: ContractError[];
}

const NEEDS_DECISION = "[NEEDS DECISION]";

export function evaluateReadiness(input: ReadinessInput): Readiness {
  const checks: ReadinessCheck[] = [];
  let contractErrors: ContractError[] = [];

  const publicado = input.plan.trim() !== "";
  checks.push({
    id: "documentos",
    title: "O plano executável está publicado",
    passed: publicado,
    detail: publicado ? "" : "project-phases.md não foi publicado — rode `capivara plan`",
  });

  const parsed = publicado ? parsePhases(input.plan) : null;

  checks.push({
    id: "contrato",
    title: "O plano executável passa no parser do contrato",
    passed: parsed?.ok === true,
    detail:
      parsed === null
        ? "project-phases.md não foi publicado"
        : parsed.ok
          ? ""
          : parsed.errors.map((error) => `linha ${error.line}: ${error.code} ${error.message} → ${error.hint}`).join("\n"),
  });
  if (parsed && !parsed.ok) contractErrors = parsed.errors;

  const document = parsed?.ok === true ? parsed.document : null;

  const stampErrors = document ? checkStamp(document, input.stampInputs) : [];
  checks.push({
    id: "frescor",
    title: "O stamp do plano cita o esqueleto que ele de fato leu",
    passed: document !== null && stampErrors.length === 0,
    detail: stampErrors.map((error) => `${error.message} → ${error.hint}`).join("\n"),
  });
  contractErrors = [...contractErrors, ...stampErrors];

  const coverageErrors = document ? checkCoverage(document, input.coverage) : [];
  checks.push({
    id: "cobertura",
    title: "Stories, entidades e workflows estão cobertos",
    passed: document !== null && coverageErrors.length === 0,
    detail: coverageErrors.map((error) => `${error.message} → ${error.hint}`).join("\n"),
  });
  contractErrors = [...contractErrors, ...coverageErrors];

  const designErrors = document ? checkDesignRefs(document, input.designRoot, input.designExists) : [];
  checks.push({
    id: "design",
    title: "Toda referência de design aponta para um arquivo existente",
    passed: designErrors.length === 0,
    detail: designErrors.map((error) => `${error.message} → ${error.hint}`).join("\n"),
  });
  contractErrors = [...contractErrors, ...designErrors];

  const comMarcador = input.plan.includes(NEEDS_DECISION);
  checks.push({
    id: "decisoes",
    title: "O plano não carrega decisão pendente",
    passed: !comMarcador,
    detail: comMarcador ? `${NEEDS_DECISION} no plano — resolva na entrevista e reescreva o trecho` : "",
  });

  checks.push({
    id: "auditoria",
    title: "O plano foi aprovado pelo auditor",
    passed: input.approved,
    detail: input.approved ? "" : "o auditor não aprovou o plano",
  });

  /*
   * O ensaio do verificador. O piloto 2 chegou aqui com oito itens verdes e um
   * critério que exigia dependências fixadas de um projeto decidido sem
   * dependência nenhuma: o plano estava aprovado, e era impossível. Quem descobriu
   * foi o loop, três ciclos de correção depois, com o código certo em disco.
   */
  checks.push({
    id: "ensaio",
    title: "Todo critério de aceite sobrevive ao ensaio do verificador",
    passed: input.rehearsal !== undefined && input.rehearsal.blocked.length === 0,
    detail:
      input.rehearsal === undefined
        ? document === null
          ? "não há plano executável para ensaiar"
          : "o ensaio do verificador não rodou sobre o plano; sem ele, critério impossível só aparece no build, ao preço de um ciclo de correção por descoberta"
        : input.rehearsal.blocked.join("\n"),
  });

  checks.push({
    id: "entrevista",
    title: "Nenhuma pergunta material segue em aberto",
    passed: input.unresolvedQuestions.length === 0,
    detail: input.unresolvedQuestions.map((entry) => `- ${entry}`).join("\n"),
  });

  return { ready: checks.every((check) => check.passed), checks, contractErrors };
}

export function renderReadiness(readiness: Readiness): string {
  const lines = [readiness.ready ? "RALPH READY" : "NOT READY", ""];
  for (const check of readiness.checks) {
    lines.push(`${check.passed ? "✓" : "✗"} ${check.title}`);
    if (!check.passed && check.detail) {
      for (const line of check.detail.split("\n")) lines.push(`    ${line}`);
    }
  }
  return lines.join("\n");
}
