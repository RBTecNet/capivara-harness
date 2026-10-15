/**
 * O que o painel dos comandos mostra, derivado dos eventos do run.
 *
 * Projeção pura: entra evento, sai modelo. O painel nunca pergunta nada ao
 * orquestrador e nunca altera o que quer que seja — ele observa, e é por isso
 * que pode ser exercitado inteiro sem provider, sem terminal e sem relógio.
 *
 * O painel do loop é outro: as unidades dele são fases e gates, não documentos e
 * auditorias. Misturar os dois num modelo só produziria um painel que não serve
 * direito para nenhum dos dois.
 */

import type { WorkerRow } from "./build-workers.js";
import { PIPELINE_STEPS } from "./labels.js";
import type { BuildPhaseRow } from "./build-phases.js";
import type { Activity, DashboardModel, DashboardEvent, PipelineStep, ProgressBar, StepState, WorkField } from "./dashboard.js";
import type { Style } from "./ansi.js";

export interface ProgressEvent {
  stage: string;
  subject: string;
  status: "started" | "complete" | "retry" | "blocked";
  detail: string;
  attempt: number;
}

export interface HarnessProgressOptions {
  version: string;
  project: string;
  roles?: { role: string; provider: string; model: string }[];
  provider: { perfil: string; transporte: string; contabilidade: string };
  style: Style;
  /**
   * Qual estágio do ciclo está na tela.
   *
   * Cada comando anuncia seu destino e suas próprias etapas no mesmo painel.
   */
  command?: "init" | "plan" | "build" | "prompt-engineer";
  width?: number;
  environment?: NodeJS.ProcessEnv;
  now?: () => Date;
}

/** Quanto do trabalho de um documento já passou, para o rótulo da etapa. */
/** O que cada comando anuncia como destino, no cabeçalho do painel. */
const SUBTITLE: Record<NonNullable<HarnessProgressOptions["command"]>, string> = {
  init: "init · esqueleto · do pedido ao PLAN READY",
  plan: "plan · detalhamento · do esqueleto ao RALPH READY",
  build: "build · ralph · do plano executável à aplicação",
  "prompt-engineer": "prompt engineer · do pedido cru ao prompt estruturado",
};

const PROMPT_PIPELINE_STEPS = [
  { id: "receiving", label: "recebimento do prompt" },
  { id: "analysis", label: "análise de lacunas" },
  { id: "interview", label: "entrevista" },
  { id: "authoring", label: "organização do prompt" },
  { id: "publish", label: "gravação do prompt" },
] as const;

const PROMPT_STAGE_LABEL: Record<string, string> = {
  receiving: "recebimento do prompt",
  analysis: "análise de lacunas",
  interview: "entrevista · esclarecimento de dúvidas",
  authoring: "organização do prompt",
  publish: "gravação do prompt",
};

const STAGE_LABEL: Record<string, string> = {
  interview: "entrevista",
  authoring: "escrita",
  "self-check": "self-check",
  audit: "auditoria",
  verify: "ensaio do verificador",
  publish: "publicação",
  ready: "prontidão",
};

/**
 * A hora que a pessoa vê é a do relógio DELA.
 *
 * O painel mostrava `toISOString()`, que é UTC: às nove da noite em Brasília a
 * tela dizia meia-noite, e quem cruzasse a tela com o próprio relógio somava três
 * horas na cabeça o run inteiro.
 *
 * O que vai para `events.tsv` continua em ISO com fuso zero, de propósito: ali o
 * valor precisa ser ordenável, comparável entre máquinas e não ambíguo daqui a
 * seis meses. Registro em UTC, tela no fuso de quem olha.
 */
function horaLocal(instante: Date): string {
  return instante.toLocaleTimeString("pt-BR", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export class HarnessProgress {
  private readonly startedAt: number;
  private readonly options: HarnessProgressOptions;
  private readonly now: () => Date;
  private readonly estados = new Map<string, StepState>();
  private readonly linhas: DashboardEvent[] = [];

  private etapa = "preflight";
  private situacao: { label: string; state: StepState } = { label: "iniciando", state: "em andamento" };
  private teclas: string | null = null;
  private atividade: { kind: Activity["kind"]; detail: string; desde: number } = {
    kind: "modelo",
    detail: "preparando",
    desde: Date.now(),
  };
  private quadro = 0;
  private pergunta: { title: string; body: string[] } | null = null;
  private projeto: string;
  private chamadas = 0;
  private entrada = 0;
  private saida = 0;
  private custo: number | null = null;
  private correcoes = 0;
  private fases: { rows: BuildPhaseRow[]; summary: string; maxRows: number; columns?: readonly string[]; legend?: readonly string[]; anchorId?: string } | null = null;
  /**
   * A última coisa que deu errado, guardada.
   *
   * O painel via toda devolução passar e não guardava nenhuma: quem chegava na
   * frente da tela depois de dez minutos via "em andamento" e a fase corrente,
   * sem nada sobre o que tinha feito o ciclo anterior voltar. É a pergunta que
   * mais se faz olhando um build, e a resposta estava a um campo de distância.
   */
  private ultimoErro = "";
  private agentes: WorkerRow[] | null = null;
  /** Uma linha de contexto para a caixa de progresso — o comando de teste, por exemplo. */
  private nota = "";

  constructor(options: HarnessProgressOptions) {
    this.options = options;
    this.now = options.now ?? (() => new Date());
    this.startedAt = this.now().getTime();
    this.projeto = options.project;
    const passos = options.command === "prompt-engineer" ? PROMPT_PIPELINE_STEPS : PIPELINE_STEPS;
    for (const passo of passos) this.estados.set(passo.id, "aguardando");
    if (options.command === "prompt-engineer") this.setStage("receiving");
  }

  /** Um evento do run. Documento publicado fecha o passo; devolução marca correção. */
  apply(event: ProgressEvent): void {
    const documento = event.subject.split(":")[0] ?? event.subject;
    // Sem a extensão: o nome do arquivo já é longo e a extensão não informa nada
    // que a linha inteira não diga.
    const curto = documento.replace(/\.md$/, "");
    if (this.options.command === "prompt-engineer") this.setStage(event.stage);
    else this.etapa = `${STAGE_LABEL[event.stage] ?? event.stage}${curto && curto !== "-" ? ` · ${curto}` : ""}`;

    if (this.estados.has(documento)) {
      if (event.stage === "publish" && event.status === "complete") this.estados.set(documento, "concluído");
      else if (event.status === "blocked") this.estados.set(documento, "falhou");
      else if (this.estados.get(documento) !== "concluído") this.estados.set(documento, "em andamento");
    }

    if (event.status === "retry") this.correcoes += 1;
    if ((event.status === "retry" || event.status === "blocked") && event.detail.trim() !== "") {
      // A primeira linha basta: o detalhe de uma devolução costuma ser um
      // parágrafo, e a caixa tem uma linha.
      this.ultimoErro = event.detail.split("\n")[0]?.trim() ?? "";
    }
    if (event.status === "blocked") {
      this.situacao = { label: "bloqueado", state: "falhou" };
      if (this.options.command === "prompt-engineer") {
        for (const [id, estado] of this.estados) if (estado === "em andamento") this.estados.set(id, "falhou");
      }
    } else if (event.stage === "ready" && event.status === "complete") {
      if (this.options.command === "prompt-engineer") this.completed();
      else this.situacao = { label: "RALPH READY", state: "concluído" };
    } else this.situacao = { label: "em andamento", state: "em andamento" };
  }

  /**
   * O nome do produto, quando ele passa a existir.
   *
   * Até a documentação nascer, o que há é uma pasta; depois dela, o projeto tem
   * nome próprio, e é ele que diz a quem olha de que trabalho se trata.
   */
  setProject(nome: string): void {
    if (nome.trim() !== "") this.projeto = nome.trim();
  }

  /**
   * A etapa mostrada em ETAPA ATUAL.
   *
   * No init ela vem dos eventos do orquestrador. No build, quem sabe dizer é o
   * loop — a fase e o ciclo em que ela está.
   */
  setStage(etapa: string): void {
    const nome = etapa.trim();
    if (nome === "") return;
    if (this.options.command !== "prompt-engineer") {
      this.etapa = nome;
      return;
    }

    this.etapa = PROMPT_STAGE_LABEL[nome] ?? nome;
    const indice = PROMPT_PIPELINE_STEPS.findIndex((passo) => passo.id === nome);
    if (indice < 0) return;
    for (const [posicao, passo] of PROMPT_PIPELINE_STEPS.entries()) {
      if (posicao < indice) this.estados.set(passo.id, "concluído");
      else if (posicao === indice) this.estados.set(passo.id, "em andamento");
      else this.estados.set(passo.id, "aguardando");
    }
    this.situacao = { label: this.etapa, state: "em andamento" };
  }

  /** A pergunta da vez ocupa o corpo do painel; `null` devolve a janela de log. */
  asking(pergunta: { title: string; body: string[] } | null): void {
    this.pergunta = pergunta;
  }

  /** Chamando o provider: é a espera mais longa e a que mais parece travamento. */
  beginCall(detail: string): void {
    const trabalhando = this.options.command === "prompt-engineer";
    this.atividade = { kind: "modelo", detail: trabalhando ? `modelo trabalhando · ${detail}` : detail, desde: this.now().getTime() };
    if (trabalhando) this.situacao = { label: "modelo trabalhando", state: "em andamento" };
  }

  /** A vez é do desenvolvedor: a tela precisa dizer isso com todas as letras. */
  waitingForDeveloper(): void {
    this.atividade = { kind: "você", detail: "", desde: this.now().getTime() };
    if (this.options.command === "prompt-engineer") this.situacao = { label: "aguardando sua resposta", state: "aguardando" };
  }

  /** A pessoa pausou o build; `detail` diz como retomar. */
  paused(detail: string): void {
    this.atividade = { kind: "pausado", detail, desde: this.now().getTime() };
  }

  /** As teclas que o painel atende, para o rodapé. */
  setKeys(teclas: string | null): void {
    this.teclas = teclas;
  }

  /** Parou, e por quê. */
  halted(detail: string): void {
    this.atividade = { kind: "parado", detail, desde: this.now().getTime() };
    if (this.options.command === "prompt-engineer") {
      this.situacao = { label: "interrompido", state: "falhou" };
      for (const [id, estado] of this.estados) if (estado === "em andamento") this.estados.set(id, "falhou");
    }
  }

  /** O resultado foi gravado; encerra as etapas e a pergunta corrente. */
  completed(detail = this.options.command === "prompt-engineer" ? "prompt estruturado pronto" : "concluído"): void {
    for (const id of this.estados.keys()) this.estados.set(id, "concluído");
    this.etapa = detail;
    this.situacao = { label: this.options.command === "prompt-engineer" ? "prompt pronto" : "concluído", state: "concluído" };
    this.pergunta = null;
    this.atividade = { kind: "modelo", detail, desde: this.now().getTime() };
  }

  /** Avança o pulso. Quadro que muda é prova de vida; número parado não é. */
  tick(): void {
    this.quadro += 1;
  }

  /** Uma linha para o log visível. Mantém só as últimas; painel não é histórico. */
  note(text: string): void {
    this.linhas.push({ time: horaLocal(this.now()), text });
    if (this.linhas.length > 12) this.linhas.splice(0, this.linhas.length - 12);
  }

  /** Contabilidade de uma chamada ao provider. */
  charge(usage?: { inputTokens: number; outputTokens: number; costUsd?: number }): void {
    this.chamadas += 1;
    if (!usage) return;
    this.entrada += usage.inputTokens;
    this.saida += usage.outputTokens;
    if (usage.costUsd !== undefined) this.custo = (this.custo ?? 0) + usage.costUsd;
  }

  private pipeline(): PipelineStep[] {
    const passos = this.options.command === "prompt-engineer" ? PROMPT_PIPELINE_STEPS : PIPELINE_STEPS;
    return passos.map((passo) => ({
      label: passo.label,
      state: this.estados.get(passo.id) ?? "aguardando",
    }));
  }

  /**
   * As fases do build, com os gates de cada uma.
   *
   * Quem acompanha o andamento é o `BuildPhaseTracker`; o painel só recebe as
   * linhas prontas. `maxRows` vem de quem desenha, porque só ele sabe a altura
   * do terminal.
   */
  setPhases(rows: BuildPhaseRow[], summary: string, maxRows: number, columns?: readonly string[], legend?: readonly string[], anchorId?: string): void {
    this.fases = { rows, summary, maxRows, ...(columns ? { columns } : {}), ...(legend ? { legend } : {}), ...(anchorId ? { anchorId } : {}) };
  }

  /** Os agentes do build paralelo; `null` some com a caixa. */
  setWorkers(rows: WorkerRow[] | null): void {
    this.agentes = rows;
  }

  /** Uma linha de contexto para a caixa de progresso. O build usa para o comando de teste. */
  setNote(nota: string): void {
    this.nota = nota.trim();
  }

  /**
   * As contagens do estágio, para as barras.
   *
   * Cada estágio conta o que ele tem, e todos têm alguma coisa — era por isso que
   * a caixa podia ser a mesma em todos. Com fases na tela, contam-se fases e as
   * tasks que elas carregam; sem fases, contam-se as etapas do pipeline, que é o
   * que o `init` tem antes de existir uma fase.
   */
  private progresso(): ProgressBar[] {
    const linhas = this.fases?.rows ?? [];
    if (linhas.length > 0) {
      const colunas = this.fases?.columns ?? [];
      // No `plan` a primeira coluna é a escrita; no `build` o que fecha é o estado.
      const escritas = colunas.includes("E")
        ? linhas.filter((linha) => linha.gates.E === "verde").length
        : linhas.filter((linha) => linha.state === "concluído").length;
      const fechadas = linhas.filter((linha) => linha.state === "concluído").length;
      const comTasks = linhas.filter((linha) => linha.tasks !== undefined);

      return [
        { label: colunas.includes("E") ? "Escritas" : "Fases", done: escritas, total: linhas.length },
        ...(colunas.includes("E") ? [{ label: "Aprovadas", done: fechadas, total: linhas.length }] : []),
        ...(comTasks.length > 0
          ? [
              {
                label: "Tasks",
                done: comTasks.filter((linha) => linha.state === "concluído").reduce((total, linha) => total + (linha.tasks ?? 0), 0),
                total: comTasks.reduce((total, linha) => total + (linha.tasks ?? 0), 0),
              },
            ]
          : []),
      ];
    }

    const passos = this.pipeline();
    return passos.length === 0
      ? []
      : [{ label: "Etapas", done: passos.filter((passo) => passo.state === "concluído").length, total: passos.length }];
  }

  /**
   * O trabalho corrente, campo a campo.
   *
   * O que quem olha pergunta, nesta ordem: em que ponto está, há quanto tempo, e
   * o que deu errado da última vez. Os três estavam no painel — espalhados entre
   * a linha de etapa, a de atividade e a janela de log, que rola.
   */
  private trabalho(): WorkField[] {
    const corrente = (this.fases?.rows ?? []).find((linha) => linha.state === "em andamento");
    const gateCorrente = corrente
      ? Object.entries(corrente.gates).find(([, estado]) => estado === "corrente")?.[0]
      : undefined;

    return [
      ...(corrente ? [{ label: "Fase", value: `${corrente.id} · ${corrente.title}` }] : []),
      ...(corrente && corrente.detail !== "" ? [{ label: "Situação", value: corrente.detail }] : []),
      ...(gateCorrente ? [{ label: "Gate", value: gateCorrente }] : []),
      { label: "Etapa", value: this.etapa },
      { label: "Atividade", value: this.atividade.detail },
      { label: "Último erro", value: this.ultimoErro === "" ? "—" : this.ultimoErro },
    ];
  }

  model(): DashboardModel {
    return {
      version: this.options.version,
      command: this.options.command ?? "init",
      subtitle: SUBTITLE[this.options.command ?? "init"],
      project: this.projeto,
      stage: this.etapa,
      status: this.situacao,
      durationSeconds: Math.max(0, Math.round((this.now().getTime() - this.startedAt) / 1000)),
      pipeline: this.pipeline(),
      ...(this.fases ? { phases: this.fases } : {}),
      ...(this.agentes ? { workers: this.agentes } : {}),
      progress: this.progresso(),
      ...(this.nota === "" ? {} : { progressNote: this.nota }),
      work: this.trabalho(),
      provider: this.options.provider,
      telemetry: [
        { label: "CHAMADAS", value: String(this.chamadas) },
        { label: "ENTRADA", value: this.entrada === 0 ? "não medido" : this.entrada.toLocaleString("pt-BR") },
        { label: "SAÍDA", value: this.saida === 0 ? "não medido" : this.saida.toLocaleString("pt-BR") },
        { label: "CUSTO", value: this.custo === null ? "não informado" : `US$ ${this.custo.toFixed(4)}` },
        { label: "DEVOLUÇÕES", value: String(this.correcoes) },
      ],
      events: [...this.linhas],
      ...(this.pergunta ? { question: this.pergunta } : {}),
      ...(this.teclas ? { keys: this.teclas } : {}),
      activity: {
        kind: this.atividade.kind,
        detail: this.atividade.detail,
        sinceSeconds: Math.max(0, Math.round((this.now().getTime() - this.atividade.desde) / 1000)),
      },
      frame: this.quadro,
      ...(this.options.roles !== undefined ? { roles: this.options.roles } : {}),
      style: this.options.style,
      ...(this.options.width !== undefined ? { width: this.options.width } : {}),
      ...(this.options.environment !== undefined ? { environment: this.options.environment } : {}),
    };
  }
}
