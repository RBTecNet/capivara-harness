/**
 * Os textos reais de runs anteriores à §129, como o escritor e o arquiteto da
 * §129 os escrevem: sem o pedido de testes.
 *
 * Até a §128 a regra do planejamento mandava o plano "carregar" a exigência de
 * testes do pedido — "o módulo possui testes automatizados próprios" num
 * critério, num contrato de componente, no goal da fase. Os runs do Luna e do
 * Parallel Lab obedeceram, e as fixtures guardam isso byte a byte. Desde a
 * §129 o contrato recusa essas frases: o que o pedido diz sobre testes é do
 * build. Os cenários que usam as fixtures para provar OUTRO mecanismo — a
 * disponibilidade dos fluxos, a convergência da reorganização — não podem
 * depender dessa frase; recebem o texto com ela tirada, e só ela. Os arquivos
 * em `test/fixtures/` continuam como o run os escreveu: é com eles que a
 * `testes-no-build-129.spec.ts` prova a recusa.
 */

import { testRequirements } from "../../src/contract/index.js";

/** As orações de teste que os runs escreveram, e o que fica no lugar delas. */
const ORACOES: readonly [string, string][] = [
  ["o módulo possui testes automatizados e a aplicação aceita", "a aplicação aceita"],
  ["A aplicação possui testes automatizados e os fluxos acessam", "Os fluxos acessam"],
];

function semOracoes(texto: string): string {
  return ORACOES.reduce((atual, [oracao, resto]) => atual.split(oracao).join(resto), texto);
}

/**
 * A fase sem o critério de teste: a linha de critério que é só o requisito
 * sai; a que tem outra oração antes do ";" fica com ela.
 */
export function faseSemTestes(markdown: string): string {
  const linhas: string[] = [];
  for (const linha of semOracoes(markdown).split("\n")) {
    if (!/^\s{4}- /.test(linha) || testRequirements(linha).length === 0) {
      linhas.push(linha);
      continue;
    }
    const partes = linha.split(/;\s+/u);
    const ficam = partes.filter((parte) => testRequirements(parte).length === 0);
    if (ficam.length > 0) linhas.push(`${ficam.join("; ").replace(/[.;\s]*$/u, "")}.`);
  }
  return linhas.join("\n");
}

/** A arquitetura sem o contrato e a oração de teste. */
export function arquiteturaSemTestes(json: string): string {
  const limpa = (valor: unknown): unknown => {
    if (typeof valor === "string") return semOracoes(valor);
    if (Array.isArray(valor)) {
      return valor
        .map(limpa)
        .filter((item) => typeof item !== "string" || testRequirements(item).length === 0);
    }
    if (valor !== null && typeof valor === "object") {
      return Object.fromEntries(Object.entries(valor).map(([chave, item]) => [chave, limpa(item)]));
    }
    return valor;
  };
  return JSON.stringify(limpa(JSON.parse(json)), null, 2);
}

/**
 * A fase de um run real no teto de critérios de hoje (etapa 3 da redução: 2 por
 * task), consolidada como o escritor faria: o primeiro critério fica, e os
 * seguintes viram um só, juntos por "; ". Nenhum texto se perde — o que um
 * cenário procura por trecho continua lá. Os runs de então tinham 2 a 3
 * critérios por task, e os cenários que os usam provam outro mecanismo.
 */
export function noTetoDeCriterios(fase: string, teto = 2): string {
  return fase.replace(/( {2}- \*\*Acceptance criteria:\*\*\n)((?: {4}- [^\n]*\n?)+)/g, (_bloco, cabecalho: string, itens: string) => {
    const linhas = itens.split("\n").filter((linha) => linha.trim() !== "");
    if (linhas.length <= teto) return `${cabecalho}${itens}`;
    const juntos = linhas.slice(teto - 1).map((linha) => linha.replace(/^ {4}- /, "")).join("; ");
    return `${cabecalho}${[...linhas.slice(0, teto - 1), `    - ${juntos}`].join("\n")}\n`;
  });
}
