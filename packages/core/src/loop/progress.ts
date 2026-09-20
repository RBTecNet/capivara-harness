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

/** Os cinco gates, na ordem em que a fase passa por eles. */
export type LoopGate = "G0" | "G1" | "G2" | "G3" | "G4";

export type LoopGateState = "corrente" | "verde" | "vermelho";

export type LoopPhaseState = "em andamento" | "concluído" | "falhou" | "pulado";

export type BuildProgress =
  | { kind: "phase"; id: string; state: LoopPhaseState; cycle: number; detail: string }
  | { kind: "gate"; id: string; gate: LoopGate; state: LoopGateState; cycle: number };

export type BuildProgressListener = (event: BuildProgress) => void;
