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

/**
 * `neutro` é o gate avaliado que não tem nada a dizer.
 *
 * O gate 1 pergunta "a sessão escreveu alguma coisa?", e a resposta "não" é
 * informação, não reprovação: numa fase já implementada, não escrever é o
 * comportamento certo. Pintá-la de vermelho ao lado dos gates que de fato
 * reprovam faz a tela dizer que algo falhou numa fase que fechou inteira.
 */
export type LoopGateState = "corrente" | "verde" | "vermelho" | "neutro";

export type LoopPhaseState = "em andamento" | "concluído" | "falhou" | "pulado";

export type BuildProgress =
  | { kind: "phase"; id: string; state: LoopPhaseState; cycle: number; detail: string }
  | { kind: "gate"; id: string; gate: LoopGate; state: LoopGateState; cycle: number };

export type BuildProgressListener = (event: BuildProgress) => void;
