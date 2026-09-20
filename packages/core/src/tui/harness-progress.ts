/**
 * O que o painel do `init` mostra, derivado dos eventos do run.
 *
 * Projeção pura: entra evento, sai modelo. O painel nunca pergunta nada ao
 * orquestrador e nunca altera o que quer que seja — ele observa, e é por isso
 * que pode ser exercitado inteiro sem provider, sem terminal e sem relógio.
 *
 * O painel do loop é outro: as unidades dele são fases e gates, não documentos e
 * auditorias. Misturar os dois num modelo só produziria um painel que não serve
 * direito para nenhum dos dois.
 */

import { PIPELINE_STEPS } from "./labels.js";
import type { Activity, DashboardModel, DashboardEvent, PipelineStep, StepState } from "./dashboard.js";
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
   * Os dois compartilham o painel, e por um tempo o `plan` desenhou o cabeçalho
   * do `init`: "INIT · do prompt ao RALPH READY" numa execução que começa com o
   * esqueleto pronto e termina exatamente no RALPH READY. O rótulo é a única
   * coisa que distingue as duas telas.
   */
  command?: "init" | "plan";
  width?: number;
  environment?: NodeJS.ProcessEnv;
  now?: () => Date;
}

/** Quanto do trabalho de um documento já passou, para o rótulo da etapa. */
const STAGE_LABEL: Record<string, string> = {
  interview: "entrevista",
  authoring: "escrita",
  "self-check": "self-check",
  audit: "auditoria",
  verify: "ensaio do verificador",
  publish: "publicação",
  ready: "prontidão",
};

export class HarnessProgress {
  private readonly startedAt: number;
  private readonly options: HarnessProgressOptions;
  private readonly now: () => Date;
  private readonly estados = new Map<string, StepState>();
  private readonly linhas: DashboardEvent[] = [];

  private etapa = "preflight";
  private situacao: { label: string; state: StepState } = { label: "iniciando", state: "em andamento" };
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

  constructor(options: HarnessProgressOptions) {
    this.options = options;
    this.now = options.now ?? (() => new Date());
    this.startedAt = this.now().getTime();
    this.projeto = options.project;
    for (const passo of PIPELINE_STEPS) this.estados.set(passo.id, "aguardando");
  }

  /** Um evento do run. Documento publicado fecha o passo; devolução marca correção. */
  apply(event: ProgressEvent): void {
    const documento = event.subject.split(":")[0] ?? event.subject;
    // Sem a extensão: o nome do arquivo já é longo e a extensão não informa nada
    // que a linha inteira não diga.
    const curto = documento.replace(/\.md$/, "");
    this.etapa = `${STAGE_LABEL[event.stage] ?? event.stage}${curto && curto !== "-" ? ` · ${curto}` : ""}`;

    if (this.estados.has(documento)) {
      if (event.stage === "publish" && event.status === "complete") this.estados.set(documento, "concluído");
      else if (event.status === "blocked") this.estados.set(documento, "falhou");
      else if (this.estados.get(documento) !== "concluído") this.estados.set(documento, "em andamento");
    }

    if (event.status === "retry") this.correcoes += 1;
    if (event.status === "blocked") this.situacao = { label: "bloqueado", state: "falhou" };
    else if (event.stage === "ready" && event.status === "complete") this.situacao = { label: "RALPH READY", state: "concluído" };
    else this.situacao = { label: "em andamento", state: "em andamento" };
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

  /** A pergunta da vez ocupa o corpo do painel; `null` devolve a janela de log. */
  asking(pergunta: { title: string; body: string[] } | null): void {
    this.pergunta = pergunta;
  }

  /** Chamando o provider: é a espera mais longa e a que mais parece travamento. */
  beginCall(detail: string): void {
    this.atividade = { kind: "modelo", detail, desde: this.now().getTime() };
  }

  /** A vez é do desenvolvedor: a tela precisa dizer isso com todas as letras. */
  waitingForDeveloper(): void {
    this.atividade = { kind: "você", detail: "", desde: this.now().getTime() };
  }

  /** Parou, e por quê. */
  halted(detail: string): void {
    this.atividade = { kind: "parado", detail, desde: this.now().getTime() };
  }

  /** Avança o pulso. Quadro que muda é prova de vida; número parado não é. */
  tick(): void {
    this.quadro += 1;
  }

  /** Uma linha para o log visível. Mantém só as últimas; painel não é histórico. */
  note(text: string): void {
    this.linhas.push({ time: this.now().toISOString().slice(11, 19), text });
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
    return PIPELINE_STEPS.map((passo) => ({
      label: passo.label,
      state: this.estados.get(passo.id) ?? "aguardando",
    }));
  }

  model(): DashboardModel {
    return {
      version: this.options.version,
      command: this.options.command ?? "init",
      subtitle:
        (this.options.command ?? "init") === "plan"
          ? "plan · detalhamento · do esqueleto ao RALPH READY"
          : "init · esqueleto · do pedido ao PLAN READY",
      project: this.projeto,
      stage: this.etapa,
      status: this.situacao,
      durationSeconds: Math.max(0, Math.round((this.now().getTime() - this.startedAt) / 1000)),
      pipeline: this.pipeline(),
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
