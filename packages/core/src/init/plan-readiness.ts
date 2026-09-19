/**
 * O gate PLAN READY.
 *
 * Fecha o primeiro estágio do ciclo: o `init` entregou um esqueleto que dá para
 * planejar em cima. Tudo aqui é verificável em código — nenhuma chamada de
 * modelo — porque a pergunta é estrutural: as fases cobrem o produto, cabem numa
 * sessão cada, dependem só do que veio antes, e nada material ficou em aberto.
 *
 * A diferença para o RALPH READY é o que cada um protege. PLAN READY protege o
 * `plan` de detalhar em cima de uma divisão errada; RALPH READY protege o
 * `build` de implementar em cima de um plano inexecutável. Errar o primeiro
 * custa minutos; errar o segundo custa horas.
 */

import type { Skeleton } from "../contract/index.js";

export interface PlanReadinessInput {
  skeleton: Skeleton | null;
  /** Perguntas materiais ainda sem resposta. */
  unresolvedQuestions: string[];
}

export interface PlanCheck {
  id: string;
  title: string;
  passed: boolean;
  /** O que falta e o que fazer. Vazio quando passou. */
  detail: string;
}

export interface PlanReadiness {
  ready: boolean;
  checks: PlanCheck[];
}

/** Os números de fase citados em `Depends on`. */
function dependencies(dependsOn: string): number[] {
  return [...dependsOn.matchAll(/(?:phase\s*)?0*(\d+)/gi)].map((match) => Number(match[1]));
}

export function evaluatePlanReadiness(input: PlanReadinessInput): PlanReadiness {
  const checks: PlanCheck[] = [];
  const skeleton = input.skeleton;

  checks.push({
    id: "esqueleto",
    title: "O esqueleto do projeto foi produzido",
    passed: skeleton !== null,
    detail: skeleton === null ? "nenhum esqueleto publicado — rode o init" : "",
  });

  if (!skeleton) return { ready: false, checks };

  /*
   * Cobertura. O que foi declarado e não é entregue por fase nenhuma não vai
   * existir: o loop constrói fases, e só elas.
   */
  const coberto = new Set(skeleton.phases.flatMap((phase) => phase.covers.map((item) => item.toLowerCase())));
  const descobertos = [
    ...skeleton.stories.filter((story) => !coberto.has(story.id.toLowerCase())).map((story) => `story ${story.id}`),
    ...skeleton.entities.filter((entity) => !coberto.has(entity.name.toLowerCase())).map((entity) => `entidade ${entity.name}`),
    ...skeleton.workflows
      .filter((workflow) => !coberto.has(`workflow ${workflow.number}`.toLowerCase()) && !coberto.has(workflow.number.toLowerCase()))
      .map((workflow) => `workflow ${workflow.number}`),
  ];
  checks.push({
    id: "cobertura",
    title: "Toda story, entidade e fluxo é entregue por alguma fase",
    passed: descobertos.length === 0,
    detail: descobertos.length === 0 ? "" : `sem fase que entregue: ${descobertos.join(", ")} — cite cada um no covers da fase que o constrói`,
  });

  /*
   * Ordem. Uma fase que depende do que vem depois dela não pode ser construída:
   * o loop executa em ordem e não volta atrás.
   */
  const foraDeOrdem: string[] = [];
  skeleton.phases.forEach((phase, index) => {
    if (phase.number !== index + 1) foraDeOrdem.push(`a fase na posição ${index + 1} declara número ${phase.number}`);
    for (const dependencia of dependencies(phase.dependsOn)) {
      if (dependencia >= phase.number) {
        foraDeOrdem.push(`a fase ${phase.number} depende da fase ${dependencia}, que não vem antes dela`);
      }
    }
  });
  checks.push({
    id: "ordem",
    title: "As fases são contíguas e dependem só do que vem antes",
    passed: foraDeOrdem.length === 0,
    detail: foraDeOrdem.join("\n"),
  });

  /*
   * Regras transversais. São o acordo entre fases que nunca se veem — e a
   * ausência delas foi o defeito mais caro que este harness produziu: três fases
   * decidindo diferente sobre o mesmo campo.
   */
  const vagas = skeleton.rules.filter((rule) => rule.subject.trim() === "" || rule.statement.trim().length < 20);
  checks.push({
    id: "regras",
    title: "Toda regra transversal nomeia sobre o que fala",
    passed: vagas.length === 0,
    detail: vagas.map((rule) => `- "${rule.statement || "(vazia)"}" não diz sobre o que é, ou não diz o suficiente`).join("\n"),
  });

  checks.push({
    id: "decisoes",
    title: "Nenhuma decisão material segue em aberto",
    passed: input.unresolvedQuestions.length === 0,
    detail: input.unresolvedQuestions.map((entry) => `- ${entry}`).join("\n"),
  });

  return { ready: checks.every((check) => check.passed), checks };
}

export function renderPlanReadiness(readiness: PlanReadiness): string {
  const lines = [readiness.ready ? "PLAN READY" : "NOT READY", ""];
  for (const check of readiness.checks) {
    lines.push(`${check.passed ? "✓" : "✗"} ${check.title}`);
    if (!check.passed && check.detail) for (const line of check.detail.split("\n")) lines.push(`    ${line}`);
  }
  return lines.join("\n");
}
