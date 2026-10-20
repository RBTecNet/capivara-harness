/**
 * O contrato julga a concorrência pela mesma régua do escalonador (§124).
 *
 * `effectiveDependencies` (contract/ownership.ts) reproduz
 * `dependenciasEfetivas` (loop/escalonador.ts): a fundação entra como
 * dependência de toda fase, dependência ilegível vira "todas as anteriores".
 * Se um dia as duas divergirem, o I-18 passa a apontar conflito onde o build
 * serializa, ou a calar onde o build paraleliza — e este teste é o que avisa.
 */

import { describe, expect, it } from "vitest";
import { effectiveDependencies, phaseDependencies } from "../../src/contract/index.js";
import { dependenciasEfetivas } from "../../src/loop/escalonador.js";

const planos: string[][] = [
  ["none", "Phase 1", "Phase 1", "Phase 1"],
  ["none", "none", "none"],
  ["none", "Phase 1", "Phase 2", "Phase 1, Phase 3"],
  ["none", "Phase 9", "Phase 1"],
  ["none", "Phase 3", "Phase 1"],
  ["none", "", "Phase 2"],
];

describe("effectiveDependencies espelha dependenciasEfetivas", () => {
  it.each(planos)("plano %s", (...dependsOn) => {
    const fases = dependsOn.map((valor, indice) => ({ number: indice + 1, dependsOn: valor }));
    const doContrato = effectiveDependencies(fases);
    const agendaveis = fases.map((fase) => ({ id: `P${fase.number}`, number: fase.number, dependsOn: phaseDependencies(fase.dependsOn) }));
    for (const fase of agendaveis) {
      expect(doContrato.get(fase.number), `fase ${fase.number} com Depends on "${dependsOn[fase.number - 1]}"`).toEqual(dependenciasEfetivas(fase, agendaveis).numeros);
    }
  });
});
