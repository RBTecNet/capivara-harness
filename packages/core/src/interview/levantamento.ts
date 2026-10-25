/**
 * A decisão que o auditor devolve ao desenvolvedor, como pergunta.
 *
 * O levantamento de auditoria (o achado que voltava duas vezes) e o do ensaio
 * saíram com a auditoria por fase e o ensaio (etapa 2 da redução). Fica a
 * pergunta que a auditoria da arquitetura ainda levanta.
 */

import { enderecoDaDecisao, type AuditDecision, type Finding } from "../audit/index.js";
import type { Question } from "./types.js";

/** Fora da faixa da entrevista, do levantamento e da insistência. */
export const PREFIXO_DA_DECISAO_DO_AUDITOR = "Q-7";

/**
 * A pergunta que o AUDITOR levantou, antes de custar um ciclo.
 *
 * Feita na primeira leitura, quando o auditor percebe que o que falta não é
 * capricho do escritor — é uma decisão que nenhuma fonte contém.
 *
 * As leituras vêm dele, e são ao menos duas: o protocolo recusa uma decisão sem
 * alternativas, porque pergunta sem opção entra em laço. A resposta é gravada como
 * decisão aceita e chega às duas pontas — ao escritor, que reescreve, e ao auditor
 * da rodada seguinte, que senão levanta o mesmo ponto de novo com toda a razão.
 */
export function perguntaDoAuditor(decisao: AuditDecision, indice: number): Question {
  return {
    id: `${PREFIXO_DA_DECISAO_DO_AUDITOR}${indice}`,
    topic: `auditoria · ${decisao.where}`,
    evidence:
      "O auditor leu o documento e parou aqui: nada no pedido, nas decisões ou no esqueleto responde a " +
      "isto, e as duas leituras se defendem. Nem ele nem o escritor podem decidir — quem decide é você, " +
      "e é agora, antes de a fase ser reescrita em cima de um palpite.",
    decision: decisao.decision,
    why:
      "Enquanto ninguém decide, o escritor escreve uma leitura e o auditor cobra a outra: é assim que um " +
      "ponto consome as devoluções todas e o run para. A sua resposta encerra a discussão e passa a valer " +
      "para as auditorias seguintes.",
    options: decisao.options.map((leitura) => ({
      label: leitura,
      consequence: `O documento passa a afirmar isto, e o auditor julga por ele: ${leitura}`,
    })),
    /*
     * Nenhuma leitura é recomendada.
     *
     * A primeira era "recomendada" só por ter sido escrita primeiro — e a
     * recomendada é o que um Enter vazio ou "use as recomendações" grava como
     * decisão ACEITA do desenvolvedor. As duas leituras vêm do auditor; escolher
     * entre elas é a única coisa que esta pergunta pede, e tem de ser um ato
     * dele: um número, um rótulo ou o texto que deve valer.
     */
    recommended: "",
    recommendationBasis:
      "As duas leituras são do auditor e nenhuma é recomendada: escolha uma pelo número, ou escreva o " +
      "que deve valer — o texto vai inteiro para quem escreve e para quem confere.",
  };
}

/** O achado que leva a decisão do desenvolvedor ao escritor, como autoridade. */
export function decisaoDoAuditorComoFinding(decisao: AuditDecision, decidido: string): Finding {
  return {
    where: enderecoDaDecisao(decisao),
    problem: `faltava uma decisão que nenhuma fonte continha: ${decisao.decision}`,
    fix: `o desenvolvedor decidiu, e esta decisão é a autoridade acima do auditor: ${decidido}`,
  };
}
