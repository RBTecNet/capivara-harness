/**
 * O JSON dentro da resposta de um modelo — um leitor só, onde havia quatro.
 *
 * O survey do cronus3 com o codex foi recusado três vezes como "não é JSON
 * válido". Os dois jeitos de um JSON certo ser recusado estão aqui: uma frase
 * antes dele, e um trecho de código com crases dentro de uma string — que o
 * leitor antigo tomava pela cerca da resposta, cortando o objeto no meio.
 */

import { describe, expect, it } from "vitest";
import { jsonDaResposta, parseSurvey } from "../../src/contract/index.js";

const OBJETO = { contract: "x/v1", itens: [1, 2] };

describe("o JSON dentro da resposta", () => {
  it("a resposta que já é o objeto", () => {
    expect(jsonDaResposta(JSON.stringify(OBJETO))).toEqual(OBJETO);
  });

  it("cercado, com ou sem a marca json", () => {
    expect(jsonDaResposta("```json\n" + JSON.stringify(OBJETO) + "\n```")).toEqual(OBJETO);
    expect(jsonDaResposta("```\n" + JSON.stringify(OBJETO) + "\n```")).toEqual(OBJETO);
  });

  it("com uma frase antes e outra depois", () => {
    expect(jsonDaResposta(`Aqui está o mapa:\n${JSON.stringify(OBJETO)}\nQualquer dúvida, pergunte.`)).toEqual(OBJETO);
  });

  it("com um trecho de código cercado DENTRO de uma string", () => {
    const comCodigo = { contract: "x/v1", evidencia: "veja:\n```php\n$x = 1;\n```\nno controller" };
    expect(jsonDaResposta(JSON.stringify(comCodigo))).toEqual(comCodigo);
    // E cercado por fora também: a cerca de fora é a da resposta.
    expect(jsonDaResposta("```json\n" + JSON.stringify(comCodigo, null, 2) + "\n```")).toEqual(comCodigo);
  });

  it("prefere a cerca marcada json quando há outras", () => {
    const resposta = "Rodei:\n```bash\nls app/\n```\nResultado:\n```json\n" + JSON.stringify(OBJETO) + "\n```";
    expect(jsonDaResposta(resposta)).toEqual(OBJETO);
  });

  it("resposta cortada continua sendo recusada", () => {
    expect(() => jsonDaResposta('{"contract": "x/v1", "itens": [1, 2')).toThrow();
    expect(() => jsonDaResposta("não fiz o levantamento")).toThrow();
    expect(() => jsonDaResposta("[1, 2]")).not.toThrow();
  });

  it("o survey aceita o mapa com uma frase antes, e o contrato continua sendo conferido", () => {
    const semContrato = parseSurvey(`Segue o mapa.\n${JSON.stringify({ contract: "outro/v1" })}`);
    expect(semContrato.ok).toBe(false);
    if (!semContrato.ok) expect(semContrato.defects[0]?.problem).toContain("contrato");
  });
});
