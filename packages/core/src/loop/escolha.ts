/**
 * Uma escolha fechada que o loop faz ao desenvolvedor.
 *
 * O texto numerado era a única forma dela, e quem a desenhasse como lista teria
 * de reler as opções de dentro do texto — um segundo parser da mesma coisa, que
 * diverge na primeira opção reescrita. Aqui a escolha é dado, o texto numerado é
 * gerado dela, e a resposta continua sendo o NÚMERO da opção: o leitor de cada
 * pergunta (`lerEscolhaDeRepositorio`, `readPrerequisiteChoice`) não muda.
 */

export interface EscolhaNumerada {
  /** O que vem antes das opções. */
  texto: string[];
  /** As opções, na ordem dos números: a primeira é 1. */
  opcoes: string[];
}

export function renderEscolhaNumerada(escolha: EscolhaNumerada): string {
  return [...escolha.texto, "", ...escolha.opcoes.map((opcao, indice) => `  ${indice + 1}) ${opcao}`)].join("\n");
}
