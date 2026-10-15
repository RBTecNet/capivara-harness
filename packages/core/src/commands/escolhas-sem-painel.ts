/**
 * As perguntas do `change` e do `survey` como lista (§96).
 *
 * Nenhum dos dois desenha painel: a pergunta abre embaixo do que já está na
 * tela (`chooseInBox`). O que mora aqui é só a tradução entre a linha da lista
 * e a resposta que o leitor de cada comando já entende — separada do CLI para
 * ter teste, porque é exatamente onde uma opção trocaria de lugar sem ninguém
 * ver.
 */

import { renderQuestion } from "../change/orchestrator.js";
import type { ChangeQuestion } from "../contract/change.js";
import type { DecisaoDeColisao } from "../survey/index.js";
import type { Choice } from "../tui/wizard.js";

export interface EscolhaSemPainel {
  title: string;
  text: string[];
  choices: Choice[];
  defaultIndex: number;
}

/**
 * Uma pergunta do planejador da mudança.
 *
 * O texto é o de sempre, com as consequências de cada opção, menos a linha do
 * tópico, que vira o título da caixa. As linhas da lista são as opções, a
 * recomendada marcada e com o cursor, e o texto livre no fim.
 */
export function escolhaDaMudanca(question: ChangeQuestion, indice: number, total: number): EscolhaSemPainel {
  const linhas = renderQuestion(question, indice, total).split("\n");
  const text = linhas.slice(linhas.findIndex((linha) => linha.startsWith("Pergunta ")) + 1);
  while (text.length > 0 && text[0]!.trim() === "") text.shift();
  const recomendada = question.options.findIndex((opcao) => opcao.label === question.recommended);
  return {
    title: `PERGUNTA ${indice}/${total} · ${question.topic}`,
    text,
    choices: [
      ...question.options.map((opcao) => ({ label: `${opcao.label}${opcao.label === question.recommended ? " ← recomendada" : ""}` })),
      { label: "responder com texto livre", hint: "o que nenhuma opção cobre" },
    ],
    defaultIndex: Math.max(0, recomendada),
  };
}

/** O que a linha escolhida responde: o número da opção, ou `null` para o texto livre. */
export function respostaDaMudanca(question: ChangeQuestion, escolhida: number): string | null {
  return escolhida < question.options.length ? String(escolhida + 1) : null;
}

/** O projeto que o levantamento ia criar já existe na base. */
export function escolhaDeColisao(slug: string): EscolhaSemPainel & { decisoes: DecisaoDeColisao[] } {
  return {
    title: "PROJETO JÁ EXISTE NA BASE · precisa da sua decisão",
    text: [`A base já tem um projeto chamado "${slug}".`],
    choices: [
      { label: `atualizar o levantamento de "${slug}"`, hint: "o pedido escrito lá é preservado" },
      { label: "criar um projeto novo ao lado, com outro nome" },
      { label: "não mexer na base", hint: "fica só com os arquivos locais" },
    ],
    defaultIndex: 0,
    decisoes: ["atualizar", "novo", "local"],
  };
}
