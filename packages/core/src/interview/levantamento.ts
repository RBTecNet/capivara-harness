/**
 * O levantamento de auditoria: quando o desacordo não é sobre escrita.
 *
 * Um achado que aparece uma vez é defeito — o escritor conserta e segue. Um
 * achado que sobrevive a uma reescrita é outra coisa: o escritor leu as fontes
 * de um jeito, o auditor leu de outro, e nenhum dos dois pode decidir quem tem
 * razão. O harness mandava a discussão de volta ao escritor mais duas vezes e
 * depois abortava o run.
 *
 * No `assitencia` isso teve nome: a exclusividade do e-mail. O escritor seguia a
 * regra transversal do esqueleto ("usuários operacionais"), o auditor seguia a
 * decisão aceita ("em todo o sistema"), e o mesmo achado voltou em quatro
 * rodadas seguidas, três reinícios e uma noite.
 *
 * A pergunta põe as duas leituras lado a lado e deixa quem decide decidir. E a
 * decisão fica GRAVADA: o auditor da rodada seguinte a recebe junto das outras,
 * senão ele levanta o mesmo ponto de novo, com toda a razão do mundo.
 */

import type { AuditDecision, Finding } from "../audit/index.js";
import type { Question } from "./types.js";

export const PREFIXO_DO_LEVANTAMENTO = "Q-9";

const DO_ESCRITOR = "Vale o que o escritor escreveu";
const DO_AUDITOR = "Vale a leitura do auditor";

/**
 * A pergunta que o levantamento faz.
 *
 * `indice` vira o id — `Q-90`, `Q-91`… —, fora da faixa da entrevista para as
 * duas não colidirem no handoff.
 */
export function perguntaDeLevantamento(finding: Finding, indice: number, oQueOEscritorFez = ""): Question {
  const entrega =
    oQueOEscritorFez === ""
      ? "A fase segue exatamente como está escrita hoje."
      : `A fase segue como está:\n${oQueOEscritorFez
          .split("\n")
          .map((linha) => `  ${linha}`)
          .join("\n")}`;

  return {
    id: `${PREFIXO_DO_LEVANTAMENTO}${indice}`,
    topic: `auditoria · ${finding.where}`,
    /*
     * A primeira linha diz do que se trata e o que a escolha resolve. Nada mais.
     *
     * Ela dizia antes: "O auditor devolveu este ponto pela segunda vez, então não é
     * falta de capricho do escritor: é leitura divergente das mesmas fontes" — uma
     * explicação do mecanismo do harness, para quem só precisa decidir. Vinha
     * seguida do que o auditor entendeu, do que ele pede e de um parágrafo sobre
     * por que aquilo importa: quatro blocos antes da primeira opção.
     */
    evidence: `${finding.where}: o auditor e o escritor entenderam de formas diferentes o que esta parte deve garantir.`,
    decision: "Qual dos dois entendimentos vale?",
    /*
     * Sem "por que importa". As duas leituras são a pergunta inteira, e cada uma
     * está dentro da opção que a escolhe — que é onde se decide, e onde o texto
     * ajuda. Os renderizadores não desenham bloco vazio.
     */
    why: "",
    options: [
      {
        label: DO_AUDITOR,
        consequence: `${finding.problem}\n\nCorreção: ${finding.fix}`,
      },
      { label: DO_ESCRITOR, consequence: entrega },
    ],
    recommended: DO_AUDITOR,
    recommendationBasis: "",
  };
}

export type LeituraEscolhida =
  | { tipo: "auditor" }
  | { tipo: "escritor" }
  | { tipo: "outra"; texto: string };

/** O que a resposta significa para o laço de auditoria. */
export function lerEscolha(decisao: string, raw: string): LeituraEscolhida {
  if (decisao === DO_ESCRITOR) return { tipo: "escritor" };
  if (decisao === DO_AUDITOR) return { tipo: "auditor" };

  /*
   * Nem uma nem outra: o desenvolvedor escreveu o que tem de valer. O texto vai
   * inteiro para o escritor E para o auditor — quem confere a entrega precisa
   * julgar pelo que foi decidido aqui, não pelo que ele mesmo achava antes.
   */
  const texto = decisao.trim() !== "" ? decisao.trim() : raw.trim();
  return texto === "" ? { tipo: "auditor" } : { tipo: "outra", texto };
}

/** O achado, reescrito com a decisão do desenvolvedor como autoridade. */
export function comAutoridade(finding: Finding, escolha: LeituraEscolhida): Finding {
  if (escolha.tipo === "auditor") {
    return { ...finding, fix: `${finding.fix}\n(o desenvolvedor confirmou esta leitura: ela é autoridade)` };
  }
  if (escolha.tipo === "outra") {
    return {
      ...finding,
      problem: `${finding.problem}\n(o desenvolvedor decidiu de outra forma)`,
      fix: `o desenvolvedor decidiu, e esta decisão é a autoridade acima do auditor: ${escolha.texto}`,
    };
  }
  return finding;
}

/**
 * A decisão como ela precisa ser LIDA depois — e não como ela foi clicada.
 *
 * O que fica gravado vai para três lugares: o contexto do escritor, a lista de
 * decisões que o auditor recebe na rodada seguinte, e o relatório final. Guardar
 * o rótulo do botão — *"Vale a leitura do auditor"* — entrega aos três uma frase
 * sem conteúdo: o auditor lê onze decisões iguais, não descobre nada em nenhuma,
 * e levanta os mesmos pontos de novo com toda a razão.
 *
 * Foi o que aconteceu no `assitencia`: o desenvolvedor arbitrou onze vezes, e o
 * auditor devolveu os dois primeiros pontos outra vez, porque para ele nada
 * tinha sido decidido.
 */
export function decisaoGravada(finding: Finding, escolha: LeituraEscolhida): string {
  if (escolha.tipo === "outra") return `${finding.where}: ${escolha.texto}`;
  if (escolha.tipo === "auditor") return `${finding.where}: ${finding.fix}`;
  return `${finding.where}: fica como está — o ponto levantado pelo auditor ("${finding.problem}") foi decidido a favor do texto atual`;
}

/** Fora da faixa da entrevista, do levantamento e da insistência. */
export const PREFIXO_DA_DECISAO_DO_AUDITOR = "Q-7";

/**
 * A pergunta que o AUDITOR levantou, antes de custar um ciclo.
 *
 * O levantamento acima existe para o desacordo já caro: o achado voltou pela
 * segunda vez, e chegar lá custou escrever, auditar, reescrever e auditar de novo.
 * Esta é a mesma pergunta feita na primeira leitura, quando o auditor percebe que
 * o que falta não é capricho do escritor — é uma decisão que nenhuma fonte contém.
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
    recommended: decisao.options[0] ?? "",
    recommendationBasis:
      "O auditor escreveu esta primeiro. Se nenhuma das leituras servir, escreva o que deve valer — o " +
      "texto vai inteiro para quem escreve e para quem confere.",
  };
}

/** O achado que leva a decisão do desenvolvedor ao escritor, como autoridade. */
export function decisaoDoAuditorComoFinding(decisao: AuditDecision, decidido: string): Finding {
  return {
    where: decisao.where,
    problem: `faltava uma decisão que nenhuma fonte continha: ${decisao.decision}`,
    fix: `o desenvolvedor decidiu, e esta decisão é a autoridade acima do auditor: ${decidido}`,
  };
}

/** Fora das faixas do levantamento, da insistência e da decisão do auditor. */
export const PREFIXO_DO_ENSAIO = "Q-6";

const ENSAIO_VALE_O_VERIFICADOR = "Vale a leitura do verificador";
const ENSAIO_VALE_O_CRITERIO = "Vale o critério como está escrito";

/**
 * A terceira mesa sem cadeira para quem decide: o ensaio do verificador.
 *
 * O ensaio pergunta se um critério pode ser PROVADO por alguém. Quando ele diz
 * que não, o escritor tem uma rodada para reescrever — e, se o veredito se
 * mantiver, o run terminava em NOT READY com o plano publicado e uma lista de
 * endereços na tela. Ninguém era perguntado, embora as duas leituras estivessem
 * escritas e o desenvolvedor estivesse no terminal.
 *
 * É o mesmo desacordo do levantamento de auditoria, com outro par: o escritor
 * afirma que o critério é observável, o verificador afirma que não. Nenhum dos
 * dois pode decidir, e o preço de errar é assimétrico — por isso a recomendação
 * é do verificador, e a outra opção diz o que custa.
 */
export function perguntaDoEnsaio(
  criterio: { address: string; taskTitle: string; text: string },
  ruling: string,
  reason: string,
  indice: number,
): Question {
  /*
   * A forma que o desenvolvedor definiu para o levantamento de auditoria — a área
   * e o que a escolha resolve, a leitura de um, a leitura do outro, e nada mais —
   * vale igual aqui. Esta era a irmã que tinha ficado para trás: ela ainda trazia
   * o veredito acima da pergunta, um "por que importa" e um "recomendo porque", e
   * foi colada de volta na conversa exatamente assim.
   */
  return {
    id: `${PREFIXO_DO_ENSAIO}${indice}`,
    topic: `ensaio · ${criterio.address}`,
    evidence:
      `${criterio.address}, na task "${criterio.taskTitle}": o verificador e o escritor entenderam de formas ` +
      "diferentes se este critério pode ser provado.",
    decision: "Qual dos dois entendimentos vale?",
    why: "",
    options: [
      {
        label: ENSAIO_VALE_O_VERIFICADOR,
        consequence: `${reason}\n\nCorreção: o critério é reescrito ${
          ruling === "UNSATISFIABLE"
            ? "para afirmar o que é verdade segundo as decisões, inclusive a ausência"
            : "como condição observável — um arquivo, um comando e sua saída, um teste nomeado"
        }.`,
      },
      { label: ENSAIO_VALE_O_CRITERIO, consequence: `O critério fica como está:\n  ${criterio.text}` },
    ],
    recommended: ENSAIO_VALE_O_VERIFICADOR,
    recommendationBasis: "",
  };
}

export type LeituraDoEnsaio = { tipo: "verificador" } | { tipo: "criterio" } | { tipo: "outra"; texto: string };

export function lerEscolhaDoEnsaio(decisao: string, raw: string): LeituraDoEnsaio {
  if (decisao === ENSAIO_VALE_O_CRITERIO) return { tipo: "criterio" };
  if (decisao === ENSAIO_VALE_O_VERIFICADOR) return { tipo: "verificador" };
  const texto = decisao.trim() !== "" ? decisao.trim() : raw.trim();
  return texto === "" ? { tipo: "verificador" } : { tipo: "outra", texto };
}

/** A decisão do ensaio, como ela precisa ser lida depois — nunca o rótulo do botão. */
export function decisaoDoEnsaio(
  criterio: { address: string; text: string },
  escolha: LeituraDoEnsaio,
): string {
  if (escolha.tipo === "outra") return `${criterio.address}: ${escolha.texto}`;
  if (escolha.tipo === "verificador") {
    return `${criterio.address}: o critério é reescrito — o verificador não conseguiu prová-lo como está`;
  }
  return (
    `${criterio.address}: fica como está — o desenvolvedor decidiu que "${criterio.text}" é verificável, ` +
    "contra a leitura do ensaio"
  );
}
