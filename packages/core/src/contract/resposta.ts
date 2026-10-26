/**
 * O JSON dentro da resposta de um modelo.
 *
 * Havia quatro cópias disto — survey, esqueleto, change e entrevista —, com dois
 * comportamentos. Três pegavam a PRIMEIRA cerca de código que aparecesse; a da
 * entrevista só aceitava a resposta inteira cercada. Nenhuma tolerava uma frase
 * antes do objeto, e as três primeiras cortavam o JSON no meio quando ele trazia,
 * dentro de uma string, um trecho de código com crases — o que um levantamento de
 * código faz o tempo todo. O survey do cronus3 com o codex foi recusado três vezes
 * como "não é JSON válido".
 *
 * A ordem das tentativas é da mais literal para a mais tolerante, e a primeira
 * que der um objeto vence. Quem chama continua conferindo o contrato: aceitar um
 * JSON que antes era recusado não aceita um conteúdo que antes era recusado.
 *
 * Depois das literais vêm os hábitos que paravam o esqueleto e a arquitetura
 * ("veio inválido três vezes"): o rascunho seguido de "corrigindo:" e do objeto
 * final — cada objeto de nível superior, do último para o primeiro —, a vírgula
 * sobrando antes de `}` ou `]` e o comentário `//` ou `/* *\/`, tirados só FORA
 * das strings. As aspas tipográficas ficam: o texto em português as usa dentro
 * das strings, e elas não são sintaxe do JSON.
 */

import { semRaciocinio } from "./protocolo.js";

export function jsonDaResposta(source: string): unknown {
  // O raciocínio antes da resposta pode trazer chaves e cercas que não são o objeto.
  const texto = semRaciocinio(source).trim();

  const tentativas: string[] = [texto];

  // Cercas: as marcadas como json primeiro, depois as outras, na ordem.
  const cercas = [...texto.matchAll(/```([a-zA-Z]*)[^\S\n]*\n([\s\S]*?)\n```/g)];
  for (const cerca of cercas) if ((cerca[1] ?? "").toLowerCase() === "json") tentativas.push(cerca[2] ?? "");
  for (const cerca of cercas) if ((cerca[1] ?? "").toLowerCase() !== "json") tentativas.push(cerca[2] ?? "");

  // Uma frase antes ou depois: do primeiro `{` ao último `}`.
  const inicio = texto.indexOf("{");
  const fim = texto.lastIndexOf("}");
  if (inicio >= 0 && fim > inicio) tentativas.push(texto.slice(inicio, fim + 1));

  // O rascunho e depois o final: cada objeto de nível superior, o último primeiro.
  tentativas.push(...objetosDeNivelSuperior(texto).reverse());

  const objeto = (candidato: string): unknown => {
    try {
      const lido = JSON.parse(candidato.trim()) as unknown;
      return lido !== null && typeof lido === "object" ? lido : undefined;
    } catch {
      return undefined;
    }
  };
  for (const candidato of tentativas) {
    const lido = objeto(candidato);
    if (lido !== undefined) return lido;
  }
  // Só quando nenhuma leitura literal deu objeto: sem comentário e sem vírgula sobrando, fora das strings.
  for (const candidato of tentativas) {
    const lido = objeto(semVirgulaSobrando(semComentarios(candidato)));
    if (lido !== undefined) return lido;
  }

  throw new SyntaxError("nenhum objeto JSON na resposta");
}

/** Percorre o texto entregando cada caractere com o aviso de se ele está dentro de uma string JSON. */
function* comStrings(texto: string): Generator<{ caractere: string; indice: number; emString: boolean }> {
  let emString = false;
  let escapado = false;
  for (let indice = 0; indice < texto.length; indice += 1) {
    const caractere = texto[indice]!;
    const dentro = emString;
    if (emString) {
      if (escapado) escapado = false;
      else if (caractere === "\\") escapado = true;
      else if (caractere === '"') emString = false;
    } else if (caractere === '"') {
      emString = true;
    }
    yield { caractere, indice, emString: dentro || emString };
  }
}

/**
 * Os objetos `{…}` de nível superior, na ordem, por uma varredura que respeita
 * strings: a chave dentro de uma string não abre nem fecha nada. Fora dos
 * objetos as aspas são prosa — "corrigindo:" —, e não abrem string.
 */
function objetosDeNivelSuperior(texto: string): string[] {
  const objetos: string[] = [];
  let profundidade = 0;
  let inicio = -1;
  let emString = false;
  let escapado = false;
  for (let indice = 0; indice < texto.length; indice += 1) {
    const caractere = texto[indice]!;
    if (emString) {
      if (escapado) escapado = false;
      else if (caractere === "\\") escapado = true;
      else if (caractere === '"') emString = false;
      continue;
    }
    if (caractere === '"' && profundidade > 0) emString = true;
    else if (caractere === "{") {
      if (profundidade === 0) inicio = indice;
      profundidade += 1;
    } else if (caractere === "}" && profundidade > 0) {
      profundidade -= 1;
      if (profundidade === 0) objetos.push(texto.slice(inicio, indice + 1));
    }
  }
  return objetos;
}

/** Sem comentário `//` até o fim da linha nem `/* … *\/`, fora das strings. */
function semComentarios(texto: string): string {
  let saida = "";
  let pular: "linha" | "bloco" | null = null;
  for (const { caractere, indice, emString } of comStrings(texto)) {
    if (pular === "linha") {
      if (caractere === "\n") {
        pular = null;
        saida += caractere;
      }
      continue;
    }
    if (pular === "bloco") {
      if (caractere === "/" && texto[indice - 1] === "*") pular = null;
      continue;
    }
    if (!emString && caractere === "/" && texto[indice + 1] === "/") {
      pular = "linha";
      continue;
    }
    if (!emString && caractere === "/" && texto[indice + 1] === "*") {
      pular = "bloco";
      continue;
    }
    saida += caractere;
  }
  return saida;
}

/** Sem a vírgula logo antes de `}` ou `]`, fora das strings. */
function semVirgulaSobrando(texto: string): string {
  let saida = "";
  for (const { caractere, indice, emString } of comStrings(texto)) {
    if (!emString && caractere === "," && /^\s*[}\]]/u.test(texto.slice(indice + 1))) continue;
    saida += caractere;
  }
  return saida;
}
