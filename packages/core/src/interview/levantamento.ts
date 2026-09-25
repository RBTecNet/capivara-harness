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

import type { Finding } from "../audit/index.js";
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
  /*
   * As DUAS versões, lado a lado.
   *
   * A primeira versão desta tela mostrava só a leitura do auditor, e oferecia
   * "vale o que o escritor escreveu" sem dizer o que ele escreveu. Escolher no
   * escuro entre uma opção argumentada e uma opção muda não é escolher.
   */
  const doEscritor =
    oQueOEscritorFez === ""
      ? ""
      : `\n\n  O escritor entregou:\n${oQueOEscritorFez
          .split("\n")
          .map((linha) => `    ${linha}`)
          .join("\n")}`;

  return {
    id: `${PREFIXO_DO_LEVANTAMENTO}${indice}`,
    topic: `auditoria · ${finding.where}`,
    evidence:
      `O auditor devolveu este ponto pela segunda vez, então não é falta de capricho do escritor: ` +
      `é leitura divergente das mesmas fontes.${doEscritor}\n\n  O auditor entendeu: ${finding.problem}\n` +
      `  E pede: ${finding.fix}`,
    decision: `Em "${finding.where}", qual leitura vale?`,
    why:
      "Enquanto as duas leituras existirem, o escritor reescreve e o auditor devolve — foi assim que " +
      "um único ponto consumiu quatro rodadas e três reinícios. A sua resposta encerra a discussão e " +
      "passa a valer também para as auditorias seguintes.",
    options: [
      { label: DO_AUDITOR, consequence: `A fase é reescrita como o auditor pede: ${finding.fix}` },
      {
        label: DO_ESCRITOR,
        consequence:
          oQueOEscritorFez === ""
            ? "O ponto é encerrado como está, e o auditor não volta a levantá-lo. (O endereço do achado não " +
              "aponta uma fase única, então o texto do escritor não pôde ser mostrado aqui — o que ele fez está " +
              "descrito no que o auditor entendeu, acima.)"
            : `A fase segue como está — ${resumoDeUmaLinha(oQueOEscritorFez)} — e o auditor não volta a levantar o ponto.`,
      },
    ],
    recommended: DO_AUDITOR,
    recommendationBasis:
      "Quem devolve duas vezes costuma estar lendo uma decisão aceita, e decisão aceita vence documento " +
      "derivado dela. Se não for o caso aqui, escolha a outra opção — ou escreva o que deve valer, se " +
      "nenhuma das duas estiver certa.",
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

/** O que o escritor entregou, em uma linha, para caber na consequência da opção. */
function resumoDeUmaLinha(entrega: string): string {
  const linhas = entrega
    .split("\n")
    .map((linha) => linha.replace(/^[-•\s]+/, "").trim())
    .filter((linha) => linha !== "");
  if (linhas.length === 0) return "sem tarefas declaradas";
  const inteiro = linhas.join("; ");
  return inteiro.length <= 160 ? inteiro : `${inteiro.slice(0, 157)}…`;
}
