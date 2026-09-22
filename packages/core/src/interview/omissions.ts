/**
 * O que o desenvolvedor decidiu deixar de fora.
 *
 * Uma omissão recusada não é um silêncio: é uma decisão, e ela precisa estar
 * escrita. Sem isso, quem lê o esqueleto seis meses depois não distingue "não
 * tem edição de cliente porque decidimos que não tem" de "ninguém pensou nisso"
 * — e a segunda leitura é a que faz alguém implementar por conta própria o que
 * o pedido não pediu.
 *
 * O reconhecimento é mecânico e exato: quando o desenvolvedor escolhe uma opção
 * pelo número ou pelo rótulo, a decisão gravada É o rótulo da opção. Resposta em
 * texto livre, normalizada por um modelo, não casa com rótulo nenhum — e aí o
 * harness não afirma nada, porque não sabe.
 */

import type { Answer, Omission, Question } from "./types.js";
import { latestAnswers } from "./rounds.js";

/** A pergunta é uma omissão? Quem carrega `include` é. */
export function ehOmissao(question: Question): question is Omission {
  return typeof (question as Omission).include === "string" && (question as Omission).include !== "";
}

/**
 * Os não-objetivos: as omissões que o desenvolvedor recusou explicitamente.
 *
 * Só as recusadas com certeza entram. Uma omissão adiada continua em aberto, e
 * declará-la fora do escopo seria transformar "não decidi" em decisão — o mesmo
 * erro que a disposição DEFERRED existe para impedir.
 */
export function naoObjetivos(questions: readonly Question[], answers: readonly Answer[]): string[] {
  const latest = latestAnswers(answers);
  const fora: string[] = [];

  for (const question of questions) {
    if (!ehOmissao(question)) continue;
    const answer = latest.get(question.id);
    if (!answer || answer.disposition !== "ACCEPTED") continue;

    const escolhida = question.options.find((option) => option.label === answer.decision);
    if (!escolhida || escolhida.label === question.include) continue;

    fora.push(`${question.topic} — fora do escopo por decisão do desenvolvedor: ${escolhida.consequence}`);
  }

  return fora;
}
