/**
 * O estado da tela do build.
 *
 * Recebe o que o loop conta e mantém uma linha por fase. É o equivalente do
 * `HarnessProgress` para o outro lado do ciclo: o loop emite e segue, e isto
 * acumula o suficiente para desenhar sem nunca perguntar nada de volta.
 */

import type { BuildProgress } from "../loop/progress.js";
import { resumoDaTransicao } from "../loop/narrador.js";
import { emptyGates, phaseSummary, type BuildPhaseRow, type GateId } from "./build-phases.js";

export class BuildPhaseTracker {
  private readonly ordem: string[] = [];
  private readonly linhas = new Map<string, BuildPhaseRow>();
  private cicloPorFase = new Map<string, number>();

  /** O plano inteiro, antes de a primeira fase começar. */
  plan(phases: readonly { id: string; title: string; taskCount?: number }[]): void {
    for (const phase of phases) {
      if (this.linhas.has(phase.id)) continue;
      this.ordem.push(phase.id);
      this.linhas.set(phase.id, {
        id: phase.id,
        title: phase.title,
        state: "aguardando",
        gates: emptyGates(),
        detail: "aguardando",
        ...(phase.taskCount !== undefined ? { tasks: phase.taskCount } : {}),
      });
    }
  }

  apply(event: BuildProgress): void {
    /*
     * Uma fase pode aparecer sem ter sido planejada — um build retomado conta o
     * que já fez antes de anunciar o plano. Criar a linha na hora custa nada e
     * evita que o evento se perca.
     */
    const linha = this.linhas.get(event.id) ?? this.criar(event.id);

    if (event.kind === "phase") {
      /*
       * Ciclo novo zera os gates.
       *
       * Sem isto, a fase que voltou do gate 2 continuaria mostrando o gate 3
       * verde da passagem anterior — um gate que ninguém ainda avaliou nesta
       * volta. A tela diria que a fase está mais adiantada do que está.
       *
       * Só um ciclo NOVO zera. Desfecho — concluída, falhou, pulada — preserva
       * os gates: eles são a explicação do resultado, e apagar o gate vermelho
       * de uma fase que falhou joga fora exatamente o que quem olha procura.
       */
      // De volta à fila: a próxima vez que ela rodar recomeça do ciclo 1, com os gates apagados.
      if (event.state === "aguardando") {
        this.cicloPorFase.delete(event.id);
        linha.gates = emptyGates();
      }
      if (event.state === "em andamento" && event.cycle > 0 && this.cicloPorFase.get(event.id) !== event.cycle) {
        this.cicloPorFase.set(event.id, event.cycle);
        linha.gates = emptyGates();
      }
      linha.state = event.state;
      linha.detail = event.detail;
      return;
    }

    /*
     * A recuperação muda o detalhe da fase, nunca os gates: quem diz o estado de
     * um gate é o evento do gate. O texto é o resumo da mesma transição que foi
     * ao `events.tsv` e ao relatório (§125 G).
     */
    if (event.kind === "recovery") {
      linha.detail = resumoDaTransicao(event.transition);
      return;
    }

    linha.gates[event.gate as GateId] = event.state;
  }

  private criar(id: string): BuildPhaseRow {
    const linha: BuildPhaseRow = { id, title: id, state: "aguardando", gates: emptyGates(), detail: "aguardando" };
    this.ordem.push(id);
    this.linhas.set(id, linha);
    return linha;
  }

  rows(): BuildPhaseRow[] {
    return this.ordem.flatMap((id) => {
      const linha = this.linhas.get(id);
      return linha ? [{ ...linha, gates: { ...linha.gates } }] : [];
    });
  }

  summary(): string {
    return phaseSummary(this.rows());
  }

  /** A fase em execução, para o painel dizer o que está acontecendo agora. */
  current(): BuildPhaseRow | null {
    return this.rows().find((row) => row.state === "em andamento") ?? null;
  }
}
