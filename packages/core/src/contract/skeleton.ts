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

import { testPrescriptionHint, testPrescriptions, testRunPrescriptions, testToolPrescriptions } from "./test-prescription.js";
import type { TestAuthority } from "./test-prescription.js";
import { MECHANISM_INVARIANT, mechanismPrescriptionHint, mechanismPrescriptions } from "./mechanism-prescription.js";
import type { CoverageSources } from "./coverage.js";
import { jsonDaResposta } from "./resposta.js";
import { cobreWorkflow } from "./disponibilidade.js";
import { environmentRequirements, renderEnvironmentRequirements, type EnvironmentRequirement } from "./environment.js";

export const SKELETON_CONTRACT = "capivara-skeleton/v2" as const;

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

/** As áreas que uma fase pode declarar. Fechada dos dois lados, como o §34 pede. */
export const AREAS_VALIDAS: ReadonlySet<string> = new Set(["frontend", "backend", "dados", "infra", "qualidade", "geral"]);

export interface SkeletonPhase {
  number: number;
  title: string;
  goal: string;
  /** `none` ou `Phase N, Phase M`. */
  dependsOn: string;
  /** Stories, entidades e workflows que esta fase entrega. */
  covers: string[];
  /**
   * Onde a fase mexe — `frontend`, `backend`, `dados`, `infra`, `qualidade`.
   *
   * É o que decide quais skills o executor recebe naquela fase. Lista fechada e
   * opcional: esqueleto escrito antes disso existir continua válido, e a fase
   * sem área recebe só as skills gerais.
   */
  areas: string[];
  taskCount: number;
}

export interface Skeleton {
  contract: typeof SKELETON_CONTRACT;
  projectName: string;
  stack: SkeletonStack[];
  /** Sondas de prontidão executadas pelo build antes das fases. Obrigatórias nesta geração. */
  environment: EnvironmentRequirement[];
  entities: SkeletonEntity[];
  stories: SkeletonStory[];
  workflows: SkeletonWorkflow[];
  rules: SkeletonRule[];
  phases: SkeletonPhase[];
  mvpCutPhase: number;
  /**
   * O que ficou de fora por decisão, e não por esquecimento.
   *
   * Vem da entrevista — das omissões que o desenvolvedor recusou —, nunca do
   * escritor. É opcional porque esqueleto escrito antes disto existir continua
   * válido, e porque a maioria dos projetos não terá nenhum.
   */
  nonGoals?: string[];
}

export interface SkeletonDefect {
  problem: string;
  hint: string;
}

export type SkeletonResult =
  | {
      ok: true;
      skeleton: Skeleton;
      /** O que foi consertado contando, para o log. */
      applied: string[];
      /**
       * Os mecanismos sem autoridade que ficaram no esqueleto porque a leitura
       * foi pedida em modo tolerante (I-17, §123): o resíduo depois da escada
       * de recuperação, publicado com ressalva em vez de bloquear o run.
       */
      tolerated: string[];
    }
  | { ok: false; defects: SkeletonDefect[] };

export interface SkeletonLimits {
  maxTasksPerPhase: number;
  /** O que autoriza nomear ferramenta de teste (I-16) ou mecanismo de implementação (I-17): o pedido e as decisões aceitas. */
  authority?: TestAuthority;
  /**
   * `reject` (padrão) devolve o mecanismo sem autoridade como defeito ao
   * escritor; `tolerate` aceita o esqueleto e lista o resíduo em `tolerated`.
   */
  mechanisms?: "reject" | "tolerate";
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function list(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.map((item) => (item ?? {}) as Record<string, unknown>) : [];
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item) => text(item)).filter((item) => item !== "") : [];
}


/**
 * O que o esqueleto tem de errado e se conserta contando, antes de custar uma
 * chamada de correção.
 *
 * Numeração de fase é posição; `dependsOn` tem uma forma canônica; um rótulo
 * de `covers` escrito como "Workflow 1", "fluxo 1" ou "us-1.1" é o mesmo item
 * com outra grafia. Nenhum desses muda o que foi decidido, e cada um custava
 * uma rodada inteira do escritor quando era devolvido como defeito. O que
 * exige julgamento — fase sem meta, cobertura ausente, fase grande demais —
 * continua sendo defeito nomeado.
 */
export function repairSkeleton(root: Record<string, unknown>, authority: TestAuthority = []): { root: Record<string, unknown>; applied: string[] } {
  const applied: string[] = [];
  const phases = Array.isArray(root.phases) ? root.phases.map((item) => ({ ...((item ?? {}) as Record<string, unknown>) })) : [];

  /*
   * A entrada de stack que É sobre testes — "Automação de testes: Vitest e
   * Playwright" — sai inteira: ela não carrega nada além da escolha que não é
   * do esqueleto (I-16). A exigência do pedido de que o produto tenha testes
   * continua nas stories e regras, que é onde ela descreve comportamento. Uma
   * entrada de OUTRO componente que cita ferramenta de teste ("Linguagem:
   * TypeScript, testado com Vitest") não é apagada: perderia a linguagem; ela
   * vira defeito nomeado, abaixo.
   */
  const ROTULO_DE_TESTE = /\b(?:tests?|testes?|testing|qa|qualidade|automa[çc][ãa]o|e2e)\b/iu;
  /*
   * A entrada de stack que É a organização dos arquivos — "Estrutura de
   * pastas: server/nucleo (…); src/modulos/<modulo> (…)" — sai inteira pelo
   * mesmo motivo (I-17, §123): ela não carrega nada além da decisão que é do
   * arquiteto, e o Parallel Lab a recebeu como requisito. Uma entrada de OUTRO
   * componente que cita um caminho ("Interface: React, montada em src/main.tsx")
   * não é apagada: perderia a tecnologia; ela vira defeito nomeado, abaixo.
   */
  const ROTULO_DE_ESTRUTURA = /\b(?:estrutura|organiza[çc][ãa]o|layout|árvore|arvore)\s+(?:de\s+|dos\s+|das\s+)?(?:pastas?|diret[óo]rios?|arquivos?|c[óo]digo|projeto)\b|\b(?:folder|directory|file|project)\s+(?:structure|layout|organi[sz]ation|tree)\b|^(?:pastas|diret[óo]rios|folders|directories)$/iu;
  const stack = Array.isArray(root.stack)
    ? root.stack.filter((item) => {
        const entrada = (item ?? {}) as Record<string, unknown>;
        const component = typeof entrada.component === "string" ? entrada.component : "";
        const decision = typeof entrada.decision === "string" ? entrada.decision : "";
        // Sai a entrada que nomeia ferramenta; a que só descreve o procedimento da execução (§126) fica e vira defeito, abaixo.
        const termos = testToolPrescriptions(`${component}\n${decision}`, authority);
        if (termos.length > 0 && ROTULO_DE_TESTE.test(component)) {
          applied.push(`removeu da stack "${component}: ${decision}": ferramenta de teste é decisão do build (I-16); a exigência de testes do pedido segue nas stories e regras`);
          return false;
        }
        const mecanismos = mechanismPrescriptions(`${component}\n${decision}`, authority);
        if (mecanismos.length > 0 && ROTULO_DE_ESTRUTURA.test(component.trim())) {
          applied.push(`removeu da stack "${component}: ${decision}": a organização dos arquivos é decisão do plano (I-17); a stack pedida continua`);
          return false;
        }
        return true;
      })
    : root.stack;

  // A sonda de prontidão de uma ferramenta de teste tem o mesmo destino.
  const environment = Array.isArray(root.environment)
    ? root.environment.filter((item) => {
        const entrada = (item ?? {}) as Record<string, unknown>;
        const technology = typeof entrada.technology === "string" ? entrada.technology : "";
        const binary = typeof entrada.binary === "string" ? entrada.binary : "";
        const termos = testPrescriptions(`${technology}\n${binary}`, authority);
        if (termos.length === 0) return true;
        applied.push(`removeu do environment a sonda de "${technology}": ferramenta de teste é decisão do build (I-16)`);
        return false;
      })
    : root.environment;

  phases.forEach((phase, index) => {
    if (typeof phase.number === "number" && phase.number !== index + 1) {
      applied.push(`renumerou a fase na posição ${index + 1}: veio ${phase.number}`);
      phase.number = index + 1;
    }
    const dependsOn = typeof phase.dependsOn === "string" ? phase.dependsOn : "";
    const canonico = canonicalPhaseList(dependsOn);
    if (dependsOn.trim() !== canonico) {
      applied.push(`normalizou dependsOn da fase ${index + 1}: "${dependsOn}" → "${canonico}"`);
      phase.dependsOn = canonico;
    }
    if (Array.isArray(phase.covers)) {
      const covers = phase.covers.map((item) => (typeof item === "string" ? canonicalCover(item) : item));
      if (JSON.stringify(covers) !== JSON.stringify(phase.covers)) {
        applied.push(`normalizou os rótulos de covers da fase ${index + 1}`);
        phase.covers = covers;
      }
    }
  });

  return { root: { ...root, ...(Array.isArray(root.phases) ? { phases } : {}), ...(stack === undefined ? {} : { stack }), ...(environment === undefined ? {} : { environment }) }, applied };
}

/** `none` ou `Phase N, Phase M` — a mesma forma que o plano publica. */
function canonicalPhaseList(value: string): string {
  const trimmed = value.trim();
  if (trimmed === "" || /^(?:none|nenhuma?|nenhum)$/i.test(trimmed)) return "none";
  const numeros = [...trimmed.matchAll(/(?:phase|fase|p)?\s*0*(\d+)/gi)].map((match) => Number(match[1]));
  if (numeros.length === 0) return "none";
  return [...new Set(numeros)].sort((a, b) => a - b).map((n) => `Phase ${n}`).join(", ");
}

/** `workflow 1`, `US-1.1` e nomes de entidade na grafia que a cobertura lê. */
function canonicalCover(item: string): string {
  const trimmed = item.trim();
  const workflow = /^(?:workflow|fluxo|flow|flujo)s?\s*0*(\d+)$/i.exec(trimmed);
  if (workflow) return `workflow ${Number(workflow[1])}`;
  const story = /^us-(\d+)\.(\d+)$/i.exec(trimmed);
  if (story) return `US-${story[1]}.${story[2]}`;
  return trimmed;
}

/**
 * Lê o esqueleto, nunca lança, e recusa o que o loop não conseguiria executar.
 *
 * As recusas são as mesmas perguntas do gate, antecipadas: fase sem meta não diz
 * o que entrega, entidade sem campo não dá para criar, dimensionamento fora do
 * teto não cabe numa sessão de agente.
 */
export function parseSkeleton(source: string, limits: SkeletonLimits): SkeletonResult {
  let parsed: unknown;
  try {
    parsed = jsonDaResposta(source);
  } catch {
    return {
      ok: false,
      defects: [{ problem: "a resposta não é JSON válido", hint: `devolva um objeto { "contract": "${SKELETON_CONTRACT}", … } sem cerca de código` }],
    };
  }

  const reparo = repairSkeleton((parsed ?? {}) as Record<string, unknown>, limits.authority ?? []);
  const root = reparo.root;
  if (root.contract !== SKELETON_CONTRACT) {
    return { ok: false, defects: [{ problem: `contrato ausente ou diferente de ${SKELETON_CONTRACT}`, hint: `declare "contract": "${SKELETON_CONTRACT}" na raiz` }] };
  }

  const defects: SkeletonDefect[] = [];
  /*
   * I-17 (§123): o mecanismo de implementação sem autoridade é defeito ao
   * escritor — e, em modo tolerante, resíduo publicado com ressalva. Vai numa
   * lista própria porque o orquestrador decide o destino dela, não o parser.
   */
  const mecanismos: SkeletonDefect[] = [];
  const autoridade = limits.authority ?? [];
  const mecanismoEm = (onde: string, texto: string): void => {
    const termos = mechanismPrescriptions(texto, autoridade);
    if (termos.length === 0) return;
    mecanismos.push({ problem: `${onde} fixa mecanismo de implementação sem autoridade (${MECHANISM_INVARIANT}): ${termos.join(", ")}`, hint: mechanismPrescriptionHint(termos) });
  };
  /*
   * A prescrição de teste se divide em duas (§126). A que nomeia ferramenta,
   * arquivo, trabalho ou estratégia de teste continua sendo defeito que
   * bloqueia (I-16, §118). A que só descreve o PROCEDIMENTO da execução — "os
   * testes definem APP_DB_PATH para um arquivo temporário e o removem ao fim"
   * — é prosa de mecanismo, e segue o destino dele: volta ao escritor
   * nomeada e, depois da escada, é publicada com ressalva. Um run que para no
   * esqueleto por uma frase sobre o banco dos testes é o mesmo "encontrar um
   * motivo para interromper" que a §123 tirou do I-17.
   */
  const testeEm = (onde: string, texto: string, entrada = ""): void => {
    const ferramenta = testToolPrescriptions(texto, autoridade);
    if (ferramenta.length > 0) defects.push({ problem: `${onde} prescreve teste${entrada}: ${ferramenta.join(", ")}`, hint: testPrescriptionHint(ferramenta) });
    const procedimento = testRunPrescriptions(texto, autoridade);
    if (procedimento.length > 0) {
      mecanismos.push({ problem: `${onde} prescreve o procedimento da execução de teste${entrada} (I-16): ${procedimento.join(", ")}`, hint: testPrescriptionHint(procedimento) });
    }
  };

  const stack: SkeletonStack[] = list(root.stack)
    .map((item) => ({ component: text(item.component), decision: text(item.decision) }))
    .filter((item) => item.component !== "" && item.decision !== "");
  if (stack.length === 0) {
    defects.push({ problem: "a stack está vazia", hint: "declare ao menos linguagem e como a aplicação roda; o preflight verifica os pré-requisitos a partir daqui" });
  }
  for (const item of stack) {
    testeEm("a stack", `${item.component}\n${item.decision}`, ` em "${item.component}: ${item.decision}"`);
    mecanismoEm(`a entrada de stack "${item.component}"`, `${item.component}\n${item.decision}`);
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
  for (const story of stories) {
    testeEm(`a story ${story.id}`, story.statement);
    mecanismoEm(`a story ${story.id}`, story.statement);
  }
  for (const workflow of workflows) mecanismoEm(`o workflow ${workflow.number}`, `${workflow.name}\n${workflow.steps.join("\n")}`);
  for (const rule of rules) {
    testeEm(`a regra "${rule.subject}"`, `${rule.subject}\n${rule.statement}`);
    mecanismoEm(`a regra "${rule.subject}"`, rule.statement);
  }

  const phases: SkeletonPhase[] = list(root.phases).map((item, index) => ({
    number: typeof item.number === "number" ? item.number : index + 1,
    title: text(item.title),
    goal: text(item.goal),
    dependsOn: text(item.dependsOn) || "none",
    covers: strings(item.covers),
    // Área fora da lista é descartada em silêncio, não vira campo livre: a
    // seleção de skills depende de os dois lados falarem o mesmo vocabulário.
    areas: strings(item.areas).map((area) => area.trim().toLowerCase()).filter((area) => AREAS_VALIDAS.has(area)),
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
    // A divisão de fases também não aloca trabalho de teste (I-16, §122):
    // "incluir nesta fase os testes do módulo" decide em que fase a suíte é
    // escrita, e isso é do build.
    testeEm(`a fase ${phase.number}`, `${phase.title}\n${phase.goal}`);
    // Nem congela arquitetura (I-17, §123): a fase preliminar é uma entrega
    // funcional; arquivo, contrato e mecanismo de integração são do arquiteto.
    mecanismoEm(`a fase ${phase.number}`, `${phase.title}\n${phase.goal}`);
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

  // Os não-objetivos vêm da entrevista, não do escritor. Aceitos na leitura para
  // que um esqueleto retomado do estado ou de um zip não os perca.
  const nonGoals = strings(root.nonGoals);
  let environment: EnvironmentRequirement[] = [];
  try { environment = environmentRequirements(root.environment); }
  catch (error) { defects.push({ problem: error instanceof Error ? error.message : String(error), hint: "declare environment com sondas de prontidão; use [] apenas se não houver pré-requisito externo" }); }

  const skeleton: Skeleton = {
    contract: SKELETON_CONTRACT,
    projectName: text(root.projectName) || "Projeto",
    stack,
    environment,
    entities,
    stories,
    workflows,
    rules,
    phases,
    mvpCutPhase,
    ...(nonGoals.length > 0 ? { nonGoals } : {}),
  };

  if (defects.length > 0) return { ok: false, defects: [...defects, ...mecanismos] };
  if (mecanismos.length > 0 && limits.mechanisms !== "tolerate") return { ok: false, defects: mecanismos };
  return { ok: true, skeleton, applied: reparo.applied, tolerated: mecanismos.map((defeito) => defeito.problem) };
}

/**
 * A fatia que uma fase precisa ver.
 *
 * Só o que ela cobre, mais o vocabulário que ela não pode contradizer: as regras
 * transversais vão inteiras, porque é justamente delas que nascem as
 * contradições entre fases.
 */
/**
 * Os fluxos que uma fase entrega, do jeito que o esqueleto os declarou.
 *
 * Mora aqui porque é a mesma pergunta que o recorte da fase já fazia, e porque
 * quem a responde de novo por conta própria responde diferente. O gate de fluxos
 * pergunta exatamente isto: o que esta fase precisa fazer funcionar.
 */
export function workflowsForPhase(skeleton: Skeleton, phaseNumber: number): SkeletonWorkflow[] {
  const phase = skeleton.phases.find((entry) => entry.number === phaseNumber);
  if (!phase) return [];
  // A mesma leitura da disponibilidade dos fluxos (§127): duas leituras de `covers` divergiriam na guarda final.
  return skeleton.workflows.filter((workflow) => cobreWorkflow(phase.covers, workflow.number));
}

export function sliceForPhase(skeleton: Skeleton, phaseNumber: number): string {
  const phase = skeleton.phases.find((entry) => entry.number === phaseNumber);
  if (!phase) return "";

  const cobre = new Set(phase.covers.map((item) => item.toLowerCase()));
  const relevante = (nome: string): boolean => cobre.has(nome.toLowerCase());

  const entidades = skeleton.entities.filter((entity) => relevante(entity.name));
  const stories = skeleton.stories.filter((story) => relevante(story.id));
  const workflows = workflowsForPhase(skeleton, phaseNumber);

  const linhas = [
    `# ${skeleton.projectName} — fase ${phase.number}: ${phase.title}`,
    "",
    `**Goal:** ${phase.goal}`,
    `**Depends on:** ${phase.dependsOn}`,
    `**Covers:** ${phase.covers.join(", ")}`,
    ...(phase.areas.length > 0 ? [`**Áreas:** ${phase.areas.join(", ")}`] : []),
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

  linhas.push("", "## Ambiente aprovado antes da construção", ...renderEnvironmentRequirements(skeleton.environment),
    "O build aprova estas sondas uma vez antes do desenvolvimento. Não transformá-las em testes de cada fase.");

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
    "## Ambiente de desenvolvimento", ...renderEnvironmentRequirements(skeleton.environment), "",
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

  /*
   * O que ficou de fora, escrito.
   *
   * Vai depois das fases e antes de mais nada ser derivado daqui: quem lê o
   * esqueleto para implementar precisa ver que a ausência é decisão, e quem
   * escreve as fases precisa não tratá-la como esquecimento a corrigir.
   */
  if (skeleton.nonGoals && skeleton.nonGoals.length > 0) {
    linhas.push("", "## Fora do escopo", ...skeleton.nonGoals.map((item) => `- ${item}`));
  }

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
