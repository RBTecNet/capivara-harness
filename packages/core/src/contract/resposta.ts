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
 */

export function jsonDaResposta(source: string): unknown {
  const texto = source.trim();

  const tentativas: string[] = [texto];

  // Cercas: as marcadas como json primeiro, depois as outras, na ordem.
  const cercas = [...texto.matchAll(/```([a-zA-Z]*)[^\S\n]*\n([\s\S]*?)\n```/g)];
  for (const cerca of cercas) if ((cerca[1] ?? "").toLowerCase() === "json") tentativas.push(cerca[2] ?? "");
  for (const cerca of cercas) if ((cerca[1] ?? "").toLowerCase() !== "json") tentativas.push(cerca[2] ?? "");

  // Uma frase antes ou depois: do primeiro `{` ao último `}`.
  const inicio = texto.indexOf("{");
  const fim = texto.lastIndexOf("}");
  if (inicio >= 0 && fim > inicio) tentativas.push(texto.slice(inicio, fim + 1));

  for (const candidato of tentativas) {
    try {
      const lido = JSON.parse(candidato.trim()) as unknown;
      if (lido !== null && typeof lido === "object") return lido;
    } catch {
      /* a próxima tentativa */
    }
  }

  throw new SyntaxError("nenhum objeto JSON na resposta");
}
