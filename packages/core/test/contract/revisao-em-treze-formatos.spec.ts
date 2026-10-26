/**
 * A revisão da fase lida em treze formatos (item 5 de "atacar os pontos frágeis").
 *
 * Conferido no código compilado da 69e0433: `parseVerification`, sobre a
 * leitura tolerante de `contract/protocolo.ts`, perdia a linha inteira entre
 * crases, o ponto final depois do veredito, o `:` no lugar do travessão e o
 * negrito só no veredito. Cada um virava revisão "inconclusiva", e a fase nunca
 * ficava "aceito". As nove primeiras linhas já eram lidas; as quatro últimas
 * são as do documento.
 */

import { describe, expect, it } from "vitest";
import { lerProtocolo } from "../../src/contract/protocolo.js";
import { parseVerification, pendenciasResolvidas } from "../../src/prompts/verifier.js";

const DONE = [{ index: 1, done: true, missing: "" }];
const INCOMPLETO = [{ index: 1, done: false, missing: "falta X" }];

describe("a revisão da fase, em treze formatos", () => {
  it.each([
    ["1. a linha do protocolo", "TASK 1: DONE", DONE],
    ["2. negrito na chave", "**TASK 1:** DONE", DONE],
    ["3. marcador de lista e caixa baixa", "- task 1: incomplete — falta X", INCOMPLETO],
    ["4. número de item e crase só na chave", "1. `TASK 1`: DONE", DONE],
    ["5. o raciocínio antes", "<think>TASK 1: INCOMPLETE — rascunho</think>\nTASK 1: DONE", DONE],
    ["6. a chave colada na frase anterior", "Conferi o código.TASK 1: DONE", DONE],
    ["7. o travessão curto", "TASK 1: INCOMPLETE – falta X", INCOMPLETO],
    ["8. citação", "> TASK 1: DONE", DONE],
    ["9. a observação que não bloqueia", "TASK 1: DONE — ADVISORY: nomeie a constante", [{ index: 1, done: true, missing: "ADVISORY: nomeie a constante" }]],
    ["10. a linha inteira entre crases", "`TASK 1: DONE`", DONE],
    ["11. o ponto final depois do veredito", "TASK 1: DONE.", DONE],
    ["12. o dois-pontos no lugar do travessão", "TASK 1: INCOMPLETE: falta X", INCOMPLETO],
    ["13. negrito só no veredito", "TASK 1: **DONE**", DONE],
  ] as const)("%s", (_caso, resposta, esperado) => {
    expect(parseVerification(resposta)).toEqual(esperado);
  });

  it("as quatro juntas, numa revisão de quatro tasks, cobrem as quatro", () => {
    const revisao = ["`TASK 1: DONE`", "TASK 2: DONE.", "TASK 3: INCOMPLETE: falta a rota", "TASK 4: **INCOMPLETE** — falta o teste"].join("\n");
    expect(parseVerification(revisao).map((verdict) => [verdict.index, verdict.done, verdict.missing])).toEqual([
      [1, true, ""],
      [2, true, ""],
      [3, false, "falta a rota"],
      [4, false, "falta o teste"],
    ]);
  });

  it("o conteúdo continua intocado: a crase final de um motivo, o dois-pontos dentro dele, e o valor de quem não passa veredito", () => {
    expect(parseVerification("TASK 1: INCOMPLETE — use `ler()`")).toEqual([{ index: 1, done: false, missing: "use `ler()`" }]);
    expect(parseVerification("`TASK 1`: INCOMPLETE — use `ler()`")).toEqual([{ index: 1, done: false, missing: "use `ler()`" }]);
    expect(parseVerification("TASK 1: INCOMPLETE — falta: a rota")).toEqual([{ index: 1, done: false, missing: "falta: a rota" }]);
    expect(lerProtocolo("CAPIVARA_FINDING: Arquitetura: o componente | x | y", "CAPIVARA_FINDING")).toBe("CAPIVARA_FINDING: Arquitetura: o componente | x | y");
    expect(parseVerification("**TASK** um: feito")).toEqual([]);
  });

  it("a linha da pendência do plano é lida com a mesma tolerância", () => {
    expect([...pendenciasResolvidas("`PLAN_ISSUE 1: RESOLVED`\nPLAN_ISSUE 2: **OPEN**: o código ainda exclui")]).toEqual([1]);
    expect([...pendenciasResolvidas("PLAN_ISSUE 1: RESOLVED.\nPLAN_ISSUE 2: RESOLVED — src/clientes.js desativa")]).toEqual([1, 2]);
  });
});
