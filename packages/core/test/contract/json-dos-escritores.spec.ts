/**
 * O JSON dos escritores nos hábitos comuns (item 3 de "atacar os pontos frágeis").
 *
 * Conferido no código compilado da 69e0433: o rascunho seguido do objeto final,
 * a vírgula sobrando e o comentário `//` faziam `jsonDaResposta` recusar a
 * resposta, e é isso que alimenta "o esqueleto veio inválido três vezes" e "a
 * arquitetura veio inválida". Cada linha da tabela é um caso do documento.
 */

import { describe, expect, it } from "vitest";
import { jsonDaResposta } from "../../src/contract/index.js";

const FINAL = { contract: "capivara-skeleton/v2", projectName: "Pousada", phases: [{ number: 1, title: "Fundação" }] };
const RASCUNHO = { contract: "capivara-skeleton/v2", projectName: "Pousada", phases: [] };

describe("os hábitos que paravam o esqueleto e a arquitetura", () => {
  it.each([
    ["dois objetos: o rascunho e, depois de \"corrigindo:\", o final", `${JSON.stringify(RASCUNHO)}\n\nCorrigindo: faltaram as fases.\n\n${JSON.stringify(FINAL, null, 2)}`],
    ["vírgula sobrando antes de }", '{"contract": "capivara-skeleton/v2", "projectName": "Pousada", "phases": [{"number": 1, "title": "Fundação",}],}'],
    ["vírgula sobrando antes de ]", '{"contract": "capivara-skeleton/v2", "projectName": "Pousada", "phases": [{"number": 1, "title": "Fundação"},]}'],
    ["comentário // numa linha", '{\n  // o contrato do esqueleto\n  "contract": "capivara-skeleton/v2",\n  "projectName": "Pousada", // o nome\n  "phases": [{"number": 1, "title": "Fundação"}]\n}'],
    ["comentário /* */", '{"contract": "capivara-skeleton/v2", /* nome */ "projectName": "Pousada", "phases": [{"number": 1, "title": "Fundação"}]}'],
    ["cerca sem quebra de linha", "```json" + JSON.stringify(FINAL) + "```"],
    ["cerca ~~~", "~~~json\n" + JSON.stringify(FINAL) + "\n~~~"],
  ])("%s", (_caso, resposta) => {
    expect(jsonDaResposta(resposta)).toEqual(FINAL);
  });

  it("um JSON real com «», “” e crases dentro das strings continua intacto, e o // de uma URL não é comentário", () => {
    const real = {
      contract: "capivara-architecture/v1",
      overview: "A API devolve «201» com o “id” criado; veja `POST /reservas` em https://exemplo.local/docs.",
      components: [{ name: "api", contracts: ["POST /reservas → 201 {id}", "o campo `status` aceita “pendente”, a vírgula, e o } literal"] }],
    };
    const texto = JSON.stringify(real, null, 2);
    expect(jsonDaResposta(texto)).toEqual(real);
    // Com a vírgula sobrando fora das strings, a limpeza não toca no que está dentro delas.
    const comVirgula = texto.replace('o } literal"\n', 'o } literal",\n');
    expect(comVirgula).not.toBe(texto);
    expect(jsonDaResposta(comVirgula)).toEqual(real);
    expect(jsonDaResposta(`${texto.slice(0, -1)},\n}`)).toEqual(real);
  });

  it("o que nenhuma leitura transforma em objeto continua recusado", () => {
    expect(() => jsonDaResposta('{"contract": "x/v1", "itens": [1, 2')).toThrow();
    expect(() => jsonDaResposta("rascunho {sem aspas} e mais nada")).toThrow();
  });
});
