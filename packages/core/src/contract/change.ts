/**
 * Uma mudança numa aplicação que já funciona.
 *
 * O `init` desenha um produto do zero; o `change` mexe num que já roda e que
 * alguém já usa. As duas diferenças que mandam em tudo aqui:
 *
 * 1. **O que existe é autoridade.** O esqueleto diz o que foi combinado e o
 *    código diz o que aconteceu. Uma mudança que contradiz o esqueleto sem
 *    dizer que o contradiz produz duas verdades sobre o mesmo produto, e a
 *    seguinte a ler escolhe a errada.
 * 2. **O que já funciona precisa continuar funcionando.** Por isso a mudança
 *    declara o que TOCA, e não só o que acrescenta: é o que permite ao build
 *    saber quais fluxos são regressão.
 *
 * Substituição é por texto exato, nunca por semelhança. Trocar "a cor de
 * destaque é amarela" por "a cor de destaque é azul" exige citar a frase
 * antiga como ela está escrita: se ela não bater, a regra nova é acrescentada e
 * o harness avisa, em vez de apagar em silêncio a linha errada.
 */

import type { Skeleton, SkeletonEntity, SkeletonPhase, SkeletonRule, SkeletonWorkflow } from "./skeleton.js";

export const CHANGE_CONTRACT = "capivara-change/v1" as const;

/** Uma regra que entra, e a que ela substitui quando substitui alguma. */
export interface ChangeRule extends SkeletonRule {
  /** O `statement` EXATO da regra que sai. Vazio significa regra nova. */
  replaces: string;
}

export interface ChangePhase {
  title: string;
  goal: string;
  /** `none` ou `Phase N`. O número da fase nova é do harness, não do modelo. */
  dependsOn: string;
  covers: string[];
  areas: string[];
  taskCount: number;
}

export interface ChangeQuestion {
  id: string;
  topic: string;
  decision: string;
  why: string;
  options: { label: string; consequence: string }[];
  recommended: string;
}

export interface Change {
  contract: typeof CHANGE_CONTRACT;
  /** O que muda, em uma frase, na língua do projeto. */
  summary: string;
  entities: SkeletonEntity[];
  rules: ChangeRule[];
  workflows: SkeletonWorkflow[];
  phases: ChangePhase[];
  /** O que já existe e será alterado — o que o build precisa revalidar. */
  touches: string[];
  /** O que o modelo não consegue decidir sozinho. Zero é o caso comum. */
  questions: ChangeQuestion[];
}

export interface ChangeDefect {
  problem: string;
  hint: string;
}

export type ChangeResult = { ok: true; change: Change } | { ok: false; defects: ChangeDefect[] };

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item) => text(item)).filter((item) => item !== "") : [];
}

function list(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.map((item) => (item ?? {}) as Record<string, unknown>) : [];
}

function stripFence(source: string): string {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(source);
  return (fenced?.[1] ?? source).trim();
}

/** Quantas fases uma mudança pode trazer. Acima disso não é mudança, é projeto. */
export const MAX_FASES_DA_MUDANCA = 3;

export function parseChange(source: string, limits: { maxTasksPerPhase: number }): ChangeResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripFence(source));
  } catch {
    return { ok: false, defects: [{ problem: "a resposta não é JSON válido", hint: `devolva um objeto { "contract": "${CHANGE_CONTRACT}", … } sem cerca de código` }] };
  }

  const root = (parsed ?? {}) as Record<string, unknown>;
  if (root.contract !== CHANGE_CONTRACT) {
    return { ok: false, defects: [{ problem: `contrato ausente ou diferente de ${CHANGE_CONTRACT}`, hint: `declare "contract": "${CHANGE_CONTRACT}" na raiz` }] };
  }

  const defects: ChangeDefect[] = [];

  const phases: ChangePhase[] = list(root.phases)
    .map((item) => ({
      title: text(item.title),
      goal: text(item.goal),
      dependsOn: text(item.dependsOn) || "none",
      covers: strings(item.covers),
      areas: strings(item.areas),
      taskCount: typeof item.taskCount === "number" ? item.taskCount : 0,
    }))
    .filter((phase) => phase.title !== "");

  const questions: ChangeQuestion[] = list(root.questions)
    .map((item) => ({
      id: text(item.id) || "M-01",
      topic: text(item.topic),
      decision: text(item.decision),
      why: text(item.why),
      options: list(item.options)
        .map((option) => ({ label: text(option.label), consequence: text(option.consequence) }))
        .filter((option) => option.label !== ""),
      recommended: text(item.recommended),
    }))
    .filter((question) => question.decision !== "");

  /*
   * Pergunta aberta e fase no mesmo lote seria decidir e perguntar ao mesmo
   * tempo: as fases sairiam da suposição que a pergunta ainda vai desfazer.
   */
  if (questions.length === 0 && phases.length === 0) {
    defects.push({ problem: "nenhuma fase e nenhuma pergunta", hint: "ou a mudança vira ao menos uma fase, ou você precisa perguntar algo antes de planejá-la" });
  }
  if (phases.length > MAX_FASES_DA_MUDANCA) {
    defects.push({
      problem: `${phases.length} fases para uma mudança`,
      hint: `no máximo ${MAX_FASES_DA_MUDANCA}: acima disso não é mudança, é projeto — e projeto se faz com init`,
    });
  }
  for (const phase of phases) {
    if (phase.goal === "") defects.push({ problem: `a fase "${phase.title}" não diz a meta`, hint: "uma frase sobre o que ela entrega" });
    if (phase.taskCount < 1 || phase.taskCount > limits.maxTasksPerPhase) {
      defects.push({
        problem: `a fase "${phase.title}" declara ${phase.taskCount} task(s)`,
        hint: `entre 1 e ${limits.maxTasksPerPhase}; uma fase maior que isso não cabe numa sessão de agente`,
      });
    }
  }

  const change: Change = {
    contract: CHANGE_CONTRACT,
    summary: text(root.summary),
    entities: list(root.entities)
      .map((item) => ({
        name: text(item.name),
        fields: list(item.fields)
          .map((field) => ({ name: text(field.name), type: text(field.type) }))
          .filter((field) => field.name !== ""),
        relations: strings(item.relations),
      }))
      .filter((entity) => entity.name !== ""),
    rules: list(root.rules)
      .map((item) => ({ subject: text(item.subject), statement: text(item.statement), replaces: text(item.replaces) }))
      .filter((rule) => rule.statement !== ""),
    workflows: list(root.workflows)
      .map((item) => ({ number: text(item.number), name: text(item.name), steps: strings(item.steps) }))
      .filter((workflow) => workflow.name !== ""),
    phases,
    touches: strings(root.touches),
    questions,
  };

  return defects.length > 0 ? { ok: false, defects } : { ok: true, change };
}

export interface ChangeApplied {
  skeleton: Skeleton;
  /** O que entrou, em linguagem de gente, para o log e para o relatório. */
  aplicados: string[];
  /** O que não bateu e virou acréscimo em vez de substituição. */
  avisos: string[];
  /** As fases criadas, já numeradas. */
  novas: SkeletonPhase[];
}

/**
 * Funde a mudança no esqueleto.
 *
 * Entidade e fluxo são substituídos por chave — nome e número —, porque é assim
 * que se identificam. Regra é substituída por TEXTO EXATO da que sai: duas
 * regras podem falar do mesmo assunto, e apagar pelo assunto derrubaria a que
 * ninguém mandou mexer.
 */
export function applyChange(skeleton: Skeleton, change: Change): ChangeApplied {
  const aplicados: string[] = [];
  const avisos: string[] = [];

  const entities = [...skeleton.entities];
  for (const nova of change.entities) {
    const posicao = entities.findIndex((entity) => entity.name.toLowerCase() === nova.name.toLowerCase());
    if (posicao >= 0) {
      entities[posicao] = nova;
      aplicados.push(`entidade ${nova.name} atualizada`);
    } else {
      entities.push(nova);
      aplicados.push(`entidade ${nova.name} criada`);
    }
  }

  const rules = [...skeleton.rules];
  for (const regra of change.rules) {
    const nova: SkeletonRule = { subject: regra.subject, statement: regra.statement };
    if (regra.replaces === "") {
      rules.push(nova);
      aplicados.push(`regra nova sobre ${regra.subject}`);
      continue;
    }
    const posicao = rules.findIndex((atual) => atual.statement === regra.replaces);
    if (posicao >= 0) {
      rules[posicao] = nova;
      aplicados.push(`regra sobre ${regra.subject} substituída`);
    } else {
      rules.push(nova);
      avisos.push(`a regra que "${regra.subject}" dizia substituir não foi encontrada com o texto citado; ela entrou como regra nova e a antiga continua lá`);
    }
  }

  const workflows = [...skeleton.workflows];
  let proximoFluxo = workflows.reduce((maior, workflow) => Math.max(maior, Number(workflow.number) || 0), 0);
  for (const fluxo of change.workflows) {
    const posicao = workflows.findIndex((atual) => atual.number === fluxo.number && fluxo.number !== "");
    if (posicao >= 0) {
      workflows[posicao] = fluxo;
      aplicados.push(`fluxo ${fluxo.number} reescrito`);
    } else {
      proximoFluxo += 1;
      workflows.push({ ...fluxo, number: String(proximoFluxo) });
      aplicados.push(`fluxo ${proximoFluxo} — ${fluxo.name} — criado`);
    }
  }

  /*
   * As fases novas vão para o fim, numeradas na sequência. Elas nunca se
   * intercalam: o plano publicado é a ordem em que o build executa, e inserir no
   * meio renumeraria fases que já foram construídas e commitadas.
   */
  let proximaFase = skeleton.phases.reduce((maior, phase) => Math.max(maior, phase.number), 0);
  const novas: SkeletonPhase[] = change.phases.map((phase) => {
    proximaFase += 1;
    return {
      number: proximaFase,
      title: phase.title,
      goal: phase.goal,
      dependsOn: phase.dependsOn,
      covers: phase.covers,
      areas: phase.areas,
      taskCount: phase.taskCount,
    };
  });
  for (const fase of novas) aplicados.push(`fase ${fase.number} — ${fase.title}`);

  return {
    skeleton: {
      ...skeleton,
      entities,
      rules,
      workflows,
      phases: [...skeleton.phases, ...novas],
      // O corte do MVP fica onde estava: a mudança vem depois dele, por definição.
      mvpCutPhase: skeleton.mvpCutPhase,
    },
    aplicados,
    avisos,
    novas,
  };
}
