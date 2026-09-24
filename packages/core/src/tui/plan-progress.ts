/**
 * O estado da tela do `plan`.
 *
 * Equivalente do `BuildPhaseTracker` para o outro estágio, e deliberadamente o
 * mesmo desenho: duas colunas em vez de cinco — **E**scrita e **A**uditoria —
 * porque são as duas coisas que acontecem com uma fase antes de ela estar
 * pronta.
 */

import { emptyPlanColumns, PLAN_COLUMNS, type BuildPhaseRow } from "./build-phases.js";
import type { PlanPhaseEvent } from "../init/progress.js";

export { PLAN_COLUMNS };

/** A legenda da tabela do plan. A do build fala de gates que aqui não existem. */
export const PLAN_LEGEND = ["E escrita", "A auditoria"] as const;

export class PlanPhaseTracker {
  private readonly ordem: number[] = [];
  private readonly linhas = new Map<number, BuildPhaseRow>();
  /** O que o documento inteiro está fazendo, quando não é uma fase. */
  private documento = "";
  /** A última fase que mudou: é onde a janela deve estar olhando. */
  private ultima = "";

  apply(event: PlanPhaseEvent): void {
    if (event.kind === "planned") {
      for (const fase of event.phases) {
        if (this.linhas.has(fase.number)) continue;
        this.ordem.push(fase.number);
        this.linhas.set(fase.number, {
          id: `P${String(fase.number).padStart(2, "0")}`,
          title: fase.title,
          state: "aguardando",
          gates: emptyPlanColumns(),
          detail: "aguardando",
        });
      }
      return;
    }

    if (event.kind === "documento") {
      this.documento = event.etapa;
      return;
    }

    const linha = this.linhas.get(event.number) ?? this.criar(event.number);
    this.ultima = linha.id;

    if (event.kind === "authoring") {
      if (event.state === "corrente") {
        linha.state = "em andamento";
        linha.gates.E = "corrente";
        linha.detail = "escrevendo";
      } else if (event.state === "reused") {
        /*
         * Reaproveitada é verde, e não cinza.
         *
         * A fase ESTÁ escrita — o que não houve foi a chamada. Pintá-la de
         * apagado faria a tela sugerir que falta fazer algo ali.
         */
        linha.state = "em andamento";
        linha.gates.E = "verde";
        linha.detail = "reaproveitada";
      } else {
        // Escrita não é concluída: a fase só fecha quando a auditoria aprova.
        linha.state = "em andamento";
        linha.gates.E = "verde";
        linha.detail = "escrita";
      }
      return;
    }

    if (event.state === "corrente") {
      linha.state = "em andamento";
      linha.gates.A = "corrente";
      linha.detail = "auditando";
      return;
    }

    if (event.state === "aprovada") {
      linha.state = "concluído";
      linha.gates.A = "verde";
      linha.detail = "aprovada";
      return;
    }

    linha.state = "em andamento";
    linha.gates.A = "vermelho";
    linha.detail = event.findings === undefined ? "devolvida" : `devolvida · ${event.findings} finding(s)`;
  }

  private criar(numero: number): BuildPhaseRow {
    const linha: BuildPhaseRow = {
      id: `P${String(numero).padStart(2, "0")}`,
      title: "",
      state: "aguardando",
      gates: emptyPlanColumns(),
      detail: "",
    };
    this.ordem.push(numero);
    this.linhas.set(numero, linha);
    return linha;
  }

  rows(): BuildPhaseRow[] {
    return this.ordem.map((numero) => this.linhas.get(numero)!).filter((linha) => linha !== undefined);
  }

  /**
   * `12 escritas · 3 aprovadas de 18` — e não `3/18 fases`.
   *
   * O resumo do build conta uma coisa só porque lá uma fase ou fechou ou não.
   * Aqui há duas etapas, e durante a escrita — que é metade do estágio — o
   * contador de aprovadas fica em zero: a tela dizia "0/18" com doze linhas
   * escritas na frente, o que parece um run que não saiu do lugar.
   */
  summary(): string {
    const linhas = this.rows();
    const escritas = linhas.filter((linha) => linha.gates.E === "verde").length;
    const aprovadas = linhas.filter((linha) => linha.state === "concluído").length;
    const base = `${escritas} escrita(s) · ${aprovadas} aprovada(s) de ${linhas.length}`;
    return this.documento === "" ? base : `${base} · ${this.documento}`;
  }

  /** Onde a janela deve olhar. Vazio antes do primeiro evento de fase. */
  get foco(): string {
    return this.ultima;
  }

  get vazio(): boolean {
    return this.ordem.length === 0;
  }
}
