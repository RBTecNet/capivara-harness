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

import { testPrescriptionHint, testPrescriptions, testToolPrescriptions } from "./test-prescription.js";
import type { TestAuthority } from "./test-prescription.js";
import { jsonDaResposta } from "./resposta.js";
import { sha12 } from "./stamps.js";
import { casaComPadrao, trechosEntreCrases } from "./drift.js";
import { AREAS_VALIDAS, type Skeleton, type SkeletonPhase } from "./skeleton.js";
import { environmentRequirements, renderEnvironmentRequirements, type EnvironmentRequirement } from "./environment.js";
import { contradicoesTemporais, disponibilidadeDosFluxos, fechoDosComponentes, type Disponibilidade, type EntradaDaDisponibilidade } from "./disponibilidade.js";

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
  limits: { maxTasksPerPhase: number; authority?: TestAuthority },
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

  const authority = limits.authority ?? [];
  /*
   * I-16 na arquitetura, nos dois modos da recuperação.
   *
   * O que é LISTA e se separa sem julgamento — um arquivo de teste em `files`,
   * uma ferramenta de teste na infraestrutura — sai contando, com o conserto
   * anunciado. O que é PROSA — um componente cuja responsabilidade é
   * "configurar Vitest e Playwright", uma fase cujo goal é a automação — não
   * tem como ser consertado sem decidir o que o componente passa a ser; isso
   * volta ao arquiteto como defeito nomeado, dentro das tentativas que já tem.
   */
  const components: ArchitectureComponent[] = list(root.components).map((entry) => {
    const name = text(entry.name);
    const files = strings(entry.files);
    const deTeste = files.filter((file) => testPrescriptions(file, authority).length > 0);
    if (deTeste.length > 0) applied.push(`removeu de ${name || "componente sem nome"}.files ${deTeste.map((file) => `"${file}"`).join(", ")}: arquivo de teste é decisão do build (I-16)`);
    return {
      name,
      responsibility: text(entry.responsibility),
      areas: strings(entry.areas).map((area) => area.toLowerCase()).filter((area) => AREAS_VALIDAS.has(area)),
      dependsOn: strings(entry.dependsOn),
      contracts: strings(entry.contracts),
      files: files.filter((file) => !deTeste.includes(file)),
      owns: strings(entry.owns),
    };
  });
  const prosaDeTeste = (rotulo: string, texto: string): void => {
    const termos = testPrescriptions(texto, authority);
    if (termos.length > 0) defects.push({ problem: `${rotulo} prescreve teste: ${termos.join(", ")}`, hint: testPrescriptionHint(termos) });
  };
  prosaDeTeste("o overview", text(root.overview));
  for (const component of components) {
    prosaDeTeste(`o componente ${component.name}`, [component.responsibility, ...component.contracts, ...component.owns].join("\n"));
  }
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
  /*
   * Um arquivo, um dono (§122). `files` é a propriedade declarada: o mesmo
   * caminho em dois componentes é ownership ambíguo — duas fases podem
   * escrevê-lo, e o conflito aparece no build. Sem julgamento semântico: é a
   * única verificação de integração que o contrato prova sozinho.
   */
  const donos = new Map<string, string[]>();
  for (const component of components) {
    for (const file of new Set(component.files.map((entry) => entry.trim()).filter((entry) => entry !== ""))) {
      donos.set(file, [...(donos.get(file) ?? []), component.name]);
    }
  }
  for (const [file, componentes] of donos) {
    if (componentes.length > 1) {
      defects.push({ problem: `o arquivo ${file} pertence a ${componentes.length} componentes (${componentes.join(", ")})`, hint: "um arquivo tem um dono: deixe-o em um componente só, e os outros o consomem pelo contrato" });
    }
  }
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
  for (const decision of dataDecisions) prosaDeTeste(`a decisão de dados "${decision.subject}"`, `${decision.subject}\n${decision.statement}`);

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
  const semFerramentaDeTeste = <T extends InfrastructureItem>(grupo: string, itens: T[]): T[] =>
    itens.filter((entrada) => {
      const texto = `${entrada.name}\n${entrada.purpose}`;
      if (testPrescriptions(texto, authority).length === 0) return true;
      // Só o procedimento da execução (§126) não faz do item uma ferramenta de teste: ele fica, e a frase volta ao arquiteto.
      if (testToolPrescriptions(texto, authority).length === 0) {
        prosaDeTeste(`o item ${entrada.name} de infrastructure.${grupo}`, texto);
        return true;
      }
      applied.push(`removeu ${entrada.name} de infrastructure.${grupo}: ferramenta de teste é decisão do build (I-16)`);
      return false;
    });
  const infrastructure: Infrastructure = {
    runtimes: list(infraBruta.runtimes).map(item),
    tools: semFerramentaDeTeste("tools", list(infraBruta.tools).map(item)),
    packageManagers: list(infraBruta.packageManagers).map(item),
    dependencies: semFerramentaDeTeste("dependencies", list(infraBruta.dependencies).map((entry) => ({ ...item(entry), kind: text(entry.kind).toLowerCase() === "dev" ? "dev" : "app" as const }))),
    services: semFerramentaDeTeste("services", list(infraBruta.services).map((entry) => ({ ...item(entry), kind: text(entry.kind).toLowerCase() === "local" ? "local" : "external" as const }))),
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
  /*
   * Os requisitos de ambiente também são prosa, e eram a única que o I-16 não
   * lia: no Parallel Lab com Luna (§126) o procedimento da execução de teste
   * estava no goal das fases, nos módulos, na decisão de dados — e aqui, onde
   * nada o conferia.
   */
  prosaDeTeste("a infraestrutura (requisitos de ambiente)", [...infrastructure.compatibility, ...infrastructure.preconditions].join("\n"));
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

  /*
   * Duas fases sem ordem entre si que estendem o MESMO componente são
   * serializadas aqui, por dependência — e é tudo o que a propriedade exige.
   *
   * O build executa ao mesmo tempo as fases que não dependem uma da outra, e
   * duas sessões editando os arquivos de um componente ao mesmo tempo é o
   * conflito que o `teste_openrouter3` levou ao impasse: o auditor via o
   * risco, exigia um mecanismo de registro na fundação, o arquiteto não o
   * entregava a contento, e a pergunta ia ao desenvolvedor — que não tem o que
   * decidir ali. A ordem entre as fases já é um campo do contrato (`dependsOn`)
   * e é o que o escalonador lê; a arquitetura não precisa de campo novo nem de
   * mecanismo novo para ficar correta. Fica menos paralela, e paralelismo é
   * otimização, não exigência.
   *
   * O arquiteto continua com as três saídas: ponto de extensão na fundação e
   * cada módulo só nos seus componentes (paralelo); uma fase de integração que
   * depende dos módulos e é a única a tocar o compartilhado (paralelo); ou
   * declarar o componente compartilhado nas fases que o editam e aceitar a
   * ordem (serial). As três passam; a escolha é dele.
   */
  const dependenciasDe = new Map(phases.map((phase) => [phase.number, dependencies(phase.dependsOn).filter((n) => n < phase.number)]));
  const alcanca = (de: number, ate: number): boolean => {
    const visitadas = new Set<number>();
    const pilha = [...(dependenciasDe.get(de) ?? [])];
    while (pilha.length > 0) {
      const numero = pilha.pop()!;
      if (numero === ate) return true;
      if (visitadas.has(numero)) continue;
      visitadas.add(numero);
      pilha.push(...(dependenciasDe.get(numero) ?? []));
    }
    return false;
  };
  for (const posterior of phases) {
    for (const anterior of phases) {
      if (anterior.number >= posterior.number || alcanca(posterior.number, anterior.number)) continue;
      const compartilhados = posterior.components.filter((nome) => anterior.components.some((outro) => outro.toLowerCase() === nome.toLowerCase()));
      if (compartilhados.length === 0) continue;
      dependenciasDe.get(posterior.number)!.push(anterior.number);
      posterior.dependsOn = canonicalPhaseList(`${posterior.dependsOn}, Phase ${anterior.number}`);
      applied.push(
        `serializou a fase ${posterior.number} depois da fase ${anterior.number}: as duas estendem ${compartilhados.map((nome) => `"${nome}"`).join(", ")} sem dependência entre si,` +
          " e rodar ao mesmo tempo editaria os mesmos arquivos; a ordem é expressa em dependsOn, que é o que o build lê",
      );
    }
  }
  for (const phase of phases) {
    prosaDeTeste(`a fase ${phase.number}`, [phase.title, phase.goal, phase.rationale].join("\n"));
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

  /*
   * E o tempo da cobertura (§127): o build percorre o workflow pela aplicação
   * de pé ao fim da primeira fase que o cobre. A cobertura que existe mas
   * chega antes do caminho, ou o adiamento para uma fase que não espera, é
   * contradição que só a arquitetura — dona de covers, dependsOn e
   * componentes — corrige, e que até aqui só aparecia no build.
   */
  defects.push(...contradicoesTemporais(entradaTemporal({ components, flows, phases }, skeleton)));

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
/**
 * A arquitetura como entrada da disponibilidade dos fluxos (§127): o texto de
 * cada fase é o envelope que ela publica (título e goal), e o caminho de cada
 * workflow são os componentes que ele atravessa com tudo de que eles dependem.
 */
export function entradaTemporal(
  architecture: Pick<Architecture, "components" | "flows" | "phases">,
  skeleton: Pick<Skeleton, "workflows">,
): EntradaDaDisponibilidade {
  const caminhos = new Map<string, string[]>();
  for (const flow of architecture.flows) {
    const anteriores = caminhos.get(flow.workflow) ?? [];
    caminhos.set(flow.workflow, [...new Set([...anteriores, ...fechoDosComponentes(architecture.components, flow.components)])]);
  }
  return {
    fases: architecture.phases.map((phase) => ({
      number: phase.number,
      dependsOn: phase.dependsOn,
      covers: phase.covers,
      texto: `${phase.title}\n${phase.goal}`,
      componentes: phase.components,
    })),
    workflows: skeleton.workflows.map((workflow) => workflow.number),
    caminhos,
  };
}

/** Quando cada workflow é cobrado, pela arquitetura aprovada (§127). */
export function disponibilidadeDaArquitetura(architecture: Architecture, skeleton: Pick<Skeleton, "workflows">): Disponibilidade {
  return disponibilidadeDosFluxos(entradaTemporal(architecture, skeleton));
}

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
 * O que uma fase recebe da arquitetura, ainda como dado.
 *
 * É a mesma escolha que a fatia em markdown sempre fez — os componentes que a
 * fase implementa, as dependências diretas deles (só o contrato), os fluxos que
 * os atravessam —, exposta para quem precisa decidir com ela e não só ler: o
 * build usa os componentes e os arquivos para dizer o que uma mudança atinge
 * sem montar um segundo grafo.
 */
export interface ArchitecturePhaseView {
  phase: ArchitecturePhase;
  /** Os componentes que a fase implementa ou estende, na ordem do plano. */
  own: ArchitectureComponent[];
  /** As dependências diretas dos próprios: contratos a consumir, nunca a reescrever. */
  consumed: ArchitectureComponent[];
  /** Os fluxos que atravessam algum componente próprio. */
  flows: ArchitectureFlow[];
}

export function architectureViewForPhase(architecture: Architecture, phaseNumber: number): ArchitecturePhaseView | null {
  const phase = architecture.phases.find((entry) => entry.number === phaseNumber);
  if (!phase) return null;

  const porNome = new Map(architecture.components.map((component) => [component.name.toLowerCase(), component]));
  const own = phase.components.map((nome) => porNome.get(nome.toLowerCase())).filter((component): component is ArchitectureComponent => component !== undefined);
  const nomesProprios = new Set(own.map((component) => component.name.toLowerCase()));
  const consumed = [...new Set(own.flatMap((component) => component.dependsOn.map((nome) => nome.toLowerCase())))]
    .filter((nome) => !nomesProprios.has(nome))
    .map((nome) => porNome.get(nome))
    .filter((component): component is ArchitectureComponent => component !== undefined);
  const flows = architecture.flows.filter((flow) => flow.components.some((nome) => nomesProprios.has(nome.toLowerCase())));
  return { phase, own, consumed, flows };
}

/**
 * A fatia da arquitetura que uma fase precisa ver.
 *
 * Os componentes que ela implementa, inteiros; os de que eles dependem, só o
 * contrato — é o que a fase consome sem reescrever; os fluxos que atravessam
 * os componentes dela; e a infraestrutura, que é curta e vale para todas.
 *
 * O texto é chave de cache do `plan` (a fatia entra no prompt de quem escreve
 * a fase): ele sai de `architectureViewForPhase` sem mudar um byte.
 */
export function architectureSliceForPhase(architecture: Architecture, phaseNumber: number): string {
  const view = architectureViewForPhase(architecture, phaseNumber);
  if (!view) return "";
  const { phase, own: proprios, consumed: dependencias, flows: fluxos } = view;
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

/**
 * As fases que uma reorganização não tocou (§128): o mesmo número e o mesmo
 * envelope — título, goal, dependências, cobertura, áreas, tamanho e
 * componentes —, cada componente com a mesma definição, os mesmos fluxos
 * atravessando-os, as mesmas decisões de dados e a mesma infraestrutura, e
 * nenhum trecho que a fase cita sumiu da fatia dela.
 *
 * O prompt promete ao arquiteto e aos auditores que "a fase cujo envelope não
 * muda mantém o que já foi escrito", e a escrita cumpria outra coisa: o cache é
 * o prompt inteiro, e a fatia de toda fase leva a visão geral e os contratos
 * das dependências. No Parallel Lab a reorganização mudou o goal das fases 1 e
 * 2 e o contrato do `web-shell`; as fases 3, 4 e 5 — mesmo envelope, mesmos
 * componentes — foram reescritas do zero, a 4 e a 5 já aprovadas, e a 3 voltou
 * pedindo uma confirmação para alterar o status que ninguém pediu.
 *
 * O que muda fora disto — a justificativa, a visão geral, a redação de um
 * contrato consumido — não reescreve a fase: a auditoria a relê contra a fatia
 * nova, e o que não servir mais volta como emenda. Decisão de dados e
 * infraestrutura valem para todas as fases, e a mudança delas não deixa
 * nenhuma intacta; um caminho, rota ou variável que saiu da fatia e que a
 * fase ainda cita (a revisão da primeira versão mostrou o status trocado
 * na decisão de dados publicado com os valores antigos) também não.
 * `textos[n - 1]` é a fase n como está; sem ele, só a estrutura conta.
 */
export function fasesIntactas(antes: Architecture, depois: Architecture, textos: readonly string[] = []): number[] {
  if (JSON.stringify(antes.dataDecisions) !== JSON.stringify(depois.dataDecisions)) return [];
  if (JSON.stringify(antes.infrastructure) !== JSON.stringify(depois.infrastructure)) return [];
  const envelope = (fase: ArchitecturePhase): string =>
    JSON.stringify([fase.title, fase.goal, fase.dependsOn, fase.covers, fase.areas, fase.taskCount, fase.components]);
  const componente = (arquitetura: Architecture, nome: string): ArchitectureComponent | null =>
    arquitetura.components.find((entrada) => entrada.name.toLowerCase() === nome.toLowerCase()) ?? null;
  const fluxos = (arquitetura: Architecture, nomes: ReadonlySet<string>): ArchitectureFlow[] =>
    arquitetura.flows.filter((fluxo) => fluxo.components.some((nome) => nomes.has(nome.toLowerCase())));
  /** Os nomes que localizam alguma coisa: caminho, rota, arquivo, variável, padrão. */
  const nomes = (texto: string): Set<string> =>
    new Set([...texto.matchAll(/[^\s`'"(),;]+/g)].map((match) => match[0].replace(/[.:]+$/u, "")).filter((nome) => nome.length >= 5 && /[/._*]/.test(nome)));
  return depois.phases
    .filter((fase) => {
      const anterior = antes.phases.find((entrada) => entrada.number === fase.number);
      if (!anterior || envelope(anterior) !== envelope(fase)) return false;
      if (fase.components.some((nome) => {
        const deAntes = componente(antes, nome);
        return deAntes === null || JSON.stringify(deAntes) !== JSON.stringify(componente(depois, nome));
      })) return false;
      const proprios = new Set(fase.components.map((nome) => nome.toLowerCase()));
      if (JSON.stringify(fluxos(antes, proprios)) !== JSON.stringify(fluxos(depois, proprios))) return false;
      const texto = textos[fase.number - 1];
      if (texto === undefined) return true;
      const agora = nomes(architectureSliceForPhase(depois, fase.number));
      const sairam = [...nomes(architectureSliceForPhase(antes, fase.number))].filter((nome) => !agora.has(nome));
      const citados = trechosEntreCrases(texto);
      return !citados.some((citado) => sairam.some((nome) => casaComPadrao(citado, nome) || casaComPadrao(nome, citado)));
    })
    .map((fase) => fase.number);
}

/** O que o build pode afirmar sobre a arquitetura que o `plan` publicou. */
export interface ArchitectureBinding {
  /** Impedem o build antes de qualquer sessão de agente. */
  errors: string[];
  /** Ditos ao operador; a fase afetada segue sem fatia, e quem a executa lê `architecture.md` inteiro. */
  warnings: string[];
  /** As fases do plano cuja fatia vem de uma arquitetura comprovadamente igual à publicada. */
  bound: number[];
}

/**
 * O vínculo entre a arquitetura estruturada e os documentos publicados.
 *
 * A fatia que vai ao executor sai da forma estruturada guardada pelo `plan`; o
 * que foi aprovado é o `architecture.md` carimbado no `environment.json`. As
 * duas coisas só servem juntas se forem a mesma: a estruturada é renderizada
 * de novo e comparada byte a byte com a publicada. Diverge, e nenhuma fatia sai
 * dela — uma fatia de arquitetura que ninguém aprovou é pior que fatia nenhuma.
 *
 * O documento publicado divergir do carimbo é outra coisa: alguém alterou o
 * plano aprovado. Isso é erro, antes de qualquer sessão, e sem conversão.
 */
export function checkArchitectureBinding(input: {
  architecture: Architecture | null;
  /** O `architecture.md` em disco; null quando não existe. */
  published: string | null;
  /** `architectureSha12` do `environment.json`; null quando o plan não o gravou. */
  declaredSha12: string | null;
  /** O esqueleto publicado: a renderização usa o nome do produto e o dos fluxos. */
  skeleton: Skeleton | null;
  phases: readonly { number: number; title: string }[];
}): ArchitectureBinding {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (input.declaredSha12 !== null) {
    if (input.published === null) {
      errors.push(`o environment.json carimba a arquitetura (architecture.md@${input.declaredSha12}), mas .capivara/init/architecture.md não existe; rode \`capivara plan\``);
    } else if (sha12(input.published) !== input.declaredSha12) {
      errors.push(
        `.capivara/init/architecture.md não é o que o plan aprovou (${sha12(input.published)} ≠ ${input.declaredSha12}): o documento mudou depois do RALPH READY. ` +
          "Rode `capivara plan` de novo; o build não aceita nem converte arquitetura divergente.",
      );
    }
  }
  if (errors.length > 0) return { errors, warnings, bound: [] };
  if (input.architecture === null) {
    if (input.published !== null) {
      warnings.push("a forma estruturada da arquitetura não está disponível: nenhuma fatia por fase — o executor e o verificador leem .capivara/init/architecture.md inteiro");
    }
    return { errors, warnings, bound: [] };
  }
  if (input.published === null) {
    warnings.push("há arquitetura estruturada sem architecture.md publicado: as fatias não são usadas");
    return { errors, warnings, bound: [] };
  }
  if (input.skeleton === null || sha12(renderArchitecture(input.architecture, input.skeleton)) !== sha12(input.published)) {
    warnings.push(
      "a arquitetura estruturada não corresponde ao architecture.md publicado: nenhuma fatia por fase — o executor e o verificador leem o documento inteiro",
    );
    return { errors, warnings, bound: [] };
  }
  const bound: number[] = [];
  for (const phase of input.phases) {
    const daArquitetura = input.architecture.phases.find((entry) => entry.number === phase.number);
    if (!daArquitetura) {
      warnings.push(`Phase ${phase.number} não está na arquitetura (acrescentada depois dela): segue sem fatia, e quem a executa lê architecture.md`);
    } else if (daArquitetura.title.trim() !== phase.title.trim()) {
      warnings.push(`Phase ${phase.number} tem outro título na arquitetura ("${daArquitetura.title}" ≠ "${phase.title}"): segue sem fatia`);
    } else {
      bound.push(phase.number);
    }
  }
  return { errors, warnings, bound };
}
