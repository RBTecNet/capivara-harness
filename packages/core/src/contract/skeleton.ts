/**
 * O esqueleto do projeto: uma única leitura do produto inteiro.
 *
 * Os quatro documentos em prosa existiam para um leitor. Medido com o
 * desenvolvedor: ele não lê, não avalia documentação, e verifica se a aplicação
 * funciona. O único consumidor real é o loop, e o que ele consome é o plano.
 *
 * Então a prosa sai e o rigor fica. O esqueleto carrega o que os três documentos
 * anteriores carregavam de essencial — stack, entidades, atores, fluxos, stories
 * e as regras transversais — em listas estruturadas de poucos KB, produzido numa
 * chamada só.
 *
 * O ganho não é de bytes, é de raciocínio. Hoje 77% do que o modelo processa em
 * cada uma das ~50 chamadas do plano é reconstrução do contexto do projeto
 * inteiro; ele pensa sobre tudo para escrever uma fase. Com o esqueleto, pensar
 * sobre o produto acontece uma vez, e cada fase recebe a sua fatia.
 *
 * O que NÃO pode sair daqui: as entidades e as regras transversais precisam
 * nascer antes das fases. Se a fase 3 cria `cartoes.titulo` e a fase 7 consulta,
 * as duas precisam ter concordado no nome e na regra antes de existirem — e foi
 * exatamente a ausência desse acordo que produziu os impasses do piloto 3.
 */

import type { CoverageSources } from "./coverage.js";

export const SKELETON_CONTRACT = "capivara-skeleton/v1" as const;

export interface SkeletonStack {
  /** O que o componente é: linguagem, banco, interface, testes. */
  component: string;
  /** A decisão, com versão quando houver. */
  decision: string;
}

export interface SkeletonField {
  name: string;
  /** Tipo e restrições em uma linha, como o implementador precisa ler. */
  type: string;
}

export interface SkeletonEntity {
  name: string;
  fields: SkeletonField[];
  /** Relações com outras entidades, em uma linha cada. */
  relations: string[];
}

export interface SkeletonStory {
  id: string;
  statement: string;
}

export interface SkeletonWorkflow {
  number: string;
  name: string;
  steps: string[];
}

/**
 * Uma regra que atravessa fases.
 *
 * É o lugar que faltava. "O título é gravado aparado nas extremidades e a
 * comparação ignora caixa e acentos" não pertence a nenhuma fase sozinha: se
 * cada uma decidir por conta, elas decidem diferente, e a contradição só aparece
 * quando o loop implementa uma e quebra o teste da outra.
 */
export interface SkeletonRule {
  /** Sobre o que a regra fala: entidade, campo ou comportamento. */
  subject: string;
  /** A regra, com o alvo e o momento nomeados. */
  statement: string;
}

export interface SkeletonPhase {
  number: number;
  title: string;
  goal: string;
  /** `none` ou `Phase N, Phase M`. */
  dependsOn: string;
  /** Stories, entidades e workflows que esta fase entrega. */
  covers: string[];
  taskCount: number;
}

export interface Skeleton {
  contract: typeof SKELETON_CONTRACT;
  projectName: string;
  stack: SkeletonStack[];
  entities: SkeletonEntity[];
  stories: SkeletonStory[];
  workflows: SkeletonWorkflow[];
  rules: SkeletonRule[];
  phases: SkeletonPhase[];
  mvpCutPhase: number;
}

export interface SkeletonDefect {
  problem: string;
  hint: string;
}

export type SkeletonResult = { ok: true; skeleton: Skeleton } | { ok: false; defects: SkeletonDefect[] };

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function list(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.map((item) => (item ?? {}) as Record<string, unknown>) : [];
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item) => text(item)).filter((item) => item !== "") : [];
}

function stripFence(source: string): string {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(source);
  return (fenced?.[1] ?? source).trim();
}

/**
 * Lê o esqueleto, nunca lança, e recusa o que o loop não conseguiria executar.
 *
 * As recusas são as mesmas perguntas do gate, antecipadas: fase sem meta não diz
 * o que entrega, entidade sem campo não dá para criar, dimensionamento fora do
 * teto não cabe numa sessão de agente.
 */
export function parseSkeleton(source: string, limits: { maxTasksPerPhase: number }): SkeletonResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripFence(source));
  } catch {
    return {
      ok: false,
      defects: [{ problem: "a resposta não é JSON válido", hint: `devolva um objeto { "contract": "${SKELETON_CONTRACT}", … } sem cerca de código` }],
    };
  }

  const root = (parsed ?? {}) as Record<string, unknown>;
  if (root.contract !== SKELETON_CONTRACT) {
    return { ok: false, defects: [{ problem: `contrato ausente ou diferente de ${SKELETON_CONTRACT}`, hint: `declare "contract": "${SKELETON_CONTRACT}" na raiz` }] };
  }

  const defects: SkeletonDefect[] = [];

  const stack: SkeletonStack[] = list(root.stack)
    .map((item) => ({ component: text(item.component), decision: text(item.decision) }))
    .filter((item) => item.component !== "" && item.decision !== "");
  if (stack.length === 0) {
    defects.push({ problem: "a stack está vazia", hint: "declare ao menos linguagem e como a aplicação roda; o preflight verifica os pré-requisitos a partir daqui" });
  }

  const entities: SkeletonEntity[] = list(root.entities).map((item) => ({
    name: text(item.name),
    fields: list(item.fields)
      .map((field) => ({ name: text(field.name), type: text(field.type) }))
      .filter((field) => field.name !== ""),
    relations: strings(item.relations),
  }));
  for (const entity of entities) {
    if (entity.name === "") defects.push({ problem: "há entidade sem nome", hint: "toda entidade precisa do nome que o código vai usar" });
    else if (entity.fields.length === 0) {
      defects.push({ problem: `a entidade ${entity.name} não declara campo`, hint: "liste os campos com nome e tipo; sem eles o implementador inventa o modelo" });
    }
  }

  const stories: SkeletonStory[] = list(root.stories)
    .map((item) => ({ id: text(item.id), statement: text(item.statement) }))
    .filter((item) => item.id !== "");

  const workflows: SkeletonWorkflow[] = list(root.workflows)
    .map((item) => ({ number: text(item.number), name: text(item.name), steps: strings(item.steps) }))
    .filter((item) => item.number !== "");

  const rules: SkeletonRule[] = list(root.rules)
    .map((item) => ({ subject: text(item.subject), statement: text(item.statement) }))
    .filter((item) => item.statement !== "");

  const phases: SkeletonPhase[] = list(root.phases).map((item, index) => ({
    number: typeof item.number === "number" ? item.number : index + 1,
    title: text(item.title),
    goal: text(item.goal),
    dependsOn: text(item.dependsOn) || "none",
    covers: strings(item.covers),
    taskCount: typeof item.taskCount === "number" ? item.taskCount : 0,
  }));

  if (phases.length === 0) {
    defects.push({ problem: "o esqueleto não declara fase nenhuma", hint: "divida o produto em fases de topo, fundação primeiro" });
  }

  phases.forEach((phase, index) => {
    if (phase.number !== index + 1) {
      defects.push({ problem: `a fase na posição ${index + 1} declara number ${phase.number}`, hint: "numere as fases de 1 a N, contíguas e em ordem" });
    }
    if (phase.title === "") defects.push({ problem: `a fase ${phase.number} não tem título`, hint: "dê à fase um título que nomeie a fatia entregue" });
    if (phase.goal === "") defects.push({ problem: `a fase ${phase.number} não tem goal`, hint: "declare o resultado observável que a fase entrega" });
    if (phase.covers.length === 0) {
      defects.push({ problem: `a fase ${phase.number} não cobre nada`, hint: "declare as stories, entidades ou workflows que esta fase entrega" });
    }
    if (phase.taskCount > limits.maxTasksPerPhase) {
      defects.push({
        problem: `a fase ${phase.number} aloca ${phase.taskCount} tasks`,
        hint: `uma fase é uma sessão de agente e comporta até ${limits.maxTasksPerPhase} tasks; divida em mais fases de topo`,
      });
    }
  });

  const mvpCutPhase = typeof root.mvpCutPhase === "number" ? root.mvpCutPhase : phases.length;

  const skeleton: Skeleton = {
    contract: SKELETON_CONTRACT,
    projectName: text(root.projectName) || "Projeto",
    stack,
    entities,
    stories,
    workflows,
    rules,
    phases,
    mvpCutPhase,
  };

  return defects.length > 0 ? { ok: false, defects } : { ok: true, skeleton };
}

/**
 * A fatia que uma fase precisa ver.
 *
 * Só o que ela cobre, mais o vocabulário que ela não pode contradizer: as regras
 * transversais vão inteiras, porque é justamente delas que nascem as
 * contradições entre fases.
 */
export function sliceForPhase(skeleton: Skeleton, phaseNumber: number): string {
  const phase = skeleton.phases.find((entry) => entry.number === phaseNumber);
  if (!phase) return "";

  const cobre = new Set(phase.covers.map((item) => item.toLowerCase()));
  const relevante = (nome: string): boolean => cobre.has(nome.toLowerCase());

  const entidades = skeleton.entities.filter((entity) => relevante(entity.name));
  const stories = skeleton.stories.filter((story) => relevante(story.id));
  const workflows = skeleton.workflows.filter((workflow) => relevante(`workflow ${workflow.number}`) || relevante(workflow.number));

  const linhas = [
    `# ${skeleton.projectName} — fase ${phase.number}: ${phase.title}`,
    "",
    `**Goal:** ${phase.goal}`,
    `**Depends on:** ${phase.dependsOn}`,
    `**Covers:** ${phase.covers.join(", ")}`,
    `**Tasks alocadas:** ${phase.taskCount}`,
    "",
    "## Stack",
    ...skeleton.stack.map((item) => `- ${item.component}: ${item.decision}`),
  ];

  if (entidades.length > 0) {
    linhas.push("", "## Entidades desta fase");
    for (const entity of entidades) {
      linhas.push(`- ${entity.name}`);
      for (const field of entity.fields) linhas.push(`  - ${field.name}: ${field.type}`);
      for (const relation of entity.relations) linhas.push(`  - relação: ${relation}`);
    }
  }

  if (stories.length > 0) {
    linhas.push("", "## Stories desta fase");
    for (const story of stories) linhas.push(`- ${story.id}: ${story.statement}`);
  }

  if (workflows.length > 0) {
    linhas.push("", "## Fluxos desta fase");
    for (const workflow of workflows) {
      linhas.push(`- workflow ${workflow.number} — ${workflow.name}`);
      for (const step of workflow.steps) linhas.push(`  - ${step}`);
    }
  }

  if (skeleton.rules.length > 0) {
    linhas.push(
      "",
      "## Regras transversais — valem para todas as fases",
      "Estas não são desta fase: são do produto. Contradizê-las aqui quebra outra fase.",
      ...skeleton.rules.map((rule) => `- ${rule.subject}: ${rule.statement}`),
    );
  }

  return linhas.join("\n");
}

/** O esqueleto inteiro em markdown, para ficar em disco como registro do run. */
export function renderSkeleton(skeleton: Skeleton): string {
  const linhas = [
    `# ${skeleton.projectName} — Skeleton`,
    "",
    "## Stack",
    ...skeleton.stack.map((item) => `- ${item.component}: ${item.decision}`),
    "",
    "## Entidades",
  ];

  for (const entity of skeleton.entities) {
    linhas.push(`### ${entity.name}`);
    for (const field of entity.fields) linhas.push(`- ${field.name}: ${field.type}`);
    for (const relation of entity.relations) linhas.push(`- relação: ${relation}`);
    linhas.push("");
  }

  linhas.push("## Stories", ...skeleton.stories.map((story) => `- ${story.id}: ${story.statement}`), "");
  linhas.push("## Fluxos");
  for (const workflow of skeleton.workflows) {
    linhas.push(`### workflow ${workflow.number} — ${workflow.name}`);
    for (const step of workflow.steps) linhas.push(`- ${step}`);
    linhas.push("");
  }

  linhas.push(
    "## Regras transversais",
    ...skeleton.rules.map((rule) => `- ${rule.subject}: ${rule.statement}`),
    "",
    "## Fases",
    ...skeleton.phases.map(
      (phase) => `- Phase ${phase.number}: ${phase.title} — ${phase.goal} · depende de ${phase.dependsOn} · cobre ${phase.covers.join(", ")} · ${phase.taskCount} tasks`,
    ),
    "",
    `MVP fecha na fase ${skeleton.mvpCutPhase}.`,
  );

  return `${linhas.join("\n")}\n`;
}

/**
 * As fontes de cobertura do esqueleto.
 *
 * Antes elas eram extraídas dos três documentos em prosa — IDs do apêndice de
 * stories, `Table` do DBML, `### N.` dos workflows. O esqueleto declara os três
 * diretamente, então a extração some junto com a prosa, mas a checagem não: é
 * ela que pega a task que não rastreia nada, e foi ela que pegou o piloto 3
 * traduzindo o rótulo `workflow <n>`.
 */
export function coverageFromSkeleton(skeleton: Skeleton): CoverageSources {
  return {
    storyIds: skeleton.stories.map((story) => story.id),
    entities: skeleton.entities.map((entity) => entity.name),
    workflows: skeleton.workflows.map((workflow) => ({ number: workflow.number, name: workflow.name })),
  };
}
