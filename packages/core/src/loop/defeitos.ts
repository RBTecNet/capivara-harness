/**
 * Os defeitos de uma fase: identidade, história, estratégias e orçamento (§125 D; spec §5).
 *
 * O runner guardava uma causa só — `lastGate` e `lastCause`, sobrescritos a cada
 * volta —, e o que se repetia era o pipeline: a fase gastava um ciclo inteiro
 * por defeito, o mesmo defeito ganhava cara nova em cada gate, e a estratégia
 * que não funcionou era tentada de novo sem informação nova. Aqui cada defeito
 * tem um id estável, sabe em que gates apareceu, o que já se tentou contra ele
 * e com que resultado; e o orçamento é contado em três escalas independentes —
 * o defeito, o gate e o ciclo da fase —, para que um gate não gaste as
 * oportunidades do outro e um reparo local não custe um ciclo inteiro.
 *
 * O estado é do Core e mora no plano de controle (`runs/<runId>/defects/`): um
 * instantâneo atômico por fase, e nada mais — a história está DENTRO dele
 * (tentativas, estratégias que falharam, rediagnósticos), e o orçamento gasto
 * sai das tentativas, sem contador paralelo que divirja numa queda. Status de
 * defeito não é status de fase, de run nem de etapa documental — cada um tem o
 * seu lugar e o seu nome.
 */

import { readFile, rename } from "node:fs/promises";
import { join } from "node:path";
import { sha12 } from "../contract/index.js";
import { writeAtomic } from "../state/atomic.js";

export const DEFECTS_CONTRACT = "capivara-defects/v1" as const;

export type DefectStatus =
  | "OPEN"
  | "DIAGNOSING"
  | "REPAIRING"
  | "AWAITING_VALIDATION"
  | "RESOLVED"
  | "ESCALATED"
  | "UPSTREAM_REPAIR_REQUIRED";

export type DefectGate = "G0" | "G2" | "G3" | "G4" | "INTEGRACAO";

/** O que pode ser feito contra um defeito. A ordem da escada é a da spec §6. */
export type Estrategia = "executor" | "verificador" | "roteiro" | "revisao" | "conciliacao";

export type NaturezaDoDefeito =
  | "engine"
  | "suite"
  | "ferramenta"
  | "task"
  | "fluxo-produto"
  | "fluxo-subida"
  | "fluxo-ferramenta"
  | "fluxo-criterio"
  | "fluxo-roteiro"
  | "fluxo-revisao"
  | "integracao-teste"
  | "integracao-conflito";

export interface DefectAnchors {
  task?: number;
  taskSha?: string;
  workflow?: string;
  step?: string;
  tests?: string[];
  /** Mensagens citadas literalmente: a ponte determinística entre gates diferentes. */
  quotes?: string[];
  /**
   * A versão do que foi verificado, quando ela não está no código: o roteiro do
   * G4. Entra na assinatura sem normalização — a mesma falha com outro roteiro
   * é informação nova.
   */
  version?: string;
  /** O texto normalizado da falha; muda quando a falha muda. */
  signature: string;
}

export interface DefectAttempt {
  /** A ação que a gerou: um reparo agrupado é UMA ação para vários defeitos. */
  action: number;
  cycle: number;
  /** O gate em que o defeito estava quando a ação começou: é o orçamento que ela gastou. */
  gate: DefectGate;
  strategy: Estrategia;
  agent: { role: "builder" | "verifier"; attempt: number; sessionId?: string; resumed?: boolean };
  at: string;
  /** `interrupted`: a ação começou numa execução que parou antes de terminá-la — nem progresso, nem falta dele. */
  result: "pending" | "progress" | "no-progress" | "resolved" | "interrupted";
  note: string;
  /**
   * A ação mudou alguma coisa — código, ambiente, roteiro? Ação que não mudou
   * nada não pode ter progredido, seja qual for o texto da falha seguinte: a
   * medição seguinte pode ser outra (o worktree, depois da cópia limpa).
   */
  changed?: boolean;
}

export interface Defect {
  defectId: string;
  phaseId: string;
  nature: NaturezaDoDefeito;
  discovered: { gate: DefectGate; cycle: number; at: string };
  /** Os gates em que ele apareceu, na ordem. */
  gates: DefectGate[];
  severity: "B0" | "B1";
  anchors: DefectAnchors;
  /** Uma linha para a tela. */
  summary: string;
  /** O texto inteiro da falha, para o prompt de quem repara. */
  detail: string;
  criterion: string;
  observed: string;
  expected: string;
  hypothesis: string;
  components: string[];
  status: DefectStatus;
  attempts: DefectAttempt[];
  /**
   * Estratégias que falharam SEM progresso, com a assinatura da falha naquele
   * momento. Não se repetem sem informação nova: a falha mudou, ou outra
   * estratégia foi tentada depois (spec §5.3).
   */
  failedStrategies: { cycle: number; strategy: Estrategia; signature: string; afterAttempt: number }[];
  evidence: string[];
  invalidated: string[];
  handoffs: string[];
  /** Diagnósticos posteriores ao original, que é imutável no handoff: a evolução, separada. */
  rediagnoses: { at: string; cycle: number; excerpt: string }[];
  diagnosedBy?: { role: "verifier"; purpose?: string; sessionId?: string; log?: string };
  costs: { calls: number; seconds: number; costUsd: number };
  /** A ordem da escada, quando quem chama a fixa (a integração que já passou pelo executor começa pelo verificador). */
  order?: Estrategia[];
  /** O pacote de reparo documental que o encaminhou (§125 H), para ser reconferido na retomada. */
  upstream?: string;
}

/** O que um gate achou, antes de virar (ou de casar com) um defeito. */
export interface DefeitoEncontrado {
  gate: DefectGate;
  nature: NaturezaDoDefeito;
  severity?: "B0" | "B1";
  anchors: Omit<DefectAnchors, "signature">;
  summary: string;
  detail: string;
  criterion?: string;
  observed?: string;
  expected?: string;
  hypothesis?: string;
  components?: string[];
  evidenceId?: string;
  diagnosedBy?: Defect["diagnosedBy"];
  /** O verificador citou o id de um defeito aberto: equivalência semântica sem chamada extra. */
  tag?: string;
  /**
   * O texto que identifica a falha para a regra de progresso, quando não é o
   * `detail` inteiro: no G3, o critério que não se cumpre — a mesma falha
   * reescrita em outras palavras não é progresso.
   */
  assinaturaDe?: string;
}

export interface OrcamentoDaRecuperacao {
  /** Ciclos por execução: é o `--max-cycles` de sempre. */
  ciclos: number;
  /** Ações de reparo por ciclo. */
  porCiclo: number;
  /** Ações de reparo por gate em cada ciclo; um gate não consome as do outro. */
  porGate: number;
  /** Tentativas contra o mesmo defeito em cada ciclo. */
  porDefeito: number;
  /**
   * Sessões de reparo pelo verificador por gate em cada ciclo (`--max-verifier-repairs`;
   * 0 desliga). Por gate e renovado no ciclo: um reparo do G2 não tira a vez do G3.
   */
  reparosDoVerificador: number;
}

/**
 * Os padrões. O do ciclo é a soma dos três gates que reparam (G2, G3, G4): o
 * teto do ciclo nunca morde antes do de um gate, e um gate não esgota o ciclo
 * do outro. O custo é limitado pela regra de progresso — sem informação nova,
 * nada se repete —, não por um teto baixo.
 */
export const ORCAMENTO_PADRAO: Omit<OrcamentoDaRecuperacao, "ciclos" | "reparosDoVerificador"> = { porCiclo: 6, porGate: 2, porDefeito: 3 };

/**
 * O orçamento que vale de fato, a partir do pedido (flags, Wizard) e dos padrões.
 *
 * O teto explícito do verificador tem de caber: num gate, o executor tenta
 * antes (spec §6), então o gate e o defeito comportam pelo menos os reparos
 * pedidos mais uma correção; e o ciclo, sem pedido explícito, comporta os três
 * gates que reparam. É este valor — e não o pedido — que o run fotografa.
 */
export function orcamentoEfetivo(
  ciclos: number,
  reparosDoVerificador: number,
  pedido: Partial<Pick<OrcamentoDaRecuperacao, "porCiclo" | "porGate" | "porDefeito">> = {},
): OrcamentoDaRecuperacao {
  // Quem pede mais reparos por ciclo (Wizard, --repairs-per-cycle) sem fixar o do gate dá a cada um dos três gates a sua parte.
  const porGatePedido = pedido.porGate ?? (pedido.porCiclo !== undefined ? Math.max(ORCAMENTO_PADRAO.porGate, Math.ceil(pedido.porCiclo / 3)) : ORCAMENTO_PADRAO.porGate);
  const porGate = Math.max(porGatePedido, reparosDoVerificador + 1);
  return {
    ciclos,
    porCiclo: Math.max(pedido.porCiclo ?? ORCAMENTO_PADRAO.porCiclo, pedido.porCiclo !== undefined ? 1 : porGate * 3),
    porGate,
    porDefeito: Math.max(pedido.porDefeito ?? ORCAMENTO_PADRAO.porDefeito, reparosDoVerificador + 1),
    reparosDoVerificador,
  };
}

const ATIVOS: ReadonlySet<DefectStatus> = new Set(["OPEN", "DIAGNOSING", "REPAIRING", "AWAITING_VALIDATION", "ESCALATED"]);

/** A escada de estratégias de cada natureza de defeito (spec §6: o executor primeiro, o verificador que diagnosticou depois). */
export function escadaDe(natureza: NaturezaDoDefeito): Estrategia[] {
  switch (natureza) {
    case "engine":
    case "fluxo-ferramenta":
    case "fluxo-criterio":
      return ["executor"];
    case "fluxo-roteiro":
      return ["roteiro"];
    case "fluxo-revisao":
      return ["revisao"];
    case "integracao-conflito":
      return ["conciliacao", "executor"];
    /*
     * A suíte vermelha não tem diagnóstico de verificador: o reparo assistido
     * vem primeiro, como decidido no §114, e o executor depois. A escada do
     * §6 — executor primeiro, o verificador que diagnosticou depois — é a do
     * defeito que o verificador achou.
     */
    case "suite":
    case "ferramenta":
      return ["verificador", "executor"];
    default:
      return ["executor", "verificador"];
  }
}

/**
 * O texto normalizado de uma falha: o que muda quando a falha muda.
 *
 * Números de linha, durações, portas, ids e caminhos temporários mudam entre
 * duas execuções da MESMA falha; sem tirá-los, "sem progresso" nunca seria
 * reconhecido e a mesma estratégia seria tentada para sempre.
 */
export function assinaturaDaFalha(texto: string): string {
  const normalizado = texto
    .toLowerCase()
    .replace(/\x1b\[[0-9;]*m/g, "")
    .replace(/\/tmp\/[^\s'"`]+/g, "<tmp>")
    .replace(/:\d+(?::\d+)?/g, ":<n>")
    .replace(/\b\d+(?:[.,]\d+)?\s*(?:ms|s|m)\b/g, "<t>")
    .replace(/\b[0-9a-f]{7,64}\b/g, "<id>")
    .replace(/\b\d+\b/g, "<n>")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 2000);
  return sha12(normalizado);
}

/** Trechos citados literalmente — entre aspas, crases ou aspas angulares — com tamanho de mensagem. */
export function citacoes(texto: string): string[] {
  const achadas = new Set<string>();
  for (const match of texto.matchAll(/["'`«“]([^"'`»”\n]{6,160})["'`»”]/gu)) {
    const trecho = (match[1] ?? "").trim().toLowerCase();
    if (trecho.length >= 6 && /[a-zà-ú]/u.test(trecho)) achadas.add(trecho);
  }
  return [...achadas];
}

function grupoDaNatureza(natureza: NaturezaDoDefeito): string {
  // A falha da árvore integrada é outra prova (cópia limpa), com outra escada: não casa com a suíte do worktree.
  if (natureza === "integracao-teste") return "integracao";
  if (natureza === "suite" || natureza === "ferramenta") return "suite";
  if (natureza.startsWith("fluxo-")) return "fluxo";
  return natureza;
}

/**
 * O mesmo defeito? Identidade determinística, sem modelo.
 *
 * Exata quando a âncora é a mesma: a task, o fluxo e o passo, os testes que
 * falham. Entre gates diferentes, a ponte é o verificador citar o id do
 * defeito aberto (equivalência semântica, achada na chamada que já existia) ou
 * as duas falhas citarem a mesma mensagem literal.
 */
export function mesmoDefeito(existente: Defect, achado: DefeitoEncontrado): boolean {
  if (achado.tag !== undefined && achado.tag === existente.defectId) return true;
  const grupoExistente = grupoDaNatureza(existente.nature);
  const grupoAchado = grupoDaNatureza(achado.nature);
  if (grupoExistente === grupoAchado) {
    if (grupoAchado === "task") {
      return existente.anchors.task === achado.anchors.task && (existente.anchors.taskSha === undefined || achado.anchors.taskSha === undefined || existente.anchors.taskSha === achado.anchors.taskSha);
    }
    if (grupoAchado === "fluxo") {
      // Sem fluxo na âncora (a revisão que caiu, a aplicação que não subiu): a mesma natureza, ainda aberta, é o mesmo defeito.
      if (existente.anchors.workflow === undefined && achado.anchors.workflow === undefined) return existente.nature === achado.nature && existente.status !== "RESOLVED";
      if (existente.anchors.workflow === undefined || existente.anchors.workflow !== achado.anchors.workflow) return false;
      // Roteiro errado e produto errado no mesmo fluxo são defeitos diferentes, com escadas diferentes.
      if (existente.nature !== achado.nature) return false;
      return existente.anchors.step === undefined || achado.anchors.step === undefined || existente.anchors.step === achado.anchors.step;
    }
    if (grupoAchado === "suite") {
      // Enquanto a suíte vermelha não fechou, ela é um defeito só; fechada, volta se os testes coincidem.
      if (existente.status !== "RESOLVED") return true;
      const antes = new Set(existente.anchors.tests ?? []);
      return (achado.anchors.tests ?? []).some((teste) => antes.has(teste));
    }
    if (grupoAchado === "engine" || grupoAchado === "integracao") return existente.status !== "RESOLVED";
    return false;
  }
  const antes = new Set(existente.anchors.quotes ?? []);
  return (achado.anchors.quotes ?? []).some((citacao) => antes.has(citacao));
}

/** O orçamento gasto no ciclo corrente, derivado das tentativas. */
export interface UsoDoCiclo {
  cycle: number;
  repairs: number;
  byGate: Record<string, number>;
  byDefect: Record<string, number>;
  /** Reparos pelo verificador por gate neste ciclo. */
  verifierByGate: Record<string, number>;
}

export interface EstadoDaRecuperacao {
  contract: typeof DEFECTS_CONTRACT;
  runId: string;
  phaseId: string;
  /** A sessão de implementação da fase já aconteceu neste run? Concluída, ela não se repete na retomada. */
  implementation: "pending" | "started" | "done";
  /** O ciclo corrente, absoluto: continua entre execuções do mesmo run. */
  cycle: number;
  /** Ordinal da última sessão de escrita do executor: nomeia prompts e logs. */
  builderSessions: number;
  /** Ordinal da última ação de reparo. */
  actions: number;
  seq: number;
  defects: Defect[];
  /**
   * O conteúdo do código quando a fase parou, para o Core reconhecer o próprio
   * parcial na próxima execução em vez de mandar commitar ou descartar.
   */
  ultimoEstado?: { tree: string | null; at: string };
  /**
   * O conteúdo do código quando a implementação começou. Se a fase parou e o
   * código voltou a ser este — o parcial descartado, como a parada oferece —,
   * a fase recomeça do zero, em vez de "retomar" defeitos de um código que
   * não existe mais.
   */
  inicio?: string | null;
  updatedAt: string;
}

export interface AcaoPlanejada {
  estrategia: Estrategia;
  defeitos: Defect[];
}

export function defeitosDoRun(runRoot: string): string {
  return join(runRoot, "defects");
}

export class RegistroDeDefeitos {
  private constructor(
    private readonly runRoot: string,
    readonly estado: EstadoDaRecuperacao,
    private readonly now: () => Date,
  ) {}

  /**
   * `refazer` (o `--rebuild-all`) começa a fase do zero sem apagar nada: o
   * instantâneo anterior é arquivado ao lado, com a data no nome.
   */
  static async abrir(runRoot: string, runId: string, phaseId: string, now: () => Date = () => new Date(), refazer = false): Promise<RegistroDeDefeitos> {
    const caminho = join(defeitosDoRun(runRoot), `${phaseId}.json`);
    if (refazer) {
      const quando = now().toISOString().replace(/[:.]/gu, "-");
      await rename(caminho, join(defeitosDoRun(runRoot), `${phaseId}.${quando}.json`)).catch(() => undefined);
      // Os handoffs vão junto: um defeito novo com o mesmo id não herda o diagnóstico de outro.
      await rename(join(defeitosDoRun(runRoot), phaseId), join(defeitosDoRun(runRoot), `${phaseId}.${quando}`)).catch(() => undefined);
    }
    const lido = await readFile(caminho, "utf8").then((bruto) => JSON.parse(bruto) as Partial<EstadoDaRecuperacao>, () => null);
    const valido = lido && lido.contract === DEFECTS_CONTRACT && lido.phaseId === phaseId && Array.isArray(lido.defects) && typeof lido.cycle === "number";
    const estado: EstadoDaRecuperacao = valido
      ? (lido as EstadoDaRecuperacao)
      : {
          contract: DEFECTS_CONTRACT,
          runId,
          phaseId,
          implementation: "pending",
          cycle: 1,
          builderSessions: 0,
          actions: 0,
          seq: 0,
          defects: [],
          updatedAt: now().toISOString(),
        };
    /*
     * Uma ação que outra execução começou e não terminou — credencial recusada,
     * limite de uso, parada de autoridade, queda — não é tentativa sem
     * progresso: o defeito volta a ser planejável. O G4 é o caso extremo: o
     * pedido de reescrita vivia na memória da execução que parou, e validá-lo
     * contra o roteiro antigo bloquearia a estratégia para sempre.
     */
    for (const defeito of estado.defects) {
      const pendente = defeito.attempts.at(-1);
      const perdida = defeito.status === "REPAIRING" ||
        (defeito.status === "AWAITING_VALIDATION" && pendente?.result === "pending" && (pendente.strategy === "roteiro" || pendente.strategy === "revisao"));
      if (!perdida) continue;
      for (const tentativa of defeito.attempts) if (tentativa.result === "pending") tentativa.result = "interrupted";
      defeito.status = "OPEN";
    }
    return new RegistroDeDefeitos(runRoot, estado, now);
  }

  /** O instantâneo atômico: a única escrita, e por isso nada diverge numa queda. */
  async salvar(): Promise<void> {
    this.estado.updatedAt = this.now().toISOString();
    await writeAtomic(join(defeitosDoRun(this.runRoot), `${this.estado.phaseId}.json`), `${JSON.stringify(this.estado, null, 2)}\n`);
  }

  /** O orçamento gasto no ciclo corrente, contado das tentativas. */
  uso(): UsoDoCiclo {
    const doCiclo = this.estado.defects.flatMap((defeito) => defeito.attempts.map((tentativa) => ({ defeito, tentativa })))
      .filter(({ tentativa }) => tentativa.cycle === this.estado.cycle);
    const acoes = new Set(doCiclo.map(({ tentativa }) => tentativa.action));
    const porGate = new Map<string, Set<number>>();
    const verificadorPorGate = new Map<string, Set<number>>();
    const porDefeito: Record<string, number> = {};
    for (const { defeito, tentativa } of doCiclo) {
      porGate.set(tentativa.gate, (porGate.get(tentativa.gate) ?? new Set()).add(tentativa.action));
      if (tentativa.strategy === "verificador") verificadorPorGate.set(tentativa.gate, (verificadorPorGate.get(tentativa.gate) ?? new Set()).add(tentativa.action));
      porDefeito[defeito.defectId] = (porDefeito[defeito.defectId] ?? 0) + 1;
    }
    return {
      cycle: this.estado.cycle,
      repairs: acoes.size,
      byGate: Object.fromEntries([...porGate].map(([gate, ids]) => [gate, ids.size])),
      byDefect: porDefeito,
      verifierByGate: Object.fromEntries([...verificadorPorGate].map(([gate, ids]) => [gate, ids.size])),
    };
  }

  ativos(): Defect[] {
    return this.estado.defects.filter((defeito) => ATIVOS.has(defeito.status));
  }

  porId(defectId: string): Defect | undefined {
    return this.estado.defects.find((defeito) => defeito.defectId === defectId);
  }

  /**
   * O que um gate achou vira defeito — ou casa com um que já existe.
   *
   * O casamento olha também os RESOLVIDOS: um defeito que volta é o mesmo,
   * com a história dele, e não um novo de orçamento cheio.
   */
  registrar(achado: DefeitoEncontrado): { defeito: Defect; novo: boolean; reaberto: boolean } {
    const at = this.now().toISOString();
    const texto = achado.assinaturaDe && achado.assinaturaDe.trim() !== "" ? achado.assinaturaDe : achado.detail;
    const assinatura = achado.anchors.version ? sha12(`${assinaturaDaFalha(texto)}|${achado.anchors.version}`) : assinaturaDaFalha(texto);
    const existente = [...this.estado.defects].reverse().find((defeito) => mesmoDefeito(defeito, achado));
    if (existente) {
      // O que esperava um reparo documental e voltou a ser achado pelo gate também reabre: a escada volta a valer.
      const reaberto = existente.status === "RESOLVED" || existente.status === "ESCALATED" || existente.status === "UPSTREAM_REPAIR_REQUIRED";
      if (!existente.gates.includes(achado.gate)) existente.gates.push(achado.gate);
      else if (existente.gates.at(-1) !== achado.gate) existente.gates.push(achado.gate);
      const anteriores = new Set(existente.anchors.quotes ?? []);
      existente.anchors = {
        ...existente.anchors,
        ...achado.anchors,
        tests: [...new Set([...(existente.anchors.tests ?? []), ...(achado.anchors.tests ?? [])])],
        quotes: [...new Set([...anteriores, ...(achado.anchors.quotes ?? [])])],
        signature: assinatura,
      };
      existente.summary = achado.summary;
      existente.detail = achado.detail;
      if (achado.criterion) existente.criterion = achado.criterion;
      if (achado.observed) existente.observed = achado.observed;
      if (achado.expected) existente.expected = achado.expected;
      if (achado.hypothesis) existente.hypothesis = achado.hypothesis;
      if (achado.evidenceId) existente.evidence.push(achado.evidenceId);
      if (achado.diagnosedBy) existente.diagnosedBy = achado.diagnosedBy;
      existente.rediagnoses.push({ at, cycle: this.estado.cycle, excerpt: achado.detail.slice(0, 2000) });
      if (reaberto) existente.status = "OPEN";
      return { defeito: existente, novo: false, reaberto };
    }
    this.estado.seq += 1;
    const defeito: Defect = {
      defectId: `${this.estado.phaseId}-D${this.estado.seq}`,
      phaseId: this.estado.phaseId,
      nature: achado.nature,
      discovered: { gate: achado.gate, cycle: this.estado.cycle, at },
      gates: [achado.gate],
      severity: achado.severity ?? "B1",
      anchors: { ...achado.anchors, signature: assinatura },
      summary: achado.summary,
      detail: achado.detail,
      criterion: achado.criterion ?? "",
      observed: achado.observed ?? "",
      expected: achado.expected ?? "",
      hypothesis: achado.hypothesis ?? "",
      components: achado.components ?? [],
      status: "OPEN",
      attempts: [],
      failedStrategies: [],
      evidence: achado.evidenceId ? [achado.evidenceId] : [],
      invalidated: [],
      handoffs: [],
      rediagnoses: [],
      ...(achado.diagnosedBy ? { diagnosedBy: achado.diagnosedBy } : {}),
      costs: { calls: 0, seconds: 0, costUsd: 0 },
    };
    this.estado.defects.push(defeito);
    return { defeito, novo: true, reaberto: false };
  }

  /**
   * O resultado da validação de um defeito que esperava por ela.
   *
   * Não reproduzido é resolvido. Reproduzido conta como progresso só quando a
   * falha mudou SEM regressão: nenhum defeito novo ou reaberto na mesma
   * passagem e, na suíte, não mais testes falhando do que antes (spec §5.3).
   * Mesma falha, ou falha diferente com regressão, é tentativa sem progresso, e
   * a estratégia fica bloqueada para ele até haver informação nova.
   */
  validar(defeito: Defect, reproduzido: { assinatura: string; testes?: number } | null, regressao: boolean): "resolved" | "progress" | "no-progress" {
    const indice = defeito.attempts.map((item) => item.result).lastIndexOf("pending");
    const tentativa = indice >= 0 ? defeito.attempts[indice] : undefined;
    const antes = tentativa?.note.startsWith("assinatura:") ? tentativa.note.slice("assinatura:".length).split("|")[0] ?? "" : "";
    const testesAntes = Number(tentativa?.note.split("|testes:")[1] ?? Number.NaN);
    let resultado: "resolved" | "progress" | "no-progress";
    if (reproduzido === null) {
      resultado = "resolved";
      defeito.status = "RESOLVED";
    } else {
      const piorou = regressao || (reproduzido.testes !== undefined && Number.isFinite(testesAntes) && reproduzido.testes > testesAntes);
      /*
       * Roteiro e revisão do G4 têm o efeito DENTRO da assinatura (a versão do
       * roteiro; a sessão do gate): a mesma assinatura depois da ação é a prova
       * de que nada mudou — o roteiro saiu igual, a sessão caiu de novo.
       */
      if (tentativa && (tentativa.strategy === "roteiro" || tentativa.strategy === "revisao") && reproduzido.assinatura === antes) tentativa.changed = false;
      resultado = reproduzido.assinatura !== antes && !piorou && tentativa?.changed !== false ? "progress" : "no-progress";
      defeito.status = "OPEN";
    }
    if (tentativa) {
      tentativa.result = resultado;
      if (resultado === "no-progress") {
        defeito.failedStrategies.push({ cycle: this.estado.cycle, strategy: tentativa.strategy, signature: defeito.anchors.signature, afterAttempt: indice });
      }
    }
    return resultado;
  }

  /**
   * A estratégia seguinte da escada que não está bloqueada para o defeito.
   *
   * Bloqueada é a que falhou sem progresso sobre ESTA mesma falha, sem que outra
   * estratégia tenha mudado alguma coisa depois: repeti-la seria pagar de novo
   * pelo que já se sabe que não funciona. A falha que mudou, ou o código que
   * outra estratégia mudou no meio, é a informação nova que a libera.
   */
  proximaEstrategia(defeito: Defect, disponivel: (estrategia: Estrategia, defeito: Defect) => boolean, noProximoCiclo = false): Estrategia | null {
    /*
     * Bloqueia: a mesma falha, sem outra estratégia que tenha MUDADO algo
     * depois; e, das que mudaram código sem progresso, só no ciclo corrente —
     * o ciclo seguinte recomeça a escada com a história inteira no handoff, que
     * é a informação nova (spec §5.2). A que não mudou nada continua bloqueada
     * entre ciclos: repeti-la é pagar de novo pelo mesmo nada.
     */
    const bloqueada = (estrategia: Estrategia): boolean =>
      defeito.failedStrategies.some(
        (falha) =>
          falha.strategy === estrategia &&
          falha.signature === defeito.anchors.signature &&
          (falha.cycle === (noProximoCiclo ? Number.NaN : this.estado.cycle) || defeito.attempts[falha.afterAttempt]?.changed === false) &&
          !defeito.attempts.slice(falha.afterAttempt + 1).some((tentativa) => tentativa.strategy !== estrategia && tentativa.changed !== false),
      );
    // Com progresso, a estratégia que o trouxe continua enquanto houver orçamento (spec §5.2).
    const ultima = [...defeito.attempts].reverse().find((tentativa) => tentativa.result !== "pending");
    if (ultima?.result === "progress" && disponivel(ultima.strategy, defeito) && !bloqueada(ultima.strategy)) return ultima.strategy;
    return (defeito.order ?? escadaDe(defeito.nature)).find((estrategia) => disponivel(estrategia, defeito) && !bloqueada(estrategia)) ?? null;
  }

  /**
   * Nenhum defeito aberto tem estratégia POSSÍVEL — pela capacidade, não pelo
   * orçamento do ciclo: falta de orçamento abre o próximo ciclo; falta de
   * estratégia com informação nova é esgotamento técnico.
   */
  semSaida(possivel: (estrategia: Estrategia, defeito: Defect) => boolean): boolean {
    const abertos = this.estado.defects.filter((defeito) => defeito.status === "OPEN" || defeito.status === "ESCALATED");
    // "No próximo ciclo": o bloqueio que só vale para este ciclo não é impossibilidade (spec §5.2).
    return abertos.length > 0 && abertos.every((defeito) => this.proximaEstrategia(defeito, possivel, true) === null);
  }

  /**
   * A próxima ação, dentro do orçamento — ou null quando o ciclo não tem o que fazer.
   *
   * Três escalas independentes: o ciclo (ações de reparo), o gate (as do gate
   * de cada defeito: o G2 não gasta as do G3) e o defeito (tentativas contra
   * ele). O executor recebe junto os outros defeitos que também esperam por
   * ele, numa chamada só — cada um continua com sua validação.
   */
  planejar(orcamento: OrcamentoDaRecuperacao, disponivel: (estrategia: Estrategia, defeito: Defect) => boolean): AcaoPlanejada | null {
    const uso = this.uso();
    if (uso.repairs >= orcamento.porCiclo) return null;
    const gateDe = (defeito: Defect): string => defeito.gates.at(-1) ?? defeito.discovered.gate;
    const cabe = (defeito: Defect, gatesUsados: Set<string>): boolean =>
      (uso.byDefect[defeito.defectId] ?? 0) < orcamento.porDefeito &&
      (gatesUsados.has(gateDe(defeito)) || (uso.byGate[gateDe(defeito)] ?? 0) < orcamento.porGate);
    // Só o que está aberto recebe ação: o que espera validação espera o gate dele rodar.
    const abertos = this.estado.defects.filter((defeito) => defeito.status === "OPEN");
    for (const defeito of abertos) {
      const estrategia = this.proximaEstrategia(defeito, disponivel);
      if (estrategia === null || !cabe(defeito, new Set())) continue;
      const grupo = [defeito];
      if (estrategia === "executor") {
        const gates = new Set([gateDe(defeito)]);
        for (const outro of abertos) {
          if (outro === defeito || this.proximaEstrategia(outro, disponivel) !== "executor" || !cabe(outro, gates)) continue;
          grupo.push(outro);
          gates.add(gateDe(outro));
        }
      }
      return { estrategia, defeitos: grupo };
    }
    return null;
  }

  /** Consome o orçamento da ação e abre a tentativa de cada defeito do grupo. */
  consumir(acao: AcaoPlanejada, agente: DefectAttempt["agent"], testesFalhando?: number): number {
    this.estado.actions += 1;
    const action = this.estado.actions;
    const at = this.now().toISOString();
    for (const defeito of acao.defeitos) {
      defeito.status = "REPAIRING";
      defeito.costs.calls += 1;
      const testes = testesFalhando !== undefined && (defeito.nature === "suite" || defeito.nature === "integracao-teste") ? `|testes:${testesFalhando}` : "";
      defeito.attempts.push({
        action,
        cycle: this.estado.cycle,
        gate: defeito.gates.at(-1) ?? defeito.discovered.gate,
        strategy: acao.estrategia,
        agent: agente,
        at,
        result: "pending",
        note: `assinatura:${defeito.anchors.signature}${testes}`,
      });
    }
    return action;
  }

  /** A tentativa terminou; o defeito espera a validação pelo gate que o achou. */
  aguardarValidacao(defeitos: readonly Defect[]): void {
    for (const defeito of defeitos) if (defeito.status === "REPAIRING") defeito.status = "AWAITING_VALIDATION";
  }

  /**
   * Abre o próximo ciclo: contadores do ciclo renovados, histórico, código e
   * evidências intactos, e nenhuma volta automática à implementação. A escada
   * recomeça com a história inteira na mão de quem repara — a informação nova.
   */
  novoCiclo(): number {
    this.estado.cycle += 1;
    for (const defeito of this.ativos()) if (defeito.status === "ESCALATED") defeito.status = "OPEN";
    return this.estado.cycle;
  }

  /** Nenhuma estratégia restante neste ciclo para o defeito: escalado (volta a OPEN no ciclo seguinte). */
  escalar(defeito: Defect): void {
    if (ATIVOS.has(defeito.status)) defeito.status = "ESCALATED";
  }
}

/**
 * Os testes que a saída da suíte diz terem falhado — vitest, jest, mocha,
 * pytest, go. Heurística de leitura de log, não gramática: serve para contar
 * (progresso não pode ser "mais testes falhando") e para ancorar a identidade.
 */
export function testesQueFalharam(saida: string): string[] {
  const achados = new Set<string>();
  const padroes = [
    /^\s*(?:FAIL|×|✕|✗)\s+(\S+\.(?:test|spec)\.[cm]?[jt]sx?\b.*?)$/gmu,
    /^\s*FAILED\s+(\S+::\S+)/gmu,
    /^--- FAIL:\s+(\S+)/gmu,
    /^\s*\d+\)\s+(.+?)$/gmu,
  ];
  for (const padrao of padroes) {
    for (const match of saida.matchAll(padrao)) {
      const nome = (match[1] ?? "").replace(/\s+\d+(?:\.\d+)?\s*m?s$/u, "").trim();
      if (nome !== "") achados.add(nome.slice(0, 200));
    }
  }
  return [...achados].sort();
}

/** B0 quando o verificador diz que falta o essencial; B1 é o padrão (§3.1). */
export function severidadeDoAchado(texto: string): "B0" | "B1" {
  return /^\s*(?:\[[^\]]+\]\s*)?B0\s*[:—-]/u.test(texto) ? "B0" : "B1";
}

/**
 * O id de defeito que o verificador citou, conferido em código: tem de ser um
 * dos que ele recebeu desta fase. Citação de id que não existe é descartada.
 */
export function defeitoCitado(texto: string, conhecidos: readonly string[]): string | undefined {
  const citado = /^\s*\[([A-Za-z]\d+-D\d+)\]/u.exec(texto)?.[1];
  return citado !== undefined && conhecidos.includes(citado) ? citado : undefined;
}
