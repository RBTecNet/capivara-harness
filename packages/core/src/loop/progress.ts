/**
 * O que o loop conta enquanto constrói.
 *
 * O `announce` do build sempre existiu, mas ele é prosa: serve para o log e não
 * para uma tela que se redesenha. Quem desenha precisa saber, a cada instante,
 * em que fase o build está e em que gate daquela fase — e isso o loop já sabia,
 * sem dizer a ninguém.
 *
 * O loop emite e segue. Quem ouve desenha, ou não ouve: nenhum caminho de
 * execução depende de haver um ouvinte.
 */

import type { Transicao } from "./narrador.js";

/** Os cinco gates, na ordem em que a fase passa por eles. */
export type LoopGate = "G0" | "G1" | "G2" | "G3" | "G4";

/**
 * `neutro` é o gate avaliado que não tem nada a dizer.
 *
 * O gate 1 pergunta "a sessão escreveu alguma coisa?", e a resposta "não" é
 * informação, não reprovação: numa fase já implementada, não escrever é o
 * comportamento certo. Pintá-la de vermelho ao lado dos gates que de fato
 * reprovam faz a tela dizer que algo falhou numa fase que fechou inteira.
 */
export type LoopGateState = "corrente" | "verde" | "vermelho" | "neutro";

/** `aguardando` é a fase que voltou para a fila — no build paralelo, depois de um conflito de integração. */
export type LoopPhaseState = "aguardando" | "em andamento" | "concluído" | "falhou" | "pulado";

export type BuildProgress =
  | { kind: "phase"; id: string; state: LoopPhaseState; cycle: number; detail: string }
  | { kind: "gate"; id: string; gate: LoopGate; state: LoopGateState; cycle: number }
  /**
   * Uma transição da recuperação (§125 G): defeito, estratégia, revalidação,
   * ciclo novo, gate não aplicável. `line` é a mesma linha que vai ao
   * `events.tsv` e ao relatório; quem desenha não monta texto próprio.
   */
  | { kind: "recovery"; id: string; cycle: number; line: string; transition: Transicao };

export type BuildProgressListener = (event: BuildProgress) => void;

/**
 * O que cada agente do build paralelo está fazendo (§97).
 *
 * Separado do `BuildProgress` porque responde a outra pergunta: a lista de
 * fases diz onde o PLANO está; isto diz onde está cada AGENTE — qual fase ele
 * pegou, se ainda está preparando o worktree, se já entregou e espera a vez de
 * integrar.
 */
export type WorkerState = "livre" | "preparando" | "trabalhando" | "integrando";

export interface WorkerProgress {
  /** A partir de 0; a tela mostra a partir de 1. */
  slot: number;
  state: WorkerState;
  phaseId: string | null;
  /** O desfecho mais recente, quando o agente ficou livre: `P03 integrada`, `P04 conflito`. */
  detail: string;
}

export type WorkerProgressListener = (event: WorkerProgress) => void;
