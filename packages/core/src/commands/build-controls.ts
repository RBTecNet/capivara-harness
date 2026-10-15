/**
 * Os controles do build enquanto ele roda: pausar e ver uma fase.
 *
 * O build é a etapa de horas, e até aqui o terminal só deixava olhar o painel
 * ou interromper tudo com Ctrl-C. Duas coisas faltavam: parar sem perder a
 * sessão em andamento — para ir almoçar, ou para olhar o que a fase 3 escreveu
 * antes da 4 começar em cima — e ler o que uma fase pede sem sair do build.
 *
 * Nada aqui toca o loop. A pausa segura a próxima CHAMADA DE MODELO, que passa
 * toda pelo `call` do CLI: a sessão de agente em andamento termina, a suíte ou
 * os fluxos que estiverem rodando terminam, e o build espera antes de abrir a
 * sessão seguinte. Matar um agente no meio deixaria a árvore de trabalho num
 * estado que nenhum gate avaliou.
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { splitPhases } from "../loop/split.js";
import { GATES, type BuildPhaseRow } from "../tui/build-phases.js";
import { paint, type Style } from "../tui/ansi.js";
import type { Modal } from "../tui/modal.js";

export type EstadoDaPausa = "rodando" | "pausa pedida" | "pausado";

export class PauseGate {
  private pedida = false;
  private retomar: (() => void) | null = null;

  get state(): EstadoDaPausa {
    if (this.retomar) return "pausado";
    return this.pedida ? "pausa pedida" : "rodando";
  }

  /**
   * A tecla de pausa: pede, desiste do pedido, ou retoma.
   *
   * Pedir duas vezes antes de a pausa acontecer desiste dela — a mesma tecla
   * que pediu é a que volta atrás, sem uma terceira tecla para decorar.
   */
  toggle(): "pedida" | "cancelada" | "retomada" {
    if (this.retomar) {
      const retomar = this.retomar;
      this.retomar = null;
      this.pedida = false;
      retomar();
      return "retomada";
    }
    this.pedida = !this.pedida;
    return this.pedida ? "pedida" : "cancelada";
  }

  /** Chamado antes de cada chamada de modelo; segura enquanto a pausa durar. */
  async wait(onPaused: () => void): Promise<boolean> {
    if (!this.pedida) return false;
    await new Promise<void>((resolve) => {
      this.retomar = resolve;
      onPaused();
    });
    return true;
  }
}

/** As teclas que o painel do build atende, para o rodapé. */
export function teclasDoBuild(estado: EstadoDaPausa, paralelo = false): string {
  const base =
    estado === "pausado" ? "p retoma · f vê uma fase" : estado === "pausa pedida" ? "p desiste da pausa · f vê uma fase" : "p pausa · f vê uma fase";
  // No paralelo, a caixa AGENTES tem cursor: as setas escolhem, o Enter abre o log (§98).
  return paralelo ? `↑ ↓ agente · Enter log · ${base}` : base;
}

const NOME_DO_GATE: Record<(typeof GATES)[number], string> = {
  G0: "engine",
  G1: "escrita",
  G2: "suíte",
  G3: "verificação",
  G4: "fluxos",
};

const COR_DO_GATE = { verde: "green", vermelho: "red", corrente: "yellow", neutro: "gray", aguardando: "gray" } as const;
const MARCA_DO_GATE = { verde: "●", vermelho: "●", corrente: "◐", neutro: "●", aguardando: "○" } as const;

/** O texto da fase, lido do plano pelo mesmo parser que o loop usa. */
export async function textoDaFase(projectRoot: string, id: string): Promise<string | null> {
  const plano = await readFile(join(projectRoot, ".capivara/init/project-phases.md"), "utf8").catch(() => null);
  if (plano === null) return null;
  const dividido = splitPhases(plano, projectRoot, "build");
  if (!dividido.ok) return null;
  return dividido.sessions.find((sessao) => sessao.id === id)?.markdown ?? null;
}

/**
 * A telinha de uma fase: estado e gates fixos em cima, o texto da fase rolando.
 *
 * Os eventos recentes que citam a fase vêm no fim do corpo — é ali que está o
 * "o que aconteceu", e o texto do plano é o "o que se pediu".
 */
export function modalDaFase(
  fase: BuildPhaseRow,
  texto: string | null,
  eventos: readonly { time: string; text: string }[],
  style: Style,
): Modal {
  const gates = GATES.filter((gate) => fase.gates[gate] !== undefined)
    .map((gate) => {
      const estado = fase.gates[gate]!;
      return `${paint(MARCA_DO_GATE[estado], COR_DO_GATE[estado], style)} ${gate} ${NOME_DO_GATE[gate]}`;
    })
    .join("   ");
  const daFase = eventos.filter((evento) => evento.text.includes(fase.id));

  return {
    titulo: `${fase.id} · ${fase.title}`,
    cabecalho: [
      `${paint("estado".padEnd(9), "cyan", style)}${fase.state}${fase.detail && fase.detail !== fase.state ? ` · ${fase.detail}` : ""}`,
      `${paint("gates".padEnd(9), "cyan", style)}${gates}`,
      ...(fase.tasks !== undefined ? [`${paint("tasks".padEnd(9), "cyan", style)}${fase.tasks}`] : []),
    ],
    corpo: [
      ...(texto === null ? [paint("o texto desta fase não pôde ser lido do plano (.capivara/init/project-phases.md)", "yellow", style)] : texto.split("\n")),
      ...(daFase.length > 0 ? ["", paint("Eventos recentes desta fase", "cyan", style), ...daFase.map((evento) => `  [${evento.time}] ${evento.text}`)] : []),
    ],
    dica: "↑ ↓ rola · PgUp PgDn página · q volta à lista de fases",
  };
}
