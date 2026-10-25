/**
 * O levantamento de auditoria.
 *
 * No `assitencia` a exclusividade do e-mail voltou em quatro rodadas seguidas e
 * sobreviveu a três reinícios. O escritor seguia a regra transversal do
 * esqueleto ("usuários operacionais"); o auditor seguia a decisão aceita ("em
 * todo o sistema"). Os dois estavam certos sobre fontes diferentes, e nenhum
 * podia decidir qual valia.
 */

import { describe, expect, it } from "vitest";

import { ehRepetido, fingerprint } from "../../src/audit/index.js";

const finding = {
  where: "Phase 2 · usuários",
  problem: "a exclusividade do e-mail foi limitada aos usuários operacionais",
  fix: "exigir exclusividade em todo o sistema, incluindo o painel global",
};

describe("quando um achado vira desacordo", () => {
  it("o segundo aparecimento é desacordo, não descuido", () => {
    const historia = [{ attempt: 1, verdict: { status: "REJECTED" as const, findings: [finding], remarks: [], reason: "x" }, contentSha: "a" }];
    expect(ehRepetido(finding, historia)).toBe(true);
    expect(ehRepetido({ ...finding, problem: "outra coisa" }, historia)).toBe(false);
  });

  it("a marca ignora maiúsculas, para não deixar o mesmo ponto passar duas vezes", () => {
    expect(fingerprint(finding)).toBe(fingerprint({ ...finding, where: finding.where.toUpperCase() }));
  });
});



