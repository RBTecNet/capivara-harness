/**
 * Quando cada fluxo pode ser cobrado (§127).
 *
 * O gate 4 percorre, ao fim de uma fase, os workflows que ela COBRE
 * (`workflowsForPhase`). O plano nunca soube disso: o próprio harness oferecia
 * ao arquiteto "uma fase de integração que depende das fases dos módulos", e
 * ninguém dizia que a fase do módulo, se continuasse cobrindo o workflow, teria
 * o fluxo cobrado antes da integração. No Parallel Lab com Luna (0.7.0, run
 * `build-8e24c805009f`) a fase 4 entregava o módulo de categorias "pronto para a
 * integração … na fase 6", com o roteador "exportado sem registro no servidor
 * central", e cobria o workflow 3; a fase 6 cobria o mesmo workflow e conectava
 * os três módulos. O G4 cobrou o fluxo 3 na fase 4, o G3 cobrou a proibição, e
 * o executor pôs e tirou a integração quatro vezes até esgotar três ciclos.
 *
 * Esta é a resposta única à pergunta "o G4 cobra o workflow N ao fim da fase
 * K?" — o plano a usa para auditar e escrever, o build para decidir o G4. Duas
 * cópias dessa regra divergiriam na primeira correção.
 *
 * Um workflow que a fase cobre fica para uma fase posterior J só com evidência
 * EXPLÍCITA do plano publicado, e J tem de cobri-lo também e esperar por K
 * (depender dela, direta ou transitivamente, pelas mesmas dependências que o
 * escalonador do build respeita):
 *
 * - pelo TEXTO: a fase K nomeia a fase J ("pronta para a integração … na fase
 *   6"). Só referência adiante conta — a fase que depende de K a cita no
 *   próprio `Depends on`, e isso não diz nada sobre o fluxo;
 * - pelo CAMINHO: a arquitetura diz que o workflow atravessa um componente que
 *   nenhuma fase até K constrói, e J é a primeira fase que o cobre com o
 *   caminho inteiro de pé.
 *
 * Sem uma das duas, o fluxo é cobrado em K, como sempre foi — inclusive quando
 * o caminho dele não está completo e nenhuma fase posterior o completa: aí a
 * elegibilidade é desconhecida, o fluxo não é dispensado, e o plano recebe o
 * defeito (`contradicoesTemporais`). Nunca "pular o G4 nas fases do meio":
 * na integração progressiva — a fase do módulo integra a página e a API — nada
 * aqui adia coisa alguma.
 */

import { effectiveDependencies } from "./ownership.js";

export interface FaseNoTempo {
  number: number;
  dependsOn: string;
  covers: readonly string[];
  /**
   * Onde a fase pode nomear a que a completa: o envelope — título e goal —, no
   * plano E no build. As tasks não entram: o que o build lê tem de ser o que o
   * escritor e o auditor leram, e um critério com "prioridade P1, P2 ou P3" não
   * é referência a fase nenhuma.
   */
  texto: string;
  /** Os componentes que a fase implementa ou estende; ausente é desconhecido (a fase fora da arquitetura vinculada). */
  componentes?: readonly string[];
}

export interface EntradaDaDisponibilidade {
  fases: readonly FaseNoTempo[];
  /** Os números dos workflows do esqueleto. */
  workflows: readonly string[];
  /**
   * O caminho de cada workflow pela arquitetura — os componentes que ele
   * atravessa e aquilo de que eles dependem —, quando há arquitetura.
   */
  caminhos?: ReadonlyMap<string, readonly string[]>;
}

export type MotivoDoAdiamento =
  | { tipo: "texto"; trecho: string }
  | { tipo: "caminho"; faltam: string[] };

export interface Adiamento {
  workflow: string;
  fase: number;
  /** A fase que cobra o workflow: a que o completa. */
  para: number;
  /** A fase que esta nomeia (ou cujo caminho espera), quando ela também o deixa adiante: a cadeia, dita. */
  via?: number;
  motivo: MotivoDoAdiamento;
}

/**
 * Cobrado na fase e coberto de novo por uma fase posterior que espera por ela
 * e mexe em componentes do caminho que ela não nomeia — a fase de integração
 * do Luna. Não é contradição provada (pode ser só acabamento sobre um ponto de
 * extensão que já integra); é a pergunta que o escritor e o auditor precisam
 * ver: em que fase o fluxo fica de pé?
 */
export interface Revisita {
  workflow: string;
  fase: number;
  por: number;
  componentes: string[];
}

/** Cobrado na fase sem o caminho completo, e sem fase posterior que o complete. */
export interface Incerteza {
  workflow: string;
  fase: number;
  faltam: string[];
}

export interface Disponibilidade {
  /** Os workflows que o G4 cobra ao fim da fase, na ordem do esqueleto. */
  cobrados(fase: number): string[];
  /** Os que a fase cobre e que o plano deixa, explicitamente, para uma fase posterior. */
  adiados(fase: number): Adiamento[];
  /** Os cobrados na fase cujo caminho a arquitetura ainda não tem de pé. */
  incertos(fase: number): Incerteza[];
  /** Os cobrados na fase que uma fase posterior cobre de novo mexendo no caminho deles. */
  revisitados(fase: number): Revisita[];
  /** Todos os adiamentos do plano. */
  todosAdiados(): Adiamento[];
}

/** A fase cobre o workflow? Mesma leitura de `workflowsForPhase`: "workflow 3" ou "3". */
export function cobreWorkflow(covers: readonly string[], workflow: string): boolean {
  const alvo = workflow.toLowerCase();
  return covers.some((item) => {
    const normal = item.trim().toLowerCase();
    return normal === `workflow ${alvo}` || normal === alvo;
  });
}

/**
 * As fases que o texto NOMEIA: "fase 6", "Phase 6". Não o endereço solto
 * `P6` — "prioridade P1, P2 ou P3" e `p5.js` não são fases —, e nada entre
 * crases, que é código ou caminho.
 */
export function fasesNomeadas(texto: string): number[] {
  const semCodigo = texto.replace(/`[^`]*`/gu, " ");
  return [...new Set([...semCodigo.matchAll(/(?<![\p{L}\p{N}_])(?:phase|fase)\s+(\d+)(?![\p{L}\p{N}_])/giu)].map((casou) => Number(casou[1])))];
}

/** O trecho da fase que nomeia a outra: a frase, para quem lê o diagnóstico. */
function trechoQueCita(texto: string, fase: number): string {
  const frases = texto.split(/(?<=[.;!?])\s+|\n+/u).map((frase) => frase.trim()).filter((frase) => frase !== "");
  const frase = frases.find((cada) => fasesNomeadas(cada).includes(fase)) ?? texto.trim();
  if (frase.length <= 220) return frase;
  // Frase longa: a janela em volta da citação, que é a evidência — o goal do Luna cita a fase 6 no fim.
  const onde = new RegExp(`(?:phase|fase)\\s+${fase}(?![\\p{N}])`, "iu").exec(frase)?.index ?? 0;
  const inicio = Math.max(0, onde - 160);
  const fim = Math.min(frase.length, onde + 60);
  return `${inicio > 0 ? "…" : ""}${frase.slice(inicio, fim).trim()}${fim < frase.length ? "…" : ""}`;
}

/**
 * As fases em ordem, com `dependsOn` sempre legível: sem ele, a fase espera
 * todas as anteriores — como o escalonador do build (`dependenciasEfetivas`).
 */
function emOrdem(fases: readonly FaseNoTempo[]): FaseNoTempo[] {
  const ordenadas = [...fases].sort((a, b) => a.number - b.number);
  return ordenadas.map((fase) => typeof fase.dependsOn === "string" ? fase : {
    ...fase,
    dependsOn: ordenadas.filter((outra) => outra.number < fase.number).map((outra) => `Phase ${outra.number}`).join(", ") || "none",
  });
}

export function disponibilidadeDosFluxos(entrada: EntradaDaDisponibilidade): Disponibilidade {
  const fases = emOrdem(entrada.fases);
  const porNumero = new Map(fases.map((fase) => [fase.number, fase]));
  const dependencias = effectiveDependencies(fases);
  const fecho = new Map<number, Set<number>>();
  const anteriores = (numero: number): Set<number> => {
    const pronto = fecho.get(numero);
    if (pronto) return pronto;
    const visitadas = new Set<number>();
    const pilha = [...(dependencias.get(numero) ?? [])];
    while (pilha.length > 0) {
      const atual = pilha.pop()!;
      if (visitadas.has(atual)) continue;
      visitadas.add(atual);
      pilha.push(...(dependencias.get(atual) ?? []));
    }
    fecho.set(numero, visitadas);
    return visitadas;
  };
  const esperaPor = (posterior: number, anterior: number): boolean => anteriores(posterior).has(anterior);

  /*
   * O caminho só decide com o que se sabe: uma fase sem componentes conhecidos
   * (fora da arquitetura vinculada — o `change` que acrescentou uma fase) torna
   * desconhecido o que depende dela, e não apaga o que as outras dizem. Um
   * componente que nenhuma fase constrói (um serviço externo descrito como
   * componente) não é fase que falta: não entra na conta.
   */
  const construidos = new Set(fases.flatMap((fase) => (fase.componentes ?? []).map((nome) => nome.toLowerCase())));
  /** Os componentes de pé ao fim da fase: os dela e os de toda fase que ela espera — ou null, se alguma delas é desconhecida. */
  const dePe = (numero: number): Set<string> | null => {
    const nomes = new Set<string>();
    for (const outra of [numero, ...anteriores(numero)]) {
      const componentes = porNumero.get(outra)?.componentes;
      if (componentes === undefined) return null;
      for (const nome of componentes) nomes.add(nome.toLowerCase());
    }
    return nomes;
  };
  const faltamEm = (workflow: string, numero: number): string[] | null => {
    const caminho = entrada.caminhos?.get(workflow);
    if (!caminho || caminho.length === 0) return null;
    const presentes = dePe(numero);
    if (presentes === null) return null;
    return [...new Set(caminho.map((nome) => nome.toLowerCase()))].filter((nome) => construidos.has(nome) && !presentes.has(nome));
  };

  const adiamentos = new Map<string, Adiamento>();
  const incertezas = new Map<string, Incerteza>();
  const chave = (workflow: string, numero: number): string => `${numero}·${workflow}`;

  /** A decisão direta da fase sobre o workflow: o próximo destino, sem seguir a cadeia. */
  const decidir = (workflow: string, numero: number): { para: number; motivo: MotivoDoAdiamento } | { incerto: string[] } | null => {
    const fase = porNumero.get(numero)!;
    const posteriores = fases.filter((outra) => outra.number > numero && cobreWorkflow(outra.covers, workflow) && esperaPor(outra.number, numero));
    const citadas = new Set(fasesNomeadas(fase.texto));
    const nomeada = posteriores.find((outra) => citadas.has(outra.number));
    if (nomeada) return { para: nomeada.number, motivo: { tipo: "texto", trecho: trechoQueCita(fase.texto, nomeada.number) } };
    const faltam = faltamEm(workflow, numero);
    if (faltam === null || faltam.length === 0) return null;
    const avaliadas = posteriores.map((outra) => ({ outra, faltam: faltamEm(workflow, outra.number) }));
    const completa = avaliadas.find((avaliada) => avaliada.faltam?.length === 0);
    if (completa) return { para: completa.outra.number, motivo: { tipo: "caminho", faltam } };
    // Uma posterior desconhecida pode ser a que completa: cobrado aqui, sem acusar o plano do que não se sabe.
    if (avaliadas.some((avaliada) => avaliada.faltam === null)) return null;
    return { incerto: faltam };
  };

  for (const fase of fases) {
    for (const workflow of entrada.workflows) {
      if (!cobreWorkflow(fase.covers, workflow)) continue;
      const decisao = decidir(workflow, fase.number);
      if (decisao === null) continue;
      if ("incerto" in decisao) {
        incertezas.set(chave(workflow, fase.number), { workflow, fase: fase.number, faltam: decisao.incerto });
        continue;
      }
      // A cadeia: a fase que recebe também pode deixá-lo adiante; o destino é a que o cobra.
      let para = decisao.para;
      for (const visitadas = new Set<number>([fase.number]); !visitadas.has(para); ) {
        visitadas.add(para);
        const seguinte = decidir(workflow, para);
        if (seguinte === null || "incerto" in seguinte) break;
        para = seguinte.para;
      }
      adiamentos.set(chave(workflow, fase.number), { workflow, fase: fase.number, para, ...(para !== decisao.para ? { via: decisao.para } : {}), motivo: decisao.motivo });
    }
  }

  return {
    cobrados(numero) {
      const fase = porNumero.get(numero);
      if (!fase) return [];
      return entrada.workflows.filter((workflow) => cobreWorkflow(fase.covers, workflow) && !adiamentos.has(chave(workflow, numero)));
    },
    adiados(numero) {
      return entrada.workflows.flatMap((workflow) => adiamentos.get(chave(workflow, numero)) ?? []);
    },
    incertos(numero) {
      return entrada.workflows.flatMap((workflow) => incertezas.get(chave(workflow, numero)) ?? []);
    },
    revisitados(numero) {
      const fase = porNumero.get(numero);
      if (!fase || fase.componentes === undefined || entrada.caminhos === undefined) return [];
      const proprios = new Set((fase.componentes ?? []).map((nome) => nome.toLowerCase()));
      return this.cobrados(numero).flatMap((workflow) => {
        const caminho = new Set((entrada.caminhos!.get(workflow) ?? []).map((nome) => nome.toLowerCase()));
        const posterior = fases.find((outra) => outra.number > numero && cobreWorkflow(outra.covers, workflow) && esperaPor(outra.number, numero) &&
          (outra.componentes ?? []).some((nome) => caminho.has(nome.toLowerCase()) && !proprios.has(nome.toLowerCase())));
        if (!posterior) return [];
        const componentes = (posterior.componentes ?? []).filter((nome) => caminho.has(nome.toLowerCase()) && !proprios.has(nome.toLowerCase()));
        return [{ workflow, fase: numero, por: posterior.number, componentes }];
      });
    },
    todosAdiados() {
      return [...adiamentos.values()].sort((a, b) => a.fase - b.fase || a.workflow.localeCompare(b.workflow, undefined, { numeric: true }));
    },
  };
}

/** Os componentes citados e todos os de que eles dependem, transitivamente (o caminho inteiro de um fluxo). */
export function fechoDosComponentes(componentes: readonly { name: string; dependsOn: readonly string[] }[], nomes: readonly string[]): Set<string> {
  const porNome = new Map(componentes.map((componente) => [componente.name.toLowerCase(), componente]));
  const fecho = new Set<string>();
  const fila = nomes.map((nome) => nome.toLowerCase());
  while (fila.length > 0) {
    const nome = fila.shift()!;
    if (fecho.has(nome)) continue;
    fecho.add(nome);
    for (const dependencia of porNome.get(nome)?.dependsOn ?? []) fila.push(dependencia.toLowerCase());
  }
  return fecho;
}

export interface ContradicaoTemporal {
  problem: string;
  hint: string;
}

/**
 * O que o plano publicaria e o build não conseguiria cumprir sem cobrar um
 * fluxo antes da hora (§127): é defeito da arquitetura, que é quem escreve
 * `covers`, `dependsOn`, os componentes de cada fase e o goal.
 *
 * - O workflow é cobrado numa fase em que o caminho dele ainda não existe, e
 *   nenhuma fase posterior que o cubra o completa: o G4 o cobraria contra
 *   componentes que ninguém construiu ainda.
 * - A fase nomeia uma fase posterior que também cobre o workflow, mas essa
 *   fase não espera por ela: as duas podem rodar juntas, e a que deveria
 *   completar o fluxo não tem o que completar.
 */
export function contradicoesTemporais(entrada: EntradaDaDisponibilidade): ContradicaoTemporal[] {
  const disponibilidade = disponibilidadeDosFluxos(entrada);
  const fases = emOrdem(entrada.fases);
  const dependencias = effectiveDependencies(fases);
  const espera = (posterior: number, anterior: number): boolean => {
    const visitadas = new Set<number>();
    const pilha = [...(dependencias.get(posterior) ?? [])];
    while (pilha.length > 0) {
      const atual = pilha.pop()!;
      if (atual === anterior) return true;
      if (visitadas.has(atual)) continue;
      visitadas.add(atual);
      pilha.push(...(dependencias.get(atual) ?? []));
    }
    return false;
  };
  const contradicoes: ContradicaoTemporal[] = [];
  for (const fase of fases) {
    for (const incerto of disponibilidade.incertos(fase.number)) {
      contradicoes.push({
        problem:
          `o workflow ${incerto.workflow} é cobrado pelo gate 4 ao fim da fase ${fase.number}, que o cobre, mas atravessa ${incerto.faltam.join(", ")}, ` +
          `que nenhuma fase até ela constrói, e nenhuma fase posterior que o cubra o completa`,
        hint:
          `o build percorre um workflow pela aplicação de pé ao fim da primeira fase que o cobre; cubra o workflow ${incerto.workflow} na fase que deixa o caminho dele inteiro de pé ` +
          "(a que integra os componentes que ele atravessa), ou faça essa fase depender das que constroem esses componentes",
      });
    }
    const citadas = new Set(fasesNomeadas(fase.texto));
    for (const outra of fases) {
      if (outra.number <= fase.number || !citadas.has(outra.number) || espera(outra.number, fase.number)) continue;
      const comuns = entrada.workflows.filter((workflow) => cobreWorkflow(fase.covers, workflow) && cobreWorkflow(outra.covers, workflow));
      if (comuns.length === 0) continue;
      contradicoes.push({
        problem:
          `a fase ${fase.number} deixa para a fase ${outra.number} ("${trechoQueCita(fase.texto, outra.number)}"), e as duas cobrem ${comuns.map((workflow) => `o workflow ${workflow}`).join(", ")}, ` +
          `mas a fase ${outra.number} não depende da fase ${fase.number}: as duas podem rodar ao mesmo tempo, e o fluxo seria cobrado antes de a fase ${fase.number} existir`,
        hint: `ponha a fase ${fase.number} no dependsOn da fase ${outra.number} (ou de uma fase de que ela depende), ou tire da fase ${fase.number} o que ela deixa para a outra`,
      });
    }
  }
  return contradicoes;
}

const rotulo = (workflow: string, nomes: ReadonlyMap<string, string>): string => `workflow ${workflow}${nomes.get(workflow) ? ` (${nomes.get(workflow)})` : ""}`;

function motivoEmIngles(adiado: Adiamento): string {
  const porque = adiado.motivo.tipo === "texto" ? `the phase says: "${adiado.motivo.trecho}"` : `its path still lacks ${adiado.motivo.faltam.join(", ")}`;
  return adiado.via !== undefined ? `${porque}; Phase ${adiado.via} leaves it on to Phase ${adiado.para}` : porque;
}

/**
 * O tempo dos fluxos do plano inteiro, para quem audita o plano inteiro (a
 * arquitetura e a coerência): uma linha por fase, derivada — nunca escrita
 * por modelo nenhum.
 */
export function tabelaDaDisponibilidade(disponibilidade: Disponibilidade, fases: readonly number[], nomes: ReadonlyMap<string, string> = new Map()): string[] {
  const linhas: string[] = [];
  for (const fase of [...fases].sort((a, b) => a - b)) {
    const cobrados = disponibilidade.cobrados(fase);
    const adiados = disponibilidade.adiados(fase);
    const revisitados = disponibilidade.revisitados(fase);
    if (cobrados.length === 0 && adiados.length === 0) continue;
    const partes = [
      ...(cobrados.length > 0 ? [`walks ${cobrados.map((workflow) => rotulo(workflow, nomes)).join(", ")} at its end`] : []),
      ...adiados.map((adiado) => `covers ${rotulo(adiado.workflow, nomes)} but leaves it to Phase ${adiado.para} (${motivoEmIngles(adiado)})`),
      ...revisitados.map((revisita) =>
        `Phase ${revisita.por} covers ${rotulo(revisita.workflow, nomes)} again and changes ${revisita.componentes.join(", ")} on its path, which Phase ${fase} does not name — say in which of the two it becomes reachable`),
    ];
    linhas.push(`- Phase ${fase}: ${partes.join("; ")}.`);
  }
  return linhas.length === 0 ? [] : [
    "## When the build walks each workflow (derived by the harness from covers, dependsOn, components and flows)",
    "At the end of each phase the build starts the real application and walks, in a browser, the",
    "workflows below. A phase that walks a workflow must leave it reachable through the running",
    "application when it closes; a phase that leaves it to a later one must not demand it there.",
    ...linhas,
  ];
}

/**
 * O que o escritor e o auditor de uma fase precisam saber do tempo dos fluxos:
 * quais o build percorre ao fim dela e quais ficam para a fase que os completa.
 * Em inglês, como os prompts do plano.
 */
export function blocoDaDisponibilidade(disponibilidade: Disponibilidade, fase: number, nomes: ReadonlyMap<string, string> = new Map()): string[] {
  const nome = (workflow: string): string => rotulo(workflow, nomes);
  const cobrados = disponibilidade.cobrados(fase);
  const adiados = disponibilidade.adiados(fase);
  const revisitados = disponibilidade.revisitados(fase);
  if (cobrados.length === 0 && adiados.length === 0) return [];
  return [
    "## When the build walks this phase's workflows",
    "At the end of each phase the build starts the real application and walks, in a browser, every",
    "workflow that phase is charged with; those that phase leaves to a later phase are walked there.",
    ...(cobrados.length > 0
      ? [
          `Walked at the end of THIS phase: ${cobrados.map(nome).join(", ")}. The application must be reachable`,
          "end to end for them when this phase closes: no criterion here may keep their pages or routes",
          "out of the running application (\"exported without registering\", \"left for a later phase\").",
        ]
      : []),
    /*
     * O que a fase liga, ou não, é o goal dela que diz — nunca este bloco. O
     * adiamento pelo caminho é a fase da navegação antes dos módulos: ela liga a
     * parte dela, e o fluxo só fica inteiro depois.
     */
    ...adiados.map((adiado) =>
      `${nome(adiado.workflow)} is covered here but walked only at the end of Phase ${adiado.para}, ` +
        `which completes it (${motivoEmIngles(adiado)}). ` +
        (adiado.motivo.tipo === "caminho"
          ? "This phase delivers its own part of the workflow's path; the rest exists only later. "
          : "What this phase wires into the application, and what it leaves to that phase, is what this phase's goal says. ") +
        "No criterion here may demand the whole workflow through the running application.",
    ),
    ...revisitados.map((revisita) =>
      `Phase ${revisita.por} covers ${nome(revisita.workflow)} again and changes ${revisita.componentes.join(", ")} on its path. ` +
        "The build still walks it at the end of THIS phase: either this phase makes it reachable (through an extension point it " +
        "may use, without editing files another phase owns), or the architecture is wrong — never a criterion that leaves it unreachable.",
    ),
  ];
}
