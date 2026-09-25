/**
 * A insistência: nenhuma decisão material morre por falta de ter sido perguntada.
 *
 * O harness tinha três tetos de entrevista e os três terminavam do mesmo jeito —
 * a decisão que ninguém fechou virava `[NEEDS DECISION]` no plano, e o gate
 * recusava o run. Visto de fora isso é o harness desistindo: ele SABIA o que
 * faltava, tinha o desenvolvedor na frente do terminal, e preferiu publicar NOT
 * READY a fazer uma pergunta.
 *
 * O teto existia por um motivo real: quem responde quarenta perguntas para
 * documentar um produto pequeno para de responder com cuidado lá pela décima
 * quinta. Só que o remédio estava errado. O que cansa não é a quantidade de
 * perguntas — é a pergunta que não tem como ser respondida, que volta idêntica, e
 * que continua voltando depois de respondida. Contra isso o teto não faz nada: ele
 * só garante que a última fica sem resposta nenhuma.
 *
 * Então a pergunta que insiste tem sempre SAÍDA FECHADA. Além das opções
 * originais, ela oferece duas que encerram a decisão sem exigir que o
 * desenvolvedor saiba a resposta:
 *
 * - delegar — o harness decide pela recomendação, e isso fica registrado como
 *   suposição no relatório, onde ele pode derrubá-la depois;
 * - tirar do escopo — o produto não faz aquilo, e nenhuma fase o implementa.
 *
 * Com as duas, toda decisão aberta converge para um de três estados: decidida,
 * assumida com autorização, ou fora do escopo. Nenhum dos três bloqueia o gate, e
 * nenhum deles é silencioso.
 */

import type { Assumption, Question } from "./types.js";

/** Fora da faixa da entrevista (`Q-01`…) e do levantamento (`Q-9…`). */
export const PREFIXO_DA_INSISTENCIA = "Q-8";

export const DELEGAR = "Deixe o harness decidir por mim";
export const FORA_DO_ESCOPO = "Isto fica fora do escopo do produto";

/**
 * A mesma pergunta, agora com as duas saídas que a fecham.
 *
 * As opções originais vêm primeiro e na mesma ordem: quem já as leu uma vez não
 * precisa reaprender a numeração. O que aparece no fim é o que não existia — e é
 * justamente o que faltava para a pergunta poder ser respondida por quem não sabe
 * a resposta.
 */
export function perguntaInsistente(pergunta: Question, aberto: string): Question {
  const delegada = pergunta.recommended.trim();

  return {
    ...pergunta,
    id: pergunta.id,
    ...(aberto.trim() !== "" ? { pending: aberto.trim() } : {}),
    /*
     * A pergunta original pode não ter "por que importa" — o levantamento de
     * auditoria não tem, de propósito. Concatenar às cegas produzia duas linhas em
     * branco e um bloco que começava do nada.
     */
    why:
      (pergunta.why.trim() === "" ? "" : `${pergunta.why}\n\n`) +
      "Esta decisão está em aberto e é a última coisa entre o plano e o build. " +
      "Ela não vai ficar sem resposta: as duas últimas opções fecham a pergunta sem " +
      "você precisar saber a resposta.",
    options: [
      ...pergunta.options,
      {
        label: DELEGAR,
        consequence:
          delegada === ""
            ? "O escritor decide pela alternativa de menor escopo e menor risco, e a escolha entra no " +
              "relatório como suposição explícita — você lê e pode derrubá-la depois."
            : `Fica valendo a recomendação — ${delegada} — registrada no relatório como suposição, não como ` +
              "sua decisão. Você lê e pode derrubá-la depois.",
      },
      {
        label: FORA_DO_ESCOPO,
        consequence:
          "Nada no produto depende disto: nenhuma fase implementa, nenhum critério verifica, e fica " +
          "escrito como fora do escopo para o auditor não voltar a cobrar.",
      },
    ],
    recommended: delegada === "" ? DELEGAR : delegada,
  };
}

export type LeituraInsistente =
  | { tipo: "delegada"; decisao: string }
  | { tipo: "fora"; decisao: string }
  | { tipo: "decidida" };

/**
 * O que a escolha significa — e o TEXTO que fica gravado.
 *
 * Nunca o rótulo do botão. "Deixe o harness decidir por mim" viaja sozinho para o
 * contexto do escritor, para a lista de decisões do auditor e para o relatório, e
 * não diz nada em nenhum dos três. Foi essa a lição do levantamento de auditoria,
 * e ela vale igual aqui.
 */
export function leituraInsistente(pergunta: Question, decisao: string): LeituraInsistente {
  if (decisao === FORA_DO_ESCOPO) {
    return {
      tipo: "fora",
      decisao:
        `${pergunta.topic}: fica FORA DO ESCOPO — o produto não faz isto. Nenhuma fase o implementa e ` +
        "nenhum critério o verifica; não é omissão a ser corrigida.",
    };
  }

  if (decisao === DELEGAR) {
    const recomendada = pergunta.recommended.trim();
    return {
      tipo: "delegada",
      decisao:
        recomendada === "" || recomendada === DELEGAR
          ? `${pergunta.topic}: o desenvolvedor autorizou decidir por ele. Vale a alternativa de MENOR ESCOPO ` +
            `e menor risco que responda "${pergunta.decision}", escrita como decisão e registrada como suposição.`
          : `${pergunta.topic}: ${recomendada} — o desenvolvedor autorizou decidir por ele e esta era a ` +
            "recomendação; vale como decisão e está registrada como suposição no relatório.",
    };
  }

  return { tipo: "decidida" };
}

/** A suposição que a delegação cria. Ela existe para ser LIDA e derrubada. */
export function suposicaoDelegada(pergunta: Question, decisao: string): Assumption {
  return {
    topic: pergunta.topic,
    statement: decisao,
    basis:
      "o desenvolvedor foi perguntado, não tinha a resposta e autorizou o harness a decidir; " +
      "derrubar isto depois custa uma mudança, não um run",
  };
}

/**
 * A pergunta para um marcador que ninguém conseguiu transformar em pergunta.
 *
 * O caminho normal de um `[NEEDS DECISION]` é o escritor virá-lo pergunta com
 * opções concretas, porque só ele sabe o que está em jogo naquela fase. Quando o
 * lote dele volta torto duas vezes, o harness ficava com o marcador na mão e ia
 * embora: no `assitencia` isso publicou NOT READY com "3 gap(s) sem pergunta" —
 * três decisões que ninguém chegou a ouvir.
 *
 * Esta é a rede embaixo. Ela não sabe as alternativas — quem sabia não conseguiu
 * dizê-las —, mas sabe as duas saídas que fecham qualquer decisão, e sabe mostrar
 * o marcador inteiro para quem pode escrever a resposta em uma linha.
 */
export function perguntaDeLacuna(marcador: string, indice: number): Question {
  return {
    id: `${PREFIXO_DA_INSISTENCIA}${indice}`,
    topic: "decisão pendente na fase",
    evidence:
      "O escritor parou aqui em vez de inventar um padrão, e foi o certo a fazer. Ele não conseguiu " +
      `transformar isto numa pergunta com alternativas, então vai com as palavras dele:\n\n  ${marcador}`,
    decision: marcador.replace(/\s+$/, ""),
    why:
      "Um marcador de decisão pendente reprova o plano no gate, e quem o fecha é você: nem o escritor " +
      "nem o auditor podem decidir o que nenhuma fonte diz. Escreva a decisão em uma linha, ou escolha " +
      "uma das duas saídas abaixo.",
    options: [
      {
        label: DELEGAR,
        consequence:
          "O escritor decide pela alternativa de menor escopo e menor risco, remove o marcador, e a " +
          "escolha entra no relatório como suposição explícita — você lê e pode derrubá-la depois.",
      },
      {
        label: FORA_DO_ESCOPO,
        consequence:
          "A fase deixa de tratar disto: o marcador sai, nenhum critério passa a exigir aquilo, e fica " +
          "escrito que está fora do escopo.",
      },
    ],
    recommended: DELEGAR,
    recommendationBasis:
      "Enquanto ninguém decide, o plano não fecha. Delegar registra a escolha como suposição e deixa o " +
      "run terminar; escrever a decisão é melhor, e leva uma linha.",
  };
}
