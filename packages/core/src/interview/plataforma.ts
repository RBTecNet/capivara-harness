/**
 * A plataforma do aplicativo desktop, decidida no `init` (item C de "só existe aceito").
 *
 * O pedido de um aplicativo de janela de outra plataforma — WinForms ou WPF num
 * Linux — era descoberto no `build`, na aceitação: o executável não roda aqui, e
 * o desfecho ficava "verificação inconclusiva: plataforma". Isso é uma lacuna,
 * e lacuna se fecha antes do código. O Core a reconhece pelo pedido, sem
 * modelo, e pergunta: manter o alvo (o build compila, mas não executa nem prova
 * o app nesta máquina) ou trocar para uma pilha que roda aqui. A recomendação
 * é trocar. A resposta vira uma regra do esqueleto, com as palavras que valem.
 */

import type { SkeletonRule } from "../contract/index.js";
import { latestAnswers } from "./rounds.js";
import type { Answer, Question } from "./types.js";

export const ID_DA_PLATAFORMA = "plataforma-do-desktop";

/** O assunto da regra que a decisão escreve no esqueleto; o build a lê para saber o que foi decidido. */
export const ASSUNTO_DA_PLATAFORMA = "plataforma do aplicativo";

/** A frase da regra quando o desenvolvedor mantém o alvo: é por ela que a aceitação sabe que a execução não se prova aqui. */
export const EXECUCAO_NAO_PROVADA = "a execução do aplicativo não é provada nesta máquina, por decisão do desenvolvedor registrada no init";

export type AlvoDoDesktop = "windows" | "macos";

export interface DesktopDeOutraPlataforma {
  /** A pilha que o pedido nomeia: "WinForms", "WPF"… */
  pilha: string;
  alvo: AlvoDoDesktop;
}

const PILHAS: { padrao: RegExp; pilha: string; alvo: AlvoDoDesktop }[] = [
  { padrao: /\bwin\s?forms\b|\bwindows\s+forms\b/iu, pilha: "Windows Forms", alvo: "windows" },
  { padrao: /\bwpf\b|windows\s+presentation\s+foundation/iu, pilha: "WPF", alvo: "windows" },
  { padrao: /\bwin\s?ui\b/iu, pilha: "WinUI", alvo: "windows" },
  { padrao: /\buwp\b|universal\s+windows\s+platform/iu, pilha: "UWP", alvo: "windows" },
  { padrao: /\bappkit\b|\bcocoa\b/iu, pilha: "AppKit", alvo: "macos" },
];

/** O nome do sistema, como o desenvolvedor o chama. */
export function nomeDoSistema(sistema: NodeJS.Platform): string {
  return sistema === "linux" ? "Linux" : sistema === "win32" ? "Windows" : sistema === "darwin" ? "macOS" : sistema;
}

/** O pedido é de um aplicativo de janela de outra plataforma que esta? `null` quando não é. */
export function desktopDeOutraPlataforma(pedido: string, sistema: NodeJS.Platform): DesktopDeOutraPlataforma | null {
  const achada = PILHAS.find((candidata) => candidata.padrao.test(pedido));
  if (!achada) return null;
  const daqui = (achada.alvo === "windows" && sistema === "win32") || (achada.alvo === "macos" && sistema === "darwin");
  return daqui ? null : { pilha: achada.pilha, alvo: achada.alvo };
}

const TROCAR = "Trocar para Avalonia, multiplataforma: o build compila, executa e prova o aplicativo nesta máquina";
const MANTER = (desktop: DesktopDeOutraPlataforma): string =>
  `Manter ${desktop.pilha} (alvo ${desktop.alvo === "windows" ? "Windows" : "macOS"}): o build compila, mas não executa nem prova o aplicativo nesta máquina`;

export function perguntaDaPlataforma(desktop: DesktopDeOutraPlataforma, sistema: NodeJS.Platform): Question {
  const aqui = nomeDoSistema(sistema);
  return {
    id: ID_DA_PLATAFORMA,
    topic: "plataforma do aplicativo",
    evidence:
      `O pedido nomeia ${desktop.pilha}, que só roda em ${desktop.alvo === "windows" ? "Windows" : "macOS"}, e esta máquina é ${aqui}. ` +
      "O build compila o projeto daqui, mas não consegue executar a janela para provar que o aplicativo sobe.",
    decision: `O aplicativo mantém ${desktop.pilha}, ou troca para uma pilha que roda em ${aqui}?`,
    why:
      "Com a pilha que roda aqui, a aceitação inicia o aplicativo e prova que ele sobe. Com o alvo mantido, " +
      "essa prova não acontece nesta máquina, e o relatório diz que foi por sua decisão.",
    options: [
      { label: TROCAR, consequence: "O esqueleto e o plano usam Avalonia; a aceitação compila e inicia o aplicativo aqui." },
      { label: MANTER(desktop), consequence: `O esqueleto mantém ${desktop.pilha}; a aceitação só compila, e a execução fica sem prova nesta máquina.` },
    ],
    recommended: TROCAR,
    recommendationBasis: `É a pilha que deixa o build provar o aplicativo nesta máquina (${aqui}).`,
  };
}

export type DecisaoDaPlataforma = "trocar" | "manter" | "indefinida";

export function decisaoDaPlataforma(questions: readonly Question[], answers: readonly Answer[]): DecisaoDaPlataforma {
  const pergunta = questions.find((question) => question.id === ID_DA_PLATAFORMA || question.id.endsWith(`:${ID_DA_PLATAFORMA}`));
  if (!pergunta) return "indefinida";
  const resposta = latestAnswers(answers).get(pergunta.id);
  if (!resposta || resposta.disposition !== "ACCEPTED") return "indefinida";
  if (resposta.decision === TROCAR) return "trocar";
  return resposta.decision.startsWith("Manter ") ? "manter" : "indefinida";
}

/** A regra que a decisão escreve no esqueleto. A decisão que não foi tomada não vira regra. */
export function regrasDaPlataforma(decisao: DecisaoDaPlataforma, desktop: DesktopDeOutraPlataforma | null, sistema: NodeJS.Platform): SkeletonRule[] {
  if (desktop === null || decisao === "indefinida") return [];
  const aqui = nomeDoSistema(sistema);
  return [
    decisao === "trocar"
      ? {
          subject: ASSUNTO_DA_PLATAFORMA,
          statement: `o aplicativo desktop usa Avalonia, multiplataforma, e não ${desktop.pilha}: decisão do desenvolvedor no init, para o build executar e provar o aplicativo nesta máquina (${aqui})`,
        }
      : {
          subject: ASSUNTO_DA_PLATAFORMA,
          statement:
            `o aplicativo mantém ${desktop.pilha}, com alvo ${desktop.alvo === "windows" ? "Windows" : "macOS"}; nesta máquina (${aqui}) o build o compila` +
            `${desktop.alvo === "windows" ? " com -p:EnableWindowsTargeting=true" : ""}, e ${EXECUCAO_NAO_PROVADA}`,
        },
  ];
}

/** O esqueleto registra que o desenvolvedor manteve o alvo de outra plataforma? */
export function alvoMantidoNoEsqueleto(regras: readonly SkeletonRule[]): boolean {
  return regras.some((regra) => regra.subject === ASSUNTO_DA_PLATAFORMA && regra.statement.includes(EXECUCAO_NAO_PROVADA));
}
