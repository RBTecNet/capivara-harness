/**
 * A arquitetura e a infraestrutura do produto: o que o `plan` decide antes de
 * escrever qualquer fase.
 *
 * O esqueleto diz O QUE o produto é — stack, entidades, stories, fluxos, regras.
 * Ele não diz COMO o código se organiza para entregar isso: quais componentes
 * existem, o que cada um expõe aos outros, de que infraestrutura o trabalho
 * depende, e em que ordem as fatias são construídas. Enquanto essa decisão não
 * existia em lugar nenhum, cada fase a tomava sozinha — e um executor econômico,
 * lendo só a sua fase, tomava a decisão errada ou pedia uma que ninguém tinha.
 *
 * Então ela é tomada UMA vez, aqui, por quem olha o produto inteiro, e cada
 * fase recebe a sua fatia. O que o loop consome continua sendo o plano de fases;
 * a arquitetura é o acordo entre elas e o raciocínio concentrado que deixa a
 * fase simples o bastante para um modelo barato executar.
 *
 * A divisão de fases do esqueleto é a PROPOSTA do `init`. A arquitetura pode
 * dividir, fundir e reordenar; o que ela não pode é perder cobertura — toda
 * story, entidade e fluxo do esqueleto continua entregue por alguma fase, e isso
 * é verificado em código, não pedido ao modelo.
 *
 * O que NÃO mora aqui, de propósito: testes. Nome de arquivo de teste, suíte,
 * plano de validação — nada disso é arquitetura, e quem decide como provar o
 * produto é o avaliador do build, lendo o código entregue.
 */

import { jsonDaResposta } from "./resposta.js";
import { AREAS_VALIDAS, type Skeleton, type SkeletonPhase } from "./skeleton.js";
import { environmentRequirements, renderEnvironmentRequirements, type EnvironmentRequirement } from "./environment.js";

export const ARCHITECTURE_CONTRACT = "capivara-architecture/v1" as const;

export interface ArchitectureComponent {
  /** O nome pelo qual fases e fluxos o citam. */
  name: string;
  /** O que ele faz, em uma frase. */
  responsibility: string;
  /** Onde ele mexe, da lista fechada de áreas. */
  areas: string[];
  /** Outros componentes de que depende, pelo nome. */
  dependsOn: string[];
  /** O que ele expõe aos outros: uma linha por rota, função, evento, tabela. */
  contracts: string[];
  /** Arquivos ou módulos, quando a arquitetura precisar fixá-los. Vazio é "livre". */
  files: string[];
  /** Entidades do esqueleto que ele persiste ou possui. */
  owns: string[];
}

export interface ArchitectureFlow {
  /** O número do workflow no esqueleto. */
  workflow: string;
  /** Os componentes que o fluxo atravessa, na ordem. */
  components: string[];
  notes: string;
}

/** Uma escolha de infraestrutura, com a autoridade que a sustenta. */
export interface InfrastructureItem {
  name: string;
  /** Vazio quando nenhuma fonte fixou versão: nunca inventada. */
  version: string;
  purpose: string;
  /** De onde a escolha vem: pedido, decisão da entrevista, stack do esqueleto, exigência técnica nomeada. */
  basis: string;
}

export interface InfrastructureDependency extends InfrastructureItem {
  kind: "app" | "dev";
}

export interface InfrastructureService extends InfrastructureItem {
  kind: "external" | "local";
}

export interface Infrastructure {
  runtimes: InfrastructureItem[];
  tools: InfrastructureItem[];
  packageManagers: InfrastructureItem[];
  dependencies: InfrastructureDependency[];
  services: InfrastructureService[];
  databases: InfrastructureItem[];
  /** Requisitos de ambiente e compatibilidade, uma frase cada. */
  compatibility: string[];
  /** O que precisa ser verdade antes de a primeira fase começar. */
  preconditions: string[];
  /** As sondas de prontidão que o build executa antes das fases. */
  requirements: EnvironmentRequirement[];
}

export interface ArchitecturePhase extends SkeletonPhase {
  /** Os componentes que esta fase implementa ou estende. */
  components: string[];
  /** Por que esta fase tem este tamanho e esta posição. */
  rationale: string;
}

export interface Architecture {
  contract: typeof ARCHITECTURE_CONTRACT;
  /** O estilo arquitetural e o raciocínio, em um parágrafo. */
  overview: string;
  components: ArchitectureComponent[];
  /** Decisões de persistência e de modelo que o esqueleto não fixa. */
  dataDecisions: { subject: string; statement: string }[];
  flows: ArchitectureFlow[];
  infrastructure: Infrastructure;
  /** A divisão de fases que vale: pode diferir da proposta do esqueleto. */
  phases: ArchitecturePhase[];
  mvpCutPhase: number;
}

export interface ArchitectureDefect {
  problem: string;
  hint: string;
}

export type ArchitectureResult =
  | { ok: true; architecture: Architecture; /** O que foi consertado contando. */ applied: string[] }
  | { ok: false; defects: ArchitectureDefect[] };

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function list(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.map((item) => (item ?? {}) as Record<string, unknown>) : [];
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item) => text(item)).filter((item) => item !== "") : [];
}

function item(value: Record<string, unknown>): InfrastructureItem {
  return { name: text(value.name), version: text(value.version), purpose: text(value.purpose), basis: text(value.basis) };
}

function canonicalPhaseList(value: string): string {
  const trimmed = value.trim();
  if (trimmed === "" || /^(?:none|nenhuma?|nenhum)$/i.test(trimmed)) return "none";
  const numeros = [...trimmed.matchAll(/(?:phase|fase|p)?\s*0*(\d+)/gi)].map((match) => Number(match[1]));
  if (numeros.length === 0) return "none";
  return [...new Set(numeros)].sort((a, b) => a - b).map((n) => `Phase ${n}`).join(", ");
}

function canonicalCover(value: string): string {
  const trimmed = value.trim();
  const workflow = /^(?:workflow|fluxo|flow|flujo)s?\s*0*(\d+)$/i.exec(trimmed);
  if (workflow) return `workflow ${Number(workflow[1])}`;
  const story = /^us-(\d+)\.(\d+)$/i.exec(trimmed);
  if (story) return `US-${story[1]}.${story[2]}`;
  return trimmed;
}

/** Os números citados em `dependsOn`, na forma canônica. */
function dependencies(dependsOn: string): number[] {
  return [...dependsOn.matchAll(/(?:phase\s*)?0*(\d+)/gi)].map((match) => Number(match[1]));
}

/**
 * Lê a arquitetura, nunca lança, e recusa o que faria uma fase nascer sem acordo.
 *
 * O que se conserta contando é consertado: numeração de fase por posição, forma
 * de `dependsOn`, grafia dos rótulos de cobertura, sondas herdadas do esqueleto
 * quando o arquiteto não as repetiu. O que exige julgamento vira defeito nomeado
 * — e o mais importante deles é cobertura perdida: uma story, entidade ou fluxo
 * do esqueleto que nenhuma fase entrega é funcionalidade que o build nunca
 * construiria, e o esqueleto é a autoridade sobre o que o produto tem.
 */
export function parseArchitecture(
  source: string,
  skeleton: Skeleton,
  limits: { maxTasksPerPhase: number },
): ArchitectureResult {
  let parsed: unknown;
  try {
    parsed = jsonDaResposta(source);
  } catch {
    return {
      ok: false,
      defects: [{ problem: "a resposta não é JSON válido", hint: `devolva um objeto { "contract": "${ARCHITECTURE_CONTRACT}", … } sem cerca de código` }],
    };
  }

  const root = (parsed ?? {}) as Record<string, unknown>;
  if (root.contract !== ARCHITECTURE_CONTRACT) {
    return { ok: false, defects: [{ problem: `contrato ausente ou diferente de ${ARCHITECTURE_CONTRACT}`, hint: `declare "contract": "${ARCHITECTURE_CONTRACT}" na raiz` }] };
  }

  const defects: ArchitectureDefect[] = [];
  const applied: string[] = [];

  const components: ArchitectureComponent[] = list(root.components).map((entry) => ({
    name: text(entry.name),
    responsibility: text(entry.responsibility),
    areas: strings(entry.areas).map((area) => area.toLowerCase()).filter((area) => AREAS_VALIDAS.has(area)),
    dependsOn: strings(entry.dependsOn),
    contracts: strings(entry.contracts),
    files: strings(entry.files),
    owns: strings(entry.owns),
  }));
  if (components.length === 0) {
    defects.push({ problem: "a arquitetura não declara componente nenhum", hint: "nomeie os componentes do código e a responsabilidade de cada um; sem eles as fases não têm onde escrever" });
  }
  const nomes = new Set<string>();
  for (const component of components) {
    if (component.name === "") {
      defects.push({ problem: "há componente sem nome", hint: "todo componente precisa do nome pelo qual as fases o citam" });
      continue;
    }
    const chave = component.name.toLowerCase();
    if (nomes.has(chave)) defects.push({ problem: `o componente ${component.name} aparece duas vezes`, hint: "um componente, um nome; funda as duas entradas" });
    nomes.add(chave);
    if (component.responsibility === "") {
      defects.push({ problem: `o componente ${component.name} não diz a responsabilidade`, hint: "uma frase sobre o que ele faz e o que não faz" });
    }
  }
  const existe = (nome: string): boolean => nomes.has(nome.trim().toLowerCase());
  for (const component of components) {
    for (const dependencia of component.dependsOn) {
      if (!existe(dependencia)) {
        defects.push({ problem: `o componente ${component.name} depende de "${dependencia}", que não existe`, hint: "declare o componente ou corrija o nome" });
      } else if (dependencia.toLowerCase() === component.name.toLowerCase()) {
        defects.push({ problem: `o componente ${component.name} depende de si mesmo`, hint: "remova a dependência" });
      }
    }
  }

  const dataDecisions = list(root.dataDecisions)
    .map((entry) => ({ subject: text(entry.subject), statement: text(entry.statement) }))
    .filter((entry) => entry.statement !== "");

  const flows: ArchitectureFlow[] = list(root.flows)
    .map((entry) => ({
      workflow: text(entry.workflow).replace(/^(?:workflow|fluxo|flow)\s*/i, ""),
      components: strings(entry.components),
      notes: text(entry.notes),
    }))
    .filter((flow) => flow.workflow !== "");
  const fluxosDoEsqueleto = new Set(skeleton.workflows.map((workflow) => workflow.number));
  for (const flow of flows) {
    if (!fluxosDoEsqueleto.has(flow.workflow)) {
      defects.push({ problem: `o fluxo "${flow.workflow}" não existe no esqueleto`, hint: `os fluxos são ${[...fluxosDoEsqueleto].join(", ") || "nenhum"}; a arquitetura não cria fluxo novo` });
    }
    for (const nome of flow.components) {
      if (!existe(nome)) defects.push({ problem: `o fluxo ${flow.workflow} cita o componente "${nome}", que não existe`, hint: "use um nome declarado em components" });
    }
  }
  const mapeados = new Set(flows.map((flow) => flow.workflow));
  for (const workflow of skeleton.workflows) {
    if (!mapeados.has(workflow.number)) {
      defects.push({ problem: `o workflow ${workflow.number} ("${workflow.name}") não foi mapeado a componente nenhum`, hint: "declare em flows quais componentes o fluxo atravessa; um fluxo sem componente é um fluxo que ninguém implementa" });
    }
  }

  const infraBruta = (root.infrastructure ?? {}) as Record<string, unknown>;
  const infrastructure: Infrastructure = {
    runtimes: list(infraBruta.runtimes).map(item),
    tools: list(infraBruta.tools).map(item),
    packageManagers: list(infraBruta.packageManagers).map(item),
    dependencies: list(infraBruta.dependencies).map((entry) => ({ ...item(entry), kind: text(entry.kind).toLowerCase() === "dev" ? "dev" : "app" })),
    services: list(infraBruta.services).map((entry) => ({ ...item(entry), kind: text(entry.kind).toLowerCase() === "local" ? "local" : "external" })),
    databases: list(infraBruta.databases).map(item),
    compatibility: strings(infraBruta.compatibility),
    preconditions: strings(infraBruta.preconditions),
    requirements: [],
  };
  for (const [grupo, itens] of Object.entries({
    runtimes: infrastructure.runtimes,
    tools: infrastructure.tools,
    packageManagers: infrastructure.packageManagers,
    dependencies: infrastructure.dependencies,
    services: infrastructure.services,
    databases: infrastructure.databases,
  })) {
    for (const entrada of itens) {
      if (entrada.name === "") defects.push({ problem: `há item sem nome em infrastructure.${grupo}`, hint: "todo item nomeia a tecnologia" });
      else if (entrada.basis === "") {
        defects.push({ problem: `${entrada.name} (infrastructure.${grupo}) não diz a autoridade da escolha`, hint: "basis cita o pedido, a decisão da entrevista, a stack do esqueleto ou a exigência técnica que o justifica; sem fonte, a escolha é invenção" });
      }
    }
  }
  if (infrastructure.runtimes.length === 0) {
    defects.push({ problem: "a infraestrutura não declara runtime nenhum", hint: "declare ao menos o runtime da stack decidida no esqueleto" });
  }
  if (infraBruta.requirements === undefined) {
    infrastructure.requirements = skeleton.environment.map((requirement) => ({ ...requirement }));
    if (skeleton.environment.length > 0) applied.push("herdou do esqueleto as sondas de prontidão que a arquitetura não repetiu");
  } else {
    try {
      infrastructure.requirements = environmentRequirements(infraBruta.requirements);
    } catch (error) {
      defects.push({ problem: error instanceof Error ? error.message : String(error), hint: "requirements segue o mesmo formato do environment do esqueleto; use [] apenas se não houver pré-requisito externo" });
    }
  }

  const phases: ArchitecturePhase[] = list(root.phases).map((entry, index) => {
    const number = index + 1;
    if (typeof entry.number === "number" && entry.number !== number) applied.push(`renumerou a fase na posição ${number}: veio ${entry.number}`);
    const dependsOn = canonicalPhaseList(text(entry.dependsOn));
    return {
      number,
      title: text(entry.title),
      goal: text(entry.goal),
      dependsOn,
      covers: strings(entry.covers).map(canonicalCover),
      areas: strings(entry.areas).map((area) => area.toLowerCase()).filter((area) => AREAS_VALIDAS.has(area)),
      taskCount: typeof entry.taskCount === "number" ? entry.taskCount : 0,
      components: strings(entry.components),
      rationale: text(entry.rationale),
    };
  });

  if (phases.length === 0) {
    defects.push({ problem: "a arquitetura não declara fase nenhuma", hint: "divida o trabalho em fases: fundação primeiro, cada uma com os componentes que implementa" });
  }
  for (const phase of phases) {
    if (phase.title === "") defects.push({ problem: `a fase ${phase.number} não tem título`, hint: "dê à fase um título que nomeie a fatia entregue" });
    if (phase.goal === "") defects.push({ problem: `a fase ${phase.number} não tem goal`, hint: "declare o resultado observável que a fase entrega" });
    if (phase.covers.length === 0) defects.push({ problem: `a fase ${phase.number} não cobre nada`, hint: "declare as stories, entidades ou workflows que esta fase entrega" });
    if (phase.components.length === 0) defects.push({ problem: `a fase ${phase.number} não cita componente nenhum`, hint: "diga quais componentes a fase implementa ou estende" });
    for (const nome of phase.components) {
      if (!existe(nome)) defects.push({ problem: `a fase ${phase.number} cita o componente "${nome}", que não existe`, hint: "use um nome declarado em components" });
    }
    if (phase.taskCount < 1) defects.push({ problem: `a fase ${phase.number} aloca ${phase.taskCount} tasks`, hint: "toda fase precisa de ao menos uma task" });
    if (phase.taskCount > limits.maxTasksPerPhase) {
      defects.push({ problem: `a fase ${phase.number} aloca ${phase.taskCount} tasks`, hint: `uma fase é uma sessão de agente e comporta até ${limits.maxTasksPerPhase} tasks; divida-a` });
    }
    for (const dependencia of dependencies(phase.dependsOn)) {
      if (dependencia >= phase.number) defects.push({ problem: `a fase ${phase.number} depende da fase ${dependencia}, que não vem antes dela`, hint: "reordene: uma fase só depende do que já foi construído" });
    }
  }

  /*
   * Cobertura preservada. O esqueleto declarou o produto; a arquitetura pode
   * redistribuir, nunca esquecer. Isto é o que torna a reorganização segura.
   */
  const coberto = new Set(phases.flatMap((phase) => phase.covers.map((entry) => entry.toLowerCase())));
  const perdidos = [
    ...skeleton.stories.filter((story) => !coberto.has(story.id.toLowerCase())).map((story) => `story ${story.id}`),
    ...skeleton.entities.filter((entity) => !coberto.has(entity.name.toLowerCase())).map((entity) => `entidade ${entity.name}`),
    ...skeleton.workflows
      .filter((workflow) => !coberto.has(`workflow ${workflow.number}`) && !coberto.has(workflow.number.toLowerCase()))
      .map((workflow) => `workflow ${workflow.number}`),
  ];
  if (perdidos.length > 0) {
    defects.push({
      problem: `a divisão de fases perdeu cobertura: ${perdidos.join(", ")}`,
      hint: "toda story, entidade e fluxo do esqueleto continua no covers de alguma fase; reorganizar é redistribuir, nunca remover",
    });
  }

  const mvpCutPhase = typeof root.mvpCutPhase === "number" && root.mvpCutPhase >= 1 && root.mvpCutPhase <= phases.length ? root.mvpCutPhase : phases.length;

  const architecture: Architecture = {
    contract: ARCHITECTURE_CONTRACT,
    overview: text(root.overview),
    components,
    dataDecisions,
    flows,
    infrastructure,
    phases,
    mvpCutPhase,
  };

  return defects.length > 0 ? { ok: false, defects } : { ok: true, architecture, applied };
}

/** As fases como o esqueleto as carrega: é o que o build e o `change` leem. */
export function phasesFromArchitecture(architecture: Architecture): SkeletonPhase[] {
  return architecture.phases.map((phase) => ({
    number: phase.number,
    title: phase.title,
    goal: phase.goal,
    dependsOn: phase.dependsOn,
    covers: [...phase.covers],
    areas: [...phase.areas],
    taskCount: phase.taskCount,
  }));
}

/** As sondas que o build confere antes das fases: as da arquitetura. */
export function requirementsFromArchitecture(architecture: Architecture): EnvironmentRequirement[] {
  return architecture.infrastructure.requirements.map((requirement) => ({ ...requirement }));
}

function linhaDoItem(entry: InfrastructureItem & { kind?: string }): string {
  const versao = entry.version === "" ? "" : ` ${entry.version}`;
  const tipo = entry.kind ? ` [${entry.kind}]` : "";
  const proposito = entry.purpose === "" ? "" : ` — ${entry.purpose}`;
  return `- ${entry.name}${versao}${tipo}${proposito} (autoridade: ${entry.basis})`;
}

/** A seção de infraestrutura, sozinha: é o que o documento A pede. */
export function renderInfrastructure(infrastructure: Infrastructure): string[] {
  const grupos: [string, (InfrastructureItem & { kind?: string })[]][] = [
    ["Runtimes", infrastructure.runtimes],
    ["Ferramentas de desenvolvimento", infrastructure.tools],
    ["Gerenciadores de pacotes", infrastructure.packageManagers],
    ["Dependências", infrastructure.dependencies],
    ["Serviços", infrastructure.services],
    ["Bancos de dados", infrastructure.databases],
  ];
  const linhas: string[] = [];
  for (const [titulo, itens] of grupos) {
    linhas.push(`### ${titulo}`, ...(itens.length > 0 ? itens.map(linhaDoItem) : ["- nenhum declarado"]), "");
  }
  linhas.push("### Requisitos de ambiente e compatibilidade", ...(infrastructure.compatibility.length > 0 ? infrastructure.compatibility.map((entry) => `- ${entry}`) : ["- nenhum declarado"]), "");
  linhas.push("### Condições para iniciar a implementação", ...(infrastructure.preconditions.length > 0 ? infrastructure.preconditions.map((entry) => `- ${entry}`) : ["- nenhuma além das sondas abaixo"]), "");
  linhas.push(
    "### Sondas de prontidão",
    "O build confere estas sondas uma vez, antes da primeira fase. Nenhuma fase as repete.",
    ...(infrastructure.requirements.length > 0 ? renderEnvironmentRequirements(infrastructure.requirements) : ["- nenhuma: não há pré-requisito externo"]),
  );
  return linhas;
}

/** A arquitetura inteira em markdown: o registro em disco e a leitura do executor. */
export function renderArchitecture(architecture: Architecture, skeleton: Skeleton): string {
  const linhas = [
    `# ${skeleton.projectName} — Arquitetura e infraestrutura`,
    "",
    "## Visão geral",
    architecture.overview === "" ? "(não declarada)" : architecture.overview,
    "",
    "## Componentes",
  ];
  for (const component of architecture.components) {
    linhas.push(`### ${component.name}`, `- responsabilidade: ${component.responsibility}`);
    if (component.areas.length > 0) linhas.push(`- áreas: ${component.areas.join(", ")}`);
    if (component.dependsOn.length > 0) linhas.push(`- depende de: ${component.dependsOn.join(", ")}`);
    if (component.owns.length > 0) linhas.push(`- entidades: ${component.owns.join(", ")}`);
    if (component.files.length > 0) linhas.push(`- arquivos: ${component.files.join(", ")}`);
    if (component.contracts.length > 0) {
      linhas.push("- contratos:");
      for (const contract of component.contracts) linhas.push(`  - ${contract}`);
    }
    linhas.push("");
  }

  if (architecture.dataDecisions.length > 0) {
    linhas.push("## Decisões de dados", ...architecture.dataDecisions.map((entry) => `- ${entry.subject}: ${entry.statement}`), "");
  }

  linhas.push("## Fluxos e componentes");
  for (const flow of architecture.flows) {
    const nome = skeleton.workflows.find((workflow) => workflow.number === flow.workflow)?.name ?? "";
    const notas = flow.notes === "" ? "" : ` — ${flow.notes}`;
    linhas.push(`- workflow ${flow.workflow}${nome ? ` (${nome})` : ""}: ${flow.components.join(" → ")}${notas}`);
  }
  linhas.push("", "## Infraestrutura", ...renderInfrastructure(architecture.infrastructure), "");

  linhas.push("## Fases");
  for (const phase of architecture.phases) {
    linhas.push(
      `- Phase ${phase.number}: ${phase.title} — ${phase.goal} · depende de ${phase.dependsOn} · cobre ${phase.covers.join(", ")} · componentes ${phase.components.join(", ")} · ${phase.taskCount} tasks` +
        (phase.rationale === "" ? "" : ` · ${phase.rationale}`),
    );
  }
  linhas.push("", `MVP fecha na fase ${architecture.mvpCutPhase}.`);

  return `${linhas.join("\n")}\n`;
}

/**
 * A fatia da arquitetura que uma fase precisa ver.
 *
 * Os componentes que ela implementa, inteiros; os de que eles dependem, só o
 * contrato — é o que a fase consome sem reescrever; os fluxos que atravessam
 * os componentes dela; e a infraestrutura, que é curta e vale para todas.
 */
export function architectureSliceForPhase(architecture: Architecture, phaseNumber: number): string {
  const phase = architecture.phases.find((entry) => entry.number === phaseNumber);
  if (!phase) return "";

  const porNome = new Map(architecture.components.map((component) => [component.name.toLowerCase(), component]));
  const proprios = phase.components.map((nome) => porNome.get(nome.toLowerCase())).filter((component): component is ArchitectureComponent => component !== undefined);
  const nomesProprios = new Set(proprios.map((component) => component.name.toLowerCase()));
  const dependencias = [...new Set(proprios.flatMap((component) => component.dependsOn.map((nome) => nome.toLowerCase())))]
    .filter((nome) => !nomesProprios.has(nome))
    .map((nome) => porNome.get(nome))
    .filter((component): component is ArchitectureComponent => component !== undefined);
  const fasesDoComponente = (nome: string): number[] =>
    architecture.phases.filter((entry) => entry.components.some((cada) => cada.toLowerCase() === nome.toLowerCase())).map((entry) => entry.number);

  const linhas = [
    `# Arquitetura — fase ${phase.number}: ${phase.title}`,
    "",
    "## Visão geral",
    architecture.overview === "" ? "(não declarada)" : architecture.overview,
    "",
    "## Componentes desta fase",
  ];
  if (phase.rationale !== "") linhas.push(`Por que esta fase: ${phase.rationale}`, "");
  for (const component of proprios) {
    linhas.push(`### ${component.name}`, `- responsabilidade: ${component.responsibility}`);
    if (component.owns.length > 0) linhas.push(`- entidades: ${component.owns.join(", ")}`);
    if (component.files.length > 0) linhas.push(`- arquivos: ${component.files.join(", ")}`);
    if (component.dependsOn.length > 0) linhas.push(`- depende de: ${component.dependsOn.join(", ")}`);
    if (component.contracts.length > 0) {
      linhas.push("- contratos que esta fase entrega ou estende:");
      for (const contract of component.contracts) linhas.push(`  - ${contract}`);
    }
    linhas.push("");
  }

  if (dependencias.length > 0) {
    linhas.push("## Componentes de que esta fase depende — contratos a consumir, nunca a reescrever");
    for (const component of dependencias) {
      const onde = fasesDoComponente(component.name);
      linhas.push(`### ${component.name}${onde.length > 0 ? ` (fase ${onde.join(", ")})` : ""}`, `- responsabilidade: ${component.responsibility}`);
      if (component.files.length > 0) linhas.push(`- arquivos: ${component.files.join(", ")}`);
      for (const contract of component.contracts) linhas.push(`- ${contract}`);
      linhas.push("");
    }
  }

  const fluxos = architecture.flows.filter((flow) => flow.components.some((nome) => nomesProprios.has(nome.toLowerCase())));
  if (fluxos.length > 0) {
    linhas.push("## Fluxos que atravessam estes componentes");
    for (const flow of fluxos) linhas.push(`- workflow ${flow.workflow}: ${flow.components.join(" → ")}${flow.notes === "" ? "" : ` — ${flow.notes}`}`);
    linhas.push("");
  }

  if (architecture.dataDecisions.length > 0) {
    linhas.push("## Decisões de dados", ...architecture.dataDecisions.map((entry) => `- ${entry.subject}: ${entry.statement}`), "");
  }

  linhas.push("## Infraestrutura", ...renderInfrastructure(architecture.infrastructure));
  return linhas.join("\n");
}
